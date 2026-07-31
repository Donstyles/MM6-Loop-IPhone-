// ---------------------------------------------------------------------------
// NPC conversation, plus the shared kit every "house" screen in this set uses.
//
// MM6's town buildings are the one screen that does not simply replace the 3D
// viewport: the left 461x345 inset shows a *painted interior illustration* of
// the establishment, and the whole right column is replaced by the dialogue
// panel - proprietor portrait at (521,38), option list at x=480 w=140 h=30
// stepping 30px, exit button at (471,445). The bottom party bar stays live
// underneath, drawn by the HUD, so nothing here paints it.
//
// Option text is white and turns Sunflower gold under the cursor; NPC names
// print in Eastern Blue. Those three colours are verbatim from the engine's
// colour table and are the screen's whole interaction vocabulary.
//
// Interiors are painted per pixel and *baked*: a backdrop costs a few
// milliseconds once and is a single blit per frame afterwards.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import { Rand, clamp, smoothstep, fbm2, valueNoise2 } from '../../core/rng.js';
import { rampCss, ramp, snap } from '../../core/palette.js';
import * as F from '../../art/font.js';
import { PORTRAIT_W, PORTRAIT_H } from '../../art/portraits.js';
import { Screen, A, PANEL, portraitOf, wrapLines, drawWrapped } from './screenbase.js';

export { Screen, A, PANEL, portraitOf, wrapLines, drawWrapped };

// --- the engine colour table (exact) ---------------------------------------

export const C_WHITE = '#ffffff';      // default UI text
export const C_GOLD = '#e1cd23';       // Sunflower: highlighted / clickable
export const C_CANARY = '#ffff9b';     // PaleCanary: headers, tooltips
export const C_BLUE = '#1699e9';       // EasternBlue: NPC name
export const C_LEARN = '#00afff';      // BoltBlue: learnable
export const C_GREEN = '#00e100';      // buffed above base
export const C_SCARLET = '#ff2300';    // drained below base
export const C_RED = '#ff0000';        // broken / severe
export const C_BODY = '#4b4b4b';       // Tundora: book and page body text
export const C_DIM = '#9a8f78';

// --- geometry (all absolute, verbatim from the engine) ----------------------
// PANEL (8,8,461,345) comes from screenbase and is re-exported above: panel art
// replaces the 3D viewport exactly, leaving the carved surround visible.

/** The dialogue panel that replaces the right column while a house is open. */
export function dlgRect() {
  const x = layout.side ? layout.side.x : 468;
  return { x, y: 0, w: layout.w - x, h: layout.h };
}

/** Proprietor portrait, and its 4px border frame. */
export const NPC_PORTRAIT = { x: 521, y: 38, w: PORTRAIT_W, h: PORTRAIT_H };
export const NPC_FRAME = { x: 517, y: 34 };

/** Option list: shops start at y=146, house NPCs at y=160. */
export const OPTION = { x: 480, w: 140, h: 30, shopY: 146, npcY: 160, step: 30 };

export const EXIT_BTN = { x: 471, y: 445, w: 169, h: 35 };
export const YES_BTN = { x: 486, y: 445, w: 75, h: 33 };
export const NO_BTN = { x: 566, y: 445, w: 75, h: 33 };

/** Where several NPCs in one building put their portraits. */
export const NPC_SLOTS = {
  1: [[521, 38]],
  2: [[521, 38], [521, 165]],
  3: [[521, 38], [521, 133], [521, 228]],
  4: [[521, 38], [486, 133], [564, 133], [521, 228]],
  6: [[486, 38], [564, 38], [486, 133], [564, 133], [486, 228], [564, 228]],
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function gold(n) {
  return String(Math.round(n) | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function members(session) {
  const p = session && session.party;
  return (p && (p.members || p.chars)) || [];
}

export function activeMember(session) {
  const m = members(session);
  if (!m.length) return null;
  return m[clamp(session.activeChar | 0, 0, m.length - 1)];
}

export function charName(ch) { return (ch && (ch.name || ch.id)) || '-'; }

export function partyGold(session) {
  const p = session && session.party;
  return p ? (p.gold | 0) : 0;
}

export function spend(session, amount) {
  const p = session && session.party;
  if (!p || (p.gold | 0) < amount) return false;
  p.gold -= amount;
  return true;
}

export function earn(session, amount) {
  const p = session && session.party;
  if (p) p.gold = (p.gold | 0) + Math.round(amount);
}

export function say(session, msg, color) {
  if (session && session.log && typeof session.log.add === 'function') session.log.add(msg, color);
}

/** Conditions are a map in stats.js; some fixtures still use an array. */
export function hasCondition(ch, id) {
  const c = ch && ch.conditions;
  if (!c) return false;
  return Array.isArray(c) ? c.includes(id) : !!c[id];
}

export function clearCondition(ch, id) {
  const c = ch && ch.conditions;
  if (!c) return;
  if (Array.isArray(c)) { const i = c.indexOf(id); if (i >= 0) c.splice(i, 1); }
  else delete c[id];
}

export function addCondition(ch, id) {
  if (!ch) return;
  if (!ch.conditions) ch.conditions = {};
  if (Array.isArray(ch.conditions)) { if (!ch.conditions.includes(id)) ch.conditions.push(id); }
  else ch.conditions[id] = true;
}

export function conditionIds(ch) {
  const c = ch && ch.conditions;
  if (!c) return [];
  return Array.isArray(c) ? c.slice() : Object.keys(c).filter((k) => c[k]);
}

/** Deterministic per-screen RNG, so a shop looks the same on every visit. */
export function rngFor(key) { return new Rand(String(key)); }

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/**
 * A clickable line of text. White at rest, Sunflower gold under the cursor -
 * MM6's entire interaction cue.
 */
export function hotText(ui, ctx, id, x, y, label, o = {}) {
  const face = o.face || 'normal';
  const w = o.w || F.measure(label, face).w;
  const h = o.h || F.lineHeightOf(face);
  const align = o.align || 'left';
  const bx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const hit = ui && ui.region
    ? ui.region(id, o.hitX !== undefined ? o.hitX : bx - 3, y - 2,
      o.hitW || w + 6, o.hitH || h + 3, o.tip || null)
    : { hover: false, click: false, down: false };
  const on = o.enabled !== false;
  const col = !on ? (o.offColor || C_DIM) : hit.hover ? C_GOLD : (o.color || C_WHITE);
  F.drawText(ctx, label, align === 'left' ? bx : Math.round(x), y | 0,
    { face, align, color: col, maxWidth: o.maxWidth || null });
  return { hover: hit.hover, click: on && hit.click, x: bx, y, w, h };
}

/**
 * The dialogue panel's option list. Items are {id,label,enabled,tip,note}.
 * Returns the id clicked this frame, or null.
 */
export function optionList(ui, ctx, items, o = {}) {
  const x = o.x === undefined ? OPTION.x : o.x;
  const w = o.w || OPTION.w;
  const h = o.h || OPTION.h;
  const step = o.step || OPTION.step;
  let y = o.y === undefined ? OPTION.shopY : o.y;
  let clicked = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const on = it.enabled !== false;
    const hit = ui && ui.region ? ui.region(`${o.ns || 'opt'}:${it.id}`, x, y, w, h, it.tip || null)
      : { hover: false, click: false };
    const col = !on ? C_DIM : hit.hover ? C_GOLD : C_WHITE;
    if (hit.hover && on) {
      // A dim plate under the hot option; the original lights the text only,
      // but the painted panel behind ours is busier than a flat bitmap.
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y + 2, w, h - 4);
      ctx.restore();
    }
    const ty = it.note ? y + 4 : y + Math.round((h - F.lineHeightOf('normal')) / 2);
    F.drawText(ctx, it.label, x + w / 2, ty, { align: 'center', color: col, maxWidth: w - 6 });
    if (it.note) {
      F.drawText(ctx, it.note, x + w / 2, ty + 12,
        { face: 'small', align: 'center', color: on ? C_CANARY : C_DIM, maxWidth: w - 6 });
    }
    if (hit.click && on) clicked = it.id;
    y += step;
  }
  return clicked;
}

/** The big exit plate at the bottom of the dialogue panel. */
export function exitButton(ui, ctx, label = 'Exit', id = 'house:exit') {
  const r = EXIT_BTN;
  const hit = ui && ui.region ? ui.region(id, r.x, r.y, r.w, r.h, null) : { hover: false, click: false, down: false };
  A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : 'up');
  F.drawText(ctx, label, r.x + r.w / 2, r.y + (r.h - 11) / 2 + (hit.down ? 1 : 0),
    { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
  return hit.click;
}

/** Yes / No confirmation pair, in the same strip as the exit button. */
export function yesNo(ui, ctx, idNs = 'confirm') {
  let r = null;
  for (const [id, rect, label] of [['yes', YES_BTN, 'Yes'], ['no', NO_BTN, 'No']]) {
    const hit = ui && ui.region ? ui.region(`${idNs}:${id}`, rect.x, rect.y, rect.w, rect.h)
      : { hover: false, click: false, down: false };
    A.button(ctx, rect.x, rect.y, rect.w, rect.h, null, hit.down ? 'down' : 'up');
    F.drawText(ctx, label, rect.x + rect.w / 2, rect.y + (rect.h - 11) / 2,
      { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
    if (hit.click) r = id;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Painting kit
// ---------------------------------------------------------------------------

// Ordered dither for the painted interiors. palette.js's ditherImageData does a
// full 256-entry nearest search per pixel, which is far too slow for a 461x345
// backdrop; painted surfaces only ever emit a couple of hundred distinct
// colours, so memoising the snap makes the same result effectively free.
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const _snapMemo = new Map();

function snapMemo(r, g, b) {
  const k = (r << 16) | (g << 8) | b;
  let v = _snapMemo.get(k);
  if (v === undefined) { v = snap(r, g, b); _snapMemo.set(k, v); }
  return v;
}

/** Ordered-dither and palettise an ImageData in place. */
export function ditherRegion(img, amount = 8) {
  const { data, width, height } = img;
  for (let y = 0; y < height; y++) {
    const row = BAYER4[y & 3];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const t = (row[x & 3] / 16 - 0.469) * amount;
      const p = snapMemo(
        clamp(Math.round(data[i] + t), 0, 255),
        clamp(Math.round(data[i + 1] + t), 0, 255),
        clamp(Math.round(data[i + 2] + t), 0, 255),
      );
      data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
    }
  }
  return img;
}

const _scratch = document.createElement('canvas');

/**
 * Per-pixel paint into a rect. `f(u,v,rand,w,h)` returns [r,g,b] in *output*
 * coordinates; the result is ordered-dithered so painted interiors sit in the
 * same 8-bit world as the 3D view.
 *
 * `step` paints at 1/step resolution and blows the result up with nearest
 * sampling. MM6's art is 64x64 textures magnified, so chunky noise is not a
 * compromise here - it is the look - and it makes a full 461x345 interior cost
 * a quarter of what it otherwise would. Only ever called while baking.
 */
export function washPixels(ctx, x, y, w, h, f, seed = 5, step = 2) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  if (w <= 0 || h <= 0) return;
  const s = Math.max(1, step | 0);
  const cw = Math.ceil(w / s), chh = Math.ceil(h / s);
  const img = ctx.createImageData(cw, chh);
  const d = img.data;
  const rnd = new Rand(seed);
  for (let v = 0; v < chh; v++) {
    for (let u = 0; u < cw; u++) {
      const c = f(u * s, v * s, rnd, w, h);
      const i = (v * cw + u) * 4;
      if (!c) continue;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] === undefined ? 255 : c[3];
    }
  }
  ditherRegion(img, 8);
  if (s === 1) { ctx.putImageData(img, x, y); return; }
  _scratch.width = cw; _scratch.height = chh;
  const sg = _scratch.getContext('2d');
  sg.putImageData(img, 0, 0);
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(_scratch, 0, 0, cw, chh, x, y, cw * s, chh * s);
  ctx.imageSmoothingEnabled = sm;
}

const _baked = new Map();

/** Cache a painted backdrop by key. Painters are far too slow for a frame. */
export function baked(key, w, h, painter) {
  const k = `${key}|${w}x${h}`;
  let c = _baked.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  painter(g, c.width, c.height);
  _baked.set(k, c);
  return c;
}

/**
 * Banded additive pool of light: lamps, fires, stained glass, magic.
 *
 * Ten thin rings whose alpha falls off quadratically. Fewer, fatter rings read
 * as concentric discs; this reads as light, and the banding it does leave is
 * the ordered-dither look the rest of the frame has.
 */
export function glow(ctx, cx, cy, r, css, alpha = 0.5) {
  const N = 10;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = css;
  for (let i = N; i >= 1; i--) {
    const t = i / N;
    ctx.globalAlpha = alpha * (1 - t) * (1 - t) * 0.34;
    ctx.beginPath();
    ctx.arc(cx | 0, cy | 0, Math.max(1, r * t) | 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function poly(ctx, pts, css) {
  ctx.fillStyle = css;
  ctx.beginPath();
  ctx.moveTo(pts[0] | 0, pts[1] | 0);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] | 0, pts[i + 1] | 0);
  ctx.closePath();
  ctx.fill();
}

/** A standing figure in silhouette with a rim light from the left. */
export function figure(ctx, x, y, h, bodyCss, rimCss, o = {}) {
  const w = o.w || h * 0.44;
  const hr = Math.max(2, h * 0.10);
  poly(ctx, [
    x - w / 2, y,
    x - w * 0.40, y - h * 0.60,
    x - hr * 1.4, y - h * 0.72,
    x + hr * 1.4, y - h * 0.72,
    x + w * 0.40, y - h * 0.60,
    x + w / 2, y,
  ], bodyCss);
  ctx.fillStyle = bodyCss;
  ctx.beginPath();
  ctx.arc(x | 0, (y - h * 0.82) | 0, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rimCss;
  ctx.fillRect((x - w / 2) | 0, (y - h * 0.60) | 0, 2, (h * 0.60) | 0);
  ctx.beginPath();
  ctx.arc((x - hr * 0.35) | 0, (y - h * 0.82) | 0, hr, Math.PI * 0.55, Math.PI * 1.45);
  ctx.fill();
  if (o.hat) poly(ctx, [x - hr * 2, y - h * 0.90, x + hr * 2, y - h * 0.90, x, y - h * 1.14], bodyCss);
}

/** Back wall: coursed stone or plaster, darkening into the corners. */
export function paintWall(g, x, y, w, h, o = {}) {
  const name = o.ramp || 'stone';
  const lo = o.lo === undefined ? 0.16 : o.lo;
  const hi = o.hi === undefined ? 0.58 : o.hi;
  const course = o.course || 16;
  const seed = o.seed || 4;
  washPixels(g, x, y, w, h, (u, v) => {
    const row = Math.floor(v / course);
    const off = (row & 1) * (course * 1.5);
    // Seams are two pixels wide because the wash is painted at half scale.
    const bx = (u + off) % (course * 2.4);
    const seam = bx < 2.2 || (v % course) < 2.2 ? -0.12 : 0;
    const n = fbm2((u + off) * 0.07, v * 0.09, 2, 2, 0.5, seed) * 0.5 + 0.5;
    // Light spills from the upper left of every MM6 interior.
    const lightX = 1 - smoothstep(0, w, u) * 0.42;
    const lightY = 1 - smoothstep(0, h * 1.7, v) * 0.45;
    const t = clamp((lo + (hi - lo) * n) * lightX * lightY + seam, 0.02, 1);
    return ramp(name, Math.round(t * 15));
  }, seed);
}

/** Board floor in perspective: courses compress towards the horizon. */
export function paintFloor(g, x, y, w, h, o = {}) {
  const name = o.ramp || 'wood';
  const seed = o.seed || 9;
  washPixels(g, x, y, w, h, (u, v) => {
    const t = (v + 1) / h;
    const depth = 1 / (0.16 + t * 0.95);
    const bf = (u - w / 2) * depth * 0.05 + 80;
    const board = Math.floor(bf);
    const line = bf - board;
    const rung = Math.floor(depth * 3.5) % 2;
    const n = valueNoise2(board * 3.1, depth * 2.4, seed);
    let s = 0.20 + t * 0.34 + n * 0.16 + rung * 0.03;
    if (line < 0.09 || line > 0.91) s -= 0.13;
    const grain = valueNoise2(u * 0.9, v * 0.2 + board * 5, seed + 3) * 0.07;
    return ramp(name, Math.round(clamp(s + grain, 0.02, 1) * 15));
  }, seed);
}

/** A shelf plank with the shadow it throws on the wall behind. */
export function paintShelf(g, x, y, w, o = {}) {
  const th = o.th || 4;
  g.fillStyle = rampCss('wood', 7); g.fillRect(x, y, w, th);
  g.fillStyle = rampCss('wood', 10); g.fillRect(x, y, w, 1);
  g.fillStyle = rampCss('wood', 2); g.fillRect(x, y + th, w, 1);
  g.save();
  g.globalAlpha = 0.32; g.fillStyle = '#000000';
  g.fillRect(x, y + th + 1, w, o.shadow || 6);
  g.restore();
}

/** Heavy counter across the foreground. */
export function paintCounter(g, x, y, w, h, o = {}) {
  g.fillStyle = rampCss('wood', 5); g.fillRect(x, y, w, h);
  g.fillStyle = rampCss('wood', 9); g.fillRect(x, y, w, 3);
  g.fillStyle = rampCss('wood', 12); g.fillRect(x, y, w, 1);
  for (let i = x + 8; i < x + w; i += 27) {
    g.fillStyle = rampCss('wood', 3); g.fillRect(i, y + 4, 1, h - 4);
  }
  g.fillStyle = rampCss('wood', 2); g.fillRect(x, y + h - 2, w, 2);
  if (o.cloth) { g.fillStyle = rampCss(o.cloth, 6); g.fillRect(x + 10, y + 3, w - 20, 5); }
}

/** Barrel, crate, sack - the clutter every MM6 interior has in its corners. */
export function paintClutter(g, x, y, kind, s = 20) {
  if (kind === 'barrel') {
    g.fillStyle = rampCss('wood', 5); g.fillRect(x, y - s, s * 0.8, s);
    g.fillStyle = rampCss('wood', 8); g.fillRect(x, y - s, 2, s);
    g.fillStyle = rampCss('grey', 6);
    g.fillRect(x, y - s + 3, s * 0.8, 2);
    g.fillRect(x, y - 6, s * 0.8, 2);
    g.fillStyle = rampCss('wood', 9); g.fillRect(x, y - s, s * 0.8, 2);
  } else if (kind === 'crate') {
    g.fillStyle = rampCss('wood', 6); g.fillRect(x, y - s, s, s);
    g.fillStyle = rampCss('wood', 3);
    g.fillRect(x, y - s, s, 1); g.fillRect(x, y - 1, s, 1);
    g.fillRect(x, y - s, 1, s); g.fillRect(x + s - 1, y - s, 1, s);
    g.fillStyle = rampCss('wood', 9);
    g.fillRect(x + 1, y - s + 1, s - 2, 1);
    for (let i = 1; i < s - 1; i++) g.fillRect(x + i, y - s + i, 1, 1);
  } else {
    g.fillStyle = rampCss('sand', 6);
    g.beginPath();
    g.ellipse((x + s / 2) | 0, (y - s * 0.35) | 0, s * 0.5, s * 0.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rampCss('sand', 9);
    g.fillRect((x + s * 0.3) | 0, (y - s * 0.7) | 0, 3, 4);
  }
}

/**
 * A darkened plate over the illustration - MM6 draws its house text and item
 * grids straight onto the painting, with the art dimmed behind them.
 */
export function plate(ctx, x, y, w, h, alpha = 0.62) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  ctx.restore();
  A.bevel(ctx, x | 0, y | 0, w | 0, h | 0, { depth: 1, raised: false });
}

// ---------------------------------------------------------------------------
// House screen base
// ---------------------------------------------------------------------------

export class HouseScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'house';
    this.title = opts.title || 'House';
    this.keeper = opts.keeper || null;
    this.mode = null;
    this.message = '';
    this.messageT = 99;
    this.t = 0;
    this.optionY = OPTION.shopY;
  }

  say(msg, color) {
    this.message = String(msg || '');
    this.messageT = 0;
    say(this.session, msg, color);
  }

  update(dt) {
    this.t += dt || 0;
    this.messageT += dt || 0;
  }

  /** Subclasses return a baked 461x345 interior. */
  backdrop() { return null; }
  /** Subclasses draw their grids and tables over the illustration. */
  drawContent() { }
  /** Right-panel options. */
  options() { return []; }
  onOption() { }

  draw(ctx) {
    const bg = this.backdrop();
    if (bg) ctx.drawImage(bg, PANEL.x, PANEL.y);
    else A.stone(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { rivets: false });
    A.bevel(ctx, PANEL.x - 1, PANEL.y - 1, PANEL.w + 2, PANEL.h + 2, { depth: 1, raised: false });

    this.drawContent(ctx);
    this.drawMessage(ctx);
    this.drawPanel(ctx);
  }

  /** The right column, replaced wholesale while a house is open. */
  drawPanel(ctx) {
    const d = dlgRect();
    A.stone(ctx, d.x, d.y, d.w, d.h, { rivets: true, gold: true });
    A.inset(ctx, d.x + 6, 4, d.w - 12, d.h - 8);

    // House name across the top of the panel.
    F.drawText(ctx, this.title, d.x + d.w / 2, 10,
      { align: 'center', color: C_CANARY, maxWidth: d.w - 20 });

    this.drawKeeper(ctx);
    this.drawPanelInfo(ctx);

    const opts = this.options();
    const clicked = optionList(this.ui, ctx, opts, { ns: this.id, y: this.optionY });
    if (clicked) { this.sound('click'); this.onOption(clicked); }

    if (exitButton(this.ui, ctx, this.exitLabel || 'Exit', `${this.id}:exit`)) {
      this.sound('click');
      this.close();
    }
  }

  /** Proprietor portrait at (521,38) with its 4px carved border. */
  drawKeeper(ctx) {
    const k = this.keeper;
    if (!k) return;
    const p = NPC_PORTRAIT;
    A.portraitFrame(ctx, NPC_FRAME.x, NPC_FRAME.y, p.w + 8, p.h + 8, 'normal');
    const img = portraitOf(k, k.expression || 'normal');
    if (img) ctx.drawImage(img, p.x, p.y);
    else { ctx.fillStyle = rampCss('stone', 5); ctx.fillRect(p.x, p.y, p.w, p.h); }
    F.drawText(ctx, k.name || 'Proprietor', p.x + p.w / 2, p.y + p.h + 6,
      { align: 'center', color: C_BLUE, maxWidth: 150 });
    if (k.title) {
      F.drawText(ctx, k.title, p.x + p.w / 2, p.y + p.h + 18,
        { face: 'small', align: 'center', color: C_DIM, maxWidth: 150 });
    }
  }

  /**
   * White status text under the option list. It sits below rather than above
   * because the proprietor's name and occupation already own the space between
   * the portrait and the first option.
   */
  drawPanelInfo(ctx) {
    const d = dlgRect();
    const lines = this.panelInfo ? this.panelInfo() : [];
    if (!lines.length) return;
    const optCount = this.options ? this.options().length : 0;
    let y = Math.min(EXIT_BTN.y - 12 - lines.length * 11,
      this.optionY + optCount * OPTION.step + 14);
    A.divider(ctx, d.x + 14, y - 8, d.w - 28);
    for (const l of lines) {
      const s = typeof l === 'string' ? l : l.text;
      F.drawText(ctx, s, d.x + d.w / 2, y, {
        face: 'small', align: 'center', maxWidth: d.w - 16,
        color: (l && l.color) || C_WHITE,
      });
      y += 11;
    }
  }

  panelInfo() {
    return [{ text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY }];
  }

  /** Transient reply text, printed over the bottom of the illustration. */
  drawMessage(ctx) {
    const msg = this.messageT < 8 ? this.message : '';
    if (!msg) return;
    const x = PANEL.x + 14, w = PANEL.w - 28;
    const lines = wrapLines(msg, w - 16, 'normal');
    const h = 12 + lines.length * 13;
    const y = PANEL.y + PANEL.h - h - 10;
    plate(ctx, x, y, w, h, 0.66);
    for (let i = 0; i < lines.length; i++) {
      F.drawText(ctx, lines[i], x + 8, y + 6 + i * 13, { color: C_WHITE });
    }
  }
}

// ---------------------------------------------------------------------------
// Dialogue screen
// ---------------------------------------------------------------------------

const TYPE_CPS = 130;   // typewriter speed, characters per second

/**
 * @typedef {object} NPCDef
 * @property {string}  name
 * @property {string}  [title]         occupation, printed under the portrait
 * @property {number}  [portraitSeed]
 * @property {string}  [greeting]
 * @property {Array}   [topics]        [{id,label,text,action}]
 * @property {object}  [quest]         {id,name,offer,progress,reward,gold,xp,ready}
 * @property {object}  [hire]          {wage, role, text}
 * @property {Array}   [teaches]       [{skill,name,price,mastery,classes}]
 * @property {object}  [join]          {id,price,text}
 * @property {string[]}[rumours]
 */

export class DialogueScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'dialogue';
    this.npc = opts.npc || DEFAULT_NPC;
    this.keeper = this.npc;
    this.title = opts.title || this.npc.house || this.npc.name;
    this.optionY = OPTION.npcY;
    this.exitLabel = 'Goodbye';
    this.body = this.npc.greeting || `${this.npc.name} looks you over.`;
    this.shown = 0;
    this.expression = 'normal';
    this.teachMode = false;
    this.reward = null;
    this.rnd = rngFor(`dlg:${this.npc.name}`);
    this.interior = opts.interior || 'house';
  }

  onOpen() { this.shown = 0; }

  setBody(s, expression) {
    this.body = String(s || '');
    this.shown = 0;
    if (expression) { this.expression = expression; this.npc.expression = expression; }
  }

  update(dt) {
    super.update(dt);
    this.shown = Math.min(this.body.length, this.shown + (dt || 0) * TYPE_CPS);
  }

  get revealed() { return this.shown >= this.body.length; }

  // --- topics --------------------------------------------------------------

  topics() {
    const n = this.npc;
    const out = [];
    if (n.quest && this.questState() !== 'done') out.push({ id: 'quest', label: n.quest.topic || 'Quest' });
    if (n.teaches && n.teaches.length) out.push({ id: 'teach', label: 'Learn Skill' });
    if (n.hire) out.push(this.isHired() ? { id: 'dismiss', label: 'Dismiss' } : { id: 'hire', label: 'Hire' });
    if (n.join) out.push({ id: 'join', label: this.isMember() ? 'Membership' : 'Join' });
    for (const t of (n.topics || [])) out.push({ id: t.id, label: t.label });
    if (n.rumours && n.rumours.length) out.push({ id: 'rumour', label: 'More Information' });
    return out;
  }

  options() {
    if (this.teachMode) {
      const ch = this.character || activeMember(this.session);
      const list = (this.npc.teaches || []).map((t) => {
        const known = ch && ch.skills && ch.skills[t.skill];
        const done = known && (known.mastery | 0) >= (t.mastery || 1);
        return {
          id: `t:${t.skill}:${t.mastery || 1}`,
          label: t.name || t.skill,
          note: done ? 'already known' : `${gold(t.price || 100)} gold`,
          enabled: !done, tip: t.desc,
        };
      });
      list.push({ id: 'back', label: 'Back' });
      return list;
    }
    return this.topics();
  }

  onOption(id) {
    if (id === 'back') { this.teachMode = false; this.setBody(this.npc.greeting || ''); return; }
    if (id.startsWith('t:')) {
      const [, skill, mastery] = id.split(':');
      const t = (this.npc.teaches || []).find((x) => x.skill === skill && String(x.mastery || 1) === mastery);
      if (t) this.teachOne(t);
      return;
    }
    this.choose(id);
  }

  questState() {
    const q = this.npc.quest;
    if (!q) return 'none';
    const log = this.session && this.session.quests;
    if (log && typeof log.state === 'function') return log.state(q.id) || this._qs || 'offer';
    if (log && log[q.id]) return log[q.id].state || 'offer';
    return this._qs || 'offer';
  }

  setQuestState(s) {
    const q = this.npc.quest;
    const log = this.session && this.session.quests;
    if (log && typeof log.set === 'function') log.set(q.id, s);
    else if (log) log[q.id] = { state: s, name: q.name };
    this._qs = s;
  }

  isHired() {
    const p = this.session && this.session.party;
    const list = (p && (p.hirelings || p.npcs)) || [];
    return list.some((h) => h && (h.id === (this.npc.id || this.npc.name) || h.name === this.npc.name));
  }

  isMember() {
    const p = this.session && this.session.party;
    const j = this.npc.join;
    return !!(p && p.memberships && j && p.memberships[j.id || this.npc.id]);
  }

  choose(id) {
    // A click while the text is still crawling completes the reveal instead.
    if (!this.revealed) { this.shown = this.body.length; return; }
    const n = this.npc;
    switch (id) {
      case 'quest': this.doQuest(); return;
      case 'teach': this.teachMode = true; this.setBody(this.teachIntro()); return;
      case 'hire': this.doHire(); return;
      case 'dismiss': this.doDismiss(); return;
      case 'join': this.doJoin(); return;
      case 'rumour': {
        const r = this.rnd.pick(n.rumours);
        this.setBody(typeof r === 'string' ? r : r.text, 'smile');
        return;
      }
      default: {
        const t = (n.topics || []).find((x) => x.id === id);
        if (!t) return;
        if (typeof t.action === 'function') {
          const r = t.action(this, this.session);
          if (typeof r === 'string') this.setBody(r);
          return;
        }
        this.setBody(t.text || '...');
      }
    }
  }

  teachIntro() {
    const ch = this.character || activeMember(this.session);
    return `I teach what I know, for a price. ${charName(ch)} is listening - choose a skill.`;
  }

  doQuest() {
    const q = this.npc.quest;
    const state = this.questState();
    if (state === 'offer') {
      this.setQuestState('active');
      this.setBody(q.offer || 'Bring me word when it is done.');
      say(this.session, `Quest accepted: ${q.name}`, C_GOLD);
      return;
    }
    if (state === 'active') {
      const ready = q.ready || (this.session && this.session.questReady && this.session.questReady(q.id));
      if (!ready) { this.setBody(q.progress || 'You have not finished what I asked of you.'); return; }
      this.setQuestState('done');
      const g = q.gold || 0, xp = q.xp || 0;
      earn(this.session, g);
      const m = members(this.session);
      for (const ch of m) ch.xp = (ch.xp | 0) + Math.round(xp / Math.max(1, m.length));
      this.reward = { gold: g, xp };
      this.setBody(`${q.reward || 'You have my thanks.'}  You receive ${gold(g)} gold and ${gold(xp)} experience.`, 'smile');
      say(this.session, `Quest complete: ${q.name}`, C_GOLD);
      return;
    }
    this.setBody(q.after || 'You have done all I could ask of you.', 'smile');
  }

  /** Teaching checks class, then rank, then the purse - in that order. */
  teachOne(t) {
    const ch = this.character || activeMember(this.session);
    if (!ch) return;
    const klass = ch.class || ch.klass;
    if (t.classes && t.classes.length && !t.classes.includes(klass)) {
      this.setBody(`No ${klass} has ever grasped ${t.name || t.skill}. Find another teacher.`, 'angry');
      return;
    }
    const known = (ch.skills && ch.skills[t.skill]) || null;
    const want = t.mastery || 1;
    if (known && (known.mastery | 0) >= want) {
      this.setBody(`${charName(ch)} has nothing more to learn from me.`);
      return;
    }
    if (want > 1 && (!known || (known.level | 0) < (t.minLevel || (want === 3 ? 8 : 4)))) {
      this.setBody(`Come back when ${charName(ch)} has practised more. I do not teach `
        + `${want === 3 ? 'mastery' : 'expertise'} to novices.`);
      return;
    }
    const price = t.price || 100;
    if (!spend(this.session, price)) {
      this.setBody(`Teaching is not charity. Come back with ${gold(price)} gold.`, 'angry');
      return;
    }
    if (!ch.skills) ch.skills = {};
    ch.skills[t.skill] = { level: known ? known.level : 1, mastery: want };
    this.setBody(`${charName(ch)} has learned ${t.name || t.skill}.`, 'smile');
    say(this.session, `${charName(ch)} learns ${t.name || t.skill}.`, C_GOLD);
  }

  doHire() {
    const p = this.session && this.session.party;
    if (!p) return;
    const wage = this.npc.hire.wage || 10;
    const list = p.hirelings || (p.hirelings = []);
    if (list.length >= 2) { this.setBody('You already keep two followers. One of them must go first.'); return; }
    list.push({
      id: this.npc.id || this.npc.name, name: this.npc.name,
      role: this.npc.hire.role || this.npc.title || 'Follower',
      wage, portraitSeed: this.npc.portraitSeed, sex: this.npc.sex,
    });
    this.setBody(this.npc.hire.text || `Then I am yours for ${wage} gold a day. Try not to get me killed.`, 'smile');
    say(this.session, `${this.npc.name} joins you at ${wage} gold a day.`, C_GOLD);
  }

  doDismiss() {
    const p = this.session && this.session.party;
    const list = (p && p.hirelings) || [];
    const i = list.findIndex((h) => h.id === (this.npc.id || this.npc.name) || h.name === this.npc.name);
    if (i >= 0) list.splice(i, 1);
    this.setBody('As you wish. I will find my own way home.');
    say(this.session, `${this.npc.name} leaves the party.`);
  }

  doJoin() {
    const j = this.npc.join;
    if (this.isMember()) { this.setBody(j.member || 'You are already one of us.', 'smile'); return; }
    if (j.classes && j.classes.length) {
      const ok = members(this.session).some((c) => j.classes.includes(c.class || c.klass));
      if (!ok) { this.setBody(j.refuse || 'We take none of your kind.', 'angry'); return; }
    }
    const price = j.price || 0;
    if (price && !spend(this.session, price)) {
      this.setBody(`Membership costs ${gold(price)} gold. Come back when you have it.`);
      return;
    }
    const p = this.session && this.session.party;
    if (p) {
      if (!p.memberships) p.memberships = {};
      p.memberships[j.id || this.npc.id] = true;
    }
    this.setBody(j.text || 'Welcome. You are one of us now.', 'smile');
  }

  // --- drawing -------------------------------------------------------------

  backdrop() {
    return baked(`interior:${this.interior}`, PANEL.w, PANEL.h, (g, w, h) => paintRoom(g, w, h, this.interior));
  }

  panelInfo() {
    const out = [];
    if (this.isHired()) out.push({ text: `In your service - ${this.npc.hire.wage}g/day`, color: C_LEARN });
    else if (this.npc.title) out.push({ text: '', color: C_WHITE });
    return out;
  }

  /** The NPC's speech, printed over the lower half of the illustration. */
  drawContent(ctx) {
    const x = PANEL.x + 16, w = PANEL.w - 32;
    const y = PANEL.y + 176, h = 150;
    plate(ctx, x, y, w, h, 0.70);
    A.corner(ctx, x + 2, y + 2, 9, 'tl');
    A.corner(ctx, x + w - 11, y + 2, 9, 'tr');
    A.corner(ctx, x + 2, y + h - 11, 9, 'bl');
    A.corner(ctx, x + w - 11, y + h - 11, 9, 'br');

    F.drawText(ctx, this.npc.name, x + 14, y + 10, { color: C_BLUE });
    if (this.npc.title) {
      F.drawText(ctx, this.npc.title, x + w - 14, y + 11, { face: 'small', align: 'right', color: C_DIM });
    }
    A.rule(ctx, x + 12, y + 24, w - 24, '#7a6a4a');

    const shown = this.body.slice(0, Math.floor(this.shown));
    drawWrapped(ctx, shown, x + 14, y + 32, w - 28, { face: 'normal', lineHeight: 13, color: C_WHITE });

    if (!this.revealed && ((this.t * 3) | 0) % 2 === 0) {
      const lines = wrapLines(shown, w - 28, 'normal');
      const last = lines[lines.length - 1] || '';
      ctx.fillStyle = C_WHITE;
      ctx.fillRect((x + 14 + F.measure(last, 'normal').w + 2) | 0, y + 32 + (lines.length - 1) * 13, 5, 9);
    }
    if (this.reward) {
      F.drawText(ctx, `+${gold(this.reward.gold)} gold   +${gold(this.reward.xp)} experience`,
        x + w - 14, y + h - 16, { face: 'small', align: 'right', color: C_CANARY });
    }

    // The plate itself finishes the reveal, MM6-style.
    if (this.ui && this.ui.region) {
      const hit = this.ui.region('dlg:body', x, y, w, h);
      if (hit.click) this.shown = this.body.length;
    }
  }

  drawMessage() { /* the speech plate is the message */ }

  handleKey(code) {
    if (code === 'Escape') { this.close(); return true; }
    if (!this.revealed) { this.shown = this.body.length; return true; }
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const t = this.options()[+m[1] - 1];
      if (t) this.onOption(t.id);
      return true;
    }
    return false;
  }
}

/**
 * A generic painted interior, used by the conversation screen and as the
 * fallback for any house that has not painted its own.
 */
export function paintRoom(g, w, h, kind = 'house') {
  const horizon = Math.round(h * 0.58);
  paintWall(g, 0, 0, w, horizon, { ramp: kind === 'hall' ? 'stone' : 'plaster', lo: 0.14, hi: 0.52, course: 18, seed: 31 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'wood', seed: 12 });

  // Ceiling beams.
  g.fillStyle = rampCss('wood', 3);
  g.fillRect(0, 0, w, 10);
  for (let x = 20; x < w; x += 74) {
    g.fillStyle = rampCss('wood', 4); g.fillRect(x, 0, 10, 22);
    g.fillStyle = rampCss('wood', 7); g.fillRect(x, 0, 2, 22);
  }

  // A shuttered window on the left throwing the key light.
  const wx = 40, wy = 46, ww = 74, wh = 82;
  g.fillStyle = rampCss('wood', 4); g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
  g.fillStyle = rampCss('sky', 11); g.fillRect(wx, wy, ww, wh);
  g.fillStyle = rampCss('sky', 13); g.fillRect(wx, wy, ww, wh / 2);
  g.fillStyle = rampCss('wood', 6);
  g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
  g.fillRect(wx, wy + wh / 2 - 1, ww, 2);
  glow(g, wx + ww / 2, wy + wh / 2, 120, '#fff0c0', 0.5);

  // Light cast on the floor from the window.
  g.save();
  g.globalAlpha = 0.18;
  g.fillStyle = '#ffe8b0';
  poly(g, [wx, horizon, wx + ww, horizon, wx + ww + 60, h, wx - 30, h], '#ffe8b0');
  g.restore();

  // Hearth on the right.
  g.fillStyle = rampCss('stone', 4);
  g.fillRect(w - 130, horizon - 96, 104, 96);
  g.fillStyle = rampCss('stone', 7);
  g.fillRect(w - 130, horizon - 96, 104, 6);
  g.fillStyle = '#140a04';
  g.fillRect(w - 116, horizon - 62, 76, 62);
  glow(g, w - 78, horizon - 26, 58, '#ff8020', 0.85);
  for (let i = 0; i < 7; i++) {
    const fx = w - 108 + i * 11;
    poly(g, [fx, horizon - 4, fx + 5, horizon - 22 - (i % 3) * 6, fx + 10, horizon - 4], rampCss('fire', 10 + (i % 3)));
  }

  paintClutter(g, 24, h - 12, 'barrel', 30);
  paintClutter(g, 60, h - 10, 'crate', 24);
  paintClutter(g, w - 46, h - 14, 'sack', 26);

  // A rug in the middle distance so the floor is not empty.
  g.save();
  g.globalAlpha = 0.9;
  g.fillStyle = rampCss('blood', 4);
  g.beginPath();
  g.ellipse(w / 2, horizon + 40, 118, 30, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rampCss('blood', 7);
  g.beginPath();
  g.ellipse(w / 2, horizon + 40, 96, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Vignette: the original interiors are all painted dark at the edges.
  vignette(g, w, h);
}

/** Darken the frame edges so painted panels sit inside their stone surround. */
export function vignette(g, w, h, strength = 0.55) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ex = Math.min(x, w - 1 - x) / (w * 0.5);
      const ey = Math.min(y, h - 1 - y) / (h * 0.5);
      const e = Math.min(1, Math.min(ex, ey) * 3.2);
      const k = 1 - (1 - e) * strength;
      const i = (y * w + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  ditherRegion(img, 6);
  g.putImageData(img, 0, 0);
}

const DEFAULT_NPC = {
  name: 'Townsfolk', title: 'Citizen', portraitSeed: 12,
  greeting: 'Good day to you.',
  topics: [],
  rumours: ['They say the roads north are not safe after dark.'],
};

export default DialogueScreen;
