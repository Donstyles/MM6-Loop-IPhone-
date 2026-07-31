import * as THREE from 'three';
import { Rand, clamp, smoothstep, lerpN, fbm2, hash2 } from '../core/rng.js';
import {
  generateHeightmap, paintTiles, buildTerrain, heightAt, slopeAt, normalAt,
  flattenArea, carveRoad, stampTiles, makeBillboardField, floraTexture,
  getTexture, textureTint, texturesReady, TILE, MAP_TILES, PLAYABLE_EXTENT,
} from './terrain.js';
import { buildSky, FAR_CLIP, SHADE_DIST, timeTint, sunTerms, sunDirection, quantiseShade } from './sky.js';
import { generateTown } from './town.js';
import { monstersInLevelRange, MONSTER_IDS } from '../game/monsters.js';
import { MeshBuilder, buildRuins, buildHouse, addProp, materialFor, setBuildingLight } from './building.js';

// ---------------------------------------------------------------------------
// Regions.
//
// MM6's overland is a set of hand-authored 128x128 outdoor maps, each with its
// own palette of ground textures, its own fog colour, its own flora, and its
// own monsters. Crossing from New Sorpigal's green coast into Bootleg Bay's
// palms feels like a different place because *every* one of those changed at
// once, not just the grass tint. Each entry below changes all of them.
// ---------------------------------------------------------------------------

/** @type {Object<string, object>} */
export const REGIONS = {
  new_sorpigal: {
    name: 'New Sorpigal',
    blurb: 'Green rolling meadows above a southern bay.',
    difficulty: 1,
    profile: { base: 3346, freq: 7.0, detailAmp: 227, ridge: 548, ridgeFreq: 5.2, warp: 0.34 },
    coast: { dir: 'south', width: 0.26 },
    water: -960,
    cliffTex: 'cliff_rock', cliffSlope: 0.81, cliffDarken: 0.80,
    bands: [
      { tex: 'beach_wet', h: [0, 0.028] },
      { tex: 'sand', h: [0, 0.06] },
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'dirt', s: [0.66, 9] },
      { tex: 'forest_floor', m: [0.84, 1] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'grass' },
    ],
    fogClass: 'none', hazeTint: [0.62, 0.67, 0.73], sky: 'plansky3',
    skyTint: [1, 1, 1], cloudiness: 0.42,
    flora: [
      { kind: 'oak', density: 0.12, scale: [780, 1300], m: [0.40, 1], s: [0, 0.42], h: [0.10, 0.80] },
      { kind: 'pine', density: 0.03, scale: [850, 1400], m: [0.55, 1], s: [0, 0.5], h: [0.35, 0.9] },
      { kind: 'bush', density: 0.05, scale: [220, 380], s: [0, 0.45] },
      { kind: 'rock_large', density: 0.015, scale: [200, 420], s: [0.2, 0.9] },
    ],
    levels: [1, 6], monsters: ['goblin', 'goblin_shaman', 'wolf', 'bat', 'giant_rat', 'peasant_bandit'],
    towns: [{ name: 'New Sorpigal', size: 'town', coastal: true }],
    dungeons: [
      { name: 'Abandoned Temple', theme: 'temple', rooms: 14, levels: 2 },
      { name: 'Goblinwatch', theme: 'castle', rooms: 12, levels: 2 },
      { name: 'The Shadow Guild', theme: 'crypt', rooms: 13, levels: 3 },
    ],
    weather: 'clear',
  },

  ironfist: {
    name: 'Castle Ironfist',
    blurb: 'The King\'s castle above wheat fields and old oak forest.',
    difficulty: 2,
    profile: { base: 3003, freq: 5.8, detailAmp: 181, ridge: 717, ridgeFreq: 4.4, warp: 0.30, terrace: 600 },
    coast: null, water: -14336,
    cliffTex: 'cliff_rock', cliffSlope: 0.78, cliffDarken: 0.78,
    bands: [
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'dirt', s: [0.66, 9] },
      { tex: 'farmland', h: [0.18, 0.44], m: [0, 0.34] },
      { tex: 'forest_floor', m: [0.84, 1] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'grass' },
    ],
    fogClass: 'light', hazeTint: [0.60, 0.64, 0.70], sky: 'plansky3',
    skyTint: [0.98, 1.0, 1.02], cloudiness: 0.5,
    flora: [
      { kind: 'oak', density: 0.15, scale: [820, 1450], m: [0.36, 1], s: [0, 0.4] },
      { kind: 'pine', density: 0.04, scale: [900, 1500], m: [0.60, 1] },
      { kind: 'bush', density: 0.045, scale: [220, 380] },
      { kind: 'haystack_prop', density: 0.004, scale: [1, 1], h: [0.2, 0.45] },
    ],
    levels: [3, 12], monsters: ['bandit', 'wolf', 'goblin', 'harpy', 'skeleton', 'zombie'],
    towns: [{ name: 'Ironfist', size: 'city', castle: true }],
    dungeons: [
      { name: 'Castle Ironfist Dungeon', theme: 'castle', rooms: 16, levels: 3 },
      { name: 'Abandoned Mine', theme: 'mine', rooms: 14, levels: 3 },
      { name: 'The Barrow Downs', theme: 'crypt', rooms: 15, levels: 2 },
    ],
    weather: 'cloudy',
  },

  free_haven: {
    name: 'Free Haven',
    blurb: 'The great city of Enroth and the plains around it.',
    difficulty: 3,
    profile: { base: 2231, freq: 5.5, detailAmp: 159, ridge: 379, ridgeFreq: 3.9, warp: 0.26, flatten: 0.18 },
    coast: { dir: 'west', width: 0.20 },
    water: -1344,
    cliffTex: 'cliff_rock', cliffSlope: 0.84, cliffDarken: 0.80,
    bands: [
      { tex: 'beach_wet', h: [0, 0.04] },
      { tex: 'sand', h: [0, 0.09] },
      { tex: 'dirt', s: [0.66, 9] },
      { tex: 'farmland', m: [0, 0.30] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'grass' },
    ],
    fogClass: 'none', hazeTint: [0.64, 0.69, 0.74], sky: 'plansky3',
    skyTint: [1, 1, 1], cloudiness: 0.4,
    flora: [
      { kind: 'oak', density: 0.08, scale: [800, 1300], m: [0.44, 1] },
      { kind: 'bush', density: 0.05, scale: [220, 380] },
      { kind: 'flowers_white', density: 0.035, scale: [180, 300] },
    ],
    levels: [5, 15], monsters: ['bandit', 'thief', 'goblin', 'wolf', 'harpy', 'apprentice_mage'],
    towns: [{ name: 'Free Haven', size: 'city', coastal: true }, { name: 'Havenshire', size: 'village' }],
    dungeons: [
      { name: 'Temple of the Moon', theme: 'temple', rooms: 15, levels: 3 },
      { name: 'Free Haven Sewers', theme: 'sewer', rooms: 16, levels: 2 },
    ],
    weather: 'clear',
  },

  mist: {
    name: 'The Isle of Mist',
    blurb: 'A drowned island under permanent haze. Harpies nest on the crags.',
    difficulty: 5,
    profile: { base: 3861, freq: 8.7, detailAmp: 295, ridge: 1476, ridgeFreq: 6.8, warp: 0.42 },
    coast: { dir: 'ring', width: 0.30 },
    water: -576,
    cliffTex: 'cliff_rock', cliffSlope: 0.70, cliffDarken: 0.72,
    bands: [
      { tex: 'beach_wet', h: [0, 0.05] },
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'moss_rock', s: [0.60, 9] },
      { tex: 'swamp_muck', h: [0, 0.14] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'grass_dry' },
    ],
    fogClass: 'dense', hazeTint: [0.55, 0.58, 0.60], sky: 'plansky1',
    skyTint: [0.86, 0.90, 0.94], cloudiness: 0.86,
    flora: [
      { kind: 'dead_tree', density: 0.07, scale: [700, 1200] },
      { kind: 'pine', density: 0.05, scale: [800, 1300], m: [0.5, 1] },
      { kind: 'fern', density: 0.07, scale: [200, 340] },
      { kind: 'rock_large', density: 0.03, scale: [220, 500], s: [0.2, 0.9] },
    ],
    levels: [12, 24], monsters: ['harpy', 'gargoyle', 'wyvern', 'ghost', 'cutpurse'],
    towns: [{ name: 'Mist', size: 'village', coastal: true }],
    dungeons: [
      { name: 'The Mist Caves', theme: 'cave', rooms: 15, levels: 3 },
      { name: 'Temple of Baa', theme: 'temple', rooms: 16, levels: 3 },
    ],
    weather: 'fog',
  },

  bootleg_bay: {
    name: 'Bootleg Bay',
    blurb: 'White sand, palms, and lizardmen in the shallows.',
    difficulty: 2,
    profile: { base: 2231, freq: 6.4, detailAmp: 204, ridge: 801, ridgeFreq: 6.2, warp: 0.36 },
    coast: { dir: 'ring', width: 0.24 },
    water: -384,
    cliffTex: 'cliff_sand', cliffSlope: 0.76, cliffDarken: 0.84,
    bands: [
      { tex: 'beach_wet', h: [0, 0.06] },
      { tex: 'sand', h: [0, 0.22] },
      { tex: 'sand_dune', s: [0.62, 9], h: [0, 0.5] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'grass_dry' },
    ],
    fogClass: 'none', hazeTint: [0.72, 0.75, 0.74], sky: 'plansky2',
    skyTint: [1.06, 1.04, 0.98], cloudiness: 0.3,
    flora: [
      { kind: 'palm', density: 0.1, scale: [900, 1500], h: [0.03, 0.5] },
      { kind: 'bush', density: 0.05, scale: [220, 400], m: [0.4, 1] },
      { kind: 'rock_large', density: 0.015, scale: [200, 420], s: [0.25, 0.9] },
    ],
    levels: [3, 10], monsters: ['lizardman', 'lizard_archer', 'crocodile', 'giant_crab', 'pirate'],
    towns: [{ name: 'Bootleg Bay', size: 'village', coastal: true }],
    dungeons: [
      { name: 'The Temple of the Sun', theme: 'temple', rooms: 14, levels: 2 },
      { name: 'Cave of the Lizardmen', theme: 'cave', rooms: 14, levels: 2 },
    ],
    weather: 'clear',
  },

  silver_cove: {
    name: 'Silver Cove',
    blurb: 'A cold rocky coast under black pines.',
    difficulty: 4,
    profile: { base: 3861, freq: 7.5, detailAmp: 272, ridge: 1307, ridgeFreq: 5.2, warp: 0.36 },
    coast: { dir: 'north', width: 0.24 },
    water: -832,
    cliffTex: 'cliff_rock', cliffSlope: 0.68, cliffDarken: 0.74,
    bands: [
      { tex: 'beach_wet', h: [0, 0.04] },
      { tex: 'gravel', h: [0, 0.10] },
      { tex: 'moss_rock', s: [0.60, 9] },
      { tex: 'forest_floor', m: [0.84, 1] },
      { tex: 'grass' },
    ],
    fogClass: 'light', hazeTint: [0.54, 0.60, 0.67], sky: 'plansky1',
    skyTint: [0.92, 0.96, 1.02], cloudiness: 0.68,
    flora: [
      { kind: 'pine', density: 0.17, scale: [950, 1700], s: [0, 0.5] },
      { kind: 'pine_snow', density: 0.07, scale: [900, 1500] },
      { kind: 'rock_large', density: 0.03, scale: [220, 500], s: [0.2, 0.9] },
      { kind: 'stump', density: 0.01, scale: [180, 260] },
    ],
    levels: [10, 20], monsters: ['bandit', 'wolf', 'werewolf', 'ogre', 'harpy', 'gargoyle'],
    towns: [{ name: 'Silver Cove', size: 'town', coastal: true }],
    dungeons: [
      { name: 'The Silver Helm Outpost', theme: 'castle', rooms: 14, levels: 2 },
      { name: 'Corlagon\'s Estate', theme: 'ruins', rooms: 16, levels: 3 },
    ],
    weather: 'cloudy',
  },

  blackshire: {
    name: 'Blackshire',
    blurb: 'Dead forest over black water. Nothing here is still alive.',
    difficulty: 6,
    profile: { base: 2660, freq: 6.4, detailAmp: 249, ridge: 422, ridgeFreq: 4.7, warp: 0.40, flatten: 0.1 },
    coast: null, water: -2662,
    cliffTex: 'cliff_rock', cliffSlope: 0.74, cliffDarken: 0.66,
    bands: [
      { tex: 'swamp_muck', h: [0, 0.16] },
      { tex: 'mud', h: [0, 0.28], m: [0.5, 1] },
      { tex: 'moss_rock', s: [0.60, 9] },
      { tex: 'forest_floor', m: [0.84, 1] },
      { tex: 'grass_dry' },
    ],
    fogClass: 'light', hazeTint: [0.34, 0.38, 0.33], sky: 'plansky1',
    skyTint: [0.62, 0.66, 0.62], cloudiness: 0.9,
    flora: [
      { kind: 'dead_tree', density: 0.2, scale: [850, 1600] },
      { kind: 'mushroom_cluster', density: 0.04, scale: [200, 340] },
      { kind: 'reeds', density: 0.05, scale: [220, 380], h: [0, 0.2] },
      { kind: 'rock_large', density: 0.015, scale: [200, 400] },
    ],
    levels: [16, 30], monsters: ['zombie', 'skeleton', 'ghoul', 'vampire_bat', 'wight', 'necromancer'],
    towns: [{ name: 'Blackshire', size: 'village' }],
    dungeons: [
      { name: 'The Necromancers\' Guild', theme: 'crypt', rooms: 16, levels: 3 },
      { name: 'Blackshire Crypt', theme: 'crypt', rooms: 14, levels: 2 },
    ],
    weather: 'cloudy',
  },

  white_cap: {
    name: 'White Cap',
    blurb: 'Snowfields under a dwarven mountain.',
    difficulty: 5,
    profile: { base: 4290, freq: 6.4, detailAmp: 272, ridge: 3162, ridgeFreq: 4.9, warp: 0.34, bias: 1600 },
    coast: null, water: -18432,
    cliffTex: 'cliff_snow', cliffSlope: 0.70, cliffDarken: 0.78,
    bands: [
      { tex: 'snow_rock', s: [0.68, 9] },
      { tex: 'snow', h: [0.42, 1] },
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'tundra', m: [0, 0.45] },
      { tex: 'snow' },
    ],
    fogClass: 'light', hazeTint: [0.74, 0.79, 0.85], sky: 'plansky2',
    skyTint: [0.96, 0.99, 1.06], cloudiness: 0.62,
    flora: [
      { kind: 'pine_snow', density: 0.08, scale: [850, 1500], h: [0, 0.6] },
      { kind: 'rock_large', density: 0.04, scale: [220, 520], s: [0.2, 0.9] },
      { kind: 'pine', density: 0.03, scale: [800, 1300], h: [0, 0.5] },
    ],
    levels: [14, 26], monsters: ['ogre', 'yeti', 'ice_elemental', 'dwarf_raider', 'wolf'],
    towns: [{ name: 'White Cap', size: 'village' }],
    dungeons: [
      { name: 'The Dwarven Mines', theme: 'mine', rooms: 18, levels: 4 },
      { name: 'The Hall of the Fire Lord', theme: 'volcano', rooms: 14, levels: 2 },
    ],
    weather: 'snow',
  },

  kriegspire: {
    name: 'Kriegspire',
    blurb: 'Ash, black rock and dragons above the treeline.',
    difficulty: 8,
    profile: { base: 5148, freq: 6.4, detailAmp: 340, ridge: 4638, ridgeFreq: 5.5, warp: 0.40, bias: 1200 },
    coast: null, water: -26624,
    cliffTex: 'cliff_volcanic', cliffSlope: 0.65, cliffDarken: 0.66,
    bands: [
      { tex: 'volcanic_rock', s: [0.68, 9] },
      { tex: 'ash', h: [0.5, 1] },
      { tex: 'volcanic_rock', h: [0.66, 1] },
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'ash' },
    ],
    fogClass: 'light', hazeTint: [0.44, 0.36, 0.33], sky: 'plansky1',
    skyTint: [0.92, 0.72, 0.64], cloudiness: 0.8,
    flora: [
      { kind: 'dead_tree', density: 0.04, scale: [700, 1200], h: [0, 0.5] },
      { kind: 'rock_large', density: 0.07, scale: [240, 620], s: [0.15, 0.9] },
    ],
    levels: [26, 42], monsters: ['dragon', 'fire_elemental', 'magma_elemental', 'gargoyle', 'devil'],
    towns: [{ name: 'Kriegspire', size: 'village' }],
    dungeons: [
      { name: 'The Tomb of Varn', theme: 'volcano', rooms: 18, levels: 4 },
      { name: 'Dragon\'s Lair', theme: 'lair', rooms: 14, levels: 2 },
    ],
    weather: 'cloudy',
  },

  eel_infested_waters: {
    name: 'Eel Infested Waters',
    blurb: 'Marsh, reed and standing water as far as you can see.',
    difficulty: 4,
    profile: { base: 1459, freq: 5.2, detailAmp: 159, ridge: 0, warp: 0.44, flatten: 0.3 },
    coast: { dir: 'east', width: 0.34 },
    water: -192,
    cliffTex: 'cliff_rock', cliffSlope: 0.84, cliffDarken: 0.78,
    bands: [
      { tex: 'swamp_muck', h: [0, 0.20] },
      { tex: 'mud', h: [0, 0.36] },
      { tex: 'grass_lush', m: [0.40, 1] },
      { tex: 'swamp_muck', m: [0, 0.30] },
      { tex: 'grass_dry' },
    ],
    fogClass: 'light', hazeTint: [0.48, 0.52, 0.44], sky: 'plansky1',
    skyTint: [0.84, 0.88, 0.80], cloudiness: 0.72,
    flora: [
      { kind: 'reeds', density: 0.15, scale: [220, 420], h: [0, 0.3] },
      { kind: 'dead_tree', density: 0.07, scale: [700, 1300] },
      { kind: 'fern', density: 0.06, scale: [200, 340] },
    ],
    levels: [8, 18], monsters: ['eel', 'lizardman', 'swamp_troll', 'giant_leech', 'bog_beast'],
    towns: [{ name: 'Eelford', size: 'village', coastal: true }],
    dungeons: [
      { name: 'The Sunken Barge', theme: 'sewer', rooms: 12, levels: 2 },
      { name: 'Snergle\'s Caverns', theme: 'cave', rooms: 15, levels: 3 },
    ],
    weather: 'rain',
    waterTex: 'swamp_water',
  },

  dragonsand: {
    name: 'Dragonsand',
    blurb: 'A dead desert of shifting dunes and buried temples.',
    difficulty: 9,
    profile: { base: 2660, freq: 9.9, detailAmp: 340, ridge: 675, ridgeFreq: 10.4, warp: 0.5 },
    coast: null, water: -20480,
    cliffTex: 'cliff_sand', cliffSlope: 0.73, cliffDarken: 0.86,
    bands: [
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'sand_dune', h: [0.45, 1] },
      { tex: 'sand', m: [0.3, 1] },
      { tex: 'sand_dune' },
    ],
    fogClass: 'none', hazeTint: [0.80, 0.72, 0.56], sky: 'plansky2',
    skyTint: [1.10, 1.02, 0.82], cloudiness: 0.18,
    flora: [
      { kind: 'cactus', density: 0.025, scale: [300, 600] },
      { kind: 'rock_large', density: 0.025, scale: [220, 520] },
      { kind: 'dead_tree', density: 0.007, scale: [600, 1000] },
    ],
    levels: [30, 48], monsters: ['sand_worm', 'mummy', 'genie', 'scorpion', 'dragon'],
    towns: [{ name: 'The Oasis', size: 'village' }],
    dungeons: [
      { name: 'The Tomb of Ethric', theme: 'crypt', rooms: 18, levels: 4 },
      { name: 'The Hive', theme: 'lair', rooms: 16, levels: 3 },
    ],
    weather: 'clear',
  },

  frozen_highlands: {
    name: 'Frozen Highlands',
    blurb: 'Wind-scoured tundra where nothing grows above the knee.',
    difficulty: 7,
    profile: { base: 3861, freq: 5.8, detailAmp: 249, ridge: 1897, ridgeFreq: 4.4, warp: 0.30, terrace: 750 },
    coast: null, water: -22528,
    cliffTex: 'cliff_snow', cliffSlope: 0.68, cliffDarken: 0.76,
    bands: [
      { tex: 'snow_rock', s: [0.65, 9] },
      { tex: 'snow', h: [0.55, 1] },
      { tex: 'gravel', s: [0.86, 9] },
      { tex: 'tundra' },
    ],
    fogClass: 'light', hazeTint: [0.68, 0.74, 0.80], sky: 'plansky2',
    skyTint: [0.94, 0.98, 1.06], cloudiness: 0.66,
    flora: [
      { kind: 'pine_snow', density: 0.035, scale: [700, 1200], h: [0, 0.5] },
      { kind: 'rock_large', density: 0.06, scale: [220, 560], s: [0.15, 0.9] },
      { kind: 'bush_berry', density: 0.05, scale: [180, 300] },
    ],
    levels: [20, 34], monsters: ['yeti', 'ice_elemental', 'frost_giant', 'wolf', 'wyvern'],
    towns: [{ name: 'Highfrost', size: 'village' }],
    dungeons: [
      { name: 'The Ice Caverns', theme: 'ice', rooms: 16, levels: 3 },
      { name: 'Bloodrock Keep', theme: 'castle', rooms: 15, levels: 3 },
    ],
    weather: 'snow',
  },

  paradise_valley: {
    name: 'Paradise Valley',
    blurb: 'Impossibly green, impossibly quiet, and far too dangerous.',
    difficulty: 10,
    profile: { base: 3518, freq: 5.8, detailAmp: 204, ridge: 1897, ridgeFreq: 4.2, warp: 0.30 },
    coast: null, water: -9216,
    cliffTex: 'cliff_rock', cliffSlope: 0.76, cliffDarken: 0.82,
    bands: [
      { tex: 'moss_rock', s: [0.60, 9] },
      { tex: 'dirt', s: [0.66, 9] },
      { tex: 'forest_floor', m: [0.84, 1] },
      { tex: 'grass_lush' },
    ],
    fogClass: 'none', hazeTint: [0.62, 0.72, 0.64], sky: 'plansky3',
    skyTint: [1.02, 1.06, 1.00], cloudiness: 0.30,
    flora: [
      { kind: 'oak', density: 0.17, scale: [900, 1700], s: [0, 0.44] },
      { kind: 'flowers_white', density: 0.07, scale: [200, 340] },
      { kind: 'bush', density: 0.06, scale: [240, 420] },
      { kind: 'fern', density: 0.05, scale: [200, 340] },
    ],
    levels: [38, 60], monsters: ['titan', 'dragon', 'archmage', 'behemoth', 'devil'],
    towns: [{ name: 'The Retreat', size: 'village' }],
    dungeons: [
      { name: 'The Control Center', theme: 'tower', rooms: 18, levels: 4 },
      { name: 'The Hive of Kings', theme: 'lair', rooms: 16, levels: 3 },
    ],
    weather: 'clear',
  },
};

export const REGION_IDS = Object.keys(REGIONS);

/**
 * Resolve a region's spawn table against the live bestiary.
 *
 * The hand-written `monsters` lists in the table above are only a hint for what
 * *kind* of thing lives here; the authoritative set is whatever the bestiary
 * has in the region's level band, so the world keeps working when the bestiary
 * is rebuilt. Ids that no longer exist are dropped rather than spawned.
 */
export function spawnTableForRegion(def) {
  const [lo, hi] = def.levels || [1, 60];
  let ids = [];
  try {
    ids = monstersInLevelRange(lo, hi).map((m) => m.id);
  } catch (e) { ids = []; }
  if (!ids.length) ids = (def.monsters || []).filter((id) => MONSTER_IDS.includes(id));
  return ids.length ? ids : MONSTER_IDS.slice(0, 8);
}

// --- seasons ---------------------------------------------------------------
//
// A MM6-only feature: the terrain tileset and the tree sprites swap by month.
// Winter turns grass to snow, spring and autumn turn it to dirt, and flowers
// are culled outright outside summer.

export const SEASON_TILE_SWAP = {
  winter: { grass: 'snow', grass_lush: 'snow', grass_dry: 'snow_rock', farmland: 'snow', forest_floor: 'snow' },
  shoulder: { grass: 'dirt', grass_lush: 'dirt', farmland: 'dirt' },
  summer: null,
};

export const SEASON_FLORA_SWAP = {
  winter: { oak: 'dead_tree', birch: 'dead_tree', willow: 'dead_tree', pine: 'pine_snow' },
  shoulder: { oak: 'oak_autumn', birch: 'oak_autumn' },
  summer: null,
};

/** months 11,0,1 winter; 2,3,4 and 8,9,10 shoulder; 5,6,7 summer. */
export function seasonOf(month) {
  const m = ((month % 12) + 12) % 12;
  if (m === 11 || m === 0 || m === 1) return 'winter';
  if (m >= 5 && m <= 7) return 'summer';
  return 'shoulder';
}

const yieldNow = () => new Promise((res) => setTimeout(res, 0));

/**
 * Generate a whole outdoor region: terrain, sky, towns, dungeon entrances,
 * flora, props and spawn points.
 *
 * @param {string} regionId key into REGIONS
 * @param {number|string} seed
 * @param {(p:number,label:string)=>void} [onProgress]
 * @param {{scene?:THREE.Scene, camera?:THREE.Camera, night?:boolean}} [opts]
 */
export async function generateRegion(regionId, seed = 1, onProgress, opts = {}) {
  const def = REGIONS[regionId] ? REGIONS[regionId] : REGIONS.new_sorpigal;
  const id = REGIONS[regionId] ? regionId : 'new_sorpigal';
  const prog = onProgress || (() => { });
  const r = new Rand(typeof seed === 'string' ? `${id}:${seed}` : ((seed >>> 0) ^ (id.length * 7919)));

  // Lighting is baked, so the hour everything is generated at is fixed here.
  // 09:30 puts the sun low in the east, which is the reading that shows the
  // landform best; `terrain.setTimeOfDay` re-bakes it later without remeshing.
  const tod = opts.timeOfDay === undefined ? 9.5 : opts.timeOfDay;
  setBuildingLight(tod);

  // Seasonal tileset / flora swap.
  const season = seasonOf(opts.month === undefined ? 6 : opts.month);
  const tileSwap = SEASON_TILE_SWAP[season];
  const floraSwap = SEASON_FLORA_SWAP[season];
  const sdef = (tileSwap || floraSwap) ? {
    ...def,
    bands: def.bands.map((b) => (tileSwap && tileSwap[b.tex] ? { ...b, tex: tileSwap[b.tex] } : b)),
    flora: def.flora
      // Flowers are culled entirely outside summer, as in the original.
      .filter((f) => !(season !== 'summer' && f.kind.startsWith('flowers')))
      .map((f) => (floraSwap && floraSwap[f.kind] ? { ...f, kind: floraSwap[f.kind] } : f)),
  } : def;
  const spawnTable = spawnTableForRegion(def);

  prog(0.02, 'waking textures');
  await texturesReady;

  // --- terrain shape ------------------------------------------------------
  prog(0.06, 'raising land');
  const hm = generateHeightmap(r.int(1e9), {
    profile: def.profile,
    coast: def.coast,
    water: def.water,
    paint: false,
  });
  await yieldNow();

  const group = new THREE.Group();
  group.name = 'region:' + id;
  const half = (MAP_TILES * TILE) / 2;

  // --- settlement and dungeon siting -------------------------------------
  prog(0.16, 'siting settlements');
  // Prefer flat, dry, mid-altitude ground away from the map edge - the same
  // instincts a human level designer would apply.
  const scoreSite = (x, z) => {
    const h = heightAt(hm, x, z);
    if (h < hm.water + 260) return -1;
    const s = slopeAt(hm, x, z);
    let flat = 0;
    for (let a = 0; a < 8; a++) {
      const ax = x + Math.cos(a) * 1800, az = z + Math.sin(a) * 1800;
      flat += Math.abs(heightAt(hm, ax, az) - h);
    }
    const edge = Math.min(x + half, half - x, z + half, half - z);
    return (1 - clamp(s / 0.5, 0, 1)) * 2 - flat / 4000 + clamp(edge / 9000, 0, 1);
  };

  const sites = [];
  for (let k = 0; k < 700; k++) {
    const x = r.float(-half * 0.72, half * 0.72);
    const z = r.float(-half * 0.72, half * 0.72);
    sites.push({ x, z, score: scoreSite(x, z) });
  }
  sites.sort((a, b) => b.score - a.score);

  const chosen = [];
  const farEnough = (x, z, d) => chosen.every((c) => Math.hypot(c.x - x, c.z - z) > d);
  const townSpecs = def.towns || [];
  const townSites = [];
  for (const t of townSpecs) {
    const site = sites.find((s) => s.score > 0 && farEnough(s.x, s.z, 16000));
    if (!site) continue;
    chosen.push(site);
    townSites.push({ ...t, x: site.x, z: site.z });
  }
  const dungeonSites = [];
  for (const d of (def.dungeons || [])) {
    const site = sites.find((s) => s.score > -1 && farEnough(s.x, s.z, 9000));
    if (!site) continue;
    chosen.push(site);
    dungeonSites.push({ ...d, x: site.x, z: site.z });
  }
  await yieldNow();

  // --- roads --------------------------------------------------------------
  prog(0.24, 'laying roads');
  const roads = [];
  const roadTex = def.roadTex || 'road_dirt';
  const nodes = townSites.concat(dungeonSites);
  const linkRoad = (a, b, width) => {
    // Bend the road through a midpoint so it does not read as a ruled line.
    const mx = (a.x + b.x) / 2 + r.float(-2600, 2600);
    const mz = (a.z + b.z) / 2 + r.float(-2600, 2600);
    const pts = [];
    const P = [{ x: a.x, z: a.z }, { x: mx, z: mz }, { x: b.x, z: b.z }];
    for (let t = 0; t <= 16; t++) {
      const u = t / 16;
      // Quadratic bezier through the jittered midpoint.
      const iu = 1 - u;
      pts.push({
        x: iu * iu * P[0].x + 2 * iu * u * P[1].x + u * u * P[2].x,
        z: iu * iu * P[0].z + 2 * iu * u * P[1].z + u * u * P[2].z,
      });
    }
    roads.push({ points: pts, width, tex: roadTex });
  };
  for (let i = 0; i < townSites.length - 1; i++) linkRoad(townSites[i], townSites[i + 1], 820);
  for (const d of dungeonSites) {
    let best = townSites[0] || dungeonSites[0];
    for (const t of townSites) if (Math.hypot(t.x - d.x, t.z - d.z) < Math.hypot(best.x - d.x, best.z - d.z)) best = t;
    if (best && best !== d) linkRoad(best, d, 620);
  }

  // Town shelves are the only thing that levels the ground; MM6 roads are
  // transition tiles painted over whatever the terrain is doing, which is
  // exactly why they run straight over hilltops instead of cutting through.
  for (const t of townSites) {
    const R = t.size === 'city' ? 5600 : t.size === 'town' ? 3800 : 2400;
    flattenArea(hm, t.x, t.z, R * 0.95, heightAt(hm, t.x, t.z), 1.5);
  }
  await yieldNow();

  // --- texture classification --------------------------------------------
  prog(0.34, 'painting ground');
  paintTiles(hm, sdef);
  for (const rd of roads) carveRoad(hm, rd.points, { width: rd.width, tex: rd.tex });
  await yieldNow();

  // --- towns --------------------------------------------------------------
  prog(0.44, 'building towns');
  const towns = [];
  const colliders = [];
  for (const t of townSites) {
    const town = generateTown({
      name: t.name, size: t.size, x: t.x, z: t.z, hm,
      coastal: !!t.coastal, region: id, night: opts.night,
      roadTex: t.size === 'village' ? 'road_dirt' : 'road_cobble',
      hazeTint: def.hazeTint, fogFar: FAR_CLIP,
      treeKind: (sdef.flora[0] || {}).kind || 'oak',
      wallTex: id === 'kriegspire' ? 'wall_castle_dark' : 'wall_castle',
    }, r.int(1e9));
    group.add(town.group);
    towns.push(town);
    for (const c of town.colliders) colliders.push(c);
    await yieldNow();
  }

  // --- dungeon entrances --------------------------------------------------
  prog(0.58, 'sealing dungeons');
  const dungeons = [];
  const propBuilder = new MeshBuilder();
  for (const d of dungeonSites) {
    const y = heightAt(hm, d.x, d.z);
    flattenArea(hm, d.x, d.z, 900, y, 1.5);
    stampTiles(hm, d.x, d.z, 900, 900, 'gravel', (x, z) => Math.hypot(x - d.x, z - d.z) < 800);
    const rot = r.float(0, Math.PI * 2);
    // Entrance: two piers, a lintel and a black doorway cut into the hillside.
    const sub = new MeshBuilder();
    const wallTex = d.theme === 'cave' || d.theme === 'mine' ? 'cliff_rock' : 'wall_stone_block';
    sub.box(wallTex, -420, 0, -140, -160, 640, 140, { sides: 'nsewt', vv: 2 });
    sub.box(wallTex, 160, 0, -140, 420, 640, 140, { sides: 'nsewt', vv: 2 });
    sub.box(wallTex, -430, 640, -150, 430, 820, 150, { sides: 'nsewt', uu: 3, vv: 0.6 });
    sub.quad('door_dungeon', [-160, 0, 145], [160, 0, 145], [160, 600, 145], [-160, 600, 145], { uu: 1, vv: 2, extra: 0.55 });
    sub.box('wall_stone_block', -520, 0, 140, 520, 60, 420, { sides: 'nsewt', uu: 3, vv: 0.2 });
    propBuilder.absorb(sub, new THREE.Matrix4().makeRotationY(rot).setPosition(d.x, y, d.z));
    colliders.push({ type: 'obb', x: d.x, z: d.z, hw: 430, hd: 150, rot, y0: y, y1: y + 820 });
    const dseed = r.int(1e9);
    dungeons.push({
      id: `${id}:${d.name}`.replace(/\s+/g, '_').toLowerCase(),
      name: d.name, theme: d.theme, x: d.x, y, z: d.z, rot,
      rooms: d.rooms, levels: d.levels, seed: dseed, difficulty: def.difficulty,
      entrance: new THREE.Vector3(d.x + Math.sin(rot) * 220, y, d.z + Math.cos(rot) * 220),
      spec: {
        theme: d.theme, name: d.name, rooms: d.rooms, levels: d.levels,
        difficulty: def.difficulty, spawnTable, exitTo: id, seed: dseed,
      },
    });
  }

  // --- scenery ------------------------------------------------------------
  prog(0.66, 'scattering scenery');
  const props = [];
  for (let i = 0; i < 5; i++) {
    const x = r.float(-half * 0.85, half * 0.85), z = r.float(-half * 0.85, half * 0.85);
    if (heightAt(hm, x, z) < hm.water + 200) continue;
    if (!townSites.every((t) => Math.hypot(t.x - x, t.z - z) > 6000)) continue;
    const ru = buildRuins({ x, y: heightAt(hm, x, z), z, radius: r.float(500, 900), seed: r.int(1e9), tex: def.cliffTex === 'cliff_sand' ? 'wall_sandstone' : 'wall_stone_block' }, r);
    propBuilder.absorb(ru.parts);
    for (const c of ru.colliders) colliders.push(c);
    props.push({ kind: 'ruins', x, z, y: heightAt(hm, x, z) });
  }
  // A wayside shrine or signpost where two roads meet.
  for (const rd of roads) {
    const p = rd.points[Math.floor(rd.points.length / 2)];
    const y = heightAt(hm, p.x, p.z);
    addProp(propBuilder, 'signpost', p.x + 520, y, p.z + 520, r.float(0, 6.28), r);
    props.push({ kind: 'signpost', x: p.x + 520, y, z: p.z + 520 });
  }
  const propMesh = propBuilder.isEmpty() ? null : propBuilder.finish();
  if (propMesh) { propMesh.updateMatrix(); group.add(propMesh); }
  await yieldNow();

  // --- terrain mesh -------------------------------------------------------
  prog(0.76, 'meshing terrain');
  const terrain = buildTerrain(hm, {
    timeOfDay: tod,
    cliffDarken: def.cliffDarken,
    fogFar: FAR_CLIP,
    waterTex: def.waterTex || 'water',
  });
  group.add(terrain.group);
  await yieldNow();

  // --- flora --------------------------------------------------------------
  prog(0.86, 'planting');
  const flora = scatterFlora(hm, sdef, r, townSites, { fogNear: SHADE_DIST, fogFar: FAR_CLIP });
  group.add(flora.group);
  await yieldNow();

  // --- monster spawns -----------------------------------------------------
  prog(0.94, 'seeding monsters');
  const spawns = [];
  const nSpawn = 90;
  for (let i = 0; i < nSpawn; i++) {
    const x = r.float(-half * 0.94, half * 0.94), z = r.float(-half * 0.94, half * 0.94);
    const y = heightAt(hm, x, z);
    if (y < hm.water + 120) continue;
    // Keep the roads and the town approaches survivable at low level.
    const nearTown = townSites.some((t) => Math.hypot(t.x - x, t.z - z) < 5200);
    if (nearTown && r.bool(0.75)) continue;
    spawns.push({
      x, y, z,
      id: r.pick(spawnTable),
      level: clamp(def.difficulty + r.int(-1, 2), 1, 20),
      count: r.int(1, 3),
      respawn: 60 * 60 * 24 * 7,
    });
  }

  // --- sky ----------------------------------------------------------------
  // Always built, and parented to the region group rather than the scene, so a
  // host that adds `region.group` and never passes us a scene still gets a sky.
  // It drives itself from onBeforeRender, so it also survives a host that never
  // calls region.update().
  const sky = buildSky(opts.scene || null, { camera: opts.camera, region: def });
  sky.setRegion(def);
  if (!opts.scene) group.add(sky.group);

  const water = [{ level: hm.water, tex: def.waterTex || 'water', mesh: terrain.water }];

  // --- automap plate ------------------------------------------------------
  prog(0.97, 'drawing the map');
  const minimap = buildMinimapPlate(hm, def, towns, dungeons, roads);

  prog(1, 'ready');

  return {
    minimap,
    /**
     * Blit the pre-rendered top-down plate, MM6-style: outdoors the automap is
     * an image, not a vector redraw. `zoom` is the world span the rect covers.
     */
    drawMinimap(ctx, rect, player, zoom = 16384) {
      const span = (MAP_TILES * TILE);
      const px = ((player ? player.x : 0) - hm.origin) / span * minimap.width;
      const pz = ((player ? player.z : 0) - hm.origin) / span * minimap.height;
      const crop = (zoom / span) * minimap.width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      const aspect = rect.h / rect.w;
      ctx.drawImage(
        minimap,
        px - crop / 2, pz - crop * aspect / 2, crop, crop * aspect,
        rect.x, rect.y, rect.w, rect.h,
      );
      ctx.restore();
    },
    /** Grey world light at a point, for tinting sprites the same as geometry. */
    lightAt(x, y, z) {
      const st = sunTerms(sky.state.tod);
      const n = normalAt(hm, x, z);
      const sun = sunDirection(sky.state.tod);
      const ndl = Math.max(0, n.x * sun.x + n.y * sun.y + n.z * sun.z);
      // Standing on a slope should not darken a sprite, so use a flat-ish
      // normal blend; MM6 tints billboards by the sector/terrain light only.
      const s = clamp(st.ambient * 0.75 + clamp(st.diffuse * (0.55 + 0.45 * ndl), 0, 0.85) * 0.68, 0, 1);
      const g = quantiseShade(s) * sky.state.tint;
      return { r: g, g, b: g };
    },
    /** Footstep / splash surface class under a point. */
    surfaceAt(x, z) {
      if (heightAt(hm, x, z) < hm.water) return 'water';
      const i = clamp(Math.floor((x - hm.origin) / hm.tile), 0, hm.size - 1);
      const j = clamp(Math.floor((z - hm.origin) / hm.tile), 0, hm.size - 1);
      return SURFACE_OF[hm.texIds[hm.tileTex[j * hm.size + i]]] || 'grass';
    },
    id, name: def.name, def, hm, terrain, sky, group,
    towns, dungeons, props, spawns, colliders, water, roads,
    flora,
    bounds: { min: new THREE.Vector3(-half, hm.min, -half), max: new THREE.Vector3(half, hm.max, half), radius: half },
    ambient: sunTerms(tod),
    fogClass: def.fogClass, hazeTint: def.hazeTint,
    weather: def.weather,
    difficulty: def.difficulty,
    season, spawnTable,
    heightAt: (x, z) => heightAt(hm, x, z),
    slopeAt: (x, z) => slopeAt(hm, x, z),
    normalAt: (x, z) => normalAt(hm, x, z),
    update(dt, camera, timeOfDay, weather) {
      // Sky first: it owns the haze colour and the fog band, and everything
      // else has to be told the same numbers or the horizon seam shows.
      if (sky) {
        sky.update(dt, timeOfDay, weather || def.weather, camera);
        const f = opts.scene && opts.scene.fog;
        if (f) {
          const light = sky.state.tint;
          for (const b of flora.batches) b.mesh.userData.setFog(f.color, f.near, f.far, light);
          for (const t of towns) if (t.trees) t.trees.userData.setFog(f.color, f.near, f.far, light);
        }
      }
      terrain.update(camera, dt);
      flora.update(camera);
      for (const t of towns) t.update(camera);
    },
    setTimeOfDay(hours) { terrain.setTimeOfDay(hours); },
    dispose() {
      terrain.dispose();
      flora.dispose();
      if (sky) sky.dispose();
    },
    get stats() { return { chunks: terrain.state.drawn, terrainTris: terrain.state.tris, floraBatches: flora.state.drawn }; },
  };
}

// ---------------------------------------------------------------------------

/** Which footstep sound each terrain texture belongs to. */
const SURFACE_OF = {
  grass: 'grass', grass_dry: 'grass', grass_lush: 'grass', farmland: 'grass',
  forest_floor: 'grass', tundra: 'grass', moss_rock: 'stone',
  dirt: 'grass', mud: 'grass', swamp_muck: 'water', beach_wet: 'water',
  road_dirt: 'grass', road_cobble: 'stone', gravel: 'stone',
  sand: 'grass', sand_dune: 'grass',
  snow: 'snow', snow_rock: 'snow', cliff_snow: 'snow',
  ash: 'stone', volcanic_rock: 'stone',
  cliff_rock: 'stone', cliff_sand: 'stone', cliff_volcanic: 'stone',
  water: 'water', water_deep: 'water', swamp_water: 'water', lava: 'stone',
};

/**
 * Pre-render the top-down automap plate once.
 *
 * MM6's outdoor automap is a bitmap the game samples and blits, not a vector
 * redraw, so the panel just crops this image around the party. Tile colours
 * come from the terrain palette, then roads, water and settlements go on top.
 */
function buildMinimapPlate(hm, def, towns, dungeons, roads) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const step = hm.size / S;

  const tint = {};
  for (const id of hm.texIds) tint[id] = textureTint(id);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = Math.min(hm.size - 1, (x * step) | 0);
      const j = Math.min(hm.size - 1, (y * step) | 0);
      const id = hm.texIds[hm.tileTex[j * hm.size + i]];
      const t = tint[id] || tint[hm.texIds[0]];
      const h = hm.height[j * (hm.size + 1) + i];
      let r = t.r * 255, gg = t.g * 255, b = t.b * 255;
      if (h < hm.water) { r = 34; gg = 62; b = 96; }
      else {
        // Relief shading so the plate reads as landform, not a colour blob.
        const hl = hm.height[j * (hm.size + 1) + Math.max(0, i - 1)];
        const k = clamp(1 + (h - hl) / 700, 0.62, 1.38);
        r *= k; gg *= k; b *= k;
      }
      const o = (y * S + x) * 4;
      img.data[o] = clamp(r, 0, 255);
      img.data[o + 1] = clamp(gg, 0, 255);
      img.data[o + 2] = clamp(b, 0, 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const toPx = (wx, wz) => [
    (wx - hm.origin) / (hm.size * hm.tile) * S,
    (wz - hm.origin) / (hm.size * hm.tile) * S,
  ];

  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#b09468';
  g.lineWidth = 1.6;
  for (const rd of roads) {
    g.beginPath();
    rd.points.forEach((p, i) => {
      const [x, y] = toPx(p.x, p.z);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }
  for (const t of towns) {
    const [x, y] = toPx(t.x, t.z);
    const r = Math.max(2.5, t.radius / (hm.size * hm.tile) * S);
    g.fillStyle = '#d8cba0';
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.strokeStyle = '#4a4030';
    g.lineWidth = 1;
    g.strokeRect(x - r, y - r, r * 2, r * 2);
  }
  for (const d of dungeons) {
    const [x, y] = toPx(d.x, d.z);
    g.fillStyle = '#201814';
    g.beginPath(); g.arc(x, y, 2.2, 0, 6.2832); g.fill();
  }
  return c;
}

const FLORA_BUCKET = 16;   // tiles per flora batch, 8192 units

/**
 * Scatter every flora kind over the map and bucket the instances spatially, so
 * a distant forest costs nothing. One draw call per (kind, visible bucket).
 */
function scatterFlora(hm, def, rand, townSites, fogOpts) {
  const group = new THREE.Group();
  group.name = 'flora';
  const size = hm.size;
  const buckets = Math.ceil(size / FLORA_BUCKET);
  const span = Math.max(1, hm.max - hm.water);
  const batches = [];

  for (const f of (def.flora || [])) {
    if (f.kind.endsWith('_prop')) continue;      // handled by the prop builder
    const lists = new Map();
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (rand.next() > f.density) continue;
        const x = hm.origin + (i + rand.next()) * hm.tile;
        const z = hm.origin + (j + rand.next()) * hm.tile;
        const y = heightAt(hm, x, z);
        if (y < hm.water + 80) continue;
        if (hm.roadMask[j * size + i]) continue;
        const hn = clamp((y - hm.water) / span, 0, 1);
        if (f.h && (hn < f.h[0] || hn > f.h[1])) continue;
        const s = slopeAt(hm, x, z);
        if (f.s && (s < f.s[0] || s > f.s[1])) continue;
        if (!f.s && s > 0.55) continue;
        const m = 0.5 + 0.5 * fbm2(i * 0.045, j * 0.045, 3, 2, 0.5, hm.seed + 5501);
        if (f.m && (m < f.m[0] || m > f.m[1])) continue;
        // Clearings around settlements; MM6 never buries a town in trees.
        let nearTown = false;
        for (const t of townSites) if (Math.hypot(t.x - x, t.z - z) < (t.size === 'city' ? 6600 : t.size === 'town' ? 4600 : 3000)) { nearTown = true; break; }
        if (nearTown) continue;

        const bi = Math.min(buckets - 1, Math.floor(i / FLORA_BUCKET));
        const bj = Math.min(buckets - 1, Math.floor(j / FLORA_BUCKET));
        const key = bj * buckets + bi;
        let l = lists.get(key);
        if (!l) { l = []; lists.set(key, l); }
        const sc = f.scale ? lerpN(f.scale[0], f.scale[1], rand.next()) : 900;
        // Slight per-instance tint keeps a forest from looking stamped.
        const v = 0.86 + rand.next() * 0.26;
        l.push({ x, y, z, w: sc * (0.82 + rand.next() * 0.3), h: sc, tint: [v, v * (0.94 + rand.next() * 0.12), v * 0.94] });
      }
    }
    const tex = floraTexture(f.kind, 7);
    for (const [key, list] of lists) {
      if (!list.length) continue;
      const mesh = makeBillboardField(tex, list, fogOpts);
      if (!mesh) continue;
      let cx = 0, cz = 0, maxR = 0;
      for (const it of list) { cx += it.x; cz += it.z; }
      cx /= list.length; cz /= list.length;
      for (const it of list) maxR = Math.max(maxR, Math.hypot(it.x - cx, it.z - cz) + it.h);
      mesh.frustumCulled = false;
      group.add(mesh);
      batches.push({ mesh, cx, cz, r: maxR, count: list.length });
    }
  }

  const frustum = new THREE.Frustum();
  const mat4 = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const state = { drawn: 0, total: batches.length };
  const far = fogOpts.fogFar || 6000;

  return {
    group, batches, state,
    update(camera) {
      mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(mat4);
      let drawn = 0;
      for (const b of batches) {
        sphere.center.set(b.cx, camera.position.y, b.cz);
        sphere.radius = b.r;
        const d = Math.hypot(camera.position.x - b.cx, camera.position.z - b.cz) - b.r;
        const vis = d < far && frustum.intersectsSphere(sphere);
        b.mesh.visible = vis;
        if (vis) { drawn++; b.mesh.userData.updateBillboard(camera); }
      }
      state.drawn = drawn;
    },
    dispose() { for (const b of batches) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); } },
  };
}
