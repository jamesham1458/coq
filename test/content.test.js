import { test } from 'node:test';
import assert from 'node:assert/strict';

import { METRICS, METRIC_BY_ID, BY_DISTANCE, rangesFor, CATEGORIES, SOURCES } from '../src/core/specs.js';
import { LIBRARY, SOUND, explain, styleNotes } from '../src/core/cues.js';
import { assessSession } from '../src/core/assess.js';
import { formatValue, formatRange, formatSpread, timingWords, lengthFromPct } from '../src/core/format.js';
import { parseHeight, heightText } from '../src/app/views/profiles.js';
import { buildCoachPrompt, normalizeCoachReply, coachErrorMessage } from '../src/app/ai.js';
import { exampleReport, reportFor, verdict, buildSession } from '../src/app/session.js';

test('every finding the assessment can raise has a coaching entry', () => {
  for (const m of METRICS) {
    if (!m.ideal) continue;
    const [a, b] = m.ideal;
    if (Number.isFinite(a)) assert.ok(LIBRARY[`${m.id}.low`], `missing ${m.id}.low`);
    if (Number.isFinite(b)) assert.ok(LIBRARY[`${m.id}.high`], `missing ${m.id}.high`);
    assert.ok(SOUND[m.id], `missing sound statement for ${m.id}`);
  }
  for (const bucket of ['release', 'timing', 'base', 'balance']) assert.ok(LIBRARY[`spread.${bucket}`]);
});

test('cues follow the cue rules', () => {
  for (const [key, e] of Object.entries(LIBRARY)) {
    const words = e.cue.trim().split(/\s+/).length;
    assert.ok(words >= 1 && words <= 5, `${key}: cue "${e.cue}" must be one to five words`);
    for (const field of ['title', 'cost', 'check', 'focus', 'feel', 'watch']) assert.ok(e[field] && e[field].length > 8, `${key}.${field}`);
    assert.ok(['dip', 'set', 'release', 'finish', 'landing'].includes(e.still), `${key}.still`);
    assert.equal(typeof e.saw, 'function');
  }
});

test('metric specs are coherent', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const m of METRICS) {
    assert.ok(cats.has(m.category), `${m.id} category`);
    assert.ok(SOURCES[m.source], `${m.id} source`);
    assert.ok(m.what.length > 20);
  }
  for (const [distance, table] of Object.entries(BY_DISTANCE)) {
    for (const [id, r] of Object.entries(table)) {
      assert.ok(METRIC_BY_ID[id], `${distance}.${id}`);
      assert.ok(r.ok[0] <= r.ideal[0] && r.ideal[0] < r.ideal[1] && r.ideal[1] <= r.ok[1]);
    }
  }
  assert.deepEqual(rangesFor('releaseVsApex', { distance: 'three' }).ideal, BY_DISTANCE.three.releaseVsApex.ideal);
  assert.deepEqual(rangesFor('releaseVsApex', {}).ideal, BY_DISTANCE.mid.releaseVsApex.ideal);
  assert.deepEqual(rangesFor('kneeBend', { distance: 'three' }).ideal, METRIC_BY_ID.kneeBend.ideal);
});

test('shot distance changes how release timing is judged', () => {
  const shot = (ms) => [{ view: 'side', made: null, metrics: { releaseVsApex: { value: ms, conf: 'medium' } } }];
  assert.equal(assessSession(shot(60), { distance: 'close' }).metrics.releaseVsApex.status, 'good');
  assert.notEqual(assessSession(shot(60), { distance: 'three' }).metrics.releaseVsApex.status, 'good');
  assert.equal(assessSession(shot(-170), { distance: 'three' }).metrics.releaseVsApex.status, 'good');
});

test('one clear flaw moves the form score', () => {
  const sound = (over = {}) => ({
    view: 'side',
    made: null,
    metrics: Object.fromEntries(Object.entries({ kneeBend: 110, setElbow: 75, armExtension: 170, armAngle: 55, trunkLean: 0, driftForward: 5, releaseVsApex: -40, followHold: 0.7, setHeight: 5, reachHeight: 15, setPause: 80, ...over }).map(([k, v]) => [k, { value: v, conf: 'high' }])),
  });
  const clean = assessSession([sound()]).scores.form;
  const flawed = assessSession([sound({ trunkLean: -22 })]).scores.form;
  assert.ok(clean > 99.99 && clean <= 100, `an all-sound shooter scores 100, got ${clean}`);
  assert.ok(flawed <= 85, `a severe lean should cost at least 15 points, got ${flawed}`);
  assert.ok(flawed >= 50, `one flaw should not sink the score, got ${flawed}`);
});

test('explanations are built with real numbers', () => {
  const { session } = exampleReport();
  const report = reportFor(session);
  assert.ok(report.findings.length >= 2);
  for (const f of report.findings) {
    assert.ok(f.title && f.saw && f.cue, f.key);
    assert.ok(!/undefined|NaN|– of your/.test(f.saw), `${f.key}: ${f.saw}`);
    assert.ok(/[0-9]/.test(f.saw), `${f.key} states a number: ${f.saw}`);
  }
  assert.ok(report.style.length >= 4);
  for (const s of report.style) assert.ok(!/undefined|NaN/.test(s.text), s.text);
  assert.ok(verdict(report).length > 10);
});

test('the example report is a realistic full assessment', () => {
  const { session, clips } = exampleReport();
  assert.equal(session.mode, 'full');
  assert.equal(clips.length, 2);
  assert.ok(session.shots.length >= 14, `example has ${session.shots.length} shots`);
  const a = reportFor(session).assessment;
  assert.ok(a.scores.overall > 45 && a.scores.overall < 88, `example overall score ${a.scores.overall}`);
  assert.ok(Number.isFinite(a.scores.consistency));
  assert.ok(a.findings.some((f) => f.status === 'fix'));
});

test('session records keep only what is needed and survive JSON', () => {
  const { clips } = exampleReport();
  const session = buildSession({ profile: { id: 'p1', hand: 'right', heightCm: 180 }, mode: 'full', distance: 'three', clips });
  const copy = JSON.parse(JSON.stringify(session));
  assert.deepEqual(copy, session);
  assert.ok(JSON.stringify(session).length < 60000, 'a session stays well under the per-document limit');
  assert.ok(!JSON.stringify(session).includes('blob:'));
  const a = reportFor(copy).assessment;
  assert.ok(Number.isFinite(a.scores.form));
});

test('formatting', () => {
  assert.equal(formatValue('kneeBend', 118.4), '118°');
  assert.equal(formatValue('followHold', 0.5), '0.50 s');
  assert.equal(formatValue('releaseVsApex', -42), '−42 ms');
  assert.equal(formatValue('trunkLean', -0.2), '0°');
  assert.equal(formatValue('kneeBend', NaN), '–');
  assert.equal(formatRange('kneeBend', [95, 125]), '95–125°');
  assert.equal(formatRange('followHold', [0.5, Infinity]), 'at least 0.50 s');
  assert.equal(formatRange('guideFollow', [-Infinity, 35]), 'up to 35%');
  assert.equal(formatSpread('setElbow', 4.24), '±4.2°');
  assert.equal(timingWords(-42), '40 ms before the top of your jump');
  assert.equal(timingWords(4), 'right at the top of your jump');
  assert.equal(timingWords(88), '90 ms after the top of your jump');
  assert.equal(lengthFromPct(6, 180), 'about 11 cm (4.3 in)');
  assert.equal(lengthFromPct(6, null), '');
});

test('height entry', () => {
  assert.equal(parseHeight("6'1"), 185);
  assert.equal(parseHeight('6 1'), 185);
  assert.equal(parseHeight("5'11\""), 180);
  assert.equal(parseHeight('6ft 2in'), 188);
  assert.equal(parseHeight('185'), 185);
  assert.equal(parseHeight('185 cm'), 185);
  assert.equal(parseHeight('1.85 m'), 185);
  assert.equal(parseHeight('73in'), 185);
  assert.equal(parseHeight('73'), 185, 'a bare two-digit number is read as inches');
  assert.equal(parseHeight(''), null);
  assert.equal(parseHeight('tall'), null);
  assert.equal(parseHeight('30'), null);
  assert.equal(parseHeight('400'), null);
  assert.equal(heightText(185), '6\'1" (185 cm)');
});

test('AI write-up prompt and reply handling', () => {
  const prompt = buildCoachPrompt({ shooter: { hand: 'right' }, measurements: [] }, ['side view, set point']);
  assert.ok(prompt.includes('DATA') && prompt.includes('"hand":"right"'));
  assert.ok(prompt.includes('1 still frame(s) are attached'));
  assert.ok(buildCoachPrompt({}, []).includes('No images are attached'));
  const r = normalizeCoachReply({ headline: ' Hi ', priorities: [{ title: 'A', cue: 'x' }, null, { cue: 'no title' }, { title: 'B' }, { title: 'C' }, { title: 'D' }], keep: ['ok', 3, ''], plan: 'not a list', seen: [' a '] });
  assert.equal(r.headline, 'Hi');
  assert.deepEqual(r.priorities.map((p) => p.title), ['A', 'B', 'C']);
  assert.deepEqual(r.keep, ['ok']);
  assert.deepEqual(r.plan, []);
  assert.deepEqual(r.seen, ['a']);
  assert.deepEqual(normalizeCoachReply('nonsense').priorities, []);
  assert.equal(coachErrorMessage('cancelled'), '');
  assert.ok(coachErrorMessage('rate_limited').length > 10);
  assert.ok(coachErrorMessage('something_new').length > 10);
});
