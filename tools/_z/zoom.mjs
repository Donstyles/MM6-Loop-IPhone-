// zoom.mjs <in.png> <out.png> <x> <y> <w> <h> <scale>
// Crops a logical-640x480 region (input PNGs are 2x) and rescales nearest-neighbour.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [, , inp, out, X, Y, W, H, S] = process.argv;
const x = +X * 2, y = +Y * 2, w = +W * 2, h = +H * 2, s = +(S || 2);
const b64 = readFileSync(path.resolve(inp)).toString('base64');
const browser = await chromium.launch({
  executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: Math.ceil(w * s), height: Math.ceil(h * s) }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:#000;overflow:hidden}
canvas{image-rendering:pixelated;display:block}</style><canvas id=c></canvas><script>
const img=new Image();img.onload=()=>{const c=document.getElementById('c');
c.width=${Math.ceil(w * s)};c.height=${Math.ceil(h * s)};const g=c.getContext('2d');
g.imageSmoothingEnabled=false;g.drawImage(img,${x},${y},${w},${h},0,0,${w * s},${h * s});
window.__done=true;};img.src='data:image/png;base64,${b64}';
</script>`);
await page.waitForFunction('window.__done===true', { timeout: 20000 });
await page.screenshot({ path: out });
console.log('wrote', out);
await browser.close();
