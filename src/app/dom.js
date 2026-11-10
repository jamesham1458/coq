// Tiny DOM helpers. All text goes in through textContent, never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs, children) {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Create an HTML element: h('div', { class: 'x' }, child, 'text', [more]). */
export function h(tag, attrs, ...children) {
  return apply(document.createElement(tag), attrs, children);
}

/** Create an SVG element. */
export function s(tag, attrs, ...children) {
  return apply(document.createElementNS(SVG_NS, tag), attrs, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const ICONS = {
  check: 'M3.5 8.5l3 3 6-7',
  warn: 'M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.3',
  cross: 'M4 4l8 8M12 4l-8 8',
  dot: 'M8 8h.01',
  info: 'M8 7v4M8 4.8v.2',
  chevron: 'M4 6l4 4 4-4',
  upload: 'M8 11V3M4.5 6L8 2.5 11.5 6M3 13h10',
  back: 'M9.5 3.5L5 8l4.5 4.5',
  plus: 'M8 3v10M3 8h10',
  stop: 'M4.5 4.5h7v7h-7z',
};

/** A 16px line icon. Decorative by default; pass a label to make it meaningful. */
export function icon(name, { size = 16, label } = {}) {
  const el = s('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': name === 'dot' ? 5 : 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    role: label ? 'img' : null,
    'aria-label': label || null,
    'aria-hidden': label ? null : 'true',
  });
  el.appendChild(s('path', { d: ICONS[name] || ICONS.dot }));
  if (name === 'info') el.appendChild(s('circle', { cx: 8, cy: 8, r: 6.2 }));
  return el;
}

const STATUS = {
  good: { icon: 'check', label: 'Sound' },
  watch: { icon: 'warn', label: 'Watch' },
  fix: { icon: 'cross', label: 'Fix' },
  info: { icon: 'dot', label: 'Style' },
  tight: { icon: 'check', label: 'Consistent' },
  moderate: { icon: 'warn', label: 'Some variation' },
  loose: { icon: 'cross', label: 'Inconsistent' },
};

const STATUS_CLASS = { good: 'good', watch: 'watch', fix: 'fix', info: 'info', tight: 'good', moderate: 'watch', loose: 'fix' };

/** Status chip: an icon and a word, so colour never carries the meaning alone. */
export function chip(status, text) {
  const meta = STATUS[status] || STATUS.info;
  return h('span', { class: `chip ${STATUS_CLASS[status] || 'info'}` }, icon(meta.icon, { size: 12 }), text || meta.label);
}

export function statusLabel(status) {
  return (STATUS[status] || STATUS.info).label;
}

/** A labelled form field. */
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

/** Segmented radio control. `options` is [[value, label], ...]. */
export function segmented(name, options, value, onChange) {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup' },
    options.map(([val, label]) =>
      h(
        'label',
        null,
        h('input', {
          type: 'radio',
          name,
          id: `${name}-${val}`,
          value: val,
          checked: val === value,
          onChange: (e) => {
            if (e.target.checked) onChange(val);
          },
        }),
        h('span', null, label),
      ),
    ),
  );
}

export function notice(kind, ...children) {
  const map = { warn: 'warn', bad: 'cross', good: 'check', info: 'info' };
  return h('div', { class: `notice ${kind === 'info' ? '' : kind}`, role: kind === 'bad' ? 'alert' : null }, icon(map[kind] || 'info'), h('div', { class: 'grow' }, children));
}
