import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { useFormulary, useHealth } from '../api/client';
import { compact, fmt } from '../lib/format';
import DrugInput from '../components/DrugInput';
import { DrugName, Loading, Sev } from '../components/ui';

const EXAMPLES = ['metformin', 'atorvastatin', 'sertraline', 'amoxicillin', 'omeprazole', 'levothyroxine'];

export default function DrugIndexPage() {
  const nav = useNavigate();
  const { data: kb } = useFormulary();
  const { data: health } = useHealth();
  const [q, setQ] = useState('');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Drug lookup</h1>
          <p>FDA labelling, FAERS reports and interaction partners for
            {health?.rxnormNames ? ` ${compact(health.rxnormNames)} RxNorm names` : ' any RxNorm name'}
            {health?.ddinter.available ? ` and ${compact(Number(health.ddinter.drugs))} DDInter drugs` : ''}.</p>
        </div>
      </div>

      <form className="lookup" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/drugs/${encodeURIComponent(q.trim().toLowerCase())}`); }}>
        <DrugInput value={q} onChange={setQ} placeholder="Generic or brand name, e.g. Tylenol, pantoprazole" ariaLabel="Drug name" />
        <button className="btn btn--primary" type="submit" disabled={!q.trim()}><BookOpen />Open profile</button>
      </form>
      <div className="row"><span className="muted">Try</span>{EXAMPLES.map((e) => <button key={e} className="chip" type="button" onClick={() => nav(`/drugs/${e}`)}>{e}</button>)}</div>

      <section className="panel">
        <header className="panel__head">
          <h2 className="panel__title">Curated formulary</h2>
          <span className="panel__meta">{kb ? `${kb.version} · ${kb.integrity.ok ? 'integrity check passed' : `${kb.integrity.issues.length} issues`}` : ''}</span>
        </header>
        {!kb ? <div className="panel__body"><Loading label="Loading" /></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Medication</th><th>Class</th><th className="r">Adult max mg/day</th><th className="r">Pediatric max mg/kg/day</th><th>Min age</th><th>Contraindicated with</th><th /></tr></thead>
              <tbody>
                {kb.drugs.map((d) => (
                  <tr key={d.id}>
                    <td><DrugName name={d.name} /><div className="muted" style={{ fontSize: 12 }}>{(d.brands ?? []).slice(0, 3).join(', ')}</div></td>
                    <td>{d.cls}</td>
                    <td className="r mono">{fmt(d.adultMaxDaily)}</td>
                    <td className="r mono">{fmt(d.pedsMaxMgPerKgDay)}</td>
                    <td className="mono">{d.minAgeYears != null ? `${d.minAgeYears} y` : '—'}</td>
                    <td>{d.contraindicatedWith.length ? <div className="row" style={{ gap: 6 }}>{d.contraindicatedWith.map((c) => <span key={c} className="badge badge--crit">{kb.drugs.find((x) => x.id === c)?.name}</span>)}</div> : <Sev sev="none" label="None" />}</td>
                    <td><button className="btn btn--ghost btn--sm" type="button" onClick={() => nav(`/drugs/${d.id}`)} aria-label={`Open ${d.name}`}><ArrowRight /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">Demonstration limits. The pharmacy team must validate every value against institutional references before clinical use.</p>
    </div>
  );
}
