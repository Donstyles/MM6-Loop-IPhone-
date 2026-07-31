// Walk every region and report generation time, draw calls and triangles.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ids = ['new_sorpigal','ironfist','free_haven','mist','bootleg_bay','silver_cove','blackshire',
  'white_cap','kriegspire','eel_infested_waters','dragonsand','frozen_highlands','paradise_valley'];
const page = await browser.newPage({ viewport: { width: 460, height: 352 } });
const rows = [];
for (const id of ids) {
  await page.goto(`http://127.0.0.1:5173/tools/preview/world.html?region=${id}`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch { rows.push([id,'TIMEOUT']); continue; }
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => ({ ...window.__stats, chunks: window.__world.stats.chunks, flora: window.__world.stats.floraBatches }));
  rows.push([id, Math.round(s.genMs)+'ms', s.calls+' calls', (s.tris/1000).toFixed(1)+'k tris', s.chunks+' chunks', s.flora+' flora']);
}
for (const t of ['cave','crypt','castle','temple','volcano','ice']) {
  await page.goto(`http://127.0.0.1:5173/tools/preview/world.html?mode=dungeon&theme=${t}`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch { rows.push(['dun:'+t,'TIMEOUT']); continue; }
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => window.__stats);
  rows.push(['dun:'+t, Math.round(s.genMs)+'ms', s.calls+' calls', (s.tris/1000).toFixed(1)+'k tris']);
}
for (const r of rows) console.log(r.join('  |  '));
await browser.close();
