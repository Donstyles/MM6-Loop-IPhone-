// Generic page screenshotter for art previews.
//   node tools/shot.mjs <url> <out.png> [width] [height] [waitMs]
// The page should set window.__ready = true when it has finished drawing.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , url, out, w = '1000', h = '900', waitMs = '500'] = process.argv;
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [w] [h] [waitMs]');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 45000 }); }
catch { console.error('page never set window.__ready'); }
await page.waitForTimeout(+waitMs);
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, fullPage: true });
console.log('wrote', out);
if (errors.length) { console.log('--- errors ---'); errors.slice(0, 30).forEach((e) => console.log(e)); }
await browser.close();
if (errors.length) process.exitCode = 2;
