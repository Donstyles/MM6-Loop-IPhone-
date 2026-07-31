import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5173/tools/preview/world.html?region=new_sorpigal', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const lin2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const w = window.__world;
  const out = { meshes: [] };
  w.towns[0].group.traverse((o) => {
    if (!o.geometry || !o.geometry.attributes.color) return;
    const a = o.geometry.attributes.color.array;
    let mn = 9, mx = -9, sum = 0;
    for (let i = 0; i < a.length; i += 3) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); sum += a[i]; }
    out.meshes.push({
      name: o.name || 'mesh', verts: a.length / 3,
      min: (lin2s(mn) * 100).toFixed(0) + '%', max: (lin2s(mx) * 100).toFixed(0) + '%',
      avg: (lin2s(sum / (a.length / 3)) * 100).toFixed(0) + '%',
      mats: Array.isArray(o.material) ? o.material.length : 1,
    });
  });
  out.styles = w.towns[0].buildings.map((b) => b.style).join(',');
  return out;
}), null, 1));
await browser.close();
