import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, Plus, Split, X } from 'lucide-react';
import { api, useHealth } from '../api/client';
import type { ScreenCell, ScreenResult } from '../api/types';
import { fmt, tallMan } from '../lib/format';
import DrugInput from '../components/DrugInput';
import { PairEvidence, SignalView } from '../components/Evidence';
import { DrugName, ErrorNote, Loading, Sev, Tabs, type SevKey } from '../components/ui';

const START = ['Dolo 650', 'Combiflam', 'Warf 5', 'Aspirin', 'Pan 40'];
const VIA: Record<string, string> = { generic: 'Generic name', alias: 'Alternative name', brand: 'Brand', combination: 'Combination product', ddinter: 'DDInter', rxnorm: 'RxNorm' };
const SHORT: Record<string, string> = { contraindicated: 'CI', major: 'MAJ', moderate: 'MOD', minor: 'MIN', none: '' };

export default function ScreenPage() {
  const { data: health } = useHealth();
  const [entries, setEntries] = useState<string[]>(START);
  const [draft, setDraft] = useState('');
  const [pair, setPair] = useState<ScreenCell | null>(null);
  const run = useMutation({ mutationFn: api.screen, onSuccess: (r) => setPair(r.findings.find((f) => f.type === 'interaction') as ScreenCell ?? null) });
  const add = (v: string) => { const t = v.trim(); if (t && !entries.some((e) => e.toLowerCase() === t.toLowerCase()) && entries.length < 12) setEntries([...entries, t]); setDraft(''); };
  const r = run.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Interaction screen</h1>
          <p>All pairs checked against curated KB and DDInter. Generics, brands and combination products; duplicate ingredients detected across brands.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel__body stack">
          <div className="chips-input">
            {entries.map((e) => (
              <span key={e} className="entry-chip">{e}<button type="button" aria-label={`Remove ${e}`} onClick={() => setEntries(entries.filter((x) => x !== e))}><X /></button></span>
            ))}
            <form className="chips-input__add" onSubmit={(ev) => { ev.preventDefault(); add(draft); }}>
              <DrugInput value={draft} onChange={setDraft} placeholder={entries.length ? 'Add another medication' : 'Add a medication'} ariaLabel="Add medication" />
              <button className="btn btn--sm" type="submit" disabled={!draft.trim()}><Plus />Add</button>
            </form>
          </div>
          <div className="row">
            <button className="btn btn--primary" type="button" disabled={entries.length < 2 || run.isPending} onClick={() => run.mutate(entries)}>
              {run.isPending ? <span className="spinner" /> : <Split />}Screen {entries.length} medications · {entries.length * (entries.length - 1) / 2} pairs
            </button>
            {entries.length > 0 && <button className="btn btn--ghost" type="button" onClick={() => { setEntries([]); run.reset(); }}>Clear list</button>}
          </div>
          {run.error && <ErrorNote error={run.error} />}
        </div>
      </section>

      {r && (
        <>
          <div className="grid-2">
            <Resolution r={r} />
            <Matrix r={r} onPick={setPair} active={pair} />
          </div>
          <Findings r={r} onPick={setPair} active={pair} />
          {pair && <PairPanel cell={pair} />}
          {r.unresolved.length > 0 && <AiScreen entries={entries} r={r} ready={health?.ai.state === 'ready'} />}
        </>
      )}
      {!r && !run.isPending && <div className="empty">No screen run. Sample list contains a duplicate ingredient (Dolo 650, Combiflam: paracetamol).</div>}
    </div>
  );
}

function Resolution({ r }: { r: ScreenResult }) {
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">What each entry contains</h2><span className="panel__meta">{r.resolved.filter((x) => x.ingredients.length).length} of {r.resolved.length} identified</span></header>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Entry</th><th>Active ingredient(s)</th><th>Matched by</th></tr></thead>
          <tbody>
            {r.resolved.map((x) => (
              <tr key={x.input}>
                <td><strong>{x.input}</strong></td>
                <td>{x.ingredients.length ? x.ingredients.map((i, k) => <span key={i}>{k > 0 && ' + '}<DrugName name={i} /></span>) : <span className="muted">—</span>}</td>
                <td>{x.via ? <span className="tag">{VIA[x.via]}</span> : <Sev sev="moderate" label="Not identified" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Matrix({ r, onPick, active }: { r: ScreenResult; onPick: (c: ScreenCell) => void; active: ScreenCell | null }) {
  const ings = r.ingredients;
  const cell = (a: string, b: string) => r.cells.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  if (ings.length < 2) return <section className="panel"><div className="empty">Need two identified ingredients for a matrix.</div></section>;
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">Pairwise severity</h2><span className="panel__meta">Select a cell for evidence</span></header>
      <div className="panel__body">
        <div className="matrix-wrap">
          <table className="matrix">
            <thead><tr><th />{ings.map((i) => <th key={i} scope="col"><span>{tallMan(i)}</span></th>)}</tr></thead>
            <tbody>
              {ings.map((a, ia) => (
                <tr key={a}>
                  <th scope="row">{tallMan(a)}</th>
                  {ings.map((b, ib) => {
                    if (ia === ib) return <td key={b} className="matrix__self" />;
                    const c = cell(a, b)!;
                    const on = active && ((active.a === c.a && active.b === c.b));
                    return (
                      <td key={b}>
                        <button type="button" className={`mcell mcell--${c.severity} ${on ? 'is-on' : ''}`} onClick={() => onPick(c)}
                                aria-label={`${a} with ${b}: ${c.severity === 'none' ? 'no interaction recorded' : c.severity}`} title={`${tallMan(a)} + ${tallMan(b)} · ${c.severity === 'none' ? 'no record' : `${c.severity} (${c.source})`}`}>
                          {SHORT[c.severity]}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="matrix-legend">
          {(['contraindicated', 'major', 'moderate', 'minor', 'none'] as const).map((s) => (
            <span key={s}><i className={`mcell mcell--${s}`}>{SHORT[s]}</i>{s === 'none' ? 'No record' : s[0].toUpperCase() + s.slice(1)}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Findings({ r, onPick, active }: { r: ScreenResult; onPick: (c: ScreenCell) => void; active: ScreenCell | null }) {
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">Findings</h2><span className="panel__meta">{r.findings.length} across {r.cells.length} pairs</span></header>
      {r.findings.length === 0 ? <div className="all-clear"><Sev sev="pass" label="None recorded" /><span>No interactions or duplicates in the databases. Absence of a record does not establish safety.</span></div> : (
        <ul className="screen-findings">
          {r.findings.map((f, i) => f.type === 'duplicate' ? (
            <li key={i} className="sf sf--major">
              <Sev sev="major" label="Duplicate" />
              <div><strong>Duplicate ingredient: <DrugName name={f.ingredient} /></strong>
                <span>{f.entries.join(' + ')} both contain {f.ingredient}. Count every source toward one daily maximum{f.adultMax ? ` (adult ${fmt(f.adultMax)} mg/day)` : ''}.</span></div>
            </li>
          ) : (
            <li key={i} className={`sf sf--${f.severity} ${active && active.a === f.a && active.b === f.b ? 'is-on' : ''}`}>
              <Sev sev={f.severity as SevKey} />
              <div><strong><DrugName name={f.a} /> + <DrugName name={f.b} /></strong>
                <span>{f.monograph ? `${f.monograph.kind} — ${f.monograph.effect}` : `Graded ${f.ddinter?.level} in DDInter.`} <em className="muted">({f.entries.join(' · ')} · {f.source})</em></span></div>
              <button className="btn btn--sm" type="button" onClick={() => onPick(f)}>Evidence</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PairPanel({ cell }: { cell: ScreenCell }) {
  const [tab, setTab] = useState<'evidence' | 'signal'>('evidence');
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">{tallMan(cell.a)} + {tallMan(cell.b)}</h2><Sev sev={cell.severity as SevKey} label={cell.severity === 'none' ? 'No record' : undefined} /></header>
      <Tabs label="Pair evidence" value={tab} onChange={setTab} tabs={[{ id: 'evidence', label: 'Sources' }, { id: 'signal', label: 'Real-world signal (FAERS)' }]} />
      <div className="panel__body">
        {tab === 'evidence' ? <PairEvidence key={cell.a + cell.b} a={cell.a} b={cell.b} /> : <SignalView key={cell.a + cell.b} a={cell.a} b={cell.b} />}
      </div>
    </section>
  );
}

function AiScreen({ entries, r, ready }: { entries: string[]; r: ScreenResult; ready: boolean }) {
  const m = useMutation({
    mutationFn: () => api.aiScreen({
      medications: entries, focus: r.unresolved,
      verified: r.resolved.filter((x) => x.ingredients.length).map((x) => `${x.input} → ${x.ingredients.join(' + ')}`),
    }),
  });
  return (
    <section className="panel panel--ai">
      <header className="panel__head"><h2 className="panel__title">AI screen for unidentified entries</h2><span className="panel__meta">{r.unresolved.join(', ')}</span></header>
      <div className="ai-banner">AI-generated. Not verified against any database — confirm with a pharmacist before acting.</div>
      <div className="panel__body">
        {m.data ? (
          <><ul className="list">{m.data.lines.map((l) => <li key={l}>{l}</li>)}</ul><p className="muted mono" style={{ fontSize: 12, marginTop: 10 }}>{m.data.model} · {(m.data.latencyMs / 1000).toFixed(1)} s</p></>
        ) : m.isPending ? <Loading label="Local model running (up to 60 s on CPU)" />
          : m.error ? <ErrorNote error={m.error} />
          : ready ? <button className="btn" type="button" onClick={() => m.mutate()}><Bot />Ask the local model about {r.unresolved.join(', ')}</button>
          : <p className="muted">The AI model is not ready. {r.unresolved.join(', ')} could not be identified by RxNorm or DDInter.</p>}
      </div>
    </section>
  );
}
