// Character statistics, classes, conditions and the derived-stat maths.
//
// This is the numeric bedrock of the MM6 rules. Everything here is pure data +
// pure functions: no RNG state is held, no other game module is imported except
// skills.js (for the Body Building / Meditation contributions to HP/SP), which
// is itself dependency-free.

import { MASTERY, skillEffect } from './skills.js';

// ---------------------------------------------------------------------------
// Primary statistics
// ---------------------------------------------------------------------------

/** The seven primary statistics, in MM6's character-sheet order. */
export const STATS = [
  { id: 'might', name: 'Might', abbr: 'MGT', desc: 'Melee damage and carrying capacity.' },
  { id: 'intellect', name: 'Intellect', abbr: 'INT', desc: 'Spell points for Sorcerers and Druids.' },
  { id: 'personality', name: 'Personality', abbr: 'PER', desc: 'Spell points for Clerics and Druids.' },
  { id: 'endurance', name: 'Endurance', abbr: 'END', desc: 'Hit points.' },
  { id: 'accuracy', name: 'Accuracy', abbr: 'ACC', desc: 'Chance to hit in combat.' },
  { id: 'speed', name: 'Speed', abbr: 'SPD', desc: 'Armour class and recovery time.' },
  { id: 'luck', name: 'Luck', abbr: 'LCK', desc: 'Resistance rolls and treasure quality.' },
];

export const STAT_IDS = STATS.map((s) => s.id);

// MM6's stat -> modifier staircase. The table is a list of [threshold, bonus]
// pairs; a stat of `v` uses the bonus of the highest threshold <= v.
const STAT_BONUS_TABLE = [
  [1, -6], [3, -5], [4, -4], [5, -3], [6, -2], [7, -1], [9, 0], [11, 1],
  [13, 2], [15, 3], [17, 4], [19, 5], [21, 6], [25, 7], [30, 8], [35, 9],
  [40, 10], [45, 11], [50, 12], [75, 13], [100, 14], [125, 15], [150, 16],
  [175, 17], [200, 18], [225, 19], [250, 20],
];

/**
 * MM6 stat modifier. A stat of 9-10 is "average" and gives +0; every step up
 * the table is worth one more point of bonus. Values above 250 stay at +20,
 * values below 1 clamp to -6.
 */
export function statBonus(value) {
  const v = value | 0;
  if (v < 1) return -6;
  // Small table: a linear scan beats binary search and never allocates.
  let bonus = -6;
  for (let i = 0; i < STAT_BONUS_TABLE.length; i++) {
    if (v >= STAT_BONUS_TABLE[i][0]) bonus = STAT_BONUS_TABLE[i][1];
    else break;
  }
  return bonus;
}

/** The full staircase, exported for the character-sheet tooltip. */
export const STAT_BONUS_TABLE_RO = STAT_BONUS_TABLE.map((p) => ({ at: p[0], bonus: p[1] }));

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 50;

/**
 * Total experience required to *be* level n. MM6 uses triangular growth:
 * 1000 * (n-1) * n / 2 -> L2 1000, L3 3000, L4 6000, L5 10000, L6 15000.
 */
export function xpForLevel(n) {
  if (n <= 1) return 0;
  return (1000 * (n - 1) * n) / 2;
}

/** Highest level whose XP requirement is met. */
export function levelForXP(xp) {
  if (xp < 1000) return 1;
  // Invert 500n^2 - 500n - xp = 0.
  const n = Math.floor((1 + Math.sqrt(1 + (4 * xp) / 500)) / 2);
  const lv = Math.min(MAX_LEVEL, Math.max(1, n));
  // Guard against float drift at the boundaries.
  if (xpForLevel(lv + 1) <= xp && lv < MAX_LEVEL) return lv + 1;
  if (xpForLevel(lv) > xp) return lv - 1;
  return lv;
}

/** XP still needed to reach the next level. */
export function xpToNext(xp) {
  const lv = levelForXP(xp);
  if (lv >= MAX_LEVEL) return 0;
  return xpForLevel(lv + 1) - xp;
}

/** MM6 charges gold to train: 100 * currentLevel per level gained. */
export function trainingCost(level) {
  return 100 * level;
}

// ---------------------------------------------------------------------------
// Resistances
// ---------------------------------------------------------------------------

/**
 * The seven resistances. MM6 folds the elemental schools into the damage
 * elements: Air is electrical, Water is cold, Earth is poison/acid.
 */
export const RESISTANCES = [
  { id: 'fire', name: 'Fire', school: 'fire' },
  { id: 'air', name: 'Air', school: 'air', alias: 'electric' },
  { id: 'water', name: 'Water', school: 'water', alias: 'cold' },
  { id: 'earth', name: 'Earth', school: 'earth', alias: 'poison' },
  { id: 'mind', name: 'Mind', school: 'mind' },
  { id: 'body', name: 'Body', school: 'body' },
  { id: 'magic', name: 'Magic', school: 'magic' },
];

export const RESIST_IDS = RESISTANCES.map((r) => r.id);

/** Damage elements the combat code understands. */
export const ELEMENTS = ['physical', 'fire', 'air', 'water', 'earth', 'mind', 'body', 'magic', 'light', 'dark'];

/** Map a damage element onto the resistance that defends against it. */
export function resistForElement(element) {
  switch (element) {
    case 'electric': return 'air';
    case 'cold': return 'water';
    case 'poison': case 'acid': return 'earth';
    case 'light': case 'dark': case 'spirit': return 'magic';
    case 'physical': return null;
    default: return RESIST_IDS.includes(element) ? element : null;
  }
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

// hp / sp are per-level gains; MM6 gives a flat amount per level, but we keep
// a dice notation too so a "roll your hit die" option is possible. The dice
// average equals the flat value so both modes balance identically.
//
// spStat: which primary stat feeds spell points. Druids uniquely average
// Intellect and Personality.

/** All 18 classes: 6 base classes, each with two promotion tiers. */
export const CLASSES = {};

function defClass(def) {
  CLASSES[def.id] = def;
  return def;
}

// --- Knight line: no magic at all, the best armour and weapons in the game.
const KNIGHT_STATS = { might: 30, intellect: 5, personality: 5, endurance: 13, accuracy: 13, speed: 13, luck: 7 };
defClass({
  id: 'knight', name: 'Knight', line: 'knight', tier: 0, promotesTo: 'cavalier',
  hpPerLevel: 5, hpDice: { n: 1, s: 9 }, hpBase: 20,
  spPerLevel: 0, spDice: null, spBase: 0, spStat: null,
  startStats: KNIGHT_STATS, startHP: 45, startSP: 0,
  desc: 'Master of arms. Cannot cast spells, but wears any armour and swings anything.',
  promoQuest: 'Slay the beasts in the Corlagon\'s Estate for Sir Charles Quixote.',
});
defClass({
  id: 'cavalier', name: 'Cavalier', line: 'knight', tier: 1, promotesTo: 'champion',
  hpPerLevel: 5, hpDice: { n: 1, s: 9 }, hpBase: 20,
  spPerLevel: 0, spDice: null, spBase: 0, spStat: null,
  startStats: KNIGHT_STATS, desc: 'A promoted Knight; Master of plate and shield.',
});
defClass({
  id: 'champion', name: 'Champion', line: 'knight', tier: 2, promotesTo: null,
  hpPerLevel: 5, hpDice: { n: 1, s: 9 }, hpBase: 20,
  spPerLevel: 0, spDice: null, spBase: 0, spStat: null,
  startStats: KNIGHT_STATS, desc: 'The finest warrior in Enroth. Master of every weapon skill.',
});

// --- Paladin line: armour plus the three self-magic schools.
const PALADIN_STATS = { might: 15, intellect: 5, personality: 15, endurance: 15, accuracy: 11, speed: 11, luck: 10 };
defClass({
  id: 'paladin', name: 'Paladin', line: 'paladin', tier: 0, promotesTo: 'crusader',
  hpPerLevel: 4, hpDice: { n: 1, s: 7 }, hpBase: 16,
  spPerLevel: 1, spDice: { n: 1, s: 2 }, spBase: 3, spStat: 'personality',
  startStats: PALADIN_STATS, startHP: 35, startSP: 5,
  desc: 'A holy warrior: plate armour and the Spirit, Mind and Body schools.',
  promoQuest: 'Recover the Hero\'s Blade for the Temple of the Sun.',
});
defClass({
  id: 'crusader', name: 'Crusader', line: 'paladin', tier: 1, promotesTo: 'hero',
  hpPerLevel: 4, hpDice: { n: 1, s: 7 }, hpBase: 16,
  spPerLevel: 1, spDice: { n: 1, s: 2 }, spBase: 3, spStat: 'personality',
  startStats: PALADIN_STATS, desc: 'A promoted Paladin, Expert in the self schools.',
});
defClass({
  id: 'hero', name: 'Hero', line: 'paladin', tier: 2, promotesTo: null,
  hpPerLevel: 4, hpDice: { n: 1, s: 7 }, hpBase: 16,
  spPerLevel: 1, spDice: { n: 1, s: 2 }, spBase: 3, spStat: 'personality',
  startStats: PALADIN_STATS, desc: 'Master of Spirit, Mind and Body magic and of arms both.',
});

// --- Archer line: bows and the four elemental schools.
const ARCHER_STATS = { might: 15, intellect: 15, personality: 5, endurance: 12, accuracy: 15, speed: 13, luck: 7 };
defClass({
  id: 'archer', name: 'Archer', line: 'archer', tier: 0, promotesTo: 'battle_mage',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 2, spDice: { n: 1, s: 3 }, spBase: 5, spStat: 'intellect',
  startStats: ARCHER_STATS, startHP: 27, startSP: 9,
  desc: 'Deadly at range, and versed in the four elemental schools.',
  promoQuest: 'Clear the Snergle\'s Caverns for the Bow and Arrow guild.',
});
defClass({
  id: 'battle_mage', name: 'Battle Mage', line: 'archer', tier: 1, promotesTo: 'warrior_mage',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 2, spDice: { n: 1, s: 3 }, spBase: 5, spStat: 'intellect',
  startStats: ARCHER_STATS, desc: 'A promoted Archer; Expert in all four elements.',
});
defClass({
  id: 'warrior_mage', name: 'Warrior Mage', line: 'archer', tier: 2, promotesTo: null,
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 2, spDice: { n: 1, s: 3 }, spBase: 5, spStat: 'intellect',
  startStats: ARCHER_STATS, desc: 'Bow in one hand, Meteor Shower in the other.',
});

// --- Cleric line: Personality casters, the only healers.
const CLERIC_STATS = { might: 11, intellect: 5, personality: 30, endurance: 11, accuracy: 11, speed: 11, luck: 12 };
defClass({
  id: 'cleric', name: 'Cleric', line: 'cleric', tier: 0, promotesTo: 'priest',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 6, spStat: 'personality',
  startStats: CLERIC_STATS, startHP: 25, startSP: 14,
  desc: 'Healer and blesser. Master of Spirit, Mind and Body; may learn Light and Dark.',
  promoQuest: 'Recover the Chalice of Protection for the Temple of Baa\'s rivals.',
});
defClass({
  id: 'priest', name: 'Priest', line: 'cleric', tier: 1, promotesTo: 'high_priest',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 6, spStat: 'personality',
  startStats: CLERIC_STATS, desc: 'A promoted Cleric; the healing spells come cheap now.',
});
defClass({
  id: 'high_priest', name: 'High Priest', line: 'cleric', tier: 2, promotesTo: null,
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 12,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 6, spStat: 'personality',
  startStats: CLERIC_STATS, desc: 'Divine Intervention, Resurrection and Hour of Power.',
});

// --- Sorcerer line: Intellect casters, the elemental artillery.
const SORCERER_STATS = { might: 5, intellect: 30, personality: 7, endurance: 9, accuracy: 13, speed: 13, luck: 13 };
defClass({
  id: 'sorcerer', name: 'Sorcerer', line: 'sorcerer', tier: 0, promotesTo: 'wizard',
  hpPerLevel: 2, hpDice: { n: 1, s: 3 }, hpBase: 8,
  spPerLevel: 4, spDice: { n: 1, s: 7 }, spBase: 8, spStat: 'intellect',
  startStats: SORCERER_STATS, startHP: 19, startSP: 20,
  desc: 'The elemental artillery. Frail, but Incinerate ends arguments.',
  promoQuest: 'Deliver the tome to the Guild of the Elements in Free Haven.',
});
defClass({
  id: 'wizard', name: 'Wizard', line: 'sorcerer', tier: 1, promotesTo: 'archmage',
  hpPerLevel: 2, hpDice: { n: 1, s: 3 }, hpBase: 8,
  spPerLevel: 4, spDice: { n: 1, s: 7 }, spBase: 8, spStat: 'intellect',
  startStats: SORCERER_STATS, desc: 'A promoted Sorcerer; Master of two elements and more.',
});
defClass({
  id: 'archmage', name: 'Archmage', line: 'sorcerer', tier: 2, promotesTo: null,
  hpPerLevel: 2, hpDice: { n: 1, s: 3 }, hpBase: 8,
  spPerLevel: 4, spDice: { n: 1, s: 7 }, spBase: 8, spStat: 'intellect',
  startStats: SORCERER_STATS, desc: 'Master of all four elements, and of Light and Dark.',
});

// --- Druid line: the generalist caster; SP from Intellect *and* Personality.
const DRUID_STATS = { might: 9, intellect: 15, personality: 15, endurance: 11, accuracy: 11, speed: 13, luck: 12 };
defClass({
  id: 'druid', name: 'Druid', line: 'druid', tier: 0, promotesTo: 'great_druid',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 10,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 7, spStat: 'both',
  startStats: DRUID_STATS, startHP: 23, startSP: 16,
  desc: 'Seven schools of magic, none mastered lightly. Spell points from both casting stats.',
  promoQuest: 'Prove yourself to the circle of druids in the Bootleg Bay tunnels.',
});
defClass({
  id: 'great_druid', name: 'Great Druid', line: 'druid', tier: 1, promotesTo: 'arch_druid',
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 10,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 7, spStat: 'both',
  startStats: DRUID_STATS, desc: 'A promoted Druid; Expert in all seven of its schools.',
});
defClass({
  id: 'arch_druid', name: 'Arch Druid', line: 'druid', tier: 2, promotesTo: null,
  hpPerLevel: 3, hpDice: { n: 1, s: 5 }, hpBase: 10,
  spPerLevel: 3, spDice: { n: 1, s: 5 }, spBase: 7, spStat: 'both',
  startStats: DRUID_STATS, desc: 'The widest spell list in Enroth.',
});

/** The six classes a new character may be rolled as. */
export const BASE_CLASSES = ['knight', 'paladin', 'archer', 'cleric', 'sorcerer', 'druid'];

export function classById(id) { return CLASSES[id] || null; }

/** ['knight','cavalier','champion'] for any member of that line. */
export function classLine(id) {
  const k = CLASSES[id];
  if (!k) return [];
  return Object.values(CLASSES).filter((c) => c.line === k.line).sort((a, b) => a.tier - b.tier).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

// `severity` orders the portrait/status display: the highest-severity active
// condition is the one shown. `blocksAction` means the character cannot act.
// `curedBy` lists spell ids; `serviceCost` is the temple's price multiplier.

export const CONDITIONS = {
  good: {
    id: 'good', name: 'Good', severity: 0, blocksAction: false, curedBy: [], serviceCost: 0,
    desc: 'Hale and whole.',
  },
  cursed: {
    id: 'cursed', name: 'Cursed', severity: 1, blocksAction: false,
    statMul: {}, attackMod: -20, acMod: -10, curedBy: ['remove_curse', 'divine_intervention'], serviceCost: 1,
    desc: 'All attacks miss more often and blessings will not stick.',
  },
  weak: {
    id: 'weak', name: 'Weak', severity: 2, blocksAction: false,
    statMul: { all: 0.75 }, attackMod: -5, curedBy: ['cure_weakness', 'power_cure', 'divine_intervention'], serviceCost: 1,
    desc: 'Every statistic is reduced by a quarter.',
  },
  drunk: {
    id: 'drunk', name: 'Drunk', severity: 3, blocksAction: false,
    statMul: { intellect: 0.5, accuracy: 0.5, personality: 1.5 }, curedBy: ['cure_weakness'], serviceCost: 1,
    desc: 'Bold of tongue, poor of aim. Wears off with rest.',
  },
  afraid: {
    id: 'afraid', name: 'Afraid', severity: 4, blocksAction: false,
    attackMod: -15, recoveryMul: 1.5, curedBy: ['remove_fear', 'divine_intervention'], serviceCost: 1,
    desc: 'Cannot bring themselves to close with the enemy.',
  },
  poisoned_weak: {
    id: 'poisoned_weak', name: 'Poisoned', severity: 5, blocksAction: false, family: 'poison', rank: 1,
    statMul: { all: 0.9 }, hpDrainPerTick: 1, curedBy: ['cure_poison', 'power_cure', 'divine_intervention'], serviceCost: 2,
    desc: 'Poison gnaws: hit points drain slowly and all statistics suffer.',
  },
  poisoned_severe: {
    id: 'poisoned_severe', name: 'Poisoned (Severe)', severity: 6, blocksAction: false, family: 'poison', rank: 2,
    statMul: { all: 0.75 }, hpDrainPerTick: 2, curedBy: ['cure_poison', 'power_cure', 'divine_intervention'], serviceCost: 4,
    desc: 'The venom has spread.',
  },
  poisoned_deadly: {
    id: 'poisoned_deadly', name: 'Poisoned (Deadly)', severity: 7, blocksAction: false, family: 'poison', rank: 3,
    statMul: { all: 0.5 }, hpDrainPerTick: 4, curedBy: ['cure_poison', 'power_cure', 'divine_intervention'], serviceCost: 8,
    desc: 'Without a cure this will kill.',
  },
  diseased_weak: {
    id: 'diseased_weak', name: 'Diseased', severity: 8, blocksAction: false, family: 'disease', rank: 1,
    statMul: { all: 0.75 }, spDrainPerTick: 1, curedBy: ['cure_disease', 'power_cure', 'divine_intervention'], serviceCost: 3,
    desc: 'A wasting sickness. Statistics and spell points both suffer.',
  },
  diseased_severe: {
    id: 'diseased_severe', name: 'Diseased (Severe)', severity: 9, blocksAction: false, family: 'disease', rank: 2,
    statMul: { all: 0.6 }, spDrainPerTick: 2, curedBy: ['cure_disease', 'power_cure', 'divine_intervention'], serviceCost: 6,
    desc: 'The fever burns.',
  },
  diseased_deadly: {
    id: 'diseased_deadly', name: 'Diseased (Deadly)', severity: 10, blocksAction: false, family: 'disease', rank: 3,
    statMul: { all: 0.4 }, spDrainPerTick: 4, curedBy: ['cure_disease', 'power_cure', 'divine_intervention'], serviceCost: 12,
    desc: 'Death is days away.',
  },
  insane: {
    id: 'insane', name: 'Insane', severity: 11, blocksAction: true,
    statMul: { intellect: 0.25, personality: 0.25 }, curedBy: ['remove_curse', 'divine_intervention'], serviceCost: 10,
    desc: 'The mind is gone. The character cannot be commanded.',
  },
  asleep: {
    id: 'asleep', name: 'Asleep', severity: 12, blocksAction: true, breaksOnDamage: true,
    curedBy: ['awaken', 'divine_intervention'], serviceCost: 1,
    desc: 'Unconscious but unharmed; a blow will wake them.',
  },
  paralyzed: {
    id: 'paralyzed', name: 'Paralyzed', severity: 13, blocksAction: true, acMod: -20,
    curedBy: ['cure_paralysis', 'divine_intervention'], serviceCost: 5,
    desc: 'Rigid and helpless. Attacks against them rarely miss.',
  },
  unconscious: {
    id: 'unconscious', name: 'Unconscious', severity: 14, blocksAction: true,
    curedBy: ['first_aid', 'heal', 'power_cure', 'divine_intervention'], serviceCost: 2,
    desc: 'Hit points reached zero. Any healing restores them to action.',
  },
  dead: {
    id: 'dead', name: 'Dead', severity: 15, blocksAction: true,
    curedBy: ['raise_dead', 'resurrection', 'divine_intervention'], serviceCost: 30,
    desc: 'Dead. Raise Dead returns them Weak; Resurrection returns them whole.',
  },
  stoned: {
    id: 'stoned', name: 'Stoned', severity: 16, blocksAction: true,
    curedBy: ['stone_to_flesh', 'divine_intervention'], serviceCost: 40,
    desc: 'Turned to stone by a medusa or a basilisk.',
  },
  eradicated: {
    id: 'eradicated', name: 'Eradicated', severity: 17, blocksAction: true,
    curedBy: ['divine_intervention'], serviceCost: 200,
    desc: 'Unmade. Only Divine Intervention or the most expensive temple can help.',
  },
};

export const CONDITION_IDS = Object.keys(CONDITIONS);

/** Conditions ordered worst-first, for "which icon do I show" queries. */
export const CONDITIONS_BY_SEVERITY = Object.values(CONDITIONS).sort((a, b) => b.severity - a.severity);

/** The most severe active condition on a character, or the `good` record. */
export function worstCondition(character) {
  const c = character.conditions || {};
  for (const cond of CONDITIONS_BY_SEVERITY) {
    if (cond.id !== 'good' && c[cond.id]) return cond;
  }
  return CONDITIONS.good;
}

/** True when the character is dead, stoned, eradicated, or otherwise out. */
export function isIncapacitated(character) {
  return worstCondition(character).blocksAction === true;
}

/** True for conditions from which a rest or a temple cannot recover them. */
export function isPermanentlyOut(character) {
  const c = character.conditions || {};
  return !!(c.dead || c.stoned || c.eradicated);
}

/** Does `spellId` clear `conditionId`? */
export function cures(spellId, conditionId) {
  const cond = CONDITIONS[conditionId];
  return !!cond && cond.curedBy.indexOf(spellId) >= 0;
}

/** All conditions a given spell removes. */
export function conditionsCuredBy(spellId) {
  return CONDITION_IDS.filter((id) => cures(spellId, id));
}

/** Temple healing price for one character, scaled by the town's price factor. */
export function healCost(character, priceFactor = 1) {
  const c = character.conditions || {};
  let cost = 0;
  for (const id of Object.keys(c)) {
    if (c[id] && CONDITIONS[id]) cost += (CONDITIONS[id].serviceCost || 0) * 10;
  }
  const missing = Math.max(0, maxHP(character) - (character.hp || 0));
  cost += Math.ceil(missing * 0.5);
  return Math.max(1, Math.ceil(cost * priceFactor));
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

/**
 * MM6 ages characters as game years pass and applies a penalty to the physical
 * statistics past middle age. `agePenalty` returns a per-stat *additive* delta.
 */
export const AGE_BANDS = [
  { from: 0, to: 34, might: 0, endurance: 0, accuracy: 0, speed: 0, intellect: 0, personality: 0, luck: 0, name: 'Young' },
  { from: 35, to: 49, might: -2, endurance: -2, accuracy: -1, speed: -3, intellect: 0, personality: 0, luck: 0, name: 'Mature' },
  { from: 50, to: 74, might: -5, endurance: -5, accuracy: -3, speed: -8, intellect: 1, personality: 1, luck: 0, name: 'Middle-aged' },
  { from: 75, to: 99, might: -10, endurance: -10, accuracy: -6, speed: -15, intellect: 2, personality: 2, luck: 0, name: 'Old' },
  { from: 100, to: 149, might: -20, endurance: -20, accuracy: -12, speed: -25, intellect: 3, personality: 3, luck: -2, name: 'Ancient' },
  { from: 150, to: 9999, might: -30, endurance: -30, accuracy: -20, speed: -35, intellect: 4, personality: 4, luck: -5, name: 'Venerable' },
];

export function ageBand(age) {
  for (const b of AGE_BANDS) if (age >= b.from && age <= b.to) return b;
  return AGE_BANDS[AGE_BANDS.length - 1];
}

/** Additive stat deltas from age (plus any magical ageing). */
export function agePenalty(age) {
  const b = ageBand(age);
  return {
    might: b.might, intellect: b.intellect, personality: b.personality,
    endurance: b.endurance, accuracy: b.accuracy, speed: b.speed, luck: b.luck,
  };
}

// ---------------------------------------------------------------------------
// Effective statistics
// ---------------------------------------------------------------------------

const ZERO_MODS = Object.freeze({ might: 0, intellect: 0, personality: 0, endurance: 0, accuracy: 0, speed: 0, luck: 0 });

/**
 * The value of one primary stat after equipment, buffs, age and conditions.
 * Characters carry `stats` (the trained base) plus optional `statMods`
 * (equipment) and `buffs` (temporary). Multiplicative condition penalties are
 * applied last, matching MM6's "Weak halves you no matter how good the gear".
 */
export function effectiveStat(character, statId) {
  const base = (character.stats && character.stats[statId]) || 0;
  const mods = character.statMods || ZERO_MODS;
  const age = agePenalty(character.age || 18);
  let v = base + (mods[statId] || 0) + (age[statId] || 0);

  const buffs = character.buffs || {};
  if (buffs.bless && (statId === 'accuracy' || statId === 'luck')) v += buffs.bless.power || 0;
  if (buffs.heroism && statId === 'might') v += buffs.heroism.power || 0;
  if (buffs.day_of_the_gods) v += buffs.day_of_the_gods.power || 0;
  if (buffs.hour_of_power) v += buffs.hour_of_power.power || 0;
  if (buffs.stat && buffs.stat[statId]) v += buffs.stat[statId];

  const conds = character.conditions || {};
  for (const id of Object.keys(conds)) {
    if (!conds[id]) continue;
    const spec = CONDITIONS[id];
    if (!spec || !spec.statMul) continue;
    if (spec.statMul.all !== undefined) v *= spec.statMul.all;
    if (spec.statMul[statId] !== undefined) v *= spec.statMul[statId];
  }
  return Math.max(0, Math.round(v));
}

/** All seven effective stats at once. */
export function effectiveStats(character) {
  const out = {};
  for (const id of STAT_IDS) out[id] = effectiveStat(character, id);
  return out;
}

/** Shorthand: the MM6 modifier for one of a character's stats. */
export function bonusOf(character, statId) {
  return statBonus(effectiveStat(character, statId));
}

// ---------------------------------------------------------------------------
// Derived statistics
// ---------------------------------------------------------------------------

function skillLevelOf(character, skillId) {
  const s = character.skills && character.skills[skillId];
  return s ? s.level | 0 : 0;
}
function skillMasteryOf(character, skillId) {
  const s = character.skills && character.skills[skillId];
  return s ? s.mastery || MASTERY.NORMAL : MASTERY.NONE;
}

/**
 * Maximum hit points.
 *   (class HP/level + Endurance modifier) * level + class base + Body Building
 * Floored at 1 so a character is never unkillable-by-zero.
 */
export function maxHP(character) {
  const klass = CLASSES[character.class] || CLASSES.knight;
  const level = Math.max(1, character.level | 0);
  const endBonus = bonusOf(character, 'endurance');
  let hp = klass.hpBase + level * (klass.hpPerLevel + endBonus);
  const bb = skillLevelOf(character, 'body_building');
  if (bb > 0) hp += skillEffect('body_building', bb, skillMasteryOf(character, 'body_building')).value;
  hp += (character.hpMods || 0);
  if (character.buffs && character.buffs.hour_of_power) hp += 10;
  return Math.max(1, Math.round(hp));
}

/**
 * Maximum spell points. Non-casters always have 0. Druids average their two
 * casting stats' modifiers, which is why they never out-cast a specialist.
 */
export function maxSP(character) {
  const klass = CLASSES[character.class] || CLASSES.knight;
  if (!klass.spStat) return 0;
  const level = Math.max(1, character.level | 0);
  let statMod;
  if (klass.spStat === 'both') {
    statMod = Math.round((bonusOf(character, 'intellect') + bonusOf(character, 'personality')) / 2);
  } else {
    statMod = bonusOf(character, klass.spStat);
  }
  let sp = klass.spBase + level * (klass.spPerLevel + statMod);
  const med = skillLevelOf(character, 'meditation');
  if (med > 0) sp += skillEffect('meditation', med, skillMasteryOf(character, 'meditation')).value;
  sp += (character.spMods || 0);
  return Math.max(0, Math.round(sp));
}

/**
 * Armour class. Equipment AC + Speed modifier + armour-skill bonuses + buffs.
 * Conditions such as Paralyzed subtract from it.
 */
export function armorClass(character) {
  let ac = character.acMods || 0;
  ac += bonusOf(character, 'speed');
  for (const skillId of ['leather', 'chain', 'plate', 'shield']) {
    const lv = skillLevelOf(character, skillId);
    if (lv > 0 && character.armorSkillActive && character.armorSkillActive[skillId]) {
      ac += skillEffect(skillId, lv, skillMasteryOf(character, skillId)).value;
    }
  }
  const buffs = character.buffs || {};
  if (buffs.stone_skin) ac += buffs.stone_skin.power || 0;
  if (buffs.shield) ac += 0; // Shield halves missile damage; it is not an AC buff.
  if (buffs.day_of_protection) ac += buffs.day_of_protection.power || 0;
  if (buffs.hour_of_power) ac += buffs.hour_of_power.power || 0;

  const conds = character.conditions || {};
  for (const id of Object.keys(conds)) {
    if (conds[id] && CONDITIONS[id] && CONDITIONS[id].acMod) ac += CONDITIONS[id].acMod;
  }
  return Math.max(0, Math.round(ac));
}

/**
 * Attack bonus (the "+N to hit" on the character sheet). Accuracy modifier plus
 * the weapon skill's contribution plus equipment. Melee also counts Might.
 */
export function attackBonus(character, weaponSkillId, ranged = false) {
  // Experience counts for as much as talent: without the level term a
  // veteran's chance to hit would fall behind the armour class curve.
  let atk = bonusOf(character, 'accuracy') + (character.level | 0);
  if (!ranged) atk += Math.floor(bonusOf(character, 'might') / 2);
  if (weaponSkillId) {
    const lv = skillLevelOf(character, weaponSkillId);
    if (lv > 0) atk += skillEffect(weaponSkillId, lv, skillMasteryOf(character, weaponSkillId)).attack || 0;
  }
  atk += character.attackMods || 0;
  const buffs = character.buffs || {};
  if (buffs.bless) atk += buffs.bless.power || 0;
  if (buffs.precision) atk += buffs.precision.power || 0;
  if (buffs.heroism) atk += buffs.heroism.power || 0;
  if (buffs.hour_of_power) atk += (buffs.hour_of_power.power || 0);
  const conds = character.conditions || {};
  for (const id of Object.keys(conds)) {
    if (conds[id] && CONDITIONS[id] && CONDITIONS[id].attackMod) atk += CONDITIONS[id].attackMod;
  }
  return Math.round(atk);
}

/** Flat damage added to every weapon swing. Bows get no Might bonus in MM6. */
export function damageBonus(character, weaponSkillId, ranged = false) {
  let dmg = ranged ? 0 : bonusOf(character, 'might');
  if (weaponSkillId) {
    const lv = skillLevelOf(character, weaponSkillId);
    if (lv > 0) dmg += skillEffect(weaponSkillId, lv, skillMasteryOf(character, weaponSkillId)).damage || 0;
  }
  dmg += character.damageMods || 0;
  const buffs = character.buffs || {};
  if (buffs.heroism) dmg += buffs.heroism.power || 0;
  if (buffs.hammerhands) dmg += buffs.hammerhands.power || 0;
  if (buffs.hour_of_power) dmg += buffs.hour_of_power.power || 0;
  if (buffs.berserk) dmg += 5;
  return Math.round(dmg);
}

/**
 * Recovery time in MM6 ticks: how long after an action before the character may
 * act again. Lower is better. Weapon speed + armour penalty - Speed modifier,
 * halved by Haste, floored at 5 (MM6's cap on how fast anyone can swing).
 */
export const MIN_RECOVERY = 5;
export const TICKS_PER_TURN = 100;

export function recoveryTime(character, weaponRecovery = 100, armorPenalty = 0) {
  let r = weaponRecovery + armorPenalty - bonusOf(character, 'speed') * 2;
  r -= (character.recoveryMods || 0);
  const buffs = character.buffs || {};
  if (buffs.haste) r = Math.round(r * 0.5);
  if (buffs.slow) r = Math.round(r * 2);
  const conds = character.conditions || {};
  for (const id of Object.keys(conds)) {
    if (conds[id] && CONDITIONS[id] && CONDITIONS[id].recoveryMul) r = Math.round(r * CONDITIONS[id].recoveryMul);
  }
  return Math.max(MIN_RECOVERY, Math.round(r));
}

/**
 * A character's total resistance to one school. Equipment and buffs stack;
 * Luck contributes a little to everything, as in MM6.
 */
export function resistance(character, school) {
  const id = resistForElement(school) || school;
  if (!RESIST_IDS.includes(id)) return 0;
  let r = (character.resistances && character.resistances[id]) || 0;
  r += (character.resistMods && character.resistMods[id]) || 0;
  const buffs = character.buffs || {};
  const prot = buffs['protection_from_' + id];
  if (prot) r += prot.power || 0;
  if (buffs.day_of_protection) r += buffs.day_of_protection.power || 0;
  if (buffs.hour_of_power) r += buffs.hour_of_power.power || 0;
  if (buffs.protection_from_magic && id === 'magic') r += buffs.protection_from_magic.power || 0;
  r += Math.max(0, bonusOf(character, 'luck'));
  return Math.max(0, Math.round(r));
}

/**
 * MM6's resistance check. Rolls up to four times; each success halves the
 * damage. Returns the surviving damage. `physical` (null resist) never resists.
 */
export function applyResistance(amount, resistValue, rand) {
  if (resistValue <= 0 || amount <= 0) return amount;
  let dmg = amount;
  for (let i = 0; i < 4; i++) {
    // rand(0, res + 30) >= 30 resists one halving.
    if (rand.int(0, resistValue + 30) >= 30) dmg = Math.floor(dmg / 2);
    else break;
  }
  return Math.max(0, dmg);
}

/** How much a character can carry before being slowed (MM6: Might * 10 lbs). */
export function carryCapacity(character) {
  return effectiveStat(character, 'might') * 10 + 50;
}

/** Bonus experience from the Learning skill, as a multiplier. */
export function learningMultiplier(character) {
  const lv = skillLevelOf(character, 'learning');
  if (lv <= 0) return 1;
  return 1 + skillEffect('learning', lv, skillMasteryOf(character, 'learning')).value / 100;
}

/** Merchant skill's effect on shop prices: returns {buy, sell} multipliers. */
export function priceMultipliers(character, townFactor = 1) {
  const lv = skillLevelOf(character, 'merchant');
  const eff = lv > 0 ? skillEffect('merchant', lv, skillMasteryOf(character, 'merchant')) : { value: 0 };
  const pct = Math.min(90, eff.value);
  return {
    buy: Math.max(0.1, townFactor * (1 - pct / 200)),
    sell: Math.min(1, (0.25 + pct / 200) / townFactor),
  };
}

/** Total of all seven stats: used for "best character" heuristics and awards. */
export function statTotal(character) {
  let t = 0;
  for (const id of STAT_IDS) t += effectiveStat(character, id);
  return t;
}

/** A compact summary object for the UI / debugging. */
export function derivedSummary(character) {
  return {
    maxHP: maxHP(character),
    maxSP: maxSP(character),
    ac: armorClass(character),
    attack: attackBonus(character, null, false),
    damage: damageBonus(character, null, false),
    recovery: recoveryTime(character),
    resist: RESIST_IDS.reduce((o, id) => { o[id] = resistance(character, id); return o; }, {}),
    condition: worstCondition(character).name,
    age: character.age || 18,
    ageBand: ageBand(character.age || 18).name,
  };
}
