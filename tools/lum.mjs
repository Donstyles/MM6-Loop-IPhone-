// Luminance statistics over a rectangle of a captured PNG, in frame coordinates
// (the 640x480 logical frame), so measurements match the spec's rects whatever
// scale the capture ran at.
//   node tools/lum.mjs <png> <x> <y> <w> <h>
import { chromium } from '@playwright/test';

const [file, X, Y, W, H] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const buf = (await import('fs')).readFileSync(file).toString('base64');
const out = await p.evaluate(async ({ b64, x, y, w, h }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const s = img.width / 1280;               // captures are 2x the 640-wide frame
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(x * 2 * s, y * 2 * s, Math.max(1, w * 2 * s), Math.max(1, h * 2 * s)).data;
  const lums = [];
  let r = 0, gg = 0, bb = 0;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) {
    lums.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
    r += d[i]; gg += d[i + 1]; bb += d[i + 2];
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  lums.sort((a, c2) => a - c2);
  const n = lums.length;
  const q = (t) => lums[Math.min(n - 1, Math.floor(t * n))];
  return {
    n, colours: seen.size,
    mean: +(lums.reduce((a, c2) => a + c2, 0) / n).toFixed(1),
    median: +q(0.5).toFixed(1), p05: +q(0.05).toFixed(1), p95: +q(0.95).toFixed(1),
    rgb: `#${[r, gg, bb].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`,
  };
}, { b64: buf, x: +X, y: +Y, w: +W, h: +H });
console.log(file.split('/').pop(), JSON.stringify(out));
await b.close();
