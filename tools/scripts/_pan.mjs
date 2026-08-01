export default [
  ['p-charsheet', '__mm6.newGame()', 40000],
  ['p-cs',        '__mm6.open("charsheet")', 900],
  ['p-inv',       '__mm6.open("inventory")', 900],
  ['p-spell',     '__mm6.open("spellbook")', 900],
  ['p-quest',     '__mm6.open("questlog")', 900],
  ['p-quickref',  '__mm6.open("quickref")', 900],
  ['p-rest',      '__mm6.open("rest")', 900],
  ['p-shop',      '__mm6.open("shop", { shop: { kind: "weapon", name: "The Forge" } })', 900],
  ['p-temple',    '__mm6.open("temple", { shop: { kind: "temple", name: "Temple of the Sun" } })', 900],
  ['p-tavern',    '__mm6.open("tavern", { shop: { kind: "tavern", name: "The Laughing Monk" } })', 900],
  ['p-options',   '__mm6.open("options")', 900],
  ['p-map',       '__mm6.open("mapscreen")', 900],
];
