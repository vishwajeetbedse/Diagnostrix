import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Database, ExternalLink, FileText, OctagonAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { compact, countryName, fmt, hasTallMan, pct, reactionText, tallMan } from '../lib/format';
import { BarList, YearTrend } from '../components/charts';
import LabelSections, { Expandable } from '../components/LabelSections';
import { GlobalNote } from '../components/Evidence';
import { DrugName, ErrorNote, Loading, ProvenanceTag, Sev, Stat, type SevKey } from '../components/ui';

export default function DrugPage() {
  const { name = '' } = useParams();
  const profile = useQuery({ queryKey: ['profile', name], queryFn: () => api.profile(name) });
  const ingredient = profile.data?.ingredient ?? name;
  const faers = useQuery({ queryKey: ['faers', ingredient], queryFn: () => api.faers(ingredient), enabled: !!profile.data });

  if (profile.isLoading) return <div className="page"><Loading label={`Loading ${name}…`} /></div>;
  if (!profile.data) return <div className="page"><ErrorNote error={profile.error} /></div>;
  const p = profile.data;
  const kb = p.curated;
  const label = p.label;
  const f = faers.data;
  const boxed = label?.sections.find((s) => s.key === 'boxed_warning');
  const brands = Array.from(new Set([...(kb?.brands ?? []), ...(label?.brandNames ?? [])])).slice(0, 8);
  const cls = kb?.cls ?? label?.pharmClass.join(' · ');

  return (
    <div className="page">
      <header className="drug-head">
        <div className="eyebrow">Drug intelligence</div>
        <h1 className="drug-head__name">{tallMan(ingredient)}</h1>
        <div className="drug-head__meta">
          {cls && <span>{cls}</span>}
          {brands.length > 0 && <span>Brands: {brands.join(', ')}</span>}
          {p.resolution.via && p.resolution.input.toLowerCase() !== ingredient && <span>“{p.resolution.input}” resolved via {p.resolution.via}</span>}
        </div>
        <div className="row">
          {kb ? <span className="badge badge--accent"><ShieldCheck />Curated dose limits</span> : <span className="badge">Not in curated formulary</span>}
          {p.ddinter.available && p.ddinter.total ? <span className="badge"><Database />DDInter · {p.ddinter.total} partners</span> : null}
          {label && <span className="badge"><FileText />FDA label {label.effectiveTime ? `· ${label.effectiveTime.slice(0, 4)}` : ''}</span>}
          {hasTallMan(ingredient) && <span className="badge badge--outline" title="ISMP Tall Man lettering for look-alike names">Tall Man lettering</span>}
          {label?.dailyMedUrl && <a className="ext" href={label.dailyMedUrl} target="_blank" rel="noreferrer">DailyMed <ExternalLink /></a>}
        </div>
      </header>

      {boxed && (
        <div className="boxed">
          <OctagonAlert aria-hidden="true" />
          <div><div className="boxed__title">Boxed warning</div><Expandable text={boxed.text} limit={420} /></div>
        </div>
      )}

      <section className="stats">
        <Stat label="FAERS reports" value={f?.reports != null ? compact(f.reports) : faers.isLoading ? '…' : '—'} sub="mention this ingredient" />
        <Stat label="Serious" value={f?.reports ? pct(f.serious, f.reports) : '—'} sub={f?.serious != null ? `${compact(f.serious)} reports` : undefined} tone="warn" />
        <Stat label="Death reported" value={f?.reports ? pct(f.deaths, f.reports) : '—'} sub={f?.deaths != null ? `${compact(f.deaths)} reports` : undefined} tone="crit" />
        <Stat label="Reporting countries" value={f?.countries?.length ? `${f.countries.length}${f.countries.length >= 12 ? '+' : ''}` : '—'} sub="in the top list" />
        <Stat label="Major interactions" value={p.ddinter.counts?.Major ?? '—'} sub={p.ddinter.total ? `of ${p.ddinter.total} DDInter partners` : 'DDInter'} tone="crit" />
      </section>

      <div className="grid-2">
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">Most reported reactions</h2>{f?.provenance && <ProvenanceTag p={f.provenance} label="FAERS" />}</header>
          <div className="panel__body">
            {faers.isLoading ? <Loading label="Querying FAERS" /> : f?.error ? <ErrorNote>FAERS unavailable: {f.error}</ErrorNote> : (
              <BarList label="Most reported reactions" total={f?.reports} rows={(f?.reactions ?? []).slice(0, 12).map((r) => ({ key: r.term, label: reactionText(r.term), value: r.count }))} />
            )}
          </div>
        </section>
        <div className="stack">
          <section className="panel">
            <header className="panel__head"><h2 className="panel__title">Reports received per year</h2></header>
            <div className="panel__body">{faers.isLoading ? <Loading label="…" /> : <YearTrend data={(f?.years ?? []).filter((y) => y.year >= 2004)} label="FAERS reports per year" />}</div>
          </section>
          <section className="panel">
            <header className="panel__head"><h2 className="panel__title">Where reports come from</h2></header>
            <div className="panel__body">
              {faers.isLoading ? <Loading label="…" /> : f?.countries?.length ? (
                <BarList label="Reports by country" rows={f.countries.slice(0, 8).map((c) => ({ key: c.term, label: countryName(c.term), value: c.count }))} />
              ) : <p className="muted">No country breakdown available.</p>}
              <GlobalNote />
            </div>
          </section>
        </div>
      </div>

      {kb && (
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">Curated dosing limits</h2><span className="panel__meta">Pharmacy team formulary</span></header>
          <div className="panel__body dosing">
            <div><span className="eyebrow">Adult maximum</span><span className="mono dosing__v">{fmt(kb.adultMaxDaily)} mg/day</span></div>
            <div><span className="eyebrow">Pediatric maximum</span><span className="mono dosing__v">{fmt(kb.pedsMaxMgPerKgDay)} mg/kg/day</span></div>
            <div><span className="eyebrow">Minimum age</span><span className="mono dosing__v">{kb.minAgeYears != null ? `${kb.minAgeYears} y` : '—'}</span></div>
            <div><span className="eyebrow">Renal threshold</span><span className="mono dosing__v">{kb.renal ? `< ${kb.renal.threshold} mL/min` : '—'}</span></div>
            <p className="dosing__tox">{kb.toxicity}</p>
          </div>
        </section>
      )}

      <div className="grid-2 grid-2--wide-left">
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">FDA product label</h2>{p.labelProvenance && <ProvenanceTag p={p.labelProvenance} label="openFDA" />}</header>
          {label ? <LabelSections label={label} provenance={null} /> : <div className="panel__body"><ErrorNote>{p.labelError ? `FDA labels unavailable: ${p.labelError}` : 'No FDA label found for this ingredient.'}</ErrorNote></div>}
        </section>
        <Interactions name={ingredient} data={p.ddinter} />
      </div>
    </div>
  );
}

const LEVELS = ['Major', 'Moderate', 'Minor', 'Unknown'] as const;
const LEVEL_SEV: Record<string, SevKey> = { Major: 'major', Moderate: 'moderate', Minor: 'minor', Unknown: 'minor' };

function Interactions({ name, data }: { name: string; data: { available: boolean; total?: number; counts: Record<string, number>; items: { name: string; level: string }[] } }) {
  const [level, setLevel] = useState<string>('Major');
  const [q, setQ] = useState('');
  const items = useMemo(() => data.items.filter((i) => (level === 'All' || i.level === level) && i.name.toLowerCase().includes(q.toLowerCase())), [data, level, q]);
  return (
    <section className="panel">
      <header className="panel__head"><h2 className="panel__title">Interaction partners</h2><span className="panel__meta">DDInter · {data.total ?? 0} drugs</span></header>
      {!data.available ? <div className="panel__body"><ErrorNote>DDInter is not imported. Run <code>python -m backend.tools.import_ddinter</code>.</ErrorNote></div>
        : !data.total ? <div className="panel__body muted">No interactions recorded for {name}.</div> : (
          <>
            <div className="ddi-dist" aria-label="Partners by severity">
              {LEVELS.filter((l) => data.counts[l]).map((l) => (
                <div key={l} className={`ddi-dist__seg ddi-dist__seg--${l.toLowerCase()}`} style={{ flexGrow: data.counts[l] }} title={`${l}: ${data.counts[l]}`} />
              ))}
            </div>
            <div className="ddi-tools">
              <div className="seg" role="group" aria-label="Severity filter">
                {(['All', ...LEVELS] as string[]).filter((l) => l === 'All' || data.counts[l]).map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>{l}{l !== 'All' && <span className="mono"> {data.counts[l]}</span>}</button>
                ))}
              </div>
              <input className="input" style={{ maxWidth: 200, height: 34 }} placeholder="Filter partners" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter interaction partners" />
            </div>
            <ul className="ddi-list">
              {items.slice(0, 80).map((i) => (
                <li key={i.name}>
                  <DrugName name={i.name} />
                  <Sev sev={LEVEL_SEV[i.level] ?? 'minor'} label={i.level} />
                  <Link className="ddi-list__sig" to={`/signals?a=${encodeURIComponent(name)}&b=${encodeURIComponent(i.name.toLowerCase())}`}>Signal →</Link>
                </li>
              ))}
              {items.length > 80 && <li className="muted">+ {items.length - 80} more — use the filter</li>}
              {items.length === 0 && <li className="muted">No partners match.</li>}
            </ul>
          </>
        )}
    </section>
  );
}
