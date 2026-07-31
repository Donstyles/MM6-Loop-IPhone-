// Numeric sanity checks the coordinator asked for.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/tools/preview/world.html?region=new_sorpigal', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(async () => {
  const out = {};
  const w = window.__world;
  // Flat-ground vertex colour across the day (linear -> sRGB percentage).
  const lin2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const flat = [];
  for (const h of [7, 9.5, 13, 17, 19, 22]) {
    w.setTimeOfDay(h);
    // find the flattest chunk face
    let best = 0;
    for (const c of w.terrain.chunks) {
      const f = c.faces, a = c.mesh.geometry.attributes.color.array;
      for (let t = 0; t < f.length / 5; t++) if (f[t * 5 + 4] > 0.999) { best = Math.max(best, a[t * 9]); }
    }
    flat.push(h + 'h:' + (lin2s(best) * 100).toFixed(0) + '%');
  }
  out.flatGroundVsRawTexture = flat.join(' ');
  // fraction-of-day argument must not be read as an hour
  w.setTimeOfDay(0.5);
  let f2 = 0;
  for (const c of w.terrain.chunks) {
    const f = c.faces, a = c.mesh.geometry.attributes.color.array;
    for (let t = 0; t < f.length / 5; t++) if (f[t * 5 + 4] > 0.999) f2 = Math.max(f2, a[t * 9]);
  }
  out.fraction0p5 = (lin2s(f2) * 100).toFixed(0) + '%';
  w.setTimeOfDay(13);
  // exact dungeon call from the shell
  const { generateDungeon } = await import('/src/world/dungeon.js');
  try {
    const d = generateDungeon({ id: 'goblinwatch', name: 'Goblinwatch', theme: 'castle', rooms: 12, levels: 2 }, 4242, null);
    out.dungeon = `ok rooms=${d.rooms.length} torches=${d.torches.length} chests=${d.chests.length} spawns=${d.spawns.length} tris=${d.triangles}`;
    out.dungeonApi = ['floorAt','ceilAt','blocked','lightAt','surfaceAt','drawMinimap','start','chests','spawns','props']
      .map((k) => k + (d[k] !== undefined ? '+' : '-')).join(' ');
  } catch (e) { out.dungeon = 'THREW ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]; }
  return out;
}), null, 1));
await browser.close();
