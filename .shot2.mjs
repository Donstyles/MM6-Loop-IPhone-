import { chromium } from '@playwright/test';
const [, , url, out, w = '1300', h = '1000'] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
console.log('stubbed:', await page.evaluate('window.__stubbed'));
console.log('errors:', JSON.stringify(await page.evaluate('window.__errors'), null, 1));
const box = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
console.log('page box', box);
await page.screenshot({ path: out, fullPage: true, timeout: 120000 });
console.log('wrote', out);
if (errors.length) console.log('--- console ---\n' + errors.slice(0, 20).join('\n'));
await browser.close();
