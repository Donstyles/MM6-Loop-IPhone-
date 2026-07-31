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

import * as F from '../../art/font.js';
import * as UI from '../../art/uiart.js';
import * as PORTRAITS from '../../art/portraits.js';
import { mulberry32 } from '../../core/rng.js';
import { rampCss } from '../../core/palette.js';
import * as M from './mm6art.js';

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
// MM6's UI palette, straight from font.js (which owns the colour table).

export const WHITE = F.TEXT_NORMAL || '#FFFFFF';      // default UI text
export const HILITE = F.TEXT_HILITE || '#E1CD23';     // hovered / clickable: gold
export const CANARY = F.TEXT_HEADER || '#FFFF9B';     // headers, tooltips
export const GREEN = F.TEXT_GOOD || '#00E100';        // buffed above base
export const SCARLET = F.TEXT_BAD || '#FF2300';       // drained below base
export const RED = F.TEXT_RED || '#FF0000';           // broken / severe
export const BOLT = F.TEXT_LEARN || '#00AFFF';        // learnable skill
export const BOOK_INK = F.TEXT_DARK || '#4B4B4B';     // body text on a book page
export const DIM = F.TEXT_DIM || '#A0A0A0';

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
  /**
   * Painted paper. `tone`: 'sheet' is the character sheet's #C8B48C parchment,
   * 'page' the paler book leaf. Painted here rather than in uiart because MM6's
   * stock has visible fibre, blotching and a worn edge - a wash will not do.
   */
  parchment(ctx, x, y, w, h, opts) {
    const tone = (opts && opts.tone) || 'page';
    const seed = (opts && opts.seed) || 11;
    M.paper(ctx, x | 0, y | 0, w | 0, h | 0, tone === 'sheet' ? 'sheet' : 'book', seed);
  },
  /** An open book page. `side` is 'left'|'right' so the spine shades inward. */
  book(ctx, x, y, w, h, side, kind) {
    M.paper(ctx, x | 0, y | 0, w | 0, h | 0, kind === 'book' ? 'book' : 'spell',
      side === 'right' ? 29 : 23);
    M.gutter(ctx, side === 'right' ? (x | 0) : (x + w - 1) | 0, y | 0, h | 0, side);
  },
  /** opts: { sunken, size } - translated to uiart's { raised, depth }. */
  bevel(ctx, x, y, w, h, opts) {
    const o = opts || {};
    guard('bevel', () => UI.drawBevel(ctx, x | 0, y | 0, w | 0, h | 0,
      { depth: o.size || 1, raised: !o.sunken }), () => {
      ctx.fillStyle = rampCss('stone', o.sunken ? 1 : 10);
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = rampCss('stone', o.sunken ? 10 : 1);
      ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
    });
  },
  inset(ctx, x, y, w, h, opts) {
    guard('inset', () => UI.drawInset(ctx, x | 0, y | 0, w | 0, h | 0, opts || {}), () => {
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
  /**
   * A carved plate. MM6 has no rounded rectangles and no flat fills: this is a
   * chiselled slab, lit along the top-left arris and shadowed along the
   * bottom-right, inverted and shifted +1,+1 when pressed.
   */
  button(ctx, x, y, w, h, label, state, opts) {
    const o = opts || {};
    const d = M.carvedPlate(ctx, x | 0, y | 0, w | 0, h | 0, {
      state: state || 'up', material: o.material || 'stone', seed: o.seed === undefined ? 5 : o.seed,
    });
    if (label) {
      F.drawText(ctx, label, (x + w / 2 + d) | 0, (y + (h - 10) / 2 + d) | 0, {
        align: 'center', color: state === 'hot' ? HILITE : CANARY,
      });
    }
    return d;
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
  /** A sunken well with a painted tick. No checkbox chrome. */
  check(ctx, x, y, on, hot) {
    M.tickBox(ctx, x | 0, y | 0, 13, !!on, !!hot);
  },
  /** A cut groove with a metal plate riding it. */
  slider(ctx, x, y, w, t, hot) {
    M.groove(ctx, x | 0, y + 4, w | 0, 5);
    const kx = (x + Math.round((w - 7) * Math.max(0, Math.min(1, t)))) | 0;
    M.handle(ctx, kx, (y | 0) - 1, 7, 15, !!hot);
  },
  /**
   * A cut channel with a wooden runner in it - no track, no thumb outline and
   * no arrow buttons, none of which exist in 1998 art.
   */
  scrollbar(ctx, x, y, h, t, frac) {
    x |= 0; y |= 0; h |= 0;
    M.carvedWell(ctx, x, y, 10, h, { material: 'wood', seed: 61 });
    const gh = Math.max(16, Math.round((h - 4) * Math.max(0.08, Math.min(1, frac))));
    const gy = (y + 2 + (h - 4 - gh) * Math.max(0, Math.min(1, t))) | 0;
    M.carvedPlate(ctx, x + 1, gy, 8, gh, { material: 'wood', seed: 29 });
    const my = gy + (gh >> 1);
    M.rct(ctx, x + 3, my - 2, 4, 1, [136, 104, 66]);
    M.rct(ctx, x + 3, my + 1, 4, 1, [136, 104, 66]);
  },
  /** `ramp` is a palette ramp name, as uiart expects ('blood', 'ice', ...). */
  gem(ctx, x, y, size, ramp) {
    guard('gem', () => UI.drawGem(ctx, x | 0, y | 0, size | 0, ramp || 'blood'), () => {
      const r = size / 2;
      ctx.fillStyle = rampCss(ramp || 'blood', 10);
      for (let i = 0; i < size; i++) {
        const k = Math.round(r - Math.abs(i - r + 0.5));
        ctx.fillRect((x + r - k) | 0, y + i, k * 2, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + ((r - 1) | 0), y + 2, 1, 1);
    });
  },
  corner(ctx, x, y, size, which) {
    const rot = { tl: 0, tr: 1, br: 2, bl: 3 }[which] || 0;
    guard('corner', () => UI.drawCorner(ctx, x | 0, y | 0, size | 0, rot), () => {
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
  filigree(ctx, x, y, w, h) {
    guard('filigree', () => UI.drawGoldFiligree(ctx, x | 0, y | 0, w | 0, (h | 0) || 6), () => {
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
    const down = on || hit.down;
    // Painted wooden tab; the open one is pressed into the sheet.
    const d = M.carvedPlate(ctx, x, y, w, h, {
      state: down ? 'down' : hit.hover ? 'hot' : 'up', material: 'wood', seed: 13 + i,
    });
    F.drawText(ctx, labels[i], (x + w / 2 + d) | 0, (y + (h - 10) / 2 + d) | 0, {
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

  /**
   * Vertical runner: wheel and drag only. MM6 has no arrow buttons on a book
   * page, so neither does this - it is a channel with a wooden slider in it.
   */
  scrollbar(ctx, id, x, y, h, scroll, total, visible) {
    const maxScroll = Math.max(0, total - visible);
    let s = Math.max(0, Math.min(maxScroll, scroll));
    const hit = this.ui.region(`${this.id}:${id}`, x, y, 10, h);
    if (hit.hover && this.ui.mouse.wheel) s += Math.sign(this.ui.mouse.wheel);
    else if (hit.down && maxScroll > 0) {
      const t = (this.ui.mouse.y - y - 2) / Math.max(1, h - 4);
      s = Math.round(Math.max(0, Math.min(1, t)) * maxScroll);
    }
    s = Math.max(0, Math.min(maxScroll, s));
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
