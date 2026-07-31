import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const [, , url, out, w = '1300', h = '5200'] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
try { await page.waitForFunction('window.__ready === true', { timeout: 180000 }); }
catch { console.error('never ready'); }
await page.waitForTimeout(400);
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, fullPage: true });
console.log('wrote', out);
logs.forEach((l) => console.log(l));
await browser.close();
