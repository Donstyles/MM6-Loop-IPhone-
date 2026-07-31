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
  const pal = await import('/src/core/palette.js');
  const tc = await import('/src/art/texcanvas.js');
  const faces = [m.makeFace(1000,{}), m.makeFace(8717,{}), m.makeFace(16434,{})];
  for (const f of faces) m.renderPortrait(f, 'normal');
  // total render
  let t = performance.now();
  for (const f of faces) for (const e of m.EXPRESSIONS) m.renderPortrait(f, e);
  const all = (performance.now()-t)/(3*m.EXPRESSIONS.length);
  // dither alone
  const c = tc.makeCanvas(63,73); const g = c.getContext('2d');
  const img = g.createImageData(63,73);
  for (let i=0;i<img.data.length;i++) img.data[i] = (i*7)&255;
  t = performance.now();
  for (let k=0;k<50;k++) pal.ditherImageData(img, 6);
  const dith = (performance.now()-t)/50;
  // canvas creation
  t = performance.now();
  for (let k=0;k<50;k++) { const cc = tc.makeCanvas(63,73); const gg = cc.getContext('2d',{willReadFrequently:true}); gg.createImageData(63,73); }
  const canv = (performance.now()-t)/50;
  return { perFrameMs:+all.toFixed(1), ditherMs:+dith.toFixed(2), canvasMs:+canv.toFixed(2) };
})));
await browser.close();
