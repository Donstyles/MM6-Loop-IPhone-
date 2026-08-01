import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.setDefaultTimeout(300000);
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await p.evaluate(() => window.__mm6.newGame());
await p.waitForTimeout(2500);
console.log(await p.evaluate(() => {
  const s = window.__session;
  const counts = {};
  let meshes = 0;
  s.mapGroup.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const k = o.material?.name || o.name || o.type;
    counts[k] = (counts[k] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return JSON.stringify({ perf: window.__perf, mapMeshes: meshes, sceneChildren: s.engine.scene.children.length, top }, null, 1);
}));
await b.close();
