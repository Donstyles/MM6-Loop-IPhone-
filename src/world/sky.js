import * as THREE from 'three';
import { Pix, toTexture, rampSample, mixC, scaleC } from '../art/texcanvas.js';
import { Rand, clamp, smoothstep, tileFbm2, valueNoise2, lerpN } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Sky.
//
// MM6's sky is a big textured dome with one scrolling cloud layer and a strong
// horizon band, and the single most important property is that the band matches
// the fog colour *exactly*. The terrain fades into fog at ~6000 units and if the
// two colours disagree you get a visible ring at the world's edge, which is the
// most obvious "not MM6" tell there is. Everything here exists to keep those in
// lockstep.
// ---------------------------------------------------------------------------

// Zenith / mid / horizon colours through the day. sRGB, palette-snapped later.
const DAY_KEYS = [
  { t: 0.00, zen: [0x0a, 0x0e, 0x22], mid: [0x0d, 0x14, 0x2c], hor: [0x16, 0x1e, 0x38], sun: 0.0 },
  { t: 0.19, zen: [0x1c, 0x24, 0x46], mid: [0x4a, 0x3c, 0x54], hor: [0x8a, 0x54, 0x48], sun: 0.15 },
  { t: 0.26, zen: [0x37, 0x55, 0x87], mid: [0x86, 0x7e, 0x8e], hor: [0xd8, 0x94, 0x58], sun: 0.55 },
  { t: 0.34, zen: [0x40, 0x70, 0xa8], mid: [0x86, 0xa8, 0xc6], hor: [0xbe, 0xd2, 0xdf], sun: 0.9 },
  { t: 0.50, zen: [0x3a, 0x6c, 0xa8], mid: [0x82, 0xa6, 0xc8], hor: [0xb8, 0xcd, 0xdf], sun: 1.0 },
  { t: 0.66, zen: [0x40, 0x6e, 0xa4], mid: [0x8e, 0xa8, 0xc0], hor: [0xc6, 0xcc, 0xcc], sun: 0.9 },
  { t: 0.76, zen: [0x3a, 0x44, 0x74], mid: [0x8e, 0x6a, 0x6c], hor: [0xd4, 0x74, 0x40], sun: 0.45 },
  { t: 0.84, zen: [0x18, 0x1e, 0x3e], mid: [0x2c, 0x2a, 0x44], hor: [0x54, 0x36, 0x3c], sun: 0.1 },
  { t: 1.00, zen: [0x0a, 0x0e, 0x22], mid: [0x0d, 0x14, 0x2c], hor: [0x16, 0x1e, 0x38], sun: 0.0 },
];

function sampleDay(t) {
  t = ((t % 1) + 1) % 1;
  let a = DAY_KEYS[0], b = DAY_KEYS[DAY_KEYS.length - 1];
  for (let i = 0; i < DAY_KEYS.length - 1; i++) {
    if (t >= DAY_KEYS[i].t && t <= DAY_KEYS[i + 1].t) { a = DAY_KEYS[i]; b = DAY_KEYS[i + 1]; break; }
  }
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return {
    zen: mixC(a.zen, b.zen, f),
    mid: mixC(a.mid, b.mid, f),
    hor: mixC(a.hor, b.hor, f),
    sun: lerpN(a.sun, b.sun, f),
  };
}

const _gradCache = new Map();

/**
 * Vertical sky gradient. Cached per (quantised time, tint, weather) so the
 * expensive palettise runs a couple of dozen times per session at most.
 */
function gradientTexture(tKey, tint, gloom) {
  const key = `${tKey}|${tint[0]},${tint[1]},${tint[2]}|${gloom}`;
  const hit = _gradCache.get(key);
  if (hit) return hit;

  const c = sampleDay(tKey / 48);
  const W = 32, H = 128;
  const p = new Pix(W, H);
  const grey = [0x9a, 0x9e, 0xa2];
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);                    // 0 = zenith, 1 = below horizon
    // Two-segment ramp with the join at 62% - MM6 skies are mostly flat colour
    // near the top and then band hard into the horizon haze.
    let col = v < 0.62
      ? mixC(c.zen, c.mid, smoothstep(0, 0.62, v))
      : mixC(c.mid, c.hor, smoothstep(0.62, 0.94, v));
    col = [col[0] * tint[0], col[1] * tint[1], col[2] * tint[2]];
    if (gloom > 0) col = mixC(col, scaleC(grey, 0.55 + c.sun * 0.45), gloom);
    for (let x = 0; x < W; x++) {
      // Slight horizontal noise stops the dome banding into perfect stripes.
      const n = 1 + (valueNoise2(x * 0.7, y * 0.35, 7) - 0.5) * 0.05;
      p.setArr(x, y, scaleC(col, n));
    }
  }
  const tex = toTexture(p, { dither: 16, repeat: false, mips: false, magNearest: false });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  _gradCache.set(key, tex);
  return tex;
}

let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const S = 128;
  const p = new Pix(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileFbm2(x / S * 5, y / S * 5, 5, 5, 0.55, 404);
      const a = smoothstep(0.50, 0.74, n);
      // Lit tops, shadowed undersides, exactly like the painted MM6 cloud sheet.
      const shade = 0.72 + 0.28 * smoothstep(0.5, 0.8, tileFbm2(x / S * 5 + 0.3, y / S * 5 - 0.3, 5, 5, 0.55, 404));
      p.setArr(x, y, scaleC([255, 252, 246], shade), Math.round(a * 235));
    }
  }
  _cloudTex = toTexture(p, { dither: 8, repeat: true, mips: true, magNearest: false });
  return _cloudTex;
}

let _discTex = null;
function discTexture() {
  if (_discTex) return _discTex;
  const S = 32;
  const p = new Pix(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
      const core = 1 - smoothstep(0.42, 0.52, d);
      const halo = (1 - smoothstep(0.0, 1.0, d)) * 0.55;
      const a = clamp(core + halo, 0, 1);
      if (a <= 0.02) { p.set(x, y, 0, 0, 0, 0); continue; }
      p.setArr(x, y, mixC([255, 220, 150], [255, 255, 244], core), Math.round(a * 255));
    }
  }
  _discTex = toTexture(p, { dither: 0, quantise: false, repeat: false, mips: false, magNearest: false });
  return _discTex;
}

let _flakeTex = null;
function flakeTexture() {
  if (_flakeTex) return _flakeTex;
  const S = 8;
  const p = new Pix(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 3.5, y - 3.5) / 4;
    const a = 1 - smoothstep(0.4, 1.0, d);
    p.set(x, y, 240, 246, 252, Math.round(a * 255));
  }
  _flakeTex = toTexture(p, { dither: 0, quantise: false, repeat: false, mips: false, magNearest: false });
  return _flakeTex;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} opts { camera, radius, fogNear, fogFar, tint, region }
 */
export function buildSky(scene, opts = {}) {
  const camera = opts.camera || null;
  const R = opts.radius || 7600;
  const group = new THREE.Group();
  group.name = 'sky';
  group.renderOrder = -1000;
  group.matrixAutoUpdate = true;

  // --- dome ---------------------------------------------------------------
  // A hemisphere plus a skirt below the horizon so the fogged-out world edge
  // never reveals the clear colour behind it.
  const domeGeo = new THREE.SphereGeometry(R, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.60);
  const domeMat = new THREE.MeshBasicMaterial({
    map: gradientTexture(24, [1, 1, 1], 0),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    depthTest: false,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  group.add(dome);

  // --- stars --------------------------------------------------------------
  const starCount = 420;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const srnd = new Rand(90210);
  for (let i = 0; i < starCount; i++) {
    const a = srnd.float(0, Math.PI * 2);
    const e = Math.acos(srnd.float(0.04, 1));
    const r = R * 0.92;
    starPos[i * 3] = Math.cos(a) * Math.sin(e) * r;
    starPos[i * 3 + 1] = Math.cos(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.sin(e) * r;
    const b = srnd.float(0.55, 1);
    starCol[i * 3] = b; starCol[i * 3 + 1] = b; starCol[i * 3 + 2] = b * srnd.float(0.9, 1.1);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2.5, sizeAttenuation: false, vertexColors: true,
    fog: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -999;
  stars.frustumCulled = false;
  group.add(stars);

  // --- sun / moon ---------------------------------------------------------
  const discGeo = new THREE.PlaneGeometry(1, 1);
  const sunMat = new THREE.MeshBasicMaterial({
    map: discTexture(), transparent: true, fog: false, depthWrite: false,
    depthTest: false, blending: THREE.AdditiveBlending,
  });
  const sun = new THREE.Mesh(discGeo, sunMat);
  sun.scale.setScalar(760);
  sun.renderOrder = -998;
  sun.frustumCulled = false;
  group.add(sun);

  const moonMat = new THREE.MeshBasicMaterial({
    map: discTexture(), transparent: true, fog: false, depthWrite: false,
    depthTest: false, color: 0xc8d4e4, opacity: 0,
  });
  const moon = new THREE.Mesh(discGeo, moonMat);
  moon.scale.setScalar(520);
  moon.renderOrder = -998;
  moon.frustumCulled = false;
  group.add(moon);

  // --- cloud sheet --------------------------------------------------------
  const cloudGeo = new THREE.CircleGeometry(R * 1.05, 28);
  cloudGeo.rotateX(Math.PI / 2);
  {
    // Fade the sheet out at its rim so it dissolves into the horizon band
    // instead of ending in a visible circular edge.
    const pos = cloudGeo.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i)) / (R * 1.05);
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1;
      col[i * 4 + 3] = 1 - smoothstep(0.42, 0.98, d);
    }
    cloudGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const uvs = cloudGeo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, pos.getX(i) / 2600, pos.getZ(i) / 2600);
    uvs.needsUpdate = true;
  }
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTexture(), transparent: true, vertexColors: true, fog: false,
    depthWrite: false, depthTest: false, opacity: 0.55, side: THREE.DoubleSide,
  });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.position.y = 1500;
  clouds.renderOrder = -997;
  clouds.frustumCulled = false;
  group.add(clouds);

  // --- precipitation ------------------------------------------------------
  const PCOUNT = 900;
  const pPos = new Float32Array(PCOUNT * 3);
  const pVel = new Float32Array(PCOUNT * 3);
  const prnd = new Rand(1337);
  const BOX = 2400, BOXY = 2000;
  for (let i = 0; i < PCOUNT; i++) {
    pPos[i * 3] = prnd.float(-BOX, BOX);
    pPos[i * 3 + 1] = prnd.float(-400, BOXY);
    pPos[i * 3 + 2] = prnd.float(-BOX, BOX);
  }
  const precipGeo = new THREE.BufferGeometry();
  precipGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  precipGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6000);
  const precipMat = new THREE.PointsMaterial({
    size: 3, sizeAttenuation: false, color: 0xc8d8e8,
    transparent: true, opacity: 0.7, fog: false, depthWrite: false,
    map: flakeTexture(), alphaTest: 0.12,
  });
  const precip = new THREE.Points(precipGeo, precipMat);
  precip.visible = false;
  precip.frustumCulled = false;
  precip.renderOrder = 900;
  group.add(precip);

  scene.add(group);

  // --- state --------------------------------------------------------------
  const state = {
    tint: [1, 1, 1],
    fogNear: opts.fogNear || 1400,
    fogFar: opts.fogFar || 6000,
    weather: 'clear',
    tod: 0.5,
    horizon: new THREE.Color(0xb8cddf),
    ambient: 1,
  };
  if (!scene.fog) scene.fog = new THREE.Fog(0xb8cddf, state.fogNear, state.fogFar);
  const fog = scene.fog;

  let lastKey = -1, cloudPhase = 0, elapsed = 0;

  function setRegion(def) {
    if (!def) return;
    state.tint = def.skyTint || [1, 1, 1];
    state.fogNear = def.fogNear || 1400;
    state.fogFar = def.fogFar || 6000;
    if (def.cloudiness !== undefined) cloudMat.opacity = def.cloudiness;
    lastKey = -1;
  }
  setRegion(opts.region);

  function update(dt, timeOfDay, weather, cam) {
    const c = cam || camera;
    elapsed += dt;
    if (timeOfDay !== undefined) state.tod = timeOfDay > 1 ? (timeOfDay / 24) : timeOfDay;
    if (weather) state.weather = weather;
    const tod = state.tod;

    const wet = state.weather === 'rain' || state.weather === 'snow';
    const gloom = state.weather === 'fog' ? 0.75
      : state.weather === 'cloudy' ? 0.35
        : wet ? 0.62 : 0;

    // Rebuilding the gradient is the only expensive part, so quantise time into
    // half-hour steps (48 keys) and only repaint when it actually changes.
    const key = Math.round(tod * 48) % 48;
    const gk = key * 8 + Math.round(gloom * 4);
    if (gk !== lastKey) {
      lastKey = gk;
      domeMat.map = gradientTexture(key, state.tint, gloom);
      domeMat.needsUpdate = true;
      const d = sampleDay(key / 48);
      let hor = [d.hor[0] * state.tint[0], d.hor[1] * state.tint[1], d.hor[2] * state.tint[2]];
      if (gloom > 0) hor = mixC(hor, scaleC([0x9a, 0x9e, 0xa2], 0.55 + d.sun * 0.45), gloom);
      state.horizon.setRGB(hor[0] / 255, hor[1] / 255, hor[2] / 255, THREE.SRGBColorSpace);
      state.ambient = 0.30 + d.sun * 0.70;
      // The whole point: fog is the horizon band, to the byte.
      fog.color.copy(state.horizon);
      if (scene.background && scene.background.isColor) scene.background.copy(state.horizon);
    }

    const far = state.fogFar * (state.weather === 'fog' ? 0.42 : wet ? 0.68 : state.weather === 'cloudy' ? 0.9 : 1);
    fog.near = Math.min(state.fogNear, far * 0.25);
    fog.far = far;

    // Sun arc: rises east (+X) at 06:00, sets west at 18:00, tilted south so it
    // matches the sun direction the terrain lighting was baked with.
    const ang = (tod - 0.25) * Math.PI * 2;
    const sx = Math.cos(ang), sy = Math.sin(ang), sz = 0.32;
    const inv = 1 / Math.hypot(sx, sy, sz);
    const dist = R * 0.90;
    sun.position.set(sx * inv * dist, sy * inv * dist, sz * inv * dist);
    moon.position.set(-sx * inv * dist, -sy * inv * dist, -sz * inv * dist);
    const dayness = clamp(sy * 3 + 0.35, 0, 1);
    sunMat.opacity = dayness * (1 - gloom * 0.85);
    sun.visible = sunMat.opacity > 0.02;
    moonMat.opacity = (1 - dayness) * 0.9 * (1 - gloom * 0.6);
    moon.visible = moonMat.opacity > 0.02;
    starMat.opacity = clamp(1 - dayness * 1.6, 0, 1) * (1 - gloom);
    stars.visible = starMat.opacity > 0.02;
    if (c) { sun.quaternion.copy(c.quaternion); moon.quaternion.copy(c.quaternion); }

    // Clouds scroll; heavier weather thickens them.
    cloudPhase += dt * (state.weather === 'clear' ? 0.004 : 0.010);
    cloudMat.map.offset.set(cloudPhase, cloudPhase * 0.35);
    const targetOpacity = state.weather === 'clear' ? 0.42
      : state.weather === 'cloudy' ? 0.82 : wet ? 0.9 : state.weather === 'fog' ? 0.5 : 0.42;
    cloudMat.opacity += (targetOpacity - cloudMat.opacity) * Math.min(1, dt * 2);
    cloudMat.color.setRGB(
      0.55 + dayness * 0.45, 0.55 + dayness * 0.45, 0.60 + dayness * 0.40, THREE.SRGBColorSpace,
    );

    // Precipitation, camera-locked so a fixed particle budget always fills view.
    precip.visible = wet;
    if (wet) {
      const arr = precipGeo.attributes.position.array;
      const fall = state.weather === 'rain' ? -3200 : -420;
      const drift = state.weather === 'rain' ? 240 : 150;
      for (let i = 0; i < PCOUNT; i++) {
        const k = i * 3;
        arr[k + 1] += fall * dt;
        arr[k] += Math.sin(elapsed * 0.8 + i) * drift * dt;
        if (arr[k + 1] < -600) {
          arr[k + 1] = BOXY;
          arr[k] = prnd.float(-BOX, BOX);
          arr[k + 2] = prnd.float(-BOX, BOX);
        }
      }
      precipGeo.attributes.position.needsUpdate = true;
      precipMat.size = state.weather === 'rain' ? 2 : 3.5;
      precipMat.opacity = state.weather === 'rain' ? 0.5 : 0.8;
    }

    if (c) group.position.copy(c.position);
  }

  function dispose() {
    scene.remove(group);
    domeGeo.dispose(); domeMat.dispose();
    starGeo.dispose(); starMat.dispose();
    discGeo.dispose(); sunMat.dispose(); moonMat.dispose();
    cloudGeo.dispose(); cloudMat.dispose();
    precipGeo.dispose(); precipMat.dispose();
  }

  return { group, update, setRegion, dispose, state, dome, clouds, sun, moon };
}
