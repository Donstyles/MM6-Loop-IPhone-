import { chromium } from '@playwright/test';
const [, , url, outDir] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
console.log('stubbed:', await page.evaluate('window.__stubbed'));
console.log('errors:', JSON.stringify(await page.evaluate('window.__errors')));
const cells = await page.$$('.cell');
for (let i = 0; i < cells.length; i++) {
  const label = await cells[i].$eval('.lbl', (e) => e.textContent);
  await cells[i].screenshot({ path: `${outDir}/cell-${String(i).padStart(2, '0')}.png`, timeout: 60000 });
  console.log(i, label);
}
if (errors.length) console.log('--- console ---\n' + errors.slice(0, 20).join('\n'));
await browser.close();
