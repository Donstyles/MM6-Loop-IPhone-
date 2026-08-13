import * as THREE from 'three';
import { CATEGORY } from '../ents/entity.js';
import { Rand } from '../core/rng.js';
import { Spawner, regreetNPC } from './spawner.js';
import {
  spellById, schoolSkill, spCostFor, canCast, spellRadius, spellPower, spellDuration,
} from './spells.js';
import {
  giveQuest, dispatchQuestEvent, turnInQuest, updateAwards, failEscortOnDeath,
  createMainChain, generateQuestsForRegion, resetQuestIds, refreshGating,
} from './quests.js';

// ---------------------------------------------------------------------------
// Combat, spell and quest glue.
//
// game/combat.js, game/spells.js and game/quests.js hold the rules; this file
// connects them to the things you can see: who the crosshair is over, which
// sprite plays its attack animation, where the fireball flies, what falls on
// the floor when something dies, and which townsperson is holding the quest.
// ---------------------------------------------------------------------------

const MELEE_REACH = 900;
const _v = new THREE.Vector3();

/** Impact sound per spell school; heal/buff have their own chimes. */
const IMPACT_SOUND = {
  fire: 'explosion', light: 'explosion', dark: 'explosion',
  air: 'lightning_crack', water: 'ice_shatter', earth: 'hit_stone',
  spirit: 'hit_flesh', mind: 'hit_flesh', body: 'hit_flesh',
};

/** Swing sound and pitch per weapon skill. Two samples, many voices. */
const SWING_SOUND = {
  sword: ['swing_heavy', 1.1], axe: ['swing_heavy', 0.95], mace: ['swing_heavy', 0.85],
  spear: ['swing_heavy', 1.05], staff: ['swing_heavy', 0.9], dagger: ['swing_light', 1.15],
};

/** Direct-debuff spells and the condition they try to stick. */
const DEBUFF_CONDITION = {
  charm: 'charmed', feeblemind: 'feebleminded', paralyze: 'paralyzed',
  mass_fear: 'afraid', turn_undead: 'afraid',
};

/**
 * Floating combat numbers.
 *
 * MM6's `show_damage` is off in a stock install: a blow is reported on the
 * status line and shown by the victim's portrait swapping to a wince frame,
 * and nothing is ever drawn over the world. The code path stays here behind
 * the setting so it can be switched on, but the default is off.
 */
function floatText(session, x, y, z, text, kind) {
  const s = session && session.settings;
  if (!s || !s.showDamage) return;
  if (session.vfx) session.vfx.damageNumber(x, y, z, text, kind);
}

export function installCombat(session) {
  const mods = session.modules || {};
  const combat = mods.combatMod;
  const rnd = new Rand(0xc0ffee);

  session.spawner = new Spawner(session);
  session.spawner.bind(mods);

  // --- party attacks -------------------------------------------------------

  session.attack = () => {
    const party = session.party;
    const members = party.members || [];
    // Swinging a weapon is unambiguously an input: it ends the safe-arrival
    // aggro hold (wowjudge #1) the same way the first step does.
    session._awaitFirstMove = false;
    const target = pickTarget(session);

    let acted = false;
    // While in turns only the character whose turn it is may swing.
    const order = session.turnBased && session.turnQueue.length
      ? [session.turnQueue[0]]
      : members.map((_, i) => i);
    for (const i of order) {
      const ch = members[i];
      if (!canAct(ch)) continue;
      if (ch.recovery > 0) continue;
      acted = true;
      swing(session, ch, i, target, combat, rnd);
      if (session.turnBased) {
        // One action per input while in turns, and it costs action points.
        session.consumeTurn(i);
        break;
      }
    }
    // A not-ready swing is SILENT, as MM6 is - mashing attack printed 31
    // error beeps per fight (audio3 #5). At most one quiet cue every 2s.
    if (!acted && session.audio) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!session._errBeepAt || now - session._errBeepAt > 2000) {
        session._errBeepAt = now;
        session.audio.play('error', { volume: 0.2 });
      }
    }
    return acted;
  };

  /**
   * Cast a spell. `spellOrId` may be the real spell object (spellbook) or an
   * id string (quick-cast). `target` is a monster entity for attack spells or
   * `{ member: index }` for single-ally heals and buffs - a heal is NEVER
   * auto-aimed at a monster.
   */
  session.castSpell = (charIndex, spellOrId, target = null) => {
    const spell = typeof spellOrId === 'string' ? spellById(spellOrId) : spellOrId;
    const ch = session.party.members[charIndex];
    if (!spell || !ch || !canAct(ch)) return false;

    const chk = canCast(ch, spell);
    if (!chk.ok) {
      session.message(chk.reason || `${ch.name} cannot cast that.`);
      if (session.audio) session.audio.play('spell_fail');
      return false;
    }
    ch.sp -= spCostFor(ch, spell);
    ch.recovery = (spell.recovery || 100) / 60;
    if (session.turnBased) session.consumeTurn(charIndex, 40);

    const school = (spell.school || 'spirit').toLowerCase();
    if (session.audio) session.audio.play(`cast_${school}`);
    session.message(`${ch.name} casts ${spell.name}.`);

    if (spell.type === 'damage' || spell.type === 'debuff') {
      const tgt = target && target.pos ? target : pickTarget(session);
      fireSpell(session, ch, spell, tgt, combat, rnd);
    } else {
      castSupport(session, ch, charIndex, spell, target, rnd);
    }
    return true;
  };

  // --- monsters hitting back ----------------------------------------------

  session.onMonsterAttackCb = (e) => {
    if (typeof window !== 'undefined') window.__monsterAttacks = (window.__monsterAttacks || 0) + 1;
    const def = e.data || {};

    // An escorted charge is a softer target than four armed adventurers.
    if (session.escort && session.escort.entity && !session.escort.entity.dead && rnd.bool(0.25)) {
      hitEscort(session, e, rnd);
      return;
    }

    const victim = pickVictim(session, rnd);
    if (!victim) return;
    let dmg = 0, hit = true;
    if (combat && combat.resolveAttack && e.mon) {
      const entry = combat.resolveAttack(e.mon, victim, rnd, {});
      hit = entry.hit; dmg = entry.damage;
      if (hit) announceInflicts(session, victim, entry.notes);
    } else {
      hit = rnd.float() > 0.35;
      dmg = hit ? rnd.dice(1, 6) + (def.level || 1) : 0;
      if (hit) victim.hp -= dmg;
    }
    if (!hit) {
      session.message(`${def.name || e.kind} misses ${victim.name}.`);
      if (session.audio) session.audio.play('miss', { volume: 0.4 });
      return;
    }
    reportPartyDamage(session, victim, dmg);
    // A hit on the party is a portrait wince and a screen flash - never a
    // world-space blood sprite in the camera's face (visual finding #1/#8).
    if (session.audio) session.audio.play('party_hurt', { volume: 0.7 });
    session.engine.setFlash(Math.min(0.5, dmg / 60), 0xd02020);
    setTimeout(() => session.engine.setFlash(0), 90);
  };

  session.onMonsterRangedCb = (e) => {
    const def = e.data || {};
    const r = def.ranged || {};
    // MM6-slow caster cadence at low tiers: the entity AI's flat 2-3s reload
    // is overridden by the bestiary's own cooldown (playtest #1 - starter
    // shamans machine-gunned an 11-29 HP party).
    if (r.cooldown) e.recovery = Math.max(e.recovery || 0, r.cooldown * (0.85 + rnd.float(0, 0.3)));
    const vfxId = r.vfx || (r.spell ? ((spellById(r.spell) || {}).vfx || 'fire_bolt') : 'arrow');
    if (!session.vfx) { rangedHitParty(session, e, combat, rnd); return; }
    const from = _v.set(e.pos.x, e.pos.y + (e.sizeH || 200) * 0.6, e.pos.z);
    // Aim at mid-body, where the vfx layer sweeps its party-sphere test.
    const dir = new THREE.Vector3(
      session.player.pos.x - from.x,
      session.player.pos.y + 110 - from.y,
      session.player.pos.z - from.z,
    ).normalize();
    session.vfx.projectile(vfxId, from.clone(), dir, {
      speed: 1600, range: 5000,
      onHit: () => rangedHitParty(session, e, combat, rnd),
    });
  };

  // --- interaction ---------------------------------------------------------

  session.handleActivate = (hit) => {
    const e = hit.entity;
    const kind = hit.kind;
    // Naming a tree costs nothing and opens nothing: identify and stop.
    if (kind === 'scenery') {
      session.message(`${(e && e.label) || 'Nothing of note'}.`);
      return;
    }
    // In turns, opening and talking are actions too (systems #2).
    if (session.turnBased && session.spendTurnPoints && session.countHostiles() > 0) {
      session.spendTurnPoints(13);
    }
    if (kind === 'npc') {
      // Talking IS the objective for deliver/find quests: dispatch and SAY SO
      // before the dialogue screen opens, so "You deliver the letter" lands
      // on the log instead of completing silently (playtest #10).
      const npcId = e.data && (e.data.npcId || e.data.name);
      if (npcId && session.party) {
        const changed = dispatchQuestEvent(session.party, { type: 'talk', npcId });
        for (const q of changed) {
          const o = (q.objectives || []).find((x) => x.kind === 'talk' && x.done && x.target === npcId);
          if (!o) continue;
          if (q.type === 'deliver') session.message('You deliver the letter.', '#ffd84a');
          else if (q.type === 'find_person') session.message(`You have found ${npcId}.`, '#ffd84a');
          else session.message(`Spoken with ${npcId}.`, '#ffd84a');
        }
        announceQuestChanges(session, changed);
      }
      window.__openScreen && window.__openScreen('dialogue', { npc: e.data, entity: e });
    } else if (kind === 'chest') {
      openChest(session, e, rnd);
    } else if (kind === 'item') {
      pickUp(session, e);
    } else if (kind === 'door' || kind === 'house') {
      toggleDoor(session, e);
    } else if (kind === 'shop') {
      const s = e.interact;
      const k = s.shopKind || 'weapon';
      // The table used American spellings and singulars the town generator
      // never produces - it makes `armour`, `alchemist`, `stable` and
      // `guild_fire`, not `armor`, `alchemy`, `stables` and `guild` - so
      // everything but the handful that happened to match fell through to the
      // generic shop.
      const screenFor = {
        weapon: 'shop', armor: 'shop', armour: 'shop', magic: 'shop',
        alchemy: 'shop', alchemist: 'shop', general: 'shop',
        temple: 'temple', training: 'training', tavern: 'tavern', bank: 'bank',
        townhall: 'dialogue', stable: 'transfer', stables: 'transfer', docks: 'transfer',
      };
      const screen = k.startsWith('guild') ? 'guild' : (screenFor[k] || 'shop');
      // PROGRESSION BEAT (playtest3 #4): a tier-1 guild membership is an
      // hour-one purchase - 150 gold, not 1000 - scaling steeply with tier so
      // the deep guilds still gate. The guild screen honours opts.fee.
      const shopRec = s.shop || s;
      const guildTier = Math.max(1, (shopRec && shopRec.tier) || 1);
      const guildFee = s.fee !== undefined ? s.fee : Math.round(150 * Math.pow(3, guildTier - 1));
      // Every house screen reads its own fields off the top of `opts` - the
      // shop reads `opts.kind`, the guild `opts.school`. Passing only
      // `{ shop: s }` left all of them undefined, so *every* shop in the game
      // opened as the weapon shop and every guild as the fire guild.
      window.__openScreen && window.__openScreen(screen, {
        ...s,
        kind: k,
        school: k.startsWith('guild_') ? k.slice(6) : s.school,
        shop: s.shop || s,
        fee: screen === 'guild' ? guildFee : s.fee,
        entity: e,
      });
    } else if (kind === 'transition') {
      doTransition(session, e.interact);
    } else if (e.category === CATEGORY.MONSTER) {
      session.attack();
    }
  };

  // --- quest pipeline -------------------------------------------------------

  /**
   * The pool of quests on offer: the ten-beat main chain plus each visited
   * region's rolled side quests. Ids are namespaced per region and generation
   * is seeded, so the pool regenerates identically for save/restore.
   */
  session.ensureQuestPool = (regionId, seed) => {
    // QUEST STATE IS SACRED (playtest3 #1). The pool is keyed to the WORLD
    // seed, never the per-call seed: region reloads, defeat reloads and
    // dungeon doors all funnel through here with whatever seed the map was
    // built from, and NONE of them may rebuild a pool that already exists
    // for this world. The only legal rebuild is a genuinely different world
    // - a loaded save under another seed - and restoreState drives that
    // explicitly (it sets worldSeed first, then calls back in here).
    const worldSeed = session.worldSeed !== null && session.worldSeed !== undefined
      ? session.worldSeed : seed;
    if (session._questPoolSeed !== undefined && session._questPoolSeed !== worldSeed) {
      session.questPool = null;
      session._questRegions = null;
      session._mainChainMade = false;
    }
    session._questPoolSeed = worldSeed;
    if (!session.questPool) session.questPool = [];
    if (!session._questRegions) session._questRegions = new Set();
    if (!session._mainChainMade) {
      session._mainChainMade = true;
      for (const q of createMainChain()) session.questPool.push(q);
    }
    if (regionId && !session._questRegions.has(regionId)) {
      session._questRegions.add(regionId);
      resetQuestIds(1);
      const qs = generateQuestsForRegion(regionId, worldSeed, 6) || [];
      for (const q of qs) { q.id = `${regionId}:${q.id}`; session.questPool.push(q); }
    }
    // The journal is a VIEW over the pool: any journal entry whose id exists
    // in the pool points at the pool object itself, one source of truth.
    syncQuestJournal(session);
  };

  /**
   * Give the region's quests to real townsfolk: the giver becomes a named NPC
   * entity carrying the live quest object in the shape dialogue.js consumes,
   * and every talk-objective target gets a body too.
   */
  session.attachQuestNPCs = (regionId) => {
    if (!session.questPool) return;
    const npcs = session.entities.list.filter(
      (e) => e.category === CATEGORY.NPC && e.data && e.data.questRefs !== undefined,
    );
    if (!npcs.length) return;
    let cursor = 0;
    const byName = new Map();
    const takeFree = () => {
      while (cursor < npcs.length
        && ((npcs[cursor].data.questRefs || []).length || npcs[cursor].data.reserved)) cursor++;
      return npcs[cursor] || null;
    };
    const bind = (name, title, quest, npcId) => {
      let e = byName.get(name);
      if (!e) {
        e = takeFree();
        if (!e) return null;
        e.data.name = name;
        e.data.npcId = npcId || name;
        e.label = name;
        if (title) e.data.title = title;
        // The greeting and small talk were baked with the OLD name at spawn;
        // regenerate them so this person introduces themselves as themselves
        // (veteran blocker #3: "Philippa Jessop looks up..." under Quixote).
        regreetNPC(e.data, name, title || e.data.title);
        e.data.reserved = true;
        byName.set(name, e);
      }
      if (quest) {
        e.data.questRefs = e.data.questRefs || [];
        if (e.data.questRefs.indexOf(quest) < 0) e.data.questRefs.push(quest);
      }
      return e;
    };

    for (const q of session.questPool) {
      if (q.region !== regionId || q.state === 'failed') continue;
      bind(q.giver, q.giverRole, q);
    }
    for (const q of session.questPool) {
      if (q.region !== regionId) continue;
      for (const o of q.objectives || []) {
        if (o.kind !== 'talk' || o.done) continue;
        const pretty = o.target === 'newsorpigal_clerk' ? 'Town Clerk'
          : o.target === 'councilman' ? null : o.target;
        if (!pretty) continue;
        bind(pretty, o.target === 'newsorpigal_clerk' ? 'Clerk of the Town Hall' : null, null, o.target);
      }
    }
  };

  /**
   * The pool was rebuilt under a restored world seed: every NPC binding made
   * against the OLD pool objects is stale. Release them and re-bind against
   * the live pool so givers offer (and pay out) the real quests.
   */
  session.reattachQuestNPCs = (regionId) => {
    for (const e of session.entities.list) {
      if (e.category !== CATEGORY.NPC || !e.data) continue;
      if ((e.data.questRefs || []).length || e.data.reserved) {
        e.data.questRefs = [];
        e.data.reserved = false;
      }
    }
    session.attachQuestNPCs(regionId);
  };

  // Probe/debug hook: what would a blind swing target right now?
  session._pickTarget = () => pickTarget(session);

  /** Spawn the person an escort quest protects; they trail the party. */
  session.spawnEscort = (quest) => {
    const o = (quest.objectives || []).find((x) => x.kind === 'escort');
    if (!o || !session.spawner) return null;
    const p = session.player.pos;
    const e = session.spawner.spawnNPC({
      x: p.x + 160, z: p.z + 160, archetype: 'peasant',
      npc: {
        name: o.target, npcId: o.target, title: 'Traveler', sex: 'm',
        portraitSeed: 777, greeting: `"Stay close," says ${o.target}. "Please."`,
        rumours: [], rumors: [], questRefs: [],
      },
    }, (x, z) => session.collision.groundAt(x, z, p.y));
    if (!e) return null;
    e.hp = 30; e.maxHp = 30;
    session.escort = { entity: e, quest };
    session.message(`${o.target} joins you. Keep them alive.`, '#ffd84a');
    return e;
  };

  // --- helpers exposed on the session -------------------------------------

  session.damageMonster = (e, amount, element = 'physical', source = null, preApplied = false) => {
    if (!e || e.dead) return;
    if (!preApplied && combat && combat.applyDamage && e.mon) {
      amount = combat.applyDamage(e.mon, amount, element, rnd, {}).dealt;
    } else if (!preApplied && e.mon) {
      e.mon.hp -= amount;
    }
    e.hp = e.mon ? e.mon.hp : e.hp - amount;
    e.hitFlash = 1;
    if (e.state === 'idle' || e.state === 'wander') { e.state = 'chase'; session.inCombat = true; }
    floatText(session, e.pos.x, e.pos.y + (e.sizeH || 200) * 0.75, e.pos.z, String(amount), 'damage');
    if (e.hp <= 0) killMonster(session, e, source);
    else {
      // Pain vocal on a meaningful, non-lethal hit.
      if (amount > 0 && session.audio && rnd.bool(0.35)) {
        const voice = (e.data && e.data.sound) || 'growl_small';
        session.audio.play(voice, { pos: e.pos, volume: 0.45, rate: 1.12 });
      }
      if (e.action !== 'hit' && Math.random() < 0.4) e.setAction('hit');
    }
  };

  session.tickRecovery = (dt) => {
    // In turn-based mode recovery ticks once per round (updateTurns), never on
    // the wall clock - otherwise standing idle in turns was free recovery
    // while the monsters waited politely (systems finding #7).
    if (session.turnBased) return;
    for (const ch of session.party.members || []) {
      if (ch.recovery > 0) ch.recovery = Math.max(0, ch.recovery - dt);
    }
  };

  const baseUpdate = session.update.bind(session);
  session.update = (dt, input) => {
    normalizeQuestContainers(session);
    baseUpdate(dt, input);
    // Accepting a kill quest tops its targets up in the town ring right away
    // - no region reload required (playtest3 #2).
    const active = Object.values(session.party.quests || {}).filter((q) => q && q.state === 'active').length;
    if (active !== session._lastActiveQuests) {
      session._lastActiveQuests = active;
      if (session.spawner && session.spawner.topUpQuestTargets) session.spawner.topUpQuestTargets();
    }
    // While the world is frozen under a panel, recovery and defeat checks
    // freeze with it - no free recovery, no dying behind a shop screen.
    if (session.worldFrozen && session.worldFrozen()) return;
    session._defeatCooldown = Math.max(0, (session._defeatCooldown || 0) - dt);
    session.tickRecovery(dt);
    checkPartyDefeat(session);
  };
}

// --- internals -------------------------------------------------------------

const DISABLING = ['dead', 'unconscious', 'paralyzed', 'stoned', 'eradicated', 'asleep'];

/**
 * Conditions may arrive as an array, a Set or a flags object depending on which
 * party implementation is loaded, so normalise before testing.
 */
export function conditionList(ch) {
  const c = ch && ch.conditions;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  if (c instanceof Set) return [...c];
  if (typeof c === 'object') return Object.keys(c).filter((k) => c[k]);
  return [];
}

function canAct(ch) {
  if (!ch) return false;
  if (ch.hp <= 0) return false;
  return !conditionList(ch).some((c) => DISABLING.includes(String(c).toLowerCase()));
}

/**
 * The party's quest containers have shipped in several shapes; the pipeline
 * needs `party.quests` to be a uid-keyed map and the log to read it.
 */
function normalizeQuestContainers(session) {
  const party = session.party;
  if (!party) return;
  if (!party.quests || Array.isArray(party.quests)) party.quests = {};
  if (!party.killsByKind) party.killsByKind = {};
  if (Array.isArray(session.quests)) session.quests = null;
  syncQuestJournal(session);
}

const QUEST_STATE_RANK = { unavailable: 0, available: 1, active: 2, complete: 3, rewarded: 4, failed: 5 };

/**
 * ONE SOURCE OF TRUTH (playtest3 #1): the pool owns every quest object; the
 * journal (party.quests) is a keyed view over it. A journal entry that is a
 * detached copy - a restored save, a stale pre-defeat clone - first donates
 * any FURTHER progress it carries to the pool object, then is replaced by it,
 * so giver NPCs, the quest log and turn-in all read the same object.
 */
function syncQuestJournal(session) {
  const party = session.party;
  const pool = session.questPool;
  if (!party || !party.quests || Array.isArray(party.quests) || !Array.isArray(pool)) return;
  for (const q of pool) {
    const j = party.quests[q.id];
    if (!j) {
      // Journal derives from pool: anything the party has engaged with is in
      // the log even if the entry itself was lost (post-wipe party swap).
      if (q.state === 'active' || q.state === 'complete' || q.state === 'rewarded' || q.state === 'failed') {
        party.quests[q.id] = q;
      }
      continue;
    }
    if (j === q) continue;
    if ((QUEST_STATE_RANK[j.state] || 0) > (QUEST_STATE_RANK[q.state] || 0) && j.state !== 'failed') {
      q.state = j.state;
      for (const o of q.objectives || []) {
        const jo = (j.objectives || []).find((x) => x.id === o.id || (o.target && x.target === o.target));
        if (jo && (jo.progress | 0) >= (o.progress | 0)) { o.progress = jo.progress; o.done = jo.done; }
      }
    }
    party.quests[q.id] = q;
  }
}

/**
 * TAP SAFETY (mobile3 #1): a swing may only ever land on something the party
 * is honestly at war with. Non-hostile townsfolk are invisible to target
 * acquisition - hover, cone and surround scan alike - UNLESS they are already
 * aggroed at the party (a mugger mid-retaliation is fair game). One stray tap
 * must never one-shot a peasant and start a town massacre.
 */
function attackable(e) {
  if (!e || e.category !== CATEGORY.MONSTER || e.dead) return false;
  if (e.data && e.data.hostile === false && e.state !== 'chase' && e.state !== 'flee') return false;
  return true;
}

export function pickTarget(session) {
  if (attackable(session.hoverEntity)) return session.hoverEntity;
  // Otherwise the nearest live hostile roughly in front of the party.
  const p = session.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null, bestScore = -Infinity;
  for (const e of session.entities.list) {
    if (!e.visible || !attackable(e)) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 5000) continue;
    const dot = (dx / d) * fx + (dz / d) * fz;
    if (dot < 0.45) continue;
    const score = dot * 2000 - d;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  if (!best) {
    // Surrounded: nothing in the cone, but something is chewing on us. Swing
    // at the nearest hostile in arm's reach and square up to face it.
    let near = null, nd = Infinity;
    for (const e of session.entities.list) {
      if (!e.visible || !attackable(e)) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d <= 700 && d < nd) { nd = d; near = e; }
    }
    if (near) {
      best = near;
      p.yaw = Math.atan2(-(near.pos.x - p.pos.x), -(near.pos.z - p.pos.z));
    }
  }
  return best;
}

function pickVictim(session, rnd) {
  const alive = (session.party.members || []).filter(
    (c) => c.hp > 0 && !conditionList(c).includes('dead'),
  );
  if (!alive.length) return null;
  return alive[rnd.int(alive.length)];
}

function swing(session, ch, index, target, combat, rnd) {
  const melee = target && Math.hypot(
    target.pos.x - session.player.pos.x, target.pos.z - session.player.pos.z,
  ) <= MELEE_REACH;

  const weapon = ch.equipment?.mainhand || null;
  const bow = ch.equipment?.bow || null;
  const useBow = !melee && bow;

  ch.recovery = combat && combat.recoveryFor ? combat.recoveryFor(ch, useBow) / 60 : 1.2;
  if (!isFinite(ch.recovery) || ch.recovery < 0) ch.recovery = 1.2;

  if (session.audio) {
    if (useBow) session.audio.play('bow_shot');
    else {
      const skill = combat && combat.activeWeapon ? combat.activeWeapon(ch, false).skill : null;
      const [id, rate] = SWING_SOUND[skill] || ['swing_light', 1];
      session.audio.play(weapon ? id : 'swing_light', { rate });
    }
  }

  if (!target) {
    session.message(`${ch.name} swings at nothing.`);
    return;
  }

  if (useBow) {
    if (session.vfx) {
      const from = _v.set(session.player.pos.x, session.player.pos.y + 150, session.player.pos.z).clone();
      const dir = new THREE.Vector3(
        target.pos.x - from.x, (target.pos.y + target.sizeH * 0.5) - from.y, target.pos.z - from.z,
      ).normalize();
      session.vfx.projectile('arrow', from, dir, {
        speed: 3200, range: 6000, target,
        onHit: () => resolveHit(session, ch, target, combat, rnd, true),
      });
    } else {
      resolveHit(session, ch, target, combat, rnd, true);
    }
    return;
  }

  if (!melee) { session.message(`${ch.name} has no ranged weapon.`); return; }
  resolveHit(session, ch, target, combat, rnd, false);
}

/** What a blow landing on this creature should sound like. */
function hitSoundFor(def, ranged) {
  if (ranged) return 'arrow_hit';
  if (!def) return 'hit_flesh';
  const fam = def.family || '';
  if (fam === 'Skeleton' || fam === 'Lich') return 'hit_bone';
  if (def.kind === 'construct') return fam === 'Robot' ? 'hit_armor' : 'hit_stone';
  if (fam === 'Gargoyle' || fam === 'ElemEarth') return 'hit_stone';
  if (['KnightPlate', 'FighterChain', 'Guard', 'Nobleman'].indexOf(fam) >= 0) return 'hit_armor';
  return 'hit_flesh';
}

function resolveHit(session, ch, target, combat, rnd, ranged) {
  if (!target || target.dead) return;
  let hit = true, dmg = 0, crit = false, entry = null;
  // combat.js works on combatant instances, which the spawner attaches as
  // `entity.mon`; the sprite entity only mirrors hp for the health bar.
  if (combat && combat.resolveAttack && target.mon) {
    entry = combat.resolveAttack(ch, target.mon, rnd, { ranged });
    hit = entry.hit; crit = entry.critical; dmg = entry.damage;
  } else {
    hit = rnd.float() > 0.3;
    dmg = hit ? rnd.dice(2, 6) + 2 : 0;
  }

  if (!hit) {
    session.message(`${ch.name} misses.`);
    floatText(session, target.pos.x, target.pos.y + target.sizeH * 0.7, target.pos.z, 'Miss', 'miss');
    if (session.audio) session.audio.play('miss', { volume: 0.35 });
    return;
  }

  if (session.audio) session.audio.play(crit ? 'crit' : hitSoundFor(target.data, ranged), { pos: target.pos });
  if (session.vfx) {
    // Blood sprays from the VICTIM, at the point of impact.
    session.vfx.burst('blood_hit', target.pos.x, target.pos.y + target.sizeH * 0.55, target.pos.z, { scale: 0.7 });
    if (crit) floatText(session, target.pos.x, target.pos.y + target.sizeH * 0.8, target.pos.z, String(dmg), 'crit');
  }

  // Weapon riders combat.js resolved for us: an exploding blade bursts and
  // splashes, knockback shoves the sprite away from the party.
  if (entry && entry.explodes) {
    if (session.audio) session.audio.play('explosion', { pos: target.pos, volume: 0.7 });
    if (session.vfx) session.vfx.burst('fire_burst', target.pos.x, target.pos.y + target.sizeH * 0.5, target.pos.z, { scale: 1 });
    const near = session.entities.near(target.pos.x, target.pos.z, 300, CATEGORY.MONSTER);
    for (const other of near) if (other !== target && !other.dead) session.damageMonster(other, Math.max(1, Math.round(dmg * 0.4)), 'fire', ch);
  }
  if (entry && entry.knockback) {
    const dx = target.pos.x - session.player.pos.x, dz = target.pos.z - session.player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = Math.min(240, entry.knockback * 4);
    const nx = target.pos.x + (dx / d) * push, nz = target.pos.z + (dz / d) * push;
    if (!session.map.blocked(nx, target.pos.y, nz, target.radius, 100)) {
      target.pos.x = nx; target.pos.z = nz;
      target.pos.y = session.collision.groundAt(nx, nz, target.pos.y);
    }
  }
  // resolveAttack already applied the damage to the combatant; only the
  // fallback dice still need applying here.
  session.damageMonster(target, dmg, 'physical', ch, entry !== null);
}

// --- spells ------------------------------------------------------------------

/**
 * Offensive and debuff spells, through the real resolver: canCast/spCostFor
 * gated the cast, and resolveSpellAttack rolls the school's own scaling with
 * the caster's skill and mastery. Multi-bolt spells roll per bolt (see
 * combat.resolveSpellAttack for the contract).
 */
function fireSpell(session, ch, spell, target, combat, rnd) {
  const vfxTag = spell.vfx || 'sparks';
  const sk = schoolSkill(ch, spell.school);
  const impactSnd = IMPACT_SOUND[spell.school] || 'explosion';

  const applyTo = (victimEnt) => {
    if (!victimEnt || victimEnt.dead) return 0;
    if (spell.type === 'debuff') { applyDebuff(session, ch, spell, victimEnt, sk, combat, rnd); return 0; }
    if (combat && combat.resolveSpellAttack && victimEnt.mon) {
      const entry = combat.resolveSpellAttack(ch, spell, victimEnt.mon, sk.level, sk.mastery, rnd);
      if (entry.notes.indexOf('immune') >= 0 || entry.notes.indexOf('unaffected') >= 0) {
        session.message(`${victimEnt.label || 'It'} is unaffected.`);
      }
      session.damageMonster(victimEnt, entry.damage, (spell.dmg && spell.dmg.element) || 'magic', ch, true);
      return entry.damage;
    }
    const dmg = rnd.dice((spell.dmg && spell.dmg.n0) || 3, (spell.dmg && spell.dmg.s) || 6);
    session.damageMonster(victimEnt, dmg, 'magic', ch);
    return dmg;
  };

  if (!target) { session.message('No target.'); return; }

  const from = new THREE.Vector3(session.player.pos.x, session.player.pos.y + 150, session.player.pos.z);
  const dir = new THREE.Vector3(
    target.pos.x - from.x, (target.pos.y + target.sizeH * 0.5) - from.y, target.pos.z - from.z,
  ).normalize();

  const impact = {
    fire_bolt: 'fire_burst', fireball: 'fire_burst', meteor: 'fire_burst',
    ice_shard: 'ice_burst', lightning: 'spark_hit', rock_shard: 'earth_burst',
    dark_ray: 'soul_drain', starburst: 'holy_burst',
  }[vfxTag] || 'spark_hit';

  const onHit = (pos, hitEnt) => {
    if (session.audio) session.audio.play(impactSnd, { pos: pos || target.pos, volume: 0.8 });
    // A projectile only counts what it can actually wound: an intercepting
    // prop or townsperson (no combatant, no hp) falls through to the aimed
    // target instead of silently voiding the spell (systems #9).
    const victim = (hitEnt && hitEnt.category === CATEGORY.MONSTER && !hitEnt.dead
      && (hitEnt.mon || hitEnt.hp > 0) && !(hitEnt.data && hitEnt.data.hostile === false))
      ? hitEnt : target;
    let total = applyTo(victim);
    // Area spells splash the real radius, at full spell damage, as MM6 does.
    if (spell.radius && spell.type === 'damage') {
      const r = spellRadius(spell, sk.mastery);
      const px = pos ? pos.x : target.pos.x, pz = pos ? pos.z : target.pos.z;
      const near = session.entities.near(px, pz, r, CATEGORY.MONSTER);
      for (const other of near) if (other !== victim && !other.dead) total += applyTo(other);
    }
    if (total > 0) session.message(`${spell.name} deals ${total} damage.`);
  };

  if (session.vfx) {
    session.vfx.projectile(vfxTag, from, dir, {
      speed: 2200, range: 7000, target, impactId: impact, onHit,
    });
  } else {
    onHit(target.pos, target);
  }
}

/** Charm, Feeblemind, Paralyze, Slow, Fear... land as monster-side state. */
function applyDebuff(session, ch, spell, e, sk, combat, rnd) {
  const mon = e.mon;
  const dur = spellDuration(spell, sk.level, sk.mastery) || 5;
  const name = e.label || (e.data && e.data.name) || 'The creature';
  const condition = DEBUFF_CONDITION[spell.id];

  const stuck = mon && combat && combat.tryInflict
    ? combat.tryInflict(mon, condition || 'asleep', 100, rnd)
    : true;
  if (condition && !stuck) { session.message(`${name} resists.`); return; }

  switch (spell.id) {
    case 'charm':
    case 'mass_fear':
    case 'turn_undead': {
      if (spell.id === 'turn_undead' && !(e.data && e.data.undead)) { session.message(`${name} is unmoved.`); return; }
      e.state = spell.id === 'charm' ? 'wander' : 'flee';
      if (spell.id === 'charm') e.aggroRange = 0;   // re-aggros if damaged
      session.message(`${name} ${spell.id === 'charm' ? 'wanders off, charmed' : 'flees in terror'}.`);
      break;
    }
    case 'feeblemind':
      session.message(`${name} forgets its spells.`);
      break;
    case 'paralyze':
      e.state = 'idle';
      e.aggroRange = 0;
      session.message(`${name} freezes in place.`);
      break;
    case 'slow':
      if (mon) mon.buffs.slow = { expires: dur };
      e.speed = Math.max(60, Math.round(e.speed * 0.5));
      session.message(`${name} slows.`);
      break;
    case 'shrinking_ray':
      if (mon) mon.buffs.shrunk = { power: spellPower(spell, sk.level, sk.mastery), expires: dur };
      e.scale *= 0.6;
      session.message(`${name} shrinks!`);
      break;
    case 'berserk':
      if (mon) mon.buffs.berserk = { expires: dur };
      e.state = 'wander';
      session.message(`${name} flies into a blind rage.`);
      break;
    case 'stun':
      e.recovery = Math.max(e.recovery || 0, 1.5);
      e.setAction('hit');
      session.message(`${name} reels.`);
      break;
    default:
      session.message(`${name} shudders.`);
      break;
  }
  if (session.audio) session.audio.play('buff_shimmer', { pos: e.pos, volume: 0.5, rate: 0.8 });
}

/**
 * Heals, cures, buffs and utility spells, through party.castSupportSpell and
 * applyBuff so power, duration and real maxHP all come from the rules layer.
 * `target.member` picks the ally for 'one'-target spells; defaults to the
 * caster, never a monster.
 */
function castSupport(session, ch, charIndex, spell, target, rnd) {
  const mods = session.modules || {};
  const p = mods.partyMod;
  const party = session.party;
  const sk = schoolSkill(ch, spell.school);
  const power = spellPower(spell, sk.level, sk.mastery);
  const dur = spellDuration(spell, sk.level, sk.mastery);
  const idx = target && target.member !== undefined
    ? Math.max(0, Math.min((party.members || []).length - 1, target.member))
    : charIndex;

  // The handful of utility spells with a mechanical footprint.
  if (spell.id === 'jump') {
    session.player.vel.y = Math.max(session.player.vel.y, 640);
    if (session.audio) session.audio.play('buff_shimmer', { volume: 0.4 });
    return;
  }
  if (spell.type === 'utility') {
    if (p && p.applyBuff && (spell.dur || spell.pow)) {
      p.applyBuff(spell.target === 'party' ? party : ch, spell.id, power || 1, dur || 30);
      session.message(`${spell.name} takes hold${dur ? ` (${dur} min)` : ''}.`);
      if (session.audio) session.audio.play('buff_shimmer', { volume: 0.5 });
    } else {
      session.message(`${spell.name} has no effect here.`);
    }
    return;
  }

  const before = (party.members || []).map((m) => m.hp);
  const r = p && p.castSupportSpell ? p.castSupportSpell(party, ch, spell.id, idx) : { ok: false };
  if (!r.ok) { session.message('The spell fizzles.'); return; }

  const isHeal = spell.type === 'heal' || (spell.cures && spell.cures.length);
  if (session.vfx) {
    const pos = session.player.pos;
    session.vfx.burst(isHeal ? 'heal_glow' : 'buff_shimmer', pos.x, pos.y + 100, pos.z, { scale: 1.2 });
  }
  if (session.audio) session.audio.play(isHeal ? 'heal_chime' : 'buff_shimmer', { volume: 0.7 });

  if (spell.type === 'heal') {
    const names = [];
    (party.members || []).forEach((m, i) => {
      if (m.hp > before[i]) names.push(`${m.name} +${m.hp - before[i]}`);
    });
    session.message(names.length ? `${spell.name}: ${names.join(', ')}.` : `${spell.name} has no one to heal.`);
  } else if (spell.type === 'buff') {
    const who = spell.target === 'party' ? 'The party' : party.members[idx].name;
    session.message(`${who} is blessed with ${spell.name}${dur ? ` for ${dur} minutes` : ''}.`);
  } else if (spell.cures) {
    session.message(`${spell.name} soothes ${spell.target === 'party' ? 'the party' : party.members[idx].name}.`);
  }
}

// --- damage to the party ------------------------------------------------------

/**
 * A condition just landed on a party member: SAY SO, with its cost (playtest3
 * #9 - Weak silently shaved max HP/SP and the player was never told).
 */
const INFLICT_ANNOUNCE = {
  weak: 'is Weakened: -2 max HP/SP until cured',
  drunk: 'is Drunk',
  afraid: 'is Afraid: cannot close with the enemy',
  poisoned_weak: 'is Poisoned', poisoned_severe: 'is badly Poisoned', poisoned_deadly: 'is deathly Poisoned',
  diseased_weak: 'is Diseased', diseased_severe: 'is badly Diseased', diseased_deadly: 'is deathly Diseased',
  cursed: 'is Cursed', asleep: 'is knocked senseless', paralyzed: 'is Paralyzed',
  stoned: 'is turned to stone', insane: 'goes Insane',
};

function announceInflicts(session, victim, notes) {
  for (const n of notes || []) {
    const line = INFLICT_ANNOUNCE[n];
    if (line) session.message(`${victim.name} ${line}!`, '#e04030');
  }
}

/** Announce damage the rules layer has already applied. */
function reportPartyDamage(session, ch, dmg) {
  if (dmg <= 0) return;
  session.message(`${ch.name} takes ${dmg} damage.`, '#e04030');
  if (ch.hp <= 0 && !conditionList(ch).includes('dead')) {
    ch.hp = Math.min(ch.hp, 0);
    setCondition(ch, 'unconscious');
    session.message(`${ch.name} falls unconscious!`, '#e04030');
    if (session.audio) session.audio.play('death_player');
  }
}

/** Conditions may be an array or a flags object; set one either way. */
function setCondition(ch, id) {
  if (Array.isArray(ch.conditions)) {
    if (!ch.conditions.includes(id)) ch.conditions.push(id);
  } else if (ch.conditions && typeof ch.conditions === 'object') {
    ch.conditions[id] = true;
  } else {
    ch.conditions = [id];
  }
}

/**
 * A monster's arrow or spell arrives. Real rules: attack roll (spells get a
 * to-hit bonus), the bestiary's own damage dice (`damage.s`, not a default
 * d6), elemental resistance saves inside applyDamage, and the shared session
 * RNG so resist rolls are not a per-character fixed sequence.
 */
function rangedHitParty(session, e, combat, rnd) {
  const victim = pickVictim(session, rnd);
  if (!victim) return;
  const def = e.data || {};
  const r = def.ranged || {};

  if (combat && combat.performMonsterAction && e.mon) {
    const intent = { type: r.spell ? 'cast' : 'ranged', target: victim, spell: r.spell || null };
    const entries = combat.performMonsterAction(e.mon, intent, rnd);
    for (const en of entries) {
      if (!en.hit) {
        session.message(`${def.name || e.kind}'s ${r.spell ? 'spell' : 'shot'} misses ${victim.name}.`);
        if (session.audio) session.audio.play('miss', { volume: 0.35 });
        continue;
      }
      reportPartyDamage(session, victim, en.damage);
      announceInflicts(session, victim, en.notes);
      if (session.audio) session.audio.play(r.spell ? 'party_hurt' : 'arrow_hit', { volume: 0.6 });
      session.engine.setFlash(Math.min(0.45, en.damage / 60), 0xd02020);
      setTimeout(() => session.engine.setFlash(0), 90);
    }
    return;
  }
  // No rules module: honest dice at least use the descriptor's die size.
  const dmg = r.damage ? rnd.dice(r.damage.n || 2, r.damage.s || 6) + (r.bonus || 0) : rnd.dice(2, 6);
  victim.hp -= dmg;
  reportPartyDamage(session, victim, dmg);
}

/** A stray blow lands on the escorted NPC instead of the party. */
function hitEscort(session, attacker, rnd) {
  const es = session.escort;
  const e = es.entity;
  const combat = session.modules && session.modules.combatMod;
  const dmg = combat && combat.monsterDamage && attacker.mon
    ? (combat.monsterDamage(attacker.mon, 1, rnd) || { amount: 4 }).amount
    : rnd.dice(1, 6) + 2;
  e.hp -= dmg;
  session.message(`${e.label} is struck for ${dmg}!`, '#e04030');
  if (session.vfx) session.vfx.burst('blood_hit', e.pos.x, e.pos.y + 120, e.pos.z, { scale: 0.6 });
  if (session.audio) session.audio.play('hit_flesh', { pos: e.pos });
  if (e.hp <= 0) {
    e.dead = true;
    e.setAction('die');
    const failed = failEscortOnDeath(session.party, e.data.npcId || e.label);
    for (const q of failed) session.message(`Quest failed: ${q.title}.`, '#ff4030');
    if (!failed.length) session.message(`${e.label} has been killed.`, '#ff4030');
    session.escort = null;
  }
}

/**
 * The whole party is down: MM6-style defeat, not a silent zombie walk.
 *
 * Single-fire by construction (playtest #5: deaths counted 16 after ~10
 * defeats): the busy flag holds through the whole async respawn, the callback
 * itself is once-guarded, and a short cooldown after revival stops the same
 * frame's stray hit from wiping the freshly-woken party a second time.
 *
 * Exported for the systems harness.
 */
export function checkPartyDefeat(session) {
  if (session._defeatBusy) return false;
  if ((session._defeatCooldown || 0) > 0) return false;
  const ms = (session.party && session.party.members) || [];
  if (!ms.length) return false;
  const down = ms.every((c) => c.hp <= 0
    || conditionList(c).some((k) => ['dead', 'unconscious', 'eradicated', 'stoned'].includes(String(k).toLowerCase())));
  if (!down) return false;

  session._defeatBusy = true;
  session.message('Your party has been defeated!', '#ff4030');
  if (session.audio) session.audio.play('death_player');
  // The dirge owns the deck for ~8 seconds; the audio director defers to
  // combatMusicOverride() === 'defeat' and holds the region track (audio #3).
  if (session.beginDefeatMusic) session.beginDefeatMusic(8);
  else if (session.music) { session.music.setIntensity(0); session.music.play('defeat'); }

  let fired = false;
  session.transition.start(1.0, async () => {
    if (fired) return;
    fired = true;
    const party = session.party;
    const lost = Math.floor((party.gold | 0) * 0.1);
    party.gold = (party.gold | 0) - lost;
    // MONEY PRINTER CLOSED (systems3 #2): the 10% penalty reaches the BANK
    // too, and the defeat-added week never accrues interest - the account's
    // settlement anchor is pushed past it. Wipe-spamming beside a full vault
    // now costs 10% a wipe instead of minting 5% a wipe.
    let bankLost = 0;
    if (party.bank && (party.bank.balance | 0) > 0) {
      bankLost = Math.floor(party.bank.balance * 0.1);
      party.bank.balance -= bankLost;
      party.bank.lastMinutes = (Number.isFinite(party.bank.lastMinutes)
        ? party.bank.lastMinutes : session.clock.minutes) + 7 * 24 * 60;
    }
    party.deaths = (party.deaths | 0) + 1;
    for (const c of party.members || []) {
      c.deaths = (c.deaths | 0) + 1;
      // MM6 revives the fallen WEAK, at one hit point: defeat is not a free
      // temple visit, and the temple stays in business (systems #10).
      c.conditions = { weak: true };
      c.hp = 1;
      c.recovery = 0;
    }
    // A week passes while somebody drags four bodies back to town.
    session.clock.advanceMinutes(7 * 24 * 60);
    if (session.party) session.party._tickedTo = session.clock.minutes;
    if (session._tickAnchor !== undefined) session._tickAnchor = session.clock.minutes;
    try {
      if (session.mapId !== 'new_sorpigal' || (session.map && session.map.indoor)) {
        const { loadRegion } = await import('../bootstrap.js');
        await loadRegion(session, 'new_sorpigal', session.worldSeed || 1);
      }
      // Wake at the ACTUAL town fountain - resolved from the loaded town
      // layout, never map.start's world-origin fallback (playtest #2).
      if (session.map && session.townRespawnPoint) {
        const spot = session.findClearSpot(session.map, session.townRespawnPoint());
        session.player.pos.set(spot.x, spot.y, spot.z);
        session.player.vel.set(0, 0, 0);
        session.player.yaw = spot.yaw || 0;
      }
      if (session.clearHostilesNear) {
        session.clearHostilesNear(session.player.pos.x, session.player.pos.z, 1500);
      }
      // Safe-spawn grace (wowjudge #1): nothing within 2500u, and nothing
      // engages until the player's first movement input.
      if (session.applySafeArrival) session.applySafeArrival(2500);
      else if (session.beginGrace) session.beginGrace(2);
    } catch (err) { console.warn('defeat respawn failed', err); }
    session.inCombat = false;
    session.turnBased = false;
    session._combatLinger = 0;
    const lostMsg = bankLost > 0 ? `${lost} gold (and ${bankLost} from the bank) poorer` : `${lost} gold poorer`;
    session.message(`You come to by the fountain in New Sorpigal, a week later and ${lostMsg}.`, '#ffd84a');
    session.message('Weakened: -2 max HP/SP and dulled stats until cured - rest, or pay the temple.', '#ffd84a');
    // Music: the dirge is still holding the deck; the director takes over
    // when the override clears. No forced 'field' here (audio #2/#3).
    session._defeatCooldown = 3;
    session._defeatBusy = false;
  });
  return true;
}

// --- kills, loot, quests -------------------------------------------------------

function announceQuestChanges(session, changed) {
  for (const q of changed || []) {
    if (q.state === 'complete') {
      session.message(`Quest complete: ${q.title} - return to ${q.giver}.`, '#ffd84a');
      if (session.audio) session.audio.play('quest_complete', { volume: 0.7 });
    } else {
      const o = (q.objectives || []).find((x) => !x.done && x.count > 1);
      session.message(`Quest: ${q.title}${o ? ` (${o.progress}/${o.count})` : ' updated'}.`, '#ffd84a');
    }
  }
}

function killMonster(session, e, source) {
  e.dead = true;
  e.solid = false;
  e.setAction('die');
  e.state = 'dead';
  const def = e.data || {};
  if (session.audio) {
    if (def.sound) session.audio.play(def.sound, { pos: e.pos, rate: 0.85, volume: 0.9 });
    session.audio.play('monster_die', { pos: e.pos, volume: 0.5 });
  }

  const party = session.party;
  const combat = session.modules?.combatMod;
  const xp = def.xp || (def.level || 1) * 25;

  // XP through awardXP: split across everyone not dead/eradicated/stoned
  // (unconscious members still learn, as MM6 rules it), then each character's
  // Learning multiplier applies individually.
  if (combat && combat.awardXP && party.members) {
    const res = combat.awardXP(party.members, xp);
    session.message(`The party gains ${xp} experience.`, '#ffd84a');
    for (const rep of res) {
      if (rep.canLevel) session.message(`${rep.character} is ready to train to level ${rep.atLevel}.`, '#ffd84a');
    }
  } else {
    for (const m of (party.members || [])) m.xp = (m.xp || 0) + Math.max(1, Math.floor(xp / 4));
  }

  // Bookkeeping the awards system reads.
  const killer = source && source.kills !== undefined ? source
    : (party.members || [])[session.activeChar] || null;
  if (killer) killer.kills = (killer.kills || 0) + 1;
  party.monstersKilled = (party.monstersKilled | 0) + 1;
  party.killsByKind = party.killsByKind || {};
  if (def.kind) party.killsByKind[def.kind] = (party.killsByKind[def.kind] || 0) + 1;

  // Quest events: the kill itself, and the dungeon-cleared beat when the last
  // hostile in an indoor map drops.
  const changed = dispatchQuestEvent(party, { type: 'kill', monsterId: e.kind, count: 1 });
  announceQuestChanges(session, changed);
  if (session.map && session.map.indoor) {
    const anyLeft = session.entities.list.some(
      (m) => m !== e && m.category === CATEGORY.MONSTER && !m.dead && (!m.data || m.data.hostile !== false),
    );
    if (!anyLeft) {
      session.message(`${session.map.name || 'The dungeon'} is cleared!`, '#ffd84a');
      announceQuestChanges(session, dispatchQuestEvent(party, {
        type: 'clear', dungeonId: session.mapId, dungeonName: session.map.name || '',
      }));
    }
  }
  const newly = updateAwards(party, { killsByKind: party.killsByKind, questsDone: party.questsDone | 0 });
  for (const a of newly) session.message(`${a.character} earns the award: ${a.award.name}.`, '#ffd84a');

  // Loot: the bestiary's own gold table, and a treasure roll.
  const items = session.modules?.itemMod;
  const lrnd = new Rand(e.id * 7919);
  if (items && items.randomLoot) {
    const loot = items.randomLoot(lrnd, def.treasureLevel || def.level || 1, 1);
    for (const it of loot) session.spawner.dropItem(it, e.pos.x + lrnd.float(-60, 60), e.pos.y, e.pos.z + lrnd.float(-60, 60));
  }
  const gold = def.gold ? Math.max(0, Math.round(def.gold * lrnd.float(0.6, 1.4))) : 0;
  if (gold > 0) session.spawner.dropItem({ type: 'gold', name: `${gold} gold`, gold }, e.pos.x, e.pos.y, e.pos.z);

  // Last engaged enemy down: victory sting, then back to the field music.
  if (session.countHostiles && session.countHostiles() === 0 && session.inCombat) {
    session.notifyVictory && session.notifyVictory();
  }
}

function openChest(session, e, rnd) {
  const info = e.interact;
  if (info.opened) { session.message('The chest is empty.'); return; }
  info.opened = true;
  if (session.audio) session.audio.play('chest_open');
  const items = session.modules?.itemMod;
  const loot = items && items.randomLoot ? items.randomLoot(rnd, info.level || 1, rnd.int(1, 4)) : [];
  for (const it of loot) session.spawner.dropItem(it, e.pos.x + rnd.float(-80, 80), e.pos.y, e.pos.z + rnd.float(-80, 80));
  const gold = rnd.int(20, 60) * (info.level || 1);
  session.party.gold += gold;
  // Say what was in it, by name - silent auto-dump reads as a bug.
  const names = loot.map((it) => (items && items.itemName ? items.itemName(it, true) : (it.name || 'an item')));
  session.message(`Chest: ${gold} gold${names.length ? `, ${names.join(', ')}` : ''}.`, '#ffd84a');
  const sh = session.spawner.sheet('prop', 'chest_open', 1);
  if (sh) { e.sheet = sh; e.setAction('stand'); }
}

function pickUp(session, e) {
  const item = e.data;
  const items = session.modules?.itemMod;
  if (item && (item.gold || item.type === 'gold')) {
    const amount = item.gold || item.quantity || 0;
    session.party.gold += amount;
    session.message(`You pick up ${amount} gold.`, '#ffd84a');
    if (session.audio) session.audio.play('gold_pickup');
  } else if (item) {
    const p = session.modules?.partyMod;
    const ch = session.party.members[session.activeChar];
    // Items occupy rectangles in a 14x9 grid, so the party module has to place
    // them; only fall back to a flat list if it is unavailable.
    let ok = false;
    if (p && p.giveItem) ok = !!p.giveItem(session.party, item);
    else if (p && p.invAdd && ch) ok = !!p.invAdd(ch.inventory, item);
    else if (ch && Array.isArray(ch.inventory)) { ch.inventory.push(item); ok = true; }
    else if (ch && ch.inventory && Array.isArray(ch.inventory.items)) { ch.inventory.items.push(item); ok = true; }
    if (!ok) { session.message('There is no room in your packs.'); return; }
    // Name it properly: generated loot carries a def id, not a prose name
    // (playtest #14 - "You pick up an item." for everything).
    const label = (items && items.itemName ? items.itemName(item, !!item.identified) : null)
      || item.name || 'an item';
    session.message(`You pick up ${label}.`);
    if (session.audio) session.audio.play('item_pickup');
    // Fetch quests watch the floor as well as the corpse.
    const changed = dispatchQuestEvent(session.party, {
      type: 'collect', itemId: item.def, artifactId: item.artifact || null, count: 1,
    });
    announceQuestChanges(session, changed);
  }
  e.remove = true;
}

function toggleDoor(session, e) {
  const d = e.interact;
  if (d.locked) {
    session.message('The door is locked.');
    if (session.audio) session.audio.play('door_locked');
    return;
  }
  d.open = !d.open;
  if (d.mesh) d.mesh.visible = !d.open;
  if (d.collider) d.collider.disabled = d.open;
  if (session.audio) session.audio.play(d.open ? 'door_open' : 'door_close');
}

function doTransition(session, t) {
  session.transition.start(0.35, async () => {
    const { loadRegion, loadDungeon } = await import('../bootstrap.js');
    if (t.toDungeon) {
      // Remember the door we came in through so the dungeon can offer it back.
      session._dungeonBack = t.back || null;
      await loadDungeon(session, t.toDungeon, t.seed || 1, t.entry);
      // BOTH kind and type, always (systems #1): the save loader dispatches on
      // `type`, this side historically wrote only `kind`, and every dungeon
      // save loaded as an overworld region at (0,800,0).
      session.mapMeta = {
        kind: 'dungeon', type: 'dungeon', id: session.mapId, spec: t.toDungeon,
        seed: t.seed || 1, back: t.back || null, entry: t.entry || null,
      };
    } else if (t.toRegion) {
      const es = session.escort;
      session._dungeonBack = null;
      // Regions ALWAYS regenerate from the one world seed - a door that
      // carried its own seed rerolled every POI in the region it led back to
      // (playtest #4: Goblinwatch moved 20k units after a defeat reload).
      const seed = session.worldSeed ?? t.seed ?? 1;
      await loadRegion(session, t.toRegion, seed, t.entry);
      session.mapMeta = { kind: 'region', type: 'region', id: session.mapId, seed, entry: t.entry || null };
      // Reaching the road out with the charge alive counts as delivered.
      if (es && es.quest) {
        const o = (es.quest.objectives || []).find((x) => x.kind === 'escort');
        if (o) {
          announceQuestChanges(session, dispatchQuestEvent(session.party, {
            type: 'escort', npcId: o.target, arrived: true,
          }));
        }
        session.escort = null;
      }
    }
  });
}

// Re-exported for the dialogue screen, which drives accept/turn-in directly.
export { giveQuest, turnInQuest, dispatchQuestEvent, updateAwards, refreshGating, announceQuestChanges };
