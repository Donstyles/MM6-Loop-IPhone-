// Quests, the Awards list and the autonote log.
//
// Two sources of quests:
//   * the hand-written main chain (`MAIN_CHAIN`) with hard gating, and
//   * `generateQuestsForRegion`, which rolls side quests from the bestiary and
//     the item tables so every region has something to do.
//
// A quest is inert data. The game feeds it events through `updateQuestProgress`
// and reads `state` back.

import { Rand } from '../core/rng.js';
import { MONSTERS, monsterById, MONSTER_FAMILIES, monstersInLevelRange } from './monsters.js';
import { ARTIFACTS, generateItem, itemName } from './items.js';
import { npcName, townName, dungeonName, profession, uniqueMonsterName } from './npcnames.js';

export const QUEST_STATES = ['unavailable', 'available', 'active', 'complete', 'rewarded', 'failed'];

export const QUEST_TYPES = [
  'kill', 'clear', 'fetch', 'deliver', 'escort', 'find_person', 'artifact', 'bounty',
];

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

// Ids come from counters, never Math.random: everything in this game has to be
// reproducible from a seed, save files included.
let OBJ_ID = 1;
let QID = 1;
export function resetQuestIds(n) { QID = n | 0 || 1; OBJ_ID = 1; }

function objective(kind, spec) {
  return Object.assign({
    id: spec.id || `${kind}_${OBJ_ID++}`,
    kind,
    count: 1,
    progress: 0,
    done: false,
    text: '',
  }, spec);
}

/** True when every objective is satisfied. */
export function questComplete(quest) {
  return quest.objectives.every((o) => o.done);
}

/**
 * Feed an event into a quest. Events:
 *   { type: 'kill', monsterId, count }
 *   { type: 'collect', itemId | artifactId, count }
 *   { type: 'reach', locationId }
 *   { type: 'talk', npcId }
 *   { type: 'clear', dungeonId }
 *   { type: 'escort', npcId, arrived: true }
 * Returns true when the quest changed.
 */
export function updateQuestProgress(quest, event) {
  if (!quest || quest.state !== 'active' || !event) return false;
  let changed = false;

  for (const o of quest.objectives) {
    if (o.done) continue;
    let hit = false;
    switch (o.kind) {
      case 'kill':
        // A quest may name a single monster id or a whole sprite family.
        hit = event.type === 'kill' && (
          o.target === event.monsterId ||
          (o.family && monsterById(event.monsterId) && monsterById(event.monsterId).family === o.family));
        break;
      case 'collect':
        hit = event.type === 'collect' && (o.target === event.itemId || o.target === event.artifactId);
        break;
      case 'reach':
        hit = event.type === 'reach' && o.target === event.locationId;
        break;
      case 'talk':
        hit = event.type === 'talk' && o.target === event.npcId;
        break;
      case 'clear':
        hit = event.type === 'clear' && o.target === event.dungeonId;
        break;
      case 'escort':
        hit = event.type === 'escort' && o.target === event.npcId && event.arrived;
        break;
      default: break;
    }
    if (!hit) continue;
    o.progress = Math.min(o.count, o.progress + (event.count || 1));
    if (o.progress >= o.count) o.done = true;
    changed = true;
  }

  if (changed && questComplete(quest)) quest.state = 'complete';
  return changed;
}

/** Hand in a completed quest. Returns the reward, or null. */
export function completeQuest(quest) {
  if (quest.state !== 'complete') return null;
  quest.state = 'rewarded';
  return quest.reward;
}

/** Human-readable progress, for the quest book. */
export function questProgressText(quest) {
  return quest.objectives.map((o) => {
    const tick = o.done ? 'x' : ' ';
    const count = o.count > 1 ? ` (${o.progress}/${o.count})` : '';
    return `[${tick}] ${o.text}${count}`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Region flavour
// ---------------------------------------------------------------------------

const REGION_NAMES = {
  new_sorpigal: 'New Sorpigal', castle_ironfist: 'Castle Ironfist',
  bootleg_bay: 'Bootleg Bay', free_haven: 'Free Haven', silver_cove: 'Silver Cove',
  blackshire: 'Blackshire', mire_of_the_damned: 'the Mire of the Damned',
  kriegspire: 'Kriegspire', eel_infested_waters: 'the Eel Infested Waters',
  dragonsand: 'Dragonsand', paradise_valley: 'Paradise Valley',
  sweet_water: 'Sweet Water', white_cap: 'White Cap',
  frozen_highlands: 'the Frozen Highlands', cave: 'the caves', crypt: 'the crypts',
  temple: 'the temple', tower: 'the tower', mine: 'the mines', sewer: 'the sewers',
  ruins: 'the ruins', lair: 'the lair', pyramid: 'the pyramid',
  control_center: 'the Control Center', town: 'town',
};

export function regionName(id) { return REGION_NAMES[id] || id; }

/** Difficulty a region is tuned for, used to pick monsters and rewards. */
export const REGION_LEVEL = {
  new_sorpigal: 4, castle_ironfist: 10, bootleg_bay: 8, free_haven: 14,
  silver_cove: 20, blackshire: 18, mire_of_the_damned: 26, kriegspire: 38,
  eel_infested_waters: 30, dragonsand: 44, paradise_valley: 50,
  sweet_water: 34, white_cap: 24, frozen_highlands: 42,
  cave: 10, crypt: 14, temple: 22, tower: 28, mine: 12, sewer: 8,
  ruins: 18, lair: 55, pyramid: 45, control_center: 60, town: 3,
};

// ---------------------------------------------------------------------------
// Side quest generation
// ---------------------------------------------------------------------------

function makeQuest(spec) {
  return Object.assign({
    id: `q${QID++}`,
    type: 'kill',
    title: 'A Task',
    giver: 'Someone',
    giverRole: 'Villager',
    text: '',
    objectives: [],
    reward: { gold: 0, xp: 0, item: null },
    state: 'available',
    region: 'new_sorpigal',
    autonote: '',
    requires: [],
    main: false,
  }, spec);
}

/** Gold and XP for a quest of a given difficulty. */
function rewardFor(level, rand, mul) {
  const m = mul === undefined ? 1 : mul;
  return {
    gold: Math.round((80 + level * level * 1.6 + level * 40) * m * rand.float(0.85, 1.2)),
    xp: Math.round((150 + level * level * 8 + level * 60) * m * rand.float(0.9, 1.15)),
    item: null,
  };
}

function pickMonsterFor(rand, region, level) {
  let pool = MONSTERS.filter((m) => m.spawnRegions.indexOf(region) >= 0 && m.hostile && !m.unique);
  if (!pool.length) pool = monstersInLevelRange(Math.max(1, level - 4), level + 6).filter((m) => !m.unique);
  const band = pool.filter((m) => m.level >= level * 0.6 && m.level <= level * 1.5);
  return rand.pick(band.length ? band : pool);
}

const KILL_TEMPLATES = [
  '{giver} has had enough. "{count} of them," {pronoun} says. "{monster}. Out past the {place}. Bring me proof."',
  'The {role} of {town} is offering coin for {monster} - {count} of them, and no questions about method.',
  '"They took my {thing}," says {giver}. "The {monster}. There are {count} at least. I want them dead."',
];

const FETCH_TEMPLATES = [
  '{giver} lost {item} somewhere in {place} and is too old to go and look.',
  'A {role} needs {item} recovered from {place}. Payment on delivery, not before.',
  '"{item}," says {giver}. "It is in {place}. It should not be."',
];

const DELIVER_TEMPLATES = [
  '{giver} has a letter for {target} in {town} and no one to carry it.',
  'A sealed packet, a name, and a warning not to open it. {giver} pays on arrival.',
];

const CLEAR_TEMPLATES = [
  'Nothing has come out of {dungeon} in a month, and things used to come out of {dungeon} regularly.',
  '{giver} wants {dungeon} emptied. All of it. "I do not care what is in there."',
];

const ESCORT_TEMPLATES = [
  '{target} needs to reach {town} alive, and the road is not what it was.',
  '{giver} will pay to see {target} safely to {town}. Do not ask why {target} cannot go alone.',
];

const FIND_TEMPLATES = [
  '{target} went into {place} eight days ago. {giver} would like to know either way.',
  'A missing {role}: {target}, last seen near {place}.',
];

const BOUNTY_TEMPLATES = [
  'There is a bounty posted on {unique}. It has a name, which means it has killed enough people to earn one.',
  '{unique} has been raiding {place}. The reward is generous, which should tell you something.',
];

const THINGS = ['goats', 'cart', 'daughter\'s dowry', 'nets', 'harvest', 'shipment', 'brother'];

/**
 * Roll `count` side quests for a region.
 * The mix is weighted toward kill and fetch, the two that always work.
 */
export function generateQuestsForRegion(regionId, seed, count) {
  const rand = new Rand(`${seed}:${regionId}:quests`);
  const level = REGION_LEVEL[regionId] || 5;
  const town = townName(rand, { canon: rand.bool(0.5) });
  const out = [];
  const n = count === undefined ? 5 : count;

  for (let i = 0; i < n; i++) {
    const type = rand.weighted([
      { k: 'kill', w: 30 }, { k: 'fetch', w: 20 }, { k: 'clear', w: 12 },
      { k: 'deliver', w: 12 }, { k: 'bounty', w: 10 }, { k: 'find_person', w: 8 },
      { k: 'escort', w: 5 }, { k: 'artifact', w: 3 },
    ]).k;
    out.push(generateQuest(rand, type, regionId, level, town));
  }
  return out;
}

/** Roll a single quest of a given type. */
export function generateQuest(rand, type, regionId, level, town) {
  const giverSex = rand.bool() ? 'm' : 'f';
  const giver = npcName(rand, giverSex, { epithet: false });
  const role = profession(rand);
  const pronoun = giverSex === 'm' ? 'he' : 'she';
  const place = regionName(regionId);
  const townName_ = town || regionName(regionId);
  const reward = rewardFor(level, rand);

  switch (type) {
    case 'kill': {
      const m = pickMonsterFor(rand, regionId, level);
      const cnt = rand.int(4, 12);
      const fam = MONSTER_FAMILIES[m.family];
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Cull the ${m.name}s`,
        text: rand.pick(KILL_TEMPLATES)
          .replace('{giver}', giver).replace('{role}', role).replace('{pronoun}', pronoun)
          .replace(/{monster}/g, `${m.name}s`).replace('{count}', String(cnt))
          .replace('{place}', place).replace('{town}', townName_)
          .replace('{thing}', rand.pick(THINGS)),
        objectives: [objective('kill', {
          target: m.id, family: rand.bool(0.4) ? m.family : null, count: cnt,
          text: `Kill ${cnt} ${m.name}${cnt > 1 ? 's' : ''}`,
        })],
        reward: Object.assign(reward, { gold: Math.round(reward.gold * (cnt / 8)) }),
        autonote: `${giver} of ${townName_} asked you to kill ${cnt} ${m.name}s.`,
      });
    }
    case 'fetch': {
      const item = generateItem(rand, { level, kind: 'equipment', identified: true, noArtifact: true });
      const label = item ? itemName(item, true) : 'a family heirloom';
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Recover ${label}`,
        text: rand.pick(FETCH_TEMPLATES)
          .replace('{giver}', giver).replace('{role}', role)
          .replace(/{item}/g, label).replace('{place}', place),
        objectives: [objective('collect', { target: item ? item.def : 'heirloom', count: 1, text: `Recover ${label}` })],
        reward: Object.assign(reward, { item }),
        autonote: `${giver} wants ${label} recovered from ${place}.`,
      });
    }
    case 'clear': {
      const theme = ['cave', 'crypt', 'mine', 'ruins', 'temple', 'tower'][rand.int(0, 5)];
      const dungeon = dungeonName(rand, theme);
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Clear ${dungeon}`,
        text: rand.pick(CLEAR_TEMPLATES).replace('{giver}', giver).replace(/{dungeon}/g, dungeon),
        objectives: [objective('clear', { target: dungeon, count: 1, text: `Clear ${dungeon}` })],
        reward: Object.assign(rewardFor(level, rand, 1.8), {}),
        autonote: `${giver} asked you to clear ${dungeon}.`,
      });
    }
    case 'deliver': {
      const target = npcName(rand, undefined, { epithet: false });
      const dest = townName(rand, { canon: rand.bool(0.5) });
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `A Letter for ${target}`,
        text: rand.pick(DELIVER_TEMPLATES)
          .replace('{giver}', giver).replace('{target}', target).replace('{town}', dest),
        objectives: [objective('talk', { target, count: 1, text: `Deliver the letter to ${target} in ${dest}` })],
        reward: rewardFor(level, rand, 0.5),
        autonote: `Carry ${giver}'s letter to ${target} in ${dest}.`,
      });
    }
    case 'escort': {
      const target = npcName(rand, undefined, { epithet: false });
      const dest = townName(rand, { canon: rand.bool(0.5) });
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Escort ${target}`,
        text: rand.pick(ESCORT_TEMPLATES)
          .replace('{giver}', giver).replace(/{target}/g, target).replace('{town}', dest),
        objectives: [objective('escort', { target, count: 1, text: `See ${target} safely to ${dest}` })],
        reward: rewardFor(level, rand, 1.4),
        autonote: `Escort ${target} to ${dest}.`,
      });
    }
    case 'find_person': {
      const target = npcName(rand, undefined, { epithet: false });
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Find ${target}`,
        text: rand.pick(FIND_TEMPLATES)
          .replace('{giver}', giver).replace(/{target}/g, target)
          .replace('{role}', role).replace('{place}', place),
        objectives: [objective('talk', { target, count: 1, text: `Find ${target}` })],
        reward: rewardFor(level, rand, 0.9),
        autonote: `${target} is missing somewhere in ${place}.`,
      });
    }
    case 'artifact': {
      const art = rand.pick(ARTIFACTS);
      return makeQuest({
        type, region: regionId, giver, giverRole: role,
        title: `Retrieve ${art.name}`,
        text: `${giver} has traced ${art.name} to ${place}. "${art.desc}" ${giver} does not say why ${pronoun} wants it.`,
        objectives: [objective('collect', { target: art.id, count: 1, text: `Recover ${art.name}` })],
        reward: rewardFor(level, rand, 3),
        autonote: `${giver} wants ${art.name}, last seen in ${place}.`,
      });
    }
    case 'bounty':
    default: {
      const m = pickMonsterFor(rand, regionId, Math.round(level * 1.3));
      const uname = uniqueMonsterName(rand, m.name);
      return makeQuest({
        type: 'bounty', region: regionId, giver, giverRole: role,
        title: `Bounty: ${uname}`,
        text: rand.pick(BOUNTY_TEMPLATES).replace('{unique}', uname).replace('{place}', place),
        objectives: [objective('kill', { target: m.id, count: 1, unique: uname, text: `Kill ${uname}` })],
        reward: rewardFor(level, rand, 2.2),
        autonote: `A bounty is posted on ${uname} in ${place}.`,
        uniqueName: uname,
        uniqueBase: m.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The main chain
// ---------------------------------------------------------------------------
//
// Ten beats. Each `requires` the previous one, so the game can hand the whole
// array to the quest book and let gating sort itself out.

export const MAIN_CHAIN = [
  {
    id: 'main_1', main: true, type: 'deliver', region: 'new_sorpigal',
    title: 'A Letter of Introduction',
    giver: 'Sir Charles Quixote', giverRole: 'Knight of Ironfist',
    text: 'Four strangers arrive in New Sorpigal with a letter from a man who is now dead. '
      + 'Sir Charles Quixote reads it twice and then looks at you properly for the first time. '
      + '"Take this to the town hall. Then come back. There is work."',
    objectives: [objective('talk', { target: 'newsorpigal_clerk', count: 1, text: 'Deliver the letter in New Sorpigal' })],
    reward: { gold: 100, xp: 250, item: null },
    autonote: 'Sir Charles Quixote gave you a letter to deliver in New Sorpigal.',
    requires: [],
  },
  {
    id: 'main_2', main: true, type: 'clear', region: 'new_sorpigal',
    title: 'Goblinwatch',
    giver: 'Sir Charles Quixote', giverRole: 'Knight of Ironfist',
    text: 'The goblins have taken the old watchtower on the ridge. They are not clever, but there are '
      + 'a great many of them and they have a king. Clear it, and Ironfist will know your names.',
    objectives: [
      objective('clear', { target: 'goblinwatch', count: 1, text: 'Clear Goblinwatch' }),
      objective('kill', { target: 'GoblinC', count: 1, text: 'Kill the Goblin King' }),
    ],
    reward: { gold: 500, xp: 2000, item: null },
    autonote: 'Clear Goblinwatch and kill the Goblin King.',
    requires: ['main_1'],
  },
  {
    id: 'main_3', main: true, type: 'find_person', region: 'free_haven',
    title: 'A Seat on the Council',
    giver: 'Wilbur Humphrey', giverRole: 'Lord of Free Haven',
    text: 'The Circle of Elders governs Enroth, and it will not admit adventurers. '
      + 'Unless four of its number can be persuaded that adventurers are exactly what the kingdom needs. '
      + 'Find them. Do what they ask.',
    objectives: [objective('talk', { target: 'councilman', count: 4, text: 'Win the endorsement of four councilmen' })],
    reward: { gold: 2000, xp: 12000, item: null },
    autonote: 'Earn the endorsement of four members of the Circle of Elders.',
    requires: ['main_2'],
  },
  {
    id: 'main_4', main: true, type: 'clear', region: 'temple',
    title: 'The Temples of Baa',
    giver: 'The Circle of Elders', giverRole: 'Council',
    text: 'The cult of Baa has four temples on Enroth and a great deal more money than a church should have. '
      + 'The Circle would prefer that they had none of either.',
    objectives: [objective('clear', { target: 'temple_of_baa', count: 4, text: 'Destroy the four Temples of Baa' })],
    reward: { gold: 5000, xp: 30000, item: null },
    autonote: 'Destroy the four Temples of Baa.',
    requires: ['main_3'],
  },
  {
    id: 'main_5', main: true, type: 'find_person', region: 'control_center',
    title: 'The Oracle',
    giver: 'Nicolai Ironfist', giverRole: 'Prince of Enroth',
    text: 'Beneath the ground there is a machine older than the kingdom, and it used to answer questions. '
      + 'It has been silent for two hundred years. Find it.',
    objectives: [objective('reach', { target: 'control_center', count: 1, text: 'Find the Control Center' })],
    reward: { gold: 3000, xp: 25000, item: null },
    autonote: 'Find the Oracle beneath Enroth.',
    requires: ['main_4'],
  },
  {
    id: 'main_6', main: true, type: 'fetch', region: 'control_center',
    title: 'Memory of the Ancients',
    giver: 'The Oracle', giverRole: 'Machine',
    text: 'The Oracle can speak, but it cannot remember. Three memory crystals were taken from it and '
      + 'scattered across Enroth by people who did not know what they were carrying.',
    objectives: [objective('collect', { target: 'memory_crystal', count: 3, text: 'Recover three memory crystals' })],
    reward: { gold: 8000, xp: 60000, item: null },
    autonote: 'Recover the three memory crystals for the Oracle.',
    requires: ['main_5'],
  },
  {
    id: 'main_7', main: true, type: 'artifact', region: 'pyramid',
    title: 'The Heavenly Key',
    giver: 'The Oracle', giverRole: 'Machine',
    text: 'There is a key in the Tomb of VARN. It does not open a door. It opens a sky.',
    objectives: [
      objective('reach', { target: 'tomb_of_varn', count: 1, text: 'Enter the Tomb of VARN' }),
      objective('collect', { target: 'heavenly_key', count: 1, text: 'Recover the Heavenly Key' }),
    ],
    reward: { gold: 12000, xp: 90000, item: null },
    autonote: 'Recover the Heavenly Key from the Tomb of VARN.',
    requires: ['main_6'],
  },
  {
    id: 'main_8', main: true, type: 'clear', region: 'lair',
    title: 'The Hive',
    giver: 'Nicolai Ironfist', giverRole: 'King of Enroth',
    text: 'The Kreegan came down in a ship and dug in. Everything that has gone wrong in Enroth for '
      + 'twenty years has come out of that hole. Go and close it.',
    objectives: [
      objective('clear', { target: 'the_hive', count: 1, text: 'Clear the Kreegan Hive' }),
      objective('kill', { target: 'DemonFlyC', count: 3, text: 'Kill the Devil Kings' }),
    ],
    reward: { gold: 20000, xp: 150000, item: null },
    autonote: 'Destroy the Kreegan Hive.',
    requires: ['main_7'],
  },
  {
    id: 'main_9', main: true, type: 'fetch', region: 'control_center',
    title: 'The Gate',
    giver: 'The Oracle', giverRole: 'Machine',
    text: 'The reactor in the Control Center can be made to burn hot enough to close the gate the Kreegan '
      + 'came through. It will need a great deal of persuading, and it is not unguarded.',
    objectives: [
      objective('kill', { target: 'zReactor', count: 1, text: 'Overload the Reactor' }),
      objective('reach', { target: 'the_gate', count: 1, text: 'Seal the Gate' }),
    ],
    reward: { gold: 30000, xp: 250000, item: null },
    autonote: 'Overload the Reactor and seal the Gate.',
    requires: ['main_8'],
  },
  {
    id: 'main_10', main: true, type: 'kill', region: 'lair',
    title: 'The Queen',
    giver: 'Nicolai Ironfist', giverRole: 'King of Enroth',
    text: 'One thing is left on the other side of the closed gate, and it is on this side of it. '
      + 'The Demon Queen has been on Enroth longer than the kingdom. End it.',
    objectives: [objective('kill', { target: 'zDemonqueen', count: 1, text: 'Kill the Demon Queen' })],
    reward: { gold: 50000, xp: 500000, item: null },
    autonote: 'Kill the Demon Queen.',
    requires: ['main_9'],
  },
];

/** A fresh copy of the main chain, ready to be dropped into a party. */
export function createMainChain() {
  return MAIN_CHAIN.map((q) => {
    const copy = JSON.parse(JSON.stringify(q));
    copy.state = copy.requires.length ? 'unavailable' : 'available';
    copy.main = true;
    return copy;
  });
}

/**
 * Recalculate which quests are available. Call after any quest is rewarded.
 * Returns the ids that just unlocked.
 */
export function refreshGating(quests) {
  const done = new Set(quests.filter((q) => q.state === 'rewarded' || q.state === 'complete').map((q) => q.id));
  const unlocked = [];
  for (const q of quests) {
    if (q.state !== 'unavailable') continue;
    if ((q.requires || []).every((r) => done.has(r))) { q.state = 'available'; unlocked.push(q.id); }
  }
  return unlocked;
}

/** How far along the main chain the party is, 0-10. */
export function mainChainProgress(quests) {
  return quests.filter((q) => q.main && q.state === 'rewarded').length;
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------
//
// MM6 keeps a per-character Awards list: titles earned by deeds. Each award has
// a `test(party, character, stats)` so the log can be recomputed from scratch.

export const AWARDS = [
  { id: 'first_blood', name: 'First Blood', test: (p, c) => c.kills >= 1, text: 'Killed your first monster.' },
  { id: 'slayer_100', name: 'Slayer', test: (p, c) => c.kills >= 100, text: 'One hundred kills.' },
  { id: 'slayer_1000', name: 'Butcher of Enroth', test: (p, c) => c.kills >= 1000, text: 'One thousand kills.' },
  { id: 'level_10', name: 'Seasoned', test: (p, c) => c.level >= 10, text: 'Reached level 10.' },
  { id: 'level_25', name: 'Veteran', test: (p, c) => c.level >= 25, text: 'Reached level 25.' },
  { id: 'level_50', name: 'Legend of Enroth', test: (p, c) => c.level >= 50, text: 'Reached level 50.' },
  { id: 'promoted', name: 'Promoted', test: (p, c) => { const k = c.class; return k && k !== 'knight' && k !== 'paladin' && k !== 'archer' && k !== 'cleric' && k !== 'sorcerer' && k !== 'druid'; }, text: 'Earned a promotion.' },
  { id: 'rich', name: 'Comfortable', test: (p) => p.gold >= 10000, text: 'Held ten thousand gold at once.' },
  { id: 'wealthy', name: 'Wealthy', test: (p) => p.gold >= 100000, text: 'Held a hundred thousand gold at once.' },
  { id: 'died_once', name: 'Been Dead', test: (p, c) => c.deaths >= 1, text: 'Died, and got better.' },
  { id: 'dragon_slayer', name: 'Dragon Slayer', test: (p, c, s) => (s.killsByKind.dragon || 0) >= 1, text: 'Killed a dragon.' },
  { id: 'undead_bane', name: 'Bane of the Restless', test: (p, c, s) => (s.killsByKind.undead || 0) >= 50, text: 'Destroyed fifty undead.' },
  { id: 'devil_slayer', name: 'Devil Slayer', test: (p, c, s) => (s.killsByKind.demon || 0) >= 25, text: 'Killed twenty-five Kreegan.' },
  { id: 'councilman', name: 'Councilman', test: (p) => !!p.flags.council_seat, text: 'Won a seat on the Circle of Elders.' },
  { id: 'oracle', name: 'Friend of the Oracle', test: (p) => !!p.flags.oracle_restored, text: 'Restored the Oracle.' },
  { id: 'queenslayer', name: 'Queenslayer', test: (p) => !!p.flags.queen_dead, text: 'Killed the Demon Queen.' },
  { id: 'completionist', name: 'Errand Runner', test: (p, c, s) => s.questsDone >= 25, text: 'Completed twenty-five quests.' },
];

/**
 * Recompute every character's awards. `stats` carries the aggregate counters
 * the tests need: { killsByKind, questsDone }.
 */
export function updateAwards(party, stats) {
  const s = Object.assign({ killsByKind: {}, questsDone: 0 }, stats || {});
  const newly = [];
  for (const c of party.members) {
    c.awards = c.awards || [];
    for (const a of AWARDS) {
      if (c.awards.indexOf(a.id) >= 0) continue;
      let ok = false;
      try { ok = !!a.test(party, c, s); } catch (e) { ok = false; }
      if (ok) { c.awards.push(a.id); newly.push({ character: c.name, award: a }); }
    }
  }
  return newly;
}

export function awardById(id) { return AWARDS.find((a) => a.id === id) || null; }

// ---------------------------------------------------------------------------
// The notes book
// ---------------------------------------------------------------------------

export const NOTE_CATEGORIES = ['quest', 'autonote', 'seer', 'teacher', 'stat', 'fountain', 'obelisk', 'misc'];

/** Add an autonote, refusing duplicates. Returns true when it was new. */
export function note(party, text, category) {
  party.autonotes = party.autonotes || [];
  if (party.autonotes.some((n) => n.text === text)) return false;
  party.autonotes.push({
    text,
    category: NOTE_CATEGORIES.indexOf(category) >= 0 ? category : 'misc',
    at: party.minutes | 0,
  });
  return true;
}

/** Notes filtered by category, newest first. */
export function notesOf(party, category) {
  const all = party.autonotes || [];
  const list = category ? all.filter((n) => n.category === category) : all.slice();
  return list.slice().reverse();
}

// ---------------------------------------------------------------------------
// Party quest bookkeeping
// ---------------------------------------------------------------------------

/** Install a quest on the party. */
export function giveQuest(party, quest) {
  party.quests = party.quests || {};
  if (party.quests[quest.id]) return false;
  quest.state = quest.state === 'available' ? 'active' : quest.state;
  party.quests[quest.id] = quest;
  if (quest.autonote) note(party, quest.autonote, 'quest');
  return true;
}

/** Broadcast an event to every active quest. Returns the ones that changed. */
export function dispatchQuestEvent(party, event) {
  const changed = [];
  for (const id of Object.keys(party.quests || {})) {
    const q = party.quests[id];
    if (updateQuestProgress(q, event)) changed.push(q);
  }
  if (changed.some((q) => q.state === 'complete')) refreshGating(Object.values(party.quests));
  return changed;
}

/** Hand in a quest and pay out. `awardXPFn` is combat.awardXP. */
export function turnInQuest(party, questId, awardXPFn) {
  const q = party.quests[questId];
  if (!q || q.state !== 'complete') return null;
  const reward = completeQuest(q);
  if (!reward) return null;
  if (reward.gold) party.gold += reward.gold;
  if (reward.xp && awardXPFn) awardXPFn(party.members, reward.xp);
  if (reward.item) {
    // The caller places it; hand it back so it is not silently lost.
    reward.pendingItem = reward.item;
  }
  note(party, `Completed: ${q.title}.`, 'quest');
  refreshGating(Object.values(party.quests));
  return reward;
}

/** Quests the book should show, grouped. */
export function questBook(party) {
  const all = Object.values(party.quests || {});
  return {
    active: all.filter((q) => q.state === 'active'),
    complete: all.filter((q) => q.state === 'complete'),
    done: all.filter((q) => q.state === 'rewarded'),
    main: all.filter((q) => q.main),
  };
}
