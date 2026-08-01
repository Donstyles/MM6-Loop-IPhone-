import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [file, lx, ly, lw, lh] = process.argv.slice(2);
const b64 = fs.readFileSync(file).toString('base64');
const browser = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const out = await page.evaluate(async ([b64, lx, ly, lw, lh]) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(lx*2, ly*2, lw*2, lh*2).data;
  const m = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = '#' + [d[i],d[i+1],d[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
    m.set(k, (m.get(k)||0)+1);
  }
  return [...m].sort((a,b)=>b[1]-a[1]).slice(0,12);
}, [b64, +lx, +ly, +lw, +lh]);
console.log(out.map(([k,v])=>`${k} ${v}`).join('\n'));
await browser.close();
