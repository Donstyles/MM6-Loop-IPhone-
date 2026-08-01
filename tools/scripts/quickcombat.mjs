// Monster/NPC sprite legibility, in the actual game.
//
// The sprite contact sheets can look perfect while the game shows black
// smudges, because the atlas is only half the path to the screen - the world
// tint, the billboard shader's 32-step quantise, the fog blend and the entity
// scale all sit between them. This script puts real monsters at real distances
// in a real lit world and grabs the frames.
//
//   ./tools/capserver.sh
//   MM6_URL=http://127.0.0.1:5174/ MM6_OUT=shots/sprfix MM6_CLEAN=1 \
//     node tools/capture.mjs tools/scripts/quickcombat.mjs

const noon = '__mm6.newGame(); __mm6.setTime(12,0)';

// 600-1400 units is melee-to-a-few-tiles: the range a monster is actually
// fought at, and the range the judge measured the goblin at.
const pack = (list) => list.map(([k, d]) => `__mm6.spawn("${k}",${d})`).join('; ');

export default [
  ['00-world', noon, 2400],

  // A goblin at melee range, filling as much of the viewport as it ever will.
  ['01-goblin-close', pack([['GoblinA', 600]]), 2000],
  // The judge's frame: a pack at mixed range on lit ground at noon.
  ['02-goblin-pack', pack([['GoblinB', 900], ['GoblinA', 1200]]), 2000],
  // Small creatures, where legibility is hardest.
  ['03-critters', pack([['RatA', 620], ['BatA', 800], ['RatB', 1000]]), 2000],
  ['04-attack', '__mm6.attack()', 900],
  ['05-turnbased', '__mm6.session.toggleTurnBased()', 900],

  // Front views. The AI stores yaw in the engine's -Z-forward convention while
  // `angleIndex` in src/ents/billboard.js picks the octant with
  // `rel = toCam - yaw` (no PI), so a monster charging the party renders
  // back-to. Turn-based freezes the AI, so adding the missing PI by hand here
  // shows what the octant-0 art looks like in world until that is fixed.
  ['05b-facing',
    'for (const e of __mm6.session.entities.list) if (e.category === "monster") e.yaw += Math.PI;', 700],

  // Same sprites under the evening ramp: the world tint must dim them with the
  // terrain, not crush them to black.
  ['06-dusk', '__mm6.setTime(19,30)', 1400],
  ['06b-night', '__mm6.setTime(23,30)', 1400],
  ['07-noon-again', '__mm6.setTime(12,0); __mm6.session.toggleTurnBased()', 1400],

  // And indoors, where the sector ambient is the only light.
  ['08-dungeon', '__mm6.dungeon({ id:"goblinwatch", name:"Goblinwatch", theme:"castle", rooms:10, levels:1 })', 5000],
  ['09-dungeon-goblins', pack([['GoblinA', 620], ['GoblinC', 900]]), 2200],
];
