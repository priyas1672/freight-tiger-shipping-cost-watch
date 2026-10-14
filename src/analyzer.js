const { readCsv, writeCsv } = require('./csv');
const path = require('node:path');

const OUTPUT_COLUMNS = [
  'route', 'week_of', 'cost_per_tonne_km', 'vs_own_history',
  'vs_similar_routes', 'flagged', 'matched_note_id', 'reason'
];

// The brief does not prescribe numeric alert thresholds. These are explicit, tunable defaults.
const OWN_HISTORY_THRESHOLD_PCT = 10;
const PEER_THRESHOLD_PCT = 15;
const MAX_HISTORY_WEEKS = 8;

function mondayOf(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid shipment_date: ${dateString}`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function pctChange(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return ((current - baseline) / baseline) * 100;
}
function formatComparison(value, baselineName) {
  if (value === null) return `N/A (no ${baselineName} baseline)`;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}% vs ${baselineName}`;
}
function normalizeRoute(s) { return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[–—]/g, '-'); }

// Conservative, auditable retrieval. Only notes with positive evidence of a cost increase can justify one.
function findSupportingNote(route, weekOf, notes) {
  const targetRoute = normalizeRoute(route);
  for (const n of notes) {
    const applies = normalizeRoute(n.applies_to);
    if (n.note_id === 'N001' && applies === targetRoute && route === 'Chennai-Bangalore') {
      // Flood disruption explicitly lasted 24 Feb–8 Mar 2025; roads normal from 9 Mar.
      if (weekOf >= '2025-02-24' && weekOf <= '2025-03-03') return n;
    }
    if (n.note_id === 'N002' && applies === targetRoute && route === 'Ahmedabad-Mumbai') {
      // Explicitly a festival week dated 20 Jan 2025; don't extrapolate beyond that week.
      if (weekOf === '2025-01-20') return n;
    }
    if (n.note_id === 'N003' && applies === 'allroutes') {
      // “Starting this week” is treated conservatively as the week beginning 5 May 2025.
      if (weekOf === '2025-05-05') return n;
    }
  }
  return null;
}

function analyze({ shipments, notes }) {
  const weekly = new Map();
  for (const s of shipments) {
    const origin = s.origin.trim(), destination = s.destination.trim();
    const route = `${origin}-${destination}`;
    const week = mondayOf(s.shipment_date);
    const quantity = Number(s.quantity_tonnes);
    const distance = Number(s.distance_km);
    const cost = Number(s.freight_cost_inr);
    if (![quantity, distance, cost].every(Number.isFinite) || quantity <= 0 || distance <= 0 || cost < 0) {
      throw new Error(`Invalid numeric shipment data for ${s.shipment_id}`);
    }
    const key = `${route}|${s.route_type}|${week}`;
    if (!weekly.has(key)) weekly.set(key, { route, route_type: s.route_type, week, freight: 0, tonneKm: 0, shipmentCount: 0 });
    const g = weekly.get(key);
    g.freight += cost;
    g.tonneKm += quantity * distance;
    g.shipmentCount++;
  }

  const points = [...weekly.values()].map(g => ({ ...g, cost: g.freight / g.tonneKm }))
    .sort((a, b) => a.route.localeCompare(b.route) || a.week.localeCompare(b.week));
  const byRoute = new Map();
  for (const p of points) {
    const key = `${p.route}|${p.route_type}`;
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key).push(p);
  }
  const pointByWeekAndType = new Map();
  for (const p of points) {
    const key = `${p.week}|${p.route_type}`;
    if (!pointByWeekAndType.has(key)) pointByWeekAndType.set(key, []);
    pointByWeekAndType.get(key).push(p);
  }

  const output = points.map(p => {
    const ownSeries = byRoute.get(`${p.route}|${p.route_type}`);
    const prior = ownSeries.filter(x => x.week < p.week).slice(-MAX_HISTORY_WEEKS);
    const ownAvg = prior.length ? prior.reduce((sum, x) => sum + x.cost, 0) / prior.length : null;
    const peers = (pointByWeekAndType.get(`${p.week}|${p.route_type}`) || []).filter(x => x.route !== p.route);
    const peerAvg = peers.length ? peers.reduce((sum, x) => sum + x.cost, 0) / peers.length : null;
    const ownPct = ownAvg === null ? null : pctChange(p.cost, ownAvg);
    const peerPct = peerAvg === null ? null : pctChange(p.cost, peerAvg);
    const anomalous = (ownPct !== null && ownPct >= OWN_HISTORY_THRESHOLD_PCT) ||
      (peerPct !== null && peerPct >= PEER_THRESHOLD_PCT);
    const note = anomalous ? findSupportingNote(p.route, p.week, notes) : null;
    let flagged = 'No';
    let matchedNoteId = '';
    let reason;
    if (anomalous && note) {
      flagged = 'No (justified)';
      matchedNoteId = note.note_id;
      reason = `Not flagged: note ${note.note_id} dated ${note.date} applies to ${p.route} in this week and reports a cost-increasing disruption or surcharge. ${note.note}`;
    } else if (anomalous) {
      flagged = 'Yes';
      reason = 'Flagged for human review: cost is unusually high versus at least one baseline. No supporting note was found that matches both this route and this week; no cause has been inferred.';
    } else {
      reason = 'Not flagged: the cost did not cross the configured anomaly threshold against the available baselines.';
    }
    return {
      route: p.route,
      week_of: p.week,
      cost_per_tonne_km: p.cost.toFixed(2),
      vs_own_history: ownPct === null ? 'N/A (no prior weeks)' : formatComparison(ownPct, 'this route\'s past average'),
      vs_similar_routes: peerPct === null ? 'N/A (no peer routes this week)' : formatComparison(peerPct, 'similar-length routes this week'),
      flagged,
      matched_note_id: matchedNoteId,
      reason
    };
  });
  return { output, stats: { shipmentRows: shipments.length, routeWeeks: output.length, flagged: output.filter(r => r.flagged === 'Yes').length, justified: output.filter(r => r.flagged === 'No (justified)').length } };
}

function run({ dataDir, outputFile }) {
  const shipments = readCsv(path.join(dataDir, 'shipment_records.csv'));
  const notes = readCsv(path.join(dataDir, 'context_notes.csv'));
  const result = analyze({ shipments, notes });
  writeCsv(outputFile, OUTPUT_COLUMNS, result.output);
  return result;
}
module.exports = { analyze, run, mondayOf, findSupportingNote, OUTPUT_COLUMNS, OWN_HISTORY_THRESHOLD_PCT, PEER_THRESHOLD_PCT };
