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
import { Rand, clamp, smoothstep, fbm2, valueNoise2, hash2 } from '../../core/rng.js';
import { rampCss, ramp, snap, quantizeImageData, BAYER8 } from '../../core/palette.js';
import * as F from '../../art/font.js';
import { PORTRAIT_W, PORTRAIT_H } from '../../art/portraits.js';
import { Screen, A, PANEL, portraitOf, wrapLines, drawWrapped } from './screenbase.js';
import * as MM6 from './mm6art.js';
import * as Figures from '../../art/figures.js';
import {
  giveQuest, turnInQuest, dispatchQuestEvent, questProgressText, updateAwards, refreshGating,
} from '../../game/quests.js';
import { awardXP } from '../../game/combat.js';

export { Screen, A, PANEL, portraitOf, wrapLines, drawWrapped };
export { MM6 };

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

/**
 * The dialogue panel that replaces the right column while a house is open.
 *
 * Its height is the *side panel's*, not the frame's: the party bar is painted
 * over everything below y=352, so anything the panel puts past that is cut in
 * half by the bar rather than drawn.
 */
export function dlgRect() {
  const x = layout.side ? layout.side.x : 468;
  const h = (layout.side && layout.side.h) || 352;
  return { x, y: 0, w: layout.w - x, h };
}

/** Proprietor portrait, and its 4px border frame. */
export const NPC_PORTRAIT = { x: 521, y: 38, w: PORTRAIT_W, h: PORTRAIT_H };
export const NPC_FRAME = { x: 517, y: 34 };

/** Option list: shops start at y=146, house NPCs at y=160. */
export const OPTION = { x: 480, w: 140, h: 30, shopY: 146, npcY: 160, step: 30 };

/**
 * The engine's plate sat at (471,445) - under the party bar's clip - which
 * left an INVISIBLE hot region that swallowed clicks on the HUD icon strip
 * and gave the player no visible way out. The plate now lives at the foot of
 * the dialogue column itself, above the y=352 bar line, where MM6's panel art
 * puts it. Rects are computed from the live column so wide frames stay right.
 */
export const EXIT_BTN = { x: 486, y: 314, w: 136, h: 32 };
export const YES_BTN = { x: 486, y: 314, w: 64, h: 32 };
export const NO_BTN = { x: 558, y: 314, w: 64, h: 32 };

function exitBtnRect() {
  const d = dlgRect();
  return { x: d.x + Math.round((d.w - EXIT_BTN.w) / 2), y: EXIT_BTN.y, w: EXIT_BTN.w, h: EXIT_BTN.h };
}

function yesNoRects() {
  const d = dlgRect();
  const gap = 8, w = 64;
  const x0 = d.x + Math.round((d.w - w * 2 - gap) / 2);
  return [
    { x: x0, y: YES_BTN.y, w, h: YES_BTN.h },
    { x: x0 + w + gap, y: NO_BTN.y, w, h: NO_BTN.h },
  ];
}

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

/**
 * A persistent, non-repeating RNG stream for anything a player could exploit
 * by re-opening the screen (rest ambush rolls, tavern games). Prefers the
 * session's registry (survives across opens); a fresh keyed Rand is only the
 * fallback while that contract is not present.
 */
export function sessionRng(session, tag) {
  if (session && typeof session.rngFor === 'function') {
    try { const r = session.rngFor(tag); if (r) return r; } catch { /* fall through */ }
  }
  return new Rand(`${tag}:${(session && session.seed) || 0}:${Date.now() & 0xffff}`);
}

/**
 * Identity text is never ellipsized (names must read in full): try the given
 * face, drop to the small face, then wrap onto two small lines.
 */
export function drawNameFit(ctx, text, cx, y, maxW, o = {}) {
  const s = String(text || '');
  const color = o.color || C_WHITE;
  const face = o.face || 'normal';
  if (F.measure(s, face).w <= maxW) {
    F.drawText(ctx, s, cx, y, { face, align: 'center', color });
    return y + (face === 'small' ? 10 : 12);
  }
  if (F.measure(s, 'small').w <= maxW) {
    F.drawText(ctx, s, cx, y + 1, { face: 'small', align: 'center', color });
    return y + 11;
  }
  const lines = wrapLines(s, maxW, 'small').slice(0, 2);
  let yy = y;
  for (const l of lines) {
    F.drawText(ctx, l, cx, yy, { face: 'small', align: 'center', color });
    yy += 10;
  }
  return yy;
}

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
      // A dim patch under the hot option; the original lights the text only,
      // but the painted panel behind ours is busier than a flat bitmap. It is
      // stippled, because a translucent slab is not an 8-bit thing.
      MM6.stipple(ctx, x, y + 2, w, h - 4, [10, 8, 6], 0.34);
    }
    // Long topics fold onto a second line. MM6 never ends an option in an
    // ellipsis, and the serif face is wide enough that several would.
    const label = wrapLines(it.label, w - 8, 'normal');
    const lh = 12;
    const block = label.length * lh + (it.note ? 11 : 0);
    let ty = y + Math.round((h - block) / 2);
    for (const line of label) {
      F.drawText(ctx, line, x + w / 2, ty, { align: 'center', color: col });
      ty += lh;
    }
    if (it.note) {
      for (const line of wrapLines(it.note, w - 8, 'small').slice(0, 1)) {
        F.drawText(ctx, line, x + w / 2, ty,
          { face: 'small', align: 'center', color: on ? C_CANARY : C_DIM });
      }
    }
    if (hit.click && on) clicked = it.id;
    y += step;
  }
  return clicked;
}

/** The exit plate at the foot of the dialogue column - visible, always. */
export function exitButton(ui, ctx, label = 'Exit', id = 'house:exit') {
  const r = exitBtnRect();
  const hit = ui && ui.region ? ui.region(id, r.x, r.y, r.w, r.h, null) : { hover: false, click: false, down: false };
  A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : 'up');
  F.drawText(ctx, label, r.x + r.w / 2, r.y + (r.h - 11) / 2 + (hit.down ? 1 : 0),
    { align: 'center', color: hit.hover ? C_GOLD : C_WHITE });
  return hit.click;
}

/** Yes / No confirmation pair, in the exit plate's own strip. */
export function yesNo(ui, ctx, idNs = 'confirm') {
  let r = null;
  const rects = yesNoRects();
  const defs = [['yes', rects[0], 'Yes'], ['no', rects[1], 'No']];
  for (const [id, rect, label] of defs) {
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

/** Palettise an ImageData in place, optionally with an ordered-dither offset. */
export function ditherRegion(img, amount = 0) {
  const { data, width, height } = img;
  for (let y = 0; y < height; y++) {
    const row = BAYER4[y & 3];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const t = amount ? (row[x & 3] / 16 - 0.469) * amount : 0;
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
export function washPixels(ctx, x, y, w, h, f, seed = 5, step = 2, dither = 0) {
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
  // No offset by default. The wall and floor painters return exact ramp
  // entries, so an ordered dither on top of them cannot add a colour the
  // palette did not already have - all it does is kick every other pixel to the
  // neighbouring shade, and since the wash is painted at half scale and blown
  // up, that lands on screen as a 2-pixel checkerboard over every flat surface
  // in the room. MM6's software renderer does not dither at all.
  ditherRegion(img, dither);
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

/**
 * Cache a painted backdrop by key. Painters are far too slow for a frame.
 *
 * The finished plate is snapped to the 256-entry palette before it is cached.
 * That is not a nicety: the UI is a 2D canvas layered over the WebGL output, so
 * it never passes through the palette post pass the 3D world does, and anything
 * canvas antialiases - a curve, a diagonal, a half-transparent wash - would
 * otherwise put colours on screen that MM6's frame could not contain. Snapping
 * once at bake time costs nothing per frame and makes the whole painted room
 * genuinely 8-bit no matter how it was drawn.
 */
export function baked(key, w, h, painter) {
  const k = `${key}|${w}x${h}`;
  let c = _baked.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  painter(g, c.width, c.height);
  try {
    const img = g.getImageData(0, 0, c.width, c.height);
    quantizeImageData(img);
    g.putImageData(img, 0, 0);
  } catch { /* tainted or zero-sized canvas: leave the plate as painted */ }
  _baked.set(k, c);
  return c;
}

/** BAYER8 ships flat and normalised to [-0.5, +0.5]. */
function bay8(x, y) { return BAYER8[((y & 7) << 3) | (x & 7)]; }

/**
 * Light, painted into the surface it falls on.
 *
 * MM6 does not draw halos. A lamp is a small bright painted object and the
 * light it throws is *in the wall texture* around it: two or three hard value
 * steps with a dithered outer boundary, over the top of the masonry or the
 * boards, which stay legible underneath. A smooth radial falloff cannot occur
 * in a 256-colour indexed frame at all, and a big additive disc reads as a
 * modern bloom no matter how it is quantised afterwards.
 *
 * So this reads the plate back, lifts it in three quantised steps toward the
 * lamp's colour, and stipples the outermost step. `r` is taken as the caller's
 * idea of "reach" and pulled in hard: the lit patch has to read as a fixture,
 * not as weather.
 */
export function glow(ctx, cx, cy, r, css, strength = 0.5) {
  const c = MM6.hexRGB(css);
  // Deliberately small. A hand painter lit the stone immediately around a
  // sconce and left the rest of the wall alone; anything wider than about a
  // fixture and a half is a bloom whatever it is made of.
  const R = Math.max(4, Math.round(Math.min(r * 0.30, 34)));
  const X = Math.round(cx), Y = Math.round(cy);
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, X - R), y0 = Math.max(0, Y - R);
  const x1 = Math.min(cw, X + R + 1), y1 = Math.min(ch, Y + R + 1);
  if (x1 <= x0 || y1 <= y0) return;
  let img;
  try { img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0); } catch { return; }
  const d = img.data, iw = img.width;
  // Three steps, hard-edged, modest: light that burns its own middle out to
  // white is exactly the bloom this replaces.
  const STEP = [0.36, 0.19, 0.09];
  const s = clamp(strength, 0, 1.2);
  // A machined circle is as much of a tell as a gradient, so the reach wobbles
  // by sector: the boundary is painted, not swept with a compass.
  const SEC = 20;
  const reach = new Float32Array(SEC);
  for (let i = 0; i < SEC; i++) reach[i] = R * (0.80 + hash2(i, R, 13) * 0.32);
  const INV = SEC / (Math.PI * 2);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - X, dy = y - Y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= R * 1.12) continue;
      let si = ((Math.atan2(dy, dx) + Math.PI) * INV) | 0;
      if (si >= SEC) si = SEC - 1;
      const t = dist / reach[si];
      if (t >= 1) continue;
      const b = t < 0.38 ? 0 : t < 0.72 ? 1 : 2;
      // The boundary of a painted light is a 1-bit dither, never a fade.
      if (b === 2 && bay8(x, y) >= 0) continue;
      const i = ((y - y0) * iw + (x - x0)) * 4;
      if (d[i + 3] === 0) continue;
      const k = STEP[b] * s;
      d[i] = Math.min(255, d[i] + c[0] * k);
      d[i + 1] = Math.min(255, d[i + 1] + c[1] * k);
      d[i + 2] = Math.min(255, d[i + 2] + c[2] * k);
    }
  }
  ctx.putImageData(img, x0, y0);
}

/**
 * Scanline polygon fill.
 *
 * Canvas antialiases every diagonal it fills, and a feathered edge is the one
 * thing an indexed frame genuinely cannot hold - quantising it afterwards just
 * turns the feather into a fringe of wrong colours. Every span here is an
 * integer fillRect, so the silhouette is cut, not faded.
 */
export function poly(ctx, pts, css) {
  const n = pts.length >> 1;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pts[i * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  ctx.fillStyle = typeof css === 'string' ? css : MM6.pc(css);
  const xs = [];
  for (let y = Math.round(minY); y <= Math.round(maxY); y++) {
    xs.length = 0;
    const sy = y + 0.5;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = pts[j * 2 + 1], by = pts[i * 2 + 1];
      if ((ay <= sy) === (by <= sy)) continue;
      xs.push(pts[j * 2] + ((sy - ay) / (by - ay)) * (pts[i * 2] - pts[j * 2]));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.round(xs[k]), ex = Math.round(xs[k + 1]);
      if (ex > sx) ctx.fillRect(sx, y, ex - sx, 1);
    }
  }
}

/**
 * A person standing in the room: shaded form, a face, clothing with folds.
 *
 * The old signature took a body colour and a rim colour because everyone in
 * town was a flat black cloak-and-circle silhouette. Both are still accepted -
 * and ignored - but what comes out is a painted figure, not a blob.
 *
 * The seed is the whole trick. figures.js picks pose, build, wardrobe and face
 * off it, so two people who happen to stand at the same table need genuinely
 * different seeds or they come out as the same mannequin twice. Callers that
 * care pass `seed` explicitly; the fallback hashes the position hard enough
 * that a 12-pixel step changes the person.
 */
export function figure(ctx, x, y, h, bodyCss, rimCss, o = {}) {
  const seed = o.seed !== undefined
    ? (o.seed >>> 0)
    : (Math.round(hash2(Math.round(x) * 31 + 7, Math.round(y) * 17 + Math.round(h) * 53, 91)
      * 4294967295) >>> 0);
  const look = Figures.figureLook(seed);
  Figures.paintedFigure(ctx, x, y, h, {
    seed,
    cloth: o.cloth || look.cloth,
    skin: o.skin || look.skin,
    hair: o.hair || look.hair,
    hood: o.hood !== undefined ? o.hood : look.hood,
    robe: o.robe !== undefined ? o.robe : look.robe,
    beard: o.beard !== undefined ? o.beard : look.beard,
    longHair: o.longHair !== undefined ? o.longHair : look.longHair,
    hat: o.hat,
    hatColor: o.hatColor,
    apron: o.apron,
    boots: o.boots,
    eye: o.eye,
    shadow: o.shadow,
  });
}

/**
 * A seed that lands a figure on a chosen pose.
 *
 * figures.js selects its pose with `seed % 11` against a fixed table, and two
 * of those eleven fling both arms straight out from the shoulder. That is fine
 * for a patron caught mid-argument in the middle distance; on a shopkeeper
 * painted 110 pixels tall at the front of the room it puts two lit fists in
 * mid-air that read as tankards. `salt` still varies build, wardrobe, hair and
 * face, so two people given the same pose are not the same person.
 */
export const POSE = {
  stand: 0, hipshot: 1, folded: 2, onehip: 3, raised: 4, lean: 5,
  reach: 6, behind: 7, wide: 8, slouch: 9, point: 10,
};

export function poseSeed(pose, salt = 0) {
  return (((POSE[pose] || 0) + 11 * (salt >>> 0)) >>> 0);
}

/**
 * A fire.
 *
 * MM6 draws fire as an overlapping cluster of small particle tongues tinted
 * around #FF3C1E with 1-bit alpha and no falloff - never as a row of separate
 * saw-teeth. Three things make the difference: an ember bar at the base that is
 * brighter than anything above it, tongues laid out on a bell so the middle of
 * the fire is the tallest part, and enough of them that they overlap instead of
 * standing side by side.
 */
export function paintFire(g, cx, baseY, w, h, seed = 3) {
  const n = Math.max(5, Math.round(w / 6));
  // Ember bed: a hot bar, banded, brightest at the top where the flame leaves.
  const EMBER = [[104, 26, 10], [158, 44, 14], [214, 84, 22], [255, 156, 52]];
  for (let i = 0; i < EMBER.length; i++) {
    const k = Math.max(1, Math.round(w * (0.50 - i * 0.055)));
    MM6.rct(g, Math.round(cx - k), Math.round(baseY) - i, k * 2, 1, EMBER[i]);
  }
  const tongues = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const off = (t - 0.5) * w * 0.90;
    const bell = 1 - Math.abs(t - 0.5) * 1.30;
    const jitter = hash2(i * 13, seed | 0, 7);
    tongues.push([
      cx + off,
      Math.round(baseY - 1 - Math.abs(off) * 0.08),
      Math.max(5, w * 0.30 * (0.72 + bell * 0.45 + jitter * 0.20)),
      Math.max(6, h * (0.34 + bell * 0.70 + jitter * 0.18)),
    ]);
  }
  // Short outer tongues sit behind the tall middle ones.
  tongues.sort((a, b) => a[3] - b[3]);
  for (let i = 0; i < tongues.length; i++) {
    const t = tongues[i];
    MM6.flame(g, t[0], t[1], t[2], t[3], i * 1.9 + (seed | 0));
  }
}

/**
 * Coursed masonry: chimney breasts, forge hoods, vault jambs.
 *
 * §12 of the spec puts grey stone block at #5E5E58-#9A9A90 with #3C3C38 joints,
 * 20-40 px ashlar and heavy chiselled bevels, so that is what this is: per-block
 * value jitter on a running bond, a lit top arris and a shadowed underside on
 * every block, and no flat fill anywhere. A flat grey rectangle behind a fire is
 * the thing this replaces.
 */
export function paintMasonry(g, x, y, w, h, o = {}) {
  const bw = o.block || 34, bh = o.course || 15;
  const lo = o.lo || [24, 22, 19], hi = o.hi || [116, 110, 98];
  const seed = o.seed || 71;
  const X = Math.round(x), Y = Math.round(y), W = Math.round(w), H = Math.round(h);
  for (let j = 0; j < H; j++) {
    const row = Math.floor(j / bh);
    const off = (row & 1) * Math.round(bw / 2);
    const inCourse = j - row * bh;
    for (let i = 0; i < W; i++) {
      const bx = (i + off) % bw;
      const joint = bx < 2 || inCourse < 2;
      const blk = hash2(Math.floor((i + off) / bw), row, seed);
      // Chisel: the top of each block catches, the bottom falls away.
      const bevel = inCourse < 4 ? 0.10 : inCourse > bh - 5 ? -0.09 : 0;
      const edge = bx < 4 ? 0.07 : bx > bw - 4 ? -0.07 : 0;
      const v = joint ? 0.12 : 0.36 + blk * 0.28 + bevel + edge - (j / H) * 0.10;
      MM6.rct(g, X + i, Y + j, 1, 1, MM6.mix(lo, hi, MM6.band(clamp(v, 0, 1), 7)));
    }
  }
}

/**
 * A woven carpet lying on the boards, keystoned by the viewing angle.
 *
 * A flat ellipse with a ring of dots round it is a shape; a rug has a ground, a
 * border band, a repeating figure in the field and a fringe of real threads
 * along the near edge, and it is wider at the front than at the back.
 */
export function paintRug(g, cx, cy, halfDepth, farHalf, nearHalf, name = 'blood') {
  const CX = Math.round(cx), CY = Math.round(cy), D = Math.max(3, Math.round(halfDepth));
  for (let dy = -D; dy <= D; dy++) {
    const t = (dy + D) / (2 * D);
    const k = Math.round(farHalf + (nearHalf - farHalf) * t);
    // Three zones, all inside the rug's own ramp bar one muted ochre band: a
    // saturated field ringed in bright cream reads as a flag, not as wool.
    const v = 1 + Math.round(t * 2);
    MM6.rct(g, CX - k, CY + dy, k * 2, 1, rampCss(name, v));
    const b1 = Math.round(k * 0.92), b2 = Math.round(k * 0.82);
    if (b1 > 4) MM6.rct(g, CX - b1, CY + dy, b1 * 2, 1, rampCss('sand', 2 + Math.round(t * 2)));
    if (b2 > 4 && Math.abs(dy) < D - 3) MM6.rct(g, CX - b2, CY + dy, b2 * 2, 1, rampCss(name, v + 3));
    if (b2 > 24 && (dy + D) % 7 === 3) {
      const step = Math.max(9, Math.round(14 * (0.7 + t * 0.5)));
      for (let x = -b2 + 10; x < b2 - 10; x += step) {
        MM6.rct(g, CX + x, CY + dy, Math.max(3, Math.round(step * 0.4)), 1, rampCss('sand', 6));
      }
    }
    // The long edges catch where the pile turns up.
    MM6.rct(g, CX - k, CY + dy, 1, 1, rampCss(name, v + 4));
    MM6.rct(g, CX + k - 1, CY + dy, 1, 1, rampCss(name, Math.max(0, v - 1)));
  }
  MM6.rct(g, CX - Math.round(farHalf), CY - D, Math.round(farHalf) * 2, 1, rampCss(name, 6));
  // Fringe: a continuous run of threads, not a dotted rule.
  for (let x = -Math.round(nearHalf) + 4; x < nearHalf - 4; x += 2) {
    MM6.rct(g, CX + x, CY + D + 1, 1, 2 + (((x >> 1) & 1) ? 1 : 0),
      rampCss('sand', 5 + ((x >> 1) & 1)));
  }
}

/**
 * The shadow an object throws on the surface behind it.
 *
 * Read the plate back and multiply it down in three hard steps, so the masonry
 * or the boards stay legible inside the shadow. The obvious alternative - a
 * Bayer stipple - is what gave every shelf and counter in these rooms a
 * period-2 black rule along its bottom edge that reads exactly like CSS
 * `border-style: dotted`. A stipple is the right tool for a *boundary*; it is
 * the wrong tool for an area, and a four-pixel band is all boundary.
 */
export function castShadow(ctx, x, y, w, h, strength = 0.5) {
  const X = Math.max(0, Math.round(x)), Y = Math.max(0, Math.round(y));
  const W = Math.min(ctx.canvas.width - X, Math.round(w));
  const H = Math.min(ctx.canvas.height - Y, Math.round(h));
  if (W <= 0 || H <= 0) return;
  let img;
  try { img = ctx.getImageData(X, Y, W, H); } catch { return; }
  const d = img.data;
  for (let j = 0; j < H; j++) {
    // Three steps down the band, quantised: banding is the look, not a defect.
    const k = 1 - clamp(strength, 0, 1) * (1 - MM6.band(j / Math.max(1, H - 1), 3));
    for (let i = 0; i < W; i++) {
      const p = (j * W + i) * 4;
      if (d[p + 3] === 0) continue;
      d[p] *= k; d[p + 1] *= k; d[p + 2] *= k;
    }
  }
  ctx.putImageData(img, X, Y);
}

/** A contact shadow: the dark the object sits in, stippled, never a soft blob. */
export function contactShadow(g, cx, y, halfW, halfH = 3) {
  const HW = Math.max(1, Math.round(halfW));
  const HH = Math.max(1, Math.round(halfH));
  for (let dy = -HH; dy <= HH; dy++) {
    const k = Math.round(HW * Math.sqrt(Math.max(0, 1 - (dy * dy) / (HH * HH))));
    if (k <= 0) continue;
    // Umbra and penumbra: two hard steps multiplied into the boards, so the
    // grain stays legible inside the shadow. Nothing here is stippled - a
    // dither round the foot of every barrel reads as a dotted selection box.
    castShadow(g, Math.round(cx) - k, Math.round(y) + dy, k * 2, 1, 0.34);
    const core = Math.round(k * 0.62);
    if (core > 0) castShadow(g, Math.round(cx) - core, Math.round(y) + dy, core * 2, 1, 0.52);
  }
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

/**
 * A shelf plank: a carved edge, not a rule.
 *
 * A period-2 dotted line reads as `border-style: dotted` and is the loudest
 * CSS tell in the set. A plank in a painted interior is a lit arris along the
 * top nose, the board face below it, a dark undercut, and then the shadow the
 * nose throws on the wall - which falls off in one hard line and one short
 * Bayer skirt, because that is the only partial coverage 8 bits has.
 */
export function paintShelf(g, x, y, w, o = {}) {
  const th = Math.max(3, o.th || 4);
  const X = Math.round(x), Y = Math.round(y), W = Math.round(w);
  MM6.rct(g, X, Y, W, th, ramp('wood', 6));
  MM6.rct(g, X, Y, W, 1, ramp('wood', 11));            // lit arris
  MM6.rct(g, X, Y + 1, W, 1, ramp('wood', 8));
  MM6.rct(g, X, Y + th - 1, W, 1, ramp('wood', 2));    // undercut
  // Grain along the board, so the plank is not one flat bar.
  for (let i = 0; i < W; i += 7) {
    const n = hash2(i, Y, 17);
    MM6.rct(g, X + i, Y + 1 + ((n * 2) | 0), Math.max(2, 3 + ((n * 5) | 0)), 1, ramp('wood', n > 0.5 ? 7 : 5));
  }
  MM6.rct(g, X, Y + th, W, 1, ramp('wood', 0));        // cast shadow, hard line
  castShadow(g, X, Y + th + 1, W, Math.max(1, o.shadow === undefined ? 6 : o.shadow), 0.55);
  // Brackets under the board, so it is fixed to something.
  if (o.brackets !== false) {
    for (let i = 12; i < W - 8; i += 64) {
      MM6.rct(g, X + i, Y + th, 3, 5, ramp('wood', 3));
      MM6.rct(g, X + i, Y + th, 1, 5, ramp('wood', 6));
    }
  }
}

/** Heavy counter across the foreground. */
export function paintCounter(g, x, y, w, h, o = {}) {
  const X = Math.round(x), Y = Math.round(y), W = Math.round(w), H = Math.round(h);
  MM6.rct(g, X, Y, W, H, ramp('wood', 5));
  // The top surface catches the room light; the front falls away below it.
  MM6.rct(g, X, Y, W, 3, ramp('wood', 9));
  MM6.rct(g, X, Y, W, 1, ramp('wood', 12));            // arris
  MM6.rct(g, X, Y + 3, W, 1, ramp('wood', 3));         // shadow under the nose
  for (let i = X + 8; i < X + W; i += 27) {
    MM6.rct(g, i, Y + 4, 1, H - 4, ramp('wood', 3));
    MM6.rct(g, i + 1, Y + 4, 1, H - 4, ramp('wood', 7));
  }
  // Plank grain on the front face.
  for (let i = 0; i < W; i += 5) {
    const n = hash2(i, Y + 3, 41);
    if (n > 0.62) MM6.rct(g, X + i, Y + 6 + ((n * (H - 9)) | 0), 4, 1, ramp('wood', 4));
  }
  MM6.rct(g, X, Y + H - 2, W, 2, ramp('wood', 1));
  if (o.cloth) {
    MM6.rct(g, X + 10, Y + 3, W - 20, 5, ramp(o.cloth, 6));
    MM6.rct(g, X + 10, Y + 3, W - 20, 1, ramp(o.cloth, 9));
  }
}

/**
 * Barrel, crate, sack - the clutter every MM6 interior has in its corners.
 *
 * Each is a small painted object: a lit face turned to the room's key light, a
 * shadow face away from it, and the dark it sits in. `x, y` is the near-left
 * foot; `s` is the height.
 */
export function paintClutter(g, x, y, kind, s = 20) {
  const S = Math.max(8, Math.round(s));
  const X = Math.round(x), Y = Math.round(y);
  if (kind === 'barrel') {
    const hw = Math.round(S * 0.40);
    const cx = X + hw;
    contactShadow(g, cx + 2, Y, hw * 1.25, Math.max(2, S * 0.11));
    // Staves: the belly bulges, so the silhouette swells at the middle and the
    // value turns across it rather than stepping once down the side.
    for (let i = 0; i < S; i++) {
      const t = i / S;
      const belly = 1 - Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.18;
      const k = Math.max(2, Math.round(hw * belly));
      for (let dx = -k; dx <= k; dx++) {
        // Key light upper-left: a five-step turn across the barrel.
        const u = (dx + k) / (2 * k);
        const v = MM6.band(1 - Math.abs(u - 0.30) * 1.45, 5);
        const grain = hash2(dx + 40, i, 23) * 0.10 - 0.05;
        MM6.rct(g, cx + dx, Y - S + i, 1, 1,
          MM6.mix([44, 28, 14], [148, 108, 62], clamp(v + grain, 0, 1)));
      }
    }
    for (let sx = -hw; sx <= hw; sx += 4) {
      MM6.rct(g, cx + sx, Y - S + 2, 1, S - 4, [38, 24, 12]);
    }
    // Iron hoops: a dark band with one lit pixel row along its top.
    for (const hy of [Math.round(S * 0.14), Math.round(S * 0.52), Math.round(S * 0.88)]) {
      const t = hy / S;
      const belly = 1 - Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.18;
      const k = Math.max(2, Math.round(hw * belly)) + 1;
      MM6.rct(g, cx - k, Y - S + hy, k * 2, 2, [52, 50, 46]);
      MM6.rct(g, cx - k, Y - S + hy, k * 2, 1, [122, 118, 110]);
      MM6.rct(g, cx + Math.round(k * 0.35), Y - S + hy, Math.round(k * 0.65), 2, [30, 28, 26]);
    }
    // Lid, seen slightly from above.
    const lh = Math.max(2, Math.round(S * 0.11));
    for (let dy = -lh; dy <= lh; dy++) {
      const k = Math.round(hw * 0.92 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (lh * lh))));
      if (k <= 0) continue;
      MM6.rct(g, cx - k, Y - S + dy, k * 2, 1,
        MM6.mix([70, 50, 28], [166, 128, 78], MM6.band((dy + lh) / (2 * lh), 4)));
    }
    MM6.rct(g, cx - Math.round(hw * 0.9), Y - S - lh + 1, Math.round(hw * 1.8), 1, [186, 150, 96]);
  } else if (kind === 'crate') {
    const d = Math.max(3, Math.round(S * 0.26));      // how far the top face runs back
    contactShadow(g, X + S / 2 + 2, Y, S * 0.72, Math.max(2, S * 0.10));
    // Front face: boards with seams, lit from the upper left.
    for (let i = 0; i < S; i++) {
      const t = i / S;
      const v = MM6.band(0.72 - t * 0.34, 5);
      MM6.rct(g, X, Y - S + i, S, 1, MM6.mix([34, 22, 12], [138, 100, 58], v));
    }
    for (let i = 3; i < S; i += Math.max(4, Math.round(S / 4))) {
      MM6.rct(g, X, Y - S + i, S, 1, [40, 26, 14]);
      MM6.rct(g, X, Y - S + i + 1, S, 1, [116, 84, 48]);
    }
    // Diagonal brace, painted as two bars rather than a keyline.
    for (let i = 0; i < S; i++) {
      MM6.rct(g, X + i, Y - S + i, 2, 1, [96, 68, 38]);
      MM6.rct(g, X + i, Y - S + i + 2, 2, 1, [48, 32, 16]);
    }
    // Top face: a parallelogram running back and to the right, and brighter.
    poly(g, [X, Y - S, X + d, Y - S - d, X + S + d, Y - S - d, X + S, Y - S],
      MM6.pc([158, 118, 70]));
    poly(g, [X + 1, Y - S - 1, X + d, Y - S - d + 1, X + S + d - 2, Y - S - d + 1, X + S - 1, Y - S - 1],
      MM6.pc([176, 134, 82]));
    // Right face, in shadow.
    poly(g, [X + S, Y - S, X + S + d, Y - S - d, X + S + d, Y - d, X + S, Y],
      MM6.pc([62, 42, 22]));
    MM6.rct(g, X + S, Y - S, 1, S, [30, 20, 10]);
  } else {
    // Sack: a slumped bag, wide at the foot, gathered and tied at the neck.
    const hw = Math.round(S * 0.34);
    const cx = X + hw;
    contactShadow(g, cx + 1, Y, hw * 1.30, Math.max(2, S * 0.11));
    const neck = Math.round(S * 0.72);
    for (let i = 0; i < S; i++) {
      const t = i / S;                                 // 0 at the top of the sack
      // Slumped profile: pinched at the tie, swelling to the floor.
      const prof = t < 0.26
        ? 0.30 + t * 0.9
        : 0.54 + Math.sin(Math.min(1, (t - 0.26) / 0.74) * 2.2) * 0.52;
      const k = Math.max(1, Math.round(hw * prof));
      for (let dx = -k; dx <= k; dx++) {
        const u = (dx + k) / (2 * k);
        const v = MM6.band(1 - Math.abs(u - 0.32) * 1.30 - t * 0.16, 5);
        const weave = ((dx + i) & 3) === 0 ? -0.06 : 0;
        MM6.rct(g, cx + dx, Y - S + i, 1, 1,
          MM6.mix([56, 44, 26], [206, 180, 128], clamp(v + weave, 0, 1)));
      }
      // Creases pulling down from the tie.
      if (t > 0.30 && ((i * 3) % 11) === 2) {
        MM6.rct(g, cx - Math.round(k * 0.4), Y - S + i, Math.max(1, Math.round(k * 0.5)), 1, [92, 74, 46]);
      }
    }
    MM6.rct(g, cx - Math.round(hw * 0.34), Y - S + neck - Math.round(S * 0.62), Math.round(hw * 0.68), 2, [92, 66, 32]);
    MM6.rct(g, cx - Math.round(hw * 0.36), Y - S + 1, Math.round(hw * 0.72), 1, [230, 208, 158]);
  }
}

/**
 * A darkened plate over the illustration - MM6 draws its house text and item
 * grids straight onto the painting, with the art dimmed behind them.
 */
export function plate(ctx, x, y, w, h, alpha = 0.62) {
  // A 256-colour frame cannot hold a translucent slab, so the art is knocked
  // back with a Bayer stipple instead - the same trick the originals use to
  // darken a painting under a block of text - and the edge is a carved lip.
  const d = alpha + 0.22;
  if (d >= 0.9) {
    // Past this weight the dither stops reading as shading and starts reading
    // as speckle in the text, so the core goes solid and only a six-pixel
    // skirt stays stippled, which is what keeps the plate sitting *on* the
    // painting rather than floating over it.
    const X = x | 0, Y = y | 0, W = w | 0, H = h | 0;
    MM6.stipple(ctx, X, Y, W, H, [10, 9, 8], 0.94);
    MM6.rct(ctx, X + 6, Y + 6, W - 12, H - 12, [10, 9, 8]);
  } else {
    MM6.stipple(ctx, x | 0, y | 0, w | 0, h | 0, [10, 9, 8], Math.min(0.92, d));
  }
  MM6.rct(ctx, x | 0, y | 0, w | 0, 1, [26, 22, 18]);
  MM6.rct(ctx, x | 0, y | 0, 1, h | 0, [26, 22, 18]);
  MM6.rct(ctx, x | 0, (y + h - 1) | 0, w | 0, 1, [104, 92, 74]);
  MM6.rct(ctx, (x + w - 1) | 0, y | 0, 1, h | 0, [104, 92, 74]);
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
    // House screens paint their own visible Exit plate at the foot of the
    // dialogue column, so the shell must not paint its fallback plate over the
    // panel's bottom-right (it used to bury the shop nameplate band).
    this.hasVisibleExit = true;
    /** Panel-info scroll offset (rows), for long dialogue replies. */
    this.infoScroll = 0;
    this._infoDrag = null;
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

    // No house name here. MM6's dialogue panel opens on the proprietor's
    // portrait; the establishment's name is announced on the status line when
    // you walk in, never printed as a gold header over the panel.

    this.drawKeeper(ctx);
    this.drawPanelInfo(ctx);

    const opts = this.options();
    // Compress the row pitch when a long option list would run under the
    // Exit plate (six shop services at the stock 30px step end at y=326).
    // While there is reply text to show, a MINIMUM reading window is reserved
    // below the options - the offer terms of a long quest list used to get
    // room for zero lines, so players accepted blind (ui3 #2). Options
    // compress further (floor 16px) before the reply window gives an inch.
    const hasInfo = !!(this.panelInfo && this.panelInfo().length);
    const reserve = hasInfo ? (this.offering ? 68 : 46) : 0;
    const step = opts.length
      ? Math.max(16, Math.min(OPTION.step,
        Math.floor((EXIT_BTN.y - 6 - reserve - this.optionY) / opts.length)))
      : OPTION.step;
    this._optStep = step;
    const clicked = optionList(this.ui, ctx, opts, { ns: this.id, y: this.optionY, step, h: Math.min(OPTION.h, step) });
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
    // Names are identity: shrink or wrap, never "Gregor Merriweat...".
    const ny = drawNameFit(ctx, k.name || 'Proprietor', p.x + p.w / 2, p.y + p.h + 6, 150,
      { color: C_BLUE });
    if (k.title) {
      F.drawText(ctx, k.title, p.x + p.w / 2, ny + 2,
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
    const raw = this.panelInfo ? this.panelInfo() : [];
    if (!raw.length) return;
    // Wrap first, then fit. The serif face is proportional, so the number of
    // rows is only known after measuring. Long replies are never dropped:
    // the block scrolls (wheel + drag) and a "More..." chip pages through it,
    // so quest terms always reach the player in full.
    const colW = d.w - 24;
    const rows = [];
    for (const l of raw) {
      const s = typeof l === 'string' ? l : l.text;
      const color = (l && l.color) || C_WHITE;
      for (const line of wrapLines(s, colW, 'small')) rows.push({ line, color });
    }
    const optCount = this.options ? this.options().length : 0;
    const lastOpt = this.optionY + optCount * (this._optStep || OPTION.step);
    const top = lastOpt + 10;
    // Bounded by the exit plate; the party bar paints over everything past 352.
    const bottom = Math.min(EXIT_BTN.y - 8, d.y + d.h - 2);
    const lh = 11;
    const room = Math.max(1, Math.floor((bottom - top) / lh));
    const overflow = rows.length > room;
    // At least ONE line always shows, and the More chip ALWAYS draws on
    // overflow - room-1 hitting zero used to blank the reply AND skip the
    // chip, hiding quest terms entirely (ui3 #2).
    const visible = overflow ? Math.max(1, room - 1) : room;
    const maxScroll = Math.max(0, rows.length - visible);
    let s = Math.max(0, Math.min(maxScroll, this.infoScroll | 0));

    if (overflow) {
      // Wheel over the column scrolls the reply.
      const overCol = this.ui.inRect(d.x, top - 6, d.w, bottom - top + 12);
      if (this.ui.mouse.wheel && overCol) s += Math.sign(this.ui.mouse.wheel) * 2;
      // Touch drag over the text block scrolls it too.
      const st = this._infoDrag || (this._infoDrag = { on: false, y: 0, acc: 0 });
      if (this.ui.mouse.down && overCol) {
        if (!st.on) { st.on = true; st.y = this.ui.mouse.y; st.acc = 0; }
        else {
          st.acc += -(this.ui.mouse.y - st.y) / lh;
          st.y = this.ui.mouse.y;
          const r = Math.trunc(st.acc);
          if (r) { s += r; st.acc -= r; }
        }
      } else st.on = false;
      s = Math.max(0, Math.min(maxScroll, s));
    } else s = 0;
    this.infoScroll = s;

    const shown = rows.slice(s, s + Math.min(rows.length, visible));
    if (!shown.length) return;
    let y = overflow ? top : Math.min(bottom - shown.length * lh, top);
    A.divider(ctx, d.x + 14, y - 8, d.w - 28);
    for (const r of shown) {
      F.drawText(ctx, r.line, d.x + d.w / 2, y, {
        face: 'small', align: 'center', color: r.color,
      });
      y += lh;
    }
    if (overflow) {
      // The "More..." chip: pages forward, wrapping back to the top.
      const label = s < maxScroll ? 'More...' : 'Back to top';
      const cw = 90, cx = d.x + Math.round((d.w - cw) / 2);
      const hit = this.ui.region(`${this.id}:info:more`, cx, y - 2, cw, lh + 4, 'More of the reply');
      F.drawText(ctx, label, d.x + d.w / 2, y, {
        face: 'small', align: 'center', color: hit.hover ? C_GOLD : C_CANARY,
      });
      if (hit.click) {
        this.infoScroll = s < maxScroll ? Math.min(maxScroll, s + visible) : 0;
        this.sound('page_turn');
      }
    }
  }

  panelInfo() {
    return [{ text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY }];
  }

  /** Transient reply text, printed over the bottom of the illustration. */
  drawMessage(ctx) {
    // A screen showing its own footer band (the shop's hover price strip)
    // suppresses the toast so the price is never covered (ui3 #5).
    if (this._suppressToast) return;
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
    // Never greet as "undefined": whatever record arrives gets a name.
    if (!this.npc.name) this.npc = Object.assign({}, DEFAULT_NPC, this.npc, { name: DEFAULT_NPC.name });
    this.keeper = this.npc;
    this.title = opts.title || this.npc.house || this.npc.name;
    this.optionY = OPTION.npcY;
    this.exitLabel = 'Goodbye';
    this.body = this.npc.greeting
      || `${this.npc.name}${this.npc.title ? `, ${String(this.npc.title).toLowerCase()},` : ''} looks you over.`;
    this.shown = 0;
    this.expression = 'normal';
    this.teachMode = false;
    this.offering = null;    // quest whose offer text is on screen
    this.reward = null;
    this.rnd = rngFor(`dlg:${this.npc.name}`);
    this.interior = opts.interior || 'house';
  }

  onOpen() {
    this.shown = 0;
    // Talking to somebody IS a quest event: deliver/find quests complete here.
    const party = this.session && this.session.party;
    if (party && party.quests && !Array.isArray(party.quests)) {
      const changed = dispatchQuestEvent(party, {
        type: 'talk', npcId: this.npc.npcId || this.npc.name,
      });
      for (const q of changed) {
        if (q.state === 'complete') say(this.session, `Quest complete: ${q.title}.`, C_GOLD);
      }
    }
  }

  /**
   * The live quest this NPC should be talking about, from the real pipeline:
   * turn-ins first, then in-progress, then fresh offers whose gates are open.
   */
  questRef() {
    const refs = this.npc.questRefs || [];
    if (!refs.length) return null;
    const rank = { complete: 0, active: 1, available: 2, rewarded: 3 };
    let best = null;
    for (const q of refs) {
      if (!q || q.state === 'failed' || q.state === 'unavailable') continue;
      if (!best || (rank[q.state] ?? 9) < (rank[best.state] ?? 9)) best = q;
    }
    return best;
  }

  setBody(s, expression) {
    this.body = String(s || '');
    this.shown = 0;
    this.infoScroll = 0;   // a new reply always starts at its first line
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
    // While an offer is on the table the offer IS the conversation: two
    // options, so the terms get the whole reply window and are read in full
    // BEFORE Accept (ui3 #2 - players accepted blind past a 7-topic list).
    if (this.offering) {
      return [
        { id: 'accept', label: 'Accept the Task' },
        { id: 'decline', label: 'Not Now' },
      ];
    }
    const q = this.questRef();
    if (q) {
      const label = q.state === 'complete' ? 'Reward'
        : q.state === 'active' ? q.title
          : q.state === 'available' ? q.title : null;
      if (label) out.push({ id: 'questref', label });
    }
    if (n.quest && this.questState() !== 'done') out.push({ id: 'quest', label: n.quest.topic || 'Quest' });
    if (n.teaches && n.teaches.length) out.push({ id: 'teach', label: 'Learn Skill' });
    if (n.hire) out.push(this.isHired() ? { id: 'dismiss', label: 'Dismiss' } : { id: 'hire', label: 'Hire' });
    if (n.join) out.push({ id: 'join', label: this.isMember() ? 'Membership' : 'Join' });
    for (const t of (n.topics || [])) out.push({ id: t.id, label: t.label });
    if (n.talk && n.profession) out.push({ id: 'smalltalk', label: n.profession });
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
      case 'questref': this.doQuestRef(); return;
      case 'accept': this.doAccept(); return;
      case 'decline':
        this.offering = null;
        this.setBody('"Think it over, then. The work will keep - for a while."');
        return;
      case 'smalltalk': this.setBody(n.talk || '...', 'smile'); return;
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

  // --- the real quest pipeline (session.questPool / party.quests) -----------

  doQuestRef() {
    const q = this.questRef();
    if (!q) return;
    const party = this.session && this.session.party;
    if (q.state === 'available') {
      // Read the offer; Accept appears as its own option so taking the job is
      // a deliberate act, not a side effect of listening.
      this.offering = q;
      this.setBody(q.text || 'There is work, if you want it.');
      return;
    }
    if (q.state === 'active') {
      this.setBody(`"Not done yet?"\n${questProgressText(q)}`);
      return;
    }
    if (q.state === 'complete') {
      const reward = turnInQuest(party, q.id, (members, xp) => awardXP(members, xp));
      if (!reward) { this.setBody('Something is not right with your claim.'); return; }
      party.questsDone = (party.questsDone | 0) + 1;
      if (reward.pendingItem) {
        const p = this.session.modules && this.session.modules.partyMod;
        if (p && p.giveItem) p.giveItem(party, reward.pendingItem);
      }
      this.reward = { gold: reward.gold || 0, xp: reward.xp || 0 };
      this.sound('quest_complete');
      this.setBody(`"Well done." You receive ${gold(reward.gold || 0)} gold and ${gold(reward.xp || 0)} experience`
        + `${reward.pendingItem ? `, and ${reward.pendingItem.name || 'an item'}` : ''}.`, 'smile');
      say(this.session, `Quest complete: ${q.title}.`, C_GOLD);
      // Turning in a beat can open the next one on this same NPC.
      const pool = this.session.questPool || [];
      refreshGating(pool.concat(Object.values(party.quests || {})));
      updateAwards(party, { killsByKind: party.killsByKind || {}, questsDone: party.questsDone | 0 });
      if (this.session.attachQuestNPCs) this.session.attachQuestNPCs(q.region);
      return;
    }
    this.setBody('You have done all I could ask of you.', 'smile');
  }

  doAccept() {
    const q = this.offering;
    this.offering = null;
    const party = this.session && this.session.party;
    if (!q || !party) return;
    giveQuest(party, q);
    this.setBody('"Good. Do not dawdle." The task is noted in your log.', 'smile');
    say(this.session, `Quest accepted: ${q.title}.`, C_GOLD);
    if (q.type === 'escort' && this.session.spawnEscort) this.session.spawnEscort(q);
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

  /**
   * MM6 never covers the interior with a text slab: the painting stays clear
   * and the reply is printed in the right-hand panel under the topic list.
   * Clicking anywhere on the painting finishes the typewriter reveal.
   */
  drawContent(ctx) {
    if (this.ui && this.ui.region) {
      const hit = this.ui.region('dlg:body', PANEL.x, PANEL.y, PANEL.w, PANEL.h);
      if (hit.click) this.shown = this.body.length;
    }
  }

  /** The NPC's reply, wrapped into the dialogue column. */
  panelInfo() {
    const out = [];
    const shown = this.body.slice(0, Math.floor(this.shown));
    if (shown) out.push({ text: shown, color: C_WHITE });
    if (this.reward) {
      out.push({
        text: `+${gold(this.reward.gold)} gold, +${gold(this.reward.xp)} experience`,
        color: C_CANARY,
      });
    }
    if (this.isHired()) {
      out.push({ text: `In your service - ${this.npc.hire.wage}g/day`, color: C_LEARN });
    }
    return out;
  }

  drawMessage() { /* the reply lives in the dialogue column */ }

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
  g.fillStyle = rampCss('wood', 7); g.fillRect(wx - 5, wy - 5, ww + 10, 2);
  // Glazing: banded daylight, a diagonal reflection across each pane and old
  // green glass at the edges. A flat white quad has no glass in it.
  for (let y = 0; y < wh; y++) {
    const t = MM6.band(y / wh, 6);
    for (let x = 0; x < ww; x++) {
      const edge = Math.min(x, ww - 1 - x, y, wh - 1 - y) < 3 ? 0.82 : 1;
      const refl = ((x + y * 0.6) % 34) < 6 ? 1.14 : 1;
      MM6.rct(g, wx + x, wy + y, 1, 1,
        MM6.shade(MM6.mix([214, 230, 244], [148, 176, 204], t), edge * refl));
    }
  }
  g.fillStyle = rampCss('wood', 6);
  g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  g.fillStyle = rampCss('wood', 9);
  g.fillRect(wx + ww / 2 - 2, wy, 1, wh);
  g.fillRect(wx, wy + wh / 2 - 2, ww, 1);
  // Daylight painted into the plaster round the reveal, not a halo over it.
  glow(g, wx + ww / 2, wy + wh / 2, 132, '#fff0c0', 0.42);

  // The patch the window throws on the boards. A painter of the period drew the
  // patch, keystoned by the viewing angle and stepped in a few flat bands; the
  // air between window and floor stays unpainted, because MM6 has no shafts.
  MM6.litPatch(g, wx + ww / 2 + 14, horizon, ww * 0.44, h - 2, ww * 0.80, '#9c8250', 4);

  // Hearth on the right.
  paintMasonry(g, w - 132, horizon - 98, 108, 98, { block: 30, course: 14, seed: 83 });
  MM6.rct(g, w - 136, horizon - 98, 116, 6, MM6.pc([78, 70, 58]));
  MM6.rct(g, w - 136, horizon - 98, 116, 2, MM6.pc([130, 120, 100]));
  MM6.rct(g, w - 136, horizon - 92, 116, 2, MM6.pc([22, 20, 17]));
  // The firebox is a black socket; the fire sits inside it, not on top of it.
  g.fillStyle = '#0d0602';
  g.fillRect(w - 118, horizon - 62, 76, 62);
  MM6.rct(g, w - 118, horizon - 62, 76, 3, [5, 3, 1]);
  MM6.rct(g, w - 118, horizon - 62, 4, 62, [5, 3, 1]);
  MM6.rct(g, w - 46, horizon - 62, 4, 62, [5, 3, 1]);
  MM6.rct(g, w - 112, horizon - 13, 64, 5, [58, 36, 18]);
  MM6.rct(g, w - 112, horizon - 13, 64, 1, [100, 68, 34]);
  paintFire(g, w - 80, horizon - 9, 50, 34, 11);
  glow(g, w - 80, horizon - 22, 180, '#ff8020', 1.0);

  // A rug in the middle distance so the floor is not empty. It goes down before
  // anything that stands on it, or the weave crosses the innkeeper's boots.
  paintRug(g, w * 0.38, horizon + 46, 26, 62, 96, 'blood');

  // Somebody lives here. An empty painted room with a portrait beside it reads
  // as a backdrop with the actor missing.
  figure(g, w * 0.62, horizon + 60, 112, null, null, {
    seed: poseSeed('hipshot', 1907), apron: [104, 96, 74],
  });

  paintClutter(g, 22, h - 10, 'barrel', 32);
  paintClutter(g, 62, h - 8, 'crate', 24);
  paintClutter(g, w - 52, h - 12, 'sack', 28);

  // Vignette: the original interiors are all painted dark at the edges.
  vignette(g, w, h);
}

/**
 * Darken the frame edges so painted panels sit inside their stone surround.
 *
 * The dither is confined to the band the vignette is actually attenuating.
 * Running an ordered dither over the whole plate - which is what this used to
 * do - lays a 2-pixel screen-door across every flat surface in the room, and a
 * global checkerboard is precisely what the software renderer never did: MM6
 * swaps between 32 pre-darkened palettes and lets gradients *band*. So the
 * middle of the painting is left alone and only the darkening rim, where the
 * ramp would otherwise step visibly, gets a Bayer offset - scaled by how much
 * darkening is happening at that pixel.
 */
export function vignette(g, w, h, strength = 0.55) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ex = Math.min(x, w - 1 - x) / (w * 0.5);
      const ey = Math.min(y, h - 1 - y) / (h * 0.5);
      const e = Math.min(1, Math.min(ex, ey) * 3.2);
      if (e >= 1) continue;                       // untouched middle: no dither
      const fall = 1 - e;
      const k = 1 - fall * strength;
      const t = bay8(x, y) * 7 * fall;
      const i = (y * w + x) * 4;
      const p = snap(
        clamp(Math.round(d[i] * k + t), 0, 255),
        clamp(Math.round(d[i + 1] * k + t), 0, 255),
        clamp(Math.round(d[i + 2] * k + t), 0, 255),
      );
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    }
  }
  g.putImageData(img, 0, 0);
}

const DEFAULT_NPC = {
  name: 'Townsfolk', title: 'Citizen', portraitSeed: 12,
  greeting: 'Good day to you.',
  topics: [],
  rumours: ['They say the roads north are not safe after dark.'],
};

export default DialogueScreen;
