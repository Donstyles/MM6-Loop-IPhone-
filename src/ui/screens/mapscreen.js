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
import {
  Screen, A, PANEL, px, py, TAB_Y, TAB_H, EXIT_X, EXIT_W,
  WHITE, CANARY, HILITE, DIM,
  MAP_NAVY, MAP_WALL, MAP_FRIEND, MAP_HOSTILE, MAP_CORPSE, MAP_DECOR, MAP_TREASURE,
} from './screenbase.js';

/** MM6's four map-book zooms, in world units across the window. */
export const ZOOMS = [384, 768, 1536, 3072];
const TILE = 512;

const VIEW = { x: 12, y: 12, w: 437, h: 268 };

export class MapScreen extends Screen {
  constructor(session, ui, hud, opts) {
    super(session, ui, hud, opts);
    this.id = 'mapscreen';
    this.zoom = 1;            // index into ZOOMS
    this.pan = { x: 0, z: 0 };  // in world units, offset from the party
  }

  onOpen() {
    this.pan.x = 0; this.pan.z = 0;
    const indoor = this.session.map && this.session.map.indoor;
    this.zoom = indoor ? 1 : 2;
    this.sound('page');
  }

  handleKey(code) {
    if (code === 'Escape' || code === 'KeyM') { this.close(); return true; }
    if (code === 'Equal' || code === 'NumpadAdd') { this.setZoom(this.zoom - 1); return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.setZoom(this.zoom + 1); return true; }
    if (code === 'ArrowLeft') { this.pan.x -= TILE; return true; }
    if (code === 'ArrowRight') { this.pan.x += TILE; return true; }
    if (code === 'ArrowUp') { this.pan.z -= TILE; return true; }
    if (code === 'ArrowDown') { this.pan.z += TILE; return true; }
    return false;
  }

  setZoom(i) {
    const max = this.session.map && this.session.map.indoor ? 3 : 2;
    const z = Math.max(0, Math.min(max, i));
    if (z !== this.zoom) { this.zoom = z; this.sound('click'); }
  }

  get player() {
    const p = this.session && this.session.player;
    if (p && p.pos) return { x: p.pos.x, z: p.pos.z, yaw: p.yaw || 0 };
    return { x: 0, z: 0, yaw: 0 };
  }

  /** World -> page pixel. */
  projector(rect) {
    const span = ZOOMS[this.zoom];
    const s = rect.w / span;
    const p = this.player;
    const cx = p.x + this.pan.x, cz = p.z + this.pan.z;
    return {
      s,
      x: (wx) => rect.x + rect.w / 2 + (wx - cx) * s,
      y: (wz) => rect.y + rect.h / 2 + (wz - cz) * s,
    };
  }

  draw(ctx) {
    this.drawPage(ctx, 'sheet');
    const map = this.session.map || null;
    const rect = { x: px(VIEW.x), y: py(VIEW.y), w: VIEW.w, h: VIEW.h };

    A.inset(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();

    const indoor = !!(map && map.indoor);
    ctx.fillStyle = indoor ? MAP_NAVY : '#0d1014';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    let drawn = false;
    if (map && typeof map.drawMinimap === 'function') {
      try {
        map.drawMinimap(ctx, rect, this.session.player, ZOOMS[this.zoom], this.pan);
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

    this.drawZoomButtons(ctx, rect);
    this.drawLegend(ctx, map);

    this.drawHelpLine(ctx, 306);
    const r = { x: px(EXIT_X), y: py(TAB_Y), w: EXIT_W, h: TAB_H };
    const hit = this.ui.region(`${this.id}:exit`, r.x, r.y, r.w, r.h, 'Close the map');
    A.button(ctx, r.x, r.y, r.w, r.h, null, hit.down ? 'down' : 'up');
    F.drawText(ctx, 'Exit', (r.x + r.w / 2) | 0, (r.y + 7) | 0,
      { align: 'center', color: hit.hover ? HILITE : CANARY });
    if (hit.click) { this.sound('click'); this.close(); }
    this.pollPartyBar();
  }

  /** Outdoor maps are a pre-rendered picture, sampled nearest-neighbour. */
  drawMapImage(ctx, rect, img) {
    const world = (this.session.map && this.session.map.worldSize) || 65536;
    const span = ZOOMS[this.zoom];
    const p = this.player;
    const cx = p.x + this.pan.x, cz = p.z + this.pan.z;
    const u = (cx + world / 2) / world, v = (cz + world / 2) / world;
    const sw = (img.width * span) / world, sh = (img.height * span * (rect.h / rect.w)) / world;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, img.width * u - sw / 2, img.height * v - sh / 2, sw, sh,
      rect.x, rect.y, rect.w, rect.h);
  }

  /** Fallback sketch: a tile grid with a little fog, so the page is never blank. */
  drawSketch(ctx, rect, indoor) {
    const proj = this.projector(rect);
    const step = TILE * proj.s;
    const p = this.player;
    const cx = p.x + this.pan.x, cz = p.z + this.pan.z;
    const x0 = Math.floor((cx - ZOOMS[this.zoom] / 2) / TILE) * TILE;
    const z0 = Math.floor((cz - (ZOOMS[this.zoom] * rect.h) / rect.w / 2) / TILE) * TILE;

    ctx.fillStyle = indoor ? MAP_WALL : rampCss('grass', 4);
    for (let wx = x0; proj.x(wx) < rect.x + rect.w; wx += TILE) {
      ctx.fillRect(Math.round(proj.x(wx)), rect.y, 1, rect.h);
    }
    for (let wz = z0; proj.y(wz) < rect.y + rect.h; wz += TILE) {
      ctx.fillRect(rect.x, Math.round(proj.y(wz)), rect.w, 1);
    }
    if (!indoor) {
      // A hint of terrain so an outdoor page is not just a grid.
      ctx.globalAlpha = 0.35;
      for (let wx = x0; proj.x(wx) < rect.x + rect.w; wx += TILE) {
        for (let wz = z0; proj.y(wz) < rect.y + rect.h; wz += TILE) {
          const h = ((wx / TILE) * 7 + (wz / TILE) * 13) & 7;
          ctx.fillStyle = rampCss(h < 2 ? 'water' : h < 5 ? 'grass' : 'foliage', 4 + (h % 4));
          ctx.fillRect(Math.round(proj.x(wx)) + 1, Math.round(proj.y(wz)) + 1,
            Math.max(1, Math.round(step) - 1), Math.max(1, Math.round(step) - 1));
        }
      }
      ctx.globalAlpha = 1;
    }

    // Undiscovered ground: MM6 simply never lights those cells, so the page
    // darkens off towards the edges of what the party has walked.
    ctx.fillStyle = '#000000';
    const inner = Math.min(rect.w, rect.h) * 0.42;
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      ctx.globalAlpha = 0.10;
      ctx.fillRect(rect.x, rect.y, rect.w, Math.max(0, rect.h / 2 - inner * (1 - t)));
      ctx.fillRect(rect.x, rect.y + rect.h / 2 + inner * (1 - t), rect.w,
        Math.max(0, rect.h / 2 - inner * (1 - t)));
      ctx.fillRect(rect.x, rect.y, Math.max(0, rect.w / 2 - inner * 1.6 * (1 - t)), rect.h);
      ctx.fillRect(rect.x + rect.w / 2 + inner * 1.6 * (1 - t), rect.y,
        Math.max(0, rect.w / 2 - inner * 1.6 * (1 - t)), rect.h);
    }
    ctx.globalAlpha = 1;
  }

  /** Town / dungeon labels and the coloured dots MM6 puts on the automap. */
  drawMarkers(ctx, rect, map) {
    const proj = this.projector(rect);
    const marks = (map && map.mapMarkers) || this.session.mapMarkers || [];
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
        F.drawText(ctx, m.name, x + 6, y - 4, { face: 'small', color: WHITE });
      }
    }
  }

  drawParty(ctx, rect) {
    const p = this.player;
    const cx = Math.round(rect.x + rect.w / 2 - this.pan.x * (rect.w / ZOOMS[this.zoom]));
    const cy = Math.round(rect.y + rect.h / 2 - this.pan.z * (rect.w / ZOOMS[this.zoom]));
    // MM6 draws one of eight fixed arrow sprites; snap the yaw the same way.
    const dir = Math.round((p.yaw / (Math.PI * 2)) * 8 + 8) % 8;
    const ang = (dir / 8) * Math.PI * 2;
    const dx = -Math.sin(ang), dy = -Math.cos(ang);
    ctx.fillStyle = CANARY;
    for (let i = -5; i <= 5; i++) {
      const w = Math.max(1, 5 - Math.abs(i));
      const bx = Math.round(cx + dx * i), by = Math.round(cy + dy * i);
      ctx.fillRect(bx - (w >> 1), by - (w >> 1), w, w);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(cx + dx * 5) - 1, Math.round(cy + dy * 5) - 1, 2, 2);
  }

  drawZoomButtons(ctx, rect) {
    const bx = rect.x + rect.w - 54, by = rect.y + 4;
    const mk = (id, label, x, tip, on) => {
      const hit = this.ui.region(`${this.id}:${id}`, x, by, 24, 20, tip);
      A.button(ctx, x, by, 24, 20, null, hit.down ? 'down' : 'up');
      F.drawText(ctx, label, x + 12, by + 5, {
        align: 'center', color: on ? DIM : hit.hover ? HILITE : CANARY,
      });
      return hit.click;
    };
    const maxZ = this.session.map && this.session.map.indoor ? 3 : 2;
    if (mk('zin', '+', bx, 'Zoom in', this.zoom === 0)) this.setZoom(this.zoom - 1);
    if (mk('zout', '-', bx + 26, 'Zoom out', this.zoom === maxZ)) this.setZoom(this.zoom + 1);
    F.drawText(ctx, `x${(3072 / ZOOMS[this.zoom]).toFixed(1)}`, bx + 24, by + 24,
      { face: 'small', align: 'center', color: WHITE });
  }

  drawLegend(ctx, map) {
    const y = VIEW.y + VIEW.h + 8;
    A.inset(ctx, px(VIEW.x), py(y), VIEW.w, 22);
    const name = (map && (map.name || map.id)) || 'Unknown Region';
    F.drawText(ctx, name, px(VIEW.x + 6), py(y + 6), { face: 'small', color: CANARY });

    const items = [
      ['Party', CANARY], ['Town', MAP_DECOR], ['Dungeon', MAP_HOSTILE],
      ['Friend', MAP_FRIEND], ['Treasure', MAP_TREASURE], ['Wall', MAP_WALL],
    ];
    let x = VIEW.x + 130;
    for (const [label, color] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(px(x), py(y + 8), 5, 5);
      F.drawText(ctx, label, px(x + 8), py(y + 6), { face: 'small', color: WHITE });
      x += 12 + F.measure(label, 'small').w + 8;
    }
    this.status = 'Arrow keys pan by one tile; + and - change the zoom.';
  }
}

export default MapScreen;
