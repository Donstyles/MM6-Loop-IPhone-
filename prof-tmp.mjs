import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const proc = spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5178','--strictPort'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,3500));
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page = await b.newPage();
await page.goto('http://127.0.0.1:5178/tools/preview/audio.html',{waitUntil:'domcontentloaded'});
await page.click('#start');
await page.waitForFunction('window.__ready===true');
const r = await page.evaluate(async () => {
  const a = window.__audio;
  const out = { init: a.initMs, ctx: a.ctxMs, bake: a.bakeMs };
  // raw offline-context cost with nothing in it
  let t = performance.now();
  for (let i=0;i<10;i++){ const o=new OfflineAudioContext(2, 4410, 44100); await o.startRendering(); }
  out.emptyCtxAvg = (performance.now()-t)/10;
  // 5 s of silence in one context
  t = performance.now();
  { const o=new OfflineAudioContext(2, 44100*5, 44100); await o.startRendering(); }
  out.silence5s = performance.now()-t;
  // per-sound timings
  const per = {};
  for (const id of ['explosion','amb_wind','amb_forest','amb_cave','portal_open','roar_dragon','step_grass','click']) {
    a.buffers.delete(id); a.pending.delete(id);
    const t0 = performance.now();
    await a.renderToBuffer(id);
    per[id] = +(performance.now()-t0).toFixed(1);
  }
  out.per = per;
  // warm re-bake of exactly the hot set, to separate one-time audio-thread
  // warmup from the real cost of the recipes
  const HOT = ['click','click_soft','step_grass','step_stone','step_wood','swing_light','hit_flesh','hit_armor','miss','party_hurt','item_pickup','error','page_turn'];
  for (const id of HOT) { a.buffers.delete(id); a.pending.delete(id); }
  let t2 = performance.now();
  await a._bakeBatch(HOT);
  out.rebakeHotBatch = +(performance.now()-t2).toFixed(1);
  for (const id of HOT) { a.buffers.delete(id); a.pending.delete(id); }
  t2 = performance.now();
  await Promise.all(HOT.map(id => a._ensure(id)));
  out.rebakeHotIndividual = +(performance.now()-t2).toFixed(1);
  return out;
});
console.log(JSON.stringify(r,null,2));
await b.close(); proc.kill();
