import * as THREE from 'three';
import { PlayerController, PLAYER } from './player.js';
import { EntityManager, Entity, CATEGORY } from '../ents/entity.js';
import { SpriteRenderer } from '../ents/billboard.js';
import { MessageLog, Transition } from '../ui/uikit.js';

// ---------------------------------------------------------------------------
// The running game.
//
// Owns the party, the loaded map, every entity in it, the clock and the combat
// state. Maps are supplied through a small adapter interface (see MapAdapter
// below) so this file does not care whether it is standing in an outdoor
// region, a town or a dungeon.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} GameMap
 * @property {THREE.Object3D} group        scene contents
 * @property {(x:number,z:number,y:number)=>number} groundAt
 * @property {(x:number,z:number,y:number)=>number} ceilingAt
 * @property {(x:number,y:number,z:number,r:number,h:number)=>boolean} blocked
 * @property {(x:number,z:number)=>number|null} waterLevelAt
 * @property {(x:number,y:number,z:number)=>{r:number,g:number,b:number}} lightAt
 * @property {{color:THREE.Color, near:number, far:number}} fog
 * @property {boolean} indoor
 * @property {{x:number,y:number,z:number,yaw:number}} start
 */

export const MINUTES_PER_SECOND = 6;      // one real second is six game minutes
export const DAY_MINUTES = 24 * 60;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class GameClock {
  constructor(startMinutes = 9 * 60) {
    this.minutes = startMinutes;   // total elapsed game minutes
    this.paused = false;
  }
  advance(realSeconds) {
    if (!this.paused) this.minutes += realSeconds * MINUTES_PER_SECOND;
  }
  advanceMinutes(m) { this.minutes += m; }
  get timeOfDay() { return (this.minutes % DAY_MINUTES) / DAY_MINUTES; }
  get hour() { return Math.floor((this.minutes % DAY_MINUTES) / 60); }
  get minute() { return Math.floor(this.minutes % 60); }
  get day() { return Math.floor(this.minutes / DAY_MINUTES) % 28 + 1; }
  get month() { return Math.floor(this.minutes / (DAY_MINUTES * 28)) % 12; }
  get year() { return 1165 + Math.floor(this.minutes / (DAY_MINUTES * 28 * 12)); }
  get weekday() { return WEEKDAYS[Math.floor(this.minutes / DAY_MINUTES) % 7]; }
  get isNight() { const h = this.hour; return h < 5 || h >= 21; }
  get isDark() { const h = this.hour; return h < 6 || h >= 20; }
  format() {
    const h24 = this.hour;
    const ampm = h24 < 12 ? 'am' : 'pm';
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${String(this.minute).padStart(2, '0')}${ampm}`;
  }
  formatDate() {
    return `${this.weekday}  ${MONTHS[this.month]} ${this.day}, ${this.year}`;
  }
}

export class Session {
  /**
   * @param {import('../core/engine.js').Engine} engine
   * @param {object} party  from game/party.js
   */
  constructor(engine, party) {
    this.engine = engine;
    this.party = party;
    this.player = new PlayerController();
    this.entities = new EntityManager();
    this.sprites = new SpriteRenderer(engine.scene);
    this.clock = new GameClock(9 * 60);
    this.log = new MessageLog();
    this.transition = new Transition();

    /** @type {GameMap|null} */
    this.map = null;
    this.mapId = null;
    this.mapGroup = new THREE.Group();
    engine.scene.add(this.mapGroup);

    this.turnBased = false;
    this.turnQueue = [];
    this.turnActor = null;
    this.combatants = [];
    this.inCombat = false;

    this.activeChar = 0;
    this.hoverEntity = null;
    this.selectedSpell = null;
    this.pendingCast = null;

    this.vfx = null;      // wired by the shell once VFXSystem exists
    this.audio = null;
    this.music = null;

    this.stats = { drawCalls: 0, tris: 0, sprites: 0, entities: 0 };
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    // Collision facade handed to the player controller and the entity manager.
    this.collision = {
      groundAt: (x, z, y) => (this.map ? this.map.groundAt(x, z, y) : 0),
      ceilingAt: (x, z, y) => (this.map ? this.map.ceilingAt(x, z, y) : Infinity),
      blocked: (x, y, z, r, h) => (this.map ? this.map.blocked(x, y, z, r, h) : false),
      waterLevelAt: (x, z) => (this.map ? this.map.waterLevelAt(x, z) : null),
    };
  }

  // --- map lifecycle -------------------------------------------------------

  /** Swap the loaded map. `map` must satisfy the GameMap shape. */
  setMap(map, id, entry = null) {
    if (this.map && this.map.dispose) this.map.dispose();
    this.mapGroup.clear();
    this.entities.clear();
    this.sprites.begin();
    this.sprites.end();

    this.map = map;
    this.mapId = id;
    if (map.group) this.mapGroup.add(map.group);

    const s = entry || map.start || { x: 0, y: 0, z: 0, yaw: 0 };
    this.player.pos.set(s.x, s.y, s.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = s.yaw || 0;
    this.player.pitch = 0;

    this.applyFog();
    if (map.populate) map.populate(this.entities);
    this.inCombat = false;
    this.turnBased = false;
  }

  /**
   * MM6's day/night is a single greyscale multiply applied identically to the
   * sky, the terrain and every sprite - which is exactly why the world reads as
   * tonally unified despite mixing polygons and billboards. Returns 1.0 at
   * 13:00, 0.373 (#5F5F5F) at dawn and dusk, and 0.153 (#272727) at night.
   */
  /** 1 in full daylight, 0 at night, ramping across the hour either side. */
  sunLevel() {
    const h = this.clock.hour + this.clock.minute / 60;
    if (h >= 6 && h < 20) return 1;
    if (h >= 5 && h < 6) return h - 5;
    if (h >= 20 && h < 21) return 21 - h;
    return 0;
  }

  /**
   * The flat multiply applied to the whole scene. Daytime is left alone - MM6's
   * days are bright and it is distance, not the sun, that greys the world out.
   * Night drops everything to #272727.
   */
  dayTint() {
    return 0.153 + 0.847 * this.sunLevel();
  }

  /**
   * The grey distant geometry fades toward: white at 13:00, #5F5F5F at dawn and
   * dusk, #272727 at night. Distance haze and the sky share this value, which is
   * what keeps the horizon seamless.
   */
  hazeTint() {
    const h = this.clock.hour, m = this.clock.minute;
    if (h < 5 || h >= 21) return 39 / 255;
    const minutes = 60 * (h - 5) + m;              // 0 at 05:00 .. 960 at 21:00
    const v = minutes >= 480 ? 960 - minutes : minutes;
    const maxDim = 20 - (v / 480) * 20;            // 20 at dawn/dusk, 0 at 13:00
    return (255 - Math.min(216, 8 * maxDim)) / 255;
  }

  /** Per-day weather roll: MM6 picks none/light/medium/dense fog per map. */
  fogBands() {
    const day = Math.floor(this.clock.minutes / DAY_MINUTES);
    const roll = (Math.sin(day * 12.9898 + (this.mapId || '').length * 78.233) * 43758.5453) % 1;
    const r = Math.abs(roll);
    if (r < 0.62) return { near: 4096, far: 8192 };   // clear-ish: only a soft horizon
    if (r < 0.88) return { near: 0, far: 4096 };      // medium
    return { near: 0, far: 2048 };                    // dense
  }

  applyFog() {
    if (!this.map) return;
    const scene = this.engine.scene;
    const indoor = this.map.indoor;
    const k = indoor ? 1 : this.hazeTint();

    // Haze is the same grey the sky is drawn at, so geometry dissolves into the
    // horizon instead of fogging toward a separate colour.
    const c = indoor
      ? this.map.fog.color.clone()
      : new THREE.Color(k, k, k);

    let near = this.map.fog.near, far = this.map.fog.far;
    if (!indoor) {
      const b = this.fogBands();
      near = b.near; far = Math.min(b.far, 8192);
    }

    if (!scene.fog) scene.fog = new THREE.Fog(c.getHex(), near, far);
    scene.fog.color.copy(c);
    scene.fog.near = near;
    scene.fog.far = far;
    this.sprites.setFog(c, near, far);
    // Pass 1.0 for the light multiplier: the terrain already bakes time of day
    // into its vertex colours and the post pass applies the global day/night
    // tint, so handing the haze value down here as well darkened the world
    // three times over.
    if (this.map.setFogColor) this.map.setFogColor(c, 1);
    this.engine.setIndoor(indoor);
  }

  /** Retained for callers that want a simple 0..1 darkness value. */
  nightFactor() { return 1 - this.dayTint(); }

  // --- frame ---------------------------------------------------------------

  update(dt, input) {
    this.transition.update(dt);
    if (this.transition.busy && this.transition.phase === 'out') dt = 0;

    this.clock.advance(dt);
    this.log.update(dt);

    // Look
    const look = input.takeLook();
    this.player.yaw -= look.x;
    this.player.pitch -= look.y;
    if (input.down('lookUp')) this.player.pitch += 1.6 * dt;
    if (input.down('lookDown')) this.player.pitch -= 1.6 * dt;
    if (input.pressed('centerView')) this.player.pitch = 0;

    // Move
    const axes = input.axes();
    const moving = this.player.update(dt, axes, this.collision, {
      run: input.down('run'),
      jump: input.pressed('jump'),
      indoor: this.map ? this.map.indoor : false,
    });
    this.player.applyTo(this.engine.camera);

    if (moving && this.audio) this.footsteps(dt);

    // Entities. In turn-based mode their AI is driven by the turn manager, so
    // they only tick their animations here.
    const ectx = this.entityCtx(dt);
    ectx.frozen = this.turnBased;
    this.entities.update(dt, ectx);
    this.updateTurns(dt);
    if (this.vfx) this.vfx.update(dt, ectx);

    this.updateCombatState();
    this.applyFog();
    this.updateTint();

    this.hoverEntity = this.pickEntity(input.pointer);
  }

  entityCtx(dt) {
    if (!this._ectx) {
      this._ectx = {
        player: this.player,
        playerRadius: PLAYER.radius,
        dt: 0,
        simRange: 9000,
        drawDistance: 7000,
        blocked: this.collision.blocked,
        groundAt: this.collision.groundAt,
        canSee: (a, b) => this.canSee(a, b),
        lightAt: (x, y, z) => this.lightAt(x, y, z),
        onMonsterAttack: (e) => this.monsterAttack(e),
        onMonsterRanged: (e) => this.monsterRanged(e),
        onAggro: (e) => this.onAggro(e),
      };
    }
    this._ectx.dt = dt;
    this._ectx.drawDistance = this.map ? this.map.fog.far : 7000;
    return this._ectx;
  }

  lightAt(x, y, z) {
    const base = this.map && this.map.lightAt ? this.map.lightAt(x, y, z) : { r: 1, g: 1, b: 1 };
    if (this.vfx && this.vfx.lightAt) {
      const l = this.vfx.lightAt(x, y, z);
      return { r: base.r + l.r, g: base.g + l.g, b: base.b + l.b };
    }
    return base;
  }

  /** Cheap line of sight: step along the segment testing the collision volume. */
  canSee(a, b) {
    if (!this.map || !this.map.blocked) return true;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.min(24, Math.max(2, Math.floor(dist / 220)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.map.blocked(a.x + dx * t, a.y + dy * t + 80, a.z + dz * t, 12, 20)) return false;
    }
    return true;
  }

  updateTint() {
    // Pure grey, never a blue "movie night" wash - MM6 multiplies all three
    // channels by the same value, which is why its nights look washed-out dark
    // rather than moonlit.
    const k = this.map && this.map.indoor ? 1 : this.dayTint();
    this.engine.setTint(k, k, k);
    this.engine.setFade(this.transition.alpha);
  }

  render() {
    const sr = this.sprites;
    sr.begin();
    const ctx = this.entityCtx(0);
    this.stats.sprites = this.entities.render(sr, this.engine.camera, ctx);
    if (this.vfx) this.vfx.render(sr, this.engine.camera, ctx);
    sr.end();
    this.stats.entities = this.entities.list.length;
  }

  // --- interaction ---------------------------------------------------------

  /** The entity the crosshair/pointer is over, within reach for interaction. */
  pickEntity(pointer) {
    if (!this.map) return null;
    const cam = this.engine.camera;
    const dir = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bestT = Infinity;
    const origin = cam.position;
    for (const e of this.entities.list) {
      if (!e.visible || !e.sheet) continue;
      const dx = e.pos.x - origin.x, dy = (e.pos.y + e.sizeH * 0.5) - origin.y, dz = e.pos.z - origin.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t <= 0 || t > 4500) continue;
      const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
      const rad = Math.max(e.sizeW, e.sizeH) * 0.42;
      if (px * px + py * py + pz * pz < rad * rad && t < bestT) { bestT = t; best = e; }
    }
    return best;
  }

  /** Space / tap: open a door, talk to an NPC, loot a chest, pick up an item. */
  activate() {
    const e = this.hoverEntity || this.entities.nearest(
      this.player.pos.x, this.player.pos.z, 700,
      (x) => x.interact || x.category === CATEGORY.ITEM || x.category === CATEGORY.NPC,
    );
    if (!e) return null;
    const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
    if (d > 900) return null;
    return { entity: e, kind: e.interact ? e.interact.kind : e.category };
  }

  // --- combat hooks (wired to game/combat.js by the shell) ------------------

  onAggro(e) {
    this.inCombat = true;
    if (this.audio) this.audio.play('growl_small', { pos: e.pos });
  }

  updateCombatState() {
    let n = 0;
    const px = this.player.pos.x, pz = this.player.pos.z;
    for (const e of this.entities.list) {
      if (e.category !== CATEGORY.MONSTER || e.dead) continue;
      if (e.state === 'chase' || e.state === 'flee') {
        const d = Math.hypot(e.pos.x - px, e.pos.z - pz);
        if (d < 4000) n++;
      }
    }
    const was = this.inCombat;
    this.inCombat = n > 0;
    if (was !== this.inCombat && this.music) {
      this.music.setIntensity(this.inCombat ? 1 : 0);
    }
    if (!this.inCombat && this.turnBased) this.turnBased = false;
  }

  monsterAttack(e) { if (this.onMonsterAttackCb) this.onMonsterAttackCb(e); }
  monsterRanged(e) { if (this.onMonsterRangedCb) this.onMonsterRangedCb(e); }

  // --- turn-based mode -----------------------------------------------------
  //
  // MM6 lets you drop combat into turns at any moment. The world stops, the
  // party spends action points, and then every monster in range acts once
  // behind an hourglass before control comes back.

  toggleTurnBased() {
    if (this.turnBased) this.leaveTurnBased();
    else this.enterTurnBased();
    return this.turnBased;
  }

  enterTurnBased() {
    this.turnBased = true;
    this.turnActor = 'party';
    this.turnPoints = 130;
    this.rebuildTurnQueue();
    this.message('Turn-based mode.');
    if (this.audio) this.audio.play('click');
  }

  leaveTurnBased() {
    this.turnBased = false;
    this.turnActor = null;
    this.turnQueue.length = 0;
    this.message('Real-time mode.');
    if (this.audio) this.audio.play('click');
  }

  rebuildTurnQueue() {
    const members = (this.party && this.party.members) || [];
    this.turnQueue = members
      .map((ch, i) => ({ i, ch }))
      .filter(({ ch }) => ch.hp > 0 && ch.recovery <= 0)
      .sort((a, b) => (b.ch.stats?.speed || 0) - (a.ch.stats?.speed || 0))
      .map(({ i }) => i);
    if (this.turnQueue.length) this.activeChar = this.turnQueue[0];
  }

  /** Called after a character spends their action. */
  consumeTurn(charIndex, cost = 26) {
    if (!this.turnBased) return;
    this.turnPoints = Math.max(0, this.turnPoints - cost);
    const at = this.turnQueue.indexOf(charIndex);
    if (at >= 0) this.turnQueue.splice(at, 1);
    if (this.turnQueue.length === 0 || this.turnPoints <= 0) this.beginMonsterTurn();
    else this.activeChar = this.turnQueue[0];
  }

  beginMonsterTurn() {
    this.turnActor = 'monsters';
    this._monsterTurnT = 0;
    this._monsterActed = new Set();
  }

  updateTurns(dt) {
    if (!this.turnBased || this.turnActor !== 'monsters') return;
    this._monsterTurnT += dt;

    // Monsters act in sequence with a short beat between them so you can see
    // what hit you, then control returns to the party.
    const live = this.entities.list.filter(
      (e) => e.category === 'monster' && !e.dead && e.state === 'chase',
    );
    const step = 0.35;
    const idx = Math.floor(this._monsterTurnT / step);
    if (idx < live.length) {
      const e = live[idx];
      if (!this._monsterActed.has(e.id)) {
        this._monsterActed.add(e.id);
        this.takeMonsterTurn(e);
      }
      return;
    }
    if (this._monsterTurnT > live.length * step + 0.2) {
      // Recovery ticks once per round, then the party acts again.
      for (const ch of (this.party.members || [])) {
        if (ch.recovery > 0) ch.recovery = Math.max(0, ch.recovery - 1.0);
      }
      this.turnActor = 'party';
      this.turnPoints = 130;
      this.rebuildTurnQueue();
      if (!this.turnQueue.length) this.beginMonsterTurn();
    }
  }

  takeMonsterTurn(e) {
    const px = this.player.pos.x, pz = this.player.pos.z;
    const dist = Math.hypot(e.pos.x - px, e.pos.z - pz);
    const reach = (e.data?.reach || 260) + 90;
    e.yaw = Math.atan2(px - e.pos.x, pz - e.pos.z) + Math.PI;

    if (dist <= reach) {
      e.setAction('attack');
      this.monsterAttack(e);
    } else if (e.data?.ranged && dist < (e.data.ranged.range || 3000)) {
      e.setAction('attack_ranged', true);
      this.monsterRanged(e);
    } else {
      // One turn buys one step of movement.
      const stepLen = Math.min(dist - reach, (e.speed || 260) * 0.9);
      const nx = e.pos.x + ((px - e.pos.x) / dist) * stepLen;
      const nz = e.pos.z + ((pz - e.pos.z) / dist) * stepLen;
      if (!this.map.blocked(nx, e.pos.y, nz, e.radius, 100)) {
        e.pos.x = nx; e.pos.z = nz;
        e.pos.y = this.map.groundAt(nx, nz, e.pos.y);
      }
      e.setAction('walk');
    }
  }

  footsteps(dt) {
    this._stepT = (this._stepT || 0) + dt * (this.player.vel.length() / 500);
    if (this._stepT > 0.62) {
      this._stepT = 0;
      const surf = this.map && this.map.surfaceAt
        ? this.map.surfaceAt(this.player.pos.x, this.player.pos.z)
        : 'grass';
      this.audio.play(`step_${surf}`, { volume: 0.35, rate: 0.9 + Math.random() * 0.2 });
    }
  }

  message(text, color) { this.log.add(text, color); }
}
