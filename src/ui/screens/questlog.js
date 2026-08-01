// ---------------------------------------------------------------------------
// Quest log: Current Quests / Auto Notes / Awards / History.
//
// MM6 keeps all four in one book, with the sub-page buttons down the right
// inner margin. Text flows across the two facing pages, left column first, and
// a wooden scrollbar rides the outer edge. Everything is read-only.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, px, py, TAB_Y, TAB_H, EXIT_X, EXIT_W,
  CANARY, HILITE, BOOK_INK, PASTELS, wrapLines,
} from './screenbase.js';
import * as M from './mm6art.js';
import { regionName } from '../../game/quests.js';

const PAGES = ['Quests', 'Notes', 'Awards', 'History'];
const PAGE_TITLES = ['Current Quests', 'Auto Notes', 'Awards', 'History'];
/** Sub-page buttons down the right inner margin, panel-relative. MM6 spaces
 *  its six book buttons 37 px apart; with four pages they run consecutively. */
const SUB_X = 398;
const SUB_Y = [1, 38, 75, 112];
const SUB_W = 50;
const SUB_H = 34;

const LEFT = { x: 14, y: 12, w: 178, h: 278 };
const RIGHT = { x: 200, y: 12, w: 178, h: 278 };
const LINE_H = 11;

const INK_TITLE = '#2e2e2e';
const INK_BODY = BOOK_INK;
const INK_NOTE = '#4b4b4b';

export class QuestLogScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'questlog';
    this.page = (opts && opts.page) || 0;
    this.scroll = [0, 0, 0, 0];
  }

  onOpen() { this.sound('page'); }

  handleKey(code) {
    if (code === 'Escape' || code === 'KeyQ') { this.close(); return true; }
    if (code === 'ArrowDown') { this.scroll[this.page]++; return true; }
    if (code === 'ArrowUp') { this.scroll[this.page] = Math.max(0, this.scroll[this.page] - 1); return true; }
    return false;
  }

  // --- content --------------------------------------------------------------

  quests() {
    const q = (this.session && this.session.quests) || {};
    const list = q.active || this.party.quests || [];
    return list.filter((e) => e && !e.done);
  }

  notes() {
    const q = (this.session && this.session.quests) || {};
    return q.notes || this.party.autonotes || [];
  }

  awards() {
    const out = [];
    for (const m of this.members) {
      for (const a of (m.awards || [])) out.push({ who: m.name, text: typeof a === 'string' ? a : a.text });
      for (const t of (m.titles || [])) out.push({ who: m.name, text: typeof t === 'string' ? t : t.text });
    }
    for (const a of (this.party.awards || [])) out.push({ who: '', text: typeof a === 'string' ? a : a.text });
    return out;
  }

  history() {
    const q = (this.session && this.session.quests) || {};
    return q.history || this.party.history || [];
  }

  /** Flatten the active page into coloured lines so it can flow over 2 pages. */
  lines(colW) {
    const out = [];
    const add = (text, color, face, indent) => {
      for (const l of wrapLines(text, colW - (indent || 0), face || 'small')) {
        out.push({ text: l, color: color || INK_BODY, face: face || 'small', indent: indent || 0 });
      }
    };
    const blank = () => out.push({ text: '', color: INK_BODY, face: 'small', indent: 0 });

    if (this.page === 0) {
      const list = this.quests();
      if (!list.length) add('You have no quests. Ask in the taverns.', INK_NOTE);
      for (const q of list) {
        add(q.title || q.name || 'Quest', INK_TITLE, 'small', 0);
        // Never print a raw map id: quests carry the engine id, the page prints the
        // place name.
        const from = [q.giver, q.region ? regionName(q.region) : ''].filter(Boolean).join(', ');
        if (from) add(from, INK_NOTE, 'small', 6);
        if (q.objective || q.text) add(q.objective || q.text, INK_BODY, 'small', 6);
        if (q.progress !== undefined && q.goal !== undefined) {
          add(`Progress: ${q.progress} of ${q.goal}`,
            q.progress >= q.goal ? '#1d6b1d' : INK_BODY, 'small', 6);
        }
        blank();
      }
    } else if (this.page === 1) {
      const list = this.notes();
      if (!list.length) add('Nothing noted yet.', INK_NOTE);
      for (const n of list) {
        const t = typeof n === 'string' ? n : (n.text || '');
        add(`• ${t}`, INK_BODY, 'small', 0);
        blank();
      }
    } else if (this.page === 2) {
      const list = this.awards();
      if (!list.length) add('No awards yet. Deeds earn them.', INK_NOTE);
      list.forEach((a, i) => {
        // Awards keep their pastel cycling, darkened so they read on paper.
        const c = darken(PASTELS[i % PASTELS.length]);
        if (a.who) add(`${a.who}:`, INK_NOTE, 'small', 0);
        add(a.text || '', c, 'small', a.who ? 6 : 0);
        blank();
      });
    } else {
      const list = this.history();
      if (!list.length) add('Nothing has happened yet.', INK_NOTE);
      for (const h of list) {
        const when = h.when || h.date || (h.day !== undefined ? `Day ${h.day}` : '');
        if (when) add(when, INK_TITLE, 'small', 0);
        add(typeof h === 'string' ? h : (h.text || ''), INK_BODY, 'small', 6);
        blank();
      }
    }
    return out;
  }

  // --- drawing --------------------------------------------------------------

  draw(ctx) {
    this.drawPage(ctx, 'page');

    A.book(ctx, px(LEFT.x), py(LEFT.y), LEFT.w, LEFT.h, 'left');
    A.book(ctx, px(RIGHT.x), py(RIGHT.y), RIGHT.w, RIGHT.h, 'right');
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(px(194), py(10), 6, 282);
    ctx.fillStyle = '#181008';
    ctx.fillRect(px(196), py(10), 2, 282);
    for (let y = 20; y < 286; y += 14) {
      ctx.fillStyle = '#c8b070';
      ctx.fillRect(px(196), py(y), 2, 4);
    }

    F.drawText(ctx, PAGE_TITLES[this.page], px(LEFT.x + LEFT.w / 2), py(LEFT.y + 6),
      { face: 'title', align: 'center', color: INK_TITLE });
    A.rule(ctx, px(LEFT.x + 8), py(LEFT.y + 26), LEFT.w - 16, '#6b5636', 0.6);
    A.rule(ctx, px(RIGHT.x + 8), py(LEFT.y + 26), RIGHT.w - 16, '#6b5636', 0.6);

    const colW = LEFT.w - 24;
    const top = LEFT.y + 34;
    const perCol = Math.floor((LEFT.h - (top - LEFT.y) - 8) / LINE_H);
    const all = this.lines(colW);
    const visible = perCol * 2;

    this.scroll[this.page] = this.scrollbar(ctx, `bar${this.page}`, px(380), py(top),
      perCol * LINE_H, this.scroll[this.page], all.length, visible);
    const start = this.scroll[this.page];

    for (let i = 0; i < visible && start + i < all.length; i++) {
      const ln = all[start + i];
      if (!ln.text) continue;
      const col = i < perCol ? LEFT : RIGHT;
      const row = i < perCol ? i : i - perCol;
      F.drawText(ctx, ln.text, px(col.x + 12 + ln.indent), py(top + row * LINE_H),
        { face: ln.face, color: ln.color });
    }

    // Page-turn arrows, MM6's small corner marks.
    if (start > 0) F.drawText(ctx, '↑', px(LEFT.x + 6), py(LEFT.y + LEFT.h - 14), { face: 'small', color: INK_NOTE });
    if (start + visible < all.length) {
      F.drawText(ctx, '↓', px(RIGHT.x + RIGHT.w - 10), py(RIGHT.y + RIGHT.h - 14),
        { face: 'small', color: INK_NOTE });
    }

    this.drawSubTabs(ctx);
    this.drawHelpLine(ctx, 296, '#3a2a10');

    const r = { x: px(EXIT_X), y: py(TAB_Y), w: EXIT_W, h: TAB_H };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close the book');
    const d = M.sheetTab(ctx, r.x, r.y, r.w, r.h,
      { open: false, down: hit.down, hot: hit.hover, seed: 17 });
    F.drawText(ctx, 'Exit', (r.x + r.w / 2 + d) | 0, (r.y + 9 + d) | 0,
      { align: 'center', color: hit.hover ? HILITE : CANARY });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }

  /**
   * MM6's sub-page buttons: four 50 x 34 *picture* buttons down the inner
   * margin, each a bound volume seen spine-on. They carry no lettering at all -
   * the open book is the one pulled proud of the shelf, and the page's own
   * title at the head of the leaf says which chapter you are reading.
   */
  drawSubTabs(ctx) {
    const tint = ['#8c3a20', '#4a6030', '#5a3a6a', '#2e4668'];
    for (let i = 0; i < PAGES.length; i++) {
      const on = i === this.page;
      const x = px(SUB_X), y = py(SUB_Y[i]);
      const hit = this.ui.region(`${this.id}:sub${i}`, x, y, SUB_W, SUB_H, PAGE_TITLES[i]);
      if (hit.click && !on) { this.page = i; this.sound('page_turn'); }
      M.bookSpine(ctx, x, y, SUB_W, SUB_H, {
        tint: tint[i], open: on, hot: hit.hover, seed: 5 + i * 7,
      });
    }
  }
}

/** Pastels are made for a dark panel; on paper they need taking down a stop. */
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * 0.55, g = ((n >> 8) & 255) * 0.55, b = (n & 255) * 0.55;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export default QuestLogScreen;
