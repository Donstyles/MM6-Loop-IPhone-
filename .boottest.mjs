import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const logs = [];
page.on('console', (m) => logs.push(m.type()[0] + ':' + m.text().slice(0, 160)));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message.slice(0, 200)));
page.on('crash', () => logs.push('*** PAGE CRASHED ***'));
const t0 = Date.now();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
let state = 'unknown';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  try {
    state = await page.evaluate(() => (window.__mm6 && (window.__mm6.state || window.__mm6.phase)) ||
      (document.getElementById('boot') ? document.getElementById('boot').textContent.slice(0,80) : 'no-boot-el'));
  } catch (e) { logs.push('EVAL FAIL @' + i + 's: ' + String(e).slice(0,120)); break; }
  if (/title|ready|play/i.test(String(state))) break;
}
console.log('elapsed', ((Date.now()-t0)/1000).toFixed(0) + 's', 'state:', JSON.stringify(state));
await page.screenshot({ path: 'shots/port/boot.png' });
console.log(logs.slice(-25).join('\n'));
await browser.close();
