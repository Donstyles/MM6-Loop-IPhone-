// Dump the automap plate and a drawMinimap crop so they can be eyeballed.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('http://127.0.0.1:5173/tools/preview/world.html?region=new_sorpigal', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
const b64 = await page.evaluate(() => {
  const w = window.__world;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(w.minimap, 0, 0, 256, 256);
  const t = w.towns[0];
  w.drawMinimap(g, { x: 256, y: 0, w: 256, h: 256 }, { x: t.x, z: t.z }, 16384);
  g.strokeStyle = '#fff'; g.strokeRect(256, 0, 256, 256);
  return c.toDataURL().slice(22);
});
writeFileSync('shots/world/_minimap.png', Buffer.from(b64, 'base64'));
console.log('wrote shots/world/_minimap.png');
await browser.close();
