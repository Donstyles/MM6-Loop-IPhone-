import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/tools/preview/portraits.html?sec=none', { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const m = await import('/src/art/portraits.js');
  const f = m.makeFace(1000, { klass: 'knight', sex: 'm', age: 'young' });
  const c = m.renderPortrait(f, 'normal');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, 63, 73).data;
  const px = (x, y) => { const i = (y * 63 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  return {
    geom: f.geom, gear: JSON.parse(JSON.stringify(f.gear)),
    hair: f.hairStyle, skin: f.skin,
    samples: {
      centre: px(31, 36), lEye: px(26, 31), rEye: px(37, 31),
      nose: px(31, 40), mouth: px(31, 46), forehead: px(31, 22),
      corner: px(2, 2), topmid: px(31, 4), chin: px(31, 52),
    },
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
