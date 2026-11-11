import { test } from 'node:test';
import assert from 'node:assert/strict';

import { angle2, angle3, tiltFromUp, elevation2, firstUpCrossing, refineExtremum } from '../src/core/geometry.js';
import { fillGaps, lowpass, derivative, resample } from '../src/core/filter.js';
import { sd, mean, sdBounds, quantile } from '../src/core/stats.js';
import { synthClip, synthSession, makeRng } from '../src/core/synth.js';
import { prepareTrack } from '../src/core/track.js';
import { findShots, guessHand } from '../src/core/shots.js';
import { analyzeClip } from '../src/core/analyze.js';
import { assessSession, judge, rateSpread, toShotRecord, compareAssessments } from '../src/core/assess.js';
import { METRIC_BY_ID, METRICS } from '../src/core/specs.js';

const NOISY = { fps: 30, noiseImage: 0.004, noiseWorld: 0.012 };
const SIDE = { yawDeg: 90 };
const FRONT = { yawDeg: 0 };
const BACK = { yawDeg: 180 };

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected} within ${tol}, got ${actual}`);
}

function analyse(shots, cam, opts = {}, aopts = {}) {
  const clip = synthClip(shots, cam, { ...NOISY, ...opts });
  const res = analyzeClip(clip, { hand: shots[0].hand || 'right', heightM: 1.8, ...aopts });
  return { clip, res };
}

function records(res) {
  return res.shots.map((s, k) => toShotRecord(s, 0));
}

// ---- Building blocks ------------------------------------------------------------------

test('angles', () => {
  near(angle2(1, 0, 0, 0, 0, 1), 90, 1e-9, 'right angle');
  near(angle2(-1, 0, 0, 0, 1, 0), 180, 1e-9, 'straight');
  near(angle3(1, 0, 0, 0, 0, 0, 0, 0, 1), 90, 1e-9, '3D right angle');
  assert.ok(Number.isNaN(angle2(0, 0, 0, 0, 1, 1)));
  near(tiltFromUp(0, -1), 0, 1e-9, 'straight up');
  near(tiltFromUp(1, -1), 45, 1e-9, 'leaning to +x');
  near(elevation2(1, -1, 1), 45, 1e-9, 'up and forward');
  near(elevation2(-1, -1, -1), 45, 1e-9, 'up and forward when facing image-left');
  near(elevation2(-1, -1, 1), 135, 1e-9, 'tipped back past vertical');
});

test('crossings and extremum refinement', () => {
  near(firstUpCrossing([0, 1, 2, 3], 1.5, 0, 3), 1.5, 1e-9, 'interpolated crossing');
  assert.ok(Number.isNaN(firstUpCrossing([0, 1, 2], 5, 0, 2)));
  const parabola = Array.from({ length: 7 }, (_, i) => (i - 3.3) ** 2);
  near(refineExtremum(parabola, 3), 3.3, 1e-9, 'vertex of a sampled parabola');
});

test('gap filling interpolates and flags long gaps', () => {
  const { out, bad } = fillGaps([1, NaN, 3, NaN, NaN, NaN, 7], [1, 0, 1, 0, 0, 0, 1], 2);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(Array.from(bad), [0, 0, 0, 1, 1, 1, 0]);
});

test('low-pass keeps a slow signal and removes a fast one', () => {
  const fs = 30;
  const n = 120;
  const slow = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1 * i) / fs));
  const fast = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 13 * i) / fs));
  const rms = (a) => Math.sqrt(mean(a.map((v) => v * v)));
  const mid = (a) => Array.from(a).slice(20, 100);
  assert.ok(rms(mid(lowpass(slow, 8, fs))) > 0.68, 'a 1 Hz signal passes an 8 Hz filter almost untouched');
  assert.ok(rms(mid(lowpass(fast, 8, fs))) < 0.12, 'a 13 Hz signal is strongly attenuated');
  const flat = lowpass(new Array(40).fill(5), 8, fs);
  for (const v of flat) near(v, 5, 1e-9, 'constant stays constant');
});

test('derivative and resample', () => {
  const d = derivative([0, 1, 2, 3, 4], 10);
  for (const v of d) near(v, 10, 1e-9, 'slope');
  const r = resample([0, 1, 3], [0, 10, 30], 0, 0.5, 7);
  assert.deepEqual(Array.from(r), [0, 5, 10, 15, 20, 25, 30]);
});

test('statistics', () => {
  near(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.001, 'sample SD');
  near(quantile([1, 2, 3, 4, 5], 0.9), 4.6, 1e-9, 'quantile');
  const [lo, hi] = sdBounds(5);
  assert.ok(lo < 1 && hi > 2, 'five shots leave the true spread very uncertain');
  const [lo10, hi10] = sdBounds(10);
  assert.ok(hi10 < hi && lo10 > lo, 'ten shots narrow it');
});

// ---- Shot detection ---------------------------------------------------------------------

for (const [name, cam, fps] of [['side 30 fps', SIDE, 30], ['side 60 fps', SIDE, 60], ['front 30 fps', FRONT, 30], ['back 30 fps', BACK, 30]]) {
  test(`key moments are found within tolerance: ${name}`, () => {
    for (const seed of [1, 2, 3]) {
      const clip = synthClip([{}, {}, {}], cam, { ...NOISY, fps, seed });
      const res = analyzeClip(clip, { hand: 'right', heightM: 1.8 });
      assert.equal(res.shots.length, 3, `seed ${seed}: all three shots found`);
      const planar = cam === SIDE;
      res.shots.forEach((s, k) => {
        const tr = clip.truth[k];
        near(s.t.release, tr.tRelease, planar ? 0.04 : 0.05, `seed ${seed} shot ${k} release`);
        near(s.t.set, tr.tSet, planar ? 0.05 : 0.09, `seed ${seed} shot ${k} set point`);
        near(s.t.apex, tr.tApex, 0.03, `seed ${seed} shot ${k} apex`);
        near(s.t.takeoff, tr.tTakeoff, 0.06, `seed ${seed} shot ${k} take-off`);
        near(s.t.landing, tr.tLanding, 0.06, `seed ${seed} shot ${k} landing`);
        near(s.t.dip, tr.tDip, 0.1, `seed ${seed} shot ${k} dip`);
        assert.equal(s.jump, true);
        near(s.flight, tr.flight, 0.05, `seed ${seed} shot ${k} flight time`);
      });
    }
  });
}

test('a set shot is recognised as having no flight', () => {
  const { res } = analyse([{ flight: 0 }], SIDE);
  assert.equal(res.shots.length, 1);
  assert.equal(res.shots[0].jump, false);
  assert.ok(!('jumpHeight' in res.shots[0].metrics));
});

test('a chest-height push is not counted as a shot', () => {
  const { res } = analyse([{ setShoulder: 45, relShoulder: 62, setElbow: 70 }], SIDE);
  assert.equal(res.shots.length, 0);
  assert.ok(res.warnings.some((w) => w.code === 'noShots'));
});

test('ten shots in one clip are all found, in order', () => {
  const clip = synthSession({}, 10, { setElbow: 3, flight: 0.02 }, SIDE, { ...NOISY, seed: 4 });
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 10);
  for (let k = 1; k < res.shots.length; k++) assert.ok(res.shots[k].t.release > res.shots[k - 1].t.release);
});

test('shooting hand is worked out when not given', () => {
  const left = prepareTrack(synthClip([{ hand: 'left' }, { hand: 'left' }], FRONT, NOISY));
  assert.equal(guessHand(left).hand, 'left');
  const pushy = prepareTrack(synthClip([{ guidePush: 1 }], SIDE, NOISY));
  assert.equal(guessHand(pushy).hand, 'right', 'a pushing guide hand still finishes lower than the shooting hand');
  const { res } = analyse([{ hand: 'left' }], FRONT, {}, { hand: 'right' });
  assert.equal(res.hand, 'left');
  assert.ok(res.warnings.some((w) => w.code === 'otherHand'));
});

// ---- Camera view -------------------------------------------------------------------------

test('camera view is recognised from where the shooter aims', () => {
  const kind = (cam, shooter = {}) => analyse([shooter], cam).res.view.kind;
  assert.equal(kind(SIDE), 'side');
  assert.equal(kind({ yawDeg: 270 }), 'side');
  assert.equal(kind(FRONT), 'front');
  assert.equal(kind(BACK), 'back');
  assert.equal(kind({ yawDeg: 45 }), 'diagonal');
  assert.equal(kind({ yawDeg: 135 }), 'diagonal');
  assert.equal(kind(SIDE, { turn: 30 }), 'side', 'a turned stance filmed from the side is still a side view');
  assert.equal(kind(FRONT, { turn: 30 }), 'front');
});

test('a clip filed under the wrong angle is caught', () => {
  const { res } = analyse([{}], FRONT, {}, { declaredView: 'side' });
  assert.equal(res.view.kind, 'front');
  assert.ok(res.warnings.some((w) => w.code === 'viewMismatch'));
  const ok = analyse([{}], BACK, {}, { declaredView: 'front' }).res;
  assert.equal(ok.view.kind, 'back', 'front and back are told apart without a warning');
  assert.ok(!ok.warnings.some((w) => w.code === 'viewMismatch'));
});

test('filming from the non-shooting side is flagged', () => {
  const { res } = analyse([{}], { yawDeg: 270 });
  assert.ok(res.warnings.some((w) => w.code === 'offHandSide'));
  assert.equal(res.shots[0].metrics.setElbow.conf, 'medium');
});

// ---- Measurements ------------------------------------------------------------------------

test('side view measurements match the model', () => {
  const { clip, res } = analyse([{}, {}, {}, {}], SIDE, { seed: 21 });
  const tr = clip.truth[0];
  const avg = (id) => mean(res.shots.map((s) => s.metrics[id].value));
  near(avg('kneeBend'), tr.kneeAngleDip, 4, 'knee bend');
  near(avg('setElbow'), tr.setElbow, 6, 'set-point elbow');
  near(avg('armExtension'), tr.maxElbow, 4, 'elbow extension');
  near(avg('armAngle'), tr.armElevation, 3, 'arm angle');
  near(avg('trunkLean'), tr.trunkLeanRelease, 2, 'trunk lean');
  near(avg('driftForward'), tr.driftForwardPct, 2, 'forward drift');
  near(avg('releaseVsApex'), tr.releaseVsApex * 1000, 25, 'release timing');
  near(avg('tempo'), tr.tempo, 0.05, 'tempo');
  near(avg('jumpHeight'), tr.jumpHeightM * 100, 4, 'jump height');
  near(avg('reachHeight'), tr.reachHeightPct, 3, 'release height');
  near(avg('setHeight'), tr.setHeightPct, 4, 'set-point height');
  assert.equal(res.shots[0].metrics.setElbow.conf, 'high');
});

test('side view picks up deliberate flaws', () => {
  const flawed = { trunkLeanRelease: -12, driftForward: -0.25, relShoulder: 118, maxElbow: 148, followHold: 0.12, releaseVsApex: 0.09, kneeFlexDip: 30 };
  const { res } = analyse([flawed], SIDE);
  const m = res.shots[0].metrics;
  near(m.kneeBend.value, 150, 5, 'shallow knee bend');
  near(m.armExtension.value, 148, 5, 'short-armed');
  assert.ok(m.armAngle.value < 44, `flat arm angle, got ${m.armAngle.value}`);
  near(m.trunkLean.value, -12, 2.5, 'leaning back');
  assert.ok(m.driftForward.value < -9, 'drifting backward');
  assert.ok(m.releaseVsApex.value > 55, 'released on the way down');
  assert.ok(m.followHold.value < 0.42, 'follow-through dropped early');
});

test('a hitch at the set point is measured', () => {
  const smooth = analyse([{ setPause: 0 }], SIDE).res.shots[0].metrics.setPause.value;
  const hitch = analyse([{ setPause: 0.35, releaseVsApex: 0.05 }], SIDE).res.shots[0].metrics.setPause.value;
  assert.ok(smooth < 170, `continuous motion reads short, got ${smooth}`);
  near(hitch, 350, 90, 'pause length');
});

for (const [name, cam] of [['front', FRONT], ['back', BACK]]) {
  test(`${name} view measures across the body with the right signs`, () => {
    const clean = analyse([{}], cam).res.shots[0].metrics;
    const flawed = analyse([{ flare: 32, driftLateral: 0.2, sideLean: 9, stance: 1.6, kneeValgus: 0.6 }], cam).res.shots[0].metrics;
    assert.ok(clean.elbowFlare.value < 22, `clean elbow reads tucked, got ${clean.elbowFlare.value}`);
    assert.ok(flawed.elbowFlare.value > clean.elbowFlare.value + 12, 'flared elbow reads higher');
    near(clean.driftSide.value, 0, 1.5, 'no sideways drift');
    near(flawed.driftSide.value, 11.1, 3, 'drift toward the shooting side is positive');
    near(flawed.sideLean.value, 9, 4, 'lean toward the shooting side is positive');
    near(clean.stanceWidth.value, 1.0, 0.2, 'shoulder-width base');
    near(flawed.stanceWidth.value, 1.6, 0.25, 'wide base');
    near(clean.kneeTrack.value, 1.05, 0.15, 'knees on the hip-ankle line read about 1');
    assert.ok(flawed.kneeTrack.value < 0.75, `knees collapsing inward, got ${flawed.kneeTrack.value}`);
    assert.ok(!('trunkLean' in clean) && !('driftForward' in clean), 'no forward/back readings from this angle');
  });
}

test('left-handers get the same signs', () => {
  const m = analyse([{ hand: 'left', flare: 32, driftLateral: 0.2, sideLean: 9 }], FRONT).res.shots[0].metrics;
  assert.ok(m.elbowFlare.value > 25);
  near(m.driftSide.value, 11.1, 3, 'drift toward the shooting side');
  near(m.sideLean.value, 9, 3, 'lean toward the shooting side');
  const side = analyse([{ hand: 'left', trunkLeanRelease: -10, driftForward: -0.2 }], { yawDeg: 270 }).res.shots[0].metrics;
  near(side.trunkLean.value, -10, 2.5, 'backward lean when facing image-left');
  assert.ok(side.driftForward.value < -7);
});

test('ball line and guide hand', () => {
  const clean = analyse([{}], FRONT).res.shots[0].metrics;
  const across = analyse([{ armTilt: 42 }], FRONT).res.shots[0].metrics;
  assert.ok(clean.setLine.value > 0.3 && clean.setLine.value < 1.2, `clean set line, got ${clean.setLine.value}`);
  assert.ok(across.setLine.value < 0.1, `ball set across the face, got ${across.setLine.value}`);
  assert.ok(across.finishLine.value < 0, 'and finishing across the body');
  const push = analyse([{ guidePush: 1 }], FRONT).res.shots[0].metrics;
  assert.ok(clean.guideFollow.value < 30, `clean guide hand, got ${clean.guideFollow.value}`);
  assert.ok(push.guideFollow.value > 60, `pushing guide hand, got ${push.guideFollow.value}`);
});

// ---- Assessment ---------------------------------------------------------------------------

test('judging against ranges', () => {
  const spec = METRIC_BY_ID.armExtension; // ideal 160-180, ok 150-180
  assert.equal(judge(spec, 170).status, 'good');
  assert.equal(judge(spec, 155).status, 'watch');
  assert.equal(judge(spec, 155).direction, 'low');
  assert.equal(judge(spec, 140).status, 'fix');
  assert.ok(judge(spec, 140).score < judge(spec, 155).score);
  assert.equal(judge(METRIC_BY_ID.tempo, 0.4).status, 'info');
  const hold = METRIC_BY_ID.followHold; // open-ended on the high side
  assert.equal(judge(hold, 3).status, 'good');
  assert.equal(judge(hold, 0.1).status, 'fix');
});

test('every judged metric has consistent ranges', () => {
  for (const m of METRICS) {
    if (!m.ideal) continue;
    assert.ok(m.ok[0] <= m.ideal[0] && m.ideal[0] < m.ideal[1] && m.ideal[1] <= m.ok[1], `${m.id} ranges nest`);
    assert.ok(m.tight < m.loose, `${m.id} spread thresholds`);
  }
});

test('spread rating needs enough shots', () => {
  const spec = METRIC_BY_ID.setElbow;
  assert.equal(rateSpread(spec, 2, 3), null);
  assert.equal(rateSpread(spec, 2, 5).rating, 'tight');
  assert.equal(rateSpread(spec, 6, 5).rating, 'moderate');
  assert.equal(rateSpread(spec, 12, 5).rating, 'loose');
});

test('a sound shooter scores well and a flawed one gets the right findings', () => {
  const good = [
    ...records(analyse(Array(6).fill({}), SIDE, { seed: 5 }).res),
    ...records(analyse(Array(6).fill({}), FRONT, { seed: 6 }).res),
  ];
  const a = assessSession(good);
  assert.ok(a.scores.form > 85, `sound form score, got ${a.scores.form}`);
  assert.ok(!a.findings.some((f) => f.status === 'fix'), `no fixes for a sound shooter: ${JSON.stringify(a.findings)}`);

  const flaws = { trunkLeanRelease: -13, driftForward: -0.28, maxElbow: 146, followHold: 0.1, releaseVsApex: 0.1, flare: 34, driftLateral: 0.22, guidePush: 1 };
  const bad = [
    ...records(analyse(Array(6).fill(flaws), SIDE, { seed: 7 }).res),
    ...records(analyse(Array(6).fill(flaws), FRONT, { seed: 8 }).res),
  ];
  const b = assessSession(bad);
  assert.ok(b.scores.form < a.scores.form - 20, `flawed form scores lower: ${b.scores.form} vs ${a.scores.form}`);
  const keys = b.findings.map((f) => f.key);
  for (const expected of ['trunkLean.low', 'driftForward.low', 'armExtension.low', 'followHold.low', 'releaseVsApex.high', 'elbowFlare.high', 'driftSide.high', 'guideFollow.high']) {
    assert.ok(keys.includes(expected), `finding ${expected} present in ${keys.join(', ')}`);
  }
  // Sagittal measurements must come from the side clip, frontal ones from the front clip.
  assert.deepEqual(b.metrics.setElbow.views, ['side']);
  assert.deepEqual(b.metrics.elbowFlare.views, ['front']);
  assert.equal(b.metrics.tempo.n, 12, 'timing pools every shot');
});

test('consistency reflects real shot-to-shot variation', () => {
  const steady = synthSession({}, 10, { setElbow: 1, relShoulder: 1, flight: 0.005 }, SIDE, { ...NOISY, seed: 31 });
  const erratic = synthSession({}, 10, { setElbow: 9, relShoulder: 8, releaseVsApex: 0.07, driftForward: 0.12, kneeFlexDip: 12 }, SIDE, { ...NOISY, seed: 32 });
  const a = assessSession(records(analyzeClip(steady, { hand: 'right' })));
  const b = assessSession(records(analyzeClip(erratic, { hand: 'right' })));
  assert.ok(a.scores.consistency > b.scores.consistency + 15, `steady ${a.scores.consistency} vs erratic ${b.scores.consistency}`);
  assert.ok(b.metrics.setElbow.sd > a.metrics.setElbow.sd + 3);
  assert.ok(b.findings.some((f) => f.kind === 'spread'), 'erratic shooter gets a consistency finding');
  assert.ok(a.metrics.setElbow.spread.rating !== 'loose');
  assert.ok(b.metrics.setElbow.spread.likelyHigh > b.metrics.setElbow.spread.sd);
});

test('makes and misses are compared when enough are marked', () => {
  const makes = Array(5).fill({ relShoulder: 142 });
  const misses = Array(5).fill({ relShoulder: 124 });
  const clip = synthClip([...makes, ...misses], SIDE, { ...NOISY, seed: 41 });
  const res = analyzeClip(clip, { hand: 'right' });
  const recs = records(res).map((r, k) => ({ ...r, made: k < 5 }));
  const a = assessSession(recs);
  assert.ok(a.makeMiss.length > 0);
  assert.ok(a.makeMiss.some((r) => r.metric === 'armAngle' && r.diff < 0), 'misses have the flatter arm angle');
  const unmarked = assessSession(records(res));
  assert.equal(unmarked.makeMiss.length, 0);
});

test('a quick check from a single shot still produces an assessment', () => {
  const a = assessSession(records(analyse([{ maxElbow: 146 }], SIDE).res));
  assert.equal(a.shotCount, 1);
  assert.ok(Number.isNaN(a.scores.consistency));
  assert.ok(Number.isFinite(a.scores.overall));
  assert.ok(a.findings.some((f) => f.key === 'armExtension.low'));
  assert.ok(a.missing.some((m) => m.id === 'elbowFlare'), 'front-view measurements are listed as missing');
});

test('progress comparison reports direction of change', () => {
  const before = assessSession(records(analyse(Array(5).fill({ maxElbow: 146 }), SIDE, { seed: 51 }).res));
  const after = assessSession(records(analyse(Array(5).fill({ maxElbow: 170 }), SIDE, { seed: 52 }).res));
  const row = compareAssessments(before, after).find((r) => r.metric === 'armExtension');
  assert.equal(row.trend, 'better');
  assert.ok(row.change > 15);
});

// ---- Robustness ---------------------------------------------------------------------------

test('missing frames are bridged and long dropouts are flagged', () => {
  const clip = synthClip([{}, {}], SIDE, NOISY);
  // Drop a few scattered frames, and a long block well away from the shots.
  for (const k of [20, 21, 50, 95]) clip.frames[k].lm = clip.frames[k].world = null;
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 2);
  near(res.shots[0].t.release, clip.truth[0].tRelease, 0.05, 'release despite dropped frames');
});

test('empty and personless clips do not throw', () => {
  const none = analyzeClip({ width: 720, height: 1280, frames: [] });
  assert.equal(none.shots.length, 0);
  assert.ok(none.warnings.some((w) => w.code === 'tooShort'));
  const blank = analyzeClip({ width: 720, height: 1280, frames: Array.from({ length: 60 }, (_, i) => ({ t: i / 30, lm: null, world: null })) });
  assert.equal(blank.shots.length, 0);
  assert.ok(blank.warnings.some((w) => w.code === 'noPerson'));
});

test('unevenly timed frames are resampled', () => {
  const clip = synthClip([{}], SIDE, { ...NOISY, fps: 60 });
  // Keep an irregular subset of frames, as a playback-driven capture would.
  clip.frames = clip.frames.filter((_, i) => i % 2 === 0 || i % 7 === 0);
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 1);
  near(res.shots[0].t.release, clip.truth[0].tRelease, 0.05, 'release from uneven frames');
});

// ---- Body parts out of the picture -------------------------------------------------------

/**
 * Re-frame a synthetic clip as if the camera showed only the band [top, bottom] of the
 * original picture. Points left outside it behave as the tracker's do: still present,
 * scored as not visible when far outside, and placed by guesswork.
 */
function reframe(clip, { top = 0, bottom = 1 }) {
  const rng = makeRng(99);
  for (const f of clip.frames) {
    if (!f.lm) continue;
    for (const p of f.lm) {
      p.y = (p.y - top) / (bottom - top);
      const far = p.y < -0.12 || p.y > 1.12;
      if (far) {
        p.visibility = 0.04;
        p.x += rng.normal() * 0.08;
        p.y += rng.normal() * 0.12;
      }
    }
  }
  clip.height = Math.round(clip.height * (bottom - top));
  return clip;
}

test('a waist-up clip is refused with a clear reason, not analysed on guessed legs', () => {
  const clip = reframe(synthClip([{}, {}], SIDE, NOISY), { top: 0.1, bottom: 0.52 });
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 0);
  assert.ok(res.warnings.some((w) => w.code === 'legsCut'), JSON.stringify(res.warnings));
});

test('with the feet out of the picture, shots are found but nothing about the jump is reported', () => {
  const clip = reframe(synthClip([{}, {}], SIDE, NOISY), { top: 0.05, bottom: 0.69 });
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 2);
  assert.ok(res.warnings.some((w) => w.code === 'feetCut'), JSON.stringify(res.warnings));
  for (const s of res.shots) {
    assert.equal(s.jump, null);
    for (const id of ['jumpHeight', 'releaseVsApex', 'driftForward', 'kneeBend']) assert.ok(!(id in s.metrics), `${id} must be withheld`);
    near(s.metrics.setElbow.value, 80, 8, 'arm measurements are unaffected');
    near(s.metrics.armExtension.value, 172, 6, 'arm extension is unaffected');
    assert.ok('trunkLean' in s.metrics);
  }
  const a = assessSession(res.shots.map((s) => toShotRecord(s, 0)));
  assert.ok(a.missing.some((m) => m.id === 'kneeBend'));
  assert.ok(Number.isFinite(a.scores.form));
});

test('with the hand leaving the top of the picture, the shot counts but the finish is not measured', () => {
  const full = analyzeClip(synthClip([{}, {}], SIDE, NOISY), { hand: 'right' });
  const clip = reframe(synthClip([{}, {}], SIDE, NOISY), { top: 0.325, bottom: 1 });
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 2, 'both shots are still found');
  assert.ok(res.warnings.some((w) => w.code === 'handsCut'), JSON.stringify(res.warnings));
  res.shots.forEach((s, k) => {
    assert.equal(s.handsCut, true);
    for (const id of ['armExtension', 'armAngle', 'reachHeight', 'followHold']) assert.ok(!(id in s.metrics), `${id} must be withheld`);
    near(s.t.release, full.shots[k].t.release, 0.06, 'release timing still found');
    near(s.metrics.kneeBend.value, full.shots[k].metrics.kneeBend.value, 4, 'leg measurements are unaffected');
    assert.equal(s.jump, true);
  });
});

test('a landmark the tracker cannot see is bridged for detection and not measured from', () => {
  const hide = (frames, from, to) => {
    for (let k = from; k <= to; k++) {
      frames[k].lm[16].visibility = 0.05;
      frames[k].lm[16].x += 0.3;
      frames[k].lm[16].y += 0.3;
    }
  };
  // Four hidden frames right at the set point: the shot is still found, the release is
  // still timed, and the set-point readings are withheld instead of interpolated.
  const clip = synthClip([{}], SIDE, NOISY);
  const at = Math.round(clip.truth[0].tSet * 30);
  hide(clip.frames, at - 2, at + 1);
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 1);
  near(res.shots[0].t.release, clip.truth[0].tRelease, 0.05, 'release despite a hidden wrist at the set point');
  assert.ok(!('setElbow' in res.shots[0].metrics) && !('setHeight' in res.shots[0].metrics));
  assert.ok('armExtension' in res.shots[0].metrics);
  // One hidden frame well before the set point changes nothing.
  const clip2 = synthClip([{}], SIDE, NOISY);
  hide(clip2.frames, at - 9, at - 9);
  const res2 = analyzeClip(clip2, { hand: 'right' });
  near(res2.shots[0].metrics.setElbow.value, 80, 6, 'set-point elbow unaffected by an earlier dropout');
});

test('a shot cut off by the start or end of the recording is ignored', () => {
  const clip = synthClip([{}, {}, {}], SIDE, NOISY);
  const tr = clip.truth;
  // Start the recording just after the first shot's set point and stop it just after
  // the last shot's release.
  const from = Math.round((tr[0].tSet + 0.02) * 30);
  const to = Math.round((tr[2].tRelease + 0.05) * 30);
  const cut = { ...clip, frames: clip.frames.slice(from, to).map((f) => ({ ...f, t: f.t - clip.frames[from].t })) };
  const res = analyzeClip(cut, { hand: 'right' });
  assert.equal(res.shots.length, 1, 'only the complete middle shot counts');
  near(res.shots[0].t.release + clip.frames[from].t, tr[1].tRelease, 0.05, 'and it is the middle one');
});

// ---- Findings from the code review, kept as regression tests ----------------------------------

test('a front camera a little off the shot line does not change the across-the-body readings', () => {
  const read = (yaw) => analyse([{ driftForward: 0.45 }], { yawDeg: yaw }, { seed: 4 }, { declaredView: 'front' }).res;
  const square = read(0).shots[0].metrics;
  for (const yaw of [12, 20, -20]) {
    const res = read(yaw);
    const m = res.shots[0].metrics;
    near(m.setLine.value, square.setLine.value, 0.25, `ball line at the set point, camera ${yaw} degrees off`);
    near(m.finishLine.value, square.finishLine.value, 0.3, `follow-through line, camera ${yaw} degrees off`);
    near(m.elbowFlare.value, square.elbowFlare.value, 8, `elbow flare, camera ${yaw} degrees off`);
    if (Math.abs(yaw) > 16) {
      assert.ok(res.warnings.some((w) => w.code === 'offAxis'), 'an off-line camera is pointed out');
      assert.equal(m.driftSide.conf, 'low', 'sideways travel is only a rough reading off the line');
    }
  }
});

test('a camera at an angle is treated as angled even when a view was stated', () => {
  const side = analyse([{}], { yawDeg: 42 }, {}, { declaredView: 'side' }).res;
  assert.equal(side.view.kind, 'diagonal');
  assert.ok(side.warnings.some((w) => w.code === 'angledCamera'));
  near(side.shots[0].metrics.setElbow.value, 82, 12, 'elbow read from 3D, not from the skewed picture');
  assert.equal(side.shots[0].metrics.setElbow.conf, 'medium');
  const quick = analyse([{}], { yawDeg: 45 }).res;
  assert.ok(quick.warnings.some((w) => w.code === 'angledCamera'), 'quick checks get the warning too');
});

test('a follow-through cut off by the end of the clip is not judged as dropped early', () => {
  const clip = synthClip([{ followHold: 0.9 }], SIDE, NOISY);
  const stop = Math.round((clip.truth[0].tRelease + 0.28) * 30);
  const res = analyzeClip({ ...clip, frames: clip.frames.slice(0, stop) }, { hand: 'right' });
  assert.equal(res.shots.length, 1);
  assert.equal(res.shots[0].metrics.followHold.note, 'capped');
  const a = assessSession(records(res));
  assert.ok(!a.findings.some((f) => f.key === 'followHold.low'), 'no finding from a lower bound');
  assert.ok(!a.metrics.followHold, 'and no value reported');
  // A long hold in the middle of a clip is measured in full.
  const long = analyzeClip(synthClip([{ followHold: 1.8 }, {}], SIDE, { ...NOISY, fps: 60 }), { hand: 'right' });
  assert.ok(long.shots[0].metrics.followHold.value > 1.5, `long hold measured, got ${long.shots[0].metrics.followHold.value}`);
});

test('a set shot is described as one and its timing is not judged', () => {
  const res = analyse([{ flight: 0, releaseVsApex: 0.09 }], SIDE).res;
  const a = assessSession(records(res));
  assert.equal(a.jumpShots, false);
  assert.equal(a.metrics.releaseVsApex.status, 'info');
  assert.ok(!a.findings.some((f) => f.metric === 'releaseVsApex'));
  assert.equal(a.missing.find((m) => m.id === 'jumpHeight').reason, 'jump');
  assert.equal(a.missing.find((m) => m.id === 'elbowFlare').reason, 'view');
});

test('the other hand is used when it is clearly the one shooting', () => {
  const res = analyse(Array(5).fill({ hand: 'left', guidePush: 0.5 }), FRONT, { seed: 4 }, { hand: 'right' }).res;
  assert.equal(res.hand, 'left');
  assert.equal(res.shots.length, 5);
  assert.ok(res.warnings.some((w) => w.code === 'otherHand'));
  const same = analyse(Array(3).fill({ guidePush: 0.5 }), FRONT, { seed: 4 }, { hand: 'right' }).res;
  assert.equal(same.hand, 'right', 'a pushing guide hand does not flip a correct profile');
});

test('slow-motion video is recognised at any stretch', () => {
  for (const factor of [2, 4, 8]) {
    const clip = synthClip([{}], SIDE, NOISY);
    clip.frames.forEach((f) => {
      f.t *= factor;
    });
    const res = analyzeClip(clip, { hand: 'right' });
    assert.ok(res.warnings.some((w) => w.code === 'slowMotion'), `${factor}x slow motion flagged`);
  }
  assert.ok(!analyse([{}, {}], SIDE).res.warnings.some((w) => w.code === 'slowMotion'), 'normal speed is not flagged');
});

test('heights agree between camera angles', () => {
  const reach = (cam) => analyse([{}], cam, { seed: 9 }).res.shots[0].metrics.reachHeight;
  const side = reach(SIDE);
  for (const cam of [FRONT, BACK]) {
    const r = reach(cam);
    near(r.value, side.value, 3.5, 'release height from front or back matches the side view');
    assert.equal(r.conf, 'medium');
  }
});

// ---- Detection when the recording is less than ideal ---------------------------------------

/** Clip `b` appended to clip `a`, as one continuous recording. */
function join(a, b) {
  const off = a.frames[a.frames.length - 1].t + 1 / a.fps;
  return { ...a, frames: [...a.frames, ...b.frames.map((f) => ({ ...f, t: f.t + off }))] };
}

test('a shot taken farther from the camera is measured against the size of the shooter there', () => {
  for (const cam of [SIDE, FRONT]) {
    const far = synthClip([{}], { ...cam, distM: 9 }, { ...NOISY, seed: 3 });
    const alone = analyzeClip(far, { hand: 'right', heightM: 1.8 }).shots[0];
    const mixed = analyzeClip(join(synthClip([{}, {}, {}], cam, NOISY), far), { hand: 'right', heightM: 1.8 });
    assert.equal(mixed.shots.length, 4, 'the small, distant shot is still found');
    const s = mixed.shots[3];
    assert.equal(s.jump, true);
    for (const id of ['setHeight', 'reachHeight', 'jumpHeight', cam === SIDE ? 'driftForward' : 'driftSide']) {
      near(s.metrics[id].value, alone.metrics[id].value, 1, `${id} matches the same shot filmed on its own`);
    }
  }
});

test('legs tucked in the air are not mistaken for the dip', () => {
  const { clip, res } = analyse([{ tuck: 78, kneeFlexDip: 55 }], SIDE);
  near(res.shots[0].metrics.kneeBend.value, 125, 5, 'knee bend is read at the dip');
  near(res.shots[0].t.dip, clip.truth[0].tDip, 0.07, 'dip time');
});

test('a dip that began before the recording did is not reported', () => {
  const clip = synthClip([{ riseDur: 0.32 }], SIDE, NOISY);
  const from = clip.truth[0].tDip + 0.04;
  clip.frames = clip.frames.filter((f) => f.t >= from);
  const res = analyzeClip(clip, { hand: 'right' });
  assert.equal(res.shots.length, 1);
  assert.ok(!('kneeBend' in res.shots[0].metrics) && !('tempo' in res.shots[0].metrics));
  assert.ok('setElbow' in res.shots[0].metrics);
});

test('half-speed video of a small hop is caught by how slowly the shooter falls', () => {
  // Flight time and push both stay believable at half speed; only gravity gives it away.
  const hop = Array(3).fill({ flight: 0.3, extDur: 0.14 });
  const slow = synthClip(hop, SIDE, { ...NOISY, fps: 60 });
  slow.frames.forEach((f) => {
    f.t *= 2;
  });
  const res = analyzeClip(slow, { hand: 'right', heightM: 1.8 });
  assert.equal(res.shots.length, 3);
  assert.ok(res.shots.every((s) => s.flight < 0.75 && s.t.full - s.t.set < 0.5), 'nothing else looks slow');
  assert.ok(res.warnings.some((w) => w.code === 'slowMotion'), JSON.stringify(res.warnings));
  for (const cam of [SIDE, FRONT, BACK]) {
    for (const flight of [0.3, 0.44, 0.55]) {
      const real = analyse(Array(3).fill({ flight }), cam).res;
      assert.ok(!real.warnings.some((w) => w.code === 'slowMotion'), `real speed, ${flight} s in the air, camera at ${cam.yawDeg}`);
      for (const s of real.shots) if (Number.isFinite(s.gravity)) near(s.gravity, 9.8, 3.5, 'apparent gravity at real speed');
    }
  }
});

test('a shooter who is out of the picture for most of the clip is still analysed', () => {
  const clip = synthClip([{}, {}], SIDE, NOISY);
  const last = clip.frames[clip.frames.length - 1].t;
  for (let k = 1; k <= 600; k++) clip.frames.push({ t: last + k / 30, lm: null, world: null });
  const res = analyzeClip(clip, { hand: 'right' });
  assert.ok(res.info.detectedFraction < 0.3);
  assert.equal(res.shots.length, 2);
  assert.ok(!res.warnings.some((w) => w.code === 'noPerson'));
  const brief = synthClip([{}], SIDE, NOISY);
  brief.frames = brief.frames.slice(0, 20);
  assert.ok(analyzeClip(brief, { hand: 'right' }).warnings.some((w) => w.code === 'tooShort'));
});

test('from the side, the far half of the body can be hidden without losing the legs or the jump', () => {
  const full = analyzeClip(synthClip([{}, {}], SIDE, NOISY), { hand: 'right', heightM: 1.8 });
  const clip = synthClip([{}, {}], SIDE, NOISY);
  const rng = makeRng(5);
  // Left shoulder, hip, knee, ankle, heel, toe, eye and ear: unseen, and placed by guesswork.
  for (const f of clip.frames) {
    for (const j of [11, 23, 25, 27, 29, 31, 2, 7]) {
      f.lm[j].visibility = 0.05;
      f.lm[j].x += rng.normal() * 0.05;
      f.lm[j].y += rng.normal() * 0.05;
    }
  }
  const res = analyzeClip(clip, { hand: 'right', heightM: 1.8 });
  assert.equal(res.shots.length, 2);
  res.shots.forEach((s, k) => {
    const ref = full.shots[k].metrics;
    assert.equal(s.jump, true);
    near(s.metrics.kneeBend.value, ref.kneeBend.value, 3, 'knee bend from the near leg');
    near(s.metrics.jumpHeight.value, ref.jumpHeight.value, 3, 'jump from the near foot');
    near(s.metrics.driftForward.value, ref.driftForward.value, 1.5, 'drift from the near ankle');
    near(s.metrics.reachHeight.value, ref.reachHeight.value, 1.5, 'height against the near eye');
    near(s.metrics.followHold.value, ref.followHold.value, 0.1, 'follow-through');
    assert.equal(s.metrics.trunkLean.conf, 'low', 'lean from one side of the trunk is only a rough reading');
  });
});

test('a hand that finishes below the eye line still has its follow-through measured', () => {
  const clip = synthClip([{ followHold: 0.8 }], BACK, NOISY);
  // Put the eye line above the extended hand, as a low, close camera behind a flat release does.
  for (const f of clip.frames) for (const j of [2, 5]) f.lm[j].y -= 0.08;
  const res = analyzeClip(clip, { hand: 'right', heightM: 1.8 });
  assert.equal(res.shots.length, 1);
  assert.ok(res.track.wristAboveEyes('right')[Math.ceil(res.shots[0].i.full)] < 0, 'the hand is below the eye line at full extension');
  near(res.shots[0].metrics.followHold.value, 0.8, 0.15, 'follow-through timed from the elbow');
});

test('a hitch at the set point is also read from the front and from behind', () => {
  const pauses = (setPause, cam) => analyse(Array(4).fill({ setPause }), cam).res.shots.map((s) => s.metrics.setPause.value);
  for (const cam of [FRONT, BACK]) {
    assert.ok(quantile(pauses(0.03, cam), 0.5) < 130, 'no hitch reads as a short pause');
    near(quantile(pauses(0.35, cam), 0.5), 350, 60, 'a 350 ms hitch');
  }
});

test('slow-motion video keeps its angles and loses its times', () => {
  const clip = synthClip([{}, {}], SIDE, { ...NOISY, fps: 60 });
  clip.frames.forEach((f) => {
    f.t *= 4;
  });
  const res = analyzeClip(clip, { hand: 'right', heightM: 1.8 });
  assert.equal(res.shots.length, 2);
  for (const s of res.shots) {
    for (const id of ['tempo', 'setPause', 'releaseVsApex', 'followHold', 'jumpHeight']) assert.ok(!(id in s.metrics), `${id} must be withheld`);
    near(s.metrics.setElbow.value, 80, 8, 'set-point elbow');
    near(s.metrics.kneeBend.value, 118, 8, 'knee bend');
  }
  const a = assessSession(res.shots.map((s) => toShotRecord(s, 0)));
  assert.equal(a.missing.find((m) => m.id === 'tempo').reason, 'slow');
  assert.ok(Number.isFinite(a.scores.form));
});
