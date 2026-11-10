// Session records: what gets stored for history, and how a report is rebuilt from one.

import { assessSession, toShotRecord } from '../core/assess.js';
import { explain, styleNotes } from '../core/cues.js';
import { synthSession } from '../core/synth.js';
import { analyzeClip, keyMoments, poseAt } from '../core/analyze.js';
import { newId } from './store.js';

export const APP_VERSION = '1';

export const DISTANCES = [
  ['close', 'Close', 'Inside about 4 m (13 ft)'],
  ['mid', 'Mid-range', 'Around the free-throw line'],
  ['three', 'Three', 'Behind the arc'],
];

/** Shots from the draft's clips that the user has left switched on. */
export function includedShots(clips) {
  const out = [];
  clips.forEach((clip, ci) => {
    clip.shots.forEach((shot, si) => {
      if (shot.included) out.push({ clip: ci, index: si, shot });
    });
  });
  return out;
}

/** Build the storable record for a finished capture. */
export function buildSession({ id, profile, mode, distance, clips }) {
  const shots = includedShots(clips).map(({ clip, shot }) => {
    const rec = toShotRecord(shot, clip);
    rec.made = shot.made;
    return rec;
  });
  return {
    id: id || newId('s'),
    profileId: profile.id,
    mode,
    createdAt: Date.now(),
    distance: distance || 'mid',
    hand: profile.hand,
    heightCm: profile.heightCm || null,
    shots,
    clips: clips.map((c) => ({
      view: c.view.kind,
      declared: c.view.declared || null,
      shots: c.shots.length,
      used: c.shots.filter((s) => s.included).length,
      fps: Math.round(c.info.fps),
      nativeFps: Number.isFinite(c.info.nativeFps) ? Math.round(c.info.nativeFps) : null,
      reader: c.info.reader || null,
      backend: c.info.delegate || null,
      warnings: c.warnings.map((w) => w.code),
    })),
    app: APP_VERSION,
  };
}

/**
 * Everything the report page needs, computed from a stored record.
 * Recomputing from the per-shot numbers means old sessions pick up any
 * improvements to the targets and the coaching notes.
 */
export function reportFor(session) {
  const assessment = assessSession(session.shots, { distance: session.distance });
  const ctx = { heightCm: session.heightCm };
  const findings = assessment.findings.map((f) => explain(f, assessment, ctx)).filter(Boolean);
  return {
    assessment,
    findings,
    style: styleNotes(assessment, ctx),
  };
}

/** One-line verdict for the header. */
export function verdict(report) {
  const { assessment, findings } = report;
  const fixes = findings.filter((f) => f.status === 'fix').length;
  const watches = findings.filter((f) => f.status === 'watch').length;
  const form = assessment.scores.form;
  if (!Number.isFinite(form)) return 'Not enough was measured to judge this shot. See the notes at the bottom.';
  if (!fixes && !watches) return 'Nothing here needs fixing. The measurements below are all inside their target ranges.';
  if (!fixes) return `Sound mechanics with ${watches} ${watches === 1 ? 'thing' : 'things'} to watch.`;
  if (form >= 75) return `Mostly sound, with ${fixes} ${fixes === 1 ? 'thing' : 'things'} to fix${watches ? ` and ${watches} to watch` : ''}.`;
  return `${fixes} ${fixes === 1 ? 'thing needs' : 'things need'} fixing${watches ? `, ${watches} more to watch` : ''}. Start with the first one.`;
}

let exampleCache = null;

/**
 * A complete example assessment from the synthetic shooter, so the page can show
 * what a report looks like before any video has been analysed. Clearly labelled
 * as an example wherever it is shown.
 */
export function exampleReport() {
  if (exampleCache) return exampleCache;
  const shooter = {
    flare: 22,
    armTilt: 12,
    releaseVsApex: 0.085,
    followHold: 0.14,
    trunkLeanRelease: -6,
    driftForward: 0.05,
    kneeFlexDip: 58,
    relShoulder: 136,
    setPause: 0.05,
    maxElbow: 168,
  };
  const spread = { setElbow: 5, relShoulder: 5.5, releaseVsApex: 0.035, flight: 0.02, driftForward: 0.05, kneeFlexDip: 4, flare: 3 };
  const noise = { fps: 30, noiseImage: 0.003, noiseWorld: 0.01, rest: 0.8 };
  const makeClip = (yawDeg, seed, declared) => {
    const raw = synthSession(shooter, 8, spread, { yawDeg }, { ...noise, seed });
    const a = analyzeClip(raw, { hand: 'right', declaredView: declared, heightM: 1.8 });
    const shots = a.shots.map((sh, k) => {
      const stills = {};
      for (const mo of keyMoments(sh)) stills[mo.id] = { url: null, pose: poseAt(a.track, mo.i), t: mo.t };
      return {
        hand: sh.hand,
        view: sh.view,
        nearSide: a.view.nearSide,
        t: sh.t,
        jump: sh.jump,
        flight: sh.flight,
        metrics: sh.metrics,
        quality: sh.quality,
        lowQuality: false,
        stills,
        made: (k * 7 + seed) % 3 !== 0,
        included: true,
      };
    });
    return {
      name: `Example ${declared} clip`,
      hand: 'right',
      view: { kind: a.view.kind, declared, detected: a.view.detected, facing: a.view.facing, chestToCamera: a.view.chestToCamera },
      warnings: [],
      shots,
      aspect: raw.width / raw.height,
      info: { ...a.info, nativeFps: 30, fps: 30 },
    };
  };
  const clips = [makeClip(90, 3, 'side'), makeClip(0, 5, 'front')];
  const session = buildSession({
    id: 'example',
    profile: { id: 'example', hand: 'right', heightCm: 180 },
    mode: 'full',
    distance: 'mid',
    clips,
  });
  exampleCache = { session, clips };
  return exampleCache;
}
