import * as THREE from 'three';
import { Pix, toTexture, rampSample, mixC, scaleC } from '../art/texcanvas.js';
import { Rand, clamp, smoothstep, tileFbm2, tileNoise2, valueNoise2, lerpN } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Sky.
//
// MM6 does NOT draw a skybox or a dome. `OpenGLRenderer::DrawOutdoorSky` emits a
// single screen-space quad running from the top of the viewport down to the
// projected horizon line, and textures it through an inverse-perspective
// "infinite ceiling plane" mapping. That mapping is the whole look: clouds
// compress into a fine striated band at the horizon and stretch into streaks
// radiating from the zenith. A dome gets neither of those and reads instantly
// as not-MM6.
//
// Below the horizon the engine paints a 39px fade band into the haze colour
// and then a solid haze fill, which is what the world's far edge dissolves
// into. We keep that colour identical to the scene fog target, because the
// seam between them is the most visible tell there is.
//
// There is no sun disc, no moon, no stars and no gradient. Night is the same
// cloud texture multiplied down to #272727.
// ---------------------------------------------------------------------------

export const FOG_HORIZON_PX = 39;
export const FAR_CLIP = 8192;
export const NEAR_CLIP = 32;
export const SHADE_DIST = 2048;      // shading_dist_shade
export const SHADEMIST_DIST = 4096;  // shading_dist_shademist

/** Per-map fog classes (Outdoor.cpp fog_probability_table / SetFog). */
export const FOG_CLASSES = {
  none: { weak: 0, strong: 0, on: false },
  light: { weak: 4096, strong: 8192, on: true },
  medium: { weak: 0, strong: 4096, on: true },
  dense: { weak: 0, strong: 2048, on: true },
  underwater: { weak: 50, strong: 2000, on: true, color: 0x218e5a },
};

/**
 * MM6's time-of-day grey. `minutes` counted from 05:00; 0 at dawn, 960 at 21:00.
 * Returns a 0..1 multiplier: 1.0 at 13:00, 0.372 at dawn/dusk, 0.153 at night.
 */
export function timeTint(hours) {
  const h = ((hours % 24) + 24) % 24;
  const night = h < 5 || h >= 21;
  if (night) return 0x27 / 255;
  const minutes = (h - 5) * 60;
  const v = minutes >= 480 ? 960 - minutes : minutes;
  const level = 20 - (v / 480) * 20;
  const dim = Math.min(216, 8 * level);
  return (255 - dim) / 255;
}

/** Ambient / diffuse curve (OpenGLRenderer.cpp:1204). */
export function sunTerms(hours) {
  const h = ((hours % 24) + 24) % 24;
  const t = h * 60;
  const ambient = 0.15 + (Math.sin((t - 360) * Math.PI * 2 / 1440) + 1) * 0.27;
  const night = h < 5 || h >= 21;
  return { ambient, diffuse: night ? 0 : ambient + 0.3, night };
}

/**
 * Sun direction. MM6's sun rides the E-W great circle only - it never has a
 * north/south component, which is why outdoor shading in MM6 is always an
 * east/west split and never a north-face-is-dark landscape.
 * Returned in our Y-up convention: +X east, +Y up.
 */
export function sunDirection(hours) {
  const h = ((hours % 24) + 24) % 24;
  const minutes = clamp((h - 5) * 60, 0, 960);
  const a = minutes * Math.PI / 960;
  return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
}

/** Quantise a 0..1 shade to MM6's 32 grey levels: 8*(31-dim) / 255. */
export function quantiseShade(v) {
  const dim = clamp(Math.round(31 - clamp(v, 0, 1) * 255 / 8), 0, 31);
  return (8 * (31 - dim)) / 255;
}

// --- cloud plate -----------------------------------------------------------

const _skyTexCache = new Map();
/**
 * A `plansky`-style 256x256 tiling cloud plate: low contrast, high frequency,
 * no hero feature. Everything colourful about the sky comes from this texture
 * and the grey tint applied over it, exactly as in the original.
 */
export function skyTexture(kind = 'plansky3') {
  const hit = _skyTexCache.get(kind);
  if (hit) return hit;
  // 128 rather than 256: the plate is only ever seen heavily magnified or
  // heavily tiled, and palettising 64k pixels costs a second of load time.
  const S = 128;
  const p = new Pix(S, S);
  const seed = kind.length * 977 + 3;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // Two cloud scales plus a stretched streak term - clouds in the MM6
      // plate are drawn as long soft banks, not fluffy puffs.
      const big = tileFbm2(u * 3, v * 3, 3, 4, 0.55, seed);
      const streak = tileFbm2(u * 2.2, v * 7.0, 7, 4, 0.5, seed + 11);
      const fine = tileFbm2(u * 9, v * 9, 9, 3, 0.5, seed + 29);
      let n = big * 0.52 + streak * 0.30 + fine * 0.18;
      const cloud = smoothstep(0.42, 0.74, n);
      // Base sky is a pale hazy blue - MM6's plate is much lighter than memory
      // suggests, because the grey multiply only ever darkens it from here.
      const base = rampSample('sky', 0.70 + fine * 0.12);
      const lit = mixC(base, [240, 240, 236], cloud);
      // Underside shading of each bank.
      const under = smoothstep(0.40, 0.62, tileFbm2(u * 3 + 0.05, v * 3 + 0.09, 3, 4, 0.55, seed));
      p.setArr(x, y, scaleC(lit, 0.90 + 0.14 * under));
    }
  }
  const tex = toTexture(p, { dither: 12, repeat: true, mips: true, magNearest: false });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _skyTexCache.set(kind, tex);
  return tex;
}

/** Mean colour of the cloud plate, used for the sub-horizon haze fill. */
function plateMean() {
  return new THREE.Color(0.62, 0.67, 0.73);
}

// --- snow ------------------------------------------------------------------
//
// MM6's snow is not a particle sprite system: it is 1000 solid white
// axis-aligned rectangles drawn in 2D inside the 3D viewport, in three size
// classes, and the whole field scrolls horizontally with camera yaw so it feels
// world-locked when you turn. Reproduced literally.

const SNOW_N = 1000;

function buildSnow() {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0.5, -0.5, 0);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.instanceCount = SNOW_N;

  const px = new Float32Array(SNOW_N * 2);
  const sz = new Float32Array(SNOW_N);
  const rnd = new Rand(20241);
  for (let i = 0; i < SNOW_N; i++) {
    px[i * 2] = rnd.float(0, 1);
    px[i * 2 + 1] = rnd.float(0, 1);
    sz[i] = i < 700 ? 1 : i < 950 ? 2 : 4;
  }
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(px, 2));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(sz, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uViewport: { value: new THREE.Vector2(461, 345) } },
    vertexShader: /* glsl */`
      attribute vec2 iPos;
      attribute float iSize;
      uniform vec2 uViewport;
      void main() {
        // iPos is normalised viewport space; snap to whole pixels so the flakes
        // stay crisp axis-aligned rectangles like the original blitter.
        vec2 p = floor(iPos * uViewport) + position.xy * iSize;
        vec2 ndc = (p / uViewport) * 2.0 - 1.0;
        gl_Position = vec4(ndc.x, -ndc.y, -0.999, 1.0);
      }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); }',
    depthTest: false, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5000;
  mesh.visible = false;
  return { mesh, px, sz, rnd, mat };
}

// --- sky quad --------------------------------------------------------------

const SKY_VERT = /* glsl */`
  uniform mat4 uInvProj;
  uniform mat3 uCamRot;
  varying vec3 vRay;
  varying vec2 vScreen;
  void main() {
    vScreen = position.xy;
    vec4 p = uInvProj * vec4(position.xy, 1.0, 1.0);
    vRay = uCamRot * (p.xyz / p.w);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSky;
  uniform vec3 uTint;        // time-of-day grey multiply
  uniform vec3 uHaze;        // sub-horizon fill / fog target
  uniform vec2 uDrift;       // self-scroll of the cloud plate
  uniform vec2 uCamXZ;
  uniform float uScale;      // world units per texture repeat
  uniform float uHeight;     // notional plane height above the eye
  uniform float uBandPx;     // 39px fade band, expressed in NDC below
  uniform float uViewportH;
  varying vec3 vRay;
  varying vec2 vScreen;

  void main() {
    vec3 d = normalize(vRay);
    // Screen-space distance to the horizon, in pixels, for the fade band.
    float horizonPx = (d.y / max(1e-4, length(d.xz))) * uViewportH * 0.5;

    if (d.y > 0.0004) {
      // Inverse-perspective plane hit. t blows up at the horizon, which is
      // exactly what compresses the cloud plate into a striated band there.
      float t = uHeight / d.y;
      vec2 uv = (uCamXZ + d.xz * t) / uScale + uDrift;
      vec3 c = texture2D(uSky, uv).rgb * uTint;
      // Blend into the haze across the last few pixels so the horizon line is
      // hard but not aliased, matching the engine's fade band.
      float f = 1.0 - smoothstep(0.0, uBandPx, horizonPx);
      gl_FragColor = vec4(mix(c, uHaze, f * 0.97), 1.0);
    } else {
      // Below the horizon: solid haze fill. Terrain covers most of it; what is
      // left is the colour the world dissolves into.
      gl_FragColor = vec4(uHaze, 1.0);
    }
  }`;

/**
 * @param {THREE.Scene} scene
 * @param {object} opts { camera, region, sky:'plansky3', fogClass, timeOfDay }
 */
export function buildSky(scene, opts = {}) {
  const camera = opts.camera || null;
  const group = new THREE.Group();
  group.name = 'sky';
  // The sky must survive a host that never calls update(): everything it needs
  // is pulled off the camera and scene in onBeforeRender instead.
  group.matrixAutoUpdate = true;

  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: skyTexture(opts.sky || 'plansky3') },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uHaze: { value: new THREE.Color(0.62, 0.67, 0.73) },
      uDrift: { value: new THREE.Vector2() },
      uCamXZ: { value: new THREE.Vector2() },
      uScale: { value: 3400 },
      uHeight: { value: 900 },
      uBandPx: { value: FOG_HORIZON_PX },
      uViewportH: { value: 345 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamRot: { value: new THREE.Matrix3() },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  quad.renderOrder = -10000;
  group.add(quad);

  const snow = buildSnow();
  group.add(snow.mesh);

  if (scene) scene.add(group);

  const state = {
    tod: 10,
    weather: opts.weather || 'clear',
    fogClass: opts.fogClass || 'none',
    haze: new THREE.Color(),
    tint: 1,
    ambient: 0.5,
    diffuse: 0.8,
    night: false,
    plate: plateMean(),
    skyTintRGB: [1, 1, 1],
    drift: opts.drift === undefined ? 0.016 : opts.drift,
  };

  // Our own fog object. If the host scene has none we install this one; if it
  // has its own we write our numbers into *theirs*, because the fog target and
  // the sub-horizon fill colour must be the same value or the horizon seams.
  const ownFog = new THREE.Fog(0x9aa4ac, SHADE_DIST, FAR_CLIP);
  if (scene && !scene.fog) scene.fog = ownFog;
  let fog = (scene && scene.fog) || ownFog;

  function setRegion(def) {
    if (!def) return;
    state.skyTintRGB = def.skyTint || [1, 1, 1];
    state.plate = def.hazeTint
      ? new THREE.Color(def.hazeTint[0], def.hazeTint[1], def.hazeTint[2])
      : plateMean();
    if (def.sky) mat.uniforms.uSky.value = skyTexture(def.sky);
    if (def.fogClass) state.fogClass = def.fogClass;
    if (def.weather) state.weather = def.weather;
  }
  setRegion(opts.region);

  let elapsed = 0;
  let lastYaw = 0;
  const _m3 = new THREE.Matrix3();
  const _v2 = new THREE.Vector2();

  function update(dt, timeOfDay, weather, cam) {
    const c = cam || camera;
    elapsed += dt;
    if (timeOfDay !== undefined) state.tod = timeOfDay <= 1 ? timeOfDay * 24 : timeOfDay;
    if (weather) state.weather = weather === 'rain' ? 'fog' : weather;   // MM6 has no rain
    refresh();
    if (c) aimAt(c);
    stepSnow(dt, c);
  }

  /** Recompute tint, haze and fog. Cheap enough to run every frame. */
  function refresh() {
    const g = timeTint(state.tod);
    const st = sunTerms(state.tod);
    state.tint = g;
    state.ambient = st.ambient;
    state.diffuse = st.diffuse;
    state.night = st.night;

    // Sky tint: the region's colour cast times the time-of-day grey, capped at
    // 248/255 the way the engine pins sky fog.
    const skyCap = 248 / 255;
    mat.uniforms.uTint.value.setRGB(
      Math.min(skyCap, g * state.skyTintRGB[0]),
      Math.min(skyCap, g * state.skyTintRGB[1]),
      Math.min(skyCap, g * state.skyTintRGB[2]),
    );

    // Two separate systems, exactly as the engine has them.
    //
    // (a) Always on: distance darkening. Geometry is multiplied by the
    //     time-of-day grey `g`, ramping in with distance. Blending toward
    //     black by (1-g) is the same operation and is what THREE.Fog can do,
    //     so on a clear day at noon there is no haze at all - correct.
    // (b) Foggy days only: a real neutral-grey fog, #C8C8C8 in daylight down
    //     to #1F1F1F at night, saturating at fogStrongDistance.
    const cls = FOG_CLASSES[state.fogClass] || FOG_CLASSES.none;
    const forced = state.weather === 'fog' ? FOG_CLASSES.dense
      : state.weather === 'cloudy' ? FOG_CLASSES.light : null;
    const use = forced || cls;
    const density = state.night ? 1
      : (state.tod < 6 ? 6 - state.tod : state.tod >= 20 ? state.tod - 20 : 0);
    const cap = 216 / 255;

    if (use.on) {
      // GetLevelFogColor is a pure neutral grey, but applying it raw turns a
      // black swamp into a snowfield because the sky above it still carries the
      // region's colour cast. Pull it most of the way toward the region haze so
      // fog and sky agree and each map keeps its character.
      const dv = clamp(density, 0, 1);
      const v = ((1 - dv) * 200 + dv * 31) / 255;
      const k = 0.62;
      fog.color.setRGB(
        lerpN(v, state.plate.r * g, k),
        lerpN(v, state.plate.g * g, k),
        lerpN(v * 1.01, state.plate.b * g, k),
      );
      fog.near = use.weak;
      fog.far = use.weak + Math.max(1, use.strong - use.weak) / cap;
      // The sub-horizon fill is the fog colour: on a foggy day the world and
      // the sky both end in the same grey wall.
      state.haze.copy(fog.color);
    } else {
      // Clear day: the world fades toward the horizon haze, which is the cloud
      // plate's own mean tinted exactly like the sky quad above it. Using the
      // identical colour for fog target and sub-horizon fill is what makes the
      // seam disappear; fading toward black instead leaves a dark rim.
      state.haze.setRGB(state.plate.r * g, state.plate.g * g, state.plate.b * g);
      const maxA = Math.min(cap, 0.58);
      fog.color.copy(state.haze);
      fog.near = SHADEMIST_DIST * 0.75;
      fog.far = fog.near + (FAR_CLIP - fog.near) / maxA;
    }
    mat.uniforms.uHaze.value.copy(state.haze);

    // Cloud plate self-drift; MM6's sky moves even when you stand still.
    const t = performance.now() / 1000;
    mat.uniforms.uDrift.value.set(t * state.drift, t * state.drift * 0.42);
  }

  function aimAt(c) {
    mat.uniforms.uCamXZ.value.set(c.position.x, c.position.z);
    mat.uniforms.uInvProj.value.copy(c.projectionMatrixInverse);
    _m3.setFromMatrix4(c.matrixWorld);
    mat.uniforms.uCamRot.value.copy(_m3);
    group.position.copy(c.position);
  }

  function stepSnow(dt, c) {
    const snowing = state.weather === 'snow';
    snow.mesh.visible = snowing;
    if (snowing && c) {
      // Yaw delta scrolls the whole field, so it reads as world-locked.
      const yaw = Math.atan2(-c.matrixWorld.elements[8], -c.matrixWorld.elements[10]);
      let dyaw = yaw - lastYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      lastYaw = yaw;
      const vw = snow.mat.uniforms.uViewport.value;
      const shift = (dyaw / (Math.PI * 2)) * vw.x * 3.2 / vw.x;
      const p = snow.px, sz = snow.sz, rnd = snow.rnd;
      const frames = clamp(dt * 60, 0.2, 3);
      for (let i = 0; i < SNOW_N; i++) {
        const s = sz[i];
        p[i * 2] += (rnd.float(-1, 1) * s) / vw.x * frames - shift;
        p[i * 2 + 1] += ((rnd.float(0, s) + s) / vw.y) * frames;
        if (p[i * 2 + 1] > 1) { p[i * 2 + 1] = 0; p[i * 2] = rnd.float(0, 1); }
        if (p[i * 2] < 0) p[i * 2] += 1;
        else if (p[i * 2] > 1) p[i * 2] -= 1;
      }
      snow.mesh.geometry.attributes.iPos.needsUpdate = true;
    }
  }

  function setViewport(w, h) {
    mat.uniforms.uViewportH.value = h;
    // The 39px band is measured against MM6's 345px viewport, so scale it.
    mat.uniforms.uBandPx.value = FOG_HORIZON_PX * (h / 345);
    snow.mat.uniforms.uViewport.value.set(w, h);
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geo.dispose(); mat.dispose();
    snow.mesh.geometry.dispose(); snow.mat.dispose();
  }

  // Self-drive. A host that forgets to call update() still gets a correct sky,
  // and a host with its own fog object still gets our numbers written into it.
  quad.onBeforeRender = (renderer, hostScene, cam) => {
    if (hostScene) {
      if (!hostScene.fog) hostScene.fog = ownFog;
      fog = hostScene.fog;
    }
    refresh();
    if (cam) aimAt(cam);
    const t = renderer.getSize(_v2);
    if (t.y > 0 && t.y !== mat.uniforms.uViewportH.value) setViewport(t.x, t.y);
  };

  return { group, update, setRegion, setViewport, dispose, state, quad, fog: ownFog };
}
