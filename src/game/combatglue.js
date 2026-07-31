import * as THREE from 'three';
import { CATEGORY } from '../ents/entity.js';
import { Rand } from '../core/rng.js';
import { Spawner } from './spawner.js';

// ---------------------------------------------------------------------------
// Combat and interaction glue.
//
// game/combat.js holds the rules; this file connects them to the things you can
// see: who the crosshair is over, which sprite plays its attack animation, where
// the fireball flies, what falls on the floor when something dies.
// ---------------------------------------------------------------------------

const MELEE_REACH = 900;
const _v = new THREE.Vector3();

export function installCombat(session) {
  const mods = session.modules || {};
  const combat = mods.combatMod;
  const rnd = new Rand(0xc0ffee);

  session.spawner = new Spawner(session);
  session.spawner.bind(mods);

  // --- party attacks -------------------------------------------------------

  session.attack = () => {
    const party = session.party;
    const members = party.members || [];
    const target = pickTarget(session);

    let acted = false;
    for (let i = 0; i < members.length; i++) {
      const ch = members[i];
      if (!canAct(ch)) continue;
      if (ch.recovery > 0) continue;
      acted = true;
      swing(session, ch, i, target, combat, rnd);
      // In turn-based mode only the active character acts per input.
      if (session.turnBased) break;
    }
    if (!acted && session.audio) session.audio.play('error', { volume: 0.3 });
    return acted;
  };

  session.castSpell = (charIndex, spell, target = null) => {
    const ch = session.party.members[charIndex];
    if (!ch || !canAct(ch)) return false;

    const cost = spellCost(ch, spell);
    if (ch.sp < cost) {
      session.message(`${ch.name} does not have enough spell points.`);
      if (session.audio) session.audio.play('spell_fail');
      return false;
    }
    ch.sp -= cost;
    ch.recovery = (spell.recovery || 100) / 60;

    const school = (spell.school || 'spirit').toLowerCase();
    if (session.audio) session.audio.play(`cast_${school}`);
    session.message(`${ch.name} casts ${spell.name}.`);

    const tgt = target || pickTarget(session);
    fireSpell(session, ch, spell, tgt, combat, rnd);
    return true;
  };

  // --- monsters hitting back ----------------------------------------------

  session.onMonsterAttackCb = (e) => {
    const victim = pickVictim(session, rnd);
    if (!victim) return;
    const def = e.data || {};
    let dmg = 0, hit = true;
    if (combat && combat.monsterAttack) {
      const res = combat.monsterAttack(def, victim, rnd);
      hit = res.hit; dmg = res.damage;
    } else {
      hit = rnd.float() > 0.35;
      dmg = hit ? rnd.dice(1, 6) + (def.level || 1) : 0;
    }
    if (!hit) {
      session.message(`${def.name || e.kind} misses ${victim.name}.`);
      if (session.audio) session.audio.play('miss', { volume: 0.4 });
      return;
    }
    applyPartyDamage(session, victim, dmg, def.attack?.element || 'physical');
    if (session.audio) session.audio.play('hit_flesh');
    if (session.vfx) session.vfx.burst('blood_hit', e.pos.x, e.pos.y + 120, e.pos.z, { scale: 0.6 });
    session.engine.setFlash(Math.min(0.5, dmg / 60), 0xd02020);
    setTimeout(() => session.engine.setFlash(0), 90);
  };

  session.onMonsterRangedCb = (e) => {
    const def = e.data || {};
    const vfxId = def.ranged?.vfx || 'fire_bolt';
    if (session.vfx) {
      const from = _v.set(e.pos.x, e.pos.y + (e.sizeH || 200) * 0.6, e.pos.z);
      const dir = new THREE.Vector3(
        session.player.pos.x - from.x,
        session.player.pos.y + 160 - from.y,
        session.player.pos.z - from.z,
      ).normalize();
      session.vfx.projectile(vfxId, from.clone(), dir, {
        speed: 1600, range: 5000,
        onHit: () => {
          const victim = pickVictim(session, rnd);
          if (!victim) return;
          const dmg = def.ranged?.damage ? rnd.dice(def.ranged.damage.n || 2, def.ranged.damage.d || 6) : rnd.dice(2, 6);
          applyPartyDamage(session, victim, dmg, def.ranged?.element || 'fire');
        },
      });
    }
  };

  // --- interaction ---------------------------------------------------------

  session.handleActivate = (hit) => {
    const e = hit.entity;
    const kind = hit.kind;
    if (kind === 'npc') {
      window.__openScreen && window.__openScreen('dialogue', { npc: e.data, entity: e });
    } else if (kind === 'chest') {
      openChest(session, e, rnd);
    } else if (kind === 'item') {
      pickUp(session, e);
    } else if (kind === 'door') {
      toggleDoor(session, e);
    } else if (kind === 'shop') {
      const s = e.interact;
      const screenFor = {
        weapon: 'shop', armor: 'shop', magic: 'shop', alchemy: 'shop', general: 'shop',
        temple: 'temple', training: 'training', tavern: 'tavern', bank: 'bank',
        guild: 'guild', stables: 'transfer', docks: 'transfer',
      }[s.shopKind] || 'shop';
      window.__openScreen && window.__openScreen(screenFor, { shop: s, entity: e });
    } else if (kind === 'transition') {
      doTransition(session, e.interact);
    } else if (e.category === CATEGORY.MONSTER) {
      session.attack();
    }
  };

  // --- helpers exposed on the session -------------------------------------

  session.damageMonster = (e, amount, element = 'physical', source = null) => {
    if (!e || e.dead) return;
    if (combat && combat.applyMonsterDamage) {
      amount = combat.applyMonsterDamage(e.data, amount, element, rnd);
    }
    e.hp -= amount;
    e.hitFlash = 1;
    if (e.state === 'idle' || e.state === 'wander') { e.state = 'chase'; session.inCombat = true; }
    if (session.vfx) {
      session.vfx.damageNumber(e.pos.x, e.pos.y + (e.sizeH || 200) * 0.75, e.pos.z, String(amount), 'damage');
    }
    if (e.hp <= 0) killMonster(session, e, source);
    else if (e.action !== 'hit' && Math.random() < 0.4) e.setAction('hit');
  };

  session.tickRecovery = (dt) => {
    for (const ch of session.party.members || []) {
      if (ch.recovery > 0) ch.recovery = Math.max(0, ch.recovery - dt);
    }
  };

  const baseUpdate = session.update.bind(session);
  session.update = (dt, input) => {
    baseUpdate(dt, input);
    session.tickRecovery(dt);
  };
}

// --- internals -------------------------------------------------------------

function canAct(ch) {
  if (!ch) return false;
  if (ch.hp <= 0) return false;
  const bad = ['dead', 'unconscious', 'paralyzed', 'stoned', 'eradicated', 'asleep'];
  return !(ch.conditions || []).some((c) => bad.includes(c));
}

function spellCost(ch, spell) {
  return spell.spCost ?? spell.sp ?? 2;
}

function pickTarget(session) {
  if (session.hoverEntity && session.hoverEntity.category === CATEGORY.MONSTER && !session.hoverEntity.dead) {
    return session.hoverEntity;
  }
  // Otherwise the nearest live monster roughly in front of the party.
  const p = session.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null, bestScore = -Infinity;
  for (const e of session.entities.list) {
    if (e.category !== CATEGORY.MONSTER || e.dead || !e.visible) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 5000) continue;
    const dot = (dx / d) * fx + (dz / d) * fz;
    if (dot < 0.45) continue;
    const score = dot * 2000 - d;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function pickVictim(session, rnd) {
  const alive = (session.party.members || []).filter((c) => c.hp > 0 && !(c.conditions || []).includes('dead'));
  if (!alive.length) return null;
  return alive[rnd.int(alive.length)];
}

function swing(session, ch, index, target, combat, rnd) {
  const melee = target && Math.hypot(
    target.pos.x - session.player.pos.x, target.pos.z - session.player.pos.z,
  ) <= MELEE_REACH;

  const weapon = ch.equipment?.mainhand || null;
  const bow = ch.equipment?.bow || null;
  const useBow = !melee && bow;

  ch.recovery = combat && combat.recoveryFor ? combat.recoveryFor(ch, useBow) / 60 : 1.2;

  if (session.audio) session.audio.play(useBow ? 'bow_shot' : (weapon ? 'swing_heavy' : 'swing_light'));

  if (!target) {
    session.message(`${ch.name} swings at nothing.`);
    return;
  }

  if (useBow) {
    if (session.vfx) {
      const from = _v.set(session.player.pos.x, session.player.pos.y + 150, session.player.pos.z).clone();
      const dir = new THREE.Vector3(
        target.pos.x - from.x, (target.pos.y + target.sizeH * 0.5) - from.y, target.pos.z - from.z,
      ).normalize();
      session.vfx.projectile('arrow', from, dir, {
        speed: 3200, range: 6000, target,
        onHit: () => resolveHit(session, ch, target, combat, rnd, true),
      });
    } else {
      resolveHit(session, ch, target, combat, rnd, true);
    }
    return;
  }

  if (!melee) { session.message(`${ch.name} has no ranged weapon.`); return; }
  resolveHit(session, ch, target, combat, rnd, false);
}

function resolveHit(session, ch, target, combat, rnd, ranged) {
  if (!target || target.dead) return;
  let hit = true, dmg = 0, crit = false;
  if (combat && combat.attackRoll && combat.weaponDamage) {
    const roll = combat.attackRoll(ch, target.data || {}, rnd, ranged);
    hit = roll.hit; crit = roll.crit;
    if (hit) dmg = combat.weaponDamage(ch, target.data || {}, rnd, ranged) * (crit ? 2 : 1);
  } else {
    hit = rnd.float() > 0.3;
    dmg = hit ? rnd.dice(2, 6) + 2 : 0;
  }

  if (!hit) {
    session.message(`${ch.name} misses.`);
    if (session.vfx) session.vfx.damageNumber(target.pos.x, target.pos.y + target.sizeH * 0.7, target.pos.z, 'Miss', 'miss');
    if (session.audio) session.audio.play('miss', { volume: 0.35 });
    return;
  }

  if (session.audio) session.audio.play(crit ? 'crit' : 'hit_flesh');
  if (session.vfx) {
    session.vfx.burst('blood_hit', target.pos.x, target.pos.y + target.sizeH * 0.55, target.pos.z, { scale: 0.7 });
    if (crit) session.vfx.damageNumber(target.pos.x, target.pos.y + target.sizeH * 0.8, target.pos.z, String(dmg), 'crit');
  }
  session.damageMonster(target, dmg, 'physical', ch);
}

function fireSpell(session, ch, spell, target, combat, rnd) {
  const vfxTag = spell.vfx || 'sparks';
  const dmgOf = () => {
    if (combat && combat.spellDamage) return combat.spellDamage(ch, spell, rnd);
    return rnd.dice(spell.dice?.n || 3, spell.dice?.d || 6);
  };

  const kindsSelf = ['self', 'party', 'buff'];
  if (kindsSelf.includes(spell.target)) {
    if (session.vfx) {
      const p = session.player.pos;
      session.vfx.burst(vfxTag === 'heal_glow' ? 'heal_glow' : 'buff_shimmer', p.x, p.y + 100, p.z, { scale: 1.2 });
    }
    if (spell.heal && session.party.members) {
      const amount = dmgOf();
      for (const m of session.party.members) {
        if (spell.target === 'party' || m === ch) {
          m.hp = Math.min(m.maxHP, m.hp + amount);
        }
      }
      session.message(`Restored ${amount} hit points.`);
    }
    return;
  }

  if (!target) { session.message('No target.'); return; }

  const from = new THREE.Vector3(session.player.pos.x, session.player.pos.y + 150, session.player.pos.z);
  const dir = new THREE.Vector3(
    target.pos.x - from.x, (target.pos.y + target.sizeH * 0.5) - from.y, target.pos.z - from.z,
  ).normalize();

  const impact = {
    fire_bolt: 'fire_burst', fireball: 'fire_burst', meteor: 'fire_burst',
    ice_shard: 'ice_burst', lightning: 'spark_hit', rock_shard: 'earth_burst',
    dark_ray: 'soul_drain', starburst: 'holy_burst',
  }[vfxTag] || 'spark_hit';

  if (session.vfx) {
    session.vfx.projectile(vfxTag, from, dir, {
      speed: 2200, range: 7000, target, impactId: impact,
      onHit: (pos, hitEnt) => {
        const dmg = dmgOf();
        const victim = hitEnt || target;
        if (victim) session.damageMonster(victim, dmg, spell.element || 'magic', ch);
        // Area spells splash onto everything nearby.
        if (spell.area) {
          const near = session.entities.near(pos.x, pos.z, spell.area, CATEGORY.MONSTER);
          for (const other of near) if (other !== victim) session.damageMonster(other, Math.round(dmg * 0.6), spell.element || 'magic', ch);
        }
      },
    });
  } else {
    session.damageMonster(target, dmgOf(), spell.element || 'magic', ch);
  }
}

function applyPartyDamage(session, ch, dmg, element) {
  const combat = session.modules?.combatMod;
  if (combat && combat.applyDamage) dmg = combat.applyDamage(ch, dmg, element);
  ch.hp -= dmg;
  session.message(`${ch.name} takes ${dmg} damage.`, '#e04030');
  if (ch.hp <= 0) {
    ch.hp = 0;
    if (!ch.conditions.includes('unconscious')) ch.conditions.push('unconscious');
    session.message(`${ch.name} falls unconscious!`, '#e04030');
    if (session.audio) session.audio.play('death_player');
  }
}

function killMonster(session, e, source) {
  e.dead = true;
  e.solid = false;
  e.setAction('die');
  e.state = 'dead';
  if (session.audio) session.audio.play('monster_die', { pos: e.pos });

  const def = e.data || {};
  const xp = def.xp || (def.level || 1) * 25;
  const members = (session.party.members || []).filter((c) => c.hp > 0);
  if (members.length) {
    const each = Math.max(1, Math.floor(xp / members.length));
    for (const m of members) m.xp = (m.xp || 0) + each;
    session.message(`The party gains ${xp} experience.`, '#ffd84a');
  }

  const items = session.modules?.itemMod;
  const rnd = new Rand(e.id * 7919);
  if (items && items.randomLoot) {
    const loot = items.randomLoot(rnd, def.treasureLevel || def.level || 1, 1);
    for (const it of loot) session.spawner.dropItem(it, e.pos.x + rnd.float(-60, 60), e.pos.y, e.pos.z + rnd.float(-60, 60));
  }
  const gold = Math.max(0, Math.round((def.level || 1) * rnd.float(4, 14)));
  if (gold > 0) session.spawner.dropItem({ type: 'gold', name: `${gold} gold`, gold }, e.pos.x, e.pos.y, e.pos.z);
}

function openChest(session, e, rnd) {
  const info = e.interact;
  if (info.opened) { session.message('The chest is empty.'); return; }
  info.opened = true;
  if (session.audio) session.audio.play('chest_open');
  const items = session.modules?.itemMod;
  const loot = items && items.randomLoot ? items.randomLoot(rnd, info.level || 1, rnd.int(1, 4)) : [];
  for (const it of loot) session.spawner.dropItem(it, e.pos.x + rnd.float(-80, 80), e.pos.y, e.pos.z + rnd.float(-80, 80));
  const gold = rnd.int(20, 60) * (info.level || 1);
  session.party.gold += gold;
  session.message(`You found ${gold} gold${loot.length ? ` and ${loot.length} item(s)` : ''}.`, '#ffd84a');
  const sh = session.spawner.sheet('prop', 'chest_open', 1);
  if (sh) { e.sheet = sh; e.setAction('stand'); }
}

function pickUp(session, e) {
  const item = e.data;
  if (item && item.gold) {
    session.party.gold += item.gold;
    session.message(`You pick up ${item.gold} gold.`, '#ffd84a');
    if (session.audio) session.audio.play('gold_pickup');
  } else if (item) {
    const p = session.modules?.partyMod;
    const ch = session.party.members[session.activeChar];
    const ok = p && p.addToInventory ? p.addToInventory(ch, item) : (ch.inventory.push(item), true);
    if (!ok) { session.message('No room in your pack.'); return; }
    session.message(`You pick up ${item.name || 'an item'}.`);
    if (session.audio) session.audio.play('item_pickup');
  }
  e.remove = true;
}

function toggleDoor(session, e) {
  const d = e.interact;
  if (d.locked) {
    session.message('The door is locked.');
    if (session.audio) session.audio.play('door_locked');
    return;
  }
  d.open = !d.open;
  if (d.mesh) d.mesh.visible = !d.open;
  if (d.collider) d.collider.disabled = d.open;
  if (session.audio) session.audio.play(d.open ? 'door_open' : 'door_close');
}

function doTransition(session, t) {
  session.transition.start(0.35, async () => {
    const { loadRegion, loadDungeon } = await import('../bootstrap.js');
    if (t.toDungeon) await loadDungeon(session, t.toDungeon, t.seed || 1, t.entry);
    else if (t.toRegion) await loadRegion(session, t.toRegion, t.seed || 1, t.entry);
  });
}
