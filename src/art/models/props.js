import * as THREE from 'three';
import { Rand } from '../../core/rng.js';
import { rampHex } from '../../core/palette.js';
import { box, cyl, cone, sph, plate, grp, mulHex, disposeTree } from './creatures.js';

// ---------------------------------------------------------------------------
// World props and ground loot.
//
// Same deal as flora: everything here becomes a billboard, so the models are
// built for a clean silhouette and a strong lit/shadowed split rather than
// geometric accuracy. Ground items are deliberately over-scaled and tilted
// towards the camera - MM6's dropped loot sprites are readable icons lying on
// the floor, not miniature simulations.
// ---------------------------------------------------------------------------

const PI = Math.PI;

function plank(g, w, h, d, hex, o) { g.add(box(w, h, d, hex, o)); }

function barrelBody(H, hexWood, hexBand, rnd) {
  const g = new THREE.Group();
  const staves = 9;
  for (let i = 0; i < staves; i++) {
    const a = (i / staves) * PI * 2;
    const r = H * 0.34;
    g.add(box(H * 0.14, H * 0.92, H * 0.09, mulHex(hexWood, 0.85 + (i % 3) * 0.12), {
      pivot: 'bottom', x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a, bulge: 0.22,
    }));
  }
  for (const y of [0.14, 0.5, 0.84]) {
    g.add(cyl(H * 0.40, H * 0.40, H * 0.06, hexBand, { seg: 10, y: H * y, open: true }));
  }
  g.add(cyl(H * 0.32, H * 0.32, H * 0.05, mulHex(hexWood, 1.2), { seg: 9, y: H * 0.93 }));
  return g;
}

const BUILDERS = {
  chest: (H, rnd, open) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 4), band = rampHex('stone', 8), gold = rampHex('gold', 10);
    g.add(box(H * 1.35, H * 0.62, H * 0.85, wood, { pivot: 'bottom' }));
    for (const x of [-0.5, 0.5]) g.add(box(H * 0.10, H * 0.64, H * 0.88, band, { pivot: 'bottom', x: H * 1.35 * x }));
    const lid = grp(0, H * 0.62, -H * 0.42);
    g.add(lid);
    lid.add(cyl(H * 0.42, H * 0.42, H * 1.35, wood, { seg: 8, rz: PI / 2, y: 0, z: H * 0.42 }));
    lid.add(cyl(H * 0.44, H * 0.44, H * 0.12, band, { seg: 9, rz: PI / 2, z: H * 0.42 }));
    if (open) lid.rotation.x = -2.1;
    else g.add(box(H * 0.22, H * 0.22, H * 0.10, gold, { y: H * 0.52, z: H * 0.44 }));
    if (open) {
      g.add(box(H * 1.1, H * 0.18, H * 0.6, gold, { y: H * 0.5 }));
      for (let i = 0; i < 6; i++) g.add(sph(H * 0.07, rampHex('gold', 12), { x: rnd.float(-0.5, 0.5) * H, z: rnd.float(-0.25, 0.25) * H, y: H * 0.62 }));
    }
    return g;
  },
  chest_open: (H, rnd) => BUILDERS.chest(H, rnd, true),
  barrel: (H, rnd) => barrelBody(H, rampHex('wood', 5), rampHex('stone', 7), rnd),
  crate: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 6);
    g.add(box(H * 0.95, H * 0.95, H * 0.95, wood, { pivot: 'bottom' }));
    for (const z of [-1, 1]) {
      g.add(box(H * 1.0, H * 0.09, H * 0.02, mulHex(wood, 0.65), { y: H * 0.18, z: z * H * 0.48 }));
      g.add(box(H * 1.0, H * 0.09, H * 0.02, mulHex(wood, 0.65), { y: H * 0.78, z: z * H * 0.48 }));
      g.add(box(H * 1.0, H * 0.09, H * 0.02, mulHex(wood, 0.8), { y: H * 0.48, z: z * H * 0.48, rz: 0.78 }));
    }
    return g;
  },
  sack: (H, rnd) => {
    const g = new THREE.Group();
    const c = rampHex('sand', 8);
    g.add(sph(H * 0.48, c, { y: H * 0.42, sy: 0.9, detail: 1 }));
    g.add(sph(H * 0.30, mulHex(c, 1.1), { y: H * 0.78, sy: 0.8 }));
    g.add(cyl(H * 0.13, H * 0.16, H * 0.16, mulHex(c, 0.8), { seg: 7, y: H * 0.94 }));
    g.add(cyl(H * 0.18, H * 0.18, H * 0.05, rampHex('wood', 3), { seg: 8, y: H * 0.92 }));
    return g;
  },
  campfire: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      g.add(sph(H * 0.13, mulHex(stone, rnd.float(0.8, 1.2)), { x: Math.cos(a) * H * 0.5, z: Math.sin(a) * H * 0.5, y: H * 0.08, sy: 0.7 }));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + 0.4;
      g.add(box(H * 0.09, H * 0.55, H * 0.09, rampHex('wood', 2), { pivot: 'bottom', y: H * 0.03, x: Math.cos(a) * H * 0.14, z: Math.sin(a) * H * 0.14, rz: Math.cos(a) * 0.5, rx: -Math.sin(a) * 0.5 }));
    }
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      g.add(cone(H * (0.24 - t * 0.16), H * (0.34 - t * 0.14), rampHex('fire', 8 + i), { y: H * (0.16 + t * 0.42), emissive: 0.9, seg: 6, ry: t * 2 }));
    }
    return g;
  },
  well: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 7);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      g.add(box(H * 0.22, H * 0.42, H * 0.16, mulHex(stone, 0.82 + (i % 3) * 0.14), { pivot: 'bottom', x: Math.cos(a) * H * 0.52, z: Math.sin(a) * H * 0.52, ry: -a }));
    }
    g.add(cyl(H * 0.45, H * 0.45, H * 0.06, rampHex('water', 6), { seg: 12, y: H * 0.30 }));
    for (const s of [-1, 1]) g.add(box(H * 0.10, H * 0.85, H * 0.10, rampHex('wood', 4), { pivot: 'bottom', x: s * H * 0.5, y: H * 0.42 }));
    g.add(cyl(H * 0.08, H * 0.08, H * 1.05, rampHex('wood', 6), { seg: 7, rz: PI / 2, y: H * 1.2 }));
    g.add(box(H * 1.3, H * 0.08, H * 0.9, rampHex('wood', 3), { y: H * 1.34, rx: 0.0 }));
    g.add(box(H * 1.3, H * 0.08, H * 0.9, rampHex('wood', 5), { y: H * 1.42 }));
    g.add(box(H * 0.02, H * 0.35, H * 0.02, rampHex('grey', 6), { pivot: 'top', y: H * 1.18 }));
    g.add(cyl(H * 0.14, H * 0.12, H * 0.18, rampHex('stone', 9), { seg: 7, y: H * 0.75 }));
    return g;
  },
  signpost: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 5);
    g.add(box(H * 0.10, H * 0.95, H * 0.10, wood, { pivot: 'bottom' }));
    g.add(box(H * 0.75, H * 0.24, H * 0.05, mulHex(wood, 1.2), { y: H * 0.82, x: H * 0.25, z: H * 0.04 }));
    g.add(box(H * 0.60, H * 0.20, H * 0.05, mulHex(wood, 1.05), { y: H * 0.55, x: -H * 0.22, z: H * 0.04 }));
    for (let i = 0; i < 5; i++) g.add(box(H * 0.07, H * 0.03, H * 0.02, rampHex('grey', 2), { y: H * 0.82, x: H * (0.02 + i * 0.11), z: H * 0.07 }));
    return g;
  },
  lamppost: (H, rnd) => {
    const g = new THREE.Group();
    const iron = rampHex('grey', 4);
    g.add(cyl(H * 0.05, H * 0.09, H * 0.90, iron, { seg: 7, pivot: 'bottom' }));
    g.add(cyl(H * 0.13, H * 0.15, H * 0.06, iron, { seg: 8, y: H * 0.02 }));
    g.add(box(H * 0.20, H * 0.22, H * 0.20, rampHex('gold', 12), { y: H * 1.0, emissive: 0.85 }));
    g.add(box(H * 0.24, H * 0.04, H * 0.24, iron, { y: H * 1.13 }));
    g.add(cone(H * 0.17, H * 0.16, iron, { y: H * 1.21 }));
    return g;
  },
  torch_wall: (H, rnd) => {
    const g = new THREE.Group();
    const iron = rampHex('grey', 4);
    g.add(box(H * 0.16, H * 0.32, H * 0.08, iron, { pivot: 'bottom', y: H * 0.35 }));
    g.add(box(H * 0.06, H * 0.30, H * 0.06, iron, { y: H * 0.62, z: H * 0.10, rx: -0.5 }));
    g.add(cyl(H * 0.13, H * 0.09, H * 0.20, iron, { seg: 7, y: H * 0.78, z: H * 0.19 }));
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      g.add(cone(H * (0.13 - t * 0.09), H * (0.26 - t * 0.10), rampHex('fire', 9 + i), { y: H * (0.90 + t * 0.22), z: H * 0.19, emissive: 0.95, seg: 6, ry: t * 2 }));
    }
    return g;
  },
  altar: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 6);
    g.add(box(H * 1.25, H * 0.14, H * 0.85, mulHex(stone, 0.9), { pivot: 'bottom' }));
    g.add(box(H * 0.85, H * 0.70, H * 0.55, stone, { pivot: 'bottom', y: H * 0.14, taper: 1.15 }));
    g.add(box(H * 1.35, H * 0.16, H * 0.95, mulHex(stone, 1.2), { pivot: 'bottom', y: H * 0.84 }));
    g.add(sph(H * 0.20, rampHex('blood', 9), { y: H * 1.10, emissive: 0.6, detail: 1 }));
    for (const s of [-1, 1]) g.add(cyl(H * 0.05, H * 0.06, H * 0.22, rampHex('gold', 9), { seg: 6, x: s * H * 0.5, y: H * 1.0 }));
    return g;
  },
  statue: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 9);
    g.add(box(H * 0.62, H * 0.14, H * 0.62, mulHex(stone, 0.8), { pivot: 'bottom' }));
    g.add(box(H * 0.50, H * 0.10, H * 0.50, mulHex(stone, 0.92), { pivot: 'bottom', y: H * 0.14 }));
    const body = grp(0, H * 0.24, 0);
    g.add(body);
    body.add(box(H * 0.30, H * 0.42, H * 0.20, stone, { pivot: 'bottom', taper: 1.15 }));
    body.add(box(H * 0.34, H * 0.30, H * 0.24, stone, { pivot: 'bottom', y: H * 0.42, taper: 0.85 }));
    body.add(sph(H * 0.12, mulHex(stone, 1.1), { y: H * 0.84 }));
    for (const s of [-1, 1]) {
      body.add(box(H * 0.09, H * 0.36, H * 0.09, stone, { pivot: 'top', x: s * H * 0.20, y: H * 0.70, rz: s * 0.35 }));
      body.add(box(H * 0.11, H * 0.42, H * 0.11, stone, { pivot: 'top', x: s * H * 0.08, y: 0 }));
    }
    body.add(box(H * 0.04, H * 0.46, H * 0.10, mulHex(stone, 1.2), { x: H * 0.30, y: H * 0.52, rz: 0.2 }));
    return g;
  },
  gravestone: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 5);
    g.add(box(H * 0.62, H * 0.85, H * 0.14, stone, { pivot: 'bottom', rz: rnd.float(-0.10, 0.10) }));
    g.add(cyl(H * 0.31, H * 0.31, H * 0.14, stone, { seg: 9, rx: PI / 2, y: H * 0.85 }));
    g.add(box(H * 0.40, H * 0.10, H * 0.03, mulHex(stone, 0.6), { y: H * 0.62, z: H * 0.08 }));
    g.add(box(H * 0.30, H * 0.08, H * 0.03, mulHex(stone, 0.6), { y: H * 0.46, z: H * 0.08 }));
    g.add(box(H * 0.80, H * 0.10, H * 0.45, rampHex('grass', 5), { pivot: 'bottom', y: -H * 0.01 }));
    return g;
  },
  fountain: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 10);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * PI * 2;
      g.add(box(H * 0.26, H * 0.30, H * 0.16, mulHex(stone, 0.85 + (i % 3) * 0.12), { pivot: 'bottom', x: Math.cos(a) * H * 0.85, z: Math.sin(a) * H * 0.85, ry: -a }));
    }
    g.add(cyl(H * 0.80, H * 0.80, H * 0.06, rampHex('water', 7), { seg: 14, y: H * 0.22 }));
    g.add(cyl(H * 0.16, H * 0.24, H * 0.55, stone, { seg: 8, pivot: 'bottom', y: H * 0.20 }));
    g.add(cyl(H * 0.42, H * 0.30, H * 0.10, stone, { seg: 10, y: H * 0.78 }));
    g.add(cyl(H * 0.36, H * 0.36, H * 0.04, rampHex('water', 9), { seg: 10, y: H * 0.83 }));
    g.add(cyl(H * 0.06, H * 0.09, H * 0.30, stone, { seg: 7, pivot: 'bottom', y: H * 0.83 }));
    g.add(sph(H * 0.14, rampHex('water', 11), { y: H * 1.18, emissive: 0.3 }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      g.add(box(H * 0.04, H * 0.34, H * 0.04, rampHex('water', 10), { x: Math.cos(a) * H * 0.22, z: Math.sin(a) * H * 0.22, y: H * 1.0, rz: -Math.cos(a) * 0.5, rx: Math.sin(a) * 0.5, emissive: 0.2 }));
    }
    return g;
  },
  cart: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 5);
    const bed = grp(0, H * 0.45, 0);
    g.add(bed);
    bed.add(box(H * 1.0, H * 0.10, H * 1.7, wood, {}));
    for (const s of [-1, 1]) bed.add(box(H * 0.08, H * 0.36, H * 1.7, mulHex(wood, 1.15), { x: s * H * 0.5, y: H * 0.20 }));
    bed.add(box(H * 1.0, H * 0.36, H * 0.08, mulHex(wood, 1.1), { y: H * 0.20, z: -H * 0.85 }));
    for (const s of [-1, 1]) {
      const w = grp(s * H * 0.58, H * 0.45, H * 0.2);
      g.add(w);
      w.add(cyl(H * 0.45, H * 0.45, H * 0.08, mulHex(wood, 0.8), { seg: 12, rz: PI / 2 }));
      for (let i = 0; i < 6; i++) w.add(box(H * 0.10, H * 0.05, H * 0.80, mulHex(wood, 1.2), { rx: (i / 6) * PI }));
    }
    g.add(box(H * 0.09, H * 0.09, H * 0.9, wood, { y: H * 0.36, z: H * 1.2, rx: 0.22 }));
    return g;
  },
  haystack: (H, rnd) => {
    const g = new THREE.Group();
    const hay = rampHex('sand', 9);
    g.add(cone(H * 0.72, H * 1.0, hay, { y: H * 0.5, seg: 9 }));
    g.add(cone(H * 0.55, H * 0.5, mulHex(hay, 1.15), { y: H * 0.85, seg: 8 }));
    for (let i = 0; i < 14; i++) {
      const a = rnd.float(0, PI * 2), t = rnd.float(0.1, 0.9);
      g.add(box(H * 0.03, H * 0.22, H * 0.03, mulHex(hay, rnd.float(0.7, 1.25)), {
        x: Math.cos(a) * H * 0.7 * (1 - t), z: Math.sin(a) * H * 0.7 * (1 - t), y: H * t,
        rz: rnd.float(-1, 1), rx: rnd.float(-1, 1),
      }));
    }
    g.add(box(H * 0.05, H * 1.25, H * 0.05, rampHex('wood', 4), { pivot: 'bottom', y: H * 0.05 }));
    return g;
  },
  anvil: (H, rnd) => {
    const g = new THREE.Group();
    const iron = rampHex('grey', 4), wood = rampHex('wood', 3);
    g.add(cyl(H * 0.42, H * 0.48, H * 0.42, wood, { seg: 9, pivot: 'bottom' }));
    g.add(box(H * 0.42, H * 0.16, H * 0.9, iron, { pivot: 'bottom', y: H * 0.42, taper: 0.7 }));
    g.add(box(H * 0.30, H * 0.22, H * 0.65, mulHex(iron, 0.85), { pivot: 'bottom', y: H * 0.52, taper: 1.5, taperZ: 1.25 }));
    g.add(box(H * 0.46, H * 0.14, H * 1.05, mulHex(iron, 1.25), { pivot: 'bottom', y: H * 0.72 }));
    g.add(cone(H * 0.14, H * 0.45, mulHex(iron, 1.1), { y: H * 0.79, z: H * 0.72, rx: PI / 2 }));
    return g;
  },
  bench: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 6);
    g.add(box(H * 1.9, H * 0.10, H * 0.45, wood, { y: H * 0.55 }));
    g.add(box(H * 1.9, H * 0.40, H * 0.08, mulHex(wood, 1.15), { y: H * 0.85, z: -H * 0.18 }));
    for (const s of [-1, 1]) {
      g.add(box(H * 0.10, H * 0.55, H * 0.10, mulHex(wood, 0.8), { pivot: 'bottom', x: s * H * 0.8, z: H * 0.15 }));
      g.add(box(H * 0.10, H * 1.05, H * 0.10, mulHex(wood, 0.8), { pivot: 'bottom', x: s * H * 0.8, z: -H * 0.15 }));
    }
    return g;
  },
  table: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 5);
    g.add(box(H * 1.6, H * 0.11, H * 1.0, wood, { y: H * 0.90 }));
    g.add(box(H * 1.55, H * 0.06, H * 0.95, mulHex(wood, 1.2), { y: H * 0.96 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(box(H * 0.13, H * 0.90, H * 0.13, mulHex(wood, 0.82), { pivot: 'bottom', x: sx * H * 0.68, z: sz * H * 0.38, taper: 0.8 }));
    }
    return g;
  },
  bookshelf: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 4);
    g.add(box(H * 1.0, H * 1.6, H * 0.06, mulHex(wood, 0.7), { pivot: 'bottom', z: -H * 0.16 }));
    for (const s of [-1, 1]) g.add(box(H * 0.08, H * 1.6, H * 0.36, wood, { pivot: 'bottom', x: s * H * 0.46 }));
    for (let i = 0; i < 4; i++) {
      const y = H * (0.06 + i * 0.5);
      g.add(box(H * 1.0, H * 0.06, H * 0.36, mulHex(wood, 1.15), { y }));
      let x = -H * 0.40;
      while (x < H * 0.38) {
        const w = H * rnd.float(0.04, 0.09);
        const bh = H * rnd.float(0.26, 0.40);
        g.add(box(w, bh, H * 0.26, rampHex(rnd.pick(['blood', 'foliage', 'water', 'wood', 'gold']), rnd.int(4, 9)),
          { pivot: 'bottom', x: x + w / 2, y: y + H * 0.03, rz: rnd.bool(0.12) ? 0.2 : 0 }));
        x += w + H * 0.008;
      }
    }
    g.add(box(H * 1.1, H * 0.10, H * 0.42, mulHex(wood, 1.25), { y: H * 1.62 }));
    return g;
  },
  bed: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 4);
    g.add(box(H * 1.0, H * 0.16, H * 2.0, wood, { y: H * 0.42 }));
    g.add(box(H * 0.94, H * 0.18, H * 1.9, rampHex('plaster', 11), { y: H * 0.58 }));
    g.add(box(H * 0.94, H * 0.14, H * 1.2, rampHex('blood', 6), { y: H * 0.66, z: -H * 0.3 }));
    g.add(box(H * 0.66, H * 0.16, H * 0.34, rampHex('plaster', 13), { y: H * 0.72, z: H * 0.72 }));
    g.add(box(H * 1.05, H * 0.85, H * 0.10, mulHex(wood, 1.15), { pivot: 'bottom', y: H * 0.34, z: H * 0.98, taper: 0.9 }));
    g.add(box(H * 1.05, H * 0.45, H * 0.10, mulHex(wood, 1.05), { pivot: 'bottom', y: H * 0.34, z: -H * 0.98 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(H * 0.12, H * 0.42, H * 0.12, mulHex(wood, 0.8), { pivot: 'bottom', x: sx * H * 0.44, z: sz * H * 0.9 }));
    return g;
  },
  brazier: (H, rnd) => {
    const g = new THREE.Group();
    const iron = rampHex('grey', 5);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      g.add(box(H * 0.08, H * 0.70, H * 0.08, iron, { pivot: 'bottom', x: Math.cos(a) * H * 0.22, z: Math.sin(a) * H * 0.22, rz: -Math.cos(a) * 0.30, rx: Math.sin(a) * 0.30 }));
    }
    g.add(cyl(H * 0.44, H * 0.26, H * 0.30, iron, { seg: 10, y: H * 0.80 }));
    g.add(cyl(H * 0.46, H * 0.46, H * 0.06, mulHex(iron, 1.3), { seg: 10, y: H * 0.94 }));
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      g.add(cone(H * (0.32 - t * 0.22), H * (0.40 - t * 0.16), rampHex('fire', 9 + i), { y: H * (1.0 + t * 0.34), emissive: 0.95, seg: 6, ry: t * 2 }));
    }
    return g;
  },
  weapon_rack: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 5), steel = rampHex('stone', 11);
    for (const s of [-1, 1]) g.add(box(H * 0.10, H * 1.3, H * 0.10, wood, { pivot: 'bottom', x: s * H * 0.55 }));
    g.add(box(H * 1.2, H * 0.09, H * 0.12, wood, { y: H * 1.25 }));
    g.add(box(H * 1.2, H * 0.09, H * 0.12, wood, { y: H * 0.20 }));
    for (let i = 0; i < 4; i++) {
      const x = H * (-0.42 + i * 0.28);
      if (i % 2 === 0) {
        g.add(box(H * 0.05, H * 0.95, H * 0.03, steel, { pivot: 'bottom', x, y: H * 0.24, taper: 0.4 }));
        g.add(box(H * 0.20, H * 0.05, H * 0.06, mulHex(steel, 0.7), { x, y: H * 0.28 }));
      } else {
        g.add(box(H * 0.06, H * 1.05, H * 0.06, wood, { pivot: 'bottom', x, y: H * 0.22 }));
        g.add(cone(H * 0.07, H * 0.22, steel, { x, y: H * 1.35 }));
      }
    }
    return g;
  },
  obelisk: (H, rnd) => {
    const g = new THREE.Group();
    const stone = rampHex('stone', 4);
    g.add(box(H * 0.62, H * 0.12, H * 0.62, mulHex(stone, 0.8), { pivot: 'bottom' }));
    g.add(box(H * 0.44, H * 1.55, H * 0.44, stone, { pivot: 'bottom', y: H * 0.12, taper: 0.72 }));
    g.add(cone(H * 0.17, H * 0.30, mulHex(stone, 1.25), { y: H * 1.82, seg: 4, ry: PI / 4 }));
    for (let i = 0; i < 7; i++) {
      g.add(box(H * 0.16, H * 0.035, H * 0.02, rampHex('arcane', 6), { y: H * (0.35 + i * 0.16), z: H * 0.19, emissive: 0.7 }));
    }
    return g;
  },
  crystal: (H, rnd) => {
    const g = new THREE.Group();
    const c = rampHex('ice', 11);
    g.add(cone(H * 0.30, H * 1.0, c, { y: H * 0.5, seg: 6, emissive: 0.35 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + 0.6;
      g.add(cone(H * 0.14, H * rnd.float(0.35, 0.6), mulHex(c, rnd.float(0.75, 1.2)),
        { x: Math.cos(a) * H * 0.24, z: Math.sin(a) * H * 0.24, y: H * 0.22, rz: -Math.cos(a) * 0.45, rx: Math.sin(a) * 0.45, seg: 5, emissive: 0.35 }));
    }
    g.add(sph(H * 0.34, rampHex('grey', 4), { y: H * 0.05, sy: 0.4 }));
    return g;
  },
  bones: (H, rnd) => {
    const g = new THREE.Group();
    const bone = rampHex('plaster', 12);
    g.add(sph(H * 0.36, bone, { y: H * 0.32, sz: 1.2 }));
    g.add(box(H * 0.42, H * 0.20, H * 0.34, mulHex(bone, 0.9), { y: H * 0.20, z: H * 0.30 }));
    for (const s of [-1, 1]) g.add(box(H * 0.14, H * 0.14, H * 0.10, 0x0a0a0c, { x: s * H * 0.15, y: H * 0.38, z: H * 0.30 }));
    for (let i = 0; i < 5; i++) {
      const a = rnd.float(0, PI * 2);
      g.add(cyl(H * 0.07, H * 0.07, H * rnd.float(0.6, 1.0), mulHex(bone, rnd.float(0.8, 1.1)),
        { seg: 6, rz: PI / 2, ry: a, x: rnd.float(-1, 1) * H * 0.5, z: rnd.float(-1, 1) * H * 0.5, y: H * 0.08 }));
    }
    return g;
  },
  banner_pole: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 4);
    g.add(cyl(H * 0.035, H * 0.05, H * 1.7, wood, { seg: 7, pivot: 'bottom' }));
    g.add(cone(H * 0.07, H * 0.20, rampHex('gold', 11), { y: H * 1.78 }));
    g.add(box(H * 0.55, H * 0.03, H * 0.03, wood, { y: H * 1.60, x: H * 0.25 }));
    g.add(plate(H * 0.50, H * 0.90, rampHex('blood', 6), { x: H * 0.27, y: H * 1.14, thick: H * 0.02 }));
    g.add(plate(H * 0.24, H * 0.30, rampHex('gold', 11), { x: H * 0.27, y: H * 1.30, z: H * 0.02, thick: H * 0.012 }));
    for (let i = 0; i < 4; i++) g.add(cone(H * 0.05, H * 0.14, rampHex('blood', 5), { x: H * (0.06 + i * 0.14), y: H * 0.66, rx: PI }));
    return g;
  },
  market_stall: (H, rnd) => {
    const g = new THREE.Group();
    const wood = rampHex('wood', 5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(H * 0.09, H * 1.5, H * 0.09, wood, { pivot: 'bottom', x: sx * H * 0.9, z: sz * H * 0.45 }));
    g.add(box(H * 1.95, H * 0.10, H * 1.0, mulHex(wood, 1.15), { y: H * 0.80 }));
    for (let i = 0; i < 6; i++) {
      g.add(box(H * 0.32, H * 0.10, H * 1.1, rampHex(i % 2 ? 'blood' : 'plaster', i % 2 ? 7 : 12), { y: H * 1.55, x: H * (-0.8 + i * 0.32), rx: 0.0 }));
    }
    g.add(box(H * 2.0, H * 0.06, H * 1.15, mulHex(wood, 0.8), { y: H * 1.50 }));
    for (let i = 0; i < 5; i++) {
      g.add(sph(H * rnd.float(0.09, 0.15), rampHex(rnd.pick(['fire', 'grass', 'gold', 'blood']), rnd.int(7, 12)),
        { x: rnd.float(-0.8, 0.8) * H, z: rnd.float(-0.3, 0.3) * H, y: H * 0.92 }));
    }
    return g;
  },

  // --- ground loot ---------------------------------------------------------
  item_sword: (H) => lootTilt((g) => {
    const steel = rampHex('stone', 12);
    g.add(box(H * 0.14, H * 1.05, H * 0.05, steel, { pivot: 'bottom', y: H * 0.25, taper: 0.3 }));
    g.add(box(H * 0.50, H * 0.09, H * 0.10, rampHex('gold', 9), { y: H * 0.24 }));
    g.add(box(H * 0.11, H * 0.24, H * 0.11, rampHex('wood', 3), { pivot: 'bottom', y: H * 0.0 }));
    g.add(sph(H * 0.09, rampHex('gold', 11), {}));
  }, H),
  item_bow: (H) => lootTilt((g) => {
    const wood = rampHex('wood', 6);
    g.add(box(H * 0.09, H * 1.10, H * 0.09, wood, { taper: 0.55, y: H * 0.55 }));
    g.add(box(H * 0.08, H * 0.36, H * 0.08, wood, { y: H * 1.03, rz: 0.6 }));
    g.add(box(H * 0.08, H * 0.36, H * 0.08, wood, { y: H * 0.08, rz: -0.6 }));
    g.add(box(H * 0.025, H * 1.15, H * 0.025, rampHex('plaster', 10), { x: H * 0.16, y: H * 0.55 }));
  }, H),
  item_shield: (H) => lootTilt((g) => {
    g.add(box(H * 0.75, H * 0.95, H * 0.11, rampHex('stone', 10), { taper: 0.35, y: H * 0.5 }));
    g.add(box(H * 0.24, H * 0.60, H * 0.05, rampHex('blood', 7), { y: H * 0.46, z: H * 0.07 }));
    g.add(sph(H * 0.13, rampHex('gold', 10), { y: H * 0.55, z: H * 0.08, sz: 0.5 }));
  }, H),
  item_helm: (H) => lootTilt((g) => {
    const steel = rampHex('stone', 11);
    g.add(sph(H * 0.42, steel, { y: H * 0.42, sy: 1.05 }));
    g.add(box(H * 0.70, H * 0.12, H * 0.10, rampHex('grey', 3), { y: H * 0.42, z: H * 0.30 }));
    g.add(box(H * 0.16, H * 0.40, H * 0.16, rampHex('blood', 8), { y: H * 0.86, taper: 0.4 }));
    g.add(cyl(H * 0.44, H * 0.44, H * 0.08, mulHex(steel, 0.8), { seg: 9, y: H * 0.08 }));
  }, H),
  item_armor: (H) => lootTilt((g) => {
    const steel = rampHex('grey', 9);
    g.add(box(H * 0.75, H * 0.90, H * 0.42, steel, { pivot: 'bottom', taper: 1.1, bulge: 0.12 }));
    g.add(box(H * 0.80, H * 0.14, H * 0.46, mulHex(steel, 1.25), { y: H * 0.86 }));
    g.add(box(H * 0.10, H * 0.62, H * 0.03, mulHex(steel, 0.6), { y: H * 0.42, z: H * 0.22 }));
    for (const s of [-1, 1]) g.add(sph(H * 0.20, mulHex(steel, 1.15), { x: s * H * 0.40, y: H * 0.82, sy: 0.6 }));
  }, H),
  item_potion: (H) => lootTilt((g) => {
    g.add(sph(H * 0.38, rampHex('blood', 9), { y: H * 0.36, emissive: 0.4 }));
    g.add(cyl(H * 0.13, H * 0.18, H * 0.34, rampHex('ice', 12), { seg: 7, y: H * 0.72 }));
    g.add(cyl(H * 0.15, H * 0.15, H * 0.10, rampHex('wood', 4), { seg: 7, y: H * 0.92 }));
  }, H),
  item_scroll: (H) => lootTilt((g) => {
    g.add(cyl(H * 0.24, H * 0.24, H * 0.95, rampHex('plaster', 13), { seg: 9, rz: PI / 2, y: H * 0.24 }));
    for (const s of [-1, 1]) g.add(cyl(H * 0.09, H * 0.09, H * 0.16, rampHex('wood', 5), { seg: 7, rz: PI / 2, x: s * H * 0.54, y: H * 0.24 }));
    g.add(box(H * 0.14, H * 0.26, H * 0.26, rampHex('blood', 8), { x: H * 0.1, y: H * 0.24 }));
  }, H),
  item_gold: (H) => lootTilt((g) => {
    const gold = rampHex('gold', 11);
    for (let i = 0; i < 12; i++) {
      const a = (i * 2.399);
      const rr = H * 0.05 * Math.sqrt(i);
      g.add(cyl(H * 0.16, H * 0.16, H * 0.055, mulHex(gold, 0.85 + (i % 3) * 0.12),
        { seg: 8, x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: H * (0.04 + (i % 4) * 0.055), rz: (i % 5) * 0.12 }));
    }
  }, H),
  item_gem: (H) => lootTilt((g) => {
    g.add(cone(H * 0.34, H * 0.5, rampHex('ice', 12), { y: H * 0.60, seg: 6, emissive: 0.4 }));
    g.add(cone(H * 0.34, H * 0.34, rampHex('ice', 10), { y: H * 0.28, seg: 6, rx: PI, emissive: 0.3 }));
  }, H),
  item_ring: (H) => lootTilt((g) => {
    const gold = rampHex('gold', 12);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      g.add(box(H * 0.09, H * 0.09, H * 0.16, gold, { x: Math.cos(a) * H * 0.32, y: H * 0.10 + Math.sin(a) * H * 0.32, rx: -a }));
    }
    g.add(sph(H * 0.16, rampHex('blood', 10), { y: H * 0.50, emissive: 0.5 }));
  }, H),
  item_wand: (H) => lootTilt((g) => {
    g.add(cyl(H * 0.06, H * 0.09, H * 0.90, rampHex('wood', 3), { seg: 6, pivot: 'bottom' }));
    g.add(sph(H * 0.19, rampHex('arcane', 6), { y: H * 0.95, emissive: 0.9 }));
    for (let i = 0; i < 3; i++) g.add(box(H * 0.11, H * 0.05, H * 0.11, rampHex('gold', 10), { y: H * (0.2 + i * 0.2) }));
  }, H),
  item_book: (H) => lootTilt((g) => {
    g.add(box(H * 0.80, H * 0.20, H * 0.62, rampHex('blood', 5), { pivot: 'bottom' }));
    g.add(box(H * 0.74, H * 0.14, H * 0.58, rampHex('plaster', 13), { pivot: 'bottom', y: H * 0.05 }));
    g.add(box(H * 0.80, H * 0.09, H * 0.62, rampHex('blood', 6), { pivot: 'bottom', y: H * 0.20 }));
    g.add(box(H * 0.24, H * 0.03, H * 0.24, rampHex('gold', 11), { y: H * 0.31 }));
    g.add(box(H * 0.10, H * 0.30, H * 0.10, rampHex('gold', 9), { x: H * 0.36, y: H * 0.15 }));
  }, H),
};

/**
 * Loot on the ground is tipped towards the viewer so it reads as an icon
 * rather than a foreshortened sliver, which is exactly what MM6 did.
 */
function lootTilt(fill, H) {
  const outer = new THREE.Group();
  const g = grp(0, H * 0.10, 0);
  g.rotation.x = -0.55;
  outer.add(g);
  fill(g);
  outer.add(sph(H * 0.55, rampHex('grey', 2), { y: H * 0.02, sy: 0.06 }));
  return outer;
}

/** height in world units + billboard aspect (w/h). */
export const PROP_DEFS = {
  chest: { h: 64, aspect: 1.35 },
  chest_open: { h: 64, aspect: 1.35 },
  barrel: { h: 84, aspect: 0.95 },
  crate: { h: 76, aspect: 1.15 },
  sack: { h: 60, aspect: 1.05 },
  campfire: { h: 72, aspect: 1.5 },
  well: { h: 170, aspect: 0.95 },
  signpost: { h: 190, aspect: 0.95 },
  lamppost: { h: 260, aspect: 0.45 },
  torch_wall: { h: 104, aspect: 0.65 },
  altar: { h: 130, aspect: 1.25 },
  statue: { h: 230, aspect: 0.60 },
  gravestone: { h: 96, aspect: 0.95 },
  fountain: { h: 150, aspect: 1.55 },
  cart: { h: 110, aspect: 1.7 },
  haystack: { h: 170, aspect: 1.1 },
  anvil: { h: 68, aspect: 1.35 },
  bench: { h: 90, aspect: 1.9 },
  table: { h: 100, aspect: 1.75 },
  bookshelf: { h: 190, aspect: 0.85 },
  bed: { h: 110, aspect: 1.9 },
  brazier: { h: 130, aspect: 0.9 },
  weapon_rack: { h: 140, aspect: 1.05 },
  obelisk: { h: 260, aspect: 0.5 },
  crystal: { h: 150, aspect: 0.85 },
  bones: { h: 44, aspect: 1.9 },
  banner_pole: { h: 210, aspect: 0.65 },
  market_stall: { h: 150, aspect: 1.6 },
  item_sword: { h: 26, aspect: 1.0, item: 1 },
  item_bow: { h: 26, aspect: 1.0, item: 1 },
  item_shield: { h: 26, aspect: 1.0, item: 1 },
  item_helm: { h: 26, aspect: 1.15, item: 1 },
  item_armor: { h: 26, aspect: 1.1, item: 1 },
  item_potion: { h: 26, aspect: 1.0, item: 1 },
  item_scroll: { h: 26, aspect: 1.5, item: 1 },
  item_gold: { h: 26, aspect: 1.6, item: 1 },
  item_gem: { h: 26, aspect: 1.1, item: 1 },
  item_ring: { h: 26, aspect: 1.1, item: 1 },
  item_wand: { h: 26, aspect: 0.9, item: 1 },
  item_book: { h: 26, aspect: 1.5, item: 1 },
};

export const PROP_KINDS = Object.keys(PROP_DEFS);

/**
 * Build a prop model.
 * @returns {{root:THREE.Group, height:number, pose:Function, dispose:Function, def:object}}
 */
export function buildProp(kind, seed = 1) {
  const def = PROP_DEFS[kind];
  if (!def) throw new Error('unknown prop: ' + kind);
  const rnd = new Rand((seed >>> 0) ^ 0x6b43a9b5);
  const H = def.h * (def.item ? 1 : rnd.float(0.93, 1.07));
  const root = BUILDERS[kind](H, rnd);
  return {
    root,
    height: H,
    def: { ...def, name: kind, height: H },
    pose() {},
    dispose() { disposeTree(root); },
  };
}
