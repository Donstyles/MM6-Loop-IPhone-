// The MM6 bestiary, rebuilt from the shipped MONSTERS.TXT roster.
//
// 173 entries: 57 families x 3 tiers (A/B/C) plus 2 uniques. A family shares
// one sprite model across its three tiers; the tiers differ by palette and by
// stats. Ids here are the internal art names (`GoblinA`, `GoblinB`, ...) and
// must match src/art/models/creatures.js exactly.
//
// Levels are the real ones from the file. Hit points are *regenerated* from
//     HP = floor(level * 3 + level^2 * 0.1)
// which reproduces every published row exactly (L2 -> 6, L4 -> 13, L40 -> 280,
// L80 -> 880, L100 -> 1300), so the whole table stays internally consistent.
//
// Everything else - armour class, damage, experience, gold - is derived from
// the level by the curves below, so rebalancing is a one-line change.

/** Biological kinds. Enchantments such as Ghoulsbane match against these. */
export const KINDS = [
  'human', 'humanoid', 'undead', 'beast', 'insect', 'reptile', 'elemental',
  'construct', 'giant', 'dragon', 'demon', 'ooze', 'avian', 'aberration',
];

/** Kept for callers that used the old name. */
export const FAMILIES = KINDS;

/** Regions of Enroth, plus the dungeon themes the spawner treats as regions. */
export const REGIONS = [
  'new_sorpigal', 'castle_ironfist', 'bootleg_bay', 'free_haven', 'silver_cove',
  'blackshire', 'mire_of_the_damned', 'kriegspire', 'eel_infested_waters',
  'dragonsand', 'paradise_valley', 'sweet_water', 'white_cap', 'frozen_highlands',
  'cave', 'crypt', 'temple', 'tower', 'mine', 'sewer', 'ruins', 'lair',
  'pyramid', 'control_center', 'town',
];

/** Hop distance classes from MONSTERS.TXT. */
export const MOVE_TYPES = ['short', 'med', 'long'];
/** AI classes from MONSTERS.TXT. */
export const AI_TYPES = ['normal', 'aggress', 'suicide', 'wary'];

/** Party walk speed, from ARCHITECTURE.md. Monsters are a fraction of it. */
export const PARTY_WALK_SPEED = 384;
/** Nothing outruns the party: the Devil Master is the fastest at 300 u/s. */
export const MAX_MONSTER_SPEED = 310;

// ---------------------------------------------------------------------------
// Derivation curves
// ---------------------------------------------------------------------------

/** The retail HP curve. Reproduces every row of the shipped table. */
export function hpForLevel(level) {
  return Math.floor(level * 3 + level * level * 0.1);
}

/** Armour class rises a little more slowly than level. */
function acForLevel(level, mul) {
  return Math.max(1, Math.round((3 + level * 0.62) * (mul === undefined ? 1 : mul)));
}

/**
 * Damage dice. Aims for an average swing of roughly (5 + level) * mul, spread
 * across bigger dice as the monster grows so the numbers still feel rolled.
 *
 * The flat +5 fades in over the first twelve levels rather than arriving all
 * at once: MM6's tier-1 trash (goblins, rats) hits for 2-4, and a flat +5 on
 * a level-2 rat turned the starter ring into a meat grinder (cycle-2 playtest
 * finding #1). By level 12 the curve rejoins the old one exactly.
 */
function attackForLevel(level, mul, element) {
  const ramp = Math.min(1, level / 12);
  const target = (5 * ramp + level * 1.0) * (mul === undefined ? 1 : mul);
  const n = Math.max(1, Math.min(8, 1 + Math.floor(level / 10)));
  const s = Math.max(4, Math.min(12, 4 + Math.floor(level / 12)));
  const avg = (n * (s + 1)) / 2;
  const bonus = Math.max(0, Math.round(target - avg));
  return { dice: { n, s }, bonus, element: element || 'physical' };
}

/** Experience. Quadratic, so the curve keeps pace with the level table. */
function xpForLevel(level, mul) {
  return Math.round((level * level * 3.2 + level * 22) * (mul === undefined ? 1 : mul));
}

/** Gold carried. Beasts and oozes carry none. */
function goldForLevel(level, mul) {
  return Math.round((level * level * 0.7 + level * 6) * (mul === undefined ? 1 : mul));
}

/** Treasure quality band 1-6. */
function treasureForLevel(level) {
  return Math.max(1, Math.min(6, Math.ceil(level / 17)));
}

// ---------------------------------------------------------------------------
// Family declaration
// ---------------------------------------------------------------------------

const M = [];
const FAMILY_INDEX = {};

// Some traits differ per tier: pass an array of exactly three and `at` picks
// the tier's value. Scalars, objects and two-element ranges pass through.
const at = (v, i) => (Array.isArray(v) && v.length === 3 ? v[i] : v);

// Traits whose *value* is itself a list (spawn regions, immunities, spell
// lists, group-size ranges). A per-tier version is a three-element array whose
// entries are themselves arrays or null; anything else is a single shared list.
const atList = (v, i) => {
  if (!Array.isArray(v)) return v;
  if (v.length === 3 && v.every((x) => x === null || Array.isArray(x))) return v[i];
  return v;
};

/**
 * Declare a family of three tiers.
 *   internal  art base name, e.g. 'Goblin' -> GoblinA / GoblinB / GoblinC
 *   names     the three display names
 *   levels    the three real levels
 *   t         traits (scalars, or 3-element arrays for per-tier values)
 */
function family(internal, names, levels, t) {
  const tiers = [];
  for (let i = 0; i < 3; i++) {
    const level = levels[i];
    const hp = hpForLevel(level);
    const resist = Object.assign(
      { fire: 0, air: 0, water: 0, earth: 0, mind: 0, body: 0, magic: 0, physical: 0 },
      at(t.resistances, i) || {},
    );
    // Everything gains a little generic resistance with level; bosses a lot.
    const drift = Math.floor(level * 0.35);
    for (const k of ['fire', 'air', 'water', 'earth', 'magic']) {
      if (resist[k] < drift && resist[k] >= 0) resist[k] = drift;
    }

    const def = {
      id: internal + 'ABC'[i],
      spriteId: internal + 'ABC'[i],
      family: internal,
      tier: i,
      name: names[i],
      level, hp,
      ac: acForLevel(level, at(t.acMul, i)),
      attack: attackForLevel(level, at(t.dmgMul, i) || 1, at(t.element, i)),
      attack2: at(t.twoAttacks, i) ? attackForLevel(level, (at(t.dmgMul, i) || 1) * 0.6, at(t.element2, i) || at(t.element, i)) : null,
      ranged: buildRanged(t, i, level),
      speed: at(t.speed, i) || 160,
      moveType: at(t.moveType, i) || 'med',
      aiType: at(t.aiType, i) || 'normal',
      recoveryTime: at(t.recovery, i) || 100,
      xp: xpForLevel(level, at(t.xpMul, i)),
      treasureLevel: at(t.treasure, i) || treasureForLevel(level),
      resistances: resist,
      immunities: (atList(t.immunities, i) || []).slice(),
      aggroRange: at(t.aggroRange, i) || (at(t.aiType, i) === 'wary' ? 900 : 1600),
      kind: at(t.kind, i) || 'humanoid',
      size: at(t.size, i) || 190,
      spawnRegions: (atList(t.spawnRegions, i) || ['cave']).slice(),
      flying: !!at(t.flying, i),
      undead: !!at(t.undead, i),
      groupSize: (atList(t.groupSize, i) || [1, 3]).slice(),
      fleeAtHP: at(t.fleeAtHP, i) || 0,
      caster: !!at(t.caster, i),
      spells: atList(t.spells, i) || null,
      inflict: at(t.inflict, i) || null,
      regen: at(t.regen, i) || 0,
      hostile: at(t.hostile, i) !== false,
      gold: goldForLevel(level, at(t.goldMul, i)),
      sound: at(t.sound, i) || SOUND_BY_KIND[at(t.kind, i) || 'humanoid'] || 'growl_small',
      desc: at(t.desc, i) || '',
    };
    M.push(def);
    tiers.push(def);
  }
  FAMILY_INDEX[internal] = { id: internal, names: names.slice(), tiers, desc: t.desc || '' };
  return tiers;
}

function buildRanged(t, i, level) {
  const r = at(t.ranged, i);
  if (!r) return null;
  // Ranged damage tracks the melee curve but hits a little harder - except at
  // the bottom of the table, where MM6's caster trash plinks rather than
  // deletes: a starter-area shaman bolt at 8-13 vs an 11-29 HP party was the
  // whole death spiral (cycle-2 playtest #1). Tier-1 ranged is cut to ~70%.
  const tierCut = level <= 8 ? 0.7 : level <= 14 ? 0.85 : 1;
  const a = attackForLevel(level, (at(t.rangedMul, i) || 1.15) * tierCut);
  return {
    spell: r.spell || null,
    projectile: r.projectile || null,
    damage: a.dice,
    bonus: a.bonus,
    element: r.element || 'physical',
    range: r.range || 3000,
    // Seconds between shots for the AI: low-level casters fire on MM6's lazy
    // cadence, not a metronome. entity.js may use its own default; the combat
    // glue enforces this as a floor after each shot.
    cooldown: level <= 8 ? 4.5 : level <= 14 ? 3.5 : 2.5,
  };
}

/** A unique, one-off monster (the two `z` entries). */
function unique(id, name, level, t) {
  const def = {
    id, spriteId: id, family: id, tier: 0, name, level,
    hp: hpForLevel(level),
    ac: acForLevel(level, t.acMul),
    attack: attackForLevel(level, t.dmgMul || 1, t.element),
    attack2: t.twoAttacks ? attackForLevel(level, (t.dmgMul || 1) * 0.6, t.element2 || t.element) : null,
    ranged: buildRanged(t, 0, level),
    speed: t.speed || 160,
    moveType: t.moveType || 'med',
    aiType: t.aiType || 'aggress',
    recoveryTime: t.recovery || 100,
    xp: xpForLevel(level, t.xpMul || 2),
    treasureLevel: 6,
    resistances: Object.assign({ fire: 0, air: 0, water: 0, earth: 0, mind: 0, body: 0, magic: 0, physical: 0 }, t.resistances || {}),
    immunities: (t.immunities || []).slice(),
    aggroRange: t.aggroRange || 3000,
    kind: t.kind || 'demon',
    size: t.size || 400,
    spawnRegions: (t.spawnRegions || ['lair']).slice(),
    flying: !!t.flying,
    undead: !!t.undead,
    groupSize: [1, 1],
    fleeAtHP: 0,
    caster: !!t.caster,
    spells: t.spells || null,
    inflict: t.inflict || null,
    regen: t.regen || 0,
    hostile: true,
    gold: goldForLevel(level, t.goldMul || 2),
    sound: t.sound || SOUND_BY_KIND[t.kind || 'demon'] || 'growl_large',
    desc: t.desc || '',
    unique: true,
  };
  M.push(def);
  FAMILY_INDEX[id] = { id, names: [name], tiers: [def], desc: def.desc };
  return def;
}

// Voice family per biological kind: used for aggro barks, pain vocals on
// non-lethal hits, and the death cry. Ids must exist in core/audio.js.
const SOUND_BY_KIND = {
  human: 'growl_small', humanoid: 'growl_small', undead: 'zombie_moan',
  beast: 'growl_small', insect: 'insect_chitter', reptile: 'hiss',
  elemental: 'growl_large', construct: 'golem_step', giant: 'growl_large',
  dragon: 'roar_dragon', demon: 'growl_large', ooze: 'slime_squelch',
  avian: 'screech', aberration: 'hiss',
};

// Shorthand resistance profiles.
const R_UNDEAD = { mind: 100, body: 100, water: 30 };
const R_CONSTRUCT = { mind: 100, body: 100, physical: 25 };
const IMM_MINDBODY = ['mind', 'body'];

// ---------------------------------------------------------------------------
// The 57 families, in MONSTERS.TXT order
// ---------------------------------------------------------------------------

family('Archer', ['Archer', 'Master Archer', 'Fire Archer'], [9, 19, 29], {
  kind: 'human', size: 190, speed: 140, moveType: 'med', aiType: 'wary',
  recovery: 95, groupSize: [1, 3], dmgMul: 0.8,
  ranged: [{ projectile: 'arrow', range: 3400 }, { projectile: 'arrow', range: 3600 },
    { projectile: 'fire_arrow', element: 'fire', range: 3800 }],
  element: [null, null, 'fire'], resistances: [null, null, { fire: 60 }],
  spawnRegions: ['castle_ironfist', 'free_haven', 'blackshire', 'ruins', 'silver_cove'],
  desc: 'Human bowman in a leather jerkin. The fire archers set their arrows alight.',
});

family('Barbarian', ['Magyar', 'Magyar Soldier', 'Magyar Matron'], [14, 25, 37], {
  kind: 'human', size: 200, speed: 200, moveType: 'long', aiType: 'aggress',
  recovery: 105, groupSize: [2, 4], dmgMul: 1.25, acMul: 0.85,
  spawnRegions: ['blackshire', 'kriegspire', 'frozen_highlands', 'white_cap'],
  desc: 'Fur-clad, bare-armed, and swinging something enormous.',
});

family('Bat', ['Bat', 'Giant Bat', 'Vampire Bat'], [3, 6, 9], {
  kind: 'beast', size: [45, 75, 100], speed: 260, moveType: 'long', aiType: 'normal',
  recovery: 65, groupSize: [3, 8], flying: true, acMul: 1.5, dmgMul: 0.7, goldMul: 0, sound: 'screech',
  aggroRange: 1000, element: [null, null, 'body'],
  inflict: [null, null, { condition: 'diseased_weak', chance: 12 }],
  spawnRegions: ['cave', 'crypt', 'mine', 'sewer', 'new_sorpigal'],
  desc: 'Erratic and infuriating to hit. The black ones drink.',
});

family('Beholder', ['Flying Eye', 'Terrible Eye', 'Maddening Eye'], [30, 40, 50], {
  kind: 'aberration', size: 140, speed: 150, moveType: 'short', aiType: 'wary',
  groupSize: [1, 3], flying: true, caster: true, acMul: 1.15, dmgMul: 0.6,
  ranged: { spell: 'psychic_shock', element: 'mind', range: 3600 }, rangedMul: 1.4,
  spells: ['psychic_shock', 'paralyze'], resistances: { mind: 80, magic: 50 },
  inflict: { condition: 'paralyzed', chance: 10 },
  spawnRegions: ['tower', 'lair', 'temple', 'cave'],
  desc: 'A floating sphere of eyes. It never closes any of them.',
});

family('Bloodsucker', ['Blood Sucker', 'Brain Sucker', 'Soul Sucker'], [2, 4, 8], {
  kind: 'beast', size: [70, 85, 105], speed: 170, moveType: 'short', aiType: 'aggress',
  recovery: 130, groupSize: [2, 4], goldMul: 0, element: [null, 'mind', 'mind'], acMul: 0.9,
  inflict: [null, { condition: 'weak', chance: 12 }, { condition: 'insane', chance: 8 }],
  spawnRegions: ['new_sorpigal', 'cave', 'sewer', 'bootleg_bay'],
  desc: 'The first thing that ever tries to kill you. It attaches and it drinks.',
});

family('Cleric', ['Acolyte of Baa', 'Cleric of Baa', 'Priest of Baa'], [8, 15, 25], {
  kind: 'human', size: 188, speed: 150, moveType: 'med', aiType: 'wary',
  groupSize: [1, 4], caster: true, dmgMul: 0.7, goldMul: 1.4,
  ranged: { spell: 'harm', element: 'body', range: 2800 }, rangedMul: 1.2,
  spells: [['harm'], ['harm', 'bless'], ['harm', 'heroism', 'shared_life']],
  resistances: { mind: 35, body: 35 },
  spawnRegions: ['temple', 'crypt', 'free_haven', 'silver_cove'],
  desc: 'The cult of Baa, robed by rank: black, then red, then gold.',
});

family('Cobra', ['Cobra', 'King Cobra', 'Queen Cobra'], [5, 10, 14], {
  kind: 'reptile', size: [90, 120, 160], speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 3], goldMul: 0, element: 'earth', acMul: 1.1,
  resistances: { earth: 70 },
  inflict: [{ condition: 'poisoned_weak', chance: 22 }, { condition: 'poisoned_severe', chance: 22 }, { condition: 'poisoned_deadly', chance: 20 }],
  spawnRegions: ['bootleg_bay', 'dragonsand', 'cave', 'mire_of_the_damned'],
  desc: 'Hood flared. One bite and the poison does the rest.',
});

family('Cockatrice', ["Agar's Pet", "Agar's Monster", "Agar's Abomination"], [13, 15, 17], {
  kind: 'beast', size: 150, speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 3], acMul: 1.05, goldMul: 0.3,
  inflict: { condition: 'stoned', chance: 6 },
  resistances: { earth: 40 },
  spawnRegions: ['tower', 'ruins', 'cave'],
  desc: 'Agar experimented. This is what he got. Its gaze turns flesh to stone.',
});

family('DemonFly', ['Devil Captain', 'Devil Master', 'Devil King'], [30, 50, 70], {
  kind: 'demon', size: [280, 300, 330], speed: [240, 300, 310], moveType: 'long', aiType: 'aggress',
  groupSize: [1, 2], flying: true, twoAttacks: true, element: 'fire', dmgMul: 1.2,
  ranged: { spell: 'fireball', element: 'fire', range: 3400 }, rangedMul: 1.3,
  resistances: [{ fire: 80, mind: 60, body: 60 }, { fire: 90, mind: 70, body: 70 }, { fire: 100, mind: 80, body: 80 }],
  immunities: [[], [], ['fire']], goldMul: 1.5,
  spawnRegions: ['temple', 'lair', 'kriegspire'],
  desc: 'Winged, horned, on fire, and in charge.',
});

family('Demon', ['Devil Spawn', 'Devil Worker', 'Devil Warrior'], [20, 40, 60], {
  kind: 'demon', size: [250, 280, 300], speed: 220, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 3], twoAttacks: true, element: 'fire', dmgMul: 1.15,
  resistances: [{ fire: 70, mind: 50 }, { fire: 85, mind: 60 }, { fire: 95, mind: 70 }],
  goldMul: 1.2, spawnRegions: ['temple', 'lair', 'kriegspire'],
  desc: 'The Kreegan rank and file. Red, muscled, and carrying a trident.',
});

family('DragonCave', ['Fire Lizard', 'Lightning Lizard', 'Thunder Lizard'], [40, 50, 60], {
  kind: 'dragon', size: 320, speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 2], twoAttacks: true, dmgMul: 1.1,
  element: ['fire', 'air', 'air'],
  ranged: [{ spell: 'fire_bolt', element: 'fire', range: 3000 },
    { spell: 'lightning_bolt', element: 'air', range: 3200 },
    { spell: 'lightning_bolt', element: 'air', range: 3400 }],
  resistances: [{ fire: 90 }, { air: 90 }, { air: 95, fire: 50 }],
  spawnRegions: ['cave', 'lair', 'dragonsand', 'kriegspire'],
  desc: 'Wingless, low-slung, and quicker than anything that size should be.',
});

family('DragonFly', ['Flame Drake', 'Frost Drake', 'Energy Drake'], [24, 28, 32], {
  kind: 'dragon', size: 200, speed: 280, moveType: 'long', aiType: 'aggress',
  groupSize: [1, 3], flying: true, dmgMul: 1.05, sound: 'screech',
  element: ['fire', 'water', 'air'],
  ranged: [{ spell: 'fire_bolt', element: 'fire', range: 3000 },
    { spell: 'ice_bolt', element: 'water', range: 3000 },
    { spell: 'lightning_bolt', element: 'air', range: 3000 }],
  resistances: [{ fire: 80 }, { water: 80 }, { air: 80 }],
  spawnRegions: ['dragonsand', 'kriegspire', 'mire_of_the_damned', 'lair'],
  desc: 'A dragon in miniature, and it breathes just as well.',
});

family('DragonLand', ['Wyrm', 'Giant Wyrm', 'Great Wyrm'], [50, 60, 70], {
  kind: 'dragon', size: [360, 400, 440], speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 2], twoAttacks: true, element: 'earth', dmgMul: 1.15,
  ranged: { spell: 'acid_burst', element: 'earth', range: 3200 },
  resistances: { earth: 85, water: 50, mind: 60 },
  inflict: { condition: 'poisoned_severe', chance: 18 },
  spawnRegions: ['lair', 'mire_of_the_damned', 'dragonsand'],
  desc: 'Legless, bronze, and longer than the corridor.',
});

family('DragonCover', ['Red Dragon', 'Blue Dragon', 'Gold Dragon'], [80, 90, 100], {
  kind: 'dragon', size: [620, 660, 700], speed: [250, 260, 270], moveType: 'long', aiType: 'aggress',
  groupSize: [1, 1], flying: true, twoAttacks: true, dmgMul: 1.2, acMul: 1.1,
  element: ['fire', 'air', 'light'],
  ranged: [{ spell: 'dragon_breath', element: 'fire', range: 4200 },
    { spell: 'dragon_breath', element: 'air', range: 4200 },
    { spell: 'dragon_breath', element: 'light', range: 4200 }],
  rangedMul: 1.5,
  resistances: [{ fire: 100, mind: 80, body: 80, magic: 70 },
    { air: 100, mind: 85, body: 85, magic: 75 },
    { fire: 90, air: 90, water: 90, earth: 90, mind: 90, body: 90, magic: 85 }],
  immunities: [['fire'], ['air'], []], goldMul: 2.5,
  spawnRegions: ['lair'],
  desc: 'The one on the box. It is exactly as bad as it looks.',
});

family('Druidess', ['Druid', 'Great Druid', 'Grand Druid'], [10, 16, 28], {
  kind: 'human', size: 185, speed: 160, moveType: 'med', aiType: 'wary',
  groupSize: [1, 3], caster: true, dmgMul: 0.7, goldMul: 1.2,
  ranged: { spell: 'deadly_swarm', element: 'earth', range: 3000 }, rangedMul: 1.25,
  spells: [['deadly_swarm'], ['deadly_swarm', 'stone_skin'], ['deadly_swarm', 'death_blossom', 'stone_skin']],
  resistances: { earth: 45, water: 30 },
  spawnRegions: ['bootleg_bay', 'sweet_water', 'mire_of_the_damned', 'paradise_valley'],
  desc: 'Green robes, a staff, and the marsh doing what she tells it.',
});

family('Dwarf', ['Dwarf', 'Dwarf Warrior', 'Dwarf Lord'], [10, 20, 30], {
  kind: 'humanoid', size: 130, speed: 130, moveType: 'short', aiType: 'normal',
  recovery: 110, groupSize: [2, 4], dmgMul: 1.1, acMul: 1.15, goldMul: 1.4,
  resistances: { earth: 50, fire: 30 },
  spawnRegions: ['mine', 'cave', 'white_cap', 'frozen_highlands'],
  desc: "Snergle's people. Short, broad, and swinging at your knees.",
});

family('ElemAir', ['Dust Devil', 'Twister', 'Air Elemental'], [16, 22, 33], {
  kind: 'elemental', size: [180, 210, 240], speed: 288, moveType: 'long', aiType: 'aggress',
  groupSize: [1, 3], flying: true, acMul: 1.4, element: 'air', recovery: 75, goldMul: 0,
  resistances: { air: 100, earth: -30, mind: 100, body: 100, physical: 40 },
  immunities: ['air', 'mind', 'body'],
  spawnRegions: ['white_cap', 'frozen_highlands', 'tower', 'kriegspire'],
  desc: 'A whirlwind with intent. Hard to hit and harder to catch.',
});

family('ElemEarth', ['Rock Beast', 'Earth Spirit', 'Earth Elemental'], [25, 30, 40], {
  kind: 'elemental', size: [220, 240, 260], speed: 110, moveType: 'short', aiType: 'normal',
  recovery: 135, groupSize: [1, 3], element: 'earth', dmgMul: 1.2, goldMul: 0,
  resistances: { earth: 100, fire: -20, mind: 100, body: 100, physical: 35 },
  immunities: ['earth', 'mind', 'body'],
  spawnRegions: ['mine', 'cave', 'white_cap', 'kriegspire'],
  desc: 'Slow as a landslide, and about as survivable.',
});

family('ElemFire', ['Fire Beast', 'Fire Spirit', 'Fire Elemental'], [13, 26, 39], {
  kind: 'elemental', size: [190, 210, 230], speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 3], element: 'fire', goldMul: 0,
  ranged: { spell: 'fire_bolt', element: 'fire', range: 2600 },
  resistances: { fire: 100, water: -30, mind: 100, body: 100 },
  immunities: ['fire', 'mind', 'body'],
  spawnRegions: ['kriegspire', 'dragonsand', 'cave', 'tower'],
  desc: 'A column of living flame. It lights the room it kills you in.',
});

family('ElemWater', ['Water Beast', 'Water Spirit', 'Water Elemental'], [14, 24, 36], {
  kind: 'elemental', size: [200, 215, 230], speed: 180, moveType: 'med', aiType: 'normal',
  groupSize: [1, 3], element: 'water', goldMul: 0,
  resistances: { water: 100, air: -30, mind: 100, body: 100 },
  immunities: ['water', 'mind', 'body'],
  spawnRegions: ['eel_infested_waters', 'bootleg_bay', 'sweet_water', 'sewer'],
  desc: 'It flows around your guard and drowns you standing up.',
});

family('FighterChain', ['Fighter', 'Soldier', 'Veteran'], [14, 24, 35], {
  kind: 'human', size: 195, speed: 170, moveType: 'med', aiType: 'normal',
  recovery: 105, groupSize: [2, 4], acMul: 1.2, dmgMul: 1.05, goldMul: 1.2,
  spawnRegions: ['castle_ironfist', 'ruins', 'free_haven', 'blackshire'],
  desc: 'Chain mail, conical helm, sword and shield. Professional.',
});

family('FighterLeath', ['Thug', 'Ruffian', 'Brigand'], [8, 14, 22], {
  kind: 'human', size: 190, speed: 190, moveType: 'med', aiType: 'aggress',
  groupSize: [2, 5], goldMul: 1.3,
  spawnRegions: ['new_sorpigal', 'free_haven', 'sewer', 'ruins', 'blackshire'],
  desc: 'Leather, no helm, and a club. Robs the Free Haven road.',
});

family('Gargoyle', ['Stone Gargoyle', 'Marble Gargoyle', 'Diamond Gargoyle'], [16, 22, 33], {
  kind: 'construct', size: 175, speed: 220, moveType: 'long', aiType: 'aggress',
  groupSize: [2, 4], flying: true, acMul: 1.25, goldMul: 0.5,
  resistances: [R_CONSTRUCT, { mind: 100, body: 100, physical: 35 }, { mind: 100, body: 100, physical: 50, magic: 40 }],
  immunities: IMM_MINDBODY,
  spawnRegions: ['ruins', 'tower', 'temple', 'crypt'],
  desc: 'It was a statue right up until it was not.',
});

family('Genie', ['Genie', 'Djinn', 'Efreet'], [33, 44, 55], {
  kind: 'elemental', size: [260, 280, 300], speed: 240, moveType: 'long', aiType: 'wary',
  groupSize: [1, 2], flying: true, caster: true, goldMul: 2,
  ranged: [{ spell: 'ice_blast', element: 'water', range: 3400 },
    { spell: 'lightning_bolt', element: 'air', range: 3400 },
    { spell: 'incinerate', element: 'fire', range: 3600 }],
  rangedMul: 1.35,
  resistances: [{ water: 70, mind: 60, magic: 50 }, { air: 75, mind: 65, magic: 55 }, { fire: 90, mind: 70, magic: 60 }],
  spawnRegions: ['dragonsand', 'lair', 'tower'],
  desc: 'Smoke where the legs should be, and arms folded until they are not.',
});

family('Ghost', ['Ghost', 'Evil Spirit', 'Specter'], [9, 13, 19], {
  kind: 'undead', undead: true, size: 185, speed: 230, moveType: 'long', aiType: 'normal',
  groupSize: [1, 4], flying: true, acMul: 1.6, element: 'magic', goldMul: 0,
  resistances: { mind: 100, body: 100, earth: 60, physical: 65, magic: 40 },
  immunities: ['mind', 'body', 'earth'],
  inflict: [null, null, { condition: 'afraid', chance: 20 }],
  spawnRegions: ['crypt', 'mire_of_the_damned', 'ruins', 'tower'],
  desc: 'Steel passes through it. Light does not.',
});

family('Goblin', ['Goblin', 'Goblin Shaman', 'Goblin King'], [4, 6, 10], {
  kind: 'humanoid', size: [150, 155, 180], speed: 160, moveType: 'med', aiType: 'aggress',
  // The base tier hits softer than the level curve suggests: two GoblinA are
  // the game's opening fight and must be dangerous to a fresh party, not fatal.
  // MM6 cadence: a goblin winds up for over two seconds between club swings.
  recovery: [140, 125, 105], groupSize: [2, 5], aggroRange: 1300, sound: 'goblin_yelp',
  dmgMul: [0.65, 0.8, 1],
  caster: [false, true, false],
  ranged: [null, { spell: 'fire_bolt', element: 'fire', range: 2400 }, null],
  spells: [null, ['fire_bolt'], null],
  goldMul: [1, 1.2, 2.5], twoAttacks: [false, false, true],
  spawnRegions: ['new_sorpigal', 'cave', 'mine', 'ruins'],
  desc: 'Green, hunched, in rags, carrying a crude club. Never alone.',
});

family('Guard', ['Guard', 'Lieutenant', 'Captain'], [11, 19, 33], {
  kind: 'human', size: 195, speed: 165, moveType: 'med', aiType: 'normal',
  recovery: 105, groupSize: [1, 4], acMul: 1.25, goldMul: 1.2,
  spawnRegions: ['castle_ironfist', 'free_haven', 'silver_cove', 'new_sorpigal', 'town'],
  desc: 'Tabard over mail, kite shield, and no sense of humour.',
});

family('Harpy', ['Harpy', 'Harpy Hag', 'Harpy Witch'], [14, 17, 19], {
  kind: 'avian', size: 170, speed: 260, moveType: 'long', aiType: 'aggress',
  recovery: 80, groupSize: [2, 5], flying: true, acMul: 1.2, goldMul: 0.6,
  inflict: { condition: 'afraid', chance: 18 },
  resistances: { air: 40, mind: 30 },
  spawnRegions: ['bootleg_bay', 'blackshire', 'cave', 'ruins'],
  desc: 'It screams, and the scream is half the fight.',
});

family('Hydra', ['Hydra', 'Venomous Hydra', 'Colossal Hydra'], [45, 55, 65], {
  kind: 'reptile', size: [320, 360, 400], speed: 150, moveType: 'short', aiType: 'aggress',
  groupSize: [1, 1], twoAttacks: true, element: 'earth', dmgMul: 1.1, regen: 10,
  ranged: { projectile: 'venom', element: 'earth', range: 2600 },
  resistances: { earth: 85, water: 60, mind: 60 },
  inflict: { condition: 'poisoned_deadly', chance: 20 },
  spawnRegions: ['mire_of_the_damned', 'eel_infested_waters', 'lair'],
  desc: 'Every head bites and every head grows back.',
});

family('Jackalman', ['Defender', 'Sentinel', 'Guardian of VARN'], [35, 55, 65], {
  kind: 'construct', size: 205, speed: 200, moveType: 'med', aiType: 'normal',
  groupSize: [1, 3], acMul: 1.2, dmgMul: 1.05, goldMul: 1.5,
  resistances: { mind: 100, body: 100, magic: 50, physical: 25 },
  immunities: IMM_MINDBODY,
  spawnRegions: ['pyramid', 'dragonsand', 'lair'],
  desc: 'Jackal-headed and still standing its post after a thousand years.',
});

family('KnightPlate', ['Death Knight', 'Doom Knight', 'Cuisinart'], [40, 60, 80], {
  kind: 'human', size: [200, 205, 210], speed: 180, moveType: 'med', aiType: 'aggress',
  recovery: 100, groupSize: [1, 3], acMul: 1.35, dmgMul: 1.2, twoAttacks: true, goldMul: 1.8,
  resistances: [{ mind: 50, body: 50, fire: 40 }, { mind: 60, body: 60, fire: 50, magic: 40 },
    { mind: 75, body: 75, fire: 60, magic: 55 }],
  spawnRegions: ['lair', 'crypt', 'ruins', 'tower'],
  desc: 'Black plate, closed helm, no face. The last one is called Cuisinart and it earns the name.',
});

family('Lich', ['Lich', 'Greater Lich', 'Power Lich'], [20, 30, 40], {
  kind: 'undead', undead: true, size: 190, speed: 140, moveType: 'short', aiType: 'wary',
  groupSize: [1, 2], caster: true, dmgMul: 0.7, goldMul: 2.2,
  ranged: { spell: 'souldrinker', element: 'dark', range: 3800 }, rangedMul: 1.5,
  spells: ['souldrinker', 'toxic_cloud', 'paralyze'],
  resistances: [{ mind: 100, body: 100, magic: 60, fire: 50, water: 50 },
    { mind: 100, body: 100, magic: 70, fire: 60, water: 60 },
    { mind: 100, body: 100, magic: 80, fire: 70, water: 70, air: 70, earth: 70 }],
  immunities: IMM_MINDBODY,
  spawnRegions: ['crypt', 'tower', 'lair'],
  desc: 'It gave up its body centuries ago and has not missed it.',
});

family('LizardArch', ['Lizard Man', 'Lizard Archer', 'Lizard Wizard'], [4, 7, 11], {
  kind: 'reptile', size: 195, speed: 190, moveType: 'med', aiType: 'normal',
  groupSize: [2, 5], goldMul: 0.9,
  caster: [false, false, true],
  ranged: [null, { projectile: 'arrow', range: 2800 }, { spell: 'poison_spray', element: 'earth', range: 2600 }],
  resistances: { water: 40, earth: 30 },
  spawnRegions: ['bootleg_bay', 'mire_of_the_damned', 'eel_infested_waters'],
  desc: 'Green scales, a tail, and a tribe behind it.',
});

family('Medusa', ['Medusa', 'Medusa Enchantress', 'Gorgon'], [35, 40, 45], {
  kind: 'reptile', size: 240, speed: 190, moveType: 'med', aiType: 'wary',
  groupSize: [1, 2], goldMul: 1.6,
  ranged: { projectile: 'arrow', range: 3200 }, rangedMul: 1.2,
  inflict: { condition: 'stoned', chance: 9 },
  resistances: { earth: 60, mind: 70, magic: 40 },
  spawnRegions: ['ruins', 'temple', 'lair', 'dragonsand'],
  desc: 'Do not look at it. It is very hard not to look at it.',
});

// Tier B is a mugger in a trader's coat, not a civilian: anything that can end
// up fighting the party must never wear a townsperson's nameplate (playtest3
// #8, wowjudge #1). Tiers A and C stay honest non-hostile filler.
family('Merchant', ['Peasant', 'Highwayman', 'Peasant'], [4, 5, 6], {
  kind: 'human', size: 185, speed: 120, moveType: 'short', aiType: 'wary',
  groupSize: [1, 2], hostile: [false, true, false], fleeAtHP: 0.6, dmgMul: 0.5, goldMul: 1.5,
  aggroRange: [700, 1100, 700], spawnRegions: ['town', 'free_haven', 'castle_ironfist', 'new_sorpigal'],
  desc: ['Townsfolk in tunic and apron. They would rather you did not.',
    'A trader\'s coat over a cudgel. The prices are extortionate.',
    'Townsfolk in tunic and apron. They would rather you did not.'],
});

family('Minotaur', ['Minotaur', 'Minotaur Mage', 'Minotaur King'], [39, 59, 79], {
  kind: 'giant', size: [290, 300, 320], speed: 240, moveType: 'long', aiType: 'aggress',
  groupSize: [1, 3], twoAttacks: true, dmgMul: 1.25, goldMul: 1.6,
  caster: [false, true, true],
  ranged: [null, { spell: 'implosion', element: 'air', range: 3200 }, { spell: 'implosion', element: 'air', range: 3400 }],
  resistances: { earth: 50, mind: 55 },
  spawnRegions: ['lair', 'cave', 'ruins'],
  desc: 'It charges, and the charge is the problem.',
});

family('Monk', ['Novice', 'Initiate', 'Master Monk'], [8, 16, 27], {
  kind: 'human', size: 185, speed: 240, moveType: 'long', aiType: 'normal',
  recovery: 70, groupSize: [1, 4], acMul: 1.15, twoAttacks: true, dmgMul: 0.75, goldMul: 0.6,
  resistances: { mind: 45, body: 30 },
  spawnRegions: ['temple', 'tower', 'free_haven'],
  desc: 'Bare arms, a sash, and hands that count as weapons.',
});

family('Nobleman', ['Swordsman', 'Expert', 'Master Swordsman'], [10, 17, 24], {
  kind: 'human', size: 190, speed: 180, moveType: 'med', aiType: 'normal',
  recovery: 90, groupSize: [1, 3], acMul: 1.1, goldMul: 1.6,
  spawnRegions: ['castle_ironfist', 'free_haven', 'silver_cove'],
  desc: 'Silver Helm nobility. Plumed hat, tabard, and a very quick rapier.',
});

family('Ooze', ['Ooze', 'Acidic Ooze', 'Corrosive Ooze'], [12, 18, 25], {
  kind: 'ooze', size: [110, 130, 155], speed: 96, moveType: 'short', aiType: 'normal',
  recovery: 150, groupSize: [1, 4], acMul: 0.4, element: 'earth', goldMul: 0.2,
  resistances: { earth: 80, water: 60, mind: 100, body: 100, physical: 45 },
  immunities: IMM_MINDBODY,
  inflict: { condition: 'poisoned_weak', chance: 18 },
  spawnRegions: ['sewer', 'cave', 'crypt', 'mire_of_the_damned'],
  desc: 'Amorphous, acidic, and it eats the floor on the way to you.',
});

family('Ogre', ['Ogre', 'Ogre Raider', 'Ogre Chieftain'], [15, 20, 28], {
  kind: 'giant', size: [280, 290, 310], speed: 160, moveType: 'short', aiType: 'aggress',
  recovery: 120, groupSize: [1, 3], dmgMul: 1.3, acMul: 0.85, goldMul: 1.3,
  spawnRegions: ['cave', 'blackshire', 'white_cap', 'ruins'],
  desc: 'Grey-brown, pot-bellied, tusked, and carrying a tree.',
});

// PeasantF1C and PeasantF2A were the "Peasant"-labelled muggers of playtest3
// #8: hostile variants now carry bandit names and an honest hostile flag,
// while the remaining tiers stay true civilians.
family('PeasantF1', ['Peasant', 'Peasant', 'Cutpurse'], [1, 2, 3], {
  kind: 'human', size: 180, speed: [120, 120, 200], moveType: 'short', aiType: ['wary', 'wary', 'aggress'],
  groupSize: [1, 3], hostile: [false, false, true], fleeAtHP: 0.7, dmgMul: [0.6, 0.6, 1],
  aggroRange: [600, 600, 1100],
  spawnRegions: ['town', 'new_sorpigal', 'free_haven', 'castle_ironfist'],
  desc: ['A woman in a long skirt and shawl. Non-hostile filler.',
    'A woman in a long skirt and shawl. Non-hostile filler.',
    'Skirt hitched for running, and your purse strings already cut.'],
});
family('PeasantF2', ['Footpad', 'Peasant', 'Peasant'], [1, 2, 3], {
  kind: 'human', size: 180, speed: [190, 120, 120], moveType: 'short', aiType: ['aggress', 'wary', 'wary'],
  groupSize: [1, 3], hostile: [true, false, false], fleeAtHP: 0.7, dmgMul: [0.9, 0.6, 0.6],
  aggroRange: [1100, 600, 600],
  spawnRegions: ['town', 'new_sorpigal', 'free_haven', 'silver_cove'],
  desc: ['Desperate, quick, and after whatever is loose in your pockets.',
    'Another townswoman. Enroth is full of them.',
    'Another townswoman. Enroth is full of them.'],
});
family('PeasantF3', ['Cutpurse', 'Bounty Hunter', 'Assassin'], [3, 5, 7], {
  kind: 'human', size: 180, speed: 210, moveType: 'long', aiType: 'aggress',
  recovery: 80, groupSize: [1, 3], dmgMul: 1.1, goldMul: 1.6,
  spawnRegions: ['free_haven', 'sewer', 'new_sorpigal', 'ruins'],
  desc: 'Dark hood, dagger, and she was behind you a moment ago.',
});
family('PeasantF4', ['Cannibal', 'Head Hunter', 'Witch Doctor'], [6, 8, 10], {
  kind: 'human', size: 182, speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [2, 4], goldMul: 0.8,
  caster: [false, false, true],
  ranged: [null, { projectile: 'javelin', range: 2400 }, { spell: 'poison_spray', element: 'earth', range: 2400 }],
  spawnRegions: ['bootleg_bay'],
  desc: 'Bone jewellery, war paint, and a spear. Bootleg Bay is not a holiday.',
});

family('PeasantM1', ['Peasant', 'Peasant', 'Peasant'], [1, 2, 3], {
  kind: 'human', size: 185, speed: 120, moveType: 'short', aiType: 'wary',
  groupSize: [1, 3], hostile: false, fleeAtHP: 0.7, dmgMul: 0.6, aggroRange: 600,
  spawnRegions: ['town', 'new_sorpigal', 'free_haven', 'castle_ironfist'],
  desc: 'A man in a tunic and trousers, going about his day.',
});
// Renamed from bare 'Apprentice': a hostile spellslinger must never read as a
// townsperson on the nameplate (playtest #15 / systems #13).
family('PeasantM2', ['Renegade Apprentice', 'Journeyman Mage', 'Rogue Mage'], [2, 6, 10], {
  kind: 'human', size: 185, speed: 150, moveType: 'med', aiType: 'wary',
  groupSize: [1, 3], caster: true, dmgMul: 0.6, goldMul: 1.3,
  ranged: [{ spell: 'fire_bolt', element: 'fire', range: 2400 },
    { spell: 'sparks', element: 'air', range: 2600 },
    { spell: 'fireball', element: 'fire', range: 2800 }],
  rangedMul: 1.3, spells: [['fire_bolt'], ['fire_bolt', 'sparks'], ['fireball', 'sparks', 'shield']],
  resistances: { fire: 30, air: 30, magic: 25 },
  spawnRegions: ['tower', 'free_haven', 'ruins'],
  desc: 'Blue robe, pointed hood, and two spells it is very proud of.',
});
family('PeasantM3', ['Follower of Baa', 'Mystic of Baa', 'Fanatic of Baa'], [3, 5, 7], {
  kind: 'human', size: 185, speed: 170, moveType: 'med', aiType: ['normal', 'normal', 'suicide'],
  groupSize: [2, 5], goldMul: 0.9,
  resistances: { mind: 30 },
  spawnRegions: ['temple', 'free_haven', 'crypt', 'new_sorpigal'],
  desc: 'Plain robe, hood up. The fanatics do not stop coming.',
});
family('PeasantM4', ['Cannibal', 'Head Hunter', 'Witch Doctor'], [6, 8, 10], {
  kind: 'human', size: 188, speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [2, 4], goldMul: 0.8,
  caster: [false, false, true],
  ranged: [null, { projectile: 'javelin', range: 2400 }, { spell: 'poison_spray', element: 'earth', range: 2400 }],
  spawnRegions: ['bootleg_bay'],
  desc: 'Bone mask, spear, and no interest in negotiating.',
});

family('Rat', ['Common Rat', 'Large Rat', 'Giant Rat'], [2, 4, 6], {
  kind: 'beast', size: [55, 75, 95], speed: 200, moveType: 'med', aiType: 'normal',
  recovery: 115, groupSize: [2, 5], goldMul: 0, aggroRange: 1000, acMul: 0.9,
  spawnRegions: ['sewer', 'cave', 'crypt', 'mine', 'new_sorpigal'],
  desc: 'Brown, long-tailed, low to the ground, and there are always more.',
});

family('Robot', ['Patrol Unit', 'Enforcer Unit', 'Terminator Unit'], [50, 70, 90], {
  kind: 'construct', size: [210, 220, 235], speed: 180, moveType: 'med', aiType: 'normal',
  recovery: 90, groupSize: [1, 3], acMul: 1.4, goldMul: 0, element: 'magic',
  ranged: { projectile: 'blaster_bolt', element: 'magic', range: 3600 }, rangedMul: 1.4,
  resistances: { mind: 100, body: 100, fire: 80, air: 80, water: 80, earth: 80, magic: 70, physical: 45 },
  immunities: IMM_MINDBODY, treasure: 6,
  spawnRegions: ['control_center'],
  desc: 'Ancient machinery still running its patrol. The optic tracks you.',
});

family('SeaSerpent', ['Sea Serpent', 'Sea Monster', 'Sea Terror'], [28, 36, 48], {
  kind: 'reptile', size: [340, 380, 420], speed: 200, moveType: 'med', aiType: 'aggress',
  groupSize: [1, 2], element: 'water', dmgMul: 1.15, goldMul: 0.8,
  resistances: { water: 85, earth: 40, mind: 40 },
  spawnRegions: ['eel_infested_waters', 'bootleg_bay', 'sweet_water'],
  desc: 'Long-necked, finned, and it was under the boat the whole time.',
});

family('Skeleton', ['Skeleton', 'Skeleton Knight', 'Skeleton Lord'], [6, 10, 14], {
  kind: 'undead', undead: true, size: 180, speed: 170, moveType: 'med', aiType: 'normal',
  groupSize: [2, 5], acMul: [1, 1.2, 1.3], goldMul: 0.7, sound: 'skeleton_rattle',
  resistances: R_UNDEAD, immunities: IMM_MINDBODY,
  spawnRegions: ['crypt', 'cave', 'ruins', 'mire_of_the_damned'],
  desc: 'Bones held together by spite. The Lord wears a crown.',
});

family('Sorcerer', ['Sorcerer', 'Magician', 'Warlock'], [25, 35, 50], {
  kind: 'human', size: 188, speed: 160, moveType: 'med', aiType: 'wary',
  groupSize: [1, 2], caster: true, dmgMul: 0.6, goldMul: 2,
  ranged: [{ spell: 'lightning_bolt', element: 'air', range: 3200 },
    { spell: 'ice_blast', element: 'water', range: 3400 },
    { spell: 'implosion', element: 'air', range: 3600 }],
  rangedMul: 1.5,
  spells: [['lightning_bolt', 'shield'], ['ice_blast', 'shield'], ['implosion', 'meteor_shower', 'shield']],
  resistances: { fire: 50, air: 50, water: 50, earth: 50, magic: 60 },
  spawnRegions: ['tower', 'kriegspire', 'ruins', 'lair'],
  desc: 'Long beard, high collar, and a spell that ends the fight in one casting.',
});

family('Spider', ['Spider', 'Giant Spider', 'Huge Spider'], [5, 8, 12], {
  kind: 'insect', size: [80, 105, 130], speed: 210, moveType: 'long', aiType: 'aggress',
  groupSize: [2, 5], element: 'earth', goldMul: 0.2,
  resistances: { earth: 55 },
  inflict: [{ condition: 'poisoned_weak', chance: 18 }, { condition: 'poisoned_weak', chance: 22 }, { condition: 'poisoned_severe', chance: 20 }],
  ranged: [null, null, { projectile: 'web', element: 'earth', range: 1800 }],
  spawnRegions: ['cave', 'crypt', 'mire_of_the_damned', 'ruins'],
  desc: 'Eight legs, hairy, and it webs the corridor behind you first.',
});

family('Thief', ['Thief', 'Burglar', 'Rogue'], [8, 12, 18], {
  kind: 'human', size: 185, speed: 230, moveType: 'long', aiType: 'wary',
  recovery: 75, groupSize: [1, 4], twoAttacks: true, dmgMul: 0.8, goldMul: 1.8,
  spawnRegions: ['sewer', 'free_haven', 'ruins', 'silver_cove'],
  desc: 'Dark leather, hood, twin daggers, and your purse.',
});

family('Titan', ['Titan', 'Noble Titan', 'Supreme Titan'], [65, 75, 95], {
  kind: 'giant', size: [480, 520, 560], speed: 260, moveType: 'long', aiType: 'aggress',
  recovery: 105, groupSize: [1, 2], twoAttacks: true, element: 'air', dmgMul: 1.15, goldMul: 2,
  ranged: { spell: 'lightning_bolt', element: 'air', range: 4000 }, rangedMul: 1.4,
  resistances: { air: 90, fire: 60, water: 60, earth: 60, mind: 70, body: 70, magic: 70 },
  spawnRegions: ['lair', 'kriegspire'],
  desc: 'Golden-skinned, twice your height, and it throws lightning.',
});

family('Werewolf', ['Wolfman', 'Werewolf', 'Greater Werewolf'], [20, 30, 40], {
  kind: 'beast', size: [200, 210, 225], speed: 270, moveType: 'long', aiType: 'aggress',
  recovery: 80, groupSize: [2, 4], twoAttacks: true, dmgMul: 1.1, goldMul: 0.4, sound: 'wolf_howl',
  resistances: { mind: 40, physical: 20 },
  inflict: [null, { condition: 'diseased_weak', chance: 12 }, { condition: 'diseased_severe', chance: 12 }],
  spawnRegions: ['blackshire', 'mire_of_the_damned', 'white_cap', 'frozen_highlands'],
  desc: 'Bipedal wolf, all claws, and it moves faster than you can back away.',
});

// ---------------------------------------------------------------------------
// The two uniques
// ---------------------------------------------------------------------------

unique('zDemonqueen', 'Demon Queen', 100, {
  kind: 'demon', size: 420, speed: 280, moveType: 'long', aiType: 'aggress',
  twoAttacks: true, element: 'fire', element2: 'dark', dmgMul: 1.3, acMul: 1.2,
  caster: true, spells: ['incinerate', 'armageddon', 'paralyze'],
  ranged: { spell: 'incinerate', element: 'fire', range: 4000 }, rangedMul: 1.6,
  resistances: { fire: 100, air: 80, water: 80, earth: 80, mind: 95, body: 95, magic: 90 },
  immunities: ['fire', 'mind', 'body'],
  spawnRegions: ['lair'], goldMul: 4,
  desc: 'The end of the war, wearing a crown. Bring everything you have.',
});

unique('zReactor', 'Reactor', 100, {
  kind: 'construct', size: 300, speed: 0, moveType: 'short', aiType: 'normal',
  dmgMul: 0.8, acMul: 1.5, element: 'magic',
  ranged: { projectile: 'energy_pulse', element: 'magic', range: 3000 }, rangedMul: 1.5,
  resistances: { fire: 90, air: 90, water: 90, earth: 90, mind: 100, body: 100, magic: 85, physical: 60 },
  immunities: ['mind', 'body'],
  spawnRegions: ['control_center'], goldMul: 0, aggroRange: 3000,
  desc: 'It does not move. It does not need to.',
});

// ---------------------------------------------------------------------------
// Index and queries
// ---------------------------------------------------------------------------

export const MONSTERS = M;
const BY_ID = new Map(M.map((m) => [m.id, m]));

// Display name -> id, mirroring creatures.js's CREATURE_TIER_BY_NAME contract
// (first declaration wins for duplicated civilian names). The sprite baker
// resolves 'Goblin Shaman' to a real sheet; the bestiary must resolve it to
// the REAL def too, or every name-based spawn is a stat-less L1 husk with no
// ranged attack (visuals3 #1).
const BY_NAME = new Map();
for (const m of M) if (!BY_NAME.has(m.name)) BY_NAME.set(m.name, m.id);

export const MONSTER_IDS = M.map((m) => m.id);
/** { Goblin: { id, names, tiers } } - the sprite families. */
export const MONSTER_FAMILIES = FAMILY_INDEX;
export const FAMILY_IDS = Object.keys(FAMILY_INDEX);

/** Look a monster up by id OR display name ('Goblin Shaman' -> GoblinB). */
export function monsterById(id) {
  const d = BY_ID.get(id);
  if (d) return d;
  const named = BY_NAME.get(id);
  return named ? BY_ID.get(named) || null : null;
}

/** The three tiers of a sprite family. */
export function tiersOf(familyId) {
  const f = FAMILY_INDEX[familyId];
  return f ? f.tiers : [];
}

/** Every monster of a biological kind ('undead', 'demon', ...). */
export function monstersOfKind(kind) { return M.filter((m) => m.kind === kind); }
/** Back-compat alias. */
export const monstersOfFamily = monstersOfKind;

export function monstersInLevelRange(lo, hi) {
  return M.filter((m) => m.level >= lo && m.level <= hi);
}

/**
 * A weighted spawn table for a region at a given difficulty. `difficulty` is
 * roughly the party's level; the band widens with it so deep regions stay
 * varied. Non-hostile filler (peasants) is included at low weight in towns
 * only.
 */
export function spawnTableFor(regionId, difficulty) {
  const d = Math.max(1, difficulty || 1);
  const lo = Math.max(1, Math.floor(d * 0.5) - 1);
  const hi = Math.ceil(d * 1.6) + 2;

  let pool = M.filter((m) => m.spawnRegions.indexOf(regionId) >= 0 && !m.unique);
  if (!pool.length) pool = M.filter((m) => m.spawnRegions.indexOf('cave') >= 0);
  if (regionId !== 'town') pool = pool.filter((m) => m.hostile);

  const inBand = pool.filter((m) => m.level >= lo && m.level <= hi);
  const chosen = inBand.length ? inBand : pool.slice()
    .sort((a, b) => Math.abs(a.level - d) - Math.abs(b.level - d)).slice(0, 5);

  return chosen.map((m) => {
    const span = Math.max(1, hi - lo);
    const dist = Math.abs(m.level - d) / span;
    const w = Math.max(1, Math.round(100 * (1 - Math.min(0.92, dist))));
    return { id: m.id, w, level: m.level, groupSize: m.groupSize };
  });
}

/** Roll one spawn group: an id and how many. */
export function rollSpawn(rand, regionId, difficulty) {
  const table = spawnTableFor(regionId, difficulty);
  if (!table.length) return null;
  const pick = rand.weighted(table);
  const [lo, hi] = pick.groupSize;
  return { id: pick.id, count: rand.int(lo, hi) };
}

// ---------------------------------------------------------------------------
// Town-ring spawn shaping (MM6's opening-area contract)
// ---------------------------------------------------------------------------

/** Does this monster attack from range (bow, spell or thrown)? */
export function isRangedThreat(def) {
  return !!(def && (def.ranged || def.caster));
}

/**
 * The pool a spawn within `dist` units of a town may draw from. MM6's rule of
 * thumb, restated: inside ~4000 units of a town only weak MELEE trash walks
 * (singles and pairs of goblins and rats); ranged/caster packs live in the
 * outer rings and the dungeons. Returns null when the distance imposes no
 * restriction.
 */
export function townRingPool(regionId, dist) {
  if (!(dist < 4000)) return null;
  const pool = M.filter((m) => m.spawnRegions.indexOf(regionId) >= 0
    && m.hostile && !m.unique && !isRangedThreat(m) && m.level <= 5);
  if (pool.length) return pool;
  // A region with no weak melee natives at all falls back to the classics.
  return M.filter((m) => ['GoblinA', 'RatA', 'BloodsuckerA'].indexOf(m.id) >= 0);
}

/** Group-size cap by distance from town: singles/pairs close in. */
export function townRingMaxCount(dist) {
  if (dist < 2500) return 2;
  if (dist < 4000) return 2;
  if (dist < 6000) return 3;
  return 99;
}

/**
 * Apply the town-ring contract to one spawn descriptor. `defOf` resolves an
 * id to its bestiary entry. Returns { ids, count } - possibly the originals.
 */
export function shapeSpawnForTown(regionId, dist, ids, count, rand) {
  const cap = townRingMaxCount(dist);
  let outIds = ids;
  const pool = townRingPool(regionId, dist);
  if (pool) {
    const bad = ids.some((id) => {
      const d = BY_ID.get(id);
      return !d || isRangedThreat(d) || d.level > 5 || !d.hostile;
    });
    if (bad) outIds = [rand.pick(pool).id];
  }
  return { ids: outIds, count: Math.min(count, cap) };
}

/**
 * Pluralise a monster display name: 'Follower of Baa' -> 'Followers of Baa',
 * 'Harpy' -> 'Harpies', 'Cutpurse' -> 'Cutpurses'. Kills the 'Kill 5 Follower
 * of Baas' bug (playtest #9).
 */
export function monsterPlural(name) {
  const s = String(name || '');
  const at = s.search(/\s+of\s+/i);
  const head = at >= 0 ? s.slice(0, at) : s;
  const tail = at >= 0 ? s.slice(at) : '';
  let p;
  if (/(s|x|z|ch|sh)$/i.test(head)) p = head + 'es';
  else if (/[^aeiou]y$/i.test(head)) p = head.slice(0, -1) + 'ies';
  else if (/man$/i.test(head)) p = head.slice(0, -3) + 'men';
  else p = head + 's';
  return p + tail;
}

// ---------------------------------------------------------------------------
// Live instances
// ---------------------------------------------------------------------------

let MUID = 1;

export function spawnMonster(id, opts) {
  // Route through the same id-or-name resolution as monsterById, so a spawn
  // script that says 'Goblin Shaman' gets a real combatant, not null.
  const def = monsterById(id);
  if (!def) return null;
  const o = opts || {};
  return {
    muid: MUID++,
    id: def.id,
    def,
    name: def.name,
    level: def.level,
    hp: def.hp,
    maxHP: def.hp,
    ac: def.ac,
    x: o.x || 0, y: o.y || 0, z: o.z || 0,
    recovery: 0,
    conditions: {},
    buffs: {},
    hostile: o.hostile !== undefined ? o.hostile : def.hostile,
    state: 'idle',
    target: null,
    alive: true,
    fleeing: false,
  };
}

export function resetMonsterUids(n) { MUID = n | 0 || 1; }

/** Total XP a group is worth, before Learning and party-size division. */
export function groupXP(monsters) {
  let t = 0;
  for (const m of monsters) t += m.def ? m.def.xp : ((BY_ID.get(m.id) || { xp: 0 }).xp);
  return t;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Sanity check used by the test harness. */
export function validateMonsters(requiredIds) {
  const problems = [];
  const have = new Set(MONSTER_IDS);
  if (requiredIds && requiredIds.length) {
    for (const id of requiredIds) if (!have.has(id)) problems.push(`missing monster "${id}"`);
    for (const id of MONSTER_IDS) if (requiredIds.indexOf(id) < 0) problems.push(`extra monster "${id}"`);
  }
  if (M.length !== 173) problems.push(`expected 173 monsters, found ${M.length}`);
  if (FAMILY_IDS.length !== 59) problems.push(`expected 57 families + 2 uniques, found ${FAMILY_IDS.length}`);
  for (const m of M) {
    if (m.level < 1 || m.level > 100) problems.push(`${m.id}: level ${m.level} out of range`);
    if (m.hp !== hpForLevel(m.level)) problems.push(`${m.id}: hp ${m.hp} off the retail curve`);
    if (!KINDS.includes(m.kind)) problems.push(`${m.id}: unknown kind ${m.kind}`);
    if (m.size < 20 || m.size > 900) problems.push(`${m.id}: implausible size ${m.size}`);
    // Monster speed sits between 25% and ~80% of the party's 384 u/s walk so
    // the party can always disengage. The fastest thing in the game is the
    // Devil Master at 300; the Reactor is bolted down at 0.
    if (m.speed !== 0 && (m.speed < 96 || m.speed > MAX_MONSTER_SPEED)) {
      problems.push(`${m.id}: speed ${m.speed} outside the 96-${MAX_MONSTER_SPEED} band`);
    }
    if (!MOVE_TYPES.includes(m.moveType)) problems.push(`${m.id}: bad move type`);
    if (!AI_TYPES.includes(m.aiType)) problems.push(`${m.id}: bad ai type`);
    for (const r of m.spawnRegions) if (!REGIONS.includes(r)) problems.push(`${m.id}: unknown region ${r}`);
  }
  const levels = M.map((m) => m.level);
  if (Math.min(...levels) !== 1) problems.push('roster should start at level 1');
  if (Math.max(...levels) !== 100) problems.push('roster should top out at level 100');
  return problems;
}
