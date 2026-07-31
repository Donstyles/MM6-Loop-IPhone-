import * as THREE from 'three';
import { buildPaletteLUT, LUT_SIZE } from './palette.js';
import { layout } from './layout.js';

// ---------------------------------------------------------------------------
// Renderer.
//
// The world is drawn into an offscreen buffer at the 3D window's *logical*
// resolution - about 460x352, exactly what MM6 rendered - and then passed
// through a post step that ordered-dithers and snaps every pixel to the 256
// colour palette before the browser scales it up with nearest filtering.
//
// Rendering at 460x352 also means the fragment cost is trivial, which is how we
// hold 60fps on a phone while still drawing a dense world.
// ---------------------------------------------------------------------------

const POST_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */ `
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler3D tLUT;
uniform float uDither;
uniform float uPalette;
uniform vec2  uResolution;
uniform vec3  uTint;
uniform float uFlash;
uniform vec3  uFlashColor;
uniform float uFade;

const float BAYER[64] = float[64](
   0.0,32.0, 8.0,40.0, 2.0,34.0,10.0,42.0,
  48.0,16.0,56.0,24.0,50.0,18.0,58.0,26.0,
  12.0,44.0, 4.0,36.0,14.0,46.0, 6.0,38.0,
  60.0,28.0,52.0,20.0,62.0,30.0,54.0,22.0,
   3.0,35.0,11.0,43.0, 1.0,33.0, 9.0,41.0,
  51.0,19.0,59.0,27.0,49.0,17.0,57.0,25.0,
  15.0,47.0, 7.0,39.0,13.0,45.0, 5.0,37.0,
  63.0,31.0,55.0,23.0,61.0,29.0,53.0,21.0
);

void main() {
  vec3 c = texture(tDiffuse, vUv).rgb;

  // Party-wide tints: time of day, damage flash, spell wash.
  c *= uTint;
  c = mix(c, uFlashColor, uFlash);
  c *= uFade;

  // Ordered dither in screen space, then snap to the palette. The dither runs
  // at roughly one palette step so gradients break into the stipple pattern the
  // software renderer produced instead of banding.
  ivec2 p = ivec2(mod(vUv * uResolution, 8.0));
  float d = (BAYER[p.y * 8 + p.x] / 64.0 - 0.4921875) * uDither;
  vec3 dithered = clamp(c + d, 0.0, 1.0);

  vec3 quantised = texture(tLUT, dithered * (float(${LUT_SIZE}) - 1.0) / float(${LUT_SIZE}) + 0.5 / float(${LUT_SIZE})).rgb;

  pc_fragColor = vec4(mix(clamp(c, 0.0, 1.0), quantised, uPalette), 1.0);
}
`;

export class Engine {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for screenshot capture
    });
    this.renderer.setPixelRatio(1);           // internal res is fixed and low
    this.renderer.autoClear = true;
    this.renderer.sortObjects = true;
    this.renderer.setClearColor(0x000000, 1);
    // Palette snapping happens in the post pass, so keep the scene in plain
    // linear-to-sRGB with no tone mapping curve stealing the highlights.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    // Vanilla clip planes. The far plane is exactly 16 map tiles.
    this.camera = new THREE.PerspectiveCamera(59.73, 461 / 345, 32, 8192);
    this.camera.rotation.order = 'YXZ';
    this.indoor = false;

    this.width = 461;
    this.height = 345;

    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.SRGBColorSpace,
    });

    const lut = new THREE.Data3DTexture(buildPaletteLUT(), LUT_SIZE, LUT_SIZE, LUT_SIZE);
    lut.format = THREE.RGBAFormat;
    lut.type = THREE.UnsignedByteType;
    lut.minFilter = THREE.NearestFilter;
    lut.magFilter = THREE.NearestFilter;
    lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
    lut.needsUpdate = true;
    this.lut = lut;

    this.postMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nin vec3 position;\nin vec2 uv;\n` + POST_VERT,
      fragmentShader: `precision highp float;\nprecision highp sampler3D;\nlayout(location = 0) out vec4 pc_fragColor;\n` + POST_FRAG,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tLUT: { value: lut },
        // MM6's software renderer did not dither - it shaded by swapping to one
        // of 32 pre-darkened palettes, so gradients band. We keep only enough
        // dither to break up the lookup cube's own cells.
        uDither: { value: 0.016 },
        uPalette: { value: 1.0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 0.2, 0.1) },
        uFade: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.postScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.postCamera = new THREE.Camera();

    this.maxAnisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
  }

  /** Resize the internal buffer and the canvas' CSS box. */
  layoutTo(view, screen) {
    // Internal resolution tracks the logical 3D window 1:1 - crunchy on purpose.
    const w = Math.max(64, Math.round(view.w));
    const h = Math.max(64, Math.round(view.h));
    if (w !== this.width || h !== this.height) {
      this.width = w; this.height = h;
      this.rt.setSize(w, h);
      this.postMaterial.uniforms.uResolution.value.set(w, h);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = vfovForAspect(w / h, this.indoor);
      this.camera.updateProjectionMatrix();
    }
    const s = screen.scale;
    const st = this.canvas.style;
    st.left = `${screen.x + view.x * s}px`;
    st.top = `${screen.y + view.y * s}px`;
    st.width = `${view.w * s}px`;
    st.height = `${view.h * s}px`;
  }

  /** Dungeons use a narrower FOV than the outdoors; the switch is very visible. */
  setIndoor(indoor) {
    if (this.indoor === indoor) return;
    this.indoor = indoor;
    this.camera.fov = vfovForAspect(this.width / this.height, indoor);
    this.camera.updateProjectionMatrix();
  }

  setTint(r, g, b) { this.postMaterial.uniforms.uTint.value.setRGB(r, g, b); }
  setFlash(amount, color) {
    this.postMaterial.uniforms.uFlash.value = amount;
    if (color) this.postMaterial.uniforms.uFlashColor.value.set(color);
  }
  setFade(v) { this.postMaterial.uniforms.uFade.value = v; }

  render() {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }

  get info() { return this.renderer.info; }
}

/**
 * MM6 fixes the *horizontal* FOV - 75 degrees outdoors, 60 indoors - and
 * derives vertical from the 461x345 window, giving 59.73 / 46.74 degrees. The
 * narrowing on entering a dungeon is very noticeable and worth keeping.
 * Anchoring to the authentic aspect means a widened phone window reveals more
 * world horizontally instead of stretching the image.
 */
export const HFOV_OUTDOOR = 75;
export const HFOV_INDOOR = 60;
export const BASE_ASPECT = 461 / 345;

export function vfovForAspect(aspect, indoor = false) {
  const hfov = THREE.MathUtils.degToRad(indoor ? HFOV_INDOOR : HFOV_OUTDOOR);
  const a = Math.max(aspect, BASE_ASPECT);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / a));
}

/**
 * Quantise a lighting multiplier to MM6's 32 discrete levels, 8*(31-dim).
 * Applying this wherever we shade keeps the era-correct banding instead of
 * smooth modern falloff.
 */
export function quantiseLight(v) {
  const step = Math.round(Math.max(0, Math.min(1, v)) * 31);
  return (step * 8) / 248;
}
