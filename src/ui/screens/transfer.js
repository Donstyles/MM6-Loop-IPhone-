// ---------------------------------------------------------------------------
// Travel: stables and docks.
//
// The destination list uses the map-book page - a painted map of Enroth with
// the towns as hotspots and a dotted route drawn from where you are to where
// you are going, exactly as Town Portal and Lloyd's Beacon present themselves.
// Picking a destination raises the standard Yes/No confirmation; confirming
// advances the clock by the journey time and moves the party.
// ---------------------------------------------------------------------------

import { rampCss, ramp } from '../../core/palette.js';
import { clamp, Rand, fbm2 } from '../../core/rng.js';
import * as F from '../../art/font.js';
import {
  HouseScreen, PANEL, A, baked, poly, washPixels, gold, yesNo, optionList, OPTION, dlgRect,
  exitButton, partyGold, spend, say, MM6, C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_BODY,
} from './dialogue.js';

/**
 * The five stops a stable or dock serves. `x`/`y` are 0..1 across the map page,
 * `land` marks whether a stable can reach it at all.
 */
export const DESTINATIONS = [
  { id: 'sorpigal', name: 'New Sorpigal', x: 0.18, y: 0.78, land: true, sea: true },
  { id: 'ironfist', name: 'Castle Ironfist', x: 0.40, y: 0.44, land: true, sea: false },
  { id: 'freehaven', name: 'Free Haven', x: 0.60, y: 0.62, land: true, sea: true },
  { id: 'silvercove', name: 'Silver Cove', x: 0.80, y: 0.30, land: true, sea: true },
  { id: 'mistyisles', name: 'The Misty Islands', x: 0.88, y: 0.82, land: false, sea: true },
  { id: 'blackshire', name: 'Blackshire', x: 0.30, y: 0.20, land: true, sea: false },
];

/** Painted map of Enroth on a book page: sea, coast, hills, forests, roads. */
export function paintMapPage(g, w, h) {
  // MM6's Town Portal and Lloyd's Beacon both use the sbmap book page, so this
  // is a chart on parchment, not a picture of the sea. The water is drawn the
  // way a period cartographer draws it: paper with parallel hatching.
  MM6.blit(g, MM6.paperCanvas(w, h, 'book', 23), 0, 0);
  for (let y = 3; y < h; y += 6) {
    for (let x = 2; x < w - 2; x += 5) MM6.rct(g, x, y, 3, 1, [126, 142, 148]);
  }

  // Landmass: a blobby island built from a few overlapping ellipses. The coast
  // line is derived from the silhouette rather than stroked per ellipse, or the
  // overlaps show up as arcs running across the middle of the island.
  const land = [
    [0.42, 0.52, 0.40, 0.36], [0.66, 0.40, 0.26, 0.24], [0.26, 0.72, 0.22, 0.18],
    [0.72, 0.68, 0.20, 0.16], [0.34, 0.26, 0.20, 0.14],
  ];
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mg = mask.getContext('2d');
  mg.fillStyle = '#ffffff';
  mg.beginPath();
  for (const [cx, cy, rx, ry] of land) {
    mg.moveTo((cx + rx) * w, cy * h);
    mg.ellipse(cx * w, cy * h, rx * w, ry * h, 0, 0, Math.PI * 2);
  }
  mg.fill();

  // Shore: the mask smeared outward, inked dark, and laid under the land.
  const shore = document.createElement('canvas');
  shore.width = w; shore.height = h;
  const sg2 = shore.getContext('2d');
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [2, -2], [-2, 2]]) {
    sg2.drawImage(mask, dx, dy);
  }
  sg2.globalCompositeOperation = 'source-in';
  sg2.fillStyle = '#4a3a20';
  sg2.fillRect(0, 0, w, h);
  g.drawImage(shore, 0, 0);

  g.save();
  g.beginPath();
  for (const [cx, cy, rx, ry] of land) {
    g.moveTo((cx + rx) * w, cy * h);
    g.ellipse(cx * w, cy * h, rx * w, ry * h, 0, 0, Math.PI * 2);
  }
  g.clip();
  // The land is bare paper with a faint wash, so the drawn symbols carry it.
  MM6.blit(g, MM6.paperCanvas(w, h, 'sheet', 41), 0, 0);
  washPixels(g, 0, 0, w, h, (u, v) => {
    const n = fbm2(u * 0.035, v * 0.035, 3, 2, 0.5, 33) * 0.5 + 0.5;
    // Bare paper with only a breath of tone: the drawn symbols carry the map,
    // and a green wash would read as a satellite photograph.
    return [196 + n * 26, 178 + n * 24, 134 + n * 22];
  }, 33);
  g.restore();

  // Hills and forests as little painted glyphs, the way a period map shows them.
  const rnd = new Rand(404);
  for (let i = 0; i < 46; i++) {
    const x = rnd.int(30, w - 30), y = rnd.int(30, h - 30);
    const inside = land.some(([cx, cy, rx, ry]) => {
      const dx = (x - cx * w) / (rx * w), dy = (y - cy * h) / (ry * h);
      return dx * dx + dy * dy < 0.82;
    });
    if (!inside) continue;
    if (i % 3 === 0) {
      poly(g, [x - 7, y + 4, x, y - 7, x + 7, y + 4], rampCss('stone', 5));
      poly(g, [x - 2, y + 4, x, y - 7, x + 3, y - 1], rampCss('stone', 9));
    } else {
      // Forest: a drawn chevron pair with a trunk, as on a period chart.
      for (let k = 0; k < 4; k++) {
        MM6.rct(g, x - 3 + k, y - k, 1, 1, [58, 78, 40]);
        MM6.rct(g, x + 3 - k, y - k, 1, 1, [58, 78, 40]);
      }
      MM6.rct(g, x, y + 1, 1, 3, [76, 58, 32]);
    }
  }

  // Roads between the towns.
  g.strokeStyle = '#7a6242';
  g.lineWidth = 2;
  g.setLineDash([4, 3]);
  const order = ['sorpigal', 'ironfist', 'freehaven', 'silvercove'];
  g.beginPath();
  order.forEach((id, i) => {
    const d = DESTINATIONS.find((t) => t.id === id);
    const px = d.x * w, py = d.y * h;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  });
  g.stroke();
  g.setLineDash([]);

  // Compass rose, bottom left.
  const rx = 42, ry = h - 44;
  g.strokeStyle = '#4b4b4b'; g.lineWidth = 1;
  g.beginPath(); g.arc(rx, ry, 20, 0, Math.PI * 2); g.stroke();
  poly(g, [rx, ry - 24, rx + 5, ry, rx, ry + 24, rx - 5, ry], '#8a6e46');
  poly(g, [rx, ry - 24, rx + 5, ry, rx - 5, ry], '#e1cd23');
  F.drawText(g, 'N', rx, ry - 36, { face: 'small', align: 'center', color: C_BODY, shadow: null });

  // A sea monster and a ship, because every map of the period has them.
  g.fillStyle = '#2a4a6a';
  g.beginPath();
  g.ellipse(w * 0.10, h * 0.30, 16, 5, -0.2, 0, Math.PI * 2);
  g.fill();
  g.fillRect((w * 0.10 + 12) | 0, (h * 0.30 - 10) | 0, 3, 8);
  g.fillStyle = '#3a5a7a';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(w * 0.92 - i * 12, h * 0.14 + (i % 2) * 4, 5, Math.PI, 0);
    g.fill();
  }
}

export class TransferScreen extends HouseScreen {
  /**
   * @param {object} opts {mode:'stable'|'boat', from, destinations, keeper}
   */
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.mode = opts.mode || 'stable';
    this.id = `transfer:${this.mode}`;
    this.title = opts.title || (this.mode === 'boat' ? 'The Docks' : 'The Stables');
    this.keeper = opts.keeper || (this.mode === 'boat'
      ? { name: 'Captain Vell', title: 'Shipmaster', portraitSeed: 17, sex: 'm' }
      : { name: 'Ostler Bran', title: 'Stablemaster', portraitSeed: 29, sex: 'm' });
    this.from = opts.from || 'sorpigal';
    this.list = (opts.destinations || DESTINATIONS)
      .filter((d) => d.id !== this.from && (this.mode === 'boat' ? d.sea : d.land));
    this.sel = null;
    this.optionY = OPTION.shopY;
    this.onTravel = opts.onTravel || null;
  }

  here() { return DESTINATIONS.find((d) => d.id === this.from) || DESTINATIONS[0]; }

  distance(d) {
    const a = this.here();
    return Math.hypot((d.x - a.x) * 1.6, (d.y - a.y));
  }

  priceOf(d) {
    const base = this.mode === 'boat' ? 100 : 60;
    return Math.max(10, Math.round(base * this.distance(d) * 3));
  }

  /** Journey time in hours: a coach makes about a day between neighbours. */
  hoursOf(d) {
    return Math.max(2, Math.round(this.distance(d) * (this.mode === 'boat' ? 40 : 56)));
  }

  options() {
    return this.list.map((d) => ({
      id: d.id,
      label: d.name,
      note: `${gold(this.priceOf(d))}g - ${this.fmtTime(this.hoursOf(d))}`,
      enabled: true,
      tip: `Travel to ${d.name}.`,
    }));
  }

  fmtTime(hours) {
    if (hours < 24) return `${hours}h`;
    const d = Math.floor(hours / 24), h = hours % 24;
    return h ? `${d}d ${h}h` : `${d} days`;
  }

  onOption(id) {
    const d = this.list.find((x) => x.id === id);
    if (d) this.sel = d;
  }

  depart() {
    const d = this.sel;
    if (!d) return;
    const price = this.priceOf(d);
    if (!spend(this.session, price)) { this.say(`The fare is ${gold(price)} gold.`); return; }
    const hours = this.hoursOf(d);
    if (this.session.clock) this.session.clock.advanceMinutes(hours * 60);
    const p = this.session.party;
    if (p) {
      p.food = Math.max(0, (p.food | 0) - Math.max(1, Math.round(hours / 24)));
      p.location = d.id;
    }
    this.from = d.id;
    this.list = this.list.filter((x) => x.id !== d.id);
    say(this.session, `You arrive at ${d.name}.`, C_GOLD);
    this.say(`After ${this.fmtTime(hours)} on the road you arrive at ${d.name}.`);
    this.sel = null;
    if (this.onTravel) this.onTravel(d, hours);
    else if (this.session && typeof this.session.travelTo === 'function') this.session.travelTo(d.id);
  }

  panelInfo() {
    const p = this.session.party || {};
    return [
      { text: `Gold: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: `Food: ${p.food | 0}`, color: (p.food | 0) > 0 ? C_WHITE : C_RED },
      { text: this.sel ? `To ${this.sel.name}?` : `From ${this.here().name}`, color: this.sel ? C_GOLD : C_DIM },
    ];
  }

  backdrop() {
    // The map is a book page, not a painted room.
    return baked('transfer:map', PANEL.w, PANEL.h, (g, w, h) => {
      A.book(g, 0, 0, w, h, 'left');
      const m = 18;
      paintMapPage2(g, m, m, w - m * 2, h - m * 2);
      A.bevel(g, m - 2, m - 2, w - m * 2 + 4, h - m * 2 + 4, { depth: 2, raised: false });
    });
  }

  drawContent(ctx) {
    const m = 18;
    const mx = PANEL.x + m, my = PANEL.y + m;
    const mw = PANEL.w - m * 2, mh = PANEL.h - m * 2;

    F.drawText(ctx, this.mode === 'boat' ? 'Sailings from ' + this.here().name
      : 'Coaches from ' + this.here().name, mx + 6, my + 4, { color: C_BODY });

    const here = this.here();
    const hx = mx + here.x * mw, hy = my + here.y * mh;

    // Dotted route to the selected destination.
    if (this.sel) {
      const tx = mx + this.sel.x * mw, ty = my + this.sel.y * mh;
      ctx.save();
      ctx.strokeStyle = '#c02818';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -((this.t * 12) % 9);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      // Bow the route so it reads as a journey rather than a ruler line.
      const mxp = (hx + tx) / 2 + (ty - hy) * 0.14;
      const myp = (hy + ty) / 2 - (tx - hx) * 0.14;
      ctx.quadraticCurveTo(mxp, myp, tx, ty);
      ctx.stroke();
      ctx.restore();
      F.drawText(ctx, `${this.fmtTime(this.hoursOf(this.sel))}  ${gold(this.priceOf(this.sel))}g`,
        (hx + tx) / 2, (hy + ty) / 2 - 14, { face: 'small', align: 'center', color: '#8c1c10' });
    }

    // Town markers.
    for (const d of DESTINATIONS) {
      const x = mx + d.x * mw, y = my + d.y * mh;
      const reachable = this.list.some((t) => t.id === d.id);
      const isHere = d.id === this.from;
      const sel = this.sel && this.sel.id === d.id;
      const hit = reachable
        ? this.ui.region(`${this.id}:t${d.id}`, x - 10, y - 10, 20, 20, `${d.name} - ${gold(this.priceOf(d))} gold`)
        : { hover: false, click: false };
      if (hit.click) this.sel = d;

      // Walled-town glyph: two towers and a gate.
      const c = isHere ? '#c02818' : sel || hit.hover ? '#e1cd23' : reachable ? '#4b4b4b' : '#7a7a7a';
      ctx.fillStyle = c;
      ctx.fillRect(x - 6, y - 3, 12, 7);
      ctx.fillRect(x - 7, y - 7, 4, 5);
      ctx.fillRect(x + 3, y - 7, 4, 5);
      ctx.fillStyle = '#efe6cc';
      ctx.fillRect(x - 1, y, 2, 4);

      F.drawText(ctx, d.name, x, y + 7, {
        face: 'small', align: 'center', shadow: null,
        color: isHere ? '#8c1c10' : sel || hit.hover ? '#7a5c00' : C_BODY,
      });
      if (isHere) {
        F.drawText(ctx, 'you are here', x, y + 17, { face: 'small', align: 'center', color: '#8c1c10', shadow: null });
      }
    }
  }

  /** Yes/No replaces the exit button once a destination is picked. */
  drawPanel(ctx) {
    const d = dlgRect();
    A.stone(ctx, d.x, d.y, d.w, d.h, { rivets: true, gold: true });
    A.inset(ctx, d.x + 6, 4, d.w - 12, d.h - 8);
    F.drawText(ctx, this.title, d.x + d.w / 2, 10, { align: 'center', color: C_CANARY, maxWidth: d.w - 20 });
    this.drawKeeper(ctx);
    this.drawPanelInfo(ctx);

    const clicked = optionList(this.ui, ctx, this.options(), { ns: this.id, y: this.optionY });
    if (clicked) { this.sound('click'); this.onOption(clicked); }

    if (this.sel) {
      F.drawText(ctx, `Depart for ${this.sel.name}?`, d.x + d.w / 2, 424,
        { face: 'small', align: 'center', color: C_WHITE, maxWidth: d.w - 12 });
      const r = yesNo(this.ui, ctx, `${this.id}:go`);
      if (r === 'yes') this.depart();
      else if (r === 'no') this.sel = null;
    } else if (exitButton(this.ui, ctx, 'Exit', `${this.id}:exit`)) {
      this.close();
    }
  }
}

/** Wrapper so the map can be painted into an offset rect on the page. */
function paintMapPage2(g, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const gg = c.getContext('2d');
  gg.imageSmoothingEnabled = false;
  paintMapPage(gg, w, h);
  g.drawImage(c, x, y);
}

export default TransferScreen;
