import { Bot, ExternalLink, FileText, Fingerprint, Globe, Monitor, Server, ShieldCheck } from 'lucide-react';
import { useHealth } from '../api/client';
import { sourceStates } from '../components/Shell';
import { ago, compact } from '../lib/format';
import { Loading } from '../components/ui';

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
