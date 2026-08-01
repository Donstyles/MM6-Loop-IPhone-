import * as THREE from 'three';
import {
  Pix, toTexture, grainFill, blotch, cracks, speckle, bricks, planks,
  rampSample, mixC, scaleC, makeCanvas, ctx2d,
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

const _tintCache = new Map();
/**
 * Average colour of a texture id. Sampled from the real bitmap where we can get
 * at it, because the automap plate is built from these and guessing from the
 * ramp makes every region look like the same green square.
 */
export function textureTint(id) {
  const hit = _tintCache.get(id);
  if (hit) return hit;
  let col = null;
  try {
    const img = getTexture(id).image;
    if (img && img.width) {
      const c = makeCanvas(8, 8);
      const g = ctx2d(c);
      g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      col = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
    }
  } catch (e) { col = null; }
  if (!col) {
    const s = FALLBACK[id] || FALLBACK.grass;
    const c = rampSample(s.ramp, (s.lo + s.hi) * 0.5);
    col = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  }
  _tintCache.set(id, col);
  return col;
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

      // Gain 0.38 rather than the usual 0.5: MM6's outdoor maps are dominated
      // by one broad low-frequency form with only a whisper of detail on top.
      // At a 32-unit height quantum and flat shading, high-frequency octaves
      // stop reading as terrain and start reading as static.
      let h = fbm2(wx, wz, 5, 2.05, 0.38, rs) * pf.base;
      h += fbm2(u * pf.freq * 3.2, v * pf.freq * 3.2, 2, 2, 0.4, rs + 411) * pf.detailAmp;

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
function faceGrey(nx, ny, nz, sun, ambient, diffuse, upness) {
  const ndl = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
  // N.L is normalised against the sun's own elevation, so *level ground reads
  // as the raw texture at every daylight hour*. Taking N.L raw would multiply
  // the whole world by sin(sun altitude) and turn a 07:00 meadow black, which
  // is not what MM6 does: its ambient floor carries the flat ground and the
  // sun only models the slopes.
  const up = Math.max(0.30, sun.y);
  const rel = clamp(ndl / up, 0, 1);
  const lit = 0.50 + 0.50 * rel;
  // MM6's sun has no north/south component at all, so a north- or south-facing
  // slope shades identically to flat ground and the landform vanishes. A small
  // steepness term stands in for the occlusion the engine baked per-vertex.
  const steep = 1 - 0.10 * (1 - clamp(upness === undefined ? ny : upness, 0, 1));
  // The shell owns the day/night multiply outright. A night factor here as
  // well multiplied 0.38 by the post pass's 0.153 and put midnight ground at
  // luminance 4 against MM6's ~12: dark enough to be a black rectangle.
  return SRGB_TO_LIN(quantiseShade(clamp(lit * steep, 0, 1)));
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
            // Exaggerate the horizontal component for lighting only. MM6's
            // hand-built terrain is steeper than a noise field, and with the
            // sun high in the sky a gentle slope otherwise shades almost
            // identically to flat ground and the landform disappears.
            const ex = 2.4;
            let lx = nx * ex, ly = ny, lz = nz * ex;
            const li2 = 1 / (Math.hypot(lx, ly, lz) || 1);
            faceInfo.push(lx * li2, ly * li2, lz * li2, isCliff ? cliffDark : 1, ny);
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
    // Callers pass either an hour or a 0..1 fraction of the day; accept both.
    tod = hours === undefined ? tod : (hours <= 1 ? hours * 24 : hours);
    const sun = sunDirection(tod);
    const st = sunTerms(tod);
    for (const c of chunks) {
      const arr = c.mesh.geometry.attributes.color.array;
      const f = c.faces;
      const n = f.length / 5;
      for (let t = 0; t < n; t++) {
        const g = faceGrey(f[t * 5], f[t * 5 + 1], f[t * 5 + 2], sun, st.ambient, st.diffuse, f[t * 5 + 4]) * f[t * 5 + 3];
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

// ---------------------------------------------------------------------------
// Flora billboards.
//
// MM6's trees are `tree01`..`tree66`: pre-rendered billboards, 128x192 to
// 192x256 source pixels, standing 400-1000 world units tall. They are painted
// art, not filled shapes - a tapered trunk with bark grain and a lit and a
// shadow side, real limbs joining the trunk to the crown, and a crown built of
// overlapping foliage clumps with four to six banded value steps and gaps you
// can see the sky through. The silhouette is hard-keyed off index 0, so it is
// jagged and 1-bit; there is no feathering anywhere on it.
//
// Everything below paints into a Pix by hand. No canvas arcs, no strokes, no
// gradients, no partial alpha: every curve is scanline-filled and every ramp is
// quantised into a handful of steps so it bands the way a 256-colour frame does.
// ---------------------------------------------------------------------------

/** Trees get the full 128px sheet; undergrowth and props share a 64px one. */
const TREE_KINDS = new Set([
  'oak', 'oak_autumn', 'oak_winter', 'tree', 'pine', 'pine_snow', 'fir',
  'birch', 'willow', 'palm', 'dead_tree', 'sapling',
]);

/** Bounds-checked write - Pix.idx() wraps, and a wrapped tree is a ruined one. */
function fput(p, x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.setArr(x, y, c);
}

/** Quantise into `n` discrete steps. The banding is the look, not an artefact. */
function qb(t, n) {
  const s = Math.max(2, n | 0);
  return Math.round(clamp(t, 0, 1) * (s - 1)) / (s - 1);
}

/**
 * Bark lightness at a point on a trunk or limb.
 *
 * `side` is -1 at the left edge, +1 at the right. The key light is the baked
 * upper-front-left of every MM6 turntable render, so the left third stays lit
 * and the right edge falls into a hard shadow line. On top of the cylinder
 * term go two octaves of very anisotropic noise - stretched ~10:1 along the
 * trunk - which is what reads as vertical grain rather than as speckle.
 */
function barkTone(x, y, side, base, seed) {
  const round = 1 - side * side * 0.62;              // cylinder falloff
  let l = base + 0.30 * round - side * 0.26;
  l += (valueNoise2(x * 1.9, y * 0.14, seed) - 0.5) * 0.30;
  l += (valueNoise2(x * 0.62, y * 0.05, seed + 311) - 0.5) * 0.26;
  if (side > 0.72) l -= 0.16;                        // hard shadow edge
  if (side < -0.78) l += 0.10;                       // rim of the lit side
  return l;
}

/**
 * A tapered trunk with a root flare, a slight lean, bark grain and knots.
 * Writes `2` into `mask` so the canopy's sky-holes never eat the wood.
 */
function paintTrunk(p, mask, o) {
  const {
    y0, y1, cx0, cx1, w0, w1, ramp: rampName = 'wood',
    base = 0.30, flare = 0.55, sway = 0, seed = 1, steps = 6,
  } = o;
  const span = Math.max(1, y1 - y0);
  const knots = [];
  const nk = 2 + Math.floor(hash2(seed, 7, 91) * 2);
  for (let i = 0; i < nk; i++) {
    const t = 0.16 + hash2(seed, i * 13 + 3, 5) * 0.66;
    knots.push({ y: y0 + span * t, r: (w0 + (w1 - w0) * t) * (0.55 + hash2(seed, i, 9) * 0.35), s: hash2(seed, i, 21) < 0.5 ? -1 : 1 });
  }
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / span;
    let hw = w0 + (w1 - w0) * t;
    // Root flare: the last sixth of the trunk widens into the ground, which is
    // what makes a tree read as planted instead of stuck in.
    if (t > 0.84) hw *= 1 + ((t - 0.84) / 0.16) * flare;
    const cx = cx0 + (cx1 - cx0) * t + Math.sin(t * 3.1 + seed) * sway;
    const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
    for (let x = xa; x <= xb; x++) {
      const side = (x - cx) / Math.max(0.9, hw);
      if (Math.abs(side) > 1.06) continue;
      let l = barkTone(x, y, side, base, seed);
      for (const k of knots) {
        const dx = (x - cx - k.s * hw * 0.42) / Math.max(1, k.r);
        const dy = (y - k.y) / Math.max(1.4, k.r * 1.7);
        const d = dx * dx + dy * dy;
        if (d < 1) l += d < 0.42 ? -0.26 : 0.16;     // dark core, lit collar
      }
      fput(p, x, y, rampSample(rampName, qb(l, steps)));
      const i = (y | 0) * p.w + (x | 0);
      if (x >= 0 && y >= 0 && x < p.w && y < p.h) mask[i] = 2;
    }
  }
}

/** A tapered limb from (ax,ay) to (bx,by). Same bark rig as the trunk. */
function paintLimb(p, mask, ax, ay, bx, by, w0, w1, o = {}) {
  const { ramp: rampName = 'wood', base = 0.24, seed = 1, steps = 6 } = o;
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.round(len * 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    const k = Math.max(0, Math.round((w0 + (w1 - w0) * t) * 0.5));
    for (let dy = -k; dy <= k; dy++) {
      for (let dx = -k; dx <= k; dx++) {
        if (dx * dx + dy * dy > (k + 0.35) * (k + 0.35)) continue;
        const side = k > 0 ? dx / k : 0;
        const px = Math.round(x + dx), py = Math.round(y + dy);
        fput(p, px, py, rampSample(rampName, qb(barkTone(px, py, side, base, seed), steps)));
        if (px >= 0 && py >= 0 && px < p.w && py < p.h) mask[py * p.w + px] = 2;
      }
    }
  }
}

/**
 * One foliage clump.
 *
 * The rim is eroded by noise so the silhouette comes out jagged and 1-bit
 * rather than as a clean ellipse edge, and the interior takes a lit/shadow
 * gradient plus two scales of leaf noise before it is quantised to `steps`
 * bands. Clumps are drawn bottom-up so the sunlit tops overwrite the shaded
 * undersides and the crown gains a real top-to-bottom value range.
 */
function paintClump(p, mask, cx, cy, rx, ry, o) {
  const {
    ramp: rampName = 'foliage', lo = 0.22, hi = 0.92, seed = 1,
    steps = 5, ragged = 0.46, tilt = 0, bias = 0,
  } = o;
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= p.h) continue;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= p.w) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1.05) continue;
      const nc = valueNoise2(x * 0.38, y * 0.38, seed);          // clump scale
      const nl = valueNoise2(x * 1.25, y * 1.25, seed + 77);     // leaf scale
      // Ragged 1-bit rim: erode harder the further out the pixel sits.
      if (d2 > 0.46 && nc * 0.72 + nl * 0.42 < ragged * (d2 - 0.32)) continue;
      let l = 0.50 + bias - dx * (0.26 + tilt) - dy * 0.46
        + (nc - 0.5) * 0.66 + (nl - 0.5) * 0.30;
      fput(p, x, y, rampSample(rampName, qb(lo + (hi - lo) * clamp(l, 0, 1), steps)));
      mask[y * p.w + x] = 1;
    }
  }
}

/**
 * Punch sky-holes through the crown.
 *
 * A real canopy is not a solid mass; MM6's tree bitmaps have daylight showing
 * between the foliage clumps and that is a large part of why they do not read
 * as blobs. Holes only ever open in leaf pixels (mask 1), never in wood, and
 * only where they are fully surrounded, so the outer silhouette is untouched.
 */
function punchCanopy(p, mask, seed, amount, scale = 0.26) {
  const w = p.w, h = p.h;
  const doomed = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] !== 1) continue;
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) continue;
      const n = valueNoise2(x * scale, y * scale * 1.25, seed) * 0.7
        + valueNoise2(x * scale * 2.3, y * scale * 2.3, seed + 5) * 0.3;
      if (n < amount) doomed.push(i);
    }
  }
  for (const i of doomed) { p.data[i * 4 + 3] = 0; mask[i] = 0; }
}

/**
 * Bleed the edge colour outward into the transparent margin.
 *
 * The alpha stays a hard 0/255 - what changes is only the RGB the mip chain
 * averages in. Without this, half-size mips blend the sprite toward the black
 * of the empty texels and a distant tree grows a dark halo.
 */
function bleedAlpha(p, passes = 3) {
  const w = p.w, h = p.h, d = p.data;
  for (let s = 0; s < passes; s++) {
    const add = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] !== 0 || d[i] || d[i + 1] || d[i + 2]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
          const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          if (!d[j] && !d[j + 1] && !d[j + 2]) continue;
          r += d[j]; g += d[j + 1]; b += d[j + 2]; n++;
        }
        if (n) add.push(i, r / n, g / n, b / n);
      }
    }
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k];
      d[i] = add[k + 1]; d[i + 1] = add[k + 2]; d[i + 2] = add[k + 3]; d[i + 3] = 0;
    }
    if (!add.length) break;
  }
}

// --- the tree families -----------------------------------------------------

/**
 * Deciduous broadleaf: trunk, a fork of limbs, and a crown of clumps.
 * `o.weep` hangs strands from the limb tips instead (willow); `o.pale` swaps
 * the trunk for birch bark.
 */
function paintBroadleaf(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const leaf = o.leaf || 'foliage';
  const crownY = S * (o.crownY || 0.50);
  const trunkTop = crownY + S * 0.04;

  // Trunk.
  paintTrunk(p, mask, {
    y0: Math.round(trunkTop), y1: S - 1, cx0: cx, cx1: cx + (o.lean || 0) * S,
    w0: S * (o.wTop || 0.026), w1: S * (o.wBot || 0.048),
    base: o.barkBase === undefined ? 0.30 : o.barkBase,
    flare: 0.62, sway: S * 0.012, seed: o.seed, steps: 6,
    ramp: o.pale ? 'plaster' : 'wood',
  });
  if (o.pale) {
    // Birch: horizontal lenticel bands scored across the white bark.
    for (let b = 0; b < 9; b++) {
      const y = Math.round(trunkTop + (S - trunkTop) * (0.06 + b * 0.105) + rnd.float(-2, 2));
      const t = (y - trunkTop) / Math.max(1, S - 1 - trunkTop);
      const hw = S * (0.026 + (0.048 - 0.026) * t);
      const x0 = Math.round(cx - hw * rnd.float(0.3, 1.0));
      const x1 = Math.round(cx + hw * rnd.float(0.3, 1.0));
      for (let x = x0; x <= x1; x++) {
        fput(p, x, y, rampSample('grey', 0.14 + rnd.float(0, 0.12)));
        if (rnd.bool(0.45)) fput(p, x, y + 1, rampSample('grey', 0.10));
      }
    }
  }

  // Limbs. They start below the crown so the junction is visible, and every
  // one of them ends inside a foliage clump.
  const nb = o.branches || 5;
  const tips = [];
  for (let i = 0; i < nb; i++) {
    const a = -Math.PI * 0.5 + (i - (nb - 1) / 2) * (Math.PI / (nb + 1.4)) + rnd.float(-0.16, 0.16);
    const len = S * rnd.float(0.20, 0.30);
    const bx = cx + Math.cos(a) * len * (o.spread || 1.25);
    const by = trunkTop + Math.sin(a) * len - S * 0.02;
    paintLimb(p, mask, cx + rnd.float(-1, 1), trunkTop + S * rnd.float(0.01, 0.09),
      bx, by, S * 0.028, S * 0.010, { seed: o.seed + i, base: o.pale ? 0.34 : 0.22, ramp: o.pale ? 'plaster' : 'wood' });
    // A second-order fork off the tip: two twigs, so the branch structure is
    // still legible where it emerges from the foliage.
    for (let k = 0; k < 2; k++) {
      const a2 = a + (k ? 0.55 : -0.55) + rnd.float(-0.2, 0.2);
      paintLimb(p, mask, bx, by, bx + Math.cos(a2) * S * 0.11, by + Math.sin(a2) * S * 0.11,
        S * 0.010, S * 0.005, { seed: o.seed + i * 3 + k, base: 0.20, ramp: o.pale ? 'plaster' : 'wood' });
    }
    tips.push([bx, by]);
  }

  if (o.weep) {
    // Willow: a broken crown of clumps with foliage strands falling out of the
    // whole underside, not one ellipse with noodles hung off the rim.
    const domeR = S * 0.38;
    const dome = [
      [cx, crownY - S * 0.20, domeR * 0.92, S * 0.15, -0.04],
      [cx - domeR * 0.52, crownY - S * 0.15, domeR * 0.46, S * 0.11, -0.08],
      [cx + domeR * 0.50, crownY - S * 0.16, domeR * 0.44, S * 0.11, -0.06],
      [cx - domeR * 0.20, crownY - S * 0.28, domeR * 0.50, S * 0.12, 0.14],
      [cx + domeR * 0.26, crownY - S * 0.26, domeR * 0.42, S * 0.11, 0.08],
    ];
    dome.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < dome.length; i++) {
      const [dx, dy, rx, ry, bias] = dome[i];
      paintClump(p, mask, dx, dy, rx, ry, {
        ramp: leaf, lo: 0.12, hi: 0.92, seed: o.seed + 40 + i * 13, steps: 5, ragged: 0.56, bias,
      });
    }
    for (let i = 0; i < 46; i++) {
      const t = rnd.float(-1, 1);
      const sx = cx + t * domeR * 1.02;
      const sy = crownY - S * 0.22 + (1 - t * t) * S * 0.05 + rnd.float(0, S * 0.05);
      const len = S * rnd.float(0.10, 0.34) * (1 - t * t * 0.45);
      const shade = 0.26 + rnd.float(0, 0.52);
      const wob = rnd.float(0.09, 0.20);
      for (let k = 0; k < len; k++) {
        const y = sy + k;
        const x = sx + Math.sin(k * wob + i) * S * 0.022 + k * t * 0.06;
        const l = qb(shade + (valueNoise2(x * 0.9, y * 0.9, o.seed) - 0.5) * 0.44 - k / len * 0.14, 5);
        fput(p, Math.round(x), Math.round(y), rampSample(leaf, 0.18 + l * 0.70));
        if (k < len * 0.7 || rnd.bool(0.6)) fput(p, Math.round(x) + 1, Math.round(y), rampSample(leaf, 0.14 + l * 0.6));
        const ii = Math.round(y) * p.w + Math.round(x);
        if (ii >= 0 && ii < mask.length) mask[ii] = 1;
      }
    }
    return;
  }

  // Crown: shadowed underside masses first, then the sunlit caps, so the
  // canopy carries a real top-to-bottom value range instead of one flat green.
  const cr = S * (o.crownR || 0.40);
  // The crown sits clear of the top of the trunk so the limbs and the fork
  // stay visible underneath it. A canopy pulled down over the junction is what
  // turns a tree into a lollipop.
  const cy = crownY - S * 0.24;
  const clumps = [];
  for (const [bx, by] of tips) clumps.push([bx, by, cr * 0.34, cr * 0.28, -0.10]);
  const ring = o.ring === undefined ? 6 : o.ring;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd.float(0, 0.5);
    const rr = cr * rnd.float(0.52, 0.78);
    clumps.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.62,
      cr * rnd.float(0.30, 0.42), cr * rnd.float(0.26, 0.36), 0]);
  }
  clumps.push([cx + rnd.float(-1, 1) * cr * 0.12, cy + cr * 0.12, cr * 0.60, cr * 0.42, -0.08]);
  clumps.push([cx - cr * 0.18, cy - cr * 0.34, cr * 0.44, cr * 0.30, 0.16]);
  clumps.push([cx + cr * 0.26, cy - cr * 0.22, cr * 0.36, cr * 0.26, 0.08]);
  clumps.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < clumps.length; i++) {
    const [x, y, rx, ry, bias] = clumps[i];
    paintClump(p, mask, x, y, rx, ry, {
      ramp: leaf, lo: o.lo === undefined ? 0.18 : o.lo, hi: o.hi === undefined ? 0.86 : o.hi,
      seed: o.seed + i * 17, steps: o.steps || 5,
      ragged: 0.50, bias, tilt: 0.06,
    });
  }
  punchCanopy(p, mask, o.seed + 3, o.holes === undefined ? 0.24 : o.holes, 0.30);
}

/** Conifer: a spiky stack of drooping boughs with the trunk showing between. */
function paintConifer(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const leaf = o.leaf || 'foliage';
  paintTrunk(p, mask, {
    y0: Math.round(S * 0.10), y1: S - 1, cx0: cx, cx1: cx,
    w0: S * 0.010, w1: S * 0.036, base: 0.22, flare: 0.7, seed: o.seed, steps: 6,
  });
  const tiers = o.tiers || 8;
  for (let i = tiers - 1; i >= 0; i--) {
    const t = i / (tiers - 1);
    const yTop = S * (0.09 + t * 0.72);
    const hgt = S * (0.13 + t * 0.13);
    const halfMax = S * (0.050 + t * 0.31) * rnd.float(0.94, 1.06);
    for (let k = 0; k < hgt; k++) {
      const y = Math.round(yTop + k);
      const u = k / Math.max(1, hgt - 1);
      // Boughs droop: the widest point is near the bottom of the tier, and the
      // last rows pull back in, which is what gives a fir its scalloped edge.
      const half = halfMax * (u < 0.80 ? 0.22 + (u / 0.80) * 0.78 : 1 - (u - 0.80) * 2.6);
      for (let x = Math.round(cx - half) - 1; x <= Math.round(cx + half) + 1; x++) {
        const side = (x - cx) / Math.max(1, half);
        const n = valueNoise2(x * 1.15, y * 1.15, o.seed + i * 9);
        // Spiky, per-column needle edge: the silhouette is a saw, never a
        // clean triangle, and it is 1-bit - a texel is needles or it is sky.
        const spike = valueNoise2(x * 0.55, i * 3.7, o.seed + 5);
        if (Math.abs(side) > 0.80 + spike * 0.30) continue;
        if (Math.abs(side) > 0.62 && n < 0.30) continue;
        let l = 0.52 - side * 0.34 - u * 0.44 + (n - 0.5) * 0.70;
        l = 0.10 + 0.86 * clamp(l, 0, 1);
        fput(p, x, y, rampSample(leaf, qb(l, 5)));
        if (x >= 0 && y >= 0 && x < p.w && y < p.h) mask[y * p.w + x] = 1;
      }
    }
    if (o.snow) {
      // A crust of snow along the top of each bough, never on the underside.
      for (let d = 0; d < 2; d++) {
        const y = Math.round(yTop + hgt * (0.10 + d * 0.10));
        const hw = halfMax * (0.35 + d * 0.22);
        for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
          if (valueNoise2(x * 0.8, i * 2.1 + d, o.seed + 71) < 0.40) continue;
          fput(p, x, y, rampSample('ice', d ? 0.58 : 0.78));
        }
      }
    }
  }
  // Leader spike.
  for (let k = 0; k < S * 0.10; k++) {
    const y = Math.round(S * 0.035 + k);
    const half = Math.max(0.6, k * 0.36);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      fput(p, x, y, rampSample(leaf, qb(0.42 + (valueNoise2(x, y, o.seed) - 0.5) * 0.5, 5)));
      if (x >= 0 && y >= 0 && x < p.w && y < p.h) mask[y * p.w + x] = 1;
    }
  }
  punchCanopy(p, mask, o.seed + 9, 0.14, 0.38);
}

/** Palm: a curved ringed bole with a fan of fronds and a few coconuts. */
function paintPalm(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const topY = S * 0.42;
  for (let y = Math.round(topY); y < S; y++) {
    const t = (y - topY) / (S - topY);
    const bx = cx + Math.sin((1 - t) * 1.05) * S * 0.10;
    const hw = S * (0.022 + t * 0.020) * (t > 0.88 ? 1 + (t - 0.88) * 4 : 1);
    for (let x = Math.round(bx - hw); x <= Math.round(bx + hw); x++) {
      const side = (x - bx) / Math.max(0.9, hw);
      // Ring scars every few rows: the palm's stacked leaf bases.
      const rib = (y % 5 === 0) ? -0.18 : (y % 5 === 1 ? 0.12 : 0);
      fput(p, x, y, rampSample('wood', qb(barkTone(x, y, side, 0.36, o.seed) + rib, 6)));
      if (x >= 0 && y >= 0 && x < p.w && y < p.h) mask[y * p.w + x] = 2;
    }
  }
  const hx = cx + Math.sin(1.05) * S * 0.10, hy = topY;
  // Nine fronds fanned symmetrically about the vertical, each drooping under
  // its own weight. The outer ones lie almost flat; the two centre ones stand.
  const NF = 9;
  for (let f = 0; f < NF; f++) {
    const spread = (f / (NF - 1) - 0.5) * 2;                 // -1 .. 1
    const a = -Math.PI * 0.5 + spread * 1.30 + rnd.float(-0.10, 0.10);
    const len = S * (0.42 - Math.abs(spread) * 0.10) * rnd.float(0.9, 1.08);
    const droop = S * (0.14 + (1 - Math.abs(spread)) * 0.26);
    const shade = 0.28 + rnd.float(0, 0.46);
    for (let k = 0; k < len; k++) {
      const u = k / len;
      const x = hx + Math.cos(a) * k;
      const y = hy + Math.sin(a) * k * 0.80 + u * u * droop;
      const halfw = Math.max(0, (1 - u * 0.75) * S * 0.036);
      for (let d = -Math.ceil(halfw); d <= Math.ceil(halfw); d++) {
        if (Math.abs(d) > halfw) continue;
        if (Math.abs(d) > 0.7 && (k + d) % 3 === 0) continue;      // leaflet gaps
        const l = qb(shade + 0.22 - Math.abs(d) / Math.max(1, halfw) * 0.28
          + (valueNoise2(x, y + d, o.seed) - 0.5) * 0.4, 5);
        fput(p, Math.round(x), Math.round(y + d), rampSample('foliage', 0.16 + l * 0.72));
        const ii = Math.round(y + d) * p.w + Math.round(x);
        if (ii >= 0 && ii < mask.length) mask[ii] = 1;
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    paintClump(p, mask, hx + Math.cos(a) * S * 0.03, hy + S * 0.03 + Math.sin(a) * S * 0.015,
      S * 0.022, S * 0.022, { ramp: 'sand', lo: 0.30, hi: 0.70, seed: o.seed + i, steps: 4, ragged: 0.1 });
  }
}

/** A bare, storm-broken trunk: no foliage, so the branch drawing carries it. */
function paintDeadTree(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const topY = S * 0.34;
  paintTrunk(p, mask, {
    y0: Math.round(topY), y1: S - 1, cx0: cx + S * 0.03, cx1: cx,
    w0: S * 0.020, w1: S * 0.052, base: 0.22, flare: 0.7, sway: S * 0.02,
    seed: o.seed, steps: 6,
  });
  const forks = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.5 + (i - 2) * 0.44 + rnd.float(-0.14, 0.14);
    const y0 = topY + rnd.float(0, S * 0.22);
    const len = S * rnd.float(0.16, 0.30);
    const bx = cx + Math.cos(a) * len, by = y0 + Math.sin(a) * len;
    paintLimb(p, mask, cx, y0, bx, by, S * 0.024, S * 0.008, { seed: o.seed + i, base: 0.20 });
    forks.push([bx, by, a]);
  }
  for (const [bx, by, a] of forks) {
    for (let k = 0; k < 2; k++) {
      const a2 = a + (k ? 0.6 : -0.7) + rnd.float(-0.2, 0.2);
      const l2 = S * rnd.float(0.08, 0.16);
      paintLimb(p, mask, bx, by, bx + Math.cos(a2) * l2, by + Math.sin(a2) * l2,
        S * 0.010, S * 0.004, { seed: o.seed + k * 7, base: 0.18 });
    }
  }
}

/** A rounded shrub: three or four clumps on a stubby stem. */
function paintBush(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  paintTrunk(p, mask, {
    y0: Math.round(S * 0.62), y1: S - 1, cx0: cx, cx1: cx,
    w0: S * 0.022, w1: S * 0.034, base: 0.26, flare: 0.5, seed: o.seed, steps: 5,
  });
  const leaf = o.leaf || 'foliage';
  const cy = S * 0.60, cr = S * 0.36;
  const set = [
    [cx, cy + cr * 0.26, cr * 0.92, cr * 0.52, -0.16],
    [cx - cr * 0.50, cy - cr * 0.04, cr * 0.50, cr * 0.42, -0.02],
    [cx + cr * 0.52, cy + cr * 0.06, cr * 0.44, cr * 0.38, -0.08],
    [cx - cr * 0.14, cy - cr * 0.34, cr * 0.56, cr * 0.40, 0.16],
    [cx + cr * 0.30, cy - cr * 0.26, cr * 0.40, cr * 0.32, 0.08],
  ];
  set.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < set.length; i++) {
    const [x, y, rx, ry, bias] = set[i];
    paintClump(p, mask, x, y, rx, ry, {
      ramp: leaf, lo: 0.16, hi: 0.88, seed: o.seed + i * 23, steps: 5, ragged: 0.62, bias,
    });
  }
  punchCanopy(p, mask, o.seed + 2, 0.26, 0.46);
  if (o.berry) {
    for (let i = 0; i < 22; i++) {
      const x = Math.round(cx + rnd.float(-1, 1) * cr * 0.85);
      const y = Math.round(cy + rnd.float(-0.7, 0.7) * cr * 0.7);
      if (!mask[y * p.w + x]) continue;
      fput(p, x, y, rampSample('blood', 0.62 + rnd.float(0, 0.2)));
      if (rnd.bool(0.5)) fput(p, x, y + 1, rampSample('blood', 0.34));
    }
  }
}

/** Blades: tapered, leaning, individually shaded. Used for tufts and reeds. */
function paintBlades(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const { n = 18, rampName = 'grass', lo = 0.22, hi = 0.86, top = 0.30, spread = 0.34, head = 0 } = o;
  for (let i = 0; i < n; i++) {
    const x0 = cx + rnd.float(-1, 1) * S * spread;
    const hgt = S * rnd.float(0.36, 1 - top);
    const lean = rnd.float(-1, 1) * S * 0.14;
    const shade = lo + (hi - lo) * rnd.float(0.25, 1);
    const thick = rnd.float(0.6, 1.6);
    let ty = 0, tx = 0;
    for (let k = 0; k < hgt; k++) {
      const t = k / hgt;
      const y = S - 1 - k;
      const x = x0 + lean * t * t;
      const w = Math.max(0, thick * (1 - t * 0.85));
      for (let d = -Math.floor(w); d <= Math.ceil(w); d++) {
        const l = qb(shade - t * 0.10 + (d < 0 ? 0.08 : -0.10), 5);
        fput(p, Math.round(x + d), y, rampSample(rampName, l));
        const ii = y * p.w + Math.round(x + d);
        if (ii >= 0 && ii < mask.length) mask[ii] = 1;
      }
      ty = y; tx = x;
    }
    if (head && rnd.bool(head)) {
      for (let k = 0; k < S * 0.10; k++) {
        fput(p, Math.round(tx), ty - k, rampSample('wood', qb(0.42 - k * 0.02, 5)));
        fput(p, Math.round(tx) + 1, ty - k, rampSample('wood', 0.28));
      }
    }
  }
}

/** A rock or a boulder: faceted, lit from the upper left, never a soft ball. */
function paintRock(p, mask, rnd, o) {
  const S = p.w, cx = S * 0.5;
  const n = o.n || 3;
  const base = o.ramp || 'stone';
  const set = [];
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const rx = S * (0.34 - k * 0.13) * rnd.float(0.8, 1.2);
    const ry = rx * rnd.float(0.52, 0.80);
    set.push([cx + rnd.float(-1, 1) * S * 0.20, S - 1 - ry * rnd.float(0.7, 1.5) - k * S * 0.06, rx, ry]);
  }
  set.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < set.length; i++) {
    const [x, y, rx, ry] = set[i];
    // Facets, not a sphere: quantise the shading hard and jitter the rim.
    for (let py = Math.floor(y - ry); py <= Math.ceil(y + ry); py++) {
      if (py < 0 || py >= p.h) continue;
      for (let px = Math.floor(x - rx); px <= Math.ceil(x + rx); px++) {
        if (px < 0 || px >= p.w) continue;
        const dx = (px - x) / rx, dy = (py - y) / ry;
        const d2 = dx * dx + dy * dy;
        const nz = valueNoise2(px * 0.30, py * 0.30, o.seed + i * 11);
        if (d2 > 0.80 + (nz - 0.5) * 0.60) continue;
        // Flat facets rather than a shaded ball: quantise a low-frequency noise
        // into four planes and shade each one whole.
        const facet = Math.round(valueNoise2(px * 0.11, py * 0.13, o.seed + i) * 3) / 3;
        const l = 0.08 + 0.62 * clamp(0.46 - dx * 0.26 - dy * 0.40 + (facet - 0.5) * 1.05, 0, 1);
        fput(p, px, py, rampSample(base, qb(l, 5)));
        mask[py * p.w + px] = 1;
      }
    }
  }
}

// --- the entry point -------------------------------------------------------

/**
 * A flora billboard sheet, painted once per kind and cached forever.
 * @param {string} kind
 * @param {number} seed
 */
const _floraCache = new Map();
export function floraTexture(kind, seed = 1) {
  const key = kind + '|' + seed;
  if (_floraCache.has(key)) return _floraCache.get(key);
  const S = TREE_KINDS.has(kind) ? 128 : 64;
  const p = new Pix(S, S);
  p.fill(0, 0, 0, 0);
  const mask = new Uint8Array(S * S);
  const rnd = new Rand(seed * 7919 + kind.length * 131 + 17);
  const sd = (seed * 2654435761 + kind.length * 40503) >>> 8;
  const o = { seed: sd };

  switch (kind) {
    case 'pine': case 'fir':
      paintConifer(p, mask, rnd, { ...o, tiers: 8 });
      break;
    case 'pine_snow':
      paintConifer(p, mask, rnd, { ...o, tiers: 8, snow: 1 });
      break;
    case 'palm':
      paintPalm(p, mask, rnd, o);
      break;
    case 'dead_tree':
      paintDeadTree(p, mask, rnd, o);
      break;
    case 'birch':
      paintBroadleaf(p, mask, rnd, {
        ...o, pale: 1, leaf: 'grass', crownY: 0.44, crownR: 0.30, branches: 4,
        ring: 5, wTop: 0.016, wBot: 0.026, lo: 0.26, hi: 0.98, holes: 0.36, spread: 1.0,
      });
      break;
    case 'willow':
      paintBroadleaf(p, mask, rnd, {
        ...o, weep: 1, leaf: 'swamp', crownY: 0.44, branches: 5, wBot: 0.044,
      });
      break;
    case 'oak_autumn':
      paintBroadleaf(p, mask, rnd, {
        ...o, leaf: 'fire', crownY: 0.52, crownR: 0.40, branches: 5,
        lo: 0.12, hi: 0.56, barkBase: 0.24, holes: 0.26,
      });
      break;
    case 'oak_winter':
      paintDeadTree(p, mask, rnd, o);
      break;
    case 'sapling':
      paintBroadleaf(p, mask, rnd, {
        ...o, leaf: 'grass', crownY: 0.42, crownR: 0.26, branches: 3, ring: 3,
        wTop: 0.010, wBot: 0.018, lo: 0.28, hi: 0.96, holes: 0.34,
      });
      break;
    case 'bush': case 'shrub':
      paintBush(p, mask, rnd, o);
      break;
    case 'bush_berry':
      paintBush(p, mask, rnd, { ...o, berry: 1 });
      break;
    case 'vine':
      paintBush(p, mask, rnd, { ...o, leaf: 'foliage' });
      break;
    case 'fern':
      paintBlades(p, mask, rnd, { ...o, n: 22, rampName: 'foliage', lo: 0.20, hi: 0.80, top: 0.42, spread: 0.40 });
      break;
    case 'grass_tuft':
      paintBlades(p, mask, rnd, { ...o, n: 24, rampName: 'grass', lo: 0.22, hi: 0.92, top: 0.34, spread: 0.30 });
      break;
    case 'reed': case 'reeds':
      paintBlades(p, mask, rnd, { ...o, n: 16, rampName: 'swamp', lo: 0.26, hi: 0.86, top: 0.14, spread: 0.24, head: 0.35 });
      break;
    case 'flowers': case 'flowers_white': case 'flowers_red': {
      paintBlades(p, mask, rnd, { ...o, n: 16, rampName: 'grass', lo: 0.24, hi: 0.82, top: 0.36, spread: 0.34 });
      const petal = kind === 'flowers_red' ? 'blood' : 'plaster';
      for (let i = 0; i < 9; i++) {
        const cx = Math.round(S * 0.5 + rnd.float(-1, 1) * S * 0.32);
        const cy = Math.round(S * (0.40 + rnd.float(0, 0.34)));
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > 2) continue;
            const c = (dx || dy) ? rampSample(petal, kind === 'flowers_red' ? 0.66 : 0.90)
              : rampSample('gold', 0.70);
            fput(p, cx + dx, cy + dy, c);
            const ii = (cy + dy) * S + (cx + dx);
            if (ii >= 0 && ii < mask.length) mask[ii] = 1;
          }
        }
      }
      break;
    }
    case 'cactus': {
      const cx = S * 0.5;
      paintTrunk(p, mask, {
        y0: Math.round(S * 0.14), y1: S - 1, cx0: cx, cx1: cx,
        w0: S * 0.085, w1: S * 0.095, base: 0.30, flare: 0.1,
        seed: sd, steps: 5, ramp: 'foliage',
      });
      for (const s of [-1, 1]) {
        const ay = S * (0.40 + rnd.float(0, 0.16));
        paintLimb(p, mask, cx + s * S * 0.08, ay, cx + s * S * 0.22, ay, S * 0.09, S * 0.08,
          { ramp: 'foliage', base: 0.30, seed: sd + 1, steps: 5 });
        paintTrunk(p, mask, {
          y0: Math.round(ay - S * 0.26), y1: Math.round(ay), cx0: cx + s * S * 0.22, cx1: cx + s * S * 0.22,
          w0: S * 0.055, w1: S * 0.055, base: 0.30, flare: 0, seed: sd + 2, steps: 5, ramp: 'foliage',
        });
      }
      // Ribs and spines.
      for (let y = Math.round(S * 0.14); y < S; y++) {
        for (const dx of [-4, 0, 4]) fput(p, Math.round(cx + dx), y, rampSample('foliage', dx < 0 ? 0.62 : 0.20));
        if (y % 4 === 0) {
          fput(p, Math.round(cx - S * 0.10), y, rampSample('sand', 0.82));
          fput(p, Math.round(cx + S * 0.10), y, rampSample('sand', 0.72));
        }
      }
      break;
    }
    case 'stump': {
      const cx = S * 0.5;
      paintTrunk(p, mask, {
        y0: Math.round(S * 0.42), y1: S - 1, cx0: cx, cx1: cx,
        w0: S * 0.22, w1: S * 0.28, base: 0.24, flare: 0.55, seed: sd, steps: 6,
      });
      // Sawn top: pale heartwood with growth rings.
      for (let y = Math.round(S * 0.42); y < S * 0.52; y++) {
        const t = (y - S * 0.42) / (S * 0.10);
        const hw = S * 0.22 * Math.sqrt(Math.max(0.02, 1 - (1 - t * 2) * (1 - t * 2)));
        for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
          const r = Math.hypot((x - cx) / (S * 0.22), (y - S * 0.47) / (S * 0.05));
          fput(p, x, y, rampSample('wood', qb(0.62 - (Math.round(r * 5) % 2) * 0.16 - t * 0.12, 5)));
          if (x >= 0 && y >= 0 && x < S && y < S) mask[y * S + x] = 2;
        }
      }
      break;
    }
    case 'log': {
      // A felled trunk lying across the frame: a capsule, not a rectangle, with
      // the sawn end showing rings and the bark grain running along its length.
      const cy = S * 0.66, ry = S * 0.20;
      const xa = S * 0.06, xb = S * 0.90;
      for (let y = Math.round(cy - ry); y <= Math.round(cy + ry); y++) {
        const t = (y - cy) / ry;                     // -1 top .. 1 bottom
        const bulge = Math.sqrt(Math.max(0, 1 - t * t));
        for (let x = Math.round(xa); x <= Math.round(xb); x++) {
          // Round both ends off so the silhouette is a lying cylinder.
          const eL = (x - xa) / (ry * 0.9), eR = (xb - x) / (ry * 0.9);
          const cap = Math.min(1, eL, eR);
          if (cap <= 0 || bulge < 1 - cap * cap * 0.9) {
            if (bulge * Math.min(1, cap * 1.6) < 0.12) continue;
          }
          const n = valueNoise2(x * 0.30, y * 1.5, sd);
          let l = 0.52 - Math.abs(t + 0.30) * 0.55 + (n - 0.5) * 0.34;
          if (t > 0.55) l -= 0.18;                   // shadowed underside
          fput(p, x, y, rampSample('wood', qb(l, 6)));
          if (y >= 0 && y < S) mask[y * S + x] = 2;
        }
      }
      // Sawn end: heartwood rings, lighter than the bark.
      const ex = Math.round(xb - ry * 0.55);
      for (let y = Math.round(cy - ry); y <= Math.round(cy + ry); y++) {
        const t = (y - cy) / ry;
        const bulge = Math.sqrt(Math.max(0, 1 - t * t));
        for (let x = ex; x <= Math.round(ex + ry * 0.55 * bulge); x++) {
          const r = Math.hypot((x - ex) / (ry * 0.55), t);
          fput(p, x, y, rampSample('wood', qb(0.72 - (Math.round(r * 5) % 2) * 0.16 - Math.abs(t) * 0.12, 5)));
        }
      }
      // A couple of broken stubs on top.
      for (let i = 0; i < 3; i++) {
        const bx = S * (0.24 + i * 0.24);
        paintLimb(p, mask, bx, cy - ry * 0.6, bx + rnd.float(-1, 1) * S * 0.10, cy - ry * 0.6 - S * 0.12,
          S * 0.045, S * 0.015, { seed: sd + i, base: 0.24 });
      }
      break;
    }
    case 'mushroom': case 'mushroom_cluster': case 'mushroom_giant': {
      const big = kind === 'mushroom_giant';
      const n = big ? 1 : 4;
      for (let i = 0; i < n; i++) {
        const cx = S * 0.5 + (big ? 0 : rnd.float(-1, 1) * S * 0.26);
        const hgt = S * (big ? 0.60 : rnd.float(0.26, 0.46));
        paintTrunk(p, mask, {
          y0: Math.round(S - 1 - hgt), y1: S - 1, cx0: cx, cx1: cx,
          w0: S * (big ? 0.09 : 0.035), w1: S * (big ? 0.12 : 0.045),
          base: 0.62, flare: 0.4, seed: sd + i, steps: 5, ramp: 'plaster',
        });
        const capR = S * (big ? 0.36 : 0.14);
        for (let y = Math.round(S - 1 - hgt - capR * 0.8); y <= Math.round(S - 1 - hgt + capR * 0.2); y++) {
          const t = clamp((y - (S - 1 - hgt - capR * 0.8)) / (capR), 0, 1);
          const hw = capR * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
          for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
            const side = (x - cx) / Math.max(1, hw);
            const l = qb(0.60 - side * 0.30 - t * 0.36 + (valueNoise2(x, y, sd) - 0.5) * 0.3, 5);
            fput(p, x, y, rampSample(big ? 'arcane' : 'blood', l));
            if (y >= 0 && y < S && x >= 0 && x < S) mask[y * S + x] = 1;
          }
        }
      }
      break;
    }
    case 'rock': case 'rock_small':
      paintRock(p, mask, rnd, { ...o, n: 3, ramp: 'stone' });
      break;
    case 'rock_large':
      paintRock(p, mask, rnd, { ...o, n: 4, ramp: 'stone' });
      break;
    case 'boulder':
      paintRock(p, mask, rnd, { ...o, n: 2, ramp: 'grey' });
      break;
    default:
      // The workhorse broadleaf. MM6 swapped tree sprites by season - tree01,
      // tree04 and tree10 each had an autumn and a winter variant - so the
      // autumn tree is the same silhouette painted out of the fire ramp.
      paintBroadleaf(p, mask, rnd, {
        ...o, leaf: 'foliage', crownY: 0.52, crownR: 0.42, branches: 5, ring: 6,
        lo: 0.18, hi: 0.94, holes: 0.30,
      });
      break;
  }

  bleedAlpha(p, 3);
  // dither 0: MM6's software renderer never dithered - it swapped between 32
  // pre-darkened palettes, so its art bands instead. An ordered dither on a
  // sprite this small reads as a checkerboard fringe along the silhouette.
  const tex = toTexture(p, { dither: 0, repeat: false, mips: true });
  _floraCache.set(key, tex);
  return tex;
}
