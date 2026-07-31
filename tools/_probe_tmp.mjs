import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://127.0.0.1:5173/tools/preview/portraits.html?sec=none', { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const m = await import('/src/art/portraits.js?probe=' + Math.random());
  const f = m.makeFace(12345, { klass: 'archer', sex: 'f' });
  return { hairName: f.hairName, style: f.hairStyle, hangKeys: Object.keys(f.cut||{}), base: f.hair.base, lite: f.hair.lite };
});
console.log(JSON.stringify(out));
await browser.close();
