import * as THREE from 'three';
import { Rand } from '../../core/rng.js';
import { rampHex } from '../../core/palette.js';
import { box, cyl, cone, sph, plate, grp, mulHex, disposeTree } from './creatures.js';

// ---------------------------------------------------------------------------
// Trees, rocks and undergrowth.
//
// These are only ever seen as baked billboards, so they are built for
// silhouette rather than detail: a chunky tapered trunk, a few forked limbs,
// and foliage as clusters of low-poly icospheres. MM6's outdoor trees read as
// solid rounded masses with a dark underside, never as wispy branch networks.
// ---------------------------------------------------------------------------

const PI = Math.PI;

function foliageBlob(parent, x, y, z, r, hex, rnd, n = 3) {
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    parent.add(sph(r * (1 - k * 0.28) * rnd.float(0.85, 1.15),
      i === 0 ? hex : mulHex(hex, rnd.float(0.72, 1.16)), {
        x: x + rnd.float(-r, r) * 0.55,
        y: y + rnd.float(-r, r) * 0.42,
        z: z + rnd.float(-r, r) * 0.55,
        sy: rnd.float(0.72, 0.95),
        detail: r > 40 ? 1 : 0,
      }));
  }
}

/** A forked trunk: recursive tapered boxes, two levels deep. */
function limb(parent, len, rad, hex, dir, depth, rnd, onTip) {
  const g = grp(0, 0, 0);
  g.rotation.set(dir.x, dir.y, dir.z);
  parent.add(g);
  g.add(box(rad * 2, len, rad * 2, hex, { pivot: 'bottom', taper: 0.62 }));
  const tip = grp(0, len, 0);
  g.add(tip);
  if (depth > 0) {
    const n = rnd.int(2, 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + rnd.float(0, 1);
      limb(tip, len * rnd.float(0.55, 0.75), rad * 0.58, hex,
        { x: Math.cos(a) * rnd.float(0.35, 0.75), y: 0, z: Math.sin(a) * rnd.float(0.35, 0.75) },
        depth - 1, rnd, onTip);
    }
  } else if (onTip) onTip(tip);
  return tip;
}

function buildBroadleaf(H, o, rnd) {
  const root = new THREE.Group();
  const bark = rampHex('wood', o.barkShade === undefined ? 4 : o.barkShade);
  const leaf = rampHex(o.leafRamp || 'foliage', o.leafShade === undefined ? 7 : o.leafShade);
  const trunkH = H * (o.trunk || 0.42);
  const trunkR = H * (o.trunkR || 0.045);
  root.add(cyl(trunkR * 0.62, trunkR * 1.25, trunkH, bark, { seg: 7, pivot: 'bottom' }));
  // root flare - reads as "planted" even at 24px
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.4;
    root.add(cone(trunkR * 0.55, trunkR * 1.5, mulHex(bark, 0.85),
      { x: Math.cos(a) * trunkR * 0.9, z: Math.sin(a) * trunkR * 0.9, y: trunkR * 0.7 }));
  }
  const crown = grp(0, trunkH, 0);
  root.add(crown);
  const cr = H * (o.crownR || 0.30);
  const branches = o.branches === undefined ? 4 : o.branches;
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * PI * 2 + rnd.float(0, 0.8);
    const lean = o.weep ? rnd.float(0.9, 1.35) : rnd.float(0.45, 0.85);
    limb(crown, H * 0.18, trunkR * 0.55, bark,
      { x: Math.cos(a) * lean, y: 0, z: Math.sin(a) * lean }, 1, rnd, (tip) => {
        if (o.weep) {
          for (let k = 0; k < 3; k++) {
            tip.add(box(H * 0.012, H * 0.20, H * 0.012, mulHex(leaf, 0.8),
              { pivot: 'top', x: rnd.float(-1, 1) * H * 0.04, z: rnd.float(-1, 1) * H * 0.04, taper: 0.4 }));
          }
        }
        foliageBlob(tip, 0, 0, 0, cr * 0.42, leaf, rnd, 3);
      });
  }
  if (!o.weep) {
    // a solid central mass so the crown is not a ring of blobs
    foliageBlob(crown, 0, cr * 0.55, 0, cr * (o.dense || 0.78), leaf, rnd, 4);
    foliageBlob(crown, 0, cr * 1.0, 0, cr * 0.55, mulHex(leaf, 1.18), rnd, 2);
  }
  return root;
}

function buildConifer(H, o, rnd) {
  const root = new THREE.Group();
  const bark = rampHex('wood', 3);
  const leaf = rampHex(o.leafRamp || 'foliage', o.leafShade === undefined ? 5 : o.leafShade);
  const snow = rampHex('ice', 13);
  const trunkH = H * 0.95;
  root.add(cyl(H * 0.012, H * 0.042, trunkH, bark, { seg: 6, pivot: 'bottom' }));
  const tiers = o.tiers || 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = H * (0.16 + t * 0.74);
    const r = H * (0.30 - t * 0.24) * rnd.float(0.92, 1.08);
    const c = i % 2 ? leaf : mulHex(leaf, 1.16);
    root.add(cone(r, H * 0.20, c, { y: y + H * 0.10, seg: 7 }));
    if (o.snow) root.add(cone(r * 0.82, H * 0.09, snow, { y: y + H * 0.175, seg: 7 }));
  }
  root.add(cone(H * 0.05, H * 0.14, mulHex(leaf, 1.2), { y: H * 0.96, seg: 6 }));
  return root;
}

const BUILDERS = {
  oak: (H, rnd) => buildBroadleaf(H, { leafRamp: 'foliage', leafShade: 7, crownR: 0.34, dense: 0.85, branches: 5 }, rnd),
  oak_autumn: (H, rnd) => buildBroadleaf(H, { leafRamp: 'fire', leafShade: 8, crownR: 0.34, dense: 0.85, branches: 5, barkShade: 3 }, rnd),
  pine: (H, rnd) => buildConifer(H, { tiers: 6 }, rnd),
  pine_snow: (H, rnd) => buildConifer(H, { tiers: 6, snow: 1, leafShade: 4 }, rnd),
  birch: (H, rnd) => {
    const root = buildBroadleaf(H, { leafRamp: 'grass', leafShade: 10, crownR: 0.24, trunk: 0.58, trunkR: 0.030, branches: 4, dense: 0.7 }, rnd);
    // white bark with dark banding
    const pale = rampHex('plaster', 13);
    root.add(cyl(H * 0.020, H * 0.030, H * 0.58, pale, { seg: 7, pivot: 'bottom' }));
    for (let i = 0; i < 6; i++) {
      root.add(box(H * 0.062, H * 0.012, H * 0.062, rampHex('grey', 2), { y: H * rnd.float(0.08, 0.54), rz: rnd.float(-0.1, 0.1) }));
    }
    return root;
  },
  willow: (H, rnd) => buildBroadleaf(H, { leafRamp: 'swamp', leafShade: 8, crownR: 0.30, trunk: 0.34, weep: 1, branches: 6 }, rnd),
  palm: (H, rnd) => {
    const root = new THREE.Group();
    const bark = rampHex('wood', 6);
    const leaf = rampHex('foliage', 9);
    const trunkH = H * 0.78;
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      const t = i / seg;
      root.add(cyl(H * (0.026 - t * 0.008), H * (0.032 - t * 0.008), trunkH / seg + 1, i % 2 ? bark : mulHex(bark, 0.82),
        { seg: 6, pivot: 'bottom', y: trunkH * t, x: Math.sin(t * 2.2) * H * 0.05 }));
    }
    const top = grp(Math.sin(2.2) * H * 0.05, trunkH, 0);
    root.add(top);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * PI * 2;
      const f = grp(0, 0, 0);
      f.rotation.y = a;
      f.rotation.z = 0.55 + rnd.float(0, 0.35);
      top.add(f);
      f.add(plate(H * 0.34, H * 0.09, i % 2 ? leaf : mulHex(leaf, 1.2), { x: H * 0.17, taper: 0.35, thick: H * 0.012 }));
      f.add(box(H * 0.34, H * 0.012, H * 0.012, mulHex(leaf, 0.7), { x: H * 0.17 }));
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      top.add(sph(H * 0.028, rampHex('sand', 8), { x: Math.cos(a) * H * 0.04, z: Math.sin(a) * H * 0.04, y: -H * 0.03 }));
    }
    return root;
  },
  dead_tree: (H, rnd) => {
    const root = new THREE.Group();
    const bark = rampHex('grey', 4);
    root.add(cyl(H * 0.020, H * 0.052, H * 0.52, bark, { seg: 6, pivot: 'bottom' }));
    const crown = grp(0, H * 0.50, 0);
    root.add(crown);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + rnd.float(0, 0.7);
      limb(crown, H * 0.24, H * 0.018, bark,
        { x: Math.cos(a) * rnd.float(0.5, 0.95), y: 0, z: Math.sin(a) * rnd.float(0.5, 0.95) }, 1, rnd, null);
    }
    return root;
  },
  cactus: (H, rnd) => {
    const root = new THREE.Group();
    const green = rampHex('foliage', 8);
    root.add(cyl(H * 0.085, H * 0.10, H * 0.92, green, { seg: 8, pivot: 'bottom' }));
    root.add(cone(H * 0.085, H * 0.10, mulHex(green, 1.15), { y: H * 0.95, seg: 8 }));
    for (const s of [-1, 1]) {
      if (rnd.bool(0.85)) {
        const y = H * rnd.float(0.32, 0.55);
        const arm = grp(s * H * 0.085, y, 0);
        root.add(arm);
        arm.add(cyl(H * 0.05, H * 0.055, H * 0.16, green, { seg: 7, pivot: 'bottom', rz: -s * 1.3 }));
        arm.add(cyl(H * 0.048, H * 0.052, H * 0.24, green, { seg: 7, pivot: 'bottom', x: s * H * 0.155 }));
        arm.add(cone(H * 0.048, H * 0.05, mulHex(green, 1.15), { y: H * 0.245, x: s * H * 0.155, seg: 7 }));
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd.float(0, PI * 2);
      root.add(box(H * 0.006, H * 0.03, H * 0.006, rampHex('sand', 12),
        { x: Math.cos(a) * H * 0.095, z: Math.sin(a) * H * 0.095, y: H * rnd.float(0.08, 0.88), rz: -Math.cos(a) * 1.4, rx: Math.sin(a) * 1.4 }));
    }
    return root;
  },
  bush: (H, rnd) => {
    const root = new THREE.Group();
    const leaf = rampHex('foliage', 8);
    root.add(cyl(H * 0.03, H * 0.045, H * 0.20, rampHex('wood', 4), { seg: 6, pivot: 'bottom' }));
    foliageBlob(root, 0, H * 0.55, 0, H * 0.42, leaf, rnd, 5);
    foliageBlob(root, 0, H * 0.30, 0, H * 0.38, mulHex(leaf, 0.82), rnd, 3);
    return root;
  },
  bush_berry: (H, rnd) => {
    const root = BUILDERS.bush(H, rnd);
    const berry = rampHex('blood', 10);
    for (let i = 0; i < 12; i++) {
      const a = rnd.float(0, PI * 2), rr = H * rnd.float(0.2, 0.42);
      root.add(sph(H * 0.032, berry, { x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: H * rnd.float(0.32, 0.75) }));
    }
    return root;
  },
  fern: (H, rnd) => {
    const root = new THREE.Group();
    const leaf = rampHex('foliage', 9);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * PI * 2 + rnd.float(0, 0.5);
      const f = grp(0, H * 0.06, 0);
      f.rotation.y = a;
      f.rotation.z = 0.75 + rnd.float(0, 0.4);
      root.add(f);
      f.add(plate(H * 0.85, H * 0.20, i % 2 ? leaf : mulHex(leaf, 1.2), { x: H * 0.42, taper: 0.25, thick: H * 0.02 }));
    }
    return root;
  },
  reeds: (H, rnd) => {
    const root = new THREE.Group();
    const c = rampHex('swamp', 9);
    for (let i = 0; i < 12; i++) {
      const a = rnd.float(0, PI * 2), rr = H * rnd.float(0, 0.16);
      const h = H * rnd.float(0.55, 1.0);
      root.add(box(H * 0.014, h, H * 0.014, mulHex(c, rnd.float(0.8, 1.2)), {
        pivot: 'bottom', x: Math.cos(a) * rr, z: Math.sin(a) * rr,
        rz: rnd.float(-0.22, 0.22), rx: rnd.float(-0.22, 0.22), taper: 0.3,
      }));
      if (rnd.bool(0.3)) root.add(box(H * 0.024, H * 0.11, H * 0.024, rampHex('wood', 6), { x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: h, taper: 0.4 }));
    }
    return root;
  },
  mushroom_cluster: (H, rnd) => {
    const root = new THREE.Group();
    const stem = rampHex('plaster', 11);
    const cap = rampHex('blood', 8);
    for (let i = 0; i < 5; i++) {
      const a = rnd.float(0, PI * 2), rr = H * rnd.float(0, 0.3);
      const h = H * rnd.float(0.35, 0.85);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      root.add(cyl(H * 0.045, H * 0.06, h, stem, { seg: 6, pivot: 'bottom', x, z }));
      root.add(sph(H * rnd.float(0.14, 0.22), i % 2 ? cap : mulHex(cap, 1.2), { x, z, y: h, sy: 0.55 }));
    }
    return root;
  },
  mushroom_giant: (H, rnd) => {
    const root = new THREE.Group();
    const stem = rampHex('plaster', 10);
    const cap = rampHex('arcane', 4);
    root.add(cyl(H * 0.10, H * 0.15, H * 0.66, stem, { seg: 8, pivot: 'bottom', bulge: 0.1 }));
    root.add(sph(H * 0.42, cap, { y: H * 0.66, sy: 0.52 }));
    root.add(sph(H * 0.30, mulHex(cap, 1.25), { y: H * 0.76, sy: 0.42 }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      root.add(sph(H * 0.05, rampHex('plaster', 13), { x: Math.cos(a) * H * 0.24, z: Math.sin(a) * H * 0.24, y: H * 0.78, sy: 0.4 }));
    }
    return root;
  },
  rock_small: (H, rnd) => rockPile(H, rnd, 3, 'stone', 6),
  rock_large: (H, rnd) => rockPile(H, rnd, 5, 'stone', 5),
  boulder: (H, rnd) => rockPile(H, rnd, 2, 'grey', 5),
  stump: (H, rnd) => {
    const root = new THREE.Group();
    const bark = rampHex('wood', 3);
    root.add(cyl(H * 0.34, H * 0.42, H * 0.85, bark, { seg: 8, pivot: 'bottom' }));
    root.add(cyl(H * 0.32, H * 0.32, H * 0.06, rampHex('wood', 8), { seg: 8, y: H * 0.86 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + 0.5;
      root.add(cone(H * 0.14, H * 0.34, mulHex(bark, 0.85), { x: Math.cos(a) * H * 0.33, z: Math.sin(a) * H * 0.33, y: H * 0.16 }));
    }
    return root;
  },
  log: (H, rnd) => {
    const root = new THREE.Group();
    const bark = rampHex('wood', 3);
    root.add(cyl(H * 0.42, H * 0.46, H * 2.4, bark, { seg: 8, rx: PI / 2, y: H * 0.44 }));
    root.add(cyl(H * 0.36, H * 0.36, H * 0.05, rampHex('wood', 8), { seg: 8, rx: PI / 2, y: H * 0.44, z: H * 1.2 }));
    for (let i = 0; i < 3; i++) {
      root.add(cone(H * 0.10, H * 0.30, mulHex(bark, 0.9), { y: H * 0.75, z: H * rnd.float(-0.9, 0.9), rz: rnd.float(-0.6, 0.6) }));
    }
    return root;
  },
  flowers_white: (H, rnd) => flowers(H, rnd, rampHex('plaster', 14), rampHex('gold', 12)),
  flowers_red: (H, rnd) => flowers(H, rnd, rampHex('blood', 10), rampHex('gold', 13)),
  grass_tuft: (H, rnd) => {
    const root = new THREE.Group();
    const c = rampHex('grass', 8);
    for (let i = 0; i < 14; i++) {
      const a = rnd.float(0, PI * 2), rr = H * rnd.float(0, 0.3);
      root.add(box(H * 0.05, H * rnd.float(0.5, 1.0), H * 0.012, mulHex(c, rnd.float(0.75, 1.25)), {
        pivot: 'bottom', x: Math.cos(a) * rr, z: Math.sin(a) * rr,
        ry: a, rz: rnd.float(-0.5, 0.5), taper: 0.15,
      }));
    }
    return root;
  },
  vine: (H, rnd) => {
    const root = new THREE.Group();
    const c = rampHex('foliage', 6);
    let x = 0, z = 0;
    for (let i = 0; i < 9; i++) {
      const y = H * (i / 9);
      x += rnd.float(-1, 1) * H * 0.04;
      z += rnd.float(-1, 1) * H * 0.03;
      root.add(box(H * 0.022, H * 0.12, H * 0.022, c, { pivot: 'bottom', x, y, z, rz: rnd.float(-0.3, 0.3) }));
      if (i % 2 === 0) root.add(plate(H * 0.11, H * 0.09, mulHex(c, 1.25), { x: x + H * 0.05 * (i % 4 ? 1 : -1), y: y + H * 0.05, z, ry: rnd.float(0, 1), thick: H * 0.01 }));
    }
    return root;
  },
  sapling: (H, rnd) => {
    const root = new THREE.Group();
    const bark = rampHex('wood', 5);
    const leaf = rampHex('grass', 9);
    root.add(cyl(H * 0.012, H * 0.022, H * 0.62, bark, { seg: 6, pivot: 'bottom' }));
    foliageBlob(root, 0, H * 0.74, 0, H * 0.24, leaf, rnd, 4);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      root.add(box(H * 0.010, H * 0.16, H * 0.010, bark, { pivot: 'bottom', y: H * 0.42, rz: Math.cos(a) * 0.8, rx: Math.sin(a) * 0.8 }));
    }
    return root;
  },
};

function rockPile(H, rnd, n, rampName, shade) {
  const root = new THREE.Group();
  const base = rampHex(rampName, shade);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const r = H * (0.55 - k * 0.28) * rnd.float(0.8, 1.2);
    root.add(sph(r, mulHex(base, rnd.float(0.75, 1.22)), {
      x: rnd.float(-1, 1) * H * 0.3, z: rnd.float(-1, 1) * H * 0.3,
      y: r * 0.72 + (i > 0 ? H * 0.10 * k : 0),
      sy: rnd.float(0.6, 0.95), sx: rnd.float(0.85, 1.25), detail: 0,
      ry: rnd.float(0, PI), rz: rnd.float(-0.3, 0.3),
    }));
  }
  return root;
}

function flowers(H, rnd, petal, centre) {
  const root = new THREE.Group();
  const stem = rampHex('grass', 6);
  for (let i = 0; i < 9; i++) {
    const a = rnd.float(0, PI * 2), rr = H * rnd.float(0, 0.32);
    const h = H * rnd.float(0.5, 0.95);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    root.add(box(H * 0.016, h, H * 0.016, stem, { pivot: 'bottom', x, z, rz: rnd.float(-0.25, 0.25) }));
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * PI * 2;
      root.add(plate(H * 0.09, H * 0.05, petal, { x: x + Math.cos(pa) * H * 0.05, z: z + Math.sin(pa) * H * 0.05, y: h, ry: -pa, rx: PI / 2, thick: H * 0.012 }));
    }
    root.add(sph(H * 0.026, centre, { x, z, y: h + H * 0.01 }));
    if (rnd.bool(0.6)) root.add(plate(H * 0.10, H * 0.05, mulHex(stem, 1.2), { x, z, y: h * 0.45, ry: a, thick: H * 0.012 }));
  }
  return root;
}

/** height in world units + billboard aspect (w/h) per kind. */
export const FLORA_DEFS = {
  oak: { h: 900, aspect: 1.0 },
  oak_autumn: { h: 880, aspect: 1.0 },
  pine: { h: 1000, aspect: 0.62 },
  pine_snow: { h: 1000, aspect: 0.62 },
  birch: { h: 820, aspect: 0.72 },
  willow: { h: 760, aspect: 1.15 },
  palm: { h: 780, aspect: 0.95 },
  dead_tree: { h: 700, aspect: 0.95 },
  cactus: { h: 340, aspect: 0.7 },
  bush: { h: 120, aspect: 1.05 },
  bush_berry: { h: 120, aspect: 1.05 },
  fern: { h: 104, aspect: 1.5 },
  reeds: { h: 144, aspect: 0.9 },
  mushroom_cluster: { h: 64, aspect: 1.3 },
  mushroom_giant: { h: 208, aspect: 1.15 },
  rock_small: { h: 64, aspect: 1.4 },
  rock_large: { h: 152, aspect: 1.35 },
  boulder: { h: 200, aspect: 1.25 },
  stump: { h: 80, aspect: 1.35 },
  log: { h: 68, aspect: 2.6 },
  flowers_white: { h: 64, aspect: 1.3 },
  flowers_red: { h: 64, aspect: 1.3 },
  grass_tuft: { h: 56, aspect: 1.3 },
  vine: { h: 256, aspect: 0.55 },
  sapling: { h: 200, aspect: 0.8 },
};

export const FLORA_KINDS = Object.keys(FLORA_DEFS);

/**
 * Build a flora model.
 * @returns {{root:THREE.Group, height:number, pose:Function, dispose:Function, def:object}}
 */
export function buildFlora(kind, seed = 1) {
  const def = FLORA_DEFS[kind];
  if (!def) throw new Error('unknown flora: ' + kind);
  const rnd = new Rand((seed >>> 0) ^ 0x2545f491);
  const H = def.h * rnd.float(0.88, 1.12);
  const root = BUILDERS[kind](H, rnd);
  root.rotation.y = rnd.float(0, PI * 2);
  return {
    root,
    height: H,
    def: { ...def, name: kind, height: H, aspect: def.aspect },
    pose() {},
    dispose() { disposeTree(root); },
  };
}
