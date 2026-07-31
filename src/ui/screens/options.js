// ---------------------------------------------------------------------------
// Game options (the Esc menu).
//
// MM6's menu is six big stone buttons in two columns over the panel; the
// sliders and toggles that live in its sub-dialogs are folded into the top half
// here, because a phone player should not have to walk two menus deep to turn
// the music down. Values are written straight into `session.settings` and
// `session.applySettings()` is called so the shell can react immediately.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import {
  Screen, A, PANEL, px, py, WHITE, CANARY, HILITE, DIM, RED,
} from './screenbase.js';

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
};

const SLIDERS = [
  ['soundVolume', 'Sound Volume'],
  ['musicVolume', 'Music Volume'],
  ['gamma', 'Brightness'],
  ['viewDistance', 'View Distance'],
];

const CHECKS = [
  ['alwaysRun', 'Always Run'],
  ['turnBasedDefault', 'Turn-Based by Default'],
  ['touchControls', 'Touch Controls'],
];

export class OptionsScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'options';
    this.confirm = null;
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
    const s = this.settings();

    F.drawText(ctx, 'Game Options', px(PANEL.w / 2), py(12),
      { face: 'title', align: 'center', color: CANARY });
    A.rule(ctx, px(19), py(32), PANEL.w - 38, '#8a8272', 0.5);

    // --- sliders, left column
    SLIDERS.forEach(([key, label], i) => {
      const y = 42 + i * 27;
      const x = 19, w = BTN_W;
      F.drawText(ctx, label, px(x), py(y), { face: 'small', color: WHITE });
      F.drawText(ctx, `${Math.round(s[key] * 100)}%`, px(x + w), py(y),
        { face: 'small', align: 'right', color: CANARY });
      const tx = px(x), ty = py(y + 11);
      const hit = this.ui.region(`${this.id}:sl:${key}`, tx - 2, ty - 4, w + 4, 16, label);
      if (hit.down) this.drag = key;
      if (this.drag === key && this.ui.mouse.down) {
        const t = Math.max(0, Math.min(1, (this.ui.mouse.x - tx) / w));
        if (Math.abs(t - s[key]) > 0.001) { s[key] = Math.round(t * 20) / 20; this.apply(); }
      }
      A.slider(ctx, tx, ty, w, s[key], hit.hover || this.drag === key);
    });

    // --- toggles, right column
    CHECKS.forEach(([key, label], i) => {
      const y = 44 + i * 27;
      const x = 241;
      const hit = this.ui.region(`${this.id}:ck:${key}`, px(x), py(y - 2), BTN_W, 18, label);
      if (hit.click) { s[key] = !s[key]; this.apply(); this.sound('click'); }
      A.check(ctx, px(x), py(y), s[key], hit.hover);
      F.drawText(ctx, label, px(x + 18), py(y + 2), {
        face: 'small', color: hit.hover ? HILITE : WHITE,
      });
    });

    F.drawText(ctx, this.session.saveName || 'No save slot in use', px(241), py(128),
      { face: 'small', color: DIM });
    A.rule(ctx, px(19), py(146), PANEL.w - 38, '#8a8272', 0.5);

    // --- the six buttons
    for (const [id, label, bx, by] of BUTTONS) {
      const x = px(bx), y = py(by);
      const hit = this.ui.region(`${this.id}:b:${id}`, x, y, BTN_W, BTN_H, label);
      A.button(ctx, x, y, BTN_W, BTN_H, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, (x + BTN_W / 2) | 0, (y + (BTN_H - 12) / 2) | 0, {
        face: 'title', align: 'center',
        color: id === 'quit' && hit.hover ? RED : hit.hover ? HILITE : CANARY,
      });
      if (hit.click) this.press(id);
    }

    this.drawHelpLine(ctx, 306);
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
      case 'controls': this.status = 'Controls: WASD move, mouse look, C sheet, Q quick reference.'; break;
      case 'new': this.confirm = { text: 'Start a new game? Unsaved progress is lost.', act: 'new' }; break;
      case 'quit': this.confirm = { text: 'Quit to the title screen?', act: 'quit' }; break;
      default: break;
    }
  }

  drawConfirm(ctx) {
    const w = 260, h = 84;
    const x = px((PANEL.w - w) / 2), y = py(120);
    A.stone(ctx, x, y, w, h, { rivets: true });
    A.bevel(ctx, x, y, w, h, {});
    F.drawText(ctx, this.confirm.text, x + w / 2, y + 16,
      { face: 'small', align: 'center', color: CANARY, maxWidth: w - 16 });

    const mk = (id, label, bx) => {
      const hit = this.ui.region(`${this.id}:cf:${id}`, bx, y + h - 32, 80, 24, label);
      A.button(ctx, bx, y + h - 32, 80, 24, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, bx + 40, y + h - 32 + 7,
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
