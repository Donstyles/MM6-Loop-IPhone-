// ---------------------------------------------------------------------------
// A tiny immediate-mode UI layer.
//
// Every MM6 screen is a static painted panel with a handful of hot rectangles,
// so an immediate-mode kit is a much better fit than a retained widget tree:
// each screen just draws itself and asks "was this rect clicked?".
//
// Screens draw into a plain 2D canvas at logical 1:1 pixels. Nothing here
// antialiases, scales or animates - the browser scales the whole frame at the
// end, so the UI stays pixel-exact at any device resolution.
// ---------------------------------------------------------------------------

export class UIContext {
  constructor() {
    this.ctx = null;
    this.mouse = { x: -1, y: -1, down: false, clicked: false, rightClicked: false, wheel: 0 };
    this.hot = null;        // id of the rect under the cursor
    this.active = null;     // id being pressed
    this.hoverText = null;  // tooltip / status line text for this frame
    this.cursorItem = null; // item being dragged on the cursor
    this._pressStart = null;
    this.consumed = false;
  }

  beginFrame(ctx, pointer, events) {
    this.ctx = ctx;
    this.hot = null;
    this.hoverText = null;
    this.consumed = false;
    this.mouse.x = pointer.x;
    this.mouse.y = pointer.y;
    this.mouse.clicked = false;
    this.mouse.rightClicked = false;

    for (const e of events) {
      if (e.type === 'down') {
        this.mouse.down = true;
        this._pressStart = { x: e.x, y: e.y, button: e.button };
        this.mouse.x = e.x; this.mouse.y = e.y;
      } else if (e.type === 'up') {
        this.mouse.down = false;
        this.mouse.x = e.x; this.mouse.y = e.y;
        if (this._pressStart) {
          const near = Math.abs(e.x - this._pressStart.x) < 6 && Math.abs(e.y - this._pressStart.y) < 6;
          if (near) {
            if (this._pressStart.button === 2) this.mouse.rightClicked = true;
            else this.mouse.clicked = true;
          }
        }
        this._pressStart = null;
        this.active = null;
      } else if (e.type === 'move') {
        this.mouse.x = e.x; this.mouse.y = e.y;
      }
    }
  }

  endFrame() {
    this.mouse.clicked = false;
    this.mouse.rightClicked = false;
    this.mouse.wheel = 0;
  }

  inRect(x, y, w, h) {
    return this.mouse.x >= x && this.mouse.x < x + w && this.mouse.y >= y && this.mouse.y < y + h;
  }

  /**
   * Register a hot rectangle. Returns the interaction result for this frame.
   * @returns {{hover:boolean, down:boolean, click:boolean, rightClick:boolean}}
   */
  region(id, x, y, w, h, tip = null) {
    const hover = this.inRect(x, y, w, h);
    if (hover) {
      this.hot = id;
      if (tip) this.hoverText = tip;
    }
    const down = hover && this.mouse.down;
    const click = hover && this.mouse.clicked && !this.consumed;
    const rightClick = hover && this.mouse.rightClicked && !this.consumed;
    if (click || rightClick) this.consumed = true;
    return { hover, down, click, rightClick };
  }
}

/** Scrollable list state, kept by the owning screen across frames. */
export class ListState {
  constructor() { this.scroll = 0; this.selected = -1; }
  clampTo(count, visible) {
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, count - visible)));
  }
}

/** Simple modal/stack manager for the full-screen panels. */
export class ScreenStack {
  constructor() { this.stack = []; }
  get top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
  get isOpen() { return this.stack.length > 0; }
  push(screen) {
    if (this.top && this.top.onBlur) this.top.onBlur();
    this.stack.push(screen);
    if (screen.onOpen) screen.onOpen();
  }
  pop() {
    const s = this.stack.pop();
    if (s && s.onClose) s.onClose();
    if (this.top && this.top.onFocus) this.top.onFocus();
    return s;
  }
  replace(screen) { while (this.stack.length) this.pop(); this.push(screen); }
  clear() { while (this.stack.length) this.pop(); }
  /** Toggle: if this screen type is already on top, close it. */
  toggle(screen, id) {
    if (this.top && this.top.id === id) { this.pop(); return false; }
    this.clear();
    this.push(screen);
    return true;
  }
}

/** Fixed-duration transition helper (fades between maps and screens). */
export class Transition {
  constructor() { this.t = 0; this.dur = 0; this.phase = 'idle'; this.cb = null; }
  start(dur, cb) { this.dur = dur; this.t = 0; this.phase = 'out'; this.cb = cb; }
  update(dt) {
    if (this.phase === 'idle') return;
    this.t += dt;
    if (this.phase === 'out' && this.t >= this.dur) {
      this.t = 0; this.phase = 'in';
      if (this.cb) { const c = this.cb; this.cb = null; c(); }
    } else if (this.phase === 'in' && this.t >= this.dur) {
      this.phase = 'idle';
    }
  }
  /** 1 = fully visible, 0 = fully black. */
  get alpha() {
    if (this.phase === 'idle') return 1;
    const k = Math.min(1, this.t / this.dur);
    return this.phase === 'out' ? 1 - k : k;
  }
  get busy() { return this.phase !== 'idle'; }
}

/** Rolling message log shown above the bottom bar, as MM6 does. */
export class MessageLog {
  constructor(max = 60) { this.lines = []; this.max = max; }
  add(text, color = null, ttl = 6) {
    this.lines.push({ text, color, t: 0, ttl });
    while (this.lines.length > this.max) this.lines.shift();
  }
  update(dt) { for (const l of this.lines) l.t += dt; }
  recent(n = 4) {
    const out = [];
    for (let i = this.lines.length - 1; i >= 0 && out.length < n; i--) {
      if (this.lines[i].t < this.lines[i].ttl) out.unshift(this.lines[i]);
    }
    return out;
  }
}
