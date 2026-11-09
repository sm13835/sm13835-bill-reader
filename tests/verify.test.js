// Run with: node --test
// These check the code that decides whether a model's citation can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const {
  verifyItems,
  verifyAlerts,
  verifyOverview,
  verifyIssueTags,
  buildIssueIndex,
  withIssues,
} = require('../app/analyze.js');

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

const overviewInputs = { items: [{ section_id: '70120' }], pages: { 70120: 98, 71119: 235 } };

test('a summary bullet links to the page of each real section', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['70120'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.deepStrictEqual(result.what_it_does[0].sources, [{ section_id: '70120', page: 98 }]);
});

test('removes a section reference that was not analyzed, but keeps the bullet', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['70120', '71119', '99999'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.strictEqual(result.what_it_does[0].sources.length, 1);
});

test('does not show a summary bullet with no real source', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['99999'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.strictEqual(result.what_it_does.length, 0);
  assert.strictEqual(result.dropped_bullets, 1);
});

test('drops an alert that cites no analyzed section', () => {
  const unanalyzed = { ...verdict('pledge'), section_ids: ['99999'] };
  const { alerts, dropped } = verifyAlerts([unanalyzed], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.match(dropped[0].reason, /no analyzed section/);
});

const tagSections = [
  { id: '1', header: 'One' },
  { id: '2', header: 'Two' },
  { id: '3', header: 'Three' },
];

test('removes an issue name that is not on the list and reports it', () => {
  const tags = [{ id: '1', issues: ['Tax', 'Space Pirates'] }];
  const result = verifyIssueTags(tags, tagSections);
  assert.deepStrictEqual(result.bySection['1'], ['Tax']);
  assert.deepStrictEqual(result.unknown_labels, ['Space Pirates']);
});

test('a section with no valid issue goes to Other', () => {
  const { bySection } = verifyIssueTags([{ id: '1', issues: ['Space Pirates'] }], tagSections);
  assert.deepStrictEqual(bySection['1'], ['Other']);
});

test('allows at most three issues per section, and drops Other when a real issue exists', () => {
  const tags = [{ id: '1', issues: ['Other', 'Tax', 'Tax', 'Energy', 'Housing', 'Trade'] }];
  const { bySection } = verifyIssueTags(tags, tagSections);
  assert.deepStrictEqual(bySection['1'], ['Tax', 'Energy', 'Housing']);
});

test('reports a section the model skipped and ignores one that does not exist', () => {
  const tags = [{ id: '1', issues: ['Tax'] }, { id: '99', issues: ['Tax'] }];
  const { bySection, untagged } = verifyIssueTags(tags, tagSections);
  assert.strictEqual(bySection['99'], undefined);
  assert.deepStrictEqual(untagged, ['2', '3']);
});

test('only issues found in the bill become filters, largest first and Other last', () => {
  const bySection = { 1: ['Other'], 2: ['Tax', 'Energy'], 3: ['Energy'] };
  const index = buildIssueIndex(bySection, tagSections, { 2: 40 });
  assert.deepStrictEqual(index.map((i) => i.name), ['Energy', 'Tax', 'Other']);
  assert.deepStrictEqual(index[1].sections, [{ section_id: '2', header: 'Two', page: 40 }]);
  assert.strictEqual(index[2].sections[0].page, null);
});

test('a finding takes on the issues of its section', () => {
  const [tagged, untagged] = withIssues([{ section_id: '2' }, { section_id: '3' }], { 2: ['Tax'] });
  assert.deepStrictEqual(tagged.issues, ['Tax']);
  assert.deepStrictEqual(untagged.issues, []);
});
