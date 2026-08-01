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
// MM6 paints a body and then paints the equipped items straight onto it at
// their anatomical positions: helm on the head, armour over the torso, boots at
// the feet, the weapon in the hand. There is no slot chrome - no boxes, no
// outlines, no glyphs. Empty slots simply show the body. The drag-and-drop hit
// rectangles below are derived from the painted anatomy and are never drawn.

const WELL = { x: SIDE.x + 4, y: 6, w: 164, h: 282 };

function equipOf(ch) {
  if (!ch.equipment) ch.equipment = {};
  return ch.equipment;
}

/** Where each slot's art lands on the painted body, and how big it is. */
function slotPlacement(anchor) {
  const a = anchor;
  const hw = a.head.w, tw = a.torso.w;
  return {
    // The helm sits on the crown and leaves the face showing, as a paperdoll must.
    helm: { cx: a.head.cx, cy: a.head.cy - Math.round(a.head.h * 0.30), w: Math.round(hw * 1.18), h: Math.round(a.head.h * 0.68) },
    amulet: { cx: a.neck.cx, cy: a.neck.y + 8, w: 20, h: 22 },
    cloak: { cx: a.torso.cx, cy: a.torso.cy + 12, w: Math.round(tw * 2.0), h: Math.round(a.torso.h * 1.9) },
    armor: { cx: a.torso.cx, cy: a.torso.cy + 2, w: Math.round(tw * 1.16), h: Math.round(a.torso.h * 1.10) },
    belt: { cx: a.waist.cx, cy: a.waist.y + 1, w: Math.round(tw * 1.24), h: 12 },
    boots: { cx: a.feet.cx, cy: a.feet.y - 2, w: Math.round(a.feet.w * 1.15), h: 26 },
    gauntlets: { cx: a.torso.cx, cy: a.hands.left.y + 4, w: Math.round(tw * 2.1), h: 20 },
    mainhand: { cx: a.hands.right.x + 6, cy: a.hands.right.y + 26, w: 26, h: 74 },
    offhand: { cx: a.hands.left.x - 10, cy: a.hands.left.y + 12, w: 38, h: 46 },
    bow: { cx: a.torso.cx + Math.round(tw * 1.7), cy: a.torso.cy + 10, w: 40, h: 72 },
    ring1: { cx: a.hands.left.x - 1, cy: a.hands.left.y + 12, w: 13, h: 13 },
    ring2: { cx: a.hands.right.x + 1, cy: a.hands.right.y + 12, w: 13, h: 13 },
  };
}

/** Paint one worn item onto the body at its placement. */
function paintWorn(ctx, slot, item, p) {
  const kind = wornKind(slot, item);
  const c = M.itemArt(kind, Math.max(6, p.w), Math.max(8, p.h), {
    mat: item.material || wornMaterial(slot), accent: item.tint || null,
  });
  const x = Math.round(p.cx - c.width / 2), y = Math.round(p.cy - c.height / 2);
  // Painted contact shadow: two stippled rows under the piece, no soft edge.
  M.stipple(ctx, x + 2, y + 3, c.width, c.height, [12, 10, 8], 0.30);
  M.blit(ctx, c, x, y);
  if (item.broken) M.stipple(ctx, x, y, c.width, c.height, [200, 24, 12], 0.42);
  else if (item.identified === false) M.stipple(ctx, x, y, c.width, c.height, [0, 200, 40], 0.30);
}

function wornKind(slot, item) {
  const t = typeOf(item);
  const k = item.icon || t.icon;
  if (k === 'blade') return 'sword';
  if (slot === 'armor' && item.skill) return item.skill === 'chain' ? 'chain' : 'armor';
  return k;
}

function wornMaterial(slot) {
  switch (slot) {
    case 'boots': case 'belt': return 'leather';
    case 'cloak': return 'cloth';
    case 'amulet': case 'ring1': case 'ring2': return 'gold';
    default: return 'steel';
  }
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
  const cloth = clothOf(ch);
  const place = slotPlacement(M.paperdollAnchors(r));

  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  // The doll stands on the panel's own tooled hide, not in a black well.
  M.paper(ctx, r.x, r.y, r.w, r.h, 'hide', 43);
  // Anything worn behind the body goes down first: the cloak hangs behind the
  // shoulders and the bow is slung across the back.
  if (eq.cloak) paintWorn(ctx, 'cloak', eq.cloak, place.cloak);
  if (eq.bow) paintWorn(ctx, 'bow', eq.bow, place.bow);
  M.paperdollBody(ctx, { x: r.x, y: r.y, w: r.w, h: r.h }, cloth);
  for (const slot of ['armor', 'belt', 'boots', 'gauntlets', 'helm', 'amulet',
    'offhand', 'mainhand', 'ring1', 'ring2']) {
    if (eq[slot]) paintWorn(ctx, slot, eq[slot], place[slot]);
  }
  ctx.restore();

  // Hit rectangles only: nothing is drawn for them, per MM6.
  const carried = ui.cursorItem;
  for (const slot of SLOTS) {
    const p = place[slot];
    if (!p) continue;
    const x = Math.round(p.cx - p.w / 2), y = Math.round(p.cy - p.h / 2);
    const item = eq[slot] || null;
    const hit = ui.region(`doll:${slot}`, x, y, p.w, p.h, item ? itemLabel(item) : slotLabel(slot));
    // The only feedback is on the carried item's legal targets, and it is a
    // painted stipple rather than an outline.
    if (carried && slotFor(carried, slot)) M.stipple(ctx, x, y, p.w, p.h, [225, 205, 35], 0.22);
    else if (hit.hover && item) M.stipple(ctx, x, y, p.w, p.h, [255, 246, 220], 0.14);
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

/** Skin, hair and cloth for a character, so four party members do not match. */
function clothOf(ch) {
  const seed = ((ch && (ch.portraitSeed | 0)) || 1) + (ch && ch.name ? ch.name.length : 0);
  const skins = [[216, 174, 138], [196, 148, 108], [166, 118, 82], [124, 84, 56]];
  const hairs = [[54, 34, 20], [104, 72, 34], [30, 24, 22], [148, 128, 92], [96, 42, 26]];
  const tunics = [[92, 74, 52], [70, 82, 60], [88, 62, 60], [64, 70, 92], [96, 84, 56]];
  return {
    skin: skins[seed % skins.length],
    hair: hairs[(seed * 3) % hairs.length],
    tunic: tunics[(seed * 5) % tunics.length],
    trews: [58, 48, 34],
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
