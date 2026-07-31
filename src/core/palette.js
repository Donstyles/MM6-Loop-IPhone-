// ---------------------------------------------------------------------------
// The MM6 palette.
//
// Might and Magic VI ran in 8-bit indexed colour. Every texture, sprite and the
// framebuffer itself were palettised, and the software rasteriser dithered its
// gradients (skies, fog, coloured lighting) with an ordered pattern. That
// combination - a limited earth-toned palette plus visible ordered dithering -
// is the single strongest visual signature of the game, so we reproduce it
// exactly rather than approximating with truecolour.
//
// The palette below is 16 ramps of 16 shades. Ramps are interpolated in linear
// light with a slight hue rotation (dark end cooler and more saturated, light
// end warmer and desaturated) which is how hand-authored VGA palettes of the
// era were built and is what gives the shading its characteristic warmth.
// ---------------------------------------------------------------------------

const RAMPS = [
  // name              dark      light     hueShift  sat curve
  ['grey', 0x08080a, 0xf0f0ee, 0.00, 1.00],
  ['stone', 0x171b21, 0xbcc3c9, -0.02, 0.95],
  ['plaster', 0x241f18, 0xded2be, 0.02, 0.95],
  ['dirt', 0x1c1208, 0xb08a5c, 0.01, 1.05],
  ['wood', 0x140c06, 0x8a6238, 0.01, 1.10],
  ['sand', 0x3a2c18, 0xf0dfae, 0.02, 1.00],
  ['grass', 0x10180a, 0xa8bc62, 0.03, 1.05],
  ['foliage', 0x050d05, 0x4e7a34, 0.02, 1.15],
  ['swamp', 0x14160a, 0x8c8a4a, 0.01, 1.00],
  ['sky', 0x253a52, 0xcfe2f2, -0.01, 0.85],
  ['water', 0x04101e, 0x3f7aa8, -0.02, 1.10],
  ['ice', 0x10262e, 0xcfeef2, -0.01, 0.90],
  ['blood', 0x1a0404, 0xd83828, 0.00, 1.20],
  ['fire', 0x2a0c02, 0xffc040, 0.03, 1.25],
  ['gold', 0x302200, 0xffe98a, 0.02, 1.15],
];

// The 16th ramp is split: 8 flesh tones + 8 arcane purples.
const SPLIT = [
  [0x2a140c, 0xf0c8a0, 8],  // flesh
  [0x180628, 0xc078e8, 8],  // arcane
];

function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

function unpack(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

function buildRamp(darkHex, lightHex, steps, hueShift = 0, satCurve = 1) {
  const a = unpack(darkHex), b = unpack(lightHex);
  const [ha, sa] = rgbToHsl(a[0], a[1], a[2]);
  const [hb, sb] = rgbToHsl(b[0], b[1], b[2]);
  const al = a.map(srgbToLin), bl = b.map(srgbToLin);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    // Perceptual ease: more resolution in the shadows, like VGA ramps.
    const te = Math.pow(t, 1.12);
    const lin = [0, 1, 2].map((c) => al[c] + (bl[c] - al[c]) * te);
    let [r, g, bb] = lin.map(linToSrgb);
    // Rotate hue and bend saturation across the ramp.
    let [h, s, l] = rgbToHsl(r, g, bb);
    let hueTarget = ha + (hb - ha) * te + hueShift * (1 - te);
    let satTarget = (sa + (sb - sa) * te) * (1 + (satCurve - 1) * (1 - te));
    [r, g, bb] = hslToRgb(hueTarget, Math.min(1, Math.max(0, satTarget)), l);
    out.push([
      Math.round(Math.min(255, Math.max(0, r * 255))),
      Math.round(Math.min(255, Math.max(0, g * 255))),
      Math.round(Math.min(255, Math.max(0, bb * 255))),
    ]);
  }
  return out;
}

/** @type {number[][]} 256 entries of [r,g,b] 0-255 */
export const PALETTE = [];
/** Named index of the first entry of each ramp, for art code that wants a family. */
export const RAMP_INDEX = {};

for (const [name, dark, light, hueShift, satCurve] of RAMPS) {
  RAMP_INDEX[name] = PALETTE.length;
  const ramp = buildRamp(dark, light, 16, hueShift, satCurve);
  for (const c of ramp) PALETTE.push(c);
}
RAMP_INDEX.flesh = PALETTE.length;
for (const c of buildRamp(SPLIT[0][0], SPLIT[0][1], SPLIT[0][2], 0.01, 1.05)) PALETTE.push(c);
RAMP_INDEX.arcane = PALETTE.length;
for (const c of buildRamp(SPLIT[1][0], SPLIT[1][1], SPLIT[1][2], 0.0, 1.2)) PALETTE.push(c);

if (PALETTE.length !== 256) {
  // Pad/trim defensively so downstream texture sizes stay fixed.
  while (PALETTE.length < 256) PALETTE.push([0, 0, 0]);
  PALETTE.length = 256;
}

/** Fetch a ramp shade: shade 0 = darkest, 15 = lightest. */
export function ramp(name, shade) {
  const base = RAMP_INDEX[name];
  if (base === undefined) return PALETTE[0];
  const len = name === 'flesh' || name === 'arcane' ? 8 : 16;
  const i = base + Math.max(0, Math.min(len - 1, Math.round(shade)));
  return PALETTE[i];
}

/** Ramp shade as a CSS colour string. */
export function rampCss(name, shade, alpha = 1) {
  const c = ramp(name, shade);
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** Ramp shade as a 0xRRGGBB number (for three.js Color). */
export function rampHex(name, shade) {
  const c = ramp(name, shade);
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// --- Nearest-colour lookup -------------------------------------------------
// Weighted euclidean distance in a roughly perceptual space. Green is weighted
// most heavily, which keeps foliage and grass from drifting into greys.
const W_R = 0.30, W_G = 0.59, W_B = 0.11;

export function nearestIndex(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 256; i++) {
    const p = PALETTE[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = W_R * dr * dr + W_G * dg * dg + W_B * db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Snap a colour to the palette, returning [r,g,b]. */
export function snap(r, g, b) { return PALETTE[nearestIndex(r, g, b)]; }

// --- Ordered dither --------------------------------------------------------
// Classic 8x8 Bayer matrix, normalised to [-0.5, 0.5].
export const BAYER8 = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = m[y][x] / 64 - 0.5;
  return out;
})();

const BAYER4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

/**
 * Palettise an ImageData in place with ordered dithering.
 * Used on every procedurally generated texture so the source art itself is
 * genuinely 8-bit, not just the final frame.
 * @param {ImageData} img
 * @param {number} amount dither strength in palette-step units (0 disables)
 */
export function ditherImageData(img, amount = 14) {
  const { data, width, height } = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const t = (BAYER4[y & 3][x & 3] / 16 - 0.46875) * amount;
      const p = PALETTE[nearestIndex(
        Math.max(0, Math.min(255, data[i] + t)),
        Math.max(0, Math.min(255, data[i + 1] + t)),
        Math.max(0, Math.min(255, data[i + 2] + t)),
      )];
      data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
    }
  }
  return img;
}

/** Palettise without dithering - for UI chrome where dither would look noisy. */
export function quantizeImageData(img) {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const p = PALETTE[nearestIndex(data[i], data[i + 1], data[i + 2])];
    data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
  }
  return img;
}

// --- GPU lookup table ------------------------------------------------------
// A 32^3 RGB cube where each cell holds the nearest palette colour. Sampled
// with NEAREST filtering in the post pass, preceded by an ordered dither, this
// reproduces 8-bit output on the GPU for the cost of one texture fetch.
export const LUT_SIZE = 48;

let _lutData = null;
export function buildPaletteLUT() {
  if (_lutData) return _lutData;
  const N = LUT_SIZE;
  const data = new Uint8Array(N * N * N * 4);
  // Cache nearest lookups on a coarse grid; the palette is small enough that
  // brute force over 32k cells is ~50ms, which is fine at load time.
  let o = 0;
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const p = PALETTE[nearestIndex(
          (r / (N - 1)) * 255,
          (g / (N - 1)) * 255,
          (b / (N - 1)) * 255,
        )];
        data[o++] = p[0]; data[o++] = p[1]; data[o++] = p[2]; data[o++] = 255;
      }
    }
  }
  _lutData = data;
  return data;
}

/** Debug helper: render the palette to a canvas. */
export function paletteSwatchCanvas(cell = 8) {
  const c = document.createElement('canvas');
  c.width = 16 * cell; c.height = 16 * cell;
  const g = c.getContext('2d');
  for (let i = 0; i < 256; i++) {
    const p = PALETTE[i];
    g.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`;
    g.fillRect((i % 16) * cell, Math.floor(i / 16) * cell, cell, cell);
  }
  return c;
}
