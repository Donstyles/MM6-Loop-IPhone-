// ---------------------------------------------------------------------------
// The temple.
//
// MM6's temples heal, cure, resurrect and take donations, and the price of
// every service scales with the party's level and the severity of what is
// wrong with them. The interior is the one place in town with coloured light:
// a rose window over the altar throwing stained-glass colour across the stone.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp, hash2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { healCost, worstCondition, CONDITIONS, maxHP, maxSP } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, paintWall, paintFloor,
  paintClutter, vignette, members, activeMember, charName, partyGold, spend, hasCondition,
  clearCondition, conditionIds, contactShadow, poseSeed, MM6, C_WHITE, C_CANARY, C_DIM, C_RED, C_GREEN,
} from './dialogue.js';

const GODS = ['The Sun', 'The Moon', 'The Sky', 'The Forge', 'The Deep'];

/** Stained glass, altar, candles: the one interior with coloured light. */
export function paintTempleInterior(g, w, h, tint = '#e1cd23') {
  const horizon = Math.round(h * 0.62);
  paintWall(g, 0, 0, w, horizon, { ramp: 'stone', lo: 0.10, hi: 0.44, course: 22, seed: 51 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'stone', seed: 55 });

  // Flagstones. The courses compress toward the back wall, and each slab takes
  // a value of its own - a chiselled joint plus per-slab jitter, not a grid of
  // hairlines laid over a wash at half opacity.
  {
    let y = horizon, step = 5;
    let row = 0;
    while (y < h) {
      const sy = Math.round(y), sh = Math.max(3, Math.round(step));
      const pitch = Math.max(12, Math.round(step * 2.6));
      const off = (row & 1) ? Math.round(pitch / 2) : 0;
      for (let x = 0; x < w; x++) {
        const bx = (x + off) % pitch;
        const joint = bx < 2;
        const slab = hash2(Math.floor((x + off) / pitch), row, 44);
        for (let dy = 0; dy < sh && sy + dy < h; dy++) {
          const top = dy < 1;
          const v = joint || dy >= sh - 1 ? 0.10 : (top ? 0.40 : 0.28) + slab * 0.16;
          MM6.rct(g, x, sy + dy, 1, 1, MM6.mix([16, 16, 14], [112, 110, 100], MM6.band(v, 7)));
        }
      }
      y += step;
      step *= 1.24;
      row++;
    }
    // Base course where the wall meets the floor, so the two planes separate.
    MM6.rct(g, 0, horizon - 5, w, 5, MM6.pc([84, 82, 74]));
    MM6.rct(g, 0, horizon - 5, w, 1, MM6.pc([150, 148, 136]));
    MM6.rct(g, 0, horizon, w, 2, MM6.pc([16, 16, 14]));
  }

  // Columns: a turned shaft, so the light wraps rather than stepping once.
  for (const cx of [46, w - 46]) {
    for (let dx = -14; dx <= 14; dx++) {
      const u = (dx + 14) / 28;
      const v = MM6.band(1 - Math.abs(u - 0.28) * 1.35, 6);
      MM6.rct(g, cx + dx, 12, 1, horizon - 4, MM6.mix([32, 32, 28], [186, 184, 172], v));
    }
    // Fluting.
    for (let f = -10; f <= 10; f += 5) {
      MM6.rct(g, cx + f, 12, 1, horizon - 4, MM6.pc([40, 40, 34]));
      MM6.rct(g, cx + f + 1, 12, 1, horizon - 4, MM6.pc([150, 148, 136]));
    }
    // Capital and base, each with a lit top arris and a shadow beneath.
    for (const [by, bh] of [[8, 11], [horizon - 13, 13]]) {
      MM6.rct(g, cx - 20, by, 40, bh, [128, 126, 116]);
      MM6.rct(g, cx - 20, by, 40, 2, [206, 204, 190]);
      MM6.rct(g, cx - 20, by + bh - 2, 40, 2, [40, 40, 34]);
      MM6.rct(g, cx + 10, by, 10, bh, [86, 84, 76]);
    }
  }

  // Rose window. Deep jewel glass - garnet, lapis, bottle-green, amethyst,
  // amber - in heavy black leading, painted pane by pane in hard scanlines.
  // Nothing here is a pure hue and nothing is stroked.
  // It sits low, immediately over the altar. The healing table covers the top
  // third of the illustration whenever the screen is open, and a rose window
  // hung up there is a window nobody ever sees; down here it is behind the
  // altar, it explains the patch of colour on the flagstones, and it clears
  // the table.
  const rx = Math.round(w / 2), ry = 152, rr = 44;
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
  // The stone immediately around the tracery takes colour; the rest of the nave
  // does not. No pool, no bloom, no shaft.
  glow(g, rx, ry, 190, tint, 0.5);

  // The window falls on the floor, not through the air. MM6 has no volumetric
  // light and no god rays: a painter of the period drew the *patch* the window
  // throws on the flagstones, keystoned by the viewing angle and stepped in a
  // few flat value bands, and left the nave itself unpainted.
  // Dimmed: litPatch blends additively, so handing it the glass colour at full
  // value bleaches the flagstones into a white carpet.
  const dim = MM6.shade(MM6.hexRGB(tint), 0.46);
  const dimHex = `#${[0, 1, 2].map((i) => Math.round(dim[i]).toString(16).padStart(2, '0')).join('')}`;
  MM6.litPatch(g, rx, horizon + 4, rr * 0.58, h - 2, rr * 1.05, dimHex, 4);

  // Altar: marble, #D0CCC0 to #F0EEE6 with #A8A498 veining, and modelled - a
  // top slab seen slightly from above, a front face that falls away from it,
  // and a shadowed return on the right. A white box with sticks on it is not a
  // painted object.
  const aw = 124, ad = 13;
  const ax = rx - aw / 2, ay = horizon + 20, ah = 30;
  contactShadow(g, rx + 6, ay + ah + 14, aw * 0.62, 6);
  // Stepped plinth. Without a foot the altar reads as a slab hanging in the air.
  for (let i = 0; i < 2; i++) {
    const px = ax - 10 + i * 6, pw = aw + 20 - i * 12, py = ay + ah + i * 6;
    MM6.rct(g, px, py, pw, 7, MM6.pc([120, 118, 110]));
    MM6.rct(g, px, py, pw, 2, MM6.pc([188, 186, 176]));
    MM6.rct(g, px, py + 5, pw, 2, MM6.pc([54, 54, 50]));
    MM6.rct(g, px + pw - 8, py, 8, 7, MM6.pc([86, 84, 78]));
  }
  // Front face.
  for (let y = 0; y < ah; y++) {
    const t = y / ah;
    for (let x = 0; x < aw; x++) {
      const v = MM6.band(0.60 - t * 0.30 - (x / aw) * 0.10, 6);
      const vein = hash2(Math.floor(x / 3), Math.floor((y + x * 0.4) / 5), 88);
      MM6.rct(g, ax + x, ay + y, 1, 1,
        MM6.mix([104, 102, 94], [238, 236, 228], clamp(v + (vein > 0.86 ? -0.13 : 0), 0, 1)));
    }
  }
  // Shadowed return on the right.
  poly(g, [ax + aw, ay, ax + aw + ad, ay - ad, ax + aw + ad, ay + ah - ad, ax + aw, ay + ah],
    MM6.pc([86, 84, 78]));
  // Top slab, running back and to the right, and the brightest thing on it.
  poly(g, [ax, ay, ax + ad, ay - ad, ax + aw + ad, ay - ad, ax + aw, ay], MM6.pc([216, 214, 204]));
  poly(g, [ax + 2, ay - 1, ax + ad, ay - ad + 1, ax + aw + ad - 3, ay - ad + 1, ax + aw - 2, ay - 1],
    MM6.pc([242, 240, 232]));
  MM6.rct(g, ax, ay - 1, aw, 1, [252, 250, 244]);       // lit arris
  MM6.rct(g, ax, ay + ah - 2, aw, 2, [92, 90, 84]);     // plinth shadow
  // Gilt band across the front.
  MM6.rct(g, ax + 12, ay + 12, aw - 24, 4, [150, 118, 44]);
  MM6.rct(g, ax + 12, ay + 12, aw - 24, 1, [238, 206, 124]);
  MM6.rct(g, ax + 12, ay + 15, aw - 24, 1, [82, 62, 20]);
  // Candles: painted wax, and the flames are the only light on the slab.
  for (let i = 0; i < 5; i++) {
    const cx2 = ax + 20 + i * 21 + Math.round(ad * 0.5);
    MM6.candle(g, cx2, ay - ad + 1, 13 + (i % 2) * 3, i * 1.7);
    glow(g, cx2 + 2, ay - ad - 14 - (i % 2) * 3, 42, '#ffc060', 0.55);
  }

  // A robed acolyte to one side.
  figure(g, w * 0.80, horizon + 54, 104, null, null, {
    seed: poseSeed('stand', 3172),
    robe: true, hood: true, cloth: [104, 98, 84], skin: [190, 148, 110], hair: [72, 52, 32],
  });

  paintClutter(g, 20, h - 6, 'crate', 26);
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
    // The rose window sits directly behind this table, so the plate is taken
    // down further than a shop's - at 0.62 the jewel glass reads through the
    // dither as coloured speckle across the figures.
    plate(ctx, x, y, w, h, 0.80);
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
