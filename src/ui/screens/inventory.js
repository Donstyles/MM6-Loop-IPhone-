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
  WHITE, CANARY, HILITE, DIM, GREEN, RED, drawTabs, drawWrapped,
} from './screenbase.js';

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

/** Material tint: [ramp, dark, mid, light]. */
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
  // Rings go on either hand; a one-hander may be held in the off hand.
  if (base === 'ring1' && (target === 'ring1' || target === 'ring2')) return target;
  if (base === 'mainhand' && target === 'offhand' && !item.twoHanded
      && (item.type === 'sword' || item.type === 'dagger' || item.type === 'mace')) return target;
  return null;
}

function tones(item) {
  const m = MATERIALS[item && item.material] || MATERIALS.steel;
  return { dark: rampCss(m[0], m[1]), mid: rampCss(m[0], m[2]), lite: rampCss(m[0], m[3]) };
}

// --- procedural icons -------------------------------------------------------

const ICON_CACHE = new Map();
const CELL = 32;

function pxl(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); }

/**
 * A recognisable pixel icon for an item, painted from its type and material.
 * Cached by icon/material/size, so the grid costs one drawImage per item.
 */
export function itemIcon(item, cell = CELL) {
  const t = typeOf(item);
  const w = itemW(item) * cell - 8;
  const h = itemH(item) * cell - 8;
  const key = `${item.icon || t.icon}|${item.material || 'steel'}|${item.tint || ''}|${w}x${h}`;
  let c = ICON_CACHE.get(key);
  if (c) return c;

  c = document.createElement('canvas');
  c.width = Math.max(4, w); c.height = Math.max(4, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  paintIcon(g, item.icon || t.icon, c.width, c.height, tones(item), item);
  outline(g, c.width, c.height);
  ICON_CACHE.set(key, c);
  return c;
}

/**
 * MM6's item bitmaps are outlined in near-black, which is what stops them
 * dissolving into the wooden grid. Ring the painted pixels the same way.
 */
function outline(g, w, h) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      const near = (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1])
        || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w]);
      if (!near) continue;
      const p = i * 4;
      d[p] = 14; d[p + 1] = 12; d[p + 2] = 10; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function paintIcon(g, kind, w, h, T, item) {
  const cx = (w / 2) | 0;
  const grip = rampCss('wood', 4);
  const gripLite = rampCss('wood', 8);
  const accent = item.tint || rampCss('blood', 9);

  switch (kind) {
    case 'blade': {
      const bw = Math.max(3, (w * 0.3) | 0);
      const tip = 2, guardY = h - Math.max(9, (h * 0.26) | 0);
      for (let y = tip; y < guardY; y++) {
        const k = y < tip + 4 ? Math.max(1, ((bw * (y - tip + 1)) / 5) | 0) : bw;
        pxl(g, cx - (k >> 1), y, k, 1, T.mid);
        pxl(g, cx - (k >> 1), y, 1, 1, T.lite);
        pxl(g, cx + (k >> 1) - 1, y, 1, 1, T.dark);
      }
      pxl(g, cx - (bw >> 1) - 4, guardY, bw + 8, 2, T.dark);
      pxl(g, cx - (bw >> 1) - 4, guardY, bw + 8, 1, T.lite);
      pxl(g, cx - 1, guardY + 2, 3, h - guardY - 4, grip);
      pxl(g, cx - 1, guardY + 2, 1, h - guardY - 4, gripLite);
      pxl(g, cx - 2, h - 2, 5, 2, T.mid);
      break;
    }
    case 'axe': {
      // Haft down the left third, a bearded head bulging out to the right.
      const hx = Math.max(2, (w * 0.24) | 0);
      pxl(g, hx, 2, 3, h - 3, grip);
      pxl(g, hx, 2, 1, h - 3, gripLite);
      const ay = 3, ah = Math.max(10, (h * 0.44) | 0);
      const inner = hx + 2, outer = w - 2;
      for (let y = 0; y < ah; y++) {
        const t = y / (ah - 1);
        const edge = inner + Math.round((outer - inner) * (0.5 + 0.5 * Math.sin(t * Math.PI)));
        pxl(g, inner, ay + y, edge - inner, 1, T.mid);
        pxl(g, edge - 2, ay + y, 2, 1, T.lite);
        pxl(g, inner, ay + y, 1, 1, T.dark);
      }
      pxl(g, hx - 2, ay + 2, 2, ah - 4, T.dark);      // poll behind the haft
      break;
    }
    case 'mace': {
      const hy = (h * 0.32) | 0;
      pxl(g, cx - 1, hy, 3, h - hy - 2, grip);
      pxl(g, cx - 1, hy, 1, h - hy - 2, gripLite);
      const r = Math.max(4, (w * 0.3) | 0);
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        pxl(g, cx - k, hy + y, k * 2, 1, T.mid);
      }
      pxl(g, cx - r + 1, hy - r + 2, 2, 2, T.lite);
      for (let i = 0; i < 4; i++) {
        pxl(g, i % 2 ? cx - r - 2 : cx + r, hy - 4 + (i > 1 ? 5 : 0), 2, 3, T.dark);
      }
      break;
    }
    case 'spear': {
      pxl(g, cx - 1, 8, 2, h - 10, grip);
      pxl(g, cx - 2, 0, 4, 9, T.mid);
      pxl(g, cx - 1, 0, 1, 9, T.lite);
      pxl(g, cx - 3, 8, 6, 2, T.dark);
      pxl(g, cx - 2, h - 3, 4, 3, T.dark);
      break;
    }
    case 'staff': {
      pxl(g, cx - 2, 5, 4, h - 7, grip);
      pxl(g, cx - 2, 5, 1, h - 7, gripLite);
      pxl(g, cx - 3, 0, 6, 6, T.mid);
      pxl(g, cx - 1, 1, 2, 3, accent);
      break;
    }
    case 'bow': {
      for (let y = 2; y < h - 2; y++) {
        const t = (y - h / 2) / (h / 2 - 2);
        const x = 3 + Math.round((1 - t * t) * (w - 8));
        pxl(g, x, y, 3, 1, T.mid);
        pxl(g, x, y, 1, 1, T.lite);
      }
      for (let y = 2; y < h - 2; y++) pxl(g, 3, y, 1, 1, rampCss('sand', 13));
      pxl(g, 3, 2, 3, 2, T.dark); pxl(g, 3, h - 4, 3, 2, T.dark);
      break;
    }
    case 'shield': {
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        const inset = t < 0.6 ? 1 : Math.round(((t - 0.6) / 0.4) * (w / 2 - 2));
        pxl(g, 1 + inset, y, w - 2 - inset * 2, 1, T.mid);
        pxl(g, 1 + inset, y, 1, 1, T.lite);
        pxl(g, w - 2 - inset, y, 1, 1, T.dark);
      }
      pxl(g, 2, 1, w - 4, 1, T.lite);
      pxl(g, cx - 2, (h * 0.3) | 0, 5, 5, accent);
      break;
    }
    case 'helm': {
      const top = (h * 0.16) | 0;
      for (let y = top; y < h - 3; y++) {
        const t = (y - top) / (h - 3 - top);
        const k = Math.round((w / 2 - 1) * Math.sqrt(Math.max(0.2, 1 - (1 - t) * (1 - t) * 0.9)));
        pxl(g, cx - k, y, k * 2, 1, T.mid);
        pxl(g, cx - k, y, 1, 1, T.lite);
        pxl(g, cx + k - 1, y, 1, 1, T.dark);
      }
      pxl(g, 2, (h * 0.6) | 0, w - 4, 2, T.dark);
      pxl(g, cx - 1, Math.max(0, top - 3), 2, 4, accent);
      pxl(g, cx - 5, (h * 0.74) | 0, 10, 2, rampCss('grey', 1));
      break;
    }
    case 'armor': {
      const sh = (h * 0.14) | 0;
      pxl(g, 3, sh, w - 6, h - sh - 2, T.mid);
      pxl(g, 3, sh, 1, h - sh - 2, T.lite);
      pxl(g, w - 4, sh, 1, h - sh - 2, T.dark);
      pxl(g, 1, sh, 5, 5, T.lite); pxl(g, w - 6, sh, 5, 5, T.lite);
      pxl(g, cx - 4, sh + 2, 8, 3, T.dark);
      for (let y = sh + 9; y < h - 4; y += 5) pxl(g, 4, y, w - 8, 1, T.dark);
      pxl(g, cx - 1, sh + 7, 2, h - sh - 12, T.lite);
      break;
    }
    case 'boots': {
      for (const side of [0, 1]) {
        const bx = side ? cx + 2 : 2;
        const bw = ((w - 8) / 2) | 0;
        pxl(g, bx, 2, bw, h - 6, T.mid);
        pxl(g, bx, 2, 1, h - 6, T.lite);
        pxl(g, bx, h - 5, bw + 3, 4, T.dark);
      }
      break;
    }
    case 'gauntlets': {
      for (const side of [0, 1]) {
        const bx = side ? cx + 2 : 2;
        const bw = ((w - 8) / 2) | 0;
        pxl(g, bx, 5, bw, h - 8, T.mid);
        pxl(g, bx, 5, 1, h - 8, T.lite);
        pxl(g, bx, 2, bw, 4, T.dark);
        for (let f = 0; f < 3; f++) pxl(g, bx + 1 + f * 3, h - 5, 2, 3, T.dark);
      }
      break;
    }
    case 'belt': {
      const by = ((h - 6) / 2) | 0;
      pxl(g, 1, by, w - 2, 6, rampCss('dirt', 5));
      pxl(g, 1, by, w - 2, 1, rampCss('dirt', 9));
      pxl(g, cx - 4, by - 2, 9, 10, T.lite);
      pxl(g, cx - 2, by, 4, 6, rampCss('dirt', 3));
      break;
    }
    case 'cloak': {
      for (let y = 2; y < h - 1; y++) {
        const t = y / h;
        const k = Math.round((w / 2 - 1) * (0.4 + t * 0.6));
        pxl(g, cx - k, y, k * 2, 1, T.mid);
        pxl(g, cx - k, y, 1, 1, T.lite);
        pxl(g, cx + k - 1, y, 1, 1, T.dark);
        if (y % 5 === 0) pxl(g, cx - 3, y, 1, 1, T.dark);
      }
      pxl(g, cx - 5, 1, 11, 3, T.lite);
      break;
    }
    case 'amulet': {
      for (let i = -6; i <= 6; i++) pxl(g, cx + i, 2 + Math.round(Math.abs(i) * 0.5), 1, 1, rampCss('gold', 10));
      const r = Math.max(3, (Math.min(w, h) * 0.3) | 0);
      const ay = h - r - 3;
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        pxl(g, cx - k, ay + y, k * 2, 1, accent);
      }
      pxl(g, cx - 1, ay - r + 2, 1, 1, '#ffffff');
      break;
    }
    case 'ring': {
      const r = Math.max(4, (Math.min(w, h) / 2 - 2) | 0);
      const ry = (h / 2 + 2) | 0;
      for (let y = -r; y <= r; y++) {
        const k = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
        pxl(g, cx - k, ry + y, 1, 1, rampCss('gold', 10));
        pxl(g, cx + k - 1, ry + y, 1, 1, rampCss('gold', 6));
      }
      pxl(g, cx - r, ry - r, r * 2, 1, rampCss('gold', 12));
      pxl(g, cx - 2, ry - r - 3, 5, 5, accent);
      pxl(g, cx - 1, ry - r - 2, 1, 1, '#ffffff');
      break;
    }
    case 'potion': {
      const liquid = item.tint || rampCss('blood', 10);
      const bw = Math.max(7, (w * 0.72) | 0);
      pxl(g, cx - 2, 1, 4, 5, rampCss('ice', 9));
      pxl(g, cx - 3, 4, 7, 2, rampCss('ice', 13));
      for (let y = 6; y < h - 1; y++) {
        const t = (y - 6) / (h - 7);
        const k = Math.max(1, Math.round((bw / 2) * Math.min(1, 0.45 + t * 1.5)));
        pxl(g, cx - k, y, k * 2, 1, y > 9 ? liquid : rampCss('ice', 11));
        pxl(g, cx - k, y, 1, 1, rampCss('ice', 13));
      }
      pxl(g, cx + 1, h - 6, 1, 3, '#ffffff');
      break;
    }
    case 'scroll': {
      pxl(g, 3, 2, w - 6, h - 4, rampCss('sand', 13));
      pxl(g, 3, 2, w - 6, 1, rampCss('sand', 15));
      pxl(g, 3, h - 3, w - 6, 1, rampCss('sand', 9));
      pxl(g, 1, 1, 3, h - 2, rampCss('sand', 10));
      pxl(g, w - 4, 1, 3, h - 2, rampCss('sand', 10));
      for (let y = 5; y < h - 4; y += 3) pxl(g, 6, y, w - 12, 1, rampCss('dirt', 4));
      break;
    }
    case 'wand': {
      pxl(g, cx - 1, 6, 3, h - 8, rampCss('wood', 6));
      pxl(g, cx - 1, 6, 1, h - 8, rampCss('wood', 10));
      pxl(g, cx - 3, 1, 6, 6, accent);
      pxl(g, cx - 1, 2, 2, 2, '#ffffff');
      pxl(g, cx - 2, h - 3, 5, 2, rampCss('gold', 9));
      break;
    }
    case 'book': {
      pxl(g, 2, 2, w - 4, h - 4, rampCss('blood', 5));
      pxl(g, 2, 2, w - 4, 1, rampCss('blood', 8));
      pxl(g, 2, 2, 4, h - 4, rampCss('blood', 3));
      pxl(g, 7, 4, w - 10, h - 8, rampCss('sand', 14));
      pxl(g, 7, 4, w - 10, 1, rampCss('sand', 15));
      pxl(g, (w / 2) | 0, 6, 1, h - 12, rampCss('sand', 10));
      pxl(g, w - 9, ((h / 2) - 2) | 0, 4, 5, rampCss('gold', 11));
      break;
    }
    case 'gem': {
      const r = Math.min(w, h) / 2 - 1;
      for (let y = 0; y < h - 2; y++) {
        const t = y / (h - 3);
        const k = Math.max(1, Math.round(r * (t < 0.34 ? 0.4 + t * 1.8 : 1 - (t - 0.34) * 1.4)));
        pxl(g, cx - k, y + 1, k * 2, 1, accent);
      }
      pxl(g, cx - 1, 2, 2, 2, '#ffffff');
      pxl(g, cx - 3, 5, 1, 4, '#ffffff');
      break;
    }
    case 'gold': {
      for (let i = 0; i < 6; i++) {
        const gx = 1 + ((i * 6) % Math.max(1, w - 9));
        const gy = h - 5 - ((i % 3) * 4);
        pxl(g, gx, gy, 8, 4, rampCss('gold', 10));
        pxl(g, gx, gy, 8, 1, rampCss('gold', 14));
        pxl(g, gx, gy + 3, 8, 1, rampCss('gold', 6));
      }
      break;
    }
    default: {
      pxl(g, 2, 5, w - 4, h - 6, rampCss('dirt', 6));
      pxl(g, 2, 5, w - 4, 1, rampCss('dirt', 9));
      pxl(g, cx - 3, 1, 7, 5, rampCss('foliage', 8));
      pxl(g, cx - 1, 0, 2, 4, rampCss('foliage', 11));
      pxl(g, 4, h - 4, w - 8, 1, rampCss('dirt', 3));
      break;
    }
  }
}

// --- paperdoll --------------------------------------------------------------

/** Slot wells in the right-hand column, relative to the doll well's origin. */
const DOLL = [
  ['helm', 66, 6, 32, 28, 'slot_helm'],
  ['amulet', 120, 8, 26, 26, 'slot_amulet'],
  ['cloak', 6, 8, 30, 36, 'slot_cloak'],
  ['gauntlets', 6, 54, 32, 32, 'slot_gauntlets'],
  ['bow', 120, 48, 38, 54, 'slot_bow'],
  ['armor', 60, 50, 44, 58, 'slot_armor'],
  ['mainhand', 6, 96, 32, 60, 'slot_weapon'],
  ['offhand', 120, 110, 38, 52, 'slot_offhand'],
  ['belt', 62, 116, 40, 20, 'slot_belt'],
  ['boots', 64, 144, 36, 32, 'slot_boots'],
  ['ring1', 10, 182, 26, 26, 'slot_ring'],
  ['ring2', 128, 182, 26, 26, 'slot_ring'],
];

const WELL = { x: SIDE.x + 4, y: 6, w: 164, h: 282 };

function equipOf(ch) {
  if (!ch.equipment) ch.equipment = {};
  return ch.equipment;
}

/** A flat painted body, dark enough that the slot wells read on top of it. */
function bodySilhouette(ctx, r) {
  const cx = (r.x + r.w / 2) | 0;
  const top = r.y + 8;
  const sk = rampCss('flesh', 6), skD = rampCss('flesh', 4), cloth = rampCss('dirt', 7);
  const headR = 14;
  ctx.save();
  for (let y = -headR; y <= headR; y++) {
    const k = Math.round(Math.sqrt(Math.max(0, headR * headR - y * y)) * 0.84);
    ctx.fillStyle = y < -5 ? skD : sk;
    ctx.fillRect(cx - k, top + headR + y, k * 2, 1);
  }
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - 7, top + headR * 2 - 3, 14, 7);
  const ty = top + headR * 2 + 4, th = 78;
  for (let y = 0; y < th; y++) {
    const k = Math.round(25 - (y / th) * 7);
    ctx.fillStyle = cloth;
    ctx.fillRect(cx - k, ty + y, k * 2, 1);
  }
  ctx.fillStyle = skD;
  ctx.fillRect(cx - 33, ty + 6, 9, 62);
  ctx.fillRect(cx + 24, ty + 6, 9, 62);
  const ly = ty + th, lh = 62;
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - 19, ly, 16, lh);
  ctx.fillRect(cx + 3, ly, 16, lh);
  ctx.fillStyle = skD;
  ctx.fillRect(cx - 20, ly + lh, 18, 6);
  ctx.fillRect(cx + 2, ly + lh, 18, 6);
  ctx.restore();
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
  A.inset(ctx, r.x, r.y, r.w, r.h);
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.clip();
  ctx.fillStyle = rampCss('stone', 4);
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  bodySilhouette(ctx, r);

  const eq = equipOf(ch);
  const carried = ui.cursorItem;
  for (const [slot, sx, sy, sw, sh, icon] of DOLL) {
    const x = r.x + sx, y = r.y + sy;
    const item = eq[slot];
    const accepts = carried ? !!slotFor(carried, slot) : false;
    const hit = ui.region(`doll:${slot}`, x, y, sw, sh, item ? itemLabel(item) : slotLabel(slot));

    if (item) {
      // Worn gear is painted straight onto the body, as a paperdoll should be;
      // only the empty slots show their well.
      const ic = itemIcon(item);
      const s = Math.min(1, (sw - 2) / ic.width, (sh - 2) / ic.height);
      const dw = Math.max(1, (ic.width * s) | 0), dh = Math.max(1, (ic.height * s) | 0);
      const dx = (x + (sw - dw) / 2) | 0, dy = (y + (sh - dh) / 2) | 0;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000000';
      ctx.fillRect(dx + 2, dy + 2, dw, dh);
      ctx.globalAlpha = 1;
      ctx.drawImage(ic, 0, 0, ic.width, ic.height, dx, dy, dw, dh);
      if (item.broken) { ctx.fillStyle = 'rgba(255,0,0,0.35)'; ctx.fillRect(dx, dy, dw, dh); }
    } else {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#0c0a08';
      ctx.fillRect(x, y, sw, sh);
      ctx.globalAlpha = 1;
      A.bevel(ctx, x, y, sw, sh, { sunken: true, size: 1 });
      ctx.globalAlpha = 0.5;
      A.icon(ctx, icon, (x + (sw - 16) / 2) | 0, (y + (sh - 16) / 2) | 0, 16);
      ctx.globalAlpha = 1;
    }
    if (accepts) {
      ctx.fillStyle = HILITE;
      ctx.fillRect(x, y, sw, 1); ctx.fillRect(x, y + sh - 1, sw, 1);
      ctx.fillRect(x, y, 1, sh); ctx.fillRect(x + sw - 1, y, 1, sh);
    } else if (hit.hover) {
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, sw, sh); ctx.globalAlpha = 1;
    }

    if (hit.rightClick && item && screen.showPopup) screen.showPopup(item);
    else if (hit.click && screen.slotClick) screen.slotClick(ch, slot, item || null);
  }
  ctx.restore();

  // Gold and food, where MM6 keeps them: the lower right panel.
  const gy = r.y + r.h + 6;
  A.icon(ctx, 'gold', r.x + 6, gy, 14);
  F.drawText(ctx, String(screen.party.gold | 0), r.x + 24, gy + 2, { face: 'small', color: CANARY });
  A.icon(ctx, 'food', r.x + 86, gy, 14);
  F.drawText(ctx, String(screen.party.food | 0), r.x + 104, gy + 2, { face: 'small', color: WHITE });
  F.drawText(ctx, ch.name || '', r.x + r.w / 2, gy + 18, { face: 'small', align: 'center', color: WHITE });
}

// --- the screen -------------------------------------------------------------

const GRID_X = 13, GRID_Y = 16, COLS = 14, ROWS = 9;

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

    this.status = this.ui.cursorItem
      ? 'Click a cell or a body slot to put it down. Right-click an item to inspect it.'
      : 'Click an item to pick it up. Right-click to inspect it.';
    this.drawHelpLine(ctx, 306);

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
    A.inset(ctx, gx - 2, gy - 2, w + 4, h + 4);
    ctx.fillStyle = rampCss('wood', 2);
    ctx.fillRect(gx, gy, w, h);
    ctx.fillStyle = rampCss('wood', 4);
    for (let c = 0; c <= COLS; c++) ctx.fillRect(gx + c * CELL, gy, 1, h);
    for (let r = 0; r <= ROWS; r++) ctx.fillRect(gx, gy + r * CELL, w, 1);

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
      if (hit.hover) {
        ctx.fillStyle = rampCss('wood', 6);
        ctx.fillRect(ix + 1, iy + 1, iw - 1, ih - 1);
      }
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
      if (k === 'title') { F.drawText(ctx, s, x + 8, ty, { face: 'title', color: '#2a1a06' }); ty += 18; }
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
