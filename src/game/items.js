// Weapons, armour, enchantments, artifacts, potions and the loot generator.
//
// Item *definitions* are static templates. An item *instance* is a plain object
// created by `makeItem` / `generateItem`:
//
//   { uid, def, type, name, bonus, prefix, suffix, charges, identified,
//     broken, quantity, gw, gh }
//
// `def` is the template id, never the object, so instances serialise cleanly.

import { Rand } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Slots and types
// ---------------------------------------------------------------------------

export const SLOTS = [
  'mainhand', 'offhand', 'bow', 'armor', 'helm', 'boots',
  'gauntlets', 'belt', 'cloak', 'amulet', 'ring1', 'ring2',
];

export const SLOT_NAMES = {
  mainhand: 'Weapon', offhand: 'Off hand', bow: 'Missile', armor: 'Armour',
  helm: 'Helm', boots: 'Boots', gauntlets: 'Gauntlets', belt: 'Belt',
  cloak: 'Cloak', amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring',
};

export const ITEM_TYPES = [
  'weapon', 'bow', 'shield', 'armor', 'helm', 'boots', 'gauntlets', 'belt',
  'cloak', 'amulet', 'ring', 'potion', 'scroll', 'wand', 'spellbook',
  'reagent', 'gem', 'gold', 'food', 'quest', 'misc',
];

/** Which equipment slot a type goes in (null = not equippable). */
export const TYPE_SLOT = {
  weapon: 'mainhand', bow: 'bow', shield: 'offhand', armor: 'armor',
  helm: 'helm', boots: 'boots', gauntlets: 'gauntlets', belt: 'belt',
  cloak: 'cloak', amulet: 'amulet', ring: 'ring1',
};

/** MM6's paper-doll inventory is 14 columns by 9 rows of squares. */
export const INV_W = 14;
export const INV_H = 9;

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
//
// `recovery` is MM6 ticks added to the wielder's recovery time; lower is
// faster. `tier` drives where in the world the item shows up (1 = starting
// gear, 6 = endgame). `gw/gh` are inventory grid footprint.

const W = [];
function weapon(id, name, skill, n, s, plus, recovery, value, tier, opts) {
  const o = opts || {};
  const def = {
    id, name, type: o.type || 'weapon', slot: o.slot || 'mainhand', skill,
    dice: { n, s, plus: plus || 0 },
    recovery, value, tier,
    twoHanded: !!o.twoHanded,
    gw: o.gw || 1, gh: o.gh || 3,
    element: o.element || null,
    range: o.range || 0,
    desc: o.desc || '',
  };
  W.push(def);
  return def;
}

// -- Daggers: fast and feeble, but a master triples his damage.
weapon('dagger', 'Dagger', 'dagger', 2, 2, 0, 55, 25, 1, { gh: 2 });
weapon('dirk', 'Dirk', 'dagger', 2, 3, 0, 55, 60, 2, { gh: 2 });
weapon('kris', 'Kris', 'dagger', 2, 4, 0, 60, 140, 3, { gh: 2 });
weapon('stiletto', 'Stiletto', 'dagger', 3, 3, 1, 50, 300, 4, { gh: 2 });
weapon('assassin_blade', "Assassin's Blade", 'dagger', 3, 4, 2, 50, 700, 5, { gh: 2 });

// -- Swords: the best all-round melee weapons.
weapon('shortsword', 'Short Sword', 'sword', 1, 6, 0, 70, 50, 1);
weapon('longsword', 'Long Sword', 'sword', 1, 8, 0, 80, 120, 2);
weapon('broadsword', 'Broad Sword', 'sword', 1, 10, 0, 90, 250, 3);
weapon('cutlass', 'Cutlass', 'sword', 1, 8, 2, 75, 300, 3);
weapon('scimitar', 'Scimitar', 'sword', 1, 10, 1, 80, 450, 4);
weapon('sabre', 'Sabre', 'sword', 1, 9, 2, 75, 500, 4);
weapon('katana', 'Katana', 'sword', 1, 10, 3, 80, 900, 5);
weapon('ninjato', 'Ninjato', 'sword', 1, 8, 5, 65, 1100, 5);
weapon('two_handed_sword', 'Two-Handed Sword', 'sword', 2, 8, 2, 110, 800, 5, { twoHanded: true, gw: 2, gh: 4 });
weapon('bastard_sword', 'Bastard Sword', 'sword', 1, 12, 3, 95, 1600, 6, { gh: 4 });

// -- Axes: slow, heavy, armour-splitting.
weapon('hand_axe', 'Hand Axe', 'axe', 1, 6, 1, 75, 45, 1, { gh: 2 });
weapon('axe', 'Axe', 'axe', 1, 8, 1, 90, 130, 2);
weapon('battle_axe', 'Battle Axe', 'axe', 1, 10, 2, 105, 350, 3, { twoHanded: true, gw: 2, gh: 4 });
weapon('war_axe', 'War Axe', 'axe', 1, 12, 2, 110, 700, 4, { twoHanded: true, gw: 2, gh: 4 });
weapon('great_axe', 'Great Axe', 'axe', 2, 8, 3, 120, 1400, 5, { twoHanded: true, gw: 2, gh: 4 });

// -- Spears: reach, and a shield in the other hand once you are Expert.
weapon('spear', 'Spear', 'spear', 1, 8, 0, 85, 90, 1, { gh: 4 });
weapon('trident', 'Trident', 'spear', 1, 10, 1, 90, 300, 3, { gh: 4 });
weapon('halberd', 'Halberd', 'spear', 1, 12, 1, 100, 600, 4, { twoHanded: true, gw: 2, gh: 4 });
weapon('glaive', 'Glaive', 'spear', 2, 6, 2, 95, 850, 4, { twoHanded: true, gw: 2, gh: 4 });
weapon('naginata', 'Naginata', 'spear', 2, 8, 2, 95, 1500, 6, { twoHanded: true, gw: 2, gh: 4 });

// -- Maces: blunt, and a master can paralyse with them.
weapon('club', 'Club', 'mace', 1, 5, 0, 70, 10, 1, { gh: 2 });
weapon('mace', 'Mace', 'mace', 1, 6, 1, 80, 100, 2);
weapon('hammer', 'Hammer', 'mace', 1, 8, 2, 95, 280, 3);
weapon('flail', 'Flail', 'mace', 1, 10, 1, 100, 550, 4);
weapon('morning_star', 'Morning Star', 'mace', 1, 12, 2, 105, 1000, 5, { gh: 4 });

// -- Staves: two-handed, cheap, and the only real weapon a sorcerer has.
weapon('staff', 'Staff', 'staff', 1, 6, 0, 70, 20, 1, { twoHanded: true, gh: 4 });
weapon('quarterstaff', 'Quarterstaff', 'staff', 1, 8, 0, 75, 90, 2, { twoHanded: true, gh: 4 });
weapon('war_staff', 'War Staff', 'staff', 1, 10, 1, 80, 300, 3, { twoHanded: true, gh: 4 });
weapon('wizard_staff', 'Wizard Staff', 'staff', 1, 10, 3, 75, 900, 5, { twoHanded: true, gh: 4 });

// -- Bows go in their own slot and never take the Might bonus.
weapon('short_bow', 'Short Bow', 'bow', 1, 5, 0, 80, 60, 1, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 4000 });
weapon('bow', 'Bow', 'bow', 1, 6, 0, 85, 150, 2, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 4500 });
weapon('longbow', 'Long Bow', 'bow', 1, 8, 0, 95, 400, 3, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 5000 });
weapon('crossbow', 'Crossbow', 'bow', 1, 10, 1, 110, 700, 4, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 5000 });
weapon('elven_bow', 'Elven Bow', 'bow', 1, 8, 4, 70, 1800, 5, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 5500 });
weapon('composite_bow', 'Composite Bow', 'bow', 2, 6, 2, 90, 2400, 6, { type: 'bow', slot: 'bow', twoHanded: true, gw: 2, gh: 4, range: 5500 });

// -- Blasters: relics of the Ancients. Nothing in Enroth resists them.
weapon('blaster', 'Blaster', 'blaster', 3, 5, 5, 40, 8000, 6, { element: 'magic', range: 4000, desc: 'A weapon of the Ancients. Ignores all resistance.' });
weapon('blaster_rifle', 'Blaster Rifle', 'blaster', 4, 6, 8, 45, 20000, 6, { element: 'magic', twoHanded: true, gw: 2, gh: 4, range: 5000, desc: 'The heavy version. Ignores all resistance.' });

export const WEAPONS = W;

// ---------------------------------------------------------------------------
// Armour and the other worn slots
// ---------------------------------------------------------------------------

const A = [];
function armor(id, name, type, skill, ac, recovery, value, tier, opts) {
  const o = opts || {};
  const def = {
    id, name, type, slot: o.slot || TYPE_SLOT[type], skill: skill || null,
    ac, recovery, value, tier,
    gw: o.gw || 2, gh: o.gh || 2,
    desc: o.desc || '',
    mods: o.mods || null,
  };
  A.push(def);
  return def;
}

// Body armour. `recovery` is the penalty an unskilled wearer suffers.
armor('leather_armor', 'Leather Armour', 'armor', 'leather', 4, 0, 60, 1, { gw: 2, gh: 3 });
armor('studded_leather', 'Studded Leather', 'armor', 'leather', 6, 0, 180, 2, { gw: 2, gh: 3 });
armor('scale_armor', 'Scale Armour', 'armor', 'leather', 8, 5, 400, 3, { gw: 2, gh: 3 });
armor('ring_mail', 'Ring Mail', 'armor', 'chain', 8, 15, 350, 2, { gw: 2, gh: 3 });
armor('chain_mail', 'Chain Mail', 'armor', 'chain', 11, 20, 700, 3, { gw: 2, gh: 3 });
armor('splint_mail', 'Splint Mail', 'armor', 'chain', 13, 25, 1200, 4, { gw: 2, gh: 3 });
armor('banded_mail', 'Banded Mail', 'armor', 'chain', 15, 25, 1800, 5, { gw: 2, gh: 3 });
armor('plate_armor', 'Plate Armour', 'armor', 'plate', 17, 40, 2500, 4, { gw: 2, gh: 3 });
armor('field_plate', 'Field Plate', 'armor', 'plate', 20, 40, 4000, 5, { gw: 2, gh: 3 });
armor('gothic_plate', 'Gothic Plate', 'armor', 'plate', 23, 45, 7000, 6, { gw: 2, gh: 3 });
armor('full_plate', 'Full Plate', 'armor', 'plate', 26, 50, 12000, 6, { gw: 2, gh: 3 });

// Shields.
armor('buckler', 'Buckler', 'shield', 'shield', 3, 5, 50, 1, { gw: 2, gh: 2 });
armor('wooden_shield', 'Wooden Shield', 'shield', 'shield', 5, 10, 150, 2, { gw: 2, gh: 2 });
armor('kite_shield', 'Kite Shield', 'shield', 'shield', 8, 15, 450, 3, { gw: 2, gh: 3 });
armor('tower_shield', 'Tower Shield', 'shield', 'shield', 11, 25, 1200, 4, { gw: 2, gh: 3 });
armor('gothic_shield', 'Gothic Shield', 'shield', 'shield', 14, 30, 3000, 6, { gw: 2, gh: 3 });

// Helms.
armor('leather_helm', 'Leather Helm', 'helm', null, 2, 0, 30, 1);
armor('coif', 'Coif', 'helm', null, 3, 0, 90, 2);
armor('helm', 'Helm', 'helm', null, 4, 5, 220, 3);
armor('great_helm', 'Great Helm', 'helm', null, 6, 10, 600, 4);
armor('crown', 'Crown', 'helm', null, 3, 0, 1500, 5, { desc: 'More ornament than protection, but often enchanted.' });

// Boots, gauntlets, belts, cloaks.
armor('leather_boots', 'Leather Boots', 'boots', null, 2, 0, 25, 1);
armor('boots', 'Boots', 'boots', null, 3, 0, 80, 2);
armor('plate_boots', 'Plate Boots', 'boots', null, 5, 10, 350, 4);
armor('leather_gauntlets', 'Leather Gauntlets', 'gauntlets', null, 1, 0, 25, 1, { gw: 1, gh: 2 });
armor('gauntlets', 'Gauntlets', 'gauntlets', null, 2, 0, 90, 2, { gw: 1, gh: 2 });
armor('plate_gauntlets', 'Plate Gauntlets', 'gauntlets', null, 4, 5, 400, 4, { gw: 1, gh: 2 });
armor('leather_belt', 'Leather Belt', 'belt', null, 1, 0, 20, 1, { gw: 2, gh: 1 });
armor('belt', 'Belt', 'belt', null, 2, 0, 70, 2, { gw: 2, gh: 1 });
armor('plate_belt', 'Plate Belt', 'belt', null, 3, 0, 300, 4, { gw: 2, gh: 1 });
armor('cloak', 'Cloak', 'cloak', null, 1, 0, 40, 1, { gw: 2, gh: 2 });
armor('fur_cloak', 'Fur Cloak', 'cloak', null, 2, 0, 150, 2, { gw: 2, gh: 2 });
armor('velvet_cloak', 'Velvet Cloak', 'cloak', null, 3, 0, 600, 4, { gw: 2, gh: 2 });

// Jewellery carries no armour class of its own; it is a frame for enchantments.
armor('amulet', 'Amulet', 'amulet', null, 0, 0, 200, 2, { gw: 1, gh: 1 });
armor('pendant', 'Pendant', 'amulet', null, 0, 0, 500, 3, { gw: 1, gh: 1 });
armor('necklace', 'Necklace', 'amulet', null, 0, 0, 1200, 5, { gw: 1, gh: 1 });
armor('ring', 'Ring', 'ring', null, 0, 0, 150, 2, { gw: 1, gh: 1 });
armor('signet_ring', 'Signet Ring', 'ring', null, 0, 0, 450, 3, { gw: 1, gh: 1 });
armor('gold_ring', 'Gold Ring', 'ring', null, 0, 0, 1000, 5, { gw: 1, gh: 1 });

export const ARMORS = A;

// ---------------------------------------------------------------------------
// Definition index
// ---------------------------------------------------------------------------

const DEFS = new Map();
for (const d of W) DEFS.set(d.id, d);
for (const d of A) DEFS.set(d.id, d);

export function itemDef(id) { return DEFS.get(id) || null; }

// ---------------------------------------------------------------------------
// Enchantments
// ---------------------------------------------------------------------------
//
// `kind`: 'prefix' goes before the noun ("Flaming Long Sword"), 'suffix' after
// it ("Long Sword of Fire"). `tier` 1-6 sets rarity and the minimum monster /
// chest level that may produce it. `on` lists the item types it may appear on.
//
// mods keys: stat names, ac, attack, damage, hp, sp, resist{...}, recovery,
// plus flags read by combat.js: elemental, vampiric, drainSP, doubleDamageVs.

const E = [];
function ench(id, name, kind, tier, on, mods, opts) {
  const o = opts || {};
  const def = {
    id, name, kind, tier,
    minLevel: o.minLevel !== undefined ? o.minLevel : [0, 1, 6, 12, 20, 30, 40][tier] || 1,
    on, mods, value: o.value !== undefined ? o.value : tier * tier * 250,
    desc: o.desc || '',
  };
  E.push(def);
  return def;
}

const MELEE = ['weapon'];
const ANY_WEAPON = ['weapon', 'bow'];
const WORN = ['armor', 'helm', 'boots', 'gauntlets', 'belt', 'cloak', 'shield'];
const JEWEL = ['amulet', 'ring'];
const ANY = ['weapon', 'bow', 'armor', 'helm', 'boots', 'gauntlets', 'belt', 'cloak', 'shield', 'amulet', 'ring'];

// -- Elemental weapon suffixes: the bread and butter of MM6 loot.
ench('of_fire', 'of Fire', 'suffix', 2, ANY_WEAPON, { elemental: { element: 'fire', dice: { n: 1, s: 6 } } }, { desc: 'Adds 1d6 fire damage.' });
ench('of_air', 'of Air', 'suffix', 2, ANY_WEAPON, { elemental: { element: 'air', dice: { n: 1, s: 6 } } }, { desc: 'Adds 1d6 electrical damage.' });
ench('of_water', 'of Water', 'suffix', 2, ANY_WEAPON, { elemental: { element: 'water', dice: { n: 1, s: 6 } } }, { desc: 'Adds 1d6 cold damage.' });
ench('of_earth', 'of Earth', 'suffix', 2, ANY_WEAPON, { elemental: { element: 'earth', dice: { n: 1, s: 6 } } }, { desc: 'Adds 1d6 poison damage.' });
ench('of_the_sky', 'of the Sky', 'suffix', 4, ANY_WEAPON, { elemental: { element: 'air', dice: { n: 3, s: 6 } } }, { desc: 'Adds 3d6 electrical damage.' });
ench('of_infernos', 'of Infernos', 'suffix', 4, ANY_WEAPON, { elemental: { element: 'fire', dice: { n: 3, s: 6 } } }, { desc: 'Adds 3d6 fire damage.' });
ench('of_ice', 'of Ice', 'suffix', 4, ANY_WEAPON, { elemental: { element: 'water', dice: { n: 3, s: 6 } } }, { desc: 'Adds 3d6 cold damage.' });
ench('of_venom', 'of Venom', 'suffix', 4, ANY_WEAPON, { elemental: { element: 'earth', dice: { n: 3, s: 6 } } }, { desc: 'Adds 3d6 poison damage.' });

// -- Weapon suffixes with a special rule.
ench('of_carnage', 'of Carnage', 'suffix', 5, MELEE, { explodes: true }, { desc: 'Every hit explodes like a Fireball.' });
ench('of_darkness', 'of Darkness', 'suffix', 5, ANY_WEAPON, { drainSP: 5, elemental: { element: 'dark', dice: { n: 2, s: 6 } } }, { desc: 'Adds dark damage and drains the target\'s spell points.' });
ench('of_doom', 'of Doom', 'suffix', 6, ANY_WEAPON, { might: 10, intellect: 10, personality: 10, endurance: 10, accuracy: 10, speed: 10, luck: 10 }, { desc: '+10 to every statistic.' });
ench('of_force', 'of Force', 'suffix', 4, MELEE, { knockback: 400, damage: 5 }, { desc: 'Sends the target flying.' });
ench('vampiric', 'Vampiric', 'prefix', 5, MELEE, { vampiric: 0.4 }, { desc: 'Heals the wielder for part of the damage dealt.' });
ench('of_alchemy', 'of Alchemy', 'suffix', 3, ANY, { sp: 10 }, { desc: '+10 spell points.' });
ench('of_the_dragon', 'of the Dragon', 'suffix', 6, ANY, { might: 15, endurance: 15, resist: { fire: 30 } }, { desc: '+15 Might and Endurance, +30 Fire resistance.' });
ench('of_the_eclipse', 'of the Eclipse', 'suffix', 6, ANY, { sp: 30, resist: { magic: 20 } }, { desc: '+30 spell points and +20 Magic resistance.' });
ench('of_the_gods', 'of the Gods', 'suffix', 6, ANY, { resist: { fire: 20, air: 20, water: 20, earth: 20, mind: 20, body: 20, magic: 20 } }, { desc: '+20 to every resistance.' });

// -- Stat suffixes.
ench('of_might', 'of Might', 'suffix', 2, ANY, { might: 10 }, { desc: '+10 Might.' });
ench('of_thought', 'of Thought', 'suffix', 2, ANY, { intellect: 10 }, { desc: '+10 Intellect.' });
ench('of_charm', 'of Charm', 'suffix', 2, ANY, { personality: 10 }, { desc: '+10 Personality.' });
ench('of_endurance', 'of Endurance', 'suffix', 2, ANY, { endurance: 10 }, { desc: '+10 Endurance.' });
ench('of_precision', 'of Precision', 'suffix', 2, ANY, { accuracy: 10 }, { desc: '+10 Accuracy.' });
ench('of_speed', 'of Speed', 'suffix', 2, ANY, { speed: 10 }, { desc: '+10 Speed.' });
ench('of_luck', 'of Luck', 'suffix', 2, ANY, { luck: 10 }, { desc: '+10 Luck.' });
ench('of_health', 'of Health', 'suffix', 2, ANY, { hp: 15 }, { desc: '+15 hit points.' });
ench('of_the_stars', 'of the Stars', 'suffix', 5, ANY, { might: 15, intellect: 15, personality: 15 }, { desc: '+15 Might, Intellect and Personality.' });

// -- Resistance suffixes.
ench('of_flame_ward', 'of Flame Ward', 'suffix', 3, WORN.concat(JEWEL), { resist: { fire: 20 } }, { desc: '+20 Fire resistance.' });
ench('of_storm_ward', 'of Storm Ward', 'suffix', 3, WORN.concat(JEWEL), { resist: { air: 20 } }, { desc: '+20 Air resistance.' });
ench('of_frost_ward', 'of Frost Ward', 'suffix', 3, WORN.concat(JEWEL), { resist: { water: 20 } }, { desc: '+20 Water resistance.' });
ench('of_earth_ward', 'of Earth Ward', 'suffix', 3, WORN.concat(JEWEL), { resist: { earth: 20 } }, { desc: '+20 Earth resistance.' });
ench('of_the_mind', 'of the Mind', 'suffix', 3, WORN.concat(JEWEL), { resist: { mind: 25 } }, { desc: '+25 Mind resistance.' });
ench('of_the_body', 'of the Body', 'suffix', 3, WORN.concat(JEWEL), { resist: { body: 25 } }, { desc: '+25 Body resistance.' });
ench('of_the_spirit', 'of the Spirit', 'suffix', 3, WORN.concat(JEWEL), { resist: { magic: 25 } }, { desc: '+25 Magic resistance.' });
ench('of_protection', 'of Protection', 'suffix', 4, WORN, { ac: 10 }, { desc: '+10 Armour Class.' });

// -- Skill suffixes.
ench('of_the_stealer', 'of the Stealer', 'suffix', 3, JEWEL, { skill: { disarm: 5, perception: 5 } }, { desc: '+5 Disarm Trap and Perception.' });
ench('of_the_sage', 'of the Sage', 'suffix', 3, JEWEL, { skill: { identify: 8, learning: 5 } }, { desc: '+8 Identify Item, +5 Learning.' });
ench('of_the_merchant', 'of the Merchant', 'suffix', 3, JEWEL, { skill: { merchant: 8 } }, { desc: '+8 Merchant.' });

// -- Prefixes: quality and craft.
ench('rusty', 'Rusty', 'prefix', 1, ANY_WEAPON.concat(WORN), { damage: -2, ac: -2, value: 0.4 }, { desc: 'Neglected and pitted.', value: -20 });
ench('sharp', 'Sharp', 'prefix', 1, MELEE, { damage: 3 }, { desc: '+3 damage.' });
ench('swift', 'Swift', 'prefix', 2, ANY_WEAPON, { recovery: 15 }, { desc: 'Recovers 15 ticks faster.' });
ench('flaming', 'Flaming', 'prefix', 3, MELEE, { elemental: { element: 'fire', dice: { n: 2, s: 4 } } }, { desc: 'Adds 2d4 fire damage.' });
ench('freezing', 'Freezing', 'prefix', 3, MELEE, { elemental: { element: 'water', dice: { n: 2, s: 4 } } }, { desc: 'Adds 2d4 cold damage.' });
ench('thundering', 'Thundering', 'prefix', 3, MELEE, { elemental: { element: 'air', dice: { n: 2, s: 4 } } }, { desc: 'Adds 2d4 electrical damage.' });
ench('poisonous', 'Poisonous', 'prefix', 3, ANY_WEAPON, { elemental: { element: 'earth', dice: { n: 2, s: 4 } }, inflict: { condition: 'poisoned_weak', chance: 15 } }, { desc: 'Adds 2d4 poison damage and may poison.' });
ench('lucky', 'Lucky', 'prefix', 2, ANY, { luck: 8 }, { desc: '+8 Luck.' });
ench('antique', 'Antique', 'prefix', 4, ANY, { value: 3 }, { desc: 'Worth three times as much to a collector.' });
ench('elven', 'Elven', 'prefix', 4, ANY_WEAPON.concat(WORN), { speed: 10, accuracy: 10 }, { desc: '+10 Speed and Accuracy.' });
ench('dwarven', 'Dwarven', 'prefix', 4, ANY_WEAPON.concat(WORN), { endurance: 15, ac: 3 }, { desc: '+15 Endurance and +3 Armour Class.' });
ench('monks', "Monk's", 'prefix', 4, WORN, { speed: 10, ac: 5, recovery: 10 }, { desc: '+10 Speed, +5 Armour Class, faster recovery.' });
ench('thiefs', "Thief's", 'prefix', 4, WORN, { accuracy: 10, skill: { disarm: 8 } }, { desc: '+10 Accuracy and +8 Disarm Trap.' });
ench('assassins', "Assassin's", 'prefix', 5, MELEE, { damage: 8, accuracy: 15 }, { desc: '+8 damage and +15 Accuracy.' });
ench('rogues', "Rogue's", 'prefix', 4, MELEE, { damage: 5, speed: 10 }, { desc: '+5 damage and +10 Speed.' });
ench('warriors', "Warrior's", 'prefix', 4, ANY_WEAPON, { might: 12, attack: 5 }, { desc: '+12 Might and +5 to hit.' });
ench('wizards', "Wizard's", 'prefix', 4, ANY, { sp: 20, intellect: 10 }, { desc: '+20 spell points and +10 Intellect.' });
ench('priests', "Priest's", 'prefix', 4, ANY, { sp: 15, personality: 12 }, { desc: '+15 spell points and +12 Personality.' });
ench('giants', "Giant's", 'prefix', 5, MELEE, { might: 20, damage: 6 }, { desc: '+20 Might and +6 damage.' });
ench('titans', "Titan's", 'prefix', 6, MELEE, { might: 30, damage: 12 }, { desc: '+30 Might and +12 damage.' });

export const ENCHANTMENTS = E;
const ENCH_MAP = new Map(E.map((e) => [e.id, e]));
export function enchantmentById(id) { return ENCH_MAP.get(id) || null; }

// ---------------------------------------------------------------------------
// Artifacts and relics
// ---------------------------------------------------------------------------
//
// Artifacts are one-of-a-kind. Each names a base definition and overrides its
// numbers; `unique: true` keeps the loot generator from producing duplicates.

const ART = [];
function artifact(id, name, base, mods, desc, tier) {
  const def = itemDef(base);
  const a = {
    id, name, base, artifact: true, unique: true,
    type: def ? def.type : 'misc', slot: def ? def.slot : null,
    tier: tier || 6, value: 20000, mods, desc,
  };
  ART.push(a);
  return a;
}

artifact('harecks_leather', "Hareck's Leather", 'leather_armor',
  { ac: 20, speed: 25, endurance: 15, resist: { fire: 15, water: 15, air: 15, earth: 15 } },
  'Supple, ancient, and lighter than it looks.', 5);
artifact('elfbane', 'Elfbane', 'longbow',
  { damage: 15, accuracy: 20, doubleDamageVs: ['elf', 'humanoid'], elemental: { element: 'air', dice: { n: 3, s: 6 } } },
  'A bow the elves would very much like to see destroyed.', 5);
artifact('ghoulsbane', 'Ghoulsbane', 'broadsword',
  { damage: 12, doubleDamageVs: ['undead'], elemental: { element: 'light', dice: { n: 4, s: 6 } } },
  'It burns the restless dead to ash.', 5);
artifact('old_nick', 'Old Nick', 'dagger',
  { damage: 20, speed: 30, recovery: 25, vampiric: 0.5 },
  'A wicked little knife that drinks.', 6);
artifact('taledons_helm', "Taledon's Helm", 'great_helm',
  { ac: 15, personality: 20, sp: 40, resist: { magic: 30 } },
  'Worn by the first Priest of the Sun.', 6);
artifact('guinevere', 'Guinevere', 'katana',
  { damage: 18, might: 15, accuracy: 15, elemental: { element: 'fire', dice: { n: 4, s: 6 } } },
  'A blade of the old Ironfist guard.', 6);
artifact('iron_feather', 'Iron Feather', 'banded_mail',
  { ac: 25, endurance: 25, recovery: 30, resist: { earth: 30 } },
  'Heavy mail that weighs nothing at all.', 6);
artifact('hermes_sandals', "Hermes' Sandals", 'boots',
  { ac: 8, speed: 40, recovery: 30 },
  'The wearer moves faster than the eye follows.', 5);
artifact('lady_carmines_dress', "Lady Carmine's Dress", 'leather_armor',
  { ac: 18, personality: 30, luck: 20, resist: { mind: 40 } },
  'No one refuses the wearer anything.', 6);
artifact('phynaxian_crown', 'Phynaxian Crown', 'crown',
  { ac: 10, intellect: 30, personality: 30, sp: 60 },
  'The crown of a kingdom that no longer exists.', 6);
artifact('ethrics_staff', "Ethric's Staff", 'wizard_staff',
  { damage: 15, intellect: 30, sp: 50, elemental: { element: 'dark', dice: { n: 5, s: 6 } } },
  'The lich Ethric never did get it back.', 6);
artifact('justice', 'Justice', 'longsword',
  { damage: 14, accuracy: 25, resist: { magic: 25 }, doubleDamageVs: ['demon', 'devil'] },
  'It cannot be wielded in an unjust cause. Or so they say.', 6);
artifact('mordred', 'Mordred', 'two_handed_sword',
  { damage: 25, might: 25, vampiric: 0.3, elemental: { element: 'dark', dice: { n: 3, s: 8 } } },
  'A traitor\'s sword, and it has not improved with age.', 6);
artifact('perceval', 'Perceval', 'tower_shield',
  { ac: 22, endurance: 20, resist: { fire: 25, air: 25, water: 25, earth: 25 } },
  'The shield that held the pass at Silver Cove.', 6);
artifact('mekorigs_hammer', "Mekorig's Hammer", 'hammer',
  { damage: 22, might: 20, elemental: { element: 'air', dice: { n: 5, s: 6 } }, knockback: 600 },
  'Dwarven work. It sounds like thunder.', 6);
artifact('the_perfect_bow', 'The Perfect Bow', 'composite_bow',
  { damage: 20, accuracy: 30, recovery: 25 },
  'Every shot goes exactly where it was sent.', 6);
artifact('gibbet', 'Gibbet', 'flail',
  { damage: 16, might: 15, inflict: { condition: 'afraid', chance: 30 } },
  'Chains and hooks. Monsters run from it.', 5);
artifact('splitter', 'Splitter', 'great_axe',
  { damage: 20, might: 20, ignoreAC: 15 },
  'It does not care what armour you are wearing.', 6);

export const ARTIFACTS = ART;
const ART_MAP = new Map(ART.map((a) => [a.id, a]));
export function artifactById(id) { return ART_MAP.get(id) || null; }

// ---------------------------------------------------------------------------
// Potions, reagents and alchemy
// ---------------------------------------------------------------------------
//
// MM6's alchemy is a colour lattice. Three primary colours come straight from
// reagents; mixing two potions gives the next layer. Mixing anything with a
// Catalyst doubles its power; mixing incompatible potions makes a mess (and
// sometimes an explosion).

const P = [];
function potion(id, name, color, layer, effect, value, opts) {
  const o = opts || {};
  const def = {
    id, name, type: 'potion', color, layer, effect,
    power: o.power || 0, value, tier: Math.min(6, layer + 1),
    gw: 1, gh: 1, desc: o.desc || '',
  };
  P.push(def);
  return def;
}

// Layer 0: reagent-derived primaries.
potion('red_potion', 'Red Potion', 'red', 0, { heal: 'hp' }, 30, { power: 10, desc: 'Cure Wounds. Restores hit points.' });
potion('blue_potion', 'Blue Potion', 'blue', 0, { heal: 'sp' }, 30, { power: 10, desc: 'Magic Potion. Restores spell points.' });
potion('yellow_potion', 'Yellow Potion', 'yellow', 0, { cure: ['weak'] }, 30, { desc: 'Cure Weakness.' });

// Layer 1: two primaries.
potion('purple_potion', 'Purple Potion', 'purple', 1, { cure: ['poisoned_weak', 'poisoned_severe', 'poisoned_deadly'] }, 90, { desc: 'Cure Poison.' });
potion('orange_potion', 'Orange Potion', 'orange', 1, { cure: ['diseased_weak', 'diseased_severe', 'diseased_deadly'] }, 90, { desc: 'Cure Disease.' });
potion('green_potion', 'Green Potion', 'green', 1, { cure: ['insane'] }, 90, { desc: 'Cure Insanity.' });

// Layer 2: a primary and a secondary. These are the buff potions.
potion('white_potion', 'White Potion', 'white', 2, { buff: 'bless', power: 15 }, 250, { desc: 'Bless.' });
potion('black_potion', 'Black Potion', 'black', 2, { buff: 'heroism', power: 15 }, 250, { desc: 'Heroism.' });
potion('grey_potion', 'Grey Potion', 'grey', 2, { buff: 'haste', power: 1 }, 250, { desc: 'Haste.' });
potion('cyan_potion', 'Cyan Potion', 'cyan', 2, { buff: 'shield', power: 1 }, 250, { desc: 'Shield.' });
potion('pink_potion', 'Pink Potion', 'pink', 2, { buff: 'stone_skin', power: 15 }, 250, { desc: 'Stone Skin.' });
potion('golden_potion', 'Golden Potion', 'gold', 2, { buff: 'preservation', power: 1 }, 300, { desc: 'Preservation.' });

// Layer 3: the permanent stat potions. Rare, precious, and never sold cheap.
potion('might_boost', 'Pure Might', 'crimson', 3, { permStat: 'might', power: 10 }, 2500, { desc: 'Permanently raises Might.' });
potion('intellect_boost', 'Pure Intellect', 'azure', 3, { permStat: 'intellect', power: 10 }, 2500, { desc: 'Permanently raises Intellect.' });
potion('personality_boost', 'Pure Personality', 'violet', 3, { permStat: 'personality', power: 10 }, 2500, { desc: 'Permanently raises Personality.' });
potion('endurance_boost', 'Pure Endurance', 'emerald', 3, { permStat: 'endurance', power: 10 }, 2500, { desc: 'Permanently raises Endurance.' });
potion('accuracy_boost', 'Pure Accuracy', 'amber', 3, { permStat: 'accuracy', power: 10 }, 2500, { desc: 'Permanently raises Accuracy.' });
potion('speed_boost', 'Pure Speed', 'silver', 3, { permStat: 'speed', power: 10 }, 2500, { desc: 'Permanently raises Speed.' });
potion('luck_boost', 'Pure Luck', 'opal', 3, { permStat: 'luck', power: 10 }, 2500, { desc: 'Permanently raises Luck.' });

// Layer 4: the divine potions and the catalyst.
potion('divine_cure', 'Divine Cure', 'radiant', 4, { heal: 'hp', full: true, cureAll: true }, 5000, { power: 999, desc: 'Heals fully and cures everything.' });
potion('divine_magic', 'Divine Magic', 'radiant_blue', 4, { heal: 'sp', full: true }, 5000, { power: 999, desc: 'Restores all spell points.' });
potion('divine_power', 'Divine Power', 'radiant_gold', 4, { buff: 'hour_of_power', power: 30 }, 6000, { desc: 'Hour of Power in a bottle.' });
potion('catalyst', 'Catalyst', 'clear', 1, { catalyst: true }, 200, { desc: 'Doubles the strength of whatever it is mixed with.' });
potion('philosophers_stone', "Philosopher's Stone", 'stone', 4, { catalyst: true, power: 3 }, 10000, { desc: 'Triples the strength of whatever it is mixed with.' });

export const POTIONS = P;
const POTION_MAP = new Map(P.map((p) => [p.id, p]));
for (const p of P) DEFS.set(p.id, p);

/** Reagents. `base` is the primary colour they distil into. */
export const REAGENTS = [
  { id: 'widowsweep', name: 'Widowsweep Berries', base: 'red_potion', power: 5, value: 20, tier: 1 },
  { id: 'phirna_root', name: 'Phirna Root', base: 'red_potion', power: 8, value: 35, tier: 2 },
  { id: 'poppysnaps', name: 'Poppysnaps', base: 'yellow_potion', power: 5, value: 20, tier: 1 },
  { id: 'rose_petals', name: 'Crushed Rose Petals', base: 'yellow_potion', power: 8, value: 35, tier: 2 },
  { id: 'mushroom', name: 'Mushroom', base: 'blue_potion', power: 5, value: 20, tier: 1 },
  { id: 'obsidian', name: 'Obsidian', base: 'blue_potion', power: 10, value: 60, tier: 3 },
  { id: 'toadstool', name: 'Toadstool', base: 'green_potion', power: 8, value: 60, tier: 3 },
  { id: 'harpy_feather', name: 'Harpy Feather', base: 'grey_potion', power: 10, value: 90, tier: 3 },
  { id: 'meteorite', name: 'Meteorite Fragment', base: 'black_potion', power: 12, value: 150, tier: 4 },
  { id: 'troll_blood', name: 'Vial of Troll Blood', base: 'red_potion', power: 20, value: 250, tier: 4 },
  { id: 'devil_ichor', name: 'Vial of Devil Ichor', base: 'black_potion', power: 25, value: 400, tier: 5 },
  { id: 'ancient_stone', name: 'Ancient Stone', base: 'catalyst', power: 30, value: 800, tier: 5 },
];
const REAGENT_MAP = new Map(REAGENTS.map((r) => [r.id, r]));
export function reagentById(id) { return REAGENT_MAP.get(id) || null; }
for (const r of REAGENTS) DEFS.set(r.id, Object.assign({ type: 'reagent', gw: 1, gh: 1 }, r));

// The mixing lattice. Key is the two potion ids sorted and joined.
const MIX = {};
function mix(a, b, result) { MIX[[a, b].sort().join('+')] = result; }

mix('red_potion', 'blue_potion', 'purple_potion');
mix('red_potion', 'yellow_potion', 'orange_potion');
mix('blue_potion', 'yellow_potion', 'green_potion');
mix('purple_potion', 'yellow_potion', 'white_potion');
mix('orange_potion', 'blue_potion', 'black_potion');
mix('green_potion', 'red_potion', 'grey_potion');
mix('purple_potion', 'orange_potion', 'cyan_potion');
mix('orange_potion', 'green_potion', 'pink_potion');
mix('purple_potion', 'green_potion', 'golden_potion');
mix('white_potion', 'black_potion', 'divine_power');
mix('white_potion', 'grey_potion', 'divine_cure');
mix('black_potion', 'grey_potion', 'divine_magic');
// Stat potions come from a layer-2 potion plus a catalyst-grade reagent, which
// the alchemy screen models as a mix with the catalyst potion.
mix('white_potion', 'catalyst', 'might_boost');
mix('black_potion', 'catalyst', 'endurance_boost');
mix('grey_potion', 'catalyst', 'speed_boost');
mix('cyan_potion', 'catalyst', 'intellect_boost');
mix('pink_potion', 'catalyst', 'personality_boost');
mix('golden_potion', 'catalyst', 'luck_boost');
mix('purple_potion', 'catalyst', 'accuracy_boost');

/**
 * Mix two potions. Returns { ok, result, message }. Mixing the same layer-0
 * potion twice simply makes a stronger one; unknown pairs explode.
 */
export function mixPotions(idA, idB) {
  const a = POTION_MAP.get(idA), b = POTION_MAP.get(idB);
  if (!a || !b) return { ok: false, result: null, message: 'That is not a potion.' };
  if (a.effect.catalyst && b.effect.catalyst) return { ok: false, result: null, message: 'The catalysts cancel out.' };
  if (idA === idB) return { ok: true, result: idA, stronger: true, message: `The ${a.name} grows stronger.` };
  const key = [idA, idB].sort().join('+');
  const r = MIX[key];
  if (r) return { ok: true, result: r, message: `You have brewed a ${POTION_MAP.get(r).name}.` };
  return { ok: false, result: null, explode: true, message: 'The mixture explodes!' };
}

/** Every mix that produces `id`, for the alchemy notebook. */
export function recipesFor(id) {
  const out = [];
  for (const key of Object.keys(MIX)) if (MIX[key] === id) out.push(key.split('+'));
  return out;
}

export function potionById(id) { return POTION_MAP.get(id) || null; }

// ---------------------------------------------------------------------------
// Consumables and sundries
// ---------------------------------------------------------------------------

export const MISC_ITEMS = [
  { id: 'gold', name: 'Gold', type: 'gold', value: 1, gw: 1, gh: 1, tier: 1 },
  { id: 'food', name: 'Food', type: 'food', value: 25, gw: 1, gh: 1, tier: 1, desc: 'One day\'s rations for the party.' },
  { id: 'gem_quartz', name: 'Quartz', type: 'gem', value: 50, gw: 1, gh: 1, tier: 1 },
  { id: 'gem_amber', name: 'Amber', type: 'gem', value: 150, gw: 1, gh: 1, tier: 2 },
  { id: 'gem_garnet', name: 'Garnet', type: 'gem', value: 400, gw: 1, gh: 1, tier: 3 },
  { id: 'gem_sapphire', name: 'Sapphire', type: 'gem', value: 1000, gw: 1, gh: 1, tier: 4 },
  { id: 'gem_ruby', name: 'Ruby', type: 'gem', value: 2500, gw: 1, gh: 1, tier: 5 },
  { id: 'gem_diamond', name: 'Diamond', type: 'gem', value: 6000, gw: 1, gh: 1, tier: 6 },
  { id: 'lockpick', name: 'Lockpick', type: 'misc', value: 30, gw: 1, gh: 1, tier: 1 },
  { id: 'torch', name: 'Torch', type: 'misc', value: 5, gw: 1, gh: 2, tier: 1 },
  { id: 'rope', name: 'Rope', type: 'misc', value: 15, gw: 1, gh: 1, tier: 1 },
  { id: 'bone', name: 'Old Bone', type: 'misc', value: 1, gw: 1, gh: 1, tier: 1, junk: true },
  { id: 'rusty_nail', name: 'Rusty Nail', type: 'misc', value: 1, gw: 1, gh: 1, tier: 1, junk: true },
  { id: 'broken_pot', name: 'Broken Pot', type: 'misc', value: 2, gw: 1, gh: 1, tier: 1, junk: true },
  { id: 'skull', name: 'Grinning Skull', type: 'misc', value: 8, gw: 1, gh: 1, tier: 1, junk: true },
  { id: 'strange_device', name: 'Strange Device', type: 'misc', value: 500, gw: 2, gh: 1, tier: 5, desc: 'A relic of the Ancients. Somebody will want this.' },
];
for (const m of MISC_ITEMS) DEFS.set(m.id, m);

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const UNIDENTIFIED_PREFIX = ['Strange', 'Odd', 'Peculiar', 'Unusual', 'Curious'];

/** The item's display name, respecting whether it has been identified. */
export function itemName(item, identified) {
  if (!item) return '';
  const known = identified === undefined ? item.identified !== false : identified;
  if (item.type === 'gold') return `${item.quantity || 0} gold`;

  const art = item.artifactId ? artifactById(item.artifactId) : null;
  const def = itemDef(item.def);
  const baseName = art ? art.name : def ? def.name : (item.name || 'Item');

  if (!known) {
    // MM6 shows the item's kind but not what it does until identified.
    if (art || item.prefix || item.suffix || item.bonus) {
      const seed = (item.uid || 0) % UNIDENTIFIED_PREFIX.length;
      return `${UNIDENTIFIED_PREFIX[seed]} ${def ? def.name : baseName}`;
    }
    return baseName;
  }
  if (art) return art.name;

  let name = baseName;
  if (item.prefix) {
    const p = enchantmentById(item.prefix);
    if (p) name = `${p.name} ${name}`;
  }
  if (item.suffix) {
    const s = enchantmentById(item.suffix);
    if (s) name = `${name} ${s.name}`;
  }
  if (item.bonus) name = `${name} +${item.bonus}`;
  if (item.quantity > 1) name = `${name} (${item.quantity})`;
  return name;
}

// ---------------------------------------------------------------------------
// Value and stats
// ---------------------------------------------------------------------------

/** Gold value of an instance, including enchantments and condition. */
export function itemValue(item) {
  if (!item) return 0;
  if (item.type === 'gold') return item.quantity || 0;
  const art = item.artifactId ? artifactById(item.artifactId) : null;
  if (art) return art.value;
  const def = itemDef(item.def);
  if (!def) return 1;
  let v = def.value || 1;
  if (item.bonus) v += item.bonus * item.bonus * 100;
  let mult = 1;
  for (const eid of [item.prefix, item.suffix]) {
    if (!eid) continue;
    const e = enchantmentById(eid);
    if (!e) continue;
    if (e.mods && e.mods.value) mult *= e.mods.value;
    else v += e.value;
  }
  v = Math.round(v * mult);
  if (item.quantity > 1) v *= item.quantity;
  if (item.broken) v = Math.round(v * 0.1);
  if (item.identified === false) v = Math.round(v * 0.5);
  return Math.max(1, v);
}

/**
 * Collapse an instance's enchantments and artifact overrides into one bag of
 * modifiers. This is what party.js adds to a character when equipping.
 */
export function itemMods(item) {
  const out = {
    might: 0, intellect: 0, personality: 0, endurance: 0, accuracy: 0, speed: 0, luck: 0,
    ac: 0, attack: 0, damage: 0, hp: 0, sp: 0, recovery: 0,
    resist: {}, skill: {}, elemental: null, vampiric: 0, drainSP: 0,
    doubleDamageVs: null, ignoreAC: 0, knockback: 0, explodes: false, inflict: null,
  };
  if (!item) return out;
  const def = itemDef(item.def);
  if (def && def.ac) out.ac += def.ac;
  if (def && def.mods) mergeMods(out, def.mods);
  if (item.bonus) { out.ac += item.bonus; out.attack += item.bonus; out.damage += item.bonus; }
  for (const eid of [item.prefix, item.suffix]) {
    const e = eid && enchantmentById(eid);
    if (e) mergeMods(out, e.mods);
  }
  const art = item.artifactId ? artifactById(item.artifactId) : null;
  if (art) mergeMods(out, art.mods);
  if (item.broken) { out.ac = 0; out.damage = 0; out.attack = 0; }
  return out;
}

function mergeMods(out, mods) {
  for (const k of Object.keys(mods)) {
    const v = mods[k];
    if (k === 'resist' || k === 'skill') {
      for (const r of Object.keys(v)) out[k][r] = (out[k][r] || 0) + v[r];
    } else if (k === 'elemental') {
      // Two elemental riders stack as separate hits; keep a list.
      if (!out.elemental) out.elemental = [];
      out.elemental.push(v);
    } else if (k === 'doubleDamageVs') {
      out.doubleDamageVs = (out.doubleDamageVs || []).concat(v);
    } else if (k === 'inflict') {
      out.inflict = v;
    } else if (k === 'value') {
      // handled by itemValue
    } else if (typeof v === 'number') {
      out[k] = (out[k] || 0) + v;
    } else if (typeof v === 'boolean') {
      out[k] = out[k] || v;
    }
  }
}

/** The damage dice an equipped weapon rolls, including its artifact override. */
export function weaponDice(item) {
  const def = itemDef(item && item.def);
  if (!def || !def.dice) return { n: 1, s: 3, plus: 0 };
  const d = { n: def.dice.n, s: def.dice.s, plus: def.dice.plus || 0 };
  if (item.bonus) d.plus += item.bonus;
  return d;
}

/** Recovery ticks the item imposes. Weapons: swing speed. Armour: penalty. */
export function itemRecovery(item) {
  const def = itemDef(item && item.def);
  if (!def) return 0;
  const mods = itemMods(item);
  return Math.max(0, (def.recovery || 0) - (mods.recovery || 0));
}

/** Multi-line description for the item pop-up. */
export function itemDescription(item) {
  if (!item) return '';
  const lines = [itemName(item)];
  const def = itemDef(item.def);
  const art = item.artifactId ? artifactById(item.artifactId) : null;
  if (item.identified === false) {
    lines.push('You cannot tell what this is without identifying it.');
    lines.push(`Value: ${itemValue(item)} gold`);
    return lines.join('\n');
  }
  if (def && def.dice) {
    const d = weaponDice(item);
    lines.push(`Damage: ${d.n}d${d.s}${d.plus ? `+${d.plus}` : ''}   Recovery: ${itemRecovery(item)}`);
    if (def.skill) lines.push(`Skill: ${def.skill}`);
  }
  if (def && def.ac) lines.push(`Armour Class: +${def.ac}${def.recovery ? `   Recovery penalty: ${def.recovery}` : ''}`);
  const mods = itemMods(item);
  const bits = [];
  for (const k of ['might', 'intellect', 'personality', 'endurance', 'accuracy', 'speed', 'luck', 'hp', 'sp', 'attack', 'damage']) {
    if (mods[k]) bits.push(`${k} ${mods[k] > 0 ? '+' : ''}${mods[k]}`);
  }
  for (const r of Object.keys(mods.resist)) bits.push(`${r} resist +${mods.resist[r]}`);
  for (const s of Object.keys(mods.skill)) bits.push(`${s} +${mods.skill[s]}`);
  if (bits.length) lines.push(bits.join(', '));
  if (mods.elemental) for (const e of mods.elemental) lines.push(`+${e.dice.n}d${e.dice.s} ${e.element} damage`);
  if (mods.vampiric) lines.push(`Drains ${Math.round(mods.vampiric * 100)}% of damage as health.`);
  if (art) lines.push(art.desc);
  else if (def && def.desc) lines.push(def.desc);
  if (item.broken) lines.push('BROKEN - it must be repaired before it will work.');
  lines.push(`Value: ${itemValue(item)} gold`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

let UID = 1;
/** Reset instance ids; the save loader calls this so uids stay stable. */
export function setUidCounter(n) { UID = n | 0 || 1; }
export function uidCounter() { return UID; }

/** Build an instance of a definition. */
export function makeItem(defId, opts) {
  const o = opts || {};
  const def = itemDef(defId);
  if (!def) return null;
  const item = {
    uid: UID++,
    def: defId,
    type: def.type,
    slot: def.slot || TYPE_SLOT[def.type] || null,
    bonus: o.bonus || 0,
    prefix: o.prefix || null,
    suffix: o.suffix || null,
    artifactId: o.artifactId || null,
    identified: o.identified !== undefined ? o.identified : true,
    broken: !!o.broken,
    quantity: o.quantity || 1,
    charges: o.charges || 0,
    maxCharges: o.maxCharges || 0,
    spellId: o.spellId || null,
    gw: def.gw || 1, gh: def.gh || 1,
    x: -1, y: -1,
  };
  return item;
}

/** Build an artifact instance by artifact id. */
export function makeArtifact(artId) {
  const art = artifactById(artId);
  if (!art) return null;
  const item = makeItem(art.base, { identified: false });
  if (!item) return null;
  item.artifactId = artId;
  item.type = art.type;
  item.slot = art.slot;
  return item;
}

/** A stack of gold. */
export function makeGold(amount) {
  const g = makeItem('gold', { quantity: Math.max(1, amount | 0) });
  return g;
}

/** A scroll of a spell. */
export function makeScroll(spellId, spellName, value) {
  const item = {
    uid: UID++, def: null, type: 'scroll', slot: null, bonus: 0,
    prefix: null, suffix: null, artifactId: null, identified: true,
    broken: false, quantity: 1, charges: 1, maxCharges: 1,
    spellId, name: `Scroll of ${spellName}`, value: value || 100,
    gw: 1, gh: 2, x: -1, y: -1,
  };
  return item;
}

/** A wand with charges. */
export function makeWand(spellId, spellName, charges, value) {
  return {
    uid: UID++, def: null, type: 'wand', slot: null, bonus: 0,
    prefix: null, suffix: null, artifactId: null, identified: false,
    broken: false, quantity: 1, charges, maxCharges: charges,
    spellId, name: `Wand of ${spellName}`, value: value || 500,
    gw: 1, gh: 3, x: -1, y: -1,
  };
}

/** A spell book that teaches one spell. */
export function makeSpellbook(spellId, spellName, school, value) {
  return {
    uid: UID++, def: null, type: 'spellbook', slot: null, bonus: 0,
    prefix: null, suffix: null, artifactId: null, identified: true,
    broken: false, quantity: 1, charges: 0, maxCharges: 0,
    spellId, school, name: `${spellName}`, value: value || 500,
    gw: 2, gh: 2, x: -1, y: -1,
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const EQUIP_KINDS = ['weapon', 'bow', 'armor', 'shield', 'helm', 'boots', 'gauntlets', 'belt', 'cloak', 'amulet', 'ring'];

/** Level -> item tier. A level-1 party finds tier-1 junk; level 40+ finds tier 6. */
export function tierForLevel(level, rand) {
  const base = level <= 3 ? 1 : level <= 8 ? 2 : level <= 15 ? 3 : level <= 25 ? 4 : level <= 38 ? 5 : 6;
  if (!rand) return base;
  const roll = rand.float();
  if (roll < 0.12 && base > 1) return base - 1;
  if (roll > 0.94 && base < 6) return base + 1;
  return base;
}

function defsOfType(type) {
  const out = [];
  for (const d of DEFS.values()) if (d.type === type && !d.junk) out.push(d);
  return out;
}

/**
 * Generate one item.
 *   level      the monster/chest level driving quality
 *   tier       force a tier (otherwise derived from level)
 *   kind       'equipment' | 'potion' | 'scroll' | 'wand' | 'gem' | 'reagent' |
 *              'gold' | 'junk' | an ITEM_TYPES value
 *   forcedType a specific definition id
 */
export function generateItem(rand, opts) {
  const o = opts || {};
  const level = o.level !== undefined ? o.level : 1;
  const tier = o.tier || tierForLevel(level, rand);

  if (o.forcedType) {
    const item = makeItem(o.forcedType, { identified: o.identified });
    if (item) enchantItem(item, rand, tier, level, o);
    return item;
  }

  let kind = o.kind;
  if (!kind) {
    kind = rand.weighted([
      { k: 'equipment', w: 46 },
      { k: 'potion', w: 14 },
      { k: 'gold', w: 12 },
      { k: 'scroll', w: 8 },
      { k: 'gem', w: 7 },
      { k: 'reagent', w: 6 },
      { k: 'wand', w: 4 },
      { k: 'junk', w: 3 },
    ]).k;
  }

  switch (kind) {
    case 'gold':
      return makeGold(Math.max(1, Math.round(rand.int(8, 30) * (1 + level * 0.7))));
    case 'potion': {
      const pool = P.filter((p) => p.layer <= Math.min(3, tier - 1) && p.id !== 'philosophers_stone');
      const p = pool.length ? rand.pick(pool) : P[0];
      return makeItem(p.id, { identified: true });
    }
    case 'reagent': {
      const pool = REAGENTS.filter((r) => r.tier <= tier + 1);
      return makeItem(rand.pick(pool.length ? pool : REAGENTS).id, { identified: true });
    }
    case 'gem': {
      const gems = MISC_ITEMS.filter((m) => m.type === 'gem' && m.tier <= tier + 1);
      return makeItem(rand.pick(gems.length ? gems : MISC_ITEMS.slice(2, 3)).id, { identified: true });
    }
    case 'junk': {
      const junk = MISC_ITEMS.filter((m) => m.junk || m.type === 'misc');
      return makeItem(rand.pick(junk).id, { identified: true });
    }
    case 'scroll':
    case 'wand':
    case 'spellbook':
      // The caller (loot tables) supplies spell data; without it fall back to
      // a potion so generation never returns null.
      return o.spell
        ? (kind === 'scroll' ? makeScroll(o.spell.id, o.spell.name, o.spell.value)
          : kind === 'wand' ? makeWand(o.spell.id, o.spell.name, rand.int(3, 12), o.spell.value)
            : makeSpellbook(o.spell.id, o.spell.name, o.spell.school, o.spell.value))
        : makeItem('red_potion', { identified: true });
    default: {
      // Equipment.
      const type = ITEM_TYPES.includes(kind) && kind !== 'equipment' ? kind : rand.weighted([
        { k: 'weapon', w: 30 }, { k: 'armor', w: 16 }, { k: 'bow', w: 8 },
        { k: 'shield', w: 8 }, { k: 'helm', w: 8 }, { k: 'boots', w: 7 },
        { k: 'gauntlets', w: 6 }, { k: 'belt', w: 6 }, { k: 'cloak', w: 5 },
        { k: 'ring', w: 4 }, { k: 'amulet', w: 2 },
      ]).k;
      let pool = defsOfType(type).filter((d) => d.tier <= tier);
      if (!pool.length) pool = defsOfType(type).filter((d) => d.tier <= tier + 1);
      if (!pool.length) pool = defsOfType(type);
      if (!pool.length) return makeGold(rand.int(5, 50));
      const def = rand.pick(pool);
      const item = makeItem(def.id, { identified: o.identified !== undefined ? o.identified : false });
      enchantItem(item, rand, tier, level, o);
      return item;
    }
  }
}

/** Roll a plus, a prefix and a suffix appropriate to the tier. */
function enchantItem(item, rand, tier, level, opts) {
  if (!item || !EQUIP_KINDS.includes(item.type)) return item;
  const o = opts || {};
  const magicChance = o.magicChance !== undefined ? o.magicChance : Math.min(0.7, 0.04 + tier * 0.09);

  // Artifacts: vanishingly rare, and only deep in the world.
  if (!o.noArtifact && tier >= 5 && rand.float() < 0.012) {
    const pool = ARTIFACTS.filter((a) => a.type === item.type && a.tier <= tier);
    if (pool.length) {
      const art = rand.pick(pool);
      item.artifactId = art.id;
      item.def = art.base;
      item.identified = false;
      const d = itemDef(art.base);
      if (d) { item.gw = d.gw; item.gh = d.gh; }
      return item;
    }
  }

  if (rand.float() > magicChance) return item;

  // A simple "+N" is the commonest magic item in MM6.
  if (rand.bool(0.45)) {
    item.bonus = Math.max(1, Math.min(tier + 1, rand.int(1, Math.max(1, Math.floor(tier * 0.9) + 1))));
    item.identified = false;
    return item;
  }

  const usable = E.filter((e) => e.on.includes(item.type) && e.tier <= tier && e.minLevel <= level + 4);
  if (!usable.length) { item.bonus = 1; return item; }
  const pick = rand.weighted(usable.map((e) => ({ e, w: Math.max(1, 8 - e.tier * 1.2) })));
  if (pick.e.kind === 'prefix') item.prefix = pick.e.id; else item.suffix = pick.e.id;

  // Occasionally an item gets both a prefix and a suffix.
  if (tier >= 4 && rand.bool(0.18)) {
    const other = usable.filter((e) => e.kind !== pick.e.kind);
    if (other.length) {
      const second = rand.pick(other);
      if (second.kind === 'prefix') item.prefix = second.id; else item.suffix = second.id;
    }
  }
  item.identified = false;
  return item;
}

/**
 * Roll a small pile of loot. `count` items plus, usually, some gold.
 * Higher `level` shifts the whole distribution up.
 */
export function randomLoot(rand, level, count) {
  const n = Math.max(0, count === undefined ? 3 : count);
  const out = [];
  for (let i = 0; i < n; i++) {
    const item = generateItem(rand, { level });
    if (item) out.push(item);
  }
  return out;
}

/** A chest: gold plus items, quality scaled by the chest's own level. */
export function chestLoot(rand, level, richness = 1) {
  const items = [];
  const goldAmount = Math.round(rand.int(20, 80) * (1 + level * 0.9) * richness);
  items.push(makeGold(goldAmount));
  const n = Math.max(1, Math.round(rand.int(1, 4) * richness));
  for (let i = 0; i < n; i++) items.push(generateItem(rand, { level }));
  return items;
}

/** Starting equipment for a class, so a new party is not naked. */
export function startingKit(classId) {
  const kit = [];
  const add = (id) => { const it = makeItem(id, { identified: true }); if (it) kit.push(it); };
  switch (classId) {
    case 'knight': add('longsword'); add('leather_armor'); add('buckler'); break;
    case 'paladin': add('mace'); add('leather_armor'); add('buckler'); break;
    case 'archer': add('short_bow'); add('shortsword'); add('leather_armor'); break;
    case 'cleric': add('club'); add('leather_armor'); break;
    case 'sorcerer': add('staff'); add('cloak'); break;
    case 'druid': add('staff'); add('leather_armor'); break;
    default: add('club'); break;
  }
  add('red_potion');
  return kit;
}

/** Every item definition, for the shop-stock generator. */
export function allDefs() { return Array.from(DEFS.values()); }

/** Shop stock: `count` items of the shop's kind, at the town's tier. */
export function shopStock(rand, kind, tier, count) {
  const out = [];
  const kinds = {
    weapon: ['weapon', 'bow'],
    armor: ['armor', 'shield', 'helm', 'boots', 'gauntlets', 'belt', 'cloak'],
    magic: ['amulet', 'ring'],
    alchemy: null,
  };
  for (let i = 0; i < count; i++) {
    if (kind === 'alchemy') {
      const pool = P.filter((p) => p.layer <= Math.min(2, tier)).concat(REAGENTS.filter((r) => r.tier <= tier).map((r) => DEFS.get(r.id)));
      out.push(makeItem(rand.pick(pool).id, { identified: true }));
    } else {
      const types = kinds[kind] || ['weapon'];
      const type = rand.pick(types);
      let pool = defsOfType(type).filter((d) => d.tier <= tier);
      if (!pool.length) pool = defsOfType(type);
      const item = makeItem(rand.pick(pool).id, { identified: true });
      if (rand.bool(0.25)) enchantItem(item, rand, Math.max(1, tier - 1), tier * 6, { noArtifact: true, magicChance: 1 });
      item.identified = true;
      out.push(item);
    }
  }
  return out;
}

/** Convenience for tests and tools: a Rand seeded from a string. */
export function itemRand(seed) { return new Rand(seed); }
