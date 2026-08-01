// ---------------------------------------------------------------------------
// The level-up dialog.
//
// MM6 stops the game dead for this: a carved 9-slice message box over a
// darkened frame, the character's portrait wearing the level_up painting, the
// header in the heavy serif face and the awards in pale canary. It is the one
// moment the interface is allowed to be theatrical, so the box gets gold
// filigree, corner brasses and a slow shimmer across the header.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import { rampCss } from '../../core/palette.js';

import * as F from '../../art/font.js';
import * as M from './mm6art.js';
import { PORTRAIT_W, PORTRAIT_H } from '../../art/portraits.js';
import { maxHP, maxSP, xpForLevel } from '../../game/stats.js';
import { Screen, A, portraitOf, gold, charName, glow, C_WHITE, C_GOLD, C_CANARY, C_DIM } from './dialogue.js';

const BOX = { w: 360, h: 226 };

/** The carved message-box frame: dark wood band, bevels, brass corners. */
export function drawMessageBox(ctx, x, y, w, h) {
  ctx.fillStyle = '#3e2e1e';
  ctx.fillRect(x, y, w, h);
  A.stone(ctx, x + 6, y + 6, w - 12, h - 12, { rivets: false });
  A.bevel(ctx, x, y, w, h, { depth: 2, raised: true });
  A.bevel(ctx, x + 5, y + 5, w - 10, h - 10, { depth: 2, raised: false });
  ctx.fillStyle = '#8a6e46';
  ctx.fillRect(x + 3, y + 3, w - 6, 1);
  ctx.fillRect(x + 3, y + h - 4, w - 6, 1);
  ctx.fillRect(x + 3, y + 3, 1, h - 6);
  ctx.fillRect(x + w - 4, y + 3, 1, h - 6);
  A.corner(ctx, x + 2, y + 2, 12, 'tl');
  A.corner(ctx, x + w - 14, y + 2, 12, 'tr');
  A.corner(ctx, x + 2, y + h - 14, 12, 'bl');
  A.corner(ctx, x + w - 14, y + h - 14, 12, 'br');
}

export class LevelUpScreen extends Screen {
  /**
   * @param {object} opts {character, level, hp, sp, skillPoints, statPoints}
   */
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'levelup';
    this.ch = opts.character || (session && session.party && session.party.members
      && session.party.members[session.activeChar | 0]) || null;
    this.level = opts.level || (this.ch ? this.ch.level : 2);
    this.hp = opts.hp === undefined ? 5 : opts.hp;
    this.sp = opts.sp === undefined ? 2 : opts.sp;
    this.skillPoints = opts.skillPoints === undefined ? 5 : opts.skillPoints;
    this.t = 0;
  }

  onOpen() {
    if (this.ch) this.ch.justLeveled = true;
    this.sound('levelup');
  }

  onClose() { if (this.ch) this.ch.justLeveled = false; }

  update(dt) { this.t += dt || 0; }

  draw(ctx) {
    const W = layout.w, H = layout.h;
    // Darken everything behind, the way MM6 dims the frame under a message box.
    // A 62% black wash would blend every pixel behind it off-palette. MM6
    // dims the frame under a message box with a dither, so this is a dense
    // Bayer stipple of solid near-black instead.
    M.stipple(ctx, 0, 0, W, H, [5, 5, 10], 0.62);

    const x = Math.round((W - BOX.w) / 2);
    const y = Math.round((H - BOX.h) / 2) - 20;
    drawMessageBox(ctx, x, y, BOX.w, BOX.h);

    // Portrait, lit by a gold pool so the moment reads as a celebration.
    const px = x + 22, py = y + 44;
    glow(ctx, px + PORTRAIT_W / 2, py + PORTRAIT_H / 2, 78, '#ffd84a', 0.55);
    const p = portraitOf(this.ch, 'level_up');
    if (p) ctx.drawImage(p, px, py);
    else { ctx.fillStyle = rampCss('stone', 5); ctx.fillRect(px, py, PORTRAIT_W, PORTRAIT_H); }
    A.portraitFrame(ctx, px - 3, py - 3, PORTRAIT_W + 6, PORTRAIT_H + 6, 'active');

    // Header, with a shimmer running across the gold.
    const hx = x + BOX.w / 2;
    const shimmer = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    F.drawText(ctx, 'Level Up!', hx, y + 16, {
      face: 'title', align: 'center',
      color: shimmer > 0.5 ? C_GOLD : '#fff0a0', shadow: '#000000',
    });
    A.filigree(ctx, x + 30, y + 36, BOX.w - 60);

    const tx = px + PORTRAIT_W + 22;
    const tw = x + BOX.w - 22 - tx;
    F.drawText(ctx, `${charName(this.ch)} has gone up`, tx, y + 46, { color: C_WHITE, maxWidth: tw });
    F.drawText(ctx, `to level ${this.level}!`, tx, y + 60, { color: C_WHITE, maxWidth: tw });

    const rows = [
      ['Hit Points', `+${this.hp}`, C_CANARY],
      ['Spell Points', this.sp > 0 ? `+${this.sp}` : '-', this.sp > 0 ? C_CANARY : C_DIM],
      ['Skill Points', `+${this.skillPoints}`, C_CANARY],
    ];
    rows.forEach(([label, value, col], i) => {
      const ry = y + 84 + i * 15;
      F.drawText(ctx, label, tx, ry, { face: 'small', color: C_WHITE });
      F.drawText(ctx, value, tx + tw, ry, { face: 'small', align: 'right', color: col });
      ctx.fillStyle = '#6a5c42';
      for (let dx = tx + F.measure(label, 'small').w + 4; dx < tx + tw - F.measure(value, 'small').w - 4; dx += 3) {
        ctx.fillRect(dx | 0, ry + 6, 1, 1);
      }
    });

    // Totals along the bottom of the box.
    const by = y + BOX.h - 52;
    A.rule(ctx, x + 22, by - 6, BOX.w - 44, '#8a6e46');
    const hpNow = this.safe(() => maxHP(this.ch), this.ch && this.ch.maxHP);
    const spNow = this.safe(() => maxSP(this.ch), this.ch && this.ch.maxSP);
    const next = this.safe(() => xpForLevel(this.level + 1), 0);
    F.drawText(ctx, `Hit Points ${hpNow}`, x + 22, by, { face: 'small', color: C_DIM });
    F.drawText(ctx, `Spell Points ${spNow}`, x + 22 + 110, by, { face: 'small', color: C_DIM });
    F.drawText(ctx, `Next level at ${gold(next)} xp`, x + BOX.w - 22, by,
      { face: 'small', align: 'right', color: C_DIM });

    // Continue: the whole box is the button, as in the original.
    const bw = 120, bh = 24;
    const bx = x + (BOX.w - bw) / 2, byy = y + BOX.h - 32;
    const hit = this.ui.region('levelup:ok', bx, byy, bw, bh);
    A.button(ctx, bx, byy, bw, bh, null, hit.down ? 'down' : 'up');
    F.drawText(ctx, 'Continue', bx + bw / 2, byy + 7, {
      align: 'center', color: hit.hover ? C_GOLD : C_WHITE,
    });
    const box = this.ui.region('levelup:box', x, y, BOX.w, BOX.h);
    if (hit.click || box.click) { this.sound('click'); this.close(); }
  }

  safe(f, fallback) { try { const v = f(); return v === undefined ? fallback : v; } catch { return fallback; } }

  handleKey(code) {
    if (code === 'Escape' || code === 'Enter' || code === 'Space') { this.close(); return true; }
    return false;
  }
}

export default LevelUpScreen;
