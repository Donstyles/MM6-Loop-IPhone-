// ---------------------------------------------------------------------------
// Shops: weapon smith, armourer, magic shop, alchemist, general store.
//
// One screen, parameterised by kind. The left 461x345 inset is a painted
// interior that differs per trade - racks of blades, a mail stand, a shelf of
// glassware - and the buy / sell / identify / repair grids are drawn straight
// over that painting the way the original does it. The right column carries the
// shopkeeper and the six options.
//
// Prices go through the active character's Merchant skill, which is the whole
// reason MM6 players carry a merchant: buying is cheaper and selling dearer as
// the skill rises.
// ---------------------------------------------------------------------------

import { rampCss, ramp } from '../../core/palette.js';

import * as F from '../../art/font.js';
import { priceMultipliers } from '../../game/stats.js';
import { itemName, itemValue, itemDescription, itemDef, shopStock } from '../../game/items.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, rngFor, paintWall,
  paintFloor, paintShelf, paintCounter, paintClutter, vignette, activeMember, charName,
  partyGold, spend, earn, say, MM6, C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED,
} from './dialogue.js';

// ---------------------------------------------------------------------------
// Item icons
// ---------------------------------------------------------------------------

const POTION_CSS = {
  red: '#c02818', blue: '#2848d8', yellow: '#e0d020', purple: '#9038c8',
  orange: '#e08018', green: '#28c828', white: '#f0f0e0', black: '#302838',
  grey: '#a0a0a8', cyan: '#40d8d8', pink: '#f090b0', gold: '#e1cd23',
  crimson: '#e02040', azure: '#4090f0', violet: '#a060e0', emerald: '#20c070',
  amber: '#e0a020', silver: '#d0d0e0', opal: '#e0d0f0', clear: '#c8d8e0',
  radiant: '#fff0c0', radiant_blue: '#c0e0ff', radiant_gold: '#ffe080', stone: '#a09080',
};

/**
 * Map a shop item onto one of the painted bitmaps in mm6art. MM6's item art is
 * a modelled object - metal with a lit edge and a shadowed flat, wood with
 * grain, a wrapped grip - so the whole set is painted there and only chosen
 * here.
 */
function artKindOf(item) {
  const def = itemDef(item.def) || {};
  const type = item.type || def.type || 'misc';
  const skill = def.skill || item.skill || '';
  if (type === 'weapon') {
    if (skill === 'bow') return 'bow';
    if (skill === 'staff') return 'staff';
    if (skill === 'axe') return 'axe';
    if (skill === 'spear') return 'spear';
    if (skill === 'mace') return 'mace';
    if (skill === 'dagger') return 'dagger';
    return 'sword';
  }
  if (type === 'armor') return skill === 'chain' ? 'chain' : 'armor';
  return type;
}

/** Metal, wood or hide, picked from what the item actually is. */
function artMatOf(item) {
  const def = itemDef(item.def) || {};
  const type = item.type || def.type || 'misc';
  const skill = def.skill || item.skill || '';
  if (item.material) return item.material;
  if (type === 'armor') return skill === 'leather' ? 'leather' : skill === 'chain' ? 'iron' : 'steel';
  if (type === 'boots' || type === 'belt') return 'leather';
  if (type === 'cloak') return 'cloth';
  if (type === 'amulet' || type === 'ring') return 'gold';
  if (type === 'scroll') return 'bone';
  if ((def.tier || 1) >= 4) return 'silver';
  return 'steel';
}

const POTION_ACCENT = POTION_CSS;

/** How tall an item is painted on the shop's shelf. */
export function itemArtSize(item) {
  const k = artKindOf(item);
  switch (k) {
    case 'sword': case 'spear': case 'staff': return 58;
    case 'bow': case 'axe': case 'armor': case 'chain': return 52;
    case 'dagger': case 'wand': case 'mace': return 44;
    case 'ring': case 'amulet': case 'gem': return 28;
    case 'potion': return 38;
    default: return 42;
  }
}

/** Paint an item as a small painted object at (cx, cy), `s` pixels tall. */
export function drawItemIcon(ctx, item, cx, cy, s = 28) {
  const def = itemDef(item.def) || {};
  const kind = artKindOf(item);
  const accent = kind === 'potion' ? (POTION_ACCENT[def.color] || '#c02818')
    : item.tint || (def.tier >= 3 ? '#4090f0' : '#c02818');
  MM6.drawItemArt(ctx, kind, cx, cy, s, { mat: artMatOf(item), accent });

  // Broken items are marked red and unidentified ones green. The inventory
  // tints the bitmap itself; here the icons sit on a painted interior, so the
  // state goes on a corner flash that cannot be lost in the backdrop.
  if (item.broken || item.identified === false) {
    const half = s / 2;
    ctx.fillStyle = item.broken ? '#ff0000' : '#00e100';
    ctx.fillRect((cx - half) | 0, (cy - half) | 0, 4, 4);
    ctx.fillRect((cx + half - 4) | 0, (cy + half - 4) | 0, 4, 4);
  }
}

// ---------------------------------------------------------------------------
// Interiors
// ---------------------------------------------------------------------------

const KIND_TITLE = {
  weapon: 'Weapon Smith', armor: 'Armourer', magic: 'Magic Shop',
  alchemy: 'Alchemist', general: 'General Store',
};

/** Painted interior per trade. Baked once, blitted thereafter. */
export function paintShopInterior(g, w, h, kind) {
  const horizon = Math.round(h * 0.54);
  const wallRamp = kind === 'magic' ? 'stone' : kind === 'alchemy' ? 'plaster' : 'plaster';
  paintWall(g, 0, 0, w, horizon, {
    ramp: wallRamp, lo: 0.12, hi: kind === 'magic' ? 0.42 : 0.54, course: 20, seed: 17,
  });
  paintFloor(g, 0, horizon, w, h - horizon, {
    ramp: kind === 'magic' ? 'stone' : 'wood', seed: 23,
  });

  // Ceiling and beams.
  g.fillStyle = rampCss('wood', 2); g.fillRect(0, 0, w, 12);
  for (let x = 16; x < w; x += 88) {
    g.fillStyle = rampCss('wood', 4); g.fillRect(x, 0, 12, 26);
    g.fillStyle = rampCss('wood', 7); g.fillRect(x, 0, 2, 26);
  }

  if (kind === 'weapon') {
    // Blade rack across the back wall, an anvil and a forge.
    paintShelf(g, 40, 128, w - 150, { th: 5 });
    for (let i = 0; i < 9; i++) {
      const x = 52 + i * 38;
      const len = 46 + (i % 3) * 12;
      g.fillStyle = rampCss('grey', 10);
      g.fillRect(x, 128 - len, 3, len);
      g.fillStyle = rampCss('grey', 13);
      g.fillRect(x, 128 - len, 1, len);
      g.fillStyle = rampCss('gold', 8);
      g.fillRect(x - 4, 128 - len + 6, 11, 2);
    }
    // Forge glow on the right.
    g.fillStyle = rampCss('stone', 4);
    g.fillRect(w - 96, horizon - 74, 84, 74);
    g.fillStyle = '#150800';
    g.fillRect(w - 84, horizon - 54, 60, 40);
    glow(g, w - 54, horizon - 34, 54, '#ff7010', 0.95);
    // Anvil.
    poly(g, [110, h - 30, 168, h - 30, 160, h - 42, 118, h - 42], rampCss('grey', 5));
    poly(g, [128, h - 42, 150, h - 42, 150, h - 66, 172, h - 66, 172, h - 74, 118, h - 74, 118, h - 66, 128, h - 66],
      rampCss('grey', 7));
    g.fillStyle = rampCss('grey', 11);
    g.fillRect(118, h - 74, 54, 2);
  } else if (kind === 'armor') {
    // Mail hanging from pegs, a stand with a cuirass, shields on the wall.
    for (let i = 0; i < 5; i++) {
      const x = 46 + i * 62;
      g.fillStyle = rampCss('grey', 6);
      g.fillRect(x, 52, 40, 62);
      g.fillStyle = rampCss('grey', 9);
      for (let yy = 54; yy < 112; yy += 4) {
        for (let xx = x + 2; xx < x + 38; xx += 4) g.fillRect(xx + ((yy / 4) & 1) * 2, yy, 2, 2);
      }
      g.fillStyle = rampCss('grey', 3);
      g.fillRect(x, 114, 40, 3);
      g.fillStyle = rampCss('wood', 6);
      g.fillRect(x + 16, 44, 8, 10);
    }
    // Shield on the right wall.
    poly(g, [w - 92, 150, w - 40, 150, w - 44, 196, w - 66, 214, w - 88, 196], rampCss('blood', 5));
    poly(g, [w - 88, 154, w - 66, 154, w - 66, 206, w - 84, 192], rampCss('blood', 7));
    A.gem(g, w - 70, 172, 9, 'gold');
    // Armour stand in the foreground.
    poly(g, [200, h - 20, 260, h - 20, 252, h - 96, 208, h - 96], rampCss('grey', 7));
    g.fillStyle = rampCss('grey', 11); g.fillRect(206, h - 96, 6, 76);
    g.fillStyle = rampCss('grey', 4); g.fillRect(200, h - 22, 60, 4);
  } else if (kind === 'magic') {
    // Arched niches with orbs and a glowing brazier.
    for (let i = 0; i < 4; i++) {
      const x = 44 + i * 96;
      g.fillStyle = rampCss('stone', 2);
      g.fillRect(x, 44, 58, 84);
      g.beginPath(); g.arc(x + 29, 44, 29, Math.PI, Math.PI * 2); g.fill();
      g.fillStyle = rampCss('stone', 6);
      g.fillRect(x - 2, 126, 62, 4);
      const col = ['#c078e8', '#40d8d8', '#e1cd23', '#40f460'][i];
      g.fillStyle = col;
      g.beginPath(); g.arc(x + 29, 96, 13, 0, Math.PI * 2); g.fill();
      glow(g, x + 29, 96, 40, col, 0.8);
    }
    // Runic circle on the floor.
    g.save();
    g.globalAlpha = 0.55;
    g.strokeStyle = '#c078e8'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(w / 2, horizon + 66, 120, 34, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(w / 2, horizon + 66, 92, 26, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    glow(g, w / 2, horizon + 66, 90, '#8040c0', 0.5);
  } else if (kind === 'alchemy') {
    // Shelves crowded with bottles, plus a bubbling still.
    for (let r = 0; r < 3; r++) {
      const sy = 52 + r * 40;
      paintShelf(g, 30, sy + 26, w - 130, { th: 4 });
      for (let i = 0; i < 14; i++) {
        const x = 40 + i * ((w - 150) / 14);
        const bh = 14 + ((i * 7 + r * 3) % 3) * 5;
        const col = ['#c02818', '#2848d8', '#e0d020', '#28c828', '#9038c8', '#40d8d8'][(i + r) % 6];
        g.fillStyle = 'rgba(210,225,235,0.5)';
        g.fillRect(x, sy + 26 - bh, 8, bh);
        g.fillStyle = col;
        g.fillRect(x + 1, sy + 26 - bh * 0.65, 6, bh * 0.65 - 1);
        g.fillStyle = rampCss('wood', 5);
        g.fillRect(x + 2, sy + 24 - bh, 4, 3);
      }
    }
    // Still on the right: a copper belly, a condenser pipe and a green flame.
    g.fillStyle = rampCss('gold', 3);
    g.beginPath(); g.ellipse(w - 62, horizon - 6, 30, 24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('gold', 6);
    g.beginPath(); g.ellipse(w - 70, horizon - 12, 12, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('gold', 7);
    g.fillRect(w - 64, horizon - 48, 5, 22);
    g.fillRect(w - 64, horizon - 48, 26, 4);
    glow(g, w - 62, horizon + 16, 30, '#40f460', 0.45);
  } else {
    // General store: sacks, barrels, hanging herbs, a crowded shelf.
    paintShelf(g, 36, 96, w - 160, { th: 5 });
    paintShelf(g, 36, 140, w - 160, { th: 5 });
    for (let i = 0; i < 16; i++) {
      const x = 44 + i * ((w - 180) / 16);
      const kind2 = i % 3;
      g.fillStyle = rampCss(kind2 === 0 ? 'sand' : kind2 === 1 ? 'wood' : 'dirt', 7 + (i % 3));
      if (kind2 === 0) g.fillRect(x, 78, 12, 18);
      else if (kind2 === 1) { g.beginPath(); g.arc(x + 6, 88, 7, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(x, 82, 10, 14);
      g.fillStyle = rampCss('sand', 10);
      g.fillRect(x + 2, 122, 9, 18);
    }
    for (let i = 0; i < 6; i++) {
      const x = 60 + i * 62;
      g.fillStyle = rampCss('foliage', 5);
      poly(g, [x, 14, x + 6, 14, x + 3, 44], rampCss('foliage', 5 + (i % 3)));
    }
  }

  // --- foreground -----------------------------------------------------------
  // The item grid covers the top two thirds, so everything that has to read at
  // a glance lives down here: wainscot, counter, shopkeeper and clutter.

  // Wainscot along the bottom of the wall.
  g.fillStyle = rampCss('wood', 3);
  g.fillRect(0, horizon - 16, w, 16);
  g.fillStyle = rampCss('wood', 7);
  g.fillRect(0, horizon - 16, w, 2);

  // Worn rug on the boards - dark and small, so it reads as floor covering
  // rather than as a painted disc.
  const rugRamp = kind === 'magic' ? 'arcane' : 'blood';
  const rugLo = kind === 'magic' ? 1 : 2, rugHi = kind === 'magic' ? 2 : 4;
  g.save();
  g.globalAlpha = 0.6;
  g.fillStyle = rampCss(rugRamp, rugLo);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 92, 17, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss(rugRamp, rugHi);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 74, 12, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('sand', 6);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 40, 6, 0, 0, Math.PI * 2); g.fill();
  g.restore();

  // The shopkeeper, large enough to read, behind a heavy counter.
  const cy = h - 64;
  // The proprietor stands behind the counter, below the stock shelves, lit by
  // the lantern: a painted person, not a silhouette.
  figure(g, w * 0.72, cy + 10, 118, null, null, {
    hat: kind === 'magic' || kind === 'alchemy',
    cloth: kind === 'magic' ? [64, 54, 96] : kind === 'alchemy' ? [72, 88, 68] : [104, 74, 44],
    skin: [206, 162, 124], hair: [72, 48, 26], robe: kind === 'magic' || kind === 'alchemy',
    hood: false,
  });
  // Shadow the counter throws forward.
  g.save();
  g.globalAlpha = 0.35;
  g.fillStyle = '#000000';
  g.fillRect(0, cy - 10, w, 12);
  g.restore();
  paintCounter(g, 0, cy, w, 32, { cloth: kind === 'magic' ? 'arcane' : null });

  // Goods on the counter, different per trade.
  const props = {
    weapon: () => {
      // A blade laid out for inspection, and a whetstone.
      g.fillStyle = rampCss('stone', 10);
      g.fillRect(w * 0.14, cy - 4, 84, 4);
      g.fillStyle = rampCss('stone', 13);
      g.fillRect(w * 0.14, cy - 4, 84, 1);
      g.fillStyle = rampCss('wood', 5);
      g.fillRect(w * 0.14 + 84, cy - 6, 16, 6);
      g.fillStyle = rampCss('stone', 4);
      g.fillRect(w * 0.30, cy - 7, 22, 7);
    },
    armor: () => {
      // A helm and a stack of gauntlets.
      g.fillStyle = rampCss('stone', 8);
      g.beginPath(); g.arc(w * 0.16, cy - 2, 13, Math.PI, Math.PI * 2); g.fill();
      g.fillRect(w * 0.16 - 13, cy - 2, 26, 3);
      g.fillStyle = rampCss('stone', 12);
      g.beginPath(); g.arc(w * 0.16 - 4, cy - 3, 9, Math.PI * 1.1, Math.PI * 1.7); g.fill();
      g.fillStyle = rampCss('stone', 6);
      for (let i = 0; i < 3; i++) g.fillRect(w * 0.28 + i * 3, cy - 5 - i * 3, 26, 4);
    },
    magic: () => {
      // A crystal on a stand, throwing a little light on the counter.
      glow(g, w * 0.18, cy - 14, 44, '#c078e8', 0.7);
      g.fillStyle = rampCss('gold', 7);
      g.fillRect(w * 0.18 - 8, cy - 6, 16, 6);
      poly(g, [w * 0.18, cy - 32, w * 0.18 + 9, cy - 14, w * 0.18, cy - 6, w * 0.18 - 9, cy - 14], '#c078e8');
      g.fillStyle = rampCss('sand', 12);
      g.fillRect(w * 0.32, cy - 5, 30, 5);
    },
    alchemy: () => {
      // A row of filled flasks and a mortar.
      for (let i = 0; i < 6; i++) {
        const x = w * 0.10 + i * 15;
        const col = ['#c02818', '#2848d8', '#e0d020', '#28c828', '#9038c8', '#40d8d8'][i];
        g.fillStyle = 'rgba(210,225,235,0.55)';
        g.fillRect(x, cy - 16, 9, 16);
        g.fillStyle = col;
        g.fillRect(x + 1, cy - 9, 7, 8);
        g.fillStyle = rampCss('wood', 5);
        g.fillRect(x + 2, cy - 19, 5, 3);
      }
      g.fillStyle = rampCss('stone', 7);
      g.beginPath(); g.ellipse(w * 0.34, cy - 5, 13, 6, 0, Math.PI, 0); g.fill();
      g.fillRect(w * 0.34 - 13, cy - 5, 26, 5);
    },
    general: () => {
      // Scales, a sack and a ledger.
      g.fillStyle = rampCss('gold', 7);
      g.fillRect(w * 0.16, cy - 22, 2, 22);
      g.fillRect(w * 0.16 - 14, cy - 22, 30, 2);
      for (const ox of [-14, 14]) {
        poly(g, [w * 0.16 + ox - 6, cy - 16, w * 0.16 + ox + 6, cy - 16, w * 0.16 + ox, cy - 11],
          rampCss('gold', 9));
      }
      g.fillStyle = rampCss('sand', 7);
      g.beginPath(); g.ellipse(w * 0.30, cy - 7, 13, 8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = rampCss('blood', 4);
      g.fillRect(w * 0.38, cy - 5, 24, 5);
    },
  };
  (props[kind] || props.general)();

  paintClutter(g, 14, h - 4, 'barrel', 36);
  paintClutter(g, 54, h - 2, 'crate', 26);
  paintClutter(g, w - 52, h - 2, 'sack', 30);

  // Lantern hanging over the counter on a chain, and its pool of light.
  const lx = w * 0.30, ly = 62;
  g.fillStyle = rampCss('grey', 4);
  for (let yy = 0; yy < ly - 10; yy += 4) g.fillRect(lx | 0, yy, 2, 3);
  g.fillStyle = rampCss('gold', 5);
  g.fillRect((lx - 8) | 0, ly - 10, 16, 3);
  g.fillRect((lx - 7) | 0, ly - 7, 14, 14);
  g.fillStyle = '#ffe8a0';
  g.fillRect((lx - 5) | 0, ly - 5, 10, 10);
  g.fillStyle = rampCss('gold', 8);
  g.fillRect((lx - 7) | 0, ly + 7, 14, 3);
  glow(g, lx, ly, 78, '#ffc860', 0.55);

  vignette(g, w, h);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const GRID = { x: PANEL.x + 14, y: PANEL.y + 20, cols: 6, rows: 2, cw: 74, ch: 76 };
const RESTOCK_DAYS = 7;

export class ShopScreen extends HouseScreen {
  /**
   * @param {object} opts {kind, tier, id, keeper, town}
   */
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.kind = opts.kind || 'weapon';
    this.id = `shop:${this.kind}`;
    this.tier = opts.tier || 2;
    this.shopId = opts.id || `${this.kind}_shop`;
    this.title = opts.title || KIND_TITLE[this.kind] || 'Shop';
    this.town = opts.town || 1;
    this.keeper = opts.keeper || {
      name: 'Shopkeeper', title: KIND_TITLE[this.kind], portraitSeed: 41, sex: 'm',
    };
    this.mode = 'buy';
    this.special = false;
    this.shop = this.shopState();
  }

  // --- state ---------------------------------------------------------------

  get day() {
    const c = this.session && this.session.clock;
    return c ? Math.floor(c.minutes / 1440) : 0;
  }

  shopState() {
    const s = this.session;
    if (!s.shops) s.shops = {};
    let st = s.shops[this.shopId];
    if (!st) {
      st = { id: this.shopId, kind: this.kind, tier: this.tier, restockDay: this.day, seed: 1 };
      s.shops[this.shopId] = st;
      this.restock(st);
    } else if (this.day - st.restockDay >= RESTOCK_DAYS) {
      st.restockDay = this.day;
      st.seed++;
      this.restock(st);
    }
    return st;
  }

  /** MM6 rerolls a shop's stock every week; specials are rarer and dearer. */
  restock(st) {
    const rnd = rngFor(`${this.shopId}:${st.seed}`);
    st.stock = shopStock(rnd, this.kind, this.tier, 12);
    st.specials = shopStock(rnd, this.kind, Math.min(6, this.tier + 2), 6);
    for (const it of st.specials) it.identified = true;
  }

  // --- prices --------------------------------------------------------------

  get merchant() {
    const ch = this.character || activeMember(this.session);
    return priceMultipliers(ch || {}, this.town);
  }

  buyPrice(item) { return Math.max(1, Math.round(itemValue(item) * this.merchant.buy)); }
  sellPrice(item) { return Math.max(1, Math.round(itemValue(item) * this.merchant.sell)); }
  idPrice(item) { return Math.max(1, Math.round(itemValue(item) * 0.1 * this.merchant.buy)); }
  repairPrice(item) { return Math.max(1, Math.round(itemValue(item) * 0.25 * this.merchant.buy)); }

  /** The shopkeeper's own skill gates what he will identify or repair. */
  get keeperSkill() { return this.keeper.skill || this.tier * 4; }

  // --- inventory access ----------------------------------------------------

  inventoryOf(ch) {
    if (!ch) return [];
    if (!ch.inventory) ch.inventory = ch.items || [];
    return ch.inventory;
  }

  give(item) {
    const ch = this.character || activeMember(this.session);
    if (!ch) return false;
    this.inventoryOf(ch).push(item);
    return true;
  }

  take(item) {
    const ch = this.character || activeMember(this.session);
    const inv = this.inventoryOf(ch);
    const i = inv.indexOf(item);
    if (i >= 0) inv.splice(i, 1);
  }

  // --- options -------------------------------------------------------------

  options() {
    return [
      { id: 'buy', label: 'Buy Standard', tip: 'Browse the everyday stock.' },
      { id: 'special', label: 'Buy Special', tip: 'The pieces kept under the counter.' },
      { id: 'sell', label: 'Sell', tip: 'Sell from the active character.' },
      { id: 'identify', label: 'Identify', tip: 'Have an unknown item appraised.' },
      { id: 'repair', label: 'Repair', tip: 'Mend a broken item.' },
      { id: 'learn', label: 'Learn Skill', tip: `Learn ${this.teachSkillName()}.` },
    ];
  }

  teachSkillName() {
    return {
      weapon: 'Repair Item', armor: 'Armsmaster', magic: 'Identify Item',
      alchemy: 'Alchemy', general: 'Merchant',
    }[this.kind] || 'Merchant';
  }

  teachSkillId() {
    return { weapon: 'repair', armor: 'leather', magic: 'identify', alchemy: 'perception', general: 'merchant' }[this.kind] || 'merchant';
  }

  onOption(id) {
    if (id === 'learn') { this.learnSkill(); return; }
    this.special = id === 'special';
    this.mode = id === 'special' ? 'buy' : id;
  }

  learnSkill() {
    const ch = this.character || activeMember(this.session);
    if (!ch) return;
    const skill = this.teachSkillId();
    const price = 100 * this.tier;
    if (!ch.skills) ch.skills = {};
    if (ch.skills[skill]) { this.say(`${charName(ch)} already knows ${this.teachSkillName()}.`); return; }
    if (!spend(this.session, price)) { this.say(`${this.teachSkillName()} costs ${gold(price)} gold to learn.`); return; }
    ch.skills[skill] = { level: 1, mastery: 1 };
    this.say(`${charName(ch)} has learned ${this.teachSkillName()}.`);
  }

  panelInfo() {
    const ch = this.character || activeMember(this.session);
    const m = this.merchant;
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: `${charName(ch)} is haggling`, color: C_WHITE },
      { text: `buy x${m.buy.toFixed(2)}  sell x${m.sell.toFixed(2)}`, color: C_DIM },
    ];
  }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked(`shop:${this.kind}`, PANEL.w, PANEL.h, (g, w, h) => paintShopInterior(g, w, h, this.kind));
  }

  /**
   * MM6 lays the stock straight onto the painted room: item bitmaps on shelves,
   * with no bordered cells, no captions and no prices under them. The name and
   * the price appear only for the item under the pointer, on the status line.
   */
  drawContent(ctx) {
    const list = this.currentList();
    const heading = {
      buy: this.special ? 'Special Stock' : 'For Sale',
      sell: `Sell from ${charName(this.character || activeMember(this.session))}`,
      identify: 'Identify',
      repair: 'Repair',
    }[this.mode] || '';

    const gx = GRID.x, gy = GRID.y;
    const rows = Math.max(1, Math.min(GRID.rows, Math.ceil(list.length / GRID.cols)));

    // Painted shelves for the stock to stand on - an object in the room, not a
    // widget. The heading is engraved into the shelf's front edge.
    for (let r = 0; r < rows; r++) {
      const sy = gy + r * GRID.ch + GRID.ch - 22;
      const sw = GRID.cols * GRID.cw;
      MM6.rct(ctx, gx - 8, sy, sw + 12, 5, [96, 68, 38]);
      MM6.rct(ctx, gx - 8, sy, sw + 12, 1, [156, 120, 74]);
      MM6.rct(ctx, gx - 8, sy + 5, sw + 12, 2, [44, 30, 16]);
      MM6.stipple(ctx, gx - 8, sy + 7, sw + 12, 5, [0, 0, 0], 0.26);
    }
    F.drawText(ctx, heading, gx - 4, gy - 18, { color: C_CANARY });

    if (!list.length) {
      F.drawText(ctx, this.emptyText(), gx + (GRID.cols * GRID.cw) / 2, gy + 40,
        { align: 'center', color: C_CANARY });
      return;
    }

    let hover = null;
    for (let i = 0; i < Math.min(list.length, GRID.cols * GRID.rows); i++) {
      const item = list[i];
      const cx = gx + (i % GRID.cols) * GRID.cw + (GRID.cw - 4) / 2;
      const shelfY = gy + Math.floor(i / GRID.cols) * GRID.ch + GRID.ch - 22;
      const size = itemArtSize(item);
      const cy = shelfY - size / 2 - 2;

      const hit = this.ui.region(`${this.id}:it${i}`, cx - 26, cy - size / 2 - 2, 52, size + 6);
      // Hovering lights the object, the way a painted highlight would - there
      // is no cell to draw a border around.
      if (hit.hover) {
        MM6.stipple(ctx, cx - 26, cy - size / 2 - 2, 52, size + 6, [255, 232, 150], 0.30);
        hover = item;
      }
      drawItemIcon(ctx, item, cx, cy, size);
      if (hit.click) this.act(item);
    }

    // The hovered item's name and price, engraved along the bottom of the room.
    if (hover) {
      const price = this.priceFor(hover);
      const affordable = price <= partyGold(this.session) || this.mode === 'sell';
      const y = PANEL.y + PANEL.h - 24;
      MM6.stipple(ctx, PANEL.x + 8, y - 2, PANEL.w - 16, 18, [0, 0, 0], 0.62);
      F.drawText(ctx, itemName(hover), PANEL.x + 16, y + 2,
        { color: C_WHITE, maxWidth: PANEL.w - 130 });
      F.drawText(ctx, `${gold(price)} gold`, PANEL.x + PANEL.w - 16, y + 2,
        { align: 'right', color: affordable ? C_CANARY : C_RED });
    }
    this.status = '';
  }

  emptyText() {
    return {
      buy: 'The shelves are bare. Come back next week.',
      sell: 'Nothing in that pack is worth my time.',
      identify: 'Nothing here needs appraising.',
      repair: 'Nothing here is broken.',
    }[this.mode] || '';
  }

  currentList() {
    const st = this.shop;
    if (this.mode === 'buy') return (this.special ? st.specials : st.stock) || [];
    const inv = this.inventoryOf(this.character || activeMember(this.session));
    if (this.mode === 'sell') return inv;
    if (this.mode === 'identify') return inv.filter((i) => i.identified === false);
    if (this.mode === 'repair') return inv.filter((i) => i.broken);
    return [];
  }

  priceFor(item) {
    switch (this.mode) {
      case 'buy': return this.buyPrice(item);
      case 'sell': return this.sellPrice(item);
      case 'identify': return this.idPrice(item);
      case 'repair': return this.repairPrice(item);
      default: return 0;
    }
  }

  act(item) {
    const def = itemDef(item.def) || {};
    switch (this.mode) {
      case 'buy': {
        const price = this.buyPrice(item);
        if (!spend(this.session, price)) { this.say('You cannot afford that.'); return; }
        const list = this.special ? this.shop.specials : this.shop.stock;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        this.give(item);
        this.say(`Bought ${itemName(item)} for ${gold(price)} gold.`);
        this.sound('buy');
        return;
      }
      case 'sell': {
        const price = this.sellPrice(item);
        this.take(item);
        earn(this.session, price);
        this.shop.stock.push(item);
        this.say(`Sold ${itemName(item)} for ${gold(price)} gold.`);
        return;
      }
      case 'identify': {
        if ((def.tier || 1) * 4 > this.keeperSkill) {
          this.say('I have never seen its like. Try a better appraiser.');
          return;
        }
        const price = this.idPrice(item);
        if (!spend(this.session, price)) { this.say('You cannot afford the fee.'); return; }
        item.identified = true;
        this.say(`It is ${itemName(item)}.`);
        return;
      }
      case 'repair': {
        if ((def.tier || 1) * 4 > this.keeperSkill) {
          this.say('That is beyond my forge. Find a better smith.');
          return;
        }
        const price = this.repairPrice(item);
        if (!spend(this.session, price)) { this.say('You cannot afford the repair.'); return; }
        item.broken = false;
        this.say(`${itemName(item)} is whole again.`);
        return;
      }
      default:
    }
  }
}

/** One-line description for the status strip. */
function shortDesc(item) {
  const d = itemDescription(item);
  return String(d).split('\n')[0];
}

export function makeShop(session, ui, hud, opts) {
  return new ShopScreen(session, ui, hud, opts);
}

export default ShopScreen;
