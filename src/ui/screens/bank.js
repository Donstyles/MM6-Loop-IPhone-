// ---------------------------------------------------------------------------
// The bank.
//
// MM6 pays interest on deposited gold, which is the only reason to leave any
// behind: the balance grows while you are out in the field. Interest is settled
// lazily - whenever the screen is opened we work out how many weeks have passed
// since the last settlement and compound them in one go.
// ---------------------------------------------------------------------------

import { rampCss } from '../../core/palette.js';
import { clamp } from '../../core/rng.js';
import * as F from '../../art/font.js';
import {
  HouseScreen, PANEL, A, plate, baked, glow, poly, figure, gold, hotText,
  paintWall, paintFloor, paintShelf, paintCounter, paintClutter, vignette,
  partyGold, spend, earn,
  C_WHITE, C_GOLD, C_CANARY, C_DIM, C_RED, C_GREEN,
} from './dialogue.js';

const WEEK = 7 * 24 * 60;      // game minutes
const RATE = 0.05;             // 5% a week on the balance
const AMOUNTS = [100, 500, 1000, 5000];

/** Vault door, iron-bound counter, ledgers, scales and coin. */
export function paintBankInterior(g, w, h) {
  const horizon = Math.round(h * 0.56);
  paintWall(g, 0, 0, w, horizon, { ramp: 'stone', lo: 0.12, hi: 0.46, course: 24, seed: 121 });
  paintFloor(g, 0, horizon, w, h - horizon, { ramp: 'stone', seed: 133 });

  // Chequered marble floor, drawn over the wash.
  g.save();
  g.globalAlpha = 0.35;
  for (let y = horizon, row = 0; y < h; y += 16, row++) {
    for (let x = -((row % 2) * 24); x < w; x += 48) {
      g.fillStyle = rampCss('grey', row % 2 ? 3 : 8);
      g.fillRect(x, y, 24, 16);
    }
  }
  g.restore();

  // The vault door dominates the back wall.
  const vx = w * 0.62, vy = 44, vr = 76;
  g.fillStyle = rampCss('grey', 3);
  g.fillRect(vx - vr - 10, vy - 6, vr * 2 + 20, vr * 2 + 12);
  g.fillStyle = rampCss('grey', 6);
  g.beginPath(); g.arc(vx, vy + vr, vr, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('grey', 9);
  g.beginPath(); g.arc(vx, vy + vr, vr - 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('grey', 5);
  g.beginPath(); g.arc(vx, vy + vr, vr - 20, 0, Math.PI * 2); g.fill();
  // Spokes and the wheel.
  g.strokeStyle = rampCss('gold', 8); g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(vx, vy + vr);
    g.lineTo(vx + Math.cos(a) * (vr - 14), vy + vr + Math.sin(a) * (vr - 14));
    g.stroke();
  }
  g.fillStyle = rampCss('gold', 10);
  g.beginPath(); g.arc(vx, vy + vr, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = rampCss('gold', 13);
  g.beginPath(); g.arc(vx - 3, vy + vr - 3, 4, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = rampCss('grey', 11);
    g.fillRect((vx + Math.cos(a) * (vr - 4)) | 0, (vy + vr + Math.sin(a) * (vr - 4)) | 0, 3, 3);
  }
  glow(g, vx, vy + vr, 110, '#e1cd23', 0.28);

  // Shelf of ledgers on the left.
  paintShelf(g, 20, 92, 150, { th: 5 });
  paintShelf(g, 20, 134, 150, { th: 5 });
  for (let i = 0; i < 13; i++) {
    const x = 26 + i * 11;
    const bh = 22 + (i % 4) * 4;
    g.fillStyle = rampCss(['blood', 'wood', 'foliage', 'water'][i % 4], 4 + (i % 3));
    g.fillRect(x, 92 - bh, 8, bh);
    g.fillStyle = rampCss('gold', 8);
    g.fillRect(x, 92 - bh + 4, 8, 1);
    if (i < 11) {
      g.fillStyle = rampCss(['wood', 'blood', 'swamp'][i % 3], 5);
      g.fillRect(x, 134 - 20, 8, 20);
    }
  }

  // Counter with a cage grille, scales and a coin stack.
  const cy = h - 78;
  paintCounter(g, 0, cy, w, 30, { cloth: 'foliage' });
  for (let x = 12; x < w - 12; x += 22) {
    g.fillStyle = rampCss('gold', 6);
    g.fillRect(x, cy - 54, 3, 54);
  }
  g.fillStyle = rampCss('gold', 8);
  g.fillRect(0, cy - 56, w, 4);
  // A teller behind the grille.
  figure(g, w * 0.30, cy + 2, 84, 'rgba(20,18,22,0.9)', 'rgba(255,224,160,0.45)');
  // Scales on the counter.
  const sx = w - 96;
  g.fillStyle = rampCss('gold', 7);
  g.fillRect(sx, cy - 26, 3, 26);
  g.fillRect(sx - 20, cy - 26, 43, 2);
  for (const ox of [-20, 20]) {
    g.beginPath();
    g.moveTo(sx + ox - 8, cy - 18); g.lineTo(sx + ox + 8, cy - 18); g.lineTo(sx + ox, cy - 12);
    g.closePath(); g.fill();
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = rampCss('gold', 10 - i);
    g.beginPath(); g.ellipse(sx - 52, cy - 4 - i * 3, 9, 3, 0, 0, Math.PI * 2); g.fill();
  }

  paintClutter(g, w - 44, h - 6, 'crate', 26);
  vignette(g, w, h);
}

export class BankScreen extends HouseScreen {
  constructor(session, ui, hud, opts = {}) {
    super(session, ui, hud, opts);
    this.id = 'bank';
    this.title = opts.title || 'Bank of Enroth';
    this.keeper = opts.keeper || { name: 'Halvor Penn', title: 'Banker', portraitSeed: 64, sex: 'm' };
    this.amount = AMOUNTS[0];
    this.mode = 'deposit';
    this.settle();
  }

  // --- account -------------------------------------------------------------

  get bank() {
    const p = this.session.party;
    if (!p) return { balance: 0, lastDay: 0, earned: 0 };
    if (!p.bank) p.bank = { balance: 0, lastMinutes: this.now, earned: 0 };
    if (p.bank.lastMinutes === undefined) p.bank.lastMinutes = this.now;
    return p.bank;
  }

  get now() {
    const c = this.session && this.session.clock;
    return c ? c.minutes : 0;
  }

  /** Compound every whole week that has passed since the last settlement. */
  settle() {
    const b = this.bank;
    if (!b) return 0;
    const weeks = Math.floor((this.now - b.lastMinutes) / WEEK);
    if (weeks <= 0 || b.balance <= 0) return 0;
    const before = b.balance;
    b.balance = Math.floor(b.balance * Math.pow(1 + RATE, weeks));
    b.lastMinutes += weeks * WEEK;
    const gained = b.balance - before;
    b.earned = (b.earned | 0) + gained;
    if (gained > 0) this.say(`Your account has earned ${gold(gained)} gold in interest.`);
    return gained;
  }

  deposit(n) {
    const b = this.bank;
    const amount = n === 'all' ? partyGold(this.session) : Math.min(n, partyGold(this.session));
    if (amount <= 0) { this.say('You have nothing to deposit.'); return; }
    spend(this.session, amount);
    if (b.balance <= 0) b.lastMinutes = this.now;   // interest starts now
    b.balance += amount;
    this.say(`Deposited ${gold(amount)} gold. Your balance is ${gold(b.balance)}.`);
  }

  withdraw(n) {
    const b = this.bank;
    const amount = n === 'all' ? b.balance : Math.min(n, b.balance);
    if (amount <= 0) { this.say('There is nothing to withdraw.'); return; }
    b.balance -= amount;
    earn(this.session, amount);
    this.say(`Withdrew ${gold(amount)} gold. Your balance is ${gold(b.balance)}.`);
  }

  // --- panel ---------------------------------------------------------------

  options() {
    return [
      { id: 'deposit', label: 'Deposit', note: `${gold(this.amount)} gold`, tip: 'Put gold into the account.' },
      { id: 'withdraw', label: 'Withdraw', note: `${gold(this.amount)} gold`, tip: 'Take gold out of the account.' },
      { id: 'depositAll', label: 'Deposit All' },
      { id: 'withdrawAll', label: 'Withdraw All' },
    ];
  }

  onOption(id) {
    switch (id) {
      case 'deposit': this.deposit(this.amount); return;
      case 'withdraw': this.withdraw(this.amount); return;
      case 'depositAll': this.deposit('all'); return;
      case 'withdrawAll': this.withdraw('all'); return;
      default:
    }
  }

  panelInfo() {
    const b = this.bank;
    return [
      { text: `Purse: ${gold(partyGold(this.session))}`, color: C_CANARY },
      { text: `Account: ${gold(b.balance)}`, color: C_GREEN },
    ];
  }

  backdrop() {
    return baked('bank', PANEL.w, PANEL.h, (g, w, h) => paintBankInterior(g, w, h));
  }

  drawContent(ctx) {
    const x = PANEL.x + 16, y = PANEL.y + 16, w = 300, h = 128;
    plate(ctx, x, y, w, h, 0.72);
    F.drawText(ctx, 'Account', x + 10, y + 6, { color: C_CANARY });
    A.rule(ctx, x + 8, y + 22, w - 16, '#7a6a4a');

    const b = this.bank;
    const rows = [
      ['On deposit', `${gold(b.balance)} gold`, C_GREEN],
      ['In your purse', `${gold(partyGold(this.session))} gold`, C_WHITE],
      ['Interest earned', `${gold(b.earned | 0)} gold`, C_CANARY],
      ['Rate', `${Math.round(RATE * 100)}% a week`, C_DIM],
    ];
    rows.forEach(([l, v, c], i) => {
      const ry = y + 30 + i * 15;
      F.drawText(ctx, l, x + 12, ry, { face: 'small', color: C_WHITE });
      F.drawText(ctx, v, x + w - 12, ry, { face: 'small', align: 'right', color: c });
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#8a7a58';
      for (let dx = x + 14 + F.measure(l, 'small').w; dx < x + w - 16 - F.measure(v, 'small').w; dx += 3) {
        ctx.fillRect(dx | 0, ry + 6, 1, 1);
      }
      ctx.globalAlpha = 1;
    });

    // Amount selector, so the two option buttons can move any sum.
    const ay = y + h - 22;
    F.drawText(ctx, 'Amount', x + 12, ay, { face: 'small', color: C_DIM });
    let ax = x + 62;
    for (const a of AMOUNTS) {
      const on = this.amount === a;
      const r = hotText(this.ui, ctx, `${this.id}:amt${a}`, ax, ay, gold(a),
        { face: 'small', color: on ? C_GOLD : C_WHITE });
      if (on) { ctx.fillStyle = C_GOLD; ctx.fillRect(r.x, ay + 9, r.w, 1); }
      if (r.click) this.amount = a;
      ax += r.w + 14;
    }

    // Next interest payment, so leaving gold here has a visible reward.
    if (b.balance > 0) {
      const due = Math.max(0, WEEK - ((this.now - b.lastMinutes) % WEEK));
      const days = Math.floor(due / (24 * 60));
      const hours = Math.floor((due % (24 * 60)) / 60);
      F.drawText(ctx, `Next payment of ${gold(Math.floor(b.balance * RATE))} gold in ${days}d ${hours}h`,
        x + 12, y + h + 6, { face: 'small', color: C_CANARY });
    }
  }
}

export default BankScreen;
