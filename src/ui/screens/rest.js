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

import { layout } from '../../core/layout.js';
import { rampCss } from '../../core/palette.js';
import { clamp, Rand } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { maxHP, maxSP } from '../../game/stats.js';
import {
  Screen, PANEL, A, plate, baked, glow, poly, gold, rngFor,
  paintFloor, paintClutter, vignette,
  members, charName, hasCondition, clearCondition, say,
  C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_GREEN,
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

  // Campfire on the right: a ring of stones, a leaning stack of logs and
  // tongues of flame. The key light for the whole panel comes off it.
  const fx = w - 96, fy = h - 104;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const sx = fx + Math.cos(a) * 44, sy = fy + Math.sin(a) * 17;
    g.fillStyle = rampCss('stone', sy > fy ? 6 : 3);
    g.beginPath(); g.ellipse(sx, sy, 9, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rampCss('stone', sy > fy ? 9 : 5);
    g.beginPath(); g.ellipse(sx - 2, sy - 2, 5, 3, 0, 0, Math.PI * 2); g.fill();
  }
  // Ash bed.
  g.fillStyle = rampCss('grey', 3);
  g.beginPath(); g.ellipse(fx, fy, 34, 12, 0, 0, Math.PI * 2); g.fill();
  // Logs leaning into a cone.
  for (const [ax, ay, bx2, by2] of [[fx - 26, fy + 6, fx + 4, fy - 24],
    [fx + 26, fy + 6, fx - 2, fy - 26], [fx - 18, fy + 9, fx + 14, fy - 14]]) {
    g.strokeStyle = rampCss('wood', 3); g.lineWidth = 7;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx2, by2); g.stroke();
    g.strokeStyle = rampCss('wood', 6); g.lineWidth = 2;
    g.beginPath(); g.moveTo(ax, ay - 2); g.lineTo(bx2, by2 - 2); g.stroke();
  }
  // Flames: overlapping tongues, hottest at the base.
  for (let i = 0; i < 7; i++) {
    const ox = fx - 24 + i * 8;
    const hgt = 22 + ((i * 5) % 3) * 12 - Math.abs(i - 3) * 4;
    poly(g, [ox - 5, fy + 2, ox, fy - hgt, ox + 5, fy + 2], rampCss('fire', 8 + (i % 3)));
    poly(g, [ox - 2, fy + 2, ox + 1, fy - hgt * 0.6, ox + 3, fy + 2], rampCss('fire', 13));
  }
  glow(g, fx, fy - 12, 130, '#ff7818', 0.95);

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

    // Sun or moon, tracking the hour across the opening.
    const dayT = clamp((hour - 6) / 12, 0, 1);
    const nightT = clamp(((hour + 24 - 21) % 24) / 8, 0, 1);
    const bx = SKY.x + SKY.w * (night ? nightT : dayT);
    const by = SKY.y + SKY.h * 0.75 - Math.sin((night ? nightT : dayT) * Math.PI) * SKY.h * 0.55;
    if (night) {
      glow(ctx, bx, by, 26, '#cfe2f2', 0.6);
      ctx.fillStyle = '#e8f0f8';
      ctx.beginPath(); ctx.arc(bx | 0, by | 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rampCss('water', 3);
      ctx.beginPath(); ctx.arc((bx - 5) | 0, (by - 2) | 0, 8, 0, Math.PI * 2); ctx.fill();
      // Stars.
      const r = new Rand(7);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = i % 4 ? '#c0d0e0' : '#ffffff';
        ctx.fillRect(SKY.x + r.int(0, SKY.w - 1), SKY.y + r.int(0, SKY.h * 0.7), 1, 1);
      }
    } else {
      glow(ctx, bx, by, 34, dusk ? '#ff9040' : '#fff0a0', 0.75);
      ctx.fillStyle = dusk ? '#ffb050' : '#fff4c0';
      ctx.beginPath(); ctx.arc(bx | 0, by | 0, 11, 0, Math.PI * 2); ctx.fill();
    }

    // Clouds drift, faster while time is being burned.
    const speed = this.pending ? 26 : 3;
    const off = (this.t * speed) % (SKY.w + 120);
    for (let i = 0; i < 4; i++) {
      const cx = SKY.x - 60 + ((off + i * 90) % (SKY.w + 120));
      const cy = SKY.y + 18 + (i % 3) * 22;
      const s = 0.7 + (i % 3) * 0.25;
      ctx.fillStyle = night ? 'rgba(40,52,72,0.75)' : dusk ? 'rgba(216,150,110,0.8)' : 'rgba(238,242,248,0.85)';
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse((cx + k * 12 * s) | 0, (cy + (k % 2) * 3) | 0, 14 * s, 6 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Hills along the bottom of the opening.
    ctx.fillStyle = night ? rampCss('foliage', 1) : rampCss('foliage', 4);
    ctx.beginPath();
    ctx.moveTo(SKY.x, SKY.y + SKY.h);
    for (let x = 0; x <= SKY.w; x += 15) {
      ctx.lineTo(SKY.x + x, SKY.y + SKY.h - 14 - Math.sin(x * 0.05) * 8 - ((x * 7) % 9));
    }
    ctx.lineTo(SKY.x + SKY.w, SKY.y + SKY.h);
    ctx.closePath();
    ctx.fill();
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

    // Glass body.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#cfe2f2';
    poly(ctx, [g.x + 5, g.y, g.x + g.w - 5, g.y, g.x + g.w / 2 + 3, g.y + g.h / 2,
      g.x + g.w - 5, g.y + g.h, g.x + 5, g.y + g.h, g.x + g.w / 2 - 3, g.y + g.h / 2], '#cfe2f2');
    ctx.restore();

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
      F.drawText(ctx, `${Math.ceil(this.pending.left / 60)}h left`, g.x + g.w / 2, g.y + g.h + 8,
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

  dawnLabel() {
    const h = this.clock ? this.clock.hour : 9;
    return (h >= 5 && h < 17) ? 'Wait until Dusk' : 'Wait until Dawn';
  }

  drawStatus(ctx) {
    // Food and party state, then whatever the last action reported.
    const x = PANEL.x + 262, y = PANEL.y + 18, w = PANEL.w - 262 - 14;
    plate(ctx, x, y, w, 128, 0.66);
    F.drawText(ctx, 'Camp', x + 8, y + 5, { color: C_CANARY });
    A.rule(ctx, x + 6, y + 20, w - 12, '#7a6a4a');
    const p = this.party;
    F.drawText(ctx, `Food: ${p.food | 0}`, x + 8, y + 26,
      { face: 'small', color: (p.food | 0) > 0 ? C_WHITE : C_RED });
    const list = members(this.session);
    list.forEach((ch, i) => {
      const ry = y + 40 + i * 20;
      const mh = this.safe(() => maxHP(ch), ch.maxHP || 1);
      const ms = this.safe(() => maxSP(ch), ch.maxSP || 0);
      F.drawText(ctx, charName(ch), x + 8, ry, { face: 'small', color: C_WHITE });
      A.statBar(ctx, x + 70, ry, 50, 5, (ch.hp | 0) / Math.max(1, mh), 'hp');
      A.statBar(ctx, x + 124, ry, 50, 5, ms ? (ch.sp | 0) / ms : 0, 'sp');
      F.drawText(ctx, `${ch.hp | 0}`, x + w - 8, ry - 1,
        { face: 'small', align: 'right', color: (ch.hp | 0) < mh ? C_RED : C_GREEN });
    });

    if (this.messageT < 8 && this.message) {
      const my = PANEL.y + PANEL.h - 34;
      plate(ctx, PANEL.x + 12, my, PANEL.w - 24, 22, 0.7);
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
