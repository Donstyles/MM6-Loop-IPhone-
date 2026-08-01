// Crop a captured PNG by LOGICAL 640x480 frame coords and rescale.
//   node cropf.mjs <png> <out> <x> <y> <w> <h> [scale]
import { chromium } from '@playwright/test';
import fs from 'fs';

const [file, out, X, Y, W, H, S] = process.argv.slice(2);
const scale = +(S || 3);
const b = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const buf = fs.readFileSync(file).toString('base64');
const data = await p.evaluate(async ({ b64, x, y, w, h, k }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const s = img.width / 640;
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  src.getContext('2d').drawImage(img, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = Math.round(w * k); dst.height = Math.round(h * k);
  const g = dst.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, x * s, y * s, w * s, h * s, 0, 0, dst.width, dst.height);
  return dst.toDataURL('image/png').split(',')[1];
}, { b64: buf, x: +X, y: +Y, w: +W, h: +H, k: scale });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log('wrote', out);
await b.close();
