import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SearchHit } from '../api/types';
import { tallMan } from '../lib/format';

const KIND: Record<SearchHit['kind'], string> = { curated: 'Curated', brand: 'Brand', combination: 'Combo', ddinter: 'DDInter', rxnorm: 'RxNorm' };

/** Free-text drug entry with suggestions from the curated list, DDInter and RxNorm. */
export default function DrugInput({ id, value, onChange, placeholder, ariaLabel }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api.search(value.trim()).then((r) => { setHits(r.results.slice(0, 8)); setActive(0); }).catch(() => setHits([])), 120);
    return () => clearTimeout(t);
  }, [value]);

  const pick = (h: SearchHit) => { typed.current = false; onChange(h.name); setOpen(false); setHits([]); };

  return (
    <div className="combo">
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => { typed.current = true; onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && open) { e.preventDefault(); pick(hits[active]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul className="combo__list" id={listId} role="listbox">
          {hits.map((h, i) => (
            <li key={h.kind + h.name} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}>
              <span className="combo__name">{tallMan(h.name)}</span>
              <span className="combo__detail">{h.detail}</span>
              <span className={`combo__kind combo__kind--${h.kind}`}>{KIND[h.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
