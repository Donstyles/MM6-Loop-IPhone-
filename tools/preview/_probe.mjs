import { chromium } from '@playwright/test';
const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.on('console', (m) => console.log(m.text().slice(0, 600)));
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 }).catch(()=>console.log('no ready'));
await page.waitForTimeout(800);
console.log(JSON.stringify(await page.evaluate(() => window.__stats)));
await browser.close();
