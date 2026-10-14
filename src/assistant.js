const { readCsv } = require('./csv');
const path = require('node:path');

function answerQuestion(question, outputRows, notes) {
  const q = String(question || '').toLowerCase();
  const routeNames = [...new Set(outputRows.map(r => r.route))].sort((a,b)=>b.length-a.length);
  const route = routeNames.find(r => q.includes(r.toLowerCase()));
  let rows = outputRows;
  if (route) rows = rows.filter(r => r.route === route);
  const monthMatch = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (monthMatch) {
    const months = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
    rows = rows.filter(r => r.week_of.slice(5,7) === months[monthMatch[1].toLowerCase()]);
  }
  if (!rows.length) return 'I could not find matching route/week results in the generated analysis. Please mention a route exactly as shown in the output CSV.';
  rows.sort((a,b)=>b.week_of.localeCompare(a.week_of));
  const flagged = rows.filter(r => r.flagged === 'Yes');
  const justified = rows.filter(r => r.flagged === 'No (justified)');
  const latest = rows[0];
  if (/why|reason|pricier|increase|increased|costlier|expensive/.test(q)) {
    const evidenced = rows.find(r => r.matched_note_id);
    if (evidenced) {
      const note = notes.find(n => n.note_id === evidenced.matched_note_id);
      return `${evidenced.route} in the week of ${evidenced.week_of}: ${evidenced.flagged === 'No (justified)' ? 'the increase was treated as explained' : 'the route was flagged'}. Evidence ${note ? note.note_id + ' (' + note.date + ')' : evidenced.matched_note_id}: ${note ? note.note : 'the cited note is not present in the notes file'}`;
    }
    const candidate = rows.find(r => r.flagged === 'Yes');
    if (candidate) return `${candidate.route} in the week of ${candidate.week_of} was flagged because its cost rose beyond at least one configured comparison threshold. No note matched both route and time, so the cause is unexplained; the system does not guess.`;
    return `${latest.route} in the week of ${latest.week_of} was not flagged. ${latest.reason}`;
  }
  return `Found ${rows.length} matching route-week records${route ? ' for ' + route : ''}. ${flagged.length} are flagged for review and ${justified.length} are marked as explained by a matching note. Latest record: ${latest.week_of}, cost ₹${latest.cost_per_tonne_km} per tonne-km, verdict: ${latest.flagged}. ${latest.reason}`;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const question = process.argv.slice(2).join(' ');
  if (!question) {
    console.log('Usage: npm run ask -- "Why did Chennai-Bangalore get pricier in March?"');
    process.exitCode = 2; return;
  }
  const outputRows = readCsv(path.join(root, 'output', 'shipping_cost_analysis.csv'));
  const notes = readCsv(path.join(root, 'data', 'context_notes.csv'));
  console.log(answerQuestion(question, outputRows, notes));
}
if (require.main === module) main();
module.exports = { answerQuestion };
