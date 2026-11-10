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

/**
 * Direction the shooter is aiming, in the camera's ground plane, estimated from the
 * 3D landmarks: where the face points (eyes on the rim) and where the arm points at
 * full extension. Returns a unit vector { x, z } (x toward image-right, z away from
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
      const ex = (track.wx[LM.L_EAR][i] + track.wx[LM.R_EAR][i]) / 2;
      const ey = (track.wy[LM.L_EAR][i] + track.wy[LM.R_EAR][i]) / 2;
      const ez = (track.wz[LM.L_EAR][i] + track.wz[LM.R_EAR][i]) / 2;
      add(track.wx[LM.NOSE][i] - ex, track.wy[LM.NOSE][i] - ey, track.wz[LM.NOSE][i] - ez, 1);
    }
    const f = clamp(Math.round(s.i.full + 0.03 * fps), 0, n - 1);
    add(track.wx[S.wrist][f] - track.wx[S.shoulder][f], track.wy[S.wrist][f] - track.wy[S.shoulder][f], track.wz[S.wrist][f] - track.wz[S.shoulder][f], 4);
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
    offSideDeg: offSide,
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

function frameProblems(raw) {
  // How often parts of the body leave the picture, judged on the raw landmarks.
  let seen = 0;
  let feetCut = 0;
  let handsCut = 0;
  for (const f of raw.frames) {
    if (!f.lm) continue;
    seen++;
    const lowFoot = Math.max(f.lm[LM.L_HEEL].y, f.lm[LM.R_HEEL].y, f.lm[LM.L_TOE].y, f.lm[LM.R_TOE].y);
    const highHand = Math.min(f.lm[LM.L_WRIST].y, f.lm[LM.R_WRIST].y);
    if (lowFoot > 0.995) feetCut++;
    if (highHand < 0.005) handsCut++;
  }
  return { feetCut: seen ? feetCut / seen : 0, handsCut: seen ? handsCut / seen : 0 };
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
  if (track.n < 10) return empty('tooShort');
  if (track.detectedFraction < 0.3 || !(track.bodyH > 0)) return empty('noPerson');

  const declared = opts.declaredView || null;
  // Start from the stated angle when there is one; front and back are told apart automatically.
  if (declared === 'side') track.setView({ kind: 'side' });
  else if (declared === 'front' || declared === 'back') track.setView({ kind: track.view.chestToCamera ? 'front' : 'back' });

  const shotOpts = { heightM: opts.heightM };
  let hand = opts.hand;
  let shots;
  if (hand) {
    shots = findShots(track, hand, shotOpts);
    if (!shots.length) {
      const other = findShots(track, otherSide(hand), shotOpts);
      if (other.length) {
        warn('otherHand', otherSide(hand));
        hand = otherSide(hand);
        shots = other;
      }
    }
  } else {
    const g = guessHand(track, shotOpts);
    hand = g.hand;
    shots = g.shots;
    if (shots.length && !g.confident) warn('handUnclear');
  }

  // Check the camera angle against where the shooter is actually aiming.
  let detected = null;
  const aim = aimDirection(track, shots, hand);
  if (aim) {
    const v = viewFromAim(aim);
    detected = v.kind;
    const before = track.view.kind;
    const declaredFrontal = declared === 'front' || declared === 'back';
    let next = before;
    if (!declared) next = v.kind;
    else if (declared === 'side' && (v.kind === 'front' || v.kind === 'back')) {
      next = v.kind;
      warn('viewMismatch', `side:${v.kind}`);
    } else if (declaredFrontal && v.kind === 'side') {
      next = 'side';
      warn('viewMismatch', `${declared}:side`);
    } else if (declaredFrontal && (v.kind === 'front' || v.kind === 'back')) {
      next = v.kind;
    } else if (v.kind === 'diagonal') {
      warn('angledCamera', String(Math.round(v.offSideDeg)));
    }
    const patch = { kind: next, chestToCamera: v.chestToCamera };
    if (v.facing) patch.facing = v.facing;
    const planarBefore = track.planar;
    track.setView(patch);
    if (track.planar !== planarBefore || next !== before) shots = findShots(track, hand, shotOpts);
  }

  if (track.fps < 24) warn('lowFps', String(Math.round(track.fps)));
  if (track.bodyH < 0.28 * track.H) warn('smallInFrame');
  const cut = frameProblems(raw);
  if (cut.feetCut > 0.15) warn('feetCut');
  if (cut.handsCut > 0.03) warn('handsCut');
  if (track.view.kind === 'side' && track.view.nearSide && track.view.nearSide !== hand && shots.length) warn('offHandSide');
  const flights = shots.filter((s) => s.jump).map((s) => s.flight);
  if (flights.length && median(flights) > 0.85) warn('slowMotion');
  if (!shots.length) warn('noShots');

  for (const s of shots) {
    s.metrics = measureShot(track, s, shotOpts);
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
