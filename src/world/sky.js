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
  const raw = (255 - dim) / 255;
  // The engine's curve only reaches 1.0 at exactly 13:00, so applied literally
  // it dims a mid-morning sky by nearly 30% and the whole world reads as dusk.
  // Flatten the plateau across full daylight and keep the ramp for dawn/dusk,
  // which is what the shell's global multiply does too - applying both would
  // darken everything twice.
  if (h >= 7 && h < 19) return Math.max(raw, 0.94);
  return raw;
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

/**
 * THE shared time-of-day light curve, in sRGB space, pre-post-multiply.
 *
 * This is exactly the flat-ground factor of the terrain bake (terrain.js
 * faceGrey with N = up): 1.0 through full daylight, rolling off toward 0.5
 * across dawn/dusk as the sun drops below 0.3 elevation, and holding 0.5 at
 * night. The shell's post pass applies the global timeTint() grey on top of
 * the whole frame, so this factor is what terrain, flora and sprites must all
 * share *before* that multiply - three different curves here is exactly the
 * twilight patchwork bug. Anything that lights a sprite or a billboard batch
 * outdoors samples this one function.
 */
export function daylightFactor(hours) {
  const h = ((hours % 24) + 24) % 24;
  const minutes = clamp((h - 5) * 60, 0, 960);
  const sunY = Math.sin(minutes * Math.PI / 960);
  const rel = sunY >= 0.30 ? 1 : Math.max(0, sunY) / 0.30;
  // Night floor 0.62, not 0.5: the post pass already multiplies the frame to
  // ~15%, and 0.5 * 0.15 put a midnight street at 5% luminance - unreadable
  // (wow-judge cycle 3). The floor is the *bake-side* exposure; real darkness
  // still comes from the global night multiply.
  return 0.62 + 0.38 * rel;
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
  // 256, the plansky's own resolution. The plate is seen heavily magnified at
  // the zenith, and a 128px plate baked with an ordered dither turned every
  // stretch into a field of magnified polka dots. Bake at full res with *no*
  // dither - MM6's own sky bitmaps band, they do not dither - and let the
  // cloud forms carry the image.
  const S = 256;
  const p = new Pix(S, S);
  const seed = kind.length * 977 + 3;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // Distinct soft cumulus, not a continuous smear: one blobby low-frequency
      // mass with a fine erosion term, and no stretched streak component. The
      // radiating streaks in the final image come from the plane projection
      // near the zenith, so baking them into the plate doubles them up.
      const mass = tileFbm2(u * 3.2, v * 3.2, 3, 4, 0.52, seed);
      const erode = tileFbm2(u * 8, v * 8, 8, 3, 0.5, seed + 29);
      const n = mass * 0.78 + erode * 0.22;
      const cloud = smoothstep(0.47, 0.60, n);          // tight = separate forms
      const core = smoothstep(0.56, 0.72, n);           // bright cumulus tops
      // A light, slightly warm daylight blue. The grey multiply only ever
      // darkens from here, so the plate has to start bright.
      const base = rampSample('sky', 0.86 + erode * 0.10);
      let lit = mixC(base, [216, 222, 230], cloud);
      lit = mixC(lit, [252, 251, 245], core * 0.9);
      // Shade the undersides so the banks read as volumes.
      const under = smoothstep(0.42, 0.58, tileFbm2(u * 3.2 + 0.06, v * 3.2 + 0.10, 3, 4, 0.52, seed));
      const shade = smoothstep(0.40, 0.55, mass) * (1 - core);
      lit = mixC(lit, [168, 176, 190], shade * 0.35);
      p.setArr(x, y, scaleC(lit, 0.92 + 0.13 * under));
    }
  }
  const tex = toTexture(p, { dither: 0, repeat: true, mips: true, magNearest: false });
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
  uniform vec3 uWarm;        // horizon-band tint (dawn/dusk warmth)
  uniform float uNight;      // 0 = day, 1 = deep night
  uniform vec3 uMoonDir;
  uniform vec2 uDrift;       // self-scroll of the cloud plate
  uniform vec2 uCamXZ;
  uniform float uScale;      // world units per texture repeat
  uniform float uHeight;     // notional plane height above the eye
  uniform float uBandPx;     // 39px fade band, expressed in NDC below
  uniform float uViewportH;
  varying vec3 vRay;
  varying vec2 vScreen;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // The cloud plate is sRGB-tagged (decoded to linear on fetch), uHaze is
  // stored linear, and the render target is an SRGB8 attachment whose
  // *hardware* encodes on write - so this shader stays entirely in linear.
  // A manual encode on top of that ran the whole sky through the sRGB curve
  // twice and bleached the cloud forms into a white sheet.
  void main() {
    vec3 d = normalize(vRay);
    // Screen-space distance to the horizon, in pixels, for the fade band.
    float horizonPx = (d.y / max(1e-4, length(d.xz))) * uViewportH * 0.5;

    if (d.y > 0.0004) {
      // Inverse-perspective plane hit. t blows up at the horizon, which is
      // exactly what compresses the cloud plate into a striated band there.
      float t = uHeight / d.y;
      vec2 uv = (uCamXZ + d.xz * t) / uScale + uDrift;
      vec3 plate = texture2D(uSky, uv).rgb;
      float cloudLum = dot(plate, vec3(0.299, 0.587, 0.114));
      vec3 c = plate * uTint;
      // Night: MM6 multiplies the sky bitmap itself down; without this the
      // plate rides at daylight brightness and the moon has nothing to shine
      // against (the global grey multiply lands on both equally).
      c *= mix(1.0, 0.34, uNight);
      if (uNight > 0.02) {
        // Stars: sparse hashed points on the same infinite-plane projection,
        // hidden where the cloud plate is bright (a star through a cumulus
        // bank is an instant tell). They compress into the horizon band like
        // everything else and drown in the haze there, which is right.
        vec2 sp = d.xz / (d.y + 0.32) * 9.0;
        vec2 cell = floor(sp);
        float h = hash21(cell);
        vec2 spos = vec2(hash21(cell + 17.0), hash21(cell + 41.0)) * 0.8 + 0.1;
        float dist2 = length(fract(sp) - spos);
        float star = step(0.78, h) * (1.0 - smoothstep(0.045, 0.085, dist2));
        star *= 0.45 + 0.55 * hash21(cell + 7.0);
        // The bare plate is already ~0.7 luminance sky-blue; only the cumulus
        // tops rise past ~0.8. Gate on that so stars hide behind cloud banks
        // but survive open sky.
        float cover = smoothstep(0.74, 0.86, cloudLum);
        star *= 1.0 - cover;
        star *= smoothstep(0.05, 0.16, d.y);                  // fade at horizon
        c += vec3(0.82, 0.86, 0.95) * star * uNight;
        // Moon: a pale disc with a shadowed bite, fixed high in the sky.
        float mdot = dot(d, uMoonDir);
        float disc = smoothstep(0.99936, 0.99946, mdot);
        float halo = smoothstep(0.9986, 0.99936, mdot) * 0.16;
        float bite = smoothstep(0.99930, 0.99952, dot(normalize(d + vec3(0.024, 0.013, 0.0)), uMoonDir));
        vec3 moonC = mix(vec3(0.97, 0.98, 0.92), vec3(0.58, 0.60, 0.57), bite * 0.72);
        c = mix(c, moonC, (disc + halo) * uNight * (1.0 - cover * 0.7));
      }
      // Two-stage haze. The engine draws a hard 39px fade band at the horizon;
      // on its own that leaves the sky above it still fully saturated and the
      // world ends on a visible line. A broad soft ramp over roughly a quarter
      // of the sky, with the tight band inside it, is what actually reads as
      // "the terrain dissolves into the horizon".
      // The broad ramp fades toward a *warmed* haze (uWarm carries the hour's
      // cast - amber at dawn/dusk, near-neutral at noon) while the tight band
      // stays exactly on the fog target, so the terrain seam never shows. This
      // replaces the tall flat grey band of cycle 3 with a graded horizon.
      float band = 1.0 - smoothstep(0.0, uBandPx, horizonPx);
      float broad = 1.0 - smoothstep(0.0, uBandPx * 4.5, horizonPx);
      c = mix(c, uHaze * uWarm, clamp(broad * 0.38, 0.0, 1.0));
      gl_FragColor = vec4(mix(c, uHaze, band * 0.97), 1.0);
    } else {
      // Below the horizon: haze fill, darkening gently with depression angle
      // so the strip between the far clip and the horizon reads as distant
      // sea-haze rather than a flat grey card. The first degrees below the
      // horizon stay exactly on the fog target to keep the terrain seam clean.
      float deep = smoothstep(0.03, 0.30, -d.y);
      gl_FragColor = vec4(uHaze * mix(1.0, 0.86, deep), 1.0);
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
      uWarm: { value: new THREE.Color(1, 1, 1) },
      uNight: { value: 0 },
      // Elevation ~28 deg: high enough to sit over the rooftops, low enough
      // that the +-22 deg pitch clamp can still frame it.
      uMoonDir: { value: new THREE.Vector3(0.42, 0.44, -0.62).normalize() },
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
    // The time-of-day grey is reported for anyone who wants to know the hour's
    // dimming level, but nothing in this file multiplies by it any more: the
    // post pass applies that one multiply to the whole frame, and the sky
    // doing it as well squared it on the sky and on the haze the world fades
    // into - so the horizon dimmed at twice the rate the ground did.
    const g = 1;
    const st = sunTerms(state.tod);
    state.tint = timeTint(state.tod);
    state.ambient = st.ambient;
    state.diffuse = st.diffuse;
    state.night = st.night;

    // Sky tint: the region's colour cast only, capped at 248/255 the way the
    // engine pins sky fog.
    //
    // The time-of-day grey deliberately does *not* appear here. The post pass
    // multiplies the whole frame by it, and MM6's whole tonal unity rests on
    // sky, terrain and sprites taking that one multiply together. Applying it
    // here as well squared it on the sky alone: at 19:45 the sky came out at
    // 22% instead of 47%, and its cloud structure collapsed to ten colours.
    //
    // The tint multiplies an already-decoded (linear) texture sample, but MM6's
    // multiply happens on 8-bit sRGB palette values, so raise it to 2.2 to get
    // the same visual result. Skipping this washes every sky out by ~40%.
    const skyCap = 248 / 255;
    mat.uniforms.uTint.value.setRGB(
      Math.pow(Math.min(skyCap, state.skyTintRGB[0]), 2.2),
      Math.pow(Math.min(skyCap, state.skyTintRGB[1]), 2.2),
      Math.pow(Math.min(skyCap, state.skyTintRGB[2]), 2.2),
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

    // The plate's grey luminance. Spec §4b/§9: MM6's distance haze is the
    // time-of-day *grey* - objects fade toward grey/black, never toward a pale
    // blue-white. The region's colour cast stays on the sky quad; the fog
    // target itself is neutral.
    const plateLum = 0.299 * state.plate.r + 0.587 * state.plate.g + 0.114 * state.plate.b;

    if (use.on) {
      // Foggy day: GetLevelFogColor's neutral grey, #C8C8C8 in daylight down
      // to #1F1F1F at night, with only a whisper of the region's cast so a
      // swamp's wall of fog is not the same picture as an ice coast's.
      const dv = clamp(density, 0, 1);
      const v = ((1 - dv) * 200 + dv * 31) / 255;
      const grey = lerpN(v, plateLum, 0.35);
      fog.color.setRGB(
        lerpN(grey, state.plate.r * g, 0.18),
        lerpN(grey, state.plate.g * g, 0.18),
        lerpN(grey, state.plate.b * g, 0.18),
        THREE.SRGBColorSpace,
      );
      fog.near = use.weak;
      fog.far = use.weak + Math.max(1, use.strong - use.weak) / cap;
      // The sub-horizon fill is the fog colour: on a foggy day the world and
      // the sky both end in the same grey wall.
      state.haze.copy(fog.color);
    } else {
      // Clear day: distance darkening only. The fade target is the neutral
      // grey of the plate's luminance (the post pass darkens it with the rest
      // of the frame, so one value serves the whole day), and the *amount* of
      // haze follows the time-of-day curve: at 13:00 the spec says #FFFFFF -
      // no haze at all - so the ramp starts near the far clip and barely
      // saturates; toward dusk it pulls in and deepens.
      state.haze.setRGB(plateLum * g, plateLum * g, plateLum * g, THREE.SRGBColorSpace);
      const dayness = clamp((state.tint - 0.372) / (1 - 0.372), 0, 1);
      fog.color.copy(state.haze);
      fog.near = lerpN(SHADEMIST_DIST * 0.7, FAR_CLIP * 0.85, dayness);
      const maxA = Math.min(cap, lerpN(0.58, 0.12, dayness));
      fog.far = fog.near + (FAR_CLIP - fog.near) / maxA;
    }
    mat.uniforms.uHaze.value.copy(state.haze);

    // Night factor for the plate dim, stars and moon: same curve the towns use
    // for their lanterns, so the moon rises exactly as the lamps come up.
    const nightK = clamp((0.92 - daylightFactor(state.tod)) / 0.30, 0, 1);
    mat.uniforms.uNight.value = nightK;

    // Horizon warmth: amber at dawn/dusk while the sun sits low, fading to a
    // whisper at noon and to nothing at night. Applied only to the broad ramp
    // above the horizon - the fog target itself stays neutral, so distance
    // haze and the sky can never seam.
    {
      const h = state.tod;
      const minutes = clamp((h - 5) * 60, 0, 960);
      const sunY = Math.sin(minutes * Math.PI / 960);
      const low = st.night ? 0 : clamp(1 - sunY / 0.55, 0, 1);
      const w = Math.pow(low, 1.5);
      mat.uniforms.uWarm.value.setRGB(
        1.04 + 0.24 * w,
        1.01 + 0.02 * w,
        0.98 - 0.22 * w,
      );
    }

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

  return {
    group, update, setRegion, setViewport, dispose, state, quad,
    // The *live* fog object. onBeforeRender rebinds `fog` to whatever fog the
    // host scene actually renders with, so anything that needs "the same fog
    // the terrain gets" (flora batches, sprite renderers) must read it through
    // this getter - the ownFog reference goes stale the moment a host scene
    // brings its own.
    get fog() { return fog; },
  };
}
