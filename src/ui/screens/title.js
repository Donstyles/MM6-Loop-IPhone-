// ---------------------------------------------------------------------------
// Title screen and main menu.
//
// A full-frame painted illustration: a banded storm sky, a castle on a hill in
// silhouette, a foreground of broken rock, and the game title in the heavy
// serif face with a drop shadow and a gold inner bevel. Clouds drift and the
// gate torches gutter, so the screen is never quite still.
//
// The illustration is baked once; only the clouds, the torch flicker and the
// menu are painted per frame.
// ---------------------------------------------------------------------------

import { layout } from '../../core/layout.js';
import { rampCss, ramp } from '../../core/palette.js';
import { clamp, Rand, fbm2, valueNoise2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import { Screen, A, baked, glow, poly, washPixels, vignette, C_WHITE, C_GOLD, C_DIM } from './dialogue.js';

const MENU = [
  { id: 'new', label: 'New Game' },
  { id: 'load', label: 'Load Game' },
  { id: 'options', label: 'Options' },
  { id: 'credits', label: 'Credits' },
  { id: 'quit', label: 'Quit' },
];

/** Sky, hills, castle, rocks. Everything static in one bake. */
export function paintTitleArt(g, w, h) {
  const horizon = Math.round(h * 0.62);

  // Sky: a dusk gradient in hard bands, storm-dark at the zenith and burning
  // out to orange behind the castle. Streaked noise breaks the bands up.
  const sunX = w * 0.62, sunY = horizon - 30;
  washPixels(g, 0, 0, w, horizon + 2, (u, v) => {
    const t = v / horizon;                       // 0 zenith, 1 horizon
    const n = fbm2(u * 0.010, v * 0.045, 3, 2, 0.55, 3) * 0.5 + 0.5;
    // Distance from the sun drives how far the sky burns toward fire.
    const d = Math.hypot((u - sunX) / (w * 0.55), (v - sunY) / (horizon * 0.9));
    const heat = clamp(1.15 - d, 0, 1);
    const streak = (n - 0.5) * 3.2;
    // Cross-fade sky into fire rather than switching ramps, or the transition
    // shows up as a hard arc across the sky.
    const cold = ramp('sky', Math.round(clamp(1.5 + t * 5.5 + streak, 0, 12)));
    if (heat <= 0.02) return cold;
    const hot = ramp('fire', Math.round(clamp(2 + heat * 11 + streak, 1, 15)));
    const k = clamp(heat * 1.25, 0, 1);
    return [cold[0] + (hot[0] - cold[0]) * k,
      cold[1] + (hot[1] - cold[1]) * k,
      cold[2] + (hot[2] - cold[2]) * k];
  }, 11);

  // The sun's disc sits low behind the towers - small and hot, not a dome.
  glow(g, sunX, sunY, 96, '#ff8018', 0.5);
  g.fillStyle = rampCss('fire', 13);
  g.beginPath(); g.arc(sunX | 0, sunY | 0, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('fire', 15);
  g.beginPath(); g.arc(sunX | 0, sunY | 0, 13, 0, Math.PI * 2); g.fill();

  // Far hills, each nearer layer darker: aerial perspective in reverse, the
  // way a backlit dusk landscape actually reads.
  for (let layer = 0; layer < 3; layer++) {
    const base = horizon - 30 + layer * 16;
    const shade = 4 - layer;
    g.fillStyle = rampCss(layer === 0 ? 'sky' : 'foliage', layer === 0 ? 4 : shade);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = base - Math.sin(x * (0.006 + layer * 0.002) + layer) * (26 - layer * 6)
        - valueNoise2(x * 0.03, layer * 7, 5) * 14;
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  }

  // The castle: keep, curtain wall, towers, banners - all in near-silhouette
  // against the burning sky, with a warm rim on every left-facing edge.
  const cx = w * 0.62, cy = horizon - 26;
  const dark = rampCss('stone', 1);
  const darker = rampCss('stone', 0);
  const rim = rampCss('fire', 9);
  // Motte.
  g.fillStyle = rampCss('foliage', 1);
  g.beginPath();
  g.moveTo(cx - 200, horizon + 30);
  g.quadraticCurveTo(cx, horizon - 66, cx + 200, horizon + 30);
  g.closePath();
  g.fill();
  // Curtain wall.
  g.fillStyle = dark;
  g.fillRect(cx - 118, cy - 44, 236, 52);
  for (let i = 0; i < 20; i++) g.fillRect(cx - 118 + i * 12, cy - 52, 7, 9);
  g.fillStyle = rim;
  g.fillRect(cx - 118, cy - 44, 1, 52);
  for (let i = 0; i < 20; i++) g.fillRect(cx - 118 + i * 12, cy - 52, 7, 1);
  // Towers.
  for (const [tx, th, tw] of [[cx - 128, 96, 30], [cx + 98, 108, 32], [cx - 18, 150, 44]]) {
    g.fillStyle = darker;
    g.fillRect(tx, cy - th, tw, th + 10);
    for (let i = 0; i < tw / 10; i++) g.fillRect(tx + i * 10, cy - th - 8, 6, 9);
    // Conical roof, dark against the sky with a lit windward edge.
    poly(g, [tx - 5, cy - th - 8, tx + tw + 5, cy - th - 8, tx + tw / 2, cy - th - 40], rampCss('blood', 1));
    g.strokeStyle = rim; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(tx - 5, cy - th - 8); g.lineTo(tx + tw / 2, cy - th - 40);
    g.stroke();
    // Rim down the left face.
    g.fillStyle = rim;
    g.fillRect(tx, cy - th, 1, th + 10);
    g.fillRect(tx, cy - th - 8, tw, 1);
    // Lit windows.
    g.fillStyle = '#ffc860';
    g.fillRect(tx + tw / 2 - 2, cy - th + 22, 3, 6);
    g.fillRect(tx + tw / 2 - 2, cy - th + 46, 3, 6);
    // Banner.
    g.fillStyle = rampCss('blood', 4);
    g.fillRect(tx + tw / 2, cy - th - 40, 1, 16);
    poly(g, [tx + tw / 2 + 1, cy - th - 38, tx + tw / 2 + 15, cy - th - 34, tx + tw / 2 + 1, cy - th - 28],
      rampCss('blood', 5));
  }
  // Gatehouse.
  g.fillStyle = darker;
  g.fillRect(cx - 30, cy - 10, 60, 22);
  g.fillStyle = '#1a1008';
  g.beginPath();
  g.moveTo(cx - 16, cy + 12);
  g.lineTo(cx - 16, cy - 2);
  g.arc(cx, cy - 2, 16, Math.PI, 0);
  g.lineTo(cx + 16, cy + 12);
  g.closePath();
  g.fill();
  glow(g, cx, cy + 6, 34, '#ff9030', 0.7);

  // Foreground: broken rock, a dead tree, a road running to the gate. It is
  // nearly black - all the light in this painting is behind the castle.
  washPixels(g, 0, horizon + 10, w, h - horizon - 10, (u, v, r, ww, hh) => {
    const t = v / hh;
    const n = fbm2(u * 0.03, v * 0.05, 3, 2, 0.5, 21) * 0.5 + 0.5;
    const s = clamp(0.5 + n * 3.2 - t * 1.2, 0, 15);
    return ramp(t > 0.55 ? 'dirt' : 'foliage', Math.round(s));
  }, 21);

  // Road, catching a little of the sky.
  poly(g, [cx - 16, horizon + 8, cx + 16, horizon + 8, w * 0.62 + 150, h, w * 0.62 - 130, h], rampCss('dirt', 4));
  poly(g, [cx - 8, horizon + 8, cx + 2, horizon + 8, w * 0.62 + 40, h, w * 0.62 - 30, h], rampCss('dirt', 6));

  // Rocks: dark masses with a single lit facet facing the sun.
  const rnd = new Rand(9);
  for (let i = 0; i < 26; i++) {
    const rx = rnd.int(0, w);
    const ry = horizon + 24 + rnd.int(0, h - horizon - 30);
    const rs = 6 + rnd.int(0, 22) * ((ry - horizon) / (h - horizon));
    const sh = 1 + rnd.int(0, 2);
    poly(g, [rx - rs, ry + rs * 0.5, rx - rs * 0.6, ry - rs * 0.5, rx + rs * 0.3, ry - rs * 0.7,
      rx + rs, ry + rs * 0.4], rampCss('stone', sh));
    poly(g, [rx - rs * 0.6, ry - rs * 0.5, rx + rs * 0.3, ry - rs * 0.7, rx + rs * 0.1, ry - rs * 0.3,
      rx - rs * 0.4, ry - rs * 0.1], rampCss('stone', sh + 3));
  }

  // Dead tree on the left, framing the composition.
  const tx = w * 0.12, ty = h - 30;
  g.strokeStyle = rampCss('wood', 1);
  g.lineWidth = 9;
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 8, ty - 120); g.stroke();
  g.lineWidth = 4;
  for (const [ax, ay, bx2, by2] of [
    [tx - 6, ty - 78, tx - 54, ty - 122], [tx - 7, ty - 96, tx + 40, ty - 148],
    [tx - 8, ty - 112, tx - 34, ty - 160], [tx - 5, ty - 60, tx + 34, ty - 88],
  ]) {
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx2, by2); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(bx2, by2); g.lineTo(bx2 + (bx2 - ax) * 0.4, by2 - 18); g.stroke();
    g.lineWidth = 4;
  }

  vignette(g, w, h, 0.62);
}

/**
 * Big title lettering. The letterform is drawn small and magnified with
 * nearest sampling, which is what gives it the chunky cast-metal look: a dark
 * lip below right, a pale bevel above left and gold in between.
 */
function lettering(textStr, scale, faceName = 'title') {
  const m = F.measure(textStr, faceName);
  const cw = m.w + 4, chh = F.lineHeightOf(faceName) + 4;
  const c = document.createElement('canvas');
  c.width = cw; c.height = chh;
  const gg = c.getContext('2d');
  gg.imageSmoothingEnabled = false;
  const o = { face: faceName, align: 'center', shadow: null };
  F.drawText(gg, textStr, cw / 2 + 1, 3, Object.assign({ color: '#3a2606' }, o));
  F.drawText(gg, textStr, cw / 2, 2, Object.assign({ color: '#8a6a10' }, o));
  F.drawText(gg, textStr, cw / 2 - 1, 1, Object.assign({ color: '#fff2b8' }, o));
  F.drawText(gg, textStr, cw / 2, 2, Object.assign({ color: C_GOLD }, o));
  const out = document.createElement('canvas');
  out.width = cw * scale; out.height = chh * scale;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = false;
  og.drawImage(c, 0, 0, cw, chh, 0, 0, cw * scale, chh * scale);
  return out;
}

function titleBanner() {
  return baked('title:banner2', 600, 96, (g, w, h) => {
    const a = lettering('MIGHT AND MAGIC', 3);
    const b = lettering('VI', 2);
    g.imageSmoothingEnabled = false;
    // Cast shadow: a black copy of the letterform offset down-right.
    const sh = document.createElement('canvas');
    sh.width = a.width; sh.height = a.height;
    const sg = sh.getContext('2d');
    sg.imageSmoothingEnabled = false;
    sg.drawImage(a, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = '#000000';
    sg.fillRect(0, 0, a.width, a.height);
    g.globalAlpha = 0.55;
    g.drawImage(sh, Math.round((w - a.width) / 2) + 5, 5);
    g.globalAlpha = 1;
    g.drawImage(a, Math.round((w - a.width) / 2), 0);
    g.drawImage(b, Math.round((w - b.width) / 2), a.height - 6);
  });
}

export class TitleScreen extends Screen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'title';
    this.t = 0;
    this.selected = 0;
    this.onPick = opts.onPick || null;
    this.version = opts.version || 'v1.0';
  }

  update(dt) { this.t += dt || 0; }

  pick(id) {
    this.sound('click');
    if (this.onPick) this.onPick(id, this);
    else if (this.session && typeof this.session.mainMenu === 'function') this.session.mainMenu(id);
  }

  draw(ctx) {
    const W = layout.w, H = layout.h;
    const art = baked('title:art', W, H, (g, w, h) => paintTitleArt(g, w, h));
    ctx.drawImage(art, 0, 0);

    this.drawClouds(ctx, W, H);
    this.drawTorches(ctx, W, H);

    // Title banner.
    const banner = titleBanner();
    ctx.drawImage(banner, Math.round((W - banner.width) / 2), 22);

    this.drawMenu(ctx, W, H);

    F.drawText(ctx, 'A procedurally generated homage', W / 2, H - 26,
      { face: 'small', align: 'center', color: C_DIM });
    F.drawText(ctx, this.version, W - 10, H - 14, { face: 'small', align: 'right', color: C_DIM });
  }

  /** Two layers of cloud drifting at different speeds across the sky. */
  drawClouds(ctx, W, H) {
    const horizon = Math.round(H * 0.62);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizon - 20);
    ctx.clip();
    for (let layer = 0; layer < 2; layer++) {
      const speed = 5 + layer * 9;
      const off = (this.t * speed) % (W + 260);
      const alpha = layer ? 0.30 : 0.18;
      const y0 = 40 + layer * 54;
      for (let i = 0; i < 4; i++) {
        const cx = -180 + ((off + i * 190) % (W + 260));
        const cy = y0 + (i % 2) * 26;
        const s = (layer ? 1.25 : 0.85) * (0.8 + (i % 3) * 0.2);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = layer ? '#3a4658' : '#6a7488';
        for (let k = 0; k < 6; k++) {
          ctx.beginPath();
          ctx.ellipse((cx + k * 22 * s) | 0, (cy + Math.sin(k) * 5) | 0,
            26 * s, 9 * s, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Gate torches gutter on a fast noise, throwing light on the gatehouse. */
  drawTorches(ctx, W, H) {
    const horizon = Math.round(H * 0.62);
    const cx = W * 0.62, cy = horizon - 26;
    for (const ox of [-26, 26]) {
      const f = 0.6 + 0.4 * valueNoise2(this.t * 7 + ox, 0, 3);
      glow(ctx, cx + ox, cy + 2, 26 * f, '#ff9832', 0.9 * f);
      ctx.fillStyle = '#ffd070';
      ctx.fillRect((cx + ox - 1) | 0, (cy - 2) | 0, 2, 4);
      ctx.fillStyle = 'rgba(255,180,60,0.8)';
      ctx.fillRect((cx + ox - 2) | 0, (cy - 6 - f * 3) | 0, 4, 5);
    }
  }

  drawMenu(ctx, W, H) {
    const w = 220, h = MENU.length * 30 + 22;
    const x = Math.round((W - w) / 2);
    const y = H - h - 54;

    // Carved plate under the menu so the text never fights the painting.
    A.stone(ctx, x, y, w, h, { rivets: true, gold: true });
    A.bevel(ctx, x + 4, y + 4, w - 8, h - 8, { depth: 1, raised: false });
    A.filigree(ctx, x + 14, y + 6, w - 28);

    // Hit-test the whole menu first: hovering must move the selection before
    // anything is drawn, or two rows light up in the same frame.
    const hits = MENU.map((m, i) => this.ui.region(`title:${m.id}`, x + 10, y + 16 + i * 30, w - 20, 26, null));
    const hovered = hits.findIndex((hh) => hh.hover);
    if (hovered >= 0) this.selected = hovered;

    MENU.forEach((m, i) => {
      const my = y + 16 + i * 30;
      const hit = hits[i];
      const on = i === this.selected;
      if (on) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 10, my, w - 20, 26);
        ctx.restore();
        A.gem(ctx, x + 16, my + 9, 7, 'gold');
        A.gem(ctx, x + w - 23, my + 9, 7, 'gold');
      }
      F.drawText(ctx, m.label, x + w / 2, my + 7, {
        align: 'center', color: on ? C_GOLD : C_WHITE,
      });
      if (hit.click) this.pick(m.id);
    });
  }

  handleKey(code) {
    if (code === 'ArrowDown') { this.selected = (this.selected + 1) % MENU.length; return true; }
    if (code === 'ArrowUp') { this.selected = (this.selected + MENU.length - 1) % MENU.length; return true; }
    if (code === 'Enter' || code === 'Space') { this.pick(MENU[this.selected].id); return true; }
    return false;
  }
}

export default TitleScreen;
