const assert = require('node:assert/strict');
const path = require('node:path');
const { readCsv } = require('../src/csv');
const { findSupportingNote } = require('../src/analyzer');
const root = path.resolve(__dirname, '..');
const notes = readCsv(path.join(root, 'data', 'context_notes.csv'));
const cases = [
  {label:'festival note matches route and week', route:'Ahmedabad-Mumbai', week:'2025-01-20', expected:'N002'},
  {label:'flood note matches first disruption week', route:'Chennai-Bangalore', week:'2025-02-24', expected:'N001'},
  {label:'flood note matches second disruption week', route:'Chennai-Bangalore', week:'2025-03-03', expected:'N001'},
  {label:'flood note does not extend after roads normal', route:'Chennai-Bangalore', week:'2025-03-10', expected:null},
  {label:'unrelated route cannot use festival note', route:'Mumbai-Pune', week:'2025-01-20', expected:null},
  {label:'stable demand is not causal evidence', route:'Mumbai-Pune', week:'2025-09-22', expected:null},
  {label:'nationwide diesel note matches its start week', route:'Mumbai-Pune', week:'2025-05-05', expected:'N003'},
  {label:'unaffected toll routes are not justified', route:'Delhi-Jaipur', week:'2024-03-11', expected:null}
];
let passed = 0;
for (const c of cases) {
  const actual = findSupportingNote(c.route, c.week, notes)?.note_id ?? null;
  assert.equal(actual, c.expected, c.label);
  passed++;
}
console.log(`Evidence evaluation passed: ${passed}/${cases.length}`);
console.log('Scope: hand-labelled route/date retrieval cases; this is a small deterministic eval set, not a claim of broad statistical accuracy.');
