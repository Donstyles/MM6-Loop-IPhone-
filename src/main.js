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
  // Never simulate a whole tab-switch, and never a negative step.
  dt = Math.max(0, Math.min(0.25, dt));
  frames++; fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    perf.fps = Math.round(frames / fpsAccum);
    window.__fps = perf.fps;
    frames = 0; fpsAccum = 0;
  }

  ui.beginFrame(uiCtx, input.pointer, input.takeUiEvents());

  // One bad frame must never end the game. An exception escaping here would
  // stop the requestAnimationFrame chain and freeze on the last image drawn,
  // which looks like a hang rather than a bug.
  try {
    if (state === 'loading') {
      boot.update(dt);
      boot.draw(uiCtx);
      if (boot.done) enterTitle();
    } else {
      tickGame(dt);
    }
  } catch (e) {
    reportFrameError(e);
  }

  ui.endFrame();
  input.endFrame();

  perf.drawCalls = engine.sceneCalls || 0;
  perf.tris = engine.sceneTris || 0;
  perf.ms = performance.now() - t0;
  if (session) { perf.sprites = session.stats.sprites; perf.entities = session.stats.entities; }

  requestAnimationFrame(frame);
}

const seenFrameErrors = new Set();
const frameErrors = [];
window.__frameErrors = frameErrors;

/** Log each distinct frame error once; repeats every frame are just noise. */
function reportFrameError(e) {
  const key = String((e && e.stack) || e).slice(0, 400);
  if (!seenFrameErrors.has(key)) {
    seenFrameErrors.add(key);
    frameErrors.push(key);
    console.error('frame error (recovered):', e);
  }
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
    // The carved surround stays visible around every panel, and the panel is
    // clipped to the world window so a stray screen cannot paint over it.
    if (hud && !top.fullFrame) hud.drawFrame(uiCtx, dt);
    if (top.update) top.update(dt, input);
    if (top.fullFrame) {
      top.draw(uiCtx);
    } else {
      // Panels own everything above the party bar: the character sheet's
      // paperdoll and a shop's dialogue column both legitimately paint over the
      // right-hand panel, so only the bottom bar is protected.
      uiCtx.save();
      uiCtx.beginPath();
      uiCtx.rect(0, 0, layout.w, layout.hud.y);
      uiCtx.clip();
      top.draw(uiCtx);
      uiCtx.restore();
    }
    if (hud && !top.fullFrame) handleHudButtons();
  } else if (hud) {
    hud.showTouch = input.hasTouch;
    hud.showReticle = input.hasTouch || input.mouseLook || input.pointer.inView;
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
  if (input.justPressed.has('Enter')) session.toggleTurnBased();
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
    else if (b.id === 'turnbased') session.toggleTurnBased();
    else if (b.id === 'datetime') session.message(`${session.clock.formatDate()}, ${session.clock.format()}`);
    else if (b.id.startsWith('tab:')) {
      // The five book spines at the foot of the right column.
      const tab = b.id.slice(4);
      if (tab === 'maps') openScreen('mapscreen');
      else openScreen('questlog', { tab });
    } else if (b.id.startsWith('char')) session.activeChar = parseInt(b.id.slice(4), 10);
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

// --- debug harness ---------------------------------------------------------
// Lets the capture tooling drive real gameplay rather than posing static shots.

const scripted = { forward: 0, strafe: 0, turn: 0, until: 0 };

window.__mm6 = {
  get session() { return session; },
  get hud() { return hud; },
  ready: () => !!session && !!hud,
  open: (id, opts) => openScreen(id, opts),
  close: () => screens.clear(),
  /** Skip the title and drop straight into the world (used by capture runs). */
  newGame: () => { screens.clear(); },
  title: () => window.__mm6_showTitle && window.__mm6_showTitle(),
  screen: () => (screens.top ? screens.top.id : null),
  teleport(x, y, z, yaw) {
    if (!session) return;
    session.player.pos.set(x, y, z);
    session.player.vel.set(0, 0, 0);
    if (yaw !== undefined) session.player.yaw = yaw;
    session.player.applyTo(engine.camera);
  },
  pos: () => (session ? session.player.pos.toArray().map(Math.round) : null),
  setTime(hour, minute = 0) {
    if (!session) return;
    const day = Math.floor(session.clock.minutes / 1440);
    session.clock.minutes = day * 1440 + hour * 60 + minute;
  },
  look(dx, dy) {
    if (!session) return;
    session.player.yaw -= dx;
    session.player.pitch = Math.max(-0.39, Math.min(0.39, session.player.pitch - dy));
  },
  /** Hold a movement input for `ms` of simulated play. */
  walk(forward, strafe, ms) {
    scripted.forward = forward; scripted.strafe = strafe;
    scripted.until = performance.now() + ms;
  },
  turn(rate, ms) { scripted.turn = rate; scripted.until = performance.now() + ms; },
  attack: () => session && session.attack && session.attack(),
  activate: () => doActivate(),
  spawn(kind, dist = 700) {
    if (!session || !session.spawner) return null;
    const p = session.player;
    const x = p.pos.x - Math.sin(p.yaw) * dist;
    const z = p.pos.z - Math.cos(p.yaw) * dist;
    return session.spawner.spawnMonster(kind, x, session.map.groundAt(x, z, p.pos.y), z);
  },
  region: (id) => import('./bootstrap.js').then((m) => m.loadRegion(session, id, 12345)),
  dungeon: (spec) => import('./bootstrap.js').then((m) => m.loadDungeon(session, spec || { theme: 'cave' }, 999)),
  stats: () => ({ ...perf, screen: screens.top ? screens.top.id : null }),
  /** Average brightness of the world window, for checking exposure. */
  probe() {
    const gl = engine.renderer.getContext();
    const w = engine.width, h = engine.height;
    const px = new Uint8Array(w * h * 4);
    engine.renderer.setRenderTarget(engine.rt);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    engine.renderer.setRenderTarget(null);
    let top = [0, 0, 0], bot = [0, 0, 0], nT = 0, nB = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * 4;
        // readPixels is bottom-up, so low y is the lower half of the image.
        const t = y > h * 0.55 ? top : bot;
        t[0] += px[i]; t[1] += px[i + 1]; t[2] += px[i + 2];
        if (y > h * 0.55) nT++; else nB++;
      }
    }
    const avg = (s, n) => s.map((v) => Math.round(v / Math.max(1, n)));
    return { sky: avg(top, nT), ground: avg(bot, nB), tint: engine.postMaterial.uniforms.uTint.value.toArray() };
  },
};

/** Merge scripted input into the axes the session reads. */
const realAxes = input.axes.bind(input);
input.axes = () => {
  const a = realAxes();
  if (performance.now() < scripted.until) {
    a.forward = Math.max(-1, Math.min(1, a.forward + scripted.forward));
    a.strafe = Math.max(-1, Math.min(1, a.strafe + scripted.strafe));
    a.turn = Math.max(-1, Math.min(1, a.turn + scripted.turn));
  } else {
    scripted.forward = scripted.strafe = scripted.turn = 0;
  }
  return a;
};

// --- go --------------------------------------------------------------------

resize();
bootEl.style.display = 'none';
boot = new Boot(engine);
boot.start();
requestAnimationFrame(frame);
window.__ready = true;
window.__engine = engine;
