// ---------------------------------------------------------------------------
// Full-screen panel base class and the chrome every panel shares.
//
// MM6's "full-screen" panels are not full screen: each one paints a 461 x 345
// page at (8, 8) that exactly replaces the 3D viewport, leaving the carved
// border, the 172-px right panel and the bottom party bar visible and live
// around it. Panels therefore never clear the frame and never draw the bar -
// the shell's HUD is still underneath.
//
// The art helpers in uiart.js are written by another owner and land piecemeal,
// so every call that is not already proven by hud.js goes through `A.*`, which
// latches a failure once and falls back to a locally drawn equivalent. A missing
// or renamed helper degrades into a plainer panel instead of a black screen.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import * as F from '../../art/font.js';
import * as UI from '../../art/uiart.js';
import * as PORTRAITS from '../../art/portraits.js';
import { mulberry32 } from '../../core/rng.js';
import { rampCss } from '../../core/palette.js';

// --- geometry ---------------------------------------------------------------

/** The panel page. Every screen lays out relative to this origin. */
export const PANEL = { x: 8, y: 8, w: 461, h: 345 };

/** The right-hand column. The sheet and the inventory paint a paperdoll here. */
export const SIDE = { x: 468, y: 0, w: 172, h: 352 };

/** MM6 puts the tab row and Exit on the same baseline, panel-relative y = 316. */
export const TAB_Y = 316;
export const TAB_H = 24;
export const TAB_W = 86;
export const TAB_X = [20, 110, 200, 290];
export const EXIT_X = 379;
export const EXIT_W = 70;

/** Panel-relative -> absolute. */
export function px(x) { return PANEL.x + x; }
export function py(y) { return PANEL.y + y; }

export function exitRect() {
  return { x: px(EXIT_X), y: py(TAB_Y), w: EXIT_W, h: TAB_H };
}

// --- ink --------------------------------------------------------------------
// MM6's UI palette, taken from the decompiled colour table.

export const WHITE = '#ffffff';                       // default UI text
export const HILITE = F.TEXT_HILITE || '#e1cd23';     // hovered / clickable: gold
export const CANARY = '#ffff9b';                      // headers, tooltips
export const GREEN = '#00e100';                       // buffed above base
export const SCARLET = '#ff2300';                     // drained below base
export const RED = '#ff0000';                         // broken / severe
export const BOLT = '#00afff';                        // learnable skill
export const BOOK_INK = '#4b4b4b';                    // body text on a book page
export const DIM = '#9a9a9a';

/** Award / title text cycles through MM6's six pastels. */
export const PASTELS = ['#f86ca0', '#70dcf8', '#c0c0f0', '#40f460', '#e8f460', '#f0fcc0'];

/** Indoor automap palette. */
export const MAP_NAVY = '#000078';
export const MAP_WALL = '#0000ff';
export const MAP_FRIEND = '#00e100';
export const MAP_HOSTILE = '#ff0000';
export const MAP_CORPSE = '#ffff00';
export const MAP_DECOR = '#ffffff';
export const MAP_TREASURE = '#0000ff';

/** Per-school tint for the spellbook tabs, glyphs and page wash. */
export const SCHOOL_COLORS = {
  fire: '#e05a1e', air: '#9fd8ff', water: '#3f7ad8', earth: '#7a8c3a',
  spirit: '#ffd84a', mind: '#c078e8', body: '#4ec44e', light: '#fff0b0',
  dark: '#6a4a8c',
};

// --- guarded art ------------------------------------------------------------

const _broken = new Set();
const _cache = new Map();

function guard(name, fn, fallback) {
  if (_broken.has(name)) return fallback();
  try {
    return fn();
  } catch (e) {
    _broken.add(name);
    return fallback();
  }
}

function scratch(key, w, h, paint) {
  let c = _cache.get(key);
  if (c && c.width === w && c.height === h) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  paint(g, c.width, c.height);
  _cache.set(key, c);
  return c;
}

/** Deterministic speckled fill used by every fallback surface. */
function speckleFill(g, w, h, ramp, lo, hi, seed) {
  const rnd = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g.fillStyle = rampCss(ramp, lo + (hi - lo) * rnd()), g.fillRect(x, y, 1, 1);
  }
}

function parchmentPainter(lo, hi, seed) {
  return (g, w, h) => {
    speckleFill(g, w, h, 'sand', lo, hi, seed);
    const rnd = mulberry32(seed ^ 0x51ed);
    for (let i = 0; i < Math.max(20, (w * h) / 1400); i++) {
      const bx = (rnd() * w) | 0, by = (rnd() * h) | 0, br = 4 + ((rnd() * 14) | 0);
      g.globalAlpha = 0.09;
      g.fillStyle = rampCss('dirt', 6);
      g.fillRect(bx - br, by - (br >> 1), br * 2, br);
    }
    g.globalAlpha = 1;
    g.fillStyle = rampCss('dirt', 3);
    g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1);
    g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h);
  };
}

function fbStone(g, w, h) {
  speckleFill(g, w, h, 'stone', 4.2, 6.4, 0xbeef01);
  g.fillStyle = rampCss('stone', 9); g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  g.fillStyle = rampCss('stone', 1); g.fillRect(0, h - 1, w, 1); g.fillRect(w - 1, 0, 1, h);
}

/**
 * Every surface/widget the panels need, each with a locally drawn fallback.
 * Signatures follow hud.js wherever hud.js already proves them.
 */
export const A = {
  stone(ctx, x, y, w, h, opts) {
    guard('stone', () => UI.drawStonePanel(ctx, x | 0, y | 0, w | 0, h | 0, opts || {}),
      () => ctx.drawImage(scratch(`st${w}x${h}`, w, h, fbStone), x | 0, y | 0));
  },
  /** `tone`: 'sheet' is MM6's dark leather sheet, 'page' the pale book page. */
  parchment(ctx, x, y, w, h, opts) {
    const tone = (opts && opts.tone) || 'page';
    guard('parchment', () => {
      const c = UI.parchment(w | 0, h | 0, opts || {});
      if (!c || !c.width) throw new Error('no parchment');
      ctx.drawImage(c, x | 0, y | 0);
      if (tone === 'sheet') {
        // Darken whatever we were given: MM6's sheet is tooled leather, and the
        // values on it print white.
        ctx.globalAlpha = 0.42; ctx.fillStyle = '#1a1208';
        ctx.fillRect(x | 0, y | 0, w | 0, h | 0); ctx.globalAlpha = 1;
      }
    }, () => {
      const key = `pa${tone}${w}x${h}`;
      const paint = tone === 'sheet' ? parchmentPainter(5.2, 7.4, 0x5eed01) : parchmentPainter(10.6, 12.8, 0x5eed01);
      ctx.drawImage(scratch(key, w, h, paint), x | 0, y | 0);
    });
  },
  /** An open book page. `side` is 'left'|'right' so the spine shades inward. */
  book(ctx, x, y, w, h, side) {
    guard('book', () => {
      const c = UI.bookPage(w | 0, h | 0, side || 'left');
      if (!c || !c.width) throw new Error('no page');
      ctx.drawImage(c, x | 0, y | 0);
    }, () => {
      ctx.drawImage(scratch(`bk${w}x${h}`, w, h, parchmentPainter(11.2, 13.2, 0x7a11)), x | 0, y | 0);
    });
    // Shade towards the spine either way: it is what makes it read as a book.
    const inner = side === 'right' ? x : x + w - 10;
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = 0.16 * (1 - i / 10);
      ctx.fillStyle = '#2a1c0a';
      ctx.fillRect(((side === 'right' ? inner + i : inner + 9 - i)) | 0, y | 0, 1, h | 0);
    }
    ctx.globalAlpha = 1;
  },
  bevel(ctx, x, y, w, h, opts) {
    guard('bevel', () => UI.drawBevel(ctx, x | 0, y | 0, w | 0, h | 0, opts || {}), () => {
      const sunken = opts && opts.sunken;
      ctx.fillStyle = rampCss('stone', sunken ? 1 : 10);
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = rampCss('stone', sunken ? 10 : 1);
      ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
    });
  },
  inset(ctx, x, y, w, h) {
    guard('inset', () => UI.drawInset(ctx, x | 0, y | 0, w | 0, h | 0), () => {
      ctx.fillStyle = '#12100c';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      A.bevel(ctx, x, y, w, h, { sunken: true, size: 2 });
    });
  },
  frame(ctx, x, y, w, h, opts) {
    guard('frame', () => UI.drawFrame(ctx, x | 0, y | 0, w | 0, h | 0, opts || {}), () => {
      ctx.fillStyle = rampCss('wood', 6);
      ctx.fillRect(x, y, w, 3); ctx.fillRect(x, y + h - 3, w, 3);
      ctx.fillRect(x, y, 3, h); ctx.fillRect(x + w - 3, y, 3, h);
      A.bevel(ctx, x, y, w, h, {});
    });
  },
  divider(ctx, x, y, w) {
    guard('divider', () => UI.drawDivider(ctx, x | 0, y | 0, w | 0), () => {
      ctx.fillStyle = rampCss('wood', 4); ctx.fillRect(x, y, w, 1);
      ctx.fillStyle = rampCss('sand', 13); ctx.fillRect(x, y + 1, w, 1);
    });
  },
  /** Thin ruled line for pages and sheets. */
  rule(ctx, x, y, w, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 0.45 : alpha;
    ctx.fillStyle = color || '#6b5636';
    ctx.fillRect(x | 0, y | 0, w | 0, 1);
    ctx.globalAlpha = 1;
  },
  button(ctx, x, y, w, h, label, state) {
    guard('button', () => UI.drawButton(ctx, x | 0, y | 0, w | 0, h | 0, null, state || 'up'), () => {
      ctx.fillStyle = rampCss('stone', state === 'down' ? 4 : 6);
      ctx.fillRect(x, y, w, h);
      A.bevel(ctx, x, y, w, h, { sunken: state === 'down' });
      ctx.fillStyle = rampCss('stone', state === 'down' ? 3 : 7);
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    });
    if (label) {
      const d = state === 'down' ? 1 : 0;
      F.drawText(ctx, label, (x + w / 2 + d) | 0, (y + (h - 10) / 2 + d) | 0, {
        align: 'center', color: state === 'hot' ? HILITE : CANARY,
      });
    }
  },
  icon(ctx, name, x, y, size) {
    guard('icon', () => UI.drawIcon(ctx, name, x | 0, y | 0, size | 0), () => {
      ctx.fillStyle = rampCss('grey', 7);
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.fillStyle = rampCss('grey', 3);
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    });
  },
  statBar(ctx, x, y, w, h, frac, kind) {
    guard('statBar', () => UI.drawStatBar(ctx, x | 0, y | 0, w | 0, h | 0, frac, kind), () => {
      ctx.fillStyle = '#100c08'; ctx.fillRect(x, y, w, h);
      const f = Math.max(0, Math.min(1, frac));
      ctx.fillStyle = kind === 'sp' ? '#3060d0' : f > 0.5 ? '#00c000' : f > 0.25 ? '#d0d000' : '#d02000';
      ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * f), h - 2);
    });
  },
  portraitFrame(ctx, x, y, w, h, state) {
    guard('portraitFrame', () => UI.drawPortraitFrame(ctx, x | 0, y | 0, w | 0, h | 0, state || 'normal'),
      () => A.bevel(ctx, x - 1, y - 1, w + 2, h + 2, { sunken: true }));
  },
  check(ctx, x, y, on, hot) {
    guard('check', () => UI.drawCheck(ctx, x | 0, y | 0, !!on, !!hot), () => {
      ctx.fillStyle = '#0e0c08'; ctx.fillRect(x, y, 12, 12);
      A.bevel(ctx, x, y, 12, 12, { sunken: true });
      if (on) {
        ctx.fillStyle = hot ? HILITE : CANARY;
        for (let i = 0; i < 5; i++) ctx.fillRect(x + 2 + i, y + 6 + (i < 2 ? i : 4 - i), 2, 2);
      }
    });
  },
  slider(ctx, x, y, w, t, hot) {
    guard('slider', () => UI.drawSlider(ctx, x | 0, y | 0, w | 0, t, !!hot), () => {
      const cy = y + 5;
      ctx.fillStyle = '#0e0c08'; ctx.fillRect(x, cy - 1, w, 4);
      A.bevel(ctx, x, cy - 1, w, 4, { sunken: true });
      // Notches, the way MM6's volume sliders are stepped.
      ctx.fillStyle = rampCss('stone', 8);
      for (let i = 0; i <= 8; i++) ctx.fillRect((x + (w - 2) * (i / 8)) | 0, cy + 4, 1, 3);
      const kx = (x + Math.round((w - 9) * Math.max(0, Math.min(1, t)))) | 0;
      ctx.fillStyle = rampCss('gold', hot ? 12 : 9);
      ctx.fillRect(kx, y - 2, 9, 14);
      A.bevel(ctx, kx, y - 2, 9, 14, {});
    });
  },
  /** Wooden scrollbar. The caller owns the hit testing. */
  scrollbar(ctx, x, y, h, t, frac) {
    guard('scrollbar', () => UI.drawScrollbar(ctx, x | 0, y | 0, h | 0, t, frac), () => {
      ctx.fillStyle = rampCss('wood', 3);
      ctx.fillRect(x, y, 10, h);
      A.bevel(ctx, x, y, 10, h, { sunken: true });
      const gh = Math.max(14, Math.round(h * Math.max(0.06, Math.min(1, frac))));
      const gy = (y + (h - gh) * Math.max(0, Math.min(1, t))) | 0;
      ctx.fillStyle = rampCss('wood', 9);
      ctx.fillRect(x + 1, gy, 8, gh);
      A.bevel(ctx, x + 1, gy, 8, gh, {});
      ctx.fillStyle = rampCss('wood', 6);
      ctx.fillRect(x + 2, gy + (gh >> 1) - 2, 6, 1);
      ctx.fillRect(x + 2, gy + (gh >> 1) + 1, 6, 1);
    });
  },
  gem(ctx, x, y, size, color) {
    guard('gem', () => UI.drawGem(ctx, x | 0, y | 0, size | 0, color), () => {
      const r = size / 2;
      ctx.fillStyle = color || '#c04040';
      for (let i = 0; i < size; i++) {
        const k = Math.round(r - Math.abs(i - r + 0.5));
        ctx.fillRect((x + r - k) | 0, y + i, k * 2, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + ((r - 1) | 0), y + 2, 1, 1);
    });
  },
  corner(ctx, x, y, size, which) {
    guard('corner', () => UI.drawCorner(ctx, x | 0, y | 0, size | 0, which), () => {
      ctx.fillStyle = rampCss('gold', 8);
      const sx = which === 'tr' || which === 'br' ? -1 : 1;
      const sy = which === 'bl' || which === 'br' ? -1 : 1;
      const ox = which === 'tr' || which === 'br' ? x + size - 1 : x;
      const oy = which === 'bl' || which === 'br' ? y + size - 1 : y;
      for (let i = 0; i < size; i++) {
        ctx.fillRect(ox + sx * i, oy, 1, 1);
        ctx.fillRect(ox, oy + sy * i, 1, 1);
      }
      ctx.fillRect(ox + sx * 2, oy + sy * 2, 2, 2);
    });
  },
  filigree(ctx, x, y, w) {
    guard('filigree', () => UI.drawGoldFiligree(ctx, x | 0, y | 0, w | 0), () => {
      ctx.fillStyle = rampCss('gold', 9);
      for (let i = 0; i < w; i += 4) ctx.fillRect(x + i, y + (i % 8 === 0 ? 0 : 1), 2, 1);
    });
  },
  scrollEnds(ctx, x, y, w, h) {
    guard('scrollEnds', () => UI.drawScrollEnds(ctx, x | 0, y | 0, w | 0, h | 0), () => {
      ctx.fillStyle = rampCss('wood', 7);
      ctx.fillRect(x - 4, y - 6, w + 8, 6);
      ctx.fillRect(x - 4, y + h, w + 8, 6);
      ctx.fillStyle = rampCss('wood', 3);
      ctx.fillRect(x - 4, y - 1, w + 8, 1);
      ctx.fillRect(x - 4, y + h, w + 8, 1);
    });
  },
};

/** Portrait canvas for a character, or null if the art module is not ready. */
export function portraitOf(ch, expression) {
  if (!ch) return null;
  return guard('portrait', () => PORTRAITS.getPortrait(ch.portraitSeed || 1,
    { sex: ch.sex, klass: ch.class || ch.klass }, expression || 'normal'), () => null);
}
export const PW = PORTRAITS.PORTRAIT_W || 90;
export const PH = PORTRAITS.PORTRAIT_H || 78;

// --- text -------------------------------------------------------------------

/** Word wrap that prefers the real helper but never depends on it. */
export function wrapLines(text, maxW, face = 'small') {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  const real = guard('wrap', () => {
    const r = F.wrapText(s, maxW, face);
    return Array.isArray(r) ? r : null;
  }, () => null);
  if (real) return real;
  const out = [];
  for (const para of s.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (F.measure(test, face).w > maxW && line) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

/** Draw wrapped text; returns the y just past the last line. */
export function drawWrapped(ctx, text, x, y, maxW, opts = {}) {
  const face = opts.face || 'small';
  const lh = opts.lineHeight || (face === 'small' ? 10 : face === 'title' ? 18 : 12);
  const lines = wrapLines(text, maxW, face);
  const limit = opts.maxLines || 999;
  for (let i = 0; i < lines.length && i < limit; i++) {
    F.drawText(ctx, lines[i], x | 0, (y + i * lh) | 0, opts);
  }
  return y + Math.min(lines.length, limit) * lh;
}

/** `Label ........ value`, the MM6 dotted-leader row. */
export function leaderRow(ctx, label, value, x, y, w, opts = {}) {
  const face = opts.face || 'small';
  const color = opts.color || WHITE;
  const vcolor = opts.valueColor || color;
  F.drawText(ctx, label, x, y, { face, color });
  const lw = F.measure(label, face).w;
  const vw = F.measure(value, face).w;
  const dotStart = x + lw + 3;
  const dotEnd = x + w - vw - 3;
  if (opts.dots !== false && dotEnd > dotStart) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    for (let dx = dotStart; dx < dotEnd; dx += 3) ctx.fillRect(dx | 0, (y + 6) | 0, 1, 1);
    ctx.globalAlpha = 1;
  }
  F.drawText(ctx, value, (x + w) | 0, y, { face, color: vcolor, align: 'right' });
}

// --- tabs -------------------------------------------------------------------

/**
 * The panel's chapter tabs. `xs` are panel-relative x positions; MM6 keeps them
 * on one baseline at the bottom of the page. Returns the index clicked, or -1.
 */
export function drawTabs(ctx, ui, idPrefix, xs, yRel, w, h, labels, selected) {
  let clicked = -1;
  for (let i = 0; i < labels.length; i++) {
    const x = px(xs[i]), y = py(yRel);
    const on = i === selected;
    const hit = ui.region(`${idPrefix}:tab${i}`, x, y, w, h);
    if (hit.click) clicked = i;
    A.button(ctx, x, y, w, h, null, on || hit.down ? 'down' : 'up');
    if (on) { ctx.fillStyle = CANARY; ctx.fillRect(x + 3, y + h - 3, w - 6, 1); }
    F.drawText(ctx, labels[i], (x + w / 2) | 0, (y + (h - 10) / 2) | 0, {
      align: 'center', color: on ? CANARY : (hit.hover ? HILITE : WHITE),
    });
  }
  return clicked;
}

// --- the panel base ---------------------------------------------------------

export class Screen {
  constructor(session, ui, hud, opts = {}) {
    this.session = session;
    this.ui = ui;
    this.hud = hud;
    this.opts = opts || {};
    this.id = 'screen';
    this.stack = this.opts.stack || (session && session.screens) || (ui && ui.stack) || null;
    /** Help line text for this frame; screens set it while drawing. */
    this.status = '';
  }

  onOpen() {}
  onClose() {}
  onFocus() {}
  onBlur() {}
  update() {}
  draw() {}

  handleKey(code) {
    if (code === 'Escape') { this.close(); return true; }
    return false;
  }

  close() {
    const st = this.stack;
    if (!st) return;
    if (st.stack && st.stack.indexOf(this) >= 0) {
      while (st.top && st.top !== this) st.pop();
      st.pop();
    } else if (st.top === this) st.pop();
  }

  push(screen) { if (this.stack) this.stack.push(screen); }

  /** Fire a UI sound if the audio system is wired up yet. */
  sound(name) {
    const a = this.session && this.session.audio;
    if (a && typeof a.play === 'function') { try { a.play(name); } catch (e) { /* silent */ } }
  }

  get party() { return (this.session && this.session.party) || { members: [], gold: 0, food: 0 }; }
  get members() { return this.party.members || []; }
  get charIndex() {
    const i = (this.session && this.session.activeChar) | 0;
    return Math.max(0, Math.min(this.members.length - 1, i));
  }
  get character() { return this.members[this.charIndex] || null; }

  // --- shared chrome -------------------------------------------------------

  /**
   * Paint the page at (8, 8). `kind` is 'sheet' (dark tooled parchment, white
   * text), 'page' (pale book paper, dark text) or 'stone'. The surrounding
   * chrome is the shell's and is deliberately left alone.
   */
  drawPage(ctx, kind = 'sheet') {
    const p = PANEL;
    if (kind === 'stone') {
      A.stone(ctx, p.x, p.y, p.w, p.h, { rivets: false });
    } else {
      A.parchment(ctx, p.x, p.y, p.w, p.h, { tone: kind === 'page' ? 'page' : 'sheet' });
    }
    A.bevel(ctx, p.x, p.y, p.w, p.h, { sunken: true, size: 2 });
    return p;
  }

  /** Exit button on the tab baseline. Returns true when it was clicked. */
  drawExit(ctx, label = 'Exit') {
    const r = exitRect();
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close');
    A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : 'up');
    F.drawText(ctx, label, (r.x + r.w / 2) | 0, (r.y + (r.h - 10) / 2) | 0, {
      align: 'center', color: hit.hover ? HILITE : CANARY,
    });
    if (hit.click) { this.sound('click'); this.close(); return true; }
    return false;
  }

  /**
   * The one-line help strip MM6 prints under the page body: whatever the
   * hovered region asked for, otherwise the screen's own hint.
   */
  drawHelpLine(ctx, yRel, color) {
    const text = this.ui.hoverText || this.status || '';
    if (!text) return;
    F.drawText(ctx, text, px(PANEL.w / 2), py(yRel), {
      face: 'small', align: 'center', color: color || CANARY, maxWidth: PANEL.w - 24,
    });
  }

  /** Vertical scrollbar with wheel + drag. Returns the clamped scroll value. */
  scrollbar(ctx, id, x, y, h, scroll, total, visible) {
    const maxScroll = Math.max(0, total - visible);
    let s = Math.max(0, Math.min(maxScroll, scroll));
    const hit = this.ui.region(`${this.id}:${id}`, x, y, 10, h);
    if (hit.hover && this.ui.mouse.wheel) s = Math.max(0, Math.min(maxScroll, s + Math.sign(this.ui.mouse.wheel)));
    if (hit.down && maxScroll > 0) {
      const t = (this.ui.mouse.y - y - 7) / Math.max(1, h - 14);
      s = Math.round(Math.max(0, Math.min(1, t)) * maxScroll);
    }
    A.scrollbar(ctx, x, y, h, maxScroll > 0 ? s / maxScroll : 0, visible / Math.max(1, total));
    return s;
  }

  /** Character switching from the live party bar underneath the panel. */
  pollPartyBar() {
    const btns = (this.hud && this.hud.buttons) || [];
    for (const b of btns) {
      const m = /^char(\d)$/.exec(b.id);
      if (m && b.hit && b.hit.click && this.members[+m[1]]) {
        this.session.activeChar = +m[1];
        this.onCharChanged(+m[1]);
      }
    }
  }

  onCharChanged() {}
}
