/**
 * Diagnostix CDSS — Clinical Rationale Layer (simulated AI)
 * ------------------------------------------------------------------
 * Converts structured engine findings into pharmacist-grade explanations.
 *
 * The prototype ships a deterministic "SimulatedProvider" that composes
 * explanations from knowledge-base monographs, so output is reproducible
 * and never invents clinical facts. A production deployment can swap in
 * a server-side LLM provider with the same interface:
 *
 *   provider.explain(finding, context) -> Promise<Rationale>
 *
 * The LLM should only rephrase/contextualise the structured finding it is
 * given; the deterministic engine remains the source of truth for whether
 * an alert fires. Never call a model API directly from the browser (keys).
 */
(function (root) {
  'use strict';

  /** Format a number the way ISMP recommends: no trailing zeros, leading zero kept. */
  function n(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  const KIND_PHRASE = {
    'Pharmacokinetic': 'pharmacokinetic',
    'Pharmacodynamic': 'pharmacodynamic',
    'Pharmacokinetic + pharmacodynamic': 'pharmacokinetic and pharmacodynamic'
  };

  const TEMPLATES = {
    'dose-peds'(f) {
      const d = f.data;
      return {
        headline: 'Dose exceeds maximum pediatric weight-based limit',
        finding: `${n(d.tdd)} mg/day ordered · ceiling ${n(d.ceiling.value)} mg/day · ${d.pct}% of limit`,
        rationale:
          `The ordered regimen of ${n(d.dose)} mg ${d.freq.label.toLowerCase()} delivers ${n(d.tdd)} mg/day` +
          (d.mgPerKg != null ? ` (${n(d.mgPerKg)} mg/kg/day)` : '') +
          `, exceeding the patient-specific ceiling of ${n(d.ceiling.value)} mg/day (${d.ceiling.basis}) by ${n(d.excess)} mg. ` +
          (d.ceiling.capped ? `The weight-derived ceiling of ${n(d.ceiling.raw)} mg/day was capped at the adult absolute maximum. ` : '') +
          `${d.drug.toxicity} Developmental variation in hepatic CYP-mediated metabolism and renal clearance makes weight-normalised dosing mandatory in pediatric patients; adult doses must not be extrapolated.`,
        actions: [
          d.suggested > 0
            ? `Reduce to ≤ ${n(d.suggested)} mg ${d.freq.label.toLowerCase()} (≤ ${n(d.ceiling.value)} mg/day).`
            : `No practical dose at this frequency stays within ${n(d.ceiling.value)} mg/day — reduce the frequency.`,
          'Confirm the dosing weight was measured this encounter rather than estimated.',
          'Clarify per-dose versus per-day intent with the prescriber — a common transcription error.'
        ],
        monitoring: d.drug.monitoring
      };
    },

    'dose-adult'(f) {
      const d = f.data;
      return {
        headline: 'Dose exceeds maximum recommended adult daily limit',
        finding: `${n(d.tdd)} mg/day ordered · maximum ${n(d.ceiling.value)} mg/day · ${d.pct}% of limit`,
        rationale:
          `The ordered regimen of ${n(d.dose)} mg ${d.freq.label.toLowerCase()} delivers ${n(d.tdd)} mg/day, exceeding the maximum recommended therapeutic limit of ${n(d.ceiling.value)} mg/day by ${n(d.excess)} mg. ` +
          `${d.drug.toxicity}`,
        actions: [
          d.suggested > 0
            ? `Reduce to ≤ ${n(d.suggested)} mg ${d.freq.label.toLowerCase()} (≤ ${n(d.ceiling.value)} mg/day).`
            : `No practical dose at this frequency stays within ${n(d.ceiling.value)} mg/day — reduce the frequency.`,
          'If a protocol-driven supratherapeutic regimen is intended (e.g. loading), document the indication and duration.',
          'Clarify per-dose versus per-day intent with the prescriber.'
        ],
        monitoring: d.drug.monitoring
      };
    },

    interaction(f) {
      const { a, b, mono } = f.data;
      return {
        headline: `High-risk ${KIND_PHRASE[mono.kind] || 'drug'} interaction detected`,
        finding: `${a.name} + ${b.name} · ${mono.severity} · ${mono.kind}`,
        rationale:
          `Co-prescription of ${a.name} and ${b.name} is classified as ${mono.severity.toLowerCase()} in the Diagnostix knowledge base. ` +
          `${mono.mechanism} ${mono.effect}`,
        actions: [
          mono.management,
          'Contact the prescriber to evaluate a therapeutic alternative before dispensing.',
          mono.severity === 'Contraindicated'
            ? 'An override requires attending-physician co-signature and a documented monitoring plan.'
            : 'If continued, document the monitoring plan in the medication record.'
        ],
        monitoring: [a.monitoring[0], b.monitoring[0]]
      };
    },

    age(f) {
      const d = f.data;
      return {
        headline: 'Age-based contraindication',
        finding: `${d.drug.name} · patient ${n(d.age)} y · minimum age ${n(d.minAge)} y`,
        rationale: `${d.drug.name} is not indicated for patients younger than ${n(d.minAge)} years. ${d.drug.minAgeNote}`,
        actions: [
          'Discontinue this order and select an age-appropriate agent.',
          'Confirm the recorded date of birth is correct.'
        ],
        monitoring: []
      };
    },

    duplicate(f) {
      const d = f.data;
      return {
        headline: 'Therapeutic duplication detected',
        finding: `${d.drug.name} ordered on lines ${f.lines.join(' and ')}`,
        rationale:
          `${d.drug.name} appears on both order lines. Concurrent duplicate orders produce additive exposure that bypasses per-line dose-ceiling verification and is a recognised source of cumulative overdose.`,
        actions: ['Consolidate into a single order line with the intended total regimen.', 'Confirm whether one line was intended as a different agent.'],
        monitoring: d.drug.monitoring.slice(0, 1)
      };
    },

    data(f) {
      const d = f.data;
      const what = {
        age: ['Patient age is not recorded', 'Age determines whether pediatric weight-based or adult absolute limits apply; no dose ceiling can be established without it.'],
        weight: ['Dosing weight is required for a pediatric patient', 'Pediatric ceilings are derived from mg/kg/day × actual body weight; verification cannot proceed without a measured weight.'],
        dose: [`No valid dose entered for ${d.drug ? d.drug.name : 'this line'}`, 'Enter the intended dose per administration in milligrams.'],
        order: ['No medication selected', 'Select at least one agent from the formulary to verify.']
      }[d.missing];
      return {
        headline: 'Verification blocked — incomplete clinical context',
        finding: what[0],
        rationale: what[1],
        actions: ['Complete the missing field and re-run verification.'],
        monitoring: []
      };
    },

    'near-ceiling'(f) {
      const d = f.data;
      return {
        headline: 'Dose approaching maximum therapeutic limit',
        finding: `${n(d.tdd)} mg/day · ${d.pct}% of ${n(d.ceiling.value)} mg/day`,
        rationale:
          `${d.drug.name} ${n(d.tdd)} mg/day lies within the permissible range but at ${d.pct}% of the patient-specific ceiling, leaving little margin for additional doses from PRN orders or combination products.`,
        actions: ['Reconcile all sources of this agent, including PRN and over-the-counter products.'],
        monitoring: d.drug.monitoring.slice(0, 1)
      };
    },

    renal(f) {
      const d = f.data;
      return {
        headline: 'Renal dose adjustment indicated',
        finding: `${d.renal.label} ${n(d.renal.value)} ${d.renal.unit} · threshold ${d.drug.renal.threshold}`,
        rationale: `Estimated renal function is below the adjustment threshold for ${d.drug.name}. ${d.drug.renal.note}`,
        actions: ['Adjust the dose or interval per renal function and reassess with the next creatinine.'],
        monitoring: ['Serum creatinine and urine output']
      };
    },

    geriatric(f) {
      const d = f.data;
      return {
        headline: d.geriatric.maxDaily != null ? 'Exceeds recommended older-adult ceiling' : 'Potentially inappropriate in older adults',
        finding:
          d.geriatric.maxDaily != null
            ? `${d.drug.name} ${n(d.tdd)} mg/day · older-adult maximum ${n(d.geriatric.maxDaily)} mg/day`
            : `${d.drug.name} · patient ${n(d.age)} y`,
        rationale: d.geriatric.note,
        actions: ['Consider dose reduction or a safer alternative and document the clinical justification.'],
        monitoring: d.drug.monitoring.slice(0, 1)
      };
    }
  };

  const SimulatedProvider = {
    name: 'Diagnostix Clinical Rationale Engine',
    mode: 'Simulated inference · deterministic templates',
    explain(finding) {
      const t = TEMPLATES[finding.type];
      const r = t ? t(finding) : { headline: 'Clinical alert', finding: finding.rule, rationale: '', actions: [], monitoring: [] };
      return Object.assign(r, { rule: finding.rule, severity: finding.severity });
    }
  };

  let provider = SimulatedProvider;

  /** Explain every finding. Async so a network-backed provider can drop in. */
  async function explainAll(result, { latencyMs = 0 } = {}) {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    return Promise.all(result.findings.map((f) => Promise.resolve(provider.explain(f, result))));
  }

  const api = {
    explain: (f) => provider.explain(f),
    explainAll,
    setProvider(p) { provider = p; },
    get provider() { return provider; },
    SimulatedProvider,
    formatNumber: n
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DX = root.DX || {};
  root.DX.rationale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
