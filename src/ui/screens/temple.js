// ---------------------------------------------------------------------------
// The temple.
//
// MM6's temples heal, cure, resurrect and take donations, and the price of
// every service scales with the party's level and the severity of what is
// wrong with them. The interior is the one place in town with coloured light:
// a rose window over the altar throwing stained-glass colour across the stone.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { healCost, worstCondition, CONDITIONS, maxHP, maxSP } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, paintWall, paintFloor,
  paintClutter, vignette, members, activeMember, charName, partyGold, spend, hasCondition,
  clearCondition, conditionIds, MM6, C_WHITE, C_CANARY, C_DIM, C_RED, C_GREEN,
} from './dialogue.js';

const GODS = ['The Sun', 'The Moon', 'The Sky', 'The Forge', 'The Deep'];

/** Stained glass, altar, candles: the one interior with coloured light. */
export function paintTempleInterior(g, w, h, tint = '#e1cd23') {
  const horizon = Math.round(h * 0.62);
  paintWall(g, 0, 0, w, horizon, { ramp: 'stone', lo: 0.10, hi: 0.44, course: 22, seed: 51 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'stone', seed: 55 });

  // Flagstones, drawn straight rather than in perspective boards.
  g.save();
  g.globalAlpha = 0.5;
  for (let y = horizon; y < h; y += 14) {
    g.fillStyle = rampCss('stone', 2);
    g.fillRect(0, y, w, 1);
    const off = ((y - horizon) / 14) % 2 ? 26 : 0;
    for (let x = off; x < w; x += 52) g.fillRect(x, y, 1, 14);
  }
  g.restore();

  // Columns.
  for (const cx of [46, w - 46]) {
    g.fillStyle = rampCss('stone', 6);
    g.fillRect(cx - 14, 12, 28, horizon - 4);
    g.fillStyle = rampCss('stone', 9);
    g.fillRect(cx - 14, 12, 5, horizon - 4);
    g.fillStyle = rampCss('stone', 3);
    g.fillRect(cx + 8, 12, 6, horizon - 4);
    g.fillStyle = rampCss('stone', 8);
    g.fillRect(cx - 20, 8, 40, 10);
    g.fillRect(cx - 18, horizon - 12, 36, 12);
  }

  // Rose window. Deep jewel glass - garnet, lapis, bottle-green, amethyst,
  // amber - in heavy black leading, painted pane by pane in hard scanlines.
  // Nothing here is a pure hue and nothing is stroked.
  const rx = Math.round(w / 2), ry = 88, rr = 62;
  MM6.disc(g, rx, ry, rr + 8, rampCss('stone', 3));
  MM6.disc(g, rx, ry, rr + 5, rampCss('stone', 6));
  const GLASS = [
    [96, 18, 26], [22, 38, 96], [18, 66, 44], [72, 26, 84],
    [124, 76, 16], [26, 62, 84], [104, 40, 18], [40, 30, 78],
  ];
  for (let dy = -rr; dy <= rr; dy++) {
    const k = Math.round(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
    for (let dx = -k; dx <= k; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.atan2(dy, dx);
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16);
      const ring = d < rr * 0.28 ? 0 : d < rr * 0.62 ? 1 : 2;
      // Leading: a fat black came between every pane and around the rim.
      const segFrac = ((a + Math.PI) / (Math.PI * 2)) * 16 % 1;
      const onCame = segFrac < 0.07 || segFrac > 0.93
        || Math.abs(d - rr * 0.28) < 2.2 || Math.abs(d - rr * 0.62) < 2.2 || d > rr - 2.2;
      if (onCame) { MM6.rct(g, rx + dx, ry + dy, 1, 1, [14, 12, 16]); continue; }
      const base = GLASS[(seg + ring * 3) % GLASS.length];
      // Glass is lit from behind, brightest toward the middle of each pane.
      const lift = 0.72 + 0.55 * Math.abs(Math.sin(segFrac * Math.PI)) - ring * 0.06;
      MM6.rct(g, rx + dx, ry + dy, 1, 1, MM6.shade(base, lift));
    }
  }
  // The boss at the centre, an amber roundel.
  MM6.disc(g, rx, ry, 11, MM6.shade(MM6.hexRGB(tint), 0.55));
  MM6.disc(g, rx, ry, 8, tint);
  MM6.lightPool(g, rx, ry, 96, tint, 0.5);

  // Coloured light thrown down the nave - a stippled shaft, hard-edged.
  const shaftTop = ry + rr;
  for (let y = shaftTop; y < h; y++) {
    const t = (y - shaftTop) / (h - shaftTop);
    const halfW = rr * (1 + t * 1.1);
    MM6.stipple(g, Math.round(rx - halfW), y, Math.round(halfW * 2), 1,
      MM6.hexRGB(tint), 0.20 * (1 - t * 0.5));
  }

  // Altar: marble, #D0CCC0 to #F0EEE6 with #A8A498 veining.
  const ax = rx - 62, ay = horizon + 18;
  for (let y = 0; y < 34; y++) {
    const t = 1 - y / 34;
    MM6.rct(g, ax, ay + y, 124, 1, MM6.mix([160, 156, 146], [240, 238, 230], MM6.band(0.35 + t * 0.55, 6)));
  }
  MM6.rct(g, ax, ay, 124, 3, [240, 238, 230]);
  MM6.rct(g, ax, ay + 31, 124, 3, [136, 132, 122]);
  for (let i = 0; i < 9; i++) {
    // Veining.
    const vy = ay + 4 + ((i * 7) % 26);
    MM6.lineH(g, ax + 6 + i * 13, vy, ax + 22 + i * 13, vy + 3, MM6.pc([168, 164, 152]), 1);
  }
  MM6.rct(g, ax + 14, ay + 13, 96, 3, [186, 150, 60]);
  MM6.rct(g, ax + 14, ay + 13, 96, 1, [236, 208, 128]);
  // Candles, each with a real flame sprite.
  for (let i = 0; i < 5; i++) MM6.candle(g, ax + 16 + i * 24, ay - 1, 15, i * 1.7);

  // A robed acolyte to one side.
  figure(g, w * 0.80, horizon + 44, 96, null, null, {
    robe: true, hood: true, cloth: [148, 142, 128], skin: [212, 170, 132], hair: [72, 52, 32],
  });

  paintClutter(g, 22, h - 8, 'crate', 22);
  vignette(g, w, h);
}

export class TempleScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'temple';
    this.tier = opts.tier || 2;
    this.god = opts.god || GODS[(opts.tier || 2) % GODS.length];
    this.title = opts.title || `Temple of ${this.god}`;
    this.keeper = opts.keeper || { name: 'Brother Aldric', title: 'Healer', portraitSeed: 77, sex: 'm', klass: 'cleric' };
    this.tint = opts.tint || '#e1cd23';
    this.mode = null;
  }

  // --- prices --------------------------------------------------------------

  get factor() { return clamp(0.6 + this.tier * 0.35, 0.6, 3); }

  partyLevel() {
    const m = members(this.session);
    if (!m.length) return 1;
    return Math.max(1, Math.round(m.reduce((s, c) => s + (c.level || 1), 0) / m.length));
  }

  healPrice() {
    let total = 0;
    for (const ch of members(this.session)) total += this.healPriceFor(ch);
    return Math.max(1, total);
  }

  healPriceFor(ch) {
    try {
      const base = healCost(ch, this.factor);
      return Math.round(base * (1 + this.partyLevel() * 0.05));
    } catch {
      const missing = Math.max(0, (ch.maxHP || 30) - (ch.hp || 0));
      return Math.max(1, Math.round((missing * 0.5 + 10) * this.factor));
    }
  }

  resurrectPrice() {
    const n = members(this.session).filter((c) => hasCondition(c, 'dead') || hasCondition(c, 'eradicated') || hasCondition(c, 'stoned')).length;
    return Math.round(n * 300 * this.factor * (1 + this.partyLevel() * 0.1));
  }

  cursePrice() {
    const n = members(this.session).filter((c) => hasCondition(c, 'cursed')).length;
    return Math.round(Math.max(1, n) * 60 * this.factor);
  }

  donatePrice() { return Math.max(50, this.partyLevel() * 50); }

  // --- services ------------------------------------------------------------

  options() {
    const dead = members(this.session).some((c) => hasCondition(c, 'dead') || hasCondition(c, 'stoned') || hasCondition(c, 'eradicated'));
    const cursed = members(this.session).some((c) => hasCondition(c, 'cursed'));
    return [
      { id: 'heal', label: 'Heal', note: `${gold(this.healPrice())} gold`, tip: 'Cure every condition and restore hit points.' },
      { id: 'resurrect', label: 'Resurrect', note: dead ? `${gold(this.resurrectPrice())} gold` : 'no-one is dead', enabled: dead },
      { id: 'curse', label: 'Remove Curse', note: cursed ? `${gold(this.cursePrice())} gold` : 'no curses', enabled: cursed },
      { id: 'donate', label: 'Donate', note: `${gold(this.donatePrice())} gold` },
      { id: 'learn', label: 'Learn Skill', note: 'Body / Spirit magic' },
    ];
  }

  onOption(id) {
    switch (id) {
      case 'heal': this.doHeal(); return;
      case 'resurrect': this.doResurrect(); return;
      case 'curse': this.doCurse(); return;
      case 'donate': this.doDonate(); return;
      case 'learn': this.doLearn(); return;
      default:
    }
  }

  doHeal() {
    const price = this.healPrice();
    if (!spend(this.session, price)) { this.say(`The healing costs ${gold(price)} gold. Come back when you have it.`); return; }
    for (const ch of members(this.session)) {
      for (const id of conditionIds(ch)) {
        // The temple will not raise the dead as part of a general healing.
        if (id === 'dead' || id === 'stoned' || id === 'eradicated') continue;
        clearCondition(ch, id);
      }
      ch.hp = this.maxHPOf(ch);
      ch.sp = this.maxSPOf(ch);
    }
    this.say('You are made whole. Go with the blessing of ' + this.god + '.');
    this.sound('heal');
  }

  doResurrect() {
    const price = this.resurrectPrice();
    if (!spend(this.session, price)) { this.say(`Raising the dead costs ${gold(price)} gold.`); return; }
    let n = 0;
    for (const ch of members(this.session)) {
      if (hasCondition(ch, 'dead') || hasCondition(ch, 'stoned') || hasCondition(ch, 'eradicated')) {
        clearCondition(ch, 'dead'); clearCondition(ch, 'stoned'); clearCondition(ch, 'eradicated');
        clearCondition(ch, 'unconscious');
        // MM6 returns the raised Weak; only Resurrection proper returns them whole.
        if (!hasCondition(ch, 'weak')) { if (!ch.conditions) ch.conditions = {}; ch.conditions.weak = true; }
        ch.hp = Math.max(1, Math.round(this.maxHPOf(ch) * 0.25));
        n++;
      }
    }
    this.say(n === 1 ? 'They draw breath again, weak but living.' : `${n} of your companions draw breath again.`);
  }

  doCurse() {
    const price = this.cursePrice();
    if (!spend(this.session, price)) { this.say(`Lifting the curse costs ${gold(price)} gold.`); return; }
    for (const ch of members(this.session)) clearCondition(ch, 'cursed');
    this.say('The curse is lifted.');
  }

  /**
   * Donating buys standing with the temple and a day-long blessing; MM6 tracks
   * the reputation per town, so it goes on the party rather than the screen.
   */
  doDonate() {
    const price = this.donatePrice();
    if (!spend(this.session, price)) { this.say(`A donation of ${gold(price)} gold is expected.`); return; }
    const p = this.session.party;
    if (!p.temple) p.temple = {};
    const key = this.opts.id || this.title;
    p.temple[key] = (p.temple[key] | 0) + 1;
    const rep = p.temple[key];
    const mins = this.session.clock ? this.session.clock.minutes : 0;
    if (!p.buffs) p.buffs = {};
    p.buffs.bless = { until: mins + 24 * 60, power: 5 + rep * 2, icon: 'school_spirit' };
    this.say(rep >= 3
      ? `${this.god} smiles on you. Blessing granted, and the temple counts you a friend.`
      : 'Your donation is accepted. You feel a blessing settle on the party.');
  }

  doLearn() {
    const ch = this.character || activeMember(this.session);
    if (!ch) return;
    const price = 500 * this.tier;
    if (!ch.skills) ch.skills = {};
    if (ch.skills.body) { this.say(`${charName(ch)} already studies Body Magic here.`); return; }
    const klass = ch.class || ch.klass;
    if (['knight', 'cavalier', 'champion'].includes(klass)) {
      this.say('A knight has no patience for prayer. We cannot teach you.');
      return;
    }
    if (!spend(this.session, price)) { this.say(`Instruction costs ${gold(price)} gold.`); return; }
    ch.skills.body = { level: 1, mastery: 1 };
    this.say(`${charName(ch)} has learned Body Magic.`);
  }

  maxHPOf(ch) { try { return maxHP(ch); } catch { return ch.maxHP || 30; } }
  maxSPOf(ch) { try { return maxSP(ch); } catch { return ch.maxSP || 0; } }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked(`temple:${this.tint}`, PANEL.w, PANEL.h, (g, w, h) => paintTempleInterior(g, w, h, this.tint));
  }

  panelInfo() {
    const p = this.session.party;
    const rep = (p && p.temple && p.temple[this.opts.id || this.title]) | 0;
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: rep ? `Temple standing: ${rep}` : 'The priests do not know you', color: rep ? C_GREEN : C_DIM },
    ];
  }

  drawContent(ctx) {
    const x = PANEL.x + 16, y = PANEL.y + 18, w = PANEL.w - 32;
    const rows = members(this.session);
    const h = 34 + rows.length * 20;
    plate(ctx, x, y, w, h, 0.62);
    F.drawText(ctx, `The Temple of ${this.god}`, x + 10, y + 6, { color: C_CANARY });
    A.rule(ctx, x + 8, y + 20, w - 16, '#7a6a4a');
    F.drawText(ctx, 'Condition', x + 150, y + 22, { face: 'small', color: C_DIM });
    F.drawText(ctx, 'Cost', x + w - 12, y + 22, { face: 'small', align: 'right', color: C_DIM });

    rows.forEach((ch, i) => {
      const ry = y + 34 + i * 20;
      const cond = this.conditionName(ch);
      const bad = cond !== 'Good';
      F.drawText(ctx, charName(ch), x + 12, ry, { color: C_WHITE });
      F.drawText(ctx, `${ch.hp | 0}/${this.maxHPOf(ch)} hp`, x + 96, ry + 1,
        { face: 'small', color: (ch.hp | 0) < this.maxHPOf(ch) ? C_RED : C_DIM });
      F.drawText(ctx, cond, x + 150, ry, { color: bad ? C_RED : C_GREEN });
      F.drawText(ctx, `${gold(this.healPriceFor(ch))}g`, x + w - 12, ry,
        { align: 'right', color: bad || (ch.hp | 0) < this.maxHPOf(ch) ? C_CANARY : C_DIM });
    });
  }

  conditionName(ch) {
    try {
      const c = worstCondition(ch);
      return c ? c.name : 'Good';
    } catch {
      const ids = conditionIds(ch);
      if (!ids.length) return 'Good';
      const spec = CONDITIONS[ids[0]];
      return spec ? spec.name : ids[0];
    }
  }
}

export default TempleScreen;
