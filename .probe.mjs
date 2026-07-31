import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => console.log('LOG', m.text().slice(0,300)));
await page.setContent('<body></body>');
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const m = await import('/src/art/portraits.js');
  const t0 = performance.now();
  const f = m.makeFace(1000, { klass: 'knight', sex: 'm', age: 'young' });
  let c;
  try { c = m.renderPortrait(f, 'normal'); } catch (e) { return { err: String(e) }; }
  const t1 = performance.now();
  const t2 = performance.now();
  for (let k = 0; k < 8; k++) m.renderPortrait(f, k % 2 ? 'smile' : 'angry');
  const warm = (performance.now() - t2) / 8;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, 63, 73).data;
  const px = (x, y) => { const i = (y * 63 + x) * 4; return [d[i], d[i+1], d[i+2]]; };
  for (const k in m.__t) m.__t[k] = +(m.__t[k]/9).toFixed(1);
  return { t: m.__t, ms: +(t1-t0).toFixed(1), warm: +warm.toFixed(1), fx: +(f.geom.headCX + f.geom.turn*f.geom.rx).toFixed(1),
    rx: +f.geom.rx.toFixed(1), ry: +f.geom.ry.toFixed(1), top: +f.geom.headTop.toFixed(1),
    hair: f.hairStyle, gear: Object.keys(f.gear).filter(k=>f.gear[k]&&k!=='steel'&&k!=='hairVisible'),
    s: { fore: px(30,18), cheekL: px(22,36), cheekR: px(40,36), eyeL: px(24,29), nose: px(30,38),
         mouth: px(30,45), neck: px(31,58), corner: px(2,2), chin: px(30,50) } };
});
console.log(JSON.stringify(out));
await browser.close();
