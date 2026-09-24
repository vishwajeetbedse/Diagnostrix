import { useQuery } from '@tanstack/react-query';
import type {
  AuditEntry, ChainCheck, DrugProfile, ExplainResult, GroundingCheck, Faers, Formulary, Health, OrderInput, PairEvidence, Patient, PatientInput, PatientRecord,
  ScreenResult, SearchHit, Signal, VerifyResult, Resolution,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 30000);
  try {
    const res = await fetch(`/api/v1${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: init?.signal ?? ctrl.signal,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) && detail[0]?.msg ? `${detail[0].loc?.slice(-1)[0] ?? 'input'}: ${detail[0].msg}` : `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    return data as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ApiError('The server took too long to respond', 0);
    if (e instanceof ApiError) throw e;
    throw new ApiError('Cannot reach the Diagnostix server — is it running?', 0);
  } finally {
    clearTimeout(timer);
  }
}

const post = <T,>(path: string, body: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs });

export const api = {
  health: () => request<Health>('/system/health'),
  formulary: () => request<Formulary>('/formulary'),
  search: (q: string) => request<{ results: SearchHit[] }>(`/drugs/search?q=${encodeURIComponent(q)}`),
  resolve: (q: string) => request<Resolution>(`/drugs/resolve?q=${encodeURIComponent(q)}`),
  profile: (name: string) => request<DrugProfile>(`/drugs/${encodeURIComponent(name)}/profile`, { timeoutMs: 45000 }),
  faers: (name: string) => request<Faers>(`/drugs/${encodeURIComponent(name)}/faers`, { timeoutMs: 60000 }),
  verify: (patient: Patient, orders: OrderInput[], record = false, patientId: number | null = null) =>
    post<VerifyResult>('/verify', { patient, orders, record, patientId }),
  patients: (q = '') => request<{ patients: PatientRecord[] }>(`/patients?q=${encodeURIComponent(q)}`),
  patient: (id: number) => request<PatientRecord>(`/patients/${id}`),
  patientCreate: (p: Partial<PatientInput> & { name: string }) => post<PatientRecord>('/patients', p),
  patientUpdate: (id: number, p: Partial<PatientInput>) =>
    request<PatientRecord>(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  patientDelete: (id: number) => request<null>(`/patients/${id}`, { method: 'DELETE' }),
  pair: (a: string, b: string) => request<PairEvidence>(`/evidence/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { timeoutMs: 45000 }),
  signal: (a: string, b: string) => request<Signal>(`/signals/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { timeoutMs: 90000 }),
  screen: (entries: string[]) => post<ScreenResult>('/screen', { entries }, 60000),
  audit: () => request<{ entries: AuditEntry[] }>('/audit'),
  auditAppend: (event: string, ref: string, payload: Record<string, unknown>) => post<AuditEntry>('/audit', { event, ref, payload }),
  auditVerify: () => request<ChainCheck>('/audit/verify'),
  auditTamper: () => post<{ ok: boolean; seq?: number }>('/audit/tamper-demo', {}),
  explain: (facts: Record<string, unknown>) => post<ExplainResult>('/ai/explain', { facts }, 180000),
  groundingCheck: (facts: Record<string, unknown>, output: string, inject = false) =>
    post<GroundingCheck>('/ai/grounding-check', { facts, output, inject }),
  aiScreen: (body: Record<string, unknown>) => post<{ lines: string[]; model: string; latencyMs: number }>('/ai/screen', body, 240000),
};

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.data?.ai.state === 'loading' ? 4000 : 20000),
    retry: false,
  });
}

export function useFormulary() {
  return useQuery({ queryKey: ['formulary'], queryFn: api.formulary, staleTime: Infinity });
}
