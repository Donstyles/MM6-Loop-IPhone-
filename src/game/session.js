import * as THREE from 'three';
import { PlayerController, PLAYER } from './player.js';
import { EntityManager, Entity, CATEGORY } from '../ents/entity.js';
import { SpriteRenderer } from '../ents/billboard.js';
import { MessageLog, Transition } from '../ui/uikit.js';
import { Rand, hashStr } from '../core/rng.js';

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

/** Shortest signed distance between two angles. */
function angleDelta(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Trees within `r` of a point. Gathered from every source that plants one -
 * the region's flora plan and each town's own ring of trunks - because none of
 * them has a collider and so none of them is visible to `map.blocked`.
 */
function nearbyTrees(map, p, r) {
  const region = map.region;
  if (!region) return [];
  const out = [];
  const r2 = r * r;
  const take = (f, h) => {
    if (!f || h < 260) return;                       // only things that block a view
    const dx = f.x - p.x, dz = f.z - p.z;
    if (dx * dx + dz * dz <= r2) out.push(f);
  };
  for (const f of region.floraPlan || region.flora || []) take(f, f.height || 0);
  for (const t of region.towns || []) {
    for (const f of t.treeSpots || []) take(f, f.h || 0);
  }
  return out;
}

/**
 * The meshes worth raycasting against when deciding which way to look: solid
 * world geometry only. Billboard batches carry a map-sized bounding sphere and
 * would report a hit from anywhere, and the terrain itself is handled by the
 * ground-climb term, so both are left out.
 */
function viewBlockers(map) {
  const out = [];
  if (!map.group) return out;
  map.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (o.frustumCulled === false) return;           // self-culling sprite field
    if (o.isInstancedMesh) return;
    if (/terrain|water|sky|flora|tree/i.test(o.name || '')) return;
    out.push(o);
  });
  return out;
}

/**
 * How much a heading is spoiled by trunks standing in it. A trunk 400 units
 * ahead and dead centre fills the window; one off to the side or far away
 * hardly matters, so the penalty falls off with both distance and how far off
 * the axis it sits.
 */
function treePenalty(trees, p, fx, fz) {
  let worst = 0;
  for (const t of trees) {
    const dx = t.x - p.x, dz = t.z - p.z;
    const along = dx * fx + dz * fz;
    if (along < 60 || along > 2400) continue;
    const side = Math.abs(dx * -fz + dz * fx);
    if (side > 420) continue;
    worst = Math.max(worst, (2400 - along) * (1 - side / 420));
  }
  return worst;
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

    // World bookkeeping the save system and the quest pipeline hang off.
    this.worldSeed = null;        // captured when the spawner populates a region
    this.mapMeta = null;          // {kind:'region'|'dungeon', id, spec, back}
    this.shops = this.shops || {};// shop.js keeps per-shop stock states here
    this.questPool = null;        // generated quests on offer, per region
    this.escort = null;           // {entity, quest} while an escort follows

    this._accMin = 0;             // fractional game minutes not yet ticked
    this._combatLinger = 0;
    this._victoryT = 0;
    this._partyIdleT = 0;
    this._boundsMsgT = 0;
    this._wasGround = true;

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
    const spot = this.findClearSpot(map, s);
    this.player.pos.set(spot.x, spot.y, spot.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = spot.yaw;
    this.player.pitch = 0;

    this.applyFog();
    if (map.populate) map.populate(this.entities);
    this.inCombat = false;
    this.turnBased = false;
    this._combatLinger = 0;
    this._spawnGroups = [];
    this.escort = null;
    // Enough for a fresh save even if nothing enriches it: the transition glue
    // overwrites this with the full descriptor when it drives a map change.
    this.mapMeta = {
      kind: map.indoor ? 'dungeon' : 'region',
      id,
      seed: this.worldSeed ?? null,
      spec: (map.dungeon && map.dungeon.spec) || null,
      back: map.indoor ? (this._dungeonBack || null) : null,
    };
  }

  /**
   * A map's nominal entry point can land inside a wall or nose-first against a
   * building, so spiral outwards for somewhere the party actually fits, and
   * turn to face whichever direction has the most open ground.
   */
  findClearSpot(map, s) {
    const R = PLAYER.radius, H = PLAYER.height;
    const at = (x, z) => ({ x, y: map.groundAt(x, z, s.y ?? 0), z });
    const free = (p) => !map.blocked(p.x, p.y + 8, p.z, R, H);

    let best = at(s.x, s.z);
    if (!free(best)) {
      outer:
      for (let ring = 1; ring <= 12; ring++) {
        const r = ring * 140;
        for (let i = 0; i < ring * 8; i++) {
          const a = (i / (ring * 8)) * Math.PI * 2;
          const p = at(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r);
          if (free(p)) { best = p; break outer; }
        }
      }
    }

    // Face the most interesting direction: sample sixteen headings and score
    // each by how far it stays unobstructed, penalised by how steeply the
    // ground climbs along it - otherwise the party opens the game nose-first
    // against a hillside, which is technically "open" but shows nothing.
    //
    // Trees are billboards with no collider, so `blocked` walks straight past a
    // trunk that fills the whole window. Score them separately from the flora
    // plan, and give the map's own suggested heading a head start: a region
    // that aimed the party at its town knows better than a ray cast does.
    const trees = nearbyTrees(map, best, 3000);
    const eye = new THREE.Vector3(best.x, best.y + PLAYER.eyeHeight, best.z);
    const ray = new THREE.Raycaster();
    ray.far = 2400;
    const solids = viewBlockers(map);
    let yaw = s.yaw || 0, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const fx = -Math.sin(a), fz = -Math.cos(a);
      let open = 0, climb = 0;
      for (let d = 120; d <= 2400; d += 120) {
        const px = best.x + fx * d, pz = best.z + fz * d;
        if (map.blocked(px, best.y + 60, pz, R, H)) break;
        open = d;
        climb = Math.max(climb, map.groundAt(px, pz, best.y) - best.y);
      }
      // The collider grid is a coarse box list and misses plenty of what the
      // eye sees - a chimney, a monument, an upper storey. Cast at eye height
      // against the real geometry as well and take the shorter of the two, so
      // "open" means open to look at, not merely open to walk into.
      if (solids.length) {
        ray.set(eye, new THREE.Vector3(fx, 0, fz));
        const hit = ray.intersectObjects(solids, false)[0];
        if (hit) open = Math.min(open, hit.distance);
      }
      let score = open - climb * 2.5 - treePenalty(trees, best, fx, fz);
      // A nudge, not an override: a region that aimed the party at its town
      // knows more than a ray cast does, but not enough to justify opening the
      // game nose-first against a wall.
      if (s.yaw !== undefined && Math.abs(angleDelta(a, s.yaw)) < Math.PI / 8) score += 300;
      if (score > bestScore) { bestScore = score; yaw = a; }
    }
    return { ...best, yaw };
  }

  /** 1 in full daylight, 0 at night, ramping across the hour either side. */
  sunLevel() {
    const h = this.clock.hour + this.clock.minute / 60;
    if (h >= 6 && h < 20) return 1;
    if (h >= 5 && h < 6) return h - 5;
    if (h >= 20 && h < 21) return 21 - h;
    return 0;
  }

  /**
   * The flat multiply applied to the whole scene - and it is the *same* value
   * the sky and the distance haze take, which is the single thing that makes
   * MM6 read as one image rather than as sprites pasted onto terrain.
   *
   * This used to hold a flat 1.0 from 06:00 to 20:00 and then fall off a cliff.
   * The sky baked its own hour, so at 19:45 the sky was evening and everything
   * under it was still full noon: trees brighter than the meadow they stood in.
   */
  dayTint() {
    return this.hazeTint();
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

    // Haze is the region's own horizon colour, dimmed by the hour - not a flat
    // grey. hazeTint() is a *dimming level*, and using it as a colour made the
    // fog pure white at midday, so distant hills and treelines bleached out
    // into a pale ghost instead of dissolving into the skyline.
    const c = this.map.fog.color.clone();
    if (!indoor) c.multiplyScalar(k);

    let near = this.map.fog.near, far = this.map.fog.far;
    if (!indoor) {
      const b = this.fogBands();
      near = b.near;
      // MM6 caps haze at 84.7% on geometry, so the furthest thing you can see
      // is still a shape and not the sky colour. three's linear fog has no cap,
      // so push the far plane past the view distance until the mix at the far
      // clip works out to that ceiling.
      far = Math.min(b.far, 8192);
      far = near + (far - near) / 0.847;
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

  /**
   * Terrain light is baked into vertex colours, so the map has to be told when
   * the hour has moved far enough to be worth re-baking. Without this the sky
   * changes through the day while the ground does not, and the two come apart.
   */
  syncTimeOfDay() {
    if (!this.map || !this.map.setTimeOfDay) return;
    const h = this.clock.hour + this.clock.minute / 60;
    if (this._bakedHour !== undefined && Math.abs(h - this._bakedHour) < 0.25) return;
    this._bakedHour = h;
    try { this.map.setTimeOfDay(h); } catch (e) { /* a map may not support it */ }
  }

  /** Retained for callers that want a simple 0..1 darkness value. */
  nightFactor() { return 1 - this.dayTint(); }

  // --- frame ---------------------------------------------------------------

  update(dt, input) {
    this.transition.update(dt);
    if (this.transition.busy && this.transition.phase === 'out') dt = 0;

    this.advanceGameTime(dt);
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
    const wantJump = input.pressed('jump');
    const prevVy = this.player.vel.y;
    const wasGround = this.player.onGround;
    const moving = this.player.update(dt, axes, this.collision, {
      run: input.down('run'),
      jump: wantJump,
      indoor: this.map ? this.map.indoor : false,
    });
    this.clampToBounds(dt);
    this.player.applyTo(this.engine.camera);

    if (this.audio) {
      if (wantJump && wasGround && !this.player.onGround) this.audio.play('jump', { volume: 0.5 });
      else if (!wasGround && this.player.onGround && prevVy < -420) {
        this.audio.play('land', { volume: Math.min(0.9, -prevVy / 1400) });
      }
    }

    if (moving && this.audio) this.footsteps(dt);

    // Entities. In turn-based mode their AI is driven by the turn manager, so
    // they only tick their animations here.
    const ectx = this.entityCtx(dt);
    ectx.frozen = this.turnBased;
    this.entities.update(dt, ectx);
    this.updateTurns(dt);
    if (this.vfx) this.vfx.update(dt, ectx);

    // Let the map cull its own batched content against the camera and advance
    // its sky. Hours, not the 0-1 fraction, since that is what it bakes against.
    if (this.map && this.map.update) {
      this.map.update(this.engine.camera, dt, this.clock.hour + this.clock.minute / 60,
        this.torchPower());
    }

    this.updateCombatState(dt);
    this.updateEscort(dt);
    this.syncTimeOfDay();
    this.applyFog();
    this.updateTint();

    // Victory sting hands the deck back to the map's own track.
    if (this._victoryT > 0) {
      this._victoryT -= dt;
      if (this._victoryT <= 0 && this.music && !this.inCombat) {
        this.music.play(this.musicTrack || 'field');
      }
    }

    // Dead outdoor packs come back with the new day, MM6's respawn rhythm.
    const day = Math.floor(this.clock.minutes / DAY_MINUTES);
    if (this._respawnDay === undefined) this._respawnDay = day;
    if (day !== this._respawnDay) { this._respawnDay = day; this.respawnMonsters(); }

    this.hoverEntity = this.pickEntity(input.pointer);
  }

  // --- time ------------------------------------------------------------------

  /**
   * Real time becomes game time. The shell's clock bridge (bootstrap
   * installClockBridge) is the ONE place clock minutes are pushed through
   * party.advanceTime - poison, disease, buff expiry, wages, aging - so this
   * only advances the clock and adds the single effect advanceTime does not
   * cover: the Regeneration buff's steady healing.
   */
  advanceGameTime(dt) {
    this.clock.advance(dt);
    const party = this.party;
    if (!party || !party.members) return;
    const pm = party.minutes;
    if (pm === undefined) return;
    if (this._lastRegenMin === undefined || pm < this._lastRegenMin) this._lastRegenMin = pm;
    const dm = pm - this._lastRegenMin;
    if (dm < 1) return;
    this._lastRegenMin = pm;
    const combat = this.modules && this.modules.combatMod;
    for (const ch of party.members) {
      const b = ch && ch.buffs && ch.buffs.regeneration;
      if (!b) continue;
      if (ch.hp <= 0 || (ch.conditions && (ch.conditions.dead || ch.conditions.eradicated))) continue;
      const cap = combat && combat.maxHPOf ? combat.maxHPOf(ch) : (ch.maxHP || ch.hp);
      ch.hp = Math.min(cap, ch.hp + Math.round((b.power || 1) * dm / 5));
    }
  }

  /** Keep the party inside the generated world, with a word instead of a wall. */
  clampToBounds(dt) {
    const map = this.map;
    if (!map || map.indoor || !map.hm) return;
    const half = 128 * 512 * 0.49;   // just inside the 128-tile heightfield
    const p = this.player.pos;
    let hit = false;
    if (p.x > half) { p.x = half; hit = true; } else if (p.x < -half) { p.x = -half; hit = true; }
    if (p.z > half) { p.z = half; hit = true; } else if (p.z < -half) { p.z = -half; hit = true; }
    this._boundsMsgT = Math.max(0, this._boundsMsgT - dt);
    if (hit && this._boundsMsgT <= 0) {
      this._boundsMsgT = 4;
      this.message('You can go no further - the wilds beyond are trackless.');
    }
  }

  /**
   * How wide a light the party carries underground. One by default - the torch
   * every party is assumed to hold - widened by Torch Light's power.
   */
  torchPower() {
    const b = this.party && this.party.buffs && this.party.buffs.torch_light;
    return b && b.expires > 0 ? Math.max(1, b.power || 1) : 1;
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
    return this._pickAlong(cam.position, dir, 4500);
  }

  /**
   * Raycast pick at normalized device coordinates (-1..1 both axes): the
   * entity under an arbitrary screen point, for real tap targeting.
   */
  pickEntityAt(nx, ny) {
    if (!this.map) return null;
    const cam = this.engine.camera;
    const dir = this._v2.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    return this._pickAlong(cam.position, dir, 4500);
  }

  _pickAlong(origin, dir, range) {
    let best = null, bestT = Infinity;
    for (const e of this.entities.list) {
      if (!e.visible || !e.sheet) continue;
      const dx = e.pos.x - origin.x, dy = (e.pos.y + e.sizeH * 0.5) - origin.y, dz = e.pos.z - origin.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t <= 0 || t > range) continue;
      const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
      const rad = Math.max(e.sizeW, e.sizeH) * 0.42;
      if (px * px + py * py + pz * pz < rad * rad && t < bestT) { bestT = t; best = e; }
    }
    return best;
  }

  /**
   * Space / tap: open a door, talk to an NPC, loot a chest, pick up an item.
   *
   * Whatever is under the cursor wins. Failing that, pick what the party is
   * *looking at* rather than merely what is closest: a town street puts a dozen
   * interactables inside any useful radius, so nearest-by-distance opened the
   * neighbouring shop, or talked to a passer-by, about as often as it opened the
   * door in front of you. Score by how far off the view axis a candidate sits
   * and reject anything outside a 60 degree cone.
   */
  /** Is this something the activate key can talk to / open / pick up? */
  isInteractable(c) {
    if (!c || c.dead) return false;
    return !!(c.interact || c.category === CATEGORY.ITEM || c.category === CATEGORY.NPC
      || c.category === CATEGORY.MONSTER);
  }

  /** MM6's activation reach: short, plus the target's own footprint. */
  activateReach(c) { return 256 + (c.radius || 0); }

  /**
   * A cheap line test at eye height that deliberately skips both endpoints, so
   * a door marker sitting inside its own collider is still reachable while a
   * chest through a wall is not.
   */
  hasLineTo(c) {
    if (!this.map || !this.map.blocked) return true;
    const a = this.player.pos, b = c.pos;
    const dy = (b.y + 80) - (a.y + 120);
    for (const t of [0.3, 0.5, 0.7]) {
      if (this.map.blocked(a.x + (b.x - a.x) * t, a.y + 120 + dy * t, a.z + (b.z - a.z) * t, 8, 16)) return false;
    }
    return true;
  }

  activate() {
    let e = this.hoverEntity;
    // A prop under the crosshair must never swallow the activation: if it is
    // not interactable, or out of reach, fall through to the scan.
    if (e) {
      const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
      if (!this.isInteractable(e) || d > this.activateReach(e) || !this.hasLineTo(e)) e = null;
    }
    if (!e) {
      const px = this.player.pos.x, pz = this.player.pos.z;
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      let best = null, bestScore = Infinity;
      for (const c of this.entities.list) {
        if (!this.isInteractable(c)) continue;
        if (c.category === CATEGORY.MONSTER) continue;   // attack handles those
        const dx = c.pos.x - px, dz = c.pos.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > this.activateReach(c)) continue;
        if (!this.hasLineTo(c)) continue;
        // Right on top of it counts however you are facing - you cannot miss a
        // thing you are standing in.
        if (d > 1) {
          const cos = (dx * fx + dz * fz) / d;
          if (d > 160 && cos < 0.5) continue;         // outside a 60 degree cone
          // Distance, penalised by how far off-axis it is, and biased toward
          // the thing you actually came for: a shop entrance and the building's
          // own door sit within a few units of each other, and swinging a door
          // open instead of walking into the shop is never what was meant.
          const want = c.interact && (c.interact.kind === 'shop' || c.interact.kind === 'transition') ? 0.45 : 1;
          const score = d * want * (1 + (1 - Math.max(0, cos)) * 3);
          if (score < bestScore) { bestScore = score; best = c; }
        } else if (d < bestScore) { bestScore = d; best = c; }
      }
      e = best;
    }
    if (!e) return null;
    return { entity: e, kind: e.interact ? e.interact.kind : e.category };
  }

  // --- world services --------------------------------------------------------

  /**
   * Spawn a pack of level-appropriate monsters in a ring around the party -
   * the rest screen's midnight interruption, and anything else that wants an
   * honest ambush instead of a message.
   */
  spawnAmbush(opts = {}) {
    const count = Math.max(1, opts.count || 3);
    const level = Math.max(1, opts.level || this.partyLevel());
    const monsters = this.modules && this.modules.monsterMod;
    if (!this.spawner || !monsters || !monsters.monstersInLevelRange) return [];
    let pool = monsters.monstersInLevelRange(Math.max(1, level - 2), level + 3)
      .filter((m) => m.hostile && !m.unique);
    const regionId = this.mapMeta && this.mapMeta.kind === 'dungeon'
      ? (this.map.dungeon && this.map.dungeon.theme) : this.mapId;
    const native = pool.filter((m) => m.spawnRegions.indexOf(regionId) >= 0);
    if (native.length) pool = native;
    if (!pool.length) return [];

    const rnd = new Rand((Math.floor(this.clock.minutes) ^ hashStr(String(this.mapId || 'x'))) >>> 0);
    const kind = rnd.pick(pool);
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = rnd.float(0, Math.PI * 2);
      const r = rnd.float(500, 900);
      let x = this.player.pos.x + Math.cos(a) * r;
      let z = this.player.pos.z + Math.sin(a) * r;
      const y = this.collision.groundAt(x, z, this.player.pos.y);
      if (this.map && this.map.blocked && this.map.blocked(x, y + 10, z, 60, 100)) {
        x = this.player.pos.x + Math.cos(a) * 350;
        z = this.player.pos.z + Math.sin(a) * 350;
      }
      const e = this.spawner.spawnMonster(kind.id, x, this.collision.groundAt(x, z, this.player.pos.y), z, {});
      if (!e) continue;
      e.state = 'chase';
      out.push(e);
    }
    if (out.length) {
      this.inCombat = true;
      this._combatLinger = 1.5;
      this.onCombatChange(true);
      if (this.audio) this.audio.play(kind.sound || 'growl_small', { pos: out[0].pos });
      this.message('You are ambushed!', '#e04030');
    }
    return out;
  }

  /** Average living party level, for scaling ambushes. */
  partyLevel() {
    const ms = (this.party && this.party.members) || [];
    if (!ms.length) return 1;
    return Math.max(1, Math.round(ms.reduce((t, c) => t + (c.level | 0 || 1), 0) / ms.length));
  }

  /**
   * Everything map-side a save needs to put this session back together. The
   * shell persists this next to the serialized party; `restoreState` applies
   * it after the map named by `mapMeta` has been reloaded.
   */
  saveState() {
    const party = this.party || {};
    const monsters = [];
    for (const e of this.entities.list) {
      if (e.category !== CATEGORY.MONSTER && e.category !== CATEGORY.CORPSE) continue;
      if (!e.kind) continue;
      monsters.push({
        kind: e.kind,
        x: Math.round(e.pos.x), y: Math.round(e.pos.y), z: Math.round(e.pos.z),
        hp: e.mon ? e.mon.hp : e.hp,
        dead: !!e.dead || e.category === CATEGORY.CORPSE,
        group: e.spawnGroup !== undefined ? e.spawnGroup : null,
      });
    }
    const poolState = (this.questPool || []).map((q) => ({
      id: q.id, state: q.state,
      objectives: (q.objectives || []).map((o) => ({ id: o.id, progress: o.progress, done: o.done })),
    }));
    return {
      v: 1,
      mapMeta: this.mapMeta ? JSON.parse(JSON.stringify(this.mapMeta)) : { kind: 'region', id: this.mapId, seed: this.worldSeed },
      player: {
        x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z,
        yaw: this.player.yaw, pitch: this.player.pitch,
      },
      clock: this.clock.minutes,
      partyMinutes: party.minutes,
      quests: JSON.parse(JSON.stringify(party.quests && !Array.isArray(party.quests) ? party.quests : {})),
      questPool: poolState,
      shops: JSON.parse(JSON.stringify(this.shops || {})),
      monsters,
      stats: {
        questsDone: party.questsDone | 0,
        killsByKind: Object.assign({}, party.killsByKind || {}),
        monstersKilled: party.monstersKilled | 0,
      },
    };
  }

  /** Apply a `saveState` blob. The matching map must already be loaded. */
  restoreState(s) {
    if (!s) return false;
    const party = this.party;
    if (s.clock !== undefined) {
      this.clock.minutes = s.clock;
      if (party && s.partyMinutes !== undefined) party.minutes = s.partyMinutes;
      // The shell's clock bridge must re-anchor, not fast-forward the gap.
      if (this.resetClockBridge) this.resetClockBridge();
    }
    if (s.player) {
      this.player.pos.set(s.player.x, s.player.y, s.player.z);
      this.player.vel.set(0, 0, 0);
      this.player.yaw = s.player.yaw || 0;
      this.player.pitch = s.player.pitch || 0;
    }
    if (s.shops) this.shops = s.shops;
    if (party) {
      if (s.quests) party.quests = s.quests;
      if (s.stats) {
        party.questsDone = s.stats.questsDone | 0;
        party.killsByKind = Object.assign({}, s.stats.killsByKind || {});
        party.monstersKilled = s.stats.monstersKilled | 0;
      }
    }
    // The pool regenerates deterministically with the world seed; fold the
    // saved progress back onto the regenerated quest objects in place, so the
    // NPCs already holding references see the restored states.
    if (Array.isArray(s.questPool) && Array.isArray(this.questPool)) {
      const by = new Map(s.questPool.map((q) => [q.id, q]));
      for (const q of this.questPool) {
        const saved = by.get(q.id);
        if (!saved) continue;
        q.state = saved.state;
        for (const o of q.objectives || []) {
          const so = (saved.objectives || []).find((x) => x.id === o.id);
          if (so) { o.progress = so.progress; o.done = so.done; }
        }
        // An accepted quest lives in the party map; point the pool at the
        // same object so giver NPCs and the log agree.
        if (party && party.quests && party.quests[q.id]) {
          Object.assign(q, party.quests[q.id]);
          party.quests[q.id] = q;
        }
      }
    }
    // Replace the freshly-populated monster set with the saved snapshot.
    if (Array.isArray(s.monsters) && this.spawner) {
      for (const e of [...this.entities.list]) {
        if (e.category === CATEGORY.MONSTER || e.category === CATEGORY.CORPSE) this.entities.removeEntity(e);
      }
      for (const m of s.monsters) {
        if (m.dead) continue;
        const e = this.spawner.spawnMonster(m.kind, m.x, m.y, m.z, {});
        if (!e) continue;
        if (e.mon) { e.mon.hp = m.hp; }
        e.hp = m.hp;
        if (m.group !== null && m.group !== undefined) e.spawnGroup = m.group;
      }
    }
    this.inCombat = false;
    this.turnBased = false;
    this._combatLinger = 0;
    this._respawnDay = Math.floor(this.clock.minutes / DAY_MINUTES);
    this._accMin = 0;
    return true;
  }

  /**
   * Outdoor packs whose members are all dead come back once the party is far
   * enough away - called on day change.
   */
  respawnMonsters() {
    if (!this.map || this.map.indoor || !this.spawner) return;
    const groups = this._spawnGroups || [];
    for (const g of groups) {
      const alive = this.entities.list.some(
        (e) => e.spawnGroup === g.id && e.category === CATEGORY.MONSTER && !e.dead,
      );
      if (alive) continue;
      const d = Math.hypot(g.desc.x - this.player.pos.x, g.desc.z - this.player.pos.z);
      if (d < 5000) continue;   // never respawn on top of the party
      this.spawner.spawnGroup(g.desc, new Rand((g.id * 2654435761) >>> 0),
        (x, z) => this.collision.groundAt(x, z, 0), g.id);
    }
  }

  /** An escorted NPC trails the party; if it dies, the quest fails. */
  updateEscort(dt) {
    const es = this.escort;
    if (!es || !es.entity) return;
    const e = es.entity;
    if (e.remove || e.dead) { this.escort = null; return; }
    // Steer its patrol at a spot just behind the party so it keeps up.
    const back = 180;
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    e.patrol = [{ x: this.player.pos.x - fx * back, z: this.player.pos.z - fz * back }];
    e.patrolIdx = 0;
    e.think = 0;
    e.speed = 300;
    const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
    if (d > 4000) {
      // Teleport a straggler rather than losing the quest to pathing.
      e.pos.x = this.player.pos.x - fx * back;
      e.pos.z = this.player.pos.z - fz * back;
      e.pos.y = this.collision.groundAt(e.pos.x, e.pos.z, this.player.pos.y);
    }
  }

  // --- combat hooks (wired to game/combat.js by the shell) ------------------

  onAggro(e) {
    this.inCombat = true;
    this._combatLinger = 1.5;
    this.onCombatChange(true);
    if (this.audio) {
      const voice = (e.data && e.data.sound) || 'growl_small';
      this.audio.play(voice, { pos: e.pos });
    }
  }

  /** Live hostiles actively engaging the party. */
  countHostiles(range = 4000) {
    let n = 0;
    const px = this.player.pos.x, pz = this.player.pos.z;
    for (const e of this.entities.list) {
      if (e.category !== CATEGORY.MONSTER || e.dead) continue;
      if (e.state === 'chase' || e.state === 'flee') {
        const d = Math.hypot(e.pos.x - px, e.pos.z - pz);
        if (d < range) n++;
      }
    }
    return n;
  }

  /**
   * Recompute inCombat honestly. Callable from anywhere - the rest screen
   * re-checks instead of deadlocking on a flag only the world loop cleared.
   * A short linger keeps the state from flickering at aggro range.
   */
  checkCombat(dt = 0.5) {
    const n = this.countHostiles();
    if (n > 0) this._combatLinger = 1.5;
    else this._combatLinger = Math.max(0, this._combatLinger - dt);
    const was = this.inCombat;
    this.inCombat = n > 0 || this._combatLinger > 0;
    if (was !== this.inCombat) this.onCombatChange(this.inCombat);
    return this.inCombat;
  }

  updateCombatState(dt) { return this.checkCombat(dt); }

  /** The rest screen's honest re-check: is anything actually hunting us? */
  monstersNear() { return this.countHostiles() > 0; }

  /**
   * For the shell's audio director: the track the fight wants right now, or
   * null to play the situational ambient track. (The session also drives
   * music.play directly, so combat music works without a director.)
   */
  combatMusicOverride() {
    if (this.inCombat) return 'combat';
    if (this._victoryT > 0) return 'victory';
    return null;
  }

  /** Swords out: the music follows the fight in and back out again. */
  onCombatChange(on) {
    if (!this.music) return;
    this.music.setIntensity(on ? 1 : 0);
    if (on) { this._victoryT = 0; this.music.play('combat'); }
    else if (this._victoryT <= 0) this.music.play(this.musicTrack || 'field');
  }

  /** The last engaged enemy just died: a sting, then back to the map's track. */
  notifyVictory() {
    if (!this.music) return;
    this._victoryT = 5;
    this.music.setIntensity(0);
    this.music.play('victory', { fadeMs: 250 });
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
    // Pre-engaging is allowed: MM6 lets you drop into turns before anything
    // has noticed you, and the mode simply waits for the fight to start.
    this.turnBased = true;
    this.turnActor = 'party';
    this.turnPoints = 130;
    this._partyIdleT = 0;
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
    // Everyone still standing joins the round, fastest first. Recovery governs
    // whether a character can act yet, not whether they are in the queue -
    // filtering on it here emptied the queue after any real fight.
    this.turnQueue = members
      .map((ch, i) => ({ i, ch }))
      .filter(({ ch }) => ch.hp > 0)
      .sort((a, b) => (b.ch.stats?.speed || 0) - (a.ch.stats?.speed || 0))
      .map(({ i }) => i);
    if (this.turnQueue.length) this.activeChar = this.turnQueue[0];
  }

  /** Called after a character spends their action. */
  consumeTurn(charIndex, cost = 26) {
    if (!this.turnBased) return;
    this._partyIdleT = 0;
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
    if (!this.turnBased) return;

    if (this.turnActor === 'party') {
      // Turn-based is not an invulnerability toggle: if the party stands idle
      // past a grace window while enemies are engaged, the enemies act anyway.
      // (Recovery, in exchange, only ticks per round in turns - see combatglue.)
      if (this.countHostiles() > 0) {
        this._partyIdleT += dt;
        if (this._partyIdleT > 4) {
          this._partyIdleT = 0;
          this.message('You hesitate - the enemy does not.');
          this.beginMonsterTurn();
        }
      } else {
        this._partyIdleT = 0;
      }
      return;
    }
    if (this.turnActor !== 'monsters') return;
    this._monsterTurnT += dt;

    // Entity AI is frozen in turns, so aggro checks run here: anything that
    // would have noticed the party in real time joins the round.
    for (const e of this.entities.list) {
      if (e.category !== CATEGORY.MONSTER || e.dead || e.state !== 'idle') continue;
      if (e.data && e.data.hostile === false) continue;
      const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
      if (d < e.aggroRange && this.canSee(e.pos, this.player.pos)) {
        e.state = 'chase';
        this.onAggro(e);
      }
    }

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
      this._partyIdleT = 0;
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
