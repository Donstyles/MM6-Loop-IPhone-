import * as THREE from 'three';
import { PALETTE, nearestIndex, ditherImageData, quantizeImageData, ramp } from '../core/palette.js';
import { hash2, tileFbm2, tileNoise2, tileWorley2, Rand, clamp, smoothstep } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Procedural texture toolkit.
//
// Every surface in the game is painted here at MM6's native texture sizes
// (mostly 64x64, some 128x128) into an offscreen canvas, palettised, and handed
// to three.js with nearest magnification. Nothing is loaded from disk.
// ---------------------------------------------------------------------------

export function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.width = w; c.height = h;
  return c;
}

export function ctx2d(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return g;
}

/** A blank RGBA pixel buffer with helpers, easier than canvas for per-pixel art. */
export class Pix {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  idx(x, y) { return (((y % this.h) + this.h) % this.h) * this.w * 4 + ((((x % this.w) + this.w) % this.w) * 4); }
  set(x, y, r, g, b, a = 255) {
    const i = this.idx(x, y);
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  setArr(x, y, c, a = 255) { this.set(x, y, c[0], c[1], c[2], a); }
  get(x, y) {
    const i = this.idx(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  fill(r, g, b, a = 255) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
    }
  }
  /** Multiply a pixel's RGB by a scalar - the workhorse for shading detail. */
  shade(x, y, k) {
    const i = this.idx(x, y);
    this.data[i] *= k; this.data[i + 1] *= k; this.data[i + 2] *= k;
  }
  toImageData() {
    if (typeof ImageData !== 'undefined') return new ImageData(this.data, this.w, this.h);
    const c = makeCanvas(this.w, this.h); const g = ctx2d(c);
    const d = g.createImageData(this.w, this.h); d.data.set(this.data); return d;
  }
  toCanvas() {
    const c = makeCanvas(this.w, this.h);
    ctx2d(c).putImageData(this.toImageData(), 0, 0);
    return c;
  }
}

/** Sample a colour ramp with a continuous shade value, blending between steps. */
export function rampSample(name, t, steps = 16) {
  const s = clamp(t, 0, 1) * (steps - 1);
  const a = ramp(name, Math.floor(s));
  const b = ramp(name, Math.min(steps - 1, Math.floor(s) + 1));
  const f = s - Math.floor(s);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Mix two [r,g,b]s. */
export function mixC(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleC(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/**
 * Build a three.js texture from a Pix / canvas.
 * @param {Pix|HTMLCanvasElement} src
 * @param {object} opts
 */
export function toTexture(src, opts = {}) {
  const {
    // MM6's software renderer did not dither, and neither did its texture art:
    // it shaded by swapping between 32 pre-darkened palettes, so its surfaces
    // band in steps and their fine detail is painted noise, not a screen-space
    // pattern. An ordered dither over every texture put a visible checkerboard
    // across sky, foliage and masonry alike - the single most modern-looking
    // thing in the frame. Quantise straight to the palette and let it band.
    dither = 0,
    quantise = true,
    repeat = true,
    mips = true,
    anisotropy = 4,
    magNearest = true,
  } = opts;

  let canvas;
  if (src instanceof Pix) {
    const img = src.toImageData();
    if (quantise) (dither > 0 ? ditherImageData(img, dither) : quantizeImageData(img));
    canvas = makeCanvas(src.w, src.h);
    ctx2d(canvas).putImageData(img, 0, 0);
  } else {
    canvas = src;
    if (quantise) {
      const g = ctx2d(canvas);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      dither > 0 ? ditherImageData(img, dither) : quantizeImageData(img);
      g.putImageData(img, 0, 0);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = magNearest ? THREE.NearestFilter : THREE.LinearFilter;
  // Mips keep distant ground from boiling; nearest magnification keeps the
  // chunky look up close. That mirrors how MM6 looked in its D3D mode.
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = mips;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// --- Common surface patterns ----------------------------------------------

/**
 * Fill a Pix with tiling grain: a few octaves of value noise turned into a
 * ramp lookup. This is the base of nearly every terrain texture.
 */
export function grainFill(pix, rampName, opts = {}) {
  const {
    period = 8, octaves = 4, gain = 0.55, seed = 1,
    lo = 0.25, hi = 0.95, contrast = 1, scale = 1,
  } = opts;
  const { w, h } = pix;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = tileFbm2((x / w) * period * scale, (y / h) * period * scale, period * scale, octaves, gain, seed);
      n = clamp((n - 0.5) * contrast + 0.5, 0, 1);
      const c = rampSample(rampName, lo + n * (hi - lo));
      pix.setArr(x, y, c);
    }
  }
  return pix;
}

/** Sprinkle single-pixel speckles - grit, mica, gravel. */
export function speckle(pix, count, colorFn, seed = 3) {
  const rnd = new Rand(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd.int(pix.w), y = rnd.int(pix.h);
    const c = colorFn(rnd, x, y);
    if (c) pix.setArr(x, y, c);
  }
  return pix;
}

/**
 * Draw a tiling brick/block course.
 * @param {Pix} pix
 * @param {object} o rows, cols, mortar, offsetPerRow, jitter, colorFn
 */
export function bricks(pix, o = {}) {
  const {
    rows = 4, cols = 2, mortarW = 1, offset = 0.5,
    mortar = [58, 54, 48], seed = 7,
    faceFn = null,
    bevel = 0.35,
  } = o;
  const { w, h } = pix;
  const bh = h / rows;
  const rnd = new Rand(seed);
  // Pre-roll a per-brick tone so each block reads as its own stone.
  const tones = [];
  for (let r = 0; r < rows; r++) {
    tones[r] = [];
    for (let c = 0; c < cols + 2; c++) tones[r][c] = rnd.float(0.82, 1.14);
  }

  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / bh);
    const yInRow = y - row * bh;
    const rowOff = ((row * offset) % 1) * (w / cols);
    for (let x = 0; x < w; x++) {
      const bx = (x + rowOff) % w;
      const col = Math.floor(bx / (w / cols));
      const xInCol = bx - col * (w / cols);
      const bw = w / cols;

      const inMortar = yInRow < mortarW || xInCol < mortarW;
      if (inMortar) {
        const n = tileNoise2(x * 0.6, y * 0.6, 64, seed + 11);
        pix.setArr(x, y, scaleC(mortar, 0.8 + n * 0.5));
        continue;
      }
      const u = (xInCol - mortarW) / (bw - mortarW);
      const v = (yInRow - mortarW) / (bh - mortarW);
      let c = faceFn ? faceFn(x, y, u, v, row, col, tones[row][col % (cols + 2)])
        : rampSample('stone', 0.35 + tileFbm2(x * 0.12, y * 0.12, 16, 3, 0.5, seed) * 0.3);
      // Lit top-left edge, shadowed bottom-right - MM6's blocks all read this way.
      const edge = Math.min(u, v) < 0.10 ? 1 + bevel : (Math.max(u, v) > 0.90 ? 1 - bevel * 0.8 : 1);
      pix.setArr(x, y, scaleC(c, edge * tones[row][col % (cols + 2)]));
    }
  }
  return pix;
}

/** Vertical wood planks with grain and nail heads. */
export function planks(pix, o = {}) {
  const { count = 4, seed = 5, horizontal = false, rampName = 'wood' } = o;
  const { w, h } = pix;
  const rnd = new Rand(seed);
  const span = (horizontal ? h : w) / count;
  const tone = [];
  for (let i = 0; i < count; i++) tone[i] = rnd.float(0.8, 1.18);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const along = horizontal ? x : y;
      const across = horizontal ? y : x;
      const p = Math.floor(across / span);
      const u = (across - p * span) / span;
      // Long stretched grain along the plank.
      let g = tileFbm2(along * 0.06, across * 0.9 + p * 13, 64, 4, 0.55, seed + p);
      g += 0.28 * tileNoise2(along * 0.02, across * 2.4, 64, seed + 99);
      let c = rampSample(rampName, 0.30 + g * 0.55);
      const edge = (u < 0.06 || u > 0.94) ? 0.62 : (u < 0.14 ? 1.18 : 1);
      pix.setArr(x, y, scaleC(c, edge * tone[p]));
    }
  }
  return pix;
}

/**
 * Apply a soft directional emboss based on a height field, which is how we get
 * the chiselled look on stone and the raised look on UI chrome.
 */
export function emboss(pix, heightFn, strength = 0.5) {
  const { w, h } = pix;
  const out = new Uint8ClampedArray(pix.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hl = heightFn((x - 1 + w) % w, y);
      const hr = heightFn((x + 1) % w, y);
      const hu = heightFn(x, (y - 1 + h) % h);
      const hd = heightFn(x, (y + 1) % h);
      // Light from the upper left, the convention MM6 art uses throughout.
      const k = 1 + ((hl - hr) + (hu - hd)) * strength;
      const i = pix.idx(x, y);
      out[i] = pix.data[i] * k;
      out[i + 1] = pix.data[i + 1] * k;
      out[i + 2] = pix.data[i + 2] * k;
    }
  }
  pix.data.set(out);
  return pix;
}

/** Multiply in a large-scale blotch pattern - weathering, damp, moss. */
export function blotch(pix, o = {}) {
  const { period = 3, seed = 21, color = null, amount = 0.35, threshold = 0.55, soft = 0.2 } = o;
  const { w, h } = pix;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = tileFbm2((x / w) * period, (y / h) * period, period, 3, 0.6, seed);
      const m = smoothstep(threshold, threshold + soft, n) * amount;
      if (m <= 0) continue;
      const cur = pix.get(x, y);
      const tgt = color || [cur[0] * 0.6, cur[1] * 0.7, cur[2] * 0.55];
      pix.setArr(x, y, mixC(cur, tgt, m));
    }
  }
  return pix;
}

/** Cracks: thin dark lines following a worley cell structure. */
export function cracks(pix, o = {}) {
  const { period = 5, seed = 31, width = 0.06, darkness = 0.45 } = o;
  const { w, h } = pix;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { f1, f2 } = tileWorley2((x / w) * period, (y / h) * period, period, seed);
      const edge = f2 - f1;
      if (edge < width) {
        const k = 1 - (1 - edge / width) * darkness;
        pix.shade(x, y, k);
      }
    }
  }
  return pix;
}

/** Hard vertical/horizontal gradient multiply, used for floors and ceilings. */
export function gradientShade(pix, fn) {
  for (let y = 0; y < pix.h; y++) {
    for (let x = 0; x < pix.w; x++) pix.shade(x, y, fn(x / pix.w, y / pix.h));
  }
  return pix;
}

/** Build a texture atlas canvas from a list of Pix, returns {canvas, uvs}. */
export function packAtlas(items, cell) {
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const canvas = makeCanvas(cols * cell, rows * cell);
  const g = ctx2d(canvas);
  const uvs = [];
  items.forEach((pix, i) => {
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    g.putImageData(pix.toImageData(), cx, cy);
    uvs.push({ x: cx / canvas.width, y: cy / canvas.height, w: cell / canvas.width, h: cell / canvas.height });
  });
  return { canvas, uvs, cols, rows };
}

export { PALETTE, nearestIndex, ramp, hash2, tileFbm2, tileNoise2, tileWorley2, Rand, clamp, smoothstep };
