// Browser check for the screens. Example clips stand in for analysed video, so this
// exercises the capture review, report, progress, storage and delete flows without
// needing a recording or the pose engine.
//
// Needs Playwright (with Chromium):  node scripts/build.mjs && node test/e2e/screens.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer({ root: path.join(root, 'build/site'), port: 4471 });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.stack || e).slice(0, 600)));
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { problems.push(`${name}: ${String(e).slice(0, 300)}`); console.log('FAIL', name); } };
await page.goto('http://127.0.0.1:4471/', { waitUntil: 'networkidle' });
await step('create profile', async () => {
  await page.fill('#pf-name-new', 'Jordan');
  await page.fill('#pf-height-new', "6'1");
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForFunction(() => document.getElementById('who-name').textContent === 'Jordan');
});
const inject = async (seedOffset) => page.evaluate((off) => {
  const { app, exampleReport } = window.shotLab;
  const ex = exampleReport();
  const draft = app.state.drafts.full;
  draft.sessionId = null;
  draft.clips = ex.clips.map((c, i) => ({ ...c, slot: i === 0 ? 'side' : 'front', shots: c.shots.map((s, k) => ({ ...s, included: true, made: (k + off) % 3 === 0 ? false : true, metrics: JSON.parse(JSON.stringify(s.metrics)) })) }));
  if (off) for (const c of draft.clips) for (const s of c.shots) { if (s.metrics.elbowFlare) s.metrics.elbowFlare.value -= 14; if (s.metrics.releaseVsApex) s.metrics.releaseVsApex.value -= 60; }
  location.hash = 'assess';
  app.refresh();
}, seedOffset);
await step('assessment screen with clips', async () => {
  await inject(0);
  await page.waitForSelector('.shotstrip');
  const n = await page.locator('.shotcard').count();
  if (n !== 16) throw new Error(`expected 16 shot cards, saw ${n}`);
  await page.locator('.shotcard').nth(1).getByRole('button', { name: 'Skip' }).click();
  await page.locator('.shotcard').nth(2).getByRole('button', { name: 'Miss' }).click();
  if (!(await page.getByRole('button', { name: /Build the report from 15 shots/ }).count())) throw new Error('skip did not reduce the count');
  await page.locator('.seg label', { hasText: 'Three' }).click();
});
await step('build report (session 1)', async () => {
  await page.getByRole('button', { name: /Build the report/ }).click();
  await page.waitForSelector('.court');
  await page.waitForFunction(() => /Saved to Jordan/.test(document.body.innerText), null, { timeout: 5000 });
  const txt = await page.locator('main').innerText();
  if (!/15 shots analysed/.test(txt)) throw new Error('report does not show 15 shots');
  if (!/three/i.test(txt)) throw new Error('distance not shown');
  if (/undefined|NaN/.test(txt)) throw new Error('report text contains undefined/NaN: ' + txt.match(/.{40}(undefined|NaN).{40}/)?.[0]);
});
await step('open findings and frames', async () => {
  for (const s of await page.locator('section > details.finding > summary').all()) await s.click();
  await page.locator('details.more > summary', { hasText: 'smaller flag' }).click().catch(() => {});
  await page.locator('details.more summary', { hasText: 'Shot-by-shot numbers' }).click();
  const rows = await page.locator('table.data tbody tr').count();
  if (rows !== 15) throw new Error(`shot table has ${rows} rows`);
  await page.getByRole('button', { name: 'front 3' }).click();
  await page.locator('.metrics .gauge .hit').first().dispatchEvent('pointerenter');
  const tip = await page.locator('.tip').innerText();
  if (!/Shot \d+/.test(tip)) throw new Error('gauge tooltip missing: ' + tip);
});
await step('second session and progress', async () => {
  await inject(1);
  await page.waitForSelector('.shotstrip');
  await page.getByRole('button', { name: /Build the report/ }).click();
  await page.waitForSelector('.court');
  await page.goto('http://127.0.0.1:4471/#progress');
  await page.waitForSelector('.trend-card');
  const cards = await page.locator('.trend-card').count();
  const rows = await page.locator('.session-row').count();
  if (rows !== 2) throw new Error(`expected 2 sessions, saw ${rows}`);
  if (cards < 5) throw new Error(`expected trend cards, saw ${cards}`);
  const txt = await page.locator('main').innerText();
  if (!/since last time/i.test(txt)) throw new Error('no comparison section');
  if (/undefined|NaN/.test(txt)) throw new Error('progress text contains undefined/NaN');
});
await step('reload keeps history (local storage)', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.session-row');
  if ((await page.locator('.session-row').count()) !== 2) throw new Error('history lost on reload');
  await page.locator('.session-row').first().getByRole('button', { name: 'Open' }).click();
  await page.waitForSelector('.court');
});
await step('delete a session, then the profile', async () => {
  await page.goto('http://127.0.0.1:4471/#progress');
  await page.locator('.session-row').first().getByRole('button', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1);
  await page.goto('http://127.0.0.1:4471/#profiles');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('who-name').textContent === 'Add a shooter');
  await page.goto('http://127.0.0.1:4471/#report');
  await page.waitForSelector('h1');
  const h1 = await page.locator('main h1').innerText();
  if (!/No report yet/.test(h1)) throw new Error('report screen after deleting everything shows: ' + h1);
});
await step('all routes render with nothing stored', async () => {
  for (const r of ['home', 'quick', 'assess', 'progress', 'guide', 'profiles', 'report', 'nonsense']) {
    await page.goto(`http://127.0.0.1:4471/#${r}`);
    await page.waitForSelector('main h1');
  }
});
console.log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nno problems');
await browser.close();
await new Promise((r) => server.close(r));
process.exit(problems.length ? 1 : 0);
