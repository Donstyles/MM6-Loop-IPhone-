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
      g.add(box(u * 0.020, u * 0.30, u * 0.010, steel, { pivot: 'bottom', y: u * 0.05, taper: 0.35 }));
      g.add(box(u * 0.070, u * 0.014, u * 0.020, mulHex(steel, 0.7), { y: u * 0.045 }));
      g.add(box(u * 0.022, u * 0.055, u * 0.022, C.wood, { pivot: 'bottom', y: -u * 0.012 }));
      break;
    case 'dagger':
      g.add(box(u * 0.016, u * 0.13, u * 0.008, steel, { pivot: 'bottom', y: u * 0.03, taper: 0.25 }));
      g.add(box(u * 0.045, u * 0.010, u * 0.016, mulHex(steel, 0.7), { y: u * 0.028 }));
      g.add(box(u * 0.018, u * 0.04, u * 0.018, wood, { pivot: 'bottom', y: -u * 0.012 }));
      break;
    case 'axe':
      g.add(box(u * 0.022, u * 0.34, u * 0.022, wood, { pivot: 'bottom', y: -u * 0.05 }));
      g.add(box(u * 0.020, u * 0.11, u * 0.085, steel, { y: u * 0.24, z: u * 0.045, taperZ: 1.5 }));
      g.add(box(u * 0.020, u * 0.075, u * 0.05, mulHex(steel, 0.85), { y: u * 0.24, z: -u * 0.035 }));
      break;
    case 'club':
      g.add(box(u * 0.026, u * 0.26, u * 0.026, wood, { pivot: 'bottom', y: -u * 0.05, taper: 1.9, bulge: 0.15 }));
      break;
    case 'mace':
      g.add(box(u * 0.020, u * 0.24, u * 0.020, wood, { pivot: 'bottom', y: -u * 0.05 }));
      g.add(sph(u * 0.048, steel, { y: u * 0.20, detail: 0 }));
      for (let i = 0; i < 4; i++) {
        g.add(cone(u * 0.014, u * 0.035, mulHex(steel, 1.1),
          { y: u * 0.20, x: Math.cos(i * PI / 2) * u * 0.05, z: Math.sin(i * PI / 2) * u * 0.05, rz: -Math.cos(i * PI / 2) * 1.4, rx: Math.sin(i * PI / 2) * 1.4 }));
      }
      break;
    case 'staff': {
      g.add(box(u * 0.018, u * 0.56, u * 0.018, wood, { pivot: 'bottom', y: -u * 0.20, taper: 0.85 }));
      g.add(sph(u * 0.042, C.glow, { y: u * 0.375, emissive: 0.85, detail: 0 }));
      break;
    }
    case 'spear':
      g.add(box(u * 0.016, u * 0.62, u * 0.016, wood, { pivot: 'bottom', y: -u * 0.22 }));
      g.add(cone(u * 0.026, u * 0.09, steel, { y: u * 0.435 }));
      break;
    case 'scythe':
      g.add(box(u * 0.018, u * 0.54, u * 0.018, wood, { pivot: 'bottom', y: -u * 0.20 }));
      g.add(box(u * 0.014, u * 0.030, u * 0.20, steel, { y: u * 0.33, z: u * 0.10, taperZ: 0.4 }));
      break;
    case 'bow':
      g.add(box(u * 0.014, u * 0.34, u * 0.014, wood, { taper: 0.6, rz: 0.10, x: -u * 0.01 }));
      g.add(box(u * 0.012, u * 0.13, u * 0.012, wood, { y: u * 0.19, rz: 0.55 }));
      g.add(box(u * 0.012, u * 0.13, u * 0.012, wood, { y: -u * 0.19, rz: -0.55 }));
      g.add(box(u * 0.004, u * 0.40, u * 0.004, C.cloth2, { x: u * 0.035 }));
      break;
    case 'torch':
      g.add(box(u * 0.016, u * 0.20, u * 0.016, wood, { pivot: 'bottom', y: -u * 0.04 }));
      g.add(cone(u * 0.030, u * 0.075, rampHex('fire', 12), { y: u * 0.19, emissive: 1 }));
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
    for (let i = 0; i < 5; i++) {
      const len = span * (0.95 - i * 0.11);
      g.add(plate(len, span * 0.30, i % 2 ? mulHex(hex, 0.85) : hex,
        { x: side * len * 0.5, y: -span * 0.04 * i, z: -span * 0.07 * i, rz: side * (0.30 - i * 0.10), taper: 0.5, thick: span * 0.02 }));
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
  const serpentLower = P.lower === 'serpent';

  const bodyY = serpentLower ? H * 0.42 : legLen;
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
    sh.add(box(armR * 2, armUp, armR * 2, C.body, { pivot: 'top', taper: 0.85 }));
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
  } else {
    for (const [key, s] of [['L', -1], ['R', 1]]) {
      const hip = grp(s * H * P.stance, 0, 0);
      body.add(hip);
      hip.add(box(legR * 2.1, thighL, legR * 2.1, C.body, { pivot: 'top', taper: 0.85 }));
      const knee = grp(0, -thighL, 0);
      hip.add(knee);
      knee.add(box(legR * 1.7, shinL, legR * 1.7, C.cloth, { pivot: 'top', taper: 0.9 }));
      const foot = grp(0, -shinL, 0);
      knee.add(foot);
      foot.add(box(legR * 2.0, legR * 1.1, legR * 3.6, P.boots ? C.cloth2 : C.skin, { y: legR * 0.5, z: legR * 0.9 }));
      if (P.digitigrade) { hip.rotation.x = 0.45; knee.rotation.x = -0.85; foot.rotation.x = 0.40; }
      legs['leg' + key] = hip; legs['shin' + key] = knee; legs['foot' + key] = foot;
    }
  }

  if (P.robe) {
    const rl = serpentLower ? H * 0.22 : legLen * (P.robe === 'short' ? 0.55 : 0.95);
    body.add(box(hipW * 1.15, rl, torsoD * 1.15, C.cloth, { pivot: 'top', y: torsoH * 0.12, taper: 1.9, taperZ: 1.7 }));
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
      if (t < 0.42) { const u = ez(t / 0.42); a = u * 2.55; lean = -u * 0.22; step = -u * 0.25; }
      else if (t < 0.62) { const u = (t - 0.42) / 0.20; a = 2.55 - u * u * 3.75; lean = -0.22 + u * 0.62; step = -0.25 + u * 0.85; }
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
      r.armL.rotation.x += -2.35 * u + tr;
      r.armR.rotation.x += -2.35 * u - tr;
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
      r.root.rotation.x += e * 1.32;
      r.root.rotation.z += e * 0.28;
      r.root.scale.y *= 1 - e * 0.16;
      r.body.position.y += -e * H * 0.13;
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

const SERP_D = { coils: 8, coilR: 0.36, segs: 5, bodyR: 0.11, hood: 0, headR: 0.11, glow: 0, fangs: 1 };

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
    const g = grp(0, H * (0.10 + t * 0.78), 0);
    body.add(g);
    const rr = H * P.wide * (P.flame ? (0.55 - t * 0.40) : (0.55 - t * 0.30)) * (1 + 0.12 * Math.sin(i * 2.3));
    g.add(sph(rr, i % 2 ? C.body : mulHex(C.body, 1.12), {
      sy: P.flame ? 1.35 : 0.85, sx: 1 + rnd.float(-0.1, 0.1), sz: 1 + rnd.float(-0.1, 0.1),
      emissive: P.glow,
    }));
    lobes.push(g);
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
      g.add(box(H * 0.09, H * 0.36, H * 0.09, C.body, { pivot: 'top', taper: 0.6, emissive: P.glow }));
      const f = grp(0, -H * 0.36, 0);
      g.add(f);
      f.add(sph(H * 0.075, C.body, { emissive: P.glow }));
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
  const bodyY = legLen + bodyR * 0.7;

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
      const g = grp(i === 0 ? off * bodyR * 0.5 : 0, i === 0 ? bodyR * 0.45 : 0, i === 0 ? bodyLen * 0.42 : seg);
      parent.add(g);
      g.rotation.x = i === 0 ? -0.95 + off * 0.05 : 0.30;
      g.rotation.y = i === 0 ? off * 0.35 : 0;
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
  const pairs = P.frontLegs ? [[0.30, 'F'], [-0.30, 'B']] : [[-0.20, 'B']];
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
      } else {
        r.legBL.rotation.x += -sn * 0.5; r.legBR.rotation.x += sn * 0.5;
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
    default: r.body.position.y += Math.sin(spin) * H * 0.02; r.body.scale.setScalar(1 + Math.sin(spin * 2) * 0.05); break;
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
  };
  return C;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTIONS = {
  stand: { frames: 4, loop: true, fps: 5 },
  walk: { frames: 8, loop: true, fps: 10 },
  attack: { frames: 6, loop: false, fps: 12 },
  cast: { frames: 6, loop: false, fps: 10 },
  hit: { frames: 2, loop: false, fps: 10 },
  die: { frames: 8, loop: false, fps: 10 },
  dead: { frames: 1, loop: false, fps: 1 },
};

// ---------------------------------------------------------------------------
// The bestiary
// ---------------------------------------------------------------------------

const ASPECT = { biped: 0.80, quad: 1.30, insect: 1.25, serpent: 1.05, blob: 1.00, dragon: 1.45, wisp: 1.00, ghost: 0.85 };

function d(name, arch, family, tier, height, pal, o = {}) {
  return {
    name, arch, family, tier, height,
    palette: pal,
    aspect: o.aspect || ASPECT[arch] || 1,
    twoLegs: o.twoLegs !== undefined ? o.twoLegs : (arch === 'biped' || arch === 'ghost'),
    ranged: !!o.ranged,
    flying: !!o.flying,
    params: o,
  };
}

export const CREATURE_DEFS = {
  // --- humanoids ---
  goblin: d('Goblin', 'biped', 'goblin', 1, 118,
    { skin: ['grass', 5], skin2: ['grass', 3], cloth: ['dirt', 5], cloth2: ['wood', 4], metal: ['stone', 7] },
    { headR: 0.105, legLen: 0.42, torsoH: 0.30, hunch: 0.22, ears: 'long', weapon: 'club', shoulderW: 0.25, armLen: 0.44, stride: 1.1 }),
  goblin_shaman: d('Goblin Shaman', 'biped', 'goblin', 2, 124,
    { skin: ['swamp', 7], cloth: ['arcane', 3], cloth2: ['arcane', 5], glow: ['arcane', 7], metal: ['gold', 8] },
    { headR: 0.105, legLen: 0.42, hunch: 0.20, ears: 'long', weapon: 'staff', robe: 1, helm: 'hood', ranged: true }),
  goblin_king: d('Goblin King', 'biped', 'goblin', 3, 142,
    { skin: ['grass', 7], cloth: ['blood', 5], cloth2: ['blood', 7], metal: ['gold', 10] },
    { headR: 0.105, legLen: 0.42, hunch: 0.14, ears: 'long', weapon: 'axe', helm: 'crown', pads: 1, cape: 1, shoulderW: 0.30, hipW: 0.24 }),
  peasant: d('Peasant', 'biped', 'human', 1, 172,
    { skin: ['flesh', 5], cloth: ['dirt', 9], cloth2: ['wood', 5], hair: ['wood', 3] },
    { weapon: 'club', hair: 1 }),
  bandit: d('Bandit', 'biped', 'human', 1, 176,
    { skin: ['flesh', 4], cloth: ['wood', 4], cloth2: ['dirt', 3], metal: ['stone', 8] },
    { weapon: 'dagger', helm: 'hood', hunch: 0.08 }),
  thug: d('Thug', 'biped', 'human', 2, 184,
    { skin: ['flesh', 4], cloth: ['stone', 5], cloth2: ['wood', 3], hair: ['grey', 3] },
    { weapon: 'club', shoulderW: 0.30, hipW: 0.24, armLen: 0.44, headR: 0.070, hunch: 0.10, beard: 1 }),
  brigand: d('Brigand', 'biped', 'human', 2, 178,
    { skin: ['flesh', 5], cloth: ['blood', 4], cloth2: ['wood', 4], metal: ['stone', 9] },
    { weapon: 'sword', helm: 'cap', pads: 1, shield: 'round' }),
  apprentice_mage: d('Apprentice Mage', 'biped', 'mage', 1, 170,
    { skin: ['flesh', 6], cloth: ['sky', 6], cloth2: ['sky', 9], glow: ['sky', 12], hair: ['wood', 5] },
    { weapon: 'staff', robe: 1, helm: 'hood', ranged: true, armLen: 0.40 }),
  initiate_mage: d('Initiate Mage', 'biped', 'mage', 2, 172,
    { skin: ['flesh', 6], cloth: ['water', 8], cloth2: ['ice', 10], glow: ['ice', 12], hair: ['grey', 6] },
    { weapon: 'staff', robe: 1, helm: 'hood', ranged: true }),
  master_mage: d('Master Mage', 'biped', 'mage', 3, 174,
    { skin: ['flesh', 6], cloth: ['arcane', 4], cloth2: ['gold', 9], glow: ['arcane', 7], hair: ['grey', 11] },
    { weapon: 'staff', robe: 1, helm: 'hat', ranged: true, beard: 'long' }),
  acolyte: d('Acolyte', 'biped', 'priest', 1, 170,
    { skin: ['flesh', 5], cloth: ['plaster', 10], cloth2: ['plaster', 6], metal: ['gold', 8] },
    { robe: 1, helm: 'hood', weapon: 'none' }),
  priest_of_baa: d('Priest of Baa', 'biped', 'priest', 2, 176,
    { skin: ['flesh', 4], cloth: ['blood', 3], cloth2: ['blood', 6], metal: ['gold', 9], glow: ['blood', 11] },
    { robe: 1, helm: 'hood', weapon: 'mace', ranged: true }),
  cleric_of_baa: d('Cleric of Baa', 'biped', 'priest', 2, 174,
    { skin: ['flesh', 4], cloth: ['blood', 5], cloth2: ['grey', 3], metal: ['stone', 8], glow: ['blood', 12] },
    { robe: 1, helm: 'hood', weapon: 'mace', ranged: true }),
  high_priest: d('High Priest', 'biped', 'priest', 3, 180,
    { skin: ['flesh', 5], cloth: ['blood', 6], cloth2: ['gold', 10], metal: ['gold', 11], glow: ['fire', 12] },
    { robe: 1, helm: 'mitre', weapon: 'staff', cape: 1, ranged: true, beard: 'long' }),
  knight: d('Knight', 'biped', 'knight', 2, 182,
    { skin: ['flesh', 5], body: ['stone', 10], cloth: ['stone', 8], cloth2: ['blood', 6], metal: ['stone', 12] },
    { weapon: 'sword', shield: 'kite', helm: 'full', pads: 1, shoulderW: 0.28 }),
  crusader: d('Crusader', 'biped', 'knight', 3, 186,
    { skin: ['flesh', 5], body: ['grey', 11], cloth: ['blood', 6], cloth2: ['grey', 13], metal: ['grey', 13] },
    { weapon: 'sword', shield: 'kite', helm: 'full', pads: 1, cape: 1, shoulderW: 0.29 }),
  templar: d('Templar', 'biped', 'knight', 3, 188,
    { skin: ['flesh', 5], body: ['gold', 8], cloth: ['sky', 6], cloth2: ['gold', 12], metal: ['gold', 11] },
    { weapon: 'mace', shield: 'kite', helm: 'horned', pads: 1, cape: 1, shoulderW: 0.30 }),
  dwarf: d('Dwarf', 'biped', 'dwarf', 1, 124,
    { skin: ['flesh', 4], cloth: ['wood', 6], cloth2: ['blood', 5], hair: ['fire', 7], metal: ['stone', 9] },
    { headR: 0.105, legLen: 0.36, torsoH: 0.34, shoulderW: 0.30, hipW: 0.26, armLen: 0.38, beard: 'long', weapon: 'axe', stride: 0.85 }),
  dwarf_guard: d('Dwarf Guard', 'biped', 'dwarf', 2, 128,
    { skin: ['flesh', 4], body: ['stone', 9], cloth: ['stone', 7], cloth2: ['blood', 6], hair: ['wood', 3], metal: ['stone', 11] },
    { headR: 0.105, legLen: 0.36, torsoH: 0.34, shoulderW: 0.31, hipW: 0.27, armLen: 0.38, beard: 'long', weapon: 'axe', shield: 'round', helm: 'horned', pads: 1, stride: 0.85 }),

  // --- beasts ---
  wolf: d('Wolf', 'quad', 'wolf', 1, 88,
    { skin: ['grey', 6], body: ['grey', 6], skin2: ['grey', 3], hair: ['grey', 8], eye: ['fire', 11] },
    { bodyLen: 1.45, legLen: 0.58, headShape: 'wolf', mane: 1, tail: 0.6, glow: 1, stride: 1.25 }),
  dire_wolf: d('Dire Wolf', 'quad', 'wolf', 2, 108,
    { skin: ['stone', 4], body: ['stone', 4], skin2: ['stone', 2], hair: ['stone', 6], eye: ['fire', 13] },
    { bodyLen: 1.5, legLen: 0.58, headShape: 'wolf', mane: 1, tail: 0.62, glow: 1, spikes: 0, stride: 1.25 }),
  warg: d('Warg', 'quad', 'wolf', 3, 124,
    { skin: ['dirt', 3], body: ['dirt', 3], skin2: ['dirt', 1], hair: ['dirt', 5], eye: ['blood', 12], horn: ['grey', 4] },
    { bodyLen: 1.55, legLen: 0.56, headShape: 'wolf', mane: 1, tail: 0.6, glow: 1, spikes: 1, shaggy: 1, stride: 1.2 }),
  bear: d('Bear', 'quad', 'bear', 2, 132,
    { skin: ['wood', 5], body: ['wood', 5], skin2: ['wood', 3], hair: ['wood', 6], horn: ['sand', 12] },
    { bodyLen: 1.25, legLen: 0.48, bodyR: 0.36, headShape: 'wolf', headR: 0.26, ears: 'round', hump: 1, tail: 0.14, neck: 0.14, neckUp: 0.15, shaggy: 1, stride: 0.9 }),
  cave_bear: d('Cave Bear', 'quad', 'bear', 3, 160,
    { skin: ['wood', 2], body: ['wood', 2], skin2: ['grey', 2], hair: ['wood', 4], horn: ['sand', 12] },
    { bodyLen: 1.3, legLen: 0.48, bodyR: 0.38, headShape: 'wolf', headR: 0.27, ears: 'round', hump: 1, tail: 0.14, neck: 0.14, neckUp: 0.15, shaggy: 1, stride: 0.85 }),
  boar: d('Boar', 'quad', 'boar', 1, 84,
    { skin: ['dirt', 4], body: ['dirt', 4], skin2: ['dirt', 2], hair: ['grey', 3], horn: ['sand', 13] },
    { bodyLen: 1.35, legLen: 0.44, bodyR: 0.34, headShape: 'wolf', headR: 0.24, ears: 'point', hump: 1, tail: 0.22, neck: 0.10, neckUp: 0.05, tusk: 0.10, stride: 1.1 }),
  giant_rat: d('Giant Rat', 'quad', 'rat', 1, 58,
    { skin: ['dirt', 6], body: ['dirt', 6], skin2: ['flesh', 3], hair: ['dirt', 4], eye: ['blood', 11] },
    { bodyLen: 1.5, legLen: 0.42, bodyR: 0.28, headShape: 'rat', headR: 0.24, ears: 'round', tail: 1.1, tailUp: -0.15, glow: 1, stride: 1.3 }),
  giant_spider: d('Giant Spider', 'insect', 'spider', 2, 76,
    { skin: ['grey', 2], body: ['grey', 2], skin2: ['grey', 4], eye: ['blood', 12], glow: ['blood', 12] },
    { legs: 8, legLen: 0.72, bodyLen: 0.72, bodyR: 0.24, abdomen: 0.36, headR: 0.16, antennae: 0, carapace: 0, glow: 1, aspect: 1.5 }),
  phase_spider: d('Phase Spider', 'insect', 'spider', 3, 82,
    { skin: ['arcane', 3], body: ['arcane', 3], skin2: ['arcane', 5], glow: ['arcane', 7] },
    { legs: 8, legLen: 0.75, bodyLen: 0.72, bodyR: 0.24, abdomen: 0.36, headR: 0.16, antennae: 0, carapace: 0, glow: 1, aspect: 1.5 }),
  bat: d('Bat', 'biped', 'bat', 1, 40,
    { skin: ['stone', 3], body: ['stone', 3], skin2: ['stone', 2], wing: ['stone', 4], wing2: ['stone', 2], eye: ['fire', 12] },
    { headR: 0.20, legLen: 0.22, torsoH: 0.34, armLen: 0.12, shoulderW: 0.22, hipW: 0.18, wings: 'bat', wingSpan: 0.95, ears: 'long', flyer: 1, boots: 0, belt: 0, glow: 1, aspect: 1.7, flying: true }),
  giant_bat: d('Giant Bat', 'biped', 'bat', 2, 66,
    { skin: ['wood', 3], body: ['wood', 3], skin2: ['wood', 2], wing: ['wood', 4], wing2: ['wood', 2], eye: ['fire', 12] },
    { headR: 0.20, legLen: 0.22, torsoH: 0.34, armLen: 0.12, shoulderW: 0.22, hipW: 0.18, wings: 'bat', wingSpan: 1.0, ears: 'long', flyer: 1, boots: 0, belt: 0, glow: 1, aspect: 1.7, flying: true }),
  vampire_bat: d('Vampire Bat', 'biped', 'bat', 3, 60,
    { skin: ['blood', 3], body: ['blood', 3], skin2: ['blood', 2], wing: ['blood', 4], wing2: ['blood', 2], eye: ['blood', 13] },
    { headR: 0.20, legLen: 0.22, torsoH: 0.34, armLen: 0.12, shoulderW: 0.22, hipW: 0.18, wings: 'bat', wingSpan: 1.0, ears: 'long', flyer: 1, boots: 0, belt: 0, glow: 1, aspect: 1.7, flying: true }),
  cobra: d('Cobra', 'serpent', 'snake', 2, 108,
    { skin: ['swamp', 9], body: ['swamp', 7], skin2: ['swamp', 11], glow: ['gold', 12] },
    { hood: 0.36, coils: 8, glow: 1 }),
  serpent: d('Serpent', 'serpent', 'snake', 1, 92,
    { skin: ['foliage', 8], body: ['foliage', 6], skin2: ['foliage', 10], glow: ['fire', 11] },
    { hood: 0, coils: 9, glow: 1 }),

  // --- insectoids ---
  beetle: d('Beetle', 'insect', 'beetle', 1, 42,
    { skin: ['wood', 3], body: ['wood', 3], skin2: ['wood', 5], glow: ['grass', 10] },
    { legs: 6, legLen: 0.5, bodyR: 0.28, abdomen: 0.40, bodyLen: 0.85, aspect: 1.35 }),
  fire_beetle: d('Fire Beetle', 'insect', 'beetle', 2, 50,
    { skin: ['fire', 6], body: ['fire', 6], skin2: ['fire', 9], glow: ['fire', 13] },
    { legs: 6, legLen: 0.5, bodyR: 0.28, abdomen: 0.42, bodyLen: 0.85, glow: 1, aspect: 1.35 }),
  giant_beetle: d('Giant Beetle', 'insect', 'beetle', 3, 74,
    { skin: ['stone', 4], body: ['stone', 4], skin2: ['stone', 7], glow: ['ice', 10], horn: ['sand', 12] },
    { legs: 6, legLen: 0.5, bodyR: 0.30, abdomen: 0.46, bodyLen: 0.9, aspect: 1.35 }),
  scorpion: d('Scorpion', 'insect', 'scorpion', 2, 56,
    { skin: ['sand', 6], body: ['sand', 6], skin2: ['sand', 9], horn: ['sand', 13], glow: ['gold', 12] },
    { legs: 8, legLen: 0.48, bodyR: 0.24, abdomen: 0.26, bodyLen: 0.85, claws: 1, stinger: 1, aspect: 1.6 }),
  giant_ant: d('Giant Ant', 'insect', 'ant', 1, 52,
    { skin: ['dirt', 3], body: ['dirt', 3], skin2: ['dirt', 5], glow: ['dirt', 8] },
    { legs: 6, legLen: 0.55, bodyR: 0.22, abdomen: 0.32, bodyLen: 0.95, carapace: 0, aspect: 1.45 }),
  soldier_ant: d('Soldier Ant', 'insect', 'ant', 2, 66,
    { skin: ['blood', 4], body: ['blood', 4], skin2: ['blood', 7], glow: ['fire', 11] },
    { legs: 6, legLen: 0.55, bodyR: 0.24, abdomen: 0.34, bodyLen: 0.95, carapace: 0, aspect: 1.45 }),

  // --- undead ---
  skeleton: d('Skeleton', 'biped', 'skeleton', 1, 172,
    { skin: ['plaster', 12], body: ['plaster', 12], skin2: ['plaster', 9], cloth: ['plaster', 11], cloth2: ['stone', 5], metal: ['stone', 8], eye: ['blood', 10] },
    { headShape: 'skull', ribs: 1, weapon: 'sword', armR: 0.026, legR: 0.034, hipW: 0.15, shoulderW: 0.20, torsoD: 0.10, boots: 0, belt: 0, glow: 1 }),
  skeleton_knight: d('Skeleton Knight', 'biped', 'skeleton', 3, 180,
    { skin: ['plaster', 12], body: ['stone', 7], skin2: ['plaster', 9], cloth: ['stone', 5], cloth2: ['blood', 4], metal: ['stone', 10], eye: ['fire', 12] },
    { headShape: 'skull', ribs: 1, weapon: 'sword', shield: 'kite', helm: 'horned', pads: 1, armR: 0.032, legR: 0.040, glow: 1 }),
  zombie: d('Zombie', 'biped', 'zombie', 1, 170,
    { skin: ['swamp', 8], body: ['swamp', 7], skin2: ['swamp', 5], cloth: ['dirt', 4], cloth2: ['dirt', 2], hair: ['grey', 3], eye: ['grey', 12] },
    { hunch: 0.34, armLen: 0.46, tatter: 1, stride: 0.65, armSwing: 0.3, headR: 0.072, glow: 0 }),
  ghoul: d('Ghoul', 'biped', 'zombie', 2, 158,
    { skin: ['plaster', 6], body: ['plaster', 6], skin2: ['plaster', 4], cloth: ['grey', 3], cloth2: ['grey', 2], horn: ['plaster', 13], eye: ['fire', 11] },
    { hunch: 0.45, armLen: 0.52, digitigrade: 1, claws: 1, ears: 'point', tatter: 1, stride: 1.15, glow: 1, boots: 0 }),
  ghost: d('Ghost', 'ghost', 'ghost', 1, 176,
    { skin: ['ice', 11], body: ['ice', 10], skin2: ['ice', 8], cloth: ['ice', 9], cloth2: ['ice', 7], eye: ['ice', 14] },
    { lower: 'none', robe: 1, headR: 0.072, armLen: 0.44, glow: 1, boots: 0, belt: 0, float: 0.10 }),
  spectre: d('Spectre', 'ghost', 'ghost', 3, 182,
    { skin: ['arcane', 5], body: ['arcane', 4], skin2: ['arcane', 3], cloth: ['arcane', 2], cloth2: ['arcane', 4], glow: ['arcane', 7], eye: ['arcane', 7] },
    { lower: 'none', robe: 1, helm: 'hood', headShape: 'skull', armLen: 0.46, claws: 1, glow: 1, boots: 0, belt: 0, float: 0.14 }),
  lich: d('Lich', 'biped', 'lich', 3, 180,
    { skin: ['plaster', 11], body: ['arcane', 2], skin2: ['plaster', 8], cloth: ['arcane', 2], cloth2: ['gold', 9], metal: ['gold', 10], glow: ['arcane', 7], eye: ['arcane', 7] },
    { headShape: 'skull', robe: 1, helm: 'crown', weapon: 'staff', cape: 1, ribs: 1, armR: 0.028, glow: 1, ranged: true }),
  mummy: d('Mummy', 'biped', 'mummy', 2, 174,
    { skin: ['sand', 10], body: ['sand', 9], skin2: ['sand', 7], cloth: ['sand', 11], cloth2: ['sand', 6], eye: ['fire', 10] },
    { helm: 'wrap', tatter: 1, stride: 0.7, armSwing: 0.2, hunch: 0.10, glow: 1, boots: 0 }),
  vampire: d('Vampire', 'biped', 'vampire', 3, 182,
    { skin: ['plaster', 13], body: ['grey', 2], skin2: ['plaster', 10], cloth: ['grey', 1], cloth2: ['blood', 5], hair: ['grey', 1], eye: ['blood', 13] },
    { cape: 1, hair: 'long', claws: 1, glow: 1, ranged: true, headR: 0.070 }),

  // --- elemental / constructed ---
  fire_elemental: d('Fire Elemental', 'blob', 'elemental', 2, 190,
    { skin: ['fire', 10], body: ['fire', 9], glow: ['fire', 14] },
    { lobes: 6, wide: 0.55, flame: 1, glow: 0.9, core: 1, arms: 1, drip: 1 }),
  air_elemental: d('Air Elemental', 'blob', 'elemental', 2, 200,
    { skin: ['ice', 10], body: ['ice', 9], glow: ['ice', 14] },
    { lobes: 6, wide: 0.62, flame: 1, glow: 0.55, core: 1, arms: 1, drip: 1 }),
  water_elemental: d('Water Elemental', 'blob', 'elemental', 2, 190,
    { skin: ['water', 9], body: ['water', 8], glow: ['water', 13] },
    { lobes: 5, wide: 0.68, glow: 0.4, core: 1, arms: 1, drip: 1 }),
  earth_elemental: d('Earth Elemental', 'biped', 'elemental', 2, 210,
    { skin: ['dirt', 4], body: ['dirt', 5], skin2: ['stone', 4], cloth: ['dirt', 3], cloth2: ['stone', 3], horn: ['stone', 6] },
    { headShape: 'box', headR: 0.085, shoulderW: 0.36, hipW: 0.30, armLen: 0.48, armR: 0.062, legR: 0.075, legLen: 0.40, torsoH: 0.34, stride: 0.7, armSwing: 0.6, boots: 0, belt: 0 }),
  gargoyle: d('Gargoyle', 'biped', 'gargoyle', 2, 160,
    { skin: ['stone', 6], body: ['stone', 6], skin2: ['stone', 4], cloth: ['stone', 5], cloth2: ['stone', 3], wing: ['stone', 5], wing2: ['stone', 3], horn: ['stone', 9], eye: ['fire', 11] },
    { headShape: 'round', horns: 'devil', ears: 'point', claws: 1, wings: 'bat', wingSpan: 0.75, digitigrade: 1, hunch: 0.22, tail: 0.4, boots: 0, belt: 0, glow: 1, aspect: 1.05 }),
  stone_gargoyle: d('Stone Gargoyle', 'biped', 'gargoyle', 3, 190,
    { skin: ['grey', 5], body: ['grey', 5], skin2: ['grey', 3], cloth: ['grey', 4], cloth2: ['grey', 2], wing: ['grey', 4], wing2: ['grey', 2], horn: ['grey', 9], eye: ['fire', 12] },
    { headShape: 'bull', horns: 'ram', claws: 1, wings: 'bat', wingSpan: 0.85, digitigrade: 1, hunch: 0.20, tail: 0.45, shoulderW: 0.30, boots: 0, belt: 0, glow: 1, aspect: 1.1 }),
  golem: d('Golem', 'biped', 'golem', 2, 230,
    { skin: ['stone', 7], body: ['stone', 7], skin2: ['stone', 5], cloth: ['stone', 6], cloth2: ['stone', 4], glow: ['fire', 11] },
    { headShape: 'box', headR: 0.080, shoulderW: 0.38, hipW: 0.32, armLen: 0.50, armR: 0.066, legR: 0.082, legLen: 0.38, torsoH: 0.36, stride: 0.6, armSwing: 0.5, boots: 0, belt: 0, glow: 1 }),
  iron_golem: d('Iron Golem', 'biped', 'golem', 3, 250,
    { skin: ['grey', 8], body: ['grey', 7], skin2: ['grey', 5], cloth: ['grey', 6], cloth2: ['grey', 4], metal: ['grey', 11], glow: ['fire', 13] },
    { headShape: 'box', headR: 0.080, shoulderW: 0.40, hipW: 0.33, armLen: 0.50, armR: 0.070, legR: 0.086, legLen: 0.38, torsoH: 0.36, pads: 1, stride: 0.55, armSwing: 0.45, boots: 0, belt: 0, glow: 1 }),
  will_o_wisp: d("Will-o'-Wisp", 'wisp', 'wisp', 2, 80,
    { skin: ['ice', 12], body: ['ice', 10], glow: ['ice', 15] }, { ranged: true, flying: true }),

  // --- big ---
  ogre: d('Ogre', 'biped', 'ogre', 2, 250,
    { skin: ['swamp', 9], body: ['swamp', 8], skin2: ['swamp', 6], cloth: ['dirt', 4], cloth2: ['wood', 3], hair: ['wood', 2], horn: ['sand', 11] },
    { headR: 0.082, shoulderW: 0.34, hipW: 0.30, armLen: 0.50, armR: 0.058, legLen: 0.42, torsoH: 0.34, hunch: 0.20, weapon: 'club', beard: 1, stride: 0.8, armSwing: 0.85, ears: 'point', aspect: 0.92 }),
  troll: d('Troll', 'biped', 'troll', 3, 268,
    { skin: ['foliage', 6], body: ['foliage', 5], skin2: ['foliage', 3], cloth: ['dirt', 3], cloth2: ['swamp', 4], horn: ['sand', 10], eye: ['gold', 11] },
    { headR: 0.078, shoulderW: 0.34, hipW: 0.28, armLen: 0.58, armR: 0.055, legLen: 0.38, torsoH: 0.34, hunch: 0.34, claws: 1, snout: 1, ears: 'point', stride: 0.85, glow: 1, boots: 0, aspect: 0.95 }),
  cyclops: d('Cyclops', 'biped', 'cyclops', 3, 300,
    { skin: ['flesh', 3], body: ['flesh', 3], skin2: ['flesh', 2], cloth: ['dirt', 5], cloth2: ['wood', 3], hair: ['grey', 2], eye: ['fire', 13] },
    { headR: 0.085, shoulderW: 0.35, hipW: 0.30, armLen: 0.52, armR: 0.058, legLen: 0.44, torsoH: 0.32, weapon: 'club', eyes: 1, hair: 1, beard: 1, stride: 0.75, glow: 1, aspect: 0.92 }),
  minotaur: d('Minotaur', 'biped', 'minotaur', 3, 265,
    { skin: ['wood', 4], body: ['wood', 4], skin2: ['wood', 2], cloth: ['blood', 4], cloth2: ['dirt', 4], horn: ['sand', 12], metal: ['stone', 9], eye: ['fire', 12] },
    { headShape: 'bull', horns: 'bull', headR: 0.085, shoulderW: 0.36, hipW: 0.28, armLen: 0.50, armR: 0.058, legLen: 0.44, digitigrade: 1, weapon: 'axe', tail: 0.35, hunch: 0.14, glow: 1, aspect: 0.95 }),
  giant: d('Giant', 'biped', 'giant', 3, 330,
    { skin: ['flesh', 4], body: ['flesh', 4], skin2: ['flesh', 3], cloth: ['wood', 5], cloth2: ['dirt', 4], hair: ['wood', 3] },
    { headR: 0.076, shoulderW: 0.32, hipW: 0.27, armLen: 0.48, legLen: 0.46, weapon: 'club', beard: 'long', hair: 1, stride: 0.7 }),
  hydra: d('Hydra', 'dragon', 'hydra', 3, 235,
    { skin: ['swamp', 6], body: ['swamp', 6], skin2: ['swamp', 4], horn: ['sand', 10], glow: ['gold', 12], wing: ['swamp', 5], wing2: ['swamp', 3] },
    { necks: 3, neck: 0.60, wings: 0, bodyLen: 1.15, tail: 0.8, headR: 0.11, spikes: 1, aspect: 1.6 }),
  dragon_green: d('Green Dragon', 'dragon', 'dragon', 3, 290,
    { skin: ['foliage', 7], body: ['foliage', 6], skin2: ['foliage', 4], horn: ['sand', 11], glow: ['gold', 13], wing: ['foliage', 5], wing2: ['foliage', 3] },
    { aspect: 1.55 }),
  dragon_red: d('Red Dragon', 'dragon', 'dragon', 3, 320,
    { skin: ['blood', 7], body: ['blood', 6], skin2: ['blood', 4], horn: ['sand', 12], glow: ['fire', 14], wing: ['blood', 5], wing2: ['blood', 3] },
    { aspect: 1.55 }),
  dragon_black: d('Black Dragon', 'dragon', 'dragon', 3, 340,
    { skin: ['grey', 2], body: ['grey', 2], skin2: ['grey', 1], horn: ['grey', 8], glow: ['arcane', 7], wing: ['grey', 3], wing2: ['grey', 1] },
    { aspect: 1.55 }),
  wyvern: d('Wyvern', 'dragon', 'wyvern', 3, 230,
    { skin: ['swamp', 8], body: ['swamp', 7], skin2: ['swamp', 5], horn: ['sand', 11], glow: ['fire', 12], wing: ['swamp', 6], wing2: ['swamp', 4] },
    { frontLegs: 0, wingSpan: 1.25, neck: 0.5, tail: 1.1, bodyLen: 1.0, flying: true, aspect: 1.6 }),
  griffin: d('Griffin', 'dragon', 'griffin', 3, 195,
    { skin: ['sand', 9], body: ['sand', 9], skin2: ['wood', 6], horn: ['gold', 11], glow: ['gold', 13], wing: ['sand', 11], wing2: ['sand', 7] },
    { headShape: 'beak', wings: 'feather', wingSpan: 1.15, neck: 0.4, tail: 0.7, bodyLen: 1.15, spikes: 0, headR: 0.12, flying: true, aspect: 1.5 }),
  roc: d('Roc', 'dragon', 'bird', 3, 260,
    { skin: ['wood', 6], body: ['wood', 6], skin2: ['wood', 4], horn: ['gold', 12], glow: ['gold', 13], wing: ['wood', 8], wing2: ['wood', 5] },
    { headShape: 'beak', wings: 'feather', wingSpan: 1.5, frontLegs: 0, neck: 0.42, tail: 0.5, bodyLen: 1.0, spikes: 0, headR: 0.12, flying: true, aspect: 1.7 }),
  harpy: d('Harpy', 'biped', 'harpy', 2, 152,
    { skin: ['flesh', 5], body: ['flesh', 5], skin2: ['wood', 5], cloth: ['wood', 6], cloth2: ['wood', 4], hair: ['blood', 5], wing: ['wood', 7], wing2: ['wood', 4], horn: ['sand', 12] },
    { wings: 'feather', wingSpan: 0.85, digitigrade: 1, claws: 1, hair: 'long', flyer: 1, boots: 0, belt: 0, aspect: 1.25, flying: true }),
  medusa: d('Medusa', 'biped', 'medusa', 3, 190,
    { skin: ['grass', 8], body: ['grass', 7], skin2: ['grass', 5], cloth: ['gold', 8], cloth2: ['gold', 11], glow: ['gold', 13], eye: ['fire', 12] },
    { lower: 'serpent', snakes: 1, weapon: 'bow', ranged: true, headR: 0.072, aspect: 1.1, boots: 0 }),
  titan: d('Titan', 'biped', 'titan', 3, 380,
    { skin: ['flesh', 6], body: ['ice', 9], skin2: ['flesh', 4], cloth: ['sky', 8], cloth2: ['gold', 11], metal: ['gold', 12], hair: ['grey', 12], glow: ['ice', 14] },
    { headR: 0.072, shoulderW: 0.30, weapon: 'spear', helm: 'crown', cape: 1, pads: 1, beard: 'long', hair: 1, glow: 1 }),

  // --- aquatic / misc ---
  swamp_thing: d('Swamp Thing', 'biped', 'swamp', 2, 190,
    { skin: ['swamp', 6], body: ['swamp', 5], skin2: ['foliage', 4], cloth: ['swamp', 4], cloth2: ['foliage', 3], horn: ['swamp', 10], eye: ['gold', 12] },
    { headR: 0.080, shoulderW: 0.32, armLen: 0.50, hunch: 0.28, claws: 1, tatter: 1, stride: 0.8, boots: 0, belt: 0, glow: 1 }),
  lizardman: d('Lizardman', 'biped', 'lizard', 2, 178,
    { skin: ['foliage', 8], body: ['foliage', 7], skin2: ['foliage', 5], cloth: ['dirt', 5], cloth2: ['sand', 6], horn: ['sand', 11], eye: ['gold', 12] },
    { headShape: 'lizard', horns: 'crest', tail: 0.55, weapon: 'spear', shield: 'round', digitigrade: 1, glow: 1, boots: 0, aspect: 1.0 }),
  naga: d('Naga', 'biped', 'naga', 3, 200,
    { skin: ['water', 9], body: ['water', 8], skin2: ['ice', 7], cloth: ['gold', 9], cloth2: ['gold', 12], glow: ['ice', 13], eye: ['gold', 13] },
    { lower: 'serpent', headShape: 'lizard', weapon: 'spear', headR: 0.070, glow: 1, aspect: 1.15 }),
  slime: d('Slime', 'blob', 'slime', 1, 90,
    { skin: ['grass', 7], body: ['grass', 6], glow: ['grass', 12] },
    { lobes: 4, wide: 0.85, drip: 1, aspect: 1.15 }),
  ooze: d('Ooze', 'blob', 'slime', 2, 105,
    { skin: ['arcane', 3], body: ['arcane', 2], glow: ['arcane', 7] },
    { lobes: 4, wide: 0.9, drip: 1, glow: 0.25, aspect: 1.2 }),
  devil: d('Devil', 'biped', 'devil', 3, 225,
    { skin: ['blood', 6], body: ['blood', 5], skin2: ['blood', 3], cloth: ['grey', 2], cloth2: ['fire', 7], horn: ['grey', 3], wing: ['blood', 3], wing2: ['grey', 2], glow: ['fire', 13], eye: ['fire', 14] },
    { horns: 'devil', wings: 'bat', wingSpan: 0.8, tail: 0.55, weapon: 'scythe', claws: 1, digitigrade: 1, glow: 1, boots: 0, aspect: 1.1 }),
  imp: d('Imp', 'biped', 'devil', 1, 86,
    { skin: ['blood', 8], body: ['blood', 7], skin2: ['blood', 5], cloth: ['grey', 3], cloth2: ['fire', 8], horn: ['grey', 4], wing: ['blood', 5], wing2: ['grey', 3], glow: ['fire', 12], eye: ['fire', 13] },
    { headR: 0.115, horns: 'devil', ears: 'long', wings: 'bat', wingSpan: 0.7, tail: 0.5, claws: 1, digitigrade: 1, flyer: 1, glow: 1, boots: 0, belt: 0, aspect: 1.3, flying: true }),
  demon: d('Demon', 'biped', 'devil', 3, 255,
    { skin: ['fire', 5], body: ['fire', 4], skin2: ['blood', 3], cloth: ['grey', 2], cloth2: ['fire', 9], horn: ['sand', 9], wing: ['grey', 2], wing2: ['grey', 1], glow: ['fire', 14], eye: ['fire', 14] },
    { headShape: 'bull', horns: 'ram', shoulderW: 0.36, armLen: 0.52, wings: 'bat', wingSpan: 0.95, tail: 0.5, weapon: 'sword', claws: 1, digitigrade: 1, glow: 1, boots: 0, pads: 1, aspect: 1.15 }),
  dragonfly: d('Dragonfly', 'insect', 'insect', 1, 46,
    { skin: ['ice', 9], body: ['ice', 8], skin2: ['water', 8], glow: ['ice', 14], wing: ['ice', 13], wing2: ['ice', 10] },
    { legs: 6, legLen: 0.35, bodyR: 0.16, abdomen: 0.14, bodyLen: 1.3, wings: 'insect', wingSpan: 0.95, carapace: 0, glow: 1, aspect: 1.8, flying: true }),
};

export const CREATURE_KINDS = Object.keys(CREATURE_DEFS);

const ARCH_BUILD = {
  biped: buildBipedRig, ghost: buildGhostRig, quad: buildQuadRig, insect: buildInsectRig,
  serpent: buildSerpentRig, blob: buildBlobRig, dragon: buildDragonRig, wisp: buildWispRig,
};
const ARCH_DEFAULTS = {
  biped: BIPED_D, ghost: BIPED_D, quad: QUAD_D, insect: INSECT_D,
  serpent: SERP_D, blob: BLOB_D, dragon: DRAGON_D, wisp: {},
};
const ARCH_POSE = {
  biped: poseBiped, ghost: poseBiped, quad: poseQuad, insect: poseInsect,
  serpent: poseSerpent, blob: poseBlob, dragon: poseDragon, wisp: poseWisp,
};

/**
 * Build a creature model.
 * @param {string} kind key of CREATURE_DEFS
 * @param {number} seed
 * @returns {{root:THREE.Group, height:number, pose:Function, dispose:Function, def:object}}
 */
export function buildCreature(kind, seed = 1) {
  const def = CREATURE_DEFS[kind];
  if (!def) throw new Error('unknown creature: ' + kind);
  const rnd = new Rand((seed >>> 0) ^ 0x9e3779b9);
  const C = resolveCols(def.palette);
  const P = { ...ARCH_DEFAULTS[def.arch], ...def.params };
  // A little per-instance variation so a pack of wolves is not identical.
  const H = def.height * rnd.float(0.94, 1.06);
  const rig = ARCH_BUILD[def.arch](H, P, C, rnd);
  if (P.float) rig.root.position.y = H * P.float;
  const poseFn = ARCH_POSE[def.arch];
  return {
    root: rig.root,
    height: H,
    def,
    rig,
    pose(action, t01) { poseFn(rig, action in ACTIONS ? action : 'stand', sat(t01 || 0)); },
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
    def: { name: archetype, arch: 'biped', aspect: 0.80, height: H },
    rig,
    pose(action, t01) { poseBiped(rig, action in ACTIONS ? action : 'stand', sat(t01 || 0)); },
    dispose() { disposeTree(rig.root); },
  };
}
