import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  Activity, BookOpen, ClipboardCheck, FlaskConical, Moon, Network, ScrollText, Search, Split, Sun, TriangleAlert, Users,
} from 'lucide-react';
import { api, useHealth } from '../api/client';
import type { Health, SearchHit } from '../api/types';
import { compact, tallMan } from '../lib/format';

const NAV = [
  { to: '/verify', label: 'Order verification', icon: ClipboardCheck, hint: 'CPOE safety check' },
  { to: '/patients', label: 'Patients', icon: Users, hint: 'Saved patient records' },
  { to: '/screen', label: 'Interaction screen', icon: Split, hint: 'Any medication list' },
  { to: '/drugs', label: 'Drug intelligence', icon: BookOpen, hint: 'Labels · reactions' },
  { to: '/signals', label: 'Signal lab', icon: Activity, hint: 'FAERS pair signals' },
  { to: '/audit', label: 'Audit ledger', icon: ScrollText, hint: 'Hash-chained record' },
  { to: '/system', label: 'System', icon: Network, hint: 'Architecture · sources' },
];

export default function Shell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: health } = useHealth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <aside className="rail" aria-label="Main navigation">
        <div className="rail__brand">
          <BrandMark />
          <div>
            <div className="rail__name">Diagnostix</div>
            <div className="rail__sub">Medication safety</div>
          </div>
        </div>
        <nav className="rail__nav">
          {NAV.map(({ to, label, icon: Icon, hint }) => (
            <NavLink key={to} to={to} className="rail__item" title={hint}>
              <Icon aria-hidden="true" />
              <span className="rail__label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <RailFooter health={health} />
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="search-trigger" type="button" onClick={() => setPaletteOpen(true)}>
            <Search aria-hidden="true" />
            <span>Search drugs, brands, pages{health?.rxnormNames ? ` (${compact(health.rxnormNames)} names)` : ''}</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>
          <div className="topbar__right">
            <SourceStrip health={health} />
            <span className="env-chip" title="Training environment — sample patients only">Training</span>
            <ThemeToggle />
            <span className="operator" title="Clinical pharmacist">CP · Stn 04</span>
          </div>
        </header>
        {health?.mode === 'fixtures' && (
          <div className="fixture-banner"><TriangleAlert aria-hidden="true" /> Test fixtures mode. FDA and RxNorm figures are synthetic, not real data.</div>
        )}
        {health?.mode === 'offline' && (
          <div className="fixture-banner fixture-banner--info">Offline mode. Local cache and local databases only.</div>
        )}
        <main className="main" id="main">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="2" fill="#2b3a4d" />
      <path d="M6.5 16.5h5l2.3-6 3.9 12 2.4-6h5.4" fill="none" stroke="#c9d6e6" strokeWidth="2.2" strokeLinejoin="miter" />
    </svg>
  );
}

type Tone = 'ok' | 'warn' | 'crit' | 'idle' | 'busy';

export function sourceStates(h?: Health): { key: string; label: string; tone: Tone; detail: string }[] {
  if (!h) return [];
  const src = (name: string) => h.sources[name];
  const net = (names: string[], label: string) => {
    if (h.mode === 'offline') return { tone: 'warn' as Tone, detail: `${label}: offline mode — cache only` };
    if (h.mode === 'fixtures') return { tone: 'warn' as Tone, detail: `${label}: synthetic test fixtures` };
    const s = names.map(src).filter(Boolean);
    if (!s.length) return { tone: 'idle' as Tone, detail: `${label}: not queried yet` };
    if (s.some((x) => x.circuitOpen)) return { tone: 'crit' as Tone, detail: `${label}: unreachable — serving cached results` };
    if (s.some((x) => x.ok > 0)) return { tone: 'ok' as Tone, detail: `${label}: live${s[0].latencyMs ? ` · ${s[0].latencyMs} ms` : ''}` };
    return { tone: 'crit' as Tone, detail: `${label}: ${s[0].lastError ?? 'failing'}` };
  };
  const fda = net(['openFDA · FAERS', 'openFDA · drug labels'], 'openFDA');
  const rx = net(['NLM · RxNorm'], 'RxNorm');
  if (h.rxnormNames && rx.tone !== 'crit') { rx.tone = 'ok'; rx.detail = `RxNorm: ${h.rxnormNames.toLocaleString()} names indexed`; }
  const ai = h.ai.state === 'ready' ? { tone: 'ok' as Tone, detail: `AI: ${h.ai.model} ready (${h.ai.device})` }
    : h.ai.state === 'loading' ? { tone: 'busy' as Tone, detail: `AI: loading ${h.ai.model}` }
    : h.ai.state === 'disabled' ? { tone: 'idle' as Tone, detail: 'AI: disabled' }
    : { tone: 'crit' as Tone, detail: `AI: ${h.ai.error ?? h.ai.state}` };
  return [
    { key: 'kb', label: 'KB', tone: h.formulary.integrity.ok ? 'ok' : 'crit', detail: `Curated formulary: ${h.formulary.drugs} drugs · ${h.formulary.version}` },
    { key: 'ddi', label: 'DDInter', tone: h.ddinter.available ? 'ok' : 'crit', detail: h.ddinter.available ? `DDInter: ${Number(h.ddinter.pairs).toLocaleString()} interaction records` : 'DDInter: not imported — run the import command' },
    { key: 'fda', label: 'openFDA', ...fda },
    { key: 'rx', label: 'RxNorm', ...rx },
    { key: 'ai', label: 'AI', ...ai },
  ];
}

function SourceStrip({ health }: { health?: Health }) {
  const nav = useNavigate();
  const states = sourceStates(health);
  if (!health) return <span className="source-strip source-strip--down"><span className="dot dot--crit" /> Server unreachable</span>;
  return (
    <button className="source-strip" type="button" onClick={() => nav('/system')} title={states.map((s) => s.detail).join('\n')}>
      {states.map((s) => (
        <span key={s.key} className="source-strip__item">
          <span className={`dot dot--${s.tone === 'idle' ? '' : s.tone === 'busy' ? 'accent dot--pulse' : s.tone}`} />
          {s.label}
        </span>
      ))}
    </button>
  );
}

function RailFooter({ health }: { health?: Health }) {
  return (
    <div className="rail__foot">
      <div className="rail__foot-row"><span>Rules engine</span><span className="mono">v{health?.version ?? '—'}</span></div>
      <div className="rail__foot-row"><span>KB</span><span className="mono">{health?.formulary.version.replace('DX-KB ', '') ?? '—'}</span></div>
      <div className="rail__foot-row"><span>DDInter</span><span className="mono">{health?.ddinter.available ? compact(Number(health.ddinter.pairs)) : '—'}</span></div>
      <div className="rail__disclaimer">Prototype. Not for clinical use.</div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => document.documentElement.dataset.theme ?? null);
  const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dx-theme', next); } catch { /* storage blocked */ }
    setTheme(next);
  };
  return (
    <button className="icon-btn" type="button" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  curated: 'Curated', brand: 'Brand', combination: 'Combination', ddinter: 'DDInter', rxnorm: 'RxNorm',
};

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setQ(''); setHits([]); }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q.trim()).then((r) => setHits(r.results)).catch(() => setHits([])).finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(t);
  }, [q]);

  const go = (path: string) => { onOpenChange(false); nav(path); };

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Search drugs and pages" className="cmdk" shouldFilter={false}>
      <div className="cmdk__input">
        <Search aria-hidden="true" />
        <Command.Input value={q} onValueChange={setQ} placeholder="Drug, brand or page" autoFocus />
        {loading && <span className="spinner" />}
      </div>
      <Command.List className="cmdk__list">
        {q.trim().length >= 2 && !loading && hits.length === 0 && <Command.Empty className="cmdk__empty">No drug matches “{q}”.</Command.Empty>}
        {hits.length > 0 && (
          <Command.Group heading="Drugs">
            {hits.map((h) => (
              <Command.Item key={h.kind + h.name} value={h.kind + h.name} onSelect={() => go(`/drugs/${encodeURIComponent(h.ingredient ?? h.name)}`)} className="cmdk__item">
                <FlaskConical aria-hidden="true" />
                <span className="cmdk__name">{tallMan(h.name)}</span>
                <span className="cmdk__detail">{h.detail}</span>
                <span className={`cmdk__kind cmdk__kind--${h.kind}`}>{KIND_LABEL[h.kind]}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {q.trim().length < 2 && (
          <Command.Group heading="Go to">
            {NAV.map(({ to, label, icon: Icon, hint }) => (
              <Command.Item key={to} value={label} onSelect={() => go(to)} className="cmdk__item">
                <Icon aria-hidden="true" />
                <span className="cmdk__name">{label}</span>
                <span className="cmdk__detail">{hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className="cmdk__foot"><span><kbd className="kbd">↑↓</kbd> move</span><span><kbd className="kbd">Enter</kbd> open</span><span><kbd className="kbd">Esc</kbd> close</span></div>
    </Command.Dialog>
  );
}
