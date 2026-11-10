// Downloads the MediaPipe pose model (Apache-2.0) into vendor/models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'vendor/models');
const name = 'pose_landmarker_full.task';
const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/${name}`;
const dst = path.join(dir, name);
if (fs.existsSync(dst) && fs.statSync(dst).size > 5e6) {
  console.log(`${name} already present`);
} else {
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${name} (${(fs.statSync(dst).size / 1e6).toFixed(1)} MB)`);
}
