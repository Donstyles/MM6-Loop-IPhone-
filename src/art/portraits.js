// ---------------------------------------------------------------------------
// Painted party portraits.
//
// MM6's bottom bar carries four hand-painted head-and-shoulders portraits that
// swap to a different painting as the character's condition changes. They are
// the most-looked-at art in the game, so these are built the way the originals
// were *painted* rather than the way sprites are drawn: a lit surface first,
// features second.
//
// Technique:
//   1. Sum smooth analytic blobs (skull, brow ridge, sockets, nose, cheekbones,
//      lips, chin, jaw, ear) into a height field H at 3x resolution. The whole
//      set is built around a three-quarter turn: the depth peak sits over the
//      face midline, not the skull centre, so the far half of the face falls
//      away steeply and the near half stays broad.
//   2. Central-difference H into normals; shade with a key from the upper front
//      left, a cool rim from the lower right, and a warm bounce from below.
//   3. Look the shading term up in a six-tone skin ramp (deep shadow, shadow,
//      ruddy terminator, mid, light, highlight) rather than lerping two colours,
//      which is what keeps flesh from going plastic.
//   4. Draw only what geometry cannot give: lashes, the lip line, hair strands,
//      stubble stipple, scars, catchlights.
//   5. Box-downsample 3x -> 1x and dither lightly, so the gradients break into
//      the era's stipple instead of banding.
// ---------------------------------------------------------------------------

import { ditherImageData } from '../core/palette.js';
import { Rand, clamp, smoothstep, valueNoise2, hash2 } from '../core/rng.js';
import { makeCanvas, ctx2d, rampSample, mixC } from './texcanvas.js';

export const PORTRAIT_W = 63;
export const PORTRAIT_H = 73;

// MM6 stores a bank of expression frames per face; these are the ones the game
// actually drives (condition icons, damage reactions, casting, and the four
// mouth shapes it cycles through while a character talks).
export const EXPRESSIONS = ['normal', 'smile', 'hurt', 'angry', 'scared', 'poisoned',
  'diseased', 'asleep', 'drunk', 'insane', 'paralyzed', 'unconscious', 'dead', 'stoned',
  'eradicated', 'level_up', 'cast',
  'dmg_minor', 'dmg_moderate', 'dmg_major', 'avoid', 'wide_smile', 'sad',
  'talk1', 'talk2', 'talk3', 'talk4'];

/** Supersample factor: paint at 2x and box-filter down for softer edges. */
const SS = 2;

// Design space. All geometry below is written in these units and mapped onto
// whatever output size the caller asked for, so a portrait can be re-rendered
// larger for a character sheet without re-tuning every number.
const DW = 63, DH = 73;

export const KLASSES = ['knight', 'paladin', 'archer', 'cleric', 'sorcerer', 'druid'];

// --- small maths -----------------------------------------------------------

const mix = (a, b, t) => a + (b - a) * t;
/** Quartic blob falloff, 1 at the centre, 0 at the ellipse edge. */
function blob(dx, dy, rx, ry) {
  const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (d >= 1) return 0;
  const k = 1 - d;
  return k * k;
}
/** Ellipse metric: <1 inside, 1 on the edge. */
function ell(dx, dy, rx, ry) { return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry); }
/** Antialiased coverage from an ellipse metric. */
function cov(e, soft) { return smoothstep(1 + soft, 1 - soft, e); }

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const l = vx * vx + vy * vy;
  let t = l > 0 ? (wx * vx + wy * vy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

const nz = (x, y, s) => valueNoise2(x, y, s);                    // 0..1
/**
 * fBm over *value* noise. The shared gradNoise2 costs eight trig calls per
 * lattice point, and this painter evaluates noise several times for every one
 * of ~41k supersamples; value noise is five times cheaper and its slightly
 * blockier character suits mottled paint anyway.
 */
function fb(x, y, oct, seed) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise2(x * f, y * f, seed + i * 1013);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;                                             // 0..1
}
const sq = (x) => x * x;
const SIDES = [-1, 1];

/** rampSample that knows the two 8-shade ramps. */
function rs(name, t) {
  return rampSample(name, t, name === 'flesh' || name === 'arcane' ? 8 : 16);
}
const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const add3 = (c, d, k) => [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
function lum(c) { return c[0] * 0.30 + c[1] * 0.59 + c[2] * 0.11; }
function desat(c, k) { const l = lum(c); return [mix(c[0], l, k), mix(c[1], l, k), mix(c[2], l, k)]; }

// Buffer blend: b is a Float32Array of rgb triples.
function bl(b, i, c, a) {
  if (a <= 0) return;
  if (a > 1) a = 1;
  b[i] += (c[0] - b[i]) * a;
  b[i + 1] += (c[1] - b[i + 1]) * a;
  b[i + 2] += (c[2] - b[i + 2]) * a;
}

// --- character colour libraries -------------------------------------------
// Everything here is sampled out of the shared ramps so nothing but palette
// colours ever reaches the framebuffer.

// Nine tones, genuinely spanning porcelain to near-black. A party of four wants
// to read as four different people from across the continent, and value is the
// first thing the eye separates at 63 px.
const SKIN_TONES = {
  porcelain: { t: 0.90, tint: [1.00, 0.99, 1.00], ruddy: 0.42 },
  pale: { t: 0.78, tint: [1.00, 0.98, 0.96], ruddy: 0.36 },
  fair: { t: 0.66, tint: [1.00, 0.97, 0.92], ruddy: 0.30 },
  tan: { t: 0.55, tint: [1.00, 0.94, 0.84], ruddy: 0.26 },
  olive: { t: 0.46, tint: [0.93, 0.94, 0.75], ruddy: 0.20 },
  bronze: { t: 0.38, tint: [1.00, 0.87, 0.66], ruddy: 0.22 },
  brown: { t: 0.29, tint: [0.95, 0.80, 0.62], ruddy: 0.17 },
  dark: { t: 0.22, tint: [0.90, 0.72, 0.55], ruddy: 0.14 },
  ebony: { t: 0.15, tint: [0.86, 0.66, 0.50], ruddy: 0.11 },
};

/**
 * Six skin tones from deep shadow to highlight, plus a warm bounce colour for
 * downward-facing surfaces. Two-colour lerps are what make procedural faces
 * look like plastic; a hand-authored ramp with a ruddy terminator does not.
 *
 * The shadow and highlight multipliers are pulled towards the middle as the
 * base darkens. A dark face lit with the same 0.26x deep shadow as a pale one
 * loses its whole lower half to black at 63 px; real dark skin reads with a
 * *narrower* value range and a much brighter specular instead.
 */
function skinRamp(tone) {
  const s = SKIN_TONES[tone];
  const f = rs('flesh', s.t);
  const base = desat([f[0] * s.tint[0], f[1] * s.tint[1], f[2] * s.tint[2]], 0.32);
  const lift = clamp((118 - lum(base)) / 150, 0, 0.48);
  const m0 = 0.26 + lift * 0.52, m1 = 0.44 + lift * 0.50, m2 = 0.68 + lift * 0.34;
  const m4 = 1.12 + lift * 0.24, m5 = 1.24 + lift * 0.52;
  return {
    ramp: [
      mixC(scl(base, m0), rs('blood', 0.18), s.ruddy * 0.7),
      mixC(scl(base, m1), rs('blood', 0.26), s.ruddy * 0.9),
      mixC(scl(base, m2), rs('blood', 0.34), s.ruddy * 0.7),
      base,
      desat(mixC(scl(base, m4), rs('sand', 0.74), 0.13 * (1 - lift)), 0.06),
      desat(mixC(scl(base, m5), rs('sand', 0.84), 0.22 * (1 - lift)), 0.12),
    ],
    bounce: mixC(scl(base, 0.52 + lift * 0.4), rs('fire', 0.34), 0.30),
    base, ruddy: s.ruddy, lift,
  };
}

// Hair has to survive being one value darker than the background vignette and
// still show its colour: these are the *lit* mid-tones, not the local colour of
// a hair in shadow, which is why they read brighter than you would expect.
const HAIR_COLOURS = {
  black: () => mixC(rs('grey', 0.17), rs('wood', 0.22), 0.45),
  darkbrown: () => rs('wood', 0.38),
  brown: () => rs('wood', 0.54),
  auburn: () => mixC(rs('wood', 0.48), rs('blood', 0.46), 0.42),
  red: () => mixC(rs('fire', 0.46), rs('wood', 0.42), 0.42),
  blonde: () => desat(mixC(rs('sand', 0.72), rs('gold', 0.56), 0.30), 0.08),
  sandy: () => desat(mixC(rs('sand', 0.56), rs('wood', 0.48), 0.42), 0.14),
  grey: () => rs('grey', 0.44),
  white: () => rs('grey', 0.76),
};

const EYE_COLOURS = {
  brown: () => desat(rs('wood', 0.34), 0.15),
  hazel: () => desat(mixC(rs('wood', 0.40), rs('swamp', 0.50), 0.45), 0.15),
  green: () => desat(mixC(rs('foliage', 0.50), rs('swamp', 0.48), 0.35), 0.18),
  blue: () => desat(mixC(rs('sky', 0.34), rs('water', 0.50), 0.45), 0.18),
  grey: () => desat(rs('stone', 0.46), 0.25),
  amber: () => desat(rs('gold', 0.36), 0.28),
};

// Seven skulls rather than four, and the spread runs much wider: `heavy` is a
// genuinely broad, thick-jawed head and `gaunt` a narrow starved one. Face mass
// is the second thing the eye separates after value.
const FACE_SHAPES = {
  round: { rx: 17.4, ry: 21.0, wTop: 0.72, wTemple: 0.95, wCheek: 1.00, wJaw: 0.88, wChin: 0.58 },
  heavy: { rx: 18.5, ry: 20.6, wTop: 0.76, wTemple: 0.98, wCheek: 1.04, wJaw: 1.00, wChin: 0.80 },
  long: { rx: 15.3, ry: 23.4, wTop: 0.70, wTemple: 0.93, wCheek: 0.97, wJaw: 0.72, wChin: 0.42 },
  square: { rx: 17.1, ry: 21.6, wTop: 0.75, wTemple: 0.97, wCheek: 1.00, wJaw: 0.97, wChin: 0.74 },
  gaunt: { rx: 14.7, ry: 23.2, wTop: 0.65, wTemple: 0.88, wCheek: 0.96, wJaw: 0.60, wChin: 0.36 },
  heart: { rx: 16.8, ry: 21.8, wTop: 0.78, wTemple: 1.02, wCheek: 0.97, wJaw: 0.66, wChin: 0.40 },
  oval: { rx: 16.2, ry: 22.2, wTop: 0.71, wTemple: 0.94, wCheek: 0.99, wJaw: 0.80, wChin: 0.52 },
};

// --- face description ------------------------------------------------------

/**
 * Deterministic face descriptor.
 * @param {number|string} seed
 * @param {{sex?:'m'|'f', klass?:string, age?:string}} opts
 */
export function makeFace(seed, opts = {}) {
  const key = typeof seed === 'string' ? seed : (seed >>> 0);
  const r = new Rand(typeof key === 'string' ? key : (key ^ 0x5f3a9c17) >>> 0);
  const sex = opts.sex === 'f' || opts.sex === 'm' ? opts.sex : (r.bool(0.5) ? 'm' : 'f');
  const klass = KLASSES.includes(String(opts.klass).toLowerCase())
    ? String(opts.klass).toLowerCase() : r.pick(KLASSES);
  const age = ['young', 'middle', 'old'].includes(opts.age) ? opts.age
    : r.weighted([{ v: 'young', w: 3 }, { v: 'middle', w: 4 }, { v: 'old', w: 2 }]).v;

  const old = age === 'old', young = age === 'young';

  const toneName = r.weighted([
    { v: 'porcelain', w: 2 }, { v: 'pale', w: 3 }, { v: 'fair', w: 3.5 },
    { v: 'tan', w: 3.5 }, { v: 'olive', w: 3 }, { v: 'bronze', w: 3 },
    { v: 'brown', w: 3 }, { v: 'dark', w: 3 }, { v: 'ebony', w: 2 },
  ]).v;
  const darkSkin = toneName === 'brown' || toneName === 'dark' || toneName === 'ebony';

  let hairName = r.weighted([
    { v: 'black', w: darkSkin ? 9 : 4 }, { v: 'darkbrown', w: 5 }, { v: 'brown', w: 4 },
    { v: 'auburn', w: darkSkin ? 0.6 : 3 }, { v: 'red', w: darkSkin ? 0.2 : 2.5 },
    { v: 'blonde', w: darkSkin ? 0.2 : 3.5 }, { v: 'sandy', w: darkSkin ? 0.2 : 2.5 },
    { v: 'grey', w: old ? 7 : 0.8 }, { v: 'white', w: old ? 5 : 0.3 },
  ]).v;
  if (old && (hairName === 'black' || hairName === 'darkbrown') && r.bool(0.55)) {
    hairName = r.bool(0.6) ? 'grey' : 'white';
  }

  const shapeName = r.weighted([
    { v: 'round', w: 3 }, { v: 'oval', w: 3 }, { v: 'long', w: 3 },
    { v: 'heart', w: sex === 'f' ? 3.5 : 1.5 },
    { v: 'heavy', w: sex === 'm' ? 3 : 1.5 },
    { v: 'square', w: sex === 'm' ? 4 : 1.5 },
    { v: 'gaunt', w: old ? 4 : 2 },
  ]).v;

  // --- hair ---------------------------------------------------------------
  // With headgear now rare, the cut carries most of the per-character signal:
  // length, parting, hairline and whether it hangs in front of the shoulders.
  const hairStyle = r.weighted(sex === 'm' ? [
    { v: 'crop', w: 4 }, { v: 'short', w: 5 }, { v: 'medium', w: 3 },
    { v: 'long', w: 2.5 }, { v: 'ponytail', w: 2 },
    { v: 'bald', w: old ? 3.5 : 1 }, { v: 'receding', w: old ? 4.5 : 1.2 },
    { v: 'braided', w: 1.2 }, { v: 'wild', w: 2.5 },
  ] : [
    { v: 'crop', w: 1 }, { v: 'short', w: 2.5 }, { v: 'medium', w: 4 },
    { v: 'long', w: 5 }, { v: 'ponytail', w: 3 },
    { v: 'braided', w: 3 }, { v: 'wild', w: 2 },
    { v: 'receding', w: old ? 0.6 : 0 }, { v: 'bald', w: 0.15 },
  ]).v;

  const hairlineShape = hairStyle === 'receding' || hairStyle === 'bald' ? 'receded'
    : r.weighted([
      { v: 'peak', w: 3 },      // widow's peak
      { v: 'straight', w: 3 },
      { v: 'round', w: 3 },
      { v: 'high', w: 2 },
      { v: 'receded', w: old ? 2.5 : (sex === 'm' ? 1.5 : 0.4) },
    ]).v;

  const longish = hairStyle === 'long' || hairStyle === 'braided'
    || hairStyle === 'wild' || hairStyle === 'medium';
  const cut = {
    style: hairStyle,
    hairline: hairlineShape,
    // Parting: which side, and how deep a gap it cuts into the fringe.
    part: r.weighted([{ v: -1, w: 3 }, { v: 1, w: 3 }, { v: 0, w: 2.5 }]).v,
    partGap: r.float(0.5, 1.0),
    // Asymmetry so no two hairlines mirror each other.
    slant: r.float(-0.9, 0.9),
    volume: r.float(0.90, 1.16) * (hairStyle === 'wild' ? 1.08 : 1),
    length: r.float(0.75, 1.30),
    // Falls in front of the shoulders, or is pushed back behind them.
    front: longish && r.bool(sex === 'f' ? 0.62 : 0.40),
    frontSide: r.weighted([{ v: 0, w: 3 }, { v: -1, w: 2 }, { v: 1, w: 2 }]).v,
    sideburn: sex === 'm' ? r.float(0.0, 1.0) : 0,
  };

  const beard = sex === 'f' ? 'none' : r.weighted([
    { v: 'none', w: young ? 6 : 3 }, { v: 'stubble', w: 4 },
    { v: 'moustache', w: 2.5 }, { v: 'chin', w: 1.6 }, { v: 'short', w: 3.5 },
    { v: 'full', w: old ? 3.5 : 2.5 }, { v: 'long', w: old ? 3 : 1 },
  ]).v;

  const shp = FACE_SHAPES[shapeName];
  const fem = sex === 'f';
  // Overall head mass, on top of the skull shape: two `round` faces of
  // different builds should still not be confusable.
  const mass = r.float(0.92, 1.07);
  const rx = shp.rx * (fem ? 0.955 : 1) * mass * r.float(0.98, 1.02);
  const ry = shp.ry * (fem ? 0.985 : 1) * (0.5 + mass * 0.5) * r.float(0.98, 1.02);

  // Head sits a touch right of centre and turns to the viewer's left, which is
  // how nearly every portrait in the original is composed.
  const headCX = DW * 0.5 + r.float(0.0, 2.0);
  const headTop = 8.6 + r.float(-1.0, 1.6) + (1 - mass) * 6;
  const turn = -r.float(0.10, 0.22);

  const gear = classGear(klass, r, sex, age, hairStyle);

  return {
    seed: key, sex, klass, age, shape: shapeName, mass,
    toneName, skin: skinRamp(toneName),
    hairName, hairStyle, cut, hair: buildHairColours(hairName),
    eyeName: r.pick(Object.keys(EYE_COLOURS)),
    beard,
    geom: {
      headCX, headTop, rx, ry, rz: rx * 1.02,
      wTop: shp.wTop, wTemple: shp.wTemple, wCheek: shp.wCheek,
      wJaw: shp.wJaw * (fem ? 0.93 : 1) * (old ? 1.05 : 1) * r.float(0.94, 1.07),
      wChin: shp.wChin * (fem ? 0.92 : 1) * r.float(0.90, 1.12),
      turn,
      browY: headTop + ry * (0.845 + r.float(-0.035, 0.035)),
      browHeavy: (fem ? 0.40 : 1.0) * (old ? 1.35 : 1) * r.float(0.60, 1.50),
      browThick: (fem ? 0.55 : 1.0) * r.float(0.70, 1.40) * (old ? 1.30 : 1),
      browArch: fem ? r.float(0.8, 1.7) : r.float(0.15, 1.0),
      eyeSep: rx * r.float(0.355, 0.445),
      eyeW: rx * (fem ? 0.232 : 0.218) * r.float(0.88, 1.12),
      eyeOpenBase: (fem ? 1.06 : 0.98) * r.float(0.90, 1.10),
      noseW: rx * (fem ? 0.178 : 0.205) * r.float(0.82, 1.26),
      noseLen: r.float(0.31, 0.41),
      noseBulb: r.float(0.5, 1.6) * (fem ? 0.85 : 1),
      noseHook: r.float(-0.5, 1.15) * (old ? 1.3 : 1),
      mouthW: rx * (fem ? 0.295 : 0.315) * r.float(0.86, 1.14),
      lipFull: (fem ? 1.35 : 1.0) * r.float(0.72, 1.30),
      cheekBone: r.float(0.5, 1.6) + (shapeName === 'gaunt' ? 0.40 : 0) + (old ? 0.30 : 0),
      hollow: (shapeName === 'gaunt' ? 0.90 : 0.18) + (old ? 0.45 : 0)
        + (shapeName === 'heavy' ? -0.18 : 0),
      jowl: (old ? r.float(0.4, 1.0) : 0) + (shapeName === 'heavy' ? 0.45 : 0),
      ears: r.float(0.75, 1.30),
    },
    marks: {
      wrinkle: old ? r.float(1.00, 1.35) : (age === 'middle' ? r.float(0.18, 0.55) : 0.06),
      freckles: r.bool(0.24) && !darkSkin ? r.float(0.4, 1) : 0,
      scar: r.bool(0.22) ? { side: r.bool() ? 1 : -1, y: r.float(-0.3, 0.5), len: r.float(0.5, 1) } : null,
      stubbleTone: r.float(0.8, 1.2),
      weather: r.float(0.5, 1.1),
    },
    gear,
    bgTint: classBgTint(klass),
    noiseSeed: (typeof key === 'string' ? 7919 : key | 0) ^ 0x2f1b,
  };
}

function buildHairColours(name) {
  const base = HAIR_COLOURS[name]();
  const light = name === 'white' || name === 'grey' || name === 'blonde' || name === 'sandy';
  return {
    base,
    dark: scl(base, light ? 0.40 : 0.32),
    lite: mixC(scl(base, light ? 1.28 : 1.62), rs('sand', 0.85), light ? 0.26 : 0.16),
    sheen: light ? 0.80 : 0.55,
    // Facial hair reads darker than head hair - it sits in the shadow of the
    // jaw and is coarser. Pale beards otherwise turn into a bright bib.
    beard: scl(base, light ? 0.62 : 0.80),
    beardDark: scl(base, light ? 0.26 : 0.20),
  };
}

/**
 * Headgear is the exception, not the rule: roughly a third of faces wear
 * anything at all, and class only shifts the odds. A row of four adventurers
 * that is four hoods reads as one adventurer painted four times, which is
 * exactly the failure this table exists to avoid.
 */
function classGear(klass, r, sex, age, hairStyle) {
  const steel = { base: rs('stone', 0.42), dark: rs('stone', 0.09), lite: rs('grey', 0.74) };
  const g = {
    helm: null, coif: false, hood: null, hat: null,
    collar: 'cloth', trim: null, symbol: null, mantle: false, steel,
  };
  // Cloth colour for whatever the shoulders end up wearing, chosen even when
  // there is no hood so two bare-headed clerics are not in identical robes.
  const robeRamps = ['plaster', 'stone', 'dirt', 'wood', 'swamp', 'blood', 'sky'];
  g.robe = { ramp: r.pick(robeRamps), t: r.float(0.20, 0.42) };
  const hoodOf = (ramp, t, peak, tight) => ({
    ramp, t, peak, tight,
    // Every hood gets its own irregular opening: an off-centre, slightly
    // rotated hole with a couple of lobes, so the face is never a clean oval
    // mask set in a clean oval hole.
    ox: r.float(-1.1, 0.9), oy: r.float(-0.8, 1.0), rot: r.float(-0.28, 0.28),
    lobe1: r.float(0.05, 0.13), lobe2: r.float(0.03, 0.09), ph: r.float(0, 6.28),
    drapeL: r.float(0.85, 1.25), drapeR: r.float(0.85, 1.25),
  });

  switch (klass) {
    case 'knight': {
      g.collar = 'plate';
      const k = r.float(0, 1);
      if (k < 0.20) g.helm = { kind: 'open', nasal: r.bool(0.8), cheek: r.bool(0.4), gold: 0 };
      else if (k < 0.38) g.coif = true;
      break;
    }
    case 'paladin': {
      g.collar = 'plate';
      g.trim = 'gold';
      g.symbol = r.bool(0.45) ? 'sun' : null;
      const k = r.float(0, 1);
      if (k < 0.18) g.helm = { kind: 'open', nasal: r.bool(0.75), cheek: r.bool(0.3), gold: 1 };
      else if (k < 0.34) g.coif = true;
      break;
    }
    case 'archer':
      g.collar = 'leather';
      if (r.bool(0.15)) g.hood = hoodOf('foliage', r.float(0.30, 0.46), 0.25, 0.0);
      break;
    case 'cleric':
      g.collar = 'robe';
      g.symbol = 'cross';
      if (r.bool(0.42)) g.hood = hoodOf(r.bool(0.5) ? 'plaster' : 'stone', r.float(0.26, 0.46), 0.10, 0.05);
      break;
    case 'sorcerer': {
      g.collar = 'arcane';
      g.mantle = r.bool(0.55);
      const k = r.float(0, 1);
      if (k < 0.11) g.hat = { tilt: r.float(-1.5, -0.5), len: r.float(0.9, 1.15) };
      else if (k < 0.20) g.hood = hoodOf('sky', r.float(0.14, 0.26), 0.5, 0.02);
      break;
    }
    case 'druid':
      g.collar = 'robe';
      if (r.bool(0.36)) g.hood = hoodOf('grass', r.float(0.24, 0.42), 0.42, -0.03);
      break;
  }
  // A hood no longer flattens the hair to a stub: the cut still shows through
  // the opening and escapes at the temples.
  g.hairVisible = g.hood ? 1 : 1;
  if (g.helm) g.hairVisible = 0.85;
  if (g.coif) g.hairVisible = 0.16;
  if (hairStyle === 'bald') g.hairVisible = 0;
  return g;
}

function classBgTint(klass) {
  switch (klass) {
    case 'archer': return [0.90, 1.02, 0.86];
    case 'druid': return [0.88, 1.03, 0.84];
    case 'sorcerer': return [0.94, 0.92, 1.12];
    case 'cleric': return [1.04, 1.00, 0.92];
    case 'paladin': return [1.08, 1.00, 0.88];
    default: return [1, 1, 1];
  }
}

// --- expression table ------------------------------------------------------
// Every field is a delta on the neutral pose; `paint` reads them straight.

const EXPR_BASE = {
  browIn: 0, browOut: 0, browThick: 1, browTilt: 0,
  eyeOpenL: 1, eyeOpenR: 1, lidLow: 0, pupil: 1, gazeX: 0, gazeY: 0, wide: 0,
  mouthCurve: 0, mouthOpen: 0, mouthW: 1, teeth: 0, mouthSkew: 0, mouthRound: 0,
  tilt: 0, key: 1, amb: 1, tint: [1, 1, 1], sat: 1,
  hollow: 0, wound: 0, blush: 0, blotch: 0, pale: 0,
  stone: 0, ash: 0, arcane: 0, glow: 0, rimGold: 0,
};

const EXPR = {
  normal: {},
  smile: { browIn: -0.25, eyeOpenL: 0.80, eyeOpenR: 0.80, lidLow: 0.35, mouthCurve: 1.7, mouthOpen: 0.22, teeth: 0.4, key: 1.08, tint: [1.03, 1.00, 0.97] },
  wide_smile: { browIn: -0.5, browOut: -0.3, eyeOpenL: 0.66, eyeOpenR: 0.66, lidLow: 0.5, mouthCurve: 2.2, mouthOpen: 0.42, mouthW: 1.12, teeth: 0.95, key: 1.12, tint: [1.04, 1.00, 0.96] },
  level_up: { browIn: -0.6, browOut: -0.4, eyeOpenL: 0.86, eyeOpenR: 0.86, lidLow: 0.25, mouthCurve: 1.9, mouthOpen: 0.30, teeth: 0.7, key: 1.22, amb: 1.15, rimGold: 1, tint: [1.07, 1.02, 0.90] },
  sad: { browIn: -1.5, browOut: 1.0, browTilt: -0.9, eyeOpenL: 0.74, eyeOpenR: 0.74, lidLow: 0.2, gazeY: 0.5, mouthCurve: -1.15, mouthW: 0.94, key: 0.92, tint: [0.96, 0.98, 1.04] },
  hurt: { browIn: 1.5, browOut: -0.9, browTilt: -0.5, eyeOpenL: 0.30, eyeOpenR: 0.34, mouthCurve: -1.3, mouthOpen: 0.72, teeth: 0.55, wound: 1, key: 1.02, tint: [1.05, 0.93, 0.90] },
  dmg_minor: { browIn: 0.85, browOut: -0.4, eyeOpenL: 0.58, eyeOpenR: 0.50, mouthCurve: -0.6, mouthOpen: 0.20, mouthSkew: 0.5, wound: 0.35, key: 1.0 },
  dmg_moderate: { browIn: 1.35, browOut: -0.7, browTilt: -0.4, eyeOpenL: 0.32, eyeOpenR: 0.26, mouthCurve: -1.0, mouthOpen: 0.50, teeth: 0.45, wound: 0.7, tilt: 2 },
  dmg_major: { browIn: 1.9, browOut: -1.1, browTilt: -0.7, eyeOpenL: 0.10, eyeOpenR: 0.14, mouthCurve: -1.5, mouthOpen: 0.95, mouthW: 1.06, teeth: 0.85, wound: 1, tilt: 5, key: 0.98, tint: [1.06, 0.92, 0.89] },
  avoid: { browIn: -0.9, browOut: -0.6, eyeOpenL: 1.14, eyeOpenR: 1.14, gazeX: 0.85, gazeY: -0.2, mouthCurve: -0.3, mouthOpen: 0.22, mouthW: 0.82, tilt: -7 },
  angry: { browIn: 2.0, browOut: -1.0, browTilt: 0.9, browThick: 1.15, eyeOpenL: 0.72, eyeOpenR: 0.72, lidLow: 0.4, pupil: 0.85, mouthCurve: -0.85, mouthW: 0.93, key: 1.05, tint: [1.12, 0.92, 0.84] },
  scared: { browIn: -1.9, browOut: -1.5, browTilt: -1.0, eyeOpenL: 1.42, eyeOpenR: 1.42, wide: 1, pupil: 0.66, mouthCurve: -0.4, mouthOpen: 0.5, mouthW: 0.62, mouthRound: 1, key: 0.98, tint: [0.92, 0.97, 1.10], sat: 0.85 },
  poisoned: { browIn: 0.6, browOut: -0.3, eyeOpenL: 0.42, eyeOpenR: 0.46, mouthCurve: -0.7, mouthOpen: 0.16, hollow: 1, tint: [0.70, 1.02, 0.64], sat: 0.9, key: 0.95 },
  diseased: { browIn: 0.35, eyeOpenL: 0.48, eyeOpenR: 0.44, mouthCurve: -0.5, mouthOpen: 0.10, hollow: 0.75, blotch: 1, tint: [1.02, 0.96, 0.66], sat: 0.5, key: 0.9 },
  asleep: { eyeOpenL: 0, eyeOpenR: 0, tilt: 8, mouthCurve: 0.45, mouthOpen: 0.18, browIn: -0.2, key: 0.88, amb: 0.95 },
  drunk: { eyeOpenL: 0.50, eyeOpenR: 0.26, browIn: -0.3, browOut: 0.5, mouthCurve: 0.95, mouthOpen: 0.22, mouthSkew: 1, blush: 1, tilt: 4, tint: [1.10, 0.94, 0.90] },
  insane: { eyeOpenL: 1.45, eyeOpenR: 0.42, browIn: -1.2, browOut: -0.8, browTilt: 1.2, mouthCurve: 1.9, mouthOpen: 0.55, teeth: 0.95, mouthSkew: 0.6, sat: 0.62, tint: [1.02, 0.99, 1.04], key: 1.05 },
  paralyzed: { eyeOpenL: 1.25, eyeOpenR: 1.25, pupil: 0.5, mouthOpen: 0.16, tint: [0.84, 0.93, 1.12], sat: 0.42, key: 0.95, wide: 0.6 },
  unconscious: { eyeOpenL: 0, eyeOpenR: 0, tilt: 16, mouthOpen: 0.34, mouthCurve: -0.3, pale: 1, key: 0.80, amb: 0.9 },
  dead: { eyeOpenL: 0.06, eyeOpenR: 0.06, tilt: 11, mouthOpen: 0.48, mouthCurve: -0.5, sat: 0.16, tint: [0.86, 0.93, 0.88], key: 0.70, amb: 0.85, hollow: 0.5 },
  stoned: { eyeOpenL: 0.88, eyeOpenR: 0.88, mouthOpen: 0.05, stone: 1 },
  eradicated: { eyeOpenL: 0.5, eyeOpenR: 0.5, mouthOpen: 0.4, ash: 1 },
  cast: { eyeOpenL: 1.12, eyeOpenR: 1.12, browIn: -0.5, mouthOpen: 0.5, mouthRound: 0.6, mouthCurve: -0.1, glow: 1, arcane: 1, key: 0.95, tint: [0.98, 0.98, 1.06] },
  talk1: { mouthOpen: 0.05, mouthW: 0.96, mouthCurve: 0.15 },
  talk2: { mouthOpen: 0.36, mouthW: 0.78, mouthRound: 1, mouthCurve: 0.1 },
  talk3: { mouthOpen: 0.62, mouthW: 1.06, teeth: 0.4, browIn: -0.3 },
  talk4: { mouthOpen: 0.28, mouthW: 1.10, mouthCurve: 0.5, teeth: 0.55 },
};

function exprOf(name) {
  const e = EXPR[name] || EXPR.normal;
  return Object.assign({}, EXPR_BASE, e);
}

// ---------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------

// One set of working buffers, reused by every portrait. Allocating five typed
// arrays per render churned ~1.2 MB a frame through the loading stage, which
// is exactly the kind of pressure that gets a tab killed mid-load.
const scratch = { n: 0, buf: null, subj: null, hgt: null, hcv: null, hair: null };
const bgCache = { key: '', data: null };
function getScratch(N) {
  if (scratch.n < N) {
    scratch.n = N;
    scratch.buf = new Float32Array(N * 3);
    scratch.subj = new Float32Array(N);
    scratch.hgt = new Float32Array(N);
    scratch.hcv = new Float32Array(N);
    scratch.hair = new Float32Array(N);
  } else {
    scratch.subj.fill(0, 0, N);
    scratch.hgt.fill(0, 0, N);
    scratch.hcv.fill(0, 0, N);
    scratch.hair.fill(0, 0, N);
  }
  return scratch;
}

function paint(face, ex, W, H) {
  const BW = W * SS, BH = H * SS, N = BW * BH;
  const sc = getScratch(N);
  const buf = sc.buf;      // fully overwritten by the background pass
  const subj = sc.subj;    // subject coverage, for ash/stone grading
  const hgt = sc.hgt;      // head height field
  const hcv = sc.hcv;      // head coverage
  const hair = sc.hair;    // hair coverage
  const px2dx = DW / BW, px2dy = DH / BH;

  const g = face.geom;
  const S = face.skin;
  const sd = face.noiseSeed;

  // --- derived layout ------------------------------------------------------
  const rx = g.rx, ry = g.ry;
  const hcx = g.headCX, hcy = g.headTop + ry;
  const chinY = g.headTop + 2 * ry;
  const turn = g.turn;
  const fx = hcx + turn * rx;                     // face midline of a turned head
  const near = -Math.sign(turn) || 1;             // side of the head facing us
  const rNear = rx * (1 + Math.abs(turn));        // half-widths measured from fx
  const rFar = rx * (1 - Math.abs(turn));
  const browY = g.browY;
  const eyeY = browY + ry * 0.155;
  const noseY = eyeY + ry * g.noseLen;
  const mouthY = noseY + ry * 0.255;
  const eyeSep = g.eyeSep;
  const hairlineY = g.headTop + ry * 0.36;

  const ang = (ex.tilt * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pvx = hcx, pvy = chinY + 8;

  // Pale conditions wash the whole ramp out; do it once, not per pixel.
  const SR = ex.pale
    ? { ramp: S.ramp.map((c) => mixC(c, [168, 166, 170], 0.34)), bounce: mixC(S.bounce, [120, 118, 124], 0.3), ruddy: S.ruddy * 0.4 }
    : S;

  // Key from the upper front left; cool rim from the lower right.
  const LX = -0.505, LY = -0.575, LZ = 0.644;
  const RX = 0.80, RY = -0.30, RZ = -0.52;

  // Every colour that does not depend on the pixel, resolved once. Sampling
  // ramps inside the pixel loop costs more than all the shading maths.
  const C = {
    rim: ex.arcane ? rs('arcane', 0.72) : rs('sand', 0.72),
    gold: rs('gold', 0.80),
    spec: [255, 246, 236],
    blush: rs('blood', 0.44),
    noseRed: rs('blood', 0.46),
    wound: rs('blood', 0.28),
    disease: rs('swamp', 0.42),
    freck: scl(SR.ramp[2], 1.05),
    scar: mixC(scl(SR.ramp[4], 0.94), rs('blood', 0.34), 0.14),
    lash: mixC(face.hair.dark, [14, 10, 11], 0.5),
    nostril: mixC(SR.ramp[0], [16, 9, 9], 0.4),
    // Sclera tracks the skin: a bright warm grey against ebony skin reads as
    // two headlights, which is the classic tell of a badly painted dark face.
    sclera: mixC(mixC(rs('sand', 0.62), rs('stone', 0.70), 0.46), SR.ramp[2], SR.lift * 0.85),
    vessel: rs('blood', 0.38),
    iris: EYE_COLOURS[face.eyeName](),
    pupil: ex.glow ? rs('arcane', 0.85) : [11, 8, 9],
    glow: rs('arcane', 0.9),
    catch: [252, 248, 240],
    greyHair: rs('grey', 0.55),
    lipUp: mixC(scl(SR.ramp[2], 0.86), rs('blood', 0.26), 0.16 * g.lipFull),
    lipDn: mixC(mixC(SR.ramp[3], rs('blood', 0.34), 0.13 * g.lipFull), SR.ramp[4], 0.26),
    lipLine: mixC(scl(SR.ramp[0], 1.10), rs('blood', 0.12), 0.25),
    mouthIn: mixC(rs('blood', 0.08), [7, 4, 5], 0.45),
    tongue: rs('blood', 0.26),
    teeth: mixC(rs('sand', 0.80), rs('grey', 0.72), 0.45),
  };

  // =========================================================================
  // 1. background - a warm mottled pool behind the head, cold in the corners
  // =========================================================================
  // The plate behind the head is identical for every expression of a face, so
  // it is painted once and memcpy'd for the other twenty-six frames.
  const bgKey = `${faceKey(face)}|${BW}x${BH}`;
  if (bgCache.key === bgKey) {
    buf.set(bgCache.data.subarray(0, N * 3));
  } else {
    const warm = mixC(rs('dirt', 0.40), rs('sand', 0.30), 0.35);
    const cold = mixC(rs('stone', 0.05), rs('grey', 0.03), 0.5);
    const bt = face.bgTint;
    const w0 = warm[0] * bt[0], w1 = warm[1] * bt[1], w2 = warm[2] * bt[2];
    const c0 = cold[0] * bt[0], c1 = cold[1] * bt[1], c2 = cold[2] * bt[2];
    for (let py = 0; py < BH; py++) {
      const Y = (py + 0.5) * px2dy;
      for (let pxi = 0; pxi < BW; pxi++) {
        const X = (pxi + 0.5) * px2dx;
        // Pool of light behind the head, offset up and to the light side, so
        // the silhouette always has something to separate against.
        const d = Math.sqrt(ell(X - (hcx - 5), Y - (hcy - 7), 26, 28));
        let t = 1 - smoothstep(0.10, 1.20, d);
        const cvi = 1 - smoothstep(0.50, 1.30, Math.sqrt(ell(X - DW / 2, Y - DH / 2, DW * 0.60, DH * 0.60)));
        t = t * 0.90 + cvi * 0.24;
        // Mottling: two scales of noise plus a diagonal brush drag.
        const m1 = fb(X * 0.085, Y * 0.085, 3, sd + 3) - 0.5;
        const m2 = fb(X * 0.26 + Y * 0.05, Y * 0.30, 2, sd + 9) - 0.5;
        const drag = nz(X * 0.10 + Y * 0.34, Y * 0.045, sd + 21) - 0.5;
        t = clamp(t + m1 * 0.36 + m2 * 0.13 + drag * 0.11, 0, 1.3);
        const i = (py * BW + pxi) * 3;
        buf[i] = c0 + (w0 - c0) * t;
        buf[i + 1] = c1 + (w1 - c1) * t;
        buf[i + 2] = c2 + (w2 - c2) * t;
      }
    }
    if (!bgCache.data || bgCache.data.length < N * 3) bgCache.data = new Float32Array(N * 3);
    bgCache.data.set(buf.subarray(0, N * 3));
    bgCache.key = bgKey;
  }

  // =========================================================================
  // 2. height field for the head + hair mask
  // =========================================================================
  const hairP = hairParams(face, g, hairlineY, hcx, hcy, rx, ry, fx, near);

  for (let py = 0; py < BH; py++) {
    const Yw = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const Xw = (pxi + 0.5) * px2dx;
      // Head space (undo the tilt).
      const ddx = Xw - pvx, ddy = Yw - pvy;
      const X = pvx + ddx * ca + ddy * sa;
      const Y = pvy - ddx * sa + ddy * ca;
      const i = py * BW + pxi;

      // --- silhouette ------------------------------------------------------
      // Measured from the face midline with different half-widths each side:
      // same outline as a centred ellipse, but the depth peak lands over the
      // nose, so the far cheek falls away steeply. That is the whole turn.
      const v = (Y - hcy) / ry;
      const wp = widthProfile(clamp(v, -1, 1), g);
      const dxm = X - fx;
      const u = dxm / ((dxm * near > 0 ? rNear : rFar) * wp);
      const m = u * u + Math.pow(Math.abs(v), 2.35);
      let c = cov(m, 0.13);
      // Near ear only - the far one is hidden by the turn.
      if (!face.gear.hood && !face.gear.coif && hairP.showEars) {
        const ey = eyeY + ry * 0.17;
        const er = ell(X - (hcx + near * rx * 0.95), Y - ey, rx * 0.20 * g.ears, ry * 0.25 * g.ears);
        c = Math.max(c, cov(er, 0.32) * 0.98);
      }
      hcv[i] = c;
      if (c <= 0.002) { hgt[i] = 0; hair[i] = hairCov(hairP, X, Y, sd); continue; }

      // --- height ----------------------------------------------------------
      let z = g.rz * Math.sqrt(Math.max(0, 1 - Math.min(1, m)));
      const dxf = dxm;

      // brow ridge: a shelf above the eyes, heavier on men and the old
      z += blob(dxf, Y - (browY + 0.4), rx * 0.90, ry * 0.130) * 1.55 * g.browHeavy;
      z += blob(Math.abs(dxf) - eyeSep * 0.9, Y - (browY + 0.8), rx * 0.28, ry * 0.10) * 0.8 * g.browHeavy;
      // eye sockets, with the ball sitting back inside
      for (const s of [-1, 1]) {
        const ex0 = dxf - s * eyeSep;
        z -= blob(ex0, Y - eyeY, rx * 0.30, ry * 0.115) * 1.35;
        z += blob(ex0, Y - eyeY, rx * 0.21, ry * 0.090) * 1.05;
      }
      // nose: a rounded wedge running into the bulb, plus the wings
      const nt = clamp((Y - (browY + 0.8)) / (noseY - browY - 0.8), 0, 1.35);
      if (nt > 0) {
        const hook = 1 + g.noseHook * 0.22 * Math.sin(nt * Math.PI);
        const bw = g.noseW * (0.62 + nt * 0.52) * hook;
        const ramp = 0.7 + nt * nt * 1.7;
        const t = Math.max(0, 1 - (dxf * dxf) / (bw * bw));
        z += t * Math.sqrt(t) * ramp * (1 - smoothstep(1.0, 1.30, nt));
      }
      z += blob(dxf, Y - (noseY - 0.4), g.noseW * 0.92, ry * 0.052) * 1.6 * g.noseBulb;
      z += blob(dxf - g.noseW * 0.86, Y - (noseY + 0.1), g.noseW * 0.58, ry * 0.048) * 1.0;
      z += blob(dxf + g.noseW * 0.86, Y - (noseY + 0.1), g.noseW * 0.58, ry * 0.048) * 1.0;
      // cheekbones and the hollow under them
      z += blob(Math.abs(dxf) - rx * 0.54, Y - (eyeY + ry * 0.115), rx * 0.34, ry * 0.115) * 1.25 * g.cheekBone;
      z -= blob(Math.abs(dxf) - rx * 0.52, Y - (noseY + ry * 0.06), rx * 0.28, ry * 0.115)
        * (1.15 * g.hollow + 1.4 * ex.hollow);
      // muzzle, lips, chin
      z += blob(dxf, Y - (mouthY - 0.4), rx * 0.52, ry * 0.135) * 1.05;
      const lipY = mouthY + ex.mouthOpen * 1.4;
      z += blob(dxf, Y - (lipY - ry * 0.055), g.mouthW * 0.92, ry * 0.055) * 0.85 * g.lipFull;
      z += blob(dxf, Y - (lipY + ry * 0.068), g.mouthW * 0.82, ry * 0.068) * 1.05 * g.lipFull;
      z -= blob(dxf, Y - lipY, g.mouthW * 0.95, ry * 0.024) * 1.1;
      z += blob(dxf, Y - (chinY - ry * 0.150), rx * 0.30, ry * 0.110) * 1.05;
      z -= blob(dxf, Y - (chinY - ry * 0.250), rx * 0.24, ry * 0.042) * 0.55;
      // jaw line: a ridge running from below the ear to the chin
      {
        const jd = segDist(X, Y, hcx + near * rx * 0.86, eyeY + ry * 0.30,
          fx + near * rx * 0.16, chinY - ry * 0.10);
        z += Math.max(0, 1 - jd / (rx * 0.16)) * 0.75;
      }
      if (g.jowl > 0) {
        z += blob(Math.abs(dxf) - rx * 0.48, Y - (mouthY + ry * 0.10), rx * 0.24, ry * 0.10) * 0.9 * g.jowl;
      }
      // temples pull in, harder on old faces
      z -= blob(Math.abs(dxf) - rx * 0.78, Y - (browY - ry * 0.10), rx * 0.22, ry * 0.11)
        * (0.7 + face.marks.wrinkle * 0.8);
      // fine skin relief so the light never lands on a perfectly smooth surface
      z += (fb(X * 0.85, Y * 0.85, 2, sd + 33) - 0.5) * (0.14 + face.marks.wrinkle * 0.22);

      hgt[i] = z;
      hair[i] = hairCov(hairP, X, Y, sd);
    }
  }

  // =========================================================================
  // 3. neck, lit head, features
  // =========================================================================
  const neckCX = fx + rx * 0.10;
  const neckW = rx * 0.44;
  const hn = 1 / Math.sqrt(LX * LX + LY * LY + (LZ + 1) * (LZ + 1));
  const HX = LX * hn, HY = LY * hn, HZ = (LZ + 1) * hn;   // half-vector, key + eye
  const featTop = browY - ry * 0.30;
  // A hood or helm rim sits in front of the forehead and darkens the band of
  // face just inside it.
  const gearShadow = (() => {
    const hd = face.gear.hood;
    if (hd) {
      const hole = hoodHoleFn(hd, fx, hcy, rx, ry);
      return (X, Y) => {
        const e = hole(X, Y);
        return smoothstep(0.62, 0.97, e) * (1 - smoothstep(0.99, 1.06, e));
      };
    }
    if (face.gear.helm) return (X, Y) => smoothstep(browY - 4.5, browY - 1.6, Y) * (1 - smoothstep(browY - 1.6, browY + 0.6, Y));
    if (face.gear.coif) {
      const orx = rx * 1.00, ory = ry * 1.02, ocy = hcy + ry * 0.16;
      return (X, Y) => {
        const e = ell(X - fx, Y - ocy, orx, ory);
        return smoothstep(0.70, 0.98, e) * (1 - smoothstep(1.0, 1.08, e));
      };
    }
    return null;
  })();
  const FP = { face, ex, g, SR, C, fx, browY, eyeY, noseY, mouthY, eyeSep, chinY, rx, ry, near, sd };

  for (let py = 0; py < BH; py++) {
    const Yw = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const Xw = (pxi + 0.5) * px2dx;
      const ddx = Xw - pvx, ddy = Yw - pvy;
      const X = pvx + ddx * ca + ddy * sa;
      const Y = pvy - ddx * sa + ddy * ca;
      const ii = py * BW + pxi;
      const i3 = ii * 3;

      // --- neck ------------------------------------------------------------
      // The underside of a jaw is nearly always the darkest thing on a
      // portrait. Without it the head floats.
      if (Y > mouthY && hcv[ii] < 0.99) {
        const flare = 1 + smoothstep(chinY, chinY + 14, Y) * 0.50;
        const nw = neckW * flare;
        const t = (X - neckCX) / nw;
        const nc = smoothstep(1.10, 0.86, Math.abs(t)) * smoothstep(mouthY, mouthY + 3, Y);
        if (nc > 0.003) {
          let sh = 0.12 + 0.40 * Math.max(0, 1 - (t + 0.50) * (t + 0.50) * 1.15);
          sh *= mix(0.12, 1, smoothstep(chinY - 2, chinY + 10, Y));
          sh += (fb(X * 0.9, Y * 0.9, 2, sd + 51) - 0.5) * 0.05;
          bl(buf, i3, skinShade(sh * ex.key, SR), nc);
          subj[ii] = Math.max(subj[ii], nc);
        }
      }

      const hc = hcv[ii];
      if (hc <= 0.003) continue;
      subj[ii] = Math.max(subj[ii], hc);

      // --- normal from the height field -------------------------------------
      const xm = pxi > 0 ? ii - 1 : ii, xp = pxi < BW - 1 ? ii + 1 : ii;
      const ym = py > 0 ? ii - BW : ii, yp = py < BH - 1 ? ii + BW : ii;
      let nx = -(hgt[xp] - hgt[xm]) / (2 * px2dx);
      let ny = -(hgt[yp] - hgt[ym]) / (2 * px2dy);
      nx = clamp(nx, -4, 4); ny = clamp(ny, -4, 4);
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= nl; ny *= nl;
      const nzc = nl;

      const diff = Math.max(0, nx * LX + ny * LY + nzc * LZ);
      const ambSky = 0.160 + 0.080 * Math.max(0, -ny);
      let sh = (ambSky * ex.amb + Math.pow(diff, 1.30) * 0.74) * ex.key;

      // --- occlusion --------------------------------------------------------
      const dxf = X - fx;
      let ao = 1;
      ao -= blob(dxf, Y - (browY + ry * 0.075), rx * 0.86, ry * 0.075) * 0.46;   // under the brow
      for (const s of [-1, 1]) {
        ao -= blob(dxf - s * eyeSep, Y - (eyeY - ry * 0.02), rx * 0.29, ry * 0.10) * 0.34;
      }
      // The nose casts: a soft core shadow down its right flank (key is from
      // the left) and a hard one onto the lip below it. Local shading alone
      // cannot produce a cast shadow, so it is painted in here.
      ao -= blob(dxf - g.noseW * 1.15, Y - (noseY - ry * 0.11), g.noseW * 0.85, ry * 0.19) * 0.42;
      ao -= blob(dxf + g.noseW * 1.05, Y - (noseY - ry * 0.11), g.noseW * 0.60, ry * 0.16) * 0.16;
      ao -= blob(dxf + g.noseW * 0.35, Y - (noseY + ry * 0.055), g.noseW * 1.35, ry * 0.050) * 0.60;
      ao -= blob(dxf, Y - (mouthY + ry * 0.10), g.mouthW * 0.85, ry * 0.045) * 0.30; // under the lip
      ao -= blob(Math.abs(dxf) - rx * 0.52, Y - (noseY + ry * 0.07), rx * 0.30, ry * 0.13)
        * (0.32 * g.hollow + 0.45 * ex.hollow);
      ao -= smoothstep(chinY - ry * 0.06, chinY + 1.5, Y) * 0.38;                   // jaw underside
      ao -= hairShadowAt(hairP, X, Y) * 0.38;
      // headgear throws its own edge across the face
      if (gearShadow) ao -= gearShadow(X, Y) * 0.55;
      // the far cheek turns away from the light and the viewer at once
      ao -= smoothstep(rFar * 0.55, rFar * 1.05, -dxf * near) * 0.14;
      ao = clamp(ao, 0.18, 1);
      sh *= ao;

      let col = skinShade(sh, SR);

      // Warm bounce into downward-facing surfaces (chest light off the collar).
      col = mixC(col, SR.bounce, Math.max(0, ny) * 0.30 * smoothstep(eyeY, chinY, Y));
      // rim light on the shadow side keeps the head off the background
      const rim = Math.pow(Math.max(0, nx * RX + ny * RY + nzc * RZ), 2.4) * (1 - nzc * 0.5);
      col = add3(col, C.rim, rim * (ex.arcane ? 0.60 : 0.36));
      if (ex.rimGold) col = add3(col, C.gold, rim * 0.5);
      // tight specular on nose tip / cheekbone / forehead
      const spec = Math.pow(Math.max(0, nx * HX + ny * HY + nzc * HZ), 34) * 0.10;
      col = add3(col, C.spec, spec * (1 - 0.4 * ex.hollow));

      // weathered skin: mottle, freckles, blush
      col = scl(col, 1 + (fb(X * 0.95, Y * 0.95, 2, sd + 77) - 0.5) * 0.042 * face.marks.weather);
      if (face.marks.freckles > 0 && Y < noseY + 3) {
        const f = nz(X * 3.1, Y * 3.1, sd + 101);
        if (f > 0.80) {
          col = mixC(col, C.freck, (f - 0.80) * 2.2 * face.marks.freckles
            * smoothstep(noseY + 3, eyeY, Y));
        }
      }
      const cheekBlush = blob(Math.abs(dxf) - rx * 0.46, Y - (noseY - ry * 0.04), rx * 0.30, ry * 0.14);
      if (cheekBlush > 0) col = mixC(col, mixC(col, C.blush, 0.45), cheekBlush * (0.11 + ex.blush * 0.50));
      const noseRed = blob(dxf, Y - (noseY - 0.6), g.noseW * 1.15, ry * 0.075);
      if (noseRed > 0) col = mixC(col, mixC(col, C.noseRed, 0.45), noseRed * (0.13 + ex.blush * 0.55));
      if (ex.wound) {
        const wsx = face.marks.scar ? face.marks.scar.side : near;
        const w = blob(Math.abs(dxf - wsx * rx * 0.52) - 0.6, Y - (noseY - ry * 0.08), rx * 0.34, ry * 0.20);
        if (w > 0) {
          col = mixC(col, C.wound, w * w * 0.75 * ex.wound * (0.45 + 0.55 * nz(X * 1.6, Y * 1.6, sd + 5)));
        }
      }
      if (ex.blotch) {
        const b = fb(X * 0.55, Y * 0.55, 3, sd + 131);
        col = mixC(col, mixC(col, C.disease, 0.8), smoothstep(0.58, 0.82, b) * 0.55);
      }

      // --- wrinkles ---------------------------------------------------------
      const wr = face.marks.wrinkle;
      if (wr > 0.1) {
        let dk = 0, lt = 0;
        if (Y < browY) {                       // forehead lines
          for (let k = 0; k < 3; k++) {
            const yy = browY - ry * (0.105 + k * 0.070)
              + (0.55 - k * 0.12) * (dxf * dxf) / (rx * rx) * ry * 0.5;
            const span = smoothstep(rx * 0.84, rx * 0.58, Math.abs(dxf));
            dk += Math.max(0, 1 - Math.abs(Y - yy) / 0.40) * span * (k === 0 ? 1 : 0.75);
            lt += Math.max(0, 1 - Math.abs(Y - (yy - 0.75)) / 0.5) * span * 0.5;
          }
        }
        if (Y > noseY - 2 && Y < mouthY + ry * 0.2) {   // nasolabial folds
          for (let si = 0; si < 2; si++) {
            const s = SIDES[si];
            const ax = fx + s * g.noseW * 1.05, ay = noseY - ry * 0.01;
            const bx = fx + s * g.mouthW * 1.16, by = mouthY + ry * 0.11;
            dk += Math.max(0, 1 - segDist(X, Y, ax, ay, bx + s * 0.8, by) / 0.62) * (0.75 + 0.45 * wr);
            lt += Math.max(0, 1 - segDist(X, Y, ax - s * 0.9, ay, bx - s * 0.2, by) / 0.6) * 0.4;
          }
        }
        if (Y > eyeY - 2.5 && Y < eyeY + g.eyeW * 1.8) {
          const adx2 = Math.abs(dxf);
          if (adx2 > eyeSep * 0.6) {                     // crow's feet
            for (let si = 0; si < 2; si++) {
              const s = SIDES[si];
              const ax = fx + s * (eyeSep + g.eyeW * 1.05);
              for (let k = 0; k < 3; k++) {
                const ay = eyeY - 0.9 + k * 0.95;
                dk += Math.max(0, 1 - segDist(X, Y, ax, ay, ax + s * 2.1, ay - 0.8 + k * 0.6) / 0.45) * 0.6;
              }
            }
          }
          // Eye bags: two short arcs under the lower lid, not a band across
          // the whole face.
          for (let si = 0; si < 2; si++) {
            const ox = dxf - SIDES[si] * eyeSep;
            const sag = eyeY + g.eyeW * 1.05 - sq(ox / (g.eyeW * 1.15)) * 0.55;
            dk += Math.max(0, 1 - Math.abs(Y - sag) / 0.55)
              * smoothstep(g.eyeW * 1.25, g.eyeW * 0.85, Math.abs(ox)) * 0.6;
          }
        }
        if (dk > 0) col = mixC(col, scl(col, 0.56), Math.min(1, dk) * wr * 0.62);
        if (lt > 0) col = mixC(col, scl(col, 1.20), Math.min(1, lt) * wr * 0.38);
      }

      if (face.marks.scar) {
        const sc = face.marks.scar;
        const ax = fx + sc.side * rx * 0.52, ay = eyeY - ry * 0.28 + sc.y * ry * 0.1;
        const k = Math.max(0, 1 - segDist(X, Y, ax, ay, ax + sc.side * 1.2, ay + ry * 0.30 * sc.len) / 0.6);
        if (k > 0) col = mixC(col, C.scar, k * 0.5);
      }

      bl(buf, i3, col, hc);

      // --- features (drawn straight over the lit skin) -----------------------
      if (Y > featTop && Y < chinY) drawFeatures(buf, i3, X, Y, hc, FP);
    }
  }

  // =========================================================================
  // 4. hair
  // =========================================================================
  if (face.gear.hairVisible > 0) {
    const HC = face.hair;
    for (let py = 0; py < BH; py++) {
      const Yw = (py + 0.5) * px2dy;
      for (let pxi = 0; pxi < BW; pxi++) {
        const ii = py * BW + pxi;
        let a = hair[ii];
        if (a <= 0.004) continue;
        const Xw = (pxi + 0.5) * px2dx;
        const ddx = Xw - pvx, ddy = Yw - pvy;
        const X = pvx + ddx * ca + ddy * sa;
        const Y = pvy - ddx * sa + ddy * ca;
        if (face.gear.hairVisible < 0.3) a *= face.gear.hairVisible;
        else if (face.gear.hairVisible < 1) {
          // Under a hood a fringe escapes at the hairline and nowhere else.
          a *= face.gear.hairVisible * mix(1, 0.25,
            smoothstep(hairP.hairlineY + 1, hairP.hairlineY - 5, Y));
        }
        if (a <= 0.004) continue;
        bl(buf, ii * 3, hairColourAt(HC, hairP, X, Y, sd, LX, LY, ex), a);
        subj[ii] = Math.max(subj[ii], a);
      }
    }
  }

  // =========================================================================
  // 5. facial hair (over the hair pass so a beard reads on top of sideburns)
  // =========================================================================
  if (face.beard !== 'none') {
    const HC = face.hair;
    const greyBeard = rs('grey', 0.52);
    const bp = beardParams(face, g, fx, mouthY, noseY, chinY, rx, ry);
    for (let py = 0; py < BH; py++) {
      const Yw = (py + 0.5) * px2dy;
      for (let pxi = 0; pxi < BW; pxi++) {
        const Xw = (pxi + 0.5) * px2dx;
        const ddx = Xw - pvx, ddy = Yw - pvy;
        const X = pvx + ddx * ca + ddy * sa;
        const Y = pvy - ddx * sa + ddy * ca;
        const ii = py * BW + pxi;
        const a = beardCov(bp, X, Y, sd, hcv[ii]);
        if (a <= 0.004) continue;
        // Shade the beard as a volume: lit upper left, dark under the jaw. It
        // has to stay darker than the hair on the skull or it reads as a bib.
        const lit = 0.16 + 0.48 * clamp(1 - ell(X - (fx - rx * 0.45), Y - (mouthY - 1), rx * 1.5, ry * 1.1), 0, 1);
        const strand = fb(X * 1.5 + Y * 0.3, Y * 3.2, 3, sd + 61);
        let c = mixC(HC.beardDark, HC.beard, clamp(lit * 1.35, 0, 1));
        c = mixC(c, HC.lite, clamp((strand - 0.62) * 1.6, 0, 1) * 0.30 * lit);
        if (face.age === 'old') c = mixC(c, greyBeard, 0.32);
        c = scl(c, 0.82 + strand * 0.26);
        bl(buf, ii * 3, c, a);
        subj[ii] = Math.max(subj[ii], a);
      }
    }
  }

  // =========================================================================
  // 6. headgear
  // =========================================================================
  drawGear(buf, subj, face, ex, {
    BW, BH, px2dx, px2dy, pvx, pvy, ca, sa,
    hcx, hcy, fx, rx, ry, browY, eyeY, noseY, mouthY, chinY, sd, LX, LY, near,
  });

  // Wisps escaping a hood at the temples and forehead. Painted after the hood
  // so the cloth edge is broken by hair instead of cutting it off dead.
  if (face.gear.hood && face.gear.hairVisible > 0.2 && !hairP.bald) {
    const HC = face.hair;
    const y0 = Math.max(0, Math.floor(((hairP.hairlineY - ry * 0.60) / DH) * BH));
    const y1 = Math.min(BH, Math.ceil(((hairP.hairlineY + ry * 0.75) / DH) * BH));
    for (let py = y0; py < y1; py++) {
      const Yw = (py + 0.5) * px2dy;
      for (let pxi = 0; pxi < BW; pxi++) {
        const ii = py * BW + pxi;
        let a = hair[ii];
        if (a <= 0.02) continue;
        const Xw = (pxi + 0.5) * px2dx;
        const ddx = Xw - pvx, ddy = Yw - pvy;
        const X = pvx + ddx * ca + ddy * sa;
        const Y = pvy - ddx * sa + ddy * ca;
        // Strongest at the temples, thinning towards the middle of the brow.
        const band = smoothstep(rx * 0.30, rx * 0.80, Math.abs(X - fx));
        const wisp = smoothstep(0.42, 0.72, nz(X * 1.7, Y * 2.6, sd + 233));
        a *= band * wisp * 0.85;
        if (a <= 0.01) continue;
        bl(buf, ii * 3, hairColourAt(HC, hairP, X, Y, sd, LX, LY, ex), a);
        subj[ii] = Math.max(subj[ii], a);
      }
    }
  }

  // =========================================================================
  // 7. shoulders and collar
  // =========================================================================
  drawShoulders(buf, subj, face, ex, {
    BW, BH, px2dx, px2dy, hcx, fx, rx, ry, chinY, neckCX, neckW, sd,
  });

  // Hair that falls in *front* of the shoulders, which is why this runs after
  // the collar. Whether a long-haired character's hair is pushed back or lies
  // over the chest is one of the loudest silhouette cues at this size.
  if (hairP.front && face.gear.hairVisible > 0.4 && !face.gear.coif) {
    drawFrontLocks(buf, subj, face, hairP, ex, {
      BW, BH, px2dx, px2dy, pvx, pvy, ca, sa, sd, LX, LY, chinY,
    });
  }

  // =========================================================================
  // 8. grade, grain, vignette
  // =========================================================================
  gradePass(buf, subj, face, ex, BW, BH, px2dx, px2dy, sd);

  return { buf, BW, BH };
}

// --- head silhouette profile ----------------------------------------------

function widthProfile(v, g) {
  const k0 = g.wTop, k1 = g.wTemple, k2 = g.wCheek, k3 = g.wJaw, k4 = g.wChin;
  const t = (v + 1) * 0.5 * 4; // 0..4 over five control points
  const i = t < 1 ? 0 : t < 2 ? 1 : t < 3 ? 2 : 3;
  const f = t - i;
  const ff = f * f * (3 - 2 * f);
  const a = [k0, k1, k2, k3][i], b = [k1, k2, k3, k4][i];
  return a + (b - a) * ff;
}

/** Six-tone skin ramp lookup with a smooth blend between neighbours. */
function skinShade(s, SR) {
  const t = clamp(s, 0, 1) * 5;
  const i = Math.min(4, Math.floor(t));
  const f = t - i;
  const r = SR.ramp;
  return [
    r[i][0] + (r[i + 1][0] - r[i][0]) * f,
    r[i][1] + (r[i + 1][1] - r[i][1]) * f,
    r[i][2] + (r[i + 1][2] - r[i][2]) * f,
  ];
}

// --- features --------------------------------------------------------------

function drawFeatures(buf, i3, X, Y, hc, P) {
  const { face, ex, g, SR, C, fx, browY, eyeY, noseY, mouthY, eyeSep, chinY, rx, ry, near, sd } = P;
  const dxf = X - fx;
  const lashCol = C.lash;
  const skinLite = SR.ramp[4], skinDeep = SR.ramp[1], skinMid = SR.ramp[3];

  // --- nostrils ------------------------------------------------------------
  if (Math.abs(Y - noseY) < ry * 0.06) {
    const nw = g.noseW;
    for (let si = 0; si < 2; si++) {
      const e = ell(dxf - SIDES[si] * nw * 0.70, Y - (noseY + ry * 0.010), nw * 0.32, ry * 0.028);
      const a = cov(e, 0.55) * 0.9;
      if (a > 0) bl(buf, i3, C.nostril, a * hc);
    }
  }

  // --- eyes ----------------------------------------------------------------
  if (Math.abs(Y - eyeY) < g.eyeW * 2.4) for (const s of SIDES) {
    // The far eye is foreshortened and sits closer to the edge of the face.
    const isFar = s !== near;
    const ew = g.eyeW * (isFar ? 0.88 : 1);
    const ecx = fx + s * eyeSep * (isFar ? 0.94 : 1);
    const open = (s < 0 ? ex.eyeOpenL : ex.eyeOpenR) * g.eyeOpenBase
      * (face.age === 'old' ? 0.88 : 1);
    const eh = g.eyeW * 0.60 * open;

    const ux = (X - ecx) / ew;
    if (ux < -1.8 || ux > 1.8) continue;

    if (open < 0.12) {
      // Closed: a lid mass with a dark crease where the lashes meet.
      const lidY = eyeY - ry * 0.012;
      const inLid = smoothstep(1.15, 0.85, Math.abs(ux))
        * smoothstep(2.0, 1.1, Math.abs((Y - (lidY - 0.8)) / (g.eyeW * 0.75)));
      if (inLid > 0) {
        bl(buf, i3, skinShade((0.36 + 0.22 * smoothstep(lidY, lidY - 1.6, Y)) * ex.key, SR),
          inLid * 0.85 * hc);
      }
      const curve = lidY + (1 - ux * ux) * 0.55;
      const a = Math.max(0, 1 - Math.abs(Y - curve) / 0.62) * smoothstep(1.12, 0.86, Math.abs(ux));
      if (a > 0) bl(buf, i3, lashCol, a * 0.92 * hc);
      const a2 = Math.max(0, 1 - Math.abs(Y - (curve + 0.9)) / 0.5) * smoothstep(1.05, 0.8, Math.abs(ux));
      if (a2 > 0) bl(buf, i3, skinLite, a2 * 0.30 * hc);
      continue;
    }

    // Almond opening: different radii above and below the eye line.
    const vy = Y - eyeY;
    const openTop = 1.0, openBot = 0.92 - ex.lidLow * 0.35;
    const vs = vy < 0 ? vy / (eh * openTop) : vy / (eh * openBot);
    const em = Math.pow(Math.abs(ux), 2.3) + vs * vs;
    const ea = cov(em, 0.32);
    if (ea > 0.004) {
      // Sclera is a warm light grey, never white, and the top of the ball sits
      // in the shadow the upper lid casts.
      const lidShadow = mix(0.55, 1.06, smoothstep(-1.05, 0.25, vs));
      let c = scl(C.sclera, lidShadow * (0.9 + 0.2 * ex.key));
      c = mixC(c, C.vessel, Math.max(0, Math.abs(ux) - 0.35) * 0.55);
      c = scl(c, 1 - Math.max(0, Math.abs(ux) - 0.45) * 0.55);
      bl(buf, i3, c, ea * hc);

      // iris
      const gx = ecx + ex.gazeX * ew * 0.5 + g.turn * ew * 0.45;
      const gy = eyeY + ex.gazeY * eh * 0.4 + eh * 0.10;
      const ir = g.eyeW * 0.56;
      const idm = Math.sqrt(ell(X - gx, Y - gy, ir, ir));
      if (idm < 1.5) {
        const iCol = C.iris;
        const a2 = Math.atan2(Y - gy, X - gx);
        const fibre = nz(Math.cos(a2) * 4 + 9, Math.sin(a2) * 4 + 9, sd + 17);
        let c2 = mixC(scl(iCol, 0.42), scl(iCol, 1.10), clamp(0.35 + fibre * 0.7, 0, 1));
        // light enters from the upper left, so the lower iris glows
        c2 = mixC(c2, scl(iCol, 1.30), clamp(((Y - gy) / ir) * 0.6 + 0.15, 0, 1) * 0.34);
        c2 = mixC(c2, scl(iCol, 0.16), smoothstep(0.58, 0.98, idm));     // limbal ring
        c2 = scl(c2, lidShadow);
        bl(buf, i3, c2, cov(idm * idm, 0.28) * ea * hc);
        const pr = ir * 0.42 * ex.pupil * (ex.glow ? 0.8 : 1);
        bl(buf, i3, C.pupil, cov(ell(X - gx, Y - gy, pr, pr), 0.45) * ea * hc);
        if (ex.glow) {
          bl(buf, i3, C.glow, cov(ell(X - gx, Y - gy, ir * 1.5, ir * 1.5), 0.6) * 0.5 * hc);
        }
        // one catchlight, upper left of the pupil
        bl(buf, i3, C.catch,
          cov(ell(X - (gx - ir * 0.42), Y - (gy - ir * 0.42), ir * 0.22, ir * 0.22), 0.6) * ea * 0.85 * hc);
      }

      // upper lash line, heaviest at the outer corner
      const lashT = -eh * openTop * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(ux), 2.3)));
      const la = Math.max(0, 1 - Math.abs(vy - lashT) / (0.44 + (face.sex === 'f' ? 0.22 : 0)))
        * smoothstep(1.24, 0.92, Math.abs(ux)) * (0.72 + 0.28 * smoothstep(-0.2, 1.0, ux * s));
      bl(buf, i3, lashCol, la * (face.sex === 'f' ? 0.88 : 0.74) * hc);
      const lashB = eh * openBot * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(ux), 2.3)));
      const lb = Math.max(0, 1 - Math.abs(vy - lashB) / 0.5) * smoothstep(1.15, 0.85, Math.abs(ux));
      bl(buf, i3, mixC(lashCol, skinDeep, 0.45), lb * 0.5 * hc);
    }
    // lid crease above, lit line below
    const cr = Math.max(0, 1 - Math.abs(Y - (eyeY - g.eyeW * 0.92 * open - 0.35)) / 0.62)
      * smoothstep(1.25, 0.9, Math.abs(ux));
    if (cr > 0) bl(buf, i3, scl(skinDeep, 1.12), cr * 0.32 * hc);
    const ll = Math.max(0, 1 - Math.abs(Y - (eyeY + g.eyeW * 0.80 * open + 0.55)) / 0.55)
      * smoothstep(1.1, 0.8, Math.abs(ux));
    if (ll > 0) bl(buf, i3, skinLite, ll * 0.22 * hc);
  }

  // --- eyebrows: a soft mass with direction, not a line ---------------------
  if (Y > browY - ry * 0.22 + Math.min(ex.browIn, ex.browOut) && Y < browY + ry * 0.10 + Math.max(ex.browIn, ex.browOut)) {
    const thick = g.browThick * ex.browThick;
    for (const s of SIDES) {
      const inX = fx + s * eyeSep * 0.40;
      const outX = fx + s * (eyeSep + g.eyeW * 1.35);
      const lo = Math.min(inX, outX), hi = Math.max(inX, outX);
      if (X < lo - 1.4 || X > hi + 1.4) continue;
      const t = clamp((X - inX) / (outX - inX), 0, 1);
      const skew = ex.mouthSkew ? s * 0.30 * ex.mouthSkew : 0;
      const inner = browY - ry * 0.050 + ex.browIn + skew;
      const outer = browY - ry * 0.050 + ex.browOut - ex.browTilt * 0.55;
      const arch = g.browArch * (1 + ex.browTilt * 0.2);
      const yb = mix(inner, outer, t * t * (3 - 2 * t)) - Math.sin(t * Math.PI) * arch * 0.9;
      const th = (0.62 + 0.48 * g.browHeavy) * thick * (1 - t * 0.45) + 0.25;
      // Hair-by-hair edge: noise on the boundary, softer at the ends.
      const edge = (fb(X * 2.4, Y * 2.4, 2, sd + 41) - 0.5) * 0.9;
      const d = Math.abs(Y - yb) + edge * 0.55;
      let a = smoothstep(th * 0.6 + 0.45, th * 0.6 - 0.45, d);
      a *= smoothstep(-0.16, 0.10, t) * smoothstep(1.16, 0.90, t);
      if (a <= 0.004) continue;
      const strand = fb(X * 2.8 + Y * 1.2, Y * 1.6, 2, sd + 43);
      let c = mixC(face.hair.dark, face.hair.base, 0.30 + strand * 0.55);
      if (face.age === 'old') c = mixC(c, C.greyHair, 0.40);
      c = mixC(c, face.hair.lite, clamp((yb - Y) * 0.55, 0, 1) * 0.35);
      bl(buf, i3, c, a * 0.95 * hc);
    }
  }

  // --- mouth ---------------------------------------------------------------
  if (Y > mouthY - ry * 0.20 && Y < mouthY + ry * 0.24 + ex.mouthOpen * ry * 0.25) {
    const mw = g.mouthW * ex.mouthW;
    const ux = (X - fx) / mw;
    if (ux > -1.6 && ux < 1.6) {
      const skew = ex.mouthSkew * 0.55;
      const yc = mouthY - ex.mouthCurve * (ux * ux) * 0.55 + skew * ux * 0.9 + ex.mouthCurve * 0.12;
      const open = ex.mouthOpen;
      const lipTop = yc - ry * (0.050 + 0.042 * g.lipFull);
      const lipBot = yc + ry * (0.062 + 0.052 * g.lipFull) + open * ry * 0.24;

      if (open > 0.03) {
        const round = mix(0.88 - open * 0.12, 0.52, ex.mouthRound);
        const oh = open * ry * (0.28 + ex.mouthRound * 0.06);
        const om = Math.pow(Math.abs(ux / round), mix(2.1, 2.0, ex.mouthRound))
          + Math.pow(Math.abs((Y - (yc + oh * 0.25)) / oh), 1.9);
        const oa = cov(om, 0.4);
        if (oa > 0) {
          const c = mixC(C.mouthIn, C.tongue, clamp(((Y - yc) / oh) * 0.8, 0, 1) * 0.55);
          bl(buf, i3, c, oa * hc);
          if (ex.teeth > 0) {
            const ty = yc - oh * 0.60;
            const ta = Math.max(0, 1 - Math.abs(Y - ty) / (oh * 0.44)) * smoothstep(0.94, 0.62, Math.abs(ux));
            const gap = 0.6 + 0.4 * Math.abs(Math.sin(ux * 7.5));
            bl(buf, i3, scl(C.teeth, 0.82 + gap * 0.22), ta * oa * ex.teeth * hc);
          }
        }
      }

      // lips: upper darker and turned away, lower catching the key light
      const upT = smoothstep(lipTop - 0.8, lipTop + 0.2, Y) * smoothstep(yc + 0.15, yc - 0.35, Y);
      const cupid = 1 - Math.exp(-sq(ux / 0.25)) * 0.35;
      const upA = upT * smoothstep(1.05, 0.82, Math.abs(ux)) * cupid * (1 - open * 0.7);
      if (upA > 0) bl(buf, i3, C.lipUp, upA * 0.95 * hc);
      const dnA = smoothstep(yc - 0.1, yc + 0.5, Y) * smoothstep(lipBot + 0.4, lipBot - 0.5, Y)
        * smoothstep(1.0, 0.72, Math.abs(ux)) * (1 - open * 0.8);
      if (dnA > 0) {
        const c = mixC(C.lipDn, skinLite, Math.max(0, 1 - Math.abs((Y - (yc + ry * 0.055)) / 0.9)) * 0.50);
        bl(buf, i3, c, dnA * 0.8 * hc);
      }
      // The line between the lips is the darkest mark on the lower face; at
      // 63px it is most of what makes a mouth read at all.
      if (open < 0.35) {
        const a = Math.max(0, 1 - Math.abs(Y - yc) / 0.85)
          * smoothstep(1.10, 0.80, Math.abs(ux)) * (1 - open * 2.4);
        bl(buf, i3, C.lipLine, a * 1.0 * hc);
      }
      const shl = Math.max(0, 1 - Math.abs(Y - (lipBot + 0.85)) / 1.0) * smoothstep(0.98, 0.55, Math.abs(ux));
      bl(buf, i3, scl(skinDeep, 1.02), shl * 0.42 * hc);
    }
  }

  // chin crease
  bl(buf, i3, scl(skinDeep, 1.15),
    blob(dxf, Y - (chinY - ry * 0.230), rx * 0.22, ry * 0.036) * 0.22 * hc);
}

// --- hair ------------------------------------------------------------------

// Hairline archetypes. templeA > 0 means the hairline drops at the temples
// (a low, round hairline); < 0 means it climbs (receding). `peak` is the
// central widow's-peak spike.
const HAIRLINES = {
  peak: { templeA: 1.4, peak: 1.9, lift: 0.02 },
  straight: { templeA: 0.15, peak: 0.0, lift: 0.00 },
  round: { templeA: 2.3, peak: 0.3, lift: -0.03 },
  high: { templeA: 0.9, peak: 0.4, lift: -0.10 },
  receded: { templeA: -3.0, peak: 1.5, lift: -0.13 },
};

function hairParams(face, g, hairlineY, hcx, hcy, rx, ry, fx, near) {
  const st = face.hairStyle;
  const cut = face.cut || { style: st, hairline: 'round', part: 0, partGap: 0.7, slant: 0, volume: 1, length: 1, front: false, frontSide: 0, sideburn: 0 };
  const r = new Rand((face.noiseSeed ^ 0x77) >>> 0);
  const hl = HAIRLINES[cut.hairline] || HAIRLINES.round;
  const V = cut.volume, L = cut.length;
  const p = {
    style: st, hcx, hcy, rx, ry, g, fx, near,
    hairlineY: hairlineY + ry * hl.lift,
    capRX: rx * 1.10 * V, capRY: ry * 1.13 * V,
    capCY: hcy - ry * 0.14,
    templeA: hl.templeA,
    peak: hl.peak,
    slant: cut.slant,
    part: cut.part, partGap: cut.part === 0 ? 0 : cut.partGap,
    // The falling mass, described as a silhouette rather than a rectangle:
    // how far it hangs, how wide it flares over the ear and how it tapers to
    // the ends - and it is deliberately different on the two sides.
    hangLen: 0.45, hangW: rx * 0.05, flare: 2.0, taper: 2.4,
    asymL: 1, asymR: 1,
    rough: 0.35,
    showEars: st === 'crop' || st === 'short' || st === 'bald'
      || st === 'receding' || st === 'ponytail',
    sideburn: cut.sideburn,
    front: false, frontSide: cut.frontSide, frontLen: 1,
    tail: null, braid: null, bald: false,
  };
  switch (st) {
    case 'crop':
      p.capRX = rx * 1.04 * V; p.capRY = ry * 1.05 * V;
      p.hangLen = 0.26; p.hangW = rx * 0.01; p.taper = 3.2; p.rough = 0.22;
      break;
    case 'short':
      p.capRX = rx * 1.09 * V; p.capRY = ry * 1.11 * V;
      p.hangLen = 0.44 + 0.14 * L; p.hangW = rx * 0.05; p.taper = 2.6; p.rough = 0.30;
      break;
    case 'medium':
      // Jaw-length: stops short of the shoulders, which is a different
      // silhouette from both a crop and a full mane.
      p.capRX = rx * 1.13 * V; p.capRY = ry * 1.13 * V;
      p.hangLen = 0.80 + 0.55 * L; p.hangW = rx * 0.20; p.taper = 1.4;
      p.flare = 2.4; p.rough = 0.40;
      break;
    case 'long':
      p.capRX = rx * 1.15 * V; p.capRY = ry * 1.15 * V;
      p.hangLen = 1.55 + 0.75 * L; p.hangW = rx * 0.30; p.taper = 0.85;
      p.flare = 1.7; p.rough = 0.45;
      break;
    case 'ponytail':
      p.capRX = rx * 1.05 * V; p.capRY = ry * 1.08 * V;
      p.hangLen = 0.24; p.hangW = rx * 0.04; p.taper = 2.8;
      p.tail = { side: r.bool() ? 1 : -1, len: r.float(0.8, 1.2) * L };
      break;
    case 'bald':
      p.bald = true; p.hangLen = 0.30; p.hangW = 0;
      break;
    case 'receding':
      p.hairlineY = hairlineY - ry * 0.12; p.templeA = -3.2; p.peak = 1.2;
      p.capRX = rx * 1.06 * V; p.capRY = ry * 1.08 * V;
      p.hangLen = 0.40; p.hangW = rx * 0.04; p.taper = 2.6;
      break;
    case 'braided':
      p.capRX = rx * 1.11 * V; p.capRY = ry * 1.11 * V;
      p.hangLen = 0.85 + 0.35 * L; p.hangW = rx * 0.16; p.taper = 1.8;
      p.braid = { side: r.bool() ? 1 : -1 };
      break;
    case 'wild':
      p.capRX = rx * 1.26 * V; p.capRY = ry * 1.30 * V;
      p.hangLen = 0.70 + 0.55 * L; p.hangW = rx * 0.40; p.taper = 0.55;
      p.flare = 3.2; p.rough = 1.05;
      break;
  }
  // No two sides of a real head of hair match. This is cheap and it is one of
  // the few cues that survives the box filter down to 63 px.
  p.asymL = r.float(0.84, 1.20); p.asymR = r.float(0.84, 1.20);
  // Hair in front of the shoulders is a separate pass over the collar; the
  // mass behind the head stops at the shoulder line as usual.
  p.front = !!cut.front && !p.bald && st !== 'crop' && st !== 'short'
    && st !== 'receding' && st !== 'ponytail';
  p.frontLen = L;
  if (face.age === 'old' && (st === 'short' || st === 'long' || st === 'medium')) p.templeA -= 1.0;
  p.bottomY = hcy + ry * p.hangLen * Math.max(p.asymL, p.asymR)
    + (p.tail || p.braid ? DH : 0) + 5;
  if (p.bottomY > DH + 4) p.bottomY = DH + 4;
  return p;
}

/**
 * Coverage of the mass of hair falling beside and behind the head. A plain
 * vertical band with a horizontal cut - which is what this used to be - makes
 * every long-haired character wear the same paper bob.
 */
function hangCov(p, X, Y, rough) {
  if (p.hangW <= 0) return 0;
  const s = X >= p.hcx ? 1 : -1;
  const asym = s > 0 ? p.asymR : p.asymL;
  const yTop = p.hcy - p.ry * 0.80;
  const yEnd = p.hcy + p.ry * p.hangLen * asym;
  if (Y > yEnd + 3) return 0;
  const t = clamp((Y - yTop) / Math.max(2, yEnd - yTop), 0, 1);
  // Flares out over the ear, then narrows towards the ends.
  const flare = Math.sin(clamp(t * p.flare, 0, 1) * Math.PI * 0.5);
  const taper = Math.pow(1 - t, p.taper);
  const w = p.rx * 0.92 + p.hangW * asym * (0.25 + 1.15 * flare) * (0.30 + 0.70 * taper);
  const inX = smoothstep(w + 1.0, w - 0.7, Math.abs(X - p.hcx) - rough * 1.7);
  const inY = smoothstep(yTop, yTop + p.ry * 0.20, Y)
    * (1 - smoothstep(yEnd - 3.5, yEnd, Y + rough * 2.0));
  return inX * inY;
}

/** Hairline y at a given x (larger y = hair reaches further down the forehead). */
function hairlineAt(p, X) {
  const u = (X - p.fx) / p.rx;
  let y = p.hairlineY + p.templeA * u * u + p.peak * Math.exp(-(u * u) / 0.05)
    + p.slant * u;
  // The parting: a notch where the hair is swept apart, sitting off centre.
  if (p.partGap > 0) {
    y -= p.partGap * 3.0 * Math.exp(-sq((u - p.part * 0.34) / 0.16));
  }
  return y;
}

function hairCov(p, X, Y, sd) {
  // Cheap reject first - the noise below is the most expensive thing in the
  // whole painter and most of the plate is nowhere near any hair.
  if (Y < p.hcy - p.ry * 1.45 || Y > p.bottomY || Math.abs(X - p.hcx) > p.rx * 1.75) return 0;
  // Everything except the fringe is cut against a slightly shrunk copy of the
  // head, so hanging hair sits beside and behind the face, never over it.
  const vv = clamp((Y - p.hcy) / p.ry, -1, 1);
  const wp = widthProfile(vv, p.g);
  const hm = Math.pow(Math.abs((X - p.hcx) / (p.rx * wp * 0.90)), 2)
    + Math.pow(Math.abs((Y - p.hcy) / (p.ry * 0.95)), 2.35);
  const outside = 1 - cov(hm, 0.18);

  if (p.bald) {
    const ring = ell(X - p.hcx, Y - p.hcy, p.rx * 1.08, p.ry * 1.06);
    return cov(ring, 0.12) * outside
      * smoothstep(p.hcy - p.ry * 0.12, p.hcy + p.ry * 0.08, Y)
      * (1 - smoothstep(p.hcy + p.ry * p.hangLen, p.hcy + p.ry * p.hangLen + 2.5, Y));
  }
  const rough = (fb(X * 0.55, Y * 0.55, 3, sd + 200) - 0.5) * p.rough
    + (fb(X * 1.6, Y * 1.6, 2, sd + 201) - 0.5) * p.rough * 0.6;

  const capE = cov(ell(X - p.hcx, Y - p.capCY, p.capRX, p.capRY) + rough * 0.20, 0.16);
  const hl = hairlineAt(p, X);
  let a = capE * smoothstep(hl + 0.9, hl - 0.9, Y);            // fringe, over the face
  // The cap itself only reaches the ear line; below that the hanging profile
  // takes over, so the two never combine into a straight-sided slab.
  a = Math.max(a, capE * outside * (1 - smoothstep(p.hcy, p.hcy + p.ry * 0.30, Y)));
  a = Math.max(a, hangCov(p, X, Y, rough) * outside);

  // Sideburns: a tongue of hair in front of the ear, over the skin. Length
  // here separates otherwise identical crops.
  if (p.sideburn > 0.12) {
    const adx = Math.abs(X - p.hcx);
    const sbBot = p.hairlineY + p.ry * (0.40 + p.sideburn * 0.85);
    const sb = smoothstep(p.rx * 0.98, p.rx * 0.78, adx) * smoothstep(p.rx * 0.62, p.rx * 0.76, adx)
      * smoothstep(p.hairlineY - 1.5, p.hairlineY + 1.5, Y)
      * (1 - smoothstep(sbBot - 1.6, sbBot + 0.6, Y + rough * 1.6));
    a = Math.max(a, sb * 0.92);
  }

  if (p.backW > 0) {
    const w = p.rx * 1.00 + p.backW * (0.4 + 0.9 * smoothstep(p.hcy - p.ry * 0.3, p.backEndY, Y));
    const inX = smoothstep(w + 1.0, w - 0.6, Math.abs(X - p.hcx) - rough * 1.4);
    const inY = smoothstep(p.hcy - p.ry * 0.90, p.hcy - p.ry * 0.60, Y)
      * (1 - smoothstep(p.backEndY - 5, p.backEndY, Y));
    a = Math.max(a, inX * inY * outside);
  }
  if (p.tail) {
    const s = p.tail.side;
    const tx = p.hcx + s * (p.rx * 0.92), ty = p.hcy - p.ry * 0.20;
    const d = segDist(X, Y, tx, ty, tx + s * 3.2, ty + p.ry * 1.15 * p.tail.len);
    a = Math.max(a, smoothstep(2.8, 1.5, d + rough * 1.5) * outside);
  }
  if (p.braid) {
    const s = p.braid.side;
    const bx = p.hcx + s * (p.rx * 0.90), by = p.hcy + p.ry * 0.20;
    const t = clamp((Y - by) / (DH - by), 0, 1);
    const cxp = bx + s * 1.8 * Math.sin(t * 3.0);
    const w = 2.6 * (1 - t * 0.30) * (0.85 + 0.25 * Math.sin(t * 11));
    a = Math.max(a, smoothstep(w + 0.8, w - 0.4, Math.abs(X - cxp))
      * smoothstep(by - 1, by + 1.5, Y) * outside);
  }
  return clamp(a, 0, 1);
}

/**
 * Two tresses hanging down the front of the shoulders. Drawn after the collar,
 * shaded as cylinders rather than as part of the skull cap.
 */
function drawFrontLocks(buf, subj, face, p, ex, P) {
  const { BW, BH, px2dx, px2dy, pvx, pvy, ca, sa, sd, chinY } = P;
  const HC = face.hair;
  const startY = p.hcy + p.ry * 0.42;
  const endY = Math.min(DH + 2, chinY + 6 + p.ry * 1.5 * p.frontLen);
  const span = Math.max(1, endY - startY);
  const y0 = Math.max(0, Math.floor((startY / DH) * BH));
  for (let py = y0; py < BH; py++) {
    const Yw = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const Xw = (pxi + 0.5) * px2dx;
      const ddx = Xw - pvx, ddy = Yw - pvy;
      const X = pvx + ddx * ca + ddy * sa;
      const Y = pvy - ddx * sa + ddy * ca;
      if (Y < startY || Y > endY + 2) continue;
      const t = clamp((Y - startY) / span, 0, 1);
      let a = 0, cxBest = 0, wBest = 1;
      for (let si = 0; si < 2; si++) {
        const s = SIDES[si];
        if (p.frontSide !== 0 && p.frontSide !== s) continue;
        // The lock leaves the head just in front of the ear and swings out a
        // little as it falls.
        const cx = p.hcx + s * p.rx * (0.80 + t * 0.34) + s * Math.sin(t * 2.6 + si) * 1.1;
        const w = p.rx * (0.26 + 0.10 * Math.sin(t * 3.1 + si * 2)) * (1 - t * 0.18);
        const wob = (fb(X * 0.45, Y * 0.40, 2, sd + 220 + si) - 0.5) * 2.4;
        const k = smoothstep(w + 1.3, w - 0.9, Math.abs(X - cx) + wob);
        if (k > a) { a = k; cxBest = cx; wBest = w; }
      }
      a *= 1 - smoothstep(endY - 4.5, endY, Y);
      if (a <= 0.01) continue;
      // Cylinder shading: lit on the light side of each tress, dark at the
      // edges, with vertical strand strokes.
      const u = clamp((X - cxBest) / (wBest + 0.001), -1, 1);
      const strand = fb(X * 3.0, Y * 0.7, 2, sd + 224);
      let sh = 0.20 + Math.max(0, 1 - sq((u + 0.45) / 0.95)) * 0.80;
      sh *= 0.78 + strand * 0.46;
      sh *= mix(0.70, 1.0, 1 - t * 0.5) * ex.key;
      let c = mixC(HC.dark, HC.base, clamp(sh * 1.45, 0, 1));
      c = mixC(c, HC.lite, clamp((sh - 0.62) * 1.7, 0, 1) * 0.7 * HC.sheen);
      bl(buf, ii3(py, pxi, BW), c, a);
      const ii = py * BW + pxi;
      subj[ii] = Math.max(subj[ii], a);
    }
  }
}
const ii3 = (py, pxi, BW) => (py * BW + pxi) * 3;

/** How much shadow the hairline casts on the forehead at this point. */
function hairShadowAt(p, X, Y) {
  if (p.bald) return 0;
  const hl = hairlineAt(p, X);
  return smoothstep(hl + 2.8, hl + 0.1, Y) * smoothstep(hl - 2.6, hl - 0.2, Y);
}

function hairColourAt(HC, p, X, Y, sd, LX, LY, ex) {
  // Pseudo-normal from the hair volume so the mass reads as a rounded shape.
  const ux = (X - p.hcx) / (p.capRX * 1.05);
  const uy = (Y - p.capCY) / (p.capRY * 1.15);
  const r2c = ux * ux + uy * uy;
  const r2 = clamp(r2c, 0, 1);
  const zc = Math.sqrt(1 - r2);
  const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
  let diff = Math.max(0, (ux * LX + uy * LY + zc * 0.72) * nl);

  // Hair hanging past the skull is a pair of falling masses, not part of the
  // cranial sphere. Shading it off the cap normal leaves it flat and almost
  // black - a curtain, which is what made every long-haired face look alike.
  const cu = clamp((X - p.hcx) / (p.rx * 1.28), -1, 1);
  const fall = smoothstep(0.80, 1.45, r2c) * smoothstep(-0.15, 0.45, uy);
  if (fall > 0.004) {
    const cz = Math.sqrt(Math.max(0, 1 - cu * cu));
    const cn = 1 / Math.sqrt(cu * cu + 0.10 + cz * cz);
    const cd = Math.max(0, (cu * LX - 0.32 * LY + cz * 0.82) * cn);
    diff = mix(diff, cd, fall);
  }

  const s1 = fb(X * 2.6 + Y * 0.55, Y * 0.85, 2, sd + 210);
  const s2 = nz(X * 6.0, Y * 1.1, sd + 211);
  const clump = s1 * 0.7 + s2 * 0.3;

  let shade = 0.30 + diff * 1.00;
  shade *= 0.76 + clump * 0.54;
  shade *= ex.key;
  let c = mixC(HC.dark, HC.base, clamp(shade * 1.45, 0, 1));
  c = mixC(c, HC.lite, clamp((shade - 0.52) * 1.5, 0, 1) * 0.8);

  // Strand strokes: narrow arcs of light following the curve of the skull on
  // the cap, running vertically down the falling mass.
  const ang = Math.atan2(uy + 0.15, ux);
  const jit = (nz(X * 0.45, Y * 0.45, sd + 215) - 0.5) * 4.0;
  const capPhase = ang * 7.5 + jit + r2 * 2.5;
  const fallPhase = (X - p.hcx) * 2.1 + jit * 0.8 + (nz(X * 0.3, Y * 0.9, sd + 217) - 0.5) * 3.0;
  const stroke = Math.pow(Math.abs(Math.sin(mix(capPhase, fallPhase, fall))), 6);
  const capSheen = Math.exp(-sq((ux + 0.44) / 0.42)) * Math.exp(-sq((uy + 0.48) / 0.50));
  // The falling mass catches a long vertical highlight on its light side.
  const fallSheen = Math.exp(-sq((cu + 0.62) / 0.34)) * 0.9
    + Math.exp(-sq((cu - 0.72) / 0.26)) * 0.25;
  const sheen = mix(capSheen, fallSheen, fall);
  c = mixC(c, HC.lite, sheen * HC.sheen * 0.68 * (0.28 + stroke * 0.72));
  // dark layer where the hair meets the forehead, and at the outer edge
  const hl = hairlineAt(p, X);
  c = scl(c, mix(0.52, 1, smoothstep(hl - 0.5, hl - 4.5, Y)));
  c = scl(c, mix(0.86, 1.05, clamp(1 - r2 * 0.75, 0, 1)));
  // Ends go darker and dustier so a long mane does not read as a solid slab.
  c = scl(c, mix(1, 0.78, fall * smoothstep(p.hcy + p.ry * 0.5, p.bottomY, Y)));
  return c;
}

// --- facial hair -----------------------------------------------------------

function beardParams(face, g, fx, mouthY, noseY, chinY, rx, ry) {
  return {
    kind: face.beard, fx, mouthY, noseY, chinY, rx, ry,
    jawY: chinY - ry * 0.28, tone: face.marks.stubbleTone,
    mouthW: g.mouthW, noseW: g.noseW,
  };
}

function beardCov(p, X, Y, sd, headCov) {
  const dx = X - p.fx;
  const k = p.kind;
  const n = fb(X * 1.9, Y * 1.9, 3, sd + 301);
  let a = 0;

  const moustache = () => {
    // Sits under the nose and stops well short of the lip line, with the ends
    // dropping past the mouth corners - a solid rectangle reads as a smudge.
    const w = p.noseW * 1.55;
    const droop = 1 + sq(dx / (w + 0.001)) * 0.55;
    const yb = p.mouthY - p.ry * 0.055 + (droop - 1) * p.ry * 0.06;
    return smoothstep(w + 1.2, w - 0.5, Math.abs(dx))
      * smoothstep(p.noseY + 0.30, p.noseY + 1.1, Y)
      * (1 - smoothstep(yb - 0.5, yb + 0.7, Y));
  };
  const jaw = (top, spread) => {
    const inX = smoothstep(p.rx * (0.98 * spread), p.rx * (0.72 * spread), Math.abs(dx));
    return clamp(smoothstep(top - 1.6, top + 1.4, Y) * (0.35 + 0.65 * inX) + inX * 0.15, 0, 1);
  };

  switch (k) {
    case 'stubble':
      // A stipple wash rather than a mass - the dots are what sell it.
      a = jaw(p.mouthY - p.ry * 0.02, 1.05) * 0.55;
      a = Math.max(a, moustache() * 0.5);
      a *= smoothstep(0.45, 0.75, nz(X * 3.4, Y * 3.4, sd + 305)) * 0.75 + 0.20;
      a *= 0.66 * p.tone;
      break;
    case 'moustache': a = moustache(); break;
    case 'chin': {
      // Goatee: a patch under the lip and on the chin only, no jaw line. Very
      // different silhouette from a full beard at 63 px.
      const cy = (p.mouthY + p.chinY) * 0.5;
      a = cov(ell(dx, Y - cy, p.mouthW * 0.72, p.ry * 0.115), 0.35);
      a = Math.max(a, moustache() * 0.9);
      a *= 1 - smoothstep(p.chinY, p.chinY + 2.5, Y);
      break;
    }
    case 'short':
      a = jaw(p.mouthY + p.ry * 0.045, 1.0);
      a = Math.max(a, moustache() * 0.85);
      a *= 1 - smoothstep(p.chinY + 1.5, p.chinY + 4.0, Y);
      break;
    case 'full':
      a = jaw(p.mouthY - p.ry * 0.09, 1.06);
      a = Math.max(a, moustache());
      a *= 1 - smoothstep(p.chinY + 3.0, p.chinY + 6.5, Y);
      break;
    case 'long': {
      a = jaw(p.mouthY - p.ry * 0.10, 1.06);
      a = Math.max(a, moustache());
      const w = p.rx * 0.62 * (1 - smoothstep(p.chinY, DH, Y) * 0.30);
      const wob = (fb(X * 0.4, Y * 0.4, 2, sd + 303) - 0.5) * 1.2;
      a = Math.max(a, smoothstep(w + 1.4, w - 0.6, Math.abs(dx + wob))
        * smoothstep(p.chinY - 4, p.chinY - 1, Y));
      break;
    }
    default: return 0;
  }
  a *= 1 - 0.85 * smoothstep(1.15, 0.6,
    Math.sqrt(ell(dx, Y - p.mouthY, p.mouthW * 0.85, p.ry * 0.035)));
  const bound = Y < p.chinY - 1 ? headCov : 1;
  return clamp(a * (0.82 + 0.35 * n), 0, 1) * bound;
}

// --- headgear --------------------------------------------------------------

/**
 * The metric of a hood's face opening: <1 inside, 1 on the edge. Off-centre,
 * rotated, and modulated by two angular lobes so the cloth edge is irregular
 * and asymmetric rather than a drawn ellipse.
 */
function hoodHoleFn(hd, fx, hcy, rx, ry) {
  const ocx = fx + (hd.ox || 0), ocy = hcy + ry * 0.24 + (hd.oy || 0);
  const orx = rx * (1.03 + hd.tight), ory = ry * (1.06 + hd.tight);
  const rot = hd.rot || 0;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const l1 = hd.lobe1 || 0, l2 = hd.lobe2 || 0, ph = hd.ph || 0;
  return (X, Y) => {
    const dx = X - ocx, dy = Y - ocy;
    const qx = dx * cr + dy * sr, qy = -dx * sr + dy * cr;
    const ang = Math.atan2(qy, qx);
    const mod = 1 + l1 * Math.sin(ang * 2 + ph) + l2 * Math.sin(ang * 3 - ph * 1.7);
    return ell(qx, qy, orx * mod, ory * mod);
  };
}

function drawGear(buf, subj, face, ex, P) {
  const { BW, BH, px2dx, px2dy, pvx, pvy, ca, sa, hcx, hcy, fx, rx, ry,
    browY, noseY, chinY, sd, LX, LY } = P;
  const gear = face.gear;
  if (!gear.hood && !gear.helm && !gear.coif && !gear.hat) return;

  const steel = gear.steel;
  const hood = gear.hood;
  const hoodBase = hood ? desat(rs(hood.ramp, hood.t), 0.22) : null;
  const hoodDark = hood ? scl(hoodBase, 0.30) : null;
  const hoodLite = hood ? mixC(scl(hoodBase, 1.55), rs('sand', 0.78), 0.16) : null;
  const hole = hood ? hoodHoleFn(hood, fx, hcy, rx, ry) : null;

  // Rows the gear can reach: a hood drapes to the bottom edge, a helm stops
  // at the brow. Everything above the crown is background.
  const gTop = Math.max(0, Math.floor(((hcy - ry * 1.9) / DH) * BH));
  const gBot = gear.hood || gear.hat ? BH : Math.min(BH, Math.ceil(((chinY + 4) / DH) * BH));
  for (let py = gTop; py < gBot; py++) {
    const Yw = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const Xw = (pxi + 0.5) * px2dx;
      const ddx = Xw - pvx, ddy = Yw - pvy;
      const X = pvx + ddx * ca + ddy * sa;
      const Y = pvy - ddx * sa + ddy * ca;
      const ii = py * BW + pxi;
      const i3 = ii * 3;

      // ---- hood -----------------------------------------------------------
      if (hood) {
        const orx = rx * 1.20, ory = ry * (1.12 + hood.peak * 0.10);
        const ocy = hcy - ry * (0.05 + hood.peak * 0.08);
        // Outer silhouette: the two sides drape by different amounts and the
        // edge is broken by fold noise, so the hood is not a symmetric shell.
        const oside = X > hcx ? hood.drapeR : hood.drapeL;
        const em = ell((X - hcx) / oside, Y - ocy, orx, ory);
        const rough = em > 0.5 && em < 1.7 ? (fb(X * 0.4, Y * 0.4, 2, sd + 401) - 0.5) * 0.22 : 0;
        let a = cov(em + rough, 0.09);
        const dw = orx * oside + (Y - hcy) * 0.72;
        a = Math.max(a, smoothstep(dw + 1.2, dw - 0.8, Math.abs(X - hcx) + rough * 6)
          * smoothstep(hcy - 1, hcy + 5, Y));
        if (hood.peak > 0.2) {
          // A soft fold of cloth standing off the crown, tapering out - a hard
          // edge here reads as a notch cut out of the head.
          const t = clamp((ocy - ory + 2.0 - Y) / (ry * 0.34), 0, 1);
          const px2 = hcx - rx * 0.34 * t;
          const hw = rx * 0.40 * (1 - t * t * t);
          a = Math.max(a, smoothstep(hw + 1.6, hw - 1.0, Math.abs(X - px2)) * (1 - t * t));
        }
        // The opening is centred well below the head so the hood frames the
        // face and stops at the jaw instead of wrapping under the chin like a
        // wimple - and its top edge crosses the skull a quarter of the way
        // down, leaving forehead and hairline showing. It is deliberately
        // off-centre, rotated and lobed: a clean ellipse here turns the face
        // into an oval mask set in a hole.
        const holeM = hole(X, Y) + rough * 0.9;
        a *= 1 - cov(holeM, 0.09);
        if (a > 0.004) {
          const ux = (X - hcx) / orx, uy = (Y - ocy) / ory;
          const r2 = clamp(ux * ux + uy * uy, 0, 1);
          const zc = Math.sqrt(1 - r2 * 0.9);
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.16 + Math.max(0, (ux * LX + uy * LY + zc * 0.75) * nl) * 0.95;
          // Folds: radial creases running out of the face opening, which is
          // where cloth actually gathers.
          const inv = 1 / (Math.sqrt(r2) + 1e-3);
          const fold = fb(ux * inv * 3.6 + Math.sqrt(r2) * 5.5, uy * inv * 3.6, 2, sd + 403);
          const crease = Math.pow(Math.abs(Math.sin((uy * inv) * 6.5 + Math.sign(ux) * 1.4 + fold * 3.4)), 3);
          sh *= 0.72 + fold * 0.50;
          sh *= 1 - crease * 0.46;
          sh *= mix(0.20, 1, smoothstep(1.0, 1.42, holeM));   // inside the opening
          sh *= ex.key;
          let c = mixC(hoodDark, hoodBase, clamp(sh * 1.45, 0, 1));
          c = mixC(c, hoodLite, clamp((sh - 0.60) * 1.7, 0, 1) * 0.8);
          const rim = smoothstep(1.20, 1.02, holeM) * smoothstep(0.98, 1.05, holeM);
          c = mixC(c, hoodLite, rim * 0.6 * smoothstep(hcy + ry * 0.6, hcy - ry * 0.3, Y));
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- mail coif ------------------------------------------------------
      if (gear.coif) {
        // Scalloped lower edge. An even ellipse edge is what made the coif read
        // as a smooth grey bonnet; mail hangs in a wavy fringe of ring ends.
        const scal = Math.sin((X - hcx) * 0.78 + 0.6) * 0.055
          * smoothstep(hcy - ry * 0.10, hcy + ry * 0.55, Y);
        const outer = ell(X - hcx, Y - (hcy - ry * 0.02), rx * 1.07, ry * 1.05) + scal;
        const inner = ell(X - fx, Y - (hcy + ry * 0.16), rx * 1.00, ry * 1.02);
        let a = cov(outer, 0.06) * (1 - cov(inner, 0.09));
        a = Math.max(a, cov(outer, 0.06) * smoothstep(chinY - 3, chinY - 0.5, Y));
        if (a > 0.004) {
          // Rings on a staggered lattice - fine enough to read as mail at 1:1.
          const gx = X * 1.35, gy = Y * 1.35;
          const row = Math.floor(gy);
          const cx2 = Math.floor(gx + (row & 1 ? 0.5 : 0));
          const rr = Math.hypot(gx + (row & 1 ? 0.5 : 0) - cx2 - 0.5, gy - row - 0.5);
          const ring = smoothstep(0.48, 0.20, rr);
          const ux = (X - hcx) / (rx * 1.13), uy = (Y - hcy) / (ry * 1.10);
          const zc = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.10 + Math.max(0, (ux * LX + uy * LY + zc * 0.8) * nl) * 0.72;
          sh *= 0.46 + ring * 0.85;
          // A few whole rows sit darker than their neighbours, and the rows
          // near the terminator go darker still. An even lattice of identical
          // rings averages to flat grey once it is box-filtered down to 1:1.
          sh *= 0.74 + 0.42 * hash2(0, row, sd + 7);
          sh *= mix(1.0, 0.62, smoothstep(-0.05, 0.55, ux));
          sh += hash2(cx2, row, sd) * 0.14 - 0.06;
          sh *= ex.key;
          let c = mixC(steel.dark, steel.base, clamp(sh * 1.5, 0, 1));
          c = mixC(c, steel.lite, clamp((sh - 0.62) * 1.7, 0, 1) * 0.8 * ring);
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- helm -----------------------------------------------------------
      if (gear.helm) {
        const dcy = hcy - ry * 0.46;
        const drx = rx * 1.06, dry = ry * 0.74;
        let a = cov(ell(X - hcx, Y - dcy, drx, dry), 0.09) * smoothstep(browY + 0.4, browY - 0.6, Y);
        const band = smoothstep(browY - 2.8, browY - 2.2, Y) * smoothstep(browY + 0.5, browY - 0.4, Y)
          * cov(ell(X - hcx, Y - dcy, drx * 1.04, dry * 1.32), 0.11);
        a = Math.max(a, band);
        if (gear.helm.cheek) {
          const cg = smoothstep(rx * 1.04, rx * 0.84, Math.abs(X - hcx))
            * smoothstep(rx * 0.68, rx * 0.84, Math.abs(X - hcx))
            * smoothstep(browY - 1, browY + 2, Y) * (1 - smoothstep(noseY + 2, noseY + 5, Y));
          a = Math.max(a, cg);
        }
        let nasal = 0;
        if (gear.helm.nasal) {
          nasal = smoothstep(1.30, 0.70, Math.abs(X - fx))
            * smoothstep(browY - 3, browY - 1.5, Y) * (1 - smoothstep(noseY - 2.0, noseY + 0.4, Y));
          a = Math.max(a, nasal);
        }
        if (a > 0.004) {
          const ux = (X - hcx) / drx, uy = (Y - dcy) / dry;
          const zc = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.10 + Math.max(0, (ux * LX + uy * LY + zc * 0.78) * nl) * 0.95;
          // Steel has a much tighter falloff than skin: one hard reflection,
          // a dark horizon just below it, and hammer-planished tone variation.
          sh += Math.exp(-sq((ux + 0.42) / 0.17)) * Math.exp(-sq((uy + 0.28) / 0.50)) * 0.55;
          sh -= Math.exp(-sq((ux - 0.34) / 0.30)) * Math.exp(-sq((uy - 0.10) / 0.55)) * 0.22;
          // raised centre seam running over the crown
          const seam = Math.exp(-sq((X - hcx + rx * 0.10) / 0.85));
          sh += seam * (0.30 - 0.55 * smoothstep(0.0, 0.7, ux + 0.10));
          sh *= 0.90 + (fb(X * 1.6, Y * 1.6, 2, sd + 411) - 0.5) * 0.26;
          if (band > 0.5) sh = sh * 0.75 + 0.22;
          if (nasal > 0.5) sh = 0.24 + Math.max(0, 1 - Math.abs(X - fx + 0.4) / 1.3) * 0.70;
          sh *= ex.key;
          let c = mixC(steel.dark, steel.base, clamp(sh * 1.35, 0, 1));
          c = mixC(c, steel.lite, clamp((sh - 0.70) * 1.8, 0, 1));
          if (gear.helm.gold && band > 0.5) {
            c = mixC(c, mixC(rs('gold', 0.26), rs('gold', 0.82), clamp(sh, 0, 1)), 0.8);
          }
          if (band > 0.5) {
            const rv = Math.abs(((X - hcx) / 3.4) % 1 - 0.5);
            c = mixC(c, steel.lite, smoothstep(0.16, 0.02, rv) * 0.45);
          }
          c = scl(c, mix(1, 0.50, smoothstep(browY - 1.8, browY + 0.4, Y)));
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- sorcerer hat ---------------------------------------------------
      if (gear.hat) {
        const brimY = browY - ry * 0.16;
        const tipX = hcx + gear.hat.tilt * rx * 0.55;
        const tipY = brimY - ry * 1.00 * gear.hat.len;
        const t = clamp((brimY - Y) / (brimY - tipY), 0, 1);
        const cxp = mix(hcx, tipX, t * t * 0.85 + t * 0.15) + Math.sin(t * Math.PI) * rx * 0.10;
        const hw = rx * 0.98 * Math.pow(1 - t, 0.8) + 0.35;
        let a = smoothstep(hw + 0.7, hw - 0.5, Math.abs(X - cxp)) * smoothstep(0, 0.03, t)
          * (1 - smoothstep(0.97, 1.0, t));
        const brim = cov(ell(X - hcx, Y - brimY, rx * 1.42, ry * 0.19), 0.26);
        a = Math.max(a, brim);
        if (a > 0.004) {
          const base = desat(mixC(rs('sky', 0.13), rs('arcane', 0.22), 0.45), 0.26);
          const dark = scl(base, 0.34), lite = desat(mixC(scl(base, 1.6), rs('arcane', 0.52), 0.22), 0.20);
          const uu = (X - cxp) / (hw + 0.001);
          let sh = 0.20 + Math.max(0, 1 - Math.pow(uu + 0.45, 2) * 1.25) * 0.80;
          if (brim > 0.5) sh = 0.26 + 0.50 * smoothstep(brimY + 1.4, brimY - 1.4, Y);
          sh *= 0.86 + fb(X * 1.1, Y * 1.1, 2, sd + 421) * 0.34;
          sh *= ex.key;
          let c = mixC(dark, base, clamp(sh * 1.5, 0, 1));
          c = mixC(c, lite, clamp((sh - 0.60) * 1.8, 0, 1) * 0.7);
          if (Y > brimY - ry * 0.19 && Y < brimY - ry * 0.03 && brim < 0.5) {
            c = mixC(c, mixC(rs('gold', 0.28), rs('gold', 0.74), clamp(sh, 0, 1)), 0.6);
          }
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }
    }
  }
}

// --- shoulders / collar ----------------------------------------------------

function drawShoulders(buf, subj, face, ex, P) {
  const { BW, BH, px2dx, px2dy, hcx, fx, rx, ry, chinY, neckCX, neckW, sd } = P;
  const gear = face.gear;
  const kind = gear.collar;
  const steel = gear.steel;
  const shTop = chinY + 5.0;

  const cloth = {
    plate: { base: rs('stone', 0.44), dark: null, lite: null },
    leather: { base: rs('wood', 0.30), dark: null, lite: null },
    robe: { base: rs(gear.hood ? gear.hood.ramp : gear.robe.ramp, gear.hood ? gear.hood.t : gear.robe.t), dark: null, lite: null },
    arcane: { base: desat(mixC(rs('sky', 0.13), rs('arcane', 0.22), 0.45), 0.26), dark: null, lite: null },
    cloth: { base: rs(gear.robe.ramp, gear.robe.t), dark: null, lite: null },
  }[kind] || { base: rs('dirt', 0.30), dark: null, lite: null };
  cloth.dark = scl(cloth.base, 0.30);
  cloth.lite = mixC(scl(cloth.base, 1.5), rs('sand', 0.80), 0.18);

  for (let py = 0; py < BH; py++) {
    const Y = (py + 0.5) * px2dy;
    if (Y < shTop - 9) continue;
    for (let pxi = 0; pxi < BW; pxi++) {
      const X = (pxi + 0.5) * px2dx;
      const ii = py * BW + pxi;
      const i3 = ii * 3;
      const dx = X - hcx;
      const adx = Math.abs(dx);

      // Trapezius: high beside the neck, sloping away to the frame edge.
      const top = shTop + 9.5 * smoothstep(rx * 0.30, rx * 2.0, adx);
      let a = smoothstep(top - 1.1, top + 1.1, Y);
      const ring = cov(ell(dx - (neckCX - hcx), Y - (chinY + 4.2), neckW * 2.1, ry * 0.32), 0.15)
        * smoothstep(chinY + 0.5, chinY + 2.2, Y);
      a = Math.max(a, ring);
      if (a <= 0.004) continue;

      const roll = clamp(1 - Math.pow((dx + rx * 0.55) / (rx * 1.9), 2), 0, 1);
      let sh = 0.14 + roll * 0.68;
      sh *= mix(0.40, 1.05, smoothstep(top - 0.5, top + 6, Y));
      // the head casts down onto the collar
      sh *= mix(0.45, 1, smoothstep(neckW * 1.2, neckW * 2.8, adx));
      let c;

      if (kind === 'plate') {
        const bandT = (Y - top) / 4.6;
        const bf = bandT - Math.floor(bandT);
        sh += Math.exp(-Math.pow((bf - 0.14) / 0.11, 2)) * 0.45;
        sh -= smoothstep(0.84, 0.99, bf) * 0.32;
        sh += Math.exp(-Math.pow((dx + rx * 0.5) / (rx * 0.5), 2)) * 0.26;
        if (ring > 0.5) {
          const rr = (Y - (chinY + 1.4)) / (ry * 0.30);
          sh = 0.18 + Math.exp(-Math.pow((rr - 0.15) / 0.35, 2)) * 0.80 + roll * 0.22;
        }
        sh *= 0.94 + (fb(X * 1.4, Y * 1.4, 2, sd + 501) - 0.5) * 0.16;
        sh *= ex.key;
        c = mixC(steel.dark, steel.base, clamp(sh * 1.35, 0, 1));
        c = mixC(c, steel.lite, clamp((sh - 0.68) * 1.9, 0, 1));
        if (gear.trim === 'gold') {
          const edge = Math.exp(-Math.pow((Y - top - 0.9) / 1.2, 2));
          c = mixC(c, mixC(rs('gold', 0.30), rs('gold', 0.84), clamp(sh, 0, 1)), edge * 0.75);
        }
      } else {
        const fold = fb(X * 0.62 + Y * 0.10, Y * 0.30, 2, sd + 503);
        const crease = Math.pow(Math.abs(Math.sin(dx * 0.55 + fold * 4.0)), 4);
        sh *= 0.68 + fold * 0.66;
        sh *= 1 - crease * 0.28;
        sh += Math.max(0, 1 - Math.abs(dx + rx * 0.9) / (rx * 0.7)) * 0.16;
        sh *= ex.key;
        c = mixC(cloth.dark, cloth.base, clamp(sh * 1.45, 0, 1));
        c = mixC(c, cloth.lite, clamp((sh - 0.64) * 1.7, 0, 1) * 0.75);
        if (kind === 'leather') {
          const st = Math.exp(-Math.pow((Y - top - 2.6) / 0.55, 2));
          const dash = Math.abs((X / 1.6) % 1 - 0.5) < 0.28 ? 1 : 0;
          c = mixC(c, cloth.lite, st * dash * 0.5);
        }
        if (kind === 'arcane' || gear.mantle) {
          // A worn embroidered band, not a string of fairy lights.
          const st = Math.exp(-sq((Y - top - 2.2) / 1.1));
          const gl = nz(X * 0.75, Y * 0.75, sd + 507);
          c = mixC(c, desat(rs('arcane', 0.50), 0.42), st * smoothstep(0.55, 0.92, gl) * 0.28);
        }
      }
      bl(buf, i3, c, a);
      subj[ii] = Math.max(subj[ii], a);

      if (gear.symbol) {
        const sy = DH - 4.5, sxp = fx + 0.5;
        const gold = mixC(rs('gold', 0.36), rs('gold', 0.88), clamp(0.35 + roll * 0.6, 0, 1));
        if (gear.symbol === 'cross') {
          if ((Math.abs(X - sxp) < 0.95 && Y > sy - 3.6 && Y < sy + 3.2)
            || (Math.abs(Y - (sy - 1.2)) < 0.95 && Math.abs(X - sxp) < 2.6)) {
            bl(buf, i3, gold, 0.95);
          }
        } else {
          const d = Math.sqrt(ell(X - sxp, Y - sy, 3.0, 3.0));
          if (d < 1.05) {
            const ang = Math.atan2(Y - sy, X - sxp);
            bl(buf, i3, scl(gold, 0.7 + (0.5 + 0.5 * Math.cos(ang * 8)) * 0.5), cov(d * d, 0.3) * 0.95);
          }
        }
      }
    }
  }
}

// --- final grade -----------------------------------------------------------

function gradePass(buf, subj, face, ex, BW, BH, px2dx, px2dy, sd) {
  const stoneD = rs('stone', 0.10), stoneM = rs('stone', 0.44), stoneL = rs('stone', 0.84);
  const tinted = ex.tint[0] !== 1 || ex.tint[1] !== 1 || ex.tint[2] !== 1;
  for (let py = 0; py < BH; py++) {
    const Y = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const X = (pxi + 0.5) * px2dx;
      const ii = py * BW + pxi;
      const i3 = ii * 3;
      let c = [buf[i3], buf[i3 + 1], buf[i3 + 2]];
      const s = subj[ii];

      if (ex.stone && s > 0.01) {
        const l = lum(c) / 255;
        const facet = (fb(X * 0.85, Y * 0.85, 2, sd + 601) - 0.5) * 0.22
          + (nz(X * 2.2, Y * 2.2, sd + 602) - 0.5) * 0.10;
        const t = clamp(l * 1.05 + facet, 0, 1);
        let sc = t < 0.5 ? mixC(stoneD, stoneM, t * 2) : mixC(stoneM, stoneL, (t - 0.5) * 2);
        const cr = Math.abs(fb(X * 0.5, Y * 0.55, 3, sd + 603) - 0.5);
        sc = scl(sc, cr < 0.035 ? 0.55 : 1);
        c = mixC(c, sc, s);
      }

      if (ex.ash) {
        const grad = Math.abs(s - subj[Math.min(BW * BH - 1, ii + 1)])
          + Math.abs(s - subj[Math.min(BW * BH - 1, ii + BW)]);
        let a = scl(c, 0.10);
        a = mixC(a, mixC(rs('grey', 0.14), rs('fire', 0.16), 0.4), s * 0.5);
        const ember = nz(X * 2.2, Y * 2.2 - 3, sd + 611);
        a = mixC(a, rs('fire', 0.70 + 0.30 * nz(X * 5, Y * 5, sd + 612)),
          smoothstep(0.945, 0.99, ember) * s * 0.95);
        a = add3(a, rs('fire', 0.55), clamp(grad, 0, 1) * 0.55);
        c = a;
      }

      if (ex.sat !== 1) c = desat(c, 1 - ex.sat);
      let r = c[0], gc = c[1], b = c[2];
      if (tinted) {
        const k = 0.35 + 0.65 * s;
        r *= 1 + (ex.tint[0] - 1) * k;
        gc *= 1 + (ex.tint[1] - 1) * k;
        b *= 1 + (ex.tint[2] - 1) * k;
      }
      // paint grain, corner vignette, and a small contrast lift - these plates
      // sit inside a dark carved-stone bar
      const k2 = (1 + (fb(X * 1.15, Y * 1.15, 2, sd + 701) - 0.5) * (0.045 + 0.03 * (1 - s)))
        * (1 - smoothstep(0.60, 1.30,
          Math.sqrt(ell(X - DW * 0.5, Y - DH * 0.5, DW * 0.58, DH * 0.60))) * 0.55) * 1.10;
      const lift = -0.05 * 255;
      buf[i3] = clamp(r * k2 + lift + 1, 0, 255);
      buf[i3 + 1] = clamp(gc * k2 + lift, 0, 255);
      buf[i3 + 2] = clamp(b * k2 + lift, 0, 255);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render one expression of one face.
 * @returns {HTMLCanvasElement|OffscreenCanvas} opaque, palettised
 */
export function renderPortrait(face, expression = 'normal', w = PORTRAIT_W, h = PORTRAIT_H) {
  // Defensive: a NaN or silly size here would either allocate a gigantic
  // buffer or hand the canvas a bad dimension, and this runs during loading
  // where neither failure is recoverable.
  w = Math.max(8, Math.min(256, Math.round(Number(w) || PORTRAIT_W)));
  h = Math.max(8, Math.min(256, Math.round(Number(h) || PORTRAIT_H)));
  if (!face || !face.geom) face = makeFace(0, {});
  const ex = exprOf(expression);
  const { buf, BW } = paint(face, ex, w, h);
  const canvas = makeCanvas(w, h);
  const g = ctx2d(canvas);
  const img = g.createImageData(w, h);
  const d = img.data;
  const inv = 1 / (SS * SS);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, gg = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = ((y * SS + sy) * BW + x * SS) * 3;
        for (let sx = 0; sx < SS; sx++) {
          const i = row + sx * 3;
          r += buf[i]; gg += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      d[o] = r * inv; d[o + 1] = gg * inv; d[o + 2] = b * inv; d[o + 3] = 255;
    }
  }
  // Light dither: enough stipple to break the gradients into the era's look
  // without turning the cheeks into noise.
  ditherImageData(img, 6);
  g.putImageData(img, 0, 0);
  return canvas;
}

const sheetCache = new Map();
const SHEET_CACHE_MAX = 12;     // a party of four plus hirelings and NPCs

/** LRU-ish trim so a long session cannot accumulate atlases without bound. */
function cachePut(map, key, val, max) {
  map.set(key, val);
  while (map.size > max) map.delete(map.keys().next().value);
  return val;
}

/**
 * Build one face's expression atlas, yielding after each frame so a loading
 * screen can paint between them. Blocking for two seconds inside one task is
 * what makes a tab look hung.
 */
function* sheetGen(face, w, h) {
  const cols = 7, rows = Math.ceil(EXPRESSIONS.length / cols);
  const canvas = makeCanvas(cols * w, rows * h);
  const g = ctx2d(canvas);
  for (let i = 0; i < EXPRESSIONS.length; i++) {
    g.drawImage(renderPortrait(face, EXPRESSIONS[i], w, h), (i % cols) * w, Math.floor(i / cols) * h);
    yield i;
  }
  return {
    canvas, cols, rows, cellW: w, cellH: h,
    index: (expr) => Math.max(0, EXPRESSIONS.indexOf(expr)),
    rect: (expr) => {
      const i = Math.max(0, EXPRESSIONS.indexOf(expr));
      return { x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h };
    },
  };
}

/**
 * Every expression of one face on a single atlas so the HUD can blit without
 * re-rendering when a character's condition changes.
 */
export function portraitSheet(face, w = PORTRAIT_W, h = PORTRAIT_H) {
  const key = faceKey(face) + `|${w}x${h}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const it = sheetGen(face, w, h);
  let r = it.next();
  while (!r.done) r = it.next();
  return cachePut(sheetCache, key, r.value, SHEET_CACHE_MAX);
}

const faceCache = new Map();
const portraitCache = new Map();

function faceKey(face) {
  return `${face.seed}|${face.sex}|${face.klass}|${face.age}`;
}

/** Cached single portrait straight from a seed. */
export function getPortrait(seed, opts = {}, expression = 'normal') {
  const fk = `${seed}|${opts.sex || '?'}|${opts.klass || '?'}|${opts.age || '?'}`;
  let face = faceCache.get(fk);
  if (!face) face = cachePut(faceCache, fk, makeFace(seed, opts), 64);
  const pk = `${fk}|${expression}`;
  const hit = portraitCache.get(pk);
  if (hit) return hit;
  return cachePut(portraitCache, pk, renderPortrait(face, expression), 160);
}

/**
 * The frames the HUD actually reaches for in normal play. Warming these keeps
 * loading short; the rarer conditions cost one frame of hitch the first time
 * they happen, which is invisible next to the message log popping up.
 */
export const CORE_EXPRESSIONS = ['normal', 'smile', 'dmg_minor', 'dmg_moderate',
  'dmg_major', 'poisoned', 'asleep', 'unconscious', 'dead'];

/**
 * Loading-screen generator. Yields between every single frame, never between
 * faces: a whole face is 27 frames and holding the main thread for all of them
 * at once reads as a hang.
 * @param {Array<{seed:*, sex?:string, klass?:string, age?:string}>|Array<number>} seeds
 */
export function* buildPortraits(seeds) {
  const list = Array.isArray(seeds) ? seeds.slice(0, 32) : [];
  const out = [];
  const total = Math.max(1, list.length * CORE_EXPRESSIONS.length);
  let step = 0, worst = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const spec = typeof s === 'object' && s !== null ? s : { seed: s };
    const seed = spec.seed !== undefined ? spec.seed : 0;
    const face = makeFace(seed, spec);
    const fk = `${seed}|${spec.sex || '?'}|${spec.klass || '?'}|${spec.age || '?'}`;
    faceCache.set(fk, face);
    for (const e of CORE_EXPRESSIONS) {
      const pk = `${fk}|${e}`;
      if (!portraitCache.has(pk)) {
        const t0 = now();
        cachePut(portraitCache, pk, renderPortrait(face, e), 160);
        const dt = now() - t0;
        if (dt > worst) worst = dt;
      }
      yield { i, index: ++step, total, face, expression: e };
    }
    // The full atlas is only built if something actually asks for it.
    out.push({ face, seed, get sheet() { return portraitSheet(face); } });
  }
  if (worst > 30 && typeof console !== 'undefined' && console.info) {
    console.info(`portraits: slowest frame ${worst.toFixed(1)} ms (budget 30 ms)`);
  }
  return out;
}
