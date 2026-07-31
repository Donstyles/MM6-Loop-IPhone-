// ---------------------------------------------------------------------------
// Inventory and paperdoll.
//
// MM6 gives every character a 14 x 9 grid of 32-pixel cells and lets items
// occupy rectangles of them; you pick an item up onto the cursor and drop it
// wherever it fits, including onto a body slot to equip it. That pick-up-carry
// model is the whole interaction, so it is implemented here rather than faked
// with drag events: `ui.cursorItem` is the hand.
//
// Item icons are procedural. `itemIcon()` composes a small painted pixel icon
// from the item's type plus its material/enchantment colour and caches it, so
// no art files are needed and a new item type costs a dozen lines.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import { rampCss } from '../../core/palette.js';
import { layout } from '../../core/layout.js';
import {
  Screen, A, INK, INK_HEAD, INK_DIM, drawWrapped, portraitOf,
} from './screenbase.js';
import { CLASSES } from '../../game/stats.js';

// --- item model -------------------------------------------------------------

/** Body slots, in paperdoll order. */
export const SLOTS = [
  'helm', 'amulet', 'cloak', 'armor', 'gauntlets', 'belt', 'boots',
  'mainhand', 'offhand', 'bow', 'ring1', 'ring2',
];

/** Default grid footprint and accepted slot per item type. */
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

/** Material tint: [ramp, darkShade, midShade, liteShade]. */
const MATERIALS = {
  wood: ['wood', 3, 7, 11],
  leather: ['dirt', 3, 7, 10],
  bronze: ['fire', 4, 8, 12],
  iron: ['grey', 4, 8, 12],
  steel: ['stone', 5, 10, 14],
  silver: ['ice', 6, 11, 15],
  gold: ['gold', 5, 10, 14],
  mithril: ['sky', 5, 10, 14],
  obsidian: ['arcane', 1, 3, 6],
  bone: ['sand', 8, 12, 15],
  crystal: ['ice', 7, 12, 15],
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
  // Rings go in either hand; one-handers may be held in the off hand.
  if (base === 'ring1' && (target === 'ring1' || target === 'ring2')) return target;
  if (base === 'mainhand' && target === 'offhand' && !item.twoHanded
      && (item.type === 'sword' || item.type === 'dagger' || item.type === 'mace')) return target;
  return null;
}

function tones(item) {
  const m = MATERIALS[item && item.material] || MATERIALS.steel;
  return {
    dark: rampCss(m[0], m[1]), mid: rampCss(m[0], m[2]), lite: rampCss(m[0], m[3]),
    ramp: m[0],
  };
}

// --- procedural icons -------------------------------------------------------

const ICON_CACHE = new Map();

function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); }

/**
 * A recognisable pixel icon for an item, painted from its type and material.
 * Cached by type/material/size, so the grid costs one drawImage per item.
 */
export function itemIcon(item, cell = 30) {
  const t = typeOf(item);
  const w = itemW(item) * cell - 6;
  const h = itemH(item) * cell - 6;
  const key = `${item.icon || t.icon}|${item.material || 'steel'}|${item.tint || ''}|${w}x${h}`;
  let c = ICON_CACHE.get(key);
  if (c) return c;

  c = document.createElement('canvas');
  c.width = Math.max(4, w); c.height = Math.max(4, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  paintIcon(g, item.icon || t.icon, c.width, c.height, tones(item), item);
  ICON_CACHE.set(key, c);
  return c;
}

function paintIcon(g, kind, w, h, T, item) {
  const cx = (w / 2) | 0;
  const grip = rampCss('wood', 4);
  const gripLite = rampCss('wood', 8);
  const accent = item.tint || rampCss('blood', 9);

  switch (kind) {
    case 'blade': {
      const bw = Math.max(3, (w * 0.34) | 0);
      const tip = 2, guardY = h - Math.max(8, (h * 0.26) | 0);
      // Blade: a light edge, a mid body and a dark spine.
      for (let y = tip; y < guardY; y++) {
        const k = y < tip + 3 ? Math.max(1, ((bw * (y - tip + 1)) / 4) | 0) : bw;
        px(g, cx - (k >> 1), y, k, 1, T.mid);
        px(g, cx - (k >> 1), y, 1, 1, T.lite);
        px(g, cx + (k >> 1) - 1, y, 1, 1, T.dark);
      }
      px(g, cx - (bw >> 1) - 3, guardY, bw + 6, 2, T.dark);       // crossguard
      px(g, cx - (bw >> 1) - 3, guardY, bw + 6, 1, T.lite);
      px(g, cx - 1, guardY + 2, 3, h - guardY - 4, grip);          // grip
      px(g, cx - 1, guardY + 2, 1, h - guardY - 4, gripLite);
      px(g, cx - 2, h - 2, 5, 2, T.mid);                           // pommel
      break;
    }
    case 'axe': {
      px(g, cx - 1, 2, 3, h - 4, grip);
      px(g, cx - 1, 2, 1, h - 4, gripLite);
      const ay = 3, ah = Math.max(8, (h * 0.42) | 0);
      for (let y = 0; y < ah; y++) {
        const bulge = Math.round(Math.sin((y / ah) * Math.PI) * (w * 0.36));
        px(g, cx + 1, ay + y, bulge, 1, T.mid);
        px(g, cx + 1 + bulge - 1, ay + y, 1, 1, T.lite);
        px(g, cx - 1 - Math.round(bulge * 0.4), ay + y, Math.round(bulge * 0.4), 1, T.dark);
      }
      break;
    }
    case 'mace': {
      px(g, cx - 1, (h * 0.35) | 0, 3, h - ((h * 0.35) | 0) - 2, grip);
      const r = Math.max(4, (w * 0.34) | 0);
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        px(g, cx - k, ((h * 0.3) | 0) + y, k * 2, 1, T.mid);
      }
      px(g, cx - r + 1, ((h * 0.3) | 0) - r + 2, 2, 2, T.lite);
      for (const a of [0, 1, 2, 3]) {                              // flanges
        const ax = a % 2 ? cx - r - 2 : cx + r;
        px(g, ax, ((h * 0.3) | 0) - 4 + (a > 1 ? 6 : 0), 2, 3, T.dark);
      }
      break;
    }
    case 'spear': {
      px(g, cx - 1, 6, 2, h - 8, grip);
      px(g, cx - 2, 0, 4, 8, T.mid);
      px(g, cx - 1, 0, 1, 8, T.lite);
      px(g, cx - 3, 7, 6, 2, T.dark);
      px(g, cx - 2, h - 3, 4, 3, T.dark);
      break;
    }
    case 'staff': {
      px(g, cx - 2, 4, 4, h - 6, grip);
      px(g, cx - 2, 4, 1, h - 6, gripLite);
      px(g, cx - 3, 0, 6, 5, T.mid);
      px(g, cx - 1, 1, 2, 2, accent);
      break;
    }
    case 'bow': {
      // A recurve arc plus its string.
      const r = Math.min(w - 3, h / 2 - 1);
      for (let y = 2; y < h - 2; y++) {
        const t = (y - h / 2) / (h / 2 - 2);
        const x = 2 + Math.round((1 - t * t) * (w - 7));
        px(g, x, y, 3, 1, T.mid);
        px(g, x, y, 1, 1, T.lite);
      }
      for (let y = 2; y < h - 2; y++) px(g, 2, y, 1, 1, rampCss('sand', 12));
      px(g, 2, 2, 3, 2, T.dark); px(g, 2, h - 4, 3, 2, T.dark);
      break;
    }
    case 'shield': {
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        const inset = t < 0.62 ? 1 : Math.round((t - 0.62) / 0.38 * (w / 2 - 2));
        px(g, 1 + inset, y, w - 2 - inset * 2, 1, T.mid);
        px(g, 1 + inset, y, 1, 1, T.lite);
        px(g, w - 2 - inset, y, 1, 1, T.dark);
      }
      px(g, 2, 1, w - 4, 1, T.lite);
      px(g, cx - 2, (h * 0.32) | 0, 4, 4, accent);                 // boss
      break;
    }
    case 'helm': {
      const top = (h * 0.18) | 0;
      for (let y = top; y < h - 3; y++) {
        const t = (y - top) / (h - 3 - top);
        const k = Math.round((w / 2 - 1) * Math.sqrt(Math.max(0.15, 1 - (1 - t) * (1 - t) * 0.9)));
        px(g, cx - k, y, k * 2, 1, T.mid);
        px(g, cx - k, y, 1, 1, T.lite);
        px(g, cx + k - 1, y, 1, 1, T.dark);
      }
      px(g, 2, (h * 0.62) | 0, w - 4, 2, T.dark);                  // brow band
      px(g, cx - 1, top - 2, 2, 3, accent);                        // crest
      px(g, cx - 4, (h * 0.75) | 0, 8, 2, rampCss('grey', 1));     // eye slit
      break;
    }
    case 'armor': {
      const sh = (h * 0.16) | 0;
      px(g, 2, sh, w - 4, h - sh - 2, T.mid);
      px(g, 2, sh, 1, h - sh - 2, T.lite);
      px(g, w - 3, sh, 1, h - sh - 2, T.dark);
      px(g, 1, sh, 4, 4, T.lite); px(g, w - 5, sh, 4, 4, T.lite);  // pauldrons
      px(g, cx - 3, sh + 3, 6, 3, T.dark);                         // neck
      for (let y = sh + 8; y < h - 4; y += 5) px(g, 3, y, w - 6, 1, T.dark);
      px(g, cx - 1, sh + 6, 2, h - sh - 10, T.lite);
      break;
    }
    case 'boots': {
      for (const side of [0, 1]) {
        const bx = side ? cx + 1 : 2;
        const bw = (w / 2) - 3;
        px(g, bx, 2, bw, h - 6, T.mid);
        px(g, bx, 2, 1, h - 6, T.lite);
        px(g, bx, h - 4, bw + 2, 3, T.dark);                       // sole/toe
      }
      break;
    }
    case 'gauntlets': {
      for (const side of [0, 1]) {
        const bx = side ? cx + 1 : 2;
        const bw = (w / 2) - 3;
        px(g, bx, 4, bw, h - 7, T.mid);
        px(g, bx, 4, 1, h - 7, T.lite);
        px(g, bx, 2, bw, 3, T.dark);                               // cuff
        for (let f = 0; f < 3; f++) px(g, bx + 1 + f * 2, h - 5, 1, 3, T.dark);
      }
      break;
    }
    case 'belt': {
      const by = (h / 2 - 2) | 0;
      px(g, 1, by, w - 2, 5, rampCss('dirt', 5));
      px(g, 1, by, w - 2, 1, rampCss('dirt', 9));
      px(g, cx - 3, by - 2, 7, 9, T.lite);
      px(g, cx - 1, by, 3, 5, rampCss('dirt', 3));
      break;
    }
    case 'cloak': {
      for (let y = 2; y < h - 1; y++) {
        const t = y / h;
        const k = Math.round((w / 2 - 1) * (0.42 + t * 0.58));
        px(g, cx - k, y, k * 2, 1, T.mid);
        px(g, cx - k, y, 1, 1, T.lite);
        px(g, cx + k - 1, y, 1, 1, T.dark);
        if (y % 4 === 0) px(g, cx - 2, y, 1, 1, T.dark);           // folds
      }
      px(g, cx - 4, 1, 9, 2, T.lite);                              // collar
      break;
    }
    case 'amulet': {
      const ny = 3;
      for (let i = -5; i <= 5; i++) {
        px(g, cx + i, ny + Math.round(Math.abs(i) * 0.6), 1, 1, rampCss('gold', 10));
      }
      const r = Math.max(3, (Math.min(w, h) * 0.26) | 0);
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        px(g, cx - k, h - r - 3 + y, k * 2, 1, accent);
      }
      px(g, cx - 1, h - r - 5, 1, 1, '#ffffff');
      break;
    }
    case 'ring': {
      const r = Math.max(3, (Math.min(w, h) / 2 - 2) | 0);
      const ry = (h / 2 + 1) | 0;
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        px(g, cx - k, ry + y, 1, 1, rampCss('gold', 10));
        px(g, cx + k - 1, ry + y, 1, 1, rampCss('gold', 6));
      }
      px(g, cx - r, ry - r, r * 2, 1, rampCss('gold', 12));
      px(g, cx - 2, ry - r - 2, 4, 4, accent);
      px(g, cx - 1, ry - r - 1, 1, 1, '#ffffff');
      break;
    }
    case 'potion': {
      const liquid = item.tint || rampCss('blood', 10);
      const bw = Math.max(6, (w * 0.7) | 0);
      px(g, cx - 2, 1, 4, 4, rampCss('ice', 9));                   // neck
      px(g, cx - 3, 4, 6, 2, rampCss('ice', 12));                  // lip
      for (let y = 6; y < h - 1; y++) {
        const t = (y - 6) / (h - 7);
        const k = Math.round((bw / 2) * Math.min(1, 0.45 + t * 1.4));
        px(g, cx - k, y, k * 2, 1, y > 8 ? liquid : rampCss('ice', 11));
        px(g, cx - k, y, 1, 1, rampCss('ice', 13));
      }
      px(g, cx + 1, h - 5, 1, 2, '#ffffff');
      break;
    }
    case 'scroll': {
      px(g, 3, 2, w - 6, h - 4, rampCss('sand', 13));
      px(g, 3, 2, w - 6, 1, rampCss('sand', 15));
      px(g, 3, h - 3, w - 6, 1, rampCss('sand', 9));
      px(g, 1, 1, 3, h - 2, rampCss('sand', 10));                  // rolled ends
      px(g, w - 4, 1, 3, h - 2, rampCss('sand', 10));
      for (let y = 5; y < h - 5; y += 3) px(g, 6, y, w - 12, 1, rampCss('dirt', 4));
      break;
    }
    case 'wand': {
      px(g, cx - 1, 5, 3, h - 7, rampCss('wood', 6));
      px(g, cx - 1, 5, 1, h - 7, rampCss('wood', 10));
      px(g, cx - 2, 1, 5, 5, accent);
      px(g, cx - 1, 2, 2, 2, '#ffffff');
      px(g, cx - 2, h - 3, 5, 2, rampCss('gold', 9));
      break;
    }
    case 'book': {
      px(g, 2, 2, w - 4, h - 4, rampCss('blood', 5));
      px(g, 2, 2, w - 4, 1, rampCss('blood', 8));
      px(g, 2, 2, 3, h - 4, rampCss('blood', 3));                  // spine
      px(g, 6, 4, w - 9, h - 8, rampCss('sand', 14));              // pages
      px(g, 6, 4, w - 9, 1, rampCss('sand', 15));
      px(g, (w / 2) | 0, 6, 1, h - 12, rampCss('sand', 10));
      px(g, w - 8, (h / 2 - 2) | 0, 3, 4, rampCss('gold', 11));    // clasp
      break;
    }
    case 'gem': {
      const r = Math.min(w, h) / 2 - 1;
      for (let y = 0; y < h - 2; y++) {
        const t = y / (h - 3);
        const k = Math.round(r * (t < 0.34 ? 0.4 + t * 1.8 : 1 - (t - 0.34) * 1.4));
        px(g, cx - k, y + 1, Math.max(1, k * 2), 1, accent);
      }
      px(g, cx - 1, 2, 2, 2, '#ffffff');
      px(g, cx - 3, 4, 1, 4, '#ffffff');
      break;
    }
    case 'gold': {
      for (let i = 0; i < 5; i++) {
        const gx = 1 + ((i * 7) % Math.max(1, w - 8));
        const gy = h - 4 - ((i % 3) * 3);
        px(g, gx, gy, 7, 3, rampCss('gold', 10));
        px(g, gx, gy, 7, 1, rampCss('gold', 14));
        px(g, gx, gy + 2, 7, 1, rampCss('gold', 6));
      }
      break;
    }
    default: { // reagent / misc: a tied pouch
      px(g, 2, 4, w - 4, h - 5, rampCss('dirt', 6));
      px(g, 2, 4, w - 4, 1, rampCss('dirt', 9));
      px(g, cx - 3, 1, 6, 4, rampCss('foliage', 8));
      px(g, cx - 1, 0, 2, 3, rampCss('foliage', 11));
      px(g, 4, h - 4, w - 8, 1, rampCss('dirt', 3));
      break;
    }
  }
}

// --- paperdoll layout -------------------------------------------------------
// Fractions of the doll rect, so the panel scales with the frame.
const DOLL = [
  ['helm', 0.50, 0.02, 30, 26, 'slot_helm'],
  ['cloak', 0.13, 0.02, 30, 34, 'slot_cloak'],
  ['amulet', 0.87, 0.03, 26, 26, 'slot_amulet'],
  ['gauntlets', 0.13, 0.20, 30, 30, 'slot_gauntlets'],
  ['bow', 0.87, 0.18, 30, 44, 'slot_bow'],
  ['armor', 0.50, 0.16, 38, 50, 'slot_armor'],
  ['mainhand', 0.13, 0.40, 30, 52, 'slot_weapon'],
  ['offlhand_pad', 0, 0, 0, 0, null],
  ['offhand', 0.87, 0.42, 30, 52, 'slot_shield'],
  ['belt', 0.50, 0.50, 38, 18, 'slot_belt'],
  ['boots', 0.50, 0.62, 34, 28, 'slot_boots'],
  ['ring1', 0.13, 0.74, 26, 26, 'slot_ring'],
  ['ring2', 0.87, 0.74, 26, 26, 'slot_ring'],
].filter((s) => s[5]);

export class InventoryScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'inventory';
    this.cols = 14;
    this.rows = 9;
    this.cell = 30;
    this.popup = null;
    this.packed = -1;
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

  bagOf(ch) {
    if (!ch) return [];
    if (!Array.isArray(ch.inventory)) ch.inventory = [];
    return ch.inventory;
  }

  equipOf(ch) {
    if (!ch) return {};
    if (!ch.equipment) ch.equipment = {};
    return ch.equipment;
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
    const grid = new Array(this.cols * this.rows).fill(null);
    for (const it of bag) {
      if (it === skip || !Number.isInteger(it.x)) continue;
      for (let y = 0; y < itemH(it); y++) {
        for (let x = 0; x < itemW(it); x++) {
          const gx = it.x + x, gy = it.y + y;
          if (gx < this.cols && gy < this.rows) grid[gy * this.cols + gx] = it;
        }
      }
    }
    return grid;
  }

  fits(bag, item, cx, cy, skip) {
    const w = itemW(item), h = itemH(item);
    if (cx < 0 || cy < 0 || cx + w > this.cols || cy + h > this.rows) return false;
    const grid = this.occupied(bag, skip || item);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (grid[(cy + y) * this.cols + cx + x]) return false;
    }
    return true;
  }

  findSpot(bag, item, skip) {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.fits(bag, item, x, y, skip)) return { x, y };
      }
    }
    return null;
  }

  // --- drawing --------------------------------------------------------------

  draw(ctx) {
    const p = this.drawFrame(ctx, 'parchment');
    const ch = this.character;
    const gridW = this.cols * this.cell;
    const gx = p.x + p.w - gridW - 8;
    const gy = p.y + 26;
    const doll = { x: p.x + 8, y: p.y + 26, w: gx - p.x - 20, h: p.h - 60 };

    F.drawText(ctx, ch ? `${ch.name}'s Inventory` : 'Inventory', p.x + 10, p.y + 8,
      { face: 'title', color: INK_HEAD });

    if (ch) {
      this.drawDoll(ctx, doll, ch);
      this.drawGrid(ctx, gx, gy, ch);
    }

    // Gold / food readout, bottom left under the doll.
    const py = p.y + p.h - 46;
    A.inset(ctx, doll.x, py, doll.w, 18);
    A.icon(ctx, 'gold', doll.x + 2, py + 2, 14);
    F.drawText(ctx, String(this.party.gold | 0), doll.x + 19, py + 5, { face: 'small', color: F.TEXT_GOLD });
    A.icon(ctx, 'food', doll.x + doll.w / 2, py + 2, 14);
    F.drawText(ctx, String(this.party.food | 0), doll.x + doll.w / 2 + 17, py + 5,
      { face: 'small', color: F.TEXT_NORMAL });

    this.drawStatusStrip(ctx, p, true);
    this.drawExit(ctx, p);
    this.drawPartyBar(ctx);

    if (this.popup) this.drawPopup(ctx);
    this.drawCursorItem(ctx);

    // A click that hit nothing at all drops the popup.
    if (this.ui.mouse.clicked && !this.ui.consumed) this.popup = null;
  }

  bodySilhouette(ctx, r) {
    // A flat painted body, drawn dark so the slot wells read on top of it.
    const cx = (r.x + r.w / 2) | 0;
    const top = r.y + 6;
    const sk = rampCss('flesh', 3);
    const skD = rampCss('flesh', 1);
    const cloth = rampCss('dirt', 3);
    const headR = 13;
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (let y = -headR; y <= headR; y++) {
      const k = Math.round(Math.sqrt(Math.max(0, headR * headR - y * y)) * 0.86);
      ctx.fillStyle = y < -4 ? skD : sk;
      ctx.fillRect(cx - k, top + headR + y, k * 2, 1);
    }
    ctx.fillStyle = cloth;
    ctx.fillRect(cx - 6, top + headR * 2 - 2, 12, 6);                 // neck
    const ty = top + headR * 2 + 3, th = Math.round(r.h * 0.34);
    for (let y = 0; y < th; y++) {
      const t = y / th;
      const k = Math.round(22 - t * 6);
      ctx.fillStyle = cloth;
      ctx.fillRect(cx - k, ty + y, k * 2, 1);
    }
    ctx.fillStyle = skD;
    ctx.fillRect(cx - 30, ty + 4, 8, Math.round(th * 0.8));           // arms
    ctx.fillRect(cx + 22, ty + 4, 8, Math.round(th * 0.8));
    const ly = ty + th, lh = Math.round(r.h * 0.30);
    ctx.fillStyle = cloth;
    ctx.fillRect(cx - 17, ly, 14, lh);                                // legs
    ctx.fillRect(cx + 3, ly, 14, lh);
    ctx.fillStyle = skD;
    ctx.fillRect(cx - 18, ly + lh, 16, 5);                            // feet
    ctx.fillRect(cx + 2, ly + lh, 16, 5);
    ctx.restore();
  }

  drawDoll(ctx, r, ch) {
    A.inset(ctx, r.x, r.y, r.w, r.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.clip();
    ctx.fillStyle = rampCss('stone', 2);
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    this.bodySilhouette(ctx, r);

    const eq = this.equipOf(ch);
    for (const [slot, fx, fy, sw, sh, icon] of DOLL) {
      const x = (r.x + r.w * fx - sw / 2) | 0;
      const y = (r.y + 6 + (r.h - 24) * fy) | 0;
      const item = eq[slot];
      const carried = this.ui.cursorItem;
      const accepts = carried ? !!slotFor(carried, slot) : false;
      const hit = this.ui.region(`${this.id}:slot:${slot}`, x, y, sw, sh,
        item ? item.name : slotLabel(slot));

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#0c0a08';
      ctx.fillRect(x, y, sw, sh);
      ctx.globalAlpha = 1;
      A.bevel(ctx, x, y, sw, sh, { sunken: true, size: 1 });
      if (accepts) {
        ctx.strokeStyle = F.TEXT_LINK;
        ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, sh - 1);
      }

      if (item) {
        const ic = itemIcon(item, this.cell);
        const dw = Math.min(sw - 4, ic.width), dh = Math.min(sh - 4, ic.height);
        ctx.drawImage(ic, 0, 0, ic.width, ic.height,
          (x + (sw - dw) / 2) | 0, (y + (sh - dh) / 2) | 0, dw | 0, dh | 0);
        if (hit.hover) { ctx.globalAlpha = 0.2; ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, sw, sh); ctx.globalAlpha = 1; }
      } else {
        A.icon(ctx, icon, (x + (sw - 16) / 2) | 0, (y + (sh - 16) / 2) | 0, 16);
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 1, y + 1, sw - 2, sh - 2);
        ctx.globalAlpha = 1;
      }

      if (hit.rightClick && item) { this.popup = { item, x: this.ui.mouse.x, y: this.ui.mouse.y }; }
      else if (hit.click) this.slotClick(ch, slot, item);
    }
    ctx.restore();
  }

  slotClick(ch, slot, item) {
    const eq = this.equipOf(ch);
    const carried = this.ui.cursorItem;
    if (carried) {
      if (!slotFor(carried, slot)) { this.status = 'That does not go there.'; return; }
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

  drawGrid(ctx, gx, gy, ch) {
    const bag = this.bagOf(ch);
    const cell = this.cell;
    const w = this.cols * cell, h = this.rows * cell;
    A.inset(ctx, gx - 2, gy - 2, w + 4, h + 4);
    ctx.fillStyle = rampCss('wood', 2);
    ctx.fillRect(gx, gy, w, h);

    // Cell lattice.
    ctx.fillStyle = rampCss('wood', 4);
    for (let c = 0; c <= this.cols; c++) ctx.fillRect(gx + c * cell, gy, 1, h);
    for (let rI = 0; rI <= this.rows; rI++) ctx.fillRect(gx, gy + rI * cell, w, 1);

    // The footprint the carried item would occupy, MM6's translucent grey.
    const carried = this.ui.cursorItem;
    let hoverCell = null;
    if (this.ui.mouse.x >= gx && this.ui.mouse.x < gx + w
        && this.ui.mouse.y >= gy && this.ui.mouse.y < gy + h) {
      hoverCell = {
        x: Math.floor((this.ui.mouse.x - gx) / cell),
        y: Math.floor((this.ui.mouse.y - gy) / cell),
      };
    }

    for (const it of bag) {
      if (!Number.isInteger(it.x)) continue;
      const ix = gx + it.x * cell, iy = gy + it.y * cell;
      const iw = itemW(it) * cell, ih = itemH(it) * cell;
      const hit = this.ui.region(`${this.id}:it:${it.uid || it.id || it.name}:${it.x},${it.y}`,
        ix, iy, iw, ih, itemLabel(it));
      ctx.fillStyle = rampCss('wood', hit.hover ? 5 : 3);
      ctx.fillRect(ix + 1, iy + 1, iw - 1, ih - 1);
      const ic = itemIcon(it, cell);
      ctx.drawImage(ic, (ix + (iw - ic.width) / 2) | 0, (iy + (ih - ic.height) / 2) | 0);
      if (it.broken) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(200,32,16,0.35)');
      else if (it.identified === false) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(32,220,64,0.28)');
      else if (it.enchant) tint(ctx, ix + 1, iy + 1, iw - 1, ih - 1, 'rgba(120,120,255,0.20)');
      if (hit.rightClick) this.popup = { item: it, x: this.ui.mouse.x, y: this.ui.mouse.y };
      else if (hit.click && !carried) {
        this.ui.cursorItem = it;
        it.x = null; it.y = null;
        this.sound('pickup');
      }
    }

    if (carried && hoverCell) {
      const ok = this.fits(bag, carried, hoverCell.x, hoverCell.y, carried);
      const fw = itemW(carried) * cell, fh = itemH(carried) * cell;
      ctx.fillStyle = ok ? 'rgba(96,96,96,0.5)' : 'rgba(160,32,16,0.5)';
      ctx.fillRect(gx + hoverCell.x * cell + 1, gy + hoverCell.y * cell + 1, fw - 1, fh - 1);
      const hit = this.ui.region(`${this.id}:drop`, gx, gy, w, h, ok ? 'Place item' : 'It will not fit there');
      if (hit.click && ok) {
        carried.x = hoverCell.x; carried.y = hoverCell.y;
        if (bag.indexOf(carried) < 0) bag.push(carried);
        // Taking it off the body clears whichever slot held it.
        const eq = this.equipOf(ch);
        for (const s of SLOTS) if (eq[s] === carried) eq[s] = null;
        this.ui.cursorItem = null;
        this.sound('drop');
      }
    }
  }

  drawCursorItem(ctx) {
    const it = this.ui.cursorItem;
    if (!it) return;
    const ic = itemIcon(it, this.cell);
    ctx.drawImage(ic, (this.ui.mouse.x - ic.width / 2) | 0, (this.ui.mouse.y - ic.height / 2) | 0);
  }

  drawPopup(ctx) {
    const it = this.popup.item;
    const w = 190;
    const lines = [];
    lines.push(['title', it.name || 'Unknown item']);
    const t = typeOf(it);
    lines.push(['dim', `${capitalise(it.type || 'item')}${it.material ? ', ' + it.material : ''}`]);
    if (it.damage) lines.push(['body', `Damage: ${it.damage}`]);
    if (it.armor) lines.push(['body', `Armour: +${it.armor}`]);
    if (it.attack) lines.push(['body', `Attack: +${it.attack}`]);
    if (it.enchant) lines.push(['good', `${it.enchant}`]);
    if (it.charges !== undefined) lines.push(['body', `Charges: ${it.charges}`]);
    if (it.broken) lines.push(['bad', 'Broken - a smith must repair it.']);
    if (it.identified === false) lines.push(['bad', 'Unidentified.']);
    if (it.value) lines.push(['body', `Value: ${it.value} gold`]);
    if (it.desc) lines.push(['wrap', it.desc]);
    if (t.slot) lines.push(['dim', `Worn: ${slotLabel(t.slot)}`]);

    let h = 10;
    for (const [k, s] of lines) h += k === 'wrap' ? Math.max(10, 10 * Math.ceil(F.measure(s, 'small').w / (w - 16))) + 2 : k === 'title' ? 18 : 11;
    let x = Math.min(this.popup.x + 8, layout.w - w - 6);
    let y = Math.min(this.popup.y + 8, layout.hud.y - h - 6);
    x = Math.max(4, x); y = Math.max(4, y);

    A.parchment(ctx, x, y, w, h);
    A.frame(ctx, x, y, w, h, {});
    let ty = y + 6;
    for (const [k, s] of lines) {
      if (k === 'title') { F.drawText(ctx, s, x + 8, ty, { face: 'title', color: INK_HEAD }); ty += 18; }
      else if (k === 'wrap') { ty = drawWrapped(ctx, s, x + 8, ty, w - 16, { face: 'small', color: INK }) + 2; }
      else {
        F.drawText(ctx, s, x + 8, ty, {
          face: 'small',
          color: k === 'dim' ? INK_DIM : k === 'good' ? '#1d6b1d' : k === 'bad' ? '#8c1c10' : INK,
        });
        ty += 11;
      }
    }
  }
}

function tint(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
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
  const bits = [it.name || 'Item'];
  if (it.damage) bits.push(`(${it.damage})`);
  if (it.armor) bits.push(`(AC +${it.armor})`);
  if (it.broken) bits.push('- broken');
  return bits.join(' ');
}

export default InventoryScreen;
