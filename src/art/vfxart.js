import { Pix, toTexture, mixC } from './texcanvas.js';
import { ramp, snap } from '../core/palette.js';
import { Rand, clamp, hash2, tileFbm2 } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Spell and impact effect sheets.
//
// MM6's magic is a strip of hand-drawn animation frames blitted as a masked
// sprite: a fireball is eight frames of a tumbling flame ball, an explosion is
// ten frames of a bloom that ends in smoke. There is no blending - the frames
// are 1-bit masked against the world, and "transparency" is faked with a
// checkerboard stipple. Everything here is drawn that way on purpose: hard
// edges, chunky quantised bands, and colours that only ever come out of the
// palette ramps.
//
// Each effect becomes one atlas: frames left to right, wrapping to further
// rows so no atlas is wider than 1024px. The exported sheet has the same shape
// the entity renderer already consumes, so effects go through the same
// SpriteBatch as monsters.
// ---------------------------------------------------------------------------

const MAX_ATLAS_W = 1024;

// --- colour families -------------------------------------------------------
// Every effect samples one of these lookup tables. They are built from ramp()
// key colours and mixed, then the whole atlas is snapped back to the palette,
// so nothing escapes the 256 entries.

// Each entry is snapped to the palette here, once, so the finished atlas is
// already 8-bit and needs no per-pixel quantisation pass - which for a megabyte
// of effect frames is most of the build time.
function makeLUT(keys, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * (keys.length - 1);
    const a = keys[Math.floor(s)], b = keys[Math.min(keys.length - 1, Math.floor(s) + 1)];
    const c = mixC(a, b, s - Math.floor(s));
    out.push(snap(c[0], c[1], c[2]));
  }
  return out;
}

const W = ramp('grey', 15);
const mix = (a, b, t) => mixC(a, b, t);

const LUT_FIRE = makeLUT([ramp('fire', 1), ramp('fire', 4), ramp('fire', 7), ramp('fire', 10),
  ramp('fire', 13), ramp('fire', 15), ramp('gold', 14), ramp('gold', 15), W]);
// Smoke and dust stay in the brown half of the palette; the stone ramp is cold
// blue-grey and reads as ash on a bright day, which is not what we want.
const LUT_SMOKE = makeLUT([ramp('grey', 1), ramp('dirt', 2), ramp('wood', 4), ramp('dirt', 5),
  ramp('dirt', 7), ramp('grey', 8)]);
const LUT_ICE = makeLUT([ramp('ice', 2), ramp('ice', 5), ramp('ice', 8), ramp('ice', 11),
  ramp('ice', 14), ramp('ice', 15), W]);
const LUT_POISON = makeLUT([ramp('foliage', 2), ramp('foliage', 6), ramp('foliage', 10),
  ramp('grass', 10), ramp('grass', 13), ramp('grass', 15), ramp('swamp', 15)]);
const LUT_ACID = makeLUT([ramp('foliage', 4), ramp('foliage', 9), ramp('grass', 11),
  ramp('grass', 14), ramp('grass', 15), mix(ramp('grass', 15), W, 0.6)]);
const LUT_STONE = makeLUT([ramp('stone', 1), ramp('stone', 4), ramp('stone', 7), ramp('stone', 10),
  ramp('stone', 13), ramp('stone', 15)]);
const LUT_DUST = makeLUT([ramp('dirt', 1), ramp('dirt', 3), ramp('dirt', 6), ramp('dirt', 9),
  ramp('sand', 9), ramp('sand', 12)]);
// Steel is the one thing that must stay neutral: the stone ramp is warm, and
// blades built from it read as brass.
const LUT_STEEL = makeLUT([ramp('grey', 2), ramp('grey', 5), ramp('grey', 8), ramp('grey', 11),
  ramp('grey', 13), ramp('grey', 15), W]);
const LUT_GOLD = makeLUT([ramp('gold', 2), ramp('gold', 6), ramp('gold', 10), ramp('gold', 13),
  ramp('gold', 15), mix(ramp('gold', 15), W, 0.55), W]);
const LUT_HOLY = makeLUT([ramp('gold', 5), ramp('gold', 10), ramp('gold', 14), ramp('gold', 15),
  mix(ramp('gold', 15), W, 0.6), W, W]);
const LUT_ARCANE = makeLUT([ramp('arcane', 0), ramp('arcane', 2), ramp('arcane', 4),
  ramp('arcane', 6), ramp('arcane', 7), mix(ramp('arcane', 7), W, 0.55), W]);
const LUT_DARK = makeLUT([ramp('grey', 0), ramp('arcane', 0), ramp('arcane', 1), ramp('arcane', 3),
  ramp('arcane', 5), ramp('arcane', 7)]);
// "Magenta" has to stay inside the arcane purples: the palette has no pink, so
// mixing toward blood only snaps back to dull orange.
const LUT_MAGENTA = makeLUT([ramp('arcane', 1), ramp('arcane', 3), ramp('arcane', 5),
  ramp('arcane', 6), ramp('arcane', 7), mix(ramp('arcane', 7), W, 0.5), W]);
const LUT_BLOOD = makeLUT([ramp('blood', 1), ramp('blood', 4), ramp('blood', 7), ramp('blood', 10),
  ramp('blood', 13), ramp('blood', 15)]);
const LUT_SPARK = makeLUT([ramp('fire', 9), ramp('fire', 13), ramp('gold', 13), ramp('gold', 15),
  mix(ramp('gold', 15), W, 0.7), W]);
const LUT_WOOD = makeLUT([ramp('wood', 1), ramp('wood', 4), ramp('wood', 7), ramp('wood', 10),
  ramp('wood', 13)]);
const LUT_PALE = makeLUT([ramp('sky', 5), ramp('sky', 9), ramp('ice', 12), ramp('grey', 13),
  ramp('grey', 15), W]);

/** Sample a LUT with t in [0,1]. No allocation - LUT entries are shared. */
function lut(table, t) {
  const i = Math.round(clamp(t, 0, 1) * (table.length - 1));
  return table[i];
}

// --- raster primitives -----------------------------------------------------
// All of these write full-opacity pixels only; the mask is 1-bit by
// construction. `mode` 0 overwrites, 1 keeps whichever pixel is brighter
// (the cheap stand-in for additive blending on a masked sprite), 2 only
// fills holes.

const SET = 0, MAX = 1, UNDER = 2;

function putMode(p, x, y, c, mode) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4, d = p.data;
  if (mode !== SET && d[i + 3] !== 0) {
    if (mode === UNDER) return;
    if (d[i] + d[i + 1] + d[i + 2] >= c[0] + c[1] + c[2]) return;
  }
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
}

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
/** Ordered-dither mask test: `amount` 1 keeps everything, 0 nothing. */
function keeps(x, y, amount) {
  return (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 < amount;
}

/** 50% checker - the era's transparency. */
function checker(x, y) { return ((x + y) & 1) === 0; }

/** Punch pixels out with an ordered dither, for fading a frame away. */
function erode(p, keepAmount) {
  if (keepAmount >= 1) return;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (keeps(x, y, keepAmount)) continue;
      p.data[(y * p.w + x) * 4 + 3] = 0;
    }
  }
}

/**
 * A filled lump with an angularly wobbled radius and hard, banded shading.
 * This is the workhorse: flame balls, puffs, smoke and glows are all blobs.
 * `cf(t)` is asked for a colour with t=1 at the centre, 0 at the rim.
 */
function blob(p, cx, cy, r, cf, o = {}) {
  const wob = o.wob || 0, lobes = o.lobes || 5, phase = o.phase || 0;
  const bands = o.bands || 6, mode = o.mode === undefined ? MAX : o.mode;
  const squash = o.squash || 1, seed = o.seed || 0, keep = o.keep === undefined ? 1 : o.keep;
  const chk = o.checker || false;
  const rx = r, ry = r * squash;
  if (rx < 0.4 || ry < 0.4) return;
  const ex = rx * (1 + wob) + 1, ey = ry * (1 + wob) + 1;
  const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(p.w - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(p.h - 1, Math.ceil(cy + ey));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 + wob) continue;
      let edge = 1;
      if (wob > 0) {
        const a = Math.atan2(dy, dx);
        edge = 1 + wob * (0.62 * Math.sin(lobes * a + phase) + 0.38 * Math.sin((lobes * 2 + 1) * a - phase * 1.7 + seed));
      }
      if (d > edge) continue;
      if (chk && !checker(x, y)) continue;
      if (keep < 1 && !keeps(x, y, keep)) continue;
      const t = 1 - d / edge;
      putMode(p, x, y, cf((Math.floor(t * bands) + 0.5) / bands), mode);
    }
  }
}

/** Hollow banded ring / annulus. `cf(t)` gets t=1 at the ring's centreline. */
function ringShape(p, cx, cy, r, thick, cf, o = {}) {
  const squash = o.squash || 1, wob = o.wob || 0, lobes = o.lobes || 6, phase = o.phase || 0;
  const bands = o.bands || 4, mode = o.mode === undefined ? MAX : o.mode;
  const keep = o.keep === undefined ? 1 : o.keep, chk = o.checker || false;
  if (r < 0.5 || thick <= 0) return;
  const rx = r, ry = r * squash, tw = thick / r;
  const ex = rx * (1 + wob) + thick + 1, ey = ry * (1 + wob) + thick + 1;
  const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(p.w - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(p.h - 1, Math.ceil(cy + ey));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const d = Math.sqrt(dx * dx + dy * dy);
      let edge = 1;
      if (wob > 0) {
        const a = Math.atan2(dy, dx);
        edge = 1 + wob * Math.sin(lobes * a + phase);
      }
      const s = 1 - Math.abs(d - edge) / tw;
      if (s <= 0) continue;
      if (chk && !checker(x, y)) continue;
      if (keep < 1 && !keeps(x, y, keep)) continue;
      putMode(p, x, y, cf((Math.floor(s * bands) + 0.5) / bands), mode);
    }
  }
}

/** Filled disc; `cf(t, x, y, s)` with t=1 at the centre, s passed through. */
function disc(p, cx, cy, r, cf, mode = MAX, s = 0) {
  if (r < 0.55) { putMode(p, Math.round(cx - 0.5), Math.round(cy - 0.5), cf(1, cx, cy, s), mode); return; }
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(p.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(p.h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      putMode(p, x, y, cf(1 - d / r, x, y, s), mode);
    }
  }
}

/** Thick line, stamped as a run of discs so joins never gap. */
function stroke(p, x0, y0, x1, y1, rad, cf, mode = MAX, rad1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len * 1.6));
  const r1 = rad1 === undefined ? rad : rad1;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    disc(p, x0 + dx * s, y0 + dy * s, rad + (r1 - rad) * s, cf, mode, s);
  }
}

/** Even-odd scanline polygon fill. `pts` is [[x,y],...]. */
function poly(p, pts, cf, mode = MAX) {
  let minY = 1e9, maxY = -1e9;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][1] < minY) minY = pts[i][1];
    if (pts[i][1] > maxY) maxY = pts[i][1];
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(p.h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k] - 0.5)), xb = Math.min(p.w - 1, Math.round(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) {
        const c = cf(x, y, (x + 0.5 - xs[k]) / Math.max(0.001, xs[k + 1] - xs[k]));
        if (c) putMode(p, x, y, c, mode);
      }
    }
  }
}

/** Tapered spike from an inner to an outer radius - rays, star points, blades. */
function spike(p, cx, cy, ang, rIn, rOut, halfWide, cf, mode = MAX) {
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  poly(p, [
    [cx + dx * rIn + nx * halfWide, cy + dy * rIn + ny * halfWide],
    [cx + dx * rOut, cy + dy * rOut],
    [cx + dx * rIn - nx * halfWide, cy + dy * rIn - ny * halfWide],
  ], cf, mode);
}

/**
 * A licking tongue of flame rising from (cx, baseY). The waviness is built out
 * of sine harmonics in `t` (the 0..1 animation phase) with integer frequencies,
 * so the animation loops exactly - torches and campfires must not pop.
 */
function flameColumn(p, cx, baseY, halfW, height, o = {}) {
  const t = o.t || 0, seed = o.seed || 0, cf = o.cf || ((v) => lut(LUT_FIRE, v));
  const bands = o.bands || 6, taper = o.taper === undefined ? 0.85 : o.taper;
  const sway = o.sway === undefined ? 0.4 : o.sway;
  const mode = o.mode === undefined ? MAX : o.mode;
  const hotBias = o.hot === undefined ? 0 : o.hot;
  for (let y = 0; y < height; y++) {
    const v = y / height;
    const off = halfW * v * (sway * Math.sin(2 * Math.PI * (v - t) + seed)
      + sway * 0.6 * Math.sin(2 * Math.PI * (2 * v - 2 * t) + seed * 1.7));
    const wmul = 0.86 + 0.34 * Math.sin(2 * Math.PI * (2 * v - t) + seed * 2.3)
      + 0.2 * Math.sin(2 * Math.PI * (3 * v - 2 * t) + seed);
    const hw = halfW * Math.pow(Math.max(0, 1 - v), taper) * wmul;
    if (hw <= 0.45) continue;
    const yy = baseY - y;
    if (yy < 0 || yy >= p.h) continue;
    const xc = cx + off;
    for (let x = Math.floor(xc - hw); x <= Math.ceil(xc + hw); x++) {
      const u = (x + 0.5 - xc) / hw;
      if (u < -1 || u > 1) continue;
      const hot = clamp((1 - Math.abs(u) * 0.72) * (1 - v * 0.7) + 0.08 + hotBias, 0, 1);
      putMode(p, x, yy, cf((Math.floor(hot * bands) + 0.5) / bands), mode);
    }
  }
}

/** A jagged polyline with a coloured glow and a hot 1px core. */
function bolt(p, pts, glowR, coreR, glowLut, o = {}) {
  const mode = o.mode === undefined ? MAX : o.mode;
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], glowR,
      (t) => lut(glowLut, 0.25 + t * 0.45), mode);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], coreR,
      () => W, mode);
  }
}

// --- per-effect painters ---------------------------------------------------

function fireBall(p, f, n, o) {
  const cx = p.w / 2, cy = p.h / 2;
  const R = Math.min(p.w, p.h) * (o.r || 0.42);
  const ph = (f / n) * Math.PI * 2;
  const rnd = new Rand(101 + f * 7717);
  // Ragged dark-red envelope, then a hotter body, then a small white-yellow
  // core offset around the middle so the ball reads as tumbling. The lobe
  // count changes every frame - a flame that keeps its silhouette looks like a
  // spinning logo, not fire.
  const lobes = 4 + (f % 3);
  blob(p, cx, cy, R, (t) => lut(LUT_FIRE, t * 0.42), { wob: 0.3, lobes, phase: ph, bands: 5, seed: f });
  for (let i = 0; i < 4; i++) {
    const a = rnd.float(0, Math.PI * 2);
    const d = R * rnd.float(0.6, 0.92);
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rnd.float(0.2, 0.36),
      (t) => lut(LUT_FIRE, 0.06 + t * 0.34), { wob: 0.4, lobes: 3, phase: ph + i * 2, bands: 4, seed: i + f });
  }
  const ox = Math.cos(ph * 2) * R * 0.17, oy = Math.sin(ph * 2) * R * 0.14;
  blob(p, cx + ox, cy + oy, R * 0.66, (t) => lut(LUT_FIRE, 0.34 + t * 0.52),
    { wob: 0.22, lobes: lobes + 1, phase: -ph, bands: 5, seed: f * 3 });
  blob(p, cx + ox * 1.6, cy + oy * 1.6, R * 0.3, (t) => lut(LUT_FIRE, 0.82 + t * 0.3),
    { wob: 0.2, lobes: 3, phase: ph * 1.5, bands: 3 });
}

function fireBurst(p, f, n) {
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.46;
  const t = f / (n - 1);
  const r = R * (0.18 + 0.82 * Math.pow(t, 0.5));
  const ph = t * 5;
  if (t < 0.72) {
    // Outer orange bloom.
    blob(p, cx, cy, r, (v) => lut(LUT_FIRE, 0.12 + v * 0.62), { wob: 0.24, lobes: 6, phase: ph, bands: 6, seed: 3 });
    // Petals of flame punching out of the ball.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + ph * 0.4;
      blob(p, cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, r * 0.34 * (1 - t * 0.4),
        (v) => lut(LUT_FIRE, 0.2 + v * 0.55), { wob: 0.4, lobes: 3, phase: a * 2 + ph, bands: 4, seed: i });
    }
    // White-yellow core, biggest at the front of the blast then eaten away.
    const cr = r * (0.72 - t * 1.05);
    if (cr > 0.6) blob(p, cx, cy, cr, (v) => lut(LUT_FIRE, 0.72 + v * 0.35), { wob: 0.16, lobes: 4, phase: -ph, bands: 4 });
  }
  if (t > 0.5) {
    // Smoke takes over: small dark puffs punched through the flame, stippled so
    // the fire behind them still shows.
    const s = (t - 0.5) / 0.5;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.6;
      const rr = r * (0.3 + 0.5 * s);
      blob(p, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr - s * R * 0.22, r * (0.2 + 0.14 * s),
        (v) => lut(LUT_SMOKE, 0.06 + v * 0.4 * (1 - s * 0.4)),
        { wob: 0.36, lobes: 4, phase: a + s * 3, bands: 4, seed: i * 3, mode: SET, checker: true });
    }
  }
  if (t > 0.75) erode(p, 1 - (t - 0.75) / 0.25 * 0.85);
}

function flamePillar(p, f, n) {
  const t = f / n;
  const base = p.h - 1;
  flameColumn(p, p.w * 0.5, base, p.w * 0.3, p.h * 0.98, { t, seed: 0.4, bands: 6 });
  flameColumn(p, p.w * 0.34, base, p.w * 0.15, p.h * 0.66, { t, seed: 2.1, bands: 5 });
  flameColumn(p, p.w * 0.66, base, p.w * 0.15, p.h * 0.6, { t, seed: 4.3, bands: 5 });
  // Embers riding up the column.
  for (let i = 0; i < 6; i++) {
    const ph = (t + i / 6) % 1;
    const y = base - ph * p.h * 0.95;
    const x = p.w * 0.5 + Math.sin(i * 2.3 + ph * 5) * p.w * 0.26;
    disc(p, x, y, ph > 0.7 ? 0.6 : 1.2, () => lut(LUT_SPARK, 0.7 + (1 - ph) * 0.3));
  }
}

function immolationAura(p, f, n) {
  const t = f / n;
  const cx = p.w / 2, cy = p.h * 0.72;
  const rx = p.w * 0.42, ry = p.h * 0.16;
  ringShape(p, cx, cy, rx, 2.4, (v) => lut(LUT_FIRE, 0.4 + v * 0.4), { squash: ry / rx, bands: 3, wob: 0.06, phase: t * 6 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    const hgt = p.h * (0.24 + 0.22 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t + i / 12) * 1 + i)));
    flameColumn(p, x, y, p.w * 0.075, hgt, { t: (t + i * 0.11) % 1, seed: i * 1.7, bands: 5, taper: 0.7 });
  }
}

function lightning(p, f, n) {
  const rnd = new Rand(9000 + f * 613);
  const pts = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    const y = 1 + v * (p.h - 3);
    const x = p.w * 0.5 + rnd.float(-1, 1) * p.w * 0.3 * Math.sin(Math.PI * v) + (v - 0.5) * p.w * 0.1;
    pts.push([x, y]);
  }
  bolt(p, pts, 3.2, 1.3, LUT_ICE);
  // Forks peeling off the main channel.
  for (let b = 0; b < 4; b++) {
    const i = rnd.int(1, steps - 2);
    const br = [pts[i].slice()];
    const dir = rnd.bool() ? 1 : -1;
    for (let k = 1; k <= 3; k++) {
      br.push([br[k - 1][0] + dir * rnd.float(2, p.w * 0.18), br[k - 1][1] + rnd.float(2, p.h * 0.13)]);
    }
    bolt(p, br, 2.0, 0.8, LUT_ICE);
  }
}

function sparkShower(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const rnd = new Rand(51 + f * 977);
  const R = p.w * 0.45;
  disc(p, cx, cy, R * (0.3 - t * 0.25) + 0.5, (v) => lut(LUT_SPARK, 0.6 + v * 0.4));
  for (let i = 0; i < 14; i++) {
    const a = rnd.float(0, Math.PI * 2);
    const d = R * (0.2 + 0.8 * t) * rnd.float(0.5, 1.15);
    const l = R * 0.26 * (1 - t * 0.5);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    stroke(p, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.9,
      (v, _x, _y, s) => lut(LUT_SPARK, 0.95 - s * 0.65));
  }
  if (t > 0.55) erode(p, 1 - (t - 0.55) / 0.45 * 0.7);
}

function iceShard(p, f, n) {
  const cx = p.w / 2, cy = p.h / 2;
  const ang = (f / n) * Math.PI * 2;
  const L = p.h * 0.44, Wd = p.w * 0.17;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pr = (lx, ly) => [cx + lx * ca - ly * sa, cy + lx * sa + ly * ca];
  const pts = [pr(0, -L), pr(Wd, -L * 0.2), pr(Wd * 0.62, L * 0.55), pr(0, L), pr(-Wd * 0.62, L * 0.55), pr(-Wd, -L * 0.2)];
  poly(p, pts, (x, y) => {
    // Facet shading from the local x axis: the leading edge catches the light.
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const lx = (dx * ca + dy * sa) / Wd;
    const ly = (-dx * sa + dy * ca) / L;
    const v = clamp(0.62 - lx * 0.5 - ly * 0.18, 0, 1);
    return lut(LUT_ICE, (Math.floor(v * 5) + 0.5) / 5);
  }, SET);
  // Rim light plus a hard specular glint.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (i > 1 && i < 4) continue;
    stroke(p, a[0], a[1], b[0], b[1], 0.7, () => lut(LUT_ICE, 0.86), MAX);
  }
  const g = pr(-Wd * 0.35, -L * 0.3);
  disc(p, g[0], g[1], 1.6, (v) => (v > 0.4 ? W : lut(LUT_ICE, 0.9)));
}

function iceBurst(p, f, n) {
  const cx = p.w / 2, cy = p.h / 2;
  const t = f / (n - 1);
  const R = p.w * 0.46;
  if (t < 0.35) blob(p, cx, cy, R * (0.5 - t), (v) => lut(LUT_ICE, 0.6 + v * 0.45), { wob: 0.2, lobes: 6, phase: t * 8, bands: 4 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const d = R * (0.12 + 0.95 * t);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const L = R * 0.3 * (1 - t * 0.45), Wd = R * 0.1 * (1 - t * 0.4);
    const ca = Math.cos(a + 1.57), sa = Math.sin(a + 1.57);
    const pr = (lx, ly) => [x + lx * ca - ly * sa, y + lx * sa + ly * ca];
    poly(p, [pr(0, -L), pr(Wd, 0), pr(0, L * 0.6), pr(-Wd, 0)],
      (px2) => lut(LUT_ICE, 0.4 + ((px2 * 7 + i) % 3) * 0.2), SET);
    stroke(p, x, y, x - Math.cos(a) * L * 0.9, y - Math.sin(a) * L * 0.9, 0.7,
      (v, _x, _y, s) => lut(LUT_ICE, 0.85 - s * 0.5));
  }
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.8);
}

function frostCloud(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.55;
  const R = p.w * 0.24 * (0.6 + t * 0.9);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + t * 1.2;
    const d = R * (0.1 + 0.95 * t) * (0.6 + 0.5 * Math.sin(i * 2.1));
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7 - t * p.h * 0.12, R * (0.9 - i * 0.05),
      (v) => lut(LUT_ICE, 0.32 + v * 0.6), { wob: 0.3, lobes: 4, phase: a + t * 4, bands: 4, seed: i, checker: true });
  }
  // A few solid crystals so the puff has something crisp in it.
  const rnd = new Rand(77 + f);
  for (let i = 0; i < 5; i++) {
    const a = rnd.float(0, 6.28), d = R * rnd.float(0.2, 1.1);
    disc(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75, 1.1, () => lut(LUT_ICE, 0.95));
  }
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.8);
}

function poisonCloud(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.56;
  const R = p.w * 0.2 * (0.55 + t * 1.05);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + t * 1.6 + i;
    const d = R * (0.15 + 0.9 * t) * (0.5 + 0.6 * Math.sin(i * 1.7 + t * 3));
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75 - t * p.h * 0.1, R * (1.0 - i * 0.045),
      (v) => lut(LUT_POISON, 0.2 + v * 0.7), { wob: 0.34, lobes: 4, phase: a * 1.3 + t * 5, bands: 4, seed: i, checker: true });
  }
  // Bright droplets suspended in the vapour.
  const rnd = new Rand(311 + f * 31);
  for (let i = 0; i < 7; i++) {
    const a = rnd.float(0, 6.28), d = R * rnd.float(0.15, 1.05);
    disc(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, rnd.float(0.7, 1.7),
      (v) => lut(LUT_POISON, 0.8 + v * 0.2));
  }
  if (t > 0.65) erode(p, 1 - (t - 0.65) / 0.35 * 0.85);
}

function acidSplash(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.55;
  const R = p.w * 0.44;
  blob(p, cx, cy + t * p.h * 0.1, R * (0.42 - t * 0.3) + 1, (v) => lut(LUT_ACID, 0.4 + v * 0.6),
    { wob: 0.3, lobes: 5, phase: t * 6, bands: 4 });
  const rnd = new Rand(1201);
  for (let i = 0; i < 12; i++) {
    const a = rnd.float(-Math.PI, 0.2) - 0.1;
    const sp = rnd.float(0.5, 1.1);
    const d = R * sp * t;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d + R * t * t * 0.9;   // droplets arc back down
    const r = rnd.float(2.2, 4.6) * (1 - t * 0.25);
    blob(p, x, y, r, (v) => lut(LUT_ACID, 0.35 + v * 0.65), { wob: 0.25, lobes: 3, phase: i, bands: 4 });
    stroke(p, x, y, x - Math.cos(a) * r * 2, y - Math.sin(a) * r * 2, 0.8,
      (v, _x, _y, s) => lut(LUT_ACID, 0.75 - s * 0.45), MAX);
  }
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.7);
}

function rockShard(p, f, n) {
  const cx = p.w / 2, cy = p.h / 2;
  const ang = (f / n) * Math.PI * 2;
  const R = p.w * 0.34;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pts = [];
  const rnd = new Rand(4242);
  const radii = [];
  for (let i = 0; i < 7; i++) radii.push(R * rnd.float(0.55, 1.05));
  for (let i = 0; i < 7; i++) {
    const a = ang + (i / 7) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * radii[i], cy + Math.sin(a) * radii[i] * 0.92]);
  }
  poly(p, pts, (x, y) => {
    // Shade in the rock's own frame so the facets turn with it - shading fixed
    // to the screen makes a tumbling stone look like a static one.
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const lx = (dx * ca + dy * sa) / R, ly = (-dx * sa + dy * ca) / R;
    const v = clamp(0.36 - lx * 0.3 - ly * 0.26, 0, 1);
    return lut(LUT_STONE, (Math.floor(v * 5) + 0.5) / 5);
  }, SET);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) * 0.5 - cx, my = (a[1] + b[1]) * 0.5 - cy;
    const lit = (mx * ca + my * sa) + (-mx * sa + my * ca) < 0;
    stroke(p, a[0], a[1], b[0], b[1], 0.6, () => lut(LUT_STONE, lit ? 0.95 : 0.06), SET);
  }
}

function earthBurst(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.82;
  const R = p.w * 0.45;
  // Dust plume: brown, rising, and stippled once it thins out.
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.1 + 0.8 * (i / 6));
    const d = R * (0.2 + 0.8 * t);
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.95 - t * R * 0.2, R * (0.26 + 0.2 * t),
      (v) => lut(LUT_DUST, 0.12 + v * 0.55), { wob: 0.34, lobes: 4, phase: a * 2 + t * 4, bands: 4, seed: i, checker: t > 0.5 });
  }
  const rnd = new Rand(88);
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI * rnd.float(0.08, 0.92);
    const d = R * rnd.float(0.5, 1.2) * t;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + R * t * t * 0.7;
    const r = rnd.float(2.0, 4.0);
    const rot = i + t * 6;
    poly(p, [
      [x + Math.cos(rot) * r, y + Math.sin(rot) * r],
      [x + Math.cos(rot + 2.2) * r * 0.8, y + Math.sin(rot + 2.2) * r * 0.8],
      [x + Math.cos(rot + 4.1) * r * 1.1, y + Math.sin(rot + 4.1) * r * 1.1],
    ], (px2, py2) => lut(LUT_STONE, 0.2 + ((px2 + py2) & 1 ? 0.35 : 0.15) + (i % 3) * 0.12), SET);
  }
  if (t > 0.65) erode(p, 1 - (t - 0.65) / 0.35 * 0.8);
}

function blades(p, f, n) {
  const cx = p.w / 2, cy = p.h / 2;
  const rot = (f / n) * Math.PI * 2 / 3;
  const R = p.w * 0.45;
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * Math.PI * 2;
    // Sweep the blade along a slight arc so it reads as curved steel. The body
    // stays dark; only the leading edge catches the light, which is what makes
    // a flat grey shape read as metal.
    const N = 28;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const aa = a + s * 0.75;
      const rr = R * (0.16 + 0.84 * s);
      const th = R * 0.15 * (1 - s * 0.85) + 0.7;
      const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr;
      disc(p, x, y, th, (v) => lut(LUT_STEEL, 0.08 + v * 0.3), SET);
    }
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const aa = a + s * 0.75;
      const rr = R * (0.16 + 0.84 * s);
      const th = R * 0.15 * (1 - s * 0.85);
      const nx = Math.cos(aa + 1.57), ny = Math.sin(aa + 1.57);
      disc(p, cx + Math.cos(aa) * rr + nx * th * 0.8, cy + Math.sin(aa) * rr + ny * th * 0.8,
        1.0, () => lut(LUT_STEEL, 0.97), SET);
    }
  }
  blob(p, cx, cy, R * 0.2, (v) => lut(LUT_STEEL, 0.15 + v * 0.45), { bands: 3, mode: SET });
}

function shrapnel(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.9;
  const R = p.h * 0.92;
  const rnd = new Rand(606);
  for (let i = 0; i < 34; i++) {
    const a = -Math.PI / 2 + rnd.float(-0.55, 0.55);
    const d = R * t * rnd.float(0.25, 1.05);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const r = rnd.float(2.6, 5.2) * (1 - t * 0.25);
    const rot = i * 1.3 + t * 8;
    stroke(p, x, y, x - Math.cos(a) * r * 2.2, y - Math.sin(a) * r * 2.2, 0.8,
      (v, _x, _y, s) => lut(LUT_STEEL, 0.8 - s * 0.6), SET);
    // Mid-grey body with one lit facet: a fragment reads as metal by contrast,
    // but a body too dark just disappears against the world.
    poly(p, [
      [x + Math.cos(rot) * r, y + Math.sin(rot) * r],
      [x + Math.cos(rot + 2.4) * r, y + Math.sin(rot + 2.4) * r],
      [x + Math.cos(rot + 4.3) * r * 0.9, y + Math.sin(rot + 4.3) * r * 0.9],
    ], () => lut(LUT_STEEL, 0.34 + (i % 3) * 0.12), SET);
    stroke(p, x + Math.cos(rot) * r, y + Math.sin(rot) * r,
      x + Math.cos(rot + 2.4) * r, y + Math.sin(rot + 2.4) * r, 0.7, () => lut(LUT_STEEL, 0.95), SET);
  }
  if (t < 0.45) {
    blob(p, cx, cy, R * 0.22 * (1 - t * 2), (v) => lut(LUT_SPARK, 0.55 + v * 0.45),
      { wob: 0.35, lobes: 5, bands: 3, squash: 0.7 });
  }
  if (t > 0.7) erode(p, 1 - (t - 0.7) / 0.3 * 0.8);
}

/** A hard four-point sparkle - the shape MM6 used for every healing mote. */
function sparkleStar(p, x, y, r, cf) {
  if (r < 0.8) { putMode(p, x, y, cf(1), MAX); return; }
  for (let i = -Math.ceil(r); i <= Math.ceil(r); i++) {
    const t = 1 - Math.abs(i) / r;
    if (t <= 0) continue;
    const c = cf(t);
    putMode(p, x + i, y, c, MAX);
    putMode(p, x, y + i, c, MAX);
  }
  const d = Math.max(1, Math.round(r * 0.35));
  for (let i = -d; i <= d; i++) {
    const c = cf(1 - Math.abs(i) / (d + 1));
    putMode(p, x + i, y + i, c, MAX);
    putMode(p, x + i, y - i, c, MAX);
  }
  putMode(p, x, y, W, MAX);
}

function healGlow(p, f, n) {
  const t = f / n;
  const cx = p.w / 2;
  // A thin stippled pool of light at the feet - a solid disc reads as a plate.
  ringShape(p, cx, p.h * 0.9, p.w * 0.34, 3.5, (v) => lut(LUT_GOLD, 0.3 + v * 0.45),
    { squash: 0.3, bands: 3, checker: true });
  for (let i = 0; i < 9; i++) {
    const ph = (t + i / 9) % 1;
    const y = p.h * 0.92 - ph * p.h * 0.86;
    const x = cx + Math.sin(i * 2.3 + ph * 2.4) * p.w * 0.33;
    const r = (1.6 + 3.4 * Math.sin(Math.PI * ph)) * (0.75 + 0.25 * Math.sin(i));
    sparkleStar(p, Math.round(x), Math.round(y), r, (v) => lut(LUT_HOLY, 0.4 + v * 0.6));
  }
}

function blessRing(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.62;
  const R = p.w * 0.46 * (0.12 + 0.88 * Math.pow(t, 0.7));
  ringShape(p, cx, cy, R, 2.2 + (1 - t) * 3, (v) => lut(LUT_GOLD, 0.35 + v * 0.6 * (1 - t * 0.35)),
    { squash: 0.42, bands: 4, wob: 0.05, phase: t * 4 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 1.4;
    sparkleStar(p, Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R * 0.42),
      2.2 * (1 - t * 0.5), (v) => lut(LUT_HOLY, 0.6 + v * 0.4));
  }
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.75);
}

function buffShimmer(p, f, n) {
  const t = f / n;
  // Straight stippled updraught, brightest up the middle.
  for (let y = 0; y < p.h; y++) {
    const v = y / p.h;
    const hw = p.w * 0.2 * (0.85 + 0.15 * Math.sin(2 * Math.PI * (v - t)));
    for (let x = Math.round(p.w / 2 - hw); x <= p.w / 2 + hw; x++) {
      const u = Math.abs((x + 0.5 - p.w / 2) / hw);
      if (!checker(x, y + (f & 1))) continue;
      if (u > 0.98) continue;
      putMode(p, x, y, lut(LUT_PALE, 0.45 + (1 - u) * 0.4 * (1 - v * 0.3)), UNDER);
    }
  }
  for (let i = 0; i < 26; i++) {
    const h = hash2(i, 7, 1234);
    const ph = (t + h) % 1;
    const y = p.h * 0.98 - ph * p.h * 0.96;
    const x = p.w * 0.5 + (h - 0.5) * p.w * 0.5 + Math.sin(ph * 6 + i) * p.w * 0.05;
    const b = Math.sin(Math.PI * ph);
    if (b < 0.12) continue;
    const c = lut(LUT_PALE, 0.55 + b * 0.45);
    const xi = Math.round(x), yi = Math.round(y);
    putMode(p, xi, yi, c, MAX);
    if (b > 0.45) {
      putMode(p, xi + 1, yi, c, MAX);
      putMode(p, xi - 1, yi, c, MAX);
      putMode(p, xi, yi - 1, c, MAX);
      putMode(p, xi, yi + 1, c, MAX);
    }
  }
}

function holyBurst(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.48;
  const rays = 16;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + t * 0.25;
    const len = R * (0.35 + 0.68 * Math.pow(t, 0.5)) * (i % 2 ? 0.62 : 1);
    spike(p, cx, cy, a, R * 0.05, len, R * 0.11 * (1 - t * 0.55) + 0.6,
      () => lut(LUT_HOLY, 0.35 + (1 - t) * 0.4), MAX);
  }
  // A thick gold shockwave, deliberately unwobbled: a thin ring with any radial
  // wobble at all turns into a visible polygon.
  const rr = R * (0.35 + 0.55 * Math.pow(t, 0.6));
  ringShape(p, cx, cy, rr, 4 * (1 - t * 0.55), (v) => lut(LUT_HOLY, 0.45 + v * 0.5), { bands: 3 });
  const cr = R * (0.34 - t * 0.2);
  if (cr > 0.6) blob(p, cx, cy, cr, (v) => lut(LUT_HOLY, 0.6 + v * 0.4), { wob: 0.14, lobes: 8, phase: t * 5, bands: 4 });
  if (t > 0.55) erode(p, 1 - (t - 0.55) / 0.45 * 0.85);
}

function darkRay(p, f, n) {
  const t = f / n;
  const cx = p.w / 2;
  for (let y = 0; y < p.h; y++) {
    const v = y / p.h;
    const hw = p.w * 0.3 * (1.05 - v * 0.35) * (0.86 + 0.16 * Math.sin(2 * Math.PI * (2 * v - t)));
    // Bands of energy crawling down the beam, kept inside its silhouette.
    const band = 0.5 + 0.5 * Math.sin(2 * Math.PI * (3 * v - t));
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const u = Math.abs((x + 0.5 - cx) / hw);
      if (u > 1) continue;
      // Violet skin over a near-black core: the ray reads as a hole in the world.
      let c;
      if (u > 0.76) c = lut(LUT_DARK, 0.9 + band * 0.1);
      else if (u > 0.5) c = lut(LUT_DARK, 0.4 + band * 0.35);
      else c = lut(LUT_DARK, 0.05 + u * 0.2 + band * 0.12);
      putMode(p, x, y, c, SET);
    }
  }
}

function soulDrain(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.46;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + t * 3.4;
    const r0 = R * (1 - t * 0.82);
    const N = 20;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const a = a0 + s * 1.1;
      const rr = r0 + s * R * 0.42;
      if (rr > R * 1.05) continue;
      // Keep the wisps inside the violet range; letting them hit white made
      // them read as bones rather than magic.
      disc(p, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, (1 - s) * 1.9 + 0.45,
        (v) => lut(LUT_ARCANE, 0.2 + (1 - s) * 0.5 + v * 0.12));
    }
    disc(p, cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, 1.0, () => lut(LUT_ARCANE, 0.95));
  }
  const cr = R * (0.1 + 0.4 * t);
  blob(p, cx, cy, cr, (v) => lut(LUT_DARK, 0.9 - v * 0.85), { wob: 0.18, lobes: 5, phase: t * 6, bands: 4, mode: SET });
  ringShape(p, cx, cy, cr, 1.6, () => lut(LUT_ARCANE, 0.95), { bands: 1, wob: 0.12, phase: t * 6 });
  if (t > 0.8) erode(p, 1 - (t - 0.8) / 0.2 * 0.7);
}

function mindBlast(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.47;
  for (let i = 0; i < 3; i++) {
    const s = (t + i * 0.34) % 1.02;
    const r = R * s;
    if (r < 1) continue;
    ringShape(p, cx, cy, r, 3.2 * (1 - s * 0.5), (v) => lut(LUT_MAGENTA, 0.3 + (1 - s) * 0.55 + v * 0.2),
      { squash: 0.7, bands: 3, keep: 1 - s * 0.35 });
  }
  const cr = R * 0.2 * (1 - t * 0.6);
  if (cr > 0.6) blob(p, cx, cy, cr, (v) => lut(LUT_MAGENTA, 0.6 + v * 0.4), { wob: 0.2, lobes: 4, phase: t * 7, bands: 3, squash: 0.8 });
  if (t > 0.7) erode(p, 1 - (t - 0.7) / 0.3 * 0.7);
}

function implosion(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.47;
  if (t < 0.78) {
    const s = t / 0.78;
    const r = R * (1 - s * 0.88);
    // Streaks racing inward ahead of the shell.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + s * 1.2;
      stroke(p, cx + Math.cos(a) * (r + R * 0.34), cy + Math.sin(a) * (r + R * 0.34),
        cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5,
        (v, _x, _y, ss) => lut(LUT_ARCANE, 0.35 + ss * 0.6));
    }
    ringShape(p, cx, cy, r, 2.4 + s * 2.5, (v) => lut(LUT_ARCANE, 0.45 + s * 0.4 + v * 0.2), { bands: 4 });
    blob(p, cx, cy, R * 0.1 * (1 + s), (v) => lut(LUT_ARCANE, 0.7 + v * 0.3), { wob: 0.2, lobes: 5, phase: s * 8, bands: 3 });
  } else {
    // Collapse completes: a white-violet flash and one thin shock ring.
    const s = (t - 0.78) / 0.22;
    blob(p, cx, cy, R * (0.42 - s * 0.3), () => (s < 0.5 ? W : lut(LUT_ARCANE, 0.9)), { wob: 0.12, lobes: 7, phase: s * 9, bands: 2 });
    ringShape(p, cx, cy, R * (0.5 + s * 0.5), 1.8, () => lut(LUT_ARCANE, 0.95 - s * 0.3), { bands: 1, keep: 1 - s * 0.6 });
  }
}

function meteor(p, f, n) {
  const t = f / n;
  const ph = t * Math.PI * 2;
  const hx = p.w * 0.68, hy = p.h * 0.66;   // head sits low-right, tail goes up-left
  const R = p.w * 0.2;
  // Tail: shrinking flame puffs walking back toward the corner.
  for (let i = 8; i >= 0; i--) {
    const s = i / 8;
    const x = hx - s * p.w * 0.62 + Math.sin(ph + s * 5) * p.w * 0.05 * s;
    const y = hy - s * p.h * 0.6 + Math.cos(ph + s * 4) * p.h * 0.04 * s;
    blob(p, x, y, R * (1.05 - s * 0.75), (v) => lut(LUT_FIRE, (0.15 + v * 0.55) * (1 - s * 0.35)),
      { wob: 0.36, lobes: 4, phase: ph + i, bands: 4, seed: i, keep: 1 - s * 0.45 });
  }
  blob(p, hx, hy, R * 1.25, (v) => lut(LUT_FIRE, 0.35 + v * 0.62), { wob: 0.28, lobes: 5, phase: -ph, bands: 5 });
  // Rock core, tumbling.
  const pts = [];
  const rnd = new Rand(1717);
  for (let i = 0; i < 7; i++) {
    const a = ph + (i / 7) * Math.PI * 2;
    const r = R * 0.72 * rnd.float(0.65, 1.05);
    pts.push([hx + Math.cos(a) * r, hy + Math.sin(a) * r]);
  }
  poly(p, pts, (x, y) => lut(LUT_STONE, clamp(0.45 - (x - hx) / R * 0.25 - (y - hy) / R * 0.25, 0, 1)), SET);
}

function starburst(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.48;
  const env = Math.sin(Math.PI * Math.pow(t, 0.75));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 0.4;
    // Gold underlay slightly wider than the white spike gives it a warm fringe
    // instead of reading as a paper cutout.
    spike(p, cx, cy, a, R * 0.05, R * (0.27 + 0.77 * Math.pow(t, 0.55)), R * 0.085 * env + 1.1,
      () => lut(LUT_GOLD, 0.45 + env * 0.3));
    spike(p, cx, cy, a, R * 0.05, R * (0.25 + 0.75 * Math.pow(t, 0.55)), R * 0.05 * env + 0.6,
      () => lut(LUT_HOLY, 0.6 + env * 0.4));
    spike(p, cx, cy, a + Math.PI / 8, R * 0.04, R * (0.15 + 0.5 * Math.pow(t, 0.55)), R * 0.035 * env + 0.5,
      () => lut(LUT_GOLD, 0.45 + env * 0.35));
  }
  blob(p, cx, cy, R * 0.16 * env + 1, (v) => (v > 0.5 ? W : lut(LUT_GOLD, 0.75)), { bands: 2, wob: 0.15, lobes: 8, phase: t * 6 });
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.9);
}

function armageddon(p, f, n) {
  const t = f / (n - 1);
  const rnd = new Rand(31337);
  // A churning wall of fire that fills the frame - the shell also flashes the
  // screen, this is what burns in the world. Built from noise rather than
  // stacked sines, which cross into a tartan pattern.
  for (let y = 0; y < p.h; y++) {
    const v = y / p.h;
    for (let x = 0; x < p.w; x++) {
      // Sampled on a 2x2 grid: cheaper, and the blockiness is the look.
      const g = tileFbm2((x & ~1) * 0.10, (y & ~1) * 0.10 - t * 6, 32, 3, 0.6, 11);
      // Keep it in the orange-red half of the ramp; a full-frame yellow field
      // washes out and stops reading as fire.
      const hot = clamp((g * 1.5 - 0.3) * (1.1 - v * 0.3) * (1 - t * 0.3), 0, 0.72);
      if (hot < 0.12) continue;
      putMode(p, x, y, lut(LUT_FIRE, (Math.floor(hot * 7) + 0.5) / 7), SET);
    }
  }
  // Flame tongues licking up out of the wall.
  for (let i = 0; i < 9; i++) {
    const x = (i + 0.5) / 9 * p.w;
    flameColumn(p, x, p.h - 1, p.w * 0.075, p.h * (0.5 + 0.45 * hash2(i, 3, 5)),
      { t: (t + i * 0.13) % 1, seed: i * 2.1, bands: 6 });
  }
  // Fire raining down through it.
  for (let i = 0; i < 16; i++) {
    const x = rnd.float(0, p.w);
    const y = ((rnd.float(0, 1) + t * 1.3) % 1) * p.h;
    stroke(p, x, y - p.h * 0.16, x + 1, y, 1.2, (v, _x, _y, s) => lut(LUT_FIRE, 0.55 + s * 0.45));
  }
  if (t > 0.6) erode(p, 1 - (t - 0.6) / 0.4 * 0.9);
}

function arrow(p, f, n, a, na) {
  const cx = p.w / 2, cy = p.h / 2;
  // Index 0 points up the screen; the runtime picks the index from the
  // projectile's direction relative to the camera.
  const ang = -Math.PI / 2 + (a / na) * Math.PI * 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const nx = -dy, ny = dx;
  const L = p.w * 0.44;
  const tipX = cx + dx * L, tipY = cy + dy * L;
  const tailX = cx - dx * L, tailY = cy - dy * L;
  stroke(p, tailX, tailY, tipX - dx * L * 0.3, tipY - dy * L * 0.3, 1.1,
    (v) => lut(LUT_WOOD, 0.35 + v * 0.5), SET);
  poly(p, [
    [tipX, tipY],
    [tipX - dx * L * 0.34 + nx * L * 0.16, tipY - dy * L * 0.34 + ny * L * 0.16],
    [tipX - dx * L * 0.34 - nx * L * 0.16, tipY - dy * L * 0.34 - ny * L * 0.16],
  ], (x, y) => lut(LUT_STEEL, 0.55 + (((x + y) & 1) ? 0.25 : 0)), SET);
  for (let s = 0; s < 2; s++) {
    const sg = s ? 1 : -1;
    poly(p, [
      [tailX, tailY],
      [tailX + dx * L * 0.3, tailY + dy * L * 0.3],
      [tailX + dx * L * 0.26 + nx * L * 0.12 * sg, tailY + dy * L * 0.26 + ny * L * 0.12 * sg],
    ], () => lut(LUT_STEEL, 0.75), SET);
  }
  stroke(p, tailX + dx * L * 0.06, tailY + dy * L * 0.06, tailX + dx * L * 0.2, tailY + dy * L * 0.2,
    0.9, () => lut(LUT_BLOOD, 0.7), SET);
}

function bloodHit(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.4;
  blob(p, cx, cy, R * (0.3 + 0.45 * t), (v) => lut(LUT_BLOOD, 0.3 + v * 0.6),
    { wob: 0.42, lobes: 6, phase: t * 3, bands: 4, seed: 2 });
  const rnd = new Rand(5150);
  for (let i = 0; i < 11; i++) {
    const a = rnd.float(0, 6.28);
    const d = R * (0.4 + 0.9 * t) * rnd.float(0.5, 1.2);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + R * t * t * 0.6;
    blob(p, x, y, rnd.float(0.9, 2.3) * (1 - t * 0.35), (v) => lut(LUT_BLOOD, 0.35 + v * 0.5), { bands: 2 });
  }
  if (t > 0.45) erode(p, 1 - (t - 0.45) / 0.55 * 0.85);
}

function dustPuff(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h * 0.8;
  const R = p.w * 0.24;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * (0.12 + 0.76 * (i / 4));
    const d = R * (0.2 + 1.5 * t);
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.55 - t * p.h * 0.1, R * (0.55 + 0.4 * t),
      (v) => lut(LUT_DUST, 0.15 + v * 0.45), { wob: 0.34, lobes: 4, phase: i + t * 4, bands: 3, seed: i, checker: t > 0.3 });
  }
  if (t > 0.4) erode(p, 1 - (t - 0.4) / 0.6 * 0.85);
}

function sparkHit(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.46;
  const env = 1 - t * 0.8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    spike(p, cx, cy, a, R * 0.05, R * env * (i % 2 ? 0.55 : 1), R * 0.08 * env + 0.5,
      () => lut(LUT_SPARK, 0.6 + env * 0.4));
  }
  blob(p, cx, cy, R * 0.24 * env + 0.8, (v) => (v > 0.35 ? W : lut(LUT_SPARK, 0.85)), { bands: 2 });
  if (t > 0.5) erode(p, 1 - (t - 0.5) / 0.5 * 0.8);
}

function teleportSwirl(p, f, n) {
  const t = f / (n - 1);
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.46;
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 + t * 5;
    const N = 46;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const a = a0 + s * 4.4;
      const rr = R * (1 - s * 0.92) * (1 - t * 0.35);
      disc(p, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85,
        (1 - s) * 2.0 + 0.5, (v) => lut(LUT_ICE, 0.35 + s * 0.6 + v * 0.15));
    }
  }
  blob(p, cx, cy, R * (0.08 + 0.24 * t), (v) => (v > 0.45 ? W : lut(LUT_ICE, 0.85)),
    { wob: 0.2, lobes: 6, phase: t * 9, bands: 3 });
  if (t > 0.8) erode(p, 1 - (t - 0.8) / 0.2 * 0.6);
}

function portal(p, f, n) {
  const t = f / n;
  const cx = p.w / 2, cy = p.h / 2;
  const rx = p.w * 0.3, ry = p.h * 0.44;
  // Dark gateway interior first, then swirling arms over it.
  blob(p, cx, cy, rx, () => lut(LUT_DARK, 0.12), { squash: ry / rx, bands: 1, mode: SET });
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 - t * Math.PI * 2;
    const N = 22;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const a = a0 + s * 3.6;
      const r = 1 - s * 0.9;
      disc(p, cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r,
        (1 - s * 0.6) * 1.9 + 0.4, (v) => lut(LUT_ARCANE, 0.3 + s * 0.55 + v * 0.15));
    }
  }
  ringShape(p, cx, cy, rx, 2.6, (v) => lut(LUT_ARCANE, 0.65 + v * 0.35),
    { squash: ry / rx, bands: 3, wob: 0.05, lobes: 7, phase: t * 6.283 });
  blob(p, cx, cy, rx * 0.18, (v) => (v > 0.5 ? W : lut(LUT_ARCANE, 0.9)), { bands: 2, wob: 0.2, lobes: 5, phase: t * 12 });
}

function torchFlame(p, f, n) {
  const t = f / n;
  flameColumn(p, p.w * 0.5, p.h - 2, p.w * 0.2, p.h * 0.82, { t, seed: 1.1, bands: 6 });
  flameColumn(p, p.w * 0.5, p.h - 2, p.w * 0.09, p.h * 0.5, { t, seed: 3.3, bands: 4, hot: 0.25 });
  for (let i = 0; i < 3; i++) {
    const ph = (t + i / 3) % 1;
    disc(p, p.w * 0.5 + Math.sin(i * 3 + ph * 6) * p.w * 0.16, p.h - 2 - ph * p.h * 0.9,
      ph > 0.6 ? 0.5 : 0.9, () => lut(LUT_SPARK, 0.75));
  }
}

function campfire(p, f, n) {
  const t = f / n;
  const base = p.h - 4;
  // Logs.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI - 0.4;
    const x0 = p.w * 0.5 - Math.cos(a) * p.w * 0.34, y0 = p.h - 3 - Math.sin(a) * p.h * 0.05;
    const x1 = p.w * 0.5 + Math.cos(a) * p.w * 0.34, y1 = p.h - 3 + Math.sin(a) * p.h * 0.05;
    stroke(p, x0, y0, x1, y1, 2.2, (v) => lut(LUT_WOOD, 0.1 + v * 0.35), SET);
  }
  flameColumn(p, p.w * 0.5, base, p.w * 0.24, p.h * 0.8, { t, seed: 0.7, bands: 6 });
  flameColumn(p, p.w * 0.34, base, p.w * 0.13, p.h * 0.5, { t: (t + 0.4) % 1, seed: 2.9, bands: 5 });
  flameColumn(p, p.w * 0.66, base, p.w * 0.13, p.h * 0.45, { t: (t + 0.7) % 1, seed: 5.2, bands: 5 });
  // Glowing coal bed.
  for (let i = 0; i < 8; i++) {
    const x = p.w * (0.28 + 0.44 * (i / 7));
    disc(p, x, p.h - 3, 1.3, () => lut(LUT_FIRE, 0.4 + 0.3 * Math.sin(i * 2 + t * 6.283)), MAX);
  }
  for (let i = 0; i < 5; i++) {
    const ph = (t + i / 5) % 1;
    disc(p, p.w * 0.5 + Math.sin(i * 2.7 + ph * 5) * p.w * 0.28, base - ph * p.h * 0.95,
      ph > 0.65 ? 0.5 : 1.0, () => lut(LUT_SPARK, 0.8));
  }
}

function wispGlow(p, f, n) {
  const t = f / n;
  const cx = p.w / 2, cy = p.h / 2;
  const R = p.w * 0.4 * (0.86 + 0.14 * Math.sin(2 * Math.PI * t));
  // Stippled halo, then a solid banded core - a lantern, not a bloom.
  blob(p, cx, cy, R, (v) => lut(LUT_PALE, 0.25 + v * 0.3), { bands: 3, checker: true, wob: 0.1, lobes: 5, phase: t * 6.283 });
  blob(p, cx, cy, R * 0.62, (v) => lut(LUT_PALE, 0.5 + v * 0.5), { bands: 4, wob: 0.08, lobes: 4, phase: -t * 6.283 });
  blob(p, cx, cy, R * 0.24, () => W, { bands: 1 });
}

// --- effect table ----------------------------------------------------------

const DEFS = [
  ['fire_bolt', 48, 8, 14, true, 140, 140, (p, f, n) => fireBall(p, f, n, { r: 0.4 })],
  ['fireball', 64, 8, 14, true, 230, 230, (p, f, n) => fireBall(p, f, n, { r: 0.43 })],
  ['fire_burst', 96, 10, 20, false, 470, 470, fireBurst],
  ['flame_pillar', 64, 8, 12, true, 280, 470, flamePillar],
  ['immolation_aura', 64, 8, 12, true, 340, 320, immolationAura],
  ['lightning', 64, 6, 18, false, 260, 430, lightning],
  ['spark_shower', 48, 6, 16, false, 180, 180, sparkShower],
  ['ice_shard', 48, 8, 12, true, 160, 160, iceShard],
  ['ice_burst', 64, 8, 18, false, 350, 350, iceBurst],
  ['frost_cloud', 64, 8, 12, false, 330, 310, frostCloud],
  ['poison_cloud', 64, 10, 10, false, 370, 350, poisonCloud],
  ['acid_splash', 48, 6, 14, false, 210, 210, acidSplash],
  ['rock_shard', 48, 8, 12, true, 150, 150, rockShard],
  ['earth_burst', 64, 8, 16, false, 350, 330, earthBurst],
  ['blades', 64, 8, 16, true, 270, 270, blades],
  ['shrapnel', 64, 6, 16, false, 310, 290, shrapnel],
  ['heal_glow', 64, 10, 12, false, 230, 350, healGlow],
  ['bless_ring', 64, 8, 16, false, 350, 270, blessRing],
  ['buff_shimmer', 64, 8, 10, true, 210, 390, buffShimmer],
  ['holy_burst', 96, 10, 18, false, 470, 470, holyBurst],
  ['dark_ray', 64, 6, 14, true, 210, 430, darkRay],
  ['soul_drain', 64, 10, 14, false, 330, 330, soulDrain],
  ['mind_blast', 64, 8, 16, false, 350, 310, mindBlast],
  ['implosion', 96, 10, 18, false, 510, 510, implosion],
  ['meteor', 64, 8, 12, true, 270, 270, meteor],
  ['starburst', 96, 10, 18, false, 450, 450, starburst],
  ['armageddon', 96, 8, 12, false, 950, 720, armageddon],
  ['blood_hit', 48, 6, 16, false, 170, 170, bloodHit],
  ['dust_puff', 48, 6, 14, false, 210, 170, dustPuff],
  ['spark_hit', 48, 4, 18, false, 160, 160, sparkHit],
  ['teleport_swirl', 64, 12, 16, false, 330, 390, teleportSwirl],
  ['portal', 96, 12, 12, true, 430, 570, portal],
  ['torch_flame', 48, 8, 10, true, 130, 190, torchFlame],
  ['campfire', 64, 8, 10, true, 250, 270, campfire],
  ['wisp_glow', 48, 8, 8, true, 160, 160, wispGlow],
];

const DEF_MAP = new Map();
for (const d of DEFS) {
  DEF_MAP.set(d[0], {
    id: d[0], w: d[1], h: d[1], frames: d[2], fps: d[3], loop: d[4],
    worldW: d[5], worldH: d[6], draw: d[7], angles: 1,
  });
}
// The arrow is the one directional sheet: one frame, eight facings.
DEF_MAP.set('arrow', {
  id: 'arrow', w: 48, h: 48, frames: 1, fps: 1, loop: true,
  worldW: 130, worldH: 130, draw: arrow, angles: 8,
});

export const EFFECT_IDS = Array.from(DEF_MAP.keys());

// Spells name their visuals with their own tags (spells.js VFX_TAGS) and the
// combat glue hands those straight to the effect system. Rather than draw 99
// nearly identical sheets, every tag maps onto one of the effects above.
export const EFFECT_ALIAS = {
  light_glow: 'wisp_glow', weapon_flame: 'immolation_aura', haste_blur: 'buff_shimmer',
  fire_spike: 'flame_pillar', immolation: 'immolation_aura', inferno: 'fire_burst',
  incinerate: 'fire_burst', eye_glow: 'wisp_glow', feather: 'buff_shimmer',
  sparks: 'spark_shower', jump_puff: 'dust_puff', shield_bubble: 'bless_ring',
  invisible_fade: 'buff_shimmer', fly_wings: 'buff_shimmer', wake_flash: 'spark_hit',
  water_ripple: 'frost_cloud', recharge_spark: 'spark_shower', enchant_glow: 'buff_shimmer',
  portal_swirl: 'teleport_swirl', ice_blast: 'ice_burst', beacon_light: 'teleport_swirl',
  stun_ring: 'mind_blast', slow_web: 'dust_puff', earth_shield: 'bless_ring',
  swarm: 'poison_cloud', stone_skin: 'dust_puff', flesh_glow: 'heal_glow',
  rock_blast: 'rock_shard', telekinesis: 'buff_shimmer', death_blossom: 'earth_burst',
  mass_distortion: 'implosion', detect_pulse: 'mind_blast', bless_ray: 'bless_ring',
  fate_rune: 'bless_ring', turn_undead: 'holy_burst', curse_break: 'holy_burst',
  preserve_glow: 'heal_glow', heroism_aura: 'bless_ring', spirit_lash: 'dark_ray',
  raise_glow: 'heal_glow', shared_life: 'heal_glow', resurrect_beam: 'holy_burst',
  calm_wave: 'mind_blast', precision_glint: 'spark_hit', paralysis_break: 'mind_blast',
  charm_heart: 'mind_blast', fear_wave: 'mind_blast', feeblemind: 'mind_blast',
  berserk_rage: 'blood_hit', enslave_chain: 'soul_drain', psychic_shock: 'mind_blast',
  telepathy: 'mind_blast', first_aid: 'heal_glow', magic_ward: 'bless_ring',
  harm_bolt: 'dark_ray', regen_glow: 'heal_glow', cure_poison: 'heal_glow',
  hammerhands: 'bless_ring', cure_disease: 'heal_glow', body_ward: 'bless_ring',
  flying_fist: 'spark_hit', power_cure: 'holy_burst', light_bolt: 'starburst',
  destroy_undead: 'holy_burst', dispel_burst: 'holy_burst', paralyze_ray: 'dark_ray',
  summon_circle: 'teleport_swirl', day_of_gods: 'holy_burst', prismatic: 'starburst',
  day_of_protection: 'bless_ring', hour_of_power: 'bless_ring', sunray: 'holy_burst',
  divine: 'holy_burst', reanimate: 'soul_drain', toxic_cloud: 'poison_cloud',
  vampiric_glow: 'soul_drain', shrapmetal: 'shrapnel', shrink_ray: 'dark_ray',
  control_undead: 'soul_drain', pain_reflection: 'dark_ray', sacrifice_glow: 'blood_hit',
  dragon_breath: 'fire_burst', souldrinker: 'soul_drain', beam: 'dark_ray',
};

/** Resolve an effect id or spell vfx tag to a drawable effect id. */
export function resolveEffectId(id) {
  if (DEF_MAP.has(id)) return id;
  const a = EFFECT_ALIAS[id];
  return a && DEF_MAP.has(a) ? a : null;
}

// --- sheet assembly --------------------------------------------------------

function blit(dst, src, dx, dy) {
  const row = src.w * 4;
  for (let y = 0; y < src.h; y++) {
    dst.data.set(src.data.subarray(y * row, y * row + row), ((dy + y) * dst.w + dx) * 4);
  }
}

const _cache = new Map();

function buildSheet(def) {
  const cells = def.frames * def.angles;
  const cols = Math.max(1, Math.min(cells, Math.floor(MAX_ATLAS_W / def.w)));
  const rows = Math.ceil(cells / cols);
  const atlas = new Pix(cols * def.w, rows * def.h);
  const frame = new Pix(def.w, def.h);

  const uvs = [];
  for (let i = 0; i < cells; i++) {
    const a = Math.floor(i / def.frames), f = i % def.frames;
    frame.data.fill(0);
    def.draw(frame, f, def.frames, a, def.angles);
    const cx = (i % cols) * def.w, cy = Math.floor(i / cols) * def.h;
    blit(atlas, frame, cx, cy);
    // The sprite shader takes v0 as the top edge, and CanvasTexture flips Y,
    // so v is measured up from the bottom of the atlas.
    const uv = new Float32Array(4);
    uv[0] = cx / atlas.w;
    uv[1] = 1 - cy / atlas.h;
    uv[2] = (cx + def.w) / atlas.w;
    uv[3] = 1 - (cy + def.h) / atlas.h;
    uvs.push(uv);
  }

  // Nearest min and mag, no mips: an atlas of masked frames must never bleed
  // one frame's pixels into the next. Quantisation is skipped because every
  // colour written above already came out of a palette-snapped LUT.
  const texture = toTexture(atlas, {
    quantise: false, repeat: false, mips: false, anisotropy: 1, magNearest: true,
  });

  const play = { frames: def.frames, fps: def.fps, loop: def.loop };
  return {
    id: def.id,
    texture,
    canvas: texture.image,
    actions: { play, stand: play },
    angles: def.angles,
    frames: def.frames,
    fps: def.fps,
    loop: def.loop,
    worldW: def.worldW,
    worldH: def.worldH,
    cols, rows, fw: def.w, fh: def.h,
    uvs,
    /** Returns a shared Float32Array [u0,v0,u1,v1]; never mutate it. */
    uv(action, f, angle) {
      const a = def.angles > 1 ? ((angle | 0) % def.angles + def.angles) % def.angles : 0;
      const fi = f < 0 ? 0 : (f >= def.frames ? def.frames - 1 : f | 0);
      return uvs[a * def.frames + fi];
    },
  };
}

/** Build (or fetch) one effect sheet, following spell-tag aliases. */
export function getEffectSheet(id) {
  let s = _cache.get(id);
  if (s) return s;
  const real = resolveEffectId(id);
  if (!real) return null;
  s = _cache.get(real);
  if (!s) { s = buildSheet(DEF_MAP.get(real)); _cache.set(real, s); }
  if (real !== id) _cache.set(id, s);
  return s;
}

/** Loading-screen generator: yields {id, index, total} after each sheet. */
export function* buildAllEffects() {
  const total = EFFECT_IDS.length;
  for (let i = 0; i < total; i++) {
    getEffectSheet(EFFECT_IDS[i]);
    yield { id: EFFECT_IDS[i], index: i, total };
  }
}

export function effectDef(id) {
  const real = resolveEffectId(id);
  return real ? DEF_MAP.get(real) : null;
}
