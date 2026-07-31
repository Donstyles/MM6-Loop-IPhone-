import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.on('pageerror', e => console.log('[PAGEERROR]', e.message));
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
const r = await p.evaluate(async () => {
  const out = {};
  const t0 = performance.now();
  try {
    const m = await import('/src/world/region.js');
    out.regionExports = Object.keys(m).slice(0,20);
    out.regions = Object.keys(m.REGIONS || {}).slice(0,20);
    const t1 = performance.now();
    const reg = await m.generateRegion('new_sorpigal', 1234, null);
    out.genMs = Math.round(performance.now()-t1);
    out.regionKeys = Object.keys(reg);
    out.counts = { flora: reg.flora?.length, props: reg.props?.length, spawns: reg.spawns?.length,
                   towns: reg.towns?.length, dungeons: reg.dungeons?.length, colliders: reg.colliders?.length,
                   npcs: (reg.npcs||reg.npcSpawns||[]).length };
    out.hasGroup = !!(reg.group || reg.terrain?.group);
  } catch (e) { out.error = String(e && e.stack || e).slice(0, 600); }
  out.totalMs = Math.round(performance.now()-t0);
  return out;
});
console.log(JSON.stringify(r, null, 2));
await b.close();
