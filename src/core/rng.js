// Deterministic pseudo-random utilities. Everything in the game world is
// generated from seeds so a given world is reproducible across sessions.

/** mulberry32 - fast, decent quality, 32-bit seeded PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit integer seed. */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer hash for lattice noise: 2D -> [0,1). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Integer hash 3D -> [0,1). */
export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Value noise in 2D, seeded, output in [0,1]. */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Gradient (Perlin-style) noise in 2D, output roughly in [-1,1]. */
export function gradNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  function grad(ix, iy, dx, dy) {
    const a = hash2(ix, iy, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  }
  const n00 = grad(xi, yi, xf, yf);
  const n10 = grad(xi + 1, yi, xf - 1, yf);
  const n01 = grad(xi, yi + 1, xf, yf - 1);
  const n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Fractal Brownian motion over gradient noise. Output roughly [-1,1]. */
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradNoise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal - good for mountains and rock striations. */
export function ridged2(x, y, octaves = 4, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(gradNoise2(x * freq, y * freq, seed + i * 977));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Tileable value-noise: wraps seamlessly on a `period` x `period` lattice.
 * Essential for texture generation - MM6 textures all tile.
 */
export function tileNoise2(x, y, period, seed = 0) {
  const wrap = (i) => ((i % period) + period) % period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const x0 = wrap(xi), x1 = wrap(xi + 1);
  const y0 = wrap(yi), y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Tileable fBm. `period` is in units of the base lattice. */
export function tileFbm2(x, y, period, octaves = 4, gain = 0.5, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise2(x * freq, y * freq, period * freq, seed + i * 6151);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/** Tileable Worley / cellular noise. Returns distance to nearest feature point. */
export function tileWorley2(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 1e9, best2 = 1e9;
  const wrap = (i) => ((i % period) + period) % period;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = wrap(cx), wy = wrap(cy);
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 7919);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) { best2 = best; best = d; }
      else if (d < best2) { best2 = d; }
    }
  }
  return { f1: Math.sqrt(best), f2: Math.sqrt(best2) };
}

/** Random helpers bound to a generator function. */
export class Rand {
  constructor(seed) {
    this.next = typeof seed === 'string' ? mulberry32(hashStr(seed)) : mulberry32(seed >>> 0);
  }
  float(a = 1, b) { return b === undefined ? this.next() * a : a + this.next() * (b - a); }
  int(a, b) { return b === undefined ? Math.floor(this.next() * a) : a + Math.floor(this.next() * (b - a + 1)); }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Pick from [{w:number, ...}] weighted by `w`. */
  weighted(arr, key = 'w') {
    let total = 0;
    for (const it of arr) total += it[key];
    let r = this.next() * total;
    for (const it of arr) { r -= it[key]; if (r <= 0) return it; }
    return arr[arr.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Sum of n dice with s sides - matches MM6 damage rolls. */
  dice(n, s) { let t = 0; for (let i = 0; i < n; i++) t += 1 + Math.floor(this.next() * s); return t; }
  gauss(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerpN = lerp;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
