import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.on('console', m => console.log('['+m.type()+']', m.text().slice(0,300)));
p.on('pageerror', e => console.log('[PAGEERROR]', e.message, '\n', (e.stack||'').split('\n').slice(0,6).join('\n')));
p.on('requestfailed', r => console.log('[REQFAIL]', r.url().slice(0,140), r.failure()?.errorText));
p.on('response', r => { if (r.status() >= 400) console.log('[HTTP', r.status()+']', r.url().slice(0,140)); });
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(60000);
console.log('ready=', await p.evaluate('window.__ready'), 'gameReady=', await p.evaluate('window.__gameReady'));
console.log('startError=', await p.evaluate('window.__startError || null'));
console.log('boot=', await p.evaluate('document.getElementById("boot").style.display'));
await b.close();
