// Where does the 3D window actually start and stop? Scans a captured frame for
// the first and last column/row that differ from the chrome, in 640x480 frame
// coordinates.
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
const file = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const d = readFileSync(file).toString('base64');
console.log(JSON.stringify(await p.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const s = img.width / 640;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  const at = (x, y) => { const i = ((y * img.width) + x) * 4; return [px[i], px[i+1], px[i+2]]; };
  // Walk a row through the middle of the window and a column through it,
  // reporting where the value stops matching the chrome at the frame edge.
  const midY = Math.round(180 * s), midX = Math.round(240 * s);
  const chrome = at(2, midY);
  const near = (a, b2) => Math.abs(a[0]-b2[0]) + Math.abs(a[1]-b2[1]) + Math.abs(a[2]-b2[2]) < 24;
  let x0 = 0; while (x0 < img.width && near(at(x0, midY), chrome)) x0++;
  let x1 = img.width - 1; while (x1 > 0 && near(at(x1, midY), at(img.width - 2, midY))) x1--;
  let y0 = 0; while (y0 < img.height && near(at(midX, y0), at(midX, 2))) y0++;
  let y1 = img.height - 1; while (y1 > 0 && near(at(midX, y1), at(midX, img.height - 2))) y1--;
  return { scale: s, left: x0 / s, right: (x1 + 1) / s, top: y0 / s, bottom: (y1 + 1) / s,
           w: (x1 + 1 - x0) / s, h: (y1 + 1 - y0) / s };
}, d)));
await b.close();
