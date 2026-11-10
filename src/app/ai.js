// Optional AI-written coaching layer. The page works without it: the measured
// breakdown and built-in coaching notes never depend on this module.
//
// When the page runs inside the Claude viewer, `claude.use("sample")` lets it ask
// Claude a question on the viewer's own account. We send the measurements (and, if
// the viewer agrees, a few still frames) and ask for a written breakdown.

/** Resolve the sampling function, or null where it is unavailable. */
export async function getSampler() {
  const claude = typeof window !== 'undefined' ? window.claude : null;
  if (!claude || typeof claude.use !== 'function') return null;
  try {
    return await claude.use('sample');
  } catch {
    return null;
  }
}

/** How many images this view lets a call carry (0 when images cannot be sent). */
export async function imageBudget(sample) {
  try {
    const limits = await sample.limits();
    return limits && limits.images ? Math.max(0, limits.images.maxCount | 0) : 0;
  } catch {
    return 0;
  }
}

const SHAPE = `{
  "headline": "one sentence, the single most important thing about this shot",
  "summary": "3-5 sentences: what is sound, what is costing accuracy or consistency, and why",
  "priorities": [
    {
      "title": "short name of the issue",
      "evidence": "the measurement(s) that show it, with numbers and targets",
      "why": "what it does to the ball or to repeatability",
      "cue": "ONE cue of at most five words to think during the shot",
      "focus": "what to pay attention to while form shooting close to the rim",
      "feel": "how the shooter can tell a rep was right",
      "watchOut": "the common over-correction to avoid"
    }
  ],
  "keep": ["things already working that should not be changed"],
  "style": "one or two sentences describing this shooter's style traits neutrally",
  "seen": ["only if images were provided: observations visible in the frames that the numbers cannot show, each starting with the frame it came from"],
  "plan": ["3-5 short steps for the next form-shooting session, in order"]
}`;

/**
 * Build the prompt for the written breakdown.
 * @param {object} brief  plain data: shooter, session, measurements, findings (see report.js)
 * @param {string[]} frameLabels  description of each attached image, in order
 */
export function buildCoachPrompt(brief, frameLabels) {
  const lines = [];
  lines.push('You are writing a basketball jump-shot form breakdown for the shooter described below.');
  lines.push('Voice: a technical analyst and a direct coach in one. Lead with numbers, then say plainly what to change. No hype, no filler, no apologies. Address the shooter as "you".');
  lines.push('');
  lines.push('Ground rules:');
  lines.push('- Use only the measurements given. Never invent a number, and never describe something as measured that is not in the data.');
  lines.push('- The measurements come from body landmarks found in video by pose estimation. There is no ball tracking: release timing, release height and arm angle are estimates. Readings marked low confidence are hints to check on video, not facts.');
  lines.push('- Treat items listed under STYLE as neutral traits, not faults, unless a measurement in FINDINGS says otherwise.');
  lines.push('- Rank at most three priorities, most important first, following the order in FINDINGS unless the data clearly argues otherwise.');
  lines.push('- Cues: one per priority, at most five words, sayable in rhythm. Prefer words about the rim, the ball flight or the floor, or a simple analogy, over body-part instructions. The shooter should carry only the first cue into live shots.');
  lines.push('- If a consistency figure rests on fewer than eight shots, say that it is a rough estimate.');
  if (frameLabels.length) {
    lines.push(`- ${frameLabels.length} still frame(s) are attached, in this order: ${frameLabels.join('; ')}. Use them only for things you can clearly see (hand placement on the ball, guide hand, where the eyes are, balance). If something is not clearly visible, do not mention it.`);
  } else {
    lines.push('- No images are attached. Leave "seen" as an empty list.');
  }
  lines.push('');
  lines.push('Reply with only one JSON object of exactly this shape:');
  lines.push(SHAPE);
  lines.push('');
  lines.push('DATA');
  lines.push(JSON.stringify(brief));
  return lines.join('\n');
}

const asText = (v) => (typeof v === 'string' ? v.trim() : '');
const asList = (v) => (Array.isArray(v) ? v.map(asText).filter(Boolean) : []);

/** Validate and tidy the model's reply so the page can render it safely. */
export function normalizeCoachReply(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const priorities = Array.isArray(r.priorities)
    ? r.priorities
        .filter((p) => p && typeof p === 'object')
        .slice(0, 3)
        .map((p) => ({
          title: asText(p.title),
          evidence: asText(p.evidence),
          why: asText(p.why),
          cue: asText(p.cue),
          focus: asText(p.focus),
          feel: asText(p.feel),
          watchOut: asText(p.watchOut),
        }))
        .filter((p) => p.title)
    : [];
  return {
    headline: asText(r.headline),
    summary: asText(r.summary),
    priorities,
    keep: asList(r.keep).slice(0, 5),
    style: asText(r.style),
    seen: asList(r.seen).slice(0, 6),
    plan: asList(r.plan).slice(0, 6),
  };
}

/** Viewer-facing explanation for a failed call. */
export function coachErrorMessage(code) {
  switch (code) {
    case 'cancelled':
      return '';
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'The AI write-up is not available in this view. The measured breakdown above is complete without it.';
    case 'rate_limited':
      return 'Claude is busy or you have reached a usage limit. Try the AI write-up again later.';
    case 'session_expired':
      return 'Your Claude session has expired. Sign in again, then retry.';
    case 'refused':
      return 'Claude declined to write this up. The measured breakdown above is unaffected.';
    case 'invalid_json':
    case 'empty_completion':
      return 'The write-up came back in a form the page could not read. Try again.';
    case 'image_rejected':
    case 'images_unavailable':
      return 'The still frames could not be sent. Try again without frames.';
    case 'prompt_too_large':
      return 'There is too much data in this session for one write-up.';
    default:
      return 'The AI write-up was interrupted. Try again.';
  }
}

/**
 * Ask for the written breakdown.
 * @param {Function} sample           from getSampler()
 * @param {object} brief
 * @param {{ blob: Blob, label: string }[]} frames  stills to attach (may be empty)
 * @param {{ signal?: AbortSignal, onText?: (text: string) => void }} [opts]
 */
export async function askCoach(sample, brief, frames, opts = {}) {
  const prompt = buildCoachPrompt(brief, frames.map((f) => f.label));
  const options = { signal: opts.signal, onText: opts.onText ? ({ text }) => opts.onText(text) : undefined };
  if (frames.length) options.images = frames.map((f) => f.blob);
  const raw = await sample.json(prompt, options);
  return normalizeCoachReply(raw);
}
