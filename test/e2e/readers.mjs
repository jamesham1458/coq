// Browser check for the two video readers. Generates clips whose frames carry their own
// index as a moving white bar, then confirms each reader delivers every frame once, in
// order, with the right timestamp and the right orientation.
//
// Needs Playwright (with Chromium) and ffmpeg on the machine:  node test/e2e/readers.mjs

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const site = path.join(root, 'build/site');
const assets = path.join(site, 'test-assets');
fs.mkdirSync(assets, { recursive: true });

const BAR = 8; // bar width in pixels; the bar sits at x = (frame mod 40) * BAR
const make = (name, fps, extra = []) => {
  const out = path.join(assets, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=320x240:r=${fps}:d=3`, '-vf', `geq=lum='if(gte(X,mod(N,40)*${BAR})*lt(X,mod(N,40)*${BAR}+${BAR}),255,16)':cb=128:cr=128`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', ...extra, out]);
  return name;
};
// A phone held upright records a sideways picture plus a note saying how to turn it.
// The same clip with that note added must come out upright from both readers.
const turned = (from, name) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', path.join(assets, from), '-c', 'copy', path.join(assets, name)]);
  return name;
};
const clips = [
  { file: make('bars30.mp4', 30), fps: 30, frames: 90 },
  { file: turned('bars30.mp4', 'bars30turned.mp4'), fps: 30, frames: 90, turned: true },
  { file: make('bars60.mp4', 60), fps: 60, frames: 180 },
  { file: make('bars30b.mp4', 30, ['-bf', '3']), fps: 30, frames: 90 },
];

const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer({ root: site, port: 4421 });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:4421/');
let failures = 0;
for (const clip of clips) {
  for (const reader of ['decode', 'seek']) {
    const res = await page.evaluate(async ({ file, reader, BAR, turned }) => {
      const blob = await (await fetch(`test-assets/${file}`)).blob();
      const r = await window.shotLab.openClip(blob, { reader });
      const canvas = document.createElement('canvas');
      const seen = [];
      const t0 = performance.now();
      const size = await r.frames({
        canvas,
        maxSide: 320,
        onFrame: (cv, t) => {
          // The bar runs along the long side of the picture: across it normally, down it when turned.
          const long = turned ? cv.height : cv.width;
          const row = turned ? cv.getContext('2d').getImageData(120, 0, 1, cv.height).data : cv.getContext('2d').getImageData(0, 120, cv.width, 1).data;
          let sum = 0;
          let n = 0;
          for (let x = 0; x < long; x++) if (row[x * 4] > 128) { sum += x; n++; }
          seen.push({ t, bar: n ? Math.round((sum / n - (BAR - 1) / 2) / BAR) : -1, w: cv.width, h: cv.height });
        },
      });
      const ms = performance.now() - t0;
      const blobs = await r.grab([0.5, 1.0], { maxSide: 160 });
      const info = { kind: r.kind, fps: r.fps, nativeFps: r.nativeFps, w: r.width, h: r.height, duration: r.duration };
      r.close();
      return { seen, size, ms, info, grabbed: blobs.map((b) => (b ? b.size : 0)) };
    }, { file: clip.file, reader, BAR, turned: !!clip.turned });
    const problems = [];
    const { seen } = res;
    if (Math.abs(seen.length - clip.frames) > 1) problems.push(`delivered ${seen.length} frames, expected ${clip.frames}`);
    let wrongBar = 0;
    let wrongTime = 0;
    seen.forEach((s, k) => {
      const expectIndex = Math.round(s.t * clip.fps);
      // Turned a quarter either way, the bar counts down the picture or up it.
      const ok = clip.turned ? s.bar === expectIndex % 40 || s.bar === 39 - (expectIndex % 40) : s.bar === expectIndex % 40;
      if (!ok) wrongBar++;
      if (k > 0 && !(s.t > seen[k - 1].t)) wrongTime++;
    });
    if (wrongBar) problems.push(`${wrongBar} frames whose picture does not match their timestamp`);
    if (wrongTime) problems.push(`${wrongTime} timestamps out of order`);
    if (res.info.kind !== reader) problems.push(`reader was ${res.info.kind}`);
    const upright = clip.turned ? res.info.w < res.info.h && seen.every((s) => s.w < s.h) : res.info.w > res.info.h && seen.every((s) => s.w > s.h);
    if (!upright) problems.push(`picture is ${res.info.w}x${res.info.h} (frames ${seen[0] && seen[0].w}x${seen[0] && seen[0].h}), so the rotation was not applied`);
    if (res.grabbed.some((n) => n < 200)) problems.push('a still could not be grabbed');
    failures += problems.length ? 1 : 0;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${clip.file} via ${reader}: ${seen.length} frames in ${Math.round(res.ms)} ms (${(res.ms / seen.length).toFixed(1)} ms/frame), native ${Number(res.info.nativeFps).toFixed(2)} fps${problems.length ? ` :: ${problems.join('; ')}` : ''}`);
  }
}
await browser.close();
await new Promise((r) => server.close(r));
fs.rmSync(assets, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
