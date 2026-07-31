// Print window.__diag from a preview page (text diagnostics, no screenshot).
//   node tools/diag.mjs <url>
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://127.0.0.1:5173/tools/preview/diag.html';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 180000 }); }
catch { console.error('!! page never set __ready'); }
console.log(await page.evaluate('window.__diag || document.getElementById("out").textContent'));
errs.slice(0, 20).forEach((e) => console.log(e));
await browser.close();
