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
  // Night town: lit windows and lantern halos are the whole point of the
  // frame. Street-by-lamplight: stand ON the main street between two
  // lampposts and look down the row, so the frame carries the pools on the
  // cobbles, the halos, and the lit windows all at once.
  // Vantage mechanics: lampposts are planted in road order, offset ~500u to
  // one side of the road's centreline (town.js: width/2 + 90), so an
  // *adjacent* pair (same road, ~900u apart, list-consecutive) defines both
  // the row direction and which side the street is on. Of those pairs, take
  // the one *farthest* from the plaza, stand at its midpoint pushed sideways
  // onto the roadway, and face along the street toward the town centre: the
  // whole lamp row recedes ahead and the lit town fills the distance. (The
  // nearest-the-plaza pair was tried first and put the market stalls two
  // steps in front of the lens.) The old script extrapolated 25% past
  // lamps[0] on the lamp line itself - the sidewalk against the house
  // fronts - and ended wedged in an alley.
  ['08b-night-town', '(function(){ const m = __mm6.session.map; const t = (m.towns || (m.region && m.region.towns) || [])[0]; if (!t) return; const lamps = t.props.filter((p) => p.kind === "lamppost"); let a = null, b = null, best = -1; for (let i = 0; i + 1 < lamps.length; i++) { const d = Math.hypot(lamps[i + 1].x - lamps[i].x, lamps[i + 1].z - lamps[i].z); if (d < 600 || d > 1100) continue; const mx = (lamps[i].x + lamps[i + 1].x) / 2, mz = (lamps[i].z + lamps[i + 1].z) / 2; const dc = Math.hypot(mx - t.x, mz - t.z); if (dc > best) { best = dc; a = lamps[i]; b = lamps[i + 1]; } } if (!a) { a = lamps[0] || { x: t.x + 900, z: t.z }; b = lamps[1] || { x: t.x, z: t.z }; } const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; const ux = dx / L, uz = dz / L; const off = 460; const px = (a.x + b.x) / 2 + uz * off, pz = (a.z + b.z) / 2 - ux * off; const s = (t.x - px) * ux + (t.z - pz) * uz >= 0 ? 1 : -1; __mm6.teleport(px, m.groundAt(px, pz, t.y || 0), pz, Math.atan2(-s * ux, -s * uz)); __mm6.session.player.pitch = 0; })()', 900],
  ['09-outdoor-dawn', '__mm6.clearView(); __mm6.setTime(5,45)', 900],
  // Re-seat before spawning: frame 06 often ends with the camera inside a
  // canopy or against a building corner, and monsters spawned straight ahead
  // land inside the wall. A fight nobody can see says nothing about how the
  // fight looks. Kinds cover the tier spread: base goblin, the display-name
  // spelling ('Goblin Shaman' -> GoblinB via the baker's name resolution),
  // and the boss tier - cycle 3 must see all three render.
  ['10-combat', '__mm6.clearView(); __mm6.setTime(12,0); __mm6.spawn("GoblinA",600); __mm6.spawn("Goblin Shaman",900); __mm6.spawn("GoblinC",1250)', 2600],
  // Bolt fight: a real shaman (spawned by tier ID so it has its ranged entry)
  // alone at casting range on a fresh vantage - frame 10's melee goblins would
  // otherwise be parked on the lens by now. The settle time catches the bolt
  // mid-flight with its trail, or the detonation burst.
  ['10b-bolt-fight', '__mm6.clearView(); __mm6.spawn("GoblinB", 1600)', 800],
  ['11-combat-attack', '__mm6.attack()', 700],
  ['12-combat-turnbased', '__mm6.session.toggleTurnBased(); __mm6.attack()', 900],
  // A field of corpses: three goblins dropped where they stand, so the judge
  // can grade persistent bodies rather than infer them from a single kill.
  // (turn-based stays on from frame 12; frame 13 toggles it back off)
  ['12b-corpse-field', '__mm6.look(0, 0.18); (function(){ const S = __mm6.session, p = S.player; for (const [d, side] of [[360, -170], [470, 90], [570, -30]]) { const x = p.pos.x - Math.sin(p.yaw) * d + Math.cos(p.yaw) * side; const z = p.pos.z - Math.cos(p.yaw) * d - Math.sin(p.yaw) * side; const e = S.spawner.spawnMonster("GoblinA", x, S.map.groundAt(x, z, p.pos.y), z); if (e) { e.dead = true; e.solid = false; e.setAction("die"); e.state = "dead"; } } })()', 1400],
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
