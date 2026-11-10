// Finds each shot in a prepared track and marks its key moments. There is no ball
// tracking, so every moment is defined from the body alone and the definitions are
// kept deliberately simple and inspectable:
//
//   set point    the start of the final, fast elbow extension (where the arm stops
//                loading and starts pushing)
//   release      the moment the elbow has covered DETECT.releaseFraction of the way from
//                its set-point angle to its extended angle (an estimate; see README)
//   full ext.    the first moment the elbow is within 3 degrees of the angle it holds
//                once the extension has finished
//   dip          the deepest knee bend before the release
//   take-off     both feet clear the ground level they stood on during the dip
//   apex         the top of the flight (vertex of a parabola fitted to hip height)
//   landing      the first foot returns to the ground
//   follow end   the arm stops being extended above eye level

import { sideOf, otherSide, LM } from './landmarks.js';
import { argMin, argMax, firstUpCrossing, firstDownCrossing, refineExtremum, sampleAt, clamp } from './geometry.js';
import { median } from './stats.js';
import { derivative } from './filter.js';

export const DETECT = Object.freeze({
  /** wrist must rise at least this far above its shoulder (torso lengths) for a shot to be considered */
  minWristUp: 0.5,
  /** shots closer together than this (seconds) are treated as one */
  minSeparationS: 1.0,
  /** elbow must open at least this much from set point to full extension (degrees) */
  minExtensionDeg: 28,
  /** elbow must reach at least this angle (degrees) */
  minPeakElbowDeg: 118,
  /** slowest peak extension speed (degrees per second) that counts as a shooting motion */
  minExtensionSpeed: 150,
  /** the wrist must be at least this far above the shoulder at release (torso lengths) */
  minWristUpAtRelease: 0.15,
  /** fraction of the set-to-full elbow range that marks the release */
  releaseFraction: 0.85,
  /** the fast extension starts and ends where its speed passes this fraction of its peak */
  onsetFraction: 0.25,
  /** floor on that speed threshold (degrees per second) */
  onsetFloor: 60,
  /** a foot is off the ground when it is this far above its planted level (fraction of body height) */
  liftThreshold: 0.025,
  /** smallest peak foot lift that counts as a jump (fraction of body height) */
  minJumpLift: 0.04,
  /** flight times outside this range (seconds) are not believed */
  minFlightS: 0.1,
  maxFlightS: 1.1,
  /**
   * Fraction of the set-to-full elbow range at which the arm counts as having started to
   * open, and how far before that moment (as a multiple of the open-to-release interval)
   * the extension actually began, assuming an S-shaped movement. 3D elbow angles are
   * noisier than image-plane ones, so they use a higher level.
   */
  openFraction: 0.1,
  openBackoff: 0.53,
  openFraction3d: 0.2,
  openBackoff3d: 0.84,
  /** the arm is "waiting" at the set point while the wrist stays within this radius (torso lengths) */
  pauseRadius: 0.09,
  /** the follow-through has ended once the elbow has closed this far from full extension (degrees) */
  followDropDeg: 30,
  /** longest follow-through that is measured (seconds); longer holds are reported as "at least" */
  followWindowS: 2.5,
});

const G = 9.81;

function pickPeaks(arr, minValue, minSep, bad) {
  const n = arr.length;
  const taken = new Uint8Array(n);
  const peaks = [];
  for (;;) {
    let best = -1;
    let bv = minValue;
    for (let i = 0; i < n; i++) {
      if (!taken[i] && !bad[i] && arr[i] > bv) {
        bv = arr[i];
        best = i;
      }
    }
    if (best < 0) break;
    peaks.push(best);
    const a = Math.max(0, best - minSep);
    const b = Math.min(n - 1, best + minSep);
    for (let k = a; k <= b; k++) taken[k] = 1;
  }
  return peaks.sort((x, y) => x - y);
}

/** Least-squares parabola through (i, y[i]) for i in [a, b]; returns the vertex index and curvature. */
function fitParabola(y, a, b) {
  const m = b - a + 1;
  if (m < 4) return null;
  // Centre x to keep the normal equations well conditioned.
  const c = (a + b) / 2;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = a; i <= b; i++) {
    const x = i - c;
    const x2 = x * x;
    s0 += 1; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += y[i]; t1 += y[i] * x; t2 += y[i] * x2;
  }
  // Solve [s4 s3 s2; s3 s2 s1; s2 s1 s0] [A B C]' = [t2 t1 t0]'
  const det = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
  if (Math.abs(det) < 1e-9) return null;
  const A = (t2 * (s2 * s0 - s1 * s1) - s3 * (t1 * s0 - s1 * t0) + s2 * (t1 * s1 - s2 * t0)) / det;
  const B = (s4 * (t1 * s0 - t0 * s1) - t2 * (s3 * s0 - s1 * s2) + s2 * (s3 * t0 - s2 * t1)) / det;
  if (Math.abs(A) < 1e-12) return null;
  return { vertex: c - B / (2 * A), curvature: A };
}

function meanVisibility(track, landmarks, i) {
  const k = clamp(Math.round(i), 0, track.n - 1);
  let s = 0;
  for (const j of landmarks) s += track.vis[j][k];
  return s / landmarks.length;
}

/**
 * Try to build a shot around one wrist-height peak. Returns null when the motion
 * around the peak is not a shooting motion.
 */
function buildShot(track, hand, anchor, opts) {
  const fps = track.fps;
  const n = track.n;
  const S = sideOf(hand);
  const el = track.elbowSmooth(hand);
  const up = track.wristUp(hand);
  const omega = track.rate(`elbow:${hand}:${track.planar ? 2 : 3}`, el);
  const sec = (s) => Math.round(s * fps);

  // 1. The extension burst: fastest elbow opening shortly before the wrist peaks.
  const lo = Math.max(1, anchor - sec(0.9));
  const hi = Math.min(n - 2, anchor + sec(0.15));
  if (!(lo < hi)) return null;
  const iBurst = argMax(omega, lo, hi);
  if (iBurst < 0 || !(omega[iBurst] >= DETECT.minExtensionSpeed)) return null;
  const thr = Math.max(DETECT.onsetFloor, DETECT.onsetFraction * omega[iBurst]);

  // 2. End of the burst, and the extended plateau that follows it.
  const fwd = Math.min(n - 1, iBurst + sec(0.35));
  let ie = iBurst;
  while (ie < fwd && omega[ie] > thr) ie++;
  const pa = Math.min(n - 1, ie + sec(0.02));
  const pb = Math.min(n - 1, ie + sec(0.14));
  let sum = 0;
  let cnt = 0;
  for (let i = pa; i <= pb; i++) {
    sum += el[i];
    cnt++;
  }
  const thetaMax = cnt ? sum / cnt : el[ie];
  let iFull = firstUpCrossing(el, thetaMax - 3, iBurst, pb);
  if (!Number.isFinite(iFull)) iFull = ie;

  // 3. Rough start of the fast extension, from its speed.
  const back = Math.max(0, iBurst - sec(0.45));
  let io = iBurst;
  while (io > back && omega[io] > thr) io--;
  let thetaSet = el[io];
  if (!(thetaMax - thetaSet >= DETECT.minExtensionDeg) || !(thetaMax >= DETECT.minPeakElbowDeg)) return null;

  // 4. Refine with angle levels, which are steadier than speeds when the landmarks are noisy.
  //    `iOpen` is where the elbow has opened by DETECT.openFraction of its range; the
  //    set-point angle is the typical angle just before that; the release is where it has
  //    opened by DETECT.releaseFraction.
  const openFraction = track.planar ? DETECT.openFraction : DETECT.openFraction3d;
  const openBackoff = track.planar ? DETECT.openBackoff : DETECT.openBackoff3d;
  let iOpen = NaN;
  for (let pass = 0; pass < 2; pass++) {
    const openLevel = thetaSet + openFraction * (thetaMax - thetaSet);
    let k = iBurst;
    while (k > back && el[k] > openLevel) k--;
    iOpen = el[k] <= openLevel && k < iBurst && el[k + 1] > el[k]
      ? k + clamp((openLevel - el[k]) / (el[k + 1] - el[k]), 0, 1)
      : k;
    const wa = Math.max(0, Math.round(iOpen - 0.12 * fps));
    const wb = Math.max(wa, Math.round(iOpen - 0.02 * fps));
    thetaSet = median(Array.from(el.subarray(wa, wb + 1)));
  }
  if (!(thetaMax - thetaSet >= DETECT.minExtensionDeg)) return null;
  const level = thetaSet + DETECT.releaseFraction * (thetaMax - thetaSet);
  const iRel = firstUpCrossing(el, level, Math.floor(iOpen), pb);
  if (!Number.isFinite(iRel)) return null;
  if (!(sampleAt(up, iRel) >= DETECT.minWristUpAtRelease)) return null;
  // The set point is the start of the extension, extrapolated back from `iOpen`.
  const iSet = Math.max(0, iOpen - Math.min(0.12 * fps, openBackoff * (iRel - iOpen)));

  // 5. How long the arm waited at the set point before extending: how far back the wrist
  //    (relative to the shoulder) stays within a small radius of where it was at the set
  //    point, with the elbow still near its set-point angle. One stray frame is forgiven.
  const relX = (i) => track.px[S.wrist][i] - track.px[S.shoulder][i];
  const relY = (i) => track.py[S.wrist][i] - track.py[S.shoulder][i];
  const k0 = clamp(Math.round(iSet), 0, n - 1);
  const x0 = relX(k0);
  const y0 = relY(k0);
  const radius = DETECT.pauseRadius * track.torso;
  const waiting = (i) => Math.hypot(relX(i) - x0, relY(i) - y0) < radius && Math.abs(el[i] - thetaSet) < 12;
  let ia = k0;
  const pauseBack = Math.max(0, k0 - sec(1.2));
  while (ia > pauseBack && (waiting(ia - 1) || (ia - 2 >= pauseBack && waiting(ia - 2)))) ia--;
  const iArrive = Math.min(iSet, ia);

  // 6. Dip: deepest knee bend before the release. In a side view the near leg is the one seen clearly.
  const near = track.view.kind === 'side' && track.view.nearSide ? track.view.nearSide : null;
  const knee = near ? track.knee(near) : track.knees();
  const dipLo = Math.max(0, Math.floor(iSet) - sec(0.9));
  const iDip = argMin(knee, dipLo, Math.floor(iRel));
  const dipKnee = iDip >= 0 ? knee[iDip] : NaN;
  const iDipRef = iDip >= 0 ? refineExtremum(knee, iDip) : NaN;
  // A minimum sitting on the first frame of the clip means the dip started before the recording did.
  const dipAtEdge = iDip >= 0 && iDip === 0;

  // 7. Take-off and landing from the feet. Each foot point is compared with its own
  //    planted level, so a raised heel with the toe still down does not count as airborne
  //    and perspective (toe and heel at different depths) does not matter.
  const footPts = [LM.L_HEEL, LM.L_TOE, LM.R_HEEL, LM.R_TOE];
  const plantMid = iDip >= 0 ? iDip : Math.floor(iSet);
  const plantA = Math.max(0, plantMid - sec(0.3));
  const plantB = Math.min(n - 1, plantMid + sec(0.05));
  const bases = footPts.map((j) => median(Array.from(track.py[j].subarray(plantA, plantB + 1))));
  const airStart = Math.max(0, plantMid);
  const airEnd = Math.min(n - 1, Math.ceil(iRel) + sec(1.4));
  const lift = new Float64Array(n);
  for (let i = airStart; i <= airEnd; i++) {
    let m = Infinity;
    for (let k = 0; k < footPts.length; k++) m = Math.min(m, bases[k] - track.py[footPts[k]][i]);
    lift[i] = m / track.bodyH;
  }
  let jump = false;
  let iTO = NaN;
  let iLand = NaN;
  let iApex = NaN;
  let flight = NaN;
  let landingByStop = false;
  const toSearchEnd = Math.min(airEnd, Math.ceil(iRel) + sec(0.5));
  const cross = firstUpCrossing(lift, DETECT.liftThreshold, airStart, toSearchEnd);
  if (Number.isFinite(cross) && cross > airStart) {
    const iPk = argMax(lift, Math.ceil(cross), Math.min(airEnd, Math.ceil(cross) + sec(1.0)));
    if (iPk >= 0 && lift[iPk] >= DETECT.minJumpLift) {
      const byLevel = firstDownCrossing(lift, DETECT.liftThreshold, iPk, airEnd);
      // Landing somewhere that looks higher in the image (moving away from the camera)
      // never returns to the planted level, so also watch for the feet coming to rest.
      const rate = derivative(lift, fps);
      let byStop = NaN;
      for (let i = iPk + 1; i < airEnd; i++) {
        if (lift[i] < 0.6 * lift[iPk] && rate[i] > -0.2 && rate[i - 1] <= -0.2) {
          byStop = i - 1 + clamp((-0.2 - rate[i - 1]) / (rate[i] - rate[i - 1]), 0, 1);
          break;
        }
      }
      let down = NaN;
      if (Number.isFinite(byLevel) && Number.isFinite(byStop)) {
        down = Math.min(byLevel, byStop);
        landingByStop = byStop < byLevel;
      } else if (Number.isFinite(byLevel)) down = byLevel;
      else if (Number.isFinite(byStop)) {
        down = byStop;
        landingByStop = true;
      }
      if (Number.isFinite(down)) {
        const raw = (down - cross) / fps;
        if (raw >= DETECT.minFlightS && raw <= DETECT.maxFlightS) {
          jump = true;
          iTO = cross;
          iLand = down;
          // The threshold hides the first (and usually the last) few centimetres of flight; add them back.
          const hidden = DETECT.liftThreshold * (opts.heightM || 1.78);
          const ends = landingByStop ? 1 : 2;
          let T = raw;
          for (let k = 0; k < 3; k++) T = raw + (ends * hidden) / Math.max(0.5, (G * T) / 2);
          flight = T;
          const hip = track.mid(LM.L_HIP, LM.R_HIP).y;
          const fit = fitParabola(hip, Math.ceil(cross), Math.floor(down));
          const midpoint = (cross + down) / 2;
          // Image y grows downward, so a body rising and falling traces a parabola that opens upward.
          iApex = fit && fit.curvature > 0 && fit.vertex > cross && fit.vertex < down && Math.abs(fit.vertex - midpoint) < 0.1 * fps
            ? fit.vertex
            : midpoint;
        }
      }
    }
  }
  if (!jump) {
    // No flight: use the top of the body's rise as the reference moment.
    const hip = track.mid(LM.L_HIP, LM.R_HIP).y;
    const a = Math.max(0, plantMid);
    const b = Math.min(n - 1, Math.ceil(iRel) + sec(0.4));
    const k = argMin(hip, a, b);
    iApex = k >= 0 ? refineExtremum(hip, k) : NaN;
  }

  // 8. End of the follow-through.
  const eyes = track.wristAboveEyes(hand);
  const windowEnd = Math.max(Math.ceil(iFull), Math.min(n - 1, Math.ceil(iRel) + sec(DETECT.followWindowS), opts.until ?? n - 1));
  const dropLevel = thetaMax - DETECT.followDropDeg;
  const start = Math.ceil(iFull);
  const byElbow = firstDownCrossing(el, dropLevel, start, windowEnd);
  const byHeight = firstDownCrossing(eyes, 0, start, windowEnd);
  let iFollowEnd = Math.min(Number.isFinite(byElbow) ? byElbow : Infinity, Number.isFinite(byHeight) ? byHeight : Infinity);
  let followCapped = false;
  if (!Number.isFinite(iFollowEnd)) {
    iFollowEnd = windowEnd;
    followCapped = true;
  }

  // 9. Data quality around the shot.
  const span = [Math.max(0, Math.floor(iDip >= 0 ? iDip : iSet)), Math.min(n - 1, Math.ceil(iFollowEnd))];
  let bridged = 0;
  for (let i = span[0]; i <= span[1]; i++) bridged += track.bad[i];
  const armLm = [S.shoulder, S.elbow, S.wrist];
  const legLm = [LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];

  const idx = {
    dip: iDip >= 0 && !dipAtEdge ? iDipRef : NaN,
    setArrive: iArrive,
    set: iSet,
    release: iRel,
    full: iFull,
    takeoff: iTO,
    apex: iApex,
    landing: iLand,
    followEnd: iFollowEnd,
  };
  const t = {};
  for (const [k, v] of Object.entries(idx)) t[k] = Number.isFinite(v) ? track.timeAt(v) : NaN;

  return {
    hand,
    anchor,
    i: idx,
    t,
    jump,
    /** time in the air, seconds (NaN for a set shot) */
    flight,
    landingByStop,
    followCapped,
    setPause: Math.max(0, (iSet - iArrive) / fps),
    thetaSet,
    thetaMax,
    dipKnee,
    peakExtensionSpeed: omega[iBurst],
    quality: {
      armVisibility: (meanVisibility(track, armLm, iSet) + meanVisibility(track, armLm, iRel)) / 2,
      legVisibility: meanVisibility(track, legLm, iDip >= 0 ? iDip : iSet),
      bridgedFraction: bridged / Math.max(1, span[1] - span[0] + 1),
    },
  };
}

/**
 * Find every shot taken with `hand` ('left' | 'right') in the track.
 * @param {import('./track.js').Track} track
 * @param {'left'|'right'} hand
 * @param {{ heightM?: number }} [opts]
 */
export function findShots(track, hand, opts = {}) {
  if (!track.n || !(track.torso > 0) || !(track.bodyH > 0)) return [];
  const up = track.wristUp(hand);
  const minSep = Math.max(1, Math.round(DETECT.minSeparationS * track.fps));
  const anchors = pickPeaks(up, DETECT.minWristUp, minSep, track.bad);
  const shots = [];
  for (let k = 0; k < anchors.length; k++) {
    // A shot's follow-through cannot run into the next shot's wrist peak.
    const until = k + 1 < anchors.length ? anchors[k + 1] - Math.round(0.5 * track.fps) : track.n - 1;
    const shot = buildShot(track, hand, anchors[k], { ...opts, until });
    if (!shot) continue;
    const prev = shots[shots.length - 1];
    if (prev && Math.abs(prev.i.release - shot.i.release) < minSep) continue;
    shots.push(shot);
  }
  shots.forEach((s, i) => {
    s.index = i;
  });
  return shots;
}

/**
 * Work out which hand is shooting when it is not known: the side that produces
 * more shots, or on a tie the side whose wrist finishes higher.
 * @returns {{ hand: 'left'|'right', shots: object[], confident: boolean }}
 */
export function guessHand(track, opts = {}) {
  const right = findShots(track, 'right', opts);
  const left = findShots(track, 'left', opts);
  const height = (shots, hand) => {
    if (!shots.length) return -Infinity;
    const eyes = track.wristAboveEyes(hand);
    return median(shots.map((s) => sampleAt(eyes, s.i.full)));
  };
  const hr = height(right, 'right');
  const hl = height(left, 'left');
  let hand;
  if (right.length && left.length) hand = hr >= hl ? 'right' : 'left';
  else hand = left.length > right.length ? 'left' : 'right';
  const confident = right.length === 0 || left.length === 0 || Math.abs(hr - hl) > 2;
  return { hand, shots: hand === 'right' ? right : left, confident };
}

export { otherSide };
