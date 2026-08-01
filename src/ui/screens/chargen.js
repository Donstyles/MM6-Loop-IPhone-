// ---------------------------------------------------------------------------
// Party creation.
//
// MM6 is all-human: four characters, six base classes, seven statistics bought
// out of a shared pool, and a face picked by clicking arrows until you like the
// painting. There are no races and no Grandmaster rank anywhere in this screen.
//
// The name field takes real keystrokes on a desktop and puts an on-screen
// keyboard up when tapped, so the same screen works on a phone.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import { rampCss } from '../../core/palette.js';
import { Rand } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { PORTRAIT_W, PORTRAIT_H } from '../../art/portraits.js';
import { CLASSES, BASE_CLASSES, STATS, maxHP, maxSP, armorClass, statBonus } from '../../game/stats.js';
import { CLASS_START_SKILLS, skillById } from '../../game/skills.js';
import {
  Screen, A, portraitOf, baked, glow, poly, plate, vignette, gold, paintWall, paintFloor,
  drawWrapped, C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_GREEN, C_LEARN, hotText,
  MM6,
} from './dialogue.js';

const POOL = 25;
const MIN_STAT = 3;
const MAX_STAT = 30;

const NAMES_M = ['Roland', 'Aldric', 'Kestrel', 'Bram', 'Corin', 'Dain', 'Falk', 'Garret'];
const NAMES_F = ['Isolde', 'Mira', 'Selene', 'Wren', 'Alys', 'Runa', 'Thea', 'Yvain'];

/** Cost in pool points to raise a stat one more point. */
function costUp(v) { return v < 15 ? 1 : v < 20 ? 2 : v < 25 ? 3 : 4; }

/** A blank slot, rolled from a seed so every party starts different. */
function makeSlot(i, seed) {
  const rnd = new Rand(seed + i * 977);
  const klass = BASE_CLASSES[i % BASE_CLASSES.length];
  const sex = rnd.bool() ? 'm' : 'f';
  return {
    name: rnd.pick(sex === 'm' ? NAMES_M : NAMES_F),
    sex,
    class: klass,
    portraitSeed: (seed + i * 131) >>> 0,
    stats: Object.assign({}, CLASSES[klass].startStats),
    spent: 0,
  };
}

const KEYS = [
  'QWERTYUIOP',
  'ASDFGHJKL',
  'ZXCVBNM',
];

export class ChargenScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'chargen';
    this.seed = opts.seed || 1234;
    this.slots = [0, 1, 2, 3].map((i) => makeSlot(i, this.seed));
    this.sel = 0;
    this.editing = false;
    this.keyboard = false;
    this.t = 0;
    this.message = '';
    this.messageT = 99;
    this.onDone = opts.onDone || null;
    this.onCancel = opts.onCancel || null;
  }

  get slot() { return this.slots[this.sel]; }

  update(dt) { this.t += dt || 0; this.messageT += dt || 0; }

  say(m, color) { this.message = m; this.messageColor = color || C_WHITE; this.messageT = 0; }

  // --- model ---------------------------------------------------------------

  pointsLeft(s) { return POOL - (s.spent | 0); }

  setClass(s, klass) {
    s.class = klass;
    s.stats = Object.assign({}, CLASSES[klass].startStats);
    s.spent = 0;
  }

  raise(s, id) {
    const v = s.stats[id] | 0;
    const cost = costUp(v);
    if (v >= MAX_STAT) return;
    if (this.pointsLeft(s) < cost) { this.say('No points left to spend.', C_RED); return; }
    s.stats[id] = v + 1;
    s.spent += cost;
  }

  lower(s, id) {
    const v = s.stats[id] | 0;
    const base = CLASSES[s.class].startStats[id] | 0;
    // You may sell a stat back down to its class floor, never below.
    if (v <= Math.max(MIN_STAT, base - 8)) { this.say('That is as low as it will go.', C_RED); return; }
    s.stats[id] = v - 1;
    s.spent -= costUp(v - 1);
    if (s.spent < 0) s.spent = 0;
  }

  /** A throwaway character object, so the real derived-stat maths can run. */
  asCharacter(s) {
    return {
      name: s.name, class: s.class, klass: s.class, sex: s.sex, level: 1, age: 18,
      stats: s.stats, skills: this.startSkills(s), conditions: {}, buffs: {},
      portraitSeed: s.portraitSeed,
    };
  }

  startSkills(s) {
    const out = {};
    for (const id of (CLASS_START_SKILLS[s.class] || [])) out[id] = { level: 1, mastery: 1 };
    return out;
  }

  derived(s) {
    const ch = this.asCharacter(s);
    const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
    return {
      hp: safe(() => maxHP(ch), 20),
      sp: safe(() => maxSP(ch), 0),
      ac: safe(() => armorClass(ch), 0),
    };
  }

  cycleFace(dir) {
    const s = this.slot;
    s.portraitSeed = (s.portraitSeed + dir * 7919) >>> 0;
  }

  validate() {
    for (const s of this.slots) {
      if (!s.name || !s.name.trim()) return 'Every character needs a name.';
      if (this.pointsLeft(s) > 0) return `${s.name} has ${this.pointsLeft(s)} points still to spend.`;
    }
    return null;
  }

  done() {
    const bad = this.validate();
    if (bad) { this.say(bad, C_RED); return; }
    const party = this.slots.map((s) => {
      const ch = this.asCharacter(s);
      const d = this.derived(s);
      ch.maxHP = d.hp; ch.hp = d.hp;
      ch.maxSP = d.sp; ch.sp = d.sp;
      ch.xp = 0; ch.skillPoints = 0; ch.spells = [];
      ch.inventory = [];
      return ch;
    });
    this.sound('click');
    if (this.onDone) this.onDone(party, this);
    else if (this.session && typeof this.session.startNewGame === 'function') this.session.startNewGame(party);
  }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked('chargen', layout.w, layout.h, (g, w, h) => {
      paintWall(g, 0, 0, w, Math.round(h * 0.55), { ramp: 'stone', lo: 0.10, hi: 0.40, course: 26, seed: 303 });
      paintFloor(g, 0, Math.round(h * 0.55), w, h - Math.round(h * 0.55), { ramp: 'wood', seed: 311 });
      // A long table across the room, candles at either end.
      g.fillStyle = rampCss('wood', 4);
      g.fillRect(0, Math.round(h * 0.55) + 30, w, 34);
      g.fillStyle = rampCss('wood', 8);
      g.fillRect(0, Math.round(h * 0.55) + 30, w, 3);
      for (const cx of [70, w - 70]) {
        g.fillStyle = rampCss('sand', 13);
        g.fillRect(cx, Math.round(h * 0.55) - 22, 5, 24);
        glow(g, cx + 2, Math.round(h * 0.55) - 26, 40, '#ffc060', 0.8);
      }
      // Banners on the back wall.
      for (let i = 0; i < 4; i++) {
        const bx = 60 + i * (w - 120) / 3;
        g.fillStyle = rampCss(['blood', 'water', 'foliage', 'arcane'][i], 4);
        poly(g, [bx - 22, 16, bx + 22, 16, bx + 22, 96, bx, 112, bx - 22, 96], rampCss(['blood', 'water', 'foliage', 'arcane'][i], 4));
        g.fillStyle = rampCss('gold', 8);
        g.fillRect(bx - 24, 14, 48, 4);
      }
      vignette(g, w, h, 0.7);
    });
  }

  draw(ctx) {
    const W = layout.w, H = layout.h;
    ctx.drawImage(this.backdrop(), 0, 0);

    // Header.
    A.stone(ctx, 0, 0, W, 26, { gold: true });
    F.drawText(ctx, 'Create Your Party', 10, 3, { face: 'title', color: C_GOLD });
    F.drawText(ctx, 'Might and Magic VI - four humans, six professions', W - 10, 8,
      { face: 'small', align: 'right', color: C_DIM });

    this.drawPortraitColumn(ctx);
    this.drawClassColumn(ctx);
    this.drawStatColumn(ctx);
    this.drawSkills(ctx);
    this.drawSlots(ctx);
    if (this.keyboard) this.drawKeyboard(ctx);

    if (this.messageT < 6 && this.message) {
      const y = 336;
      plate(ctx, 160, y, W - 320, 18, 0.7);
      F.drawText(ctx, this.message, W / 2, y + 4, { align: 'center', color: this.messageColor });
    }
  }

  drawPortraitColumn(ctx) {
    const s = this.slot;
    const x = 14, y = 36;
    const pw = PORTRAIT_W * 2, ph = PORTRAIT_H * 2;
    // The plate has to cover the portrait, the face arrows, the name field and
    // the sex row - 118px of furniture below the painting.
    plate(ctx, x, y, pw + 12, ph + 118, 0.6);
    const px = x + 6, py = y + 6;
    A.inset(ctx, px - 3, py - 3, pw + 6, ph + 6);
    const p = portraitOf(this.asCharacter(s), 'normal');
    if (p) {
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(p, px, py, pw, ph);
      ctx.imageSmoothingEnabled = sm;
    } else { ctx.fillStyle = rampCss('stone', 5); ctx.fillRect(px, py, pw, ph); }
    A.portraitFrame(ctx, px - 2, py - 2, pw + 4, ph + 4, 'active');

    // Face arrows.
    const ay = py + ph + 6;
    for (const [id, label, dir, ax] of [['prev', '<', -1, px], ['next', '>', 1, px + pw - 18]]) {
      const hit = this.ui.region(`cg:face${id}`, ax, ay, 18, 18, 'Another face');
      A.button(ctx, ax, ay, 18, 18, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, ax + 9, ay + 4, { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
      if (hit.click) this.cycleFace(dir);
    }
    F.drawText(ctx, 'Face', px + pw / 2, ay + 5, { face: 'small', align: 'center', color: C_DIM });

    // Name field.
    const ny = ay + 24;
    A.inset(ctx, px, ny, pw, 20);
    const hit = this.ui.region('cg:name', px, ny, pw, 20, 'Click to rename');
    const caret = this.editing && ((this.t * 2) | 0) % 2 === 0 ? '_' : '';
    F.drawText(ctx, (s.name || '') + caret, px + 6, ny + 5, {
      color: this.editing ? C_GOLD : hit.hover ? C_GOLD : C_WHITE, maxWidth: pw - 12,
    });
    if (hit.click) { this.editing = true; this.keyboard = true; }

    // Sex toggle.
    const sy = ny + 26;
    F.drawText(ctx, 'Sex', px, sy, { face: 'small', color: C_DIM });
    let sx = px + 30;
    for (const [id, label] of [['m', 'Male'], ['f', 'Female']]) {
      const on = s.sex === id;
      const r = hotText(this.ui, ctx, `cg:sex${id}`, sx, sy - 1, label,
        { face: 'small', color: on ? C_GOLD : C_WHITE });
      if (on) { ctx.fillStyle = C_GOLD; ctx.fillRect(r.x, sy + 8, r.w, 1); }
      if (r.click) { s.sex = id; }
      sx += r.w + 12;
    }
  }

  drawClassColumn(ctx) {
    const x = 162, y = 36, w = 172;
    plate(ctx, x, y, w, 230, 0.62);
    F.drawText(ctx, 'Profession', x + 8, y + 5, { color: C_CANARY });
    A.rule(ctx, x + 6, y + 20, w - 12, '#7a6a4a');
    const s = this.slot;
    BASE_CLASSES.forEach((id, i) => {
      const ry = y + 26 + i * 17;
      const on = s.class === id;
      const k = CLASSES[id];
      const hit = this.ui.region(`cg:class${id}`, x + 6, ry - 2, w - 12, 16, k.desc);
      if (on) {
        MM6.carvedPlate(ctx, x + 6, ry - 2, w - 12, 16,
          { state: 'down', material: 'stone', seed: 19 });
      }
      F.drawText(ctx, k.name, x + 12, ry, { color: on ? C_GOLD : hit.hover ? C_GOLD : C_WHITE });
      if (hit.click) this.setClass(s, id);
    });

    // Description of the selected class.
    const dy = y + 132;
    A.rule(ctx, x + 6, dy - 6, w - 12, '#7a6a4a');
    drawWrapped(ctx, CLASSES[s.class].desc, x + 10, dy, w - 20,
      { face: 'small', lineHeight: 10, color: C_WHITE });
  }

  drawStatColumn(ctx) {
    const s = this.slot;
    const x = 342, y = 36, w = layout.w - x - 14;
    plate(ctx, x, y, w, 230, 0.62);
    F.drawText(ctx, 'Statistics', x + 8, y + 5, { color: C_CANARY });
    F.drawText(ctx, `Points: ${this.pointsLeft(s)}`, x + w - 8, y + 6, {
      align: 'right', color: this.pointsLeft(s) > 0 ? C_GREEN : C_DIM,
    });
    A.rule(ctx, x + 6, y + 20, w - 12, '#7a6a4a');

    STATS.forEach((st, i) => {
      const ry = y + 26 + i * 17;
      const v = s.stats[st.id] | 0;
      const base = CLASSES[s.class].startStats[st.id] | 0;
      F.drawText(ctx, st.name, x + 10, ry, { color: C_WHITE, tip: st.desc });
      const col = v > base ? C_GREEN : v < base ? C_RED : C_WHITE;
      F.drawText(ctx, String(v), x + 148, ry, { align: 'right', color: col });
      // Carved keys with a painted chevron cut into them - MM6 has no chips.
      for (const [id, dir, ax] of [['dn', -1, x + 194], ['up', 1, x + 214]]) {
        const hit = this.ui.region(`cg:${st.id}${id}`, ax, ry - 2, 16, 15,
          dir > 0 ? `Costs ${costUp(v)} point${costUp(v) > 1 ? 's' : ''}` : 'Sell one point back');
        const d = MM6.carvedPlate(ctx, ax, ry - 2, 16, 15,
          { state: hit.down ? 'down' : hit.hover ? 'hot' : 'up', material: 'brass', seed: 7 });
        const col = hit.hover ? [244, 224, 120] : [232, 216, 176];
        const shd = [40, 30, 12];
        for (let k = 0; k < 4; k++) {
          const yy = ry + 2 + d + (dir > 0 ? k : 3 - k);
          MM6.rct(ctx, ax + 8 - k + d, yy + 1, 1, 1, shd);
          MM6.rct(ctx, ax + 7 + k + d, yy + 1, 1, 1, shd);
          MM6.rct(ctx, ax + 8 - k + d, yy, 1, 1, col);
          MM6.rct(ctx, ax + 7 + k + d, yy, 1, 1, col);
        }
        if (hit.click) { if (dir > 0) this.raise(s, st.id); else this.lower(s, st.id); }
      }
      F.drawText(ctx, `${costUp(v)}pt`, x + w - 8, ry + 1,
        { face: 'small', align: 'right', color: C_DIM });
    });

    // Derived block, updating as the arrows are clicked.
    const d = this.derived(s);
    const dy = y + 152;
    A.rule(ctx, x + 6, dy - 6, w - 12, '#7a6a4a');
    const rows = [
      ['Hit Points', String(d.hp), C_CANARY],
      ['Spell Points', d.sp ? String(d.sp) : '-', d.sp ? C_CANARY : C_DIM],
      ['Armour Class', String(d.ac), C_CANARY],
    ];
    rows.forEach(([l, v, c], i) => {
      const ry = dy + i * 15;
      F.drawText(ctx, l, x + 10, ry, { face: 'small', color: C_WHITE });
      F.drawText(ctx, v, x + 150, ry, { face: 'small', align: 'right', color: c });
    });
    const k = CLASSES[s.class];
    F.drawText(ctx, k.spStat ? `Spell points from ${k.spStat === 'both' ? 'Intellect & Personality' : k.spStat}`
      : 'Casts no spells', x + 190, dy, { face: 'small', color: C_DIM, maxWidth: w - 200 });
    F.drawText(ctx, `Promotes to ${k.promotesTo ? CLASSES[k.promotesTo].name : '-'}`,
      x + 190, dy + 15, { face: 'small', color: C_DIM, maxWidth: w - 200 });
  }

  drawSkills(ctx) {
    const s = this.slot;
    const x = 162, y = 272, w = layout.w - x - 14;
    plate(ctx, x, y, w, 58, 0.62);
    F.drawText(ctx, 'Starting Skills', x + 8, y + 4, { color: C_CANARY });
    const list = CLASS_START_SKILLS[s.class] || [];
    let sx = x + 10, sy = y + 20;
    for (const id of list) {
      const def = skillById(id);
      const label = def ? def.name : id;
      F.drawText(ctx, label, sx, sy, { face: 'small', color: C_LEARN });
      const wdt = F.measure(label, 'small').w;
      F.drawText(ctx, 'Normal', sx, sy + 10, { face: 'small', color: C_DIM });
      sx += Math.max(wdt, F.measure('Normal', 'small').w) + 18;
      if (sx > x + w - 60) { sx = x + 10; sy += 22; }
    }
  }

  drawSlots(ctx) {
    const W = layout.w, H = layout.h;
    const y = H - 128;
    A.stone(ctx, 0, y, W, 128, { rivets: true, gold: true });
    this.slots.forEach((s, i) => {
      const x = 14 + i * 108;
      const on = i === this.sel;
      const hit = this.ui.region(`cg:slot${i}`, x - 4, y + 6, PORTRAIT_W + 8, PORTRAIT_H + 34, s.name);
      const p = portraitOf(this.asCharacter(s), on ? 'smile' : 'normal');
      if (p) ctx.drawImage(p, x, y + 10);
      else { ctx.fillStyle = rampCss('stone', 5); ctx.fillRect(x, y + 10, PORTRAIT_W, PORTRAIT_H); }
      A.portraitFrame(ctx, x - 2, y + 8, PORTRAIT_W + 4, PORTRAIT_H + 4, on ? 'active' : 'normal');
      F.drawText(ctx, s.name, x + PORTRAIT_W / 2, y + PORTRAIT_H + 14,
        { face: 'small', align: 'center', color: on ? C_GOLD : C_WHITE, maxWidth: PORTRAIT_W + 8 });
      F.drawText(ctx, CLASSES[s.class].name, x + PORTRAIT_W / 2, y + PORTRAIT_H + 24,
        { face: 'small', align: 'center', color: C_DIM, maxWidth: PORTRAIT_W + 8 });
      if (hit.click) { this.sel = i; this.editing = false; }
    });

    // Party summary and the two commands.
    const sx = 14 + 4 * 108 + 8;
    const sw = W - sx - 14;
    F.drawText(ctx, 'The Party', sx, y + 10, { color: C_CANARY });
    const left = this.slots.reduce((t, s) => t + this.pointsLeft(s), 0);
    F.drawText(ctx, left ? `${left} points unspent` : 'All points spent',
      sx, y + 24, { face: 'small', color: left ? C_RED : C_GREEN });
    F.drawText(ctx, 'Click a portrait to edit that character.', sx, y + 36,
      { face: 'small', color: C_DIM, maxWidth: sw });

    const bw = Math.min(120, sw), bh = 26;
    const bx = sx, by = y + 56;
    const dh = this.ui.region('cg:done', bx, by, bw, bh, 'Begin the game');
    A.button(ctx, bx, by, bw, bh, null, dh.down ? 'down' : 'up');
    F.drawText(ctx, 'Done', bx + bw / 2, by + 7, { align: 'center', color: dh.hover ? C_GOLD : C_WHITE });
    if (dh.click) this.done();

    const ch2 = this.ui.region('cg:back', bx, by + 32, bw, bh, 'Back to the title screen');
    A.button(ctx, bx, by + 32, bw, bh, null, ch2.down ? 'down' : 'up');
    F.drawText(ctx, 'Back', bx + bw / 2, by + 39, { align: 'center', color: ch2.hover ? C_GOLD : C_WHITE });
    if (ch2.click) { if (this.onCancel) this.onCancel(this); else this.close(); }
  }

  /** Touch keyboard: MM6 never needed one, but a phone does. */
  drawKeyboard(ctx) {
    const w = 400, h = 132;
    const x = Math.round((layout.w - w) / 2), y = 190;
    A.stone(ctx, x, y, w, h, { rivets: true, gold: true });
    A.inset(ctx, x + 6, y + 6, w - 12, 20);
    F.drawText(ctx, this.slot.name || '', x + 12, y + 11, { color: C_GOLD });
    F.drawText(ctx, 'Name', x + w - 12, y + 11, { face: 'small', align: 'right', color: C_DIM });

    const kw = 34, kh = 20;
    KEYS.forEach((row, r) => {
      const rw = row.length * (kw + 2);
      let kx = x + Math.round((w - rw) / 2);
      const ky = y + 32 + r * (kh + 3);
      for (const ch of row) {
        const hit = this.ui.region(`cg:k${ch}`, kx, ky, kw, kh);
        A.button(ctx, kx, ky, kw, kh, null, hit.down ? 'down' : 'up');
        F.drawText(ctx, ch, kx + kw / 2, ky + 5, { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
        if (hit.click) this.typeChar(ch);
        kx += kw + 2;
      }
    });
    const by = y + h - 26;
    const defs = [['space', 'Space', 120], ['back', 'Back', 80], ['ok', 'Done', 80]];
    let bx = x + 20;
    for (const [id, label, bw] of defs) {
      const hit = this.ui.region(`cg:kb${id}`, bx, by, bw, 20);
      A.button(ctx, bx, by, bw, 20, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, bx + bw / 2, by + 5, { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
      if (hit.click) {
        if (id === 'space') this.typeChar(' ');
        else if (id === 'back') this.backspace();
        else { this.keyboard = false; this.editing = false; }
      }
      bx += bw + 14;
    }
  }

  typeChar(ch) {
    const s = this.slot;
    if ((s.name || '').length >= 12) return;
    // Capitalise the first letter, lower-case the rest, like the original.
    s.name = (s.name || '') + (s.name ? ch.toLowerCase() : ch.toUpperCase());
  }

  backspace() {
    const s = this.slot;
    s.name = (s.name || '').slice(0, -1);
  }

  handleKey(code) {
    if (code === 'Escape') {
      if (this.keyboard || this.editing) { this.keyboard = false; this.editing = false; return true; }
      if (this.onCancel) { this.onCancel(this); return true; }
      this.close();
      return true;
    }
    if (this.editing) {
      if (code === 'Backspace') { this.backspace(); return true; }
      if (code === 'Enter') { this.editing = false; this.keyboard = false; return true; }
      if (code === 'Space') { this.typeChar(' '); return true; }
      const m = /^Key([A-Z])$/.exec(code);
      if (m) { this.typeChar(m[1]); return true; }
      return true;
    }
    const d = /^Digit([1-4])$/.exec(code);
    if (d) { this.sel = +d[1] - 1; return true; }
    if (code === 'Tab') { this.sel = (this.sel + 1) % 4; return true; }
    return false;
  }
}

export default ChargenScreen;
