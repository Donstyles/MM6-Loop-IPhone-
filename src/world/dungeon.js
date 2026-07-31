import * as THREE from 'three';
import { Rand, clamp, smoothstep, lerpN, hash2, valueNoise2 } from '../core/rng.js';
import { getTexture, makeBillboardField } from './terrain.js';
import { MeshBuilder, materialFor, addProp } from './building.js';
import { Pix, toTexture, rampSample, scaleC, mixC } from '../art/texcanvas.js';

// ---------------------------------------------------------------------------
// Dungeons.
//
// The signature MM6 dungeon image is a black corridor with a warm pool of
// torchlight on the floor and the wall behind the torch blown out to orange,
// everything beyond falling to nothing. That is all baked: MM6 stored a light
// value per vertex and drew with no lights at all. We do exactly the same -
// bake torch falloff into vertex colours over a 256-unit lattice, then merge
// everything into a handful of draw calls.
//
// Layout is a cell grid rather than free-floating boxes, because a grid gives
// correct doorway openings and wall/floor risers for free.
// ---------------------------------------------------------------------------

export const DUNGEON_THEMES = [
  'cave', 'crypt', 'sewer', 'temple', 'mine', 'castle',
  'tower', 'lair', 'ruins', 'ice', 'volcano',
];

/**
 * Indoors MM6 narrows the camera from 75 deg horizontal to 60. It is a very
 * noticeable snap on entering a dungeon and the shell must apply it.
 */
export const INDOOR_HFOV_DEG = 60;
export const OUTDOOR_HFOV_DEG = 75;
export const DUNGEON_FOG_NEAR = 512;
export const DUNGEON_FOG_FAR = 3000;
/** graphics.torchlight_distance: 800 units of radius per power level. */
export const TORCHLIGHT_RADIUS = 800;

const THEME = {
  cave: {
    wall: 'dun_cave', floor: 'dun_floor_dirt', ceil: 'dun_ceiling_cave',
    ambDim: 28, torch: [1.00, 0.62, 0.26], torchRange: 1133,
    roomH: [560, 1000], corrH: 560, organic: 0.42, liquid: 'water', pillars: 0.15,
  },
  crypt: {
    wall: 'dun_tomb', floor: 'dun_floor_stone', ceil: 'dun_ceiling_stone',
    ambDim: 27, torch: [0.96, 0.60, 0.30], torchRange: 1025,
    roomH: [520, 780], corrH: 512, organic: 0, liquid: 'water', pillars: 0.45,
  },
  sewer: {
    wall: 'dun_sewer', floor: 'dun_floor_stone', ceil: 'dun_ceiling_stone',
    ambDim: 27, torch: [0.90, 0.68, 0.34], torchRange: 972,
    roomH: [512, 700], corrH: 512, organic: 0.1, liquid: 'swamp_water', liquidChance: 0.5, pillars: 0.3,
  },
  temple: {
    wall: 'dun_temple', floor: 'dun_floor_tile', ceil: 'dun_ceiling_stone',
    ambDim: 25, torch: [1.00, 0.80, 0.44], torchRange: 1241,
    roomH: [700, 1150], corrH: 620, organic: 0, liquid: 'water', pillars: 0.6,
  },
  mine: {
    wall: 'dun_cave_dark', floor: 'dun_floor_dirt', ceil: 'dun_ceiling_cave',
    ambDim: 28, torch: [1.00, 0.58, 0.22], torchRange: 972,
    roomH: [520, 820], corrH: 512, organic: 0.3, liquid: 'water', pillars: 0.35,
  },
  castle: {
    wall: 'dun_brick', floor: 'dun_floor_stone', ceil: 'dun_ceiling_stone',
    ambDim: 26, torch: [1.00, 0.72, 0.36], torchRange: 1133,
    roomH: [620, 1000], corrH: 560, organic: 0, liquid: 'water', pillars: 0.4,
  },
  tower: {
    wall: 'dun_brick_mossy', floor: 'dun_floor_stone', ceil: 'dun_ceiling_stone',
    ambDim: 26, torch: [0.96, 0.70, 0.38], torchRange: 1080,
    roomH: [560, 900], corrH: 512, organic: 0, liquid: 'water', pillars: 0.3,
  },
  lair: {
    wall: 'dun_cave', floor: 'dun_floor_dirt', ceil: 'dun_ceiling_cave',
    ambDim: 28, torch: [1.00, 0.52, 0.20], torchRange: 1080,
    roomH: [700, 1250], corrH: 620, organic: 0.5, liquid: 'lava', liquidChance: 0.25, pillars: 0.2,
  },
  ruins: {
    wall: 'dun_brick_mossy', floor: 'dun_floor_stone', ceil: 'dun_ceiling_stone',
    ambDim: 27, torch: [0.94, 0.66, 0.34], torchRange: 1080,
    roomH: [560, 900], corrH: 520, organic: 0.25, liquid: 'water', liquidChance: 0.35, pillars: 0.5,
  },
  ice: {
    wall: 'dun_ice', floor: 'dun_ice', ceil: 'dun_ice',
    ambDim: 24, torch: [0.72, 0.86, 1.00], torchRange: 1296,
    roomH: [620, 1050], corrH: 560, organic: 0.35, liquid: 'water', pillars: 0.25,
  },
  volcano: {
    wall: 'dun_lava_rock', floor: 'dun_lava_rock', ceil: 'dun_ceiling_cave',
    ambDim: 27, torch: [1.00, 0.48, 0.16], torchRange: 1188,
    roomH: [660, 1200], corrH: 620, organic: 0.4, liquid: 'lava', liquidChance: 0.6, pillars: 0.25,
  },
};

const CELL = 512;
const GRID = 56;
const LEVEL_DROP = 620;
const SUB = 2;              // floor/ceiling subdivision, 256-unit lighting lattice
const SUB_V = 3;            // wall vertical subdivision

const SRGB_TO_LIN = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// --- torch flame sprite ----------------------------------------------------
let _flameTex = null;
function flameTexture() {
  if (_flameTex) return _flameTex;
  const S = 32;
  const p = new Pix(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x - S / 2 + 0.5) / (S / 2);
      const v = 1 - y / (S - 1);                     // 0 at top of image = flame tip
      const w = 0.62 * Math.sin(Math.PI * clamp(v * 1.05, 0, 1)) * (0.55 + 0.45 * v);
      const n = valueNoise2(x * 0.5, y * 0.4, 71) * 0.35;
      const d = Math.abs(u) / Math.max(0.02, w) - n;
      if (d > 1) { p.set(x, y, 0, 0, 0, 0); continue; }
      const core = 1 - smoothstep(0.15, 0.9, d);
      const col = mixC(rampSample('fire', 0.45 + v * 0.25), rampSample('gold', 0.95), core * (1 - v * 0.4));
      p.setArr(x, y, col, Math.round(clamp(1 - smoothstep(0.55, 1.0, d), 0, 1) * 255));
    }
  }
  _flameTex = toTexture(p, { dither: 6, repeat: false, mips: false, magNearest: false });
  return _flameTex;
}

// --- light baking ----------------------------------------------------------

class LightGrid {
  constructor(torches, cellSize = 1024) {
    this.cs = cellSize;
    this.map = new Map();
    this.torches = torches;
    for (let i = 0; i < torches.length; i++) {
      const t = torches[i];
      const gi = Math.floor(t.x / cellSize), gj = Math.floor(t.z / cellSize);
      const rad = Math.ceil(t.range / cellSize);
      for (let j = gj - rad; j <= gj + rad; j++) {
        for (let k = gi - rad; k <= gi + rad; k++) {
          const key = k * 100003 + j;
          let l = this.map.get(key);
          if (!l) { l = []; this.map.set(key, l); }
          l.push(t);
        }
      }
    }
  }
  near(x, z) {
    return this.map.get(Math.floor(x / this.cs) * 100003 + Math.floor(z / this.cs));
  }
}

/**
 * Bake sector ambient + all torches at one vertex.
 *
 * MM6 lights are *monochrome*: the engine accumulates a 0..31 dimming level
 * with a linear `lightlevel += 30*dist/radius - 30` falloff, clamps it, and
 * turns it into a single grey multiplier `8*(31-dim)`. There is no coloured
 * light anywhere in MM6, so the warmth of a torch-lit corridor comes entirely
 * from the wall texture and the flame sprite, not from the light itself.
 */
function shadeVertex(grid, ambDim, x, y, z, nx, ny, nz, out) {
  // Start at the sector's ambient dimming level (31 = pitch black).
  let dim = ambDim;
  const list = grid.near(x, z);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const dx = t.x - x, dy = t.y - y, dz = t.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > t.range * t.range) continue;
      const d = Math.sqrt(d2) || 1;
      // -30 at the source, 0 at the radius, linear between.
      let contrib = (30 * d / t.range - 30) * t.power;
      // Facing the light matters; a wall edge-on to a torch stays dark.
      const ndl = clamp((dx * nx + dy * ny + dz * nz) / d, 0, 1);
      contrib *= 0.35 + 0.65 * ndl;
      dim += contrib;
    }
  }
  const g = SRGB_TO_LIN((8 * (31 - clamp(Math.round(dim), 0, 31))) / 255);
  out[0] = g; out[1] = g; out[2] = g;
  return out;
}

const _c = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _tmp = [0, 0, 0];

/**
 * Emit a quad subdivided su x sv, lighting every generated vertex.
 * p00..p01 are the corners in winding order (p00,p10,p11,p01).
 */
function litQuad(b, grid, ambDim, tex, p00, p10, p11, p01, su, sv, uu, vv, tint) {
  let nx = 0, ny = 0, nz = 0;
  {
    const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2];
    const vx = p01[0] - p00[0], vy = p01[1] - p00[1], vz = p01[2] - p00[2];
    nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= il; ny *= il; nz *= il;
  }
  const lerp3 = (a, c, t, o) => { o[0] = a[0] + (c[0] - a[0]) * t; o[1] = a[1] + (c[1] - a[1]) * t; o[2] = a[2] + (c[2] - a[2]) * t; return o; };
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  for (let j = 0; j < sv; j++) {
    const v0 = j / sv, v1 = (j + 1) / sv;
    for (let i = 0; i < su; i++) {
      const u0 = i / su, u1 = (i + 1) / su;
      // Bilinear corner positions.
      const at = (u, v, o) => {
        const t0 = [p00[0] + (p10[0] - p00[0]) * u, p00[1] + (p10[1] - p00[1]) * u, p00[2] + (p10[2] - p00[2]) * u];
        const t1 = [p01[0] + (p11[0] - p01[0]) * u, p01[1] + (p11[1] - p01[1]) * u, p01[2] + (p11[2] - p01[2]) * u];
        return lerp3(t0, t1, v, o);
      };
      at(u0, v0, A); at(u1, v0, B); at(u1, v1, C); at(u0, v1, D);
      const cols = [
        shadeVertex(grid, ambDim, A[0], A[1], A[2], nx, ny, nz, [0, 0, 0]),
        shadeVertex(grid, ambDim, B[0], B[1], B[2], nx, ny, nz, [0, 0, 0]),
        shadeVertex(grid, ambDim, C[0], C[1], C[2], nx, ny, nz, [0, 0, 0]),
        shadeVertex(grid, ambDim, D[0], D[1], D[2], nx, ny, nz, [0, 0, 0]),
      ];
      if (tint) for (const cc of cols) { cc[0] *= tint[0]; cc[1] *= tint[1]; cc[2] *= tint[2]; }
      b.quad(tex, A.slice(), B.slice(), C.slice(), D.slice(), {
        colors: cols,
        uvs: [[u0 * uu, v0 * vv], [u1 * uu, v0 * vv], [u1 * uu, v1 * vv], [u0 * uu, v1 * vv]],
      });
    }
  }
}

// --- generation ------------------------------------------------------------

/**
 * @param {object} spec { theme, name, rooms, levels, difficulty, depth, seed }
 * @param {number|string} seed
 * @param {(p:number,label:string)=>void} [onProgress]
 */
export function generateDungeon(spec = {}, seed = 1, onProgress) {
  const r = new Rand(typeof seed === 'string' ? seed : (seed >>> 0) ^ 0x9e37);
  const theme = THEME[spec.theme] ? spec.theme : 'cave';
  const T = THEME[theme];
  const prog = onProgress || (() => { });
  const roomTarget = spec.rooms || r.int(12, 20);
  const levels = clamp(spec.levels || r.int(2, 4), 1, 4);
  const difficulty = spec.difficulty || 1;

  prog(0.05, 'carving rooms');

  // --- room placement -----------------------------------------------------
  const rooms = [];
  const occupied = new Uint8Array(GRID * GRID);
  const at = (i, j) => (j >= 0 && j < GRID && i >= 0 && i < GRID ? occupied[j * GRID + i] : 1);

  let tries = 0;
  while (rooms.length < roomTarget && tries < roomTarget * 40) {
    tries++;
    const w = r.int(3, 7), h = r.int(3, 7);
    const i0 = r.int(2, GRID - w - 3), j0 = r.int(2, GRID - h - 3);
    let free = true;
    for (let j = j0 - 2; j < j0 + h + 2 && free; j++) {
      for (let i = i0 - 2; i < i0 + w + 2; i++) if (at(i, j)) { free = false; break; }
    }
    if (!free) continue;
    for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) occupied[j * GRID + i] = 1;
    rooms.push({
      index: rooms.length, i0, j0, w, h,
      ci: i0 + w / 2, cj: j0 + h / 2,
      level: 0, height: r.float(T.roomH[0], T.roomH[1]),
      edges: [], depth: 0,
    });
  }
  if (rooms.length < 3) throw new Error('dungeon: not enough room');

  // --- connect: nearest-neighbour spanning tree plus a few loops ----------
  prog(0.15, 'linking corridors');
  const inTree = [rooms[0]];
  const rest = rooms.slice(1);
  const links = [];
  while (rest.length) {
    let best = null;
    for (const a of inTree) {
      for (let k = 0; k < rest.length; k++) {
        const b = rest[k];
        const d = Math.hypot(a.ci - b.ci, a.cj - b.cj);
        if (!best || d < best.d) best = { a, b, k, d };
      }
    }
    links.push({ a: best.a.index, b: best.b.index });
    best.a.edges.push(best.b.index);
    best.b.edges.push(best.a.index);
    inTree.push(best.b);
    rest.splice(best.k, 1);
  }
  const extra = Math.max(1, Math.round(rooms.length * 0.22));
  for (let k = 0; k < extra; k++) {
    const a = r.pick(rooms), b = r.pick(rooms);
    if (a === b || a.edges.includes(b.index)) continue;
    if (Math.hypot(a.ci - b.ci, a.cj - b.cj) > 18) continue;
    links.push({ a: a.index, b: b.index, loop: true });
    a.edges.push(b.index); b.edges.push(a.index);
  }

  // --- levels: BFS outward, stepping down every few rooms -----------------
  const seen = new Uint8Array(rooms.length);
  const q = [0]; seen[0] = 1; rooms[0].depth = 0; rooms[0].level = 0;
  while (q.length) {
    const cur = rooms[q.shift()];
    for (const e of cur.edges) {
      if (seen[e]) continue;
      seen[e] = 1;
      const nr = rooms[e];
      nr.depth = cur.depth + 1;
      nr.level = clamp(cur.level + (r.bool(0.34) ? 1 : 0), 0, levels - 1);
      q.push(e);
    }
  }
  for (const rm of rooms) rm.floorY = -rm.level * LEVEL_DROP;

  // Boss room: deepest, biggest, and given headroom.
  let boss = rooms[0];
  for (const rm of rooms) if (rm.depth > boss.depth || (rm.depth === boss.depth && rm.w * rm.h > boss.w * boss.h)) boss = rm;
  boss.boss = true;
  boss.height = Math.max(boss.height, T.roomH[1] * 1.25);
  const start = rooms.reduce((a, b) => (a.depth <= b.depth ? a : b));
  start.start = true;

  // --- cell grid ----------------------------------------------------------
  prog(0.28, 'building cells');
  const cells = new Map();   // key -> cell record
  const key = (i, j) => j * GRID + i;
  const put = (i, j, rec) => {
    if (i < 1 || j < 1 || i >= GRID - 1 || j >= GRID - 1) return null;
    const k = key(i, j);
    const ex = cells.get(k);
    if (ex) return ex;
    cells.set(k, rec);
    return rec;
  };

  for (const rm of rooms) {
    for (let j = rm.j0; j < rm.j0 + rm.h; j++) {
      for (let i = rm.i0; i < rm.i0 + rm.w; i++) {
        // Organic themes chew the corners off so caves are not boxes.
        if (T.organic > 0) {
          const edge = Math.min(i - rm.i0, rm.i0 + rm.w - 1 - i, j - rm.j0, rm.j0 + rm.h - 1 - j);
          if (edge === 0 && hash2(i, j, 4242) < T.organic && !(rm.w <= 3 || rm.h <= 3)) continue;
        }
        put(i, j, {
          i, j, fy: rm.floorY, gx: 0, gz: 0, h: rm.height,
          room: rm.index, kind: 'room',
        });
      }
    }
  }

  // Corridors: L-shaped, floor lerped between the two rooms so level changes
  // become ramps rather than teleports.
  const doorSpots = [];
  for (const ln of links) {
    const a = rooms[ln.a], b = rooms[ln.b];
    const ai = Math.floor(a.ci), aj = Math.floor(a.cj);
    const bi = Math.floor(b.ci), bj = Math.floor(b.cj);
    const path = [];
    const bendFirstX = r.bool();
    if (bendFirstX) {
      for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) path.push([i, aj]);
      for (let j = Math.min(aj, bj); j <= Math.max(aj, bj); j++) path.push([bi, j]);
    } else {
      for (let j = Math.min(aj, bj); j <= Math.max(aj, bj); j++) path.push([ai, j]);
      for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) path.push([i, bj]);
    }
    // Order the path from a to b so the height lerp runs the right way.
    path.sort((p, q2) => (Math.hypot(p[0] - ai, p[1] - aj) - Math.hypot(q2[0] - ai, q2[1] - aj)));
    const n = path.length;
    const dy = b.floorY - a.floorY;
    for (let s = 0; s < n; s++) {
      const [i, j] = path[s];
      const k = key(i, j);
      if (cells.has(k)) continue;
      const t = n <= 1 ? 0 : s / (n - 1);
      const fy = a.floorY + dy * t;
      const nxt = path[Math.min(n - 1, s + 1)], prv = path[Math.max(0, s - 1)];
      const slope = n <= 1 ? 0 : dy / (n - 1) / CELL;
      const gx = nxt[0] !== prv[0] ? slope * Math.sign(nxt[0] - prv[0]) : 0;
      const gz = nxt[1] !== prv[1] ? slope * Math.sign(nxt[1] - prv[1]) : 0;
      put(i, j, { i, j, fy, gx, gz, h: T.corrH, room: -1, kind: 'corridor', link: links.indexOf(ln) });
    }
    // Remember where the corridor meets each room, for doors.
    for (const rm of [a, b]) {
      for (let s = 0; s < n; s++) {
        const [i, j] = path[s];
        const inside = i >= rm.i0 && i < rm.i0 + rm.w && j >= rm.j0 && j < rm.j0 + rm.h;
        if (!inside) continue;
        const prev = path[Math.max(0, s - 1)], next2 = path[Math.min(n - 1, s + 1)];
        const out = (prev[0] === i && prev[1] === j) ? next2 : prev;
        if (out[0] === i && out[1] === j) break;
        doorSpots.push({
          i, j, di: Math.sign(out[0] - i), dj: Math.sign(out[1] - j),
          room: rm.index, secret: !!ln.loop && r.bool(0.35),
        });
        break;
      }
    }
  }

  // Liquid pools in some rooms.
  const pools = [];
  if (T.liquidChance === undefined || r.bool(T.liquidChance !== undefined ? T.liquidChance : 0.35)) {
    const nPools = r.int(1, Math.max(1, Math.round(rooms.length * 0.2)));
    for (let p = 0; p < nPools; p++) {
      const rm = r.pick(rooms);
      if (rm.start || rm.w < 4 || rm.h < 4) continue;
      const pi = rm.i0 + r.int(1, rm.w - 3), pj = rm.j0 + r.int(1, rm.h - 3);
      const pw = r.int(2, Math.min(3, rm.w - 2)), ph = r.int(2, Math.min(3, rm.h - 2));
      for (let j = pj; j < pj + ph; j++) {
        for (let i = pi; i < pi + pw; i++) {
          const c = cells.get(key(i, j));
          if (c && c.kind === 'room') { c.liquid = T.liquid; c.fy -= 90; }
        }
      }
      pools.push({ x: (pi + pw / 2) * CELL, z: (pj + ph / 2) * CELL, kind: T.liquid, room: rm.index });
    }
  }

  // --- torches ------------------------------------------------------------
  prog(0.42, 'lighting');
  const torches = [];
  const solid = (i, j) => !cells.has(key(i, j));
  const addTorch = (x, y, z, col, power, range, kind) => {
    torches.push({ x, y, z, col, power, range, kind });
  };
  for (const [k, c] of cells) {
    const wx = c.i * CELL + CELL / 2, wz = c.j * CELL + CELL / 2;
    const rm = c.room >= 0 ? rooms[c.room] : null;
    // Torches have to be *sparse*. The MM6 dungeon image is a pool of warm
    // light with black corridor either side of it; space them closer than
    // about two light radii apart and the pools merge into flat room lighting,
    // which is the single easiest way to lose the look.
    const density = c.kind === 'corridor' ? 6 : (rm && rm.boss ? 4 : 5);
    if ((c.i * 7 + c.j * 13) % density !== 0) continue;
    // Hang the torch on whichever side has a wall.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [di, dj] of dirs) {
      if (!solid(c.i + di, c.j + dj)) continue;
      if (hash2(c.i, c.j, 99) < 0.35) continue;
      const tx = wx + di * (CELL / 2 - 60), tz = wz + dj * (CELL / 2 - 60);
      addTorch(tx, c.fy + 330, tz, T.torch, 1.45, T.torchRange, 'wall');
      torches[torches.length - 1].nx = -di; torches[torches.length - 1].nz = -dj;
      break;
    }
  }
  // Boss room gets braziers in the corners, and pools of lava light themselves.
  {
    const rm = boss;
    for (const [oi, oj] of [[1, 1], [rm.w - 2, 1], [1, rm.h - 2], [rm.w - 2, rm.h - 2]]) {
      const i = rm.i0 + oi, j = rm.j0 + oj;
      if (!cells.has(key(i, j))) continue;
      addTorch(i * CELL + CELL / 2, rm.floorY + 300, j * CELL + CELL / 2, T.torch, 1.9, T.torchRange * 1.35, 'brazier');
    }
  }
  for (const p of pools) {
    if (p.kind === 'lava') addTorch(p.x, -0 + (cells.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))) || { fy: 0 }).fy + 60, p.z, [1.0, 0.42, 0.12], 1.1, 1400, 'lava');
  }
  const grid = new LightGrid(torches);
  const ambDim = T.ambDim;

  // --- geometry -----------------------------------------------------------
  prog(0.55, 'meshing');
  const b = new MeshBuilder();
  const cy = (c, dx, dz) => c.fy + c.gx * dx * CELL + c.gz * dz * CELL;
  const ceilOf = (c, dx, dz) => cy(c, dx, dz) + c.h;

  for (const [k, c] of cells) {
    const x0 = c.i * CELL, x1 = x0 + CELL;
    const z0 = c.j * CELL, z1 = z0 + CELL;
    const f00 = cy(c, -0.5, -0.5), f10 = cy(c, 0.5, -0.5), f11 = cy(c, 0.5, 0.5), f01 = cy(c, -0.5, 0.5);

    // Floor (counter-clockwise seen from above -> normal +Y).
    const ftex = c.liquid ? c.liquid : (c.kind === 'corridor' ? T.floor : T.floor);
    litQuad(b, grid, ambDim, ftex,
      [x0, f01, z1], [x1, f11, z1], [x1, f10, z0], [x0, f00, z0], SUB, SUB, 1, 1,
      // Lava faces are self-lit: they ignore the dimming level entirely.
      c.liquid === 'lava' ? [2.8, 2.8, 2.8] : null);

    // Ceiling.
    const cc0 = ceilOf(c, -0.5, -0.5), cc1 = ceilOf(c, 0.5, -0.5), cc2 = ceilOf(c, 0.5, 0.5), cc3 = ceilOf(c, -0.5, 0.5);
    litQuad(b, grid, ambDim, T.ceil,
      [x0, cc0, z0], [x1, cc1, z0], [x1, cc2, z1], [x0, cc3, z1], SUB, SUB, 1, 1, null);

    // Walls and risers, one edge at a time.
    const edges = [
      { di: 0, dj: -1, a: [x0, f00, z0], bp: [x1, f10, z0], ca: cc0, cb: cc1, ci: -0.5, cj: -0.5 },
      { di: 1, dj: 0, a: [x1, f10, z0], bp: [x1, f11, z1], ca: cc1, cb: cc2 },
      { di: 0, dj: 1, a: [x1, f11, z1], bp: [x0, f01, z1], ca: cc2, cb: cc3 },
      { di: -1, dj: 0, a: [x0, f01, z1], bp: [x0, f00, z0], ca: cc3, cb: cc0 },
    ];
    for (const e of edges) {
      const nb = cells.get(key(c.i + e.di, c.j + e.dj));
      const A = e.a, B = e.bp;
      if (!nb) {
        litQuad(b, grid, ambDim, T.wall,
          [A[0], A[1], A[2]], [B[0], B[1], B[2]], [B[0], e.cb, B[2]], [A[0], e.ca, A[2]],
          2, SUB_V, 1, Math.max(1, (e.ca - A[1]) / 400));
      } else {
        // Shared edge between two open cells: close any vertical gap.
        const na = cornerOfNeighbour(nb, e, A, cy);
        const nbh = cornerOfNeighbour(nb, e, B, cy);
        if (Math.abs(na - A[1]) > 4 || Math.abs(nbh - B[1]) > 4) {
          const lo = [A[1], B[1]], hi = [na, nbh];
          if (hi[0] > lo[0] || hi[1] > lo[1]) {
            litQuad(b, grid, ambDim, T.wall,
              [A[0], A[1], A[2]], [B[0], B[1], B[2]], [B[0], Math.max(B[1], nbh), B[2]], [A[0], Math.max(A[1], na), A[2]],
              2, 1, 1, 0.3);
          }
        }
        const nca = cornerOfNeighbourCeil(nb, e, A, ceilOf);
        const ncb = cornerOfNeighbourCeil(nb, e, B, ceilOf);
        if (nca < e.ca - 4 || ncb < e.cb - 4) {
          litQuad(b, grid, ambDim, T.wall,
            [A[0], Math.min(e.ca, nca), A[2]], [B[0], Math.min(e.cb, ncb), B[2]],
            [B[0], e.cb, B[2]], [A[0], e.ca, A[2]], 2, 1, 1, 0.4);
        }
      }
    }
  }

  // Pillars in the larger rooms.
  const pillarColliders = [];
  for (const rm of rooms) {
    if (rm.w < 5 || rm.h < 5) continue;
    if (!r.bool(T.pillars)) continue;
    const inset = 1;
    for (const oi of [inset, rm.w - 1 - inset]) {
      for (const oj of [inset, rm.h - 1 - inset]) {
        const i = rm.i0 + oi, j = rm.j0 + oj;
        const c = cells.get(key(i, j));
        if (!c || c.liquid) continue;
        const x = i * CELL + CELL / 2, z = j * CELL + CELL / 2;
        const pw = 90;
        const sub = new MeshBuilder();
        // Pillars are lit at their four faces individually so they catch the
        // torchlight edge-on, which is what sells the depth of a room.
        for (const [dx, dz, ux, uz] of [[0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0], [-1, 0, 0, 1]]) {
          const px = x + dx * pw, pz = z + dz * pw;
          litQuad(b, grid, ambDim, T.wall,
            [px - ux * pw, c.fy, pz - uz * pw], [px + ux * pw, c.fy, pz + uz * pw],
            [px + ux * pw, c.fy + rm.height, pz + uz * pw], [px - ux * pw, c.fy + rm.height, pz - uz * pw],
            1, SUB_V, 0.6, rm.height / 400);
        }
        pillarColliders.push({ type: 'obb', x, z, hw: pw, hd: pw, rot: 0, y0: c.fy, y1: c.fy + rm.height });
      }
    }
  }

  // --- doors, chests, levers ---------------------------------------------
  prog(0.75, 'furnishing');
  const doors = [];
  const doorMeshes = [];
  const dseen = new Set();
  for (const ds of doorSpots) {
    const k = `${ds.i},${ds.j},${ds.di},${ds.dj}`;
    if (dseen.has(k)) continue;
    dseen.add(k);
    const c = cells.get(key(ds.i, ds.j));
    if (!c) continue;
    const x = ds.i * CELL + CELL / 2 + ds.di * CELL * 0.5;
    const z = ds.j * CELL + CELL / 2 + ds.dj * CELL * 0.5;
    const w = 300, h = 400;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    const col = shadeVertex(grid, ambDim, x, c.fy + h / 2, z, -ds.di, 0, -ds.dj, [0, 0, 0]);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(
      [col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]], 3));
    const tex = ds.secret ? T.wall : 'door_dungeon';
    const mesh = new THREE.Mesh(geo, materialFor(tex));
    mesh.position.set(x, c.fy, z);
    mesh.rotation.y = Math.atan2(-ds.di, -ds.dj);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.userData.door = {
      kind: ds.secret ? 'secret' : 'dungeon',
      secret: ds.secret, locked: !ds.secret && r.bool(0.18),
      open: false, room: ds.room, w, h,
      pos: mesh.position.clone(),
    };
    mesh.name = ds.secret ? 'secretdoor' : 'door';
    doorMeshes.push(mesh);
    doors.push(mesh.userData.door);
  }

  const chests = [];
  const chestBuilder = new MeshBuilder();
  for (const rm of rooms) {
    const n = rm.boss ? 2 : (r.bool(0.42) ? 1 : 0);
    for (let c = 0; c < n; c++) {
      const i = rm.i0 + r.int(0, rm.w - 1), j = rm.j0 + r.int(0, rm.h - 1);
      const cell = cells.get(key(i, j));
      if (!cell || cell.liquid) continue;
      const x = i * CELL + CELL / 2 + r.float(-120, 120);
      const z = j * CELL + CELL / 2 + r.float(-120, 120);
      const rot = r.float(0, 6.283);
      const sub = new MeshBuilder();
      sub.box('dun_wood', -110, 0, -70, 110, 110, 70, { sides: 'nsewt', uu: 0.6, vv: 0.3 });
      sub.box('dun_metal', -115, 110, -75, 115, 160, 75, { sides: 'nsewt', uu: 0.6, vv: 0.2 });
      const lightCol = shadeVertex(grid, ambDim, x, cell.fy + 90, z, 0, 1, 0, [0, 0, 0]);
      // Push the baked colour of the chest's spot into every one of its verts.
      for (const [, part] of sub.parts) {
        for (let vi = 0; vi < part.col.length; vi += 3) {
          part.col[vi] *= 1; part.col[vi + 1] *= 1; part.col[vi + 2] *= 1;
          part.col[vi] = lightCol[0] * (0.6 + part.col[vi] * 0.9);
          part.col[vi + 1] = lightCol[1] * (0.6 + part.col[vi + 1] * 0.9);
          part.col[vi + 2] = lightCol[2] * (0.6 + part.col[vi + 2] * 0.9);
        }
      }
      chestBuilder.absorb(sub, new THREE.Matrix4().makeRotationY(rot).setPosition(x, cell.fy, z));
      chests.push({
        x, y: cell.fy, z, rot, room: rm.index,
        locked: r.bool(0.35), trapped: r.bool(0.25),
        tier: rm.boss ? 3 : clamp(1 + Math.floor(rm.depth / 3), 1, 3),
        opened: false,
      });
    }
  }
  b.absorb(chestBuilder);

  // Torch brackets, merged into the main buffer.
  for (const t of torches) {
    if (t.kind === 'lava') continue;
    const sub = new MeshBuilder();
    if (t.kind === 'brazier') {
      sub.box('dun_metal', -60, -300, -60, 60, -60, 60, { sides: 'nsew', uu: 0.4, vv: 0.6 });
      sub.box('dun_metal', -90, -60, -90, 90, 20, 90, { sides: 'nsewt', uu: 0.5, vv: 0.2 });
    } else {
      sub.box('dun_metal', -18, -110, -18, 18, 20, 18, { sides: 'nsew', uu: 0.2, vv: 0.3 });
    }
    // The bracket sits inside its own light, so it is at dim 0 - full bright.
    for (const [, part] of sub.parts) {
      for (let vi = 0; vi < part.col.length; vi += 3) {
        part.col[vi] = 0.92; part.col[vi + 1] = 0.92; part.col[vi + 2] = 0.92;
      }
    }
    b.absorb(sub, new THREE.Matrix4().setPosition(t.x, t.y, t.z));
  }

  // --- spawns -------------------------------------------------------------
  const spawns = [];
  const table = spec.spawnTable || null;
  for (const rm of rooms) {
    if (rm.start) continue;
    const count = rm.boss ? r.int(2, 4) : r.int(1, 3);
    for (let c = 0; c < count; c++) {
      const i = rm.i0 + r.int(0, rm.w - 1), j = rm.j0 + r.int(0, rm.h - 1);
      const cell = cells.get(key(i, j));
      if (!cell) continue;
      spawns.push({
        x: i * CELL + CELL / 2 + r.float(-160, 160),
        y: cell.fy,
        z: j * CELL + CELL / 2 + r.float(-160, 160),
        room: rm.index,
        boss: !!rm.boss && c === 0,
        // Deeper rooms get harder things in them, MM6's usual arrangement.
        level: clamp(difficulty + Math.floor(rm.depth / 2), 1, 20),
        id: table ? new Rand(r.int(1e9)).pick(table) : null,
      });
    }
  }

  const traps = [];
  for (const rm of rooms) {
    if (rm.start || !r.bool(0.3)) continue;
    const i = rm.i0 + r.int(0, rm.w - 1), j = rm.j0 + r.int(0, rm.h - 1);
    const cell = cells.get(key(i, j));
    if (cell) traps.push({ x: i * CELL + CELL / 2, y: cell.fy, z: j * CELL + CELL / 2, kind: r.pick(['dart', 'gas', 'pit', 'rune']), level: difficulty });
  }
  const levers = [];
  for (let i = 0; i < r.int(1, 3); i++) {
    const rm = r.pick(rooms);
    const cell = cells.get(key(rm.i0, rm.j0));
    if (cell) levers.push({ x: rm.i0 * CELL + CELL / 2, y: cell.fy + 260, z: rm.j0 * CELL + CELL / 2, room: rm.index, on: false });
  }

  // --- assemble -----------------------------------------------------------
  prog(0.9, 'assembling');
  const group = new THREE.Group();
  group.name = 'dungeon:' + (spec.name || theme);
  const mesh = b.finish({ fog: true });
  if (mesh) { mesh.updateMatrix(); group.add(mesh); }
  for (const dm of doorMeshes) group.add(dm);

  // Flames: one instanced additive batch for every torch in the level.
  const flameInst = torches.filter((t) => t.kind !== 'lava').map((t) => ({
    x: t.x, y: t.y - 10, z: t.z, w: t.kind === 'brazier' ? 220 : 130, h: t.kind === 'brazier' ? 280 : 190,
    tint: [1, 1, 1],
  }));
  const flames = flameInst.length ? makeBillboardField(flameTexture(), flameInst, {
    fogColor: 0x000000, fogNear: 2000, fogFar: 3000,
  }) : null;
  if (flames) {
    flames.material.blending = THREE.AdditiveBlending;
    flames.material.depthWrite = false;
    flames.renderOrder = 10;
    group.add(flames);
  }

  const startCell = cells.get(key(Math.floor(start.ci), Math.floor(start.cj)));
  const startPos = new THREE.Vector3(
    Math.floor(start.ci) * CELL + CELL / 2,
    (startCell ? startCell.fy : 0) + 160,
    Math.floor(start.cj) * CELL + CELL / 2,
  );

  // Collision: hand back the grid itself, which is far cheaper for the shell
  // to query than a few thousand boxes.
  const solidGrid = new Uint8Array(GRID * GRID);
  const floorGrid = new Float32Array(GRID * GRID);
  const ceilGrid = new Float32Array(GRID * GRID);
  solidGrid.fill(1);
  for (const [k, c] of cells) {
    solidGrid[k] = 0; floorGrid[k] = c.fy; ceilGrid[k] = c.fy + c.h;
  }

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
  for (const [, c] of cells) {
    minX = Math.min(minX, c.i * CELL); maxX = Math.max(maxX, (c.i + 1) * CELL);
    minZ = Math.min(minZ, c.j * CELL); maxZ = Math.max(maxZ, (c.j + 1) * CELL);
    minY = Math.min(minY, c.fy); maxY = Math.max(maxY, c.fy + c.h);
  }

  let flick = 0;
  prog(1, 'done');

  return {
    group, theme, name: spec.name || theme,
    rooms: rooms.map((rm) => ({
      index: rm.index, x: (rm.i0 + rm.w / 2) * CELL, z: (rm.j0 + rm.h / 2) * CELL,
      y: rm.floorY, w: rm.w * CELL, d: rm.h * CELL, height: rm.height,
      level: rm.level, depth: rm.depth, boss: !!rm.boss, start: !!rm.start,
    })),
    doors, doorMeshes, chests, spawns, traps, levers, pools, torches,
    colliders: [{ type: 'grid', cell: CELL, w: GRID, h: GRID, solid: solidGrid, floor: floorGrid, ceil: ceilGrid }]
      .concat(pillarColliders),
    start: startPos,
    exits: [{ x: startPos.x, y: startPos.y, z: startPos.z, kind: 'surface', to: spec.exitTo || null }],
    bounds: {
      min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ),
      x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: Math.hypot(maxX - minX, maxZ - minZ) / 2,
    },
    triangles: b.tris,
    update(dt, camera) {
      if (flames) {
        flames.userData.updateBillboard(camera);
        // Flicker: jitter the per-instance tint. Cheap, no reallocation, and
        // it is the only animation in a dungeon that matters.
        flick += dt;
        const a = flames.geometry.attributes.iTint.array;
        for (let i = 0; i < flameInst.length; i++) {
          const f = 0.78 + 0.22 * Math.sin(flick * 11 + i * 2.3) + 0.10 * Math.sin(flick * 27.3 + i);
          a[i * 3] = f; a[i * 3 + 1] = f * 0.96; a[i * 3 + 2] = f * 0.9;
        }
        flames.geometry.attributes.iTint.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
}

/** Height of the neighbouring cell's floor at the shared corner `p`. */
function cornerOfNeighbour(nb, e, p, cy) {
  const lx = p[0] / CELL - nb.i, lz = p[2] / CELL - nb.j;
  return cy(nb, clamp(lx - 0.5, -0.5, 0.5), clamp(lz - 0.5, -0.5, 0.5));
}
function cornerOfNeighbourCeil(nb, e, p, ceilOf) {
  const lx = p[0] / CELL - nb.i, lz = p[2] / CELL - nb.j;
  return ceilOf(nb, clamp(lx - 0.5, -0.5, 0.5), clamp(lz - 0.5, -0.5, 0.5));
}
