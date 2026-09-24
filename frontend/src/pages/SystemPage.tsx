import { Bot, ExternalLink, FileText, Fingerprint, Globe, Monitor, Server, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, useHealth } from '../api/client';
import type { Health } from '../api/types';
import { FigureText, GroundingResult, shortModel } from '../components/Ai';
import { sourceStates } from '../components/Shell';
import { ago, compact } from '../lib/format';
import { ErrorNote, Loading } from '../components/ui';

const LAYERS = [
  {
    id: 'client', title: 'Clinician workspace', tag: 'React · TypeScript · Vite', icon: Monitor,
    items: ['Order verification (live)', 'Interaction screen', 'Drug intelligence', 'Signal lab', 'Audit ledger'],
    note: 'Debounced live verification on every keystroke; server state cached with TanStack Query.',
  },
  {
    id: 'api', title: 'API gateway', tag: 'FastAPI · OpenAPI · Pydantic', icon: Server,
    items: ['/verify', '/screen', '/evidence/pair', '/signals/pair', '/drugs/{name}', '/audit', '/ai/*'],
    note: 'Typed request validation; interactive documentation at /docs.',
  },
  {
    id: 'decide', title: 'Decision layer', tag: 'Deterministic · local · < 5 ms', icon: ShieldCheck, accent: true,
    items: ['Rules engine (12 rules)', 'Curated formulary (dose limits)', 'DDInter global DDI table', 'Name resolver (brand → ingredient)'],
    note: 'The only layer that can raise or clear an alert. Works fully offline.',
  },
  {
    id: 'evidence', title: 'Evidence layer', tag: 'Network · cached · circuit breaker', icon: Globe,
    items: ['openFDA drug labels', 'openFDA FAERS reports', 'NLM RxNorm', 'SQLite response cache'],
    note: 'Quoted and charted with provenance. Never decides an alert. Serves cache when a source fails.',
  },
  {
    id: 'explain', title: 'Explanation layer', tag: 'Local LLM · grounded', icon: Bot,
    items: ['Qwen2.5 via Hugging Face', 'Numeric grounding check', 'Knowledge-base fallback'],
    note: 'Rewrites the rationale only. Any figure not in the verified facts discards the output.',
  },
  {
    id: 'record', title: 'Record', tag: 'SHA-256 hash chain', icon: Fingerprint,
    items: ['Verifications', 'Overrides with justification', 'Signatures', 'AI generations'],
    note: 'Append-only ledger; any edit to history is detectable.',
  },
];

/** The facts of the demo pediatric paracetamol finding: what the grounding check compares against. */
const DEMO_FACTS = {
  headline: 'Dose exceeds maximum pediatric weight-based limit',
  severity: 'critical',
  finding: '3,000 mg/day ordered · ceiling 1,500 mg/day · 200% of limit',
  patient: '6-year-old male, 20 kg',
  rationale: 'The ordered regimen of 500 mg every 4 h delivers 3,000 mg/day (150 mg/kg/day), exceeding the patient-specific ceiling of 1,500 mg/day (75 mg/kg/day × 20 kg) by 1,500 mg.',
  actions: ['Reduce to ≤ 250 mg every 4 h (≤ 1,500 mg/day).'],
};

const DEMO_OUTPUTS = [
  { id: 'faithful', label: 'Faithful rewording', text: 'This 6-year-old weighing 20 kg is ordered 500 mg every 4 h, which totals 3,000 mg/day: 200% of the 1,500 mg/day weight-based ceiling. Reduce each dose to 250 mg.' },
  { id: 'dose', label: 'Invented dose', text: 'The order totals 3,000 mg/day against a 1,500 mg/day ceiling. Reduce the dose to 400 mg every 4 h.' },
  { id: 'stat', label: 'Invented statistic', text: 'Doses above the 1,500 mg/day ceiling cause liver injury in 12% of children within 48 h.' },
];

/** AI and data-science components at a glance: what each does and where its boundary is. */
function AiPipeline({ h }: { h?: Health }) {
  const ai = h?.ai;
  const aiStatus = !ai ? '—' : ai.state === 'ready' ? `ready on ${ai.device}` : ai.state === 'disabled' ? 'off (DX_LLM=off)' : ai.state;
  return (
    <section className="panel panel--flush" id="ai-pipeline">
      <header className="panel__head"><h2 className="panel__title">AI and data pipeline</h2><span className="panel__meta">Alerts are decided only by the deterministic rules engine</span></header>
      <div className="table-wrap">
        <table className="table pipeline">
          <thead><tr><th>Component</th><th>What it does</th><th>Boundary</th><th /></tr></thead>
          <tbody>
            <tr>
              <td><strong>Local language model</strong><div className="mono muted">{shortModel(ai?.model)} · {aiStatus}</div></td>
              <td>Rewrites a finding&apos;s rationale in plainer clinical prose. Runs on this machine through Hugging Face transformers; no patient data leaves it, and it works offline once downloaded.</td>
              <td><span className="yes">May</span> reword the explanation. <span className="no">May not</span> raise, clear, grade or override an alert.</td>
              <td />
            </tr>
            <tr>
              <td><strong>Grounding check</strong><div className="mono muted">prompts.judge()</div></td>
              <td>Every figure in the model&apos;s text must appear in the verified facts; otherwise the text is discarded and the knowledge-base text is shown.</td>
              <td>Checks figures, not wording. The knowledge-base text is always one click away.</td>
              <td><a className="btn btn--sm" href="#grounding-demo">Try it</a></td>
            </tr>
            <tr>
              <td><strong>Statistical signal detection</strong><div className="mono muted">openfda.ror()</div></td>
              <td>Reporting odds ratio with a 95% confidence interval (log / Woolf method) for each reaction across FAERS reports; a signal needs ≥ 3 reports and a lower bound above 1.</td>
              <td>Evidence only: a hypothesis for review, never an alert.</td>
              <td><Link className="btn btn--sm" to="/signals?a=warfarin&b=amiodarone">Signal lab</Link></td>
            </tr>
            <tr>
              <td><strong>Name resolution</strong><div className="mono muted">RxNorm · {h?.rxnormNames ? `${h.rxnormNames.toLocaleString()} names` : 'index not loaded'}</div></td>
              <td>Maps brands, misspellings and combination products to active ingredients, so drugs outside the {h?.formulary.drugs ?? 10}-drug curated list still get DDInter interaction checks.</td>
              <td>Unresolved names are shown as unidentified, never guessed.</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Live demo of the grounding check: the same server-side function applied to every AI response. */
function GroundingDemo() {
  const [preset, setPreset] = useState(DEMO_OUTPUTS[1].id);
  const [text, setText] = useState(DEMO_OUTPUTS[1].text);
  const check = useMutation({ mutationFn: (inject: boolean) => api.groundingCheck(DEMO_FACTS, text, inject) });
  const res = check.data;
  const pick = (id: string) => { setPreset(id); setText(DEMO_OUTPUTS.find((o) => o.id === id)!.text); check.reset(); };
  return (
    <section className="panel" id="grounding-demo">
      <header className="panel__head">
        <h2 className="panel__title">Grounding check — try it</h2>
        <span className="panel__meta">POST /api/v1/ai/grounding-check · works with the AI off</span>
      </header>
      <div className="panel__body stack">
        <p className="muted">Pretend the model wrote the text below about the pediatric paracetamol finding. The server runs the same check that every real AI response goes through.</p>
        <details className="ai-check">
          <summary>Verified facts (the only figures allowed)</summary>
          <pre className="ai-check__pre">{[DEMO_FACTS.headline, DEMO_FACTS.finding, DEMO_FACTS.patient, DEMO_FACTS.rationale, ...DEMO_FACTS.actions].join('\n')}</pre>
        </details>
        <div className="row">
          <label className="field__label" htmlFor="gd-preset">Candidate AI text</label>
          <select id="gd-preset" className="select select--sm" value={preset} onChange={(e) => pick(e.target.value)}>
            {DEMO_OUTPUTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {preset === 'custom' && <option value="custom">Your own text</option>}
          </select>
        </div>
        <textarea className="textarea" rows={3} value={text} aria-label="Candidate AI text" onChange={(e) => { setText(e.target.value); setPreset('custom'); check.reset(); }} />
        <div className="row">
          <button className="btn btn--primary btn--sm" type="button" onClick={() => check.mutate(false)} disabled={!text.trim() || check.isPending}>Run grounding check</button>
          <button className="btn btn--sm" type="button" onClick={() => check.mutate(true)} disabled={!text.trim() || check.isPending}
                  title="Server changes one figure in this text to a value not in the facts, then runs the check">Inject a fabricated figure</button>
        </div>
        {check.error && <ErrorNote error={check.error} />}
        {res && (
          <div className="stack">
            {res.injected && <p className="muted">Injected: {res.injected.from ? <>changed <span className="mono">{res.injected.from}</span> → <span className="mono">{res.injected.to}</span></> : <>added <span className="mono">{res.injected.to} mg</span></>}</p>}
            <p className="ai-check__out"><FigureText text={res.candidate} ungrounded={res.grounding.ungrounded} /></p>
            <GroundingResult report={res.grounding} accepted={res.accepted} reason={res.reason} />
          </div>
        )}
        <p className="muted">Limit: the check guards figures only. A wrong non-numeric statement would pass, which is why the AI can never decide an alert and the knowledge-base text stays available.</p>
      </div>
    </section>
  );
}

export default function SystemPage() {
  const { data: h, isLoading } = useHealth();
  const states = sourceStates(h);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>System</h1>
          <p>Alerts come only from deterministic rules over curated and imported data. Live sources add evidence and the AI adds wording; neither can change whether an alert fires.</p>
        </div>
        <a className="btn" href="/docs" target="_blank" rel="noreferrer"><FileText />API documentation<ExternalLink /></a>
      </div>

      <AiPipeline h={h} />
      <GroundingDemo />

      <section className="arch" aria-label="Architecture">
        {LAYERS.map((l, i) => (
          <div key={l.id} className={`arch__layer ${l.accent ? 'arch__layer--accent' : ''}`}>
            <div className="arch__idx mono">{String(i + 1).padStart(2, '0')}</div>
            <div className="arch__head">
              <l.icon aria-hidden="true" />
              <div><div className="arch__title">{l.title}</div><div className="arch__tag">{l.tag}</div></div>
            </div>
            <ul className="arch__items">{l.items.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="arch__note">{l.note}</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <header className="panel__head"><h2 className="panel__title">Live status</h2><span className="panel__meta">{h ? `Mode: ${h.mode}${h.openfdaKey ? ' · openFDA key set' : ''}` : ''}</span></header>
        {isLoading || !h ? <div className="panel__body"><Loading label="Checking sources" /></div> : (
          <div className="status-grid">
            {states.map((s) => (
              <div key={s.key} className={`status-card status-card--${s.tone}`}>
                <div className="row"><span className={`dot dot--${s.tone === 'idle' ? '' : s.tone === 'busy' ? 'accent dot--pulse' : s.tone}`} /><strong>{s.label}</strong></div>
                <p>{s.detail}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {h && (
        <div className="grid-2">
          <section className="panel">
            <header className="panel__head"><h2 className="panel__title">Local data</h2></header>
            <div className="panel__body">
              <dl className="kv">
                <div><dt>Curated formulary</dt><dd>{h.formulary.drugs} drugs · {h.formulary.version} · integrity {h.formulary.integrity.ok ? 'passed' : 'FAILED'}</dd></div>
                <div><dt>DDInter</dt><dd>{h.ddinter.available ? `${Number(h.ddinter.pairs).toLocaleString()} interaction records · ${Number(h.ddinter.drugs).toLocaleString()} drugs · imported ${ago(Number(h.ddinter.imported_at))}` : 'Not imported'}</dd></div>
                <div><dt>RxNorm search index</dt><dd>{h.rxnormNames ? `${h.rxnormNames.toLocaleString()} names` : 'Not loaded'}</dd></div>
                <div><dt>Audit ledger</dt><dd>{h.audit.entries} entries</dd></div>
              </dl>
            </div>
          </section>
          <section className="panel">
            <header className="panel__head"><h2 className="panel__title">Response cache</h2><span className="panel__meta">Serves the demo without internet</span></header>
            <div className="panel__body">
              {Object.keys(h.cache).length ? (
                <dl className="kv">
                  {Object.entries(h.cache).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{compact(v.entries)} responses · newest {ago(v.latest)}</dd></div>)}
                </dl>
              ) : <p className="muted">Empty. Run <code>python -m backend.tools.warm_cache</code> on good Wi-Fi before the demo.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
