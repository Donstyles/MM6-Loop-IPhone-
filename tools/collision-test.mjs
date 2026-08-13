// Collision hardening battery (committed - run against a dev server):
//
//   node tools/collision-test.mjs            (MM6_URL, default :5193)
//
//   1. 16-direction ram at THREE town buildings: footprints reject entry from
//      every angle - no sink-through into the hollow shell (y=-352 void), no
//      ending overlapped with a collider, camera cell always clear.
//   2. 8-direction dungeon ram from the start room.
//   3. Monster bodies BLOCK the party but never TRAP it: walking into a live
//      goblin stops at the body; teleported inside one, the party walks out.
//   4. Projectiles stop at walls: a bolt fired point-blank at a dungeon wall
//      detonates on terrain, never sails through.
//   5. Map-rim walk: the world edge clamps, the party never falls off.

import { chromium } from '@playwright/test';

const URL = process.env.MM6_URL || 'http://127.0.0.1:5193/';
let failures = 0;
function check(name, pass, detail) {
  if (!pass) failures++;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(300000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await page.evaluate(() => window.__mm6.newGame());
await page.waitForTimeout(1200);
const streetSpawn = await page.evaluate(() => window.__session.player.pos.toArray());

/** Sample the party's standing state; every violation is a hard failure. */
const sample = (tag) => page.evaluate((t) => {
  const s = window.__session;
  const p = s.player.pos;
  const R = 56, out = [];
  const g = s.map.groundAt ? s.map.groundAt(p.x, p.z, p.y) : null;
  if (g !== null && p.y < g - 60) out.push(`${t}: sunk y=${p.y | 0} ground=${g | 0} at ${p.x | 0},${p.z | 0}`);
  if (s.map.indoor && s.map.dungeon && s.map.dungeon.floorAt) {
    // Indoors "blocked" includes step risers (y-gated), which a party may
    // legally stand against after dropping a ledge. Overlap means ROCK:
    // a null floor under the body or under any near-camera offset.
    if (s.map.dungeon.floorAt(p.x, p.z) === null) {
      out.push(`${t}: body inside rock at ${p.x | 0},${p.z | 0}`);
    }
    for (const [ox, oz] of [[24, 0], [-24, 0], [0, 24], [0, -24]]) {
      if (s.map.dungeon.floorAt(p.x + ox, p.z + oz) === null) {
        out.push(`${t}: CAMERA against rock face at ${p.x | 0},${p.z | 0}`);
        break;
      }
    }
  } else if (s.map.colliders) {
    // Outdoors map.blocked also folds in the steep-slope rule, and a fall can
    // legally END on a steep face - overlap means the COLLIDER GRID (buildings,
    // walls), so test it directly.
    const grid = s.map.colliders;
    if (grid.blocked(p.x, p.y + 8, p.z, R - 10, 160)) {
      out.push(`${t}: body overlaps solid at ${p.x | 0},${p.z | 0}`);
    }
    if (grid.blocked(p.x, p.y + 150, p.z, 18, 18)) {
      out.push(`${t}: CAMERA inside geometry at ${p.x | 0},${p.z | 0}`);
    }
  }
  return out;
}, tag);

// --- 1. town rams: three buildings, sixteen directions each -----------------
const targets = await page.evaluate(() => {
  const region = window.__session.map.region;
  const town = region && region.towns && region.towns[0];
  const bs = (town && town.buildings) || [];
  const pick = [];
  if (bs.length) {
    const idx = [0, Math.floor(bs.length / 2), bs.length - 1];
    for (const i of new Set(idx)) pick.push({ x: bs[i].x, z: bs[i].z, name: bs[i].name || bs[i].style });
  }
  return pick;
});
check('town has buildings to ram', targets.length >= 3, `${targets.length} targets`);

let violations = [];
for (const [bi, b] of targets.entries()) {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const started = await page.evaluate(({ b2, a2 }) => {
      const s = window.__session;
      // The ring spot must itself be FREE - a neighbouring building's box is
      // not a failure of THIS building's footprint. Scan outward for air.
      let x = 0, z = 0, free = false;
      for (let d = 950; d <= 1700 && !free; d += 150) {
        x = b2.x + Math.cos(a2) * d; z = b2.z + Math.sin(a2) * d;
        const y0 = s.map.groundAt(x, z, 0);
        free = !s.map.blocked(x, y0 + 8, z, 56, 192);
      }
      if (!free) return false;
      const y = s.map.groundAt(x, z, 0);
      // Face the building centre: yaw such that forward = towards it.
      const yaw = Math.atan2(b2.x - x, b2.z - z) + Math.PI;
      window.__mm6.teleport(x, y, z, yaw);
      window.__mm6.walk(1, 0, 2400);
      return true;
    }, { b2: b, a2: a });
    if (!started) continue;   // fully hemmed in on that bearing: nothing to ram
    for (let t = 0; t < 5; t++) {
      await page.waitForTimeout(500);
      violations.push(...await sample(`bld${bi} dir${k}`));
    }
    const dist = await page.evaluate((b2) => {
      const p = window.__session.player.pos;
      return Math.hypot(p.x - b2.x, p.z - b2.z) | 0;
    }, b);
    if (dist < 120) violations.push(`bld${bi} dir${k}: reached interior (d=${dist})`);
  }
}
check('16-dir ram x3 buildings: no entry from any angle', violations.length === 0,
  violations.length ? violations.slice(0, 6).join(' | ') : '240 samples clean');

// --- 3a. a live monster body blocks the party -------------------------------
await page.evaluate((s0) => {
  // Back to the known-clear street spawn: the rams parked us against a wall.
  const s = window.__session;
  window.__mm6.teleport(s0[0], s.map.groundAt(s0[0], s0[2], s0[1]), s0[2], s.player.yaw);
}, streetSpawn);
const body = await page.evaluate(async () => {
  const s = window.__session;
  const mm = window.__mm6;
  // A calm stand on the street, then a statue-goblin 500u dead ahead.
  const p = s.player.pos;
  // Face down the open street before spawning so the goblin lands in air.
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    let open = true;
    for (let d = 150; d <= 700; d += 100) {
      if (s.map.blocked(p.x - Math.sin(a) * d, p.y + 8, p.z - Math.cos(a) * d, 56, 192)) { open = false; break; }
    }
    if (open) { s.player.yaw = a; break; }
  }
  const e = mm.spawn('GoblinA', 500);
  if (!e) return { spawned: false };
  e.state = 'idle'; e.aggroRange = 0; e.speed = 0; e.think = 1e9;
  const mon = { x: e.pos.x, z: e.pos.z, r: e.radius };
  mm.walk(1, 0, 2200);
  await new Promise((res) => setTimeout(res, 2600));
  const d = Math.hypot(p.x - mon.x, p.z - mon.z);
  // Clean up conservatively, then overlap test: drop the party INTO the body.
  const before = { d, r: mon.r };
  mm.teleport(mon.x, s.map.groundAt(mon.x, mon.z, p.y), mon.z, s.player.yaw);
  mm.walk(-1, 0, 1600);
  await new Promise((res) => setTimeout(res, 2000));
  const dOut = Math.hypot(s.player.pos.x - mon.x, s.player.pos.z - mon.z);
  e.remove = true;
  return { spawned: true, blockedAt: before.d, monR: before.r, escaped: dOut };
});
check('monster body blocks the party', body.spawned && body.blockedAt >= (56 + body.monR * 0.9) - 14,
  `stopped ${body.blockedAt | 0}u from a r=${body.monR | 0} body`);
check('overlapped body never traps (unstick)', body.spawned && body.escaped > 220,
  `walked out to ${body.escaped | 0}u`);

// --- 5. map-rim walk ---------------------------------------------------------
const rim = await page.evaluate(async () => {
  const s = window.__session;
  const half = 128 * 512 * 0.49;
  const z0 = Math.max(-half + 3000, Math.min(half - 3000, s.player.pos.z));
  const x0 = half - 400;
  window.__mm6.teleport(x0, s.map.groundAt(x0, z0, 0) + 5, z0, Math.PI * 1.5); // face +X (outward)
  window.__mm6.walk(1, 0, 3000);
  await new Promise((res) => setTimeout(res, 3400));
  const p = s.player.pos;
  const g = s.map.groundAt(p.x, p.z, p.y);
  return { x: p.x, y: p.y, g, half };
});
check('map rim clamps the party', rim.x <= rim.half + 2 && rim.y >= rim.g - 60,
  `x=${rim.x | 0} (rim ${rim.half | 0}), y=${rim.y | 0} ground=${rim.g | 0}`);

// --- 2. dungeon rams ---------------------------------------------------------
await page.evaluate(() => window.__mm6.dungeon({ id: 'gw', name: 'Goblinwatch', theme: 'castle', rooms: 12, levels: 2 }));
await page.waitForTimeout(6000);
const inDungeon = await page.evaluate(() => window.__session.map.indoor === true);
check('dungeon loaded for ram', inDungeon);

violations = [];
const dstart = await page.evaluate(() => window.__session.player.pos.toArray());
for (let k = 0; k < 8; k++) {
  await page.evaluate(({ s0, yaw }) => {
    window.__mm6.teleport(s0[0], s0[1], s0[2], yaw);
    window.__mm6.walk(1, 0, 3000);
  }, { s0: dstart, yaw: (k * Math.PI) / 4 });
  for (let t = 0; t < 6; t++) {
    await page.waitForTimeout(500);
    violations.push(...await sample(`dng dir${k}`));
  }
}
check('8-dir dungeon ram: no sink, no overlap, camera clear', violations.length === 0,
  violations.length ? violations.slice(0, 6).join(' | ') : '48 samples clean');

// --- 4. projectiles stop at walls ---------------------------------------------
const proj = await page.evaluate(async (s0) => {
  const s = window.__session;
  if (!s.vfx) return { skipped: true };
  window.__mm6.teleport(s0[0], s0[1], s0[2], 0);   // start room: walls nearby
  const p = s.player.pos;
  // Find a heading with a wall inside 2600u at chest height.
  let aim = null;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    for (let d = 200; d <= 2600; d += 80) {
      if (s.map.blocked(p.x + fx * d, p.y + 140, p.z + fz * d, 20, 20)) { aim = { fx, fz, wall: d }; break; }
    }
    if (aim) break;
  }
  if (!aim) return { skipped: true };
  window.__projHit = null;
  const from = { x: p.x, y: p.y + 140, z: p.z };
  s.vfx.projectile('fire_bolt', from, { x: aim.fx, y: 0, z: aim.fz }, {
    speed: 2200, range: 12000,
    onHit: (pos, target) => {
      window.__projHit = {
        d: Math.hypot(pos.x - from.x, pos.z - from.z),
        target: !!target,
      };
    },
  });
  await new Promise((res) => setTimeout(res, 2500));
  return { skipped: false, wall: aim.wall, hit: window.__projHit };
}, dstart);
check('projectile stops at the wall', proj.skipped
  ? false
  : !!proj.hit && proj.hit.d <= proj.wall + 400,
proj.skipped ? 'no wall found to shoot' : (proj.hit ? `wall ~${proj.wall}u, detonated at ${proj.hit.d | 0}u` : 'no detonation recorded'));

check('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
