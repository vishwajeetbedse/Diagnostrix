/**
 * Diagnostix CDSS — Medication list screen (deterministic part)
 * ------------------------------------------------------------------
 * Resolves free-text entries ("Dolo 650", "Combiflam", "warfarin 5 mg")
 * to knowledge-base agents, then screens every pair for:
 *   - severe drug–drug contraindications (knowledge base)
 *   - duplicate active ingredients across products (e.g. two acetaminophen sources)
 * Entries that cannot be resolved are handed to the AI screen, whose answer
 * is shown separately and labelled as unverified.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const F = isNode ? require('./formulary.js') : root.DX.formulary;

  const FORM_WORDS = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|susp|suspension|drops|inj|injection|oral|po|iv)\b/g;

  /** "Dolo-650 Tablet" → "dolo" ; "Warfarin 5 mg" → "warfarin" */
  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[®™]/g, '')
      .replace(/(\d)\s*-\s*/g, '$1 ')
      .replace(/-/g, ' ')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|%)?(?=\s|$|\/)/g, ' ')
      .replace(/\/\s*\d+.*$/, ' ')
      .replace(FORM_WORDS, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // name / alternative name / brand / combination → ingredient ids
  const INDEX = new Map();
  function addKey(key, ids, via) {
    const k = normalise(key);
    if (k && !INDEX.has(k)) INDEX.set(k, { ids, via });
  }
  F.DRUGS.forEach((d) => {
    addKey(d.id, [d.id], 'generic');
    addKey(d.name, [d.id], 'generic');
    addKey(d.name.split(' ')[0], [d.id], 'generic'); // "Lithium carbonate" → "lithium"
    addKey(d.aka, [d.id], d.aka.toLowerCase() === d.name.toLowerCase() ? 'generic' : 'alias');
    (d.brands || []).forEach((b) => addKey(b, [d.id], 'brand'));
  });
  Object.entries(F.COMBINATIONS || {}).forEach(([brand, ids]) => addKey(brand, ids, 'combination'));

  function resolve(entry) {
    const key = normalise(entry);
    if (!key) return { entry, ids: [], via: null };
    const hit = INDEX.get(key) || INDEX.get(key.split(' ')[0]);
    return hit ? { entry, ids: hit.ids.slice(), via: hit.via } : { entry, ids: [], via: null };
  }

  /** Split "Dolo 650, Pan 40\nShelcal" into trimmed, de-duplicated entries. */
  function parseList(text) {
    const seen = new Set();
    return String(text || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  }

  function screen(entries) {
    const resolved = entries.map(resolve);
    const sources = new Map(); // ingredient id → entries containing it
    resolved.forEach((r) => r.ids.forEach((id) => {
      if (!sources.has(id)) sources.set(id, []);
      sources.get(id).push(r.entry);
    }));

    const findings = [];
    sources.forEach((list, id) => {
      if (list.length > 1) {
        findings.push({ type: 'duplicate', severity: 'critical', drug: F.getDrug(id), entries: list });
      }
    });

    const ids = [...sources.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = F.getDrug(ids[i]);
        const b = F.getDrug(ids[j]);
        if (a.contraindicatedWith.includes(b.id) || b.contraindicatedWith.includes(a.id)) {
          findings.push({
            type: 'interaction',
            severity: 'critical',
            a, b,
            mono: F.getMonograph(a.id, b.id),
            entries: [sources.get(a.id)[0], sources.get(b.id)[0]]
          });
        }
      }
    }

    return {
      resolved,
      findings,
      known: resolved.filter((r) => r.ids.length),
      unknown: resolved.filter((r) => !r.ids.length).map((r) => r.entry)
    };
  }

  const api = { normalise, resolve, parseList, screen };
  if (isNode) module.exports = api;
  root.DX = root.DX || {};
  root.DX.screen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
