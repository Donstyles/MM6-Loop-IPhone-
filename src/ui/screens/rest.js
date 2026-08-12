// ---------------------------------------------------------------------------
// Rest and wait.
//
// The `restmain` panel at (8,8): a window onto the sky whose frame follows the
// time of day, a campfire, an hourglass that turns while time passes, and the
// four MM6 buttons - Rest & Heal 8 Hours, Wait until Dawn, Wait 1 Hour, Wait 5
// Minutes - at their original coordinates.
//
// Resting eats food, advances the clock and mends the party; outdoors there is
// a chance of being woken by something that followed you.
// ---------------------------------------------------------------------------


import { rampCss } from '../../core/palette.js';
import { clamp, hash2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { maxHP, maxSP } from '../../game/stats.js';
import {
  Screen, PANEL, A, baked, poly, sessionRng, paintFloor, paintClutter, vignette,
  members, hasCondition, clearCondition, say, MM6, C_WHITE, C_GOLD, C_CANARY, C_DIM,
  C_RED, C_GREEN,
} from './dialogue.js';

// Absolute rects: the spec's panel-relative numbers plus the (8,8) origin.
const SKY = { x: 24, y: 34, w: 225, h: 120 };
const BTN_REST = { x: 32, y: 162, w: 225, h: 37 };
const BTN_DAWN = { x: 69, y: 240, w: 154, h: 33 };
const BTN_HOUR = { x: 69, y: 272, w: 154, h: 33 };
const BTN_FIVE = { x: 69, y: 304, w: 154, h: 33 };
const BTN_EXIT = { x: 288, y: 305, w: 154, h: 37 };
const GLASS = { x: 275, y: 167, w: 46, h: 66 };

const MINUTES_PER_SECOND = 60 * 8;   // the wait animation runs fast, not instant

/**
 * MM6's message box: the 9-slice carved-wood frame (`cornr_*` / `edge_*`) -
 * a #3E2E1E body inside an #8A6E46 bevel, with a corner block pinned at each
 * end of it. Never a black rounded rectangle with a dotted stroke.
 */
export function msgFrame(ctx, x, y, w, h) {
  const body = [62, 46, 30], bevel = [138, 110, 70], key = [22, 15, 8];
  x |= 0; y |= 0; w |= 0; h |= 0;
  MM6.rct(ctx, x, y, w, h, key);
  MM6.rct(ctx, x + 1, y + 1, w - 2, h - 2, bevel);
  // Tooled grain along the frame band: the edge pieces are carved, not filled.
  for (let i = 2; i < w - 2; i += 3) {
    MM6.rct(ctx, x + i, y + 2, 2, 1, MM6.shade(bevel, 0.74));
    MM6.rct(ctx, x + i, y + h - 3, 2, 1, MM6.shade(bevel, 0.62));
  }
  MM6.rct(ctx, x + 1, y + 1, w - 2, 1, MM6.mix(bevel, [255, 236, 200], 0.36));
  MM6.rct(ctx, x + 1, y + h - 2, w - 2, 1, MM6.shade(bevel, 0.52));
  MM6.rct(ctx, x + 4, y + 4, w - 8, h - 8, MM6.shade(body, 0.6));
  MM6.rct(ctx, x + 5, y + 5, w - 10, h - 10, body);
  MM6.rct(ctx, x + 5, y + h - 6, w - 10, 1, MM6.mix(body, [138, 110, 70], 0.4));
  // Corner blocks.
  for (const [cx, cy] of [[x + 1, y + 1], [x + w - 7, y + 1], [x + 1, y + h - 7], [x + w - 7, y + h - 7]]) {
    MM6.rct(ctx, cx, cy, 6, 6, MM6.shade(bevel, 0.82));
    MM6.rct(ctx, cx, cy, 6, 1, MM6.mix(bevel, [255, 236, 200], 0.5));
    MM6.rct(ctx, cx + 2, cy + 2, 2, 2, MM6.shade(bevel, 0.5));
  }
}

/**
 * A painted bedroll lying on the floor: a rolled wool mat with a blanket
 * turned back over it and a bundle for a pillow. Built from integer scanlines
 * so the silhouette is cut, never a half-ellipse clipped by the panel edge.
 */
function paintBedroll(g, cx, cy, len, tone) {
  const wool = MM6.hexRGB(tone);
  const lit = MM6.mix(wool, [255, 240, 214], 0.30);
  const dark = MM6.shade(wool, 0.52);
  const half = Math.round(len / 2);
  const H = Math.max(7, Math.round(len * 0.30));
  const top = cy - Math.round(H / 2);
  // Cast shadow on the ground, a stippled skirt under the roll.
  MM6.stipple(g, cx - half - 2, cy + Math.round(H / 2) - 2, len + 6, 4, [22, 16, 10], 0.55);
  for (let j = 0; j < H; j++) {
    // The round of the roll: five value steps from the lit ridge down to the
    // shaded flank, with the ends bitten square rather than curved.
    const t = j / (H - 1);
    const bite = j === 0 || j === H - 1 ? 7 : j === 1 || j === H - 2 ? 4 : j === 2 || j === H - 3 ? 2 : 0;
    const y = top + j;
    const c = t < 0.16 ? MM6.mix(wool, lit, 0.45)
      : t < 0.34 ? lit
        : t < 0.58 ? wool
          : t < 0.80 ? MM6.mix(wool, dark, 0.5) : dark;
    MM6.rct(g, cx - half + bite, y, len - bite * 2, 1, c);
  }
  // Two straps buckled round it, and the blanket turned back at the head.
  for (const sx of [-Math.round(len * 0.22), Math.round(len * 0.16)]) {
    MM6.rct(g, cx + sx, top + 1, 3, H - 2, MM6.shade(wool, 0.42));
    MM6.rct(g, cx + sx, top + 2, 1, H - 4, MM6.mix(wool, [255, 236, 200], 0.22));
  }
  MM6.rct(g, cx + half - 9, top + 2, 7, H - 4, MM6.shade(wool, 0.60));
  MM6.rct(g, cx + half - 9, top + 2, 7, 1, lit);
  // The bundle at the head end, used for a pillow.
  MM6.ellip(g, cx - half + 5, top + 1, 8, 5, MM6.mix(wool, [200, 186, 150], 0.7));
  MM6.ellip(g, cx - half + 4, top, 6, 3, [212, 200, 168]);
}

/** Camp interior: rock wall, bedrolls, a banked fire and the window opening. */
export function paintRestPanel(g, w, h) {
  // Back wall: coursed ashlar, not a noise field. Every block is a painted
  // slab with its own value, a lit top arris and a shadowed foot; the mortar
  // is the dark ground showing between them.
  const floorTop = h - 120;
  g.fillStyle = rampCss('stone', 1);
  g.fillRect(0, 0, w, floorTop + 4);
  const BW = 34, BH = 17;
  for (let row = 0; row * BH < floorTop + 4; row++) {
    const y = row * BH;
    const off = (row & 1) ? -Math.round(BW / 2) : 0;
    for (let bx = off; bx < w; bx += BW) {
      const n = hash2(bx * 0.37, row, 11);
      const chip = hash2(bx * 0.11, row * 3, 29);
      const base = MM6.mix([54, 50, 44], [120, 114, 102], 0.24 + n * 0.42);
      MM6.rct(g, bx + 1, y + 1, BW - 2, BH - 2, base);
      MM6.rct(g, bx + 1, y + 1, BW - 2, 1, MM6.mix(base, [236, 230, 214], 0.34));
      MM6.rct(g, bx + 1, y + BH - 2, BW - 2, 1, MM6.shade(base, 0.62));
      MM6.rct(g, bx + 1, y + 1, 1, BH - 2, MM6.mix(base, [236, 230, 214], 0.18));
      MM6.rct(g, bx + BW - 2, y + 1, 1, BH - 2, MM6.shade(base, 0.70));
      // Weathering: a chipped corner and a couple of pits per block.
      if (chip > 0.72) MM6.rct(g, bx + 2, y + BH - 5, 3, 3, MM6.shade(base, 0.74));
      if (chip < 0.22) MM6.rct(g, bx + BW - 7, y + 3, 2, 2, MM6.shade(base, 0.78));
      MM6.stipple(g, bx + 1, y + 1, BW - 2, BH - 2, MM6.shade(base, 0.80), 0.10);
    }
  }
  paintFloor(g, 0, floorTop, w, 120, { ramp: 'dirt', seed: 202 });

  // Window reveal, so the sky sits in a hole in the rock.
  g.fillStyle = rampCss('wood', 3);
  g.fillRect(SKY.x - PANEL.x - 8, SKY.y - PANEL.y - 8, SKY.w + 16, SKY.h + 16);
  g.fillStyle = rampCss('wood', 6);
  g.fillRect(SKY.x - PANEL.x - 6, SKY.y - PANEL.y - 6, SKY.w + 12, 4);

  // Campfire on the right: a ring of stones, a leaning stack of logs and a
  // flame sprite. The key light for the whole panel comes off it.
  const fx = w - 96, fy = h - 104;
  // The light it throws is painted into the floor as three hard bands - a
  // radial alpha falloff has no index in a 256-colour frame.
  for (const [rx, ry, c] of [[92, 34, [96, 74, 44]], [66, 25, [124, 94, 52]], [44, 17, [148, 112, 58]]]) {
    MM6.ellip(g, fx, fy + 10, rx, ry, c);
  }
  MM6.stipple(g, fx - 112, fy - 12, 224, 56, [150, 112, 56], 0.22);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const sx = fx + Math.cos(a) * 44, sy = fy + Math.sin(a) * 17;
    MM6.ellip(g, sx, sy, 9, 7, rampCss('stone', sy > fy ? 6 : 3));
    MM6.ellip(g, sx - 2, sy - 2, 5, 3, rampCss('stone', sy > fy ? 9 : 5));
  }
  // Ash bed.
  MM6.ellip(g, fx, fy, 34, 12, rampCss('grey', 3));
  // Logs leaning into a cone, painted as tapering bars with a lit top.
  for (const [ax, ay, bx2, by2] of [[fx - 26, fy + 6, fx + 4, fy - 24],
    [fx + 26, fy + 6, fx - 2, fy - 26], [fx - 18, fy + 9, fx + 14, fy - 14]]) {
    MM6.lineH(g, ax, ay, bx2, by2, rampCss('wood', 3), 7);
    MM6.lineH(g, ax, ay - 2, bx2, by2 - 2, rampCss('wood', 6), 2);
  }
  // Flame sprites: tinted around #FF3C1E, 1-bit alpha, no falloff at all.
  for (let i = 0; i < 5; i++) {
    MM6.flame(g, fx - 18 + i * 9, fy + 2, 16 + (i % 3) * 6, 34 + (i % 4) * 11, i * 1.9);
  }

  // Bedrolls laid out on the floor, well inside the panel so nothing is cut
  // in half by its edge.
  // Two bedrolls laid out down the free side of the camp, clear of the keys
  // and clear of the panel edge - nothing here is a shape cut in half.
  paintBedroll(g, 36, h - 68, 62, '#8a7048');
  paintBedroll(g, 34, h - 26, 62, '#6e6a58');

  // Clutter tucked clear of the Exit plate (rel x 280..434, y 297..334): the
  // barrel used to stand half-buried under the plate's bottom edge.
  paintClutter(g, 254, h - 4, 'sack', 24);
  paintClutter(g, w - 20, h - 4, 'barrel', 24);
  vignette(g, w, h, 0.32);
}

export class RestScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'rest';
    this.outdoor = opts.outdoor !== undefined ? opts.outdoor
      : !(session && session.map && session.map.indoor);
    this.pending = null;     // {minutes, left, heal}
    this.message = '';
    this.messageT = 99;
    this.t = 0;
    // A PERSISTENT stream: a fresh fixed-seed Rand here meant roll #1 always
    // passed, so re-opening the screen made every rest ambush-proof.
    this.rnd = sessionRng(session, 'rest');
  }

  onOpen() {
    this.sound('rest');
    // The campfire crackles for as long as the camp panel is up.
    const a = this.session && this.session.audio;
    if (a && typeof a.loop === 'function') {
      try { this._fire = a.loop('fire_crackle', { volume: 0.5 }); } catch { this._fire = null; }
    }
  }

  onClose() {
    if (this._fire && typeof this._fire.stop === 'function') {
      try { this._fire.stop(0.4); } catch { /* already gone */ }
    }
    this._fire = null;
  }

  get clock() { return this.session && this.session.clock; }
  get party() { return (this.session && this.session.party) || { food: 0, members: [] }; }

  // --- rules ---------------------------------------------------------------

  monstersNear() {
    const s = this.session;
    if (!s) return false;
    // The live combat probe wins when the glue layer provides one; the raw
    // inCombat flag deadlocked rest because it only clears in session.update,
    // which never runs while this screen is open.
    if (typeof s.checkCombat === 'function') {
      try { return !!s.checkCombat(); } catch { /* fall through */ }
    }
    if (typeof s.monstersNear === 'function') return s.monstersNear();
    // Last resort: scan for a monster actually chasing us right now.
    const list = s.entities && s.entities.list;
    if (list && s.player) {
      const px = s.player.pos.x, pz = s.player.pos.z;
      for (const e of list) {
        if (e.category !== 'monster' || e.dead) continue;
        if (e.state !== 'chase' && e.state !== 'flee') continue;
        const dx = e.pos.x - px, dz = e.pos.z - pz;
        if (dx * dx + dz * dz < 2500 * 2500) return true;
      }
      return false;
    }
    return !!s.inCombat;
  }

  /** MM6 rest rules: one ration per party member. */
  get foodNeeded() {
    return Math.max(1, members(this.session).filter(
      (ch) => !hasCondition(ch, 'dead') && !hasCondition(ch, 'eradicated'),
    ).length);
  }

  begin(kind) {
    if (this.pending) return;
    if (this.monstersNear()) {
      this.say('You cannot rest with enemies nearby!', C_RED);
      return;
    }
    const c = this.clock;
    let minutes = 0;
    let heal = false;
    switch (kind) {
      case 'rest8':
        if ((this.party.food | 0) < this.foodNeeded) {
          this.say(`You need ${this.foodNeeded} food to rest.`, C_RED);
          return;
        }
        minutes = 8 * 60; heal = true;
        break;
      case 'dawn': {
        const h = c ? c.hour : 9;
        // Dawn if we are in the night half, dusk otherwise - MM6's one button.
        const target = (h >= 5 && h < 17) ? 20 : 5;
        minutes = ((target - (c ? c.hour : 9) + 24) % 24) * 60 - (c ? c.minute : 0);
        if (minutes <= 0) minutes += 24 * 60;
        break;
      }
      case 'hour': minutes = 60; break;
      case 'five': minutes = 5; break;
      default: return;
    }
    this.pending = { minutes, left: minutes, heal, kind };
  }

  finish(p) {
    const list = members(this.session);
    if (p.heal) {
      // MM6 charges one ration a head, and the camp is found or it is not
      // BEFORE anyone heals - an interrupted rest restores nothing.
      this.party.food = Math.max(0, (this.party.food | 0) - this.foodNeeded);
      if (this.outdoor && this.rnd.bool(0.22)) {
        this.interrupted();
        return;
      }
      for (const ch of list) {
        if (hasCondition(ch, 'dead') || hasCondition(ch, 'eradicated') || hasCondition(ch, 'stoned')) continue;
        ch.hp = this.safe(() => maxHP(ch), ch.maxHP || ch.hp);
        ch.sp = this.safe(() => maxSP(ch), ch.maxSP || ch.sp);
        clearCondition(ch, 'asleep');
        clearCondition(ch, 'drunk');
        clearCondition(ch, 'weak');
        clearCondition(ch, 'unconscious');
      }
      this.say('You wake rested. Hit points and spell points are restored.', C_GREEN);
    } else {
      this.say(`Time passes. It is now ${this.clock ? this.clock.format() : ''}.`);
    }
  }

  /** Something found the camp: spawn it and drop straight into the fight. */
  interrupted() {
    const s = this.session;
    say(s, 'Your rest is interrupted!', C_RED);
    let spawned = false;
    if (s && typeof s.spawnAmbush === 'function') {
      try {
        const level = Math.max(1, Math.round(
          members(s).reduce((t, ch) => t + (ch.level || 1), 0) / Math.max(1, members(s).length),
        ));
        s.spawnAmbush({ count: 2 + (this.rnd.int ? this.rnd.int(0, 2) : 0), level });
        spawned = true;
      } catch { /* the glue layer may not be ready yet */ }
    }
    if (!spawned && s && s.spawner && s.spawner.spawnMonster && s.player && s.map) {
      // Fallback ambush: a couple of goblins just outside the firelight.
      try {
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * Math.PI * 2 + 0.7;
          const x = s.player.pos.x + Math.sin(a) * 800;
          const z = s.player.pos.z + Math.cos(a) * 800;
          const e = s.spawner.spawnMonster(i ? 'GoblinB' : 'GoblinA', x, s.map.groundAt(x, z, s.player.pos.y), z);
          if (e) { e.state = 'chase'; spawned = true; }
        }
      } catch { /* no spawner, no ambush */ }
    }
    if (s && spawned) s.inCombat = true;
    // Close to combat: the fight is outside, not on this panel.
    this.close();
  }

  say(msg, color) {
    this.message = msg;
    this.messageColor = color || C_WHITE;
    this.messageT = 0;
    say(this.session, msg, color);
  }

  update(dt) {
    this.t += dt || 0;
    this.messageT += dt || 0;
    const p = this.pending;
    if (!p) return;
    const step = Math.min(p.left, (dt || 0) * MINUTES_PER_SECOND);
    p.left -= step;
    if (this.clock) this.clock.advanceMinutes(step);
    // session.update is frozen while this panel is open, so drive the party
    // clock bridge ourselves: waiting has to tick conditions and expire buffs.
    if (this.session && typeof this.session.syncPartyClock === 'function') {
      this.session.syncPartyClock();
    }
    if (p.left <= 0.01) {
      this.pending = null;
      this.finish(p);
    }
  }

  safe(f, fallback) { try { const v = f(); return v === undefined ? fallback : v; } catch { return fallback; } }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked('rest', PANEL.w, PANEL.h, (g, w, h) => paintRestPanel(g, w, h));
  }

  draw(ctx) {
    const bg = this.backdrop();
    ctx.drawImage(bg, PANEL.x, PANEL.y);
    A.bevel(ctx, PANEL.x - 1, PANEL.y - 1, PANEL.w + 2, PANEL.h + 2, { depth: 1, raised: false });

    this.drawSky(ctx);
    this.drawHourglass(ctx);
    this.drawButtons(ctx);
    this.drawStatus(ctx);
  }

  /**
   * One painted cloud: a flat-bottomed bank of lumps with a lit crown, a
   * shadowed underside and a 1-bit dithered lower edge. Nothing in MM6's sky
   * has a soft edge, so nothing here does either.
   */
  paintCloud(ctx, cx, cy, s, body, lit, shade) {
    const lumps = [[-1.05, 0.10, 0.86], [-0.35, -0.30, 1.10], [0.45, -0.14, 0.95], [1.15, 0.12, 0.72]];
    const base = Math.round(cy + 7 * s);
    for (const [dx, dy, r] of lumps) {
      MM6.ellip(ctx, cx + dx * 15 * s, cy + dy * 9 * s, 13 * s * r, 8 * s * r, body);
    }
    MM6.rct(ctx, Math.round(cx - 22 * s), base - Math.round(4 * s), Math.round(44 * s), Math.round(4 * s), body);
    for (const [dx, dy, r] of lumps) {
      MM6.ellip(ctx, cx + dx * 15 * s, cy + dy * 9 * s - 2 * s, 11 * s * r, 4 * s * r, lit);
    }
    MM6.rct(ctx, Math.round(cx - 22 * s), base - Math.round(2 * s), Math.round(44 * s), Math.round(2 * s), shade);
    MM6.stipple(ctx, Math.round(cx - 22 * s), base, Math.round(44 * s), 2, shade, 0.5);
  }

  /** The window: the sky's own colour and its cloud cover, drifting as you wait. */
  drawSky(ctx) {
    const c = this.clock;
    const tod = c ? (c.minutes % 1440) / 1440 : 0.4;
    const hour = tod * 24;
    const night = hour < 5 || hour >= 21;
    const dusk = (hour >= 18 && hour < 21) || (hour >= 5 && hour < 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(SKY.x, SKY.y, SKY.w, SKY.h);
    ctx.clip();

    // Banded gradient - no smooth ramps anywhere in an 8-bit UI.
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      let shade;
      if (night) shade = 1 + t * 3;
      else if (dusk) shade = 4 + t * 7;
      else shade = 7 + t * 8;
      ctx.fillStyle = rampCss(night ? 'water' : dusk ? 'fire' : 'sky', Math.round(shade));
      ctx.fillRect(SKY.x, SKY.y + Math.floor((i * SKY.h) / 16), SKY.w, Math.ceil(SKY.h / 16) + 1);
    }

    // There is no sun disc, no moon and no stars anywhere in MM6 - the sky is
    // cloud, lit or unlit - so the window shows cloud cover and nothing else.
    // It drifts, faster while time is being burned.
    const speed = this.pending ? 26 : 3;
    const off = (this.t * speed) % (SKY.w + 160);
    const body = night ? [46, 56, 74] : dusk ? [176, 128, 100] : [206, 212, 224];
    const lit = night ? [72, 84, 106] : dusk ? [224, 176, 130] : [244, 246, 250];
    const shd = night ? [30, 38, 52] : dusk ? [130, 92, 76] : [166, 174, 190];
    // The sky is never empty in MM6: it is covered, and the banks compress
    // toward the horizon, so the low ones are flatter and closer together.
    for (let i = 0; i < 11; i++) {
      const cx = SKY.x - 80 + ((off * (0.55 + (i % 4) * 0.22) + i * 47) % (SKY.w + 160));
      const cy = SKY.y + 6 + (i % 5) * 17;
      const s = 1.15 - (i % 5) * 0.15;
      this.paintCloud(ctx, cx, cy, s, body, lit, shd);
    }
    // Hills along the bottom of the opening: two ridges with a lit crest, not
    // flat triangles.
    for (const [depth, ramp2, shd] of [[26, 3, 2], [14, 5, 3]]) {
      for (let x = 0; x <= SKY.w; x++) {
        const hgt = depth + Math.sin(x * 0.037 + depth) * 8 + Math.sin(x * 0.11 + depth) * 4;
        const top = Math.round(SKY.y + SKY.h - hgt);
        ctx.fillStyle = rampCss('foliage', night ? shd : ramp2);
        ctx.fillRect(SKY.x + x, top, 1, SKY.y + SKY.h - top);
        ctx.fillStyle = rampCss('foliage', night ? shd + 1 : ramp2 + 2);
        ctx.fillRect(SKY.x + x, top, 1, 2);
        // Woodland on the slope: a checker-dithered band under the crest and a
        // tree mark here and there, so the ridge is not a flat cut-out.
        ctx.fillStyle = rampCss('foliage', night ? shd + 1 : ramp2 + 3);
        for (let k = 2; k < 9; k++) {
          if (((SKY.x + x + top + k) & 1) === 0) ctx.fillRect(SKY.x + x, top + k, 1, 1);
        }
        if (((x * 7 + depth * 13) % 23) === 0) {
          ctx.fillStyle = rampCss('foliage', night ? shd : Math.max(1, ramp2 - 1));
          ctx.fillRect(SKY.x + x, top + 1, 2, 3);
        }
      }
    }
    ctx.restore();

    // Window frame and bars.
    A.bevel(ctx, SKY.x - 2, SKY.y - 2, SKY.w + 4, SKY.h + 4, { depth: 2, raised: false });
    ctx.fillStyle = rampCss('wood', 4);
    ctx.fillRect(SKY.x + SKY.w / 2 - 2, SKY.y, 4, SKY.h);
    ctx.fillRect(SKY.x, SKY.y + SKY.h / 2 - 2, SKY.w, 4);
    ctx.fillStyle = rampCss('wood', 8);
    ctx.fillRect(SKY.x + SKY.w / 2 - 2, SKY.y, 1, SKY.h);

    // Clock and date under the window.
    const c2 = this.clock;
    if (c2) {
      F.drawText(ctx, c2.format(), SKY.x + SKY.w / 2, SKY.y + SKY.h + 8,
        { align: 'center', color: C_CANARY });
      F.drawText(ctx, c2.formatDate(), SKY.x + SKY.w / 2, SKY.y + SKY.h + 20,
        { face: 'small', align: 'center', color: C_DIM });
    }
  }

  /** Sand runs while time passes; the glass flips when it empties. */
  drawHourglass(ctx) {
    const g = GLASS;
    const busy = !!this.pending;
    const frac = busy ? clamp(this.pending.left / Math.max(1, this.pending.minutes), 0, 1) : 1;

    ctx.fillStyle = rampCss('wood', 5);
    ctx.fillRect(g.x - 4, g.y - 5, g.w + 8, 5);
    ctx.fillRect(g.x - 4, g.y + g.h, g.w + 8, 5);
    ctx.fillStyle = rampCss('wood', 8);
    ctx.fillRect(g.x - 4, g.y - 5, g.w + 8, 1);
    for (const ox of [0, g.w - 3]) {
      ctx.fillStyle = rampCss('wood', 6);
      ctx.fillRect(g.x + ox, g.y, 3, g.h);
    }

    // Glass body: two hard cones with a lit left facet. No transparency - a
    // painted 8-bit glass is a value pattern, not an alpha.
    for (let i = 0; i < g.h; i++) {
      const t = i / (g.h - 1);
      const pinch = Math.abs(t - 0.5) * 2;
      const k = Math.max(2, Math.round((g.w / 2 - 5) * (0.16 + pinch * 0.84)));
      const mid = g.x + g.w / 2;
      // Blown glass: a dark rim on the silhouette, a body a couple of steps
      // above it and one hard specular band down the left third.
      MM6.rct(ctx, mid - k, g.y + i, k * 2, 1, [74, 84, 84]);
      MM6.rct(ctx, mid - k, g.y + i, 1, 1, [40, 46, 48]);
      MM6.rct(ctx, mid - k + Math.max(1, (k * 0.34) | 0), g.y + i, 2, 1, [172, 190, 186]);
      MM6.rct(ctx, mid + k - 2, g.y + i, 2, 1, [50, 58, 60]);
    }

    // Sand: top cone empties, bottom fills.
    const topH = (g.h / 2 - 4) * frac;
    ctx.fillStyle = rampCss('sand', 10);
    poly(ctx, [
      g.x + g.w / 2 - 3 - (topH / (g.h / 2 - 4)) * (g.w / 2 - 8), g.y + g.h / 2 - topH,
      g.x + g.w / 2 + 3 + (topH / (g.h / 2 - 4)) * (g.w / 2 - 8), g.y + g.h / 2 - topH,
      g.x + g.w / 2 + 2, g.y + g.h / 2,
      g.x + g.w / 2 - 2, g.y + g.h / 2,
    ], rampCss('sand', 10));
    const botH = (g.h / 2 - 4) * (1 - frac);
    ctx.fillStyle = rampCss('sand', 8);
    poly(ctx, [
      g.x + 6, g.y + g.h - 2,
      g.x + g.w - 6, g.y + g.h - 2,
      g.x + g.w / 2 + 3 + (botH / (g.h / 2)) * 4, g.y + g.h - 2 - botH,
      g.x + g.w / 2 - 3 - (botH / (g.h / 2)) * 4, g.y + g.h - 2 - botH,
    ], rampCss('sand', 8));
    if (busy) {
      ctx.fillStyle = rampCss('sand', 12);
      ctx.fillRect(g.x + g.w / 2 - 1, g.y + g.h / 2, 2, g.h / 2 - 4 - botH);
      F.drawText(ctx, `${Math.ceil(this.pending.left / 60)}h`, g.x + g.w / 2, g.y + g.h + 10,
        { face: 'small', align: 'center', color: C_CANARY });
    }
  }

  drawButtons(ctx) {
    const p = this.party;
    const canRest = (p.food | 0) >= this.foodNeeded && !this.monstersNear() && !this.pending;
    const defs = [
      ['rest8', BTN_REST, 'Rest & Heal 8 Hours', canRest],
      ['dawn', BTN_DAWN, this.dawnLabel(), !this.pending],
      ['hour', BTN_HOUR, 'Wait 1 Hour', !this.pending],
      ['five', BTN_FIVE, 'Wait 5 Minutes', !this.pending],
    ];
    // Carved wood keys, not grey slabs: the camp is lit by firelight, and a
    // pale label on dark oak is the only pairing that stays legible in it.
    let seed = 12;
    for (const [id, r, label, on] of defs) {
      const hit = this.ui.region(`rest:${id}`, r.x, r.y, r.w, r.h,
        id === 'rest8' && !on
          ? ((p.food | 0) < this.foodNeeded
            ? `Resting costs ${this.foodNeeded} food (one a head).`
            : 'Enemies are too close.')
          : null);
      const d = A.button(ctx, r.x, r.y, r.w, r.h, null,
        !on ? 'disabled' : hit.down ? 'down' : hit.hover ? 'hot' : 'up',
        { material: 'wood', seed: (seed += 7) });
      F.drawText(ctx, label, r.x + r.w / 2 + d, r.y + (r.h - 11) / 2 + d, {
        align: 'center', color: !on ? C_DIM : hit.hover ? C_GOLD : C_CANARY,
      });
      if (hit.click && on) { this.sound('click'); this.begin(id); }
    }
    const ex = this.ui.region('rest:exit', BTN_EXIT.x, BTN_EXIT.y, BTN_EXIT.w, BTN_EXIT.h);
    const ed = A.button(ctx, BTN_EXIT.x, BTN_EXIT.y, BTN_EXIT.w, BTN_EXIT.h, null,
      ex.down ? 'down' : ex.hover ? 'hot' : 'up', { material: 'wood', seed: 47 });
    F.drawText(ctx, 'Exit', BTN_EXIT.x + BTN_EXIT.w / 2 + ed, BTN_EXIT.y + (BTN_EXIT.h - 11) / 2 + ed,
      { align: 'center', color: ex.hover ? C_GOLD : C_CANARY });
    if (ex.click) { this.sound('click'); this.close(); }
  }

  /**
   * MM6's button reads "Wait until Dawn" at every hour of the day - there is no
   * dusk variant, and the rest screen never relabels itself.
   */
  dawnLabel() { return 'Wait until Dawn'; }

  drawStatus(ctx) {
    // MM6's rest screen carries no readout: no camp sheet, no food line and no
    // per-character gauges. Hit points and spell points are on the party bar
    // twelve pixels below, and food is on the right panel. All that belongs
    // here is whatever the last action reported.
    if (this.messageT < 8 && this.message) {
      const my = PANEL.y + PANEL.h - 40;
      msgFrame(ctx, PANEL.x + 12, my, PANEL.w - 24, 30);
      F.drawText(ctx, this.message, PANEL.x + PANEL.w / 2, my + 10,
        { align: 'center', color: this.messageColor || C_WHITE, maxWidth: PANEL.w - 48 });
    }
  }

  handleKey(code) {
    if (code === 'Escape') { this.close(); return true; }
    if (code === 'KeyR') { this.begin('rest8'); return true; }
    return false;
  }
}

export default RestScreen;
