import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.on('pageerror', e => console.log('[PAGEERROR]', e.message.slice(0,160)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,180)); });
await p.goto('http://127.0.0.1:5174/?skip=portraits,sprites', { waitUntil:'domcontentloaded' });
const t0 = Date.now();
try { await p.waitForFunction('window.__gameReady === true', { timeout: 420000 }); }
catch { console.log('TIMEOUT'); }
console.log('boot seconds:', ((Date.now()-t0)/1000).toFixed(1));
console.log('stages:', await p.evaluate('JSON.stringify(window.__bootTimes||{})'));
await p.waitForTimeout(2000);
console.log('perf:', await p.evaluate('JSON.stringify(window.__perf)'));
await p.evaluate(() => window.__mm6.open('charsheet'));
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots/scr-charsheet.png' });
await p.evaluate(() => window.__mm6.open('spellbook'));
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots/scr-spellbook.png' });
await p.evaluate(() => window.__mm6.close());
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots/scr-world.png' });
await b.close();
