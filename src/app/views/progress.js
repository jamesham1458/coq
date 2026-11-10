import { h, chip, notice } from '../dom.js';
import { trend } from '../charts.js';
import { reportFor } from '../session.js';
import { compareAssessments } from '../../core/assess.js';
import { METRIC_BY_ID, METRICS } from '../../core/specs.js';
import { formatValue, formatSpread, formatScore, formatDate, plural } from '../../core/format.js';

function shortDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function trendCard(title, points, opts) {
  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.value - first.value;
  return h(
    'section',
    { class: 'trend-card' },
    h('div', { class: 'row between' }, h('h3', null, title), h('span', { class: 'small muted num' }, `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${opts.formatDelta(Math.abs(delta))} since ${first.label}`)),
    trend(points, { title, format: opts.format, ideal: opts.ideal }),
  );
}

export function progressView(app) {
  const profile = app.profile();
  if (!profile) {
    return h('div', { class: 'stack' }, h('h1', null, 'Progress'), notice('info', 'Add a shooter to start a history.'), h('div', null, h('a', { class: 'btn', href: '#profiles' }, 'Add a shooter')));
  }
  const all = app.store.sessionsFor(profile.id);
  const ui = (app.state.progressUi ||= { deleting: null });

  const head = h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'eyebrow' }, profile.name), h('h1', null, 'Progress'));
  if (!all.length) {
    return h(
      'div',
      { class: 'stack lg' },
      head,
      h('p', { class: 'lede' }, 'Each report you build is saved here. After the second one, this page charts your score and every measurement over time, and shows what moved since the last session.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#assess' }, 'Start a full assessment'), h('a', { class: 'btn ghost', href: '#quick' }, 'Start a quick check')),
    );
  }

  const fulls = all.filter((x) => x.mode === 'full');
  const onlyFull = fulls.length >= 2;
  const series = (onlyFull ? fulls : all).slice().reverse();
  const reports = series.map((session) => ({ session, report: reportFor(session) }));
  const point = (r, value) => ({ label: shortDate(r.session.createdAt), value, note: `${r.session.mode === 'full' ? 'full' : 'quick'}, ${plural(r.session.shots.length, 'shot')}` });
  const scoreFmt = { format: (v) => formatScore(v), formatDelta: (v) => String(Math.round(v)) };

  const cards = [];
  if (reports.length >= 2) {
    const overall = reports.filter((r) => Number.isFinite(r.report.assessment.scores.overall));
    if (overall.length >= 2) cards.push(trendCard('Overall score', overall.map((r) => point(r, r.report.assessment.scores.overall)), scoreFmt));
    const form = reports.filter((r) => Number.isFinite(r.report.assessment.scores.form));
    if (form.length >= 2) cards.push(trendCard('Form', form.map((r) => point(r, r.report.assessment.scores.form)), scoreFmt));
    const cons = reports.filter((r) => Number.isFinite(r.report.assessment.scores.consistency));
    if (cons.length >= 2) cards.push(trendCard('Consistency', cons.map((r) => point(r, r.report.assessment.scores.consistency)), scoreFmt));
    for (const spec of METRICS) {
      const have = reports.filter((r) => r.report.assessment.metrics[spec.id]);
      if (have.length < 2) continue;
      const latest = have[have.length - 1].report.assessment.metrics[spec.id];
      cards.push(
        trendCard(spec.label, have.map((r) => point(r, r.report.assessment.metrics[spec.id].mean)), {
          format: (v) => formatValue(spec.id, v),
          formatDelta: (v) => formatValue(spec.id, v),
          ideal: latest.ideal || undefined,
        }),
      );
    }
  }

  let changes = null;
  if (reports.length >= 2) {
    const before = reports[reports.length - 2];
    const after = reports[reports.length - 1];
    const rows = compareAssessments(before.report.assessment, after.report.assessment).filter((r) => r.trend !== 'same' || (r.spreadTrend && r.spreadTrend !== 'same'));
    changes = h(
      'section',
      { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', null, 'Since last time'), h('span', { class: 'small muted' }, `${shortDate(before.session.createdAt)} to ${shortDate(after.session.createdAt)}`)),
      rows.length
        ? h(
            'div',
            { class: 'table-scroll' },
            h(
              'table',
              { class: 'data' },
              h('thead', null, h('tr', null, h('th', null, 'Measurement'), h('th', null, 'Before'), h('th', null, 'Now'), h('th', null, 'Direction'), h('th', null, 'Spread'))),
              h(
                'tbody',
                null,
                rows.map((r) =>
                  h(
                    'tr',
                    null,
                    h('td', null, METRIC_BY_ID[r.metric].label),
                    h('td', null, formatValue(r.metric, r.before)),
                    h('td', null, formatValue(r.metric, r.after)),
                    h('td', null, r.trend === 'better' ? chip('good', 'Toward target') : r.trend === 'worse' ? chip('fix', 'Away from target') : '–'),
                    h('td', null, r.spreadTrend && r.spreadTrend !== 'same' ? `${formatSpread(r.metric, r.spreadBefore)} to ${formatSpread(r.metric, r.spreadAfter)} (${r.spreadTrend})` : '–'),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing moved by a meaningful amount between the last two sessions.'),
    );
  }

  const list = h(
    'section',
    { class: 'stack' },
    h('div', { class: 'section-head' }, h('h2', null, 'Sessions')),
    h(
      'ul',
      { class: 'session-list' },
      all.map((session) => {
        const report = reportFor(session);
        const open = () => {
          app.state.shown = { kind: 'session', session, clips: null, saved: 'saved' };
          app.go('report');
        };
        if (ui.deleting === session.id) {
          return h(
            'li',
            { style: { padding: '8px 0' } },
            notice(
              'warn',
              `Delete the session from ${formatDate(session.createdAt)}? This cannot be undone.`,
              h(
                'div',
                { class: 'row', style: { marginTop: '8px' } },
                h('button', { class: 'btn danger', type: 'button', onClick: async () => {
                  ui.deleting = null;
                  if (app.state.shown && app.state.shown.session.id === session.id) app.state.shown = null;
                  await app.store.deleteSession(session.id).catch(() => {});
                  app.refresh();
                } }, 'Delete'),
                h('button', { class: 'btn quiet', type: 'button', onClick: () => {
                  ui.deleting = null;
                  app.refresh();
                } }, 'Keep'),
              ),
            ),
          );
        }
        return h(
          'li',
          { class: 'session-row' },
          h('div', null, h('div', { class: 'when' }, formatDate(session.createdAt)), h('div', { class: 'small muted' }, `${session.mode === 'full' ? 'Full assessment' : 'Quick check'} · ${plural(session.shots.length, 'shot')}${report.findings[0] ? ` · ${report.findings[0].title}` : ''}`)),
          h('span', { class: 'n', title: 'Overall score' }, formatScore(report.assessment.scores.overall)),
          h('span', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'btn ghost', type: 'button', style: { minHeight: '34px', padding: '4px 10px' }, onClick: open }, 'Open'), h('button', { class: 'btn quiet', type: 'button', 'aria-label': `Delete the session from ${formatDate(session.createdAt)}`, onClick: () => {
            ui.deleting = session.id;
            app.refresh();
          } }, 'Delete')),
        );
      }),
    ),
  );

  return h(
    'div',
    { class: 'stack lg' },
    head,
    reports.length < 2
      ? h('p', { class: 'lede' }, 'One session so far. Trends appear after the second, so the charts have something to compare.')
      : h('p', { class: 'lede' }, onlyFull ? 'Charts use your full assessments, oldest on the left. The shaded band is the target range.' : 'Charts use every session, oldest on the left. The shaded band is the target range. Quick checks rest on one shot, so expect them to jump around.'),
    cards.length ? h('div', { class: 'trends' }, cards) : null,
    changes,
    list,
  );
}
