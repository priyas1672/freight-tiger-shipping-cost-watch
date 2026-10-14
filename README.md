# Freight Tiger — Shipping Cost Watch (Node.js)

A deterministic route-week shipping-cost analysis pipeline with conservative, evidence-grounded retrieval over the supplied context notes and a small result-grounded command-line Q&A helper.

## Requirements
- Node.js 18+
- Node.js 20+ recommended (Node.js 24 tested locally); no packages are needed for deterministic mode. Optional Gemini enrichment requires a free-tier API key from Google AI Studio.

## Run
```bash
npm start       # generate output/shipping_cost_analysis.csv
npm test        # core smoke tests
npm run eval    # labelled route/date evidence retrieval checks
npm run repro   # run three times and compare SHA-256 hashes
npm run ask -- "Why did Chennai-Bangalore get pricier in March?"
# Optional AI explanation enrichment (requires .env with GEMINI_API_KEY)
npm run ai:explain
```

## Data and calculations
- Route key is directed `origin-destination` plus the provided `route_type` (Short/Medium/Long).
- Week starts Monday (UTC date bucketing).
- Weekly cost per tonne-km = sum of freight cost / sum of (quantity tonnes × distance km). It is a weighted ratio, not an average of individual shipment ratios.
- Own-history baseline = arithmetic mean of up to the last 8 available route-week costs strictly before the current week. With fewer than 8 prior route-weeks, all available prior weeks are used; no future weeks are included.
- Similar-route baseline = arithmetic mean of all other route-week costs in the same week and same `route_type`, excluding the current route.
- Alert defaults: >= +10% versus own history OR >= +15% versus same-week peers. The brief does not specify thresholds, so these are disclosed engineering choices, not company-defined values.
- Output column names/order match `sample_output_format_v2.csv`.

## Evidence retrieval and guardrails
The provided notes are short and structured. For this dataset, retrieval is implemented as deterministic, conservative route/date rules so it can be audited and reproduced without external APIs. Only positive cost-increase evidence can justify a cost rise: N001 Chennai-Bangalore flooding during weeks beginning 2025-02-24 and 2025-03-03; N002 Ahmedabad-Mumbai festival surcharge for week 2025-01-20; N003 nationwide diesel price increase starting week 2025-05-05. Notes describing stable demand, unaffected costs, unrelated routes, or improved conditions cannot justify a rise. `matched_note_id` is blank when no qualifying evidence matches.

This is **not an embedding/vector database or an LLM-generated RAG system**. It is a local retrieval baseline tailored to the supplied small note set. This choice avoids invented causes and API costs. The Q&A command answers from generated results and retrieved notes only; it does not call a generative model. A production extension could replace retrieval with embeddings and add an LLM for paraphrasing, while keeping the numeric verdict deterministic and requiring cited evidence.

## Evaluation and reproducibility
- `npm test` validates week bucketing, output schema and verdict/note guardrails.
- `npm run eval` checks eight hand-labelled route/date retrieval cases, including negative cases for wrong route, expired date range, stable demand and unaffected tolls.
- `npm run repro` executes three full runs, saves each CSV, compares SHA-256 hashes, and writes `logs/reproducibility.json`. Numeric values and verdicts should match exactly.

## Optional Gemini free-tier explanation enrichment

The core analysis remains deterministic: Gemini must never choose the anomaly verdict or matched note ID. Retrieval and route/date checks run locally first; `npm run ai:explain` sends only already-justified rows and their exact matched note text in one batched Gemini request to produce short paraphrases. The code then writes the citation (note ID, date, route, week and exact evidence) itself. If the response is invalid, deterministic reasons are retained.

Setup on Windows PowerShell:
1. Open Google AI Studio at https://aistudio.google.com/ and create an API key for the Gemini Developer API. Check the current free-tier availability and quotas in AI Studio; limits can vary by model/account.
2. Copy `.env.example` to `.env` in this project root.
3. Open `.env` and replace `PASTE_YOUR_GEMINI_API_KEY_HERE` with your key. Do not include quotes unless needed, do not share the key, and never commit `.env` to GitHub (`.gitignore` excludes it).
4. Run `npm start` first, then `npm run ai:explain`. This makes one batched LLM call for rows with matched supporting notes, not one call per shipment.
5. Inspect `logs/llm_cost_log.json`; it records actual token counts returned by the API. The cost estimate assumes the account is actually on the free tier; verify current pricing/usage in AI Studio. Free-tier data handling may differ from paid-tier handling, so use only the supplied sample dataset.

This is a lightweight retrieval-augmented generation (RAG) approach over the small supplied note set, not a vector database. The numeric analysis, threshold decision, and `matched_note_id` remain deterministic and are not delegated to the LLM.

## Token and cost log
`logs/llm_cost_log.json` starts with zero calls until the optional Gemini command is run. After a successful API call, it records usage metadata from Gemini. Zero calls/tokens mean no LLM was called; they are not fabricated estimates. Local CPU/runtime costs are not included.

## Limitations and trade-offs
- Thresholds are configurable defaults because the brief supplies no threshold values.
- Note dates are interpreted conservatively; ambiguous notes are not stretched beyond stated timing.
- The Q&A helper is rule-based, not open-ended generative conversation.
- The labelled evaluation set is small and manually curated; it is a transparent sanity check, not proof of general accuracy.

## 10-minute Round 2 walkthrough
1. Problem and inputs (1 min)
2. Weighted weekly cost formula and Monday week bucketing (2 min)
3. Strictly-past 8-week baseline and same-week route-type peer baseline (2 min)
4. Threshold choices and trade-offs (1 min)
5. Evidence retrieval, note IDs, and no-guessing policy (2 min)
6. Tests, evaluation cases, three-run hashes, and honest zero-LLM cost log (2 min)
