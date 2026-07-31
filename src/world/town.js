import * as THREE from 'three';
import { Rand, clamp, smoothstep, lerpN } from '../core/rng.js';
import {
  heightAt, flattenArea, carveRoad, stampTiles, makeBillboardField, floraTexture,
} from './terrain.js';
import { buildHouse, buildWall, buildBridge, MeshBuilder, addProp, materialFor } from './building.js';

// ---------------------------------------------------------------------------
// Towns.
//
// MM6 towns are small and legible: a main street, a plaza with a well, shops
// with signboards fronting the road, houses behind them with fenced gardens,
// and for the bigger settlements a wall with a gate on each road. The player
// should be able to learn the layout in one visit, so the generator lays down
// a road skeleton first and hangs everything off it, rather than scattering
// buildings and hoping.
// ---------------------------------------------------------------------------

/** Shop kinds MM6 has in most towns, in the order they get the best plots. */
export const SHOP_KINDS = [
  { kind: 'tavern', style: 'tavern', label: 'Tavern', names: ['The Laughing Goblin', 'The Silver Helm', 'The Broken Oar', 'The Gilded Cask', 'The Weary Pilgrim', 'The Dragon\'s Rest'] },
  { kind: 'weapon', style: 'smithy', label: 'Weapon Smith', names: ['Steel & Sons', 'The Keen Edge', 'Hammerfall Arms', 'Ironmonger\'s'] },
  { kind: 'armour', style: 'smithy', label: 'Armourer', names: ['Plate & Mail', 'The Iron Shell', 'Bulwark Armoury'] },
  { kind: 'magic', style: 'shop', label: 'Magic Shop', names: ['Sigil & Scroll', 'The Arcanum', 'Wand and Word'] },
  { kind: 'alchemist', style: 'shop', label: 'Alchemist', names: ['The Green Flask', 'Mortar & Pestle', 'Hedge & Root'] },
  { kind: 'temple', style: 'temple', label: 'Temple', names: ['Temple of the Sun', 'Shrine of the Dawn', 'House of Healing'] },
  { kind: 'training', style: 'guild', label: 'Training Hall', names: ['Hall of Arms', 'The Proving Yard', 'Master\'s Hall'] },
  { kind: 'townhall', style: 'manor', label: 'Town Hall', names: ['Town Hall', 'The Moot House', 'Council Hall'] },
  { kind: 'bank', style: 'guild', label: 'Bank', names: ['The Strongbox', 'Coin & Ledger', 'Vault of Erathia'] },
  { kind: 'stable', style: 'stable', label: 'Stables', names: ['Post Stables', 'The Coach House'] },
];

export const GUILD_SCHOOLS = ['fire', 'air', 'water', 'earth', 'spirit', 'mind', 'body', 'light', 'dark'];
const GUILD_NAME = {
  fire: 'Guild of Fire Magic', air: 'Guild of Air Magic', water: 'Guild of Water Magic',
  earth: 'Guild of Earth Magic', spirit: 'Guild of the Spirit', mind: 'Guild of the Mind',
  body: 'Guild of the Body', light: 'Temple of Light', dark: 'Circle of the Dark',
};

const HOUSE_STYLES_BY_SIZE = {
  village: ['cottage', 'hut', 'cottage', 'longhouse', 'cottage'],
  town: ['townhouse', 'cottage', 'townhouse', 'shop', 'warehouse'],
  city: ['townhouse', 'townhouse', 'manor', 'shop', 'warehouse', 'townhouse'],
};

const NPC_ARCHETYPES = [
  'peasant', 'merchant', 'guard', 'child', 'beggar', 'noble', 'sailor',
  'monk', 'apprentice', 'blacksmith', 'farmer', 'townsfolk',
];

const TOWN_SIZES = {
  village: { radius: 2400, plots: 14, wall: false, guilds: 0, lanes: 1 },
  town: { radius: 3800, plots: 26, wall: true, guilds: 3, lanes: 2 },
  city: { radius: 5600, plots: 40, wall: true, guilds: 6, lanes: 3 },
};

/**
 * @param {object} spec { name, size, x, z, hm, coastal, region, wall, seed }
 * @param {number|string} seed
 */
export function generateTown(spec = {}, seed = 1) {
  const r = new Rand(typeof seed === 'string' ? seed : (seed >>> 0) ^ 0x51ed);
  const size = TOWN_SIZES[spec.size] ? spec.size : 'town';
  const S = TOWN_SIZES[size];
  const hm = spec.hm || null;
  const cx = spec.x || 0, cz = spec.z || 0;
  const R = spec.radius || S.radius;
  const name = spec.name || 'Nameless';
  const roadTex = spec.roadTex || (size === 'village' ? 'road_dirt' : 'road_cobble');
  const wantWall = spec.wall !== undefined ? spec.wall : S.wall;

  // --- ground -------------------------------------------------------------
  // Towns sit on a level shelf. MM6 towns are perfectly flat; sloping ground
  // under a rectangular building looks broken and no amount of skirting hides
  // it, so we simply cut the shelf.
  const baseY = hm ? heightAt(hm, cx, cz) : 0;
  if (hm) {
    flattenArea(hm, cx, cz, R * 0.92, baseY, 1.45);
    stampTiles(hm, cx, cz, R, R, spec.groundTex || 'dirt',
      (x, z) => Math.hypot(x - cx, z - cz) < R * 0.86);
  }

  // --- road skeleton ------------------------------------------------------
  const roads = [];
  const mainW = size === 'village' ? 620 : 820;
  const laneW = 520;
  const ext = R * 1.02;
  roads.push({ points: [{ x: cx - ext, z: cz }, { x: cx + ext, z: cz }], width: mainW, tex: roadTex, main: true });
  roads.push({ points: [{ x: cx, z: cz - ext }, { x: cx, z: cz + ext }], width: mainW, tex: roadTex, main: true });
  for (let i = 0; i < S.lanes; i++) {
    const off = (i + 1) * (R / (S.lanes + 1)) * (r.bool() ? 1 : -1) * (i % 2 ? -1 : 1);
    const horiz = i % 2 === 0;
    const half = Math.sqrt(Math.max(1, R * R - off * off)) * 0.92;
    roads.push(horiz
      ? { points: [{ x: cx - half, z: cz + off }, { x: cx + half, z: cz + off }], width: laneW, tex: roadTex }
      : { points: [{ x: cx + off, z: cz - half }, { x: cx + off, z: cz + half }], width: laneW, tex: roadTex });
  }

  const plazaR = size === 'village' ? 700 : size === 'town' ? 950 : 1250;
  if (hm) {
    for (const rd of roads) carveRoad(hm, rd.points, { width: rd.width, tex: rd.tex });
    stampTiles(hm, cx, cz, plazaR, plazaR, roadTex, (x, z) => Math.hypot(x - cx, z - cz) < plazaR);
  }

  // --- plots along the roads ---------------------------------------------
  // Walk each street and drop alternating left/right plots, skipping anything
  // that would land in the plaza or overlap a plot already taken.
  const plots = [];
  const taken = [];
  const fits = (x, z, rad) => {
    if (Math.hypot(x - cx, z - cz) < plazaR + rad * 0.7) return false;
    if (Math.hypot(x - cx, z - cz) > R * 0.94) return false;
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < rad + t.r) return false;
    return true;
  };

  for (const rd of roads) {
    const a = rd.points[0], b2 = rd.points[1];
    const dx = b2.x - a.x, dz = b2.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const px = -uz, pz = ux;                      // road normal
    const spacing = rd.main ? 1080 : 980;
    const setback = rd.width / 2 + 460;
    const n = Math.floor(len / spacing);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      for (const sgn of [1, -1]) {
        const bx = a.x + dx * t + px * setback * sgn;
        const bz = a.z + dz * t + pz * setback * sgn;
        const rad = 520;
        if (!fits(bx, bz, rad)) continue;
        // Front of the building (local +Z) must look at the road.
        const rot = Math.atan2(-px * sgn, -pz * sgn);
        plots.push({ x: bx, z: bz, rot, dist: Math.hypot(bx - cx, bz - cz), main: !!rd.main });
        taken.push({ x: bx, z: bz, r: rad });
      }
    }
  }
  // Best plots first: on the main street and close to the plaza.
  plots.sort((p, q) => (p.dist - (p.main ? 900 : 0)) - (q.dist - (q.main ? 900 : 0)));

  // --- buildings ----------------------------------------------------------
  const master = new MeshBuilder();
  const buildings = [];
  const shops = [];
  const doors = [];
  const colliders = [];
  const props = [];

  const guilds = r.shuffle(GUILD_SCHOOLS.slice()).slice(0, S.guilds);
  const wanted = SHOP_KINDS
    .filter((s) => size !== 'village' || ['tavern', 'temple', 'weapon', 'stable'].includes(s.kind))
    .map((s) => ({ ...s, name: r.pick(s.names) }))
    .concat(guilds.map((g) => ({ kind: 'guild_' + g, style: 'guild', label: GUILD_NAME[g], name: GUILD_NAME[g], school: g })));

  const houseStyles = HOUSE_STYLES_BY_SIZE[size];
  const nBuild = Math.min(plots.length, S.plots);
  for (let i = 0; i < nBuild; i++) {
    const p = plots[i];
    const shop = i < wanted.length ? wanted[i] : null;
    const style = shop ? shop.style : r.pick(houseStyles);
    const y = hm ? heightAt(hm, p.x, p.z) : baseY;
    const h = buildHouse({
      style, x: p.x, y, z: p.z, rot: p.rot,
      seed: r.int(1e9), sign: !!shop, lit: spec.night || false,
      name: shop ? shop.name : null,
      shop: shop ? shop.kind : null,
      doorKind: shop ? 'shop' : 'house',
    }, r);
    master.absorb(h.parts);
    for (const dm of h.doors) doors.push(dm);
    for (const c of h.colliders) colliders.push(c);
    const idx = buildings.length;
    buildings.push({
      index: idx, style, x: p.x, y, z: p.z, rot: p.rot,
      name: shop ? shop.name : null, shop: shop ? shop.kind : null,
      bounds: h.bounds, height: h.height, footprint: h.footprint,
    });
    if (shop) {
      shops.push({
        kind: shop.kind, label: shop.label, name: shop.name,
        school: shop.school || null,
        buildingIndex: idx,
        door: h.doors[0] ? h.doors[0].position.clone() : new THREE.Vector3(p.x, y, p.z),
      });
    }

    // Garden behind the house: a fence run and something growing.
    if (!shop && r.bool(0.55)) {
      const back = 560;
      const bx = p.x - Math.sin(p.rot) * back, bz = p.z - Math.cos(p.rot) * back;
      for (let f = -1; f <= 1; f++) {
        addProp(master, 'fence', bx + Math.cos(p.rot) * f * 400, hm ? heightAt(hm, bx, bz) : baseY,
          bz - Math.sin(p.rot) * f * 400, p.rot, r);
      }
      props.push({ kind: r.pick(['flowers', 'bush', 'tree']), x: bx, z: bz, y: hm ? heightAt(hm, bx, bz) : baseY, scale: r.float(0.8, 1.2) });
    }
  }

  // --- plaza dressing -----------------------------------------------------
  const centrepiece = size === 'city' ? 'fountain' : 'well';
  addProp(master, centrepiece, cx, baseY, cz, r.float(0, 6.28), r);
  props.push({ kind: centrepiece, x: cx, y: baseY, z: cz });

  const stallCount = size === 'village' ? 2 : size === 'town' ? 4 : 7;
  for (let i = 0; i < stallCount; i++) {
    const a = (i / stallCount) * Math.PI * 2 + r.float(-0.2, 0.2);
    const rr = plazaR * r.float(0.55, 0.82);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    addProp(master, 'stall', x, baseY, z, -a + Math.PI / 2, r);
    props.push({ kind: 'stall', x, y: baseY, z });
  }
  for (let i = 0; i < (size === 'village' ? 3 : 8); i++) {
    const a = r.float(0, 6.283), rr = plazaR * r.float(0.85, 0.98);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    addProp(master, 'bench', x, baseY, z, -a, r);
  }

  // Lampposts and clutter down the main streets.
  for (const rd of roads) {
    const a = rd.points[0], b2 = rd.points[1];
    const dx = b2.x - a.x, dz = b2.z - a.z;
    const len = Math.hypot(dx, dz);
    const step = rd.main ? 900 : 1300;
    const n = Math.floor(len / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + dx * t - (dz / len) * (rd.width / 2 + 90);
      const z = a.z + dz * t + (dx / len) * (rd.width / 2 + 90);
      if (Math.hypot(x - cx, z - cz) < plazaR * 0.8) continue;
      const y = hm ? heightAt(hm, x, z) : baseY;
      addProp(master, 'lamppost', x, y, z, 0, r);
      props.push({ kind: 'lamppost', x, y, z });
    }
  }
  for (let i = 0; i < (size === 'city' ? 26 : 14); i++) {
    const a = r.float(0, 6.283), rr = r.float(plazaR, R * 0.9);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    let clear = true;
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < 620) { clear = false; break; }
    if (!clear) continue;
    const kind = r.pick(['barrel', 'crate', 'cart', 'haystack', 'flowerbed', 'signpost', 'barrel']);
    const y = hm ? heightAt(hm, x, z) : baseY;
    addProp(master, kind, x, y, z, r.float(0, 6.283), r);
    props.push({ kind, x, y, z });
  }

  // --- town wall ----------------------------------------------------------
  const entrances = [];
  let wall = null;
  if (wantWall) {
    const W = R * 0.98;
    const pts = [
      { x: cx - W, z: cz - W }, { x: cx + W, z: cz - W },
      { x: cx + W, z: cz + W }, { x: cx - W, z: cz + W }, { x: cx - W, z: cz - W },
    ];
    // A gate in the middle of each side, where the two main streets cross out.
    const gates = [0, 1, 2, 3].map((i) => ({ seg: i, t: 0.5, w: 700 }));
    wall = buildWall({
      points: pts, gates, y: baseY, height: size === 'city' ? 760 : 620,
      tex: spec.wallTex || 'wall_castle',
      towers: pts.slice(0, 4).map((p) => ({ x: p.x, z: p.z, w: 340 })),
      seed: r.int(1e9),
    }, r);
    master.absorb(wall.parts);
    for (const c of wall.colliders) colliders.push(c);
    for (const g of wall.gates) entrances.push({ x: g.x, z: g.z, y: baseY, kind: 'gate' });
  } else {
    entrances.push(
      { x: cx + R, z: cz, y: baseY, kind: 'road' }, { x: cx - R, z: cz, y: baseY, kind: 'road' },
      { x: cx, z: cz + R, y: baseY, kind: 'road' }, { x: cx, z: cz - R, y: baseY, kind: 'road' },
    );
  }

  // --- docks --------------------------------------------------------------
  if (spec.coastal && hm) {
    // Find the nearest water in a ring and run a jetty out to it.
    let best = null;
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      for (let d = R * 0.8; d < R * 2.2; d += 300) {
        const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
        if (heightAt(hm, x, z) < hm.water) { if (!best || d < best.d) best = { x, z, d, ang }; break; }
      }
    }
    if (best) {
      const sx = cx + Math.cos(best.ang) * (best.d - 500), sz = cz + Math.sin(best.ang) * (best.d - 500);
      const ex = cx + Math.cos(best.ang) * (best.d + 1300), ez = cz + Math.sin(best.ang) * (best.d + 1300);
      const br = buildBridge({ from: { x: sx, z: sz }, to: { x: ex, z: ez }, y: hm.water + 90, width: 380, arch: 0, seed: r.int(1e9) }, r);
      master.absorb(br.parts);
      for (let i = 0; i < 4; i++) {
        const t = r.float(0.1, 0.9);
        addProp(master, r.bool() ? 'barrel' : 'crate',
          lerpN(sx, ex, t) + r.float(-140, 140), hm.water + 95, lerpN(sz, ez, t) + r.float(-140, 140), r.float(0, 6.28), r);
      }
      entrances.push({ x: ex, z: ez, y: hm.water + 90, kind: 'dock' });
      props.push({ kind: 'dock', x: ex, y: hm.water + 90, z: ez });
    }
  }

  // --- npc spawns ---------------------------------------------------------
  const npcSpawns = [];
  const nNpc = size === 'village' ? 6 : size === 'town' ? 12 : 20;
  for (let i = 0; i < nNpc; i++) {
    const onPlaza = i < nNpc * 0.4;
    const rd = r.pick(roads);
    let x, z;
    if (onPlaza) {
      const a = r.float(0, 6.283), rr = r.float(0, plazaR * 0.8);
      x = cx + Math.cos(a) * rr; z = cz + Math.sin(a) * rr;
    } else {
      const t = r.float(0.12, 0.88);
      x = lerpN(rd.points[0].x, rd.points[1].x, t) + r.float(-160, 160);
      z = lerpN(rd.points[0].z, rd.points[1].z, t) + r.float(-160, 160);
    }
    const y = hm ? heightAt(hm, x, z) : baseY;
    // Short patrol along the nearest street so townsfolk pace rather than wander.
    const patrol = [];
    const pr = r.pick(roads);
    const t0 = r.float(0.15, 0.6);
    for (let k = 0; k < 3; k++) {
      const t = clamp(t0 + k * 0.14, 0.05, 0.95);
      patrol.push({
        x: lerpN(pr.points[0].x, pr.points[1].x, t) + r.float(-120, 120),
        z: lerpN(pr.points[0].z, pr.points[1].z, t) + r.float(-120, 120),
      });
    }
    npcSpawns.push({
      x, y, z, archetype: r.pick(NPC_ARCHETYPES), patrol,
      speed: r.float(90, 160), pause: r.float(1.5, 5),
    });
  }

  // --- assemble -----------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'town:' + name;
  const mesh = master.finish();
  if (mesh) { mesh.updateMatrix(); group.add(mesh); }
  for (const dm of doors) group.add(dm);

  // Trees around the edges, drawn as one instanced billboard batch.
  const treeInst = [];
  for (let i = 0; i < (size === 'village' ? 22 : 36); i++) {
    const a = r.float(0, 6.283), rr = r.float(R * 0.55, R * 1.05);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    let clear = true;
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < 700) { clear = false; break; }
    if (!clear) continue;
    const s = r.float(700, 1150);
    treeInst.push({ x, y: hm ? heightAt(hm, x, z) : baseY, z, w: s * 0.9, h: s, tint: [r.float(0.86, 1.08), r.float(0.9, 1.06), r.float(0.86, 1.0)] });
  }
  const trees = treeInst.length
    ? makeBillboardField(floraTexture(spec.treeKind || 'tree', 5), treeInst, {
      fogColor: spec.fogColor || 0x9ab4cc, fogNear: spec.fogNear || 1400, fogFar: spec.fogFar || 6000,
    })
    : null;
  if (trees) group.add(trees);

  return {
    group, name, size,
    x: cx, z: cz, y: baseY, radius: R,
    buildings, props, npcSpawns, shops, roads, colliders, doors,
    entrances, plaza: { x: cx, z: cz, radius: plazaR },
    trees,
    bounds: { x: cx, z: cz, radius: R * 1.1, y: baseY },
    update(camera) { if (trees) trees.userData.updateBillboard(camera); },
  };
}
