import * as THREE from 'three';
import {
  Pix, toTexture, grainFill, blotch, cracks, speckle, bricks, planks,
  rampSample, mixC, scaleC,
} from '../art/texcanvas.js';
import {
  fbm2, ridged2, gradNoise2, valueNoise2, hash2, Rand, clamp, smoothstep, lerpN,
} from '../core/rng.js';
import { quantiseShade, sunDirection, sunTerms, timeTint, FAR_CLIP } from './sky.js';

// ---------------------------------------------------------------------------
// Outdoor terrain.
//
// MM6 outdoor maps are a 128x128 grid of 512-unit tiles. Each tile carries one
// texture with a *hard* edge against its neighbours - there is no splatting,
// and reproducing that hard edge is most of the game's outdoor character. The
// heightfield is lit once at load time into vertex colours by a fixed sun, and
// drawn with no runtime lights at all, which is why MM6 ran on a Pentium.
//
// We keep that model exactly: per-tile quads with their own UVs, per-vertex
// baked light shared across tile seams (so lighting is smooth while textures
// are chunky), chunked into 8x8-tile blocks for frustum and fog culling.
// ---------------------------------------------------------------------------

export const TILE = 512;
export const MAP_TILES = 128;
/** MM6 stores height as a byte scaled by 32, so terrain steps in 32-unit rungs. */
export const HEIGHT_QUANTUM = 32;
/** maxPartyAxisDistance: the outer ring of the 128x128 grid is unreachable. */
export const PLAYABLE_EXTENT = 22528;

// --- texture access with a permanent local fallback ------------------------
//
// src/art/textures.js is owned by another module and may not exist yet (or may
// not know an id we ask for). Rather than hard-fail, every lookup falls back to
// a locally painted stand-in. The fallback stays in the shipped game: a missing
// texture should degrade to "slightly wrong colour", never to a crash.

let TEXMOD = null;

export const texturesReady = (async () => {
  try {
    // Indirect specifier so a bundler cannot make this a hard dependency.
    const spec = '../art/' + 'textures.js';
    const m = await import(/* @vite-ignore */ spec);
    if (m && typeof m.getTex === 'function') TEXMOD = m;
  } catch (err) {
    TEXMOD = null;
  }
  return TEXMOD;
})();

/** True once the real texture module has been probed for. */
export function texturesAvailable() { return TEXMOD !== null; }

const _fallbackCache = new Map();
const _repeatCache = new Map();

/**
 * Look up a game texture by id.
 * @param {string} id one of the TEXTURE_IDS
 * @param {{repeat?:[number,number]}} [opts]
 */
export function getTexture(id, opts = {}) {
  const rx = opts.repeat ? opts.repeat[0] : 1;
  const ry = opts.repeat ? opts.repeat[1] : 1;
  const key = `${id}|${rx}|${ry}`;
  const hit = _repeatCache.get(key);
  if (hit) return hit;

  let base = null;
  if (TEXMOD) {
    try { base = TEXMOD.getTex(id); } catch (e) { base = null; }
  }
  if (!base) base = fallbackTexture(id);

  let tex = base;
  if (rx !== 1 || ry !== 1) {
    tex = base.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
  }
  _repeatCache.set(key, tex);
  return tex;
}

/** Average colour of a texture id, useful for fog/minimap tinting. */
export function textureTint(id) {
  const s = FALLBACK[id] || FALLBACK.grass;
  const c = rampSample(s.ramp, (s.lo + s.hi) * 0.5);
  return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
}

// Painted stand-ins. Deliberately simple - the real module does the good work -
// but varied enough that a region still reads as a landscape without it.
const FALLBACK = {
  grass: { k: 'grain', ramp: 'grass', lo: 0.30, hi: 0.80, period: 10, blot: 0.28 },
  grass_dry: { k: 'grain', ramp: 'swamp', lo: 0.34, hi: 0.82, period: 9, blot: 0.22 },
  grass_lush: { k: 'grain', ramp: 'grass', lo: 0.38, hi: 0.95, period: 12, blot: 0.30 },
  dirt: { k: 'grain', ramp: 'dirt', lo: 0.26, hi: 0.70, period: 8, speck: 200 },
  mud: { k: 'grain', ramp: 'dirt', lo: 0.16, hi: 0.48, period: 6, blot: 0.35 },
  road_dirt: { k: 'grain', ramp: 'dirt', lo: 0.34, hi: 0.66, period: 14, speck: 300 },
  road_cobble: { k: 'cobble', ramp: 'stone', lo: 0.30, hi: 0.72 },
  sand: { k: 'grain', ramp: 'sand', lo: 0.44, hi: 0.92, period: 14, speck: 240 },
  sand_dune: { k: 'grain', ramp: 'sand', lo: 0.52, hi: 0.98, period: 5 },
  snow: { k: 'grain', ramp: 'ice', lo: 0.66, hi: 1.00, period: 7 },
  snow_rock: { k: 'grain', ramp: 'ice', lo: 0.44, hi: 0.88, period: 9, speck: 260 },
  gravel: { k: 'grain', ramp: 'stone', lo: 0.28, hi: 0.66, period: 16, speck: 500 },
  moss_rock: { k: 'grain', ramp: 'foliage', lo: 0.22, hi: 0.62, period: 9, crack: 1 },
  swamp_muck: { k: 'grain', ramp: 'swamp', lo: 0.14, hi: 0.46, period: 6, blot: 0.4 },
  farmland: { k: 'furrow', ramp: 'dirt', lo: 0.24, hi: 0.64 },
  ash: { k: 'grain', ramp: 'grey', lo: 0.14, hi: 0.42, period: 8, speck: 200 },
  volcanic_rock: { k: 'grain', ramp: 'grey', lo: 0.08, hi: 0.34, period: 7, crack: 1 },
  beach_wet: { k: 'grain', ramp: 'sand', lo: 0.30, hi: 0.62, period: 12 },
  tundra: { k: 'grain', ramp: 'swamp', lo: 0.30, hi: 0.66, period: 8, blot: 0.3 },
  forest_floor: { k: 'grain', ramp: 'dirt', lo: 0.18, hi: 0.52, period: 9, blot: 0.34 },

  cliff_rock: { k: 'strata', ramp: 'stone', lo: 0.20, hi: 0.66 },
  cliff_sand: { k: 'strata', ramp: 'sand', lo: 0.26, hi: 0.72 },
  cliff_snow: { k: 'strata', ramp: 'ice', lo: 0.34, hi: 0.86 },
  cliff_volcanic: { k: 'strata', ramp: 'grey', lo: 0.08, hi: 0.40 },

  wall_plaster: { k: 'grain', ramp: 'plaster', lo: 0.56, hi: 0.94, period: 6 },
  wall_timber: { k: 'timber', ramp: 'plaster', lo: 0.58, hi: 0.94 },
  wall_brick: { k: 'brick', ramp: 'blood', lo: 0.22, hi: 0.52 },
  wall_stone_block: { k: 'brick', ramp: 'stone', lo: 0.30, hi: 0.72 },
  wall_castle: { k: 'brick', ramp: 'stone', lo: 0.36, hi: 0.80 },
  wall_castle_dark: { k: 'brick', ramp: 'stone', lo: 0.18, hi: 0.50 },
  wall_wood_plank: { k: 'plank', ramp: 'wood' },
  wall_log: { k: 'log', ramp: 'wood' },
  wall_marble: { k: 'grain', ramp: 'grey', lo: 0.66, hi: 0.98, period: 4, crack: 1 },
  wall_sandstone: { k: 'brick', ramp: 'sand', lo: 0.38, hi: 0.80 },
  wall_temple: { k: 'brick', ramp: 'plaster', lo: 0.48, hi: 0.88 },
  wall_shop_front: { k: 'timber', ramp: 'plaster', lo: 0.50, hi: 0.90 },

  roof_shingle_red: { k: 'shingle', ramp: 'blood', lo: 0.26, hi: 0.62 },
  roof_shingle_grey: { k: 'shingle', ramp: 'stone', lo: 0.20, hi: 0.52 },
  roof_thatch: { k: 'thatch', ramp: 'sand', lo: 0.24, hi: 0.62 },
  roof_tile_blue: { k: 'shingle', ramp: 'water', lo: 0.26, hi: 0.62 },
  roof_slate: { k: 'shingle', ramp: 'stone', lo: 0.14, hi: 0.42 },

  door_wood: { k: 'door', ramp: 'wood' },
  door_iron: { k: 'door', ramp: 'grey', dark: 1 },
  door_dungeon: { k: 'door', ramp: 'wood', dark: 1 },
  window_lit: { k: 'window', ramp: 'gold', lit: 1 },
  window_dark: { k: 'window', ramp: 'stone', lit: 0 },
  shutters: { k: 'plank', ramp: 'wood' },
  fence_wood: { k: 'plank', ramp: 'wood' },
  sign_board: { k: 'plank', ramp: 'wood' },
  wall_banner: { k: 'grain', ramp: 'blood', lo: 0.30, hi: 0.62, period: 4 },
  barrel_side: { k: 'plank', ramp: 'wood' },
  crate_side: { k: 'plank', ramp: 'wood' },

  dun_brick: { k: 'brick', ramp: 'stone', lo: 0.20, hi: 0.56 },
  dun_brick_mossy: { k: 'brick', ramp: 'foliage', lo: 0.16, hi: 0.46 },
  dun_cave: { k: 'grain', ramp: 'stone', lo: 0.14, hi: 0.46, period: 6, crack: 1 },
  dun_cave_dark: { k: 'grain', ramp: 'stone', lo: 0.08, hi: 0.30, period: 6, crack: 1 },
  dun_metal: { k: 'grain', ramp: 'grey', lo: 0.20, hi: 0.52, period: 5, speck: 300 },
  dun_sewer: { k: 'brick', ramp: 'swamp', lo: 0.12, hi: 0.40 },
  dun_tomb: { k: 'brick', ramp: 'plaster', lo: 0.24, hi: 0.58 },
  dun_ice: { k: 'grain', ramp: 'ice', lo: 0.40, hi: 0.90, period: 5, crack: 1 },
  dun_lava_rock: { k: 'grain', ramp: 'grey', lo: 0.06, hi: 0.28, period: 7, crack: 1 },
  dun_temple: { k: 'brick', ramp: 'sand', lo: 0.30, hi: 0.70 },
  dun_wood: { k: 'plank', ramp: 'wood' },
  dun_floor_stone: { k: 'brick', ramp: 'stone', lo: 0.18, hi: 0.48 },
  dun_floor_dirt: { k: 'grain', ramp: 'dirt', lo: 0.14, hi: 0.44, period: 8, speck: 300 },
  dun_floor_tile: { k: 'cobble', ramp: 'stone', lo: 0.22, hi: 0.58 },
  dun_ceiling_stone: { k: 'grain', ramp: 'stone', lo: 0.10, hi: 0.34, period: 6 },
  dun_ceiling_cave: { k: 'grain', ramp: 'stone', lo: 0.06, hi: 0.26, period: 5, crack: 1 },

  water: { k: 'water', ramp: 'water', lo: 0.30, hi: 0.66 },
  water_deep: { k: 'water', ramp: 'water', lo: 0.14, hi: 0.42 },
  lava: { k: 'lava', ramp: 'fire' },
  swamp_water: { k: 'water', ramp: 'swamp', lo: 0.14, hi: 0.40 },

  sky_gradient: { k: 'grain', ramp: 'sky', lo: 0.40, hi: 0.95, period: 3 },
  cloud_layer: { k: 'grain', ramp: 'grey', lo: 0.70, hi: 1.0, period: 4 },
  lava_glow: { k: 'lava', ramp: 'fire' },
  portal_swirl: { k: 'grain', ramp: 'arcane', lo: 0.3, hi: 0.9, period: 4 },
  magic_field: { k: 'grain', ramp: 'arcane', lo: 0.2, hi: 0.8, period: 5 },
};

/** Ids we had to paint ourselves, so a preview can report coverage gaps. */
export const missingTextureIds = [];

function fallbackTexture(id) {
  const hit = _fallbackCache.get(id);
  if (hit) return hit;
  missingTextureIds.push(id);
  const s = FALLBACK[id] || { k: 'grain', ramp: 'grey', lo: 0.3, hi: 0.7, period: 8 };
  const p = new Pix(64, 64);
  const seed = (id.length * 131 + id.charCodeAt(0) * 7) | 0;

  switch (s.k) {
    case 'brick':
      bricks(p, {
        rows: 6, cols: 3, seed, mortar: [46, 44, 40],
        faceFn: (x, y, u, v, r, c, t) => rampSample(s.ramp, s.lo + (s.hi - s.lo) * (0.4 + 0.5 * valueNoise2(x * 0.3, y * 0.3, seed))),
      });
      break;
    case 'cobble':
      bricks(p, {
        rows: 8, cols: 8, seed, mortar: [40, 38, 34], bevel: 0.5,
        faceFn: (x, y, u, v) => rampSample(s.ramp, s.lo + (s.hi - s.lo) * (0.35 + 0.6 * valueNoise2(x * 0.5, y * 0.5, seed))),
      });
      break;
    case 'plank': planks(p, { count: 4, seed, rampName: s.ramp }); break;
    case 'log': planks(p, { count: 4, seed, horizontal: true, rampName: s.ramp }); break;
    case 'timber':
      grainFill(p, s.ramp, { period: 6, seed, lo: s.lo, hi: s.hi });
      // Dark half-timber frame: a border plus one cross brace.
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const border = x < 5 || x > 58 || y < 5 || y > 58;
        const brace = Math.abs(x - y) < 4 || Math.abs(63 - x - y) < 4;
        if (border || brace) p.setArr(x, y, rampSample('wood', 0.18 + 0.12 * valueNoise2(x * 0.4, y * 0.4, seed)));
      }
      break;
    case 'shingle':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const row = Math.floor(y / 8);
        const off = (row & 1) * 6;
        const cx = ((x + off) % 12) / 12, cy = (y % 8) / 8;
        const edge = cy < 0.16 ? 0.55 : (cx < 0.08 || cx > 0.92 ? 0.7 : 1);
        const n = valueNoise2(x * 0.4, y * 0.4, seed);
        p.setArr(x, y, scaleC(rampSample(s.ramp, s.lo + (s.hi - s.lo) * (0.3 + 0.6 * n)), edge * (1 - cy * 0.18)));
      }
      break;
    case 'thatch':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const n = valueNoise2(x * 0.12, y * 1.6, seed);
        const band = (y % 14) < 2 ? 0.62 : 1;
        p.setArr(x, y, scaleC(rampSample(s.ramp, s.lo + (s.hi - s.lo) * n), band));
      }
      break;
    case 'strata':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const band = valueNoise2(x * 0.05, y * 0.55, seed);
        const n = 0.35 * valueNoise2(x * 0.25, y * 0.25, seed + 3) + 0.65 * band;
        p.setArr(x, y, rampSample(s.ramp, s.lo + (s.hi - s.lo) * n));
      }
      cracks(p, { period: 4, seed: seed + 5, width: 0.08, darkness: 0.5 });
      break;
    case 'furrow':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const f = ((y % 8) < 3) ? 0.72 : 1.06;
        const n = valueNoise2(x * 0.3, y * 0.3, seed);
        p.setArr(x, y, scaleC(rampSample(s.ramp, s.lo + (s.hi - s.lo) * n), f));
      }
      break;
    case 'water':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const n = 0.5 + 0.5 * Math.sin((x + valueNoise2(x * 0.1, y * 0.1, seed) * 8) * 0.5)
          * Math.sin((y + 3) * 0.31);
        p.setArr(x, y, rampSample(s.ramp, s.lo + (s.hi - s.lo) * n));
      }
      break;
    case 'lava':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const n = valueNoise2(x * 0.14, y * 0.14, seed);
        const crust = smoothstep(0.42, 0.62, n);
        p.setArr(x, y, mixC(rampSample('fire', 0.95), scaleC(rampSample('fire', 0.12), 0.7), crust));
      }
      break;
    case 'door':
      planks(p, { count: 3, seed, rampName: s.ramp });
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        if (x < 3 || x > 60 || y < 3 || y > 60 || (y > 14 && y < 19) || (y > 44 && y < 49)) p.shade(x, y, s.dark ? 0.55 : 0.7);
      }
      break;
    case 'window':
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const frame = x < 7 || x > 56 || y < 7 || y > 56 || Math.abs(x - 32) < 3 || Math.abs(y - 32) < 3;
        if (frame) p.setArr(x, y, rampSample('wood', 0.22));
        else if (s.lit) p.setArr(x, y, rampSample('gold', 0.62 + 0.3 * valueNoise2(x * 0.4, y * 0.4, seed)));
        else p.setArr(x, y, rampSample('stone', 0.10 + 0.14 * valueNoise2(x * 0.4, y * 0.4, seed)));
      }
      break;
    default:
      grainFill(p, s.ramp, { period: s.period || 8, octaves: 5, seed, lo: s.lo, hi: s.hi, contrast: 1.15 });
      if (s.blot) blotch(p, { period: 3, seed: seed + 17, amount: s.blot });
      if (s.crack) cracks(p, { period: 5, seed: seed + 23 });
      if (s.speck) speckle(p, s.speck, (r) => scaleC(rampSample(s.ramp, s.lo + (s.hi - s.lo) * r.float()), r.float(0.7, 1.3)));
      break;
  }

  const tex = toTexture(p, { dither: 11 });
  _fallbackCache.set(id, tex);
  return tex;
}

// --- heightmap -------------------------------------------------------------

const DEFAULT_PROFILE = {
  base: 900,        // rolling-hill amplitude
  freq: 2.6,        // hill cycles across the map
  detailAmp: 220,
  ridge: 0,         // mountain amplitude
  ridgeFreq: 1.5,
  warp: 0.30,
  terrace: 0,       // 0 = smooth, >0 = stepped plateaus (units per step)
  bias: 0,          // constant lift
  flatten: 0.0,     // 0..1, pulls the whole field toward its mean
};

/**
 * Build the 128x128 tile heightfield for a region.
 * @param {number|string} seed
 * @param {object} opts region terrain description
 * @returns {{size:number,tile:number,height:Float32Array,tileTex:Uint8Array,
 *            texIds:string[],water:number,roadMask:Uint8Array,min:number,max:number}}
 */
export function generateHeightmap(seed, opts = {}) {
  const size = opts.size || MAP_TILES;
  const tile = opts.tile || TILE;
  const N = size + 1;
  const rs = typeof seed === 'string' ? new Rand(seed).int(1e9) : (seed | 0);
  const pf = Object.assign({}, DEFAULT_PROFILE, opts.profile || {});
  const water = opts.water === undefined ? -420 : opts.water;

  const height = new Float32Array(N * N);
  const half = size * 0.5;

  // Coastal mask: 0 inland, 1 at the sea edge. Drives both the height falloff
  // and later the beach/water tile bands.
  const coast = opts.coast || null;
  const coastAt = (u, v) => {
    if (!coast) return 0;
    let d;
    switch (coast.dir) {
      case 'south': d = 1 - v; break;
      case 'north': d = v; break;
      case 'west': d = u; break;
      case 'east': d = 1 - u; break;
      case 'ring': {
        const dx = Math.abs(u - 0.5) * 2, dy = Math.abs(v - 0.5) * 2;
        d = 1 - Math.max(dx, dy);
        break;
      }
      default: d = 1;
    }
    return 1 - smoothstep(0, coast.width || 0.28, d);
  };

  let min = Infinity, max = -Infinity;
  for (let j = 0; j < N; j++) {
    const v = j / size;
    for (let i = 0; i < N; i++) {
      const u = i / size;
      // Domain warp keeps ridges from looking like a noise field.
      const wx = u * pf.freq + pf.warp * gradNoise2(u * 1.7, v * 1.7, rs + 91);
      const wz = v * pf.freq + pf.warp * gradNoise2(u * 1.7 + 5.1, v * 1.7 + 3.3, rs + 92);

      let h = fbm2(wx, wz, 5, 2.05, 0.5, rs) * pf.base;
      h += fbm2(u * pf.freq * 3.2, v * pf.freq * 3.2, 3, 2, 0.5, rs + 411) * pf.detailAmp;

      if (pf.ridge > 0) {
        const m = clamp(fbm2(u * 1.3, v * 1.3, 3, 2, 0.5, rs + 733) * 1.6 + 0.35, 0, 1);
        h += ridged2(u * pf.ridgeFreq, v * pf.ridgeFreq, 5, rs + 17) * pf.ridge * m * m;
      }
      h += pf.bias;
      if (pf.flatten > 0) h *= (1 - pf.flatten);
      if (pf.terrace > 0) {
        const t = pf.terrace;
        const q = Math.floor(h / t) * t;
        h = lerpN(h, q + t * smoothstep(0.35, 0.65, (h - q) / t), 0.7);
      }

      const c = coastAt(u, v);
      if (c > 0) h = lerpN(h, water - 2400 - c * 2600, c * c);

      // Snap to the 32-unit height quantum. This is not a rounding detail: it
      // is why MM6 terrain visibly stair-steps and why flat-shaded facets read
      // as facets instead of as a smooth field.
      h = Math.round(h / HEIGHT_QUANTUM) * HEIGHT_QUANTUM;

      height[j * N + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  const hm = {
    size, tile, height, water, min, max,
    texIds: [],
    tileTex: new Uint8Array(size * size),
    roadMask: new Uint8Array(size * size),
    origin: -half * tile,
    seed: rs,
  };

  if (opts.paint !== false) paintTiles(hm, opts);
  return hm;
}

/** (Re)classify every tile into a terrain texture using the region's bands. */
export function paintTiles(hm, opts = {}) {
  const { size } = hm;
  const bands = opts.bands || DEFAULT_BANDS;
  const texIds = [];
  const idOf = (id) => {
    let k = texIds.indexOf(id);
    if (k < 0) { k = texIds.length; texIds.push(id); }
    return k;
  };
  // Cliff texture always occupies a known slot so buildTerrain can darken it.
  const cliffId = idOf(opts.cliffTex || 'cliff_rock');
  const cliffSlope = opts.cliffSlope === undefined ? 0.62 : opts.cliffSlope;

  const span = Math.max(1, hm.max - hm.water);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cx = hm.origin + (i + 0.5) * hm.tile;
      const cz = hm.origin + (j + 0.5) * hm.tile;
      const h = heightAt(hm, cx, cz);
      const s = slopeAt(hm, cx, cz);
      const hn = clamp((h - hm.water) / span, 0, 1);
      const m = 0.5 + 0.5 * fbm2(i * 0.045, j * 0.045, 3, 2, 0.5, hm.seed + 5501);

      let pick = null;
      if (s > cliffSlope) pick = cliffId;
      else {
        for (const b of bands) {
          if (b.h && (hn < b.h[0] || hn > b.h[1])) continue;
          if (b.s && (s < b.s[0] || s > b.s[1])) continue;
          if (b.m && (m < b.m[0] || m > b.m[1])) continue;
          pick = idOf(b.tex);
          break;
        }
        if (pick === null) pick = idOf(bands[bands.length - 1].tex);
      }
      hm.tileTex[j * size + i] = pick;
    }
  }
  hm.texIds = texIds;
  hm.cliffIndex = cliffId;
  return hm;
}

const DEFAULT_BANDS = [
  { tex: 'beach_wet', h: [0, 0.04] },
  { tex: 'sand', h: [0, 0.10] },
  { tex: 'dirt', s: [0.36, 9] },
  { tex: 'grass_lush', m: [0.62, 1] },
  { tex: 'grass' },
];

/** Bilinear height sample in world space. */
export function heightAt(hm, wx, wz) {
  const { size, tile, height, origin } = hm;
  const fx = clamp((wx - origin) / tile, 0, size - 1e-4);
  const fz = clamp((wz - origin) / tile, 0, size - 1e-4);
  const i = fx | 0, j = fz | 0;
  const u = fx - i, v = fz - j;
  const N = size + 1;
  const h00 = height[j * N + i], h10 = height[j * N + i + 1];
  const h01 = height[(j + 1) * N + i], h11 = height[(j + 1) * N + i + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

const _n = new THREE.Vector3();
/** Surface normal from central differences. Returns a fresh Vector3. */
export function normalAt(hm, wx, wz) {
  const d = hm.tile * 0.5;
  const hl = heightAt(hm, wx - d, wz), hr = heightAt(hm, wx + d, wz);
  const hd = heightAt(hm, wx, wz - d), hu = heightAt(hm, wx, wz + d);
  return _n.set(hl - hr, 2 * d, hd - hu).normalize().clone();
}

/** Slope in radians from vertical (0 = flat, PI/2 = wall). */
export function slopeAt(hm, wx, wz) {
  const d = hm.tile * 0.5;
  const hl = heightAt(hm, wx - d, wz), hr = heightAt(hm, wx + d, wz);
  const hd = heightAt(hm, wx, wz - d), hu = heightAt(hm, wx, wz + d);
  const gx = (hr - hl) / (2 * d), gz = (hu - hd) / (2 * d);
  return Math.atan(Math.hypot(gx, gz));
}

/** Flatten a disc of terrain to a target height, with a soft rim. */
export function flattenArea(hm, wx, wz, radius, targetY, feather = 1.6) {
  const N = hm.size + 1;
  const i0 = Math.max(0, Math.floor((wx - radius * feather - hm.origin) / hm.tile));
  const i1 = Math.min(hm.size, Math.ceil((wx + radius * feather - hm.origin) / hm.tile));
  const j0 = Math.max(0, Math.floor((wz - radius * feather - hm.origin) / hm.tile));
  const j1 = Math.min(hm.size, Math.ceil((wz + radius * feather - hm.origin) / hm.tile));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = hm.origin + i * hm.tile, z = hm.origin + j * hm.tile;
      const d = Math.hypot(x - wx, z - wz);
      const t = 1 - smoothstep(radius, radius * feather, d);
      if (t <= 0) continue;
      const k = j * N + i;
      hm.height[k] = Math.round(lerpN(hm.height[k], targetY, t) / HEIGHT_QUANTUM) * HEIGHT_QUANTUM;
    }
  }
}

/**
 * Paint a road along a polyline.
 *
 * MM6 roads are *transition tiles laid over the terrain*, not cut geometry,
 * which is exactly why they always look painted on rather than sunk in. So the
 * default here only stamps tiles; `heights:true` is available for the rare case
 * (town shelves, dungeon forecourts) where the ground really must be levelled.
 */
export function carveRoad(hm, points, opts = {}) {
  const width = opts.width || 700;
  const tex = opts.tex || 'road_dirt';
  const doHeights = opts.heights === true;
  const doTiles = opts.tiles !== false;
  const N = hm.size + 1;
  let texIndex = hm.texIds.indexOf(tex);
  if (texIndex < 0) { texIndex = hm.texIds.length; hm.texIds.push(tex); }

  // Walk the polyline in short steps; at each step relax the corridor toward
  // the centreline height so the road stays walkable over hills.
  const step = hm.tile * 0.35;
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = heightAt(hm, x, z);
      const r = width * 0.5;
      if (doHeights) {
      const i0 = Math.max(0, Math.floor((x - r * 2 - hm.origin) / hm.tile));
      const i1 = Math.min(hm.size, Math.ceil((x + r * 2 - hm.origin) / hm.tile));
      const j0 = Math.max(0, Math.floor((z - r * 2 - hm.origin) / hm.tile));
      const j1 = Math.min(hm.size, Math.ceil((z + r * 2 - hm.origin) / hm.tile));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const vx = hm.origin + i * hm.tile, vz = hm.origin + j * hm.tile;
          const d = Math.hypot(vx - x, vz - z);
          const w = 1 - smoothstep(r * 0.6, r * 1.9, d);
          if (w > 0) {
            const kk = j * N + i;
            hm.height[kk] = lerpN(hm.height[kk], y, w * 0.75);
          }
        }
      }
      }
      if (!doTiles) continue;
      // Tile stamping uses tile centres so the road is a solid ribbon.
      const ti0 = Math.max(0, Math.floor((x - r - hm.origin) / hm.tile));
      const ti1 = Math.min(hm.size - 1, Math.floor((x + r - hm.origin) / hm.tile));
      const tj0 = Math.max(0, Math.floor((z - r - hm.origin) / hm.tile));
      const tj1 = Math.min(hm.size - 1, Math.floor((z + r - hm.origin) / hm.tile));
      for (let j = tj0; j <= tj1; j++) {
        for (let i = ti0; i <= ti1; i++) {
          const cx = hm.origin + (i + 0.5) * hm.tile, cz = hm.origin + (j + 0.5) * hm.tile;
          if (Math.hypot(cx - x, cz - z) > r) continue;
          hm.tileTex[j * hm.size + i] = texIndex;
          hm.roadMask[j * hm.size + i] = 1;
        }
      }
    }
  }
  return hm;
}

/** Stamp a rectangular patch of tiles with one texture (plazas, farm fields). */
export function stampTiles(hm, wx, wz, halfW, halfD, tex, mask) {
  let texIndex = hm.texIds.indexOf(tex);
  if (texIndex < 0) { texIndex = hm.texIds.length; hm.texIds.push(tex); }
  const i0 = Math.max(0, Math.floor((wx - halfW - hm.origin) / hm.tile));
  const i1 = Math.min(hm.size - 1, Math.floor((wx + halfW - hm.origin) / hm.tile));
  const j0 = Math.max(0, Math.floor((wz - halfD - hm.origin) / hm.tile));
  const j1 = Math.min(hm.size - 1, Math.floor((wz + halfD - hm.origin) / hm.tile));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (mask && !mask(hm.origin + (i + 0.5) * hm.tile, hm.origin + (j + 0.5) * hm.tile)) continue;
      hm.tileTex[j * hm.size + i] = texIndex;
      if (mask !== undefined) hm.roadMask[j * hm.size + i] = 1;
    }
  }
}
// --- lighting --------------------------------------------------------------
//
// MM6 lighting is a *greyscale multiply quantised to 32 levels*: the engine
// stores a 0..31 "dimming level" and converts it to `8 * (31 - dim)`, so the
// only legal shades are 0, 8, 16 ... 248. There are no coloured lights anywhere
// in MM6 (RGB light fields arrived in MM7). The visible banding that produces
// is not an artefact, it is the look.
//
// The sun rides the E-W great circle only - `sun = (cos t, 0, sin t)` with no
// north/south component ever - so outdoor terrain reads as an east/west split
// through the day and never as "north faces are dark".

const SRGB_TO_LIN = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const DEFAULT_TOD = 9.5;

/**
 * Bake one flat-shaded triangle's grey level.
 * @returns {number} 0..1 linear-space grey, already on the 32-step ladder.
 */
function faceGrey(nx, ny, nz, sun, ambient, diffuse) {
  const ndl = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
  // The engine's raw `ambient + diffuse*N.L` saturates to white on any level
  // ground after about 08:00, which is why MM6 snow visibly clips at noon. We
  // hold the same shape but pull both terms back so the landform stays legible
  // at every hour instead of blowing out for most of the day.
  const s = clamp(ambient * 0.75 + clamp(diffuse * ndl, 0, 0.85) * 0.68, 0, 1);
  return SRGB_TO_LIN(quantiseShade(s));
}

// --- water animation -------------------------------------------------------
//
// 7 frames on a 1.000 s loop with frame times 1/12, 1/6 x5, 1/12. One global
// phase drives every water surface on screen.

const WATER_FRAME_TIMES = [1 / 12, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 12];
const WATER_CUM = (() => {
  const c = []; let t = 0;
  for (const f of WATER_FRAME_TIMES) { t += f; c.push(t); }
  return c;
})();

/** Which of the 7 water frames is showing at time `seconds`. */
export function waterFrameIndex(seconds) {
  const t = ((seconds % 1) + 1) % 1;
  for (let i = 0; i < WATER_CUM.length; i++) if (t < WATER_CUM[i]) return i;
  return WATER_FRAME_TIMES.length - 1;
}

const _waterFrames = new Map();
/** The 7-frame water animation group, from textures.js if it has one. */
export function waterFrames(id = 'water') {
  const hit = _waterFrames.get(id);
  if (hit) return hit;
  let frames = null;
  if (TEXMOD && typeof TEXMOD.getAnimated === 'function') {
    try {
      const f = TEXMOD.getAnimated(id);
      if (Array.isArray(f) && f.length) frames = f;
    } catch (e) { frames = null; }
  }
  if (!frames) {
    // Local stand-in: seven phases of a rolling ripple, desaturated blue-green
    // (MM6 water is darker and greener than memory insists).
    const spec = FALLBACK[id] || FALLBACK.water;
    frames = [];
    for (let f = 0; f < 7; f++) {
      const ph = (f / 7) * Math.PI * 2;
      const p = new Pix(64, 64);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const w1 = Math.sin((x * 0.30) + ph) * 0.5 + 0.5;
          const w2 = Math.sin((y * 0.19) - ph * 0.7 + w1 * 1.4) * 0.5 + 0.5;
          const n = valueNoise2(x * 0.16, y * 0.16 + f * 3.1, 91);
          const t = clamp(w1 * 0.42 + w2 * 0.38 + n * 0.20, 0, 1);
          p.setArr(x, y, rampSample(spec.ramp, spec.lo + (spec.hi - spec.lo) * t));
        }
      }
      frames.push(toTexture(p, { dither: 9 }));
    }
  }
  _waterFrames.set(id, frames);
  return frames;
}

// --- mesh building ---------------------------------------------------------

const CHUNK_TILES = 8;

/**
 * Turn a heightmap into renderable chunks.
 *
 * One BufferGeometry per chunk with a material group per texture used, so a
 * chunk is one mesh but keeps hard per-tile texture edges. Every triangle is
 * flat-shaded from its own face normal (6 vertices per tile, no sharing), which
 * is what makes the 32-unit height steps read as facets.
 *
 * @returns {{group:THREE.Group, chunks:Array, update:(cam,dt)=>void,
 *            setTimeOfDay:(h:number)=>void, water:THREE.Mesh|null, dispose:()=>void}}
 */
export function buildTerrain(hm, opts = {}) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const size = hm.size, tile = hm.tile;
  const N = size + 1;
  const cliffDark = opts.cliffDarken === undefined ? 0.82 : opts.cliffDarken;
  const fogFar = opts.fogFar || FAR_CLIP;
  let tod = opts.timeOfDay === undefined ? DEFAULT_TOD : opts.timeOfDay;

  const materials = hm.texIds.map((id) => new THREE.MeshBasicMaterial({
    map: getTexture(id),
    vertexColors: true,
    fog: true,
    side: THREE.FrontSide,
  }));

  const chunksPerSide = Math.ceil(size / CHUNK_TILES);
  const chunks = [];
  const maxTiles = CHUNK_TILES * CHUNK_TILES;
  // 6 verts per tile: two independent flat-shaded triangles.
  const pos = new Float32Array(maxTiles * 6 * 3);
  const uv = new Float32Array(maxTiles * 6 * 2);
  const col = new Float32Array(maxTiles * 6 * 3);
  const byTex = new Map();

  const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (let cj = 0; cj < chunksPerSide; cj++) {
    for (let ci = 0; ci < chunksPerSide; ci++) {
      byTex.clear();
      const ti0 = ci * CHUNK_TILES, tj0 = cj * CHUNK_TILES;
      const ti1 = Math.min(size, ti0 + CHUNK_TILES), tj1 = Math.min(size, tj0 + CHUNK_TILES);
      for (let j = tj0; j < tj1; j++) {
        for (let i = ti0; i < ti1; i++) {
          const t = hm.tileTex[j * size + i];
          let list = byTex.get(t);
          if (!list) { list = []; byTex.set(t, list); }
          list.push(j * size + i);
        }
      }
      if (byTex.size === 0) continue;

      let vp = 0, vu = 0, vc = 0, vcount = 0;
      const groups = [];
      // Per-vertex tile/cliff bookkeeping so relighting does not rebuild geometry.
      const faceInfo = [];
      for (const [texIdx, list] of byTex) {
        const start = vcount;
        for (const cell of list) {
          const i = cell % size, j = (cell / size) | 0;
          const isCliff = texIdx === hm.cliffIndex;
          const rot = hm.roadMask[cell] ? 0 : (hash2(i, j, hm.seed) * 4) | 0;
          const x0 = hm.origin + i * tile, z0 = hm.origin + j * tile;
          const h00 = hm.height[j * N + i], h10 = hm.height[j * N + i + 1];
          const h11 = hm.height[(j + 1) * N + i + 1], h01 = hm.height[(j + 1) * N + i];
          const P = [
            [x0, h00, z0], [x0 + tile, h10, z0],
            [x0 + tile, h11, z0 + tile], [x0, h01, z0 + tile],
          ];
          // Two triangles, matching MM6's per-cell split.
          const tris = [[0, 3, 1], [1, 3, 2]];
          for (const tri of tris) {
            const a = P[tri[0]], b = P[tri[1]], c = P[tri[2]];
            let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
            let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            const il = 1 / (Math.hypot(nx, ny, nz) || 1);
            nx *= il; ny *= il; nz *= il;
            if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
            faceInfo.push(nx, ny, nz, isCliff ? cliffDark : 1);
            for (const vi of tri) {
              pos[vp++] = P[vi][0]; pos[vp++] = P[vi][1]; pos[vp++] = P[vi][2];
              const u = UVS[(vi + rot) & 3];
              uv[vu++] = u[0]; uv[vu++] = u[1];
              col[vc++] = 1; col[vc++] = 1; col[vc++] = 1;
              vcount++;
            }
          }
        }
        groups.push({ start, count: vcount - start, tex: texIdx });
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, vp), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(0, vu), 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, vc), 3));

      const mats = [];
      groups.forEach((g, gi) => {
        geo.addGroup(g.start, g.count, gi);
        mats.push(materials[g.tex]);
      });
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, mats);
      mesh.frustumCulled = false;      // we cull chunks ourselves, once
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      chunks.push({
        mesh,
        sphere: geo.boundingSphere.clone(),
        ci, cj,
        tris: vcount / 3,
        faces: new Float32Array(faceInfo),
      });
    }
  }

  /** Re-bake every facet's grey level for a new hour. ~5ms for a whole map. */
  function setTimeOfDay(hours) {
    tod = hours;
    const sun = sunDirection(tod);
    const st = sunTerms(tod);
    for (const c of chunks) {
      const arr = c.mesh.geometry.attributes.color.array;
      const f = c.faces;
      const n = f.length / 4;
      for (let t = 0; t < n; t++) {
        const g = faceGrey(f[t * 4], f[t * 4 + 1], f[t * 4 + 2], sun, st.ambient, st.diffuse) * f[t * 4 + 3];
        const o = t * 9;
        arr[o] = g; arr[o + 1] = g; arr[o + 2] = g;
        arr[o + 3] = g; arr[o + 4] = g; arr[o + 5] = g;
        arr[o + 6] = g; arr[o + 7] = g; arr[o + 8] = g;
      }
      c.mesh.geometry.attributes.color.needsUpdate = true;
    }
  }
  setTimeOfDay(tod);

  // --- water sheet ---------------------------------------------------------
  let water = null;
  const wFrames = waterFrames(opts.waterTex || 'water');
  if (hm.min < hm.water && opts.water !== false) {
    const geo = new THREE.PlaneGeometry(size * tile, size * tile, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * size * 0.5, uvs.getY(i) * size * 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: wFrames[0], fog: true });
    water = new THREE.Mesh(geo, mat);
    water.position.set(hm.origin + size * tile * 0.5, hm.water, hm.origin + size * tile * 0.5);
    water.renderOrder = -2;
    group.add(water);
  }

  const frustum = new THREE.Frustum();
  const mat4 = new THREE.Matrix4();
  const state = { drawn: 0, tris: 0, waterFrame: 0 };
  let clock = 0;

  function update(camera, dt = 0.016) {
    mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(mat4);
    const cp = camera.position;
    let drawn = 0, tris = 0;
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k];
      const s = c.sphere;
      const d = Math.hypot(cp.x - s.center.x, cp.z - s.center.z) - s.radius;
      const vis = d < fogFar && frustum.intersectsSphere(s);
      c.mesh.visible = vis;
      if (vis) { drawn++; tris += c.tris; }
    }
    state.drawn = drawn; state.tris = tris;
    if (water) {
      clock += dt;
      const f = waterFrameIndex(clock);
      if (f !== state.waterFrame) {
        state.waterFrame = f;
        water.material.map = wFrames[f];
        water.material.needsUpdate = true;
      }
      water.position.x = cp.x; water.position.z = cp.z;
    }
  }

  function dispose() {
    for (const c of chunks) c.mesh.geometry.dispose();
    for (const m of materials) m.dispose();
    if (water) { water.geometry.dispose(); water.material.dispose(); }
  }

  return { group, chunks, materials, update, setTimeOfDay, water, dispose, state };
}

// --- shared helpers for the rest of src/world ------------------------------

/**
 * A field of camera-facing billboards drawn as one instanced draw call.
 * MM6 drew every tree, bush and barrel this way; the vertex shader rotates the
 * quad about world Y toward the camera so trees never lean.
 */
export function makeBillboardField(tex, instances, opts = {}) {
  const n = instances.length;
  if (n === 0) return null;
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  geo.instanceCount = n;

  const off = new Float32Array(n * 3);
  const scl = new Float32Array(n * 2);
  const tint = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const it = instances[i];
    off[i * 3] = it.x; off[i * 3 + 1] = it.y; off[i * 3 + 2] = it.z;
    scl[i * 2] = it.w; scl[i * 2 + 1] = it.h;
    const t = it.tint || [1, 1, 1];
    tint[i * 3] = t[0]; tint[i * 3 + 1] = t[1]; tint[i * 3 + 2] = t[2];
  }
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 2));
  geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uLight: { value: 1 },
      fogColor: { value: new THREE.Color(opts.fogColor || 0x9ab4cc) },
      fogNear: { value: opts.fogNear === undefined ? 2048 : opts.fogNear },
      fogFar: { value: opts.fogFar || FAR_CLIP },
    },
    vertexShader: /* glsl */`
      attribute vec3 iOffset;
      attribute vec2 iScale;
      attribute vec3 iTint;
      uniform vec3 uRight;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFog;
      void main() {
        vUv = uv;
        vTint = iTint;
        vec3 wp = iOffset + uRight * (position.x * iScale.x) + vec3(0.0, position.y * iScale.y, 0.0);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      uniform float uLight;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFog;
      void main() {
        vec4 c = texture2D(map, vUv);
        // 1-bit alpha: MM6 sprites never blend edges.
        if (c.a < 0.5) discard;
        // Same greyscale multiply the world uses, so flora sits in the scene.
        c.rgb *= vTint * uLight;
        float f = clamp((vFog - fogNear) / (fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(c.rgb, fogColor, f), 1.0);
      }`,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.setFog = (color, near, far, light) => {
    mat.uniforms.fogColor.value.copy(color);
    mat.uniforms.fogNear.value = near;
    mat.uniforms.fogFar.value = far;
    if (light !== undefined) mat.uniforms.uLight.value = light;
  };
  mesh.userData.updateBillboard = (camera) => {
    // World-space camera right, flattened to the ground plane.
    const e = camera.matrixWorld.elements;
    const rx = e[0], rz = e[2];
    const l = Math.hypot(rx, rz) || 1;
    mat.uniforms.uRight.value.set(rx / l, 0, rz / l);
  };
  return mesh;
}

/** Quick procedural sprite sheet for a flora kind, used until spritebake lands. */
const _floraCache = new Map();
export function floraTexture(kind, seed = 1) {
  const key = kind + seed;
  if (_floraCache.has(key)) return _floraCache.get(key);
  const S = 64;
  const p = new Pix(S, S);
  p.fill(0, 0, 0, 0);
  const rnd = new Rand(seed * 7919 + kind.length);

  const trunk = (wTop, wBot, hTop, rampName, shade) => {
    for (let y = hTop; y < S; y++) {
      const t = (y - hTop) / (S - hTop);
      const w = wTop + (wBot - wTop) * t;
      for (let x = Math.round(S / 2 - w); x <= Math.round(S / 2 + w); x++) {
        const side = (x - S / 2) / Math.max(1, w);
        p.setArr(x, y, scaleC(rampSample(rampName, shade), 1 - Math.abs(side) * 0.35 + (side < 0 ? 0.14 : 0)));
      }
    }
  };
  const blob = (cx, cy, rx, ry, rampName, lo, hi, sd) => {
    for (let y = Math.max(0, cy - ry); y < Math.min(S, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x < Math.min(S, cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const n = valueNoise2(x * 0.5, y * 0.5, sd);
        if (d > 0.62 && n < 0.42) continue;         // ragged silhouette
        // Light from the upper left, same convention as every other surface.
        const lit = clamp(0.5 - dx * 0.45 - dy * 0.5 + n * 0.35, 0, 1);
        p.setArr(x, y, rampSample(rampName, lo + (hi - lo) * lit), 255);
      }
    }
  };

  switch (kind) {
    case 'pine': case 'fir': {
      trunk(2, 3.5, 40, 'wood', 0.28);
      for (let i = 0; i < 4; i++) {
        const y = 10 + i * 10, w = 8 + i * 5;
        for (let yy = y; yy < y + 13 && yy < S; yy++) {
          const t = (yy - y) / 13;
          const half = w * t;
          for (let x = Math.round(S / 2 - half); x <= Math.round(S / 2 + half); x++) {
            const n = valueNoise2(x * 0.6, yy * 0.6, 12 + i);
            if (n < 0.30) continue;
            const side = (x - S / 2) / Math.max(1, half);
            p.setArr(x, yy, rampSample('foliage', 0.22 + 0.5 * clamp(0.55 - side * 0.5 - t * 0.2 + n * 0.3, 0, 1)));
          }
        }
      }
      break;
    }
    case 'palm': {
      trunk(2, 3, 18, 'wood', 0.42);
      for (let a = 0; a < 7; a++) {
        const ang = -Math.PI * 0.15 - a * (Math.PI * 0.78 / 6);
        for (let t = 0; t < 26; t++) {
          const x = Math.round(S / 2 + Math.cos(ang) * t);
          const y = Math.round(18 + Math.sin(ang) * t * 0.8 + t * t * 0.012);
          for (let w = -2; w <= 2; w++) {
            if (x + w < 0 || x + w >= S || y < 0 || y >= S) continue;
            if (Math.abs(w) > 2 - t * 0.06) continue;
            p.setArr(x + w, y, rampSample('foliage', 0.34 + 0.4 * valueNoise2(x, y + w, 3)));
          }
        }
      }
      break;
    }
    case 'dead_tree': {
      trunk(2, 4, 12, 'wood', 0.20);
      for (let a = 0; a < 5; a++) {
        const ang = -Math.PI * 0.25 - a * 0.28;
        for (let t = 0; t < 18; t++) {
          const x = Math.round(S / 2 + Math.cos(ang) * t * (a % 2 ? 1 : -1));
          const y = Math.round(24 + Math.sin(ang) * t);
          if (x < 0 || x >= S || y < 0 || y >= S) continue;
          p.setArr(x, y, rampSample('wood', 0.16));
        }
      }
      break;
    }
    case 'bush': case 'shrub':
      blob(32, 46, 15, 12, 'foliage', 0.22, 0.78, 31);
      break;
    case 'fern':
      blob(32, 50, 13, 9, 'grass', 0.24, 0.72, 44);
      break;
    case 'cactus':
      trunk(4, 5, 20, 'foliage', 0.30);
      blob(22, 34, 4, 7, 'foliage', 0.24, 0.6, 8);
      blob(43, 30, 4, 8, 'foliage', 0.24, 0.6, 9);
      break;
    case 'rock': case 'boulder':
      blob(32, 50, 17, 11, 'stone', 0.22, 0.72, 55);
      break;
    case 'reed':
      for (let i = 0; i < 12; i++) {
        const x0 = 20 + rnd.int(24), lean = rnd.float(-6, 6);
        for (let y = 26; y < S; y++) {
          const x = Math.round(x0 + lean * (S - y) / 38);
          if (x < 0 || x >= S) continue;
          p.setArr(x, y, rampSample('swamp', 0.30 + 0.4 * rnd.float()));
        }
      }
      break;
    case 'flowers':
      blob(32, 54, 14, 7, 'grass', 0.36, 0.8, 61);
      for (let i = 0; i < 14; i++) {
        p.setArr(18 + rnd.int(28), 46 + rnd.int(12), rampSample(rnd.bool() ? 'gold' : 'blood', 0.7));
      }
      break;
    case 'stump':
      trunk(6, 7, 46, 'wood', 0.26);
      break;
    case 'mushroom':
      trunk(1.5, 2, 46, 'plaster', 0.6);
      blob(32, 44, 10, 6, 'blood', 0.3, 0.7, 77);
      break;
    default: { // broadleaf tree - the workhorse of every green region
      trunk(2.5, 4.5, 34, 'wood', 0.26);
      blob(32, 26, 19, 17, 'foliage', 0.18, 0.86, 21);
      blob(22, 20, 10, 9, 'foliage', 0.26, 0.9, 22);
      blob(43, 30, 10, 9, 'foliage', 0.14, 0.7, 23);
      break;
    }
  }

  const tex = toTexture(p, { dither: 8, repeat: false, mips: true });
  _floraCache.set(key, tex);
  return tex;
}
