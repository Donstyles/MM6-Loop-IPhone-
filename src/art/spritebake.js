import * as THREE from 'three';
import { PALETTE, nearestIndex } from '../core/palette.js';
import { makeCanvas, ctx2d } from './texcanvas.js';
import { ACTIONS, CREATURE_DEFS, CREATURE_FAMILIES, buildCreature, buildNPC } from './models/creatures.js';
import { FLORA_DEFS, buildFlora } from './models/flora.js';
import { PROP_DEFS, buildProp } from './models/props.js';

// ---------------------------------------------------------------------------
// Sprite baking.
//
// This is the heart of the MM6 look. Every monster, tree and prop in the world
// is a billboard whose texture was pre-rendered from a 3D model at 8 yaw
// angles, exactly as the original game's artists did in 3D Studio. We do the
// same thing at load time:
//
//   - one offscreen render target holds the whole atlas
//   - one orthographic camera frames the model, fixed for the whole bake
//   - each (action, frame, angle) cell is drawn with viewport + scissor into
//     its slot, so the entire sheet costs one render target and no readbacks
//     until the very end
//   - one readback, then the CPU flips, cuts the alpha to 1 bit and palettises
//     with an ordered dither
//
// The shading is a fixed key/fill rig in *view* space - the model turns, the
// lights do not, which is what makes all eight octants look like they came off
// the same turntable, and why an MM6 sprite stays lit from the left no matter
// where the sun is. It is smooth-shaded and un-outlined; the hard banding comes
// from the 256-colour palettisation, exactly as it did in 1998.
// ---------------------------------------------------------------------------

export const ANGLES = 8;

// MM6 ships five distinct views per animation frame and flags the other three
// octants as horizontal mirrors (SPRITE_FRAME_MIRROR_n = 0x100 << n): octants
// 5, 6 and 7 reuse the bitmaps of 3, 2 and 1. Baking the same way costs 40%
// less atlas and is bit-for-bit the layout the engine expects.
export const VIEWS = 5;
export const OCTANT_VIEW = [0, 1, 2, 3, 4, 3, 2, 1];
export const OCTANT_MIRROR = [0, 0, 0, 0, 0, 1, 1, 1];

/** The engine's octant pick, in MM6's 2048-unit angle space. */
export function octantFor(actorYaw, angleToCam) {
  return ((1024 + 128 + (actorYaw | 0) - (angleToCam | 0)) >> 8) & 7;
}

// Light rig, in view space. A single baked key from the camera's upper-front-
// left, exactly as the original turntable renders were lit - which is why an
// MM6 sprite stays lit from the left no matter where the sun is. There is
// deliberately no rim, no outline and no cel banding, because the 256-colour
// palettisation is what does the banding.
//
// The numbers matter more than they look. A sprite is 40-80 px tall in play and
// is seen against grass at luminance 72-118, so the *shadow* side is what
// decides whether the creature reads as a creature or as a hole in the ground.
// MM6's turntable renders sit at roughly 3:1 lit-to-shadow with the shadow side
// still carrying its hue; a deeper falloff turns every figure into a
// silhouette. Hence: a large ambient term, a key that only just clips at the
// highlight, and a wide wrap so the whole front of a cylindrical limb stays
// above half. lit = ambient + key = 1.06 (clips to flat albedo, which is where
// the palettised "flat highlight" look comes from); shadow = ambient = 0.32,
// i.e. 3.3:1.
const LIGHT_D = {
  keyDir: [-0.52, 0.60, 0.61],
  fillDir: [0.66, -0.16, 0.34],
  fillCol: [0.34, 0.40, 0.52],
  ambient: 0.32,
  key: 0.74,
  fill: 0.17,
  wrap: 0.30,   // how much of the key wraps past the terminator
  bands: 0,
};

const VERT = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// One material for the whole model: colour and self-illumination ride in on
// vertex attributes so every limb of a creature merges into a handful of draw
// calls instead of one per box.
const VERT_VC = `
attribute vec3 aColor;
attribute float aEmissive;
varying vec3 vN;
varying vec3 vC;
varying float vE;
varying vec3 vP;
void main() {
  vN = normalize(normalMatrix * normal);
  vC = aColor;
  vE = aEmissive;
  // Object space, so the surface texture rides with the model through all
  // eight octants instead of crawling across it as the turntable turns.
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform float uAmbient;
uniform float uKey;
uniform float uFill;
uniform float uWrap;
uniform float uBands;
uniform float uHeight;
varying vec3 vN;
varying vec3 vC;
varying float vE;
varying vec3 vP;

// Surface grain. A pre-rendered MM6 monster was a *textured* model, so no
// large flat plane on it ever came out as one flat colour - the hide, the
// mail, the cloth all carried value break-up that the palettiser then banded.
// Two octaves of object-space value noise put that back without needing UVs.
float sHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
float sNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x),
        mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x),
        mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  vec3 N = normalize(vN);
  float nd = dot(N, uKeyDir);
  // Lambert blended with a wide wrap term. The wrap is what keeps a low-poly
  // limb from banding straight from lit to black across two facets: it pushes
  // the terminator round the side of a cylinder so the figure still has volume
  // when it is 30 px wide.
  float k = max(nd, 0.0) * (1.0 - uWrap) + (nd * 0.5 + 0.5) * uWrap;
  float f = max(dot(N, uFillDir), 0.0);
  float s = uAmbient + uKey * k;
  float grain = sNoise(vP * 0.075) * 0.62 + sNoise(vP * 0.26) * 0.38;
  s *= 0.86 + grain * 0.28;
  // Height ramp. A turntable render keyed from above puts a bright shoulder and
  // crown on a figure and drops its belly, thighs and the undersides of its
  // limbs into shade. Without it a front-facing torso is one flat plane of one
  // colour, and a green monster on green grass has no silhouette at all.
  float up = clamp(vP.y / max(1.0, uHeight), 0.0, 1.0);
  s *= 0.68 + 0.40 * up * up * (3.0 - 2.0 * up);
  // uBands > 0 forces discrete shading; MM6 did not do this, the palette did,
  // so the default is 0 and the gradient stays smooth until it is palettised.
  if (uBands > 0.5) s = floor(s * uBands + 0.5) / uBands;
  vec3 c = vC * s + uFillCol * (f * uFill) * (0.35 + vC);
  c = mix(c, vC * (1.0 + 0.25 * s), vE);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

let _celMat = null;
let _lightSig = '';

function celMaterial(L) {
  const sig = JSON.stringify(L);
  if (_celMat && sig === _lightSig) return _celMat;
  if (_celMat) _celMat.dispose();
  _lightSig = sig;
  _celMat = new THREE.ShaderMaterial({
    vertexShader: VERT_VC,
    fragmentShader: FRAG,
    uniforms: {
      // Raw sRGB values in, final byte out - no colour management, no tone
      // mapping, so what we read back is exactly what the shader drew.
      uKeyDir: { value: new THREE.Vector3().fromArray(L.keyDir).normalize() },
      uFillDir: { value: new THREE.Vector3().fromArray(L.fillDir).normalize() },
      uFillCol: { value: new THREE.Vector3().fromArray(L.fillCol) },
      uAmbient: { value: L.ambient },
      uKey: { value: L.key },
      uFill: { value: L.fill },
      uWrap: { value: L.wrap === undefined ? 0.15 : L.wrap },
      uBands: { value: L.bands },
      uHeight: { value: 200 },
    },
    side: THREE.DoubleSide,   // wings, leaves and banners are single quads
    toneMapped: false,
    fog: false,
  });
  return _celMat;
}

const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _v3 = new THREE.Vector3();

/**
 * Collapse every Group's direct mesh children into one vertex-coloured mesh.
 *
 * A creature is 40-80 little boxes, and the sheet renders it 140 times, so the
 * bake is entirely draw-call bound. Limb transforms live on the Groups (the
 * animation only ever rotates Groups), so the meshes inside a Group are rigid
 * relative to each other and can be baked together. This typically takes a
 * humanoid from ~70 draw calls a frame to ~14.
 */
function flattenModel(root, L) {
  const mat = celMaterial(L);
  const added = [];
  const hidden = [];
  const groups = [];
  root.traverse((o) => { if (o.isGroup || o.isObject3D && !o.isMesh) groups.push(o); });
  for (const g of groups) {
    const meshes = [];
    for (const c of g.children) if (c.isMesh && c.visible) meshes.push(c);
    if (!meshes.length) continue;
    let total = 0;
    const parts = [];
    for (const m of meshes) {
      let geo = m.geometry;
      const tmp = !!geo.index;
      if (tmp) geo = geo.toNonIndexed();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      parts.push({ m, geo, tmp });
      total += geo.attributes.position.count;
    }
    const P = new Float32Array(total * 3);
    const N = new Float32Array(total * 3);
    const C = new Float32Array(total * 3);
    const E = new Float32Array(total);
    let o = 0;
    for (const part of parts) {
      const { m, geo } = part;
      m.updateMatrix();
      _m4.copy(m.matrix);
      _m3.getNormalMatrix(_m4);
      const src = m.material;
      const hex = src.color ? src.color.getHex(THREE.SRGBColorSpace) : 0xffffff;
      const cr = ((hex >> 16) & 255) / 255, cg = ((hex >> 8) & 255) / 255, cb = (hex & 255) / 255;
      const em = (src.userData && src.userData.emissive) || 0;
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      for (let i = 0; i < pos.count; i++, o++) {
        _v3.fromBufferAttribute(pos, i).applyMatrix4(_m4);
        P[o * 3] = _v3.x; P[o * 3 + 1] = _v3.y; P[o * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
        N[o * 3] = _v3.x; N[o * 3 + 1] = _v3.y; N[o * 3 + 2] = _v3.z;
        C[o * 3] = cr; C[o * 3 + 1] = cg; C[o * 3 + 2] = cb;
        E[o] = em;
      }
      if (part.tmp) geo.dispose();
      m.visible = false;
      hidden.push(m);
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(P, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    merged.setAttribute('aColor', new THREE.BufferAttribute(C, 3));
    merged.setAttribute('aEmissive', new THREE.BufferAttribute(E, 1));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    g.add(mesh);
    added.push([g, mesh]);
  }
  return { added, hidden };
}

function unflatten(flat) {
  for (const [g, mesh] of flat.added) { g.remove(mesh); mesh.geometry.dispose(); }
  for (const m of flat.hidden) m.visible = true;
}

// --- atlas layout ----------------------------------------------------------

// Transparent texels kept clear on every side of every cell. MM6's sprites are
// individually cropped bitmaps with nothing next to them; ours are neighbours
// in one atlas, and a nearest-filtered quad whose UVs land exactly on a cell
// boundary can pick up the texel across the seam. One clear texel makes that
// impossible without needing a half-texel UV fudge that would resample the art.
const GUARD = 1;

/**
 * Choose a cell size and a block layout that packs `frames * angles` cells
 * into at most `maxAtlas` square. Columns come in blocks of `views`, so a row
 * of the atlas holds one or more complete view strips; that keeps the "rows are
 * frames, columns are views" reading of the sheet while still fitting a
 * 31-frame humanoid (155 cells) inside 1024x1024.
 */
function fitAtlas(frames, angles, aspect, maxAtlas, maxCellH) {
  let best = null;
  for (let B = 1; B <= frames; B++) {
    const rows = Math.ceil(frames / B);
    const byRows = Math.floor(maxAtlas / rows);
    const byCols = Math.floor(maxAtlas / (angles * B) / aspect);
    const cellH = Math.min(maxCellH, byRows, byCols);
    if (cellH < 6) continue;
    if (!best || cellH > best.cellH) best = { B, rows, cellH };
    if (cellH >= maxCellH) break;
  }
  if (!best) best = { B: frames, rows: 1, cellH: 8 };
  const cellH = Math.max(6, best.cellH & ~1);
  const cellW = Math.max(6, Math.round(cellH * aspect) & ~1);
  return {
    cellW, cellH, blocks: best.B, rows: best.rows,
    cols: best.B * angles,
    atlasW: cellW * best.B * angles,
    atlasH: cellH * best.rows,
  };
}

// --- render target pool ----------------------------------------------------

let _rt = null;
function getRT(w, h) {
  if (_rt && _rt.width >= w && _rt.height >= h) return _rt;
  if (_rt) _rt.dispose();
  const s = Math.max(w, h, _rt ? Math.max(_rt.width, _rt.height) : 0);
  _rt = new THREE.WebGLRenderTarget(s, s, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,           // MSAA would give us soft edges; MM6 sprites are 1-bit masked
    generateMipmaps: false,
  });
  return _rt;
}

const _scene = new THREE.Scene();
const _pivot = new THREE.Group();
_scene.add(_pivot);
const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
const _box = new THREE.Box3();
const _v = new THREE.Vector3();

// How much of each pose's extra reach the frame has to accommodate, as
// [action, t, verticalWeight, radialWeight]. MM6 crops every frame to its own
// bounding box; we are stuck with one cell for the whole sheet, so the idle and
// walk poses get the frame to themselves and the extreme poses (a swung club, a
// raised staff, a corpse lying full-length) are allowed to run over the edge
// rather than shrinking the sprite you look at 95% of the time.
//
// The radial weights are deliberately much smaller than the vertical ones. A
// club swing triples the silhouette's radius for three frames out of twenty-
// eight; letting it set the cell width costs every other frame more than half
// its horizontal resolution, which is precisely how a goblin ends up 21 texels
// wide inside a 48-texel cell.
// [action, t, weightUp, weightDown, weightRadial]
const POSE_WEIGHT = [
  ['stand', 0, 1, 1, 1], ['walk', 0.25, 1, 1, 1], ['bored', 0.25, 1, 0.6, 0.55],
  ['attack_melee', 0.55, 0.55, 0.25, 0.22], ['attack_ranged', 0.5, 0.5, 0.20, 0.20],
  ['dying', 1, 0.25, 0.30, 0.18],
];

function measure(model, actionList) {
  const grab = (action, t) => {
    if (model.pose) model.pose(action, t);
    model.root.updateMatrixWorld(true);
    _box.setFromObject(model.root, true);
    if (!isFinite(_box.min.y)) return null;
    return {
      minY: _box.min.y, maxY: _box.max.y,
      R: Math.max(Math.abs(_box.min.x), Math.abs(_box.max.x), Math.abs(_box.min.z), Math.abs(_box.max.z)),
    };
  };
  const base = grab('stand', 0);
  if (!base) {
    const h = model.height || 1;
    return { minY: 0, maxY: h, R: h * 0.3 };
  }
  let minY = base.minY, maxY = base.maxY, R = base.R;
  for (const [action, t, wUp, wDown, wR] of POSE_WEIGHT) {
    if (!actionList.includes(action)) continue;
    const s = grab(action, t);
    if (!s) continue;
    // Downward allowance is kept small on purpose: the shell anchors the quad's
    // bottom edge to the entity's ground point, so every texel of clear space
    // under the feet is a texel the creature visibly floats by.
    minY = Math.min(minY, base.minY + (s.minY - base.minY) * wDown);
    maxY = Math.max(maxY, base.maxY + (s.maxY - base.maxY) * wUp);
    R = Math.max(R, base.R + (s.R - base.R) * wR);
  }
  if (model.pose) model.pose('stand', 0);
  minY = Math.min(minY, 0);
  return { minY, maxY, R: Math.max(R, 1e-3) };
}

/**
 * Bake a sprite sheet.
 * @param {THREE.WebGLRenderer} renderer
 * @param {(seed:number)=>{root:THREE.Object3D,height:number,pose:Function,dispose?:Function}} builderFn
 * @param {object} opts
 * @returns {object} SpriteSheet
 */
export function bakeSheet(renderer, builderFn, opts = {}) {
  const {
    kind = 'sprite',
    seed = 1,
    actions: actionSpec = ACTIONS,
    views = VIEWS,
    maxCellH = 96,
    maxAtlas = 1024,
    aspect: aspectHint = 0,
    light = null,
    outline = false,
    palette = true,
    dither = 5,
    margin = 1.06,
    elevation = 0.13,
    keepModel = false,
  } = opts;

  const L = light ? { ...LIGHT_D, ...light } : LIGHT_D;
  const model = builderFn(seed);
  const actionNames = Object.keys(actionSpec);

  // --- layout -------------------------------------------------------------
  const actionMap = {};
  let total = 0;
  for (const a of actionNames) {
    const spec = actionSpec[a];
    actionMap[a] = { row0: total, frames: spec.frames, loop: !!spec.loop, fps: spec.fps || 8 };
    total += spec.frames;
  }

  const m = measure(model, actionNames);
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  const cy = (m.minY + m.maxY) / 2;
  // The camera looks slightly down, so depth turns into screen height. `R*se`
  // is the worst case (the deepest point at the extreme octant); charging the
  // full worst case to every octant is what puts a long, low creature like a
  // rat in a cell twice its own height - and since the shell anchors the quad's
  // bottom edge to the ground, half of that surplus becomes visible float.
  // 0.75 of it clips nothing in practice at these elevations.
  let halfH = ((m.maxY - m.minY) / 2) * ce + m.R * se * 0.75;
  let halfW = m.R;
  halfH *= margin; halfW *= margin;
  const measured = halfW / Math.max(1e-4, halfH);
  const aspect = Math.min(2.8, Math.max(0.35, aspectHint || measured));

  const lay = fitAtlas(total, views, aspect, maxAtlas, maxCellH);
  // Re-fit the camera box to the *drawable* part of the cell (the guard band is
  // not drawn into) so nothing is squashed.
  const drawW = lay.cellW - GUARD * 2, drawH = lay.cellH - GUARD * 2;
  const cellAspect = drawW / drawH;
  if (halfW / halfH > cellAspect) halfH = halfW / cellAspect; else halfW = halfH * cellAspect;

  const dist = Math.max(halfH, halfW) * 8 + 100;
  _cam.left = -halfW; _cam.right = halfW; _cam.top = halfH; _cam.bottom = -halfH;
  _cam.near = 1; _cam.far = dist * 3;
  _cam.position.set(0, cy + dist * se, dist * ce);
  _cam.lookAt(0, cy, 0);
  _cam.updateProjectionMatrix();
  _cam.updateMatrixWorld(true);

  // --- render -------------------------------------------------------------
  const flat = flattenModel(model.root, L);
  // Tell the height ramp how tall this model actually is, in its own units.
  if (_celMat) _celMat.uniforms.uHeight.value = Math.max(1, m.maxY - Math.min(0, m.minY));
  _pivot.clear();
  _pivot.add(model.root);
  _pivot.rotation.set(0, 0, 0);

  const rt = getRT(lay.atlasW, lay.atlasH);
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevScissorTest = renderer.getScissorTest();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(rt);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setClearColor(0x000000, 0);
  // wipe the whole target once so stale pixels from a previous, larger bake
  // never leak into the readback region
  renderer.setViewport(0, 0, rt.width, rt.height);
  renderer.setScissor(0, 0, rt.width, rt.height);
  renderer.clear(true, true, false);

  const step = (Math.PI * 2) / ANGLES;
  for (let a = 0; a < actionNames.length; a++) {
    const name = actionNames[a];
    const info = actionMap[name];
    for (let f = 0; f < info.frames; f++) {
      const t = info.frames <= 1 ? 0 : (info.loop ? f / info.frames : f / (info.frames - 1));
      if (model.pose) model.pose(name, t);
      const idx = info.row0 + f;
      const row = Math.floor(idx / lay.blocks);
      const blk = idx % lay.blocks;
      // GL's origin is bottom-left; row 0 is the top of the finished atlas.
      const gy = lay.atlasH - (row + 1) * lay.cellH;
      for (let ang = 0; ang < views; ang++) {
        _pivot.rotation.y = ang * step;
        const gx = (blk * views + ang) * lay.cellW;
        // Draw into the cell inset by GUARD texels on every side, and scissor
        // to the same rect. That leaves a transparent frame around each cell,
        // so a swung club that overruns its frame is clipped inside its own
        // cell instead of bleeding a stray texel into the neighbouring octant
        // when the quad samples right on a cell boundary.
        renderer.setViewport(gx + GUARD, gy + GUARD, lay.cellW - GUARD * 2, lay.cellH - GUARD * 2);
        renderer.setScissor(gx, gy, lay.cellW, lay.cellH);
        renderer.clear(true, true, false);
        renderer.setScissor(gx + GUARD, gy + GUARD, lay.cellW - GUARD * 2, lay.cellH - GUARD * 2);
        renderer.render(_scene, _cam);
      }
    }
  }

  const buf = new Uint8Array(lay.atlasW * lay.atlasH * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, lay.atlasW, lay.atlasH, buf);

  renderer.setScissorTest(prevScissorTest);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevClearAlpha);
  renderer.setRenderTarget(prevTarget);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.setScissor(0, 0, renderer.domElement.width, renderer.domElement.height);

  _pivot.clear();
  unflatten(flat);
  if (!keepModel && model.dispose) model.dispose();

  // --- CPU pass -----------------------------------------------------------
  const canvas = makeCanvas(lay.atlasW, lay.atlasH);
  const g = ctx2d(canvas);
  const img = g.createImageData(lay.atlasW, lay.atlasH);
  flipAndCut(buf, img.data, lay.atlasW, lay.atlasH);
  if (outline) rimOutline(img.data, lay);
  if (palette) palettise(img, dither);
  g.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // The camera box spans the drawable rect, but the quad spans the whole cell,
  // so the world size of a cell is the camera box grown by the guard band.
  const unitsPerTexel = (halfH * 2) / drawH;
  const worldH = unitsPerTexel * lay.cellH, worldW = (halfW * 2 / drawW) * lay.cellW;
  const firstAction = actionNames[0];

  return {
    kind, seed, texture, canvas,
    cellW: lay.cellW, cellH: lay.cellH,
    cols: lay.cols, rows: lay.rows, blocks: lay.blocks,
    atlasW: lay.atlasW, atlasH: lay.atlasH,
    angles: ANGLES, views, actions: actionMap, frames: total,
    worldW, worldH,
    height: model.height,
    // Billboards are bottom-anchored (the sprite's bottom edge sits at the
    // object's Z). `groundOffset` is how far above that bottom edge the model's
    // own y=0 plane falls, so a caller can place the quad exactly.
    groundOffset: (0 - cy) * ce + halfH + GUARD * unitsPerTexel,
    footOffset: (m.minY - cy) * ce,

    /**
     * Instance scale that puts the *model* (not the padded cell) at
     * `worldHeight` units tall. `worldH` is the quad, which is always a little
     * larger than the creature because of the framing margin and the guard
     * band, so scaling by `size / worldH` silently shrinks every monster.
     */
    scaleFor(worldHeight) { return worldHeight / (this.height || this.worldH); },

    /**
     * Pixel rect of a cell, origin top-left. `angle` is an octant 0..7; octants
     * 5..7 resolve to the mirrored source view and set `mirror`.
     */
    rect(action, frame, angle) {
      const info = this.actions[action] || this.actions[firstAction];
      const f = Math.max(0, Math.min(info.frames - 1, frame | 0));
      const idx = info.row0 + f;
      const row = Math.floor(idx / this.blocks);
      const blk = idx % this.blocks;
      const oct = (((angle | 0) % ANGLES) + ANGLES) % ANGLES;
      const view = this.views >= ANGLES ? oct : OCTANT_VIEW[oct];
      const col = blk * this.views + view;
      return {
        x: col * this.cellW, y: row * this.cellH, w: this.cellW, h: this.cellH,
        mirror: this.views >= ANGLES ? 0 : OCTANT_MIRROR[oct],
      };
    },

    /**
     * [u0, v0, u1, v1] with v0 at the bottom edge, ready for a plane's UVs.
     * Mirrored octants come back with u0 > u1, which flips the quad for free.
     */
    uv(action, frame, angle) {
      const r = this.rect(action, frame, angle);
      let u0 = r.x / this.atlasW, u1 = (r.x + r.w) / this.atlasW;
      if (r.mirror) { const t2 = u0; u0 = u1; u1 = t2; }
      const v1 = 1 - r.y / this.atlasH, v0 = 1 - (r.y + r.h) / this.atlasH;
      return [u0, v0, u1, v1];
    },

    /** Frame index within an action for a wall-clock time, honouring fps. */
    frameAt(action, seconds) {
      const info = this.actions[action] || this.actions[firstAction];
      const n = Math.floor(seconds * info.fps);
      return info.loop ? ((n % info.frames) + info.frames) % info.frames
        : Math.min(info.frames - 1, Math.max(0, n));
    },

    dispose() { this.texture.dispose(); },
  };
}

// --- palettisation ---------------------------------------------------------
// Same ordered dither as palette.js `ditherImageData`, but memoised on the
// exact 24-bit colour. A baked sheet only contains a few thousand distinct
// shades across a million pixels, so the 256-entry nearest-colour search runs
// a couple of thousand times instead of a million and the whole pass costs
// almost nothing. The 16 MB memo is shared across every sheet in the session.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let _memo = null;

function palettise(img, amount) {
  if (!_memo) _memo = new Uint8Array(1 << 24);
  const memo = _memo;
  const { data, width, height } = img;
  for (let y = 0; y < height; y++) {
    const brow = (y & 3) * 4;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const t = (BAYER4[brow + (x & 3)] / 16 - 0.46875) * amount;
      let r = data[i] + t, g = data[i + 1] + t, b = data[i + 2] + t;
      r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
      g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
      const key = (r << 16) | (g << 8) | b;
      // 0 means "not cached yet"; palette index 255 wraps to 0 and simply
      // gets recomputed, which is correct and vanishingly rare.
      let idx = memo[key];
      if (idx === 0) { idx = nearestIndex(r, g, b) + 1; memo[key] = idx; }
      const p = PALETTE[idx - 1];
      data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
    }
  }
  return img;
}

/** Bottom-up RGBA -> top-down RGBA with a hard 1-bit alpha cut. */
function flipAndCut(src, dst, w, h) {
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    let s = (h - 1 - y) * rowBytes;
    let d = y * rowBytes;
    for (let x = 0; x < w; x++, s += 4, d += 4) {
      if (src[s + 3] >= 128) {
        dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = 255;
      } else {
        dst[d] = 0; dst[d + 1] = 0; dst[d + 2] = 0; dst[d + 3] = 0;
      }
    }
  }
}

/**
 * One-pixel dark rim. MM6's sprites were rendered against black and
 * palettised, which left a subtle dark fringe that separates them from the
 * background; recreating it deliberately is cheaper and cleaner than letting
 * the renderer's own antialiasing do it.
 */
function rimOutline(d, lay) {
  const { atlasW: w, atlasH: h, cellW, cellH } = lay;
  const alpha = new Uint8Array(w * h);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = d[p];
  for (let y = 0; y < h; y++) {
    const cy = (y / cellH) | 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i]) continue;
      const cx = (x / cellW) | 0;
      let nr = 0, ng = 0, nb = 0, n = 0;
      if (x > 0 && (((x - 1) / cellW) | 0) === cx && alpha[i - 1]) { const q = (i - 1) * 4; nr += d[q]; ng += d[q + 1]; nb += d[q + 2]; n++; }
      if (x < w - 1 && (((x + 1) / cellW) | 0) === cx && alpha[i + 1]) { const q = (i + 1) * 4; nr += d[q]; ng += d[q + 1]; nb += d[q + 2]; n++; }
      if (y > 0 && (((y - 1) / cellH) | 0) === cy && alpha[i - w]) { const q = (i - w) * 4; nr += d[q]; ng += d[q + 1]; nb += d[q + 2]; n++; }
      if (y < h - 1 && (((y + 1) / cellH) | 0) === cy && alpha[i + w]) { const q = (i + w) * 4; nr += d[q]; ng += d[q + 1]; nb += d[q + 2]; n++; }
      if (!n) continue;
      const p = i * 4;
      d[p] = (nr / n) * 0.30; d[p + 1] = (ng / n) * 0.30; d[p + 2] = (nb / n) * 0.32; d[p + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Category wrappers
// ---------------------------------------------------------------------------

const STATIC_ACTIONS = { stand: { frames: 1, loop: false, fps: 1 } };

/**
 * Cell budget scaled to the subject. A rat baked into a 96 px cell is 96 px of
 * fill rate and readback for a creature that is 24 px on screen; sizing the
 * cell to the model keeps the whole preload proportional to what is actually
 * visible.
 */
function cellBudget(height, lo, hi, k) {
  return Math.max(lo, Math.min(hi, Math.round(height * k / 4) * 4));
}

// Spec 15: an MM6 humanoid ships at roughly 80 x 128 source pixels and is
// magnified ~1.5x at melee range. `fitAtlas` will cut this down to whatever a
// 1024 atlas can actually hold for a 28-frame x 5-view sheet (~92 for a
// humanoid), but asking for the full figure is what makes it saturate instead
// of settling for half the resolution the atlas could carry.
const CREATURE_CELL_K = 0.66;

/** `kind` is a monster id ('GoblinB') or a bare family id ('Goblin'). */
export function bakeCreatureSheet(renderer, kind, seed = 1, opts = {}) {
  const def = CREATURE_DEFS[kind] || CREATURE_FAMILIES[kind];
  const h = def ? def.height : 192;
  return bakeSheet(renderer, (s) => buildCreature(kind, s), {
    kind, seed, actions: ACTIONS, maxCellH: cellBudget(h, 56, 128, CREATURE_CELL_K), maxAtlas: 1280,
    // Creatures are palettised without dither. A monster is a small, saturated,
    // curved mass: a Bayer pattern strong enough to smooth a sky gradient turns
    // a demon's chest into a visible red checkerboard, and MM6's own sprites
    // band rather than dither - spec 16 calls the banding part of the look.
    margin: 1.03, dither: 0, aspect: def ? def.aspect : 0, ...opts,
  });
}

export function bakeNPCSheet(renderer, archetype, seed = 1, opts = {}) {
  return bakeSheet(renderer, (s) => buildNPC(archetype, s), {
    kind: archetype, seed, actions: ACTIONS, maxCellH: 128, maxAtlas: 1024,
    margin: 1.03, dither: 0, aspect: 0.60, ...opts,
  });
}

export function bakeFloraSheet(renderer, kind, seed = 1, opts = {}) {
  const def = FLORA_DEFS[kind];
  return bakeSheet(renderer, (s) => buildFlora(kind, s), {
    kind, seed, actions: STATIC_ACTIONS,
    maxCellH: cellBudget(def ? def.h : 400, 48, 192, 0.20), maxAtlas: 1024, margin: 1.04, ...opts,
  });
}

export function bakePropSheet(renderer, kind, seed = 1, opts = {}) {
  const def = PROP_DEFS[kind];
  return bakeSheet(renderer, (s) => buildProp(kind, s), {
    kind, seed, actions: STATIC_ACTIONS,
    maxCellH: def && def.item ? 40 : cellBudget(def ? def.h : 100, 48, 112, 0.62),
    maxAtlas: 1024, margin: 1.06, ...opts,
  });
}

const BAKERS = {
  creature: bakeCreatureSheet,
  npc: bakeNPCSheet,
  flora: bakeFloraSheet,
  prop: bakePropSheet,
};

const SHEETS = new Map();

/** Cached sheet lookup. Category is one of creature | npc | flora | prop. */
export function getSheet(renderer, category, kind, seed = 1) {
  const key = `${category}:${kind}:${seed}`;
  let s = SHEETS.get(key);
  if (!s) {
    const fn = BAKERS[category];
    if (!fn) throw new Error('unknown sprite category: ' + category);
    s = fn(renderer, kind, seed);
    SHEETS.set(key, s);
  }
  return s;
}

export function hasSheet(category, kind, seed = 1) { return SHEETS.has(`${category}:${kind}:${seed}`); }

export function disposeSheets() {
  SHEETS.forEach((s) => s.dispose());
  SHEETS.clear();
  if (_rt) { _rt.dispose(); _rt = null; }
}

/**
 * Loading-screen driver. `list` is [{category, kind, seed}]; each `next()`
 * bakes exactly one sheet and yields progress so the bar can move.
 */
export function* bakeAllSheets(renderer, list) {
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const seed = it.seed === undefined ? 1 : it.seed;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const sheet = getSheet(renderer, it.category, it.kind, seed);
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    yield { i, total: list.length, category: it.category, kind: it.kind, seed, sheet, ms, t: (i + 1) / list.length };
  }
}

/**
 * A sensible default load list: one sheet per monster *family* rather than per
 * tier. Tiers only differ by palette, and 173 atlases would be several hundred
 * megabytes, so a region should bake only the tiers it actually spawns.
 */
export function defaultSheetList(seed = 1) {
  const out = [];
  for (const k of Object.keys(CREATURE_FAMILIES)) out.push({ category: 'creature', kind: k, seed });
  for (const k of Object.keys(FLORA_DEFS)) out.push({ category: 'flora', kind: k, seed });
  for (const k of Object.keys(PROP_DEFS)) out.push({ category: 'prop', kind: k, seed });
  return out;
}
