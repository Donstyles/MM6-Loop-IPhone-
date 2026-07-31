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
  session.hud = hud;
  setSession(session, hud);

  session.modules = { partyMod, questMod, combatMod, monsterMod, itemMod, regionMod, dungeonMod, spriteMod, vfxMod };

  // Audio, music and effects are all optional: a failure in any of them must
  // not stop the game from starting.
  try {
    if (audioMod && audioMod.Audio) {
      session.audio = new audioMod.Audio();
      // iOS will not start an AudioContext outside a user gesture.
      const kick = () => {
        try {
          session.audio.init();
          if (musicMod && musicMod.Music && !session.music) {
            const ctx = session.audio.ctx || session.audio.context;
            const bus = session.audio.musicBus || session.audio.master || null;
            if (ctx) session.music = new musicMod.Music(ctx, bus);
          }
          // Bake the ambience beds this region needs now rather than stalling
          // the first time something asks for them.
          if (session.audio.prerender) {
            session.audio.prerender([session.ambienceId || 'amb_forest', 'amb_wind']);
          }
          if (session.audio.setAmbience) session.audio.setAmbience(session.ambienceId || 'amb_forest');
          if (session.music) session.music.play(session.musicTrack || 'field');
        } catch (e) { console.warn('audio init failed', e); }
        removeEventListener('pointerdown', kick);
      };
      addEventListener('pointerdown', kick, { once: true });
    }
  } catch (e) { console.warn('audio unavailable', e); }

  try {
    if (vfxMod && vfxMod.VFXSystem) session.vfx = new vfxMod.VFXSystem(session.sprites);
  } catch (e) { console.warn('vfx unavailable', e); }

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

  // Generate a first batch of quests so the log is not empty on arrival.
  if (questMod && questMod.generateQuestsForRegion) {
    try {
      session.quests = questMod.generateQuestsForRegion('new_sorpigal', seed, 6) || [];
      if (session.party) session.party.quests = session.quests;
    } catch (e) { console.warn('quest generation failed', e); }
  }

  // MM6 opens on its title illustration, not in the world.
  installMenuFlow(shell, session, seed);

  window.__loadRegion = (id) => loadRegion(session, id, seed);
  return session;
}

/**
 * Title -> party creation -> play. The world is already generated behind the
 * menu, so "New Game" drops straight in with no second load.
 */
function installMenuFlow(shell, session, seed) {
  const { openScreen, screens } = shell;

  const startPlay = () => { screens.clear(); };

  const showTitle = () => {
    openScreen('title', {
      onPick: (id) => {
        if (id === 'new') showChargen();
        else if (id === 'options') openScreen('options', { onBack: showTitle });
        else if (id === 'load') {
          const ok = loadGame(session);
          if (ok) startPlay(); else showTitle();
        } else if (id === 'quit') startPlay();
      },
    });
    if (screens.top) screens.top.fullFrame = true;
  };

  const showChargen = () => {
    openScreen('chargen', {
      seed,
      onDone: (slots) => {
        applyRoster(session, slots, seed);
        startPlay();
      },
      onCancel: showTitle,
    });
    if (screens.top) screens.top.fullFrame = true;
  };

  window.__mm6_showTitle = showTitle;
  window.__mm6_newGame = startPlay;
  showTitle();
}

/** Rebuild the party from the character-creation slots. */
function applyRoster(session, slots, seed) {
  const partyMod = session.modules?.partyMod;
  if (!partyMod || !partyMod.createParty || !slots || !slots.length) return;
  try {
    const roster = slots.map((s) => ({
      class: s.class, name: s.name, sex: s.sex,
      stats: s.stats, portraitSeed: s.portraitSeed ?? s.face,
    }));
    const party = partyMod.createParty(seed, roster);
    session.party = party;
    if (session.hud) session.hud.session = session;
  } catch (e) {
    console.warn('could not apply the created roster', e);
  }
}

function loadGame(session) {
  try {
    const raw = localStorage.getItem('mm6-save');
    if (!raw) return false;
    const data = JSON.parse(raw);
    const partyMod = session.modules?.partyMod;
    if (partyMod && partyMod.deserialize) session.party = partyMod.deserialize(data.party);
    if (data.clock) session.clock.minutes = data.clock;
    return true;
  } catch (e) { console.warn('load failed', e); return false; }
}

export function saveGame(session) {
  try {
    const partyMod = session.modules?.partyMod;
    localStorage.setItem('mm6-save', JSON.stringify({
      party: partyMod && partyMod.serialize ? partyMod.serialize(session.party) : null,
      clock: session.clock.minutes,
      map: session.mapId,
      pos: session.player.pos.toArray(),
      yaw: session.player.yaw,
    }));
    return true;
  } catch (e) { console.warn('save failed', e); return false; }
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
  session.musicTrack = region.music || 'field';
  session.ambienceId = region.ambience || 'amb_forest';
  if (session.music) session.music.play(session.musicTrack);
  if (session.audio && session.audio.setAmbience) session.audio.setAmbience(session.ambienceId);
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
  session.musicTrack = d.music || 'dungeon';
  session.ambienceId = d.ambience || 'amb_dungeon';
  if (session.music) session.music.play(session.musicTrack);
  if (session.audio && session.audio.setAmbience) session.audio.setAmbience(session.ambienceId);
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
