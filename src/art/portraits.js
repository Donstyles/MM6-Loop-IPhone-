// ---------------------------------------------------------------------------
// Painted party portraits.
//
// MM6's bottom bar carries four hand-painted head-and-shoulders portraits that
// swap to a different painting as the character's condition changes. They are
// the most-looked-at art in the game, so these are built the way the originals
// were *painted* rather than the way sprites are drawn: a lit surface first,
// features second.
//
// The head is an implicit surface - a tapered ellipsoid plus a pile of soft
// blobs for the brow ridge, nose, cheekbones, lips and chin - evaluated into a
// height field. Normals come out of that height field, a single key light from
// the upper left does the modelling, and the skin colour is a three-point ramp
// (deep warm shadow / mid / pale warm highlight) driven by the shading term
// with the terminator pushed red. That is what stops the result reading as flat
// vector shapes: every value on the face comes from geometry, not from a fill.
//
// Everything is painted at 3x and box-filtered down before palettising, which
// gives the soft edges the original scans have; the light ordered dither on top
// puts the era's stipple back into the gradients.
// ---------------------------------------------------------------------------

import { ditherImageData } from '../core/palette.js';
import { Rand, clamp, smoothstep, valueNoise2, fbm2, hash2 } from '../core/rng.js';
import { makeCanvas, ctx2d, rampSample, mixC } from './texcanvas.js';

export const PORTRAIT_W = 63;
export const PORTRAIT_H = 73;

export const EXPRESSIONS = ['normal', 'smile', 'hurt', 'angry', 'scared', 'poisoned',
  'diseased', 'asleep', 'drunk', 'insane', 'paralyzed', 'unconscious', 'dead', 'stoned',
  'eradicated', 'level_up', 'cast'];

/** Supersample factor. 3x downsampled with a box filter reads as brush softness. */
const SS = 3;

// Design space. All geometry below is written in these units and mapped onto
// whatever output size the caller asked for, so portraits can be re-rendered
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
const fb = (x, y, o, s) => fbm2(x, y, o, 2, 0.5, s) * 0.5 + 0.5; // 0..1

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

const SKIN_TONES = {
  pale: { t: 0.74, tint: [1.00, 0.98, 0.98], ruddy: 0.34 },
  fair: { t: 0.66, tint: [1.00, 0.97, 0.93], ruddy: 0.30 },
  tan: { t: 0.55, tint: [1.00, 0.94, 0.84], ruddy: 0.26 },
  olive: { t: 0.48, tint: [0.94, 0.94, 0.78], ruddy: 0.20 },
  brown: { t: 0.36, tint: [0.94, 0.82, 0.68], ruddy: 0.18 },
  dark: { t: 0.25, tint: [0.90, 0.74, 0.58], ruddy: 0.14 },
};

function skinRamp(tone) {
  const s = SKIN_TONES[tone];
  const f = rs('flesh', s.t);
  const mid = [f[0] * s.tint[0], f[1] * s.tint[1], f[2] * s.tint[2]];
  // Shadows go warm and red (blood under the skin), highlights go pale and warm.
  const deep = mixC(scl(mid, 0.26), rs('blood', 0.26), s.ruddy);
  const lite = mixC(scl(mid, 1.42), rs('sand', 0.86), 0.26);
  return { mid, deep, lite, ruddy: s.ruddy };
}

const HAIR_COLOURS = {
  black: () => mixC(rs('grey', 0.10), rs('wood', 0.16), 0.45),
  darkbrown: () => rs('wood', 0.30),
  brown: () => rs('wood', 0.46),
  auburn: () => mixC(rs('wood', 0.44), rs('blood', 0.46), 0.42),
  red: () => mixC(rs('fire', 0.42), rs('wood', 0.42), 0.42),
  blonde: () => mixC(rs('sand', 0.74), rs('gold', 0.60), 0.30),
  grey: () => rs('grey', 0.46),
  white: () => rs('grey', 0.76),
};

const EYE_COLOURS = {
  brown: () => rs('wood', 0.42),
  hazel: () => mixC(rs('wood', 0.48), rs('swamp', 0.62), 0.45),
  green: () => mixC(rs('foliage', 0.62), rs('swamp', 0.60), 0.35),
  blue: () => mixC(rs('sky', 0.46), rs('water', 0.62), 0.45),
  grey: () => rs('stone', 0.58),
  amber: () => rs('gold', 0.52),
};

const FACE_SHAPES = {
  round: { rx: 16.2, ry: 20.0, wTop: 0.72, wTemple: 0.95, wCheek: 1.00, wJaw: 0.88, wChin: 0.60 },
  long: { rx: 14.5, ry: 22.2, wTop: 0.72, wTemple: 0.95, wCheek: 0.98, wJaw: 0.74, wChin: 0.44 },
  square: { rx: 15.9, ry: 20.6, wTop: 0.75, wTemple: 0.97, wCheek: 1.00, wJaw: 0.95, wChin: 0.72 },
  gaunt: { rx: 14.2, ry: 21.8, wTop: 0.70, wTemple: 0.92, wCheek: 0.97, wJaw: 0.68, wChin: 0.42 },
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
    { v: 'pale', w: 3 }, { v: 'fair', w: 4 }, { v: 'tan', w: 4 },
    { v: 'olive', w: 3 }, { v: 'brown', w: 2 }, { v: 'dark', w: 2 },
  ]).v;

  let hairName = r.weighted([
    { v: 'black', w: 4 }, { v: 'darkbrown', w: 5 }, { v: 'brown', w: 4 },
    { v: 'auburn', w: 3 }, { v: 'red', w: 2 }, { v: 'blonde', w: 3 },
    { v: 'grey', w: old ? 6 : 1 }, { v: 'white', w: old ? 4 : 0.4 },
  ]).v;
  if (old && (hairName === 'black' || hairName === 'darkbrown') && r.bool(0.5)) hairName = 'grey';

  const shapeName = r.weighted([
    { v: 'round', w: 3 }, { v: 'long', w: 3 },
    { v: 'square', w: sex === 'm' ? 4 : 2 }, { v: 'gaunt', w: old ? 4 : 2 },
  ]).v;

  const hairStyle = r.weighted(sex === 'm' ? [
    { v: 'short', w: 6 }, { v: 'long', w: 2 }, { v: 'ponytail', w: 2 },
    { v: 'bald', w: old ? 3 : 1 }, { v: 'receding', w: old ? 4 : 1 },
    { v: 'braided', w: 1 }, { v: 'wild', w: 2 },
  ] : [
    { v: 'short', w: 2 }, { v: 'long', w: 6 }, { v: 'ponytail', w: 3 },
    { v: 'braided', w: 3 }, { v: 'wild', w: 2 }, { v: 'receding', w: 0 }, { v: 'bald', w: 0.2 },
  ]).v;

  const beard = sex === 'f' ? 'none' : r.weighted([
    { v: 'none', w: young ? 5 : 3 }, { v: 'stubble', w: 3 },
    { v: 'moustache', w: 2 }, { v: 'short', w: 3 },
    { v: 'full', w: old ? 3 : 2 }, { v: 'long', w: old ? 2 : 0.8 },
  ]).v;

  const shp = FACE_SHAPES[shapeName];
  const fem = sex === 'f';
  const rx = shp.rx * (fem ? 0.955 : 1) * r.float(0.97, 1.03);
  const ry = shp.ry * (fem ? 0.985 : 1) * r.float(0.98, 1.02);

  // Head sits a touch right of centre and looks a little to the viewer's left,
  // which is how nearly every portrait in the original is composed.
  const headCX = DW * 0.5 + r.float(0.4, 1.9);
  const headTop = 10.6 + r.float(-0.5, 0.8);
  const turn = -r.float(0.09, 0.17);

  const gear = classGear(klass, r, sex, age, hairStyle);

  const face = {
    seed: key, sex, klass, age, shape: shapeName,
    toneName, skin: skinRamp(toneName),
    hairName, hairStyle, hair: buildHairColours(hairName),
    eyeName: r.pick(Object.keys(EYE_COLOURS)),
    beard,
    geom: {
      headCX, headTop, rx, ry, rz: rx * 1.06,
      wTop: shp.wTop, wTemple: shp.wTemple, wCheek: shp.wCheek,
      wJaw: shp.wJaw * (fem ? 0.93 : 1) * (old ? 1.05 : 1),
      wChin: shp.wChin * (fem ? 0.92 : 1),
      turn,
      browY: headTop + ry * (0.845 + r.float(-0.02, 0.02)),
      browHeavy: (fem ? 0.45 : 1.0) * (old ? 1.25 : 1) * r.float(0.85, 1.15),
      browThick: (fem ? 0.62 : 1.0) * r.float(0.85, 1.2) * (old ? 1.2 : 1),
      browArch: fem ? r.float(0.9, 1.5) : r.float(0.3, 0.9),
      eyeSep: rx * r.float(0.345, 0.385),
      eyeW: rx * (fem ? 0.235 : 0.218) * r.float(0.95, 1.06),
      eyeOpenBase: fem ? 1.06 : 0.98,
      noseW: rx * (fem ? 0.185 : 0.215) * r.float(0.92, 1.12),
      noseLen: r.float(0.33, 0.40),
      noseBulb: r.float(0.7, 1.25) * (fem ? 0.85 : 1),
      noseHook: r.float(-0.35, 0.9) * (old ? 1.3 : 1),
      mouthW: rx * (fem ? 0.315 : 0.335) * r.float(0.92, 1.08),
      lipFull: (fem ? 1.35 : 1.0) * r.float(0.85, 1.15),
      cheekBone: r.float(0.7, 1.35) + (shapeName === 'gaunt' ? 0.35 : 0),
      hollow: (shapeName === 'gaunt' ? 0.8 : 0.15) + (old ? 0.3 : 0),
      jowl: old ? r.float(0.4, 0.9) : 0,
      ears: r.float(0.85, 1.15),
    },
    marks: {
      wrinkle: old ? r.float(0.8, 1.15) : (age === 'middle' ? r.float(0.15, 0.45) : 0.05),
      freckles: r.bool(0.22) && toneName !== 'dark' && toneName !== 'brown' ? r.float(0.4, 1) : 0,
      scar: r.bool(0.18) ? { side: r.bool() ? 1 : -1, y: r.float(-0.3, 0.5), len: r.float(0.5, 1) } : null,
      stubbleTone: r.float(0.8, 1.2),
    },
    gear,
    bgTint: classBgTint(klass),
    noiseSeed: (typeof key === 'string' ? 7919 : key | 0) ^ 0x2f1b,
  };
  return face;
}

function buildHairColours(name) {
  const base = HAIR_COLOURS[name]();
  const light = name === 'white' || name === 'grey' || name === 'blonde';
  return {
    base,
    dark: scl(base, light ? 0.42 : 0.34),
    lite: mixC(scl(base, light ? 1.22 : 1.55), rs('sand', 0.9), light ? 0.30 : 0.16),
    sheen: light ? 0.85 : 0.55,
  };
}

function classGear(klass, r, sex, age, hairStyle) {
  const steel = { base: rs('stone', 0.52), dark: rs('stone', 0.16), lite: rs('grey', 0.86) };
  const g = {
    helm: null, coif: false, hood: null, hat: null,
    collar: 'cloth', trim: null, symbol: null, mantle: false, steel,
  };
  switch (klass) {
    case 'knight':
      if (r.bool(0.62)) g.helm = { kind: 'open', nasal: r.bool(0.7), cheek: r.bool(0.45), gold: 0 };
      else g.coif = true;
      g.collar = 'plate';
      break;
    case 'paladin':
      if (r.bool(0.5)) g.helm = { kind: 'open', nasal: r.bool(0.5), cheek: r.bool(0.3), gold: 1 };
      else g.coif = true;
      g.collar = 'plate';
      g.trim = 'gold';
      g.symbol = r.bool(0.5) ? 'sun' : null;
      break;
    case 'archer':
      g.hood = { ramp: 'foliage', t: 0.42, peak: 0.25, tight: 0.0 };
      g.collar = 'leather';
      break;
    case 'cleric':
      g.hood = { ramp: r.bool(0.5) ? 'plaster' : 'stone', t: r.float(0.38, 0.5), peak: 0.1, tight: 0.1 };
      g.collar = 'robe';
      g.symbol = 'cross';
      break;
    case 'sorcerer':
      if (r.bool(0.55)) g.hat = { tilt: r.float(-1.6, -0.5), len: r.float(0.9, 1.15) };
      else g.hood = { ramp: 'sky', t: 0.22, peak: 0.5, tight: 0.05 };
      g.collar = 'arcane';
      g.mantle = true;
      break;
    case 'druid':
      g.hood = { ramp: 'grass', t: r.float(0.32, 0.44), peak: 0.42, tight: -0.05 };
      g.collar = 'robe';
      break;
  }
  // A hood swallows most hair; keep a bit escaping at the front for character.
  g.hairVisible = g.hood ? 0.45 : 1;
  if (g.helm) g.hairVisible = 0.55;
  if (hairStyle === 'bald') g.hairVisible = 0;
  return g;
}

function classBgTint(klass) {
  switch (klass) {
    case 'archer': return [0.92, 1.02, 0.88];
    case 'druid': return [0.90, 1.03, 0.86];
    case 'sorcerer': return [0.95, 0.92, 1.10];
    case 'cleric': return [1.03, 1.00, 0.94];
    case 'paladin': return [1.06, 1.00, 0.90];
    default: return [1, 1, 1];
  }
}

// --- expression table ------------------------------------------------------
// Every field is a delta on the neutral pose; `paint` reads them straight.

const EXPR_BASE = {
  browIn: 0, browOut: 0, browThick: 1, browTilt: 0,
  eyeOpenL: 1, eyeOpenR: 1, lidLow: 0, pupil: 1, gazeX: 0, gazeY: 0, wide: 0,
  mouthCurve: 0, mouthOpen: 0, mouthW: 1, teeth: 0, mouthSkew: 0,
  tilt: 0, key: 1, amb: 1, tint: [1, 1, 1], sat: 1, gamma: 1,
  hollow: 0, wound: 0, blush: 0, blotch: 0, pale: 0,
  stone: 0, ash: 0, arcane: 0, glow: 0, rimGold: 0, rigid: 0,
};

const EXPR = {
  normal: {},
  smile: { browIn: -0.25, eyeOpenL: 0.80, eyeOpenR: 0.80, lidLow: 0.35, mouthCurve: 1.55, mouthOpen: 0.12, key: 1.10, tint: [1.03, 1.00, 0.97] },
  level_up: { browIn: -0.6, browOut: -0.4, eyeOpenL: 0.86, eyeOpenR: 0.86, lidLow: 0.25, mouthCurve: 1.9, mouthOpen: 0.30, teeth: 0.7, key: 1.26, amb: 1.15, rimGold: 1, tint: [1.07, 1.02, 0.90] },
  hurt: { browIn: 1.5, browOut: -0.9, browTilt: -0.5, eyeOpenL: 0.30, eyeOpenR: 0.34, mouthCurve: -1.3, mouthOpen: 0.72, teeth: 0.55, wound: 1, key: 1.02, tint: [1.05, 0.93, 0.90] },
  angry: { browIn: 2.0, browOut: -1.0, browTilt: 0.9, browThick: 1.15, eyeOpenL: 0.72, eyeOpenR: 0.72, lidLow: 0.4, pupil: 0.85, mouthCurve: -0.85, mouthW: 0.93, key: 1.06, tint: [1.12, 0.92, 0.84] },
  scared: { browIn: -1.9, browOut: -1.5, browTilt: -1.0, eyeOpenL: 1.42, eyeOpenR: 1.42, wide: 1, pupil: 0.66, mouthCurve: -0.4, mouthOpen: 0.5, mouthW: 0.62, key: 0.98, tint: [0.92, 0.97, 1.10], sat: 0.85 },
  poisoned: { browIn: 0.6, browOut: -0.3, eyeOpenL: 0.42, eyeOpenR: 0.46, mouthCurve: -0.7, mouthOpen: 0.16, hollow: 1, tint: [0.70, 1.02, 0.64], sat: 0.9, key: 0.95 },
  diseased: { browIn: 0.35, eyeOpenL: 0.48, eyeOpenR: 0.44, mouthCurve: -0.5, mouthOpen: 0.10, hollow: 0.75, blotch: 1, tint: [1.02, 0.96, 0.66], sat: 0.5, key: 0.9 },
  asleep: { eyeOpenL: 0, eyeOpenR: 0, tilt: 8, mouthCurve: 0.45, mouthOpen: 0.18, browIn: -0.2, key: 0.88, amb: 0.95 },
  drunk: { eyeOpenL: 0.50, eyeOpenR: 0.26, browIn: -0.3, browOut: 0.5, mouthCurve: 0.95, mouthOpen: 0.22, mouthSkew: 1, blush: 1, tilt: 4, key: 1.0, tint: [1.10, 0.94, 0.90] },
  insane: { eyeOpenL: 1.45, eyeOpenR: 0.42, browIn: -1.2, browOut: -0.8, browTilt: 1.2, mouthCurve: 1.9, mouthOpen: 0.55, teeth: 0.95, mouthSkew: 0.6, sat: 0.62, tint: [1.02, 0.99, 1.04], key: 1.05 },
  paralyzed: { eyeOpenL: 1.25, eyeOpenR: 1.25, pupil: 0.5, mouthOpen: 0.16, rigid: 1, tint: [0.84, 0.93, 1.12], sat: 0.42, key: 0.95, wide: 0.6 },
  unconscious: { eyeOpenL: 0, eyeOpenR: 0, tilt: 16, mouthOpen: 0.34, mouthCurve: -0.3, pale: 1, key: 0.80, amb: 0.9 },
  dead: { eyeOpenL: 0.06, eyeOpenR: 0.06, tilt: 11, mouthOpen: 0.48, mouthCurve: -0.5, sat: 0.16, tint: [0.86, 0.93, 0.88], key: 0.70, amb: 0.85, hollow: 0.5 },
  stoned: { eyeOpenL: 0.88, eyeOpenR: 0.88, mouthOpen: 0.05, stone: 1, key: 1.0 },
  eradicated: { eyeOpenL: 0.5, eyeOpenR: 0.5, mouthOpen: 0.4, ash: 1 },
  cast: { eyeOpenL: 1.12, eyeOpenR: 1.12, browIn: -0.5, mouthOpen: 0.5, mouthCurve: -0.1, glow: 1, arcane: 1, key: 0.95, tint: [0.98, 0.98, 1.06] },
};

function exprOf(name) {
  const e = EXPR[name] || EXPR.normal;
  return Object.assign({}, EXPR_BASE, e);
}

// ---------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------

function paint(face, ex, W, H) {
  const BW = W * SS, BH = H * SS, N = BW * BH;
  const buf = new Float32Array(N * 3);
  const subj = new Float32Array(N);   // subject coverage, for ash/stone grading
  const hgt = new Float32Array(N);    // head height field
  const hcv = new Float32Array(N);    // head coverage
  const hair = new Float32Array(N);   // hair coverage
  const px2dx = DW / BW, px2dy = DH / BH;

  const g = face.geom;
  const S = face.skin;
  const sd = face.noiseSeed;

  // --- derived layout ------------------------------------------------------
  const rx = g.rx, ry = g.ry;
  const hcx = g.headCX, hcy = g.headTop + ry;
  const chinY = g.headTop + 2 * ry;
  const fx = hcx + g.turn * rx;                   // face midline (turned head)
  const browY = g.browY;
  const eyeY = browY + ry * 0.155;
  const noseY = eyeY + ry * g.noseLen;
  const mouthY = noseY + ry * 0.255;
  const eyeSep = g.eyeSep;
  const hairlineY = g.headTop + ry * 0.36;

  // Head tilt for the slack expressions.
  const ang = (ex.tilt * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pvx = hcx, pvy = chinY + 8;

  const skinLite = ex.pale ? mixC(S.lite, [214, 210, 208], 0.42) : S.lite;
  const skinMid = ex.pale ? mixC(S.mid, [176, 172, 172], 0.38) : S.mid;
  const skinDeep = ex.pale ? mixC(S.deep, [70, 68, 74], 0.30) : S.deep;

  // Key light from the upper left; a cool sky fill from above; a rim from the
  // back right so the shadow side never dissolves into the background.
  const LX = -0.505, LY = -0.575, LZ = 0.644;
  const RX = 0.82, RY = -0.34, RZ = -0.46;

  // =========================================================================
  // 1. background - a warm mottled pool behind the head, black in the corners
  // =========================================================================
  {
    const warm = mixC(rs('dirt', 0.30), rs('wood', 0.34), 0.45);
    const cold = mixC(rs('stone', 0.07), rs('grey', 0.05), 0.5);
    const bt = face.bgTint;
    for (let py = 0; py < BH; py++) {
      const Y = (py + 0.5) * px2dy;
      for (let pxi = 0; pxi < BW; pxi++) {
        const X = (pxi + 0.5) * px2dx;
        // Pool of light behind the head, offset up-left of the head centre.
        const d = Math.sqrt(ell(X - (hcx - 3.5), Y - (hcy - 5), 30, 33));
        let t = 1 - smoothstep(0.15, 1.25, d);
        // Corner fall-off on top of the pool.
        const cvi = 1 - smoothstep(0.55, 1.35, Math.sqrt(ell(X - DW / 2, Y - DH / 2, DW * 0.62, DH * 0.62)));
        t = t * 0.85 + cvi * 0.30;
        // Mottling: two scales of noise plus a diagonal brush drag.
        const m1 = fb(X * 0.085, Y * 0.085, 4, sd + 3) - 0.5;
        const m2 = fb(X * 0.26 + Y * 0.05, Y * 0.30, 2, sd + 9) - 0.5;
        const drag = nz(X * 0.10 + Y * 0.34, Y * 0.045, sd + 21) - 0.5;
        t = clamp(t + m1 * 0.34 + m2 * 0.12 + drag * 0.10, 0, 1.25);
        let c = mixC(cold, warm, t);
        c = [c[0] * bt[0], c[1] * bt[1], c[2] * bt[2]];
        const i = (py * BW + pxi) * 3;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
      }
    }
  }

  // =========================================================================
  // 2. height field for the head + hair mask
  // =========================================================================
  const hoodOpen = face.gear.hood
    ? { rx: rx * (1.03 + face.gear.hood.tight), ry: ry * (1.02 + face.gear.hood.tight), cy: hcy + 2.2 }
    : null;

  const hairP = hairParams(face, g, hairlineY, hcx, hcy, rx, ry);

  for (let py = 0; py < BH; py++) {
    const Yw = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const Xw = (pxi + 0.5) * px2dx;
      // Head space (undo the tilt).
      const ddx = Xw - pvx, ddy = Yw - pvy;
      const X = pvx + ddx * ca + ddy * sa;
      const Y = pvy - ddx * sa + ddy * ca;
      const i = py * BW + pxi;

      // --- silhouette -----------------------------------------------------
      const v = (Y - hcy) / ry;
      const wp = widthProfile(clamp(v, -1, 1), g);
      const u = (X - hcx) / (rx * wp);
      const m = Math.pow(Math.abs(u), 2.0) + Math.pow(Math.abs(v), 2.35);
      let c = cov(m, 0.14);
      // Ears, when nothing covers them.
      if (!face.gear.hood && !face.gear.coif && hairP.showEars) {
        const ey = eyeY + ry * 0.16;
        const er = ell(Math.abs(X - hcx) - rx * 0.96, Y - ey, rx * 0.20 * g.ears, ry * 0.24 * g.ears);
        c = Math.max(c, cov(er, 0.35) * 0.98);
      }
      hcv[i] = c;
      if (c <= 0.002) { hgt[i] = 0; hair[i] = hairCov(hairP, X, Y, sd); continue; }

      // --- height ---------------------------------------------------------
      let z = g.rz * Math.sqrt(Math.max(0, 1 - Math.min(1, m)));
      const dxf = X - fx;

      // brow ridge: a shelf above the eyes, heavier on men and the old
      z += blob(dxf, Y - (browY + 0.5), rx * 0.92, ry * 0.135) * 2.5 * g.browHeavy;
      z += blob(Math.abs(dxf) - eyeSep * 0.9, Y - (browY + 0.9), rx * 0.30, ry * 0.11) * 1.1 * g.browHeavy;
      // eye sockets
      z -= blob(dxf - eyeSep, Y - eyeY, rx * 0.30, ry * 0.115) * 1.5;
      z -= blob(dxf + eyeSep, Y - eyeY, rx * 0.30, ry * 0.115) * 1.5;
      // eyeballs sit back in the sockets
      z += blob(dxf - eyeSep, Y - eyeY, rx * 0.20, ry * 0.085) * 1.15;
      z += blob(dxf + eyeSep, Y - eyeY, rx * 0.20, ry * 0.085) * 1.15;
      // nose: bridge ramp into a bulb, plus wings
      const nt = clamp((Y - (browY + 0.8)) / (noseY - browY - 0.8), 0, 1.35);
      if (nt > 0) {
        const hook = 1 + g.noseHook * 0.25 * Math.sin(nt * Math.PI);
        const bw = g.noseW * (0.42 + nt * 0.62) * hook;
        const ramp = 0.9 + nt * nt * 2.3;
        z += Math.max(0, 1 - (dxf * dxf) / (bw * bw)) * ramp * (1 - smoothstep(1.0, 1.32, nt));
      }
      z += blob(dxf, Y - (noseY - 0.4), g.noseW * 0.86, ry * 0.055) * 2.3 * g.noseBulb;
      z += blob(dxf - g.noseW * 0.82, Y - (noseY + 0.1), g.noseW * 0.55, ry * 0.05) * 1.35;
      z += blob(dxf + g.noseW * 0.82, Y - (noseY + 0.1), g.noseW * 0.55, ry * 0.05) * 1.35;
      // cheekbones and the hollow under them
      z += blob(Math.abs(dxf) - rx * 0.56, Y - (eyeY + ry * 0.115), rx * 0.34, ry * 0.115) * 1.5 * g.cheekBone;
      z -= blob(Math.abs(dxf) - rx * 0.53, Y - (noseY + ry * 0.06), rx * 0.28, ry * 0.115)
        * (1.25 * g.hollow + 1.5 * ex.hollow);
      // muzzle, lips, chin
      z += blob(dxf, Y - (mouthY - 0.4), rx * 0.52, ry * 0.135) * 1.5;
      const lipY = mouthY + ex.mouthOpen * 0.7;
      z += blob(dxf, Y - (lipY - ry * 0.036), g.mouthW * 0.92, ry * 0.036) * 0.85 * g.lipFull;
      z += blob(dxf, Y - (lipY + ry * 0.045), g.mouthW * 0.80, ry * 0.045) * 1.05 * g.lipFull;
      z -= blob(dxf, Y - lipY, g.mouthW * 0.95, ry * 0.016) * 1.1;
      z += blob(dxf, Y - (chinY - ry * 0.155), rx * 0.30, ry * 0.115) * 1.4;
      z -= blob(dxf, Y - (chinY - ry * 0.255), rx * 0.24, ry * 0.045) * 0.7;
      // jowls on old faces
      if (g.jowl > 0) {
        z += blob(Math.abs(dxf) - rx * 0.50, Y - (mouthY + ry * 0.10), rx * 0.24, ry * 0.10) * 1.2 * g.jowl;
      }
      // temples pull in
      z -= blob(Math.abs(dxf) - rx * 0.80, Y - (browY - ry * 0.10), rx * 0.22, ry * 0.10) * 0.9;
      // fine skin relief so the light never lands on a perfectly smooth surface
      z += (fb(X * 1.35, Y * 1.35, 3, sd + 33) - 0.5) * (0.30 + face.marks.wrinkle * 0.35);

      hgt[i] = z;
      hair[i] = hairCov(hairP, X, Y, sd);
    }
  }

  // =========================================================================
  // 3. neck, lit head, features
  // =========================================================================
  const neckCX = hcx + g.turn * rx * 0.35;
  const neckW = rx * 0.47;
  const hairShadowCol = scl(skinDeep, 0.65);

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
      if (Y > mouthY && hcv[ii] < 0.99) {
        const flare = 1 + smoothstep(chinY, chinY + 14, Y) * 0.45;
        const nw = neckW * flare;
        const t = (X - neckCX) / nw;
        const nc = smoothstep(1.10, 0.86, Math.abs(t)) * smoothstep(mouthY, mouthY + 3, Y);
        if (nc > 0.003) {
          // Cylinder: highlight left of centre, deep shadow under the jaw.
          let sh = 0.20 + 0.62 * Math.max(0, 1 - (t + 0.45) * (t + 0.45) * 1.15);
          sh *= mix(0.30, 1, smoothstep(chinY - 1, chinY + 9, Y));
          sh += (fb(X * 0.9, Y * 0.9, 2, sd + 51) - 0.5) * 0.06;
          bl(buf, i3, skinShade(sh * ex.key, skinDeep, skinMid, skinLite, S.ruddy), nc);
          subj[ii] = Math.max(subj[ii], nc);
        }
      }

      const hc = hcv[ii];
      if (hc <= 0.003) continue;
      subj[ii] = Math.max(subj[ii], hc);

      // --- normal from the height field -----------------------------------
      const xm = pxi > 0 ? ii - 1 : ii, xp = pxi < BW - 1 ? ii + 1 : ii;
      const ym = py > 0 ? ii - BW : ii, yp = py < BH - 1 ? ii + BW : ii;
      let nx = -(hgt[xp] - hgt[xm]) / (2 * px2dx);
      let ny = -(hgt[yp] - hgt[ym]) / (2 * px2dy);
      nx = clamp(nx, -4, 4); ny = clamp(ny, -4, 4);
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= nl; ny *= nl;
      const nzc = nl;

      // A face turned to camera barely varies its normal, so the modelling has
      // to be exaggerated the way a painter does it: low ambient, and the key
      // term pushed through a curve that opens up the mid-tones.
      const diff = Math.max(0, nx * LX + ny * LY + nzc * LZ);
      const ambSky = 0.155 + 0.085 * Math.max(0, -ny);
      let sh = (ambSky * ex.amb + Math.pow(diff, 1.35) * 0.82) * ex.key;

      // --- occlusion -------------------------------------------------------
      const dxf = X - fx;
      let ao = 1;
      ao -= blob(dxf, Y - (browY + ry * 0.075), rx * 0.86, ry * 0.075) * 0.42;   // under the brow
      ao -= blob(dxf - eyeSep, Y - (eyeY - ry * 0.02), rx * 0.29, ry * 0.10) * 0.30;
      ao -= blob(dxf + eyeSep, Y - (eyeY - ry * 0.02), rx * 0.29, ry * 0.10) * 0.30;
      ao -= blob(Math.abs(dxf) - g.noseW * 1.0, Y - (noseY - ry * 0.10), g.noseW * 0.70, ry * 0.16) * 0.30;
      ao -= blob(dxf, Y - (noseY + ry * 0.055), g.noseW * 1.25, ry * 0.045) * 0.55;  // under the nose
      ao -= blob(dxf, Y - (mouthY + ry * 0.10), g.mouthW * 0.85, ry * 0.045) * 0.30; // under the lip
      ao -= blob(Math.abs(dxf) - rx * 0.52, Y - (noseY + ry * 0.07), rx * 0.30, ry * 0.13)
        * (0.30 * g.hollow + 0.45 * ex.hollow);
      ao -= smoothstep(chinY - ry * 0.06, chinY + 1.5, Y) * 0.45;                   // jaw underside
      // hairline shadow
      const hs = hairShadowAt(hairP, X, Y);
      ao -= hs * 0.55;
      // the far side of a turned head falls away
      ao -= smoothstep(rx * 0.55, rx * 1.02, -(X - hcx) * Math.sign(-g.turn)) * 0.16;
      ao = clamp(ao, 0.12, 1);
      sh *= ao;

      let col = skinShade(sh, skinDeep, skinMid, skinLite, S.ruddy);

      // rim light on the shadow side keeps the head off the background
      const rim = Math.pow(Math.max(0, nx * RX + ny * RY + nzc * RZ), 2.6) * (1 - nzc * 0.55);
      col = add3(col, ex.arcane ? rs('arcane', 0.72) : rs('sand', 0.80), rim * (ex.arcane ? 0.55 : 0.34));
      if (ex.rimGold) col = add3(col, rs('gold', 0.80), rim * 0.5);
      // specular on nose tip / cheekbone / forehead
      const hx = LX, hy = LY, hz = LZ + 1;
      const hn = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
      const spec = Math.pow(Math.max(0, nx * hx * hn + ny * hy * hn + nzc * hz * hn), 22) * 0.30;
      col = add3(col, [255, 244, 232], spec * (1 - 0.4 * ex.hollow));

      // skin mottle / freckles / blush
      const mot = (fb(X * 0.95, Y * 0.95, 3, sd + 77) - 0.5);
      col = scl(col, 1 + mot * 0.075);
      if (face.marks.freckles > 0) {
        const f = nz(X * 3.1, Y * 3.1, sd + 101);
        if (f > 0.80) {
          const near = 1 - smoothstep(rx * 0.3, rx * 0.95, Math.abs(dxf - 0)) * 0.4;
          col = mixC(col, scl(skinDeep, 1.25), (f - 0.80) * 2.4 * face.marks.freckles * near
            * smoothstep(noseY + 3, eyeY, Y));
        }
      }
      const cheekBlush = blob(Math.abs(dxf) - rx * 0.48, Y - (noseY - ry * 0.02), rx * 0.30, ry * 0.13);
      col = mixC(col, mixC(col, rs('blood', 0.46), 0.55), cheekBlush * (0.16 + ex.blush * 0.45));
      if (ex.blush) {
        col = mixC(col, mixC(col, rs('blood', 0.50), 0.6),
          blob(dxf, Y - (noseY - 0.6), g.noseW * 1.25, ry * 0.085) * 0.55);
      }
      if (ex.wound) {
        const wsx = face.marks.scar ? face.marks.scar.side : 1;
        const w = blob(Math.abs(dxf - wsx * rx * 0.55) - 0.6, Y - (noseY - ry * 0.06), rx * 0.26, ry * 0.14);
        col = mixC(col, rs('blood', 0.30), w * 0.62 * (0.6 + 0.4 * nz(X * 2, Y * 2, sd + 5)));
      }
      if (ex.blotch) {
        const b = fb(X * 0.55, Y * 0.55, 3, sd + 131);
        col = mixC(col, mixC(col, rs('swamp', 0.42), 0.8), smoothstep(0.58, 0.82, b) * 0.55);
      }

      // --- wrinkles --------------------------------------------------------
      const wr = face.marks.wrinkle;
      if (wr > 0.1) {
        let dk = 0, lt = 0;
        for (let k = 0; k < 3; k++) {
          const wy = browY - ry * (0.11 + k * 0.075);
          const bend = 0.55 - k * 0.12;
          const yy = wy + bend * (dxf * dxf) / (rx * rx) * ry * 0.5;
          const dd = Math.abs(Y - yy);
          const span = smoothstep(rx * 0.86, rx * 0.60, Math.abs(dxf));
          dk += Math.max(0, 1 - dd / 0.55) * span * (k === 0 ? 1 : 0.75);
          lt += Math.max(0, 1 - Math.abs(Y - (yy - 0.7)) / 0.5) * span * 0.5;
        }
        // nasolabial folds
        for (const s of [-1, 1]) {
          const ax = fx + s * g.noseW * 1.05, ay = noseY + ry * 0.03;
          const bx = fx + s * g.mouthW * 1.12, by = mouthY + ry * 0.08;
          const d = segDist(X, Y, ax, ay, bx + s * 0.7, by);
          dk += Math.max(0, 1 - d / 0.75) * (0.55 + 0.45 * wr);
          lt += Math.max(0, 1 - segDist(X, Y, ax - s * 0.8, ay, bx - s * 0.1, by) / 0.55) * 0.35;
        }
        // crow's feet
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const ax = fx + s * (eyeSep + g.eyeW * 1.05), ay = eyeY - 0.9 + k * 0.95;
            const d = segDist(X, Y, ax, ay, ax + s * 1.9, ay - 0.75 + k * 0.55);
            dk += Math.max(0, 1 - d / 0.45) * 0.6;
          }
        }
        col = mixC(col, scl(col, 0.60), clamp(dk, 0, 1) * wr * 0.75);
        col = mixC(col, scl(col, 1.22), clamp(lt, 0, 1) * wr * 0.5);
      }

      // scar
      if (face.marks.scar) {
        const sc = face.marks.scar;
        const ax = fx + sc.side * rx * 0.55, ay = eyeY - ry * 0.28 + sc.y * ry * 0.1;
        const d = segDist(X, Y, ax, ay, ax + sc.side * 1.2, ay + ry * 0.30 * sc.len);
        const k = Math.max(0, 1 - d / 0.6);
        col = mixC(col, mixC(scl(skinLite, 0.95), rs('blood', 0.42), 0.30), k * 0.75);
      }

      bl(buf, i3, col, hc);

      // --- features (drawn straight over the lit skin) ----------------------
      drawFeatures(buf, i3, X, Y, hc, {
        face, ex, g, S, fx, browY, eyeY, noseY, mouthY, eyeSep, chinY, rx, ry,
        skinDeep, skinMid, skinLite, sd, hcx,
      });
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
        a *= face.gear.hairVisible === 1 ? 1
          : mix(0.15, 1, smoothstep(hairP.hairlineY + 5, hairP.hairlineY - 2, Y)) * face.gear.hairVisible + 0.0;
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
        // Shade the beard mass like a volume: lit upper left, dark under the jaw.
        const lit = 0.32 + 0.55 * clamp(1 - ell(X - (fx - rx * 0.45), Y - (mouthY - 1), rx * 1.5, ry * 1.1), 0, 1);
        const strand = fb(X * 1.5 + Y * 0.3, Y * 3.2, 3, sd + 61);
        let c = mixC(HC.dark, HC.base, clamp(lit * 1.25, 0, 1));
        c = mixC(c, HC.lite, clamp((strand - 0.55) * 1.6, 0, 1) * 0.45 * lit);
        c = scl(c, 0.9 + strand * 0.22);
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
    hcx, hcy, fx, rx, ry, browY, eyeY, noseY, mouthY, chinY, sd, LX, LY, hoodOpen,
  });

  // =========================================================================
  // 7. shoulders and collar
  // =========================================================================
  drawShoulders(buf, subj, face, ex, {
    BW, BH, px2dx, px2dy, hcx, fx, rx, ry, chinY, neckCX, neckW, sd,
  });

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

/** Three-point skin ramp with the terminator pushed toward blood. */
function skinShade(s, deep, mid, lite, ruddy) {
  s = clamp(s, 0, 1.35);
  let c;
  if (s < 0.5) c = mixC(deep, mid, s * 2);
  else c = mixC(mid, lite, Math.min(1, (s - 0.5) * 2));
  // Warm the mid-tones where light grazes the surface - the "blood under skin"
  // band that separates painted flesh from plastic.
  const term = Math.exp(-Math.pow((s - 0.46) / 0.19, 2));
  c = mixC(c, mixC(c, [c[0] * 1.10, c[1] * 0.84, c[2] * 0.78], 1), term * (0.30 + ruddy * 0.5));
  return c;
}

// --- features --------------------------------------------------------------

function drawFeatures(buf, i3, X, Y, hc, P) {
  const { face, ex, g, fx, browY, eyeY, noseY, mouthY, eyeSep, chinY, rx, ry,
    skinDeep, skinMid, skinLite, sd } = P;
  const dxf = X - fx;
  const hair = face.hair;
  const lashCol = mixC(hair.dark, [16, 12, 12], 0.45);

  // --- nostrils ------------------------------------------------------------
  {
    const nw = g.noseW;
    for (const s of [-1, 1]) {
      const e = ell(dxf - s * nw * 0.72, Y - (noseY + ry * 0.012), nw * 0.34, ry * 0.030);
      const a = cov(e, 0.55) * 0.88;
      if (a > 0) bl(buf, i3, mixC(skinDeep, [18, 10, 10], 0.5), a * hc);
    }
  }

  // --- eyes ----------------------------------------------------------------
  for (const s of [-1, 1]) {
    // The far side of a turned head shows a slightly narrower eye.
    const far = (s === Math.sign(g.turn)) ? 0.90 : 1.0;
    const ew = g.eyeW * far * (ex.mouthW === 1 ? 1 : 1);
    const ecx = fx + s * eyeSep;
    const open = (s < 0 ? ex.eyeOpenL : ex.eyeOpenR) * g.eyeOpenBase
      * (face.age === 'old' ? 0.90 : 1);
    const eh = g.eyeW * 0.62 * open;

    const ux = (X - ecx) / ew;
    if (ux < -1.7 || ux > 1.7) continue;

    if (open < 0.12) {
      // Closed: a lid mass with a dark crease where the lashes meet.
      const lidY = eyeY - ry * 0.012;
      const inLid = smoothstep(1.15, 0.85, Math.abs(ux)) * smoothstep(2.0, 1.1, Math.abs((Y - (lidY - 0.8)) / (g.eyeW * 0.75)));
      if (inLid > 0) {
        const lidShade = 0.42 + 0.25 * smoothstep(lidY, lidY - 1.6, Y);
        bl(buf, i3, skinShade(lidShade * ex.key, skinDeep, skinMid, skinLite, 0.3), inLid * 0.85 * hc);
      }
      const curve = lidY + (1 - ux * ux) * 0.55;
      const d = Math.abs(Y - curve);
      const a = Math.max(0, 1 - d / 0.62) * smoothstep(1.12, 0.86, Math.abs(ux));
      if (a > 0) bl(buf, i3, lashCol, a * 0.92 * hc);
      // a lit line just under the closed lid
      const a2 = Math.max(0, 1 - Math.abs(Y - (curve + 0.9)) / 0.5) * smoothstep(1.05, 0.8, Math.abs(ux));
      if (a2 > 0) bl(buf, i3, scl(skinLite, 1.0), a2 * 0.30 * hc);
      continue;
    }

    // Almond opening: different radii above and below the eye line.
    const vy = Y - eyeY;
    const openTop = 1.0, openBot = 0.92 - ex.lidLow * 0.35;
    const vs = vy < 0 ? vy / (eh * openTop) : vy / (eh * openBot);
    const em = Math.pow(Math.abs(ux), 2.3) + vs * vs;
    const ea = cov(em, 0.34);
    if (ea > 0.004) {
      // sclera - never white, always a shaded warm grey
      const shade = 0.62 + 0.28 * smoothstep(-1, 0.6, vs) + (ex.wide ? 0.12 : 0);
      let c = mixC(rs('sand', 0.62), rs('stone', 0.72), 0.45);
      c = scl(c, shade * (0.85 + 0.3 * ex.key));
      // vessels / warm inner corner
      c = mixC(c, rs('blood', 0.40), Math.max(0, (Math.abs(ux) - 0.55)) * 0.35);
      bl(buf, i3, c, ea * hc);

      // iris
      const gx = ecx + ex.gazeX * ew * 0.5 + g.turn * ew * 0.55;
      const gy = eyeY + ex.gazeY * eh * 0.4 + eh * 0.10;
      const ir = g.eyeW * 0.53;
      const idm = Math.sqrt(ell(X - gx, Y - gy, ir, ir));
      if (idm < 1.5) {
        const iCol = EYE_COLOURS[face.eyeName]();
        const ang = Math.atan2(Y - gy, X - gx);
        const fibre = nz(Math.cos(ang) * 4 + 9, Math.sin(ang) * 4 + 9, sd + 17);
        let c2 = mixC(scl(iCol, 0.62), scl(iCol, 1.35), clamp(0.35 + fibre * 0.7, 0, 1));
        // light enters from the upper left, so the lower iris glows
        c2 = mixC(c2, scl(iCol, 1.7), clamp(((Y - gy) / ir) * 0.6 + 0.15, 0, 1) * 0.55);
        c2 = mixC(c2, scl(iCol, 0.25), smoothstep(0.72, 1.0, idm));     // limbal ring
        // upper lid shadow across the iris
        c2 = scl(c2, mix(0.55, 1.12, smoothstep(-1.0, 0.3, vs)));
        const ia = cov(idm * idm, 0.30) * ea;
        bl(buf, i3, c2, ia * hc);
        const pr = ir * 0.44 * ex.pupil * (ex.glow ? 0.8 : 1);
        const pa = cov(ell(X - gx, Y - gy, pr, pr), 0.45) * ea;
        bl(buf, i3, ex.glow ? rs('arcane', 0.85) : [12, 9, 10], pa * hc);
        if (ex.glow) {
          const ga = cov(ell(X - gx, Y - gy, ir * 1.5, ir * 1.5), 0.6) * 0.5;
          bl(buf, i3, rs('arcane', 0.9), ga * hc);
        }
        // catchlight, upper left
        const sa2 = cov(ell(X - (gx - ir * 0.38), Y - (gy - ir * 0.38), ir * 0.30, ir * 0.30), 0.6) * ea;
        bl(buf, i3, [252, 248, 240], sa2 * 0.9 * hc);
      }

      // upper lash line
      const lashT = -eh * openTop * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(ux), 2.3)));
      const dl = Math.abs(vy - lashT);
      const la = Math.max(0, 1 - dl / (0.55 + 0.25 * (face.sex === 'f' ? 1 : 0)))
        * smoothstep(1.25, 0.95, Math.abs(ux));
      bl(buf, i3, lashCol, la * 0.95 * hc);
      // lower lid, softer
      const lashB = eh * openBot * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(ux), 2.3)));
      const lb = Math.max(0, 1 - Math.abs(vy - lashB) / 0.5) * smoothstep(1.15, 0.85, Math.abs(ux));
      bl(buf, i3, mixC(lashCol, skinDeep, 0.45), lb * 0.5 * hc);
    }
    // lid crease above the eye
    const cr = Math.max(0, 1 - Math.abs(Y - (eyeY - g.eyeW * 0.92 * open - 0.35)) / 0.6)
      * smoothstep(1.25, 0.9, Math.abs(ux));
    if (cr > 0) bl(buf, i3, scl(skinDeep, 1.15), cr * 0.30 * hc);
    // a lit line under the lower lid
    const ll = Math.max(0, 1 - Math.abs(Y - (eyeY + g.eyeW * 0.80 * open + 0.55)) / 0.55)
      * smoothstep(1.1, 0.8, Math.abs(ux));
    if (ll > 0) bl(buf, i3, scl(skinLite, 1.02), ll * 0.22 * hc);
  }

  // --- eyebrows ------------------------------------------------------------
  {
    const thick = g.browThick * ex.browThick;
    for (const s of [-1, 1]) {
      const inX = fx + s * eyeSep * 0.42;
      const outX = fx + s * (eyeSep + g.eyeW * 1.30);
      const lo = Math.min(inX, outX), hi = Math.max(inX, outX);
      if (X < lo - 1.2 || X > hi + 1.2) continue;
      let t = (X - inX) / (outX - inX);
      t = clamp(t, 0, 1);
      const asym = (face.beard === 'none' ? 0 : 0) + (ex.mouthSkew ? s * 0.35 * ex.mouthSkew : 0);
      const inner = browY - ry * 0.055 + ex.browIn + asym;
      const outer = browY - ry * 0.055 + ex.browOut - ex.browTilt * 0.55;
      const arch = g.browArch * (1 + ex.browTilt * 0.2);
      const yb = mix(inner, outer, t * t * (3 - 2 * t)) - Math.sin(t * Math.PI) * arch * 0.9;
      const th = (0.85 + 0.55 * g.browHeavy) * thick * (1 - t * 0.55) + 0.25;
      const edge = fb(X * 2.2, Y * 2.2, 2, sd + 41) * 0.55;
      const d = Math.abs(Y - yb);
      let a = smoothstep(th * 0.55 + 0.4, th * 0.55 - 0.35, d + edge * 0.5 - 0.15);
      a *= smoothstep(1.15, 0.92, Math.abs(t - 0.5) * 2) * 0.95 + 0.05;
      a *= smoothstep(-0.14, 0.05, t) * smoothstep(1.14, 0.95, t);
      if (a <= 0.004) continue;
      const strand = fb(X * 2.6 + Y, Y * 2.0, 2, sd + 43);
      let c = mixC(hair.dark, hair.base, 0.35 + strand * 0.5);
      if (face.age === 'old') c = mixC(c, rs('grey', 0.55), 0.35);
      // catch a little of the key light on the top edge
      c = mixC(c, hair.lite, clamp((yb - Y) * 0.7, 0, 1) * 0.35);
      bl(buf, i3, c, a * hc);
    }
  }

  // --- mouth ---------------------------------------------------------------
  {
    const mw = g.mouthW * ex.mouthW;
    const ux = (X - fx) / mw;
    if (ux > -1.55 && ux < 1.55) {
      const skew = ex.mouthSkew * 0.55;
      // corners lift for a smile, drop for a grimace
      const yc = mouthY - ex.mouthCurve * (ux * ux) * 0.55 + skew * ux * 0.9
        + ex.mouthCurve * 0.12;
      const open = ex.mouthOpen;
      const lipTop = yc - ry * (0.030 + 0.028 * g.lipFull);
      const lipBot = yc + ry * (0.038 + 0.036 * g.lipFull) + open * ry * 0.20;

      if (open > 0.03) {
        // dark interior
        const oh = open * ry * 0.135;
        const om = Math.pow(Math.abs(ux / (0.88 - open * 0.12)), 2.1) + Math.pow(Math.abs((Y - (yc + oh * 0.25)) / oh), 1.9);
        const oa = cov(om, 0.4);
        if (oa > 0) {
          let c = mixC(rs('blood', 0.10), [8, 4, 6], 0.45);
          // tongue lower down
          c = mixC(c, rs('blood', 0.30), clamp(((Y - yc) / oh) * 0.8, 0, 1) * 0.55);
          bl(buf, i3, c, oa * hc);
          if (ex.teeth > 0) {
            const ty = yc - oh * 0.62;
            const ta = Math.max(0, 1 - Math.abs(Y - ty) / (oh * 0.42)) * smoothstep(0.92, 0.62, Math.abs(ux));
            const gap = 0.55 + 0.45 * Math.abs(Math.sin(ux * 7.5));
            bl(buf, i3, scl(mixC(rs('sand', 0.86), rs('grey', 0.8), 0.4), 0.86 + gap * 0.2),
              ta * oa * ex.teeth * hc);
          }
        }
      }

      // lips: upper darker, lower catching light
      const upT = smoothstep(lipTop - 0.8, lipTop + 0.2, Y) * smoothstep(yc + 0.15, yc - 0.35, Y);
      const cupid = 1 - Math.exp(-Math.pow(ux / 0.25, 2)) * 0.35;
      const upA = upT * smoothstep(1.05, 0.82, Math.abs(ux)) * cupid * (1 - open * 0.7);
      if (upA > 0) {
        bl(buf, i3, mixC(scl(skinDeep, 1.25), rs('blood', 0.34), 0.42 * g.lipFull), upA * 0.85 * hc);
      }
      const dnA = smoothstep(yc - 0.1, yc + 0.5, Y) * smoothstep(lipBot + 0.4, lipBot - 0.5, Y)
        * smoothstep(1.0, 0.72, Math.abs(ux)) * (1 - open * 0.8);
      if (dnA > 0) {
        let c = mixC(mixC(skinMid, rs('blood', 0.42), 0.36 * g.lipFull), skinLite, 0.18);
        c = mixC(c, scl(skinLite, 1.1), Math.max(0, 1 - Math.abs((Y - (yc + ry * 0.030)) / 0.7)) * 0.35);
        bl(buf, i3, c, dnA * 0.8 * hc);
      }
      // the mouth line itself
      if (open < 0.35) {
        const d = Math.abs(Y - yc);
        const a = Math.max(0, 1 - d / 0.62) * smoothstep(1.06, 0.84, Math.abs(ux)) * (1 - open * 2.4);
        bl(buf, i3, mixC(scl(skinDeep, 0.8), rs('blood', 0.16), 0.4), a * 0.9 * hc);
      }
      // shadow under the lower lip
      const sh = Math.max(0, 1 - Math.abs(Y - (lipBot + 0.75)) / 0.9) * smoothstep(0.95, 0.6, Math.abs(ux));
      bl(buf, i3, scl(skinDeep, 1.1), sh * 0.30 * hc);
    }
  }

  // chin crease / dimple shadow
  {
    const a = blob(dxf, Y - (chinY - ry * 0.235), rx * 0.22, ry * 0.038);
    bl(buf, i3, scl(skinDeep, 1.2), a * 0.22 * hc);
  }
}

// --- hair ------------------------------------------------------------------

function hairParams(face, g, hairlineY, hcx, hcy, rx, ry) {
  const st = face.hairStyle;
  const r = new Rand((face.noiseSeed ^ 0x77) >>> 0);
  const p = {
    style: st, hcx, hcy, rx, ry, g,
    hairlineY,
    capRX: rx * 1.10, capRY: ry * 1.13,
    capCY: hcy - ry * 0.14,
    templeA: 1.6,      // >0 hairline drops at the temples
    peak: 0.0,
    sideEndY: hcy + ry * 0.45,
    backEndY: hcy + ry * 0.5,
    backW: 0,
    volume: 1,
    rough: 0.35,
    showEars: st === 'short' || st === 'bald' || st === 'receding' || st === 'ponytail',
    tail: null,
    braid: null,
    bald: false,
  };
  switch (st) {
    case 'short':
      p.capRX = rx * 1.08; p.capRY = ry * 1.10; p.sideEndY = hcy + ry * 0.30;
      p.backW = rx * 0.06; p.backEndY = hcy + ry * 0.42; p.rough = 0.30;
      break;
    case 'long':
      p.capRX = rx * 1.16; p.capRY = ry * 1.16; p.sideEndY = DH + 4;
      p.backW = rx * 0.42; p.backEndY = DH + 4; p.rough = 0.45; p.volume = 1.25;
      break;
    case 'ponytail':
      p.capRX = rx * 1.05; p.capRY = ry * 1.08; p.sideEndY = hcy + ry * 0.15;
      p.backW = rx * 0.10; p.backEndY = hcy + ry * 0.3;
      p.tail = { side: r.bool() ? 1 : -1, len: r.float(0.8, 1.2) };
      break;
    case 'bald':
      p.bald = true; p.capRY = 0; p.sideEndY = hcy + ry * 0.28; p.backW = 0;
      break;
    case 'receding':
      p.templeA = -2.6; p.hairlineY = hairlineY - ry * 0.10; p.peak = 1.1;
      p.capRX = rx * 1.06; p.capRY = ry * 1.08; p.sideEndY = hcy + ry * 0.32;
      break;
    case 'braided':
      p.capRX = rx * 1.12; p.capRY = ry * 1.12; p.sideEndY = DH + 4;
      p.backW = rx * 0.30; p.backEndY = DH + 4;
      p.braid = { side: r.bool() ? 1 : -1 };
      break;
    case 'wild':
      p.capRX = rx * 1.26; p.capRY = ry * 1.30; p.sideEndY = hcy + ry * 0.75;
      p.backW = rx * 0.36; p.backEndY = hcy + ry * 0.85; p.rough = 1.05; p.volume = 1.4;
      break;
  }
  if (face.age === 'old' && (st === 'short' || st === 'long')) p.templeA -= 0.9;
  return p;
}

/** Hairline y at a given x (larger y = hair reaches further down the forehead). */
function hairlineAt(p, X) {
  const u = (X - p.hcx) / p.rx;
  return p.hairlineY + p.templeA * u * u + p.peak * Math.exp(-(u * u) / 0.05);
}

function hairCov(p, X, Y, sd) {
  // Everything except the fringe is cut against a slightly shrunk copy of the
  // head, so hanging hair sits beside and behind the face instead of over it.
  const vv = clamp((Y - p.hcy) / p.ry, -1, 1);
  const wp = widthProfile(vv, p.g);
  const hm = Math.pow(Math.abs((X - p.hcx) / (p.rx * wp * 0.90)), 2)
    + Math.pow(Math.abs((Y - p.hcy) / (p.ry * 0.95)), 2.35);
  const outside = 1 - cov(hm, 0.18);

  if (p.bald) {
    const ring = ell(X - p.hcx, Y - p.hcy, p.rx * 1.08, p.ry * 1.06);
    const band = cov(ring, 0.12) * outside;
    return band * smoothstep(p.hcy - p.ry * 0.10, p.hcy + p.ry * 0.10, Y)
      * (1 - smoothstep(p.sideEndY, p.sideEndY + 2.5, Y));
  }
  const rough = (fb(X * 0.55, Y * 0.55, 3, sd + 200) - 0.5) * p.rough
    + (fb(X * 1.6, Y * 1.6, 2, sd + 201) - 0.5) * p.rough * 0.6;

  // cap: mass over the skull, bounded below by the hairline (this one is
  // allowed over the face - it is the fringe)
  const e = ell(X - p.hcx, Y - p.capCY, p.capRX, p.capRY);
  const capE = cov(e + rough * 0.20, 0.16);
  const hl = hairlineAt(p, X);
  const below = smoothstep(hl + 0.9, hl - 0.9, Y);   // 1 above the hairline
  let a = capE * below;

  // the same mass continuing down beside the face
  a = Math.max(a, capE * outside * (1 - smoothstep(p.sideEndY - 3, p.sideEndY + 1.5, Y)));

  // back mass hanging outside the head silhouette
  if (p.backW > 0) {
    const w = p.rx * 1.00 + p.backW * (0.4 + 0.9 * smoothstep(p.hcy - p.ry * 0.3, p.backEndY, Y));
    const inX = smoothstep(w + 1.0, w - 0.6, Math.abs(X - p.hcx) - rough * 1.4);
    const inY = smoothstep(p.hcy - p.ry * 0.90, p.hcy - p.ry * 0.60, Y)
      * (1 - smoothstep(p.backEndY - 5, p.backEndY, Y));
    a = Math.max(a, inX * inY * outside);
  }
  if (p.tail) {
    const s = p.tail.side;
    const tx = p.hcx + s * (p.rx * 0.92);
    const ty = p.hcy - p.ry * 0.20;
    const d = segDist(X, Y, tx, ty, tx + s * 3.2, ty + p.ry * 1.15 * p.tail.len);
    a = Math.max(a, smoothstep(2.8, 1.5, d + rough * 1.5) * outside);
  }
  if (p.braid) {
    const s = p.braid.side;
    const bx = p.hcx + s * (p.rx * 0.90);
    const by = p.hcy + p.ry * 0.20;
    const t = clamp((Y - by) / (DH - by), 0, 1);
    const cxp = bx + s * 1.8 * Math.sin(t * 3.0);
    const w = 2.6 * (1 - t * 0.30) * (0.85 + 0.25 * Math.sin(t * 11));
    a = Math.max(a, smoothstep(w + 0.8, w - 0.4, Math.abs(X - cxp))
      * smoothstep(by - 1, by + 1.5, Y) * outside);
  }
  return clamp(a, 0, 1);
}

/** How much shadow the hairline casts on the forehead at this point. */
function hairShadowAt(p, X, Y) {
  if (p.bald) return 0;
  const hl = hairlineAt(p, X);
  return smoothstep(hl + 2.6, hl + 0.1, Y) * smoothstep(hl - 2.5, hl - 0.2, Y);
}

function hairColourAt(HC, p, X, Y, sd, LX, LY, ex) {
  // Pseudo-normal from the hair volume so the mass reads as a rounded shape.
  const ux = (X - p.hcx) / (p.capRX * 1.05);
  const uy = (Y - p.capCY) / (p.capRY * 1.15);
  const r2 = clamp(ux * ux + uy * uy, 0, 1);
  const zc = Math.sqrt(1 - r2);
  const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
  const diff = Math.max(0, (ux * LX + uy * LY + zc * 0.72) * nl);

  // Strand noise: stretched along the direction the hair falls.
  const s1 = fb(X * 2.6 + Y * 0.55, Y * 0.85, 3, sd + 210);
  const s2 = fb(X * 6.0, Y * 1.1, 2, sd + 211);
  const strand = s1 * 0.7 + s2 * 0.3;

  let shade = 0.20 + diff * 0.95;
  shade *= 0.80 + strand * 0.45;
  shade *= ex.key;
  // A soft sheen band where the skull turns away from the key light.
  const sheen = Math.exp(-Math.pow((ux + 0.42) / 0.34, 2)) * Math.exp(-Math.pow((uy + 0.50) / 0.42, 2));
  let c = mixC(HC.dark, HC.base, clamp(shade * 1.5, 0, 1));
  c = mixC(c, HC.lite, clamp((shade - 0.55) * 1.5, 0, 1) * 0.75);
  c = mixC(c, HC.lite, sheen * HC.sheen * (0.35 + strand * 0.5));
  // darken the outer edge so the silhouette doesn't glow
  c = scl(c, mix(0.72, 1.05, clamp(1 - r2 * 0.85, 0, 1)));
  return c;
}

// --- facial hair -----------------------------------------------------------

function beardParams(face, g, fx, mouthY, noseY, chinY, rx, ry) {
  return {
    kind: face.beard, fx, mouthY, noseY, chinY, rx, ry,
    hcx: g.headCX, jawY: chinY - ry * 0.28,
    tone: face.marks.stubbleTone,
    mouthW: g.mouthW,
    noseW: g.noseW,
  };
}

function beardCov(p, X, Y, sd, headCov) {
  const dx = X - p.fx;
  const k = p.kind;
  const n = fb(X * 1.9, Y * 1.9, 3, sd + 301);
  let a = 0;

  const moustache = () => {
    const w = p.noseW * 1.9;
    const yb = p.mouthY - p.ry * 0.055;
    return smoothstep(w + 1.0, w - 0.8, Math.abs(dx))
      * smoothstep(p.noseY + 0.25, p.noseY + 0.9, Y)
      * (1 - smoothstep(yb - 0.4, yb + 0.9, Y));
  };
  const jaw = (top, spread) => {
    // Everything below `top` and inside the jaw, feathered at the upper edge.
    const inX = smoothstep(p.rx * (0.98 * spread), p.rx * (0.72 * spread), Math.abs(dx));
    return clamp(smoothstep(top - 1.6, top + 1.4, Y) * (0.35 + 0.65 * inX) + inX * 0.15, 0, 1);
  };

  switch (k) {
    case 'stubble':
      a = jaw(p.mouthY - p.ry * 0.02, 1.05) * 0.55;
      a = Math.max(a, moustache() * 0.5);
      a *= smoothstep(0.42, 0.72, n) * 0.8 + 0.25;
      a *= 0.62 * p.tone;
      break;
    case 'moustache':
      a = moustache();
      break;
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
      // the hanging mass below the chin
      const w = p.rx * 0.62 * (1 - smoothstep(p.chinY, DH, Y) * 0.30);
      const hang = smoothstep(w + 1.4, w - 0.6, Math.abs(dx + (fbSign(X, Y, sd) * 0.6)))
        * smoothstep(p.chinY - 4, p.chinY - 1, Y);
      a = Math.max(a, hang);
      break;
    }
    default: return 0;
  }
  // The mouth opening always cuts through facial hair.
  a *= 1 - 0.85 * smoothstep(1.15, 0.6,
    Math.sqrt(ell(dx, Y - p.mouthY, p.mouthW * 0.85, p.ry * 0.035)));
  // Above the chin the beard is bounded by the head; below it, it hangs free.
  const bound = Y < p.chinY - 1 ? headCov : 1;
  const edge = 0.82 + 0.35 * n;
  return clamp(a * edge, 0, 1) * bound;
}

function fbSign(X, Y, sd) { return (fb(X * 0.4, Y * 0.4, 2, sd + 303) - 0.5) * 2; }

// --- headgear --------------------------------------------------------------

function drawGear(buf, subj, face, ex, P) {
  const { BW, BH, px2dx, px2dy, pvx, pvy, ca, sa, hcx, hcy, fx, rx, ry,
    browY, noseY, chinY, sd, LX, LY } = P;
  const gear = face.gear;
  if (!gear.hood && !gear.helm && !gear.coif && !gear.hat) return;

  const steel = gear.steel;
  const hood = gear.hood;
  const hoodBase = hood ? rs(hood.ramp, hood.t) : null;
  const hoodDark = hood ? scl(hoodBase, 0.38) : null;
  const hoodLite = hood ? mixC(scl(hoodBase, 1.45), rs('sand', 0.8), 0.18) : null;

  for (let py = 0; py < BH; py++) {
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
        const orx = rx * 1.42, ory = ry * (1.24 + hood.peak * 0.12);
        const ocy = hcy - ry * (0.06 + hood.peak * 0.10);
        const rough = (fb(X * 0.4, Y * 0.4, 3, sd + 401) - 0.5) * 0.10;
        let a = cov(ell(X - hcx, Y - ocy, orx, ory) + rough, 0.10);
        // drape down over the shoulders
        const dw = orx + (Y - hcy) * 0.62;
        const drape = smoothstep(dw + 1.2, dw - 0.8, Math.abs(X - hcx))
          * smoothstep(hcy - 1, hcy + 5, Y);
        a = Math.max(a, drape);
        // peak at the crown
        if (hood.peak > 0.2) {
          const t = clamp((ocy - ory - Y) / (ry * 0.55), 0, 1);
          const px2 = hcx - rx * 0.5 * t;
          a = Math.max(a, smoothstep(rx * 0.42 * (1 - t) + 0.8, rx * 0.42 * (1 - t) - 0.5, Math.abs(X - px2))
            * (1 - smoothstep(0.85, 1.0, t)) * smoothstep(0, 0.05, t));
        }
        // face opening
        const orx2 = rx * (1.02 + hood.tight), ory2 = ry * (1.01 + hood.tight);
        const holeM = ell(X - fx, Y - (hcy + ry * 0.10), orx2, ory2);
        const hole = cov(holeM, 0.10);
        a *= 1 - hole;
        if (a > 0.004) {
          // Cloth: rounded volume plus radial folds, dark right at the opening.
          const ux = (X - hcx) / orx, uy = (Y - ocy) / ory;
          const r2 = clamp(ux * ux + uy * uy, 0, 1);
          const zc = Math.sqrt(1 - r2 * 0.9);
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.22 + Math.max(0, (ux * LX + uy * LY + zc * 0.75) * nl) * 0.95;
          const ang = Math.atan2(Y - ocy, X - hcx);
          const fold = fb(Math.cos(ang) * 3.2 + Math.sqrt(r2) * 4.5, Math.sin(ang) * 3.2, 3, sd + 403);
          sh *= 0.78 + fold * 0.50;
          // inside the opening the cloth turns away from the light
          sh *= mix(0.42, 1, smoothstep(1.0, 1.30, holeM));
          sh += smoothstep(0.9, 1.6, Math.sqrt(r2)) * -0.10;
          sh *= ex.key;
          let c = mixC(hoodDark, hoodBase, clamp(sh * 1.45, 0, 1));
          c = mixC(c, hoodLite, clamp((sh - 0.62) * 1.6, 0, 1) * 0.8);
          // a lit lip right on the rim of the opening
          const rim = smoothstep(1.16, 1.02, holeM) * smoothstep(0.98, 1.04, holeM);
          c = mixC(c, hoodLite, rim * 0.55 * smoothstep(hcy + ry * 0.6, hcy - ry * 0.3, Y));
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- mail coif ------------------------------------------------------
      if (gear.coif) {
        const outer = ell(X - hcx, Y - (hcy - ry * 0.04), rx * 1.20, ry * 1.16);
        const inner = ell(X - fx, Y - (hcy + ry * 0.08), rx * 0.97, ry * 0.96);
        let a = cov(outer, 0.12) * (1 - cov(inner, 0.10));
        a = Math.max(a, cov(outer, 0.12) * smoothstep(chinY - 2, chinY + 2, Y));
        if (a > 0.004) {
          // Rings on a staggered lattice - fine enough to read as mail at 1:1.
          const gx = X * 1.75, gy = Y * 1.75;
          const row = Math.floor(gy);
          const cx2 = Math.floor(gx + (row & 1 ? 0.5 : 0));
          const rr = Math.sqrt(Math.pow(gx + (row & 1 ? 0.5 : 0) - cx2 - 0.5, 2) + Math.pow(gy - row - 0.5, 2));
          const ring = smoothstep(0.48, 0.20, rr);
          const ux = (X - hcx) / (rx * 1.2), uy = (Y - hcy) / (ry * 1.15);
          const zc = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.16 + Math.max(0, (ux * LX + uy * LY + zc * 0.8) * nl) * 0.9;
          sh *= 0.62 + ring * 0.75;
          sh += hash2(cx2, row, sd) * 0.12 - 0.05;
          sh *= ex.key;
          let c = mixC(steel.dark, steel.base, clamp(sh * 1.5, 0, 1));
          c = mixC(c, steel.lite, clamp((sh - 0.62) * 1.7, 0, 1) * 0.8 * ring);
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- helm -----------------------------------------------------------
      if (gear.helm) {
        const dcy = hcy - ry * 0.42;
        const drx = rx * 1.10, dry = ry * 0.78;
        const domeM = ell(X - hcx, Y - dcy, drx, dry);
        let a = cov(domeM, 0.10) * smoothstep(browY + 0.6, browY - 0.4, Y);
        // brow band
        const band = smoothstep(browY - 2.6, browY - 2.0, Y) * smoothstep(browY + 0.7, browY - 0.2, Y)
          * cov(ell(X - hcx, Y - dcy, drx * 1.03, dry * 1.30), 0.12);
        a = Math.max(a, band);
        // cheek guards
        if (gear.helm.cheek) {
          const cg = smoothstep(rx * 1.06, rx * 0.86, Math.abs(X - hcx))
            * smoothstep(rx * 0.70, rx * 0.86, Math.abs(X - hcx))
            * smoothstep(browY - 1, browY + 2, Y) * (1 - smoothstep(noseY + 3, noseY + 6, Y));
          a = Math.max(a, cg);
        }
        // nasal bar
        let nasal = 0;
        if (gear.helm.nasal) {
          nasal = smoothstep(1.35, 0.75, Math.abs(X - fx))
            * smoothstep(browY - 3, browY - 1.5, Y) * (1 - smoothstep(noseY - 1.5, noseY + 0.8, Y));
          a = Math.max(a, nasal);
        }
        if (a > 0.004) {
          const ux = (X - hcx) / drx, uy = (Y - dcy) / dry;
          const zc = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
          const nl = 1 / Math.sqrt(ux * ux + uy * uy + zc * zc + 1e-6);
          let sh = 0.14 + Math.max(0, (ux * LX + uy * LY + zc * 0.78) * nl) * 1.0;
          // hard reflective band - steel has a much tighter falloff than skin
          sh += Math.exp(-Math.pow((ux + 0.40) / 0.20, 2)) * Math.exp(-Math.pow((uy + 0.30) / 0.55, 2)) * 0.55;
          sh *= 0.92 + (fb(X * 1.2, Y * 1.2, 2, sd + 411) - 0.5) * 0.16;
          if (band > 0.5) sh = sh * 0.8 + 0.28;
          if (nasal > 0.5) sh = 0.30 + Math.max(0, 1 - Math.abs(X - fx + 0.4) / 1.4) * 0.75;
          sh *= ex.key;
          let c = mixC(steel.dark, steel.base, clamp(sh * 1.35, 0, 1));
          c = mixC(c, steel.lite, clamp((sh - 0.68) * 1.8, 0, 1));
          if (gear.helm.gold && band > 0.5) {
            c = mixC(c, mixC(rs('gold', 0.30), rs('gold', 0.85), clamp(sh, 0, 1)), 0.8);
          }
          // rivets along the band
          if (band > 0.5) {
            const rv = Math.abs(((X - hcx) / 3.2) % 1 - 0.5);
            c = mixC(c, steel.lite, smoothstep(0.16, 0.02, rv) * 0.5);
          }
          // a dark line where the helm meets the head
          c = scl(c, mix(1, 0.55, smoothstep(browY - 1.6, browY + 0.4, Y)));
          bl(buf, i3, c, a);
          subj[ii] = Math.max(subj[ii], a);
        }
      }

      // ---- sorcerer hat ---------------------------------------------------
      if (gear.hat) {
        const brimY = browY - ry * 0.14;
        const tipX = hcx + gear.hat.tilt * rx * 0.55;
        const tipY = brimY - ry * 1.05 * gear.hat.len;
        const t = clamp((brimY - Y) / (brimY - tipY), 0, 1);
        const bend = Math.sin(t * Math.PI) * rx * 0.10;
        const cxp = mix(hcx, tipX, t * t * 0.85 + t * 0.15) + bend;
        const hw = rx * 1.02 * Math.pow(1 - t, 0.8) + 0.35;
        let a = smoothstep(hw + 0.7, hw - 0.5, Math.abs(X - cxp)) * smoothstep(0, 0.03, t)
          * (1 - smoothstep(0.97, 1.0, t));
        const brim = cov(ell(X - hcx, Y - brimY, rx * 1.48, ry * 0.20), 0.28);
        a = Math.max(a, brim);
        if (a > 0.004) {
          const base = mixC(rs('sky', 0.16), rs('arcane', 0.30), 0.55);
          const dark = scl(base, 0.40), lite = mixC(scl(base, 1.7), rs('arcane', 0.75), 0.35);
          const uu = (X - cxp) / (hw + 0.001);
          let sh = 0.24 + Math.max(0, 1 - Math.pow(uu + 0.45, 2) * 1.25) * 0.85;
          if (brim > 0.5) sh = 0.30 + 0.55 * smoothstep(brimY + 1.4, brimY - 1.4, Y);
          sh *= 0.88 + fb(X * 1.1, Y * 1.1, 2, sd + 421) * 0.30;
          sh *= ex.key;
          let c = mixC(dark, base, clamp(sh * 1.5, 0, 1));
          c = mixC(c, lite, clamp((sh - 0.62) * 1.8, 0, 1) * 0.7);
          // band above the brim
          if (Y > brimY - ry * 0.20 && Y < brimY - ry * 0.03 && brim < 0.5) {
            c = mixC(c, mixC(rs('gold', 0.35), rs('gold', 0.8), clamp(sh, 0, 1)), 0.65);
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
  const shTop = chinY + 4.5;

  const cloth = {
    plate: { base: rs('stone', 0.50), dark: rs('stone', 0.13), lite: rs('grey', 0.84) },
    leather: { base: rs('wood', 0.36), dark: rs('wood', 0.12), lite: rs('dirt', 0.62) },
    robe: { base: rs(gear.hood ? gear.hood.ramp : 'plaster', gear.hood ? gear.hood.t : 0.40), dark: null, lite: null },
    arcane: { base: mixC(rs('sky', 0.16), rs('arcane', 0.28), 0.5), dark: null, lite: null },
    cloth: { base: rs('dirt', 0.34), dark: null, lite: null },
  }[kind] || { base: rs('dirt', 0.34), dark: null, lite: null };
  if (!cloth.dark) cloth.dark = scl(cloth.base, 0.36);
  if (!cloth.lite) cloth.lite = mixC(scl(cloth.base, 1.5), rs('sand', 0.85), 0.20);

  for (let py = 0; py < BH; py++) {
    const Y = (py + 0.5) * px2dy;
    if (Y < shTop - 8) continue;
    for (let pxi = 0; pxi < BW; pxi++) {
      const X = (pxi + 0.5) * px2dx;
      const ii = py * BW + pxi;
      const i3 = ii * 3;
      const dx = X - hcx;
      const adx = Math.abs(dx);

      // Trapezius line: high beside the neck, sloping away to the frame edge.
      const top = shTop + 9.5 * smoothstep(rx * 0.32, rx * 2.1, adx);
      let a = smoothstep(top - 1.1, top + 1.1, Y);
      // gorget / collar ring around the neck
      const ring = cov(ell(dx - (neckCX - hcx), Y - (chinY + 4.0), neckW * 2.15, ry * 0.34), 0.16)
        * smoothstep(chinY + 0.5, chinY + 2.0, Y);
      a = Math.max(a, ring);
      if (a <= 0.004) continue;

      // shading: shoulders roll away from the light, dark valley at the neck
      const roll = clamp(1 - Math.pow((dx + rx * 0.55) / (rx * 1.9), 2), 0, 1);
      let sh = 0.18 + roll * 0.72;
      sh *= mix(0.45, 1.05, smoothstep(top - 0.5, top + 6, Y));
      sh *= mix(0.55, 1, smoothstep(neckW * 1.1, neckW * 2.6, adx));
      let c;

      if (kind === 'plate') {
        // Overlapping lames: a bright top edge per band, dark seam beneath.
        const bandT = (Y - top) / 4.2;
        const bf = bandT - Math.floor(bandT);
        sh += Math.exp(-Math.pow((bf - 0.12) / 0.10, 2)) * 0.55;
        sh -= smoothstep(0.86, 0.99, bf) * 0.35;
        sh += Math.exp(-Math.pow((dx + rx * 0.5) / (rx * 0.5), 2)) * 0.30;
        if (ring > 0.5) {
          const rr = (Y - (chinY + 1.2)) / (ry * 0.30);
          sh = 0.22 + Math.exp(-Math.pow((rr - 0.15) / 0.35, 2)) * 0.85 + roll * 0.25;
        }
        sh *= 0.94 + (fb(X * 1.4, Y * 1.4, 2, sd + 501) - 0.5) * 0.14;
        sh *= ex.key;
        c = mixC(steel.dark, steel.base, clamp(sh * 1.35, 0, 1));
        c = mixC(c, steel.lite, clamp((sh - 0.66) * 1.9, 0, 1));
        if (gear.trim === 'gold') {
          const edge = Math.exp(-Math.pow((Y - top - 0.8) / 1.1, 2));
          c = mixC(c, mixC(rs('gold', 0.35), rs('gold', 0.88), clamp(sh, 0, 1)), edge * 0.8);
        }
      } else {
        // Cloth / leather: broad folds falling from the shoulder line.
        const fold = fb(X * 0.62 + Y * 0.10, Y * 0.30, 3, sd + 503);
        sh *= 0.72 + fold * 0.62;
        sh += Math.max(0, 1 - Math.abs(dx + rx * 0.9) / (rx * 0.7)) * 0.18;
        sh *= ex.key;
        c = mixC(cloth.dark, cloth.base, clamp(sh * 1.45, 0, 1));
        c = mixC(c, cloth.lite, clamp((sh - 0.66) * 1.7, 0, 1) * 0.75);
        if (kind === 'leather') {
          // a stitched seam over the shoulder
          const st = Math.exp(-Math.pow((Y - top - 2.4) / 0.55, 2));
          const dash = Math.abs(((X) / 1.6) % 1 - 0.5) < 0.28 ? 1 : 0;
          c = mixC(c, cloth.lite, st * dash * 0.5);
        }
        if (kind === 'arcane' || gear.mantle) {
          // runic band along the collar edge
          const st = Math.exp(-Math.pow((Y - top - 1.8) / 1.0, 2));
          const gl = nz(X * 1.1, Y * 1.1, sd + 507);
          c = mixC(c, rs('arcane', 0.72), st * smoothstep(0.55, 0.85, gl) * 0.7);
        }
      }
      bl(buf, i3, c, a);
      subj[ii] = Math.max(subj[ii], a);

      // holy symbol / sunburst medallion on the chest
      if (gear.symbol) {
        const sy = DH - 4.5, sxp = fx + 0.5;
        const gold = mixC(rs('gold', 0.42), rs('gold', 0.92), clamp(0.35 + roll * 0.6, 0, 1));
        if (gear.symbol === 'cross') {
          const inV = Math.abs(X - sxp) < 0.95 && Y > sy - 3.6 && Y < sy + 3.2;
          const inH = Math.abs(Y - (sy - 1.2)) < 0.95 && Math.abs(X - sxp) < 2.6;
          if (inV || inH) bl(buf, i3, gold, 0.95);
        } else {
          const d = Math.sqrt(ell(X - sxp, Y - sy, 3.0, 3.0));
          if (d < 1.05) {
            const ang = Math.atan2(Y - sy, X - sxp);
            const ray = 0.5 + 0.5 * Math.cos(ang * 8);
            bl(buf, i3, scl(gold, 0.7 + ray * 0.5), cov(d * d, 0.3) * 0.95);
          }
        }
      }
    }
  }
}

// --- final grade -----------------------------------------------------------

function gradePass(buf, subj, face, ex, BW, BH, px2dx, px2dy, sd) {
  const stoneD = rs('stone', 0.12), stoneM = rs('stone', 0.46), stoneL = rs('stone', 0.86);
  for (let py = 0; py < BH; py++) {
    const Y = (py + 0.5) * px2dy;
    for (let pxi = 0; pxi < BW; pxi++) {
      const X = (pxi + 0.5) * px2dx;
      const ii = py * BW + pxi;
      const i3 = ii * 3;
      let c = [buf[i3], buf[i3 + 1], buf[i3 + 2]];
      const s = subj[ii];

      if (ex.stone && s > 0.01) {
        // Chiselled stone: value only, faceted by a coarse noise, plus cracks.
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
        // Near-black silhouette with a faint hot outline and drifting embers.
        const grad = Math.abs(s - subj[Math.min(BW * BH - 1, ii + 1)])
          + Math.abs(s - subj[Math.min(BW * BH - 1, ii + BW)]);
        let a = scl(c, 0.10);
        a = mixC(a, mixC(rs('grey', 0.16), rs('fire', 0.18), 0.4), s * 0.5);
        const ember = nz(X * 2.6, Y * 2.6 - 3, sd + 611);
        const emb = smoothstep(0.955, 0.99, ember) * s;
        a = mixC(a, rs('fire', 0.75 + 0.25 * nz(X * 5, Y * 5, sd + 612)), emb * 0.9);
        a = add3(a, rs('fire', 0.55), clamp(grad, 0, 1) * 0.55);
        c = a;
      }

      // colour grade
      if (ex.sat !== 1) c = desat(c, 1 - ex.sat);
      if (ex.tint[0] !== 1 || ex.tint[1] !== 1 || ex.tint[2] !== 1) {
        // Tint the subject harder than the background so the read is instant.
        const k = 0.35 + 0.65 * s;
        c = [c[0] * mix(1, ex.tint[0], k), c[1] * mix(1, ex.tint[1], k), c[2] * mix(1, ex.tint[2], k)];
      }

      // paint grain, then a corner vignette over the whole plate
      const gr = (fb(X * 1.15, Y * 1.15, 2, sd + 701) - 0.5);
      c = scl(c, 1 + gr * (0.055 + 0.03 * (1 - s)));
      const vg = 1 - smoothstep(0.62, 1.28,
        Math.sqrt(ell(X - DW * 0.5, Y - DH * 0.5, DW * 0.60, DH * 0.62))) * 0.55;
      c = scl(c, vg);
      // slight contrast lift - these plates sit on a dark carved-stone bar
      c = [
        (c[0] / 255 - 0.5) * 1.07 * 255 + 0.5 * 255 + 2,
        (c[1] / 255 - 0.5) * 1.07 * 255 + 0.5 * 255 + 1,
        (c[2] / 255 - 0.5) * 1.07 * 255 + 0.5 * 255,
      ];
      buf[i3] = clamp(c[0], 0, 255);
      buf[i3 + 1] = clamp(c[1], 0, 255);
      buf[i3 + 2] = clamp(c[2], 0, 255);
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

/**
 * Every expression of one face on a single atlas so the HUD can blit without
 * re-rendering when a character's condition changes.
 */
export function portraitSheet(face, w = PORTRAIT_W, h = PORTRAIT_H) {
  const key = faceKey(face) + `|${w}x${h}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const cols = 6, rows = Math.ceil(EXPRESSIONS.length / cols);
  const canvas = makeCanvas(cols * w, rows * h);
  const g = ctx2d(canvas);
  EXPRESSIONS.forEach((e, i) => {
    const c = renderPortrait(face, e, w, h);
    g.drawImage(c, (i % cols) * w, Math.floor(i / cols) * h);
  });
  const sheet = {
    canvas, cols, rows, cellW: w, cellH: h,
    index: (expr) => Math.max(0, EXPRESSIONS.indexOf(expr)),
    rect: (expr) => {
      const i = Math.max(0, EXPRESSIONS.indexOf(expr));
      return { x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h };
    },
  };
  sheetCache.set(key, sheet);
  return sheet;
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
  if (!face) { face = makeFace(seed, opts); faceCache.set(fk, face); }
  const pk = `${fk}|${expression}`;
  let c = portraitCache.get(pk);
  if (!c) { c = renderPortrait(face, expression); portraitCache.set(pk, c); }
  return c;
}

/**
 * Loading-screen generator: yields one sheet per seed so the progress bar can
 * move between characters.
 * @param {Array<{seed:*, sex?:string, klass?:string, age?:string}>} seeds
 */
export function* buildPortraits(seeds) {
  const out = [];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const spec = typeof s === 'object' && s !== null ? s : { seed: s };
    const face = makeFace(spec.seed, spec);
    const sheet = portraitSheet(face);
    out.push({ face, sheet });
    yield { i, total: seeds.length, face, sheet, all: out };
  }
  return out;
}
