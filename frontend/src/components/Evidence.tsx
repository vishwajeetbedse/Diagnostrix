import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Database, ExternalLink, FileText, Globe, ShieldCheck, Table2 } from 'lucide-react';
import { api } from '../api/client';
import type { Signal } from '../api/types';
import { compact, fmt, reactionText } from '../lib/format';
import { BarList, ForestPlot } from './charts';
import { DrugName, ErrorNote, Highlight, Loading, ProvenanceTag, Sev, type SevKey } from './ui';

const LEVEL_SEV: Record<string, SevKey> = { Major: 'major', Moderate: 'moderate', Minor: 'minor', Unknown: 'minor', Contraindicated: 'contraindicated' };

/** Every source's view of one drug pair, side by side. */
export function PairEvidence({ a, b }: { a: string; b: string }) {
  const q = useQuery({ queryKey: ['pair', a, b], queryFn: () => api.pair(a, b) });
  if (q.isLoading) return <Loading label="Collecting evidence from the knowledge base, DDInter and FDA labels…" />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const e = q.data;
  const mentions = [
    ...e.label.aMentionsB.map((m) => ({ ...m, owner: a })),
    ...e.label.bMentionsA.map((m) => ({ ...m, owner: b })),
  ];
  return (
    <div className="evidence">
      <section className="ev-block">
        <header><ShieldCheck aria-hidden="true" /><span>Curated knowledge base</span><span className="ev-src">Pharmacy team · {e.curated.version}</span></header>
        {e.curated.monograph ? (
          <dl className="ev-dl">
            <dt>Severity</dt><dd><Sev sev={LEVEL_SEV[e.curated.monograph.severity] ?? 'major'} label={e.curated.monograph.severity} /> · {e.curated.monograph.kind}</dd>
            <dt>Mechanism</dt><dd>{e.curated.monograph.mechanism}</dd>
            <dt>Effect</dt><dd>{e.curated.monograph.effect}</dd>
            <dt>Management</dt><dd>{e.curated.monograph.management}</dd>
          </dl>
        ) : (
          <p className="ev-none">{e.curated.drugs.every(Boolean) ? 'No monograph — the pharmacy team has not flagged this pair.' : 'At least one agent is outside the curated formulary.'}</p>
        )}
      </section>

      <section className="ev-block">
        <header><Database aria-hidden="true" /><span>Global interaction database</span><span className="ev-src">DDInter</span></header>
        {!e.ddinterAvailable ? <p className="ev-none">DDInter is not imported on this server.</p>
          : e.ddinter ? (
            <div className="ev-ddi">
              <Sev sev={LEVEL_SEV[e.ddinter.level]} label={`${e.ddinter.level} interaction`} />
              <span className="muted">{e.ddinter.drugA} ↔ {e.ddinter.drugB}</span>
              {e.ddinter.url && <a href={e.ddinter.url} target="_blank" rel="noreferrer" className="ext">DDInter record <ExternalLink aria-hidden="true" /></a>}
            </div>
          ) : <p className="ev-none">No record for this pair. Absence from DDInter does not prove the combination is safe.</p>}
      </section>

      <section className="ev-block ev-block--wide">
        <header><FileText aria-hidden="true" /><span>FDA product labelling</span>
          <span className="ev-src">{e.label.a?.provenance ? <ProvenanceTag p={e.label.a.provenance} label="openFDA labels" /> : 'openFDA labels'}</span></header>
        {mentions.length ? (
          <ul className="ev-quotes">
            {mentions.map((m, i) => (
              <li key={i}>
                <div className="ev-quote-meta"><DrugName name={m.owner} /> label · {m.section}</div>
                <blockquote className="quote"><Highlight text={m.text} term={m.match} /></blockquote>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ev-none">
            {e.label.errors.length ? 'FDA labels could not be reached and are not cached.' : 'Neither label mentions the other agent by name or class.'}
          </p>
        )}
        <div className="ev-links">
          {[{ n: a, l: e.label.a }, { n: b, l: e.label.b }].map(({ n, l }) => l?.dailyMedUrl && (
            <a key={n} className="ext" href={l.dailyMedUrl} target="_blank" rel="noreferrer">Full {n} label on DailyMed <ExternalLink aria-hidden="true" /></a>
          ))}
        </div>
      </section>
    </div>
  );
}

/** FAERS disproportionality for a pair: forest plot with a table view. */
export function SignalView({ a, b, data, compactView }: { a: string; b: string; data?: Signal; compactView?: boolean }) {
  const q = useQuery({ queryKey: ['signal', a, b], queryFn: () => api.signal(a, b), enabled: !data });
  const s = data ?? q.data;
  const [table, setTable] = useState(false);
  if (!data && q.isLoading) return <Loading label="Querying FAERS — about 20 requests on first run, then cached…" />;
  if (!s) return <ErrorNote error={q.error} />;
  if (s.error) return <ErrorNote>FAERS unavailable: {s.error}</ErrorNote>;
  const t = s.totals!;
  const rows = (s.reactions ?? []).filter((r) => r.pair);
  const signals = rows.filter((r) => r.pair?.signal);
  return (
    <div className="signal">
      <div className="signal__summary">
        <div><span className="mono signal__big">{fmt(t.pair, 0)}</span><span>reports list both drugs</span></div>
        <div><span className="mono">{compact(t.a)}</span><span>with {a}</span></div>
        <div><span className="mono">{compact(t.b)}</span><span>with {b}</span></div>
        <div><span className="mono">{compact(t.all)}</span><span>total in FAERS</span></div>
      </div>
      {!rows.length ? <p className="ev-none">Too few co-reports to estimate a signal.</p> : (
        <>
          <div className="row signal__head">
            <p className="signal__lede">
              {signals.length
                ? <><strong>{signals.length} of {rows.length}</strong> reactions are reported disproportionately often with the combination (lower 95% CI above 1).</>
                : <>No reaction reaches the signal threshold for this combination.</>}
            </p>
            <button className="btn btn--sm btn--ghost" type="button" onClick={() => setTable((v) => !v)}><Table2 />{table ? 'Show chart' : 'Show table'}</button>
          </div>
          {table ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Reaction</th><th className="r">Pair reports</th><th className="r">ROR pair (95% CI)</th><th className="r">ROR {a}</th><th className="r">ROR {b}</th><th>Signal</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.reaction}>
                      <td>{reactionText(r.reaction)}</td>
                      <td className="r mono">{fmt(r.reports.pair, 0)}</td>
                      <td className="r mono">{r.pair ? `${r.pair.ror} (${r.pair.lo}–${r.pair.hi})` : '—'}</td>
                      <td className="r mono">{r.a?.ror ?? '—'}</td>
                      <td className="r mono">{r.b?.ror ?? '—'}</td>
                      <td>{r.pair?.signal ? <Sev sev="major" label="Signal" /> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <ForestPlot rows={compactView ? rows.slice(0, 6) : rows} aName={a} bName={b} />}
        </>
      )}
      <div className="signal__foot">
        <ProvenanceTag p={s.provenance} label="openFDA · FAERS" />
        <span>Reports show suspected associations, not incidence or causation.</span>
        <Link to={`/signals?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`}>Open in Signal lab →</Link>
      </div>
    </div>
  );
}

/** Top FAERS reactions for one drug. */
export function DrugReactions({ name, limit = 8 }: { name: string; limit?: number }) {
  const q = useQuery({ queryKey: ['faers', name], queryFn: () => api.faers(name) });
  if (q.isLoading) return <Loading label={`Loading real-world reports for ${name}…`} />;
  if (!q.data || q.data.error) return <ErrorNote>FAERS unavailable{q.data?.error ? `: ${q.data.error}` : ''}</ErrorNote>;
  const f = q.data;
  return (
    <div className="stack">
      <p className="muted"><strong className="mono" style={{ color: 'var(--ink)' }}>{fmt(f.reports, 0)}</strong> FAERS reports mention {name}; the reactions reported most often:</p>
      <BarList label={`Most reported reactions for ${name}`} total={f.reports}
               rows={(f.reactions ?? []).slice(0, limit).map((r) => ({ key: r.term, label: reactionText(r.term), value: r.count }))} />
      <div className="signal__foot">
        <ProvenanceTag p={f.provenance} label="openFDA · FAERS" />
        <Link to={`/drugs/${encodeURIComponent(name)}`}><BookOpen style={{ width: 14, height: 14, verticalAlign: -2 }} /> Full drug profile →</Link>
      </div>
    </div>
  );
}

export function GlobalNote() {
  return (
    <p className="footnote"><Globe aria-hidden="true" /> FAERS includes reports submitted from outside the United States. WHO VigiBase, the largest global database, has no public API.</p>
  );
}
