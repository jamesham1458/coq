// Small vector and angle helpers. Angles are in degrees unless a name says otherwise.

export const toDeg = (r) => (r * 180) / Math.PI;
export const toRad = (d) => (d * Math.PI) / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, u) => a + (b - a) * u;

/** Interior angle at B (degrees, 0-180) for 2D points. Returns NaN for a zero-length side. */
export function angle2(ax, ay, bx, by, cx, cy) {
  const ux = ax - bx;
  const uy = ay - by;
  const vx = cx - bx;
  const vy = cy - by;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu < 1e-9 || nv < 1e-9) return NaN;
  return toDeg(Math.acos(clamp((ux * vx + uy * vy) / (nu * nv), -1, 1)));
}

/** Interior angle at B (degrees, 0-180) for 3D points. */
export function angle3(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = ax - bx;
  const uy = ay - by;
  const uz = az - bz;
  const vx = cx - bx;
  const vy = cy - by;
  const vz = cz - bz;
  const nu = Math.hypot(ux, uy, uz);
  const nv = Math.hypot(vx, vy, vz);
  if (nu < 1e-9 || nv < 1e-9) return NaN;
  return toDeg(Math.acos(clamp((ux * vx + uy * vy + uz * vz) / (nu * nv), -1, 1)));
}

/**
 * Signed tilt of the vector (dx, dy) away from straight up, in image coordinates
 * (y grows downward). Positive when the vector leans toward +x.
 * A vector pointing straight up gives 0; pointing straight to +x gives 90.
 */
export function tiltFromUp(dx, dy) {
  return toDeg(Math.atan2(dx, -dy));
}

/**
 * Elevation of the vector (dx, dy) above the horizontal, in image coordinates.
 * `forward` is +1 or -1: the image direction that counts as "toward the target".
 * 0 = pointing level at the target, 90 = straight up, above 90 = tipped back past vertical.
 */
export function elevation2(dx, dy, forward) {
  return toDeg(Math.atan2(-dy, dx * forward));
}

/** Elevation above the horizontal plane for a 3D vector whose y axis points down. 0-90 up, negative down. */
export function elevation3(dx, dy, dz) {
  return toDeg(Math.atan2(-dy, Math.hypot(dx, dz)));
}

/** Value of a sampled series at fractional index `i` (linear interpolation, clamped to the ends). */
export function sampleAt(arr, i) {
  const n = arr.length;
  if (n === 0) return NaN;
  if (i <= 0) return arr[0];
  if (i >= n - 1) return arr[n - 1];
  const k = Math.floor(i);
  const u = i - k;
  return arr[k] + (arr[k + 1] - arr[k]) * u;
}

/**
 * Fractional index where `arr` first crosses `level` going upward, searching from
 * index `from` to `to` inclusive. Returns NaN when it never crosses. When the series
 * already sits at or above the level at `from`, returns `from`.
 */
export function firstUpCrossing(arr, level, from, to) {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(arr.length - 1, Math.ceil(to));
  if (!(a <= b)) return NaN;
  if (arr[a] >= level) return a;
  for (let i = a + 1; i <= b; i++) {
    if (arr[i] >= level) {
      const d = arr[i] - arr[i - 1];
      return d > 1e-12 ? i - 1 + (level - arr[i - 1]) / d : i;
    }
  }
  return NaN;
}

/** As firstUpCrossing, for the first downward crossing. */
export function firstDownCrossing(arr, level, from, to) {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(arr.length - 1, Math.ceil(to));
  if (!(a <= b)) return NaN;
  if (arr[a] <= level) return a;
  for (let i = a + 1; i <= b; i++) {
    if (arr[i] <= level) {
      const d = arr[i - 1] - arr[i];
      return d > 1e-12 ? i - 1 + (arr[i - 1] - level) / d : i;
    }
  }
  return NaN;
}

/** Index of the minimum of `arr` over [from, to] (inclusive, clamped). -1 when the range is empty. */
export function argMin(arr, from, to) {
  const a = Math.max(0, Math.ceil(from));
  const b = Math.min(arr.length - 1, Math.floor(to));
  let best = -1;
  let bv = Infinity;
  for (let i = a; i <= b; i++) {
    const v = arr[i];
    if (v < bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

/** Index of the maximum of `arr` over [from, to] (inclusive, clamped). -1 when the range is empty. */
export function argMax(arr, from, to) {
  const a = Math.max(0, Math.ceil(from));
  const b = Math.min(arr.length - 1, Math.floor(to));
  let best = -1;
  let bv = -Infinity;
  for (let i = a; i <= b; i++) {
    const v = arr[i];
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

/**
 * Refine the location of an extremum at integer index `i` with a parabola through
 * its two neighbours. Returns a fractional index within half a sample of `i`.
 */
export function refineExtremum(arr, i) {
  if (i <= 0 || i >= arr.length - 1) return i;
  const a = arr[i - 1];
  const b = arr[i];
  const c = arr[i + 1];
  const den = a - 2 * b + c;
  if (Math.abs(den) < 1e-12) return i;
  return i + clamp((0.5 * (a - c)) / den, -0.5, 0.5);
}
