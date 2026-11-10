// Descriptive statistics for small samples of shots.

export function finite(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function mean(values) {
  const v = finite(values);
  if (!v.length) return NaN;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** Sample standard deviation (n - 1 in the denominator). NaN with fewer than two values. */
export function sd(values) {
  const v = finite(values);
  if (v.length < 2) return NaN;
  const m = mean(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (v.length - 1));
}

export function median(values) {
  const v = finite(values).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values, q) {
  const v = finite(values).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/**
 * Factors that bound the true standard deviation given a sample SD from n values:
 * true SD lies in [sd * lo, sd * hi] with about 90% confidence, assuming roughly
 * normal data. Built from chi-square quantiles; tabulated because n is always small.
 */
const SD_BOUNDS_90 = {
  2: [0.51, 15.9], 3: [0.58, 4.42], 4: [0.62, 2.92], 5: [0.65, 2.37], 6: [0.67, 2.09],
  7: [0.69, 1.92], 8: [0.71, 1.8], 9: [0.72, 1.71], 10: [0.73, 1.65], 12: [0.75, 1.55],
  15: [0.77, 1.46], 20: [0.79, 1.37], 30: [0.83, 1.28],
};

export function sdBounds(n) {
  if (!(n >= 2)) return [NaN, NaN];
  const keys = Object.keys(SD_BOUNDS_90).map(Number);
  let pick = keys[0];
  for (const k of keys) if (k <= n) pick = k;
  return SD_BOUNDS_90[pick];
}

/** Summary used for every metric: n, mean, SD, min, max, median. */
export function summarize(values) {
  const v = finite(values);
  if (!v.length) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, median: NaN };
  return {
    n: v.length,
    mean: mean(v),
    sd: sd(v),
    min: Math.min(...v),
    max: Math.max(...v),
    median: median(v),
  };
}
