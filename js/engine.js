/**
 * Diagnostix CDSS — Verification Logic Engine
 * ------------------------------------------------------------------
 * Intercepts an order set, cross-references it against patient context
 * and the clinical knowledge base, and returns structured findings.
 *
 * The engine is deterministic: identical inputs always yield identical
 * findings. Explanations are produced separately by the rationale layer.
 *
 * Rules
 *   DATA-01      incomplete patient context (age, pediatric weight, dose)
 *   DOSE-PED-01  pediatric (< 18 y): total daily dose > mg/kg/day × weight
 *   DOSE-ADT-01  adult (≥ 18 y): total daily dose > adult absolute maximum
 *   DDI-SEV-01   the two agents are contraindicated against each other
 *   DUP-01       the same agent is ordered twice
 *   AGE-01       patient younger than the agent's minimum age
 *   ADV-CEIL-01  advisory: dose ≥ 90% of the ceiling
 *   ADV-RENAL-01 advisory: renal function below the agent's threshold
 *   ADV-GER-01   advisory: older-adult (Beers) caution
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const F = isNode ? require('./formulary.js') : root.DX.formulary;
  const M = isNode ? require('./clinical-math.js') : root.DX.clinicalMath;

  const NEAR_CEILING_PCT = 90;

  /** Floating-point-safe floor to a dosing increment. */
  function floorToStep(value, step) {
    const n = Math.floor(value / step + 1e-9);
    return Number((n * step).toFixed(4));
  }

  /**
   * Patient-specific maximum daily dose.
   * Pediatric: mg/kg/day × weight, never exceeding the adult absolute maximum.
   * Adult: the adult absolute maximum.
   */
  function dailyCeiling(drug, patient) {
    if (patient.age < 18) {
      if (!(patient.weight > 0)) return null;
      const raw = drug.pedsMaxMgPerKgDay * patient.weight;
      const capped = raw > drug.adultMaxDaily;
      return {
        value: Number((capped ? drug.adultMaxDaily : raw).toFixed(4)),
        raw: Number(raw.toFixed(4)),
        capped,
        rule: 'pediatric',
        basis: `${drug.pedsMaxMgPerKgDay} mg/kg/day × ${patient.weight} kg`
      };
    }
    return { value: drug.adultMaxDaily, raw: drug.adultMaxDaily, capped: false, rule: 'adult', basis: 'adult absolute maximum' };
  }

  function makeId() {
    const t = Date.now().toString(36).toUpperCase().slice(-5);
    const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
    return `VR-${t}${r}`;
  }

  /**
   * @param {object} patient { age, weight, height, sex, scr }
   * @param {Array}  orders  [{ line, drugId, dose, freqId }] — up to two lines
   */
  function verify(patient, orders) {
    const profile = M.profile(patient);
    const findings = [];
    const checks = [];
    const add = (f) => findings.push(Object.assign({ id: `${f.rule}:${(f.lines || []).join('-')}` }, f));

    const active = (orders || []).filter((o) => o && o.drugId).slice(0, 2);

    // ---- Patient context -------------------------------------------------
    const ageKnown = Number.isFinite(patient.age) && patient.age >= 0 && patient.age <= 130;
    if (!ageKnown) {
      add({ rule: 'DATA-01', type: 'data', severity: 'critical', lines: [], data: { missing: 'age' } });
    }
    const pediatric = ageKnown && patient.age < 18;
    if (pediatric && !(patient.weight > 0)) {
      add({ rule: 'DATA-01', type: 'data', severity: 'critical', lines: [], data: { missing: 'weight' } });
    }
    if (active.length === 0) {
      add({ rule: 'DATA-01', type: 'data', severity: 'critical', lines: [], data: { missing: 'order' } });
    }

    // ---- Per-line dose verification ---------------------------------------
    const lines = active.map((o) => {
      const drug = F.getDrug(o.drugId);
      const freq = F.getFrequency(o.freqId);
      const dose = Number(o.dose);
      const doseValid = Number.isFinite(dose) && dose > 0;
      const tdd = doseValid ? Number((dose * freq.perDay).toFixed(4)) : null;
      const ceiling = ageKnown ? dailyCeiling(drug, patient) : null;
      const pct = ceiling && tdd != null ? Math.round((tdd / ceiling.value) * 100) : null;
      const mgPerKg = tdd != null && patient.weight > 0 ? M.round(tdd / patient.weight, 2) : null;
      const line = { line: o.line, drug, freq, dose: doseValid ? dose : null, tdd, ceiling, pct, mgPerKg };

      if (!doseValid) {
        add({ rule: 'DATA-01', type: 'data', severity: 'critical', lines: [o.line], data: { missing: 'dose', drug } });
        checks.push({ label: `Dose ceiling · line ${o.line} (${drug.name})`, result: 'fail', detail: 'No valid dose entered' });
        return line;
      }
      if (!ceiling) {
        checks.push({ label: `Dose ceiling · line ${o.line} (${drug.name})`, result: 'fail', detail: 'Ceiling not computable — patient context incomplete' });
        return line;
      }

      const suggested = floorToStep(ceiling.value / freq.perDay, drug.doseStep);
      if (tdd > ceiling.value) {
        add({
          rule: ceiling.rule === 'pediatric' ? 'DOSE-PED-01' : 'DOSE-ADT-01',
          type: ceiling.rule === 'pediatric' ? 'dose-peds' : 'dose-adult',
          severity: 'critical',
          lines: [o.line],
          data: { drug, freq, dose, tdd, ceiling, pct, mgPerKg, excess: Number((tdd - ceiling.value).toFixed(4)), suggested, weight: patient.weight }
        });
        checks.push({ label: `Dose ceiling · line ${o.line} (${drug.name})`, result: 'fail', detail: `${pct}% of ${ceiling.rule} maximum` });
      } else if (pct >= NEAR_CEILING_PCT) {
        add({
          rule: 'ADV-CEIL-01', type: 'near-ceiling', severity: 'advisory', lines: [o.line],
          data: { drug, freq, dose, tdd, ceiling, pct }
        });
        checks.push({ label: `Dose ceiling · line ${o.line} (${drug.name})`, result: 'advisory', detail: `${pct}% of ${ceiling.rule} maximum` });
      } else {
        checks.push({ label: `Dose ceiling · line ${o.line} (${drug.name})`, result: 'pass', detail: `${pct}% of ${ceiling.rule} maximum` });
      }
      return line;
    });

    // ---- Age restrictions ---------------------------------------------------
    if (ageKnown && lines.length) {
      let ageFail = false;
      lines.forEach((l) => {
        if (l.drug.minAgeYears != null && patient.age < l.drug.minAgeYears) {
          ageFail = true;
          add({ rule: 'AGE-01', type: 'age', severity: 'critical', lines: [l.line], data: { drug: l.drug, age: patient.age, minAge: l.drug.minAgeYears } });
        }
      });
      checks.push({ label: 'Age restriction screen', result: ageFail ? 'fail' : 'pass', detail: ageFail ? 'Agent below minimum age' : 'No age-restricted agents' });
    }

    // ---- Duplication and drug–drug interaction ------------------------------
    if (lines.length === 2) {
      const [a, b] = lines;
      if (a.drug.id === b.drug.id) {
        add({ rule: 'DUP-01', type: 'duplicate', severity: 'critical', lines: [a.line, b.line], data: { drug: a.drug } });
        checks.push({ label: 'Therapeutic duplication', result: 'fail', detail: `${a.drug.name} ordered on both lines` });
        checks.push({ label: 'Drug–drug interaction screen', result: 'n/a', detail: 'Same agent — screened as duplication' });
      } else {
        checks.push({ label: 'Therapeutic duplication', result: 'pass', detail: 'Distinct agents' });
        const contraindicated = a.drug.contraindicatedWith.includes(b.drug.id) || b.drug.contraindicatedWith.includes(a.drug.id);
        if (contraindicated) {
          const mono = F.getMonograph(a.drug.id, b.drug.id) || {
            severity: 'Major', kind: 'Pharmacodynamic', mechanism: 'Recorded as contraindicated in the knowledge base.', effect: 'Consult the interaction reference.', management: 'Contact the prescriber to evaluate an alternative.'
          };
          add({ rule: 'DDI-SEV-01', type: 'interaction', severity: 'critical', lines: [a.line, b.line], data: { a: a.drug, b: b.drug, mono } });
          checks.push({ label: 'Drug–drug interaction screen', result: 'fail', detail: `${mono.severity}: ${a.drug.name} + ${b.drug.name}` });
        } else {
          checks.push({ label: 'Drug–drug interaction screen', result: 'pass', detail: '1 pair screened, no severe interaction' });
        }
      }
    } else if (lines.length === 1) {
      checks.push({ label: 'Drug–drug interaction screen', result: 'n/a', detail: 'Single agent ordered' });
    }

    // ---- Advisories: renal and geriatric -----------------------------------
    if (lines.length) {
      if (profile.renal) {
        let flagged = false;
        lines.forEach((l) => {
          if (l.drug.renal && profile.renal.value < l.drug.renal.threshold) {
            flagged = true;
            add({ rule: 'ADV-RENAL-01', type: 'renal', severity: 'advisory', lines: [l.line], data: { drug: l.drug, renal: profile.renal } });
          }
        });
        checks.push({ label: 'Renal dose adjustment', result: flagged ? 'advisory' : 'pass', detail: `${profile.renal.label} ${profile.renal.value} ${profile.renal.unit}` });
      } else {
        checks.push({ label: 'Renal dose adjustment', result: 'n/a', detail: 'Serum creatinine not recorded' });
      }

      if (ageKnown && patient.age >= 65) {
        let flagged = false;
        lines.forEach((l) => {
          const g = l.drug.geriatric;
          if (!g || patient.age < g.age || l.tdd == null) return;
          if (g.maxDaily == null || l.tdd > g.maxDaily) {
            flagged = true;
            add({ rule: 'ADV-GER-01', type: 'geriatric', severity: 'advisory', lines: [l.line], data: { drug: l.drug, tdd: l.tdd, geriatric: g, age: patient.age } });
          }
        });
        checks.push({ label: 'Older-adult (Beers) screen', result: flagged ? 'advisory' : 'pass', detail: flagged ? 'Caution flagged' : 'No potentially inappropriate agents' });
      }
    }

    const critical = findings.filter((f) => f.severity === 'critical');
    const advisory = findings.filter((f) => f.severity === 'advisory');
    const status = critical.length ? 'critical' : advisory.length ? 'advisory' : 'pass';

    return {
      id: makeId(),
      at: new Date().toISOString(),
      kbVersion: F.VERSION,
      status,
      counts: { critical: critical.length, advisory: advisory.length },
      findings: critical.concat(advisory),
      lines,
      checks,
      profile
    };
  }

  const api = { verify, dailyCeiling, floorToStep, NEAR_CEILING_PCT };
  if (isNode) module.exports = api;
  root.DX = root.DX || {};
  root.DX.engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
