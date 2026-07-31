import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:960} });
p.setDefaultTimeout(300000);
p.on('pageerror', e => console.log('[PAGEERROR]', e.message.slice(0,200)));
await p.goto('http://127.0.0.1:5174/', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__gameReady === true', { timeout: 300000 });
await p.evaluate(() => window.__mm6.newGame());
await p.waitForTimeout(800);
await p.evaluate(() => window.__mm6.dungeon({id:'gw',name:'Goblinwatch',theme:'castle',rooms:12,levels:2}));
await p.waitForTimeout(5000);
const r = await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const s = window.__session;
  const g = s.mapGroup;
  const box = new THREE.Box3();
  let meshes = 0, tris = 0;
  g.traverse((o) => { if (o.isMesh) { meshes++; if (o.geometry?.index) tris += o.geometry.index.count/3; } });
  box.setFromObject(g);
  const cam = s.engine.camera;
  return {
    mapId: s.mapId, indoor: s.map.indoor,
    groupChildren: g.children.length, meshes, tris: Math.round(tris),
    groupBox: isFinite(box.min.x) ? [box.min.toArray().map(Math.round), box.max.toArray().map(Math.round)] : 'empty',
    player: s.player.pos.toArray().map(Math.round),
    camera: cam.position.toArray().map(Math.round),
    mapStart: s.map.start,
    groundAtPlayer: Math.round(s.map.groundAt(s.player.pos.x, s.player.pos.z, s.player.pos.y)),
    ceilAtPlayer: Math.round(s.map.ceilingAt(s.player.pos.x, s.player.pos.z, s.player.pos.y)),
    blockedAtPlayer: s.map.blocked(s.player.pos.x, s.player.pos.y+8, s.player.pos.z, 37, 192),
    fog: { color: s.engine.scene.fog?.color.getHexString(), near: s.engine.scene.fog?.near, far: s.engine.scene.fog?.far },
    probe: window.__mm6.probe(),
    drawCalls: window.__perf.drawCalls,
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
