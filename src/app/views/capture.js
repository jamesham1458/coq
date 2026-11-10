import { h, icon, notice, segmented, mount } from '../dom.js';
import { processClip, releaseClip } from '../pipeline.js';
import { buildSession, includedShots, DISTANCES } from '../session.js';
import { SKELETON } from '../../core/landmarks.js';
import { plural } from '../../core/format.js';
import { anglesDiagram, filmingChecklist } from './guide.js';
import { engineLine } from './home.js';

const SLOTS = {
  quick: [
    { id: 'any', title: 'Your shot', declared: null, need: 1, want: 1, blurb: 'One clip with one shot in it, from any angle. From the side on your shooting-hand side you get the most out of it.' },
  ],
  full: [
    { id: 'side', title: 'Side view', declared: 'side', need: 5, want: 10, blurb: 'Camera on your shooting-hand side, square to the line of the shot.' },
    { id: 'front', title: 'Front view', declared: 'front', need: 5, want: 10, blurb: 'Camera under the basket, facing you.' },
    { id: 'back', title: 'Back view', declared: 'back', need: 0, want: 10, optional: true, blurb: 'Camera behind you, on the line to the rim. Optional.' },
  ],
};

const VIEW_WORDS = { side: 'the side', front: 'the front', back: 'behind', diagonal: 'an angle', unknown: 'an unclear angle' };

/** Plain-language explanation for each warning the analysis can raise. */
export function warningText(w, clip) {
  const hand = clip ? clip.hand : 'right';
  switch (w.code) {
    case 'tooShort':
      return 'This clip is too short to analyse.';
    case 'noPerson':
      return 'No person was found in most of this clip. Keep your whole body in the picture, in good light.';
    case 'noShots':
      return 'No shot was found in this clip. Your shooting hand has to rise above your shoulder and your arm has to extend. Check that your hands stay in the picture at the top of the shot.';
    case 'otherHand':
      return `These look like ${w.detail}-handed shots, and were analysed that way. If that is wrong, the video may be mirrored (some front cameras do this): record with the back camera.`;
    case 'handUnclear':
      return `It was hard to tell which hand was shooting. This was analysed as ${hand}-handed.`;
    case 'viewMismatch': {
      const [said, seen] = String(w.detail || '').split(':');
      return `This clip was added as a ${said} view but looks like it was filmed from ${VIEW_WORDS[seen] || seen}. It was analysed as a ${seen} view.`;
    }
    case 'angledCamera': {
      const [deg, ref] = String(w.detail || '').split(':');
      return ref === 'line'
        ? `The camera is about ${deg}° off the line of the shot, which is too far to count as a front or back view. Angles were estimated in 3D and across-the-body readings were left out. Put the camera on the line between you and the basket.`
        : `The camera is about ${deg}° off square to the shot, which is too far to count as a side view. Angles were estimated in 3D and are less exact. Put the camera square to the line of the shot.`;
    }
    case 'offAxis':
      return `The camera is about ${w.detail}° to one side of the line of the shot. The readings allow for it, but sideways travel is only rough from here. Put the camera on the line between you and the basket.`;
    case 'lowFps':
      return `This video has only ${w.detail} frames per second, so timing numbers are rough. 60 is best.`;
    case 'smallInFrame':
      return 'You are small in the picture. Move the camera closer so your body fills more than a third of its height.';
    case 'legsCut':
      return 'Your hips and legs are out of the picture, so there is nothing to measure against. Move the camera back until your whole body fits, with room above your head.';
    case 'feetCut':
      return 'Your feet are out of the picture for some shots, so jump timing, landing and travel were not measured for them. Move the camera back or tilt it down.';
    case 'handsCut':
      return 'Your shooting hand leaves the top of the picture at the release on some shots, so release height, arm angle and follow-through were not measured for them. Leave more room above your head.';
    case 'offHandSide':
      return 'This was filmed from your guide-hand side, so your shooting arm is partly hidden and arm readings are less exact. Film from your shooting-hand side.';
    case 'slowMotion':
      return 'This looks like slow-motion video, so timing and jump numbers will be wrong. Record at normal speed.';
    default:
      return w.code;
  }
}

function errorText(e) {
  if (!e) return 'Something went wrong while analysing this clip.';
  if (e.name === 'VideoError') {
    if (e.code === 'aborted') return '';
    if (e.code === 'unsupported') return `${e.message} On an iPhone, Settings > Camera > Formats > Most Compatible records video every browser can read.`;
    return e.message;
  }
  if (e.name === 'EngineError') {
    if (e.stage === 'wasm') return 'This view does not allow the pose engine to run (WebAssembly is blocked). Open Shot Lab in a regular browser tab.';
    if (e.stage === 'model') return 'The pose engine could not be downloaded. Check your connection and try again.';
    return e.message;
  }
  return `Something went wrong while analysing this clip. ${e.message || ''}`;
}

function drawSkeleton(canvas, lm) {
  if (!lm) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, W / 160);
  ctx.strokeStyle = '#ffd23f';
  ctx.beginPath();
  for (const [a, b] of SKELETON) {
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
  }
  ctx.stroke();
}

export function captureView(app, mode) {
  const profile = app.profile();
  if (!profile) {
    return h('div', { class: 'stack' }, h('h1', null, mode === 'full' ? 'Full assessment' : 'Quick check'), notice('info', 'Add a shooter first so the analysis knows which hand is shooting.'), h('div', null, h('a', { class: 'btn', href: '#profiles' }, 'Add a shooter')));
  }
  const draft = app.state.drafts[mode];
  const slots = SLOTS[mode];
  app.ensureEngine();

  const slotsEl = h('div', { class: 'stack' });
  const workEl = h('div', { 'aria-live': 'polite' });
  const footEl = h('div', { class: 'stack' });
  let abort = null;

  const clipsIn = (slotId) => draft.clips.filter((c) => c.slot === slotId);
  const usedIn = (slotId) => clipsIn(slotId).reduce((n, c) => n + c.shots.filter((s) => s.included).length, 0);

  function paint() {
    mount(slotsEl, slots.map(slotSection));
    mount(footEl, footer());
  }

  async function handleFile(slot, file) {
    if (!file || app.state.busy) return;
    if (file.type && !file.type.startsWith('video/')) {
      draft.error = { slot: slot.id, messages: ['That file is not a video.'] };
      paint();
      return;
    }
    draft.error = null;
    abort = new AbortController();
    app.state.busy = { slot: slot.id };
    const canvas = h('canvas', { class: 'preview', width: 180, height: 320, 'aria-label': 'The frame being analysed, with the tracked skeleton drawn over it' });
    const stageEl = h('div', { class: 'small' }, 'Getting ready');
    const bar = h('i');
    const stop = h('button', { class: 'btn ghost', type: 'button', onClick: () => abort && abort.abort() }, icon('stop'), 'Stop');
    mount(workEl, h('section', { class: 'panel working' }, h('div', { class: 'row between' }, h('h3', null, `Analysing ${slot.title.toLowerCase()}`), stop), canvas, h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Analysis progress' }, bar), stageEl));
    paint();
    workEl.scrollIntoView({ block: 'nearest' });

    const setStage = (stage, f) => {
      const pct = Number.isFinite(f) ? Math.round(f * 100) : null;
      const text = {
        engine: `Loading the pose engine${pct != null ? `: ${pct}%` : ''}`,
        starting: 'Starting the pose engine',
        opening: 'Opening the video',
        reading: `Tracking your body${pct != null ? `: ${pct}%` : ''}`,
        measuring: 'Measuring',
        stills: 'Saving key frames',
      }[stage] || 'Working';
      stageEl.textContent = text;
      const overall = stage === 'engine' ? 0.1 * (f || 0) : stage === 'starting' || stage === 'opening' ? 0.1 : stage === 'reading' ? 0.1 + 0.8 * (f || 0) : stage === 'measuring' ? 0.92 : 0.96;
      bar.style.width = `${Math.round(overall * 100)}%`;
    };

    try {
      const clip = await processClip(file, {
        hand: profile.hand,
        declaredView: slot.declared,
        heightM: profile.heightCm ? profile.heightCm / 100 : undefined,
        canvas,
        signal: abort.signal,
        onStage: setStage,
        onFrame: (cv, lm) => drawSkeleton(cv, lm),
        engineOptions: app.engineOptions(),
        reader: app.readerOption(),
      });
      clip.slot = slot.id;
      if (!clip.shots.length) {
        // A blocking reason replaces the generic "no shot found"; other notes follow it.
        const BLOCKING = ['tooShort', 'noPerson', 'legsCut', 'slowMotion'];
        const blocking = clip.warnings.filter((w) => BLOCKING.includes(w.code));
        const others = clip.warnings.filter((w) => !BLOCKING.includes(w.code) && w.code !== 'noShots');
        const lead = blocking.length ? blocking : [{ code: 'noShots' }];
        const texts = [...lead, ...others].map((w) => warningText(w, clip));
        draft.error = { slot: slot.id, messages: texts.filter((r, i, all) => all.indexOf(r) === i) };
        releaseClip(clip);
      } else {
        if (mode === 'quick') {
          for (const old of draft.clips) releaseClip(old);
          draft.clips = [];
        }
        draft.clips.push(clip);
      }
    } catch (e) {
      const msg = errorText(e);
      if (msg) draft.error = { slot: slot.id, messages: [msg] };
      if (!(e && (e.name === 'VideoError' || e.name === 'EngineError'))) console.error(e);
    } finally {
      abort = null;
      app.state.busy = null;
      mount(workEl);
      paint();
    }
    // A quick check with exactly one shot has nothing to review, so go straight to the report.
    if (mode === 'quick' && draft.clips.length === 1 && draft.clips[0].shots.length === 1 && !draft.error) build();
  }

  function filePicker(slot, label, primary) {
    const input = h('input', {
      type: 'file',
      accept: 'video/*',
      id: `file-${mode}-${slot.id}`,
      onChange: (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        handleFile(slot, file);
      },
    });
    const btn = h('label', { class: `btn ${primary ? '' : 'ghost'}`, for: input.id, 'aria-disabled': app.state.busy ? 'true' : null }, icon('upload'), label, input);
    if (app.state.busy) btn.style.opacity = '0.5';
    return btn;
  }

  function shotCard(clip, shot, k) {
    const still = shot.stills.release || shot.stills.finish || shot.stills.set || Object.values(shot.stills)[0];
    const btn = (label, pressed, onClick, title) => h('button', { type: 'button', 'aria-pressed': pressed ? 'true' : 'false', title, onClick: () => {
      onClick();
      paint();
    } }, label);
    return h(
      'li',
      { class: `shotcard ${shot.included ? '' : 'off'}` },
      h('div', { class: 'thumb' }, still && still.url ? h('img', { src: still.url, alt: `Shot ${k + 1} at release`, loading: 'lazy' }) : null, h('span', { class: 'n' }, String(k + 1))),
      h(
        'div',
        { class: 'mini', role: 'group', 'aria-label': `Shot ${k + 1}` },
        btn('Make', shot.made === true, () => {
          shot.made = shot.made === true ? null : true;
        }, 'Mark this shot as a make'),
        btn('Miss', shot.made === false, () => {
          shot.made = shot.made === false ? null : false;
        }, 'Mark this shot as a miss'),
        btn('Skip', !shot.included, () => {
          shot.included = !shot.included;
        }, 'Leave this shot out of the analysis'),
      ),
      shot.lowQuality ? h('span', { class: 'tag', title: 'The tracker lost you for part of this shot' }, 'Patchy tracking') : null,
    );
  }

  function clipBlock(clip, n) {
    const facts = [plural(clip.shots.length, 'shot'), `filmed from ${VIEW_WORDS[clip.view.kind] || clip.view.kind}`, Number.isFinite(clip.info.nativeFps) ? `${Math.round(clip.info.nativeFps)} fps` : null].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: 'stack', style: { gap: '8px' } },
      h(
        'div',
        { class: 'row between' },
        h('div', { class: 'small' }, h('strong', null, `Clip ${n + 1}`), ` · ${facts}`),
        h('button', { class: 'btn quiet', type: 'button', disabled: !!app.state.busy, onClick: () => {
          releaseClip(clip);
          draft.clips = draft.clips.filter((c) => c !== clip);
          paint();
        } }, 'Remove clip'),
      ),
      clip.warnings.filter((w) => w.code !== 'noShots').map((w) => notice('warn', warningText(w, clip))),
      h('ul', { class: 'shotstrip' }, clip.shots.map((shot, k) => shotCard(clip, shot, k))),
    );
  }

  function slotSection(slot) {
    const clips = clipsIn(slot.id);
    const used = usedIn(slot.id);
    const err = draft.error && draft.error.slot === slot.id ? draft.error.messages : null;
    const count = mode === 'full' ? h('span', { class: 'small muted' }, used ? `${plural(used, 'shot')} in${slot.need ? `, ${used >= slot.want ? 'plenty' : used >= slot.need ? `${slot.want} is better` : `${slot.need} needed`}` : ''}` : slot.optional ? 'Optional' : `${slot.want} shots recommended, ${slot.need} needed`) : null;
    return h(
      'section',
      { class: 'slot' },
      h('header', null, h('h3', null, slot.title), count),
      h('p', { class: 'small muted' }, slot.blurb),
      err ? notice('bad', err.map((m) => h('div', null, m))) : null,
      clips.map(clipBlock),
      h('div', { class: 'row' }, filePicker(slot, clips.length ? (mode === 'quick' ? 'Choose a different clip' : 'Add another clip') : 'Choose or record a clip', !clips.length)),
    );
  }

  function build() {
    const shots = includedShots(draft.clips);
    if (!shots.length) return;
    const session = buildSession({ id: draft.sessionId, profile, mode, distance: draft.distance, clips: draft.clips });
    draft.sessionId = session.id;
    const shown = { kind: 'draft', session, clips: draft.clips, saved: 'saving' };
    app.state.shown = shown;
    app.store.saveSession(session).then(
      () => {
        shown.saved = 'saved';
        if (app.state.route === 'report' && app.state.shown === shown) app.refresh();
      },
      () => {
        shown.saved = 'failed';
        if (app.state.route === 'report' && app.state.shown === shown) app.refresh();
      },
    );
    app.go('report');
  }

  function footer() {
    const total = includedShots(draft.clips).length;
    const notes = [];
    if (mode === 'full' && total) {
      const side = usedIn('side');
      const front = usedIn('front');
      if (!side) notes.push('Without a side clip the report has no knee, elbow, arm-angle, lean or forward-travel measurements.');
      else if (side < 5) notes.push(`Only ${plural(side, 'side shot')} so far. With fewer than 5 the consistency figures are not reliable.`);
      if (!front && !usedIn('back')) notes.push('Without a front clip the report has no elbow-under-the-ball, ball-line, base or sideways-travel measurements.');
      else if (front && front < 5) notes.push(`Only ${plural(front, 'front shot')} so far. With fewer than 5 the consistency figures are not reliable.`);
    }
    return [
      total
        ? h(
            'div',
            { class: 'field' },
            h('span', { class: 'legend' }, 'Where were these shots taken from?'),
            segmented(`dist-${mode}`, DISTANCES.map(([v, label]) => [v, label]), draft.distance, (v) => {
              draft.distance = v;
            }),
            h('span', { class: 'hint' }, 'Release timing and forward travel are judged against the distance.'),
          )
        : null,
      notes.map((n) => notice('info', n)),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', type: 'button', disabled: !total || !!app.state.busy, onClick: build }, total ? `Build the report from ${plural(total, 'shot')}` : 'Build the report'),
        draft.clips.length
          ? h('button', { class: 'btn quiet', type: 'button', disabled: !!app.state.busy, onClick: () => {
              app.resetDraft(mode);
              app.refresh();
            } }, 'Start over')
          : null,
      ),
    ];
  }

  // Dropping a file anywhere on a slot works on desktop.
  const onDrop = (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    const target = e.target.closest && e.target.closest('.slot');
    const index = target ? [...slotsEl.children].indexOf(target) : 0;
    handleFile(slots[Math.max(0, index)], file);
  };
  slotsEl.addEventListener('dragover', (e) => e.preventDefault());
  slotsEl.addEventListener('drop', onDrop);
  app.onLeave(() => {
    if (abort) abort.abort();
  });

  paint();
  return h(
    'div',
    { class: 'stack lg' },
    h(
      'div',
      { class: 'stack', style: { gap: '6px' } },
      h('div', { class: 'eyebrow' }, `${profile.name} · ${profile.hand}-handed`),
      h('h1', null, mode === 'full' ? 'Full assessment' : 'Quick check'),
      h('p', { class: 'lede' }, mode === 'full' ? 'Film one clip per angle with 10 shots in each, then add them here. Shot Lab finds each shot in the clip.' : 'Add one clip of one shot. You get a read on your mechanics in about a minute.'),
    ),
    h(
      'details',
      { class: 'more' },
      h('summary', null, 'How to film it'),
      h('div', { class: 'cols', style: { marginTop: '10px' } }, anglesDiagram(profile.hand, mode === 'full' ? ['side', 'front', 'back'] : ['side']), filmingChecklist()),
    ),
    engineLine(app),
    slotsEl,
    workEl,
    footEl,
  );
}
