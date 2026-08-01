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
import { clamp, Rand } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { maxHP, maxSP } from '../../game/stats.js';
import {
  Screen, PANEL, A, plate, baked, glow, poly, rngFor, paintFloor, paintClutter, vignette,
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

/** Camp interior: rock wall, bedrolls, a banked fire and the window opening. */
export function paintRestPanel(g, w, h) {
  // Cave-mouth wall.
  g.fillStyle = rampCss('stone', 3);
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const n = ((x * 7 + y * 13) % 17) / 17;
      g.fillStyle = rampCss('stone', 2 + Math.round(n * 4));
      g.fillRect(x, y, 4, 4);
    }
  }
  paintFloor(g, 0, h - 120, w, 120, { ramp: 'dirt', seed: 202 });

  // Window reveal, so the sky sits in a hole in the rock.
  g.fillStyle = rampCss('wood', 3);
  g.fillRect(SKY.x - PANEL.x - 8, SKY.y - PANEL.y - 8, SKY.w + 16, SKY.h + 16);
  g.fillStyle = rampCss('wood', 6);
  g.fillRect(SKY.x - PANEL.x - 6, SKY.y - PANEL.y - 6, SKY.w + 12, 4);

  // Campfire on the right: a ring of stones, a leaning stack of logs and a
  // flame sprite. The key light for the whole panel comes off it.
  const fx = w - 96, fy = h - 104;
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
  glow(g, fx, fy - 12, 86, '#ff7818', 0.75);

  // Bedrolls in the foreground.
  for (let i = 0; i < 3; i++) {
    const bx = 34 + i * 84;
    g.fillStyle = rampCss(['blood', 'swamp', 'water'][i], 4);
    g.beginPath(); g.ellipse(bx, h - 30, 38, 13, -0.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss(['blood', 'swamp', 'water'][i], 6);
    g.beginPath(); g.ellipse(bx - 6, h - 33, 30, 9, -0.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('sand', 9);
    g.beginPath(); g.ellipse(bx + 26, h - 36, 10, 7, 0, 0, Math.PI * 2); g.fill();
  }

  paintClutter(g, 12, h - 6, 'sack', 24);
  paintClutter(g, w - 42, h - 8, 'barrel', 26);
  vignette(g, w, h, 0.45);
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
    this.rnd = rngFor('rest');
  }

  get clock() { return this.session && this.session.clock; }
  get party() { return (this.session && this.session.party) || { food: 0, members: [] }; }

  // --- rules ---------------------------------------------------------------

  monstersNear() {
    const s = this.session;
    if (!s) return false;
    if (s.inCombat) return true;
    if (typeof s.monstersNear === 'function') return s.monstersNear();
    return false;
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
        if ((this.party.food | 0) <= 0) { this.say('You have no food. You cannot rest.', C_RED); return; }
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
      this.party.food = Math.max(0, (this.party.food | 0) - 1);
      for (const ch of list) {
        if (hasCondition(ch, 'dead') || hasCondition(ch, 'eradicated') || hasCondition(ch, 'stoned')) continue;
        ch.hp = this.safe(() => maxHP(ch), ch.maxHP || ch.hp);
        ch.sp = this.safe(() => maxSP(ch), ch.maxSP || ch.sp);
        clearCondition(ch, 'asleep');
        clearCondition(ch, 'drunk');
        clearCondition(ch, 'weak');
        clearCondition(ch, 'unconscious');
      }
      // Outdoors, something occasionally finds the camp.
      if (this.outdoor && this.rnd.bool(0.22)) {
        this.say('You are woken by something moving in the dark!', C_RED);
        say(this.session, 'Your rest is interrupted!', C_RED);
        if (this.session) this.session.inCombat = true;
        return;
      }
      this.say('You wake rested. Hit points and spell points are restored.', C_GREEN);
    } else {
      this.say(`Time passes. It is now ${this.clock ? this.clock.format() : ''}.`);
    }
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

  /** The window: sky colour, sun or moon, and clouds that drift while you wait. */
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

    // Sun or moon, tracking the hour across the opening. The disc is a hard
    // 1-bit silhouette with a couple of banded rings round it - a lemon circle
    // with a soft alpha halo cannot exist in an indexed frame.
    const dayT = clamp((hour - 6) / 12, 0, 1);
    const nightT = clamp(((hour + 24 - 21) % 24) / 8, 0, 1);
    const bx = SKY.x + SKY.w * (night ? nightT : dayT);
    const by = SKY.y + SKY.h * 0.75 - Math.sin((night ? nightT : dayT) * Math.PI) * SKY.h * 0.55;
    if (night) {
      // Stars first, so the moon sits over them.
      const r = new Rand(7);
      for (let i = 0; i < 30; i++) {
        MM6.rct(ctx, SKY.x + r.int(0, SKY.w - 1), SKY.y + r.int(0, SKY.h * 0.7), 1, 1,
          i % 4 ? [192, 208, 224] : [255, 255, 255]);
      }
      MM6.lightPool(ctx, bx, by, 24, '#9fb8d0', 0.45);
      MM6.disc(ctx, bx, by, 9, '#e8f0f8');
      MM6.disc(ctx, bx, by, 8, '#d0dcea');
      MM6.disc(ctx, bx - 5, by - 2, 8, rampCss('water', 3));
    } else {
      MM6.lightPool(ctx, bx, by, 30, dusk ? '#c86828' : '#d8c060', 0.5);
      MM6.disc(ctx, bx, by, 11, dusk ? '#c87838' : '#e8dc9c');
      MM6.disc(ctx, bx, by, 8, dusk ? '#e8a050' : '#f8f0c8');
    }

    // Clouds drift, faster while time is being burned. Painted as stacked
    // scanline bars, so the silhouette is cut rather than feathered.
    const speed = this.pending ? 26 : 3;
    const off = (this.t * speed) % (SKY.w + 120);
    for (let i = 0; i < 4; i++) {
      const cx = SKY.x - 60 + ((off + i * 90) % (SKY.w + 120));
      const cy = SKY.y + 18 + (i % 3) * 22;
      const s = 0.7 + (i % 3) * 0.25;
      const body = night ? [58, 70, 92] : dusk ? [190, 140, 108] : [214, 220, 230];
      const lit = night ? [86, 100, 124] : dusk ? [226, 178, 132] : [246, 248, 252];
      for (let k = 0; k < 4; k++) {
        MM6.ellip(ctx, cx + k * 12 * s, cy + (k % 2) * 3, 14 * s, 6 * s, body);
        MM6.ellip(ctx, cx + k * 12 * s, cy + (k % 2) * 3 - 2, 12 * s, 3 * s, lit);
      }
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
      MM6.rct(ctx, g.x + g.w / 2 - k, g.y + i, k * 2, 1, [96, 116, 130]);
      MM6.rct(ctx, g.x + g.w / 2 - k, g.y + i, Math.max(1, (k * 0.5) | 0), 1, [154, 178, 194]);
      MM6.rct(ctx, g.x + g.w / 2 + k - 1, g.y + i, 1, 1, [56, 70, 82]);
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
    const canRest = (p.food | 0) > 0 && !this.monstersNear() && !this.pending;
    const defs = [
      ['rest8', BTN_REST, 'Rest & Heal 8 Hours', canRest],
      ['dawn', BTN_DAWN, this.dawnLabel(), !this.pending],
      ['hour', BTN_HOUR, 'Wait 1 Hour', !this.pending],
      ['five', BTN_FIVE, 'Wait 5 Minutes', !this.pending],
    ];
    for (const [id, r, label, on] of defs) {
      const hit = this.ui.region(`rest:${id}`, r.x, r.y, r.w, r.h,
        id === 'rest8' && !on ? ((p.food | 0) <= 0 ? 'You have no food.' : 'Enemies are too close.') : null);
      A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down && on ? 'down' : 'up');
      F.drawText(ctx, label, r.x + r.w / 2, r.y + (r.h - 11) / 2 + (hit.down && on ? 1 : 0), {
        align: 'center', color: !on ? C_DIM : hit.hover ? C_GOLD : C_WHITE,
      });
      if (hit.click && on) { this.sound('click'); this.begin(id); }
    }
    const ex = this.ui.region('rest:exit', BTN_EXIT.x, BTN_EXIT.y, BTN_EXIT.w, BTN_EXIT.h);
    A.button(ctx, BTN_EXIT.x, BTN_EXIT.y, BTN_EXIT.w, BTN_EXIT.h, null, ex.down ? 'down' : 'up');
    F.drawText(ctx, 'Exit', BTN_EXIT.x + BTN_EXIT.w / 2, BTN_EXIT.y + (BTN_EXIT.h - 11) / 2,
      { align: 'center', color: ex.hover ? C_GOLD : C_WHITE });
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
      const my = PANEL.y + PANEL.h - 34;
      MM6.stipple(ctx, PANEL.x + 12, my, PANEL.w - 24, 22, [0, 0, 0], 0.66);
      F.drawText(ctx, this.message, PANEL.x + PANEL.w / 2, my + 6,
        { align: 'center', color: this.messageColor || C_WHITE, maxWidth: PANEL.w - 40 });
    }
  }

  handleKey(code) {
    if (code === 'Escape') { this.close(); return true; }
    if (code === 'KeyR') { this.begin('rest8'); return true; }
    return false;
  }
}

export default RestScreen;
