// Dungeon lighting check.
//
// Enters one dungeon per theme, measures the render target's luminance
// distribution, and asserts the average lands in the legible-but-dark band.
// A screenshot of a black room tells you nothing, so this is the gate.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BAND = [40, 110];
const THEMES = process.argv[2]
  ? process.argv[2].split(',')
  : ['cave', 'crypt', 'sewer', 'temple', 'mine', 'castle', 'tower', 'lair', 'ruins', 'ice', 'volcano'];
const OUT = 'shots/dungeoncheck';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// One page per theme. The software rasteriser does not survive a dozen dungeon
// loads in a single context, and a fresh page also stops one theme's state
// leaking into the next.
let p = null;
async function freshPage() {
  if (p) await p.close();
  p = await b.newPage({ viewport: { width: 1280, height: 960 } });
  p.setDefaultTimeout(300000);
  p.on('pageerror', (e) => console.log('[PAGEERROR]', e.message.slice(0, 300)));
  await p.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
  await p.evaluate(() => window.__mm6.newGame());
  // startGame() sets __gameReady before it finishes generating the opening
  // region; enter a dungeon too early and that load lands on top of it a few
  // seconds later, replacing the frame with a loading screen mid-measurement.
  await p.waitForFunction(
    "window.__session && window.__session.mapId && window.__session.mapId !== 'void'",
    { timeout: 300000 });
  await p.waitForTimeout(500);
}

// Read the whole render target and reduce it to a luminance histogram. Done in
// the page so only a handful of numbers cross the bridge.
async function stats() {
  return p.evaluate(() => {
    const e = window.__engine;
    const gl = e.renderer.getContext();
    const w = e.width, h = e.height;
    const px = new Uint8Array(w * h * 4);
    e.renderer.setRenderTarget(e.rt);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    e.renderer.setRenderTarget(null);
    const hist = new Uint32Array(256);
    let sum = 0, n = 0, black = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      hist[l]++; sum += l; n++;
      if (l < 8) black++;
    }
    let acc = 0, med = 0, p05 = 0, p95 = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (!p05 && acc >= n * 0.05) p05 = i;
      if (!med && acc >= n * 0.5) med = i;
      if (!p95 && acc >= n * 0.95) p95 = i;
    }
    return {
      avg: +(sum / n).toFixed(1), median: med, p05, p95,
      blackPct: +(100 * black / n).toFixed(1),
      probe: window.__mm6.probe(),
      fog: {
        color: e.scene.fog?.color.getHexString(),
        near: e.scene.fog?.near,
        far: e.scene.fog?.far,
      },
      tris: window.__session?.map?.dungeon?.triangles || 0,
      dims: window.__session?.map?.dungeon
        ? [window.__session.map.dungeon.ambientDim, window.__session.map.dungeon.paletteGain]
        : null,
    };
  });
}

const rows = [];
let fail = 0;
for (const theme of THEMES) {
 // Swiftshader occasionally loses the context between pages; one retry.
 for (let attempt = 0; attempt < 3; attempt++) {
  try {
  await freshPage();
  await p.evaluate((t) => window.__mm6.dungeon({
    id: 'dc_' + t, name: t, theme: t, rooms: 14, levels: 2,
  }), theme);
  await p.waitForTimeout(3500);

  // Four vantages: spawn point, a quarter-turn off it, a few steps in, and one
  // framed squarely on the nearest wall torch so the pool can be judged.
  const views = [];
  for (const [label, act] of [
    ['spawn', null],
    ['turn', () => window.__mm6.look(1.1, 0)],
    ['walk', () => window.__mm6.walk(1, 0, 1400)],
    ['torch', () => {
      const d = window.__session.map.dungeon;
      const p0 = window.__session.player.pos;
      let best = null;
      for (const t of d.torches) {
        if (t.kind === 'lava') continue;
        const dist = Math.hypot(t.x - p0.x, t.z - p0.z);
        if (dist > 400 && (!best || dist < best.dist)) best = { t, dist };
      }
      if (!best) return;
      const { t, dist } = best;
      const k = Math.min(0.85, 1100 / dist);
      window.__mm6.teleport(
        t.x + (p0.x - t.x) * k, d.floorAt(t.x + (p0.x - t.x) * k, t.z + (p0.z - t.z) * k) + 160,
        t.z + (p0.z - t.z) * k,
        Math.atan2(t.x - p0.x, t.z - p0.z) + Math.PI);
    }],
  ]) {
    if (act) { await p.evaluate(act); await p.waitForTimeout(label === 'walk' ? 2000 : 700); }
    const s = await stats();
    views.push({ label, ...s });
    await p.screenshot({ path: `${OUT}/${theme}-${label}.png` });
  }

  const avg = views.reduce((a, v) => a + v.avg, 0) / views.length;
  const ok = avg >= BAND[0] && avg <= BAND[1];
  if (!ok) fail++;
  rows.push({ theme, avg: +avg.toFixed(1), views, ok });
  report(
    `${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(8)} avg ${avg.toFixed(1).padStart(6)} ` +
    `dim ${JSON.stringify(views[0].dims)} tris ${views[0].tris}   ` +
    views.map((v) => `${v.label}: avg ${String(v.avg).padStart(5)} med ${String(v.median).padStart(3)} ` +
      `p05 ${String(v.p05).padStart(3)} p95 ${String(v.p95).padStart(3)} blk ${String(v.blackPct).padStart(5)}%`).join('  |  '),
  );
  break;
  } catch (err) {
    console.log(`  retry ${theme} (${attempt + 1}): ${String(err.message).split('\n')[0].slice(0, 90)}`);
    if (attempt === 2) { fail++; rows.push({ theme, avg: 0, views: [], ok: false }); }
  }
 }
}

function report(line) { console.log(line); }

console.log('');
console.log(`band ${BAND[0]}..${BAND[1]}   ${rows.length - fail}/${rows.length} themes pass`);
console.log(`fog ${JSON.stringify(rows[0]?.views[0]?.fog)}`);
await b.close();
process.exit(fail ? 1 : 0);
