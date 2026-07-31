// ---------------------------------------------------------------------------
// The spellbook.
//
// MM6's book is two facing parchment pages with a spine down the middle and
// nine bookmark tabs down the right edge - one per school, each tinted with the
// school's colour. Only spells the character has actually learned appear; the
// rest of the page is blank parchment. Nine schools of eleven spells: 99, not
// MM7's 108. Turning to a tab swaps the page instantly with a sound; there is
// no page-flip animation in the original and there is none here.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, px, py, SCHOOL_COLORS,
  WHITE, CANARY, HILITE, DIM, BOOK_INK, drawWrapped,
} from './screenbase.js';
import {
  SCHOOLS, SPELLS_BY_SCHOOL, spCostFor, canCast, schoolSkill,
  spellDamageAvg, spellDuration,
} from '../../game/spells.js';
import { MASTERY_NAMES, SCHOOL_TIER_LIMIT } from '../../game/skills.js';

/** Bookmark tabs down the right edge, panel-relative (MM6's own y values). */
const TAB_Y = [10, 46, 83, 121, 158, 196, 234, 271, 307];
const TAB_X = 396;
const TAB_W = 54;
const TAB_H = 32;

const LEFT = { x: 14, y: 12, w: 186, h: 288 };
const RIGHT = { x: 206, y: 12, w: 182, h: 288 };

/** A tiny runic glyph per school, drawn in the school's colour. */
export function schoolGlyph(ctx, school, x, y, s, color) {
  const c = color || SCHOOL_COLORS[school] || WHITE;
  const cx = (x + s / 2) | 0, cy = (y + s / 2) | 0;
  ctx.fillStyle = c;
  switch (school) {
    case 'fire':
      for (let i = 0; i < s; i++) {
        const k = Math.max(1, Math.round((s / 2) * Math.sin((i / s) * Math.PI) * 0.9));
        ctx.fillRect(cx - k, y + s - 1 - i, k * 2, 1);
      }
      break;
    case 'air':
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 1, y + 2 + i * 4, s - 2 - (i % 2) * 3, 1);
      ctx.fillRect(cx, y + 1, 1, s - 2);
      break;
    case 'water':
      for (let i = 0; i < s; i++) {
        const t = i / (s - 1);
        const k = Math.max(1, Math.round((s / 2) * (t < 0.4 ? t * 1.6 : 1 - (t - 0.4) * 0.4)));
        ctx.fillRect(cx - k, y + i, k * 2, 1);
      }
      break;
    case 'earth':
      for (let i = 0; i < s / 2; i++) ctx.fillRect(cx - i * 2, y + s - 1 - i * 2, i * 4 + 1, 2);
      break;
    case 'spirit':
      ctx.fillRect(cx - 1, y, 3, s); ctx.fillRect(x, cy - 1, s, 3);
      break;
    case 'mind':
      for (let i = 0; i < s; i++) {
        const k = Math.round((s / 2) * Math.sin((i / s) * Math.PI));
        ctx.fillRect(cx - k, y + i, 1, 1); ctx.fillRect(cx + k, y + i, 1, 1);
      }
      ctx.fillRect(cx - 1, cy - 1, 3, 3);
      break;
    case 'body':
      ctx.fillRect(cx - 2, y + 2, 5, s - 4); ctx.fillRect(x + 1, cy - 2, s - 2, 5);
      break;
    case 'light':
      ctx.fillRect(cx - 2, cy - 2, 5, 5);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(cx + (i === 0 ? -6 : i === 1 ? 5 : 0), cy + (i === 2 ? -6 : i === 3 ? 5 : 0), i < 2 ? 2 : 1, i < 2 ? 1 : 2);
      }
      break;
    default:
      for (let i = 0; i < s; i++) {
        const k = Math.round(Math.sqrt(Math.max(0, (s / 2) ** 2 - (i - s / 2) ** 2)));
        ctx.fillRect(cx - k, y + i, k * 2, 1);
      }
      ctx.fillStyle = '#000000';
      for (let i = 2; i < s - 2; i++) {
        const k = Math.round(Math.sqrt(Math.max(0, (s / 2 - 2) ** 2 - (i - s / 2) ** 2)));
        ctx.fillRect(cx - k + 2, y + i, k * 2, 1);
      }
      break;
  }
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

    // Two facing pages with a spine between them.
    A.book(ctx, px(LEFT.x), py(LEFT.y), LEFT.w, LEFT.h, 'left');
    A.book(ctx, px(RIGHT.x), py(RIGHT.y), RIGHT.w, RIGHT.h, 'right');
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = tint;
    ctx.fillRect(px(LEFT.x), py(LEFT.y), LEFT.w, LEFT.h);
    ctx.fillRect(px(RIGHT.x), py(RIGHT.y), RIGHT.w, RIGHT.h);
    ctx.globalAlpha = 1;
    // The spine: a dark gutter with stitching.
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(px(200), py(10), 6, 292);
    ctx.fillStyle = '#181008';
    ctx.fillRect(px(202), py(10), 2, 292);
    for (let y = 20; y < 296; y += 14) {
      ctx.fillStyle = '#c8b070';
      ctx.fillRect(px(202), py(y), 2, 4);
    }

    this.drawTabs(ctx, ch);

    if (!ch) {
      F.drawText(ctx, 'No character selected.', px(200), py(150), { align: 'center', color: BOOK_INK });
    } else {
      this.drawList(ctx, ch, tint);
      this.drawDetail(ctx, ch, tint);
    }

    this.drawHelpLine(ctx, 306, '#3a2a10');
    // Exit clears the bookmark column, which owns the right edge here.
    const r = { x: px(320), y: py(316), w: 70, h: 24 };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close the book');
    A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : 'up');
    F.drawText(ctx, 'Exit', (r.x + r.w / 2) | 0, (r.y + 7) | 0, {
      align: 'center', color: hit.hover ? HILITE : CANARY,
    });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }

  drawTabs(ctx, ch) {
    for (let i = 0; i < SCHOOLS.length; i++) {
      const s = SCHOOLS[i];
      const x = px(TAB_X), y = py(TAB_Y[i]);
      const on = s.id === this.school;
      const known = ch ? schoolSkill(ch, s.id).level > 0 : false;
      const hit = this.ui.region(`${this.id}:tab:${s.id}`, x, y, TAB_W, TAB_H,
        known ? `${s.name} magic` : `${s.name} magic - not learned`);
      if (hit.click) this.turnTo(s.id);

      const c = SCHOOL_COLORS[s.id];
      // A bookmark tab: a coloured leather tongue, pushed out when open.
      const w = on ? TAB_W : TAB_W - 8;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, TAB_H);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, w, TAB_H);
      ctx.globalAlpha = on ? 0 : 0.30;
      ctx.fillRect(x, y, w, TAB_H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y, 1, TAB_H);
      ctx.fillStyle = '#1a120a';
      ctx.fillRect(x, y + TAB_H - 1, w, 1);

      schoolGlyph(ctx, s.id, x + 3, y + 8, 16, known ? c : '#5a5a5a');
      F.drawText(ctx, s.name, x + 22, y + 11, {
        face: 'small',
        color: on ? CANARY : hit.hover ? HILITE : known ? WHITE : DIM,
      });
    }
  }

  drawList(ctx, ch, tint) {
    const list = SPELLS_BY_SCHOOL[this.school] || [];
    const school = SCHOOLS.find((s) => s.id === this.school);
    const k = schoolSkill(ch, this.school);
    const maxTier = SCHOOL_TIER_LIMIT[k.mastery] || 0;

    F.drawText(ctx, `${school ? school.name : ''} Magic`, px(LEFT.x + LEFT.w / 2), py(LEFT.y + 6),
      { face: 'title', align: 'center', color: '#2a1a06' });
    F.drawText(ctx, k.level > 0 ? `${MASTERY_NAMES[k.mastery]} ${k.level}` : 'Not learned',
      px(LEFT.x + LEFT.w / 2), py(LEFT.y + 24), { face: 'small', align: 'center', color: BOOK_INK });
    A.rule(ctx, px(LEFT.x + 10), py(LEFT.y + 36), LEFT.w - 20, '#6b5636', 0.6);

    const known = (ch.spells || []);
    let y = LEFT.y + 44;
    for (const sp of list) {
      const rowY = y;
      y += 22;
      if (known.indexOf(sp.id) < 0) continue;      // blank parchment, as MM6 does
      const cost = spCostFor(ch, sp);
      const able = canCast(ch, sp);
      const hit = this.ui.region(`${this.id}:sp:${sp.id}`, px(LEFT.x + 6), py(rowY - 2),
        LEFT.w - 12, 20, able.ok ? `Cast ${sp.name} for ${cost} spell points` : able.reason);

      if (this.selected === sp.id) {
        ctx.globalAlpha = 0.18; ctx.fillStyle = tint;
        ctx.fillRect(px(LEFT.x + 6), py(rowY - 2), LEFT.w - 12, 20);
        ctx.globalAlpha = 1;
      }
      schoolGlyph(ctx, this.school, px(LEFT.x + 8), py(rowY), 14,
        able.ok ? tint : '#8a8a8a');
      const color = !able.ok ? '#8a8a8a' : hit.hover ? HILITE : BOOK_INK;
      F.drawText(ctx, sp.name, px(LEFT.x + 28), py(rowY + 1), { face: 'small', color });
      F.drawText(ctx, `${cost}`, px(LEFT.x + LEFT.w - 10), py(rowY + 1),
        { face: 'small', align: 'right', color: able.ok ? '#2a1a06' : '#8a8a8a' });
      if (sp.tier > maxTier) {
        // Beyond the character's rank: MM6 keeps it in the book but locked.
        ctx.fillStyle = '#a01008';
        ctx.fillRect(px(LEFT.x + LEFT.w - 6), py(rowY + 3), 3, 8);
      }
      if (hit.hover) this.selected = sp.id;
      if (hit.click) this.cast(ch, sp, able);
      if (hit.rightClick) {
        ch.quickSpell = sp.id;
        this.status = `${sp.name} is now the quick spell.`;
        this.sound('click');
      }
    }
    if (!known.length) {
      F.drawText(ctx, 'This book is empty.', px(LEFT.x + LEFT.w / 2), py(LEFT.y + 120),
        { face: 'small', align: 'center', color: '#8a8a8a' });
    }
  }

  drawDetail(ctx, ch, tint) {
    const sp = this.selected ? (SPELLS_BY_SCHOOL[this.school] || []).find((s) => s.id === this.selected) : null;
    const x = RIGHT.x + 12, w = RIGHT.w - 24;
    if (!sp) {
      F.drawText(ctx, 'Choose a spell', px(RIGHT.x + RIGHT.w / 2), py(RIGHT.y + 120),
        { face: 'small', align: 'center', color: '#8a8a8a' });
      F.drawText(ctx, 'Left-click casts. Right-click', px(RIGHT.x + RIGHT.w / 2), py(RIGHT.y + 136),
        { face: 'small', align: 'center', color: '#8a8a8a' });
      F.drawText(ctx, 'sets the quick spell.', px(RIGHT.x + RIGHT.w / 2), py(RIGHT.y + 148),
        { face: 'small', align: 'center', color: '#8a8a8a' });
      return;
    }
    const k = schoolSkill(ch, this.school);
    const cost = spCostFor(ch, sp);
    const able = canCast(ch, sp);

    schoolGlyph(ctx, this.school, px(x), py(RIGHT.y + 8), 18, tint);
    // Long names (Protection from Fire) will not fit the title face on a
    // half-page, so the face steps down rather than running off the edge.
    const wide = F.measure(sp.name, 'title').w > w - 26;
    F.drawText(ctx, sp.name, px(x + 24), py(RIGHT.y + (wide ? 12 : 8)), {
      face: wide ? 'normal' : 'title', color: '#2a1a06', maxWidth: w - 26,
    });
    A.rule(ctx, px(x), py(RIGHT.y + 30), w, '#6b5636', 0.6);

    let y = RIGHT.y + 38;
    const line = (label, value, color) => {
      F.drawText(ctx, label, px(x), py(y), { face: 'small', color: '#6b5636' });
      F.drawText(ctx, value, px(x + w), py(y), { face: 'small', align: 'right', color: color || BOOK_INK });
      y += 12;
    };
    line('Spell points', String(cost), (ch.sp | 0) >= cost ? BOOK_INK : '#a01008');
    line('Rank needed', sp.tier <= 4 ? 'Normal' : sp.tier <= 7 ? 'Expert' : 'Master');
    line('Your rank', k.level > 0 ? `${MASTERY_NAMES[k.mastery]} ${k.level}` : 'None');
    if (sp.dmg) line('Damage', `~${spellDamageAvg(sp, k.level, k.mastery)}`);
    if (sp.dur) line('Duration', `${spellDuration(sp, k.level, k.mastery)} min`);
    if (sp.radius) line('Area', 'yes');

    y += 6;
    A.rule(ctx, px(x), py(y - 3), w, '#6b5636', 0.4);
    y = drawWrapped(ctx, sp.text || '', px(x), py(y + 2), w, { face: 'small', color: BOOK_INK }) - PANEL.y + 4;

    const note = sp.notes && (sp.notes[k.mastery] || sp.notes[3]);
    if (note) {
      y = drawWrapped(ctx, `At rank: ${note}`, px(x), py(y + 4), w,
        { face: 'small', color: '#5a4a2a' }) - PANEL.y;
    }

    if (!able.ok) {
      drawWrapped(ctx, able.reason, px(x), py(RIGHT.y + RIGHT.h - 34), w,
        { face: 'small', color: '#a01008', maxLines: 2 });
    }
    const qs = ch.quickSpell === sp.id;
    F.drawText(ctx, qs ? 'Quick spell' : 'Right-click to set as quick spell',
      px(RIGHT.x + RIGHT.w / 2), py(RIGHT.y + RIGHT.h - 12),
      { face: 'small', align: 'center', color: qs ? '#1d6b1d' : '#8a8a8a' });
  }

  cast(ch, sp, able) {
    if (!able.ok) { this.status = able.reason; this.sound('error'); return; }
    const s = this.session;
    if (typeof s.castSpell === 'function') s.castSpell(this.charIndex, sp.id);
    else s.pendingCast = { char: this.charIndex, spell: sp.id };
    this.sound('cast');
    this.close();
  }
}

export default SpellbookScreen;
