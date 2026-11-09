// Run with: node --test
// These check the code that decides whether a model's citation can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const { verifyItems } = require('../app/analyze.js');

const inputs = {
  sections: [{ id: '70120', text: 'The cap shall be increased to\n$40,000 for “taxable years” beginning in 2025.' }],
  promises: [{ id: 'salt-2021' }],
  facts: [{ key: 'median_property_tax' }],
};

const goodItem = {
  section_id: '70120',
  bill_quote: 'increased to $40,000 for "taxable years"',
  district_facts: ['median_property_tax'],
  promise_conflicts: [{ promise_id: 'salt-2021', severity: 'direct' }],
};

test('keeps an item whose citations are real, ignoring line breaks and curly quotes', () => {
  const { verified, dropped } = verifyItems([goodItem], inputs);
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(dropped.length, 0);
});

test('drops an invented bill quote', () => {
  const item = { ...goodItem, bill_quote: 'the cap is repealed permanently for all filers' };
  const { verified, dropped } = verifyItems([item], inputs);
  assert.strictEqual(verified.length, 0);
  assert.match(dropped[0].reason, /quote not found/);
});

test('drops a section that does not exist', () => {
  const { verified } = verifyItems([{ ...goodItem, section_id: '99999' }], inputs);
  assert.strictEqual(verified.length, 0);
});

test('drops an item with no real district fact behind it', () => {
  const { verified, dropped } = verifyItems([{ ...goodItem, district_facts: ['made_up_stat'] }], inputs);
  assert.strictEqual(verified.length, 0);
  assert.match(dropped[0].reason, /district fact/);
});

test('removes an alert that cites a promise we do not have, but keeps the finding', () => {
  const item = { ...goodItem, promise_conflicts: [{ promise_id: 'invented', severity: 'direct' }] };
  const { verified } = verifyItems([item], inputs);
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(verified[0].promise_conflicts.length, 0);
});
