// Turning measurement values into text.

import { METRIC_BY_ID } from './specs.js';

const MINUS = '−';

function num(value, digits) {
  if (!Number.isFinite(value)) return '–';
  const s = Math.abs(value).toFixed(digits);
  // Avoid "-0".
  const zero = Number(s) === 0;
  return (value < 0 && !zero ? MINUS : '') + s;
}

/** A value with its unit, for tables and gauges: "118°", "0.52 s", "6.2%". */
export function formatValue(id, value) {
  const spec = METRIC_BY_ID[id];
  if (!spec || !Number.isFinite(value)) return '–';
  const d = spec.digits;
  switch (spec.unit) {
    case 'deg':
      return `${num(value, d)}°`;
    case 'pct':
      return `${num(value, d)}%`;
    case 'pctOf':
      return `${num(value, d)}%`;
    case 'ms':
      return `${num(value, d)} ms`;
    case 's':
      return `${num(value, d)} s`;
    case 'x':
      return `${num(value, d)}×`;
    case 'cm':
      return `${num(value, d)} cm`;
    default:
      return num(value, d);
  }
}

/** A spread (standard deviation) with its unit: "±4°". */
export function formatSpread(id, value) {
  const spec = METRIC_BY_ID[id];
  if (!spec || !Number.isFinite(value)) return '–';
  const d = spec.unit === 'deg' || spec.unit === 'ms' || spec.unit === 'cm' || spec.unit === 'pctOf' ? Math.max(spec.digits, value < 10 ? 1 : 0) : spec.digits + (spec.digits < 2 ? 1 : 0);
  const unit = { deg: '°', pct: '%', pctOf: '%', ms: ' ms', s: ' s', x: '×', cm: ' cm', ratio: '' }[spec.unit] ?? '';
  return `±${Math.abs(value).toFixed(d)}${unit}`;
}

/** The target range as text: "100–132°", "at least 0.50 s", "up to 35%". */
export function formatRange(id, range) {
  const spec = METRIC_BY_ID[id];
  if (!spec || !range) return '';
  const [a, b] = range;
  const one = (v) => formatValue(id, v);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return '';
  if (!Number.isFinite(b)) return `at least ${one(a)}`;
  if (!Number.isFinite(a)) return `up to ${one(b)}`;
  // Share the unit: "100–132°" rather than "100°–132°".
  const unit = one(b).replace(/^[−0-9.,]+/, '');
  const bare = (v) => num(v, spec.digits);
  return `${bare(a)}–${bare(b)}${unit}`;
}

/**
 * A length given as a percentage of body height, in everyday units when the
 * shooter's height is known: "about 11 cm (4 in)".
 */
export function lengthFromPct(pct, heightCm) {
  if (!Number.isFinite(pct) || !(heightCm > 0)) return '';
  const cm = (Math.abs(pct) / 100) * heightCm;
  const inches = cm / 2.54;
  return `about ${cm < 10 ? cm.toFixed(1) : Math.round(cm)} cm (${inches < 10 ? inches.toFixed(1) : Math.round(inches)} in)`;
}

/** Release timing in words: "40 ms before the top of your jump". */
export function timingWords(ms, jump = true) {
  if (!Number.isFinite(ms)) return '';
  const top = jump ? 'the top of your jump' : 'the top of your rise';
  const r = Math.round(Math.abs(ms) / 10) * 10;
  if (r < 15) return `right at ${top}`;
  return ms < 0 ? `${r} ms before ${top}` : `${r} ms after ${top}`;
}

export function plural(n, word, pluralWord) {
  return `${n} ${n === 1 ? word : pluralWord || `${word}s`}`;
}

export function titleCase(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

export function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatScore(v) {
  return Number.isFinite(v) ? String(Math.round(v)) : '–';
}
