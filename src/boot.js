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
    this._budgetMs = 12;    // per-frame generation budget
  }

  start() {
    this._run().catch((e) => {
      console.error('boot failed', e);
      this.error = e;
      this.done = true;
    });
  }

  async _run() {
    for (const stage of STAGES) {
      this.label = stage.label;
      this._stage = stage;
      try {
        await this._runStage(stage);
      } catch (e) {
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
    for (const step of gen) {
      n++;
      if (step && step.id) this.detail = String(step.id);
      const frac = step && step.total ? (step.index + 1) / step.total : 0;
      this.progress = (this._doneWeight + this._stage.weight * frac) / this._totalWeight;
      if (performance.now() - frameStart > this._budgetMs) {
        await nextFrame();
        frameStart = performance.now();
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
        for (let i = 0; i < 8; i++) seeds.push(1000 + i * 7717);
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
    const flora = await safeImport('./art/models/flora.js');
    const props = await safeImport('./art/models/props.js');
    const creatures = await safeImport('./art/models/creatures.js');
    const list = [];
    for (const k of (flora?.FLORA_KINDS || [])) list.push({ category: 'flora', kind: k, seed: 1 });
    for (const k of (props?.PROP_KINDS || [])) list.push({ category: 'prop', kind: k, seed: 1 });

    const starters = [
      'BloodsuckerA', 'BloodsuckerB', 'GoblinA', 'GoblinB', 'GoblinC',
      'RatA', 'RatB', 'BatA', 'BatB', 'SpiderA', 'SpiderB',
      'PeasantM1A', 'PeasantF1A', 'GuardA', 'FighterLeathA', 'FighterLeathB',
      'SkeletonA', 'WolfA', 'LizardArchA', 'ThiefA',
    ];
    const all = creatures?.CREATURE_KINDS || [];
    const pick = starters.filter((k) => all.includes(k));
    // If the roster ids differ from what we expect, fall back to the first few.
    const chosen = pick.length >= 6 ? pick : all.slice(0, 16);
    for (const k of chosen) list.push({ category: 'creature', kind: k, seed: 1 });

    const npcs = ['peasant_m', 'peasant_f', 'merchant', 'guard', 'noble_m', 'noble_f'];
    for (const k of npcs) list.push({ category: 'npc', kind: k, seed: 1 });
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

    // Progress well.
    const bw = Math.min(360, W - 120), bh = 14;
    const bx = Math.round(cx - bw / 2), by = Math.round(H * 0.66);
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rampCss('stone', 2);
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    const fill = Math.round((bw - 4) * Math.max(0, Math.min(1, this.progress)));
    for (let i = 0; i < fill; i++) {
      const t = i / Math.max(1, bw - 4);
      ctx.fillStyle = rampCss('gold', 6 + Math.round(t * 4));
      ctx.fillRect(bx + 2 + i, by + 2, 1, bh - 4);
    }

    const label = this.error ? 'Something went wrong' : this.label;
    const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3));
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
    // A slow vertical fade from near-black to a deep stone blue, dithered so it
    // matches the palette the rest of the game lives in.
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const shade = 1 + t * 3.2;
      const col = ramp('stone', shade);
      g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      g.fillRect(0, y, W, 1);
    }
    // Vignette corners.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    return c;
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function safeImport(path) {
  try {
    return await import(/* @vite-ignore */ path);
  } catch (e) {
    console.warn('optional module missing:', path, e.message);
    return null;
  }
}
