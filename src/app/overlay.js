// Marked-up still frames: the video frame with the tracked skeleton drawn over it
// and the one measurement that frame is evidence for.

import { h, s } from './dom.js';
import { LM, SKELETON, sideOf } from '../core/landmarks.js';
import { formatValue } from '../core/format.js';

export const STILL_NAMES = {
  dip: 'Dip',
  set: 'Set point',
  release: 'Release (estimated)',
  finish: 'Full extension',
  landing: 'Landing',
};

const INK = '#ffffff';
const SHADE = 'rgba(15, 21, 19, 0.55)';
const TELE = '#ffd23f';
const TELE_2 = '#7fe7ea';

function arcPath(bx, by, ax, ay, cx, cy, r) {
  const a1 = Math.atan2(ay - by, ax - bx);
  const a2 = Math.atan2(cy - by, cx - bx);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const x1 = bx + r * Math.cos(a1);
  const y1 = by + r * Math.sin(a1);
  const x2 = bx + r * Math.cos(a1 + d);
  const y2 = by + r * Math.sin(a1 + d);
  const midA = a1 + d / 2;
  return {
    d: `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    lx: bx + (r + 46) * Math.cos(midA),
    ly: by + (r + 46) * Math.sin(midA),
  };
}

/**
 * @param {object} args
 * @param {string} args.id            dip | set | release | finish | landing
 * @param {object} args.still         { url, pose } where pose is 33 [x, y] pairs in 0-1 image coordinates
 * @param {object} args.shot          the shot this frame belongs to (metrics, hand, view)
 * @param {number} args.aspect        frame width / height
 * @param {object} [args.plant]       the dip still of the same shot, used to mark the take-off spot
 * @param {string} [args.note]        extra caption text
 */
export function stillFigure({ id, still, shot, aspect, plant, note }) {
  const VW = 1000;
  const VH = 1000 / aspect;
  const P = still.pose.map(([x, y]) => [x * VW, y * VH]);
  const S = sideOf(shot.hand);
  const view = shot.view;
  const side = view === 'side';
  const frontal = view === 'front' || view === 'back';
  const m = shot.metrics;
  const val = (key) => (m[key] ? formatValue(key, m[key].value) : null);
  const svg = s('svg', { viewBox: `0 0 ${VW} ${VH.toFixed(1)}`, 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  const line = (a, b, color, width) => s('path', { d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', fill: 'none' });
  const mid = (a, b) => [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2];

  // Which bones this frame is about.
  const hot = new Set();
  const mark = (a, b) => hot.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  const nearLeg = sideOf(side && shot.nearSide ? shot.nearSide : shot.hand);
  if (id === 'dip') {
    mark(nearLeg.hip, nearLeg.knee);
    mark(nearLeg.knee, nearLeg.ankle);
  } else if (id === 'set') {
    mark(S.elbow, S.wrist);
    if (!frontal) mark(S.shoulder, S.elbow);
  } else if (id === 'finish') {
    mark(S.shoulder, S.elbow);
    mark(S.elbow, S.wrist);
  }

  for (const [a, b] of SKELETON) svg.appendChild(line(P[a], P[b], SHADE, 11));
  for (const [a, b] of SKELETON) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    svg.appendChild(line(P[a], P[b], hot.has(key) ? TELE : INK, hot.has(key) ? 7 : 4.5));
  }
  for (const j of [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE]) {
    svg.appendChild(s('circle', { cx: P[j][0].toFixed(1), cy: P[j][1].toFixed(1), r: 7, fill: INK, stroke: SHADE, 'stroke-width': 3 }));
  }

  const label = (x, y, text) => {
    const tx = Math.min(Math.max(x, 70), VW - 70);
    const ty = Math.min(Math.max(y, 50), VH - 20);
    svg.appendChild(s('text', {
      x: tx.toFixed(1),
      y: ty.toFixed(1),
      'text-anchor': 'middle',
      'font-size': 50,
      'font-weight': 700,
      'font-family': '"Barlow Condensed", "Arial Narrow", Arial, sans-serif',
      fill: TELE,
      stroke: 'rgba(15, 21, 19, 0.9)',
      'stroke-width': 10,
      'paint-order': 'stroke',
      'stroke-linejoin': 'round',
    }, text));
  };
  const angleAt = (a, b, c, text) => {
    const arc = arcPath(P[b][0], P[b][1], P[a][0], P[a][1], P[c][0], P[c][1], 64);
    svg.appendChild(s('path', { d: arc.d, stroke: TELE, 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }));
    if (text) label(arc.lx, arc.ly + 16, text);
  };
  const reference = (from, to) => svg.appendChild(line(from, to, TELE_2, 4));

  const parts = [];
  if (id === 'dip') {
    if (frontal) {
      svg.appendChild(line(P[LM.L_ANKLE], P[LM.R_ANKLE], TELE, 6));
      svg.appendChild(line(P[LM.L_KNEE], P[LM.R_KNEE], TELE_2, 5));
      if (val('stanceWidth')) parts.push(`base ${val('stanceWidth')} shoulder width`);
      if (val('kneeTrack')) parts.push(`knees ${val('kneeTrack')} of ankle spacing`);
    } else {
      angleAt(nearLeg.hip, nearLeg.knee, nearLeg.ankle, val('kneeBend'));
      if (val('kneeBend')) parts.push(`knee ${val('kneeBend')}`);
    }
  } else if (id === 'set') {
    if (frontal) {
      const e = P[S.elbow];
      reference(e, [e[0], e[1] - 0.2 * VH]);
      if (val('elbowFlare')) {
        label(e[0], e[1] + 70, val('elbowFlare'));
        parts.push(`forearm ${val('elbowFlare')} off vertical`);
      }
    } else {
      angleAt(S.shoulder, S.elbow, S.wrist, val('setElbow'));
      const eye = mid(LM.L_EYE, LM.R_EYE);
      reference([eye[0] - 150, eye[1]], [eye[0] + 150, eye[1]]);
      if (val('setElbow')) parts.push(`elbow ${val('setElbow')}`);
      if (val('setHeight')) parts.push(`wrist ${val('setHeight')} of height vs eye line`);
    }
  } else if (id === 'release') {
    const hip = mid(LM.L_HIP, LM.R_HIP);
    const sh = mid(LM.L_SHOULDER, LM.R_SHOULDER);
    const len = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    reference(hip, [hip[0], hip[1] - len * 1.15]);
    svg.appendChild(line(hip, sh, TELE, 7));
    const key = frontal ? 'sideLean' : 'trunkLean';
    if (val(key)) {
      label(sh[0], sh[1] - 40, val(key));
      parts.push(`lean ${val(key)}`);
    }
  } else if (id === 'finish') {
    const sh = P[S.shoulder];
    const wr = P[S.wrist];
    if (side) {
      const dir = wr[0] >= sh[0] ? 1 : -1;
      const reach = Math.hypot(wr[0] - sh[0], wr[1] - sh[1]);
      reference(sh, [sh[0] + dir * reach * 0.9, sh[1]]);
      const arc = arcPath(sh[0], sh[1], sh[0] + dir * 100, sh[1], wr[0], wr[1], 90);
      svg.appendChild(s('path', { d: arc.d, stroke: TELE, 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }));
      if (val('armAngle')) {
        label(arc.lx + dir * 20, arc.ly, val('armAngle'));
        parts.push(`arm ${val('armAngle')} above horizontal`);
      }
    } else if (frontal) {
      reference(sh, [sh[0], sh[1] - 0.3 * VH]);
    }
    if (val('armExtension')) parts.push(`elbow ${val('armExtension')}`);
  } else if (id === 'landing') {
    const now = mid(LM.L_ANKLE, LM.R_ANKLE);
    if (plant && plant.pose) {
      const was = [((plant.pose[LM.L_ANKLE][0] + plant.pose[LM.R_ANKLE][0]) / 2) * VW, ((plant.pose[LM.L_ANKLE][1] + plant.pose[LM.R_ANKLE][1]) / 2) * VH];
      const y = Math.max(now[1], was[1]) + 46;
      svg.appendChild(line([was[0], y - 26], [was[0], y + 26], TELE_2, 6));
      svg.appendChild(line([now[0], y - 26], [now[0], y + 26], TELE, 6));
      svg.appendChild(line([was[0], y], [now[0], y], TELE, 4));
    }
    const key = frontal ? 'driftSide' : 'driftForward';
    if (val(key)) parts.push(`${frontal ? 'sideways' : 'forward'} travel ${val(key)} of height`);
  }

  const caption = [STILL_NAMES[id], ...parts, note].filter(Boolean).join(' · ');
  return h(
    'figure',
    { class: 'still', style: { aspectRatio: `${aspect}` } },
    still.url ? h('img', { src: still.url, alt: `${STILL_NAMES[id]} frame with the tracked skeleton drawn over it`, loading: 'lazy', decoding: 'async' }) : null,
    svg,
    h('figcaption', null, caption),
  );
}

/** Placeholder shown where a frame is not available (history, example data). */
export function blankStill(text) {
  return h('div', { class: 'still blank' }, text);
}
