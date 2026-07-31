import { layout, toLogical, inView } from './layout.js';

// ---------------------------------------------------------------------------
// Input.
//
// Desktop plays like MM6 with GrayFace's mouse-look: WASD moves, dragging in the
// 3D window looks around, left click attacks or interacts. On a phone the same
// verbs are driven by a virtual stick in the lower-left of the 3D window, a
// look-drag anywhere else in it, and taps on the HUD.
// ---------------------------------------------------------------------------

export const KEY_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  strafeLeft: ['KeyA', 'Comma'],
  strafeRight: ['KeyD', 'Period'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['Enter', 'KeyE'],
  attack: ['KeyA'],
  cast: ['KeyC'],
  rest: ['KeyR'],
  quickRef: ['KeyZ'],
  charSheet: ['KeyC'],
  inventory: ['KeyI'],
  spellbook: ['KeyB'],
  map: ['KeyM'],
  quests: ['KeyQ'],
  turnBased: ['Enter'],
  lookUp: ['PageUp'],
  lookDown: ['PageDown'],
  centerView: ['Home'],
  char1: ['Digit1'], char2: ['Digit2'], char3: ['Digit3'], char4: ['Digit4'],
  escape: ['Escape'],
  yell: ['KeyY'],
};

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();

    // Look deltas accumulated since the last frame, in radians.
    this.lookDX = 0;
    this.lookDY = 0;

    // Virtual stick state (touch).
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
    this.lookTouch = { active: false, id: -1, lx: 0, ly: 0, moved: 0 };

    // Pointer events queued for the UI layer to consume this frame.
    this.uiEvents = [];
    // World clicks (in the 3D window) queued for the game to consume.
    this.worldEvents = [];

    this.pointer = { x: 0, y: 0, inView: false, down: false };
    this.mouseLook = false;
    this.hasTouch = false;
    this.wheel = 0;

    this._bind();
  }

  _bind() {
    const t = this.target;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Let the browser keep its own shortcuts; swallow the game's keys.
      if (!e.metaKey && !e.ctrlKey) e.preventDefault();
      this.keys.add(e.code);
      this.justPressed.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.justReleased.add(e.code);
    });
    addEventListener('blur', () => this.keys.clear());

    t.addEventListener('contextmenu', (e) => e.preventDefault());

    t.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
    t.addEventListener('pointermove', (e) => this._move(e), { passive: false });
    t.addEventListener('pointerup', (e) => this._up(e), { passive: false });
    t.addEventListener('pointercancel', (e) => this._up(e), { passive: false });
    t.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  /** Rect of the on-screen virtual stick, in logical coords. */
  get stickRect() {
    const v = layout.view;
    const r = 46;
    return { cx: v.x + r + 14, cy: v.y + v.h - r - 14, r };
  }

  _down(e) {
    if (e.pointerType === 'touch') this.hasTouch = true;
    const p = toLogical(e.clientX, e.clientY);
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.down = true;

    if (inView(p.x, p.y)) {
      const sr = this.stickRect;
      const inStick = this.hasTouch &&
        (p.x - sr.cx) ** 2 + (p.y - sr.cy) ** 2 < (sr.r * 1.9) ** 2;
      if (inStick && !this.stick.active) {
        this.stick.active = true; this.stick.id = e.pointerId;
        this.stick.ox = sr.cx; this.stick.oy = sr.cy;
        this.stick.x = p.x; this.stick.y = p.y;
        this._updateStick();
      } else if (!this.lookTouch.active) {
        this.lookTouch.active = true; this.lookTouch.id = e.pointerId;
        this.lookTouch.lx = p.x; this.lookTouch.ly = p.y;
        this.lookTouch.moved = 0;
        this.mouseLook = true;
      }
      try { this.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else {
      this.uiEvents.push({ type: 'down', x: p.x, y: p.y, button: e.button, id: e.pointerId });
    }
    e.preventDefault();
  }

  _move(e) {
    const p = toLogical(e.clientX, e.clientY);
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.inView = inView(p.x, p.y);

    if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.x = p.x; this.stick.y = p.y;
      this._updateStick();
    } else if (this.lookTouch.active && e.pointerId === this.lookTouch.id) {
      const dx = p.x - this.lookTouch.lx, dy = p.y - this.lookTouch.ly;
      this.lookTouch.lx = p.x; this.lookTouch.ly = p.y;
      this.lookTouch.moved += Math.abs(dx) + Math.abs(dy);
      // ~0.0045 rad per logical pixel gives MM6-ish turn speed at 640 wide.
      this.lookDX += dx * 0.0045;
      this.lookDY += dy * 0.0040;
    } else {
      this.uiEvents.push({ type: 'move', x: p.x, y: p.y, id: e.pointerId });
    }
    e.preventDefault();
  }

  _up(e) {
    const p = toLogical(e.clientX, e.clientY);
    this.pointer.down = false;
    if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.active = false; this.stick.dx = 0; this.stick.dy = 0;
    } else if (this.lookTouch.active && e.pointerId === this.lookTouch.id) {
      this.lookTouch.active = false;
      this.mouseLook = false;
      // A drag that barely moved is a tap: attack / interact with the world.
      if (this.lookTouch.moved < 8) {
        this.worldEvents.push({ type: 'tap', x: p.x, y: p.y, button: e.button });
      }
    } else {
      this.uiEvents.push({ type: 'up', x: p.x, y: p.y, button: e.button, id: e.pointerId });
    }
    try { this.target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  }

  _updateStick() {
    const sr = this.stickRect;
    let dx = this.stick.x - sr.cx, dy = this.stick.y - sr.cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / sr.r) / len;
    this.stick.dx = dx * k;
    this.stick.dy = dy * k;
  }

  // --- query -------------------------------------------------------------
  down(action) {
    const codes = KEY_BINDS[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(action) {
    const codes = KEY_BINDS[action];
    if (!codes) return false;
    for (const c of codes) if (this.justPressed.has(c)) return true;
    return false;
  }

  /** Movement axes in [-1,1]: forward positive, strafe right positive. */
  axes() {
    let fwd = 0, str = 0, turn = 0;
    if (this.down('forward')) fwd += 1;
    if (this.down('back')) fwd -= 1;
    if (this.down('strafeRight')) str += 1;
    if (this.down('strafeLeft')) str -= 1;
    if (this.down('turnRight')) turn += 1;
    if (this.down('turnLeft')) turn -= 1;
    if (this.stick.active) {
      const sr = this.stickRect;
      fwd += -this.stick.dy / sr.r;
      str += this.stick.dx / sr.r;
    }
    return {
      forward: Math.max(-1, Math.min(1, fwd)),
      strafe: Math.max(-1, Math.min(1, str)),
      turn: Math.max(-1, Math.min(1, turn)),
    };
  }

  /** Consume accumulated look delta. */
  takeLook() {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return d;
  }

  takeUiEvents() { const e = this.uiEvents; this.uiEvents = []; return e; }
  takeWorldEvents() { const e = this.worldEvents; this.worldEvents = []; return e; }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
  }
}
