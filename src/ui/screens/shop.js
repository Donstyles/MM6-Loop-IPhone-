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
      const top = 128 - len;
      // A hung blade: a shadow on the plaster behind it, a fullered steel face
      // with a lit edge and a dark flat, a wrapped grip and a brass quillon.
      // No keyline anywhere - MM6 art has no outlines at all.
      MM6.rct(g, x + 4, top + 3, 3, len - 4, [46, 40, 32]);
      const bw = 6;
      for (let y = 0; y < len - 16; y++) {
        const t = y / (len - 16);
        const k = Math.max(1, Math.round((bw / 2) * (t < 0.12 ? t / 0.12 : 1 - t * 0.10)));
        for (let dx = -k; dx <= k; dx++) {
          const u = (dx + k) / (2 * k || 1);
          // Fuller down the middle, bright bevel on the left, dark on the right.
          const v = Math.abs(u - 0.5) < 0.18 ? 0.34 : 1 - Math.abs(u - 0.24) * 1.20;
          MM6.rct(g, x + dx, top + y, 1, 1, MM6.mix([42, 44, 48], [216, 220, 226], MM6.band(v, 5)));
        }
      }
      // Quillons and grip.
      MM6.rct(g, x - 5, top + len - 16, 12, 3, [126, 96, 34]);
      MM6.rct(g, x - 5, top + len - 16, 12, 1, [206, 168, 82]);
      for (let y = 0; y < 10; y++) {
        MM6.rct(g, x - 2, top + len - 13 + y, 4, 1, (y & 1) ? [62, 40, 22] : [96, 66, 36]);
        MM6.rct(g, x - 2, top + len - 13 + y, 1, 1, [128, 94, 54]);
      }
      MM6.rct(g, x - 3, top + len - 3, 6, 3, [138, 106, 40]);
      MM6.rct(g, x - 3, top + len - 3, 6, 1, [214, 176, 88]);
    }
    // Forge on the right: a stone hood, a black mouth, a coal bed and light on
    // the masonry immediately around it.
    for (let y = 0; y < 76; y++) {
      const row = Math.floor(y / 13);
      for (let x = 0; x < 90; x++) {
        const bx = (x + (row & 1) * 15) % 30;
        const joint = bx < 2 || (y % 13) < 2;
        const blk = hash2(Math.floor((x + (row & 1) * 15) / 30), row, 39);
        MM6.rct(g, w - 98 + x, horizon - 76 + y, 1, 1,
          MM6.mix([28, 26, 22], [156, 150, 138], MM6.band(joint ? 0.16 : 0.40 + blk * 0.28, 6)));
      }
    }
    g.fillStyle = '#100600';
    g.fillRect(w - 86, horizon - 56, 62, 44);
    MM6.rct(g, w - 86, horizon - 56, 62, 3, [6, 4, 2]);
    // Coal bed: banded, hottest at the middle, and a couple of tongues over it.
    for (let i = 0; i < 5; i++) {
      const k = Math.max(4, 26 - i * 4);
      MM6.rct(g, w - 55 - k, horizon - 15 - i, k * 2, 1,
        [[92, 22, 8], [148, 40, 12], [206, 76, 20], [244, 132, 36], [255, 190, 92]][i]);
    }
    for (let i = 0; i < 5; i++) MM6.flame(g, w - 72 + i * 9, horizon - 18, 9, 13 + (i % 3) * 5, i * 2.3);
    glow(g, w - 55, horizon - 26, 170, '#ff7010', 1.0);
    // Anvil, on a stump, with the dark it sits in.
    contactShadow(g, 145, h - 24, 40, 5);
    poly(g, [116, h - 26, 172, h - 26, 164, h - 44, 122, h - 44], MM6.pc([54, 40, 22]));
    poly(g, [122, h - 44, 164, h - 44, 158, h - 50, 128, h - 50], MM6.pc([74, 56, 32]));
    // Horn, waist and face, each a flat with its own value.
    poly(g, [130, h - 50, 156, h - 50, 152, h - 64, 134, h - 64], MM6.pc([56, 58, 62]));
    poly(g, [116, h - 64, 172, h - 64, 176, h - 70, 112, h - 70], MM6.pc([88, 90, 96]));
    poly(g, [112, h - 70, 176, h - 70, 176, h - 74, 112, h - 74], MM6.pc([126, 130, 138]));
    MM6.rct(g, 112, h - 75, 64, 1, [186, 190, 198]);
    poly(g, [176, h - 74, 190, h - 71, 190, h - 68, 176, h - 70], MM6.pc([104, 106, 112]));
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
    // Arched niches with orbs on plinths.
    for (let i = 0; i < 4; i++) {
      const x = 44 + i * 96, cxn = x + 29;
      // The niche is a hole in the wall: a dark recess, a lit soffit where the
      // arch turns over, and a shadowed jamb on the right.
      MM6.rct(g, x, 44, 58, 84, MM6.pc([26, 24, 30]));
      for (let dy = -29; dy <= 0; dy++) {
        const k = Math.round(29 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (29 * 29))));
        if (k <= 0) continue;
        MM6.rct(g, cxn - k, 44 + dy, k * 2, 1, MM6.pc([26, 24, 30]));
        MM6.rct(g, cxn - k, 44 + dy, 2, 1, MM6.pc([64, 60, 70]));
      }
      MM6.rct(g, x, 44, 2, 84, [64, 60, 70]);
      MM6.rct(g, x + 56, 44, 2, 84, [14, 13, 17]);
      // Plinth.
      MM6.rct(g, x - 2, 118, 62, 5, [92, 88, 82]);
      MM6.rct(g, x - 2, 118, 62, 1, [148, 144, 134]);
      MM6.rct(g, x - 2, 123, 62, 2, [30, 28, 26]);
      // Orb: a lit sphere, banded, with a hard specular and a dark underside.
      const col = ['#c078e8', '#40d8d8', '#e1cd23', '#40f460'][i];
      const oc = MM6.hexRGB(col);
      const orr = 13;
      for (let dy = -orr; dy <= orr; dy++) {
        const k = Math.round(orr * Math.sqrt(Math.max(0, 1 - (dy * dy) / (orr * orr))));
        for (let dx = -k; dx <= k; dx++) {
          const d = Math.sqrt((dx + 4) * (dx + 4) + (dy + 4) * (dy + 4)) / (orr * 1.6);
          MM6.rct(g, cxn + dx, 104 + dy, 1, 1,
            MM6.mix(MM6.mix([255, 255, 240], oc, MM6.band(clamp(d, 0, 1), 4)), [12, 10, 16],
              MM6.band(clamp(d - 0.55, 0, 1) * 1.6, 4)));
        }
      }
      glow(g, cxn, 104, 60, col, 0.75);
    }
    // Runic circle inlaid in the floor: a band of painted stone, not a stroke.
    const ccx = w / 2, ccy = horizon + 66;
    for (const [RX, RY, lo, hi] of [[120, 34, [58, 34, 84], [172, 112, 214]],
      [92, 26, [46, 28, 70], [138, 88, 176]]]) {
      for (let dy = -RY; dy <= RY; dy++) {
        const k = RX * Math.sqrt(Math.max(0, 1 - (dy * dy) / (RY * RY)));
        const k0 = RX * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((RY - 3) * (RY - 3))));
        const outer = Math.round(k), inner = Math.round(Math.min(k - 2, k0));
        if (outer <= 0) continue;
        for (const sgn of [-1, 1]) {
          const x0 = sgn < 0 ? ccx - outer : ccx + Math.max(0, inner);
          const wd = Math.max(1, outer - Math.max(0, inner));
          MM6.rct(g, Math.round(x0), Math.round(ccy + dy), wd, 1, MM6.mix(lo, hi, MM6.band((dy + RY) / (2 * RY), 4)));
        }
      }
    }
    // Glyphs set around the band.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      MM6.rct(g, Math.round(ccx + Math.cos(a) * 106) - 2, Math.round(ccy + Math.sin(a) * 30) - 2, 4, 4,
        [196, 140, 236]);
    }
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
    // Still on the right: a modelled copper belly with a lit shoulder and a
    // dark underside, a condenser pipe, and a small flame under it.
    const sx0 = w - 62, sy0 = horizon - 6;
    for (let dy = -24; dy <= 24; dy++) {
      const k = Math.round(30 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (24 * 24))));
      if (k <= 0) continue;
      const t = MM6.band((dy + 24) / 48, 6);
      MM6.rct(g, sx0 - k, sy0 + dy, k * 2, 1, MM6.mix([148, 96, 40], [58, 34, 14], t));
      MM6.rct(g, sx0 - k, sy0 + dy, Math.max(1, Math.round(k * 0.35)), 1,
        MM6.mix([200, 148, 74], [92, 60, 26], t));
    }
    MM6.ellip(g, sx0 - 9, sy0 - 13, 11, 6, [226, 178, 96]);
    MM6.rct(g, sx0 - 2, horizon - 48, 5, 24, [154, 116, 52]);
    MM6.rct(g, sx0 - 2, horizon - 48, 1, 24, [212, 168, 88]);
    MM6.rct(g, sx0 - 2, horizon - 48, 28, 4, [154, 116, 52]);
    MM6.flame(g, sx0, sy0 + 26, 14, 18, 3);
  } else {
    // General store: sacks, barrels, hanging herbs, a crowded shelf.
    paintShelf(g, 36, 96, w - 160, { th: 5 });
    paintShelf(g, 36, 140, w - 160, { th: 5 });
    for (let i = 0; i < 16; i++) {
      const x = Math.round(44 + i * ((w - 180) / 16));
      const kind2 = i % 3;
      if (kind2 === 0) {
        // A crock: a lit shoulder and a dark flank.
        for (let dx = 0; dx < 12; dx++) {
          const v = MM6.band(1 - Math.abs(dx / 11 - 0.28) * 1.35, 5);
          MM6.rct(g, x + dx, 78, 1, 18, MM6.mix([54, 40, 24], [196, 164, 112], v));
        }
        MM6.rct(g, x - 1, 78, 14, 2, [150, 124, 84]);
        MM6.rct(g, x - 1, 78, 14, 1, [216, 190, 140]);
      } else if (kind2 === 1) {
        // A round wheel of cheese, painted as a sphere on a shelf.
        for (let dy = -7; dy <= 7; dy++) {
          const k = Math.round(7 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 49)));
          for (let dx = -k; dx <= k; dx++) {
            const d = Math.sqrt((dx + 2) * (dx + 2) + (dy + 2) * (dy + 2)) / 11;
            MM6.rct(g, x + 6 + dx, 88 + dy, 1, 1,
              MM6.mix([228, 202, 130], [76, 56, 28], MM6.band(clamp(d, 0, 1), 5)));
          }
        }
      } else {
        for (let dx = 0; dx < 10; dx++) {
          const v = MM6.band(1 - Math.abs(dx / 9 - 0.30) * 1.30, 5);
          MM6.rct(g, x + dx, 82, 1, 14, MM6.mix([44, 32, 18], [166, 128, 82], v));
        }
      }
      // Sacks lined up on the lower shelf.
      for (let dx = 0; dx < 9; dx++) {
        const v = MM6.band(1 - Math.abs(dx / 8 - 0.30) * 1.28, 5);
        MM6.rct(g, x + 2 + dx, 122, 1, 18, MM6.mix([62, 50, 30], [206, 182, 132], v));
      }
      MM6.rct(g, x + 3, 122, 6, 1, [230, 212, 168]);
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
  // A woven rug: a bordered field with a repeating figure and a fringe, laid
  // in perspective. Not one flat ellipse.
  const rugRamp = kind === 'magic' ? 'arcane' : 'blood';
  const rx0 = Math.round(w * 0.34), ry0 = h - 86;
  const rw = 96, rh = 20;
  for (let dy = -rh; dy <= rh; dy++) {
    const k = Math.round(rw * Math.sqrt(Math.max(0, 1 - (dy * dy) / (rh * rh))));
    const t = (dy + rh) / (rh * 2);
    MM6.rct(g, rx0 - k, ry0 + dy, k * 2, 1, rampCss(rugRamp, 2 + Math.round(t * 2)));
    // Border band and centre field.
    if (k > 22) {
      MM6.rct(g, rx0 - k + 8, ry0 + dy, k * 2 - 16, 1, rampCss(rugRamp, 4 + Math.round(t * 2)));
      MM6.rct(g, rx0 - k + 20, ry0 + dy, k * 2 - 40, 1, rampCss('sand', 4 + Math.round(t * 2)));
    }
    // Woven figure: a row of lozenges every few courses.
    if (k > 30 && (dy + rh) % 6 === 3) {
      for (let x = -k + 26; x < k - 26; x += 14) {
        MM6.rct(g, rx0 + x, ry0 + dy, 5, 1, rampCss(rugRamp, 7));
      }
    }
  }
  // Fringe along the near edge.
  for (let x = -rw + 6; x < rw - 6; x += 4) MM6.rct(g, rx0 + x, ry0 + rh, 2, 3, rampCss('sand', 8));

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
  // The dark the counter sits in: one hard line and a short Bayer skirt, which
  // is the only partial coverage an indexed frame has.
  MM6.rct(g, 0, cy - 2, w, 2, [16, 11, 6]);
  for (let i = 0; i < 8; i++) MM6.stipple(g, 0, cy - 10 + i, w, 1, [16, 11, 6], 0.10 + i * 0.07);
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
