// ---------------------------------------------------------------------------
// The magic guilds - one per school.
//
// A guild sells the eleven spells of its school and nothing else. You must join
// first (a fee, and some guilds will not take just anybody), and a spell is
// only sold to a character whose rank in the school can actually cast it:
// Normal reaches spell 4, Expert spell 7, Master all eleven.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { SPELLS_BY_SCHOOL, SCHOOLS, spellPrice, schoolSkill } from '../../game/spells.js';
import { SCHOOL_TIER_LIMIT, classSkillMax, MASTERY_NAMES, masteryCost, masteryRequirement } from '../../game/skills.js';
import { CLASSES } from '../../game/stats.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, hotText,
  paintWall, paintFloor, paintShelf, paintClutter, vignette,
  members, activeMember, charName, partyGold, spend,
  C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_GREEN, C_LEARN,
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

  // Lectern with an open tome, lit from the focus above it.
  const lx = w / 2, ly = horizon + 34;
  g.fillStyle = rampCss('wood', 4);
  g.fillRect(lx - 5, ly - 44, 10, 44);
  g.fillRect(lx - 22, ly, 44, 5);
  poly(g, [lx - 34, ly - 44, lx + 34, ly - 44, lx + 30, ly - 56, lx - 30, ly - 56], rampCss('wood', 6));
  g.fillStyle = rampCss('sand', 12);
  poly(g, [lx - 30, ly - 46, lx - 2, ly - 52, lx - 2, ly - 44, lx - 28, ly - 40], rampCss('sand', 12));
  poly(g, [lx + 30, ly - 46, lx + 2, ly - 52, lx + 2, ly - 44, lx + 28, ly - 40], rampCss('sand', 11));

  // The focus: a slowly turning shard of the school's element.
  const fx = lx, fy = horizon - 66;
  glow(g, fx, fy, 110, tint, 0.9);
  g.fillStyle = tint;
  poly(g, [fx, fy - 22, fx + 13, fy, fx, fy + 22, fx - 13, fy], tint);
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.5;
  poly(g, [fx, fy - 18, fx + 6, fy - 2, fx, fy + 6, fx - 6, fy - 2], '#ffffff');
  g.globalAlpha = 1;

  // Runic ring on the floor under the focus.
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = tint; g.lineWidth = 2;
  g.beginPath(); g.ellipse(lx, horizon + 58, 128, 32, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(lx, horizon + 58, 100, 24, 0, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = tint;
    g.fillRect((lx + Math.cos(a) * 114) | 0, (horizon + 58 + Math.sin(a) * 28) | 0, 3, 3);
  }
  g.restore();

  // A robed guildmaster off to one side.
  figure(g, w * 0.78, horizon + 48, 96, 'rgba(20,18,26,0.9)', tint.replace(')', ')'), { hat: true });

  paintClutter(g, w * 0.2, h - 8, 'crate', 22);
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

  drawContent(ctx) {
    const ch = this.character || activeMember(this.session);
    const list = this.spells();
    const x = PANEL.x + 12, y = PANEL.y + 12, w = PANEL.w - 24;
    const h = 34 + list.length * 20;
    plate(ctx, x, y, w, h, 0.72);

    const tint = SCHOOL_TINT[this.school] || C_WHITE;
    F.drawText(ctx, `${this.title} - spells for sale`, x + 10, y + 5, { color: tint });
    F.drawText(ctx, this.isMember() ? 'Member' : 'Not a member', x + w - 10, y + 6,
      { face: 'small', align: 'right', color: this.isMember() ? C_GREEN : C_RED });
    A.rule(ctx, x + 8, y + 20, w - 16, '#7a6a4a');
    F.drawText(ctx, 'Spell', x + 34, y + 24, { face: 'small', color: C_DIM });
    F.drawText(ctx, 'SP', x + 250, y + 24, { face: 'small', color: C_DIM });
    F.drawText(ctx, 'Price', x + 330, y + 24, { face: 'small', align: 'right', color: C_DIM });
    F.drawText(ctx, 'Status', x + w - 12, y + 24, { face: 'small', align: 'right', color: C_DIM });

    const { mastery } = this.skillOf(ch);
    const cap = SCHOOL_TIER_LIMIT[mastery] || 0;

    list.forEach((sp, i) => {
      const ry = y + 34 + i * 20;
      const known = this.knows(ch, sp.id);
      const why = this.blockedReason(ch, sp);
      const price = spellPrice(sp);
      const can = !known && !why && price <= partyGold(this.session);
      const hit = this.ui.region(`${this.id}:sp${i}`, x + 8, ry - 2, w - 16, 18, sp.text || sp.name);
      if (hit.hover && !known && !why) {
        ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#e1cd23';
        ctx.fillRect(x + 8, ry - 2, w - 16, 18); ctx.restore();
      }
      if (hit.click) this.buy(sp);

      // Tier gem: lit up to the character's mastery cap.
      A.gem(ctx, x + 14, ry + 2, 8, sp.tier <= cap ? this.school === 'fire' ? 'fire' : 'arcane' : 'grey');
      F.drawText(ctx, `${sp.tier}.`, x + 26, ry + 1, { face: 'small', color: C_DIM });
      F.drawText(ctx, sp.name, x + 40, ry, {
        color: known ? C_DIM : why ? C_RED : hit.hover ? C_GOLD : C_LEARN,
        maxWidth: 200,
      });
      F.drawText(ctx, String(sp.sp), x + 254, ry + 1, { face: 'small', color: C_WHITE });
      F.drawText(ctx, `${gold(price)}g`, x + 330, ry + 1,
        { face: 'small', align: 'right', color: can ? C_CANARY : C_DIM });
      F.drawText(ctx, known ? 'in book' : (why || 'available'), x + w - 12, ry + 1,
        { face: 'small', align: 'right', color: known ? C_GREEN : why ? C_RED : C_LEARN });
    });
  }
}

export default GuildScreen;
