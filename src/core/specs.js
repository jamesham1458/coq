// What each measurement is, where it is best measured, and what range counts as
// sound. The ranges are deliberately wide: they mark what proficient shooters have
// in common, not one "correct" form. Sources and reasoning are in docs/REFERENCE.md.
//
// Weights follow the evidence: traits with a measured link to accuracy (elbow under
// the ball, lean at release, release timing for the distance) weigh most; traits that
// good shooters differ on (set-point height, base width, a brief set) weigh least.
//
// `ideal`  the range that scores full marks
// `ok`     the wider range that is acceptable but worth watching
// Outside `ok` the measurement is reported as something to fix.
// `tight` / `loose` are shot-to-shot standard deviations: at or under `tight` is
// consistent, over `loose` is inconsistent.

const INF = Infinity;

/** Camera-view groups, in order of preference, that each kind of measurement can come from. */
export const SOURCES = Object.freeze({
  /** angles in the plane of the shot: the side view reads them directly; other views fall back to 3D */
  sagittal: [['side'], ['diagonal'], ['front', 'back']],
  /** only meaningful in the plane of the shot */
  sideOnly: [['side']],
  /** across the body: front and back views are pooled */
  frontal: [['front', 'back']],
  /** heights: read directly from the side; elsewhere each angle stands alone (never pooled) */
  height: [['side'], ['diagonal'], ['front'], ['back']],
  /** timing does not depend on the camera angle, so every shot counts */
  any: [['side', 'diagonal', 'front', 'back']],
});

export const CATEGORIES = Object.freeze([
  { id: 'base', label: 'Base and load' },
  { id: 'set', label: 'Set point' },
  { id: 'release', label: 'Release' },
  { id: 'follow', label: 'Follow-through' },
  { id: 'balance', label: 'Balance' },
  { id: 'rhythm', label: 'Rhythm' },
]);

/**
 * @typedef {Object} MetricSpec
 * @property {string} id
 * @property {string} label
 * @property {string} category
 * @property {string} unit       'deg' | 'pct' (percent of body height) | 'ms' | 's' | 'ratio' | 'x' | 'cm'
 * @property {keyof typeof SOURCES} source
 * @property {[number, number]} [ideal]
 * @property {[number, number]} [ok]
 * @property {number} weight     importance for the form score (0 = information only)
 * @property {number} [tight]
 * @property {number} [loose]
 * @property {number} [consistencyWeight]
 * @property {number} digits     decimals to display
 * @property {string} what       one plain sentence on what is measured
 */

/** @type {MetricSpec[]} */
export const METRICS = Object.freeze([
  // ---- Base and load -----------------------------------------------------------------
  {
    id: 'kneeBend', label: 'Knee bend at the dip', category: 'base', unit: 'deg', source: 'sagittal',
    ideal: [95, 125], ok: [85, 136], weight: 0.7, tight: 4, loose: 8, consistencyWeight: 0.4, digits: 0,
    what: 'Knee angle at the deepest point of your load (180 is a straight leg).',
  },
  {
    id: 'stanceWidth', label: 'Base width', category: 'base', unit: 'x', source: 'frontal',
    ideal: [0.75, 1.35], ok: [0.6, 1.6], weight: 0.4, tight: 0.08, loose: 0.18, consistencyWeight: 0.3, digits: 2,
    what: 'Distance between your ankles as a multiple of your shoulder width, at the dip.',
  },
  {
    id: 'kneeTrack', label: 'Knee tracking', category: 'base', unit: 'x', source: 'frontal',
    ideal: [0.85, 1.3], ok: [0.72, 1.45], weight: 0.4, tight: 0.08, loose: 0.18, consistencyWeight: 0.2, digits: 2,
    what: 'How far apart your knees are at the dip, compared with where they would be on a straight line from hip to ankle. 1 is on that line; under 1 means the knees have fallen inside it.',
  },
  // ---- Set point -----------------------------------------------------------------------
  {
    id: 'setElbow', label: 'Elbow angle at the set point', category: 'set', unit: 'deg', source: 'sagittal',
    ideal: [58, 88], ok: [50, 100], weight: 0.6, tight: 4, loose: 8, consistencyWeight: 0.8, digits: 0,
    what: 'How bent your shooting elbow is at the moment the arm starts to push.',
  },
  {
    id: 'setHeight', label: 'Set-point height', category: 'set', unit: 'pct', source: 'height',
    ideal: [-4, 16], ok: [-9, 20], weight: 0.4, tight: 1.5, loose: 3, consistencyWeight: 0.8, digits: 1,
    what: 'Height of your shooting wrist relative to your eyes when the push starts, as a percentage of your height.',
  },
  {
    id: 'elbowFlare', label: 'Elbow under the ball', category: 'set', unit: 'deg', source: 'frontal',
    ideal: [-10, 15], ok: [-18, 26], weight: 0.9, tight: 4, loose: 8, consistencyWeight: 0.8, digits: 0,
    what: 'How far your forearm leans inward from the elbow at the set point, seen from the front or back. Zero is a vertical forearm with the elbow directly under the hand.',
  },
  {
    id: 'setLine', label: 'Ball line at the set point', category: 'set', unit: 'ratio', source: 'frontal',
    ideal: [0.3, 1.2], ok: [0.05, 1.45], weight: 0.6, tight: 0.12, loose: 0.25, consistencyWeight: 0.6, digits: 2,
    what: 'Where your shooting hand sits across your body at the set point: 0 is the middle of your head, 1 is directly over your shooting shoulder.',
  },
  {
    id: 'setPause', label: 'Pause at the set point', category: 'set', unit: 'ms', source: 'sagittal',
    ideal: [-INF, 200], ok: [-INF, 320], weight: 0.5, tight: 40, loose: 90, consistencyWeight: 0.4, digits: 0,
    what: 'How long your arm waits at the set point before it starts to extend.',
  },
  // ---- Release -------------------------------------------------------------------------
  {
    id: 'armExtension', label: 'Elbow extension', category: 'release', unit: 'deg', source: 'sagittal',
    ideal: [160, INF], ok: [150, INF], weight: 0.7, tight: 4, loose: 8, consistencyWeight: 0.6, digits: 0,
    what: 'How straight your shooting elbow gets once the extension has finished.',
  },
  {
    id: 'armAngle', label: 'Arm angle at full extension', category: 'release', unit: 'deg', source: 'sagittal',
    ideal: [42, 70], ok: [35, 78], weight: 0.6, tight: 3.5, loose: 7, consistencyWeight: 1, digits: 0,
    what: 'Angle of the line from your shoulder to your wrist above the horizontal when your arm is fully extended.',
  },
  {
    id: 'reachHeight', label: 'Release height', category: 'release', unit: 'pct', source: 'height',
    ideal: [11, INF], ok: [7, INF], weight: 0.5, tight: 1.5, loose: 3, consistencyWeight: 0.8, digits: 1,
    what: 'How far above your eyes your shooting wrist gets at the top of the release, as a percentage of your height.',
  },
  {
    id: 'releaseVsApex', label: 'Release timing against the jump', category: 'release', unit: 'ms', source: 'any',
    ideal: [-130, 25], ok: [-200, 65], weight: 0.7, tight: 25, loose: 50, consistencyWeight: 1, digits: 0,
    what: 'When the ball leaves relative to the top of your jump. Negative is on the way up, positive is on the way down.',
  },
  {
    id: 'guideFollow', label: 'Guide hand', category: 'release', unit: 'pctOf', source: 'frontal',
    ideal: [-INF, 35], ok: [-INF, 55], weight: 0.5, tight: 12, loose: 25, consistencyWeight: 0.3, digits: 0,
    what: 'How much of your shooting hand’s upward travel your guide hand copies during the push. A guide hand that comes off cleanly copies little of it.',
  },
  // ---- Follow-through ---------------------------------------------------------------------
  {
    id: 'followHold', label: 'Follow-through hold', category: 'follow', unit: 's', source: 'any',
    ideal: [0.5, INF], ok: [0.3, INF], weight: 0.5, tight: 0.12, loose: 0.25, consistencyWeight: 0.3, digits: 2,
    what: 'How long your arm stays extended above eye level after the release.',
  },
  {
    id: 'finishLine', label: 'Follow-through line', category: 'follow', unit: 'ratio', source: 'frontal',
    ideal: [0.25, 1.35], ok: [-0.05, 1.65], weight: 0.6, tight: 0.12, loose: 0.25, consistencyWeight: 0.8, digits: 2,
    what: 'Where your shooting hand finishes across your body: 0 is the middle of your head, 1 is directly over your shooting shoulder.',
  },
  // ---- Balance -------------------------------------------------------------------------
  {
    id: 'trunkLean', label: 'Lean at release', category: 'balance', unit: 'deg', source: 'sideOnly',
    ideal: [-7, 5], ok: [-13, 10], weight: 0.8, tight: 2.5, loose: 5, consistencyWeight: 0.6, digits: 0,
    what: 'How far your trunk leans at release, seen from the side. Positive is toward the basket, negative is away from it.',
  },
  {
    id: 'driftForward', label: 'Forward drift', category: 'balance', unit: 'pct', source: 'sideOnly',
    ideal: [-1, 13], ok: [-5, 20], weight: 0.5, tight: 2, loose: 4.5, consistencyWeight: 0.5, digits: 1,
    what: 'How far your feet travel between take-off and landing along the line of the shot, as a percentage of your height. Positive is toward the basket.',
  },
  {
    id: 'sideLean', label: 'Side lean at release', category: 'balance', unit: 'deg', source: 'frontal',
    ideal: [-4, 4], ok: [-8, 8], weight: 0.6, tight: 2, loose: 4, consistencyWeight: 0.5, digits: 0,
    what: 'How far your trunk leans sideways at release, seen from the front or back. Positive is toward your shooting side.',
  },
  {
    id: 'driftSide', label: 'Sideways drift', category: 'balance', unit: 'pct', source: 'frontal',
    ideal: [-5, 5], ok: [-11, 11], weight: 0.4, tight: 1.5, loose: 3.5, consistencyWeight: 0.4, digits: 1,
    what: 'How far your feet travel sideways between take-off and landing, as a percentage of your height. Positive is toward your shooting side.',
  },
  // ---- Rhythm (reported and tracked for consistency, not judged against a target) -----------
  {
    id: 'tempo', label: 'Dip-to-release time', category: 'rhythm', unit: 's', source: 'any',
    weight: 0, tight: 0.035, loose: 0.07, consistencyWeight: 1, digits: 2,
    what: 'Time from the deepest point of your dip to the release.',
  },
  {
    id: 'jumpHeight', label: 'Jump height', category: 'rhythm', unit: 'cm', source: 'any',
    weight: 0, tight: 2.5, loose: 5, consistencyWeight: 0.4, digits: 0,
    what: 'How high you jump, worked out from your time in the air.',
  },
]);

export const METRIC_BY_ID = Object.freeze(Object.fromEntries(METRICS.map((m) => [m.id, m])));

/**
 * Ranges that depend on how far from the basket the shots were taken. Shooters
 * release earlier in the jump and travel further forward as the distance grows,
 * so one fixed range would mark normal long-range shooting as a fault.
 */
export const BY_DISTANCE = Object.freeze({
  close: {
    releaseVsApex: { ideal: [-110, 70], ok: [-180, 120] },
    driftForward: { ideal: [-2, 12], ok: [-6, 19] },
  },
  mid: {
    releaseVsApex: { ideal: [-140, 40], ok: [-210, 90] },
    driftForward: { ideal: [-2, 17], ok: [-6, 25] },
  },
  three: {
    releaseVsApex: { ideal: [-180, 10], ok: [-250, 55] },
    driftForward: { ideal: [-2, 27], ok: [-6, 35] },
  },
});

/** The ranges in force for a metric given the session context. */
export function rangesFor(id, ctx = {}) {
  const spec = METRIC_BY_ID[id];
  if (!spec) return null;
  const table = BY_DISTANCE[ctx.distance] || BY_DISTANCE.mid;
  const over = table[id];
  return over ? { ideal: over.ideal, ok: over.ok } : { ideal: spec.ideal, ok: spec.ok };
}

/** Fewest shots for a spread (standard deviation) to be reported at all. */
export const MIN_SHOTS_FOR_SPREAD = 4;

/** Weight multipliers applied to a finding according to how trustworthy the reading is. */
export const CONFIDENCE_WEIGHT = Object.freeze({ high: 1, medium: 0.85, low: 0.6 });
