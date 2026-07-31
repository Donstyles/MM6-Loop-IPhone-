// ---------------------------------------------------------------------------
// The character sheet.
//
// MM6's sheet is one tooled-parchment page at (8, 8) with four chapter tabs on
// the bottom baseline - Stats, Skills, Inventory, Awards - and the paperdoll
// living in the right-hand column on every tab. Values print white at base,
// green when a buff or item pushed them above it, scarlet when drained.
// Hovering anything explains it on the help line above the tabs, which is the
// only tutorial MM6 ever gives you.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, TAB_X, TAB_Y, TAB_W, TAB_H, px, py,
  WHITE, CANARY, HILITE, DIM, GREEN, SCARLET, RED, BOLT, PASTELS,
  leaderRow, drawTabs, drawWrapped,
} from './screenbase.js';
import {
  STATS, CLASSES, RESISTANCES, maxHP, maxSP, armorClass, attackBonus,
  damageBonus, effectiveStat, resistance, worstCondition, ageBand,
  xpForLevel, CONDITIONS,
} from '../../game/stats.js';
import {
  SKILLS, SKILL_CATEGORIES, MASTERY_NAMES, skillPointCost,
  skillDescription, classSkillMax,
} from '../../game/skills.js';
import { spellById } from '../../game/spells.js';
import { InventoryScreen, drawPaperdoll } from './inventory.js';

const TABS = ['Stats', 'Skills', 'Inventory', 'Awards'];

/** Condition colour by severity: MM6 goes white -> amber -> scarlet -> red. */
function conditionColor(condId) {
  const c = CONDITIONS[condId];
  if (!c || c.severity === 0) return GREEN;
  if (c.severity >= 14) return RED;
  if (c.severity >= 8) return SCARLET;
  return CANARY;
}

function fmtNum(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function signed(n) { return (n >= 0 ? '+' : '') + Math.round(n); }

export class CharSheetScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'charsheet';
    this.tab = (opts && opts.tab) || 0;
    this.awardScroll = 0;
  }

  onOpen() { this.sound('page'); }

  openInventory() {
    this.sound('page');
    this.push(new InventoryScreen(this.session, this.ui, this.hud,
      Object.assign({}, this.opts, { sheet: this })));
  }

  // The paperdoll is live on every tab, but managing what is on it belongs to
  // the inventory page, so a click there opens it.
  slotClick() { this.openInventory(); }
  showPopup() { this.openInventory(); }

  handleKey(code) {
    if (code === 'KeyC' || code === 'Escape') { this.close(); return true; }
    if (code === 'Tab') { this.tab = this.tab === 0 ? 1 : this.tab === 1 ? 3 : 0; return true; }
    if (/^Digit[1-4]$/.test(code)) {
      const i = +code.slice(5) - 1;
      if (this.members[i]) { this.session.activeChar = i; return true; }
    }
    return false;
  }

  draw(ctx) {
    const p = this.drawPage(ctx, 'sheet');
    const ch = this.character;

    if (ch) {
      const klass = CLASSES[ch.class] || CLASSES[ch.klass] || null;
      F.drawText(ctx, `${ch.name || 'Unnamed'} the ${klass ? klass.name : ''}`.trim(),
        px(26), py(12), { face: 'title', color: CANARY });
      const sp = ch.skillPoints | 0;
      F.drawText(ctx, `Skill Points: ${sp}`, px(435), py(16), {
        align: 'right', color: sp > 0 ? BOLT : WHITE,
      });
      A.rule(ctx, px(20), py(34), PANEL.w - 40, '#c8b48c', 0.35);

      if (this.tab === 0) this.drawStats(ctx, ch);
      else if (this.tab === 1) this.drawSkills(ctx, ch);
      else this.drawAwards(ctx, ch);

      // The paperdoll sits in the right column on every tab, as MM6 does.
      drawPaperdoll(ctx, this, ch);
    } else {
      F.drawText(ctx, 'No character selected.', px(PANEL.w / 2), py(160),
        { align: 'center', color: WHITE });
    }

    this.drawHelpLine(ctx, 302);
    const clicked = drawTabs(ctx, this.ui, this.id, TAB_X, TAB_Y, TAB_W, TAB_H, TABS,
      this.tab === 3 ? 3 : this.tab);
    if (clicked >= 0) {
      if (clicked === 2) this.openInventory();
      else if (clicked !== this.tab) { this.tab = clicked; this.sound('page'); }
    }
    this.drawExit(ctx);
    this.pollPartyBar();
  }

  // --- stats tab ------------------------------------------------------------

  drawStats(ctx, ch) {
    const LX = 20, LW = 190, RX = 232, RW = 203;
    let y = 44;

    for (const st of STATS) {
      const base = (ch.stats && ch.stats[st.id]) | 0;
      const cur = effectiveStat(ch, st.id);
      const col = cur > base ? GREEN : cur < base ? SCARLET : WHITE;
      const hit = this.ui.region(`${this.id}:st:${st.id}`, px(LX), py(y - 2), LW, 13,
        `${st.name}: ${st.desc}`);
      leaderRow(ctx, st.name, `${cur} (${base})`, px(LX), py(y), LW, {
        color: hit.hover ? HILITE : WHITE, valueColor: col,
      });
      y += 14;
    }

    y += 6;
    A.rule(ctx, px(LX), py(y - 4), LW, '#c8b48c', 0.3);
    const hp = maxHP(ch), sp = maxSP(ch);
    const cond = worstCondition(ch);
    const qs = typeof ch.quickSpell === 'string' ? spellById(ch.quickSpell) : ch.quickSpell;
    const left = [
      ['Hit Points', `${ch.hp | 0} / ${hp}`, (ch.hp | 0) <= hp * 0.25 ? RED : (ch.hp | 0) < hp ? SCARLET : WHITE,
        'Hit points. At zero the character falls unconscious.'],
      ['Spell Points', `${ch.sp | 0} / ${sp}`, WHITE, 'Spell points, spent to cast spells.'],
      ['Armour Class', String(armorClass(ch)), WHITE, 'How hard the character is to hit.'],
      ['Condition', cond.name, conditionColor(cond.id), cond.desc || ''],
      ['Quick Spell', qs ? qs.name : 'None', qs ? BOLT : DIM,
        'The spell cast by the quick-spell button. Set it in the spellbook.'],
    ];
    for (const r of left) {
      const hit = this.ui.region(`${this.id}:lf:${r[0]}`, px(LX), py(y - 2), LW, 13, r[3]);
      leaderRow(ctx, r[0], r[1], px(LX), py(y), LW, { color: hit.hover ? HILITE : WHITE, valueColor: r[2] });
      y += 14;
    }

    // --- right column
    let ry = 44;
    const band = ageBand(ch.age || 18);
    const xp = ch.xp !== undefined ? ch.xp : (ch.experience || 0);
    const right = [
      ['Age', `${ch.age || 18} (${band.name})`, WHITE, `Age band ${band.name}. The old lose Might and Speed but gain wit.`],
      ['Level', String(ch.level | 0), WHITE, 'Character level. Train in a town to raise it.'],
      ['Experience', fmtNum(xp), WHITE,
        `${fmtNum(Math.max(0, xpForLevel((ch.level | 0) + 1) - xp))} experience to the next level.`],
      null,
      ['Attack', signed(attackBonus(ch, ch.weaponSkill || null, false)), WHITE, 'Bonus to hit in melee.'],
      ['Damage', signed(damageBonus(ch, ch.weaponSkill || null, false)), WHITE, 'Bonus damage on every melee blow.'],
      ['Shoot', signed(attackBonus(ch, 'bow', true)), WHITE, 'Bonus to hit with a bow.'],
      ['Shoot Damage', signed(damageBonus(ch, 'bow', true)), WHITE, 'Bonus damage with a bow. Might never helps here.'],
    ];
    for (const r of right) {
      if (!r) { A.rule(ctx, px(RX), py(ry + 3), RW, '#c8b48c', 0.3); ry += 10; continue; }
      const hit = this.ui.region(`${this.id}:dv:${r[0]}`, px(RX), py(ry - 2), RW, 13, r[3]);
      leaderRow(ctx, r[0], r[1], px(RX), py(ry), RW, { color: hit.hover ? HILITE : WHITE, valueColor: r[2] });
      ry += 14;
    }

    ry += 6;
    F.drawText(ctx, 'Resistances', px(RX), py(ry), { color: CANARY });
    A.rule(ctx, px(RX), py(ry + 12), RW, '#c8b48c', 0.3);
    ry += 17;
    for (const res of RESISTANCES) {
      const v = resistance(ch, res.id);
      const hit = this.ui.region(`${this.id}:rs:${res.id}`, px(RX), py(ry - 2), RW, 13,
        `${res.name}${res.alias ? ' (' + res.alias + ')' : ''} resistance: every point makes halving the damage likelier.`);
      leaderRow(ctx, res.name, String(v), px(RX), py(ry), RW, {
        color: hit.hover ? HILITE : WHITE, valueColor: v > 0 ? GREEN : WHITE,
      });
      ry += 14;
    }
  }

  // --- skills tab -----------------------------------------------------------

  learnedSkills(ch) {
    const out = { weapon: [], armor: [], magic: [], misc: [] };
    const owned = ch.skills || {};
    for (const s of SKILLS) {
      const rec = owned[s.id];
      if (!rec || !(rec.level > 0 || rec.mastery > 0)) continue;
      out[s.category].push({ def: s, level: rec.level | 0, mastery: rec.mastery | 0 });
    }
    return out;
  }

  spend(ch, skillId) {
    const party = this.session.party;
    if (party && typeof party.spendSkillPoint === 'function') {
      party.spendSkillPoint(this.charIndex, skillId);
      return;
    }
    // Fallback while party.js is still being written: MM6's own rule, N -> N+1
    // costs N+1 points.
    const rec = ch.skills && ch.skills[skillId];
    if (!rec) return;
    const cost = skillPointCost(rec.level | 0);
    if ((ch.skillPoints | 0) < cost) return;
    ch.skillPoints -= cost;
    rec.level = (rec.level | 0) + 1;
  }

  drawSkills(ctx, ch) {
    const groups = this.learnedSkills(ch);
    const cols = [
      { x: 20, w: 190, cats: ['weapon', 'armor'] },
      { x: 232, w: 203, cats: ['magic', 'misc'] },
    ];
    const points = ch.skillPoints | 0;

    for (const col of cols) {
      let y = 44;
      for (const cat of col.cats) {
        F.drawText(ctx, SKILL_CATEGORIES[cat], px(col.x), py(y), { color: CANARY });
        A.rule(ctx, px(col.x), py(y + 12), col.w, '#c8b48c', 0.3);
        y += 17;
        const list = groups[cat];
        if (!list.length) {
          F.drawText(ctx, 'None', px(col.x + 6), py(y), { face: 'small', color: DIM });
          y += 15;
          continue;
        }
        for (const s of list) {
          const cost = skillPointCost(s.level);
          const cap = classSkillMax(ch.class, s.def.id);
          const affordable = points >= cost;
          const hit = this.ui.region(`${this.id}:sk:${s.def.id}`, px(col.x), py(y - 2), col.w, 13,
            `${skillDescription(s.def.id, s.level, s.mastery)}  [${cost} points to raise]`);
          if (hit.click && affordable) { this.spend(ch, s.def.id); this.sound('click'); }
          // MM6 paints a raisable skill bolt blue and everything else red.
          const c = hit.hover ? HILITE : affordable ? BOLT : RED;
          F.drawText(ctx, s.def.name, px(col.x), py(y), { face: 'small', color: c });
          F.drawText(ctx, `(${s.level})`, px(col.x + col.w - 52), py(y), {
            face: 'small', color: c, align: 'right',
          });
          // A capped skill prints its rank in canary: this is as far as the
          // class can ever take it.
          const capped = cap && s.mastery >= cap;
          F.drawText(ctx, MASTERY_NAMES[s.mastery] || '-', px(col.x + col.w), py(y), {
            face: 'small', align: 'right',
            color: capped ? CANARY : s.mastery >= 2 ? BOLT : c,
          });
          y += 13;
        }
        y += 6;
      }
    }

    this.status = points > 0
      ? `Click a skill to spend skill points. You have ${points}.`
      : 'No skill points left. Gain a level or train to earn more.';
  }

  // --- awards tab -----------------------------------------------------------

  awardList(ch) {
    const out = [];
    const push = (t, kind) => {
      if (!t) return;
      out.push({ text: typeof t === 'string' ? t : (t.text || t.name || ''), kind });
    };
    for (const t of (ch.titles || [])) push(t, 'title');
    for (const a of (ch.awards || [])) push(a, 'award');
    for (const a of (this.party.awards || [])) push(a, 'party');
    if (!out.length) out.push({ text: 'No awards yet. Deeds earn them.', kind: 'none' });
    return out;
  }

  drawAwards(ctx, ch) {
    const list = this.awardList(ch);
    const x = 20, w = 396, top = 44, rowH = 20;
    const visible = Math.floor((296 - top) / rowH);

    this.awardScroll = this.scrollbar(ctx, 'awardbar', px(x + w + 6), py(top),
      visible * rowH, this.awardScroll, list.length, visible);

    for (let i = 0; i < visible && i + this.awardScroll < list.length; i++) {
      const a = list[i + this.awardScroll];
      const y = top + i * rowH;
      const color = a.kind === 'none' ? DIM : PASTELS[(i + this.awardScroll) % PASTELS.length];
      drawWrapped(ctx, a.text, px(x + 4), py(y), w - 8, {
        face: 'small', color, maxLines: 2, lineHeight: 9,
      });
    }
    this.status = 'Awards are earned by deeds; titles by promotion.';
  }
}

export default CharSheetScreen;
