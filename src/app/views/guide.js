import { h, s } from '../dom.js';

function camera(x, y, angleDeg, active) {
  const color = active ? 'var(--accent)' : 'var(--ink-3)';
  return s(
    'g',
    { transform: `translate(${x} ${y}) rotate(${angleDeg})` },
    s('rect', { x: -9, y: -6, width: 18, height: 12, rx: 2.5, fill: color }),
    s('path', { d: 'M9 -4l8 -4v16l-8 -4z', fill: color }),
  );
}

/**
 * Top-down sketch of where the camera goes for each angle.
 * @param {'left'|'right'} hand
 * @param {string[]} active  which of 'side' | 'front' | 'back' to emphasise
 */
export function anglesDiagram(hand = 'right', active = ['side', 'front', 'back']) {
  const W = 340;
  const H = 250;
  const cx = 170;
  const shooterY = 150;
  const sideX = hand === 'left' ? 46 : 294;
  const on = (k) => active.includes(k);
  const text = (x, y, anchor, str, strong) =>
    s('text', { x, y, 'text-anchor': anchor, 'font-size': 11, 'font-weight': strong ? 600 : 400, fill: strong ? 'var(--ink)' : 'var(--ink-2)', 'font-family': 'var(--font-body)' }, str);
  return s(
    'svg',
    { class: 'diagram', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Camera positions seen from above: side camera on the shooter's ${hand} side, front camera under the basket, back camera behind the shooter.` },
    // court
    s('path', { d: `M30 34H310`, stroke: 'var(--line-strong)', 'stroke-width': 2 }),
    s('rect', { x: 126, y: 34, width: 88, height: 104, fill: 'var(--accent-soft)', stroke: 'var(--line-strong)', 'stroke-width': 1.5 }),
    s('path', { d: `M126 138a44 44 0 0 0 88 0`, fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': 1.5 }),
    s('path', { d: `M154 41H186`, stroke: 'var(--ink)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    s('circle', { cx, cy: 52, r: 7.5, fill: 'none', stroke: 'var(--series-2)', 'stroke-width': 2.5 }),
    // shooter, facing the basket
    s('path', { d: `M${cx} ${shooterY - 12}V${shooterY - 34}`, stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    s('path', { d: `M${cx - 5} ${shooterY - 28}l5 -7 5 7`, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('circle', { cx, cy: shooterY, r: 10, fill: 'var(--ink)' }),
    text(cx, shooterY + 26, 'middle', 'You', true),
    // sight lines
    s('path', { d: `M${sideX + (hand === 'left' ? 20 : -20)} ${shooterY}H${cx + (hand === 'left' ? -14 : 14)}`, stroke: on('side') ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': 1.5 }),
    s('path', { d: `M${cx} 222V${shooterY + 34}`, stroke: on('back') ? 'var(--accent)' : 'var(--line-strong)', 'stroke-width': 1.5 }),
    // cameras
    camera(sideX, shooterY, hand === 'left' ? 0 : 180, on('side')),
    camera(cx, 18, 90, on('front')),
    camera(cx, 232, -90, on('back')),
    text(sideX, shooterY - 16, hand === 'left' ? 'start' : 'end', 'Side', on('side')),
    text(sideX, shooterY + 24, hand === 'left' ? 'start' : 'end', '12–15 ft away', false),
    text(cx + 24, 16, 'start', 'Front, under the basket', on('front')),
    text(cx + 24, 236, 'start', 'Back (optional)', on('back')),
  );
}

export function filmingChecklist() {
  return h(
    'ul',
    { class: 'bullets' },
    h('li', null, 'Prop the phone still at about waist height, upright (portrait), 12 to 15 feet from you.'),
    h('li', null, 'Keep your whole body in the picture for the whole shot, with room above your head for your hands at the top of the jump.'),
    h('li', null, 'Record at normal speed. Choose 60 frames per second if your camera offers it. Slow motion gives wrong timing.'),
    h('li', null, 'Only you in the picture if you can manage it. The tracker follows one person.'),
    h('li', null, 'Good, even light. Avoid a bright window or sun behind you.'),
  );
}

export function guideView(app) {
  const profile = app.profile();
  const hand = profile ? profile.hand : 'right';
  return h(
    'div',
    { class: 'stack lg' },
    h('div', { class: 'stack', style: { gap: '6px' } }, h('h1', null, 'Filming guide'), h('p', { class: 'lede' }, 'The analysis is only as good as the video. Two minutes of setup makes the numbers trustworthy.')),

    h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', null, 'Set up the camera')), filmingChecklist()),

    h(
      'section',
      { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', null, 'The angles')),
      h(
        'div',
        { class: 'cols' },
        anglesDiagram(hand),
        h(
          'dl',
          { class: 'notes' },
          h('div', null, h('dt', null, `Side, from your ${hand} side`), h('dd', null, 'Camera square to the line of your shot, on your shooting-hand side. This is the most informative angle: knee bend, set point, elbow, arm angle, release timing, lean and forward travel.')),
          h('div', null, h('dt', null, 'Front'), h('dd', null, 'Camera under the basket, facing you. Shows what the side cannot: elbow under the ball, the ball line, base width, guide hand, side lean and sideways travel.')),
          h('div', null, h('dt', null, 'Back (optional)'), h('dd', null, 'Camera behind you, on the line to the rim. Confirms the front view and adds shots to the consistency figures.')),
        ),
      ),
    ),

    h(
      'section',
      { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', null, 'How many shots')),
      h(
        'div',
        { class: 'prose' },
        h('p', null, 'A quick check needs one shot. A full assessment works best with 10 shots per angle, and needs at least 5.'),
        h('p', null, 'Film each angle as one continuous clip. Shoot from the same spot at a comfortable range, catching and shooting the way you normally would. Shot Lab finds each shot in the clip by itself.'),
        h('p', null, 'Five shots are enough to read your mechanics. Consistency is a spread, and a spread worked out from five shots can be off by more than a factor of two. With ten shots it is within about a factor of 1.6.'),
      ),
    ),

    h(
      'section',
      { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', null, 'What gets measured')),
      h(
        'div',
        { class: 'cols' },
        h('div', { class: 'stack' }, h('h3', null, 'From the side'), h('ul', { class: 'bullets' }, h('li', null, 'Knee bend at the dip'), h('li', null, 'Elbow angle and height at the set point'), h('li', null, 'Elbow extension, arm angle and release height'), h('li', null, 'Lean at release and forward travel in the air'))),
        h('div', { class: 'stack' }, h('h3', null, 'From the front or back'), h('ul', { class: 'bullets' }, h('li', null, 'Elbow under the ball'), h('li', null, 'Ball line at the set point and at the finish'), h('li', null, 'Base width and knee tracking'), h('li', null, 'Guide hand, side lean and sideways travel'))),
        h('div', { class: 'stack' }, h('h3', null, 'From any angle'), h('ul', { class: 'bullets' }, h('li', null, 'Release timing against the top of your jump'), h('li', null, 'Pause at the set point, tempo and follow-through hold'), h('li', null, 'Jump height'), h('li', null, 'Shot-to-shot consistency of all of the above'))),
      ),
    ),

    h(
      'section',
      { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', null, 'What it cannot see')),
      h(
        'ul',
        { class: 'bullets' },
        h('li', null, 'The ball. Shot Lab tracks your body only, so the release moment is estimated from how your elbow extends, and release angle is read from your arm, not from the ball’s flight.'),
        h('li', null, 'Your fingers and where your eyes are looking. Hand placement on the ball is outside what body tracking can resolve. The optional AI write-up can look at still frames for those.'),
        h('li', null, 'Whether the shot went in, unless you mark it.'),
        h('li', null, 'Fine detail at 30 frames per second. One frame is 33 ms, and release timing differences smaller than that are noise.'),
      ),
      h(
        'p',
        { class: 'prose muted' },
        'Readings that depend on an estimate are labelled so in the report. Targets are ranges that proficient shooters share, drawn from published jump-shot research and widely taught coaching points. Traits that good shooters differ on, such as a one- or two-motion shot, a turned stance, or landing forward, are described and not graded.',
      ),
    ),
  );
}
