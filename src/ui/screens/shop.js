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
import { clamp } from '../../core/rng.js';

import * as F from '../../art/font.js';
import { priceMultipliers } from '../../game/stats.js';
import { itemName, itemValue, itemDescription, itemDef, shopStock } from '../../game/items.js';
import { makeInventory, invAdd, invRemove, giveItem } from '../../game/party.js';
import { classSkillMax, skillById } from '../../game/skills.js';
import { npcName } from '../../game/npcnames.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, rngFor, paintWall,
  paintFloor, paintShelf, paintCounter, paintClutter, vignette, activeMember, charName,
  partyGold, spend, earn, say, contactShadow, castShadow, poseSeed, paintMasonry, paintRug,
  MM6, C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED,
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
  weapon: 'Weapon Smith', armor: 'Armorer', magic: 'Magic Shop',
  alchemy: 'Alchemist', general: 'General Store',
};

/** The town generator speaks British and singular; the screen's kinds do not. */
const KIND_ALIAS = { armour: 'armor', alchemist: 'alchemy', smith: 'weapon', store: 'general' };

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
    paintMasonry(g, w - 98, horizon - 76, 90, 76, { block: 30, course: 13, seed: 39 });
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
    // Anvil on a stump, standing on the floor in front of the forge - not down
    // in the foreground where the counter buries it.
    const anY = horizon + 62;
    contactShadow(g, w - 168, anY + 2, 40, 5);
    poly(g, [w - 196, anY, w - 140, anY, w - 148, anY - 18, w - 190, anY - 18], MM6.pc([54, 40, 22]));
    poly(g, [w - 190, anY - 18, w - 148, anY - 18, w - 154, anY - 24, w - 184, anY - 24],
      MM6.pc([78, 58, 32]));
    // Horn, waist and face, each a flat with its own value.
    poly(g, [w - 182, anY - 24, w - 156, anY - 24, w - 160, anY - 38, w - 178, anY - 38],
      MM6.pc([56, 58, 62]));
    poly(g, [w - 196, anY - 38, w - 140, anY - 38, w - 136, anY - 44, w - 200, anY - 44],
      MM6.pc([92, 94, 100]));
    poly(g, [w - 200, anY - 44, w - 136, anY - 44, w - 136, anY - 48, w - 200, anY - 48],
      MM6.pc([132, 136, 144]));
    MM6.rct(g, w - 200, anY - 49, 64, 1, [190, 194, 202]);
    poly(g, [w - 136, anY - 48, w - 122, anY - 45, w - 122, anY - 42, w - 136, anY - 44],
      MM6.pc([108, 110, 116]));
  } else if (kind === 'armor') {
    // Mail hanging from pegs. Not a grey rectangle with a dot grid stamped on
    // it: a hauberk narrows at the waist and flares at the hem, the rings read
    // as short lit arcs rather than as dots, and the whole thing turns from a
    // lit left shoulder into a dark right flank.
    for (let i = 0; i < 5; i++) {
      const x = 46 + i * 62, cxm = x + 20;
      MM6.rct(g, cxm - 4, 44, 8, 10, [72, 52, 30]);          // peg
      MM6.rct(g, cxm - 4, 44, 8, 2, [128, 96, 56]);
      MM6.rct(g, cxm + 6, 56, 4, 60, [40, 36, 32]);          // shadow on the wall
      for (let y = 0; y < 64; y++) {
        const t = y / 64;
        // Shoulders, waist, flared hem.
        const half = Math.round(20 * (t < 0.14 ? 0.62 + t * 2.4
          : t < 0.55 ? 0.96 - (t - 0.14) * 0.30 : 0.84 + (t - 0.55) * 0.34));
        for (let dx = -half; dx <= half; dx++) {
          const u = (dx + half) / (2 * half || 1);
          let v = 1 - Math.abs(u - 0.30) * 1.30 - t * 0.14;
          // Riveted rings: staggered short highlights, an offset lattice.
          const rr = ((dx + ((y >> 1) & 1) * 2) % 4 === 0) && (y % 2 === 0);
          if (rr) v += 0.18;
          if ((y % 4) === 3) v -= 0.10;
          MM6.rct(g, cxm + dx, 52 + y, 1, 1,
            MM6.mix([34, 36, 40], [186, 190, 198], MM6.band(clamp(v, 0, 1), 6)));
        }
      }
      MM6.rct(g, cxm - 18, 115, 36, 2, [26, 27, 30]);        // hem shadow
    }
    // Shield on the right wall: a painted heater with a boss, a lit upper-left
    // face and a shadowed lower-right one - no keyline.
    poly(g, [w - 92, 150, w - 40, 150, w - 44, 196, w - 66, 214, w - 88, 196],
      MM6.pc([92, 26, 20]));
    poly(g, [w - 90, 152, w - 66, 152, w - 66, 208, w - 86, 194], MM6.pc([154, 48, 34]));
    poly(g, [w - 88, 154, w - 70, 154, w - 74, 176, w - 86, 170], MM6.pc([196, 78, 56]));
    MM6.rct(g, w - 92, 150, 52, 2, [214, 108, 76]);
    for (let dy = -9; dy <= 9; dy++) {
      const k = Math.round(9 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 81)));
      for (let dx = -k; dx <= k; dx++) {
        const d = Math.sqrt((dx + 3) * (dx + 3) + (dy + 3) * (dy + 3)) / 14;
        MM6.rct(g, w - 66 + dx, 176 + dy, 1, 1,
          MM6.mix([238, 210, 130], [72, 54, 18], MM6.band(clamp(d, 0, 1), 5)));
      }
    }
    // Armour stand: a torso form on a post, with a cuirass over it.
    {
      // On the open floor, not down in the foreground where the counter buries
      // the post and leaves its shadow orphaned on the boards in front.
      const stx = 232, sty = horizon + 74;
      contactShadow(g, stx + 4, sty, 26, 5);
      MM6.rct(g, stx - 3, sty - 46, 6, 46, [62, 46, 26]);
      MM6.rct(g, stx - 3, sty - 46, 2, 46, [110, 84, 48]);
      MM6.rct(g, stx - 16, sty - 3, 32, 3, [46, 34, 20]);
      for (let y = 0; y < 52; y++) {
        const t = y / 52;
        const half = Math.round(24 * (t < 0.16 ? 0.55 + t * 2.6
          : t < 0.62 ? 0.97 - (t - 0.16) * 0.44 : 0.77 + (t - 0.62) * 0.30));
        for (let dx = -half; dx <= half; dx++) {
          const u = (dx + half) / (2 * half || 1);
          let v = 1 - Math.abs(u - 0.28) * 1.24 - t * 0.10;
          if (y === 12 || y === 30) v -= 0.16;            // fluting
          if (y === 13 || y === 31) v += 0.12;
          MM6.rct(g, stx + dx, sty - 98 + y, 1, 1,
            MM6.mix([40, 42, 48], [204, 208, 216], MM6.band(clamp(v, 0, 1), 6)));
        }
      }
      MM6.rct(g, stx - 14, sty - 98, 28, 2, [230, 234, 242]);
      MM6.rct(g, stx - 20, sty - 48, 40, 2, [30, 30, 34]);
    }
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
    // Runic circle inlaid in the floor: a band of painted stone with real
    // width, built as an elliptical annulus scanline by scanline. A 2-pixel
    // stroke, even a hand-rolled one, reads as a stroke.
    const ccx = Math.round(w * 0.44), ccy = horizon + 60;
    for (const [RX, RY, th, lo, hi] of [[118, 32, 6, [74, 44, 104], [196, 146, 238]],
      [90, 24, 4, [58, 34, 84], [158, 108, 202]]]) {
      const iy = RY - th;
      for (let dy = -RY; dy <= RY; dy++) {
        const outer = Math.round(RX * Math.sqrt(Math.max(0, 1 - (dy * dy) / (RY * RY))));
        if (outer <= 0) continue;
        const inner = Math.abs(dy) >= iy ? 0
          : Math.round((RX - th * 2.4) * Math.sqrt(Math.max(0, 1 - (dy * dy) / (iy * iy))));
        // Kept inside the bright half of its own ramp: the far side of the
        // band has to still read as inlaid stone when the rug and the
        // shopkeeper hide the near side.
        const c = MM6.mix(lo, hi, 0.30 + MM6.band((dy + RY) / (2 * RY), 4) * 0.62);
        if (inner <= 0) { MM6.rct(g, ccx - outer, ccy + dy, outer * 2, 1, c); continue; }
        MM6.rct(g, ccx - outer, ccy + dy, outer - inner, 1, c);
        MM6.rct(g, ccx + inner, ccy + dy, outer - inner, 1, c);
      }
    }
    // Glyphs set around the band.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const gx2 = Math.round(ccx + Math.cos(a) * 104), gy2 = Math.round(ccy + Math.sin(a) * 28);
      MM6.rct(g, gx2 - 2, gy2 - 2, 5, 5, [46, 28, 66]);
      MM6.rct(g, gx2 - 1, gy2 - 1, 3, 3, [212, 168, 246]);
    }
  } else if (kind === 'alchemy') {
    // Shelves crowded with bottles, plus a bubbling still.
    for (let r = 0; r < 3; r++) {
      const sy = 52 + r * 40;
      paintShelf(g, 30, sy + 26, w - 130, { th: 4 });
      for (let i = 0; i < 14; i++) {
        // Painted glass: an empty shoulder, liquid below the meniscus, a cork
        // and a hard specular stripe down the lit side. A translucent rectangle
        // with a coloured square inside it is an icon, not a bottle.
        const x = Math.round(40 + i * ((w - 150) / 14));
        const bh = 14 + ((i * 7 + r * 3) % 3) * 5;
        const liq = MM6.hexRGB(['#8c2418', '#243c9c', '#a09018', '#1e8c24', '#68289c', '#2a9ca0'][(i + r) % 6]);
        const base = sy + 26, top = base - bh;
        MM6.rct(g, x + 2, top, 3, 4, [56, 70, 62]);                  // neck
        MM6.rct(g, x + 1, top - 2, 5, 3, [96, 66, 34]);              // cork
        for (let y = top + 4; y < base; y++) {
          const t = (y - top - 4) / Math.max(1, bh - 4);
          const k = Math.max(2, Math.round(1 + t * 3.2));
          const wet = t > 0.30;
          for (let dx = -k; dx <= k; dx++) {
            const u = (dx + k) / (2 * k || 1);
            const v = MM6.band(1 - Math.abs(u - 0.26) * 1.30, 4);
            MM6.rct(g, x + 3 + dx, y, 1, 1,
              wet ? MM6.mix(MM6.shade(liq, 0.5), MM6.mix(liq, [255, 255, 255], 0.35), v)
                : MM6.mix([44, 56, 52], [128, 152, 146], v));
          }
        }
        MM6.rct(g, x + 1, top + 6, 1, Math.max(2, bh - 10), [198, 222, 218]);
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
  // Rectangular, keystoned by the viewing angle - a carpet lying on boards,
  // with a border, a woven field and a fringe. An ellipse with a dotted ring
  // round it is a shape, not a rug.
  const rugRamp = kind === 'magic' ? 'arcane' : 'blood';
  paintRug(g, w * 0.34, h - 86, 26, 54, 88, rugRamp);

  // The shopkeeper, large enough to read, behind a heavy counter.
  const cy = h - 64;
  // The proprietor stands behind the counter, below the stock shelves, lit by
  // the lantern: a painted person, not a silhouette.
  figure(g, w * 0.72, cy + 10, 112, null, null, {
    // A tradesman stands with his arms folded at his own counter.
    seed: poseSeed('folded', 4127),
    hat: kind === 'magic' || kind === 'alchemy',
    cloth: kind === 'magic' ? [64, 54, 96] : kind === 'alchemy' ? [72, 88, 68] : [104, 74, 44],
    skin: [176, 132, 96], hair: [72, 48, 26], robe: kind === 'magic' || kind === 'alchemy',
    hood: false, apron: kind === 'weapon' ? [78, 58, 38] : null,
  });
  // The dark the counter sits in: one hard line and a short Bayer skirt, which
  // is the only partial coverage an indexed frame has.
  MM6.rct(g, 0, cy - 2, w, 2, [16, 11, 6]);
  castShadow(g, 0, cy - 12, w, 10, 0.5);
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
      // A helm: a domed skull banded across the turn, a raised brow and a dark
      // eye slot. Scanline-filled, so the silhouette is cut and not feathered.
      const hxc = Math.round(w * 0.16), hr = 13;
      for (let dy = -hr; dy <= 0; dy++) {
        const k = Math.round(hr * Math.sqrt(Math.max(0, 1 - (dy * dy) / (hr * hr))));
        for (let dx = -k; dx <= k; dx++) {
          const d = Math.sqrt((dx + 5) * (dx + 5) + (dy + 5) * (dy + 5)) / (hr * 1.7);
          MM6.rct(g, hxc + dx, cy - 2 + dy, 1, 1,
            MM6.mix([206, 210, 218], [44, 46, 52], MM6.band(clamp(d, 0, 1), 5)));
        }
      }
      MM6.rct(g, hxc - hr, cy - 5, hr * 2, 3, [88, 90, 96]);
      MM6.rct(g, hxc - hr, cy - 5, hr * 2, 1, [178, 182, 190]);
      MM6.rct(g, hxc - 9, cy - 9, 18, 2, [18, 18, 20]);       // eye slot
      MM6.rct(g, hxc - 1, cy - hr - 1, 2, hr, [226, 230, 238]); // comb
      MM6.rct(g, hxc - hr, cy - 2, hr * 2, 2, [26, 26, 28]);
      // Stacked gauntlets, each with a lit knuckle line.
      for (let i = 0; i < 3; i++) {
        const gy = cy - 5 - i * 4;
        MM6.rct(g, w * 0.28 + i * 3, gy, 26, 4, [72, 74, 80]);
        MM6.rct(g, w * 0.28 + i * 3, gy, 26, 1, [156, 160, 168]);
        MM6.rct(g, w * 0.28 + i * 3, gy + 3, 26, 1, [30, 30, 34]);
      }
    },
    magic: () => {
      // A crystal on a stand, throwing a little light on the counter.
      const mx = Math.round(w * 0.18);
      MM6.rct(g, mx - 8, cy - 6, 16, 6, [124, 96, 34]);
      MM6.rct(g, mx - 8, cy - 6, 16, 1, [204, 168, 82]);
      // Facets, each a flat with its own value: a gem is not one colour.
      poly(g, [mx, cy - 32, mx + 9, cy - 16, mx, cy - 6], MM6.pc([132, 78, 176]));
      poly(g, [mx, cy - 32, mx - 9, cy - 16, mx, cy - 6], MM6.pc([196, 138, 236]));
      poly(g, [mx, cy - 32, mx - 4, cy - 18, mx, cy - 14], MM6.pc([230, 196, 250]));
      MM6.rct(g, mx - 2, cy - 28, 2, 6, [246, 232, 255]);
      glow(g, mx, cy - 16, 76, '#c078e8', 0.7);
      MM6.rct(g, w * 0.32, cy - 5, 30, 5, MM6.pc([228, 214, 176]));
      MM6.rct(g, w * 0.32, cy - 5, 30, 1, MM6.pc([248, 240, 214]));
    },
    alchemy: () => {
      // A row of filled flasks and a mortar.
      for (let i = 0; i < 6; i++) {
        const x = Math.round(w * 0.10 + i * 15);
        const liq = MM6.hexRGB(['#8c2418', '#243c9c', '#a09018', '#1e8c24', '#68289c', '#2a9ca0'][i]);
        for (let y = 0; y < 16; y++) {
          const wet = y > 6;
          for (let dx = 0; dx < 9; dx++) {
            const u = dx / 8;
            const v = MM6.band(1 - Math.abs(u - 0.26) * 1.30, 4);
            MM6.rct(g, x + dx, cy - 16 + y, 1, 1,
              wet ? MM6.mix(MM6.shade(liq, 0.5), MM6.mix(liq, [255, 255, 255], 0.35), v)
                : MM6.mix([44, 56, 52], [132, 156, 150], v));
          }
        }
        MM6.rct(g, x + 1, cy - 13, 1, 11, [198, 222, 218]);
        MM6.rct(g, x + 2, cy - 19, 5, 3, [96, 66, 34]);
        MM6.rct(g, x + 2, cy - 19, 5, 1, [148, 108, 58]);
      }
      // A mortar: a turned stone bowl with a lit rim and a shadowed foot.
      const mox = Math.round(w * 0.34);
      for (let dx = -13; dx <= 13; dx++) {
        const v = MM6.band(1 - Math.abs(dx / 13 - 0.30) * 1.30, 5);
        MM6.rct(g, mox + dx, cy - 5, 1, 5, MM6.mix([48, 46, 42], [172, 168, 158], v));
      }
      MM6.ellip(g, mox, cy - 6, 13, 3, [96, 94, 88]);
      MM6.ellip(g, mox, cy - 7, 10, 2, [38, 37, 34]);
      MM6.rct(g, mox - 13, cy - 8, 26, 1, [198, 194, 182]);
      MM6.rct(g, mox + 6, cy - 14, 2, 8, [148, 144, 134]);   // pestle
    },
    general: () => {
      // Scales, a sack and a ledger.
      const sx2 = Math.round(w * 0.16);
      MM6.rct(g, sx2, cy - 22, 2, 22, [124, 96, 34]);
      MM6.rct(g, sx2, cy - 22, 1, 22, [204, 168, 82]);
      MM6.rct(g, sx2 - 14, cy - 22, 30, 2, [124, 96, 34]);
      MM6.rct(g, sx2 - 14, cy - 22, 30, 1, [204, 168, 82]);
      for (const ox of [-14, 14]) {
        MM6.rct(g, sx2 + ox, cy - 20, 1, 4, [92, 72, 28]);
        poly(g, [sx2 + ox - 6, cy - 16, sx2 + ox + 6, cy - 16, sx2 + ox, cy - 11], MM6.pc([170, 138, 62]));
        MM6.rct(g, sx2 + ox - 6, cy - 16, 12, 1, [226, 194, 108]);
      }
      // A slumped sack of grain.
      const gx2 = Math.round(w * 0.30);
      for (let dy = -8; dy <= 0; dy++) {
        const k = Math.round(13 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 64)));
        for (let dx = -k; dx <= k; dx++) {
          const v = MM6.band(1 - Math.abs((dx + k) / (2 * k || 1) - 0.30) * 1.25 + dy / 24, 5);
          MM6.rct(g, gx2 + dx, cy - 1 + dy, 1, 1, MM6.mix([60, 48, 28], [204, 180, 130], v));
        }
      }
      MM6.rct(g, gx2 - 4, cy - 9, 8, 1, [226, 208, 160]);
      // A ledger, spine toward the room.
      MM6.rct(g, w * 0.38, cy - 6, 24, 6, MM6.pc([104, 30, 24]));
      MM6.rct(g, w * 0.38, cy - 6, 24, 1, MM6.pc([158, 58, 44]));
      MM6.rct(g, w * 0.38, cy - 4, 24, 1, MM6.pc([206, 196, 168]));
    },
  };
  (props[kind] || props.general)();

  paintClutter(g, 14, h - 4, 'barrel', 36);
  paintClutter(g, 54, h - 2, 'crate', 26);
  paintClutter(g, w - 52, h - 2, 'sack', 30);

  // Lantern hanging over the counter on a chain: a brass box with a flame in
  // it, and light on the brass itself. Nothing is painted onto the wall behind
  // a lamp that hangs in the middle of a room.
  const lx = Math.round(w * 0.30), ly = 62;
  for (let yy = 0; yy < ly - 10; yy += 4) {
    MM6.rct(g, lx, yy, 2, 3, [52, 48, 42]);
    MM6.rct(g, lx, yy, 1, 3, [104, 96, 82]);
  }
  MM6.rct(g, lx - 9, ly - 11, 18, 3, [110, 84, 30]);
  MM6.rct(g, lx - 9, ly - 11, 18, 1, [196, 160, 78]);
  for (let i = 0; i < 14; i++) {
    const v = MM6.band(1 - Math.abs(i / 13 - 0.28) * 1.35, 4);
    MM6.rct(g, lx - 7 + i, ly - 8, 1, 16, MM6.mix([46, 32, 10], [190, 154, 76], v));
  }
  MM6.rct(g, lx - 5, ly - 6, 10, 12, [20, 14, 8]);
  MM6.flame(g, lx, ly + 5, 7, 11, 4);
  MM6.rct(g, lx - 9, ly + 8, 18, 3, [128, 98, 36]);
  MM6.rct(g, lx - 9, ly + 8, 18, 1, [206, 170, 86]);
  glow(g, lx, ly, 62, '#ffc860', 0.7);

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
    const rawKind = (opts.shop && opts.shop.kind) || opts.kind || 'weapon';
    this.kind = KIND_TITLE[rawKind] ? rawKind : (KIND_ALIAS[rawKind] || 'general');
    this.id = `shop:${this.kind}`;
    this.tier = opts.tier || (opts.shop && opts.shop.tier) || 2;
    this.shopId = opts.id || (opts.shop && opts.shop.id)
      || `${this.kind}_shop:${(opts.shop && opts.shop.name) || ''}`;
    // The establishment's painted name from the town generator, when it has one.
    this.title = (opts.shop && opts.shop.name) || opts.title || KIND_TITLE[this.kind] || 'Shop';
    this.town = opts.town || null;
    // priceMultipliers wants a *number*; the activation payload hands the whole
    // town record here, and multiplying by an object is where the NaN gold came
    // from. Reduce whatever arrived to a sane factor.
    const t = opts.townFactor !== undefined ? opts.townFactor : opts.town;
    this.townFactor = typeof t === 'number' && Number.isFinite(t) ? t
      : (t && Number.isFinite(t.priceFactor)) ? t.priceFactor
        : ({ village: 1.1, town: 1, city: 0.9 })[(t && t.size) || ''] || 1;
    const krand = rngFor(`keeper:${this.shopId}`);
    const keeperSex = krand.bool() ? 'm' : 'f';
    this.keeper = opts.keeper || {
      name: npcName(krand, keeperSex, { epithet: false }),
      title: KIND_TITLE[this.kind],
      portraitSeed: krand.int(0, 0x7fffffff),
      sex: keeperSex,
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
    return priceMultipliers(ch || {}, this.townFactor);
  }

  buyPrice(item) { return Math.max(1, Math.round(itemValue(item) * this.merchant.buy)); }
  sellPrice(item) { return Math.max(1, Math.round(itemValue(item) * this.merchant.sell)); }
  idPrice(item) { return Math.max(1, Math.round(itemValue(item) * 0.1 * this.merchant.buy)); }
  repairPrice(item) { return Math.max(1, Math.round(itemValue(item) * 0.25 * this.merchant.buy)); }

  /** The shopkeeper's own skill gates what he will identify or repair. */
  get keeperSkill() { return this.keeper.skill || this.tier * 4; }

  // --- inventory access ----------------------------------------------------

  /** The character's bag in party.js's grid form; a legacy array is rebuilt. */
  inventoryOf(ch) {
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

  /** Deliver a bought item; the active pack first, then anyone with room. */
  give(item) {
    const ch = this.character || activeMember(this.session);
    if (ch && invAdd(this.inventoryOf(ch), item)) return true;
    return !!giveItem(this.session.party, item);
  }

  take(item) {
    const ch = this.character || activeMember(this.session);
    if (!ch) return null;
    return invRemove(this.inventoryOf(ch), item.uid);
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

  teachSkillId() {
    return { weapon: 'repair', armor: 'leather', magic: 'identify', alchemy: 'perception', general: 'merchant' }[this.kind] || 'merchant';
  }

  /** The taught skill's real name, so the option never promises a skill that is not the one taught. */
  teachSkillName() {
    const def = skillById(this.teachSkillId());
    return def ? def.name : 'Merchant';
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
    // The class gate is the rules engine's, not the shopkeeper's generosity.
    if (classSkillMax(ch.class, skill) <= 0) {
      this.say(`${charName(ch)} could never learn ${this.teachSkillName()}.`);
      return;
    }
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
      MM6.rct(ctx, gx - 8, sy + 4, sw + 12, 1, [64, 44, 24]);
      MM6.rct(ctx, gx - 8, sy + 5, sw + 12, 2, [22, 15, 8]);
      // The shadow the nose throws, as three solid steps of falling darkness.
      // This one runs every frame rather than at bake time, so it cannot read
      // the plate back the way the baked painters do - but a flat stipple here
      // lands as a period-2 dotted rule, which is the single most CSS-looking
      // thing this screen used to do, so solid banding it is.
      const SH = [[30, 22, 14], [44, 34, 22], [58, 46, 32]];
      for (let i = 0; i < SH.length; i++) {
        MM6.rct(ctx, gx - 8, sy + 7 + i * 2, sw + 12, 2, SH[i]);
      }
    }
    F.drawText(ctx, heading, gx - 4, gy - 18, { color: C_CANARY });
    // The establishment's own name, engraved along the top of the room.
    F.drawText(ctx, this.title, gx + GRID.cols * GRID.cw + 4, gy - 18,
      { align: 'right', color: C_GOLD, maxWidth: 220 });

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
    const items = (inv && inv.items) || [];
    if (this.mode === 'sell') return items;
    if (this.mode === 'identify') return items.filter((i) => i.identified === false);
    if (this.mode === 'repair') return items.filter((i) => i.broken);
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
        if (!Number.isFinite(price) || price <= 0) { this.say('The keeper cannot price that.'); return; }
        if (partyGold(this.session) < price) { this.say('You cannot afford that.'); return; }
        // Deliver first, pay second: gold only leaves the purse for an item
        // that actually made it into a pack.
        if (!this.give(item)) { this.say('Your packs are full.'); return; }
        spend(this.session, price);
        const list = this.special ? this.shop.specials : this.shop.stock;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        this.say(`Bought ${itemName(item)} for ${gold(price)} gold.`);
        this.sound('buy');
        return;
      }
      case 'sell': {
        const price = this.sellPrice(item);
        if (!this.take(item)) { this.say('That is not yours to sell.'); return; }
        earn(this.session, price);
        this.shop.stock.push(item);
        this.say(`Sold ${itemName(item)} for ${gold(price)} gold.`);
        this.sound('sell');
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
