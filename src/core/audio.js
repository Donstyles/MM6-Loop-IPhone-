// ---------------------------------------------------------------------------
// Procedural sound effects.
//
// Nothing here is a sample. Every sound is described as a tiny synth patch and
// baked once into an AudioBuffer with an OfflineAudioContext; playback is then
// just a BufferSource, which is the only thing cheap enough to fire dozens of
// times a second on a phone.
//
// The target is the 1998 CD-era RPG palette: dry, punchy, mid-forward hits with
// very little tail, plus a handful of long looping ambience beds.
//
// iOS will not let us build an AudioContext outside a user gesture, so nothing
// is created until init() is called from a tap.
// ---------------------------------------------------------------------------

import { Rand, hashStr, clamp } from './rng.js';

// ---------------------------------------------------------------------------
// Synth rig - the toolbox every recipe is written against.
// ---------------------------------------------------------------------------

/**
 * StereoPannerNode is missing on Safari before 14.5. Fall back to the old
 * PannerNode, and to nothing at all if even that is absent - a mono mix is a
 * far better outcome than a thrown exception during a user gesture.
 */
export function mkPan(ctx, v) {
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    return p;
  }
  if (ctx.createPanner) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    const z = Math.sqrt(Math.max(0, 1 - v * v));
    if (p.positionX) { p.positionX.value = v; p.positionY.value = 0; p.positionZ.value = z; }
    else p.setPosition(v, 0, z);
    return p;
  }
  return null;
}

/** Promise-shaped offline render that also works on the pre-promise API. */
export function renderOffline(off) {
  return new Promise((resolve, reject) => {
    off.oncomplete = (e) => resolve(e.renderedBuffer);
    let p;
    try { p = off.startRendering(); } catch (err) { reject(err); return; }
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/**
 * Seeded noise samples, cached across every render in the session.
 *
 * Each recipe draws its own random start offset out of the bed and puts its own
 * filters on it, so sharing the underlying samples is inaudible - and it turns
 * "generate 100k samples" into a memcpy, which is what keeps init inside the
 * gesture budget.
 */
const noiseCache = new Map();
function noiseData(color, n) {
  const key = color + ':' + n;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const d = new Float32Array(n);
  let a = hashStr('mm6noise:' + color) >>> 0;
  // mulberry32 inlined; the per-sample method call is not free at this size.
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.32;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      d[i] = last * 3.2;
    }
  } else {
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
  }
  noiseCache.set(key, d);
  return d;
}

/** Cheap curve builder for pitch/filter contours. */
function curveOf(points, n = 64) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // points is [[t01, value], ...] sorted; piecewise-linear in log space so
    // pitch sweeps sound even.
    let a = points[0], b = points[points.length - 1];
    for (let k = 0; k < points.length - 1; k++) {
      if (t >= points[k][0] && t <= points[k + 1][0]) { a = points[k]; b = points[k + 1]; break; }
    }
    const span = Math.max(1e-6, b[0] - a[0]);
    const u = clamp((t - a[0]) / span, 0, 1);
    out[i] = Math.exp(Math.log(Math.max(1e-4, a[1])) + (Math.log(Math.max(1e-4, b[1])) - Math.log(Math.max(1e-4, a[1]))) * u);
  }
  return out;
}

const SOFT_CLIP = (() => {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  return c;
})();

const HARD_DRIVE = (() => {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 6) * 0.8;
  }
  return c;
})();

/**
 * A per-render helper bundle. Recipes get one of these and never touch the
 * raw context, which keeps them short enough to read as sound design.
 */
class Rig {
  constructor(ctx, out, rng) {
    this.ctx = ctx;
    this.out = out;
    this.rng = rng;
    this._noise = new Map();
    this._verb = null;
    // Non-zero when this recipe is being baked as one slot of a batch render.
    this.offset = 0;
  }

  /**
   * Noise bed for this render; sources loop it, so a couple of seconds covers
   * everything. The samples come from the shared cache - filling one of these
   * by hand was, measurably, most of the cost of baking a footstep.
   */
  noise(color = 'white', dur = 2.2) {
    const key = color + dur;
    let b = this._noise.get(key);
    if (b) return b;
    const ctx = this.ctx;
    const n = Math.max(1, Math.ceil(dur * ctx.sampleRate));
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    b.getChannelData(0).set(noiseData(color, n));
    this._noise.set(key, b);
    return b;
  }

  g(v = 1, dest) {
    const n = this.ctx.createGain();
    n.gain.value = v;
    n.connect(dest || this.out);
    return n;
  }

  /** ADR envelope written onto a gain param. Exponential release by default. */
  env(param, t, { a = 0.004, h = 0, d = 0.2, peak = 1, floor = 0.0008, linear = false } = {}) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (h > 0) param.setValueAtTime(peak, t + a + h);
    const end = t + a + h + d;
    if (linear) param.linearRampToValueAtTime(0, end);
    else { param.exponentialRampToValueAtTime(floor, end); param.linearRampToValueAtTime(0, end + 0.004); }
    return end + 0.006;
  }

  /** Pitched oscillator with optional glide and an ADR body. */
  tone(o = {}) {
    const ctx = this.ctx;
    const t = (o.t || 0) + this.offset;
    const dur = o.dur ?? 0.25;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    if (o.detune) osc.detune.value = o.detune;
    if (o.contour) {
      osc.frequency.setValueCurveAtTime(curveOf(o.contour, o.steps || 48), t, dur);
    } else if (o.f2 != null && o.f2 !== o.f) {
      osc.frequency.setValueAtTime(o.f, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
    } else {
      osc.frequency.value = o.f ?? 440;
    }
    const vca = ctx.createGain();
    const end = this.env(vca.gain, t, { a: o.a ?? 0.004, h: o.h || 0, d: o.d ?? dur, peak: o.g ?? 0.4, linear: o.linear });
    let node = vca;
    if (o.lp || o.bp || o.hp) {
      const f = ctx.createBiquadFilter();
      f.type = o.lp ? 'lowpass' : o.bp ? 'bandpass' : 'highpass';
      const fc = o.lp || o.bp || o.hp;
      if (Array.isArray(fc)) {
        f.frequency.setValueAtTime(fc[0], t);
        f.frequency.exponentialRampToValueAtTime(Math.max(20, fc[1]), t + dur);
      } else f.frequency.value = fc;
      f.Q.value = o.Q ?? 1;
      vca.connect(f);
      node = f;
    }
    node.connect(o.dest || this.out);
    osc.connect(vca);
    osc.start(t);
    osc.stop(end);
    return end;
  }

  /** Filtered noise burst - the backbone of impacts, whooshes and ambience. */
  nz(o = {}) {
    const ctx = this.ctx;
    const t = (o.t || 0) + this.offset;
    const dur = o.dur ?? 0.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(o.color || 'white', o.bed || 2.2);
    src.loop = true;
    src.loopEnd = src.buffer.duration;
    src.playbackRate.value = o.rate || 1;
    // Start reading at a random offset so repeated bursts in one render never
    // reuse the exact same noise slice.
    const off = this.rng.float(0, src.buffer.duration * 0.5);
    const vca = ctx.createGain();
    const end = this.env(vca.gain, t, { a: o.a ?? 0.002, h: o.h || 0, d: o.d ?? dur, peak: o.g ?? 0.35, linear: o.linear });
    let node = vca;
    const ftype = o.type || 'bandpass';
    if (ftype !== 'none') {
      const f = ctx.createBiquadFilter();
      f.type = ftype;
      const fc = o.f ?? 1200;
      if (Array.isArray(fc)) {
        f.frequency.setValueCurveAtTime(curveOf(fc.map((v, i) => [i / (fc.length - 1), v]), 32), t, Math.max(0.02, dur));
      } else f.frequency.value = fc;
      f.Q.value = o.Q ?? 1;
      vca.connect(f);
      node = f;
    }
    node.connect(o.dest || this.out);
    src.connect(vca);
    src.start(t, off);
    src.stop(end);
    return end;
  }

  /** Two-operator FM - bells, metal, ice, coins. */
  bell(o = {}) {
    const ctx = this.ctx;
    const t = (o.t || 0) + this.offset;
    const dur = o.dur ?? 1;
    const f = o.f ?? 660;
    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f * (o.ratio ?? 3.47);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * (o.index ?? 5), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.45);
    mod.connect(mg);
    mg.connect(car.frequency);
    const vca = ctx.createGain();
    const end = this.env(vca.gain, t, { a: o.a ?? 0.002, d: dur, peak: o.g ?? 0.3 });
    car.connect(vca);
    vca.connect(o.dest || this.out);
    car.start(t); mod.start(t);
    car.stop(end); mod.stop(end);
    return end;
  }

  /**
   * Crude vocal tract: a buzzy source through two or three resonant formants,
   * optionally amplitude-chewed by a growl LFO. Every monster comes from here.
   */
  vox(o = {}) {
    const ctx = this.ctx;
    const t = (o.t || 0) + this.offset;
    const dur = o.dur ?? 0.5;
    const src = ctx.createOscillator();
    src.type = o.wave || 'sawtooth';
    src.frequency.setValueCurveAtTime(curveOf(o.f0 || [[0, 140], [1, 110]], 48), t, dur);

    const pre = ctx.createGain();
    pre.gain.value = 1;
    src.connect(pre);

    // Breath / rasp layer.
    let breath = null;
    if (o.breath) {
      breath = ctx.createBufferSource();
      breath.buffer = this.noise('white');
      breath.loop = true;
      const bg = ctx.createGain();
      bg.gain.value = o.breath;
      breath.connect(bg); bg.connect(pre);
    }

    let node = pre;
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = o.drive > 0.6 ? HARD_DRIVE : SOFT_CLIP;
      pre.connect(ws);
      node = ws;
    }

    const vca = ctx.createGain();
    const end = this.env(vca.gain, t, { a: o.a ?? 0.02, h: o.h ?? dur * 0.35, d: o.d ?? dur * 0.6, peak: o.g ?? 0.3 });

    // Growl: slow AM makes a tone read as an animal rather than a synth.
    if (o.growl) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = o.growl[0];
      const la = ctx.createGain();
      la.gain.value = (o.g ?? 0.3) * o.growl[1];
      lfo.connect(la); la.connect(vca.gain);
      lfo.start(t); lfo.stop(end);
    }

    const formants = o.formants || [[500, 6, 1], [1200, 8, 0.5], [2600, 9, 0.2]];
    const sum = ctx.createGain();
    sum.gain.value = 1;
    for (const [ff, q, gg] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = gg;
      node.connect(bp); bp.connect(bg); bg.connect(sum);
    }
    sum.connect(vca);
    vca.connect(o.dest || this.out);
    src.start(t); src.stop(end);
    if (breath) { breath.start(t, this.rng.float(0, 1)); breath.stop(end); }
    return end;
  }

  /** Shared reverb send for this render. Baked in, so playback stays free. */
  verb(dur = 1.4, decay = 3.2, wet = 0.3) {
    if (this._verb) return this._verb;
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    const n = Math.max(1, Math.floor(dur * ctx.sampleRate));
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // A little early build-up then exponential tail reads as a stone room.
        const shape = Math.min(1, t * 60) * Math.pow(1 - t, decay);
        d[i] = this.rng.float(-1, 1) * shape;
      }
    }
    conv.buffer = buf;
    const send = ctx.createGain();
    send.gain.value = 1;
    const wetG = ctx.createGain();
    wetG.gain.value = wet;
    send.connect(conv); conv.connect(wetG); wetG.connect(this.out);
    this._verb = send;
    return send;
  }

  /** Stereo widener: pushes a source hard left/right at a fixed amount. */
  side(amount = 0.6) {
    const p = mkPan(this.ctx, amount);
    if (!p) return this.out;
    p.connect(this.out);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Recipes.
//
// Each entry is { dur, peak, loop?, build(rig) }. `dur` is the render length in
// seconds, `peak` the normalisation target (this is the mix balance - a click
// and an explosion should not both land at 1.0).
// ---------------------------------------------------------------------------

const R = {};
const def = (id, dur, peak, build, extra) => { R[id] = Object.assign({ dur, peak, build }, extra); };

// -- movement ---------------------------------------------------------------

def('step_grass', 0.20, 0.42, (r) => {
  r.nz({ t: 0, dur: 0.11, g: 0.5, f: [2400, 900], Q: 0.9, color: 'white', a: 0.001, d: 0.09 });
  r.nz({ t: 0.012, dur: 0.09, g: 0.25, type: 'highpass', f: 3800, a: 0.001, d: 0.07 });
  r.tone({ t: 0, f: 150, f2: 90, dur: 0.07, g: 0.16, type: 'sine', a: 0.002, d: 0.06 });
});

def('step_stone', 0.20, 0.5, (r) => {
  r.nz({ t: 0, dur: 0.07, g: 0.55, f: [3600, 1100], Q: 1.1, a: 0.0008, d: 0.05 });
  r.tone({ t: 0, f: 190, f2: 105, dur: 0.09, g: 0.3, type: 'sine', a: 0.001, d: 0.07 });
  r.nz({ t: 0.004, dur: 0.05, g: 0.2, type: 'highpass', f: 5200, a: 0.0005, d: 0.04 });
});

def('step_wood', 0.24, 0.5, (r) => {
  // Hollow board: two resonances an unrelated interval apart.
  r.nz({ t: 0, dur: 0.05, g: 0.4, f: 1800, Q: 1, a: 0.0008, d: 0.04 });
  r.tone({ t: 0, f: 430, dur: 0.13, g: 0.28, type: 'sine', a: 0.001, d: 0.12 });
  r.tone({ t: 0, f: 946, dur: 0.09, g: 0.16, type: 'sine', a: 0.001, d: 0.08 });
  r.tone({ t: 0, f: 170, f2: 120, dur: 0.08, g: 0.2, type: 'sine', a: 0.001, d: 0.07 });
});

def('step_water', 0.34, 0.5, (r) => {
  r.nz({ t: 0, dur: 0.22, g: 0.45, f: [3000, 700], Q: 0.8, a: 0.004, d: 0.2 });
  for (let i = 0; i < 3; i++) {
    const t = r.rng.float(0.03, 0.18);
    r.tone({ t, f: r.rng.float(900, 1700), f2: r.rng.float(300, 600), dur: 0.05, g: 0.12, type: 'sine', a: 0.001, d: 0.045 });
  }
  r.tone({ t: 0, f: 130, f2: 80, dur: 0.1, g: 0.15, type: 'sine', a: 0.003, d: 0.09 });
});

def('step_snow', 0.22, 0.34, (r) => {
  r.nz({ t: 0, dur: 0.14, g: 0.5, f: [5200, 2200], Q: 0.6, a: 0.003, d: 0.12 });
  // Squeak: snow compressing.
  r.nz({ t: 0.02, dur: 0.09, g: 0.18, f: 6400, Q: 8, a: 0.006, d: 0.08 });
});

def('jump', 0.30, 0.45, (r) => {
  r.nz({ t: 0, dur: 0.18, g: 0.3, f: [700, 2600], Q: 1.2, a: 0.01, d: 0.16 });
  r.tone({ t: 0, f: 180, f2: 320, dur: 0.14, g: 0.22, type: 'triangle', a: 0.005, d: 0.13 });
});

def('land', 0.34, 0.62, (r) => {
  r.tone({ t: 0, f: 160, f2: 55, dur: 0.16, g: 0.6, type: 'sine', a: 0.001, d: 0.15 });
  r.nz({ t: 0, dur: 0.13, g: 0.4, f: [2600, 500], Q: 0.8, a: 0.001, d: 0.12 });
  r.nz({ t: 0.02, dur: 0.1, g: 0.14, type: 'highpass', f: 4000, a: 0.002, d: 0.09 });
});

def('swim', 0.75, 0.4, (r) => {
  r.nz({ t: 0, dur: 0.5, g: 0.42, f: [500, 2400, 600], Q: 0.7, a: 0.09, d: 0.45, color: 'pink' });
  for (let i = 0; i < 6; i++) {
    const t = r.rng.float(0.05, 0.55);
    r.tone({ t, f: r.rng.float(500, 1400), f2: r.rng.float(200, 500), dur: 0.06, g: 0.07, type: 'sine', a: 0.002, d: 0.05 });
  }
});

// -- combat -----------------------------------------------------------------

def('swing_light', 0.28, 0.45, (r) => {
  r.nz({ t: 0, dur: 0.2, g: 0.5, f: [500, 3200, 900], Q: 2.2, a: 0.03, d: 0.18, color: 'pink' });
  r.nz({ t: 0.05, dur: 0.12, g: 0.12, type: 'highpass', f: 5000, a: 0.04, d: 0.1 });
});

def('swing_heavy', 0.42, 0.55, (r) => {
  r.nz({ t: 0, dur: 0.33, g: 0.55, f: [260, 1500, 380], Q: 2.6, a: 0.07, d: 0.3, color: 'brown' });
  r.nz({ t: 0.06, dur: 0.22, g: 0.16, f: [900, 2600, 700], Q: 1.4, a: 0.06, d: 0.2 });
  r.tone({ t: 0.02, f: 90, f2: 55, dur: 0.2, g: 0.14, type: 'sine', a: 0.05, d: 0.18 });
});

def('hit_flesh', 0.26, 0.72, (r) => {
  r.tone({ t: 0, f: 130, f2: 48, dur: 0.13, g: 0.6, type: 'sine', a: 0.001, d: 0.12 });
  r.nz({ t: 0, dur: 0.11, g: 0.4, f: [1500, 320], Q: 0.9, a: 0.001, d: 0.1, color: 'pink' });
  // wet slap
  r.nz({ t: 0.005, dur: 0.06, g: 0.2, f: 2600, Q: 3, a: 0.001, d: 0.055 });
});

def('hit_armor', 0.55, 0.7, (r) => {
  r.nz({ t: 0, dur: 0.05, g: 0.5, type: 'highpass', f: 3000, a: 0.0006, d: 0.045 });
  const base = 520;
  for (const [m, g] of [[1, 0.24], [1.71, 0.18], [2.43, 0.13], [3.31, 0.09], [4.62, 0.06]]) {
    r.bell({ t: 0, f: base * m, dur: 0.42 / Math.sqrt(m), g, ratio: 2.7, index: 2.2 });
  }
  r.tone({ t: 0, f: 150, f2: 70, dur: 0.1, g: 0.3, type: 'sine', a: 0.001, d: 0.09 });
});

def('hit_bone', 0.28, 0.66, (r) => {
  r.nz({ t: 0, dur: 0.035, g: 0.55, type: 'highpass', f: 2400, a: 0.0005, d: 0.03 });
  r.tone({ t: 0, f: 340, dur: 0.16, g: 0.3, type: 'triangle', a: 0.0008, d: 0.15, bp: 900, Q: 3 });
  r.tone({ t: 0, f: 1180, dur: 0.09, g: 0.16, type: 'sine', a: 0.0008, d: 0.08 });
  r.tone({ t: 0, f: 120, f2: 70, dur: 0.08, g: 0.22, type: 'sine', a: 0.001, d: 0.07 });
});

def('hit_stone', 0.30, 0.66, (r) => {
  r.nz({ t: 0, dur: 0.09, g: 0.6, f: [4200, 800], Q: 0.9, a: 0.0006, d: 0.08 });
  r.nz({ t: 0.01, dur: 0.14, g: 0.2, f: 1500, Q: 2.5, a: 0.002, d: 0.13, color: 'pink' });
  r.tone({ t: 0, f: 175, f2: 80, dur: 0.11, g: 0.3, type: 'sine', a: 0.001, d: 0.1 });
});

def('miss', 0.26, 0.26, (r) => {
  r.nz({ t: 0, dur: 0.2, g: 0.4, f: [700, 2400, 800], Q: 1.6, a: 0.04, d: 0.18, color: 'pink' });
});

def('bow_shot', 0.36, 0.6, (r) => {
  // String release, then the shaft leaving.
  r.tone({ t: 0, f: 220, f2: 168, dur: 0.14, g: 0.42, type: 'triangle', a: 0.0008, d: 0.13, lp: [4000, 900], Q: 2 });
  r.tone({ t: 0, f: 440, f2: 330, dur: 0.08, g: 0.18, type: 'sawtooth', a: 0.0008, d: 0.07, lp: 2600 });
  r.nz({ t: 0.01, dur: 0.24, g: 0.24, f: [1200, 4200, 1600], Q: 2.4, a: 0.05, d: 0.22 });
});

def('arrow_hit', 0.28, 0.62, (r) => {
  r.nz({ t: 0, dur: 0.04, g: 0.5, type: 'highpass', f: 2600, a: 0.0005, d: 0.035 });
  r.tone({ t: 0, f: 260, dur: 0.14, g: 0.35, type: 'triangle', a: 0.0008, d: 0.13, bp: 700, Q: 4 });
  r.tone({ t: 0, f: 110, f2: 62, dur: 0.09, g: 0.24, type: 'sine', a: 0.001, d: 0.08 });
});

def('block', 0.55, 0.68, (r) => {
  r.nz({ t: 0, dur: 0.045, g: 0.5, type: 'highpass', f: 2400, a: 0.0005, d: 0.04 });
  for (const [m, g] of [[1, 0.22], [1.94, 0.16], [2.77, 0.1], [3.98, 0.06]]) {
    r.bell({ t: 0, f: 340 * m, dur: 0.45 / Math.sqrt(m), g, ratio: 1.83, index: 1.6 });
  }
  r.tone({ t: 0, f: 130, f2: 62, dur: 0.12, g: 0.3, type: 'sine', a: 0.001, d: 0.11 });
});

def('crit', 0.75, 0.85, (r) => {
  const v = r.verb(0.9, 3.4, 0.22);
  r.tone({ t: 0, f: 150, f2: 45, dur: 0.2, g: 0.65, type: 'sine', a: 0.001, d: 0.19 });
  r.nz({ t: 0, dur: 0.12, g: 0.5, f: [5200, 700], Q: 0.8, a: 0.0006, d: 0.11 });
  r.nz({ t: 0, dur: 0.12, g: 0.2, f: 3000, Q: 1, a: 0.0006, d: 0.11, dest: v });
  // Bright confirming ping so the player reads it as a good thing.
  r.bell({ t: 0.03, f: 1320, dur: 0.5, g: 0.22, ratio: 2.01, index: 3 });
  r.bell({ t: 0.03, f: 1980, dur: 0.4, g: 0.12, ratio: 2.01, index: 3, dest: v });
});

def('death_player', 1.5, 0.8, (r) => {
  const v = r.verb(1.3, 3, 0.28);
  r.vox({
    t: 0, dur: 1.0, g: 0.45, a: 0.05, h: 0.25, d: 0.7,
    f0: [[0, 190], [0.25, 170], [0.7, 105], [1, 72]],
    formants: [[520, 6, 1], [1080, 8, 0.45], [2400, 9, 0.12]],
    breath: 0.18, drive: 0.4, growl: [7, 0.35], dest: v,
  });
  r.vox({
    t: 0, dur: 1.0, g: 0.45, a: 0.05, h: 0.25, d: 0.7,
    f0: [[0, 190], [0.25, 170], [0.7, 105], [1, 72]],
    formants: [[520, 6, 1], [1080, 8, 0.45], [2400, 9, 0.12]],
    breath: 0.18, drive: 0.4, growl: [7, 0.35],
  });
  // Body and gear hitting the floor.
  r.tone({ t: 0.95, f: 120, f2: 44, dur: 0.25, g: 0.5, type: 'sine', a: 0.002, d: 0.24 });
  r.nz({ t: 0.95, dur: 0.3, g: 0.28, f: [2000, 400], Q: 0.8, a: 0.002, d: 0.28 });
  for (let i = 0; i < 4; i++) r.bell({ t: 1.0 + r.rng.float(0, 0.2), f: r.rng.float(700, 1700), dur: 0.3, g: 0.07, ratio: 3.1, index: 4, dest: v });
});

def('party_hurt', 0.45, 0.62, (r) => {
  r.vox({
    t: 0, dur: 0.3, g: 0.5, a: 0.008, h: 0.05, d: 0.24,
    f0: [[0, 260], [0.2, 300], [1, 190]],
    formants: [[640, 5, 1], [1220, 7, 0.5], [2700, 9, 0.15]],
    breath: 0.12, drive: 0.35,
  });
});

// -- monsters ---------------------------------------------------------------

def('growl_small', 0.55, 0.6, (r) => {
  r.vox({
    t: 0, dur: 0.45, g: 0.45, a: 0.03, h: 0.18, d: 0.28,
    f0: [[0, 150], [0.4, 132], [1, 108]],
    formants: [[480, 7, 1], [1150, 9, 0.4], [2500, 10, 0.1]],
    growl: [31, 0.5], breath: 0.1, drive: 0.5,
  });
});

def('growl_large', 1.05, 0.78, (r) => {
  const v = r.verb(0.8, 3.4, 0.18);
  const o = {
    t: 0, dur: 0.9, g: 0.5, a: 0.06, h: 0.35, d: 0.55,
    f0: [[0, 78], [0.5, 66], [1, 52]],
    formants: [[300, 6, 1], [720, 8, 0.5], [1500, 9, 0.15]],
    growl: [17, 0.55], breath: 0.14, drive: 0.8,
  };
  r.vox(o);
  r.vox(Object.assign({}, o, { g: 0.28, dest: v }));
});

def('hiss', 0.75, 0.42, (r) => {
  r.nz({ t: 0, dur: 0.62, g: 0.5, f: [2600, 5200, 3400], Q: 1.6, a: 0.09, d: 0.55 });
  r.nz({ t: 0.04, dur: 0.5, g: 0.2, f: 7600, Q: 3, a: 0.1, d: 0.45 });
});

def('screech', 0.7, 0.58, (r) => {
  r.vox({
    t: 0, dur: 0.55, g: 0.4, a: 0.015, h: 0.2, d: 0.34,
    f0: [[0, 620], [0.25, 1480], [0.7, 1320], [1, 780]],
    formants: [[1500, 9, 1], [3100, 11, 0.55], [4600, 12, 0.2]],
    wave: 'sawtooth', drive: 0.9, breath: 0.08,
  });
  r.nz({ t: 0.02, dur: 0.4, g: 0.1, f: [4000, 7000], Q: 2, a: 0.03, d: 0.36 });
});

def('roar_dragon', 1.7, 0.92, (r) => {
  const v = r.verb(1.6, 2.6, 0.3);
  const o = {
    t: 0, dur: 1.45, g: 0.5, a: 0.09, h: 0.6, d: 0.8,
    f0: [[0, 96], [0.15, 86], [0.6, 70], [1, 54]],
    formants: [[260, 5, 1], [640, 7, 0.6], [1400, 8, 0.28], [3000, 9, 0.08]],
    growl: [13, 0.5], breath: 0.22, drive: 0.95,
  };
  r.vox(o);
  r.vox(Object.assign({}, o, { g: 0.3, dest: v }));
  r.tone({ t: 0, f: 46, f2: 30, dur: 1.3, g: 0.3, type: 'sine', a: 0.12, d: 1.15 });
  r.nz({ t: 0.02, dur: 1.2, g: 0.12, f: [800, 2600, 500], Q: 1, a: 0.15, d: 1.05, color: 'brown' });
});

def('skeleton_rattle', 0.75, 0.5, (r) => {
  const n = r.rng.int(9, 14);
  for (let i = 0; i < n; i++) {
    const t = r.rng.float(0, 0.55);
    const f = r.rng.float(420, 1500);
    r.tone({ t, f, dur: 0.06, g: r.rng.float(0.1, 0.26), type: 'triangle', a: 0.0006, d: 0.055, bp: f * 1.6, Q: 5 });
    r.nz({ t, dur: 0.025, g: 0.12, type: 'highpass', f: 3200, a: 0.0004, d: 0.02 });
  }
});

def('zombie_moan', 1.25, 0.6, (r) => {
  const v = r.verb(0.9, 3.2, 0.2);
  const o = {
    t: 0, dur: 1.05, g: 0.42, a: 0.16, h: 0.35, d: 0.6,
    f0: [[0, 96], [0.3, 118], [0.65, 104], [1, 84]],
    formants: [[420, 6, 1], [900, 8, 0.5], [2300, 9, 0.1]],
    growl: [5.5, 0.4], breath: 0.16, drive: 0.4,
  };
  r.vox(o);
  r.vox(Object.assign({}, o, { g: 0.2, dest: v }));
});

def('insect_chitter', 0.6, 0.42, (r) => {
  for (let i = 0; i < 14; i++) {
    const t = i * 0.035 + r.rng.float(0, 0.012);
    r.nz({ t, dur: 0.016, g: 0.3, f: r.rng.float(3200, 6200), Q: 12, a: 0.0004, d: 0.013 });
  }
  r.tone({ t: 0.02, f: 2400, f2: 3100, dur: 0.4, g: 0.06, type: 'square', a: 0.02, d: 0.36, bp: 4200, Q: 6 });
});

def('wolf_howl', 1.9, 0.56, (r) => {
  const v = r.verb(1.8, 2.4, 0.32);
  const o = {
    t: 0, dur: 1.7, g: 0.42, a: 0.18, h: 0.8, d: 0.7,
    f0: [[0, 330], [0.18, 480], [0.55, 520], [0.85, 470], [1, 300]],
    formants: [[720, 7, 1], [1450, 9, 0.5], [2900, 10, 0.16]],
    breath: 0.05, drive: 0.3,
  };
  r.vox(o);
  r.vox(Object.assign({}, o, { g: 0.24, dest: v }));
});

def('goblin_yelp', 0.4, 0.6, (r) => {
  r.vox({
    t: 0, dur: 0.28, g: 0.45, a: 0.008, h: 0.06, d: 0.2,
    f0: [[0, 330], [0.3, 640], [1, 420]],
    formants: [[880, 6, 1], [1750, 8, 0.55], [3200, 10, 0.2]],
    drive: 0.6, breath: 0.06,
  });
});

def('golem_step', 0.7, 0.85, (r) => {
  const v = r.verb(0.8, 3, 0.2);
  r.tone({ t: 0, f: 90, f2: 32, dur: 0.32, g: 0.7, type: 'sine', a: 0.002, d: 0.3 });
  r.nz({ t: 0, dur: 0.22, g: 0.42, f: [2600, 400], Q: 0.8, a: 0.001, d: 0.2, color: 'pink' });
  r.nz({ t: 0.01, dur: 0.3, g: 0.16, f: 900, Q: 2, a: 0.003, d: 0.28, dest: v });
  // grit falling off
  for (let i = 0; i < 8; i++) r.nz({ t: r.rng.float(0.05, 0.4), dur: 0.02, g: 0.07, f: r.rng.float(2600, 6000), Q: 9, a: 0.0004, d: 0.017 });
});

def('slime_squelch', 0.6, 0.55, (r) => {
  r.nz({ t: 0, dur: 0.35, g: 0.4, f: [400, 1800, 260], Q: 6, a: 0.02, d: 0.32, color: 'pink' });
  r.tone({ t: 0, f: 240, f2: 90, dur: 0.3, g: 0.3, type: 'triangle', a: 0.02, d: 0.28, lp: [1400, 300], Q: 6 });
  for (let i = 0; i < 4; i++) {
    const t = r.rng.float(0.1, 0.45);
    r.tone({ t, f: r.rng.float(300, 800), f2: r.rng.float(120, 260), dur: 0.07, g: 0.1, type: 'sine', a: 0.002, d: 0.06 });
  }
});

def('monster_die', 1.3, 0.8, (r) => {
  const v = r.verb(1.1, 3, 0.24);
  const o = {
    t: 0, dur: 0.8, g: 0.48, a: 0.02, h: 0.2, d: 0.55,
    f0: [[0, 210], [0.3, 168], [0.7, 96], [1, 58]],
    formants: [[440, 6, 1], [980, 8, 0.5], [2200, 9, 0.12]],
    growl: [11, 0.45], breath: 0.16, drive: 0.7,
  };
  r.vox(o);
  r.vox(Object.assign({}, o, { g: 0.22, dest: v }));
  r.tone({ t: 0.78, f: 110, f2: 40, dur: 0.28, g: 0.45, type: 'sine', a: 0.002, d: 0.26 });
  r.nz({ t: 0.78, dur: 0.3, g: 0.24, f: [1600, 300], Q: 0.8, a: 0.002, d: 0.28 });
});

// -- magic ------------------------------------------------------------------

def('cast_fire', 0.95, 0.8, (r) => {
  const v = r.verb(1.0, 2.8, 0.22);
  r.nz({ t: 0, dur: 0.5, g: 0.42, f: [300, 2600, 900], Q: 1.4, a: 0.16, d: 0.42, color: 'pink' });
  r.tone({ t: 0.14, f: 70, f2: 40, dur: 0.5, g: 0.45, type: 'sine', a: 0.02, d: 0.46 });
  for (let i = 0; i < 16; i++) {
    const t = r.rng.float(0.2, 0.8);
    r.nz({ t, dur: 0.03, g: r.rng.float(0.05, 0.16), f: r.rng.float(1400, 5200), Q: 7, a: 0.0006, d: 0.026 });
  }
  r.nz({ t: 0.16, dur: 0.5, g: 0.14, f: 1800, Q: 1, a: 0.02, d: 0.46, dest: v });
});

def('cast_air', 0.9, 0.62, (r) => {
  r.nz({ t: 0, dur: 0.7, g: 0.45, f: [600, 5200, 1800], Q: 2.4, a: 0.12, d: 0.6 });
  r.tone({ t: 0.05, f: 900, f2: 2600, dur: 0.55, g: 0.14, type: 'sine', a: 0.14, d: 0.5 });
  r.tone({ t: 0.05, f: 1350, f2: 3900, dur: 0.5, g: 0.07, type: 'sine', a: 0.16, d: 0.45 });
});

def('cast_water', 0.95, 0.66, (r) => {
  const v = r.verb(1.0, 3, 0.24);
  r.nz({ t: 0, dur: 0.55, g: 0.36, f: [2800, 700], Q: 1.2, a: 0.06, d: 0.5, color: 'pink' });
  for (let i = 0; i < 14; i++) {
    const t = r.rng.float(0.02, 0.7);
    r.tone({ t, f: r.rng.float(700, 2200), f2: r.rng.float(220, 620), dur: 0.07, g: 0.11, type: 'sine', a: 0.001, d: 0.065, dest: i % 3 === 0 ? v : undefined });
  }
  r.tone({ t: 0.1, f: 160, f2: 70, dur: 0.4, g: 0.22, type: 'sine', a: 0.04, d: 0.36 });
});

def('cast_earth', 1.15, 0.74, (r) => {
  const v = r.verb(1.2, 2.6, 0.24);
  r.tone({ t: 0, f: 62, f2: 34, dur: 0.85, g: 0.6, type: 'sine', a: 0.09, d: 0.78 });
  r.tone({ t: 0, f: 93, f2: 51, dur: 0.7, g: 0.24, type: 'triangle', a: 0.1, d: 0.62 });
  r.nz({ t: 0.02, dur: 0.8, g: 0.34, f: [200, 1100, 300], Q: 1.2, a: 0.1, d: 0.72, color: 'brown' });
  for (let i = 0; i < 12; i++) r.nz({ t: r.rng.float(0.1, 0.85), dur: 0.05, g: r.rng.float(0.06, 0.15), f: r.rng.float(500, 2400), Q: 4, a: 0.001, d: 0.045, dest: v });
});

def('cast_spirit', 1.35, 0.62, (r) => {
  const v = r.verb(1.5, 2.2, 0.4);
  const root = 392; // G4 - open and consonant
  for (const [m, g] of [[1, 0.2], [1.5, 0.15], [2, 0.11], [3, 0.06]]) {
    r.tone({ t: 0, f: root * m, dur: 1.1, g, type: 'sine', a: 0.28, d: 0.9, dest: v });
    r.tone({ t: 0, f: root * m * 1.004, dur: 1.1, g: g * 0.8, type: 'sine', a: 0.3, d: 0.88 });
  }
  r.nz({ t: 0.1, dur: 0.9, g: 0.07, f: [2000, 6000], Q: 2, a: 0.3, d: 0.8 });
});

def('cast_mind', 1.2, 0.6, (r) => {
  const v = r.verb(1.3, 2.4, 0.32);
  // Two close tones beat against each other - unsettling but not sour.
  r.tone({ t: 0, f: 466, dur: 0.95, g: 0.22, type: 'sine', a: 0.24, d: 0.8, dest: v });
  r.tone({ t: 0, f: 473, dur: 0.95, g: 0.22, type: 'sine', a: 0.24, d: 0.8 });
  r.tone({ t: 0.08, f: 699, f2: 933, dur: 0.8, g: 0.12, type: 'sine', a: 0.3, d: 0.7 });
  r.tone({ t: 0.16, f: 1866, dur: 0.6, g: 0.05, type: 'sine', a: 0.25, d: 0.5, dest: v });
});

def('cast_body', 1.0, 0.62, (r) => {
  r.tone({ t: 0, f: 174, dur: 0.7, g: 0.34, type: 'triangle', a: 0.1, d: 0.62, lp: [500, 1600], Q: 3 });
  r.tone({ t: 0, f: 261, dur: 0.7, g: 0.2, type: 'sine', a: 0.12, d: 0.6 });
  // Heartbeat under it.
  r.tone({ t: 0.05, f: 78, f2: 46, dur: 0.16, g: 0.4, type: 'sine', a: 0.006, d: 0.15 });
  r.tone({ t: 0.34, f: 72, f2: 42, dur: 0.2, g: 0.32, type: 'sine', a: 0.006, d: 0.19 });
});

def('cast_light', 1.35, 0.68, (r) => {
  const v = r.verb(1.5, 2.2, 0.38);
  const chord = [523.25, 659.25, 783.99, 1046.5];
  chord.forEach((f, i) => {
    r.bell({ t: i * 0.055, f, dur: 1.0 - i * 0.1, g: 0.2 - i * 0.025, ratio: 2.0, index: 2.4 });
    r.bell({ t: i * 0.055, f: f * 2, dur: 0.8, g: 0.06, ratio: 2.0, index: 2.4, dest: v });
  });
  r.nz({ t: 0, dur: 0.7, g: 0.06, f: [3000, 8000], Q: 1.6, a: 0.25, d: 0.62 });
});

def('cast_dark', 1.4, 0.72, (r) => {
  const v = r.verb(1.5, 2.0, 0.36);
  r.tone({ t: 0, f: 110, f2: 55, dur: 1.05, g: 0.4, type: 'sawtooth', a: 0.14, d: 0.95, lp: [900, 180], Q: 4 });
  r.tone({ t: 0, f: 116.5, f2: 58, dur: 1.05, g: 0.3, type: 'sawtooth', a: 0.16, d: 0.92, lp: [700, 160], Q: 4, dest: v });
  r.nz({ t: 0.05, dur: 0.9, g: 0.18, f: [1600, 300], Q: 1.2, a: 0.16, d: 0.8, color: 'brown' });
  r.tone({ t: 0.2, f: 1046, f2: 523, dur: 0.6, g: 0.05, type: 'sine', a: 0.1, d: 0.55, dest: v });
});

def('spell_fail', 0.5, 0.5, (r) => {
  r.tone({ t: 0, f: 330, f2: 110, dur: 0.36, g: 0.32, type: 'square', a: 0.004, d: 0.34, lp: [1800, 500], Q: 3 });
  r.tone({ t: 0.02, f: 247, f2: 82, dur: 0.34, g: 0.18, type: 'sawtooth', a: 0.004, d: 0.32, lp: 1200 });
  r.nz({ t: 0, dur: 0.1, g: 0.14, f: 1800, Q: 1.4, a: 0.002, d: 0.09 });
});

def('explosion', 1.8, 0.98, (r) => {
  const v = r.verb(1.7, 2.2, 0.34);
  r.nz({ t: 0, dur: 0.06, g: 0.7, type: 'highpass', f: 1800, a: 0.0006, d: 0.05 });
  r.nz({ t: 0, dur: 1.3, g: 0.7, f: [2600, 90], Q: 0.7, a: 0.004, d: 1.2, color: 'brown' });
  r.nz({ t: 0, dur: 0.9, g: 0.3, f: [5000, 800], Q: 0.6, a: 0.002, d: 0.85, color: 'pink' });
  r.tone({ t: 0, f: 130, f2: 26, dur: 0.9, g: 0.75, type: 'sine', a: 0.003, d: 0.85 });
  r.nz({ t: 0, dur: 1.2, g: 0.22, f: 1200, Q: 0.8, a: 0.01, d: 1.1, dest: v });
  for (let i = 0; i < 20; i++) r.nz({ t: r.rng.float(0.05, 1.1), dur: 0.03, g: r.rng.float(0.04, 0.13), f: r.rng.float(900, 4500), Q: 6, a: 0.0008, d: 0.026 });
});

def('lightning_crack', 1.4, 0.95, (r) => {
  const v = r.verb(1.4, 2.0, 0.32);
  r.nz({ t: 0, dur: 0.03, g: 0.9, type: 'highpass', f: 4000, a: 0.0004, d: 0.026 });
  r.nz({ t: 0.002, dur: 0.14, g: 0.55, f: [9000, 1400], Q: 0.7, a: 0.0006, d: 0.13 });
  r.nz({ t: 0.03, dur: 1.1, g: 0.4, f: [700, 70], Q: 0.6, a: 0.02, d: 1.0, color: 'brown' });
  r.nz({ t: 0.02, dur: 0.9, g: 0.18, f: 2200, Q: 0.9, a: 0.005, d: 0.85, dest: v });
  r.tone({ t: 0.02, f: 90, f2: 30, dur: 0.7, g: 0.35, type: 'sine', a: 0.01, d: 0.66 });
});

def('ice_shatter', 1.1, 0.75, (r) => {
  const v = r.verb(1.1, 3, 0.3);
  r.nz({ t: 0, dur: 0.05, g: 0.45, type: 'highpass', f: 3200, a: 0.0005, d: 0.045 });
  for (let i = 0; i < 22; i++) {
    const t = Math.pow(r.rng.float(0, 1), 1.7) * 0.7;
    const f = r.rng.float(1400, 5200);
    r.bell({ t, f, dur: r.rng.float(0.12, 0.4), g: r.rng.float(0.06, 0.17), ratio: r.rng.float(2.6, 4.9), index: 3 });
    if (i % 4 === 0) r.bell({ t, f: f * 1.5, dur: 0.3, g: 0.05, ratio: 3.3, index: 3, dest: v });
  }
  r.tone({ t: 0, f: 190, f2: 80, dur: 0.16, g: 0.24, type: 'sine', a: 0.001, d: 0.15 });
});

def('heal_chime', 1.5, 0.62, (r) => {
  const v = r.verb(1.6, 2.4, 0.4);
  // Major triad rising - unambiguously "good".
  [523.25, 659.25, 783.99].forEach((f, i) => {
    r.bell({ t: i * 0.1, f, dur: 1.15 - i * 0.12, g: 0.22, ratio: 2.0, index: 1.8 });
    r.bell({ t: i * 0.1, f: f * 2, dur: 0.8, g: 0.07, ratio: 2.0, index: 1.8, dest: v });
  });
  r.tone({ t: 0, f: 261.6, dur: 1.0, g: 0.1, type: 'sine', a: 0.2, d: 0.85 });
});

def('buff_shimmer', 1.3, 0.55, (r) => {
  const v = r.verb(1.3, 2.6, 0.36);
  for (let i = 0; i < 12; i++) {
    const t = i * 0.055;
    const f = 523.25 * Math.pow(2, (i * 2) / 12);
    r.bell({ t, f, dur: 0.6, g: 0.12, ratio: 3.0, index: 2, dest: i % 2 ? v : undefined });
  }
  r.nz({ t: 0, dur: 0.9, g: 0.09, f: [1200, 8000], Q: 2, a: 0.4, d: 0.8 });
});

def('teleport', 1.35, 0.72, (r) => {
  const v = r.verb(1.4, 2.4, 0.3);
  r.nz({ t: 0, dur: 0.7, g: 0.35, f: [300, 6000], Q: 3.5, a: 0.1, d: 0.62, color: 'pink' });
  r.tone({ t: 0, f: 130, f2: 2100, dur: 0.65, g: 0.2, type: 'sawtooth', a: 0.08, d: 0.6, lp: [400, 6000], Q: 6 });
  r.tone({ t: 0.55, f: 2600, f2: 260, dur: 0.5, g: 0.16, type: 'sine', a: 0.006, d: 0.48, dest: v });
  r.nz({ t: 0.55, dur: 0.45, g: 0.2, f: [6000, 400], Q: 1.4, a: 0.004, d: 0.42 });
});

def('portal_open', 2.0, 0.8, (r) => {
  const v = r.verb(1.8, 2.0, 0.42);
  r.tone({ t: 0, f: 55, f2: 82.4, dur: 1.6, g: 0.45, type: 'sawtooth', a: 0.5, d: 1.3, lp: [200, 1400], Q: 5 });
  r.tone({ t: 0.1, f: 110, f2: 164.8, dur: 1.4, g: 0.2, type: 'triangle', a: 0.55, d: 1.15, dest: v });
  r.tone({ t: 0.3, f: 329.6, f2: 493.9, dur: 1.2, g: 0.12, type: 'sine', a: 0.6, d: 1.0 });
  r.nz({ t: 0, dur: 1.7, g: 0.2, f: [400, 3600, 1200], Q: 1.6, a: 0.7, d: 1.4, color: 'pink' });
  for (let i = 0; i < 9; i++) r.bell({ t: 0.5 + i * 0.13, f: 523 * Math.pow(2, i / 12), dur: 0.7, g: 0.07, ratio: 2.4, index: 3, dest: v });
});

// -- world ------------------------------------------------------------------

/** Creaking wood: jittered pitch through a tight resonance. */
function creak(r, { t = 0, dur = 0.7, f = 150, g = 0.22, up = true, dest }) {
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const base = up ? f * (1 + u * 1.4) : f * (1.9 - u * 1.1);
    pts.push([u, base * r.rng.float(0.86, 1.16)]);
  }
  r.tone({ t, dur, contour: pts, steps: 96, g, type: 'sawtooth', a: 0.05, d: dur * 0.9, bp: f * 5, Q: 7, dest });
  r.nz({ t, dur, g: g * 0.35, f: f * 9, Q: 5, a: 0.06, d: dur * 0.9, dest });
}

def('door_open', 1.1, 0.6, (r) => {
  const v = r.verb(1.0, 3, 0.2);
  creak(r, { t: 0.02, dur: 0.65, f: 145, g: 0.3 });
  creak(r, { t: 0.05, dur: 0.6, f: 210, g: 0.1, dest: v });
  r.tone({ t: 0.72, f: 120, f2: 55, dur: 0.22, g: 0.4, type: 'sine', a: 0.002, d: 0.21 });
  r.nz({ t: 0.72, dur: 0.2, g: 0.2, f: [1600, 400], Q: 0.9, a: 0.002, d: 0.19 });
});

def('door_close', 0.7, 0.72, (r) => {
  const v = r.verb(0.8, 3.2, 0.18);
  creak(r, { t: 0, dur: 0.28, f: 190, g: 0.16, up: false });
  r.tone({ t: 0.3, f: 140, f2: 48, dur: 0.3, g: 0.65, type: 'sine', a: 0.002, d: 0.28 });
  r.nz({ t: 0.3, dur: 0.24, g: 0.3, f: [2200, 400], Q: 0.8, a: 0.001, d: 0.22 });
  r.nz({ t: 0.3, dur: 0.25, g: 0.12, f: 900, Q: 1.5, a: 0.002, d: 0.23, dest: v });
  // latch
  r.tone({ t: 0.42, f: 900, dur: 0.08, g: 0.12, type: 'triangle', a: 0.0006, d: 0.075, bp: 2400, Q: 6 });
});

def('door_locked', 0.6, 0.62, (r) => {
  for (const t of [0, 0.17]) {
    r.tone({ t, f: 210, f2: 130, dur: 0.11, g: 0.4, type: 'sine', a: 0.001, d: 0.1 });
    r.nz({ t, dur: 0.07, g: 0.3, f: [2600, 700], Q: 1.2, a: 0.0008, d: 0.06 });
    r.bell({ t, f: 620, dur: 0.14, g: 0.1, ratio: 1.9, index: 2 });
  }
});

def('chest_open', 1.3, 0.62, (r) => {
  const v = r.verb(1.2, 2.8, 0.24);
  // latch, lid, then a small treasure sparkle
  r.tone({ t: 0, f: 1100, dur: 0.07, g: 0.22, type: 'triangle', a: 0.0006, d: 0.065, bp: 2600, Q: 7 });
  creak(r, { t: 0.08, dur: 0.5, f: 165, g: 0.24 });
  r.tone({ t: 0.6, f: 130, f2: 70, dur: 0.16, g: 0.25, type: 'sine', a: 0.002, d: 0.15 });
  [784, 988, 1175].forEach((f, i) => r.bell({ t: 0.66 + i * 0.07, f, dur: 0.55, g: 0.13, ratio: 2.4, index: 2.4, dest: i ? v : undefined }));
});

def('lever', 0.5, 0.62, (r) => {
  r.nz({ t: 0, dur: 0.05, g: 0.35, type: 'highpass', f: 2600, a: 0.0005, d: 0.045 });
  r.tone({ t: 0, f: 320, f2: 210, dur: 0.1, g: 0.3, type: 'square', a: 0.001, d: 0.09, lp: 2400 });
  // spring-loaded ratchet
  for (let i = 0; i < 4; i++) r.nz({ t: 0.08 + i * 0.035, dur: 0.02, g: 0.2 - i * 0.03, f: 3400 - i * 400, Q: 9, a: 0.0004, d: 0.017 });
  r.tone({ t: 0.24, f: 180, f2: 120, dur: 0.16, g: 0.34, type: 'sine', a: 0.001, d: 0.15 });
  r.bell({ t: 0.24, f: 540, dur: 0.2, g: 0.1, ratio: 1.7, index: 2 });
});

def('secret_found', 1.7, 0.68, (r) => {
  const v = r.verb(1.7, 2.2, 0.42);
  // A little four-note motif so it reads as a reward, not an alarm.
  [523.25, 622.25, 783.99, 1046.5].forEach((f, i) => {
    r.bell({ t: i * 0.15, f, dur: 1.0, g: 0.2, ratio: 2.0, index: 2 });
    r.bell({ t: i * 0.15, f: f * 2, dur: 0.7, g: 0.06, ratio: 2.0, index: 2, dest: v });
  });
  r.tone({ t: 0, f: 130.8, dur: 1.3, g: 0.12, type: 'sine', a: 0.25, d: 1.05 });
});

def('trap_trigger', 0.8, 0.75, (r) => {
  r.nz({ t: 0, dur: 0.04, g: 0.6, type: 'highpass', f: 2600, a: 0.0004, d: 0.035 });
  // metal spring twang
  r.tone({ t: 0, f: 620, f2: 240, dur: 0.4, g: 0.3, type: 'sawtooth', a: 0.001, d: 0.38, bp: [3000, 700], Q: 8 });
  r.tone({ t: 0.005, f: 1240, f2: 480, dur: 0.25, g: 0.12, type: 'square', a: 0.001, d: 0.24, bp: 2600, Q: 6 });
  r.tone({ t: 0, f: 150, f2: 60, dur: 0.16, g: 0.35, type: 'sine', a: 0.001, d: 0.15 });
});

def('water_splash', 0.9, 0.7, (r) => {
  r.nz({ t: 0, dur: 0.06, g: 0.5, f: [6000, 2000], Q: 0.8, a: 0.0008, d: 0.055 });
  r.nz({ t: 0, dur: 0.6, g: 0.42, f: [3600, 500], Q: 0.7, a: 0.006, d: 0.55, color: 'pink' });
  r.tone({ t: 0, f: 220, f2: 70, dur: 0.2, g: 0.3, type: 'sine', a: 0.002, d: 0.19 });
  for (let i = 0; i < 12; i++) {
    const t = r.rng.float(0.03, 0.65);
    r.tone({ t, f: r.rng.float(800, 2400), f2: r.rng.float(250, 700), dur: 0.06, g: r.rng.float(0.05, 0.13), type: 'sine', a: 0.001, d: 0.055 });
  }
});

def('fire_crackle', 1.6, 0.5, (r) => {
  r.nz({ t: 0, dur: 1.5, g: 0.22, f: [500, 1400, 700], Q: 0.9, a: 0.15, d: 1.3, color: 'brown' });
  for (let i = 0; i < 34; i++) {
    const t = r.rng.float(0.02, 1.45);
    r.nz({ t, dur: 0.03, g: r.rng.float(0.06, 0.22), f: r.rng.float(1200, 5200), Q: 8, a: 0.0006, d: 0.026 });
  }
});

// -- ui ---------------------------------------------------------------------

def('click', 0.10, 0.45, (r) => {
  r.tone({ t: 0, f: 1500, f2: 1100, dur: 0.045, g: 0.42, type: 'square', a: 0.0006, d: 0.04, lp: 3600 });
  r.nz({ t: 0, dur: 0.02, g: 0.2, type: 'highpass', f: 3600, a: 0.0004, d: 0.017 });
});

def('click_soft', 0.10, 0.24, (r) => {
  r.tone({ t: 0, f: 780, f2: 620, dur: 0.05, g: 0.3, type: 'triangle', a: 0.0015, d: 0.045, lp: 2200 });
});

def('page_turn', 0.5, 0.42, (r) => {
  r.nz({ t: 0, dur: 0.2, g: 0.35, f: [1400, 4200, 2400], Q: 1.2, a: 0.02, d: 0.18 });
  r.nz({ t: 0.16, dur: 0.24, g: 0.28, f: [3600, 1200], Q: 1, a: 0.02, d: 0.22 });
  r.nz({ t: 0.3, dur: 0.09, g: 0.14, type: 'highpass', f: 4600, a: 0.004, d: 0.08 });
});

def('coin', 0.7, 0.55, (r) => {
  const v = r.verb(0.7, 3.2, 0.22);
  for (let i = 0; i < 3; i++) {
    const t = i * 0.055 + r.rng.float(0, 0.02);
    const f = r.rng.float(2100, 3300);
    r.bell({ t, f, dur: 0.42, g: 0.17, ratio: 3.9, index: 3.2 });
    r.bell({ t, f: f * 1.47, dur: 0.3, g: 0.07, ratio: 4.3, index: 3, dest: v });
  }
});

def('buy', 0.9, 0.6, (r) => {
  const v = r.verb(0.9, 3, 0.26);
  for (let i = 0; i < 3; i++) {
    const f = r.rng.float(2000, 3200);
    r.bell({ t: i * 0.05, f, dur: 0.35, g: 0.14, ratio: 3.9, index: 3 });
  }
  [523.25, 659.25, 783.99].forEach((f, i) => r.bell({ t: 0.2 + i * 0.08, f, dur: 0.55, g: 0.15, ratio: 2, index: 2, dest: i === 2 ? v : undefined }));
});

def('sell', 0.9, 0.6, (r) => {
  const v = r.verb(0.9, 3, 0.26);
  [783.99, 659.25, 523.25].forEach((f, i) => r.bell({ t: i * 0.08, f, dur: 0.5, g: 0.15, ratio: 2, index: 2, dest: i === 2 ? v : undefined }));
  for (let i = 0; i < 3; i++) r.bell({ t: 0.26 + i * 0.05, f: r.rng.float(2000, 3200), dur: 0.35, g: 0.13, ratio: 3.9, index: 3 });
});

def('error', 0.42, 0.5, (r) => {
  r.tone({ t: 0, f: 160, dur: 0.14, g: 0.34, type: 'square', a: 0.003, d: 0.13, lp: 1200 });
  r.tone({ t: 0.16, f: 120, dur: 0.2, g: 0.34, type: 'square', a: 0.003, d: 0.19, lp: 1000 });
  r.tone({ t: 0, f: 241, dur: 0.34, g: 0.1, type: 'sawtooth', a: 0.004, d: 0.32, lp: 900 });
});

def('level_up', 2.0, 0.82, (r) => {
  const v = r.verb(1.8, 2.2, 0.4);
  // C major fanfare: C E G C, brassy plus bells.
  const notes = [261.63, 329.63, 392.0, 523.25];
  notes.forEach((f, i) => {
    const t = i * 0.13;
    r.tone({ t, f, dur: i === 3 ? 1.0 : 0.24, g: 0.24, type: 'sawtooth', a: 0.02, d: (i === 3 ? 0.95 : 0.22), lp: [900, 3200], Q: 2 });
    r.tone({ t, f: f * 1.005, dur: i === 3 ? 1.0 : 0.24, g: 0.16, type: 'sawtooth', a: 0.025, d: (i === 3 ? 0.95 : 0.22), lp: 2600 });
    r.bell({ t, f: f * 2, dur: 0.9, g: 0.1, ratio: 2, index: 2, dest: v });
  });
  r.tone({ t: 0.39, f: 130.8, dur: 1.4, g: 0.2, type: 'triangle', a: 0.02, d: 1.3, lp: 800 });
  r.nz({ t: 0.39, dur: 0.5, g: 0.06, f: [2000, 7000], Q: 2, a: 0.2, d: 0.45, dest: v });
});

def('quest_complete', 1.6, 0.75, (r) => {
  const v = r.verb(1.6, 2.4, 0.36);
  const notes = [392.0, 523.25, 659.25];
  notes.forEach((f, i) => {
    const t = i * 0.16;
    const long = i === 2;
    r.tone({ t, f, dur: long ? 0.9 : 0.3, g: 0.24, type: 'sawtooth', a: 0.025, d: long ? 0.85 : 0.28, lp: [800, 2800], Q: 2 });
    r.tone({ t, f: f * 0.5, dur: long ? 0.9 : 0.3, g: 0.14, type: 'triangle', a: 0.02, d: long ? 0.85 : 0.28, lp: 1200 });
    r.bell({ t, f: f * 2, dur: 0.8, g: 0.08, ratio: 2, index: 2, dest: v });
  });
});

def('item_pickup', 0.4, 0.5, (r) => {
  r.tone({ t: 0, f: 660, f2: 880, dur: 0.1, g: 0.28, type: 'triangle', a: 0.002, d: 0.09, lp: 3000 });
  r.bell({ t: 0.06, f: 1320, dur: 0.28, g: 0.16, ratio: 2.6, index: 2.4 });
  r.nz({ t: 0, dur: 0.04, g: 0.12, f: 2600, Q: 3, a: 0.001, d: 0.035 });
});

def('gold_pickup', 0.85, 0.62, (r) => {
  const v = r.verb(0.8, 3.2, 0.24);
  for (let i = 0; i < 7; i++) {
    const t = Math.pow(r.rng.float(0, 1), 1.3) * 0.4;
    const f = r.rng.float(1900, 3600);
    r.bell({ t, f, dur: r.rng.float(0.25, 0.5), g: r.rng.float(0.09, 0.18), ratio: r.rng.float(3.4, 4.6), index: 3, dest: i % 3 === 0 ? v : undefined });
  }
});

def('potion_drink', 1.2, 0.6, (r) => {
  // Three glugs of falling pitch then a swallow.
  for (let i = 0; i < 3; i++) {
    const t = i * 0.22;
    r.tone({ t, f: 620 - i * 90, f2: 200 - i * 30, dur: 0.14, g: 0.34, type: 'sine', a: 0.004, d: 0.13, bp: 900, Q: 3 });
    r.nz({ t, dur: 0.12, g: 0.14, f: [1400, 500], Q: 2, a: 0.004, d: 0.11 });
  }
  r.nz({ t: 0.72, dur: 0.28, g: 0.2, f: [700, 220], Q: 3, a: 0.03, d: 0.26, color: 'pink' });
  r.tone({ t: 0.74, f: 190, f2: 95, dur: 0.24, g: 0.2, type: 'sine', a: 0.02, d: 0.22 });
});

def('eat', 0.9, 0.5, (r) => {
  for (let i = 0; i < 4; i++) {
    const t = i * 0.19 + r.rng.float(0, 0.03);
    r.nz({ t, dur: 0.1, g: 0.32, f: [2600, 700], Q: 1.4, a: 0.002, d: 0.09, color: 'pink' });
    for (let k = 0; k < 3; k++) r.nz({ t: t + r.rng.float(0, 0.08), dur: 0.02, g: 0.12, f: r.rng.float(2200, 5000), Q: 8, a: 0.0005, d: 0.017 });
  }
});

def('rest', 1.8, 0.5, (r) => {
  const v = r.verb(1.8, 2.4, 0.4);
  // Warm descending pad - the "time passes" cue.
  [392.0, 311.13, 261.63, 196.0].forEach((f, i) => {
    r.tone({ t: i * 0.12, f, dur: 1.4 - i * 0.1, g: 0.16, type: 'triangle', a: 0.3, d: 1.1, lp: [1600, 500], Q: 2 });
    r.tone({ t: i * 0.12, f: f * 1.004, dur: 1.3, g: 0.1, type: 'sine', a: 0.35, d: 1.0, dest: v });
  });
  r.nz({ t: 0.2, dur: 1.1, g: 0.05, f: [1200, 300], Q: 1.2, a: 0.4, d: 0.95 });
});

def('new_day', 2.2, 0.68, (r) => {
  const v = r.verb(2.0, 2.2, 0.42);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    r.bell({ t: i * 0.12, f, dur: 1.5 - i * 0.1, g: 0.18, ratio: 2, index: 2, dest: i % 2 ? v : undefined });
  });
  // Dawn birds.
  for (let i = 0; i < 7; i++) {
    const t = r.rng.float(0.6, 1.9);
    const f = r.rng.float(2400, 4200);
    r.tone({ t, f, f2: f * r.rng.float(1.2, 1.9), dur: 0.07, g: 0.08, type: 'sine', a: 0.006, d: 0.06, dest: v });
    r.tone({ t: t + 0.09, f: f * 1.1, f2: f * 0.8, dur: 0.06, g: 0.06, type: 'sine', a: 0.006, d: 0.05 });
  }
});

// -- ambience beds ----------------------------------------------------------
// These render `dur` + a crossfade tail which is folded back over the head, so
// they loop with no seam. Discrete events stay away from the edges.

const AMB = { loop: true, xfade: 0.9 };

def('amb_wind', 7.0, 0.34, (r) => {
  const ctx = r.ctx;
  for (let k = 0; k < 3; k++) {
    const pan = mkPan(ctx, [-0.7, 0.1, 0.75][k]) || ctx.createGain();
    pan.connect(r.out);
    const src = ctx.createBufferSource();
    src.buffer = r.noise('brown', 4);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = [320, 620, 1100][k];
    bp.Q.value = [1.2, 1.8, 2.6][k];
    const g = ctx.createGain();
    g.gain.value = 0;
    // Slow gusting - two LFOs at incommensurate rates so it never pulses.
    const base = [0.26, 0.2, 0.13][k];
    g.gain.setValueAtTime(base, 0);
    for (const [rate, depth] of [[0.077 + k * 0.013, 0.5], [0.191 + k * 0.021, 0.3]]) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      const la = ctx.createGain();
      la.gain.value = base * depth;
      lfo.connect(la); la.connect(g.gain);
      const fa = ctx.createGain();
      fa.gain.value = bp.frequency.value * 0.3 * depth;
      lfo.connect(fa); fa.connect(bp.frequency);
      lfo.start(0); lfo.stop(8.2);
    }
    src.connect(bp); bp.connect(g); g.connect(pan);
    src.start(0, r.rng.float(0, 2)); src.stop(8.2);
  }
}, AMB);

def('amb_forest', 7.0, 0.32, (r) => {
  R.amb_wind.build(r);
  const v = r.verb(1.6, 2.6, 0.3);
  // leaf rustle
  for (let i = 0; i < 26; i++) {
    const t = r.rng.float(0.2, 6.6);
    r.nz({ t, dur: r.rng.float(0.15, 0.4), g: r.rng.float(0.05, 0.13), f: [3200, 5600, 3000], Q: 1.4, a: 0.06, d: 0.3 });
  }
  // birds
  for (let i = 0; i < 11; i++) {
    const t = r.rng.float(0.4, 6.0);
    const f = r.rng.float(2200, 4000);
    const n = r.rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      r.tone({ t: t + k * 0.085, f: f * r.rng.float(0.9, 1.15), f2: f * r.rng.float(1.1, 1.8), dur: 0.06, g: 0.09, type: 'sine', a: 0.005, d: 0.05, dest: v });
    }
  }
}, AMB);

def('amb_town', 7.0, 0.34, (r) => {
  const ctx = r.ctx;
  const v = r.verb(1.8, 2.4, 0.26);
  // Distant crowd: band-limited noise slowly amplitude-modulated reads as voices.
  for (let k = 0; k < 2; k++) {
    const src = ctx.createBufferSource();
    src.buffer = r.noise('pink', 4);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 500 + k * 340; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0.16;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.9 + k * 0.7;
    const la = ctx.createGain(); la.gain.value = 0.09;
    lfo.connect(la); la.connect(g.gain);
    const pan = mkPan(ctx, k ? 0.4 : -0.4) || ctx.createGain(); pan.connect(r.out);
    src.connect(bp); bp.connect(g); g.connect(pan);
    src.start(0, r.rng.float(0, 2)); src.stop(8.2);
    lfo.start(0); lfo.stop(8.2);
  }
  // Hammer on an anvil, cart wheels, the odd shout.
  for (let i = 0; i < 8; i++) {
    const t = r.rng.float(0.5, 6.2);
    r.bell({ t, f: r.rng.float(900, 1500), dur: 0.35, g: 0.09, ratio: 2.9, index: 3, dest: v });
    r.nz({ t, dur: 0.03, g: 0.05, type: 'highpass', f: 3000, a: 0.0006, d: 0.026 });
  }
  for (let i = 0; i < 4; i++) {
    r.vox({
      t: r.rng.float(0.6, 5.8), dur: 0.3, g: 0.05, a: 0.03, h: 0.08, d: 0.2,
      f0: [[0, r.rng.float(130, 200)], [1, r.rng.float(100, 160)]],
      formants: [[600, 6, 1], [1300, 8, 0.4]], dest: v,
    });
  }
}, AMB);

def('amb_cave', 7.0, 0.32, (r) => {
  const v = r.verb(2.4, 1.8, 0.5);
  // Sub drone with a slow beat between two near-unison partials.
  r.tone({ t: 0, f: 58, dur: 8.0, g: 0.2, type: 'sine', a: 1.2, d: 6.6, linear: true });
  r.tone({ t: 0, f: 58.7, dur: 8.0, g: 0.16, type: 'sine', a: 1.4, d: 6.4, linear: true });
  r.tone({ t: 0, f: 116, dur: 8.0, g: 0.07, type: 'triangle', a: 1.6, d: 6.2, linear: true, lp: 400 });
  const ctx = r.ctx;
  const src = ctx.createBufferSource();
  src.buffer = r.noise('brown', 4); src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.7;
  const g = ctx.createGain(); g.gain.value = 0.16;
  src.connect(lp); lp.connect(g); g.connect(r.out);
  src.start(0, 0.3); src.stop(8.2);
  // Drips.
  for (let i = 0; i < 9; i++) {
    const t = r.rng.float(0.4, 6.2);
    const f = r.rng.float(900, 2000);
    r.tone({ t, f, f2: f * 0.45, dur: 0.09, g: 0.16, type: 'sine', a: 0.001, d: 0.085, dest: v });
    r.tone({ t, f: f * 2.2, dur: 0.04, g: 0.05, type: 'sine', a: 0.001, d: 0.035 });
  }
}, AMB);

def('amb_sea', 7.0, 0.36, (r) => {
  const ctx = r.ctx;
  // Three overlapping wave swells at different periods.
  for (let k = 0; k < 3; k++) {
    const period = [3.1, 4.3, 5.7][k];
    for (let t = -period * r.rng.float(0, 1); t < 8.0; t += period) {
      if (t < -period) continue;
      r.nz({
        t: Math.max(0, t), dur: period * 0.9, g: [0.24, 0.19, 0.15][k],
        f: [400, 2600, 500], Q: 0.7, a: period * 0.35, d: period * 0.5, color: 'pink',
      });
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = r.noise('brown', 4); src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
  const g = ctx.createGain(); g.gain.value = 0.16;
  src.connect(lp); lp.connect(g); g.connect(r.out);
  src.start(0, 0.7); src.stop(8.2);
  // Gulls.
  const v = r.verb(1.6, 2.4, 0.3);
  for (let i = 0; i < 5; i++) {
    const t = r.rng.float(0.6, 5.8);
    for (let k = 0; k < 3; k++) {
      r.vox({
        t: t + k * 0.16, dur: 0.14, g: 0.07, a: 0.01, h: 0.03, d: 0.1,
        f0: [[0, 900], [0.3, 1500], [1, 1000]],
        formants: [[1800, 8, 1], [3400, 10, 0.4]], drive: 0.5, dest: v,
      });
    }
  }
}, AMB);

def('amb_dungeon', 7.0, 0.32, (r) => {
  const v = r.verb(2.6, 1.6, 0.55);
  r.tone({ t: 0, f: 43.65, dur: 8.0, g: 0.22, type: 'sine', a: 1.4, d: 6.4, linear: true });
  r.tone({ t: 0, f: 65.4, dur: 8.0, g: 0.12, type: 'triangle', a: 1.8, d: 6.0, linear: true, lp: 300 });
  r.tone({ t: 0, f: 87.3, dur: 8.0, g: 0.07, type: 'sine', a: 2.2, d: 5.6, linear: true });
  const ctx = r.ctx;
  const src = ctx.createBufferSource();
  src.buffer = r.noise('brown', 4); src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const g = ctx.createGain(); g.gain.value = 0.14;
  src.connect(lp); lp.connect(g); g.connect(r.out);
  src.start(0, 1.1); src.stop(8.2);
  // Distant chains and something breathing where it shouldn't.
  for (let i = 0; i < 4; i++) {
    const t = r.rng.float(0.6, 5.6);
    for (let k = 0; k < 3; k++) r.bell({ t: t + r.rng.float(0, 0.12), f: r.rng.float(700, 1600), dur: 0.3, g: 0.05, ratio: 3.2, index: 3, dest: v });
  }
  for (let i = 0; i < 3; i++) {
    r.nz({ t: r.rng.float(0.8, 5.4), dur: 0.7, g: 0.06, f: [500, 1200, 400], Q: 2.4, a: 0.3, d: 0.6, dest: v });
  }
}, AMB);

def('amb_rain', 7.0, 0.36, (r) => {
  const ctx = r.ctx;
  for (let k = 0; k < 2; k++) {
    const src = ctx.createBufferSource();
    src.buffer = r.noise('white', 4); src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = k ? 'bandpass' : 'highpass';
    bp.frequency.value = k ? 1400 : 2600;
    bp.Q.value = k ? 0.7 : 0.5;
    const g = ctx.createGain(); g.gain.value = k ? 0.18 : 0.22;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11 + k * 0.07;
    const la = ctx.createGain(); la.gain.value = 0.05;
    lfo.connect(la); la.connect(g.gain);
    const pan = mkPan(ctx, k ? 0.5 : -0.5) || ctx.createGain(); pan.connect(r.out);
    src.connect(bp); bp.connect(g); g.connect(pan);
    src.start(0, r.rng.float(0, 2)); src.stop(8.2);
    lfo.start(0); lfo.stop(8.2);
  }
  // Fat drops on stone.
  for (let i = 0; i < 40; i++) {
    const t = r.rng.float(0.15, 6.6);
    r.nz({ t, dur: 0.03, g: r.rng.float(0.04, 0.11), f: r.rng.float(1400, 4200), Q: 6, a: 0.0006, d: 0.026 });
  }
}, AMB);

def('amb_night', 7.0, 0.3, (r) => {
  const ctx = r.ctx;
  // Soft wind bed.
  const src = ctx.createBufferSource();
  src.buffer = r.noise('brown', 4); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 1.1;
  const g = ctx.createGain(); g.gain.value = 0.16;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.09;
  const la = ctx.createGain(); la.gain.value = 0.07;
  lfo.connect(la); la.connect(g.gain);
  src.connect(bp); bp.connect(g); g.connect(r.out);
  src.start(0, 0.9); src.stop(8.2);
  lfo.start(0); lfo.stop(8.2);
  // Crickets: bursts of fast high chirps, panned around.
  for (let i = 0; i < 22; i++) {
    const t = r.rng.float(0.1, 6.5);
    const f = r.rng.float(4200, 5600);
    const pan = r.side(r.rng.float(-0.85, 0.85));
    const n = r.rng.int(3, 6);
    for (let k = 0; k < n; k++) {
      r.nz({ t: t + k * 0.028, dur: 0.016, g: r.rng.float(0.05, 0.11), f, Q: 22, a: 0.0006, d: 0.013, dest: pan });
    }
  }
  // An owl, twice.
  const v = r.verb(1.8, 2.4, 0.34);
  for (const t of [r.rng.float(1.0, 2.6), r.rng.float(3.6, 5.6)]) {
    for (let k = 0; k < 2; k++) {
      r.tone({ t: t + k * 0.42, f: 420, f2: 360, dur: 0.3, g: 0.09, type: 'sine', a: 0.06, d: 0.26, dest: v });
      r.tone({ t: t + k * 0.42, f: 840, f2: 720, dur: 0.25, g: 0.02, type: 'sine', a: 0.06, d: 0.22 });
    }
  }
}, AMB);

// ---------------------------------------------------------------------------

/** Every sound id, in declaration order. */
export const SFX_IDS = Object.keys(R);

/** Grouped for the preview page / debug UI. */
export const SFX_GROUPS = {
  movement: ['step_grass', 'step_stone', 'step_wood', 'step_water', 'step_snow', 'jump', 'land', 'swim'],
  combat: ['swing_light', 'swing_heavy', 'hit_flesh', 'hit_armor', 'hit_bone', 'hit_stone', 'miss', 'bow_shot', 'arrow_hit', 'block', 'crit', 'death_player', 'party_hurt'],
  monsters: ['growl_small', 'growl_large', 'hiss', 'screech', 'roar_dragon', 'skeleton_rattle', 'zombie_moan', 'insect_chitter', 'wolf_howl', 'goblin_yelp', 'golem_step', 'slime_squelch', 'monster_die'],
  magic: ['cast_fire', 'cast_air', 'cast_water', 'cast_earth', 'cast_spirit', 'cast_mind', 'cast_body', 'cast_light', 'cast_dark', 'spell_fail', 'explosion', 'lightning_crack', 'ice_shatter', 'heal_chime', 'buff_shimmer', 'teleport', 'portal_open'],
  world: ['door_open', 'door_close', 'door_locked', 'chest_open', 'lever', 'secret_found', 'trap_trigger', 'water_splash', 'fire_crackle'],
  ui: ['click', 'click_soft', 'page_turn', 'coin', 'buy', 'sell', 'error', 'level_up', 'quest_complete', 'item_pickup', 'gold_pickup', 'potion_drink', 'eat', 'rest', 'new_day'],
  ambience: ['amb_wind', 'amb_forest', 'amb_town', 'amb_cave', 'amb_sea', 'amb_dungeon', 'amb_rain', 'amb_night'],
};

// Baked inside the gesture handler: only what can fire before the next frame,
// which in practice is whatever the player just tapped.
const HOT = ['click', 'click_soft', 'error', 'item_pickup'];

// Baked immediately afterwards on a timer, so init() returns to the caller at
// once. A cold sound bakes in a few milliseconds anyway - the warm set exists
// to make sure not even that shows up on the first swing.
const WARM = [
  'step_grass', 'step_stone', 'step_wood', 'step_water', 'step_snow', 'jump', 'land',
  'swing_light', 'swing_heavy', 'hit_flesh', 'hit_armor', 'hit_bone', 'miss',
  'party_hurt', 'page_turn', 'coin', 'gold_pickup', 'door_open', 'door_close',
];

const SFX_META = R;

// ---------------------------------------------------------------------------
// Buffer post-processing.
// ---------------------------------------------------------------------------

/** One-pole DC blocker; kills the offset that asymmetric transients leave. */
function dcBlock(data, sr) {
  const rc = 1 - 2 * Math.PI * 12 / sr;
  let x1 = 0, y1 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = x - x1 + rc * y1;
    x1 = x; y1 = y;
    data[i] = y;
  }
}

/**
 * Fold the rendered tail back over the head with an equal-power crossfade so
 * the buffer loops without a seam. Returns a new, shorter buffer.
 */
function foldLoop(ctx, buf, xfade) {
  const sr = buf.sampleRate;
  const xf = Math.floor(xfade * sr);
  const len = buf.length - xf;
  if (len <= xf) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < xf; i++) {
      const t = i / xf;
      const fi = Math.sin(t * Math.PI * 0.5);
      const fo = Math.cos(t * Math.PI * 0.5);
      dst[i] = src[i] * fi + src[len + i] * fo;
    }
  }
  return out;
}

function finish(ctx, buf, spec) {
  const sr = buf.sampleRate;
  for (let c = 0; c < buf.numberOfChannels; c++) dcBlock(buf.getChannelData(c), sr);

  let out = buf;
  if (spec.loop) out = foldLoop(ctx, buf, spec.xfade || 0.8);

  // Normalise to the recipe's mix target - this is both the loudness balance
  // and a hard guarantee that nothing clips.
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
  }
  const target = spec.peak ?? 0.7;
  const k = peak > 1e-6 ? target / peak : 1;
  const fi = spec.loop ? 0 : Math.floor(0.0015 * sr);
  const fo = spec.loop ? 0 : Math.floor(0.006 * sr);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fi; i++) d[i] *= i / fi;
    for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

const MAX_VOICES = 24;

export class Audio {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this._enabled = true;
    this.vol = { master: 0.9, sfx: 1, music: 0.75 };
    this.buffers = new Map();
    this.pending = new Map();
    this.voices = 0;
    this.loops = new Set();
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.ambience = null;
    this._ambHandles = [];
    this.initMs = 0;
    this.ctxMs = 0;
    this.resumeMs = 0;
    this.bakeMs = 0;
    this.refDistance = 700;   // world units - see ARCHITECTURE.md, a tile is 512
    this.maxDistance = 9000;
  }

  /**
   * Build the graph and pre-render the hot sounds. Must be called from inside a
   * user gesture on iOS or the context stays suspended forever.
   */
  async init() {
    if (this.ctx) { await this.resume(); return this.ok; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { this.ok = false; return false; }
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      this.ok = false;
      return false;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master * (this._enabled ? 1 : 0);
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = this.vol.sfx * 0.8;
    this.ambBus.connect(this.master);

    // Music owns its own sub-graph but hangs off our master so one slider moves
    // everything.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.musicBus.connect(this.master);

    this.ok = true;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.ctxMs = now() - t0;
    await this.resume();
    this.resumeMs = now() - t0 - this.ctxMs;
    const tb = now();
    await this._bakeBatch(HOT);
    this.bakeMs = now() - tb;
    this.initMs = now() - t0;

    // Everything else the first minute of play needs, off the critical path.
    const warm = () => { this._bakeBatch(WARM); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 400 });
    else setTimeout(warm, 0);

    if (typeof document !== 'undefined' && !this._visBound) {
      this._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.suspend(); else this.resume();
      });
    }
    return true;
  }

  get enabled() { return this._enabled; }
  setEnabled(v) {
    this._enabled = !!v;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this._enabled ? this.vol.master : 0, t, 0.03);
    }
    if (!this._enabled) this.stopAll();
  }

  setVolume(master, sfx, music) {
    if (master != null) this.vol.master = clamp(master, 0, 1);
    if (sfx != null) this.vol.sfx = clamp(sfx, 0, 1);
    if (music != null) this.vol.music = clamp(music, 0, 1);
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._enabled ? this.vol.master : 0, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.8, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.05);
  }

  // -- rendering ------------------------------------------------------------

  /** Render `id` if we have not already; resolves to the AudioBuffer. */
  _ensure(id) {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    const inflight = this.pending.get(id);
    if (inflight) return inflight;
    const spec = SFX_META[id];
    if (!spec || !this.ok) return Promise.resolve(null);

    const sr = this.ctx.sampleRate;
    const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
    if (!OAC) return Promise.resolve(null);
    const renderDur = spec.dur + (spec.loop ? (spec.xfade || 0.8) : 0);
    const off = new OAC(2, Math.max(64, Math.ceil(renderDur * sr)), sr);
    const bus = off.createGain();
    bus.gain.value = 1;
    // Everything meets a soft clipper before the destination, so a recipe that
    // stacks a few too many layers compresses instead of tearing.
    const ws = off.createWaveShaper();
    ws.curve = SOFT_CLIP;
    bus.connect(ws);
    ws.connect(off.destination);

    const rig = new Rig(off, bus, new Rand(hashStr('mm6sfx:' + id)));
    try { spec.build(rig); } catch (e) { /* a broken recipe must not kill audio */ }

    const p = renderOffline(off).then((buf) => {
      const done = finish(this.ctx, buf, spec);
      this.buffers.set(id, done);
      this.pending.delete(id);
      return done;
    }).catch(() => { this.pending.delete(id); return null; });
    this.pending.set(id, p);
    return p;
  }

  /** Debug/verification hook: force a render and hand back the raw buffer. */
  renderToBuffer(id) { return this._ensure(id); }

  /**
   * Bake several short sounds in a single OfflineAudioContext, laid end to end
   * and sliced apart afterwards.
   *
   * Spinning up an offline context costs far more than the DSP for a 200 ms
   * footstep does, so doing thirteen of them one at a time is most of the init
   * budget. One context for the lot turns that into one fixed cost. Loops and
   * anything long stay on the individual path.
   */
  async _bakeBatch(ids) {
    const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
    if (!OAC || !this.ok) return;
    const todo = ids.filter((id) => SFX_META[id] && !SFX_META[id].loop && !this.buffers.has(id) && !this.pending.has(id));
    if (!todo.length) return;
    const sr = this.ctx.sampleRate;
    const GUARD = 0.15;               // room for a recipe that rings past its slot
    const slots = [];
    let cursor = 0;
    for (const id of todo) {
      slots.push({ id, spec: SFX_META[id], offset: cursor });
      cursor += SFX_META[id].dur + GUARD;
    }
    const off = new OAC(2, Math.ceil(cursor * sr), sr);
    const ws = off.createWaveShaper();
    ws.curve = SOFT_CLIP;
    ws.connect(off.destination);
    for (const slot of slots) {
      const bus = off.createGain();
      bus.gain.value = 1;
      bus.connect(ws);
      const rig = new Rig(off, bus, new Rand(hashStr('mm6sfx:' + slot.id)));
      rig.offset = slot.offset;
      try { slot.spec.build(rig); } catch (e) { /* a broken recipe must not kill audio */ }
    }
    const p = renderOffline(off).then((big) => {
      for (const slot of slots) {
        const n = Math.max(64, Math.ceil(slot.spec.dur * sr));
        const start = Math.floor(slot.offset * sr);
        const cut = this.ctx.createBuffer(big.numberOfChannels, n, sr);
        for (let c = 0; c < big.numberOfChannels; c++) {
          cut.getChannelData(c).set(big.getChannelData(c).subarray(start, start + n));
        }
        this.buffers.set(slot.id, finish(this.ctx, cut, slot.spec));
        this.pending.delete(slot.id);
      }
    }).catch(() => { for (const s of slots) this.pending.delete(s.id); });
    // Anything asking for one of these mid-bake waits on the whole batch.
    for (const slot of slots) this.pending.set(slot.id, p.then(() => this.buffers.get(slot.id) || null));
    return p;
  }

  /**
   * Bake a named set ahead of time. The loading screen should hand this the
   * sounds the region about to load will actually use - ambience beds are the
   * expensive ones (7 s each) and are worth paying for behind a progress bar.
   */
  async prerender(ids, onProgress) {
    const short = ids.filter((id) => SFX_META[id] && !SFX_META[id].loop);
    const long = ids.filter((id) => SFX_META[id] && SFX_META[id].loop);
    let done = 0;
    const total = Math.max(1, short.length + long.length);
    // Batch the one-shots a dozen at a time so the loading bar still moves.
    for (let i = 0; i < short.length; i += 12) {
      const chunk = short.slice(i, i + 12);
      await this._bakeBatch(chunk);
      done += chunk.length;
      if (onProgress) onProgress(done / total);
    }
    // Ambience beds are seven seconds each and get their own render.
    for (const id of long) {
      await this._ensure(id);
      done++;
      if (onProgress) onProgress(done / total);
    }
  }

  /** Render everything. Used by the preview page and the audit tool. */
  prerenderAll(onProgress) { return this.prerender(SFX_IDS.slice(), onProgress); }

  // -- playback -------------------------------------------------------------

  _spawn(buf, opts, bus) {
    const ctx = this.ctx;
    if (this.voices >= MAX_VOICES && !opts.important) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = (opts.rate ?? 1) * (opts.vary === false ? 1 : (0.94 + Math.random() * 0.12));
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const vol = (opts.volume ?? 1) * (opts.vary === false ? 1 : (0.86 + Math.random() * 0.2));
    g.gain.value = vol;
    let node = g;
    if (opts.pan) {
      const p = mkPan(ctx, clamp(opts.pan, -1, 1));
      if (p) { g.connect(p); node = p; }
    }
    node.connect(bus || this.sfxBus);
    src.connect(g);
    const when = ctx.currentTime + (opts.delay || 0);
    src.start(when);
    this.voices++;
    src.onended = () => {
      this.voices--;
      try { src.disconnect(); g.disconnect(); if (node !== g) node.disconnect(); } catch (e) { /* already gone */ }
    };
    return src;
  }

  /**
   * Fire a one-shot. Pitch and level are jittered a little on every call so a
   * run of footsteps or sword swings does not machine-gun.
   */
  play(id, opts = {}) {
    if (!this.ok || !this._enabled) return null;
    if (opts.pos) return this.playAt(id, opts.pos.x, opts.pos.y, opts.pos.z, null, opts);
    const buf = this.buffers.get(id);
    if (buf) return this._spawn(buf, opts, opts.bus);
    // Not baked yet: bake now and fire when it lands (a few ms).
    this._ensure(id).then((b) => { if (b && this._enabled) this._spawn(b, opts, opts.bus); });
    return null;
  }

  /** Distance attenuation plus stereo placement relative to the listener. */
  playAt(id, x, y, z, listener, opts = {}) {
    if (!this.ok || !this._enabled) return null;
    const L = listener || this.listener;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > this.maxDistance) return null;
    // Inverse-ish rolloff, clamped so point-blank sounds do not explode.
    const att = this.refDistance / Math.max(this.refDistance, dist);
    // Rotate into listener space; yaw 0 looks down -Z.
    const c = Math.cos(-L.yaw || 0), s = Math.sin(-L.yaw || 0);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    const horiz = Math.max(1e-3, Math.sqrt(rx * rx + rz * rz));
    const pan = clamp((rx / horiz) * clamp(dist / this.refDistance, 0, 1) * 0.9, -1, 1);
    const o = Object.assign({}, opts);
    o.volume = (opts.volume ?? 1) * att * att;
    o.pan = pan;
    delete o.pos;
    if (o.volume < 0.004) return null;
    const buf = this.buffers.get(id);
    if (buf) return this._spawn(buf, o, o.bus);
    this._ensure(id).then((b) => { if (b && this._enabled) this._spawn(b, o, o.bus); });
    return null;
  }

  /** Looping one-off (torches, waterfalls). Returns a handle. */
  loop(id, opts = {}) {
    const handle = {
      src: null, gain: null, stopped: false,
      stop: (fade = 0.15) => {
        handle.stopped = true;
        this.loops.delete(handle);
        if (!handle.src) return;
        const t = this.ctx.currentTime;
        handle.gain.gain.cancelScheduledValues(t);
        handle.gain.gain.setValueAtTime(handle.gain.gain.value, t);
        handle.gain.gain.linearRampToValueAtTime(0, t + fade);
        try { handle.src.stop(t + fade + 0.02); } catch (e) { /* already stopped */ }
        handle.src = null;
      },
      setVolume: (v, ramp = 0.1) => {
        handle.vol = v;
        if (!handle.gain) return;
        const t = this.ctx.currentTime;
        handle.gain.gain.cancelScheduledValues(t);
        handle.gain.gain.setTargetAtTime(v, t, ramp / 3);
      },
    };
    handle.vol = opts.volume ?? 1;
    if (!this.ok || !this._enabled) return handle;
    this.loops.add(handle);
    this._ensure(id).then((buf) => {
      if (!buf || handle.stopped) return;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = opts.rate ?? 1;
      const g = ctx.createGain();
      g.gain.value = 0;
      let node = g;
      if (opts.pan) {
        const p = mkPan(ctx, clamp(opts.pan, -1, 1));
        if (p) { g.connect(p); node = p; }
      }
      node.connect(opts.bus || this.sfxBus);
      src.connect(g);
      src.start(ctx.currentTime);
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(handle.vol, t + (opts.fadeIn ?? 0.3));
      handle.src = src;
      handle.gain = g;
    });
    return handle;
  }

  /** Crossfade the ambience bed. Pass null to fade out to nothing. */
  setAmbience(id, fade = 1.6) {
    if (this.ambience === id) return;
    this.ambience = id;
    for (const h of this._ambHandles) h.stop(fade);
    this._ambHandles.length = 0;
    if (!id) return;
    const h = this.loop(id, { bus: this.ambBus, volume: 1, fadeIn: fade, rate: 1 });
    this._ambHandles.push(h);
  }

  setListener(pos, yaw) {
    if (pos) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; }
    if (yaw != null) this.listener.yaw = yaw;
  }

  stopAll() {
    for (const h of Array.from(this.loops)) h.stop(0.05);
    this.loops.clear();
    this._ambHandles.length = 0;
    this.ambience = null;
    if (!this.ok) return;
    // One-shots are short; muting the bus for a beat is cheaper than tracking
    // every source.
    const t = this.ctx.currentTime;
    this.sfxBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.setValueAtTime(0, t);
    this.sfxBus.gain.linearRampToValueAtTime(this.vol.sfx, t + 0.12);
  }

  /** Let suspend/resume cascade into the score without the shell wiring it. */
  attachMusic(music) { this.music = music; }

  suspend() {
    if (this.music) this.music.suspend();
    if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend();
  }
  resume() {
    if (!this.ctx) return Promise.resolve();
    const done = this.ctx.state === 'suspended' ? this.ctx.resume().catch(() => {}) : Promise.resolve();
    return done.then(() => { if (this.music) this.music.resume(); });
  }

  get voiceCount() { return this.voices; }
}
