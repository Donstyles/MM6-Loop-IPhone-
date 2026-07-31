import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { computeLayout, layout } from './core/layout.js';
import { Pix, grainFill, toTexture, cracks, blotch } from './art/texcanvas.js';

// Temporary bootstrap: proves out the layout, the render target and the
// palette post pass. Replaced by the real game shell once the systems land.

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const boot = document.getElementById('boot');
const uiCtx = uiCanvas.getContext('2d');

const engine = new Engine(glCanvas);

function resize() {
  const cw = window.innerWidth, ch = window.innerHeight;
  computeLayout(cw, ch, true);
  engine.layoutTo(layout.view, layout.screen);
  uiCanvas.width = layout.w;
  uiCanvas.height = layout.h;
  uiCanvas.style.left = `${layout.screen.x}px`;
  uiCanvas.style.top = `${layout.screen.y}px`;
  uiCanvas.style.width = `${layout.screen.w}px`;
  uiCanvas.style.height = `${layout.screen.h}px`;
}
window.addEventListener('resize', resize);

// --- placeholder world -----------------------------------------------------
const scene = engine.scene;
scene.fog = new THREE.Fog(0x8fa5bd, 400, 3200);
scene.background = new THREE.Color(0x8fa5bd);

const grass = new Pix(64, 64);
grainFill(grass, 'grass', { period: 10, octaves: 5, seed: 12, lo: 0.28, hi: 0.86, contrast: 1.2 });
blotch(grass, { period: 3, seed: 40, amount: 0.3 });
const grassTex = toTexture(grass, { dither: 12 });
grassTex.repeat.set(160, 160);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20000, 20000),
  new THREE.MeshBasicMaterial({ map: grassTex, fog: true }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const stone = new Pix(64, 64);
grainFill(stone, 'stone', { period: 7, octaves: 4, seed: 3, lo: 0.3, hi: 0.8 });
cracks(stone, { period: 5, seed: 9 });
const stoneTex = toTexture(stone, { dither: 10 });
stoneTex.repeat.set(3, 2);
for (let i = 0; i < 12; i++) {
  const b = new THREE.Mesh(
    new THREE.BoxGeometry(200, 260, 200),
    new THREE.MeshBasicMaterial({ map: stoneTex }),
  );
  b.position.set(Math.cos(i) * 900 + i * 60, 130, Math.sin(i * 1.7) * 900);
  scene.add(b);
}

engine.camera.position.set(0, 160, 0);

let last = performance.now(), frames = 0, fpsT = 0, fps = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

  engine.camera.rotation.y = now * 0.00008;
  engine.render();

  uiCtx.clearRect(0, 0, layout.w, layout.h);
  uiCtx.fillStyle = '#2a2620';
  uiCtx.fillRect(0, layout.h - 128, layout.w, 128);
  uiCtx.fillRect(layout.w - 174, 0, 174, layout.h - 128);
  uiCtx.fillStyle = '#d8c47a';
  uiCtx.font = '12px monospace';
  uiCtx.fillText(`${fps} fps  ${layout.w}x${layout.h}  view ${layout.view.w}x${layout.view.h}`, 8, layout.h - 108);

  window.__fps = fps;
  requestAnimationFrame(frame);
}

resize();
boot.style.display = 'none';
requestAnimationFrame(frame);
window.__ready = true;
