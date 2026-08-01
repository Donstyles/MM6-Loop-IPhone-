// ---------------------------------------------------------------------------
// Quick Reference.
//
// One table, four characters side by side, everything you need at a glance and
// nothing clickable. MM6 opens it with Q from the bottom bar and it is the
// fastest way to see who is hurt, who is out of spell points and who is about
// to be too drunk to fight.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, px, py, TAB_Y, TAB_H, EXIT_X, EXIT_W,
  WHITE, CANARY, HILITE, DIM, GREEN, SCARLET, RED,
} from './screenbase.js';
import {
  STATS, CLASSES, maxHP, maxSP, armorClass, effectiveStat, worstCondition,
  CONDITIONS, xpForLevel,
} from '../../game/stats.js';

// The page is #C8B48C parchment: it is written in ink, not the HUD palette.
const INK = '#2c1e0c';
const LABEL = '#5c400f';
const HEAD = '#6b4a10';
const INK_GOOD = '#166b16';
const INK_BAD = '#a02008';
const INK_RED = '#8c0808';
const INK_DIM = '#7a6a50';
const RULE = '#7a6038';
const EMB = '#ece0c2';
const T = (ctx, str, x, y, o = {}) => F.drawText(ctx, str, x, y, Object.assign({ shadow: EMB }, o));

const LABEL_X = 14;
const LABEL_W = 84;
const COL_X = 102;
const COL_W = 86;
const ROW_H = 13;
const TOP = 50;

function fmt(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function conditionColor(condId) {
  const c = CONDITIONS[condId];
  if (!c || c.severity === 0) return INK_GOOD;
  if (c.severity >= 14) return INK_RED;
  if (c.severity >= 8) return INK_BAD;
  return LABEL;
}

export class QuickRefScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'quickref';
  }

  onOpen() { this.sound('page'); }

  handleKey(code) {
    if (code === 'Escape' || code === 'KeyQ') { this.close(); return true; }
    return false;
  }

  rows(ch) {
    if (!ch) return [];
    const hp = maxHP(ch), sp = maxSP(ch);
    const klass = CLASSES[ch.class] || CLASSES[ch.klass] || null;
    const cond = worstCondition(ch);
    const xp = ch.xp !== undefined ? ch.xp : (ch.experience || 0);
    const out = [
      ['Class', klass ? klass.name : '-', INK],
      ['Level', String(ch.level | 0), INK],
      ['Experience', fmt(xp), INK],
      ['Next Level', fmt(Math.max(0, xpForLevel((ch.level | 0) + 1) - xp)), INK_DIM],
      ['Hit Points', `${ch.hp | 0}/${hp}`, (ch.hp | 0) <= hp * 0.25 ? INK_RED : (ch.hp | 0) < hp ? INK_BAD : INK],
      ['Spell Points', sp ? `${ch.sp | 0}/${sp}` : '-', sp ? INK : INK_DIM],
      ['Armour Class', String(armorClass(ch)), INK],
    ];
    for (const st of STATS) {
      const base = (ch.stats && ch.stats[st.id]) | 0;
      const cur = effectiveStat(ch, st.id);
      out.push([st.name, String(cur), cur > base ? INK_GOOD : cur < base ? INK_BAD : INK]);
    }
    out.push(['Skill Points', String(ch.skillPoints | 0), (ch.skillPoints | 0) > 0 ? HEAD : INK_DIM]);
    out.push(['Age', String(ch.age || 18), INK]);
    out.push(['Condition', cond.name, conditionColor(cond.id)]);
    return out;
  }

  draw(ctx) {
    this.drawPage(ctx, 'sheet');
    const members = this.members;

    T(ctx, 'Quick Reference', px(PANEL.w / 2), py(12),
      { face: 'title', align: 'center', color: HEAD });
    A.rule(ctx, px(LABEL_X), py(32), PANEL.w - LABEL_X * 2, RULE, 0.35);

    // Column headers: the four names, active one gilded.
    for (let i = 0; i < 4; i++) {
      const ch = members[i];
      const x = px(COL_X + i * COL_W);
      const hit = this.ui.region(`${this.id}:col${i}`, x, py(36), COL_W, PANEL.h - 60,
        ch ? `${ch.name}` : 'Empty slot');
      if (hit.click && ch) { this.session.activeChar = i; this.sound('click'); }
      if (i === this.charIndex) {
        ctx.globalAlpha = 0.14; ctx.fillStyle = '#ffe8a0';
        ctx.fillRect(x, py(36), COL_W, TOP - 36 + this.rows(ch).length * ROW_H + 4);
        ctx.globalAlpha = 1;
      }
      T(ctx, ch ? ch.name : '-', x + COL_W / 2, py(38), {
        align: 'center', color: !ch ? INK_DIM : i === this.charIndex ? HEAD : hit.hover ? LABEL : INK,
      });
    }
    A.rule(ctx, px(LABEL_X), py(TOP - 6), PANEL.w - LABEL_X * 2, RULE, 0.35);

    // Rows: labels down the left, one value per character.
    const template = this.rows(members[0] || null);
    const rowCount = template.length;
    for (let r = 0; r < rowCount; r++) {
      const y = TOP + r * ROW_H;
      if (r % 2 === 1) {
        ctx.globalAlpha = 0.10; ctx.fillStyle = '#000000';
        ctx.fillRect(px(LABEL_X), py(y - 2), PANEL.w - LABEL_X * 2 - 8, ROW_H);
        ctx.globalAlpha = 1;
      }
      T(ctx, template[r][0], px(LABEL_X), py(y), { face: 'small', color: HEAD });
    }
    for (let i = 0; i < 4; i++) {
      const ch = members[i];
      if (!ch) continue;
      const rows = this.rows(ch);
      for (let r = 0; r < rows.length; r++) {
        T(ctx, rows[r][1], px(COL_X + i * COL_W + COL_W - 8), py(TOP + r * ROW_H), {
          face: 'small', align: 'right', color: rows[r][2],
        });
      }
    }

    // Party footer: gold, food and the date.
    const fy = TOP + rowCount * ROW_H + 6;
    A.rule(ctx, px(LABEL_X), py(fy - 4), PANEL.w - LABEL_X * 2, RULE, 0.35);
    const clock = this.session.clock;
    const parts = [
      ['Gold', fmt(this.party.gold), HEAD],
      ['Food', fmt(this.party.food), INK],
      ['Day', clock ? `${clock.day}` : '-', INK],
      ['Time', clock && clock.format ? clock.format() : '-', INK],
    ];
    let x = LABEL_X;
    for (const [label, value, color] of parts) {
      T(ctx, `${label}:`, px(x), py(fy + 4), { face: 'small', color: INK_DIM });
      T(ctx, value, px(x + 34), py(fy + 4), { face: 'small', color });
      x += 108;
    }

    this.drawHelpLine(ctx, 306, LABEL);

    const r = { x: px(EXIT_X), y: py(TAB_Y), w: EXIT_W, h: TAB_H };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close');
    const d = A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : hit.hover ? 'hot' : 'up');
    F.drawText(ctx, 'Exit', (r.x + r.w / 2 + d) | 0, (r.y + 7 + d) | 0,
      { align: 'center', color: hit.hover ? HILITE : CANARY });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }
}

export default QuickRefScreen;
