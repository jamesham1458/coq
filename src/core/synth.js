// Synthetic shooter: a small kinematic model of a jump shot that produces landmark
// tracks in the same format the pose engine does. It exists so the analysis can be
// tested against known answers (a shooter built with an 82 degree set-point elbow
// should be measured at about 82 degrees) and so the page has a realistic example.
//
// Body frame: X points at the basket, Y is up, Z is to the shooter's right. Metres.

import { LM, N_LANDMARKS } from './landmarks.js';
import { clamp, toRad, toDeg, angle3 } from './geometry.js';

const G = 9.81;

/** Fraction of the elbow's set-to-full-extension range reached at the modelled release. */
export const RELEASE_FRACTION = 0.85;

export const DEFAULT_SHOOTER = Object.freeze({
  heightM: 1.8,
  hand: 'right',
  // Timing (seconds)
  tStart: 0.6, // standing still until the dip begins
  dipDur: 0.36, // start of dip to deepest point
  riseDur: 0.25, // deepest point to take-off
  flight: 0.44, // time in the air; 0 makes it a set shot
  releaseVsApex: -0.05, // release time minus apex time
  extDur: 0.16, // set point to full elbow extension
  setPause: 0.03, // time the arm waits at the set point
  followHold: 0.6, // time the arm stays extended after release
  // Legs and trunk (degrees)
  kneeFlexDip: 62, // knee flexion at the deepest point (knee angle = 180 - this)
  trunkLeanDip: 16, // forward lean at the dip
  trunkLeanRelease: 3, // forward lean at release (negative leans back)
  sideLean: 0, // lean toward the shooting side at release
  // Shooting arm (degrees)
  setShoulder: 100, // upper-arm angle from hanging straight down, at the set point
  setElbow: 82, // elbow angle at the set point (180 = straight)
  relShoulder: 140, // upper-arm angle at full extension
  maxElbow: 172, // elbow angle at full extension
  flare: 4, // elbow rotated outward about the shoulder-wrist line
  armTilt: 8, // whole arm tilted toward the head (ball over the eye rather than the shoulder)
  guidePush: 0, // 0 = guide hand comes off cleanly, 1 = guide arm extends with the shot
  // Base and balance
  stance: 1.0, // ankle spacing as a multiple of shoulder width
  kneeValgus: 0, // 0 = knees track over the feet, 1 = knees collapse to hip width or inside
  turn: 12, // body turned so the shooting shoulder leads (degrees)
  driftForward: 0.12, // metres travelled toward the basket in the air
  driftLateral: 0, // metres travelled toward the shooting side in the air
});

export const DEFAULT_CAMERA = Object.freeze({
  yawDeg: 90, // 0 = in front (basket side), 90 = shooter's right, 180 = behind, 270 = left
  distM: 4.3,
  heightM: 1.05,
  aimHeightM: 1.25, // height the optical axis passes through at the shooter
  fovVDeg: 62,
  width: 720,
  height: 1280,
  rollDeg: 0,
});

function minJerk(u) {
  const c = clamp(u, 0, 1);
  return c * c * c * (10 + c * (-15 + 6 * c));
}

/** Smooth piecewise curve through [time, value] keys (sorted by time), eased with minimum jerk. */
function curve(keys) {
  const ks = keys.filter((k, i) => i === 0 || k[0] > keys[i - 1][0] + 1e-9);
  return (t) => {
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i][0]) {
        const u = (t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0]);
        return ks[i - 1][1] + (ks[i][1] - ks[i - 1][1]) * minJerk(u);
      }
    }
    return ks[ks.length - 1][1];
  };
}

/** Deterministic PRNG (mulberry32) with a Box-Muller normal. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    let u = 0;
    while (u < 1e-12) u = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
  return { uniform, normal };
}

/** Event times for one shot, in seconds from the start of that shot. */
export function shotTimeline(p) {
  const tDipStart = p.tStart;
  const tDip = tDipStart + p.dipDur;
  const tTakeoff = tDip + p.riseDur;
  const flight = Math.max(0, p.flight);
  const tLanding = tTakeoff + flight;
  const tApex = tTakeoff + flight / 2;
  const tRelease = tApex + p.releaseVsApex;
  // minJerk(0.71) is 0.85, so the elbow passes RELEASE_FRACTION of its range at tRelease.
  const tExt0 = tRelease - 0.71 * p.extDur;
  const tExt1 = tRelease + 0.29 * p.extDur;
  const tSetArrive = tExt0 - Math.max(0, p.setPause);
  const tLift0 = Math.min(tDip - 0.12, tSetArrive - 0.24);
  const tFollowEnd = tRelease + p.followHold;
  const tEnd = Math.max(tLanding + 0.9, tFollowEnd + 0.7);
  return { tDipStart, tDip, tTakeoff, tLanding, tApex, tRelease, tExt0, tExt1, tSetArrive, tLift0, tFollowEnd, tEnd, flight };
}

function rotateAbout(v, k, angRad) {
  // Rodrigues rotation of v about unit axis k.
  const c = Math.cos(angRad);
  const s = Math.sin(angRad);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d * (1 - c),
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d * (1 - c),
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d * (1 - c),
  ];
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Build the 33 landmark positions (body frame, metres) for one shooter at time t.
 * Returns an array of [x, y, z].
 */
function pose(p, tl, t) {
  const H = p.heightM;
  const s = p.hand === 'left' ? -1 : 1; // +1 when the shooting arm is the right arm
  const L = {
    ankleH: 0.04 * H, shank: 0.246 * H, thigh: 0.245 * H, trunk: 0.288 * H,
    upper: 0.186 * H, fore: 0.146 * H, hand: 0.075 * H, foot: 0.152 * H,
    shoulderHalf: 0.105 * H, hipHalf: 0.052 * H,
  };

  // ---- Legs: knee flexion, heel raise, trunk lean over time --------------------
  const jump = tl.flight > 0;
  const kneeFlex = curve(
    jump
      ? [[0, 8], [tl.tDipStart, 8], [tl.tDip, p.kneeFlexDip], [tl.tTakeoff, 3], [tl.tApex, 14], [tl.tLanding, 3], [tl.tLanding + 0.16, 42], [tl.tLanding + 0.65, 9]]
      : [[0, 8], [tl.tDipStart, 8], [tl.tDip, p.kneeFlexDip], [tl.tTakeoff, 3], [tl.tTakeoff + 0.4, 9]],
  )(t);
  const heel = curve(
    jump
      ? [[0, 0], [tl.tTakeoff - 0.1, 0], [tl.tTakeoff, 48], [tl.tLanding, 48], [tl.tLanding + 0.12, 0]]
      : [[0, 0], [tl.tTakeoff - 0.1, 0], [tl.tTakeoff, 28], [tl.tTakeoff + 0.3, 0]],
  )(t);
  const lean = curve([[0, 4], [tl.tDipStart, 4], [tl.tDip, p.trunkLeanDip], [tl.tRelease, p.trunkLeanRelease], [tl.tLanding + 0.25, p.trunkLeanRelease + 2], [tl.tEnd, 4]])(t);
  const sideLean = curve([[0, 0], [tl.tDip, 0], [tl.tRelease, p.sideLean], [tl.tLanding + 0.4, 0]])(t);

  const turn = toRad(p.turn);
  // Body axes after the stance turn: `fb` is where the hips face, `rb` points to the shooter's right.
  const fb = [Math.cos(turn), 0, -s * Math.sin(turn)];
  const rb = [s * Math.sin(turn), 0, Math.cos(turn)];

  // Sagittal leg chain measured from the toe: returns ankle, knee, hip offsets as [along fb, up].
  const legChain = (flexDeg, heelDeg) => {
    const th = toRad(heelDeg);
    const a = toRad(0.45 * flexDeg);
    const b = toRad(0.55 * flexDeg);
    const heelPt = [-L.foot * Math.cos(th), L.foot * Math.sin(th)];
    const ankle = [-0.75 * L.foot * Math.cos(th) + L.ankleH * Math.sin(th), 0.75 * L.foot * Math.sin(th) + L.ankleH * Math.cos(th)];
    const knee = [ankle[0] + L.shank * Math.sin(a), ankle[1] + L.shank * Math.cos(a)];
    const hip = [knee[0] - L.thigh * Math.sin(b), knee[1] + L.thigh * Math.cos(b)];
    return { heelPt, ankle, knee, hip };
  };

  const chain = legChain(kneeFlex, heel);
  const toeStart = 0.75 * L.foot; // puts the standing ankle over the body-frame origin
  let toeAlong; // toe position along fb
  let toeUp; // toe height
  let lateralShift = 0; // whole-body sideways travel, toward +Z
  if (jump && t > tl.tTakeoff && t < tl.tLanding) {
    const tau = t - tl.tTakeoff;
    const v0 = (G * tl.flight) / 2;
    const takeoff = legChain(3, 48);
    const hipUp = takeoff.hip[1] + v0 * tau - 0.5 * G * tau * tau;
    const frac = tau / tl.flight;
    toeUp = hipUp - chain.hip[1];
    toeAlong = toeStart + takeoff.hip[0] - chain.hip[0] + p.driftForward * frac;
    lateralShift = s * p.driftLateral * frac;
  } else {
    const landed = jump && t >= tl.tLanding;
    toeUp = 0;
    toeAlong = toeStart + (landed ? p.driftForward : 0);
    lateralShift = landed ? s * p.driftLateral : 0;
  }
  // Drift is defined along the target line, so apply it in X/Z after building the leg in the body plane.
  const driftX = toeAlong - toeStart;
  const base = (along, up, lateral) => [
    fb[0] * (toeStart + along) + rb[0] * lateral + driftX,
    up,
    fb[2] * (toeStart + along) + rb[2] * lateral + lateralShift,
  ];
  const along = (pt) => pt[0];
  const hipC = base(along(chain.hip), toeUp + chain.hip[1], 0);

  const pts = new Array(N_LANDMARKS);
  const stanceHalf = p.stance * L.shoulderHalf;
  for (const side of [1, -1]) {
    // side = +1 for the shooter's right leg
    const idx = side === 1
      ? { hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, toe: LM.R_TOE }
      : { hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, toe: LM.L_TOE };
    const hipLat = side * L.hipHalf;
    const footLat = side * stanceHalf;
    const kneeLat = side * (L.hipHalf + (stanceHalf - L.hipHalf) * 0.55 * (1 - 1.6 * p.kneeValgus * (kneeFlex / Math.max(1, p.kneeFlexDip))));
    pts[idx.hip] = base(along(chain.hip), toeUp + chain.hip[1], hipLat);
    pts[idx.knee] = base(along(chain.knee), toeUp + chain.knee[1], kneeLat);
    pts[idx.ankle] = base(along(chain.ankle), toeUp + chain.ankle[1], footLat);
    pts[idx.heel] = base(along(chain.heelPt), toeUp + chain.heelPt[1], footLat);
    pts[idx.toe] = base(0, toeUp, footLat);
  }

  // ---- Trunk, shoulders, head ----------------------------------------------------
  const lr = toRad(lean);
  const sl = toRad(sideLean) * s;
  const up = [Math.sin(lr) * fb[0] + Math.sin(sl) * rb[0], Math.cos(lr) * Math.cos(sl), Math.sin(lr) * fb[2] + Math.sin(sl) * rb[2]];
  const upN = mul(up, 1 / norm(up));
  const shC = add(hipC, mul(upN, L.trunk));
  const shR = add(shC, mul(rb, L.shoulderHalf));
  const shL = add(shC, mul(rb, -L.shoulderHalf));
  pts[LM.R_SHOULDER] = shR;
  pts[LM.L_SHOULDER] = shL;
  // The head stays upright and faces the basket.
  const head = (fwd, upH, lat) => [shC[0] + fwd * H, shC[1] + upH * H, shC[2] + lat * H];
  pts[LM.NOSE] = head(0.058, 0.107, 0);
  pts[LM.L_EYE_IN] = head(0.045, 0.119, -0.01);
  pts[LM.L_EYE] = head(0.043, 0.12, -0.018);
  pts[LM.L_EYE_OUT] = head(0.038, 0.119, -0.026);
  pts[LM.R_EYE_IN] = head(0.045, 0.119, 0.01);
  pts[LM.R_EYE] = head(0.043, 0.12, 0.018);
  pts[LM.R_EYE_OUT] = head(0.038, 0.119, 0.026);
  pts[LM.L_EAR] = head(-0.005, 0.112, -0.042);
  pts[LM.R_EAR] = head(-0.005, 0.112, 0.042);
  pts[LM.MOUTH_L] = head(0.046, 0.086, -0.013);
  pts[LM.MOUTH_R] = head(0.046, 0.086, 0.013);

  // ---- Arms ----------------------------------------------------------------------
  const restS = 18;
  const restE = 150;
  const pocketS = 28;
  // The elbow closes on the way up, so the pocket is always more open than the set point.
  const pocketE = Math.max(96, p.setElbow + 14);
  const sigma = curve([
    [0, restS], [tl.tDipStart - 0.25, restS], [tl.tLift0, pocketS], [tl.tSetArrive, p.setShoulder], [tl.tExt0, p.setShoulder],
    [tl.tExt1, p.relShoulder], [tl.tFollowEnd, p.relShoulder - 4], [tl.tFollowEnd + 0.45, restS],
  ])(t);
  const eps = curve([
    [0, restE], [tl.tDipStart - 0.25, restE], [tl.tLift0, pocketE], [tl.tSetArrive, p.setElbow], [tl.tExt0, p.setElbow],
    [tl.tExt1, p.maxElbow], [tl.tFollowEnd, p.maxElbow - 2], [tl.tFollowEnd + 0.45, restE],
  ])(t);
  const wristBend = curve([[0, 5], [tl.tLift0, 20], [tl.tSetArrive, 62], [tl.tExt0, 62], [tl.tExt1 + 0.05, -45], [tl.tFollowEnd, -40], [tl.tFollowEnd + 0.45, 5]])(t);

  // Sagittal two-link arm from a shoulder. Angles are measured from straight down, toward the basket.
  const arm = (shoulder, sigmaDeg, epsDeg, bendDeg, sideSign, flareDeg, tiltDeg) => {
    const sg = toRad(sigmaDeg);
    const ff = toRad(sigmaDeg + (180 - epsDeg));
    const fh = toRad(sigmaDeg + (180 - epsDeg) + bendDeg);
    let e = [L.upper * Math.sin(sg), -L.upper * Math.cos(sg), 0];
    let w = add(e, [L.fore * Math.sin(ff), -L.fore * Math.cos(ff), 0]);
    let h = add(w, [L.hand * Math.sin(fh), -L.hand * Math.cos(fh), 0]);
    // Flare: swing the elbow outward about the shoulder-wrist line; the wrist stays put.
    const wl = norm(w);
    if (wl > 1e-6 && Math.abs(flareDeg) > 1e-9) {
      const axis = mul(w, 1 / wl);
      const plus = rotateAbout(e, axis, toRad(flareDeg));
      const minus = rotateAbout(e, axis, -toRad(flareDeg));
      e = plus[2] * sideSign >= minus[2] * sideSign ? plus : minus;
    }
    // Tilt: lean the whole arm toward the head (rotation about the forward axis).
    if (Math.abs(tiltDeg) > 1e-9) {
      const ang = -sideSign * toRad(tiltDeg);
      const ax = [1, 0, 0];
      e = rotateAbout(e, ax, ang);
      w = rotateAbout(w, ax, ang);
      h = rotateAbout(h, ax, ang);
    }
    return { elbow: add(shoulder, e), wrist: add(shoulder, w), index: add(shoulder, h) };
  };

  const shootShoulder = s === 1 ? shR : shL;
  const guideShoulder = s === 1 ? shL : shR;
  const shoot = arm(shootShoulder, sigma, eps, wristBend, s, p.flare, p.armTilt);

  // Guide arm: rides up with the ball to the set point, then either stays or pushes.
  const gp = clamp(p.guidePush, 0, 1);
  const pushU = minJerk((t - tl.tExt0) / (tl.tExt1 - tl.tExt0));
  const settle = curve([[0, 0], [tl.tExt1 + 0.1, 0], [tl.tExt1 + 0.6, 1]])(t);
  const gSigmaSet = p.setShoulder - 10;
  const gEpsSet = Math.min(p.setElbow + 14, 120);
  let gSigma = curve([[0, restS], [tl.tDipStart - 0.25, restS], [tl.tLift0, pocketS], [tl.tSetArrive, gSigmaSet]])(t);
  let gEps = curve([[0, restE], [tl.tDipStart - 0.25, restE], [tl.tLift0, pocketE + 6], [tl.tSetArrive, gEpsSet]])(t);
  if (t > tl.tExt0) {
    gSigma = gSigmaSet + gp * (p.relShoulder - 8 - gSigmaSet) * pushU;
    gEps = gEpsSet + (6 + gp * (p.maxElbow - 12 - gEpsSet)) * pushU;
    gSigma += (restS - gSigma) * settle;
    gEps += (restE - gEps) * settle;
  }
  const guide = arm(guideShoulder, gSigma, gEps, 10, -s, 14, 38);

  const put = (isRight, a) => {
    pts[isRight ? LM.R_ELBOW : LM.L_ELBOW] = a.elbow;
    pts[isRight ? LM.R_WRIST : LM.L_WRIST] = a.wrist;
    pts[isRight ? LM.R_INDEX : LM.L_INDEX] = a.index;
    pts[isRight ? LM.R_PINKY : LM.L_PINKY] = add(a.index, [0, -0.01, (isRight ? 1 : -1) * 0.02]);
    pts[isRight ? LM.R_THUMB : LM.L_THUMB] = add(a.wrist, mul(sub(a.index, a.wrist), 0.5));
  };
  put(s === 1, shoot);
  put(s !== 1, guide);

  return pts;
}

/** Project body-frame points into image landmarks and camera-aligned world landmarks. */
function project(pts, cam, rng, noise) {
  const yaw = toRad(cam.yawDeg);
  const pos = [cam.distM * Math.cos(yaw), cam.heightM, cam.distM * Math.sin(yaw)];
  const aim = [0, cam.aimHeightM, 0];
  let f = sub(aim, pos);
  f = mul(f, 1 / norm(f));
  // right = forward x up, with world up = +Y
  let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];
  r = mul(r, 1 / norm(r));
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const F = cam.height / 2 / Math.tan(toRad(cam.fovVDeg) / 2);
  const roll = toRad(cam.rollDeg || 0);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const camPt = (p) => {
    const d = sub(p, pos);
    return [d[0] * r[0] + d[1] * r[1] + d[2] * r[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * f[0] + d[1] * f[1] + d[2] * f[2]];
  };
  const hipMid = mul(add(pts[LM.L_HIP], pts[LM.R_HIP]), 0.5);
  const hipCam = camPt(hipMid);
  const lm = new Array(N_LANDMARKS);
  const world = new Array(N_LANDMARKS);
  const depths = pts.map((p) => camPt(p)[2]);
  const midDepth = hipCam[2];
  for (let i = 0; i < N_LANDMARKS; i++) {
    const c = camPt(pts[i]);
    let px = (F * c[0]) / c[2];
    let py = (-F * c[1]) / c[2];
    const rx = px * cr - py * sr;
    const ry = px * sr + py * cr;
    px = rx + cam.width / 2 + (noise.image ? rng.normal() * noise.image : 0);
    py = ry + cam.height / 2 + (noise.image ? rng.normal() * noise.image : 0);
    const far = depths[i] - midDepth > 0.06;
    lm[i] = {
      x: px / cam.width,
      y: py / cam.height,
      z: ((c[2] - hipCam[2]) * F) / hipCam[2] / cam.width,
      visibility: far ? 0.78 : 0.97,
    };
    world[i] = {
      x: c[0] - hipCam[0] + (noise.world ? rng.normal() * noise.world : 0),
      y: -(c[1] - hipCam[1]) + (noise.world ? rng.normal() * noise.world : 0),
      z: c[2] - hipCam[2] + (noise.world ? rng.normal() * noise.world * 2 : 0),
    };
  }
  return { lm, world };
}

/**
 * Ground truth for one shot, computed from the noiseless model at fine time steps.
 * Times are seconds from the start of the shot.
 */
function truthFor(p, tl) {
  const s = p.hand === 'left' ? -1 : 1;
  const I = s === 1
    ? { sh: LM.R_SHOULDER, el: LM.R_ELBOW, wr: LM.R_WRIST, hip: LM.R_HIP, kn: LM.R_KNEE, an: LM.R_ANKLE }
    : { sh: LM.L_SHOULDER, el: LM.L_ELBOW, wr: LM.L_WRIST, hip: LM.L_HIP, kn: LM.L_KNEE, an: LM.L_ANKLE };
  const ang = (q, a, b, c) => angle3(q[a][0], q[a][1], q[a][2], q[b][0], q[b][1], q[b][2], q[c][0], q[c][1], q[c][2]);
  const at = (t) => pose(p, tl, t);
  const dip = at(tl.tDip);
  const set = at(tl.tExt0);
  const full = at(tl.tExt1);
  const H = p.heightM;
  const eyeY = (q) => (q[LM.L_EYE][1] + q[LM.R_EYE][1]) / 2;
  const armVec = sub(full[I.wr], full[I.sh]);
  return {
    hand: p.hand,
    tDip: tl.tDip,
    tSet: tl.tExt0,
    tSetArrive: tl.tSetArrive,
    tRelease: tl.tRelease,
    tFullExtension: tl.tExt1,
    tTakeoff: tl.tTakeoff,
    tApex: tl.tApex,
    tLanding: tl.tLanding,
    tFollowEnd: tl.tFollowEnd,
    jump: tl.flight > 0,
    flight: tl.flight,
    jumpHeightM: (G * tl.flight * tl.flight) / 8,
    kneeAngleDip: ang(dip, I.hip, I.kn, I.an),
    setElbow: ang(set, I.sh, I.el, I.wr),
    maxElbow: ang(full, I.sh, I.el, I.wr),
    setHeightPct: ((set[I.wr][1] - eyeY(set)) / H) * 100,
    reachHeightPct: ((full[I.wr][1] - eyeY(full)) / H) * 100,
    armElevation: toDeg(Math.atan2(armVec[1], Math.hypot(armVec[0], armVec[2]))),
    trunkLeanRelease: p.trunkLeanRelease,
    releaseVsApex: tl.flight > 0 ? p.releaseVsApex : NaN,
    followHold: p.followHold,
    setPause: Math.max(0, p.setPause),
    driftForwardPct: tl.flight > 0 ? (p.driftForward / H) * 100 : 0,
    driftLateralPct: tl.flight > 0 ? (p.driftLateral / H) * 100 : 0,
    tempo: tl.tRelease - tl.tDip,
  };
}

/**
 * Generate a clip containing one or more shots.
 *
 * @param {object[]} shots  per-shot parameter overrides (merged over DEFAULT_SHOOTER)
 * @param {object} [camera] camera overrides (merged over DEFAULT_CAMERA)
 * @param {object} [opts]
 * @param {number} [opts.fps=30]
 * @param {number} [opts.seed=1]
 * @param {number} [opts.noiseImage=0]  landmark jitter, as a fraction of body height in the image
 * @param {number} [opts.noiseWorld=0]  world-landmark jitter in metres
 * @param {number} [opts.rest=1.0]      extra standing time between shots, seconds
 * @returns {{ fps:number, width:number, height:number, duration:number, frames:object[], truth:object[] }}
 */
export function synthClip(shots, camera = {}, opts = {}) {
  const cam = { ...DEFAULT_CAMERA, ...camera };
  const fps = opts.fps ?? 30;
  const rng = makeRng(opts.seed ?? 1);
  const rest = opts.rest ?? 1.0;
  const params = shots.map((sh) => ({ ...DEFAULT_SHOOTER, ...sh }));
  const timelines = params.map(shotTimeline);
  const starts = [];
  let total = 0;
  for (const tl of timelines) {
    starts.push(total);
    total += tl.tEnd + rest;
  }
  const bodyPx = ((cam.height / 2 / Math.tan(toRad(cam.fovVDeg) / 2)) * params[0].heightM) / cam.distM;
  const noise = { image: (opts.noiseImage ?? 0) * bodyPx, world: opts.noiseWorld ?? 0 };

  const frames = [];
  const count = Math.floor(total * fps);
  for (let k = 0; k < count; k++) {
    const t = k / fps;
    let i = 0;
    while (i < starts.length - 1 && t >= starts[i + 1]) i++;
    const p = params[i];
    const tl = timelines[i];
    const local = t - starts[i];
    const pts = pose(p, tl, Math.min(local, tl.tEnd));
    // After the shot, walk back to the starting spot during the rest period.
    if (local > tl.tEnd && tl.flight > 0) {
      const u = minJerk((local - tl.tEnd) / Math.max(0.2, rest));
      const s = p.hand === 'left' ? -1 : 1;
      for (const q of pts) {
        q[0] -= p.driftForward * u;
        q[2] -= s * p.driftLateral * u;
      }
    }
    const { lm, world } = project(pts, cam, rng, noise);
    frames.push({ t, lm, world });
  }
  const truth = params.map((p, i) => {
    const tr = truthFor(p, timelines[i]);
    const shifted = { ...tr };
    for (const key of ['tDip', 'tSet', 'tSetArrive', 'tRelease', 'tFullExtension', 'tTakeoff', 'tApex', 'tLanding', 'tFollowEnd']) {
      shifted[key] = tr[key] + starts[i];
    }
    return shifted;
  });
  return { fps, width: cam.width, height: cam.height, duration: total, frames, truth };
}

/**
 * Convenience: a clip of `n` shots built from one base shooter with normally
 * distributed shot-to-shot variation. `spread` maps parameter names to standard
 * deviations (same units as the parameter).
 */
export function synthSession(base, n, spread = {}, camera = {}, opts = {}) {
  const rng = makeRng((opts.seed ?? 1) * 7919 + 13);
  const shots = [];
  for (let i = 0; i < n; i++) {
    const sh = { ...base };
    for (const [key, sigma] of Object.entries(spread)) {
      const b = base[key] ?? DEFAULT_SHOOTER[key];
      sh[key] = b + rng.normal() * sigma;
    }
    shots.push(sh);
  }
  return synthClip(shots, camera, opts);
}
