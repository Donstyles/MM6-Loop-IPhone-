// ---------------------------------------------------------------------------
// Inventory grid and paperdoll.
//
// MM6 gives every character a 14 x 9 grid of 32-pixel cells at (14, 17) inside
// the panel and lets items occupy rectangles of them; you pick an item up onto
// the cursor and drop it wherever it fits, including onto a body slot to equip
// it. That pick-up-and-carry model is the whole interaction, so it is
// implemented here rather than faked with drag events: `ui.cursorItem` is the
// hand. The paperdoll lives in the right-hand column, where MM6 draws it on
// every tab of the sheet.
//
// The bag itself is party.js's canonical grid - { w, h, cells, items } built
// by makeInventory - and every move goes through invAdd / invRemove so the
// cell stamps never drift from the item list. This screen never replaces or
// reshapes that object; the same bag the loot and shop code fills is the one
// drawn here.
//
// Item icons are procedural. `itemIcon()` sizes mm6art's painted item bitmaps
// to the item's grid footprint and caches them, so no art files are needed.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, SIDE, TAB_X, TAB_Y, TAB_W, TAB_H, px, py,
  WHITE, CANARY, HILITE, drawTabs, drawWrapped,
} from './screenbase.js';
import * as M from './mm6art.js';
import { CLASSES } from '../../game/stats.js';
import {
  itemDef, itemName, itemDescription, TYPE_SLOT,
} from '../../game/items.js';
import {
  makeInventory, invAdd, invRemove, equip, recompute, useItem,
} from '../../game/party.js';

// --- item model -------------------------------------------------------------

/** Body slots, in paperdoll order. */
export const SLOTS = [
  'helm', 'amulet', 'cloak', 'armor', 'gauntlets', 'belt', 'boots',
  'mainhand', 'offhand', 'bow', 'ring1', 'ring2',
];

/** Fallback grid footprint per item type, for items with no definition. */
const TYPES = {
  weapon: { w: 1, h: 3 }, bow: { w: 2, h: 4 }, shield: { w: 2, h: 2 },
  helm: { w: 2, h: 2 }, armor: { w: 2, h: 3 }, boots: { w: 2, h: 2 },
  gauntlets: { w: 1, h: 2 }, belt: { w: 2, h: 1 }, cloak: { w: 2, h: 2 },
  amulet: { w: 1, h: 1 }, ring: { w: 1, h: 1 }, potion: { w: 1, h: 1 },
  scroll: { w: 1, h: 2 }, wand: { w: 1, h: 3 }, spellbook: { w: 2, h: 2 },
  gem: { w: 1, h: 1 }, gold: { w: 1, h: 1 }, reagent: { w: 1, h: 1 },
  food: { w: 1, h: 1 }, misc: { w: 1, h: 1 },
};

function typeOf(item) { return TYPES[item && item.type] || TYPES.misc; }
export function itemW(item) { return (item && (item.gw || item.w)) || typeOf(item).w; }
export function itemH(item) { return (item && (item.gh || item.h)) || typeOf(item).h; }

// --- what a thing is made of ------------------------------------------------
//
// An item *instance* is `{ uid, def, type, bonus, ... }` and carries none of
// the art's vocabulary; the definition holds the name, the armour skill and the
// class. This resolves one into the terms the painters speak: which family of
// object it is, what it is made of, and any colour it carries.

const WEAPON_KIND = {
  dagger: 'dagger', sword: 'sword', axe: 'axe', spear: 'spear',
  mace: 'mace', staff: 'staff', bow: 'bow', blaster: 'wand',
};
/** Body armour takes its material from the skill it trains. */
const ARMOR_MAT = { plate: 'steel', chain: 'iron', leather: 'leather' };

/** Potion liquid, keyed off the definition's colour word. */
const POTION_CSS = {
  red: '#c02818', blue: '#2848d8', yellow: '#e0d020', purple: '#9038c8',
  orange: '#e08018', green: '#28c828', white: '#f0f0e0', black: '#302838',
  grey: '#a0a0a8', cyan: '#40d8d8', pink: '#f090b0', gold: '#e1cd23',
  crimson: '#e02040', azure: '#4090f0', violet: '#a060e0', emerald: '#20c070',
  amber: '#e0a020', silver: '#d0d0e0', opal: '#e0d0f0', clear: '#c8d8e0',
  radiant: '#fff0c0', radiant_blue: '#c0e0ff', radiant_gold: '#ffe080', stone: '#a09080',
};

export function gearInfo(item) {
  const def = (item && item.def && itemDef(item.def)) || null;
  const type = (item && item.type) || (def && def.type) || 'misc';
  const skill = (def && def.skill) || (item && item.skill) || null;
  const name = (def && def.name) || (item && item.name) || '';
  const heavy = /plate|gothic|tower/i.test(name);
  const soft = /leather|cloth|coif|fur/i.test(name);
  let kind = type, mat = 'steel', cloth = null, accent = null;
  switch (type) {
    case 'weapon': kind = WEAPON_KIND[skill] || 'sword'; mat = skill === 'staff' ? 'wood' : 'steel'; break;
    case 'bow': kind = 'bow'; mat = 'wood'; break;
    case 'shield': kind = 'shield'; mat = heavy ? 'steel' : 'wood'; break;
    case 'armor': kind = 'armor'; mat = ARMOR_MAT[skill] || 'steel'; break;
    case 'helm': kind = 'helm';
      mat = /crown/i.test(name) ? 'gold' : /coif/i.test(name) ? 'iron'
        : soft ? 'leather' : heavy ? 'steel' : 'iron';
      break;
    case 'boots': case 'gauntlets': kind = type; mat = heavy ? 'steel' : 'leather'; break;
    case 'belt': kind = 'belt'; mat = heavy ? 'steel' : 'leather'; break;
    // A cloak is dyed wool, tanned fur or velvet, none of which is a MAT entry.
    case 'cloak': kind = 'cloak'; mat = null;
      cloth = /fur/i.test(name) ? [132, 116, 90] : /velvet/i.test(name) ? [70, 96, 140] : [140, 52, 42];
      break;
    case 'amulet': case 'ring': kind = type; mat = 'gold'; break;
    case 'wand': kind = 'wand'; mat = 'wood'; break;
    case 'potion': kind = 'potion'; mat = 'crystal';
      accent = POTION_CSS[def && def.color] || '#c02818';
      break;
    case 'scroll': kind = 'scroll'; mat = 'bone'; break;
    case 'spellbook': kind = 'spellbook'; mat = 'leather'; break;
    case 'gem': kind = 'gem'; mat = 'crystal';
      accent = { gem_quartz: '#e8e8f0', gem_amber: '#e0a020', gem_garnet: '#a02040', gem_sapphire: '#3050d0', gem_ruby: '#d02030', gem_diamond: '#e8f4ff' }[item && item.def] || '#40d8d8';
      break;
    case 'gold': kind = 'gold'; mat = 'gold'; break;
    case 'food': kind = 'reagent'; mat = 'leather'; accent = '#c09040'; break;
    default: kind = 'reagent'; mat = 'wood'; break;
  }
  return {
    name, icon: kind, material: mat, skill, cloth,
    armor: (def && def.ac) | 0,
    // An artifact carries gilt of its own; a potion its liquid. Everything
    // else stays material-coloured or the doll turns into a paintbox.
    tint: item && item.artifactId ? '#b8962a' : accent,
  };
}

/** The body slot this item may be dropped on (`target`), or null. */
export function slotFor(item, target) {
  const def = itemDef(item && item.def);
  const type = (def && def.type) || (item && item.type);
  const base = TYPE_SLOT[type] || null;
  if (!base) return null;
  if (!target) return base;
  if (base === target) return target;
  // Rings go on either hand; a one-hander may be held in the off hand.
  if (base === 'ring1' && target === 'ring2') return target;
  if (base === 'mainhand' && target === 'offhand' && def && !def.twoHanded
      && ['sword', 'dagger', 'mace'].indexOf(def.skill) >= 0) return target;
  return null;
}

// --- procedural icons -------------------------------------------------------

const ICON_CACHE = new Map();
const CELL = 32;

/**
 * A painted item bitmap. MM6's icons are modelled objects - a blade with a
 * bright edge and a dark flat, a wrapped grip, a pommel, a bow with a curved
 * limb and a taut string - so the whole set is painted in mm6art.js and simply
 * sized to the item's grid footprint here.
 */
export function itemIcon(item, cell = CELL) {
  const g = gearInfo(item);
  const kind = g.icon;
  const mat = g.material || 'steel';
  const w = itemW(item) * cell - 8;
  const h = itemH(item) * cell - 8;
  const key = `${kind}|${mat}|${g.tint || ''}|${w}x${h}`;
  let c = ICON_CACHE.get(key);
  if (c) return c;
  c = M.itemArt(kind, Math.max(6, w), Math.max(8, h), { mat, accent: g.tint || null });
  ICON_CACHE.set(key, c);
  return c;
}

// --- paperdoll --------------------------------------------------------------
//
// MM6 paints a body and then paints the equipped items straight on to it at
// their anatomical positions: the helm on the skull, the cuirass following the
// chest, the shield on the off arm, the blade hanging from the fist, the boots
// on the feet, the cloak behind the shoulders. There is no slot chrome - no
// cells, no boxes, no borders, no captions - and an empty slot simply shows the
// body. The painting is all in mm6art.js; what is left here is the character's
// own build and colouring, the hit rectangles (which are never drawn), and the
// cache, because the doll is on screen every frame and is far too much painting
// to redo at 60Hz.

const WELL = { x: SIDE.x + 4, y: 6, w: 164, h: 282 };

function equipOf(ch) {
  if (!ch.equipment) ch.equipment = {};
  return ch.equipment;
}

/**
 * The hit rectangles, derived from the painted anatomy. Nothing is drawn for
 * them. They are tested most-specific first, because a click is consumed by the
 * first region that takes it and the cloak's rectangle covers most of the body.
 */
const HIT_ORDER = ['helm', 'amulet', 'mainhand', 'offhand', 'ring1', 'ring2',
  'gauntlets', 'belt', 'boots', 'bow', 'armor', 'cloak'];

function slotPlacement(a) {
  const bw = a.bodyW, hw = a.headW;
  const rect = (x0, y0, x1, y1) => ({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
  const lh = a.hands.left, rh = a.hands.right;
  return {
    helm: rect(a.cx - hw - 3, a.top - 6, a.cx + hw + 3, a.top + a.headH * 0.55),
    amulet: rect(a.cx - bw * 0.5, a.shoulderY - 2, a.cx + bw * 0.5, a.shoulderY + a.torsoH * 0.34),
    armor: rect(a.cx - bw * 1.2, a.shoulderY - 3, a.cx + bw * 1.2, a.hipY + 2),
    cloak: rect(a.cx - bw * 2.2, a.shoulderY - 8, a.cx + bw * 2.2, a.hipY + a.legH * 0.6),
    belt: rect(a.cx - bw * 1.1, a.hipY - a.H * 0.05, a.cx + bw * 1.1, a.hipY + 4),
    boots: rect(a.cx - bw * 1.3, a.baseY - a.legH * 0.42, a.cx + bw * 1.3, a.baseY + 4),
    gauntlets: rect(lh.x - lh.w * 1.6, lh.y - 8, rh.x + rh.w * 1.6, rh.y + rh.h + 4),
    mainhand: rect(rh.x - bw * 0.8, rh.y - 10, rh.x + bw * 0.8, rh.y + a.H * 0.30),
    offhand: rect(a.arms.left.ex - bw * 1.6, a.arms.left.ey - a.torsoH * 0.55,
      a.arms.left.ex + bw * 0.5, a.arms.left.ey + a.torsoH * 0.45),
    bow: rect(a.cx + bw * 1.6, a.shoulderY - a.H * 0.06, a.cx + bw * 2.6, a.hipY + a.legH * 0.3),
    ring1: rect(lh.x - lh.w * 1.4, lh.y + lh.h * 0.3, lh.x, lh.y + lh.h * 0.9),
    ring2: rect(rh.x, rh.y + rh.h * 0.3, rh.x + rh.w * 1.4, rh.y + rh.h * 0.9),
  };
}

/** What the painters need to know about the loadout, and nothing else. */
function wornSet(eq) {
  const out = {};
  for (const slot of SLOTS) if (eq[slot]) out[slot] = gearInfo(eq[slot]);
  return out;
}

/** What the cached doll bitmap is keyed on: everything that changes its pixels. */
function dollKey(look, worn) {
  let k = `${look.buildIdx}|${look.skin}|${look.hair}|${look.tunic}|${look.trews}|`
    + `${look.boots}|${look.beard ? 1 : 0}|${look.longHair ? 1 : 0}`;
  for (const slot of SLOTS) {
    const w = worn[slot];
    if (w) k += `|${slot}:${w.icon}:${w.material}:${w.skill}:${w.tint}:${w.armor}:${w.cloth}:${w.name}`;
  }
  return k;
}

/**
 * The paperdoll column. Shared by the character sheet and the inventory, since
 * MM6 keeps it on screen for both. `screen` supplies the ui context and the
 * carry/equip behaviour.
 */
export function drawPaperdoll(ctx, screen, ch) {
  const ui = screen.ui;
  const r = WELL;
  A.stone(ctx, SIDE.x, 0, SIDE.w, 352, { rivets: true, gold: true });

  const eq = equipOf(ch);
  const look = lookOf(ch);
  const worn = wornSet(eq);
  // The board, then the doll, painted once and blitted from then on.
  M.paperdollField(ctx, r.x, r.y, r.w, r.h);
  M.blit(ctx, M.paperdollArt(r.w, r.h, look, worn, dollKey(look, worn)), r.x, r.y);

  // Hit rectangles only: nothing is drawn for them, per MM6.
  const place = slotPlacement(M.paperdollAnchors(r, look.buildIdx));
  for (const slot of HIT_ORDER) {
    const p = place[slot];
    if (!p) continue;
    const item = eq[slot] || null;
    const hit = ui.region(`doll:${slot}`, p.x, p.y, p.w, p.h,
      item ? itemLabel(item) : slotLabel(slot));
    if (hit.rightClick && item && screen.showPopup) screen.showPopup(item);
    else if (hit.click && screen.slotClick) screen.slotClick(ch, slot, item || null);
  }

  // Food and gold, in the HUD's order - food on the left, gold on the right.
  const gy = r.y + r.h + 6;
  A.icon(ctx, 'food', r.x + 6, gy, 14);
  F.drawText(ctx, String(screen.party.food | 0), r.x + 24, gy + 2, { face: 'small', color: WHITE });
  A.icon(ctx, 'gold', r.x + 86, gy, 14);
  F.drawText(ctx, String(screen.party.gold | 0), r.x + 104, gy + 2, { face: 'small', color: CANARY });
  F.drawText(ctx, ch.name || '', r.x + r.w / 2, gy + 18, { face: 'small', align: 'center', color: WHITE });
}

/** Build by class line: a Knight is not shaped like a Sorcerer. */
const LINE_LOOK = {
  knight: { build: 4, tunic: [132, 66, 52] },
  paladin: { build: 3, tunic: [78, 92, 132] },
  archer: { build: 1, tunic: [78, 112, 66] },
  cleric: { build: 2, tunic: [156, 142, 104] },
  sorcerer: { build: 0, tunic: [78, 72, 128] },
  druid: { build: 2, tunic: [104, 116, 62] },
};

/**
 * The character's own body: build off the class line, skin, hair and clothes
 * off the portrait seed, so the doll is this person rather than a mannequin and
 * four party members never match.
 */
function lookOf(ch) {
  const seed = (((ch && ch.portraitSeed) | 0) >>> 0) + (ch && ch.name ? ch.name.length : 0);
  const klass = CLASSES[(ch && ch.class) || ''] || null;
  const L = LINE_LOOK[klass ? klass.line : 'knight'] || LINE_LOOK.knight;
  const female = ch && ch.sex === 'f';
  const skins = [[222, 180, 144], [206, 160, 122], [186, 136, 98], [156, 114, 78],
    [122, 84, 56], [92, 62, 42]];
  const hairs = [[54, 34, 20], [104, 72, 34], [30, 24, 22], [148, 128, 92],
    [96, 42, 26], [176, 172, 164]];
  return {
    // A woman is drawn a build lighter; the male lines keep their own.
    buildIdx: Math.max(0, L.build - (female ? 1 : 0)),
    skin: skins[seed % skins.length],
    hair: hairs[(seed * 3) % hairs.length],
    tunic: L.tunic,
    trews: [82, 70, 50],
    boots: [74, 52, 32],
    beard: !female && (seed % 3) === 0,
    longHair: female || (seed % 5) === 0,
  };
}

// --- the screen -------------------------------------------------------------

/** Engine geometry: 14 x 9 cells of 32 px with the top-left at (14, 17). */
const GRID_X = 14, GRID_Y = 17;

export class InventoryScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'inventory';
    this.popup = null;
    this.sheet = (opts && opts.sheet) || null;
  }

  onOpen() { this.sound('page_turn'); }
  onCharChanged() { this.popup = null; }

  handleKey(code) {
    if (code === 'KeyI' || code === 'Escape') {
      if (this.popup) { this.popup = null; return true; }
      this.close(); return true;
    }
    return false;
  }

  showPopup(item) { this.popup = { item, x: this.ui.mouse.x, y: this.ui.mouse.y }; }

  /**
   * The character's bag, in party.js's canonical grid form. A bag that arrived
   * in a legacy shape (a plain array, or a grid with mangled cells) is rebuilt
   * through makeInventory/invAdd, never clobbered to [].
   */
  invOf(ch) {
    if (!ch) return null;
    let inv = ch.inventory;
    if (!inv || !Array.isArray(inv.cells) || !Array.isArray(inv.items)) {
      const items = Array.isArray(inv) ? inv : (inv && Array.isArray(inv.items)) ? inv.items : [];
      inv = makeInventory();
      for (const it of items) invAdd(inv, it);
      ch.inventory = inv;
    }
    return inv;
  }

  /** True when the gw x gh rectangle at (cx, cy) is inside the grid and empty. */
  fitsAt(inv, item, cx, cy) {
    const w = itemW(item), h = itemH(item);
    if (cx < 0 || cy < 0 || cx + w > inv.w || cy + h > inv.h) return false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (inv.cells[(cy + y) * inv.w + (cx + x)] !== 0) return false;
      }
    }
    return true;
  }

  // --- interaction ---------------------------------------------------------

  /** Drink / eat / read a consumable through the real rules. */
  useConsumable(ch, item) {
    const inv = this.invOf(ch);
    const r = useItem(ch, item, this.party);
    this.status = r.reason || '';
    if (r.consumed) invRemove(inv, item.uid);
    if (r.ok) this.sound(item.type === 'potion' ? 'potion_drink' : item.type === 'food' ? 'eat' : 'item_pickup');
    else this.sound('error');
  }

  slotClick(ch, slot, item) {
    const carried = this.ui.cursorItem;
    if (carried) {
      if (!slotFor(carried, slot)) { this.status = 'That does not go there.'; return; }
      // Route through party.equip so two-handers, shields and swaps follow the
      // real rules and every derived stat is recomputed. equip() pulls the item
      // out of the pack, so the carried item is parked there first.
      const inv = this.invOf(ch);
      if (!invAdd(inv, carried)) { this.status = 'No room in the pack to make the swap.'; return; }
      const r = equip(ch, carried, slot);
      if (!r.ok) {
        invRemove(inv, carried.uid);
        this.status = r.reason || 'It will not go there.';
        return;
      }
      this.ui.cursorItem = null;
      this.status = '';
      this.sound('item_pickup');
    } else if (item) {
      // Taking a piece off goes to the hand, not the pack - but the stats
      // must not keep counting it.
      delete ch.equipment[slot];
      recompute(ch);
      this.ui.cursorItem = item;
      this.sound('item_pickup');
    }
  }

  // --- drawing --------------------------------------------------------------

  draw(ctx) {
    this.drawPage(ctx, 'sheet');
    const ch = this.character;
    if (ch) {
      this.drawGrid(ctx, ch);
      drawPaperdoll(ctx, this, ch);
    }

    // No help line here: the 14 x 9 grid runs from y=17 to y=305 and the tab
    // row starts at 308, so there is no strip of page left to print one on.
    // MM6 puts the hovered item's name on the status bar at (0, 352) instead.

    const clicked = drawTabs(ctx, this.ui, this.id, TAB_X, TAB_Y, TAB_W, TAB_H,
      ['Stats', 'Skills', 'Inventory', 'Awards'], 2);
    if (clicked >= 0 && clicked !== 2) {
      if (this.sheet) this.sheet.tab = clicked === 3 ? 3 : clicked;
      this.sound('page_turn');
      this.close();
    }
    this.drawExit(ctx);
    this.pollPartyBar();

    if (this.popup) this.drawPopup(ctx);
    this.drawCursorItem(ctx);
    if (this.ui.mouse.clicked && !this.ui.consumed) this.popup = null;
  }

  drawGrid(ctx, ch) {
    const inv = this.invOf(ch);
    const gx = px(GRID_X), gy = py(GRID_Y);
    const w = inv.w * CELL, h = inv.h * CELL;
    // `fr_inven` is a painted hide panel with the cells pressed into it: grain,
    // mottling and a worn rim, and every cell rule a dark crease with a
    // burnished lip below it - never a black wireframe on a flat field.
    M.hideGrid(ctx, gx, gy, inv.w, inv.h, CELL, 71);

    const carried = this.ui.cursorItem;
    let hoverCell = null;
    if (this.ui.mouse.x >= gx && this.ui.mouse.x < gx + w
        && this.ui.mouse.y >= gy && this.ui.mouse.y < gy + h) {
      hoverCell = {
        x: Math.floor((this.ui.mouse.x - gx) / CELL),
        y: Math.floor((this.ui.mouse.y - gy) / CELL),
      };
    }

    for (const it of inv.items.slice()) {
      if (!Number.isInteger(it.x) || it.x < 0) continue;
      const ix = gx + it.x * CELL, iy = gy + it.y * CELL;
      const iw = itemW(it) * CELL, ih = itemH(it) * CELL;
      const hit = this.ui.region(`${this.id}:it:${it.uid}:${it.x},${it.y}`,
        ix, iy, iw, ih, itemLabel(it));
      if (hit.hover) M.stipple(ctx, ix + 1, iy + 1, iw - 1, ih - 1, [255, 240, 190], 0.22);
      const ic = itemIcon(it);
      ctx.drawImage(ic, (ix + (iw - ic.width) / 2) | 0, (iy + (ih - ic.height) / 2) | 0);
      // State markers ride the item art, not the cell: palette-snapped corner
      // flashes and a stippled outline, never a translucent RGBA slab (which
      // has no index in an 8-bit frame).
      if (it.broken) itemMark(ctx, ix, iy, iw, ih, [255, 0, 0]);
      else if (it.identified === false) itemMark(ctx, ix, iy, iw, ih, [0, 225, 0]);
      else if (it.prefix || it.suffix || it.bonus) itemMark(ctx, ix, iy, iw, ih, [0, 175, 255]);
      if (hit.rightClick) this.showPopup(it);
      else if (hit.click && !carried) {
        // A consumable is used where it lies; anything else goes to the hand.
        if (it.type === 'potion' || it.type === 'food') this.useConsumable(ch, it);
        else {
          invRemove(inv, it.uid);
          this.ui.cursorItem = it;
          this.sound('item_pickup');
        }
      }
    }

    if (carried && hoverCell) {
      const ok = this.fitsAt(inv, carried, hoverCell.x, hoverCell.y);
      const fw = itemW(carried) * CELL, fh = itemH(carried) * CELL;
      // Placement preview as a Bayer stipple in a solid palette ink - a
      // translucent slab has no index in an 8-bit frame.
      M.stipple(ctx, gx + hoverCell.x * CELL + 1, gy + hoverCell.y * CELL + 1, fw - 1, fh - 1,
        ok ? [225, 205, 35] : [255, 35, 16], 0.4);
      const hit = this.ui.region(`${this.id}:drop`, gx, gy, w, h, ok ? 'Put it here' : 'It will not fit there');
      if (hit.click && ok) {
        invAdd(inv, carried, hoverCell.x, hoverCell.y);
        this.ui.cursorItem = null;
        this.sound('item_pickup');
      }
    }
  }

  drawCursorItem(ctx) {
    const it = this.ui.cursorItem;
    if (!it) return;
    // A lifted finger parks the pointer off-screen; remember the last real
    // position so the carried item never turns invisible mid-move on touch.
    if (this.ui.mouse.x > -100) this._carryPos = { x: this.ui.mouse.x, y: this.ui.mouse.y };
    const p = (this.ui.mouse.x > -100 ? this.ui.mouse : this._carryPos) || this.ui.mouse;
    const ic = itemIcon(it);
    ctx.drawImage(ic, (p.x - ic.width / 2) | 0, (p.y - ic.height / 2) | 0);
  }

  /**
   * MM6's give: while an item rides the cursor, clicking a party portrait
   * hands the item to that character instead of switching to them.
   */
  giveCursorTo(i) {
    const it = this.ui.cursorItem;
    const ch = this.members[i];
    if (!it || !ch) return false;
    const inv = this.invOf(ch);
    if (!invAdd(inv, it)) {
      this.status = `${ch.name}'s pack is full.`;
      this.sound('error');
      return true;   // consumed the click; the item stays in hand
    }
    this.ui.cursorItem = null;
    this.status = `${itemName(it) || 'The item'} goes to ${ch.name}.`;
    this.sound('item_pickup');
    return true;
  }

  drawPopup(ctx) {
    const it = this.popup.item;
    const w = 186;
    // items.js owns the honest description - name, dice, mods, value - so the
    // popup is a straight rendering of it, first line as the title.
    const descLines = String(itemDescription(it) || '').split('\n');
    const lines = [];
    descLines.forEach((s, i) => {
      if (!s) return;
      if (i === 0) lines.push(['title', s]);
      else if (/^BROKEN|^Unidentified|cannot tell/i.test(s)) lines.push(['bad', s]);
      else if (/^Value:/.test(s)) lines.push(['dim', s]);
      else lines.push(s.length > 34 ? ['wrap', s] : ['body', s]);
    });
    const slot = slotFor(it, null);
    if (slot) lines.push(['dim', `Worn: ${slotLabel(slot)}`]);
    if (it.type === 'potion' || it.type === 'food') lines.push(['good', 'Click it in the pack to use it.']);

    let h = 12;
    for (const [k, s] of lines) {
      h += k === 'title' ? 18 : k === 'wrap'
        ? 10 * Math.max(1, Math.ceil(F.measure(s, 'small').w / (w - 16))) : 11;
    }
    const x = Math.max(4, Math.min(this.popup.x + 8, PANEL.x + PANEL.w - w - 4));
    const y = Math.max(4, Math.min(this.popup.y + 8, PANEL.y + PANEL.h - h - 4));

    A.parchment(ctx, x, y, w, h, { tone: 'page' });
    A.frame(ctx, x, y, w, h, {});
    let ty = y + 6;
    for (const [k, s] of lines) {
      if (k === 'title') { F.drawText(ctx, s, x + 8, ty, { face: 'title', color: '#2e2e2e' }); ty += 18; }
      else if (k === 'wrap') { ty = drawWrapped(ctx, s, x + 8, ty, w - 16, { face: 'small', color: '#4b4b4b' }); }
      else {
        F.drawText(ctx, s, x + 8, ty, {
          face: 'small',
          color: k === 'dim' ? '#6b6b6b' : k === 'good' ? '#1d6b1d' : k === 'bad' ? '#a01008' : '#4b4b4b',
        });
        ty += 11;
      }
    }
  }
}

function tint(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

/**
 * A state marker in the engine's own vocabulary: a 1-bit stippled outline
 * around the cell rim plus two corner flashes, in a solid palette ink.
 */
function itemMark(ctx, x, y, w, h, rgb) {
  M.stipple(ctx, x + 1, y + 1, w - 2, 2, rgb, 0.6);
  M.stipple(ctx, x + 1, y + h - 3, w - 2, 2, rgb, 0.6);
  M.stipple(ctx, x + 1, y + 3, 2, h - 6, rgb, 0.6);
  M.stipple(ctx, x + w - 3, y + 3, 2, h - 6, rgb, 0.6);
  M.rct(ctx, x + 1, y + 1, 4, 4, rgb);
  M.rct(ctx, x + w - 5, y + h - 5, 4, 4, rgb);
}
function capitalise(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

function slotLabel(slot) {
  switch (slot) {
    case 'mainhand': return 'Weapon hand';
    case 'offhand': return 'Off hand';
    case 'ring1': case 'ring2': return 'Ring';
    default: return capitalise(slot);
  }
}

function itemLabel(it) {
  const bits = [itemName(it) || 'Item'];
  const def = itemDef(it && it.def);
  if (def && def.dice) bits.push(`(${def.dice.n}d${def.dice.s}${def.dice.plus ? `+${def.dice.plus}` : ''})`);
  if (def && def.ac) bits.push(`(AC +${def.ac})`);
  if (it.broken) bits.push('- broken');
  return bits.join(' ');
}

export default InventoryScreen;
