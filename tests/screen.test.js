const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/screen.js');

test('normalise strips strengths and dosage forms', () => {
  assert.equal(S.normalise('Dolo 650'), 'dolo');
  assert.equal(S.normalise('Dolo-650 Tablet'), 'dolo');
  assert.equal(S.normalise('Warfarin 5 mg'), 'warfarin');
  assert.equal(S.normalise('Lithium carbonate 300mg'), 'lithium carbonate');
});

test('resolves generics, brands and combination products', () => {
  assert.deepEqual(S.resolve('Dolo 650').ids, ['acetaminophen']);
  assert.deepEqual(S.resolve('paracetamol').ids, ['acetaminophen']);
  assert.deepEqual(S.resolve('Combiflam').ids, ['ibuprofen', 'acetaminophen']);
  assert.deepEqual(S.resolve('lithium').ids, ['lithium']);
  assert.deepEqual(S.resolve('Pan 40').ids, []);
});

test('parseList splits on commas, semicolons and new lines without duplicates', () => {
  assert.deepEqual(S.parseList('Dolo 650, Pan 40\nShelcal; dolo 650'), ['Dolo 650', 'Pan 40', 'Shelcal']);
});

test('catches a hidden duplicate ingredient across brands', () => {
  const r = S.screen(['Dolo 650', 'Combiflam']);
  const dup = r.findings.find((f) => f.type === 'duplicate');
  assert.equal(dup.drug.id, 'acetaminophen');
  assert.deepEqual(dup.entries, ['Dolo 650', 'Combiflam']);
});

test('catches a contraindication through brand names and passes unknowns to the AI', () => {
  const r = S.screen(['Warf 5', 'Brufen 400', 'Pan 40']);
  assert.ok(r.findings.some((f) => f.type === 'interaction' && f.mono.severity === 'Major'));
  assert.deepEqual(r.unknown, ['Pan 40']);
});
