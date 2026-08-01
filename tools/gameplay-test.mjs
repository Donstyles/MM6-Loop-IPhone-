// End-to-end gameplay check: does the game actually play?
//
// Drives real actions through the debug harness and asserts on observable
// state - experience earned, loot picked up, gold spent, time advanced - rather
// than on whether a frame rendered.

import { chromium } from '@playwright/test';

const URL = process.env.MM6_URL || 'http://127.0.0.1:5174/';
const results = [];
let failures = 0;

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) failures++;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(300000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await page.evaluate(() => window.__mm6.newGame());
await page.waitForTimeout(1500);

const S = (fn, arg) => page.evaluate(fn, arg);

// --- the world is populated ------------------------------------------------
const world = await S(() => {
  const s = window.__session;
  const cat = {};
  for (const e of s.entities.list) cat[e.category] = (cat[e.category] || 0) + 1;
  return { entities: s.entities.list.length, cat, map: s.mapId, name: s.map.name };
});
check('world has entities', world.entities > 20, `${world.entities} in ${world.name}`);
check('world has townsfolk', (world.cat.npc || 0) > 0, `${world.cat.npc || 0} npcs`);
check('world has interactables', (world.cat.prop || 0) > 0, `${world.cat.prop || 0} props`);

// --- the party is real -----------------------------------------------------
const party = await S(() => {
  const p = window.__session.party;
  return {
    n: p.members.length,
    names: p.members.map((c) => c.name),
    classes: p.members.map((c) => c.class || c.klass),
    hp: p.members.map((c) => c.hp),
    gold: p.gold,
    spells: p.members.map((c) => (c.spells || []).length),
    items: p.members.map((c) => ((c.inventory && c.inventory.items) || c.inventory || []).length),
  };
});
check('party of four', party.n === 4, party.names.join(', '));
check('party has hit points', party.hp.every((h) => h > 0), party.hp.join('/'));
check('party carries gear', party.items.some((n) => n > 0), `items ${party.items.join('/')}`);
check('casters know spells', party.spells.some((n) => n > 0), `spells ${party.spells.join('/')}`);

// --- combat actually resolves ----------------------------------------------
await S(() => {
  window.__mm6.setTime(12, 0);
  for (let i = 0; i < 4; i++) window.__mm6.spawn('GoblinA', 600 + i * 120);
});
await page.waitForTimeout(1200);
const before = await S(() => {
  const s = window.__session;
  return {
    xp: s.party.members.reduce((a, c) => a + (c.xp || 0), 0),
    monsters: s.entities.list.filter((e) => e.category === 'monster' && !e.dead).length,
  };
});
check('monsters spawned', before.monsters >= 4, `${before.monsters} alive`);

for (let i = 0; i < 40; i++) {
  await S(() => window.__mm6.attack());
  await page.waitForTimeout(180);
}
const after = await S(() => {
  const s = window.__session;
  return {
    xp: s.party.members.reduce((a, c) => a + (c.xp || 0), 0),
    alive: s.entities.list.filter((e) => e.category === 'monster' && !e.dead).length,
    // A monster that finishes its death animation becomes a corpse, so count
    // both or a clean sweep reads as "nothing happened".
    dead: s.entities.list.filter((e) => e.dead || e.category === 'corpse').length,
    drops: s.entities.list.filter((e) => e.category === 'item').length,
    partyHP: s.party.members.map((c) => c.hp),
    monsterAttacks: window.__monsterAttacks || 0,
  };
});
check('attacks kill monsters', after.dead > 0, `${after.dead} killed, ${after.alive} left`);
check('kills award experience', after.xp > before.xp, `${before.xp} -> ${after.xp}`);
check('kills drop loot', after.drops > 0, `${after.drops} on the ground`);
// Four goblins against a full party may die before landing a blow, so accept
// either damage taken or a monster having got its attack in.
check('monsters fight back',
  after.partyHP.some((h, i) => h < party.hp[i]) || after.monsterAttacks > 0,
  `hp ${party.hp.join('/')} -> ${after.partyHP.join('/')}, ${after.monsterAttacks} monster attacks`);

// --- turn-based mode --------------------------------------------------------
const turns = await S(() => {
  const s = window.__session;
  s.enterTurnBased();
  const on = { turnBased: s.turnBased, queue: s.turnQueue.length, points: s.turnPoints };
  s.leaveTurnBased();
  return { on, off: s.turnBased };
});
check('turn-based mode engages', turns.on.turnBased && turns.on.queue > 0,
  `queue ${turns.on.queue}, ${turns.on.points} points`);
check('turn-based mode releases', turns.off === false);

// --- the clock and resting --------------------------------------------------
const clock = await S(async () => {
  const s = window.__session;
  const t0 = s.clock.minutes;
  s.clock.advanceMinutes(8 * 60);
  return { moved: s.clock.minutes - t0, date: s.clock.formatDate(), time: s.clock.format() };
});
// Elapsed minutes are a float, so compare with a tolerance rather than exactly.
check('clock advances', clock.moved > 479.9, `+${clock.moved.toFixed(1)}min -> ${clock.date} ${clock.time}`);

// --- every panel opens ------------------------------------------------------
const screens = ['charsheet', 'inventory', 'spellbook', 'questlog', 'mapscreen',
  'quickref', 'rest', 'options', 'title', 'chargen'];
for (const id of screens) {
  const got = await S((sid) => {
    try { window.__mm6.open(sid); return window.__mm6.screen(); }
    catch (e) { return 'ERR ' + e.message; }
  }, id);
  check(`panel opens: ${id}`, got === id, got);
  await page.waitForTimeout(120);
}
await S(() => window.__mm6.close());

// --- quests -----------------------------------------------------------------
const quests = await S(() => {
  const q = window.__session.quests || [];
  return { n: q.length, titles: q.slice(0, 3).map((x) => x.title), unique: new Set(q.map((x) => x.title)).size };
});
check('quests generated', quests.n > 0, `${quests.n}: ${quests.titles.join(' / ')}`);
check('quests are distinct', quests.unique === quests.n, `${quests.unique} unique of ${quests.n}`);

// --- dungeons ---------------------------------------------------------------
await S(() => window.__mm6.dungeon({ id: 'gw', name: 'Goblinwatch', theme: 'castle', rooms: 12, levels: 2 }));
await page.waitForTimeout(5000);
const dungeon = await S(() => {
  const s = window.__session;
  return { indoor: s.map.indoor, name: s.map.name, probe: window.__mm6.probe(), calls: window.__perf.drawCalls };
});
const lum = dungeon.probe ? (dungeon.probe.ground[0] * 0.3 + dungeon.probe.ground[1] * 0.59 + dungeon.probe.ground[2] * 0.11) : 0;
check('dungeon loads', dungeon.indoor === true, dungeon.name);
check('dungeon is lit but dark', lum > 20 && lum < 140, `luminance ${lum.toFixed(1)}`);

// --- no runtime errors ------------------------------------------------------
const recovered = await S(() => window.__frameErrors || []);
check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('no recovered frame errors', recovered.length === 0, recovered.slice(0, 2).map((r) => r.split('\n')[0]).join(' | '));

console.log(`\n${results.length - failures}/${results.length} checks passed`);
await browser.close();
process.exitCode = failures ? 1 : 0;
