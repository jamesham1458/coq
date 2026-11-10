// Per-shot measurements. Each function reads a prepared track at the moments the shot
// detector marked and returns plain numbers; judging them is left to assess.js.
//
// Which measurements are possible depends on the camera view:
//   side      angles in the plane of the shot (knee, elbow, arm angle, lean, forward drift)
//   front/back  everything across the body (elbow flare, ball line, base, side lean, side drift)
//   any       heights and timing, plus joint angles from the 3D landmarks (less exact)

import { LM, sideOf, otherSide } from './landmarks.js';
import { sampleAt, clamp, tiltFromUp, elevation2, elevation3, argMax } from './geometry.js';
import { median } from './stats.js';

const G = 9.81;

/** Median of a series over [a, b] (fractional indices, clamped). */
function windowMedian(arr, a, b) {
  const lo = clamp(Math.round(Math.min(a, b)), 0, arr.length - 1);
  const hi = clamp(Math.round(Math.max(a, b)), 0, arr.length - 1);
  return median(Array.from(arr.subarray(lo, hi + 1)));
}

/** +1 when the shooter's shooting side appears toward image-right, -1 toward image-left. */
function outwardSign(track, hand) {
  const rightIsImageRight = track.view.chestToCamera ? -1 : 1;
  return rightIsImageRight * (hand === 'right' ? 1 : -1);
}

/**
 * Measure one shot.
 *
 * @param {import('./track.js').Track} track
 * @param {object} shot  from findShots
 * @param {{ heightM?: number }} [opts]
 * @returns {Record<string, { value: number, conf: 'high'|'medium'|'low', note?: string }>}
 */
export function measureShot(track, shot, opts = {}) {
  const out = {};
  const hand = shot.hand;
  const S = sideOf(hand);
  const Gd = sideOf(otherSide(hand));
  const fps = track.fps;
  const n = track.n;
  const kind = track.view.kind;
  const side = kind === 'side';
  const frontal = kind === 'front' || kind === 'back';
  const i = shot.i;
  const put = (id, value, conf, note) => {
    if (Number.isFinite(value)) out[id] = note ? { value, conf, note } : { value, conf };
  };

  // Confidence of sagittal-plane readings: best from the shooting-hand side.
  const nearShooting = side && track.view.nearSide === hand;
  const armConf = side ? (nearShooting ? 'high' : 'medium') : 'medium';
  const legConf = side ? 'high' : 'medium';

  // ---- Timing -------------------------------------------------------------------------
  put('tempo', shot.t.release - shot.t.dip, Number.isFinite(i.dip) ? 'high' : 'low');
  put('setPause', shot.setPause * 1000, 'medium');
  if (Number.isFinite(i.apex)) {
    put('releaseVsApex', (shot.t.release - shot.t.apex) * 1000, shot.jump ? 'medium' : 'low');
  }
  put('followHold', shot.t.followEnd - shot.t.release, shot.followCapped ? 'medium' : 'high', shot.followCapped ? 'capped' : undefined);
  if (shot.jump) put('jumpHeight', ((G * shot.flight * shot.flight) / 8) * 100, 'medium');

  // ---- Joint angles ---------------------------------------------------------------------
  put('kneeBend', shot.dipKnee, legConf);
  put('setElbow', shot.thetaSet, armConf);
  put('armExtension', shot.thetaMax, armConf);

  // ---- Heights (valid from any view) ----------------------------------------------------
  const eyes = track.wristAboveEyes(hand);
  put('setHeight', sampleAt(eyes, i.set), 'high');
  const reachEnd = Math.min(n - 1, Math.round(i.full + 0.25 * fps));
  const iReach = argMax(eyes, Math.floor(i.release), reachEnd);
  if (iReach >= 0) put('reachHeight', eyes[iReach], 'high');

  // ---- Arm angle at full extension ------------------------------------------------------
  const fa = i.full;
  const fb = Math.min(n - 1, i.full + 0.07 * fps);
  if (side) {
    const dx = windowMedian(track.px[S.wrist], fa, fb) - windowMedian(track.px[S.shoulder], fa, fb);
    const dy = windowMedian(track.py[S.wrist], fa, fb) - windowMedian(track.py[S.shoulder], fa, fb);
    put('armAngle', elevation2(dx, dy, track.view.facing || 1), armConf);
  } else if (track.hasWorld) {
    const d = (arr) => windowMedian(arr[S.wrist], fa, fb) - windowMedian(arr[S.shoulder], fa, fb);
    put('armAngle', elevation3(d(track.wx), d(track.wy), d(track.wz)), 'low');
  }

  // ---- Side view: lean and drift along the line of the shot ---------------------------
  const sh = track.mid(LM.L_SHOULDER, LM.R_SHOULDER);
  const hip = track.mid(LM.L_HIP, LM.R_HIP);
  const ank = track.mid(LM.L_ANKLE, LM.R_ANKLE);
  if (side) {
    const facing = track.view.facing || 1;
    const lean = tiltFromUp(sampleAt(sh.x, i.release) - sampleAt(hip.x, i.release), sampleAt(sh.y, i.release) - sampleAt(hip.y, i.release));
    put('trunkLean', lean * facing, 'high');
    if (shot.jump) {
      const dx = sampleAt(ank.x, i.landing) - sampleAt(ank.x, i.takeoff);
      put('driftForward', ((dx * facing) / track.bodyH) * 100, 'high');
    }
  }

  // ---- Front or back view: everything across the body -------------------------------------
  if (frontal) {
    const out1 = outwardSign(track, hand);
    // Elbow flare: how far the forearm leans inward on its way up from the elbow at the set point.
    const sa = Math.max(0, i.set - 0.05 * fps);
    const ex = windowMedian(track.px[S.elbow], sa, i.set);
    const ey = windowMedian(track.py[S.elbow], sa, i.set);
    const wx = windowMedian(track.px[S.wrist], sa, i.set);
    const wy = windowMedian(track.py[S.wrist], sa, i.set);
    const foreLen = Math.hypot(wx - ex, wy - ey);
    // With the forearm pointing at the camera its image is too short to give a direction.
    if (foreLen > 0.12 * track.torso && wy < ey) {
      put('elbowFlare', -tiltFromUp(wx - ex, wy - ey) * out1, 'medium');
    }
    // Where the hand sits between the middle of the head (0) and the shooting shoulder (1).
    const headX = (arr, at) => (sampleAt(arr[LM.L_EAR], at) + sampleAt(arr[LM.R_EAR], at)) / 2;
    const line = (at) => {
      const hx = headX(track.px, at);
      const span = sampleAt(track.px[S.shoulder], at) - hx;
      return Math.abs(span) > 0.05 * track.torso ? (sampleAt(track.px[S.wrist], at) - hx) / span : NaN;
    };
    put('setLine', line(i.set), 'medium');
    put('finishLine', line(Math.min(n - 1, i.full + 0.05 * fps)), 'medium');
    const lean = tiltFromUp(sampleAt(sh.x, i.release) - sampleAt(hip.x, i.release), sampleAt(sh.y, i.release) - sampleAt(hip.y, i.release));
    put('sideLean', lean * out1, 'high');
    if (shot.jump) {
      const dx = sampleAt(ank.x, i.landing) - sampleAt(ank.x, i.takeoff);
      put('driftSide', ((dx * out1) / track.bodyH) * 100, 'high');
    }
    if (Number.isFinite(i.dip)) {
      const at = i.dip;
      const ankles = Math.abs(sampleAt(track.px[LM.L_ANKLE], at) - sampleAt(track.px[LM.R_ANKLE], at));
      const knees = Math.abs(sampleAt(track.px[LM.L_KNEE], at) - sampleAt(track.px[LM.R_KNEE], at));
      const shoulders = Math.abs(sampleAt(track.px[LM.L_SHOULDER], at) - sampleAt(track.px[LM.R_SHOULDER], at));
      if (shoulders > 0.2 * track.torso) put('stanceWidth', ankles / shoulders, 'medium');
      if (ankles > 0.15 * track.torso) put('kneeTrack', knees / ankles, 'medium');
    }
  }

  // ---- Guide hand (any view): how much of the shooting hand's rise the guide hand copies ---
  {
    const upS = track.wristUp(hand);
    const upG = track.wristUp(otherSide(hand));
    const end = Math.min(n - 1, i.full + 0.03 * fps);
    const riseS = sampleAt(upS, end) - sampleAt(upS, i.set);
    const riseG = sampleAt(upG, end) - sampleAt(upG, i.set);
    const guideVis = (track.vis[Gd.wrist][clamp(Math.round(i.set), 0, n - 1)] + track.vis[Gd.shoulder][clamp(Math.round(i.set), 0, n - 1)]) / 2;
    if (riseS > 0.25 && guideVis > 0.4) {
      put('guideFollow', (riseG / riseS) * 100, frontal ? 'medium' : 'low');
    }
  }

  return out;
}
