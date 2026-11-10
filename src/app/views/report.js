import { h, s, icon, chip, notice, mount } from '../dom.js';
import { gauge } from '../charts.js';
import { stillFigure, STILL_NAMES } from '../overlay.js';
import { reportFor, verdict, DISTANCES } from '../session.js';
import { getSampler, imageBudget, askCoach, coachErrorMessage } from '../ai.js';
import { METRIC_BY_ID, CATEGORIES, MIN_SHOTS_FOR_SPREAD } from '../../core/specs.js';
import { SOUND } from '../../core/cues.js';
import { formatValue, formatRange, formatSpread, formatDate, formatScore, plural } from '../../core/format.js';

const VIEW_NAMES = { side: 'side', front: 'front', back: 'back', diagonal: 'angled' };

function meterRow(label, value, strong) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const fill = v >= 80 ? 'var(--accent)' : v >= 60 ? 'var(--warn)' : 'var(--bad)';
  return h(
    'div',
    { class: 'meter' },
    h('span', { style: { fontWeight: strong ? 600 : 400 } }, label),
    h('span', { class: 'bar', role: 'img', 'aria-label': `${label}: ${formatScore(value)} out of 100` }, h('i', { style: { width: `${v}%`, background: fill } })),
    h('span', { class: 'val num' }, formatScore(value)),
  );
}

function confTag(m) {
  if (m.conf === 'high' && !m.fallback) return null;
  const text = m.conf === 'low' ? 'Low confidence' : 'Estimate';
  const title = m.fallback
    ? 'Measured from a camera angle that is not ideal for this reading, using the 3D landmark estimate.'
    : m.conf === 'low'
      ? 'A rough reading. Check it against the video before acting on it.'
      : 'An estimate from body landmarks. Good for direction, less exact than the high-confidence readings.';
  return h('span', { class: 'tag', title }, text);
}

/** Pick the shot that best represents a measurement: the one closest to the average. */
function typicalShot(clips, views, metricId, stillId) {
  if (!clips) return null;
  let best = null;
  const candidates = [];
  clips.forEach((clip) => {
    clip.shots.forEach((shot) => {
      if (!shot.included || !views.includes(shot.view) || !shot.stills || !shot.stills[stillId]) return;
      candidates.push({ clip, shot });
    });
  });
  if (!candidates.length) return null;
  const vals = candidates.map((c) => (metricId && c.shot.metrics[metricId] ? c.shot.metrics[metricId].value : NaN)).filter(Number.isFinite);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  for (const c of candidates) {
    const v = metricId && c.shot.metrics[metricId] ? c.shot.metrics[metricId].value : NaN;
    const d = Number.isFinite(v) && Number.isFinite(avg) ? Math.abs(v - avg) : Infinity;
    if (!best || d < best.d) best = { ...c, d };
  }
  return best;
}

function figureFor(clips, views, metricId, stillId) {
  const pick = typicalShot(clips, views, metricId, stillId);
  if (!pick) return null;
  const number = pick.clip.shots.indexOf(pick.shot) + 1;
  return stillFigure({
    id: stillId,
    still: pick.shot.stills[stillId],
    shot: pick.shot,
    aspect: pick.clip.aspect,
    plant: pick.shot.stills.dip,
    note: `shot ${number}`,
  });
}

function findingCard(f, rank, open, ctx) {
  const m = f.metric ? ctx.assessment.metrics[f.metric] : null;
  const views = m ? m.views : f.stillView ? [f.stillView] : [];
  const fig = figureFor(ctx.clips, views, f.metric || (f.metrics && f.metrics[0]) || null, f.still);
  const lowConf = f.conf !== 'high';
  return h(
    'details',
    { class: 'finding', open },
    h(
      'summary',
      null,
      h('span', { class: 'rank', 'aria-hidden': 'true' }, String(rank)),
      h(
        'span',
        { class: 'head' },
        h('h3', null, f.title),
        h('span', { class: 'row', style: { gap: '6px' } }, chip(f.status), f.kind === 'spread' ? h('span', { class: 'tag' }, 'Consistency') : null, lowConf ? h('span', { class: 'tag', title: 'An estimate from body landmarks. Check it against the video.' }, f.conf === 'low' ? 'Low confidence' : 'Estimate') : null),
      ),
      h('span', { class: 'caret' }, icon('chevron', { size: 18 })),
    ),
    h(
      'div',
      { class: `body ${fig ? 'has-still' : ''}` },
      fig,
      h(
        'div',
        { class: 'text' },
        h('p', null, f.saw),
        m && METRIC_BY_ID[f.metric] ? gauge({ ...METRIC_BY_ID[f.metric], ideal: m.ideal, ok: m.ok }, m) : null,
        h('p', null, h('strong', null, 'What it costs you. '), f.cost),
        h('div', { class: 'cueline' }, h('div', { class: 'eyebrow' }, 'Think this'), h('div', { class: 'cue' }, f.cue)),
        h(
          'dl',
          { class: 'notes' },
          h('div', null, h('dt', null, 'Between reps, check'), h('dd', null, f.check)),
          h('div', null, h('dt', null, 'In form shooting, focus on'), h('dd', null, f.focus)),
          h('div', null, h('dt', null, 'A good rep feels like'), h('dd', null, f.feel)),
          h('div', null, h('dt', null, 'Do not overdo it'), h('dd', null, f.watch)),
        ),
      ),
    ),
  );
}

function metricRow(m, ctx) {
  const spec = METRIC_BY_ID[m.id];
  const ranged = { ...spec, ideal: m.ideal, ok: m.ok };
  const value = `${m.capped ? '≥ ' : ''}${formatValue(m.id, m.mean)}`;
  let spreadLine = null;
  if (m.spread) {
    spreadLine = h(
      'div',
      { class: 'spread' },
      chip(m.spread.rating),
      h('span', null, `${formatSpread(m.id, m.spread.sd)} across ${plural(m.n, 'shot')}`),
      h('span', { class: 'muted' }, `(true spread likely ${formatSpread(m.id, m.spread.likelyLow).slice(1)} to ${formatSpread(m.id, m.spread.likelyHigh).slice(1)})`),
    );
  } else if (m.n > 1 && m.n < MIN_SHOTS_FOR_SPREAD && spec.tight) {
    spreadLine = h('div', { class: 'spread' }, `${plural(m.n, 'shot')}: too few for a consistency figure.`);
  }
  const target = m.ideal ? ` Target: ${formatRange(m.id, m.ideal)}.` : '';
  return h(
    'div',
    { class: 'metric' },
    h('div', { class: 'name' }, spec.label, chip(m.status), confTag(m)),
    h('div', { class: 'value num' }, value),
    gauge(ranged, m),
    h('div', { class: 'what' }, `${spec.what}${target}`),
    spreadLine,
  );
}

function shotTable(session, ids) {
  const head = h('tr', null, h('th', null, 'Shot'), h('th', null, 'View'), h('th', null, 'Result'), ids.map((id) => h('th', null, METRIC_BY_ID[id].label)));
  const rows = session.shots.map((sh, k) =>
    h(
      'tr',
      null,
      h('td', null, String(k + 1)),
      h('td', null, VIEW_NAMES[sh.view] || sh.view),
      h('td', null, sh.made === true ? 'Make' : sh.made === false ? 'Miss' : '–'),
      ids.map((id) => h('td', null, sh.metrics[id] ? formatValue(id, sh.metrics[id].value) : '–')),
    ),
  );
  return h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, rows)));
}

function framesBrowser(clips) {
  const list = [];
  clips.forEach((clip, ci) => clip.shots.forEach((shot, si) => {
    if (shot.included && Object.keys(shot.stills || {}).length) list.push({ clip, shot, label: `${VIEW_NAMES[shot.view] || shot.view} ${si + 1}`, ci, si });
  }));
  if (!list.length) return null;
  let current = 0;
  const grid = h('div', { class: 'stills' });
  const picker = h('div', { class: 'row', role: 'group', 'aria-label': 'Choose a shot' });
  const paint = () => {
    const { clip, shot } = list[current];
    mount(grid, Object.keys(STILL_NAMES).filter((id) => shot.stills[id]).map((id) => stillFigure({ id, still: shot.stills[id], shot, aspect: clip.aspect, plant: shot.stills.dip })));
    mount(picker, list.map((it, k) => h('button', { class: `btn ${k === current ? '' : 'ghost'}`, style: { minHeight: '34px', padding: '4px 10px' }, type: 'button', 'aria-pressed': k === current ? 'true' : 'false', onClick: () => {
      current = k;
      paint();
    } }, it.label)));
  };
  paint();
  return h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', null, 'Frame by frame'), h('span', { class: 'small muted' }, 'Yellow marks what the frame is evidence for. Blue lines are references.')), picker, grid);
}

function coachBrief(session, report) {
  const a = report.assessment;
  return {
    shooter: { hand: session.hand, heightCm: session.heightCm, distance: session.distance },
    session: { mode: session.mode, shots: session.shots.length, byView: a.byView },
    scores: { form: Math.round(a.scores.form), consistency: Number.isFinite(a.scores.consistency) ? Math.round(a.scores.consistency) : null },
    measurements: Object.values(a.metrics).map((m) => ({
      name: METRIC_BY_ID[m.id].label,
      what: METRIC_BY_ID[m.id].what,
      value: formatValue(m.id, m.mean),
      target: m.ideal ? formatRange(m.id, m.ideal) : null,
      status: m.status === 'info' ? 'style (not judged)' : m.status,
      confidence: m.conf,
      shots: m.n,
      spread: m.spread ? { sd: formatSpread(m.id, m.spread.sd), rating: m.spread.rating } : null,
    })),
    findings: report.findings.map((f) => ({ title: f.title, saw: f.saw, status: f.status, confidence: f.conf, builtInCue: f.cue })),
    style: report.style.map((x) => `${x.label}: ${x.text}`),
    sound: a.strengths.filter((x) => x.kind === 'form').map((x) => SOUND[x.metric]).filter(Boolean),
  };
}

function coachFrames(clips, max) {
  if (!clips || !max) return [];
  const out = [];
  const want = [['side', 'set'], ['side', 'release'], ['front', 'set'], ['front', 'finish'], ['back', 'set'], ['side', 'finish']];
  for (const [view, id] of want) {
    if (out.length >= max) break;
    for (const clip of clips) {
      const shot = clip.shots.find((sh) => sh.included && sh.view === view && sh.stills && sh.stills[id] && sh.stills[id].blob);
      if (shot) {
        out.push({ blob: shot.stills[id].blob, label: `${view} view, ${STILL_NAMES[id].toLowerCase()}` });
        break;
      }
    }
  }
  if (!out.length) {
    // An angled quick-check clip: send whatever key frames exist.
    for (const clip of clips) {
      const shot = clip.shots.find((sh) => sh.included);
      if (!shot) continue;
      for (const id of ['set', 'release', 'finish']) {
        if (out.length < max && shot.stills[id] && shot.stills[id].blob) out.push({ blob: shot.stills[id].blob, label: `${shot.view} view, ${STILL_NAMES[id].toLowerCase()}` });
      }
      break;
    }
  }
  return out;
}

function coachSection(app, session, report, clips) {
  const box = h('div', { class: 'ai' });
  const state = (app.state.coach ||= {});
  const mine = state[session.id] || (state[session.id] = { status: 'idle', result: null, error: '' });
  let ctl = null;

  const renderResult = (r) => [
    r.headline ? h('p', { class: 'headline' }, r.headline) : null,
    r.summary ? h('p', { class: 'prose' }, r.summary) : null,
    r.priorities.map((p, k) =>
      h(
        'div',
        { class: 'panel stack', style: { gap: '8px' } },
        h('h3', null, `${k + 1}. ${p.title}`),
        p.evidence ? h('p', { class: 'small muted' }, p.evidence) : null,
        p.why ? h('p', null, p.why) : null,
        p.cue ? h('div', { class: 'cueline' }, h('div', { class: 'eyebrow' }, 'Think this'), h('div', { class: 'cue' }, p.cue)) : null,
        h(
          'dl',
          { class: 'notes' },
          p.focus ? h('div', null, h('dt', null, 'In form shooting, focus on'), h('dd', null, p.focus)) : null,
          p.feel ? h('div', null, h('dt', null, 'A good rep feels like'), h('dd', null, p.feel)) : null,
          p.watchOut ? h('div', null, h('dt', null, 'Do not overdo it'), h('dd', null, p.watchOut)) : null,
        ),
      ),
    ),
    r.keep.length ? h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'Leave alone'), h('ul', { class: 'plain' }, r.keep.map((x) => h('li', null, x)))) : null,
    r.style ? h('p', { class: 'muted' }, r.style) : null,
    r.seen.length ? h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'Seen in the frames'), h('ul', { class: 'plain' }, r.seen.map((x) => h('li', null, x)))) : null,
    r.plan.length ? h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'Next form-shooting session'), h('ol', null, r.plan.map((x) => h('li', null, h('span', null, x))))) : null,
  ];

  const paint = async () => {
    if (mine.status === 'done' && mine.result) {
      mount(box, renderResult(mine.result), h('div', null, h('button', { class: 'btn quiet', type: 'button', onClick: () => {
        mine.status = 'idle';
        mine.result = null;
        paint();
      } }, 'Write it again')));
      return;
    }
    if (mine.status === 'working') return;
    const sample = await getSampler();
    if (!sample) {
      mount(box, h('p', { class: 'small muted' }, 'The AI write-up is available when Shot Lab is opened inside Claude. Everything above is complete without it.'));
      return;
    }
    const budget = clips ? await imageBudget(sample) : 0;
    const frames = coachFrames(clips, Math.min(4, budget));
    const withFrames = h('input', { type: 'checkbox', id: `ai-frames-${session.id}`, checked: frames.length > 0 });
    const go = h('button', { class: 'btn', type: 'button' }, 'Write up my breakdown');
    const live = h('p', { class: 'prose muted', hidden: true });
    const stop = h('button', { class: 'btn ghost', type: 'button', hidden: true }, icon('stop'), 'Stop');
    go.addEventListener('click', async () => {
      ctl = new AbortController();
      mine.status = 'working';
      mine.error = '';
      go.disabled = true;
      stop.hidden = false;
      live.hidden = false;
      live.textContent = 'Thinking…';
      stop.onclick = () => ctl.abort();
      try {
        const use = frames.length && withFrames.checked ? frames : [];
        mine.result = await askCoach(sample, coachBrief(session, report), use, {
          signal: ctl.signal,
          onText: () => {
            live.textContent = 'Writing…';
          },
        });
        mine.status = 'done';
      } catch (e) {
        mine.status = 'idle';
        mine.error = coachErrorMessage(e && e.code);
      }
      paint();
    });
    mount(
      box,
      h('p', { class: 'prose' }, 'Claude can write a second opinion from the same measurements, in a coach’s voice. It uses your own Claude account and takes up to a minute.'),
      frames.length
        ? h('label', { class: 'row small', for: withFrames.id }, withFrames, h('span', { class: 'grow' }, `Also send ${plural(frames.length, 'still frame')} so it can comment on what the numbers cannot show, such as hand placement. Frames leave this device only if this is ticked.`))
        : null,
      mine.error ? notice('warn', mine.error) : null,
      h('div', { class: 'row' }, go, stop),
      live,
    );
  };
  paint();
  app.onLeave(() => {
    if (ctl) ctl.abort();
    if (mine.status === 'working') mine.status = 'idle';
  });
  return h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', null, 'AI write-up'), h('span', { class: 'small muted' }, 'Optional')), box);
}

export function reportView(app) {
  const shown = app.state.shown;
  if (!shown) {
    const profile = app.profile();
    const latest = profile ? app.store.sessionsFor(profile.id)[0] : null;
    if (latest) {
      app.state.shown = { kind: 'session', session: latest, clips: null, saved: 'saved' };
      return reportView(app);
    }
    return h('div', { class: 'stack' }, h('h1', null, 'No report yet'), h('p', { class: 'lede' }, 'Run a quick check or a full assessment and the breakdown appears here.'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#quick' }, 'Start a quick check'), h('a', { class: 'btn ghost', href: '#assess' }, 'Start a full assessment')));
  }
  const { session, clips } = shown;
  const report = reportFor(session);
  const { assessment: a, findings, style } = report;
  const ctx = { assessment: a, clips };
  const example = shown.kind === 'example';
  const profile = app.store.state.profiles.find((p) => p.id === session.profileId);
  const who = example ? 'Example shooter' : profile ? profile.name : 'Shooter';
  const views = Object.entries(a.byView).map(([v, n]) => `${n} ${VIEW_NAMES[v] || v}`).join(', ');
  const distance = (DISTANCES.find((d) => d[0] === session.distance) || DISTANCES[1])[1].toLowerCase();
  const top = findings[0];
  const anyMarked = session.shots.some((sh) => sh.made === false);

  const header = h(
    'div',
    { class: 'stack', style: { gap: '6px' } },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'eyebrow' }, `${who} · ${example ? 'sample' : formatDate(session.createdAt)}`),
      example ? h('span', { class: 'example-flag' }, 'Example data') : null,
    ),
    h('h1', null, session.mode === 'full' ? 'Full assessment' : 'Quick check'),
    h('p', { class: 'small muted' }, `${plural(session.shots.length, 'shot')} analysed (${views}) · ${session.hand}-handed · ${distance}`),
    example ? notice('info', 'This report was built from a computer-generated shooter so you can see what Shot Lab produces. The stick figures stand in for video frames. None of these numbers are yours.') : null,
  );

  const scores = h(
    'section',
    { class: 'report-head' },
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'score' }, h('span', { class: 'big' }, formatScore(a.scores.overall)), h('span', { class: 'of' }, '/ 100')),
      h('p', { class: 'prose' }, verdict(report)),
    ),
    h(
      'div',
      { class: 'meters' },
      meterRow('Form', a.scores.form, true),
      Number.isFinite(a.scores.consistency) ? meterRow('Consistency', a.scores.consistency, true) : null,
      a.categories.filter((c) => Number.isFinite(c.score)).map((c) => meterRow(c.label, c.score, false)),
      !Number.isFinite(a.scores.consistency)
        ? h('p', { class: 'small muted' }, session.mode === 'full' ? 'Consistency needs at least 4 shots from one angle.' : 'A quick check reads mechanics only. Consistency comes from a full assessment.')
        : null,
    ),
  );

  const court = top
    ? h(
        'section',
        { class: 'court' },
        h('div', { class: 'eyebrow' }, 'Take this to the court'),
        h('div', { class: 'cue' }, top.cue),
        h('p', null, `One thought per shot. This is the cue for your first priority, ${top.title.toLowerCase()}. Leave the others for later sessions, and drop this one once the measurement holds.`),
      )
    : h('section', { class: 'court' }, h('div', { class: 'eyebrow' }, 'Take this to the court'), h('div', { class: 'cue' }, 'Change nothing'), h('p', null, 'Every judged measurement is inside its target range. Keep your routine and test again in a few weeks to confirm it holds.'));

  const priorities = findings.slice(0, 3);
  const rest = findings.slice(3);
  const prioritySection = priorities.length
    ? h(
        'section',
        { class: 'stack' },
        h('div', { class: 'section-head' }, h('h2', null, priorities.length === 1 ? 'Your priority' : 'Your priorities'), h('span', { class: 'small muted' }, 'Ranked by how far each is from its target and how much it matters')),
        priorities.map((f, k) => findingCard(f, k + 1, k === 0, ctx)),
        rest.length ? h('details', { class: 'more' }, h('summary', null, `${plural(rest.length, 'smaller flag')}`), h('div', { class: 'stack', style: { marginTop: '10px' } }, rest.map((f, k) => findingCard(f, k + 4, false, ctx)))) : null,
      )
    : null;

  const seen = new Set();
  const strengths = a.strengths
    .map((x) => {
      const key = `${x.kind}:${x.metric}`;
      if (seen.has(key)) return null;
      seen.add(key);
      if (x.kind === 'form') return SOUND[x.metric] || null;
      const m = a.metrics[x.metric];
      return `${METRIC_BY_ID[x.metric].label} repeats from shot to shot (${formatSpread(x.metric, m.spread.sd)}).`;
    })
    .filter(Boolean)
    .slice(0, 6);
  const strengthSection = strengths.length
    ? h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', null, 'What is working')), h('ul', { class: 'keep' }, strengths.map((t) => h('li', null, icon('check'), h('span', null, t)))))
    : null;

  const styleSection = style.length
    ? h(
        'section',
        { class: 'stack' },
        h('div', { class: 'section-head' }, h('h2', null, 'Your style'), h('span', { class: 'small muted' }, 'Good shooters differ on these, so they are described and not graded')),
        h('dl', { class: 'style-list' }, style.map((x) => h('div', null, h('dt', null, x.label), h('dd', null, x.text)))),
      )
    : null;

  const measured = CATEGORIES.map((cat) => {
    const rows = Object.values(a.metrics).filter((m) => METRIC_BY_ID[m.id].category === cat.id);
    if (!rows.length) return null;
    const c = a.categories.find((x) => x.id === cat.id);
    return h(
      'div',
      { class: 'stack', style: { gap: '0' } },
      h('div', { class: 'row between', style: { paddingTop: '10px' } }, h('h3', { style: { textTransform: 'uppercase' } }, cat.label), c && Number.isFinite(c.score) ? h('span', { class: 'num small muted' }, `${formatScore(c.score)} / 100`) : null),
      h('div', { class: 'metrics' }, rows.map((m) => metricRow(m, ctx))),
    );
  });
  const missingByNeed = {};
  for (const x of a.missing) (missingByNeed[x.needs.join(' or ')] ||= []).push(METRIC_BY_ID[x.id].label);
  const ids = Object.keys(a.metrics);
  const measureSection = h(
    'section',
    { class: 'stack' },
    h('div', { class: 'section-head' }, h('h2', null, 'Every measurement'), h('span', { class: 'small muted' }, 'The shaded band is the target range; the marker is your average')),
    session.shots.length > 1
      ? h(
          'p',
          { class: 'small muted row', style: { gap: '14px' } },
          h('span', { class: 'row', style: { gap: '6px' } }, s('svg', { width: 10, height: 10, 'aria-hidden': 'true' }, s('circle', { cx: 5, cy: 5, r: 4, fill: 'var(--series-1)' })), anyMarked ? 'Make or unmarked shot' : 'One shot'),
          anyMarked ? h('span', { class: 'row', style: { gap: '6px' } }, s('svg', { width: 10, height: 10, 'aria-hidden': 'true' }, s('circle', { cx: 5, cy: 5, r: 4, fill: 'var(--series-2)' })), 'Miss') : null,
        )
      : null,
    measured,
    Object.entries(missingByNeed).map(([need, labels]) => notice('info', `Not measured here, because it needs a ${need} view: ${labels.join(', ').toLowerCase()}.`)),
    h('details', { class: 'more' }, h('summary', null, 'Shot-by-shot numbers'), h('div', { style: { marginTop: '10px' } }, shotTable(session, ids))),
  );

  const makeMiss = a.makeMiss.length
    ? h(
        'section',
        { class: 'stack' },
        h('div', { class: 'section-head' }, h('h2', null, 'Makes against misses')),
        h(
          'ul',
          { class: 'bullets' },
          a.makeMiss.map((r) => h('li', null, `${METRIC_BY_ID[r.metric].label}: ${formatValue(r.metric, r.misses)} on your ${plural(r.nMisses, 'miss', 'misses')} against ${formatValue(r.metric, r.makes)} on your ${plural(r.nMakes, 'make')}.`)),
        ),
        h('p', { class: 'small muted prose' }, 'These are the measurements that differed most between the shots you marked as makes and misses. With this few shots, treat them as leads to check on video, not conclusions.'),
      )
    : null;

  const warnings = [...new Set(session.clips.flatMap((c) => c.warnings))].filter((c) => c !== 'noShots');
  const notes = h(
    'section',
    { class: 'stack' },
    h('div', { class: 'section-head' }, h('h2', null, 'How to read this')),
    h(
      'ul',
      { class: 'bullets small' },
      h('li', null, 'Everything is measured from body landmarks found in your video. There is no ball tracking, so the release moment is estimated from how your elbow extends.'),
      h('li', null, 'Readings marked Estimate or Low confidence point in the right direction but are less exact. Check them against the frames before changing anything.'),
      h('li', null, 'Targets are ranges that proficient shooters share. Being inside one does not make a shot go in, and being just outside is not a fault.'),
      session.shots.length > 1 ? h('li', null, 'Consistency figures from fewer than about 8 shots are rough. The likely range next to each one shows how rough.') : null,
      warnings.length ? h('li', null, `Recording notes for this session: ${warnings.map((c) => ({ lowFps: 'low frame rate', smallInFrame: 'shooter small in the picture', feetCut: 'feet out of frame', handsCut: 'hands out of frame', offHandSide: 'filmed from the guide-hand side', slowMotion: 'possible slow motion', angledCamera: 'camera not square', viewMismatch: 'clip filed under a different angle', otherHand: 'shooting hand differed from the profile', handUnclear: 'shooting hand unclear' }[c] || c)).join(', ')}.`) : null,
    ),
  );

  const saved = h(
    'div',
    { class: 'row between' },
    h(
      'span',
      { class: 'small muted' },
      example ? 'Example reports are not saved.' : shown.saved === 'saved' ? `Saved to ${who}'s history.` : shown.saved === 'saving' ? 'Saving…' : 'This report could not be saved to your history. It stays open until you leave.',
    ),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'btn ghost', href: session.mode === 'full' ? '#assess' : '#quick' }, shown.kind === 'draft' ? 'Back to the clips' : session.mode === 'full' ? 'New full assessment' : 'New quick check'),
      !example ? h('a', { class: 'btn ghost', href: '#progress' }, 'Progress') : h('a', { class: 'btn', href: '#home' }, 'Analyse your own shot'),
    ),
  );

  return h(
    'div',
    { class: 'stack lg' },
    header,
    scores,
    court,
    prioritySection,
    strengthSection,
    styleSection,
    measureSection,
    makeMiss,
    clips ? framesBrowser(clips) : null,
    !example ? coachSection(app, session, report, clips) : null,
    notes,
    saved,
  );
}
