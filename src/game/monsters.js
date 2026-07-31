// The bestiary.
//
// Every id here matches a sprite kind produced by src/art/models/creatures.js.
// Do not rename an id without renaming it there too.
//
// Balance shape: level runs 1-60. Hit points are roughly level*7 for a soldier,
// half that for a swarmer and double for a brute. Damage per swing lands near
// level*1.1 so a four-character party of the same level wins a straight fight
// against two same-level monsters with a little to spare.

/** Monster families drive resistances, AI and "double damage vs" enchantments. */
export const FAMILIES = [
  'humanoid', 'human', 'undead', 'beast', 'insect', 'reptile', 'elemental',
  'construct', 'giant', 'dragon', 'demon', 'plant', 'ooze', 'avian',
];

/** Broad regions of Enroth the spawner knows about. */
export const REGIONS = [
  'new_sorpigal', 'castle_ironfist', 'bootleg_bay', 'free_haven', 'silver_cove',
  'blackshire', 'mire_of_the_damned', 'kriegspire', 'eel_infested_waters',
  'dragonsand', 'paradise_valley', 'sweet_water', 'white_cap', 'frozen_highlands',
  // Dungeon themes double as regions for the spawn tables.
  'cave', 'crypt', 'temple', 'tower', 'mine', 'sewer', 'ruins', 'lair',
];

const M = [];

/**
 * mon(id, name, level, hp, ac, [dice, sides, bonus, element], opts)
 * `opts` fills in everything else; the defaults are a plain melee brute.
 */
function mon(id, name, level, hp, ac, atk, opts) {
  const o = opts || {};
  const def = {
    id, name, level, hp, ac,
    attack: { dice: { n: atk[0], s: atk[1] }, bonus: atk[2] || 0, element: atk[3] || 'physical' },
    attack2: o.attack2 || null,
    ranged: o.ranged || null,
    speed: o.speed !== undefined ? o.speed : 200,
    recoveryTime: o.recoveryTime !== undefined ? o.recoveryTime : 100,
    xp: o.xp !== undefined ? o.xp : Math.round(level * level * 4 + level * 12 + 5),
    treasureLevel: o.treasureLevel !== undefined ? o.treasureLevel : Math.max(1, Math.min(6, Math.ceil(level / 10))),
    resistances: Object.assign({ fire: 0, air: 0, water: 0, earth: 0, mind: 0, body: 0, magic: 0 }, o.resistances || {}),
    immunities: o.immunities || [],
    aggroRange: o.aggroRange !== undefined ? o.aggroRange : 1500,
    family: o.family || 'humanoid',
    size: o.size !== undefined ? o.size : 190,
    spawnRegions: o.spawnRegions || ['cave'],
    flying: !!o.flying,
    undead: !!o.undead,
    groupSize: o.groupSize || [1, 3],
    // Behaviour knobs read by combat.js.
    fleeAtHP: o.fleeAtHP !== undefined ? o.fleeAtHP : 0,
    caster: !!o.caster,
    spells: o.spells || null,
    inflict: o.inflict || null,
    gold: o.gold !== undefined ? o.gold : Math.round(level * level * 0.8 + level * 6),
    desc: o.desc || '',
  };
  M.push(def);
  return def;
}

// ---------------------------------------------------------------------------
// Goblins and bandits - the first things a new party fights
// ---------------------------------------------------------------------------

mon('goblin', 'Goblin', 1, 10, 3, [1, 4, 0], {
  family: 'humanoid', size: 150, speed: 220, recoveryTime: 90, xp: 25, gold: 8,
  spawnRegions: ['new_sorpigal', 'cave', 'mine', 'ruins'], groupSize: [2, 5], aggroRange: 1200,
  desc: 'Small, mean, and never alone.',
});
mon('goblin_shaman', 'Goblin Shaman', 4, 24, 6, [1, 4, 1], {
  family: 'humanoid', size: 155, speed: 200, xp: 90, gold: 30, caster: true,
  ranged: { spell: 'fire_bolt', damage: { n: 2, s: 6 }, element: 'fire', range: 2500 },
  spells: ['fire_bolt', 'stun'], resistances: { fire: 15, magic: 10 },
  spawnRegions: ['new_sorpigal', 'cave', 'mine', 'ruins'], groupSize: [1, 2],
  desc: 'Throws fire it barely understands.',
});
mon('goblin_king', 'Goblin King', 9, 90, 14, [2, 5, 3], {
  family: 'humanoid', size: 185, speed: 230, xp: 400, gold: 250, treasureLevel: 3,
  attack2: { dice: { n: 1, s: 6 }, bonus: 2, element: 'physical' },
  resistances: { fire: 10, mind: 20 }, spawnRegions: ['cave', 'mine', 'lair'], groupSize: [1, 1],
  desc: 'Bigger, uglier, and wearing everyone else\'s gold.',
});
mon('peasant', 'Peasant', 1, 8, 2, [1, 3, 0], {
  family: 'human', size: 185, speed: 170, xp: 10, gold: 4, fleeAtHP: 0.4,
  spawnRegions: ['new_sorpigal', 'free_haven', 'castle_ironfist'], groupSize: [1, 3],
  desc: 'Frightened and armed with a stick.',
});
mon('thug', 'Thug', 3, 26, 6, [1, 6, 1], {
  family: 'human', size: 190, speed: 200, xp: 70, gold: 25,
  spawnRegions: ['new_sorpigal', 'free_haven', 'sewer', 'ruins'], groupSize: [2, 4],
  desc: 'Muscle for hire, and cheap at the price.',
});
mon('bandit', 'Bandit', 6, 48, 10, [1, 8, 2], {
  family: 'human', size: 190, speed: 210, xp: 190, gold: 70, treasureLevel: 2,
  ranged: { projectile: 'arrow', damage: { n: 1, s: 6 }, element: 'physical', range: 3000 },
  spawnRegions: ['free_haven', 'blackshire', 'ruins', 'cave'], groupSize: [2, 4],
  desc: 'Robs travellers on the Free Haven road.',
});
mon('brigand', 'Brigand', 12, 105, 18, [2, 6, 4], {
  family: 'human', size: 192, speed: 220, xp: 620, gold: 200, treasureLevel: 3,
  ranged: { projectile: 'crossbow_bolt', damage: { n: 2, s: 6 }, element: 'physical', range: 3200 },
  spawnRegions: ['blackshire', 'silver_cove', 'ruins'], groupSize: [2, 5],
  desc: 'A bandit who survived long enough to get good at it.',
});

// ---------------------------------------------------------------------------
// Human casters and the cult of Baa
// ---------------------------------------------------------------------------

mon('apprentice_mage', 'Apprentice Mage', 5, 30, 7, [1, 4, 0], {
  family: 'human', size: 185, speed: 180, xp: 140, gold: 45, caster: true, treasureLevel: 2,
  ranged: { spell: 'fire_bolt', damage: { n: 3, s: 6 }, element: 'fire', range: 2800 },
  spells: ['fire_bolt', 'sparks'], resistances: { fire: 15, air: 15, magic: 15 },
  spawnRegions: ['tower', 'free_haven', 'ruins'], groupSize: [1, 3],
  desc: 'Knows two spells and is proud of both.',
});
mon('initiate_mage', 'Initiate Mage', 14, 90, 16, [1, 6, 2], {
  family: 'human', size: 185, speed: 190, xp: 780, gold: 180, caster: true, treasureLevel: 3,
  ranged: { spell: 'lightning_bolt', damage: { n: 5, s: 8 }, element: 'air', range: 3200 },
  spells: ['lightning_bolt', 'fireball', 'shield'], resistances: { fire: 25, air: 25, water: 25, magic: 25 },
  spawnRegions: ['tower', 'silver_cove', 'ruins'], groupSize: [1, 3],
  desc: 'Robed, hostile, and disappointingly competent.',
});
mon('master_mage', 'Master Mage', 26, 220, 30, [2, 6, 4], {
  family: 'human', size: 188, speed: 200, xp: 3400, gold: 800, caster: true, treasureLevel: 5,
  ranged: { spell: 'implosion', damage: { n: 8, s: 10 }, element: 'air', range: 3500 },
  spells: ['implosion', 'meteor_shower', 'ice_blast', 'shield'],
  resistances: { fire: 45, air: 45, water: 45, earth: 45, magic: 50 },
  spawnRegions: ['tower', 'kriegspire', 'ruins'], groupSize: [1, 2],
  desc: 'The kind of wizard who ends fights in one casting.',
});
mon('acolyte', 'Acolyte of Baa', 7, 52, 11, [1, 6, 2], {
  family: 'human', size: 186, speed: 190, xp: 250, gold: 80, caster: true,
  ranged: { spell: 'harm', damage: { n: 3, s: 6 }, element: 'body', range: 2500 },
  spells: ['harm', 'bless'], resistances: { mind: 20, body: 20 },
  spawnRegions: ['temple', 'free_haven', 'crypt'], groupSize: [2, 4],
  desc: 'Newly robed and eager to prove it.',
});
mon('cleric_of_baa', 'Cleric of Baa', 16, 130, 20, [2, 6, 3], {
  family: 'human', size: 188, speed: 190, xp: 1100, gold: 260, caster: true, treasureLevel: 4,
  ranged: { spell: 'harm', damage: { n: 6, s: 6 }, element: 'body', range: 2800 },
  spells: ['harm', 'heroism', 'shared_life'], resistances: { mind: 35, body: 35, magic: 25 },
  spawnRegions: ['temple', 'crypt', 'silver_cove'], groupSize: [1, 3],
  desc: 'Heals its own kind, which is worse than it sounds.',
});
mon('priest_of_baa', 'Priest of Baa', 24, 200, 28, [2, 8, 4], {
  family: 'human', size: 190, speed: 200, xp: 2900, gold: 700, caster: true, treasureLevel: 5,
  ranged: { spell: 'psychic_shock', damage: { n: 8, s: 8 }, element: 'mind', range: 3000 },
  spells: ['psychic_shock', 'paralyze', 'shared_life'],
  resistances: { mind: 50, body: 50, magic: 40, fire: 20 },
  spawnRegions: ['temple', 'crypt', 'kriegspire'], groupSize: [1, 2],
  desc: 'High in the cult, and armed accordingly.',
});
mon('high_priest', 'High Priest of Baa', 36, 420, 42, [3, 8, 6], {
  family: 'human', size: 195, speed: 210, xp: 9000, gold: 2500, treasureLevel: 6, caster: true,
  ranged: { spell: 'sunray', damage: { n: 12, s: 10 }, element: 'dark', range: 3500 },
  spells: ['sunray', 'paralyze', 'divine_intervention'],
  resistances: { fire: 60, air: 60, water: 60, earth: 60, mind: 80, body: 80, magic: 70 },
  spawnRegions: ['temple', 'lair'], groupSize: [1, 1],
  desc: 'The voice of Baa on Enroth. Bring everything you have.',
});

// ---------------------------------------------------------------------------
// Soldiers, knights and dwarves
// ---------------------------------------------------------------------------

mon('knight', 'Knight', 15, 140, 24, [2, 8, 3], {
  family: 'human', size: 195, speed: 190, recoveryTime: 110, xp: 950, gold: 200, treasureLevel: 4,
  resistances: { fire: 15, magic: 15 }, spawnRegions: ['castle_ironfist', 'ruins', 'tower'], groupSize: [1, 3],
  desc: 'Plate armour and a very long sword.',
});
mon('crusader', 'Crusader', 22, 240, 32, [2, 10, 5], {
  family: 'human', size: 198, speed: 200, recoveryTime: 105, xp: 2400, gold: 500, treasureLevel: 5,
  attack2: { dice: { n: 1, s: 8 }, bonus: 3, element: 'light' },
  resistances: { fire: 25, mind: 30, magic: 30 }, spawnRegions: ['castle_ironfist', 'temple', 'ruins'], groupSize: [1, 3],
  desc: 'Holy war, professionally conducted.',
});
mon('templar', 'Templar', 30, 340, 40, [3, 8, 6], {
  family: 'human', size: 200, speed: 205, xp: 5200, gold: 1100, treasureLevel: 6,
  attack2: { dice: { n: 2, s: 6 }, bonus: 4, element: 'light' },
  resistances: { fire: 35, mind: 45, body: 35, magic: 45 },
  spawnRegions: ['temple', 'castle_ironfist', 'lair'], groupSize: [1, 2],
  desc: 'The order\'s finest, and they know it.',
});
mon('dwarf', 'Dwarf', 8, 75, 14, [1, 8, 3], {
  family: 'humanoid', size: 130, speed: 170, recoveryTime: 110, xp: 320, gold: 110, treasureLevel: 3,
  resistances: { earth: 30, fire: 15 }, spawnRegions: ['mine', 'cave', 'white_cap'], groupSize: [2, 4],
  desc: 'Short, broad, and swinging a pick at your knees.',
});
mon('dwarf_guard', 'Dwarven Guard', 18, 190, 28, [2, 8, 5], {
  family: 'humanoid', size: 135, speed: 175, recoveryTime: 115, xp: 1500, gold: 350, treasureLevel: 4,
  resistances: { earth: 45, fire: 30, magic: 20 }, spawnRegions: ['mine', 'white_cap', 'cave'], groupSize: [2, 4],
  desc: 'Guards the deep seams. Nothing gets past.',
});

// ---------------------------------------------------------------------------
// Beasts
// ---------------------------------------------------------------------------

mon('giant_rat', 'Giant Rat', 1, 8, 2, [1, 3, 0], {
  family: 'beast', size: 70, speed: 250, recoveryTime: 80, xp: 15, gold: 0, treasureLevel: 1,
  spawnRegions: ['sewer', 'cave', 'new_sorpigal', 'crypt', 'mine'], groupSize: [3, 6], aggroRange: 1000,
  desc: 'Rats the size of dogs. The sewers are full of them.',
});
mon('boar', 'Wild Boar', 3, 30, 5, [1, 6, 1], {
  family: 'beast', size: 120, speed: 260, xp: 75, gold: 0,
  spawnRegions: ['new_sorpigal', 'bootleg_bay', 'castle_ironfist'], groupSize: [1, 3],
  desc: 'Bad tempered and fast.',
});
mon('wolf', 'Wolf', 4, 32, 7, [1, 6, 1], {
  family: 'beast', size: 110, speed: 300, recoveryTime: 80, xp: 95, gold: 0,
  spawnRegions: ['new_sorpigal', 'castle_ironfist', 'white_cap', 'frozen_highlands'], groupSize: [2, 5],
  desc: 'They hunt in packs and circle before they close.',
});
mon('dire_wolf', 'Dire Wolf', 11, 100, 16, [2, 6, 2], {
  family: 'beast', size: 145, speed: 320, recoveryTime: 80, xp: 520, gold: 0,
  spawnRegions: ['blackshire', 'frozen_highlands', 'white_cap', 'cave'], groupSize: [2, 5],
  desc: 'Bigger than a pony and considerably less friendly.',
});
mon('warg', 'Warg', 19, 190, 26, [2, 8, 4], {
  family: 'beast', size: 165, speed: 340, recoveryTime: 75, xp: 1700, gold: 0, treasureLevel: 3,
  resistances: { mind: 25 }, spawnRegions: ['kriegspire', 'frozen_highlands', 'lair'], groupSize: [2, 4],
  desc: 'A wolf with something worse riding under its skin.',
});
mon('bear', 'Bear', 9, 95, 12, [2, 6, 3], {
  family: 'beast', size: 210, speed: 230, recoveryTime: 120, xp: 380, gold: 0,
  attack2: { dice: { n: 1, s: 8 }, bonus: 2, element: 'physical' },
  spawnRegions: ['castle_ironfist', 'white_cap', 'bootleg_bay'], groupSize: [1, 2],
  desc: 'Two swipes and a bite. Do not be there for the third.',
});
mon('cave_bear', 'Cave Bear', 17, 210, 22, [3, 6, 4], {
  family: 'beast', size: 250, speed: 240, recoveryTime: 120, xp: 1400, gold: 0, treasureLevel: 2,
  attack2: { dice: { n: 2, s: 8 }, bonus: 3, element: 'physical' },
  resistances: { water: 25 }, spawnRegions: ['cave', 'white_cap', 'frozen_highlands'], groupSize: [1, 2],
  desc: 'It lives in the dark and has never once been afraid.',
});
mon('bat', 'Bat', 1, 6, 5, [1, 2, 0], {
  family: 'beast', size: 45, speed: 340, recoveryTime: 60, xp: 12, gold: 0, flying: true,
  spawnRegions: ['cave', 'crypt', 'mine', 'sewer'], groupSize: [3, 8], aggroRange: 900,
  desc: 'Erratic, harmless, and infuriating to hit.',
});
mon('giant_bat', 'Giant Bat', 6, 40, 12, [1, 6, 1], {
  family: 'beast', size: 90, speed: 360, recoveryTime: 60, xp: 200, gold: 0, flying: true,
  spawnRegions: ['cave', 'crypt', 'mine'], groupSize: [2, 6],
  desc: 'Big enough to knock a man down.',
});
mon('vampire_bat', 'Vampire Bat', 13, 95, 20, [1, 8, 3, 'body'], {
  family: 'beast', size: 100, speed: 380, recoveryTime: 55, xp: 700, gold: 0, flying: true,
  resistances: { body: 40, mind: 20 }, spawnRegions: ['crypt', 'mire_of_the_damned', 'cave'], groupSize: [2, 5],
  inflict: { condition: 'diseased_weak', chance: 12 },
  desc: 'It drinks, and what it leaves behind festers.',
});
mon('dragonfly', 'Giant Dragonfly', 5, 30, 14, [1, 5, 1, 'air'], {
  family: 'insect', size: 80, speed: 400, recoveryTime: 55, xp: 150, gold: 0, flying: true,
  resistances: { air: 30 }, spawnRegions: ['bootleg_bay', 'mire_of_the_damned', 'sweet_water'], groupSize: [2, 5],
  desc: 'Fast, iridescent, and armed with a stinger.',
});

// ---------------------------------------------------------------------------
// Snakes, spiders, insects
// ---------------------------------------------------------------------------

mon('cobra', 'Cobra', 5, 34, 9, [1, 5, 1, 'earth'], {
  family: 'reptile', size: 90, speed: 240, xp: 155, gold: 0,
  resistances: { earth: 50 }, inflict: { condition: 'poisoned_weak', chance: 25 },
  spawnRegions: ['bootleg_bay', 'dragonsand', 'cave'], groupSize: [1, 3],
  desc: 'One bite and the poison does the rest.',
});
mon('serpent', 'Great Serpent', 14, 130, 19, [2, 6, 3, 'earth'], {
  family: 'reptile', size: 160, speed: 250, xp: 800, gold: 30, treasureLevel: 2,
  resistances: { earth: 60, water: 20 }, inflict: { condition: 'poisoned_severe', chance: 20 },
  spawnRegions: ['mire_of_the_damned', 'bootleg_bay', 'cave'], groupSize: [1, 3],
  desc: 'Long as a rowing boat and twice as quick.',
});
mon('giant_spider', 'Giant Spider', 7, 50, 12, [1, 6, 2, 'earth'], {
  family: 'insect', size: 110, speed: 260, xp: 240, gold: 15,
  resistances: { earth: 40 }, inflict: { condition: 'poisoned_weak', chance: 20 },
  ranged: { projectile: 'web', damage: { n: 1, s: 4 }, element: 'earth', range: 1800 },
  spawnRegions: ['cave', 'crypt', 'mire_of_the_damned', 'ruins'], groupSize: [2, 5],
  desc: 'Webs the corridor behind you first.',
});
mon('phase_spider', 'Phase Spider', 20, 180, 28, [2, 8, 4, 'earth'], {
  family: 'insect', size: 130, speed: 300, xp: 1900, gold: 120, treasureLevel: 4,
  resistances: { earth: 70, magic: 40, air: 30 }, inflict: { condition: 'poisoned_deadly', chance: 22 },
  spawnRegions: ['cave', 'kriegspire', 'lair'], groupSize: [1, 4],
  desc: 'It is somewhere else until it is on top of you.',
});
mon('beetle', 'Beetle', 2, 18, 8, [1, 4, 1], {
  family: 'insect', size: 80, speed: 180, recoveryTime: 120, xp: 40, gold: 0,
  resistances: { earth: 20 }, spawnRegions: ['cave', 'mine', 'new_sorpigal'], groupSize: [2, 5],
  desc: 'Armoured and slow. Mostly a nuisance.',
});
mon('fire_beetle', 'Fire Beetle', 8, 65, 15, [1, 8, 2, 'fire'], {
  family: 'insect', size: 95, speed: 200, xp: 300, gold: 0,
  resistances: { fire: 80, earth: 30 }, immunities: ['fire'],
  spawnRegions: ['cave', 'mine', 'kriegspire', 'dragonsand'], groupSize: [2, 4],
  desc: 'Burns from the inside. Fire will not touch it.',
});
mon('giant_beetle', 'Giant Beetle', 15, 175, 26, [2, 8, 3], {
  family: 'insect', size: 140, speed: 190, recoveryTime: 125, xp: 950, gold: 20, treasureLevel: 2,
  resistances: { earth: 50, physical: 20 }, spawnRegions: ['cave', 'mine', 'dragonsand'], groupSize: [1, 4],
  desc: 'A shell like a shield wall.',
});
mon('scorpion', 'Giant Scorpion', 12, 100, 20, [1, 10, 3, 'earth'], {
  family: 'insect', size: 120, speed: 240, xp: 620, gold: 10,
  attack2: { dice: { n: 1, s: 6 }, bonus: 2, element: 'earth' },
  resistances: { earth: 70 }, inflict: { condition: 'poisoned_severe', chance: 25 },
  spawnRegions: ['dragonsand', 'cave', 'ruins'], groupSize: [1, 4],
  desc: 'Two claws and a tail that ends arguments.',
});
mon('giant_ant', 'Giant Ant', 4, 28, 10, [1, 5, 1], {
  family: 'insect', size: 85, speed: 270, xp: 100, gold: 0,
  resistances: { earth: 25 }, spawnRegions: ['cave', 'mine', 'new_sorpigal'], groupSize: [3, 7],
  desc: 'Where there is one there are twenty.',
});
mon('soldier_ant', 'Soldier Ant', 10, 90, 18, [2, 5, 2], {
  family: 'insect', size: 105, speed: 280, xp: 440, gold: 0,
  resistances: { earth: 35 }, spawnRegions: ['cave', 'mine', 'dragonsand'], groupSize: [2, 6],
  desc: 'The colony\'s answer to intruders.',
});

// ---------------------------------------------------------------------------
// Undead
// ---------------------------------------------------------------------------

mon('skeleton', 'Skeleton', 5, 36, 10, [1, 6, 1], {
  family: 'undead', undead: true, size: 180, speed: 190, xp: 150, gold: 12,
  resistances: { mind: 100, body: 100, water: 30 }, immunities: ['mind', 'body'],
  spawnRegions: ['crypt', 'cave', 'ruins', 'mire_of_the_damned'], groupSize: [2, 5],
  desc: 'Bones held together by spite.',
});
mon('skeleton_knight', 'Skeleton Knight', 16, 150, 24, [2, 8, 4], {
  family: 'undead', undead: true, size: 190, speed: 195, xp: 1150, gold: 120, treasureLevel: 4,
  resistances: { mind: 100, body: 100, water: 40, fire: 20 }, immunities: ['mind', 'body'],
  spawnRegions: ['crypt', 'ruins', 'mire_of_the_damned'], groupSize: [1, 4],
  desc: 'It still remembers how to use that sword.',
});
mon('zombie', 'Zombie', 6, 60, 6, [1, 8, 1, 'body'], {
  family: 'undead', undead: true, size: 185, speed: 120, recoveryTime: 140, xp: 190, gold: 8,
  resistances: { mind: 100, body: 100 }, immunities: ['mind', 'body'],
  inflict: { condition: 'diseased_weak', chance: 15 },
  spawnRegions: ['crypt', 'mire_of_the_damned', 'sewer', 'ruins'], groupSize: [2, 6],
  desc: 'Slow, but it does not stop and it does not care.',
});
mon('ghoul', 'Ghoul', 11, 95, 17, [1, 8, 3, 'body'], {
  family: 'undead', undead: true, size: 185, speed: 240, xp: 540, gold: 40,
  attack2: { dice: { n: 1, s: 6 }, bonus: 2, element: 'body' },
  resistances: { mind: 100, body: 100, water: 25 }, immunities: ['mind', 'body'],
  inflict: { condition: 'paralyzed', chance: 12 },
  spawnRegions: ['crypt', 'mire_of_the_damned', 'cave'], groupSize: [2, 4],
  desc: 'Its touch locks the muscles. Then it eats.',
});
mon('mummy', 'Mummy', 18, 175, 24, [2, 8, 4, 'body'], {
  family: 'undead', undead: true, size: 190, speed: 150, recoveryTime: 130, xp: 1550, gold: 200, treasureLevel: 4,
  resistances: { mind: 100, body: 100, water: 40, magic: 30 }, immunities: ['mind', 'body'],
  inflict: { condition: 'diseased_severe', chance: 25 },
  spawnRegions: ['crypt', 'dragonsand', 'ruins'], groupSize: [1, 3],
  desc: 'Bandaged, patient, and carrying a curse.',
});
mon('ghost', 'Ghost', 14, 100, 26, [2, 6, 2, 'magic'], {
  family: 'undead', undead: true, size: 185, speed: 260, xp: 830, gold: 0, flying: true,
  resistances: { mind: 100, body: 100, fire: 40, water: 40, earth: 60, magic: 40, physical: 60 },
  immunities: ['mind', 'body', 'earth'],
  spawnRegions: ['crypt', 'mire_of_the_damned', 'ruins', 'tower'], groupSize: [1, 4],
  desc: 'Steel passes through it. Light does not.',
});
mon('spectre', 'Spectre', 25, 215, 34, [3, 6, 4, 'magic'], {
  family: 'undead', undead: true, size: 190, speed: 280, xp: 3100, gold: 0, flying: true, treasureLevel: 4,
  resistances: { mind: 100, body: 100, fire: 50, water: 50, earth: 80, magic: 60, physical: 70 },
  immunities: ['mind', 'body', 'earth'], inflict: { condition: 'afraid', chance: 25 },
  spawnRegions: ['crypt', 'mire_of_the_damned', 'kriegspire'], groupSize: [1, 3],
  desc: 'A ghost that has had time to grow bitter.',
});
mon('vampire', 'Vampire', 32, 340, 40, [3, 8, 6, 'body'], {
  family: 'undead', undead: true, size: 192, speed: 300, xp: 6800, gold: 1500, treasureLevel: 6,
  attack2: { dice: { n: 2, s: 8 }, bonus: 4, element: 'body' },
  resistances: { mind: 100, body: 100, water: 50, earth: 50, magic: 50 },
  immunities: ['mind', 'body'], inflict: { condition: 'weak', chance: 30 },
  spawnRegions: ['crypt', 'mire_of_the_damned', 'lair'], groupSize: [1, 2],
  desc: 'It drains what it drinks and heals on your blood.',
});
mon('lich', 'Lich', 42, 520, 50, [3, 8, 8, 'dark'], {
  family: 'undead', undead: true, size: 190, speed: 220, xp: 16000, gold: 4000, treasureLevel: 6, caster: true,
  ranged: { spell: 'souldrinker', damage: { n: 14, s: 10 }, element: 'dark', range: 3800 },
  spells: ['souldrinker', 'toxic_cloud', 'paralyze'],
  resistances: { mind: 100, body: 100, fire: 70, air: 70, water: 70, earth: 70, magic: 80 },
  immunities: ['mind', 'body'], spawnRegions: ['crypt', 'tower', 'lair'], groupSize: [1, 1],
  desc: 'It gave up its body centuries ago and has not missed it.',
});

// ---------------------------------------------------------------------------
// Elementals, constructs and spirits
// ---------------------------------------------------------------------------

mon('fire_elemental', 'Fire Elemental', 20, 170, 26, [2, 8, 4, 'fire'], {
  family: 'elemental', size: 220, speed: 250, xp: 1950, gold: 0, treasureLevel: 3,
  ranged: { spell: 'fire_bolt', damage: { n: 5, s: 6 }, element: 'fire', range: 2500 },
  resistances: { fire: 100, water: -30, mind: 100, body: 100, magic: 40 },
  immunities: ['fire', 'mind', 'body'],
  spawnRegions: ['kriegspire', 'dragonsand', 'cave', 'tower'], groupSize: [1, 3],
  desc: 'A column of living flame. Cold hurts it; nothing else does much.',
});
mon('air_elemental', 'Air Elemental', 20, 150, 34, [2, 8, 3, 'air'], {
  family: 'elemental', size: 230, speed: 380, recoveryTime: 70, xp: 1950, gold: 0, flying: true, treasureLevel: 3,
  resistances: { air: 100, earth: -30, mind: 100, body: 100, magic: 40, physical: 40 },
  immunities: ['air', 'mind', 'body'],
  spawnRegions: ['white_cap', 'frozen_highlands', 'tower'], groupSize: [1, 3],
  desc: 'A whirlwind with intent. Hard to hit and harder to catch.',
});
mon('water_elemental', 'Water Elemental', 20, 200, 24, [2, 8, 4, 'water'], {
  family: 'elemental', size: 220, speed: 230, xp: 1950, gold: 0, treasureLevel: 3,
  resistances: { water: 100, air: -30, mind: 100, body: 100, magic: 40 },
  immunities: ['water', 'mind', 'body'],
  spawnRegions: ['eel_infested_waters', 'bootleg_bay', 'sweet_water', 'sewer'], groupSize: [1, 3],
  desc: 'It flows around your guard and drowns you standing up.',
});
mon('earth_elemental', 'Earth Elemental', 21, 260, 30, [3, 6, 5, 'earth'], {
  family: 'elemental', size: 240, speed: 170, recoveryTime: 130, xp: 2200, gold: 0, treasureLevel: 3,
  resistances: { earth: 100, fire: -20, mind: 100, body: 100, magic: 40, physical: 30 },
  immunities: ['earth', 'mind', 'body'],
  spawnRegions: ['mine', 'cave', 'white_cap', 'kriegspire'], groupSize: [1, 3],
  desc: 'Slow as a landslide, and about as survivable.',
});
mon('gargoyle', 'Gargoyle', 13, 120, 22, [2, 6, 3], {
  family: 'construct', size: 175, speed: 260, xp: 700, gold: 60, flying: true, treasureLevel: 2,
  resistances: { mind: 100, body: 100, earth: 50, physical: 25 }, immunities: ['mind', 'body'],
  spawnRegions: ['ruins', 'tower', 'temple', 'crypt'], groupSize: [2, 4],
  desc: 'It was a statue right up until it was not.',
});
mon('stone_gargoyle', 'Stone Gargoyle', 23, 260, 34, [3, 6, 5], {
  family: 'construct', size: 195, speed: 250, xp: 2700, gold: 180, flying: true, treasureLevel: 4,
  resistances: { mind: 100, body: 100, earth: 70, fire: 40, physical: 40 }, immunities: ['mind', 'body'],
  spawnRegions: ['ruins', 'tower', 'kriegspire'], groupSize: [1, 4],
  desc: 'Granite with wings and a grudge.',
});
mon('golem', 'Golem', 27, 380, 32, [3, 8, 6], {
  family: 'construct', size: 260, speed: 160, recoveryTime: 140, xp: 3800, gold: 0, treasureLevel: 4,
  resistances: { mind: 100, body: 100, fire: 50, water: 50, earth: 50, magic: 50, physical: 30 },
  immunities: ['mind', 'body'], spawnRegions: ['tower', 'ruins', 'mine'], groupSize: [1, 2],
  desc: 'Clay and a word. It does not tire and it does not stop.',
});
mon('iron_golem', 'Iron Golem', 38, 620, 46, [4, 8, 8], {
  family: 'construct', size: 290, speed: 170, recoveryTime: 140, xp: 11000, gold: 0, treasureLevel: 5,
  resistances: { mind: 100, body: 100, fire: 70, water: 70, earth: 70, air: 70, magic: 70, physical: 50 },
  immunities: ['mind', 'body'], spawnRegions: ['tower', 'ruins', 'lair'], groupSize: [1, 2],
  desc: 'Iron all the way through. Bring a blaster.',
});
mon('will_o_wisp', "Will-o'-Wisp", 24, 130, 44, [2, 8, 4, 'air'], {
  family: 'elemental', size: 60, speed: 420, recoveryTime: 50, xp: 2600, gold: 0, flying: true, treasureLevel: 4,
  resistances: { air: 100, fire: 60, mind: 100, body: 100, magic: 60, physical: 80 },
  immunities: ['air', 'mind', 'body'],
  spawnRegions: ['mire_of_the_damned', 'bootleg_bay', 'sweet_water'], groupSize: [1, 4],
  desc: 'A light in the marsh that leads you somewhere worse.',
});

// ---------------------------------------------------------------------------
// Giants and brutes
// ---------------------------------------------------------------------------

mon('ogre', 'Ogre', 10, 110, 14, [2, 6, 4], {
  family: 'giant', size: 290, speed: 200, recoveryTime: 120, xp: 460, gold: 90, treasureLevel: 2,
  spawnRegions: ['cave', 'blackshire', 'white_cap', 'ruins'], groupSize: [1, 3],
  desc: 'Enormous, stupid, and carrying a tree.',
});
mon('troll', 'Troll', 21, 280, 26, [2, 10, 5], {
  family: 'giant', size: 310, speed: 220, recoveryTime: 110, xp: 2300, gold: 250, treasureLevel: 4,
  attack2: { dice: { n: 1, s: 10 }, bonus: 4, element: 'physical' },
  resistances: { water: 30, earth: 30, body: 40 }, regen: 6,
  spawnRegions: ['mire_of_the_damned', 'cave', 'blackshire'], groupSize: [1, 3],
  desc: 'It heals as fast as you cut. Fire fixes that.',
});
mon('cyclops', 'Cyclops', 28, 400, 32, [4, 6, 6], {
  family: 'giant', size: 380, speed: 210, recoveryTime: 125, xp: 4300, gold: 600, treasureLevel: 5,
  ranged: { projectile: 'boulder', damage: { n: 4, s: 8 }, element: 'physical', range: 3000 },
  resistances: { earth: 40, mind: 30 }, spawnRegions: ['kriegspire', 'cave', 'white_cap'], groupSize: [1, 2],
  desc: 'One eye, no manners, and a very good throwing arm.',
});
mon('minotaur', 'Minotaur', 26, 330, 34, [3, 8, 6], {
  family: 'giant', size: 300, speed: 280, xp: 3500, gold: 400, treasureLevel: 5,
  attack2: { dice: { n: 2, s: 6 }, bonus: 4, element: 'physical' },
  resistances: { earth: 30, mind: 40 }, spawnRegions: ['lair', 'cave', 'ruins'], groupSize: [1, 3],
  desc: 'It charges, and the charge is the problem.',
});
mon('giant', 'Hill Giant', 33, 480, 36, [4, 8, 7], {
  family: 'giant', size: 450, speed: 220, recoveryTime: 130, xp: 7200, gold: 900, treasureLevel: 5,
  ranged: { projectile: 'boulder', damage: { n: 5, s: 8 }, element: 'physical', range: 3200 },
  resistances: { earth: 40, physical: 20 }, spawnRegions: ['kriegspire', 'white_cap', 'frozen_highlands'], groupSize: [1, 2],
  desc: 'Tall as a house and it throws parts of the house.',
});
mon('titan', 'Titan', 50, 900, 58, [5, 10, 10, 'air'], {
  family: 'giant', size: 520, speed: 260, recoveryTime: 110, xp: 32000, gold: 6000, treasureLevel: 6,
  ranged: { spell: 'lightning_bolt', damage: { n: 12, s: 10 }, element: 'air', range: 4000 },
  attack2: { dice: { n: 4, s: 8 }, bonus: 8, element: 'air' },
  resistances: { fire: 60, air: 90, water: 60, earth: 60, mind: 70, body: 70, magic: 70 },
  spawnRegions: ['lair', 'kriegspire'], groupSize: [1, 2],
  desc: 'Lightning walks with it. Almost nothing survives the first exchange.',
});

// ---------------------------------------------------------------------------
// Dragons and other flyers
// ---------------------------------------------------------------------------

mon('harpy', 'Harpy', 9, 70, 18, [1, 8, 2], {
  family: 'avian', size: 170, speed: 320, recoveryTime: 75, xp: 390, gold: 40, flying: true,
  resistances: { air: 30, mind: 20 }, inflict: { condition: 'afraid', chance: 15 },
  spawnRegions: ['bootleg_bay', 'blackshire', 'cave', 'ruins'], groupSize: [2, 5],
  desc: 'It screams, and the scream is half the fight.',
});
mon('griffin', 'Griffin', 24, 250, 32, [3, 6, 5], {
  family: 'avian', size: 290, speed: 360, recoveryTime: 80, xp: 2800, gold: 300, flying: true, treasureLevel: 4,
  attack2: { dice: { n: 2, s: 6 }, bonus: 4, element: 'physical' },
  resistances: { air: 50, mind: 30 }, spawnRegions: ['white_cap', 'paradise_valley', 'kriegspire'], groupSize: [1, 3],
  desc: 'Eagle in front, lion behind, trouble throughout.',
});
mon('roc', 'Roc', 34, 460, 40, [4, 8, 7], {
  family: 'avian', size: 480, speed: 380, recoveryTime: 85, xp: 8000, gold: 800, flying: true, treasureLevel: 5,
  resistances: { air: 60, mind: 30, physical: 20 },
  spawnRegions: ['white_cap', 'dragonsand', 'kriegspire'], groupSize: [1, 2],
  desc: 'It could carry off a horse, and has.',
});
mon('wyvern', 'Wyvern', 29, 360, 36, [3, 8, 6, 'earth'], {
  family: 'dragon', size: 340, speed: 340, recoveryTime: 90, xp: 4700, gold: 500, flying: true, treasureLevel: 5,
  attack2: { dice: { n: 2, s: 8 }, bonus: 5, element: 'earth' },
  resistances: { earth: 70, fire: 30, mind: 40 }, inflict: { condition: 'poisoned_severe', chance: 25 },
  spawnRegions: ['dragonsand', 'kriegspire', 'lair'], groupSize: [1, 2],
  desc: 'A dragon\'s poor cousin, with a poisoned tail.',
});
mon('hydra', 'Hydra', 31, 520, 34, [3, 8, 5, 'earth'], {
  family: 'reptile', size: 360, speed: 200, recoveryTime: 90, xp: 6000, gold: 700, treasureLevel: 5,
  attack2: { dice: { n: 3, s: 8 }, bonus: 5, element: 'earth' },
  ranged: { projectile: 'venom', damage: { n: 6, s: 8 }, element: 'earth', range: 2500 },
  resistances: { earth: 80, water: 50, fire: 20, mind: 50 }, regen: 10,
  spawnRegions: ['mire_of_the_damned', 'eel_infested_waters', 'lair'], groupSize: [1, 1],
  desc: 'Every head bites and every head grows back.',
});
mon('dragon_green', 'Green Dragon', 40, 700, 48, [4, 10, 8, 'earth'], {
  family: 'dragon', size: 620, speed: 300, recoveryTime: 100, xp: 14000, gold: 3500, treasureLevel: 6, flying: true,
  attack2: { dice: { n: 3, s: 10 }, bonus: 6, element: 'physical' },
  ranged: { spell: 'toxic_cloud', damage: { n: 12, s: 10 }, element: 'earth', range: 3500 },
  resistances: { earth: 90, fire: 40, water: 40, air: 40, mind: 60, body: 60, magic: 50 },
  spawnRegions: ['lair', 'mire_of_the_damned', 'dragonsand'], groupSize: [1, 1],
  desc: 'Its breath rots armour off a man.',
});
mon('dragon_red', 'Red Dragon', 48, 850, 54, [5, 10, 9, 'fire'], {
  family: 'dragon', size: 660, speed: 310, recoveryTime: 100, xp: 26000, gold: 6000, treasureLevel: 6, flying: true,
  attack2: { dice: { n: 4, s: 10 }, bonus: 7, element: 'physical' },
  ranged: { spell: 'dragon_breath', damage: { n: 16, s: 10 }, element: 'fire', range: 4000 },
  resistances: { fire: 100, earth: 50, water: 40, air: 50, mind: 70, body: 70, magic: 60 },
  immunities: ['fire'], spawnRegions: ['lair', 'kriegspire', 'dragonsand'], groupSize: [1, 1],
  desc: 'The one on the box art. It is exactly as bad as it looks.',
});
mon('dragon_black', 'Black Dragon', 58, 1100, 62, [6, 10, 12, 'dark'], {
  family: 'dragon', size: 700, speed: 320, recoveryTime: 95, xp: 55000, gold: 12000, treasureLevel: 6, flying: true,
  attack2: { dice: { n: 5, s: 10 }, bonus: 10, element: 'dark' },
  ranged: { spell: 'dragon_breath', damage: { n: 22, s: 10 }, element: 'dark', range: 4200 },
  resistances: { fire: 90, earth: 70, water: 70, air: 70, mind: 90, body: 90, magic: 85 },
  spawnRegions: ['lair'], groupSize: [1, 1],
  desc: 'Older than the kingdom. It has eaten better parties than yours.',
});

// ---------------------------------------------------------------------------
// Swamp, sea and the strange
// ---------------------------------------------------------------------------

mon('lizardman', 'Lizardman', 8, 70, 14, [1, 8, 2], {
  family: 'reptile', size: 195, speed: 230, xp: 310, gold: 55, treasureLevel: 2,
  ranged: { projectile: 'javelin', damage: { n: 1, s: 8 }, element: 'physical', range: 2200 },
  resistances: { water: 30, earth: 20 }, spawnRegions: ['bootleg_bay', 'mire_of_the_damned', 'eel_infested_waters'], groupSize: [2, 5],
  desc: 'Tribal, territorial, and better organised than it looks.',
});
mon('naga', 'Naga', 22, 220, 28, [2, 10, 4, 'earth'], {
  family: 'reptile', size: 260, speed: 240, xp: 2350, gold: 400, treasureLevel: 4, caster: true,
  ranged: { spell: 'acid_burst', damage: { n: 7, s: 8 }, element: 'earth', range: 2800 },
  resistances: { earth: 70, water: 50, mind: 40, magic: 30 },
  inflict: { condition: 'poisoned_severe', chance: 20 },
  spawnRegions: ['eel_infested_waters', 'mire_of_the_damned', 'temple'], groupSize: [1, 3],
  desc: 'Serpent below, sorcerer above.',
});
mon('medusa', 'Medusa', 30, 300, 36, [2, 10, 5], {
  family: 'reptile', size: 240, speed: 250, xp: 5400, gold: 900, treasureLevel: 5,
  ranged: { spell: 'stone_gaze', damage: { n: 6, s: 8 }, element: 'earth', range: 2500 },
  resistances: { earth: 60, mind: 70, magic: 40 }, inflict: { condition: 'stoned', chance: 8 },
  spawnRegions: ['ruins', 'temple', 'lair'], groupSize: [1, 2],
  desc: 'Do not look at it. It is very hard not to look at it.',
});
mon('swamp_thing', 'Swamp Thing', 19, 210, 22, [2, 10, 4, 'earth'], {
  family: 'plant', size: 260, speed: 160, recoveryTime: 130, xp: 1750, gold: 30, treasureLevel: 3,
  resistances: { earth: 70, water: 60, mind: 100, fire: -40 }, immunities: ['mind'],
  inflict: { condition: 'diseased_weak', chance: 20 },
  spawnRegions: ['mire_of_the_damned', 'bootleg_bay', 'sweet_water'], groupSize: [1, 3],
  desc: 'Half the marsh stood up. Fire is the answer.',
});
mon('slime', 'Slime', 4, 40, 4, [1, 6, 1, 'earth'], {
  family: 'ooze', size: 90, speed: 110, recoveryTime: 150, xp: 90, gold: 0,
  resistances: { earth: 60, water: 40, mind: 100, body: 100, physical: 30 }, immunities: ['mind', 'body'],
  spawnRegions: ['sewer', 'cave', 'crypt'], groupSize: [2, 4],
  desc: 'It eats the floor and would like to eat your boots.',
});
mon('ooze', 'Great Ooze', 15, 220, 8, [2, 8, 2, 'earth'], {
  family: 'ooze', size: 150, speed: 110, recoveryTime: 150, xp: 900, gold: 20, treasureLevel: 2,
  resistances: { earth: 80, water: 60, fire: 30, mind: 100, body: 100, physical: 50 },
  immunities: ['mind', 'body'], inflict: { condition: 'poisoned_weak', chance: 20 },
  spawnRegions: ['sewer', 'cave', 'mire_of_the_damned'], groupSize: [1, 3],
  desc: 'Enormous, acidic, and it splits when you cut it.',
});

// ---------------------------------------------------------------------------
// Devils - the endgame of MM6
// ---------------------------------------------------------------------------

mon('imp', 'Imp', 12, 85, 22, [1, 8, 3, 'fire'], {
  family: 'demon', size: 110, speed: 340, recoveryTime: 70, xp: 640, gold: 80, flying: true, treasureLevel: 3,
  ranged: { spell: 'fire_bolt', damage: { n: 4, s: 6 }, element: 'fire', range: 2500 },
  resistances: { fire: 70, mind: 40, magic: 30 },
  spawnRegions: ['temple', 'kriegspire', 'ruins', 'lair'], groupSize: [2, 5],
  desc: 'Small, fast, on fire, and laughing.',
});
mon('demon', 'Demon', 35, 450, 44, [4, 8, 8, 'fire'], {
  family: 'demon', size: 300, speed: 300, xp: 9500, gold: 2000, treasureLevel: 6,
  attack2: { dice: { n: 3, s: 8 }, bonus: 6, element: 'fire' },
  ranged: { spell: 'fireball', damage: { n: 12, s: 8 }, element: 'fire', range: 3200 },
  resistances: { fire: 90, air: 40, water: 30, earth: 40, mind: 70, body: 70, magic: 60 },
  spawnRegions: ['temple', 'kriegspire', 'lair'], groupSize: [1, 3],
  desc: 'The Kreegan foot soldier. It came a long way to be here.',
});
mon('devil', 'Devil', 45, 720, 54, [5, 10, 10, 'fire'], {
  family: 'demon', size: 330, speed: 320, xp: 21000, gold: 5000, treasureLevel: 6, caster: true,
  attack2: { dice: { n: 4, s: 10 }, bonus: 8, element: 'fire' },
  ranged: { spell: 'incinerate', damage: { n: 18, s: 10 }, element: 'fire', range: 3800 },
  spells: ['incinerate', 'paralyze', 'toxic_cloud'],
  resistances: { fire: 100, air: 60, water: 50, earth: 60, mind: 85, body: 85, magic: 80 },
  immunities: ['fire'], spawnRegions: ['temple', 'lair'], groupSize: [1, 2],
  desc: 'A Kreegan lord. This is what the whole war was about.',
});

// ---------------------------------------------------------------------------
// Index and queries
// ---------------------------------------------------------------------------

export const MONSTERS = M;
const BY_ID = new Map(M.map((m) => [m.id, m]));

export function monsterById(id) { return BY_ID.get(id) || null; }
export const MONSTER_IDS = M.map((m) => m.id);

/** Every monster of a family. */
export function monstersOfFamily(family) { return M.filter((m) => m.family === family); }

/** Every monster whose level falls in [lo, hi]. */
export function monstersInLevelRange(lo, hi) {
  return M.filter((m) => m.level >= lo && m.level <= hi);
}

/**
 * A weighted spawn table for a region at a given difficulty.
 * `difficulty` is roughly the party's level; the window widens as it grows so
 * high-level areas stay varied.
 */
export function spawnTableFor(regionId, difficulty) {
  const d = Math.max(1, difficulty || 1);
  const lo = Math.max(1, Math.floor(d * 0.55) - 1);
  const hi = Math.ceil(d * 1.45) + 2;

  let pool = M.filter((m) => m.spawnRegions.indexOf(regionId) >= 0);
  if (!pool.length) pool = M.filter((m) => m.spawnRegions.indexOf('cave') >= 0);

  const inBand = pool.filter((m) => m.level >= lo && m.level <= hi);
  const chosen = inBand.length ? inBand : pool.slice().sort(
    (a, b) => Math.abs(a.level - d) - Math.abs(b.level - d)).slice(0, 4);

  return chosen.map((m) => {
    // Monsters at the middle of the band are the commonest; the edges are rare.
    const dist = Math.abs(m.level - d) / Math.max(1, hi - lo);
    const w = Math.max(1, Math.round(100 * (1 - Math.min(0.9, dist))));
    return { id: m.id, w, level: m.level, groupSize: m.groupSize };
  });
}

/** Roll one spawn group: an id and how many of them. */
export function rollSpawn(rand, regionId, difficulty) {
  const table = spawnTableFor(regionId, difficulty);
  if (!table.length) return null;
  const pick = rand.weighted(table);
  const [lo, hi] = pick.groupSize;
  return { id: pick.id, count: rand.int(lo, hi) };
}

/** Instantiate a live monster from its template. */
let MUID = 1;
export function spawnMonster(id, opts) {
  const def = BY_ID.get(id);
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
    hostile: o.hostile !== undefined ? o.hostile : true,
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
  for (const m of monsters) t += (m.def ? m.def.xp : (BY_ID.get(m.id) || { xp: 0 }).xp);
  return t;
}

/** Sanity check for the test harness: every id present, levels sane. */
export function validateMonsters(requiredIds) {
  const problems = [];
  const have = new Set(MONSTER_IDS);
  if (requiredIds) {
    for (const id of requiredIds) if (!have.has(id)) problems.push(`missing monster "${id}"`);
    for (const id of MONSTER_IDS) if (requiredIds.indexOf(id) < 0) problems.push(`extra monster "${id}"`);
  }
  for (const m of M) {
    if (m.level < 1 || m.level > 60) problems.push(`${m.id}: level ${m.level} out of range`);
    if (m.hp < 1) problems.push(`${m.id}: no hit points`);
    if (!FAMILIES.includes(m.family)) problems.push(`${m.id}: unknown family ${m.family}`);
    if (m.size < 20 || m.size > 900) problems.push(`${m.id}: implausible size ${m.size}`);
    for (const r of m.spawnRegions) if (!REGIONS.includes(r)) problems.push(`${m.id}: unknown region ${r}`);
  }
  const levels = M.map((m) => m.level);
  if (Math.min(...levels) > 1) problems.push('no level-1 monsters');
  if (Math.max(...levels) < 55) problems.push('no endgame monsters');
  return problems;
}
