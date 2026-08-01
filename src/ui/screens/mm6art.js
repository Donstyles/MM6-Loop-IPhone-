// ---------------------------------------------------------------------------
// Painted UI kit for the full-screen panels.
//
// Everything the panels used to build out of rounded rectangles, smooth
// gradients and soft glows is re-made here as painted, hard-edged, palettised
// art. The rules this file exists to enforce:
//
//   * no rounded corners anywhere - every silhouette is drawn with integer
//     scanline rectangles, never with arc()/ellipse()/stroke(), because canvas
//     antialiases those and a 256-colour frame cannot contain a soft edge;
//   * no smooth gradient - every ramp is quantised into a handful of bands and
//     ordered-dithered into the palette;
//   * no radial alpha falloff - lamp and fire light is a few hard rings with a
//     stipple, which is how an 8-bit painter fakes a glow;
//   * buttons are carved plates: 1px light top-left, 1px dark bottom-right,
//     inverted and shifted +1,+1 when pressed.
//
// It lives in src/ui/screens/ rather than src/art/ because the art modules are
// owned elsewhere; this is the panels' own paintbox.
// ---------------------------------------------------------------------------

import { ramp, rampCss, snap, BAYER8 } from '../../core/palette.js';
import { hash2, fbm2, valueNoise2, clamp } from '../../core/rng.js';

// --- palette plumbing -------------------------------------------------------

const _snapMemo = new Map();

/** BAYER8 ships flat; index it as an 8x8. */
function bay(x, y) { return BAYER8[(((y & 7) << 3) | (x & 7))]; }
function snapC(r, g, b) {
  const R = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const G = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const B = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  const k = (R << 16) | (G << 8) | B;
  let v = _snapMemo.get(k);
  if (v === undefined) { v = snap(R, G, B); _snapMemo.set(k, v); }
  return v;
}

export function hexRGB(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function css(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
/** Snap to the palette and hand back a css string - the only way colour leaves. */
export function pc(c) { const s = snapC(c[0], c[1], c[2]); return `rgb(${s[0]},${s[1]},${s[2]})`; }

/** Quantise t into `steps` bands. Banding is the look, not an artefact. */
export function band(t, steps) {
  const s = Math.max(2, steps | 0);
  return Math.round(clamp(t, 0, 1) * (s - 1)) / (s - 1);
}

const _canvases = new Map();
export function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return c;
}
export function cached(key, make) {
  let c = _canvases.get(key);
  if (c === undefined) { c = make(); _canvases.set(key, c); }
  return c;
}

/**
 * Per-pixel painter. `fn(x, y)` returns [r,g,b] (or [r,g,b,a], or null for a
 * transparent pixel); the result is ordered-dithered and palettised.
 */
export function paintCanvas(w, h, fn, dither = 9) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      const i = (y * w + x) * 4;
      if (!col) { d[i + 3] = 0; continue; }
      const t = bay(x, y) * dither;
      const p = snapC(col[0] + t, col[1] + t, col[2] + t);
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
      d[i + 3] = col[3] === undefined ? 255 : col[3];
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function blit(ctx, canvas, x, y) {
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x | 0, y | 0);
  ctx.imageSmoothingEnabled = s;
}

// --- hard-edged primitives --------------------------------------------------
// Canvas antialiases arcs, ellipses and strokes. Nothing here uses them.

export function rct(ctx, x, y, w, h, c) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  ctx.fillRect(x | 0, y | 0, Math.max(0, w | 0), Math.max(0, h | 0));
}

/** Filled circle built from integer scanlines: a hard 1-bit silhouette. */
export function disc(ctx, cx, cy, r, c) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  const R = Math.max(1, Math.round(r));
  for (let dy = -R; dy <= R; dy++) {
    const k = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    if (k <= 0) continue;
    ctx.fillRect(Math.round(cx) - k, Math.round(cy) + dy, k * 2, 1);
  }
}

export function ellip(ctx, cx, cy, rx, ry, c) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  const RX = Math.max(1, Math.round(rx)), RY = Math.max(1, Math.round(ry));
  for (let dy = -RY; dy <= RY; dy++) {
    const k = Math.round(RX * Math.sqrt(Math.max(0, 1 - (dy * dy) / (RY * RY))));
    if (k <= 0) continue;
    ctx.fillRect(Math.round(cx) - k, Math.round(cy) + dy, k * 2, 1);
  }
}

/** Bresenham-ish thick line, drawn as stacked squares so it stays crunchy. */
export function lineH(ctx, x0, y0, x1, y1, c, thick = 1) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
  const t = Math.max(1, thick | 0);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (dx * i) / n) - (t >> 1);
    const y = Math.round(y0 + (dy * i) / n) - (t >> 1);
    ctx.fillRect(x, y, t, t);
  }
}

export function polyH(ctx, pts, c) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  ctx.beginPath();
  ctx.moveTo(Math.round(pts[0]), Math.round(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(Math.round(pts[i]), Math.round(pts[i + 1]));
  ctx.closePath();
  ctx.fill();
}

/** Bayer-stippled rectangle: an 8-bit painter's only "partial" coverage. */
export function stipple(ctx, x, y, w, h, c, density = 0.5) {
  ctx.fillStyle = typeof c === 'string' ? c : pc(c);
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (bay(x + i, y + j) + 0.5 >= density) continue;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

// --- carved plates ----------------------------------------------------------
// MM6's buttons are little carved slabs. Light catches the top and left arris,
// the bottom and right fall into shadow, and the whole thing is ringed by a
// hard keyline so it separates from the panel. Pressed inverts the arris and
// pushes the face one pixel down and right.

const PLATE_MATERIALS = {
  stone: { lo: [58, 52, 44], hi: [138, 128, 112], key: [26, 22, 18], grit: 0.10 },
  wood: { lo: [46, 34, 20], hi: [124, 94, 60], key: [20, 14, 8], grit: 0.16 },
  brass: { lo: [72, 56, 26], hi: [200, 172, 104], key: [30, 24, 12], grit: 0.07 },
  bone: { lo: [120, 108, 84], hi: [222, 210, 180], key: [56, 48, 34], grit: 0.09 },
};

function plateCanvas(w, h, material, state, seed) {
  const M = PLATE_MATERIALS[material] || PLATE_MATERIALS.stone;
  const down = state === 'down';
  const dis = state === 'disabled';
  const k = down ? 0.82 : dis ? 0.78 : 1;
  return paintCanvas(w, h, (x, y) => {
    // Body: coarse mottle plus grit, quantised to six value bands. The vertical
    // fall is only three steps, so it reads as carved, never as a gradient.
    const n = fbm2(x * 0.085, y * 0.11, 2, 3, 0.55, seed) * 0.5 + 0.5;
    const grit = (hash2(x, y, seed + 11) - 0.5) * M.grit;
    const vert = 1 - band(y / Math.max(1, h - 1), 4) * 0.22;
    let t = band(clamp(0.38 + (n - 0.5) * 0.5 + grit, 0, 1), 6) * vert;
    // Chisel scratches, a couple per plate.
    if (((x * 3 + y * 7 + seed) % 97) < 2) t += 0.10;
    let c = mix(M.lo, M.hi, clamp(t, 0, 1));
    if (dis) { const l = (c[0] + c[1] + c[2]) / 3; c = mix(c, [l, l, l], 0.55); }
    c = shade(c, k);

    // Hard keyline, then the arris.
    const onTop = y === 1, onLeft = x === 1;
    const onBot = y === h - 2, onRight = x === w - 2;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return M.key;
    const lit = down ? (onBot || onRight) : (onTop || onLeft);
    const dark = down ? (onTop || onLeft) : (onBot || onRight);
    if (lit) return mix(M.hi, [255, 255, 255], 0.22);
    if (dark) return shade(M.lo, 0.62);
    return c;
  }, 7);
}

/**
 * Carved plate. `state`: 'up' | 'down' | 'hot' | 'disabled'.
 * Returns the +1,+1 content offset a pressed plate needs.
 */
export function carvedPlate(ctx, x, y, w, h, opts = {}) {
  const state = opts.state || 'up';
  const material = opts.material || 'stone';
  const seed = opts.seed === undefined ? 5 : opts.seed;
  const key = `pl:${w}:${h}:${material}:${state === 'hot' ? 'up' : state}:${seed}`;
  const c = cached(key, () => plateCanvas(Math.max(3, w | 0), Math.max(3, h | 0), material,
    state === 'hot' ? 'up' : state, seed));
  blit(ctx, c, x, y);
  if (state === 'hot') {
    // Hover is a warm wash, not an outline: MM6 lights the label, not the plate.
    stipple(ctx, x + 2, y + 2, w - 4, h - 4, [255, 228, 150], 0.16);
  }
  return state === 'down' ? 1 : 0;
}

/** Sunken well: the inverse plate, used for tick boxes and inset panels. */
export function carvedWell(ctx, x, y, w, h, opts = {}) {
  const M = PLATE_MATERIALS[opts.material || 'stone'];
  const seed = opts.seed === undefined ? 17 : opts.seed;
  const key = `we:${w}:${h}:${opts.material || 'stone'}:${seed}`;
  const c = cached(key, () => paintCanvas(Math.max(3, w | 0), Math.max(3, h | 0), (px, py) => {
    const W = Math.max(3, w | 0), H = Math.max(3, h | 0);
    if (px === 0 || py === 0 || px === W - 1 || py === H - 1) return M.key;
    if (py === 1 || px === 1) return shade(M.lo, 0.55);
    if (py === H - 2 || px === W - 2) return mix(M.hi, [255, 255, 255], 0.12);
    const n = fbm2(px * 0.12, py * 0.14, 2, 2, 0.5, seed) * 0.5 + 0.5;
    return shade(mix(M.lo, M.hi, band(n * 0.4, 4)), 0.72);
  }, 6));
  blit(ctx, c, x, y);
}

/** A slider groove: a deep 5px cut with a dark floor. No handle. */
export function groove(ctx, x, y, w, h = 5) {
  x |= 0; y |= 0; w |= 0;
  rct(ctx, x, y, w, h, [20, 17, 13]);
  rct(ctx, x, y, w, 1, [40, 35, 28]);
  rct(ctx, x, y + h - 1, w, 1, [116, 106, 90]);
  rct(ctx, x, y, 1, h, [40, 35, 28]);
  rct(ctx, x + w - 1, y, 1, h, [110, 100, 86]);
  // Ticks cut into the lip, the way MM6 steps its volume sliders.
  for (let i = 0; i <= 8; i++) {
    rct(ctx, x + Math.round(((w - 1) * i) / 8), y + h, 1, 2, [72, 64, 54]);
  }
}

/** The metal plate that rides the groove. */
export function handle(ctx, x, y, w = 7, h = 13, hot = false) {
  const c = cached(`hn:${w}:${h}:${hot ? 1 : 0}`, () => paintCanvas(w, h, (px, py) => {
    const lo = hot ? [96, 84, 40] : [72, 70, 66];
    const hi = hot ? [226, 202, 108] : [186, 182, 172];
    if (px === 0 || py === 0 || px === w - 1 || py === h - 1) return [22, 20, 18];
    if (py === 1 || px === 1) return mix(hi, [255, 255, 255], 0.3);
    if (py === h - 2 || px === w - 2) return shade(lo, 0.7);
    const t = band(1 - Math.abs(px / (w - 1) - 0.4) * 1.4, 4);
    return mix(lo, hi, t);
  }, 5));
  blit(ctx, c, x, y);
}

/** Sunken well with a painted tick. MM6 has no checkbox; this is a rune slot. */
export function tickBox(ctx, x, y, s, on, hot) {
  carvedWell(ctx, x, y, s, s, { material: 'wood' });
  if (!on) return;
  const g = hot ? [246, 226, 120] : [225, 205, 35];
  const d = shade(g, 0.45);
  // Hand-placed tick, painted twice: shadow first, then the stroke over it.
  const pts = [[2, s - 6], [3, s - 5], [4, s - 4], [5, s - 6], [6, s - 9], [7, s - 11], [8, s - 13]];
  for (const [ax, ay] of pts) rct(ctx, x + ax + 1, y + ay + 1, 2, 2, d);
  for (const [ax, ay] of pts) rct(ctx, x + ax, y + ay, 2, 2, g);
}

/**
 * Bookmark / chapter tab: a painted leather tongue. `out` pushes it proud when
 * its chapter is open. No lettering - MM6's tabs are wordless.
 */
export function bookmarkTab(ctx, x, y, w, h, colorHex, opts = {}) {
  const base = hexRGB(colorHex);
  const out = !!opts.open;
  const key = `bm:${w}:${h}:${colorHex}:${out ? 1 : 0}:${opts.seed || 0}`;
  const c = cached(key, () => paintCanvas(w, h, (px, py) => {
    // The tongue tapers at its outer end: two steps, cut square.
    const cut = px > w - 5 ? (px > w - 3 ? 3 : 1) : 0;
    if (py < cut || py >= h - cut) return null;
    if (px === 0 || py === cut || px === w - 1 || py === h - 1 - cut) return shade(base, 0.28);
    const n = fbm2(px * 0.2, py * 0.3, 2, 2, 0.5, 3) * 0.5 + 0.5;
    const lit = 1 - band(py / (h - 1), 4) * 0.30;
    let t = band(clamp(0.34 + (n - 0.5) * 0.45, 0, 1), 5);
    let col = mix(shade(base, 0.34), base, t);
    col = shade(col, lit * (out ? 1.06 : 0.72));
    if (py === cut + 1) col = mix(col, [255, 255, 255], 0.18);
    if (py === h - 2 - cut) col = shade(col, 0.7);
    return col;
  }, 6));
  blit(ctx, c, x, y);
}

// --- painted paper ----------------------------------------------------------

export const PAPER = {
  sheet: { base: '#c8b48c', lo: '#a89068', hi: '#e4d4b0' },
  spell: { base: '#d4c29c', lo: '#b0a078', hi: '#ede0c4' },
  book: { base: '#cfc0a0', lo: '#ac9c78', hi: '#e8dcbc' },
  // Tooled hide: the inventory field and the paperdoll's backing board.
  hide: { base: '#4a3a26', lo: '#2a2014', hi: '#6e5a3c' },
};

/**
 * Painted parchment. Fibre runs horizontally, blotches sit in the field, and
 * the edge is worn along an irregular line rather than a clean rectangle.
 */
export function paperCanvas(w, h, kind = 'sheet', seed = 11) {
  const K = PAPER[kind] || PAPER.sheet;
  const lo = hexRGB(K.lo), hi = hexRGB(K.hi);
  // Dark stock has fewer palette entries to land on, so it gets less dither -
  // otherwise the ordered pattern reads as a woven screen rather than as hide.
  const dark = kind === 'hide';
  return paintCanvas(w, h, (x, y) => {
    const coarse = fbm2(x * 0.035, y * 0.045, 2, 4, 0.55, seed) * 0.5 + 0.5;
    // Paper fibre: long, thin, mostly horizontal streaks.
    const fibre = valueNoise2(x * 0.75, y * 5.5, seed + 31) - 0.5;
    const fleck = (hash2(x, y, seed + 7) - 0.5) * 0.10;
    // Blotching: a handful of stains stamped by a low-frequency ridge.
    const blot = fbm2(x * 0.012 + 4, y * 0.014, 2, 2, 0.6, seed + 91);
    const stain = blot > 0.72 ? (blot - 0.72) * (dark ? 0.7 : 1.9) : 0;
    let t = 0.56 + (coarse - 0.5) * (dark ? 0.5 : 0.85) + fibre * 0.13 + fleck - stain * 0.55;
    // Worn edge: the rim darkens on a noisy boundary, not a straight inset.
    const wob = valueNoise2(x * 0.09, y * 0.09, seed + 5) * 5;
    const ex = Math.min(x, w - 1 - x) + wob, ey = Math.min(y, h - 1 - y) + wob;
    const e = Math.min(ex / 13, ey / 11);
    if (e < 1) t -= (1 - clamp(e, 0, 1)) * (dark ? 0.28 : 0.42);
    return mix(lo, hi, band(clamp(t, 0, 1), 12));
  }, dark ? 3 : 8);
}

export function paper(ctx, x, y, w, h, kind = 'sheet', seed = 11) {
  blit(ctx, cached(`pp:${w}:${h}:${kind}:${seed}`, () => paperCanvas(w, h, kind, seed)), x, y);
}

/** The gutter shadow that makes a two-page spread read as a bound book. */
export function gutter(ctx, x, y, h, side) {
  for (let i = 0; i < 9; i++) {
    const d = side === 'right' ? x + i : x - i;
    stipple(ctx, d, y, 1, h, [46, 32, 14], 0.06 + (1 - i / 9) * 0.42);
  }
}

// --- painted light ----------------------------------------------------------

/**
 * A lamp / fire pool. Three hard rings plus a stippled skirt: exactly what a
 * 256-colour painter can do, and nothing a soft radial alpha could.
 */
export function lightPool(ctx, cx, cy, r, colorHex, strength = 1) {
  const c = hexRGB(colorHex);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Two steps and a stippled skirt. Any more rings and the pool reads as a
  // bullseye; any brighter and additive blending burns the middle to white.
  const rings = [[0.34, 0.26], [0.66, 0.13]];
  for (const [k, a] of rings) {
    ctx.globalAlpha = clamp(a * strength, 0, 1);
    disc(ctx, cx, cy, r * k, css(c));
  }
  ctx.globalAlpha = clamp(0.11 * strength, 0, 1);
  // Skirt: a 1-bit stippled ring, so the edge of the light is dithered, not soft.
  const R = Math.round(r);
  ctx.fillStyle = css(c);
  for (let dy = -R; dy <= R; dy++) {
    const yy = Math.round(cy) + dy;
    const k = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    const k0 = Math.round(0.80 * Math.sqrt(Math.max(0, R * R - dy * dy)));
    for (let dx = -k; dx <= k; dx++) {
      if (Math.abs(dx) < k0) continue;
      const xx = Math.round(cx) + dx;
      if (bay(xx, yy) > 0) continue;
      ctx.fillRect(xx, yy, 1, 1);
    }
  }
  ctx.restore();
}

/**
 * Flame sprite. Tinted around #FF3C1E, three nested tongues, 1-bit alpha and
 * no falloff at all - the silhouette is cut, not faded.
 */
export function flame(ctx, cx, baseY, w, h, phase = 0) {
  // Four painted tongues, each a hard silhouette inside the last. The pale
  // core is small: a flame that is mostly white core reads as a light bulb.
  const layers = [
    { k: 1.00, c: [122, 20, 8] },
    { k: 0.70, c: [255, 60, 30] },
    { k: 0.40, c: [255, 148, 36] },
    { k: 0.15, c: [255, 226, 150] },
  ];
  for (const L of layers) {
    ctx.fillStyle = pc(L.c);
    const hh = Math.max(2, Math.round(h * (0.55 + L.k * 0.45)));
    const hw = Math.max(1, w * L.k * 0.5);
    for (let i = 0; i < hh; i++) {
      const t = i / hh;                               // 0 at base, 1 at tip
      // Tongue profile: fat low, pinched at the tip, wavering with the phase.
      const prof = Math.pow(1 - t, 0.62) * (1 - t * 0.15);
      const sway = Math.sin(phase * 2.4 + t * 4.2 + L.k * 3) * w * 0.10 * t;
      const k = Math.max(1, Math.round(hw * prof));
      ctx.fillRect(Math.round(cx + sway) - k, Math.round(baseY) - i, k * 2, 1);
    }
  }
}

/** A candle: wax stick, drip, wick, small flame. */
export function candle(ctx, x, baseY, hgt, phase = 0) {
  const w = 4;
  for (let i = 0; i < hgt; i++) {
    const y = baseY - i;
    rct(ctx, x, y, w, 1, i > hgt - 3 ? [236, 226, 196] : [214, 200, 164]);
    rct(ctx, x, y, 1, 1, [244, 238, 214]);
    rct(ctx, x + w - 1, y, 1, 1, [154, 140, 110]);
  }
  rct(ctx, x + 1, baseY - hgt - 2, 1, 3, [40, 32, 24]);
  flame(ctx, x + 2, baseY - hgt - 2, 5, 9, phase);
  lightPool(ctx, x + 2, baseY - hgt - 4, 13, '#ffb040', 0.7);
}

// --- painted figures --------------------------------------------------------

const SKIN = {
  pale: [216, 174, 138], mid: [188, 138, 100], dark: [126, 86, 58],
};

/**
 * Paint a head with a real face: brow shadow, eyes, nose, mouth, hair. `w` is
 * the head width; the head sits with its chin on `y + h`.
 */
export function paintedHead(ctx, cx, topY, w, h, o = {}) {
  const skin = o.skin || SKIN.mid;
  const lit = mix(skin, [255, 244, 220], 0.35);
  const shadow = shade(skin, 0.66);
  const hair = o.hair || [64, 42, 26];
  cx = Math.round(cx); topY = Math.round(topY);
  const hw = Math.max(2, w / 2);
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    // Skull: wide at the brow, narrowing to the chin. Two hard steps, no curve.
    const prof = t < 0.18 ? 0.74 + t * 1.4 : t < 0.70 ? 1 : 1 - (t - 0.70) * 1.9;
    const k = Math.max(1, Math.round(hw * prof));
    const y = topY + i;
    rct(ctx, cx - k, y, k * 2, 1, t < 0.5 ? skin : mix(skin, shadow, (t - 0.5) * 0.7));
    rct(ctx, cx - k, y, Math.max(1, (k * 2) / 3 | 0), 1, mix(lit, skin, 0.35));
    rct(ctx, cx + k - 1, y, 1, 1, shadow);
  }
  if (h < 9 || w < 7) return;
  const eyeY = topY + Math.round(h * 0.44);
  const eyeDx = Math.max(1, Math.round(hw * 0.44));
  // Brow shadow across the socket, then the eyes.
  rct(ctx, cx - eyeDx - 2, eyeY - 2, eyeDx * 2 + 4, 2, shade(skin, 0.72));
  for (const s of [-1, 1]) {
    rct(ctx, cx + s * eyeDx - 1, eyeY, 2, 2, [242, 238, 226]);
    rct(ctx, cx + s * eyeDx - (s < 0 ? 0 : 1), eyeY, 1, 2, o.eye || [46, 62, 44]);
  }
  rct(ctx, cx, eyeY + 2, 1, 3, shade(skin, 0.74));           // nose
  rct(ctx, cx - 1, eyeY + 2, 1, 2, lit);
  rct(ctx, cx - 2, topY + Math.round(h * 0.78), 4, 1, shade(skin, 0.55)); // mouth
  // Hair: a cap with a hard fringe, plus a lit crown.
  const hh = Math.round(h * 0.34);
  for (let i = 0; i < hh; i++) {
    const t = i / Math.max(1, hh - 1);
    const k = Math.max(1, Math.round(hw * (0.76 + t * 0.30)));
    rct(ctx, cx - k, topY + i, k * 2, 1, i < 2 ? mix(hair, [255, 230, 190], 0.28) : hair);
  }
  if (o.hood) {
    // Hood: cloth over the crown and down both cheeks, leaving the face open.
    const hc = o.hood;
    const depth = Math.round(h * 0.72);
    for (let i = -2; i < depth; i++) {
      const t = clamp((i + 2) / (depth + 2), 0, 1);
      const k = Math.max(2, Math.round(hw * (0.86 + t * 0.55)));
      const inner = Math.max(1, Math.round(hw * 0.66));
      // Only the brim and the two cheek falls are cloth; the face shows through.
      const cloth1 = i < 2 ? mix(hc, [255, 244, 220], 0.18) : hc;
      rct(ctx, cx - k, topY + i, k - inner, 1, cloth1);
      rct(ctx, cx + inner, topY + i, k - inner, 1, shade(hc, 0.66));
      if (i < 2) rct(ctx, cx - k, topY + i, k * 2, 1, cloth1);
      if (i === depth - 1) rct(ctx, cx - k, topY + i, k * 2, 1, shade(hc, 0.55));
    }
  }
}

/**
 * A standing person: shaded torso, arms and legs with cloth folds, a face, and
 * a hard 1-bit silhouette. Replaces the flat black cloak-and-circle blobs.
 */
export function paintedFigure(ctx, cx, baseY, hgt, o = {}) {
  const cloth = o.cloth || [82, 62, 44];
  const cloth2 = o.cloth2 || shade(cloth, 0.62);
  const skin = o.skin || SKIN.mid;
  const H = Math.max(18, Math.round(hgt));
  cx = Math.round(cx); baseY = Math.round(baseY);
  // Human proportions: about seven heads tall, shoulders a quarter of the
  // height across. Anything wider reads as a barrel, which is what the old
  // silhouettes did.
  const headH = Math.round(H * 0.15);
  const headW = Math.round(H * 0.125);
  const shoulderY = baseY - H + headH + Math.round(H * 0.035);
  const hipY = baseY - Math.round(H * 0.44);
  const bodyW = Math.max(3, Math.round(H * 0.115));

  // Legs / skirt of the robe.
  for (let y = hipY; y < baseY; y++) {
    const t = (y - hipY) / Math.max(1, baseY - hipY);
    const k = Math.round(bodyW * (o.robe ? 0.98 + t * 0.42 : 0.92 - t * 0.16));
    const c = o.robe ? cloth : (o.legs || shade(cloth, 0.78));
    rct(ctx, cx - k, y, k * 2, 1, c);
    rct(ctx, cx - k, y, Math.max(1, Math.round(k * 0.5)), 1, mix(c, [255, 240, 210], 0.14));
    rct(ctx, cx + Math.round(k * 0.45), y, k - Math.round(k * 0.45), 1, shade(c, 0.68));
    if (!o.robe && Math.abs(y - hipY) > 6) rct(ctx, cx - 1, y, 2, 1, shade(c, 0.55));
    // Fold lines every few rows, offset per leg.
    if ((y * 7 + cx) % 23 === 0) rct(ctx, cx - k + 2, y, Math.max(1, k), 1, shade(c, 0.78));
  }
  if (!o.robe) {
    // Boots.
    const bh = Math.max(2, Math.round(H * 0.07));
    for (const s of [-1, 1]) {
      const bx = cx + s * Math.round(bodyW * 0.45) - Math.round(bodyW * 0.34);
      rct(ctx, bx, baseY - bh, Math.round(bodyW * 0.68), bh, [52, 38, 24]);
      rct(ctx, bx, baseY - bh, Math.round(bodyW * 0.68), 1, [96, 74, 46]);
    }
  }

  // Torso.
  for (let y = shoulderY; y < hipY; y++) {
    const t = (y - shoulderY) / Math.max(1, hipY - shoulderY);
    // Chest broad, waist in: a sine pinch rather than a straight taper.
    const k = Math.round(bodyW * (1.02 - Math.sin(t * Math.PI) * 0.16));
    rct(ctx, cx - k, y, k * 2, 1, cloth);
    rct(ctx, cx - k, y, Math.max(1, Math.round(k * 0.55)), 1, mix(cloth, [255, 236, 200], 0.20));
    rct(ctx, cx + Math.round(k * 0.40), y, k - Math.round(k * 0.40), 1, cloth2);
    if ((y - shoulderY) % 9 === 4) rct(ctx, cx - k + 2, y, k, 1, shade(cloth, 0.80));
  }
  // Belt.
  rct(ctx, cx - bodyW, hipY - 4, bodyW * 2, 4, [58, 40, 24]);
  rct(ctx, cx - bodyW, hipY - 4, bodyW * 2, 1, [110, 84, 50]);
  rct(ctx, cx - 3, hipY - 5, 6, 6, [176, 146, 72]);

  // Arms, hanging slightly out from the body.
  const armLen = Math.round(H * 0.34);
  for (const s of [-1, 1]) {
    const ax = cx + s * Math.round(bodyW * 1.05);
    const aw = Math.max(2, Math.round(bodyW * 0.42));
    for (let i = 0; i < armLen; i++) {
      const y = shoulderY + 2 + i;
      const c = i < armLen * 0.62 ? cloth : skin;
      const x0 = ax - (aw >> 1) + Math.round(s * i * 0.06);
      rct(ctx, x0, y, aw, 1, s < 0 ? c : shade(c, 0.78));
      rct(ctx, x0, y, 1, 1, mix(c, [255, 240, 210], 0.25));
    }
    // Hand.
    rct(ctx, ax - (aw >> 1), shoulderY + 2 + armLen, aw + 1, Math.max(2, aw - 1), skin);
  }
  // Shoulders catch the light.
  rct(ctx, cx - bodyW, shoulderY, Math.round(bodyW * 0.9), 1, mix(cloth, [255, 245, 220], 0.34));

  // Neck and head.
  rct(ctx, cx - 2, shoulderY - 3, 5, 4, shade(skin, 0.74));
  paintedHead(ctx, cx, baseY - H, headW, headH, {
    skin, hair: o.hair, hood: o.hood ? cloth : null, eye: o.eye,
  });
  if (o.hat) {
    const hw = Math.round(headW * 1.5);
    rct(ctx, cx - hw, baseY - H + 2, hw * 2, 2, shade(cloth, 0.5));
    for (let i = 0; i < Math.round(headH * 0.8); i++) {
      const k = Math.round(headW * 0.62 * (1 - i / (headH * 0.9)));
      rct(ctx, cx - k, baseY - H + 1 - i, k * 2, 1, i === 0 ? cloth : shade(cloth, 0.8));
    }
  }
}

// --- the paperdoll body -----------------------------------------------------

/**
 * The inventory paperdoll: a painted body, front on, arms out from the sides,
 * with anatomical anchors so equipment can be painted straight onto it. MM6
 * draws no slot chrome at all, so neither do we.
 */
export function paperdollAnchors(r) {
  const cx = Math.round(r.x + r.w / 2);
  const top = Math.round(r.y + 8);
  const H = r.h - 20;
  const headH = Math.round(H * 0.13);
  const headW = Math.round(H * 0.098);
  const shoulderY = top + headH + 3;
  const torsoH = Math.round(H * 0.30);
  const hipY = shoulderY + torsoH;
  const bodyW = Math.round(H * 0.115);
  const legH = Math.round(H * 0.42);
  const footY = hipY + legH;
  const armLen = Math.round(H * 0.34);
  const aw = Math.max(3, Math.round(bodyW * 0.42));
  const hands = {};
  for (const s of [-1, 1]) {
    hands[s < 0 ? 'left' : 'right'] = {
      x: cx + s * Math.round(bodyW * 1.06 + armLen * 0.16),
      y: shoulderY + 3 + armLen,
    };
  }
  return {
    cx, top, H, headH, headW, shoulderY, torsoH, hipY, bodyW, legH, footY, armLen, aw,
    head: { cx, cy: top + Math.round(headH * 0.5), w: headW * 2, h: headH },
    torso: { cx, cy: shoulderY + Math.round(torsoH * 0.45), w: bodyW * 2, h: torsoH },
    shoulders: { cx, y: shoulderY, w: bodyW * 2.2 },
    neck: { cx, y: shoulderY - 2 },
    waist: { cx, y: hipY - 2, w: bodyW * 2 },
    legs: { cx, y: hipY, h: legH, w: bodyW * 2 },
    feet: { cx, y: footY - 3, w: bodyW * 2.2 },
    hands,
  };
}

export function paperdollBody(ctx, r, o = {}) {
  const skin = o.skin || SKIN.mid;
  const tunic = o.tunic || [92, 74, 52];
  const trews = o.trews || [70, 56, 38];
  const A = paperdollAnchors(r);
  const { cx, top, H, headH, headW, shoulderY, torsoH, hipY, bodyW, legH, footY } = A;

  // Legs.
  for (const s of [-1, 1]) {
    const lx = cx + s * Math.round(bodyW * 0.48);
    for (let i = 0; i < legH; i++) {
      const t = i / legH;
      const k = Math.max(2, Math.round(bodyW * (0.46 - t * 0.14)));
      const c = t < 0.62 ? trews : skin;
      rct(ctx, lx - k, hipY + i, k * 2, 1, s < 0 ? c : shade(c, 0.88));
      rct(ctx, lx - k, hipY + i, Math.max(1, k), 1, mix(c, [255, 240, 210], 0.16));
      rct(ctx, lx + k - 1, hipY + i, 1, 1, shade(c, 0.62));
      if (t < 0.62 && (i % 11) === 5) rct(ctx, lx - k + 1, hipY + i, k, 1, shade(c, 0.80));
    }
    // Bare foot.
    rct(ctx, lx - Math.round(bodyW * 0.4), footY - 2, Math.round(bodyW * 0.9), 3, shade(skin, 0.82));
  }

  // Torso: chest wide, waist in, with a lit left flank.
  for (let i = 0; i < torsoH; i++) {
    const t = i / torsoH;
    const k = Math.round(bodyW * (1.02 - Math.sin(t * Math.PI) * 0.16));
    const y = shoulderY + i;
    rct(ctx, cx - k, y, k * 2, 1, tunic);
    rct(ctx, cx - k, y, Math.max(1, Math.round(k * 0.62)), 1, mix(tunic, [255, 240, 208], 0.20));
    rct(ctx, cx + Math.round(k * 0.38), y, k - Math.round(k * 0.38), 1, shade(tunic, 0.66));
    if ((i % 8) === 3) rct(ctx, cx - k + 2, y, Math.round(k * 1.2), 1, shade(tunic, 0.82));
  }
  rct(ctx, cx - bodyW, shoulderY, Math.round(bodyW * 1.1), 1, mix(tunic, [255, 248, 224], 0.4));
  // Waist cord.
  rct(ctx, cx - bodyW, hipY - 4, bodyW * 2, 4, [62, 44, 26]);
  rct(ctx, cx - bodyW, hipY - 4, bodyW * 2, 1, [116, 90, 54]);

  // Arms held slightly away from the body so a weapon can sit in the hand.
  const armLen = A.armLen;
  for (const s of [-1, 1]) {
    const aw = A.aw;
    for (let i = 0; i < armLen; i++) {
      const t = i / armLen;
      const ax = cx + s * Math.round(bodyW * 1.06 + i * 0.16);
      const c = t < 0.5 ? tunic : skin;
      rct(ctx, ax - (aw >> 1), shoulderY + 2 + i, aw, 1, s < 0 ? c : shade(c, 0.84));
      rct(ctx, ax - (aw >> 1), shoulderY + 2 + i, 1, 1, mix(c, [255, 244, 214], 0.28));
      rct(ctx, ax + (aw >> 1) - 1, shoulderY + 2 + i, 1, 1, shade(c, 0.6));
    }
    const hx = A.hands[s < 0 ? 'left' : 'right'].x;
    rct(ctx, hx - (aw >> 1) - 1, shoulderY + 2 + armLen, aw + 2, aw + 1, skin);
    rct(ctx, hx - (aw >> 1) - 1, shoulderY + 2 + armLen, aw + 2, 1, mix(skin, [255, 244, 214], 0.3));
  }

  // Neck, head.
  rct(ctx, cx - 3, shoulderY - 4, 7, 5, shade(skin, 0.72));
  paintedHead(ctx, cx, top, headW, headH, { skin, hair: o.hair, eye: o.eye });

  return A;
}

// --- painted spell sigils ---------------------------------------------------

/** Nine schools; ink, mid and lit tone for each. */
export const SIGIL_INK = {
  fire: ['#3a0e04', '#c4340c', '#ffb040'],
  air: ['#1b2c3c', '#5c86ac', '#d8ecff'],
  water: ['#0d1f3c', '#2a5aa8', '#8fc4f0'],
  earth: ['#20240e', '#6d7a2c', '#c4cc70'],
  spirit: ['#3a3008', '#b09420', '#ffe890'],
  mind: ['#2a1440', '#7a44b0', '#d8a8f0'],
  body: ['#0e2c12', '#2c8434', '#8ce084'],
  light: ['#4a4020', '#c8b060', '#fff4c0'],
  dark: ['#160c20', '#4a3060', '#9c7cc0'],
};

/**
 * The plaque a sigil is painted on. Four shapes, chosen by tier, so eleven
 * spells in one school are told apart at a glance before you read the motif.
 * `inside(dx, dy)` is the shape's own hard mask.
 */
function plaqueMask(shape, R) {
  switch (shape) {
    case 1: {                                   // cut square (octagon)
      const cut = R * 0.42;
      return (dx, dy) => Math.abs(dx) <= R && Math.abs(dy) <= R
        && Math.abs(dx) + Math.abs(dy) <= R * 2 - cut;
    }
    case 2:                                     // diamond
      return (dx, dy) => Math.abs(dx) + Math.abs(dy) <= R * 1.06;
    case 3:                                     // notched disc
      return (dx, dy) => {
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        return d <= R - (Math.cos(a * 6) > 0.72 ? R * 0.16 : 0);
      };
    default:
      return (dx, dy) => dx * dx + dy * dy <= R * R;
  }
}

function sigilCanvas(school, tier, s) {
  const P = SIGIL_INK[school] || SIGIL_INK.spirit;
  const ink = hexRGB(P[0]), mid = hexRGB(P[1]), lit = hexRGB(P[2]);
  const c = mkCanvas(s, s);
  const g = c.getContext('2d');
  const cx = s / 2, cy = s / 2;
  const R = s / 2 - 1;
  const shape = (tier + (school.length % 2)) % 4;
  const inside = plaqueMask(shape, R);

  // Every sigil is painted on a scorched plaque so 99 of them read as one set.
  // Painted pixel by pixel: no arcs, no strokes, no antialiasing.
  for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) {
    for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
      if (!inside(dx, dy)) continue;
      const inner = inside(dx + 1, dy) && inside(dx - 1, dy) && inside(dx, dy + 1) && inside(dx, dy - 1);
      const t = band(1 - (dy + R) / (2 * R), 5);
      let col = mix(shade(ink, 1.3), ink, 1 - t * 0.8);
      if (!inner) col = (dx + dy < 0) ? mix(mid, [255, 255, 255], 0.3) : shade(ink, 0.45);
      rct(g, Math.round(cx) + dx, Math.round(cy) + dy, 1, 1, col);
    }
  }

  // Motif: one shape family per school, varied per tier so 11 read apart.
  const v = tier % 11;
  const rays = 3 + (v % 6);
  const rot = (v * 0.37) % (Math.PI * 2);
  const stroke = (x0, y0, x1, y1, w, col) => {
    lineH(g, x0 + 1, y0 + 1, x1 + 1, y1 + 1, pc(ink), w);       // painted shadow
    lineH(g, x0, y0, x1, y1, pc(col), w);
  };
  const r2 = R * 0.66;

  switch (school) {
    case 'fire': {
      // One to three tongues over a fan of sparks; both counts move with tier.
      for (let i = 0; i < rays; i++) {
        const a = rot + (i / rays) * Math.PI * 2;
        stroke(cx + Math.cos(a) * r2 * 0.5, cy + Math.sin(a) * r2 * 0.5,
          cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 1, mid);
      }
      const n = 1 + (v % 3);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * r2 * 0.62;
        flame(g, cx + off, cy + r2 * 0.78, s * (0.34 - n * 0.04), s * (0.44 + (v % 4) * 0.07), v + i * 3);
      }
      break;
    }
    case 'air': {
      for (let i = 0; i < 3; i++) {
        const y = cy - r2 * 0.5 + i * r2 * 0.5;
        const wgt = r2 * (0.55 + ((v + i) % 3) * 0.22);
        stroke(cx - wgt, y, cx + wgt * 0.6, y, 2, i === 1 ? lit : mid);
        stroke(cx + wgt * 0.6, y, cx + wgt * 0.85, y - 3, 2, mid);
      }
      break;
    }
    case 'water': {
      for (let i = 0; i < 2 + (v % 3); i++) {
        const y = cy - r2 * 0.6 + i * (r2 * 1.2) / (2 + (v % 3));
        for (let x = -r2; x < r2; x += 2) {
          const yy = y + Math.sin((x + v) * 0.5) * 2;
          rct(g, Math.round(cx + x), Math.round(yy) + 1, 2, 2, pc(ink));
          rct(g, Math.round(cx + x), Math.round(yy), 2, 2, pc(i % 2 ? mid : lit));
        }
      }
      break;
    }
    case 'earth': {
      // Stacked strata, one course per tier band.
      const n = 2 + (v % 4);
      for (let i = 0; i < n; i++) {
        const hh = Math.round(r2 / n);
        const y = Math.round(cy + r2 - (i + 1) * hh);
        const wdt = Math.round(r2 * (1 - i * 0.16));
        rct(g, Math.round(cx - wdt), y + 1, wdt * 2, hh, pc(ink));
        rct(g, Math.round(cx - wdt), y, wdt * 2, hh - 1, pc(i % 2 ? mid : shade(mid, 0.78)));
        rct(g, Math.round(cx - wdt), y, wdt * 2, 1, pc(lit));
      }
      break;
    }
    case 'spirit': {
      stroke(cx, cy - r2, cx, cy + r2, 3, mid);
      stroke(cx - r2 * 0.7, cy - r2 * 0.25, cx + r2 * 0.7, cy - r2 * 0.25, 3, lit);
      for (let i = 0; i < (v % 4); i++) {
        const yy = cy + r2 * 0.35 + i * 3;
        stroke(cx - r2 * 0.35, yy, cx + r2 * 0.35, yy, 1, mid);
      }
      break;
    }
    case 'mind': {
      // A spiral wound tier-many turns.
      const turns = 1.4 + (v % 5) * 0.4;
      let px0 = cx, py0 = cy;
      for (let i = 1; i <= 40; i++) {
        const t = i / 40;
        const a = rot + t * Math.PI * 2 * turns;
        const rr = r2 * t;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        stroke(px0, py0, x, y, 2, t > 0.6 ? lit : mid);
        px0 = x; py0 = y;
      }
      break;
    }
    case 'body': {
      const arm = r2 * (0.65 + (v % 3) * 0.14);
      stroke(cx, cy - r2 * 0.8, cx, cy + r2 * 0.85, 3, mid);
      stroke(cx - arm, cy - r2 * 0.1, cx + arm, cy - r2 * 0.1, 3, lit);
      for (let i = 0; i < (v % 3); i++) {
        stroke(cx - arm * 0.6, cy + r2 * 0.4 + i * 3, cx + arm * 0.6, cy + r2 * 0.4 + i * 3, 1, mid);
      }
      break;
    }
    case 'light': {
      for (let i = 0; i < 4 + (v % 5); i++) {
        const a = rot + (i / (4 + (v % 5))) * Math.PI * 2;
        stroke(cx, cy, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 2, i % 2 ? lit : mid);
      }
      disc(g, cx + 1, cy + 1, r2 * 0.32, pc(ink));
      disc(g, cx, cy, r2 * 0.32, pc(lit));
      break;
    }
    default: {                                          // dark
      disc(g, cx + 1, cy + 1, r2 * 0.8, pc(shade(ink, 0.6)));
      disc(g, cx, cy, r2 * 0.8, pc(ink));
      for (let i = 0; i < rays; i++) {
        const a = rot + (i / rays) * Math.PI * 2;
        stroke(cx + Math.cos(a) * r2 * 0.85, cy + Math.sin(a) * r2 * 0.85,
          cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 2, mid);
      }
      // A crescent bitten out of the disc.
      disc(g, cx + r2 * 0.34, cy - r2 * 0.2, r2 * 0.55, pc(mid));
      disc(g, cx + r2 * 0.62, cy - r2 * 0.32, r2 * 0.5, pc(ink));
      break;
    }
  }

  // Pips punched round the rim: one more per tier, so the eleventh spell of a
  // school is legibly not the first even where the motifs are close.
  const pips = 1 + (tier % 5);
  for (let i = 0; i < pips; i++) {
    const a = -Math.PI / 2 + (i / pips) * Math.PI * 2 + tier * 0.2;
    const x = Math.round(cx + Math.cos(a) * R * 0.82), y = Math.round(cy + Math.sin(a) * R * 0.82);
    rct(g, x, y + 1, 2, 2, pc(shade(ink, 0.5)));
    rct(g, x, y, 2, 2, pc(lit));
  }

  // Cut the plaque back to its own silhouette - anything the motif pushed
  // outside the rim is clipped, hard, with no feathering.
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (!inside(x - Math.round(cx), y - Math.round(cy))) d[(y * s + x) * 4 + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** One painted sigil per spell: per-school motif, per-tier variation. */
export function spellSigil(ctx, school, tier, x, y, s = 24) {
  blit(ctx, cached(`sg:${school}:${tier}:${s}`, () => sigilCanvas(school, tier, s)), x, y);
}

/** The same sigil rendered flat grey, for a spell the character has not learned. */
export function spellSigilGhost(ctx, school, tier, x, y, s = 24) {
  const c = cached(`sgh:${school}:${tier}:${s}`, () => {
    const src = sigilCanvas(school, tier, s);
    const out = mkCanvas(s, s);
    const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, s, s);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const l = (d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15);
      const p = snapC(140 + l * 0.22, 126 + l * 0.22, 100 + l * 0.2);
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 90;
    }
    g.putImageData(img, 0, 0);
    return out;
  });
  blit(ctx, c, x, y);
}

// --- painted item bitmaps ---------------------------------------------------

const MAT = {
  steel: { d: [36, 42, 48], m: [104, 114, 122], l: [206, 216, 224] },
  iron: { d: [38, 38, 40], m: [104, 104, 108], l: [186, 188, 192] },
  bronze: { d: [64, 42, 18], m: [162, 116, 52], l: [238, 198, 122] },
  silver: { d: [70, 78, 86], m: [172, 182, 192], l: [244, 248, 252] },
  gold: { d: [84, 62, 12], m: [194, 158, 46], l: [252, 230, 140] },
  mithril: { d: [42, 62, 76], m: [126, 168, 196], l: [216, 240, 252] },
  wood: { d: [46, 30, 16], m: [116, 82, 46], l: [186, 148, 100] },
  leather: { d: [46, 30, 18], m: [110, 74, 42], l: [172, 128, 82] },
  bone: { d: [98, 90, 70], m: [186, 176, 148], l: [240, 234, 214] },
  cloth: { d: [40, 26, 44], m: [116, 74, 118], l: [186, 148, 190] },
  obsidian: { d: [16, 12, 22], m: [56, 46, 72], l: [124, 108, 152] },
  crystal: { d: [50, 74, 92], m: [140, 186, 212], l: [232, 248, 255] },
};
function matOf(name) { return MAT[name] || MAT.steel; }

/**
 * A blade: bright edge highlight down one side, a darker flat down the other,
 * a fuller cut into the middle, and a tapered point.
 */
function paintBlade(g, cx, top, len, wdt, M) {
  for (let i = 0; i < len; i++) {
    const t = i / len;
    // Point over the first fifth, then near-parallel with a slight taper.
    const k = Math.max(1, Math.round(wdt * (t < 0.18 ? t / 0.18 : 1 - (t - 0.18) * 0.10)));
    const y = top + i;
    // Most of the blade is the mid tone: a bright edge one pixel wide, a dark
    // flat two wide, and a fuller down the middle. Any more highlight and the
    // blade reads as a white stick.
    rct(g, cx - k, y, k * 2, 1, M.m);
    rct(g, cx - k, y, 1, 1, M.l);                     // lit edge
    rct(g, cx - k + 1, y, 1, 1, mix(M.m, M.l, 0.40));
    rct(g, cx + k - 2, y, 2, 1, M.d);                 // shadowed flat
    if (k > 2) rct(g, cx, y, 1, 1, shade(M.m, 0.70));  // fuller
  }
  // The point is a hard chevron, not a curve.
  rct(g, cx - 1, top - 1, 2, 1, M.l);
}

/** A wrapped grip: leather binding painted as alternating bands. */
function paintGrip(g, cx, top, len, wdt) {
  const L = MAT.leather;
  for (let i = 0; i < len; i++) {
    const y = top + i;
    const bandLit = (i % 3) === 0;
    rct(g, cx - wdt, y, wdt * 2, 1, bandLit ? L.m : shade(L.m, 0.72));
    rct(g, cx - wdt, y, 1, 1, L.l);
    rct(g, cx + wdt - 1, y, 1, 1, L.d);
  }
}

/**
 * Paint an item as a modelled object into a w x h box. `kind` is the icon
 * family; `mat` the material name; `accent` an optional gem/enchant colour.
 */
export function paintItem(g, kind, w, h, opts = {}) {
  const M = matOf(opts.mat);
  const W = MAT.wood, B = MAT.gold;
  const cx = Math.round(w / 2);
  const accent = opts.accent ? hexRGB(opts.accent) : [200, 40, 32];

  switch (kind) {
    case 'sword': case 'blade': case 'longsword': {
      const gripLen = Math.max(6, Math.round(h * 0.20));
      const bladeLen = h - gripLen - 6;
      paintBlade(g, cx, 2, bladeLen, Math.max(2, Math.round(w * 0.20)), M);
      const gy = 2 + bladeLen;
      rct(g, cx - Math.round(w * 0.34), gy, Math.round(w * 0.68), 3, B.m);      // crossguard
      rct(g, cx - Math.round(w * 0.34), gy, Math.round(w * 0.68), 1, B.l);
      rct(g, cx - Math.round(w * 0.34), gy + 2, Math.round(w * 0.68), 1, B.d);
      paintGrip(g, cx, gy + 3, gripLen, 2);
      rct(g, cx - 3, gy + 3 + gripLen, 6, 3, B.m);                              // pommel
      rct(g, cx - 3, gy + 3 + gripLen, 6, 1, B.l);
      rct(g, cx - 1, gy + 4 + gripLen, 2, 1, B.d);
      break;
    }
    case 'dagger': {
      const gripLen = Math.max(5, Math.round(h * 0.24));
      const bladeLen = h - gripLen - 6;
      paintBlade(g, cx, 3, bladeLen, Math.max(2, Math.round(w * 0.14)), M);
      const gy = 3 + bladeLen;
      rct(g, cx - Math.round(w * 0.22), gy, Math.round(w * 0.44), 2, B.m);
      rct(g, cx - Math.round(w * 0.22), gy, Math.round(w * 0.44), 1, B.l);
      paintGrip(g, cx, gy + 2, gripLen, 2);
      rct(g, cx - 2, gy + 2 + gripLen, 4, 2, B.m);
      break;
    }
    case 'axe': {
      const hx = cx - Math.round(w * 0.14);
      for (let y = 3; y < h - 2; y++) {
        rct(g, hx - 2, y, 4, 1, W.m);
        rct(g, hx - 2, y, 1, 1, W.l);
        rct(g, hx + 1, y, 1, 1, W.d);
      }
      // Bearded head: a solid mass with a bright bit and a dark cheek.
      const ay = 4, ah = Math.max(10, Math.round(h * 0.44));
      for (let i = 0; i < ah; i++) {
        const t = i / (ah - 1);
        const reach = Math.round((w - hx - 3) * (0.42 + 0.58 * Math.sin(t * Math.PI)));
        if (reach <= 0) continue;
        rct(g, hx + 2, ay + i, reach, 1, M.m);
        rct(g, hx + 2, ay + i, Math.max(1, Math.round(reach * 0.4)), 1, shade(M.m, 0.7));
        rct(g, hx + 2 + reach - 2, ay + i, 2, 1, M.l);         // bit
        rct(g, hx + 2, ay + i, 1, 1, M.d);
      }
      rct(g, hx - 4, ay + 3, 3, ah - 6, M.d);                   // poll
      rct(g, hx - 4, ay + 3, 3, 1, M.m);
      break;
    }
    case 'mace': {
      const hy = Math.round(h * 0.36);
      paintGrip(g, cx, hy, h - hy - 3, 2);
      rct(g, cx - 3, h - 3, 6, 3, B.m);
      const r = Math.max(4, Math.round(w * 0.28));
      for (let dy = -r; dy <= r; dy++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
        rct(g, cx - k, hy + dy, k * 2, 1, M.m);
        rct(g, cx - k, hy + dy, Math.max(1, Math.round(k * 0.7)), 1, mix(M.m, M.l, 0.35));
        rct(g, cx + k - 1, hy + dy, 1, 1, M.d);
      }
      rct(g, cx - r + 1, hy - r + 2, 2, 2, M.l);
      for (const [fx, fy] of [[-r - 2, -3], [r, -3], [-r - 2, 2], [r, 2]]) {
        rct(g, cx + fx, hy + fy, 3, 3, M.m);
        rct(g, cx + fx, hy + fy, 3, 1, M.l);
      }
      break;
    }
    case 'spear': {
      for (let y = 10; y < h - 2; y++) {
        rct(g, cx - 1, y, 3, 1, W.m);
        rct(g, cx - 1, y, 1, 1, W.l);
        rct(g, cx + 1, y, 1, 1, W.d);
      }
      paintBlade(g, cx, 1, 10, 3, M);
      rct(g, cx - 3, 11, 7, 2, B.m);
      rct(g, cx - 3, 11, 7, 1, B.l);
      rct(g, cx - 2, h - 3, 4, 3, M.d);
      break;
    }
    case 'staff': {
      for (let y = 7; y < h - 1; y++) {
        rct(g, cx - 2, y, 5, 1, W.m);
        rct(g, cx - 2, y, 1, 1, W.l);
        rct(g, cx + 2, y, 1, 1, W.d);
        if ((y % 13) === 0) rct(g, cx - 2, y, 5, 1, W.d);       // knot
      }
      // Head: a bound crook with a stone in it.
      rct(g, cx - 4, 4, 9, 4, MAT.leather.m);
      rct(g, cx - 4, 4, 9, 1, MAT.leather.l);
      disc(g, cx + 1, 3, 4, pc(shade(accent, 0.5)));
      disc(g, cx, 2, 3, pc(accent));
      rct(g, cx - 1, 1, 1, 1, [255, 255, 255]);
      break;
    }
    case 'bow': {
      // Limb: a real curve of painted wood, thickest at the riser.
      const bx = Math.round(w * 0.68);
      const midY = h / 2;
      for (let y = 2; y < h - 2; y++) {
        const t = (y - midY) / (h / 2 - 2);
        const x = Math.round(bx - (1 - t * t) * (w * 0.52));
        const th = Math.max(2, Math.round(3 - Math.abs(t) * 1.6));
        rct(g, x, y, th + 1, 1, W.m);
        rct(g, x, y, 1, 1, W.l);
        rct(g, x + th, y, 1, 1, W.d);
      }
      // Nocks and the string, drawn taut between them.
      const tipTop = Math.round(bx - 0 * 0), tipBot = tipTop;
      rct(g, tipTop - 1, 2, 3, 2, W.d);
      rct(g, tipBot - 1, h - 4, 3, 2, W.d);
      for (let y = 3; y < h - 3; y++) rct(g, bx, y, 1, 1, [224, 216, 184]);
      // Grip: leather wrap at the riser.
      const gy = Math.round(midY - 5);
      for (let i = 0; i < 10; i++) {
        const x = Math.round(bx - (w * 0.52));
        rct(g, x - 1, gy + i, 5, 1, (i % 3) ? MAT.leather.m : shade(MAT.leather.m, 0.7));
        rct(g, x - 1, gy + i, 1, 1, MAT.leather.l);
      }
      break;
    }
    case 'shield': {
      // Heater shield: flat top, straight sides, a hard point at the bottom.
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        const inset = t < 0.58 ? Math.round(t * 1.5) : Math.round(((t - 0.58) / 0.42) * (w / 2 - 2)) + 1;
        const x0 = 1 + inset, ww = w - 2 - inset * 2;
        if (ww <= 0) continue;
        rct(g, x0, y, ww, 1, M.m);
        rct(g, x0, y, Math.max(1, Math.round(ww * 0.34)), 1, mix(M.m, M.l, 0.42));
        rct(g, x0 + ww - 2, y, 2, 1, M.d);
      }
      rct(g, 2, 1, w - 4, 1, M.l);
      rct(g, 1, 0, w - 2, 1, M.d);
      // Boss, painted as a dome with a lit crown.
      const by = Math.round(h * 0.36);
      disc(g, cx + 1, by + 1, Math.round(w * 0.16), pc(M.d));
      disc(g, cx, by, Math.round(w * 0.16), pc(mix(M.m, M.l, 0.2)));
      rct(g, cx - 2, by - 3, 2, 2, M.l);
      break;
    }
    case 'helm': {
      const top = Math.round(h * 0.14);
      for (let y = top; y < h - 5; y++) {
        const t = (y - top) / (h - 5 - top);
        const k = Math.round((w / 2 - 2) * (0.44 + 0.56 * Math.sqrt(clamp(t * 1.4, 0, 1))));
        rct(g, cx - k, y, k * 2, 1, M.m);
        rct(g, cx - k, y, Math.max(1, Math.round(k * 0.55)), 1, mix(M.m, M.l, 0.4));
        rct(g, cx + k - 2, y, 2, 1, M.d);
      }
      rct(g, 2, h - 6, w - 4, 3, M.m);                         // brow band
      rct(g, 2, h - 6, w - 4, 1, M.l);
      rct(g, 2, h - 3, w - 4, 1, M.d);
      rct(g, cx - 1, top - 2, 3, h - top - 6, mix(M.m, M.l, 0.55)); // nasal
      rct(g, cx - 4, h - 12, 9, 5, [22, 18, 16]);              // eye slot
      break;
    }
    case 'armor': case 'chain': case 'plate': {
      const sh = Math.round(h * 0.13);
      const bw = w - 8;
      for (let y = sh; y < h - 3; y++) {
        const t = (y - sh) / (h - 3 - sh);
        const k = Math.round((bw / 2) * (1 - Math.sin(t * Math.PI) * 0.12));
        rct(g, cx - k, y, k * 2, 1, M.m);
        rct(g, cx - k, y, Math.max(1, Math.round(k * 0.6)), 1, mix(M.m, M.l, 0.3));
        rct(g, cx + k - 2, y, 2, 1, M.d);
      }
      // Pauldrons.
      for (const s of [-1, 1]) {
        const px0 = cx + s * Math.round(bw / 2) - (s < 0 ? 4 : 0);
        rct(g, px0 - 1, sh - 2, 6, 6, M.m);
        rct(g, px0 - 1, sh - 2, 6, 1, M.l);
      }
      if (kind === 'chain') {
        for (let y = sh + 4; y < h - 6; y += 3) {
          for (let x = cx - bw / 2 + 2; x < cx + bw / 2 - 2; x += 3) {
            rct(g, Math.round(x + (((y / 3) | 0) & 1)), y, 1, 1, M.d);
            rct(g, Math.round(x + (((y / 3) | 0) & 1)), y + 1, 1, 1, M.l);
          }
        }
      } else {
        for (let y = sh + 8; y < h - 6; y += 6) rct(g, cx - bw / 2 + 2, y, bw - 4, 1, M.d);
      }
      rct(g, cx - 4, sh + 2, 9, 3, B.m);
      rct(g, cx - 4, sh + 2, 9, 1, B.l);
      break;
    }
    case 'boots': {
      for (const s of [0, 1]) {
        const bw = Math.round((w - 6) / 2);
        const bx = 2 + s * (bw + 2);
        for (let y = 2; y < h - 5; y++) {
          rct(g, bx, y, bw, 1, MAT.leather.m);
          rct(g, bx, y, 1, 1, MAT.leather.l);
          rct(g, bx + bw - 1, y, 1, 1, MAT.leather.d);
          if ((y % 7) === 3) rct(g, bx + 1, y, bw - 2, 1, shade(MAT.leather.m, 0.75));
        }
        rct(g, bx - 1, h - 5, bw + 3, 3, MAT.leather.d);        // sole
        rct(g, bx - 1, h - 5, bw + 3, 1, MAT.leather.m);
        rct(g, bx, 2, bw, 2, M.m);                              // cuff trim
      }
      break;
    }
    case 'gauntlets': {
      for (const s of [0, 1]) {
        const bw = Math.round((w - 6) / 2);
        const bx = 2 + s * (bw + 2);
        rct(g, bx, 6, bw, h - 10, M.m);
        rct(g, bx, 6, Math.max(1, Math.round(bw * 0.4)), h - 10, mix(M.m, M.l, 0.32));
        rct(g, bx + bw - 2, 6, 2, h - 10, M.d);
        rct(g, bx - 1, 2, bw + 2, 5, M.m);                       // cuff
        rct(g, bx - 1, 2, bw + 2, 1, M.l);
        for (let f = 0; f < 3; f++) {
          rct(g, bx + 1 + f * 3, h - 5, 2, 4, M.m);
          rct(g, bx + 1 + f * 3, h - 5, 1, 4, M.l);
        }
      }
      break;
    }
    case 'belt': {
      const by = Math.round((h - 7) / 2);
      for (let i = 0; i < 7; i++) {
        rct(g, 1, by + i, w - 2, 1, i < 2 ? MAT.leather.l : i > 4 ? MAT.leather.d : MAT.leather.m);
      }
      for (let x = 4; x < w - 4; x += 6) rct(g, x, by + 3, 1, 1, shade(MAT.leather.d, 0.8));
      rct(g, cx - 5, by - 2, 10, 11, B.m);
      rct(g, cx - 5, by - 2, 10, 1, B.l);
      rct(g, cx - 2, by + 1, 4, 5, [24, 20, 16]);
      break;
    }
    case 'cloak': {
      const C = MAT.cloth;
      for (let y = 3; y < h - 1; y++) {
        const t = y / h;
        const k = Math.round((w / 2 - 1) * (0.34 + t * 0.66));
        rct(g, cx - k, y, k * 2, 1, C.m);
        rct(g, cx - k, y, Math.max(1, Math.round(k * 0.5)), 1, mix(C.m, C.l, 0.28));
        rct(g, cx + Math.round(k * 0.4), y, k - Math.round(k * 0.4), 1, C.d);
        // Vertical folds falling from the shoulders.
        if (((y * 3) % 11) === 0) rct(g, cx - Math.round(k * 0.5), y, Math.round(k), 1, shade(C.m, 0.8));
      }
      rct(g, cx - 7, 2, 15, 3, B.m);
      rct(g, cx - 7, 2, 15, 1, B.l);
      break;
    }
    case 'amulet': {
      for (let i = -8; i <= 8; i++) {
        rct(g, cx + i, 3 + Math.round(Math.abs(i) * 0.42), 1, 1, i < 0 ? B.l : B.m);
      }
      const r = Math.max(4, Math.round(Math.min(w, h) * 0.24));
      const ay = h - r - 3;
      disc(g, cx + 1, ay + 1, r, pc(shade(accent, 0.4)));
      disc(g, cx, ay, r, pc(accent));
      disc(g, cx - Math.round(r * 0.3), ay - Math.round(r * 0.3), Math.max(1, Math.round(r * 0.35)),
        pc(mix(accent, [255, 255, 255], 0.7)));
      break;
    }
    case 'ring': {
      const r = Math.max(4, Math.round(Math.min(w, h) / 2 - 3));
      const ry = Math.round(h / 2 + 2);
      for (let dy = -r; dy <= r; dy++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
        rct(g, cx - k, ry + dy, 2, 1, B.l);
        rct(g, cx + k - 2, ry + dy, 2, 1, B.d);
      }
      rct(g, cx - r, ry - r, r * 2, 2, B.m);
      disc(g, cx, ry - r - 2, 3, pc(accent));
      rct(g, cx - 1, ry - r - 3, 1, 1, [255, 255, 255]);
      break;
    }
    case 'potion': {
      const liq = opts.accent ? hexRGB(opts.accent) : [192, 40, 24];
      const bw = Math.max(7, Math.round(w * 0.68));
      rct(g, cx - 2, 1, 5, 4, MAT.wood.m);                      // cork
      rct(g, cx - 2, 1, 5, 1, MAT.wood.l);
      rct(g, cx - 3, 5, 7, 2, [186, 206, 210]);                 // lip
      for (let y = 7; y < h - 1; y++) {
        const t = (y - 7) / (h - 8);
        const k = Math.max(2, Math.round((bw / 2) * clamp(0.4 + t * 1.6, 0, 1)));
        const inLiquid = t > 0.34;
        rct(g, cx - k, y, k * 2, 1, inLiquid ? liq : [176, 198, 204]);
        rct(g, cx - k, y, 1, 1, [214, 232, 238]);
        rct(g, cx + k - 1, y, 1, 1, inLiquid ? shade(liq, 0.5) : [110, 130, 138]);
        if (inLiquid && ((y % 5) === 0)) rct(g, cx - k + 2, y, 2, 1, mix(liq, [255, 255, 255], 0.4));
      }
      rct(g, cx + 1, h - 7, 1, 4, [255, 255, 255]);             // specular
      break;
    }
    case 'scroll': {
      const S = MAT.bone;
      rct(g, 3, 3, w - 6, h - 6, S.l);
      for (let y = 4; y < h - 4; y++) rct(g, 3, y, 1, 1, S.m);
      rct(g, 3, 3, w - 6, 1, [255, 252, 240]);
      rct(g, 3, h - 4, w - 6, 1, S.m);
      for (let y = 7; y < h - 7; y += 3) rct(g, 6, y, w - 14, 1, [92, 74, 48]);
      // Rolled ends: a stack of hard bands, not a soft cylinder.
      for (const x0 of [0, w - 4]) {
        for (let y = 1; y < h - 1; y++) {
          rct(g, x0, y, 4, 1, (y & 1) ? S.m : S.l);
        }
        rct(g, x0, 1, 1, h - 2, S.d);
      }
      rct(g, cx - 3, h - 7, 6, 4, [168, 30, 24]);               // wax seal
      rct(g, cx - 3, h - 7, 6, 1, [220, 90, 70]);
      break;
    }
    case 'wand': {
      for (let y = 7; y < h - 2; y++) {
        rct(g, cx - 1, y, 3, 1, MAT.wood.m);
        rct(g, cx - 1, y, 1, 1, MAT.wood.l);
        rct(g, cx + 1, y, 1, 1, MAT.wood.d);
      }
      rct(g, cx - 2, h - 4, 5, 3, B.m);
      disc(g, cx + 1, 5, 4, pc(shade(accent, 0.45)));
      disc(g, cx, 4, 4, pc(accent));
      rct(g, cx - 2, 2, 2, 2, [255, 255, 255]);
      break;
    }
    case 'book': case 'spellbook': {
      rct(g, 2, 2, w - 4, h - 4, [104, 26, 22]);                // cover
      rct(g, 2, 2, w - 4, 1, [156, 56, 46]);
      rct(g, 2, 2, 4, h - 4, [72, 16, 14]);                     // spine
      rct(g, 6, 4, w - 10, h - 8, [222, 210, 176]);             // page block
      for (let y = 5; y < h - 5; y += 2) rct(g, 6, y, w - 10, 1, [198, 184, 148]);
      rct(g, 6, 4, w - 10, 1, [246, 240, 216]);
      rct(g, w - 8, Math.round(h / 2) - 3, 5, 6, B.m);          // clasp
      rct(g, w - 8, Math.round(h / 2) - 3, 5, 1, B.l);
      break;
    }
    case 'gem': {
      const r = Math.min(w, h) / 2 - 1;
      // A cut stone: a table facet on top, pavilion below, hard facet edges.
      for (let y = 0; y < h - 1; y++) {
        const t = y / (h - 2);
        const k = Math.max(1, Math.round(r * (t < 0.3 ? 0.45 + t * 1.8 : 1 - (t - 0.3) * 1.35)));
        rct(g, cx - k, y + 1, k * 2, 1, t < 0.3 ? mix(accent, [255, 255, 255], 0.35) : accent);
        rct(g, cx + k - 2, y + 1, 2, 1, shade(accent, 0.5));
      }
      rct(g, cx - 2, 2, 3, 2, [255, 255, 255]);
      lineH(g, cx - r * 0.6, h * 0.32, cx, h - 3, pc(shade(accent, 0.62)), 1);
      lineH(g, cx + r * 0.6, h * 0.32, cx, h - 3, pc(mix(accent, [255, 255, 255], 0.25)), 1);
      break;
    }
    case 'gold': {
      for (let i = 0; i < 7; i++) {
        const gx = 1 + ((i * 5) % Math.max(1, w - 10));
        const gy = h - 5 - ((i % 3) * 4);
        for (let dy = 0; dy < 4; dy++) {
          const k = Math.round(4 * Math.sqrt(Math.max(0, 1 - ((dy - 1.5) / 2.4) ** 2)));
          rct(g, gx + 4 - k, gy + dy, k * 2, 1, dy === 0 ? B.l : dy === 3 ? B.d : B.m);
        }
      }
      break;
    }
    case 'reagent': default: {
      const F = [56, 88, 40], Fl = [128, 172, 88];
      rct(g, cx - 1, Math.round(h * 0.35), 3, Math.round(h * 0.6), F);
      rct(g, cx - 1, Math.round(h * 0.35), 1, Math.round(h * 0.6), Fl);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          rct(g, cx + s * (1 + i), Math.round(h * 0.34) - i * 2, 2, 2, i < 2 ? Fl : F);
        }
      }
      disc(g, cx, Math.round(h * 0.22), Math.max(2, Math.round(w * 0.2)), pc(accent));
      rct(g, cx - 1, Math.round(h * 0.16), 1, 1, [255, 255, 255]);
      break;
    }
  }
}

/** Ring the painted pixels in near-black, the way MM6's item bitmaps are cut. */
export function outlineArt(g, w, h) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      const near = (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1])
        || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w]);
      if (!near) continue;
      const p = i * 4;
      d[p] = 12; d[p + 1] = 10; d[p + 2] = 8; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Cached item bitmap. */
export function itemArt(kind, w, h, opts = {}) {
  const key = `ia:${kind}:${w}x${h}:${opts.mat || ''}:${opts.accent || ''}`;
  return cached(key, () => {
    const c = mkCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    paintItem(g, kind, w, h, opts);
    outlineArt(g, w, h);
    return c;
  });
}

/** Draw an item bitmap centred on (cx, cy) at roughly `s` pixels tall. */
export function drawItemArt(ctx, kind, cx, cy, s, opts = {}) {
  const ar = ITEM_ASPECT[kind] || 0.62;
  const h = Math.max(8, Math.round(s));
  const w = Math.max(6, Math.round(s * ar));
  blit(ctx, itemArt(kind, w, h, opts), Math.round(cx - w / 2), Math.round(cy - h / 2));
}

/** Width : height for each family, so nothing is drawn square by accident. */
export const ITEM_ASPECT = {
  sword: 0.34, blade: 0.34, longsword: 0.32, dagger: 0.36, axe: 0.66, mace: 0.5,
  spear: 0.26, staff: 0.30, bow: 0.72, shield: 0.82, helm: 0.88, armor: 0.82,
  chain: 0.82, plate: 0.82, boots: 0.9, gauntlets: 0.9, belt: 1.5, cloak: 0.78,
  amulet: 0.86, ring: 0.86, potion: 0.62, scroll: 1.5, wand: 0.36, book: 0.9,
  spellbook: 0.9, gem: 0.86, gold: 1.2, reagent: 0.7,
};
