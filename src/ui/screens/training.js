// ---------------------------------------------------------------------------
// The training hall.
//
// MM6 does not level you up when the experience arrives - you must walk into a
// training hall and buy the level, and each hall has a cap on how far it will
// take you. The screen therefore has to show, per character: level, experience,
// what the next level needs, and what the trainer charges.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp, hash2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import * as M from './mm6art.js';
import { xpForLevel, trainingCost, maxHP, maxSP, CLASSES } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, paintWall, paintFloor,
  paintShelf, paintClutter, vignette, members, charName, partyGold, spend, contactShadow, poseSeed,
  C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_GREEN,
} from './dialogue.js';
import { LevelUpScreen } from './levelup.js';

/** Sand floor, weapon racks, straw dummies, two sparring figures. */
export function paintTrainingInterior(g, w, h) {
  const horizon = Math.round(h * 0.52);
  paintWall(g, 0, 0, w, horizon, { ramp: 'plaster', lo: 0.10, hi: 0.40, course: 26, seed: 63 });
  // Sand, but trodden and shadowed - the bright end of the ramp reads as snow.
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'dirt', seed: 71 });

  // High windows throwing light bars onto the sand.
  for (let i = 0; i < 3; i++) {
    const wx = 54 + i * 140;
    // Reveal, then glazing: banded daylight with old green glass at the edges.
    M.rct(g, wx - 5, 17, 58, 62, [58, 42, 24]);
    M.rct(g, wx - 5, 17, 58, 2, [124, 94, 56]);
    M.rct(g, wx - 5, 77, 58, 2, [26, 18, 10]);
    for (let y = 0; y < 52; y++) {
      const t = M.band(y / 52, 6);
      for (let x = 0; x < 48; x++) {
        const edge = Math.min(x, 47 - x, y, 51 - y) < 3 ? 0.80 : 1;
        M.rct(g, wx + x, 22 + y, 1, 1,
          M.shade(M.mix([222, 236, 248], [150, 180, 208], t), edge));
      }
    }
    M.rct(g, wx + 22, 22, 3, 52, [64, 48, 28]);
    M.rct(g, wx, 46, 48, 3, [64, 48, 28]);
    M.rct(g, wx + 22, 22, 1, 52, [122, 96, 58]);
    M.rct(g, wx, 46, 48, 1, [122, 96, 58]);
    glow(g, wx + 24, 48, 120, '#ffe8b0', 0.45);
    // The patch the window throws on the sand, keystoned and banded. No shaft:
    // MM6 has no volumetric light anywhere in the game.
    // Dim and narrow: litPatch blends additively, so a full-value daylight
    // colour here burns the boards out into three white spotlights.
    M.litPatch(g, wx + 30, horizon, 16, h - 4, 34, '#8c7448', 3);
  }

  // Weapon rack on the right wall: a pegged board with real weapons on it.
  paintShelf(g, w - 132, 128, 110, { th: 5 });
  for (let i = 0; i < 6; i++) {
    const x = w - 124 + i * 18;
    M.rct(g, x + 2, 86, 3, 42, [42, 30, 18]);              // shadow on the plaster
    // Haft, with a lit side.
    for (let y = 84; y < 128; y++) {
      M.rct(g, x, y, 3, 1, [72, 50, 28]);
      M.rct(g, x, y, 1, 1, [126, 94, 54]);
    }
    if (i % 2) {
      // Axe head: a lit bevel, a dark flat and a socket.
      poly(g, [x - 4, 76, x + 3, 74, x + 7, 80, x + 3, 88, x - 4, 86], M.pc([160, 164, 172]));
      poly(g, [x - 4, 78, x + 1, 77, x + 3, 82, x + 1, 86, x - 4, 85], M.pc([96, 100, 108]));
      M.rct(g, x - 5, 78, 1, 8, [214, 218, 226]);
      M.rct(g, x, 74, 3, 14, [58, 42, 24]);
    } else {
      // Spear head: a leaf blade with a raised midrib.
      poly(g, [x + 1, 68, x + 5, 78, x + 1, 86, x - 3, 78], M.pc([104, 108, 116]));
      poly(g, [x + 1, 69, x + 3, 78, x + 1, 84, x, 78], M.pc([196, 200, 208]));
      M.rct(g, x - 1, 84, 5, 3, [138, 106, 40]);
    }
  }

  // Straw practice dummies: a post, a bound straw body with visible binding,
  // a crossbar for arms and a burlap head, all sitting in their own shadow.
  for (const [dx, scale] of [[96, 1], [w - 190, 0.86]]) {
    const base = Math.round(horizon + 52 * scale);
    contactShadow(g, dx + 4, base + 2, 26 * scale, 5);
    M.rct(g, dx - 2, base - 74 * scale, 5, 74 * scale, [58, 42, 24]);
    M.rct(g, dx - 2, base - 74 * scale, 1, 74 * scale, [110, 82, 48]);
    // Crossbar arms.
    M.rct(g, dx - 27 * scale, base - 63 * scale, 54 * scale, 5, [66, 48, 26]);
    M.rct(g, dx - 27 * scale, base - 63 * scale, 54 * scale, 1, [124, 94, 54]);
    // Straw torso: vertical stalks, lit from the upper left, bound twice.
    const tw = Math.round(21 * scale), th = Math.round(30 * scale);
    for (let x = -tw; x <= tw; x++) {
      const u = (x + tw) / (2 * tw);
      const v = M.band(1 - Math.abs(u - 0.30) * 1.30, 5);
      for (let y = 0; y < th; y++) {
        const stalk = hash2(x, Math.floor(y / 4), 51) * 0.16 - 0.08;
        M.rct(g, dx + x, base - 66 * scale + y, 1, 1,
          M.mix([70, 56, 26], [224, 198, 128], clamp(v + stalk, 0, 1)));
      }
    }
    for (const by of [0.24, 0.68]) {
      const yy = Math.round(base - 66 * scale + th * by);
      M.rct(g, dx - tw, yy, tw * 2, 2, [96, 72, 34]);
      M.rct(g, dx - tw, yy, tw * 2, 1, [156, 122, 62]);
    }
    // Head.
    const hr = Math.round(11 * scale);
    for (let dy = -hr; dy <= hr; dy++) {
      const k = Math.round(hr * Math.sqrt(Math.max(0, 1 - (dy * dy) / (hr * hr))));
      for (let ddx = -k; ddx <= k; ddx++) {
        const d = Math.sqrt((ddx + 4) * (ddx + 4) + (dy + 4) * (dy + 4)) / (hr * 1.8);
        M.rct(g, dx + ddx, base - 78 * scale + dy, 1, 1,
          M.mix([214, 190, 140], [64, 50, 28], M.band(clamp(d, 0, 1), 5)));
      }
    }
    M.rct(g, dx - hr, base - 78 * scale + Math.round(hr * 0.4), hr * 2, 2, [92, 70, 36]);
  }

  // Two sparring figures in the middle distance, with a sword between them.
  figure(g, w * 0.42, horizon + 72, 92, null, null, { seed: poseSeed('reach', 1741) });
  figure(g, w * 0.58, horizon + 78, 98, null, null, { seed: poseSeed('lean', 903) });
  // The blade: a lit edge over a dark flat, drawn as two offset bars.
  M.lineH(g, w * 0.46, horizon + 30, w * 0.54, horizon + 18, M.pc([64, 66, 72]), 3);
  M.lineH(g, w * 0.46, horizon + 29, w * 0.54, horizon + 17, M.pc([198, 202, 210]), 1);

  paintClutter(g, 18, h - 6, 'barrel', 32);
  paintClutter(g, w - 52, h - 4, 'crate', 28);
  vignette(g, w, h);
}

export class TrainingScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'training';
    this.maxLevel = opts.maxLevel || 10;
    this.title = opts.title || `Training Hall`;
    this.keeper = opts.keeper || { name: 'Master Dunmar', title: 'Trainer', portraitSeed: 33, sex: 'm', klass: 'knight' };
    this.factor = opts.factor || 1;
  }

  // --- rules ---------------------------------------------------------------

  levelOf(ch) { return Math.max(1, ch.level | 0 || 1); }

  xpOf(ch) { return Math.max(0, ch.xp | 0); }

  needFor(ch) { return this.safe(() => xpForLevel(this.levelOf(ch) + 1), (this.levelOf(ch) + 1) * 1000); }

  costFor(ch) {
    const base = this.safe(() => trainingCost(this.levelOf(ch)), this.levelOf(ch) * 100);
    return Math.max(1, Math.round(base * this.factor));
  }

  canTrain(ch) {
    if (this.levelOf(ch) >= this.maxLevel) return 'cap';
    if (this.xpOf(ch) < this.needFor(ch)) return 'xp';
    if (partyGold(this.session) < this.costFor(ch)) return 'gold';
    return 'ok';
  }

  train(ch) {
    const why = this.canTrain(ch);
    if (why === 'cap') { this.say(`I can teach ${charName(ch)} no more. Find a greater hall.`); return; }
    if (why === 'xp') {
      this.say(`${charName(ch)} needs ${gold(this.needFor(ch) - this.xpOf(ch))} more experience.`);
      return;
    }
    const cost = this.costFor(ch);
    if (!spend(this.session, cost)) { this.say(`Training costs ${gold(cost)} gold.`); return; }

    const hpBefore = this.safe(() => maxHP(ch), ch.maxHP || 0);
    const spBefore = this.safe(() => maxSP(ch), ch.maxSP || 0);
    ch.level = this.levelOf(ch) + 1;
    ch.skillPoints = (ch.skillPoints | 0) + 5;
    const hpAfter = this.safe(() => maxHP(ch), hpBefore + 5);
    const spAfter = this.safe(() => maxSP(ch), spBefore);
    ch.maxHP = hpAfter;
    ch.maxSP = spAfter;
    ch.hp = hpAfter;
    ch.sp = spAfter;

    this.say(`${charName(ch)} is now level ${ch.level}.`);
    this.sound('levelup');
    this.push(new LevelUpScreen(this.session, this.ui, this.hud, {
      character: ch,
      level: ch.level,
      hp: Math.max(0, hpAfter - hpBefore),
      sp: Math.max(0, spAfter - spBefore),
      skillPoints: 5,
    }));
  }

  safe(f, fallback) { try { const v = f(); return v === undefined || v === null ? fallback : v; } catch { return fallback; } }

  // --- panel ---------------------------------------------------------------

  options() {
    return members(this.session).map((ch, i) => {
      const why = this.canTrain(ch);
      return {
        id: `train${i}`,
        label: charName(ch),
        note: why === 'cap' ? `capped at ${this.maxLevel}`
          : why === 'xp' ? `needs ${gold(this.needFor(ch) - this.xpOf(ch))} xp`
            : `${gold(this.costFor(ch))} gold`,
        enabled: why === 'ok' || why === 'gold',
        tip: `Train ${charName(ch)} to level ${this.levelOf(ch) + 1}.`,
      };
    });
  }

  onOption(id) {
    const m = /^train(\d+)$/.exec(id);
    if (!m) return;
    const ch = members(this.session)[+m[1]];
    if (ch) this.train(ch);
  }

  panelInfo() {
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: `Trains to level ${this.maxLevel}`, color: C_WHITE },
    ];
  }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked('training', PANEL.w, PANEL.h, (g, w, h) => paintTrainingInterior(g, w, h));
  }

  drawContent(ctx) {
    const x = PANEL.x + 14, y = PANEL.y + 16, w = PANEL.w - 28;
    const rows = members(this.session);
    const h = 40 + rows.length * 26;
    plate(ctx, x, y, w, h, 0.66);
    F.drawText(ctx, 'Training', x + 10, y + 6, { color: C_CANARY });
    F.drawText(ctx, `This hall trains to level ${this.maxLevel}`, x + w - 10, y + 7,
      { face: 'small', align: 'right', color: C_DIM });
    A.rule(ctx, x + 8, y + 22, w - 16, '#7a6a4a');

    const cols = [12, 118, 168, 246, 330];
    ['Character', 'Level', 'Experience', 'Needed', 'Cost'].forEach((t, i) => {
      F.drawText(ctx, t, x + cols[i], y + 26, { face: 'small', color: C_DIM });
    });

    rows.forEach((ch, i) => {
      const ry = y + 40 + i * 26;
      const why = this.canTrain(ch);
      const klass = CLASSES[ch.class || ch.klass];
      const hit = this.ui.region(`${this.id}:row${i}`, x + 6, ry - 3, w - 12, 22,
        `Train ${charName(ch)}`);
      if (hit.hover) {
        M.stipple(ctx, x + 6, ry - 3, w - 12, 22, [225, 205, 35], 0.22);
      }
      if (hit.click) this.train(ch);

      F.drawText(ctx, charName(ch), x + cols[0], ry, { color: hit.hover ? C_GOLD : C_WHITE });
      F.drawText(ctx, klass ? klass.name : (ch.class || ''), x + cols[0], ry + 11,
        { face: 'small', color: C_DIM });
      F.drawText(ctx, String(this.levelOf(ch)), x + cols[1] + 20, ry + 3, { align: 'right', color: C_WHITE });
      F.drawText(ctx, gold(this.xpOf(ch)), x + cols[2] + 60, ry + 3, { align: 'right', color: C_WHITE });
      F.drawText(ctx, gold(this.needFor(ch)), x + cols[3] + 60, ry + 3,
        { align: 'right', color: why === 'xp' ? C_RED : C_GREEN });
      F.drawText(ctx, why === 'cap' ? '-' : `${gold(this.costFor(ch))}g`, x + cols[4] + 60, ry + 3,
        { align: 'right', color: why === 'ok' ? C_CANARY : C_DIM });

      // Progress bar towards the next level.
      const prev = this.safe(() => xpForLevel(this.levelOf(ch)), 0);
      const need = this.needFor(ch);
      const t = clamp((this.xpOf(ch) - prev) / Math.max(1, need - prev), 0, 1);
      A.statBar(ctx, x + cols[0], ry + 20, 96, 3, t, t >= 1 ? 'sp' : 'hp');
    });
  }
}

export default TrainingScreen;
