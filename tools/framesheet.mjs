// Frame-sheet capture.
//
// Drives the running game through a scripted sequence, grabs a frame at each
// step, and tiles them all into one contact-sheet PNG so a whole play session
// can be reviewed in a single image.
//
//   node tools/framesheet.mjs [scriptFile] [outPng]
//
// A script file default-exports an array of steps:
//   [{ name, js, wait, repeat }]   // js runs in the page; repeat grabs N frames

import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const URL_BASE = process.env.MM6_URL || 'http://127.0.0.1:5173/';
const OUT = process.argv[3] || 'shots/sheets/gameplay.png';
const COLS = parseInt(process.env.MM6_COLS || '4', 10);
const FRAME_W = parseInt(process.env.MM6_FW || '640', 10);
const FRAME_H = parseInt(process.env.MM6_FH || '480', 10);
const SHOT_W = parseInt(process.env.MM6_W || '1280', 10);
const SHOT_H = parseInt(process.env.MM6_H || '960', 10);

const DEFAULT_SCRIPT = [
  { name: 'start', js: null, wait: 600 },
];

async function main() {
  const scriptArg = process.argv[2];
  let script = DEFAULT_SCRIPT;
  if (scriptArg && existsSync(scriptArg)) script = (await import(path.resolve(scriptArg))).default;

  const browser = await chromium.launch({
    executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--force-device-scale-factor=1', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: SHOT_W, height: SHOT_H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); }
  catch { console.error('!! never ready'); }
  await page.waitForTimeout(700);

  const frames = [];
  for (const step of script) {
    const reps = step.repeat || 1;
    for (let i = 0; i < reps; i++) {
      if (step.js) {
        try { await page.evaluate(step.js, { i, reps }); }
        catch (e) { errors.push(`step ${step.name}: ${e.message}`); }
      }
      await page.waitForTimeout(step.wait ?? 250);
      const buf = await page.screenshot({ type: 'png' });
      frames.push({ name: reps > 1 ? `${step.name} ${i + 1}` : step.name, b64: buf.toString('base64') });
      process.stdout.write(`  frame ${frames.length}: ${step.name}\n`);
    }
  }

  const fps = await page.evaluate('window.__fps || 0');
  const perf = await page.evaluate('JSON.stringify(window.__perf || {})');

  // Composite in a scratch page - no native image deps needed.
  const sheetPage = await browser.newPage({ viewport: { width: 200, height: 200 } });
  const rows = Math.ceil(frames.length / COLS);
  const LABEL = 18;
  const sheet = await sheetPage.evaluate(async ({ frames, cols, rows, fw, fh, label }) => {
    const c = document.createElement('canvas');
    c.width = cols * fw;
    c.height = rows * (fh + label);
    const g = c.getContext('2d');
    g.fillStyle = '#101010';
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < frames.length; i++) {
      const img = new Image();
      img.src = 'data:image/png;base64,' + frames[i].b64;
      await img.decode();
      const x = (i % cols) * fw, y = Math.floor(i / cols) * (fh + label);
      g.drawImage(img, 0, 0, img.width, img.height, x, y + label, fw, fh);
      g.fillStyle = '#ffd84a';
      g.font = '12px monospace';
      g.fillText(`${i + 1}. ${frames[i].name}`, x + 4, y + 13);
      g.strokeStyle = '#404040';
      g.strokeRect(x + 0.5, y + label + 0.5, fw - 1, fh - 1);
    }
    return c.toDataURL('image/png');
  }, { frames, cols: COLS, rows, fw: FRAME_W, fh: FRAME_H, label: LABEL });

  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  writeFileSync(OUT, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`\nwrote ${OUT} (${frames.length} frames, ${COLS}x${rows})`);
  console.log('FPS(headless):', fps, 'PERF:', perf);
  if (errors.length) {
    console.log('--- ERRORS ---');
    errors.slice(0, 30).forEach((e) => console.log(e));
  } else console.log('no page errors');

  await browser.close();
  if (errors.length) process.exitCode = 2;
}

main();
