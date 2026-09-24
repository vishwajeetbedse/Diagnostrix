import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeftRight } from 'lucide-react';
import DrugInput from '../components/DrugInput';
import { GlobalNote, PairEvidence, SignalView } from '../components/Evidence';
import { Tabs } from '../components/ui';
import { tallMan } from '../lib/format';

const PRESETS = [['warfarin', 'amiodarone'], ['tramadol', 'linezolid'], ['simvastatin', 'clarithromycin'], ['lithium carbonate', 'ibuprofen']];

export default function SignalsPage() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const [da, setDa] = useState(a || 'warfarin');
  const [db, setDb] = useState(b || 'amiodarone');
  const [tab, setTab] = useState<'signal' | 'sources'>('signal');
  const run = (x = da, y = db) => { setDa(x); setDb(y); setParams({ a: x.trim().toLowerCase(), b: y.trim().toLowerCase() }); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>FAERS signal analysis</h1>
          <p>Reporting odds ratio per reaction: drug pair and each drug alone versus all other FAERS reports.</p>
        </div>
      </div>

      <section className="panel">
        <form className="panel__body signal-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <div className="field"><label htmlFor="sa">Drug A</label><DrugInput id="sa" value={da} onChange={setDa} /></div>
          <button className="icon-btn signal-form__swap" type="button" onClick={() => { setDa(db); setDb(da); }} aria-label="Swap drugs"><ArrowLeftRight /></button>
          <div className="field"><label htmlFor="sb">Drug B</label><DrugInput id="sb" value={db} onChange={setDb} /></div>
          <button className="btn btn--primary" type="submit" disabled={!da.trim() || !db.trim()}><Activity />Analyse</button>
        </form>
        <div className="row presets"><span className="muted">Examples</span>
          {PRESETS.map(([x, y]) => <button key={x + y} type="button" className="chip" onClick={() => run(x, y)}>{tallMan(x)} + {tallMan(y)}</button>)}
        </div>
      </section>

      {a && b ? (
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">{tallMan(a)} + {tallMan(b)}</h2></header>
          <Tabs label="Analysis" value={tab} onChange={setTab} tabs={[{ id: 'signal', label: 'FAERS disproportionality' }, { id: 'sources', label: 'Label and database evidence' }]} />
          <div className="panel__body">{tab === 'signal' ? <SignalView key={a + b} a={a} b={b} /> : <PairEvidence key={a + b} a={a} b={b} />}</div>
        </section>
      ) : <div className="empty">Select two drugs.</div>}

      <section className="panel">
        <header className="panel__head"><h2 className="panel__title">Method</h2></header>
        <div className="panel__body method">
          <table className="twobytwo mono" aria-label="Two-by-two contingency table">
            <thead><tr><th /><th>Reaction R</th><th>Other reactions</th></tr></thead>
            <tbody>
              <tr><th>Reports with the drug(s)</th><td>a</td><td>b</td></tr>
              <tr><th>All other reports</th><td>c</td><td>d</td></tr>
            </tbody>
          </table>
          <div className="stack">
            <p><strong>Reporting odds ratio</strong> ROR = (a / b) ÷ (c / d), with a 95% confidence interval of exp(ln ROR ± 1.96 √(1/a + 1/b + 1/c + 1/d)).</p>
            <p>A <strong>signal</strong> is flagged when at least 3 reports exist and the lower bound of the interval is above 1. Comparing the pair against each drug alone shows whether the combination adds risk beyond either agent.</p>
            <p className="muted">FAERS is a spontaneous reporting system: counts reflect what was reported, not how often reactions occur, and a signal is a hypothesis for review — not proof of causation.</p>
            <GlobalNote />
          </div>
        </div>
      </section>
    </div>
  );
}
