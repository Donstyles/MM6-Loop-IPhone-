// ---------------------------------------------------------------------------
// The tavern.
//
// Food, a bed, a drink, gossip, a wager and whoever is sitting at the bar
// looking for work. The interior is the warmest painting in town: firelight
// from the right, lamps over the tables, patrons in silhouette.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp, hash2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { maxHP, maxSP, effectiveStat } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, hotText, rngFor, paintWall,
  paintFloor, paintShelf, paintCounter, paintClutter, vignette, members, activeMember,
  charName, partyGold, spend, earn, addCondition, hasCondition, paintFire, contactShadow,
  MM6, C_WHITE, C_CANARY, C_DIM, C_RED, C_GREEN,
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

/**
 * A round table, painted as an object.
 *
 * The old one was a grey disc on a stick with three white cubes on it. This is
 * a top face lit from the room's key, a turned edge that falls into shadow, a
 * pedestal with splayed feet, and the dark the whole thing sits in. `s` is the
 * depth scale: a table at the back of the room is smaller than one at the
 * front, which is the entire reason the room reads as having a floor.
 */
function paintTable(g, cx, cy, s, lit = 0) {
  const rx = Math.round(44 * s), ry = Math.max(4, Math.round(13 * s));
  const edge = Math.max(2, Math.round(6 * s));
  contactShadow(g, cx + 4 * s, cy + edge + 20 * s, rx * 0.92, Math.max(2, 5 * s));
  // Pedestal: a tapered post with three feet.
  const legH = Math.round(26 * s);
  const pw = Math.max(2, Math.round(5 * s));
  for (let i = 0; i < legH; i++) {
    const t = i / legH;
    const k = Math.max(1, Math.round(pw * (0.8 + t * 0.5)));
    MM6.rct(g, cx - k, cy + i, k * 2, 1, MM6.mix([44, 28, 14], [104, 74, 40], MM6.band(0.72 - t * 0.3, 4)));
    MM6.rct(g, cx - k, cy + i, Math.max(1, Math.round(k * 0.5)), 1,
      MM6.mix([60, 40, 20], [132, 96, 54], MM6.band(0.8 - t * 0.3, 4)));
  }
  for (const [fx, fw] of [[-1, 0.9], [1, 0.9], [0, 0.6]]) {
    poly(g, [cx, cy + legH - 4 * s, cx + fx * rx * 0.55, cy + legH + 4 * s,
      cx + fx * rx * 0.55, cy + legH + 7 * s, cx, cy + legH + Math.round(2 * s)],
    MM6.pc([56, 36, 18]));
    if (fx) {
      MM6.rct(g, Math.round(cx + fx * rx * 0.55 - (fx > 0 ? 3 : 0)), Math.round(cy + legH + 4 * s),
        Math.max(2, Math.round(4 * fw)), 1, [112, 80, 44]);
    }
  }
  // The turned edge of the top, seen from just above: a band of end grain.
  for (let dy = 0; dy < edge; dy++) {
    const k = Math.round(rx * Math.sqrt(Math.max(0, 1 - ((dy - edge) * (dy - edge)) / (ry * ry * 4))));
    const v = MM6.band(0.44 - dy / edge * 0.26, 4);
    MM6.rct(g, cx - k, cy - 1 + dy, k * 2, 1, MM6.mix([30, 19, 9], [126, 90, 50], v));
  }
  // Top face. Boards run across it, and the key light rakes from the upper left.
  //
  // The lamp overhead is paid for here rather than by stamping a disc of light
  // over the finished plate: the boards under the lantern simply get painted a
  // couple of value steps hotter, in the same banded ramp as everything else,
  // which is how a 1998 illustrator lit a table.
  for (let dy = -ry; dy <= 0; dy++) {
    const k = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    if (k <= 0) continue;
    for (let dx = -k; dx <= k; dx++) {
      const v = MM6.band(0.78 - (dx / rx) * 0.16 + (dy / ry) * 0.30, 5);
      const boardEdge = (Math.round((dx + rx) / Math.max(4, 11 * s)) * Math.max(4, 11 * s)) - (dx + rx);
      const seam = Math.abs(boardEdge) < 1 ? -0.22 : 0;
      const grain = hash2(dx + 80, dy + 40, 29) * 0.10 - 0.05;
      const pool = lit
        ? lit * MM6.band(1 - Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) * 0.5), 3)
        : 0;
      const c = MM6.mix([48, 32, 16], [176, 132, 78], clamp(v + seam + grain, 0, 1));
      MM6.rct(g, cx + dx, cy + dy - 1, 1, 1,
        pool > 0 ? MM6.mix(c, [255, 206, 132], pool * 0.55) : c);
    }
  }
  // Lit arris along the far rim, shadow along the near one.
  const kf = Math.round(rx * 0.86);
  MM6.rct(g, cx - kf, cy - ry, kf * 2, 1, [198, 156, 96]);
}

/** A tankard: a pewter body with a lit side, a dark side, a handle and foam. */
function paintTankard(g, x, y, s) {
  const bw = Math.max(3, Math.round(6 * s));
  const bh = Math.max(4, Math.round(9 * s));
  for (let i = 0; i < bh; i++) {
    const t = i / bh;
    for (let dx = 0; dx < bw; dx++) {
      const u = dx / (bw - 1 || 1);
      const v = MM6.band(1 - Math.abs(u - 0.28) * 1.5 - t * 0.12, 4);
      MM6.rct(g, x + dx, y - bh + i, 1, 1, MM6.mix([46, 46, 44], [178, 178, 170], v));
    }
  }
  // Handle on the shadowed side.
  MM6.rct(g, x + bw, y - bh + 2, 1, Math.max(2, bh - 4), [88, 88, 84]);
  MM6.rct(g, x + bw - 1, y - bh + 2, 1, 1, [124, 124, 118]);
  MM6.rct(g, x + bw - 1, y - 3, 1, 1, [124, 124, 118]);
  // Ale and a head of foam.
  MM6.rct(g, x, y - bh, bw, 1, [232, 226, 206]);
  MM6.rct(g, x, y - bh - 1, Math.max(2, bw - 1), 1, [244, 240, 226]);
  MM6.rct(g, x, y - 1, bw, 1, [22, 20, 18]);
}

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

  // Hearth on the right, the room's key light. The chimney breast is coursed
  // ashlar, not a flat grey plate: blocks of jittered value with chiselled
  // joints, which is what the wall textures in §12 of the spec actually are.
  const hx = w - 104;
  const hbx = hx - 18, hby = horizon - 106, hbw = 124, hbh = 106;
  for (let y = 0; y < hbh; y++) {
    const row = Math.floor(y / 15);
    const off = (row & 1) * 17;
    for (let x = 0; x < hbw; x++) {
      const bx = (x + off) % 34;
      const joint = bx < 2 || (y % 15) < 2;
      const blk = hash2(Math.floor((x + off) / 34), row, 71);
      const v = joint ? 0.16 : 0.44 + blk * 0.30 - (y / hbh) * 0.14;
      MM6.rct(g, hbx + x, hby + y, 1, 1, MM6.mix([28, 27, 24], [174, 172, 160], MM6.band(v, 7)));
    }
  }
  // Mantel shelf.
  MM6.rct(g, hbx - 4, hby, hbw + 8, 7, [122, 118, 106]);
  MM6.rct(g, hbx - 4, hby, hbw + 8, 2, [186, 182, 168]);
  MM6.rct(g, hbx - 4, hby + 7, hbw + 8, 2, [34, 32, 28]);
  // A black socket behind the fire. Without it the tongues read as a saw-tooth
  // silhouette pasted on masonry rather than as a fire burning in a hole.
  g.fillStyle = '#0d0602'; g.fillRect(hx, horizon - 66, 78, 66);
  MM6.rct(g, hx - 3, horizon - 69, 84, 3, [22, 20, 18]);
  MM6.rct(g, hx, horizon - 66, 78, 4, [4, 3, 1]);
  MM6.rct(g, hx, horizon - 66, 4, 66, [4, 3, 1]);
  MM6.rct(g, hx + 74, horizon - 66, 4, 66, [4, 3, 1]);
  // Logs, then the fire on top of them.
  for (let i = 0; i < 3; i++) {
    const lx = hx + 14 + i * 17;
    MM6.rct(g, lx, horizon - 12, 15, 5, [56, 34, 16]);
    MM6.rct(g, lx, horizon - 12, 15, 1, [98, 66, 32]);
    MM6.rct(g, lx, horizon - 8, 15, 1, [24, 14, 6]);
  }
  paintFire(g, hx + 39, horizon - 9, 50, 34, 5);
  glow(g, hx + 39, horizon - 22, 190, '#ff8828', 1.05);

  // Bar counter along the left, bottles behind it. The shelving stops short of
  // the end of the bar so the landlord has somewhere to stand that is not
  // inside it.
  paintShelf(g, 12, 96, 108, { th: 4 });
  paintShelf(g, 12, 130, 108, { th: 4 });
  // Bottles: painted glass with a shoulder, a neck, a cork and a specular
  // stripe - not 3px bars.
  for (let i = 0; i < 9; i++) {
    const x = 18 + i * 11;
    const bh = 15 + (i % 3) * 5;
    const liq = [[138, 64, 32], [192, 112, 48], [106, 58, 24], [72, 96, 60]][i % 4];
    const top = 96 - bh;
    MM6.rct(g, x + 2, top, 3, 5, [58, 70, 62]);                 // neck
    MM6.rct(g, x + 1, top - 2, 5, 3, [96, 66, 34]);             // cork
    for (let y = top + 5; y < 96; y++) {
      const t = (y - top - 5) / Math.max(1, bh - 5);
      const k = Math.max(2, Math.round(1 + t * 3.4));
      MM6.rct(g, x + 3 - k, y, k * 2, 1, t > 0.35 ? liq : [70, 88, 78]);
      MM6.rct(g, x + 3 - k, y, 1, 1, [148, 176, 168]);
      MM6.rct(g, x + 2 + k, y, 1, 1, [30, 40, 34]);
    }
    MM6.rct(g, x + 1, top + 8, 1, Math.max(2, bh - 12), [200, 224, 220]);
    if (i < 10) { g.fillStyle = rampCss('wood', 6); g.fillRect(x + 2, 128 - 12, 4, 12); }
  }
  paintCounter(g, 0, horizon - 6, 176, 26, { cloth: null });
  // The landlord stands at the end of the bar, clear of the bottle shelf.
  figure(g, 142, horizon - 4, 96, null, null, {
    seed: 0x2c19, cloth: [116, 82, 52], skin: [212, 168, 130],
    hood: false, robe: false, apron: [186, 176, 150],
  });

  // --- tables ---------------------------------------------------------------
  //
  // Depth is the whole point here. The near table is a third bigger than the
  // far one and its patrons are taller in the same proportion, so the boards
  // actually recede; painting all three at one size is what made the room read
  // as a flat elevation. Far tables go down first, near ones over the top.
  const tables = [
    { x: 318, d: 0.14, seeds: [0x9d3, 0x41f7, 0x7b2c] },
    { x: 222, d: 0.52, seeds: [0xc48a, 0x1e65] },
    { x: 104, d: 1.00, seeds: [0x5f31, 0xa9d4] },
  ];
  for (const T of tables) {
    // Scale and station both come off the depth, so nothing has to be hand-placed.
    const s = 0.72 + T.d * 0.62;
    const ty = Math.round(horizon + 16 + T.d * 74);
    const tx = Math.round(T.x);

    // Patrons behind the table are drawn first and stand a little higher up the
    // floor, so the table edge cuts them at the waist the way it should.
    T.seeds.forEach((seed, i) => {
      if (i % 2) return;                       // odds sit in front, drawn later
      const side = i === 0 ? -1 : 1;
      figure(g, tx + side * 46 * s, ty - 6 * s, Math.round((60 + (seed & 7) * 2.5) * s),
        null, null, { seed });
    });

    paintTable(g, tx, ty, s, 1);

    // What is on the table.
    const mugs = 2 + (T.seeds.length > 2 ? 1 : 0);
    for (let i = 0; i < mugs; i++) {
      paintTankard(g, Math.round(tx - 20 * s + i * 17 * s), Math.round(ty - 5 * s), s);
    }
    // A trencher of bread, because three mugs and nothing else is a prop shelf.
    MM6.ellip(g, tx + 22 * s, ty - 6 * s, 8 * s, 3 * s, [126, 116, 92]);
    MM6.ellip(g, tx + 22 * s, ty - 7 * s, 6 * s, 2 * s, [178, 148, 96]);

    T.seeds.forEach((seed, i) => {
      if (!(i % 2)) return;
      figure(g, tx + (i === 1 ? 1 : -1) * 40 * s, ty + 20 * s,
        Math.round((64 + (seed & 7) * 2.5) * s), null, null, { seed });
    });

    // Hanging lamp: a brass lantern on a chain, and the light it paints on the
    // ceiling boards and the table below it.
    const ly = Math.round(ty - 96 * s);
    const lw = Math.max(6, Math.round(11 * s));
    MM6.rct(g, tx - 1, 0, 2, ly, [46, 40, 32]);
    MM6.rct(g, tx - 1, 0, 1, ly, [92, 82, 66]);
    MM6.rct(g, tx - lw / 2 - 1, ly - 3, lw + 2, 3, [96, 72, 30]);
    MM6.rct(g, tx - lw / 2 - 1, ly - 3, lw + 2, 1, [176, 142, 74]);
    for (let i = 0; i < 9; i++) {
      const v = MM6.band(1 - Math.abs(i / 8 - 0.3) * 1.4, 4);
      MM6.rct(g, tx - lw / 2 + i * (lw / 9), ly, Math.max(1, lw / 9 + 1), 9,
        MM6.mix([48, 34, 12], [188, 152, 76], v));
    }
    MM6.rct(g, tx - lw / 2 + 2, ly + 2, lw - 4, 6, [22, 16, 10]);
    MM6.flame(g, tx, ly + 8, 5, 8, tx);
    MM6.rct(g, tx - lw / 2 - 1, ly + 9, lw + 2, 2, [116, 88, 36]);
    // Only the brass itself and the boards immediately around it take light.
    // The wall behind a lamp hung in the middle of a room is metres away; a
    // disc of light painted onto it is the halo this screen used to have.
    glow(g, tx, ly + 5, 34 * s, '#ffc060', 0.7);
  }

  paintClutter(g, 14, h - 4, 'barrel', 38);
  paintClutter(g, 58, h - 2, 'sack', 30);
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
