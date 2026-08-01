export default [
  ['hud-day',  '__mm6.newGame(); __mm6.setTime(12,0)', 6000],
  ['hud-turn', '__mm6.spawn("GoblinA",700); __mm6.session.toggleTurnBased()', 1200],
  ['hud-dung', '__mm6.session.toggleTurnBased(); __mm6.dungeon({id:"gw",name:"Goblinwatch",theme:"castle",rooms:12,levels:2})', 6000],
];
