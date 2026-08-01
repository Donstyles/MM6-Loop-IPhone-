// Monster sprite legibility, in the actual game.
//
// The sprite contact sheets can look perfect while the game shows black
// smudges, because the atlas is only half the path to the screen: the world
// tint, the billboard shader's 32-step quantise, the fog blend and the entity
// scale all sit between them. This puts real monsters at real distances in a
// real lit world and grabs the frames.
//
//   ./tools/capserver.sh
//   MM6_URL=http://127.0.0.1:5174/ MM6_OUT=shots/sprfix MM6_CLEAN=1 \
//     node tools/capture.mjs tools/scripts/quickcombat.mjs
//
// Turn-based mode is switched on before anything is spawned. It freezes the
// monster AI (session.js sets ctx.frozen), which is the only way to hold a pack
// at a chosen distance - left to themselves they all close to melee in the
// first second and pile up on the camera, which tells you nothing about how a
// monster reads at 6 or 10 m.

const CLEAR = 'for (const e of __mm6.session.entities.list) if (e.category === "monster") e.remove = true;';

/**
 * Spawn a group and point every monster at the party.
 *
 * The extra PI is not decoration: the AI stores yaw in the engine's
 * -Z-forward convention (ARCHITECTURE: "yaw 0 = looking down -Z") while
 * `angleIndex` in src/ents/billboard.js picks the octant with
 * `rel = toCam - yaw`, which selects octant 0 - the model's front - only when
 * the yaw is +Z-forward. The two are 180 degrees apart, so in play every
 * monster that faces the party renders back-to. Until that is fixed in the
 * shell, these frames cancel it by hand so the front views can be checked.
 */
const spawn = (list) => CLEAR + list.map(([k, d]) => `
  { const e = __mm6.spawn("${k}", ${d});
    if (e) e.yaw = Math.atan2(__mm6.session.player.pos.x - e.pos.x,
                              __mm6.session.player.pos.z - e.pos.z); }`).join('');

export default [
  ['00-world', '__mm6.newGame(); __mm6.setTime(12,0); __mm6.session.toggleTurnBased()', 2600],

  // A goblin at melee range, filling as much of the viewport as it ever will.
  ['01-goblin-close', spawn([['GoblinA', 600]]), 1400],
  // The judge's frame: a pack at mixed range on lit ground at noon.
  ['02-goblin-pack', spawn([['GoblinA', 700], ['GoblinB', 1000], ['GoblinA', 1350]]), 1600],
  // Small creatures, where legibility is hardest.
  ['03-critters', spawn([['RatA', 620], ['BatA', 800], ['RatB', 1050]]), 1600],
  // A mixed line-up: four families that must not be confusable with each other.
  ['04-mixed', spawn([['GoblinA', 700], ['SkeletonA', 950], ['OgreA', 1200], ['SpiderA', 800]]), 1600],

  ['05-melee', spawn([['GoblinA', 620], ['GoblinC', 900]]) + ' __mm6.session.toggleTurnBased();', 900],
  ['06-attack', '__mm6.attack()', 800],

  // Same sprites under the evening and night ramps: the world tint must dim
  // them with the terrain rather than crushing them to black.
  ['07-dusk', '__mm6.setTime(19,30)', 1400],
  ['08-night', '__mm6.setTime(23,30)', 1400],
  ['09-noon-again', '__mm6.setTime(12,0)', 1400],

  // And indoors, where the sector ambient is the only light there is.
  ['10-dungeon', '__mm6.dungeon({ id:"goblinwatch", name:"Goblinwatch", theme:"castle", rooms:10, levels:1 })', 8000],
  ['11-dungeon-goblins',
    'if (__mm6.session && !__mm6.session.turnBased) __mm6.session.toggleTurnBased();' + spawn([['GoblinA', 620], ['GoblinC', 950]]), 2200],
];
