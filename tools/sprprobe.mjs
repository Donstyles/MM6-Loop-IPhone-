// In-game sprite probe: what the world tint does to a baked sprite.
//
// Reads `session.lightAt()` at each spawned monster and compares the brightest
// pixel of its atlas cell with the brightest pixel it actually paints on the
// screen, so "the sprite is dark" can be attributed to the bake or to the tint
// with numbers instead of impressions.
//
//   MM6_URL=http://127.0.0.1:5174/ node tools/sprprobe.mjs
import { chromium } from '@playwright/test';

const URL_BASE = process.env.MM6_URL || 'http://127.0.0.1:5174/';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await page.waitForTimeout(800);

const script = `(async () => {
  const out = [];
  const S = __mm6.session;
  __mm6.newGame();
  await new Promise((r) => setTimeout(r, 1500));
  for (const [hh, mm] of [[12, 0], [9, 0], [19, 30], [23, 30]]) {
    __mm6.setTime(hh, mm);
    await new Promise((r) => setTimeout(r, 400));
    const p = S.player.pos;
    const l = S.lightAt(p.x, p.y, p.z);
    out.push('lightAt(party) at ' + hh + ':' + String(mm).padStart(2, '0')
      + ' = ' + l.r.toFixed(3) + ' / ' + l.g.toFixed(3) + ' / ' + l.b.toFixed(3)
      + '   quantised by billboard.js to ' + (Math.floor(Math.min(1, l.r) * 31 + 0.5) * (8 / 248)).toFixed(3));
  }
  __mm6.setTime(12, 0);
  await new Promise((r) => setTimeout(r, 400));
  for (const [kind, dist] of [['GoblinA', 600], ['RatA', 700], ['BatA', 800]]) {
    const e = __mm6.spawn(kind, dist);
    if (!e) { out.push(kind + ': spawn failed'); continue; }
    const l = S.lightAt(e.pos.x, e.pos.y, e.pos.z);
    const sh = e.sheet;
    // brightest opaque texel of the cell the sprite is currently showing
    const r = sh.rect(e.action, e.frame, 1);
    const d = sh.canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
    let mx = 0, mc = null, n = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++; sum += L;
      if (L > mx) { mx = L; mc = [d[i], d[i + 1], d[i + 2]]; }
    }
    out.push(kind + ' @' + dist + 'u  y=' + e.pos.y.toFixed(0)
      + '  scale=' + e.scale.toFixed(3) + '  quad=' + e.sizeH.toFixed(0) + 'u'
      + '  sheet.worldH=' + sh.worldH.toFixed(0) + ' modelH=' + sh.height.toFixed(0)
      + '  atlas maxL=' + mx.toFixed(0) + ' meanL=' + (sum / n).toFixed(0)
      + '  lightAt=' + l.r.toFixed(3)
      + '  => expected on-screen maxL=' + (mx * Math.floor(Math.min(1, l.r) * 31 + 0.5) * (8 / 248)).toFixed(0));
  }
  // Which octant the renderer picks for a monster that is facing the party.
  // Octant 0 is the model's front (the baker parks its camera on +Z and the
  // models are built facing +Z), so anything but ~0 here means the game shows
  // the back of every monster that charges you.
  {
    const e = __mm6.spawn('GoblinA', 700);
    await new Promise((r) => setTimeout(r, 900));
    const cam = __mm6.engine ? __mm6.engine.camera.position : S.player.pos;
    const ai = (yaw, cx, cz, ex, ez, n) => {
      const toCam = Math.atan2(cx - ex, cz - ez);
      let rel = toCam - yaw;
      rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return Math.round((rel / (Math.PI * 2)) * n) % n;
    };
    out.push('chasing goblin: state=' + e.state + ' yaw=' + e.yaw.toFixed(2)
      + '  octant chosen = ' + ai(e.yaw, cam.x, cam.z, e.pos.x, e.pos.z, 8)
      + '  (0 = facing the party, 4 = back turned)');
    e.remove = true;
  }

  // What the framebuffer actually holds where the sprite is. Everything above
  // is theory; this is the pixel the player sees, after the post pass.
  await new Promise((r) => setTimeout(r, 1200));
  const eng = __mm6.engine || (S && S.engine);
  if (eng) {
    const gl = eng.renderer.getContext();
    const w = eng.width, h = eng.height;
    const px = new Uint8Array(w * h * 4);
    eng.renderer.setRenderTarget(eng.rt);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    eng.renderer.setRenderTarget(null);
    // The sprite is green and the ground is not: pick out strongly-green pixels.
    let n = 0, mx = 0, mc = null, sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const R = px[i], G = px[i + 1], B = px[i + 2];
      if (!(G > R + 14 && G > B + 24 && G > 40)) continue;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      n++; sum += L;
      if (L > mx) { mx = L; mc = [R, G, B]; }
    }
    const hx = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    out.push('framebuffer: ' + n + ' green px, meanL ' + (n ? (sum / n).toFixed(0) : '-')
      + ', brightest ' + (mc ? hx(mc) : '-') + ' L=' + mx.toFixed(0));
  }
  return out.join('\\n');
})()`;

console.log(await page.evaluate(script));
errs.slice(0, 10).forEach((e) => console.log(e));
await browser.close();
