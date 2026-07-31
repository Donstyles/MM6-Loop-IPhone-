// ---------------------------------------------------------------------------
// The training hall.
//
// MM6 does not level you up when the experience arrives - you must walk into a
// training hall and buy the level, and each hall has a cap on how far it will
// take you. The screen therefore has to show, per character: level, experience,
// what the next level needs, and what the trainer charges.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { xpForLevel, trainingCost, maxHP, maxSP, CLASSES } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, paintWall, paintFloor,
  paintShelf, paintClutter, vignette, members, charName, partyGold, spend, C_WHITE, C_GOLD,
  C_CANARY, C_DIM, C_RED, C_GREEN,
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
    g.fillStyle = rampCss('wood', 3); g.fillRect(wx - 4, 18, 56, 60);
    g.fillStyle = rampCss('sky', 12); g.fillRect(wx, 22, 48, 52);
    g.fillStyle = rampCss('sky', 14); g.fillRect(wx, 22, 48, 22);
    g.fillStyle = rampCss('wood', 5);
    g.fillRect(wx + 22, 22, 3, 52); g.fillRect(wx, 46, 48, 3);
    glow(g, wx + 24, 48, 60, '#ffe8b0', 0.35);
    // The shaft of light on the sand, kept faint so the floor stays a floor.
    g.save();
    g.globalAlpha = 0.055;
    poly(g, [wx, horizon, wx + 48, horizon, wx + 76, h, wx - 20, h], '#fff0c0');
    g.restore();
  }

  // Weapon rack on the right wall.
  paintShelf(g, w - 132, 128, 110, { th: 5 });
  for (let i = 0; i < 6; i++) {
    const x = w - 124 + i * 18;
    g.fillStyle = rampCss('wood', 6); g.fillRect(x, 84, 3, 44);
    g.fillStyle = rampCss('grey', 9);
    if (i % 2) { g.fillRect(x - 3, 78, 9, 8); } else { g.fillRect(x - 1, 74, 6, 12); }
  }

  // Straw practice dummies.
  for (const [dx, scale] of [[96, 1], [w - 190, 0.86]]) {
    const base = horizon + 52 * scale;
    g.fillStyle = rampCss('wood', 4);
    g.fillRect(dx - 2, base - 74 * scale, 5, 74 * scale);
    g.fillStyle = rampCss('sand', 8);
    g.beginPath(); g.ellipse(dx, base - 78 * scale, 13 * scale, 15 * scale, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('sand', 6);
    g.fillRect(dx - 20 * scale, base - 66 * scale, 40 * scale, 22 * scale);
    g.fillStyle = rampCss('wood', 5);
    g.fillRect(dx - 26 * scale, base - 62 * scale, 52 * scale, 4);
    g.fillStyle = rampCss('sand', 11);
    g.fillRect(dx - 18 * scale, base - 64 * scale, 3, 18 * scale);
    // Sand kicked up at the foot.
    g.save(); g.globalAlpha = 0.5;
    g.fillStyle = rampCss('sand', 5);
    g.beginPath(); g.ellipse(dx, base + 2, 26 * scale, 6, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // Two sparring silhouettes in the middle distance.
  figure(g, w * 0.44, horizon + 66, 84, 'rgba(20,16,14,0.9)', 'rgba(255,224,160,0.4)');
  figure(g, w * 0.56, horizon + 70, 88, 'rgba(20,16,14,0.9)', 'rgba(255,224,160,0.35)');
  g.strokeStyle = rampCss('grey', 11); g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.47, horizon + 26); g.lineTo(w * 0.53, horizon + 16);
  g.stroke();

  paintClutter(g, 20, h - 8, 'barrel', 30);
  paintClutter(g, w - 48, h - 6, 'crate', 26);
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
        ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#e1cd23';
        ctx.fillRect(x + 6, ry - 3, w - 12, 22); ctx.restore();
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
