import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PatientRecord } from '../api/types';
import { ageText } from '../lib/format';
import { useDebounced } from './ui';

/** Search saved patients by name or MRN; last option creates a new record. */
export default function PatientPicker({ onPick, onNew }: { onPick: (p: PatientRecord) => void; onNew: () => void }) {
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 150);
  const { data } = useQuery({ queryKey: ['patients', dq], queryFn: () => api.patients(dq), enabled: open });
  const hits = (data?.patients ?? []).slice(0, 8);
  const count = hits.length + 1; // + "New patient"

  const choose = (i: number) => {
    setOpen(false); setQ('');
    if (i < hits.length) onPick(hits[i]); else onNew();
  };

  return (
    <div className="combo patient-picker">
      <input
        className="input" value={q} placeholder="Find patient — name or MRN" aria-label="Find patient"
        role="combobox" aria-expanded={open} aria-controls={listId} autoComplete="off" spellCheck={false}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(count - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && open) { e.preventDefault(); choose(active); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="combo__list" id={listId} role="listbox">
          {hits.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              <span className="combo__name">{p.name}</span>
              <span className="combo__detail mono">{ageText(p.age)} {p.sex ?? ''}{p.weight != null ? ` · ${p.weight} kg` : ''}</span>
              <span className="combo__kind mono">{p.mrn ?? 'no MRN'}</span>
            </li>
          ))}
          {data && !hits.length && <li className="combo__empty" aria-disabled="true">{dq ? 'No match' : 'No saved patients'}</li>}
          <li role="option" aria-selected={active === hits.length} onMouseDown={(e) => { e.preventDefault(); choose(hits.length); }} onMouseEnter={() => setActive(hits.length)}>
            <span className="combo__name">New patient…</span><span className="combo__detail">From current parameters</span><span />
          </li>
        </ul>
      )}
    </div>
  );
}
