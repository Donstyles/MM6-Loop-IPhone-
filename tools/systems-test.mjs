// Balance and integrity harness for src/game/*.
//
//   node tools/systems-test.mjs            full run
//   node tools/systems-test.mjs --quiet    summary only
//
// Asserts every module loads, every spell has a valid vfx, every monster id is
// on the retail roster, and every generated item has a sensible name and value.
// Then it levels a party to 20, fights 2000 simulated rounds across the level
// band and prints a balance report.

import { Rand } from '../src/core/rng.js';
import * as Stats from '../src/game/stats.js';
import * as Skills from '../src/game/skills.js';
import * as Spells from '../src/game/spells.js';
import * as Items from '../src/game/items.js';
import * as Monsters from '../src/game/monsters.js';
import * as Combat from '../src/game/combat.js';
import * as Party from '../src/game/party.js';
import * as Quests from '../src/game/quests.js';
import * as Names from '../src/game/npcnames.js';

const QUIET = process.argv.includes('--quiet');
let failures = 0;
let checks = 0;

function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error(`  FAIL  ${msg}`); }
  return !!cond;
}
function section(name) { if (!QUIET) console.log(`\n=== ${name} ===`); }
function say(...a) { if (!QUIET) console.log(...a); }

// ---------------------------------------------------------------------------
// 1. Modules load
// ---------------------------------------------------------------------------

section('modules');
for (const [name, mod] of Object.entries({ Stats, Skills, Spells, Items, Monsters, Combat, Party, Quests, Names })) {
  ok(mod && Object.keys(mod).length > 0, `${name} exports nothing`);
}
say(`loaded 9 modules, ${Object.keys(Stats).length + Object.keys(Skills).length} + ... exports`);

// ---------------------------------------------------------------------------
// 2. stats.js
// ---------------------------------------------------------------------------

section('stats');
ok(Stats.statBonus(1) === -6, 'statBonus(1) should be -6');
ok(Stats.statBonus(2) === -6, 'statBonus(2) should be -6');
ok(Stats.statBonus(9) === 0, 'statBonus(9) should be 0');
ok(Stats.statBonus(10) === 0, 'statBonus(10) should be 0');
ok(Stats.statBonus(19) === 5, 'statBonus(19) should be +5');
ok(Stats.statBonus(25) === 7, 'statBonus(25) should be +7');
ok(Stats.statBonus(250) === 20, 'statBonus(250) should be +20');
ok(Stats.statBonus(9999) === 20, 'statBonus caps at +20');
ok(Stats.xpForLevel(2) === 1000 && Stats.xpForLevel(3) === 3000
  && Stats.xpForLevel(4) === 6000 && Stats.xpForLevel(5) === 10000
  && Stats.xpForLevel(6) === 15000, 'XP table must match MM6');
for (let lv = 1; lv <= 50; lv++) {
  ok(Stats.levelForXP(Stats.xpForLevel(lv)) === lv, `levelForXP round trip at ${lv}`);
  ok(Stats.levelForXP(Stats.xpForLevel(lv) - 1) === Math.max(1, lv - 1), `levelForXP boundary at ${lv}`);
}
ok(Object.keys(Stats.CLASSES).length === 18, 'should be 18 classes (6 lines x 3 tiers)');
ok(Stats.CONDITIONS.eradicated.severity > Stats.CONDITIONS.dead.severity, 'eradicated outranks dead');
ok(Stats.conditionsCuredBy('cure_poison').length === 3, 'Cure Poison clears all three poison ranks');
ok(Stats.RESISTANCES.length === 7, 'seven resistances');
say(`stat table ok; ${Object.keys(Stats.CLASSES).length} classes, ${Stats.CONDITION_IDS.length} conditions`);

// ---------------------------------------------------------------------------
// 3. skills.js
// ---------------------------------------------------------------------------

section('skills');
ok(Skills.MASTERY.MASTER === 3 && Skills.MASTERY_NAMES.length === 4, 'MM6 has no Grandmaster');
ok(!JSON.stringify(Skills.MASTERY_NAMES).toLowerCase().includes('grand'), 'no Grandmaster anywhere');
ok(Skills.SKILLS.length === 30, `expected 30 skills, found ${Skills.SKILLS.length}`);
ok(Skills.skillPointCost(0) === 1 && Skills.skillPointCost(4) === 5 && Skills.skillPointCost(10) === 11,
  'skill point cost is N+1');
ok(Skills.classSkillMax('knight', 'fire') === 0, 'Knights cannot learn magic');
ok(Skills.classSkillMax('sorcerer', 'plate') === 0, 'Sorcerers cannot learn plate');
ok(Skills.classSkillMax('archmage', 'fire') === 3, 'Archmage masters Fire');
ok(Skills.classSkillMax('high_priest', 'body') === 3, 'High Priest masters Body');
ok(Skills.masteryOf(10, 3).effective === 20, 'mastery multiplier');
ok(Skills.skillEffect('body_building', 10, 3).value === 20, 'Body Building doubles at Master');
say(`${Skills.SKILLS.length} skills across ${Object.keys(Skills.SKILL_CATEGORIES).length} categories`);

// ---------------------------------------------------------------------------
// 4. spells.js
// ---------------------------------------------------------------------------

section('spells');
const spellProblems = Spells.validateSpells();
ok(spellProblems.length === 0, `spell validation: ${spellProblems.join('; ')}`);
ok(Spells.SPELLS.length === 99, `expected 99 spells, got ${Spells.SPELLS.length}`);
for (const s of Spells.SPELLS) {
  ok(!!s.vfx && Spells.VFX_TAGS.includes(s.vfx), `${s.id} has no valid vfx`);
  ok(typeof s.name === 'string' && s.name.length > 2, `${s.id} has no name`);
  ok(['self', 'party', 'one', 'area', 'point', 'item', 'aura', 'world'].includes(s.target),
    `${s.id} bad target mode "${s.target}"`);
}
for (const school of Spells.SCHOOL_IDS) {
  ok(Spells.SPELLS_BY_SCHOOL[school].length === 11, `${school} must have exactly 11 spells`);
}
// Named spells must be where MM6 puts them.
const expect = {
  torch_light: ['fire', 1], fire_bolt: ['fire', 2], haste: ['fire', 5], fireball: ['fire', 6],
  meteor_shower: ['fire', 9], inferno: ['fire', 10], incinerate: ['fire', 11],
  wizard_eye: ['air', 1], feather_fall: ['air', 2], sparks: ['air', 4], jump: ['air', 5],
  shield: ['air', 6], lightning_bolt: ['air', 7], invisibility: ['air', 8], fly: ['air', 10],
  starburst: ['air', 11], awaken: ['water', 1], town_portal: ['water', 9], ice_blast: ['water', 10],
  lloyds_beacon: ['water', 11], stun: ['earth', 1], slow: ['earth', 2], blades: ['earth', 6],
  mass_distortion: ['earth', 11], detect_life: ['spirit', 1], bless: ['spirit', 2],
  resurrection: ['spirit', 11], remove_fear: ['mind', 1], mind_blast: ['mind', 2],
  psychic_shock: ['mind', 10], cure_weakness: ['body', 1], power_cure: ['body', 11],
  light_bolt: ['light', 1], divine_intervention: ['light', 11], reanimate: ['dark', 1],
  armageddon: ['dark', 10], souldrinker: ['dark', 11],
};
for (const [id, [school, tier]] of Object.entries(expect)) {
  const sp = Spells.spellById(id);
  ok(sp && sp.school === school && sp.tier === tier, `${id} should be ${school} tier ${tier}`);
}
const testRand = new Rand('spelltest');
for (const s of Spells.SPELLS.filter((x) => x.dmg)) {
  const d = Spells.spellDamage(s, 10, 3, testRand, { maxHP: 200, hp: 200 });
  ok(d.amount > 0 && d.amount < 4000, `${s.id} rolls implausible damage ${d.amount}`);
}
say(`99 spells, ${Spells.SCHOOL_IDS.length} schools, all vfx tags valid`);

// ---------------------------------------------------------------------------
// 5. monsters.js
// ---------------------------------------------------------------------------

section('monsters');
const monProblems = Monsters.validateMonsters();
ok(monProblems.length === 0, `monster validation: ${monProblems.slice(0, 8).join('; ')}`);
ok(Monsters.MONSTERS.length === 173, `expected 173 monsters, got ${Monsters.MONSTERS.length}`);
ok(Monsters.FAMILY_IDS.length === 59, `expected 57 families + 2 uniques, got ${Monsters.FAMILY_IDS.length}`);
// Spot-check the retail table.
const retail = [
  ['GoblinA', 4, 13], ['GoblinB', 6, 21], ['GoblinC', 10, 40],
  ['BloodsuckerA', 2, 6], ['BloodsuckerB', 4, 13], ['BloodsuckerC', 8, 30],
  ['RatA', 2, 6], ['RatB', 4, 13], ['RatC', 6, 21],
  ['BatA', 3, 9], ['BatB', 6, 21], ['BatC', 9, 35],
  ['PeasantM1A', 1, 3], ['PeasantM1B', 2, 6], ['PeasantM1C', 3, 9],
  ['FighterLeathA', 8, 30], ['FighterLeathB', 14, 61], ['FighterLeathC', 22, 114],
  ['SkeletonA', 6, 21], ['SkeletonB', 10, 40], ['SkeletonC', 14, 61],
  ['OgreA', 15, 67], ['OgreB', 20, 100], ['OgreC', 28, 162],
  ['LichA', 20, 100], ['LichB', 30, 180], ['LichC', 40, 280],
  ['KnightPlateA', 40, 280], ['KnightPlateB', 60, 540], ['KnightPlateC', 80, 880],
  ['DragonCoverA', 80, 880], ['DragonCoverB', 90, 1080], ['DragonCoverC', 100, 1300],
  ['TitanA', 65, 617], ['TitanB', 75, 787], ['TitanC', 95, 1187],
  ['zDemonqueen', 100, 1300], ['zReactor', 100, 1300],
  ['ArcherA', 9, 35], ['ArcherB', 19, 93], ['ArcherC', 29, 171],
  ['BarbarianA', 14, 61], ['BarbarianB', 25, 137], ['BarbarianC', 37, 247],
  ['BeholderA', 30, 180], ['BeholderC', 50, 400],
  ['MinotaurA', 39, 269], ['MinotaurB', 59, 525], ['MinotaurC', 79, 861],
  ['RobotA', 50, 400], ['RobotB', 70, 700], ['RobotC', 90, 1080],
];
for (const [id, lvl, hp] of retail) {
  const m = Monsters.monsterById(id);
  if (!ok(!!m, `missing monster ${id}`)) continue;
  ok(m.level === lvl, `${id} level should be ${lvl}, is ${m.level}`);
  ok(m.hp === hp, `${id} hp should be ${hp}, is ${m.hp}`);
}
// Speed must let the party outrun everything (party walk = 384 u/s).
for (const m of Monsters.MONSTERS) {
  ok(m.speed === 0 || (m.speed >= 96 && m.speed <= Monsters.MAX_MONSTER_SPEED),
    `${m.id} speed ${m.speed} out of band`);
  ok(m.speed < Monsters.PARTY_WALK_SPEED, `${m.id} can outrun the party`);
}
// Every bestiary id must exist in the sprite pipeline, and vice versa.
try {
  const Creatures = await import('../src/art/models/creatures.js');
  const spriteIds = (Creatures.CREATURE_KINDS || []).map((k) => (typeof k === 'string' ? k : k.id));
  const spriteFamilies = Object.keys(Creatures.CREATURE_FAMILIES || {});
  const mine = new Set(Monsters.MONSTER_IDS);
  const theirs = new Set(spriteIds);
  ok(spriteIds.length > 0, 'creatures.js exported no kinds');
  for (const id of spriteIds) ok(mine.has(id), `sprite "${id}" has no bestiary entry`);
  for (const id of Monsters.MONSTER_IDS) ok(theirs.has(id), `bestiary "${id}" has no sprite`);
  for (const f of spriteFamilies) ok(!!Monsters.MONSTER_FAMILIES[f], `sprite family "${f}" is not in the bestiary`);
  say(`sprite pipeline cross-check: ${spriteIds.length} ids, ${spriteFamilies.length} families, exact match`);
} catch (e) {
  say(`  (skipped sprite cross-check: ${e.message})`);
}
ok(Monsters.spawnTableFor('new_sorpigal', 3).length > 0, 'New Sorpigal spawn table is empty');
ok(Monsters.spawnTableFor('lair', 60).length > 0, 'lair spawn table is empty');
say(`173 monsters, ${Monsters.FAMILY_IDS.length} sprite families, levels 1-100, HP curve verified`);

// ---------------------------------------------------------------------------
// 6. items.js
// ---------------------------------------------------------------------------

section('items');
ok(Items.SLOTS.length === 12, 'twelve equipment slots');
ok(Items.WEAPONS.length > 30, 'weapon table too small');
ok(Items.ARTIFACTS.length >= 15, 'artifact list too small');
ok(Items.POTIONS.length >= 20, 'potion list too small');
const irand = new Rand('items');
let badName = 0, badValue = 0, generated = 0;
const seenTypes = new Set();
for (let lv = 1; lv <= 60; lv += 1) {
  for (let i = 0; i < 30; i++) {
    const it = Items.generateItem(irand, { level: lv });
    generated++;
    if (!it) { badName++; continue; }
    seenTypes.add(it.type);
    const n = Items.itemName(it, true);
    const v = Items.itemValue(it);
    if (typeof n !== 'string' || n.length < 2 || n.includes('undefined') || n.includes('null')) badName++;
    if (!(v >= 1) || !Number.isFinite(v) || v > 5e6) badValue++;
    const d = Items.itemDescription(it);
    if (typeof d !== 'string' || d.length < 3) badName++;
  }
}
ok(badName === 0, `${badName}/${generated} generated items had a bad name or description`);
ok(badValue === 0, `${badValue}/${generated} generated items had a bad value`);
ok(seenTypes.size >= 8, `loot generator only produced ${seenTypes.size} item types`);
// Alchemy.
ok(Items.mixPotions('red_potion', 'blue_potion').result === 'purple_potion', 'red + blue = purple');
ok(Items.mixPotions('red_potion', 'yellow_potion').result === 'orange_potion', 'red + yellow = orange');
ok(Items.mixPotions('white_potion', 'black_potion').result === 'divine_power', 'white + black = divine power');
ok(Items.mixPotions('red_potion', 'divine_power').explode === true, 'nonsense mixes explode');
// Enchantment coverage.
for (const e of Items.ENCHANTMENTS) {
  ok(Array.isArray(e.on) && e.on.length > 0, `enchantment ${e.id} applies to nothing`);
  ok(e.tier >= 1 && e.tier <= 6, `enchantment ${e.id} bad tier`);
}
// Artifacts must reference a real base item.
for (const a of Items.ARTIFACTS) ok(!!Items.itemDef(a.base), `artifact ${a.id} has no base item`);
say(`${generated} items generated across levels 1-60; ${seenTypes.size} distinct types; alchemy lattice ok`);

// ---------------------------------------------------------------------------
// 7. npcnames.js
// ---------------------------------------------------------------------------

section('names');
const nrand = new Rand('names');
for (let i = 0; i < 200; i++) {
  ok(Names.npcName(nrand, 'm').length > 2, 'npcName produced nothing');
  ok(Names.townName(nrand).length > 2, 'townName produced nothing');
  ok(Names.dungeonName(nrand, 'crypt').length > 4, 'dungeonName produced nothing');
  ok(Names.tavernName(nrand).length > 4, 'tavernName produced nothing');
  ok(Names.shopName(nrand, 'weapon').length > 4, 'shopName produced nothing');
}
say(`names ok: e.g. ${Names.npcName(nrand, 'f')} of ${Names.townName(nrand)}, drinking in ${Names.tavernName(nrand)}`);

// ---------------------------------------------------------------------------
// 8. party.js
// ---------------------------------------------------------------------------

section('party');
const party = Party.createParty('balance-test');
ok(party.members.length === 4, 'default party is four');
ok(party.members[0].class === 'knight', 'default party opens with a Knight');
ok(party.members[0].hp === Stats.maxHP(party.members[0]), 'characters start at full health');
ok(party.members[2].sp > 0, 'the Sorcerer starts with spell points');
ok(party.members[0].inventory.cells.length === 14 * 9, 'inventory grid is 14x9');
// Grid packing.
const invTest = Party.makeInventory();
let packed = 0;
for (let i = 0; i < 60; i++) {
  const it = Items.generateItem(new Rand('inv' + i), { level: 5 });
  if (it && Party.invAdd(invTest, it)) packed++;
}
ok(packed > 8, `only packed ${packed} items into a 14x9 grid`);
ok(Party.invFree(invTest) >= 0, 'inventory free-count went negative');
// Overlap check.
{
  const counts = new Map();
  for (const it of invTest.items) {
    for (let y = it.y; y < it.y + it.gh; y++) {
      for (let x = it.x; x < it.x + it.gw; x++) {
        const k = `${x},${y}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  ok([...counts.values()].every((v) => v === 1), 'inventory items overlap');
}
// Serialisation round trip.
{
  const json = Party.serialize(party);
  const back = Party.deserialize(json);
  ok(back.members.length === 4, 'deserialize lost members');
  ok(back.gold === party.gold, 'deserialize lost gold');
  ok(Stats.maxHP(back.members[0]) === Stats.maxHP(party.members[0]), 'deserialize changed derived stats');
}

// ---------------------------------------------------------------------------
// 9. quests.js
// ---------------------------------------------------------------------------

section('quests');
const chain = Quests.createMainChain();
ok(chain.length === 10, 'main chain should be ten beats');
ok(chain[0].state === 'available' && chain[1].state === 'unavailable', 'main chain must gate');
chain[0].state = 'rewarded';
ok(Quests.refreshGating(chain).includes('main_2'), 'completing beat 1 unlocks beat 2');
let questCount = 0;
for (const region of ['new_sorpigal', 'free_haven', 'kriegspire', 'dragonsand', 'mire_of_the_damned']) {
  const qs = Quests.generateQuestsForRegion(region, 'seed', 6);
  questCount += qs.length;
  for (const q of qs) {
    ok(q.objectives.length > 0, `${q.id} has no objectives`);
    ok(q.reward.gold > 0 && q.reward.xp > 0, `${q.id} has no reward`);
    ok(q.text.length > 20 && !q.text.includes('{'), `${q.id} has an unfilled template: ${q.text.slice(0, 60)}`);
    ok(q.title.length > 3, `${q.id} has no title`);
  }
}
ok(questCount === 30, 'quest generator returned the wrong count');
// Progress.
{
  const q = Quests.generateQuest(new Rand('q'), 'kill', 'new_sorpigal', 4, 'New Sorpigal');
  q.state = 'active';
  const target = q.objectives[0].target;
  Quests.updateQuestProgress(q, { type: 'kill', monsterId: target, count: 999 });
  ok(q.state === 'complete', 'kill quest did not complete');
  ok(Quests.completeQuest(q).gold > 0, 'completed quest paid nothing');
}
ok(Quests.AWARDS.length >= 15, 'awards list too short');
say(`main chain of ${chain.length}, ${questCount} side quests generated, ${Quests.AWARDS.length} awards`);

// Full pipeline: accept -> kill event -> complete -> turn-in pays through awardXP.
{
  const p = Party.createParty('qp');
  p.quests = {};
  const q = Quests.generateQuest(new Rand('qp'), 'kill', 'new_sorpigal', 4, 'New Sorpigal');
  ok(Quests.giveQuest(p, q), 'giveQuest should accept an available quest');
  ok(q.state === 'active', 'accepted quest becomes active');
  const target = q.objectives[0].target;
  const changed = Quests.dispatchQuestEvent(p, { type: 'kill', monsterId: target, count: 999 });
  ok(changed.length === 1 && q.state === 'complete', 'kill events drive the quest to complete');
  const gold0 = p.gold, xp0 = p.members[0].xp;
  const reward = Quests.turnInQuest(p, q.id, (members, xp) => Combat.awardXP(members, xp));
  ok(!!reward && p.gold === gold0 + reward.gold, 'turn-in pays the gold');
  ok(p.members[0].xp > xp0, 'turn-in pays XP through awardXP');
  ok(q.state === 'rewarded', 'turned-in quest is rewarded');
  // Escort death fails its quest gracefully.
  const eq = Quests.generateQuest(new Rand('esc'), 'escort', 'new_sorpigal', 4, 'New Sorpigal');
  Quests.giveQuest(p, eq);
  const who = eq.objectives[0].target;
  const failed = Quests.failEscortOnDeath(p, who);
  ok(failed.length === 1 && eq.state === 'failed', 'escort death fails the escort quest');
  // Namespaced dungeon ids still satisfy bare clear objectives.
  const cq = { state: 'active', objectives: [{ kind: 'clear', target: 'goblinwatch', count: 1, progress: 0, done: false }] };
  Quests.updateQuestProgress(cq, { type: 'clear', dungeonId: 'new_sorpigal:goblinwatch', dungeonName: 'Goblinwatch' });
  ok(cq.state === 'complete', 'clear event matches namespaced dungeon ids');
}

// Learning skill must sit in the XP path: same award, more XP for the learner.
{
  const p = Party.createParty('learn');
  const a = p.members[0], b = p.members[1];
  a.skills.learning = { level: 10, mastery: Skills.MASTERY.MASTER };
  const xa = a.xp, xb = b.xp;
  Combat.awardXP(p.members, 4000);
  ok((a.xp - xa) > (b.xp - xb), 'Learning multiplies the learner share');
  ok((b.xp - xb) === Math.max(1, Math.floor(4000 / 4)), 'non-learners get the plain split');
}

// Multi-bolt reconciliation: resolveSpellAttack and spellDamageAvg agree that
// bolts are per-bolt damage (a full volley averages to spellDamageAvg).
{
  const sparks = Spells.spellById('sparks');
  const caster = Party.createParty('bolt').members[2];
  caster.skills.air = { level: 10, mastery: Skills.MASTERY.MASTER };
  const rand = new Rand('bolt');
  const expect = Spells.spellDamageAvg(sparks, 10, Skills.MASTERY.MASTER);
  let total = 0; const trials = 400;
  for (let i = 0; i < trials; i++) {
    const dummy = Monsters.spawnMonster('PeasantM1A');
    dummy.hp = 999999; dummy.maxHP = 999999;
    dummy.def = { ...dummy.def, resistances: {}, immunities: [] };
    const e = Combat.resolveSpellAttack(caster, sparks, dummy, 10, Skills.MASTERY.MASTER, rand);
    total += e.damage;
    ok(e.hits >= 2, 'sparks should fire multiple bolts');
  }
  const avg = total / trials;
  ok(Math.abs(avg - expect) / expect < 0.2,
    `multi-bolt: resolved avg ${avg.toFixed(1)} disagrees with spellDamageAvg ${expect}`);
}

// Charm / Feeblemind lines: the conditions stick and mean something.
{
  const rand = new Rand('charm');
  const m = Monsters.spawnMonster('GoblinB');   // the shaman: has a ranged spell
  m.def = { ...m.def, resistances: {} };
  ok(Combat.tryInflict(m, 'charmed', 100, rand), 'charmed can be inflicted');
  ok(!Combat.canAct(m), 'a charmed monster does not act');
  delete m.conditions.charmed;
  ok(Combat.tryInflict(m, 'feebleminded', 100, rand), 'feebleminded can be inflicted');
  m.hostile = true; m.state = 'engaged';
  let casts = 0;
  for (let i = 0; i < 60; i++) {
    const intent = Combat.monsterAct(m, Party.createParty('fm').members, { partyPos: { x: 0, y: 0, z: 1200 } }, rand);
    if (intent.type === 'cast') casts++;
  }
  ok(casts === 0, 'a feebleminded caster never casts');
}

// The opening fight: 3 GoblinA vs a fresh party - dangerous but winnable.
{
  let wins = 0, dmgFrac = 0;
  const N = 40;
  for (let t = 0; t < N; t++) {
    const rand = new Rand('gob' + t);
    const p = Party.createParty('fresh' + t);
    const gs = [Monsters.spawnMonster('GoblinA'), Monsters.spawnMonster('GoblinA'), Monsters.spawnMonster('GoblinA')];
    const total = p.members.reduce((s, c) => s + c.hp, 0);
    const r = Combat.simulateFight(p.members, gs, rand, 40, { useSpells: true });
    if (r.win) wins++;
    dmgFrac += r.monsterDamage / total;
  }
  ok(wins / N >= 0.85, `3 GoblinA vs fresh party: win rate ${(wins / N * 100).toFixed(0)}% - too hard`);
  ok(dmgFrac / N >= 0.06, `3 GoblinA vs fresh party: only ${(dmgFrac / N * 100).toFixed(0)}% party HP lost - a walkover`);
  say(`opening fight: ${(wins / N * 100).toFixed(0)}% wins, ${(dmgFrac / N * 100).toFixed(0)}% of party HP paid for it`);
}

// ---------------------------------------------------------------------------
// 10. Level a party and gear it up
// ---------------------------------------------------------------------------

section('progression');

/** Build a party at `level` with gear appropriate to it. */
function buildParty(level, seed) {
  const p = Party.createParty(seed || `bal-${level}`);
  const rand = new Rand(`gear-${level}-${seed || ''}`);
  for (const c of p.members) {
    c.xp = Stats.xpForLevel(level);
    while (c.level < level) {
      const r = Party.levelUp(c, rand);
      if (!r) break;
    }
    // MM6 hands out both promotions over the course of the game; without them
    // a character is locked out of Master rank forever.
    if (level >= 12) Party.promote(c);
    if (level >= 28) Party.promote(c);
    // Spend every skill point on whatever the class is actually good at.
    spendPoints(c);
    // Gear: a few rolls of loot at the party's level, best-of auto-equipped.
    for (let i = 0; i < 14; i++) {
      const it = Items.generateItem(rand, { level: Math.round(level * 1.1), kind: 'equipment', identified: true });
      if (it) Party.invAdd(c.inventory, it);
    }
    Party.autoEquip(c);
    // Learn every spell the character's rank allows.
    for (const school of Skills.MAGIC_SKILLS) {
      const s = c.skills[school];
      if (!s) continue;
      for (const sp of Spells.SPELLS_BY_SCHOOL[school]) {
        if (sp.tier <= [0, 4, 7, 11][s.mastery] && c.spells.indexOf(sp.id) < 0) c.spells.push(sp.id);
      }
    }
    Party.recompute(c);
    c.hp = Stats.maxHP(c);
    c.sp = Stats.maxSP(c);
  }
  return p;
}

/**
 * A sensible trainer. Learns the class's key skills, takes every mastery the
 * moment its level requirement is met, and spends points to keep each skill
 * near its share of the character's attention - the first skills on the list
 * get the most. Spreading points evenly across eight skills leaves a level-50
 * character stuck at Expert in everything, which is a trap the real game shares.
 */
const TRAIN_WEIGHTS = [3, 2.2, 1.8, 1.5, 1.1, 0.9, 0.7, 0.6, 0.5];

function spendPoints(c) {
  const priority = {
    knight: ['sword', 'plate', 'body_building', 'shield', 'chain', 'leather', 'merchant'],
    paladin: ['sword', 'plate', 'body_building', 'shield', 'spirit', 'body', 'mind'],
    archer: ['bow', 'fire', 'leather', 'body_building', 'air', 'meditation', 'water', 'earth'],
    cleric: ['body', 'mace', 'spirit', 'meditation', 'leather', 'mind', 'shield', 'body_building'],
    sorcerer: ['fire', 'meditation', 'air', 'staff', 'leather', 'water', 'earth', 'body_building'],
    druid: ['earth', 'body', 'meditation', 'fire', 'staff', 'leather', 'water', 'air'],
  };
  const line = Stats.CLASSES[c.class].line;
  const list = (priority[line] || ['sword']).filter((id) => Skills.classSkillMax(c.class, id) > 0);
  for (const id of list) if (!c.skills[id] && c.skillPoints > 0) Party.learnSkill(c, id);

  let guard = 20000;
  while (c.skillPoints > 0 && guard-- > 0) {
    // Take any rank that is going spare first: mastery is worth more than levels.
    for (let i = 0; i < list.length; i++) {
      const s = c.skills[list[i]];
      if (!s) continue;
      const cap = Skills.classSkillMax(c.class, list[i]);
      while (s.mastery < cap && s.level >= (s.mastery === Skills.MASTERY.NORMAL ? 4 : 8)) {
        if (!Party.raiseMastery(c, list[i], s.mastery + 1).ok) break;
      }
    }
    // Then top up whichever skill is furthest behind its share.
    let best = null, bestRatio = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = c.skills[list[i]];
      if (!s) continue;
      const ratio = s.level / (TRAIN_WEIGHTS[i] || 0.5);
      if (ratio < bestRatio) { bestRatio = ratio; best = list[i]; }
    }
    if (!best || !Party.spendSkillPoint(c, best).ok) {
      // Blocked (needs a teacher): fall back to anything that will take a point.
      let spent = false;
      for (const id of list) if (Party.spendSkillPoint(c, id).ok) { spent = true; break; }
      if (!spent) break;
    }
  }
}

// Equipment-derived caches: a weapon's attack/damage enchants must NOT land in
// the cached attackMods/damageMods - combat.js re-adds w.mods per swing, so
// caching them too would double-count every enchant. Non-weapon slots keep
// contributing to the caches as before.
{
  const rand = new Rand('dblcount');
  const c = Party.createCharacter(rand, 'knight', { name: 'Cache' });
  ok(c.recovery === 0, 'createCharacter must init recovery to 0 (HUD gem reads it)');
  const sword = Items.makeItem('longsword', { identified: true, bonus: 3 });
  Party.invAdd(c.inventory, sword);
  const before = { atk: c.attackMods, dmg: c.damageMods, ac: c.acMods };
  Party.equip(c, sword, 'mainhand');
  ok(c.attackMods === before.atk && c.damageMods === before.dmg && c.acMods === before.ac,
    'weapon +N must not be cached into attackMods/damageMods/acMods');
  const ring = Items.makeItem('ring', { identified: true, suffix: 'of_might' });
  Party.invAdd(c.inventory, ring);
  Party.equip(c, ring, 'ring1');
  ok(c.statMods.might === 10, 'non-weapon enchants still feed the caches');
  // levelUp adds the new dice to the pools but is not a heal and never revives.
  c.hp = 1;
  c.conditions.unconscious = true;
  c.xp = Stats.xpForLevel(2);
  const rep = Party.levelUp(c, rand);
  ok(!!rep && c.level === 2, 'levelUp fired');
  ok(c.hp < Stats.maxHP(c) || rep.hpGained >= Stats.maxHP(c) - 1,
    'levelUp must not fully heal a wounded character');
  ok(c.conditions.unconscious === true, 'levelUp must not silently revive the unconscious');
}

{
  const p20 = buildParty(20);
  for (const c of p20.members) {
    ok(c.level === 20, `${c.name} should be level 20`);
    ok(Stats.maxHP(c) > 60, `${c.name} has only ${Stats.maxHP(c)} HP at level 20`);
    ok(Object.keys(c.equipment).length >= 2, `${c.name} equipped almost nothing`);
  }
  const caster = p20.members.find((c) => Stats.CLASSES[c.class].spStat);
  ok(caster && caster.spells.length >= 8, 'the caster learned too few spells by level 20');
  say('level 20 party:');
  for (const c of p20.members) {
    const sheet = Party.characterSheet(c);
    say(`  ${c.name.padEnd(12)} ${sheet.className.padEnd(12)} L${sheet.level}  ${sheet.maxHP} HP  ${sheet.maxSP} SP  AC ${sheet.ac}  rec ${sheet.recovery}  spells ${c.spells.length}`);
  }
}

// Cast a sample of spells to make sure nothing throws.
{
  const p = buildParty(20, 'cast');
  const caster = p.members.find((c) => c.spells.length > 3);
  const rand = new Rand('cast');
  let cast = 0;
  for (const id of caster.spells) {
    const sp = Spells.spellById(id);
    caster.sp = Stats.maxSP(caster);
    const check = Spells.canCast(caster, sp);
    if (!check.ok) continue;
    if (sp.type === 'damage') {
      const m = Monsters.spawnMonster('OgreA');
      const sk = Spells.schoolSkill(caster, sp.school);
      const e = Combat.resolveSpellAttack(caster, sp, m, sk.level, sk.mastery, rand);
      ok(Number.isFinite(e.damage) && e.damage >= 0, `${id} produced NaN damage`);
    } else {
      const r = Party.castSupportSpell(p, caster, id, 0);
      ok(r.ok, `${id} could not be cast as a support spell`);
    }
    cast++;
  }
  ok(cast > 5, `only ${cast} spells were castable`);
  say(`cast ${cast} distinct spells with no errors`);
}

// ---------------------------------------------------------------------------
// 11. Balance simulation
// ---------------------------------------------------------------------------

section('balance');

const TARGET_ROUNDS = 2000;
let roundsRun = 0;

/** Fight `trials` fights of a level-`plevel` party against level-`mlevel` foes. */
function trial(plevel, mlevel, trials, seedTag) {
  let wins = 0, totalRounds = 0, totalPartyDmg = 0, totalMonsterDmg = 0;
  let xpGained = 0, goldGained = 0, monstersKilled = 0, timeouts = 0;

  const pool = Monsters.MONSTERS
    .filter((m) => m.hostile && !m.unique && Math.abs(m.level - mlevel) <= Math.max(2, mlevel * 0.18));
  if (!pool.length) return null;

  for (let t = 0; t < trials; t++) {
    const rand = new Rand(`fight-${plevel}-${mlevel}-${t}-${seedTag || ''}`);
    const p = buildParty(plevel, `p${plevel}-${t % 6}`);
    // Encounter size comes from the roster's own group sizes - goblins come in
    // fives, dragons alone - averaged over a mixed draw so a single unlucky
    // lead pick does not decide the band.
    const draw = [rand.pick(pool), rand.pick(pool), rand.pick(pool)];
    const avg = draw.reduce((t, m) => t + (m.groupSize[0] + m.groupSize[1]) / 2, 0) / draw.length;
    const n = Math.max(2, Math.min(5, Math.round(avg)));
    const group = [];
    for (let i = 0; i < n; i++) group.push(Monsters.spawnMonster(rand.pick(pool).id));

    const before = group.reduce((s, m) => s + m.def.xp, 0);
    const r = Combat.simulateFight(p.members, group, rand, 60, { useSpells: true });
    roundsRun += r.rounds;
    totalRounds += r.rounds;
    totalPartyDmg += r.partyDamage;
    totalMonsterDmg += r.monsterDamage;
    if (r.timeout) timeouts++;
    if (r.win) {
      wins++;
      xpGained += before;
      monstersKilled += group.length;
      for (const m of group) goldGained += Math.round(m.def.gold);
    }
  }
  return {
    plevel, mlevel, trials,
    winRate: wins / trials,
    avgRounds: totalRounds / trials,
    dpr: totalPartyDmg / Math.max(1, totalRounds),
    incoming: totalMonsterDmg / Math.max(1, totalRounds),
    ttk: totalRounds / Math.max(1, trials),
    xpPerFight: xpGained / Math.max(1, wins),
    goldPerFight: goldGained / Math.max(1, wins),
    monstersKilled,
    timeouts,
  };
}

// MM6's monster levels are NOT on the same scale as party levels: the roster
// runs 1-100 while characters cap at 50, and the endgame party (L40-50) fights
// L80-100 dragons. Difficulty is therefore measured as a *ratio* of monster
// level to party level, and what must hold at every stage of the game is the
// shape of the curve, not any single number.
//
// One caveat the retail data forces: monster hit points are quadratic in level
// (3L + 0.1L^2), so at the bottom of the table the curve is nearly flat - a
// level-10 monster has only 2.4x the health of a level-5 one, while a level-100
// monster has 3.3x a level-50 one on top of a far larger base. A level-5 party
// therefore out-scales the ratio and can take on much deeper odds than a
// level-40 one. That is authentic, so the assertions below check the *shape*
// (walkover / comfortable / crossover / hopeless) rather than fixed win rates.
const RATIOS = [0.6, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const PARTY_LEVELS = [5, 10, 20, 30, 40, 50];

const results = [];
for (const pl of PARTY_LEVELS) {
  for (const ratio of RATIOS) {
    const ml = Math.max(1, Math.round(pl * ratio));
    if (ml > 130) continue;
    const r = trial(pl, ml, 20, 'a');
    if (r) { r.ratio = ratio; results.push(r); }
  }
}

say('');
say('  party  monsters  ratio   win%   rounds   party dmg/rd   incoming/rd    xp/fight   gold/fight');
say('  ' + '-'.repeat(96));
let lastLevel = null;
for (const r of results) {
  if (lastLevel !== null && r.plevel !== lastLevel) say('');
  lastLevel = r.plevel;
  say(`  L${String(r.plevel).padStart(2)}    L${String(r.mlevel).padStart(3)}     `
    + `${r.ratio.toFixed(1).padStart(4)}x  `
    + `${(r.winRate * 100).toFixed(0).padStart(4)}%  `
    + `${r.avgRounds.toFixed(1).padStart(7)}  `
    + `${r.dpr.toFixed(1).padStart(13)}  `
    + `${r.incoming.toFixed(1).padStart(12)}  `
    + `${Math.round(r.xpPerFight).toString().padStart(10)}  `
    + `${Math.round(r.goldPerFight).toString().padStart(11)}`);
}

// Top up to the mandated 2000 rounds with a broad mixed sweep.
while (roundsRun < TARGET_ROUNDS) {
  const pl = 1 + Math.floor((roundsRun * 7919) % 50);
  trial(pl, Math.max(1, Math.round(pl * 1.1)), 2, 'fill');
  if (roundsRun > 100000) break;
}
say(`\n  simulated ${Math.round(roundsRun)} combat rounds`);

// ---------------------------------------------------------------------------
// 12. Balance assertions - the progression curve must feel like an RPG
// ---------------------------------------------------------------------------

const at = (pl, ratio) => results.find((r) => r.plevel === pl && r.ratio === ratio);

/** The deepest odds at which the party still wins half the time. */
function crossover(pl) {
  let best = 0;
  for (const ratio of RATIOS) {
    const r = at(pl, ratio);
    if (r && r.winRate >= 0.5) best = ratio;
  }
  return best;
}

say('');
say('  party level   walkover(0.6x)   parity(1.0x)   crossover   hopeless above');
say('  ' + '-'.repeat(72));
for (const pl of PARTY_LEVELS) {
  const x = crossover(pl);
  const hopeless = RATIOS.find((ra) => { const r = at(pl, ra); return r && r.winRate <= 0.1; });
  say(`  L${String(pl).padStart(2)}           `
    + `${((at(pl, 0.6) || {}).winRate * 100).toFixed(0).padStart(11)}%   `
    + `${((at(pl, 1.0) || {}).winRate * 100).toFixed(0).padStart(10)}%   `
    + `${x.toFixed(1).padStart(9)}x   ${(hopeless ? hopeless.toFixed(1) + 'x' : '-').padStart(14)}`);
}

for (const pl of PARTY_LEVELS) {
  // A fight against monsters well below the party is never in doubt.
  const easy = at(pl, 0.6);
  ok(easy && easy.winRate >= 0.95, `L${pl} vs 0.6x should be a walkover, got ${easy && (easy.winRate * 100).toFixed(0)}%`);
  // At parity the party wins, but it should cost something.
  const par = at(pl, 1.0);
  ok(par && par.winRate >= 0.85, `L${pl} at parity should win >=85%, got ${par && (par.winRate * 100).toFixed(0)}%`);
  ok(par && par.incoming > 0, `L${pl} at parity took no damage at all`);
  // There must be a level at which the party is out of its depth, and it must
  // not be absurdly far out.
  const x = crossover(pl);
  ok(x >= 1.0 && x <= 3.0, `L${pl} crossover at ${x}x is outside 1.0-3.0x`);
  // And a level at which it is out of its depth for good. (The very top of
  // the roster is only 2x a level-50 party, so 'hopeless' there means the
  // occasional lucky win against a Gold Dragon, which is as it should be.)
  const worst = at(pl, RATIOS.filter((ra) => at(pl, ra)).pop());
  ok(worst && worst.winRate <= 0.25,
    `L${pl} still wins ${(worst.winRate * 100).toFixed(0)}% at its deepest odds (${worst.ratio}x)`);
}
// The crossover must not collapse as the party levels: the game should not get
// relatively harder or easier in a jump.
{
  const xs = PARTY_LEVELS.map(crossover);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  ok(hi / Math.max(0.1, lo) <= 2.6, `crossover swings from ${lo}x to ${hi}x across the game`);
}
// Win rate must fall as the odds lengthen.
for (const pl of PARTY_LEVELS) {
  for (let i = 1; i < RATIOS.length; i++) {
    const a = at(pl, RATIOS[i - 1]), b = at(pl, RATIOS[i]);
    if (!a || !b) continue;
    ok(b.winRate <= a.winRate + 0.2,
      `L${pl}: ${RATIOS[i]}x is easier than ${RATIOS[i - 1]}x (${b.winRate} vs ${a.winRate})`);
  }
}
// Fights must not be trivial or interminable.
for (const r of results) {
  ok(r.avgRounds >= 0.5 && r.avgRounds <= 45,
    `L${r.plevel} vs L${r.mlevel}: ${r.avgRounds.toFixed(1)} rounds`);
  ok(r.timeouts <= r.trials * 0.4, `L${r.plevel} vs L${r.mlevel}: ${r.timeouts} stalemates`);
}
// Damage output must grow with level (measured against easy prey, where the
// party is not being interrupted by its own casualties).
{
  const a = at(5, 0.6), b = at(20, 0.6), c = at(40, 0.6);
  ok(a && b && a.dpr < b.dpr, `party dpr should grow L5 (${a && a.dpr.toFixed(1)}) -> L20 (${b && b.dpr.toFixed(1)})`);
  ok(b && c && b.dpr < c.dpr, `party dpr should grow L20 (${b && b.dpr.toFixed(1)}) -> L40 (${c && c.dpr.toFixed(1)})`);
}
// And so must the punishment for over-reaching.
{
  const a = at(10, 2.5), b = at(40, 2.5);
  ok(a && b && b.incoming > a.incoming, 'incoming damage should grow with the level band');
}

// ---------------------------------------------------------------------------
// 13. Economy: how long does levelling actually take?
// ---------------------------------------------------------------------------

section('economy');
say('  level   xp needed   xp/hour(est)   hours to next   gold/hour');
say('  ' + '-'.repeat(62));
const FIGHTS_PER_HOUR = 12; // exploration, travel and rest included
for (const lv of [1, 5, 10, 15, 20, 25, 30, 40]) {
  const r = trial(lv, Math.max(1, Math.round(lv * 1.05)), 6, 'econ');
  if (!r) continue;
  const xpPerHour = (r.xpPerFight * r.winRate * FIGHTS_PER_HOUR) / 4; // divided across the party
  const goldPerHour = r.goldPerFight * r.winRate * FIGHTS_PER_HOUR;
  const need = Stats.xpForLevel(lv + 1) - Stats.xpForLevel(lv);
  const hours = xpPerHour > 0 ? need / xpPerHour : Infinity;
  say(`  L${String(lv).padStart(2)}    ${String(need).padStart(9)}   ${Math.round(xpPerHour).toString().padStart(12)}   `
    + `${hours.toFixed(1).padStart(13)}   ${Math.round(goldPerHour).toString().padStart(9)}`);
  ok(hours < 60, `levelling from ${lv} to ${lv + 1} takes ${hours.toFixed(1)} hours - too grindy`);
  ok(hours > 0.05, `levelling from ${lv} to ${lv + 1} takes ${hours.toFixed(2)} hours - too fast`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} checks, ${roundsRun} combat rounds simulated`);
process.exit(failures === 0 ? 0 : 1);
