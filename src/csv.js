const fs = require('node:fs');

// Small RFC-4180-compatible CSV reader/writer; handles commas, quotes and newlines in fields.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.replace(/^\uFEFF/, '').trim());
  return rows.filter(r => !(r.length === 1 && r[0] === '')).map(values => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
    return obj;
  });
}
function readCsv(file) { return parseCsv(fs.readFileSync(file, 'utf8')); }
function quoteCsv(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file, headers, rows) {
  const text = [headers, ...rows.map(row => headers.map(h => row[h] ?? ''))]
    .map(row => row.map(quoteCsv).join(',')).join('\n') + '\n';
  fs.writeFileSync(file, text, 'utf8');
}
module.exports = { parseCsv, readCsv, writeCsv };
