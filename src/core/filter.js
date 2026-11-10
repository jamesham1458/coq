// Signal conditioning for landmark time series: gap filling, zero-phase low-pass
// filtering, differentiation and resampling. All series are assumed uniformly sampled.

/**
 * Fill invalid samples by linear interpolation between the nearest valid neighbours.
 * Gaps longer than `maxGap` samples are still filled (so downstream math never sees
 * NaN) but are reported in the returned `bad` mask. Leading/trailing gaps hold the
 * nearest valid value.
 *
 * @param {ArrayLike<number>} values
 * @param {ArrayLike<number|boolean>} valid truthy where the sample can be trusted
 * @param {number} maxGap longest gap, in samples, that counts as safely bridged
 * @returns {{ out: Float64Array, bad: Uint8Array }}
 */
export function fillGaps(values, valid, maxGap) {
  const n = values.length;
  const out = new Float64Array(n);
  const bad = new Uint8Array(n);
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (valid[i] && Number.isFinite(values[i])) {
      first = i;
      break;
    }
  }
  if (first < 0) {
    bad.fill(1);
    return { out, bad };
  }
  for (let i = 0; i < first; i++) {
    out[i] = values[first];
    bad[i] = 1;
  }
  let prev = first;
  out[first] = values[first];
  for (let i = first + 1; i < n; i++) {
    if (valid[i] && Number.isFinite(values[i])) {
      out[i] = values[i];
      const gap = i - prev - 1;
      if (gap > 0) {
        for (let k = prev + 1; k < i; k++) {
          const u = (k - prev) / (i - prev);
          out[k] = values[prev] + (values[i] - values[prev]) * u;
          if (gap > maxGap) bad[k] = 1;
        }
      }
      prev = i;
    }
  }
  for (let i = prev + 1; i < n; i++) {
    out[i] = values[prev];
    bad[i] = 1;
  }
  return { out, bad };
}

/**
 * Second-order Butterworth low-pass coefficients. `passes` is how many times the
 * filter will be applied (2 for forward-backward); the cutoff is pre-corrected so
 * the combined response has its -3 dB point at `cutoffHz` (Winter's correction).
 */
export function butterworth(cutoffHz, sampleHz, passes = 2) {
  const corr = Math.pow(Math.pow(2, 1 / passes) - 1, 0.25);
  const fc = Math.min(cutoffHz / corr, sampleHz * 0.45);
  const k = Math.tan((Math.PI * fc) / sampleHz);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  return {
    b0,
    b1: 2 * b0,
    b2: b0,
    a1: 2 * (k * k - 1) * norm,
    a2: (1 - Math.SQRT2 * k + k * k) * norm,
  };
}

function biquad(x, c, out) {
  // Direct form I, initialised so a constant input produces a constant output.
  let x1 = x[0];
  let x2 = x[0];
  let y1 = x[0];
  let y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    out[i] = yi;
  }
  return out;
}

/**
 * Zero-phase low-pass: filter forward, then backward. The series is extended at
 * both ends by odd reflection so the ends are not pulled toward a start-up value.
 * Series too short to filter are returned unchanged (as a copy).
 */
export function lowpass(values, cutoffHz, sampleHz) {
  const n = values.length;
  const out = new Float64Array(n);
  if (n < 4 || !(cutoffHz > 0) || cutoffHz >= sampleHz * 0.45) {
    for (let i = 0; i < n; i++) out[i] = values[i];
    return out;
  }
  const pad = Math.min(n - 1, Math.max(6, Math.round((sampleHz / cutoffHz) * 2)));
  const m = n + 2 * pad;
  const ext = new Float64Array(m);
  for (let i = 0; i < pad; i++) ext[i] = 2 * values[0] - values[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = values[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * values[n - 1] - values[n - 2 - i];
  const c = butterworth(cutoffHz, sampleHz, 2);
  const fwd = biquad(ext, c, new Float64Array(m));
  fwd.reverse();
  const back = biquad(fwd, c, new Float64Array(m));
  back.reverse();
  for (let i = 0; i < n; i++) out[i] = back[pad + i];
  return out;
}

/** Central-difference derivative per second. One-sided at the ends. */
export function derivative(values, sampleHz) {
  const n = values.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  out[0] = (values[1] - values[0]) * sampleHz;
  out[n - 1] = (values[n - 1] - values[n - 2]) * sampleHz;
  for (let i = 1; i < n - 1; i++) out[i] = (values[i + 1] - values[i - 1]) * 0.5 * sampleHz;
  return out;
}

/**
 * Resample (times, values) onto a uniform grid starting at t0 with step dt.
 * `times` must be increasing. Samples outside the source range hold the end values.
 */
export function resample(times, values, t0, dt, count) {
  const out = new Float64Array(count);
  const n = times.length;
  if (!n) return out;
  let j = 0;
  for (let i = 0; i < count; i++) {
    const t = t0 + i * dt;
    while (j < n - 2 && times[j + 1] < t) j++;
    if (t <= times[0] || n === 1) out[i] = values[0];
    else if (t >= times[n - 1]) out[i] = values[n - 1];
    else {
      const span = times[j + 1] - times[j];
      const u = span > 1e-12 ? (t - times[j]) / span : 0;
      out[i] = values[j] + (values[j + 1] - values[j]) * u;
    }
  }
  return out;
}
