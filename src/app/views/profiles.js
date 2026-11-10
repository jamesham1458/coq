import { h, field, segmented, notice } from '../dom.js';
import { newId } from '../store.js';
import { plural } from '../../core/format.js';

/**
 * Read a height typed as feet and inches ("6'1", "6 1", "6ft 1in"), inches ("73in")
 * or centimetres ("185", "185 cm"). Returns centimetres, or null when it cannot be read.
 */
export function parseHeight(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  let cm = null;
  const feet = /^(\d)\s*(?:'|ft|feet|foot|\s)\s*(\d{1,2}(?:\.\d+)?)?\s*(?:"|in|inches|''|″)?$/.exec(t);
  const inches = /^(\d{2}(?:\.\d+)?)\s*(?:"|in|inches)$/.exec(t);
  const metric = /^(\d{2,3}(?:\.\d+)?)\s*(?:cm)?$/.exec(t);
  const metres = /^([12](?:\.\d+)?)\s*m$/.exec(t);
  if (feet) cm = (Number(feet[1]) * 12 + Number(feet[2] || 0)) * 2.54;
  else if (inches) cm = Number(inches[1]) * 2.54;
  else if (metres) cm = Number(metres[1]) * 100;
  else if (metric) cm = Number(metric[1]);
  if (cm == null || !Number.isFinite(cm)) return null;
  // A bare number under 100 is far more likely inches than centimetres.
  if (metric && !/cm/.test(t) && cm >= 48 && cm < 100) cm *= 2.54;
  return cm >= 100 && cm <= 250 ? Math.round(cm) : null;
}

export function heightText(cm) {
  if (!(cm > 0)) return '';
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}" (${Math.round(cm)} cm)`;
}

/**
 * Form for adding or editing a shooter.
 * @param {object} app
 * @param {object|null} existing
 * @param {{ submitLabel?: string, onDone?: () => void }} [opts]
 */
export function profileForm(app, existing, opts = {}) {
  const key = existing ? existing.id : 'new';
  let hand = existing ? existing.hand : 'right';
  const name = h('input', { type: 'text', id: `pf-name-${key}`, maxlength: 40, autocomplete: 'off', value: existing ? existing.name : '', placeholder: 'Name or nickname' });
  const height = h('input', { type: 'text', id: `pf-height-${key}`, inputmode: 'text', autocomplete: 'off', value: existing && existing.heightCm ? heightText(existing.heightCm) : '', placeholder: '6\'1 or 185 cm' });
  const error = h('div', { hidden: true });
  const save = h('button', { class: 'btn', type: 'submit' }, opts.submitLabel || 'Save');
  const form = h(
    'form',
    {
      class: 'stack',
      onSubmit: async (e) => {
        e.preventDefault();
        const n = name.value.trim();
        const typed = height.value.trim();
        const cm = typed ? parseHeight(typed) : null;
        const problems = [];
        if (!n) problems.push('Enter a name.');
        if (typed && cm == null) problems.push('Height was not understood. Use feet and inches like 6\'1, or centimetres like 185 cm, or leave it empty.');
        if (problems.length) {
          error.hidden = false;
          error.replaceChildren(notice('bad', problems.join(' ')));
          return;
        }
        save.disabled = true;
        const profile = { id: existing ? existing.id : newId('p'), name: n, hand, heightCm: cm, createdAt: existing ? existing.createdAt : Date.now() };
        try {
          await app.store.saveProfile(profile);
          if (!existing) app.setProfile(profile.id);
          app.state.profileNote = '';
          if (opts.onDone) opts.onDone();
          else app.refresh();
        } catch (err) {
          save.disabled = false;
          error.hidden = false;
          error.replaceChildren(notice('bad', `The profile could not be saved. ${(err && err.message) || ''}`));
        }
      },
    },
    h(
      'div',
      { class: 'cols' },
      field('Name', name),
      h('div', { class: 'field' }, h('span', { class: 'legend' }, 'Shooting hand'), segmented(`pf-hand-${key}`, [['right', 'Right'], ['left', 'Left']], hand, (v) => {
        hand = v;
      })),
      field('Height (optional)', height, 'Lets distances be shown in inches and centimetres.'),
    ),
    error,
    h('div', { class: 'row' }, save, opts.onCancel ? h('button', { class: 'btn quiet', type: 'button', onClick: opts.onCancel }, 'Cancel') : null),
  );
  return form;
}

export function profilesView(app) {
  const { profiles, sessions } = app.store.state;
  const active = app.profile();
  const ui = (app.state.profilesUi ||= { editing: null, deleting: null, adding: false });
  const again = () => app.refresh();

  const rows = profiles.map((p) => {
    const count = sessions.filter((s) => s.profileId === p.id).length;
    if (ui.editing === p.id) {
      const close = () => {
        ui.editing = null;
        again();
      };
      return h('li', { class: 'panel stack' }, h('h3', null, `Edit ${p.name}`), profileForm(app, p, { onDone: close, onCancel: close }));
    }
    const isActive = active && active.id === p.id;
    return h(
      'li',
      { class: 'panel stack' },
      h(
        'div',
        { class: 'row between' },
        h(
          'div',
          { class: 'grow' },
          h('h3', null, p.name),
          h('div', { class: 'small muted' }, [`${p.hand === 'left' ? 'Left' : 'Right'}-handed`, p.heightCm ? heightText(p.heightCm) : null, plural(count, 'session')].filter(Boolean).join(' · ')),
        ),
        isActive ? h('span', { class: 'tag' }, 'Current shooter') : h('button', { class: 'btn ghost', type: 'button', onClick: () => {
          app.setProfile(p.id);
          again();
        } }, 'Switch to this shooter'),
      ),
      ui.deleting === p.id
        ? notice(
            'warn',
            h('div', null, `Delete ${p.name} and ${plural(count, 'saved session')}? This cannot be undone.`),
            h(
              'div',
              { class: 'row', style: { marginTop: '8px' } },
              h('button', { class: 'btn danger', type: 'button', onClick: async () => {
                ui.deleting = null;
                await app.store.deleteProfile(p.id).catch(() => {});
                if (isActive) app.setProfile(null);
                again();
              } }, 'Delete'),
              h('button', { class: 'btn quiet', type: 'button', onClick: () => {
                ui.deleting = null;
                again();
              } }, 'Keep'),
            ),
          )
        : h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn quiet', type: 'button', onClick: () => {
              ui.editing = p.id;
              again();
            } }, 'Edit'),
            h('button', { class: 'btn quiet', type: 'button', onClick: () => {
              ui.deleting = p.id;
              again();
            } }, 'Delete'),
          ),
    );
  });

  return h(
    'div',
    { class: 'stack lg' },
    h('div', { class: 'stack', style: { gap: '6px' } }, h('h1', null, 'Shooters'), h('p', { class: 'lede' }, 'Each shooter has their own history. Reports and progress always show the current shooter.')),
    rows.length ? h('ul', { class: 'stack' }, rows) : null,
    ui.adding || !profiles.length
      ? h('section', { class: 'panel stack' }, h('h2', null, profiles.length ? 'Add a shooter' : 'Add the first shooter'), profileForm(app, null, {
          submitLabel: 'Add shooter',
          onDone: () => {
            ui.adding = false;
            again();
          },
          onCancel: profiles.length
            ? () => {
                ui.adding = false;
                again();
              }
            : null,
        }))
      : h('div', null, h('button', { class: 'btn ghost', type: 'button', onClick: () => {
          ui.adding = true;
          again();
        } }, 'Add another shooter')),
  );
}
