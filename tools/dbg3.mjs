import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.on('pageerror', e => console.log('[PAGEERROR]', e.message));
p.on('console', m => { const t=m.text(); if (m.type()==='error'||/fail|unavailable/i.test(t)) console.log('['+m.type()+']', t.slice(0,220)); });
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
for (let i=0;i<40;i++) {
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => ({
    gameReady: !!window.__gameReady,
    perf: window.__perf,
    err: window.__startError ? String(window.__startError).slice(0,200) : null,
  }));
  console.log(`t=${(i+1)*5}s`, JSON.stringify(s));
  if (s.gameReady || s.err) break;
}
await p.screenshot({ path: 'shots/live.png' });
await b.close();
