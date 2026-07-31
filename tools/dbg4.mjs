import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.setDefaultTimeout(120000);
p.on('console', m => { const t=m.text(); if(/no screen|screen|unavailable|fail/i.test(t)) console.log('['+m.type()+']', t.slice(0,200)); });
p.on('pageerror', e => console.log('[PAGEERROR]', e.message.slice(0,200)));
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await p.waitForTimeout(1500);
for (const id of ['charsheet','inventory','spellbook','questlog','mapscreen','quickref','rest','options','title']) {
  const r = await p.evaluate((id) => { try { window.__mm6.open(id); return window.__mm6.screen(); } catch(e){ return 'ERR '+e.message; } }, id);
  console.log(id, '->', r);
  await p.waitForTimeout(300);
}
await p.evaluate(() => window.__mm6.open('charsheet'));
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots/screen-test.png' });
await b.close();
