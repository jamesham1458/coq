// Charts: a range gauge for one measurement and a small trend line for progress.
// Marks follow the same rules throughout: thin tracks, 2px lines, 8px dots with a
// surface-coloured ring, solid hairlines, text in ink colours only, and every value
// also reachable without hovering (direct labels and the shot-by-shot table).

import { h, s } from './dom.js';
import { formatValue, formatRange } from '../core/format.js';

let tipEl = null;

function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'status', hidden: true });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Show the shared tooltip near a viewport point. The value leads, the label follows. */
export function showTip(clientX, clientY, value, label) {
  const el = tip();
  el.textContent = '';
  el.appendChild(h('b', null, value));
  if (label) el.appendChild(h('div', null, label));
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const x = Math.min(Math.max(8, clientX - r.width / 2), window.innerWidth - r.width - 8);
  const y = clientY - r.height - 12 < 8 ? clientY + 16 : clientY - r.height - 12;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

function domainFor(spec, values) {
  const pts = values.filter(Number.isFinite);
  const ends = [];
  if (spec.ok) for (const v of spec.ok) if (Number.isFinite(v)) ends.push(v);
  if (spec.ideal) for (const v of spec.ideal) if (Number.isFinite(v)) ends.push(v);
  let lo = Math.min(...ends, ...pts);
  let hi = Math.max(...ends, ...pts);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  // Open-ended ranges get room beyond their one finite end so the band is visible.
  const span = hi - lo;
  if (spec.ideal && !Number.isFinite(spec.ideal[1])) hi += span * 0.35;
  if (spec.ideal && !Number.isFinite(spec.ideal[0])) lo -= span * 0.35;
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/**
 * Range gauge for one measurement.
 * @param {object} spec    metric spec (ideal, ok, id)
 * @param {object} m       assessed metric (mean, values, made)
 * @param {{ showShots?: boolean }} [opts]
 */
export function gauge(spec, m, opts = {}) {
  const W = 320;
  const H = 46;
  const x0 = 6;
  const x1 = W - 6;
  const trackY = 22;
  const trackH = 8;
  const mid = trackY + trackH / 2;
  const showShots = opts.showShots !== false && m.values.length > 1;
  const [lo, hi] = domainFor(spec, showShots ? [...m.values, m.mean] : [m.mean]);
  const sx = (v) => x0 + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (x1 - x0);
  const band = (range, fill) => {
    const a = Number.isFinite(range[0]) ? sx(range[0]) : x0;
    const b = Number.isFinite(range[1]) ? sx(range[1]) : x1;
    return s('rect', { x: a, y: trackY, width: Math.max(0, b - a), height: trackH, rx: 4, fill });
  };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${spec.label}: ${formatValue(spec.id, m.mean)}${spec.ideal ? `, target ${formatRange(spec.id, spec.ideal)}` : ''}` });
  svg.appendChild(s('rect', { x: x0, y: trackY, width: x1 - x0, height: trackH, rx: 4, fill: 'var(--surface-2)' }));
  if (spec.ok) svg.appendChild(band(spec.ok, 'var(--zone-ok)'));
  if (spec.ideal) {
    svg.appendChild(band(spec.ideal, 'var(--zone-ideal)'));
    // Label the ends of the target band. If they would collide, one centred label carries both.
    const a = spec.ideal[0];
    const b = spec.ideal[1];
    const fa = Number.isFinite(a);
    const fb = Number.isFinite(b);
    if (fa && fb && sx(b) - sx(a) < 44) {
      svg.appendChild(s('text', { x: (sx(a) + sx(b)) / 2, y: H - 3, 'text-anchor': 'middle' }, formatRange(spec.id, spec.ideal)));
    } else {
      if (fa) svg.appendChild(s('text', { x: sx(a), y: H - 3, 'text-anchor': sx(a) < x0 + 14 ? 'start' : 'middle' }, formatValue(spec.id, a)));
      if (fb) svg.appendChild(s('text', { x: sx(b), y: H - 3, 'text-anchor': sx(b) > x1 - 14 ? 'end' : 'middle' }, formatValue(spec.id, b)));
    }
  }
  if (showShots) {
    m.values.forEach((v, k) => {
      const cx = sx(v);
      const cy = mid + ((k % 3) - 1) * 2.2;
      const made = m.made ? m.made[k] : null;
      const label = `Shot ${k + 1}${made === 1 ? ' (make)' : made === 0 ? ' (miss)' : ''}`;
      const show = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        showTip(r.left + r.width / 2, r.top, formatValue(spec.id, v), label);
      };
      const hit = s('circle', {
        class: 'hit',
        cx,
        cy,
        r: 12,
        fill: 'transparent',
        tabindex: 0,
        role: 'img',
        'aria-label': `${label}: ${formatValue(spec.id, v)}`,
        onPointerenter: show,
        onPointerleave: hideTip,
        onFocus: show,
        onBlur: hideTip,
      });
      svg.appendChild(hit);
      svg.appendChild(s('circle', {
        class: 'ring',
        cx,
        cy,
        r: 4,
        fill: made === 0 ? 'var(--series-2)' : 'var(--series-1)',
        stroke: 'var(--surface)',
        'stroke-width': 2,
        'pointer-events': 'none',
      }));
    });
  }
  const mx = sx(m.mean);
  svg.appendChild(s('path', { d: `M${mx} ${trackY - 5}V${trackY + trackH + 5}`, stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  svg.appendChild(s('path', { d: `M${mx - 4} ${trackY - 9}h8l-4 5z`, fill: 'var(--ink)' }));
  svg.appendChild(s('text', {
    class: 'mean-label',
    x: Math.min(Math.max(mx, x0 + 18), x1 - 18),
    y: 9,
    'text-anchor': 'middle',
  }, `${showShots ? 'avg ' : ''}${formatValue(spec.id, m.mean)}`));
  return h('div', { class: 'gauge' }, svg);
}

/**
 * Trend line across sessions for one measurement or score.
 * @param {{ label: string, value: number, note?: string }[]} points  oldest first
 * @param {{ format: (v:number)=>string, ideal?: [number, number], title: string }} opts
 */
export function trend(points, opts) {
  const W = 300;
  const H = 104;
  const left = 8;
  const right = W - 44;
  const top = 12;
  const bottom = H - 22;
  const vals = points.map((p) => p.value).filter(Number.isFinite);
  const ends = [...vals];
  if (opts.ideal) for (const v of opts.ideal) if (Number.isFinite(v)) ends.push(v);
  let lo = Math.min(...ends);
  let hi = Math.max(...ends);
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const n = points.length;
  const px = (i) => (n === 1 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left));
  const py = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `${opts.title}: ${points.map((p) => `${p.label} ${opts.format(p.value)}`).join(', ')}`,
  });
  if (opts.ideal) {
    const a = Number.isFinite(opts.ideal[1]) ? py(opts.ideal[1]) : top;
    const b = Number.isFinite(opts.ideal[0]) ? py(opts.ideal[0]) : bottom;
    svg.appendChild(s('rect', { x: left, y: Math.min(a, b), width: right - left, height: Math.abs(b - a), fill: 'var(--zone-ideal)', opacity: 0.55, rx: 2 }));
  }
  svg.appendChild(s('path', { d: `M${left} ${bottom}H${right}`, stroke: 'var(--line-strong)', 'stroke-width': 1 }));
  const pts = points.map((p, i) => [px(i), py(p.value)]);
  if (n > 1) {
    svg.appendChild(s('path', {
      d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''),
      fill: 'none',
      stroke: 'var(--series-1)',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }
  const cross = s('path', { d: `M0 ${top}V${bottom}`, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden' });
  svg.appendChild(cross);
  pts.forEach(([x, y]) => {
    svg.appendChild(s('circle', { cx: x, cy: y, r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
  });
  // Label only the latest value; the axis ends carry the dates.
  const last = pts[n - 1];
  svg.appendChild(s('text', { class: 'end-label', x: last[0] + 8, y: last[1] + 4 }, opts.format(points[n - 1].value)));
  svg.appendChild(s('text', { x: left, y: H - 6 }, points[0].label));
  if (n > 1) svg.appendChild(s('text', { x: right, y: H - 6, 'text-anchor': 'end' }, points[n - 1].label));

  // One hover layer: the pointer only has to be nearest to a session, never on the line.
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(pts[i][0] - x) < Math.abs(pts[best][0] - x)) best = i;
    return best;
  };
  const show = (i) => {
    const box = svg.getBoundingClientRect();
    cross.setAttribute('d', `M${pts[i][0]} ${top}V${bottom}`);
    cross.setAttribute('visibility', 'visible');
    showTip(box.left + (pts[i][0] / W) * box.width, box.top + (pts[i][1] / H) * box.height, opts.format(points[i].value), [points[i].label, points[i].note].filter(Boolean).join(' · '));
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip();
  };
  let focusIndex = n - 1;
  const hit = s('rect', {
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill: 'transparent',
    tabindex: 0,
    'aria-label': `${opts.title}. Use left and right arrow keys to step through sessions.`,
    onPointermove: (e) => show(nearest(e.clientX)),
    onPointerleave: hide,
    onFocus: () => show(focusIndex),
    onBlur: hide,
    onKeydown: (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        focusIndex = Math.min(n - 1, Math.max(0, focusIndex + (e.key === 'ArrowRight' ? 1 : -1)));
        show(focusIndex);
        e.preventDefault();
      }
    },
  });
  svg.appendChild(hit);
  return h('div', { class: 'trend' }, svg);
}
