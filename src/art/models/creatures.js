import * as THREE from 'three';
import { Rand, clamp } from '../../core/rng.js';
import { rampHex } from '../../core/palette.js';

// ---------------------------------------------------------------------------
// Procedural creature models.
//
// MM6 never drew a monster in 3D. Every creature was modelled once, rendered
// from 8 yaw angles across a handful of animation frames, palettised, and
// shipped as a sprite sheet. We rebuild that source art at runtime: a handful
// of body archetypes (biped, quadruped, insect, serpent, blob, dragon, wisp,
// ghost) parameterised by proportion, colour and gear, which between them cover
// the whole bestiary without 80 hand-written models.
//
// Everything is built facing +Z. The sprite baker parks its camera on +Z, so
// angle index 0 is the front view and index 4 is the back.
//
// Proportions are expressed as fractions of the creature's height so a goblin
// and a titan share code. World units are MM6 units (a man is ~176 tall, the
// party's eye is at 160).
// ---------------------------------------------------------------------------

const PI = Math.PI;
const ez = (t) => t * t * (3 - 2 * t);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- material + geometry toolkit -------------------------------------------
// Materials are shared globally and never disposed: the sprite baker swaps in
// its own cel-shaded material keyed by colour, so a few dozen Lambert
// materials cost nothing and let the models be inspected in a normal scene.

const MAT_CACHE = new Map();

/** A flat-shaded material for a 0xRRGGBB colour. `emissive` 0..1 self-lights. */
export function matFor(hex, o = {}) {
  const em = o.emissive || 0;
  const key = `${hex | 0}|${em}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    m.userData.emissive = em;
    MAT_CACHE.set(key, m);
  }
  return m;
}

export function grp(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

/** Multiply a packed colour, for cheap shade variants of a base tone. */
export function mulHex(hex, k) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

function shapeGeo(g, h, o) {
  const taper = o.taper !== undefined ? o.taper : 1;
  const taperZ = o.taperZ !== undefined ? o.taperZ : taper;
  const bulge = o.bulge || 0;
  if (taper === 1 && taperZ === 1 && bulge === 0) return;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = h === 0 ? 0.5 : (p.getY(i) + h / 2) / h;
    const b = 1 + bulge * Math.sin(PI * sat(t));
    p.setX(i, p.getX(i) * (1 + (taper - 1) * t) * b);
    p.setZ(i, p.getZ(i) * (1 + (taperZ - 1) * t) * b);
  }
  p.needsUpdate = true;
}

function finishGeo(g, h, o) {
  // pivot: 'top' hangs the part from the group origin (limbs), 'bottom' stands
  // it on the origin (torsos, trunks). Default is centred.
  if (o.pivot === 'top') g.translate(0, -h / 2, 0);
  else if (o.pivot === 'bottom') g.translate(0, h / 2, 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.rz) g.rotateZ(o.rz);
  if (o.ry) g.rotateY(o.ry);
  if (o.x || o.y || o.z) g.translate(o.x || 0, o.y || 0, o.z || 0);
  g.computeVertexNormals();
  return g;
}

/** Axis-aligned box, optionally tapered/bulged along Y. */
export function box(w, h, d, hex, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  shapeGeo(g, h, o);
  return new THREE.Mesh(finishGeo(g, h, o), matFor(hex, o));
}

/** Faceted cylinder / truncated cone. */
export function cyl(rTop, rBot, h, hex, o = {}) {
  let g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 7, 1, !!o.open);
  g = g.toNonIndexed();
  return new THREE.Mesh(finishGeo(g, h, o), matFor(hex, o));
}

export function cone(r, h, hex, o = {}) {
  const g = new THREE.ConeGeometry(r, h, o.seg || 6).toNonIndexed();
  return new THREE.Mesh(finishGeo(g, h, o), matFor(hex, o));
}

/** Low-poly icosphere; sx/sy/sz squash it into eggs, discs and lozenges. */
export function sph(r, hex, o = {}) {
  const g = new THREE.IcosahedronGeometry(r, o.detail === undefined ? 0 : o.detail);
  if (o.sx !== undefined || o.sy !== undefined || o.sz !== undefined) {
    g.scale(o.sx === undefined ? 1 : o.sx, o.sy === undefined ? 1 : o.sy, o.sz === undefined ? 1 : o.sz);
  }
  return new THREE.Mesh(finishGeo(g, r * 2, o), matFor(hex, o));
}

/** A flat quad, used for wing membranes, leaves and banners. */
export function plate(w, h, hex, o = {}) {
  return box(w, h, o.thick || Math.max(0.6, w * 0.04), hex, o);
}

export function disposeTree(root) {
  root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

// --- rig snapshot ----------------------------------------------------------
// pose() is called ~280 times per bake. Rather than have each pose function
// remember to zero every joint it does not touch, we snapshot the rest pose
// once and restore it at the top of every pose call; pose functions then only
// ever *add* to the rest values, which is what keeps per-creature base poses
// (mummy's outstretched arms, troll's hunch) intact under animation.

function snapshot(root) {
  const list = [];
  root.traverse((o) => list.push([o, o.position.x, o.position.y, o.position.z,
    o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z]));
  return list;
}

function restore(list) {
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e[0].position.set(e[1], e[2], e[3]);
    e[0].rotation.set(e[4], e[5], e[6]);
    e[0].scale.set(e[7], e[8], e[9]);
  }
}

// --- gear ------------------------------------------------------------------

/**
 * A hand-held weapon. Built in hand space with the grip at the origin and the
 * business end towards +Y, so at rest it stands beside the body (a strong
 * silhouette) and sweeps forward naturally when the arm swings.
 */
function makeWeapon(kind, H, C) {
  const g = new THREE.Group();
  const wood = C.wood, steel = C.metal;
  const u = H;
  switch (kind) {
    case 'sword':
      g.add(box(u * 0.050, u * 0.32, u * 0.026, steel, { pivot: 'bottom', y: u * 0.05, taper: 0.4 }));
      g.add(box(u * 0.115, u * 0.026, u * 0.040, mulHex(steel, 0.7), { y: u * 0.045 }));
      g.add(box(u * 0.042, u * 0.060, u * 0.042, C.wood, { pivot: 'bottom', y: -u * 0.014 }));
      g.add(sph(u * 0.026, mulHex(steel, 1.15), { y: -u * 0.018 }));
      break;
    case 'dagger':
      g.add(box(u * 0.038, u * 0.15, u * 0.020, steel, { pivot: 'bottom', y: u * 0.03, taper: 0.3 }));
      g.add(box(u * 0.080, u * 0.020, u * 0.030, mulHex(steel, 0.7), { y: u * 0.028 }));
      g.add(box(u * 0.034, u * 0.045, u * 0.034, wood, { pivot: 'bottom', y: -u * 0.014 }));
      break;
    case 'axe':
      g.add(box(u * 0.045, u * 0.36, u * 0.045, wood, { pivot: 'bottom', y: -u * 0.05 }));
      g.add(box(u * 0.048, u * 0.145, u * 0.115, steel, { y: u * 0.25, z: u * 0.06, taperZ: 1.5 }));
      g.add(box(u * 0.046, u * 0.095, u * 0.070, mulHex(steel, 0.85), { y: u * 0.25, z: -u * 0.05 }));
      break;
    case 'club':
      g.add(box(u * 0.055, u * 0.30, u * 0.055, wood, { pivot: 'bottom', y: -u * 0.05, taper: 1.8, bulge: 0.18 }));
      for (let i = 0; i < 3; i++) g.add(cone(u * 0.020, u * 0.05, C.horn, { y: u * (0.13 + i * 0.055), x: (i % 2 ? 1 : -1) * u * 0.045, rz: (i % 2 ? -1 : 1) * 1.4 }));
      break;
    case 'mace':
      g.add(box(u * 0.042, u * 0.26, u * 0.042, wood, { pivot: 'bottom', y: -u * 0.05 }));
      g.add(sph(u * 0.062, steel, { y: u * 0.21, detail: 0 }));
      for (let i = 0; i < 4; i++) {
        g.add(cone(u * 0.022, u * 0.048, mulHex(steel, 1.1),
          { y: u * 0.21, x: Math.cos(i * PI / 2) * u * 0.062, z: Math.sin(i * PI / 2) * u * 0.062, rz: -Math.cos(i * PI / 2) * 1.4, rx: Math.sin(i * PI / 2) * 1.4 }));
      }
      break;
    case 'staff': {
      g.add(box(u * 0.042, u * 0.58, u * 0.042, wood, { pivot: 'bottom', y: -u * 0.22, taper: 0.85 }));
      g.add(cyl(u * 0.055, u * 0.055, u * 0.030, mulHex(wood, 1.3), { seg: 7, y: u * 0.325 }));
      g.add(sph(u * 0.060, C.glow, { y: u * 0.385, emissive: 0.9, detail: 0 }));
      break;
    }
    case 'spear':
      g.add(box(u * 0.038, u * 0.66, u * 0.038, wood, { pivot: 'bottom', y: -u * 0.24 }));
      g.add(cone(u * 0.046, u * 0.13, steel, { y: u * 0.47 }));
      g.add(box(u * 0.055, u * 0.020, u * 0.030, mulHex(steel, 0.8), { y: u * 0.405 }));
      break;
    case 'scythe':
      g.add(box(u * 0.042, u * 0.56, u * 0.042, wood, { pivot: 'bottom', y: -u * 0.20 }));
      g.add(box(u * 0.036, u * 0.055, u * 0.24, steel, { y: u * 0.34, z: u * 0.12, taperZ: 0.35 }));
      break;
    case 'bow':
      g.add(box(u * 0.036, u * 0.36, u * 0.036, wood, { taper: 0.6, rz: 0.10, x: -u * 0.01 }));
      g.add(box(u * 0.030, u * 0.15, u * 0.030, wood, { y: u * 0.20, rz: 0.55 }));
      g.add(box(u * 0.030, u * 0.15, u * 0.030, wood, { y: -u * 0.20, rz: -0.55 }));
      g.add(box(u * 0.014, u * 0.44, u * 0.014, C.cloth2, { x: u * 0.055 }));
      break;
    case 'torch':
      g.add(box(u * 0.038, u * 0.22, u * 0.038, wood, { pivot: 'bottom', y: -u * 0.04 }));
      g.add(cone(u * 0.055, u * 0.10, rampHex('fire', 12), { y: u * 0.21, emissive: 1 }));
      break;
    default:
      return null;
  }
  return g;
}

function makeShield(kind, H, C) {
  const g = new THREE.Group();
  const u = H;
  if (kind === 'round') {
    g.add(cyl(u * 0.115, u * 0.115, u * 0.022, C.metal, { seg: 8, rx: PI / 2 }));
    g.add(sph(u * 0.032, mulHex(C.metal, 1.25), { z: u * 0.018, sz: 0.6 }));
  } else {
    g.add(box(u * 0.17, u * 0.23, u * 0.022, C.metal, { taper: 0.35, pivot: 'top', y: u * 0.09 }));
    g.add(box(u * 0.05, u * 0.14, u * 0.012, C.cloth2, { y: u * 0.02, z: u * 0.014 }));
  }
  return g;
}

// --- head shapes -----------------------------------------------------------

function buildHead(headG, H, P, C) {
  const r = H * P.headR;
  const shape = P.headShape;
  const skin = C.skin;
  const eyeGlow = P.glow ? 1 : 0;
  const eyeCol = P.glow ? C.glow : (C.eye !== undefined ? C.eye : 0x0a0a0c);

  if (shape === 'box' || shape === 'golem') {
    headG.add(box(r * 1.7, r * 1.9, r * 1.6, skin, { pivot: 'bottom', taper: P.jaw || 0.9 }));
  } else if (shape === 'skull') {
    headG.add(sph(r, skin, { y: r * 1.05, sy: 1.05, sz: 1.15 }));
    headG.add(box(r * 1.15, r * 0.55, r * 0.9, mulHex(skin, 0.92), { y: r * 0.42, z: r * 0.30 }));
    for (const s of [-1, 1]) headG.add(box(r * 0.42, r * 0.40, r * 0.20, 0x080608, { x: s * r * 0.40, y: r * 1.20, z: r * 0.85 }));
    headG.add(box(r * 0.20, r * 0.22, r * 0.16, 0x080608, { y: r * 0.85, z: r * 0.95 }));
  } else if (shape === 'wolf' || shape === 'lizard' || shape === 'rat') {
    const sn = shape === 'rat' ? 1.5 : shape === 'lizard' ? 2.0 : 1.6;
    headG.add(sph(r, skin, { y: r, sz: 1.15 }));
    headG.add(box(r * 0.95, r * 0.75, r * sn, mulHex(skin, 0.9), { y: r * 0.85, z: r * (0.5 + sn * 0.42), taper: 0.7, taperZ: 1 }));
    headG.add(box(r * 0.8, r * 0.16, r * sn * 0.7, 0x120a08, { y: r * 0.60, z: r * (0.5 + sn * 0.45) }));
    for (const s of [-1, 1]) {
      headG.add(cone(r * 0.34, r * 0.72, mulHex(skin, 1.05), { x: s * r * 0.55, y: r * 1.7, z: -r * 0.05, rz: s * 0.25 }));
      headG.add(sph(r * 0.17, eyeCol, { x: s * r * 0.42, y: r * 1.15, z: r * 0.72, emissive: eyeGlow }));
    }
  } else if (shape === 'bull') {
    headG.add(sph(r * 1.05, skin, { y: r, sz: 1.2 }));
    headG.add(box(r * 0.9, r * 0.75, r * 1.1, mulHex(skin, 0.88), { y: r * 0.72, z: r * 1.05, taper: 0.8 }));
    for (const s of [-1, 1]) {
      headG.add(sph(r * 0.16, eyeCol, { x: s * r * 0.5, y: r * 1.2, z: r * 0.75, emissive: eyeGlow }));
      headG.add(box(r * 0.30, r * 0.24, r * 0.5, mulHex(skin, 0.8), { x: s * r * 0.95, y: r * 1.2, z: 0, rz: s * 0.4 }));
    }
  } else if (shape === 'beak') {
    headG.add(sph(r, skin, { y: r, sz: 1.05 }));
    headG.add(cone(r * 0.5, r * 1.15, C.horn, { y: r * 0.95, z: r * 0.9, rx: PI / 2 }));
    for (const s of [-1, 1]) headG.add(sph(r * 0.20, eyeCol, { x: s * r * 0.55, y: r * 1.25, z: r * 0.55, emissive: eyeGlow }));
  } else if (shape === 'insect') {
    headG.add(sph(r, skin, { y: r, sy: 0.85, sz: 1.2 }));
    for (const s of [-1, 1]) {
      headG.add(sph(r * 0.42, mulHex(eyeCol, 1.0), { x: s * r * 0.62, y: r * 1.1, z: r * 0.55, sz: 1.2, emissive: eyeGlow }));
      headG.add(box(r * 0.16, r * 0.14, r * 0.9, mulHex(skin, 0.8), { x: s * r * 0.35, y: r * 0.55, z: r * 1.25, ry: -s * 0.30, taperZ: 0.4 }));
      headG.add(box(r * 0.07, r * 0.07, r * 1.3, mulHex(skin, 1.1), { x: s * r * 0.3, y: r * 1.55, z: r * 0.8, rx: -0.6, ry: -s * 0.35 }));
    }
  } else if (shape === 'dragon') {
    headG.add(sph(r * 1.0, skin, { y: r, sz: 1.3 }));
    headG.add(box(r * 0.85, r * 0.62, r * 2.1, mulHex(skin, 0.92), { y: r * 0.85, z: r * 1.5, taper: 0.65, taperZ: 1 }));
    headG.add(box(r * 0.72, r * 0.22, r * 1.9, mulHex(skin, 0.72), { y: r * 0.52, z: r * 1.45 }));
    for (const s of [-1, 1]) {
      headG.add(sph(r * 0.20, eyeCol, { x: s * r * 0.55, y: r * 1.25, z: r * 0.55, emissive: 0.7 }));
      headG.add(cone(r * 0.22, r * 1.1, C.horn, { x: s * r * 0.5, y: r * 1.65, z: -r * 0.35, rx: -0.7, rz: s * 0.35 }));
      headG.add(cone(r * 0.10, r * 0.3, C.horn, { x: s * r * 0.30, y: r * 0.45, z: r * 2.2, rx: 2.4 }));
    }
  } else {
    // round: the default humanoid skull
    headG.add(sph(r, skin, { y: r, sy: P.headSy || 1.06, sz: P.headSz || 1.0 }));
    if (P.snout) headG.add(box(r * 0.7, r * 0.5, r * 0.8, mulHex(skin, 0.92), { y: r * 0.82, z: r * 0.9, taper: 0.7 }));
    for (const s of [-1, 1]) headG.add(box(r * 0.24, r * 0.16, r * 0.16, eyeCol, { x: s * r * 0.40, y: r * 1.14, z: r * 0.86, emissive: eyeGlow }));
  }

  if (P.ears === 'long') {
    for (const s of [-1, 1]) headG.add(box(r * 0.20, r * 0.9, r * 0.30, mulHex(skin, 1.08), { x: s * r * 1.05, y: r * 1.25, rz: s * 0.75, taper: 0.25 }));
  } else if (P.ears === 'point') {
    for (const s of [-1, 1]) headG.add(cone(r * 0.20, r * 0.5, mulHex(skin, 1.08), { x: s * r * 0.95, y: r * 1.35, rz: s * 0.9 }));
  } else if (P.ears === 'round') {
    for (const s of [-1, 1]) headG.add(sph(r * 0.30, mulHex(skin, 1.05), { x: s * r * 0.95, y: r * 1.4, sz: 0.4 }));
  }

  if (P.horns === 'bull') {
    for (const s of [-1, 1]) {
      headG.add(cone(r * 0.20, r * 1.15, C.horn, { x: s * r * 1.15, y: r * 1.35, rz: s * 1.15 }));
      headG.add(cone(r * 0.14, r * 0.5, C.horn, { x: s * r * 1.75, y: r * 1.75, rz: s * 0.15 }));
    }
  } else if (P.horns === 'devil') {
    for (const s of [-1, 1]) headG.add(cone(r * 0.18, r * 1.0, C.horn, { x: s * r * 0.62, y: r * 2.0, z: -r * 0.15, rz: s * 0.45, rx: -0.35 }));
  } else if (P.horns === 'ram') {
    for (const s of [-1, 1]) {
      headG.add(cyl(r * 0.16, r * 0.24, r * 0.8, C.horn, { seg: 6, x: s * r * 0.95, y: r * 1.35, rz: s * 1.3 }));
      headG.add(cyl(r * 0.10, r * 0.16, r * 0.7, C.horn, { seg: 6, x: s * r * 1.35, y: r * 0.8, rz: s * 2.2 }));
    }
  } else if (P.horns === 'crest') {
    for (let i = 0; i < 4; i++) headG.add(cone(r * 0.16, r * 0.45 * (1 - i * 0.15), C.horn, { y: r * 1.85, z: -r * (0.1 + i * 0.35), rx: -0.5 }));
  }

  if (P.hair) {
    const hc = C.hair;
    headG.add(sph(r * 1.06, hc, { y: r * 1.16, sy: 0.78, sz: 1.02 }));
    if (P.hair === 'long') {
      headG.add(box(r * 1.5, r * 1.5, r * 0.5, hc, { y: r * 0.75, z: -r * 0.85, taper: 0.8 }));
    }
  }
  if (P.beard) {
    headG.add(box(H * P.headR * 1.1, H * P.headR * (P.beard === 'long' ? 1.5 : 0.9), H * P.headR * 0.5, C.hair,
      { y: r * (P.beard === 'long' ? 0.15 : 0.42), z: r * 0.62, taper: 0.7, pivot: 'top' }));
  }
  if (P.helm === 'cap') {
    headG.add(sph(r * 1.12, C.metal, { y: r * 1.1, sy: 0.8 }));
  } else if (P.helm === 'full') {
    headG.add(box(r * 1.9, r * 1.9, r * 1.9, C.metal, { pivot: 'bottom', y: r * 0.08, taper: 0.85 }));
    headG.add(box(r * 1.4, r * 0.22, r * 0.3, 0x07070a, { y: r * 1.18, z: r * 0.92 }));
    headG.add(box(r * 0.28, r * 0.9, r * 0.35, mulHex(C.metal, 1.2), { y: r * 2.0, z: 0, taper: 0.4 }));
  } else if (P.helm === 'horned') {
    headG.add(sph(r * 1.15, C.metal, { y: r * 1.15, sy: 0.85 }));
    for (const s of [-1, 1]) headG.add(cone(r * 0.22, r * 0.9, C.horn, { x: s * r * 1.0, y: r * 1.7, rz: s * 0.85 }));
  } else if (P.helm === 'crown') {
    headG.add(cyl(r * 1.06, r * 1.06, r * 0.36, C.metal, { seg: 8, y: r * 1.9 }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      headG.add(cone(r * 0.13, r * 0.4, C.metal, { x: Math.cos(a) * r * 0.95, z: Math.sin(a) * r * 0.95, y: r * 2.24 }));
    }
  } else if (P.helm === 'mitre') {
    headG.add(cone(r * 1.0, r * 1.5, C.cloth2, { y: r * 2.3, seg: 5 }));
  } else if (P.helm === 'hood') {
    headG.add(sph(r * 1.22, C.cloth, { y: r * 1.05, sy: 1.15, sz: 1.05 }));
    headG.add(box(r * 1.4, r * 1.0, r * 0.4, mulHex(C.cloth, 0.75), { y: r * 0.9, z: r * 0.95 }));
  } else if (P.helm === 'hat') {
    headG.add(cyl(r * 2.1, r * 2.1, r * 0.14, C.cloth2, { seg: 9, y: r * 1.85 }));
    headG.add(cone(r * 0.9, r * 2.0, C.cloth2, { y: r * 2.9, seg: 7 }));
  } else if (P.helm === 'wrap') {
    headG.add(sph(r * 1.1, C.cloth, { y: r * 1.1, sy: 1.05 }));
    for (let i = 0; i < 3; i++) headG.add(box(r * 2.1, r * 0.22, r * 2.1, mulHex(C.cloth, 0.85 + i * 0.08), { y: r * (0.55 + i * 0.5), rz: 0.14 * (i - 1) }));
  }

  if (P.snakes) {
    // Medusa: a writhing crown of little serpents reads instantly at 64px.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2;
      const s = grp(Math.cos(a) * r * 0.8, r * 1.6, Math.sin(a) * r * 0.8);
      s.rotation.z = Math.cos(a) * 0.9;
      s.rotation.x = -Math.sin(a) * 0.9;
      s.add(box(r * 0.18, r * 1.0, r * 0.18, C.skin2, { pivot: 'bottom', taper: 0.6 }));
      s.add(sph(r * 0.14, C.skin2, { y: r * 1.0 }));
      headG.add(s);
    }
  }
  return headG;
}

// --- wings -----------------------------------------------------------------

function makeWing(kind, span, hex, boneHex, side) {
  const g = new THREE.Group();
  if (kind === 'bat' || kind === 'dragon') {
    // Three membrane panels between finger bones; cheap but very readable.
    for (let i = 0; i < 3; i++) {
      const a = -0.15 - i * 0.42;
      const len = span * (1 - i * 0.14);
      const bone = grp(0, 0, 0);
      bone.rotation.z = side * (0.35 - i * 0.02);
      bone.rotation.y = side * (i * 0.42);
      bone.add(box(len, span * 0.05, span * 0.035, boneHex, { x: side * len / 2, taper: 0.5 }));
      bone.add(plate(len * 0.95, span * (0.42 - i * 0.06), hex,
        { x: side * len * 0.48, y: -span * (0.20 - i * 0.02), taper: 0.55, thick: span * 0.012 }));
      bone.rotation.x = a * 0.2;
      g.add(bone);
    }
  } else if (kind === 'feather') {
    // A leading-edge bone with primaries fanning off the back of it: without
    // the bone the wing reads as a flat sheet of paper at sprite size.
    g.add(box(span * 0.98, span * 0.09, span * 0.09, boneHex, { x: side * span * 0.49, taper: 0.35, rz: side * 0.14 }));
    g.add(plate(span * 0.55, span * 0.34, hex, { x: side * span * 0.26, y: -span * 0.13, z: -span * 0.05, taper: 0.7, thick: span * 0.035 }));
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const len = span * (0.62 - t * 0.30);
      g.add(plate(len, span * 0.115, i % 2 ? mulHex(hex, 0.80) : hex, {
        x: side * (span * (0.30 + t * 0.62) + len * 0.35),
        y: -span * (0.16 + t * 0.10) + side * 0,
        z: -span * 0.03 * i,
        rz: side * (-0.55 - t * 0.35), taper: 0.55, thick: span * 0.026,
      }));
    }
  } else if (kind === 'insect') {
    for (let i = 0; i < 2; i++) {
      g.add(plate(span * (1 - i * 0.2), span * 0.22, hex,
        { x: side * span * 0.5, z: -span * 0.18 * i, rz: side * 0.12, taper: 0.4, thick: span * 0.008 }));
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Archetype: biped humanoid
// ---------------------------------------------------------------------------

const BIPED_D = {
  legLen: 0.47, torsoH: 0.30, headR: 0.075, shoulderW: 0.24, hipW: 0.19, torsoD: 0.145,
  armLen: 0.42, armR: 0.040, legR: 0.052, stance: 0.055, hunch: 0, lean: 0,
  headShape: 'round', ears: 0, horns: 0, beard: 0, hair: 0, helm: 0, snout: 0,
  weapon: 'none', shield: 0, robe: 0, cape: 0, belt: 1, boots: 1, pads: 0,
  wings: 0, wingSpan: 0.5, tail: 0, digitigrade: 0, glow: 0, snakes: 0,
  lower: 'legs', armDroop: 0.06, stride: 1, armSwing: 1, flyer: 0, ribs: 0, tatter: 0,
};

function buildBipedRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const legLen = H * P.legLen;
  const torsoH = H * P.torsoH;
  const headR = H * P.headR;
  const neckH = clamp(H * (1 - P.legLen - P.torsoH - 2 * P.headR), H * 0.008, H * 0.09);
  const shoulderW = H * P.shoulderW;
  const hipW = H * P.hipW;
  const torsoD = H * P.torsoD;
  const armUp = H * P.armLen * 0.52, armFo = H * P.armLen * 0.48, armR = H * P.armR;
  const thighL = legLen * 0.52, shinL = legLen * 0.48, legR = H * P.legR;
  const lowerKind = P.lower || 'legs';
  const serpentLower = lowerKind === 'serpent';
  const floatLower = lowerKind === 'none' || lowerKind === 'smoke';

  const bodyY = serpentLower ? H * 0.42 : floatLower ? H * 0.50 : legLen;
  const body = grp(0, bodyY, 0);
  root.add(body);
  const torso = grp(0, 0, 0);
  torso.rotation.x = P.hunch + P.lean;
  body.add(torso);

  // pelvis + ribcage
  body.add(box(hipW * 1.05, torsoH * 0.30, torsoD * 1.0, C.cloth, { pivot: 'bottom', y: -torsoH * 0.06 }));
  torso.add(box(hipW, torsoH, torsoD, C.body, { pivot: 'bottom', taper: shoulderW / hipW, bulge: P.ribs ? -0.05 : 0.06 }));
  if (P.ribs) {
    for (let i = 0; i < 3; i++) {
      torso.add(box(hipW * (0.95 - i * 0.05), torsoH * 0.055, torsoD * 1.02, mulHex(C.body, 0.72),
        { y: torsoH * (0.42 + i * 0.16) }));
    }
  }
  if (P.belt) torso.add(box(hipW * 1.06, torsoH * 0.09, torsoD * 1.06, C.cloth2, { y: torsoH * 0.10 }));
  if (P.pads) {
    for (const s of [-1, 1]) torso.add(sph(shoulderW * 0.30, C.metal, { x: s * shoulderW * 0.52, y: torsoH * 0.95, sy: 0.62 }));
  }
  if (P.tatter) {
    for (let i = 0; i < 6; i++) {
      const a = rnd.float(-PI, PI);
      torso.add(plate(hipW * 0.3, torsoH * rnd.float(0.25, 0.6), C.cloth,
        { x: Math.cos(a) * hipW * 0.55, z: Math.sin(a) * torsoD * 0.6, y: torsoH * rnd.float(0.05, 0.35), rz: rnd.float(-0.3, 0.3), thick: 1 }));
    }
  }

  // head
  const head = grp(0, torsoH + neckH, 0);
  torso.add(head);
  if (neckH > H * 0.02) torso.add(cyl(headR * 0.42, headR * 0.5, neckH * 1.2, C.skin2, { seg: 6, pivot: 'bottom', y: torsoH - neckH * 0.1 }));
  buildHead(head, H, P, C);

  // arms
  const arms = {};
  for (const [key, s] of [['L', -1], ['R', 1]]) {
    const sh = grp(s * (shoulderW * 0.5 + armR * 0.5), torsoH * (1 - P.armDroop), 0);
    torso.add(sh);
    sh.rotation.z = -s * 0.10;
    sh.add(box(armR * 2.1, armUp, armR * 2.1, mulHex(C.body, 0.84), { pivot: 'top', taper: 0.85 }));
    const fo = grp(0, -armUp, 0);
    sh.add(fo);
    fo.add(box(armR * 1.8, armFo, armR * 1.8, C.skin, { pivot: 'top', taper: 0.9 }));
    const hand = grp(0, -armFo, 0);
    fo.add(hand);
    hand.add(sph(armR * 1.35, C.skin, {}));
    if (P.claws) {
      for (let i = -1; i <= 1; i++) hand.add(cone(armR * 0.28, armR * 1.5, C.horn, { x: i * armR * 0.6, y: -armR * 1.1, z: armR * 0.3, rx: PI }));
    }
    arms['arm' + key] = sh; arms['fore' + key] = fo; arms['hand' + key] = hand;
  }
  if (P.weapon && P.weapon !== 'none') {
    const w = makeWeapon(P.weapon, H, C);
    if (w) { w.rotation.x = -0.14; arms.handR.add(w); }
  }
  if (P.weapon2) {
    const w = makeWeapon(P.weapon2, H, C);
    if (w) { w.rotation.x = -0.10; arms.handL.add(w); }
  }
  if (P.shield) {
    const sh = makeShield(P.shield, H, C);
    sh.position.set(-H * 0.045, -armFo * 0.45, H * 0.02);
    sh.rotation.y = -0.25;
    arms.foreL.add(sh);
  }

  // legs (or a serpent's coil)
  const legs = {};
  if (serpentLower) {
    const coil = grp(0, 0, 0);
    body.add(coil);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const a = t * PI * 2.6;
      const rr = H * 0.20 * (1 - t * 0.55);
      coil.add(sph(H * (0.085 - t * 0.03), i % 2 ? C.skin2 : mulHex(C.skin2, 0.85),
        { x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: -H * (0.42 - t * 0.30), sy: 0.7 }));
    }
    // tail flick tip
    const tip = grp(0, -H * 0.10, -H * 0.16);
    coil.add(tip);
    tip.add(box(H * 0.05, H * 0.05, H * 0.26, C.skin2, { taper: 0.2, taperZ: 0.2, z: -H * 0.13 }));
    legs.tailTip = tip;
  } else if (floatLower) {
    // Ghosts, wraiths and genies taper into smoke instead of standing on legs.
    const col = lowerKind === 'smoke' ? mulHex(C.skin, 0.72) : C.cloth;
    const tail = grp(0, 0, 0);
    body.add(tail);
    tail.add(box(hipW * 1.25, bodyY * 1.02, torsoD * 1.25, col, { pivot: 'top', taper: 0.22, taperZ: 0.22 }));
    for (let i = 0; i < 4; i++) {
      tail.add(box(hipW * 0.34, bodyY * (0.45 + i * 0.12), torsoD * 0.34, mulHex(col, 0.85 + i * 0.08),
        { pivot: 'top', x: (i - 1.5) * hipW * 0.30, z: ((i % 2) - 0.5) * torsoD * 0.5, taper: 0.15, rz: (i - 1.5) * 0.12 }));
    }
    legs.tailTip = tail;
  } else {
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const hip = grp(s * H * P.stance, 0, 0);
      body.add(hip);
      hip.add(box(legR * 2.1, thighL, legR * 2.1, C.body, { pivot: 'top', taper: 0.85 }));
      const knee = grp(0, -thighL, 0);
      hip.add(knee);
      knee.add(box(legR * 1.7, shinL, legR * 1.7, P.boots ? C.trouser : C.body, { pivot: 'top', taper: 0.9 }));
      const foot = grp(0, -shinL, 0);
      knee.add(foot);
      foot.add(box(legR * 2.0, legR * 1.1, legR * 3.6, P.boots ? C.boot : C.skin2, { y: legR * 0.5, z: legR * 0.9 }));
      if (P.boots) knee.add(box(legR * 1.85, shinL * 0.42, legR * 1.85, C.boot, { pivot: 'top', y: -shinL * 0.58, taper: 1.05 }));
      if (P.digitigrade) { hip.rotation.x = 0.45; knee.rotation.x = -0.85; foot.rotation.x = 0.40; }
      legs['leg' + key] = hip; legs['shin' + key] = knee; legs['foot' + key] = foot;
    }
  }

  if (P.robe && !floatLower) {
    const rl = serpentLower ? H * 0.22 : legLen * (P.robe === 'short' ? 0.55 : 0.95);
    body.add(box(hipW * 1.15, rl, torsoD * 1.15, C.cloth, { pivot: 'top', y: torsoH * 0.12, taper: 1.24, taperZ: 1.18 }));
    body.add(box(hipW * 1.22, torsoH * 0.10, torsoD * 1.22, C.cloth2, { y: torsoH * 0.08 }));
  }
  if (P.cape) {
    const cp = grp(0, torsoH * 0.95, -torsoD * 0.55);
    torso.add(cp);
    cp.add(box(shoulderW * 1.05, legLen * 0.85 + torsoH * 0.7, torsoD * 0.16, C.cloth2, { pivot: 'top', taper: 1.5 }));
    legs.cape = cp;
  }
  if (P.wings) {
    const span = H * P.wingSpan;
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const w = grp(s * shoulderW * 0.42, torsoH * 0.86, -torsoD * 0.42);
      torso.add(w);
      if (P.wingFold) { w.rotation.z = s * P.wingFold; w.rotation.y = -s * 1.15; w.rotation.x = -0.35; }
      w.add(makeWing(P.wings, span, C.wing, C.wing2, s));
      legs['wing' + key] = w;
    }
  }
  if (P.tail) {
    const tl = H * P.tail;
    const t0 = grp(0, torsoH * 0.05, -torsoD * 0.5);
    torso.add(t0);
    t0.rotation.x = 0.9;
    t0.add(box(H * 0.05, tl * 0.55, H * 0.05, C.skin2, { pivot: 'top', taper: 0.7 }));
    const t1 = grp(0, -tl * 0.55, 0);
    t0.add(t1);
    t1.rotation.x = -0.5;
    t1.add(box(H * 0.036, tl * 0.55, H * 0.036, C.skin2, { pivot: 'top', taper: 0.25 }));
    legs.tail0 = t0; legs.tail1 = t1;
  }

  const rig = {
    root, body, torso, head,
    ...arms, ...legs,
    arch: 'biped',
    b: { H, bodyY, torsoH, legLen, stride: P.stride, armSwing: P.armSwing, flyer: P.flyer, serpent: serpentLower },
  };
  rig.snap = snapshot(root);
  return rig;
}

function poseBiped(r, action, t) {
  restore(r.snap);
  const b = r.b, H = b.H;
  const hasLegs = !!r.legL;
  switch (action) {
    case 'walk': {
      if (b.flyer) { poseFlap(r, t); break; }
      const p = t * PI * 2, sn = Math.sin(p), cs = Math.cos(p);
      const sw = 0.85 * b.stride;
      if (hasLegs) {
        r.legL.rotation.x += -sn * sw;
        r.legR.rotation.x += sn * sw;
        r.shinL.rotation.x += Math.max(0, Math.sin(p - 1.0)) * 1.20;
        r.shinR.rotation.x += Math.max(0, Math.sin(p + PI - 1.0)) * 1.20;
        r.footL.rotation.x += -Math.max(0, -Math.sin(p - 0.4)) * 0.5;
        r.footR.rotation.x += -Math.max(0, -Math.sin(p + PI - 0.4)) * 0.5;
        r.body.position.y += Math.abs(cs) * H * 0.022 - H * 0.011;
      } else {
        r.body.position.y += Math.sin(p * 2) * H * 0.02;
        if (r.tailTip) r.tailTip.rotation.y += sn * 0.5;
      }
      r.body.rotation.y += sn * 0.09;
      r.torso.rotation.y += -sn * 0.14;
      r.torso.rotation.x += 0.06;
      r.armL.rotation.x += sn * 0.68 * b.armSwing;
      r.armR.rotation.x += -sn * 0.68 * b.armSwing;
      r.foreL.rotation.x += -0.30 - Math.max(0, sn) * 0.45;
      r.foreR.rotation.x += -0.30 - Math.max(0, -sn) * 0.45;
      r.head.rotation.y += sn * 0.08;
      if (r.cape) r.cape.rotation.x += -0.10 - Math.abs(sn) * 0.12;
      if (r.tail0) r.tail0.rotation.y += sn * 0.35;
      break;
    }
    case 'attack': {
      // wind the weapon arm up over the shoulder, then drive it through.
      let a, lean, step;
      if (t < 0.42) { const u = ez(t / 0.42); a = u * 2.10; lean = -u * 0.22; step = -u * 0.25; }
      else if (t < 0.62) { const u = (t - 0.42) / 0.20; a = 2.10 - u * u * 3.30; lean = -0.22 + u * 0.62; step = -0.25 + u * 0.85; }
      else { const u = ez((t - 0.62) / 0.38); a = -1.20 + u * 1.20; lean = 0.40 - u * 0.40; step = 0.60 - u * 0.60; }
      r.armR.rotation.x += a;
      r.armR.rotation.z += -0.25 * Math.max(0, a);
      r.foreR.rotation.x += -0.55 - Math.max(0, a) * 0.55;
      r.armL.rotation.x += -a * 0.22;
      r.torso.rotation.x += lean;
      r.torso.rotation.y += -0.35 * Math.max(-1, Math.min(1, a));
      r.head.rotation.x += lean * 0.4;
      if (hasLegs) {
        r.legL.rotation.x += -step * 0.55;
        r.legR.rotation.x += step * 0.35;
        r.shinL.rotation.x += Math.max(0, step) * 0.4;
        r.body.position.z += step * H * 0.03;
        r.body.position.y += -Math.abs(lean) * H * 0.02;
      }
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.35;
      const tr = Math.sin(t * PI * 8) * 0.05 * u;
      r.armL.rotation.x += -1.80 * u + tr;
      r.armR.rotation.x += -1.80 * u - tr;
      r.armL.rotation.z += 0.45 * u;
      r.armR.rotation.z += -0.45 * u;
      r.foreL.rotation.x += -0.5 * u;
      r.foreR.rotation.x += -0.5 * u;
      r.torso.rotation.x += -0.32 * u;
      r.head.rotation.x += -0.42 * u;
      r.body.position.y += u * H * 0.012;
      if (hasLegs) { r.legL.rotation.x += 0.16 * u; r.legR.rotation.x += -0.16 * u; }
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      r.torso.rotation.x += -0.42 * u;
      r.head.rotation.x += -0.35 * u;
      r.armL.rotation.x += -0.7 * u; r.armL.rotation.z += 0.5 * u;
      r.armR.rotation.x += -0.7 * u; r.armR.rotation.z += -0.5 * u;
      r.body.position.z += -H * 0.035 * u;
      r.body.position.y += -H * 0.02 * u;
      if (hasLegs) { r.legL.rotation.x += 0.3 * u; r.shinL.rotation.x += 0.4 * u; }
      break;
    }
    case 'die': case 'dead': {
      const u = action === 'dead' ? 1 : ez(t);
      const e = u * u;
      // Crumple rather than fall like a plank: less rotation, more sink and
      // squash, so the corpse stays inside a sprite cell sized for a standing
      // figure.
      r.root.rotation.x += e * 1.10;
      r.root.rotation.z += e * 0.26;
      r.root.scale.y *= 1 - e * 0.22;
      r.root.scale.z *= 1 - e * 0.16;
      r.body.position.y += -e * H * 0.16;
      r.torso.rotation.x += e * 0.35;
      r.head.rotation.x += e * 0.55;
      r.armL.rotation.x += e * 1.1; r.armL.rotation.z += e * 0.6;
      r.armR.rotation.x += e * 0.7; r.armR.rotation.z += -e * 0.8;
      r.foreL.rotation.x += -e * 0.7; r.foreR.rotation.x += -e * 0.7;
      if (hasLegs) {
        r.legL.rotation.x += e * 0.55; r.legR.rotation.x += -e * 0.30;
        r.shinL.rotation.x += e * 0.9; r.shinR.rotation.x += e * 0.5;
      }
      if (r.wingL) { r.wingL.rotation.z += e * 0.9; r.wingR.rotation.z += -e * 0.9; }
      break;
    }
    case 'bored': {
      // A fidget: shift weight, glance around, roll the shoulders. Idle
      // monsters play this between stands, which is what stops a room full of
      // goblins from looking like statues.
      const p = t * PI * 2;
      const sw = Math.sin(p), sh2 = Math.sin(p * 2);
      r.body.position.x += sw * H * 0.020;
      r.body.rotation.z += -sw * 0.05;
      r.body.position.y += -Math.abs(sw) * H * 0.010;
      r.torso.rotation.y += sw * 0.16;
      r.torso.rotation.x += sh2 * 0.05;
      r.head.rotation.y += Math.sin(p + 1.2) * 0.55;
      r.head.rotation.x += Math.sin(p * 2 + 0.5) * 0.14;
      r.armL.rotation.x += -0.22 * Math.max(0, sh2) + sw * 0.10;
      r.armR.rotation.x += -0.22 * Math.max(0, -sh2) - sw * 0.10;
      r.foreL.rotation.x += -0.45 * Math.max(0, sh2);
      r.foreR.rotation.x += -0.45 * Math.max(0, -sh2);
      if (hasLegs) { r.legL.rotation.x += -sw * 0.12; r.legR.rotation.x += sw * 0.12; }
      if (r.tail0) r.tail0.rotation.y += sw * 0.6;
      if (r.wingL) { r.wingL.rotation.z += Math.max(0, sh2) * 0.55; r.wingR.rotation.z += -Math.max(0, sh2) * 0.55; }
      if (r.tailTip) r.tailTip.rotation.z += sw * 0.10;
      break;
    }
    default: { // stand
      const s = Math.sin(t * PI * 2), c = Math.cos(t * PI * 2);
      r.body.position.y += s * H * 0.007;
      r.torso.rotation.x += s * 0.022;
      r.armL.rotation.x += 0.05 + s * 0.055;
      r.armR.rotation.x += 0.05 - s * 0.055;
      r.armL.rotation.z += 0.03 * c;
      r.armR.rotation.z += -0.03 * c;
      r.head.rotation.y += s * 0.12;
      if (r.wingL) { r.wingL.rotation.z += s * 0.14; r.wingR.rotation.z += -s * 0.14; }
      if (r.tail0) r.tail0.rotation.y += s * 0.25;
      break;
    }
  }
}

function poseFlap(r, t) {
  const p = t * PI * 2, sn = Math.sin(p);
  const H = r.b.H;
  r.body.position.y += sn * H * 0.045;
  if (r.wingL) {
    r.wingL.rotation.z += sn * 1.05; r.wingR.rotation.z += -sn * 1.05;
    r.wingL.rotation.x += Math.cos(p) * 0.25; r.wingR.rotation.x += Math.cos(p) * 0.25;
  }
  if (r.legL) { r.legL.rotation.x += 0.7 + sn * 0.12; r.shinL.rotation.x += 0.9; r.legR.rotation.x += 0.7 - sn * 0.12; r.shinR.rotation.x += 0.9; }
  r.torso.rotation.x += 0.18 + sn * 0.08;
  if (r.tail0) r.tail0.rotation.x += sn * 0.2;
}

// ---------------------------------------------------------------------------
// Archetype: quadruped
// ---------------------------------------------------------------------------

const QUAD_D = {
  bodyLen: 1.35, bodyR: 0.30, headR: 0.24, legLen: 0.55, legR: 0.075,
  neck: 0.22, neckUp: 0.30, headShape: 'wolf', tail: 0.55, tailUp: 0.3,
  mane: 0, hump: 0, spikes: 0, ears: 'point', horns: 0, glow: 0, wings: 0, wingSpan: 1.1,
  stride: 1, tusk: 0, shaggy: 0,
};

function buildQuadRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const legLen = H * P.legLen;
  const bodyLen = H * P.bodyLen;
  const bodyR = H * P.bodyR;
  const legR = H * P.legR;
  const bodyY = legLen + bodyR * 0.55;

  const body = grp(0, bodyY, 0);
  root.add(body);
  const torso = grp(0, 0, 0);
  body.add(torso);
  torso.add(box(bodyR * 1.7, bodyR * 1.55, bodyLen, C.body, { bulge: 0.14, taperZ: 1 }));
  if (P.hump) torso.add(sph(bodyR * 0.95, C.body, { y: bodyR * 0.6, z: bodyLen * 0.20, sy: 0.75, sz: 1.3 }));
  if (P.shaggy) {
    for (let i = 0; i < 10; i++) {
      const zz = rnd.float(-0.45, 0.45) * bodyLen;
      const s = rnd.bool() ? 1 : -1;
      torso.add(sph(bodyR * rnd.float(0.30, 0.5), mulHex(C.body, rnd.float(0.85, 1.1)),
        { x: s * bodyR * 0.8, z: zz, y: rnd.float(-0.4, 0.5) * bodyR, sy: 0.8 }));
    }
  }
  if (P.spikes) {
    for (let i = 0; i < 6; i++) {
      torso.add(cone(bodyR * 0.16, bodyR * (0.5 + 0.3 * Math.sin(i)), C.horn,
        { y: bodyR * 0.82, z: bodyLen * (0.32 - i * 0.13), rx: -0.25 }));
    }
  }

  // neck + head, thrust forward and up
  const neck = grp(0, bodyR * 0.45, bodyLen * 0.46);
  torso.add(neck);
  neck.rotation.x = -P.neckUp;
  const neckLen = H * P.neck;
  neck.add(box(bodyR * 0.95, bodyR * 0.95, neckLen, C.body, { z: neckLen * 0.5, taper: 0.85 }));
  if (P.mane) {
    for (let i = 0; i < 4; i++) neck.add(sph(bodyR * 0.45, C.hair, { z: neckLen * (0.1 + i * 0.25), y: bodyR * 0.4, sz: 0.7 }));
  }
  const head = grp(0, 0, neckLen);
  neck.add(head);
  head.rotation.x = P.neckUp * 0.8;
  const hp = { headR: P.headR * (bodyR / H) * 4.2, headShape: P.headShape, ears: P.ears, horns: P.horns, glow: P.glow };
  hp.headR = P.headR * 0.35;
  buildHead(head, H, { ...hp, headR: P.headR * 0.35 }, C);
  if (P.tusk) {
    for (const s of [-1, 1]) head.add(cone(H * 0.018, H * P.tusk, C.horn, { x: s * H * 0.045, y: H * 0.02, z: H * 0.075, rx: -2.5, rz: s * 0.2 }));
  }

  // legs: front pair and back pair
  const legs = {};
  for (const [fz, fk] of [[0.34, 'F'], [-0.34, 'B']]) {
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const hip = grp(s * bodyR * 0.75, -bodyR * 0.35, bodyLen * fz);
      body.add(hip);
      const th = legLen * 0.52, sh = legLen * 0.48;
      hip.add(box(legR * 2.2, th, legR * 2.2, C.body, { pivot: 'top', taper: 0.8 }));
      const knee = grp(0, -th, 0);
      hip.add(knee);
      knee.add(box(legR * 1.5, sh, legR * 1.5, C.skin2, { pivot: 'top', taper: 0.85 }));
      const foot = grp(0, -sh, 0);
      knee.add(foot);
      foot.add(box(legR * 1.9, legR * 1.0, legR * 2.6, C.horn, { y: legR * 0.45, z: legR * 0.5 }));
      knee.rotation.x = fk === 'F' ? -0.25 : 0.35;
      hip.rotation.x = fk === 'F' ? 0.10 : -0.22;
      legs['leg' + fk + key] = hip; legs['shin' + fk + key] = knee; legs['foot' + fk + key] = foot;
    }
  }

  // tail chain
  const tails = [];
  if (P.tail) {
    let parent = torso, py = bodyR * 0.3, pz = -bodyLen * 0.48;
    const seg = H * P.tail / 3;
    for (let i = 0; i < 3; i++) {
      const g = grp(0, i === 0 ? py : 0, i === 0 ? pz : -seg);
      parent.add(g);
      g.rotation.x = i === 0 ? -P.tailUp : 0.25;
      g.add(box(bodyR * (0.35 - i * 0.08), bodyR * (0.35 - i * 0.08), seg, C.skin2, { z: -seg * 0.5, taperZ: 1 }));
      tails.push(g);
      parent = g;
    }
    if (P.tailTuft) parent.add(sph(bodyR * 0.30, C.hair, { z: -seg }));
  }
  if (P.wings) {
    const span = H * P.wingSpan;
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const w = grp(s * bodyR * 0.7, bodyR * 0.62, bodyLen * 0.16);
      torso.add(w);
      w.add(makeWing(P.wings, span, C.wing, C.wing2, s));
      legs['wing' + key] = w;
    }
  }

  const rig = { root, body, torso, head, neck, tails, ...legs, arch: 'quad', b: { H, bodyY, stride: P.stride, wings: !!P.wings } };
  rig.snap = snapshot(root);
  return rig;
}

function poseQuad(r, action, t) {
  restore(r.snap);
  const H = r.b.H;
  const swing = (g, k, a) => { if (g) g.rotation.x += a * k; };
  switch (action) {
    case 'walk': {
      const p = t * PI * 2, sn = Math.sin(p), cs = Math.cos(p);
      const sw = 0.75 * r.b.stride;
      // diagonal gait: FL with BR, FR with BL
      r.legFL.rotation.x += -sn * sw; r.legBR.rotation.x += -sn * sw * 0.85;
      r.legFR.rotation.x += sn * sw; r.legBL.rotation.x += sn * sw * 0.85;
      r.shinFL.rotation.x += Math.max(0, Math.sin(p - 1.0)) * 0.8;
      r.shinFR.rotation.x += Math.max(0, Math.sin(p + PI - 1.0)) * 0.8;
      r.shinBL.rotation.x += Math.max(0, -Math.sin(p - 1.0)) * 0.9;
      r.shinBR.rotation.x += Math.max(0, -Math.sin(p + PI - 1.0)) * 0.9;
      r.body.position.y += Math.abs(cs) * H * 0.028 - H * 0.014;
      r.body.rotation.z += sn * 0.05;
      r.neck.rotation.x += Math.abs(sn) * 0.10 - 0.05;
      r.head.rotation.y += sn * 0.10;
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += sn * 0.25 * (i + 1);
      if (r.wingL) { r.wingL.rotation.z += sn * 0.8; r.wingR.rotation.z += -sn * 0.8; }
      break;
    }
    case 'attack': {
      let u, lunge;
      if (t < 0.35) { u = ez(t / 0.35); lunge = -u * 0.30; }
      else if (t < 0.55) { u = 1 - (t - 0.35) / 0.20; lunge = -0.30 + (1 - u) * 1.20; }
      else { u = 0; lunge = 0.90 * (1 - ez((t - 0.55) / 0.45)); }
      r.body.position.z += lunge * H * 0.16;
      r.body.rotation.x += -lunge * 0.22;
      r.neck.rotation.x += -0.45 * lunge - 0.25 * u;
      r.head.rotation.x += 0.7 * lunge;
      swing(r.legFL, 1, -0.8 * u); swing(r.legFR, 1, -0.8 * u);
      swing(r.shinFL, 1, 0.9 * u); swing(r.shinFR, 1, 0.9 * u);
      r.body.position.y += u * H * 0.05;
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.4;
      r.neck.rotation.x += -0.95 * u;
      r.head.rotation.x += -0.35 * u;
      r.body.position.y += u * H * 0.02;
      swing(r.legFL, 1, -0.25 * u); swing(r.legFR, 1, -0.25 * u);
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      r.body.position.z += -H * 0.05 * u;
      r.body.rotation.x += 0.2 * u;
      r.neck.rotation.x += 0.5 * u;
      r.head.rotation.x += 0.3 * u;
      break;
    }
    case 'die': case 'dead': {
      const e = (action === 'dead' ? 1 : ez(t)) ** 2;
      r.root.rotation.z += e * 1.45;
      r.body.position.y += -e * H * 0.22;
      r.neck.rotation.x += e * 0.5;
      r.head.rotation.x += e * 0.4;
      for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) if (r[k]) r[k].rotation.x += e * (k[3] === 'F' ? -0.6 : 0.6);
      for (const k of ['shinFL', 'shinFR', 'shinBL', 'shinBR']) if (r[k]) r[k].rotation.x += e * 0.9;
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.x += e * 0.4;
      break;
    }
    case 'bored': {
      // sniff the ground, shake, flick the tail
      const p = t * PI * 2, sw = Math.sin(p);
      const dip = Math.max(0, Math.sin(p - 0.6));
      r.neck.rotation.x += dip * 0.75;
      r.head.rotation.x += dip * 0.35;
      r.head.rotation.y += Math.sin(p * 2) * 0.30;
      r.body.rotation.z += sw * 0.07;
      r.body.position.y += -dip * H * 0.03;
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += Math.sin(p * 2 - i * 0.6) * 0.45;
      if (r.wingL) { r.wingL.rotation.z += Math.max(0, sw) * 0.5; r.wingR.rotation.z += -Math.max(0, sw) * 0.5; }
      break;
    }
    default: {
      const s = Math.sin(t * PI * 2);
      r.body.position.y += s * H * 0.008;
      r.neck.rotation.x += s * 0.05;
      r.head.rotation.y += s * 0.16;
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += s * 0.2 * (i + 1);
      if (r.wingL) { r.wingL.rotation.z += s * 0.12; r.wingR.rotation.z += -s * 0.12; }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Archetype: insectoid (6 or 8 legs)
// ---------------------------------------------------------------------------

const INSECT_D = {
  legs: 6, legLen: 0.55, legR: 0.028, bodyLen: 0.9, bodyR: 0.30, abdomen: 0.42,
  headR: 0.20, mandibles: 1, stinger: 0, claws: 0, antennae: 1, wings: 0, wingSpan: 0.9,
  carapace: 1, glow: 0, stride: 1,
};

function buildInsectRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const legLen = H * P.legLen;
  const bodyY = legLen * 0.62;
  const bodyR = H * P.bodyR;
  const bodyLen = H * P.bodyLen;

  const body = grp(0, bodyY, 0);
  root.add(body);
  const torso = grp(0, 0, 0);
  body.add(torso);
  torso.add(sph(bodyR, C.body, { sz: 1.25, sy: 0.85 }));
  const abR = H * P.abdomen;
  const abd = grp(0, 0, -bodyLen * 0.42);
  torso.add(abd);
  abd.add(sph(abR, C.body, { sz: 1.5, sy: 0.9, z: -abR * 0.5 }));
  if (P.carapace) {
    abd.add(sph(abR * 0.98, mulHex(C.body, 1.22), { sz: 1.5, sy: 0.55, y: abR * 0.35, z: -abR * 0.5 }));
    abd.add(box(abR * 0.06, abR * 0.7, abR * 2.4, mulHex(C.body, 0.55), { y: abR * 0.5, z: -abR * 0.5 }));
  }
  if (P.stinger) {
    const st = grp(0, abR * 0.2, -abR * 1.6);
    abd.add(st);
    st.rotation.x = -1.5;
    for (let i = 0; i < 3; i++) st.add(sph(abR * (0.30 - i * 0.06), C.body, { y: abR * (0.4 + i * 0.45) }));
    st.add(cone(abR * 0.16, abR * 0.7, C.horn, { y: abR * 1.9 }));
    root.userData.stinger = st;
  }

  const head = grp(0, bodyR * 0.15, bodyLen * 0.42);
  torso.add(head);
  buildHead(head, H, { headR: P.headR * 0.5, headShape: 'insect', glow: P.glow }, C);

  const legs = { legs: [], claws: [] };
  const n = P.legs / 2;
  for (let i = 0; i < n; i++) {
    const zf = (0.30 - i * (0.62 / Math.max(1, n - 1)));
    for (const s of [-1, 1]) {
      const hip = grp(s * bodyR * 0.82, bodyR * 0.15, bodyLen * zf);
      body.add(hip);
      hip.rotation.z = s * (1.05 + i * 0.05);
      hip.rotation.y = -s * (0.55 - i * 0.45);
      const up = legLen * 0.5, lo = legLen * 0.62;
      hip.add(box(H * P.legR * 2, up, H * P.legR * 2, C.body, { pivot: 'top', taper: 0.8 }));
      const knee = grp(0, -up, 0);
      hip.add(knee);
      knee.rotation.z = -s * 1.5;
      knee.add(box(H * P.legR * 1.4, lo, H * P.legR * 1.4, C.skin2, { pivot: 'top', taper: 0.35 }));
      legs.legs.push({ hip, knee, s, i });
    }
  }
  if (P.claws) {
    for (const s of [-1, 1]) {
      const arm = grp(s * bodyR * 0.75, bodyR * 0.1, bodyLen * 0.42);
      body.add(arm);
      arm.rotation.y = -s * 0.55;
      const al = H * 0.20;
      arm.add(box(H * 0.045, H * 0.045, al, C.body, { z: al * 0.5 }));
      const cl = grp(0, 0, al);
      arm.add(cl);
      cl.add(box(H * 0.075, H * 0.055, H * 0.16, C.body, { z: H * 0.07, taperZ: 0.6 }));
      cl.add(box(H * 0.022, H * 0.030, H * 0.13, mulHex(C.body, 1.15), { x: s * H * 0.022, z: H * 0.20, taperZ: 0.2 }));
      cl.add(box(H * 0.022, H * 0.030, H * 0.11, mulHex(C.body, 1.15), { x: -s * H * 0.020, z: H * 0.19, taperZ: 0.2 }));
      legs.claws.push(arm);
    }
  }
  if (P.wings) {
    const span = H * P.wingSpan;
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const w = grp(s * bodyR * 0.5, bodyR * 0.55, 0);
      torso.add(w);
      w.add(makeWing('insect', span, C.wing, C.wing2, s));
      legs['wing' + key] = w;
    }
  }

  const rig = { root, body, torso, head, abd, ...legs, arch: 'insect', b: { H, bodyY, stride: P.stride } };
  rig.snap = snapshot(root);
  return rig;
}

function poseInsect(r, action, t) {
  restore(r.snap);
  const H = r.b.H;
  switch (action) {
    case 'walk': {
      const p = t * PI * 2;
      for (const L of r.legs) {
        // alternating tripod: parity of (side, index) splits the legs
        const par = (L.i + (L.s > 0 ? 1 : 0)) % 2;
        const ph = p + par * PI;
        L.hip.rotation.y += Math.sin(ph) * 0.42;
        L.knee.rotation.x += Math.max(0, Math.sin(ph - 0.8)) * 0.55;
        L.hip.rotation.z += Math.max(0, Math.sin(ph - 0.8)) * 0.35 * L.s;
      }
      r.body.position.y += Math.abs(Math.sin(p * 2)) * H * 0.02;
      r.body.rotation.z += Math.sin(p) * 0.05;
      r.head.rotation.y += Math.sin(p) * 0.12;
      if (r.wingL) { r.wingL.rotation.z += Math.sin(p * 3) * 0.5; r.wingR.rotation.z += -Math.sin(p * 3) * 0.5; }
      break;
    }
    case 'attack': {
      const lunge = t < 0.4 ? -ez(t / 0.4) * 0.3 : t < 0.6 ? -0.3 + ez((t - 0.4) / 0.2) * 1.2 : 0.9 * (1 - ez((t - 0.6) / 0.4));
      r.body.position.z += lunge * H * 0.14;
      r.body.rotation.x += -lunge * 0.28;
      r.head.rotation.x += lunge * 0.35;
      for (const a of r.claws) { a.rotation.y += -a.rotation.y * 0 + (lunge * 0.5); a.rotation.x += -lunge * 0.6; }
      if (r.root.userData.stinger) r.root.userData.stinger.rotation.x += -lunge * 1.1;
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.4;
      r.body.position.y += u * H * 0.05;
      r.body.rotation.x += -u * 0.3;
      for (const a of r.claws) a.rotation.x += -u * 0.9;
      if (r.root.userData.stinger) r.root.userData.stinger.rotation.x += -u * 0.9;
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      r.body.position.z += -H * 0.05 * u;
      r.body.rotation.x += 0.25 * u;
      for (const L of r.legs) L.hip.rotation.z += L.s * 0.25 * u;
      break;
    }
    case 'die': case 'dead': {
      const e = (action === 'dead' ? 1 : ez(t)) ** 2;
      // on its back with the legs curled, the universal dead-bug pose
      r.root.rotation.z += e * 3.0;
      r.body.position.y += -e * H * 0.30;
      for (const L of r.legs) { L.hip.rotation.z += -L.s * 0.75 * e; L.knee.rotation.z += L.s * 1.1 * e; L.knee.rotation.x += e * 0.7; }
      for (const a of r.claws) a.rotation.x += e * 1.0;
      break;
    }
    case 'bored': {
      const p = t * PI * 2, s = Math.sin(p);
      r.body.position.y += Math.abs(Math.sin(p * 2)) * H * 0.03;
      r.body.rotation.z += s * 0.10;
      r.head.rotation.y += Math.sin(p * 2) * 0.35;
      for (const L of r.legs) { L.hip.rotation.y += Math.sin(p * 2 + L.i) * 0.22; L.knee.rotation.x += Math.max(0, Math.sin(p * 2 + L.i)) * 0.3; }
      if (r.root.userData.stinger) r.root.userData.stinger.rotation.x += -Math.max(0, s) * 0.5;
      for (const a of r.claws) a.rotation.x += -Math.max(0, Math.sin(p * 2)) * 0.4;
      break;
    }
    default: {
      const s = Math.sin(t * PI * 2);
      r.body.position.y += s * H * 0.008;
      r.head.rotation.y += s * 0.18;
      for (const L of r.legs) L.hip.rotation.y += s * 0.06 * (L.i % 2 ? 1 : -1);
      if (r.wingL) { r.wingL.rotation.z += s * 0.2; r.wingR.rotation.z += -s * 0.2; }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Archetype: serpent
// ---------------------------------------------------------------------------

const SERP_D = { coils: 9, coilR: 0.40, segs: 5, bodyR: 0.17, hood: 0, headR: 0.15, glow: 0, fangs: 1 };

function buildSerpentRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const coilR = H * P.coilR;
  const coil = grp(0, 0, 0);
  root.add(coil);
  for (let i = 0; i < P.coils; i++) {
    const t = i / P.coils;
    const a = t * PI * 2.2;
    const rr = coilR * (1 - t * 0.45);
    coil.add(sph(H * P.bodyR * (1 - t * 0.12), i % 2 ? C.body : mulHex(C.body, 0.85),
      { x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: H * (0.09 + t * 0.05), sy: 0.72, sz: 1.15 }));
  }

  // raised neck, a chain so it can sway and strike
  const segs = [];
  let parent = coil, py = H * 0.14, seg = H * 0.13;
  for (let i = 0; i < P.segs; i++) {
    const g = grp(0, i === 0 ? py : seg, 0);
    parent.add(g);
    g.rotation.x = i === 0 ? -0.2 : 0.06;
    g.add(box(H * P.bodyR * (1.5 - i * 0.13), seg, H * P.bodyR * (1.5 - i * 0.13), C.body, { pivot: 'bottom', taper: 0.9 }));
    segs.push(g);
    parent = g;
  }
  const head = grp(0, seg, 0);
  parent.add(head);
  head.rotation.x = 0.35;
  const hr = H * P.headR;
  head.add(sph(hr, C.skin, { y: hr * 0.6, sy: 0.75, sz: 1.5 }));
  head.add(box(hr * 1.2, hr * 0.5, hr * 1.4, mulHex(C.skin, 0.9), { y: hr * 0.42, z: hr * 1.35, taperZ: 0.6 }));
  for (const s of [-1, 1]) head.add(sph(hr * 0.22, P.glow ? C.glow : 0xd8b000, { x: s * hr * 0.5, y: hr * 0.95, z: hr * 0.6, emissive: P.glow ? 0.9 : 0 }));
  if (P.fangs) for (const s of [-1, 1]) head.add(cone(hr * 0.11, hr * 0.5, 0xf0e8d0, { x: s * hr * 0.3, y: hr * 0.1, z: hr * 1.7, rx: PI }));
  head.add(box(hr * 0.4, hr * 0.12, hr * 1.0, 0x201010, { y: hr * 0.05, z: hr * 1.7, taperZ: 0.3 }));
  if (P.hood) {
    const hood = grp(0, 0, 0);
    segs[segs.length - 1].add(hood);
    hood.add(plate(H * P.hood, H * P.hood * 0.85, C.skin2, { y: H * 0.03, taper: 0.55, thick: H * 0.012 }));
    hood.add(plate(H * P.hood * 0.6, H * P.hood * 0.5, mulHex(C.skin2, 1.3), { y: H * 0.03, z: H * 0.008, taper: 0.55, thick: H * 0.008 }));
  }

  const rig = { root, coil, segs, head, body: coil, torso: segs[0], arch: 'serpent', b: { H, bodyY: 0 } };
  rig.snap = snapshot(root);
  return rig;
}

function poseSerpent(r, action, t) {
  restore(r.snap);
  const H = r.b.H, n = r.segs.length;
  const wave = (amp, sp, ph) => {
    for (let i = 0; i < n; i++) r.segs[i].rotation.y += Math.sin(t * PI * 2 * sp + ph - i * 0.7) * amp;
  };
  switch (action) {
    case 'walk': {
      wave(0.22, 1, 0);
      r.coil.rotation.y += Math.sin(t * PI * 2) * 0.25;
      r.head.rotation.y += Math.sin(t * PI * 2 - 3) * 0.3;
      r.root.position.y += Math.abs(Math.sin(t * PI * 2)) * H * 0.02;
      break;
    }
    case 'attack': {
      const u = t < 0.35 ? -ez(t / 0.35) : t < 0.55 ? -1 + ez((t - 0.35) / 0.2) * 2.4 : 1.4 * (1 - ez((t - 0.55) / 0.45));
      for (let i = 0; i < n; i++) r.segs[i].rotation.x += u * (0.30 - i * 0.02);
      r.head.rotation.x += u * 0.5;
      r.root.position.z += Math.max(0, u) * H * 0.10;
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.4;
      for (let i = 0; i < n; i++) r.segs[i].rotation.x += -u * 0.16;
      r.head.rotation.x += -u * 0.7;
      wave(0.10 * u, 4, 0);
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      for (let i = 0; i < n; i++) r.segs[i].rotation.x += u * 0.22;
      r.head.rotation.x += u * 0.4;
      r.root.position.z += -H * 0.03 * u;
      break;
    }
    case 'die': case 'dead': {
      const e = (action === 'dead' ? 1 : ez(t)) ** 2;
      for (let i = 0; i < n; i++) { r.segs[i].rotation.x += e * 0.55; r.segs[i].rotation.z += e * 0.25; }
      r.head.rotation.x += e * 0.9;
      r.root.scale.y *= 1 - e * 0.45;
      r.coil.scale.set(1 + e * 0.25, 1, 1 + e * 0.25);
      break;
    }
    case 'bored': {
      // tongue-flick sway: bigger amplitude than stand, plus a head dip
      wave(0.30, 1, 0);
      r.head.rotation.y += Math.sin(t * PI * 2 - 1.5) * 0.55;
      r.head.rotation.x += Math.sin(t * PI * 4) * 0.22;
      r.segs[0].rotation.x += Math.sin(t * PI * 2) * 0.14;
      r.coil.rotation.y += Math.sin(t * PI * 2) * 0.35;
      break;
    }
    default: {
      wave(0.10, 1, 0);
      r.head.rotation.y += Math.sin(t * PI * 2 - 2) * 0.16;
      r.segs[0].rotation.x += Math.sin(t * PI * 2) * 0.05;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Archetype: blob (slimes, oozes, elementals)
// ---------------------------------------------------------------------------

const BLOB_D = { lobes: 5, wide: 0.62, drip: 1, core: 0, flame: 0, glow: 0, arms: 0 };

function buildBlobRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const body = grp(0, 0, 0);
  root.add(body);
  const lobes = [];
  const n = P.lobes;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const g = grp(Math.sin(i * 2.1) * H * 0.05, H * (0.10 + t * 0.78), Math.cos(i * 1.7) * H * 0.035);
    body.add(g);
    const rr = H * P.wide * (P.flame ? (0.58 - t * 0.42) : (0.58 - t * 0.30)) * (1 + 0.16 * Math.sin(i * 2.3));
    g.add(sph(rr, i % 2 ? C.body : mulHex(C.body, 1.18), {
      sy: P.flame ? 1.30 : 0.85, sx: 1 + rnd.float(-0.16, 0.16), sz: 1 + rnd.float(-0.16, 0.16),
      ry: rnd.float(0, PI), emissive: P.glow,
    }));
    lobes.push(g);
  }
  if (P.flame) {
    // tongues licking off the crown: without them a flame column is a cone
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + 0.5;
      body.add(cone(H * 0.055, H * rnd.float(0.16, 0.30), mulHex(C.glow, 1.0), {
        x: Math.cos(a) * H * P.wide * 0.20, z: Math.sin(a) * H * P.wide * 0.20,
        y: H * rnd.float(0.80, 0.95), rz: -Math.cos(a) * 0.35, rx: Math.sin(a) * 0.35,
        emissive: Math.max(0.5, P.glow), seg: 5,
      }));
    }
  }
  if (P.core) {
    body.add(sph(H * 0.13, C.glow, { y: H * 0.48, emissive: 1 }));
  }
  if (P.drip) {
    for (let i = 0; i < 5; i++) {
      const a = rnd.float(0, PI * 2);
      body.add(sph(H * rnd.float(0.03, 0.06), mulHex(C.body, 0.85),
        { x: Math.cos(a) * H * P.wide * 0.42, z: Math.sin(a) * H * P.wide * 0.42, y: H * rnd.float(0.02, 0.16), emissive: P.glow }));
    }
  }
  const arms = [];
  if (P.arms) {
    for (const s of [-1, 1]) {
      const g = grp(s * H * P.wide * 0.45, H * 0.55, 0);
      body.add(g);
      g.rotation.z = s * 0.7;
      g.add(box(H * 0.13, H * 0.40, H * 0.13, mulHex(C.body, 1.1), { pivot: 'top', taper: 0.55, emissive: P.glow }));
      const f = grp(0, -H * 0.40, 0);
      g.add(f);
      f.add(sph(H * 0.10, C.body, { emissive: P.glow }));
      for (let k = -1; k <= 1; k++) f.add(cone(H * 0.030, H * 0.11, mulHex(C.body, 1.2), { x: k * H * 0.05, y: -H * 0.08, rx: PI, emissive: P.glow }));
      arms.push(g);
    }
  }
  // eyes make an amorphous shape read as a creature immediately
  if (P.eyes !== 0) {
    for (const s of [-1, 1]) body.add(sph(H * 0.035, P.glow ? 0x101014 : C.glow, { x: s * H * 0.10, y: H * 0.55, z: H * P.wide * 0.34, emissive: P.glow ? 0 : 0.8 }));
  }

  const rig = { root, body, lobes, arms, torso: body, head: lobes[lobes.length - 1], arch: 'blob', b: { H, bodyY: 0 } };
  rig.snap = snapshot(root);
  return rig;
}

function poseBlob(r, action, t) {
  restore(r.snap);
  const H = r.b.H, n = r.lobes.length;
  const wob = (amp, sp) => {
    for (let i = 0; i < n; i++) {
      const ph = t * PI * 2 * sp - i * 0.9;
      r.lobes[i].position.x += Math.sin(ph) * H * amp;
      r.lobes[i].scale.set(1 + Math.sin(ph) * amp * 1.6, 1 - Math.sin(ph) * amp * 1.6, 1 + Math.cos(ph) * amp * 1.2);
    }
  };
  switch (action) {
    case 'walk': {
      wob(0.05, 1);
      r.body.position.y += Math.abs(Math.sin(t * PI * 2)) * H * 0.07;
      r.body.position.z += 0;
      for (const a of r.arms) a.rotation.x += Math.sin(t * PI * 2) * 0.5 * (a.position.x < 0 ? 1 : -1);
      break;
    }
    case 'attack': {
      const u = t < 0.4 ? -ez(t / 0.4) * 0.4 : t < 0.6 ? -0.4 + ez((t - 0.4) / 0.2) * 1.6 : 1.2 * (1 - ez((t - 0.6) / 0.4));
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        r.lobes[i].position.z += u * H * 0.20 * k;
        r.lobes[i].scale.set(1 - u * 0.10 * k, 1 - u * 0.12 * k, 1 + u * 0.35 * k);
      }
      for (const a of r.arms) a.rotation.x += -u * 1.3;
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.4;
      r.body.position.y += u * H * 0.10;
      for (let i = 0; i < n; i++) r.lobes[i].scale.set(1 - u * 0.12, 1 + u * 0.22, 1 - u * 0.12);
      for (const a of r.arms) a.rotation.x += -u * 2.0;
      wob(0.02, 6);
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      for (let i = 0; i < n; i++) r.lobes[i].scale.set(1 + u * 0.22, 1 - u * 0.28, 1 + u * 0.22);
      r.body.position.z += -H * 0.03 * u;
      break;
    }
    case 'die': case 'dead': {
      const e = action === 'dead' ? 1 : ez(t);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        r.lobes[i].position.y -= e * H * (0.08 + k * 0.72);
        r.lobes[i].scale.set(1 + e * (0.5 + k * 0.9), 1 - e * 0.82, 1 + e * (0.5 + k * 0.9));
      }
      for (const a of r.arms) { a.rotation.z += (a.position.x < 0 ? -1 : 1) * e * 0.9; a.position.y -= e * H * 0.45; }
      break;
    }
    case 'bored': {
      wob(0.075, 1);
      r.body.position.y += Math.abs(Math.sin(t * PI * 2)) * H * 0.045;
      r.body.rotation.z += Math.sin(t * PI * 2) * 0.10;
      for (const a of r.arms) a.rotation.x += Math.sin(t * PI * 4) * 0.5;
      break;
    }
    default: {
      wob(0.028, 1);
      r.body.position.y += Math.sin(t * PI * 2) * H * 0.012;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Archetype: dragon (also hydra, wyvern, griffin, roc)
// ---------------------------------------------------------------------------

const DRAGON_D = {
  bodyLen: 1.25, bodyR: 0.26, legLen: 0.40, legR: 0.065, neck: 0.62, necks: 1,
  tail: 0.95, wings: 'dragon', wingSpan: 1.05, headR: 0.16, headShape: 'dragon',
  frontLegs: 1, spikes: 1, glow: 1, stride: 1,
};

function buildDragonRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const legLen = H * P.legLen;
  const bodyR = H * P.bodyR;
  const bodyLen = H * P.bodyLen;
  // Wyrms and sea serpents have no legs at all; they rest their bulk on the
  // ground and undulate.
  const bodyY = P.legless ? bodyR * 0.80 : legLen + bodyR * 0.7;

  const body = grp(0, bodyY, 0);
  root.add(body);
  const torso = grp(0, 0, 0);
  body.add(torso);
  torso.add(sph(bodyR, C.body, { sz: bodyLen / (2 * bodyR), sy: 0.92 }));
  torso.add(sph(bodyR * 0.86, mulHex(C.body, 0.85), { y: -bodyR * 0.35, z: 0, sz: bodyLen / (2 * bodyR) * 0.9, sy: 0.6 }));
  if (P.spikes) {
    for (let i = 0; i < 7; i++) {
      const z = bodyLen * (0.42 - i * 0.14);
      torso.add(cone(bodyR * 0.13, bodyR * (0.55 - Math.abs(i - 3) * 0.07), C.horn, { y: bodyR * 0.88, z, rx: -0.2 }));
    }
  }

  // necks (hydra gets several)
  const necks = [], heads = [];
  for (let k = 0; k < P.necks; k++) {
    const off = P.necks === 1 ? 0 : (k - (P.necks - 1) / 2);
    let parent = torso;
    const chain = [];
    const seg = H * P.neck / 3;
    for (let i = 0; i < 3; i++) {
      const g = grp(i === 0 ? off * bodyR * 0.85 : 0, i === 0 ? bodyR * 0.55 : 0, i === 0 ? bodyLen * 0.40 : seg);
      parent.add(g);
      g.rotation.x = i === 0 ? -1.30 : 0.34;
      g.rotation.y = i === 0 ? off * 0.60 : off * 0.10;
      g.rotation.z = i === 0 ? -off * 0.30 : 0;
      g.add(box(bodyR * (0.72 - i * 0.13), seg, bodyR * (0.72 - i * 0.13), C.body, { pivot: 'bottom', taper: 0.85 }));
      chain.push(g);
      parent = g;
    }
    const head = grp(0, seg, 0);
    parent.add(head);
    head.rotation.x = 0.60;
    buildHead(head, H, { headR: P.headR, headShape: P.headShape, horns: P.horns || 0, glow: P.glow }, C);
    necks.push(chain);
    heads.push(head);
  }

  // legs
  const legs = {};
  const pairs = P.legless ? [] : P.frontLegs ? [[0.30, 'F'], [-0.30, 'B']] : [[-0.20, 'B']];
  for (const [fz, fk] of pairs) {
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const hip = grp(s * bodyR * 0.78, -bodyR * 0.32, bodyLen * fz);
      body.add(hip);
      const th = legLen * 0.5, sh = legLen * 0.5;
      hip.add(box(H * P.legR * 2.4, th, H * P.legR * 2.4, C.body, { pivot: 'top', taper: 0.75 }));
      const knee = grp(0, -th, 0);
      hip.add(knee);
      knee.add(box(H * P.legR * 1.7, sh, H * P.legR * 1.7, C.skin2, { pivot: 'top', taper: 0.8 }));
      const foot = grp(0, -sh, 0);
      knee.add(foot);
      foot.add(box(H * P.legR * 2.4, H * P.legR * 1.0, H * P.legR * 3.2, C.skin2, { y: H * P.legR * 0.5, z: H * P.legR * 0.9 }));
      for (let i = -1; i <= 1; i++) foot.add(cone(H * 0.012, H * 0.045, C.horn, { x: i * H * P.legR * 0.8, y: H * P.legR * 0.2, z: H * P.legR * 2.5, rx: 1.9 }));
      hip.rotation.x = fk === 'F' ? 0.25 : -0.30;
      knee.rotation.x = fk === 'F' ? -0.55 : 0.6;
      legs['leg' + fk + key] = hip; legs['shin' + fk + key] = knee; legs['foot' + fk + key] = foot;
    }
  }

  // tail
  const tails = [];
  {
    let parent = torso;
    const seg = H * P.tail / 4;
    for (let i = 0; i < 4; i++) {
      const g = grp(0, i === 0 ? bodyR * 0.2 : 0, i === 0 ? -bodyLen * 0.44 : -seg);
      parent.add(g);
      g.rotation.x = i === 0 ? -0.15 : 0.16;
      g.add(box(bodyR * (0.55 - i * 0.11), bodyR * (0.55 - i * 0.11), seg, C.body, { z: -seg * 0.5, taper: 1 }));
      if (P.spikes && i < 3) g.add(cone(bodyR * 0.08, bodyR * 0.24, C.horn, { y: bodyR * 0.3, z: -seg * 0.5, rx: -0.2 }));
      tails.push(g);
      parent = g;
    }
    if (P.tailFin) parent.add(plate(bodyR * 0.1, bodyR * 0.8, C.horn, { z: -seg * 0.9, thick: bodyR * 0.6 }));
  }

  if (P.wings) {
    const span = H * P.wingSpan;
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const w = grp(s * bodyR * 0.65, bodyR * 0.72, bodyLen * 0.12);
      torso.add(w);
      w.rotation.z = s * 0.15;
      w.add(makeWing(P.wings, span, C.wing, C.wing2, s));
      legs['wing' + key] = w;
    }
  }

  const rig = {
    root, body, torso, necks, heads, tails, ...legs,
    head: heads[0], arch: 'dragon',
    b: { H, bodyY, stride: P.stride, front: !!P.frontLegs },
  };
  rig.snap = snapshot(root);
  return rig;
}

function poseDragon(r, action, t) {
  restore(r.snap);
  const H = r.b.H;
  const allNecks = (fn) => { for (let k = 0; k < r.necks.length; k++) for (let i = 0; i < r.necks[k].length; i++) fn(r.necks[k][i], i, k); };
  switch (action) {
    case 'walk': {
      const p = t * PI * 2, sn = Math.sin(p), cs = Math.cos(p);
      if (r.legFL) {
        r.legFL.rotation.x += -sn * 0.55; r.legBR.rotation.x += -sn * 0.5;
        r.legFR.rotation.x += sn * 0.55; r.legBL.rotation.x += sn * 0.5;
        r.shinFL.rotation.x += Math.max(0, Math.sin(p - 1)) * 0.6;
        r.shinFR.rotation.x += Math.max(0, -Math.sin(p - 1)) * 0.6;
      } else if (r.legBL) {
        r.legBL.rotation.x += -sn * 0.5; r.legBR.rotation.x += sn * 0.5;
      } else {
        // legless: the whole body slithers
        r.body.position.x += sn * H * 0.02;
        r.body.rotation.y += sn * 0.10;
      }
      r.body.position.y += Math.abs(cs) * H * 0.02 - H * 0.01;
      r.body.rotation.z += sn * 0.05;
      allNecks((g, i, k) => { g.rotation.y += Math.sin(p + k - i * 0.5) * 0.12; g.rotation.x += Math.sin(p * 2) * 0.03; });
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += sn * 0.16 * (i + 1);
      if (r.wingL) { r.wingL.rotation.z += Math.sin(p) * 0.45; r.wingR.rotation.z += -Math.sin(p) * 0.45; }
      break;
    }
    case 'attack': {
      const u = t < 0.38 ? -ez(t / 0.38) : t < 0.58 ? -1 + ez((t - 0.38) / 0.2) * 2.2 : 1.2 * (1 - ez((t - 0.58) / 0.42));
      allNecks((g, i) => { g.rotation.x += u * (0.34 - i * 0.04); });
      for (const h of r.heads) h.rotation.x += u * 0.45;
      r.body.position.z += Math.max(0, u) * H * 0.08;
      r.body.rotation.x += -u * 0.10;
      if (r.wingL) { r.wingL.rotation.z += -Math.max(0, -u) * 0.9; r.wingR.rotation.z += Math.max(0, -u) * 0.9; }
      if (r.legFL) { r.legFL.rotation.x += -Math.max(0, -u) * 0.8; r.legFR.rotation.x += -Math.max(0, -u) * 0.8; }
      break;
    }
    case 'cast': {
      // rear back and breathe: neck arcs up then whips forward
      const u = t < 0.55 ? ez(t / 0.55) : 1 - ez((t - 0.55) / 0.45) * 0.5;
      allNecks((g, i) => { g.rotation.x += -u * (0.42 - i * 0.06); });
      for (const h of r.heads) h.rotation.x += -u * 0.5;
      r.body.rotation.x += -u * 0.18;
      r.body.position.y += u * H * 0.03;
      if (r.wingL) { r.wingL.rotation.z += -u * 0.7; r.wingR.rotation.z += u * 0.7; }
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      allNecks((g) => { g.rotation.x += u * 0.22; });
      r.body.position.z += -H * 0.04 * u;
      r.body.rotation.x += 0.12 * u;
      break;
    }
    case 'die': case 'dead': {
      const e = (action === 'dead' ? 1 : ez(t)) ** 2;
      r.root.rotation.z += e * 1.3;
      r.body.position.y += -e * H * 0.20;
      allNecks((g, i) => { g.rotation.x += e * (0.5 - i * 0.1); g.rotation.z += e * 0.2; });
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += e * 0.3;
      if (r.wingL) { r.wingL.rotation.z += e * 1.0; r.wingR.rotation.z += -e * 1.0; }
      break;
    }
    case 'bored': {
      const p = t * PI * 2, s = Math.sin(p);
      allNecks((g, i, k) => { g.rotation.y += Math.sin(p + k * 1.7 - i * 0.5) * 0.30; g.rotation.x += Math.sin(p * 2) * 0.10; });
      for (const h of r.heads) { h.rotation.y += Math.sin(p * 2) * 0.4; h.rotation.x += Math.sin(p * 2 + 1) * 0.2; }
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += Math.sin(p - i * 0.5) * 0.35;
      if (r.wingL) { r.wingL.rotation.z += Math.max(0, s) * 0.85; r.wingR.rotation.z += -Math.max(0, s) * 0.85; }
      r.body.position.y += Math.abs(s) * H * 0.012;
      break;
    }
    default: {
      const s = Math.sin(t * PI * 2);
      r.body.position.y += s * H * 0.008;
      allNecks((g, i, k) => { g.rotation.y += s * 0.07 * (k + 1); });
      for (const h of r.heads) h.rotation.y += s * 0.12;
      for (let i = 0; i < r.tails.length; i++) r.tails[i].rotation.y += s * 0.12 * (i + 1);
      if (r.wingL) { r.wingL.rotation.z += s * 0.18; r.wingR.rotation.z += -s * 0.18; }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Archetype: wisp (floating light) and ghost (legless humanoid)
// ---------------------------------------------------------------------------

function buildWispRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const body = grp(0, H * 0.55, 0);
  root.add(body);
  body.add(sph(H * 0.24, C.glow, { emissive: 1, detail: 1 }));
  body.add(sph(H * 0.34, C.body, { emissive: 0.55 }));
  const motes = [];
  for (let i = 0; i < 5; i++) {
    const g = grp(0, 0, 0);
    g.rotation.y = (i / 5) * PI * 2;
    g.rotation.z = rnd.float(-0.5, 0.5);
    const m = sph(H * rnd.float(0.05, 0.09), C.glow, { x: H * rnd.float(0.36, 0.52), emissive: 1 });
    g.add(m);
    body.add(g);
    motes.push(g);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    body.add(box(H * 0.03, H * 0.34, H * 0.03, C.body, { x: Math.cos(a) * H * 0.16, z: Math.sin(a) * H * 0.16, y: -H * 0.22, taper: 0.1, emissive: 0.5 }));
  }
  const rig = { root, body, torso: body, head: body, motes, arch: 'wisp', b: { H, bodyY: H * 0.55 } };
  rig.snap = snapshot(root);
  return rig;
}

function poseWisp(r, action, t) {
  restore(r.snap);
  const H = r.b.H;
  const spin = t * PI * 2;
  for (let i = 0; i < r.motes.length; i++) r.motes[i].rotation.y += spin + i;
  switch (action) {
    case 'walk': r.body.position.y += Math.sin(spin) * H * 0.06; r.body.position.x += Math.cos(spin) * H * 0.03; break;
    case 'attack': {
      const u = t < 0.4 ? ez(t / 0.4) : 1 - ez((t - 0.4) / 0.6);
      r.body.scale.setScalar(1 + u * 0.45);
      r.body.position.z += u * H * 0.12;
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.5;
      r.body.scale.setScalar(1 + u * 0.30);
      r.body.position.y += u * H * 0.08;
      break;
    }
    case 'hit': r.body.scale.setScalar(1 - (t < 0.5 ? t * 2 : 2 - t * 2) * 0.3); break;
    case 'die': case 'dead': {
      const e = action === 'dead' ? 1 : ez(t);
      r.body.scale.setScalar(Math.max(0.03, 1 - e * 0.97));
      r.body.position.y -= e * H * 0.25;
      break;
    }
    case 'bored':
      r.body.position.y += Math.sin(spin) * H * 0.07;
      r.body.position.x += Math.sin(spin * 2) * H * 0.05;
      r.body.scale.setScalar(1 + Math.sin(spin * 3) * 0.12);
      break;
    default: r.body.position.y += Math.sin(spin) * H * 0.02; r.body.scale.setScalar(1 + Math.sin(spin * 2) * 0.05); break;
  }
}

// ---------------------------------------------------------------------------
// Archetype: floating eye (Beholder family) and static machine (Reactor)
// ---------------------------------------------------------------------------

function buildEyeRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const body = grp(0, H * 0.52, 0);
  root.add(body);
  const R = H * 0.34;
  body.add(sph(R, C.body, { detail: 1, sy: 0.94 }));
  // one huge iris facing forward - the whole silhouette hangs off this
  body.add(sph(R * 0.62, C.skin, { z: R * 0.62, sz: 0.55, detail: 1 }));
  body.add(sph(R * 0.36, C.glow, { z: R * 0.92, sz: 0.4, emissive: 0.5, detail: 1 }));
  body.add(sph(R * 0.16, 0x08080c, { z: R * 1.02, sz: 0.4 }));
  const lids = [];
  for (const s of [-1, 1]) {
    const l = sph(R * 0.72, mulHex(C.body, 0.8), { z: R * 0.55, y: s * R * 0.52, sz: 0.45, sy: 0.55 });
    body.add(l);
    lids.push(l);
  }
  const stalks = [];
  const n = P.stalks === undefined ? 5 : P.stalks;
  for (let i = 0; i < n; i++) {
    const a = -0.9 + (i / Math.max(1, n - 1)) * 1.8;
    const g = grp(Math.sin(a) * R * 0.55, R * 0.72, -Math.cos(a) * R * 0.25);
    g.rotation.z = -Math.sin(a) * 0.8;
    g.rotation.x = -0.25;
    body.add(g);
    const len = H * 0.30 * (0.7 + 0.3 * Math.cos(a));
    g.add(box(H * 0.035, len, H * 0.035, C.skin2, { pivot: 'bottom', taper: 0.6 }));
    const tip = grp(0, len, 0);
    g.add(tip);
    tip.add(sph(H * 0.055, C.body, {}));
    tip.add(sph(H * 0.032, C.glow, { z: H * 0.04, emissive: 0.7 }));
    stalks.push(g);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    body.add(box(H * 0.028, H * 0.16, H * 0.028, C.skin2,
      { pivot: 'top', x: Math.cos(a) * R * 0.5, z: Math.sin(a) * R * 0.5, y: -R * 0.75, taper: 0.2 }));
  }
  const rig = { root, body, torso: body, head: body, stalks, lids, arch: 'eye', b: { H, bodyY: H * 0.52 } };
  rig.snap = snapshot(root);
  return rig;
}

function poseEye(r, action, t) {
  restore(r.snap);
  const H = r.b.H, p = t * PI * 2;
  const stalkWave = (amp, sp) => {
    for (let i = 0; i < r.stalks.length; i++) {
      r.stalks[i].rotation.x += Math.sin(p * sp - i * 0.8) * amp;
      r.stalks[i].rotation.z += Math.cos(p * sp - i * 0.8) * amp * 0.6;
    }
  };
  switch (action) {
    case 'walk':
      r.body.position.y += Math.sin(p) * H * 0.045;
      r.body.rotation.z += Math.sin(p) * 0.08;
      stalkWave(0.28, 1);
      break;
    case 'attack': {
      const u = t < 0.4 ? -ez(t / 0.4) * 0.5 : t < 0.6 ? -0.5 + ez((t - 0.4) / 0.2) * 1.7 : 1.2 * (1 - ez((t - 0.6) / 0.4));
      r.body.position.z += u * H * 0.14;
      r.body.scale.set(1 - u * 0.06, 1 - u * 0.06, 1 + u * 0.14);
      stalkWave(0.18, 3);
      break;
    }
    case 'cast': {
      const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5) * 0.5;
      r.body.position.y += u * H * 0.07;
      for (let i = 0; i < r.stalks.length; i++) r.stalks[i].rotation.x += -u * 0.75;
      for (const l of r.lids) l.position.y *= 1 + u * 0.5;
      break;
    }
    case 'hit': {
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      r.body.scale.set(1 + u * 0.18, 1 - u * 0.2, 1 + u * 0.18);
      r.body.position.z += -H * 0.04 * u;
      stalkWave(0.4 * u, 5);
      break;
    }
    case 'die': case 'dead': {
      const e = action === 'dead' ? 1 : ez(t);
      r.body.position.y -= e * H * 0.44;
      r.body.scale.set(1 + e * 0.35, 1 - e * 0.62, 1 + e * 0.35);
      for (let i = 0; i < r.stalks.length; i++) { r.stalks[i].rotation.x += e * 1.4; r.stalks[i].rotation.z += (i - 2) * e * 0.4; }
      for (const l of r.lids) l.position.y *= 1 - e * 0.85;
      break;
    }
    case 'bored':
      r.body.position.y += Math.sin(p) * H * 0.03;
      r.body.rotation.y += Math.sin(p) * 0.35;
      stalkWave(0.35, 2);
      for (const l of r.lids) l.position.y *= 1 - Math.max(0, Math.sin(p * 2)) * 0.55;
      break;
    default:
      r.body.position.y += Math.sin(p) * H * 0.018;
      stalkWave(0.12, 1);
      break;
  }
}

function buildMachineRig(H, P, C, rnd) {
  const root = new THREE.Group();
  const body = grp(0, 0, 0);
  root.add(body);
  body.add(box(H * 0.85, H * 0.14, H * 0.85, mulHex(C.metal, 0.7), { pivot: 'bottom' }));
  body.add(cyl(H * 0.30, H * 0.38, H * 0.72, C.metal, { seg: 9, pivot: 'bottom', y: H * 0.14 }));
  const core = grp(0, H * 0.86, 0);
  body.add(core);
  core.add(cyl(H * 0.24, H * 0.24, H * 0.02, mulHex(C.metal, 1.3), { seg: 9 }));
  core.add(sph(H * 0.22, C.glow, { y: H * 0.22, emissive: 1, detail: 1 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    core.add(box(H * 0.07, H * 0.55, H * 0.07, C.metal,
      { pivot: 'bottom', x: Math.cos(a) * H * 0.30, z: Math.sin(a) * H * 0.30, rz: -Math.cos(a) * 0.22, rx: Math.sin(a) * 0.22 }));
  }
  body.add(cyl(H * 0.20, H * 0.26, H * 0.16, mulHex(C.metal, 1.15), { seg: 9, y: H * 1.36 }));
  for (let i = 0; i < 3; i++) {
    body.add(box(H * 0.90, H * 0.05, H * 0.90, mulHex(C.metal, 1.2 - i * 0.15), { y: H * (0.24 + i * 0.24) }));
  }
  for (const s of [-1, 1]) {
    body.add(box(H * 0.10, H * 0.60, H * 0.10, mulHex(C.metal, 0.85), { pivot: 'bottom', x: s * H * 0.44, y: H * 0.14 }));
    body.add(sph(H * 0.07, C.glow, { x: s * H * 0.44, y: H * 0.78, emissive: 0.9 }));
  }
  const rig = { root, body, torso: body, head: core, core, arch: 'machine', b: { H, bodyY: 0 } };
  rig.snap = snapshot(root);
  return rig;
}

function poseMachine(r, action, t) {
  restore(r.snap);
  const p = t * PI * 2;
  const pulse = 1 + Math.sin(p) * 0.09;
  r.core.scale.setScalar(pulse);
  r.core.rotation.y += p * 0.5;
  if (action === 'die' || action === 'dead') {
    const e = action === 'dead' ? 1 : ez(t);
    r.core.scale.setScalar(Math.max(0.05, 1 - e * 0.95));
    r.body.rotation.z += e * 0.12;
    r.body.position.y -= e * r.b.H * 0.06;
  } else if (action === 'attack' || action === 'cast') {
    const u = t < 0.5 ? ez(t / 0.5) : 1 - ez((t - 0.5) / 0.5);
    r.core.scale.setScalar(1 + u * 0.5);
  } else if (action === 'hit') {
    r.body.rotation.z += (t < 0.5 ? t * 2 : 2 - t * 2) * 0.05;
  }
}

function buildGhostRig(H, P, C, rnd) {
  const rig = buildBipedRig(H, { ...BIPED_D, ...P, lower: 'none', boots: 0 }, C, rnd);
  return rig;
}

// ---------------------------------------------------------------------------
// Colour resolution
// ---------------------------------------------------------------------------

function rc(spec, fb) { return spec ? rampHex(spec[0], spec[1]) : fb; }

function resolveCols(p = {}) {
  const skin = rc(p.skin, rampHex('flesh', 4));
  const cloth = rc(p.cloth, rampHex('dirt', 6));
  const C = {
    skin,
    skin2: rc(p.skin2, mulHex(skin, 0.78)),
    body: rc(p.body, skin),
    cloth,
    cloth2: rc(p.cloth2, mulHex(cloth, 0.7)),
    metal: rc(p.metal, rampHex('stone', 9)),
    wood: rc(p.wood, rampHex('wood', 6)),
    hair: rc(p.hair, rampHex('wood', 4)),
    horn: rc(p.horn, rampHex('sand', 11)),
    eye: rc(p.eye, 0x0b0b0f),
    glow: rc(p.glow, rampHex('arcane', 6)),
    wing: rc(p.wing, mulHex(skin, 0.85)),
    wing2: rc(p.wing2, mulHex(skin, 0.6)),
    trouser: rc(p.trouser, mulHex(cloth, 0.62)),
    boot: rc(p.boot, mulHex(rc(p.wood, rampHex('wood', 6)), 0.55)),
  };
  return C;
}
// ---------------------------------------------------------------------------
// Animation groups
//
// MM6 stores exactly eight sprite groups per monster (MonsterDesc_MM6
// .spriteNames[8]) and plays them at SFTItem.Time = 4, i.e. 125 ms a frame -
// 8 fps. That stop-motion cadence is a big part of why the game reads as 1998,
// so the frame counts and rates here are the engine's, not ours.
// ---------------------------------------------------------------------------

export const ACTIONS = {
  stand: { frames: 2, loop: true, fps: 8 },
  walk: { frames: 6, loop: true, fps: 8 },
  attack_melee: { frames: 4, loop: false, fps: 8 },
  attack_ranged: { frames: 4, loop: false, fps: 8 },
  got_hit: { frames: 2, loop: false, fps: 8 },
  dying: { frames: 6, loop: false, fps: 10 },
  dead: { frames: 1, loop: false, fps: 1 },
  bored: { frames: 6, loop: true, fps: 8 },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

// The pose functions were written against short internal names; this keeps the
// public API on the engine's ActorAnimation vocabulary without renaming the
// animation code underneath.
const ACTION_INTERNAL = {
  stand: 'stand', walk: 'walk', attack_melee: 'attack', attack_ranged: 'cast',
  got_hit: 'hit', dying: 'die', dead: 'dead', bored: 'bored',
};

// ---------------------------------------------------------------------------
// The bestiary: 57 families x 3 tiers + 2 uniques = 173 monsters.
//
// MM6 has no per-monster tint - MonsterDesc_MM6 has no tintColor field at all.
// Tiers of a family are literally the same art with a different palette file,
// so that is how this is modelled: one builder per family, and a tier is a
// palette override plus a small scale factor.
// ---------------------------------------------------------------------------

const FAMILY_LIST = [];

/**
 * @param {string} id      sprite base name, e.g. 'Goblin'
 * @param {string} arch    archetype key
 * @param {number} height  world height in units (spec 15: humanoid ~192)
 * @param {object} pal     base palette
 * @param {object} params  archetype parameters
 * @param {Array}  tiers   [displayName, level, hp, paletteShift?, scale?]
 * @param {object} extra   { ranged, flying, aspect, suffixes }
 */
function F(id, arch, height, pal, params, tiers, extra = {}) {
  const fam = {
    id, arch, height, palette: pal, params,
    ranged: !!extra.ranged, flying: !!extra.flying,
    aspect: extra.aspect || 0,
    suffixes: extra.suffixes || ['A', 'B', 'C'],
    tiers: tiers.map((t, i) => ({
      name: t[0], level: t[1] || 1, hp: t[2] || 1,
      paletteShift: t[3] || {}, scale: t[4] === undefined ? 1 + i * 0.06 : t[4],
    })),
  };
  FAMILY_LIST.push(fam);
  return fam;
}

// -- humanoid families ------------------------------------------------------

F('Archer', 'biped', 192,
  { skin: ['flesh', 5], cloth: ['wood', 5], cloth2: ['dirt', 4], metal: ['stone', 8], hair: ['wood', 3] },
  { weapon: 'bow', helm: 'hood', hunch: 0.06, armSwing: 0.6 },
  [['Archer', 9, 35], ['Master Archer', 19, 93, { cloth: ['foliage', 5], cloth2: ['foliage', 3] }],
    ['Fire Archer', 29, 171, { cloth: ['fire', 6], cloth2: ['blood', 5], glow: ['fire', 13] }]],
  { ranged: true });

F('Barbarian', 'biped', 208,
  { skin: ['flesh', 4], body: ['flesh', 4], cloth: ['wood', 4], cloth2: ['dirt', 3], hair: ['wood', 2], horn: ['sand', 11] },
  { weapon: 'axe', shoulderW: 0.31, hipW: 0.25, armLen: 0.44, beard: 1, hair: 1, stride: 0.95 },
  [['Magyar', 14, 61], ['Magyar Soldier', 25, 137, { cloth: ['stone', 5], metal: ['stone', 10] }],
    ['Magyar Matron', 37, 247, { cloth: ['blood', 5], hair: ['fire', 8], skin: ['flesh', 6] }]]);

F('Bat', 'biped', 72,
  { skin: ['wood', 4], body: ['wood', 4], skin2: ['wood', 2], wing: ['wood', 5], wing2: ['wood', 3], eye: ['fire', 12] },
  {
    headR: 0.20, legLen: 0.22, torsoH: 0.34, armLen: 0.12, shoulderW: 0.22, hipW: 0.18,
    wings: 'bat', wingSpan: 1.0, ears: 'long', flyer: 1, boots: 0, belt: 0, glow: 1,
  },
  [['Bat', 3, 9], ['Giant Bat', 6, 21, { skin: ['grey', 5], body: ['grey', 5], wing: ['grey', 5], wing2: ['grey', 3] }, 1.30],
    ['Vampire Bat', 9, 35, { skin: ['arcane', 2], body: ['arcane', 2], wing: ['arcane', 3], wing2: ['grey', 2], eye: ['blood', 13] }, 1.20]],
  { flying: true });

F('Beholder', 'eye', 150,
  { skin: ['foliage', 9], body: ['foliage', 6], skin2: ['foliage', 4], glow: ['grass', 13] },
  { stalks: 5 },
  [['Flying Eye', 30, 180], ['Terrible Eye', 40, 280, { skin: ['arcane', 5], body: ['arcane', 3], skin2: ['arcane', 2], glow: ['arcane', 7] }],
    ['Maddening Eye', 50, 400, { skin: ['blood', 9], body: ['blood', 5], skin2: ['blood', 3], glow: ['fire', 13] }]],
  { flying: true, ranged: true });

F('Bloodsucker', 'blob', 76,
  { skin: ['flesh', 5], body: ['flesh', 4], glow: ['blood', 10] },
  { lobes: 4, wide: 0.95, drip: 1, arms: 0 },
  [['Blood Sucker', 2, 6], ['Brain Sucker', 4, 13, { body: ['plaster', 7], glow: ['arcane', 6] }],
    ['Soul Sucker', 8, 30, { body: ['arcane', 3], glow: ['arcane', 7] }]],
  {});

F('Cleric', 'biped', 192,
  { skin: ['flesh', 4], cloth: ['grey', 2], cloth2: ['grey', 4], metal: ['stone', 8], glow: ['grey', 10] },
  { robe: 1, helm: 'hood', weapon: 'staff' },
  [['Acolyte of Baa', 8, 30], ['Cleric of Baa', 15, 67, { cloth: ['blood', 4], cloth2: ['blood', 7], glow: ['blood', 12] }],
    ['Priest of Baa', 25, 137, { cloth: ['blood', 6], cloth2: ['gold', 10], metal: ['gold', 11], glow: ['fire', 13] }]],
  { ranged: true });

F('Cobra', 'serpent', 122,
  { skin: ['dirt', 7], body: ['dirt', 5], skin2: ['dirt', 9], glow: ['gold', 12] },
  { hood: 0.55, coils: 9, glow: 1 },
  [['Cobra', 5, 17], ['King Cobra', 10, 40, { skin: ['foliage', 8], body: ['foliage', 6], skin2: ['foliage', 10] }],
    ['Queen Cobra', 14, 61, { skin: ['gold', 9], body: ['gold', 7], skin2: ['gold', 12] }]]);

F('Cockatrice', 'biped', 178,
  {
    skin: ['swamp', 8], body: ['swamp', 7], skin2: ['sand', 8], cloth: ['swamp', 6], cloth2: ['fire', 8],
    horn: ['gold', 11], wing: ['sand', 9], wing2: ['wood', 6], eye: ['fire', 12],
  },
  {
    headShape: 'beak', headR: 0.085, digitigrade: 1, claws: 1, wings: 'feather', wingSpan: 0.72,
    tail: 0.45, hunch: 0.28, boots: 0, belt: 0, armLen: 0.30, glow: 1,
  },
  [["Agar's Pet", 13, 55], ["Agar's Monster", 15, 67, { skin: ['blood', 6], body: ['blood', 5], wing: ['blood', 7] }],
    ["Agar's Abomination", 17, 79, { skin: ['arcane', 4], body: ['arcane', 3], wing: ['arcane', 5], horn: ['ice', 11] }]],
  {});

F('DemonFly', 'biped', 280,
  {
    skin: ['blood', 6], body: ['blood', 5], skin2: ['blood', 3], cloth: ['grey', 2], cloth2: ['fire', 8],
    horn: ['grey', 3], wing: ['blood', 3], wing2: ['grey', 2], glow: ['fire', 13], eye: ['fire', 14],
  },
  {
    horns: 'devil', wings: 'bat', wingSpan: 0.95, tail: 0.5, weapon: 'sword', claws: 1,
    digitigrade: 1, glow: 1, boots: 0, shoulderW: 0.32,
  },
  [['Devil Captain', 30, 180], ['Devil Master', 50, 400, { skin: ['fire', 6], body: ['fire', 5], wing: ['fire', 4] }],
    ['Devil King', 70, 700, { skin: ['grey', 2], body: ['grey', 2], cloth2: ['fire', 12], glow: ['fire', 14] }]],
  { flying: true });

F('Demon', 'biped', 300,
  {
    skin: ['blood', 5], body: ['blood', 4], skin2: ['blood', 2], cloth: ['dirt', 3], cloth2: ['fire', 7],
    horn: ['sand', 9], metal: ['stone', 8], eye: ['fire', 13],
  },
  {
    headShape: 'bull', horns: 'ram', shoulderW: 0.36, hipW: 0.29, armLen: 0.50, armR: 0.055,
    weapon: 'spear', claws: 1, digitigrade: 1, glow: 1, boots: 0, hunch: 0.12,
  },
  [['Devil Spawn', 20, 100], ['Devil Worker', 40, 280, { skin: ['blood', 3], body: ['blood', 2], cloth2: ['fire', 10] }],
    ['Devil Warrior', 60, 540, { skin: ['fire', 4], body: ['fire', 3], horn: ['grey', 3], metal: ['grey', 10] }]],
  {});

F('DragonCave', 'dragon', 400,
  { skin: ['blood', 6], body: ['blood', 5], skin2: ['blood', 3], horn: ['sand', 10], glow: ['fire', 13] },
  { wings: 0, bodyLen: 1.45, legLen: 0.26, neck: 0.5, tail: 1.0, headR: 0.10, spikes: 1 },
  [['Fire Lizard', 40, 280], ['Lightning Lizard', 50, 400, { skin: ['water', 8], body: ['water', 6], skin2: ['water', 4], glow: ['ice', 13] }],
    ['Thunder Lizard', 60, 540, { skin: ['arcane', 4], body: ['arcane', 3], skin2: ['arcane', 2], glow: ['arcane', 7] }]],
  {});

F('DragonFly', 'dragon', 260,
  {
    skin: ['fire', 7], body: ['fire', 6], skin2: ['fire', 4], horn: ['sand', 11],
    glow: ['fire', 14], wing: ['fire', 5], wing2: ['blood', 3],
  },
  { frontLegs: 0, wingSpan: 1.20, neck: 0.45, tail: 0.95, bodyLen: 0.95, headR: 0.11, legLen: 0.32 },
  [['Flame Drake', 24, 129], ['Frost Drake', 28, 162, { skin: ['ice', 10], body: ['ice', 8], skin2: ['ice', 6], wing: ['ice', 7], glow: ['ice', 14] }],
    ['Energy Drake', 32, 198, { skin: ['arcane', 5], body: ['arcane', 4], skin2: ['arcane', 2], wing: ['arcane', 3], glow: ['arcane', 7] }]],
  { flying: true });

F('DragonLand', 'dragon', 460,
  { skin: ['swamp', 7], body: ['swamp', 5], skin2: ['swamp', 3], horn: ['sand', 9], glow: ['gold', 12] },
  { legless: 1, wings: 0, bodyLen: 1.5, neck: 0.75, tail: 1.5, headR: 0.10, spikes: 1 },
  [['Wyrm', 50, 400], ['Giant Wyrm', 60, 540, { skin: ['wood', 6], body: ['wood', 5], skin2: ['wood', 3] }],
    ['Great Wyrm', 70, 700, { skin: ['gold', 6], body: ['gold', 5], skin2: ['wood', 3], glow: ['gold', 14] }]],
  {});

F('DragonCover', 'dragon', 620,
  {
    skin: ['blood', 7], body: ['blood', 6], skin2: ['blood', 4], horn: ['sand', 12],
    glow: ['fire', 14], wing: ['blood', 5], wing2: ['blood', 3],
  },
  {},
  [['Red Dragon', 80, 880],
    ['Blue Dragon', 90, 1080, { skin: ['water', 8], body: ['water', 7], skin2: ['water', 4], wing: ['water', 6], wing2: ['water', 3], glow: ['ice', 14] }],
    ['Gold Dragon', 100, 1300, { skin: ['gold', 9], body: ['gold', 8], skin2: ['gold', 5], wing: ['gold', 7], wing2: ['gold', 4], glow: ['gold', 15] }]],
  {});

F('Druidess', 'biped', 186,
  { skin: ['flesh', 6], cloth: ['foliage', 6], cloth2: ['wood', 5], glow: ['grass', 12], hair: ['wood', 4], metal: ['gold', 8] },
  { robe: 1, helm: 'hood', weapon: 'staff', hipW: 0.20, shoulderW: 0.21, hair: 'long' },
  [['Druid', 10, 40], ['Great Druid', 16, 73, { cloth: ['wood', 5], cloth2: ['gold', 9] }],
    ['Grand Druid', 28, 162, { cloth: ['grass', 9], cloth2: ['gold', 12], glow: ['gold', 14] }]],
  { ranged: true });

F('Dwarf', 'biped', 148,
  { skin: ['flesh', 4], cloth: ['wood', 6], cloth2: ['blood', 5], hair: ['fire', 7], metal: ['stone', 9] },
  {
    headR: 0.100, legLen: 0.34, torsoH: 0.36, shoulderW: 0.31, hipW: 0.27, armLen: 0.38,
    beard: 'long', weapon: 'axe', helm: 'cap', stride: 0.85,
  },
  [['Dwarf', 10, 40], ['Dwarf Warrior', 20, 100, { cloth: ['stone', 6], metal: ['stone', 11], hair: ['wood', 3] }],
    ['Dwarf Lord', 30, 180, { cloth: ['blood', 5], metal: ['gold', 10], hair: ['grey', 11] }]]);

F('ElemAir', 'blob', 250,
  { skin: ['ice', 11], body: ['ice', 9], glow: ['ice', 14] },
  { lobes: 6, wide: 0.58, flame: 1, glow: 0.5, core: 1, arms: 1, drip: 1 },
  [['Dust Devil', 16, 73, { body: ['sand', 7], glow: ['sand', 12] }],
    ['Twister', 22, 114, { body: ['stone', 8], glow: ['ice', 12] }],
    ['Air Elemental', 33, 207]]);

F('ElemEarth', 'biped', 280,
  { skin: ['dirt', 4], body: ['dirt', 5], skin2: ['stone', 4], cloth: ['dirt', 3], cloth2: ['stone', 3], horn: ['stone', 6] },
  {
    headShape: 'box', headR: 0.078, shoulderW: 0.38, hipW: 0.31, armLen: 0.48, armR: 0.062,
    legR: 0.078, legLen: 0.38, torsoH: 0.36, stride: 0.7, armSwing: 0.6, boots: 0, belt: 0, hunch: 0.10,
  },
  [['Rock Beast', 25, 137], ['Earth Spirit', 30, 180, { skin: ['stone', 6], body: ['stone', 6], skin2: ['stone', 3] }],
    ['Earth Elemental', 40, 280, { skin: ['grey', 5], body: ['grey', 5], skin2: ['grey', 3], horn: ['ice', 9] }]],
  {});

F('ElemFire', 'blob', 240,
  { skin: ['fire', 10], body: ['fire', 8], glow: ['fire', 15] },
  { lobes: 6, wide: 0.55, flame: 1, glow: 0.92, core: 1, arms: 1, drip: 1 },
  [['Fire Beast', 13, 55], ['Fire Spirit', 26, 145, { body: ['fire', 11], glow: ['gold', 15] }],
    ['Fire Elemental', 39, 269, { body: ['blood', 9], glow: ['fire', 15] }]]);

F('ElemWater', 'blob', 220,
  { skin: ['water', 10], body: ['water', 8], glow: ['water', 13] },
  { lobes: 5, wide: 0.66, glow: 0.35, core: 1, arms: 1, drip: 1 },
  [['Water Beast', 14, 61], ['Water Spirit', 24, 129, { body: ['ice', 9], glow: ['ice', 14] }],
    ['Water Elemental', 36, 237, { body: ['water', 6], glow: ['ice', 12] }]]);

F('FighterChain', 'biped', 196,
  { skin: ['flesh', 5], body: ['stone', 9], cloth: ['stone', 7], cloth2: ['blood', 5], metal: ['stone', 11] },
  { weapon: 'sword', shield: 'kite', helm: 'cap', pads: 1, shoulderW: 0.27 },
  [['Fighter', 14, 61], ['Soldier', 24, 129, { cloth2: ['water', 6], metal: ['stone', 12] }],
    ['Veteran', 35, 227, { body: ['grey', 10], cloth: ['grey', 8], cloth2: ['gold', 9], metal: ['grey', 13] }]]);

F('FighterLeath', 'biped', 192,
  { skin: ['flesh', 4], cloth: ['wood', 4], cloth2: ['dirt', 3], metal: ['stone', 8], hair: ['wood', 2] },
  { weapon: 'club', hunch: 0.08, hair: 1, shoulderW: 0.27, hipW: 0.22 },
  [['Thug', 8, 30], ['Ruffian', 14, 61, { cloth: ['dirt', 5], weapon: 'sword' }],
    ['Brigand', 22, 114, { cloth: ['blood', 4], cloth2: ['wood', 5] }]]);

F('Gargoyle', 'biped', 200,
  {
    skin: ['stone', 6], body: ['stone', 6], skin2: ['stone', 4], cloth: ['stone', 5], cloth2: ['stone', 3],
    wing: ['stone', 5], wing2: ['stone', 3], horn: ['stone', 9], eye: ['fire', 11],
  },
  {
    horns: 'devil', ears: 'point', claws: 1, wings: 'bat', wingSpan: 0.62, wingFold: 1.15, digitigrade: 1,
    hunch: 0.30, tail: 0.4, boots: 0, belt: 0, glow: 1, legLen: 0.40, armLen: 0.46,
  },
  [['Stone Gargoyle', 16, 73],
    ['Marble Gargoyle', 22, 114, { skin: ['plaster', 12], body: ['plaster', 12], skin2: ['plaster', 9], wing: ['plaster', 11], wing2: ['plaster', 8], horn: ['plaster', 14] }],
    ['Diamond Gargoyle', 33, 207, { skin: ['ice', 11], body: ['ice', 10], skin2: ['ice', 7], wing: ['ice', 9], wing2: ['ice', 6], horn: ['ice', 14] }]],
  {});

F('Genie', 'biped', 300,
  { skin: ['water', 9], body: ['water', 8], skin2: ['water', 6], cloth: ['ice', 8], cloth2: ['gold', 11], metal: ['gold', 11], hair: ['grey', 2] },
  { lower: 'smoke', beard: 1, helm: 'wrap', armLen: 0.44, shoulderW: 0.30, boots: 0, glow: 1, weapon: 'none' },
  [['Genie', 33, 207], ['Djinn', 44, 325, { skin: ['arcane', 5], body: ['arcane', 4], skin2: ['arcane', 3], cloth: ['arcane', 2] }],
    ['Efreet', 55, 467, { skin: ['blood', 7], body: ['blood', 6], skin2: ['blood', 4], cloth: ['fire', 6], glow: ['fire', 14] }]],
  { flying: true });

F('Ghost', 'biped', 200,
  { skin: ['ice', 11], body: ['ice', 10], skin2: ['ice', 8], cloth: ['ice', 9], cloth2: ['ice', 7], eye: ['ice', 14] },
  { lower: 'none', robe: 1, headR: 0.072, armLen: 0.44, glow: 1, boots: 0, belt: 0, float: 0.08 },
  [['Ghost', 9, 35],
    ['Evil Spirit', 13, 55, { skin: ['grass', 9], body: ['grass', 7], cloth: ['grass', 6], cloth2: ['foliage', 5], eye: ['grass', 13] }],
    ['Specter', 19, 93, { skin: ['arcane', 5], body: ['arcane', 4], cloth: ['arcane', 2], cloth2: ['arcane', 4], eye: ['arcane', 7], headShape: 'skull' }]],
  { flying: true });

F('Goblin', 'biped', 168,
  { skin: ['grass', 5], skin2: ['grass', 3], cloth: ['dirt', 5], cloth2: ['wood', 4], metal: ['stone', 7] },
  {
    headR: 0.098, legLen: 0.42, torsoH: 0.30, hunch: 0.22, ears: 'long', weapon: 'club',
    shoulderW: 0.25, armLen: 0.44, stride: 1.1,
  },
  [['Goblin', 4, 13],
    ['Goblin Shaman', 6, 21, { skin: ['swamp', 7], cloth: ['arcane', 3], cloth2: ['gold', 9], glow: ['arcane', 7], weapon: 'staff' }],
    ['Goblin King', 10, 40, { skin: ['grass', 7], cloth: ['blood', 5], cloth2: ['blood', 7], metal: ['gold', 10], weapon: 'axe', helm: 'crown' }, 1.16]]);

F('Guard', 'biped', 198,
  { skin: ['flesh', 5], body: ['stone', 8], cloth: ['sky', 6], cloth2: ['gold', 9], metal: ['stone', 11] },
  { weapon: 'spear', shield: 'kite', helm: 'cap', pads: 1 },
  [['Guard', 11, 45], ['Lieutenant', 19, 93, { cloth: ['blood', 5], metal: ['stone', 12] }],
    ['Captain', 33, 207, { cloth: ['arcane', 4], cloth2: ['gold', 12], metal: ['grey', 13] }]]);

F('Harpy', 'biped', 190,
  {
    skin: ['flesh', 5], body: ['flesh', 5], skin2: ['wood', 5], cloth: ['wood', 6], cloth2: ['wood', 4],
    hair: ['blood', 5], wing: ['wood', 7], wing2: ['wood', 4], horn: ['sand', 12],
  },
  { wings: 'feather', wingSpan: 0.88, digitigrade: 1, claws: 1, hair: 'long', flyer: 1, boots: 0, belt: 0, hipW: 0.20 },
  [['Harpy', 14, 61], ['Harpy Hag', 17, 79, { skin: ['swamp', 7], hair: ['grey', 4], wing: ['grey', 5], wing2: ['grey', 3] }],
    ['Harpy Witch', 19, 93, { skin: ['arcane', 5], hair: ['arcane', 3], wing: ['arcane', 4], wing2: ['arcane', 2] }]],
  { flying: true });

F('Hydra', 'dragon', 470,
  { skin: ['foliage', 6], body: ['foliage', 6], skin2: ['foliage', 4], horn: ['sand', 10], glow: ['gold', 12] },
  { necks: 3, neck: 0.58, wings: 0, bodyLen: 1.15, tail: 0.8, headR: 0.10, spikes: 1, legLen: 0.30 },
  [['Hydra', 45, 337], ['Venomous Hydra', 55, 467, { skin: ['swamp', 8], body: ['swamp', 7], glow: ['grass', 13] }],
    ['Colossal Hydra', 65, 617, { skin: ['arcane', 4], body: ['arcane', 3], skin2: ['arcane', 2], glow: ['arcane', 7] }]],
  {});

F('Jackalman', 'biped', 218,
  {
    skin: ['sand', 7], body: ['sand', 7], skin2: ['wood', 4], cloth: ['gold', 9], cloth2: ['sky', 6],
    metal: ['gold', 11], horn: ['gold', 12], eye: ['gold', 13],
  },
  { headShape: 'wolf', headR: 0.082, weapon: 'spear', shield: 'round', pads: 1, digitigrade: 1, glow: 1, boots: 0 },
  [['Defender', 35, 227],
    ['Sentinel', 55, 467, { cloth: ['blood', 5], metal: ['stone', 11], skin: ['dirt', 5], body: ['dirt', 5] }],
    ['Guardian of VARN', 65, 617, { cloth: ['arcane', 4], metal: ['gold', 13], skin: ['grey', 4], body: ['grey', 4] }]],
  {});

F('KnightPlate', 'biped', 230,
  { skin: ['grey', 2], body: ['grey', 3], cloth: ['grey', 2], cloth2: ['blood', 4], metal: ['grey', 5], eye: ['blood', 12] },
  { weapon: 'sword', helm: 'full', pads: 1, cape: 1, shoulderW: 0.30, hipW: 0.25, glow: 1 },
  [['Death Knight', 40, 280],
    ['Doom Knight', 60, 540, { body: ['stone', 4], metal: ['stone', 7], cloth2: ['arcane', 4], eye: ['arcane', 7] }],
    ['Cuisinart', 80, 880, { body: ['grey', 9], metal: ['grey', 13], cloth2: ['fire', 9], eye: ['fire', 14] }]],
  {});

F('Lich', 'biped', 205,
  {
    skin: ['plaster', 11], body: ['arcane', 2], skin2: ['plaster', 8], cloth: ['arcane', 2], cloth2: ['gold', 9],
    metal: ['gold', 10], glow: ['arcane', 7], eye: ['arcane', 7],
  },
  { headShape: 'skull', robe: 1, helm: 'crown', weapon: 'staff', cape: 1, ribs: 1, armR: 0.028, glow: 1 },
  [['Lich', 20, 100], ['Greater Lich', 30, 180, { cloth: ['blood', 3], cloth2: ['blood', 7], glow: ['blood', 12], eye: ['blood', 13] }],
    ['Power Lich', 40, 280, { cloth: ['ice', 4], cloth2: ['ice', 10], glow: ['ice', 14], eye: ['ice', 14] }]],
  { ranged: true });

F('LizardArch', 'biped', 190,
  {
    skin: ['foliage', 8], body: ['foliage', 7], skin2: ['foliage', 5], cloth: ['dirt', 5], cloth2: ['sand', 6],
    horn: ['sand', 11], eye: ['gold', 12],
  },
  { headShape: 'lizard', headR: 0.080, horns: 'crest', tail: 0.55, weapon: 'spear', shield: 'round', digitigrade: 1, glow: 1, boots: 0 },
  [['Lizard Man', 4, 13],
    ['Lizard Archer', 7, 25, { skin: ['swamp', 8], body: ['swamp', 7], weapon: 'bow', shield: 0 }],
    ['Lizard Wizard', 11, 45, { skin: ['water', 8], body: ['water', 7], cloth: ['arcane', 3], weapon: 'staff', shield: 0, glow: ['arcane', 7] }]],
  {});

F('Medusa', 'biped', 210,
  { skin: ['grass', 8], body: ['grass', 7], skin2: ['grass', 5], cloth: ['gold', 8], cloth2: ['gold', 11], glow: ['gold', 13], eye: ['fire', 12] },
  { lower: 'serpent', snakes: 1, weapon: 'bow', headR: 0.070, boots: 0, hipW: 0.20 },
  [['Medusa', 35, 227], ['Medusa Enchantress', 40, 280, { skin: ['swamp', 9], body: ['swamp', 7], cloth: ['arcane', 4] }],
    ['Gorgon', 45, 337, { skin: ['stone', 8], body: ['stone', 7], skin2: ['stone', 5], cloth: ['blood', 5] }]],
  { ranged: true });

F('Merchant', 'biped', 188,
  { skin: ['flesh', 5], cloth: ['blood', 5], cloth2: ['plaster', 12], hair: ['wood', 3], metal: ['gold', 9] },
  { robe: 'short', belt: 1, hipW: 0.24, torsoD: 0.17, hair: 1, beard: 1, weapon: 'none' },
  [['Peasant', 4, 13], ['Peasant', 5, 17, { cloth: ['sky', 6] }], ['Peasant', 6, 21, { cloth: ['foliage', 6] }]]);

F('Minotaur', 'biped', 320,
  {
    skin: ['wood', 4], body: ['wood', 4], skin2: ['wood', 2], cloth: ['blood', 4], cloth2: ['dirt', 4],
    horn: ['sand', 12], metal: ['stone', 9], eye: ['fire', 12],
  },
  {
    headShape: 'bull', horns: 'bull', headR: 0.082, shoulderW: 0.36, hipW: 0.28, armLen: 0.50,
    armR: 0.058, legLen: 0.44, digitigrade: 1, weapon: 'axe', tail: 0.35, hunch: 0.14, glow: 1,
  },
  [['Minotaur', 39, 269],
    ['Minotaur Mage', 59, 525, { skin: ['stone', 5], body: ['stone', 5], cloth: ['arcane', 3], weapon: 'staff', glow: ['arcane', 7] }],
    ['Minotaur King', 79, 861, { skin: ['grey', 3], body: ['grey', 3], cloth: ['gold', 8], metal: ['gold', 11], horn: ['gold', 13] }]],
  {});

F('Monk', 'biped', 192,
  { skin: ['flesh', 5], cloth: ['sand', 9], cloth2: ['blood', 6], hair: ['grey', 2] },
  { robe: 'short', weapon: 'none', boots: 0, armLen: 0.42, hunch: 0.05 },
  [['Novice', 8, 30], ['Initiate', 16, 73, { cloth: ['dirt', 7], cloth2: ['sky', 7] }],
    ['Master Monk', 27, 153, { cloth: ['plaster', 12], cloth2: ['gold', 10] }]]);

F('Nobleman', 'biped', 192,
  { skin: ['flesh', 6], body: ['stone', 10], cloth: ['sky', 7], cloth2: ['gold', 10], metal: ['stone', 12], hair: ['wood', 4] },
  { weapon: 'sword', helm: 'hat', cape: 1, hair: 1, armR: 0.036 },
  [['Swordsman', 10, 40], ['Expert Swordsman', 17, 79, { cloth: ['blood', 5], cloth2: ['plaster', 12] }],
    ['Master Swordsman', 24, 129, { cloth: ['arcane', 4], cloth2: ['gold', 12], body: ['grey', 11] }]]);

F('Ooze', 'blob', 130,
  { skin: ['grass', 7], body: ['grass', 6], glow: ['grass', 12] },
  { lobes: 4, wide: 0.88, drip: 1 },
  [['Ooze', 12, 50], ['Acidic Ooze', 18, 86, { body: ['gold', 7], glow: ['gold', 13] }],
    ['Corrosive Ooze', 25, 137, { body: ['arcane', 3], glow: ['arcane', 7] }]],
  {});

F('Ogre', 'biped', 300,
  {
    skin: ['swamp', 8], body: ['swamp', 7], skin2: ['swamp', 5], cloth: ['dirt', 4], cloth2: ['wood', 3],
    hair: ['wood', 2], horn: ['sand', 11],
  },
  {
    headR: 0.080, shoulderW: 0.34, hipW: 0.31, armLen: 0.50, armR: 0.058, legLen: 0.42,
    torsoH: 0.34, hunch: 0.22, weapon: 'club', beard: 1, stride: 0.8, armSwing: 0.85, ears: 'point',
  },
  [['Ogre', 15, 67], ['Ogre Raider', 20, 100, { skin: ['stone', 6], body: ['stone', 6], cloth: ['blood', 4] }],
    ['Ogre Chieftain', 28, 162, { skin: ['dirt', 5], body: ['dirt', 5], cloth: ['gold', 8], horn: ['gold', 12] }]],
  {});

// -- civilians --------------------------------------------------------------

F('PeasantF1', 'biped', 176,
  { skin: ['flesh', 6], cloth: ['sand', 9], cloth2: ['blood', 6], hair: ['wood', 4] },
  { robe: 1, hipW: 0.20, shoulderW: 0.21, hair: 'long', weapon: 'none' },
  [['Peasant', 1, 3], ['Peasant', 2, 6, { cloth: ['grass', 8] }], ['Peasant', 3, 9, { cloth: ['water', 8] }]]);

F('PeasantF2', 'biped', 174,
  { skin: ['flesh', 5], cloth: ['plaster', 10], cloth2: ['wood', 5], hair: ['fire', 6] },
  { robe: 1, hipW: 0.20, shoulderW: 0.21, hair: 'long', weapon: 'none' },
  [['Peasant', 1, 3], ['Peasant', 2, 6, { cloth: ['sky', 7] }], ['Peasant', 3, 9, { cloth: ['gold', 8] }]]);

F('PeasantF3', 'biped', 178,
  { skin: ['flesh', 5], cloth: ['grey', 2], cloth2: ['grey', 4], metal: ['stone', 10], hair: ['wood', 2] },
  { robe: 'short', helm: 'hood', weapon: 'dagger', hipW: 0.20, shoulderW: 0.21, hunch: 0.12 },
  [['Cutpurse', 3, 9], ['Bounty Hunter', 5, 17, { cloth: ['wood', 4], cloth2: ['blood', 5] }],
    ['Assassin', 7, 25, { cloth: ['arcane', 2], cloth2: ['blood', 4] }]]);

F('PeasantF4', 'biped', 176,
  { skin: ['dirt', 7], skin2: ['dirt', 5], cloth: ['blood', 6], cloth2: ['sand', 11], hair: ['grey', 1], horn: ['plaster', 13] },
  { weapon: 'spear', hair: 'long', boots: 0, hipW: 0.20, shoulderW: 0.21, robe: 'short' },
  [['Cannibal', 6, 21], ['Head Hunter', 8, 30, { cloth: ['foliage', 5], cloth2: ['fire', 8] }],
    ['Witch Doctor', 10, 40, { cloth: ['arcane', 3], cloth2: ['gold', 10], helm: 'hood' }]]);

F('PeasantM1', 'biped', 186,
  { skin: ['flesh', 5], cloth: ['dirt', 8], cloth2: ['wood', 5], hair: ['wood', 3] },
  { hair: 1, weapon: 'none' },
  [['Peasant', 1, 3], ['Peasant', 2, 6, { cloth: ['grass', 7] }], ['Peasant', 3, 9, { cloth: ['sand', 9] }]]);

F('PeasantM2', 'biped', 190,
  { skin: ['flesh', 6], cloth: ['sky', 6], cloth2: ['sky', 9], glow: ['sky', 13], hair: ['wood', 5] },
  { robe: 1, helm: 'hood', weapon: 'staff' },
  [['Apprentice', 2, 6], ['Journeyman Mage', 6, 21, { cloth: ['water', 7], glow: ['ice', 13] }],
    ['Mage', 10, 40, { cloth: ['arcane', 4], cloth2: ['gold', 10], glow: ['arcane', 7], helm: 'hat' }]],
  { ranged: true });

F('PeasantM3', 'biped', 188,
  { skin: ['flesh', 4], cloth: ['plaster', 8], cloth2: ['dirt', 5], hair: ['grey', 3] },
  { robe: 1, helm: 'hood', weapon: 'none' },
  [['Follower', 3, 9], ['Mystic', 5, 17, { cloth: ['stone', 6], cloth2: ['sky', 7] }],
    ['Fanatic of Baa', 7, 25, { cloth: ['blood', 4], cloth2: ['blood', 8], weapon: 'dagger' }]]);

F('PeasantM4', 'biped', 188,
  { skin: ['dirt', 6], skin2: ['dirt', 4], cloth: ['sand', 8], cloth2: ['blood', 6], hair: ['grey', 1], horn: ['plaster', 13] },
  { weapon: 'spear', boots: 0, helm: 'wrap', hunch: 0.08 },
  [['Cannibal', 6, 21], ['Head Hunter', 8, 30, { cloth: ['foliage', 5], cloth2: ['fire', 8] }],
    ['Witch Doctor', 10, 40, { cloth: ['arcane', 3], cloth2: ['gold', 10] }]]);

// -- beasts, undead, constructs --------------------------------------------

F('Rat', 'quad', 70,
  { skin: ['dirt', 6], body: ['dirt', 6], skin2: ['flesh', 3], hair: ['dirt', 4], eye: ['blood', 11] },
  { bodyLen: 1.5, legLen: 0.42, bodyR: 0.28, headShape: 'rat', headR: 0.24, ears: 'round', tail: 1.1, tailUp: -0.15, glow: 1, stride: 1.3 },
  [['Common Rat', 2, 6], ['Large Rat', 4, 13, { skin: ['stone', 5], body: ['stone', 5] }, 1.25],
    ['Giant Rat', 6, 21, { skin: ['wood', 3], body: ['wood', 3] }, 1.5]],
  {});

F('Robot', 'biped', 240,
  { skin: ['grey', 9], body: ['grey', 8], skin2: ['grey', 6], cloth: ['grey', 7], cloth2: ['stone', 5], metal: ['grey', 12], glow: ['ice', 14] },
  {
    headShape: 'box', headR: 0.070, shoulderW: 0.32, hipW: 0.25, armLen: 0.46, armR: 0.050,
    legR: 0.062, legLen: 0.44, torsoH: 0.32, pads: 1, stride: 0.7, armSwing: 0.6, boots: 0, belt: 0, glow: 1,
  },
  [['Patrol Unit', 50, 400], ['Enforcer Unit', 70, 700, { body: ['stone', 7], metal: ['stone', 12], glow: ['gold', 14] }],
    ['Terminator Unit', 90, 1080, { body: ['grey', 3], skin: ['grey', 4], metal: ['grey', 6], glow: ['blood', 13] }]]);

F('SeaSerpent', 'dragon', 420,
  { skin: ['water', 8], body: ['water', 7], skin2: ['ice', 6], horn: ['ice', 11], glow: ['ice', 13] },
  { legless: 1, wings: 0, bodyLen: 1.3, neck: 0.85, tail: 1.35, headR: 0.09, spikes: 1, tailFin: 1 },
  [['Sea Serpent', 28, 162], ['Sea Monster', 36, 237, { skin: ['swamp', 7], body: ['swamp', 6], skin2: ['swamp', 4] }],
    ['Sea Terror', 48, 374, { skin: ['arcane', 4], body: ['arcane', 3], skin2: ['arcane', 2], glow: ['arcane', 7] }]],
  {});

F('Skeleton', 'biped', 190,
  {
    skin: ['plaster', 12], body: ['plaster', 12], skin2: ['plaster', 9], cloth: ['plaster', 11],
    cloth2: ['stone', 5], metal: ['stone', 8], eye: ['blood', 10],
  },
  {
    headShape: 'skull', ribs: 1, weapon: 'sword', armR: 0.026, legR: 0.034, hipW: 0.15,
    shoulderW: 0.20, torsoD: 0.10, boots: 0, belt: 0, glow: 1,
  },
  [['Skeleton', 6, 21],
    ['Skeleton Knight', 10, 40, { cloth: ['dirt', 4], cloth2: ['blood', 4], metal: ['dirt', 6], body: ['stone', 6], shield: 'kite' }],
    ['Skeleton Lord', 14, 61, { cloth: ['grey', 3], cloth2: ['gold', 9], metal: ['gold', 10], eye: ['fire', 12], helm: 'crown' }]]);

F('Sorcerer', 'biped', 192,
  { skin: ['flesh', 5], cloth: ['arcane', 3], cloth2: ['arcane', 6], glow: ['arcane', 7], hair: ['grey', 11], metal: ['gold', 9] },
  { robe: 1, helm: 'hat', weapon: 'staff', beard: 'long' },
  [['Sorcerer', 25, 137], ['Magician', 35, 227, { cloth: ['water', 5], cloth2: ['ice', 11], glow: ['ice', 14] }],
    ['Warlock', 50, 400, { cloth: ['grey', 1], cloth2: ['blood', 6], glow: ['blood', 13], hair: ['grey', 2] }]],
  { ranged: true });

F('Spider', 'insect', 96,
  { skin: ['wood', 3], body: ['wood', 3], skin2: ['wood', 5], eye: ['blood', 12], glow: ['blood', 12] },
  { legs: 8, legLen: 0.72, bodyLen: 0.72, bodyR: 0.24, abdomen: 0.36, headR: 0.16, antennae: 0, carapace: 0, glow: 1 },
  [['Spider', 5, 17], ['Giant Spider', 8, 30, { skin: ['grey', 2], body: ['grey', 2], skin2: ['grey', 4] }, 1.3],
    ['Huge Spider', 12, 50, { skin: ['arcane', 2], body: ['arcane', 2], skin2: ['arcane', 4], glow: ['arcane', 7] }, 1.6]],
  {});

F('Thief', 'biped', 186,
  { skin: ['flesh', 4], cloth: ['grey', 2], cloth2: ['wood', 3], metal: ['stone', 10] },
  { weapon: 'dagger', weapon2: 'dagger', helm: 'hood', hunch: 0.22, armLen: 0.42, stride: 1.1 },
  [['Thief', 8, 30], ['Burglar', 12, 50, { cloth: ['water', 3], cloth2: ['grey', 4] }],
    ['Rogue', 18, 86, { cloth: ['blood', 3], cloth2: ['gold', 8] }]]);

F('Titan', 'biped', 384,
  {
    skin: ['gold', 10], body: ['gold', 9], skin2: ['gold', 7], cloth: ['plaster', 13], cloth2: ['sky', 8],
    metal: ['gold', 12], hair: ['grey', 12], glow: ['ice', 14],
  },
  { headR: 0.070, shoulderW: 0.30, weapon: 'spear', helm: 'crown', cape: 1, pads: 1, beard: 'long', hair: 1, glow: 1, robe: 'short' },
  [['Titan', 65, 617], ['Noble Titan', 75, 787, { cloth: ['sky', 9], metal: ['ice', 13], glow: ['sky', 14] }],
    ['Supreme Titan', 95, 1187, { skin: ['ice', 11], body: ['ice', 10], cloth: ['gold', 11], glow: ['gold', 15] }]]);

F('Werewolf', 'biped', 230,
  {
    skin: ['wood', 4], body: ['wood', 4], skin2: ['wood', 2], cloth: ['dirt', 3], cloth2: ['dirt', 2],
    horn: ['plaster', 13], hair: ['wood', 3], eye: ['fire', 12],
  },
  {
    headShape: 'wolf', headR: 0.085, ears: 'point', claws: 1, digitigrade: 1, hunch: 0.30,
    tail: 0.50, shoulderW: 0.32, armLen: 0.50, boots: 0, belt: 0, glow: 1, stride: 1.15,
  },
  [['Wolfman', 20, 100], ['Werewolf', 30, 180, { skin: ['grey', 5], body: ['grey', 5], skin2: ['grey', 3], hair: ['grey', 4] }],
    ['Greater Werewolf', 40, 280, { skin: ['grey', 2], body: ['grey', 2], skin2: ['grey', 1], hair: ['grey', 2] }]],
  {});

// -- uniques ----------------------------------------------------------------

F('zDemonqueen', 'biped', 420,
  {
    skin: ['blood', 8], body: ['blood', 6], skin2: ['blood', 4], cloth: ['grey', 1], cloth2: ['fire', 9],
    horn: ['grey', 2], wing: ['blood', 3], wing2: ['grey', 1], glow: ['fire', 14], eye: ['fire', 14], hair: ['grey', 1],
  },
  {
    horns: 'devil', wings: 'bat', wingSpan: 1.0, tail: 0.55, weapon: 'scythe', claws: 1,
    digitigrade: 1, glow: 1, boots: 0, hipW: 0.20, shoulderW: 0.24, hair: 'long', helm: 'crown',
  },
  [['Demon Queen', 100, 1300, {}, 1]],
  { flying: true, ranged: true, suffixes: [''] });

F('zReactor', 'machine', 300,
  { skin: ['grey', 7], body: ['grey', 7], metal: ['grey', 9], glow: ['ice', 14] },
  {},
  [['Reactor', 100, 1300, {}, 1]],
  { suffixes: [''] });

// ---------------------------------------------------------------------------

/** Model builders, one per family. */
export const CREATURE_FAMILIES = {};
for (const f of FAMILY_LIST) CREATURE_FAMILIES[f.id] = f;

/** Every shipped monster: tier id -> family + palette shift + scale. */
export const CREATURE_TIERS = {};
for (const f of FAMILY_LIST) {
  f.tiers.forEach((t, i) => {
    const suffix = f.suffixes[i] === undefined ? String.fromCharCode(65 + i) : f.suffixes[i];
    const id = f.id + suffix;
    CREATURE_TIERS[id] = {
      id, family: f.id, tierIndex: i, name: t.name, level: t.level, hp: t.hp,
      paletteShift: t.paletteShift, scale: t.scale,
    };
  });
}

/** Flat list of every monster id, in MONSTERS.TXT order. */
export const CREATURE_KINDS = Object.keys(CREATURE_TIERS);

/** Family ids, for callers that only want one sheet per model. */
export const CREATURE_FAMILY_KINDS = Object.keys(CREATURE_FAMILIES);

// A few tiers swap gear as well as colour (the Lizard Archer trades its spear
// for a bow, the Goblin King gains a crown). Those keys ride along in the
// palette shift; pull them back out into archetype params here.
const GEAR_KEYS = ['weapon', 'weapon2', 'shield', 'helm', 'robe', 'cape', 'wings', 'headShape'];
function pickParams(shift) {
  const out = {};
  for (const k of GEAR_KEYS) if (shift[k] !== undefined) out[k] = shift[k];
  return out;
}

/**
 * Back-compatible per-monster descriptor: everything a consumer used to read
 * off CREATURE_DEFS, resolved through the family/tier split.
 */
export const CREATURE_DEFS = {};
for (const id of CREATURE_KINDS) {
  const t = CREATURE_TIERS[id];
  const f = CREATURE_FAMILIES[t.family];
  CREATURE_DEFS[id] = {
    id, name: t.name, family: t.family, tier: t.tierIndex + 1, arch: f.arch,
    height: f.height * t.scale,
    palette: { ...f.palette, ...t.paletteShift },
    params: { ...f.params, ...pickParams(t.paletteShift) },
    aspect: f.aspect,
    twoLegs: f.arch === 'biped',
    ranged: f.ranged,
    flying: f.flying,
    level: t.level, hp: t.hp,
  };
}

const ARCH_BUILD = {
  biped: buildBipedRig, ghost: buildGhostRig, quad: buildQuadRig, insect: buildInsectRig,
  serpent: buildSerpentRig, blob: buildBlobRig, dragon: buildDragonRig, wisp: buildWispRig,
  eye: buildEyeRig, machine: buildMachineRig,
};
const ARCH_DEFAULTS = {
  biped: BIPED_D, ghost: BIPED_D, quad: QUAD_D, insect: INSECT_D,
  serpent: SERP_D, blob: BLOB_D, dragon: DRAGON_D, wisp: {}, eye: {}, machine: {},
};
const ARCH_POSE = {
  biped: poseBiped, ghost: poseBiped, quad: poseQuad, insect: poseInsect,
  serpent: poseSerpent, blob: poseBlob, dragon: poseDragon, wisp: poseWisp,
  eye: poseEye, machine: poseMachine,
};

/**
 * Build a creature model.
 * @param {string} kind a tier id ('GoblinB') or a bare family id ('Goblin')
 * @param {number} seed
 * @returns {{root:THREE.Group, height:number, pose:Function, dispose:Function, def:object}}
 */
export function buildCreature(kind, seed = 1) {
  const tier = CREATURE_TIERS[kind];
  const fam = CREATURE_FAMILIES[tier ? tier.family : kind];
  if (!fam) throw new Error('unknown creature: ' + kind);
  const rnd = new Rand((seed >>> 0) ^ 0x9e3779b9);
  const shift = tier ? tier.paletteShift : {};
  const C = resolveCols({ ...fam.palette, ...shift });
  const P = { ...ARCH_DEFAULTS[fam.arch], ...fam.params, ...pickParams(shift) };
  const H = fam.height * (tier ? tier.scale : 1) * rnd.float(0.96, 1.04);
  const rig = ARCH_BUILD[fam.arch](H, P, C, rnd);
  if (P.float) rig.root.position.y = H * P.float;
  const poseFn = ARCH_POSE[fam.arch];
  const def = {
    id: tier ? tier.id : fam.id, name: tier ? tier.name : fam.id, family: fam.id,
    tier: tier ? tier.tierIndex + 1 : 1, arch: fam.arch, aspect: fam.aspect,
    ranged: fam.ranged, flying: fam.flying, height: H,
    level: tier ? tier.level : 1, hp: tier ? tier.hp : 1,
  };
  return {
    root: rig.root,
    height: H,
    def, rig,
    pose(action, t01) { poseFn(rig, ACTION_INTERNAL[action] || 'stand', sat(t01 || 0)); },
    dispose() { disposeTree(rig.root); },
  };
}

// ---------------------------------------------------------------------------
// Townsfolk
// ---------------------------------------------------------------------------

export const NPC_ARCHETYPES = [
  'peasant_m', 'peasant_f', 'merchant', 'guard', 'noble_m', 'noble_f',
  'monk', 'scholar', 'smith', 'sailor', 'beggar', 'child',
];

const SKIN_SHADES = [2, 3, 4, 5, 6, 7];
const CLOTH_RAMPS = ['dirt', 'wood', 'sand', 'grass', 'swamp', 'stone', 'water', 'blood', 'foliage', 'plaster'];

const NPC_DEFS = {
  peasant_m: { h: 172, cloth: ['dirt', 'wood', 'sand', 'grass'], hair: 1, beard: 0.4, params: {} },
  peasant_f: { h: 165, cloth: ['sand', 'plaster', 'grass', 'water'], hair: 'long', params: { robe: 1, hipW: 0.20, shoulderW: 0.21 } },
  merchant: { h: 170, cloth: ['blood', 'arcane', 'gold'], hair: 1, beard: 0.6, params: { robe: 'short', belt: 1, hipW: 0.24, torsoD: 0.17 } },
  guard: { h: 180, cloth: ['stone'], params: { weapon: 'spear', helm: 'cap', pads: 1, shield: 'round', body: 1 } },
  noble_m: { h: 176, cloth: ['arcane', 'blood', 'gold'], hair: 1, params: { cape: 1, robe: 'short', helm: 'hat' } },
  noble_f: { h: 168, cloth: ['arcane', 'sky', 'gold'], hair: 'long', params: { robe: 1, cape: 1, hipW: 0.20 } },
  monk: { h: 172, cloth: ['plaster', 'dirt'], params: { robe: 1, helm: 'hood' } },
  scholar: { h: 170, cloth: ['sky', 'water', 'stone'], hair: 1, beard: 0.7, params: { robe: 1, weapon: 'none' } },
  smith: { h: 176, cloth: ['wood', 'stone'], beard: 0.8, params: { shoulderW: 0.31, hipW: 0.26, armLen: 0.42, weapon: 'club' } },
  sailor: { h: 172, cloth: ['sky', 'water', 'plaster'], hair: 1, beard: 0.5, params: { helm: 'cap', hipW: 0.22 } },
  beggar: { h: 162, cloth: ['dirt', 'swamp'], hair: 1, beard: 0.9, params: { hunch: 0.30, tatter: 1, stride: 0.7, boots: 0 } },
  child: { h: 104, cloth: ['sand', 'grass', 'plaster'], hair: 1, params: { headR: 0.105, legLen: 0.42, armLen: 0.36, shoulderW: 0.20, hipW: 0.17, stride: 1.2 } },
};

/**
 * Build a townsfolk model. Same shape as buildCreature so the same baker,
 * billboard and animation code drives NPCs and monsters alike.
 */
export function buildNPC(archetype, seed = 1) {
  const nd = NPC_DEFS[archetype] || NPC_DEFS.peasant_m;
  const rnd = new Rand((seed >>> 0) ^ 0x51ed270b);
  const clothRamp = rnd.pick(nd.cloth);
  const cloth2Ramp = rnd.pick(CLOTH_RAMPS);
  const C = resolveCols({
    skin: ['flesh', rnd.pick(SKIN_SHADES)],
    cloth: [clothRamp, rnd.int(4, 10)],
    cloth2: [cloth2Ramp, rnd.int(3, 9)],
    hair: [rnd.pick(['wood', 'grey', 'fire', 'dirt']), rnd.int(2, 11)],
    metal: ['stone', rnd.int(8, 11)],
  });
  const P = {
    ...BIPED_D,
    hair: nd.hair ? (nd.hair === 'long' ? 'long' : 1) : 0,
    beard: nd.beard && rnd.bool(nd.beard) ? (rnd.bool(0.4) ? 'long' : 1) : 0,
    ...nd.params,
  };
  if (P.body) { P.body = 0; C.body = C.metal; }
  else C.body = C.cloth;
  // Proportion jitter keeps a crowd from looking cloned.
  P.legLen *= rnd.float(0.96, 1.04);
  P.shoulderW *= rnd.float(0.94, 1.08);
  P.hipW *= rnd.float(0.94, 1.10);
  const H = nd.h * rnd.float(0.95, 1.05);
  const rig = buildBipedRig(H, P, C, rnd);
  return {
    root: rig.root,
    height: H,
    def: { name: archetype, arch: 'biped', height: H },
    rig,
    pose(action, t01) { poseBiped(rig, ACTION_INTERNAL[action] || 'stand', sat(t01 || 0)); },
    dispose() { disposeTree(rig.root); },
  };
}
