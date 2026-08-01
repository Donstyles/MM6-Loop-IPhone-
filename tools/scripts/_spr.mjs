export default [
  ['s-noon',   '__mm6.newGame(); __mm6.setTime(12,0)', 6000],
  ['s-walk',   '__mm6.walk(1,0,2000)', 2400],
  ['s-dusk',   '__mm6.setTime(19,45)', 1000],
  ['s-mob',    '__mm6.setTime(12,0); __mm6.spawn("GoblinA",700); __mm6.spawn("GoblinB",1000)', 1800],
  ['s-tavern', '__mm6.open("tavern", { shop: { kind: "tavern", name: "The Laughing Monk" } })', 1000],
  ['s-shop',   '__mm6.open("shop", { shop: { kind: "weapon", name: "The Forge" } })', 1000],
];
