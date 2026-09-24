import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../api/client';
import type { AuditEntry, ChainCheck } from '../api/types';
import { ErrorNote, Loading } from '../components/ui';

const EVENT: Record<string, { label: string; tone: string }> = {
  verification: { label: 'Verification', tone: 'accent' },
  override: { label: 'Override', tone: 'warn' },
  acknowledge: { label: 'Acknowledged', tone: '' },
  'dose-change': { label: 'Dose changed', tone: '' },
  sign: { label: 'Signed', tone: 'ok' },
  'ai-rationale': { label: 'AI rationale', tone: '' },
  'ai-rejected': { label: 'AI rejected', tone: 'warn' },
  'list-screen': { label: 'List screen', tone: '' },
};

function summary(e: AuditEntry): string {
  const pt = e.payload.patientId ? `Pt #${e.payload.patientId} · ` : '';
  return pt + detail(e);
}

function detail(e: AuditEntry): string {
  const p = e.payload;
  switch (e.event) {
    case 'verification': return `${(p.orders ?? []).join('; ')} → ${String(p.status).toUpperCase()}${p.rules?.length ? ` (${p.rules.join(', ')})` : ''}`;
    case 'override': return `${p.rule}${p.lines?.length ? ` (L${p.lines.join(', L')})` : ''}: ${p.reason} — “${p.note}”`;
    case 'sign': return `${(p.orders ?? []).join('; ')}${p.overrides?.length ? ` · ${p.overrides.length} override(s)` : ''}`;
    case 'dose-change': return `${p.rule}: line ${p.line} → ${p.to} mg`;
    case 'ai-rationale': return `${p.rule} · ${p.model} · ${(p.ms / 1000).toFixed(1)} s`;
    case 'ai-rejected': return `${p.rule}: ${p.reason}${p.simulated ? ' (training simulation)' : ''}`;
    case 'list-screen': return `${(p.entries ?? []).join(', ')} · ${p.findings} finding(s)`;
    case 'acknowledge': return String(p.rule);
    default: return JSON.stringify(p);
  }
}

export default function AuditPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['audit'], queryFn: api.audit, refetchInterval: 8000 });
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const verify = useMutation({ mutationFn: api.auditVerify, onSuccess: setCheck });
  const tamper = useMutation({ mutationFn: api.auditTamper, onSuccess: () => { setCheck(null); qc.invalidateQueries({ queryKey: ['audit'] }); } });
  const entries = list.data?.entries ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit ledger</h1>
          <p>SHA-256 hash chain. Altering any entry invalidates every entry after it.</p>
        </div>
        <div className="row">
          <button className="btn btn--danger" type="button" onClick={() => tamper.mutate()} disabled={!entries.length || tamper.isPending}
                  title="Training only: edits the oldest record directly in the database"><TriangleAlert />Simulate tampering</button>
          <button className="btn btn--primary" type="button" onClick={() => verify.mutate()} disabled={verify.isPending}><Fingerprint />Verify chain</button>
        </div>
      </div>

      {check && (
        <div className={`chain-result ${check.ok ? 'chain-result--ok' : 'chain-result--bad'}`} role="status">
          {check.ok ? <ShieldCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          <div><strong>{check.ok ? 'Chain intact' : `Tampering detected at entry #${check.brokenAt}`}</strong><span>{check.detail}</span>
            {check.head && <span className="mono">Head {check.head.slice(0, 24)}…</span>}</div>
        </div>
      )}

      <section className="panel panel--flush">
        <header className="panel__head"><h2 className="panel__title">Ledger</h2><span className="panel__meta">{entries.length} entries · newest first</span></header>
        {list.isLoading ? <div className="panel__body"><Loading label="Loading" /></div> : list.error ? <div className="panel__body"><ErrorNote error={list.error} /></div> : !entries.length ? (
          <div className="empty">No entries.</div>
        ) : (
          <div className="table-wrap">
            <table className="table ledger">
              <thead><tr><th className="r">#</th><th>Time</th><th>Event</th><th>Reference</th><th>Detail</th><th>Hash · previous</th></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const ev = EVENT[e.event] ?? { label: e.event, tone: '' };
                  const broken = check && !check.ok && check.brokenAt === e.seq;
                  return (
                    <tr key={e.seq} className={broken ? 'is-broken' : ''}>
                      <td className="r mono">{e.seq}</td>
                      <td className="mono nowrap">{new Date(e.at * 1000).toLocaleTimeString('en-GB')}</td>
                      <td><span className={`badge ${ev.tone ? `badge--${ev.tone}` : ''}`}>{ev.label}</span></td>
                      <td className="mono nowrap">{e.ref || '—'}</td>
                      <td className="ledger__detail">{summary(e)}</td>
                      <td className="mono ledger__hash"><span>{e.hash.slice(0, 12)}</span><span className="muted">← {e.prev.slice(0, 12)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
