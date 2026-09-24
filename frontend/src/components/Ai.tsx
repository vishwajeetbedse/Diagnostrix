import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { GroundingReport } from '../api/types';

/** "Qwen/Qwen2.5-1.5B-Instruct" → "Qwen2.5-1.5B-Instruct". */
export const shortModel = (id?: string | null) => (id ?? '').split('/').pop() || 'local model';

/**
 * Says which path produced the text on screen. `ai` only when the grounding
 * check accepted model output; `kb` for the deterministic template, with the
 * reason the AI text is not shown (off, loading, unavailable, rejected).
 */
export function AiTag({ kind, model, ms, note }: { kind: 'ai' | 'kb'; model?: string; ms?: number; note?: ReactNode }) {
  return kind === 'ai'
    ? <span className="ai-tag ai-tag--ai">AI-generated · {shortModel(model)}{ms != null && <> · {(ms / 1000).toFixed(1)} s</>}</span>
    : <span className="ai-tag">Knowledge-base text{note && <span className="ai-tag__note"> · {note}</span>}</span>;
}

/** Live indicator while a local-model call is in flight; the counter shows inference is actually running. */
export function AiPending({ model, what = 'Asking local AI model' }: { model?: string; what?: string }) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(id); }, []);
  return (
    <span className="ai-pending" role="status">
      <span className="spinner" />{what} · {shortModel(model)} · <span className="mono">{((now - t0) / 1000).toFixed(1)} s</span>
    </span>
  );
}

const NUM = /(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?/g;
const norm = (t: string) => { const v = Number(t.replace(/,/g, '').replace(/\.$/, '')); return Number.isFinite(v) ? String(v) : t; };

/** Text with every figure marked as found in the facts (grounded) or not. */
export function FigureText({ text, ungrounded }: { text: string; ungrounded: string[] }) {
  const bad = new Set(ungrounded);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM)) {
    const tok = m[0].replace(/,$/, '');
    out.push(text.slice(last, m.index), <mark key={m.index} className={bad.has(norm(tok)) ? 'fig fig--bad' : 'fig fig--ok'}>{tok}</mark>);
    last = m.index! + tok.length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}

/** Pass/fail badge plus one chip per figure checked. */
export function GroundingResult({ report, accepted, reason }: { report: GroundingReport; accepted: boolean; reason?: string }) {
  return (
    <div className="grounding">
      <div className="row">
        <span className={`gbadge ${accepted ? 'gbadge--pass' : 'gbadge--fail'}`}>{accepted ? 'Grounding check: PASS' : 'Grounding check: FAIL'}</span>
        <span className="muted">{accepted ? 'Every figure appears in the verified facts; text accepted.' : `${reason ?? 'Rejected.'} Text discarded; knowledge-base text shown.`}</span>
      </div>
      <div className="figs">
        <span className="muted">{report.figures.length} figure{report.figures.length === 1 ? '' : 's'} in output · {report.factFigures} in facts:</span>
        {report.figures.length === 0 && <span className="muted">none</span>}
        {report.figures.map((f) => (
          <span key={f.value} className={`fchip ${f.grounded ? 'fchip--ok' : 'fchip--bad'}`}>{f.value} {f.grounded ? '✓ in facts' : '✕ not in facts'}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * "Show AI safety check": the exact input the model was given, what it returned,
 * and the grounding verdict. Collapsed by default so the rationale stays primary.
 */
export function SafetyCheck({ prompt, output, report, accepted, reason, note, open }: {
  prompt: string; output: string; report: GroundingReport; accepted: boolean; reason?: string; note?: ReactNode; open?: boolean;
}) {
  return (
    <details className="ai-check" open={open}>
      <summary>Show AI safety check <span className={`gbadge gbadge--sm ${accepted ? 'gbadge--pass' : 'gbadge--fail'}`}>{accepted ? 'PASS' : 'FAIL'}</span></summary>
      <div className="ai-check__body">
        {note && <p className="ai-check__note">{note}</p>}
        <div className="ai-check__cols">
          <div><h4 className="eyebrow">Verified facts given to the model</h4><pre className="ai-check__pre">{prompt}</pre></div>
          <div><h4 className="eyebrow">Model output (figures marked)</h4><p className="ai-check__out"><FigureText text={output} ungrounded={report.ungrounded} /></p></div>
        </div>
        <GroundingResult report={report} accepted={accepted} reason={reason} />
      </div>
    </details>
  );
}
