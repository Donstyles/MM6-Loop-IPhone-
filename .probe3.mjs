import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
console.log(JSON.stringify(await page.evaluate(async () => {
  const m = await import('/src/art/portraits.js');
  m.renderPortrait(m.makeFace(1, {}), 'normal');   // warm
  const t0 = performance.now();
  const g = m.buildPortraits([1000, 8717, 16434]);
  let n = 0; const times = [];
  for (;;) { const a = performance.now(); const r = g.next(); const d = performance.now()-a;
    times.push(+d.toFixed(1)); n++; if (r.done) break; }
  const worst = Math.max(...times);
  const total = performance.now() - t0;
  const sh = m.portraitSheet(m.makeFace(1000, {}));
  return { times, steps: n, worstStepMs: +worst.toFixed(1), totalMs: +total.toFixed(0),
    perFrame: +(total / (3*m.EXPRESSIONS.length)).toFixed(1),
    sheet: sh.canvas.width + 'x' + sh.canvas.height, exprs: m.EXPRESSIONS.length };
})));
await browser.close();
