import { layout } from './core/layout.js';
import { rampCss, ramp } from './core/palette.js';

// ---------------------------------------------------------------------------
// Asset generation and the loading screen.
//
// Nothing ships as a file, so the first thing the game does is paint every
// texture, bake every sprite sheet and render every portrait. That work is
// sliced across frames so the progress bar actually moves and the browser never
// locks up - which also matters on iOS, where a long synchronous block gets the
// tab killed.
// ---------------------------------------------------------------------------

const STAGES = [
  { id: 'textures', label: 'Painting the world', weight: 3 },
  { id: 'effects', label: 'Kindling spell fire', weight: 1 },
  { id: 'ui', label: 'Carving the interface', weight: 1 },
  { id: 'portraits', label: 'Sitting for portraits', weight: 2 },
  { id: 'sprites', label: 'Summoning the bestiary', weight: 6 },
];

export class Boot {
  constructor(engine) {
    this.engine = engine;
    this.done = false;
    this.progress = 0;
    this.label = 'Loading';
    this.detail = '';
    this.t = 0;
    this.error = null;
    this.assets = {};
    this._stageIndex = 0;
    this._totalWeight = STAGES.reduce((a, s) => a + s.weight, 0);
    this._doneWeight = 0;
    this._budgetMs = 12;        // per-frame generation budget
    this.stageBudgetMs = 60000; // hard ceiling for any one stage
  }

  start() {
    this._run().catch((e) => {
      console.error('boot failed', e);
      this.error = e;
      this.done = true;
    });
  }

  async _run() {
    const times = {};
    window.__bootTimes = times;
    // ?skip=portraits,sprites lets a capture run bypass a stage that is
    // temporarily broken without disabling the feature everywhere.
    const skip = new Set(
      (new URLSearchParams(location.search).get('skip') || '').split(',').filter(Boolean),
    );
    for (const stage of STAGES) {
      if (skip.has(stage.id)) { times[stage.id] = 'skipped'; continue; }
      this.label = stage.label;
      this._stage = stage;
      const t0 = performance.now();
      try {
        await this._runStage(stage);
        times[stage.id] = Math.round(performance.now() - t0);
      } catch (e) {
        times[stage.id] = `failed after ${Math.round(performance.now() - t0)}ms`;
        // A failed art module should not stop the game booting; the affected
        // pieces fall back to placeholders.
        console.error(`stage ${stage.id} failed`, e);
      }
      this._doneWeight += stage.weight;
      this.progress = this._doneWeight / this._totalWeight;
    }
    this.detail = '';
    this.done = true;
  }

  async _runStage(stage) {
    const gen = await this._generatorFor(stage.id);
    if (!gen) return;
    let n = 0;
    let frameStart = performance.now();
    const stageStart = frameStart;
    for (const step of gen) {
      n++;
      if (step && step.id) this.detail = String(step.id);
      const frac = step && step.total ? (step.index + 1) / step.total : 0;
      this.progress = (this._doneWeight + this._stage.weight * frac) / this._totalWeight;
      if (performance.now() - frameStart > this._budgetMs) {
        await nextFrame();
        frameStart = performance.now();
      }
      // A stage that runs away must not keep the player on the loading screen
      // forever; whatever it produced so far is kept and the rest falls back.
      if (performance.now() - stageStart > this.stageBudgetMs) {
        console.warn(`stage ${stage.id} exceeded its budget after ${n} items; continuing`);
        break;
      }
    }
    return n;
  }

  async _generatorFor(id) {
    if (id === 'textures') {
      const m = await safeImport('./art/textures.js');
      if (!m || !m.buildAll) return null;
      this.assets.textures = m;
      return m.buildAll();
    }
    if (id === 'effects') {
      const m = await safeImport('./art/vfxart.js');
      if (!m || !m.buildAllEffects) return null;
      this.assets.vfxart = m;
      return m.buildAllEffects();
    }
    if (id === 'ui') {
      const font = await safeImport('./art/font.js');
      const uiart = await safeImport('./art/uiart.js');
      this.assets.font = font;
      this.assets.uiart = uiart;
      // Warm the glyph atlases so the first HUD frame is not a stutter.
      return (function* () {
        const colors = [font?.TEXT_NORMAL, font?.TEXT_GOLD, font?.TEXT_LINK, font?.TEXT_DIM, font?.TEXT_DARK];
        let i = 0;
        const total = 3 * colors.length;
        for (const face of ['small', 'normal', 'title']) {
          for (const c of colors) {
            if (font && font.glyphCanvas && c) font.glyphCanvas(face, c, '#000000');
            yield { id: `${face} ${c}`, index: i++, total };
          }
        }
      })();
    }
    if (id === 'portraits') {
      const m = await safeImport('./art/portraits.js');
      if (!m) return null;
      this.assets.portraits = m;
      // Warm a spread of faces so the first HUD frame does not stall; the rest
      // are rendered on demand and cached.
      if (m.buildPortraits) {
        const seeds = [];
        for (let i = 0; i < 3; i++) seeds.push(1000 + i * 7717);
        return m.buildPortraits(seeds);
      }
      return null;
    }
    if (id === 'sprites') {
      const m = await safeImport('./art/spritebake.js');
      if (!m || !m.bakeAllSheets) return null;
      this.assets.sprites = m;
      const list = await this._spriteWorkList();
      return m.bakeAllSheets(this.engine.renderer, list);
    }
    return null;
  }

  /**
   * Baking all 173 monster tiers up front would cost far more than the first
   * region needs, so we preload the scenery and a starting bestiary and let the
   * rest bake on demand (the sheet cache makes that a one-time cost each).
   */
  async _spriteWorkList() {
    // Baking the whole set in one stage spikes memory hard enough to lose the
    // tab, and `getSheet` caches on first use anyway, so we preload only the
    // scenery you see immediately and let the bestiary bake as it spawns.
    const flora = await safeImport('./art/models/flora.js');
    const list = [];
    const scenery = ['oak', 'pine', 'birch', 'bush', 'rock_small', 'rock_large', 'grass_tuft'];
    const floraKinds = flora?.FLORA_KINDS || [];
    for (const k of scenery) if (floraKinds.includes(k)) list.push({ category: 'flora', kind: k, seed: 1 });
    for (const k of ['peasant_m', 'peasant_f', 'guard']) list.push({ category: 'npc', kind: k, seed: 1 });
    return list;
  }

  update(dt) { this.t += dt; }

  invalidate() { this._bg = null; }

  /** The loading screen: a dark carved plate with the title and a stone bar. */
  draw(ctx) {
    const W = layout.w, H = layout.h;
    ctx.clearRect(0, 0, W, H);

    if (!this._bg || this._bg.width !== W) this._bg = this._paintBackdrop(W, H);
    ctx.drawImage(this._bg, 0, 0);

    const font = this.assets.font;
    const cx = W / 2;

    const title = 'MIGHT AND MAGIC VI';
    const sub = 'The Mandate of Heaven';
    if (font && font.drawText) {
      font.drawText(ctx, title, cx, H * 0.30, { face: 'title', align: 'center', color: '#ffd84a' });
      font.drawText(ctx, sub, cx, H * 0.30 + 24, { face: 'normal', align: 'center', color: '#c8b888' });
    } else {
      ctx.fillStyle = '#ffd84a';
      ctx.font = 'bold 26px serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, cx, H * 0.30 + 20);
      ctx.font = '14px serif';
      ctx.fillStyle = '#c8b888';
      ctx.fillText(sub, cx, H * 0.30 + 44);
      ctx.textAlign = 'left';
    }

    // Progress trough: a groove cut into the plate, its rim lit along the top
    // and left and shadowed along the bottom and right, filled with a bar of
    // banded brass. Chiselled, because a rounded bar with a smooth gradient is
    // the first thing that says "not 1998".
    const bw = Math.min(360, W - 120), bh = 14;
    const bx = Math.round(cx - bw / 2), by = Math.round(H * 0.66);
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = rampCss('stone', 1);
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by, 1, bh);
    ctx.fillStyle = rampCss('stone', 7);
    ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx + bw - 1, by, 1, bh);

    const fill = Math.round((bw - 4) * Math.max(0, Math.min(1, this.progress)));
    // Four bands across the bar's height, not a per-column gradient: the light
    // catches the top of a moulding and falls away down its face.
    const BANDS = [10, 8, 6, 4];
    const step = (bh - 4) / BANDS.length;
    for (let b = 0; b < BANDS.length; b++) {
      ctx.fillStyle = rampCss('gold', BANDS[b]);
      ctx.fillRect(bx + 2, Math.round(by + 2 + b * step), fill, Math.ceil(step));
    }
    if (fill > 1) {
      ctx.fillStyle = rampCss('gold', 3);
      ctx.fillRect(bx + 2 + fill - 1, by + 2, 1, bh - 4);   // leading edge in shadow
    }

    const label = this.error ? 'Something went wrong' : this.label;
    const dots = '.'.repeat(1 + (Math.floor(Math.abs(this.t) * 2) % 3));
    if (font && font.drawText) {
      font.drawText(ctx, label + dots, cx, by + bh + 8, { align: 'center', color: '#e8dcb0' });
      if (this.detail) font.drawText(ctx, this.detail, cx, by + bh + 22, { face: 'small', align: 'center', color: '#8a7f60' });
    } else {
      ctx.fillStyle = '#e8dcb0';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label + dots, cx, by + bh + 18);
      ctx.textAlign = 'left';
    }
  }

  _paintBackdrop(W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // A vertical fade in eight hard steps, not a per-scanline ramp: this frame
    // is the first thing anyone sees, and a smooth gradient with a radial
    // vignette is exactly the idiom a 256-colour game cannot produce.
    const STEPS = 8;
    for (let s = 0; s < STEPS; s++) {
      const col = ramp('stone', 1 + (s / (STEPS - 1)) * 3.2);
      g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      g.fillRect(0, Math.round((s * H) / STEPS), W, Math.ceil(H / STEPS) + 1);
    }
    // Corner darkening as a Bayer stipple of solid black, densest at the edges.
    const B = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
      12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
      15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
    // Written through ImageData rather than half a million fillRects, because
    // this runs on the way to the first visible frame.
    const hw = W / 2, hh = H / 2, rmax = Math.hypot(hw, hh);
    const img = g.getImageData(0, 0, W, H);
    const px = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - hw, y - hh) / rmax;
        const d = Math.max(0, (r - 0.42) / 0.58) * 0.85;
        if (d <= 0) continue;
        if (B[((y & 7) << 3) | (x & 7)] / 64 + 0.0078 >= d) continue;
        const o = (y * W + x) * 4;
        px[o] = 0; px[o + 1] = 0; px[o + 2] = 0;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

// Literal import() calls so the bundler can see and ship these; a computed
// specifier would be invisible to it and 404 in a production build.
const ART_MODULES = {
  './art/textures.js': () => import('./art/textures.js'),
  './art/vfxart.js': () => import('./art/vfxart.js'),
  './art/font.js': () => import('./art/font.js'),
  './art/uiart.js': () => import('./art/uiart.js'),
  './art/portraits.js': () => import('./art/portraits.js'),
  './art/spritebake.js': () => import('./art/spritebake.js'),
  './art/models/flora.js': () => import('./art/models/flora.js'),
  './art/models/props.js': () => import('./art/models/props.js'),
  './art/models/creatures.js': () => import('./art/models/creatures.js'),
};

async function safeImport(path) {
  const load = ART_MODULES[path];
  if (!load) { console.warn('unknown art module:', path); return null; }
  try {
    return await load();
  } catch (e) {
    console.warn('optional module missing:', path, e.message);
    return null;
  }
}
