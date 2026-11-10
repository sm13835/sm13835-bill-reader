// Run with: node --test
// These check that member and district data load as separate, matching files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadInputs, districtFile } = require('../app/analyze.js');

const DATA = path.join(__dirname, '..', 'data');
const members = fs.readdirSync(path.join(DATA, 'members')).map((f) => JSON.parse(fs.readFileSync(path.join(DATA, 'members', f))));

test('a member loads with their own district and commitments', () => {
  const { member, district, promises } = loadInputs('kean');
  assert.strictEqual(member.district, 'NJ-7');
  assert.strictEqual(district.id, 'NJ-7');
  assert.ok(promises.length > 0);
});

test('a member id that is not a known file is refused, including path tricks', () => {
  for (const bad of ['../members/kean', 'nobody', '', undefined, 'KEAN']) {
    assert.throws(() => loadInputs(bad), /Unknown member/);
  }
});

test('district ids map to one file name and nothing else', () => {
  assert.strictEqual(districtFile('NJ-7'), 'districts/nj-07.json');
  assert.strictEqual(districtFile('NJ-12'), 'districts/nj-12.json');
  assert.throws(() => districtFile('../NJ-7'), /Invalid district/);
});

test('every member has a district file, two House votes and no duplicate district', () => {
  const seen = new Set();
  for (const m of members) {
    assert.ok(fs.existsSync(path.join(DATA, districtFile(m.district))), m.id);
    assert.strictEqual(m.votes_on_bill.length, 2, m.id);
    assert.ok(!seen.has(m.district), `two members for ${m.district}`);
    seen.add(m.district);
  }
  assert.strictEqual(members.length, 12);
});

test('every saved brief belongs to a known member and cites only that district\'s facts', () => {
  for (const file of fs.readdirSync(path.join(DATA, 'briefs'))) {
    const brief = JSON.parse(fs.readFileSync(path.join(DATA, 'briefs', file)));
    const member = members.find((m) => file === `hr1-${m.id}.json`);
    assert.ok(member, file);
    assert.strictEqual(brief.district_id, member.district);
    const keys = new Set(JSON.parse(fs.readFileSync(path.join(DATA, districtFile(member.district)))).facts.map((f) => f.key));
    for (const item of brief.items) for (const k of item.district_facts) assert.ok(keys.has(k), `${file}: ${k}`);
  }
});
