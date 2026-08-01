import { layout } from '../core/layout.js';
import * as UI from '../art/uiart.js';
import * as HC from '../art/hudchrome.js';
import * as F from '../art/font.js';
import { getPortrait, PORTRAIT_W, PORTRAIT_H } from '../art/portraits.js';
import { maxHP, maxSP } from '../game/stats.js';

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
const SELECT_DX = -4, SELECT_DY = -4;       // IB-selec ring inset round the bust
const READY_DY = -4;                        // IB-InitG marker offset
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
const TORCH_X = 468, WIZEYE_X = 606, INDICATOR_Y = 0;
const BUFF_ROW_Y = [247, 279];
const BUFF_ROW_X = [
  [477, 497, 522, 542, 564, 581, 614],
  [477, 497, 522, 542, 564, 589, 612],
];
const FOODGOLD_Y = 322;
const TAB_POS = [[491, 353], [527, 353], [546, 353], [570, 353], [600, 361]];
const TAB_W = [34, 17, 22, 28, 30];
const TAB_H = [26, 26, 26, 26, 22];
const TAB_LABELS = ['Current Quests', 'Auto Notes', 'Maps', 'Calendar', 'History'];

// The engine's fourteen party buffs, in slot order, with the ids the spell
// system actually stores them under. Its own display names live alongside.
const PARTY_BUFFS = HC.PARTY_BUFF_IDS;
const PARTY_BUFF_NAMES = HC.PARTY_BUFF_NAMES;
const BUFF_PHASE = HC.PARTY_BUFF_PHASE;

// isg-01..04: the four per-character buff pips down the right of each portrait.
const CHAR_BUFFS = [
  ['bless', 'Bless', 'day_of_the_gods'],
  ['preservation', 'Preservation', 'shield'],
  ['hammerhands', 'Hammerhands', 'protection_from_earth'],
  ['pain_reflection', 'Pain Reflection', 'protection_from_body'],
];

/**
 * Is a buff up? The spell system stores `{ power, expires }` with `expires`
 * counted down in minutes, but older saves and the test harness use `until`
 * against the wall clock, so accept either rather than silently drawing nothing.
 */
function buffUp(bag, id, nowMinutes) {
  const b = bag && bag[id];
  if (!b) return false;
  if (b.expires !== undefined) return b.expires > 0;
  if (b.until !== undefined) return b.until > nowMinutes;
  return true;
}

export class HUD {
  constructor(session, ui) {
    this.session = session;
    this.ui = ui;
    this.buttons = [];
    this.minimapZoom = 8192;   // world units across the automap
    this.showTouch = false;
    this._chromeCache = null;
    this._chromeKey = '';
    this.t = 0;
  }

  /** X offset applied to right-column elements when the frame is widened. */
  get dx() { return layout.w - 640; }

  /**
   * X offset for the party cluster. MM6 has no widescreen mode, so this is our
   * call: the portraits, their gauges and the status line keep every one of the
   * engine's internal offsets - the 115 px pitch, the tube positions, the niche
   * art - and the whole cluster is centred in the bar instead of being spread
   * out to fill it. The gaps between the niches are part of the carving; a
   * stretched bar reads as a resized web page. On a 640 frame this is zero, so
   * the spec coordinates come out exactly where they always were.
   */
  get bx() { return Math.round((layout.w - 640) / 2); }

  portraitRect(i) {
    return { x: PORTRAIT_X[i] + this.bx, y: PORTRAIT_Y, w: PORTRAIT_W, h: PORTRAIT_H };
  }

  get minimapRect() {
    return { x: MAP_X + this.dx, y: MAP_Y, w: MAP_W, h: MAP_H };
  }

  // --- chrome --------------------------------------------------------------

  /**
   * The geometry the carved chrome is cut to. Passed straight through to the
   * art module so a moulding can never end up a pixel away from the gauge it
   * is supposed to be holding.
   */
  chromeGeom() {
    const dx = this.dx, bx = this.bx;
    const slots = [];
    for (let row = 0; row < 2; row++) {
      for (const x of BUFF_ROW_X[row]) slots.push([x + dx, BUFF_ROW_Y[row]]);
    }
    return {
      view: layout.view, side: layout.side, hud: layout.hud,
      portraitX: PORTRAIT_X.map((x) => x + bx), portraitY: PORTRAIT_Y,
      portraitW: PORTRAIT_W, portraitH: PORTRAIT_H,
      hpX: HP_X.map((x) => x + bx), spX: SP_X.map((x) => x + bx),
      barY: BAR_Y, barW: BAR_W, barH: BAR_H,
      map: { x: MAP_X + dx, y: MAP_Y, w: MAP_W, h: MAP_H },
      compass: { x: COMPASS_X + dx, y: COMPASS_Y, w: COMPASS_W, h: HC.COMPASS_H },
      hire: { x: [HIRE_X[0] + dx, HIRE_X[1] + dx], y: HIRE_Y, w: PORTRAIT_W, h: PORTRAIT_H },
      buffPanel: { y: BUFF_ROW_Y[0] - 8, h: (BUFF_ROW_Y[1] + 16) - (BUFF_ROW_Y[0] - 8) + 8, slots },
      foodGold: { y: FOODGOLD_Y, split: 554 + dx },
      tabs: { y: TAB_POS[0][1], h: 28 },
      keys: { y: BUTTON_Y },
    };
  }

  chrome() {
    const key = `${layout.w}x${layout.h}`;
    if (this._chromeCache && this._chromeKey === key) return this._chromeCache;
    this._chromeCache = HC.hudChrome(layout.w, layout.h, this.chromeGeom());
    this._chromeKey = key;
    return this._chromeCache;
  }

  invalidate() { this._chromeCache = null; HC.invalidateChrome(); }

  // --- frame ---------------------------------------------------------------

  /**
   * The carved surround: everything outside the 3D window. MM6 keeps this
   * visible behind every full-screen panel - the panels replace only the world
   * view - so screens call this before painting themselves.
   */
  drawFrame(ctx, dt) {
    this.t += dt || 0;
    this.buttons.length = 0;
    ctx.clearRect(0, 0, layout.w, layout.h);
    ctx.drawImage(this.chrome(), 0, 0);

    this.drawMinimap(ctx);
    this.drawCompass(ctx);
    this.drawHirelings(ctx);
    this.drawPartyBuffs(ctx);
    this.drawIndicators(ctx);
    this.drawFoodGold(ctx);
    this.drawBookTabs(ctx);
    this.drawPartyBar(ctx);
    this.drawStatusLine(ctx);
  }

  // --- party state helpers ---------------------------------------------------

  get partyBuffs() { return (this.session.party && this.session.party.buffs) || {}; }

  buffActive(id) {
    return buffUp(this.partyBuffs, id, this.session.clock ? this.session.clock.minutes : 0);
  }

  /**
   * MM6 plots monsters on the automap only with a Cartographer in the party or
   * Wizard Eye running; otherwise the map shows terrain and walls and nothing
   * that moves.
   */
  get seesMonsters() {
    if (this.buffActive('wizard_eye')) return true;
    const hire = (this.session.party && this.session.party.hirelings) || [];
    return hire.some((n) => n && /cartograph/i.test(n.profession || ''));
  }

  draw(ctx, dt) {
    this.drawFrame(ctx, dt);
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

    // Actor dots, in the engine's colours. Monsters and corpses need a
    // Cartographer hireling or Wizard Eye - without one MM6 shows neither.
    if (S.entities) {
      const scale = m.w / this.minimapZoom;
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      const seesMonsters = this.seesMonsters;
      for (const e of S.entities.list) {
        if (!e.visible) continue;
        if (e.category === 'monster' && !seesMonsters) continue;
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

    // ib-autmask goes on last, cutting the square blit into an arched aperture.
    HC.blit(ctx, HC.mapMask(m.w, m.h), m.x, m.y);

    const zi = this.ui.region('map:zoomin', ZOOM_IN_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 'Zoom in');
    const zo = this.ui.region('map:zoomout', ZOOM_OUT_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 'Zoom out');
    HC.drawZoomKey(ctx, ZOOM_IN_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 1, zi.down);
    HC.drawZoomKey(ctx, ZOOM_OUT_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, -1, zo.down);
    if (zi.click) this.minimapZoom = Math.max(2048, this.minimapZoom / 2);
    if (zo.click) this.minimapZoom = Math.min(65536, this.minimapZoom * 2);

    const dt = this.ui.region('map:datetime', m.x, m.y, m.w, m.h, `${this.session.clock.format()}  ${this.session.clock.formatDate()}`);
    this.buttons.push({ id: 'datetime', hit: dt });
  }

  /**
   * Not a needle: a painted panoramic strip sliding behind a narrow aperture,
   * so the cardinal letters scroll past as you turn.
   */
  drawCompass(ctx) {
    HC.drawCompassRibbon(ctx, COMPASS_X + this.dx, COMPASS_Y, COMPASS_W, this.session.player.yaw);
    this.ui.region('compass', COMPASS_X + this.dx, COMPASS_Y, COMPASS_W, HC.COMPASS_H,
      headingName(this.session.player.yaw));
  }

  drawHirelings(ctx) {
    const hire = (this.session.party && this.session.party.hirelings) || [];
    for (let i = 0; i < 2; i++) {
      const x = HIRE_X[i] + this.dx;
      const npc = hire[i];
      // The empty alcove is chrome - an arched recess with a bare hook in it -
      // so nothing is drawn over it until someone is actually engaged.
      if (!npc) { HC.drawEmptyHook(ctx, x + (PORTRAIT_W >> 1), HIRE_Y + 5); continue; }
      const p = getPortrait(npc.portraitSeed || i * 977, { sex: npc.sex || 'm', klass: npc.klass }, 'normal');
      ctx.drawImage(p, x, HIRE_Y);
      UI.drawPortraitFrame(ctx, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, 'normal');
      const hit = this.ui.region(`hire${i}`, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, `${npc.name} the ${npc.profession || 'Hireling'}`);
      this.buttons.push({ id: `hire${i}`, hit, npc });
    }
  }

  /**
   * The fourteen party-buff slots. The empty sockets are painted into the
   * chrome, so a slot with nothing in it shows the panel art the way MM6 does
   * rather than leaving a hole in the column.
   */
  drawPartyBuffs(ctx) {
    const buffs = this.partyBuffs;
    const now = this.session.clock ? this.session.clock.minutes : 0;
    for (let row = 0; row < 2; row++) {
      const xs = BUFF_ROW_X[row];
      for (let i = 0; i < xs.length; i++) {
        const idx = row * 7 + i;
        const id = PARTY_BUFFS[idx];
        if (!id) continue;
        const x = xs[i] + this.dx, y = BUFF_ROW_Y[row];
        if (!buffUp(buffs, id, now)) continue;
        // 126 frames at 50fps - a ~2.5s loop - with a per-slot phase offset.
        const phase = (((this.t * 1000) / 20 + 20 * BUFF_PHASE[idx]) % 126 + 126) % 126;
        HC.drawBuffIcon(ctx, id, x, y, phase);
        this.ui.region(`buff${idx}`, x, y, 16, 16, PARTY_BUFF_NAMES[idx]);
      }
    }
  }

  /** Torchlight and Wizard Eye sit in the column's top corners while engaged. */
  drawIndicators(ctx) {
    const phase = this.t * 6;
    if (this.buffActive('torch_light')) {
      HC.drawIndicator(ctx, 'torch', TORCH_X + this.dx, INDICATOR_Y, phase);
      this.ui.region('ind:torch', TORCH_X + this.dx, INDICATOR_Y, 32, 32, 'Torch Light');
    }
    if (this.buffActive('wizard_eye')) {
      HC.drawIndicator(ctx, 'wizeye', WIZEYE_X + this.dx, INDICATOR_Y, phase);
      this.ui.region('ind:wizeye', WIZEYE_X + this.dx, INDICATOR_Y, 32, 32, 'Wizard Eye');
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
      const [tx, by] = TAB_POS[i];
      const x = tx + this.dx;
      const w = TAB_W[i], h = TAB_H[i];
      const hit = this.ui.region(`tab:${id}`, x, by, w, h, TAB_LABELS[i]);
      const alert = this.session.newEntries && this.session.newEntries[id];
      if (UI.drawBookSpine) {
        UI.drawBookSpine(ctx, x, by, w, h, {
          tone: i, state: hit.down ? 'down' : 'up', flash: alert && flash,
        });
      } else {
        UI.drawButton(ctx, x, by, w, h, null, hit.down ? 'down' : 'up');
        UI.drawIcon(ctx, icons[i], x + 6, by + 5, 16);
      }
      this.buttons.push({ id: `tab:${id}`, hit });
    });
  }

  // --- bottom bar ----------------------------------------------------------

  drawPartyBar(ctx) {
    const S = this.session;
    const members = (S.party && S.party.members) || [];
    const bx = this.bx;

    for (let i = 0; i < 4; i++) {
      const ch = members[i];
      const px = PORTRAIT_X[i] + bx;
      const hpx = HP_X[i] + bx, spx = SP_X[i] + bx;
      if (!ch) continue;

      const p = getPortrait(ch.portraitSeed, { sex: ch.sex, klass: ch.klass }, this.expressionFor(ch));
      ctx.drawImage(p, px, PORTRAIT_Y);

      // IB-selec: one continuous glowing border round the portrait, following
      // the arched head of the niche. Not brackets, not a reticle.
      if (i === S.activeChar) {
        HC.drawSelectRing(ctx, px + SELECT_DX, PORTRAIT_Y + SELECT_DY,
          PORTRAIT_W - SELECT_DX * 2, PORTRAIT_H - SELECT_DY * 2);
      }

      // IB-InitG / IB-InitR: a painted gem set into the keystone of the arch,
      // green while the character can act and red while they are recovering.
      const ready = ch.recovery <= 0 && ch.hp > 0;
      if (!S.turnBased || S.turnQueue.includes(i)) {
        HC.drawReadyGem(ctx, px + (PORTRAIT_W >> 1) - 5, PORTRAIT_Y + READY_DY - 8,
          ready ? 'green' : 'red');
      }

      // Vertical tubes: health on the left of the portrait, spell on the right.
      // Both maxima are derived from the character, not stored on it.
      const mh = charMaxHP(ch), ms = charMaxSP(ch);
      const hpFrac = mh > 0 ? ch.hp / mh : 0;
      const spFrac = ms > 0 ? ch.sp / ms : 0;
      HC.drawTube(ctx, hpx, BAR_Y, BAR_W, BAR_H, hpFrac, 'hp');
      HC.drawTube(ctx, spx, BAR_Y, BAR_W, BAR_H, spFrac, 'sp');

      // Per-character buff pips down the right of the portrait.
      const cb = ch.buffs || {};
      CHAR_BUFFS.forEach(([id, label, art], k) => {
        if (!buffUp(cb, id, S.clock ? S.clock.minutes : 0)) return;
        HC.drawBuffIcon(ctx, art, px + BUFF_DX, BUFF_Y[k], ((this.t * 50 + k * 20) % 126 + 126) % 126);
        this.ui.region(`cbuff${i}:${k}`, px + BUFF_DX, BUFF_Y[k], 16, 16, label);
      });

      const hit = this.ui.region(`hud:char${i}`, px, PORTRAIT_Y, PORTRAIT_W, PORTRAIT_H,
        `${ch.name} the ${ch.klass}`);
      this.buttons.push({ id: `char${i}`, hit });
      this.ui.region(`hud:hp${i}`, hpx, BAR_Y, BAR_W, BAR_H, `Hit Points: ${ch.hp} / ${mh}`);
      this.ui.region(`hud:sp${i}`, spx, BAR_Y, BAR_W, BAR_H, `Spell Points: ${ch.sp} / ${ms}`);
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
      if (UI.drawActionPlate) {
        UI.drawActionPlate(ctx, x, BUTTON_Y, BUTTON_W, BUTTON_H, icon, hit.down ? 'down' : 'up');
      } else {
        UI.drawButton(ctx, x, BUTTON_Y, BUTTON_W, BUTTON_H, null, hit.down ? 'down' : 'up');
        const o = hit.down ? 1 : 0;
        UI.drawIcon(ctx, icon, x + 10 + o, BUTTON_Y + 8 + o, 20);
      }
      this.buttons.push({ id, hit });
    });
  }

  expressionFor(ch) {
    if (ch.portraitOverride) return ch.portraitOverride;
    const raw = ch.conditions;
    const conds = Array.isArray(raw) ? raw
      : raw instanceof Set ? [...raw]
        : raw && typeof raw === 'object' ? Object.keys(raw).filter((k) => raw[k]) : [];
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
    const mh = charMaxHP(ch);
    if (ch.hp < mh * 0.25) return 'dmg_major';
    if (ch.hp < mh * 0.6) return 'dmg_minor';
    return 'normal';
  }

  // --- overlays ------------------------------------------------------------

  /** MM6 keeps one line of status text across the top of the party bar. */
  drawStatusLine(ctx) {
    // One line, one thing at a time: whatever the cursor is over wins,
    // otherwise the most recent message while it is still fresh.
    const recent = this.session.log.recent(1)[0];
    const tip = this.ui.hoverText
      || (this.session.hoverEntity && this.session.hoverEntity.label)
      || (recent && recent.t < recent.ttl ? recent.text : '')
      || '';
    if (!tip) return;
    // Centred in the same 450 px field the portraits are centred in.
    F.drawText(ctx, tip, 11 + 225 + this.bx, STATUS_Y, {
      align: 'center', color: F.TEXT_HUD || '#0A0000', shadow: F.TEXT_HUD_SHADOW || '#E6D6C1',
      maxWidth: 450,
    });
  }

  /** Things MM6 draws inside the 3D window itself. */
  drawViewportOverlays(ctx) {
    const S = this.session;
    const v = layout.view;

    // MM6 has no in-world message log - everything it wants to tell you goes
    // through the single status line above the party bar, one thing at a time.

    // Fly and Water Walk sit in the window's top corners while engaged.
    if (this.buffActive('fly')) UI.drawIcon(ctx, 'school_air', v.x, v.y, 20);
    if (this.buffActive('water_walk')) UI.drawIcon(ctx, 'school_water', v.x + v.w - 20, v.y, 20);

    // The targeting reticle. MM6 pins it to the centre of the world window
    // whenever you are looking around rather than pointing at the interface.
    if (this.showReticle) {
      const cx = Math.round(v.x + v.w / 2), cy = Math.round(v.y + v.h / 2);
      ctx.fillStyle = this.session.hoverEntity ? '#E1CD23' : '#E6D6C1';
      for (let i = 3; i <= 6; i++) {
        ctx.fillRect(cx + i, cy, 1, 1); ctx.fillRect(cx - i, cy, 1, 1);
        ctx.fillRect(cx, cy + i, 1, 1); ctx.fillRect(cx, cy - i, 1, 1);
      }
      ctx.fillRect(cx, cy, 1, 1);
    }

    // Turn-based indicator in the window's bottom-right corner.
    if (S.turnBased) {
      const ap = Math.max(0, Math.min(5, Math.floor((S.turnPoints ?? 130) / 26)));
      // The engine blits the turn sprite at a fixed (394,288) in frame space,
      // not relative to the window's corner.
      UI.drawIcon(ctx, S.turnActor === 'monsters' ? 'turnhour' : `turn${5 - ap}`,
        394, 288, 44);
    }

    // No world-space nameplates and no monster health bars: MM6 puts the
    // monster's name in the status line on mouse-over and never exposes its
    // health at all.
  }

  drawFloatText(ctx) {
    const vfx = this.session.vfx;
    if (!vfx || !vfx.screenTexts) return;
    for (const t of vfx.screenTexts(this.session.engine.camera, layout.view)) {
      const color = t.kind === 'heal' ? '#00E100'
        : t.kind === 'crit' ? '#FF3C1E'
          : t.kind === 'miss' ? '#7E7E7E'
            : t.kind === 'resist' ? '#00AFFF' : '#FFFF9B';
      // No alpha: a 256-colour frame cannot hold one. The fade is three flat
      // steps of the ink itself, and below the last step the text is gone.
      if (t.alpha < 0.18) continue;
      const k = t.alpha > 0.66 ? 1 : t.alpha > 0.38 ? 0.62 : 0.34;
      F.drawText(ctx, t.text, t.x, t.y, { face: 'small', align: 'center', color: dim(color, k) });
    }
  }

  /**
   * The touch stick, drawn the way everything else here is: scanline-filled
   * rings and a Bayer stipple, never an arc with an alpha falloff.
   */
  drawTouchControls(ctx) {
    const v = layout.view;
    const r = 46;
    const cx = v.x + r + 14, cy = v.y + v.h - r - 14;
    if (!this._stick) this._stick = HC.touchStick(r);
    HC.blit(ctx, this._stick.ring, cx - r, cy - r);
    HC.blit(ctx, this._stick.knob,
      cx + (this.stickDX || 0) - 16, cy + (this.stickDY || 0) - 16);
  }
}

/** Step an ink colour down toward black; the only fade an 8-bit frame has. */
function dim(hex, k) {
  if (k >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const HEADINGS = ['north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west'];
/** What the ribbon is reading under the index mark, for the status line. */
function headingName(yaw) {
  const t = ((yaw / (Math.PI * 2)) % 1 + 1) % 1;
  return `Facing ${HEADINGS[Math.round(t * 8) % 8]}.`;
}

function fmtNum(n) {
  n = n | 0;
  if (n >= 1000000) return `${(n / 1000000).toPrecision(4)}M`;
  return String(n);
}

/** Derived maxima, guarded so a stub party object cannot break the gauges. */
function charMaxHP(ch) {
  try { const v = maxHP(ch); if (isFinite(v) && v > 0) return v; } catch { /* fall through */ }
  return ch.maxHP || ch.hp || 1;
}
function charMaxSP(ch) {
  try { const v = maxSP(ch); if (isFinite(v) && v >= 0) return v; } catch { /* fall through */ }
  return ch.maxSP || ch.sp || 0;
}
