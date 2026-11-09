// Run with: node --test
// These check the code that decides whether a model's citation can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const { verifyItems, verifyAlerts } = require('../app/analyze.js');

const inputs = {
  sections: [{ id: '70120', text: 'The cap shall be increased to\n$40,000 for “taxable years” beginning in 2025.' }],
  facts: [{ key: 'median_property_tax' }],
};

const goodItem = {
  section_id: '70120',
  bill_quote: 'increased to $40,000 for "taxable years"',
  district_facts: ['median_property_tax'],
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

const alertInputs = {
  items: [{ section_id: '70120' }],
  promises: [
    { id: 'pledge', strength: 'Explicit vote pledge' },
    { id: 'other-bill', strength: 'Explicit vote pledge', other_bill: true },
    { id: 'position', strength: 'Stated position' },
  ],
};
const verdict = (promise_id, value = 'direct') => ({
  promise_id,
  verdict: value,
  explanation: 'x',
  section_ids: ['70120'],
});

test('an explicit pledge can be a direct conflict', () => {
  const { alerts } = verifyAlerts([verdict('pledge')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'direct');
});

test('a general position is downgraded to possible, whatever the model said', () => {
  const { alerts } = verifyAlerts([verdict('position')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'possible');
});

test('a pledge about a different bill is downgraded to possible', () => {
  const { alerts } = verifyAlerts([verdict('other-bill')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'possible');
});

test('a verdict of none produces no alert', () => {
  const { alerts, dropped } = verifyAlerts([verdict('pledge', 'none')], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.strictEqual(dropped.length, 0);
});

test('drops an alert for a promise we do not have', () => {
  const { alerts, dropped } = verifyAlerts([verdict('invented')], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.match(dropped[0].reason, /does not exist/);
});

test('drops an alert that cites no analyzed section', () => {
  const unanalyzed = { ...verdict('pledge'), section_ids: ['99999'] };
  const { alerts, dropped } = verifyAlerts([unanalyzed], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.match(dropped[0].reason, /no analyzed section/);
});
