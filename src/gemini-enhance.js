
const fs = require('node:fs');
const path = require('node:path');
const { readCsv, writeCsv } = require('./csv');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'output', 'shipping_cost_analysis.csv');
const NOTES_FILE = path.join(ROOT, 'data', 'context_notes.csv');
const LOG_FILE = path.join(ROOT, 'logs', 'llm_cost_log.json');

// Primary model (override with GEMINI_MODEL in .env) + fallback models tried in order
// if the primary is overloaded or unavailable (override with GEMINI_FALLBACK_MODELS=a,b).
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);
const MODELS_TO_TRY = [MODEL, ...FALLBACK_MODELS.filter(m => m !== MODEL)];

// Retry settings: 3 attempts per model, waits of ~2s, ~4s between attempts (plus small jitter).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const OUTPUT_COLUMNS = [
  'route', 'week_of', 'cost_per_tonne_km', 'vs_own_history',
  'vs_similar_routes', 'flagged', 'matched_note_id', 'reason'
];

function deterministicFallback(row, note) {
  return `Not flagged: note ${note.note_id} dated ${note.date} applies to ${row.route} in this week and reports a cost-increasing disruption or surcharge. ${note.note}`;
}

// Calls one model with retries on temporary errors (503 high demand, 429 rate limit, 5xx, network).
async function callGemini(model, apiKey, requestBody) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody)
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return { body, model };

      const err = new Error(body?.error?.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.retryable = RETRYABLE_STATUS.has(response.status);
      throw err;
    } catch (err) {
      lastError = err;
      const retryable = err.retryable !== false; // network errors (no status) are retryable
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[${model}] attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.message}). Retrying in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
    console.error('GEMINI_API_KEY missing. Copy .env.example to .env, add your key, and rerun.');
    process.exitCode = 1;
    return;
  }

  const rows = readCsv(OUTPUT_FILE);
  const notes = readCsv(NOTES_FILE);
  const byId = new Map(notes.map(n => [n.note_id, n]));
  const eligible = rows.map((row, index) => ({ row, index, note: byId.get(row.matched_note_id) }))
    .filter(x => x.row.flagged === 'No (justified)' && x.note);

  const log = {
    provider: 'Google Gemini Developer API', model: MODEL,
    mode: 'one batched generation call; numeric verdicts and note IDs remain deterministic',
    llm_calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0,
    estimated_model_cost_usd: 0,
    cost_basis: 'Gemini API free-tier pricing; verify current tier and pricing in Google AI Studio. This estimate is not a billing guarantee.',
    fallback_rows: 0, timestamp_utc: new Date().toISOString()
  };

  if (!eligible.length) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n');
    console.log('No justified rows with matched notes; no Gemini call needed. Cost log updated.');
    return;
  }

  const evidence = eligible.map((x, i) => ({
    item: i,
    route: x.row.route,
    week_of: x.row.week_of,
    matched_note_id: x.note.note_id,
    note_date: x.note.date,
    exact_note_text: x.note.note
  }));
  const prompt = [
    'You write concise, plain-English explanations for a shipping-cost monitoring report.',
    'Use only the supplied note text. Do not invent facts, dates, impacts, causes, percentages, or recommendations.',
    'Do not change the verdict, route, week, or note ID. Numeric verdicts are computed by deterministic code.',
    'Return JSON only in this shape: {"explanations":[{"item":0,"explanation":"one or two short sentences"}]}.',
    'For each item, explain only how the supplied note could account for the already-matched route/week. If the note does not support a claim, say no more than the note states.',
    JSON.stringify(evidence)
  ].join('\n\n');

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          explanations: { type: 'ARRAY', items: {
            type: 'OBJECT', properties: {
              item: { type: 'INTEGER' }, explanation: { type: 'STRING' }
            }, required: ['item', 'explanation']
          } }
        }, required: ['explanations']
      }
    }
  };

  // Try each model in order: retries happen inside callGemini; if a model stays
  // overloaded/unavailable we move on to the next one.
  let result;
  let lastError;
  for (const model of MODELS_TO_TRY) {
    try {
      result = await callGemini(model, apiKey, requestBody);
      break;
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} failed: ${err.message}`);
      // Bad key / bad request / no permission: other models will not help.
      const canTryNextModel = err.status === undefined || err.status === 404 || RETRYABLE_STATUS.has(err.status);
      if (!canTryNextModel) break;
    }
  }

  if (!result) {
    // Gemini is optional: keep the deterministic reasons already in the CSV and exit cleanly.
    log.error = lastError?.message || 'Unknown Gemini error';
    log.fallback_rows = eligible.length;
    log.models_tried = MODELS_TO_TRY;
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n');
    console.warn(`Gemini API request failed after retries: ${log.error}. Check API key, model access, and free-tier quota.`);
    console.warn('Keeping deterministic reasons in the output CSV. Run this step again later to add AI explanations.');
    return;
  }

  const body = result.body;
  log.model = result.model;

  const usage = body.usageMetadata || {};
  log.llm_calls = 1;
  log.input_tokens = usage.promptTokenCount ?? 0;
  log.output_tokens = usage.candidatesTokenCount ?? 0;
  log.total_tokens = usage.totalTokenCount ?? (log.input_tokens + log.output_tokens);
  log.thought_tokens = usage.thoughtsTokenCount ?? 0;
  log.cached_content_tokens = usage.cachedContentTokenCount ?? 0;

  const rawText = body.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch {
    log.fallback_rows = eligible.length;
    log.response_parse_error = 'Gemini response was not valid JSON; deterministic reasons retained.';
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n');
    console.warn('Gemini response was not valid JSON. Keeping deterministic reasons.');
    return;
  }

  let applied = 0;
  for (const entry of (parsed.explanations || [])) {
    const target = Number.isInteger(entry.item) ? eligible[entry.item] : null;
    if (!target || typeof entry.explanation !== 'string' || !entry.explanation.trim()) continue;
    const explanation = entry.explanation.trim().replace(/\s+/g, ' ');
    // Keep citations generated by code, not by the model. Numeric verdict and matched_note_id never change.
    target.row.reason = `Not flagged: note ${target.note.note_id} dated ${target.note.date} applies to ${target.row.route} for week ${target.row.week_of}. AI-assisted explanation (grounded only in the retrieved note): ${explanation} Evidence: ${target.note.note}`;
    applied++;
  }
  log.rows_with_ai_explanation = applied;
  log.fallback_rows = eligible.length - applied;
  writeCsv(OUTPUT_FILE, OUTPUT_COLUMNS, rows);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n');
  console.log(JSON.stringify({ output: OUTPUT_FILE, log: LOG_FILE, model: log.model, rowsWithAiExplanation: applied, fallbackRows: log.fallback_rows, usage: { inputTokens: log.input_tokens, outputTokens: log.output_tokens, totalTokens: log.total_tokens }, calls: log.llm_calls }, null, 2));
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });