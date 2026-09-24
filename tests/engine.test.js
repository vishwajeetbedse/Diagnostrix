// Run: npm test   (Node 18+, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/formulary.js');
const M = require('../js/clinical-math.js');
const E = require('../js/engine.js');
const R = require('../js/rationale.js');

const child = { age: 6, weight: 20, height: 116, sex: 'M', scr: 0.4 };
const adult = { age: 45, weight: 70, height: 165, sex: 'F', scr: 0.9 };

test('knowledge base: ≥ 5 high-risk drugs with required fields and symmetric contraindications', () => {
  assert.ok(F.DRUGS.length >= 5);
  for (const d of F.DRUGS) {
    assert.ok(d.adultMaxDaily > 0, d.id);
    assert.ok(d.pedsMaxMgPerKgDay > 0, d.id);
    assert.ok(Array.isArray(d.contraindicatedWith), d.id);
  }
  const report = F.integrityReport();
  assert.equal(report.ok, true, report.issues.join('\n'));
});

test('clinical math: BMI, Mosteller BSA, Cockcroft–Gault', () => {
  assert.equal(M.bmi(70, 175, 30).value, 22.9);
  assert.equal(M.bsa(70, 175).value, 1.84);
  // (140-45)*70 / (72*0.9) * 0.85 = 87.2
  assert.equal(M.renal(45, 70, 165, 'F', 0.9).value, 87);
  assert.equal(M.ageBand(17.9).pediatric, true);
  assert.equal(M.ageBand(18).pediatric, false);
});

test('pediatric: acetaminophen 500 mg q4h for 20 kg exceeds 75 mg/kg/day', () => {
  const r = E.verify(child, [{ line: 1, drugId: 'acetaminophen', dose: 500, freqId: 'q4h' }]);
  const f = r.findings.find((x) => x.rule === 'DOSE-PED-01');
  assert.ok(f);
  assert.equal(f.data.ceiling.value, 1500);
  assert.equal(f.data.tdd, 3000);
  assert.equal(f.data.pct, 200);
  assert.equal(f.data.suggested, 250);
  assert.equal(r.status, 'critical');
});

test('pediatric ceiling is capped at the adult maximum for heavy adolescents', () => {
  const r = E.verify({ age: 16, weight: 90 }, [{ line: 1, drugId: 'acetaminophen', dose: 1000, freqId: 'q4h' }]);
  const f = r.findings.find((x) => x.rule === 'DOSE-PED-01');
  assert.equal(f.data.ceiling.value, 4000); // 75 × 90 = 6750 → capped
  assert.equal(f.data.ceiling.capped, true);
});

test('adult: exactly at the maximum passes with an advisory; above fails', () => {
  const at = E.verify(adult, [{ line: 1, drugId: 'acetaminophen', dose: 1000, freqId: 'q6h' }]);
  assert.equal(at.counts.critical, 0);
  assert.ok(at.findings.some((f) => f.rule === 'ADV-CEIL-01'));
  const over = E.verify(adult, [{ line: 1, drugId: 'ibuprofen', dose: 1200, freqId: 'q8h' }]);
  assert.ok(over.findings.some((f) => f.rule === 'DOSE-ADT-01'));
});

test('interaction: warfarin + amiodarone flagged regardless of line order', () => {
  for (const pair of [['warfarin', 'amiodarone'], ['amiodarone', 'warfarin']]) {
    const r = E.verify(adult, [
      { line: 1, drugId: pair[0], dose: pair[0] === 'warfarin' ? 5 : 200, freqId: 'daily' },
      { line: 2, drugId: pair[1], dose: pair[1] === 'warfarin' ? 5 : 200, freqId: 'daily' }
    ]);
    const f = r.findings.find((x) => x.rule === 'DDI-SEV-01');
    assert.ok(f);
    assert.equal(R.explain(f).headline, 'High-risk pharmacokinetic interaction detected');
  }
});

test('clean order passes all checks', () => {
  const r = E.verify(adult, [
    { line: 1, drugId: 'acetaminophen', dose: 650, freqId: 'q6h' },
    { line: 2, drugId: 'fluconazole', dose: 200, freqId: 'daily' }
  ]);
  assert.equal(r.status, 'pass');
  assert.ok(r.checks.every((c) => c.result === 'pass' || c.result === 'n/a'));
});

test('age restriction, duplication and missing pediatric weight', () => {
  const age = E.verify({ age: 10, weight: 32 }, [{ line: 1, drugId: 'tramadol', dose: 50, freqId: 'q6h' }]);
  assert.ok(age.findings.some((f) => f.rule === 'AGE-01'));
  const dup = E.verify(adult, [
    { line: 1, drugId: 'ibuprofen', dose: 400, freqId: 'q8h' },
    { line: 2, drugId: 'ibuprofen', dose: 400, freqId: 'q8h' }
  ]);
  assert.ok(dup.findings.some((f) => f.rule === 'DUP-01'));
  const noWt = E.verify({ age: 4 }, [{ line: 1, drugId: 'ibuprofen', dose: 100, freqId: 'q8h' }]);
  assert.ok(noWt.findings.some((f) => f.rule === 'DATA-01' && f.data.missing === 'weight'));
});

test('every finding type produces a rationale with headline and actions', () => {
  const r = E.verify({ age: 80, weight: 55, height: 160, sex: 'M', scr: 2.2 }, [
    { line: 1, drugId: 'digoxin', dose: 0.25, freqId: 'daily' },
    { line: 2, drugId: 'clarithromycin', dose: 500, freqId: 'q12h' }
  ]);
  for (const f of r.findings) {
    const x = R.explain(f);
    assert.ok(x.headline && x.rationale && x.actions.length, f.rule);
  }
  assert.ok(r.findings.some((f) => f.rule === 'ADV-RENAL-01'));
  assert.ok(r.findings.some((f) => f.rule === 'ADV-GER-01'));
});
