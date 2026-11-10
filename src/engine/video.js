// Reading a user-selected video file frame by frame in the browser.
//
// Two readers, tried in this order:
//
//   decode  WebCodecs with a demuxer (Mediabunny). Every frame is decoded straight from
//           the file with its own timestamp. Nothing is played or seeked, so there is no
//           way to get a stale or skipped frame, and it is fast. Needs VideoDecoder
//           (Chrome 94+, Safari 16.4+; HEVC in Safari from 17.4).
//
//   seek    A paused <video>, stepped by seeking. The frame is drawn inside a
//           requestVideoFrameCallback that was armed before the seek, and its media time
//           is checked, because on iOS the plain 'seeked' event can fire while the canvas
//           still shows the previous frame. Without requestVideoFrameCallback it falls
//           back to waiting two animation frames and comparing the picture with the
//           previous one.

import { Input, BlobSource, ALL_FORMATS, CanvasSink } from 'mediabunny';

export class VideoError extends Error {
  /** @param {'unsupported'|'empty'|'decode'|'aborted'} code */
  constructor(code, message) {
    super(message);
    this.name = 'VideoError';
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAbort(signal) {
  if (signal && signal.aborted) throw new VideoError('aborted', 'Stopped.');
}

/** Wait while the page is in the background: browsers stop decoding and drawing there. */
async function whileHidden(signal) {
  while (typeof document !== 'undefined' && document.hidden) {
    checkAbort(signal);
    await sleep(250);
  }
}

function fitSize(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Analysis rate for a recording's frame rate: every frame up to 60 a second. */
export function samplingRate(nativeFps) {
  if (!Number.isFinite(nativeFps) || nativeFps <= 0) return 30;
  if (nativeFps > 70) return 60;
  return Math.max(10, nativeFps);
}

// ---------------------------------------------------------------------------------------
// Reader 1: decode the file directly
// ---------------------------------------------------------------------------------------

async function openDecoded(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let track;
  try {
    track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
  } catch {
    input.dispose();
    return null;
  }
  const first = await track.getFirstTimestamp();
  const end = await track.computeDuration();
  const duration = end - first;
  if (!(duration > 0)) {
    input.dispose();
    throw new VideoError('empty', 'This video has no readable length.');
  }
  let nativeFps = NaN;
  try {
    const stats = await track.computePacketStats(200);
    if (stats && stats.averagePacketRate > 0) nativeFps = stats.averagePacketRate;
  } catch {
    // The rate is measured from the frame timestamps later if this is unavailable.
  }
  const width = track.displayWidth;
  const height = track.displayHeight;
  if (!(width > 0) || !(height > 0)) {
    input.dispose();
    throw new VideoError('unsupported', 'This file has no video picture this browser can read.');
  }
  const fps = samplingRate(nativeFps);
  // High-speed recordings are thinned to about 60 frames a second.
  const thin = Number.isFinite(nativeFps) && nativeFps > 70 ? 1 / 60 : 0;

  return {
    kind: 'decode',
    width,
    height,
    duration,
    nativeFps,
    fps,
    async frames({ canvas, maxSide = 960, signal, onFrame }) {
      const [w, h] = fitSize(width, height, maxSide);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
      let count = 0;
      let next = -Infinity;
      let lastTime = -Infinity;
      let lastPause = performance.now();
      try {
        for await (const frame of sink.canvases()) {
          checkAbort(signal);
          const t = frame.timestamp - first;
          // Frames must arrive in presentation order; drop anything that does not.
          if (!(t > lastTime)) continue;
          if (thin && t < next) continue;
          lastTime = t;
          if (thin) next = t + thin * 0.75;
          ctx.drawImage(frame.canvas, 0, 0, w, h);
          await onFrame(canvas, t, Math.min(1, Math.max(0, t / duration)));
          count++;
          if (performance.now() - lastPause > 40) {
            await sleep(0);
            await whileHidden(signal);
            lastPause = performance.now();
          }
        }
      } catch (e) {
        if (e instanceof VideoError) throw e;
        throw new VideoError('decode', `The browser could not decode this video${e && e.message ? ` (${e.message})` : ''}.`);
      }
      if (!count) throw new VideoError('empty', 'No frames could be read from this video.');
      return { width: w, height: h, frames: count };
    },
    async grab(times, { maxSide = 640, quality = 0.78, signal } = {}) {
      const out = new Array(times.length).fill(null);
      if (!times.length) return out;
      const [w, h] = fitSize(width, height, maxSide);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      const half = 0.5 / (Number.isFinite(nativeFps) && nativeFps > 0 ? nativeFps : fps);
      const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
      const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill' });
      let k = 0;
      try {
        // Asking for a time returns the last frame that starts at or before it, so
        // half a frame is added to land on the nearest frame.
        for await (const frame of sink.canvasesAtTimestamps(order.map((o) => Math.max(first, first + o.t + half)))) {
          checkAbort(signal);
          if (frame) {
            ctx.drawImage(frame.canvas, 0, 0, w, h);
            out[order[k].i] = await toBlob(canvas, quality);
          }
          k++;
        }
      } catch (e) {
        if (e instanceof VideoError) throw e;
        // Stills are a nicety; missing ones are shown as placeholders.
      }
      return out;
    },
    close() {
      try {
        input.dispose();
      } catch {
        // Already disposed.
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// Reader 2: step a paused <video>
// ---------------------------------------------------------------------------------------

const once = (target, type, ms) =>
  new Promise((resolve, reject) => {
    let timer = 0;
    const ok = () => {
      cleanup();
      resolve(true);
    };
    const bad = () => {
      cleanup();
      reject(new VideoError('decode', 'The browser could not decode this video.'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(type, ok);
      target.removeEventListener('error', bad);
    };
    target.addEventListener(type, ok, { once: true });
    target.addEventListener('error', bad, { once: true });
    if (ms) {
      timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, ms);
    }
  });

/**
 * Create the <video> for the seek reader and start it once, immediately. Browsers
 * only let a page start video from a user action, and iOS will not decode frames for
 * a video that has never played, so this has to run before anything is awaited.
 */
function primeVideo(file) {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  const url = URL.createObjectURL(file);
  video.src = url;
  document.body.appendChild(video);
  const played = video.play().then(
    () => {
      video.pause();
      return true;
    },
    () => false,
  );
  return {
    video,
    played,
    discard() {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    },
  };
}

function signature(ctx, w, h, scratch) {
  // A coarse fingerprint of the picture, to tell whether a new frame has arrived.
  scratch.width = 16;
  scratch.height = 16;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, 16, 16);
  const data = sctx.getImageData(0, 0, 16, 16).data;
  let hash = 0;
  for (let i = 0; i < data.length; i += 4) hash = (hash * 31 + data[i] + (data[i + 1] << 1) + (data[i + 2] << 2)) | 0;
  return hash;
}

async function measureFrameRate(video) {
  if (typeof video.requestVideoFrameCallback !== 'function') return NaN;
  const times = [];
  let handle = 0;
  let live = true;
  const tick = (_now, meta) => {
    if (!live) return;
    times.push(meta.mediaTime);
    handle = video.requestVideoFrameCallback(tick);
  };
  try {
    handle = video.requestVideoFrameCallback(tick);
    video.playbackRate = 0.25;
    await video.play();
    await sleep(1000);
    video.pause();
  } catch {
    return NaN;
  } finally {
    live = false;
    video.playbackRate = 1;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
  }
  const steps = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 1e-4 && d < 0.2) steps.push(d);
  }
  if (steps.length < 4) return NaN;
  steps.sort((a, b) => a - b);
  // The lower quartile ignores intervals stretched by a skipped frame.
  return 1 / steps[Math.floor(steps.length / 4)];
}

async function openSeeking(primed) {
  const { video } = primed;
  try {
    if (video.readyState < 1) {
      const ok = await once(video, 'loadedmetadata', 20000);
      if (!ok) throw new VideoError('unsupported', 'This video did not load. The format may not be supported by this browser.');
    }
    // Some recordings report an unknown length until the browser is pushed to the end.
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      video.currentTime = 1e101;
      await once(video, 'durationchange', 4000);
      video.currentTime = 0;
      await once(video, 'seeked', 4000);
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new VideoError('empty', 'This video has no readable length.');
    if (video.readyState < 2) await once(video, 'loadeddata', 20000);
    if (!video.videoWidth || !video.videoHeight) throw new VideoError('unsupported', 'This file has no video picture this browser can read.');
    await primed.played;
  } catch (e) {
    primed.discard();
    if (e instanceof VideoError) throw e;
    throw new VideoError('unsupported', 'This video could not be opened.');
  }
  const nativeFps = await measureFrameRate(video);
  const fps = samplingRate(nativeFps);
  const hasCallback = typeof video.requestVideoFrameCallback === 'function';
  const scratch = document.createElement('canvas');

  /**
   * Seek to `target` and call `draw` the moment that frame is available.
   * Resolves with the media time of the drawn frame (NaN when unknown).
   */
  const stepTo = (target, draw, lastMediaTime) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let nudges = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('error', onError);
        resolve(value);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new VideoError('decode', 'The browser could not decode this video.'));
      };
      video.addEventListener('error', onError, { once: true });
      // If no new frame is presented (the seek landed on the picture already showing), draw what is there.
      const timer = setTimeout(() => {
        draw();
        finish(NaN);
      }, 1000);
      const aim = Math.min(Math.max(0, target), Math.max(0, video.duration - 1e-3));
      if (hasCallback) {
        const arm = () =>
          video.requestVideoFrameCallback((_now, meta) => {
            if (settled) return;
            if (Number.isFinite(lastMediaTime) && !(meta.mediaTime > lastMediaTime + 1e-6) && nudges < 2) {
              // Still the previous frame: wait for the next one and push the seek on a hair.
              nudges++;
              arm();
              video.currentTime = Math.min(video.duration - 1e-3, aim + 0.001 * nudges);
              return;
            }
            draw();
            finish(meta.mediaTime);
          });
        arm();
        video.currentTime = aim;
      } else {
        video.addEventListener(
          'seeked',
          () => requestAnimationFrame(() => requestAnimationFrame(() => {
            draw();
            finish(NaN);
          })),
          { once: true },
        );
        video.currentTime = aim;
      }
    });

  return {
    kind: 'seek',
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
    nativeFps,
    fps,
    async frames({ canvas, maxSide = 960, signal, onFrame }) {
      video.pause();
      const [w, h] = fitSize(video.videoWidth, video.videoHeight, maxSide);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      const draw = () => ctx.drawImage(video, 0, 0, w, h);
      const total = Math.max(1, Math.floor(video.duration * fps));
      let lastMediaTime = NaN;
      let lastSig = null;
      let count = 0;
      for (let k = 0; k < total; k++) {
        checkAbort(signal);
        await whileHidden(signal);
        // Aim at the middle of each frame's display interval so rounding never lands on a neighbour.
        const target = (k + 0.5) / fps;
        const mediaTime = await stepTo(target, draw, lastMediaTime);
        if (!hasCallback) {
          // No way to ask which frame this is, so compare pictures and wait if nothing changed.
          let sig = signature(ctx, w, h, scratch);
          for (let tries = 0; tries < 5 && sig === lastSig && k > 0; tries++) {
            await sleep(50);
            draw();
            sig = signature(ctx, w, h, scratch);
          }
          lastSig = sig;
        }
        if (Number.isFinite(mediaTime)) lastMediaTime = mediaTime;
        // Prefer the frame's own time when the browser reports one close to the target.
        const t = Number.isFinite(mediaTime) && Math.abs(mediaTime - k / fps) < 1.5 / fps ? mediaTime : k / fps;
        await onFrame(canvas, t, (k + 1) / total);
        count++;
      }
      return { width: w, height: h, frames: count };
    },
    async grab(times, { maxSide = 640, quality = 0.78, signal } = {}) {
      const [w, h] = fitSize(video.videoWidth, video.videoHeight, maxSide);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      const out = [];
      for (const t of times) {
        checkAbort(signal);
        try {
          await stepTo(t + 0.5 / fps, () => ctx.drawImage(video, 0, 0, w, h), NaN);
          out.push(await toBlob(canvas, quality));
        } catch {
          out.push(null);
        }
      }
      return out;
    },
    close() {
      primed.discard();
    },
  };
}

/**
 * Open a clip for frame-by-frame reading. Call this synchronously from the handler
 * of the user's action (choosing the file), before awaiting anything.
 *
 * @param {Blob} file
 * @param {{ reader?: 'decode'|'seek' }} [opts]  force one reader (used by tests)
 * @returns {Promise<{
 *   kind: 'decode'|'seek', width: number, height: number, duration: number,
 *   nativeFps: number, fps: number,
 *   frames: (o: { canvas: HTMLCanvasElement, maxSide?: number, signal?: AbortSignal,
 *                 onFrame: (canvas: HTMLCanvasElement, t: number, fraction: number) => (void|Promise<void>) })
 *           => Promise<{ width: number, height: number, frames: number }>,
 *   grab: (times: number[], o?: { maxSide?: number, quality?: number, signal?: AbortSignal }) => Promise<(Blob|null)[]>,
 *   close: () => void
 * }>}
 */
export function openClip(file, opts = {}) {
  const primed = primeVideo(file);
  return (async () => {
    if (opts.reader !== 'seek' && typeof VideoDecoder === 'function') {
      let reader = null;
      try {
        reader = await openDecoded(file);
      } catch (e) {
        if (opts.reader === 'decode') {
          primed.discard();
          throw e;
        }
      }
      if (reader) {
        primed.discard();
        return reader;
      }
      if (opts.reader === 'decode') {
        primed.discard();
        throw new VideoError('unsupported', 'This browser cannot decode this video directly.');
      }
    }
    return openSeeking(primed);
  })();
}
