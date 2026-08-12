// The party: character creation, progression, inventory, equipment and the
// game clock. This is the object the whole game hangs off.
//
// A party is plain data - no class instances, no functions stored on it - so
// `serialize` is a structural copy and `deserialize` needs no revival step
// beyond restoring the uid counters.

import { Rand } from '../core/rng.js';
import {
  CLASSES, BASE_CLASSES, STAT_IDS, CONDITIONS, statBonus, xpForLevel, levelForXP,
  maxHP, maxSP, armorClass, recoveryTime, resistance, effectiveStats, worstCondition,
  isIncapacitated, RESIST_IDS, MAX_LEVEL, trainingCost, priceMultipliers, derivedSummary,
} from './stats.js';
import {
  MASTERY, CLASS_START_SKILLS, classSkillMax, skillPointCost, skillById,
} from './skills.js';
import {
  SLOTS, INV_W, INV_H, itemDef, itemMods, itemValue, itemName,
  startingKit, setUidCounter, uidCounter, potionById, TYPE_SLOT,
} from './items.js';
import { spellById, spellPower, spellDuration, schoolSkill, SPELLS_BY_SCHOOL } from './spells.js';
import { firstName } from './npcnames.js';

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_MONTH = 28;
export const MONTHS_PER_YEAR = 12;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

/** Game time runs 30x real time, and the engine ticks 128 times a second. */
export const TIME_SCALE = 30;
export const ENGINE_TICKS_PER_SECOND = 128;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** MM6 opens on the 1st of January, 1165. */
export const START_YEAR = 1165;

/** Break the party's absolute minute count into a calendar. */
export function clockOf(party) {
  const total = party.minutes | 0;
  const minute = total % MINUTES_PER_HOUR;
  const hour = Math.floor(total / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const dayIndex = Math.floor(total / MINUTES_PER_DAY);
  const day = (dayIndex % DAYS_PER_MONTH) + 1;
  const month = Math.floor(dayIndex / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
  const year = START_YEAR + Math.floor(dayIndex / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  return {
    minute, hour, day, month, year,
    dayIndex,
    weekday: DAY_NAMES[dayIndex % 7],
    monthName: MONTH_NAMES[month],
    isNight: hour < 5 || hour >= 21,
    text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${DAY_NAMES[dayIndex % 7]} ${day} ${MONTH_NAMES[month]} ${year}`,
  };
}

/** Convert real seconds of play into game minutes. */
export function gameMinutesFor(realSeconds) { return (realSeconds * TIME_SCALE) / 60; }

// ---------------------------------------------------------------------------
// Inventory grid
// ---------------------------------------------------------------------------

/** A fresh 14x9 grid. Cells hold an item uid, or 0. */
export function makeInventory() {
  return { w: INV_W, h: INV_H, cells: new Array(INV_W * INV_H).fill(0), items: [] };
}

function fits(inv, x, y, gw, gh) {
  if (x < 0 || y < 0 || x + gw > inv.w || y + gh > inv.h) return false;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (inv.cells[(y + j) * inv.w + (x + i)] !== 0) return false;
    }
  }
  return true;
}

function stamp(inv, x, y, gw, gh, uid) {
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) inv.cells[(y + j) * inv.w + (x + i)] = uid;
  }
}

/** First free rectangle that fits a gw x gh item, or null. */
export function findSpot(inv, gw, gh) {
  for (let y = 0; y <= inv.h - gh; y++) {
    for (let x = 0; x <= inv.w - gw; x++) {
      if (fits(inv, x, y, gw, gh)) return { x, y };
    }
  }
  return null;
}

/** Place an item. Returns true on success, false when the pack is full. */
export function invAdd(inv, item, x, y) {
  if (!item) return false;
  const gw = item.gw || 1, gh = item.gh || 1;
  let px = x, py = y;
  if (px === undefined || py === undefined || !fits(inv, px, py, gw, gh)) {
    const spot = findSpot(inv, gw, gh);
    if (!spot) return false;
    px = spot.x; py = spot.y;
  }
  item.x = px; item.y = py;
  stamp(inv, px, py, gw, gh, item.uid);
  inv.items.push(item);
  return true;
}

/** Remove an item by uid. Returns the item, or null. */
export function invRemove(inv, uid) {
  const idx = inv.items.findIndex((it) => it.uid === uid);
  if (idx < 0) return null;
  const item = inv.items[idx];
  stamp(inv, item.x, item.y, item.gw || 1, item.gh || 1, 0);
  inv.items.splice(idx, 1);
  item.x = -1; item.y = -1;
  return item;
}

/** The item occupying a grid square, or null. */
export function invAt(inv, x, y) {
  if (x < 0 || y < 0 || x >= inv.w || y >= inv.h) return null;
  const uid = inv.cells[y * inv.w + x];
  if (!uid) return null;
  return inv.items.find((it) => it.uid === uid) || null;
}

/** Free squares remaining. */
export function invFree(inv) {
  let n = 0;
  for (let i = 0; i < inv.cells.length; i++) if (inv.cells[i] === 0) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const BIO_OPENERS = [
  'Grew up in a fishing village and left the moment there was a boat.',
  'Third child of a minor house; inherited nothing but the name.',
  'Apprenticed to a smith, ran away with the smith\'s daughter\'s horse.',
  'Served six years in the guard and does not talk about the seventh.',
  'Orphaned by the Baa riots and raised in a temple kitchen.',
  'Came to Enroth on a ship that sank on the way back.',
  'Was a scholar until the library burned down.',
  'Says very little about the years before New Sorpigal.',
  'Ran a tavern into the ground and joined the party to escape the debt.',
  'Claims to be a lost heir. Nobody has checked.',
  'Studied at the Guild of the Elements and was politely asked to leave.',
  'Has been arrested in four towns, convicted in none.',
];

let CHAR_ID = 1;

/**
 * Roll a character. `opts.stats` overrides the class spread, `opts.name` the
 * generated name.
 */
export function createCharacter(rand, classId, opts) {
  const o = opts || {};
  const klass = CLASSES[classId] || CLASSES.knight;
  const sex = o.sex || (rand.bool() ? 'm' : 'f');
  const base = Object.assign({}, klass.startStats, o.stats || {});
  // A little variation so two Knights are not identical.
  if (!o.stats) {
    for (const id of STAT_IDS) base[id] = Math.max(1, base[id] + rand.int(-2, 2));
  }

  const c = {
    id: CHAR_ID++,
    name: o.name || firstName(rand, sex),
    sex,
    class: classId,
    level: 1,
    xp: o.xp || 0,
    age: o.age !== undefined ? o.age : rand.int(18, 26),
    birthYear: START_YEAR - (o.age !== undefined ? o.age : 20),
    stats: base,
    skills: {},
    spells: [],
    conditions: {},
    buffs: {},
    hp: 1, sp: 0,
    // Ticks down in real time after acting; the HUD gem reads it every frame,
    // so it must exist from birth (undefined <= 0 is false and the gem sticks red).
    recovery: 0,
    skillPoints: 0,
    equipment: {},
    inventory: makeInventory(),
    biography: o.biography || rand.pick(BIO_OPENERS),
    portraitSeed: o.portraitSeed !== undefined ? o.portraitSeed : rand.int(0, 0x7fffffff),
    // Equipment-derived caches, refreshed by recompute().
    statMods: zeroStats(), acMods: 0, attackMods: 0, damageMods: 0,
    hpMods: 0, spMods: 0, recoveryMods: 0,
    resistances: zeroResists(), resistMods: zeroResists(),
    skillMods: {}, armorSkillActive: {},
    // Bookkeeping.
    kills: 0, deaths: 0, awards: [],
  };

  // Starting skills, at level 1 Normal.
  for (const skillId of (CLASS_START_SKILLS[classId] || [])) {
    if (classSkillMax(classId, skillId) > 0) c.skills[skillId] = { level: 1, mastery: MASTERY.NORMAL };
  }
  // Casters open their book with the first two spells of each starting school.
  for (const skillId of Object.keys(c.skills)) {
    const def = skillById(skillId);
    if (!def || def.category !== 'magic') continue;
    const list = SPELLS_BY_SCHOOL[skillId] || [];
    for (let i = 0; i < 2 && i < list.length; i++) c.spells.push(list[i].id);
  }

  recompute(c);
  c.hp = maxHP(c);
  c.sp = maxSP(c);
  return c;
}

function zeroStats() {
  const o = {};
  for (const id of STAT_IDS) o[id] = 0;
  return o;
}
function zeroResists() {
  const o = {};
  for (const id of RESIST_IDS) o[id] = 0;
  return o;
}

/**
 * Recalculate every equipment-derived cache. Call after any change to
 * equipment, level or conditions. Cheap enough to call freely.
 */
export function recompute(c) {
  c.statMods = zeroStats();
  c.resistMods = zeroResists();
  c.skillMods = {};
  c.armorSkillActive = {};
  c.acMods = 0; c.attackMods = 0; c.damageMods = 0;
  c.hpMods = 0; c.spMods = 0; c.recoveryMods = 0;

  for (const slot of SLOTS) {
    const item = c.equipment[slot];
    if (!item || item.broken) continue;
    const mods = itemMods(item);
    for (const id of STAT_IDS) c.statMods[id] += mods[id] || 0;
    for (const r of RESIST_IDS) c.resistMods[r] += (mods.resist[r] || 0);
    for (const s of Object.keys(mods.skill)) c.skillMods[s] = (c.skillMods[s] || 0) + mods.skill[s];
    // A weapon's attack/damage riders are NOT cached here: combat.js adds
    // w.mods.attack / w.mods.damage per swing (attackRoll / weaponDamage), so
    // caching them too would count every enchant twice. A weapon's "+N" also
    // never grants armour class.
    const def = itemDef(item.def);
    const isWeapon = def && (def.type === 'weapon' || def.type === 'bow');
    if (!isWeapon) {
      c.acMods += mods.ac || 0;
      c.attackMods += mods.attack || 0;
      c.damageMods += mods.damage || 0;
    }
    c.hpMods += mods.hp || 0;
    c.spMods += mods.sp || 0;
    c.recoveryMods += mods.recovery || 0;
    if (def && def.skill && ['leather', 'chain', 'plate', 'shield'].indexOf(def.skill) >= 0) {
      c.armorSkillActive[def.skill] = true;
    }
  }
  // Clamp the pools to their new maxima.
  const mh = maxHP(c), ms = maxSP(c);
  if (c.hp > mh) c.hp = mh;
  if (c.sp > ms) c.sp = ms;
  return c;
}

/** Effective skill level, including any "+N to skill" from equipment. */
export function skillLevel(c, skillId) {
  const s = c.skills && c.skills[skillId];
  if (!s) return 0;
  return (s.level | 0) + ((c.skillMods && c.skillMods[skillId]) || 0);
}

export function skillMastery(c, skillId) {
  const s = c.skills && c.skills[skillId];
  return s ? s.mastery | 0 : MASTERY.NONE;
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/** MM6 grants 5 skill points a level, and rolls HP/SP from the class dice. */
export const SKILL_POINTS_PER_LEVEL = 5;

/**
 * Advance one level. Returns a report of what changed, or null if the
 * character has not earned it.
 */
export function levelUp(c, rand) {
  const earned = levelForXP(c.xp);
  if (earned <= c.level || c.level >= MAX_LEVEL) return null;
  const beforeHP = maxHP(c), beforeSP = maxSP(c);
  c.level += 1;
  c.skillPoints += SKILL_POINTS_PER_LEVEL;
  // Every fourth level the character's constitution improves a little.
  if (c.level % 4 === 0 && rand) {
    const stat = rand.pick(STAT_IDS);
    c.stats[stat] += 1;
  }
  recompute(c);
  const report = {
    level: c.level,
    hpGained: maxHP(c) - beforeHP,
    spGained: maxSP(c) - beforeSP,
    skillPoints: SKILL_POINTS_PER_LEVEL,
  };
  // The new level's dice are added to the pools, but training is not a heal:
  // wounds keep their depth and an unconscious trainee stays down until
  // someone actually treats them.
  c.hp = Math.min(maxHP(c), c.hp + Math.max(0, report.hpGained));
  c.sp = Math.min(maxSP(c), c.sp + Math.max(0, report.spGained));
  return report;
}

/** Can this character train right now, and what does it cost? */
export function canTrain(c) {
  const earned = levelForXP(c.xp);
  if (earned <= c.level) return { ok: false, reason: 'Not enough experience.', cost: 0 };
  if (c.level >= MAX_LEVEL) return { ok: false, reason: 'Already at maximum level.', cost: 0 };
  return { ok: true, reason: '', cost: trainingCost(c.level) };
}

/** Spend one skill point raising a skill. */
export function spendSkillPoint(c, skillId) {
  const s = c.skills[skillId];
  if (!s) return { ok: false, reason: 'You have not learned that skill.' };
  const cost = skillPointCost(s.level);
  if (c.skillPoints < cost) return { ok: false, reason: `Needs ${cost} skill points.` };
  // A skill cannot exceed the level its mastery rank allows.
  const cap = s.mastery === MASTERY.NORMAL ? 4 : s.mastery === MASTERY.EXPERT ? 8 : 60;
  if (s.level >= cap) {
    return { ok: false, reason: s.mastery >= MASTERY.MASTER ? 'Already at the maximum.' : 'A teacher must raise your rank first.' };
  }
  c.skillPoints -= cost;
  s.level += 1;
  recompute(c);
  return { ok: true, level: s.level, spent: cost, reason: '' };
}

/** Learn a skill at Normal rank, level 1. Costs one skill point. */
export function learnSkill(c, skillId) {
  if (c.skills[skillId]) return { ok: false, reason: 'Already known.' };
  if (classSkillMax(c.class, skillId) <= 0) {
    return { ok: false, reason: `A ${CLASSES[c.class].name} cannot learn that.` };
  }
  if (c.skillPoints < 1) return { ok: false, reason: 'No skill points.' };
  c.skillPoints -= 1;
  c.skills[skillId] = { level: 1, mastery: MASTERY.NORMAL };
  recompute(c);
  return { ok: true, reason: '' };
}

/** A teacher raises the rank. The caller charges the gold. */
export function raiseMastery(c, skillId, mastery) {
  const s = c.skills[skillId];
  if (!s) return { ok: false, reason: 'You have not learned that skill.' };
  const cap = classSkillMax(c.class, skillId);
  if (mastery > cap) return { ok: false, reason: `A ${CLASSES[c.class].name} cannot go beyond ${['-', 'Normal', 'Expert', 'Master'][cap]}.` };
  if (mastery <= s.mastery) return { ok: false, reason: 'You already hold that rank.' };
  if (mastery !== s.mastery + 1) return { ok: false, reason: 'One rank at a time.' };
  const need = mastery === MASTERY.EXPERT ? 4 : 8;
  if (s.level < need) return { ok: false, reason: `Skill level ${need} is required.` };
  s.mastery = mastery;
  recompute(c);
  return { ok: true, reason: '' };
}

/** Learn a spell from a book or a guild. */
export function learnSpell(c, spellId) {
  const sp = spellById(spellId);
  if (!sp) return { ok: false, reason: 'No such spell.' };
  if (c.spells.indexOf(spellId) >= 0) return { ok: false, reason: 'Already in your book.' };
  const sk = c.skills[sp.school];
  if (!sk) return { ok: false, reason: `You have no skill in ${sp.school} magic.` };
  const maxTier = [0, 4, 7, 11][sk.mastery] || 0;
  if (sp.tier > maxTier) return { ok: false, reason: 'Your rank is too low for that spell.' };
  c.spells.push(spellId);
  return { ok: true, reason: '' };
}

/** Promote to the next class in the line (a quest reward). */
export function promote(c) {
  const klass = CLASSES[c.class];
  if (!klass || !klass.promotesTo) return { ok: false, reason: 'There is no further promotion.' };
  c.class = klass.promotesTo;
  recompute(c);
  return { ok: true, reason: '', to: c.class };
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/** Which slot would this item go in for this character? */
export function slotFor(c, item) {
  const def = itemDef(item.def);
  const type = def ? def.type : item.type;
  const base = TYPE_SLOT[type] || null;
  if (base === 'ring1') return c.equipment.ring1 && !c.equipment.ring2 ? 'ring2' : 'ring1';
  return base;
}

/**
 * Equip an item out of the character's pack. Handles two-handed weapons,
 * bows, rings and swapping. Returns { ok, reason, unequipped[] }.
 */
export function equip(c, item, slotOverride) {
  const def = itemDef(item.def);
  if (!def) return { ok: false, reason: 'That cannot be equipped.', unequipped: [] };
  const slot = slotOverride || slotFor(c, item);
  if (!slot) return { ok: false, reason: 'That cannot be equipped.', unequipped: [] };

  // MM6 lets anyone wear anything, but an unskilled wearer eats the penalty.
  const removed = [];
  const swapOut = (s) => {
    const cur = c.equipment[s];
    if (cur) {
      delete c.equipment[s];
      if (!invAdd(c.inventory, cur)) { c.equipment[s] = cur; return false; }
      removed.push(cur);
    }
    return true;
  };

  if (def.twoHanded && slot === 'mainhand') {
    if (!swapOut('offhand')) return { ok: false, reason: 'No room to put down your shield.', unequipped: removed };
  }
  if (slot === 'offhand' && c.equipment.mainhand) {
    const mh = itemDef(c.equipment.mainhand.def);
    if (mh && mh.twoHanded) {
      // A spear master may hold a shield with a spear; nobody else may.
      const spearOK = mh.skill === 'spear' && skillMastery(c, 'spear') >= MASTERY.EXPERT;
      if (!spearOK && !swapOut('mainhand')) return { ok: false, reason: 'No room to put down your weapon.', unequipped: removed };
    }
  }
  if (!swapOut(slot)) return { ok: false, reason: 'Your pack is full.', unequipped: removed };

  invRemove(c.inventory, item.uid);
  c.equipment[slot] = item;
  recompute(c);
  return { ok: true, reason: '', slot, unequipped: removed };
}

/** Take an item off and put it back in the pack. */
export function unequip(c, slot) {
  const item = c.equipment[slot];
  if (!item) return { ok: false, reason: 'Nothing there.' };
  if (!invAdd(c.inventory, item)) return { ok: false, reason: 'Your pack is full.' };
  delete c.equipment[slot];
  recompute(c);
  return { ok: true, reason: '', item };
}

/**
 * How useful is this item to *this* character? Gold value is a terrible guide -
 * a Knight will happily buy a wizard's staff at the price of a good sword - so
 * score weapons by the damage they would actually do in this character's hands
 * and armour by the protection net of the recovery it costs.
 */
export function itemScore(c, item) {
  const def = itemDef(item && item.def);
  if (!def) return 0;
  const mods = itemMods(item);
  let score = 0;

  // Stat, resistance and pool bonuses are worth the same wherever they appear.
  for (const id of STAT_IDS) score += (mods[id] || 0) * 0.4;
  for (const r of RESIST_IDS) score += (mods.resist[r] || 0) * 0.15;
  score += (mods.hp || 0) * 0.25 + (mods.sp || 0) * 0.25;
  if (mods.elemental) for (const e of mods.elemental) score += (e.dice.n * (e.dice.s + 1)) / 2;
  score += (mods.vampiric || 0) * 20;

  if (def.dice) {
    const skill = def.skill ? c.skills[def.skill] : null;
    if (def.skill && classSkillMax(c.class, def.skill) <= 0) return -1; // cannot use it at all
    const lv = skill ? skill.level : 0;
    const mastery = skill ? skill.mastery : 0;
    const dmg = (def.dice.n * (def.dice.s + 1)) / 2 + (def.dice.plus || 0)
      + (mods.damage || 0) + (mastery >= MASTERY.EXPERT ? lv * (mastery >= MASTERY.MASTER ? 1.75 : 1) : 0);
    // Swings per notional round: a fast weapon in a trained hand beats a
    // sluggish one that hits harder.
    const recovery = Math.max(20, (def.recovery || 100) - (mods.recovery || 0));
    score += (dmg * 100) / recovery;
    // An unskilled weapon is a liability whatever it rolls.
    if (lv <= 0) score *= 0.25;
    if (def.twoHanded) score *= 0.85;
    return score;
  }

  if (def.ac !== undefined) {
    if (def.skill && classSkillMax(c.class, def.skill) <= 0) return -1;
    const skill = def.skill ? c.skills[def.skill] : null;
    const trained = skill && skill.mastery >= MASTERY.EXPERT;
    score += (def.ac || 0) + (mods.ac || 0);
    // Recovery penalty only bites until the armour skill reaches Expert.
    if (!trained) score -= (def.recovery || 0) * 0.35;
    if (def.skill && (!skill || skill.level <= 0)) score -= 4;
    return score;
  }
  return score;
}

/**
 * Equip the best of everything in the pack. Two passes so a slot is not
 * blocked by a mediocre item that arrived first.
 */
export function autoEquip(c) {
  const equipped = [];
  for (let pass = 0; pass < 2; pass++) {
    const candidates = c.inventory.items
      .filter((it) => { const d = itemDef(it.def); return d && TYPE_SLOT[d.type]; })
      .map((it) => ({ it, s: itemScore(c, it) }))
      .filter((e) => e.s > 0)
      .sort((a, b) => b.s - a.s);
    let changed = false;
    for (const { it, s } of candidates) {
      const slot = slotFor(c, it);
      if (!slot) continue;
      const cur = c.equipment[slot];
      if (cur && itemScore(c, cur) >= s) continue;
      // A two-hander must beat the weapon *and* the shield it displaces.
      const def = itemDef(it.def);
      if (def.twoHanded && slot === 'mainhand' && c.equipment.offhand) {
        const combined = (cur ? itemScore(c, cur) : 0) + itemScore(c, c.equipment.offhand);
        if (combined >= s) continue;
      }
      if (equip(c, it, slot).ok) { equipped.push(it); changed = true; }
    }
    if (!changed) break;
  }
  return equipped;
}

// ---------------------------------------------------------------------------
// Items in use
// ---------------------------------------------------------------------------

/**
 * Use a consumable. Handles potions, scrolls (cast at skill 5), spell books,
 * wands (spends a charge) and food. Returns { ok, reason, consumed }.
 */
export function useItem(c, item, party) {
  if (!item) return { ok: false, reason: 'Nothing to use.', consumed: false };

  if (item.type === 'potion') {
    const p = potionById(item.def);
    if (!p) return { ok: false, reason: 'That does nothing.', consumed: false };
    const e = p.effect;
    if (e.heal === 'hp') {
      c.hp = e.full ? maxHP(c) : Math.min(maxHP(c), c.hp + (p.power || 10));
      if (c.conditions.unconscious && c.hp > 0) delete c.conditions.unconscious;
    }
    if (e.heal === 'sp') c.sp = e.full ? maxSP(c) : Math.min(maxSP(c), c.sp + (p.power || 10));
    if (e.cure) for (const id of e.cure) delete c.conditions[id];
    if (e.cureAll) c.conditions = {};
    if (e.permStat) { c.stats[e.permStat] += e.power || 1; recompute(c); }
    if (e.buff) c.buffs[e.buff] = { power: e.power || 1, expires: 60 };
    return { ok: true, reason: `${itemName(item)} drunk.`, consumed: true };
  }

  if (item.type === 'scroll' && item.spellId) {
    return { ok: true, reason: `Casts ${item.spellId}.`, consumed: true, cast: item.spellId, skill: 5, mastery: MASTERY.NORMAL };
  }

  if (item.type === 'wand' && item.spellId) {
    if (item.charges <= 0) return { ok: false, reason: 'The wand is spent.', consumed: false };
    item.charges -= 1;
    return { ok: true, reason: `Casts ${item.spellId}.`, consumed: item.charges <= 0, cast: item.spellId, skill: 8, mastery: MASTERY.EXPERT };
  }

  if (item.type === 'spellbook' && item.spellId) {
    const r = learnSpell(c, item.spellId);
    return { ok: r.ok, reason: r.reason || 'Learned.', consumed: r.ok };
  }

  if (item.type === 'food' && party) {
    party.food += item.quantity || 1;
    return { ok: true, reason: 'Rations stowed.', consumed: true };
  }

  if (item.type === 'gold' && party) {
    party.gold += item.quantity || 0;
    return { ok: true, reason: `${item.quantity} gold.`, consumed: true };
  }

  return { ok: false, reason: 'Nothing happens.', consumed: false };
}

// ---------------------------------------------------------------------------
// The party object
// ---------------------------------------------------------------------------

/** MM6's default line-up. */
export const DEFAULT_ROSTER = ['knight', 'cleric', 'sorcerer', 'archer'];

/**
 * Build a party. `roster` is an array of up to four class ids, or of
 * { class, name, sex, stats } records.
 */
export function createParty(seed, roster) {
  const rand = new Rand(seed === undefined ? 'mm6' : seed);
  const list = (roster && roster.length ? roster : DEFAULT_ROSTER).slice(0, 4);

  const members = list.map((entry) => {
    const spec = typeof entry === 'string' ? { class: entry } : entry;
    const classId = BASE_CLASSES.indexOf(spec.class) >= 0 || CLASSES[spec.class] ? spec.class : 'knight';
    const c = createCharacter(rand, classId, spec);
    for (const item of startingKit(classId)) invAdd(c.inventory, item);
    autoEquip(c);
    c.hp = maxHP(c); c.sp = maxSP(c);
    return c;
  });

  return {
    seed: String(seed === undefined ? 'mm6' : seed),
    members,
    gold: 200,
    food: 5,
    minutes: 9 * MINUTES_PER_HOUR, // MM6 starts at nine in the morning.
    reputation: 0,
    fame: 0,
    buffs: {},
    hirelings: [],
    beacons: [],
    visitedTowns: ['new_sorpigal'],
    autonotes: [],
    awards: [],
    quests: {},
    deaths: 0,
    monstersKilled: 0,
    position: { x: 0, y: 0, z: 0, yaw: 0, region: 'new_sorpigal' },
    flags: {},
    version: 1,
  };
}

/** The characters who can currently act. */
export function activeMembers(party) {
  return party.members.filter((c) => !isIncapacitated(c));
}

/** The character the AI and the UI treat as "in front". */
export function leader(party) {
  return activeMembers(party)[0] || party.members[0];
}

// ---------------------------------------------------------------------------
// Money and supplies
// ---------------------------------------------------------------------------

export function addGold(party, amount) {
  party.gold = Math.max(0, (party.gold | 0) + (amount | 0));
  return party.gold;
}

export function canAfford(party, cost) { return (party.gold | 0) >= (cost | 0); }

export function spendGold(party, cost) {
  if (!canAfford(party, cost)) return false;
  party.gold -= cost | 0;
  return true;
}

export function addFood(party, n) {
  party.food = Math.max(0, (party.food | 0) + (n | 0));
  return party.food;
}

/** Eat a day's rations. Returns false when the party is out of food. */
export function eatFood(party) {
  if ((party.food | 0) <= 0) return false;
  party.food -= 1;
  return true;
}

/** The best price multipliers anyone in the party can negotiate. */
export function bestPrices(party, townFactor) {
  let best = { buy: Infinity, sell: 0 };
  for (const c of party.members) {
    if (isIncapacitated(c)) continue;
    const p = priceMultipliers(c, townFactor === undefined ? 1 : townFactor);
    if (p.buy < best.buy) best.buy = p.buy;
    if (p.sell > best.sell) best.sell = p.sell;
  }
  if (best.buy === Infinity) best = { buy: townFactor || 1, sell: 0.25 };
  return best;
}

// ---------------------------------------------------------------------------
// Time and rest
// ---------------------------------------------------------------------------

/**
 * Push the clock forward. Buffs expire, poison bites, hirelings take their cut
 * at the turn of each day. Returns a list of things the log should mention.
 */
export function advanceTime(party, minutes, rand) {
  const m = Math.max(0, Math.round(minutes));
  const from = party.minutes;
  party.minutes += m;
  const events = tickTimeEffects(party, m, rand, from);
  // Mark how far the timeline's side effects have been applied, so the
  // session's realtime ticker (which watches party.minutes move) does not
  // apply the same span twice.
  party._tickedTo = party.minutes;
  return events;
}

/**
 * The side effects of `minutes` of game time passing, WITHOUT moving
 * party.minutes - for callers (the session clock is backed by party.minutes)
 * where the minutes have already been added. `fromMinutes` is the timeline
 * position the span started at, used for day/year boundaries.
 */
export function tickTimeEffects(party, minutes, rand, fromMinutes) {
  const events = [];
  const from = fromMinutes === undefined ? party.minutes - minutes : fromMinutes;
  const before = clockOf({ minutes: from });
  const after = clockOf(party);

  for (const k of Object.keys(party.buffs)) {
    const b = party.buffs[k];
    if (b && b.expires !== undefined) {
      b.expires -= minutes;
      if (b.expires <= 0) { delete party.buffs[k]; events.push(`${k} has worn off.`); }
    }
  }
  for (const c of party.members) {
    for (const k of Object.keys(c.buffs)) {
      const b = c.buffs[k];
      if (b && b.expires !== undefined) {
        b.expires -= minutes;
        if (b.expires <= 0) delete c.buffs[k];
      }
    }
    // Poison and disease grind away over time.
    const conds = c.conditions;
    if (!conds.dead && !conds.eradicated) {
      for (const id of Object.keys(conds)) {
        if (!conds[id]) continue;
        const spec = CONDITIONS[id];
        if (!spec) continue;
        if (spec.hpDrainPerTick) {
          const loss = Math.max(1, Math.round((spec.hpDrainPerTick * minutes) / 60));
          c.hp -= loss;
          if (c.hp <= 0) { c.hp = 0; conds.unconscious = true; }
          if (c.hp <= -maxHP(c)) { conds.dead = true; events.push(`${c.name} has died of poison.`); }
        }
        if (spec.spDrainPerTick) {
          c.sp = Math.max(0, c.sp - Math.max(1, Math.round((spec.spDrainPerTick * minutes) / 60)));
        }
      }
    }
  }

  // Age the party as years pass.
  const yearsPassed = after.year - before.year;
  if (yearsPassed > 0) {
    for (const c of party.members) c.age += yearsPassed;
    events.push('Another year gone.');
  }
  // Hirelings are paid daily.
  if (after.dayIndex > before.dayIndex && party.hirelings.length) {
    const wage = party.hirelings.reduce((t, h) => t + (h.dailyWage || 0), 0) * (after.dayIndex - before.dayIndex);
    if (wage > 0) {
      if (party.gold >= wage) { party.gold -= wage; events.push(`Paid ${wage} gold in wages.`); }
      else {
        events.push('You cannot pay your hirelings. They leave.');
        party.hirelings.length = 0;
      }
    }
  }
  return events;
}

export const REST_HOURS = 8;

/**
 * Rest. Costs one ration, takes eight hours, and restores hit points and spell
 * points in full. Weak and Drunk wear off; wounds and poison do not.
 * `opts.safe` is false when resting in the wild, where a rest may be
 * interrupted.
 */
export function restParty(party, rand, opts) {
  const o = opts || {};
  const hours = o.hours || REST_HOURS;
  if (!o.free && !eatFood(party)) {
    return { ok: false, reason: 'You have no food.', events: [] };
  }
  // Resting in the open can be interrupted; the caller spawns the ambush.
  if (o.safe === false && rand && rand.bool(0.25)) {
    const events = advanceTime(party, 60, rand);
    return { ok: false, reason: 'Your rest is interrupted!', interrupted: true, events };
  }

  const events = advanceTime(party, hours * MINUTES_PER_HOUR, rand);
  for (const c of party.members) {
    if (c.conditions.dead || c.conditions.eradicated || c.conditions.stoned) continue;
    delete c.conditions.unconscious;
    delete c.conditions.weak;
    delete c.conditions.drunk;
    delete c.conditions.asleep;
    delete c.conditions.afraid;
    c.hp = maxHP(c);
    c.sp = maxSP(c);
    c.buffs = {};
  }
  party.buffs = {};
  events.push('The party rests.');
  return { ok: true, reason: '', events };
}

/** A temple heals everything for gold. */
export function templeHeal(party, character, cost) {
  if (!spendGold(party, cost)) return { ok: false, reason: 'You cannot afford it.' };
  character.conditions = {};
  character.hp = maxHP(character);
  character.sp = maxSP(character);
  return { ok: true, reason: `${character.name} is made whole.` };
}

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

/** Apply a spell's buff to one character or the whole party. */
export function applyBuff(target, buffId, power, minutes) {
  const holder = target.members ? target : target;
  const bag = holder.buffs || (holder.buffs = {});
  const existing = bag[buffId];
  if (existing && existing.power > power && existing.expires > minutes) return false;
  bag[buffId] = { power, expires: minutes };
  return true;
}

/** Cast a support spell from the party screen. */
export function castSupportSpell(party, caster, spellId, targetIndex) {
  const sp = spellById(spellId);
  if (!sp) return { ok: false, reason: 'No such spell.' };
  const sk = schoolSkill(caster, sp.school);
  const power = spellPower(sp, sk.level, sk.mastery);
  const dur = spellDuration(sp, sk.level, sk.mastery);
  const targets = sp.target === 'party' ? party.members
    : [party.members[targetIndex === undefined ? 0 : targetIndex]];

  if (sp.type === 'heal') {
    for (const t of targets) {
      if (t.conditions.dead || t.conditions.eradicated) continue;
      t.hp = Math.min(maxHP(t), t.hp + power);
      if (t.hp > 0) delete t.conditions.unconscious;
    }
  }
  if (sp.cures) {
    for (const t of targets) {
      for (const id of sp.cures) {
        if (t.conditions[id]) {
          delete t.conditions[id];
          if (id === 'dead' && sp.leaves) t.conditions[sp.leaves] = true;
          if (id === 'dead') { t.hp = Math.max(1, t.hp); delete t.conditions.unconscious; }
        }
      }
    }
  }
  if (sp.type === 'buff') {
    if (sp.resist) {
      for (const t of targets) applyBuff(t, 'protection_from_' + sp.resist, power, dur);
    } else {
      for (const t of targets) applyBuff(t, sp.id, power, dur);
    }
  }
  if (sp.id === 'divine_intervention') {
    for (const t of party.members) { t.conditions = {}; t.hp = maxHP(t); t.sp = maxSP(t); }
    caster.age += 3;
  }
  return { ok: true, reason: '', power, duration: dur };
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

/**
 * Try to give an item to the party: gold and food go straight into the pools,
 * everything else looks for a pack with room. Returns the character who took
 * it, or null when everyone is full.
 */
export function giveItem(party, item) {
  if (!item) return null;
  if (item.type === 'gold') { addGold(party, item.quantity || 0); return party.members[0]; }
  if (item.type === 'food') { addFood(party, item.quantity || 1); return party.members[0]; }
  // Spread the load: whoever has the most room takes it.
  const sorted = party.members.slice().sort((a, b) => invFree(b.inventory) - invFree(a.inventory));
  for (const c of sorted) if (invAdd(c.inventory, item)) return c;
  return null;
}

/** Total gold value of everything the party is carrying. */
export function partyWorth(party) {
  let total = party.gold | 0;
  for (const c of party.members) {
    for (const it of c.inventory.items) total += itemValue(it);
    for (const slot of SLOTS) if (c.equipment[slot]) total += itemValue(c.equipment[slot]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Awards and notes
// ---------------------------------------------------------------------------

export function addAutonote(party, text, category) {
  if (party.autonotes.some((n) => n.text === text)) return false;
  party.autonotes.push({ text, category: category || 'note', at: party.minutes });
  return true;
}

export function addAward(party, character, text) {
  const bag = character ? character.awards : party.awards;
  if (bag.indexOf(text) >= 0) return false;
  bag.push(text);
  return true;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * A JSON-safe snapshot. Item instances are already plain objects that only
 * reference definitions by id, so this is a deep structural copy plus the uid
 * counters that keep new items from colliding with saved ones.
 */
export function serialize(party) {
  return JSON.stringify({
    v: 1,
    itemUid: uidCounter(),
    charUid: CHAR_ID,
    party,
  });
}

/** Restore a party from `serialize`. */
export function deserialize(json) {
  const blob = typeof json === 'string' ? JSON.parse(json) : json;
  const party = blob.party;
  setUidCounter(blob.itemUid || 1);
  CHAR_ID = blob.charUid || 1;
  // The grid is stored as a plain array; make sure it is the right length.
  for (const c of party.members) {
    if (!c.inventory.cells || c.inventory.cells.length !== INV_W * INV_H) {
      const inv = makeInventory();
      for (const it of (c.inventory.items || [])) invAdd(inv, it, it.x, it.y);
      c.inventory = inv;
    }
    recompute(c);
  }
  return party;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Everything the character sheet needs, in one object. */
export function characterSheet(c) {
  return {
    name: c.name,
    className: CLASSES[c.class] ? CLASSES[c.class].name : c.class,
    level: c.level,
    xp: c.xp,
    xpNext: c.level < MAX_LEVEL ? xpForLevel(c.level + 1) : c.xp,
    stats: effectiveStats(c),
    bonuses: STAT_IDS.reduce((o, id) => { o[id] = statBonus(effectiveStats(c)[id]); return o; }, {}),
    hp: c.hp, maxHP: maxHP(c),
    sp: c.sp, maxSP: maxSP(c),
    ac: armorClass(c),
    recovery: recoveryTime(c),
    condition: worstCondition(c).name,
    age: c.age,
    skillPoints: c.skillPoints,
    resistances: RESIST_IDS.reduce((o, id) => { o[id] = resistance(c, id); return o; }, {}),
    derived: derivedSummary(c),
  };
}

/** One-line status for the HUD portrait row. */
export function statusLine(c) {
  const cond = worstCondition(c);
  return `${c.name}  ${c.hp}/${maxHP(c)} HP  ${c.sp}/${maxSP(c)} SP  ${cond.name}`;
}
