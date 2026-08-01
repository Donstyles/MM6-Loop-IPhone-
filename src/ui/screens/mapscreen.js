// ---------------------------------------------------------------------------
// The map book: a full automap of the current map.
//
// MM6's map book draws the same automap as the corner minimap, only large, at
// one of four fixed zooms {384, 768, 1536, 3072} with panning in whole 512-unit
// tiles. Indoors the page is navy with blue wall lines and coloured dots;
// outdoors it is the pre-rendered top-down picture of the region. Undiscovered
// ground stays black - MM6 stores discovery as an 88 x 88 bit grid.
// ---------------------------------------------------------------------------

import * as F from '../../art/font.js';
import { rampCss } from '../../core/palette.js';
import { hash2, hashStr } from '../../core/rng.js';
import {
  Screen, A, px, py, TAB_Y, TAB_H, EXIT_X, EXIT_W,
  WHITE, CANARY, HILITE, DIM,
  MAP_NAVY, MAP_WALL, MAP_FRIEND, MAP_HOSTILE, MAP_CORPSE, MAP_DECOR, MAP_TREASURE,
} from './screenbase.js';
import * as M from './mm6art.js';

/** Keep sketch features clear of the sea: bias samples toward the land side. */
function coastPad(t) { return 0.18 + t * 0.80; }

/**
 * MM6's four map-book zooms (`uMapBookMapZoom`).
 *
 * These are *scale factors*, not spans: the engine plots a point at
 * `centre + (world - party) * zoom / 65536`, so 384 fits the whole 65536-unit
 * region into 384 pixels and 3072 is eight times into it. Reading them as a
 * world span is what turned the map book into four flat quadrants of one tile
 * blown up eighteen times; `span()` does the conversion once.
 */
export const ZOOMS = [384, 768, 1536, 3072];
const WORLD = 65536;
const TILE = 512;

const VIEW = { x: 12, y: 12, w: 437, h: 250 };

export class MapScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'mapscreen';
    this.zoom = 1;            // index into ZOOMS
    this.pan = { x: 0, z: 0 };  // in world units, offset from the party
  }

  onOpen() {
    this.pan.x = 0; this.pan.z = 0;
    // The book opens at its closest zoom - 1536 outdoors, 3072 indoors.
    this.zoom = this.session.map && this.session.map.indoor ? 3 : 2;
    this.sound('page');
  }

  handleKey(code) {
    if (code === 'Escape' || code === 'KeyM') { this.close(); return true; }
    if (code === 'Equal' || code === 'NumpadAdd') { this.setZoom(this.zoom + 1); return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.setZoom(this.zoom - 1); return true; }
    if (code === 'ArrowLeft') { this.panBy(-TILE, 0); return true; }
    if (code === 'ArrowRight') { this.panBy(TILE, 0); return true; }
    if (code === 'ArrowUp') { this.panBy(0, -TILE); return true; }
    if (code === 'ArrowDown') { this.panBy(0, TILE); return true; }
    return false;
  }

  /** Panning steps a whole 512-unit tile at a time, and stays on the sheet. */
  panBy(dx, dz) {
    const lim = Math.max(0, WORLD / 2 - this.span() / 2);
    this.pan.x = Math.max(-lim, Math.min(lim, this.pan.x + dx));
    this.pan.z = Math.max(-lim, Math.min(lim, this.pan.z + dz));
  }

  setZoom(i) {
    // 3072 is the indoor-only step; outdoors the book stops at 1536.
    const max = this.session.map && this.session.map.indoor ? 3 : 2;
    const z = Math.max(0, Math.min(max, i));
    if (z !== this.zoom) { this.zoom = z; this.sound('click'); }
  }

  /** World units across the width of the chart at the current zoom. */
  span(w = VIEW.w) { return (w * WORLD) / ZOOMS[this.zoom]; }

  /**
   * Where the chart is centred: the party plus the pan, held inside the map so
   * the page never runs off the edge of the plate and leaves a bare margin.
   */
  centre(rect) {
    const p = this.player;
    const sw = this.span(rect.w), sh = (sw * rect.h) / rect.w;
    const lx = Math.max(0, WORLD / 2 - sw / 2), lz = Math.max(0, WORLD / 2 - sh / 2);
    return {
      x: Math.max(-lx, Math.min(lx, p.x + this.pan.x)),
      z: Math.max(-lz, Math.min(lz, p.z + this.pan.z)),
    };
  }

  get player() {
    const p = this.session && this.session.player;
    if (p && p.pos) return { x: p.pos.x, z: p.pos.z, yaw: p.yaw || 0 };
    return { x: 0, z: 0, yaw: 0 };
  }

  /** World -> page pixel. */
  projector(rect) {
    const span = this.span(rect.w);
    const s = rect.w / span;
    const c = this.centre(rect);
    const cx = c.x, cz = c.z;
    return {
      s,
      x: (wx) => rect.x + rect.w / 2 + (wx - cx) * s,
      y: (wz) => rect.y + rect.h / 2 + (wz - cz) * s,
    };
  }

  draw(ctx) {
    this.drawPage(ctx, 'page');
    const map = this.session.map || null;
    const rect = { x: px(VIEW.x), y: py(VIEW.y), w: VIEW.w, h: VIEW.h };

    // The chart is drawn onto the page itself, ruled with a painted border
    // rather than dropped into a sunken box.
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();

    const indoor = !!(map && map.indoor);
    // Outdoors, anything off the edge of the plate is open sea, painted the
    // same colour as the deep water on it - never a black margin.
    ctx.fillStyle = indoor ? MAP_NAVY : '#16202a';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    let drawn = false;
    if (map && typeof map.drawMinimap === 'function') {
      try {
        // The automap plates centre themselves on the party and ignore a pan
        // argument, so the pan is handed to them as a moved party instead.
        map.drawMinimap(ctx, rect, this.centre(rect), this.span(rect.w), this.pan);
        drawn = true;
      } catch (e) { drawn = false; }
    }
    if (!drawn && map && map.mapImage) {
      try { this.drawMapImage(ctx, rect, map.mapImage); drawn = true; } catch (e) { drawn = false; }
    }
    if (!drawn) this.drawSketch(ctx, rect, indoor);

    this.drawMarkers(ctx, rect, map);
    this.drawParty(ctx, rect);
    ctx.restore();

    // Painted border rule around the chart.
    M.rct(ctx, rect.x - 2, rect.y - 2, rect.w + 4, 2, [72, 56, 30]);
    M.rct(ctx, rect.x - 2, rect.y + rect.h, rect.w + 4, 2, [72, 56, 30]);
    M.rct(ctx, rect.x - 2, rect.y - 2, 2, rect.h + 4, [72, 56, 30]);
    M.rct(ctx, rect.x + rect.w, rect.y - 2, 2, rect.h + 4, [72, 56, 30]);

    this.drawZoomButtons(ctx, rect);
    this.drawLegend(ctx, map);

    // Only what the pointer is over: MM6 never prints its own key bindings.
    const tip = this.ui.hoverText;
    if (tip) {
      F.drawText(ctx, tip, rect.x + 4, rect.y + rect.h + 4,
        { face: 'small', color: '#3a2a10', shadow: '#ece0c2', maxWidth: rect.w - 8 });
    }
    const r = { x: px(EXIT_X), y: py(TAB_Y), w: EXIT_W, h: TAB_H };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close the map');
    const d = A.button(ctx, r.x, r.y, r.w, r.h, null,
      hit.down ? 'down' : hit.hover ? 'hot' : 'up', { material: 'wood', seed: 9 });
    F.drawText(ctx, 'Exit', (r.x + r.w / 2 + d) | 0, (r.y + 7 + d) | 0,
      { align: 'center', color: hit.hover ? HILITE : CANARY });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }

  // MM6's map book carries no compass rose - north is up on every page and the
  // ribbon compass lives in the right panel - so nothing is drawn here.

  /** Outdoor maps are a pre-rendered picture, sampled nearest-neighbour. */
  drawMapImage(ctx, rect, img) {
    const world = (this.session.map && this.session.map.worldSize) || WORLD;
    const span = this.span(rect.w);
    const p = this.player;
    const cx = p.x + this.pan.x, cz = p.z + this.pan.z;
    const u = (cx + world / 2) / world, v = (cz + world / 2) / world;
    const sw = (img.width * span) / world, sh = (img.height * span * (rect.h / rect.w)) / world;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, img.width * u - sw / 2, img.height * v - sh / 2, sw, sh,
      rect.x, rect.y, rect.w, rect.h);
  }

  /**
   * The painted sketch the map book falls back to: a drawn chart of the region
   * rather than a grid. Coastline, rivers, roads, forest hatching and relief,
   * all keyed off the map's own hash so it is stable, and all drawn with hard
   * edges on a parchment sheet.
   */
  drawSketch(ctx, rect, indoor) {
    const proj = this.projector(rect);
    const seed = hashStr(String((this.session.map
      && (this.session.map.id || this.session.map.name)) || 'enroth'));
    if (indoor) {
      // Indoors MM6 draws navy paper with blue wall lines; only what has been
      // walked is lit, so the sketch is a bare set of chambers.
      ctx.fillStyle = MAP_NAVY;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      const step = Math.max(12, TILE * proj.s);
      ctx.fillStyle = MAP_WALL;
      for (let i = 0; i < 40; i++) {
        const rx = rect.x + ((hash2(i, 1, seed) * rect.w) | 0);
        const ry = rect.y + ((hash2(i, 2, seed) * rect.h) | 0);
        const rw = step * (1 + ((hash2(i, 3, seed) * 3) | 0));
        const rh = step * (1 + ((hash2(i, 4, seed) * 2) | 0));
        ctx.fillRect(rx, ry, rw, 1); ctx.fillRect(rx, ry + rh, rw, 1);
        ctx.fillRect(rx, ry, 1, rh); ctx.fillRect(rx + rw, ry, 1, rh + 1);
      }
      return;
    }

    M.paper(ctx, rect.x, rect.y, rect.w, rect.h, 'book', 17);

    const W = rect.w, H = rect.h;
    const px0 = rect.x, py0 = rect.y;
    // Coast: one wandering line down the left third, sea hatched beyond it.
    const coastAt = (y) => px0 + W * 0.16
      + Math.sin((y / H) * 5.1 + seed * 0.01) * W * 0.05
      + Math.sin((y / H) * 13.0 + seed * 0.03) * W * 0.02;
    for (let y = 0; y < H; y++) {
      const cxx = Math.round(coastAt(y));
      M.rct(ctx, px0, py0 + y, Math.max(0, cxx - px0), 1, [148, 160, 152]);
      M.rct(ctx, cxx - 1, py0 + y, 2, 1, [70, 74, 60]);
    }
    for (let y = 4; y < H; y += 7) {
      const cxx = Math.round(coastAt(y));
      // Cartographer's sea hatching: short parallel strokes, never a fill.
      for (let x = px0 + 4; x < cxx - 3; x += 5) M.rct(ctx, x, py0 + y, 3, 1, [96, 108, 104]);
    }

    // Relief: forest clumps, hills and scrub, hatched with painted marks.
    for (let i = 0; i < 110; i++) {
      const fx = px0 + coastPad(hash2(i, 7, seed)) * W;
      const fy = py0 + hash2(i, 9, seed) * H;
      if (fx < coastAt(fy - py0) + 6) continue;
      const kind = hash2(i, 11, seed);
      if (kind < 0.55) {
        for (let k = 0; k < 3; k++) {
          M.rct(ctx, Math.round(fx - 2 + k), Math.round(fy - k), 1, 1, [58, 78, 40]);
          M.rct(ctx, Math.round(fx + 2 - k), Math.round(fy - k), 1, 1, [58, 78, 40]);
        }
        M.rct(ctx, Math.round(fx), Math.round(fy + 1), 1, 2, [70, 56, 32]);
      } else if (kind < 0.85) {
        for (let k = 0; k < 4; k++) {
          M.rct(ctx, Math.round(fx - 4 + k), Math.round(fy - k), 8 - k * 2, 1, [122, 104, 72]);
        }
        M.rct(ctx, Math.round(fx + 1), Math.round(fy - 2), 3, 3, [92, 76, 50]);
      } else {
        M.rct(ctx, Math.round(fx - 3), Math.round(fy), 7, 2, [104, 116, 78]);
      }
    }

    // Roads: two ochre tracks crossing the sheet, drawn as dashes.
    for (const [ax, ay, bx, by] of [[0.22, 0.18, 0.94, 0.44], [0.30, 0.92, 0.72, 0.10]]) {
      const n = 90;
      for (let i = 0; i < n; i++) {
        if ((i % 5) === 4) continue;
        const t = i / n;
        const x = px0 + W * (ax + (bx - ax) * t) + Math.sin(t * 9 + seed) * 7;
        const y = py0 + H * (ay + (by - ay) * t) + Math.cos(t * 7 + seed) * 6;
        M.rct(ctx, Math.round(x), Math.round(y), 2, 2, [154, 116, 56]);
        M.rct(ctx, Math.round(x), Math.round(y), 2, 1, [196, 158, 88]);
      }
    }

    // A river running out to the sea.
    for (let i = 0; i < 120; i++) {
      const t = i / 120;
      const y = py0 + H * (0.05 + t * 0.9);
      const x = px0 + W * (0.78 - t * 0.6) + Math.sin(t * 11 + seed * 0.7) * W * 0.04;
      M.rct(ctx, Math.round(x), Math.round(y), 2, 2, [72, 108, 148]);
    }
  }

  /** Town / dungeon labels and the coloured dots MM6 puts on the automap. */
  /**
   * The places the region knows about, so the chart carries names. Built once
   * per map: the automap plate draws the streets and the walls, but a map with
   * nothing written on it is a picture, not a map.
   */
  markersFor(map) {
    const key = (map && (map.id || map.name)) || '-';
    if (this._marks && this._marksKey === key) return this._marks;
    const given = (map && map.mapMarkers) || this.session.mapMarkers || null;
    let marks = given;
    if (!marks) {
      marks = [];
      const region = map && map.region;
      for (const t of (region && region.towns) || []) {
        if (t && isFinite(t.x)) marks.push({ x: t.x, z: t.z, name: t.name, kind: 'town' });
      }
      for (const d of (region && region.dungeons) || []) {
        if (d && isFinite(d.x)) marks.push({ x: d.x, z: d.z, name: d.name, kind: 'dungeon' });
      }
    }
    this._marks = marks; this._marksKey = key;
    return marks;
  }

  drawMarkers(ctx, rect, map) {
    const proj = this.projector(rect);
    const marks = this.markersFor(map);
    for (const m of marks) {
      const x = Math.round(proj.x(m.x)), y = Math.round(proj.y(m.z));
      if (x < rect.x - 20 || x > rect.x + rect.w + 20) continue;
      if (y < rect.y - 10 || y > rect.y + rect.h + 10) continue;
      const kind = m.kind || 'town';
      const c = kind === 'dungeon' ? MAP_HOSTILE
        : kind === 'treasure' ? MAP_TREASURE
          : kind === 'corpse' ? MAP_CORPSE
            : kind === 'npc' ? MAP_FRIEND : MAP_DECOR;
      ctx.fillStyle = c;
      if (kind === 'town') {
        ctx.fillRect(x - 3, y - 3, 7, 7);
        ctx.fillStyle = '#000000';
        ctx.fillRect(x - 1, y - 1, 3, 3);
      } else if (kind === 'dungeon') {
        ctx.fillRect(x - 3, y - 3, 7, 2);
        ctx.fillRect(x - 3, y - 3, 2, 7);
        ctx.fillRect(x + 2, y - 3, 2, 7);
      } else {
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
      if (m.name) {
        F.drawText(ctx, m.name, x + 6, y - 4,
          { face: 'small', color: '#241a08', shadow: '#e8dcbc', maxWidth: 90 });
      }
    }
  }

  drawParty(ctx, rect) {
    const p = this.player;
    const proj = this.projector(rect);
    const cx = Math.round(proj.x(p.x));
    const cy = Math.round(proj.y(p.z));
    // MM6 draws one of eight fixed arrow sprites (MAPDIR1..8); snap the yaw the
    // same way rather than rotating anything.
    const dir = ((Math.round((p.yaw / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    const ang = (dir / 8) * Math.PI * 2;
    const fx = -Math.sin(ang), fy = -Math.cos(ang);
    const sx = -fy, sy = fx;                 // side vector
    const pt = (a, b) => [Math.round(cx + fx * a + sx * b), Math.round(cy + fy * a + sy * b)];
    const tri = [pt(8, 0), pt(-6, 6), pt(-3, 0), pt(-6, -6)];
    // A painted arrow: a black cut-out with the gold blade on top, so the
    // silhouette is 1-bit and reads over any terrain.
    M.polyH(ctx, [tri[0][0], tri[0][1] - 1, tri[1][0] - 1, tri[1][1] + 1,
      tri[2][0], tri[2][1], tri[3][0] - 1, tri[3][1] - 1], '#000000');
    M.polyH(ctx, [tri[0][0], tri[0][1], tri[1][0], tri[1][1],
      tri[2][0], tri[2][1], tri[3][0], tri[3][1]], CANARY);
  }

  /** Zoom keys live below the chart, clear of the drawing. */
  drawZoomButtons(ctx, rect) {
    const by = py(VIEW.y + VIEW.h + 22);
    const bx = px(VIEW.x);
    const mk = (id, label, x, tip, off) => {
      const hit = this.ui.region(`${this.id}:${id}`, x, by, 24, 18, tip);
      const d = A.button(ctx, x, by, 24, 18, null,
        off ? 'disabled' : hit.down ? 'down' : hit.hover ? 'hot' : 'up',
        { material: 'wood', seed: 31 });
      F.drawText(ctx, label, x + 12 + d, by + 4 + d, {
        align: 'center', color: off ? DIM : hit.hover ? HILITE : CANARY,
      });
      return hit.click && !off;
    };
    const maxZ = this.session.map && this.session.map.indoor ? 3 : 2;
    if (mk('zin', '+', bx, 'Zoom in', this.zoom === maxZ)) this.setZoom(this.zoom + 1);
    if (mk('zout', '-', bx + 28, 'Zoom out', this.zoom === 0)) this.setZoom(this.zoom - 1);
    // No numeric zoom readout: MM6 changes the scale and shows you the result.
  }

  /**
   * The region's name, ruled onto the page under the chart. MM6 prints the
   * place and nothing else - there is no coloured-square key anywhere in the
   * map book, so there is none here.
   */
  drawLegend(ctx, map) {
    const y = VIEW.y + VIEW.h + 8;
    const name = (map && (map.name || map.id)) || 'Unknown Region';
    A.rule(ctx, px(VIEW.x), py(y - 2), VIEW.w, '#6b5636', 0.5);
    F.drawText(ctx, String(name).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      px(VIEW.x), py(y + 4), { color: '#2a1a06', shadow: '#ece0c2', maxWidth: 220 });
  }
}

export default MapScreen;
