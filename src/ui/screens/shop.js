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
import {
  itemName, itemValue, itemDescription, itemDef, shopStock, makeItem,
} from '../../game/items.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, rngFor,
  paintWall, paintFloor, paintShelf, paintCounter, paintClutter, vignette,
  activeMember, charName, partyGold, spend, earn, say,
  C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_LEARN,
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
 * Paint an item as a small painted object. MM6 ships a hand-drawn bitmap per
 * item; the shape families below are the same silhouettes at 8-bit scale.
 */
export function drawItemIcon(ctx, item, cx, cy, s = 28) {
  const def = itemDef(item.def) || {};
  const type = item.type || def.type || 'misc';
  const skill = def.skill || '';
  // Steel comes off the stone ramp, not grey: MM6's metal is cool and slightly
  // blue-green, and pure grey reads as plastic against the painted interiors.
  const steel = (t) => rampCss('stone', Math.max(1, t - 1));
  const wood = (t) => rampCss('wood', t);
  const brass = (t) => rampCss('gold', t);
  const half = s / 2;
  ctx.save();
  ctx.translate(cx | 0, cy | 0);

  // A blade points up: tapered point, flat edges, a lit left facet and a
  // shadowed right one so it does not read as a candle.
  const blade = (len, wdt) => {
    const top = -half + (s - len) * 0.4;
    const bot = top + len;
    poly(ctx, [0, top, wdt, top + wdt * 2, wdt, bot, -wdt, bot, -wdt, top + wdt * 2], steel(9));
    poly(ctx, [0, top, 0, bot, -wdt, bot, -wdt, top + wdt * 2], steel(13));
    ctx.fillStyle = steel(4);
    ctx.fillRect(wdt - 1, top + wdt * 2, 1, bot - top - wdt * 2);
    return { top, bot };
  };

  switch (type) {
    case 'weapon':
      if (skill === 'bow') {
        ctx.strokeStyle = wood(7); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(4, 0, half - 3, Math.PI * 0.62, Math.PI * 1.38); ctx.stroke();
        ctx.strokeStyle = '#e8dcb0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-2, -half + 3); ctx.lineTo(-2, half - 3); ctx.stroke();
      } else if (skill === 'staff') {
        ctx.fillStyle = wood(6); ctx.fillRect(-2, -half + 2, 4, s - 4);
        ctx.fillStyle = wood(9); ctx.fillRect(-2, -half + 2, 1, s - 4);
        A.gem(ctx, -3, -half + 1, 6, 'arcane');
      } else if (skill === 'axe') {
        ctx.fillStyle = wood(6); ctx.fillRect(-2, -half + 4, 4, s - 6);
        ctx.fillStyle = wood(9); ctx.fillRect(-2, -half + 4, 1, s - 6);
        // Crescent head: a bitten arc rather than a slab.
        ctx.fillStyle = steel(10);
        ctx.beginPath();
        ctx.moveTo(2, -half + 3);
        ctx.quadraticCurveTo(half + 2, -half + 6, half - 1, 3);
        ctx.quadraticCurveTo(half - 6, -half + 10, 2, -half + 9);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = steel(13);
        ctx.beginPath();
        ctx.moveTo(2, -half + 4);
        ctx.quadraticCurveTo(half - 1, -half + 7, half - 3, 0);
        ctx.quadraticCurveTo(half - 7, -half + 9, 2, -half + 8);
        ctx.closePath(); ctx.fill();
      } else if (skill === 'spear') {
        ctx.fillStyle = wood(6); ctx.fillRect(-1, -half + 8, 3, s - 8);
        poly(ctx, [-3, -half + 9, 0, -half, 3, -half + 9], steel(12));
      } else if (skill === 'mace') {
        ctx.fillStyle = wood(6); ctx.fillRect(-2, -2, 4, half + 1);
        ctx.fillStyle = steel(9);
        ctx.beginPath(); ctx.arc(0, -half + 7, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = steel(13);
        ctx.beginPath(); ctx.arc(-2, -half + 5, 2, 0, Math.PI * 2); ctx.fill();
      } else if (skill === 'dagger') {
        const b = blade(s * 0.46, 2);
        ctx.fillStyle = brass(8); ctx.fillRect(-5, b.bot, 10, 2);
        ctx.fillStyle = wood(5); ctx.fillRect(-2, b.bot + 2, 4, 6);
        ctx.fillStyle = brass(11); ctx.fillRect(-3, b.bot + 8, 6, 2);
      } else {
        const b = blade(s * 0.62, 3);
        ctx.fillStyle = brass(9); ctx.fillRect(-8, b.bot, 16, 3);
        ctx.fillStyle = brass(12); ctx.fillRect(-8, b.bot, 16, 1);
        ctx.fillStyle = wood(5); ctx.fillRect(-2, b.bot + 3, 4, 7);
        ctx.fillStyle = brass(11); ctx.fillRect(-4, b.bot + 10, 8, 3);
      }
      break;
    case 'bow':
      ctx.strokeStyle = wood(7); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(4, 0, half - 3, Math.PI * 0.62, Math.PI * 1.38); ctx.stroke();
      ctx.strokeStyle = '#e8dcb0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2, -half + 3); ctx.lineTo(-2, half - 3); ctx.stroke();
      break;
    case 'shield':
      poly(ctx, [-half + 3, -half + 3, half - 3, -half + 3, half - 4, 2, 0, half - 2, -half + 4, 2], steel(8));
      poly(ctx, [-half + 5, -half + 5, 0, -half + 5, 0, half - 6, -half + 6, 0], steel(11));
      A.gem(ctx, -3, -3, 6, 'blood');
      break;
    case 'armor': {
      // Leather is hide-brown, mail and plate are steel; the mail gets a ring
      // stipple so the two read differently at icon size.
      const leather = skill === 'leather';
      const body = leather ? wood(6) : steel(8);
      const lit = leather ? wood(9) : steel(12);
      const dk = leather ? wood(3) : steel(4);
      poly(ctx, [-half + 5, -half + 7, -4, -half + 3, 4, -half + 3, half - 5, -half + 7,
        half - 7, half - 4, -half + 7, half - 4], body);
      ctx.fillStyle = lit;
      poly(ctx, [-half + 5, -half + 7, -4, -half + 3, -1, -half + 3, -1, half - 4,
        -half + 7, half - 4], lit);
      ctx.fillStyle = dk;
      ctx.fillRect(-1, -half + 5, 2, s - 10);
      if (skill === 'chain') {
        ctx.fillStyle = dk;
        for (let yy = -half + 9; yy < half - 6; yy += 3) {
          for (let xx = -half + 8; xx < half - 8; xx += 3) {
            ctx.fillRect(xx + ((yy / 3) & 1), yy, 1, 1);
          }
        }
      }
      ctx.fillStyle = brass(9);
      ctx.fillRect(-half + 6, -half + 6, s - 12, 2);
      break;
    }
    case 'helm':
      ctx.fillStyle = steel(9);
      ctx.beginPath(); ctx.arc(0, 1, half - 4, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-half + 4, 1, s - 8, 5);
      ctx.fillStyle = steel(13);
      ctx.beginPath(); ctx.arc(-2, 0, half - 7, Math.PI * 1.1, Math.PI * 1.6); ctx.fill();
      ctx.fillStyle = steel(4); ctx.fillRect(-1, -2, 2, 8);
      break;
    case 'boots':
      poly(ctx, [-5, -half + 4, 2, -half + 4, 3, 4, half - 3, 6, half - 3, half - 4, -5, half - 4], wood(6));
      ctx.fillStyle = wood(9); ctx.fillRect(-5, -half + 4, 2, s - 8);
      break;
    case 'gauntlets':
      ctx.fillStyle = steel(8); ctx.fillRect(-6, -4, 12, 12);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = steel(10); ctx.fillRect(-6 + i * 3, -10, 2, 7); }
      ctx.fillStyle = steel(5); ctx.fillRect(-6, 6, 12, 3);
      break;
    case 'belt':
      ctx.fillStyle = wood(5); ctx.fillRect(-half + 3, -3, s - 6, 6);
      ctx.fillStyle = brass(10); ctx.fillRect(-3, -5, 7, 10);
      ctx.fillStyle = '#000000'; ctx.fillRect(-1, -3, 3, 6);
      break;
    case 'cloak':
      poly(ctx, [-6, -half + 4, 6, -half + 4, half - 3, half - 3, -half + 3, half - 3], rampCss('blood', 5));
      poly(ctx, [-6, -half + 4, 0, -half + 4, 0, half - 3, -half + 3, half - 3], rampCss('blood', 7));
      ctx.fillStyle = brass(10); ctx.fillRect(-7, -half + 3, 14, 2);
      break;
    case 'amulet':
      ctx.strokeStyle = brass(9); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -2, half - 6, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      A.gem(ctx, -4, half - 12, 8, 'arcane');
      break;
    case 'ring':
      ctx.strokeStyle = brass(10); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 2, half - 8, 0, Math.PI * 2); ctx.stroke();
      A.gem(ctx, -3, -half + 5, 6, 'water');
      break;
    case 'potion': {
      const col = POTION_CSS[def.color] || '#c02818';
      ctx.fillStyle = 'rgba(200,220,230,0.55)';
      ctx.beginPath(); ctx.arc(0, 3, half - 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 4, half - 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(240,250,255,0.7)';
      ctx.fillRect(-3, -half + 4, 6, 6);
      ctx.fillStyle = wood(5); ctx.fillRect(-3, -half + 1, 6, 4);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5; ctx.fillRect(-4, 0, 2, 5); ctx.globalAlpha = 1;
      break;
    }
    case 'scroll':
      ctx.fillStyle = rampCss('sand', 12);
      ctx.fillRect(-half + 5, -half + 6, s - 10, s - 12);
      ctx.fillStyle = rampCss('sand', 8);
      ctx.fillRect(-half + 5, -half + 6, s - 10, 3);
      ctx.fillRect(-half + 5, half - 9, s - 10, 3);
      ctx.fillStyle = '#6b5636';
      for (let i = 0; i < 4; i++) ctx.fillRect(-half + 8, -half + 12 + i * 3, s - 18, 1);
      break;
    case 'wand':
      ctx.fillStyle = wood(7); ctx.fillRect(-1, -2, 3, half + 2);
      A.gem(ctx, -4, -half + 3, 8, 'arcane');
      break;
    case 'spellbook':
      ctx.fillStyle = rampCss('blood', 4);
      ctx.fillRect(-half + 4, -half + 5, s - 8, s - 10);
      ctx.fillStyle = rampCss('sand', 12);
      ctx.fillRect(-half + 6, -half + 7, s - 12, s - 14);
      ctx.fillStyle = brass(10);
      ctx.fillRect(-half + 4, -half + 5, 3, s - 10);
      A.gem(ctx, -2, -2, 5, 'arcane');
      break;
    case 'reagent':
      ctx.fillStyle = rampCss('foliage', 8);
      ctx.beginPath(); ctx.ellipse(0, 2, half - 8, half - 5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rampCss('foliage', 12);
      ctx.fillRect(-1, -half + 4, 2, s - 10);
      break;
    case 'gem':
      A.gem(ctx, -half + 6, -half + 6, s - 12, 'ice');
      break;
    case 'gold':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = brass(9 - i);
        ctx.beginPath(); ctx.ellipse(0, 4 - i * 4, half - 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = brass(13);
        ctx.beginPath(); ctx.ellipse(-2, 2 - i * 4, half - 10, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    default:
      ctx.fillStyle = wood(6);
      ctx.beginPath(); ctx.ellipse(0, 2, half - 6, half - 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = wood(9); ctx.fillRect(-3, -half + 4, 6, 3);
  }

  ctx.restore();

  // Broken items are marked red and unidentified ones green. The inventory
  // tints the bitmap itself; here the icons sit on a painted interior, so the
  // state goes on a corner flash that cannot be lost in the backdrop.
  if (item.broken || item.identified === false) {
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
    g.fillStyle = rampCss('gold', 5);
    g.beginPath(); g.ellipse(w - 62, horizon - 6, 30, 24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('gold', 9);
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
  g.save();
  g.globalAlpha = 0.6;
  g.fillStyle = rampCss(rugRamp, 2);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 92, 17, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss(rugRamp, 4);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 74, 12, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('sand', 6);
  g.beginPath(); g.ellipse(w * 0.34, h - 86, 40, 6, 0, 0, Math.PI * 2); g.fill();
  g.restore();

  // The shopkeeper, large enough to read, behind a heavy counter.
  const cy = h - 64;
  figure(g, w * 0.70, cy + 8, 128, 'rgba(20,17,20,0.94)', 'rgba(255,214,140,0.55)', {
    hat: kind === 'magic' || kind === 'alchemy', w: 54,
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

const GRID = { x: PANEL.x + 14, y: PANEL.y + 22, cols: 6, rows: 3, cw: 72, ch: 84 };
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

  drawContent(ctx) {
    const list = this.currentList();
    const heading = {
      buy: this.special ? 'Special Stock' : 'For Sale',
      sell: `Sell from ${charName(this.character || activeMember(this.session))}`,
      identify: 'Identify - the appraiser charges by value',
      repair: 'Repair - broken items only',
    }[this.mode] || '';

    const gx = GRID.x, gy = GRID.y;
    const gw = GRID.cols * GRID.cw + 8;
    // Only plate the rows in use, so a shop with three items does not black out
    // the whole painting behind it.
    const rows = Math.max(1, Math.min(GRID.rows, Math.ceil(list.length / GRID.cols)));
    const gh = rows * GRID.ch + 22;
    plate(ctx, gx - 8, gy - 20, gw, gh, 0.58);
    F.drawText(ctx, heading, gx - 2, gy - 16, { color: C_CANARY });

    if (!list.length) {
      F.drawText(ctx, this.emptyText(), gx + gw / 2 - 8, gy + 50, { align: 'center', color: C_DIM });
      return;
    }

    for (let i = 0; i < Math.min(list.length, GRID.cols * GRID.rows); i++) {
      const item = list[i];
      const cx = gx + (i % GRID.cols) * GRID.cw;
      const cy = gy + Math.floor(i / GRID.cols) * GRID.ch;
      const price = this.priceFor(item);
      const affordable = price <= partyGold(this.session) || this.mode === 'sell';

      const hit = this.ui.region(`${this.id}:it${i}`, cx, cy, GRID.cw - 4, GRID.ch - 8);
      if (hit.hover) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#e1cd23';
        ctx.fillRect(cx, cy, GRID.cw - 4, GRID.ch - 8);
        ctx.restore();
        this.status = itemDescription ? shortDesc(item) : itemName(item);
      }
      A.bevel(ctx, cx, cy, GRID.cw - 4, GRID.ch - 8, { depth: 1, raised: !!hit.hover });

      drawItemIcon(ctx, item, cx + (GRID.cw - 4) / 2, cy + 30, 40);

      const nm = itemName(item);
      F.drawText(ctx, nm, cx + (GRID.cw - 4) / 2, cy + 52,
        { face: 'small', align: 'center', color: hit.hover ? C_GOLD : C_WHITE, maxWidth: GRID.cw - 10 });
      F.drawText(ctx, `${gold(price)}g`, cx + (GRID.cw - 4) / 2, cy + 62,
        { face: 'small', align: 'center', color: affordable ? C_CANARY : C_RED });

      if (hit.click) this.act(item);
    }

    // The hovered item's full name and price, along the bottom of the panel.
    if (this.status) {
      const y = PANEL.y + PANEL.h - 26;
      plate(ctx, PANEL.x + 10, y, PANEL.w - 20, 18, 0.7);
      F.drawText(ctx, this.status, PANEL.x + 16, y + 4, { color: C_WHITE, maxWidth: PANEL.w - 32 });
      this.status = '';
    }
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
