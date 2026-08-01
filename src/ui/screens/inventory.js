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
// Item icons are procedural. `itemIcon()` composes a small painted pixel icon
// from the item's type plus its material/enchantment colour and caches it, so
// no art files are needed and a new item type costs a dozen lines.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import { rampCss } from '../../core/palette.js';
import {
  Screen, A, PANEL, SIDE, TAB_X, TAB_Y, TAB_W, TAB_H, px, py,
  WHITE, CANARY, HILITE, drawTabs, drawWrapped,
} from './screenbase.js';
import * as M from './mm6art.js';
import { CLASSES } from '../../game/stats.js';

// --- item model -------------------------------------------------------------

/** Body slots, in paperdoll order. */
export const SLOTS = [
  'helm', 'amulet', 'cloak', 'armor', 'gauntlets', 'belt', 'boots',
  'mainhand', 'offhand', 'bow', 'ring1', 'ring2',
];

/** Default grid footprint (in cells) and accepted slot per item type. */
const TYPES = {
  sword: { w: 1, h: 3, slot: 'mainhand', icon: 'blade' },
  dagger: { w: 1, h: 2, slot: 'mainhand', icon: 'blade' },
  axe: { w: 2, h: 3, slot: 'mainhand', icon: 'axe' },
  mace: { w: 1, h: 3, slot: 'mainhand', icon: 'mace' },
  spear: { w: 1, h: 4, slot: 'mainhand', icon: 'spear' },
  staff: { w: 1, h: 4, slot: 'mainhand', icon: 'staff' },
  club: { w: 1, h: 3, slot: 'mainhand', icon: 'mace' },
  bow: { w: 2, h: 3, slot: 'bow', icon: 'bow' },
  blaster: { w: 1, h: 3, slot: 'mainhand', icon: 'wand' },
  shield: { w: 2, h: 2, slot: 'offhand', icon: 'shield' },
  helm: { w: 2, h: 2, slot: 'helm', icon: 'helm' },
  armor: { w: 2, h: 3, slot: 'armor', icon: 'armor' },
  boots: { w: 2, h: 2, slot: 'boots', icon: 'boots' },
  gauntlets: { w: 2, h: 2, slot: 'gauntlets', icon: 'gauntlets' },
  belt: { w: 2, h: 1, slot: 'belt', icon: 'belt' },
  cloak: { w: 2, h: 3, slot: 'cloak', icon: 'cloak' },
  amulet: { w: 1, h: 1, slot: 'amulet', icon: 'amulet' },
  ring: { w: 1, h: 1, slot: 'ring1', icon: 'ring' },
  potion: { w: 1, h: 2, slot: null, icon: 'potion' },
  scroll: { w: 2, h: 1, slot: null, icon: 'scroll' },
  wand: { w: 1, h: 3, slot: 'mainhand', icon: 'wand' },
  book: { w: 2, h: 2, slot: null, icon: 'book' },
  gem: { w: 1, h: 1, slot: null, icon: 'gem' },
  gold: { w: 1, h: 1, slot: null, icon: 'gold' },
  reagent: { w: 1, h: 1, slot: null, icon: 'reagent' },
  misc: { w: 1, h: 1, slot: null, icon: 'reagent' },
};

function typeOf(item) { return TYPES[item && item.type] || TYPES.misc; }
export function itemW(item) { return (item && item.w) || typeOf(item).w; }
export function itemH(item) { return (item && item.h) || typeOf(item).h; }

/** Which body slot (if any) this item may be dropped on. */
export function slotFor(item, target) {
  const base = (item && item.slot) || typeOf(item).slot;
  if (!base) return null;
  if (!target) return base;
  if (base === target) return target;
  // Rings go on either hand; a one-hander may be held in the off hand.
  if (base === 'ring1' && (target === 'ring1' || target === 'ring2')) return target;
  if (base === 'mainhand' && target === 'offhand' && !item.twoHanded
      && (item.type === 'sword' || item.type === 'dagger' || item.type === 'mace')) return target;
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
  const t = typeOf(item);
  const kind = item.icon || t.icon;
  const w = itemW(item) * cell - 8;
  const h = itemH(item) * cell - 8;
  const key = `${kind}|${item.material || 'steel'}|${item.tint || ''}|${w}x${h}`;
  let c = ICON_CACHE.get(key);
  if (c) return c;
  c = M.itemArt(kind === 'blade' ? 'sword' : kind, Math.max(6, w), Math.max(8, h), {
    mat: item.material || 'steel', accent: item.tint || null,
  });
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

/** What the cached doll bitmap is keyed on: everything that changes its pixels. */
function dollKey(look, eq) {
  let k = `${look.buildIdx}|${look.skin}|${look.hair}|${look.tunic}|${look.trews}|`
    + `${look.boots}|${look.beard ? 1 : 0}|${look.longHair ? 1 : 0}`;
  for (const slot of SLOTS) {
    const it = eq[slot];
    k += it ? `|${slot}:${it.type || ''}:${it.icon || ''}:${it.material || ''}:${it.skill || ''}`
      + `:${it.tint || ''}:${it.armor | 0}:${it.name || ''}` : '';
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
  // The board, then the doll, painted once and blitted from then on.
  M.paperdollField(ctx, r.x, r.y, r.w, r.h);
  M.blit(ctx, M.paperdollArt(r.w, r.h, look, eq, dollKey(look, eq)), r.x, r.y);

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

  // Gold and food, where MM6 keeps them: the lower right panel.
  const gy = r.y + r.h + 6;
  A.icon(ctx, 'gold', r.x + 6, gy, 14);
  F.drawText(ctx, String(screen.party.gold | 0), r.x + 24, gy + 2, { face: 'small', color: CANARY });
  A.icon(ctx, 'food', r.x + 86, gy, 14);
  F.drawText(ctx, String(screen.party.food | 0), r.x + 104, gy + 2, { face: 'small', color: WHITE });
  F.drawText(ctx, ch.name || '', r.x + r.w / 2, gy + 18, { face: 'small', align: 'center', color: WHITE });
}

/** Build by class line: a Knight is not shaped like a Sorcerer. */
const LINE_LOOK = {
  knight: { build: 4, tunic: [96, 60, 52] },
  paladin: { build: 3, tunic: [66, 74, 96] },
  archer: { build: 1, tunic: [64, 84, 58] },
  cleric: { build: 2, tunic: [112, 100, 74] },
  sorcerer: { build: 0, tunic: [58, 56, 88] },
  druid: { build: 2, tunic: [78, 84, 56] },
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
    trews: [58, 48, 34],
    boots: [62, 44, 28],
    beard: !female && (seed % 3) === 0,
    longHair: female || (seed % 5) === 0,
  };
}

// --- the screen -------------------------------------------------------------

/** Engine geometry: 14 x 9 cells of 32 px with the top-left at (14, 17). */
const GRID_X = 14, GRID_Y = 17, COLS = 14, ROWS = 9;

export class InventoryScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'inventory';
    this.popup = null;
    this.sheet = (opts && opts.sheet) || null;
  }

  onOpen() { this.sound('page'); this.pack(); }
  onCharChanged() { this.popup = null; this.pack(); }

  handleKey(code) {
    if (code === 'KeyI' || code === 'Escape') {
      if (this.popup) { this.popup = null; return true; }
      this.close(); return true;
    }
    return false;
  }

  showPopup(item) { this.popup = { item, x: this.ui.mouse.x, y: this.ui.mouse.y }; }

  bagOf(ch) {
    if (!ch) return [];
    if (!Array.isArray(ch.inventory)) ch.inventory = [];
    return ch.inventory;
  }

  /** Give every loose item a grid position the first time we see this bag. */
  pack() {
    const ch = this.character;
    if (!ch) return;
    const bag = this.bagOf(ch);
    for (const it of bag) {
      if (Number.isInteger(it.x) && Number.isInteger(it.y)) continue;
      const spot = this.findSpot(bag, it, it);
      if (spot) { it.x = spot.x; it.y = spot.y; } else { it.x = 0; it.y = 0; }
    }
  }

  occupied(bag, skip) {
    const grid = new Array(COLS * ROWS).fill(null);
    for (const it of bag) {
      if (it === skip || !Number.isInteger(it.x)) continue;
      for (let y = 0; y < itemH(it); y++) {
        for (let x = 0; x < itemW(it); x++) {
          const gx = it.x + x, gy = it.y + y;
          if (gx < COLS && gy < ROWS) grid[gy * COLS + gx] = it;
        }
      }
    }
    return grid;
  }

  fits(bag, item, cx, cy, skip) {
    const w = itemW(item), h = itemH(item);
    if (cx < 0 || cy < 0 || cx + w > COLS || cy + h > ROWS) return false;
    const grid = this.occupied(bag, skip || item);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (grid[(cy + y) * COLS + cx + x]) return false;
    }
    return true;
  }

  findSpot(bag, item, skip) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (this.fits(bag, item, x, y, skip)) return { x, y };
    }
    return null;
  }

  // --- interaction ---------------------------------------------------------

  slotClick(ch, slot, item) {
    const eq = equipOf(ch);
    const carried = this.ui.cursorItem;
    if (carried) {
      if (!slotFor(carried, slot)) { this.status = 'That does not go there.'; return; }
      const bag = this.bagOf(ch);
      const i = bag.indexOf(carried);
      if (i >= 0) bag.splice(i, 1);
      eq[slot] = carried;
      this.ui.cursorItem = item || null;
      if (item) { item.x = null; item.y = null; }
      this.sound('equip');
    } else if (item) {
      eq[slot] = null;
      this.ui.cursorItem = item;
      this.sound('pickup');
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
      this.sound('page');
      this.close();
    }
    this.drawExit(ctx);
    this.pollPartyBar();

    if (this.popup) this.drawPopup(ctx);
    this.drawCursorItem(ctx);
    if (this.ui.mouse.clicked && !this.ui.consumed) this.popup = null;
  }

  drawGrid(ctx, ch) {
    const bag = this.bagOf(ch);
    const gx = px(GRID_X), gy = py(GRID_Y);
    const w = COLS * CELL, h = ROWS * CELL;
    // `fr_inven` is a painted hide panel with the cells pressed into it: grain,
    // mottling and a worn rim, and every cell rule a dark crease with a
    // burnished lip below it - never a black wireframe on a flat field.
    M.hideGrid(ctx, gx, gy, COLS, ROWS, CELL, 71);

    const carried = this.ui.cursorItem;
    let hoverCell = null;
    if (this.ui.mouse.x >= gx && this.ui.mouse.x < gx + w
        && this.ui.mouse.y >= gy && this.ui.mouse.y < gy + h) {
      hoverCell = {
        x: Math.floor((this.ui.mouse.x - gx) / CELL),
        y: Math.floor((this.ui.mouse.y - gy) / CELL),
      };
    }

    for (const it of bag) {
      if (!Number.isInteger(it.x)) continue;
      const ix = gx + it.x * CELL, iy = gy + it.y * CELL;
      const iw = itemW(it) * CELL, ih = itemH(it) * CELL;
      const hit = this.ui.region(`${this.id}:it:${it.uid || it.id || it.name}:${it.x},${it.y}`,
        ix, iy, iw, ih, itemLabel(it));
      if (hit.hover) M.stipple(ctx, ix + 1, iy + 1, iw - 1, ih - 1, [255, 240, 190], 0.22);
      const ic = itemIcon(it);
      ctx.drawImage(ic, (ix + (iw - ic.width) / 2) | 0, (iy + (ih - ic.height) / 2) | 0);
      if (it.broken) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(255,0,0,0.35)');
      else if (it.identified === false) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(0,225,0,0.28)');
      else if (it.enchant) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(120,120,255,0.20)');
      if (hit.rightClick) this.showPopup(it);
      else if (hit.click && !carried) {
        this.ui.cursorItem = it;
        it.x = null; it.y = null;
        this.sound('pickup');
      }
    }

    if (carried && hoverCell) {
      const ok = this.fits(bag, carried, hoverCell.x, hoverCell.y, carried);
      const fw = itemW(carried) * CELL, fh = itemH(carried) * CELL;
      ctx.fillStyle = ok ? 'rgba(96,96,96,0.5)' : 'rgba(160,32,16,0.5)';
      ctx.fillRect(gx + hoverCell.x * CELL + 1, gy + hoverCell.y * CELL + 1, fw - 1, fh - 1);
      const hit = this.ui.region(`${this.id}:drop`, gx, gy, w, h, ok ? 'Put it here' : 'It will not fit there');
      if (hit.click && ok) {
        carried.x = hoverCell.x; carried.y = hoverCell.y;
        if (bag.indexOf(carried) < 0) bag.push(carried);
        const eq = equipOf(ch);
        for (const s of SLOTS) if (eq[s] === carried) eq[s] = null;
        this.ui.cursorItem = null;
        this.sound('drop');
      }
    }
  }

  drawCursorItem(ctx) {
    const it = this.ui.cursorItem;
    if (!it) return;
    const ic = itemIcon(it);
    ctx.drawImage(ic, (this.ui.mouse.x - ic.width / 2) | 0, (this.ui.mouse.y - ic.height / 2) | 0);
  }

  drawPopup(ctx) {
    const it = this.popup.item;
    const w = 186;
    const lines = [['title', it.name || 'Unknown item']];
    const t = typeOf(it);
    lines.push(['dim', `${capitalise(it.type || 'item')}${it.material ? ', ' + it.material : ''}`]);
    if (it.damage) lines.push(['body', `Damage: ${it.damage}`]);
    if (it.armor) lines.push(['body', `Armour: +${it.armor}`]);
    if (it.attack) lines.push(['body', `Attack: +${it.attack}`]);
    if (it.enchant) lines.push(['good', String(it.enchant)]);
    if (it.charges !== undefined) lines.push(['body', `Charges: ${it.charges}`]);
    if (it.broken) lines.push(['bad', 'Broken - a smith must repair it.']);
    if (it.identified === false) lines.push(['bad', 'Unidentified.']);
    if (it.value) lines.push(['body', `Value: ${it.value} gold`]);
    if (t.slot) lines.push(['dim', `Worn: ${slotLabel(t.slot)}`]);
    if (it.desc) lines.push(['wrap', it.desc]);

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
  const bits = [it.name || 'Item'];
  if (it.damage) bits.push(`(${it.damage})`);
  if (it.armor) bits.push(`(AC +${it.armor})`);
  if (it.broken) bits.push('- broken');
  return bits.join(' ');
}

export default InventoryScreen;
