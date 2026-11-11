import { h, icon, chip } from '../dom.js';
import { reportFor, exampleReport, verdict } from '../session.js';
import { formatDate, formatScore, plural } from '../../core/format.js';
import { profileForm } from './profiles.js';

/** One line describing the state of the pose engine, kept up to date while it loads. */
export function engineLine(app) {
  const lamp = h('span', { class: 'lamp' });
  const text = h('span', null);
  const el = h('div', { class: 'engine', role: 'status' }, lamp, text);
  const paint = (eng) => {
    el.className = `engine ${eng.status === 'ready' ? 'ready' : eng.status === 'loading' ? 'loading' : eng.status === 'idle' ? '' : 'failed'}`;
    if (eng.status === 'idle') text.textContent = 'Pose engine: downloads about 24 MB the first time you analyse a clip.';
    else if (eng.status === 'loading') text.textContent = `Loading the pose engine: ${Math.round(eng.fraction * 100)}%`;
    else if (eng.status === 'ready') text.textContent = 'Pose engine ready.';
    else if (eng.status === 'blocked') text.textContent = 'This view does not allow the pose engine to run (WebAssembly is blocked). Open Shot Lab in a regular browser tab.';
    else text.textContent = eng.message || 'The pose engine could not start.';
  };
  paint(app.state.engine);
  app.onLeave(app.onEngine(paint));
  return el;
}

function modeCard(title, points, action) {
  return h(
    'section',
    { class: 'mode' },
    h('h2', null, title),
    h('ul', null, points.map((p) => h('li', null, p))),
    action,
  );
}

function summaryPanel(app, { session, example }) {
  const report = reportFor(session);
  const top = report.findings[0];
  const open = () => {
    if (example) {
      const ex = exampleReport();
      app.state.shown = { kind: 'example', session: ex.session, clips: ex.clips, saved: 'example' };
    } else {
      app.state.shown = { kind: 'session', session, clips: null, saved: 'saved' };
    }
    app.go('report');
  };
  return h(
    'section',
    { class: 'panel stack' },
    h(
      'div',
      { class: 'row between' },
      h('div', { class: 'eyebrow' }, example ? 'What a report looks like' : 'Your latest report'),
      example ? h('span', { class: 'example-flag' }, 'Example data') : h('span', { class: 'small muted' }, formatDate(session.createdAt)),
    ),
    h(
      'div',
      { class: 'row', style: { alignItems: 'flex-end', gap: '16px' } },
      h('div', { class: 'score' }, h('span', { class: 'big', style: { fontSize: '3.5rem' } }, formatScore(report.assessment.scores.overall)), h('span', { class: 'of' }, '/ 100')),
      h(
        'div',
        { class: 'grow stack', style: { gap: '4px' } },
        h('div', { class: 'small muted' }, `${session.mode === 'full' ? 'Full assessment' : 'Quick check'} · ${plural(session.shots.length, 'shot')}`),
        h('div', null, verdict(report)),
      ),
    ),
    top
      ? h('div', { class: 'row', style: { gap: '8px' } }, chip(top.status), h('span', { class: 'grow' }, h('strong', null, top.title), '. Cue: ', h('em', null, top.cue), '.'))
      : null,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', type: 'button', onClick: open }, example ? 'Open the example report' : 'Open the report'),
      !example ? h('a', { class: 'btn ghost', href: '#progress' }, 'See progress') : null,
    ),
  );
}

export function homeView(app) {
  const profile = app.profile();
  const sessions = profile ? app.store.sessionsFor(profile.id) : [];
  const startMode = (route) => () => {
    if (!app.profile()) {
      app.state.profileNote = 'Add the shooter first so the analysis knows which hand is shooting.';
      app.refresh();
      const form = document.getElementById('first-profile');
      if (form) form.scrollIntoView({ block: 'center' });
      return;
    }
    app.go(route);
  };

  return h(
    'div',
    { class: 'stack lg' },
    h(
      'section',
      { class: 'hero' },
      h('h1', null, 'Film your jump shot. Get the numbers and the fix.'),
      h(
        'p',
        { class: 'lede' },
        'Shot Lab tracks your body through each shot, measures the positions and timing that matter, and tells you what to change and what to think about while you change it.',
      ),
    ),
    !profile
      ? h(
          'section',
          { class: 'panel stack', id: 'first-profile' },
          h('h2', null, 'Who is shooting?'),
          app.state.profileNote ? h('p', { class: 'small' }, app.state.profileNote) : null,
          profileForm(app, null, { submitLabel: 'Save and continue' }),
        )
      : null,
    h(
      'div',
      { class: 'modes' },
      modeCard(
        'Quick check',
        ['One shot, filmed from any angle', 'A fast read on your mechanics', 'Best from the side, on your shooting-hand side'],
        h('button', { class: 'btn', type: 'button', onClick: startMode('quick') }, 'Start a quick check'),
      ),
      modeCard(
        'Full assessment',
        ['A side clip and a front clip, 10 shots each', 'Mechanics plus shot-to-shot consistency', 'A back clip is optional'],
        h('button', { class: 'btn', type: 'button', onClick: startMode('assess') }, 'Start a full assessment'),
      ),
    ),
    h('div', { class: 'row between' }, engineLine(app), h('a', { href: '#guide', class: 'small' }, 'How to film your shots')),
    sessions.length ? summaryPanel(app, { session: sessions[0] }) : summaryPanel(app, { session: exampleReport().session, example: true }),
    cloudLine(app),
  );
}

function cloudLine(app) {
  const st = app.store.state;
  let text = '';
  if (st.mode === 'cloud' && st.waiting) text = `${st.waiting === 1 ? '1 item is' : `${st.waiting} items are`} kept on this device because your Claude account did not confirm the save. ${st.waiting === 1 ? 'It' : 'They'} will be sent the next time Shot Lab opens.`;
  else if (st.mode === 'cloud') text = 'History is saved to your Claude account and follows you across devices.';
  else if (st.cloud === 'pending') text = 'Checking for saved history…';
  else if (st.cloud === 'slow') text = 'Your saved history cannot be reached yet. Anything new is kept on this device for now.';
  else text = 'History is saved in this browser only. Open Shot Lab signed in to Claude to keep it across devices.';
  return h('p', { class: 'small muted row' }, icon('info', { size: 14 }), h('span', { class: 'grow' }, text));
}
