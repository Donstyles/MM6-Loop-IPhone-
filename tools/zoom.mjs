// Magnify a rectangle of a captured PNG with nearest-neighbour, so glyphs and
// single-pixel detail can actually be read.
//   node tools/zoom.mjs <png> <x> <y> <w> <h> [scale] [out]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

const [file, X, Y, W, H, S = 6, OUT = 'shots/zoom.png'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const b64 = readFileSync(file).toString('base64');
const out = await p.evaluate(async ({ d, x, y, w, h, s }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + d;
  await img.decode();
  const k = img.width / 1280;             // captures are 2x the 640-wide frame
  const c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x * 2 * k, y * 2 * k, w * 2 * k, h * 2 * k, 0, 0, w * s, h * s);
  return c.toDataURL('image/png').split(',')[1];
}, { d: b64, x: +X, y: +Y, w: +W, h: +H, s: +S });
writeFileSync(OUT, Buffer.from(out, 'base64'));
console.log('wrote', OUT);
await b.close();
