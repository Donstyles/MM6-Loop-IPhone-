// ---------------------------------------------------------------------------
// Procedural UI chrome.
//
// MM6's interface is a carved slab: dark grey-green stone panels with bevelled
// edges, a recessed groove a few pixels in, brass trim, riveted corners and
// parchment text wells. All of it is painted here at logical 1:1 pixel scale -
// no scaling, no antialiasing, no gradients that the palette cannot express -
// and quantised so the chrome lives in the same 256 colours as the world.
// ---------------------------------------------------------------------------

import { ramp, quantizeImageData } from '../core/palette.js';
import { Pix, makeCanvas, ctx2d, mixC, scaleC, rampSample } from './texcanvas.js';
import { Rand, tileFbm2, hash2, clamp } from '../core/rng.js';
import { drawText, measure, TEXT_GOLD, TEXT_DIM, TEXT_NORMAL } from './font.js';

// --- material tones --------------------------------------------------------
// Read off the original HUD bitmaps (see ref/mm6-visual-spec.md §25). The bar is
// carved dark stone with brass fittings and inset wood panels - a dungeon
// lintel - so each material gets its own shadow/mid/highlight triple rather
// than a generic grey. Everything is quantised on the way out, which is what
// keeps these off-ramp hexes inside the game palette.
function hexC(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }

/** Three-stop tone ramp: t=0 shadow, 0.5 mid, 1 highlight. */
function toneRamp(lo, mid, hi) {
  const a = hexC(lo), b = hexC(mid), c = hexC(hi);
  return (t) => {
    t = clamp(t, 0, 1);
    return t < 0.5 ? mixC(a, b, t * 2) : mixC(b, c, (t - 0.5) * 2);
  };
}

const STONE = toneRamp(0x3a342c, 0x5a5248, 0x8a8072);   // HUD frame
const BRASS = toneRamp(0x5e4a20, 0x9a7838, 0xd8b868);   // fittings
const WOOD = toneRamp(0x2e2014, 0x4a3624, 0x6e5238);    // inset panels
const PARCH = toneRamp(0xa89068, 0xc8b48c, 0xe4d4b0);   // character sheet
const LEATHER = hexC(0x9a8460);                          // generic panel ground
const PAGE_SPELL = hexC(0xd4c29c);
const PAGE_BOOK = hexC(0xcfc0a0);
const BAR_EMPTY = hexC(0x2a2620);

function stoneTone(t) { return STONE(t); }
function css(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
/** Brass shade on the old 0..15 scale, so call sites read like a ramp. */
function goldC(sh) { return BRASS(clamp(sh / 15, 0, 1)); }

const STONE_LO = STONE(0.18);
const STONE_MID = STONE(0.50);
const STONE_HI = STONE(0.74);
const STONE_EDGE_HI = STONE(0.95);
const STONE_EDGE_LO = STONE(0.02);

// Every generated surface is cached; the HUD asks for the same panels each frame.
const _cache = new Map();
function cached(key, make) {
  let v = _cache.get(key);
  if (!v) { v = make(); _cache.set(key, v); }
  return v;
}

/** Integer-aligned filled rect. Everything in this module goes through it. */
function rect(g, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = typeof color === 'string' ? color : css(color);
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}
function hline(g, x, y, w, color) { rect(g, x, y, w, 1, color); }
function vline(g, x, y, h, color) { rect(g, x, y, 1, h, color); }

// --- UI palette ------------------------------------------------------------
// The chrome does NOT go through the world's 256-colour table. MM6's HUD ships
// as separate PCX images with their own palettes, and ours has no neutral warm
// greys at all - snapping #5A5248 through it lands on rgb(94,84,62), which is
// why an early pass came out looking like a tan picture frame. So we palettise
// the chrome to its own fixed table built from the material ramps: still a hard
// banded 8-bit surface with no gradients, just in the right hues.
const UI_PALETTE = [];
function buildUiPalette() {
  const push = (c) => UI_PALETTE.push([Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
  for (const r of [STONE, BRASS, WOOD, PARCH]) for (let i = 0; i < 16; i++) push(r(i / 15));
  for (let i = 0; i < 8; i++) push([i * 36, i * 36, i * 36]);        // neutrals
  for (const c of [LEATHER, PAGE_SPELL, PAGE_BOOK, BAR_EMPTY]) push(c);
  for (const h of [0x28c828, 0x0c7a0c, 0xe0d020, 0x8a7c0c, 0xd02010, 0x7a1408,
    0x2848d8, 0x122a7a, 0x1a1208, 0x0e0c0a]) push(hexC(h));
}
buildUiPalette();

function uiNearest(r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < UI_PALETTE.length; i++) {
    const p = UI_PALETTE[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return UI_PALETTE[best];
}

function quantise(canvas) {
  const g = ctx2d(canvas);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const p = uiNearest(d[i], d[i + 1], d[i + 2]);
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** Palettise through the world table instead - for art that sits in the 3D view. */
export function worldQuantise(canvas) {
  const g = ctx2d(canvas);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  quantizeImageData(img);
  g.putImageData(img, 0, 0);
  return canvas;
}

// --- stone body ------------------------------------------------------------

/**
 * Paint the mottled stone body of a panel into a Pix.
 * Fine grain plus a couple of darker veins; flat fills read as plastic.
 */
function stoneBody(pix, seed, base = 0.36, spread = 0.22) {
  const { w, h } = pix;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Two scales of grain: coarse blotches and per-pixel grit.
      const coarse = tileFbm2(x * 0.07, y * 0.07, 64, 3, 0.55, seed);
      const fine = hash2(x, y, seed + 91);
      let t = base + (coarse - 0.5) * spread * 2 + (fine - 0.5) * 0.035;
      // Sparse darker veins running diagonally, like the original's cast panels.
      const vein = tileFbm2(x * 0.035 + y * 0.012, y * 0.09, 64, 2, 0.5, seed + 401);
      if (vein > 0.62) t -= (vein - 0.62) * 0.60;
      pix.setArr(x, y, STONE(t));
    }
  }
  return pix;
}

/**
 * Cut a recessed groove. Grooves are lit the opposite way to raised forms - the
 * hard shadow is on the TOP/LEFT lip and the light catches the BOTTOM/RIGHT -
 * which is the single cue that makes a panel read as carved rather than printed.
 */
function drawGroove(g, x, y, w, h, depth = 2) {
  hline(g, x, y, w, STONE(0.02));
  vline(g, x, y, h, STONE(0.02));
  hline(g, x, y + h - 1, w, STONE(0.88));
  vline(g, x + w - 1, y, h, STONE(0.88));
  // Floor of the cut, darker than the field around it.
  for (let d = 1; d < depth; d++) {
    hline(g, x + d, y + d, w - d * 2, STONE(0.10));
    vline(g, x + d, y + d, h - d * 2, STONE(0.10));
    hline(g, x + d, y + h - d - 1, w - d * 2, STONE(0.30));
    vline(g, x + w - d - 1, y + d, h - d * 2, STONE(0.30));
  }
}

/**
 * The core carved panel: mottled stone, raised outer bevel, recessed inner
 * groove, optional brass trim and corner rivets.
 * opts: { seed, gold, rivets, inset, base, spread, groove }
 */
export function stonePanel(w, h, opts = {}) {
  const {
    seed = 7, gold = false, rivets = false,
    base = 0.36, spread = 0.22, groove = true, wood = false,
  } = opts;
  w = Math.max(6, w | 0); h = Math.max(6, h | 0);

  const pix = new Pix(w, h);
  stoneBody(pix, seed, base, spread);
  // Dome the field very slightly - brighter along the top third, falling away
  // to the bottom - so the slab has volume before any edge treatment.
  for (let y = 0; y < h; y++) {
    const v = h < 8 ? 0 : (1 - y / h) * 0.10 - 0.03;
    for (let x = 0; x < w; x++) {
      const u = w < 8 ? 0 : (1 - Math.abs(x / w - 0.5) * 2) * 0.04;
      const c = pix.get(x, y);
      pix.setArr(x, y, [c[0] * (1 + v + u), c[1] * (1 + v + u), c[2] * (1 + v + u)]);
    }
  }
  const canvas = pix.toCanvas();
  const g = ctx2d(canvas);

  // Optional inset wood field: the recessed panels between the stone ribs.
  if (wood && w > 14 && h > 14) {
    const m = 5;
    for (let y = m; y < h - m; y++) {
      for (let x = m; x < w - m; x++) {
        const grain = tileFbm2(x * 0.05, y * 0.55, 64, 3, 0.55, seed + 77);
        rect(g, x, y, 1, 1, WOOD(0.30 + (grain - 0.5) * 0.55));
      }
    }
    drawBevel(g, m - 1, m - 1, w - m * 2 + 2, h - m * 2 + 2,
      { depth: 1, raised: false, light: WOOD(0.85), dark: hexC(0x1a1208) });
  }

  // Hard outer keyline, then a 2px raised arris: lit top/left, dark bottom/right.
  hline(g, 0, 0, w, STONE(0.00));
  vline(g, 0, 0, h, STONE(0.00));
  hline(g, 0, h - 1, w, STONE(0.00));
  vline(g, w - 1, 0, h, STONE(0.00));
  hline(g, 1, 1, w - 2, STONE_EDGE_HI);
  vline(g, 1, 1, h - 2, STONE_EDGE_HI);
  hline(g, 2, 2, w - 4, STONE_HI);
  vline(g, 2, 2, h - 4, STONE_HI);
  hline(g, 1, h - 2, w - 2, STONE_LO);
  vline(g, w - 2, 1, h - 2, STONE_LO);
  hline(g, 2, h - 3, w - 4, STONE(0.28));
  vline(g, w - 3, 2, h - 4, STONE(0.28));

  // The deep cut 4px in, then a second inner chamfer that lifts the field back
  // up. Groove -> field -> chamfer is the whole "carved slab" read.
  if (groove && w > 18 && h > 18) {
    drawGroove(g, 4, 4, w - 8, h - 8, 2);
    drawBevel(g, 7, 7, w - 14, h - 14, { depth: 1, raised: true, light: STONE(0.70), dark: STONE(0.20) });
  }

  if (gold && w > 20 && h > 20) {
    // Brass reads as a thin inlay following the groove, never as a filled area.
    const i = 6;
    const gm = goldC(8), gh = goldC(13), gd = goldC(4);
    hline(g, i, i, w - i * 2, gd);
    vline(g, i, i, h - i * 2, gd);
    hline(g, i, h - i - 1, w - i * 2, gm);
    vline(g, w - i - 1, i, h - i * 2, gm);
    // Small fittings pinning the inlay down at the corners.
    for (const [cx, cy] of [[i, i], [w - i - 1, i], [i, h - i - 1], [w - i - 1, h - i - 1]]) {
      rect(g, cx - 1, cy - 1, 3, 3, gm);
      rect(g, cx - 1, cy - 1, 2, 2, gh);
      rect(g, cx + 1, cy + 1, 1, 1, gd);
    }
  }

  if (rivets) {
    const m = gold ? 9 : 7;
    for (const [cx, cy] of [[m, m], [w - m - 1, m], [m, h - m - 1], [w - m - 1, h - m - 1]]) {
      drawRivet(g, cx, cy);
    }
  }

  return quantise(canvas);
}

export function drawStonePanel(ctx, x, y, w, h, opts = {}) {
  const key = `sp:${w}:${h}:${opts.seed || 7}:${opts.gold ? 1 : 0}:${opts.rivets ? 1 : 0}:${opts.base || ''}:${opts.groove === false ? 0 : 1}:${opts.wood ? 1 : 0}`;
  const c = cached(key, () => stonePanel(w, h, opts));
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, x | 0, y | 0);
  ctx.imageSmoothingEnabled = s;
  return c;
}

/** A 3px domed brass stud lit from the upper left. */
function drawRivet(g, cx, cy) {
  rect(g, cx - 1, cy - 1, 3, 3, BRASS(0.22));
  rect(g, cx - 1, cy - 1, 2, 2, BRASS(0.70));
  rect(g, cx, cy, 2, 2, BRASS(0.45));
  rect(g, cx + 1, cy + 1, 1, 1, STONE(0.02));
  rect(g, cx - 1, cy - 1, 1, 1, BRASS(1));
}

export function drawRivets(ctx, x, y, w, h, spacing = 16) {
  const s = Math.max(6, spacing | 0);
  const g = ctx;
  const x0 = (x | 0) + 3, y0 = (y | 0) + 3;
  const x1 = (x | 0) + (w | 0) - 4, y1 = (y | 0) + (h | 0) - 4;
  for (let px = x0; px <= x1; px += s) { drawRivet(g, px, y0); drawRivet(g, px, y1); }
  for (let py = y0 + s; py < y1; py += s) { drawRivet(g, x0, py); drawRivet(g, x1, py); }
}

// --- bevels & insets -------------------------------------------------------

/** Raised or sunken bevel outline. opts: { depth, raised, light, dark } */
export function drawBevel(ctx, x, y, w, h, opts = {}) {
  const { depth = 1, raised = true } = opts;
  const light = opts.light || STONE_EDGE_HI;
  const dark = opts.dark || STONE_EDGE_LO;
  const a = raised ? light : dark;
  const b = raised ? dark : light;
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let d = 0; d < depth; d++) {
    hline(ctx, x + d, y + d, w - d * 2, a);
    vline(ctx, x + d, y + d, h - d * 2, a);
    hline(ctx, x + d, y + h - d - 1, w - d * 2, b);
    vline(ctx, x + w - d - 1, y + d, h - d * 2, b);
  }
}

/** Sunken well for scrolling lists and inventory grids. */
export function drawInset(ctx, x, y, w, h, opts = {}) {
  // Wells in MM6 are wood-lined recesses, not black holes.
  const fill = opts.fill === undefined ? WOOD(0.16) : opts.fill;
  x |= 0; y |= 0; w |= 0; h |= 0;
  if (fill) rect(ctx, x, y, w, h, fill);
  drawBevel(ctx, x, y, w, h, { depth: 1, raised: false, light: STONE(0.90), dark: hexC(0x1a1208) });
  drawBevel(ctx, x + 1, y + 1, w - 2, h - 2, { depth: 1, raised: false, dark: WOOD(0.05), light: WOOD(0.70) });
}

/**
 * Ornamental border: a stone band with bevels on both lips, gold hairline and
 * decorated corner blocks. Used to frame the 3D window and dialogue boxes.
 */
export function drawFrame(ctx, x, y, w, h, opts = {}) {
  const { thickness = 8, gold = true, seed = 3, corners = true } = opts;
  x |= 0; y |= 0; w |= 0; h |= 0;
  const t = Math.max(3, thickness | 0);

  // Band, painted as four stone strips so wide frames stay cheap.
  const band = cached(`fb:${t}:${seed}`, () => {
    const p = new Pix(64, t);
    stoneBody(p, seed, 0.30, 0.11);
    return quantise(p.toCanvas());
  });
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (let px = x; px < x + w; px += 64) {
    const cw = Math.min(64, x + w - px);
    ctx.drawImage(band, 0, 0, cw, t, px, y, cw, t);
    ctx.drawImage(band, 0, 0, cw, t, px, y + h - t, cw, t);
  }
  for (let py = y; py < y + h; py += 64) {
    const ch = Math.min(64, y + h - py);
    ctx.drawImage(band, 0, 0, t, ch, x, py, t, ch);
    ctx.drawImage(band, 0, 0, t, ch, x + w - t, py, t, ch);
  }
  ctx.imageSmoothingEnabled = sm;

  drawBevel(ctx, x, y, w, h, { depth: 2, raised: true });
  drawBevel(ctx, x + t - 2, y + t - 2, w - (t - 2) * 2, h - (t - 2) * 2, { depth: 2, raised: false });

  if (gold) {
    const i = Math.max(2, (t >> 1));
    const gm = goldC(8), gd = goldC(4);
    hline(ctx, x + i, y + i, w - i * 2, gm);
    vline(ctx, x + i, y + i, h - i * 2, gm);
    hline(ctx, x + i, y + h - i - 1, w - i * 2, gd);
    vline(ctx, x + w - i - 1, y + i, h - i * 2, gd);
  }

  if (corners && t >= 6) {
    const cs = t + 4;
    drawCorner(ctx, x, y, cs, 0);
    drawCorner(ctx, x + w - cs, y, cs, 1);
    drawCorner(ctx, x + w - cs, y + h - cs, cs, 2);
    drawCorner(ctx, x, y + h - cs, cs, 3);
  }
}

// --- parchment -------------------------------------------------------------

/** Aged paper: warm sand fibres, blotchy staining, darkened edges. */
export function parchment(w, h, seed = 11) {
  w = Math.max(4, w | 0); h = Math.max(4, h | 0);
  const pix = new Pix(w, h);
  const rnd = new Rand(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const coarse = tileFbm2(x * 0.045, y * 0.045, 64, 4, 0.55, seed);
      const fibre = tileFbm2(x * 0.6, y * 0.05, 64, 2, 0.5, seed + 17);
      let t = 0.66 + (coarse - 0.5) * 0.30 + (fibre - 0.5) * 0.07;
      // Edges darken as the sheet curls and grubs up.
      const ex = Math.min(x, w - 1 - x) / Math.max(1, w * 0.14);
      const ey = Math.min(y, h - 1 - y) / Math.max(1, h * 0.14);
      t -= (1 - clamp(Math.min(ex, ey), 0, 1)) * 0.22;
      pix.setArr(x, y, PARCH(clamp(t, 0, 1)));
    }
  }
  // A handful of old stains.
  const blots = 3 + rnd.int(4);
  for (let i = 0; i < blots; i++) {
    const bx = rnd.int(w), by = rnd.int(h), br = rnd.int(4, Math.max(5, Math.min(w, h) >> 2));
    for (let y = by - br; y <= by + br; y++) {
      for (let x = bx - br; x <= bx + br; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x - bx, y - by) / br;
        if (d > 1) continue;
        const k = (1 - d) * 0.22 * (0.5 + hash2(x, y, seed + i * 31) * 0.5);
        const c = pix.get(x, y);
        pix.setArr(x, y, mixC(c, rampSample('dirt', 0.42), k));
      }
    }
  }
  return quantise(pix.toCanvas());
}

/**
 * Spellbook page: parchment with a ruled margin and a gutter shadow.
 * `kind` picks the paper stock - the spellbook leaf is a shade warmer and
 * lighter than the quest/journal book.
 */
export function bookPage(w, h, seed = 23, kind = 'spell') {
  const canvas = parchment(w, h, seed);
  const g = ctx2d(canvas);
  w |= 0; h |= 0;
  // Wash the sheet toward the exact page stock.
  const stock = kind === 'book' ? PAGE_BOOK : PAGE_SPELL;
  g.globalAlpha = 0.45;
  rect(g, 0, 0, w, h, stock);
  g.globalAlpha = 1;
  // Gutter shadow down the left edge, as if bound into the spine.
  const gut = Math.min(10, Math.max(2, w >> 3));
  for (let x = 0; x < gut; x++) {
    g.fillStyle = `rgba(58,38,18,${((1 - x / gut) * 0.32).toFixed(3)})`;
    g.fillRect(x, 0, 1, h);
  }
  // Ruled margin in faded ink.
  g.globalAlpha = 0.55;
  vline(g, 13, 4, h - 8, PARCH(0.05));
  g.globalAlpha = 1;
  drawBevel(g, 0, 0, w, h, { depth: 1, raised: false, dark: PARCH(0.10), light: PARCH(1) });
  return quantise(canvas);
}

// --- controls --------------------------------------------------------------

const BTN_LO = STONE(0.10);
const BTN_MID = STONE(0.55);
const BTN_HI = STONE(0.92);

/** state: 'up' | 'down' | 'disabled' */
export function button(w, h, label = '', state = 'up', opts = {}) {
  const { seed = 5, face = 'normal', color = TEXT_GOLD } = opts;
  w = Math.max(8, w | 0); h = Math.max(8, h | 0);
  const down = state === 'down';
  const dis = state === 'disabled';

  const pix = new Pix(w, h);
  // Buttons are the same stone family as the panels but warmer and lighter so
  // they read as raised even before the bevel goes on.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = tileFbm2(x * 0.11, y * 0.11, 64, 3, 0.5, seed);
      const grit = hash2(x, y, seed + 5) - 0.5;
      // Vertical falloff: catch the light along the top third.
      const v = 1 - y / h;
      let t = 0.58 + (n - 0.5) * 0.20 + grit * 0.04 + v * 0.14 - 0.07;
      if (down) t -= 0.10;
      // Keys are stone warmed toward the brass fittings, so they read as a
      // separate, slightly brighter material from the panel behind them.
      let c = mixC(STONE(t), BRASS(0.35), 0.16);
      if (dis) {
        const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11);
        c = mixC(c, [l, l, l], 0.5);
        c = scaleC(c, 0.82);
      }
      pix.setArr(x, y, c);
    }
  }
  const canvas = pix.toCanvas();
  const g = ctx2d(canvas);

  const hi = dis ? STONE(0.62) : BTN_HI;
  const lo = dis ? STONE(0.14) : BTN_LO;
  drawBevel(g, 0, 0, w, h, { depth: 1, raised: !down, light: hi, dark: lo });
  drawBevel(g, 1, 1, w - 2, h - 2, { depth: 1, raised: !down, light: BTN_MID, dark: STONE(0.22) });
  // Hard outer keyline keeps buttons separated on a busy panel.
  drawBevel(g, 0, 0, w, h, { depth: 0, raised: true });

  if (label) {
    const off = down ? 1 : 0;
    drawText(g, label, (w >> 1) + off, ((h - 11) >> 1) + off, {
      face, align: 'center', color: dis ? TEXT_DIM : color, shadow: '#000000',
    });
  }
  return quantise(canvas);
}

export function drawButton(ctx, x, y, w, h, label = '', state = 'up', opts = {}) {
  const key = `bt:${w}:${h}:${label}:${state}:${opts.seed || 5}:${opts.face || ''}:${opts.color || ''}`;
  const c = cached(key, () => button(w, h, label, state, opts));
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, x | 0, y | 0);
  ctx.imageSmoothingEnabled = s;
  return c;
}

/** Square stone key with a pixel icon on it. */
export function iconButton(size, iconId, state = 'up') {
  const s = Math.max(12, size | 0);
  const key = `ib:${s}:${iconId}:${state}`;
  return cached(key, () => {
    const canvas = button(s, s, '', state, { seed: 9 });
    const g = ctx2d(canvas);
    const isz = Math.min(s - 6, 24);
    const off = state === 'down' ? 1 : 0;
    drawIcon(g, iconId, ((s - isz) >> 1) + off, ((s - isz) >> 1) + off, isz);
    return quantise(canvas);
  });
}

/**
 * Vertical scrollbar with arrow keys top and bottom.
 * `pos` 0..1 is the thumb position, `frac` 0..1 the visible fraction.
 */
export function drawScrollbar(ctx, x, y, h, pos = 0, frac = 0.3) {
  x |= 0; y |= 0; h |= 0;
  const w = 12;
  const btn = 11;
  drawButton(ctx, x, y, w, btn, '', 'up', { seed: 21 });
  drawIcon(ctx, 'arrow_up', x + 2, y + 2, 8);
  drawButton(ctx, x, y + h - btn, w, btn, '', 'up', { seed: 21 });
  drawIcon(ctx, 'arrow_down', x + 2, y + h - btn + 2, 8);

  const ty = y + btn, th = h - btn * 2;
  drawInset(ctx, x, ty, w, th, { fill: stoneTone(0.09) });

  const knob = Math.max(10, Math.round(th * clamp(frac, 0.05, 1)));
  const ky = ty + Math.round((th - knob) * clamp(pos, 0, 1));
  const kc = cached(`sk:${knob}`, () => button(w - 2, knob, '', 'up', { seed: 33 }));
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(kc, x + 1, ky);
  ctx.imageSmoothingEnabled = sm;
  // Grip ridges.
  if (knob >= 14) {
    const my = ky + (knob >> 1);
    for (let i = -1; i <= 1; i++) {
      hline(ctx, x + 3, my + i * 2, w - 6, i === -1 ? BTN_HI : stoneTone(0.20));
    }
  }
}

export function drawCheck(ctx, x, y, on = false) {
  x |= 0; y |= 0;
  const s = 11;
  drawInset(ctx, x, y, s, s, { fill: stoneTone(0.11) });
  if (!on) return;
  const g = goldC(12), gd = goldC(6);
  // Hand-placed tick, brighter on the upstroke.
  const pts = [[2, 5], [3, 6], [4, 7], [5, 6], [6, 4], [7, 3], [8, 2]];
  for (const [px, py] of pts) rect(ctx, x + px, y + py + 1, 2, 2, gd);
  for (const [px, py] of pts) rect(ctx, x + px, y + py, 2, 2, g);
}

export function drawSlider(ctx, x, y, w, value = 0.5) {
  x |= 0; y |= 0; w |= 0;
  // Groove.
  drawInset(ctx, x, y + 4, w, 5, { fill: stoneTone(0.08) });
  const gm = goldC(7);
  hline(ctx, x + 2, y + 6, w - 4, gm);
  const kx = x + Math.round((w - 9) * clamp(value, 0, 1));
  const kc = cached('slk', () => button(9, 13, '', 'up', { seed: 44 }));
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(kc, kx, y);
  ctx.imageSmoothingEnabled = sm;
  vline(ctx, kx + 4, y + 3, 7, stoneTone(0.18));
}

// --- bars & gauges ---------------------------------------------------------

// ib-statG / ib-statY / ib-statR / ib-statB, read off the originals. The engine
// swaps between three whole textures for HP rather than tinting one.
const BAR_TEX = {
  green: toneRamp(0x0c7a0c, 0x28c828, 0x5cf05c),
  yellow: toneRamp(0x8a7c0c, 0xe0d020, 0xf8f060),
  red: toneRamp(0x7a1408, 0xd02010, 0xf86048),
  blue: toneRamp(0x122a7a, 0x2848d8, 0x6080f8),
};

/** Which HP texture the engine would pick for this ratio. */
export function hpBarTexture(frac) {
  if (frac > 0.5) return 'green';
  if (frac > 0.25) return 'yellow';
  return 'red';
}

/**
 * MM6's HP/SP gauges are vertical tubes - 5 x 49 px, one either side of each
 * portrait - clipped from the bottom up. HP switches texture at the 50% and 25%
 * thresholds (green / yellow / red); SP is always blue. At ratio <= 0 nothing is
 * drawn at all and the dark recess shows through.
 *
 * A horizontal well is still supported (w > h) for the torchlight/experience
 * readouts in the side panel.
 */
export function drawStatBar(ctx, x, y, w, h, frac, kind = 'hp') {
  x |= 0; y |= 0; w = Math.max(3, w | 0); h = Math.max(3, h | 0);
  const tex = BAR_TEX[kind === 'sp' ? 'blue' : hpBarTexture(frac)] || BAR_TEX.green;

  // Recess: warm near-black slot with a 1px sunken lip.
  rect(ctx, x, y, w, h, BAR_EMPTY);
  drawBevel(ctx, x, y, w, h, { depth: 1, raised: false, dark: hexC(0x14100c), light: STONE(0.72) });

  const f = clamp(frac, 0, 1);
  if (f <= 0) return;
  const iw = w - 2, ih = h - 2;

  if (h > w) {
    // Vertical tube. The engine clips the whole 5 x 49 bar texture to
    // `height = ratio * 49` and anchors that at the BOTTOM of the slot, so the
    // fill is measured against the full slot height, not the height inside the
    // bevel - at ratio 1 the tube really is solid from lip to lip.
    const fh = Math.max(1, Math.min(h, Math.round(h * f)));
    const top = y + h - fh;
    for (let col = 0; col < iw; col++) {
      // Round tube shading: bright just left of centre, dark at both rims.
      const u = iw === 1 ? 0.5 : col / (iw - 1);
      const t = 1 - Math.abs(u - 0.35) * 1.55;
      rect(ctx, x + 1 + col, top, 1, fh, tex(clamp(t, 0.08, 1)));
    }
    // Meniscus at the top of the fill.
    rect(ctx, x + 1, top, iw, 1, tex(1));
    // Re-assert the carved rim so even a full tube still sits in a slot.
    vline(ctx, x, y, h, hexC(0x14100c));
    vline(ctx, x + w - 1, y, h, STONE(0.72));
    return;
  }

  // Horizontal well, filled from the left.
  const fw = Math.max(1, Math.round(iw * f));
  for (let row = 0; row < ih; row++) {
    const t = ih === 1 ? 0.6 : 1 - Math.abs(row / (ih - 1) - 0.3) * 1.5;
    rect(ctx, x + 1, y + 1 + row, fw, 1, tex(clamp(t, 0.08, 1)));
  }
  rect(ctx, x + 1, y + 1, fw, 1, tex(1));
}

/** state: 'normal' | 'active' | 'dead' | 'unconscious' | 'eradicated' */
export function drawPortraitFrame(ctx, x, y, w, h, state = 'normal') {
  x |= 0; y |= 0; w |= 0; h |= 0;
  drawBevel(ctx, x, y, w, h, { depth: 2, raised: true });
  if (state === 'active') {
    drawBevel(ctx, x + 2, y + 2, w - 4, h - 4, { depth: 1, raised: false, light: goldC(13), dark: goldC(6) });
    for (const [cx, cy] of [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) {
      drawGem(ctx, cx - 1, cy - 1, 3, 'gold');
    }
  } else if (state === 'dead' || state === 'eradicated') {
    drawBevel(ctx, x + 2, y + 2, w - 4, h - 4, { depth: 1, raised: false, light: ramp('blood', 8), dark: ramp('blood', 2) });
  } else {
    drawBevel(ctx, x + 2, y + 2, w - 4, h - 4, { depth: 1, raised: false });
  }
}

/**
 * The arch-topped recess a party portrait sits in. Four of these across the
 * bottom bar are most of what makes the HUD read as a dungeon lintel: the
 * shadow falls inside the top-left of the opening and the lit lip is along the
 * bottom-right, which is the opposite of a raised frame.
 */
export function drawPortraitNiche(ctx, x, y, w, h, opts = {}) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  const { fill = null, arch = Math.min(h >> 1, w >> 1) } = opts;
  const cx = x + w / 2;
  // Row-by-row half-width: straight sides below the springing line, a circular
  // arch above it.
  const inset = (row) => {
    const dy = arch - row;                      // >0 while inside the arch
    if (dy <= 0) return 0;
    const r = w / 2;
    const dx = r - Math.sqrt(Math.max(0, r * r - dy * dy));
    return Math.round(dx);
  };

  for (let row = 0; row < h; row++) {
    const i = inset(row);
    const left = x + i, right = x + w - 1 - i;
    if (right < left) continue;
    if (fill) rect(ctx, left, y + row, right - left + 1, 1, fill);
    // Inner shadow on the left/top of the opening.
    rect(ctx, left, y + row, 2, 1, STONE(0.04));
    rect(ctx, left + 2, y + row, 1, 1, STONE(0.18));
    // Lit lower-right lip.
    rect(ctx, right - 1, y + row, 2, 1, STONE(0.66));
    rect(ctx, right - 2, y + row, 1, 1, STONE(0.40));
  }
  // The arch soffit itself: darkest right under the crown.
  for (let row = 0; row < arch; row++) {
    const i = inset(row);
    const left = x + i, right = x + w - 1 - i;
    if (right < left) continue;
    const k = 1 - row / Math.max(1, arch);
    if (k > 0.35) rect(ctx, left, y + row, right - left + 1, 1, STONE(0.06 + (1 - k) * 0.10));
  }
  // Brass keystone at the crown, and a sill under the opening.
  const kw = Math.max(3, w >> 3);
  rect(ctx, Math.round(cx - kw / 2), y - 1, kw, 3, BRASS(0.55));
  rect(ctx, Math.round(cx - kw / 2), y - 1, kw, 1, BRASS(0.90));
  hline(ctx, x - 1, y + h, w + 2, STONE(0.80));
  hline(ctx, x - 1, y + h + 1, w + 2, STONE(0.14));
}

/** A recessed inset-wood rectangle - the panels let into the stone bar. */
export function drawWoodInset(ctx, x, y, w, h, seed = 5) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // Grain runs along the panel; knots are cheap fbm at a second scale.
      const grain = tileFbm2(px * 0.05, py * 0.5, 64, 3, 0.55, seed);
      const knot = tileFbm2(px * 0.12, py * 0.12, 64, 2, 0.5, seed + 31);
      rect(ctx, x + px, y + py, 1, 1, WOOD(0.32 + (grain - 0.5) * 0.5 + (knot - 0.5) * 0.18));
    }
  }
  drawBevel(ctx, x, y, w, h, { depth: 1, raised: false, light: STONE(0.80), dark: hexC(0x140e08) });
  drawBevel(ctx, x - 1, y - 1, w + 2, h + 2, { depth: 1, raised: false, light: STONE(0.88), dark: STONE(0.06) });
}

/** The 5 x 49 recessed slot an HP/SP tube is let into. */
export function drawTubeWell(ctx, x, y, w = 5, h = 49) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  rect(ctx, x - 1, y - 1, w + 2, h + 2, STONE(0.22));
  drawBevel(ctx, x - 1, y - 1, w + 2, h + 2, { depth: 1, raised: false, light: STONE(0.78), dark: STONE(0.02) });
  rect(ctx, x, y, w, h, BAR_EMPTY);
  // Brass collars top and bottom, the fitting that holds the tube.
  hline(ctx, x - 1, y - 2, w + 2, BRASS(0.72));
  hline(ctx, x - 1, y + h + 1, w + 2, BRASS(0.30));
}

// --- right panel: compass ribbon -------------------------------------------

// IB-COMP is a ~240 px panoramic strip of painted compass markings that slides
// behind a 26 px aperture at (541, 136) - a ribbon, never a rotating needle.
// 240 / 2048 = 0.1171875, the engine's scroll constant, so one full turn of the
// party scrolls the strip exactly once.
const COMPASS_W = 240, COMPASS_H = 20;
// Strip coordinates of the four cardinals; the intercardinals fall halfway.
const COMPASS_MARKS = [['N', 30], ['E', 90], ['S', 150], ['W', 210]];

function compassStrip() {
  return cached('comp:strip', () => {
    const pix = new Pix(COMPASS_W, COMPASS_H);
    for (let y = 0; y < COMPASS_H; y++) {
      // The band is painted on a drum, so it catches the light across the
      // middle and rolls away into shadow at both lips.
      const v = 1 - Math.abs(y / (COMPASS_H - 1) - 0.40) * 1.75;
      for (let x = 0; x < COMPASS_W; x++) {
        const grain = hash2(x, y, 613) - 0.5;
        const t = clamp(0.02 + clamp(v, 0, 1) * 0.15 + grain * 0.04, 0, 1);
        pix.setArr(x, y, mixC(STONE(t), BRASS(0.06 + t * 0.30), 0.30));
      }
    }
    const canvas = pix.toCanvas();
    const g = ctx2d(canvas);
    const cream = css(mixC(hexC(0xe6d6c1), BRASS(0.92), 0.25));
    const dim = css(BRASS(0.62));

    // Degree ticks in two lengths: a short one every 15 degrees (10 px of
    // strip) and a long one on each of the eight compass points (30 px).
    for (let i = 0; i < COMPASS_W; i += 10) {
      const major = i % 30 === 0;
      rect(g, i, major ? COMPASS_H - 8 : COMPASS_H - 5, 1, major ? 7 : 4, major ? cream : dim);
      if (major) rect(g, i + 1, COMPASS_H - 8, 1, 7, css(BRASS(0.22)));
    }
    // Cardinals in painted lettering; the intercardinals get a lozenge instead,
    // so the ribbon stays legible through a 26 px hole.
    for (const [label, pos] of COMPASS_MARKS) {
      drawText(g, label, pos, 1, { face: 'normal', align: 'center', color: cream, shadow: '#100c06' });
      const half = (pos + 30) % COMPASS_W;
      for (let k = 0; k < 3; k++) rect(g, half - k, 5 + k, 1 + k * 2, 1, dim);
      for (let k = 0; k < 2; k++) rect(g, half - 1 + k, 8 + k, 3 - k * 2, 1, dim);
    }
    // Lips: the strip is inset into the panel, so it darkens at the very edges.
    hline(g, 0, 0, COMPASS_W, css(STONE(0.02)));
    hline(g, 0, COMPASS_H - 1, COMPASS_W, css(STONE(0.06)));
    return quantise(canvas);
  });
}

/**
 * Blit the ribbon through a `w`-wide aperture at (x, y), scrolled for `yaw`
 * (radians, 0 = north). Also paints the aperture's carved lip and the brass
 * index mark at its centre - the mark the heading is actually read against.
 */
export function drawCompassRibbon(ctx, x, y, w, yaw = 0) {
  x |= 0; y |= 0; w = Math.max(8, w | 0);
  const strip = compassStrip();
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, COMPASS_H);
  ctx.clip();
  // Heading `yaw` must land under the index mark at the aperture centre.
  const p = (((30 + (yaw / (Math.PI * 2)) * COMPASS_W) % COMPASS_W) + COMPASS_W) % COMPASS_W;
  const base = Math.round(x + w / 2 - p);
  for (let r = -1; r <= 1; r++) ctx.drawImage(strip, base + r * COMPASS_W, y);
  ctx.restore();
  ctx.imageSmoothingEnabled = sm;

  // Carved aperture: shadow on the top/left lip, light on the bottom/right.
  drawBevel(ctx, x - 1, y - 1, w + 2, COMPASS_H + 2,
    { depth: 1, raised: false, dark: hexC(0x14100c), light: STONE(0.76) });

  // Index mark: a brass chevron biting into the top of the opening, with a
  // hairline dropped through the ribbon behind it.
  const cx = x + (w >> 1);
  for (let k = 0; k < 3; k++) rect(ctx, cx - 2 + k, y + k, 5 - k * 2, 1, BRASS(0.92 - k * 0.16));
  for (let k = 0; k < 2; k++) rect(ctx, cx - 1 + k, y + COMPASS_H - 1 - k, 3 - k * 2, 1, BRASS(0.50 + k * 0.16));
}

// --- right panel: hireling slots -------------------------------------------

/**
 * The 63 x 73 opening a hireling portrait hangs in, at (489,152)/(559,152).
 *
 * With no hireling engaged MM6 shows the panel art through the opening, not a
 * filled box - so `empty` paints a shallow carved recess in the same stone as
 * the column around it (arched head, shadow inside the top-left, lit lower
 * lip, an empty brass hook at the crown) and nothing else. With a hireling
 * present only the rim is drawn, leaving the portrait rect untouched.
 */
export function drawHirelingSlot(ctx, x, y, w, h, empty = true) {
  x |= 0; y |= 0; w = Math.max(8, w | 0); h = Math.max(8, h | 0);

  if (empty) {
    const body = cached(`hire:${w}:${h}`, () => {
      const pix = new Pix(w, h);
      // A touch darker and flatter than the surrounding column, so it reads as
      // sunk into it rather than as a separate plate laid on top.
      stoneBody(pix, 57, 0.30, 0.16);
      const c = pix.toCanvas();
      const g = ctx2d(c);
      const arch = Math.min(h >> 2, w >> 1);
      for (let row = 0; row < h; row++) {
        const dy = arch - row;
        const inset = dy <= 0 ? 0
          : Math.round(w / 2 - Math.sqrt(Math.max(0, (w / 2) * (w / 2) - dy * dy)));
        // Outside the arch is panel face, not recess: leave it transparent so
        // whatever stone is behind shows through.
        if (inset > 0) {
          g.clearRect(0, row, inset, 1);
          g.clearRect(w - inset, row, inset, 1);
        }
        const l = inset, r = w - 1 - inset;
        // Occlusion only: a soft ambient shade under the arch head, then the
        // carved lips. The field itself stays panel stone, so an empty slot
        // reads as the column continuing rather than as a hole cut in it.
        const k = clamp(1 - row / (h * 0.42), 0, 1);
        if (k > 0) {
          g.globalAlpha = k * 0.40;
          rect(g, l, row, r - l + 1, 1, STONE(0.06));
          g.globalAlpha = 1;
        }
        rect(g, l, row, 2, 1, STONE(0.06));
        rect(g, l + 2, row, 1, 1, STONE(0.20));
        rect(g, r - 1, row, 2, 1, STONE(0.66));
        rect(g, r - 2, row, 1, 1, STONE(0.42));
        // Hard keyline right on the cut, so the arch reads as an edge in stone
        // and not as a soft stain on the panel.
        rect(g, l, row, 1, 1, hexC(0x14100c));
        rect(g, r, row, 1, 1, STONE(0.86));
      }
      hline(g, 0, h - 1, w, hexC(0x14100c));
      hline(g, 0, h - 2, w, STONE(0.52));
      return quantise(c);
    });
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(body, x, y);
    ctx.imageSmoothingEnabled = sm;
    // The empty hook a portrait plate would hang from.
    const cx = x + (w >> 1);
    rect(ctx, cx - 1, y + 4, 3, 2, BRASS(0.66));
    rect(ctx, cx - 1, y + 4, 1, 1, BRASS(0.95));
    rect(ctx, cx, y + 6, 1, 3, BRASS(0.34));
    return;
  }

  // Occupied: a carved rim only, so the caller's portrait shows through.
  drawBevel(ctx, x - 2, y - 2, w + 4, h + 4,
    { depth: 2, raised: false, dark: hexC(0x14100c), light: STONE(0.80) });
  drawBevel(ctx, x - 1, y - 1, w + 2, h + 2,
    { depth: 1, raised: true, light: BRASS(0.62), dark: BRASS(0.18) });
}

// --- right panel: book spines ----------------------------------------------

// ib-td1..ib-td5 are five overlapping tome edges along the bottom of the right
// column, not five identical square keys. Each is bound in a different leather.
const SPINE_LEATHER = [
  toneRamp(0x2a1410, 0x5e2a20, 0x9a5040),   // oxblood
  toneRamp(0x1e2418, 0x3c5030, 0x6e8a58),   // dark green
  toneRamp(0x2a2012, 0x584028, 0x8e6c44),   // tan calf
  toneRamp(0x141a2a, 0x2c3a5e, 0x566a9a),   // blue
  toneRamp(0x241a26, 0x4a3452, 0x7c6088),   // purple
];

/**
 * One book spine. opts: { tone, state, gilt, flash }
 *   tone   0..4, picks the leather
 *   state  'up' | 'down'
 *   flash  dulls the gilt for the "new entry" blink
 *
 * Each spine lays a hard shadow down its own right edge, so a row of them
 * overlaps into a shelf rather than reading as separate buttons.
 */
export function drawBookSpine(ctx, x, y, w, h, opts = {}) {
  const { tone = 0, state = 'up', gilt = true, flash = false } = opts;
  x |= 0; y |= 0; w = Math.max(6, w | 0); h = Math.max(8, h | 0);
  const down = state === 'down';
  const t0 = ((tone | 0) % SPINE_LEATHER.length + SPINE_LEATHER.length) % SPINE_LEATHER.length;
  const key = `spine:${w}:${h}:${t0}:${down ? 1 : 0}:${gilt ? 1 : 0}:${flash ? 1 : 0}`;
  const canvas = cached(key, () => {
    const L = SPINE_LEATHER[t0];
    const pix = new Pix(w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // Round the spine across its width; grain it so it reads as hide.
        const u = w === 1 ? 0.5 : px / (w - 1);
        const round = 1 - Math.abs(u - 0.34) * 1.35;
        const grain = tileFbm2(px * 0.6, py * 0.16, 64, 3, 0.55, 91 + t0 * 17) - 0.5;
        const grit = hash2(px, py, 311 + t0) - 0.5;
        let t = 0.30 + clamp(round, 0, 1) * 0.38 + grain * 0.16 + grit * 0.05;
        // Head and tail caps roll away from the light.
        const cap = Math.min(py, h - 1 - py);
        if (cap < 2) t -= (2 - cap) * 0.10;
        if (down) t -= 0.10;
        pix.setArr(px, py, L(clamp(t, 0, 1)));
      }
    }
    const c = pix.toCanvas();
    const g = ctx2d(c);
    // Rounded head, so the row reads as tome edges rather than as tiles.
    g.clearRect(0, 0, 1, 1); g.clearRect(w - 1, 0, 1, 1);
    rect(g, 1, 0, w - 2, 1, L(0.86));
    // Lit left edge, hard shadow on the right - this is what makes them overlap.
    vline(g, 0, 1, h - 1, L(0.90));
    vline(g, w - 2, 0, h, L(0.10));
    vline(g, w - 1, 0, h, hexC(0x120c08));
    hline(g, 0, h - 1, w, hexC(0x120c08));

    if (gilt && h >= 12) {
      const gm = flash ? BRASS(0.42) : BRASS(0.74);
      const gh = flash ? BRASS(0.58) : BRASS(0.98);
      const gd = BRASS(0.16);
      // Raised bands, the way a sewn-in cord shows through the covering.
      for (const by of [Math.round(h * 0.22), Math.round(h * 0.74)]) {
        hline(g, 1, by, w - 3, gm);
        hline(g, 1, by + 1, w - 3, gd);
        rect(g, 1, by, Math.max(1, w >> 2), 1, gh);
      }
      // Tooled title panel between the bands.
      const ty = Math.round(h * 0.40), th = Math.max(3, Math.round(h * 0.26));
      if (w > 7 && ty + th < h - 2) {
        drawBevel(g, 2, ty, w - 5, th, { depth: 1, raised: true, light: gm, dark: gd });
        for (let ly = ty + 2; ly < ty + th - 1; ly += 2) hline(g, 4, ly, w - 9, gd);
      }
    }
    return quantise(c);
  });
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x, y);
  ctx.imageSmoothingEnabled = sm;
  return canvas;
}

// --- bottom bar: action plates ---------------------------------------------

/**
 * ib-m1d..ib-m4d - the four ~40 x 35 keys at (476/518/560/602, 450).
 *
 * These are carved stone plates with a painted icon sunk into them, not flat
 * squares with line art on top: a hard keyline, a 2 px raised arris lit from
 * the upper left, a recessed field with its own reversed bevel, and brass pegs
 * pinning the plate down at the corners.
 */
export function drawActionPlate(ctx, x, y, w, h, iconId, state = 'up') {
  x |= 0; y |= 0; w = Math.max(12, w | 0); h = Math.max(12, h | 0);
  const down = state === 'down';
  const plate = cached(`plate:${w}:${h}:${down ? 1 : 0}`, () => {
    const pix = new Pix(w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const n = tileFbm2(px * 0.10, py * 0.10, 64, 3, 0.5, 137);
        const grit = hash2(px, py, 211) - 0.5;
        // Dome the plate: brightest along the top-left third.
        const dome = (1 - py / h) * 0.16 + (1 - Math.abs(px / w - 0.42) * 2) * 0.05;
        let t = 0.46 + (n - 0.5) * 0.18 + grit * 0.04 + dome;
        if (down) t -= 0.12;
        pix.setArr(px, py, mixC(STONE(clamp(t, 0, 1)), BRASS(0.30), 0.12));
      }
    }
    const c = pix.toCanvas();
    const g = ctx2d(c);
    drawBevel(g, 0, 0, w, h, { depth: 1, raised: true, light: STONE(0.00), dark: STONE(0.00) });
    drawBevel(g, 1, 1, w - 2, h - 2, { depth: 2, raised: !down, light: STONE(0.94), dark: STONE(0.08) });
    // Sunken field the icon sits in.
    drawGroove(g, 4, 4, w - 8, h - 8, 2);
    for (const [cx, cy] of [[3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4]]) drawRivet(g, cx, cy);
    return quantise(c);
  });
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(plate, x, y);
  ctx.imageSmoothingEnabled = sm;

  if (iconId) {
    const isz = Math.min(w - 12, h - 12, 24);
    const o = down ? 1 : 0;
    drawIcon(ctx, iconId, x + ((w - isz) >> 1) + o, y + ((h - isz) >> 1) + o, isz);
  }
  return plate;
}

// --- decorative ------------------------------------------------------------

/** A run of brass vine-work along a band; seeded so panels differ. */
export function drawGoldFiligree(ctx, x, y, w, h, seed = 3) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  const rnd = new Rand(seed);
  const my = y + (h >> 1);
  const gm = goldC(9), gh = goldC(13), gd = goldC(5);
  // Stem: a sine-ish wave stepped to whole pixels.
  const amp = Math.max(1, (h >> 1) - 1);
  for (let i = 0; i < w; i++) {
    const t = i / Math.max(1, w - 1);
    const yy = my + Math.round(Math.sin(t * Math.PI * (2 + (seed % 3))) * amp * 0.7);
    rect(ctx, x + i, yy, 1, 1, gm);
    rect(ctx, x + i, yy + 1, 1, 1, gd);
  }
  // Curls hanging off the stem at a few points.
  const curls = Math.max(2, Math.floor(w / 24));
  for (let c = 0; c < curls; c++) {
    const cx = x + 6 + Math.floor((w - 12) * (c + 0.5) / curls) + rnd.int(-2, 2);
    const up = rnd.bool();
    const r = Math.max(2, amp);
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 1.5;
      const px = cx + Math.round(Math.cos(ang) * r);
      const py = my + (up ? -1 : 1) * Math.round(Math.abs(Math.sin(ang)) * r);
      rect(ctx, px, py, 1, 1, gm);
    }
    rect(ctx, cx, my + (up ? -r : r), 1, 1, gh);
  }
}

/** rotation: 0=TL 1=TR 2=BR 3=BL. An L of brass with a gem at the elbow. */
export function drawCorner(ctx, x, y, size, rotation = 0) {
  x |= 0; y |= 0;
  const s = Math.max(6, size | 0);
  const gm = goldC(9), gh = goldC(13), gd = goldC(5);
  const flipX = rotation === 1 || rotation === 2;
  const flipY = rotation === 2 || rotation === 3;
  const px = (u, v, c) => rect(ctx, x + (flipX ? s - 1 - u : u), y + (flipY ? s - 1 - v : v), 1, 1, c);

  const arm = s - 2;
  for (let i = 2; i < arm; i++) {
    px(i, 2, gh); px(i, 3, gd);
    px(2, i, gm); px(3, i, gd);
  }
  // Elbow block and a small gem set into it.
  for (let u = 1; u <= 4; u++) for (let v = 1; v <= 4; v++) px(u, v, gm);
  px(1, 1, gh); px(2, 1, gh); px(1, 2, gh);
  px(4, 4, gd);
  const gx = x + (flipX ? s - 1 - 3 : 2);
  const gy = y + (flipY ? s - 1 - 3 : 2);
  drawGem(ctx, gx, gy, 3, 'blood');
  // Small barbs at the arm tips.
  px(arm, 2, gh); px(2, arm, gh);
}

/** Engraved rule with a brass lozenge at its centre. */
export function drawDivider(ctx, x, y, w) {
  x |= 0; y |= 0; w |= 0;
  hline(ctx, x, y, w, stoneTone(0.10));
  hline(ctx, x, y + 1, w, stoneTone(0.60));
  const cx = x + (w >> 1);
  const gm = goldC(9), gh = goldC(13), gd = goldC(5);
  rect(ctx, cx - 1, y - 1, 3, 3, gm);
  rect(ctx, cx - 3, y, 7, 1, gd);
  rect(ctx, cx, y, 1, 1, gh);
  rect(ctx, cx - 1, y, 1, 1, gh);
}

/** Round gem accent. `color` names a palette ramp. */
export function drawGem(ctx, x, y, size, color = 'blood') {
  x |= 0; y |= 0;
  const s = Math.max(2, size | 0);
  const name = typeof color === 'string' && ramp(color, 8) ? color : 'blood';
  const r = s / 2;
  for (let v = 0; v < s; v++) {
    for (let u = 0; u < s; u++) {
      const dx = u - r + 0.5, dy = v - r + 0.5;
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      // Lit from upper-left with a bright speck and a dark rim.
      const lit = clamp(0.72 - (dx + dy) * 0.28 - d * 0.35, 0, 1);
      rect(ctx, x + u, y + v, 1, 1, rampSample(name, 0.18 + lit * 0.78));
    }
  }
  if (s >= 3) rect(ctx, x, y, 1, 1, rampSample(name, 0.97));
}

/** Rolled ends for a horizontal scroll / banner. */
export function drawScrollEnds(ctx, x, y, w, h = 14) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  const cap = 7;
  const light = rampSample('sand', 0.78), mid = rampSample('sand', 0.55), dark = rampSample('sand', 0.26);
  for (const [ex, dir] of [[x, 1], [x + w - cap, -1]]) {
    for (let i = 0; i < cap; i++) {
      const u = dir > 0 ? ex + i : ex + cap - 1 - i;
      const t = i / (cap - 1);
      const c = t < 0.4 ? mixC(dark, light, t / 0.4) : mixC(light, mid, (t - 0.4) / 0.6);
      rect(ctx, u, y - 1, 1, h + 2, c);
    }
    rect(ctx, dir > 0 ? ex : ex + cap - 1, y - 1, 1, h + 2, dark);
  }
  hline(ctx, x + cap, y, w - cap * 2, rampSample('sand', 0.30));
  hline(ctx, x + cap, y + h - 1, w - cap * 2, rampSample('sand', 0.30));
}

// --- icons -----------------------------------------------------------------
// Hand-drawn 16x16 pixel art. One shared key so an icon can be read as a
// picture in the source; every entry resolves to a palette ramp shade.
const IKEY = {
  k: ramp('grey', 1), d: ramp('grey', 4), m: ramp('grey', 8), l: ramp('grey', 12), w: ramp('grey', 15),
  x: ramp('stone', 4), X: ramp('stone', 11),
  r: ramp('blood', 11), R: ramp('blood', 5),
  o: ramp('fire', 10), f: ramp('fire', 14),
  y: ramp('gold', 12), Y: ramp('gold', 6),
  b: ramp('water', 11), B: ramp('water', 5), S: ramp('sky', 12), c: ramp('ice', 12),
  g: ramp('foliage', 11), G: ramp('foliage', 5), z: ramp('swamp', 10),
  n: ramp('wood', 9), N: ramp('wood', 4),
  s: ramp('flesh', 5), e: ramp('sand', 13), E: ramp('sand', 7),
  p: ramp('arcane', 5), P: ramp('arcane', 2), v: ramp('arcane', 7),
  // Engine-exact bar textures - these must not drift toward the earth ramps.
  1: hexC(0x28c828), 2: hexC(0x0c7a0c),   // ib-statG
  3: hexC(0xe0d020), 4: hexC(0x8a7c0c),   // ib-statY
  5: hexC(0xd02010), 6: hexC(0x7a1408),   // ib-statR
  7: hexC(0x2848d8), 8: hexC(0x122a7a),   // ib-statB
  9: hexC(0x2a2620),                       // empty slot
};

const ICON_SRC = {
  // ---- button icons ----
  rest: [
    '', '', '.......f', '......fof', '.....foof', '....foorof', '....forrof',
    '...foorrof', '...forrrrof', '...foorrroof', '....foooooof', '.....ffffff',
    '', '.NN...nnnn...NN.', '..NNnnnnnnnnNN..', '...NNNNNNNNNN...',
  ],
  quickref: [
    '', '..NNNNNNNNNN....', '.NeeeeeeeeeeN...', '.Ne.NNNNN..eN...', '.Ne.N...N..eN...',
    '.Ne.....N..eN...', '.Ne....N...eN...', '.Ne...N....eN...', '.Ne........eN...',
    '.Ne...N....eN...', '.NeEEEEEEEEeN...', '.NeeeeeeeeeeN...', '..NNNNNNNNNN....',
  ],
  options: [
    '', '......ll........', '.....lmml.......', '..l..lXXl..l....', '.llllmXXmllll...',
    '.lmXXXXXXXXml...', '.lmXXkkkkXXml...', '.lXXkkkkkkXXl...', '.lXXkkkkkkXXl...',
    '.lmXXkkkkXXml...', '.lmXXXXXXXXml...', '.llllmXXmllll...', '..l..lXXl..l....',
    '.....lmml.......', '......ll........',
  ],
  castspell: [
    '', '.......v........', '......vpv.......', '.....vpppv......', '....vppwppv.....',
    '...vppwwwppv....', '..vppwwwwwppv...', '...vppwwwppv....', '....vppwppv.....',
    '.....vpppv......', '......vpv.......', '.......v........', '.....P..P.......',
    '....P....P......',
  ],
  book: [
    '', '..NNNNNN.NNNNNN.', '.NeeeeeeNeeeeeeN', '.NeEEEEeNeEEEEeN', '.Ne....eNe....eN',
    '.NeEEEEeNeEEEEeN', '.Ne....eNe....eN', '.NeEEEEeNeEEEEeN', '.Ne....eNe....eN',
    '.NeEEEEeNeEEEEeN', '.Ne....eNe....eN', '.NeeeeeeNeeeeeeN', '..NNNNNNyNNNNNN.',
    '...NNNNNyNNNNN..',
  ],
  map: [
    '', '.eeeeeeeeeeeee..', '.eEeeeeeeeeeEe..', '.eeGGeeeeeeeee..', '.eeGGeeeeeeeee..',
    '.eeeeeeeeeeeee..', '.eeeeeR.Reeeee..', '.eeeeeeReeeeee..', '.eeeeeR.Reeeee..',
    '.eeeeeeeeeGeeee.', '.eEeeeeeeGGGeee.', '.eeeeeeeeeGeeee.', '.eeeeeeeeeeeee..',
  ],
  quest: [
    '', '.....kkkkkk.....', '....keeeeeek....', '...keEEEEEEek...', '...ke.RRRR.ek...',
    '...ke.R..R.ek...', '...ke....R.ek...', '...ke...R..ek...', '...ke..R...ek...',
    '...ke......ek...', '...ke..R...ek...', '...keEEEEEEek...', '....keeeeeek....',
    '.....kkkkkk.....',
  ],
  autonotes: [
    '', '..kkkkkkkkkk....', '..keeeeeeeek....', '..keNNNNNNek....', '..ke......ek....',
    '..keNNNNNNek....', '..ke......ek....', '..keNNNNNNek..y.', '..ke.........yY.',
    '..keNNNNN...yYe.', '..ke.......yY...', '..keeeeeeyY.....', '..kkkkkkY.......',
  ],
  history: [
    '', '.....yyyy.......', '...yy....yy.....', '..y........y....', '.y....y.....y...',
    '.y....y.....y...', 'y.....yyyy...y..', '.y..........y...', '.y..........y...',
    '..y........y....', '...yy....yy.....', '.....yyyy.......',
  ],
  zoom_in: [
    '', '....llllll......', '...lXXXXXXl.....', '..lXXXwwXXXl....', '..lXwwwwwwXl....',
    '..lXwwwwwwXl....', '..lXXXwwXXXl....', '...lXXXXXXl.....', '....llllmml.....',
    '.........mmll...', '..........mmll..', '...........mmll.', '............mml.',
  ],
  zoom_out: [
    '', '....llllll......', '...lXXXXXXl.....', '..lXXXXXXXXl....', '..lXwwwwwwXl....',
    '..lXwwwwwwXl....', '..lXXXXXXXXl....', '...lXXXXXXl.....', '....llllmml.....',
    '.........mmll...', '..........mmll..', '...........mmll.', '............mml.',
  ],
  turnbased: [
    '', '.....yyyyy......', '...yy.....yy....', '..y.........y...', '..y....y....y...',
    '.y.....y.....y..', '.y.....yyyy..y..', '..y.........y...', '..y.........y.y.', '...yy.....yy.yy.',
    '.....yyyyy...yyy',
  ],
  torch: [
    '', '.......f........', '......fof.......', '.....fooof......', '.....forof......',
    '....foorroof....', '....foorroof....', '.....fooooff....', '......foof......',
    '.......nn.......', '.......Nn.......', '.......nn.......', '.......Nn.......',
    '.......nn.......',
  ],
  sleep: [
    '', '.........SSSSS..', '............SS..', '...........SS...', '..........SS....',
    '.........SSSSS..', '....SSSS........', '.......SS.......', '......SS........',
    '....SSSS........', '..bbbbbbbbbbbb..', '.bBBBBBBBBBBBBb.', '.bBbbbbbbbbbbBb.',
    '.bBBBBBBBBBBBBb.', '..bbbbbbbbbbbb..',
  ],

  // ---- stats & conditions ----
  hp: [
    '', '', '..rrr....rrr....', '.rrrrr..rrrrr...', 'rrrwrrrrrrrrrr..', 'rrwrrrrrrrrrrr..',
    'rrrrrrrrrrrrrr..', '.rrrrrrrrrrrr...', '..RrrrrrrrrrR...', '...RrrrrrrrR....',
    '....RrrrrrR.....', '.....RrrrR......', '......RrR.......', '.......R........',
  ],
  sp: [
    '', '.......b........', '......bbb.......', '.....bbSbb......', '.bb..bSSSb..bb..',
    '..bbbbSSSbbbb...', '...bbSSwSSbb....', '..bbbbSSSbbbb...', '.bb..bSSSb..bb..',
    '.....bbSbb......', '......bbb.......', '.......b........',
  ],
  ac: [
    '', '..llllllllll....', '.lXXXXXXXXXXl...', '.lXXwXXXXwXXl...', '.lXXXXXXXXXXl...',
    '.lXXXXwwXXXXl...', '.lXXXXXXXXXXl...', '..lXXXXXXXXl....', '..lXXXXXXXXl....',
    '...lXXXXXXl.....', '....lXXXXl......', '.....lXXl.......', '......ll........',
  ],
  gold: [
    '', '....yyyyyy......', '..yyYYYYYYyy....', '.yYYyyyyyyYYy...', '.yYyyYYYYyyYy...',
    '.yYyYY..YYyYy...', '.yYyY....YyYy...', '.yYyY....YyYy...', '.yYyYY..YYyYy...',
    '.yYyyYYYYyyYy...', '.yYYyyyyyyYYy...', '..yyYYYYYYyy....', '....yyyyyy......',
  ],
  food: [
    '', '......nnnn......', '.....nooooN.....', '....nooooooN....', '....noooooON....',
    '....nooooooN....', '.....noooooN....', '......nooN......', '.......ee.......',
    '.......ee.......', '......eee.......', '.....ee.........', '....ee..........',
  ],
  exp: [
    '', '.......y........', '......yyy.......', '.....yYyYy......', '....yY.y.Yy.....',
    '...yY..y..Yy....', '..yY...y...Yy...', '.......y........', '....yyyyyyy.....',
    '....yYYYYYy.....', '.....yyyyy......', '......yyy.......',
  ],
  cond_good: [
    '', '', '..............g.', '.............gg.', '............gg..', 'g..........gg...',
    'gg........gg....', '.gg......gg.....', '..gg....gg......', '...gg..gg.......',
    '....gggg........', '.....gg.........',
  ],
  cond_cursed: [
    '', '.....PPPPP......', '...PPvvvvvPP....', '..Pvv.....vvP...', '..Pv..P.P..vP...',
    '..Pv.......vP...', '..Pv.PPPPP.vP...', '..Pvv.....vvP...', '...PPvvvvvPP....',
    '.....PPPPP......', '.......P........', '......P.P.......', '.....P...P......',
  ],
  cond_weak: [
    '', '.....zzzz.......', '....z....z......', '....z....z......', '.....zzzz.......',
    '.......z........', '.......z........', '..zzzzzzzzzz....', '...zzzzzzzz.....',
    '....zzzzzz......', '.....zzzz.......', '......zz........',
  ],
  cond_asleep: [
    '', '.........SSSSSS.', '............SS..', '...........SS...', '..........SS....',
    '.........SSSSSS.', '....SSSSS.......', '.......SS.......', '......SS........',
    '.....SSSSS......', '..SSSS..........', '....SS..........', '...SS...........',
    '..SSSS..........',
  ],
  cond_afraid: [
    '', '', '...ssssss.......', '..s......s......', '.s.dd..dd.s.....',
    '.s.dd..dd.s.....', '.s........s.....', '.s...dd...s.....', '.s..dddd..s.....',
    '..s.dddd.s......', '...ssssss.......',
  ],
  cond_drunk: [
    '', '..llllllll......', '..lXXXXXXl......', '..loooooXl.lll..', '..loooooXl.l.l..',
    '..lnnnnnXl.l.l..', '..lnnnnnXllll...', '..lnnnnnXl......', '..lnnnnnXl......',
    '..lnnnnnXl......', '..llllllll......', '...llllll.......',
  ],
  cond_insane: [
    '', '.....ppppp......', '...pp.....pp....', '..p...ppp...p...', '..p..p...p..p...',
    '..p.p.ppp.p.p...', '..p.p.p.p.p.p...', '..p.p.p...p.p...', '..p.p.ppppp.p...',
    '..p..ppppppp....', '...pp...........', '.....ppppppp....',
  ],
  cond_poison: [
    '', '.......g........', '.......g........', '......ggg.......', '.....ggzgg......',
    '....ggzzzgg.....', '...ggzzzzzgg....', '..ggzzzwzzzgg...', '..gzzzzwzzzzg...',
    '..gzzzzzzzzzg...', '...ggzzzzzgg....', '....gggggggg....', '......gggg......',
  ],
  cond_disease: [
    '', '....zzzzzzz.....', '..zzGGzzzGGzz...', '..zGGGzzzGGGz...', '.zzzzzzGGzzzzz..',
    '.zzGGzzGGzzGGz..', '.zzGGzzzzzzGGz..', '.zzzzzGGzzzzzz..', '..zzGGGGGzzzz...',
    '..zzzGGGzzGGz...', '...zzzzzzzGGz...', '.....zzzzzzz....',
  ],
  cond_paralyzed: [
    '', '........ff......', '.......ff.......', '......ff........', '.....fff........',
    '....ffffff......', '.......ff.......', '......ff........', '.....ff.........',
    '....ff..........', '...fff..........', '..ff............',
  ],
  cond_unconscious: [
    '', '......w..w......', '....w..ww..w....', '...w..wwww..w...', '..w..w....w..w..',
    '..w.w......w.w..', '..w.w......w.w..', '..w..w....w..w..', '...w..wwww..w...',
    '....w..ww..w....', '......w..w......',
  ],
  cond_dead: [
    '', '.....eeeee......', '...eeeeeeeee....', '..eekkeeekkee...', '..eekkeeekkee...',
    '..eeeeekeeeee...', '..eeeekkkeeeee..', '...eeeeeeeee....', '....eeeeeee.....',
    '....ekekeke.....', '....eeeeeee.....', '.....eekee......',
  ],
  cond_stoned: [
    '', '.....xxxxx......', '...xxXXXXXxx....', '..xXXddXddXXx...', '..xXXddXddXXx...',
    '..xXXXXXXXXXx...', '..xXXXXxXXXXx...', '..xXddddddXXx...', '...xXXXXXXXx....',
    '....xxXXXxx.....', '......xxx.......',
  ],
  cond_eradicated: [
    '', '.k...kkkkk...k..', '..k.kkdddkk.k...', '...kkddkddkkk...', '..kkddkkkddkk...',
    '..kddddkddddk...', '..kdddkkkdddk...', '.k.kddddddDk.k..', '..k.kdddddk.k...',
    '..k..dkdkd..k...', '.k....kkk....k..',
  ],
};

const ICON_SRC2 = {
  // ---- magic schools ----
  school_fire: [
    '', '.......f........', '......ff........', '.....fof........', '....foof........',
    '...fooof.f......', '..foooofof......', '..foorooof......', '..forrooof......',
    '..foorrooof.....', '...fooroof......', '....foooof......', '.....ffff.......',
  ],
  school_air: [
    '', '', '...SSSSSS.......', '..S......SS.....', '.........SS.....', '...SSSSSSS......',
    '..SSSSSSSSSSS...', '.............S..', '............SS..', '...SSSSSSSSS....',
    '..S.............', '...SSSSSSS......', '.........SS.....',
  ],
  school_water: [
    '', '.......b........', '.......b........', '......bbb.......', '.....bbSbb......',
    '....bbSSSbb.....', '...bbSSSSSbb....', '..bbSSSwSSSbb...', '..bSSSwwwSSSb...',
    '..bSSSSwSSSSb...', '..bbSSSSSSSbb...', '...bbSSSSSbb....', '....bbbbbbb.....',
    '......bbb.......',
  ],
  school_earth: [
    '', '', '.......N........', '......NnN.......', '.....NnnnN......', '....NnnnnnN.....',
    '..N.NnnXXnN.N...', '.NnNNnnXXnNNnN..', 'NnnnNNnnnnNNnnnN', 'NnnnnnnnnnnnnnnN',
    '.NNNNNNNNNNNNNN.', '..NNNNNNNNNNNN..',
  ],
  school_spirit: [
    '', '.....wwww.......', '....ww..ww......', '....w....w......', '....ww..ww......',
    '.....wwww.......', '..wwwwwwwwww....', '..wwwwwwwwww....', '......ww........',
    '......ww........', '......ww........', '.....wwww.......', '.....wwww.......',
  ],
  school_mind: [
    '', '', '....llllllll....', '..lleeeeeeeell..', '.leeepppppeeel..', '.leeppvvvppeel..',
    'leeppvwwwvppeel.', '.leeppvvvppeel..', '.leeepppppeeel..', '..lleeeeeeeell..',
    '....llllllll....',
  ],
  school_body: [
    '', '', '...rr.....rr....', '..rrrr...rrrr...', '.rrrrrr.rrrrrr..', '.rrwrrrrrrrrrr..',
    '.rrrrrrrrrrrrr..', '..rrrrrrrrrrr...', '...RrrrrrrrrR...', '....RrrrrrrR....',
    '.....RrrrrR.....', '......RrrR......', '.......RR.......',
  ],
  school_light: [
    '', '.......y........', '..y....y....y...', '...y...y...y....', '.....yyyyy......',
    '....yywwwyy.....', 'y..yywwwwwyy..y.', 'yyyywwwwwwwyyyyy', 'y..yywwwwwyy..y.',
    '....yywwwyy.....', '.....yyyyy......', '...y...y...y....', '..y....y....y...',
    '.......y........',
  ],
  school_dark: [
    '', '.....PPPPP......', '...PPPPPPPPP....', '..PPPPP..vvPP...', '.PPPPP....vvvP..',
    '.PPPP......vvvP.', '.PPPP.......vvP.', '.PPPP.......vvP.', '.PPPPP....vvvP..',
    '..PPPPP..vvPP...', '...PPPPPPPPP....', '.....PPPPP......',
  ],

  // ---- item slots ----
  slot_weapon: [
    '', '............ll..', '...........lwl..', '..........lwll..', '.........lwl....',
    '........lwl.....', '.......lwl......', '......lwl.......', '.....lwl........',
    '..y.lwl.........', '.yyywl..........', 'YyyyyY..........', '.Y.yyy..........',
    '....Yy..........',
  ],
  slot_offhand: [
    '', '..llllllllll....', '.lXXXXXXXXXXl...', '.lXXXXXXXXXXl...', '.lXXXrrrrXXXl...',
    '.lXXrrRRrrXXl...', '.lXXrrRRrrXXl...', '..lXXrrrrXXl....', '..lXXXXXXXXl....',
    '...lXXXXXXl.....', '....lXXXXl......', '.....lXXl.......', '......ll........',
  ],
  slot_bow: [
    '', '.....nnn........', '....n...n.......', '...n.....n......', '..n.......n.....',
    '..n........n....', '..n........n....', '..n.......n.....', '...n.....n......',
    '....n...n.......', '.....nnn........', '.......e........', '.......e........',
  ],
  slot_armor: [
    '', '..ll......ll....', '.lXXll..llXXl...', '.lXXXXllXXXXl...', '.lXXXXXXXXXXl...',
    '.lXXXwXXwXXXl...', '.lXXXXXXXXXXl...', '..lXXXXXXXXl....', '..lXXXXXXXXl....',
    '..lXXXXXXXXl....', '..lXXXXXXXXl....', '..llXXXXXXll....', '...llllllll.....',
  ],
  slot_helm: [
    '', '', '....llllllll....', '..llXXXXXXXXll..', '.lXXXXXXXXXXXXl.', 'lXXXkkXXXXkkXXl',
    'lXXXkkXXXXkkXXl', 'lXXXXXXXXXXXXXl', 'lXXXXXkkXXXXXXl', '.lXXXXkkXXXXXl..',
    '..lXXXXXXXXXl...', '...lllllllll....',
  ],
  slot_boots: [
    '', '', '...NNNN.........', '...NnnN.........', '...NnnN.........', '...NnnN.........',
    '...NnnN.........', '...NnnNNNN......', '...NnnnnnnNN....', '...NnnnnnnnN....',
    '..NNNNNNNNNNN...', '..NkkkkkkkkkN...', '...NNNNNNNNN....',
  ],
  slot_gauntlets: [
    '', '', '...ll.ll.ll.....', '..lXXlXXlXXl....', '..lXXlXXlXXl....', '.llXXXXXXXXl....',
    'lXXXXXXXXXXl....', 'lXXXXXXXXXXl....', '.lXXXXXXXXXl....', '.lXXXXXXXXl.....',
    '..lXXXXXXl......', '...llllll.......',
  ],
  slot_belt: [
    '', '', '', 'NNNNNNyyyyNNNNNN', 'NnnnnyYYYYyNnnnN', 'NnnnnyY..YyNnnnN', 'NnnnnyY..YyNnnnN',
    'NnnnnyYYYYyNnnnN', 'NNNNNNyyyyNNNNNN',
  ],
  slot_cloak: [
    '', '....RRRRRRRR....', '...RrrrrrrrrR...', '..RrrRrrrrRrrR..', '..RrrRrrrrRrrR..',
    '.RrrrRrrrrRrrrR.', '.RrrrRrrrrRrrrR.', 'RrrrrRrrrrRrrrrR', 'RrrrrRrrrrRrrrrR',
    'RrrrrRrrrrRrrrrR', 'RRrrrRrrrrRrrrRR', '.RRRRRrrrrRRRRR.', '.....RRRRRR.....',
  ],
  slot_amulet: [
    '', '.y........y.....', '..y......y......', '..y......y......', '...y....y.......',
    '....y..y........', '.....yy.........', '....yyyy........', '...yYbbYy.......',
    '...yYbSbYy......', '...yYbbbYy......', '....yyyy........',
  ],
  slot_ring: [
    '', '', '.......bb.......', '......bSSb......', '.....yybbyy.....', '....yyYYYYyy....',
    '...yyY....Yyy...', '...yY......Yy...', '...yY......Yy...', '...yyY....Yyy...',
    '....yyYYYYyy....', '......yyyy......',
  ],

  // ---- misc ----
  arrow_up: [
    '', '.......ww.......', '......wwww......', '.....wwwwww.....', '....wwwwwwww....',
    '...wwwwwwwwww...', '..wwwwwwwwwwww..', '.....wwwwww.....', '.....wwwwww.....',
    '.....wwwwww.....', '.....wwwwww.....', '.....wwwwww.....',
  ],
  arrow_down: [
    '', '.....wwwwww.....', '.....wwwwww.....', '.....wwwwww.....', '.....wwwwww.....',
    '.....wwwwww.....', '..wwwwwwwwwwww..', '...wwwwwwwwww...', '....wwwwwwww....',
    '.....wwwwww.....', '......wwww......', '.......ww.......',
  ],
  arrow_left: [
    '', '', '.......w........', '......ww........', '.....www........', '....wwwwwwwwww..',
    '...wwwwwwwwwww..', '..wwwwwwwwwwww..', '...wwwwwwwwwww..', '....wwwwwwwwww..',
    '.....www........', '......ww........', '.......w........',
  ],
  arrow_right: [
    '', '', '........w.......', '........ww......', '........www.....', '..wwwwwwwwww....',
    '..wwwwwwwwwww...', '..wwwwwwwwwwww..', '..wwwwwwwwwww...', '..wwwwwwwwww....',
    '........www.....', '........ww......', '........w.......',
  ],
  compass_needle: [
    '', '.......r........', '.......rr.......', '......rrr.......', '......rrrr......',
    '.....rrrrr......', '.....rrrrrr.....', '....llllllll....', '.....lllll......',
    '.....lllll......', '......llll......', '......lll.......', '.......ll.......',
    '.......l........',
  ],
  skull: [
    '', '.....eeeee......', '...eeeeeeeee....', '..eeeeeeeeeee...', '..eekkeeekkee...',
    '..ekkkkekkkke...', '..eekkeeekkee...', '..eeeeekeeeee...', '...eeeekkeeee...',
    '....eeeeeeee....', '....EeEeEeEe....', '....eeeeeeee....', '.....EeEeEe.....',
  ],
  coin: [
    '', '', '....yyyyyy......', '..yyYYYYYYyy....', '.yYYyyyyyyYYy...', '.yYyyYYYYyyYy...',
    '.yYyYYyyYYyYy...', '.yYyYyyyyYyYy...', '.yYyYYyyYYyYy...', '.yYyyYYYYyyYy...',
    '.yYYyyyyyyYYy...', '..yyYYYYYYyy....', '....yyyyyy......',
  ],
  key: [
    '', '', '...yyyy.........', '..yYYYYy........', '.yYy..yYy.......', '.yY....Yy.......',
    '.yYy..yYyyyyyyy.', '..yYYYYyYYYYYYy.', '...yyyy...y.y.y.', '..........y.y.y.',
    '..........yyyyy.',
  ],
  chest_small: [
    '', '', '..NNNNNNNNNNNN..', '.NnnnnnnnnnnnnN.', '.NnyyyyyyyyyynN.', '.NnnnnnnnnnnnnN.',
    '.NNNNNNNNNNNNNN.', '.NnnnnnyyynnnnN.', '.NnnnnnyYynnnnN.', '.NnnnnnyyynnnnN.',
    '.NnnnnnnnnnnnnN.', '..NNNNNNNNNNNN..',
  ],
  star: [
    '', '.......y........', '.......y........', '......yyy.......', '.....yyyyy......',
    'yyyyyyyyyyyyyy..', '.yyyyyyyyyyyy...', '..yyyyyyyyyy....', '...yyyyyyyy.....',
    '...yyyy.yyyy....', '..yyyy...yyyy...', '.yyy.......yyy..', '.yy.........yy..',
  ],
};

// Monster health strip, turn-based state and the ready-marker rings. These are
// separate bitmaps in the original (ib-statG/Y/R, turn0..5, IB-InitG/Y/R) and
// the engine picks between them rather than tinting one image.
const ICON_SRC3 = {
  mhp_bg: ['', '', '', '', '', '', 'kkkkkkkkkkkkkkkk', 'k99999999999999k', 'k99999999999999k', 'kkkkkkkkkkkkkkkk'],
  mhp_grn: ['', '', '', '', '', '', 'kkkkkkkkkkkkkkkk', 'k11111111111111k', 'k22222222222222k', 'kkkkkkkkkkkkkkkk'],
  mhp_yel: ['', '', '', '', '', '', 'kkkkkkkkkkkkkkkk', 'k33333333333333k', 'k44444444444444k', 'kkkkkkkkkkkkkkkk'],
  mhp_red: ['', '', '', '', '', '', 'kkkkkkkkkkkkkkkk', 'k55555555555555k', 'k66666666666666k', 'kkkkkkkkkkkkkkkk'],
  init_green: [
    '', '', '....111111......', '..11222222 11...', '.122......221...', '12..........21..',
    '1............1..', '1............1..', '12..........21..', '.122......221...',
    '..11222222 11...', '....111111......',
  ],
  init_yellow: [
    '', '', '....333333......', '..33444444.33...', '.3 44......443..', '34..........43..',
    '3............3..', '3............3..', '34..........43..', '.344......443...',
    '..33444444.33...', '....333333......',
  ],
  init_red: [
    '', '', '....555555......', '..55666666.55...', '.5 66......665..', '56..........65..',
    '5............5..', '5............5..', '56..........65..', '.566......665...',
    '..55666666.55...', '....555555......',
  ],
};

Object.assign(ICON_SRC, ICON_SRC2, ICON_SRC3);

// --- painted overlay sprites -----------------------------------------------
//
// turn0..turn5 and turnhour are drawn at 44 px inside the 3D window, far too
// large to survive being a 16x16 character grid blown up nearly three times: at
// that size the original is a *painted object* - a brass clock whose hand walks
// round as the party spends action points, and an hourglass while the monsters
// move. So these are rendered analytically at whatever size is asked for, with
// a lit bezel, a shaded dial, a cast shadow and a hard 1-bit silhouette.

/** Shade a brass surface by how squarely it faces the upper-left key light. */
function litBrass(nx, ny, base = 0.5, k = 0.42) {
  return BRASS(clamp(base - (nx + ny) * k * 0.5, 0.04, 1));
}

function paintClock(size, hand) {
  const s = Math.max(12, size | 0);
  const pix = new Pix(s, s);
  const cx = (s - 1) / 2, cy = (s - 1) / 2;
  const R = s * 0.44;
  const RIM = R * 0.80;          // inner edge of the brass bezel
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < s && y < s) pix.setArr(x, y, c); };

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      // Cast shadow: the disc stands a couple of pixels off the wall behind it.
      if (d > R && Math.hypot(dx - 2, dy - 2) <= R) { put(x, y, hexC(0x100c08)); continue; }
      if (d > R) continue;
      const nx = dx / R, ny = dy / R;
      if (d > RIM) {
        // Bezel: a torus, lit upper-left and dark lower-right, with a hard dark
        // line right on the silhouette so it keys cleanly over the world.
        put(x, y, d > R - 1.2 ? BRASS(0.06) : litBrass(nx, ny, 0.62, 0.95));
      } else {
        // Dial: blued steel, brightest under the bezel's upper-left reflection.
        const g = clamp(0.16 - (nx + ny) * 0.07 - (d / RIM) * 0.05, 0.02, 1);
        put(x, y, mixC(STONE(g), BRASS(0.08), 0.25));
      }
    }
  }

  const canvas = pix.toCanvas();
  const g = ctx2d(canvas);
  // Twelve engraved hour ticks; the quarters run longer and brighter.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const quarter = i % 3 === 0;
    const r0 = RIM * (quarter ? 0.62 : 0.76), r1 = RIM * 0.92;
    for (let r = r0; r <= r1; r += 0.5) {
      const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
      rect(g, px, py, 1, 1, quarter ? BRASS(0.90) : BRASS(0.58));
      rect(g, px + 1, py + 1, 1, 1, BRASS(0.16));
    }
  }
  // The hand. `hand` is 0..5: 0 points straight up and each step is 60 degrees
  // clockwise, so the sprite reads as a countdown of remaining action points.
  const a = (hand / 6) * Math.PI * 2 - Math.PI / 2;
  const len = RIM * 0.80;
  const wide = Math.max(1, Math.round(s / 22));
  for (let r = 0; r <= len; r += 0.4) {
    const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
    // Taper toward the tip and keep one shaded flank so it reads as forged.
    const half = Math.max(0, Math.round(wide * (0.4 + (1 - r / len) * 0.9)));
    rect(g, px - half, py - half, half * 2 + 1, half * 2 + 1, BRASS(0.94));
    rect(g, px + 1, py + 1, half + 1, half + 1, BRASS(0.34));
  }
  // Centre boss.
  const bo = Math.max(1, Math.round(s / 16));
  for (let y = -bo; y <= bo; y++) {
    for (let x = -bo; x <= bo; x++) {
      if (Math.hypot(x, y) > bo) continue;
      rect(g, Math.round(cx) + x, Math.round(cy) + y, 1, 1, litBrass(x / bo, y / bo, 0.70, 0.7));
    }
  }
  return quantise(canvas);
}

// The sand in the glass; warm amber against the cold blue of the bulbs.
const HOURGLASS_SAND = toneRamp(0x6e3c0c, 0xc88820, 0xf0cc70);

function paintHourglass(size) {
  const s = Math.max(12, size | 0);
  const pix = new Pix(s, s);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < s && y < s) pix.setArr(x, y, c); };
  const capH = Math.max(2, Math.round(s * 0.10));
  const top = Math.round(s * 0.08), bot = s - top - 1;
  const midY = (top + bot) / 2;
  const halfW = s * 0.32, neck = Math.max(1, s * 0.045);

  for (let y = top; y <= bot; y++) {
    // Glass profile: two cones meeting at the waist.
    const k = Math.abs(y - midY) / (midY - top);
    const half = neck + (halfW - neck) * k;
    const x0 = Math.round(s / 2 - half), x1 = Math.round(s / 2 + half);
    const inCap = y < top + capH || y > bot - capH;
    for (let x = x0; x <= x1; x++) {
      const u = (x - s / 2) / Math.max(1, half);
      if (inCap) {
        // Turned wooden caps top and bottom.
        put(x, y, WOOD(clamp(0.42 - u * 0.20 + (y < top + capH ? 0.10 : -0.06), 0, 1)));
        continue;
      }
      // Glass: dark and cool, with a bright specular down the left third.
      let c = mixC(STONE(clamp(0.10 - u * 0.06, 0, 1)), hexC(0x1c2630), 0.6);
      if (u > -0.74 && u < -0.46) c = mixC(c, [226, 236, 246], 0.62);
      if (u > 0.62) c = mixC(c, hexC(0x0a0806), 0.6);
      // Sand: a heap in the lower bulb, a thin stream through the waist, and a
      // shallow remnant still to fall in the upper one.
      const below = y > midY;
      const heapTop = bot - capH - (bot - capH - midY) * 0.62;
      if (below && y >= heapTop) {
        const spread = (y - heapTop) / Math.max(1, bot - capH - heapTop);
        if (Math.abs(u) < 0.35 + spread * 0.75) {
          c = HOURGLASS_SAND(clamp(0.42 - u * 0.28 + spread * 0.22, 0, 1));
        }
      } else if (Math.abs(x - s / 2) <= Math.max(0.6, neck * 0.9)) {
        c = HOURGLASS_SAND(0.80);
      } else if (!below && y < midY - (midY - top - capH) * 0.35 && Math.abs(u) < 0.86) {
        c = HOURGLASS_SAND(clamp(0.34 - u * 0.22, 0, 1));
      }
      put(x, y, c);
    }
    // Brass frame posts either side of the glass.
    put(x0 - 1, y, BRASS(0.68));
    put(x1 + 1, y, BRASS(0.24));
  }
  const canvas = pix.toCanvas();
  const g = ctx2d(canvas);
  // Cap mouldings.
  for (const cy of [top, top + capH - 1, bot - capH + 1, bot]) {
    const k = Math.abs(cy - midY) / (midY - top);
    const half = Math.round(neck + (halfW - neck) * k) + 2;
    hline(g, Math.round(s / 2 - half), cy, half * 2 + 1, cy <= midY ? WOOD(0.85) : WOOD(0.10));
  }
  return quantise(canvas);
}

// Registered by name so the HUD carries on asking for `turn3` / `turnhour`.
const PAINTED_ICONS = {
  turn0: (s) => paintClock(s, 0), turn1: (s) => paintClock(s, 1),
  turn2: (s) => paintClock(s, 2), turn3: (s) => paintClock(s, 3),
  turn4: (s) => paintClock(s, 4), turn5: (s) => paintClock(s, 5),
  turnhour: (s) => paintHourglass(s),
};

export const ICONS = Object.keys(ICON_SRC).concat(Object.keys(PAINTED_ICONS));

const _iconCache = new Map();
const _iconGrid = new Map();
const OUTLINE = hexC(0x0e0c0a);

/**
 * Turn the authored 16x16 character grid into painted pixels.
 *
 * The source art is flat blocks of colour, which reads as a modern flat icon
 * set. MM6's icons are painted: muted, outlined, and lit from the upper left.
 * So every icon gets the same treatment here rather than being hand-shaded 78
 * times - desaturate a quarter, lift the pixels whose up/left neighbour is
 * empty, drop the ones whose down/right neighbour is empty, then ring the whole
 * silhouette in near-black.
 */
function iconGrid(id) {
  let grid = _iconGrid.get(id);
  if (grid) return grid;
  const src = ICON_SRC[id] || [];
  const N = 16;
  const cells = new Array(N * N).fill(null);
  const solid = new Uint8Array(N * N);

  for (let y = 0; y < N; y++) {
    const row = src[y] || '';
    for (let x = 0; x < N; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const c = IKEY[ch];
      if (!c) continue;
      // Mute: pull a quarter of the way to the pixel's own luma.
      const l = c[0] * 0.30 + c[1] * 0.59 + c[2] * 0.11;
      cells[y * N + x] = mixC(c, [l, l, l], 0.25);
      solid[y * N + x] = 1;
    }
  }

  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : solid[y * N + x]);
  const shaded = cells.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!solid[y * N + x]) continue;
      const c = cells[y * N + x];
      const lit = !at(x - 1, y) || !at(x, y - 1);
      const dark = !at(x + 1, y) || !at(x, y + 1);
      if (lit && !dark) shaded[y * N + x] = mixC(c, [255, 255, 255], 0.26);
      else if (dark && !lit) shaded[y * N + x] = scaleC(c, 0.66);
    }
  }
  // Outline last so the shading never eats it.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (solid[y * N + x]) continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && at(x + dx, y + dy)) { touch = true; break; }
        }
      }
      if (touch) shaded[y * N + x] = OUTLINE;
    }
  }
  grid = shaded;
  _iconGrid.set(id, grid);
  return grid;
}

/** Render an icon to its own canvas, nearest-sampled from the 16x16 source. */
export function iconCanvas(id, size = 16) {
  const s = Math.max(4, size | 0);
  const key = id + ':' + s;
  let c = _iconCache.get(key);
  if (c) return c;

  if (PAINTED_ICONS[id]) {
    const painted = PAINTED_ICONS[id](s);
    _iconCache.set(key, painted);
    return painted;
  }

  const canvas = makeCanvas(s, s);
  if (!ICON_SRC[id]) { _iconCache.set(key, canvas); return canvas; }
  const grid = iconGrid(id);

  const g = ctx2d(canvas);
  const img = g.createImageData(s, s);
  const d = img.data;
  // Sizes that are not multiples of 16 just drop or double rows, which is what
  // the original's scaled art did too.
  for (let y = 0; y < s; y++) {
    const sy = Math.min(15, Math.floor((y * 16) / s));
    for (let x = 0; x < s; x++) {
      const sx = Math.min(15, Math.floor((x * 16) / s));
      const c2 = grid[sy * 16 + sx];
      if (!c2) continue;
      const p = (y * s + x) * 4;
      d[p] = c2[0]; d[p + 1] = c2[1]; d[p + 2] = c2[2]; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _iconCache.set(key, canvas);
  return canvas;
}

export function drawIcon(ctx, id, x, y, size = 16) {
  const c = iconCanvas(id, size);
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, x | 0, y | 0);
  ctx.imageSmoothingEnabled = s;
  return c;
}

export { TEXT_GOLD, TEXT_NORMAL, TEXT_DIM, measure };
