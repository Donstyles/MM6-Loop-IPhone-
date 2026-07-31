import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { computeLayout, layout, inView } from './core/layout.js';
import { Input } from './core/input.js';
import { UIContext, ScreenStack } from './ui/uikit.js';
import { Boot } from './boot.js';

// ---------------------------------------------------------------------------
// Shell.
//
// Owns the canvases, the frame loop and the top-level state machine
// (loading -> title -> character creation -> play). Everything else hangs off
// the Session.
// ---------------------------------------------------------------------------

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const bootEl = document.getElementById('boot');

const engine = new Engine(glCanvas);
const input = new Input(document.getElementById('stage'));
const ui = new UIContext();
const screens = new ScreenStack();
const uiCtx = uiCanvas.getContext('2d', { alpha: true });
uiCtx.imageSmoothingEnabled = false;

/** @type {Session|null} */
let session = null;
let hud = null;
let state = 'loading';
let boot = null;

function resize() {
  const cw = window.innerWidth, ch = window.innerHeight;
  // Phones get the widened 3D window; a 4:3 display stays authentic.
  computeLayout(cw, ch, true);
  engine.layoutTo(layout.view, layout.screen);
  uiCanvas.width = layout.w;
  uiCanvas.height = layout.h;
  uiCanvas.style.left = `${layout.screen.x}px`;
  uiCanvas.style.top = `${layout.screen.y}px`;
  uiCanvas.style.width = `${layout.screen.w}px`;
  uiCanvas.style.height = `${layout.screen.h}px`;
  uiCtx.imageSmoothingEnabled = false;
  if (hud) hud.invalidate();
  if (boot) boot.invalidate?.();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

// --- frame loop ------------------------------------------------------------

let last = performance.now();
let frames = 0, fpsAccum = 0;
const perf = { fps: 0, drawCalls: 0, tris: 0, sprites: 0, entities: 0, ms: 0 };
window.__perf = perf;

function frame(now) {
  const t0 = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;            // don't simulate a whole tab-switch
  frames++; fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    perf.fps = Math.round(frames / fpsAccum);
    window.__fps = perf.fps;
    frames = 0; fpsAccum = 0;
  }

  ui.beginFrame(uiCtx, input.pointer, input.takeUiEvents());

  if (state === 'loading') {
    boot.update(dt);
    boot.draw(uiCtx);
    if (boot.done) enterTitle();
  } else {
    tickGame(dt);
  }

  ui.endFrame();
  input.endFrame();

  const info = engine.renderer.info;
  perf.drawCalls = info.render.calls;
  perf.tris = info.render.triangles;
  perf.ms = performance.now() - t0;
  if (session) { perf.sprites = session.stats.sprites; perf.entities = session.stats.entities; }

  requestAnimationFrame(frame);
}

function tickGame(dt) {
  const top = screens.top;

  if (session) {
    // The world keeps running behind menus in MM6 only for the clock, so we
    // freeze simulation but still draw the last frame behind the panel.
    if (!top || top.worldRunsBehind) {
      session.update(dt, input);
      session.render();
    } else {
      session.clock.advance(dt * 0.0);
    }
    engine.render();
  } else {
    engine.render();
  }

  uiCtx.clearRect(0, 0, layout.w, layout.h);

  if (top) {
    if (top.update) top.update(dt, input);
    top.draw(uiCtx);
  } else if (hud) {
    hud.showTouch = input.hasTouch;
    hud.stickDX = input.stick.dx; hud.stickDY = input.stick.dy;
    hud.draw(uiCtx, dt);
    handleWorldInput();
    handleHudButtons();
  }

  handleKeys();
}

// --- input routing ---------------------------------------------------------

function handleKeys() {
  const top = screens.top;
  if (top && top.handleKey) {
    for (const code of input.justPressed) if (top.handleKey(code)) return;
  }
  if (input.justPressed.has('Escape')) {
    if (screens.isOpen) screens.pop();
    else openScreen('options');
    return;
  }
  if (!session || screens.isOpen) return;

  if (input.justPressed.has('KeyC')) openScreen('charsheet');
  if (input.justPressed.has('KeyI')) openScreen('inventory');
  if (input.justPressed.has('KeyB')) openScreen('spellbook');
  if (input.justPressed.has('KeyQ')) openScreen('questlog');
  if (input.justPressed.has('KeyM')) openScreen('mapscreen');
  if (input.justPressed.has('KeyZ')) openScreen('quickref');
  if (input.justPressed.has('KeyR')) openScreen('rest');
  if (input.justPressed.has('Enter')) session.turnBased = !session.turnBased;
  for (let i = 0; i < 4; i++) {
    if (input.justPressed.has(`Digit${i + 1}`)) session.activeChar = i;
  }
  if (input.justPressed.has('KeyE') || input.justPressed.has('Space')) doActivate();
}

function handleWorldInput() {
  for (const e of input.takeWorldEvents()) {
    if (e.type === 'tap') {
      // A tap in the world attacks what is under it, or interacts if it is
      // something you can talk to or open.
      const target = session.hoverEntity;
      if (target && target.interact) doActivate();
      else doAttack();
    }
  }
}

function handleHudButtons() {
  if (!hud) return;
  for (const b of hud.buttons) {
    if (!b.hit.click) continue;
    if (b.id === 'cast') openScreen('spellbook');
    else if (b.id === 'rest') openScreen('rest');
    else if (b.id === 'quickref') openScreen('quickref');
    else if (b.id === 'options') openScreen('options');
    else if (b.id === 'turnbased') session.turnBased = !session.turnBased;
    else if (b.id.startsWith('char')) session.activeChar = parseInt(b.id.slice(4), 10);
  }
}

function doAttack() { if (session && session.attack) session.attack(); }
function doActivate() {
  if (!session) return;
  const hit = session.activate();
  if (hit && session.handleActivate) session.handleActivate(hit);
}

// --- state transitions -----------------------------------------------------

const screenFactories = new Map();
export function registerScreen(id, factory) { screenFactories.set(id, factory); }

function openScreen(id, opts) {
  const f = screenFactories.get(id);
  if (!f) { console.warn('no screen', id); return; }
  if (screens.top && screens.top.id === id) { screens.pop(); return; }
  screens.clear();
  screens.push(f(session, ui, hud, opts));
}
window.__openScreen = openScreen;

async function enterTitle() {
  state = 'title';
  try {
    const mod = await import('./bootstrap.js');
    await mod.startGame({
      engine, input, ui, screens, uiCtx, registerScreen, openScreen,
      setSession: (s, h) => { session = s; hud = h; window.__session = s; },
    });
    window.__gameReady = true;
  } catch (e) {
    console.error('start failed', e);
    window.__startError = String(e && e.stack || e);
  }
}

// --- go --------------------------------------------------------------------

resize();
bootEl.style.display = 'none';
boot = new Boot(engine);
boot.start();
requestAnimationFrame(frame);
window.__ready = true;
window.__engine = engine;
