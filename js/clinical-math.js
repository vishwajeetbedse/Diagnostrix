/**
 * Diagnostix CDSS — Clinical calculations
 * Pure functions: every result carries the value, the unit and the formula used,
 * so the UI can show its working and the engine can cite it.
 */
(function (root) {
  'use strict';

  const round = (v, dp = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
  const valid = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

  /** Age band drives which dosing rule applies. Pediatric = under 18 years. */
  function ageBand(age) {
    if (!valid(age, 0, 130)) return { id: 'unknown', label: 'Age not recorded', pediatric: null };
    if (age < 28 / 365) return { id: 'neonate', label: 'Neonate', pediatric: true };
    if (age < 1) return { id: 'infant', label: 'Infant', pediatric: true };
    if (age < 12) return { id: 'child', label: 'Child', pediatric: true };
    if (age < 18) return { id: 'adolescent', label: 'Adolescent', pediatric: true };
    if (age < 65) return { id: 'adult', label: 'Adult', pediatric: false };
    return { id: 'older', label: 'Older adult', pediatric: false };
  }

  /** Body mass index (kg/m²). Adult categories only — pediatric BMI needs age-sex percentiles. */
  function bmi(weightKg, heightCm, age) {
    if (!valid(weightKg, 0.3, 400) || !valid(heightCm, 25, 260)) return null;
    const v = weightKg / (heightCm / 100) ** 2;
    let category;
    if (Number.isFinite(age) && age < 18) category = 'Use BMI-for-age percentile';
    else if (v < 18.5) category = 'Underweight';
    else if (v < 25) category = 'Normal weight';
    else if (v < 30) category = 'Overweight';
    else category = 'Obese';
    return { value: round(v, 1), unit: 'kg/m²', category, formula: 'wt ÷ ht²' };
  }

  /** Body surface area, Mosteller (m²). */
  function bsa(weightKg, heightCm) {
    if (!valid(weightKg, 0.3, 400) || !valid(heightCm, 25, 260)) return null;
    return { value: round(Math.sqrt((heightCm * weightKg) / 3600), 2), unit: 'm²', formula: 'Mosteller √(ht × wt ÷ 3600)' };
  }

  /** Ideal body weight, Devine (kg). Adults ≥ 152.4 cm only. */
  function ibw(heightCm, sex, age) {
    if (!valid(heightCm, 152.4, 260) || !(age >= 18) || !['M', 'F'].includes(sex)) return null;
    const inchesOver60 = heightCm / 2.54 - 60;
    const base = sex === 'M' ? 50 : 45.5;
    return { value: round(base + 2.3 * inchesOver60, 1), unit: 'kg', formula: `Devine ${base} + 2.3 kg/in over 5 ft` };
  }

  /**
   * Renal function.
   * Adults: Cockcroft–Gault creatinine clearance (mL/min), actual body weight.
   * Pediatrics: bedside Schwartz eGFR (mL/min/1.73 m²).
   */
  function renal(age, weightKg, heightCm, sex, scr) {
    if (!valid(scr, 0.1, 20) || !valid(age, 0, 130)) return null;
    if (age < 18) {
      if (!valid(heightCm, 25, 260) || age < 1) return null;
      return { value: round((0.413 * heightCm) / scr, 0), unit: 'mL/min/1.73 m²', label: 'eGFR', formula: 'Bedside Schwartz 0.413 × ht ÷ SCr' };
    }
    if (!valid(weightKg, 20, 400) || !['M', 'F'].includes(sex)) return null;
    let v = ((140 - age) * weightKg) / (72 * scr);
    if (sex === 'F') v *= 0.85;
    return { value: round(v, 0), unit: 'mL/min', label: 'CrCl', formula: `Cockcroft–Gault${sex === 'F' ? ' × 0.85' : ''}` };
  }

  function profile(p) {
    const band = ageBand(p.age);
    return {
      band,
      bmi: bmi(p.weight, p.height, p.age),
      bsa: bsa(p.weight, p.height),
      ibw: ibw(p.height, p.sex, p.age),
      renal: renal(p.age, p.weight, p.height, p.sex, p.scr)
    };
  }

  const api = { round, ageBand, bmi, bsa, ibw, renal, profile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DX = root.DX || {};
  root.DX.clinicalMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
