import { layout } from '../core/layout.js';
import * as UI from '../art/uiart.js';
import * as F from '../art/font.js';
import { getPortrait, PORTRAIT_W, PORTRAIT_H } from '../art/portraits.js';

// ---------------------------------------------------------------------------
// The permanent interface.
//
// Every coordinate here is the one the original engine used. MM6's chrome is a
// 640x480 frame with the world drawn into a 461x345 window at (8,8), a 172px
// carved column on the right holding the automap, the ribbon compass and the
// hirelings, and a 128px party bar along the bottom with four portraits, each
// flanked by a vertical health tube on its left and a spell tube on its right.
// ---------------------------------------------------------------------------

// Bottom bar, absolute coordinates in the 640x480 frame.
const PORTRAIT_X = [35, 150, 265, 380];
const PORTRAIT_Y = 388;
const SELECT_DX = -9, SELECT_DY = -8;       // active-character ring offset
const READY_DX = -4, READY_DY = -4;         // ready-to-act marker offset
const HP_X = [23, 138, 253, 368];
const SP_X = [102, 217, 332, 447];
const BAR_Y = 402, BAR_W = 5, BAR_H = 49;
const STATUS_Y = 357;
const BUTTON_Y = 450, BUTTON_W = 40, BUTTON_H = 35;
const BUTTON_X = [476, 518, 560, 602];
const BUFF_DX = 72, BUFF_Y = [393, 410, 427, 444];

// Right column.
const MAP_X = 488, MAP_Y = 16, MAP_W = 137, MAP_H = 117;
const ZOOM_IN_X = 519, ZOOM_OUT_X = 574, ZOOM_Y = 136;
const COMPASS_X = 541, COMPASS_W = 26, COMPASS_Y = 136;
const HIRE_X = [489, 559], HIRE_Y = 152;
const BUFF_ROW_Y = [247, 279];
const BUFF_ROW_X = [
  [477, 497, 522, 542, 564, 581, 614],
  [477, 497, 522, 542, 564, 589, 612],
];
const FOODGOLD_Y = 322;
const TAB_POS = [[491, 353], [527, 353], [546, 353], [570, 353], [600, 361]];

const PARTY_BUFFS = [
  'Feather Fall', 'Resist Fire', 'Resist Air', 'Resist Water', 'Resist Mind',
  'Resist Earth', 'Resist Body', 'Heroism', 'Haste', 'Shield', 'Stone Skin',
  'Protection from Magic', 'Immolation', 'Day of the Gods',
];
// Per-slot phase offsets so the buff icons shimmer out of sync, as they do in
// the original.
const BUFF_PHASE = [14, 1, 10, 4, 7, 2, 9, 3, 6, 15, 8, 3, 12, 0];

const CHAR_BUFFS = ['Bless', 'Preservation', 'Hammerhands', 'Pain Reflection'];

export class HUD {
  constructor(session, ui) {
    this.session = session;
    this.ui = ui;
    this.buttons = [];
    this.minimapZoom = 512;
    this.showTouch = false;
    this._chromeCache = null;
    this._chromeKey = '';
    this.t = 0;
  }

  /** X offset applied to right-column elements when the frame is widened. */
  get dx() { return layout.w - 640; }

  portraitRect(i) {
    return { x: PORTRAIT_X[i], y: PORTRAIT_Y, w: PORTRAIT_W, h: PORTRAIT_H };
  }

  get minimapRect() {
    return { x: MAP_X + this.dx, y: MAP_Y, w: MAP_W, h: MAP_H };
  }

  // --- chrome --------------------------------------------------------------

  chrome() {
    const key = `${layout.w}x${layout.h}`;
    if (this._chromeCache && this._chromeKey === key) return this._chromeCache;

    const c = document.createElement('canvas');
    c.width = layout.w; c.height = layout.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;

    const v = layout.view, s = layout.side, h = layout.hud;

    // Top and left border strips.
    UI.drawStonePanel(g, 0, 0, layout.w, v.y, { rivets: false });
    UI.drawStonePanel(g, 0, 0, v.x, h.y, { rivets: false });
    // Right column runs the full height behind the party bar.
    UI.drawStonePanel(g, s.x, 0, s.w, layout.h, { rivets: true, gold: true });
    // Party bar sits on top of it, full width.
    UI.drawStonePanel(g, 0, h.y, h.w, h.h, { rivets: true, gold: true });

    // The 3D window is a hole with a sunken rim.
    g.clearRect(v.x, v.y, v.w, v.h);
    UI.drawBevel(g, v.x - 3, v.y - 3, v.w + 6, v.h + 6, { sunken: true, size: 3 });

    // Automap aperture and the four portrait niches.
    const m = this.minimapRect;
    UI.drawInset(g, m.x - 4, m.y - 4, m.w + 8, m.h + 8);
    for (let i = 0; i < 4; i++) {
      // Arch-topped niches, with the health and spell tubes let into the stone
      // on either side of each portrait.
      const niche = UI.drawPortraitNiche || UI.drawInset;
      niche(g, PORTRAIT_X[i] - 6, PORTRAIT_Y - 8, PORTRAIT_W + 12, PORTRAIT_H + 14);
      const well = UI.drawTubeWell || UI.drawInset;
      well(g, HP_X[i] - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);
      well(g, SP_X[i] - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);
    }

    this._chromeCache = c;
    this._chromeKey = key;
    return c;
  }

  invalidate() { this._chromeCache = null; }

  // --- frame ---------------------------------------------------------------

  draw(ctx, dt) {
    this.t += dt || 0;
    this.buttons.length = 0;
    ctx.clearRect(0, 0, layout.w, layout.h);
    ctx.drawImage(this.chrome(), 0, 0);

    this.drawMinimap(ctx);
    this.drawCompass(ctx);
    this.drawHirelings(ctx);
    this.drawPartyBuffs(ctx);
    this.drawFoodGold(ctx);
    this.drawBookTabs(ctx);
    this.drawPartyBar(ctx);
    this.drawStatusLine(ctx);
    this.drawViewportOverlays(ctx);
    this.drawFloatText(ctx);
    if (this.showTouch) this.drawTouchControls(ctx);
  }

  // --- right column --------------------------------------------------------

  drawMinimap(ctx) {
    const S = this.session;
    const m = this.minimapRect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x, m.y, m.w, m.h);
    ctx.clip();

    // Indoors the automap is navy with blue wall lines; outdoors it samples the
    // region's painted map image.
    ctx.fillStyle = S.map && S.map.indoor ? '#000078' : '#1a1408';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    if (S.map && S.map.drawMinimap) S.map.drawMinimap(ctx, m, S.player, this.minimapZoom);

    // Actor dots, in the engine's colours.
    if (S.entities) {
      const scale = m.w / this.minimapZoom;
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      for (const e of S.entities.list) {
        if (!e.visible) continue;
        const dx = (e.pos.x - S.player.pos.x) * scale;
        const dz = (e.pos.z - S.player.pos.z) * scale;
        const px = Math.round(cx + dx), py = Math.round(cy + dz);
        if (px < m.x || px >= m.x + m.w || py < m.y || py >= m.y + m.h) continue;
        const col = e.category === 'monster' ? (e.dead ? '#FFFF00' : '#FF0000')
          : e.category === 'npc' ? '#00E100'
            : e.category === 'item' ? '#0000FF' : null;
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(px, py, 2, 2);
      }
    }

    // The party marker is always dead centre, rotated to face north-up.
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-S.player.yaw);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(0, 2); ctx.lineTo(-4, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();

    const zi = this.ui.region('map:zoomin', ZOOM_IN_X + this.dx, ZOOM_Y, 20, 18, 'Zoom in');
    const zo = this.ui.region('map:zoomout', ZOOM_OUT_X + this.dx, ZOOM_Y, 20, 18, 'Zoom out');
    UI.drawIcon(ctx, 'zoom_in', ZOOM_IN_X + this.dx, ZOOM_Y, 18);
    UI.drawIcon(ctx, 'zoom_out', ZOOM_OUT_X + this.dx, ZOOM_Y, 18);
    if (zi.click) this.minimapZoom = Math.max(256, this.minimapZoom / 2);
    if (zo.click) this.minimapZoom = Math.min(4096, this.minimapZoom * 2);

    const dt = this.ui.region('map:datetime', m.x, m.y, m.w, m.h, `${this.session.clock.format()}  ${this.session.clock.formatDate()}`);
    this.buttons.push({ id: 'datetime', hit: dt });
  }

  /**
   * MM6's compass is not a needle - it is a ~240px panoramic strip sliding
   * behind a 26px aperture, so the cardinal letters scroll past as you turn.
   */
  drawCompass(ctx) {
    const x = COMPASS_X + this.dx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, COMPASS_Y, COMPASS_W, 20);
    ctx.clip();
    ctx.fillStyle = '#14100a';
    ctx.fillRect(x, COMPASS_Y, COMPASS_W, 20);

    const yaw = this.session.player.yaw;
    const STRIP = 240;
    // One full turn scrolls the strip exactly once.
    let off = ((yaw / (Math.PI * 2)) * STRIP) % STRIP;
    const marks = [['N', 0], ['E', 60], ['S', 120], ['W', 180]];
    for (let rep = -1; rep <= 1; rep++) {
      for (const [label, pos] of marks) {
        const sx = Math.round(x + COMPASS_W / 2 + (pos - off) + rep * STRIP);
        if (sx < x - 8 || sx > x + COMPASS_W + 8) continue;
        F.drawText(ctx, label, sx, COMPASS_Y + 5, { face: 'small', align: 'center', color: F.TEXT_HILITE || '#E1CD23' });
      }
      for (let i = 0; i < 24; i++) {
        const sx = Math.round(x + COMPASS_W / 2 + (i * 10 - off) + rep * STRIP);
        if (sx < x || sx >= x + COMPASS_W) continue;
        ctx.fillStyle = i % 6 === 0 ? '#E1CD23' : '#7a6a44';
        ctx.fillRect(sx, COMPASS_Y + 15, 1, i % 6 === 0 ? 4 : 2);
      }
    }
    ctx.restore();
  }

  drawHirelings(ctx) {
    const hire = (this.session.party && this.session.party.hirelings) || [];
    for (let i = 0; i < 2; i++) {
      const x = HIRE_X[i] + this.dx;
      UI.drawInset(ctx, x - 3, HIRE_Y - 3, PORTRAIT_W + 6, PORTRAIT_H + 6);
      const npc = hire[i];
      if (!npc) continue;
      const p = getPortrait(npc.portraitSeed || i * 977, { sex: npc.sex || 'm', klass: npc.klass }, 'normal');
      ctx.drawImage(p, x, HIRE_Y);
      UI.drawPortraitFrame(ctx, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, 'normal');
      const hit = this.ui.region(`hire${i}`, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, `${npc.name} the ${npc.profession || 'Hireling'}`);
      this.buttons.push({ id: `hire${i}`, hit, npc });
    }
  }

  drawPartyBuffs(ctx) {
    const buffs = (this.session.party && this.session.party.buffs) || {};
    const now = this.session.clock.minutes;
    for (let row = 0; row < 2; row++) {
      const xs = BUFF_ROW_X[row];
      for (let i = 0; i < xs.length; i++) {
        const idx = row * 7 + i;
        const name = PARTY_BUFFS[idx];
        if (!name) continue;
        const b = buffs[name];
        if (!b || b.until <= now) continue;
        // The icons animate on a ~2.5s loop with a per-slot phase offset.
        const phase = ((this.t * 1000) / 20 + 20 * BUFF_PHASE[idx]) % 126;
        const pulse = 0.72 + 0.28 * Math.sin((phase / 126) * Math.PI * 2);
        ctx.save();
        ctx.globalAlpha = pulse;
        UI.drawIcon(ctx, b.icon || 'school_spirit', xs[i] + this.dx, BUFF_ROW_Y[row], 16);
        ctx.restore();
        this.ui.region(`buff${idx}`, xs[i] + this.dx, BUFF_ROW_Y[row], 16, 16, name);
      }
    }
  }

  drawFoodGold(ctx) {
    const P = this.session.party;
    const x = this.dx;
    F.drawText(ctx, fmtNum(P ? P.food : 0), 553 + x, FOODGOLD_Y, { face: 'small', align: 'right', color: '#FFFFFF' });
    F.drawText(ctx, fmtNum(P ? P.gold : 0), 632 + x, FOODGOLD_Y, { face: 'small', align: 'right', color: '#FFFFFF' });
    UI.drawIcon(ctx, 'food', 478 + x, FOODGOLD_Y - 2, 14);
    UI.drawIcon(ctx, 'gold', 557 + x, FOODGOLD_Y - 2, 14);
    this.ui.region('food', 476 + x, FOODGOLD_Y, 77, 17, 'Food');
    this.ui.region('gold', 555 + x, FOODGOLD_Y, 77, 17, 'Gold');
  }

  drawBookTabs(ctx) {
    const ids = ['quests', 'autonotes', 'maps', 'calendar', 'history'];
    const icons = ['quest', 'autonotes', 'map', 'options', 'history'];
    const flash = Math.floor(this.t) % 2 === 0;
    ids.forEach((id, i) => {
      const [bx, by] = TAB_POS[i];
      const x = bx + this.dx;
      const hit = this.ui.region(`tab:${id}`, x, by, 30, 26, id);
      const alert = this.session.newEntries && this.session.newEntries[id];
      ctx.save();
      if (alert && flash) ctx.globalAlpha = 0.55;
      UI.drawButton(ctx, x, by, 30, 26, null, hit.down ? 'down' : 'up');
      UI.drawIcon(ctx, icons[i], x + 6, by + 5, 16);
      ctx.restore();
      this.buttons.push({ id: `tab:${id}`, hit });
    });
  }

  // --- bottom bar ----------------------------------------------------------

  drawPartyBar(ctx) {
    const S = this.session;
    const members = (S.party && S.party.members) || [];

    for (let i = 0; i < 4; i++) {
      const ch = members[i];
      const px = PORTRAIT_X[i];
      if (!ch) continue;

      const p = getPortrait(ch.portraitSeed, { sex: ch.sex, klass: ch.klass }, this.expressionFor(ch));
      ctx.drawImage(p, px, PORTRAIT_Y);

      // Ready-to-act marker: a small pip above the portrait, green when the
      // character can act and red while they are still recovering.
      const ready = ch.recovery <= 0 && ch.hp > 0;
      if (!S.turnBased || S.turnQueue.includes(i)) {
        UI.drawIcon(ctx, ready ? 'init_green' : 'init_red',
          px + PORTRAIT_W / 2 - 5, PORTRAIT_Y + READY_DY - 6, 10);
      }

      if (i === S.activeChar) {
        UI.drawPortraitFrame(ctx, px + SELECT_DX, PORTRAIT_Y + SELECT_DY,
          PORTRAIT_W - 2 * SELECT_DX, PORTRAIT_H - 2 * SELECT_DY, 'active');
      }

      // Vertical tubes: health on the left of the portrait, spell on the right.
      const hpFrac = ch.maxHP > 0 ? ch.hp / ch.maxHP : 0;
      const spFrac = ch.maxSP > 0 ? ch.sp / ch.maxSP : 0;
      UI.drawStatBar(ctx, HP_X[i], BAR_Y, BAR_W, BAR_H, hpFrac, 'hp');
      UI.drawStatBar(ctx, SP_X[i], BAR_Y, BAR_W, BAR_H, spFrac, 'sp');

      // Per-character buff pips down the right of the portrait.
      const cb = ch.buffs || {};
      CHAR_BUFFS.forEach((name, k) => {
        if (!cb[name] || cb[name].until <= S.clock.minutes) return;
        UI.drawIcon(ctx, 'school_spirit', px + BUFF_DX, BUFF_Y[k], 12);
      });

      const hit = this.ui.region(`hud:char${i}`, px, PORTRAIT_Y, PORTRAIT_W, PORTRAIT_H,
        `${ch.name} the ${ch.klass}`);
      this.buttons.push({ id: `char${i}`, hit });
      this.ui.region(`hud:hp${i}`, HP_X[i], BAR_Y, BAR_W, BAR_H, `Hit Points: ${ch.hp} / ${ch.maxHP}`);
      this.ui.region(`hud:sp${i}`, SP_X[i], BAR_Y, BAR_W, BAR_H, `Spell Points: ${ch.sp} / ${ch.maxSP}`);
    }

    // The four stone buttons in the bottom right corner.
    const defs = [
      ['cast', 'castspell', 'Cast Spell'],
      ['rest', 'rest', 'Rest'],
      ['quickref', 'quickref', 'Quick Reference'],
      ['options', 'options', 'Game Options'],
    ];
    defs.forEach(([id, icon, tip], i) => {
      const x = BUTTON_X[i] + this.dx;
      const hit = this.ui.region(`hud:${id}`, x, BUTTON_Y, BUTTON_W, BUTTON_H, tip);
      UI.drawButton(ctx, x, BUTTON_Y, BUTTON_W, BUTTON_H, null, hit.down ? 'down' : 'up');
      const o = hit.down ? 1 : 0;
      UI.drawIcon(ctx, icon, x + 10 + o, BUTTON_Y + 8 + o, 20);
      this.buttons.push({ id, hit });
    });
  }

  expressionFor(ch) {
    if (ch.portraitOverride) return ch.portraitOverride;
    const conds = ch.conditions || [];
    if (conds.length) {
      const order = ['eradicated', 'stoned', 'dead', 'unconscious', 'paralyzed',
        'insane', 'poisoned', 'diseased', 'asleep', 'drunk', 'afraid', 'cursed', 'weak'];
      for (const c of order) {
        if (!conds.includes(c)) continue;
        if (c === 'afraid') return 'scared';
        if (c === 'cursed' || c === 'weak') return 'hurt';
        return c;
      }
    }
    if (ch.justLeveled) return 'level_up';
    if (ch.hp <= 0) return 'unconscious';
    if (ch.hp < ch.maxHP * 0.25) return 'hurt';
    if (ch.hp < ch.maxHP * 0.6) return 'angry';
    return 'normal';
  }

  // --- overlays ------------------------------------------------------------

  /** MM6 keeps one line of status text across the top of the party bar. */
  drawStatusLine(ctx) {
    const tip = this.ui.hoverText
      || (this.session.hoverEntity && this.session.hoverEntity.label)
      || (this.session.log.recent(1)[0] || {}).text
      || '';
    if (!tip) return;
    F.drawText(ctx, tip, 11 + 225, STATUS_Y, {
      align: 'center', color: F.TEXT_HUD || '#0A0000', shadow: F.TEXT_HUD_SHADOW || '#E6D6C1',
      maxWidth: 450,
    });
  }

  /** Things MM6 draws inside the 3D window itself. */
  drawViewportOverlays(ctx) {
    const S = this.session;
    const v = layout.view;

    // Recent messages stack up from the bottom of the window.
    const lines = S.log.recent(4);
    let y = v.y + v.h - 10 - lines.length * 12;
    for (const l of lines) {
      const fade = Math.max(0, Math.min(1, (l.ttl - l.t) / 1.2));
      ctx.save();
      ctx.globalAlpha = fade;
      F.drawText(ctx, l.text, v.x + 6, y, { color: l.color || '#FFFFFF' });
      ctx.restore();
      y += 12;
    }

    // Fly and Water Walk sit in the window's top corners while engaged.
    const buffs = (S.party && S.party.buffs) || {};
    if (buffs['Fly'] && buffs['Fly'].until > S.clock.minutes) UI.drawIcon(ctx, 'school_air', v.x, v.y, 20);
    if (buffs['Water Walk'] && buffs['Water Walk'].until > S.clock.minutes) {
      UI.drawIcon(ctx, 'school_water', v.x + v.w - 20, v.y, 20);
    }

    // Turn-based indicator in the window's bottom-right corner.
    if (S.turnBased) {
      const ap = Math.max(0, Math.min(5, Math.floor((S.turnPoints ?? 130) / 26)));
      UI.drawIcon(ctx, S.turnActor === 'monsters' ? 'turnhour' : `turn${5 - ap}`,
        v.x + v.w - 52, v.y + v.h - 60, 44);
    }

    // Monster health bar when hovering a monster, as MM6 shows on right-click.
    const he = S.hoverEntity;
    if (he && he.category === 'monster' && !he.dead && he.maxHp > 0) {
      const bw = 100, bx = v.x + (v.w - bw) / 2, by = v.y + 12;
      const frac = Math.max(0, he.hp / he.maxHp);
      UI.drawStatBar(ctx, bx, by, bw, 8, frac, 'hp');
      F.drawText(ctx, he.label || he.kind, v.x + v.w / 2, by + 10, {
        face: 'small', align: 'center', color: '#FFFFFF',
      });
    }
  }

  drawFloatText(ctx) {
    const vfx = this.session.vfx;
    if (!vfx || !vfx.screenTexts) return;
    for (const t of vfx.screenTexts(this.session.engine.camera, layout.view)) {
      const color = t.kind === 'heal' ? '#00E100'
        : t.kind === 'crit' ? '#FF3C1E'
          : t.kind === 'miss' ? '#7E7E7E'
            : t.kind === 'resist' ? '#00AFFF' : '#FFFF9B';
      ctx.save();
      ctx.globalAlpha = t.alpha;
      F.drawText(ctx, t.text, t.x, t.y, { face: 'small', align: 'center', color });
      ctx.restore();
    }
  }

  drawTouchControls(ctx) {
    const v = layout.view;
    const r = 46;
    const cx = v.x + r + 14, cy = v.y + v.h - r - 14;
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = '#E6D6C1';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#E6D6C1';
    ctx.beginPath();
    ctx.arc(cx + (this.stickDX || 0), cy + (this.stickDY || 0), 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function fmtNum(n) {
  n = n | 0;
  if (n >= 1000000) return `${(n / 1000000).toPrecision(4)}M`;
  return String(n);
}
