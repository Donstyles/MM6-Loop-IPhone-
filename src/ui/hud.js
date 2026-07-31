import { layout } from '../core/layout.js';
import * as UI from '../art/uiart.js';
import * as F from '../art/font.js';
import { getPortrait, PORTRAIT_W, PORTRAIT_H } from '../art/portraits.js';

// ---------------------------------------------------------------------------
// The permanent interface.
//
// MM6 wraps its small 3D window in carved stone: a right-hand column with the
// automap and buttons, and a party bar along the bottom holding four painted
// portraits with their health and spell wells. Everything here is drawn at
// logical 1:1 pixels so it stays pixel-exact when the frame is scaled up.
// ---------------------------------------------------------------------------

const PORTRAIT_PITCH = 101;
const PORTRAIT_X0 = 14;
const PORTRAIT_Y_OFF = 8;

export class HUD {
  constructor(session, ui) {
    this.session = session;
    this.ui = ui;
    this.buttons = [];
    this.floatText = [];
    this.minimapZoom = 1;
    this.showTouch = false;
    this._chromeCache = null;
    this._chromeKey = '';
  }

  /** Rect of character `i`'s portrait in the bottom bar. */
  portraitRect(i) {
    const h = layout.hud;
    return {
      x: PORTRAIT_X0 + i * PORTRAIT_PITCH,
      y: h.y + PORTRAIT_Y_OFF,
      w: PORTRAIT_W,
      h: PORTRAIT_H,
    };
  }

  /** The right-hand panel's automap rect. */
  get minimapRect() {
    const s = layout.side;
    return { x: s.x + 10, y: 10, w: s.w - 20, h: s.w - 20 };
  }

  // --- chrome --------------------------------------------------------------

  /**
   * The static carved frame is expensive to redraw and never changes except on
   * resize, so it is cached to an offscreen canvas and blitted each frame.
   */
  chrome() {
    const key = `${layout.w}x${layout.h}`;
    if (this._chromeCache && this._chromeKey === key) return this._chromeCache;

    const c = UI.stonePanel ? document.createElement('canvas') : null;
    c.width = layout.w; c.height = layout.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;

    const v = layout.view, s = layout.side, h = layout.hud;

    // Left/top border strip around the 3D window.
    UI.drawStonePanel(g, 0, 0, s.x, h.y, { rivets: false });
    // The 3D window is a hole - punch it out and rim it with a sunken bevel.
    g.clearRect(v.x, v.y, v.w, v.h);
    UI.drawBevel(g, v.x - 3, v.y - 3, v.w + 6, v.h + 6, { sunken: true, size: 3 });

    // Right column.
    UI.drawStonePanel(g, s.x, 0, s.w, h.y, { rivets: true, gold: true });
    // Bottom party bar.
    UI.drawStonePanel(g, 0, h.y, h.w, h.h, { rivets: true, gold: true });

    // Automap well.
    const m = this.minimapRect;
    UI.drawInset(g, m.x - 3, m.y - 3, m.w + 6, m.h + 6);

    this._chromeCache = c;
    this._chromeKey = key;
    return c;
  }

  invalidate() { this._chromeCache = null; }

  // --- frame ---------------------------------------------------------------

  draw(ctx, dt) {
    const S = this.session;
    ctx.clearRect(0, 0, layout.w, layout.h);
    ctx.drawImage(this.chrome(), 0, 0);

    this.drawMinimap(ctx);
    this.drawSidePanel(ctx);
    this.drawPartyBar(ctx);
    this.drawMessages(ctx);
    this.drawFloatText(ctx, dt);
    if (this.showTouch) this.drawTouchControls(ctx);
    this.drawStatusLine(ctx);
  }

  // --- right column --------------------------------------------------------

  drawMinimap(ctx) {
    const S = this.session;
    const m = this.minimapRect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x, m.y, m.w, m.h);
    ctx.clip();

    ctx.fillStyle = '#0d1014';
    ctx.fillRect(m.x, m.y, m.w, m.h);

    if (S.map && S.map.drawMinimap) {
      S.map.drawMinimap(ctx, m, S.player, this.minimapZoom);
    }

    // Party arrow, always centred and pointing up-screen.
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North indicator.
    F.drawText(ctx, 'N', m.x + m.w / 2, m.y + 2, { face: 'small', align: 'center', color: F.TEXT_GOLD });
  }

  drawSidePanel(ctx) {
    const S = this.session;
    const s = layout.side;
    const m = this.minimapRect;
    let y = m.y + m.h + 10;

    // Clock and date, the way MM6 keeps them permanently visible.
    F.drawText(ctx, S.clock.format(), s.x + s.w / 2, y, { align: 'center', color: F.TEXT_GOLD });
    y += 13;
    F.drawText(ctx, S.clock.formatDate(), s.x + s.w / 2, y, { face: 'small', align: 'center', color: F.TEXT_DIM });
    y += 14;

    UI.drawDivider(ctx, s.x + 10, y, s.w - 20);
    y += 6;

    // Active party buffs as a wrapping strip of school icons.
    const buffs = S.party && S.party.buffs ? Object.keys(S.party.buffs).filter((k) => S.party.buffs[k].until > S.clock.minutes) : [];
    let bx = s.x + 10;
    for (const b of buffs.slice(0, 14)) {
      UI.drawIcon(ctx, S.party.buffs[b].icon || 'school_spirit', bx, y, 16);
      bx += 18;
      if (bx > s.x + s.w - 24) { bx = s.x + 10; y += 18; }
    }
    y += 22;

    // Quick-cast slot for the active character's chosen spell.
    const ch = S.party && S.party.members ? S.party.members[S.activeChar] : null;
    if (ch && ch.quickSpell) {
      UI.drawInset(ctx, s.x + 10, y, s.w - 20, 22);
      F.drawText(ctx, ch.quickSpell.name, s.x + s.w / 2, y + 7, {
        face: 'small', align: 'center', color: F.TEXT_LINK,
      });
    }
  }

  // --- bottom bar ----------------------------------------------------------

  drawPartyBar(ctx) {
    const S = this.session;
    const h = layout.hud;
    const members = (S.party && S.party.members) || [];

    for (let i = 0; i < 4; i++) {
      const r = this.portraitRect(i);
      const ch = members[i];
      if (!ch) { UI.drawPortraitFrame(ctx, r.x, r.y, r.w, r.h, 'empty'); continue; }

      const expr = this.expressionFor(ch);
      const p = getPortrait(ch.portraitSeed, { sex: ch.sex, klass: ch.klass }, expr);
      ctx.drawImage(p, r.x, r.y);

      const state = i === S.activeChar ? 'active' : (ch.conditions && ch.conditions.includes('dead') ? 'dead' : 'normal');
      UI.drawPortraitFrame(ctx, r.x, r.y, r.w, r.h, state);

      // Health and spell wells sit side by side under the portrait.
      const bw = Math.floor((r.w - 3) / 2);
      const by = r.y + r.h + 3;
      UI.drawStatBar(ctx, r.x, by, bw, 6, ch.maxHP > 0 ? ch.hp / ch.maxHP : 0, 'hp');
      UI.drawStatBar(ctx, r.x + bw + 3, by, bw, 6, ch.maxSP > 0 ? ch.sp / ch.maxSP : 0, 'sp');

      F.drawText(ctx, ch.name, r.x + r.w / 2, by + 9, {
        face: 'small', align: 'center',
        color: ch.hp <= 0 ? F.TEXT_RED : F.TEXT_NORMAL,
      });

      // Recovery shade: MM6 dims a character who cannot act yet.
      if (ch.recovery > 0) {
        ctx.save();
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = '#101018';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    }

    // Right side of the bar: resources over a row of buttons.
    const bx = PORTRAIT_X0 + 4 * PORTRAIT_PITCH + 6;
    const availW = h.w - bx - 10;

    UI.drawIcon(ctx, 'gold', bx, h.y + 10, 14);
    F.drawText(ctx, String(S.party ? S.party.gold : 0), bx + 18, h.y + 12, { color: F.TEXT_GOLD });
    UI.drawIcon(ctx, 'food', bx, h.y + 28, 14);
    F.drawText(ctx, String(S.party ? S.party.food : 0), bx + 18, h.y + 30, { color: F.TEXT_NORMAL });

    this.buttons.length = 0;
    const defs = [
      ['cast', 'castspell', 'Cast Spell'],
      ['rest', 'rest', 'Rest'],
      ['quickref', 'quickref', 'Quick Reference'],
      ['options', 'options', 'Game Options'],
    ];
    const bw = Math.min(52, Math.floor((availW - 12) / 4));
    const byy = h.y + h.h - 44;
    defs.forEach(([id, icon, tip], i) => {
      const x = bx + i * (bw + 3);
      const hit = this.ui.region(`hud:${id}`, x, byy, bw, 36, tip);
      UI.drawButton(ctx, x, byy, bw, 36, null, hit.down ? 'down' : 'up');
      UI.drawIcon(ctx, icon, x + (bw - 20) / 2 + (hit.down ? 1 : 0), byy + 8 + (hit.down ? 1 : 0), 20);
      this.buttons.push({ id, hit });
    });

    // Turn-based toggle sits just above the buttons on the far right.
    const tb = this.ui.region('hud:turnbased', h.w - 30, h.y + 8, 24, 24,
      S.turnBased ? 'Leave turn-based mode' : 'Enter turn-based mode');
    UI.drawButton(ctx, h.w - 30, h.y + 8, 24, 24, null, S.turnBased ? 'down' : (tb.down ? 'down' : 'up'));
    UI.drawIcon(ctx, 'turnbased', h.w - 28, h.y + 10, 20);
    this.buttons.push({ id: 'turnbased', hit: tb });

    // Portrait click targets, for selecting the active character.
    for (let i = 0; i < Math.min(4, members.length); i++) {
      const r = this.portraitRect(i);
      const hit = this.ui.region(`hud:char${i}`, r.x, r.y, r.w, r.h + 16, members[i].name);
      this.buttons.push({ id: `char${i}`, hit });
    }
  }

  expressionFor(ch) {
    if (!ch.conditions || ch.conditions.length === 0) {
      if (ch.justLeveled) return 'level_up';
      if (ch.hp < ch.maxHP * 0.25) return 'hurt';
      return 'normal';
    }
    // Show the most severe condition, matching MM6's ordering.
    const order = ['eradicated', 'stoned', 'dead', 'unconscious', 'paralyzed',
      'insane', 'poisoned', 'diseased', 'asleep', 'drunk', 'afraid', 'cursed', 'weak'];
    for (const c of order) if (ch.conditions.includes(c)) {
      return c === 'afraid' ? 'scared' : (c === 'cursed' || c === 'weak' ? 'hurt' : c);
    }
    return 'normal';
  }

  // --- overlays ------------------------------------------------------------

  drawMessages(ctx) {
    const v = layout.view;
    const lines = this.session.log.recent(4);
    let y = v.y + v.h - 8 - lines.length * 12;
    for (const l of lines) {
      const fade = Math.max(0, Math.min(1, (l.ttl - l.t) / 1.2));
      ctx.save();
      ctx.globalAlpha = fade;
      F.drawText(ctx, l.text, v.x + 6, y, { color: l.color || F.TEXT_NORMAL });
      ctx.restore();
      y += 12;
    }
  }

  /** Floating combat text fed by the VFX system. */
  drawFloatText(ctx, dt) {
    if (!this.session.vfx || !this.session.vfx.screenTexts) return;
    const list = this.session.vfx.screenTexts(this.session.engine.camera, layout.view);
    for (const t of list) {
      const face = t.kind === 'crit' ? 'normal' : 'small';
      const color = t.kind === 'heal' ? '#5ce85c'
        : t.kind === 'crit' ? '#ff9020'
          : t.kind === 'miss' ? '#a0a0a0'
            : t.kind === 'resist' ? '#78b8ff' : '#ffe8a0';
      ctx.save();
      ctx.globalAlpha = t.alpha;
      F.drawText(ctx, t.text, t.x, t.y, { face, align: 'center', color });
      ctx.restore();
    }
  }

  drawStatusLine(ctx) {
    const tip = this.ui.hoverText || (this.session.hoverEntity && this.session.hoverEntity.label);
    if (!tip) return;
    const v = layout.view;
    F.drawText(ctx, tip, v.x + v.w / 2, v.y + v.h - 20, {
      align: 'center', color: F.TEXT_LINK,
    });
  }

  drawTouchControls(ctx) {
    const v = layout.view;
    const r = 46;
    const cx = v.x + r + 14, cy = v.y + v.h - r - 14;
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = '#e8dcb0';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(cx + (this.stickDX || 0), cy + (this.stickDY || 0), 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
