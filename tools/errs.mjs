import { chromium } from '@playwright/test';
const url = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
try { await p.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch (e) { errs.push('never ready'); }
const inner = await p.evaluate(() => (window.__errors || []).slice(0, 12));
console.log(errs.join('\n---\n'));
console.log('--- page errors ---');
console.log(inner.join('\n'));
await b.close();
