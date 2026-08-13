// On-device diagnostic overlay.
//
// The only true test rig for iOS Safari is an actual iPhone, so the game can
// report on itself: open with ?debug (or triple-tap the top-left corner of
// the loading screen) and a panel lists the GPU, WebGL caps, every shader
// that failed to compile, layout rectangles and safe-area insets - with a
// COPY button so the whole report can be pasted straight back to the devs.
import { layout } from './layout.js';

const report = {
  shaderErrors: [],
  frameErrors: [],
};

/** Called by the engine when a program fails to compile/link. */
export function recordShaderError(info) {
  if (report.shaderErrors.length < 20) report.shaderErrors.push(info);
  scheduleRefresh();
}

export function recordFrameError(msg) {
  if (report.frameErrors.length < 20) report.frameErrors.push(String(msg).slice(0, 300));
  scheduleRefresh();
}

function gatherGL(renderer) {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const p = (k) => { try { return gl.getParameter(k); } catch { return null; } };
    return {
      webgl2: (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext,
      vendor: dbg ? p(dbg.UNMASKED_VENDOR_WEBGL) : p(gl.VENDOR),
      gpu: dbg ? p(dbg.UNMASKED_RENDERER_WEBGL) : p(gl.RENDERER),
      glsl: p(gl.SHADING_LANGUAGE_VERSION),
      maxTex: p(gl.MAX_TEXTURE_SIZE),
      max3D: p(gl.MAX_3D_TEXTURE_SIZE),
      maxVerts: p(gl.MAX_ELEMENTS_VERTICES),
      highpFrag: (() => {
        try {
          const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
          return f ? `p${f.precision} [${f.rangeMin},${f.rangeMax}]` : 'none';
        } catch { return '?'; }
      })(),
      contextLost: gl.isContextLost(),
    };
  } catch (e) { return { error: String(e) }; }
}

function gatherLayout() {
  const r = {};
  for (const k of ['w', 'h', 'view', 'side', 'hud', 'controls', 'safe', 'viewExtra']) {
    try { r[k] = JSON.parse(JSON.stringify(layout[k] ?? null)); } catch { r[k] = '?'; }
  }
  return r;
}

export function buildReport(engine, session) {
  const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
  return {
    when: new Date().toISOString(),
    build: (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'),
    ua: navigator.userAgent,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    viewport: { w: innerWidth, h: innerHeight, vvW: vv && vv.width, vvH: vv && vv.height, vvScale: vv && vv.scale },
    orientation: (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape?' : 'portrait?'),
    gl: engine ? gatherGL(engine.renderer) : null,
    layout: gatherLayout(),
    shaderErrors: report.shaderErrors,
    frameErrors: report.frameErrors,
    perf: engine && engine.perf ? { ...engine.perf } : null,
    session: session ? {
      map: session.mapId,
      entities: session.entities && session.entities.list.length,
      pos: session.player && session.player.pos.toArray().map(Math.round),
      clock: session.clock && session.clock.format && session.clock.format(),
    } : null,
  };
}

let panel = null, refreshTimer = 0, ctx = {};

function scheduleRefresh() {
  if (!panel || refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = 0; render(); }, 500);
}

function render() {
  if (!panel) return;
  const rep = buildReport(ctx.engine, ctx.session ? ctx.session() : null);
  panel.querySelector('#diag-body').textContent = JSON.stringify(rep, null, 1);
  const n = rep.shaderErrors.length + rep.frameErrors.length;
  panel.querySelector('#diag-title').textContent =
    `MM6 device report — ${n ? n + ' ERROR(S)' : 'no errors captured'}`;
}

export function showDiagnostics(engine, sessionGetter) {
  ctx = { engine, session: sessionGetter };
  if (panel) { render(); panel.style.display = 'block'; return; }
  panel = document.createElement('div');
  panel.id = 'diag';
  panel.style.cssText = 'position:fixed;inset:8px;z-index:99;background:rgba(10,10,8,0.94);'
    + 'color:#d8c47a;font:11px/1.45 monospace;padding:10px;overflow:auto;'
    + 'border:1px solid #6b5a2a;border-radius:6px;-webkit-user-select:text;user-select:text;'
    + 'padding-top:max(10px, env(safe-area-inset-top));';
  panel.innerHTML = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
    + '<b id="diag-title"></b>'
    + '<button id="diag-copy" style="font:bold 13px monospace;padding:8px 14px;background:#6b5a2a;color:#fff;border:0;border-radius:4px">COPY REPORT</button>'
    + '<button id="diag-close" style="font:bold 13px monospace;padding:8px 14px;background:#333;color:#ccc;border:0;border-radius:4px">CLOSE</button>'
    + '</div><pre id="diag-body" style="white-space:pre-wrap;word-break:break-all;margin:0"></pre>';
  document.body.appendChild(panel);
  panel.querySelector('#diag-close').onclick = () => { panel.style.display = 'none'; };
  panel.querySelector('#diag-copy').onclick = async () => {
    const text = panel.querySelector('#diag-body').textContent;
    const btn = panel.querySelector('#diag-copy');
    try { await navigator.clipboard.writeText(text); btn.textContent = 'COPIED ✓'; }
    catch {
      // Clipboard API can be denied outside a secure context; fall back to
      // selecting the text so a long-press copy works.
      const range = document.createRange();
      range.selectNodeContents(panel.querySelector('#diag-body'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      try { document.execCommand('copy'); btn.textContent = 'COPIED ✓'; }
      catch { btn.textContent = 'SELECTED — long-press to copy'; }
    }
    setTimeout(() => { btn.textContent = 'COPY REPORT'; }, 2500);
  };
  render();
  setInterval(() => { if (panel && panel.style.display !== 'none') render(); }, 2000);
}

/** Arm the launch gestures: ?debug in the URL, or triple-tap top-left. */
export function armDiagnostics(engine, sessionGetter) {
  if (/[?&]debug/.test(location.search)) {
    // Let the first layout settle so the report carries real rects.
    setTimeout(() => showDiagnostics(engine, sessionGetter), 1500);
  }
  let taps = [];
  addEventListener('pointerdown', (e) => {
    if (e.clientX > 90 || e.clientY > 90) return;
    const now = performance.now();
    taps = taps.filter((t) => now - t < 900);
    taps.push(now);
    if (taps.length >= 3) { taps = []; showDiagnostics(engine, sessionGetter); }
  }, { passive: true });
}
