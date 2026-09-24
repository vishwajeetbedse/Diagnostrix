/**
 * Diagnostix CDSS — client for the local AI backend (server/app.py)
 * ------------------------------------------------------------------
 * Every call degrades gracefully: when the page is opened directly from
 * disk, or the server/model is unavailable, the app keeps working with
 * knowledge-base text only.
 *
 * To point the page at a backend on another host, set before this script:
 *   <script>window.DX_API_BASE = 'http://localhost:8000'</script>
 */
(function (root) {
  'use strict';

  const httpPage = /^https?:$/.test(root.location ? root.location.protocol : '');
  const base = root.DX_API_BASE != null ? String(root.DX_API_BASE).replace(/\/$/, '') : httpPage ? '' : null;

  // state: unavailable | checking | offline | loading | ready | error | disabled
  const status = { state: base === null ? 'unavailable' : 'checking', model: null, device: null, error: null };
  const listeners = new Set();
  let timer = null;

  function notify() { listeners.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } }); }

  async function request(path, { method = 'GET', body, timeoutMs = 10000 } = {}) {
    if (base === null) throw new Error('AI backend not connected');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* not our API */ }
      if (!res.ok || !data) {
        const err = new Error((data && data.error) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The model took too long to respond');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  async function health() {
    if (base === null) return status;
    const before = status.state;
    try {
      const d = await request('/api/health', { timeoutMs: 4000 });
      Object.assign(status, { state: d.state, model: d.model, device: d.device, error: d.error });
    } catch (_) {
      Object.assign(status, { state: 'offline', error: null });
    }
    if (status.state !== before || before === 'checking') notify();
    return status;
  }

  function schedule() {
    clearTimeout(timer);
    if (base === null) return;
    const wait = { loading: 4000, checking: 2000, offline: 15000 }[status.state] || 30000;
    timer = setTimeout(async () => { await health(); schedule(); }, wait);
  }

  const api = {
    status,
    onChange(fn) { listeners.add(fn); },
    async start() { await health(); schedule(); notify(); },
    explain(facts) { return request('/api/explain', { method: 'POST', body: { facts }, timeoutMs: 180000 }); },
    check(payload) { return request('/api/check', { method: 'POST', body: payload, timeoutMs: 240000 }); },
    label() {
      const m = status.model || 'model';
      return {
        unavailable: 'AI model: not connected — run python server/app.py',
        checking: 'AI model: connecting…',
        offline: 'AI model: offline',
        loading: `AI model: loading ${m}…`,
        ready: `AI model: ${m} · ready${status.device ? ` (${status.device})` : ''}`,
        error: 'AI model: failed to load — see server console',
        disabled: 'AI model: disabled (DX_LLM=off)'
      }[status.state] || 'AI model: unknown';
    }
  };

  root.DX = root.DX || {};
  root.DX.ai = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
