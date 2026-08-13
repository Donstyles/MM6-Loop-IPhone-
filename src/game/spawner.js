import { Entity, CATEGORY } from '../ents/entity.js';
import { Rand, hashStr } from '../core/rng.js';
import { npcName, profession, rumour, professionTalk } from './npcnames.js';

// ---------------------------------------------------------------------------
// Turning map data into live sprites.
//
// The world generator emits plain descriptors ("an oak here, a goblin pack
// there"); this turns them into entities bound to baked sprite sheets, and
// handles respawning when the party comes back a few days later.
// ---------------------------------------------------------------------------

// The world generator predates some of the model library's ids; map the old
// short names on so a prop is never silently dropped.
const KIND_ALIASES = {
  tree: 'oak', trees: 'oak', bush: 'bush_berry', shrub: 'bush_berry',
  flowers: 'flowers_white', flower: 'flowers_white', grass: 'grass_tuft',
  rock: 'rock_small', rocks: 'rock_small', stone: 'rock_small',
  stall: 'market_stall', ruins: 'gravestone', sign: 'signpost',
  lamp: 'lamppost', cart: 'cart', fire: 'campfire', torch: 'torch_wall',
};

export class Spawner {
  constructor(session) {
    this.session = session;
    this.sheets = null;      // ./art/spritebake.js
    this.monsters = null;    // ./game/monsters.js
    this.items = null;       // ./game/items.js
    this.renderer = session.engine.renderer;
    this.missing = new Set();
  }

  bind(mods) {
    this.sheets = mods.spriteMod || null;
    this.monsters = mods.monsterMod || null;
    this.items = mods.itemMod || null;
  }

  sheet(category, kind, seed = 1) {
    if (!this.sheets || !this.sheets.getSheet) return null;
    kind = KIND_ALIASES[kind] || kind;
    try {
      return this.sheets.getSheet(this.renderer, category, kind, seed);
    } catch (e) {
      if (!this.missing.has(kind)) {
        this.missing.add(kind);
        console.warn(`no sprite for ${category}/${kind}:`, e.message);
      }
      return null;
    }
  }

  // --- outdoor -------------------------------------------------------------

  populateRegion(region, seed) {
    const S = this.session;
    const rnd = new Rand(seed ^ 0x5eed);
    const ground = (x, z) => S.map.groundAt(x, z, 0);

    // The world seed is the key to everything reproducible: saves, quest
    // pools, respawns. Captured ONCE - later region loads (doors, defeat
    // reloads) must never overwrite it, or POI layouts reroll (playtest #4).
    // A restored save re-asserts its own seed through restoreState.
    if (S.worldSeed === null || S.worldSeed === undefined) S.worldSeed = seed;
    this._npcSeq = 0;
    if (S.ensureQuestPool) S.ensureQuestPool(region.id || S.mapId, seed);

    // Town centres (and wall radii), for the opening-ring spawn contract and
    // the quest-target ring below.
    this._townCenters = (region.towns || [])
      .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.z))
      .map((t) => ({ x: t.x, z: t.z, radius: Number.isFinite(t.radius) ? t.radius : 2400 }));
    this._lastRegionRef = region;

    // Flora is the region's own batched billboard field - see loadRegion. Only
    // place trees here if it did not, so the two can never both plant a wood.
    if (!region.hasFloraField) {
      for (const f of region.floraPlan || region.flora || []) {
        const sh = this.sheet('flora', f.kind, f.seed || 1);
        if (!sh) continue;
        const e = new Entity({
          category: CATEGORY.FLORA, kind: f.kind, sheet: sh, static: true,
          x: f.x, y: f.y ?? ground(f.x, f.z), z: f.z,
          radius: f.radius ?? 70, solid: f.solid ?? true, action: 'stand',
        });
        e.scale = f.height && sh.worldH ? f.height / sh.worldH : (f.scale || 1);
        S.entities.add(e);
      }
    }

    for (const p of region.props || []) {
      const sh = this.sheet('prop', p.kind, p.seed || 1);
      if (!sh) continue;
      const e = new Entity({
        category: CATEGORY.PROP, kind: p.kind, sheet: sh, static: !p.animated,
        x: p.x, y: p.y ?? ground(p.x, p.z), z: p.z,
        scale: p.scale || 1, radius: p.radius ?? 60, solid: p.solid ?? false,
        interact: p.interact || null, label: p.label || null,
        action: p.animated ? 'stand' : 'stand',
      });
      if (p.contents) e.data = { contents: p.contents };
      S.entities.add(e);
    }

    for (const n of region.npcs || region.npcSpawns || []) {
      this.spawnNPC(n, ground);
    }

    // Roaming packs. Each keeps its descriptor so a dead pack can respawn
    // (on a ~2-week cycle) once the party has moved on.
    S._spawnGroups = S._spawnGroups || [];
    let gid = 0;
    for (const s of region.spawns || []) {
      const id = gid++;
      S._spawnGroups.push({ id, desc: s, clearedAt: null });
      this.spawnGroup(s, rnd, ground, id);
    }

    // Towns are part of the outdoor map in MM6 - you walk up to a shop's door
    // and the establishment opens over the world view.
    for (const town of region.towns || []) this.populateTown(town, ground, rnd);

    // Named townsfolk pick up the region's quests once everyone is standing.
    if (S.attachQuestNPCs) S.attachQuestNPCs(region.id || S.mapId);

    // Dungeon mouths: an invisible marker in the doorway the party activates.
    for (const d of region.dungeons || []) {
      const x = d.entrance?.x ?? d.x, z = d.entrance?.z ?? d.z;
      if (x === undefined || z === undefined) continue;
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: 'dungeon_entrance', sheet: null, static: true,
        x, y: d.entrance?.y ?? ground(x, z), z,
        radius: 200, solid: false,
        interact: {
          kind: 'transition',
          toDungeon: { id: d.id, name: d.name, theme: d.theme, rooms: d.rooms, levels: d.levels },
          seed: d.seed || 1,
          back: { region: region.id, x, y: ground(x, z), z, yaw: d.yaw || 0 },
        },
        label: `Enter ${d.name || 'the dungeon'}`,
      }));
    }

    // Re-impose the world ledger (kills stay killed, loot stays dropped,
    // chests stay opened) - then top up any live kill-quest targets so the
    // board's culls are completable within a short walk of town.
    if (S.applyMapState) S.applyMapState();
    this.ensureQuestTargets(region, rnd, ground);

    // Every arrival in a region - new game, load, defeat reload, walking in
    // through a door - opens calm: hostiles within 2500u of the party are
    // pushed to the rim and nothing engages until the first movement input.
    if (S.applySafeArrival) S.applySafeArrival(2500);
  }

  populateTown(town, ground, rnd) {
    const S = this.session;

    for (const p of town.props || []) {
      const sh = this.sheet('prop', p.kind, p.seed || 1);
      if (!sh) continue;
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: p.kind, sheet: sh, static: true,
        x: p.x, y: p.y ?? ground(p.x, p.z), z: p.z,
        scale: p.scale || 1, solid: p.solid ?? false, label: p.label || null,
      }));
    }

    for (const n of town.npcSpawns || []) this.spawnNPC(n, ground);

    // Sprite-less markers at each door: they never draw, they just give the
    // party something to activate.
    for (const shop of town.shops || []) {
      const d = shop.door || {};
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: 'shopdoor', sheet: null, static: true,
        x: d.x ?? shop.x, y: d.y ?? ground(d.x ?? 0, d.z ?? 0), z: d.z ?? shop.z,
        radius: 120, solid: false,
        interact: { kind: 'shop', shopKind: shop.kind, shop, town },
        label: shop.name || shopLabel(shop.kind),
      }));
    }

    for (const door of town.doors || []) {
      if (!door.userData || !door.userData.door) continue;
      const p = door.position;
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: 'door', sheet: null, static: true,
        x: p.x, y: p.y, z: p.z, radius: 110, solid: false,
        // `kind` last: the spread carries the building's own doorKind, which
        // for a residence is 'house', and it was overwriting the 'door' kind
        // the handler dispatches on - so activating a front door did nothing at
        // all. The building kind rides along as `doorKind` instead.
        interact: { ...door.userData.door, kind: 'door', mesh: door },
        label: 'Door',
      }));
    }
  }

  populateDungeon(dungeon, seed) {
    const S = this.session;
    const rnd = new Rand(seed ^ 0xd06);
    const ground = (x, z) => S.map.groundAt(x, z, 0);
    this._npcSeq = 0;

    // The way back out. The dungeon's own start/exit marker sits where the
    // party arrived; activating it returns to the overworld at the door the
    // party came in through (stored by the transition glue).
    const back = S._dungeonBack || null;
    const exits = dungeon.exits && dungeon.exits.length
      ? dungeon.exits
      : [{ x: dungeon.start?.x || 0, y: (dungeon.startFloor ?? 0), z: dungeon.start?.z || 0 }];
    for (const ex of exits) {
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: 'dungeon_exit',
        sheet: this.sheet('prop', 'portal', 1) || null, static: true,
        x: ex.x, y: ex.y ?? ground(ex.x, ex.z), z: ex.z,
        radius: 220, solid: false, scale: 1,
        interact: {
          kind: 'transition',
          toRegion: (back && back.region) || ex.to || dungeon.exitTo || 'new_sorpigal',
          seed: S.worldSeed || 1,
          entry: back ? { x: back.x, y: back.y, z: back.z, yaw: back.yaw || 0 } : null,
        },
        label: 'Leave the dungeon',
      }));
    }

    for (const p of dungeon.props || []) {
      const sh = this.sheet('prop', p.kind, p.seed || 1);
      if (!sh) continue;
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: p.kind, sheet: sh, static: true,
        x: p.x, y: p.y ?? ground(p.x, p.z), z: p.z,
        scale: p.scale || 1, solid: p.solid ?? false,
        interact: p.interact || null, label: p.label || null,
      }));
    }
    for (const c of dungeon.chests || []) {
      const sh = this.sheet('prop', 'chest', c.seed || 1);
      if (!sh) continue;
      S.entities.add(new Entity({
        category: CATEGORY.PROP, kind: 'chest', sheet: sh, static: true,
        x: c.x, y: c.y ?? ground(c.x, c.z), z: c.z, solid: true, radius: 70,
        interact: { kind: 'chest', locked: c.locked, level: c.level || 1, trap: c.trap },
        label: 'Chest',
      }));
    }
    // Monster complement. A themed dungeon overrides the generic table -
    // Goblinwatch is full of goblins, not a random draw - and the deepest
    // room's flagged spawn is the boss tier of its family.
    const nameKey = String(dungeon.id || dungeon.name || '').toLowerCase();
    const themed = nameKey.includes('goblinwatch') ? ['GoblinA', 'GoblinA', 'GoblinB'] : null;
    const level = dungeon.difficulty || dungeon.spec?.difficulty || 2;
    for (const s of dungeon.spawns || []) {
      let kind = themed ? themed[rnd.int(themed.length)] : s.id;
      if (!kind && this.monsters && this.monsters.rollSpawn) {
        const roll = this.monsters.rollSpawn(rnd, dungeon.theme || 'cave', s.level || level);
        kind = roll && roll.id;
      }
      if (!kind) continue;
      if (s.boss) kind = this.bossTierOf(kind);
      const e = this.spawnMonster(kind, s.x, s.y ?? ground(s.x, s.z), s.z, s);
      if (e && s.boss) e.label = `${e.label} (leader)`;
      // DUNGEON FEEL (playtest3 #6): pair the singles. Generated populations
      // ran 22 monsters over 20k units of corridor - a slog of empty spans.
      // Every non-boss spawn brings a companion of its own kind.
      if (e && !s.boss) {
        const cx = s.x + rnd.float(140, 280) * (rnd.bool() ? 1 : -1);
        const cz = s.z + rnd.float(140, 280) * (rnd.bool() ? 1 : -1);
        this.spawnMonster(kind, cx, ground(cx, cz), cz, {});
      }
    }

    // Never bounce straight back out (playtest3 #7): if the arrival spot sits
    // on an exit trigger (radius 220), step the party >=300u into the dungeon
    // and face it that way.
    const pp = S.player && S.player.pos;
    if (pp) {
      for (const ex of exits) {
        const exX = ex.x, exZ = ex.z;
        if (Math.hypot(pp.x - exX, pp.z - exZ) >= 300) continue;
        const baseYaw = (dungeon.start && dungeon.start.yaw) || S.player.yaw || 0;
        for (const off of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const a = baseYaw + off;
          const nx = exX - Math.sin(a) * 340;
          const nz = exZ - Math.cos(a) * 340;
          const ny = ground(nx, nz);
          if (S.map.blocked && S.map.blocked(nx, ny + 8, nz, 40, 190)) continue;
          pp.set(nx, ny, nz);
          S.player.vel.set(0, 0, 0);
          S.player.yaw = a;
          break;
        }
        break;
      }
    }

    // Cleared stays cleared: the ledger replaces the fresh population with
    // the state the party left behind, until the long respawn timer lapses.
    if (S.applyMapState) S.applyMapState();
  }

  /** GoblinA -> GoblinC: the top tier of the same sprite family, if it exists. */
  bossTierOf(kind) {
    if (!/[AB]$/.test(kind)) return kind;
    const boss = kind.slice(0, -1) + 'C';
    const def = this.monsters && this.monsters.monsterById ? this.monsters.monsterById(boss) : null;
    return def ? boss : kind;
  }

  spawnNPC(n, ground) {
    const sh = this.sheet('npc', n.archetype || n.kind || 'peasant_m', n.seed || 1);
    if (!sh) return null;
    // Townsfolk arrive from the generator as bare {archetype, patrol, speed}
    // records; give each a seeded name, a trade and something to say, so the
    // dialogue screen never greets you as "undefined".
    const npc = this.enrichNPC(n);
    const e = new Entity({
      category: CATEGORY.NPC, kind: n.archetype || n.kind, sheet: sh,
      x: n.x, y: n.y ?? ground(n.x, n.z), z: n.z,
      yaw: n.yaw || 0, radius: 70, solid: false,
      patrol: n.patrol || null, speed: 180,
      interact: { kind: 'npc', npc },
      label: npc.name,
    });
    e.data = npc;
    return this.session.entities.add(e);
  }

  /** Build the NPCDef the dialogue screen consumes, deterministically. */
  enrichNPC(n) {
    if (n.npc && n.npc.name) return n.npc;
    const S = this.session;
    const seq = this._npcSeq = (this._npcSeq || 0) + 1;
    const rnd = new Rand(hashStr(`${S.worldSeed || 1}:${S.mapId || 'map'}:npc:${seq}`));
    const arch = String(n.archetype || n.kind || 'peasant');
    const sex = /_f|woman|matron/.test(arch) ? 'f' : /_m|man\b/.test(arch) ? 'm' : (rnd.bool() ? 'm' : 'f');
    const prof = n.profession || profession(rnd);
    const name = n.name || npcName(rnd, sex, { epithet: false, title: false });
    const rumorPair = [rumour(rnd), rumour(rnd)];
    return Object.assign({
      name,
      npcId: name,
      title: prof,
      profession: prof,
      sex,
      portraitSeed: rnd.int(0, 0x7fffffff),
      greeting: rnd.pick([
        `"Well met. I am ${name}, ${prof.toLowerCase()} here."`,
        `${name} looks up from their work. "Yes? Be quick about it."`,
        `"A good day to you, travelers." ${name} gives a small nod.`,
        `"${prof}s see everything that passes through this town," says ${name}.`,
      ]),
      talk: professionTalk(rnd, prof),
      // Both spellings: the dialogue screen reads `rumours` (kept for API
      // compat); `rumors` is the canonical field going forward.
      rumours: rumorPair,
      rumors: rumorPair,
      questRefs: [],
    }, n.npc || {});
  }

  /** Distance from a point to the nearest town centre, or Infinity. */
  townDistance(x, z) {
    let best = Infinity;
    for (const t of this._townCenters || []) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** A spawn descriptor may name one monster or a pack. */
  spawnGroup(s, rnd, ground, groupId = null) {
    // Region descriptors say `id`, dungeon descriptors say `id` or nothing,
    // hand-written ones say `kind`/`kinds` - accept the lot.
    let ids = s.kinds || (s.kind ? [s.kind] : (s.id ? [s.id] : []));
    if (!ids.length) return;
    let count = s.count || (s.groupSize ? rnd.int(s.groupSize[0], s.groupSize[1]) : 1);
    // THE OPENING RING (playtest #1): within ~4000u of a town only weak melee
    // trash spawns, in singles and pairs; ranged/caster packs keep to the
    // outer rings. Handled here so it holds whatever the region rolled.
    if (!s.questTarget && this.monsters && this.monsters.shapeSpawnForTown && this._townCenters && this._townCenters.length) {
      const dist = this.townDistance(s.x, s.z);
      const regionId = (this.session.map && this.session.map.region && this.session.map.region.id) || this.session.mapId;
      const shaped = this.monsters.shapeSpawnForTown(regionId, dist, ids, count, rnd);
      ids = shaped.ids;
      count = shaped.count;
    }
    const spread = s.spread ?? 420;
    for (let i = 0; i < count; i++) {
      const kind = ids[rnd.int(ids.length)];
      const x = s.x + (i === 0 ? 0 : rnd.float(-spread, spread));
      const z = s.z + (i === 0 ? 0 : rnd.float(-spread, spread));
      const e = this.spawnMonster(kind, x, ground(x, z), z, s);
      if (e && groupId !== null) e.spawnGroup = groupId;
    }
  }

  /**
   * Make every ACCEPTED kill/bounty quest of this region completable within a
   * short walk: targets spawn in a ring just past the town wall (walls run
   * 2400-5600 units by settlement size, so the ring hugs wall+400..wall+1200,
   * within the 5200-unit "close" contract for starter towns). Rules learned
   * the hard way (playtest3 #2/#3, systems3 #4):
   *   - only quests the party has taken get topped up - the board is not a
   *     free-XP vending machine refilled on every door-hop;
   *   - the count compares against IN-RING stock, live AND recently dead:
   *     region-wide naturals 20k out no longer suppress the close spawn, and
   *     fresh corpses are not "missing" targets to re-mint over;
   *   - boss/dungeon-bound kills (a quest that also carries a clear
   *     objective, or a unique def) NEVER spawn in the overworld ring - the
   *     Goblin King lives in Goblinwatch and only there.
   * Bounty uniques get their posted name on the plate, and the ring bearing
   * is hashed from the quest id, so the quest text can honestly say which way
   * to walk.
   */
  ensureQuestTargets(region, rnd, ground) {
    const S = this.session;
    const town = (this._townCenters || [])[0];
    if (!town || !S.questPool) return;
    const regionId = region.id || S.mapId;
    const wallR = town.radius || 2400;
    const rMin = wallR + 400, rMax = wallR + 1200;
    // "Close" is 5200 for a starter town; a city's wall alone is 5600, so the
    // counting circle always encloses the spawn ring or corpses stop counting.
    const countR = Math.max(5200, rMax + 400);
    for (const q of S.questPool) {
      if (q.region !== regionId) continue;
      const dungeonBound = (q.objectives || []).some((x) => x.kind === 'clear');
      for (const o of q.objectives || []) {
        if (o.kind !== 'kill' || !o.target) continue;
        const def = this.monsters && this.monsters.monsterById ? this.monsters.monsterById(o.target) : null;
        if (dungeonBound || (def && def.unique)) continue;
        // The heading is stable per quest: text and spawns agree forever.
        const a0 = (hashStr(String(q.id)) % 6283) / 1000;
        this.noteQuestDirection(q, o, a0);
        if (q.state !== 'active' || o.done) continue;
        const need = Math.max(1, (o.count | 0) - (o.progress | 0));
        const inRing = S.entities.list.filter((e) => {
          if (e.kind !== o.target) return false;
          if (e.category !== CATEGORY.MONSTER && e.category !== CATEGORY.CORPSE) return false;
          return Math.hypot(e.pos.x - town.x, e.pos.z - town.z) < countR;
        }).length;
        if (inRing >= need) continue;
        const missing = Math.min(need - inRing, 8);
        for (let i = 0; i < missing; i++) {
          const a = a0 + (i / Math.max(1, missing)) * 0.9 + rnd.float(-0.12, 0.12);
          const r = rnd.float(rMin, rMax);
          const x = town.x + Math.cos(a) * r;
          const z = town.z + Math.sin(a) * r;
          const e = this.spawnMonster(o.target, x, ground(x, z), z, { questTarget: true });
          if (e && q.uniqueName && o.unique) e.label = q.uniqueName;
        }
      }
    }
  }

  /** 'They were last seen southwest of town.' - from the actual ring bearing. */
  noteQuestDirection(q, o, angle) {
    if (q._directionNoted) return;
    q._directionNoted = true;
    // Ring maths: x = cos(a), z = sin(a). North is -Z, east is +X.
    const dx = Math.cos(angle + 0.45), dz = Math.sin(angle + 0.45); // mid-arc
    const octant = Math.round(((Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][octant];
    q.direction = dir;
    const hint = ` Last seen ${dir} of town.`;
    if (q.text && q.text.indexOf(' of town.') < 0) q.text += hint;
    if (o.text && o.text.indexOf(' of town') < 0) o.text += ` (${dir} of town)`;
  }

  /**
   * Top-up entry point for mid-session quest acceptance: uses the state the
   * last populateRegion stashed, so 'Cull the Bats' has bats in the ring the
   * moment the party takes it, not after the next region reload.
   */
  topUpQuestTargets() {
    const S = this.session;
    if (!this._lastRegionRef || !S.map || S.map.indoor) return;
    const rnd = S.rngFor ? S.rngFor('questtargets') : new Rand(1);
    this.ensureQuestTargets(this._lastRegionRef, rnd, (x, z) => S.collision.groundAt(x, z, 0));
  }

  spawnMonster(kind, x, y, z, s = {}) {
    let sh = this.sheet('creature', kind, s.seed || 1);
    // A transient baker throw right after boot must not silently erase the
    // record (systems3 #6): retry, then borrow the family's base sheet, then
    // any sheet at all - a mislabeled goblin beats a vanished monster.
    if (!sh && this.sheets) {
      sh = this.sheet('creature', kind, (s.seed || 1) + 1);
      if (!sh && /[ABC]$/.test(String(kind))) sh = this.sheet('creature', String(kind).slice(0, -1) + 'A', 1);
      if (!sh) sh = this.sheet('creature', 'GoblinA', 1);
    }
    if (!sh) return null;
    const def = this.monsters && this.monsters.monsterById ? this.monsters.monsterById(kind) : null;
    // Peasants and other non-hostiles must never chase: the entity AI has no
    // hostility check, so a zero aggro range is what keeps them civilians.
    const aggro = def && def.hostile === false ? 0 : (def ? (def.aggroRange || 1800) : 1800);
    // The rules layer works on combatant instances, not definitions.
    const mon = this.monsters && this.monsters.spawnMonster
      ? this.monsters.spawnMonster(kind, { x, y, z })
      : null;
    const e = new Entity({
      category: CATEGORY.MONSTER, kind, sheet: sh,
      x, y, z, yaw: Math.random() * Math.PI * 2,
      radius: def ? Math.max(50, (def.size || 200) * 0.32) : 70,
      solid: true, speed: def ? (def.speed || 260) : 260,
      aggroRange: aggro,
      hp: mon ? mon.hp : (def ? def.hp : 20),
      maxHp: mon ? mon.maxHP : (def ? def.hp : 20),
      data: def || { name: kind, hp: 20, level: 1 },
      label: def ? def.name : kind,
      action: 'stand',
    });
    e.mon = mon;
    // The quad is taller than the creature inside it, so scaling by worldH
    // renders every monster short. scaleFor() measures against the model.
    if (def && def.size) {
      e.scale = sh.scaleFor ? sh.scaleFor(def.size)
        : (sh.height ? def.size / sh.height : (sh.worldH ? def.size / sh.worldH : 1));
    }
    e.home.set(x, y, z);
    return this.session.entities.add(e);
  }

  /** Drop an item sprite on the ground where something died. */
  dropItem(item, x, y, z) {
    const kindMap = {
      weapon: 'item_sword', bow: 'item_bow', shield: 'item_shield',
      helm: 'item_helm', armor: 'item_armor', potion: 'item_potion',
      scroll: 'item_scroll', gold: 'item_gold', gem: 'item_gem',
      ring: 'item_ring', amulet: 'item_ring', wand: 'item_wand', book: 'item_book',
    };
    const kind = kindMap[item.slot || item.type] || 'item_gold';
    const sh = this.sheet('prop', kind, 1);
    if (!sh) return null;
    // A floor drop is named on hover: gold says how much, gear says what it
    // is (playtest #14 - "gold piles labeled Item").
    const label = item.gold ? `${item.gold} gold`
      : item.name
        || (this.items && this.items.itemName ? this.items.itemName(item, !!item.identified) : null)
        || 'Item';
    return this.session.entities.add(new Entity({
      category: CATEGORY.ITEM, kind, sheet: sh, static: true,
      x, y, z, scale: 0.7, radius: 50, solid: false,
      data: item, label,
      interact: { kind: 'item', item },
    }));
  }
}

const SHOP_LABELS = {
  weapon: 'Weapon Smith', armor: 'Armourer', magic: 'Magic Shop',
  alchemy: 'Alchemist', general: 'General Store', tavern: 'Tavern',
  temple: 'Temple', training: 'Training Hall', bank: 'Bank',
  townhall: 'Town Hall', stables: 'Stables', docks: 'Docks', guild: 'Guild',
};

function shopLabel(kind) { return SHOP_LABELS[kind] || 'Shop'; }
