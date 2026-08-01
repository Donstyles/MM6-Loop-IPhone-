// ---------------------------------------------------------------------------
// The HUD's own paintbox: carved chrome, the ribbon compass, the party-buff
// row and the gauge tubes.
//
// MM6's interface is not a bevelled rectangle with noise in it. It is a painted
// dungeon lintel: ashlar stone laid in courses with mortar joints, sculpted
// mouldings that catch the light along their top and left arris and roll away
// into shadow below, four arched relief niches holding the party portraits,
// inset wood plaques, brass collars, keystones and rivets, and a recessed inner
// lip that drops a hard dark line into the 3D window.
//
// Rules this file obeys, because a 256-colour indexed frame has no partial
// coverage: no arc(), ellipse(), stroke(), gradient or globalAlpha anywhere -
// every curve is a scanline fill, every soft edge is a Bayer stipple, and every
// colour is snapped to the fixed HUD colour table before it lands. The whole
// chrome is painted once into a cached canvas and blitted; nothing here runs a
// per-pixel loop on the frame path.
// ---------------------------------------------------------------------------

import { Pix, makeCanvas, ctx2d, mixC } from './texcanvas.js';
import { hash2, tileFbm2, clamp } from '../core/rng.js';
import { STONE, BRASS, WOOD, BAR_EMPTY, hexC, uiQuantise, uiSnap } from './uiart.js';
import { drawText } from './font.js';

// --- plumbing ---------------------------------------------------------------

const _snap = new Map();
/** Colour -> css, snapped to the HUD table. Memoised; the chrome reuses tones. */
function C(c) {
  const k = ((c[0] | 0) << 16) | ((c[1] | 0) << 8) | (c[2] | 0);
  let v = _snap.get(k);
  if (v === undefined) { v = uiSnap(c); _snap.set(k, v); }
  return v;
}
function S(t) { return C(STONE(clamp(t, 0, 1))); }
function BR(t) { return C(BRASS(clamp(t, 0, 1))); }
function WD(t) { return C(WOOD(clamp(t, 0, 1))); }

function rct(g, x, y, w, h, col) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = typeof col === 'string' ? col : C(col);
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}
function hl(g, x, y, w, col) { rct(g, x, y, w, 1, col); }
function vl(g, x, y, h, col) { rct(g, x, y, 1, h, col); }

// 8x8 ordered threshold, the only way this file fakes partial coverage.
const BAY = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
function bay(x, y) { return BAY[((y & 7) << 3) | (x & 7)] / 64; }

/** Bayer-stippled rectangle. Small areas only - this is build-time art. */
function stip(g, x, y, w, h, col, density) {
  g.fillStyle = typeof col === 'string' ? col : C(col);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (bay(x + i, y + j) >= density) continue;
      g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** Nearest-neighbour blit; nothing in the HUD is ever resampled. */
export function blit(ctx, canvas, x, y) {
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x | 0, y | 0);
  ctx.imageSmoothingEnabled = sm;
}

/** A 3px domed brass stud, lit from the upper left. */
function rivet(g, cx, cy) {
  rct(g, cx - 1, cy - 1, 3, 3, BR(0.20));
  rct(g, cx - 1, cy - 1, 2, 2, BR(0.72));
  rct(g, cx, cy, 2, 2, BR(0.44));
  rct(g, cx + 1, cy + 1, 1, 1, S(0.02));
  rct(g, cx - 1, cy - 1, 1, 1, BR(1));
}

/**
 * A sculpted horizontal moulding. `rows` is a list of [tone, material] read top
 * to bottom; the light comes from above, so the run always opens on a bright
 * arris and closes on a shadow. Returns the y just past the moulding.
 */
function mouldH(g, x, y, w, rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    hl(g, x, y + i, w, typeof r === 'number' ? S(r) : r);
  }
  return y + rows.length;
}
function mouldV(g, x, y, h, cols) {
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    vl(g, x + i, y, h, typeof c === 'number' ? S(c) : c);
  }
  return x + cols.length;
}

// Standard profiles. A raised torus reads bright-bright-mid-dark-dark; a hollow
// (a cut) reads the other way round, which is the whole "carved" cue.
const TORUS = [0.02, 0.96, 0.80, 0.58, 0.34, 0.12];
const TORUS_S = [0.03, 0.92, 0.60, 0.20];

// --- ashlar field -----------------------------------------------------------

const COURSE = 23;

/** Which block of the coursed masonry a frame pixel falls in. */
function ashlar(x, y) {
  const row = Math.floor(y / COURSE);
  const bw = 40 + (((hash2(row, 7, 19) * 3) | 0) * 9);
  const bx = x + (row % 2) * (bw >> 1) + row * 11;
  const col = Math.floor(bx / bw);
  return { row, col, u: bx - col * bw, v: y - row * COURSE, bw };
}

/**
 * Paint the whole frame as coursed ashlar. Value is quantised into eight steps
 * before it reaches the palette so the surface bands the way a 256-colour
 * painting does instead of drifting smoothly.
 */
function ashlarField(pix, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = ashlar(x, y);
      let t = 0.36 + (hash2(b.col, b.row, 31) - 0.5) * 0.22;
      t += (tileFbm2(x * 0.085, y * 0.085, 64, 3, 0.55, 11) - 0.5) * 0.16;
      t += (hash2(x, y, 5) - 0.5) * 0.055;
      // Pitting: a few blocks are chiselled rougher than their neighbours.
      if (hash2(b.col, b.row, 77) > 0.82) t -= (hash2(x, y, 13) > 0.7 ? 0.09 : 0);
      t = Math.round(clamp(t, 0, 1) * 7) / 7;
      // Joints: a hard mortar line, a lit arris just inside it, a shadowed foot.
      if (b.v === 0 || b.u === 0) t = 0.03;
      else if (b.v === 1 || b.u === 1) t = Math.min(1, t + 0.30);
      else if (b.v >= COURSE - 2 || b.u >= b.bw - 2) t *= 0.52;
      pix.setArr(x, y, STONE(t));
    }
  }
}

// --- arched relief niche ----------------------------------------------------

/** Row-by-row inset of a round-headed opening w wide: 0 below the springing. */
function archInsets(w, h) {
  const r = w / 2;
  const rows = new Int16Array(h);
  for (let y = 0; y < h; y++) {
    const dy = r - y;
    rows[y] = dy <= 0 ? 0 : Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
  }
  return rows;
}

/**
 * One arched relief niche: a round-headed opening cut into the slab, with a
 * moulded archivolt round it, a brass keystone at the crown, carved spandrels
 * in the corners and a projecting sill under the opening.
 */
function archNiche(g, x, y, w, h) {
  const rows = archInsets(w, h);
  const springing = Math.round(w / 2);

  for (let ry = 0; ry < h; ry++) {
    const i = rows[ry];
    const l = x + i, r = x + w - 1 - i;
    if (r <= l) continue;
    // Back of the recess: darker under the arch head, opening out below it,
    // with a stipple of the next value up so the plaster reads as a surface.
    const k = Math.round((ry < springing ? 0.02 + (ry / springing) * 0.05 : 0.08) * 7) / 7;
    rct(g, l, y + ry, r - l + 1, 1, S(k));
    stip(g, l + 3, y + ry, r - l - 5, 1, S(k + 0.09), 0.28);
    // Reveal: shadow on the top/left of the opening, light on the lower right.
    rct(g, l, y + ry, 2, 1, S(0.03));
    rct(g, l + 2, y + ry, 1, 1, S(0.16));
    rct(g, r - 1, y + ry, 2, 1, S(0.62));
    rct(g, r - 2, y + ry, 1, 1, S(0.38));
    // Archivolt: a three-step moulding following the curve, outside the cut.
    rct(g, l - 3, y + ry, 1, 1, S(0.02));
    rct(g, l - 2, y + ry, 1, 1, S(0.94));
    rct(g, l - 1, y + ry, 1, 1, S(0.66));
    rct(g, r + 1, y + ry, 1, 1, S(0.70));
    rct(g, r + 2, y + ry, 1, 1, S(0.30));
    rct(g, r + 3, y + ry, 1, 1, S(0.02));
  }

  // Spandrels: the stone either side of the arch head is carved back a step, so
  // it takes a lit lip on the left of the curve and a shadow on the right.
  for (let ry = 1; ry < springing; ry++) {
    const i = rows[ry];
    if (i <= 5) continue;
    rct(g, x - 3, y + ry, 1, 1, S(0.72));
    rct(g, x + w + 2, y + ry, 1, 1, S(0.10));
  }

  // Keystone: a brass wedge pinned through the crown of the arch.
  const kw = 9, kx = Math.round(x + w / 2 - kw / 2);
  rct(g, kx, y - 4, kw, 8, BR(0.42));
  hl(g, kx, y - 4, kw, BR(0.92));
  hl(g, kx, y - 3, kw, BR(0.66));
  hl(g, kx, y + 3, kw, BR(0.10));
  vl(g, kx, y - 4, 8, BR(0.78));
  vl(g, kx + kw - 1, y - 4, 8, BR(0.12));
  rivet(g, kx + (kw >> 1), y);

  // Sill: the opening sits on a projecting course.
  mouldH(g, x - 5, y + h, w + 10, [0.98, 0.74, 0.46, 0.20, 0.04]);
  rivet(g, x - 3, y + h + 2);
  rivet(g, x + w + 2, y + h + 2);
}

// --- recessed wells ---------------------------------------------------------

/** A rectangular cut: hard shadow on the top/left lip, light on the bottom/right. */
function wellRect(g, x, y, w, h, floor = 0.12) {
  rct(g, x, y, w, h, S(floor));
  hl(g, x, y, w, S(0.02));
  vl(g, x, y, h, S(0.02));
  hl(g, x + 1, y + 1, w - 2, S(0.12));
  vl(g, x + 1, y + 1, h - 2, S(0.12));
  hl(g, x, y + h - 1, w, S(0.80));
  vl(g, x + w - 1, y, h, S(0.80));
  hl(g, x + 1, y + h - 2, w - 2, S(0.46));
  vl(g, x + w - 2, y + 1, h - 2, S(0.46));
}

/**
 * A raised plate laid on the slab: light on the top/left, shadow below right.
 * The face is left alone so the coursed masonry underneath still reads through
 * it - filling it would flatten the whole column back into a painted rectangle.
 */
function plateRect(g, x, y, w, h) {
  hl(g, x, y, w, S(0.94));
  vl(g, x, y, h, S(0.90));
  hl(g, x, y + h - 1, w, S(0.02));
  vl(g, x + w - 1, y, h, S(0.06));
  hl(g, x + 1, y + h - 2, w - 2, S(0.18));
  vl(g, x + w - 2, y + 1, h - 2, S(0.22));
}

/** An inset wood panel: vertical grain, knots, and a stone rebate round it. */
function woodPanel(g, x, y, w, h, seed = 5) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const grain = tileFbm2(px * 0.055, py * 0.42, 64, 3, 0.55, seed);
      const knot = tileFbm2(px * 0.11, py * 0.11, 64, 2, 0.5, seed + 31);
      const t = Math.round(clamp(0.34 + (grain - 0.5) * 0.52 + (knot - 0.5) * 0.18, 0, 1) * 7) / 7;
      rct(g, x + px, y + py, 1, 1, WOOD(t));
    }
  }
  // Rebate: the panel sits behind the stone, so the cut reads round its edge.
  hl(g, x, y, w, C(hexC(0x140e08)));
  vl(g, x, y, h, C(hexC(0x140e08)));
  hl(g, x, y + h - 1, w, WD(0.86));
  vl(g, x + w - 1, y, h, WD(0.80));
  hl(g, x - 1, y - 1, w + 2, S(0.06));
  vl(g, x - 1, y - 1, h + 2, S(0.06));
  hl(g, x - 1, y + h, w + 2, S(0.86));
  vl(g, x + w, y - 1, h + 2, S(0.86));
}

/**
 * A pier at one end of the party cluster. Up to 60 px of it next to the niche
 * takes an inset wood panel; anything beyond that stays bare slab with a run of
 * rivets, so a wide frame gains stone rather than a stretched plaque.
 */
function endPier(g, x0, x1, y, h, seed, panelOnLeft) {
  const w = x1 - x0;
  if (w < 12) return;
  const pw = Math.min(60, w);
  const px = panelOnLeft ? x0 : x1 - pw;
  woodPanel(g, px, y, pw, h, seed);
  const sx = panelOnLeft ? px + pw : x0;
  const sw = w - pw;
  if (sw < 10) return;
  // Bare slab: a moulded stop against the panel, then rivets across the field.
  mouldV(g, panelOnLeft ? sx : x1 - sw - 1, y, h, [0.02, 0.90, 0.56, 0.24]);
  for (let rx = sx + 12; rx < sx + sw - 6; rx += 26) {
    rivet(g, rx, y + 10);
    rivet(g, rx, y + h - 10);
  }
}

/** The 5x49 slot a gauge tube is let into, with its brass collars. */
function tubeWell(g, x, y, w, h) {
  rct(g, x - 2, y - 3, w + 4, h + 6, S(0.34));
  hl(g, x - 2, y - 3, w + 4, S(0.92));
  vl(g, x - 2, y - 3, h + 6, S(0.88));
  hl(g, x - 2, y + h + 2, w + 4, S(0.04));
  vl(g, x + w + 1, y - 3, h + 6, S(0.08));
  rct(g, x, y, w, h, C(BAR_EMPTY));
  hl(g, x - 1, y - 1, w + 2, S(0.02));
  vl(g, x - 1, y - 1, h + 2, S(0.02));
  hl(g, x - 1, y + h, w + 2, S(0.74));
  vl(g, x + w, y - 1, h + 2, S(0.74));
  // Collars: the brass ferrules the glass tube is seated in.
  for (const cy of [y - 3, y + h + 1]) {
    hl(g, x - 2, cy, w + 4, BR(cy < y ? 0.86 : 0.30));
    hl(g, x - 2, cy + 1, w + 4, BR(cy < y ? 0.40 : 0.08));
  }
}

// --- the chrome -------------------------------------------------------------

const _chrome = new Map();

/**
 * The whole carved surround, painted once and cached. `view`, `side` and `hud`
 * are the layout rects; `slots` carries the portrait / tube / niche geometry so
 * the chrome and the live gauges cannot drift apart.
 */
export function hudChrome(w, h, geom) {
  const key = `${w}x${h}`;
  let c = _chrome.get(key);
  if (c) return c;
  c = paintChrome(w, h, geom);
  _chrome.set(key, c);
  return c;
}
export function invalidateChrome() { _chrome.clear(); }

function paintChrome(w, h, geom) {
  const { view: v, side, hud, portraitX, portraitY, portraitW, portraitH, hpX, spX, barY, barW, barH } = geom;

  const pix = new Pix(w, h);
  ashlarField(pix, w, h);
  const canvas = pix.toCanvas();
  const g = ctx2d(canvas);

  const SX = side.x;              // right column starts here
  const CX1 = w - 6;              // usable right edge of the column

  // ---- outer frame ---------------------------------------------------------
  mouldH(g, 0, 0, w, [0.00, 0.94, 0.66, 0.36]);
  mouldV(g, 0, 0, h, [0.00, 0.90, 0.62, 0.32]);
  mouldV(g, w - 4, 0, h, [0.62, 0.36, 0.12, 0.00]);
  mouldH(g, 0, h - 4, w, [0.72, 0.40, 0.14, 0.00]);

  // ---- bottom bar (x < SX; right of that the column runs on unbroken) ------
  const bw = SX;
  let y = hud.y;
  // Cornice: the bar's top capping, a raised torus over a shadowed foot.
  y = mouldH(g, 0, y, bw, TORUS_S);
  // Status trough: the message strip is cut into the stone, not printed on it.
  const trough = y;
  rct(g, 4, trough, bw - 8, 16, S(0.11));
  for (let i = 0; i < 16; i++) {
    hl(g, 4, trough + i, bw - 8, S(0.09 + (i / 15) * 0.05));
  }
  hl(g, 4, trough, bw - 8, S(0.02));
  vl(g, 4, trough, 16, S(0.02));
  hl(g, 4, trough + 15, bw - 8, S(0.78));
  vl(g, bw - 5, trough, 16, S(0.78));
  hl(g, 5, trough + 14, bw - 10, S(0.44));
  y = trough + 16;
  y = mouldH(g, 0, y, bw, [0.92, 0.68, 0.36, 0.08]);

  // Niche band. Four round-headed openings with the gauge slots between them.
  const nicheY = portraitY - 7;
  const nicheH = portraitH + 12;
  for (let i = 0; i < 4; i++) {
    archNiche(g, portraitX[i] - 5, nicheY, portraitW + 10, nicheH);
    tubeWell(g, hpX[i], barY, barW, barH);
    tubeWell(g, spX[i], barY, barW, barH);
  }
  // Wood plaques let into the piers between the niches.
  for (let i = 0; i < 3; i++) {
    const a = spX[i] + barW + 4, b = hpX[i + 1] - 4;
    if (b - a >= 12) woodPanel(g, a, nicheY + 8, b - a, nicheH - 8, 5 + i * 13);
  }
  // The end piers. On a widescreen frame the cluster is centred and the surplus
  // is left as carved stone, so the inset panel is capped at a pier's width and
  // the extra reads as more of the same slab rather than a stretched plaque.
  endPier(g, 6, hpX[0] - 4, nicheY + 8, nicheH - 8, 61, false);
  endPier(g, spX[3] + barW + 4, bw - 6, nicheY + 8, nicheH - 8, 83, true);

  // Plinth under the whole bar.
  mouldH(g, 0, h - 10, bw, [0.04, 0.94, 0.70, 0.44, 0.26, 0.14, 0.08, 0.04, 0.02, 0.00]);
  for (let rx = 14; rx < bw - 8; rx += 46) rivet(g, rx, h - 6);

  // ---- right column --------------------------------------------------------
  // Its own left-hand moulding, running the full height of the frame.
  mouldV(g, SX, 0, h, [0.02, 0.94, 0.70, 0.42, 0.16]);

  // Automap surround: a deep well with a moulded architrave and brass corners.
  const m = geom.map;
  plateRect(g, SX + 8, 6, CX1 - SX - 8, m.y + m.h + 6);
  wellRect(g, m.x - 5, m.y - 5, m.w + 10, m.h + 10, 0.08);
  for (const [rx, ry] of [[SX + 13, 11], [CX1 - 5, 11], [SX + 13, m.y + m.h + 5], [CX1 - 5, m.y + m.h + 5]]) {
    rivet(g, rx, ry);
  }

  // Instrument shelf: the compass aperture with a zoom key either side.
  const shelfY = m.y + m.h + 13;
  plateRect(g, SX + 6, shelfY, CX1 - SX - 6, 20);
  // Compass housing: a brass-collared slot cut clean through the shelf.
  const cw = geom.compass;
  rct(g, cw.x - 3, cw.y - 3, cw.w + 6, cw.h + 6, BR(0.36));
  hl(g, cw.x - 3, cw.y - 3, cw.w + 6, BR(0.90));
  vl(g, cw.x - 3, cw.y - 3, cw.h + 6, BR(0.80));
  hl(g, cw.x - 3, cw.y + cw.h + 2, cw.w + 6, BR(0.06));
  vl(g, cw.x + cw.w + 2, cw.y - 3, cw.h + 6, BR(0.10));
  rct(g, cw.x - 1, cw.y - 1, cw.w + 2, cw.h + 2, C(hexC(0x14100c)));
  rivet(g, cw.x - 2, cw.y - 2);
  rivet(g, cw.x + cw.w + 1, cw.y - 2);
  rivet(g, cw.x - 2, cw.y + cw.h + 1);
  rivet(g, cw.x + cw.w + 1, cw.y + cw.h + 1);

  // Hireling alcove: two round-headed openings under a shared architrave. With
  // no one engaged the panel art shows straight through, as it does in MM6.
  const hs = geom.hire;
  plateRect(g, SX + 6, hs.y - 10, CX1 - SX - 6, hs.h + 20);
  archNiche(g, hs.x[0], hs.y, hs.w, hs.h);
  archNiche(g, hs.x[1], hs.y, hs.w, hs.h);
  mouldV(g, hs.x[0] + hs.w + 4, hs.y - 6, hs.h + 12, [0.90, 0.56, 0.22, 0.04]);

  // Divider between the alcove and the buff plaque.
  mouldH(g, SX + 6, hs.y + hs.h + 8, CX1 - SX - 6, TORUS);

  // Buff plaque: an inset wood board with fourteen sockets cut into it. MM6
  // shows this board through every empty slot, so it is chrome, not a gap.
  const bp = geom.buffPanel;
  plateRect(g, SX + 6, bp.y - 8, CX1 - SX - 6, bp.h + 16);
  woodPanel(g, SX + 10, bp.y - 4, CX1 - SX - 14, bp.h + 8, 29);
  for (const [sx, sy] of bp.slots) {
    rct(g, sx - 1, sy - 1, 18, 18, WD(0.06));
    rct(g, sx, sy, 16, 16, WD(0.20));
    hl(g, sx, sy, 16, WD(0.02));
    vl(g, sx, sy, 16, WD(0.02));
    hl(g, sx, sy + 15, 16, WD(0.84));
    vl(g, sx + 15, sy, 16, WD(0.84));
    // A brass pin at the head of each socket, the way MM6 pegs its icon plates.
    rct(g, sx + 7, sy - 2, 2, 2, BR(0.74));
    rct(g, sx + 7, sy - 2, 1, 1, BR(0.98));
  }
  for (let rx = SX + 12; rx < CX1 - 6; rx += 40) {
    rivet(g, rx, bp.y - 6);
    rivet(g, rx, bp.y + bp.h + 5);
  }

  // Food / gold trough.
  const fg = geom.foodGold;
  mouldH(g, SX + 6, fg.y - 12, CX1 - SX - 6, TORUS_S);
  wellRect(g, SX + 8, fg.y - 5, CX1 - SX - 10, 24, 0.10);
  mouldV(g, fg.split, fg.y - 5, 24, [0.02, 0.72, 0.30]);

  // Book shelf: the five tome spines stand on a projecting wooden ledge.
  const tb = geom.tabs;
  plateRect(g, SX + 6, tb.y - 6, CX1 - SX - 6, tb.h + 14);
  woodPanel(g, SX + 10, tb.y - 3, CX1 - SX - 14, tb.h + 4, 47);
  mouldH(g, SX + 6, tb.y + tb.h + 2, CX1 - SX - 6, [0.96, 0.72, 0.44, 0.18, 0.04]);

  // Key block: a recessed field holding the four action plates.
  const kb = geom.keys;
  wellRect(g, SX + 6, kb.y - 6, CX1 - SX - 6, h - 8 - (kb.y - 6), 0.14);
  for (let rx = SX + 12; rx < CX1 - 6; rx += 34) rivet(g, rx, kb.y - 3);

  // ---- the 3D window -------------------------------------------------------
  // Cut the hole, then drop the inner lip's shadow a pixel into it. The world
  // is drawn under this canvas, so the lip really does darken the view edge.
  g.clearRect(v.x, v.y, v.w, v.h);
  hl(g, v.x, v.y, v.w, S(0.00));
  vl(g, v.x, v.y, v.h, S(0.00));
  hl(g, v.x + 1, v.y + 1, v.w - 2, S(0.14));
  vl(g, v.x + 1, v.y + 1, v.h - 2, S(0.14));
  hl(g, v.x, v.y + v.h - 1, v.w, S(0.06));
  vl(g, v.x + v.w - 1, v.y, v.h, S(0.06));
  // Architrave: the moulded surround the window is let into.
  mouldH(g, v.x - 4, v.y - 4, v.w + 8, [0.02, 0.30, 0.62, 0.96]);
  mouldV(g, v.x - 4, v.y - 4, v.h + 8, [0.02, 0.26, 0.58, 0.94]);
  mouldH(g, v.x - 4, v.y + v.h, v.w + 8, [0.94, 0.60, 0.28, 0.04]);
  mouldV(g, v.x + v.w, v.y - 4, v.h + 8, [0.92, 0.56, 0.26, 0.04]);
  for (const [rx, ry] of [[v.x - 2, v.y - 2], [v.x + v.w + 1, v.y - 2],
    [v.x - 2, v.y + v.h + 1], [v.x + v.w + 1, v.y + v.h + 1]]) rivet(g, rx, ry);

  return uiQuantise(canvas);
}

// --- ib-autmask -------------------------------------------------------------

/**
 * The automap mask: MM6 lays `ib-autmask` over the map last so the aperture
 * reads as an arched opening in the stone rather than a square hole.
 */
export function mapMask(w, h) {
  const key = `mask:${w}:${h}`;
  let c = _chrome.get(key);
  if (c) return c;
  const canvas = makeCanvas(w, h);
  const g = ctx2d(canvas);
  // Quarter-round corner fillets, not a dome: MM6 only knocks the corners off.
  const R = 15;
  for (let y = 0; y < h; y++) {
    const dyT = R - y, dyB = R - (h - 1 - y);
    const cut = (dy) => (dy <= 0 ? 0
      : Math.round(R - Math.sqrt(Math.max(0, R * R - dy * dy))));
    const i = Math.max(cut(dyT), cut(dyB));
    if (i <= 0) continue;
    rct(g, 0, y, i, 1, S(0.34));
    rct(g, w - i, y, i, 1, S(0.34));
    rct(g, Math.max(0, i - 1), y, 1, 1, S(0.86));
    rct(g, i, y, 1, 1, S(0.02));
    rct(g, w - i - 1, y, 1, 1, S(0.70));
  }
  c = uiQuantise(canvas);
  _chrome.set(key, c);
  return c;
}

/** The bare brass hook a hireling's portrait plate would hang from. */
export function drawEmptyHook(ctx, cx, y) {
  cx |= 0; y |= 0;
  rct(ctx, cx - 2, y, 5, 2, BR(0.70));
  rct(ctx, cx - 2, y, 5, 1, BR(0.96));
  rct(ctx, cx, y + 2, 1, 4, BR(0.36));
  rct(ctx, cx + 1, y + 2, 1, 4, BR(0.10));
  rct(ctx, cx - 1, y + 6, 3, 1, BR(0.44));
  rct(ctx, cx - 1, y + 7, 1, 1, BR(0.80));
}

// --- IB-COMP: the ribbon compass -------------------------------------------
//
// A 240 px panoramic strip that slides behind a 26 px aperture. 240/2048 =
// 0.1171875, the engine's scroll constant, so one full turn of the party walks
// the strip past the window exactly once. The window spans 39 degrees, and
// there is a mark every 9 degrees, so it is never empty at any heading.

const RIB_W = 240, RIB_H = 18;
// Strip x of each point: 240 px is a full turn, so 30 px is 45 degrees.
const CARDINALS = [['N', 0], ['E', 60], ['S', 120], ['W', 180]];
const INTERCARD = [['NE', 30], ['SE', 90], ['SW', 150], ['NW', 210]];

let _ribbon = null;
function ribbon() {
  if (_ribbon) return _ribbon;
  const canvas = makeCanvas(RIB_W, RIB_H);
  const g = ctx2d(canvas);
  // The drum: a polished bronze band, brightest a third of the way down and
  // rolling into shadow at both lips, in five flat steps. A light ground with
  // dark engraving is what makes a 26 px aperture legible at every heading.
  for (let ry = 0; ry < RIB_H; ry++) {
    const k = 1 - Math.abs(ry / (RIB_H - 1) - 0.34) * 1.6;
    hl(g, 0, ry, RIB_W, BR(0.20 + Math.round(clamp(k, 0, 1) * 4) / 4 * 0.52));
  }
  hl(g, 0, 0, RIB_W, S(0.02));
  hl(g, 0, 1, RIB_W, BR(0.30));
  hl(g, 0, RIB_H - 1, RIB_W, S(0.06));
  hl(g, 0, RIB_H - 2, RIB_W, BR(0.16));

  const ink = C(hexC(0x241a08));
  const lit = BR(0.98);
  // An engraved rule dividing the lettering from the tick scale, so the strip
  // still has structure at a heading with no letter in the window.
  hl(g, 0, RIB_H - 12, RIB_W, ink);
  hl(g, 0, RIB_H - 11, RIB_W, lit);
  // Marks along the foot: a minor tick every 9 degrees, a long one on each of
  // the eight compass points. Four or five are inside the window at all times.
  for (let i = 0; i < RIB_W; i += 6) {
    const point = i % 30 === 0;
    const len = point ? 8 : 3;
    rct(g, i, RIB_H - 3 - len, 1, len, ink);
    rct(g, i + 1, RIB_H - 3 - len, 1, len, lit);
    if (point) { rct(g, i - 1, RIB_H - 3 - len, 1, len, ink); }
  }
  // Lettering, engraved: dark ink with the light catching its lower right lip.
  // Each label is laid down three times so a glyph on the seam still wraps.
  const label = (text, pos, face, ty) => {
    for (const dx of [0, RIB_W, -RIB_W]) {
      drawText(g, text, pos + dx, ty, { face, align: 'center', color: ink, shadow: lit });
    }
  };
  for (const [t, pos] of CARDINALS) label(t, pos, 'normal', 1);
  for (const [t, pos] of INTERCARD) label(t, pos, 'small', 2);
  _ribbon = uiQuantise(canvas);
  return _ribbon;
}

/**
 * Blit a window of the ribbon at (x, y), scrolled for `yaw` in radians with
 * north at the aperture centre when yaw is 0. Three copies are laid down so the
 * seam is always off-screen; the aperture is clipped to `w`.
 */
export function drawCompassRibbon(ctx, x, y, w, yaw = 0) {
  x |= 0; y |= 0; w = Math.max(8, w | 0);
  const strip = ribbon();
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, RIB_H);
  ctx.clip();
  const p = ((((yaw / (Math.PI * 2)) * RIB_W) % RIB_W) + RIB_W) % RIB_W;
  const base = Math.round(x + w / 2 - p);
  for (let r = -1; r <= 1; r++) ctx.drawImage(strip, base + r * RIB_W, y);
  ctx.restore();
  ctx.imageSmoothingEnabled = sm;

  // Index mark: a brass pointer biting into the top of the opening, and its
  // partner at the foot. This is the mark the heading is actually read against.
  const cx = x + (w >> 1);
  for (let k = 0; k < 3; k++) {
    rct(ctx, cx - 2 + k, y + k, 5 - k * 2, 1, C(hexC(0x1a1206)));
    rct(ctx, cx - 1 + k, y + k, 3 - k * 2, 1, BR(0.96 - k * 0.22));
  }
  for (let k = 0; k < 2; k++) {
    rct(ctx, cx - 1 + k, y + RIB_H - 1 - k, 3 - k * 2, 1, C(hexC(0x1a1206)));
    rct(ctx, cx + k, y + RIB_H - 1 - k, 1, 1, BR(0.50 + k * 0.20));
  }
}
export const COMPASS_H = RIB_H;

// --- ib-autin / ib-autout: the map zoom keys --------------------------------

const _zoom = new Map();
/** A small brass key with a cast + or - sunk into its face. */
export function drawZoomKey(ctx, x, y, w, h, sign, down = false) {
  const key = `zk:${w}:${h}:${sign}:${down ? 1 : 0}`;
  let c = _zoom.get(key);
  if (!c) {
    const canvas = makeCanvas(w, h);
    const g = ctx2d(canvas);
    for (let py = 0; py < h; py++) {
      // Domed stone face in four flat steps, brightest a third of the way down.
      const k = 1 - Math.abs(py / (h - 1) - 0.30) * 1.5;
      const t = Math.round(clamp(0.28 + clamp(k, 0, 1) * 0.40, 0, 1) * 4) / 4;
      hl(g, 0, py, w, S(down ? t * 0.72 : t));
    }
    hl(g, 0, 0, w, S(down ? 0.04 : 0.96));
    vl(g, 0, 0, h, S(down ? 0.06 : 0.90));
    hl(g, 0, h - 1, w, S(down ? 0.90 : 0.02));
    vl(g, w - 1, 0, h, S(down ? 0.84 : 0.06));
    // Brass glyph, set proud: a bright bar with its own shadow underneath.
    const cx = (w >> 1) + (down ? 1 : 0), cy = (h >> 1) + (down ? 1 : 0);
    const arm = Math.max(3, (w >> 2));
    rct(g, cx - arm, cy, arm * 2 + 1, 2, BR(0.12));
    rct(g, cx - arm, cy - 1, arm * 2 + 1, 2, BR(0.88));
    if (sign > 0) {
      rct(g, cx, cy - arm + 1, 2, arm * 2 - 1, BR(0.12));
      rct(g, cx - 1, cy - arm + 1, 2, arm * 2 - 1, BR(0.88));
    }
    c = uiQuantise(canvas);
    _zoom.set(key, c);
  }
  blit(ctx, c, x, y);
}

// --- IB-selec: the active-character ring ------------------------------------

const _rings = new Map();

/**
 * A continuous glowing border round the portrait, following the arched head of
 * the niche. Not brackets and not a reticle: one unbroken ring, cream on the
 * inside edge, gold through the body, dying into a stipple on the outside.
 */
function ringCanvas(w, h) {
  const canvas = makeCanvas(w + 8, h + 8);
  const g = ctx2d(canvas);
  const rows = archInsets(w, h);
  const inside = (x, py) => {
    if (py < 0 || py >= h) return false;
    const i = rows[py];
    return x >= i && x < w - i;
  };
  const GOLD_HI = hexC(0xf8ecc8);
  const GOLD = hexC(0xe1cd23);
  const GOLD_LO = hexC(0x8a6e20);
  const put = (x, py, col) => rct(g, x + 4, py + 4, 1, 1, col);

  for (let py = -3; py < h + 3; py++) {
    for (let x = -3; x < w + 3; x++) {
      const inThis = inside(x, py);
      // Chebyshev distance to the nearest pixel of the opposite class.
      let d = 9;
      for (let dy = -3; dy <= 3 && d > 0; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (inside(x + dx, py + dy) === inThis) continue;
          const k = Math.max(Math.abs(dx), Math.abs(dy));
          if (k < d) d = k;
        }
      }
      if (d > 3) continue;
      if (inThis) {
        if (d === 1) put(x, py, C(GOLD_HI));
        else if (d === 2) put(x, py, C(GOLD));
      } else if (d === 1) put(x, py, C(GOLD));
      else if (d === 2) put(x, py, C(GOLD_LO));
      else if (bay(x + 4, py + 4) < 0.5) put(x, py, C(GOLD_LO));
    }
  }
  return uiQuantise(canvas);
}

export function drawSelectRing(ctx, x, y, w, h) {
  const key = `ring:${w}:${h}`;
  let c = _rings.get(key);
  if (!c) { c = ringCanvas(w | 0, h | 0); _rings.set(key, c); }
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, (x | 0) - 4, (y | 0) - 4);
  ctx.imageSmoothingEnabled = sm;
}

// --- IB-InitG / Y / R: the ready markers ------------------------------------

const READY_TONE = {
  green: [hexC(0x0c7a0c), hexC(0x28c828), hexC(0x8cf88c)],
  yellow: [hexC(0x8a7c0c), hexC(0xe0d020), hexC(0xf8f8a0)],
  red: [hexC(0x7a1408), hexC(0xd02010), hexC(0xf8a088)],
};

const _ready = new Map();
/** A painted gem in a brass bezel: MM6's ready-to-act marker, not a glyph. */
export function drawReadyGem(ctx, x, y, kind = 'green') {
  let c = _ready.get(kind);
  if (!c) {
    const s = 11;
    const canvas = makeCanvas(s, s);
    const g = ctx2d(canvas);
    const [lo, mid, hi] = READY_TONE[kind] || READY_TONE.green;
    const r = 5;
    for (let dy = -r; dy <= r; dy++) {
      const k = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
      if (k <= 0) continue;
      // Bezel first, then the stone, lit from the upper left in three steps.
      rct(g, r - k, r + dy, k * 2 + 1, 1, BR(dy < 0 ? 0.82 : 0.22));
      if (k <= 1) continue;
      for (let dx = -k + 1; dx <= k - 1; dx++) {
        const t = 0.5 - (dx + dy) * 0.13;
        rct(g, r + dx, r + dy, 1, 1, C(t > 0.72 ? hi : t > 0.36 ? mid : lo));
      }
    }
    rct(g, r - 2, r - 2, 1, 1, C(hi));
    c = uiQuantise(canvas);
    _ready.set(kind, c);
  }
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, x | 0, y | 0);
  ctx.imageSmoothingEnabled = sm;
}

// --- gauge tubes ------------------------------------------------------------

// ib-statG / Y / R / B, verbatim from the spec's bitmap reading. The engine
// swaps whole textures at the thresholds rather than tinting one.
const TUBE = {
  green: [hexC(0x0c7a0c), hexC(0x28c828), hexC(0x5cf05c)],
  yellow: [hexC(0x8a7c0c), hexC(0xe0d020), hexC(0xf8f060)],
  red: [hexC(0x7a1408), hexC(0xd02010), hexC(0xf86048)],
  blue: [hexC(0x122a7a), hexC(0x2848d8), hexC(0x6080f8)],
};
function tubeShade(kind, t) {
  const [lo, mid, hi] = TUBE[kind] || TUBE.green;
  return t < 0.5 ? mixC(lo, mid, t * 2) : mixC(mid, hi, (t - 0.5) * 2);
}
/** Which HP texture the engine picks: >50% green, >25% yellow, else red. */
export function hpTexture(frac) {
  if (frac > 0.5) return 'green';
  if (frac > 0.25) return 'yellow';
  return 'red';
}

// Round-tube shading across the full 5 px width. The bar texture fills the slot
// lip to lip - the recess is chrome behind it, not a border drawn round it.
const _tubeCols = new Map();
function tubeColumns(kind, wid) {
  const key = `${kind}:${wid}`;
  let cols = _tubeCols.get(key);
  if (cols) return cols;
  cols = [];
  for (let i = 0; i < wid; i++) {
    const u = wid === 1 ? 0.5 : i / (wid - 1);
    cols.push(C(tubeShade(kind, clamp(1 - Math.abs(u - 0.30) * 1.65, 0.06, 1))));
  }
  _tubeCols.set(key, cols);
  return cols;
}

/**
 * A gauge tube. 5 x 49, filled bottom-up: the engine clips the whole texture to
 * `height = ratio * 49` and anchors it at the bottom of the slot, so at ratio 1
 * the tube is solid lip to lip. At ratio <= 0 nothing is drawn at all and the
 * dark recess shows through.
 */
export function drawTube(ctx, x, y, w, h, frac, kind = 'hp') {
  x |= 0; y |= 0; w |= 0; h |= 0;
  rct(ctx, x, y, w, h, C(BAR_EMPTY));
  const f = clamp(frac, 0, 1);
  if (f <= 0) return;
  const tex = kind === 'sp' ? 'blue' : hpTexture(f);
  const fh = Math.max(1, Math.round(h * f));
  const top = y + h - fh;
  const cols = tubeColumns(tex, w);
  for (let i = 0; i < w; i++) rct(ctx, x + i, top, 1, fh, cols[i]);
  // Meniscus: the lit top of the column of fluid.
  rct(ctx, x, top, w, 1, C(tubeShade(tex, 1)));
  rct(ctx, x, top, 1, 1, C(tubeShade(tex, 0.3)));
  rct(ctx, x + w - 1, top, 1, 1, C(tubeShade(tex, 0.2)));
}

// --- party buff icons -------------------------------------------------------
//
// Fourteen 16x16 painted plates. The original is a 16x8 atlas of 126 frames per
// icon advanced at 50 fps with a per-slot phase offset so they shimmer out of
// sync; here each icon is baked into an 8-frame strip once and the phase picks
// a frame, which keeps the frame path to one drawImage per icon.

const IKEY = {
  '.': null,
  k: 0x100c08, d: 0x3a342c, m: 0x6a6258, l: 0xa8a094, w: 0xf0ece0,
  r: 0xd02010, R: 0x7a1408, o: 0xf07018, f: 0xf8c840,
  y: 0xe1cd23, Y: 0x8a6e20, e: 0xe6d6c1, E: 0x9a8a70,
  b: 0x2848d8, B: 0x122a7a, c: 0x70c8f0, C: 0x2c7898,
  g: 0x28c828, G: 0x0c7a0c, z: 0x6a8a30,
  n: 0x6e5238, N: 0x2e2014,
  p: 0xa060d0, P: 0x50287a, v: 0xd8b0f0,
  s: 0xc8a078, x: 0x8a8072, X: 0x4a463e,
};

// Order is the engine's: Feather Fall, the six resistances plus Resist Body,
// Heroism, Haste, Shield, Stone Skin, Protection from Magic, Immolation,
// Day of the Gods.
const BUFF_ART = {
  feather_fall: [
    '', '..........ww....', '.........wwew...', '........wwewe...', '.......wweweE...',
    '......wwewewE...', '.....wwewewEE...', '....wwewewEE....', '...wwewewEE.....',
    '..wwewewEE......', '..wewewEE.......', '..wewEEE........', '..EwEE..........',
    '..EE............',
  ],
  protection_from_fire: [
    '', '.......f........', '......fof.......', '.....foof.......', '....foorof......',
    '...foorroof.....', '...forrrroof....', '..foorrrrroof...', '..forrooorrof...',
    '..foorooooroof..', '...foroooorof...', '....fooooof.....', '.....fffff......',
  ],
  protection_from_air: [
    '', '', '...cccccc.......', '..c......cc.....', '..........cc....', '...cccccccc.....',
    '..cccccccccccc..', '..............c.', '.............cc.', '...ccccccccccc..',
    '..c.............', '...ccccccc......', '.........cc.....',
  ],
  protection_from_water: [
    '', '.......b........', '.......b........', '......bBb.......', '.....bbcbb......',
    '....bbcccbb.....', '...bbccccbbb....', '..bbcccwccbbb...', '..bcccwwwcccb...',
    '..bccccwccccb...', '..bbcccccccbb...', '...bbcccccbb....', '....bbbbbbb.....',
    '......bbb.......',
  ],
  protection_from_mind: [
    '', '', '....llllllll....', '..llpppppppll...', '.lppvvpvvpvppl..', 'lppvvpvvpvvppl..',
    'lpvvpvvpvvpvpl..', 'lppvvpvvpvvppl..', '.lppvvpvvpvppl..', '..llpppppppll...',
    '....ll.ll.ll....', '.....l.l.l......',
  ],
  protection_from_earth: [
    '', '', '.......N........', '......NnN.......', '.....NnnnN......', '....NnnnnnN.....',
    '..N.NnnzznN.N...', '.NnNNnnzznNNnN..', 'NnnnNNnnnnNNnnnN', 'NnnnnnnnnnnnnnnN',
    '.NNNNNNNNNNNNNN.', '..NNNNNNNNNNNN..',
  ],
  protection_from_body: [
    '', '', '...gg.....gg....', '..gggg...gggg...', '.gggggg.gggggg..', '.ggwggggggggGG..',
    '.gggggggggggGG..', '..gggggggggGG...', '...GggggggggG...', '....GggggggG....',
    '.....GgggggG....', '......GgggG.....', '.......GG.......',
  ],
  heroism: [
    '', '.......w........', '......wew.......', '......wew.......', '......wew.......',
    '......wew.......', '....yywewyy.....', '...yYYwewYYy....', '......yYy.......',
    '......yYy.......', '.....yyYyy......', '......YYY.......',
  ],
  haste: [
    '', '', '..c...c.........', '...c...c........', '..cccccccc......', '.c..c...c..c....',
    'cc.c...c....c...', '..cccccccc..c...', '...c...c...c....', '..c...c...c.....',
    '.........c......', '........c.......',
  ],
  shield: [
    '', '..llllllllll....', '.lxxxxxxxxxxl...', '.lxxxwxxwxxxl...', '.lxxxxxxxxxxl...',
    '.lxxXXxxXXxxl...', '.lxxxxwwxxxxl...', '..lxxxxxxxxl....', '..lxxXXXXxxl....',
    '...lxxxxxxl.....', '....lxxxxl......', '.....lxxl.......', '......ll........',
  ],
  stone_skin: [
    '', '', '..xxxxxxxxxx....', '.xXXxxXXxxXXx...', '.xxXXxxXXxxXx...', '.xXXxxXXxxXXx...',
    '.xxXXxxXXxxXx...', '.xXXxxXXxxXXx...', '.xxXXxxXXxxXx...', '.xXXxxXXxxXXx...',
    '..xxxxxxxxxx....',
  ],
  protection_from_magic: [
    '', '.......p........', '......ppp.......', '.....pvvvp......', 'ppppvvwwwvpppp..',
    '.pppvvwwwvppp...', '..ppvvwwwvpp....', '...pvvvwvvvp....', '..pvvp.pvvp.....',
    '.pvvp...pvvp....', 'pvvp.....pvvp...', 'Pp.........pP...',
  ],
  immolation: [
    '', '....f.....f.....', '...fof...fof....', '..foorf.foorf...', '..forrofoorof...',
    '.fooroooooroof..', '.forooooooooof..', '.foroooooooorf..', '..fooooooooof...',
    '..ffoooooooff...', '...fffoooff.....', '.....fffff......',
  ],
  day_of_the_gods: [
    '', '.......y........', '..y....y....y...', '...y...y...y....', '.....yyfyy......',
    '....yyfwfyy.....', 'y..yyfwwwfyy..y.', 'yyyyfwwwwwfyyyyy', 'y..yyfwwwfyy..y.',
    '....yyfwfyy.....', '.....yyfyy......', '...y...y...y....', '..y....y....y...',
    '.......y........',
  ],
};

export const PARTY_BUFF_IDS = [
  'feather_fall', 'protection_from_fire', 'protection_from_air', 'protection_from_water',
  'protection_from_mind', 'protection_from_earth', 'protection_from_body',
  'heroism', 'haste', 'shield', 'stone_skin', 'protection_from_magic',
  'immolation', 'day_of_the_gods',
];
export const PARTY_BUFF_NAMES = [
  'Feather Fall', 'Resist Fire', 'Resist Air', 'Resist Water', 'Resist Mind',
  'Resist Earth', 'Resist Body', 'Heroism', 'Haste', 'Shield', 'Stone Skin',
  'Protection from Magic', 'Immolation', 'Day of the Gods',
];
/** Per-slot phase offsets, so the icons shimmer out of sync as they do in MM6. */
export const PARTY_BUFF_PHASE = [14, 1, 10, 4, 7, 2, 9, 3, 6, 15, 8, 3, 12, 0];

const BUFF_FRAMES = 8;
const _buffStrips = new Map();

/**
 * Bake one icon's animation strip: the painted plate, then a highlight sweeping
 * diagonally across it, which is what the original's 126-frame atlas amounts to
 * at 16 px. Silhouette is 1-bit; the shimmer only recolours pixels already lit.
 */
function buffStrip(id) {
  let strip = _buffStrips.get(id);
  if (strip) return strip;
  const src = BUFF_ART[id] || [];
  const cells = new Array(256).fill(null);
  const solid = new Uint8Array(256);
  for (let py = 0; py < 16; py++) {
    const row = src[py] || '';
    for (let px = 0; px < 16; px++) {
      const ch = row[px];
      if (!ch || ch === '.' || ch === ' ') continue;
      const hexv = IKEY[ch];
      if (hexv === undefined || hexv === null) continue;
      cells[py * 16 + px] = hexC(hexv);
      solid[py * 16 + px] = 1;
    }
  }
  // Paint the plate: lift pixels whose up/left neighbour is empty, drop those
  // whose down/right is, then ring the silhouette in near-black.
  const at = (px, py) => (px < 0 || py < 0 || px > 15 || py > 15 ? 0 : solid[py * 16 + px]);
  const shaded = cells.slice();
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (!solid[py * 16 + px]) continue;
      const c = cells[py * 16 + px];
      const lit = !at(px - 1, py) || !at(px, py - 1);
      const dark = !at(px + 1, py) || !at(px, py + 1);
      if (lit && !dark) shaded[py * 16 + px] = mixC(c, [255, 255, 255], 0.24);
      else if (dark && !lit) shaded[py * 16 + px] = mixC(c, [0, 0, 0], 0.34);
    }
  }
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (solid[py * 16 + px]) continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(px + dx, py + dy)) { touch = true; break; }
      }
      if (touch) shaded[py * 16 + px] = hexC(0x0e0c0a);
    }
  }

  const canvas = makeCanvas(16 * BUFF_FRAMES, 16);
  const g = ctx2d(canvas);
  for (let f = 0; f < BUFF_FRAMES; f++) {
    const ox = f * 16;
    const sweep = (f * 32) / BUFF_FRAMES;
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const c = shaded[py * 16 + px];
        if (!c) continue;
        const d = (((px + py * 2 - sweep) % 32) + 32) % 32;
        const k = d < 3 ? 0.34 : d < 5 ? 0.16 : 0;
        rct(g, ox + px, py, 1, 1, C(k && solid[py * 16 + px] ? mixC(c, [255, 248, 210], k) : c));
      }
    }
  }
  strip = uiQuantise(canvas);
  _buffStrips.set(id, strip);
  return strip;
}

/** Blit one buff icon at its animation phase. `phase` is 0..125, as the engine. */
export function drawBuffIcon(ctx, id, x, y, phase = 0) {
  if (!BUFF_ART[id]) return false;
  const strip = buffStrip(id);
  const f = Math.floor((phase / 126) * BUFF_FRAMES) % BUFF_FRAMES;
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(strip, f * 16, 0, 16, 16, x | 0, y | 0, 16, 16);
  ctx.imageSmoothingEnabled = sm;
  return true;
}

// --- torchlight and wizard-eye indicators -----------------------------------
//
// Drawn at (468, 0) and (606, 0), only while the effect is up.

const IND_FRAMES = 4;
const _indicators = new Map();

function torchFrame(g, ox, f) {
  // A wall torch: turned wooden haft in a brass ferrule, with a flame painted
  // in four flat tone bands and a hard 1-bit silhouette. No glow ramp.
  const lean = [0, 1, 0, -1][f];
  const cx = ox + 16;
  rct(g, cx - 3, 22, 6, 10, WD(0.34));
  rct(g, cx - 3, 22, 2, 10, WD(0.72));
  rct(g, cx + 2, 22, 1, 10, WD(0.06));
  rct(g, cx - 5, 19, 10, 4, BR(0.44));
  rct(g, cx - 5, 19, 10, 1, BR(0.94));
  rct(g, cx - 5, 22, 10, 1, BR(0.08));

  // The flame is a teardrop with a wobble on its silhouette, painted from the
  // outside in: dull orange rim, amber body, white heart. Shells, not bands -
  // horizontal colour bands read as a traffic cone.
  const hgt = 18 + (f === 1 ? 2 : f === 3 ? -2 : 0);
  const rim = C(hexC(0xd02010)), body = C(hexC(0xf07018));
  const amber = C(hexC(0xf8c840)), heart = C(hexC(0xfff8d0));
  for (let i = 0; i < hgt; i++) {
    const t = i / hgt;
    const fx = cx + Math.round(lean * t * 2.5);
    const yy = 19 - i;
    const wob = 0.86 + 0.26 * Math.sin(t * 7 + f * 1.6);
    const half = Math.max(1, Math.round(6 * Math.sqrt(Math.max(0, 1 - t * t)) * wob));
    rct(g, fx - half, yy, half * 2 + 1, 1, t < 0.18 ? rim : body);
    const inner = half - 2;
    if (inner > 0 && t > 0.06) rct(g, fx - inner, yy, inner * 2 + 1, 1, amber);
    const core = half - 4;
    if (core > 0 && t > 0.12 && t < 0.5) rct(g, fx - core, yy, core * 2 + 1, 1, heart);
  }
  // Sparks lifting off the tip, stippled so they stay 1-bit.
  stip(g, cx - 4, Math.max(0, 19 - hgt - 4), 8, 4, amber, 0.18 + f * 0.07);
}

function wizeyeFrame(g, ox, f) {
  // A floating eye in a brass ring: sclera, iris, a hard pupil that tracks
  // round the four frames, and four short rays of arcane light off the ring.
  const cx = ox + 16, cy = 16;
  const look = [[0, 0], [2, -1], [0, 1], [-2, -1]][f];
  const ringR = 13;
  for (let dy = -ringR; dy <= ringR; dy++) {
    const k = Math.round(ringR * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ringR * ringR))));
    if (k <= 0) continue;
    rct(g, cx - k, cy + dy, k * 2 + 1, 1, BR(dy < 0 ? 0.80 : 0.22));
  }
  // Lens: a lenticular white, wider than it is tall.
  for (let dy = -7; dy <= 7; dy++) {
    const k = Math.round(11 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 49)));
    if (k <= 0) continue;
    rct(g, cx - k, cy + dy, k * 2 + 1, 1, C(hexC(dy < -2 ? 0xf0ece0 : dy < 3 ? 0xd8d4c8 : 0xa8a094)));
  }
  for (let dy = -5; dy <= 5; dy++) {
    const k = Math.round(5 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 25)));
    if (k <= 0) continue;
    rct(g, cx + look[0] - k, cy + look[1] + dy, k * 2 + 1, 1, C(hexC(dy < 0 ? 0x70c8f0 : 0x2c7898)));
  }
  for (let dy = -2; dy <= 2; dy++) {
    const k = Math.round(2 * Math.sqrt(Math.max(0, 1 - (dy * dy) / 4)));
    if (k <= 0) continue;
    rct(g, cx + look[0] - k, cy + look[1] + dy, k * 2 + 1, 1, C(hexC(0x100c08)));
  }
  rct(g, cx + look[0] - 2, cy + look[1] - 3, 2, 2, C(hexC(0xffffff)));
  // Rays: four short spokes off the ring, stepping round with the frame.
  const spark = C(hexC(0x70c8f0));
  for (let q = 0; q < 4; q++) {
    const a = (q / 4 + f / 16) * Math.PI * 2;
    const sx = Math.round(cx + Math.cos(a) * 14), sy = Math.round(cy + Math.sin(a) * 14);
    const ex = Math.round(cx + Math.cos(a) * 17), ey = Math.round(cy + Math.sin(a) * 17);
    const n = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)) || 1;
    for (let i = 0; i <= n; i++) {
      rct(g, Math.round(sx + ((ex - sx) * i) / n), Math.round(sy + ((ey - sy) * i) / n), 1, 1, spark);
    }
  }
}

function indicatorStrip(kind) {
  let strip = _indicators.get(kind);
  if (strip) return strip;
  const canvas = makeCanvas(32 * IND_FRAMES, 32);
  const g = ctx2d(canvas);
  for (let f = 0; f < IND_FRAMES; f++) {
    if (kind === 'torch') torchFrame(g, f * 32, f);
    else wizeyeFrame(g, f * 32, f);
  }
  strip = uiQuantise(canvas);
  _indicators.set(kind, strip);
  return strip;
}

// --- touch stick ------------------------------------------------------------

const _sticks = new Map();
/**
 * The phone stick, painted once. A dithered ring and a dithered knob: MM6 has
 * no alpha, so "half opacity" is a 50 % Bayer screen over solid cream.
 */
export function touchStick(r) {
  const key = `stick:${r}`;
  let s = _sticks.get(key);
  if (s) return s;
  const cream = C(hexC(0xe6d6c1));
  const ring = makeCanvas(r * 2 + 1, r * 2 + 1);
  const rg = ctx2d(ring);
  for (let dy = -r; dy <= r; dy++) {
    const o = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    const ri = r - 2;
    const k = Math.abs(dy) <= ri ? Math.round(Math.sqrt(Math.max(0, ri * ri - dy * dy))) : 0;
    stip(rg, r - o, r + dy, o - k, 1, cream, 0.3);
    stip(rg, r + k, r + dy, o - k, 1, cream, 0.3);
  }
  const knob = makeCanvas(33, 33);
  const kg = ctx2d(knob);
  for (let dy = -16; dy <= 16; dy++) {
    const k = Math.round(Math.sqrt(Math.max(0, 256 - dy * dy)));
    stip(kg, 16 - k, 16 + dy, k * 2 + 1, 1, cream, 0.45);
  }
  s = { ring: uiQuantise(ring), knob: uiQuantise(knob) };
  _sticks.set(key, s);
  return s;
}

export function drawIndicator(ctx, kind, x, y, phase = 0) {
  const strip = indicatorStrip(kind);
  const f = Math.floor(phase) % IND_FRAMES;
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(strip, f * 32, 0, 32, 32, x | 0, y | 0, 32, 32);
  ctx.imageSmoothingEnabled = sm;
}
