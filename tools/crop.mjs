import { chromium } from '@playwright/test';
const [, , url, out, x, y, w, h] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 45000 }); } catch {}
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true, clip: { x: +x, y: +y, width: +w, height: +h } });
console.log('wrote', out);
errs.forEach((e) => console.log(e));
await browser.close();
