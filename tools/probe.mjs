import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.setDefaultTimeout(300000);
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await p.evaluate(() => window.__mm6.newGame());
for (const h of [9, 13, 17, 21, 0]) {
  await p.evaluate((hh) => window.__mm6.setTime(hh, 0), h);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => window.__mm6.probe());
  console.log(`${String(h).padStart(2)}:00  sky=${JSON.stringify(r.sky)}  ground=${JSON.stringify(r.ground)}  tint=${r.tint.map(v=>v.toFixed(2)).join(',')}`);
}
await b.close();
