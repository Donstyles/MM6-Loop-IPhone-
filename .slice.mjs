// Slice the tall preview sheet into readable strips using a headless canvas page.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
const src = process.argv[2], outDir = process.argv[3], rows = +(process.argv[4] || 4);
const b64 = readFileSync(src).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
const parts = await page.evaluate(async ({ b64, rows }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const out = [];
  const h = Math.ceil(img.height / rows);
  for (let i = 0; i < rows; i++) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = Math.min(h, img.height - i * h);
    const g = c.getContext('2d');
    g.drawImage(img, 0, -i * h);
    out.push(c.toDataURL('image/png'));
  }
  return out;
}, { b64, rows });
mkdirSync(outDir, { recursive: true });
const { writeFileSync } = await import('node:fs');
parts.forEach((p, i) => writeFileSync(`${outDir}/part${i}.png`, Buffer.from(p.split(',')[1], 'base64')));
console.log('sliced', parts.length);
await browser.close();
