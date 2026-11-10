// Builds the page.
//   build/artifact/shot-lab.html   the page as a fragment (title, style, markup, script), for publishing
//   build/artifact/engine/         the pose engine's files, published next to the page
//   build/site/index.html          the same page wrapped as a complete document, for any static host
//   build/site/engine/             the same engine files
//
// The pose model is not kept in git. `npm run fetch-model` downloads it into vendor/models.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  minify: process.argv.includes('--minify'),
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) throw new Error('bundle contains a closing script tag and cannot be inlined');

const css = read('src/styles.css');
const fragment = read('src/page.html').replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);

// The same wrapper the publishing step adds, so the standalone page renders identically.
const skeleton = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${fragment}</body></html>`;

const engine = [
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'vision_wasm_internal.js'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'vision_wasm_internal.wasm'],
  ['vendor/models/pose_landmarker_full.task', 'pose_landmarker_full.task'],
];
for (const target of ['artifact', 'site']) {
  const dir = path.join(out, target, 'engine');
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of engine) {
    const src = path.join(root, from);
    if (!fs.existsSync(src)) throw new Error(`missing ${from}. Run "npm install" and "npm run fetch-model" first.`);
    const dst = path.join(dir, name);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
}
fs.writeFileSync(path.join(out, 'artifact', 'shot-lab.html'), fragment);
fs.writeFileSync(path.join(out, 'site', 'index.html'), skeleton);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`built: page ${kb(Buffer.byteLength(fragment))} (script ${kb(Buffer.byteLength(js))}, styles ${kb(Buffer.byteLength(css))})`);
