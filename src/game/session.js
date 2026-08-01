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

    // Let the map cull its own batched content against the camera and advance
    // its sky. Hours, not the 0-1 fraction, since that is what it bakes against.
    if (this.map && this.map.update) {
      this.map.update(this.engine.camera, dt, this.clock.hour + this.clock.minute / 60,
        this.torchPower());
    }

    this.updateCombatState();
    this.syncTimeOfDay();
    this.applyFog();
    this.updateTint();

    this.hoverEntity = this.pickEntity(input.pointer);
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
  activate() {
    let e = this.hoverEntity;
    if (!e) {
      const px = this.player.pos.x, pz = this.player.pos.z;
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      let best = null, bestScore = Infinity;
      for (const c of this.entities.list) {
        if (c.dead) continue;
        if (!(c.interact || c.category === CATEGORY.ITEM || c.category === CATEGORY.NPC)) continue;
        const dx = c.pos.x - px, dz = c.pos.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 900) continue;
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
