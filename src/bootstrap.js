import * as THREE from 'three';
import { Session } from './game/session.js';
import { HUD } from './ui/hud.js';
import { outdoorMap, dungeonMap, emptyMap } from './game/maps.js';
import { Rand } from './core/rng.js';

// ---------------------------------------------------------------------------
// Game start-up.
//
// Wires the finished art and systems modules into a Session, registers the
// full-screen panels, and hands control to the title screen. Every optional
// module is imported defensively so a single missing piece degrades that
// feature rather than blanking the game.
// ---------------------------------------------------------------------------

async function opt(path) {
  try { return await import(/* @vite-ignore */ path); }
  catch (e) { console.warn('module unavailable:', path, e.message); return null; }
}

const SCREEN_MODULES = [
  ['charsheet', './ui/screens/charsheet.js', 'CharSheetScreen'],
  ['inventory', './ui/screens/inventory.js', 'InventoryScreen'],
  ['spellbook', './ui/screens/spellbook.js', 'SpellbookScreen'],
  ['questlog', './ui/screens/questlog.js', 'QuestLogScreen'],
  ['mapscreen', './ui/screens/mapscreen.js', 'MapScreen'],
  ['quickref', './ui/screens/quickref.js', 'QuickRefScreen'],
  ['options', './ui/screens/options.js', 'OptionsScreen'],
  ['dialogue', './ui/screens/dialogue.js', 'DialogueScreen'],
  ['shop', './ui/screens/shop.js', 'ShopScreen'],
  ['temple', './ui/screens/temple.js', 'TempleScreen'],
  ['training', './ui/screens/training.js', 'TrainingScreen'],
  ['tavern', './ui/screens/tavern.js', 'TavernScreen'],
  ['bank', './ui/screens/bank.js', 'BankScreen'],
  ['guild', './ui/screens/guild.js', 'GuildScreen'],
  ['rest', './ui/screens/rest.js', 'RestScreen'],
  ['levelup', './ui/screens/levelup.js', 'LevelUpScreen'],
  ['title', './ui/screens/title.js', 'TitleScreen'],
  ['chargen', './ui/screens/chargen.js', 'CharGenScreen'],
  ['transfer', './ui/screens/transfer.js', 'TransferScreen'],
];

export async function startGame(shell) {
  const { engine, ui, screens, registerScreen, openScreen, setSession } = shell;

  // --- register every panel that exists ------------------------------------
  for (const [id, path, exportName] of SCREEN_MODULES) {
    const m = await opt(path);
    if (!m) continue;
    const Ctor = m[exportName] || m.default || m.Screen;
    if (!Ctor) { console.warn('screen module has no constructor:', path); continue; }
    registerScreen(id, (session, uiCtx, hud, opts) => new Ctor(session, uiCtx, hud, opts));
  }

  // --- systems -------------------------------------------------------------
  const partyMod = await opt('./game/party.js');
  const questMod = await opt('./game/quests.js');
  const combatMod = await opt('./game/combat.js');
  const monsterMod = await opt('./game/monsters.js');
  const itemMod = await opt('./game/items.js');
  const regionMod = await opt('./world/region.js');
  const dungeonMod = await opt('./world/dungeon.js');
  const spriteMod = await opt('./art/spritebake.js');
  const vfxMod = await opt('./ents/vfx.js');
  const audioMod = await opt('./core/audio.js');
  const musicMod = await opt('./core/music.js');

  const seed = (Math.random() * 1e9) | 0;
  const party = partyMod && partyMod.createParty
    ? partyMod.createParty(seed)
    : fallbackParty(seed);

  const session = new Session(engine, party);
  const hud = new HUD(session, ui);
  setSession(session, hud);

  session.modules = { partyMod, questMod, combatMod, monsterMod, itemMod, regionMod, dungeonMod, spriteMod, vfxMod };

  if (audioMod && audioMod.Audio) {
    session.audio = new audioMod.Audio();
    // iOS will not start an AudioContext outside a gesture.
    const kick = () => { session.audio.init(); removeEventListener('pointerdown', kick); };
    addEventListener('pointerdown', kick, { once: true });
  }
  if (musicMod && musicMod.Music && session.audio) {
    session.music = new musicMod.Music(session.audio);
  }
  if (vfxMod && vfxMod.VFXSystem) {
    session.vfx = new vfxMod.VFXSystem(session.sprites);
  }

  // --- world ---------------------------------------------------------------
  session.setMap(emptyMap(), 'void');
  await loadRegion(session, 'new_sorpigal', seed);

  // Combat glue.
  const { installCombat } = await import('./game/combatglue.js');
  installCombat(session);

  if (screens && shell.openScreen) {
    // Straight into play; the title screen is reachable from Options.
    if (SCREEN_MODULES.some(([id]) => id === 'title')) {
      // openScreen('title');
    }
  }

  window.__loadRegion = (id) => loadRegion(session, id, seed);
  return session;
}

/** Generate and enter an outdoor region. */
export async function loadRegion(session, regionId, seed, entry = null) {
  const regionMod = session.modules?.regionMod;
  if (!regionMod || !regionMod.generateRegion) {
    session.setMap(emptyMap(), regionId);
    return;
  }
  const region = await regionMod.generateRegion(regionId, seed, null);
  const map = outdoorMap(region);
  session.setMap(map, regionId, entry);
  populateRegion(session, region, seed);
  if (session.music) session.music.play(region.music || 'field');
  session.message(`You arrive in ${region.name}.`);
}

/** Generate and enter a dungeon. */
export async function loadDungeon(session, spec, seed, entry = null) {
  const dungeonMod = session.modules?.dungeonMod;
  if (!dungeonMod || !dungeonMod.generateDungeon) return;
  const d = await dungeonMod.generateDungeon(spec, seed, null);
  const map = dungeonMap(d);
  session.setMap(map, spec.id || 'dungeon', entry);
  populateDungeon(session, d, seed);
  if (session.music) session.music.play(d.music || 'dungeon');
  session.message(`You enter ${d.name || 'the dungeon'}.`);
}

function populateRegion(session, region, seed) {
  const spawner = session.spawner;
  if (spawner) spawner.populateRegion(region, seed);
}

function populateDungeon(session, d, seed) {
  const spawner = session.spawner;
  if (spawner) spawner.populateDungeon(d, seed);
}

/** Minimal party so the shell still runs if game/party.js is unavailable. */
function fallbackParty(seed) {
  const rnd = new Rand(seed);
  const names = ['Roland', 'Cassandra', 'Marcus', 'Elowen'];
  const klasses = ['Knight', 'Cleric', 'Sorcerer', 'Archer'];
  return {
    gold: 200,
    food: 6,
    members: names.map((name, i) => ({
      name, klass: klasses[i], sex: i % 2 === 0 ? 'm' : 'f',
      level: 1, xp: 0, hp: 35, maxHP: 35, sp: 12, maxSP: 12,
      recovery: 0, conditions: [], portraitSeed: rnd.int(1e9),
      stats: { might: 15, intellect: 12, personality: 12, endurance: 14, accuracy: 13, speed: 13, luck: 10 },
      skills: {}, spells: [], inventory: [], equipment: {},
    })),
    buffs: {},
  };
}
