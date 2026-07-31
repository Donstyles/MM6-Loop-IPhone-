// Screenshot / frame-sheet capture harness.
//
// Boots the game in headless Chromium, drives it through a script of camera and
// UI states, and writes PNGs to shots/. Used both for eyeballing frames and for
// feeding the visual judge.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const URL_BASE = process.env.MM6_URL || 'http://127.0.0.1:5173/';
const OUT = process.env.MM6_OUT || 'shots';
const SHOT_W = parseInt(process.env.MM6_W || '1280', 10);
const SHOT_H = parseInt(process.env.MM6_H || '960', 10);

// Each entry: [name, jsToRun, settleMs]
const DEFAULT_SCRIPT = [
  ['00-boot', null, 400],
];

async function main() {
  const scriptArg = process.argv[2];
  let script = DEFAULT_SCRIPT;
  if (scriptArg && existsSync(scriptArg)) {
    script = (await import(path.resolve(scriptArg))).default;
  }

  if (existsSync(OUT) && process.env.MM6_CLEAN === '1') rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text', '--force-device-scale-factor=1',
      '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage({ viewport: { width: SHOT_W, height: SHOT_H }, deviceScaleFactor: 1 });
  // Software GL is slow; a frame grab can legitimately take a while.
  page.setDefaultTimeout(120000);

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction('window.__gameReady === true', { timeout: 300000 });
  } catch (e) {
    console.error('!! game never signalled ready');
  }
  await page.waitForTimeout(800);

  for (const [name, js, settle] of script) {
    if (js) {
      try { await page.evaluate(js); } catch (e) { errors.push(`script ${name}: ${e.message}`); }
    }
    await page.waitForTimeout(settle ?? 300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    process.stdout.write(`shot ${name}\n`);
  }

  const fps = await page.evaluate('window.__fps || 0');
  const perf = await page.evaluate(`(window.__perf && JSON.stringify(window.__perf)) || '{}'`);
  console.log('FPS(headless swiftshader, not representative):', fps);
  console.log('PERF:', perf);
  if (errors.length) {
    console.log('\n--- PAGE ERRORS ---');
    for (const e of errors.slice(0, 40)) console.log(e);
    writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
  } else {
    console.log('no page errors');
  }

  await browser.close();
  if (errors.length) process.exitCode = 2;
}

main();
