// Screenshot one preview cell by index, at 1:1. Usage:
//   node tools/cell.mjs <url> <out.png> <index> [cols]
import { chromium } from '@playwright/test';

const [, , url, out, idxRaw] = process.argv;
const idx = +idxRaw;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch {}
await page.waitForTimeout(200);
const cells = await page.$$('.cell');
if (!cells[idx]) { console.log('no cell', idx, 'of', cells.length); }
else await cells[idx].screenshot({ path: out });
console.log('wrote', out, 'of', cells.length, 'cells');
errs.forEach((e) => console.log(e));
await browser.close();
