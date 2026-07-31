import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => console.log('LOG', m.text().slice(0,200)));
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 120000 }).catch(()=>console.log('NO READY'));
console.log(await page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height);
  return JSON.stringify({ search: location.search, cs, body: document.body.scrollHeight });
}));
await browser.close();
