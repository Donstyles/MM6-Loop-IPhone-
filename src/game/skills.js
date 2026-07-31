// The MM6 skill system.
//
// MM6 has three mastery ranks only - Normal, Expert, Master. (Grandmaster
// arrived in MM7 and must not appear here.) A skill is a pair of
// { level, mastery }: level is bought with skill points, mastery is bought from
// a teacher and gates how high the level may usefully go for that class.

export const MASTERY = Object.freeze({ NONE: 0, NORMAL: 1, EXPERT: 2, MASTER: 3 });
export const MASTERY_NAMES = Object.freeze(['-', 'Normal', 'Expert', 'Master']);
/** Effective-skill multiplier per rank; formulas that scale with mastery use it. */
export const MASTERY_MULT = Object.freeze([0, 1, 1.5, 2]);

export const SKILL_CATEGORIES = Object.freeze({
  weapon: 'Weapons',
  armor: 'Armour',
  magic: 'Magic',
  misc: 'Miscellaneous',
});

// ---------------------------------------------------------------------------
// Skill definitions
// ---------------------------------------------------------------------------
//
// Every skill exposes `compute(level, mastery)` returning a flat bag of numeric
// contributions. Keys used by other modules:
//   value    generic scalar (AC for armour, HP for body building, % for misc)
//   attack   added to attack rolls
//   damage   added to weapon damage
//   recovery subtracted from recovery time
//   special  a rank-specific flag object (stun chance, ignores AC, ...)

const S = [];
function skill(def) {
  def.text = def.text || {};
  S.push(def);
  return def;
}

// --- Weapons -----------------------------------------------------------------
//
// The house rule (matching how MM6 plays): every weapon skill adds its level to
// Attack at all ranks; Expert adds the level to Damage as well; Master adds a
// recovery reduction plus the weapon's signature trick.

function weaponSkill(id, name, opts) {
  const o = opts || {};
  return skill({
    id, name, category: 'weapon',
    desc: o.desc || '',
    text: {
      1: `+${'skill'} Attack with ${name.toLowerCase()}s.`,
      2: `+skill Attack and +skill Damage.`,
      3: o.masterText || `+skill Attack, +skill x 1.75 Damage, and faster recovery.`,
    },
    compute(level, mastery) {
      const m = mastery | 0;
      const out = { value: level, attack: level, damage: 0, recovery: 0, special: null };
      // Expert adds the skill to damage; Master adds three quarters again.
      // This is what keeps a veteran's swing growing alongside the monster
      // hit-point curve, which is quadratic in level.
      if (m >= MASTERY.EXPERT) out.damage = level;
      if (m >= MASTERY.MASTER) {
        out.damage = Math.round(level * 1.75);
        out.recovery = Math.floor(level * (o.masterRecovery !== undefined ? o.masterRecovery : 1));
        out.special = o.master ? o.master(level) : null;
      }
      return out;
    },
  });
}

weaponSkill('staff', 'Staff', {
  desc: 'A quarterstaff. Cheap, two-handed, and the sorcerer\'s only real weapon.',
  masterText: '+skill Attack and Damage; a blow may stun the target.',
  masterRecovery: 0.5,
  master: (lv) => ({ stunChance: Math.min(40, lv) }),
});
weaponSkill('sword', 'Sword', {
  desc: 'Blades of every length. The knight\'s bread and butter.',
  masterText: '+skill Attack and Damage; recovery drops sharply.',
  masterRecovery: 1.5,
});
weaponSkill('dagger', 'Dagger', {
  desc: 'Fast, weak, and lethal in the right hands.',
  masterText: '+skill Attack and Damage; a chance to strike three times as hard.',
  masterRecovery: 1,
  master: (lv) => ({ tripleChance: Math.min(30, Math.floor(lv / 2)) }),
});
weaponSkill('axe', 'Axe', {
  desc: 'Heavy, slow, and it goes through armour.',
  masterText: '+skill Attack and Damage; blows ignore part of the target\'s armour.',
  masterRecovery: 0.5,
  master: (lv) => ({ ignoreAC: Math.floor(lv / 2) }),
});
weaponSkill('spear', 'Spear', {
  desc: 'Reach. Expert lets you carry a shield with it.',
  masterText: '+skill Attack and Damage, and +skill/2 to Armour Class.',
  masterRecovery: 0.5,
  master: (lv) => ({ acBonus: Math.floor(lv / 2), oneHanded: true }),
});
weaponSkill('bow', 'Bow', {
  desc: 'Ranged attacks. No Might bonus to damage, so skill is everything.',
  masterText: '+skill Attack and Damage; noticeably faster draw.',
  masterRecovery: 1.5,
});
weaponSkill('mace', 'Mace', {
  desc: 'Blunt force. The cleric\'s weapon.',
  masterText: '+skill Attack and Damage; a blow may paralyse.',
  masterRecovery: 0.5,
  master: (lv) => ({ paralyzeChance: Math.min(25, Math.floor(lv / 2)) }),
});
weaponSkill('blaster', 'Blaster', {
  desc: 'The weapons of the Ancients. Nothing resists them.',
  masterText: '+skill Attack and Damage; fires at the minimum recovery time.',
  masterRecovery: 3,
  master: () => ({ minRecovery: true }),
});

// --- Armour ------------------------------------------------------------------
//
// Armour skills give AC equal to the skill level while wearing that class of
// armour. Expert cancels the recovery penalty the armour imposes, Master
// doubles the AC bonus.

function armorSkill(id, name, opts) {
  const o = opts || {};
  return skill({
    id, name, category: 'armor', desc: o.desc || '',
    text: {
      1: `+skill Armour Class while wearing ${name.toLowerCase()}.`,
      2: o.expertText || `+skill Armour Class and no recovery penalty from ${name.toLowerCase()}.`,
      3: `Double Armour Class bonus from ${name.toLowerCase()}.`,
    },
    compute(level, mastery) {
      const m = mastery | 0;
      const out = { value: level, attack: 0, damage: 0, recovery: 0, special: null };
      if (m >= MASTERY.MASTER) out.value = level * 2;
      out.special = {
        negatePenalty: m >= MASTERY.EXPERT,
        halveMissile: id === 'shield' && m >= MASTERY.EXPERT,
      };
      return out;
    },
  });
}

armorSkill('leather', 'Leather', { desc: 'Soft armour. No recovery penalty at all, and mages may wear it.' });
armorSkill('chain', 'Chain', { desc: 'Mail. A modest recovery penalty until Expert.' });
armorSkill('plate', 'Plate', { desc: 'The heaviest armour. Punishing recovery penalty until Expert.' });
armorSkill('shield', 'Shield', {
  desc: 'A shield in the off hand.',
  expertText: '+skill Armour Class and missile damage against you is halved.',
});

// --- Magic -------------------------------------------------------------------
//
// A magic skill's value is the level itself: spells read it directly. Mastery
// gates which of the eleven spells in the school may be *cast*, and upgrades
// the effect of the ones below it.
//   Normal: spells 1-4    Expert: spells 1-7    Master: all 11

export const SCHOOL_TIER_LIMIT = Object.freeze([0, 4, 7, 11]);

function magicSkill(id, name, desc) {
  return skill({
    id, name, category: 'magic', desc,
    text: {
      1: `Cast the first four ${name} spells.`,
      2: `Cast the first seven ${name} spells, and at Expert power.`,
      3: `Cast all eleven ${name} spells, at Master power.`,
    },
    compute(level, mastery) {
      const m = mastery | 0;
      return {
        value: level,
        attack: 0, damage: 0, recovery: 0,
        special: { maxTier: SCHOOL_TIER_LIMIT[m] || 0, power: MASTERY_MULT[m] || 0 },
      };
    },
  });
}

magicSkill('fire', 'Fire Magic', 'Direct damage, and Haste.');
magicSkill('air', 'Air Magic', 'Lightning, flight, and the Wizard Eye.');
magicSkill('water', 'Water Magic', 'Cold damage, Town Portal and Lloyd\'s Beacon.');
magicSkill('earth', 'Earth Magic', 'Poison, Stone Skin and Mass Distortion.');
magicSkill('spirit', 'Spirit Magic', 'Blessings, Heroism and raising the dead.');
magicSkill('mind', 'Mind Magic', 'Charm, fear and psychic damage.');
magicSkill('body', 'Body Magic', 'Healing, cures and Hammerhands.');
magicSkill('light', 'Light Magic', 'The greatest blessings, and Divine Intervention.');
magicSkill('dark', 'Dark Magic', 'Souldrinker, Armageddon and the raising of the dead as servants.');

// --- Miscellaneous -----------------------------------------------------------

skill({
  id: 'body_building', name: 'Body Building', category: 'misc',
  desc: 'Extra hit points for every point of skill.',
  text: { 1: '+skill hit points.', 2: '+skill x 1.5 hit points.', 3: '+skill x 2 hit points.' },
  compute(level, mastery) {
    return { value: Math.floor(level * (MASTERY_MULT[mastery | 0] || 1)), attack: 0, damage: 0, recovery: 0, special: null };
  },
});
skill({
  id: 'meditation', name: 'Meditation', category: 'misc',
  desc: 'Extra spell points for every point of skill.',
  text: { 1: '+skill spell points.', 2: '+skill x 1.5 spell points.', 3: '+skill x 2 spell points.' },
  compute(level, mastery) {
    return { value: Math.floor(level * (MASTERY_MULT[mastery | 0] || 1)), attack: 0, damage: 0, recovery: 0, special: null };
  },
});
skill({
  id: 'merchant', name: 'Merchant', category: 'misc',
  desc: 'Better prices when buying and selling.',
  text: { 1: 'skill% better prices.', 2: 'skill x 1.5% better prices.', 3: 'skill x 2% better prices; buy at cost.' },
  compute(level, mastery) {
    return { value: Math.floor(level * (MASTERY_MULT[mastery | 0] || 1) * 2), attack: 0, damage: 0, recovery: 0, special: { atCost: (mastery | 0) >= MASTERY.MASTER } };
  },
});
skill({
  id: 'repair', name: 'Repair Item', category: 'misc',
  desc: 'Fix broken equipment without paying a smith.',
  text: {
    1: 'Repair items up to level skill.',
    2: 'Repair items up to level skill x 3.',
    3: 'Repair any item.',
  },
  compute(level, mastery) {
    const m = mastery | 0;
    const cap = m >= MASTERY.MASTER ? 999 : m >= MASTERY.EXPERT ? level * 3 : level;
    return { value: cap, attack: 0, damage: 0, recovery: 0, special: { maxItemLevel: cap } };
  },
});
skill({
  id: 'identify', name: 'Identify Item', category: 'misc',
  desc: 'Learn what an unidentified item really is.',
  text: {
    1: 'Identify items up to level skill.',
    2: 'Identify items up to level skill x 3.',
    3: 'Identify any item, including artifacts.',
  },
  compute(level, mastery) {
    const m = mastery | 0;
    const cap = m >= MASTERY.MASTER ? 999 : m >= MASTERY.EXPERT ? level * 3 : level;
    return { value: cap, attack: 0, damage: 0, recovery: 0, special: { maxItemLevel: cap } };
  },
});
skill({
  id: 'perception', name: 'Perception', category: 'misc',
  desc: 'Spot traps, secret doors and hidden treasure.',
  text: { 1: 'skill% chance to notice.', 2: 'skill x 1.5% chance, and better chest loot.', 3: 'skill x 2% chance; traps are always seen.' },
  compute(level, mastery) {
    const m = mastery | 0;
    const pct = Math.min(95, Math.floor(level * (MASTERY_MULT[m] || 1) * 3));
    return { value: pct, attack: 0, damage: 0, recovery: 0, special: { alwaysSeeTraps: m >= MASTERY.MASTER, lootBonus: m >= MASTERY.EXPERT ? 1 : 0 } };
  },
});
skill({
  id: 'disarm', name: 'Disarm Trap', category: 'misc',
  desc: 'Open trapped chests without losing a face.',
  text: { 1: 'skill% chance to disarm.', 2: 'skill x 1.5% chance.', 3: 'skill x 2% chance; failures do half damage.' },
  compute(level, mastery) {
    const m = mastery | 0;
    const pct = Math.min(95, Math.floor(level * (MASTERY_MULT[m] || 1) * 3));
    return { value: pct, attack: 0, damage: 0, recovery: 0, special: { softFail: m >= MASTERY.MASTER } };
  },
});
skill({
  id: 'diplomacy', name: 'Diplomacy', category: 'misc',
  desc: 'Monsters are slower to anger and townsfolk friendlier.',
  text: { 1: 'skill% less monster aggression.', 2: 'skill x 1.5%, and better reputation gains.', 3: 'skill x 2%; many monsters will not attack at all.' },
  compute(level, mastery) {
    const m = mastery | 0;
    const pct = Math.min(80, Math.floor(level * (MASTERY_MULT[m] || 1) * 2));
    return { value: pct, attack: 0, damage: 0, recovery: 0, special: { pacify: m >= MASTERY.MASTER } };
  },
});
skill({
  id: 'learning', name: 'Learning', category: 'misc',
  desc: 'Every point of skill is another percent of experience.',
  text: { 1: '+skill% experience.', 2: '+skill x 1.5% experience.', 3: '+skill x 2% experience.' },
  compute(level, mastery) {
    return { value: Math.floor(level * (MASTERY_MULT[mastery | 0] || 1)), attack: 0, damage: 0, recovery: 0, special: null };
  },
});

/** Every skill, in character-sheet order. */
export const SKILLS = S;
const SKILL_MAP = new Map(S.map((s) => [s.id, s]));

export function skillById(id) { return SKILL_MAP.get(id) || null; }
export const SKILL_IDS = S.map((s) => s.id);
export const WEAPON_SKILLS = S.filter((s) => s.category === 'weapon').map((s) => s.id);
export const ARMOR_SKILLS = S.filter((s) => s.category === 'armor').map((s) => s.id);
export const MAGIC_SKILLS = S.filter((s) => s.category === 'magic').map((s) => s.id);
export const MISC_SKILLS = S.filter((s) => s.category === 'misc').map((s) => s.id);

// ---------------------------------------------------------------------------
// Class / skill / mastery matrix
// ---------------------------------------------------------------------------
//
// Each entry is [tier0, tier1, tier2] max mastery for that class line.
// 0 = the class can never learn the skill at all.

const LINE_SKILLS = {
  knight: {
    sword: [2, 3, 3], axe: [2, 3, 3], spear: [2, 3, 3], mace: [2, 3, 3], dagger: [2, 3, 3],
    staff: [1, 2, 2], bow: [1, 2, 2], blaster: [1, 1, 1],
    leather: [2, 3, 3], chain: [2, 3, 3], plate: [2, 3, 3], shield: [2, 3, 3],
    body_building: [2, 3, 3], repair: [1, 2, 3], identify: [1, 2, 2], merchant: [1, 2, 2],
    perception: [1, 2, 2], disarm: [1, 2, 2], diplomacy: [1, 2, 2], learning: [1, 2, 2],
  },
  paladin: {
    sword: [2, 3, 3], mace: [2, 3, 3], spear: [2, 3, 3], axe: [2, 2, 3], dagger: [1, 2, 2],
    staff: [1, 2, 2], bow: [1, 1, 2], blaster: [1, 1, 1],
    leather: [2, 3, 3], chain: [2, 3, 3], plate: [2, 2, 3], shield: [2, 3, 3],
    spirit: [1, 2, 3], mind: [1, 2, 3], body: [1, 2, 3],
    body_building: [2, 3, 3], meditation: [1, 2, 2], repair: [1, 2, 2], identify: [1, 2, 2],
    merchant: [1, 2, 3], perception: [1, 2, 2], disarm: [1, 1, 2], diplomacy: [2, 3, 3], learning: [1, 2, 2],
  },
  archer: {
    bow: [2, 3, 3], sword: [2, 2, 3], dagger: [2, 3, 3], spear: [1, 2, 2], axe: [1, 2, 2],
    mace: [1, 1, 2], staff: [1, 2, 2], blaster: [1, 2, 2],
    leather: [2, 3, 3], chain: [1, 2, 3], shield: [1, 2, 2],
    fire: [1, 2, 3], air: [1, 2, 3], water: [1, 2, 3], earth: [1, 2, 3],
    body_building: [2, 3, 3], meditation: [1, 2, 3], perception: [2, 3, 3], disarm: [1, 2, 3],
    identify: [1, 2, 2], repair: [1, 2, 2], merchant: [1, 2, 2], diplomacy: [1, 2, 2], learning: [1, 2, 3],
  },
  cleric: {
    mace: [2, 3, 3], staff: [2, 3, 3], dagger: [1, 1, 2], sword: [1, 1, 1], spear: [1, 1, 1],
    bow: [1, 1, 1], blaster: [1, 2, 2],
    leather: [2, 3, 3], chain: [1, 2, 3], plate: [1, 1, 2], shield: [2, 3, 3],
    spirit: [2, 3, 3], mind: [2, 3, 3], body: [2, 3, 3], light: [1, 2, 3], dark: [1, 2, 3],
    body_building: [1, 2, 2], meditation: [2, 3, 3], identify: [1, 2, 2], repair: [1, 2, 2],
    merchant: [1, 2, 3], perception: [1, 2, 2], disarm: [1, 1, 2], diplomacy: [2, 3, 3], learning: [2, 3, 3],
  },
  sorcerer: {
    staff: [2, 3, 3], dagger: [2, 3, 3], blaster: [2, 3, 3], sword: [1, 1, 1], bow: [1, 2, 2], spear: [1, 1, 1],
    leather: [2, 3, 3], shield: [1, 1, 2],
    fire: [2, 3, 3], air: [2, 3, 3], water: [2, 3, 3], earth: [2, 3, 3], light: [1, 2, 3], dark: [1, 2, 3],
    body_building: [1, 1, 2], meditation: [2, 3, 3], identify: [2, 3, 3], repair: [1, 2, 3],
    merchant: [1, 2, 2], perception: [1, 2, 2], disarm: [1, 2, 2], diplomacy: [1, 2, 2], learning: [2, 3, 3],
  },
  druid: {
    staff: [2, 3, 3], dagger: [2, 3, 3], mace: [1, 2, 2], spear: [1, 2, 2], bow: [1, 2, 2],
    sword: [1, 1, 1], blaster: [1, 2, 2],
    leather: [2, 3, 3], chain: [1, 2, 2], shield: [1, 2, 2],
    fire: [1, 2, 3], air: [1, 2, 3], water: [1, 2, 3], earth: [1, 2, 3],
    spirit: [1, 2, 3], mind: [1, 2, 3], body: [1, 2, 3],
    body_building: [1, 2, 2], meditation: [2, 3, 3], identify: [1, 2, 3], repair: [1, 2, 2],
    merchant: [1, 2, 2], perception: [1, 2, 3], disarm: [1, 2, 2], diplomacy: [2, 3, 3], learning: [2, 3, 3],
  },
};

// Expand the per-line tables into a flat classId -> {skill: maxMastery} map.
const CLASS_TIERS = {
  knight: ['knight', 'cavalier', 'champion'],
  paladin: ['paladin', 'crusader', 'hero'],
  archer: ['archer', 'battle_mage', 'warrior_mage'],
  cleric: ['cleric', 'priest', 'high_priest'],
  sorcerer: ['sorcerer', 'wizard', 'archmage'],
  druid: ['druid', 'great_druid', 'arch_druid'],
};

export const CLASS_SKILLS = {};
for (const line of Object.keys(LINE_SKILLS)) {
  CLASS_TIERS[line].forEach((classId, tier) => {
    const table = {};
    for (const skillId of Object.keys(LINE_SKILLS[line])) {
      const v = LINE_SKILLS[line][skillId][tier] | 0;
      if (v > 0) table[skillId] = v;
    }
    CLASS_SKILLS[classId] = table;
  });
}

/** Highest mastery `klass` may ever reach in `skill`; 0 means "never". */
export function classSkillMax(klass, skill) {
  const t = CLASS_SKILLS[klass];
  if (!t) return MASTERY.NONE;
  return t[skill] || MASTERY.NONE;
}

/** Can this class learn the skill at all? */
export function classCanLearn(klass, skill) {
  return classSkillMax(klass, skill) > MASTERY.NONE;
}

/** Every skill id the class may learn, grouped by category. */
export function classSkillList(klass) {
  const t = CLASS_SKILLS[klass] || {};
  const out = { weapon: [], armor: [], magic: [], misc: [] };
  for (const s of S) if (t[s.id]) out[s.category].push(s.id);
  return out;
}

/** The two starting skills MM6 gives each class, plus its free extras. */
export const CLASS_START_SKILLS = {
  knight: ['sword', 'leather', 'chain', 'body_building'],
  paladin: ['sword', 'leather', 'shield', 'spirit'],
  archer: ['bow', 'leather', 'sword', 'fire'],
  cleric: ['mace', 'leather', 'spirit', 'body'],
  sorcerer: ['staff', 'leather', 'fire', 'air'],
  druid: ['staff', 'leather', 'earth', 'body'],
};

// ---------------------------------------------------------------------------
// Costs and queries
// ---------------------------------------------------------------------------

/**
 * MM6 skill point cost: raising a skill from N to N+1 costs N+1 points.
 * (So the first point is free-ish at cost 1, and level 10 -> 11 costs 11.)
 */
export function skillPointCost(currentLevel) {
  return Math.max(1, (currentLevel | 0) + 1);
}

/** Total points to go from 0 to `level`. */
export function totalSkillCost(level) {
  const n = Math.max(0, level | 0);
  return (n * (n + 1)) / 2;
}

/** Gold a teacher charges to grant the next mastery rank. */
export function masteryCost(mastery) {
  switch (mastery | 0) {
    case MASTERY.EXPERT: return 2000;
    case MASTERY.MASTER: return 5000;
    default: return 50;
  }
}

/** Minimum skill level a teacher demands before granting a rank. */
export function masteryRequirement(mastery) {
  switch (mastery | 0) {
    case MASTERY.EXPERT: return 4;
    case MASTERY.MASTER: return 8;
    default: return 0;
  }
}

/**
 * Describe a { level, mastery } pair. `effective` is the mastery-weighted skill
 * value that the scaling formulas (Body Building, Learning, spells...) use.
 */
export function masteryOf(skillValue, mastery) {
  const m = Math.max(0, Math.min(3, mastery | 0));
  const lv = Math.max(0, skillValue | 0);
  return {
    level: lv,
    mastery: m,
    name: MASTERY_NAMES[m],
    label: lv > 0 ? `${MASTERY_NAMES[m]} ${lv}` : 'Not learned',
    multiplier: MASTERY_MULT[m],
    effective: Math.round(lv * MASTERY_MULT[m]),
    maxSpellTier: SCHOOL_TIER_LIMIT[m] || 0,
  };
}

const NO_EFFECT = Object.freeze({ value: 0, attack: 0, damage: 0, recovery: 0, special: null, text: 'Not learned.' });

/**
 * Numeric effect of a skill at a given level and mastery. Always returns an
 * object; unknown skills and level 0 return zeroes.
 */
export function skillEffect(skillId, value, mastery) {
  const def = SKILL_MAP.get(skillId);
  const lv = value | 0;
  const m = mastery === undefined ? MASTERY.NORMAL : mastery | 0;
  if (!def || lv <= 0 || m <= 0) return NO_EFFECT;
  const out = def.compute(lv, m);
  out.text = (def.text[m] || '').replace(/skill/g, String(lv));
  out.mastery = m;
  out.level = lv;
  return out;
}

/** Human-readable one-liner for the skill screen. */
export function skillDescription(skillId, value, mastery) {
  const def = SKILL_MAP.get(skillId);
  if (!def) return '';
  const mo = masteryOf(value, mastery);
  const eff = skillEffect(skillId, value, mastery);
  return `${def.name} - ${mo.label}. ${eff.text || def.desc}`;
}
