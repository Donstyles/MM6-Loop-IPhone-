import * as THREE from 'three';
import { getTexture } from './terrain.js';
import { quantiseShade, sunDirection, sunTerms } from './sky.js';
import { Rand, clamp, lerpN } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Architecture.
//
// MM6 buildings are honest extruded volumes: a rectangular block or two, a
// pitched or hipped roof with a generous overhang, a chimney, shuttered
// windows, and a door you can walk into. Nothing is curved and nothing is
// bevelled. The richness comes from the textures and from the fact that the
// upper storey usually juts out over the ground floor.
//
// Everything is built into flat per-texture buffers ("parts") so a whole town
// can be merged into a handful of draw calls. Faces are shaded into vertex
// colours by a fixed sun, matching the terrain bake, since no lights exist.
// ---------------------------------------------------------------------------

export const HOUSE_STYLES = [
  'cottage', 'townhouse', 'shop', 'tavern', 'temple', 'guild', 'smithy',
  'stable', 'tower', 'keep', 'hut', 'longhouse', 'manor', 'warehouse',
  'mill', 'lighthouse',
];

const SRGB_TO_LIN = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// MM6 shades everything with a single greyscale multiply quantised to 32
// levels, lit by a sun that only ever travels the E-W great circle. Buildings
// are baked once at generation time against the hour set here.
let SUN = sunDirection(9.5);
let AMBIENT = sunTerms(9.5).ambient;
let DIFFUSE = sunTerms(9.5).diffuse;

/** Set the hour buildings generated from here on will be lit for. */
export function setBuildingLight(hours) {
  const h = hours <= 1 ? hours * 24 : hours;
  SUN = sunDirection(h);
  const t = sunTerms(h);
  AMBIENT = t.ambient; DIFFUSE = t.diffuse;
}

/**
 * Flat grey shade for a face normal, on MM6's 32-step ladder, in linear space
 * ready for a colour attribute. `extra` is the artist's own face darkening
 * (overhang undersides, back walls) applied before quantisation.
 */
function faceShade(nx, ny, nz, tintR = 1, tintG = 1, tintB = 1, extra = 1) {
  const ndl = Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
  // Same sun-elevation-normalised curve the terrain uses, so walls and ground
  // agree exactly and neither goes black when the sun is low.
  const up = Math.max(0.30, SUN.y);
  // `extra` is floored: an overhang underside should read as shadow, not as
  // a hole in the building.
  const g = quantiseShade(clamp((0.50 + 0.50 * clamp(ndl / up, 0, 1)) * (DIFFUSE > 0 ? 1 : 0.38) * Math.max(0.62, extra), 0, 1));
  const l = SRGB_TO_LIN(g);
  return [l * tintR, l * tintG, l * tintB];
}

const TEX_UNITS = 256;  // world units covered by one texture repeat

/**
 * Accumulates triangles keyed by texture id. `finish()` produces one mesh with
 * a material group per texture, so N buildings merged together still cost N
 * textures' worth of draw calls, not N buildings'.
 */
export class MeshBuilder {
  constructor() {
    this.parts = new Map();
    this.tris = 0;
  }
  _part(tex) {
    let p = this.parts.get(tex);
    if (!p) { p = { pos: [], uv: [], col: [], idx: [], n: 0 }; this.parts.set(tex, p); }
    return p;
  }
  /** Add one quad, winding a->b->c->d (counter-clockwise when seen from front). */
  quad(tex, a, b, c, d, o = {}) {
    const p = this._part(tex);
    // Face normal from the first triangle.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= il; ny *= il; nz *= il;
    const col = o.color || faceShade(nx, ny, nz, o.tint ? o.tint[0] : 1, o.tint ? o.tint[1] : 1, o.tint ? o.tint[2] : 1, o.extra || 1);
    const uu = o.uu !== undefined ? o.uu : Math.max(0.25, Math.hypot(ux, uy, uz) / TEX_UNITS);
    const vv = o.vv !== undefined ? o.vv : Math.max(0.25, Math.hypot(vx, vy, vz) / TEX_UNITS);
    const uvs = o.uvs || [[0, 0], [uu, 0], [uu, vv], [0, vv]];
    const base = p.n;
    const verts = [a, b, c, d];
    const vc = o.colors || null;   // per-vertex, for baked point lighting
    for (let i = 0; i < 4; i++) {
      p.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      p.uv.push(uvs[i][0], uvs[i][1]);
      if (vc) p.col.push(vc[i][0], vc[i][1], vc[i][2]);
      else p.col.push(col[0], col[1], col[2]);
    }
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    p.n += 4;
    this.tris += 2;
    return this;
  }
  tri(tex, a, b, c, o = {}) {
    const p = this._part(tex);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= il; ny *= il; nz *= il;
    const col = o.color || faceShade(nx, ny, nz, 1, 1, 1, o.extra || 1);
    const uvs = o.uvs || [[0, 0], [1, 0], [0.5, 1]];
    const base = p.n;
    const verts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      p.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      p.uv.push(uvs[i][0], uvs[i][1]);
      p.col.push(col[0], col[1], col[2]);
    }
    p.idx.push(base, base + 1, base + 2);
    p.n += 3;
    this.tris += 1;
    return this;
  }
  /** Axis-aligned box from min to max corner. */
  box(tex, x0, y0, z0, x1, y1, z1, o = {}) {
    const sides = o.sides || 'nsewt';
    const uu = o.uu, vv = o.vv;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const sU = (a) => (uu !== undefined ? uu : Math.max(0.25, a / TEX_UNITS));
    const sV = (a) => (vv !== undefined ? vv : Math.max(0.25, a / TEX_UNITS));
    const q = (tex2, A, B, C, D, uw, vh) => this.quad(tex2, A, B, C, D, { ...o, uu: sU(uw), vv: sV(vh) });
    if (sides.includes('s')) q(tex, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], w, h);
    if (sides.includes('n')) q(tex, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], w, h);
    if (sides.includes('e')) q(tex, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], d, h);
    if (sides.includes('w')) q(tex, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], d, h);
    if (sides.includes('t')) q(o.topTex || tex, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], w, d);
    if (sides.includes('b')) q(tex, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], w, d);
    return this;
  }
  /** Merge another builder's parts, optionally through a Matrix4. */
  absorb(other, matrix) {
    const v = new THREE.Vector3();
    for (const [tex, src] of other.parts) {
      const dst = this._part(tex);
      const base = dst.n;
      for (let i = 0; i < src.pos.length; i += 3) {
        v.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]);
        if (matrix) v.applyMatrix4(matrix);
        dst.pos.push(v.x, v.y, v.z);
      }
      for (let i = 0; i < src.uv.length; i++) dst.uv.push(src.uv[i]);
      for (let i = 0; i < src.col.length; i++) dst.col.push(src.col[i]);
      for (let i = 0; i < src.idx.length; i++) dst.idx.push(src.idx[i] + base);
      dst.n += src.n;
    }
    this.tris += other.tris;
    return this;
  }
  isEmpty() { return this.parts.size === 0; }
  /** Build a single multi-material mesh. One draw call per distinct texture. */
  finish(opts = {}) {
    const pos = [], uv = [], col = [], idx = [];
    const mats = [], groups = [];
    for (const [tex, p] of this.parts) {
      if (p.n === 0) continue;
      const vbase = pos.length / 3;
      const istart = idx.length;
      for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
      for (let i = 0; i < p.uv.length; i++) uv.push(p.uv[i]);
      for (let i = 0; i < p.col.length; i++) col.push(p.col[i]);
      for (let i = 0; i < p.idx.length; i++) idx.push(p.idx[i] + vbase);
      groups.push({ start: istart, count: idx.length - istart });
      mats.push(materialFor(tex, opts));
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mats);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

const _matCache = new Map();
export function materialFor(texId, opts = {}) {
  const key = texId + (opts.transparent ? '|t' : '') + (opts.fog === false ? '|nf' : '');
  const hit = _matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshBasicMaterial({
    map: getTexture(texId),
    vertexColors: true,
    fog: opts.fog !== false,
    side: THREE.FrontSide,
    transparent: !!opts.transparent,
    alphaTest: opts.transparent ? 0.5 : 0,
  });
  _matCache.set(key, m);
  return m;
}

// --- style table -----------------------------------------------------------

const STYLE = {
  cottage: { w: [560, 760], d: [480, 640], storeys: 1, roof: 'pitch', rh: 300, wall: ['wall_plaster', 'wall_timber'], roofTex: ['roof_thatch', 'roof_shingle_red', 'roof_shingle_red'], chimney: 1, jetty: 0 },
  townhouse: { w: [520, 700], d: [460, 600], storeys: 2, roof: 'pitch', rh: 290, wall: ['wall_timber', 'wall_plaster'], roofTex: ['roof_shingle_red', 'roof_shingle_grey'], chimney: 1, jetty: 60 },
  shop: { w: [640, 820], d: [520, 660], storeys: 2, roof: 'pitch', rh: 280, wall: ['wall_shop_front', 'wall_timber'], roofTex: ['roof_shingle_red'], chimney: 1, jetty: 70, sign: 1 },
  tavern: { w: [820, 1000], d: [640, 780], storeys: 2, roof: 'hip', rh: 320, wall: ['wall_timber'], roofTex: ['roof_shingle_red', 'roof_thatch'], chimney: 2, jetty: 80, sign: 1 },
  temple: { w: [900, 1100], d: [700, 900], storeys: 1, storeyH: 460, roof: 'hip', rh: 380, wall: ['wall_temple', 'wall_marble'], roofTex: ['roof_tile_blue', 'roof_slate'], chimney: 0, jetty: 0, columns: 1, steps: 3 },
  guild: { w: [760, 920], d: [620, 760], storeys: 2, roof: 'hip', rh: 320, wall: ['wall_marble', 'wall_plaster'], roofTex: ['roof_tile_blue'], chimney: 1, jetty: 0, sign: 1, banner: 1 },
  smithy: { w: [660, 800], d: [560, 680], storeys: 1, storeyH: 380, roof: 'pitch', rh: 250, wall: ['wall_plaster', 'wall_brick'], roofTex: ['roof_shingle_red', 'roof_slate'], chimney: 2, jetty: 0, sign: 1 },
  stable: { w: [900, 1150], d: [520, 620], storeys: 1, storeyH: 330, roof: 'pitch', rh: 240, wall: ['wall_wood_plank'], roofTex: ['roof_thatch'], chimney: 0, jetty: 0, openFront: 1 },
  tower: { w: [420, 520], d: [420, 520], storeys: 4, roof: 'pyramid', rh: 380, wall: ['wall_stone_block', 'wall_castle'], roofTex: ['roof_slate', 'roof_tile_blue'], chimney: 0, jetty: 0, crenel: 1 },
  keep: { w: [1200, 1500], d: [1000, 1300], storeys: 3, roof: 'flat', rh: 0, wall: ['wall_castle', 'wall_castle_dark'], roofTex: ['roof_slate'], chimney: 1, jetty: 0, crenel: 1, banner: 1 },
  hut: { w: [400, 500], d: [380, 460], storeys: 1, storeyH: 260, roof: 'pyramid', rh: 260, wall: ['wall_plaster', 'wall_log'], roofTex: ['roof_thatch'], chimney: 0, jetty: 0 },
  longhouse: { w: [1100, 1400], d: [520, 640], storeys: 1, storeyH: 340, roof: 'pitch', rh: 320, wall: ['wall_log', 'wall_timber'], roofTex: ['roof_thatch', 'roof_shingle_grey'], chimney: 1, jetty: 0 },
  manor: { w: [1000, 1250], d: [760, 900], storeys: 2, roof: 'hip', rh: 340, wall: ['wall_plaster', 'wall_timber'], roofTex: ['roof_shingle_red'], chimney: 2, jetty: 70, wings: 1 },
  warehouse: { w: [1000, 1300], d: [700, 860], storeys: 1, storeyH: 460, roof: 'pitch', rh: 260, wall: ['wall_plaster', 'wall_timber'], roofTex: ['roof_shingle_grey', 'roof_shingle_red'], chimney: 0, jetty: 0 },
  mill: { w: [560, 660], d: [560, 660], storeys: 2, roof: 'pyramid', rh: 300, wall: ['wall_wood_plank', 'wall_stone_block'], roofTex: ['roof_thatch'], chimney: 0, jetty: 0, sail: 1 },
  lighthouse: { w: [400, 460], d: [400, 460], storeys: 5, roof: 'pyramid', rh: 300, wall: ['wall_plaster'], roofTex: ['roof_slate'], chimney: 0, jetty: 0, lamp: 1 },
};

const STOREY_H = 310;

/**
 * Build one building.
 * @param {object} spec { style, x,z,y, rot, w,d, seed, wallTex, roofTex, sign, lit }
 * @param {Rand} rand
 * @returns {{group:THREE.Group, parts:MeshBuilder, doors:Array, colliders:Array, bounds:object, height:number}}
 */
export function buildHouse(spec = {}, rand) {
  const r = rand || new Rand(spec.seed || 1);
  const style = STYLE[spec.style] ? spec.style : 'cottage';
  const S = STYLE[style];
  const b = new MeshBuilder();

  const w = spec.w || r.float(S.w[0], S.w[1]);
  const d = spec.d || r.float(S.d[0], S.d[1]);
  const storeys = spec.storeys || S.storeys;
  const sh = S.storeyH || STOREY_H;
  const wallTex = spec.wallTex || r.pick(S.wall);
  const roofTex = spec.roofTex || r.pick(S.roofTex);
  const lit = spec.lit === undefined ? false : spec.lit;
  const winTex = lit ? 'window_lit' : 'window_dark';

  const hw = w / 2, hd = d / 2;
  const bodyTop = sh * storeys;
  const jetty = S.jetty || 0;

  // --- ground floor -------------------------------------------------------
  b.box(wallTex, -hw, 0, -hd, hw, Math.min(sh, bodyTop), hd, { sides: 'nsew' });

  // --- upper storeys, jettied out over the street -------------------------
  let topHW = hw, topHD = hd;
  for (let s = 1; s < storeys; s++) {
    const j = s === 1 ? jetty : jetty * 0.5;
    const uw = hw + j, ud = hd + j;
    b.box(wallTex, -uw, s * sh, -ud, uw, (s + 1) * sh, ud, { sides: 'nsew' });
    if (j > 0) {
      // Underside of the overhang, in shadow.
      b.quad(wallTex, [-uw, s * sh, ud], [uw, s * sh, ud], [uw, s * sh, -ud], [-uw, s * sh, -ud],
        { extra: 0.5 });
    }
    topHW = uw; topHD = ud;
  }

  // --- roof ---------------------------------------------------------------
  const oh = S.roof === 'flat' ? 0 : 70;
  const rh = S.rh;
  const RW = topHW + oh, RD = topHD + oh;
  const ry = bodyTop;
  if (S.roof === 'pitch') {
    const ridgeAlongX = w >= d;
    if (ridgeAlongX) {
      const ridgeY = ry + rh;
      b.quad(roofTex, [-RW, ry, RD], [RW, ry, RD], [RW, ridgeY, 0], [-RW, ridgeY, 0], { uu: RW * 2 / 300, vv: Math.hypot(RD, rh) / 260 });
      b.quad(roofTex, [RW, ry, -RD], [-RW, ry, -RD], [-RW, ridgeY, 0], [RW, ridgeY, 0], { uu: RW * 2 / 300, vv: Math.hypot(RD, rh) / 260 });
      // Gable ends in the wall texture, as MM6's timbered houses have.
      b.tri(wallTex, [topHW, ry, topHD], [topHW, ry, -topHD], [topHW, ridgeY, 0], { extra: 1.0 });
      b.tri(wallTex, [-topHW, ry, -topHD], [-topHW, ry, topHD], [-topHW, ridgeY, 0], { extra: 0.8 });
    } else {
      const ridgeY = ry + rh;
      b.quad(roofTex, [RW, ry, -RD], [RW, ry, RD], [0, ridgeY, RD], [0, ridgeY, -RD], { uu: RD * 2 / 300, vv: Math.hypot(RW, rh) / 260 });
      b.quad(roofTex, [-RW, ry, RD], [-RW, ry, -RD], [0, ridgeY, -RD], [0, ridgeY, RD], { uu: RD * 2 / 300, vv: Math.hypot(RW, rh) / 260 });
      b.tri(wallTex, [-topHW, ry, topHD], [topHW, ry, topHD], [0, ridgeY, topHD]);
      b.tri(wallTex, [topHW, ry, -topHD], [-topHW, ry, -topHD], [0, ridgeY, -topHD], { extra: 0.75 });
    }
  } else if (S.roof === 'hip') {
    const rl = Math.max(0, RW - RD);
    const ridgeY = ry + rh;
    b.quad(roofTex, [-RW, ry, RD], [RW, ry, RD], [rl, ridgeY, 0], [-rl, ridgeY, 0], { uu: RW * 2 / 300, vv: Math.hypot(RD, rh) / 260 });
    b.quad(roofTex, [RW, ry, -RD], [-RW, ry, -RD], [-rl, ridgeY, 0], [rl, ridgeY, 0], { uu: RW * 2 / 300, vv: Math.hypot(RD, rh) / 260 });
    b.tri(roofTex, [RW, ry, RD], [RW, ry, -RD], [rl, ridgeY, 0], { extra: 0.95 });
    b.tri(roofTex, [-RW, ry, -RD], [-RW, ry, RD], [-rl, ridgeY, 0], { extra: 0.8 });
  } else if (S.roof === 'pyramid') {
    const ridgeY = ry + rh;
    b.tri(roofTex, [-RW, ry, RD], [RW, ry, RD], [0, ridgeY, 0]);
    b.tri(roofTex, [RW, ry, -RD], [-RW, ry, -RD], [0, ridgeY, 0], { extra: 0.7 });
    b.tri(roofTex, [RW, ry, RD], [RW, ry, -RD], [0, ridgeY, 0], { extra: 0.95 });
    b.tri(roofTex, [-RW, ry, -RD], [-RW, ry, RD], [0, ridgeY, 0], { extra: 0.8 });
  } else { // flat, with a parapet
    b.quad(roofTex, [-topHW, ry, topHD], [topHW, ry, topHD], [topHW, ry, -topHD], [-topHW, ry, -topHD], { uu: 3, vv: 3 });
  }

  // --- crenellations (towers and keeps) -----------------------------------
  if (S.crenel) {
    const ch = 90, cw = 90, gap = 90;
    const y0 = S.roof === 'flat' ? ry : ry;
    const runs = [
      { ax: 'x', z: topHD, n: Math.floor(topHW * 2 / (cw + gap)) },
      { ax: 'x', z: -topHD, n: Math.floor(topHW * 2 / (cw + gap)) },
    ];
    for (const run of runs) {
      for (let i = 0; i < run.n; i++) {
        const x = -topHW + (i + 0.5) * (topHW * 2 / run.n) - cw / 2;
        b.box(wallTex, x, y0, run.z - 40, x + cw, y0 + ch, run.z + 40, { sides: 'nsewt' });
      }
    }
  }

  // --- chimney ------------------------------------------------------------
  for (let c = 0; c < (S.chimney || 0); c++) {
    const cx = lerpN(-hw * 0.6, hw * 0.6, (c + 1) / ((S.chimney || 1) + 1)) + r.float(-40, 40);
    const cz = r.float(-hd * 0.4, hd * 0.4);
    const cw = 90;
    b.box(r.bool(0.6) ? 'wall_brick' : 'wall_stone_block',
      cx - cw / 2, bodyTop - 40, cz - cw / 2, cx + cw / 2, bodyTop + rh + 130, cz + cw / 2,
      { sides: 'nsewt', uu: 0.5, vv: 1.2 });
  }

  // --- door ---------------------------------------------------------------
  const doorW = 150, doorH = 250;
  const frontZ = hd + 2;
  const doors = [];
  if (!S.openFront) {
    const dgeo = new THREE.PlaneGeometry(doorW, doorH);
    dgeo.translate(0, doorH / 2, 0);
    const doorTex = spec.doorTex || (style === 'keep' || style === 'tower' ? 'door_iron' : 'door_wood');
    const dmesh = new THREE.Mesh(dgeo, materialFor(doorTex));
    dmesh.position.set(0, 0, frontZ);
    dmesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(
      new Array(4).fill(faceShade(0, 0, 1)).flat(), 3));
    dmesh.userData.door = {
      kind: spec.doorKind || 'building',
      building: spec.name || style,
      shop: spec.shop || null,
      open: false, w: doorW, h: doorH,
    };
    dmesh.name = 'door';
    doors.push(dmesh);
    // Recessed frame around it so the door does not look pasted on.
    b.quad('wall_stone_block', [-doorW * 0.72, 0, hd + 1], [doorW * 0.72, 0, hd + 1],
      [doorW * 0.72, doorH + 60, hd + 1], [-doorW * 0.72, doorH + 60, hd + 1],
      { uu: 0.8, vv: 1.1, extra: 0.8 });
  } else {
    // Open-fronted stable: dark interior slot.
    b.quad('dun_cave_dark', [-hw * 0.7, 0, hd + 1], [hw * 0.7, 0, hd + 1],
      [hw * 0.7, sh * 0.8, hd + 1], [-hw * 0.7, sh * 0.8, hd + 1], { uu: 2, vv: 1, extra: 0.35 });
  }

  // --- steps --------------------------------------------------------------
  const nSteps = S.steps || 2;
  for (let s = 0; s < nSteps; s++) {
    const t = (nSteps - s) / nSteps;
    const sw = doorW * 0.85 + s * 40 + (S.steps ? w * 0.35 : 0);
    b.box('wall_stone_block', -sw, 0, hd, sw, 34 * t, hd + 40 + s * 46,
      { sides: 'set', uu: 1.2, vv: 0.2 });
  }

  // --- windows ------------------------------------------------------------
  const winW = 96, winH = 120;
  const placeWindows = (z, sign) => {
    for (let s = 0; s < storeys; s++) {
      const y = s * sh + sh * 0.42;
      const count = Math.max(1, Math.floor(w / 320));
      for (let i = 0; i < count; i++) {
        const x = -hw + (i + 0.5) * (w / count);
        if (s === 0 && Math.abs(x) < doorW * 0.9 && sign > 0) continue;
        const j = s >= 1 ? jetty : 0;
        const zz = (z + j * sign) + 2 * sign;
        if (sign > 0) {
          b.quad(winTex, [x - winW / 2, y, zz], [x + winW / 2, y, zz],
            [x + winW / 2, y + winH, zz], [x - winW / 2, y + winH, zz], { uu: 1, vv: 1 });
        } else {
          b.quad(winTex, [x + winW / 2, y, zz], [x - winW / 2, y, zz],
            [x - winW / 2, y + winH, zz], [x + winW / 2, y + winH, zz], { uu: 1, vv: 1, extra: 0.72 });
        }
        // Shutters flanking, which is most of what makes MM6 houses read.
        if (r.bool(0.55)) {
          const sw2 = 34;
          for (const sx of [-1, 1]) {
            const px = x + sx * (winW / 2 + sw2 / 2);
            if (sign > 0) {
              b.quad('shutters', [px - sw2 / 2, y, zz], [px + sw2 / 2, y, zz],
                [px + sw2 / 2, y + winH, zz], [px - sw2 / 2, y + winH, zz], { uu: 0.4, vv: 1 });
            } else {
              b.quad('shutters', [px + sw2 / 2, y, zz], [px - sw2 / 2, y, zz],
                [px - sw2 / 2, y + winH, zz], [px + sw2 / 2, y + winH, zz], { uu: 0.4, vv: 1, extra: 0.72 });
            }
          }
        }
      }
    }
  };
  if (!S.openFront) placeWindows(hd, 1);
  placeWindows(-hd, -1);

  // --- shop sign ----------------------------------------------------------
  if ((S.sign || spec.sign) && !S.openFront) {
    const sw = 260, shh = 120;
    const y = sh * 0.86;
    const zz = hd + 60;
    // Bracket.
    b.box('wall_stone_block', -14, y + shh, hd, 14, y + shh + 18, zz + 20, { sides: 'nsewt', uu: 0.2, vv: 0.1 });
    b.quad('sign_board', [-sw / 2, y, zz], [sw / 2, y, zz], [sw / 2, y + shh, zz], [-sw / 2, y + shh, zz], { uu: 1, vv: 0.5 });
    b.quad('sign_board', [sw / 2, y, zz - 12], [-sw / 2, y, zz - 12], [-sw / 2, y + shh, zz - 12], [sw / 2, y + shh, zz - 12], { uu: 1, vv: 0.5, extra: 0.7 });
  }

  // --- banners ------------------------------------------------------------
  if (S.banner) {
    for (const sx of [-1, 1]) {
      const x = sx * hw * 0.55;
      b.quad('wall_banner', [x - 60, bodyTop - 420, hd + 3], [x + 60, bodyTop - 420, hd + 3],
        [x + 60, bodyTop - 100, hd + 3], [x - 60, bodyTop - 100, hd + 3], { uu: 1, vv: 2 });
    }
  }

  // --- temple columns -----------------------------------------------------
  if (S.columns) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = -hw * 0.86 + i * (hw * 1.72 / (n - 1));
      b.box('wall_marble', x - 42, 0, hd + 90, x + 42, bodyTop + 40, hd + 174, { sides: 'nsewt', uu: 0.3, vv: 2 });
    }
    // Portico slab.
    b.box('wall_marble', -hw, bodyTop + 40, hd, hw, bodyTop + 90, hd + 200, { sides: 'nsewt' });
  }

  // --- windmill sails -----------------------------------------------------
  if (S.sail) {
    const cy = bodyTop + rh * 0.4, cz = hd + 40;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const L = 460, W2 = 70;
      const p = (t, o) => [ca * (t) - sa * o, cy + sa * (t) + ca * o, cz];
      b.quad('wall_wood_plank', p(60, -W2), p(L, -W2), p(L, W2), p(60, W2), { uu: 2, vv: 0.4 });
    }
  }

  // --- lighthouse lamp ----------------------------------------------------
  if (S.lamp) {
    b.box('window_lit', -hw * 0.8, bodyTop, -hd * 0.8, hw * 0.8, bodyTop + 160, hd * 0.8,
      { sides: 'nsew', uu: 1, vv: 1, extra: 1 });
  }

  const height = bodyTop + rh;
  const parts = b;

  // World placement.
  const px = spec.x || 0, py = spec.y || 0, pz = spec.z || 0;
  const rot = spec.rot || 0;
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(px, py, pz);

  const worldBuilder = new MeshBuilder();
  worldBuilder.absorb(parts, m);

  for (const dm of doors) {
    dm.position.applyMatrix4(m);
    dm.rotation.y = rot;
    dm.userData.door.pos = dm.position.clone();
    dm.userData.door.facing = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  }

  const cos = Math.cos(rot), sin = Math.sin(rot);
  const colliders = [{
    type: 'obb', x: px, z: pz, hw: topHW, hd: topHD, rot, y0: py, y1: py + height,
  }];

  const ext = Math.hypot(topHW, topHD);
  const bounds = {
    x: px, z: pz, radius: ext + 60,
    min: new THREE.Vector3(px - ext, py, pz - ext),
    max: new THREE.Vector3(px + ext, py + height, pz + ext),
  };

  let _group = null;
  return {
    parts: worldBuilder,
    doors,
    colliders,
    bounds,
    height,
    footprint: { w, d, hw: topHW, hd: topHD },
    style,
    get group() {
      if (!_group) {
        _group = new THREE.Group();
        const mesh = worldBuilder.finish();
        if (mesh) { mesh.updateMatrix(); _group.add(mesh); }
        for (const dm of doors) _group.add(dm);
      }
      return _group;
    },
  };
}

/**
 * A run of town wall, optionally with towers at the ends and a gate in the
 * middle. `spec.points` is the wall centreline.
 */
export function buildWall(spec = {}, rand) {
  const r = rand || new Rand(spec.seed || 7);
  const b = new MeshBuilder();
  const pts = spec.points || [];
  const h = spec.height || 620;
  const th = spec.thickness || 130;
  const tex = spec.tex || 'wall_castle';
  const colliders = [];
  const gates = [];
  const gapAt = spec.gates || [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const dx = c.x - a.x, dz = c.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const ang = Math.atan2(dx, dz);
    const gate = gapAt.find((g) => g.seg === i);
    // Segments split around a gate so the arch has piers on both sides.
    const runs = gate
      ? [[0, clamp(gate.t - gate.w / len / 2, 0, 1)], [clamp(gate.t + gate.w / len / 2, 0, 1), 1]]
      : [[0, 1]];
    for (const [t0, t1] of runs) {
      if (t1 - t0 < 0.01) continue;
      const x0 = a.x + dx * t0, z0 = a.z + dz * t0;
      const x1 = a.x + dx * t1, z1 = a.z + dz * t1;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const rl = Math.hypot(x1 - x0, z1 - z0);
      const sub = new MeshBuilder();
      sub.box(tex, -rl / 2, 0, -th / 2, rl / 2, h, th / 2, { sides: 'nsewt', vv: h / 260 });
      // Crenellations along the top.
      const n = Math.max(1, Math.floor(rl / 260));
      for (let k = 0; k < n; k++) {
        const x = -rl / 2 + (k + 0.25) * (rl / n);
        sub.box(tex, x, h, -th / 2, x + rl / n * 0.5, h + 100, th / 2, { sides: 'nsewt', uu: 0.4, vv: 0.4 });
      }
      const m = new THREE.Matrix4().makeRotationY(ang).setPosition(cx, spec.y || 0, cz);
      b.absorb(sub, m);
      colliders.push({ type: 'obb', x: cx, z: cz, hw: rl / 2, hd: th / 2, rot: ang, y0: spec.y || 0, y1: (spec.y || 0) + h });
    }
    if (gate) {
      const gx = a.x + dx * gate.t, gz = a.z + dz * gate.t;
      const sub = new MeshBuilder();
      const gw = gate.w, gh = spec.gateHeight || 560;
      // Lintel over the opening plus two flanking towers.
      sub.box(tex, -gw / 2, gh, -th / 2, gw / 2, h + 130, th / 2, { sides: 'nsewt', vv: 0.8 });
      for (const sx of [-1, 1]) {
        sub.box(tex, sx * (gw / 2) - (sx < 0 ? 190 : 0), 0, -th, sx * (gw / 2) + (sx < 0 ? 0 : 190), h + 260, th,
          { sides: 'nsewt', vv: h / 220 });
      }
      const m = new THREE.Matrix4().makeRotationY(ang).setPosition(gx, spec.y || 0, gz);
      b.absorb(sub, m);
      gates.push({ x: gx, z: gz, rot: ang, width: gw });
    }
  }

  // Corner towers.
  for (const t of (spec.towers || [])) {
    const sub = new MeshBuilder();
    const tw = t.w || 300, thh = t.h || h + 300;
    sub.box(tex, -tw / 2, 0, -tw / 2, tw / 2, thh, tw / 2, { sides: 'nsewt', vv: thh / 230 });
    for (let k = 0; k < 4; k++) {
      const x = -tw / 2 + k * (tw / 4);
      sub.box(tex, x, thh, -tw / 2 - 20, x + tw / 8, thh + 110, tw / 2 + 20, { sides: 'nsewt', uu: 0.3, vv: 0.4 });
    }
    b.absorb(sub, new THREE.Matrix4().setPosition(t.x, spec.y || 0, t.z));
    colliders.push({ type: 'obb', x: t.x, z: t.z, hw: tw / 2, hd: tw / 2, rot: 0, y0: spec.y || 0, y1: thh });
  }

  let _group = null;
  return {
    parts: b, colliders, gates,
    get group() {
      if (!_group) { _group = new THREE.Group(); const m = b.finish(); if (m) { m.updateMatrix(); _group.add(m); } }
      return _group;
    },
  };
}

/** A plank or stone bridge between two points. */
export function buildBridge(spec = {}, rand) {
  const r = rand || new Rand(spec.seed || 11);
  const b = new MeshBuilder();
  const a = spec.from, c = spec.to;
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz);
  const w = spec.width || 420;
  const deckTex = spec.stone ? 'road_cobble' : 'wall_wood_plank';
  const y = spec.y || 0;
  const arch = spec.arch === undefined ? Math.min(180, len * 0.10) : spec.arch;

  const sub = new MeshBuilder();
  const segs = Math.max(3, Math.round(len / 300));
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = -len / 2 + len * t0, z1 = -len / 2 + len * t1;
    const y0 = Math.sin(t0 * Math.PI) * arch, y1 = Math.sin(t1 * Math.PI) * arch;
    sub.quad(deckTex, [-w / 2, y0, z0], [w / 2, y0, z0], [w / 2, y1, z1], [-w / 2, y1, z1], { uu: 1.5, vv: 1 });
    // Parapets.
    for (const sx of [-1, 1]) {
      sub.quad('fence_wood', [sx * w / 2, y0, z0], [sx * w / 2, y1, z1], [sx * w / 2, y1 + 110, z1], [sx * w / 2, y0 + 110, z0], { uu: 1, vv: 0.4 });
    }
  }
  // Piers.
  for (let i = 1; i < segs; i += 2) {
    const t = i / segs;
    const z = -len / 2 + len * t;
    const py = Math.sin(t * Math.PI) * arch;
    sub.box(spec.stone ? 'wall_stone_block' : 'wall_log', -w * 0.36, -600, z - 50, -w * 0.24, py, z + 50, { sides: 'nsew' });
    sub.box(spec.stone ? 'wall_stone_block' : 'wall_log', w * 0.24, -600, z - 50, w * 0.36, py, z + 50, { sides: 'nsew' });
  }
  b.absorb(sub, new THREE.Matrix4().makeRotationY(ang).setPosition((a.x + c.x) / 2, y, (a.z + c.z) / 2));

  let _group = null;
  return {
    parts: b,
    colliders: [],
    walkable: { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, rot: ang, len, w, y, arch },
    get group() {
      if (!_group) { _group = new THREE.Group(); const m = b.finish(); if (m) { m.updateMatrix(); _group.add(m); } }
      return _group;
    },
  };
}

/** Broken walls, a fallen column or two. Scatter dressing for the wilderness. */
export function buildRuins(spec = {}, rand) {
  const r = rand || new Rand(spec.seed || 13);
  const b = new MeshBuilder();
  const tex = spec.tex || 'wall_stone_block';
  const R = spec.radius || 600;
  const n = spec.count || r.int(4, 7);
  const colliders = [];
  const px = spec.x || 0, py = spec.y || 0, pz = spec.z || 0;

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.float(-0.3, 0.3);
    const rr = R * r.float(0.6, 1.0);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const w = r.float(180, 460), h = r.float(120, 520), th = 110;
    const sub = new MeshBuilder();
    // Broken top edge: two blocks of different heights.
    sub.box(tex, -w / 2, 0, -th / 2, 0, h, th / 2, { sides: 'nsewt', vv: h / 240 });
    sub.box(tex, 0, 0, -th / 2, w / 2, h * r.float(0.4, 0.9), th / 2, { sides: 'nsewt', vv: h / 240 });
    const ang = a + Math.PI / 2 + r.float(-0.4, 0.4);
    b.absorb(sub, new THREE.Matrix4().makeRotationY(ang).setPosition(px + x, py, pz + z));
    colliders.push({ type: 'obb', x: px + x, z: pz + z, hw: w / 2, hd: th / 2, rot: ang, y0: py, y1: py + h });
  }
  // A couple of fallen columns.
  for (let i = 0; i < (spec.columns || 2); i++) {
    const a = r.float(0, Math.PI * 2), rr = R * r.float(0.1, 0.7);
    const sub = new MeshBuilder();
    sub.box('wall_marble', -260, 0, -55, 260, 110, 55, { sides: 'nsewt', uu: 2, vv: 0.3 });
    b.absorb(sub, new THREE.Matrix4().makeRotationY(r.float(0, Math.PI))
      .setPosition(px + Math.cos(a) * rr, py, pz + Math.sin(a) * rr));
  }

  let _group = null;
  return {
    parts: b, colliders,
    bounds: { x: px, z: pz, radius: R + 300 },
    get group() {
      if (!_group) { _group = new THREE.Group(); const m = b.finish(); if (m) { m.updateMatrix(); _group.add(m); } }
      return _group;
    },
  };
}

// --- small props -----------------------------------------------------------

/**
 * Town dressing. Everything here is a handful of triangles and lands in the
 * same merged buffer as the buildings.
 * @param {MeshBuilder} b
 */
export function addProp(b, kind, x, y, z, rot = 0, rand) {
  const r = rand || new Rand(((x * 31 + z * 17) | 0) >>> 0);
  const sub = new MeshBuilder();
  switch (kind) {
    case 'barrel':
      sub.box('barrel_side', -60, 0, -60, 60, 150, 60, { sides: 'nsewt', uu: 0.5, vv: 0.6 });
      break;
    case 'crate':
      sub.box('crate_side', -70, 0, -70, 70, 140, 70, { sides: 'nsewt', uu: 0.5, vv: 0.5 });
      break;
    case 'haystack':
      sub.box('roof_thatch', -140, 0, -140, 140, 130, 140, { sides: 'nsew', uu: 1, vv: 0.5 });
      sub.tri('roof_thatch', [-140, 130, 140], [140, 130, 140], [0, 300, 0]);
      sub.tri('roof_thatch', [140, 130, -140], [-140, 130, -140], [0, 300, 0], { extra: 0.7 });
      sub.tri('roof_thatch', [140, 130, 140], [140, 130, -140], [0, 300, 0], { extra: 0.9 });
      sub.tri('roof_thatch', [-140, 130, -140], [-140, 130, 140], [0, 300, 0], { extra: 0.8 });
      break;
    case 'lamppost':
      sub.box('wall_stone_block', -20, 0, -20, 20, 400, 20, { sides: 'nsew', uu: 0.2, vv: 1.5 });
      sub.box('window_lit', -45, 400, -45, 45, 520, 45, { sides: 'nsewt', uu: 1, vv: 1 });
      break;
    case 'bench':
      sub.box('wall_wood_plank', -140, 60, -45, 140, 80, 45, { sides: 'nsewt', uu: 1, vv: 0.2 });
      sub.box('wall_wood_plank', -130, 0, -35, -100, 60, 35, { sides: 'nsew' });
      sub.box('wall_wood_plank', 100, 0, -35, 130, 60, 35, { sides: 'nsew' });
      break;
    case 'signpost':
      sub.box('wall_wood_plank', -16, 0, -16, 16, 330, 16, { sides: 'nsew', uu: 0.2, vv: 1.2 });
      sub.quad('sign_board', [-130, 240, 20], [130, 240, 20], [130, 330, 20], [-130, 330, 20], { uu: 1, vv: 0.4 });
      sub.quad('sign_board', [130, 240, 0], [-130, 240, 0], [-130, 330, 0], [130, 330, 0], { uu: 1, vv: 0.4, extra: 0.7 });
      break;
    case 'well': {
      const n = 8, R = 150;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const p0 = [Math.cos(a0) * R, 0, Math.sin(a0) * R];
        const p1 = [Math.cos(a1) * R, 0, Math.sin(a1) * R];
        sub.quad('wall_stone_block', p0, p1, [p1[0], 200, p1[2]], [p0[0], 200, p0[2]], { uu: 0.5, vv: 0.7 });
      }
      // Water disc and a shingled canopy on two posts.
      sub.quad('water', [-R * 0.7, 120, R * 0.7], [R * 0.7, 120, R * 0.7], [R * 0.7, 120, -R * 0.7], [-R * 0.7, 120, -R * 0.7], { uu: 1, vv: 1, extra: 0.5 });
      for (const sx of [-1, 1]) sub.box('wall_wood_plank', sx * 130 - 18, 200, -18, sx * 130 + 18, 480, 18, { sides: 'nsew' });
      sub.tri('roof_shingle_red', [-200, 480, 200], [200, 480, 200], [0, 610, 0]);
      sub.tri('roof_shingle_red', [200, 480, -200], [-200, 480, -200], [0, 610, 0], { extra: 0.7 });
      sub.tri('roof_shingle_red', [200, 480, 200], [200, 480, -200], [0, 610, 0], { extra: 0.9 });
      sub.tri('roof_shingle_red', [-200, 480, -200], [-200, 480, 200], [0, 610, 0], { extra: 0.8 });
      break;
    }
    case 'fountain': {
      const n = 10, R = 260;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        sub.quad('wall_marble', [Math.cos(a0) * R, 0, Math.sin(a0) * R], [Math.cos(a1) * R, 0, Math.sin(a1) * R],
          [Math.cos(a1) * R, 130, Math.sin(a1) * R], [Math.cos(a0) * R, 130, Math.sin(a0) * R], { uu: 0.4, vv: 0.4 });
      }
      sub.quad('water', [-R * 0.9, 110, R * 0.9], [R * 0.9, 110, R * 0.9], [R * 0.9, 110, -R * 0.9], [-R * 0.9, 110, -R * 0.9], { uu: 2, vv: 2, extra: 0.7 });
      sub.box('wall_marble', -50, 110, -50, 50, 330, 50, { sides: 'nsewt', uu: 0.3, vv: 0.6 });
      break;
    }
    case 'stall': {
      const w = 260, d = 180;
      sub.box('wall_wood_plank', -w, 180, -d, w, 220, d, { sides: 'nsewt', uu: 1.5, vv: 0.2 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        sub.box('wall_wood_plank', sx * w - 18, 0, sz * d - 18, sx * w + 18, 420, sz * d + 18, { sides: 'nsew' });
      }
      // Striped awning, two slopes.
      sub.quad('wall_banner', [-w - 60, 420, d + 80], [w + 60, 420, d + 80], [w + 60, 520, 0], [-w - 60, 520, 0], { uu: 2, vv: 0.5 });
      sub.quad('wall_banner', [w + 60, 420, -d - 80], [-w - 60, 420, -d - 80], [-w - 60, 520, 0], [w + 60, 520, 0], { uu: 2, vv: 0.5, extra: 0.7 });
      break;
    }
    case 'cart':
      sub.box('wall_wood_plank', -180, 120, -110, 180, 250, 110, { sides: 'nsewt', uu: 1, vv: 0.4 });
      for (const sx of [-1, 1]) {
        sub.quad('wall_wood_plank', [sx * 190, 0, -110], [sx * 190, 0, 110], [sx * 190, 220, 110], [sx * 190, 220, -110], { uu: 0.8, vv: 0.8 });
      }
      sub.box('wall_wood_plank', -30, 180, 110, 30, 220, 320, { sides: 'nsewt' });
      break;
    case 'fence': {
      const len = 400;
      sub.quad('fence_wood', [-len / 2, 0, 0], [len / 2, 0, 0], [len / 2, 180, 0], [-len / 2, 180, 0], { uu: 1.5, vv: 0.7 });
      sub.quad('fence_wood', [len / 2, 0, -8], [-len / 2, 0, -8], [-len / 2, 180, -8], [len / 2, 180, -8], { uu: 1.5, vv: 0.7, extra: 0.7 });
      break;
    }
    case 'flowerbed':
      sub.box('wall_stone_block', -170, 0, -110, 170, 70, 110, { sides: 'nsewt', uu: 1, vv: 0.2, topTex: 'grass_lush' });
      break;
    case 'brazier':
      sub.box('wall_stone_block', -40, 0, -40, 40, 220, 40, { sides: 'nsew', uu: 0.3, vv: 0.7 });
      sub.box('lava_glow', -70, 220, -70, 70, 290, 70, { sides: 'nsewt', uu: 1, vv: 1 });
      break;
    default:
      sub.box('crate_side', -60, 0, -60, 60, 120, 60, { sides: 'nsewt' });
      break;
  }
  b.absorb(sub, new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z));
  return b;
}
