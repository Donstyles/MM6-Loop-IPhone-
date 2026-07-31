import { chromium } from '@playwright/test';
const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => console.log('[' + m.type() + ']', m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack));
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 30000 }); console.log('READY'); }
catch { console.log('NOT READY'); }
console.log(await page.evaluate(() => document.getElementById('info').textContent));
await browser.close();
