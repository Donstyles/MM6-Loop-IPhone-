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

import { layout, mmToLogical, isTouchDevice } from '../../core/layout.js';
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

/**
 * What each profession actually wants, best first. The Recommended button
 * walks these in order, cheapest ranks first, so the spend looks like a
 * veteran's - fighters buy Might and Endurance, casters buy their spell stat.
 */
const STAT_PRIORITY = {
  knight: ['might', 'endurance', 'speed', 'accuracy', 'luck', 'personality', 'intellect'],
  paladin: ['might', 'personality', 'endurance', 'speed', 'accuracy', 'luck', 'intellect'],
  archer: ['accuracy', 'speed', 'might', 'endurance', 'intellect', 'luck', 'personality'],
  cleric: ['personality', 'endurance', 'might', 'speed', 'luck', 'accuracy', 'intellect'],
  sorcerer: ['intellect', 'speed', 'endurance', 'accuracy', 'luck', 'might', 'personality'],
  druid: ['intellect', 'personality', 'endurance', 'speed', 'luck', 'might', 'accuracy'],
};

/** Per-priority ceiling: the first stat is worth 25, the tail stays modest. */
const STAT_CAPS = [25, 20, 18, 15, 15, 13, 12];

export class ChargenScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'chargen';
    // Party creation always owns the whole frame. Leaving this to the caller
    // meant a debug-opened chargen composited under the HUD with its Done and
    // Back buttons clipped away.
    this.fullFrame = true;
    this.seed = opts.seed || 1234;
    this.slots = [0, 1, 2, 3].map((i) => makeSlot(i, this.seed));
    // No two rolled companions share a name (Selene and Selene read as a bug).
    const used = new Set();
    this.slots.forEach((s, i) => {
      const pool = s.sex === 'm' ? NAMES_M : NAMES_F;
      let k = pool.indexOf(s.name);
      if (k < 0) k = 0;
      let tries = 0;
      while (used.has(s.name) && tries < pool.length) {
        k = (k + 1) % pool.length;
        s.name = pool[k];
        tries++;
      }
      used.add(s.name);
    });
    this.sel = 0;
    this.editing = false;
    this.keyboard = false;
    this.t = 0;
    this.message = '';
    this.messageT = 99;
    this.onDone = opts.onDone || null;
    this.onCancel = opts.onCancel || null;
    /** Leave-confirmation plaque, up when Back is pressed with points unspent. */
    this.confirmLeave = false;
  }

  /** Back / Escape: confirm before discarding a party with points unspent
   *  (wowjudge chargen beat). A fully-spent party leaves without ceremony. */
  requestLeave() {
    const left = this.slots.reduce((t, sl) => t + this.pointsLeft(sl), 0);
    if (left > 0) { this.confirmLeave = true; return; }
    this.doLeave();
  }

  doLeave() {
    this.confirmLeave = false;
    if (this.onCancel) this.onCancel(this); else this.close();
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
    if (v >= MAX_STAT) { this.say('That is as high as it will go.', C_RED); return; }
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

  // --- touch metrics ---------------------------------------------------------

  /** True when the screen should lay out for thumbs rather than a pointer. */
  get touch() { return isTouchDevice(); }

  /**
   * Row pitch for the class and stat tables: 7 mm on touch, clamped to what
   * the frame can actually hold (a landscape phone cannot give seven rows
   * 7 mm each without burying the derived block).
   */
  get rowPitch() {
    if (!this.touch) return 17;
    const room = Math.floor((layout.h - this.barH - 36 - 150) / 7);
    // +4 so the chip inside the row (pitch - 2) still clears a full 7 mm.
    return Math.max(17, Math.min(mmToLogical(7) + 4, room));
  }

  /** The bottom slots bar grows on portrait phones for thumb-sized commands. */
  get barH() {
    if (!(this.touch && layout.portrait)) return 128;
    const bh = Math.max(48, mmToLogical(9));
    return Math.round(Math.max(128, 3 * (bh + 10) + 54) + (layout.safe.bottom || 0));
  }

  /** Auto-spend one slot's remaining points down its class priority list. */
  recommend(s) {
    const prio = STAT_PRIORITY[s.class] || STATS.map((st) => st.id);
    let guard = 400;
    let moved = true;
    while (moved && this.pointsLeft(s) > 0 && guard-- > 0) {
      moved = false;
      for (let i = 0; i < prio.length; i++) {
        const id = prio[i];
        const v = s.stats[id] | 0;
        const cap = STAT_CAPS[i] || 12;
        if (v >= Math.min(cap, MAX_STAT)) continue;
        const cost = costUp(v);
        if (this.pointsLeft(s) < cost) continue;
        s.stats[id] = v + 1;
        s.spent += cost;
        moved = true;
        if (this.pointsLeft(s) <= 0) break;
      }
    }
  }

  /** The Recommended Build button: every slot spends its points sensibly. */
  recommendAll() {
    for (const s of this.slots) this.recommend(s);
    this.sound('click');
    this.say('Points spent. Adjust anything you like, then press Done.', C_GREEN);
  }

  validate() {
    for (const s of this.slots) {
      if (!s.name || !s.name.trim()) return 'Every character needs a name.';
      if (this.pointsLeft(s) > 0) {
        const n = this.pointsLeft(s);
        return `${s.name} has ${n} point${n === 1 ? '' : 's'} still to spend - `
          + 'the Recommended button spends them sensibly.';
      }
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
      // Two hanging banners at the far edges of the hall - painted cloth with
      // folds, a bordered field and a charge, in muted heraldic colours. Not
      // colour-coded ribbons behind the columns.
      for (const [bx, cloth, trim] of [[42, [104, 40, 34], [172, 140, 72]],
        [w - 42, [46, 56, 92], [172, 140, 72]]]) {
        for (let y = 16; y < 112; y++) {
          const t = (y - 16) / 96;
          // Swallow-tail hem: the cloth cuts away below three-quarters.
          const cut = t < 0.80 ? 0 : Math.round((t - 0.80) * 5 * 22);
          for (let x = -22; x <= 22; x++) {
            if (Math.abs(x) < cut) continue;
            // Folds: a slow sine across the width, quantised into bands.
            const fold = Math.sin((x + 22) * 0.42) * 0.5 + 0.5;
            const k = 0.62 + Math.round(fold * 4) / 4 * 0.5;
            const border = Math.abs(x) > 18 || y < 22 ? 1.35 : 1;
            const c = Math.abs(x) > 18 || y < 22 ? trim : cloth;
            MM6.rct(g, bx + x, y, 1, 1, MM6.shade(c, k * border));
          }
        }
        // Charge: a painted lozenge at the centre of the field.
        for (let i = 0; i < 9; i++) {
          const kw = 9 - Math.abs(i - 4) * 2;
          MM6.rct(g, bx - kw, 52 + i * 2, kw * 2, 2, MM6.shade(trim, i < 4 ? 1.15 : 0.75));
        }
        MM6.rct(g, bx - 24, 13, 48, 4, [86, 70, 40]);
        MM6.rct(g, bx - 24, 13, 48, 1, [148, 124, 70]);
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

    // Refusals surface as a big centred toast - the old one-line whisper in
    // the middle of a busy panel read as a dead Done button on a phone.
    if (this.messageT < 5 && this.message) {
      const tw = Math.min(W - 80, 460);
      const lines = F.wrapText ? F.wrapText(this.message, tw - 40, 'normal') : [this.message];
      const th = 34 + lines.length * 14;
      const tx = Math.round((W - tw) / 2);
      const ty = Math.round(Math.min(H * 0.36, H - this.barH - th - 20));
      MM6.rct(ctx, tx + 4, ty + 4, tw, th, [12, 9, 6]);
      MM6.carvedPlate(ctx, tx, ty, tw, th, { material: 'wood', seed: 33 });
      MM6.carvedWell(ctx, tx + 5, ty + 5, tw - 10, th - 10, { material: 'wood', seed: 36 });
      lines.forEach((l, i) => {
        F.drawText(ctx, l, W / 2, ty + 16 + i * 14,
          { align: 'center', color: this.messageColor || C_WHITE });
      });
    }

    if (this.confirmLeave) this.drawLeaveConfirm(ctx, W, H);
  }

  /** "Leave with points unspent?" - a carved plaque with two honest keys. */
  drawLeaveConfirm(ctx, W, H) {
    const left = this.slots.reduce((t, sl) => t + this.pointsLeft(sl), 0);
    MM6.stipple(ctx, 0, 0, W, H, [8, 7, 5], 0.5);
    const bw = this.touch ? Math.max(96, mmToLogical(16)) : 96;
    const bh = this.touch ? Math.max(30, mmToLogical(7.5)) : 30;
    const pw = Math.min(W - 60, Math.max(340, bw * 2 + 80));
    const ph = 92 + bh;
    const x = Math.round((W - pw) / 2);
    const y = Math.round(Math.min(H * 0.3, H - this.barH - ph - 16));
    MM6.rct(ctx, x + 4, y + 4, pw, ph, [12, 9, 6]);
    MM6.carvedPlate(ctx, x, y, pw, ph, { material: 'wood', seed: 41 });
    MM6.carvedWell(ctx, x + 5, y + 5, pw - 10, ph - 10, { material: 'wood', seed: 44 });
    F.drawText(ctx, 'Return to the title screen?', W / 2, y + 18,
      { align: 'center', color: C_GOLD });
    F.drawText(ctx, left > 0
      ? `${left} point${left === 1 ? '' : 's'} still unspent - this party will be discarded.`
      : 'This party will be discarded.',
    W / 2, y + 36, { face: 'small', align: 'center', color: C_WHITE, maxWidth: pw - 30 });
    const by = y + ph - bh - 14;
    const gap = 24;
    const bx1 = Math.round(W / 2 - bw - gap / 2), bx2 = Math.round(W / 2 + gap / 2);
    const stay = this.ui.region('cg:leave:no', bx1, by, bw, bh, 'Keep building the party');
    const go = this.ui.region('cg:leave:yes', bx2, by, bw, bh, 'Discard and leave');
    let d = A.button(ctx, bx1, by, bw, bh, null, stay.down ? 'down' : stay.hover ? 'hot' : 'up');
    F.drawText(ctx, 'Stay', bx1 + bw / 2 + d, by + (bh - 11) / 2 + d,
      { align: 'center', color: stay.hover ? C_GOLD : C_WHITE });
    d = A.button(ctx, bx2, by, bw, bh, null, go.down ? 'down' : go.hover ? 'hot' : 'up');
    F.drawText(ctx, 'Leave', bx2 + bw / 2 + d, by + (bh - 11) / 2 + d,
      { align: 'center', color: go.hover ? C_GOLD : C_WHITE });
    if (stay.click) { this.confirmLeave = false; this.sound('click'); }
    if (go.click) { this.sound('click'); this.doLeave(); }
  }

  drawPortraitColumn(ctx) {
    const s = this.slot;
    const x = 14, y = 36;
    const pw = PORTRAIT_W * 2, ph = PORTRAIT_H * 2;
    // The plate has to cover the portrait, the face arrows, the name field and
    // the sex row - whose heights grow to thumb size on touch.
    const abH = this.touch ? Math.max(24, Math.min(mmToLogical(7), 76)) : 18;
    const nhH = Math.max(20, this.touch ? Math.min(mmToLogical(7), 48) : 20);
    const shH = Math.max(12, this.touch ? Math.min(mmToLogical(7), 76) : 12);
    plate(ctx, x, y, pw + 12, ph + abH + nhH + shH + 46, 0.6);
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

    // Face arrows: thumb-sized on touch, classic 18px keys with a mouse.
    const ab = this.touch ? Math.max(24, Math.min(mmToLogical(7), 76)) : 18;
    const ay = py + ph + 6;
    for (const [id, label, dir, ax] of [['prev', '<', -1, px], ['next', '>', 1, px + pw - ab]]) {
      const hit = this.ui.region(`cg:face${id}`, ax, ay, ab, ab, 'Another face');
      A.button(ctx, ax, ay, ab, ab, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, ax + ab / 2, ay + (ab - 10) / 2, { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
      if (hit.click) this.cycleFace(dir);
    }
    F.drawText(ctx, 'Face', px + pw / 2, ay + (ab - 8) / 2, { face: 'small', align: 'center', color: C_DIM });

    // Name field.
    const nh = Math.max(20, this.touch ? Math.min(mmToLogical(7), 48) : 20);
    const ny = ay + ab + 6;
    A.inset(ctx, px, ny, pw, nh);
    const hit = this.ui.region('cg:name', px, ny, pw, nh, 'Click to rename');
    const caret = this.editing && ((this.t * 2) | 0) % 2 === 0 ? '_' : '';
    F.drawText(ctx, (s.name || '') + caret, px + 6, ny + (nh - 10) / 2, {
      color: this.editing ? C_GOLD : hit.hover ? C_GOLD : C_WHITE, maxWidth: pw - 12,
    });
    if (hit.click) { this.editing = true; this.keyboard = true; }

    // Sex toggle: the hit rows are a full 7 mm tall on touch.
    const sh = Math.max(12, this.touch ? Math.min(mmToLogical(7), 76) : 12);
    const sy = ny + nh + 6 + (sh - 10) / 2;
    F.drawText(ctx, 'Sex', px, sy, { face: 'small', color: C_DIM });
    let sx = px + 30;
    for (const [id, label] of [['m', 'Male'], ['f', 'Female']]) {
      const on = s.sex === id;
      const r = hotText(this.ui, ctx, `cg:sex${id}`, sx, sy - 1, label,
        { face: 'small', color: on ? C_GOLD : C_WHITE, hitH: sh });
      if (on) { ctx.fillStyle = C_GOLD; ctx.fillRect(r.x, sy + 8, r.w, 1); }
      if (r.click) { s.sex = id; }
      sx += r.w + 16;
    }
  }

  drawClassColumn(ctx) {
    const pitch = this.rowPitch;
    const x = 162, y = 36, w = 172;
    const descH = 76;
    const colH = 26 + BASE_CLASSES.length * pitch + descH;
    plate(ctx, x, y, w, colH, 0.62);
    F.drawText(ctx, 'Profession', x + 8, y + 5, { color: C_CANARY });
    A.rule(ctx, x + 6, y + 20, w - 12, '#7a6a4a');
    const s = this.slot;
    BASE_CLASSES.forEach((id, i) => {
      const ry = y + 26 + i * pitch + Math.max(0, (pitch - 12) >> 1);
      const on = s.class === id;
      const k = CLASSES[id];
      const hit = this.ui.region(`cg:class${id}`, x + 6, y + 26 + i * pitch, w - 12, pitch - 1, k.desc);
      if (on) {
        MM6.carvedPlate(ctx, x + 6, y + 26 + i * pitch, w - 12, pitch - 1,
          { state: 'down', material: 'stone', seed: 19 });
      }
      F.drawText(ctx, k.name, x + 12, ry, { color: on ? C_GOLD : hit.hover ? C_GOLD : C_WHITE });
      if (hit.click) this.setClass(s, id);
    });

    // Description of the selected class.
    const dy = y + 26 + BASE_CLASSES.length * pitch + 8;
    A.rule(ctx, x + 6, dy - 6, w - 12, '#7a6a4a');
    drawWrapped(ctx, CLASSES[s.class].desc, x + 10, dy, w - 20,
      { face: 'small', lineHeight: 10, color: C_WHITE });
    this._classBottom = y + colH;
  }

  drawStatColumn(ctx) {
    const s = this.slot;
    const pitch = this.rowPitch;
    const x = 342, y = 36, w = layout.w - x - 14;
    const colH = 26 + STATS.length * pitch + 100;
    plate(ctx, x, y, w, colH, 0.62);
    F.drawText(ctx, 'Statistics', x + 8, y + 5, { color: C_CANARY });
    F.drawText(ctx, `Points: ${this.pointsLeft(s)}`, x + w - 8, y + 6, {
      align: 'right', color: this.pointsLeft(s) > 0 ? C_GREEN : C_DIM,
    });
    A.rule(ctx, x + 6, y + 20, w - 12, '#7a6a4a');

    // Chips are square keys a full row tall: 7 mm on touch, 15 px with a mouse.
    const chip = Math.max(15, pitch - 2);
    const upX = x + w - chip - 8;
    const dnX = upX - chip - 6;
    STATS.forEach((st, i) => {
      const top = y + 26 + i * pitch;
      const ry = top + Math.max(0, (pitch - 12) >> 1);
      const v = s.stats[st.id] | 0;
      const base = CLASSES[s.class].startStats[st.id] | 0;
      F.drawText(ctx, st.name, x + 10, ry, { color: C_WHITE, tip: st.desc });
      const col = v > base ? C_GREEN : v < base ? C_RED : C_WHITE;
      F.drawText(ctx, String(v), x + 112, ry, { align: 'right', color: col });
      // Cost sits between the value and the keys, never under either.
      if (dnX - 8 - (x + 122) > 20) {
        F.drawText(ctx, `${costUp(v)}pt`, x + 122, ry + 1, { face: 'small', color: C_DIM });
      }
      // Carved keys with a painted chevron cut into them - MM6 has no chips.
      for (const [id, dir, ax] of [['dn', -1, dnX], ['up', 1, upX]]) {
        const hit = this.ui.region(`cg:${st.id}${id}`, ax, top, chip, chip - 1,
          dir > 0 ? `Costs ${costUp(v)} point${costUp(v) > 1 ? 's' : ''}` : 'Sell one point back');
        const d = MM6.carvedPlate(ctx, ax, top, chip, chip - 1,
          { state: hit.down ? 'down' : hit.hover ? 'hot' : 'up', material: 'brass', seed: 7 });
        const colc = hit.hover ? [244, 224, 120] : [232, 216, 176];
        const shd = [40, 30, 12];
        // The chevron scales with the key so a 7 mm chip does not carry a
        // 4-pixel mark in the middle of a blank plate.
        const steps = Math.max(4, Math.round(chip / 4));
        const cxm = ax + (chip >> 1) + d;
        const cy0 = top + ((chip - steps) >> 1) + d;
        for (let k = 0; k < steps; k++) {
          const yy = cy0 + (dir > 0 ? k : steps - 1 - k);
          MM6.rct(ctx, cxm - k, yy + 1, 1, 1, shd);
          MM6.rct(ctx, cxm - 1 + k, yy + 1, 1, 1, shd);
          MM6.rct(ctx, cxm - k, yy, 1, 1, colc);
          MM6.rct(ctx, cxm - 1 + k, yy, 1, 1, colc);
        }
        if (hit.click) { if (dir > 0) this.raise(s, st.id); else this.lower(s, st.id); }
      }
    });

    // Derived block, updating as the arrows are clicked.
    const d = this.derived(s);
    const dy = y + 26 + STATS.length * pitch + 12;
    A.rule(ctx, x + 6, dy - 6, w - 12, '#7a6a4a');
    const rows = [
      ['Hit Points', String(d.hp), C_CANARY],
      ['Spell Points', d.sp ? String(d.sp) : '-', d.sp ? C_CANARY : C_DIM],
      ['Armor Class', String(d.ac), C_CANARY],
    ];
    // The value column is placed off the widest label, not off a guessed x, so
    // the wider serif face cannot push the numbers into the notes.
    let labelW = 0;
    for (const [l] of rows) labelW = Math.max(labelW, F.measure(l, 'small').w);
    rows.forEach(([l, v, c], i) => {
      const ry = dy + i * 15;
      F.drawText(ctx, l, x + 10, ry, { face: 'small', color: C_WHITE });
      F.drawText(ctx, v, x + 22 + labelW, ry, { face: 'small', align: 'right', color: c });
    });
    // Class notes wrap across the full width under the block: nothing here is
    // allowed to end in an ellipsis.
    const k = CLASSES[s.class];
    const note = (k.spStat
      ? `Spell points from ${k.spStat === 'both' ? 'Intellect and Personality' : k.spStat}.`
      : 'Casts no spells.')
      + (k.promotesTo ? ` Promotes to ${CLASSES[k.promotesTo].name}.` : '');
    drawWrapped(ctx, note, x + 10, dy + 48, w - 20,
      { face: 'small', color: C_DIM, lineHeight: 10, maxLines: 3 });
    this._statBottom = y + colH;
  }

  drawSkills(ctx) {
    const s = this.slot;
    // Below whichever column runs deeper - it used to paint straight across
    // the stat column's derived block on tall touch layouts.
    const x = 162, y = Math.max(this._classBottom || 264, this._statBottom || 264) + 8;
    const w = layout.w - x - 14;
    // A cramped landscape frame may leave no band for it; the skills repeat
    // on the character sheet anyway, so it folds rather than overlapping.
    if (y + 40 > layout.h - this.barH - 4) return;
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
    const barH = this.barH;
    const y = H - barH;
    A.stone(ctx, 0, y, W, barH, { rivets: true, gold: true });
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
      const left = this.pointsLeft(s);
      if (left > 0) {
        F.drawText(ctx, `${left}pt`, x + PORTRAIT_W - 4, y + 12,
          { face: 'small', align: 'right', color: C_GREEN });
      }
      if (hit.click) { this.sel = i; this.editing = false; }
    });

    // Party summary and the three commands: Recommended, Done, Back.
    const sx = 14 + 4 * 108 + 8;
    const sw = W - sx - 14;
    F.drawText(ctx, 'The Party', sx, y + 10, { color: C_CANARY });
    const left = this.slots.reduce((t, s) => t + this.pointsLeft(s), 0);
    F.drawText(ctx, left ? `${left} point${left === 1 ? '' : 's'} unspent` : 'All points spent',
      sx, y + 24, { face: 'small', color: left ? C_RED : C_GREEN });

    const big = this.touch && layout.portrait;
    const bh = big ? Math.max(48, mmToLogical(9)) : 26;
    const step = bh + (big ? 10 : 5);
    const bw = Math.min(big ? 168 : 120, sw);
    const bx = sx;
    let by = y + 38;
    const cmd = (id, label, tip, hot) => {
      const hit = this.ui.region(`cg:${id}`, bx, by, bw, bh, tip);
      const d = A.button(ctx, bx, by, bw, bh, null, hit.down ? 'down' : hit.hover ? 'hot' : 'up');
      F.drawText(ctx, label, bx + bw / 2 + d, by + (bh - 11) / 2 + d,
        { align: 'center', color: hot ? C_GOLD : hit.hover ? C_GOLD : C_WHITE });
      by += step;
      return hit.click;
    };
    // Recommended first and lit while points remain: the fastest path from a
    // cold open to the world is one tap here and one on Done.
    if (cmd('auto', 'Recommended', 'Spend every character\'s points sensibly', left > 0)) this.recommendAll();
    if (cmd('done', 'Done', 'Begin the game', false)) this.done();
    if (cmd('back', 'Back', 'Back to the title screen', false)) this.requestLeave();
  }

  /** Touch keyboard: MM6 never needed one, but a phone does. */
  drawKeyboard(ctx) {
    // Keys grow toward 6.5 mm on touch, clamped to what ten columns allow.
    const kw = this.touch ? Math.max(34, Math.min(mmToLogical(6.5), Math.floor((layout.w - 44) / 10) - 2)) : 34;
    const kh = this.touch ? Math.max(20, Math.min(mmToLogical(6.5), 52)) : 20;
    const w = Math.min(layout.w - 8, 10 * (kw + 2) + 40);
    const bhh0 = Math.max(20, kh);
    const h = 32 + 3 * (kh + 3) + bhh0 + 16;
    const x = Math.round((layout.w - w) / 2);
    const y = Math.min(190, layout.h - this.barH - h - 8);
    A.stone(ctx, x, y, w, h, { rivets: true, gold: true });
    A.inset(ctx, x + 6, y + 6, w - 12, 20);
    F.drawText(ctx, this.slot.name || '', x + 12, y + 11, { color: C_GOLD });
    F.drawText(ctx, 'Name', x + w - 12, y + 11, { face: 'small', align: 'right', color: C_DIM });
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
    const bhh = Math.max(20, kh);
    const by = y + 32 + 3 * (kh + 3) + 6;
    const defs = [['space', 'Space', Math.round(w * 0.3)], ['back', 'Back', Math.round(w * 0.2)], ['ok', 'Done', Math.round(w * 0.2)]];
    let bx = x + 20;
    for (const [id, label, bw] of defs) {
      const hit = this.ui.region(`cg:kb${id}`, bx, by, bw, bhh);
      A.button(ctx, bx, by, bw, bhh, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, bx + bw / 2, by + (bhh - 10) / 2, { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
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
      if (this.confirmLeave) { this.confirmLeave = false; return true; }
      if (this.keyboard || this.editing) { this.keyboard = false; this.editing = false; return true; }
      this.requestLeave();
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
