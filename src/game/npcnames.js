// Name generators for Enroth.
//
// MM6's naming is late-medieval English with a seam of fantasy running through
// it: Sir Charles Quixote, Free Haven, Bootleg Bay, Snergle's Caverns. The word
// lists below are curated to hit that register - a little grand, a little daft.
//
// Everything takes an explicit Rand so names are reproducible from a seed.

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const MALE_FIRST = [
  'Alaric', 'Aldous', 'Ambrose', 'Anselm', 'Bardolph', 'Bertram', 'Cedric',
  'Charles', 'Corwin', 'Cuthbert', 'Damon', 'Dietrich', 'Duncan', 'Edmund',
  'Egbert', 'Emeric', 'Eustace', 'Falkner', 'Gareth', 'Godfrey', 'Gregor',
  'Hallam', 'Harold', 'Hugo', 'Ivor', 'Jasper', 'Kendrick', 'Lambert',
  'Leofric', 'Lucan', 'Magnus', 'Marcus', 'Merrick', 'Mortimer', 'Nicholas',
  'Odo', 'Osric', 'Percival', 'Quentin', 'Randall', 'Reginald', 'Roderick',
  'Rowan', 'Sebastian', 'Silas', 'Tarquin', 'Theodric', 'Tobias', 'Ulric',
  'Valdis', 'Wilhelm', 'Wulfric', 'Yorick', 'Zacharias', 'Bram', 'Corbin',
  'Dorian', 'Elric', 'Fenwick', 'Garrick', 'Hobart', 'Isembard', 'Jorund',
];

const FEMALE_FIRST = [
  'Adelaide', 'Agnes', 'Alys', 'Ariadne', 'Beatrix', 'Bronwyn', 'Cassandra',
  'Catherine', 'Cecily', 'Clarice', 'Constance', 'Cordelia', 'Delphine',
  'Edith', 'Eleanor', 'Elspeth', 'Emmeline', 'Eowyn', 'Estella', 'Freya',
  'Genevieve', 'Gwendolyn', 'Helena', 'Hilde', 'Imogen', 'Isolde', 'Jocelyn',
  'Katrina', 'Lavinia', 'Leonora', 'Lorelei', 'Lysandra', 'Mabel', 'Margery',
  'Matilda', 'Melisande', 'Morgana', 'Nerissa', 'Octavia', 'Ophelia',
  'Perrine', 'Philippa', 'Rosalind', 'Rowena', 'Sabine', 'Seraphina', 'Sybil',
  'Tabitha', 'Theodora', 'Ursula', 'Verity', 'Vivienne', 'Winifred', 'Yseult',
  'Zelda', 'Brenna', 'Carys', 'Elinor', 'Guinevere', 'Marta',
];

const SURNAMES = [
  'Ironfist', 'Quixote', 'Blackthorn', 'Ravenscroft', 'Thornbury', 'Ashdown',
  'Greycloak', 'Stormwind', 'Halloway', 'Merriweather', 'Bracegirdle',
  'Fenwick', 'Underhill', 'Oakhurst', 'Sandringham', 'Whitlock', 'Ferrier',
  'Cobbleworth', 'Applegate', 'Winterbourne', 'Marchmont', 'Ravensworth',
  'Blackwood', 'Silverstone', 'Hawksmoor', 'Deepwater', 'Longshanks',
  'Trumbull', 'Vandermeer', 'Wexford', 'Yarborough', 'Ashcombe', 'Bellweather',
  'Crowhurst', 'Draycott', 'Eastcastle', 'Farthing', 'Goodfellow', 'Harkness',
  'Inglewood', 'Jessop', 'Kettleburn', 'Lockhart', 'Mossgrave', 'Nettlefold',
  'Ockham', 'Pemberton', 'Quillon', 'Rooksbridge', 'Stanhope', 'Tallowmere',
  'Umberly', 'Vail', 'Wilderby', 'Yewtree', 'Snergle', 'Grumbold', 'Dunsford',
];

const TITLES_M = ['Sir', 'Lord', 'Master', 'Brother', 'Captain', 'Baron', 'Father', 'Squire'];
const TITLES_F = ['Lady', 'Dame', 'Mistress', 'Sister', 'Captain', 'Baroness', 'Mother', 'Madame'];

const EPITHETS = [
  'the Bold', 'the Grim', 'the Wise', 'the Fat', 'the Lame', 'the Quick',
  'the Red', 'the Black', 'the Fair', 'the Cunning', 'the Elder', 'the Younger',
  'the Unlucky', 'the Pious', 'the Drunk', 'One-Eye', 'Longshanks', 'the Quiet',
];

/**
 * A person's name. `sex` is 'm', 'f' or omitted for either.
 * `opts.title` adds "Sir"/"Lady"; `opts.epithet` adds "the Bold".
 */
export function npcName(rand, sex, opts) {
  const o = opts || {};
  const s = sex === 'm' || sex === 'f' ? sex : (rand.bool() ? 'm' : 'f');
  const first = rand.pick(s === 'm' ? MALE_FIRST : FEMALE_FIRST);
  let name = first;
  if (o.surname !== false && rand.bool(o.surnameChance !== undefined ? o.surnameChance : 0.75)) {
    name += ' ' + rand.pick(SURNAMES);
  }
  if (o.epithet || (o.epithet !== false && rand.bool(0.08))) {
    name += ' ' + rand.pick(EPITHETS);
  }
  if (o.title || (o.title !== false && rand.bool(0.12))) {
    name = rand.pick(s === 'm' ? TITLES_M : TITLES_F) + ' ' + name;
  }
  return name;
}

/** Just a first name, for party members. */
export function firstName(rand, sex) {
  const s = sex === 'm' || sex === 'f' ? sex : (rand.bool() ? 'm' : 'f');
  return rand.pick(s === 'm' ? MALE_FIRST : FEMALE_FIRST);
}

/** A surname on its own, for family-owned shops. */
export function surname(rand) { return rand.pick(SURNAMES); }

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

const TOWN_PRE = [
  'Free', 'New', 'Old', 'Silver', 'White', 'Black', 'Green', 'Grey', 'Iron',
  'Stone', 'Salt', 'North', 'South', 'East', 'West', 'Kings', 'Queens',
  'Bright', 'Deep', 'High', 'Low', 'Rook', 'Raven', 'Thorn', 'Bell', 'Sweet',
];
const TOWN_POST = [
  'haven', 'ford', 'bridge', 'gate', 'field', 'wood', 'wick', 'thorpe',
  'burgh', 'shire', 'moor', 'combe', 'holm', 'stead', 'marsh', 'reach',
  'harbour', 'crossing', 'hollow', 'barrow', 'cove', 'watch', 'mill', 'bay',
];
const TOWN_WHOLE = [
  'New Sorpigal', 'Castle Ironfist', 'Free Haven', 'Silver Cove', 'Blackshire',
  'White Cap', 'Sweet Water', 'Mire of the Damned', 'Bootleg Bay', 'Kriegspire',
  'Darkmoor', 'Wetsand', 'Hermit\'s Isle', 'Alvar', 'Dunmoor',
];

/** A town name. Sometimes one of the canon towns, usually a fresh compound. */
export function townName(rand, opts) {
  const o = opts || {};
  if (o.canon || rand.bool(0.12)) return rand.pick(TOWN_WHOLE);
  const pre = rand.pick(TOWN_PRE);
  const post = rand.pick(TOWN_POST);
  // "Free haven" reads wrong; capitalise the second half when it is a noun.
  if (rand.bool(0.35)) return `${pre} ${post.charAt(0).toUpperCase()}${post.slice(1)}`;
  return pre + post;
}

const DUNGEON_THEME_WORDS = {
  cave: ['Caverns', 'Grotto', 'Hollows', 'Warrens', 'Deeps', 'Burrow'],
  crypt: ['Crypt', 'Tomb', 'Sepulchre', 'Ossuary', 'Barrow', 'Mausoleum', 'Catacombs'],
  temple: ['Temple', 'Shrine', 'Sanctum', 'Cathedral', 'Chantry', 'Abbey'],
  tower: ['Tower', 'Spire', 'Keep', 'Observatory', 'Sanctum', 'Citadel'],
  mine: ['Mines', 'Diggings', 'Shafts', 'Workings', 'Quarry', 'Seams'],
  sewer: ['Sewers', 'Drains', 'Undercity', 'Conduits', 'Cisterns'],
  ruins: ['Ruins', 'Remnants', 'Fallen Hall', 'Broken Keep', 'Old Stones'],
  lair: ['Lair', 'Den', 'Nest', 'Roost', 'Hoard', 'Pit'],
};

const DUNGEON_ADJ = [
  'Forgotten', 'Sunken', 'Shattered', 'Weeping', 'Silent', 'Howling', 'Frozen',
  'Blighted', 'Hidden', 'Accursed', 'Drowned', 'Burning', 'Whispering',
  'Endless', 'Nameless', 'Hollow', 'Bloodied', 'Withered', 'Gilded', 'Sunless',
];

const DUNGEON_OWNERS = [
  'Snergle', 'Ethric', 'Corlagon', 'Baa', 'Malwick', 'Thessaly', 'Vorkath',
  'Grumbold', 'Merrow', 'Ashcombe', 'Dredmor', 'Halvane', 'Sylvain', 'Kastore',
];

/** A dungeon name in the requested theme. */
export function dungeonName(rand, theme) {
  const words = DUNGEON_THEME_WORDS[theme] || DUNGEON_THEME_WORDS.cave;
  const noun = rand.pick(words);
  const roll = rand.float();
  if (roll < 0.35) return `${rand.pick(DUNGEON_OWNERS)}'s ${noun}`;
  if (roll < 0.7) return `The ${rand.pick(DUNGEON_ADJ)} ${noun}`;
  return `${noun} of ${rand.pick(DUNGEON_ADJ)} ${rand.pick(['Sorrow', 'Bone', 'Ash', 'Night', 'Silence', 'Winter', 'Fire', 'Stone'])}`;
}

// ---------------------------------------------------------------------------
// Establishments
// ---------------------------------------------------------------------------

const TAVERN_ADJ = [
  'Laughing', 'Drunken', 'Prancing', 'Rusty', 'Golden', 'Silver', 'Weary',
  'Jolly', 'Crooked', 'Sleeping', 'Dancing', 'Broken', 'Bellowing', 'Thirsty',
  'Salty', 'Wandering', 'Contented', 'Grumbling', 'Singing', 'Blind',
];
const TAVERN_NOUN = [
  'Goblin', 'Dragon', 'Pony', 'Boar', 'Griffin', 'Anchor', 'Barrel', 'Crown',
  'Knight', 'Minstrel', 'Mermaid', 'Ogre', 'Rooster', 'Stag', 'Tankard',
  'Wyvern', 'Sailor', 'Sorcerer', 'Bell', 'Hound', 'Lantern', 'Kettle',
];

/** "The Laughing Goblin", "The Rusty Anchor". */
export function tavernName(rand) {
  if (rand.bool(0.15)) return `The ${rand.pick(TAVERN_NOUN)} and ${rand.pick(TAVERN_NOUN)}`;
  return `The ${rand.pick(TAVERN_ADJ)} ${rand.pick(TAVERN_NOUN)}`;
}

const SHOP_KINDS = {
  weapon: {
    nouns: ['Armoury', 'Forge', 'Blades', 'Smithy', 'Weaponry', 'Steel'],
    adj: ['Keen', 'Tempered', 'Honest', 'Iron', 'Sure', 'Sharp'],
  },
  armor: {
    nouns: ['Armour', 'Plate & Mail', 'Ironworks', 'Bulwark', 'Shieldworks'],
    adj: ['Sturdy', 'Stout', 'Trusted', 'Old', 'Dwarven', 'Proven'],
  },
  magic: {
    nouns: ['Curiosities', 'Arcana', 'Sundries', 'Talismans', 'Emporium'],
    adj: ['Mystic', 'Hidden', 'Whispering', 'Curious', 'Odd', 'Elder'],
  },
  alchemy: {
    nouns: ['Apothecary', 'Alembic', 'Herbalist', 'Elixirs', 'Remedies'],
    adj: ['Bubbling', 'Green', 'Careful', 'Quiet', 'Bitter', 'Sweet'],
  },
  general: {
    nouns: ['Goods', 'Provisions', 'Sundries', 'Trading Post', 'Supplies'],
    adj: ['Honest', 'Cheap', 'Reliable', 'Fair', 'Busy', 'Corner'],
  },
  temple: {
    nouns: ['Temple', 'Shrine', 'Sanctuary', 'Chapel', 'House of Healing'],
    adj: ['Blessed', 'Quiet', 'Bright', 'Merciful', 'Sacred'],
  },
  guild: {
    nouns: ['Guild', 'Circle', 'Order', 'Conclave', 'Academy'],
    adj: ['Elemental', 'Self', 'Silver', 'Bright', 'Learned', 'Ancient'],
  },
  bank: { nouns: ['Bank', 'Counting House', 'Vault', 'Exchange'], adj: ['Sound', 'Iron', 'Sure', 'Royal'] },
  training: { nouns: ['Training Hall', 'Yard', 'School of Arms', 'Practice Grounds'], adj: ['Hard', 'Old', 'Royal', 'Free'] },
  stable: { nouns: ['Stables', 'Coaches', 'Waystation'], adj: ['Swift', 'Reliable', 'Royal', 'Old'] },
};

/** A shop name of the given kind. */
export function shopName(rand, kind) {
  const k = SHOP_KINDS[kind] || SHOP_KINDS.general;
  const roll = rand.float();
  if (roll < 0.4) return `${surname(rand)}'s ${rand.pick(k.nouns)}`;
  if (roll < 0.75) return `The ${rand.pick(k.adj)} ${rand.pick(k.nouns)}`;
  return `${rand.pick(k.adj)} ${rand.pick(k.nouns)} of ${townName(rand, { canon: rand.bool(0.5) })}`;
}

// ---------------------------------------------------------------------------
// Monsters and uniques
// ---------------------------------------------------------------------------

const UNIQUE_PRE = [
  'Grishnak', 'Vorlok', 'Mazgul', 'Skarn', 'Ghaz', 'Uruk', 'Thraxx', 'Zul',
  'Krug', 'Morgus', 'Vexis', 'Nulgath', 'Rathmor', 'Sszeth', 'Bal', 'Drung',
];
const UNIQUE_POST = [
  'the Devourer', 'the Bonecrusher', 'Foulbreath', 'the Unclean', 'Blackfang',
  'the Pale', 'Ironhide', 'the Thrice-Cursed', 'Gutrender', 'the Watcher',
  'Skullsplitter', 'the Whisperer', 'Rotgut', 'the Deathless', 'Bloodmaw',
];

/** A name for a named unique monster: "Grishnak the Devourer". */
export function uniqueMonsterName(rand, baseName) {
  const roll = rand.float();
  if (roll < 0.5) return `${rand.pick(UNIQUE_PRE)} ${rand.pick(UNIQUE_POST)}`;
  if (roll < 0.8) return `${rand.pick(UNIQUE_PRE)} the ${baseName || 'Terrible'}`;
  return `${baseName || 'Beast'} ${rand.pick(UNIQUE_POST)}`;
}

/** A flavour name for a monster group leader. */
export function monsterName(rand, baseName) {
  return rand.bool(0.5) ? uniqueMonsterName(rand, baseName) : `${rand.pick(UNIQUE_PRE)}`;
}

// ---------------------------------------------------------------------------
// Odds and ends
// ---------------------------------------------------------------------------

const PROFESSIONS = [
  'Blacksmith', 'Fisherman', 'Innkeeper', 'Guard', 'Scribe', 'Merchant',
  'Farmer', 'Herbalist', 'Sailor', 'Miner', 'Hunter', 'Priest', 'Beggar',
  'Bard', 'Cartographer', 'Cooper', 'Tanner', 'Baker', 'Stablehand', 'Squire',
  'Instructor', 'Pilgrim', 'Explorer', 'Gate Guard', 'Torch Bearer', 'Guide',
];

export function profession(rand) { return rand.pick(PROFESSIONS); }

/** A named hireling: "Elspeth Wexford, Cartographer". */
export function hirelingName(rand, sex) {
  return `${npcName(rand, sex, { title: false, epithet: false })}`;
}

/** A one-line rumour for the tavern. */
const RUMOURS = [
  'They say the mines under {town} were closed for a reason.',
  'A merchant out of {town} has not been seen in a fortnight.',
  'The temple of Baa is buying up land near {town}. Nobody knows why.',
  'There is a dragon in the hills. A real one, not a story.',
  'The lord of {town} pays well for goblin ears, and asks no questions.',
  'Something is wrong with the water east of {town}.',
  'A wizard died in his tower and left everything in it.',
  'The road to {town} is not safe after dark. It is not bandits.',
];

export function rumour(rand) {
  return rand.pick(RUMOURS).replace('{town}', townName(rand, { canon: rand.bool(0.6) }));
}

/** A line of shop-floor small talk keyed to the speaker's trade. */
const PROFESSION_TALK = {
  Blacksmith: 'Steel is honest work. Swing it enough and it swings true; neglect it and it neglects you.',
  Fisherman: 'The catch has been thin since spring. Something big moved into the bay, if you ask me.',
  Innkeeper: 'A warm bed and a hot meal fix more ills than any temple, and cost a good deal less.',
  Guard: 'Keep your blades sheathed inside the walls and we will get along fine.',
  Scribe: 'Everything worth knowing is written down somewhere. Finding the somewhere is the trade.',
  Merchant: 'Buy low, sell dear, and never let a goblin between you and a caravan.',
  Farmer: 'The soil is good here. It is everything that walks over it after dark that worries me.',
  Herbalist: 'Yellow flowers for fever, red for wounds. The blue ones you leave well alone.',
  Sailor: 'The eel-infested waters earn the name. I have seen the eels.',
  Miner: 'The deep shafts pay double. There is a reason they pay double.',
  Hunter: 'Wolves keep to the treeline this season. Whatever pushed them out of the hills, I have not met it.',
  Priest: 'The gods watch over the faithful. The rest of you should buy a good helmet.',
  Beggar: 'Spare a coin? The town has been hard on honest beggars since the troubles.',
  Bard: 'Every dungeon is three verses: going in, the terrible middle, and whoever comes out.',
  Cartographer: 'The old maps stop at the ridge. Nobody who went past it came back to correct them.',
  Cooper: 'Barrels do not make themselves, and half this town would starve without them.',
  Tanner: 'You bring me hides, I pay fair coin. Goblin leather is worthless, before you ask.',
  Baker: 'Up before dawn every day of my life. The smell is the only advertising I need.',
  Stablehand: 'Horses will not go near the old watchtower road. Horses are sensible that way.',
  Squire: 'One day I will be knighted. Until then I mostly carry things.',
  Instructor: 'Practice until the drill is boring, then practice more. Boring drills keep men alive.',
  Pilgrim: 'I have walked from shrine to shrine across half of Enroth. The roads are worse every year.',
  Explorer: 'There are doors under this island older than the kingdom. Most are better left shut.',
  'Gate Guard': 'The gate closes at dusk. Be inside it, or be quick on your feet.',
  'Torch Bearer': 'Light is a trade like any other. Down in the dark you would pay anything for it.',
  Guide: 'I know every path in the region - which ones you can walk, and which ones walk you.',
};

export function professionTalk(rand, prof) {
  return PROFESSION_TALK[prof]
    || `"${prof}? It is a living," comes the reply. "Some years better than others."`;
}

/** All the curated lists, for tooling and tests. */
export const WORD_LISTS = {
  MALE_FIRST, FEMALE_FIRST, SURNAMES, TITLES_M, TITLES_F, EPITHETS,
  TOWN_PRE, TOWN_POST, TOWN_WHOLE, DUNGEON_ADJ, DUNGEON_OWNERS,
  TAVERN_ADJ, TAVERN_NOUN, PROFESSIONS, UNIQUE_PRE, UNIQUE_POST,
};
