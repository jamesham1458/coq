// Wrapper around MediaPipe Pose Landmarker. Loads the WebAssembly runtime and the
// model from files published next to the page, and exposes one call: landmarks for
// a video frame.

import { PoseLandmarker } from '@mediapipe/tasks-vision';

/** Where the engine's files live, relative to the page. */
export const ENGINE_FILES = Object.freeze({
  loader: 'engine/vision_wasm_internal.js',
  wasm: 'engine/vision_wasm_internal.wasm',
  model: 'engine/pose_landmarker_full.task',
});

export class EngineError extends Error {
  /** @param {'wasm'|'model'|'init'} stage */
  constructor(stage, message, cause) {
    super(message);
    this.name = 'EngineError';
    this.stage = stage;
    this.cause = cause;
  }
}

function resolve(rel) {
  return new URL(rel, document.baseURI).href;
}

async function fetchWithProgress(url, onProgress) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new EngineError('model', `Could not download ${url}`, e);
  }
  if (!res.ok) throw new EngineError('model', `Could not download ${url} (HTTP ${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    // Content-Length can be the compressed size, so never report more than "nearly done".
    if (total) onProgress?.(Math.min(0.99, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  onProgress?.(1);
  return out;
}

/** Quick check that this browser can compile WebAssembly at all (some content policies forbid it). */
export function canCompileWasm() {
  try {
    // The smallest valid module: magic number and version.
    const mod = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    return mod instanceof WebAssembly.Module;
  } catch {
    return false;
  }
}

/** WebAssembly SIMD is required by the engine build that ships with the page. */
export function hasWasmSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

let enginePromise = null;

/**
 * Load the pose engine once: download the model and confirm the runtime starts.
 * Resolves to `{ delegate, open() }`; `open()` gives a fresh tracker for one clip.
 *
 * @param {(stage: 'model'|'runtime'|'ready', fraction: number) => void} [onProgress]
 * @param {{ delegate?: 'GPU'|'CPU' }} [opts]
 */
export function loadEngine(onProgress, opts = {}) {
  if (!enginePromise) {
    enginePromise = create(onProgress, opts).catch((e) => {
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

async function create(onProgress, opts) {
  if (!canCompileWasm()) {
    throw new EngineError('wasm', 'This page is not allowed to run WebAssembly here, which the pose engine needs.');
  }
  if (!hasWasmSimd()) {
    throw new EngineError('init', 'This browser is too old for the pose engine. Update it, or open Shot Lab in a current version of Chrome or Safari.');
  }
  const model = await fetchWithProgress(resolve(ENGINE_FILES.model), (f) => onProgress?.('model', f));
  onProgress?.('runtime', 0);
  const fileset = { wasmLoaderPath: resolve(ENGINE_FILES.loader), wasmBinaryPath: resolve(ENGINE_FILES.wasm) };
  const options = (delegate) => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let delegate = opts.delegate || 'GPU';
  const start = async () => {
    try {
      return await PoseLandmarker.createFromOptions(fileset, options(delegate));
    } catch (first) {
      if (delegate === 'CPU') throw new EngineError('init', `The pose engine failed to start: ${first?.message || first}`, first);
      delegate = 'CPU';
      try {
        return await PoseLandmarker.createFromOptions(fileset, options('CPU'));
      } catch (e) {
        throw new EngineError('init', `The pose engine failed to start: ${e?.message || e}`, e);
      }
    }
  };
  // Start it once now so a failure shows up at load time, not in the middle of a clip.
  let spare = await start();
  onProgress?.('ready', 1);

  return {
    get delegate() {
      return delegate;
    },
    /**
     * A tracker for one clip. Each clip gets its own so tracking state from one
     * recording never leaks into the next.
     */
    async open() {
      const landmarker = spare || (await start());
      spare = null;
      let lastTs = 0;
      let closed = false;
      return {
        /**
         * Landmarks for one frame. `timestampMs` only needs to increase from call to
         * call; it is nudged forward when it does not.
         * @returns {{ lm: {x:number,y:number,z:number,visibility:number}[]|null, world: {x:number,y:number,z:number}[]|null }}
         */
        detect(source, timestampMs) {
          const ts = Math.max(Math.round(timestampMs), lastTs + 1);
          lastTs = ts;
          const r = landmarker.detectForVideo(source, ts);
          const lm = r.landmarks && r.landmarks[0];
          const world = r.worldLandmarks && r.worldLandmarks[0];
          if (!lm || lm.length < 33) return { lm: null, world: null };
          return {
            lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
            world: world && world.length >= 33 ? world.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null,
          };
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            landmarker.close();
          } catch {
            // Closing a tracker that already failed is not worth surfacing.
          }
        },
      };
    },
  };
}
