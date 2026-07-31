import * as THREE from 'three';
import {
  Pix, mixC, scaleC, toTexture, blotch, cracks,
} from './texcanvas.js';
import { hash2, tileFbm2, tileNoise2, Rand, clamp, smoothstep } from '../core/rng.js';

// ---------------------------------------------------------------------------
// The world texture library.
//
// MM6's surface art is hand-painted 64x64 tiles: individual cobbles, brick
// courses, plank knots, shingle rows. The recipe here is always the same -
// build the *structure* first (cells, courses, strands, panels), shade every
// raised feature with light from the upper left, then finish with a thin layer
// of grain and grit. Nothing is a tinted noise field; if you squint at a tile
// from across the room the drawn features still read.
//
// Everything tiles. Any noise used is one of the wrapping variants from
// rng.js, and any hand-placed detail is written through Pix's wrapping
// setters so a clump that runs off the right edge comes back on the left.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrapI = (v, n) => ((v % n) + n) % n;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function P(size = 64) { return new Pix(size, size); }

/** Isotropic tiling fBm sampled in pixel space; `per` lattice cells across. */
function nz(x, y, per, seed, oct = 3, gain = 0.5, size = 64) {
  return tileFbm2((x / size) * per, (y / size) * per, per, oct, gain, seed);
}
/** Single octave of the same. */
function nz1(x, y, per, seed, size = 64) {
  return tileNoise2((x / size) * per, (y / size) * per, per, seed);
}

/**
 * Anisotropic tiling value noise. rng.js's period is a scalar, but stretched
 * grain (wood, weather streaks, marble veins, water ripple) needs different
 * frequencies per axis, so this rolls its own wrapping lattice.
 */
function nzXY(x, y, perX, perY, seed, size = 64) {
  const fx = (x / size) * perX, fy = (y / size) * perY;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fade(fx - x0), ty = fade(fy - y0);
  const xa = wrapI(x0, perX), xb = wrapI(x0 + 1, perX);
  const ya = wrapI(y0, perY), yb = wrapI(y0 + 1, perY);
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}
function fbmXY(x, y, perX, perY, seed, oct = 3, gain = 0.5, size = 64) {
  let amp = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * nzXY(x, y, perX * f, perY * f, seed + i * 6151, size);
    n += amp; amp *= gain; f *= 2;
  }
  return s / n;
}

/**
 * Tiling cellular lookup that also reports which cell won and where its centre
 * is - needed to give every cobble/stone its own tone and dome shading.
 */
function worley(fx, fy, per, seed, jitter = 0.9) {
  const xi = Math.floor(fx), yi = Math.floor(fy);
  let f1 = 1e9, f2 = 1e9, bx = 0, by = 0, bgx = 0, bgy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const gx = wrapI(cx, per), gy = wrapI(cy, per);
      const px = cx + 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2(gx, gy, seed + 7919) - 0.5) * jitter;
      const ddx = px - fx, ddy = py - fy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) { f2 = f1; f1 = d; bx = px; by = py; bgx = gx; bgy = gy; }
      else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, cx: bx, cy: by, gx: bgx, gy: bgy };
}

/** Per-pixel paint pass; fn may return null to leave the pixel alone. */
function paint(pix, fn) {
  for (let y = 0; y < pix.h; y++) {
    for (let x = 0; x < pix.w; x++) {
      const c = fn(x, y);
      if (c) pix.setArr(x, y, c, c.length > 3 ? c[3] : 255);
    }
  }
  return pix;
}

function blend(pix, x, y, c, t) {
  const cur = pix.get(x, y);
  pix.setArr(x, y, mixC(cur, c, t));
}

/** Ragged filled blob; fn(x,y,d) gets the normalised radius. */
function blob(pix, cx, cy, rx, ry, fn) {
  const ex = Math.ceil(rx) + 1, ey = Math.ceil(ry) + 1;
  for (let dy = -ey; dy <= ey; dy++) {
    for (let dx = -ex; dx <= ex; dx++) {
      const d = Math.sqrt((dx / rx) * (dx / rx) + (dy / ry) * (dy / ry));
      if (d > 1.35) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      const c = fn(x, y, d, dx, dy);
      if (c) pix.setArr(x, y, c, c.length > 3 ? c[3] : 255);
    }
  }
}

function vstroke(pix, x, y, len, c, dx = 0) {
  for (let i = 0; i < len; i++) pix.setArr(Math.round(x + dx * i), Math.round(y - i), c);
}
function hline(pix, y, x0, x1, c) {
  for (let x = x0; x <= x1; x++) pix.setArr(x, y, c);
}
function vline(pix, x, y0, y1, c) {
  for (let y = y0; y <= y1; y++) pix.setArr(x, y, c);
}
function rect(pix, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pix.setArr(x, y, c);
}
function frameRect(pix, x0, y0, w, h, c) {
  hline(pix, y0, x0, x0 + w - 1, c); hline(pix, y0 + h - 1, x0, x0 + w - 1, c);
  vline(pix, x0, y0, y0 + h - 1, c); vline(pix, x0 + w - 1, y0, y0 + h - 1, c);
}

/**
 * Fine grit. Scaling the pixel that is already there keeps the speck in the
 * same colour family - stamping fixed light/dark values reads as pepper noise,
 * which is exactly what hand-painted 8-bit art does not look like.
 */
function grit(pix, count, seed, lo = 0.82, hi = 1.16) {
  const rnd = new Rand(seed);
  for (let i = 0; i < count; i++) {
    pix.shade(rnd.int(pix.w), rnd.int(pix.h), rnd.bool() ? lo : hi);
  }
  return pix;
}

/**
 * Squeeze a finished tile into a narrow value band and pull a little saturation
 * out of it.
 *
 * MM6's art is deliberately low contrast - roughly a quarter of the 0-255
 * range - because the runtime lighting is a greyscale multiply quantised to 32
 * steps, and a wide-range texture has no headroom left to darken with. A tile
 * that looks punchy in isolation reads as camouflage once it tiles across a
 * hillside, so every terrain texture goes through here.
 *
 * Percentiles rather than min/max, so one stray speck cannot flatten the tile.
 */
function toneBand(pix, lo, hi, sat = 0.15, warm = 0.06) {
  const d = pix.data;
  const hist = new Int32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    hist[(0.30 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) | 0]++;
    n++;
  }
  if (!n) return pix;
  const pct = (f) => {
    let acc = 0, want = n * f;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
    return 255;
  };
  const mn = pct(0.02), mx = pct(0.98);
  const scale = (hi - lo) / Math.max(1, mx - mn);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = 0.30 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const nl = clamp(lo + (l - mn) * scale, 0, 255);
    const k = nl / Math.max(1, l);
    let r = d[i] * k, g = d[i + 1] * k, b = d[i + 2] * k;
    // Desaturate towards a *warm* grey. The MM6 palette has no neutral greys -
    // its two grey families are a cool blue `stone` and a green-cyan `grey` -
    // so pulling straight towards L turns every weathered stone surface blue.
    if (sat > 0) {
      const gr = nl * (1 + warm), gg = nl, gb = nl * (1 - warm * 1.8);
      r += (gr - r) * sat; g += (gg - g) * sat; b += (gb - b) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return pix;
}

/**
 * Positions on a jittered grid. Scattering features with pure random placement
 * leaves clusters and holes, and once the tile repeats those clusters read as a
 * lattice; a jittered grid keeps the spacing even and the eye quiet.
 */
function scatter(count, seed, size = 64) {
  const cols = Math.max(1, Math.round(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const cw = size / cols, ch = size / rows;
  const rnd = new Rand(seed);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && out.length < count; c++) {
      out.push([
        Math.round(wrapI(c * cw + rnd.float(0.05, 0.95) * cw, size)),
        Math.round(wrapI(r * ch + rnd.float(0.05, 0.95) * ch, size)),
      ]);
    }
  }
  return rnd.shuffle(out);
}

/** Tiny hand-drawn bitmaps - emblems, glyphs, studs. */
function stamp(pix, x0, y0, rows, map) {
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      const c = map[rows[j][i]];
      if (c) pix.setArr(x0 + i, y0 + j, c);
    }
  }
}

/** Round-headed iron stud/nail, lit from the upper left. */
function stud(pix, x, y, c, r = 1) {
  const lo = scaleC(c, 0.45), hi = scaleC(c, 1.55);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r * 0.4) continue;
      const k = dx + dy < 0 ? 1 : dx + dy > 0 ? 0.6 : 0.85;
      pix.setArr(x + dx, y + dy, scaleC(c, k));
    }
  }
  pix.setArr(x - (r > 0 ? 1 : 0), y - (r > 0 ? 1 : 0), hi);
  pix.setArr(x + r, y + r, lo);
}

// --- shared surface builders ----------------------------------------------

/** Two-tone fbm ground with a large-scale patch tint. The base of all soil. */
function groundBase(pix, colA, colB, o = {}) {
  const {
    per = 10, oct = 4, gain = 0.55, seed = 1, contrast = 1.4,
    patchPer = 3, patchAmt = 0.3, patchCol = null, patchSeed = 555,
  } = o;
  paint(pix, (x, y) => {
    const n = nz(x, y, per, seed, oct, gain, pix.w);
    let c = mixC(colA, colB, clamp01((n - 0.5) * contrast + 0.5));
    if (patchCol) {
      const t = smoothstep(0.42, 0.78, nz(x, y, patchPer, patchSeed, 3, 0.6, pix.w));
      c = mixC(c, patchCol, t * patchAmt);
    }
    return c;
  });
  return pix;
}

/**
 * Cobbles / fieldstone: jittered cells, each domed and individually toned,
 * with dark mortar in the gaps. `stretch` squashes cells along Y for courses.
 */
function cobbleFill(pix, o = {}) {
  const {
    per = 7, seed = 11, colDark = [58, 56, 52], colLite = [148, 142, 130],
    mortar = [46, 42, 36], jitter = 0.95, gap = 0.16, dome = 0.5,
    warp = 0.35, stretch = 1, grain = 0.14, rim = 0.3,
  } = o;
  const size = pix.w;
  paint(pix, (x, y) => {
    const wx = (x / size) * per + (nz(x, y, 4, seed + 3, 2, 0.5, size) - 0.5) * warp;
    const wy = (y / size) * per * stretch + (nz(x, y, 4, seed + 9, 2, 0.5, size) - 0.5) * warp;
    const c = worley(wx, wy, per, seed, jitter);
    const tone = hash2(c.gx, c.gy, seed + 31);
    const warm = hash2(c.gx, c.gy, seed + 61);
    let col = mixC(colDark, colLite, 0.18 + tone * 0.8);
    col = [col[0] * (0.95 + warm * 0.12), col[1] * (0.98 + warm * 0.05), col[2] * (1.04 - warm * 0.12)];
    // dome: upper-left of each stone catches the light, rim falls away
    const k = 1 - ((wx - c.cx) + (wy - c.cy)) * dome - c.f1 * rim;
    col = scaleC(col, clamp(k, 0.42, 1.7));
    col = scaleC(col, 1 - grain * 0.5 + nz(x, y, 22, seed + 5, 2, 0.5, size) * grain);
    const edge = c.f2 - c.f1;
    if (edge < gap) {
      const t = 1 - edge / gap;
      col = mixC(col, scaleC(mortar, 0.8 + nz1(x, y, 24, seed + 77, size) * 0.5), t * t * 0.95);
    }
    return col;
  });
  return pix;
}

/**
 * Brick / block course with running bond, per-brick tone, bevelled edges and
 * bitten corners. Everything masonry in the game routes through here.
 */
function courseWall(pix, o = {}) {
  const {
    rows = 5, cols = 2, seed = 13, mortarW = 1, off = 0.5,
    colA = [96, 52, 38], colB = [156, 84, 58], mortar = [176, 168, 150],
    bevel = 0.26, chip = 0.35, grain = 0.16, grainPerX = 20, grainPerY = 12,
    faceFn = null, wobble = 0.6,
  } = o;
  const size = pix.w;
  const bh = size / rows, bw = size / cols;
  paint(pix, (x, y) => {
    // A little vertical wobble in the mortar keeps courses from looking CG.
    const wob = (nz1(x, y, 16, seed + 5, size) - 0.5) * wobble;
    const yy = y + wob;
    let row = Math.floor(yy / bh); row = wrapI(row, rows);
    const yIn = yy - Math.floor(yy / bh) * bh;
    const rowOff = ((row * off) % 1) * bw;
    const bx = wrapI(x + rowOff + (nz1(x, y, 16, seed + 8, size) - 0.5) * wobble, size);
    const col = Math.floor(bx / bw);
    const xIn = bx - col * bw;

    const tone = hash2(col, row, seed + 17);
    const mortarPix = scaleC(mortar, 0.82 + nz1(x, y, 26, seed + 23, size) * 0.42);
    if (yIn < mortarW || xIn < mortarW) return mortarPix;

    // Bitten corners: each brick loses one or two of them.
    const u = (xIn - mortarW) / (bw - mortarW), v = (yIn - mortarW) / (bh - mortarW);
    const cq = hash2(col, row, seed + 41);
    const bite = chip * (0.5 + hash2(col, row, seed + 43));
    const cu = cq < 0.25 ? u : cq < 0.5 ? 1 - u : cq < 0.75 ? u : 1 - u;
    const cv = cq < 0.5 ? v : 1 - v;
    if (cu * (bw - mortarW) + cv * (bh - mortarW) < bite * 3.4) return mortarPix;

    let c = faceFn
      ? faceFn(x, y, u, v, col, row, tone)
      : mixC(colA, colB, 0.25 + tone * 0.7);
    c = scaleC(c, 1 - grain * 0.5 + fbmXY(x, y, grainPerX, grainPerY, seed + col * 7 + row * 31, 3, 0.55, size) * grain);
    // bevel: lit top/left, shadowed bottom/right
    const eIn = Math.min(u, v), eOut = Math.max(u, v);
    const k = eIn < 0.09 ? 1 + bevel * (1 - eIn / 0.09)
      : eOut > 0.91 ? 1 - bevel * 0.85 * ((eOut - 0.91) / 0.09) : 1;
    return scaleC(c, k * (0.9 + tone * 0.2));
  });
  return pix;
}

/** Vertical dark streaks running down from the mortar lines - old masonry. */
function weatherStreaks(pix, o = {}) {
  const { seed = 71, rows = 3, amount = 0.35, col = [40, 40, 38], perX = 26 } = o;
  const size = pix.w;
  const bh = size / rows;
  paint(pix, (x, y) => {
    const n = fbmXY(x, y, perX, 2, seed, 3, 0.6, size);
    const s = smoothstep(0.56, 0.86, n);
    if (s <= 0) return null;
    const down = (y % bh) / bh;
    const t = s * amount * smoothstep(0, 0.5, down) * (1 - down * 0.35);
    const cur = pix.get(x, y);
    return mixC(cur, col, t);
  });
  return pix;
}

/** Wood grain multiplier along an axis; returns a 0.85..1.15-ish scalar. */
function grainK(x, y, seed, vertical = true, amt = 0.16, size = 64) {
  const g = vertical ? fbmXY(x, y, 26, 3, seed, 3, 0.55, size) : fbmXY(x, y, 3, 26, seed, 3, 0.55, size);
  return 1 - amt * 0.5 + g * amt;
}

/** A knot in a plank: concentric dark rings. */
function knot(pix, cx, cy, r, dark, light) {
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy * 2.0);
      if (d > r + 1) continue;
      const ring = Math.sin(d * 2.6) * 0.5 + 0.5;
      const t = clamp01(1 - d / (r + 1));
      blend(pix, cx + dx, cy + dy, mixC(light, dark, ring * 0.8 + 0.2), t * 0.9);
    }
  }
}

// ===========================================================================
// TERRAIN
// ===========================================================================

/** Shared grass builder: base soil, bare patches, then drawn clumps + tufts. */
function grassTex(o) {
  const {
    dk, md, lt, hi, soil, seed = 101, dirtLo = 0.56, dirtHi = 0.78, dirtAmt = 0.75,
    clumps = 60, tufts = 60, blades = true, per = 8,
  } = o;
  const p = P();
  // A calm mid-tone sward. Contrast lives in the drawn clumps, not the base,
  // or the tile turns into camouflage when it repeats across the heightmap.
  paint(p, (x, y) => {
    const n = fbmXY(x, y, per, per, seed, 4, 0.5);
    const patch = nz(x, y, 3, seed + 202, 3, 0.6);
    const c = mixC(dk, md, clamp01((n - 0.4) * 1.5 + 0.35));
    return mixC(c, lt, clamp01((patch - 0.55) * 1.1));
  });
  // bare earth showing through the sward
  paint(p, (x, y) => {
    const t = smoothstep(dirtLo, dirtHi, nz(x, y, 4, seed + 303, 4, 0.55));
    if (t <= 0) return null;
    const d = scaleC(soil, 0.85 + nz1(x, y, 20, seed + 404) * 0.35);
    return mixC(p.get(x, y), d, t * dirtAmt);
  });
  const rnd = new Rand(seed + 7);
  for (const [cx, cy] of scatter(clumps, seed + 7)) {
    const rx = rnd.float(2.2, 3.6), ry = rx * rnd.float(0.5, 0.8);
    const c = scaleC(mixC(md, hi, rnd.float(0.45, 1)), rnd.float(0.92, 1.06));
    // shadow pooled at the base of the clump, blades catching light on top
    blob(p, cx, cy + 1, rx * 1.05, ry, (x, y, d) => {
      if (d > 0.9) return null;
      return scaleC(p.get(x, y), 0.9);
    });
    blob(p, cx, cy, rx, ry, (x, y, d, dx, dy) => {
      const wob = nz1(x, y, 32, seed + 61) * 0.45;
      if (d > 0.55 + wob) return null;
      return mixC(p.get(x, y), scaleC(c, 1 - dy * 0.04), 0.6 - d * 0.2);
    });
    if (blades) {
      const n = rnd.int(2, 4);
      for (let b = 0; b < n; b++) {
        vstroke(p, cx + rnd.int(-2, 2), cy - Math.round(ry * 0.6), rnd.int(2, 3),
          scaleC(c, 1.16), rnd.bool(0.4) ? 0.5 : 0);
      }
    }
  }
  // the little 2-3px dark marks that sell hand painting
  for (const [cx, cy] of scatter(tufts, seed + 11)) {
    const c = mixC(p.get(cx, cy), dk, 0.6);
    vstroke(p, cx, cy, rnd.int(2, 3), c, rnd.bool(0.5) ? 0.4 : -0.4);
  }
  grit(p, 60, seed + 909);
  return p;
}

const tGrass = () => grassTex({
  dk: [62, 90, 40], md: [90, 116, 52], lt: [110, 140, 60], hi: [135, 160, 80],
  soil: [106, 88, 60], seed: 101,
});
const tGrassDry = () => grassTex({
  dk: [96, 96, 56], md: [124, 118, 68], lt: [146, 136, 84], hi: [166, 156, 100],
  soil: [138, 112, 80], seed: 131, dirtLo: 0.50, dirtHi: 0.74, dirtAmt: 0.8,
  clumps: 34, tufts: 70,
});
const tGrassLush = () => grassTex({
  dk: [54, 82, 34], md: [78, 108, 44], lt: [98, 130, 54], hi: [124, 152, 72],
  soil: [90, 76, 52], seed: 167, dirtLo: 0.76, dirtHi: 0.92, dirtAmt: 0.55,
  clumps: 62, tufts: 50,
});

function tDirt() {
  const p = P();
  groundBase(p, [90, 74, 50], [138, 112, 80], { per: 8, seed: 211, contrast: 1.3, patchCol: [104, 86, 58], patchAmt: 0.4 });
  // clods: little raised lumps of soil, lit upper-left
  const rnd = new Rand(217);
  for (const [cx, cy] of scatter(110, 217)) {
    const r = rnd.float(1.6, 3.4);
    const base = rnd.float(0.82, 1.2);
    blob(p, cx, cy, r, r * rnd.float(0.6, 0.95), (x, y, d, dx, dy) => {
      if (d > 0.85 + nz1(x, y, 32, 219) * 0.3) return null;
      const k = base * (1 - (dx + dy) * 0.10);
      return scaleC(p.get(x, y), clamp(k, 0.72, 1.28));
    });
  }
  cracks(p, { period: 6, seed: 223, width: 0.05, darkness: 0.35 });
  grit(p, 220, 227);
  return p;
}

function tMud() {
  const p = P();
  groundBase(p, [62, 50, 34], [110, 90, 62], { per: 7, seed: 233, contrast: 1.25, patchCol: [78, 64, 44], patchAmt: 0.4 });
  // churned ridges: mud holds the shape of whatever trod through it
  const rnd = new Rand(243);
  for (const [cx, cy] of scatter(44, 243)) {
    const r = rnd.float(2, 4.2);
    blob(p, cx, cy, r, r * rnd.float(0.4, 0.8), (x, y, d, dx, dy) => {
      if (d > 0.85 + nz1(x, y, 24, 245) * 0.3) return null;
      return scaleC(p.get(x, y), clamp(1 - (dx + dy) * 0.13, 0.6, 1.4));
    });
  }
  // puddles: dark water with a lit rim and a cool sky sheen inside
  paint(p, (x, y) => {
    const n = nz(x, y, 4, 239, 4, 0.6);
    const t = smoothstep(0.54, 0.62, n);
    if (t <= 0) return null;
    // standing water over mud is dark warm brown, never grey-blue
    let c = mixC(p.get(x, y), [44, 34, 24], t * 0.7);
    const sh = smoothstep(0.6, 0.72, n) * smoothstep(0.4, 0.65, nzXY(x, y, 6, 14, 241));
    c = mixC(c, [96, 84, 62], sh * 0.45);
    const rim = smoothstep(0.53, 0.545, n) * (1 - smoothstep(0.555, 0.575, n));
    return mixC(c, [124, 104, 76], rim * 0.4);
  });
  grit(p, 110, 247);
  return p;
}

function tRoadDirt() {
  const p = P();
  groundBase(p, [92, 68, 40], [162, 128, 84], { per: 9, seed: 251, contrast: 1.3, patchCol: [116, 92, 58], patchAmt: 0.4 });
  // wheel scuffs running along the road axis
  paint(p, (x, y) => {
    const s = fbmXY(x, y, 2, 22, 257, 3, 0.6);
    const k = 0.86 + s * 0.3;
    return scaleC(p.get(x, y), k);
  });
  // pressed-in pebbles
  const rnd = new Rand(263);
  for (let i = 0; i < 70; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(1, 2.2);
    const base = mixC([96, 90, 80], [172, 166, 152], rnd.float());
    blob(p, cx, cy, r, r * 0.75, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return scaleC(base, clamp(1 - (dx + dy) * 0.14 - d * 0.2, 0.5, 1.4));
    });
  }
  grit(p, 200, 269);
  return p;
}

function tRoadCobble() {
  const p = P();
  cobbleFill(p, {
    per: 8, seed: 271, colDark: [98, 90, 78], colLite: [164, 154, 136],
    mortar: [78, 72, 60], jitter: 1.0, gap: 0.18, dome: 0.34, warp: 0.4, rim: 0.28,
  });
  // grit and moss settled in the joints
  paint(p, (x, y) => {
    const t = smoothstep(0.62, 0.82, nz(x, y, 3, 277, 3, 0.6));
    if (t <= 0) return null;
    return mixC(p.get(x, y), [72, 82, 46], t * 0.4);
  });
  grit(p, 180, 281);
  return p;
}

/**
 * Wind-rippled sand. The ripple phase is heavily warped by low-frequency noise
 * so the crests wander and the wavelength varies across the tile - a clean sine
 * train reads as corduroy the moment the tile repeats.
 */
function sandTex(o) {
  const { colA, colB, colHi, colShadow, seed, kx = 1, ky = 5, rippleAmp = 0.1, gritN = 220 } = o;
  const p = P();
  paint(p, (x, y) => {
    const warp = (nz(x, y, 3, seed + 1, 3, 0.6) - 0.5) * 9 + (nz(x, y, 6, seed + 2, 2, 0.5) - 0.5) * 3;
    const s = Math.sin(TAU * (x * kx + y * ky) / 64 + warp);
    const n = fbmXY(x, y, 16, 16, seed + 3, 4, 0.55);
    let c = mixC(colA, colB, clamp01(0.35 + n * 0.7));
    // the ripple is barely there - a stipple, not a corrugation
    c = scaleC(c, 1 + s * rippleAmp);
    c = mixC(c, colHi, clamp01(s - 0.75) * 0.35);
    // occasional shadow streak in the lee of a crest
    const streak = clamp01(-s - 0.7) * smoothstep(0.45, 0.75, nz(x, y, 4, seed + 5, 3, 0.6));
    return mixC(c, colShadow, streak * 0.45);
  });
  grit(p, gritN, seed + 9, 0.93, 1.07);
  return p;
}

const tSand = () => sandTex({
  colA: [180, 154, 106], colB: [216, 192, 140], colHi: [226, 206, 158], colShadow: [142, 122, 82],
  seed: 311, kx: 1, ky: 5, rippleAmp: 0.055,
});
function tSandDune() {
  const p = sandTex({
    colA: [172, 144, 96], colB: [212, 186, 132], colHi: [224, 202, 152], colShadow: [136, 116, 78],
    seed: 317, kx: 2, ky: 7, rippleAmp: 0.075,
  });
  // a second, coarser ripple set crossing the first
  paint(p, (x, y) => {
    const s = Math.sin(TAU * (x * 3 - y * 2) / 64 + nz(x, y, 3, 319, 3, 0.6) * 8);
    return scaleC(p.get(x, y), 1 + s * 0.035);
  });
  return p;
}

function tSnow() {
  const p = P();
  paint(p, (x, y) => {
    const n = fbmXY(x, y, 10, 10, 331, 4, 0.55);
    const drift = Math.sin(TAU * (x * 1 + y * 3) / 64 + nz(x, y, 3, 333, 2, 0.5) * 4);
    let c = mixC([200, 206, 218], [240, 244, 250], clamp01(0.3 + n * 0.8));
    c = scaleC(c, 1 + drift * 0.05);
    // blue shadow in the hollows
    return mixC(c, [154, 166, 186], clamp01(-drift * 0.5) * 0.55);
  });
  const rnd = new Rand(337);
  for (let i = 0; i < 70; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(2, 5);
    blob(p, cx, cy, r, r * 0.55, (x, y, d, dx, dy) => {
      if (d > 0.9 + nz1(x, y, 24, 339) * 0.3) return null;
      return scaleC(p.get(x, y), clamp(1 - (dx + dy) * 0.05 + 0.05, 0.8, 1.15));
    });
  }
  grit(p, 90, 341);
  return p;
}

function tSnowRock() {
  const p = P();
  cobbleFill(p, {
    per: 5, seed: 347, colDark: [66, 64, 62], colLite: [140, 138, 132],
    mortar: [46, 44, 42], jitter: 1.0, gap: 0.14, dome: 0.55, warp: 0.5, rim: 0.35,
  });
  // snow lies on the upward faces and fills the cracks
  paint(p, (x, y) => {
    const n = nz(x, y, 5, 349, 4, 0.55);
    const t = smoothstep(0.44, 0.62, n);
    if (t <= 0) return null;
    const snow = mixC([176, 188, 204], [246, 250, 252], clamp01(nz1(x, y, 20, 351)));
    return mixC(p.get(x, y), snow, clamp01(t) * 0.95);
  });
  grit(p, 60, 353);
  return p;
}

function tGravel() {
  const p = P();
  p.fill(44, 40, 34);
  cobbleFill(p, {
    per: 14, seed: 359, colDark: [80, 72, 58], colLite: [172, 160, 136],
    mortar: [56, 50, 40], jitter: 1.0, gap: 0.26, dome: 0.7, warp: 0.3, rim: 0.5, grain: 0.1,
  });
  grit(p, 300, 367);
  return p;
}

function tMossRock() {
  const p = P();
  cobbleFill(p, {
    per: 6, seed: 373, colDark: [72, 74, 64], colLite: [140, 140, 126],
    mortar: [52, 54, 44], jitter: 1.0, gap: 0.16, dome: 0.4, warp: 0.5, rim: 0.28,
  });
  // moss grows out of the joints, not in random blobs
  paint(p, (x, y) => {
    const wx = (x / 64) * 6, wy = (y / 64) * 6;
    const c = worley(wx, wy, 6, 373, 1.0);
    const joint = 1 - smoothstep(0.05, 0.35, c.f2 - c.f1);
    const n = nz(x, y, 4, 379, 3, 0.6);
    const t = clamp01(joint * 0.8 + (n - 0.5) * 1.2) * smoothstep(0.35, 0.6, n);
    if (t <= 0) return null;
    const moss = mixC([62, 84, 42], [104, 124, 60], nz1(x, y, 24, 383));
    return mixC(p.get(x, y), moss, clamp01(t) * 0.9);
  });
  grit(p, 120, 389);
  return p;
}

function tSwampMuck() {
  const p = P();
  groundBase(p, [58, 68, 40], [92, 98, 56], { per: 4, seed: 397, contrast: 1.0, patchCol: [66, 66, 40], patchAmt: 0.7, patchPer: 4 });
  // algae film in sheets, with a few gas bubbles pushing through
  paint(p, (x, y) => {
    const n = nz(x, y, 4, 401, 4, 0.6);
    const t = smoothstep(0.5, 0.66, n);
    if (t <= 0) return null;
    return mixC(p.get(x, y), mixC([70, 84, 46], [118, 128, 74], nz1(x, y, 18, 403)), t * 0.6);
  });
  const rnd = new Rand(409);
  for (const [cx, cy] of scatter(32, 409)) {
    const r = rnd.float(1.2, 2.6);
    blob(p, cx, cy, r, r, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      const k = d > 0.8 ? 0.86 : 1 - (dx + dy) * 0.1;
      return scaleC(p.get(x, y), clamp(k, 0.75, 1.25));
    });
  }
  // dead reed fragments
  for (let i = 0; i < 16; i++) {
    const cx = rnd.int(64), cy = rnd.int(64);
    vstroke(p, cx, cy, rnd.int(3, 5), [92, 84, 46], rnd.float(-0.5, 0.5));
  }
  grit(p, 120, 419);
  return p;
}

function tFarmland() {
  const p = P();
  const dk = [72, 58, 40], md = [118, 96, 66], lt = [150, 126, 92];
  paint(p, (x, y) => {
    // four ploughed furrows; the ridge line wanders and its height varies, so
    // it reads as turned earth rather than a sine grating
    const wob = (fbmXY(x, y, 4, 2, 421, 3, 0.6) - 0.5) * 9 + (nzXY(x, y, 9, 2, 425) - 0.5) * 3;
    const t = wrapI(y + wob, 16) / 16;
    const depth = 0.26 + nzXY(x, y, 5, 2, 427) * 0.22;
    const k = 1 - Math.cos(t * TAU) * depth;
    const n = fbmXY(x, y, 18, 10, 423, 4, 0.55);
    let c = mixC(dk, md, clamp01(0.25 + n * 0.85));
    c = scaleC(c, clamp(k, 0.6, 1.4));
    return mixC(c, lt, clamp01((k - 1.12) * 2.4) * 0.45);
  });
  // clods turned up by the plough, evenly spread so they do not clump
  const rnd = new Rand(431);
  for (const [cx, cy] of scatter(80, 431)) {
    const r = rnd.float(1.2, 2.6);
    blob(p, cx, cy, r, r * 0.8, (x, y, d, dx, dy) => {
      if (d > 0.9) return null;
      return scaleC(p.get(x, y), clamp(1 - (dx + dy) * 0.12, 0.7, 1.3));
    });
  }
  grit(p, 150, 433);
  return p;
}

function tAsh() {
  const p = P();
  groundBase(p, [58, 52, 48], [138, 130, 122], { per: 9, seed: 439, contrast: 1.2, patchCol: [86, 78, 70], patchAmt: 0.4 });
  // drift ripples plus charred lumps
  paint(p, (x, y) => {
    const s = Math.sin(TAU * (x * 2 + y * 1) / 64 + nz(x, y, 3, 443, 2, 0.5) * 5);
    return scaleC(p.get(x, y), 1 + s * 0.07);
  });
  const rnd = new Rand(449);
  for (let i = 0; i < 32; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(1.2, 2.8);
    blob(p, cx, cy, r, r * 0.8, (x, y, d, dx, dy) => {
      if (d > 0.95) return null;
      const c = mixC([38, 34, 32], [72, 66, 62], nz1(x, y, 20, 451));
      return scaleC(c, clamp(1 - (dx + dy) * 0.18, 0.6, 1.5));
    });
  }
  grit(p, 200, 457);
  return p;
}

function tVolcanicRock() {
  const p = P();
  cobbleFill(p, {
    per: 4, seed: 461, colDark: [26, 24, 26], colLite: [84, 78, 78],
    mortar: [14, 12, 12], jitter: 1.0, gap: 0.2, dome: 0.6, warp: 0.5, rim: 0.4,
  });
  cracks(p, { period: 7, seed: 463, width: 0.09, darkness: 0.6 });
  // rust-red oxidation creeping over the basalt
  paint(p, (x, y) => {
    const t = smoothstep(0.58, 0.8, nz(x, y, 4, 467, 3, 0.6));
    if (t <= 0) return null;
    return mixC(p.get(x, y), [96, 52, 32], t * 0.35);
  });
  grit(p, 160, 479);
  return p;
}

function tBeachWet() {
  const p = P();
  paint(p, (x, y) => {
    const n = fbmXY(x, y, 12, 12, 487, 4, 0.55);
    // wet sand is markedly darker and cooler than dry
    let c = mixC([76, 64, 46], [134, 116, 84], clamp01(0.3 + n * 0.8));
    // tide lines: shallow scalloped ridges left by the last wave
    const tide = Math.sin(TAU * (y * 3 + x * 1) / 64 + nz(x, y, 3, 489, 3, 0.6) * 7);
    c = scaleC(c, 1 + tide * 0.16);
    // a rime of dried salt foam on the crest of each line
    c = mixC(c, [172, 162, 142], clamp01(tide - 0.9) * 1.2);
    // sheen of standing water in the troughs
    const sh = smoothstep(0.5, 0.78, nz(x, y, 4, 491, 3, 0.6)) * clamp01(-tide * 0.8);
    return mixC(c, [104, 128, 140], sh * 0.6);
  });
  // shells and pebbles pressed into the wet sand
  const rnd = new Rand(499);
  for (let i = 0; i < 34; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(1.1, 2.2);
    const base = rnd.bool(0.4) ? [176, 168, 150] : [92, 80, 60];
    blob(p, cx, cy, r, r * 0.65, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return scaleC(base, clamp(1 - (dx + dy) * 0.16 - d * 0.15, 0.6, 1.35));
    });
  }
  grit(p, 150, 503);
  return p;
}

function tTundra() {
  const p = P();
  groundBase(p, [72, 68, 50], [112, 106, 80], { per: 5, seed: 509, contrast: 1.0, patchCol: [92, 80, 58], patchAmt: 0.35 });
  // lichen crust: drawn as discrete pale rosettes rather than a noise wash
  const lich = new Rand(521);
  for (const [cx, cy] of scatter(30, 521)) {
    const r = lich.float(3, 6.5);
    const c = mixC([118, 124, 96], [152, 156, 122], lich.float());
    blob(p, cx, cy, r, r * lich.float(0.6, 1), (x, y, d) => {
      const wob = nz1(x, y, 26, 523) * 0.5;
      if (d > 0.55 + wob) return null;
      return mixC(p.get(x, y), c, 0.8 - d * 0.35);
    });
  }
  const rnd = new Rand(541);
  for (const [cx, cy] of scatter(44, 541)) {
    const r = rnd.float(1, 2.2);
    blob(p, cx, cy, r, r * 0.8, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return scaleC(mixC([86, 80, 68], [142, 134, 116], rnd.float()), clamp(1 - (dx + dy) * 0.16, 0.6, 1.4));
    });
  }
  for (let i = 0; i < 40; i++) vstroke(p, rnd.int(64), rnd.int(64), rnd.int(2, 3), [72, 78, 48], rnd.float(-0.5, 0.5));
  grit(p, 130, 547);
  return p;
}

function tForestFloor() {
  const p = P();
  groundBase(p, [32, 26, 16], [76, 60, 36], { per: 8, seed: 557, contrast: 1.5, patchCol: [48, 42, 24], patchAmt: 0.5 });
  const rnd = new Rand(563);
  // a couple of roots crossing the frame - nearly straight, or they scribble
  for (let i = 0; i < 3; i++) {
    let x = rnd.float(64), y = rnd.float(64);
    let a = rnd.float(TAU);
    for (let s = 0; s < 54; s++) {
      a += rnd.float(-0.12, 0.12);
      x += Math.cos(a); y += Math.sin(a);
      pixSetRound(p, x, y, [54, 40, 24]);
      pixSetRound(p, x, y + 1, [38, 28, 16]);
      pixSetRound(p, x, y - 1, [92, 72, 44]);
    }
  }
  // leaf litter: little flat blades of colour, each with a lit edge
  const leafCols = [[132, 92, 40], [156, 116, 48], [104, 96, 44], [88, 62, 32], [168, 132, 62], [72, 84, 40]];
  for (let i = 0; i < 130; i++) {
    const cx = rnd.int(64), cy = rnd.int(64);
    const flip = rnd.bool();
    const rx = flip ? rnd.float(1.6, 2.6) : rnd.float(0.9, 1.4);
    const ry = flip ? rnd.float(0.9, 1.4) : rnd.float(1.6, 2.6);
    const c = scaleC(rnd.pick(leafCols), rnd.float(0.85, 1.15));
    blob(p, cx, cy, rx, ry, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return scaleC(c, dx + dy < -0.4 ? 1.2 : d > 0.7 ? 0.7 : 1);
    });
  }
  for (let i = 0; i < 26; i++) {
    const cx = rnd.int(64), cy = rnd.int(64);
    vstroke(p, cx, cy, rnd.int(3, 5), [64, 48, 28], rnd.float(-1, 1));
  }
  grit(p, 140, 569);
  return p;
}

function pixSetRound(pix, x, y, c) { pix.setArr(Math.round(x), Math.round(y), c); }

// ===========================================================================
// CLIFFS
// ===========================================================================

/**
 * Cliff face: tall fractured slabs, each stepped into horizontal beds. The
 * slab boundaries wander with height so nothing reads as a column of tiles.
 */
function cliffTex(o) {
  const {
    colDark, colLite, seed, beds = 5, slabs = 4, mossCol = null, mossAmt = 0,
    snowAmt = 0, snowCol = [232, 240, 248], tint = null, tintAmt = 0, rough = 0.4,
  } = o;
  const p = P();
  const sw = 64 / slabs, bh = 64 / beds;
  const slabAt = (x, y) => {
    // the fracture wanders by half a slab width, so no two courses line up
    const xs = wrapI(x + (fbmXY(x, y, 2, 5, seed + 1, 3, 0.6) - 0.5) * 15, 64);
    return { i: Math.floor(xs / sw), u: (xs % sw) / sw };
  };
  const bedAt = (x, y, si) => {
    const ys = wrapI(
      y + hash2(si, 0, seed + 3) * bh + (fbmXY(x, y, 5, 3, seed + 5, 3, 0.6) - 0.5) * 10, 64,
    );
    return { i: Math.floor(ys / bh), v: (ys % bh) / bh };
  };
  paint(p, (x, y) => {
    const s = slabAt(x, y);
    const b = bedAt(x, y, s.i);
    const tone = hash2(s.i, b.i, seed + 7);
    let c = mixC(colDark, colLite, 0.18 + tone * 0.62);
    // rough broken rock inside every bed
    const n = fbmXY(x, y, 16, 20, seed + 11, 4, 0.55);
    c = scaleC(c, 1 - rough * 0.5 + n * rough);
    // bed relief: lit shelf on top, shadow under the overhang
    const kb = b.v < 0.11 ? 1.24 - b.v * 1.0 : b.v > 0.88 ? 0.66 + (1 - b.v) * 1.8 : 1;
    // slab relief: fracture gap on the left, lit face, shadow on the right
    const ku = s.u < 0.045 ? 0.55 : s.u < 0.2 ? 1.16 : s.u > 0.93 ? 0.74 : 1;
    c = scaleC(c, kb * ku * (0.92 + tone * 0.16));
    if (tint) c = mixC(c, tint, smoothstep(0.5, 0.85, nz(x, y, 4, seed + 13, 3, 0.6)) * tintAmt);
    return c;
  });
  // knock chunks out of the face so the courses never read as masonry
  const rnd = new Rand(seed + 37);
  for (let i = 0; i < 22; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(2.5, 6);
    const up = rnd.bool(0.55);
    blob(p, cx, cy, r, r * rnd.float(0.5, 0.9), (x, y, d, dx, dy) => {
      if (d > 0.7 + nz1(x, y, 18, seed + 41) * 0.45) return null;
      return scaleC(p.get(x, y), clamp(up ? 1 - (dx + dy) * 0.1 : 0.88 + (dx + dy) * 0.05, 0.55, 1.45));
    });
  }
  cracks(p, { period: 6, seed: seed + 17, width: 0.045, darkness: 0.35 });
  if (mossCol) {
    paint(p, (x, y) => {
      const b = bedAt(x, y, slabAt(x, y).i);
      // moss clings to the ledges where damp collects
      const t = smoothstep(0.5, 0.75, nz(x, y, 4, seed + 19, 3, 0.6)) * (b.v < 0.3 ? 1 : 0.35);
      if (t <= 0) return null;
      return mixC(p.get(x, y), mossCol, t * mossAmt);
    });
  }
  if (snowAmt > 0) {
    paint(p, (x, y) => {
      const b = bedAt(x, y, slabAt(x, y).i);
      const t = (1 - smoothstep(0.02, 0.26, b.v)) * smoothstep(0.3, 0.55, nz(x, y, 5, seed + 23, 3, 0.6));
      if (t <= 0) return null;
      const snow = mixC(mixC(snowCol, [176, 190, 210], 0.35), snowCol, nz1(x, y, 22, seed + 29));
      return mixC(p.get(x, y), snow, clamp01(t * 1.4) * snowAmt);
    });
  }
  grit(p, 120, seed + 31);
  return p;
}

const tCliffRock = () => cliffTex({
  colDark: [62, 58, 50], colLite: [152, 144, 126], seed: 601, beds: 4, slabs: 3,
  mossCol: [72, 90, 46], mossAmt: 0.32,
});
const tCliffSand = () => cliffTex({
  colDark: [128, 94, 52], colLite: [216, 184, 128], seed: 607, beds: 6, slabs: 3,
  tint: [170, 124, 70], tintAmt: 0.35, rough: 0.3,
});
const tCliffSnow = () => cliffTex({
  colDark: [66, 66, 64], colLite: [138, 136, 130], seed: 613, beds: 4, slabs: 3,
  snowAmt: 0.8,
});
const tCliffVolcanic = () => cliffTex({
  colDark: [26, 24, 26], colLite: [92, 84, 80], seed: 617, beds: 5, slabs: 4,
  tint: [104, 44, 22], tintAmt: 0.32,
});

// ===========================================================================
// BUILDING WALLS
// ===========================================================================

/** Lime plaster: trowelled, slightly uneven, cracked, with a patch fallen off. */
function plasterBase(p, o = {}) {
  const { seed = 701, colA = [176, 162, 136], colB = [226, 214, 190] } = o;
  paint(p, (x, y) => {
    const n = fbmXY(x, y, 9, 9, seed, 4, 0.55);
    const sw = nzXY(x, y, 5, 4, seed + 3);
    // gentle range: lime render is an even wash with trowel marks, not marble
    const c = mixC(colA, colB, clamp01(0.34 + n * 0.55));
    return scaleC(c, 0.96 + sw * 0.09);
  });
  return p;
}

/**
 * Lime stucco: an even cream wash. Deliberately featureless - the spec range is
 * #C0B49A-#E0D8C0 and anything with a hero feature baked in turns into a
 * lattice the moment the wall is more than one tile wide.
 */
function tWallPlaster() {
  const p = P();
  plasterBase(p, { seed: 701, colA: [186, 176, 150], colB: [226, 218, 194] });
  // trowel sweeps, then hairline cracks with a little grime in them
  paint(p, (x, y) => {
    const sweep = fbmXY(x, y, 4, 7, 705, 3, 0.5);
    return scaleC(p.get(x, y), 0.97 + sweep * 0.07);
  });
  cracks(p, { period: 5, seed: 703, width: 0.022, darkness: 0.22 });
  grit(p, 70, 719, 0.96, 1.04);
  return p;
}

/**
 * Half-timbered Tudor wall: cream panels framed by dark oak posts, rails and a
 * diagonal brace. The signature New Sorpigal house.
 */
function tWallTimber() {
  const p = P();
  plasterBase(p, { seed: 727, colA: [186, 174, 148], colB: [236, 228, 206] });
  cracks(p, { period: 5, seed: 729, width: 0.03, darkness: 0.28 });

  // Beam mask: 0 none, otherwise 1 + axis (0 = vertical, 1 = horizontal,
  // 2 = diagonal). `across` holds 0..1 through the beam's thickness.
  const mask = new Uint8Array(64 * 64);
  const across = new Float32Array(64 * 64);
  const along = new Float32Array(64 * 64);

  const put = (x, y, axis, u, t) => {
    const i = wrapI(Math.round(y), 64) * 64 + wrapI(Math.round(x), 64);
    mask[i] = axis + 1; across[i] = u; along[i] = t;
  };
  // posts at x=0 and x=32 (7px), so a repeat gives evenly spaced studs
  for (let y = 0; y < 64; y++) {
    for (let k = 0; k < 7; k++) {
      put(wrapI(-3 + k, 64), y, 0, k / 6, y / 64);
      put(29 + k, y, 0, k / 6, y / 64);
    }
  }
  // rail across the top of the tile
  for (let x = 0; x < 64; x++) for (let k = 0; k < 8; k++) put(x, wrapI(-4 + k, 64), 1, k / 7, x / 64);
  // diagonal braces, one per panel, mirrored
  for (let s = 0; s <= 96; s++) {
    const t = s / 96;
    const bx = 5 + t * 22, by = 60 - t * 50;
    const bx2 = 59 - t * 22, by2 = 60 - t * 50;
    for (let k = -2; k <= 2; k++) {
      put(bx + k, by, 2, (k + 2) / 4, t);
      put(bx2 + k, by2, 2, (k + 2) / 4, t);
    }
  }

  const woodDk = [40, 26, 14], woodMd = [78, 52, 28], woodLt = [110, 78, 44];
  paint(p, (x, y) => {
    const i = y * 64 + x;
    if (!mask[i]) {
      // soft contact shadow where plaster meets a beam
      let sh = 0;
      for (let d = 1; d <= 2; d++) {
        if (mask[wrapI(y - d, 64) * 64 + x] || mask[y * 64 + wrapI(x - d, 64)]) sh = Math.max(sh, 0.34 / d);
      }
      return sh > 0 ? mixC(p.get(x, y), [92, 80, 62], sh) : null;
    }
    const axis = mask[i] - 1, u = across[i], t = along[i];
    const g = axis === 0 ? fbmXY(x, y, 3, 26, 731, 3, 0.55) : fbmXY(x, y, 26, 3, 733, 3, 0.55);
    let c = mixC(woodDk, mixC(woodMd, woodLt, g), 0.35 + g * 0.6);
    // beam relief: lit top-left face, dark bottom-right face
    const k = u < 0.16 ? 1.34 : u > 0.84 ? 0.62 : 1 + (0.5 - u) * 0.18;
    c = scaleC(c, k);
    // adze marks along the beam
    c = scaleC(c, 0.94 + nzXY(x, y, axis === 0 ? 2 : 18, axis === 0 ? 18 : 2, 737) * 0.13);
    return c;
  });
  return p;
}

function tWallBrick() {
  const p = P();
  courseWall(p, {
    rows: 5, cols: 2, seed: 751, mortarW: 2, off: 0.5,
    colA: [110, 58, 46], colB: [160, 90, 68], mortar: [176, 168, 150],
    bevel: 0.24, chip: 0.5, grain: 0.2,
  });
  // soot / weathering, warmer at the top of each brick
  blotch(p, { period: 3, seed: 757, amount: 0.24, threshold: 0.5 });
  grit(p, 130, 761);
  return p;
}

/**
 * Random rubble masonry: courses of unequal blocks bedded in thick mortar.
 * Rows alternate between two and four stones so the wall never reads as a grid.
 */
function tWallStoneBlock() {
  const p = P();
  const seed = 769;
  const rows = 4, bh = 64 / rows;
  const colDk = [80, 72, 58], colLt = [188, 178, 152], mortar = [100, 92, 74];
  paint(p, (x, y) => {
    const yy = wrapI(y + (fbmXY(x, y, 6, 2, seed + 1, 3, 0.6) - 0.5) * 3, 64);
    const row = Math.floor(yy / bh);
    const v = (yy % bh) / bh;
    const nb = hash2(row, 0, seed + 3) > 0.5 ? 2 : 4;
    const bw = 64 / nb;
    const xs = wrapI(x + hash2(row, 1, seed + 5) * 64 + (fbmXY(x, y, 2, 6, seed + 7, 3, 0.6) - 0.5) * 3, 64);
    const col = Math.floor(xs / bw);
    const u = (xs % bw) / bw;

    const mw = 2 / bw, mh = 2 / bh;
    if (u < mw || v < mh) {
      return scaleC(mortar, 0.78 + nz1(x, y, 26, seed + 11) * 0.4);
    }
    const tone = hash2(col, row, seed + 13);
    let c = mixC(colDk, colLt, 0.2 + tone * 0.72);
    c = scaleC(c, 0.9 + fbmXY(x, y, 20, 16, seed + col * 5 + row * 17, 3, 0.55) * 0.22);
    // face relief plus a hammered arris on the lit corner
    const uu = (u - mw) / (1 - mw), vv = (v - mh) / (1 - mh);
    const eIn = Math.min(uu, vv), eOut = Math.max(uu, vv);
    const k = eIn < 0.12 ? 1 + 0.3 * (1 - eIn / 0.12) : eOut > 0.88 ? 1 - 0.28 * ((eOut - 0.88) / 0.12) : 1;
    return scaleC(c, k);
  });
  // chisel pecks
  paint(p, (x, y) => {
    const n = nzXY(x, y, 32, 32, 773);
    if (n < 0.86) return null;
    return scaleC(p.get(x, y), n > 0.94 ? 1.14 : 0.88);
  });
  blotch(p, { period: 3, seed: 777, amount: 0.2 });
  grit(p, 110, 779);
  return p;
}

/** Big ashlar blocks with a heavy chisel bevel - castles and keeps. */
function ashlarWall(o) {
  const {
    rows = 3, cols = 2, seed, colA, colB, mortar, streak = 0.35, mossAmt = 0,
    mossCol = [64, 82, 44], bevel = 0.3,
  } = o;
  const p = P();
  courseWall(p, {
    rows, cols, seed, mortarW: 2, off: 0.5, colA, colB, mortar,
    bevel, chip: 0.35, grain: 0.14, grainPerX: 16, grainPerY: 10, wobble: 0.8,
  });
  // deep drafted margin: a second, softer bevel inside each block
  const bh = 64 / rows, bw = 64 / cols;
  paint(p, (x, y) => {
    const row = Math.floor(y / bh);
    const rowOff = ((row * 0.5) % 1) * bw;
    const bx = wrapI(x + rowOff, 64);
    const u = (bx % bw) / bw, v = (y % bh) / bh;
    const m = Math.min(u, v, 1 - u, 1 - v);
    if (m > 0.13) return null;
    const t = 1 - m / 0.13;
    const lit = (u < 0.13 || v < 0.13);
    return scaleC(p.get(x, y), lit ? 1 + t * 0.14 : 1 - t * 0.2);
  });
  weatherStreaks(p, { seed: seed + 91, rows, amount: streak, col: [44, 46, 44] });
  if (mossAmt > 0) {
    paint(p, (x, y) => {
      const t = smoothstep(0.55, 0.8, nz(x, y, 4, seed + 97, 3, 0.6));
      if (t <= 0) return null;
      return mixC(p.get(x, y), mossCol, t * mossAmt);
    });
  }
  grit(p, 120, seed + 101);
  return p;
}

const tWallCastle = () => ashlarWall({
  rows: 3, cols: 2, seed: 787, colA: [114, 108, 92], colB: [178, 170, 148],
  mortar: [92, 86, 72], streak: 0.3,
});
const tWallCastleDark = () => ashlarWall({
  rows: 3, cols: 2, seed: 797, colA: [72, 68, 58], colB: [126, 120, 104],
  mortar: [56, 54, 46], streak: 0.36, mossAmt: 0.28,
});
const tWallSandstone = () => ashlarWall({
  rows: 4, cols: 2, seed: 809, colA: [148, 116, 70], colB: [220, 190, 140],
  mortar: [166, 142, 104], streak: 0.22, bevel: 0.22,
});

/** Vertical boards with knots, nail heads and gaps. */
function plankWall(o) {
  const {
    seed, count = 6, colDk, colLt, horizontal = false, nails = true,
    gapDark = 0.45, knots = 5,
  } = o;
  const p = P();
  const span = 64 / count;
  paint(p, (x, y) => {
    const across = horizontal ? y : x;
    const pi = Math.floor(across / span);
    const u = (across - pi * span) / span;
    const tone = 0.82 + hash2(pi, 0, seed) * 0.36;
    const g = horizontal ? fbmXY(x, y, 26, 3, seed + pi * 13, 4, 0.55) : fbmXY(x, y, 3, 26, seed + pi * 13, 4, 0.55);
    let c = mixC(colDk, colLt, clamp01(0.2 + g * 0.95));
    c = scaleC(c, tone);
    // board edges: dark shadow gap on one side, lit chamfer on the other
    const k = u < 0.045 ? 1 - gapDark : u > 0.955 ? 1 - gapDark * 0.75 : u < 0.13 ? 1.16 : 1;
    return scaleC(c, k);
  });
  const rnd = new Rand(seed + 5);
  for (let i = 0; i < knots; i++) {
    const pi = rnd.int(count);
    const cx = horizontal ? rnd.int(64) : Math.round(pi * span + span * rnd.float(0.3, 0.7));
    const cy = horizontal ? Math.round(pi * span + span * rnd.float(0.3, 0.7)) : rnd.int(64);
    knot(p, cx, cy, rnd.float(1.6, 2.8), scaleC(colDk, 0.7), colLt);
  }
  if (nails) {
    for (let i = 0; i < count; i++) {
      const a = Math.round(i * span + span * 0.5);
      for (const b of [9, 54]) {
        const x = horizontal ? b : a, y = horizontal ? a : b;
        stud(p, x, y, [78, 74, 70], 1);
      }
    }
  }
  return p;
}

const tWallWoodPlank = () => {
  const p = plankWall({ seed: 811, count: 6, colDk: [52, 34, 18], colLt: [134, 96, 56], knots: 6 });
  grit(p, 90, 813);
  return p;
};

function tWallLog() {
  const p = P();
  const rows = 5, rh = 64 / rows;
  const dk = [46, 30, 16], md = [96, 66, 36], lt = [146, 108, 64];
  paint(p, (x, y) => {
    // logs sag slightly, and each has its own diameter
    const yy = y + (nzXY(x, y, 6, 1, 821) - 0.5) * 2.4;
    const row = wrapI(Math.floor(yy / rh), rows);
    const v = wrapI(yy, rh) / rh;
    const tone = 0.85 + hash2(row, 0, 823) * 0.32;
    // chinking between the logs
    if (v < 0.10) {
      const c = mixC([62, 56, 46], [104, 96, 82], nz1(x, y, 24, 827));
      return scaleC(c, 0.7 + v * 2);
    }
    const t = (v - 0.10) / 0.90;
    // cylinder shading, light from upper left
    const k = 0.52 + Math.sin(Math.min(1, t * 1.05) * Math.PI) * 0.72 + (1 - t) * 0.25;
    const g = fbmXY(x, y, 24, 4, 829 + row * 7, 4, 0.55);
    let c = mixC(dk, mixC(md, lt, g), 0.3 + g * 0.7);
    return scaleC(c, clamp(k * tone, 0.35, 1.5));
  });
  const rnd = new Rand(831);
  for (let i = 0; i < 6; i++) knot(p, rnd.int(64), Math.round(rnd.int(rows) * rh + rh * 0.5), rnd.float(1.8, 2.8), [40, 26, 14], [140, 104, 62]);
  grit(p, 80, 833);
  return p;
}

function tWallMarble() {
  const p = P();
  paint(p, (x, y) => {
    const n = fbmXY(x, y, 6, 6, 839, 4, 0.5);
    return mixC([208, 204, 192], [240, 238, 230], clamp01(0.3 + n * 0.8));
  });
  // veins: wandering hairlines with a soft halo, the way real marble reads
  const rnd = new Rand(841);
  for (let i = 0; i < 5; i++) {
    let x = rnd.float(64), y = rnd.float(64);
    let a = rnd.bool() ? rnd.float(-0.5, 0.5) : rnd.float(-0.5, 0.5) + Math.PI / 2;
    const dark = rnd.bool(0.35) ? [168, 164, 152] : [188, 184, 174];
    const len = rnd.int(50, 90);
    for (let s = 0; s < len; s++) {
      a += rnd.float(-0.3, 0.3);
      x += Math.cos(a); y += Math.sin(a);
      blend(p, Math.round(x), Math.round(y), dark, 0.5);
      blend(p, Math.round(x) + 1, Math.round(y), dark, 0.12);
      if (rnd.bool(0.04)) { // hairline branch
        let bx = x, by = y, ba = a + rnd.float(-1.2, 1.2);
        for (let s2 = 0; s2 < 9; s2++) {
          ba += rnd.float(-0.3, 0.3); bx += Math.cos(ba); by += Math.sin(ba);
          blend(p, Math.round(bx), Math.round(by), dark, 0.22);
        }
      }
    }
  }
  // faint block joints so the wall still has architecture
  paint(p, (x, y) => {
    const j = (wrapI(y, 32) < 1) || (wrapI(x + (Math.floor(y / 32) % 2) * 16, 32) < 1);
    if (!j) return null;
    return scaleC(p.get(x, y), 0.82);
  });
  paint(p, (x, y) => {
    const j = (wrapI(y - 1, 32) < 1) || (wrapI(x - 1 + (Math.floor(y / 32) % 2) * 16, 32) < 1);
    return j ? scaleC(p.get(x, y), 1.08) : null;
  });
  return p;
}

function tWallTemple() {
  const p = P();
  courseWall(p, {
    rows: 4, cols: 2, seed: 853, mortarW: 1, off: 0.5,
    colA: [166, 150, 116], colB: [226, 214, 184], mortar: [140, 128, 102],
    bevel: 0.2, chip: 0.15, grain: 0.12,
  });
  // carved frieze across the middle course: dentils and a lozenge, gilded
  const gold = [188, 152, 46], goldHi = [246, 220, 124], shadow = [92, 80, 56];
  const band = 26;
  const motif = [
    'GGGGGGGG',
    'GG..GG..',
    'GG..GG..',
    '........',
    '...GG...',
    '..GGGG..',
    '..GGGG..',
    '...GG...',
    '........',
    'GG..GG..',
    'GG..GG..',
    'GGGGGGGG',
  ];
  for (let bx = 0; bx < 64; bx += 8) {
    for (let j = 0; j < motif.length; j++) {
      for (let i = 0; i < 8; i++) {
        if (motif[j][i] !== 'G') continue;
        const x = bx + i, y = band + j;
        p.setArr(x, y, mixC(gold, goldHi, hash2(x, y, 857) * 0.6 + 0.2));
        blend(p, x + 1, y + 1, shadow, 0.45);
      }
    }
  }
  // relief shading on the band edges
  for (let x = 0; x < 64; x++) {
    blend(p, x, band - 1, [70, 62, 44], 0.55);
    blend(p, x, band + 12, [240, 232, 208], 0.5);
  }
  blotch(p, { period: 3, seed: 859, amount: 0.18 });
  return p;
}

/**
 * Shop frontage: a plaster panel over a boarded stall front with a moulded
 * rail, all in the wood/plaster families - a saturated painted colour would sit
 * outside the palette the rest of the town is built from.
 */
function tWallShopFront() {
  const p = plankWall({
    seed: 863, count: 5, colDk: [78, 54, 32], colLt: [140, 106, 68],
    horizontal: true, nails: false, knots: 3,
  });
  // upper half is rendered plaster, the way a stall front is finished
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 64; x++) {
      const n = fbmXY(x, y, 9, 9, 867, 4, 0.55);
      p.setArr(x, y, mixC([182, 172, 148], [222, 214, 190], clamp01(0.34 + n * 0.55)));
    }
  }
  // moulded rail dividing plaster from boards
  const railDk = [70, 48, 28], railMd = [118, 88, 54], railLt = [162, 128, 84];
  for (let x = 0; x < 64; x++) {
    p.setArr(x, 30, railLt); p.setArr(x, 31, railMd);
    p.setArr(x, 32, railMd); p.setArr(x, 33, railDk);
    p.setArr(x, 34, scaleC(railDk, 0.7));
  }
  // recessed boarded panels below the rail
  for (const bx of [4, 36]) {
    for (let y = 38; y < 60; y++) {
      for (let x = bx; x < bx + 24; x++) {
        const u = (x - bx) / 24, v = (y - 38) / 22;
        const edge = Math.min(u, v, 1 - u, 1 - v);
        const g = fbmXY(x, y, 3, 22, 871, 3, 0.55);
        let c = mixC([62, 42, 24], [116, 86, 54], 0.3 + g * 0.7);
        if (edge < 0.05) c = scaleC(c, u < 0.5 && v < 0.5 ? 0.55 : 1.3);
        else if (edge < 0.13) c = scaleC(c, 0.85);
        p.setArr(x, y, c);
      }
    }
    frameRect(p, bx - 1, 37, 26, 24, railLt);
    frameRect(p, bx - 2, 36, 28, 26, scaleC(railDk, 0.8));
  }
  grit(p, 70, 869);
  return p;
}

// ===========================================================================
// ROOFS
// ===========================================================================

/**
 * Overlapping shingle courses. Rows are painted bottom-up so the upper course
 * laps the one below, and each course drops a shadow on its neighbour.
 */
function shingleRoof(o) {
  const {
    rows = 6, cols = 5, seed, colDk, colMd, colLt, scallop = 3, square = false,
    shadow = 0.42, overlap = 3, edgeDark = 0.45,
  } = o;
  const p = P();
  p.fill(colDk[0] * 0.6, colDk[1] * 0.6, colDk[2] * 0.6);
  const rh = 64 / rows, sw = 64 / cols;
  for (let r = rows - 1; r >= 0; r--) {
    const rowOff = ((r % 2) * 0.5 + hash2(r, 0, seed + 3) * 0.15) * sw;
    for (let c = -1; c < cols; c++) {
      const tone = hash2(wrapI(c, cols), r, seed);
      const warm = hash2(wrapI(c, cols), r, seed + 11);
      const base = mixC(colDk, colLt, 0.2 + tone * 0.75);
      const x0 = c * sw + rowOff;
      const y0 = r * rh - overlap;
      for (let yy = 0; yy < rh + overlap; yy++) {
        for (let xx = 0; xx < sw; xx++) {
          const u = xx / sw;
          const bot = square
            ? rh + overlap
            : rh + overlap - scallop * (2 * u - 1) * (2 * u - 1);
          if (yy > bot) continue;
          if (xx < 0.8) continue; // gap between neighbouring shingles
          const e = clamp01((yy - overlap) / rh);
          // shadow under the lapping course at the top, light down the face,
          // then a dark line right at the exposed edge
          let k = 0.66 + e * 0.5;
          if (e > 0.88) k *= 1 - edgeDark * ((e - 0.88) / 0.12);
          if (u > 0.86) k *= 0.86;
          if (u < 0.14) k *= 1.1;
          const g = fbmXY(wrapI(x0 + xx, 64), wrapI(y0 + yy, 64), 26, 26, seed + 7, 3, 0.55);
          let col = mixC(base, colMd, g * 0.45);
          col = scaleC(col, k * (0.94 + warm * 0.12));
          p.setArr(Math.round(x0 + xx), Math.round(y0 + yy), col);
        }
      }
      // cast shadow onto the course below
      for (let xx = 0; xx < sw; xx++) {
        const u = xx / sw;
        const bot = square ? rh + overlap : rh + overlap - scallop * (2 * u - 1) * (2 * u - 1);
        for (let s = 0; s < 2; s++) {
          const yy = Math.round(bot) + s;
          blend(p, Math.round(x0 + xx), Math.round(y0 + yy), [18, 14, 12], shadow * (s === 0 ? 1 : 0.45));
        }
      }
    }
  }
  return p;
}

const tRoofShingleRed = () => {
  const p = shingleRoof({
    rows: 6, cols: 5, seed: 901, colDk: [96, 42, 24], colMd: [162, 74, 38], colLt: [206, 112, 58],
    scallop: 3.2, shadow: 0.5,
  });
  blotch(p, { period: 3, seed: 903, amount: 0.2 });
  grit(p, 90, 907);
  return p;
};
const tRoofShingleGrey = () => {
  const p = shingleRoof({
    rows: 6, cols: 5, seed: 911, colDk: [52, 54, 56], colMd: [96, 98, 100], colLt: [148, 150, 152],
    scallop: 3.2, shadow: 0.45,
  });
  blotch(p, { period: 3, seed: 913, amount: 0.24, color: [70, 82, 56] });
  grit(p, 90, 917);
  return p;
};
const tRoofSlate = () => {
  const p = shingleRoof({
    rows: 8, cols: 4, seed: 919, colDk: [40, 46, 58], colMd: [68, 76, 92], colLt: [112, 122, 140],
    square: true, shadow: 0.5, overlap: 2, edgeDark: 0.5,
  });
  // slate cleaves in flat planes - add a faint sheen streak on some tiles
  paint(p, (x, y) => {
    const n = nzXY(x, y, 20, 8, 921);
    if (n < 0.78) return null;
    return scaleC(p.get(x, y), 1.14);
  });
  grit(p, 80, 923);
  return p;
};

/**
 * Glazed pantiles. Same overlapping-course structure as the shingles - rows
 * laid bottom-up so each course laps the one below - but every tile in the row
 * carries a barrel profile across its width.
 */
function tRoofTileBlue() {
  const p = P();
  const rows = 5, cols = 6, rh = 64 / rows, tw = 64 / cols, overlap = 3;
  const dk = [42, 58, 72], md = [66, 92, 112], lt = [110, 142, 164], hi = [150, 178, 196];
  p.fill(30, 42, 54);
  for (let r = rows - 1; r >= 0; r--) {
    const rowOff = ((r % 2) * 0.5) * tw;
    for (let c = -1; c < cols; c++) {
      const tone = 0.9 + hash2(wrapI(c, cols), r, 931) * 0.2;
      const x0 = c * tw + rowOff, y0 = r * rh - overlap;
      for (let yy = 0; yy < rh + overlap; yy++) {
        for (let xx = 0; xx < tw; xx++) {
          const u = xx / tw;
          const e = clamp01((yy - overlap) / rh);
          // barrel across the tile: valley at the joint, crest in the middle
          const prof = Math.sin(u * Math.PI);
          let k = (0.52 + prof * 0.8) * (0.74 + e * 0.42);
          if (u < 0.09) k *= 0.6;
          if (e > 0.9) k *= 0.82;
          const gx = wrapI(Math.round(x0 + xx), 64), gy = wrapI(Math.round(y0 + yy), 64);
          let col = mixC(dk, mixC(md, lt, prof), 0.35 + prof * 0.5);
          col = scaleC(col, k * tone * (0.94 + fbmXY(gx, gy, 22, 22, 933, 3, 0.55) * 0.12));
          // glaze catches the sky along the crest
          if (prof > 0.9 && e > 0.35) col = mixC(col, hi, 0.35);
          p.setArr(gx, gy, col);
        }
      }
      // the nose of the tile drops a shadow on the course below
      for (let xx = 0; xx < tw; xx++) {
        blend(p, Math.round(x0 + xx), Math.round(y0 + rh + overlap), [12, 20, 28], 0.6);
        blend(p, Math.round(x0 + xx), Math.round(y0 + rh + overlap + 1), [12, 20, 28], 0.3);
      }
    }
  }
  grit(p, 70, 937);
  return p;
}

function tRoofThatch() {
  const p = P();
  const rows = 4, rh = 64 / rows;
  const dk = [86, 66, 26], md = [166, 136, 56], lt = [214, 186, 106];
  p.fill(40, 30, 12);
  // bundles laid bottom-up; every strand is its own 1px fibre
  for (let r = rows - 1; r >= 0; r--) {
    const yTop = r * rh - 7;
    const xOff = Math.round(hash2(r, 0, 939) * 6);
    for (let x = -1; x < 64; x++) {
      const sx = wrapI(x + xOff, 64);
      const sTone = hash2(sx, r, 941) * 0.7 + hash2(Math.floor(sx / 3), r, 942) * 0.3;
      const wob = (nzXY(sx, r * 17, 20, 2, 943) - 0.5) * 5;
      const bot = rh + 7 + wob + Math.sin(sx * 0.7 + r) * 1.4;
      const rowTone = hash2(r, 3, 944);
      const base = scaleC(mixC(dk, mixC(md, lt, sTone), 0.45 + sTone * 0.4), 0.92 + rowTone * 0.16);
      for (let yy = 0; yy < bot; yy++) {
        const e = clamp01((yy - 7) / rh);
        // deep shade under the lap, brightening down the exposed straw
        let k = 0.42 + e * 0.85;
        if (e > 0.9) k *= 0.75;
        const fib = nzXY(sx, wrapI(yTop + yy, 64), 60, 8, 947);
        p.setArr(x, Math.round(yTop + yy), scaleC(base, k * (0.88 + fib * 0.26)));
      }
      // frayed ends poking below the bundle
      if (hash2(sx, r, 949) > 0.6) {
        const n = 1 + Math.floor(hash2(sx, r, 951) * 3);
        for (let i = 0; i < n; i++) {
          p.setArr(x, Math.round(yTop + bot + i), scaleC(base, 0.5 - i * 0.09));
        }
      }
      // shadow the bundle throws onto the course below
      for (let i = 1; i <= 3; i++) {
        blend(p, x, Math.round(yTop + bot + i), [26, 20, 8], 0.45 - i * 0.14);
      }
    }
  }
  grit(p, 100, 953);
  return p;
}

// ===========================================================================
// TRIM AND DETAILS
// ===========================================================================

function tDoorWood() {
  const p = plankWall({ seed: 967, count: 5, colDk: [42, 26, 12], colLt: [122, 86, 48], knots: 4, nails: false });
  const iron = [62, 60, 62], ironLt = [122, 122, 126], ironDk = [26, 26, 28];
  // outer frame
  for (let i = 0; i < 3; i++) {
    frameRect(p, i, i, 64 - i * 2, 64 - i * 2, i === 0 ? ironDk : mixC(iron, ironLt, i === 1 ? 0.5 : 0.1));
  }
  // iron straps with studs
  for (const y0 of [12, 44]) {
    rect(p, 3, y0, 58, 6, iron);
    for (let x = 3; x < 61; x++) {
      p.setArr(x, y0, ironLt);
      p.setArr(x, y0 + 5, ironDk);
      blend(p, x, y0 + 2, [0, 0, 0], nzXY(x, y0, 24, 2, 969) * 0.25);
    }
    for (let x = 7; x < 60; x += 9) stud(p, x, y0 + 2, [96, 94, 96], 1);
  }
  // ring handle on the right
  const hx = 50, hy = 30;
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * TAU;
    const x = Math.round(hx + Math.cos(t) * 5), y = Math.round(hy + Math.sin(t) * 5);
    p.setArr(x, y, Math.sin(t) < 0 ? ironLt : iron);
    p.setArr(x, y + 1, ironDk);
  }
  rect(p, hx - 2, hy - 9, 4, 4, mixC(iron, ironLt, 0.4));
  return p;
}

function tDoorIron() {
  const p = P();
  const dk = [30, 32, 38], md = [72, 76, 84], lt = [126, 130, 138];
  paint(p, (x, y) => {
    const plateX = Math.floor(x / 32), plateY = Math.floor(y / 32);
    const u = (x % 32) / 32, v = (y % 32) / 32;
    const g = fbmXY(x, y, 26, 6, 971, 3, 0.55);
    let c = mixC(dk, mixC(md, lt, g), 0.35 + g * 0.6);
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const k = edge < 0.06 ? (u < 0.5 && v < 0.5 ? 1.28 : 0.6) : 1;
    return scaleC(c, k * (0.94 + hash2(plateX, plateY, 973) * 0.14));
  });
  // rivets around every plate
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      for (let i = 0; i < 6; i++) {
        const a = 4 + i * 5;
        stud(p, px * 32 + a, py * 32 + 3, [140, 144, 152], 1);
        stud(p, px * 32 + a, py * 32 + 28, [140, 144, 152], 1);
        stud(p, px * 32 + 3, py * 32 + a, [140, 144, 152], 1);
        stud(p, px * 32 + 28, py * 32 + a, [140, 144, 152], 1);
      }
    }
  }
  // rust creeping out of the seams
  paint(p, (x, y) => {
    const t = smoothstep(0.6, 0.84, nz(x, y, 4, 977, 3, 0.6));
    if (t <= 0) return null;
    return mixC(p.get(x, y), [124, 66, 32], t * 0.55);
  });
  grit(p, 90, 979);
  return p;
}

function tDoorDungeon() {
  const p = plankWall({ seed: 983, count: 4, colDk: [26, 18, 10], colLt: [82, 58, 32], knots: 3, nails: false });
  const iron = [48, 48, 52], ironLt = [96, 98, 104], ironDk = [18, 18, 20];
  // heavy cross bracing
  rect(p, 0, 26, 64, 8, iron);
  rect(p, 26, 0, 8, 64, iron);
  for (let x = 0; x < 64; x++) { p.setArr(x, 26, ironLt); p.setArr(x, 33, ironDk); }
  for (let y = 0; y < 64; y++) { p.setArr(26, y, ironLt); p.setArr(33, y, ironDk); }
  for (let i = 0; i < 7; i++) {
    stud(p, 4 + i * 9, 30, [110, 112, 118], 1);
    stud(p, 30, 4 + i * 9, [110, 112, 118], 1);
  }
  // barred grate near the top
  rect(p, 20, 6, 24, 14, [10, 10, 12]);
  frameRect(p, 20, 6, 24, 14, iron);
  for (let x = 23; x < 43; x += 4) {
    vline(p, x, 7, 18, ironLt);
    vline(p, x + 1, 7, 18, [40, 40, 44]);
  }
  blotch(p, { period: 3, seed: 987, amount: 0.3 });
  return p;
}

function windowTex(lit) {
  const p = P();
  const frameDk = [40, 28, 16], frameMd = [86, 62, 34], frameLt = [128, 96, 56];
  paint(p, (x, y) => {
    const g = fbmXY(x, y, 20, 6, 991, 3, 0.55);
    return mixC(frameDk, mixC(frameMd, frameLt, g), 0.3 + g * 0.7);
  });
  // recessed opening
  const x0 = 6, y0 = 6, w = 52, h = 52;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const u = (x - x0) / w, v = (y - y0) / h;
      let c;
      if (lit) {
        // warm glow, brightest at the centre with a hot core
        const d = Math.sqrt((u - 0.5) ** 2 + (v - 0.55) ** 2);
        c = mixC([246, 214, 120], [176, 116, 34], clamp01(d * 1.7));
        c = mixC(c, [255, 244, 196], clamp01(1 - d * 3) * 0.7);
        c = scaleC(c, 0.9 + nzXY(x, y, 12, 12, 993) * 0.2);
      } else {
        c = mixC([26, 34, 46], [60, 78, 96], clamp01(v * 0.7 + nzXY(x, y, 10, 10, 995) * 0.4));
        // sky reflection sliding across the glass
        const refl = clamp01(1 - Math.abs((u + v) - 0.75) * 4);
        c = mixC(c, [148, 172, 190], refl * 0.55);
      }
      p.setArr(x, y, c);
    }
  }
  // mullions
  const mull = lit ? [58, 38, 18] : [48, 34, 18];
  rect(p, 30, y0, 4, h, mull);
  rect(p, x0, 30, w, 4, mull);
  for (let x = x0; x < x0 + w; x++) { p.setArr(x, 30, scaleC(mull, 1.6)); p.setArr(x, 33, scaleC(mull, 0.6)); }
  for (let y = y0; y < y0 + h; y++) { p.setArr(30, y, scaleC(mull, 1.6)); p.setArr(33, y, scaleC(mull, 0.6)); }
  // frame relief
  frameRect(p, x0 - 1, y0 - 1, w + 2, h + 2, [26, 18, 10]);
  frameRect(p, 1, 1, 62, 62, scaleC(frameLt, 1.15));
  frameRect(p, 0, 0, 64, 64, [30, 22, 12]);
  if (lit) {
    // spill of light onto the frame
    paint(p, (x, y) => {
      const inside = x >= x0 - 1 && x < x0 + w + 1 && y >= y0 - 1 && y < y0 + h + 1;
      if (inside) return null;
      const d = Math.max(0, 1 - Math.min(
        Math.abs(x - (x0 - 1)), Math.abs(x - (x0 + w)), Math.abs(y - (y0 - 1)), Math.abs(y - (y0 + h)),
      ) / 5);
      if (d <= 0) return null;
      return mixC(p.get(x, y), [210, 168, 90], d * 0.45);
    });
  }
  return p;
}

function tShutters() {
  const p = P();
  const paintDk = [36, 52, 62], paintMd = [70, 100, 112], paintLt = [116, 150, 158];
  paint(p, (x, y) => {
    const g = fbmXY(x, y, 3, 24, 997, 3, 0.55);
    return mixC(paintDk, mixC(paintMd, paintLt, g), 0.3 + g * 0.65);
  });
  // two leaves, each with a frame and eight louvres
  for (const x0 of [0, 32]) {
    frameRect(p, x0 + 1, 1, 30, 62, scaleC(paintLt, 1.15));
    frameRect(p, x0 + 2, 2, 28, 60, scaleC(paintDk, 0.9));
    rect(p, x0 + 3, 3, 26, 58, mixC(paintDk, paintMd, 0.4));
    for (let i = 0; i < 8; i++) {
      const y = 4 + i * 7;
      for (let x = x0 + 3; x < x0 + 29; x++) {
        const g = nzXY(x, y, 24, 8, 999);
        p.setArr(x, y, scaleC(mixC(paintMd, paintLt, g), 1.25));
        p.setArr(x, y + 1, mixC(paintMd, paintLt, g * 0.6));
        p.setArr(x, y + 2, mixC(paintMd, paintLt, g * 0.3));
        p.setArr(x, y + 3, scaleC(paintDk, 1.1));
        p.setArr(x, y + 4, scaleC(paintDk, 0.72));
      }
    }
    // stile shadow
    vline(p, x0 + 30, 1, 62, scaleC(paintDk, 0.62));
  }
  // hinges
  for (const y of [8, 52]) {
    rect(p, 0, y, 7, 5, [62, 60, 58]);
    rect(p, 57, y, 7, 5, [62, 60, 58]);
    stud(p, 3, y + 2, [120, 118, 116], 1);
    stud(p, 60, y + 2, [120, 118, 116], 1);
  }
  grit(p, 60, 1009);
  return p;
}

function tFenceWood() {
  const p = P();
  // gaps are transparent but still painted dark, so the texture works either
  // as a cut-out plane or as a solid board
  const dk = [38, 26, 14], lt = [128, 94, 54];
  const pickets = 5, pw = 64 / pickets;
  paint(p, (x, y) => {
    const u = wrapI(x, pw) / pw;
    if (u > 0.72) return [16, 14, 12, 0];
    const g = fbmXY(x, y, 3, 26, 1013 + Math.floor(x / pw) * 7, 4, 0.55);
    let c = mixC(dk, lt, clamp01(0.2 + g * 0.95));
    const k = u < 0.06 ? 1.2 : u > 0.62 ? 0.62 : 1;
    return scaleC(c, k);
  });
  // two rails behind the pickets fill the gaps
  for (const y0 of [14, 42]) {
    for (let y = y0; y < y0 + 7; y++) {
      for (let x = 0; x < 64; x++) {
        const g = fbmXY(x, y, 26, 3, 1017, 3, 0.55);
        const v = (y - y0) / 7;
        const k = v < 0.16 ? 1.18 : v > 0.8 ? 0.6 : 1;
        const cur = p.get(x, y);
        const behind = cur[3] === 0;
        const c = scaleC(mixC(dk, lt, clamp01(0.15 + g * 0.8)), k * (behind ? 0.72 : 1));
        if (behind) p.setArr(x, y, c, 255);
      }
    }
  }
  // nails where picket meets rail
  for (let i = 0; i < pickets; i++) {
    for (const y of [17, 45]) stud(p, Math.round(i * pw + pw * 0.35), y, [82, 78, 74], 1);
  }
  return p;
}

function tSignBoard() {
  const p = P();
  const dk = [46, 30, 16], lt = [138, 100, 58];
  paint(p, (x, y) => {
    const g = fbmXY(x, y, 26, 4, 1019, 4, 0.55);
    let c = mixC(dk, lt, clamp01(0.22 + g * 0.9));
    // plank seams running across the board
    const seam = wrapI(y, 21);
    if (seam < 1) c = scaleC(c, 0.55);
    else if (seam < 2) c = scaleC(c, 1.15);
    return c;
  });
  const rnd = new Rand(1021);
  for (let i = 0; i < 3; i++) knot(p, rnd.int(64), rnd.int(64), rnd.float(1.6, 2.6), [40, 26, 14], [146, 108, 64]);
  // iron border and corner brackets
  const iron = [58, 56, 58];
  frameRect(p, 0, 0, 64, 64, [22, 22, 24]);
  frameRect(p, 1, 1, 62, 62, iron);
  frameRect(p, 2, 2, 60, 60, scaleC(iron, 1.5));
  for (const [cx, cy] of [[5, 5], [58, 5], [5, 58], [58, 58]]) stud(p, cx, cy, [120, 118, 118], 1);
  // painted emblem: a foaming tankard, the universal MM6 shop sign
  const g1 = [206, 168, 58], g2 = [246, 226, 140], w1 = [230, 230, 216], w2 = [252, 252, 244];
  const outline = [44, 30, 12];
  const bodyL = 20, bodyR = 40, bodyT = 26, bodyB = 50;
  // handle first, so the body overlaps it cleanly
  for (let a = -70; a <= 70; a += 3) {
    const t = (a / 180) * Math.PI;
    const hx = Math.round(bodyR - 2 + Math.cos(t) * 9), hy = Math.round(38 + Math.sin(t) * 9);
    for (let k = 0; k < 3; k++) p.setArr(hx + k, hy, k === 0 ? g2 : g1);
    p.setArr(hx - 1, hy, outline); p.setArr(hx + 3, hy, outline);
  }
  for (let y = bodyT; y < bodyB; y++) {
    for (let x = bodyL; x < bodyR; x++) {
      const u = (x - bodyL) / (bodyR - bodyL);
      const edge = x < bodyL + 1 || x >= bodyR - 1 || y >= bodyB - 1;
      p.setArr(x, y, edge ? outline : mixC(g1, g2, clamp01(1.1 - u * 2.2)));
    }
  }
  // banded staves and a head of foam
  for (const y of [32, 44]) for (let x = bodyL + 1; x < bodyR - 1; x++) p.setArr(x, y, scaleC(g1, 0.72));
  for (let x = bodyL - 1; x < bodyR + 1; x++) {
    const h = 4 + Math.round(Math.sin(x * 0.9) * 1.6);
    for (let y = bodyT - h; y < bodyT + 2; y++) {
      p.setArr(x, y, y < bodyT - h + 2 ? w2 : w1);
    }
    p.setArr(x, bodyT - h - 1, outline);
  }
  blotch(p, { period: 3, seed: 1031, amount: 0.24 });
  return p;
}

function tWallBanner() {
  const p = P();
  const dk = [72, 12, 16], md = [138, 26, 28], lt = [188, 48, 44];
  paint(p, (x, y) => {
    // vertical cloth folds
    const fold = Math.sin(TAU * x / 16 + nzXY(x, y, 3, 6, 1033) * 2.2);
    const g = fbmXY(x, y, 6, 20, 1037, 3, 0.55);
    let c = mixC(dk, mixC(md, lt, g), 0.4 + g * 0.5);
    return scaleC(c, 1 + fold * 0.24);
  });
  // gold trim bands top and bottom, with a fringe
  const gold = [180, 146, 44], goldLt = [246, 220, 128];
  for (let x = 0; x < 64; x++) {
    for (let i = 0; i < 3; i++) {
      p.setArr(x, 2 + i, i === 0 ? goldLt : gold);
      p.setArr(x, 58 + i, i === 2 ? scaleC(gold, 0.6) : gold);
    }
    if (wrapI(x, 4) < 2) { p.setArr(x, 61, goldLt); p.setArr(x, 62, gold); p.setArr(x, 63, scaleC(gold, 0.6)); }
  }
  // emblem: a heraldic star
  const em = [
    '    g    ',
    '   ggg   ',
    'gggggggg ',
    ' gggggg  ',
    '  gggg   ',
    ' gg  gg  ',
    'gg    gg ',
  ];
  stamp(p, 28, 26, em, { g: goldLt });
  stamp(p, 27, 25, em, { g: gold });
  return p;
}

function tBarrelSide() {
  const p = P();
  const dk = [46, 30, 14], md = [104, 72, 38], lt = [156, 116, 68];
  const staves = 8, sw = 64 / staves;
  paint(p, (x, y) => {
    const si = Math.floor(x / sw);
    const u = (x - si * sw) / sw;
    // barrel curvature across the whole tile, light from the upper left
    const cyl = Math.sin(Math.PI * clamp01((x + 12) / 76));
    const g = fbmXY(x, y, 3, 26, 1039 + si * 5, 4, 0.55);
    let c = mixC(dk, mixC(md, lt, g), 0.3 + g * 0.65);
    let k = 0.45 + cyl * 0.95;
    if (u < 0.07) k *= 0.55;
    else if (u < 0.2) k *= 1.12;
    // staves bulge in the middle of the barrel
    k *= 0.92 + Math.sin(Math.PI * (y / 64)) * 0.16;
    return scaleC(c, k * (0.9 + hash2(si, 0, 1041) * 0.2));
  });
  // iron hoops
  const iron = [66, 62, 58];
  for (const [y0, hh] of [[2, 5], [28, 6], [57, 5]]) {
    for (let y = y0; y < y0 + hh; y++) {
      for (let x = 0; x < 64; x++) {
        const cyl = Math.sin(Math.PI * clamp01((x + 12) / 76));
        const v = (y - y0) / hh;
        const k = (0.4 + cyl * 1.0) * (v < 0.2 ? 1.5 : v > 0.75 ? 0.55 : 1);
        p.setArr(x, y, scaleC(mixC(iron, [136, 132, 126], nzXY(x, y, 24, 2, 1043)), k));
      }
    }
  }
  return p;
}

function tCrateSide() {
  const p = P();
  const dk = [58, 40, 20], md = [120, 88, 48], lt = [166, 128, 76];
  paint(p, (x, y) => {
    const g = fbmXY(x, y, 26, 4, 1049, 4, 0.55);
    const seam = wrapI(y, 16);
    let c = mixC(dk, mixC(md, lt, g), 0.28 + g * 0.7);
    if (seam < 1) c = scaleC(c, 0.5);
    else if (seam < 2) c = scaleC(c, 1.18);
    return c;
  });
  // frame rails, diagonal brace, then nails
  const frameCol = (x, y) => {
    const g = fbmXY(x, y, 20, 6, 1051, 3, 0.55);
    return mixC([70, 48, 24], [150, 112, 66], 0.25 + g * 0.8);
  };
  const drawBoard = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const u = (x - x0) / w, v = (y - y0) / h;
        const e = Math.min(u, v, 1 - u, 1 - v);
        const k = e < 0.1 ? (u < 0.5 && v < 0.5 ? 1.22 : 0.62) : 1;
        p.setArr(x, y, scaleC(frameCol(x, y), k));
      }
    }
  };
  drawBoard(0, 0, 64, 8); drawBoard(0, 56, 64, 8);
  drawBoard(0, 0, 8, 64); drawBoard(56, 0, 8, 64);
  for (let s = 0; s <= 80; s++) {
    const t = s / 80;
    const x = 6 + t * 52, y = 57 - t * 50;
    for (let k = -3; k <= 3; k++) {
      const kk = Math.abs(k) === 3 ? (k < 0 ? 1.2 : 0.62) : 1;
      p.setArr(Math.round(x + k), Math.round(y), scaleC(frameCol(Math.round(x + k), Math.round(y)), kk));
    }
  }
  for (const [x, y] of [[4, 4], [59, 4], [4, 59], [59, 59], [32, 4], [32, 59], [4, 32], [59, 32]]) {
    stud(p, x, y, [88, 84, 80], 1);
  }
  grit(p, 70, 1061);
  return p;
}

// ===========================================================================
// DUNGEON
// ===========================================================================

function dunBrickTex(o) {
  const { seed, colA, colB, mortar, damp = 0.35, moss = 0, rows = 5 } = o;
  const p = P();
  courseWall(p, {
    rows, cols: 2, seed, mortarW: 2, off: 0.5, colA, colB, mortar,
    bevel: 0.28, chip: 0.45, grain: 0.18, grainPerX: 18, grainPerY: 12,
  });
  weatherStreaks(p, { seed: seed + 31, rows, amount: damp, col: [24, 30, 30] });
  if (moss > 0) {
    // moss takes hold in the mortar joints first
    const bh = 64 / rows, bw = 32;
    paint(p, (x, y) => {
      const row = Math.floor(y / bh);
      const rowOff = ((row * 0.5) % 1) * bw;
      const bx = wrapI(x + rowOff, 64);
      const joint = Math.min(wrapI(y, bh), wrapI(bx, bw)) < 4 ? 1 : 0.25;
      const t = smoothstep(0.5, 0.72, nz(x, y, 4, seed + 37, 3, 0.6)) * joint;
      if (t <= 0) return null;
      return mixC(p.get(x, y), mixC([34, 56, 28], [88, 116, 46], nz1(x, y, 20, seed + 41)), clamp01(t * moss));
    });
  }
  grit(p, 110, seed + 43);
  return p;
}

const tDunBrick = () => dunBrickTex({
  seed: 1103, colA: [58, 70, 62], colB: [124, 138, 126], mortar: [70, 78, 72], damp: 0.4, moss: 0.25,
});
const tDunBrickMossy = () => dunBrickTex({
  seed: 1109, colA: [46, 58, 48], colB: [104, 118, 104], mortar: [58, 66, 58], damp: 0.5, moss: 0.75,
});

function caveTex(o) {
  const { seed, colDk, colLt, contrast = 1, lumps = 26, tint = null, tintAmt = 0 } = o;
  const p = P();
  // Irregular hewn rock: a few big cell masses carry the shape, a second
  // finer set breaks their surface, and the crevices between them go black.
  // No grid anywhere - the cell jitter is full strength at both scales.
  const S = 64;
  const H = new Float32Array(S * S);
  const T = new Float32Array(S * S);
  const E = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = (x / S) * 3 + (nz(x, y, 3, seed + 41, 2, 0.5) - 0.5) * 1.1;
      const wy = (y / S) * 3 + (nz(x, y, 3, seed + 43, 2, 0.5) - 0.5) * 1.1;
      const a = worley(wx, wy, 3, seed, 1.0);
      const b = worley((x / S) * 7 + 0.3, (y / S) * 7, 7, seed + 5, 1.0);
      const n = nz(x, y, 9, seed + 9, 4, 0.5);
      const i = y * S + x;
      // Some masses stand proud, some are hollows. If every cell domed the
      // same way the wall would read as fish scales.
      const bulge = hash2(a.gx, a.gy, seed + 47) > 0.34 ? 1 : -0.7;
      const bulge2 = hash2(b.gx, b.gy, seed + 53) > 0.4 ? 0.35 : -0.25;
      H[i] = (1 - a.f1) * bulge + (1 - b.f1) * bulge2 + n * 0.5;
      T[i] = hash2(a.gx, a.gy, seed + 13) * 0.7 + hash2(b.gx, b.gy, seed + 59) * 0.3;
      E[i] = Math.min(a.f2 - a.f1, (b.f2 - b.f1) * 2.2);
    }
  }
  paint(p, (x, y) => {
    const i = y * S + x;
    const hl = H[y * S + wrapI(x - 1, S)], hr = H[y * S + wrapI(x + 1, S)];
    const hu = H[wrapI(y - 1, S) * S + x], hd = H[wrapI(y + 1, S) * S + x];
    const k = 1 + ((hl - hr) + (hu - hd)) * 2.4 * contrast;
    let c = mixC(colDk, colLt, clamp01(0.16 + T[i] * 0.55 + (H[i] - 0.5) * 0.4));
    c = scaleC(c, clamp(k, 0.5, 1.65));
    // shadow gathers in the crevice between masses
    c = scaleC(c, 0.64 + smoothstep(0.0, 0.3, E[i]) * 0.36);
    if (tint) c = mixC(c, tint, smoothstep(0.5, 0.8, nz(x, y, 4, seed + 17, 3, 0.6)) * tintAmt);
    return c;
  });
  // knocked-off flakes and a few boulders sitting proud of the face
  const rnd = new Rand(seed + 19);
  for (let i = 0; i < lumps; i++) {
    const cx = rnd.int(S), cy = rnd.int(S), r = rnd.float(2.2, 5);
    const up = rnd.bool();
    blob(p, cx, cy, r, r * rnd.float(0.6, 1), (x, y, d, dx, dy) => {
      if (d > 0.75 + nz1(x, y, 20, seed + 23) * 0.4) return null;
      const kk = up ? 1 - (dx + dy) * 0.09 : 0.9 + (dx + dy) * 0.06;
      return scaleC(p.get(x, y), clamp(kk, 0.6, 1.45));
    });
  }
  cracks(p, { period: 5, seed: seed + 29, width: 0.05, darkness: 0.4 });
  grit(p, 90, seed + 31);
  return p;
}

const tDunCave = () => caveTex({ seed: 1117, colDk: [48, 48, 46], colLt: [132, 130, 122], contrast: 0.85 });
const tDunCaveDark = () => caveTex({ seed: 1123, colDk: [28, 30, 34], colLt: [92, 94, 98], contrast: 0.95, tint: [34, 44, 52], tintAmt: 0.35 });

function tDunMetal() {
  const p = P();
  const dk = [30, 32, 38], md = [74, 78, 86], lt = [132, 136, 144];
  const PW = 32, PH = 32;
  paint(p, (x, y) => {
    const px = Math.floor(x / PW), py = Math.floor(y / PH);
    const u = (x % PW) / PW, v = (y % PH) / PH;
    // brushed finish: fine streaks running along the plate
    const g = fbmXY(x, y, 4, 30, 1129, 3, 0.55);
    let c = mixC(dk, mixC(md, lt, g), 0.32 + g * 0.6);
    c = scaleC(c, 0.92 + hash2(px, py, 1131) * 0.16);
    // plates are bolted over each other: dark seam, then a lit top-left lip
    const e = Math.min(u, v, 1 - u, 1 - v);
    if (e < 0.032) return scaleC(c, 0.34);
    const k = e < 0.09 ? (u < 0.5 && v < 0.5 ? 1.38 : 0.7) : 1;
    // gentle barrel across the plate so it does not read flat
    return scaleC(c, k * (0.94 + Math.sin(u * Math.PI) * 0.12));
  });
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      for (let i = 0; i < 5; i++) {
        const a = 5 + i * 6;
        stud(p, px * PW + a, py * PH + 4, [154, 158, 166], 1);
        stud(p, px * PW + a, py * PH + 27, [154, 158, 166], 1);
        stud(p, px * PW + 4, py * PH + a, [154, 158, 166], 1);
        stud(p, px * PW + 27, py * PH + a, [154, 158, 166], 1);
      }
    }
  }
  // rust blooms around the seams and bleeds downward
  paint(p, (x, y) => {
    const bloom = smoothstep(0.55, 0.78, nz(x, y, 4, 1133, 3, 0.6));
    const run = smoothstep(0.6, 0.85, fbmXY(x, y, 20, 3, 1137, 3, 0.6));
    const t = clamp01(bloom * 0.8 + run * 0.5);
    if (t <= 0) return null;
    return mixC(p.get(x, y), mixC([98, 50, 24], [150, 84, 38], nz1(x, y, 20, 1141)), t * 0.6);
  });
  grit(p, 90, 1139);
  return p;
}

function tDunSewer() {
  const p = P();
  courseWall(p, {
    rows: 7, cols: 3, seed: 1151, mortarW: 1, off: 0.5,
    colA: [56, 56, 50], colB: [116, 116, 104], mortar: [66, 68, 58],
    bevel: 0.24, chip: 0.4, grain: 0.18,
  });
  // slime running down the wall in narrow trails, not a blanket of green
  paint(p, (x, y) => {
    const t = smoothstep(0.62, 0.86, fbmXY(x, y, 14, 3, 1153, 4, 0.6));
    if (t <= 0) return null;
    const slime = mixC([32, 52, 26], [78, 106, 38], nzXY(x, y, 16, 6, 1157));
    return mixC(p.get(x, y), slime, t * 0.75);
  });
  // black grime pooling in the joints
  paint(p, (x, y) => {
    const t = smoothstep(0.5, 0.78, nz(x, y, 4, 1159, 3, 0.6));
    if (t <= 0) return null;
    return mixC(p.get(x, y), [24, 26, 22], t * 0.45);
  });
  // wet sheen highlights
  paint(p, (x, y) => {
    const t = smoothstep(0.76, 0.9, nzXY(x, y, 8, 20, 1163));
    if (t <= 0) return null;
    return mixC(p.get(x, y), [142, 164, 140], t * 0.35);
  });
  grit(p, 120, 1171);
  return p;
}

function tDunTomb() {
  const p = P();
  courseWall(p, {
    rows: 4, cols: 2, seed: 1181, mortarW: 2, off: 0.5,
    colA: [128, 116, 92], colB: [196, 184, 156], mortar: [104, 96, 78],
    bevel: 0.24, chip: 0.3, grain: 0.14,
  });
  // carved funerary glyphs on some blocks
  const glyphs = [
    ['  ggg  ', ' g   g ', 'g  g  g', 'g ggg g', 'g  g  g', ' g   g ', '  ggg  '],
    ['ggggggg', '   g   ', '   g   ', ' ggggg ', '   g   ', '   g   ', 'ggggggg'],
    [' g   g ', ' ggggg ', 'g g g g', 'g ggg g', ' g   g ', '  g g  ', ' g   g '],
    ['  ggg  ', ' gg gg ', 'g g g g', 'g  g  g', 'g g g g', ' gg gg ', '  ggg  '],
  ];
  const bh = 16, bw = 32;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      if (hash2(c, r, 1187) < 0.45) continue;
      const gi = Math.floor(hash2(c, r, 1189) * glyphs.length);
      const rowOff = ((r * 0.5) % 1) * bw;
      const gx = Math.round(c * bw - rowOff + 12), gy = r * bh + 4;
      const g = glyphs[gi];
      for (let j = 0; j < g.length; j++) {
        for (let i = 0; i < g[j].length; i++) {
          if (g[j][i] !== 'g') continue;
          // incised: dark groove with a lit lower-right lip
          blend(p, gx + i, gy + j, [58, 50, 38], 0.75);
          blend(p, gx + i + 1, gy + j + 1, [226, 216, 190], 0.3);
        }
      }
    }
  }
  cracks(p, { period: 5, seed: 1193, width: 0.05, darkness: 0.4 });
  blotch(p, { period: 3, seed: 1201, amount: 0.26 });
  return p;
}

function tDunIce() {
  const p = P();
  paint(p, (x, y) => {
    const n = fbmXY(x, y, 7, 7, 1213, 4, 0.55);
    const deep = fbmXY(x, y, 3, 3, 1217, 3, 0.6);
    // deep glacial blue where the ice is thick, near-white where it is thin
    return mixC([64, 124, 148], [178, 216, 230], clamp01((n * 0.4 + deep * 0.6 - 0.32) * 1.15));
  });
  // internal fracture planes: straight bright shards
  const rnd = new Rand(1223);
  for (let i = 0; i < 7; i++) {
    let x = rnd.float(64), y = rnd.float(64);
    const a = rnd.float(TAU);
    const len = rnd.int(20, 46);
    const bright = rnd.bool(0.6);
    for (let s = 0; s < len; s++) {
      x += Math.cos(a); y += Math.sin(a);
      // fracture planes fade out towards their ends
      const f = Math.sin((s / len) * Math.PI);
      const c = bright ? [214, 240, 248] : [40, 82, 104];
      blend(p, Math.round(x), Math.round(y), c, 0.45 * f);
      blend(p, Math.round(x + Math.sin(a)), Math.round(y - Math.cos(a)), c, 0.16 * f);
    }
  }
  // trapped bubbles
  for (let i = 0; i < 40; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(0.8, 2);
    blob(p, cx, cy, r, r, (x, y, d) => {
      if (d > 1) return null;
      return mixC(p.get(x, y), d < 0.5 ? [232, 250, 252] : [60, 118, 140], 0.55);
    });
  }
  // polished sheen
  paint(p, (x, y) => {
    const s = smoothstep(0.6, 0.9, nzXY(x, y, 4, 12, 1229));
    if (s <= 0) return null;
    return mixC(p.get(x, y), [236, 250, 252], s * 0.35);
  });
  return p;
}

function tDunLavaRock() {
  const p = P();
  paint(p, (x, y) => {
    const c = worley((x / 64) * 5, (y / 64) * 5, 5, 1231, 1.0);
    const n = nz(x, y, 14, 1237, 4, 0.55);
    const edge = c.f2 - c.f1;
    // black crust plates, dull heat only in the hairline seams between them
    let col = mixC([16, 14, 14], [58, 50, 46], clamp01(0.2 + n * 0.85 - c.f1 * 0.35));
    const seam = 0.35 + nz(x, y, 3, 1233, 2, 0.5) * 1.0;
    const glow = Math.pow(1 - smoothstep(0.0, 0.13, edge), 1.3) * seam;
    if (glow > 0) {
      const hot = mixC([106, 32, 6], [198, 106, 16], clamp01(glow * 1.5 - 0.5));
      col = mixC(col, hot, clamp01(glow * 0.85));
    }
    return col;
  });
  cracks(p, { period: 9, seed: 1241, width: 0.05, darkness: 0.5 });
  grit(p, 120, 1249);
  return p;
}

function tDunTemple() {
  const p = P();
  courseWall(p, {
    rows: 3, cols: 2, seed: 1259, mortarW: 2, off: 0.5,
    colA: [38, 42, 54], colB: [92, 98, 116], mortar: [30, 32, 42],
    bevel: 0.3, chip: 0.15, grain: 0.12,
  });
  // gold inlay: a greek key band and corner bosses
  const gold = [176, 142, 40], goldHi = [244, 214, 110], shade = [24, 24, 30];
  const key = [
    'gggggggg',
    'g......g',
    'g.gggg.g',
    'g.g....g',
    'g.g.gggg',
    'g.g.....',
    'g.gggggg',
    'g.......',
  ];
  for (let bx = 0; bx < 64; bx += 8) {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        if (key[j][i] !== 'g') continue;
        const x = bx + i, y = 28 + j;
        p.setArr(x, y, mixC(gold, goldHi, hash2(x, y, 1277)));
        blend(p, x + 1, y + 1, shade, 0.5);
      }
    }
  }
  for (const [cx, cy] of [[8, 8], [40, 8], [24, 52], [56, 52]]) {
    blob(p, cx, cy, 3, 3, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return mixC(gold, goldHi, clamp01(1 - (dx + dy) * 0.3 - d));
    });
  }
  weatherStreaks(p, { seed: 1279, rows: 3, amount: 0.22, col: [16, 18, 24] });
  return p;
}

function tDunWood() {
  const p = plankWall({ seed: 1283, count: 5, colDk: [26, 18, 10], colLt: [92, 66, 38], knots: 5, nails: false });
  // iron straps top and bottom with square nails
  const iron = [46, 46, 50];
  for (const y0 of [6, 46]) {
    rect(p, 0, y0, 64, 6, iron);
    for (let x = 0; x < 64; x++) {
      p.setArr(x, y0, scaleC(iron, 1.8));
      p.setArr(x, y0 + 5, scaleC(iron, 0.5));
      blend(p, x, y0 + 3, [0, 0, 0], nzXY(x, y0, 26, 2, 1289) * 0.3);
    }
    for (let x = 5; x < 64; x += 11) stud(p, x, y0 + 2, [104, 102, 100], 1);
  }
  blotch(p, { period: 3, seed: 1291, amount: 0.3 });
  return p;
}

function tDunFloorStone() {
  const p = P();
  // big flagstones, worn hollow in the middle where feet have passed
  courseWall(p, {
    rows: 2, cols: 2, seed: 1297, mortarW: 2, off: 0.25,
    colA: [72, 74, 72], colB: [148, 150, 146], mortar: [48, 48, 46],
    bevel: 0.18, chip: 0.5, grain: 0.16, grainPerX: 14, grainPerY: 14,
  });
  paint(p, (x, y) => {
    const row = Math.floor(y / 32);
    const bx = wrapI(x + ((row * 0.25) % 1) * 32, 64);
    const u = (bx % 32) / 32, v = (y % 32) / 32;
    const d = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2;
    const wear = 1 - smoothstep(0.2, 1.0, d);
    return scaleC(p.get(x, y), 1 - wear * 0.14 + 0.03);
  });
  cracks(p, { period: 6, seed: 1301, width: 0.045, darkness: 0.4 });
  grit(p, 200, 1303);
  return p;
}

function tDunFloorDirt() {
  const p = P();
  groundBase(p, [40, 33, 24], [94, 78, 56], { per: 9, seed: 1307, contrast: 1.35, patchCol: [58, 48, 34], patchAmt: 0.45 });
  const rnd = new Rand(1309);
  // trodden pebbles and scuffs
  for (let i = 0; i < 80; i++) {
    const cx = rnd.int(64), cy = rnd.int(64), r = rnd.float(1.1, 2.6);
    const base = mixC([76, 72, 66], [148, 142, 130], rnd.float());
    blob(p, cx, cy, r, r * 0.8, (x, y, d, dx, dy) => {
      if (d > 1) return null;
      return scaleC(base, clamp(1 - (dx + dy) * 0.16 - d * 0.2, 0.5, 1.4));
    });
  }
  for (let i = 0; i < 22; i++) {
    const cx = rnd.int(64), cy = rnd.int(64);
    blob(p, cx, cy, rnd.float(2.5, 5), rnd.float(1.5, 3), (x, y, d) => {
      if (d > 1) return null;
      return scaleC(p.get(x, y), 0.84);
    });
  }
  grit(p, 200, 1319);
  return p;
}

function tDunFloorTile() {
  const p = P();
  const tw = 16;
  paint(p, (x, y) => {
    const tx = Math.floor(x / tw), ty = Math.floor(y / tw);
    const u = (x % tw) / tw, v = (y % tw) / tw;
    const dark = (tx + ty) % 2 === 0;
    const tone = hash2(tx, ty, 1321);
    const base = dark ? mixC([44, 46, 52], [78, 82, 90], tone) : mixC([124, 122, 116], [186, 184, 176], tone);
    let c = scaleC(base, 0.92 + fbmXY(x, y, 20, 20, 1327, 3, 0.55) * 0.18);
    // grout and bevel
    const e = Math.min(u, v, 1 - u, 1 - v);
    if (e < 0.06) return mixC([56, 54, 50], [92, 90, 84], tone * 0.6);
    const k = e < 0.14 ? (u < 0.5 || v < 0.5 ? 1.14 : 0.86) : 1;
    c = scaleC(c, k);
    // inlaid diamond in the middle of each tile
    const dd = Math.abs(u - 0.5) + Math.abs(v - 0.5);
    if (dd < 0.22) {
      const inlay = dark ? [150, 148, 140] : [62, 64, 70];
      c = mixC(c, inlay, 0.85);
      if (dd > 0.17) c = scaleC(c, u + v < 1 ? 1.25 : 0.75);
    }
    return c;
  });
  cracks(p, { period: 6, seed: 1331, width: 0.035, darkness: 0.3 });
  grit(p, 140, 1333);
  return p;
}

function tDunCeilingStone() {
  const p = P();
  courseWall(p, {
    rows: 3, cols: 2, seed: 1339, mortarW: 2, off: 0.33,
    colA: [46, 48, 50], colB: [104, 106, 106], mortar: [32, 32, 34],
    bevel: 0.22, chip: 0.4, grain: 0.18, grainPerX: 12, grainPerY: 12,
  });
  // soot from torches, heaviest in the middle of each slab
  blotch(p, { period: 3, seed: 1341, amount: 0.4, color: [18, 18, 20], threshold: 0.45 });
  cracks(p, { period: 5, seed: 1343, width: 0.05, darkness: 0.45 });
  grit(p, 120, 1347);
  return p;
}

function tDunCeilingCave() {
  const p = caveTex({ seed: 1349, colDk: [30, 30, 32], colLt: [96, 92, 88], contrast: 1.15, lumps: 70 });
  // stalactite tips hanging down, drawn as little dark cones with a lit side
  const rnd = new Rand(1351);
  for (let i = 0; i < 26; i++) {
    const cx = rnd.int(64), cy = rnd.int(64);
    const len = rnd.int(3, 7), wid = rnd.float(1.2, 2.4);
    for (let j = 0; j < len; j++) {
      const w = Math.round(wid * (1 - j / len));
      for (let k = -w; k <= w; k++) {
        const t = j / len;
        const c = mixC([116, 110, 104], [26, 24, 24], clamp01(t + (k > 0 ? 0.35 : -0.1)));
        p.setArr(cx + k, cy + j, c);
      }
    }
    blend(p, cx, cy + len, [10, 10, 10], 0.6);
  }
  blotch(p, { period: 3, seed: 1353, amount: 0.35, color: [14, 14, 16] });
  return p;
}

// ===========================================================================
// LIQUIDS (animated)
// ===========================================================================

/**
 * MM6's water is a 7-frame animation group (`wtrtyl`) on a 1.000 s loop with an
 * uneven frame table - the first and last frames are half as long as the middle
 * five. The motion is a slow rolling ripple, and the palette is desaturated
 * blue-green rather than the bright blue people remember.
 */
export const WATER_FRAME_TIMES = [1 / 12, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 12];
const WATER_FRAMES = WATER_FRAME_TIMES.length;

function waterFrames(o) {
  const {
    frames = WATER_FRAMES, seed, colDeep, colMid, colLite, colSpec,
    waves = [[1, 2, 1, 1], [-2, 1, -1, 0.7], [3, 1, 2, 0.45], [1, -3, 1, 0.4]],
    spec = 0.55, warp = 6, foam = 0,
  } = o;
  const out = [];
  // Phase advances with the frame's start time, not its index, so the uneven
  // frame table still plays as constant-speed motion.
  const times = [];
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    times.push(acc);
    acc += frames === WATER_FRAMES ? WATER_FRAME_TIMES[f] : 1 / frames;
  }
  for (let f = 0; f < frames; f++) {
    const ph = (times[f] / acc) * TAU;
    const p = P();
    paint(p, (x, y) => {
      // static domain warp so the wave train is not a regular grid
      const wx = x + (nz(x, y, 4, seed, 3, 0.55) - 0.5) * warp * 2;
      const wy = y + (nz(x, y, 4, seed + 17, 3, 0.55) - 0.5) * warp * 2;
      let h = 0, n = 0;
      for (const [kx, ky, sp, a] of waves) {
        h += a * Math.sin(TAU * (kx * wx + ky * wy) / 64 + ph * sp);
        n += a;
      }
      h /= n;
      let c = mixC(colDeep, colMid, clamp01(h * 0.55 + 0.5));
      // specular crescents on the crests, the MM6 water signature
      const cr = smoothstep(spec, spec + 0.2, h);
      c = mixC(c, colLite, cr * 0.85);
      const cr2 = smoothstep(spec + 0.24, spec + 0.34, h);
      c = mixC(c, colSpec, cr2);
      if (foam > 0) {
        const fm = smoothstep(0.62, 0.8, nz(x, y, 5, seed + 31, 3, 0.6)) * cr;
        c = mixC(c, [168, 190, 196], fm * foam);
      }
      return c;
    });
    out.push(p);
  }
  return out;
}

// Spec range: #1E3A50 - #3C6E8C, crest #5A96B4.
const fWater = () => waterFrames({
  seed: 1361, colDeep: [30, 58, 80], colMid: [60, 110, 140],
  colLite: [90, 150, 180], colSpec: [130, 176, 198], spec: 0.5, foam: 0.3,
});
const fWaterDeep = () => waterFrames({
  seed: 1367, colDeep: [20, 42, 60], colMid: [40, 82, 108],
  colLite: [66, 118, 146], colSpec: [104, 152, 176], spec: 0.62, warp: 5,
  waves: [[1, 1, 1, 1], [-1, 2, -1, 0.6], [2, -1, 1, 0.35]],
});

function fSwampWater() {
  // same 7-frame table as open water so one global phase drives every fluid
  const frames = WATER_FRAMES, out = [];
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    const ph = acc * TAU; acc += WATER_FRAME_TIMES[f];
    const p = P();
    paint(p, (x, y) => {
      const wx = x + (nz(x, y, 4, 1373, 3, 0.55) - 0.5) * 8;
      const wy = y + (nz(x, y, 4, 1379, 3, 0.55) - 0.5) * 8;
      const h = 0.6 * Math.sin(TAU * (wx + 2 * wy) / 64 + ph)
        + 0.4 * Math.sin(TAU * (2 * wx - wy) / 64 - ph);
      let c = mixC([44, 56, 38], [78, 92, 56], clamp01(h * 0.5 + 0.5));
      c = mixC(c, [118, 128, 74], smoothstep(0.5, 0.8, h) * 0.6);
      // scum mats: hard-edged sheets of weed with a dark rim, drifting slowly
      const sn = nz(x + Math.cos(ph) * 4, y + Math.sin(ph) * 4, 4, 1381, 3, 0.6);
      const sc = smoothstep(0.55, 0.60, sn);
      const rim = smoothstep(0.53, 0.55, sn) * (1 - smoothstep(0.575, 0.6, sn));
      c = mixC(c, mixC([62, 78, 42], [116, 128, 74], nz1(x, y, 18, 1387)), sc * 0.8);
      c = mixC(c, [34, 42, 26], rim * 0.55);
      return c;
    });
    // bubbles that rise over the loop
    const rnd = new Rand(1391);
    for (let i = 0; i < 14; i++) {
      const bx = rnd.int(64);
      const by = wrapI(rnd.int(64) - Math.round((f / frames) * 64), 64);
      const r = rnd.float(0.9, 1.8);
      blob(p, bx, by, r, r, (x, y, d) => {
        if (d > 1) return null;
        return d < 0.5 ? [118, 130, 78] : [50, 62, 38];
      });
    }
    out.push(p);
  }
  return out;
}

/**
 * Lava is a single still texture. MM6 never frame-animated it: lava faces carry
 * FACE_IsLava and are animated by UV distortion in the rasteriser, which is why
 * the crust appears to swim rather than flicker. `getAnimated('lava')` hands the
 * world code the distortion terms instead of a frame list.
 */
export const LAVA_UV_DISTORT = {
  uvDistort: true,
  terms: [
    { period: 8000, amp: 0.01 },              // slow in/out "pong"
    { period: 5000, amp: 0.01 },              // swirl
    { period: 2000, amp: 0.005, cycles: 24 }, // fine ripple across the face
  ],
};

function tLava() {
  const per = 5;
  {
    const p = P();
    const pulse = 0.6;
    paint(p, (x, y) => {
      const fx = (x / 64) * per;
      const fy = (y / 64) * per;
      const c = worley(fx, fy, per, 1399, 1.0);
      const edge = c.f2 - c.f1;
      const n = nz(x, y, 12, 1409, 4, 0.55);
      const tone = hash2(c.gx, c.gy, 1411);
      // each plate is its own slab of crust: some fresh and black, some old
      // and ashy grey, all of them cracked
      let col = mixC([16, 13, 13], [86, 74, 68], clamp01(0.1 + n * 0.7 + tone * 0.5 - c.f1 * 0.3));
      // molten channels between plates, hotter in some seams than others
      const seam = 0.45 + nz(x, y, 3, 1413, 2, 0.5) * 1.1;
      const g = Math.pow(1 - smoothstep(0.0, 0.16, edge), 1.3) * seam;
      if (g > 0) {
        const hot = mixC([176, 46, 4], [255, 210, 90], clamp01(g * 1.5 - 0.4 + pulse * 0.2));
        col = mixC(col, hot, clamp01(g * 1.15));
      }
      // heat bleeding a little way onto the crust either side of a channel
      const bleed = (1 - smoothstep(0.1, 0.34, edge)) * 0.3 * (0.7 + pulse * 0.4) * seam;
      col = mixC(col, [126, 42, 8], clamp01(bleed));
      return col;
    });
    return p;
  }
}

// ===========================================================================
// SPECIAL
// ===========================================================================

function tSkyGradient() {
  const p = P(128);
  paint(p, (x, y) => {
    const t = y / 127;
    // deep zenith blue down to a warm pale haze at the horizon
    const c = t < 0.62
      ? mixC([44, 78, 132], [136, 174, 212], Math.pow(t / 0.62, 0.9))
      : mixC([136, 174, 212], [212, 212, 196], smoothstep(0, 1, (t - 0.62) / 0.38));
    // a whisper of high cloud so the band is not perfectly flat
    const n = fbmXY(x, y, 5, 3, 1427, 3, 0.6, 128);
    return mixC(c, [206, 218, 232], clamp01((n - 0.55) * 1.4) * 0.28 * smoothstep(0.1, 0.6, t));
  });
  return p;
}

function tCloudLayer() {
  const p = P(128);
  const S = 128;
  const dens = new Float32Array(S * S);
  const rnd = new Rand(1429);
  // Seed a handful of cumulus masses, then modulate with fbm so their edges
  // break up into the lumpy cauliflower shape.
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    puffs.push({ x: rnd.float(S), y: rnd.float(S), r: rnd.float(9, 26), s: rnd.float(0.55, 1) });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d = 0;
      for (const q of puffs) {
        let dx = Math.abs(x - q.x), dy = Math.abs(y - q.y);
        if (dx > S / 2) dx = S - dx;
        if (dy > S / 2) dy = S - dy;
        const dd = Math.sqrt(dx * dx + dy * dy * 1.6) / q.r;
        if (dd < 1.4) d = Math.max(d, q.s * (1 - dd * 0.72));
      }
      const n = fbmXY(x, y, 6, 6, 1433, 5, 0.55, S);
      dens[y * S + x] = d * 0.75 + (n - 0.4) * 0.85;
    }
  }
  paint(p, (x, y) => {
    const d = dens[y * S + x];
    const a = smoothstep(0.12, 0.34, d);
    if (a <= 0.01) return [120, 132, 150, 0];
    // lit from above: sample the density a few rows up for the top surface
    const above = dens[wrapI(y - 4, S) * S + x];
    const lit = clamp01((d - above) * 2.2 + 0.5);
    const c = mixC([146, 154, 172], [250, 250, 248], lit);
    return [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
  });
  return p;
}

function tLavaGlow() {
  const p = P();
  paint(p, (x, y) => {
    const c = worley((x / 64) * 4, (y / 64) * 4, 4, 1439, 1.0);
    const n = nz(x, y, 10, 1447, 4, 0.55);
    const core = clamp01(1 - c.f1 * 1.15) * (0.6 + n * 0.7);
    let col = mixC([176, 48, 6], [255, 168, 30], clamp01(core * 1.3));
    col = mixC(col, [255, 240, 170], clamp01(core * core * 1.5 - 0.35));
    // dark crust threads through the glow
    const edge = 1 - smoothstep(0.05, 0.3, c.f2 - c.f1);
    return mixC(col, [70, 22, 8], edge * 0.5);
  });
  return p;
}

function tPortalSwirl() {
  const p = P();
  paint(p, (x, y) => {
    const dx = (x - 31.5) / 31.5, dy = (y - 31.5) / 31.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const a = Math.atan2(dy, dx);
    // three arms winding into the centre
    const s = Math.sin(a * 3 - r * 11 + nz(x, y, 4, 1451, 3, 0.55) * 3);
    const glow = clamp01(1 - r * 1.05);
    let c = mixC([24, 6, 44], [128, 40, 200], clamp01(s * 0.5 + 0.5) * glow * 1.4);
    c = mixC(c, [206, 150, 250], clamp01(s - 0.55) * glow * 1.6);
    c = mixC(c, [246, 232, 255], clamp01(1 - r * 3.2));
    const a8 = clamp01((1 - r) * 2.2);
    return [c[0], c[1], c[2], Math.round(a8 * 255)];
  });
  return p;
}

function tMagicField() {
  const p = P();
  paint(p, (x, y) => {
    const c = worley((x / 64) * 4, (y / 64) * 4, 4, 1453, 0.5);
    const n = nz(x, y, 6, 1459, 3, 0.6);
    // bright lattice lines with a soft haze filling each cell
    const line = Math.pow(1 - smoothstep(0.0, 0.2, c.f2 - c.f1), 1.6) * (0.6 + n * 0.8);
    const haze = clamp01(0.55 - c.f1 * 0.8) * (0.4 + n * 0.9);
    const glow = clamp01(line + haze * 0.55);
    const col = mixC([58, 22, 120], [206, 164, 252], clamp01(glow * 1.5));
    return [col[0], col[1], col[2], Math.round(clamp01(glow * 0.9 + 0.12) * 255)];
  });
  return p;
}

// ===========================================================================
// REGISTRY
// ===========================================================================

// id, kind, size, tileWorld, dither, builder
const DEFS = [
  // --- terrain -------------------------------------------------------------
  ['grass', 'terrain', 64, 512, 12, tGrass],
  ['grass_dry', 'terrain', 64, 512, 12, tGrassDry],
  ['grass_lush', 'terrain', 64, 512, 12, tGrassLush],
  ['dirt', 'terrain', 64, 512, 12, tDirt],
  ['mud', 'terrain', 64, 512, 12, tMud],
  ['road_dirt', 'terrain', 64, 512, 12, tRoadDirt],
  ['road_cobble', 'terrain', 64, 512, 8, tRoadCobble],
  ['sand', 'terrain', 64, 512, 12, tSand],
  ['sand_dune', 'terrain', 64, 512, 12, tSandDune],
  ['snow', 'terrain', 64, 512, 12, tSnow],
  ['snow_rock', 'terrain', 64, 512, 10, tSnowRock],
  ['gravel', 'terrain', 64, 512, 10, tGravel],
  ['moss_rock', 'terrain', 64, 512, 10, tMossRock],
  ['swamp_muck', 'terrain', 64, 512, 12, tSwampMuck],
  ['farmland', 'terrain', 64, 512, 12, tFarmland],
  ['ash', 'terrain', 64, 512, 12, tAsh],
  ['volcanic_rock', 'terrain', 64, 512, 10, tVolcanicRock],
  ['beach_wet', 'terrain', 64, 512, 12, tBeachWet],
  ['tundra', 'terrain', 64, 512, 12, tTundra],
  ['forest_floor', 'terrain', 64, 512, 12, tForestFloor],
  // --- cliffs --------------------------------------------------------------
  ['cliff_rock', 'terrain', 64, 512, 10, tCliffRock],
  ['cliff_sand', 'terrain', 64, 512, 10, tCliffSand],
  ['cliff_snow', 'terrain', 64, 512, 10, tCliffSnow],
  ['cliff_volcanic', 'terrain', 64, 512, 10, tCliffVolcanic],
  // --- building walls ------------------------------------------------------
  ['wall_plaster', 'wall', 64, 256, 6, tWallPlaster],
  ['wall_timber', 'wall', 64, 256, 5, tWallTimber],
  ['wall_brick', 'wall', 64, 256, 6, tWallBrick],
  ['wall_stone_block', 'wall', 64, 256, 7, tWallStoneBlock],
  ['wall_castle', 'wall', 64, 256, 6, tWallCastle],
  ['wall_castle_dark', 'wall', 64, 256, 6, tWallCastleDark],
  ['wall_wood_plank', 'wall', 64, 256, 5, tWallWoodPlank],
  ['wall_log', 'wall', 64, 256, 5, tWallLog],
  ['wall_marble', 'wall', 64, 256, 4, tWallMarble],
  ['wall_sandstone', 'wall', 64, 256, 6, tWallSandstone],
  ['wall_temple', 'wall', 64, 256, 5, tWallTemple],
  ['wall_shop_front', 'wall', 64, 256, 5, tWallShopFront],
  // --- roofs ---------------------------------------------------------------
  ['roof_shingle_red', 'roof', 64, 256, 6, tRoofShingleRed],
  ['roof_shingle_grey', 'roof', 64, 256, 6, tRoofShingleGrey],
  ['roof_thatch', 'roof', 64, 256, 8, tRoofThatch],
  ['roof_tile_blue', 'roof', 64, 256, 6, tRoofTileBlue],
  ['roof_slate', 'roof', 64, 256, 6, tRoofSlate],
  // --- trim ----------------------------------------------------------------
  ['door_wood', 'trim', 64, 256, 4, tDoorWood],
  ['door_iron', 'trim', 64, 256, 4, tDoorIron],
  ['door_dungeon', 'trim', 64, 256, 4, tDoorDungeon],
  ['window_lit', 'trim', 64, 256, 4, () => windowTex(true)],
  ['window_dark', 'trim', 64, 256, 4, () => windowTex(false)],
  ['shutters', 'trim', 64, 256, 4, tShutters],
  ['fence_wood', 'trim', 64, 256, 4, tFenceWood],
  ['sign_board', 'trim', 64, 256, 4, tSignBoard],
  ['wall_banner', 'trim', 64, 256, 5, tWallBanner],
  ['barrel_side', 'trim', 64, 256, 5, tBarrelSide],
  ['crate_side', 'trim', 64, 256, 5, tCrateSide],
  // --- dungeon -------------------------------------------------------------
  ['dun_brick', 'wall', 64, 256, 7, tDunBrick],
  ['dun_brick_mossy', 'wall', 64, 256, 8, tDunBrickMossy],
  ['dun_cave', 'wall', 64, 256, 10, tDunCave],
  ['dun_cave_dark', 'wall', 64, 256, 10, tDunCaveDark],
  ['dun_metal', 'wall', 64, 256, 5, tDunMetal],
  ['dun_sewer', 'wall', 64, 256, 9, tDunSewer],
  ['dun_tomb', 'wall', 64, 256, 7, tDunTomb],
  ['dun_ice', 'wall', 64, 256, 8, tDunIce],
  ['dun_lava_rock', 'wall', 64, 256, 8, tDunLavaRock],
  ['dun_temple', 'wall', 64, 256, 5, tDunTemple],
  ['dun_wood', 'wall', 64, 256, 5, tDunWood],
  ['dun_floor_stone', 'floor', 64, 256, 8, tDunFloorStone],
  ['dun_floor_dirt', 'floor', 64, 256, 12, tDunFloorDirt],
  ['dun_floor_tile', 'floor', 64, 256, 5, tDunFloorTile],
  ['dun_ceiling_stone', 'ceiling', 64, 256, 8, tDunCeilingStone],
  ['dun_ceiling_cave', 'ceiling', 64, 256, 10, tDunCeilingCave],
  // --- liquids (animated) --------------------------------------------------
  ['water', 'liquid', 64, 512, 10, fWater],
  ['water_deep', 'liquid', 64, 512, 10, fWaterDeep],
  ['lava', 'liquid', 64, 512, 10, tLava],
  ['swamp_water', 'liquid', 64, 512, 10, fSwampWater],
  // --- special -------------------------------------------------------------
  ['sky_gradient', 'special', 128, 4096, 18, tSkyGradient],
  ['cloud_layer', 'special', 128, 8192, 10, tCloudLayer],
  ['lava_glow', 'special', 64, 512, 10, tLavaGlow],
  ['portal_swirl', 'special', 64, 256, 8, tPortalSwirl],
  ['magic_field', 'special', 64, 256, 8, tMagicField],
];

/**
 * Target luminance band per texture: [lo, hi, desaturation].
 *
 * MM6 terrain lives in roughly a quarter of the 0-255 range so the runtime grey
 * multiply has room to darken it 32 steps. Man-made surfaces are allowed a
 * wider band - brick against pale mortar genuinely is higher contrast - but not
 * much. Values come from the hex ranges in the visual spec, §11 and §12.
 */
const TONE = {
  // terrain: #3E5A28-#6E8C3C grass, #5A4A32-#8A7050 dirt, and so on
  grass: [78, 128, 0.10, 0.02],
  grass_dry: [92, 140, 0.12, 0.05],
  grass_lush: [70, 120, 0.10, 0.02],
  dirt: [70, 124, 0.06, 0.14],
  mud: [58, 106, 0.08, 0.12],
  road_dirt: [76, 130, 0.06, 0.13],
  road_cobble: [70, 162, 0.12, 0.09],
  sand: [156, 200, 0.08, 0.06],
  sand_dune: [150, 196, 0.08, 0.06],
  snow: [198, 244, 0.06, -0.02],
  snow_rock: [96, 212, 0.08, 0.05],
  gravel: [64, 158, 0.10, 0.09],
  moss_rock: [58, 134, 0.10, 0.05],
  swamp_muck: [56, 106, 0.10, 0.02],
  farmland: [70, 132, 0.06, 0.12],
  ash: [82, 136, 0.22, 0.0],
  volcanic_rock: [34, 104, 0.12, 0.05],
  beach_wet: [64, 116, 0.08, 0.03],
  tundra: [74, 124, 0.12, 0.04],
  forest_floor: [46, 114, 0.08, 0.08],
  cliff_rock: [62, 148, 0.10, 0.08],
  cliff_sand: [100, 190, 0.08, 0.07],
  cliff_snow: [96, 202, 0.06, 0.03],
  cliff_volcanic: [32, 102, 0.10, 0.05],
  // man-made: a little more range, still not punchy
  wall_plaster: [168, 224, 0.08, 0.05],
  wall_timber: [58, 216, 0.06, 0.05],
  wall_brick: [72, 168, 0.06, 0.05],
  wall_stone_block: [78, 168, 0.10, 0.10],
  wall_castle: [98, 172, 0.14, 0.11],
  wall_castle_dark: [66, 132, 0.14, 0.11],
  wall_wood_plank: [46, 138, 0.06, 0.05],
  wall_log: [44, 148, 0.06, 0.05],
  wall_marble: [190, 240, 0.10, 0.03],
  wall_sandstone: [110, 200, 0.08, 0.07],
  wall_temple: [120, 216, 0.08, 0.05],
  wall_shop_front: [66, 214, 0.08, 0.05],
  roof_shingle_red: [56, 148, 0.06, 0.03],
  roof_shingle_grey: [58, 148, 0.12, 0.06],
  roof_thatch: [70, 180, 0.10, 0.06],
  roof_tile_blue: [50, 158, 0.10, -0.02],
  roof_slate: [46, 130, 0.12, 0.0],
  dun_brick: [62, 134, 0.12, 0.05],
  dun_brick_mossy: [52, 118, 0.12, 0.04],
  dun_cave: [46, 122, 0.10, 0.09],
  dun_cave_dark: [32, 92, 0.10, 0.05],
  dun_metal: [56, 148, 0.12, 0.0],
  dun_sewer: [54, 112, 0.12, 0.03],
  dun_tomb: [86, 148, 0.10, 0.08],
  dun_ice: [136, 208, 0.08, -0.03],
  dun_lava_rock: [28, 92, 0.04, 0.06],
  dun_temple: [40, 130, 0.08, 0.0],
  dun_wood: [30, 118, 0.06, 0.05],
  dun_floor_stone: [64, 140, 0.12, 0.08],
  dun_floor_dirt: [56, 116, 0.12, 0.09],
  dun_floor_tile: [54, 148, 0.12, 0.04],
  dun_ceiling_stone: [42, 112, 0.12, 0.06],
  dun_ceiling_cave: [30, 96, 0.10, 0.07],
};

/** @type {string[]} every texture id in the library. */
export const TEXTURE_IDS = DEFS.map((d) => d[0]);

/** @type {Object<string,{size:number,tileWorld:number,kind:string}>} */
export const TEXTURE_META = {};
const _def = new Map();
for (const d of DEFS) {
  const [id, kind, size, tileWorld, dither, build] = d;
  TEXTURE_META[id] = { size, tileWorld, kind };
  _def.set(id, { id, kind, size, tileWorld, dither, build, tone: TONE[id] || null });
}

const _texCache = new Map();
const _pixCache = new Map();
const _animCache = new Map();

function texOpts(d) {
  return { dither: d.dither, mips: true, anisotropy: 4 };
}

function finish(pix, d) {
  if (d.tone) toneBand(pix, d.tone[0], d.tone[1], d.tone[2], d.tone[3]);
  return pix;
}

function build(id) {
  const d = _def.get(id);
  if (!d) throw new Error(`unknown texture id: ${id}`);
  const made = d.build();
  if (Array.isArray(made)) {
    // frame-animated fluid: water and its relatives, on the vanilla 7-frame,
    // 1.000 s table
    const frames = made.map((f) => finish(f, d));
    _pixCache.set(id, frames[0]);
    const texes = frames.map((f) => toTexture(f, texOpts(d)));
    _animCache.set(id, {
      frames: texes,
      frameTimes: frames.length === WATER_FRAMES ? WATER_FRAME_TIMES.slice() : frames.map(() => 1 / frames.length),
      duration: 1,
      fps: frames.length,
    });
    _texCache.set(id, texes[0]);
  } else {
    const pix = finish(made, d);
    _pixCache.set(id, pix);
    _texCache.set(id, toTexture(pix, texOpts(d)));
    _animCache.set(id, id === 'lava' ? LAVA_UV_DISTORT : null);
  }
}

/** Get (and lazily build) the THREE.Texture for an id. Frame 0 for fluids. */
export function getTex(id) {
  if (!_texCache.has(id)) build(id);
  return _texCache.get(id);
}

/** Raw palettised pixels, for the minimap, atlases and sprite compositing. */
export function getPix(id) {
  if (!_pixCache.has(id)) build(id);
  return _pixCache.get(id);
}

/**
 * Animation description for an id, or null.
 * - water / water_deep / swamp_water:
 *   `{ frames: THREE.Texture[], frameTimes: number[], duration: 1, fps }`
 *   Frame times are the vanilla table (1/12, 1/6 x5, 1/12), not a flat rate.
 * - lava: `{ uvDistort: true, terms: [...] }` - MM6 never swapped lava frames,
 *   it distorted the UVs, so the world code warps a single texture in-shader.
 */
export function getAnimated(id) {
  if (!_animCache.has(id)) build(id);
  return _animCache.get(id) || null;
}

/** Build everything, yielding progress so the loading bar can move. */
export function* buildAll() {
  const total = DEFS.length;
  for (let i = 0; i < total; i++) {
    const id = DEFS[i][0];
    if (!_texCache.has(id)) build(id);
    yield { id, index: i + 1, total };
  }
}

// ===========================================================================
// TRANSITION TILES
//
// MM6 does not blend terrain in the shader: the artists drew transition
// tilesets (46 variants per pair) and the map stores which variant sits on
// which tile. Roads are the same mechanism with 24 variants, which is why a
// road always looks painted onto the ground rather than sunk into it.
//
// We reproduce that with a mask set: `transitionTile(base, over, mask)`
// composites two finished terrain tiles through a hand-shaped, noise-ragged
// coverage mask, and the result is one more 64x64 palettised tile.
// ===========================================================================

/** Edge masks (the `over` terrain covers that side of the tile). */
export const EDGE_MASKS = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
/** Inner-corner masks: `over` covers everything except that corner. */
export const CORNER_MASKS = ['in_ne', 'in_se', 'in_sw', 'in_nw'];
/** Road variants, laid over a base terrain the same way MM6 lays its roads. */
export const ROAD_MASKS = [
  'road_ns', 'road_ew',
  'road_turn_ne', 'road_turn_se', 'road_turn_sw', 'road_turn_nw',
  'road_t_n', 'road_t_e', 'road_t_s', 'road_t_w',
  'road_y', 'road_cross', 'road_end_n', 'road_end_e', 'road_end_s', 'road_end_w',
];
/** Every mask id `transitionTile` accepts, plus 'full'. */
export const TRANSITION_MASKS = ['full', ...EDGE_MASKS, ...CORNER_MASKS, ...ROAD_MASKS];

const ROAD_HALF = 13;      // half width of a road band, in texels
const ROAD_FEATHER = 3;    // how far the ragged edge reaches

/** Coverage of a road arm running from the tile edge to the centre. */
function roadArm(x, y, dir) {
  // distance from the arm's centre line, and how far along the arm we are
  let across, along;
  if (dir === 'n') { across = x - 32; along = y; }
  else if (dir === 's') { across = x - 32; along = 63 - y; }
  else if (dir === 'w') { across = y - 32; along = x; }
  else { across = y - 32; along = 63 - x; }
  if (along > 32) return -999;
  return ROAD_HALF - Math.abs(across);
}

/**
 * Signed coverage for a mask, in texels: > 0 inside the `over` terrain.
 * Everything is expressed as a distance so the caller can feather and rag the
 * boundary uniformly.
 */
function maskDistance(id, x, y) {
  const n = 32 - y, s = y - 31, w = 32 - x, e = x - 31;
  switch (id) {
    case 'full': return 999;
    case 'n': return n;
    case 's': return s;
    case 'w': return w;
    case 'e': return e;
    // outer corners: the over terrain fills one quadrant
    case 'ne': return Math.min(n, e);
    case 'se': return Math.min(s, e);
    case 'sw': return Math.min(s, w);
    case 'nw': return Math.min(n, w);
    // inner corners: everything except one quadrant
    case 'in_ne': return -Math.min(n, e);
    case 'in_se': return -Math.min(s, e);
    case 'in_sw': return -Math.min(s, w);
    case 'in_nw': return -Math.min(n, w);
    default: break;
  }
  if (id.startsWith('road')) {
    const arms = {
      road_ns: ['n', 's'], road_ew: ['e', 'w'],
      road_turn_ne: ['n', 'e'], road_turn_se: ['s', 'e'],
      road_turn_sw: ['s', 'w'], road_turn_nw: ['n', 'w'],
      road_t_n: ['e', 'w', 's'], road_t_e: ['n', 's', 'w'],
      road_t_s: ['e', 'w', 'n'], road_t_w: ['n', 's', 'e'],
      road_y: ['s', 'n', 'e'], road_cross: ['n', 'e', 's', 'w'],
      road_end_n: ['n'], road_end_e: ['e'], road_end_s: ['s'], road_end_w: ['w'],
    }[id];
    if (!arms) return -999;
    let d = -999;
    for (const a of arms) d = Math.max(d, roadArm(x, y, a));
    // the junction itself is a rounded patch so arms meet cleanly
    if (arms.length > 1) {
      d = Math.max(d, ROAD_HALF + 1 - Math.hypot(x - 31.5, y - 31.5) * 0.9);
    }
    return d;
  }
  return -999;
}

const _maskCache = new Map();

/**
 * The 0-255 coverage mask for a transition id, as a Uint8Array of size*size.
 * The boundary is broken up with tiling noise so it reads as painted rather
 * than cut, and it is deliberately hard-edged: MM6 has no alpha blending.
 */
export function getMask(id, size = 64) {
  const key = `${id}@${size}`;
  if (_maskCache.has(key)) return _maskCache.get(key);
  const out = new Uint8Array(size * size);
  const road = id.startsWith('road');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x * 64) / size, sy = (y * 64) / size;
      // ragged boundary: two octaves of tiling noise pushing the edge around
      const rag = (nz(sx, sy, road ? 8 : 5, road ? 313 : 907, 3, 0.55) - 0.5) * (road ? 5 : 7);
      const d = maskDistance(id, sx, sy) + rag;
      out[y * size + x] = d > 0 ? 255 : d > -ROAD_FEATHER ? 96 : 0;
    }
  }
  _maskCache.set(key, out);
  return out;
}

const _transCache = new Map();
const _transPix = new Map();

/**
 * Composite `overId` onto `baseId` through a transition mask and return the
 * finished THREE.Texture. Cached, so the world generator can ask for the same
 * combination on every tile that needs it.
 *
 * The half-coverage band of the mask is resolved with an ordered dither
 * between the two tiles, which is exactly the trick the original art uses to
 * soften a transition edge inside an 8-bit palette.
 */
export function transitionTile(baseId, overId, maskId) {
  const key = `${baseId}|${overId}|${maskId}`;
  if (_transCache.has(key)) return _transCache.get(key);
  const base = getPix(baseId), over = getPix(overId);
  const size = Math.min(base.w, over.w);
  const mask = getMask(maskId, size);
  const out = P(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = mask[y * size + x];
      const useOver = m === 255 ? true : m === 0 ? false : ((x + y * 2) & 3) < 2;
      const src = useOver ? over : base;
      const sx = Math.round((x * src.w) / size), sy = Math.round((y * src.h) / size);
      out.setArr(x, y, src.get(sx, sy));
    }
  }
  _transPix.set(key, out);
  // already palettised on both sides, so no further dithering is wanted
  const tex = toTexture(out, { dither: 0, mips: true, anisotropy: 4 });
  _transCache.set(key, tex);
  return tex;
}

/** The raw Pix for a transition tile, for the minimap and atlas packing. */
export function transitionPix(baseId, overId, maskId) {
  const key = `${baseId}|${overId}|${maskId}`;
  if (!_transPix.has(key)) transitionTile(baseId, overId, maskId);
  return _transPix.get(key);
}
