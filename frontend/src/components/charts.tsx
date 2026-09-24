import { useMemo, useState } from 'react';
import type { SignalRow } from '../api/types';
import { compact, fmt, reactionText } from '../lib/format';
import { useWidth } from './ui';

/* ------------------------------------------------------------ BarList
   Single-series horizontal bars (magnitude). One hue, value at the tip,
   per-row hover detail. */
export function BarList({ rows, total, unit = 'reports', label }: {
  rows: { key: string; label: string; value: number }[]; total?: number; unit?: string; label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="barlist" role="list" aria-label={label}>
      {rows.map((r) => (
        <div key={r.key} className={`barlist__row ${hover === r.key ? 'is-hover' : ''}`} role="listitem"
             onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
          <span className="barlist__label" title={r.label}>{r.label}</span>
          <span className="barlist__track">
            <span className="barlist__bar" style={{ width: `calc((100% - 56px) * ${Math.max(0.015, r.value / max).toFixed(4)})` }} />
            <span className="barlist__value mono">{compact(r.value)}</span>
          </span>
          {hover === r.key && (
            <span className="chart-tip barlist__tip" role="tooltip">
              <strong>{r.label}</strong>
              <span className="mono">{fmt(r.value, 0)} {unit}</span>
              {total ? <span>{((r.value / total) * 100).toFixed(1)}% of reports</span> : null}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- YearTrend
   Single series over time: 2px line, 10% wash, end dot, crosshair tooltip. */
export function YearTrend({ data, label }: { data: { year: number; count: number }[]; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 168, padL = 44, padR = 16, padT = 12, padB = 26;
  const pts = useMemo(() => {
    if (!data.length || !w) return [];
    const maxY = niceMax(Math.max(...data.map((d) => d.count)));
    const x0 = data[0].year, x1 = data[data.length - 1].year;
    const sx = (y: number) => padL + ((y - x0) / Math.max(1, x1 - x0)) * (w - padL - padR);
    const sy = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
    return data.map((d) => ({ ...d, x: sx(d.year), y: sy(d.count), maxY, sy }));
  }, [data, w]);
  if (!data.length) return <div className="empty">No reports by year.</div>;

  const maxY = pts[0]?.maxY ?? 1;
  const sy = pts[0]?.sy ?? (() => 0);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const area = pts.length ? `${line}L${pts[pts.length - 1].x},${H - padB}L${pts[0].x},${H - padB}Z` : '';
  const ticks = [0, maxY / 2, maxY];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor((w - padL) / 56)));
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="trend" ref={ref}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={label}
             onMouseMove={(e) => {
               const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
               let best = 0; pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i; });
               setHover(best);
             }}
             onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={sy(t)} y2={sy(t)} className="grid-line" />
              <text x={padL - 8} y={sy(t) + 4} textAnchor="end" className="axis-text">{compact(t)}</text>
            </g>
          ))}
          <path d={area} className="trend__area" />
          <path d={line} className="trend__line" />
          {pts.map((p, i) => (i % labelEvery === 0 || i === pts.length - 1) && (
            <text key={p.year} x={p.x} y={H - 8} textAnchor="middle" className="axis-text">{p.year}</text>
          ))}
          {pts.length > 0 && <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4.5} className="trend__dot" />}
          {hp && (
            <g>
              <line x1={hp.x} x2={hp.x} y1={padT} y2={H - padB} className="crosshair" />
              <circle cx={hp.x} cy={hp.y} r={4.5} className="trend__dot" />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div className="chart-tip trend__tip" style={{ left: Math.min(Math.max(hp.x, 70), w - 70), top: Math.max(0, hp.y - 58) }} role="tooltip">
          <strong>{hp.year}</strong><span className="mono">{fmt(hp.count, 0)} reports</span>
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* --------------------------------------------------------- ForestPlot
   Reporting odds ratios on a log axis for three series: drug A alone,
   drug B alone and the pair. Identity = colour + marker shape + legend. */
export function ForestPlot({ rows, aName, bName }: { rows: SignalRow[]; aName: string; bName: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = Math.min(210, Math.max(120, w * 0.3));
  const rowH = 40, padT = 8, axisH = 34;
  const H = padT + rows.length * rowH + axisH;
  const values = rows.flatMap((r) => [r.pair, r.a, r.b].filter(Boolean).flatMap((x) => [x!.lo, x!.hi]));
  const lo = Math.min(0.5, ...values.filter((v) => v > 0));
  const hi = Math.max(4, ...values);
  const lmin = Math.log10(Math.max(0.05, lo)), lmax = Math.log10(Math.min(1000, hi));
  const x0 = labelW + 8, x1 = w - 16;
  const sx = (v: number) => x0 + ((Math.log10(Math.min(Math.max(v, 10 ** lmin), 10 ** lmax)) - lmin) / (lmax - lmin)) * (x1 - x0);
  const ticks = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500].filter((t) => Math.log10(t) >= lmin - 1e-9 && Math.log10(t) <= lmax + 1e-9);
  const series = [
    { key: 'a' as const, name: aName, cls: 's1', dy: -10, shape: 'circle' },
    { key: 'b' as const, name: bName, cls: 's2', dy: 0, shape: 'square' },
    { key: 'pair' as const, name: `${aName} + ${bName}`, cls: 's3', dy: 10, shape: 'diamond' },
  ];

  return (
    <div className="forest" ref={ref}>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key} className="legend__item"><svg width="14" height="14" aria-hidden="true"><Marker shape={s.shape} x={7} y={7} cls={s.cls} /></svg>{s.name}</span>
        ))}
        <span className="legend__item legend__item--ref"><span className="legend__ref" />ROR = 1 (no disproportion)</span>
      </div>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Reporting odds ratios for ${aName}, ${bName} and the combination`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={padT} y2={H - axisH + 4} className={t === 1 ? 'ref-line' : 'grid-line'} />
              <text x={sx(t)} y={H - axisH + 20} textAnchor="middle" className="axis-text">{t}</text>
            </g>
          ))}
          <text x={x1} y={H - 2} textAnchor="end" className="axis-text axis-text--title">Reporting odds ratio (log scale) →</text>
          {rows.map((r, i) => {
            const cy = padT + i * rowH + rowH / 2;
            return (
              <g key={r.reaction} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={cy - rowH / 2} width={w} height={rowH} className={`forest__hit ${hover === i ? 'is-hover' : ''}`} />
                <text x={labelW} y={cy + 4} textAnchor="end" className={`forest__label ${r.pair?.signal ? 'is-signal' : ''}`}>
                  {truncate(reactionText(r.reaction), Math.floor(labelW / 7))}
                </text>
                {series.map((s) => {
                  const v = r[s.key];
                  if (!v) return null;
                  return (
                    <g key={s.key}>
                      <line x1={sx(v.lo)} x2={sx(v.hi)} y1={cy + s.dy} y2={cy + s.dy} className={`whisker ${s.cls}`} />
                      <Marker shape={s.shape} x={sx(v.ror)} y={cy + s.dy} cls={s.cls} ring />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && rows[hover] && (
        <div className="chart-tip forest__tip" style={{ top: padT + hover * rowH + rowH + 34 }} role="tooltip">
          <strong>{reactionText(rows[hover].reaction)}</strong>
          {series.map((s) => {
            const v = rows[hover][s.key];
            return <span key={s.key} className="mono">{s.name}: {v ? `${v.ror} (${v.lo}–${v.hi}) · ${fmt(v.n, 0)} reports` : 'too few reports'}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function Marker({ shape, x, y, cls, ring }: { shape: string; x: number; y: number; cls: string; ring?: boolean }) {
  const c = `marker ${cls} ${ring ? 'marker--ring' : ''}`;
  if (shape === 'square') return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} className={c} />;
  if (shape === 'diamond') return <path d={`M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z`} className={c} />;
  return <circle cx={x} cy={y} r={4.8} className={c} />;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
