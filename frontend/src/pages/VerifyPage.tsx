import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Lock, Plus, X } from 'lucide-react';
import { api, useFormulary, useHealth } from '../api/client';
import { MAX_ORDER_LINES } from '../api/types';
import type { Finding, OrderInput, OrderLineResult, Patient, PatientInput, PatientRecord, VerifyResult } from '../api/types';
import { ageText, fmt } from '../lib/format';
import { SCENARIOS } from '../lib/scenarios';
import DrugInput from '../components/DrugInput';
import PatientForm from '../components/PatientForm';
import PatientPicker from '../components/PatientPicker';
import { DrugReactions, PairEvidence, SignalView } from '../components/Evidence';
import { ErrorNote, Loading, Sev, Tabs, useDebounced } from '../components/ui';
import LabelSections from '../components/LabelSections';

type Override = { reason: string; note: string };
type AiState = { status: 'pending' | 'done' | 'rejected' | 'error'; text?: string; reason?: string; model?: string; ms?: number };
type VerifyPatient = Patient & { location?: string };

const OVERRIDE_REASONS = [
  'Prescriber confirmed — clinically appropriate',
  'Protocol-driven regimen (e.g. loading dose)',
  'Specialist recommendation documented',
  'Benefit outweighs risk — monitoring plan in place',
];

const TYPE_LABEL: Record<string, string> = {
  'dose-peds': 'Pediatric dose range', 'dose-adult': 'Adult dose range', interaction: 'Drug–drug interaction', age: 'Age restriction',
  duplicate: 'Duplicate therapy', data: 'Incomplete data', 'near-ceiling': 'Near maximum', renal: 'Renal dosing', geriatric: 'Older adult (Beers)',
  'no-kb': 'Dose not verifiable',
};

/**
 * Order verification. Holds the patient (optionally linked to a saved record) and 1–15 order lines,
 * re-verifies on every edit (debounced), and gates signing on open critical findings.
 */
export default function VerifyPage() {
  const qc = useQueryClient();
  const { data: formulary } = useFormulary();
  const { data: health } = useHealth();
  const [params, setParams] = useSearchParams();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const [patient, setPatient] = useState<VerifyPatient>(scenario.patient);
  const [saved, setSaved] = useState<PatientRecord | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [orders, setOrders] = useState<OrderInput[]>(scenario.orders);
  const [selected, setSelected] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [acks, setAcks] = useState<Record<string, true>>({});
  const [signed, setSigned] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, AiState>>({});
  const findingsRef = useRef<HTMLDivElement>(null);
  const patientId = saved?.id ?? null;

  const activeOrders = useMemo(() => orders.filter((o) => o.name.trim()), [orders]);
  const payload = useDebounced(JSON.stringify({ patient, orders: activeOrders, patientId }), 220);

  const verify = useQuery({
    queryKey: ['verify', payload],
    queryFn: () => { const p = JSON.parse(payload); return api.verify(p.patient, p.orders, false, p.patientId); },
    placeholderData: keepPreviousData,
  });
  const r = verify.data;

  // Any change to the order invalidates overrides and signature.
  useEffect(() => { setOverrides({}); setAcks({}); setSigned(null); }, [payload]);
  useEffect(() => {
    if (!r) return;
    if (!selected || !r.findings.some((f) => f.id === selected)) setSelected(r.findings[0]?.id ?? null);
  }, [r, selected]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); }, [toast]);

  function pickPatient(p: PatientRecord) {
    setSaved(p); setCreatingPatient(false);
    setPatient({ name: p.name, mrn: p.mrn ?? undefined, age: p.age, sex: p.sex ?? undefined, weight: p.weight, height: p.height, scr: p.scr });
    if (params.get('patient') !== String(p.id)) setParams({ patient: String(p.id) }, { replace: true });
  }

  // /verify?patient=<id> — opened from the Patients page.
  const linkId = Number(params.get('patient')) || null;
  useEffect(() => {
    if (!linkId || linkId === patientId) return;
    api.patient(linkId).then(pickPatient).catch((e) => setToast(`Patient ${linkId}: ${e.message}`));
  }, [linkId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask the local model to explain the selected finding (grounded, optional).
  const sel = r?.findings.find((f) => f.id === selected) ?? null;
  const aiKey = sel ? `${sel.id}|${sel.summary}` : '';
  useEffect(() => {
    if (!sel || health?.ai.state !== 'ready' || ai[aiKey]) return;
    setAi((m) => ({ ...m, [aiKey]: { status: 'pending' } }));
    api.explain({ headline: sel.headline, severity: sel.severity, finding: sel.summary, rationale: sel.rationale, actions: sel.actions,
      patient: patientSummary(patient, r!) })
      .then((res) => {
        setAi((m) => ({ ...m, [aiKey]: res.accepted ? { status: 'done', text: res.text, model: res.model, ms: res.latencyMs } : { status: 'rejected', reason: res.reason, model: res.model } }));
        if (res.accepted) api.auditAppend('ai-rationale', r!.id, { rule: sel.rule, model: res.model, ms: res.latencyMs, patientId }).catch(() => {});
      })
      .catch((e) => setAi((m) => ({ ...m, [aiKey]: { status: 'error', reason: e.message } })));
  }, [aiKey, health?.ai.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!;
    setScenarioId(id); setPatient(s.patient); setOrders(s.orders); setSelected(null); setSaved(null); setCreatingPatient(false);
    if (params.has('patient')) setParams({}, { replace: true });
  };
  const unlinkPatient = () => { setSaved(null); if (params.has('patient')) setParams({}, { replace: true }); };
  const saveToRecord = async () => {
    if (!saved) return;
    try {
      pickPatient(await api.patientUpdate(saved.id, recordFields(patient)));
      qc.invalidateQueries({ queryKey: ['patients'] });
      setToast(`Record #${saved.id} updated`);
    } catch (e: any) { setToast(`Update failed: ${e.message}`); }
  };
  const dirty = !!saved && JSON.stringify(recordFields(patient)) !== JSON.stringify(recordFields(saved));

  const setOrder = (line: number, patch: Partial<OrderInput>) => setOrders((os) => os.map((o) => (o.line === line ? { ...o, ...patch } : o)));
  const addLine = () => setOrders((os) => (os.length >= MAX_ORDER_LINES ? os : [...os, { line: os.length + 1, name: '', dose: null, freqId: 'daily' }]));
  const removeLine = (line: number) => setOrders((os) => os.filter((o) => o.line !== line).map((o, i) => ({ ...o, line: i + 1 })));
  const setVital = (k: keyof Patient, v: string) => setPatient((p) => ({ ...p, [k]: v === '' ? null : k === 'sex' || k === 'name' ? v : Number(v) }));

  const openCrit = r ? r.findings.filter((f) => f.severity === 'critical' && !overrides[f.id]) : [];
  const hardStops = r ? r.findings.filter((f) => f.hardStop) : [];
  const stale = verify.isFetching && verify.isPlaceholderData;
  const lineName = (n: number) => r?.lines.find((l) => l.line === n)?.drug.name ?? `Line ${n}`;

  const sign = async () => {
    if (!r) return;
    const recorded = await api.verify(patient, activeOrders, true, patientId);
    qc.invalidateQueries({ queryKey: ['audit'] });
    if (openCrit.length || hardStops.length) { setModal(true); return; }
    await api.auditAppend('sign', recorded.id, {
      patientId,
      orders: recorded.lines.map((l) => `${l.drug.name} ${l.dose} mg ${l.freq.label.toLowerCase()}`),
      overrides: Object.entries(overrides).map(([id, o]) => ({ finding: id, ...o })),
    });
    setSigned(recorded.id);
    setToast(`Signed · ${recorded.id} queued to pharmacy`);
  };

  return (
    <div className="page page--verify">
      <PatientBar patient={patient} result={r} saved={saved} dirty={dirty} scenarioId={scenarioId} onScenario={loadScenario}
        onPick={pickPatient} onNew={() => setCreatingPatient(true)} onUnlink={unlinkPatient} onSave={saveToRecord} />
      {creatingPatient && (
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">New patient</h2><span className="panel__meta">Prefilled from current parameters</span></header>
          <div className="panel__body">
            <PatientForm initial={recordFields(patient)} submitLabel="Create and link" onCancel={() => setCreatingPatient(false)}
              onSubmit={async (p) => { pickPatient(await api.patientCreate(p)); qc.invalidateQueries({ queryKey: ['patients'] }); }} />
          </div>
        </section>
      )}

      <div className="verify-grid">
        <div className="stack">
          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Medication orders</h2>
              <span className="panel__meta">{activeOrders.length} of {MAX_ORDER_LINES} lines · checked on entry</span>
            </header>
            <OrderTable orders={orders} result={r} findings={r?.findings ?? []} overrides={overrides} frequencies={formulary?.frequencies ?? []}
              onChange={setOrder} onRemove={removeLine} />
            <div className="orders__foot">
              <button className="btn btn--sm" type="button" onClick={addLine} disabled={orders.length >= MAX_ORDER_LINES}>
                <Plus aria-hidden="true" />Add medication
              </button>
              {orders.length >= MAX_ORDER_LINES && <span className="muted">Maximum {MAX_ORDER_LINES} lines per order.</span>}
            </div>
          </section>

          <section className="panel" ref={findingsRef}>
            <header className="panel__head">
              <h2 className="panel__title">Order checks</h2>
              <span className="panel__meta">{r ? `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} · ${r.checks.length} checks` : '—'}</span>
            </header>
            {verify.error && <div className="panel__body"><ErrorNote error={verify.error} /></div>}
            {r && r.findings.length === 0 && (
              <div className="all-clear"><Sev sev="pass" label="No findings" /><span>Dose, interaction and age checks passed.</span></div>
            )}
            {r && r.findings.length > 0 && (
              <div className="findings">
                {r.findings.map((f) => (
                  <FindingRow key={f.id} f={f} open={f.id === selected} onOpen={() => setSelected(f.id === selected ? null : f.id)}
                              override={overrides[f.id]} acked={!!acks[f.id]} lineName={lineName}>
                    {f.id === selected && (
                      <FindingDetail f={f} r={r} ai={ai[aiKey]} aiState={health?.ai.state}
                        override={overrides[f.id]} acked={!!acks[f.id]}
                        onApply={() => { setOrder(f.lines[0], { dose: f.data.suggested }); api.auditAppend('dose-change', r.id, { rule: f.rule, line: f.lines[0], to: f.data.suggested, patientId }).catch(() => {}); }}
                        onOverride={(o) => { setOverrides((m) => ({ ...m, [f.id]: o })); api.auditAppend('override', r.id, { rule: f.rule, lines: f.lines, ...o, patientId }).then(() => qc.invalidateQueries({ queryKey: ['audit'] })).catch(() => {}); }}
                        onAck={() => { setAcks((m) => ({ ...m, [f.id]: true })); api.auditAppend('acknowledge', r.id, { rule: f.rule, lines: f.lines, patientId }).catch(() => {}); }} />
                    )}
                  </FindingRow>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="stack verify-side">
          <Verdict r={r} stale={stale} openCrit={openCrit.length} hardStops={hardStops.length} overridden={Object.keys(overrides).length} signed={signed} onSign={sign} />
          <PatientParams patient={patient} onChange={setVital} result={r} />
        </aside>
      </div>

      {modal && r && (
        <InterruptModal r={r} findings={[...hardStops, ...openCrit.filter((f) => !f.hardStop)]} patient={patient}
          onReview={() => { setModal(false); findingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          onModify={() => { setModal(false); document.getElementById(`dose-${(openCrit[0] ?? hardStops[0])?.lines[0] ?? 1}`)?.focus(); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** The demographic fields stored on a patient record, normalised for comparison and PATCH. */
function recordFields(p: Patient | PatientRecord): PatientInput {
  return {
    name: p.name ?? '', mrn: p.mrn ?? null, sex: p.sex ?? null,
    age: p.age ?? null, weight: p.weight ?? null, height: p.height ?? null, scr: p.scr ?? null,
  };
}

function patientSummary(p: Patient, r: VerifyResult) {
  const parts = [];
  if (p.age != null) parts.push(`${p.age}-year-old ${p.sex === 'M' ? 'male' : 'female'}`);
  if (p.weight != null) parts.push(`${p.weight} kg`);
  if (r.profile.renal) parts.push(`${r.profile.renal.label} ${r.profile.renal.value} ${r.profile.renal.unit}`);
  return parts.join(', ');
}

/* ---------------------------------------------------------------- patient */
/** Patient header: identity, key facts, record link state, patient picker and sample-case loader. */
function PatientBar({ patient, result, saved, dirty, scenarioId, onScenario, onPick, onNew, onUnlink, onSave }: {
  patient: VerifyPatient; result?: VerifyResult; saved: PatientRecord | null; dirty: boolean; scenarioId: string;
  onScenario: (id: string) => void; onPick: (p: PatientRecord) => void; onNew: () => void; onUnlink: () => void; onSave: () => void;
}) {
  const band = result?.profile.band;
  return (
    <section className="patientbar">
      <div className="patientbar__id">
        <h1 className="patientbar__name">{patient.name || 'Unidentified patient'}</h1>
        <div className="patientbar__sub">
          MRN <span className="mono">{patient.mrn || '—'}</span>
          {patient.location && <> · {patient.location}</>}
          {' · '}
          {saved
            ? <span>Record <span className="mono">#{saved.id}</span>{dirty && <strong className="patientbar__dirty"> · edited, not saved</strong>}</span>
            : <span className="muted">Not linked to a record</span>}
        </div>
      </div>
      <dl className="patientbar__facts">
        <div><dt>Age/sex</dt><dd className="mono">{ageText(patient.age)} {patient.sex ?? '—'}</dd></div>
        <div><dt>Wt</dt><dd className="mono">{patient.weight != null ? `${fmt(patient.weight)} kg` : '—'}</dd></div>
        <div><dt>BSA</dt><dd className="mono">{result?.profile.bsa ? `${result.profile.bsa.value.toFixed(2)} m²` : '—'}</dd></div>
        <div><dt>Renal</dt><dd className="mono">{result?.profile.renal ? `${result.profile.renal.label} ${result.profile.renal.value}` : '—'}</dd></div>
        <div><dt>Allergies</dt><dd>NKDA</dd></div>
        {band && band.pediatric != null && <div><dt>Dosing</dt><dd className={band.pediatric ? 'patientbar__peds' : ''}>{band.label}{band.pediatric ? ' · mg/kg' : ''}</dd></div>}
      </dl>
      <div className="patientbar__tools">
        <PatientPicker onPick={onPick} onNew={onNew} />
        {saved && dirty && <button className="btn btn--sm btn--primary" type="button" onClick={onSave}>Save to record</button>}
        {saved && <button className="btn btn--sm" type="button" onClick={onUnlink}>Unlink</button>}
        <select className="select select--sm" aria-label="Load sample case" value={saved ? '' : scenarioId} onChange={(e) => onScenario(e.target.value)}>
          {saved && <option value="" disabled>Sample case…</option>}
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>Sample: {s.label}</option>)}
        </select>
      </div>
    </section>
  );
}

function PatientParams({ patient, onChange, result }: { patient: Patient; onChange: (k: keyof Patient, v: string) => void; result?: VerifyResult }) {
  const p = result?.profile;
  const rows: [string, string | null, string | undefined][] = [
    ['BMI', p?.bmi ? `${p.bmi.value} kg/m²` : null, p?.bmi?.category],
    ['BSA', p?.bsa ? `${p.bsa.value.toFixed(2)} m²` : null, 'Mosteller'],
    ['IBW', p?.ibw ? `${p.ibw.value} kg` : null, p?.ibw ? 'Devine' : 'Adults ≥ 152 cm'],
    [p?.renal?.label === 'eGFR' ? 'eGFR' : 'CrCl', p?.renal ? `${p.renal.value} ${p.renal.unit}` : null, p?.renal ? p.renal.formula : 'Needs SCr'],
  ];
  const num = (k: keyof Patient, label: string, unit: string, step = '0.1') => (
    <div className="field">
      <label htmlFor={`pt-${k}`}>{label}</label>
      <div className="affix">
        <input id={`pt-${k}`} className="input input--num" type="number" step={step} min="0" value={(patient[k] as number | null | undefined) ?? ''} onChange={(e) => onChange(k, e.target.value)} />
        <span className="affix__unit">{unit}</span>
      </div>
    </div>
  );
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">Patient parameters</h2></header>
      <div className="panel__body stack">
        <div className="params-grid">
          {num('age', 'Age', 'y')}
          <div className="field">
            <label htmlFor="pt-sex">Sex</label>
            <select id="pt-sex" className="select" value={patient.sex ?? 'F'} onChange={(e) => onChange('sex', e.target.value)}>
              <option value="F">Female</option><option value="M">Male</option>
            </select>
          </div>
          {num('weight', 'Weight', 'kg')}
          {num('height', 'Height', 'cm', '0.5')}
          <div className="params-grid__full">{num('scr', 'Serum creatinine', 'mg/dL')}</div>
        </div>
        <dl className="derived">
          {rows.map(([k, v, s]) => (
            <div key={k}><dt>{k}</dt><dd>{v ? <span className="mono">{v}</span> : <span className="muted">—</span>}{s && <small>{s}</small>}</dd></div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- orders */
type Freq = { id: string; label: string; perDay: number };

/** Dense order-entry grid; one OrderRow per line. The last remaining line cannot be removed. */
function OrderTable({ orders, result, findings, overrides, frequencies, onChange, onRemove }: {
  orders: OrderInput[]; result?: VerifyResult; findings: Finding[]; overrides: Record<string, Override>;
  frequencies: Freq[]; onChange: (line: number, p: Partial<OrderInput>) => void; onRemove: (line: number) => void;
}) {
  return (
    <div className="otable" role="table" aria-label="Medication order lines">
      <div className="otable__head" role="row">
        <span role="columnheader">#</span><span role="columnheader">Medication</span><span role="columnheader">Dose</span><span role="columnheader">Frequency</span>
        <span role="columnheader" className="r">Daily</span><span role="columnheader" className="r">Max/day</span><span role="columnheader">% max</span>
        <span role="columnheader">Status</span><span role="columnheader"><span className="sr-only">Remove</span></span>
      </div>
      {orders.map((o) => (
        <OrderRow key={o.line} order={o} result={o.name.trim() ? result?.lines.find((l) => l.line === o.line) : undefined}
          findings={findings.filter((f) => f.lines.includes(o.line))} overrides={overrides} frequencies={frequencies}
          onChange={(p) => onChange(o.line, p)} onRemove={orders.length > 1 ? () => onRemove(o.line) : undefined} />
      ))}
    </div>
  );
}

/** One order line: entry fields plus the engine's daily total, ceiling and % of ceiling for that line. */
function OrderRow({ order, result, findings, overrides, frequencies, onChange, onRemove }: {
  order: OrderInput; result?: OrderLineResult; findings: Finding[]; overrides: Record<string, Override>;
  frequencies: Freq[]; onChange: (p: Partial<OrderInput>) => void; onRemove?: () => void;
}) {
  const open = findings.filter((f) => f.severity === 'critical' && !overrides[f.id]);
  const state = !order.name.trim() ? 'idle' : open.length ? 'crit' : findings.some((f) => f.severity === 'advisory' || overrides[f.id]) ? 'warn' : result ? 'ok' : 'idle';
  const level = result?.pct == null ? 'none' : result.pct > 100 ? 'crit' : result.pct >= 90 ? 'warn' : 'ok';
  const renamed = result && result.input.toLowerCase() !== result.drug.name.toLowerCase();
  return (
    <div className={`orow orow--${state}`} role="row">
      <span className="orow__n mono" role="cell">{order.line}</span>
      <div role="cell" className="orow__drug">
        <DrugInput id={`drug-${order.line}`} value={order.name} onChange={(v) => onChange({ name: v })} placeholder="Generic or brand" ariaLabel={`Line ${order.line} medication`} />
      </div>
      <div role="cell" className="affix">
        <input id={`dose-${order.line}`} className="input input--num" type="number" min="0" step="any" value={order.dose ?? ''} aria-label={`Line ${order.line} dose`}
               onChange={(e) => onChange({ dose: e.target.value === '' ? null : Number(e.target.value) })} />
        <span className="affix__unit">mg</span>
      </div>
      <div role="cell">
        <select id={`freq-${order.line}`} className="select" value={order.freqId} aria-label={`Line ${order.line} frequency`} onChange={(e) => onChange({ freqId: e.target.value })}>
          {frequencies.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.perDay}×/d)</option>)}
        </select>
      </div>
      <span role="cell" className="r mono">{result?.tdd != null ? `${fmt(result.tdd)} mg` : '—'}</span>
      <span role="cell" className="r mono">{result?.ceiling ? `${fmt(result.ceiling.value)} mg` : '—'}</span>
      <span role="cell" className="orow__pct">
        <span className={`mono orow__pctv orow__pctv--${level}`}>{result?.pct != null ? `${result.pct}%` : '—'}</span>
        {result?.pct != null && (
          // Scale is 0–150 % so the 100 % limit tick sits at two thirds of the track.
          <span className="pctbar" aria-hidden="true"><i className={`pctbar__fill pctbar__fill--${level}`} style={{ width: `${Math.min(100, result.pct / 1.5)}%` }} /><i className="pctbar__limit" /></span>
        )}
      </span>
      <span role="cell" className="orow__status">
        {state === 'crit' && <Sev sev="critical" label={`${open.length} crit`} />}
        {state === 'warn' && <Sev sev="advisory" label="Review" />}
        {state === 'ok' && <Sev sev="pass" label="Pass" />}
      </span>
      <span role="cell">
        {onRemove && <button className="icon-btn icon-btn--sm" type="button" onClick={onRemove} aria-label={`Remove line ${order.line}`} title="Remove line"><X aria-hidden="true" /></button>}
      </span>
      {result && (
        <div className="orow__basis mono" role="cell">
          {result.drug.curated ? 'Curated limit' : 'No curated limit — interactions only'}
          {result.ceiling && <> · {result.ceiling.rule === 'pediatric' ? `${result.ceiling.basis} = ${fmt(result.ceiling.raw)} mg/day${result.ceiling.capped ? ', capped at adult max' : ''}` : 'adult absolute max'}</>}
          {result.mgPerKg != null && <> · {fmt(result.mgPerKg, 2)} mg/kg/day</>}
          {renamed && <> · “{result.input}” → {result.drug.name}</>}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- findings */
/** Collapsible finding header. Names the drug(s) involved so multi-line orders stay readable. */
function FindingRow({ f, open, onOpen, override, acked, lineName, children }: {
  f: Finding; open: boolean; onOpen: () => void; override?: Override; acked: boolean; lineName: (n: number) => string; children?: React.ReactNode;
}) {
  const resolved = !!override || acked;
  // Name the drugs each finding is about, not just the line numbers.
  const subject = f.type === 'interaction' ? `${f.data.a.name} + ${f.data.b.name}`
    : f.lines.length ? f.lines.map(lineName).filter((n, i, a) => a.indexOf(n) === i).join(' + ') : null;
  return (
    <article className={`finding finding--${f.severity} ${resolved ? 'is-resolved' : ''} ${open ? 'is-open' : ''}`}>
      <button className="finding__row" type="button" onClick={onOpen} aria-expanded={open}>
        <span className="finding__stripe" aria-hidden="true" />
        <span className="finding__sev">
          {resolved ? <span className="sev sev--none">{override ? 'Overridden' : 'Acknowledged'}</span> : <Sev sev={f.severity} />}
        </span>
        <span className="finding__main">
          <span className="finding__headline">
            {subject && <span className="finding__subject">{subject}</span>}
            {f.headline}
            {f.hardStop && <span className="hardstop"><Lock aria-hidden="true" />Hard stop</span>}
          </span>
          <span className="finding__summary mono">{f.summary}</span>
        </span>
        <span className="finding__meta">
          <span className="finding__type">{TYPE_LABEL[f.type] ?? f.type}</span>
          <span className="mono muted">{f.rule}{f.lines.length ? ` · L${f.lines.join(', L')}` : ''}</span>
        </span>
        <ChevronRight className="finding__chev" aria-hidden="true" />
      </button>
      {children}
    </article>
  );
}

type DetailTab = 'why' | 'calc' | 'label' | 'evidence' | 'signal' | 'faers';

function FindingDetail({ f, r, ai, aiState, override, acked, onApply, onOverride, onAck }: {
  f: Finding; r: VerifyResult; ai?: AiState; aiState?: string; override?: Override; acked: boolean;
  onApply: () => void; onOverride: (o: Override) => void; onAck: () => void;
}) {
  const isDose = f.type === 'dose-peds' || f.type === 'dose-adult' || f.type === 'near-ceiling' || f.type === 'no-kb';
  const isPair = f.type === 'interaction';
  const line = r.lines.find((l) => l.line === f.lines[0]);
  const [tab, setTab] = useState<DetailTab>('why');
  const [showKb, setShowKb] = useState(false);
  const [form, setForm] = useState<Override | null>(null);

  const pairNames = isPair ? [f.data.a.name.toLowerCase(), f.data.b.name.toLowerCase()] : [];
  const tabs = [
    { id: 'why' as const, label: 'Rationale' },
    { id: 'calc' as const, label: 'Calculation', hidden: !(isDose && line?.ceiling) },
    { id: 'evidence' as const, label: 'Evidence', hidden: !isPair },
    { id: 'signal' as const, label: 'FAERS signal', hidden: !isPair },
    { id: 'label' as const, label: 'FDA label', hidden: !isDose || !line },
    { id: 'faers' as const, label: 'Reported reactions', hidden: !isDose || !line },
  ];

  const useAi = ai?.status === 'done' && !showKb;
  return (
    <div className="finding__detail">
      <Tabs label="Finding detail" tabs={tabs} value={tab} onChange={setTab} />
      <div className="finding__body">
        {tab === 'why' && (
          <div className="stack">
            <div className="rationale">
              <div className="rationale__head">
                {useAi
                  ? <span className="src src--ai">AI rationale · {ai!.model} · {((ai!.ms ?? 0) / 1000).toFixed(1)} s · figures verified</span>
                  : <span className="src">Knowledge-base rationale</span>}
                {ai?.status === 'pending' && <span className="ai-note"><span className="spinner" />AI rationale pending</span>}
                {ai?.status === 'rejected' && <span className="ai-note ai-note--warn">AI text discarded — {ai.reason}</span>}
                {ai?.status === 'error' && <span className="ai-note ai-note--warn">AI unavailable — {ai.reason}</span>}
                {!ai && aiState === 'loading' && <span className="ai-note">AI model loading</span>}
                {ai?.status === 'done' && <button className="linklike" type="button" onClick={() => setShowKb((v) => !v)}>{showKb ? 'Show AI rationale' : 'Show knowledge-base text'}</button>}
              </div>
              <p>{useAi ? ai!.text : f.rationale}</p>
            </div>
            <div className="two-col">
              {f.actions.length > 0 && <div><h4 className="eyebrow">Recommended action</h4><ul className="list">{f.actions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
              {f.monitoring.length > 0 && <div><h4 className="eyebrow">Monitoring</h4><ul className="list list--muted">{f.monitoring.map((a) => <li key={a}>{a}</li>)}</ul></div>}
            </div>
          </div>
        )}
        {tab === 'calc' && line?.ceiling && (
          <table className="calc mono">
            <tbody>
              <tr><td>Dose × frequency</td><td>{fmt(line.dose)} mg × {line.freq.perDay}/day</td><td>= {fmt(line.tdd)} mg/day</td></tr>
              {line.ceiling.rule === 'pediatric' && <tr><td>Weight-based limit</td><td>{line.ceiling.basis}</td><td>= {fmt(line.ceiling.raw)} mg/day</td></tr>}
              {line.ceiling.capped && <tr><td>Adult cap applied</td><td /><td>= {fmt(line.ceiling.value)} mg/day</td></tr>}
              {line.ceiling.rule === 'adult' && <tr><td>Adult absolute maximum</td><td /><td>= {fmt(line.ceiling.value)} mg/day</td></tr>}
              <tr className="calc__total"><td>Ordered vs limit</td><td>{fmt(line.tdd)} ÷ {fmt(line.ceiling.value)}</td><td>= {line.pct}%</td></tr>
              {f.data.suggested != null && <tr><td>Largest safe dose</td><td>{fmt(line.ceiling.value)} ÷ {line.freq.perDay}, rounded down</td><td>= {fmt(f.data.suggested)} mg per dose</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'evidence' && isPair && <PairEvidence a={pairNames[0]} b={pairNames[1]} />}
        {tab === 'signal' && isPair && <SignalView a={pairNames[0]} b={pairNames[1]} compactView />}
        {tab === 'label' && line && <LabelForDrug name={line.ingredient} keys={['boxed_warning', 'dosage_and_administration', 'pediatric_use', 'geriatric_use']} />}
        {tab === 'faers' && line && <DrugReactions name={line.ingredient} />}
      </div>

      <div className="finding__actions">
        {override ? <span className="resolved-note">Overridden — {override.reason}: “{override.note}”</span>
          : acked ? <span className="resolved-note">Advisory acknowledged.</span>
          : f.hardStop ? <span className="resolved-note resolved-note--crit"><Lock aria-hidden="true" />Hard stop. Correct the order; override not permitted.</span>
          : f.severity === 'critical' ? (
            <>
              {f.data.suggested > 0 && <button className="btn btn--primary btn--sm" type="button" onClick={onApply}>Change to {fmt(f.data.suggested)} mg {f.data.freq.label.toLowerCase()}</button>}
              <button className="btn btn--danger btn--sm" type="button" onClick={() => setForm({ reason: OVERRIDE_REASONS[0], note: '' })}>Override…</button>
            </>
          ) : <button className="btn btn--sm" type="button" onClick={onAck}>Acknowledge</button>}
      </div>
      {form && !override && (
        <form className="override" onSubmit={(e) => { e.preventDefault(); if (form.note.trim().length >= 5) { onOverride({ ...form, note: form.note.trim() }); setForm(null); } }}>
          <div className="field">
            <label htmlFor={`ov-r-${f.id}`}>Reason</label>
            <select id={`ov-r-${f.id}`} className="select" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {OVERRIDE_REASONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`ov-n-${f.id}`}>Clinical justification</label>
            <input id={`ov-n-${f.id}`} className="input" autoFocus minLength={5} required placeholder="e.g. Discussed with Dr Iyer; INR daily" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="row">
            <button className="btn btn--danger btn--sm" type="submit" disabled={form.note.trim().length < 5}>Record override</button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setForm(null)}>Cancel</button>
            <span className="muted">Recorded in audit ledger.</span>
          </div>
        </form>
      )}
    </div>
  );
}

function LabelForDrug({ name, keys }: { name: string; keys: string[] }) {
  const q = useQuery({ queryKey: ['profile', name], queryFn: () => api.profile(name) });
  if (q.isLoading) return <Loading label="Loading FDA label" />;
  if (!q.data) return <ErrorNote error={q.error} />;
  if (!q.data.label) return <ErrorNote>{q.data.labelError ? `FDA labels unavailable: ${q.data.labelError}` : `No FDA label found for ${name}.`}</ErrorNote>;
  return <LabelSections label={q.data.label} provenance={q.data.labelProvenance} only={keys} />;
}

/* ---------------------------------------------------------------- verdict */
function Verdict({ r, stale, openCrit, hardStops, overridden, signed, onSign }: {
  r?: VerifyResult; stale: boolean; openCrit: number; hardStops: number; overridden: number; signed: string | null; onSign: () => void;
}) {
  if (!r) return <section className="panel verdict"><div className="panel__body"><Loading label="Verifying" /></div></section>;
  const state = signed ? 'signed' : hardStops || openCrit ? 'crit' : r.status === 'critical' ? 'overridden' : r.status === 'advisory' ? 'warn' : 'ok';
  const title = {
    signed: 'Signed', crit: 'Order held', overridden: 'Overrides documented', warn: 'Advisories — review', ok: 'No findings',
  }[state];
  const sub = {
    signed: `${signed} · queued to pharmacy`,
    crit: hardStops ? `${hardStops} hard stop${hardStops > 1 ? 's' : ''} — correct to proceed` : `${openCrit} critical — correct or override`,
    overridden: `${overridden} override${overridden > 1 ? 's' : ''} recorded`,
    warn: `${r.counts.advisory} advisory · not blocking`,
    ok: 'Dose, interaction and age checks passed',
  }[state];
  const passed = r.checks.filter((c) => c.result === 'pass').length;
  return (
    <section className={`panel verdict verdict--${state} ${stale ? 'is-stale' : ''}`} aria-live="polite">
      <div className="verdict__band">
        <div className="verdict__title">{title}</div>
        <div className="verdict__sub">{sub}</div>
      </div>
      <div className="verdict__counts">
        <div><span className="mono">{r.counts.critical}</span>Critical</div>
        <div><span className="mono">{r.counts.advisory}</span>Advisory</div>
        <div><span className="mono">{passed}/{r.checks.length}</span>Passed</div>
      </div>
      <ul className="checks">
        {r.checks.map((c) => (
          <li key={c.label} className={`check check--${c.result.replace('/', '')}`}>
            <span className="check__mark" aria-hidden="true">{{ pass: '✓', fail: '✕', advisory: '!', 'n/a': '–' }[c.result]}</span>
            <span className="check__label">{c.label}<small>{c.detail}</small></span>
          </li>
        ))}
      </ul>
      <div className="verdict__foot">
        <button className="btn btn--primary btn--block" type="button" onClick={onSign} disabled={!!signed}>{signed ? 'Signed' : 'Sign order'}</button>
        <div className="verdict__meta mono">{r.id} · {r.engineMs} ms · {r.kbVersion}</div>
      </div>
    </section>
  );
}

function InterruptModal({ r, findings, patient, onReview, onModify }: {
  r: VerifyResult; findings: Finding[]; patient: Patient; onReview: () => void; onModify: () => void;
}) {
  const reviewRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { reviewRef.current?.focus(); }, []);
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && onReview()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="interrupt-title">
        <div className="modal__band">
          <div id="interrupt-title" className="modal__title">Order held — {findings.length} critical finding{findings.length > 1 ? 's' : ''}</div>
          <div className="modal__sub mono">{patient.name ?? 'Unidentified'} · MRN {patient.mrn ?? '—'} · {r.id}</div>
        </div>
        <div className="modal__body">
          <p>Cannot sign until each finding is corrected{findings.some((f) => !f.hardStop) ? ' or overridden with documented justification' : ''}.</p>
          <ul className="modal__list">
            {findings.map((f) => (
              <li key={f.id}>
                <Sev sev="critical" label={f.hardStop ? 'Hard stop' : 'Critical'} />
                <div><strong>{f.headline}</strong><span className="mono">{f.summary}</span></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="modal__foot">
          <button className="btn" type="button" onClick={onModify}>Modify order</button>
          <button className="btn btn--primary" type="button" ref={reviewRef} onClick={onReview}>Review findings</button>
        </div>
      </div>
    </div>
  );
}
