import * as THREE from 'three';
import { Session, MINUTES_PER_SECOND as SIM_MINUTES_PER_SECOND } from './game/session.js';
import { HUD } from './ui/hud.js';
import { outdoorMap, dungeonMap, emptyMap } from './game/maps.js';
import { Rand } from './core/rng.js';
import { mergeStatic } from './game/mergestatic.js';

// ---------------------------------------------------------------------------
// Game start-up.
//
// Wires the finished art and systems modules into a Session, registers the
// full-screen panels, and hands control to the title screen. Every optional
// module is imported defensively so a single missing piece degrades that
// feature rather than blanking the game.
//
// This file also owns the pieces that glue shell to systems:
//   - ONE clock: session.clock is the master, and every advance is mirrored
//     into party.minutes through party.advanceTime so conditions tick, buffs
//     expire and aging works.
//   - Save / load for real: session.saveGame() / session.loadGame() serialise
//     the party, clock, map, position and quest state to localStorage
//     ('mm6-save'), with autosave on pagehide and every two game hours.
//   - Audio direction: title / town / night / dungeon-theme music, house
//     tracks while their screens are open, ambience beds, the dawn sting.
// ---------------------------------------------------------------------------

export const SAVE_KEY = 'mm6-save';
export const SAVE_VERSION = 2;

/** Realtime pace: MM6-ish, one real second is about one game minute. */
const CLOCK_MINUTES_PER_SECOND = 1;

/**
 * Import a module without letting a failure take the game down with it.
 * The loaders below are written as literal `import()` calls rather than as
 * dynamic paths so the bundler can see them - a computed specifier is invisible
 * to it and the module simply would not ship.
 */
async function opt(name, load) {
  try { return await load(); }
  catch (e) { console.warn('module unavailable:', name, e.message); return null; }
}

const SCREEN_MODULES = [
  ['charsheet', () => import('./ui/screens/charsheet.js'), 'CharSheetScreen'],
  ['inventory', () => import('./ui/screens/inventory.js'), 'InventoryScreen'],
  ['spellbook', () => import('./ui/screens/spellbook.js'), 'SpellbookScreen'],
  ['questlog', () => import('./ui/screens/questlog.js'), 'QuestLogScreen'],
  ['mapscreen', () => import('./ui/screens/mapscreen.js'), 'MapScreen'],
  ['quickref', () => import('./ui/screens/quickref.js'), 'QuickRefScreen'],
  ['options', () => import('./ui/screens/options.js'), 'OptionsScreen'],
  ['dialogue', () => import('./ui/screens/dialogue.js'), 'DialogueScreen'],
  ['shop', () => import('./ui/screens/shop.js'), 'ShopScreen'],
  ['temple', () => import('./ui/screens/temple.js'), 'TempleScreen'],
  ['training', () => import('./ui/screens/training.js'), 'TrainingScreen'],
  ['tavern', () => import('./ui/screens/tavern.js'), 'TavernScreen'],
  ['bank', () => import('./ui/screens/bank.js'), 'BankScreen'],
  ['guild', () => import('./ui/screens/guild.js'), 'GuildScreen'],
  ['rest', () => import('./ui/screens/rest.js'), 'RestScreen'],
  ['levelup', () => import('./ui/screens/levelup.js'), 'LevelUpScreen'],
  ['title', () => import('./ui/screens/title.js'), 'TitleScreen'],
  ['chargen', () => import('./ui/screens/chargen.js'), 'CharGenScreen'],
  ['transfer', () => import('./ui/screens/transfer.js'), 'TransferScreen'],
];

export async function startGame(shell) {
  const { engine, ui, screens, registerScreen, openScreen, setSession } = shell;

  // --- register every panel that exists ------------------------------------
  for (const [id, load, exportName] of SCREEN_MODULES) {
    const m = await opt(id, load);
    if (!m) continue;
    const Ctor = m[exportName] || m.default || m.Screen;
    if (!Ctor) { console.warn('screen module has no constructor:', id); continue; }
    registerScreen(id, (session, uiCtx, hud, opts) => new Ctor(session, uiCtx, hud, opts));
  }

  // --- systems -------------------------------------------------------------
  const partyMod = await opt('./game/party.js', () => import('./game/party.js'));
  const questMod = await opt('./game/quests.js', () => import('./game/quests.js'));
  const combatMod = await opt('./game/combat.js', () => import('./game/combat.js'));
  const monsterMod = await opt('./game/monsters.js', () => import('./game/monsters.js'));
  const itemMod = await opt('./game/items.js', () => import('./game/items.js'));
  const regionMod = await opt('./world/region.js', () => import('./world/region.js'));
  const dungeonMod = await opt('./world/dungeon.js', () => import('./world/dungeon.js'));
  const spriteMod = await opt('./art/spritebake.js', () => import('./art/spritebake.js'));
  const vfxMod = await opt('./ents/vfx.js', () => import('./ents/vfx.js'));
  const audioMod = await opt('./core/audio.js', () => import('./core/audio.js'));
  const musicMod = await opt('./core/music.js', () => import('./core/music.js'));

  const seed = (Math.random() * 1e9) | 0;
  const party = partyMod && partyMod.createParty
    ? partyMod.createParty(seed)
    : fallbackParty(seed);
  aliasClasses(party);

  const session = new Session(engine, party);
  const hud = new HUD(session, ui);
  session.hud = hud;
  session.seed = seed;
  setSession(session, hud);

  session.modules = { partyMod, questMod, combatMod, monsterMod, itemMod, regionMod, dungeonMod, spriteMod, vfxMod };

  // MM6's day runs at a livable pace: about one real second per game minute
  // in realtime (waits and rests fast-forward through advanceMinutes). The
  // stock 6x rate burned through several game days per session. When the
  // session exposes its own advanceGameTime accumulator, scale ITS input;
  // otherwise repace the plain clock directly.
  if (typeof session.advanceGameTime === 'function') {
    const scale = CLOCK_MINUTES_PER_SECOND / (SIM_MINUTES_PER_SECOND || 6);
    if (scale !== 1) {
      const baseAdvance = session.advanceGameTime.bind(session);
      session.advanceGameTime = (dt) => baseAdvance(dt * scale);
    }
  } else {
    const clk = session.clock;
    clk.advance = function advance(realSeconds) {
      if (!this.paused) this.minutes += realSeconds * CLOCK_MINUTES_PER_SECOND;
    };
  }

  // Audio, music and effects are all optional: a failure in any of them must
  // not stop the game from starting.
  try {
    if (audioMod && audioMod.Audio) {
      session.audio = new audioMod.Audio();
      // iOS will not start an AudioContext outside a user gesture, so the
      // context is created in the tap - but the heavy work (ambience bed
      // prerender, the scheduler) is deferred off the gesture into idle time
      // so the first tap no longer carries a half-second hitch.
      const kick = () => {
        try { session.audio.init(); } catch (e) { console.warn('audio init failed', e); }
        removeEventListener('pointerdown', kick);
        const finish = () => {
          try {
            if (musicMod && musicMod.Music && !session.music) {
              const ctx = session.audio.ctx || session.audio.context;
              const bus = session.audio.musicBus || session.audio.master || null;
              if (ctx) session.music = new musicMod.Music(ctx, bus);
              if (session.music && session.audio.attachMusic) session.audio.attachMusic(session.music);
            }
            if (session.audio.prerender) {
              session.audio.prerender([session.ambienceId || 'amb_forest', 'amb_wind', 'amb_town', 'amb_night']);
            }
            if (session.audio.setAmbience) session.audio.setAmbience(session.ambienceId || 'amb_forest');
            // Whatever situation we are in right now decides the first track.
            if (session.tickAudioDirector) session.tickAudioDirector(0, screens.top ? screens.top.id : null, true);
            else if (session.music) session.music.play(session.musicTrack || 'field');
          } catch (e) { console.warn('audio finish failed', e); }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(finish, { timeout: 1500 });
        else setTimeout(finish, 250);
      };
      addEventListener('pointerdown', kick, { once: true });
    }
  } catch (e) { console.warn('audio unavailable', e); }

  try {
    if (vfxMod && vfxMod.VFXSystem) session.vfx = new vfxMod.VFXSystem(session.sprites);
  } catch (e) { console.warn('vfx unavailable', e); }

  // Combat glue first: it builds the spawner, and loading a region immediately
  // asks the spawner to populate it. With this the other way round the world
  // came up with no trees, monsters, townsfolk or loot in it at all.
  const { installCombat } = await import('./game/combatglue.js');
  installCombat(session);

  installClockBridge(session);
  installAudioDirector(session, screens);
  installSaveSystem(session, shell);

  // --- world ---------------------------------------------------------------
  session.setMap(emptyMap(), 'void');
  await loadRegion(session, 'new_sorpigal', seed);

  // Quests live in session.questPool, seeded by the spawner when the region
  // loads (main chain + regional sides); nothing to pre-generate here.

  // MM6 opens on its title illustration, not in the world.
  installMenuFlow(shell, session, seed);

  window.__loadRegion = (id) => loadRegion(session, id, seed);
  return session;
}

// ---------------------------------------------------------------------------
// One clock
// ---------------------------------------------------------------------------

/**
 * session.clock is the master timeline. Two possible worlds:
 *
 * 1. The session module ships its own machinery (SessionClock backed by
 *    party.minutes + advanceGameTime/tickTime running the condition rules).
 *    Realtime is then already handled in-session; the bridge only has to
 *    cover MANUAL clock jumps (rest/wait screens use advanceMinutes while
 *    session.update is frozen) by running tickTime over the jumped span.
 *    It must NOT call party.advanceTime - with the clock backed by
 *    party.minutes that is a feedback loop that doubles time every frame.
 *
 * 2. A plain GameClock. Then the bridge mirrors every clock advance into
 *    party.advanceTime so poison/disease tick, buffs expire and aging works.
 *
 * Screens that advance the clock while the sim is frozen call
 * session.syncPartyClock() themselves (rest.js does).
 */
function installClockBridge(session) {
  const partyMod = session.modules?.partyMod;
  const rand = new Rand((session.seed || 1) ^ 0x7ee7);
  const sessionTicks = typeof session.tickTime === 'function'
    && typeof session.advanceGameTime === 'function';
  let last = session.clock.minutes;

  session.syncPartyClock = () => {
    const now = session.clock.minutes;
    if (!(now > last)) { last = Math.min(last, now); return; }
    const whole = Math.floor(now - last);
    if (whole < 1) return;
    try {
      if (sessionTicks) {
        // Runs conditions/buffs/wages over the span; does not move the clock.
        session.tickTime(whole, last);
      } else if (session.party && partyMod && typeof partyMod.advanceTime === 'function') {
        const events = partyMod.advanceTime(session.party, whole, rand) || [];
        for (const ev of events) session.message(ev);
      }
    } catch (e) { /* a stub party without the full shape must not kill the frame */ }
    last += whole;
  };
  /** After a load rewinds the clock, re-anchor instead of fast-forwarding. */
  session.resetClockBridge = () => { last = session.clock.minutes; };

  const baseUpdate = session.update.bind(session);
  session.update = (dt, input) => {
    baseUpdate(dt, input);
    if (sessionTicks) last = session.clock.minutes;   // realtime already ticked in-session
    else session.syncPartyClock();
  };
}

// ---------------------------------------------------------------------------
// Audio direction
// ---------------------------------------------------------------------------

/** Music for a house screen while it is open. */
const SCREEN_TRACKS = {
  tavern: 'tavern', shop: 'shop', guild: 'shop', temple: 'temple',
  title: 'title', chargen: 'title',
};

/** Dungeon theme -> the track that fits it. */
const DUNGEON_TRACKS = {
  crypt: 'crypt', tomb: 'crypt', temple: 'temple',
  cave: 'dungeon', mine: 'dungeon', sewer: 'dungeon',
  castle: 'dungeon', tower: 'dungeon', lair: 'dungeon',
};

/**
 * Situational music and ambience. Called every frame by the shell (cheap; it
 * only acts on change), including while modal screens freeze the simulation.
 */
function installAudioDirector(session, screens) {
  let current = { track: null, amb: null };
  let lastHour = session.clock.hour;
  let accum = 0;

  session.tickAudioDirector = (dt, topScreenId, force) => {
    accum += dt || 0;
    if (!force && accum < 0.5) return;   // twice a second is plenty
    accum = 0;

    const music = session.music, audio = session.audio;
    if (!music && !audio) return;

    // New-day sting when dawn breaks (05:00).
    const hour = session.clock.hour;
    if (audio && hour === 5 && lastHour !== 5) {
      try { audio.play('new_day', { volume: 0.8 }); } catch { /* optional */ }
    }
    lastHour = hour;

    // What should be playing right now?
    let track = session.musicTrack || 'field';
    let amb = session.ambienceId || 'amb_forest';
    const indoor = session.map && session.map.indoor;
    if (!indoor) {
      if (session.clock.isNight) { track = 'night'; amb = 'amb_night'; }
      else if (inTown(session)) { track = 'town'; amb = 'amb_town'; }
    }
    const screenTrack = topScreenId && SCREEN_TRACKS[topScreenId];
    if (screenTrack) track = screenTrack;

    if (music && track !== current.track) {
      current.track = track;
      try { music.play(track); } catch { /* unknown track falls back next tick */ }
    }
    if (audio && audio.setAmbience && amb !== current.amb) {
      current.amb = amb;
      try { audio.setAmbience(amb); } catch { /* optional */ }
    }
  };
}

/** Is the party standing inside any town's radius? */
function inTown(session) {
  const towns = session.regionTowns;
  if (!towns || !towns.length) return false;
  const p = session.player.pos;
  for (const t of towns) {
    const dx = p.x - t.x, dz = p.z - t.z;
    if (dx * dx + dz * dz <= t.r * t.r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

function installSaveSystem(session, shell) {
  session.gameStarted = false;

  session.saveGame = () => {
    try {
      const partyMod = session.modules?.partyMod;
      const data = {
        version: SAVE_VERSION,
        at: Date.now(),
        seed: session.seed,
        party: partyMod && partyMod.serialize ? partyMod.serialize(session.party) : null,
        clock: session.clock.minutes,
        map: session.mapMeta || { type: 'region', id: session.mapId || 'new_sorpigal', seed: session.seed },
        pos: session.player.pos.toArray(),
        yaw: session.player.yaw,
        pitch: session.player.pitch,
        activeChar: session.activeChar | 0,
        // The combat/quest glue's own snapshot (kills, shops, quest flags...),
        // when that side of the house provides one.
        state: (typeof session.saveState === 'function' ? safeCall(() => session.saveState()) : null),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      session.saveName = `Saved ${session.clock.formatDate()}, ${session.clock.format()}`;
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  };

  session.loadGame = () => {
    let data = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      data = JSON.parse(raw);
    } catch (e) { console.warn('load failed', e); return false; }
    if (!data || typeof data !== 'object') return false;
    applySave(session, shell, data).catch((e) => console.warn('load apply failed', e));
    return true;
  };

  // --- autosave ------------------------------------------------------------
  const autosave = (why) => {
    if (!session.gameStarted) return;   // never clobber a real save from the menu
    try { session.saveGame(); } catch { /* best effort */ }
  };
  addEventListener('pagehide', () => autosave('pagehide'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autosave('hidden');
  });
  // Every two game hours. Checked on a coarse wall timer so it costs nothing.
  let lastAutoMinutes = session.clock.minutes;
  setInterval(() => {
    if (!session.gameStarted) { lastAutoMinutes = session.clock.minutes; return; }
    if (session.clock.minutes - lastAutoMinutes >= 120) {
      lastAutoMinutes = session.clock.minutes;
      autosave('interval');
    }
  }, 5000);
}

function safeCall(f) { try { return f(); } catch { return null; } }

async function applySave(session, shell, data) {
  const partyMod = session.modules?.partyMod;

  // Party first, so the HUD reads the loaded members immediately.
  if (data.party && partyMod && partyMod.deserialize) {
    try {
      const p = partyMod.deserialize(data.party);
      if (p && p.members) {
        aliasClasses(p);
        session.party = p;
      }
    } catch (e) { console.warn('could not restore the party', e); }
  }
  if (Number.isFinite(data.clock)) session.clock.minutes = data.clock;
  // Quest state rides in the glue layer's snapshot (data.state.questPool);
  // restoreState refills party.quests below. Older saves' flat `quests`
  // arrays are ignored on purpose.
  if (session.resetClockBridge) session.resetClockBridge();

  // Rebuild the map the save was standing in, then put the party back.
  const meta = data.map || {};
  const mseed = meta.seed !== undefined ? meta.seed : (data.seed !== undefined ? data.seed : session.seed);
  try {
    if (meta.type === 'dungeon' && meta.spec) {
      await loadDungeon(session, meta.spec, mseed);
    } else {
      await loadRegion(session, meta.id || 'new_sorpigal', mseed);
    }
  } catch (e) { console.warn('could not rebuild the saved map', e); }

  if (Array.isArray(data.pos) && data.pos.length === 3 && data.pos.every(Number.isFinite)) {
    session.player.pos.set(data.pos[0], data.pos[1], data.pos[2]);
    session.player.vel.set(0, 0, 0);
    if (Number.isFinite(data.yaw)) session.player.yaw = data.yaw;
    if (Number.isFinite(data.pitch)) session.player.pitch = data.pitch;
    session.player.applyTo(session.engine.camera);
  }
  if (Number.isFinite(data.activeChar)) {
    session.activeChar = Math.max(0, Math.min(3, data.activeChar | 0));
  }

  // Hand the glue layer its own snapshot back, if both sides exist.
  if (data.state && typeof session.restoreState === 'function') {
    safeCall(() => session.restoreState(data.state));
  }

  session.gameStarted = true;
  session.message('Game loaded.');
}

/** True when a save exists that loadGame could restore. */
export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Menu flow
// ---------------------------------------------------------------------------

/**
 * Title -> party creation -> play. The world is already generated behind the
 * menu, so "New Game" drops straight in with no second load.
 */
function installMenuFlow(shell, session, seed) {
  const { openScreen, screens } = shell;

  const startPlay = () => {
    screens.clear();
    session.gameStarted = true;
  };

  const showTitle = () => {
    openScreen('title', {
      hasSave: hasSave(),
      onPick: (id) => {
        if (id === 'new') showChargen();
        else if (id === 'options') openScreen('options', { onBack: showTitle });
        else if (id === 'load') {
          const ok = session.loadGame ? session.loadGame() : false;
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

  // The options screen's own New Game / Quit plaques.
  session.newGame = () => showChargen();
  session.quitGame = () => { session.gameStarted = false; showTitle(); };

  window.__mm6_showTitle = showTitle;
  window.__mm6_newGame = startPlay;
  showTitle();
}

/** The party module speaks `class`; older shell code speaks `klass`. */
function aliasClasses(party) {
  for (const m of (party && party.members) || []) {
    if (!m.klass && m.class) m.klass = m.class;
    if (!m.class && m.klass) m.class = m.klass;
    if (m.recovery === undefined) m.recovery = 0;
  }
}

/** Rebuild the party from the character-creation slots. */
function applyRoster(session, slots, seed) {
  const partyMod = session.modules?.partyMod;
  if (!partyMod || !partyMod.createParty || !slots || !slots.length) return;
  try {
    const roster = slots.map((s) => ({
      class: s.class, name: s.name, sex: s.sex,
      stats: s.stats,
      // The seed the player picked a FACE with is the seed the character
      // keeps: rerolling here is why the HUD showed four strangers.
      portraitSeed: s.portraitSeed ?? s.face,
      age: s.age,
    }));
    const party = partyMod.createParty(seed, roster);
    aliasClasses(party);
    // The quest containers the running session already carries must survive
    // the swap - createParty ships an empty quests:{}. Whatever shape the
    // glue layer keeps (uid-map) is carried over as-is; it normalises itself.
    const prev = session.party;
    if (prev && prev.quests && Object.keys(prev.quests).length) party.quests = prev.quests;
    if (prev && prev.killsByKind) party.killsByKind = prev.killsByKind;
    // Keep the master timeline continuous across the swap: the new party's
    // minute counter starts at 09:00 day 0, and with the clock backed by
    // party.minutes a fresh counter would rewind the world's day.
    if (prev && Number.isFinite(prev.minutes)) party.minutes = prev.minutes;
    session.party = party;
    if (session.hud) session.hud.session = session;
    if (session.resetClockBridge) session.resetClockBridge();
  } catch (e) {
    console.warn('could not apply the created roster', e);
  }
}

/** Generate and enter an outdoor region. */
export async function loadRegion(session, regionId, seed, entry = null) {
  const regionMod = session.modules?.regionMod;
  if (!regionMod || !regionMod.generateRegion) {
    session.setMap(emptyMap(), regionId);
    return;
  }
  // The region plants its own flora as batched, Y-locked billboard fields -
  // one draw call per species rather than one per tree - so we let it do that
  // and the shell skips flora entirely. Turning it off here would also empty
  // `floraPlan`, since the plan is a by-product of building the fields.
  const region = await regionMod.generateRegion(regionId, seed, null);
  // Tell the spawner the region has already planted its own trees.
  region.hasFloraField = (region.floraPlan || []).length > 0;
  // Bake the static scenery down to one mesh per material before it is shown.
  const g = region.group || region.terrain?.group;
  if (g) {
    const r = mergeStatic(g);
    console.info(`region ${regionId}: merged ${r.merged} meshes, ${r.before} -> ${r.after}`);
  }
  const map = outdoorMap(region);
  session.setMap(map, regionId, entry || region.spawnPoint || townEntry(region) || null);
  populateRegion(session, region, seed);
  session.mapMeta = { type: 'region', id: regionId, seed };
  // Town circles for the audio director (and anyone else asking "am I in town?").
  session.regionTowns = (region.towns || [])
    .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.z))
    .map((t) => ({ x: t.x, z: t.z, r: (Number.isFinite(t.radius) ? t.radius : 1200) + 400 }));
  session.musicTrack = region.music || regionTrack(regionId, region);
  session.ambienceId = region.ambience || 'amb_forest';
  if (session.tickAudioDirector) session.tickAudioDirector(0, null, true);
  else {
    if (session.music) session.music.play(session.musicTrack);
    if (session.audio && session.audio.setAmbience) session.audio.setAmbience(session.ambienceId);
  }
  session.message(`You arrive in ${region.name}.`);
}

/** Pick an outdoor track for a region that does not name one. */
function regionTrack(regionId, region) {
  const id = String(regionId || '').toLowerCase();
  if (/frozen|snow|white|winter/.test(id)) return 'snow';
  if (/desert|sand|drago/.test(id)) return 'desert';
  if (/forest|wood/.test(id)) return 'forest';
  const tree = region && region.treeKind;
  if (tree === 'pine') return 'forest';
  return 'field';
}

/**
 * Fallback entry point when a region does not nominate one: the first town's
 * plaza. The region's own `spawnPoint` is preferred because it is placed on
 * open ground looking into the map rather than inside the built-up centre.
 */
function townEntry(region) {
  const town = (region.towns || [])[0];
  if (!town) return null;
  const c = town.center || town.plaza || town.bounds?.center;
  if (c && isFinite(c.x) && isFinite(c.z)) {
    return { x: c.x, y: region.heightAt ? region.heightAt(c.x, c.z) : 0, z: c.z, yaw: 0 };
  }
  return null;
}

/** Generate and enter a dungeon. */
export async function loadDungeon(session, spec, seed, entry = null) {
  const dungeonMod = session.modules?.dungeonMod;
  if (!dungeonMod || !dungeonMod.generateDungeon) return;
  const d = await dungeonMod.generateDungeon(spec, seed, null);
  if (d.group) mergeStatic(d.group);
  const map = dungeonMap(d);
  session.setMap(map, spec.id || 'dungeon', entry);
  populateDungeon(session, d, seed);
  session.mapMeta = { type: 'dungeon', spec: { ...spec }, seed };
  session.regionTowns = [];
  session.musicTrack = d.music || DUNGEON_TRACKS[spec.theme] || 'dungeon';
  session.ambienceId = d.ambience || (spec.theme === 'cave' || spec.theme === 'mine' ? 'amb_cave' : 'amb_dungeon');
  if (session.tickAudioDirector) session.tickAudioDirector(0, null, true);
  else {
    if (session.music) session.music.play(session.musicTrack);
    if (session.audio && session.audio.setAmbience) session.audio.setAmbience(session.ambienceId);
  }
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

/** Legacy export kept for older callers; the live path is session.saveGame(). */
export function saveGame(session) {
  return session && typeof session.saveGame === 'function' ? session.saveGame() : false;
}
