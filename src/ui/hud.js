import { layout, mmToLogical } from '../core/layout.js';
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
    /**
     * True while a modal panel is open above the HUD. The chrome still draws,
     * but its hot regions go inert (except the party portraits, which MM6
     * keeps live for character switching) so they can neither steal a click
     * from the panel nor leave a fossil tooltip in the status line.
     */
    this.modal = false;
    /** Tap-a-portrait readout: { text, until } against this.t. */
    this._charStatus = null;
    this.touchGeom = null;
  }

  /**
   * All HUD hot rects go through here so the modal gate lives in one place.
   */
  region(id, x, y, w, h, tip) {
    if (this.modal && !id.startsWith('hud:char')) {
      return { hover: false, down: false, click: false, rightClick: false };
    }
    return this.ui.region(id, x, y, w, h, tip);
  }

  /** X offset applied to right-column elements when the frame is widened. */
  get dx() { return layout.w - 640; }

  /**
   * Safe-area shifts for the interactive right-column rows. In landscape a
   * notch-right orientation buries the trailing ~58pt of the frame and the
   * home indicator owns the bottom edge, so the four action keys move up and
   * the right-hugging rows (keys, gold/food, book tabs) move inboard. Portrait
   * parks the frame clear of both, so the shifts are zero there.
   */
  get keyShift() {
    if (layout.portrait) return { x: 0, y: 0 };
    // The stock row already overhangs the 640x480 frame by a couple of pixels
    // (BUTTON_X[3]+40 = 642, BUTTON_Y+35 = 485), so under a live inset the
    // shift covers the inset AND that overhang, plus a 4px breath.
    const overR = Math.max(0, BUTTON_X[3] + BUTTON_W - 640);
    const overB = Math.max(0, BUTTON_Y + BUTTON_H - 480);
    return {
      x: -Math.round(layout.safe.right > 0 ? Math.min(layout.safe.right, 88) + overR + 4 : 0),
      y: -Math.round(layout.safe.bottom > 0 ? Math.min(layout.safe.bottom, 40) + overB : 0),
    };
  }

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
      foodGold: { y: FOODGOLD_Y, split: 554 + dx + this.keyShift.x },
      tabs: { y: TAB_POS[0][1], h: 28 },
      keys: { y: BUTTON_Y + this.keyShift.y },
    };
  }

  chrome() {
    const ks = this.keyShift;
    const key = `${layout.w}x${layout.h}:${ks.x},${ks.y}`;
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

    const zi = this.region('map:zoomin', ZOOM_IN_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 'Zoom in');
    const zo = this.region('map:zoomout', ZOOM_OUT_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 'Zoom out');
    HC.drawZoomKey(ctx, ZOOM_IN_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, 1, zi.down);
    HC.drawZoomKey(ctx, ZOOM_OUT_X + this.dx, ZOOM_Y, 18, HC.COMPASS_H, -1, zo.down);
    if (zi.click) this.minimapZoom = Math.max(2048, this.minimapZoom / 2);
    if (zo.click) this.minimapZoom = Math.min(65536, this.minimapZoom * 2);

    const dt = this.region('map:datetime', m.x, m.y, m.w, m.h, `${this.session.clock.format()}  ${this.session.clock.formatDate()}`);
    this.buttons.push({ id: 'datetime', hit: dt });
  }

  /**
   * Not a needle: a painted panoramic strip sliding behind a narrow aperture,
   * so the cardinal letters scroll past as you turn.
   */
  drawCompass(ctx) {
    HC.drawCompassRibbon(ctx, COMPASS_X + this.dx, COMPASS_Y, COMPASS_W, this.session.player.yaw);
    this.region('compass', COMPASS_X + this.dx, COMPASS_Y, COMPASS_W, HC.COMPASS_H,
      headingName(this.session.player.yaw));
  }

  drawHirelings(ctx) {
    const hire = (this.session.party && this.session.party.hirelings) || [];
    for (let i = 0; i < 2; i++) {
      const x = HIRE_X[i] + this.dx;
      const npc = hire[i];
      // The empty alcove is chrome - an arched recess with a bare hook in it.
      // A checker shade is laid over it so the unused niche reads as a
      // shadowed recess, deliberately dark, rather than a broken feature; a
      // hover/tap says what it is for.
      if (!npc) {
        HC.drawEmptyHook(ctx, x + (PORTRAIT_W >> 1), HIRE_Y + 5);
        ctx.drawImage(nicheShade(PORTRAIT_W, PORTRAIT_H), x, HIRE_Y);
        this.region(`hire${i}`, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H,
          'An empty alcove. Hirelings you engage wait here.');
        continue;
      }
      const p = getPortrait(npc.portraitSeed || i * 977, { sex: npc.sex || 'm', klass: npc.klass || npc.class }, 'normal');
      ctx.drawImage(p, x, HIRE_Y);
      UI.drawPortraitFrame(ctx, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, 'normal');
      const hit = this.region(`hire${i}`, x, HIRE_Y, PORTRAIT_W, PORTRAIT_H, `${npc.name} the ${npc.profession || 'Hireling'}`);
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
        if (!buffUp(buffs, id, now)) {
          // The empty socket stays painted chrome, knocked back into shadow so
          // it reads as a waiting recess; the name only surfaces on hover/tap.
          ctx.drawImage(nicheShade(16, 16), x, y);
          this.region(`buff${idx}`, x, y, 16, 16, `${PARTY_BUFF_NAMES[idx]} (not active)`);
          continue;
        }
        // 126 frames at 50fps - a ~2.5s loop - with a per-slot phase offset.
        const phase = (((this.t * 1000) / 20 + 20 * BUFF_PHASE[idx]) % 126 + 126) % 126;
        HC.drawBuffIcon(ctx, id, x, y, phase);
        this.region(`buff${idx}`, x, y, 16, 16, PARTY_BUFF_NAMES[idx]);
      }
    }
  }

  /** Torchlight and Wizard Eye sit in the column's top corners while engaged. */
  drawIndicators(ctx) {
    const phase = this.t * 6;
    if (this.buffActive('torch_light')) {
      HC.drawIndicator(ctx, 'torch', TORCH_X + this.dx, INDICATOR_Y, phase);
      this.region('ind:torch', TORCH_X + this.dx, INDICATOR_Y, 32, 32, 'Torch Light');
    }
    if (this.buffActive('wizard_eye')) {
      HC.drawIndicator(ctx, 'wizeye', WIZEYE_X + this.dx, INDICATOR_Y, phase);
      this.region('ind:wizeye', WIZEYE_X + this.dx, INDICATOR_Y, 32, 32, 'Wizard Eye');
    }
  }

  drawFoodGold(ctx) {
    const P = this.session.party;
    const x = this.dx + this.keyShift.x;
    F.drawText(ctx, fmtNum(P ? P.food : 0), 553 + x, FOODGOLD_Y, { face: 'small', align: 'right', color: '#FFFFFF' });
    F.drawText(ctx, fmtNum(P ? P.gold : 0), 632 + x, FOODGOLD_Y, { face: 'small', align: 'right', color: '#FFFFFF' });
    UI.drawIcon(ctx, 'food', 478 + x, FOODGOLD_Y - 2, 14);
    UI.drawIcon(ctx, 'gold', 557 + x, FOODGOLD_Y - 2, 14);
    this.region('food', 476 + x, FOODGOLD_Y, 77, 17, 'Food');
    this.region('gold', 555 + x, FOODGOLD_Y, 77, 17, 'Gold');
  }

  drawBookTabs(ctx) {
    const ids = ['quests', 'autonotes', 'maps', 'calendar', 'history'];
    const icons = ['quest', 'autonotes', 'map', 'options', 'history'];
    const flash = Math.floor(this.t) % 2 === 0;
    ids.forEach((id, i) => {
      const [tx, by] = TAB_POS[i];
      const x = tx + this.dx + this.keyShift.x;
      const w = TAB_W[i], h = TAB_H[i];
      const hit = this.region(`tab:${id}`, x, by, w, h, TAB_LABELS[i]);
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

      // `klass` for legacy stub parties, `class` for the real party module -
      // reading only one of them was why the HUD busts stopped matching the
      // faces picked at character creation.
      const p = getPortrait(ch.portraitSeed, { sex: ch.sex, klass: ch.klass || ch.class }, this.expressionFor(ch));
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
        this.region(`cbuff${i}:${k}`, px + BUFF_DX, BUFF_Y[k], 16, 16, label);
      });

      const hit = this.region(`hud:char${i}`, px, PORTRAIT_Y, PORTRAIT_W, PORTRAIT_H,
        `${ch.name} the ${className(ch)}`);
      this.buttons.push({ id: `char${i}`, hit });
      this.region(`hud:hp${i}`, hpx, BAR_Y, BAR_W, BAR_H, `Hit Points: ${ch.hp} / ${mh}`);
      this.region(`hud:sp${i}`, spx, BAR_Y, BAR_W, BAR_H, `Spell Points: ${ch.sp} / ${ms}`);
    }

    // The four stone buttons in the bottom right corner.
    const defs = [
      ['cast', 'castspell', 'Cast Spell'],
      ['rest', 'rest', 'Rest'],
      ['quickref', 'quickref', 'Quick Reference'],
      ['options', 'options', 'Game Options'],
    ];
    const ks = this.keyShift;
    defs.forEach(([id, icon, tip], i) => {
      const x = BUTTON_X[i] + this.dx + ks.x;
      const y = BUTTON_Y + ks.y;
      const hit = this.region(`hud:${id}`, x, y, BUTTON_W, BUTTON_H, tip);
      if (UI.drawActionPlate) {
        UI.drawActionPlate(ctx, x, y, BUTTON_W, BUTTON_H, icon, hit.down ? 'down' : 'up');
      } else {
        UI.drawButton(ctx, x, y, BUTTON_W, BUTTON_H, null, hit.down ? 'down' : 'up');
        const o = hit.down ? 1 : 0;
        UI.drawIcon(ctx, icon, x + 10 + o, y + 8 + o, 20);
      }
      this.buttons.push({ id, hit });
    });

    // Portrait phones: exact HP/SP under every bust, tap-free (no hover there).
    if (layout.portrait) {
      for (let i = 0; i < 4; i++) {
        const ch = members[i];
        if (!ch) continue;
        const px = PORTRAIT_X[i] + bx;
        const ny = PORTRAIT_Y + PORTRAIT_H + 2;
        F.drawText(ctx, `${ch.hp | 0}`, px + PORTRAIT_W / 2 - 4, ny,
          { face: 'small', align: 'right', color: ch.hp > 0 ? '#00E100' : '#FF2300' });
        F.drawText(ctx, '/', px + PORTRAIT_W / 2, ny, { face: 'small', align: 'center', color: '#8a7a55' });
        F.drawText(ctx, `${ch.sp | 0}`, px + PORTRAIT_W / 2 + 6, ny,
          { face: 'small', color: '#00AFFF' });
      }
    }
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

  /** Tap-a-portrait readout: exact numbers for phones with no hover. */
  showCharStatus(i) {
    const ch = ((this.session.party && this.session.party.members) || [])[i];
    if (!ch) return;
    const text = `${ch.name}: ${ch.hp} / ${charMaxHP(ch)} Hit Points, ${ch.sp} / ${charMaxSP(ch)} Spell Points`;
    this._charStatus = { text, until: this.t + 4 };
  }

  /**
   * MM6 keeps one line of status text across the top of the party bar. Here it
   * is an honest message strip: live hover text wins while something is
   * actually hovered, then a tapped portrait's numbers, then the recent
   * message queue (up to three lines, each fading after its ttl). Under a
   * modal panel the strip shows the panel's own hints - never fossil world
   * text like the last monster the frozen reticle saw.
   */
  drawStatusLine(ctx) {
    const cx = 11 + 225 + this.bx;
    const ink = { color: F.TEXT_HUD || '#0A0000', shadow: F.TEXT_HUD_SHADOW || '#E6D6C1' };

    if (this.modal) {
      // Panels register their regions AFTER this draws, so use the tooltip
      // they produced last frame; one frame of lag is invisible.
      const tip = this.ui.hoverText || this.ui.prevHoverText || '';
      if (tip) F.drawText(ctx, tip, cx, STATUS_Y, { align: 'center', maxWidth: 450, ...ink });
      return;
    }

    const hoverTip = this.ui.hoverText
      || (this.session.hoverEntity && this.session.hoverEntity.label)
      || '';
    if (hoverTip) {
      F.drawText(ctx, hoverTip, cx, STATUS_Y, { align: 'center', maxWidth: 450, ...ink });
      return;
    }
    if (this._charStatus && this.t < this._charStatus.until) {
      F.drawText(ctx, this._charStatus.text, cx, STATUS_Y, { align: 'center', maxWidth: 450, ...ink });
      return;
    }

    // The message queue: newest at the bottom. The band between the view and
    // the portraits only holds two small rows before the third lands on the
    // ready gems, so the strip is clamped to two; portrait phones carry the
    // full three-line log in the control band below instead (and skip the
    // 0.8mm strip copy entirely - the same words twice read as a stutter).
    if (layout.portrait && layout.controls) return;
    const recent = this.session.log.recent(2);
    if (!recent.length) return;
    if (recent.length === 1) {
      F.drawText(ctx, recent[0].text, cx, STATUS_Y, { align: 'center', maxWidth: 450, ...ink });
      return;
    }
    const lh = 10;
    let y = STATUS_Y - 1;
    for (const l of recent) {
      F.drawText(ctx, l.text, cx, y, { face: 'small', align: 'center', maxWidth: 450, ...ink });
      y += lh;
    }
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
   * rings and a Bayer stipple, never an arc with an alpha falloff. In portrait
   * mode the whole control set lives in the dead band under the frame: stick
   * lower-left, look pad lower-right, action keys between them.
   */
  drawTouchControls(ctx) {
    const g = this.touchGeom;
    const sr = (g && g.stick) || (() => {
      const v = layout.view; const r = 46;
      return { cx: v.x + r + 14, cy: v.y + v.h - r - 14, r };
    })();

    this.drawPortraitBand(ctx);

    // The chrome painter already grounds the portrait control zone in the
    // same ashlar as the rest of the frame; the controls sit straight on it.
    if (!this._stick || this._stickR !== sr.r) {
      this._stick = HC.touchStick(sr.r);
      this._stickR = sr.r;
    }
    HC.blit(ctx, this._stick.ring, sr.cx - sr.r, sr.cy - sr.r);
    // stickDX/DY are the normalised deflection (-1..1); scale by the ring
    // radius so the knob actually rides the rim at full tilt.
    HC.blit(ctx, this._stick.knob,
      sr.cx + (this.stickDX || 0) * sr.r * 0.7 - 16,
      sr.cy + (this.stickDY || 0) * sr.r * 0.7 - 16);

    // Look pad and action keys only exist in the portrait control zone.
    if (!g) return;
    const lp = g.lookPad;
    if (lp) {
      ctx.fillStyle = '#1c1812';
      ctx.fillRect(lp.x, lp.y, lp.w, lp.h);
      ctx.fillStyle = '#3a3226';
      ctx.fillRect(lp.x, lp.y, lp.w, 1); ctx.fillRect(lp.x, lp.y + lp.h - 1, lp.w, 1);
      ctx.fillRect(lp.x, lp.y, 1, lp.h); ctx.fillRect(lp.x + lp.w - 1, lp.y, 1, lp.h);
      // A small painted compass rosette so the pad reads as "look".
      const mx = lp.x + lp.w / 2, my = lp.y + lp.h / 2;
      ctx.fillStyle = '#6a5c40';
      for (const [dx, dy] of [[0, -10], [0, 10], [-10, 0], [10, 0]]) {
        ctx.fillRect(Math.round(mx + dx) - 1, Math.round(my + dy) - 1, 3, 3);
      }
      ctx.fillStyle = '#8a7a55';
      ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3);
      F.drawText(ctx, 'LOOK', mx, lp.y + lp.h - 14, { face: 'small', align: 'center', color: '#6a5c40' });
    }
    this._touchButtonsFrom(ctx, g);
  }

  /**
   * The portrait dead band earns its keep: the message log (three lines,
   * larger type than the 0.8mm strip) and thumb-sized copies of the four
   * action keys live in the space between the frame and the thumb controls.
   */
  drawPortraitBand(ctx) {
    const c = layout.controls;
    if (!c || c.h < 180) return;

    // Message log: three fresh lines in the body face, readable at arm's length.
    const recent = this.session.log ? this.session.log.recent(3) : [];
    let y = c.y + 10;
    const cx = c.x + c.w / 2;
    for (const l of recent) {
      F.drawText(ctx, l.text, cx, y, {
        face: 'normal', align: 'center', maxWidth: c.w - 24,
        color: l.color || '#E6D6C1', shadow: '#141008',
      });
      y += 15;
    }

    // The four action keys, grown to a real thumb size (>= 7 mm).
    const s = Math.max(44, mmToLogical(7.5));
    if (c.h < s + 260) return;   // shallow band: leave room for the stick row
    const defs = [
      ['cast', 'castspell', 'Cast Spell'],
      ['rest', 'rest', 'Rest'],
      ['quickref', 'quickref', 'Quick Reference'],
      ['options', 'options', 'Game Options'],
    ];
    const gap = Math.max(10, mmToLogical(2));
    const total = defs.length * s + (defs.length - 1) * gap;
    let x = Math.round(c.x + (c.w - total) / 2);
    const ky = c.y + 58;
    for (const [id, icon, tip] of defs) {
      const hit = this.region(`hudb:${id}`, x, ky, s, s, tip);
      if (UI.drawActionPlate) {
        UI.drawActionPlate(ctx, x, ky, s, s, icon, hit.down ? 'down' : 'up');
      } else {
        UI.drawButton(ctx, x, ky, s, s, null, hit.down ? 'down' : 'up');
        const o = hit.down ? 1 : 0;
        UI.drawIcon(ctx, icon, x + ((s - 20) >> 1) + o, ky + ((s - 20) >> 1) + o, 20);
      }
      this.buttons.push({ id, hit });
      x += s + gap;
    }
  }

  _touchButtonsFrom(ctx, g) {
    for (const b of (g && g.buttons) || []) {
      const down = g.pressed && g.pressed[b.id];
      const o = down ? 1 : 0;
      ctx.fillStyle = down ? '#241e14' : '#332a1c';
      ctx.fillRect(b.x + o, b.y + o, b.w, b.h);
      ctx.fillStyle = down ? '#141008' : '#584a30';
      ctx.fillRect(b.x + o, b.y + o, b.w, 2);
      ctx.fillStyle = down ? '#584a30' : '#141008';
      ctx.fillRect(b.x + o, b.y + o + b.h - 2, b.w, 2);
      const label = b.id === 'attack' ? 'ATTACK' : 'USE';
      F.drawText(ctx, label, b.x + o + b.w / 2, b.y + o + (b.h - 10) / 2, {
        face: 'small', align: 'center', color: down ? '#E1CD23' : '#c8b888',
      });
    }
  }
}

/** Cached checker shade laid over an unused chrome fixture: a hard 8-bit
 *  "in shadow" treatment, not an alpha wash. */
const _shadeCache = new Map();
function nicheShade(w, h) {
  const key = `${w}x${h}`;
  let c = _shadeCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  for (let y = 0; y < h; y++) {
    for (let x = (y & 1); x < w; x += 2) g.fillRect(x, y, 1, 1);
  }
  _shadeCache.set(key, c);
  return c;
}

/** Display name for a character's profession, whatever shape it arrived in. */
function className(ch) {
  const k = ch.klass || ch.class || '';
  return k ? String(k).charAt(0).toUpperCase() + String(k).slice(1) : 'Adventurer';
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
