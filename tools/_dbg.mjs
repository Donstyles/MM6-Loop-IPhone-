import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const [, , url, out, w = '1400', h = '1200'] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.route('**/@vite/client', (r) => r.fulfill({ body: 'export {}', contentType: 'application/javascript' }));
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__ready === true', { timeout: 120000 }); } catch { console.log('NOT READY'); }
console.log(await page.evaluate(() => document.getElementById('info').textContent));
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, fullPage: true });
console.log('wrote', out);
if (errs.length) errs.slice(0, 5).forEach((e) => console.log(e));
await browser.close();
