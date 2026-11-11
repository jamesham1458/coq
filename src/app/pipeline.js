// One video file in, measured shots and marked-up stills out.

import { loadEngine } from '../engine/pose.js';
import { openClip } from '../engine/video.js';
import { analyzeClip, keyMoments, poseAt } from '../core/analyze.js';

/** Most shots per clip that get still frames (each costs five frame reads). */
const MAX_SHOTS_WITH_STILLS = 14;

async function holdScreenAwake() {
  try {
    if (typeof navigator !== 'undefined' && navigator.wakeLock) return await navigator.wakeLock.request('screen');
  } catch {
    // Not granted: the analysis still runs, the screen may just dim.
  }
  return null;
}

/**
 * Analyse one clip. Call this directly from the handler of the user's action
 * (choosing the file): the video has to be opened before anything is awaited.
 *
 * @param {File|Blob} file
 * @param {object} opts
 * @param {'left'|'right'} [opts.hand]
 * @param {'side'|'front'|'back'} [opts.declaredView]
 * @param {number} [opts.heightM]
 * @param {HTMLCanvasElement} opts.canvas   canvas each analysed frame is drawn to (may be on screen)
 * @param {(stage: string, fraction?: number) => void} [opts.onStage]
 * @param {(canvas: HTMLCanvasElement, lm: object[]|null, world: object[]|null) => void} [opts.onFrame]
 * @param {AbortSignal} [opts.signal]
 * @param {object} [opts.engineOptions]
 * @param {'decode'|'seek'} [opts.reader]   force one video reader (tests)
 */
export function processClip(file, opts) {
  const opening = openClip(file, { reader: opts.reader });
  // The reader is awaited later; make sure an early failure is not reported as unhandled.
  opening.catch(() => {});
  return run(file, opts, opening);
}

async function run(file, opts, opening) {
  const stage = opts.onStage || (() => {});
  let reader = null;
  let wake = null;
  try {
    stage('engine', 0);
    const engine = await loadEngine((s, f) => stage(s === 'model' ? 'engine' : 'starting', f), opts.engineOptions);
    stage('opening');
    reader = await opening;
    wake = await holdScreenAwake();
    let frames;
    let size;
    const track = async () => {
      const tracker = await engine.open();
      frames = [];
      try {
        size = await reader.frames({
          canvas: opts.canvas,
          signal: opts.signal,
          onFrame: (cv, t, fraction) => {
            let r;
            try {
              r = tracker.detect(cv, t * 1000);
            } catch (e) {
              throw Object.assign(new Error(`The pose engine failed on a frame: ${(e && e.message) || e}`), { name: 'EngineError', stage: 'detect' });
            }
            frames.push({ t, lm: r.lm, world: r.world });
            opts.onFrame?.(cv, r.lm, r.world);
            stage('reading', fraction);
          },
        });
      } finally {
        tracker.close();
      }
    };
    try {
      await track();
    } catch (e) {
      // A graphics-backend failure part-way through: start the clip again on the CPU backend.
      if (!(e && e.stage === 'detect') || engine.delegate !== 'GPU' || reader.kind !== 'decode') throw e;
      engine.useCpu();
      await track();
    }
    stage('measuring');
    const analysis = analyzeClip({ width: size.width, height: size.height, frames }, {
      hand: opts.hand,
      declaredView: opts.declaredView,
      heightM: opts.heightM,
    });

    stage('stills', 0);
    const wanted = [];
    analysis.shots.slice(0, MAX_SHOTS_WITH_STILLS).forEach((shot, si) => {
      for (const m of keyMoments(shot)) wanted.push({ si, ...m });
    });
    const blobs = await reader.grab(wanted.map((w) => w.t), { signal: opts.signal });
    const shots = analysis.shots.map((s) => ({
      hand: s.hand,
      view: s.view,
      nearSide: analysis.view.nearSide,
      t: s.t,
      jump: s.jump,
      flight: s.flight,
      metrics: s.metrics,
      quality: s.quality,
      lowQuality: !!s.lowQuality,
      followCapped: s.followCapped,
      slow: !!s.slow,
      stills: {},
      made: null,
      included: true,
    }));
    wanted.forEach((w, k) => {
      if (!blobs[k]) return;
      shots[w.si].stills[w.id] = {
        url: URL.createObjectURL(blobs[k]),
        blob: blobs[k],
        pose: poseAt(analysis.track, w.i),
        t: w.t,
      };
    });
    return {
      name: file.name || 'clip',
      hand: analysis.hand,
      view: { kind: analysis.view.kind, declared: analysis.view.declared, detected: analysis.view.detected, facing: analysis.view.facing, chestToCamera: analysis.view.chestToCamera },
      warnings: analysis.warnings,
      shots,
      aspect: size.width / size.height,
      info: { ...analysis.info, nativeFps: reader.nativeFps, reader: reader.kind, width: reader.width, height: reader.height, delegate: engine.delegate },
    };
  } finally {
    if (reader) reader.close();
    else opening.then((r) => r.close(), () => {});
    if (wake) wake.release().catch(() => {});
  }
}

/** Release the object URLs held by a processed clip's stills. */
export function releaseClip(clip) {
  for (const s of clip.shots) {
    for (const st of Object.values(s.stills)) {
      if (st.url) URL.revokeObjectURL(st.url);
    }
  }
}
