import { Entity, CATEGORY } from '../ents/entity.js';
import { Rand } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Turning map data into live sprites.
//
// The world generator emits plain descriptors ("an oak here, a goblin pack
// there"); this turns them into entities bound to baked sprite sheets, and
// handles respawning when the party comes back a few days later.
// ---------------------------------------------------------------------------

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

    for (const f of region.flora || []) {
      const sh = this.sheet('flora', f.kind, f.seed || 1);
      if (!sh) continue;
      S.entities.add(new Entity({
        category: CATEGORY.FLORA, kind: f.kind, sheet: sh, static: true,
        x: f.x, y: f.y ?? ground(f.x, f.z), z: f.z,
        scale: f.scale || 1, radius: f.radius ?? 70,
        solid: f.solid ?? true, action: 'stand',
      }));
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

    for (const s of region.spawns || []) {
      this.spawnGroup(s, rnd, ground);
    }

    // Towns are part of the outdoor map in MM6 - you walk up to a shop's door
    // and the establishment opens over the world view.
    for (const town of region.towns || []) this.populateTown(town, ground, rnd);

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
        interact: { kind: 'door', ...door.userData.door, mesh: door },
        label: 'Door',
      }));
    }
  }

  populateDungeon(dungeon, seed) {
    const S = this.session;
    const rnd = new Rand(seed ^ 0xd06);
    const ground = (x, z) => S.map.groundAt(x, z, 0);

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
    for (const s of dungeon.spawns || []) {
      this.spawnGroup(s, rnd, ground);
    }
  }

  spawnNPC(n, ground) {
    const sh = this.sheet('npc', n.archetype || n.kind || 'peasant_m', n.seed || 1);
    if (!sh) return null;
    const e = new Entity({
      category: CATEGORY.NPC, kind: n.archetype || n.kind, sheet: sh,
      x: n.x, y: n.y ?? ground(n.x, n.z), z: n.z,
      yaw: n.yaw || 0, radius: 70, solid: false,
      patrol: n.patrol || null, speed: 180,
      interact: { kind: 'npc', npc: n.npc || n },
      label: n.name || 'Townsperson',
    });
    e.data = n.npc || n;
    return this.session.entities.add(e);
  }

  /** A spawn descriptor may name one monster or a pack. */
  spawnGroup(s, rnd, ground) {
    const ids = s.kinds || (s.kind ? [s.kind] : []);
    if (!ids.length) return;
    const count = s.count || (s.groupSize ? rnd.int(s.groupSize[0], s.groupSize[1]) : 1);
    const spread = s.spread ?? 420;
    for (let i = 0; i < count; i++) {
      const kind = ids[rnd.int(ids.length)];
      const x = s.x + (i === 0 ? 0 : rnd.float(-spread, spread));
      const z = s.z + (i === 0 ? 0 : rnd.float(-spread, spread));
      this.spawnMonster(kind, x, ground(x, z), z, s);
    }
  }

  spawnMonster(kind, x, y, z, s = {}) {
    const sh = this.sheet('creature', kind, s.seed || 1);
    if (!sh) return null;
    const def = this.monsters && this.monsters.monsterById ? this.monsters.monsterById(kind) : null;
    // The rules layer works on combatant instances, not definitions.
    const mon = this.monsters && this.monsters.spawnMonster
      ? this.monsters.spawnMonster(kind, { x, y, z })
      : null;
    const e = new Entity({
      category: CATEGORY.MONSTER, kind, sheet: sh,
      x, y, z, yaw: Math.random() * Math.PI * 2,
      radius: def ? Math.max(50, (def.size || 200) * 0.32) : 70,
      solid: true, speed: def ? (def.speed || 260) : 260,
      aggroRange: def ? (def.aggroRange || 1800) : 1800,
      hp: mon ? mon.hp : (def ? def.hp : 20),
      maxHp: mon ? mon.maxHP : (def ? def.hp : 20),
      data: def || { name: kind, hp: 20, level: 1 },
      label: def ? def.name : kind,
      action: 'stand',
    });
    e.mon = mon;
    if (def && def.size && sh.worldH) e.scale = def.size / sh.worldH;
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
    return this.session.entities.add(new Entity({
      category: CATEGORY.ITEM, kind, sheet: sh, static: true,
      x, y, z, scale: 0.7, radius: 50, solid: false,
      data: item, label: item.name || 'Item',
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
