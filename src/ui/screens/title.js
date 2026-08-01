// ---------------------------------------------------------------------------
// Title screen and main menu.
//
// A painted dusk, not a diagram. The sky is banded cloud strata compressed
// toward the horizon; the light source is a small low sun half-buried in the
// strata, and everything it touches is rim-lit in hard bands rather than washed
// with a radial falloff. Ridges recede in three keyed silhouettes with a
// treeline on the crest, a castle stands on the near knoll with coursed
// masonry, banded roofs and cast shadows, and a bare-limbed tree frames the
// left edge. The five menu options are painted onto the illustration itself -
// MM6 has no grey widget on its title screen - lighting to Sunflower gold under
// the cursor and sitting in cream otherwise.
//
// Rules this file obeys, because a 256-colour indexed frame has no partial
// coverage: no arcs, no elliptical paths, no strokes, no smooth ramps and no
// alpha falloff. Curves are scanline-filled, soft edges are Bayer stipples, and
// every value ramp is quantised into a handful of bands with `band()`. Colour
// only ever leaves through `pc()`, which snaps it into the 256-entry palette.
//
// The illustration is baked once; only the drifting strata, the gate torches
// and the menu are painted per frame.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import { clamp, valueNoise2, hash2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { Screen, baked, vignette, MM6, C_GOLD } from './dialogue.js';

const { rct, stipple, band, mix, shade, blit, paintCanvas, cached, flame, lightPool } = MM6;

const MENU = [
  { id: 'new', label: 'New Game' },
  { id: 'load', label: 'Load Game' },
  { id: 'options', label: 'Options' },
  { id: 'credits', label: 'Credits' },
  { id: 'quit', label: 'Quit' },
];

// The body colour of an unselected option: the cream of the original's painted
// lettering, not UI white. The selected line goes to Sunflower #E1CD23.
const C_CREAM = '#e8dcc0';

// --- the scene ---------------------------------------------------------------

const HORIZON = 300;
// Low sun, left of centre and behind the far range. Small on purpose: the light
// has to reach the picture as rim-light on the ridges and the castle, not as a
// disc that dominates the sky.
const SUN = { x: 196, y: 234, r: 9 };

// Dusk sky, warm at the horizon and slate at the zenith, in eight steps. The
// strata are painted from the second table, which is the same ramp pulled down
// and cooled, so a cloud always reads as the same air in shadow.
const SKY_CLEAR = [
  [26, 32, 50], [36, 42, 60], [50, 52, 66], [74, 62, 68],
  [112, 76, 66], [158, 102, 62], [206, 142, 68], [240, 192, 112],
];
const SKY_CLOUD = [
  [30, 34, 48], [40, 44, 56], [52, 52, 58], [70, 58, 56],
  [94, 68, 54], [122, 84, 52], [154, 106, 56], [188, 138, 70],
];

/**
 * The sky. Strata are sampled in a coordinate that blows up toward the horizon
 * (`1 / (1.04 - t)`), which is what compresses the cloud bands into a fine
 * striation along the skyline and stretches them overhead.
 */
function skyCanvas(W) {
  return paintCanvas(W, HORIZON, (x, y) => {
    const t = y / HORIZON;                       // 0 zenith .. 1 horizon
    // Warmth is mostly vertical; the horizontal term only leans the glow toward
    // the sun. Quantised to eight steps so the sky can never go smooth.
    const hx = 1 - Math.min(1, Math.abs(x - SUN.x) / 380);
    const warm = clamp(t * 0.92 + 0.06 + hx * 0.34 * t, 0, 1);
    const k = Math.round(band(warm, 8) * 7);

    // Strata coordinate: `-log(1.02 - t)` puts a handful of fat slabs overhead
    // and packs thirty of them into the last few rows above the skyline, which
    // is how a flat cloud plane reads when it recedes. Almost no variation
    // along x, so the bands stay level.
    const s = -8.5 * Math.log(1.02 - t);
    const n = valueNoise2(x * 0.0030 + s * 0.03, s, 3) * 0.72
      + valueNoise2(x * 0.011, s * 2.7, 17) * 0.28;
    const cov = n - 0.515 + t * 0.05;

    // The sun sits inside the strata: cloud in front of it wins, which is what
    // stops it reading as a disc pasted onto the sky.
    if (cov <= 0.03) {
      const dx = x - SUN.x, dy = (y - SUN.y) * 1.15;
      const dd = dx * dx + dy * dy;
      if (dd <= SUN.r * SUN.r) return [255, 240, 196];
      if (dd <= (SUN.r + 4) * (SUN.r + 4)) return [248, 206, 116];
    }
    if (cov <= 0) return SKY_CLEAR[k];
    // A thin underlit fringe on the leading edge of every stratum, then the
    // body of the cloud in two darkening steps.
    if (cov < 0.030) return SKY_CLEAR[Math.min(7, k + 2)];
    const cs = Math.round(band(clamp((cov - 0.03) * 6, 0, 1), 3) * 2);
    return SKY_CLOUD[Math.max(0, k - cs)];
  }, 5);
}

// --- ground -----------------------------------------------------------------

const GTOP = 232;

/**
 * Four keyed silhouettes: a hazy far range, a wooded middle ridge, the castle's
 * knoll and the foreground slope the menu sits on. Each carries its own five
 * step value ramp; depth below the crest, the slope's facing and a coarse
 * mottle pick the step, so a hillside is banded rather than a flat lobe.
 */
const LAYERS = [
  {
    y: (x) => 264 - Math.sin(x * 0.0085 + 0.7) * 15 - Math.sin(x * 0.021 + 2.1) * 6
      - valueNoise2(x * 0.012, 3, 71) * 12,
    ramp: [[50, 48, 62], [62, 58, 72], [76, 70, 82], [90, 82, 90], [108, 98, 100]],
    span: 34, fade: 0.16,
  },
  {
    y: (x) => 288 - Math.sin(x * 0.011 + 3.4) * 11 - valueNoise2(x * 0.020, 9, 23) * 14,
    trees: (x) => 3 + Math.round(4 * valueNoise2(x * 0.44, 1, 41) + 3 * valueNoise2(x * 0.10, 5, 17)),
    ramp: [[27, 32, 30], [36, 42, 36], [47, 53, 42], [59, 64, 47], [76, 78, 54]],
    span: 40, fade: 0.34,
  },
  {
    y: (x) => 312 - 32 * Math.exp(-Math.pow((x - 404) / 130, 2)) - Math.sin(x * 0.008 + 1.2) * 7
      - valueNoise2(x * 0.016, 2, 5) * 9,
    trees: (x) => (x > 292 && x < 520 ? 0 : 2 + Math.round(4 * valueNoise2(x * 0.5, 2, 9))),
    ramp: [[18, 23, 15], [27, 33, 20], [37, 44, 25], [48, 55, 30], [63, 71, 37]],
    span: 54, fade: 0.55,
  },
  {
    y: (x) => 332 - Math.sin(x * 0.0062 + 4.2) * 9 - valueNoise2(x * 0.010, 4, 13) * 12,
    ramp: [[10, 13, 8], [17, 21, 12], [24, 30, 16], [33, 40, 20], [45, 52, 26]],
    span: 86, fade: 0.80,
  },
];

// Cart track from the gate, swinging away to the bottom right corner. Painted
// as a transition laid over the hillside, which is how MM6 does roads.
const ROAD = [[36, 29, 19], [56, 45, 29], [78, 63, 41], [104, 85, 57]];
function roadAt(y) {
  const t = clamp((y - 296) / 184, 0, 1);
  const c = 402 + 214 * t * t + 34 * t + valueNoise2(y * 0.06, 2, 29) * 8 - 4;
  const hw = 3 + 54 * t * t + 7 * t;
  return [c, hw];
}

let _cols = null;
/** Per-column crest and treeline heights for every ridge, computed once. */
function ridgeCols(W) {
  if (_cols && _cols.w === W) return _cols;
  const cols = W + 2;
  const L = LAYERS.map((cfg) => {
    const ys = new Float32Array(cols);
    const ts = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      ys[x] = cfg.y(x);
      ts[x] = cfg.trees ? Math.max(0, cfg.trees(x)) : 0;
    }
    return { cfg, ys, ts };
  });
  _cols = { w: W, L };
  return _cols;
}

/** Where the castle's knoll surfaces at column x. */
function knollY(x) { return LAYERS[2].y(x); }

/**
 * The ridges from layer `lo` to layer `hi`, painted into a canvas the size of
 * the ground band with everything outside that range left transparent. Split in
 * two so the castle can be planted between the knoll and the foreground slope.
 */
function groundCanvas(W, H, lo, hi) {
  const gh = H - GTOP;
  const { L } = ridgeCols(W);
  const rc = new Float32Array(gh), rw = new Float32Array(gh);
  for (let i = 0; i < gh; i++) {
    const r = roadAt(i + GTOP);
    rc[i] = r[0]; rw[i] = r[1];
  }
  const knoll = L[2].ys;

  return paintCanvas(W, gh, (x, yy) => {
    const y = yy + GTOP;
    // Which ridge owns this pixel: the nearest one whose crest is above it.
    let own = -1;
    for (let i = L.length - 1; i >= 0; i--) {
      if (y >= L[i].ys[x] - L[i].ts[x]) { own = i; break; }
    }
    if (own < lo || own > hi) return null;

    // Everything below the skyline falls away into the evening: one banded
    // multiplier, five steps, shared by the ground and the track.
    const dk = 1 - band(clamp((y - 292) / 190, 0, 1), 5) * 0.62;

    // The track, wherever it lies on the castle's knoll or in front of it.
    if (y >= knoll[x]) {
      const d = Math.abs(x - rc[yy]) / rw[yy];
      if (d <= 1 && (d < 0.80 || hash2(x, y, 13) < (1 - d) * 4.6)) {
        let ri = Math.round(band(clamp(1 - d * 0.62, 0, 1), 4) * 3);
        if (Math.abs(d - 0.44) < 0.08) ri -= 1;                    // wheel rut
        if (hash2(x >> 1, y >> 1, 41) > 0.86) ri += 1;
        return shade(ROAD[clamp(ri, 0, 3) | 0], dk);
      }
    }

    const lay = L[own];
    const top = lay.ys[x];
    const tree = lay.ts[x];
    const R = lay.cfg.ramp;
    const fade = 1 - (1 - dk) * lay.cfg.fade;

    if (y < top) {
      // Treeline: a flat silhouette one step above black, with the crown of
      // each clump catching a single row of warm light.
      const crown = y < top - tree + 1;
      return shade(crown ? mix(R[1], [150, 108, 56], 0.35) : R[0], fade);
    }

    const depth = y - top;
    const slope = lay.ys[x + 1] - top;
    // Light from the sun's side of the picture: a slope only lights when it
    // faces the sun, and only the top of the fall keeps any of it.
    const facing = slope * (SUN.x - x) > 0 ? Math.min(1, Math.abs(slope) * 1.1) : 0;
    let idx = 1 + Math.round(band(clamp(1 - depth / lay.cfg.span, 0, 1), 4) * 1.7)
      + Math.round(facing * 1.6);
    if (hash2(x >> 1, y >> 1, 3 + own) > 0.84) idx += 1;
    if (hash2(x >> 1, y >> 2, 9 + own) < 0.10) idx -= 1;
    idx = clamp(idx, 0, 4) | 0;
    let col = R[idx];
    // The lit crest gets a warm rim two rows deep, hard-edged.
    if (depth < 2 && facing > 0.30) col = mix(R[4], [206, 150, 76], 0.30);
    return shade(col, fade);
  }, 4);
}

// --- masonry ----------------------------------------------------------------

const MORTAR = [22, 20, 17];
const BLOCK = [[46, 44, 38], [58, 55, 47], [70, 66, 56], [84, 79, 66]];
const ROOF_LIT = [[152, 66, 42], [128, 54, 34], [106, 44, 28], [86, 35, 23]];
const ROOF_DARK = [[62, 26, 20], [52, 22, 17], [43, 18, 14], [34, 14, 11]];
const RIM = [214, 156, 78];

/**
 * A coursed stone face. Every block draws its own value out of a four-step
 * ramp, sits on a darker mortar bed, keeps a lit arris along its top edge and a
 * shadow along its bottom, and `lit(u)` bends the whole run around a drum.
 */
function masonry(g, x, y, w, h, opts = {}) {
  const seed = opts.seed === undefined ? 3 : opts.seed;
  const ch = opts.course || 6;
  const bw0 = opts.block || 14;
  const lit = opts.lit || (() => 1);
  rct(g, x, y, w, h, MORTAR);
  for (let by = 0; by < h; by += ch) {
    const row = (by / ch) | 0;
    const off = (row & 1) ? -((bw0 / 2) | 0) : 0;
    const bh = Math.min(ch - 1, h - by);
    if (bh <= 0) continue;
    for (let bx = off; bx < w; bx += bw0) {
      const x0 = Math.max(0, bx), x1 = Math.min(w, bx + bw0 - 1);
      const bwid = x1 - x0;
      if (bwid <= 0) continue;
      const v = hash2(x + bx, y + by, seed);
      const k = lit((x0 + bwid / 2) / w);
      const col = shade(BLOCK[Math.min(3, (v * 4) | 0)], k);
      rct(g, x + x0, y + by, bwid, bh, col);
      rct(g, x + x0, y + by, bwid, 1, mix(col, [255, 224, 168], 0.16));
      rct(g, x + x0, y + by + bh - 1, bwid, 1, shade(col, 0.58));
    }
  }
  // Weathering: rain streaks running down from the parapet, stippled so they
  // stay 1-bit rather than fading out.
  const streaks = opts.streaks === undefined ? 4 : opts.streaks;
  for (let i = 0; i < streaks; i++) {
    const sx = x + ((hash2(i, seed, 7) * (w - 3)) | 0);
    const sh = Math.round(h * (0.35 + hash2(i, seed, 11) * 0.55));
    stipple(g, sx, y, 1, sh, [18, 16, 13], 0.30);
    stipple(g, sx + 1, y, 1, Math.round(sh * 0.7), [18, 16, 13], 0.16);
  }
}

/** Crenellations: merlons with a lit cap and an embrasure floor between them. */
function battlement(g, x, y, w, hgt, lit = 1) {
  for (let bx = 0; bx < w - 4; bx += 12) {
    const bwid = Math.min(7, w - bx);
    const col = shade(BLOCK[1 + (((bx / 12) | 0) & 1)], lit);
    rct(g, x + bx, y, bwid, hgt, col);
    rct(g, x + bx, y, bwid, 1, mix(col, [255, 220, 160], 0.30));
    rct(g, x + bx + bwid - 1, y, 1, hgt, shade(col, 0.55));
  }
}

/**
 * A conical roof: scanline-filled, split into a lit face and a shadow face,
 * each stepped through four bands down the slope, with tile courses cut across
 * it and a hard eave shadow at the bottom.
 */
function coneRoof(g, cx, apexY, halfBase, hgt) {
  for (let i = 0; i <= hgt; i++) {
    const t = i / hgt;
    const k = Math.round(halfBase * t);
    if (k < 1) continue;
    const y = apexY + i;
    const bi = Math.round(band(t, 4) * 3);
    const split = Math.round(cx + k * 0.14);
    rct(g, cx - k, y, split - (cx - k), 1, ROOF_LIT[bi]);
    rct(g, split, y, cx + k - split, 1, ROOF_DARK[bi]);
    rct(g, cx - k, y, 1, 1, RIM);                              // lit hip
    rct(g, cx + k - 1, y, 1, 1, [26, 12, 10]);                 // shadow hip
    if (i > 3 && (i % 4) === 0) {                              // tile course
      rct(g, cx - k + 1, y, k * 2 - 2, 1, shade(ROOF_DARK[bi], 0.72));
      rct(g, cx - k + 1, y, Math.max(1, k), 1, shade(ROOF_LIT[bi], 0.78));
    }
  }
  // Eaves: a two-row overhang with the shadow it throws on the wall below.
  const y = apexY + hgt;
  rct(g, cx - halfBase - 3, y, halfBase * 2 + 6, 2, ROOF_DARK[3]);
  rct(g, cx - halfBase - 3, y, Math.round(halfBase * 0.9), 1, ROOF_LIT[2]);
  rct(g, cx - halfBase - 3, y + 2, halfBase * 2 + 6, 2, [18, 14, 12]);
}

/**
 * A tower's shadow thrown across the curtain wall. The masonry is simply
 * repainted inside a hard rectangular clip with the light turned down, so the
 * shadow keeps every block, joint and course of the stone underneath it, and
 * only its trailing edge is stippled.
 */
function castShadow(g, wall, x0, w0) {
  g.save();
  g.beginPath();
  g.rect(x0, wall.y, w0, wall.h);
  g.clip();
  masonry(g, wall.x, wall.y, wall.w, wall.h,
    { seed: wall.seed, course: wall.course, lit: () => wall.k * 0.44, streaks: 0 });
  g.restore();
  for (let i = 0; i < 4; i++) {
    stipple(g, x0 + w0 + i, wall.y, 1, wall.h, [18, 16, 13], 0.42 - i * 0.10);
  }
}

/** A pennant on a staff, hard-keyed, with a shadow fold down its middle. */
function banner(g, x, y, hgt) {
  rct(g, x, y - hgt, 1, hgt, [58, 48, 34]);
  rct(g, x, y - hgt, 1, 3, [150, 120, 60]);
  for (let i = 0; i < 9; i++) {
    const wdt = Math.round(14 - Math.abs(i - 4) * 1.6);
    rct(g, x + 1, y - hgt + 2 + i, wdt, 1, i % 3 === 2 ? [116, 26, 22] : [156, 38, 30]);
    rct(g, x + 1, y - hgt + 2 + i, 2, 1, [188, 66, 46]);
  }
}

/**
 * The castle on the near knoll: curtain wall between two drum towers with the
 * keep behind, all in coursed stone, lit from the sun's side and throwing its
 * towers' shadows across the wall.
 */
/** The deepest the knoll runs across a span, so nothing is left floating. */
function footing(x0, x1) {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, knollY(x));
  return Math.round(m);
}

function tower(g, T) {
  const drum = (u) => 1.30 - band(clamp(u, 0, 1), 4) * 0.86;
  const base = footing(T.x, T.x + T.w) + 5;
  masonry(g, T.x, T.top, T.w, base - T.top, { seed: T.seed, lit: drum, streaks: 3 });
  battlement(g, T.x - 2, T.top - 8, T.w + 4, 8, 1.05);
  rct(g, T.x, T.top, 1, base - T.top, mix(BLOCK[3], RIM, 0.30));     // sunlit arris
  rct(g, T.x + T.w - 1, T.top, 1, base - T.top, [16, 14, 12]);       // shadowed arris
  coneRoof(g, T.x + T.w / 2, T.top - 8 - T.roof, Math.round(T.w / 2) + 4, T.roof);
  banner(g, Math.round(T.x + T.w / 2), T.top - 8 - T.roof, 16);
  // Lit windows: a slot each, with a stippled spill on the stone around it.
  for (let i = 0; i < 3; i++) {
    const wyy = T.top + 20 + i * 26;
    if (wyy > base - 14) continue;
    const wxx = Math.round(T.x + T.w * 0.34);
    rct(g, wxx, wyy, 3, 7, [30, 20, 12]);
    rct(g, wxx, wyy + 1, 3, 5, [248, 196, 92]);
    stipple(g, wxx - 3, wyy - 2, 9, 11, [200, 140, 60], 0.22);
  }
}

function paintCastle(g) {
  const flat = () => 0.92;
  const wx = 330, wy = 246, ww = 148;
  const wallBase = footing(wx, wx + ww) + 4;
  const wh = wallBase - wy;

  // The keep, standing behind the curtain so the wall buries its footing.
  tower(g, { x: 352, w: 44, top: 176, roof: 40, seed: 33 });

  // Curtain wall.
  masonry(g, wx, wy, ww, wh, { seed: 5, lit: flat, streaks: 6 });
  battlement(g, wx, wy - 8, ww, 8, 0.95);
  rct(g, wx, wy, ww, 1, mix(BLOCK[3], [255, 220, 160], 0.25));
  rct(g, wx, wy, 1, wh, mix(BLOCK[3], RIM, 0.28));                // sunlit arris

  // The gatehouse throws its own shadow along the curtain before it is drawn.
  castShadow(g, { x: wx, y: wy, w: ww, h: wh, seed: 5, course: 6, k: 0.92 }, 428, 17);

  // Gatehouse: a squat projecting block with a scanline-cut arch.
  const gx = 404;
  masonry(g, gx - 24, wy - 12, 48, wh + 12, { seed: 8, lit: flat, streaks: 2 });
  battlement(g, gx - 24, wy - 20, 48, 8, 1.02);
  rct(g, gx - 24, wy - 12, 1, wh + 12, mix(BLOCK[3], RIM, 0.26));
  const ar = 12, ay = wy + 18;
  for (let dy = -ar; dy <= 0; dy++) {
    const k = Math.round(Math.sqrt(Math.max(0, ar * ar - dy * dy)));
    if (k <= 0) continue;
    rct(g, gx - k, ay + dy, k * 2, 1, [16, 11, 8]);
  }
  rct(g, gx - ar, ay, ar * 2, wallBase - ay, [16, 11, 8]);
  for (let i = 0; i < 4; i++) rct(g, gx - ar + 2 + i * 6, ay, 1, wallBase - ay - 2, [36, 27, 18]);
  rct(g, gx - ar - 2, wy + 4, ar * 2 + 4, 2, shade(BLOCK[3], 0.8));

  // The two drums flanking the curtain, and the shadows they throw on it.
  const wall = { x: wx, y: wy, w: ww, h: wh, seed: 5, course: 6, k: 0.92 };
  castShadow(g, wall, 342, 15);
  tower(g, { x: 314, w: 28, top: 204, roof: 28, seed: 21 });
  tower(g, { x: 464, w: 30, top: 212, roof: 30, seed: 27 });
}

// --- the tree ---------------------------------------------------------------

const BARK = [30, 24, 17];
const BARK_LIT = [62, 49, 27];
const LEAF = [12, 16, 11];
const LEAF_LIT = [104, 82, 42];

/** A foliage mass: a lumpy scanline blob, hard-keyed, lit on the sun's side. */
function clump(g, cx, cy, r, seed) {
  cx = Math.round(cx); cy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const base = Math.sqrt(Math.max(0, r * r - dy * dy));
    // Low-frequency lumps: the silhouette has to be ragged, not jittery, or the
    // lit edge breaks up into loose pixels instead of reading as a rim.
    const lumpL = 0.70 + 0.46 * valueNoise2(dy * 0.30, seed, seed);
    const lumpR = 0.70 + 0.46 * valueNoise2(dy * 0.30 + 40, seed, seed + 3);
    const kl = Math.round(base * lumpL), kr = Math.round(base * lumpR);
    if (kl + kr <= 0) continue;
    rct(g, cx - kl, cy + dy, kl + kr, 1, LEAF);
  }
}

/**
 * The whole crown as one silhouette. The clumps are stamped into a scratch
 * canvas first and the warm edge is then walked around the *composite* outline,
 * so the sun catches the top-right of the canopy rather than capping every
 * clump and turning the tree into a heap of mushrooms.
 */
function paintCrown(g, clumps) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [cx, cy, r] of clumps) {
    x0 = Math.min(x0, cx - r - 3); y0 = Math.min(y0, cy - r - 3);
    x1 = Math.max(x1, cx + r + 3); y1 = Math.max(y1, cy + r + 3);
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  const w = Math.ceil(x1) - x0, h = Math.ceil(y1) - y0;
  const c = MM6.mkCanvas(w, h);
  const gg = c.getContext('2d', { willReadFrequently: true });
  for (const [cx, cy, r, seed] of clumps) clump(gg, cx - x0, cy - y0, r, seed);
  const d = gg.getImageData(0, 0, w, h).data;
  const solid = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (d[(y * w + x) * 4 + 3] > 8 ? 1 : 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (solid(x + 1, y) && solid(x, y - 1) && solid(x + 1, y - 1)) continue;
      rct(gg, x, y, 1, 1, LEAF_LIT);
    }
  }
  blit(g, c, x0, y0);
}

/** Recursive limb: a tapering stack of squares with a lit right arris. */
function limb(g, x, y, ang, len, wdt, depth, seed) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  const n = Math.max(2, Math.round(len));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.max(1, Math.round(wdt * (1 - t * 0.42)));
    const px = Math.round(x + (x2 - x) * t), py = Math.round(y + (y2 - y) * t);
    rct(g, px - (w >> 1), py - (w >> 1), w, w, BARK);
    if (w > 1) rct(g, px - (w >> 1) + w - 1, py - (w >> 1), 1, w, BARK_LIT);
  }
  if (depth <= 0) return;
  const spread = 0.42 + hash2(seed, depth, 3) * 0.30;
  limb(g, x2, y2, ang - spread, len * 0.70, wdt * 0.66, depth - 1, seed * 2 + 1);
  limb(g, x2, y2, ang + spread * 0.85, len * 0.66, wdt * 0.62, depth - 1, seed * 2 + 7);
  if (hash2(seed, depth, 11) > 0.55) {
    limb(g, x + (x2 - x) * 0.55, y + (y2 - y) * 0.55, ang + spread * 1.5,
      len * 0.44, wdt * 0.5, depth - 2, seed * 3 + 5);
  }
}

/** The framing tree at the left edge: tapered trunk, forked limbs, crown. */
function paintTree(g) {
  const bx = 74, by = 474;
  // Trunk, leaning very slightly into the picture, with root flare at the base.
  // Tall enough that the crown clears the near hill and silhouettes against the
  // lit sky instead of disappearing into the dark ground.
  const hgt = 152;
  for (let i = 0; i < hgt; i++) {
    const t = i / hgt;
    const w = Math.max(5, Math.round(19 * (1 - t * 0.60) + (t < 0.12 ? (0.12 - t) * 70 : 0)));
    const x = Math.round(bx + t * 9);
    const y = by - i;
    rct(g, x - (w >> 1), y, w, 1, BARK);
    rct(g, x - (w >> 1), y, 1, 1, [12, 10, 7]);
    if ((i % 3) !== 1) rct(g, x + (w >> 1) - 1, y, 1, 1, BARK_LIT);
    if ((i % 7) === 3) rct(g, x - (w >> 1) + 1, y, Math.max(1, w - 3), 1, [21, 17, 12]);
  }
  const tx = bx + 9, ty = by - hgt;
  limb(g, tx, ty, -Math.PI / 2 - 0.20, 40, 10, 2, 3);
  limb(g, tx, ty + 8, -Math.PI / 2 + 0.46, 36, 9, 2, 11);
  limb(g, tx - 2, ty + 26, -Math.PI / 2 - 0.88, 30, 8, 1, 19);
  limb(g, tx + 3, ty + 36, -Math.PI / 2 + 1.04, 28, 7, 1, 23);
  limb(g, tx - 1, ty + 62, -Math.PI / 2 - 1.10, 20, 6, 0, 29);
  // The crown reads as one mass with a lit right shoulder, not as separate
  // blobs, so a few overlapping clumps are stamped over the tips.
  paintCrown(g, [
    [tx - 6, ty - 34, 24, 41], [tx + 24, ty - 18, 20, 47], [tx - 30, ty - 8, 18, 53],
    [tx + 8, ty - 52, 16, 59], [tx - 20, ty - 44, 14, 67], [tx + 30, ty - 44, 12, 71],
  ]);
}

// --- foreground detail ------------------------------------------------------

/** A boulder: banded mass, one lit facet toward the sun, contact shadow. */
function boulder(g, cx, baseY, w, h, seed) {
  const dir = SUN.x > cx ? 1 : -1;
  const body = [[24, 24, 21], [38, 37, 32], [54, 52, 45], [74, 71, 61]];
  stipple(g, cx - Math.round(w * 0.6), baseY - 1, Math.round(w * 1.2), 2, [10, 12, 8], 0.5);
  for (let i = 0; i < h; i++) {
    const t = i / h;                                    // 0 at the top
    const k = Math.max(1, Math.round((w / 2)
      * (0.35 + 0.65 * Math.sin(Math.pow(t, 0.72) * Math.PI * 0.92))
      * (0.86 + 0.28 * valueNoise2(i * 0.7, seed, seed))));
    const y = baseY - h + i;
    const bi = Math.round(band(clamp(0.75 - t * 0.7, 0, 1), 4) * 3);
    rct(g, cx - k, y, k * 2, 1, body[bi]);
    if (t < 0.45) {
      const lw = Math.max(1, Math.round(k * 0.7));
      rct(g, dir > 0 ? cx + k - lw : cx - k, y, lw, 1, body[Math.min(3, bi + 1)]);
    }
    rct(g, dir > 0 ? cx - k : cx + k - 1, y, 1, 1, body[0]);
  }
}

/** Grass tussocks along the track and the crest, painted as hard blades. */
function tussock(g, cx, baseY, hgt, seed) {
  for (let i = 0; i < 6; i++) {
    const x0 = cx + i - 3;
    const a = (hash2(i, seed, 3) - 0.5) * 0.5;
    const l = Math.max(2, hgt * (0.45 + hash2(i, seed, 9) * 0.55));
    const lit = hash2(i, seed, 13) > 0.5;
    for (let j = 0; j < l; j++) {
      const t = j / l;
      rct(g, Math.round(x0 + a * t * t * hgt), Math.round(baseY - j), 1, 1,
        lit ? [52, 62, 30] : [30, 38, 20]);
    }
  }
}

/** The sky alone; the drifting strata are laid over this, then the land. */
export function paintTitleSky(g, w, h) {
  blit(g, cached(`title:sky:${w}`, () => skyCanvas(w)), 0, 0);
  rct(g, 0, HORIZON, w, h - HORIZON, LAYERS[3].ramp[0]);
  vignette(g, w, h, 0.28);
}

/** Ridges, castle, tree, track: everything in front of the sky, in one bake. */
export function paintTitleArt(g, w, h) {
  blit(g, cached(`title:far:${w}x${h}`, () => groundCanvas(w, h, 0, 2)), 0, GTOP);
  paintCastle(g);
  blit(g, cached(`title:near:${w}x${h}`, () => groundCanvas(w, h, 3, 3)), 0, GTOP);

  // Foreground furniture, kept clear of the column the menu prints in.
  for (const [bx, by, bw, bh, s] of [
    [546, 352, 26, 15, 3], [598, 386, 34, 20, 9], [472, 336, 18, 11, 15],
    [92, 356, 22, 13, 21], [160, 392, 30, 17, 27], [36, 430, 40, 22, 33],
    [608, 452, 46, 26, 39], [512, 320, 14, 9, 45],
  ]) boulder(g, bx, by, bw, bh, s);
  for (let i = 0; i < 26; i++) {
    const tx = (hash2(i, 7, 3) * w) | 0;
    const ty = 316 + ((hash2(i, 9, 5) * 158) | 0);
    if (tx > 190 && tx < 452 && ty > 330) continue;          // keep the menu clean
    tussock(g, tx, ty, 5 + ((hash2(i, 11, 7) * 7) | 0), i);
  }

  paintTree(g);
  vignette(g, w, h, 0.28);
}

// --- drifting strata --------------------------------------------------------

/**
 * One band of cloud, baked with clear margins at both ends so the copies can be
 * scrolled past each other without a seam showing.
 */
function stratum(W, hgt, seed) {
  return cached(`title:stratum:${W}:${hgt}:${seed}`, () => paintCanvas(W, hgt, (x, y) => {
    const t = y / (hgt - 1);
    const edge = Math.min(1, Math.min(x, W - 1 - x) / 48);
    const n = valueNoise2(x * 0.0075, t * 1.4, seed) * 0.72
      + valueNoise2(x * 0.030, t * 3.2, seed + 5) * 0.28;
    const d = (n - 0.50 + Math.sin(t * Math.PI) * 0.16) * edge;
    if (d <= 0.005) return null;
    const k = Math.round(band(clamp(d * 9, 0, 1), 3) * 2);
    // Underlit fringe on the first band, body on the other two.
    return [[122, 88, 54], [58, 50, 52], [40, 38, 46]][k];
  }, 5));
}

/**
 * Big title lettering. The letterform is drawn small and magnified with
 * nearest sampling, which is what gives it the chunky cast-metal look: a dark
 * lip below right, a pale bevel above left and gold in between.
 */
function lettering(textStr, scale, faceName = 'title') {
  const m = F.measure(textStr, faceName);
  const cw = m.w + 4, chh = F.lineHeightOf(faceName) + 4;
  const c = document.createElement('canvas');
  c.width = cw; c.height = chh;
  const gg = c.getContext('2d');
  gg.imageSmoothingEnabled = false;
  const o = { face: faceName, align: 'center', shadow: null };
  F.drawText(gg, textStr, cw / 2 + 1, 3, Object.assign({ color: MM6.pc([58, 38, 8]) }, o));
  F.drawText(gg, textStr, cw / 2, 2, Object.assign({ color: MM6.pc([138, 106, 16]) }, o));
  F.drawText(gg, textStr, cw / 2 - 1, 1, Object.assign({ color: MM6.pc([255, 242, 184]) }, o));
  F.drawText(gg, textStr, cw / 2, 2, Object.assign({ color: C_GOLD }, o));
  const out = document.createElement('canvas');
  out.width = cw * scale; out.height = chh * scale;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = false;
  og.drawImage(c, 0, 0, cw, chh, 0, 0, cw * scale, chh * scale);
  return out;
}

function titleBanner() {
  return baked('title:banner3', 600, 96, (g, w, h) => {
    const a = lettering('MIGHT AND MAGIC', 3);
    const b = lettering('VI', 2);
    g.imageSmoothingEnabled = false;
    // Cast shadow: an opaque copy of the letterform offset down-right. A
    // translucent one would tint the painting rather than sit on it.
    const sh = document.createElement('canvas');
    sh.width = a.width; sh.height = a.height;
    const sg = sh.getContext('2d');
    sg.imageSmoothingEnabled = false;
    sg.drawImage(a, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = MM6.pc([18, 12, 6]);
    sg.fillRect(0, 0, a.width, a.height);
    g.drawImage(sh, Math.round((w - a.width) / 2) + 5, 5);
    g.drawImage(a, Math.round((w - a.width) / 2), 0);
    g.drawImage(b, Math.round((w - b.width) / 2), a.height - 6);
  });
}

// --- the screen -------------------------------------------------------------

const MENU_CX = 320, MENU_Y0 = 342, MENU_STEP = 27, MENU_W = 230;

export class TitleScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'title';
    this.t = 0;
    this.selected = 0;
    this.onPick = opts.onPick || null;
  }

  update(dt) { this.t += dt || 0; }

  pick(id) {
    this.sound('click');
    if (this.onPick) this.onPick(id, this);
    else if (this.session && typeof this.session.mainMenu === 'function') this.session.mainMenu(id);
  }

  draw(ctx) {
    const W = layout.w, H = layout.h;
    // Sky, then the drifting strata, then everything that stands in front of
    // them: the towers have to occlude the clouds, not the other way round.
    ctx.drawImage(baked('title:sky2', W, H, (g, w, h) => paintTitleSky(g, w, h)), 0, 0);
    this.drawClouds(ctx, W, H);
    ctx.drawImage(baked('title:land2', W, H, (g, w, h) => paintTitleArt(g, w, h)), 0, 0);
    this.drawTorches(ctx, W, H);

    const bnr = titleBanner();
    ctx.drawImage(bnr, Math.round((W - bnr.width) / 2), 22);

    // Nothing else is printed on the frame: no strapline, no build stamp. A
    // 1998 title screen announces the game and nothing about itself.
    this.drawMenu(ctx, W, H);
  }

  /** Two bands of cloud drifting across the sky at different speeds. */
  drawClouds(ctx, W) {
    for (let i = 0; i < 3; i++) {
      const c = stratum(W, [16, 13, 20][i], [13, 61, 97][i]);
      const off = Math.round((this.t * [4, 7, 11][i]) % W);
      const y = [126, 168, 214][i];
      blit(ctx, c, -off, y);
      blit(ctx, c, W - off, y);
    }
  }

  /** Gate torches gutter on a slow noise and throw light on the gatehouse. */
  drawTorches(ctx) {
    for (const ox of [-17, 17]) {
      const f = 0.62 + 0.38 * valueNoise2(this.t * 6 + ox, 0, 3);
      const x = 404 + ox, y = 274;
      rct(ctx, x - 1, y, 3, 5, [46, 34, 20]);                  // bracket
      flame(ctx, x, y - 3, 4, Math.round(5 * f) + 3, this.t * 5 + ox);
      lightPool(ctx, x, y - 6, Math.round(13 * f), '#ffa040', 0.7 * f);
    }
  }

  /**
   * The options are painted onto the illustration - MM6 puts no widget on its
   * title screen. Cream body, Sunflower gold under the cursor, with a chiselled
   * mark either side of the live line.
   */
  drawMenu(ctx) {
    const x0 = MENU_CX - MENU_W / 2;
    const hits = MENU.map((m, i) => this.ui.region(`title:${m.id}`,
      x0, MENU_Y0 + i * MENU_STEP - 3, MENU_W, MENU_STEP - 2, null));
    const hovered = hits.findIndex((hh) => hh.hover);
    if (hovered >= 0) this.selected = hovered;

    MENU.forEach((m, i) => {
      const my = MENU_Y0 + i * MENU_STEP;
      const on = i === this.selected;
      if (on) {
        const half = Math.round(F.measure(m.label, 'title').w / 2);
        for (const s of [-1, 1]) {
          const mx = MENU_CX + s * (half + 14);
          rct(ctx, mx - 3, my + 8, 7, 1, [70, 52, 10]);
          rct(ctx, mx - 2, my + 7, 5, 1, C_GOLD);
          rct(ctx, mx - 1, my + 6, 3, 3, C_GOLD);
          rct(ctx, mx - 2, my + 9, 5, 1, [124, 96, 20]);
        }
      }
      F.drawText(ctx, m.label, MENU_CX, my, {
        face: 'title', align: 'center', color: on ? C_GOLD : C_CREAM,
        shadow: '#000000', outline: '#100c06',
      });
      if (hits[i].click) this.pick(m.id);
    });
  }

  handleKey(code) {
    if (code === 'ArrowDown') { this.selected = (this.selected + 1) % MENU.length; return true; }
    if (code === 'ArrowUp') { this.selected = (this.selected + MENU.length - 1) % MENU.length; return true; }
    if (code === 'Enter' || code === 'Space') { this.pick(MENU[this.selected].id); return true; }
    return false;
  }
}

export default TitleScreen;
