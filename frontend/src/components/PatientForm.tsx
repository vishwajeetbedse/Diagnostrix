import { useState } from 'react';
import type { PatientInput } from '../api/types';
import { ErrorNote } from './ui';

type Draft = Record<keyof PatientInput, string>;

const toDraft = (p?: Partial<PatientInput>): Draft => ({
  name: p?.name ?? '', mrn: p?.mrn ?? '', sex: p?.sex ?? '',
  age: p?.age?.toString() ?? '', weight: p?.weight?.toString() ?? '', height: p?.height?.toString() ?? '', scr: p?.scr?.toString() ?? '',
});

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Create / edit form for a patient record. Used by the Patients page and inline on Order verification. */
export default function PatientForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Partial<PatientInput>; submitLabel: string;
  onSubmit: (p: PatientInput) => Promise<unknown>; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await onSubmit({
        name: d.name.trim(), mrn: d.mrn.trim() || null, sex: (d.sex || null) as PatientInput['sex'],
        age: num(d.age), weight: num(d.weight), height: num(d.height), scr: num(d.scr),
      });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const field = (k: keyof Draft, label: string, unit?: string, step = '0.1') => (
    <div className="field">
      <label htmlFor={`pf-${k}`}>{label}{unit && <span className="muted"> ({unit})</span>}</label>
      <input id={`pf-${k}`} className="input input--num" type="number" min="0" step={step} value={d[k]} onChange={set(k)} />
    </div>
  );

  return (
    <form className="patient-form" onSubmit={submit}>
      <div className="field patient-form__name">
        <label htmlFor="pf-name">Name (Last, First)</label>
        <input id="pf-name" className="input" required autoFocus maxLength={120} value={d.name} onChange={set('name')} />
      </div>
      <div className="field">
        <label htmlFor="pf-mrn">MRN</label>
        <input id="pf-mrn" className="input input--num" maxLength={40} value={d.mrn} onChange={set('mrn')} />
      </div>
      {field('age', 'Age', 'y')}
      <div className="field">
        <label htmlFor="pf-sex">Sex</label>
        <select id="pf-sex" className="select" value={d.sex} onChange={set('sex')}>
          <option value="">—</option><option value="F">Female</option><option value="M">Male</option>
        </select>
      </div>
      {field('weight', 'Weight', 'kg')}
      {field('height', 'Height', 'cm', '0.5')}
      {field('scr', 'SCr', 'mg/dL', '0.01')}
      <div className="patient-form__actions">
        <button className="btn btn--primary btn--sm" type="submit" disabled={busy || !d.name.trim()}>{submitLabel}</button>
        <button className="btn btn--sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error != null && <div className="patient-form__error"><ErrorNote error={error} /></div>}
    </form>
  );
}
