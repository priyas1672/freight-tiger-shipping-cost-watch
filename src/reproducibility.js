const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('./analyzer');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const outputs = [];
for (let i = 1; i <= 3; i++) {
  const file = path.join(root, 'output', `repro_run_${i}.csv`);
  run({ dataDir, outputFile: file });
  outputs.push({ file, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
}
const identical = outputs.every(x => x.hash === outputs[0].hash);
const report = { runs: outputs.map((x, i) => ({ run: i + 1, sha256: x.hash })), identical, note: 'This implementation uses deterministic local calculations and rule-based note retrieval; it makes no LLM/API calls.' };
fs.writeFileSync(path.join(root, 'logs', 'reproducibility.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!identical) process.exitCode = 1;
