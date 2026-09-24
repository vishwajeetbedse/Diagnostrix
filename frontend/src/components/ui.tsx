import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Clock, Database, Info, OctagonAlert, TriangleAlert, WifiOff } from 'lucide-react';
import type { Provenance } from '../api/types';
import { ago, tallMan } from '../lib/format';

export type SevKey = 'contraindicated' | 'critical' | 'major' | 'moderate' | 'advisory' | 'minor' | 'none' | 'pass';

const SEV_LABEL: Record<SevKey, string> = {
  contraindicated: 'Contraindicated', critical: 'Critical', major: 'Major', moderate: 'Moderate',
  advisory: 'Advisory', minor: 'Minor', none: 'No interaction', pass: 'Pass',
};

export function SevIcon({ sev }: { sev: SevKey }) {
  if (sev === 'contraindicated') return <OctagonAlert aria-hidden="true" />;
  if (sev === 'critical' || sev === 'major') return <TriangleAlert aria-hidden="true" />;
  if (sev === 'moderate' || sev === 'advisory') return <CircleAlert aria-hidden="true" />;
  if (sev === 'minor') return <Info aria-hidden="true" />;
  return <CircleCheck aria-hidden="true" />;
}

export function Sev({ sev, label }: { sev: SevKey; label?: string }) {
  return <span className={`sev sev--${sev}`}><SevIcon sev={sev} />{label ?? SEV_LABEL[sev]}</span>;
}

export function DrugName({ name, link = true, className }: { name: string; link?: boolean; className?: string }) {
  const text = tallMan(name);
  if (!link) return <span className={className}>{text}</span>;
  return <Link className={`druglink ${className ?? ''}`} to={`/drugs/${encodeURIComponent(name.toLowerCase())}`}>{text}</Link>;
}

export function ProvenanceTag({ p, label }: { p?: Provenance | null; label?: string }) {
  if (!p) return null;
  return (
    <span className={`prov ${p.stale ? 'prov--stale' : ''}`} title={p.url}>
      {p.stale ? <WifiOff aria-hidden="true" /> : p.cached ? <Database aria-hidden="true" /> : <Clock aria-hidden="true" />}
      {label ?? p.source} · {p.stale ? 'offline, cached ' : p.cached ? 'cached ' : 'live '}{ago(p.fetchedAt)}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'crit' | 'warn' | 'ok' }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: ReactNode; count?: number | string; icon?: ReactNode; hidden?: boolean }[];
  value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.icon}{t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ error, children }: { error?: unknown; children?: ReactNode }) {
  const msg = children ?? (error instanceof Error ? error.message : String(error ?? 'Something went wrong'));
  return <div className="callout callout--warn"><TriangleAlert aria-hidden="true" /><div>{msg}</div></div>;
}

export function Loading({ label }: { label: string }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

/** Highlight the matched term inside a label sentence. */
export function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
