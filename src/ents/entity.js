import * as THREE from 'three';
import { angleIndex } from './billboard.js';

// ---------------------------------------------------------------------------
// World entities.
//
// Anything that is drawn as a sprite lives here: monsters, townsfolk, trees,
// props, dropped loot, corpses. They share one update/draw path so a crowded
// town square costs the same handful of draw calls as an empty field.
// ---------------------------------------------------------------------------

export const CATEGORY = {
  MONSTER: 'monster',
  NPC: 'npc',
  FLORA: 'flora',
  PROP: 'prop',
  ITEM: 'item',
  CORPSE: 'corpse',
};

let _nextId = 1;

export class Entity {
  constructor(o) {
    this.id = _nextId++;
    this.category = o.category || CATEGORY.PROP;
    this.kind = o.kind;
    this.sheet = o.sheet || null;
    this.pos = new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0);
    this.yaw = o.yaw || 0;
    this.scale = o.scale || 1;
    this.radius = o.radius ?? 60;
    this.solid = o.solid ?? false;
    this.static = o.static ?? false;

    this.action = o.action || 'stand';
    this.actionTime = 0;
    this.frame = 0;
    this.animSpeed = 1;

    this.tint = new THREE.Color(1, 1, 1);
    this.alpha = 1;
    this.visible = true;
    this.dead = false;
    this.remove = false;

    // Gameplay payload - a monster record, an NPC record, an item stack.
    this.data = o.data || null;
    this.hp = o.hp ?? 0;
    this.maxHp = o.maxHp ?? this.hp;

    // AI
    this.state = 'idle';
    this.target = null;
    this.think = 0;
    this.recovery = 0;
    this.home = this.pos.clone();
    this.patrol = o.patrol || null;
    this.patrolIdx = 0;
    this.speed = o.speed || 260;
    this.aggroRange = o.aggroRange || 1800;
    this.hitFlash = 0;
    this.deathTimer = 0;
    this.bobSeed = Math.random() * 6.283;

    this.interact = o.interact || null;  // {kind, ...} for doors, shops, chests
    this.label = o.label || null;
  }

  get sizeW() { return this.sheet ? this.sheet.worldW * this.scale : 200 * this.scale; }
  get sizeH() { return this.sheet ? this.sheet.worldH * this.scale : 300 * this.scale; }

  setAction(action, restart = true) {
    if (this.action === action && !restart) return;
    if (!this.sheet || !this.sheet.actions[action]) {
      // Fall back to standing rather than showing garbage frames.
      action = this.sheet && this.sheet.actions.stand ? 'stand' : action;
    }
    this.action = action;
    this.actionTime = 0;
    this.frame = 0;
  }

  advanceAnim(dt) {
    if (!this.sheet) return;
    const def = this.sheet.actions[this.action];
    if (!def) return;
    this.actionTime += dt * this.animSpeed;
    const fps = def.fps || 8;
    const total = def.frames || 1;
    let f = Math.floor(this.actionTime * fps);
    if (def.loop) {
      this.frame = f % total;
    } else {
      if (f >= total) {
        this.frame = total - 1;
        this.onAnimEnd();
      } else {
        this.frame = f;
      }
    }
  }

  onAnimEnd() {
    if (this.action === 'die') { this.setAction('dead', false); this.category = CATEGORY.CORPSE; }
    else if (this.action === 'attack' || this.action === 'cast' || this.action === 'hit') {
      this.setAction(this.state === 'chase' ? 'walk' : 'stand');
    }
  }
}

export class EntityManager {
  constructor() {
    this.list = [];
    this.byId = new Map();
    this._visible = [];
    this._tmp = new THREE.Vector3();
  }

  add(e) { this.list.push(e); this.byId.set(e.id, e); return e; }

  removeEntity(e) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    this.byId.delete(e.id);
  }

  clear() { this.list.length = 0; this.byId.clear(); }

  /** Entities within `r` of a point, optionally filtered by category. */
  near(x, z, r, category = null, out = []) {
    out.length = 0;
    const r2 = r * r;
    for (const e of this.list) {
      if (category && e.category !== category) continue;
      const dx = e.pos.x - x, dz = e.pos.z - z;
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    return out;
  }

  /** Nearest entity matching a predicate. */
  nearest(x, z, r, pred) {
    let best = null, bestD = r * r;
    for (const e of this.list) {
      if (pred && !pred(e)) continue;
      const dx = e.pos.x - x, dz = e.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  update(dt, ctx) {
    const px = ctx.player.pos.x, pz = ctx.player.pos.z;
    const cullFar = ctx.simRange || 9000;
    const cull2 = cullFar * cullFar;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.remove) { this.removeEntity(e); continue; }

      const dx = e.pos.x - px, dz = e.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      e.visible = d2 < cull2;

      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

      if (e.static) { if (e.visible) e.advanceAnim(dt); continue; }
      if (!e.visible) continue;

      // Turn-based mode suspends autonomous behaviour; the turn manager moves
      // and animates monsters explicitly.
      if (ctx.frozen) { e.advanceAnim(dt); continue; }

      if (e.category === CATEGORY.MONSTER && !e.dead) {
        this.updateMonster(e, dt, ctx, Math.sqrt(d2));
      } else if (e.category === CATEGORY.NPC) {
        this.updateNPC(e, dt, ctx);
      } else if (e.category === CATEGORY.CORPSE) {
        e.deathTimer += dt;
      }
      e.advanceAnim(dt);
    }
  }

  updateMonster(e, dt, ctx, dist) {
    if (e.recovery > 0) e.recovery -= dt;
    e.think -= dt;

    const px = ctx.player.pos.x, pz = ctx.player.pos.z;
    const busy = e.action === 'attack' || e.action === 'cast' || e.action === 'hit';

    if (e.state === 'idle') {
      if (dist < e.aggroRange && ctx.canSee(e.pos, ctx.player.pos)) {
        e.state = 'chase';
        if (ctx.onAggro) ctx.onAggro(e);
      } else if (e.think <= 0) {
        e.think = 1.5 + Math.random() * 3;
        // Idle wander keeps the world from feeling like a diorama.
        if (Math.random() < 0.5) {
          e.yaw = Math.random() * Math.PI * 2;
          e.state = 'wander';
          e.think = 1 + Math.random() * 2;
        }
      }
      if (!busy && e.action !== 'stand') e.setAction('stand');
    } else if (e.state === 'wander') {
      if (dist < e.aggroRange && ctx.canSee(e.pos, ctx.player.pos)) { e.state = 'chase'; }
      else {
        this.stepToward(e, e.pos.x - Math.sin(e.yaw) * 100, e.pos.z - Math.cos(e.yaw) * 100, dt, ctx, 0.45);
        if (!busy) e.setAction('walk', false);
        if (e.think <= 0) { e.state = 'idle'; e.think = 1 + Math.random() * 3; }
      }
    } else if (e.state === 'chase') {
      const mdef = e.data || {};
      const reach = (mdef.reach || 260) + (ctx.playerRadius || 90);
      if (dist > e.aggroRange * 2.2) { e.state = 'idle'; e.setAction('stand'); return; }

      if (dist <= reach) {
        if (!busy && e.recovery <= 0) {
          e.setAction('attack');
          e.recovery = mdef.recoveryTime ? mdef.recoveryTime / 60 : 1.4;
          if (ctx.onMonsterAttack) ctx.onMonsterAttack(e);
        } else if (!busy) {
          e.setAction('stand', false);
        }
      } else if (mdef.ranged && dist < (mdef.ranged.range || 3000) && e.recovery <= 0 && !busy) {
        e.setAction('cast');
        e.recovery = 2 + Math.random();
        if (ctx.onMonsterRanged) ctx.onMonsterRanged(e);
      } else {
        this.stepToward(e, px, pz, dt, ctx, 1);
        if (!busy) e.setAction('walk', false);
      }
      // Always face the party while engaged.
      e.yaw = Math.atan2(px - e.pos.x, pz - e.pos.z) + Math.PI;
    } else if (e.state === 'flee') {
      this.stepToward(e, e.pos.x * 2 - px, e.pos.z * 2 - pz, dt, ctx, 1.15);
      if (!busy) e.setAction('walk', false);
    }
  }

  updateNPC(e, dt, ctx) {
    if (!e.patrol || e.patrol.length < 2) {
      if (e.action !== 'stand') e.setAction('stand', false);
      return;
    }
    const t = e.patrol[e.patrolIdx];
    const dx = t.x - e.pos.x, dz = t.z - e.pos.z;
    if (dx * dx + dz * dz < 90 * 90) {
      e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
      e.think = 1 + Math.random() * 3;
    }
    if (e.think > 0) { e.think -= dt; e.setAction('stand', false); return; }
    this.stepToward(e, t.x, t.z, dt, ctx, 0.5);
    e.setAction('walk', false);
  }

  stepToward(e, tx, tz, dt, ctx, speedMul = 1) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const sp = e.speed * speedMul * dt;
    const nx = e.pos.x + (dx / len) * sp;
    const nz = e.pos.z + (dz / len) * sp;
    if (!ctx.blocked || !ctx.blocked(nx, e.pos.y, nz, e.radius, 100)) {
      e.pos.x = nx; e.pos.z = nz;
    } else {
      // Slide along the obstruction rather than jamming into it.
      if (!ctx.blocked(nx, e.pos.y, e.pos.z, e.radius, 100)) e.pos.x = nx;
      else if (!ctx.blocked(e.pos.x, e.pos.y, nz, e.radius, 100)) e.pos.z = nz;
    }
    if (ctx.groundAt) e.pos.y = ctx.groundAt(e.pos.x, e.pos.z, e.pos.y);
    e.yaw = Math.atan2(dx, dz) + Math.PI;
  }

  /**
   * Submit every visible entity to the sprite renderer, back to front.
   * @param {import('./billboard.js').SpriteRenderer} sr
   */
  render(sr, camera, ctx) {
    const cx = camera.position.x, cz = camera.position.z;
    const list = this._visible;
    list.length = 0;

    const far = ctx.drawDistance || 7000;
    const far2 = far * far;
    for (const e of this.list) {
      if (!e.visible || !e.sheet || e.alpha <= 0) continue;
      const dx = e.pos.x - cx, dz = e.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      e._d2 = d2;
      list.push(e);
    }
    // Painter's order keeps cutout sprites from z-fighting with each other's
    // alpha-tested edges when they overlap.
    list.sort((a, b) => b._d2 - a._d2);

    for (const e of list) {
      const sheet = e.sheet;
      const ai = sheet.angles > 1
        ? angleIndex(e.yaw, cx, cz, e.pos.x, e.pos.z, sheet.angles)
        : 0;
      const uv = sheet.uv(e.action, e.frame, ai);
      if (!uv) continue;

      let r = e.tint.r, g = e.tint.g, b = e.tint.b;
      // Sprites take the world's light so they sit in the scene rather than
      // floating on top of it.
      if (ctx.lightAt) {
        const l = ctx.lightAt(e.pos.x, e.pos.y, e.pos.z);
        r *= l.r; g *= l.g; b *= l.b;
      }
      if (e.hitFlash > 0) {
        const f = e.hitFlash;
        r = r * (1 - f) + 1.6 * f; g = g * (1 - f) + 0.4 * f; b = b * (1 - f) + 0.35 * f;
      }

      const batch = sr.batchFor(sheet.texture);
      batch.add(
        e.pos.x, e.pos.y, e.pos.z,
        e.sizeW, e.sizeH,
        uv[0], uv[1], uv[2], uv[3],
        r, g, b, e.alpha,
        1,
      );
    }
    return list.length;
  }
}
