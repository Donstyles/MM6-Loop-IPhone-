// Combat resolution: to-hit, damage, resistance, recovery, monster AI and XP.
//
// Everything takes an explicit `rand` (a core/rng Rand) so a fight can be
// replayed exactly. Nothing here touches the renderer; the caller turns the
// returned log entries into sprites, sounds and floating numbers.

import {
  armorClass, attackBonus, damageBonus, maxHP, maxSP, recoveryTime, resistance,
  applyResistance, resistForElement, bonusOf, isIncapacitated, learningMultiplier,
  CONDITIONS, MIN_RECOVERY, TICKS_PER_TURN, levelForXP,
} from './stats.js';
import { MASTERY, skillEffect } from './skills.js';
import { itemDef, itemMods, weaponDice, itemRecovery } from './items.js';
import { spellDamage, spellById } from './spells.js';

// ---------------------------------------------------------------------------
// Combatant helpers - a "combatant" is either a character or a live monster
// ---------------------------------------------------------------------------

export function isMonster(c) { return !!(c && c.def && c.muid !== undefined); }

export function combatantName(c) { return isMonster(c) ? c.def.name : (c.name || 'Someone'); }

export function isAlive(c) {
  if (!c) return false;
  if (isMonster(c)) return c.alive && c.hp > 0;
  const cond = c.conditions || {};
  return !cond.dead && !cond.eradicated && c.hp > 0;
}

/** Can this combatant take an action this instant? */
export function canAct(c) {
  if (!isAlive(c)) return false;
  if (isMonster(c)) {
    const cond = c.conditions || {};
    return !cond.paralyzed && !cond.stoned && !cond.asleep && !cond.charmed;
  }
  return !isIncapacitated(c);
}

export function acOf(c) { return isMonster(c) ? c.ac + (c.buffs && c.buffs.acMod ? c.buffs.acMod : 0) : armorClass(c); }
export function maxHPOf(c) { return isMonster(c) ? c.maxHP : maxHP(c); }
export function levelOf(c) { return isMonster(c) ? c.level : (c.level | 0 || 1); }
/** Biological kind, which is what bane enchantments match against. */
export function familyOf(c) { return isMonster(c) ? c.def.kind : 'human'; }
/** The sprite family a monster belongs to ('Goblin'), or null for characters. */
export function spriteFamilyOf(c) { return isMonster(c) ? c.def.family : null; }

/** Resistance value for one element. Monsters read their template table. */
export function resistanceOf(c, element) {
  const id = resistForElement(element);
  if (!id) return 0;
  if (isMonster(c)) {
    const r = (c.def.resistances && c.def.resistances[id]) || 0;
    const buff = (c.buffs && c.buffs.resist && c.buffs.resist[id]) || 0;
    return Math.max(0, r + buff);
  }
  return resistance(c, id);
}

/** Immunity is absolute; a fire elemental takes no fire damage at all. */
export function isImmune(c, element) {
  if (!isMonster(c)) return false;
  const id = resistForElement(element) || element;
  return (c.def.immunities || []).indexOf(id) >= 0 || (c.def.immunities || []).indexOf(element) >= 0;
}

// ---------------------------------------------------------------------------
// Weapons in hand
// ---------------------------------------------------------------------------

const FIST = { n: 1, s: 3, plus: 0 };

/** What is this character swinging? Returns a descriptor combat can use. */
export function activeWeapon(character, ranged) {
  const eq = character.equipment || {};
  const item = ranged ? eq.bow : eq.mainhand;
  if (!item) {
    return { item: null, def: null, dice: FIST, skill: null, recovery: 100, ranged: !!ranged, mods: itemMods(null) };
  }
  const def = itemDef(item.def);
  return {
    item, def,
    dice: weaponDice(item),
    skill: def ? def.skill : null,
    recovery: itemRecovery(item),
    ranged: !!ranged,
    mods: itemMods(item),
  };
}

/** Sum of the recovery penalties of the armour the character is wearing. */
export function armorPenalty(character) {
  const eq = character.equipment || {};
  let pen = 0;
  for (const slot of ['armor', 'offhand', 'helm', 'boots', 'gauntlets']) {
    const it = eq[slot];
    if (!it) continue;
    const def = itemDef(it.def);
    if (!def || !def.recovery) continue;
    // The matching armour skill at Expert cancels the penalty entirely.
    if (def.skill) {
      const s = (character.skills || {})[def.skill];
      if (s && s.level > 0 && s.mastery >= MASTERY.EXPERT) continue;
    }
    pen += def.recovery;
  }
  return pen;
}

/** Recovery time for the character's next action. */
export function recoveryFor(character, ranged) {
  const w = activeWeapon(character, ranged);
  let base = w.recovery;
  const skillId = w.skill;
  if (skillId) {
    const s = (character.skills || {})[skillId];
    if (s && s.level > 0) {
      const eff = skillEffect(skillId, s.level, s.mastery);
      base -= eff.recovery || 0;
      if (eff.special && eff.special.minRecovery) base = MIN_RECOVERY;
    }
  }
  return recoveryTime(character, Math.max(MIN_RECOVERY, base), armorPenalty(character));
}

/** Recovery for a monster's next action. */
export function monsterRecovery(monster) {
  let r = monster.def.recoveryTime;
  if (monster.buffs && monster.buffs.slow) r *= 2;
  if (monster.buffs && monster.buffs.haste) r *= 0.5;
  return Math.max(MIN_RECOVERY, Math.round(r));
}

// ---------------------------------------------------------------------------
// To hit
// ---------------------------------------------------------------------------

/**
 * MM6's to-hit check. An attack of A against an armour class of C hits when
 *   rand(0, A + C + 30) >= C + 15
 * which gives roughly 50% at parity, never worse than 5% and never better
 * than 95%. Helpless targets (paralysed, asleep, stoned) are always hit.
 */
export function attackRoll(attacker, target, rand, opts) {
  const o = opts || {};
  const ranged = !!o.ranged;
  let atk;
  if (isMonster(attacker)) {
    atk = attacker.level * 2 + (o.attackBonus || 0);
  } else {
    const w = activeWeapon(attacker, ranged);
    atk = attackBonus(attacker, w.skill, ranged) + (w.mods.attack || 0) + (o.attackBonus || 0);
  }
  let ac = acOf(target);
  if (o.ignoreAC) ac = Math.max(0, ac - o.ignoreAC);

  const cond = (target.conditions) || {};
  if (cond.paralyzed || cond.asleep || cond.stoned || cond.unconscious) {
    return { hit: true, critical: rand.bool(0.25), roll: 0, chance: 1, helpless: true };
  }

  const span = Math.max(1, atk + ac + 30);
  const need = ac + 15;
  let chance = (span - need) / span;
  chance = Math.max(0.05, Math.min(0.95, chance));
  const roll = rand.float();
  const hit = roll < chance;
  // A natural low roll on a hit is a critical: double the dice.
  const critical = hit && roll < chance * 0.08;
  return { hit, critical, roll, chance, helpless: false };
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Roll a weapon's damage against a target. Returns
 *   { parts: [{ amount, element }], total, notes[] }
 * with the physical part first and any elemental riders after it.
 */
export function weaponDamage(character, weapon, target, rand, opts) {
  const o = opts || {};
  const w = weapon || activeWeapon(character, !!o.ranged);
  const ranged = w.ranged;
  const parts = [];
  const notes = [];

  const d = w.dice;
  let n = d.n;
  if (o.critical) n *= 2;
  let phys = rand.dice(n, d.s) + (d.plus || 0);
  phys += damageBonus(character, w.skill, ranged) + (w.mods.damage || 0);

  // Weapon-skill master tricks.
  let ignoreAC = w.mods.ignoreAC || 0;
  if (w.skill) {
    const s = (character.skills || {})[w.skill];
    if (s && s.level > 0 && s.mastery >= MASTERY.MASTER) {
      const sp = skillEffect(w.skill, s.level, s.mastery).special || {};
      if (sp.tripleChance && rand.int(1, 100) <= sp.tripleChance) { phys *= 3; notes.push('triple'); }
      if (sp.ignoreAC) ignoreAC += sp.ignoreAC;
      if (sp.stunChance && rand.int(1, 100) <= sp.stunChance) notes.push('stun');
      if (sp.paralyzeChance && rand.int(1, 100) <= sp.paralyzeChance) notes.push('paralyze');
    }
  }

  // Hammerhands and unarmed.
  if (!w.item && character.buffs && character.buffs.hammerhands) {
    phys += character.buffs.hammerhands.power || 0;
  }

  // Bane enchantments.
  const dv = w.mods.doubleDamageVs;
  if (dv && target && dv.indexOf(familyOf(target)) >= 0) { phys *= 2; notes.push('bane'); }
  if (dv && target && isMonster(target) && target.def.undead && dv.indexOf('undead') >= 0) { /* already doubled */ }

  phys = Math.max(1, Math.round(phys));
  const element = (w.def && w.def.element) || 'physical';
  parts.push({ amount: phys, element });

  if (w.mods.elemental) {
    for (const e of w.mods.elemental) {
      parts.push({ amount: Math.max(1, rand.dice(e.dice.n, e.dice.s)), element: e.element });
    }
  }

  let total = 0;
  for (const p of parts) total += p.amount;
  return { parts, total, notes, ignoreAC, vampiric: w.mods.vampiric || 0, inflict: w.mods.inflict || null, knockback: w.mods.knockback || 0, explodes: !!w.mods.explodes };
}

/** Roll a monster's melee damage. */
export function monsterDamage(monster, which, rand) {
  const a = which === 2 ? monster.def.attack2 : monster.def.attack;
  if (!a) return null;
  let amount = rand.dice(a.dice.n, a.dice.s) + (a.bonus || 0);
  if (monster.buffs && monster.buffs.shrunk) amount = Math.round(amount * (1 - monster.buffs.shrunk.power / 100));
  if (monster.buffs && monster.buffs.berserk) amount = Math.round(amount * 1.3);
  return { amount: Math.max(1, amount), element: a.element || 'physical' };
}

/**
 * Apply damage to a combatant. Handles immunity, the MM6 resistance halving
 * ladder, condition thresholds and death. Returns
 *   { dealt, resisted, immune, killed, unconscious, condition }
 */
export function applyDamage(target, amount, element, rand, opts) {
  const o = opts || {};
  const out = { dealt: 0, resisted: 0, immune: false, killed: false, unconscious: false, condition: null };
  if (!target || amount <= 0 || !isAlive(target)) return out;

  if (isImmune(target, element)) { out.immune = true; return out; }

  let dmg = Math.round(amount);
  if (element !== 'physical' || o.resistPhysical) {
    const res = resistanceOf(target, element);
    if (res > 0) {
      const after = applyResistance(dmg, res, rand);
      out.resisted = dmg - after;
      dmg = after;
    }
  } else if (isMonster(target) && target.def.resistances && target.def.resistances.physical) {
    // Ghosts and oozes shrug off steel.
    const after = applyResistance(dmg, target.def.resistances.physical, rand);
    out.resisted = dmg - after;
    dmg = after;
  } else if (!isMonster(target)) {
    // Shield halves missile damage; the skill does the same at Expert.
    if (o.missile) {
      if (target.buffs && target.buffs.shield) dmg = Math.ceil(dmg / 2);
      const sh = (target.skills || {}).shield;
      if (sh && sh.level > 0 && sh.mastery >= MASTERY.EXPERT) dmg = Math.ceil(dmg / 2);
    }
  }

  if (dmg <= 0) return out;
  out.dealt = dmg;

  if (isMonster(target)) {
    target.hp -= dmg;
    if (target.buffs && target.buffs.asleep) delete target.buffs.asleep;
    if (target.conditions && target.conditions.asleep) delete target.conditions.asleep;
    if (target.hp <= 0) { target.hp = 0; target.alive = false; out.killed = true; }
    else if (target.def.fleeAtHP && target.hp < target.maxHP * target.def.fleeAtHP) target.fleeing = true;
    return out;
  }

  // Characters.
  target.hp -= dmg;
  const conds = target.conditions || (target.conditions = {});
  if (conds.asleep) delete conds.asleep;
  const mhp = maxHP(target);
  if (target.hp <= -mhp * 2) {
    conds.eradicated = true; conds.dead = true; conds.unconscious = true;
    out.killed = true; out.condition = 'eradicated';
  } else if (target.hp <= -mhp) {
    if (target.buffs && target.buffs.preservation) {
      target.hp = 0; conds.unconscious = true; out.unconscious = true; out.condition = 'unconscious';
    } else {
      conds.dead = true; conds.unconscious = true; out.killed = true; out.condition = 'dead';
    }
  } else if (target.hp <= 0) {
    conds.unconscious = true; out.unconscious = true; out.condition = 'unconscious';
  }
  return out;
}

/** Conditions the spell lines can inflict that stats.CONDITIONS does not track. */
export const MONSTER_ONLY_CONDITIONS = {
  charmed: { id: 'charmed', name: 'Charmed', severity: 12, blocksAction: false },
  feebleminded: { id: 'feebleminded', name: 'Feebleminded', severity: 11, blocksAction: false },
};

/**
 * Try to inflict a condition. The target resists with the matching resistance;
 * Mind conditions use Mind, everything physical uses Body.
 */
export function tryInflict(target, conditionId, chance, rand) {
  if (!target || !isAlive(target)) return false;
  // Charm and Feeblemind are monster-side conditions with no character
  // bookkeeping (no portrait state, no temple price), so they live here rather
  // than in stats.CONDITIONS - but they still have to pass the save.
  const spec = CONDITIONS[conditionId] || MONSTER_ONLY_CONDITIONS[conditionId];
  if (!spec) return false;
  if (rand.int(1, 100) > chance) return false;
  const school = ['afraid', 'insane', 'asleep', 'charmed', 'feebleminded'].indexOf(conditionId) >= 0 ? 'mind' : 'body';
  if (isImmune(target, school)) return false;
  const res = resistanceOf(target, school);
  // A resistance roll that survives even one halving blocks the condition.
  if (res > 0 && rand.int(0, res + 30) >= 30) return false;
  if (isMonster(target)) {
    target.conditions = target.conditions || {};
    target.conditions[conditionId] = true;
  } else {
    target.conditions = target.conditions || {};
    // Poison and disease escalate rather than stack.
    if (spec.family) {
      const fam = spec.family;
      const ranks = Object.keys(CONDITIONS).filter((k) => CONDITIONS[k].family === fam)
        .sort((a, b) => CONDITIONS[a].rank - CONDITIONS[b].rank);
      const current = ranks.filter((k) => target.conditions[k]).pop();
      if (current) {
        const idx = ranks.indexOf(current);
        if (idx < ranks.length - 1) { delete target.conditions[current]; target.conditions[ranks[idx + 1]] = true; }
        return true;
      }
    }
    target.conditions[conditionId] = true;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Full attack resolution
// ---------------------------------------------------------------------------

/**
 * One character attack against one target. Returns a log entry:
 *   { attacker, target, hit, critical, damage, parts, killed, notes[] }
 */
export function resolveAttack(attacker, target, rand, opts) {
  const o = opts || {};
  const entry = {
    attacker: combatantName(attacker), target: combatantName(target),
    hit: false, critical: false, damage: 0, parts: [], killed: false, notes: [], heal: 0,
  };
  if (!canAct(attacker) || !isAlive(target)) return entry;

  const ranged = !!o.ranged;
  const w = isMonster(attacker) ? null : activeWeapon(attacker, ranged);
  // ignoreAC belongs on the to-hit roll (it is an accuracy trick, not extra
  // damage): fold in both the item enchant and the weapon skill's Master
  // bonus, which used to be computed after the roll and thrown away.
  let ignoreAC = w ? (w.mods.ignoreAC || 0) : 0;
  if (w && w.skill) {
    const s = (attacker.skills || {})[w.skill];
    if (s && s.level > 0 && s.mastery >= MASTERY.MASTER) {
      ignoreAC += (skillEffect(w.skill, s.level, s.mastery).special || {}).ignoreAC || 0;
    }
  }
  const roll = attackRoll(attacker, target, rand, { ranged, ignoreAC });
  entry.chance = roll.chance;
  if (!roll.hit) return entry;
  entry.hit = true;
  entry.critical = roll.critical;

  if (isMonster(attacker)) {
    const which = o.attackIndex === 2 ? 2 : 1;
    const dmg = monsterDamage(attacker, which, rand);
    if (!dmg) return entry;
    const res = applyDamage(target, roll.critical ? dmg.amount * 2 : dmg.amount, dmg.element, rand, { missile: ranged });
    entry.damage = res.dealt;
    entry.parts = [{ amount: res.dealt, element: dmg.element }];
    entry.killed = res.killed;
    if (res.immune) entry.notes.push('immune');
    if (attacker.def.inflict) {
      if (tryInflict(target, attacker.def.inflict.condition, attacker.def.inflict.chance, rand)) {
        entry.notes.push(attacker.def.inflict.condition);
      }
    }
    return entry;
  }

  const dmg = weaponDamage(attacker, w, target, rand, { ranged, critical: roll.critical });
  entry.notes = dmg.notes.slice();
  for (const p of dmg.parts) {
    const res = applyDamage(target, p.amount, p.element, rand, { missile: ranged, ignoreAC: dmg.ignoreAC });
    entry.damage += res.dealt;
    entry.parts.push({ amount: res.dealt, element: p.element });
    if (res.killed) entry.killed = true;
    if (res.immune) entry.notes.push(`immune:${p.element}`);
  }
  if (dmg.notes.indexOf('stun') >= 0) tryInflict(target, 'asleep', 100, rand);
  if (dmg.notes.indexOf('paralyze') >= 0) tryInflict(target, 'paralyzed', 100, rand);
  if (dmg.inflict) tryInflict(target, dmg.inflict.condition, dmg.inflict.chance, rand);

  // Riders the presentation layer consumes: an exploding weapon bursts at the
  // victim, knockback shoves the sprite.
  if (dmg.explodes && entry.damage > 0) entry.explodes = true;
  if (dmg.knockback && entry.damage > 0) entry.knockback = dmg.knockback;

  if (dmg.vampiric && entry.damage > 0) {
    const heal = Math.round(entry.damage * dmg.vampiric);
    attacker.hp = Math.min(maxHP(attacker), attacker.hp + heal);
    entry.heal = heal;
    entry.notes.push('drain');
  }
  if (dmg.drainSP) {
    // Only meaningful against casters, but harmless otherwise.
    if (isMonster(target)) target.spDrained = (target.spDrained || 0) + dmg.drainSP;
  }
  return entry;
}

/**
 * Cast an offensive spell at one target.
 *
 * Multi-bolt contract (Sparks, Shrapmetal): the `dmg` spec is *per bolt* and
 * every bolt rolls its own dice, so a cast that lands all its bolts deals
 * roughly `spellDamageAvg` in total - the same convention spells.js uses for
 * the book page and the balance harness. One roll divided across the bolts
 * (the old behaviour) silently disagreed with both.
 */
export function resolveSpellAttack(caster, spell, target, skillLevel, mastery, rand) {
  const entry = { attacker: combatantName(caster), target: combatantName(target), spell: spell.id, damage: 0, killed: false, notes: [] };
  const tinfo = isMonster(target) ? { maxHP: target.maxHP, hp: target.hp } : { maxHP: maxHP(target), hp: target.hp };
  if (spell.vsUndeadOnly && !(isMonster(target) && target.def.undead)) {
    entry.notes.push('unaffected');
    return entry;
  }
  let roll = spellDamage(spell, skillLevel, mastery, rand, tinfo);
  const hits = roll.hits || 1;
  entry.hits = hits;
  for (let i = 0; i < hits; i++) {
    if (i > 0) roll = spellDamage(spell, skillLevel, mastery, rand, tinfo);
    const res = applyDamage(target, Math.max(1, Math.round(roll.amount)), roll.element, rand, {});
    entry.damage += res.dealt;
    if (res.killed) { entry.killed = true; break; }
    if (res.immune) { entry.notes.push('immune'); break; }
  }
  if (spell.inflict) tryInflict(target, spell.inflict.condition, spell.inflict.chance, rand);
  if (spell.drain && entry.damage > 0) entry.heal = Math.round(entry.damage * 0.5);
  return entry;
}

// ---------------------------------------------------------------------------
// Turn order and the real-time clock
// ---------------------------------------------------------------------------

/**
 * Turn-based ordering. MM6 sorts by recovery time, so the fastest characters
 * and monsters act first; ties break on Speed.
 */
export function turnOrder(combatants) {
  return combatants.filter(canAct).slice().sort((a, b) => {
    const ra = isMonster(a) ? monsterRecovery(a) : recoveryFor(a);
    const rb = isMonster(b) ? monsterRecovery(b) : recoveryFor(b);
    if (ra !== rb) return ra - rb;
    const sa = isMonster(a) ? a.def.speed : bonusOf(a, 'speed');
    const sb = isMonster(b) ? b.def.speed : bonusOf(b, 'speed');
    return sb - sa;
  });
}

/**
 * Advance every combatant's recovery counter by `ticks`. Real-time mode calls
 * this every frame with `dt * TICKS_PER_SECOND`; anyone whose counter reaches
 * zero may act. Returns the list of combatants that just became ready.
 */
export const TICKS_PER_SECOND = 60;

export function tickRecovery(combatants, ticks) {
  const ready = [];
  for (const c of combatants) {
    if (!isAlive(c)) continue;
    if (c.recovery === undefined) c.recovery = 0;
    if (c.recovery > 0) {
      c.recovery -= ticks;
      if (c.recovery <= 0) { c.recovery = 0; if (canAct(c)) ready.push(c); }
    } else if (canAct(c)) ready.push(c);
  }
  return ready;
}

/** Spend an action: put the combatant back on the recovery clock. */
export function spendAction(c, ranged) {
  c.recovery = isMonster(c) ? monsterRecovery(c) : recoveryFor(c, ranged);
  return c.recovery;
}

/**
 * Per-tick effects: poison and disease drain, regeneration, buff expiry.
 * `minutes` is game time elapsed.
 */
export function tickConditions(character, minutes, rand) {
  const out = { hpLost: 0, spLost: 0, hpGained: 0 };
  const conds = character.conditions || {};
  for (const id of Object.keys(conds)) {
    if (!conds[id]) continue;
    const spec = CONDITIONS[id];
    if (!spec) continue;
    if (spec.hpDrainPerTick) {
      const loss = Math.max(1, Math.round(spec.hpDrainPerTick * minutes / 5));
      applyDamage(character, loss, 'body', rand, { resistPhysical: false });
      out.hpLost += loss;
    }
    if (spec.spDrainPerTick) {
      const loss = Math.max(1, Math.round(spec.spDrainPerTick * minutes / 5));
      character.sp = Math.max(0, (character.sp | 0) - loss);
      out.spLost += loss;
    }
  }
  const buffs = character.buffs || {};
  if (buffs.regeneration && isAlive(character)) {
    const gain = Math.round((buffs.regeneration.power || 1) * minutes / 5);
    character.hp = Math.min(maxHP(character), character.hp + gain);
    out.hpGained += gain;
  }
  for (const k of Object.keys(buffs)) {
    const b = buffs[k];
    if (b && b.expires !== undefined) {
      b.expires -= minutes;
      if (b.expires <= 0) delete buffs[k];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Monster AI
// ---------------------------------------------------------------------------

const dist3 = (a, b) => {
  const dx = (a.x || 0) - (b.x || 0), dy = (a.y || 0) - (b.y || 0), dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const MELEE_RANGE = 250;

/**
 * Decide what a monster does this instant.
 * Returns { type, target, spell, distance, reason } where type is one of
 *   'idle' | 'approach' | 'melee' | 'ranged' | 'cast' | 'flee'
 *
 * `party` is the array of characters (with an optional shared position on
 * `world.partyPos`); `world` supplies `{ partyPos, indoors, time }`.
 */
export function monsterAct(monster, party, world, rand) {
  const out = { type: 'idle', target: null, spell: null, distance: 0, reason: '' };
  if (!isAlive(monster)) return out;
  if (!canAct(monster)) { out.reason = 'incapacitated'; return out; }

  const pos = (world && world.partyPos) || { x: 0, y: 0, z: 0 };
  const d = dist3(monster, pos);
  out.distance = d;

  const conds = monster.conditions || {};
  const buffs = monster.buffs || {};

  // Charmed, enslaved or afraid monsters do not attack the party.
  if (conds.charmed || buffs.charm) { out.type = 'idle'; out.reason = 'charmed'; return out; }
  if (conds.afraid || buffs.fear || monster.fleeing) { out.type = 'flee'; out.reason = 'afraid'; return out; }

  // Wounded cowards run.
  if (monster.def.fleeAtHP && monster.hp < monster.maxHP * monster.def.fleeAtHP) {
    out.type = 'flee'; out.reason = 'wounded'; return out;
  }
  if (!monster.hostile) { out.reason = 'peaceful'; return out; }

  // MONSTERS.TXT AI classes. 'wary' keeps its distance and prefers ranged
  // attacks; 'suicide' closes regardless; 'normal' needs to be provoked at
  // range; 'aggress' charges the moment it notices you.
  const ai = monster.def.aiType || 'normal';
  const aggro = monster.def.aggroRange * (ai === 'aggress' ? 1.3 : ai === 'wary' ? 0.8 : 1);
  if (d > aggro && monster.state !== 'engaged') { out.reason = 'unaware'; return out; }

  // Pick a victim: the closest conscious character, biased toward the weakest.
  const targets = party.filter((c) => isAlive(c) && !(c.conditions && c.conditions.unconscious));
  if (!targets.length) { out.reason = 'no targets'; return out; }
  let target = targets[0];
  let best = -Infinity;
  for (const c of targets) {
    // Prefer low HP fraction and low armour class.
    const score = (1 - c.hp / Math.max(1, maxHP(c))) * 2 + (40 - armorClass(c)) / 40 + rand.float(0, 0.6);
    if (score > best) { best = score; target = c; }
  }
  out.target = target;

  if (d <= MELEE_RANGE) { out.type = 'melee'; out.reason = 'in reach'; return out; }

  const r = monster.def.ranged;
  // Feeblemind takes the spell away but not the bow.
  const spellBlocked = r && r.spell && conds.feebleminded;
  if (r && !spellBlocked && d <= (r.range || 3000)) {
    // Casters prefer their spell; archers loose an arrow. A wary monster shoots
    // whenever it can rather than closing; a suicidal one never bothers.
    const p = ai === 'wary' ? 0.9 : ai === 'suicide' ? 0.1 : monster.def.caster ? 0.7 : 0.55;
    if (rand.bool(p)) {
      out.type = r.spell ? 'cast' : 'ranged';
      out.spell = r.spell || null;
      out.reason = 'at range';
      return out;
    }
  }
  out.type = 'approach';
  out.reason = 'closing';
  return out;
}

/** Carry out a monster's decided intent against the party. */
export function performMonsterAction(monster, intent, rand) {
  const entries = [];
  if (!intent || !intent.target) return entries;
  switch (intent.type) {
    case 'melee': {
      entries.push(resolveAttack(monster, intent.target, rand, {}));
      if (monster.def.attack2 && rand.bool(0.6)) {
        entries.push(resolveAttack(monster, intent.target, rand, { attackIndex: 2 }));
      }
      break;
    }
    case 'ranged': {
      const r = monster.def.ranged;
      const roll = attackRoll(monster, intent.target, rand, { ranged: true });
      const e = { attacker: monster.def.name, target: intent.target.name, hit: roll.hit, damage: 0, killed: false, notes: ['ranged'] };
      if (roll.hit) {
        const amount = rand.dice(r.damage.n, r.damage.s) + (r.bonus || 0);
        const res = applyDamage(intent.target, amount, r.element || 'physical', rand, { missile: true });
        e.damage = res.dealt; e.killed = res.killed;
      }
      entries.push(e);
      break;
    }
    case 'cast': {
      // A monster spell is an attack, not an entitlement: it rolls to hit
      // (with a bonus - spells are hard to dodge) and the target's elemental
      // resistance then applies its save inside applyDamage.
      const r = monster.def.ranged;
      const roll = attackRoll(monster, intent.target, rand, { ranged: true, attackBonus: Math.round(monster.level * 0.5) + 5 });
      const e = {
        attacker: monster.def.name, target: intent.target.name, hit: roll.hit,
        damage: 0, killed: false, spell: r.spell, notes: ['spell'],
      };
      if (roll.hit) {
        const amount = rand.dice(r.damage.n, r.damage.s) + (r.bonus || 0);
        const res = applyDamage(intent.target, amount, r.element || 'magic', rand, {});
        e.damage = res.dealt; e.killed = res.killed;
        const sp = spellById(r.spell);
        if (sp && sp.inflict) tryInflict(intent.target, sp.inflict.condition, sp.inflict.chance, rand);
        if (monster.def.inflict) tryInflict(intent.target, monster.def.inflict.condition, Math.round(monster.def.inflict.chance / 2), rand);
      }
      entries.push(e);
      break;
    }
    default: break;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/**
 * Split XP across the party. MM6 divides the kill's value among every living
 * member (unconscious members still learn; dead ones do not), then applies
 * each character's Learning skill individually.
 */
export function awardXP(party, amount) {
  const eligible = party.filter((c) => {
    const cond = c.conditions || {};
    return !cond.dead && !cond.eradicated && !cond.stoned;
  });
  if (!eligible.length) return [];
  const share = Math.max(1, Math.floor(amount / eligible.length));
  const out = [];
  for (const c of eligible) {
    const gained = Math.max(1, Math.round(share * learningMultiplier(c)));
    c.xp = (c.xp | 0) + gained;
    const newLevel = levelForXP(c.xp);
    out.push({ character: c.name, gained, xp: c.xp, canLevel: newLevel > (c.level | 0), atLevel: newLevel });
  }
  return out;
}

/** XP a single monster is worth, before division. */
export function xpFor(monster) {
  return isMonster(monster) ? monster.def.xp : 0;
}

/** Gold a monster drops. */
export function goldFor(monster, rand) {
  const base = isMonster(monster) ? monster.def.gold : 0;
  if (!base) return 0;
  return Math.max(0, Math.round(base * rand.float(0.6, 1.4)));
}

// ---------------------------------------------------------------------------
// Auto-resolution (used by the balance harness and by "flee" fallbacks)
// ---------------------------------------------------------------------------

/** Best offensive spell this character can afford right now. */
export function bestAttackSpell(character, spells) {
  let best = null, bestDmg = 0;
  for (const id of (character.spells || [])) {
    const sp = spellById(id);
    if (!sp || sp.type !== 'damage') continue;
    const sk = (character.skills || {})[sp.school];
    if (!sk || sk.level <= 0) continue;
    const cost = sp.sp;
    if ((character.sp | 0) < cost) continue;
    const est = (sp.dmg ? (sp.dmg.n0 + sp.dmg.nPer * sk.level) * (sp.dmg.s + 1) / 2 + sp.dmg.flat + sp.dmg.flatPer * sk.level : 0);
    if (est > bestDmg) { bestDmg = est; best = sp; }
  }
  return best;
}

/** The enemy the party should be shooting at: the one closest to dying. */
export function pickTarget(monsters) {
  let target = null;
  for (const m of monsters) {
    if (!isAlive(m)) continue;
    if (!target || m.hp < target.hp) target = m;
  }
  return target;
}

/** Whichever hand this character fights better with. */
function prefersBow(c) {
  const eq = c.equipment || {};
  if (!eq.bow) return false;
  if (!eq.mainhand) return true;
  const bowSkill = (c.skills || {}).bow;
  const md = itemDef(eq.mainhand.def);
  const meleeSkill = md && md.skill ? (c.skills || {})[md.skill] : null;
  return (bowSkill ? bowSkill.level : 0) > (meleeSkill ? meleeSkill.level : 0);
}

/**
 * One character's action against a group of monsters: heal a dying ally, nuke
 * with the best spell that is worth its spell points, or swing.
 */
export function characterAct(c, party, monsters, rand, opts) {
  const o = opts || {};
  const log = [];
  const target = pickTarget(monsters);
  if (!target) return log;

  // Emergency healing takes priority over damage.
  if (o.useSpells !== false && c.spells && c.spells.indexOf('first_aid') >= 0) {
    let worst = null;
    for (const m of party) {
      if (!isAlive(m)) continue;
      if (m.hp < maxHP(m) * 0.3 && (!worst || m.hp < worst.hp)) worst = m;
    }
    const healSpell = c.spells.indexOf('power_cure') >= 0 ? spellById('power_cure') : spellById('first_aid');
    if (worst && healSpell) {
      const sk = (c.skills || {})[healSpell.school];
      if (sk && sk.level > 0 && c.sp >= healSpell.sp) {
        c.sp -= healSpell.sp;
        const amount = Math.round((healSpell.pow.base + healSpell.pow.per * sk.level) * (1 + sk.mastery * 0.15));
        const targets = healSpell.target === 'party' ? party : [worst];
        for (const t of targets) {
          if (!isAlive(t)) continue;
          t.hp = Math.min(maxHP(t), t.hp + amount);
          if (t.hp > 0 && t.conditions) delete t.conditions.unconscious;
        }
        log.push({ attacker: c.name, target: worst.name, heal: amount, damage: 0, hit: true, notes: ['heal'] });
        return log;
      }
    }
  }

  if (o.useSpells !== false) {
    const sp = bestAttackSpell(c, null);
    if (sp) {
      const sk = c.skills[sp.school];
      const cost = sp.sp;
      // Keep a reserve so the caster is not empty the moment it matters.
      if (c.sp >= cost && (c.sp > maxSP(c) * 0.25 || target.hp > 60)) {
        c.sp -= cost;
        log.push(resolveSpellAttack(c, sp, target, sk.level, sk.mastery, rand));
        return log;
      }
    }
  }
  log.push(resolveAttack(c, target, rand, { ranged: prefersBow(c) }));
  return log;
}

/** One monster's action. Places it in contact first when auto-resolving. */
export function monsterTurn(monster, party, rand, opts) {
  const o = opts || {};
  const world = { partyPos: { x: 0, y: 0, z: 0 }, indoors: !!o.indoors };
  monster.x = 0; monster.y = 0;
  monster.z = o.range !== undefined ? o.range : 100;
  monster.state = 'engaged';
  const intent = monsterAct(monster, party, world, rand);
  if (monster.def.regen && monster.hp < monster.maxHP) {
    monster.hp = Math.min(monster.maxHP, monster.hp + monster.def.regen);
  }
  return performMonsterAction(monster, intent, rand);
}

/**
 * Resolve one full round: every conscious character acts once, then every
 * living monster acts once. Simple and readable - the turn-based UI uses this.
 * `simulateFight` uses the finer-grained recovery clock instead.
 */
export function autoResolveRound(party, monsters, rand, opts) {
  const log = [];
  for (const c of party) {
    if (!canAct(c)) continue;
    if (!monsters.some(isAlive)) break;
    for (const e of characterAct(c, party, monsters, rand, opts)) log.push(e);
  }
  for (const m of monsters) {
    if (!isAlive(m) || !canAct(m)) continue;
    for (const e of monsterTurn(m, party, rand, opts)) log.push(e);
  }
  return {
    log,
    partyDown: party.every((c) => !canAct(c)),
    monstersDown: !monsters.some(isAlive),
  };
}

/**
 * Fight on the real recovery clock: whoever recovers first acts first, and a
 * fast character genuinely gets more swings than a slow one. `maxRounds` is in
 * notional rounds of TICKS_PER_TURN ticks each.
 *
 * Returns the summary the balance report reads.
 */
export function simulateFight(party, monsters, rand, maxRounds = 40, opts) {
  const o = opts || {};
  const all = party.concat(monsters);
  for (const c of all) c.recovery = 0;

  const maxTicks = maxRounds * TICKS_PER_TURN;
  let ticks = 0;
  let partyDamage = 0, monsterDamage = 0;
  let guard = maxRounds * 200;

  const partyHP = () => party.reduce((t, c) => t + Math.max(0, c.hp), 0);
  const monsterHP = () => monsters.reduce((t, m) => t + Math.max(0, m.hp), 0);

  while (ticks < maxTicks && guard-- > 0) {
    // Who is next off the recovery clock?
    let next = null;
    for (const c of all) {
      if (!isAlive(c) || !canAct(c)) continue;
      if (!next || c.recovery < next.recovery) next = c;
    }
    if (!next) break;

    const step = Math.max(0, next.recovery);
    if (step > 0) {
      for (const c of all) if (c.recovery > 0) c.recovery -= step;
      ticks += step;
      if (ticks >= maxTicks) break;
    }

    if (isMonster(next)) {
      const before = partyHP();
      monsterTurn(next, party, rand, o);
      monsterDamage += Math.max(0, before - partyHP());
      next.recovery = monsterRecovery(next);
    } else {
      const before = monsterHP();
      characterAct(next, party, monsters, rand, o);
      partyDamage += Math.max(0, before - monsterHP());
      next.recovery = recoveryFor(next, prefersBow(next));
    }

    if (!monsters.some(isAlive)) {
      return { win: true, rounds: Math.max(1, ticks / TICKS_PER_TURN), ticks, partyDamage, monsterDamage };
    }
    if (party.every((c) => !canAct(c))) {
      return { win: false, rounds: Math.max(1, ticks / TICKS_PER_TURN), ticks, partyDamage, monsterDamage };
    }
  }
  return {
    win: false, rounds: Math.max(1, ticks / TICKS_PER_TURN), ticks,
    partyDamage, monsterDamage, timeout: true,
  };
}
