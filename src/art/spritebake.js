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
// MM6 sprite stays lit from the left no matter where the sun is. The fill is
// only strong enough to keep the shadow side from going flat black; there is
// deliberately no rim, no outline and no cel banding, because the 256-colour
// palettisation is what does the banding.
const LIGHT_D = {
  keyDir: [-0.46, 0.62, 0.64],
  fillDir: [0.58, -0.30, 0.30],
  fillCol: [0.30, 0.38, 0.58],
  ambient: 0.28,
  key: 0.92,
  fill: 0.16,
  bands: 0,
};

const VERT = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uColor;
uniform float uEmissive;
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform float uAmbient;
uniform float uKey;
uniform float uFill;
uniform float uBands;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN);
  float nd = dot(N, uKeyDir);
  // half-lambert wrap keeps the dark side coloured instead of black, the way
  // hand-painted sprite art shades a form.
  float k = max(nd, 0.0) * 0.78 + (nd * 0.5 + 0.5) * 0.22;
  float f = max(dot(N, uFillDir), 0.0);
  float s = uAmbient + uKey * k;
  // uBands > 0 forces discrete shading; MM6 did not do this, the palette did,
  // so the default is 0 and the gradient stays smooth until it is palettised.
  if (uBands > 0.5) s = floor(s * uBands + 0.5) / uBands;
  vec3 c = uColor * s + uFillCol * (f * uFill) * (0.35 + uColor);
  c = mix(c, uColor * (1.0 + 0.25 * s), uEmissive);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const CEL_CACHE = new Map();
let _lightSig = '';

function celMaterial(hex, emissive, L) {
  const sig = L.keyDir.join() + L.ambient + L.key + L.fill + L.bands + L.fillCol.join();
  if (sig !== _lightSig) { CEL_CACHE.forEach((m) => m.dispose()); CEL_CACHE.clear(); _lightSig = sig; }
  const key = `${hex}|${emissive}`;
  let m = CEL_CACHE.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      // raw sRGB values - the shader writes the final byte, no colour
      // management, no tone mapping, so what we read back is what we drew.
      uColor: { value: new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255) },
      uEmissive: { value: emissive },
      uKeyDir: { value: new THREE.Vector3().fromArray(L.keyDir).normalize() },
      uFillDir: { value: new THREE.Vector3().fromArray(L.fillDir).normalize() },
      uFillCol: { value: new THREE.Vector3().fromArray(L.fillCol) },
      uAmbient: { value: L.ambient },
      uKey: { value: L.key },
      uFill: { value: L.fill },
      uBands: { value: L.bands },
    },
    side: THREE.DoubleSide,   // wings, leaves and banners are single quads
    toneMapped: false,
    fog: false,
  });
  CEL_CACHE.set(key, m);
  return m;
}

/** Swap every mesh onto a cel material, remembering what was there. */
function applyCel(root, L) {
  const saved = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    const hex = src.color ? src.color.getHex(THREE.SRGBColorSpace) : 0xffffff;
    const em = (src.userData && src.userData.emissive) || 0;
    saved.push([o, src]);
    o.material = celMaterial(hex, em, L);
  });
  return saved;
}

function restoreMaterials(saved) { for (const [o, m] of saved) o.material = m; }

// --- atlas layout ----------------------------------------------------------

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

// How much of each pose's extra reach the frame has to accommodate. MM6 crops
// every frame to its own bounding box; we are stuck with one cell for the whole
// sheet, so the idle and walk poses get the frame to themselves and the extreme
// poses (a raised staff, a corpse lying full-length) are allowed to run over the
// edge a little rather than shrinking the sprite you look at 95% of the time.
const POSE_WEIGHT = [
  ['stand', 0, 1], ['walk', 0.25, 1], ['bored', 0.25, 1],
  ['attack_melee', 0.55, 0.60], ['attack_ranged', 0.5, 0.55], ['dying', 1, 0.35],
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
  for (const [action, t, w] of POSE_WEIGHT) {
    if (!actionList.includes(action)) continue;
    const s = grab(action, t);
    if (!s) continue;
    minY = Math.min(minY, base.minY + (s.minY - base.minY) * w);
    maxY = Math.max(maxY, base.maxY + (s.maxY - base.maxY) * w);
    R = Math.max(R, base.R + (s.R - base.R) * w);
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
    elevation = 0.17,
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
  let halfH = ((m.maxY - m.minY) / 2) * ce + m.R * se;
  let halfW = m.R;
  halfH *= margin; halfW *= margin;
  const measured = halfW / Math.max(1e-4, halfH);
  const aspect = Math.min(2.8, Math.max(0.35, aspectHint || measured));

  const lay = fitAtlas(total, views, aspect, maxAtlas, maxCellH);
  // Re-fit the camera box to the cell's exact aspect so nothing is squashed.
  const cellAspect = lay.cellW / lay.cellH;
  if (halfW / halfH > cellAspect) halfH = halfW / cellAspect; else halfW = halfH * cellAspect;

  const dist = Math.max(halfH, halfW) * 8 + 100;
  _cam.left = -halfW; _cam.right = halfW; _cam.top = halfH; _cam.bottom = -halfH;
  _cam.near = 1; _cam.far = dist * 3;
  _cam.position.set(0, cy + dist * se, dist * ce);
  _cam.lookAt(0, cy, 0);
  _cam.updateProjectionMatrix();
  _cam.updateMatrixWorld(true);

  // --- render -------------------------------------------------------------
  const saved = applyCel(model.root, L);
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
        renderer.setViewport(gx, gy, lay.cellW, lay.cellH);
        renderer.setScissor(gx, gy, lay.cellW, lay.cellH);
        renderer.clear(true, true, false);
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
  restoreMaterials(saved);
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

  const worldH = halfH * 2, worldW = halfW * 2;
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
    groundOffset: (0 - cy) * ce - (-halfH),
    footOffset: (m.minY - cy) * ce,

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

/** `kind` is a monster id ('GoblinB') or a bare family id ('Goblin'). */
export function bakeCreatureSheet(renderer, kind, seed = 1, opts = {}) {
  const def = CREATURE_DEFS[kind] || CREATURE_FAMILIES[kind];
  return bakeSheet(renderer, (s) => buildCreature(kind, s), {
    kind, seed, actions: ACTIONS, maxCellH: 96, maxAtlas: 1024,
    aspect: def ? def.aspect : 0, ...opts,
  });
}

export function bakeNPCSheet(renderer, archetype, seed = 1, opts = {}) {
  return bakeSheet(renderer, (s) => buildNPC(archetype, s), {
    kind: archetype, seed, actions: ACTIONS, maxCellH: 96, maxAtlas: 1024,
    aspect: 0.66, ...opts,
  });
}

export function bakeFloraSheet(renderer, kind, seed = 1, opts = {}) {
  const def = FLORA_DEFS[kind];
  return bakeSheet(renderer, (s) => buildFlora(kind, s), {
    kind, seed, actions: STATIC_ACTIONS, maxCellH: 224, maxAtlas: 1024, margin: 1.04, ...opts,
  });
}

export function bakePropSheet(renderer, kind, seed = 1, opts = {}) {
  const def = PROP_DEFS[kind];
  return bakeSheet(renderer, (s) => buildProp(kind, s), {
    kind, seed, actions: STATIC_ACTIONS,
    maxCellH: def && def.item ? 48 : 96, maxAtlas: 1024, margin: 1.06, ...opts,
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
