// Sanity-check the region + dungeon API surface the shell relies on.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5173/tools/preview/world.html?region=new_sorpigal', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
const out = await page.evaluate(async () => {
  const { generateRegion, REGIONS, REGION_IDS } = await import('/src/world/region.js');
  const { generateDungeon } = await import('/src/world/dungeon.js');
  const w = window.__world;
  const r = {};
  r.keys = Object.keys(w).sort().join(',');
  r.dungeon0 = w.dungeons[0] && Object.keys(w.dungeons[0]).sort().join(',');
  r.entrance = w.dungeons[0] && w.dungeons[0].entrance && [w.dungeons[0].entrance.x|0, w.dungeons[0].entrance.y|0, w.dungeons[0].entrance.z|0];
  r.spawn0 = w.spawns[0];
  r.shops = w.towns[0].shops.map((s) => s.kind).join(',');
  r.surface = w.surfaceAt(0, 0);
  r.light = w.lightAt(0, 200, 0);
  r.minimap = !!w.minimap && w.minimap.width;
  // drawMinimap into a throwaway canvas
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  w.drawMinimap(c.getContext('2d'), { x: 0, y: 0, w: 128, h: 128 }, { x: 0, z: 0 }, 16384);
  r.drewMinimap = true;
  // sparse dungeon spec
  const d = generateDungeon({ theme: 'cave' }, 12345);
  r.dungeonKeys = Object.keys(d).sort().join(',');
  r.dungeonRooms = d.rooms.length;
  r.dungeonSpawn = d.spawns[0];
  const d2 = generateDungeon({}, 7);
  r.bareDungeon = d2.rooms.length;
  return r;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
