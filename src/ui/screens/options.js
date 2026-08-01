// ---------------------------------------------------------------------------
// Game options (the Esc menu).
//
// MM6's menu is the painted `options` panel at (8, 8) with six carved buttons,
// 214 x 40, at (19 | 241, 155 | 209 | 263) - and nothing else. Volume, gamma
// and the input toggles live one level down, behind the Controls button, in a
// carved sub-panel, so the menu frame itself stays period-correct.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, px, py, WHITE, CANARY, HILITE, DIM, RED,
} from './screenbase.js';
import * as M from './mm6art.js';

/** MM6's own button grid, panel-relative. */
const BTN_W = 214;
const BTN_H = 40;
const BUTTONS = [
  ['new', 'New Game', 19, 155],
  ['save', 'Save Game', 19, 209],
  ['load', 'Load Game', 19, 263],
  ['controls', 'Controls', 241, 155],
  ['quit', 'Quit', 241, 209],
  ['return', 'Return to Game', 241, 263],
];

const DEFAULTS = {
  soundVolume: 0.7,
  musicVolume: 0.5,
  gamma: 0.5,
  viewDistance: 1.0,
  alwaysRun: true,
  turnBasedDefault: false,
  touchControls: false,
  /** MM6's `show_damage`: off in a stock install. */
  showDamage: false,
};

const SLIDERS = [
  ['soundVolume', 'Sound'],
  ['musicVolume', 'Music'],
  ['gamma', 'Brightness'],
  ['viewDistance', 'View Distance'],
];

/**
 * The input toggles, including the one the phone build needs. They are not
 * visible on the menu frame itself - MM6's Esc panel has six buttons and
 * nothing else - so they live behind Controls.
 */
const CHECKS = [
  ['alwaysRun', 'Always Run'],
  ['turnBasedDefault', 'Turn-Based by Default'],
  ['touchControls', 'Thumb Controls'],
];

export class OptionsScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'options';
    this.confirm = null;
    this.sub = null;
    this.drag = null;
    this.settings();
  }

  onOpen() { this.sound('click'); }

  /** The live settings object, created with sane defaults if the shell has none. */
  settings() {
    const s = this.session;
    if (!s.settings) s.settings = Object.assign({}, DEFAULTS);
    else for (const k of Object.keys(DEFAULTS)) if (s.settings[k] === undefined) s.settings[k] = DEFAULTS[k];
    return s.settings;
  }

  apply() {
    if (typeof this.session.applySettings === 'function') this.session.applySettings();
  }

  handleKey(code) {
    if (code === 'Escape') {
      if (this.confirm) { this.confirm = null; return true; }
      if (this.sub) { this.sub = null; return true; }
      this.close(); return true;
    }
    return false;
  }

  update() {
    // A held knob keeps tracking even when the pointer leaves the track.
    if (this.drag && !this.ui.mouse.down) this.drag = null;
  }

  draw(ctx) {
    this.drawPage(ctx, 'stone');

    // A carved cartouche across the head of the panel, the way the painted
    // `options` background does it - no rule, no flat plate.
    const cw = 300, cx = px((PANEL.w - cw) / 2);
    M.carvedPlate(ctx, cx, py(28), cw, 34, { material: 'brass', seed: 3 });
    M.carvedWell(ctx, cx + 4, py(32), cw - 8, 26, { material: 'brass', seed: 8 });
    F.drawText(ctx, 'Game Options', px(PANEL.w / 2), py(38),
      { face: 'title', align: 'center', color: CANARY });

    // Nothing flanks the title. MM6's `options` panel is the painted plate and
    // its six buttons; the lozenge chain that used to sit either side of the
    // cartouche read as a row of literal "- - - -" dashes and is gone.

    F.drawText(ctx, this.session.saveName || '', px(PANEL.w / 2), py(110),
      { face: 'small', align: 'center', color: DIM });

    for (const [id, label, bx, by] of BUTTONS) {
      const x = px(bx), y = py(by);
      const hit = this.ui.region(`${this.id}:b:${id}`, x, y, BTN_W, BTN_H, label);
      const d = A.button(ctx, x, y, BTN_W, BTN_H, null,
        hit.down ? 'down' : hit.hover ? 'hot' : 'up', { seed: 5 + bx });
      F.drawText(ctx, label, (x + BTN_W / 2 + d) | 0, (y + (BTN_H - 12) / 2 + d) | 0, {
        face: 'title', align: 'center',
        color: id === 'quit' && hit.hover ? RED : hit.hover ? HILITE : CANARY,
      });
      if (hit.click) this.press(id);
    }

    this.drawHelpLine(ctx, 306);
    if (this.sub === 'controls') this.drawControls(ctx);
    if (this.confirm) this.drawConfirm(ctx);
    this.pollPartyBar();
  }

  press(id) {
    this.sound('click');
    const s = this.session;
    switch (id) {
      case 'return': this.close(); break;
      case 'save': if (s.saveGame) s.saveGame(); this.status = 'Game saved.'; break;
      case 'load': if (s.loadGame) s.loadGame(); break;
      case 'controls': this.sub = 'controls'; break;
      case 'new': this.confirm = { text: 'Start a new game? Unsaved progress is lost.', act: 'new' }; break;
      case 'quit': this.confirm = { text: 'Quit to the title screen?', act: 'quit' }; break;
      default: break;
    }
  }

  /** Sound, light and input, one level down where the modern toggles belong. */
  drawControls(ctx) {
    const s = this.settings();
    const w = 340, h = 226;
    const x = px((PANEL.w - w) / 2), y = py(56);
    M.carvedPlate(ctx, x, y, w, h, { material: 'stone', seed: 41 });
    M.carvedWell(ctx, x + 6, y + 6, w - 12, h - 12, { material: 'stone', seed: 44 });
    F.drawText(ctx, 'Controls', x + w / 2, y + 14, { face: 'title', align: 'center', color: CANARY });

    SLIDERS.forEach(([key, label], i) => {
      const ry = y + 42 + i * 26;
      F.drawText(ctx, label, x + 20, ry, { face: 'small', color: WHITE });
      const tx = x + 150, tw = w - 176;
      const hit = this.ui.region(`${this.id}:sl:${key}`, tx - 4, ry - 6, tw + 8, 20, label);
      if (hit.down) this.drag = key;
      if (this.drag === key && this.ui.mouse.down) {
        const t = Math.max(0, Math.min(1, (this.ui.mouse.x - tx) / tw));
        if (Math.abs(t - s[key]) > 0.001) { s[key] = Math.round(t * 8) / 8; this.apply(); }
      }
      A.slider(ctx, tx, ry - 3, tw, s[key], hit.hover || this.drag === key);
    });

    CHECKS.forEach(([key, label], i) => {
      const ry = y + 152 + i * 20;
      const hit = this.ui.region(`${this.id}:ck:${key}`, x + 20, ry - 2, w - 40, 18, label);
      if (hit.click) { s[key] = !s[key]; this.apply(); this.sound('click'); }
      A.check(ctx, x + 20, ry - 1, s[key], hit.hover);
      F.drawText(ctx, label, x + 40, ry + 2, {
        face: 'small', color: hit.hover ? HILITE : WHITE,
      });
    });

    const bw = 100, bx = x + w - bw - 16, by = y + h - 34;
    const done = this.ui.region(`${this.id}:sub:done`, bx, by, bw, 26, 'Back');
    const d = A.button(ctx, bx, by, bw, 26, null, done.down ? 'down' : done.hover ? 'hot' : 'up');
    F.drawText(ctx, 'Done', bx + bw / 2 + d, by + 8 + d,
      { align: 'center', color: done.hover ? HILITE : CANARY });
    if (done.click) { this.sub = null; this.sound('click'); }
  }

  drawConfirm(ctx) {
    const w = 260, h = 84;
    const x = px((PANEL.w - w) / 2), y = py(120);
    M.carvedPlate(ctx, x, y, w, h, { material: 'wood', seed: 23 });
    M.carvedWell(ctx, x + 5, y + 5, w - 10, h - 10, { material: 'wood', seed: 27 });
    F.drawText(ctx, this.confirm.text, x + w / 2, y + 16,
      { face: 'small', align: 'center', color: CANARY, maxWidth: w - 24 });

    const mk = (id, label, bx) => {
      const hit = this.ui.region(`${this.id}:cf:${id}`, bx, y + h - 34, 80, 24, label);
      const d = A.button(ctx, bx, y + h - 34, 80, 24, null,
        hit.down ? 'down' : hit.hover ? 'hot' : 'up');
      F.drawText(ctx, label, bx + 40 + d, y + h - 34 + 7 + d,
        { align: 'center', color: hit.hover ? HILITE : CANARY });
      return hit.click;
    };
    if (mk('yes', 'Yes', x + 24)) {
      const s = this.session;
      if (this.confirm.act === 'new' && s.newGame) s.newGame();
      if (this.confirm.act === 'quit' && s.quitGame) s.quitGame();
      this.confirm = null;
      this.close();
    }
    if (mk('no', 'No', x + w - 104)) { this.confirm = null; this.sound('click'); }
  }
}

export default OptionsScreen;
