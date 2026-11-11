// Clip-level pipeline: raw landmarks in, measured shots out.

import { prepareTrack } from './track.js';
import { findShots, guessHand } from './shots.js';
import { measureShot } from './metrics.js';
import { LM, N_LANDMARKS, sideOf, otherSide } from './landmarks.js';
import { clamp, sampleAt, toDeg } from './geometry.js';
import { median } from './stats.js';

/** A camera within this many degrees of square-on to the shot counts as a side view. */
export const SIDE_TOLERANCE_DEG = 27;
/** A camera within this many degrees of the line of the shot counts as a front or back view. */
export const FRONT_TOLERANCE_DEG = 32;
/** Shortest clip (seconds) that can hold a shot, and the least time a person has to be tracked in it. */
export const MIN_CLIP_S = 1;
export const MIN_TRACKED_S = 1;
/** Apparent gravity (m/s^2) below which the video is taken to be slow motion. Real speed gives about 9.8. */
export const SLOW_MOTION_GRAVITY = 4.5;
/** Measurements that are only right at real speed. They are withheld from slow-motion video. */
export const SPEED_METRICS = Object.freeze(['tempo', 'setPause', 'releaseVsApex', 'followHold', 'jumpHeight']);
/** Past this many degrees off the shot line, a front or back clip gets a warning. */
export const OFF_AXIS_WARN_DEG = 15;

/**
 * Direction the shooter is aiming, in the camera's ground plane, estimated from the
 * 3D landmarks: mostly where the face points (eyes on the rim), with the extended arm
 * as a minor vote because arms tend to finish slightly across the body. Returns a unit vector { x, z } (x toward image-right, z away from
 * the camera) or null when it cannot be estimated.
 */
export function aimDirection(track, shots, hand) {
  if (!track.hasWorld || !shots.length) return null;
  const S = sideOf(hand);
  const n = track.n;
  const fps = track.fps;
  const xs = [];
  const zs = [];
  const add = (dx, dy, dz, weight) => {
    const h = Math.hypot(dx, dz);
    const len = Math.hypot(dx, dy, dz);
    // A vector that is nearly vertical says nothing reliable about heading.
    if (!(len > 1e-6) || h / len < 0.25) return;
    for (let k = 0; k < weight; k++) {
      xs.push(dx / h);
      zs.push(dz / h);
    }
  };
  for (const s of shots) {
    const a = clamp(Math.round(s.i.set - 0.3 * fps), 0, n - 1);
    const b = clamp(Math.round(s.i.release), 0, n - 1);
    for (let i = a; i <= b; i += 2) {
      if (!track.ok([LM.NOSE, LM.L_EAR, LM.R_EAR], i)) continue;
      const ex = (track.wx[LM.L_EAR][i] + track.wx[LM.R_EAR][i]) / 2;
      const ey = (track.wy[LM.L_EAR][i] + track.wy[LM.R_EAR][i]) / 2;
      const ez = (track.wz[LM.L_EAR][i] + track.wz[LM.R_EAR][i]) / 2;
      add(track.wx[LM.NOSE][i] - ex, track.wy[LM.NOSE][i] - ey, track.wz[LM.NOSE][i] - ez, 1);
    }
    const f = clamp(Math.round(s.i.full + 0.03 * fps), 0, n - 1);
    if (!s.handsCut && track.ok([S.wrist, S.shoulder], f)) add(track.wx[S.wrist][f] - track.wx[S.shoulder][f], track.wy[S.wrist][f] - track.wy[S.shoulder][f], track.wz[S.wrist][f] - track.wz[S.shoulder][f], 1);
  }
  if (xs.length < 3) return null;
  const mx = median(xs);
  const mz = median(zs);
  const h = Math.hypot(mx, mz);
  if (!(h > 0.2)) return null;
  return { x: mx / h, z: mz / h };
}

/** Turn an aim direction into a camera-view classification. */
export function viewFromAim(aim) {
  const offSide = toDeg(Math.asin(clamp(Math.abs(aim.z), 0, 1))); // 0 = perfect side view
  const offAxis = toDeg(Math.asin(clamp(Math.abs(aim.x), 0, 1))); // 0 = perfect front or back view
  let kind;
  if (offSide <= SIDE_TOLERANCE_DEG) kind = 'side';
  else if (offAxis <= FRONT_TOLERANCE_DEG) kind = aim.z < 0 ? 'front' : 'back';
  else kind = 'diagonal';
  return {
    kind,
    facing: aim.x > 0.15 ? 1 : aim.x < -0.15 ? -1 : 0,
    chestToCamera: aim.z < 0,
    /** degrees the camera is away from square-on to the shot (0 = a perfect side view) */
    offSideDeg: offSide,
    /** degrees the camera is away from the line of the shot (0 = a perfect front or back view) */
    offAxisDeg: offAxis,
  };
}

/** Landmark positions (normalised 0-1 image coordinates) at a fractional frame index. */
export function poseAt(track, i) {
  const out = new Array(N_LANDMARKS);
  for (let j = 0; j < N_LANDMARKS; j++) {
    out[j] = [sampleAt(track.px[j], i) / track.W, sampleAt(track.py[j], i) / track.H];
  }
  return out;
}

/**
 * Analyse one clip.
 *
 * @param {import('./track.js').RawTrack} raw
 * @param {object} [opts]
 * @param {'left'|'right'} [opts.hand]            shooting hand, when known
 * @param {'side'|'front'|'back'} [opts.declaredView] the angle the user says this clip was filmed from
 * @param {number} [opts.heightM]                 shooter's height in metres, when known
 * @returns {{
 *   track: import('./track.js').Track,
 *   hand: 'left'|'right',
 *   view: { kind: string, facing: number, chestToCamera: boolean, nearSide: string|null, declared: string|null, detected: string|null },
 *   shots: object[],
 *   warnings: { code: string, detail?: string }[],
 *   info: { frames: number, fps: number, duration: number, detectedFraction: number }
 * }}
 */
export function analyzeClip(raw, opts = {}) {
  const warnings = [];
  const warn = (code, detail) => warnings.push(detail ? { code, detail } : { code });
  const track = prepareTrack(raw);
  const info = {
    frames: track.n,
    fps: track.fps,
    duration: track.n * track.dt,
    detectedFraction: track.detectedFraction,
  };
  const empty = (code) => {
    warn(code);
    return {
      track,
      hand: opts.hand || 'right',
      view: { ...track.view, declared: opts.declaredView || null, detected: null },
      shots: [],
      warnings,
      info,
    };
  };
  if (track.n < 10 || track.n * track.dt < MIN_CLIP_S) return empty('tooShort');
  // "No person" means next to nothing was tracked. A shooter who is off screen most of
  // the time fetching the ball is fine as long as they are tracked while shooting.
  if (track.detectedFraction * track.n * track.dt < MIN_TRACKED_S) return empty('noPerson');
  // Without the hips in view there is no body scale to measure against, and the legs
  // are certainly out of the picture too.
  if (track.hipsSeen < 0.5 || !(track.torso > 0) || !(track.bodyH > 0)) return empty('legsCut');

  const declared = opts.declaredView || null;
  // Start from the stated angle when there is one; front and back are told apart automatically.
  if (declared === 'side') track.setView({ kind: 'side' });
  else if (declared === 'front' || declared === 'back') track.setView({ kind: track.view.chestToCamera ? 'front' : 'back' });

  const shotOpts = { heightM: opts.heightM };
  // Both arms are always examined. The stated hand is used unless the other one is
  // clearly the one shooting (a wrong profile, or a mirrored recording).
  const pickHand = () => {
    const g = guessHand(track, shotOpts);
    if (!opts.hand) return { hand: g.hand, shots: g.shots, switched: false, unclear: g.shots.length > 0 && !g.confident };
    const stated = g[opts.hand];
    const other = g[otherSide(opts.hand)];
    const switchHands = other.length > 0 && (stated.length === 0 || (g.hand !== opts.hand && g.confident && other.length >= stated.length));
    return switchHands ? { hand: otherSide(opts.hand), shots: other, switched: true, unclear: false } : { hand: opts.hand, shots: stated, switched: false, unclear: false };
  };
  let picked = pickHand();
  let hand = picked.hand;
  let shots = picked.shots;

  // Check the camera angle against where the shooter is actually aiming.
  let detected = null;
  const aim = aimDirection(track, shots, hand);
  if (aim) {
    const v = viewFromAim(aim);
    detected = v.kind;
    const before = track.view.kind;
    const planarBefore = track.planar;
    let next;
    if (v.kind === 'diagonal') {
      // Whatever angle was stated, the camera is not square to anything: image-plane
      // angles would be wrong, so fall back to the 3D estimates and say so.
      next = 'diagonal';
      const nearerSide = v.offSideDeg <= v.offAxisDeg;
      warn('angledCamera', `${Math.round(nearerSide ? v.offSideDeg : v.offAxisDeg)}:${nearerSide ? 'side' : 'line'}`);
    } else {
      next = v.kind;
      if (declared === 'side' && v.kind !== 'side') warn('viewMismatch', `side:${v.kind}`);
      else if ((declared === 'front' || declared === 'back') && v.kind === 'side') warn('viewMismatch', `${declared}:side`);
      if ((v.kind === 'front' || v.kind === 'back') && v.offAxisDeg > OFF_AXIS_WARN_DEG) warn('offAxis', String(Math.round(v.offAxisDeg)));
    }
    const patch = { kind: next, chestToCamera: v.chestToCamera, aim, offAxisDeg: v.offAxisDeg, offSideDeg: v.offSideDeg };
    if (v.facing) patch.facing = v.facing;
    track.setView(patch);
    if (track.planar !== planarBefore || next !== before) {
      picked = pickHand();
      hand = picked.hand;
      shots = picked.shots;
    }
  }
  if (picked.switched) warn('otherHand', hand);
  if (picked.unclear) warn('handUnclear');

  if (track.fps < 24) warn('lowFps', String(Math.round(track.fps)));
  if (track.bodyH < 0.28 * track.H) warn('smallInFrame');
  if (shots.some((s) => s.jump === null)) warn('feetCut');
  if (shots.some((s) => s.handsCut)) warn('handsCut');
  if (track.view.kind === 'side' && track.view.nearSide && track.view.nearSide !== hand && shots.length) warn('offHandSide');
  // Slow-motion video stretches everything: implausibly long flights, a push that takes
  // several times longer than an arm can take, or a body that falls too gently.
  const flights = shots.filter((s) => s.jump === true).map((s) => s.flight);
  const pushes = shots.map((s) => s.t.full - s.t.set).filter(Number.isFinite);
  const pulls = shots.map((s) => s.gravity).filter(Number.isFinite);
  if (
    (flights.length && median(flights) > 0.75) ||
    shots.some((s) => Number.isFinite(s.longAir)) ||
    (pushes.length && median(pushes) > 0.5) ||
    (pulls.length && median(pulls) < SLOW_MOTION_GRAVITY)
  ) warn('slowMotion');
  if (!shots.length) {
    // Nothing moved like a shot at normal speed. If the same motions are there at a
    // fraction of the speed, the recording is slow motion.
    const crawl = findShots(track, hand, { ...shotOpts, minExtensionSpeed: 12 });
    const slowPush = crawl.map((s) => s.t.full - s.t.set).filter(Number.isFinite);
    if (slowPush.length && median(slowPush) > 0.5 && !warnings.some((w) => w.code === 'slowMotion')) warn('slowMotion');
    warn('noShots');
  }

  const slow = warnings.some((w) => w.code === 'slowMotion');
  for (const s of shots) {
    s.metrics = measureShot(track, s, shotOpts);
    // Positions and angles are the same at any playback speed; times are not.
    if (slow) {
      for (const id of SPEED_METRICS) delete s.metrics[id];
      s.slow = true;
    }
    s.view = track.view.kind;
    if (s.quality.bridgedFraction > 0.2) s.lowQuality = true;
  }

  return {
    track,
    hand,
    view: { ...track.view, declared, detected },
    shots,
    warnings,
    info,
  };
}

/** The moments worth showing as marked-up still frames for one shot. */
export function keyMoments(shot) {
  const list = [
    ['dip', shot.t.dip, shot.i.dip],
    ['set', shot.t.set, shot.i.set],
    ['release', shot.t.release, shot.i.release],
    ['finish', shot.t.full, shot.i.full],
    ['landing', shot.t.landing, shot.i.landing],
  ];
  return list.filter(([, t]) => Number.isFinite(t)).map(([id, t, i]) => ({ id, t, i }));
}
