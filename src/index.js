const path = require('node:path');
const { run } = require('./analyzer');
const root = path.resolve(__dirname, '..');
const result = run({ dataDir: path.join(root, 'data'), outputFile: path.join(root, 'output', 'shipping_cost_analysis.csv') });
console.log('Shipping-cost analysis complete.');
console.log(JSON.stringify(result.stats, null, 2));
console.log(`Output: ${path.join(root, 'output', 'shipping_cost_analysis.csv')}`);
