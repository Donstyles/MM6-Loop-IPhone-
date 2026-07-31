// The 99 spells of Might & Magic VI: nine schools of eleven.
//
// Every spell is data. Damage, duration and power are declarative specs that
// `spellDamage` / `spellDuration` / `spellPower` evaluate against the caster's
// skill level and mastery, so the tables can be rebalanced without touching
// the combat code.
//
// `vfx` names the visual effect the renderer should play. The art side keys off
// these strings; never invent a new one without adding it to VFX_TAGS.

import { MASTERY, SCHOOL_TIER_LIMIT, masteryOf } from './skills.js';
import { CLASSES } from './stats.js';
import { classSkillMax } from './skills.js';

/** The nine schools, in spell-book tab order. */
export const SCHOOLS = [
  { id: 'fire', name: 'Fire', element: 'fire', stat: 'intellect', color: 'fire' },
  { id: 'air', name: 'Air', element: 'air', stat: 'intellect', color: 'sky' },
  { id: 'water', name: 'Water', element: 'water', stat: 'intellect', color: 'water' },
  { id: 'earth', name: 'Earth', element: 'earth', stat: 'intellect', color: 'dirt' },
  { id: 'spirit', name: 'Spirit', element: 'magic', stat: 'personality', color: 'gold' },
  { id: 'mind', name: 'Mind', element: 'mind', stat: 'personality', color: 'arcane' },
  { id: 'body', name: 'Body', element: 'body', stat: 'personality', color: 'flesh' },
  { id: 'light', name: 'Light', element: 'light', stat: 'personality', color: 'gold' },
  { id: 'dark', name: 'Dark', element: 'dark', stat: 'intellect', color: 'arcane' },
];

export const SCHOOL_IDS = SCHOOLS.map((s) => s.id);

/** Every visual-effect tag a spell may request. */
export const VFX_TAGS = [
  'light_glow', 'fire_bolt', 'buff_shimmer', 'weapon_flame', 'haste_blur',
  'fireball', 'fire_spike', 'immolation', 'meteor', 'inferno', 'incinerate',
  'eye_glow', 'feather', 'sparks', 'jump_puff', 'shield_bubble', 'lightning',
  'invisible_fade', 'implosion', 'fly_wings', 'starburst',
  'wake_flash', 'poison_cloud', 'ice_shard', 'water_ripple', 'recharge_spark',
  'acid_splash', 'enchant_glow', 'portal_swirl', 'ice_blast', 'beacon_light',
  'stun_ring', 'slow_web', 'earth_shield', 'swarm', 'stone_skin', 'blades',
  'flesh_glow', 'rock_blast', 'telekinesis', 'death_blossom', 'mass_distortion',
  'detect_pulse', 'bless_ray', 'fate_rune', 'turn_undead', 'curse_break',
  'preserve_glow', 'heroism_aura', 'spirit_lash', 'raise_glow', 'shared_life',
  'resurrect_beam',
  'calm_wave', 'mind_blast', 'precision_glint', 'paralysis_break', 'charm_heart',
  'fear_wave', 'feeblemind', 'berserk_rage', 'enslave_chain', 'psychic_shock', 'telepathy',
  'heal_glow', 'first_aid', 'magic_ward', 'harm_bolt', 'regen_glow', 'cure_poison',
  'hammerhands', 'cure_disease', 'body_ward', 'flying_fist', 'power_cure',
  'light_bolt', 'destroy_undead', 'dispel_burst', 'paralyze_ray', 'summon_circle',
  'day_of_gods', 'prismatic', 'day_of_protection', 'hour_of_power', 'sunray', 'divine',
  'reanimate', 'toxic_cloud', 'vampiric_glow', 'shrapmetal', 'shrink_ray',
  'control_undead', 'pain_reflection', 'sacrifice_glow', 'dragon_breath',
  'armageddon', 'souldrinker', 'dark_ray', 'beam',
];
const VFX_SET = new Set(VFX_TAGS);

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------
//
// dmg: { n0, nPer, s, flat, flatPer, element }
//   dice count = n0 + floor(nPer * skill), flat = flat + flatPer * skill
// dur: { base, per, unit }  minutes unless `unit` says otherwise
// pow: { base, per }        buff strength / heal amount

const D = (element, n0, nPer, s, flat = 0, flatPer = 0) => ({ element, n0, nPer, s, flat, flatPer });
const DUR = (base, per = 0) => ({ base, per });
const POW = (base, per = 0) => ({ base, per });

/** Global damage knob, tuned by the balance harness. */
export const SPELL_POWER = 1.0;

/** Mastery multiplies spell output; MM6 rewards the rank, not just the level. */
export const MASTERY_POWER = Object.freeze([0, 1.0, 1.2, 1.45]);

const ALL = [];
let ORDER = 0;

function spell(school, tier, id, name, sp, type, target, vfx, extra) {
  const s = Object.assign({
    id, name, school, tier, sp, type, target, vfx,
    order: ORDER++,
    dmg: null, dur: null, pow: null, heal: null,
    cures: null, radius: 0, text: '', notes: {},
  }, extra || {});
  ALL.push(s);
  return s;
}

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

spell('fire', 1, 'torch_light', 'Torch Light', 1, 'utility', 'party', 'light_glow', {
  dur: DUR(60, 10), pow: POW(3, 0.5),
  text: 'Lights the way. Radius and duration grow with skill.',
  notes: { 2: 'Brighter light.', 3: 'Daylight underground.' },
});
spell('fire', 2, 'fire_bolt', 'Fire Bolt', 2, 'damage', 'one', 'fire_bolt', {
  dmg: D('fire', 2, 0.34, 6),
  text: 'A bolt of flame. The workhorse of every young sorcerer.',
  notes: { 3: 'Pierces the first target and strikes a second.' },
});
spell('fire', 3, 'protection_from_fire', 'Protection from Fire', 3, 'buff', 'party', 'buff_shimmer', {
  dur: DUR(60, 15), pow: POW(5, 1.5), resist: 'fire',
  text: 'Adds fire resistance to the whole party.',
});
spell('fire', 4, 'fire_aura', 'Fire Aura', 4, 'enchant', 'item', 'weapon_flame', {
  dur: DUR(60, 15), pow: POW(2, 0.5),
  text: 'Sheathes a weapon in flame; it deals extra fire damage.',
  notes: { 2: 'Permanent on a non-magical weapon.', 3: 'Also adds +2 to hit.' },
});
spell('fire', 5, 'haste', 'Haste', 5, 'buff', 'party', 'haste_blur', {
  dur: DUR(30, 5),
  text: 'Halves recovery time for the party. They are Weak when it ends.',
  notes: { 3: 'No weakness afterwards.' },
});
spell('fire', 6, 'fireball', 'Fireball', 8, 'damage', 'area', 'fireball', {
  dmg: D('fire', 3, 0.4, 6), radius: 300,
  text: 'An exploding ball of fire.',
  notes: { 2: 'Larger blast.', 3: 'Much larger blast.' },
});
spell('fire', 7, 'fire_spike', 'Fire Spike', 10, 'damage', 'point', 'fire_spike', {
  dmg: D('fire', 2, 0.5, 8), dur: DUR(30, 5),
  text: 'Plants burning spikes that damage anything that comes near.',
});
spell('fire', 8, 'immolation', 'Immolation', 15, 'damage', 'aura', 'immolation', {
  dmg: D('fire', 1, 0.25, 6), dur: DUR(10, 2), radius: 300,
  text: 'Wreathes the party in fire, burning everything that closes to melee.',
});
spell('fire', 9, 'meteor_shower', 'Meteor Shower', 20, 'damage', 'area', 'meteor', {
  dmg: D('fire', 4, 0.5, 6), radius: 450,
  text: 'Calls down rocks from the sky. Outdoors only.',
  notes: { 2: 'More meteors.', 3: 'A rain of them.' },
});
spell('fire', 10, 'inferno', 'Inferno', 25, 'damage', 'area', 'inferno', {
  dmg: D('fire', 6, 0.6, 8), radius: 600,
  text: 'Sets the whole field alight. Indoors only.',
});
spell('fire', 11, 'incinerate', 'Incinerate', 30, 'damage', 'one', 'incinerate', {
  dmg: D('fire', 0, 0, 1, 25, 12),
  text: 'A pillar of white fire. Fifteen damage per point of skill, and no dice about it.',
});

// ---------------------------------------------------------------------------
// Air
// ---------------------------------------------------------------------------

spell('air', 1, 'wizard_eye', 'Wizard Eye', 1, 'utility', 'self', 'eye_glow', {
  dur: DUR(60, 15), pow: POW(1, 0.2),
  text: 'Shows monsters on the automap.',
  notes: { 2: 'Shows items too.', 3: 'Shows the whole level.' },
});
spell('air', 2, 'feather_fall', 'Feather Fall', 2, 'buff', 'party', 'feather', {
  dur: DUR(30, 10),
  text: 'The party takes no falling damage.',
});
spell('air', 3, 'protection_from_air', 'Protection from Air', 3, 'buff', 'party', 'buff_shimmer', {
  dur: DUR(60, 15), pow: POW(5, 1.5), resist: 'air',
  text: 'Adds electrical resistance to the whole party.',
});
spell('air', 4, 'sparks', 'Sparks', 5, 'damage', 'area', 'sparks', {
  dmg: D('air', 1, 0.2, 6), bolts: { base: 3, per: 0.34 }, radius: 250,
  text: 'A spray of small lightnings that bounce between targets.',
  notes: { 2: 'Five sparks.', 3: 'Nine sparks.' },
});
spell('air', 5, 'jump', 'Jump', 4, 'utility', 'self', 'jump_puff', {
  text: 'Leap forward and up. Cannot be cast in the air.',
});
spell('air', 6, 'shield', 'Shield', 8, 'buff', 'party', 'shield_bubble', {
  dur: DUR(30, 5),
  text: 'Halves damage from missiles and thrown weapons.',
  notes: { 3: 'Also halves ranged spell damage.' },
});
spell('air', 7, 'lightning_bolt', 'Lightning Bolt', 10, 'damage', 'one', 'lightning', {
  dmg: D('air', 3, 0.5, 8),
  text: 'A bolt that strikes in a straight line and does not miss.',
  notes: { 3: 'Chains to a second target.' },
});
spell('air', 8, 'invisibility', 'Invisibility', 15, 'buff', 'party', 'invisible_fade', {
  dur: DUR(20, 5),
  text: 'Monsters cannot see the party until it attacks.',
});
spell('air', 9, 'implosion', 'Implosion', 20, 'damage', 'one', 'implosion', {
  dmg: D('air', 0, 0, 1, 20, 10),
  text: 'Crushes a single monster with a collapsing sphere of air.',
});
spell('air', 10, 'fly', 'Fly', 25, 'buff', 'party', 'fly_wings', {
  dur: DUR(60, 15),
  text: 'The party flies. Costs spell points every minute aloft.',
  notes: { 3: 'No spell point drain.' },
});
spell('air', 11, 'starburst', 'Starburst', 30, 'damage', 'area', 'starburst', {
  dmg: D('air', 5, 0.7, 8), radius: 700,
  text: 'Stars fall from the heavens across the whole battlefield. Outdoors only.',
});

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

spell('water', 1, 'awaken', 'Awaken', 1, 'cure', 'party', 'wake_flash', {
  cures: ['asleep'],
  text: 'Wakes sleeping party members.',
});
spell('water', 2, 'poison_spray', 'Poison Spray', 2, 'damage', 'one', 'poison_cloud', {
  dmg: D('earth', 1, 0.34, 6), inflict: { condition: 'poisoned_weak', chance: 15 },
  text: 'A jet of venom. May poison the target.',
  notes: { 2: 'Three streams.', 3: 'Five streams.' },
});
spell('water', 3, 'protection_from_water', 'Protection from Water', 3, 'buff', 'party', 'buff_shimmer', {
  dur: DUR(60, 15), pow: POW(5, 1.5), resist: 'water',
  text: 'Adds cold resistance to the whole party.',
});
spell('water', 4, 'ice_bolt', 'Ice Bolt', 5, 'damage', 'one', 'ice_shard', {
  dmg: D('water', 3, 0.4, 6),
  text: 'A shard of ice.',
});
spell('water', 5, 'water_walk', 'Water Walk', 6, 'buff', 'party', 'water_ripple', {
  dur: DUR(60, 15),
  text: 'The party walks on water. Drains spell points while active.',
  notes: { 3: 'No spell point drain.' },
});
spell('water', 6, 'recharge_item', 'Recharge Item', 10, 'enchant', 'item', 'recharge_spark', {
  pow: POW(10, 2),
  text: 'Restores charges to a wand, at the cost of its maximum.',
});
spell('water', 7, 'acid_burst', 'Acid Burst', 12, 'damage', 'one', 'acid_splash', {
  dmg: D('earth', 0, 0, 1, 9, 9),
  text: 'A gout of acid. Nine damage per point of skill.',
});
spell('water', 8, 'enchant_item', 'Enchant Item', 15, 'enchant', 'item', 'enchant_glow', {
  text: 'Adds a random enchantment to a plain item. High skill risks less.',
  notes: { 3: 'Special enchantments become possible.' },
});
spell('water', 9, 'town_portal', 'Town Portal', 20, 'travel', 'party', 'portal_swirl', {
  text: 'Opens a gate to a town the party has visited.',
  notes: { 2: 'Three towns.', 3: 'Any town.' },
});
spell('water', 10, 'ice_blast', 'Ice Blast', 25, 'damage', 'area', 'ice_blast', {
  dmg: D('water', 5, 0.6, 8), radius: 400,
  text: 'A bursting sphere of ice.',
});
spell('water', 11, 'lloyds_beacon', "Lloyd's Beacon", 30, 'travel', 'party', 'beacon_light', {
  dur: DUR(1440, 720),
  text: 'Sets a beacon that the party may return to later.',
  notes: { 2: 'Three beacons.', 3: 'Five beacons, and they last much longer.' },
});

// ---------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------

spell('earth', 1, 'stun', 'Stun', 1, 'debuff', 'one', 'stun_ring', {
  dur: DUR(1, 0.2),
  text: 'Knocks a monster back and interrupts what it was doing.',
});
spell('earth', 2, 'slow', 'Slow', 3, 'debuff', 'one', 'slow_web', {
  dur: DUR(10, 3),
  text: 'Doubles a monster\'s recovery time.',
  notes: { 3: 'Affects every monster nearby.' },
});
spell('earth', 3, 'protection_from_earth', 'Protection from Earth', 3, 'buff', 'party', 'earth_shield', {
  dur: DUR(60, 15), pow: POW(5, 1.5), resist: 'earth',
  text: 'Adds poison resistance to the whole party.',
});
spell('earth', 4, 'deadly_swarm', 'Deadly Swarm', 5, 'damage', 'area', 'swarm', {
  dmg: D('earth', 3, 0.4, 5), radius: 300,
  text: 'A cloud of stinging insects.',
});
spell('earth', 5, 'stone_skin', 'Stone Skin', 6, 'buff', 'party', 'stone_skin', {
  dur: DUR(30, 6), pow: POW(5, 1),
  text: 'Hardens the party\'s skin, adding to Armour Class.',
});
spell('earth', 6, 'blades', 'Blades', 8, 'damage', 'one', 'blades', {
  dmg: D('physical', 0, 0, 1, 6, 6),
  text: 'Conjured blades tear at one target. Physical damage, so armour matters.',
});
spell('earth', 7, 'stone_to_flesh', 'Stone to Flesh', 12, 'cure', 'one', 'flesh_glow', {
  cures: ['stoned'],
  text: 'Returns a petrified character to flesh.',
});
spell('earth', 8, 'rock_blast', 'Rock Blast', 15, 'damage', 'area', 'rock_blast', {
  dmg: D('physical', 4, 0.5, 6), radius: 350,
  text: 'A shotgun blast of stone shards.',
});
spell('earth', 9, 'telekinesis', 'Telekinesis', 12, 'utility', 'point', 'telekinesis', {
  pow: POW(200, 50),
  text: 'Takes an item, opens a chest or pulls a lever at a distance.',
});
spell('earth', 10, 'death_blossom', 'Death Blossom', 25, 'damage', 'area', 'death_blossom', {
  dmg: D('earth', 6, 0.6, 6), radius: 500,
  text: 'A flowering explosion of earth. Outdoors only.',
});
spell('earth', 11, 'mass_distortion', 'Mass Distortion', 30, 'damage', 'one', 'mass_distortion', {
  dmg: D('magic', 0, 0, 1, 0, 0), fractionOfMaxHP: { base: 0.2, per: 0.02 },
  text: 'Crushes a monster under its own weight: damage is a share of its full health.',
});

// ---------------------------------------------------------------------------
// Spirit
// ---------------------------------------------------------------------------

spell('spirit', 1, 'detect_life', 'Detect Life', 1, 'utility', 'self', 'detect_pulse', {
  dur: DUR(30, 10),
  text: 'Shows the health of the monster under the cursor.',
});
spell('spirit', 2, 'bless', 'Bless', 2, 'buff', 'one', 'bless_ray', {
  dur: DUR(30, 5), pow: POW(3, 0.5),
  text: 'Adds to Attack and Armour Class.',
  notes: { 2: 'Affects the whole party.', 3: 'Lasts far longer.' },
});
spell('spirit', 3, 'fate', 'Fate', 3, 'buff', 'one', 'fate_rune', {
  dur: DUR(5, 1), pow: POW(10, 2),
  text: 'The next attack the target makes is far more likely to hit hard.',
});
spell('spirit', 4, 'turn_undead', 'Turn Undead', 5, 'debuff', 'area', 'turn_undead', {
  dur: DUR(3, 1), radius: 500,
  text: 'Undead nearby flee in terror.',
});
spell('spirit', 5, 'remove_curse', 'Remove Curse', 6, 'cure', 'one', 'curse_break', {
  cures: ['cursed', 'insane'],
  text: 'Lifts a curse, and clears a broken mind.',
  notes: { 2: 'Affects the whole party.' },
});
spell('spirit', 6, 'preservation', 'Preservation', 8, 'buff', 'one', 'preserve_glow', {
  dur: DUR(30, 10),
  text: 'A character who would be killed is knocked unconscious instead.',
  notes: { 2: 'Affects the whole party.' },
});
spell('spirit', 7, 'heroism', 'Heroism', 12, 'buff', 'party', 'heroism_aura', {
  dur: DUR(30, 6), pow: POW(5, 1),
  text: 'Adds to Attack and Damage for the whole party.',
});
spell('spirit', 8, 'spirit_lash', 'Spirit Lash', 15, 'damage', 'one', 'spirit_lash', {
  dmg: D('magic', 0, 0, 1, 8, 8),
  text: 'A whip of raw spirit. Eight damage per point of skill.',
});
spell('spirit', 9, 'raise_dead', 'Raise Dead', 20, 'cure', 'one', 'raise_glow', {
  cures: ['dead', 'unconscious'], leaves: 'weak',
  text: 'Returns a dead character to life, Weak and at one hit point.',
  notes: { 3: 'No weakness afterwards.' },
});
spell('spirit', 10, 'shared_life', 'Shared Life', 25, 'heal', 'party', 'shared_life', {
  pow: POW(10, 4),
  text: 'Pools the party\'s health and divides it evenly, adding some of its own.',
});
spell('spirit', 11, 'resurrection', 'Resurrection', 30, 'cure', 'one', 'resurrect_beam', {
  cures: ['dead', 'eradicated', 'unconscious', 'stoned'],
  text: 'Restores a character from death or eradication, whole.',
});

// ---------------------------------------------------------------------------
// Mind
// ---------------------------------------------------------------------------

spell('mind', 1, 'remove_fear', 'Remove Fear', 1, 'cure', 'one', 'calm_wave', {
  cures: ['afraid'], dur: DUR(30, 10),
  text: 'Steadies a frightened character, and wards off fear for a while.',
  notes: { 2: 'Affects the whole party.' },
});
spell('mind', 2, 'mind_blast', 'Mind Blast', 3, 'damage', 'one', 'mind_blast', {
  dmg: D('mind', 2, 0.34, 6),
  text: 'A stab of psychic force. Mindless creatures are immune.',
});
spell('mind', 3, 'precision', 'Precision', 4, 'buff', 'one', 'precision_glint', {
  dur: DUR(30, 6), pow: POW(5, 1),
  text: 'Sharpens the eye: a large bonus to Attack.',
  notes: { 2: 'Affects the whole party.' },
});
spell('mind', 4, 'cure_paralysis', 'Cure Paralysis', 5, 'cure', 'one', 'paralysis_break', {
  cures: ['paralyzed'],
  text: 'Frees a paralysed character.',
});
spell('mind', 5, 'charm', 'Charm', 6, 'debuff', 'one', 'charm_heart', {
  dur: DUR(5, 2),
  text: 'A monster stops attacking and wanders off.',
});
spell('mind', 6, 'mass_fear', 'Mass Fear', 10, 'debuff', 'area', 'fear_wave', {
  dur: DUR(3, 1), radius: 500,
  text: 'Every monster nearby flees.',
});
spell('mind', 7, 'feeblemind', 'Feeblemind', 12, 'debuff', 'one', 'feeblemind', {
  dur: DUR(10, 3),
  text: 'A monster forgets how to cast spells.',
});
spell('mind', 8, 'berserk', 'Berserk', 15, 'debuff', 'one', 'berserk_rage', {
  dur: DUR(5, 2),
  text: 'A monster turns on its own kind.',
  notes: { 3: 'Affects every monster nearby.' },
});
spell('mind', 9, 'enslave', 'Enslave', 20, 'debuff', 'one', 'enslave_chain', {
  dur: DUR(10, 5),
  text: 'A monster fights for the party until the spell breaks.',
});
spell('mind', 10, 'psychic_shock', 'Psychic Shock', 25, 'damage', 'one', 'psychic_shock', {
  dmg: D('mind', 0, 0, 1, 12, 12),
  text: 'Twelve damage per point of skill, straight to the mind.',
});
spell('mind', 11, 'telepathy', 'Telepathy', 20, 'utility', 'one', 'telepathy', {
  text: 'Reads a monster\'s mind: its health, its treasure and its intent.',
});

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

spell('body', 1, 'cure_weakness', 'Cure Weakness', 1, 'cure', 'one', 'heal_glow', {
  cures: ['weak', 'drunk'],
  text: 'Removes weakness.',
  notes: { 2: 'Affects the whole party.' },
});
spell('body', 2, 'first_aid', 'First Aid', 2, 'heal', 'one', 'first_aid', {
  pow: POW(5, 1), cures: ['unconscious'],
  text: 'Heals a small wound and rouses the unconscious.',
});
spell('body', 3, 'protection_from_magic', 'Protection from Magic', 4, 'buff', 'party', 'magic_ward', {
  dur: DUR(60, 15), pow: POW(5, 1.5), resist: 'magic',
  text: 'Wards the party against spells and against conditions.',
});
spell('body', 4, 'harm', 'Harm', 5, 'damage', 'one', 'harm_bolt', {
  dmg: D('body', 0, 0, 1, 6, 6),
  text: 'Inflicts a wound directly. Six damage per point of skill.',
});
spell('body', 5, 'regeneration', 'Regeneration', 6, 'buff', 'one', 'regen_glow', {
  dur: DUR(30, 6), pow: POW(1, 0.34),
  text: 'The target heals steadily for the duration.',
  notes: { 2: 'Affects the whole party.' },
});
spell('body', 6, 'cure_poison', 'Cure Poison', 8, 'cure', 'one', 'cure_poison', {
  cures: ['poisoned_weak', 'poisoned_severe', 'poisoned_deadly'],
  text: 'Purges poison of any strength.',
  notes: { 2: 'Affects the whole party.' },
});
spell('body', 7, 'hammerhands', 'Hammerhands', 10, 'buff', 'one', 'hammerhands', {
  dur: DUR(30, 6), pow: POW(3, 0.7),
  text: 'Fists become weapons: big bonuses to unarmed and melee damage.',
  notes: { 3: 'Affects the whole party.' },
});
spell('body', 8, 'cure_disease', 'Cure Disease', 12, 'cure', 'one', 'cure_disease', {
  cures: ['diseased_weak', 'diseased_severe', 'diseased_deadly'],
  text: 'Purges disease of any strength.',
  notes: { 2: 'Affects the whole party.' },
});
spell('body', 9, 'protection_from_body', 'Protection from Body', 15, 'buff', 'party', 'body_ward', {
  dur: DUR(60, 15), pow: POW(8, 2), resist: 'body',
  text: 'Wards the party against draining and wounding magic.',
});
spell('body', 10, 'flying_fist', 'Flying Fist', 20, 'damage', 'one', 'flying_fist', {
  dmg: D('body', 3, 0.5, 8, 5, 3),
  text: 'A fist of force hurled across the room.',
});
spell('body', 11, 'power_cure', 'Power Cure', 25, 'heal', 'party', 'power_cure', {
  pow: POW(10, 5), cures: ['weak', 'unconscious', 'poisoned_weak', 'poisoned_severe', 'diseased_weak', 'diseased_severe'],
  text: 'Heals every party member and clears most ills.',
});

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

spell('light', 1, 'light_bolt', 'Light Bolt', 3, 'damage', 'one', 'light_bolt', {
  dmg: D('light', 2, 0.4, 8),
  text: 'A lance of pure light. It passes through everything in its path.',
});
spell('light', 2, 'destroy_undead', 'Destroy Undead', 5, 'damage', 'one', 'destroy_undead', {
  dmg: D('light', 0, 0, 1, 10, 10), vsUndeadOnly: true,
  text: 'Unmakes an undead creature. Ten damage per point of skill; nothing else is harmed.',
});
spell('light', 3, 'dispel_magic', 'Dispel Magic', 8, 'utility', 'area', 'dispel_burst', {
  radius: 600,
  text: 'Strips every magical effect from everyone, friend and foe alike.',
});
spell('light', 4, 'paralyze', 'Paralyze', 10, 'debuff', 'one', 'paralyze_ray', {
  dur: DUR(3, 1),
  text: 'Freezes a monster where it stands.',
  notes: { 3: 'Affects every monster nearby.' },
});
spell('light', 5, 'summon_elemental', 'Summon Elemental', 12, 'summon', 'point', 'summon_circle', {
  dur: DUR(30, 10), pow: POW(1, 0.15),
  text: 'Calls an elemental servant to fight for the party.',
  notes: { 2: 'Two elementals.', 3: 'Three, and they are stronger.' },
});
spell('light', 6, 'day_of_the_gods', 'Day of the Gods', 15, 'buff', 'party', 'day_of_gods', {
  dur: DUR(60, 15), pow: POW(3, 0.4),
  text: 'Adds to every statistic of every party member.',
});
spell('light', 7, 'prismatic_light', 'Prismatic Light', 20, 'damage', 'area', 'prismatic', {
  dmg: D('light', 5, 0.6, 8), radius: 700,
  text: 'A blaze of coloured light that burns everything in the room. Indoors only.',
});
spell('light', 8, 'day_of_protection', 'Day of Protection', 25, 'buff', 'party', 'day_of_protection', {
  dur: DUR(60, 15), pow: POW(5, 1.5),
  text: 'Every resistance, plus Feather Fall and Wizard Eye, on the whole party.',
});
spell('light', 9, 'hour_of_power', 'Hour of Power', 30, 'buff', 'party', 'hour_of_power', {
  dur: DUR(30, 10), pow: POW(5, 1),
  text: 'Bless, Heroism, Shield, Stone Skin and Day of Protection at once.',
});
spell('light', 10, 'sunray', 'Sunray', 35, 'damage', 'area', 'sunray', {
  dmg: D('light', 0, 0, 1, 20, 20), radius: 600,
  text: 'A beam of daylight. Twenty damage per point of skill. Daytime, outdoors only.',
});
spell('light', 11, 'divine_intervention', 'Divine Intervention', 40, 'special', 'party', 'divine', {
  text: 'Fully heals the party and clears every condition. Ages the caster three years.',
});

// ---------------------------------------------------------------------------
// Dark
// ---------------------------------------------------------------------------

spell('dark', 1, 'reanimate', 'Reanimate', 5, 'summon', 'one', 'reanimate', {
  dur: DUR(10, 5), pow: POW(1, 0.2),
  text: 'Raises a corpse as a servant. It rots away when the spell ends.',
});
spell('dark', 2, 'toxic_cloud', 'Toxic Cloud', 8, 'damage', 'area', 'toxic_cloud', {
  dmg: D('dark', 3, 0.4, 6), radius: 350, inflict: { condition: 'poisoned_severe', chance: 20 },
  text: 'A rolling cloud of poison.',
});
spell('dark', 3, 'vampiric_weapon', 'Vampiric Weapon', 10, 'enchant', 'item', 'vampiric_glow', {
  dur: DUR(60, 15), pow: POW(2, 0.4),
  text: 'A weapon drinks the life of what it strikes and gives it to the wielder.',
});
spell('dark', 4, 'shrapmetal', 'Shrapmetal', 12, 'damage', 'one', 'shrapmetal', {
  dmg: D('physical', 1, 0.15, 6), bolts: { base: 3, per: 0.34 },
  text: 'A cone of razor fragments. More pieces at higher skill.',
});
spell('dark', 5, 'shrinking_ray', 'Shrinking Ray', 15, 'debuff', 'one', 'shrink_ray', {
  dur: DUR(10, 3), pow: POW(25, 3),
  text: 'Shrinks a monster; it hits for far less.',
});
spell('dark', 6, 'control_undead', 'Control Undead', 18, 'debuff', 'one', 'control_undead', {
  dur: DUR(10, 5),
  text: 'An undead creature obeys the caster.',
});
spell('dark', 7, 'pain_reflection', 'Pain Reflection', 20, 'buff', 'party', 'pain_reflection', {
  dur: DUR(30, 6), pow: POW(0.3, 0.03),
  text: 'A share of every wound the party takes is dealt back to the attacker.',
});
spell('dark', 8, 'sacrifice', 'Sacrifice', 25, 'special', 'one', 'sacrifice_glow', {
  text: 'Kills one party member outright to fully restore the rest.',
});
spell('dark', 9, 'dragon_breath', 'Dragon Breath', 30, 'damage', 'area', 'dragon_breath', {
  dmg: D('fire', 6, 0.7, 8), radius: 500,
  text: 'A cone of dragon fire.',
});
spell('dark', 10, 'armageddon', 'Armageddon', 40, 'damage', 'world', 'armageddon', {
  dmg: D('physical', 0, 0, 1, 50, 15),
  text: 'Damages every creature on the map, the party included. Outdoors only, and only a few times a day.',
});
spell('dark', 11, 'souldrinker', 'Souldrinker', 35, 'damage', 'area', 'souldrinker', {
  dmg: D('dark', 0, 0, 1, 0, 10), radius: 700, drain: true,
  text: 'Drains life from everything in sight and heals the party with it.',
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

export const SPELLS = ALL;
const BY_ID = new Map(ALL.map((s) => [s.id, s]));

export const SPELLS_BY_SCHOOL = SCHOOL_IDS.reduce((o, id) => {
  o[id] = ALL.filter((s) => s.school === id).sort((a, b) => a.tier - b.tier);
  return o;
}, {});

export function spellById(id) { return BY_ID.get(id) || null; }

/** Spell at a given school+tier, i.e. the book's row/column. */
export function spellAt(school, tier) {
  const list = SPELLS_BY_SCHOOL[school];
  return list ? list[tier - 1] || null : null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function masteryMul(mastery) {
  return MASTERY_POWER[Math.max(0, Math.min(3, mastery | 0))] || 1;
}

/**
 * Roll a spell's damage. Returns { amount, element, hits } where `hits` is the
 * number of separate projectiles (Sparks, Shrapmetal) the caller should
 * distribute. `target` is optional and only used by fraction-of-health spells.
 */
export function spellDamage(spell, skillValue, mastery, rand, target) {
  if (!spell) return { amount: 0, element: 'physical', hits: 1 };
  const skill = Math.max(0, skillValue | 0);
  const mul = masteryMul(mastery) * SPELL_POWER;

  if (spell.fractionOfMaxHP && target) {
    const frac = Math.min(0.9, spell.fractionOfMaxHP.base + spell.fractionOfMaxHP.per * skill);
    const hp = target.maxHP || target.hp || 0;
    return { amount: Math.max(1, Math.round(hp * frac * mul)), element: 'magic', hits: 1 };
  }
  const d = spell.dmg;
  if (!d) return { amount: 0, element: 'physical', hits: 1 };

  const n = Math.max(0, d.n0 + Math.floor(d.nPer * skill));
  let amount = 0;
  if (n > 0) amount += rand.dice(n, d.s);
  amount += d.flat + d.flatPer * skill;
  amount = Math.max(1, Math.round(amount * mul));

  let hits = 1;
  if (spell.bolts) hits = Math.max(1, Math.round(spell.bolts.base + spell.bolts.per * skill));
  return { amount, element: d.element, hits };
}

/** Average damage, without rolling. Used by the AI and the balance harness. */
export function spellDamageAvg(spell, skillValue, mastery, target) {
  if (!spell) return 0;
  const skill = Math.max(0, skillValue | 0);
  const mul = masteryMul(mastery) * SPELL_POWER;
  if (spell.fractionOfMaxHP && target) {
    const frac = Math.min(0.9, spell.fractionOfMaxHP.base + spell.fractionOfMaxHP.per * skill);
    return Math.round((target.maxHP || target.hp || 0) * frac * mul);
  }
  const d = spell.dmg;
  if (!d) return 0;
  const n = Math.max(0, d.n0 + Math.floor(d.nPer * skill));
  const avg = n * (d.s + 1) / 2 + d.flat + d.flatPer * skill;
  const hits = spell.bolts ? Math.max(1, Math.round(spell.bolts.base + spell.bolts.per * skill)) : 1;
  return Math.max(1, Math.round(avg * mul)) * hits;
}

/** Duration in game minutes. Master rank stretches everything by half again. */
export function spellDuration(spell, skillValue, mastery) {
  if (!spell || !spell.dur) return 0;
  const skill = Math.max(0, skillValue | 0);
  const m = Math.max(1, mastery | 0);
  const stretch = m >= MASTERY.MASTER ? 1.5 : m >= MASTERY.EXPERT ? 1.2 : 1;
  return Math.round((spell.dur.base + spell.dur.per * skill) * stretch);
}

/** Buff strength / heal amount. */
export function spellPower(spell, skillValue, mastery) {
  if (!spell || !spell.pow) return 0;
  const skill = Math.max(0, skillValue | 0);
  return Math.max(1, Math.round((spell.pow.base + spell.pow.per * skill) * masteryMul(mastery)));
}

/** Radius in world units; higher mastery widens area spells. */
export function spellRadius(spell, mastery) {
  if (!spell || !spell.radius) return 0;
  const m = Math.max(1, mastery | 0);
  return Math.round(spell.radius * (m >= MASTERY.MASTER ? 1.5 : m >= MASTERY.EXPERT ? 1.25 : 1));
}

/** A character's { level, mastery } in the spell's school. */
export function schoolSkill(character, school) {
  const s = (character.skills && character.skills[school]) || null;
  return { level: s ? s.level | 0 : 0, mastery: s ? s.mastery | 0 : MASTERY.NONE };
}

/**
 * Spell point cost for this caster. High mastery makes the school's early
 * spells cheap - the reason a High Priest can spam First Aid all day.
 */
export function spCostFor(character, spell) {
  if (!spell) return 0;
  const { mastery } = schoolSkill(character, spell.school);
  let cost = spell.sp;
  // Every rank above the one that unlocked the spell knocks a fifth off.
  const unlockRank = spell.tier <= 4 ? MASTERY.NORMAL : spell.tier <= 7 ? MASTERY.EXPERT : MASTERY.MASTER;
  const over = Math.max(0, (mastery | 0) - unlockRank);
  cost = Math.ceil(cost * (1 - 0.2 * over));
  if (character.buffs && character.buffs.hour_of_power) cost = Math.ceil(cost * 0.75);
  return Math.max(1, cost);
}

/**
 * May this character cast this spell right now?
 * Returns { ok, reason } so the UI can say why not.
 */
export function canCast(character, spell) {
  if (!spell) return { ok: false, reason: 'No such spell.' };
  const klass = CLASSES[character.class];
  if (!klass) return { ok: false, reason: 'Unknown class.' };
  if (classSkillMax(character.class, spell.school) <= 0) {
    return { ok: false, reason: `A ${klass.name} cannot learn ${spell.school} magic.` };
  }
  const { level, mastery } = schoolSkill(character, spell.school);
  if (level <= 0 || mastery <= 0) return { ok: false, reason: `You have no skill in ${spell.school} magic.` };
  if (!(character.spells && character.spells.indexOf(spell.id) >= 0)) {
    return { ok: false, reason: 'That spell is not in your book.' };
  }
  const maxTier = SCHOOL_TIER_LIMIT[mastery] || 0;
  if (spell.tier > maxTier) {
    const need = spell.tier <= 7 ? 'Expert' : 'Master';
    return { ok: false, reason: `${need} rank is required to cast ${spell.name}.` };
  }
  const cost = spCostFor(character, spell);
  if ((character.sp | 0) < cost) return { ok: false, reason: 'Not enough spell points.' };
  const conds = character.conditions || {};
  if (conds.dead || conds.eradicated || conds.stoned || conds.unconscious || conds.paralyzed || conds.asleep || conds.insane) {
    return { ok: false, reason: 'You are in no condition to cast.' };
  }
  if (conds.feebleminded) return { ok: false, reason: 'Your mind is clouded.' };
  return { ok: true, reason: '', cost };
}

/** Spells of a school a character of this class/mastery could learn. */
export function learnableSpells(character, school) {
  const { mastery } = schoolSkill(character, school);
  const maxTier = SCHOOL_TIER_LIMIT[mastery] || 0;
  return (SPELLS_BY_SCHOOL[school] || []).filter((s) => s.tier <= maxTier);
}

/** Gold a guild charges to teach a spell: steeply tiered, as in MM6. */
export function spellPrice(spell) {
  const t = spell.tier;
  return [0, 100, 200, 400, 800, 1500, 3000, 5000, 8000, 12000, 18000, 25000][t] || 100;
}

/** Description for the spell book page. */
export function spellDescription(spell, character) {
  if (!spell) return '';
  const parts = [spell.name, `(${spell.school}, ${spell.sp} SP)`, spell.text];
  if (character) {
    const { level, mastery } = schoolSkill(character, spell.school);
    const mo = masteryOf(level, mastery);
    if (spell.dmg) parts.push(`About ${spellDamageAvg(spell, level, mastery)} damage at ${mo.label}.`);
    if (spell.dur) parts.push(`Lasts ${spellDuration(spell, level, mastery)} minutes.`);
  }
  return parts.join(' ');
}

/** Sanity check used by the test harness. */
export function validateSpells() {
  const problems = [];
  if (ALL.length !== 99) problems.push(`expected 99 spells, found ${ALL.length}`);
  for (const s of ALL) {
    if (!VFX_SET.has(s.vfx)) problems.push(`${s.id}: unknown vfx "${s.vfx}"`);
    if (!SCHOOL_IDS.includes(s.school)) problems.push(`${s.id}: bad school`);
    if (s.tier < 1 || s.tier > 11) problems.push(`${s.id}: bad tier ${s.tier}`);
    if (!(s.sp > 0)) problems.push(`${s.id}: bad sp cost`);
  }
  for (const school of SCHOOL_IDS) {
    const list = SPELLS_BY_SCHOOL[school];
    if (list.length !== 11) problems.push(`${school}: ${list.length} spells, expected 11`);
    list.forEach((s, i) => { if (s.tier !== i + 1) problems.push(`${school}: tier gap at ${s.id}`); });
  }
  return problems;
}
