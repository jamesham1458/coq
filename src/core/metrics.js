// Per-shot measurements. Each function reads a prepared track at the moments the shot
// detector marked and returns plain numbers; judging them is left to assess.js.
//
// Which measurements are possible depends on the camera view:
//   side      angles in the plane of the shot (knee, elbow, arm angle, lean, forward drift)
//   front/back  everything across the body (elbow flare, ball line, base, side lean, side drift)
//   any       heights and timing, plus joint angles from the 3D landmarks (less exact)

import { LM, sideOf, otherSide } from './landmarks.js';
import { sampleAt, clamp, tiltFromUp, elevation2, elevation3, argMax, toDeg } from './geometry.js';
import { TORSO_TO_HEIGHT } from './track.js';
import { median } from './stats.js';

const G = 9.81;

/** Up to this many degrees off the shot line, a front or back camera is treated as square to it. */
export const OFF_AXIS_OK_DEG = 12;

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

  // Body size where this shot was taken (the shooter may be nearer or farther than in other shots).
  const bodyH = shot.bodyH > 0 ? shot.bodyH : track.bodyH;
  const torso = shot.torso > 0 ? shot.torso : track.torso;
  // Body sides whose listed landmarks are in view at every given moment. From the side
  // the far shoulder, hip or ankle is often hidden, and one side is enough.
  const sidesWith = (pick, ...at) => ['left', 'right'].filter((sd) => at.every((k) => track.ok(pick(sideOf(sd)), k)));
  const avg = (arr, pts, at) => pts.reduce((sum, j) => sum + sampleAt(arr[j], at), 0) / pts.length;

  // Confidence of sagittal-plane readings: best from the shooting-hand side.
  const nearShooting = side && track.view.nearSide === hand;
  const armConf = side ? (nearShooting ? 'high' : 'medium') : 'medium';
  const legConf = side ? 'high' : 'medium';

  // ---- Timing -------------------------------------------------------------------------
  put('tempo', shot.t.release - shot.t.dip, Number.isFinite(i.dip) ? 'high' : 'low');
  put('setPause', shot.setPause * 1000, 'medium');
  if (Number.isFinite(i.apex) && shot.jump !== null) {
    put('releaseVsApex', (shot.t.release - shot.t.apex) * 1000, shot.jump ? 'medium' : 'low');
  }
  // Anything read from the extended arm needs the wrist in the picture at the release.
  const armUp = !shot.handsCut;
  if (armUp) put('followHold', shot.t.followEnd - shot.t.release, shot.followCapped ? 'medium' : 'high', shot.followCapped ? 'capped' : undefined);
  if (shot.jump === true) put('jumpHeight', ((G * shot.flight * shot.flight) / 8) * 100, 'medium');

  // ---- Joint angles ---------------------------------------------------------------------
  put('kneeBend', shot.dipKnee, legConf);
  if (shot.armSeenAtSet) put('setElbow', shot.thetaSet, armConf);
  if (armUp) put('armExtension', shot.thetaMax, armConf);

  // ---- Heights ---------------------------------------------------------------------------
  // From the side the picture gives heights directly. From other angles the hand is
  // nearer or farther than the head, so perspective would shift it; the 3D landmarks'
  // vertical axis is used instead and the reading is labelled an estimate.
  const EYES = [LM.L_EYE, LM.R_EYE];
  const reachEnd = Math.min(n - 1, Math.round(i.full + 0.25 * fps));
  if (side || !track.hasWorld || !(track.torsoM > 0)) {
    const eyes = track.wristAboveEyes(hand);
    // That series is in body heights typical for the clip; restate it in this shot's.
    const local = track.bodyH / bodyH;
    const conf = side ? 'high' : 'low';
    if (shot.armSeenAtSet && track.any(EYES, i.set)) put('setHeight', sampleAt(eyes, i.set) * local, conf);
    const iReach = argMax(eyes, Math.floor(i.release), reachEnd);
    if (armUp && iReach >= 0 && track.ok([S.wrist], iReach) && track.any(EYES, iReach)) put('reachHeight', eyes[iReach] * local, conf);
  } else {
    const bodyM = track.torsoM / TORSO_TO_HEIGHT;
    const eyeY = (k) => {
      const l = track.seen[LM.L_EYE][k];
      const r = track.seen[LM.R_EYE][k];
      return l && !r ? track.wy[LM.L_EYE][k] : r && !l ? track.wy[LM.R_EYE][k] : (track.wy[LM.L_EYE][k] + track.wy[LM.R_EYE][k]) / 2;
    };
    const above = (k) => ((eyeY(k) - track.wy[S.wrist][k]) / bodyM) * 100;
    const kSet = clamp(Math.round(i.set), 0, n - 1);
    if (shot.armSeenAtSet && track.any(EYES, i.set)) put('setHeight', above(kSet), 'medium');
    let best = -Infinity;
    let kBest = -1;
    for (let k = Math.max(0, Math.floor(i.release)); k <= reachEnd; k++) {
      const v = above(k);
      if (v > best) {
        best = v;
        kBest = k;
      }
    }
    if (armUp && kBest >= 0 && track.ok([S.wrist], kBest) && track.any(EYES, kBest)) put('reachHeight', best, 'medium');
  }

  // ---- Arm angle at full extension ------------------------------------------------------
  const fa = i.full;
  const fb = Math.min(n - 1, i.full + 0.07 * fps);
  if (!armUp) {
    // wrist out of the picture: no arm angle
  } else if (side) {
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
  const TRUNK = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
  const trunkSeen = track.ok(TRUNK, i.release);
  // Ankles in view at both ends of the flight. Travel is the same whichever is used.
  const ankles = shot.jump === true ? sidesWith((L) => [L.ankle], i.takeoff, i.landing).map((sd) => sideOf(sd).ankle) : [];
  const landingSeen = ankles.length > 0;
  const travel = landingSeen ? avg(track.px, ankles, i.landing) - avg(track.px, ankles, i.takeoff) : NaN;
  if (side) {
    const facing = track.view.facing || 1;
    // One side's shoulder and hip give the line of the trunk; with both in view the
    // middle of each pair is used, which a camera a little off square does not skew.
    const trunk = sidesWith((L) => [L.shoulder, L.hip], i.release);
    if (trunk.length) {
      const tops = trunk.map((sd) => sideOf(sd).shoulder);
      const bottoms = trunk.map((sd) => sideOf(sd).hip);
      const lean = tiltFromUp(avg(track.px, tops, i.release) - avg(track.px, bottoms, i.release), avg(track.py, tops, i.release) - avg(track.py, bottoms, i.release));
      // A stance turned toward the basket puts one shoulder ahead of its hip, so a single
      // side reads a few degrees off: a rough reading only.
      put('trunkLean', lean * facing, trunk.length === 2 ? 'high' : 'low');
    }
    if (landingSeen) put('driftForward', ((travel * facing) / bodyH) * 100, ankles.length === 2 ? 'high' : 'medium');
  }

  // ---- Front or back view: everything across the body -------------------------------------
  if (frontal) {
    const out1 = outwardSign(track, hand);
    const sa = Math.max(0, i.set - 0.05 * fps);
    const EARS = [LM.L_EAR, LM.R_EAR];
    const iFinish = Math.min(n - 1, i.full + 0.05 * fps);
    const aim = track.view.aim;
    const offAxis = Number.isFinite(track.view.offAxisDeg) ? track.view.offAxisDeg : 0;

    if (track.hasWorld && aim) {
      // Measure across the SHOOTER, not across the picture. A camera a little to one side
      // of the shot line would otherwise turn forward reach into sideways offset. `lat`
      // is the ground-plane direction square to the aim, signed toward the shooting side.
      let lx = -aim.z;
      let lz = aim.x;
      const kS = clamp(Math.round(i.set), 0, n - 1);
      const across = (track.wx[S.shoulder][kS] - track.wx[Gd.shoulder][kS]) * lx + (track.wz[S.shoulder][kS] - track.wz[Gd.shoulder][kS]) * lz;
      if (across < 0) {
        lx = -lx;
        lz = -lz;
      }
      const pt = (j, a0, b0) => [windowMedian(track.wx[j], a0, b0), windowMedian(track.wy[j], a0, b0), windowMedian(track.wz[j], a0, b0)];
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const lat = (p, q) => (p[0] - q[0]) * lx + (p[2] - q[2]) * lz;
      const rise = (p, q) => -(p[1] - q[1]);

      // Elbow flare: how far the forearm leans inward on its way up from the elbow.
      const E = pt(S.elbow, sa, i.set);
      const W = pt(S.wrist, sa, i.set);
      const fl = lat(W, E);
      const fv = rise(W, E);
      const foreLen = Math.hypot(W[0] - E[0], W[1] - E[1], W[2] - E[2]);
      // A forearm lying nearly level has no meaningful lean in this plane.
      if (shot.armSeenAtSet && fv > 0.3 * foreLen) put('elbowFlare', toDeg(Math.atan2(-fl, fv)), 'medium');

      // Where the hand sits between the middle of the head (0) and the shooting shoulder (1).
      const line = (a0, b0) => {
        const head = mid(pt(LM.L_EAR, a0, b0), pt(LM.R_EAR, a0, b0));
        const span = lat(pt(S.shoulder, a0, b0), head);
        return span > 0.04 ? lat(pt(S.wrist, a0, b0), head) / span : NaN;
      };
      if (shot.armSeenAtSet && track.ok(EARS, i.set)) put('setLine', line(sa, i.set), 'medium');
      if (armUp && track.ok([S.wrist, S.shoulder, ...EARS], iFinish)) put('finishLine', line(i.full, iFinish), 'medium');

      if (trunkSeen) {
        // The trunk moves slowly, so a few frames either side of the release steady the reading.
        const ra = Math.max(0, i.release - 2);
        const rb = Math.min(n - 1, i.release + 2);
        const top = mid(pt(LM.L_SHOULDER, ra, rb), pt(LM.R_SHOULDER, ra, rb));
        const bottom = mid(pt(LM.L_HIP, ra, rb), pt(LM.R_HIP, ra, rb));
        put('sideLean', toDeg(Math.atan2(lat(top, bottom), rise(top, bottom))), offAxis <= OFF_AXIS_OK_DEG ? 'high' : 'medium');
      }
    } else {
      // No 3D landmarks or no aim estimate: fall back to offsets in the picture.
      const ex = windowMedian(track.px[S.elbow], sa, i.set);
      const ey = windowMedian(track.py[S.elbow], sa, i.set);
      const wx = windowMedian(track.px[S.wrist], sa, i.set);
      const wy = windowMedian(track.py[S.wrist], sa, i.set);
      const foreLen = Math.hypot(wx - ex, wy - ey);
      if (shot.armSeenAtSet && foreLen > 0.12 * torso && wy < ey) {
        put('elbowFlare', -tiltFromUp(wx - ex, wy - ey) * out1, 'low');
      }
      const headX = (at) => (sampleAt(track.px[LM.L_EAR], at) + sampleAt(track.px[LM.R_EAR], at)) / 2;
      const line = (at) => {
        const hx = headX(at);
        const span = sampleAt(track.px[S.shoulder], at) - hx;
        return Math.abs(span) > 0.05 * torso ? (sampleAt(track.px[S.wrist], at) - hx) / span : NaN;
      };
      if (shot.armSeenAtSet && track.ok(EARS, i.set)) put('setLine', line(i.set), 'low');
      if (armUp && track.ok([S.wrist, S.shoulder, ...EARS], iFinish)) put('finishLine', line(iFinish), 'low');
      const lean = tiltFromUp(sampleAt(sh.x, i.release) - sampleAt(hip.x, i.release), sampleAt(sh.y, i.release) - sampleAt(hip.y, i.release));
      if (trunkSeen) put('sideLean', lean * out1, 'medium');
    }

    // Travel in the air can only be read from the picture, where a camera off the shot
    // line mixes forward travel into it. Past a small angle it is only a rough reading.
    if (landingSeen) {
      put('driftSide', ((travel * out1) / bodyH) * 100, offAxis > OFF_AXIS_OK_DEG ? 'low' : ankles.length === 2 ? 'high' : 'medium');
    }
    if (Number.isFinite(i.dip) && track.ok([LM.L_ANKLE, LM.R_ANKLE, LM.L_KNEE, LM.R_KNEE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP], i.dip)) {
      const at = i.dip;
      const sep = (a0, b0) => Math.abs(sampleAt(track.px[a0], at) - sampleAt(track.px[b0], at));
      const feet = sep(LM.L_ANKLE, LM.R_ANKLE);
      const knees = sep(LM.L_KNEE, LM.R_KNEE);
      const hips = sep(LM.L_HIP, LM.R_HIP);
      const shoulders = sep(LM.L_SHOULDER, LM.R_SHOULDER);
      if (shoulders > 0.2 * torso) put('stanceWidth', feet / shoulders, 'medium');
      // Knees that track straight sit on the line from hip to ankle, about halfway along it.
      const neutral = (hips + feet) / 2;
      if (neutral > 0.1 * torso) put('kneeTrack', knees / neutral, 'medium');
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
    const guideSeen = track.ok([Gd.wrist, Gd.shoulder], i.set) && track.ok([Gd.wrist, Gd.shoulder], end);
    if (armUp && shot.armSeenAtSet && guideSeen && riseS > 0.15 && guideVis > 0.4) {
      put('guideFollow', (riseG / riseS) * 100, frontal ? 'medium' : 'low');
    }
  }

  return out;
}
