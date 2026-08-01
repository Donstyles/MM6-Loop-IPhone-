import { chromium, devices } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
// iPhone-class landscape viewport with touch, no mouse.
const ctx = await b.newContext({
  viewport: { width: 852, height: 393 },
  deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const p = await ctx.newPage();
p.setDefaultTimeout(300000);
p.on('pageerror', e => console.log('[PAGEERROR]', e.message.slice(0,160)));
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await p.waitForTimeout(1200);
console.log('layout:', await p.evaluate(() => JSON.stringify({
  w: window.__mm6.session ? undefined : undefined,
})).catch(()=>'')); 
const lay = await p.evaluate(async () => {
  const m = await import('/src/core/layout.js');
  return JSON.stringify(m.layout);
});
console.log('layout:', lay);
await p.screenshot({ path: 'shots/mobile/01-title.png' });
await p.evaluate(() => window.__mm6.newGame());
// Region generation takes several seconds; a 1.2s wait screenshotted the
// loading plate and reported a perf line with nothing in the scene.
await p.waitForFunction('window.__perf && window.__perf.entities > 0', { timeout: 300000 });
await p.evaluate(() => window.__mm6.setTime(12, 0));
await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/mobile/02-world.png' });
// Drag to look, then tap the HUD.
await p.touchscreen.tap(600, 200);
await p.waitForTimeout(400);
await p.screenshot({ path: 'shots/mobile/03-tap.png' });
await p.evaluate(() => window.__mm6.open('charsheet'));
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots/mobile/04-charsheet.png' });
console.log('perf:', await p.evaluate('JSON.stringify(window.__perf)'));
console.log('frameErrors:', await p.evaluate('JSON.stringify(window.__frameErrors||[])'));
await b.close();
