// ---------------------------------------------------------------------------
// The magic guilds - one per school.
//
// A guild sells the eleven spells of its school and nothing else. You must join
// first (a fee, and some guilds will not take just anybody), and a spell is
// only sold to a character whose rank in the school can actually cast it:
// Normal reaches spell 4, Expert spell 7, Master all eleven.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';

import * as F from '../../art/font.js';
import * as MM6 from './mm6art.js';
import { SPELLS_BY_SCHOOL, spellPrice, schoolSkill } from '../../game/spells.js';
import { SCHOOL_TIER_LIMIT, classSkillMax, MASTERY_NAMES, masteryCost, masteryRequirement } from '../../game/skills.js';
import { CLASSES } from '../../game/stats.js';
import {
  HouseScreen, PANEL, baked, poly, figure, gold, paintWall, paintFloor,
  paintShelf, paintClutter, vignette, members, activeMember, charName, partyGold, spend,
  C_WHITE, C_CANARY, C_DIM, C_RED, C_GREEN,
} from './dialogue.js';

const SCHOOL_TINT = {
  fire: '#e05a1e', air: '#9fd8ff', water: '#3f7ad8', earth: '#7a8c3a',
  spirit: '#ffd84a', mind: '#c078e8', body: '#4ec44e', light: '#fff0b0', dark: '#6a4a8c',
};

const GUILD_NAME = {
  fire: 'Guild of Fire', air: 'Guild of Air', water: 'Guild of Water',
  earth: 'Guild of Earth', spirit: 'Guild of the Spirit', mind: 'Guild of the Mind',
  body: 'Guild of the Body', light: 'Temple of Light', dark: 'Circle of the Dark',
};

/**
 * A flat elliptical band, filled scanline by scanline: for each row of the
 * outer ellipse, paint only the span that falls outside the inner one. Keeps
 * the floor texture underneath instead of stamping a solid patch over it.
 */
function ringE(g, cx, cy, rx, ry, thick, color) {
  g.fillStyle = color;
  const irx = rx - thick, iry = Math.max(1, ry - Math.max(1, Math.round((ry * thick) / rx)));
  for (let dy = -ry; dy <= ry; dy++) {
    const o = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    if (o <= 0) continue;
    const i = Math.abs(dy) <= iry
      ? Math.round(irx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (iry * iry))))
      : 0;
    const y = Math.round(cy) + dy;
    if (i <= 0) { g.fillRect(Math.round(cx) - o, y, o * 2, 1); continue; }
    g.fillRect(Math.round(cx) - o, y, o - i, 1);
    g.fillRect(Math.round(cx) + i, y, o - i, 1);
  }
}

/** Shelved tomes, a lectern, a floating focus in the school's colour. */
export function paintGuildInterior(g, w, h, school) {
  const tint = SCHOOL_TINT[school] || '#c078e8';
  const horizon = Math.round(h * 0.58);
  paintWall(g, 0, 0, w, horizon, { ramp: 'stone', lo: 0.10, hi: 0.40, course: 20, seed: 141 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'stone', seed: 147 });

  // Bookcases either side, floor to ceiling.
  for (const bx of [10, w - 148]) {
    g.fillStyle = rampCss('wood', 3);
    g.fillRect(bx, 12, 138, horizon - 6);
    for (let r = 0; r < 5; r++) {
      const sy = 40 + r * 42;
      paintShelf(g, bx + 6, sy, 126, { th: 4, shadow: 4 });
      for (let i = 0; i < 15; i++) {
        const x = bx + 10 + i * 8;
        const bh = 20 + ((i * 5 + r * 3) % 4) * 4;
        g.fillStyle = rampCss(['blood', 'wood', 'foliage', 'water', 'swamp'][(i + r) % 5], 3 + ((i + r) % 4));
        g.fillRect(x, sy - bh, 6, bh);
        if ((i + r) % 3 === 0) {
          g.fillStyle = rampCss('gold', 8);
          g.fillRect(x, sy - bh + 4, 6, 1);
        }
      }
    }
  }

  // Lectern with an open tome, off to the left so the circle in the middle of
  // the floor stays clear.
  const lx = Math.round(w * 0.24), ly = horizon + 30;
  g.fillStyle = rampCss('wood', 4);
  g.fillRect(lx - 5, ly - 44, 10, 44);
  g.fillRect(lx - 22, ly, 44, 5);
  poly(g, [lx - 34, ly - 44, lx + 34, ly - 44, lx + 30, ly - 56, lx - 30, ly - 56], rampCss('wood', 6));
  g.fillStyle = rampCss('sand', 12);
  poly(g, [lx - 30, ly - 46, lx - 2, ly - 52, lx - 2, ly - 44, lx - 28, ly - 40], rampCss('sand', 12));
  poly(g, [lx + 30, ly - 46, lx + 2, ly - 52, lx + 2, ly - 44, lx + 28, ly - 40], rampCss('sand', 11));

  // The focus: a shard of the school's element hanging over the runic circle,
  // clear of the shelved tomes so neither reads as clutter behind the other.
  const cxr = Math.round(w / 2);
  const fx = cxr, fy = horizon + 24;
  MM6.lightPool(g, fx, fy, 34, tint, 0.55);
  poly(g, [fx, fy - 22, fx + 13, fy, fx, fy + 22, fx - 13, fy], tint);
  // The shard's inner facet: a lighter mix of the same tint rather than a
  // half-transparent white, which would blend to an off-palette colour.
  poly(g, [fx, fy - 18, fx + 6, fy - 2, fx, fy + 6, fx - 6, fy - 2],
    MM6.pc(MM6.mix(MM6.hexRGB(tint), [255, 255, 255], 0.55)));

  // Runic ring inlaid in the floor under the focus. Scanline-filled so the band
  // is a hard 1-bit edge; a stroked ellipse would be antialiased, and nothing
  // in MM6 has a soft edge.
  const ry0 = horizon + 62;
  ringE(g, cxr, ry0, 128, 32, 3, tint);
  ringE(g, cxr, ry0, 100, 24, 2, tint);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = tint;
    g.fillRect((cxr + Math.cos(a) * 114) | 0, (ry0 + Math.sin(a) * 28) | 0, 3, 3);
  }

  // A robed guildmaster off to one side.
  figure(g, w * 0.78, horizon + 48, 96, 'rgba(20,18,26,0.9)', tint.replace(')', ')'), { hat: true });

  paintClutter(g, w * 0.90, h - 26, 'crate', 22);
  vignette(g, w, h);
}

export class GuildScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.school = opts.school || 'fire';
    this.id = `guild:${this.school}`;
    this.title = opts.title || GUILD_NAME[this.school] || 'Guild';
    this.fee = opts.fee === undefined ? 1000 : opts.fee;
    this.tier = opts.tier || 2;
    this.keeper = opts.keeper || {
      name: 'Guildmaster', title: `${this.school} magic`, portraitSeed: 96, sex: 'f', klass: 'sorcerer',
    };
    this.scroll = 0;
  }

  get membershipId() { return `guild_${this.school}`; }

  isMember() {
    const p = this.session.party;
    return !!(p && p.memberships && p.memberships[this.membershipId]);
  }

  join() {
    const p = this.session.party;
    if (!p) return;
    if (this.isMember()) { this.say('You are already a member here.'); return; }
    // Some schools will only take a class that can actually learn them.
    const eligible = members(this.session).some((c) => {
      try { return classSkillMax(c.class || c.klass, this.school) > 0; } catch { return true; }
    });
    if (!eligible) { this.say(`Nobody in your party could ever learn ${this.school} magic. Membership is refused.`); return; }
    if (!spend(this.session, this.fee)) { this.say(`Membership costs ${gold(this.fee)} gold.`); return; }
    if (!p.memberships) p.memberships = {};
    p.memberships[this.membershipId] = true;
    this.say(`Welcome to the ${this.title}. The library is open to you.`);
  }

  // --- spells --------------------------------------------------------------

  spells() { return SPELLS_BY_SCHOOL[this.school] || []; }

  knows(ch, id) {
    if (!ch) return false;
    if (Array.isArray(ch.spells)) return ch.spells.indexOf(id) >= 0;
    if (ch.spells && typeof ch.spells === 'object') return !!ch.spells[id];
    return false;
  }

  learn(ch, spell) {
    if (!ch.spells) ch.spells = [];
    if (Array.isArray(ch.spells)) ch.spells.push(spell.id);
    else ch.spells[spell.id] = true;
  }

  skillOf(ch) {
    try { return schoolSkill(ch, this.school); } catch {
      const s = ch && ch.skills && ch.skills[this.school];
      return { level: s ? s.level | 0 : 0, mastery: s ? s.mastery | 0 : 0 };
    }
  }

  /** Why this character may not buy this spell, or null when they may. */
  blockedReason(ch, spell) {
    if (!ch) return 'no character';
    if (!this.isMember()) return 'join first';
    const klass = ch.class || ch.klass;
    let max = 3;
    try { max = classSkillMax(klass, this.school); } catch { max = 3; }
    if (!max) return `a ${klass} cannot`;
    const { mastery } = this.skillOf(ch);
    if (!mastery) return 'no skill';
    const cap = SCHOOL_TIER_LIMIT[mastery] || 0;
    if (spell.tier > cap) return spell.tier <= 7 ? 'needs Expert' : 'needs Master';
    return null;
  }

  buy(spell) {
    const ch = this.character || activeMember(this.session);
    if (!ch) return;
    if (this.knows(ch, spell.id)) { this.say(`${charName(ch)} already knows ${spell.name}.`); return; }
    const why = this.blockedReason(ch, spell);
    if (why) { this.say(`${charName(ch)} cannot learn ${spell.name} - ${why}.`); return; }
    const price = spellPrice(spell);
    if (!spend(this.session, price)) { this.say(`${spell.name} costs ${gold(price)} gold.`); return; }
    this.learn(ch, spell);
    this.say(`${charName(ch)} copies ${spell.name} into their book.`);
    this.sound('page');
  }

  // --- skill teaching ------------------------------------------------------

  teach(rank) {
    const ch = this.character || activeMember(this.session);
    if (!ch) return;
    if (!this.isMember()) { this.say('Members only.'); return; }
    const klass = ch.class || ch.klass;
    let max = 3;
    try { max = classSkillMax(klass, this.school); } catch { max = 3; }
    if (max < rank) {
      this.say(`A ${CLASSES[klass] ? CLASSES[klass].name : klass} can never reach `
        + `${MASTERY_NAMES[rank]} in ${this.school} magic.`);
      return;
    }
    if (!ch.skills) ch.skills = {};
    const cur = ch.skills[this.school] || { level: 0, mastery: 0 };
    if ((cur.mastery | 0) >= rank) { this.say(`${charName(ch)} is already ${MASTERY_NAMES[cur.mastery]}.`); return; }
    if (rank > 1 && (cur.level | 0) < masteryRequirement(rank)) {
      this.say(`${charName(ch)} needs ${this.school} magic at level ${masteryRequirement(rank)} first.`);
      return;
    }
    const price = Math.round(masteryCost(rank) * (rank === 1 ? this.tier : 1));
    if (!spend(this.session, price)) { this.say(`That instruction costs ${gold(price)} gold.`); return; }
    ch.skills[this.school] = { level: Math.max(1, cur.level | 0), mastery: rank };
    this.say(`${charName(ch)} is now ${MASTERY_NAMES[rank]} in ${this.school} magic.`);
  }

  // --- panel ---------------------------------------------------------------

  options() {
    const ch = this.character || activeMember(this.session);
    const { level, mastery } = this.skillOf(ch);
    const member = this.isMember();
    return [
      { id: 'join', label: member ? 'Member' : 'Join', note: member ? 'in good standing' : `${gold(this.fee)} gold`,
        enabled: !member },
      { id: 'skill', label: 'Learn Skill', note: mastery ? `${MASTERY_NAMES[mastery]} ${level}` : `${gold(50 * this.tier)} gold`,
        enabled: member && !mastery },
      { id: 'expert', label: 'Expert Training', note: `${gold(masteryCost(2))} gold`,
        enabled: member && mastery === 1 },
      { id: 'master', label: 'Master Training', note: `${gold(masteryCost(3))} gold`,
        enabled: member && mastery === 2 },
    ];
  }

  onOption(id) {
    switch (id) {
      case 'join': this.join(); return;
      case 'skill': this.teach(1); return;
      case 'expert': this.teach(2); return;
      case 'master': this.teach(3); return;
      default:
    }
  }

  panelInfo() {
    const ch = this.character || activeMember(this.session);
    const { level, mastery } = this.skillOf(ch);
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: charName(ch), color: C_WHITE },
      { text: mastery ? `${MASTERY_NAMES[mastery]} ${level}` : 'unskilled', color: mastery ? C_GREEN : C_DIM },
    ];
  }

  backdrop() {
    return baked(`guild:${this.school}`, PANEL.w, PANEL.h, (g, w, h) => paintGuildInterior(g, w, h, this.school));
  }

  /**
   * MM6 sells spells the way it sells swords: the eleven tomes stand on the
   * guild's shelves as painted objects. There is no table, no column headers
   * and no price printed under each one - the name, cost and reason you cannot
   * have it appear on the status line, and only for the book under the pointer.
   */
  drawContent(ctx) {
    const ch = this.character || activeMember(this.session);
    const list = this.spells();
    const { mastery } = this.skillOf(ch);
    const cap = SCHOOL_TIER_LIMIT[mastery] || 0;
    const tint = SCHOOL_TINT[this.school] || '#c078e8';

    const cols = 6, cw = 58, chh = 74;
    const gx = PANEL.x + Math.round((PANEL.w - cols * cw) / 2) + 4;
    const gy = PANEL.y + 26;
    const rows = Math.ceil(list.length / cols);

    // A shelf plank under each row for the books to stand on.
    for (let r = 0; r < rows; r++) {
      const sy = gy + r * chh + chh - 20;
      MM6.rct(ctx, gx - 8, sy, cols * cw + 12, 5, [96, 68, 38]);
      MM6.rct(ctx, gx - 8, sy, cols * cw + 12, 1, [156, 120, 74]);
      MM6.rct(ctx, gx - 8, sy + 5, cols * cw + 12, 2, [44, 30, 16]);
      MM6.stipple(ctx, gx - 8, sy + 7, cols * cw + 12, 5, [0, 0, 0], 0.26);
    }

    let hover = null;
    list.forEach((sp, i) => {
      const shelfY = gy + Math.floor(i / cols) * chh + chh - 20;
      const cx = gx + (i % cols) * cw + cw / 2;
      const size = 46;
      const cy = shelfY - size / 2 - 2;
      const known = this.knows(ch, sp.id);
      const why = this.blockedReason(ch, sp);

      const hit = this.ui.region(`${this.id}:sp${i}`, cx - 24, cy - size / 2 - 2, 48, size + 6,
        sp.text || sp.name);
      if (hit.hover) {
        MM6.stipple(ctx, cx - 24, cy - size / 2 - 2, 48, size + 6, [255, 232, 150], 0.30);
        hover = { sp, known, why };
      }
      if (hit.click) this.buy(sp);

      // The tome itself. Cover in the school's colour, darkened by tier so the
      // shelf reads as three bands - the four Normal spells bright at the
      // front, the Master ones almost black - and the sigil gilded into it.
      const open = sp.tier <= cap && !why;
      const cover = MM6.shade(MM6.hexRGB(tint), 1 - Math.min(0.62, (sp.tier - 1) * 0.062));
      MM6.drawItemArt(ctx, 'tome', cx, cy, size, { accent: cover });
      const s = 20;
      const sx = Math.round(cx - s / 2) + 1, sy2 = Math.round(cy - s / 2);
      // Gilt for a spell this character could actually copy out, dead pewter
      // for one their mastery does not reach.
      MM6.spellSigilStamp(ctx, this.school, sp.tier, sx, sy2, s,
        open ? [206, 168, 62] : [104, 100, 92]);

      // A spell already copied out has a ribbon marker hanging from the tome.
      if (known) {
        const bw = Math.round(size * 0.76);
        MM6.rct(ctx, cx + bw / 2 - 12, cy + size / 2 - 4, 3, 10, [140, 26, 22]);
        MM6.rct(ctx, cx + bw / 2 - 12, cy + size / 2 - 4, 1, 10, [206, 78, 62]);
      }
    });

    // Status line: name on the left, cost or refusal on the right.
    const sy = PANEL.y + PANEL.h - 24;
    MM6.stipple(ctx, PANEL.x + 8, sy - 2, PANEL.w - 16, 18, [0, 0, 0], 0.62);
    if (hover) {
      const price = spellPrice(hover.sp);
      const right = hover.known ? 'already in the book'
        : hover.why ? hover.why
          : `${gold(price)} gold`;
      const col = hover.known ? C_GREEN
        : hover.why ? C_RED
          : price <= partyGold(this.session) ? C_CANARY : C_RED;
      F.drawText(ctx, `${hover.sp.name}  (${hover.sp.sp} SP)`, PANEL.x + 16, sy + 2,
        { color: C_WHITE, maxWidth: PANEL.w - 190 });
      F.drawText(ctx, right, PANEL.x + PANEL.w - 16, sy + 2, { align: 'right', color: col });
    } else {
      F.drawText(ctx, this.title, PANEL.x + 16, sy + 2, { color: tint });
      F.drawText(ctx, this.isMember() ? 'Member' : 'Not a member',
        PANEL.x + PANEL.w - 16, sy + 2,
        { align: 'right', color: this.isMember() ? C_GREEN : C_RED });
    }
    this.status = '';
  }
}

export default GuildScreen;
