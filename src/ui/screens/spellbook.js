// ---------------------------------------------------------------------------
// The spellbook.
//
// MM6's book is two facing parchment pages with a spine down the middle and
// nine wordless bookmark tabs down the right edge - one per school, each a small
// painted tab in its school's colour at the engine's own fixed coordinates.
// The page carries painted spell sigils laid out by a hand-authored table, not
// a list: only spells the character has learned are drawn, and every other slot
// is left as blank parchment. Nine schools of eleven spells: 99, not MM7's 108.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, px, py, SCHOOL_COLORS,
  WHITE, CANARY, HILITE, DIM, BOOK_INK, drawWrapped,
} from './screenbase.js';
import * as M from './mm6art.js';
import {
  SCHOOLS, SPELLS_BY_SCHOOL, spCostFor, canCast, schoolSkill,
  spellDamageAvg, spellDuration,
} from '../../game/spells.js';
import { MASTERY_NAMES, SCHOOL_TIER_LIMIT } from '../../game/skills.js';

/** Bookmark tabs down the right edge, panel-relative - the engine's own list. */
const TAB_Y = [10, 46, 83, 121, 158, 196, 234, 271, 307];
const TAB_X = 399;
const TAB_W = 54;
const TAB_H = 32;

const LEFT = { x: 14, y: 12, w: 180, h: 290 };
const RIGHT = { x: 202, y: 12, w: 180, h: 290 };

const GLYPH = 30;

/**
 * MM6 lays each school's icons out by hand, so the arrangement is deliberately
 * irregular: six sigils on the recto, five on the verso, none of them on a
 * regular grid. Positions are the sigil's top-left, page-relative.
 */
const ICON_POS = [
  [0, 22, 26], [0, 88, 18], [0, 138, 40],
  [0, 26, 96], [0, 92, 104], [0, 140, 152],
  [1, 20, 30], [1, 90, 24], [1, 136, 66],
  [1, 30, 110], [1, 100, 128],
];

/** A small painted sigil used on the tabs and in the spell detail. */
export function schoolGlyph(ctx, school, x, y, s, color) {
  M.spellSigil(ctx, school, 0, x | 0, y | 0, s | 0);
}

export class SpellbookScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'spellbook';
    this.school = (opts && opts.school) || 'fire';
    this.selected = null;
  }

  onOpen() {
    const ch = this.character;
    // Open on a school the character can actually use, as MM6 does.
    if (ch) {
      const k = schoolSkill(ch, this.school);
      if (!k.level) {
        for (const s of SCHOOLS) if (schoolSkill(ch, s.id).level > 0) { this.school = s.id; break; }
      }
    }
    this.sound('page');
  }

  onCharChanged() { this.selected = null; this.onOpen(); }

  handleKey(code) {
    if (code === 'Escape' || code === 'KeyC') { this.close(); return true; }
    const i = SCHOOLS.findIndex((s) => s.id === this.school);
    if (code === 'ArrowDown' && i < 8) { this.turnTo(SCHOOLS[i + 1].id); return true; }
    if (code === 'ArrowUp' && i > 0) { this.turnTo(SCHOOLS[i - 1].id); return true; }
    return false;
  }

  turnTo(school) {
    if (school === this.school) return;
    this.school = school;
    this.selected = null;
    this.sound('page_turn');
  }

  draw(ctx) {
    this.drawPage(ctx, 'page');
    const ch = this.character;
    const tint = SCHOOL_COLORS[this.school] || WHITE;

    // Two facing leaves of spellbook stock, bound over a stitched spine.
    M.paper(ctx, px(LEFT.x), py(LEFT.y), LEFT.w, LEFT.h, 'spell', 23);
    M.paper(ctx, px(RIGHT.x), py(RIGHT.y), RIGHT.w, RIGHT.h, 'spell', 29);
    M.gutter(ctx, px(LEFT.x + LEFT.w - 1), py(LEFT.y), LEFT.h, 'left');
    M.gutter(ctx, px(RIGHT.x), py(RIGHT.y), RIGHT.h, 'right');
    // A school-tinted wash on the leaf edges, the way MM6 tints each chapter.
    M.stipple(ctx, px(LEFT.x), py(LEFT.y), LEFT.w, 3, M.hexRGB(tint), 0.5);
    M.stipple(ctx, px(RIGHT.x), py(RIGHT.y), RIGHT.w, 3, M.hexRGB(tint), 0.5);
    M.stipple(ctx, px(LEFT.x), py(LEFT.y + LEFT.h - 3), LEFT.w, 3, M.hexRGB(tint), 0.5);
    M.stipple(ctx, px(RIGHT.x), py(RIGHT.y + RIGHT.h - 3), RIGHT.w, 3, M.hexRGB(tint), 0.5);

    M.rct(ctx, px(194), py(10), 8, 294, [58, 42, 20]);
    M.rct(ctx, px(197), py(10), 3, 294, [24, 16, 8]);
    for (let y = 20; y < 300; y += 14) M.rct(ctx, px(197), py(y), 3, 5, [176, 148, 92]);

    this.drawTabs(ctx, ch);

    if (!ch) {
      F.drawText(ctx, 'No character selected.', px(198), py(150), { align: 'center', color: BOOK_INK });
    } else {
      this.drawSigils(ctx, ch, tint);
      this.drawFooter(ctx, ch);
    }

    // Exit sits clear of the bookmark column, which owns the right edge here.
    const r = { x: px(316), y: py(316), w: 70, h: 24 };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close the book');
    const d = A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : hit.hover ? 'hot' : 'up',
      { material: 'wood', seed: 9 });
    F.drawText(ctx, 'Exit', (r.x + r.w / 2 + d) | 0, (r.y + 7 + d) | 0, {
      align: 'center', color: hit.hover ? HILITE : CANARY,
    });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }

  /** Nine painted bookmark tabs, no lettering, at the engine's coordinates. */
  drawTabs(ctx, ch) {
    for (let i = 0; i < SCHOOLS.length; i++) {
      const s = SCHOOLS[i];
      const on = s.id === this.school;
      // The open chapter's tab sits proud of the page; the rest tuck in.
      const x = px(TAB_X + (on ? 0 : 7));
      const w = on ? TAB_W : TAB_W - 7;
      const y = py(TAB_Y[i]);
      const known = ch ? schoolSkill(ch, s.id).level > 0 : false;
      const hit = this.ui.region(`${this.id}:tab:${s.id}`, px(TAB_X), y, TAB_W, TAB_H,
        known ? `${s.name} magic` : `${s.name} magic - not learned`);
      if (hit.click) this.turnTo(s.id);
      M.bookmarkTab(ctx, x, y, w, TAB_H, SCHOOL_COLORS[s.id], { open: on || hit.hover });
      // The tab's own sigil is the only marking - MM6 prints no school names.
      const gs = 20;
      if (known) M.spellSigil(ctx, s.id, 0, x + 8, y + ((TAB_H - gs) >> 1), gs);
      else M.spellSigilGhost(ctx, s.id, 0, x + 8, y + ((TAB_H - gs) >> 1), gs);
    }
  }

  /** Painted sigils across both leaves; unlearned slots stay blank parchment. */
  drawSigils(ctx, ch, tint) {
    const list = SPELLS_BY_SCHOOL[this.school] || [];
    const school = SCHOOLS.find((s) => s.id === this.school);
    const k = schoolSkill(ch, this.school);
    const maxTier = SCHOOL_TIER_LIMIT[k.mastery] || 0;
    const known = ch.spells || [];

    F.drawText(ctx, `${school ? school.name : ''} Magic`, px(LEFT.x + LEFT.w / 2), py(LEFT.y + 6),
      { face: 'title', align: 'center', color: '#2a1a06' });
    F.drawText(ctx, k.level > 0 ? `${MASTERY_NAMES[k.mastery]} ${k.level}` : 'Not learned',
      px(RIGHT.x + RIGHT.w / 2), py(RIGHT.y + 8), { face: 'small', align: 'center', color: BOOK_INK });

    let hovered = null;
    for (let i = 0; i < Math.min(11, list.length); i++) {
      const sp = list[i];
      const [page, ox, oy] = ICON_POS[i] || ICON_POS[ICON_POS.length - 1];
      const pg = page ? RIGHT : LEFT;
      const x = px(pg.x + ox), y = py(pg.y + oy);
      if (known.indexOf(sp.id) < 0) continue;          // blank parchment, as MM6 does

      const able = canCast(ch, sp);
      const cost = spCostFor(ch, sp);
      const hit = this.ui.region(`${this.id}:sp:${sp.id}`, x - 2, y - 2, GLYPH + 4, GLYPH + 4,
        able.ok ? `${sp.name}  -  ${cost} spell points` : `${sp.name} - ${able.reason}`);

      // A learned-but-locked spell is painted in but greyed, as MM6 does.
      if (able.ok || sp.tier <= maxTier) M.spellSigil(ctx, this.school, sp.tier, x, y, GLYPH);
      else M.spellSigilGhost(ctx, this.school, sp.tier, x, y, GLYPH);
      if (hit.hover || this.selected === sp.id) {
        M.stipple(ctx, x - 2, y - 2, GLYPH + 4, GLYPH + 4, [225, 205, 35], 0.28);
        hovered = { sp, cost, able };
      }
      if (hit.hover) this.selected = sp.id;
      if (hit.click) this.cast(ch, sp, able);
      if (hit.rightClick) { ch.quickSpell = sp.id; this.sound('click'); }
      if (ch.quickSpell === sp.id) {
        // The quick spell is ribboned, not labelled.
        M.rct(ctx, x + GLYPH - 6, y - 3, 5, 12, [178, 32, 24]);
        M.rct(ctx, x + GLYPH - 6, y - 3, 2, 12, [232, 96, 72]);
      }
    }
    this.hovered = hovered;
  }

  /** The hovered spell's name, cost and effect, printed on the recto in ink. */
  drawFooter(ctx, ch) {
    const h = this.hovered;
    const y = RIGHT.y + RIGHT.h - 78;
    if (!h) return;
    const x = RIGHT.x + 12, w = RIGHT.w - 24;
    A.rule(ctx, px(x), py(y - 6), w, '#6b5636', 0.55);
    F.drawText(ctx, h.sp.name, px(x), py(y), { color: '#2a1a06', maxWidth: w });
    F.drawText(ctx, `${h.cost} sp`, px(x + w), py(y), { face: 'small', align: 'right', color: BOOK_INK });
    const k = schoolSkill(ch, this.school);
    const bits = [];
    if (h.sp.dmg) bits.push(`~${spellDamageAvg(h.sp, k.level, k.mastery)} damage`);
    if (h.sp.dur) bits.push(`${spellDuration(h.sp, k.level, k.mastery)} min`);
    if (bits.length) F.drawText(ctx, bits.join(', '), px(x), py(y + 13), { face: 'small', color: BOOK_INK });
    drawWrapped(ctx, h.able.ok ? (h.sp.text || '') : h.able.reason, px(x), py(y + 26), w,
      { face: 'small', color: h.able.ok ? BOOK_INK : '#8a1a10', maxLines: 4, lineHeight: 10 });
  }

  cast(ch, sp, able) {
    if (!able.ok) { this.sound('error'); return; }
    const s = this.session;
    if (typeof s.castSpell === 'function') s.castSpell(this.charIndex, sp.id);
    else s.pendingCast = { char: this.charIndex, spell: sp.id };
    this.sound('cast');
    this.close();
  }
}

export default SpellbookScreen;
