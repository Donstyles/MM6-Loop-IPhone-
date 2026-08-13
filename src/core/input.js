import { layout, toLogical, inView, inControls, mmToLogical } from './layout.js';

// ---------------------------------------------------------------------------
// Input.
//
// Desktop plays like MM6 with GrayFace's mouse-look: WASD moves, dragging in the
// 3D window looks around, left click attacks or interacts. On a phone the same
// verbs are driven by a virtual stick, a look-drag, and taps.
//
// Routing rule, learned the hard way: while any modal screen is open the UI has
// FIRST refusal on every pointer event across the whole window - look/stick
// capture only engages in the HUD-only state. The shell flips `uiModal` each
// frame; one frame of staleness is acceptable.
//
// In portrait mode the control zone under the frame carries the stick
// (lower-left), a look pad (lower-right) and the attack/interact keys between
// them, all sized to at least 7 mm from the live layout scale.
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
  attack: ['KeyF', 'ControlLeft', 'ControlRight'],
  cast: ['KeyV'],
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
    this.lookTouch = { active: false, id: -1, lx: 0, ly: 0, moved: 0, sx: 0, sy: 0 };

    // On-screen action keys (portrait control zone). id -> pressed pointerId.
    this.touchButtons = { attack: -1, interact: -1, inventory: -1, questlog: -1 };

    // Pointer events queued for the UI layer to consume this frame.
    this.uiEvents = [];
    // World clicks (in the 3D window) queued for the game to consume.
    this.worldEvents = [];

    this.pointer = { x: 0, y: 0, inView: false, down: false };
    this.mouseLook = false;
    /**
     * While a modal screen is open the whole window belongs to the UI: no
     * look capture, no stick, no world taps. Set by the shell every frame.
     */
    this.uiModal = false;
    // Show the movement stick from the first frame on a touch device rather
    // than waiting for a tap to reveal it.
    this.hasTouch = typeof navigator !== 'undefined'
      && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
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

  // --- on-screen control geometry -----------------------------------------

  /** Rect of the on-screen virtual stick, in logical coords. */
  get stickRect() {
    const c = layout.controls;
    if (c) {
      // Portrait: lower-left of the control zone, at least 7 mm of ring.
      const r = Math.max(46, mmToLogical(9));
      return { cx: c.x + layout.safe.left + r + 18, cy: c.y + c.h - r - 16, r };
    }
    const v = layout.view;
    // Landscape phone: the same 18 mm ring as portrait (it measured 12.4 mm
    // at the fixed 46px radius - mobile3 #6); desktop keeps the classic size.
    const r = this.hasTouch ? Math.max(46, mmToLogical(9)) : 46;
    // Landscape/desktop: lower-left of the 3D window, nudged inside the safe
    // inset so the ring is reachable past a notch.
    return { cx: v.x + layout.safe.left + r + 14, cy: v.y + v.h - r - 14, r };
  }

  /**
   * Look pad: the right-hand share of the portrait control zone, bottom
   * aligned with the stick so both thumbs rest at the same height on a tall
   * dead band.
   */
  get lookPadRect() {
    const c = layout.controls;
    if (!c) return null;
    const w = Math.round(c.w * 0.38);
    // Never taller than the band below the log + action-key rows: the grown
    // 3D window leaves a shorter band, and a pad that crept up over the key
    // row would capture their presses as look-drags.
    const keyS = Math.max(44, mmToLogical(7.5));
    const cap = c.h - (58 + keyS + 20);
    const h = Math.max(120, Math.min(c.h - 16, cap, Math.max(200, mmToLogical(45))));
    return {
      x: c.x + c.w - w - layout.safe.right - 8,
      y: c.y + c.h - h - 8,
      w, h,
    };
  }

  /** Attack / interact keys between the stick and the look pad (portrait),
   *  clustered at the stick's height so the thumb does not have to travel. */
  get touchButtonRects() {
    const c = layout.controls;
    if (!c) {
      // Landscape phone: ATTACK/USE stacked in the lower-right of the 3D
      // window, inside the safe insets. They did not exist at all here, which
      // made combat unreachable by touch (wowjudge landscape finding).
      // PACK/QUEST stand in a second column beside them: landscape had NO
      // touch path to the inventory or the quest log at all (iphone #3).
      if (!this.hasTouch) return [];
      const v = layout.view;
      const ls = Math.max(44, mmToLogical(8));
      const lgap = Math.max(8, mmToLogical(2));
      const lx = Math.round(v.x + v.w - ls - 12 - layout.safe.right);
      const ly = Math.round(v.y + v.h - ls - 12 - Math.max(0, layout.safe.bottom - (layout.h - (v.y + v.h))));
      const px = lx - ls - lgap;
      return [
        { id: 'attack', x: lx, y: ly - ls - lgap, w: ls, h: ls },
        { id: 'interact', x: lx, y: ly, w: ls, h: ls },
        { id: 'inventory', x: px, y: ly - ls - lgap, w: ls, h: ls },
        { id: 'questlog', x: px, y: ly, w: ls, h: ls },
      ];
    }
    const s = Math.max(44, mmToLogical(8));
    const sr = this.stickRect;
    const lp = this.lookPadRect;
    const left = sr.cx + sr.r + 14;
    const right = lp ? lp.x - 10 : c.x + c.w - 10;
    const cx = (left + right) / 2;
    const cy = sr.cy;
    const gap = Math.max(8, mmToLogical(2));
    return [
      { id: 'attack', x: Math.round(cx - s / 2), y: Math.round(cy - s - gap / 2), w: s, h: s },
      { id: 'interact', x: Math.round(cx - s / 2), y: Math.round(cy + gap / 2), w: s, h: s },
    ];
  }

  _touchButtonAt(x, y) {
    for (const b of this.touchButtonRects) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
    }
    return null;
  }

  // --- pointer routing ------------------------------------------------------

  _down(e) {
    if (e.pointerType === 'touch') this.hasTouch = true;
    const p = toLogical(e.clientX, e.clientY);
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.down = true;

    // A modal screen owns the whole window: every press is a UI press,
    // wherever it lands - including inside the (frozen) 3D view.
    if (this.uiModal) {
      this.uiEvents.push({ type: 'down', x: p.x, y: p.y, button: e.button, id: e.pointerId });
      e.preventDefault();
      return;
    }

    const btn = this.hasTouch ? this._touchButtonAt(p.x, p.y) : null;
    const sr = this.stickRect;
    const inStick = this.hasTouch &&
      (p.x - sr.cx) ** 2 + (p.y - sr.cy) ** 2 < (sr.r * 1.9) ** 2;
    const lp = this.lookPadRect;
    const inLookPad = lp && p.x >= lp.x && p.x < lp.x + lp.w && p.y >= lp.y && p.y < lp.y + lp.h;

    if (btn && this.touchButtons[btn.id] < 0) {
      this.touchButtons[btn.id] = e.pointerId;
      this.worldEvents.push({ type: 'button', id: btn.id });
      try { this.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else if (inStick && !this.stick.active) {
      this.stick.active = true; this.stick.id = e.pointerId;
      this.stick.ox = sr.cx; this.stick.oy = sr.cy;
      this.stick.x = p.x; this.stick.y = p.y;
      this._updateStick();
      try { this.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else if ((inView(p.x, p.y) || inLookPad) && !this.lookTouch.active) {
      this.lookTouch.active = true; this.lookTouch.id = e.pointerId;
      this.lookTouch.lx = p.x; this.lookTouch.ly = p.y;
      this.lookTouch.sx = p.x; this.lookTouch.sy = p.y;
      this.lookTouch.moved = 0;
      this.lookTouch.pad = !!inLookPad && !inView(p.x, p.y);
      this.mouseLook = true;
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
    let routed = false;
    for (const id of Object.keys(this.touchButtons)) {
      if (this.touchButtons[id] === e.pointerId) { this.touchButtons[id] = -1; routed = true; }
    }
    if (routed) {
      /* an on-screen key released; nothing else to do */
    } else if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.active = false; this.stick.dx = 0; this.stick.dy = 0;
    } else if (this.lookTouch.active && e.pointerId === this.lookTouch.id) {
      this.lookTouch.active = false;
      this.mouseLook = false;
      // A drag that barely moved is a tap: attack / interact with the world.
      // Taps that started on the look pad are looks, not world taps.
      if (this.lookTouch.moved < 8 && !this.lookTouch.pad) {
        this.worldEvents.push({ type: 'tap', x: this.lookTouch.sx, y: this.lookTouch.sy, button: e.button });
      }
    } else {
      this.uiEvents.push({ type: 'up', x: p.x, y: p.y, button: e.button, id: e.pointerId });
    }
    // A lifted finger is gone: park the virtual pointer off-screen so hover
    // rects and tooltips do not fossilise under the last touch point.
    if (e.pointerType === 'touch') {
      this.pointer.x = -4096; this.pointer.y = -4096;
      this.pointer.inView = false;
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
      // `_updateStick` already normalises the deflection to 0..1 against the
      // ring radius. Dividing by the radius a second time here scaled a full
      // tilt down to 1/46 of walk speed - about 8 units a second - so the
      // on-screen stick moved the party at a crawl and read as decorative.
      fwd += -this.stick.dy;
      str += this.stick.dx;
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
