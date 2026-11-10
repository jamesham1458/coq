// Turns the raw per-frame landmarks from the pose engine into a clean, uniformly
// sampled track: gaps bridged, jitter filtered, body scale and camera view worked out.

import { LM, N_LANDMARKS, sideOf } from './landmarks.js';
import { fillGaps, lowpass, resample, derivative } from './filter.js';
import { angle2, angle3 } from './geometry.js';
import { median, quantile } from './stats.js';

/** Low-pass cutoff for landmark positions. High enough to keep the release, low enough to drop jitter. */
export const POSITION_CUTOFF_HZ = 10;
/** Longest run of missing frames (seconds) that interpolation is trusted to bridge. */
export const MAX_GAP_S = 0.3;
/** Nose-to-ankle distance as a fraction of standing height (nose about 92.5%, ankle joint about 4%). */
export const NOSE_TO_ANKLE = 0.885;

/** View thresholds on (2D shoulder width / torso length). A square-on body is about 0.7. */
export const VIEW_SIDE_BELOW = 0.42;
export const VIEW_FRONT_ABOVE = 0.58;

/**
 * @typedef {Object} RawTrack
 * @property {number} width   pixel width of the analysed frames
 * @property {number} height  pixel height of the analysed frames
 * @property {{t:number, lm:({x:number,y:number,z:number,visibility?:number}[]|null), world:({x:number,y:number,z:number}[]|null)}[]} frames
 */

export class Track {
  /** @param {RawTrack} raw */
  constructor(raw) {
    const frames = raw.frames || [];
    this.W = raw.width;
    this.H = raw.height;
    this.cache = new Map();

    const nRaw = frames.length;
    const times = new Float64Array(nRaw);
    for (let i = 0; i < nRaw; i++) times[i] = frames[i].t;
    const steps = [];
    for (let i = 1; i < nRaw; i++) steps.push(times[i] - times[i - 1]);
    const dt = steps.length ? median(steps) : 1 / 30;
    this.dt = dt > 1e-6 ? dt : 1 / 30;
    this.fps = 1 / this.dt;
    const uniform = steps.every((s) => Math.abs(s - this.dt) < 0.2 * this.dt);
    this.t0 = nRaw ? times[0] : 0;
    this.n = uniform ? nRaw : Math.max(0, Math.floor((times[nRaw - 1] - this.t0) / this.dt) + 1);
    const n = this.n;
    this.t = new Float64Array(n);
    for (let i = 0; i < n; i++) this.t[i] = this.t0 + i * this.dt;

    const maxGap = Math.max(1, Math.round(MAX_GAP_S * this.fps));
    const cutoff = Math.min(POSITION_CUTOFF_HZ, this.fps * 0.33);
    const has = new Uint8Array(nRaw);
    let hasWorld = nRaw > 0;
    let detected = 0;
    for (let i = 0; i < nRaw; i++) {
      has[i] = frames[i].lm && frames[i].lm.length >= N_LANDMARKS ? 1 : 0;
      detected += has[i];
      if (has[i] && !(frames[i].world && frames[i].world.length >= N_LANDMARKS)) hasWorld = false;
    }
    if (!detected) hasWorld = false;
    this.detectedFraction = nRaw ? detected / nRaw : 0;
    this.hasWorld = hasWorld;

    /** frames where the pose had to be bridged across a gap longer than MAX_GAP_S */
    this.bad = new Uint8Array(n);
    this.px = new Array(N_LANDMARKS);
    this.py = new Array(N_LANDMARKS);
    this.wx = hasWorld ? new Array(N_LANDMARKS) : null;
    this.wy = hasWorld ? new Array(N_LANDMARKS) : null;
    this.wz = hasWorld ? new Array(N_LANDMARKS) : null;
    this.vis = new Array(N_LANDMARKS);

    const tmp = new Float64Array(nRaw);
    const condition = (pick, markBad) => {
      for (let i = 0; i < nRaw; i++) tmp[i] = has[i] ? pick(frames[i]) : NaN;
      const { out, bad } = fillGaps(tmp, has, maxGap);
      const uni = uniform ? out : resample(times, out, this.t0, this.dt, n);
      if (markBad) {
        const badUni = uniform ? bad : resample(times, Float64Array.from(bad), this.t0, this.dt, n);
        for (let i = 0; i < n; i++) if (badUni[i] > 0.5) this.bad[i] = 1;
      }
      return lowpass(uni, cutoff, this.fps);
    };
    for (let j = 0; j < N_LANDMARKS; j++) {
      this.px[j] = condition((f) => f.lm[j].x * this.W, j === 0);
      this.py[j] = condition((f) => f.lm[j].y * this.H, false);
      if (hasWorld) {
        this.wx[j] = condition((f) => f.world[j].x, false);
        this.wy[j] = condition((f) => f.world[j].y, false);
        this.wz[j] = condition((f) => f.world[j].z, false);
      }
      for (let i = 0; i < nRaw; i++) tmp[i] = has[i] ? (frames[i].lm[j].visibility ?? 1) : 0;
      const v = uniform ? Float64Array.from(tmp) : resample(times, tmp, this.t0, this.dt, n);
      this.vis[j] = v;
    }

    this.#measureScale();
    this.view = this.#classifyView();
  }

  // ---- Scale ----------------------------------------------------------------------

  #measureScale() {
    const n = this.n;
    const torso = [];
    const stand = [];
    const sw = [];
    for (let i = 0; i < n; i++) {
      if (this.bad[i]) continue;
      const sx = (this.px[LM.L_SHOULDER][i] + this.px[LM.R_SHOULDER][i]) / 2;
      const sy = (this.py[LM.L_SHOULDER][i] + this.py[LM.R_SHOULDER][i]) / 2;
      const hx = (this.px[LM.L_HIP][i] + this.px[LM.R_HIP][i]) / 2;
      const hy = (this.py[LM.L_HIP][i] + this.py[LM.R_HIP][i]) / 2;
      torso.push(Math.hypot(sx - hx, sy - hy));
      const ay = (this.py[LM.L_ANKLE][i] + this.py[LM.R_ANKLE][i]) / 2;
      stand.push(ay - this.py[LM.NOSE][i]);
      sw.push(Math.abs(this.px[LM.L_SHOULDER][i] - this.px[LM.R_SHOULDER][i]));
    }
    /** torso length in pixels (mid-shoulder to mid-hip) */
    this.torso = torso.length ? median(torso) : NaN;
    /** standing body height in pixels */
    this.bodyH = stand.length ? quantile(stand, 0.9) / NOSE_TO_ANKLE : NaN;
    /** apparent shoulder width in pixels (small in a side view) */
    this.shoulderW = sw.length ? median(sw) : NaN;
    if (this.hasWorld) {
      const sw3 = [];
      for (let i = 0; i < n; i += 2) {
        if (this.bad[i]) continue;
        sw3.push(Math.hypot(
          this.wx[LM.L_SHOULDER][i] - this.wx[LM.R_SHOULDER][i],
          this.wy[LM.L_SHOULDER][i] - this.wy[LM.R_SHOULDER][i],
          this.wz[LM.L_SHOULDER][i] - this.wz[LM.R_SHOULDER][i],
        ));
      }
      /** true shoulder width in metres, from the 3D landmarks */
      this.shoulderWm = sw3.length ? median(sw3) : NaN;
    } else {
      this.shoulderWm = NaN;
    }
  }

  // ---- Camera view ------------------------------------------------------------------

  #classifyView() {
    const n = this.n;
    const order = [];
    const face = [];
    for (let i = 0; i < n; i++) {
      if (this.bad[i]) continue;
      order.push(this.px[LM.L_SHOULDER][i] - this.px[LM.R_SHOULDER][i]);
      const toes = (this.px[LM.L_TOE][i] - this.px[LM.L_HEEL][i]) + (this.px[LM.R_TOE][i] - this.px[LM.R_HEEL][i]);
      const nose = this.px[LM.NOSE][i] - (this.px[LM.L_EAR][i] + this.px[LM.R_EAR][i]) / 2;
      face.push(toes + 2 * nose);
    }
    const ratio = this.shoulderW / this.torso;
    const lr = order.length ? median(order) : 0;
    const fv = face.length ? median(face) : 0;
    const facing = fv > 0 ? 1 : fv < 0 ? -1 : 0;
    let kind;
    if (!(ratio >= 0)) kind = 'unknown';
    else if (ratio < VIEW_SIDE_BELOW) kind = 'side';
    else if (ratio > VIEW_FRONT_ABOVE) kind = lr > 0 ? 'front' : 'back';
    else kind = 'diagonal';
    return {
      /** 'side' | 'front' | 'back' | 'diagonal' | 'unknown' */
      kind,
      /** +1 when the shooter faces image-right, -1 image-left (meaningful for side and diagonal views) */
      facing,
      /** which side of the body is nearer the camera in a side or diagonal view */
      nearSide: facing > 0 ? 'right' : facing < 0 ? 'left' : null,
      /** true when the shooter's chest is toward the camera (front or front-diagonal) */
      chestToCamera: lr > 0,
      ratio,
    };
  }

  // ---- Derived signals (cached) -------------------------------------------------------

  #sig(key, build) {
    let s = this.cache.get(key);
    if (!s) {
      s = build();
      this.cache.set(key, s);
    }
    return s;
  }

  joint2(a, b, c) {
    return this.#sig(`a2:${a}:${b}:${c}`, () => {
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) {
        out[i] = angle2(this.px[a][i], this.py[a][i], this.px[b][i], this.py[b][i], this.px[c][i], this.py[c][i]);
      }
      return out;
    });
  }

  joint3(a, b, c) {
    return this.#sig(`a3:${a}:${b}:${c}`, () => {
      const out = new Float64Array(this.n);
      if (!this.hasWorld) return out.fill(NaN);
      for (let i = 0; i < this.n; i++) {
        out[i] = angle3(
          this.wx[a][i], this.wy[a][i], this.wz[a][i],
          this.wx[b][i], this.wy[b][i], this.wz[b][i],
          this.wx[c][i], this.wy[c][i], this.wz[c][i],
        );
      }
      return out;
    });
  }

  /** True when joint angles should be read from the image plane (a side view) rather than 3D. */
  get planar() {
    return this.view.kind === 'side' || !this.hasWorld;
  }

  /**
   * Replace the camera-view classification (for example once the shots themselves
   * show which way the shooter is aiming, or when the user states the angle).
   * @param {{kind?:string, facing?:number}} patch
   */
  setView(patch) {
    const facing = patch.facing ?? this.view.facing;
    this.view = {
      ...this.view,
      ...patch,
      facing,
      nearSide: facing > 0 ? 'right' : facing < 0 ? 'left' : null,
    };
  }

  /** Elbow angle with extra smoothing, for finding moments rather than reading values. */
  elbowSmooth(side) {
    return this.#sig(`elS:${side}:${this.planar ? 2 : 3}`, () => {
      const el = this.elbow(side);
      return this.planar ? el : lowpass(el, Math.min(7, this.fps * 0.3), this.fps);
    });
  }

  /** Elbow angle series (degrees, 180 = straight) for 'left' or 'right'. */
  elbow(side) {
    const s = sideOf(side);
    return this.planar ? this.joint2(s.shoulder, s.elbow, s.wrist) : this.joint3(s.shoulder, s.elbow, s.wrist);
  }

  /** Knee angle series (degrees, 180 = straight). */
  knee(side) {
    const s = sideOf(side);
    return this.planar ? this.joint2(s.hip, s.knee, s.ankle) : this.joint3(s.hip, s.knee, s.ankle);
  }

  /** Mean of both knee angles. */
  knees() {
    return this.#sig(`knees:${this.planar ? 2 : 3}`, () => {
      const l = this.knee('left');
      const r = this.knee('right');
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = (l[i] + r[i]) / 2;
      return out;
    });
  }

  /** Mid-point series between two landmarks, as { x, y } pixel arrays. */
  mid(a, b) {
    return this.#sig(`mid:${a}:${b}`, () => {
      const x = new Float64Array(this.n);
      const y = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) {
        x[i] = (this.px[a][i] + this.px[b][i]) / 2;
        y[i] = (this.py[a][i] + this.py[b][i]) / 2;
      }
      return { x, y };
    });
  }

  /** Height of the eye line (pixels, image y). */
  eyeY() {
    return this.mid(LM.L_EYE, LM.R_EYE).y;
  }

  /** Wrist height above the same-side shoulder, in torso lengths (positive = above). */
  wristUp(side) {
    const s = sideOf(side);
    return this.#sig(`wristUp:${side}`, () => {
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = (this.py[s.shoulder][i] - this.py[s.wrist][i]) / this.torso;
      return out;
    });
  }

  /** Wrist height above the eye line, as a percentage of body height (positive = above). */
  wristAboveEyes(side) {
    const s = sideOf(side);
    return this.#sig(`wristEye:${side}`, () => {
      const eye = this.eyeY();
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = ((eye[i] - this.py[s.wrist][i]) / this.bodyH) * 100;
      return out;
    });
  }

  /** Speed of the wrist relative to its shoulder, in torso lengths per second. */
  armSpeed(side) {
    const s = sideOf(side);
    return this.#sig(`armSpeed:${side}`, () => {
      const rx = new Float64Array(this.n);
      const ry = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) {
        rx[i] = this.px[s.wrist][i] - this.px[s.shoulder][i];
        ry[i] = this.py[s.wrist][i] - this.py[s.shoulder][i];
      }
      const vx = derivative(rx, this.fps);
      const vy = derivative(ry, this.fps);
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = Math.hypot(vx[i], vy[i]) / this.torso;
      return out;
    });
  }

  /** Lowest point of a foot (larger of heel and toe y), pixels. */
  footLow(side) {
    const s = sideOf(side);
    return this.#sig(`footLow:${side}`, () => {
      const out = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) out[i] = Math.max(this.py[s.heel][i], this.py[s.toe][i]);
      return out;
    });
  }

  /** Time derivative of a cached or ad-hoc series, lightly smoothed. */
  rate(key, series) {
    return this.#sig(`rate:${key}`, () => lowpass(derivative(series, this.fps), Math.min(8, this.fps * 0.3), this.fps));
  }

  /** Seconds for a (fractional) frame index. */
  timeAt(i) {
    return this.t0 + i * this.dt;
  }

  /** Fractional frame index for a time in seconds. */
  indexAt(t) {
    return (t - this.t0) / this.dt;
  }
}

/** Build a Track from the pose engine's raw output. */
export function prepareTrack(raw) {
  return new Track(raw);
}
