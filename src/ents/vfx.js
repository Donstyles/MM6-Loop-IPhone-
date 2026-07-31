import * as THREE from 'three';
import { getEffectSheet, resolveEffectId } from '../art/vfxart.js';

// ---------------------------------------------------------------------------
// The effect runtime.
//
// MM6 has no particle system. A spell is a sprite that flies in a straight
// line, a sprite that plays once where it lands, and a number that floats up
// off the thing it hit. That is exactly what lives here: a fixed pool of
// effect slots, each of which is one animated billboard, plus a pooled list of
// floating combat text the HUD draws in screen space.
//
// Nothing in update() or render() allocates. The pool is fixed at
// construction, the oldest effect is recycled when it overflows, and every
// vector is stored as loose numbers on the slot rather than as objects.
// ---------------------------------------------------------------------------

const KIND_BURST = 0, KIND_PROJ = 1, KIND_ATTACH = 2, KIND_AMBIENT = 3, KIND_TRAIL = 4;

const MAX_EFFECTS = 256;
const MAX_NUMBERS = 48;
const MAX_SCREEN = 8;

// Bright effects spill a little light onto whatever is next to them.
// [r, g, b, radius] - radius in world units, colour is an additive contribution
// at the emitter's centre.
const LIGHT = {
  fire_bolt: [1.00, 0.48, 0.14, 420],
  fireball: [1.00, 0.50, 0.15, 700],
  fire_burst: [1.00, 0.60, 0.22, 1100],
  flame_pillar: [1.00, 0.45, 0.12, 640],
  immolation_aura: [1.00, 0.42, 0.12, 560],
  meteor: [1.00, 0.46, 0.14, 760],
  armageddon: [1.00, 0.42, 0.16, 2600],
  torch_flame: [1.00, 0.52, 0.18, 480],
  campfire: [1.00, 0.50, 0.16, 800],
  lightning: [0.62, 0.80, 1.00, 900],
  spark_shower: [0.90, 0.86, 0.55, 380],
  spark_hit: [0.95, 0.88, 0.55, 340],
  ice_shard: [0.42, 0.70, 0.90, 300],
  ice_burst: [0.48, 0.74, 0.95, 620],
  frost_cloud: [0.40, 0.62, 0.82, 460],
  heal_glow: [0.95, 0.82, 0.35, 520],
  bless_ring: [0.95, 0.80, 0.32, 560],
  buff_shimmer: [0.70, 0.78, 0.90, 380],
  holy_burst: [1.00, 0.92, 0.62, 1000],
  starburst: [0.95, 0.90, 0.70, 900],
  dark_ray: [0.48, 0.16, 0.62, 460],
  soul_drain: [0.52, 0.20, 0.70, 500],
  mind_blast: [0.72, 0.24, 0.72, 560],
  implosion: [0.70, 0.40, 0.95, 1000],
  portal: [0.55, 0.30, 0.85, 700],
  teleport_swirl: [0.60, 0.78, 0.95, 620],
  wisp_glow: [0.62, 0.74, 0.88, 520],
  poison_cloud: [0.42, 0.62, 0.24, 380],
  acid_splash: [0.46, 0.70, 0.26, 300],
};

// Effects that punch the whole screen. The shell reads these from
// takeScreenEffects() and draws them over the 3D view.
const SCREEN_FLASH = {
  armageddon: { color: [1.0, 0.42, 0.14], amount: 0.85, time: 0.55 },
  implosion: { color: [0.78, 0.52, 1.0], amount: 0.5, time: 0.3 },
  holy_burst: { color: [1.0, 0.94, 0.72], amount: 0.32, time: 0.22 },
};

/** Floating-text styling, by kind. The HUD picks font size off `big`. */
export const DAMAGE_STYLE = {
  damage: { color: '#ffe98a', big: false },
  crit: { color: '#ff9430', big: true },
  heal: { color: '#a8bc62', big: false },
  miss: { color: '#9a9a96', big: false },
  resist: { color: '#9fd6e2', big: false },
};

const NUMBER_RISE = 120;   // world units
const NUMBER_LIFE = 1.1;   // seconds

const _warned = new Set();
const _proj = new THREE.Vector3();

/** Cylinder test against an entity's sprite volume. */
function hitsEntity(e, x, y, z, r) {
  if (!e || !e.pos || e.dead || e.remove) return false;
  const h = e.sizeH || 220;
  const rad = (e.radius || 60) + r;
  const dx = x - e.pos.x, dz = z - e.pos.z;
  if (dx * dx + dz * dz > rad * rad) return false;
  const dy = y - e.pos.y;
  return dy > -r && dy < h + r;
}

class Slot {
  constructor() {
    this.active = false;
    this.kind = KIND_BURST;
    this.id = '';
    this.sheet = null;
    this.seq = 0;
    this.gen = 0;

    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;

    this.age = 0;
    this.life = 0;          // 0 = run until the animation ends
    this.frame = 0;
    this.fps = 12;
    this.frames = 1;
    this.loop = false;

    this.scale = 1;
    this.growth = 0;
    this.rise = 0;
    this.spin = 1;          // animation-rate multiplier
    this.tr = 1; this.tg = 1; this.tb = 1; this.ta = 1;
    this.fade = 0;          // seconds of fade-out at the end of life

    // projectile
    this.speed = 0;
    this.range = 0;
    this.travelled = 0;
    this.gravity = 0;
    this.homing = 0;
    this.target = null;
    this.onHit = null;
    this.impactId = null;
    this.trailId = null;
    this.trailEvery = 0;
    this.trailTimer = 0;
    this.radius = 40;
    this.source = null;

    // attach
    this.entity = null;
    this.offsetY = 0;

    this.lr = 0; this.lg = 0; this.lb = 0; this.lrad = 0;
  }
}

class DamageNumber {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0; this.z = 0;
    this.text = '';
    this.kind = 'damage';
    this.age = 0;
    this.t = 0;        // 0..1 progress, for the HUD's fade
    this.jitter = 0;   // small horizontal drift so stacked hits stay readable
  }
}

export class VFXSystem {
  /** @param {import('./billboard.js').SpriteRenderer} spriteRenderer */
  constructor(spriteRenderer) {
    this.sr = spriteRenderer || null;
    this.pool = new Array(MAX_EFFECTS);
    for (let i = 0; i < MAX_EFFECTS; i++) this.pool[i] = new Slot();
    this.numbers = new Array(MAX_NUMBERS);
    for (let i = 0; i < MAX_NUMBERS; i++) this.numbers[i] = new DamageNumber();

    this._seq = 1;
    this._active = 0;
    this._numOut = [];
    this._textOut = [];
    this._textPool = new Array(MAX_NUMBERS);
    for (let i = 0; i < MAX_NUMBERS; i++) {
      this._textPool[i] = { x: 0, y: 0, text: '', kind: 'damage', alpha: 1, big: false };
    }
    this._screenPool = new Array(MAX_SCREEN);
    for (let i = 0; i < MAX_SCREEN; i++) this._screenPool[i] = { kind: 'flash', r: 1, g: 1, b: 1, amount: 0 };
    this._screen = [];
    this._screenTaken = false;

    // lightAt scratch: the eight strongest nearby emitters.
    this._lightN = 8;
    this._ld = new Float32Array(8);
    this._li = new Int32Array(8);
    this._light = { r: 0, g: 0, b: 0 };

    this._drawn = 0;
  }

  get count() { return this._active; }
  get drawn() { return this._drawn; }

  clear() {
    for (let i = 0; i < MAX_EFFECTS; i++) this.pool[i].active = false;
    for (let i = 0; i < MAX_NUMBERS; i++) this.numbers[i].active = false;
    this._active = 0;
    this._screen.length = 0;
  }

  // --- allocation --------------------------------------------------------

  _alloc() {
    const pool = this.pool;
    let oldest = -1, oldestSeq = Infinity;
    for (let i = 0; i < MAX_EFFECTS; i++) {
      const s = pool[i];
      if (!s.active) { this._active++; return this._reset(s); }
      // Ambient effects are placed deliberately (torches, portals); never
      // recycle one out from under the level just because combat got busy.
      if (s.kind !== KIND_AMBIENT && s.seq < oldestSeq) { oldestSeq = s.seq; oldest = i; }
    }
    if (oldest < 0) return null;
    return this._reset(pool[oldest]);
  }

  _reset(s) {
    s.active = true;
    s.seq = this._seq++;
    s.gen++;
    s.kind = KIND_BURST;
    s.sheet = null;
    s.x = s.y = s.z = 0;
    s.vx = s.vy = s.vz = 0;
    s.age = 0; s.life = 0; s.frame = 0;
    s.scale = 1; s.growth = 0; s.rise = 0; s.spin = 1;
    s.tr = s.tg = s.tb = s.ta = 1;
    s.fade = 0;
    s.speed = 0; s.range = 0; s.travelled = 0; s.gravity = 0; s.homing = 0;
    s.target = null; s.onHit = null; s.impactId = null;
    s.trailId = null; s.trailEvery = 0; s.trailTimer = 0; s.radius = 40; s.source = null;
    s.entity = null; s.offsetY = 0;
    s.lr = s.lg = s.lb = s.lrad = 0;
    return s;
  }

  _bind(s, id) {
    let sheet = getEffectSheet(id);
    if (!sheet) {
      // An unknown tag must not swallow the effect: gameplay hangs off the
      // projectile's onHit, so fall back to a generic hit rather than fail.
      if (!_warned.has(id)) { _warned.add(id); console.warn('vfx: unknown effect id', id); }
      sheet = getEffectSheet('spark_hit');
      id = 'spark_hit';
      if (!sheet) { s.active = false; this._active--; return null; }
    }
    s.id = id;
    s.sheet = sheet;
    s.frames = sheet.frames;
    s.fps = sheet.fps;
    s.loop = sheet.loop;
    const L = LIGHT[id];
    if (L) { s.lr = L[0]; s.lg = L[1]; s.lb = L[2]; s.lrad = L[3]; }
    return s;
  }

  _applyTint(s, tint) {
    if (!tint) return;
    if (typeof tint === 'number') {
      s.tr = ((tint >> 16) & 255) / 255; s.tg = ((tint >> 8) & 255) / 255; s.tb = (tint & 255) / 255;
    } else if (tint.length >= 3) {
      s.tr = tint[0]; s.tg = tint[1]; s.tb = tint[2];
    } else if (tint.r !== undefined) {
      s.tr = tint.r; s.tg = tint.g; s.tb = tint.b;
    }
  }

  // --- spawners ----------------------------------------------------------

  /** One-shot animation centred on a world point. */
  burst(id, x, y, z, opts) {
    const s = this._alloc();
    if (!s || !this._bind(s, id)) return null;
    s.kind = KIND_BURST;
    s.x = x; s.y = y; s.z = z;
    if (opts) {
      s.scale = opts.scale || 1;
      s.growth = opts.growth || 0;
      s.rise = opts.rise || 0;
      s.spin = opts.speed || opts.spin || 1;
      s.life = opts.duration || 0;
      this._applyTint(s, opts.tint);
    }
    // A looping sheet used as a one-shot still has to stop, so give it one pass.
    if (s.loop && !s.life) s.life = s.frames / (s.fps * s.spin);
    this._pushScreenFor(id, opts && opts.scale);
    return s;
  }

  /**
   * A travelling sprite. `from` and `dir` are anything with x/y/z; `dir` need
   * not be normalised. Calls `onHit(pos, target)` where pos is the slot itself
   * (read .x/.y/.z) and target is the entity struck, or null for terrain.
   */
  projectile(id, from, dir, opts) {
    const s = this._alloc();
    if (!s || !this._bind(s, id)) return null;
    const o = opts || {};
    s.kind = KIND_PROJ;
    s.x = from.x; s.y = from.y; s.z = from.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    s.speed = o.speed || 1400;
    s.vx = (dx / len) * s.speed;
    s.vy = (dy / len) * s.speed;
    s.vz = (dz / len) * s.speed;
    s.range = o.range || 6000;
    s.gravity = o.gravity || 0;
    s.homing = o.homing || 0;
    s.target = o.target || null;
    s.onHit = o.onHit || null;
    s.impactId = o.impactId || null;
    s.trailId = o.trail === undefined ? defaultTrail(id) : o.trail;
    s.trailEvery = o.trailEvery || 0.045;
    s.radius = o.radius || 60;
    s.source = o.source || null;
    s.scale = o.scale || 1;
    s.spin = o.speed2 || o.spin || 1;
    s.loop = true;
    this._applyTint(s, o.tint);
    return s;
  }

  /** An effect that rides a moving entity - burning, blessed, poisoned. */
  attach(id, entity, opts) {
    const s = this._alloc();
    if (!s || !this._bind(s, id)) return null;
    const o = opts || {};
    s.kind = KIND_ATTACH;
    s.entity = entity;
    s.offsetY = o.offsetY || 0;
    s.scale = o.scale || 1;
    s.life = o.duration || 0;
    s.spin = o.speed || 1;
    if (o.loop !== undefined) s.loop = o.loop;
    s.fade = o.fade || 0;
    this._applyTint(s, o.tint);
    if (entity && entity.pos) { s.x = entity.pos.x; s.y = entity.pos.y + s.offsetY; s.z = entity.pos.z; }
    return s;
  }

  /** A permanent looping effect pinned to a point. Remove it with stop(). */
  ambient(id, x, y, z, opts) {
    const s = this._alloc();
    if (!s || !this._bind(s, id)) return null;
    const o = opts || {};
    s.kind = KIND_AMBIENT;
    s.x = x; s.y = y; s.z = z;
    s.scale = o.scale || 1;
    s.spin = o.speed || 1;
    s.loop = true;
    // Stagger identical props so a row of torches does not flicker in unison.
    s.age = o.phase !== undefined ? o.phase : (x * 0.013 + z * 0.007) % 4;
    this._applyTint(s, o.tint);
    return s;
  }

  /** Kill an effect returned by any of the spawners. */
  stop(handle) {
    if (!handle || !handle.active) return;
    handle.active = false;
    this._active--;
  }

  /** Floating combat text. `kind` selects colour and size. */
  damageNumber(x, y, z, text, kind) {
    let slot = null, oldest = null;
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const d = this.numbers[i];
      if (!d.active) { slot = d; break; }
      if (!oldest || d.age > oldest.age) oldest = d;
    }
    if (!slot) slot = oldest;
    slot.active = true;
    slot.x = x; slot.y = y; slot.z = z;
    slot.text = String(text);
    slot.kind = DAMAGE_STYLE[kind] ? kind : 'damage';
    slot.age = 0; slot.t = 0;
    slot.jitter = ((this._seq++ * 37) % 40) - 20;
    return slot;
  }

  /**
   * The live floating-text list. Entries carry world x/y/z (already risen),
   * `t` in 0..1 for the fade, and `kind` for DAMAGE_STYLE. The array is reused
   * every frame - read it, do not keep it.
   */
  damageNumbers() {
    const out = this._numOut;
    out.length = 0;
    for (let i = 0; i < MAX_NUMBERS; i++) if (this.numbers[i].active) out.push(this.numbers[i]);
    return out;
  }

  /**
   * Floating combat text projected into the HUD's 2D space.
   * @param {THREE.Camera} camera
   * @param {{x:number,y:number,w:number,h:number}} view the 3D viewport rect
   * @returns {Array<{x,y,text,kind,alpha,big}>} reused array - read it now.
   */
  screenTexts(camera, view) {
    const out = this._textOut;
    out.length = 0;
    if (!camera || !view) return out;
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const d = this.numbers[i];
      if (!d.active) continue;
      _proj.set(d.x, d.y, d.z).project(camera);
      // Behind the camera, or off the sides: nothing to draw.
      if (_proj.z > 1 || _proj.x < -1.3 || _proj.x > 1.3) continue;
      const e = this._textPool[out.length];
      if (!e) break;
      e.x = view.x + (_proj.x * 0.5 + 0.5) * view.w + d.jitter * 0.35;
      e.y = view.y + (-_proj.y * 0.5 + 0.5) * view.h;
      e.text = d.text;
      e.kind = d.kind;
      e.big = DAMAGE_STYLE[d.kind].big;
      // Hold full strength for the first half, then fade out.
      e.alpha = d.t < 0.55 ? 1 : Math.max(0, 1 - (d.t - 0.55) / 0.45);
      out.push(e);
    }
    return out;
  }

  _pushScreenFor(id, scale) {
    const f = SCREEN_FLASH[id];
    if (!f) return;
    if (this._screenTaken) { this._screen.length = 0; this._screenTaken = false; }
    if (this._screen.length >= MAX_SCREEN) return;
    const e = this._screenPool[this._screen.length];
    e.kind = 'flash';
    e.r = f.color[0]; e.g = f.color[1]; e.b = f.color[2];
    e.amount = f.amount * Math.min(1.5, scale || 1);
    e.time = f.time;
    this._screen.push(e);
  }

  /**
   * Screen-space effects queued since the last call (currently full-view
   * flashes). Returns a reused array of pooled objects; read it immediately.
   */
  takeScreenEffects() {
    this._screenTaken = true;
    return this._screen;
  }

  // --- update ------------------------------------------------------------

  update(dt, ctx) {
    const pool = this.pool;
    for (let i = 0; i < MAX_EFFECTS; i++) {
      const s = pool[i];
      if (!s.active) continue;
      s.age += dt;

      const rate = s.fps * s.spin;
      const f = s.age * rate;
      if (s.loop) {
        s.frame = ((f | 0) % s.frames + s.frames) % s.frames;
      } else if (f >= s.frames) {
        s.frame = s.frames - 1;
        if (!s.life) { this.stop(s); continue; }
      } else {
        s.frame = f | 0;
      }
      if (s.life && s.age >= s.life) { this.stop(s); continue; }

      if (s.growth) s.scale += s.growth * dt;

      switch (s.kind) {
        case KIND_BURST:
        case KIND_TRAIL:
          if (s.rise) s.y += s.rise * dt;
          break;
        case KIND_PROJ:
          this._stepProjectile(s, dt, ctx);
          break;
        case KIND_ATTACH: {
          const e = s.entity;
          if (!e || e.remove) { this.stop(s); continue; }
          s.x = e.pos.x; s.y = e.pos.y + s.offsetY; s.z = e.pos.z;
          break;
        }
        default: break;
      }

      if (s.fade && s.life) {
        const left = s.life - s.age;
        if (left < s.fade) {
          const k = Math.max(0, left / s.fade);
          s.ta = k;
        }
      }
    }

    for (let i = 0; i < MAX_NUMBERS; i++) {
      const d = this.numbers[i];
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= NUMBER_LIFE) { d.active = false; continue; }
      d.t = d.age / NUMBER_LIFE;
      // Ease out: the number leaps off the target then drifts.
      d.y += NUMBER_RISE * (1.7 - 1.4 * d.t) / NUMBER_LIFE * dt;
    }
  }

  _stepProjectile(s, dt, ctx) {
    if (s.homing && s.target && s.target.pos && !s.target.remove) {
      const tx = s.target.pos.x - s.x;
      const ty = s.target.pos.y + (s.target.sizeH ? s.target.sizeH * 0.5 : 100) - s.y;
      const tz = s.target.pos.z - s.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const k = Math.min(1, s.homing * dt);
      s.vx += (tx / tl * s.speed - s.vx) * k;
      s.vy += (ty / tl * s.speed - s.vy) * k;
      s.vz += (tz / tl * s.speed - s.vz) * k;
    }
    if (s.gravity) s.vy -= s.gravity * dt;

    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt;
    const step = Math.hypot(nx - s.x, ny - s.y, nz - s.z);
    s.travelled += step;

    let hit = null, hitTerrain = false;
    if (ctx && ctx.hitEntity) hit = ctx.hitEntity(nx, ny, nz, s.radius, s.source);
    else if (s.target) hit = hitsEntity(s.target, nx, ny, nz, s.radius) ? s.target : null;
    else if (ctx && ctx.entities && ctx.entities.list) {
      // No aimed target (a monster's bolt at the party, mostly): sweep the
      // entity list, which is short enough that a linear scan is free.
      const list = ctx.entities.list;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e === s.source || e.dead || e.remove || !e.pos) continue;
        if (hitsEntity(e, nx, ny, nz, s.radius)) { hit = e; break; }
      }
    }
    if (!hit && !s.target && ctx && ctx.player && s.source) {
      // A monster's projectile: the party is the thing it can run into.
      const pp = ctx.player.pos;
      const pr = (ctx.playerRadius || 90) + s.radius;
      const pdx = nx - pp.x, pdz = nz - pp.z, pdy = ny - (pp.y + 160);
      if (pdx * pdx + pdz * pdz <= pr * pr && Math.abs(pdy) < 200) hitTerrain = true;
    }
    if (!hit && ctx) {
      if (ctx.groundAt) {
        const g = ctx.groundAt(nx, nz, ny);
        if (ny <= g + 4) { hitTerrain = true; s.y = g + 4; }
      }
      if (!hitTerrain && ctx.blocked && ctx.blocked(nx, ny, nz, s.radius * 0.4, 1)) hitTerrain = true;
    }

    if (!hit && !hitTerrain) { s.x = nx; s.y = ny; s.z = nz; }
    else { if (!hitTerrain) { s.x = nx; s.y = ny; s.z = nz; } }

    // Trail: a stream of small short-lived sprites behind the head.
    if (s.trailId) {
      s.trailTimer -= dt;
      if (s.trailTimer <= 0) {
        s.trailTimer = s.trailEvery;
        const t = this._alloc();
        if (t && this._bind(t, s.trailId)) {
          t.kind = KIND_TRAIL;
          t.x = s.x - s.vx * dt * 0.5; t.y = s.y - s.vy * dt * 0.5; t.z = s.z - s.vz * dt * 0.5;
          t.scale = s.scale * 0.45;
          t.life = 0.22;
          t.spin = 1.6;
          t.fade = 0.12;
          t.lrad *= 0.4;
        }
      }
    }

    const done = hit || hitTerrain || s.travelled >= s.range;
    if (!done) return;
    if (s.impactId) {
      this.burst(s.impactId, s.x, s.y, s.z, { scale: s.scale, tint: [s.tr, s.tg, s.tb] });
    }
    if (s.onHit) s.onHit(s, hit || null);
    this.stop(s);
  }

  // --- render ------------------------------------------------------------

  render(spriteRenderer, camera, ctx) {
    const sr = spriteRenderer || this.sr;
    if (!sr) return 0;
    const cx = camera ? camera.position.x : 0;
    const cz = camera ? camera.position.z : 0;
    const cy = camera ? camera.position.y : 0;
    const far = (ctx && ctx.drawDistance) || 9000;
    const far2 = far * far;
    let drawn = 0;

    const pool = this.pool;
    for (let i = 0; i < MAX_EFFECTS; i++) {
      const s = pool[i];
      if (!s.active || !s.sheet || s.ta <= 0) continue;
      const dx = s.x - cx, dz = s.z - cz;
      if (dx * dx + dz * dz > far2) continue;

      const sheet = s.sheet;
      let ai = 0;
      if (sheet.angles > 1) {
        // Directional sheets (the arrow) pick their facing from the flight
        // direction as the camera sees it.
        const dirYaw = Math.atan2(s.vx, s.vz);
        const camYaw = Math.atan2(s.x - cx, s.z - cz);
        let rel = dirYaw - camYaw;
        rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        ai = Math.round((rel / (Math.PI * 2)) * sheet.angles) % sheet.angles;
      }
      const uv = sheet.uv('play', s.frame, ai);
      if (!uv) continue;

      const w = sheet.worldW * s.scale;
      const h = sheet.worldH * s.scale;
      const batch = sr.batchFor(sheet.texture);
      // Sprite quads grow upward from their anchor; effects are centred on
      // their point, so drop the anchor by half the height.
      batch.add(s.x, s.y - h * 0.5, s.z, w, h,
        uv[0], uv[1], uv[2], uv[3],
        s.tr, s.tg, s.tb, s.ta, 1);
      drawn++;
    }
    this._drawn = drawn;
    // cy is unused beyond keeping the signature honest for future 3D culling.
    void cy;
    return drawn;
  }

  // --- lighting ----------------------------------------------------------

  /**
   * Additive RGB from nearby effects, for tinting sprites and geometry near a
   * fireball or a torch. Considers only the eight closest emitters so the cost
   * stays flat no matter how busy the fight is.
   */
  lightAt(x, y, z) {
    const out = this._light;
    out.r = 0; out.g = 0; out.b = 0;
    const N = this._lightN, d = this._ld, idx = this._li;
    let found = 0;
    for (let i = 0; i < N; i++) { d[i] = Infinity; idx[i] = -1; }

    const pool = this.pool;
    for (let i = 0; i < MAX_EFFECTS; i++) {
      const s = pool[i];
      if (!s.active || s.lrad <= 0) continue;
      const r = s.lrad * s.scale;
      const dx = s.x - x, dy = s.y - y, dz = s.z - z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > r * r) continue;
      // Keep the N nearest; insertion sort over eight entries is cheaper than
      // any allocation-based approach.
      if (dist2 >= d[N - 1]) continue;
      let k = N - 1;
      while (k > 0 && d[k - 1] > dist2) { d[k] = d[k - 1]; idx[k] = idx[k - 1]; k--; }
      d[k] = dist2; idx[k] = i;
      if (found < N) found++;
    }

    for (let i = 0; i < found; i++) {
      const j = idx[i];
      if (j < 0) continue;
      const s = pool[j];
      const r = s.lrad * s.scale;
      const fall = 1 - Math.sqrt(d[i]) / r;
      // Effects flare up and die away; a burst should not light the room at
      // full strength on its last frame.
      const env = s.loop ? 1 : Math.sin(Math.PI * Math.min(1, (s.frame + 0.5) / s.frames));
      const k = fall * fall * env * s.ta;
      out.r += s.lr * k; out.g += s.lg * k; out.b += s.lb * k;
    }
    if (out.r > 1.5) out.r = 1.5;
    if (out.g > 1.5) out.g = 1.5;
    if (out.b > 1.5) out.b = 1.5;
    return out;
  }
}

// --- spell tag -> effect mapping -------------------------------------------

const DEFAULT_VFX = { cast: 'spark_shower', projectile: null, impact: 'spark_hit' };

// Effects that make sense as something flying through the air. Anything else a
// spell asks for is played where it lands.
const PROJECTILE_IDS = new Set(['fire_bolt', 'fireball', 'meteor', 'ice_shard', 'rock_shard',
  'lightning', 'blades', 'dark_ray', 'acid_splash', 'mind_blast', 'arrow', 'spark_shower',
  'starburst']);

const IMPACT_FOR = {
  fire_bolt: 'fire_burst', fireball: 'fire_burst', meteor: 'fire_burst',
  ice_shard: 'ice_burst', rock_shard: 'earth_burst', lightning: 'spark_hit',
  blades: 'spark_hit', dark_ray: 'soul_drain', acid_splash: 'poison_cloud',
  mind_blast: 'mind_blast', arrow: 'spark_hit', starburst: 'holy_burst',
  spark_shower: 'spark_hit',
};

// Tags whose cast flourish or impact is not simply derived from the tag.
const SPELL_VFX = {
  fire_spike: { cast: 'spark_shower', projectile: 'fire_bolt', impact: 'flame_pillar' },
  inferno: { cast: 'fire_burst', projectile: null, impact: 'flame_pillar' },
  meteor: { cast: 'spark_shower', projectile: 'meteor', impact: 'fire_burst' },
  dragon_breath: { cast: 'fire_burst', projectile: 'fireball', impact: 'fire_burst' },
  ice_blast: { cast: 'spark_shower', projectile: 'ice_shard', impact: 'ice_burst' },
  poison_cloud: { cast: 'spark_shower', projectile: 'acid_splash', impact: 'poison_cloud' },
  toxic_cloud: { cast: 'spark_shower', projectile: null, impact: 'poison_cloud' },
  swarm: { cast: 'spark_shower', projectile: 'poison_cloud', impact: 'poison_cloud' },
  rock_blast: { cast: 'spark_shower', projectile: 'rock_shard', impact: 'earth_burst' },
  death_blossom: { cast: 'spark_shower', projectile: 'rock_shard', impact: 'earth_burst' },
  shrapmetal: { cast: 'spark_shower', projectile: null, impact: 'shrapnel' },
  light_bolt: { cast: 'spark_shower', projectile: 'starburst', impact: 'holy_burst' },
  harm_bolt: { cast: 'dark_ray', projectile: 'dark_ray', impact: 'blood_hit' },
  spirit_lash: { cast: 'dark_ray', projectile: 'dark_ray', impact: 'blood_hit' },
  souldrinker: { cast: 'dark_ray', projectile: null, impact: 'soul_drain' },
  armageddon: { cast: 'fire_burst', projectile: null, impact: 'armageddon' },
  implosion: { cast: 'spark_shower', projectile: null, impact: 'implosion' },
  portal_swirl: { cast: 'teleport_swirl', projectile: null, impact: 'portal' },
  arrow: { cast: null, projectile: 'arrow', impact: 'spark_hit' },
  melee: { cast: null, projectile: null, impact: 'blood_hit' },
  melee_miss: { cast: null, projectile: null, impact: 'dust_puff' },
};

/**
 * Map a spell's `vfx` tag (spells.js VFX_TAGS) to the effect ids for its cast
 * flourish, its flight and its impact. Unknown tags resolve through the art
 * module's alias table, so a new spell always gets something sensible.
 */
export function spellVFX(spellVfxTag) {
  if (!spellVfxTag) return DEFAULT_VFX;
  const explicit = SPELL_VFX[spellVfxTag];
  if (explicit) return explicit;
  const base = resolveEffectId(spellVfxTag);
  if (!base) return DEFAULT_VFX;
  const v = PROJECTILE_IDS.has(base)
    ? { cast: 'spark_shower', projectile: base, impact: IMPACT_FOR[base] || 'spark_hit' }
    : { cast: 'spark_shower', projectile: null, impact: base };
  // Cache so repeated casts do not rebuild the record.
  SPELL_VFX[spellVfxTag] = v;
  return v;
}

/** The small sprite a projectile leaves behind it, by projectile id. */
function defaultTrail(id) {
  switch (id) {
    case 'fire_bolt': case 'fireball': case 'meteor': return 'fire_bolt';
    case 'ice_shard': return 'frost_cloud';
    case 'rock_shard': return 'dust_puff';
    case 'dark_ray': case 'mind_blast': return null;
    case 'arrow': return null;
    default: return null;
  }
}

export { SPELL_VFX };
