// The set of frames handed to the visual judge: one full-resolution PNG per
// situation the game can be in, so each can be studied on its own.
//
//   node tools/capture.mjs tools/scripts/judgeset.mjs
// (writes into shots/, or MM6_OUT)

export default [
  ['01-title', null, 1200],
  ['02-chargen', '__mm6.open("chargen")', 900],
  ['03-outdoor-morning', '__mm6.newGame(); __mm6.setTime(9,0)', 1400],
  ['04-outdoor-noon', '__mm6.setTime(13,0); __mm6.look(0.9,0)', 1000],
  // look(dx, dy): POSITIVE dy pitches DOWN (negative dy = up - verified
  // empirically by the world-visuals agent). The old signs had these two
  // frames swapped, so the "looking down" shot stared at the sky.
  ['05-outdoor-looking-down', '__mm6.look(0,0.30)', 800],
  ['06-outdoor-walk', '__mm6.look(0,-0.30); __mm6.walk(1,0,2200)', 2600],
  // Re-seat before each time-of-day frame: the walk in 06 routinely ends
  // nose-first against a building or inside a canopy, and a dusk/night/dawn
  // shot taken there shows a wall instead of the sky and the day cycle.
  ['07-outdoor-dusk', '__mm6.clearView(); __mm6.setTime(19,45)', 900],
  ['08-outdoor-night', '__mm6.clearView(); __mm6.setTime(23,30)', 900],
  ['09-outdoor-dawn', '__mm6.clearView(); __mm6.setTime(5,45)', 900],
  // Re-seat before spawning: frame 06 often ends with the camera inside a
  // canopy or against a building corner, and monsters spawned straight ahead
  // land inside the wall. A fight nobody can see says nothing about how the
  // fight looks.
  ['10-combat', '__mm6.clearView(); __mm6.setTime(12,0); __mm6.spawn("GoblinA",700); __mm6.spawn("GoblinB",950); __mm6.spawn("GoblinA",1250)', 2600],
  ['11-combat-attack', '__mm6.attack()', 700],
  ['12-combat-turnbased', '__mm6.session.toggleTurnBased(); __mm6.attack()', 900],
  ['13-charsheet', '__mm6.session.toggleTurnBased(); __mm6.open("charsheet")', 900],
  ['14-inventory', '__mm6.open("inventory")', 900],
  ['15-spellbook', '__mm6.open("spellbook")', 900],
  ['16-questlog', '__mm6.open("questlog")', 900],
  ['17-mapscreen', '__mm6.open("mapscreen")', 900],
  ['18-quickref', '__mm6.open("quickref")', 900],
  ['19-rest', '__mm6.open("rest")', 900],
  ['20-shop', '__mm6.open("shop", { shop: { kind: "weapon", name: "The Forge" } })', 900],
  ['21-dialogue', '__mm6.open("dialogue", { npc: { name: "Wilbur Humphrey", profession: "Mayor" } })', 900],
  ['22-temple', '__mm6.open("temple", { shop: { kind: "temple", name: "Temple of the Sun" } })', 900],
  ['23-tavern', '__mm6.open("tavern", { shop: { kind: "tavern", name: "The Laughing Monk" } })', 900],
  ['24-options', '__mm6.open("options")', 900],
  ['25-dungeon', '__mm6.close(); __mm6.dungeon({ id:"goblinwatch", name:"Goblinwatch", theme:"castle", rooms:12, levels:2 })', 4000],
  ['26-dungeon-walk', '__mm6.walk(1,0,1600)', 2000],
  ['27-dungeon-look', '__mm6.look(1.1,0)', 900],
  ['28-guild', '__mm6.open("guild", { school: "fire", title: "Guild of Fire" })', 900],
];
