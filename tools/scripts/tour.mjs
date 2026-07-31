// A gameplay tour for frame-sheet review: walk the world, fight, visit a town,
// drop into a dungeon, and open every interface panel.
//
//   node tools/framesheet.mjs tools/scripts/tour.mjs shots/sheets/tour.png

const wait = (ms) => ({ wait: ms });

export default [
  { name: 'spawn — morning', js: '__mm6.setTime(9,0)', wait: 900 },
  { name: 'look around', js: '__mm6.look(0.7, 0)', wait: 500 },
  { name: 'walk forward', js: '__mm6.walk(1,0,1200)', wait: 1400 },
  { name: 'walk forward 2', js: '__mm6.walk(1,0,1600)', wait: 1800 },
  { name: 'turn right', js: '__mm6.look(1.4, 0)', wait: 500 },
  { name: 'look down', js: '__mm6.look(0, -0.3)', wait: 400 },
  { name: 'look up', js: '__mm6.look(0, 0.6)', wait: 400 },
  { name: 'level view', js: '__mm6.look(0, -0.3)', wait: 400 },

  { name: 'midday', js: '__mm6.setTime(13,0)', wait: 600 },
  { name: 'explore', js: '__mm6.walk(1,0,2000)', wait: 2200 },
  { name: 'dusk', js: '__mm6.setTime(19,30)', wait: 600 },
  { name: 'night', js: '__mm6.setTime(23,0)', wait: 600 },
  { name: 'dawn', js: '__mm6.setTime(6,0)', wait: 600 },
  { name: 'back to day', js: '__mm6.setTime(12,0)', wait: 600 },

  { name: 'spawn goblins', js: '__mm6.spawn("GoblinA", 900); __mm6.spawn("GoblinB", 1200); __mm6.spawn("GoblinA", 700)', wait: 900 },
  { name: 'combat approach', js: null, wait: 1200 },
  { name: 'attack', js: '__mm6.attack()', wait: 500 },
  { name: 'attack 2', js: '__mm6.attack()', wait: 700 },
  { name: 'attack 3', js: '__mm6.attack()', wait: 700 },

  { name: 'character sheet', js: '__mm6.open("charsheet")', wait: 500 },
  { name: 'inventory', js: '__mm6.open("inventory")', wait: 500 },
  { name: 'spellbook', js: '__mm6.open("spellbook")', wait: 500 },
  { name: 'quest log', js: '__mm6.open("questlog")', wait: 500 },
  { name: 'map', js: '__mm6.open("mapscreen")', wait: 500 },
  { name: 'quick reference', js: '__mm6.open("quickref")', wait: 500 },
  { name: 'rest', js: '__mm6.open("rest")', wait: 500 },
  { name: 'options', js: '__mm6.open("options")', wait: 500 },
  { name: 'close', js: '__mm6.close()', wait: 400 },

  { name: 'dungeon', js: '__mm6.dungeon({theme:"cave"})', wait: 3000 },
  { name: 'dungeon walk', js: '__mm6.walk(1,0,1200)', wait: 1400 },
  { name: 'dungeon look', js: '__mm6.look(1.0, 0)', wait: 500 },
  { name: 'dungeon walk 2', js: '__mm6.walk(1,0,1400)', wait: 1600 },
];
