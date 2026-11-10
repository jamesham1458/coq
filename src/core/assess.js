// Turns measured shots into an assessment: each measurement judged against its
// target range, shot-to-shot consistency, category and overall scores, and a ranked
// list of findings. Works for one shot (quick check) or many shots across several
// camera angles (full assessment).

import { METRICS, METRIC_BY_ID, SOURCES, CATEGORIES, MIN_SHOTS_FOR_SPREAD, CONFIDENCE_WEIGHT, rangesFor } from './specs.js';
import { summarize, sdBounds, mean, sd } from './stats.js';

const CONF_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Judge one value against a metric's ranges.
 * @returns {{ status: 'good'|'watch'|'fix'|'info', score: number, direction: 'low'|'high'|null }}
 */
export function judge(spec, value, ranges = spec) {
  if (!ranges.ideal || !Number.isFinite(value)) return { status: 'info', score: NaN, direction: null };
  const [a, b] = ranges.ideal;
  const [c, d] = ranges.ok || ranges.ideal;
  if (value >= a && value <= b) return { status: 'good', score: 100, direction: null };
  const low = value < a;
  const dist = low ? a - value : value - b;
  let gap = low ? a - c : d - b;
  if (!Number.isFinite(gap) || gap <= 0) {
    const width = Number.isFinite(b - a) ? b - a : Math.max(1, Math.abs(low ? a : b));
    gap = 0.25 * width;
  }
  if (dist <= gap) return { status: 'watch', score: 100 - (30 * dist) / gap, direction: low ? 'low' : 'high' };
  return { status: 'fix', score: Math.max(20, 70 - (50 * (dist - gap)) / gap), direction: low ? 'low' : 'high' };
}

/** Rate a shot-to-shot standard deviation. */
export function rateSpread(spec, spread, n) {
  if (!(spec.tight > 0) || !(spec.loose > spec.tight) || !(n >= MIN_SHOTS_FOR_SPREAD) || !Number.isFinite(spread)) return null;
  let rating;
  let score;
  if (spread <= spec.tight) {
    rating = 'tight';
    score = 100;
  } else if (spread <= spec.loose) {
    rating = 'moderate';
    score = 100 - (35 * (spread - spec.tight)) / (spec.loose - spec.tight);
  } else {
    rating = 'loose';
    score = Math.max(15, 65 - (50 * (spread - spec.loose)) / spec.loose);
  }
  const [lo, hi] = sdBounds(n);
  return { rating, score, sd: spread, n, likelyLow: spread * lo, likelyHigh: spread * hi };
}

const SPREAD_BUCKETS = Object.freeze({
  release: ['setElbow', 'setHeight', 'elbowFlare', 'setLine', 'armExtension', 'armAngle', 'reachHeight', 'finishLine'],
  timing: ['tempo', 'releaseVsApex', 'setPause'],
  base: ['kneeBend', 'stanceWidth', 'jumpHeight'],
  balance: ['trunkLean', 'driftForward', 'sideLean', 'driftSide'],
});

function weightedMean(items) {
  let sw = 0;
  let s = 0;
  for (const [value, weight] of items) {
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    s += value * weight;
    sw += weight;
  }
  return sw > 0 ? s / sw : NaN;
}

function commonConfidence(confs) {
  if (!confs.length) return 'low';
  const count = { high: 0, medium: 0, low: 0 };
  for (const c of confs) count[c] = (count[c] || 0) + 1;
  let best = 'low';
  for (const c of ['medium', 'high']) {
    if (count[c] > count[best] || (count[c] === count[best] && CONF_RANK[c] < CONF_RANK[best])) best = c;
  }
  // A majority label, but never better than the worst third of the readings.
  if (count.low * 3 >= confs.length) return 'low';
  if (best === 'high' && count.medium * 3 >= confs.length) return 'medium';
  return best;
}

/**
 * @typedef {Object} ShotRecord
 * @property {string} view                      'side' | 'front' | 'back' | 'diagonal'
 * @property {Record<string, {value:number, conf:string}>} metrics
 * @property {boolean|null} [made]              true = make, false = miss, null/undefined = not marked
 */

/**
 * Assess a set of shots.
 * @param {ShotRecord[]} shots
 * @param {{ distance?: 'close'|'mid'|'three' }} [ctx]  session context that shifts some targets
 * @returns {object} assessment (see the fields built below)
 */
export function assessSession(shots, ctx = {}) {
  const byView = {};
  for (const s of shots) byView[s.view] = (byView[s.view] || 0) + 1;

  const metrics = {};
  const missing = [];
  for (const spec of METRICS) {
    const groups = SOURCES[spec.source];
    let used = null;
    let rows = [];
    for (const group of groups) {
      rows = shots.filter((s) => group.includes(s.view) && s.metrics[spec.id] && Number.isFinite(s.metrics[spec.id].value));
      if (rows.length) {
        used = group;
        break;
      }
    }
    if (!rows.length) {
      missing.push({ id: spec.id, needs: groups[0] });
      continue;
    }
    const values = rows.map((s) => s.metrics[spec.id].value);
    const sum = summarize(values);
    const conf = commonConfidence(rows.map((s) => s.metrics[spec.id].conf));
    const ranges = rangesFor(spec.id, ctx);
    const j = judge(spec, sum.mean, ranges);
    const spread = rateSpread(spec, sum.sd, sum.n);
    const capped = rows.some((s) => s.metrics[spec.id].note === 'capped');
    metrics[spec.id] = {
      id: spec.id,
      n: sum.n,
      mean: sum.mean,
      sd: sum.sd,
      min: sum.min,
      max: sum.max,
      values,
      made: rows.map((s) => (s.made === true ? 1 : s.made === false ? 0 : null)),
      views: [...new Set(rows.map((s) => s.view))],
      // true when the measurement had to come from a less suitable camera angle
      fallback: used !== groups[0],
      conf,
      capped,
      // the target ranges this value was judged against (they can depend on shot distance)
      ideal: ranges.ideal || null,
      ok: ranges.ok || null,
      status: j.status,
      score: j.score,
      direction: j.direction,
      spread,
    };
  }

  // ---- Scores ---------------------------------------------------------------------------
  const judged = Object.values(metrics).filter((m) => m.status !== 'info');
  const formWeight = (m) => METRIC_BY_ID[m.id].weight * CONFIDENCE_WEIGHT[m.conf];
  const categories = CATEGORIES.map((cat) => {
    const members = Object.values(metrics).filter((m) => METRIC_BY_ID[m.id].category === cat.id);
    const scored = members.filter((m) => m.status !== 'info');
    return {
      id: cat.id,
      label: cat.label,
      metrics: members.map((m) => m.id),
      score: weightedMean(scored.map((m) => [m.score, formWeight(m)])),
    };
  }).filter((c) => c.metrics.length);
  const form = weightedMean(judged.map((m) => [m.score, formWeight(m)]));
  const spreadItems = Object.values(metrics).filter((m) => m.spread && METRIC_BY_ID[m.id].consistencyWeight > 0);
  const consistency = weightedMean(spreadItems.map((m) => [m.spread.score, METRIC_BY_ID[m.id].consistencyWeight * CONFIDENCE_WEIGHT[m.conf]]));
  const overall = Number.isFinite(consistency) && Number.isFinite(form) ? 0.65 * form + 0.35 * consistency : form;

  // ---- Findings -------------------------------------------------------------------------
  const findings = [];
  for (const m of judged) {
    if (m.status === 'good') continue;
    findings.push({
      kind: 'form',
      key: `${m.id}.${m.direction}`,
      metric: m.id,
      status: m.status,
      conf: m.conf,
      priority: (100 - m.score) * formWeight(m),
    });
  }
  for (const [bucket, ids] of Object.entries(SPREAD_BUCKETS)) {
    const loose = ids.map((id) => metrics[id]).filter((m) => m && m.spread && m.spread.rating === 'loose');
    if (!loose.length) continue;
    const priority = loose.reduce((acc, m) => acc + (100 - m.spread.score) * METRIC_BY_ID[m.id].consistencyWeight * CONFIDENCE_WEIGHT[m.conf], 0) * 0.55;
    findings.push({
      kind: 'spread',
      key: `spread.${bucket}`,
      metrics: loose.map((m) => m.id),
      status: 'watch',
      conf: commonConfidence(loose.map((m) => m.conf)),
      priority: Math.min(priority, 60),
    });
  }
  findings.sort((x, y) => y.priority - x.priority);

  const strengths = judged
    .filter((m) => m.status === 'good' && METRIC_BY_ID[m.id].weight >= 0.7 && m.conf !== 'low')
    .sort((x, y) => METRIC_BY_ID[y.id].weight - METRIC_BY_ID[x.id].weight)
    .map((m) => ({ kind: 'form', metric: m.id }));
  for (const m of spreadItems) {
    if (m.spread.rating === 'tight' && METRIC_BY_ID[m.id].consistencyWeight >= 0.8 && m.conf !== 'low') {
      strengths.push({ kind: 'spread', metric: m.id });
    }
  }

  return {
    shotCount: shots.length,
    byView,
    metrics,
    missing,
    categories,
    scores: { form, consistency, overall },
    findings,
    strengths,
    makeMiss: compareMakesAndMisses(metrics),
  };
}

/**
 * Where makes and misses were marked, find the measurements that differ most
 * between them. Needs at least three of each for a measurement to be considered.
 */
export function compareMakesAndMisses(metrics) {
  const rows = [];
  for (const m of Object.values(metrics)) {
    const makes = [];
    const misses = [];
    m.values.forEach((v, k) => {
      if (m.made[k] === 1) makes.push(v);
      else if (m.made[k] === 0) misses.push(v);
    });
    if (makes.length < 3 || misses.length < 3) continue;
    const sm = sd(makes);
    const sx = sd(misses);
    const pooled = Math.sqrt(((makes.length - 1) * sm * sm + (misses.length - 1) * sx * sx) / (makes.length + misses.length - 2));
    if (!(pooled > 1e-9)) continue;
    const diff = mean(misses) - mean(makes);
    const effect = diff / pooled;
    if (Math.abs(effect) < 0.8) continue;
    rows.push({ metric: m.id, makes: mean(makes), misses: mean(misses), nMakes: makes.length, nMisses: misses.length, diff, effect });
  }
  rows.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
  return rows.slice(0, 3);
}

/**
 * Compact, storable form of one analysed shot.
 * @returns {ShotRecord & { clip:number, t:number, jump:boolean }}
 */
export function toShotRecord(shot, clipIndex) {
  const metrics = {};
  for (const [id, m] of Object.entries(shot.metrics)) {
    metrics[id] = m.note ? { value: round(m.value), conf: m.conf, note: m.note } : { value: round(m.value), conf: m.conf };
  }
  return { clip: clipIndex, view: shot.view, t: round(shot.t.release), jump: !!shot.jump, made: shot.made ?? null, metrics };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Compare two assessments of the same shooter (older first). Returns, per shared
 * metric, the change in mean and in spread, and whether the change moved the
 * measurement toward or away from its target.
 */
export function compareAssessments(before, after) {
  const out = [];
  for (const spec of METRICS) {
    const a = before.metrics[spec.id];
    const b = after.metrics[spec.id];
    if (!a || !b) continue;
    const row = { metric: spec.id, before: a.mean, after: b.mean, change: b.mean - a.mean, trend: 'same' };
    if (a.status !== 'info') {
      const ds = b.score - a.score;
      row.trend = ds > 4 ? 'better' : ds < -4 ? 'worse' : 'same';
      row.scoreChange = ds;
    }
    if (a.spread && b.spread) {
      row.spreadBefore = a.spread.sd;
      row.spreadAfter = b.spread.sd;
      row.spreadTrend = b.spread.sd < a.spread.sd * 0.85 ? 'tighter' : b.spread.sd > a.spread.sd * 1.15 ? 'looser' : 'same';
    }
    out.push(row);
  }
  return out;
}
