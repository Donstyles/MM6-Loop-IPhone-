// ---------------------------------------------------------------------------
// The tavern.
//
// Food, a bed, a drink, gossip, a wager and whoever is sitting at the bar
// looking for work. The interior is the warmest painting in town: firelight
// from the right, lamps over the tables, patrons in silhouette.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { maxHP, maxSP, effectiveStat } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, hotText, rngFor, paintWall,
  paintFloor, paintShelf, paintCounter, paintClutter, vignette, members, activeMember,
  charName, partyGold, spend, earn, addCondition, hasCondition, C_WHITE, C_CANARY, C_DIM,
  C_RED, C_GREEN,
} from './dialogue.js';

const RUMOURS = [
  'The bridge north of the town was washed out last spring; nobody has fixed it.',
  'A goblin camp has taken the old mill. Nobody dares bring the flour in.',
  'They say the temple pays well for anyone fool enough to enter the crypt.',
  'The lord\'s tax collector has not been seen in three weeks.',
  'A pedlar swore he saw a dragon over the eastern hills. He had been drinking.',
  'The guild of the elements is looking for a new apprentice, if you have the coin.',
];

const HINTS = [
  { text: 'The smith\'s daughter went into the caves under the hill and has not come out.', quest: true },
  { text: 'Old Merrow buried his savings behind the mill before the goblins came.', quest: true },
  { text: 'A knight of the Sun offers gold for the head of the beast in Corlagon\'s Estate.', quest: true },
];

/** Firelight from the right, lamps over the tables, patrons in silhouette. */
export function paintTavernInterior(g, w, h) {
  const horizon = Math.round(h * 0.50);
  paintWall(g, 0, 0, w, horizon, { ramp: 'wood', lo: 0.14, hi: 0.44, course: 14, seed: 87 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'wood', seed: 91 });

  // Plaster between the timbers on the upper wall.
  g.fillStyle = rampCss('plaster', 7);
  g.fillRect(0, 20, w, 44);
  for (let x = -20; x < w; x += 58) {
    g.fillStyle = rampCss('wood', 4);
    g.fillRect(x, 20, 9, 44);
    poly(g, [x + 9, 64, x + 34, 20, x + 42, 20, x + 17, 64], rampCss('wood', 5));
  }
  g.fillStyle = rampCss('wood', 3);
  g.fillRect(0, 0, w, 20); g.fillRect(0, 62, w, 6);

  // Hearth on the right, the room's key light.
  const hx = w - 108;
  g.fillStyle = rampCss('stone', 5); g.fillRect(hx - 16, horizon - 104, 124, 104);
  g.fillStyle = rampCss('stone', 8); g.fillRect(hx - 16, horizon - 104, 124, 6);
  g.fillStyle = '#170a03'; g.fillRect(hx, horizon - 74, 82, 74);
  glow(g, hx + 41, horizon - 24, 96, '#ff8828', 1);
  for (let i = 0; i < 8; i++) {
    const fx = hx + 8 + i * 9;
    poly(g, [fx, horizon - 4, fx + 4, horizon - 26 - (i % 3) * 8, fx + 9, horizon - 4],
      rampCss('fire', 9 + (i % 4)));
  }
  g.fillStyle = rampCss('wood', 3);
  for (let i = 0; i < 4; i++) g.fillRect(hx + 6 + i * 18, horizon - 12, 16, 6);

  // Bar counter along the left, bottles behind it.
  paintShelf(g, 16, 96, 150, { th: 4 });
  paintShelf(g, 16, 130, 150, { th: 4 });
  for (let i = 0; i < 12; i++) {
    const x = 22 + i * 12;
    const bh = 14 + (i % 3) * 5;
    g.fillStyle = 'rgba(190,210,220,0.45)';
    g.fillRect(x, 96 - bh, 7, bh);
    g.fillStyle = ['#8a4020', '#c07030', '#6a3a18'][i % 3];
    g.fillRect(x + 1, 96 - bh * 0.6, 5, bh * 0.6 - 1);
    if (i < 10) { g.fillStyle = rampCss('wood', 6); g.fillRect(x + 2, 128 - 12, 4, 12); }
  }
  paintCounter(g, 0, horizon - 6, 176, 26, { cloth: null });
  figure(g, 96, horizon - 8, 80, 'rgba(22,16,12,0.92)', 'rgba(255,190,110,0.5)');

  // Tables with patrons, tankards and lamps.
  const tables = [[210, horizon + 44, 1], [330, horizon + 26, 0.85], [124, horizon + 76, 1.15]];
  for (const [tx, ty, s] of tables) {
    g.fillStyle = rampCss('wood', 4);
    g.beginPath(); g.ellipse(tx, ty, 44 * s, 14 * s, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('wood', 8);
    g.beginPath(); g.ellipse(tx, ty - 3 * s, 44 * s, 13 * s, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('wood', 3);
    g.fillRect(tx - 3, ty, 6, 22 * s);
    // Tankards.
    for (let i = 0; i < 3; i++) {
      g.fillStyle = rampCss('grey', 7);
      g.fillRect(tx - 22 * s + i * 16 * s, ty - 12 * s, 6, 8);
      g.fillStyle = rampCss('sand', 11);
      g.fillRect(tx - 22 * s + i * 16 * s, ty - 13 * s, 6, 2);
    }
    // Patrons around it.
    figure(g, tx - 40 * s, ty + 8 * s, 62 * s, 'rgba(18,14,12,0.88)', 'rgba(255,170,90,0.42)');
    figure(g, tx + 40 * s, ty + 8 * s, 58 * s, 'rgba(18,14,12,0.88)', 'rgba(255,170,90,0.30)');
    glow(g, tx, ty - 46 * s, 54 * s, '#ffc060', 0.5);
    g.fillStyle = rampCss('gold', 6);
    g.fillRect(tx - 5, ty - 56 * s, 10, 8);
    g.fillStyle = '#ffe0a0';
    g.fillRect(tx - 3, ty - 54 * s, 6, 5);
  }

  paintClutter(g, 18, h - 6, 'barrel', 34);
  paintClutter(g, 62, h - 4, 'barrel', 28);
  vignette(g, w, h);
}

export class TavernScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'tavern';
    this.title = opts.title || 'The Laughing Wench';
    this.tier = opts.tier || 1;
    this.keeper = opts.keeper || { name: 'Mira', title: 'Innkeeper', portraitSeed: 88, sex: 'f' };
    this.foodMax = opts.foodMax || 14;
    this.foodPrice = opts.foodPrice || 2 * this.tier;
    this.roomPrice = opts.roomPrice || 5 * this.tier;
    this.drinkPrice = opts.drinkPrice || 2 * this.tier;
    this.stake = opts.stake || 25 * this.tier;
    this.patrons = opts.patrons || [
      { id: 'gunther', name: 'Gunther', title: 'Sellsword', portraitSeed: 21, sex: 'm', wage: 12,
        text: 'Coin up front, and I keep what I kill.' },
      { id: 'elsi', name: 'Elsi', title: 'Guide', portraitSeed: 52, sex: 'f', wage: 8,
        text: 'I know every track in these hills. You will not get lost with me along.' },
    ];
    this.rumour = '';
    this.game = null;
    this.rnd = rngFor(`tavern:${this.title}`);
  }

  // --- services ------------------------------------------------------------

  options() {
    const p = this.session.party || {};
    const food = p.food | 0;
    return [
      { id: 'food', label: 'Buy Food', note: `${food}/${this.foodMax} - ${this.foodPrice}g each`,
        enabled: food < this.foodMax },
      { id: 'room', label: 'Rent a Room', note: `${gold(this.roomPrice * members(this.session).length)} gold` },
      { id: 'drink', label: 'Buy Drinks', note: `${gold(this.drinkPrice * members(this.session).length)} gold` },
      { id: 'rumour', label: 'Listen to Rumours' },
      { id: 'game', label: 'Arm Wrestling', note: `stake ${gold(this.stake)} gold` },
      { id: 'hire', label: 'Hire', note: `${this.patrons.length} looking for work` },
    ];
  }

  onOption(id) {
    switch (id) {
      case 'food': this.buyFood(); return;
      case 'room': this.rentRoom(); return;
      case 'drink': this.buyDrinks(); return;
      case 'rumour': this.listen(); return;
      case 'game': this.startGame(); return;
      case 'hire': this.mode = this.mode === 'hire' ? null : 'hire'; return;
      default:
    }
  }

  buyFood() {
    const p = this.session.party;
    if (!p) return;
    const want = this.foodMax - (p.food | 0);
    if (want <= 0) { this.say('You are carrying all the food you can.'); return; }
    const cost = want * this.foodPrice;
    if (!spend(this.session, cost)) {
      // Buy whatever the purse allows rather than refusing outright.
      const can = Math.floor(partyGold(this.session) / this.foodPrice);
      if (can <= 0) { this.say('You cannot afford so much as a loaf.'); return; }
      spend(this.session, can * this.foodPrice);
      p.food = (p.food | 0) + can;
      this.say(`You buy ${can} days of food for ${gold(can * this.foodPrice)} gold.`);
      return;
    }
    p.food = this.foodMax;
    this.say(`Your packs are full: ${this.foodMax} days of food for ${gold(cost)} gold.`);
  }

  /** A room takes you to nine in the morning and mends everything short of death. */
  rentRoom() {
    const list = members(this.session);
    const cost = this.roomPrice * Math.max(1, list.length);
    if (!spend(this.session, cost)) { this.say(`A room for the night is ${gold(cost)} gold.`); return; }
    const clock = this.session.clock;
    if (clock) {
      const dayMinutes = 24 * 60;
      const target = Math.floor(clock.minutes / dayMinutes) * dayMinutes + dayMinutes + 9 * 60;
      clock.minutes = target;
    }
    for (const ch of list) {
      if (hasCondition(ch, 'dead') || hasCondition(ch, 'eradicated') || hasCondition(ch, 'stoned')) continue;
      ch.hp = this.safe(() => maxHP(ch), ch.maxHP || ch.hp);
      ch.sp = this.safe(() => maxSP(ch), ch.maxSP || ch.sp);
      if (ch.conditions && !Array.isArray(ch.conditions)) {
        delete ch.conditions.drunk;
        delete ch.conditions.asleep;
        delete ch.conditions.weak;
      }
    }
    const p = this.session.party;
    if (p) p.food = Math.max(0, (p.food | 0) - 1);
    this.say('You sleep until morning. Everyone wakes rested.');
    this.sound('rest');
  }

  buyDrinks() {
    const list = members(this.session);
    const cost = this.drinkPrice * Math.max(1, list.length);
    if (!spend(this.session, cost)) { this.say(`A round costs ${gold(cost)} gold.`); return; }
    let drunk = 0;
    for (const ch of list) {
      // MM6's ale is a gamble: bolder tongue, worse aim.
      if (this.rnd.bool(0.45)) { addCondition(ch, 'drunk'); drunk++; }
    }
    this.say(drunk
      ? `${drunk === list.length ? 'Everyone' : `${drunk} of you`} had one too many. `
        + 'Personality is up, aim and wits are down.'
      : 'A pleasant round. Nobody embarrasses themselves.');
  }

  listen() {
    // Most gossip is flavour; occasionally the room gives up a real lead.
    if (this.rnd.bool(0.3)) {
      const h = this.rnd.pick(HINTS);
      this.rumour = h.text;
      this.say(this.rumour);
      const q = this.session.quests;
      if (q && typeof q.hint === 'function') q.hint(h.text);
    } else {
      this.rumour = this.rnd.pick(RUMOURS);
      this.say(this.rumour);
    }
  }

  // --- arm wrestling -------------------------------------------------------

  startGame() {
    if (this.game && !this.game.done) return;
    if (partyGold(this.session) < this.stake) { this.say(`You need ${gold(this.stake)} gold to make a wager.`); return; }
    const ch = this.character || activeMember(this.session);
    const might = this.safe(() => effectiveStat(ch, 'might'), (ch && ch.stats && ch.stats.might) || 12);
    const foe = 10 + this.tier * 6 + this.rnd.int(0, 8);
    spend(this.session, this.stake);
    this.game = {
      t: 0, pos: 0, done: false, won: false,
      might, foe, name: charName(ch),
      // Bias per tick: strength difference decides, luck of the dice decorates.
      bias: clamp((might - foe) / 40, -0.34, 0.34),
    };
    this.say(`${charName(ch)} rolls up a sleeve. ${gold(this.stake)} gold on the table.`);
  }

  updateGame(dt) {
    const g = this.game;
    if (!g || g.done) return;
    g.t += dt;
    g.pos = clamp(g.pos + (g.bias + (this.rnd.float(-1, 1)) * 0.55) * dt * 1.6, -1, 1);
    if (Math.abs(g.pos) >= 0.98 || g.t > 6) {
      g.done = true;
      g.won = g.pos > 0 || (g.t > 6 && g.pos > 0);
      if (g.won) {
        earn(this.session, this.stake * 2);
        this.say(`${g.name} slams the arm down. You win ${gold(this.stake * 2)} gold!`);
      } else {
        this.say(`${g.name} loses the wager. The table roars.`);
      }
    }
  }

  update(dt) {
    super.update(dt);
    this.updateGame(dt || 0);
  }

  // --- panel ---------------------------------------------------------------

  panelInfo() {
    const p = this.session.party || {};
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: `Food: ${p.food | 0}/${this.foodMax}`, color: (p.food | 0) > 0 ? C_WHITE : C_RED },
    ];
  }

  backdrop() {
    return baked('tavern', PANEL.w, PANEL.h, (g, w, h) => paintTavernInterior(g, w, h));
  }

  drawContent(ctx) {
    if (this.mode === 'hire') this.drawHire(ctx);
    if (this.game) this.drawGame(ctx);
  }

  drawHire(ctx) {
    const x = PANEL.x + 16, y = PANEL.y + 16, w = 260;
    const h = 30 + this.patrons.length * 34;
    plate(ctx, x, y, w, h, 0.7);
    F.drawText(ctx, 'Drinking here tonight', x + 10, y + 6, { color: C_CANARY });
    A.rule(ctx, x + 8, y + 22, w - 16, '#7a6a4a');
    const p = this.session.party || {};
    const hired = p.hirelings || [];
    this.patrons.forEach((n, i) => {
      const ry = y + 30 + i * 34;
      const already = hired.some((hh) => hh.id === n.id);
      const r = hotText(this.ui, ctx, `${this.id}:hire${i}`, x + 12, ry,
        already ? `${n.name} (in your service)` : n.name,
        { tip: n.text, enabled: true });
      F.drawText(ctx, `${n.title} - ${n.wage}g/day`, x + 12, ry + 12, { face: 'small', color: C_DIM });
      F.drawText(ctx, already ? 'Dismiss' : 'Hire', x + w - 12, ry + 4,
        { face: 'small', align: 'right', color: already ? C_RED : C_GREEN });
      if (r.click) {
        if (already) {
          const idx = hired.findIndex((hh) => hh.id === n.id);
          hired.splice(idx, 1);
          this.say(`${n.name} goes back to the bar.`);
        } else if (hired.length >= 2) {
          this.say('You already keep two followers.');
        } else {
          if (!p.hirelings) p.hirelings = [];
          p.hirelings.push({ id: n.id, name: n.name, role: n.title, wage: n.wage, portraitSeed: n.portraitSeed, sex: n.sex });
          this.say(`${n.name}: "${n.text}"`);
        }
      }
    });
  }

  /** The wager: a tug-of-war bar with both arms pulling. */
  drawGame(ctx) {
    // Sits below the hire list, which owns the top left of the illustration.
    const w = 300, h = 66;
    const x = PANEL.x + PANEL.w - w - 16, y = PANEL.y + 116;
    plate(ctx, x, y, w, h, 0.74);
    F.drawText(ctx, 'Arm Wrestling', x + 10, y + 6, { color: C_CANARY });
    const g = this.game;
    F.drawText(ctx, `${g.name} (${g.might})  vs  the local (${g.foe})`, x + 10, y + 20,
      { face: 'small', color: C_WHITE });

    const bx = x + 14, by = y + 38, bw = w - 28, bh = 12;
    A.inset(ctx, bx, by, bw, bh);
    const mid = bx + bw / 2;
    const px = clamp(mid + g.pos * (bw / 2 - 6), bx + 2, bx + bw - 8);
    ctx.fillStyle = rampCss('blood', 8);
    ctx.fillRect(bx + 2, by + 2, px - bx - 2, bh - 4);
    ctx.fillStyle = rampCss('water', 9);
    ctx.fillRect(px, by + 2, bx + bw - 2 - px, bh - 4);
    ctx.fillStyle = '#ffe8a0';
    ctx.fillRect(px - 1, by, 3, bh);
    ctx.fillStyle = C_DIM;
    ctx.fillRect(mid, by - 3, 1, bh + 6);

    if (g.done) {
      F.drawText(ctx, g.won ? `You win ${gold(this.stake * 2)} gold` : 'You lose the wager',
        x + w - 12, y + 20, { face: 'small', align: 'right', color: g.won ? C_GREEN : C_RED });
    }
  }

  safe(f, fallback) { try { const v = f(); return v === undefined ? fallback : v; } catch { return fallback; } }
}

export default TavernScreen;
