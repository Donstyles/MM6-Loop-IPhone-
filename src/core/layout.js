// ---------------------------------------------------------------------------
// Screen layout.
//
// MM6 ran at 640x480 with the 3D world drawn into an inset window on the upper
// left, a carved side panel on the right holding the automap and spell buttons,
// and the party bar across the bottom. We keep those logical coordinates for
// everything and scale the whole 640x480 frame to fit the device, so the UI is
// pixel-identical to the original at any size.
//
// On phones, where a 4:3 frame wastes most of a 19.5:9 screen, WIDE mode keeps
// every panel at its authentic size and only stretches the 3D window and the
// tiling frame around it - the same approach the GrayFace widescreen patch uses.
//
// PORTRAIT mode scales the whole 640x480 frame to the display's width, parks it
// under the top safe-area inset, and turns the dead band below it into a touch
// control zone: virtual stick lower-left, look pad lower-right, action keys
// between them. The logical frame simply grows taller (rows 480..h are the
// control zone) so input and drawing stay in one coordinate space.
// ---------------------------------------------------------------------------

export const BASE_W = 640;
export const BASE_H = 480;

// Authentic metrics, taken from the engine's own constants: the 3D window is
// x 8..468, y 8..352 (461x345), the right panel is 172 wide starting at x 468,
// and the party bar is the bottom 128 rows. Every full-screen panel in the game
// is drawn into the 3D window's rect, which is why PANEL is exported here too.
export const HUD_H = 128;         // bottom party bar height
export const SIDE_W = 172;        // right panel width (automap, compass, buttons)
export const VIEW_X = 8;
export const VIEW_Y = 8;
export const VIEW_W = 461;        // 3D window width in 4:3 mode
export const VIEW_H = 345;        // 3D window height

/** Full-screen panels replace exactly the 3D window; chrome stays visible. */
export const PANEL = { x: VIEW_X, y: VIEW_Y, w: VIEW_W, h: VIEW_H };

export const layout = {
  /** Logical frame size. Height is 480; width grows in wide mode, height in portrait. */
  w: BASE_W,
  h: BASE_H,
  /** 3D viewport rect in logical pixels. */
  view: { x: VIEW_X, y: VIEW_Y, w: VIEW_W, h: VIEW_H },
  /** Right panel origin. */
  side: { x: BASE_W - SIDE_W, y: 0, w: SIDE_W, h: BASE_H - HUD_H },
  /** Bottom bar. */
  hud: { x: 0, y: BASE_H - HUD_H, w: BASE_W, h: HUD_H },
  /** Device pixel rect the logical frame is drawn into. */
  screen: { x: 0, y: 0, w: BASE_W, h: BASE_H, scale: 1 },
  wide: false,
  /** Portrait phone mode: frame scaled to full width, control zone below. */
  portrait: false,
  /** The touch control zone under the frame in portrait mode, or null. */
  controls: null,
  /** Safe-area insets in LOGICAL pixels (already divided by scale). */
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
  /** Logical pixels per physical millimetre (approx, from CSS 96dpi). */
  pxPerMm: 96 / 25.4,
  dpr: 1,
};

/**
 * CSS px per millimetre. The CSS reference (96 px/inch) is only true of a
 * desktop monitor at arm's length: an iPhone packs ~153 *logical* px per
 * physical inch, so a "7 mm" control computed at 96 dpi lands at ~4.4 mm under
 * a thumb. High-density touch devices therefore use the measured mobile
 * density; everything else keeps the CSS reference.
 */
const CSS_PX_PER_MM_DESKTOP = 96 / 25.4;
const CSS_PX_PER_MM_MOBILE = 153 / 25.4;

/** Touch-capable device, decided once (used for physical control sizing). */
export function isTouchDevice() {
  return typeof navigator !== 'undefined'
    && (navigator.maxTouchPoints > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window));
}

function cssPxPerMm() {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return (isTouchDevice() && dpr >= 2) ? CSS_PX_PER_MM_MOBILE : CSS_PX_PER_MM_DESKTOP;
}

/**
 * Read the safe-area insets published by index.html as CSS custom properties
 * (--safe-top .. --safe-left). They resolve env(safe-area-inset-*) with an
 * emulation fallback (--emu-safe-*) so a test harness can fake a notch.
 * Returns CSS pixels.
 */
export function readSafeInsets() {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined') return out;
  try {
    const probe = document.getElementById('safe-probe');
    if (probe) {
      const cs = getComputedStyle(probe);
      const props = { top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft' };
      for (const k of Object.keys(props)) {
        const v = parseFloat(cs[props[k]]);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
    }
  } catch { /* no DOM, no insets */ }
  return out;
}

/**
 * Recompute the layout for a container size.
 * @param {number} cw container width in CSS px
 * @param {number} ch container height in CSS px
 * @param {boolean} allowWide widen the 3D window when the display is wider than 4:3
 */
export function computeLayout(cw, ch, allowWide = true) {
  const aspect = cw / ch;
  const insets = readSafeInsets();
  let logicalW = BASE_W;
  let logicalH = BASE_H;
  let portrait = false;
  let scale;

  if (allowWide && aspect > BASE_W / BASE_H + 0.02) {
    // Landscape phone: grow the logical width so the frame fills the display,
    // then round to an even number of pixels to keep the tiling frame seams on
    // integer columns.
    logicalW = Math.round((BASE_H * aspect) / 2) * 2;
    logicalW = Math.max(BASE_W, Math.min(1280, logicalW));
    scale = Math.min(cw / logicalW, ch / BASE_H);
  } else if (allowWide && aspect < BASE_W / BASE_H - 0.02) {
    // Portrait phone: the frame takes the full width; the band below it
    // becomes the touch control zone.
    portrait = true;
    scale = cw / BASE_W;
    const availH = Math.max(BASE_H, Math.floor((ch - insets.top) / scale));
    logicalH = Math.min(1400, availH);
  } else {
    scale = Math.min(cw / logicalW, ch / BASE_H);
  }

  layout.w = logicalW;
  layout.h = logicalH;
  layout.wide = logicalW > BASE_W;
  layout.portrait = portrait;

  layout.side.x = logicalW - SIDE_W;
  layout.side.y = 0;
  layout.side.w = SIDE_W;
  layout.side.h = BASE_H - HUD_H;

  layout.hud.x = 0;
  layout.hud.y = BASE_H - HUD_H;
  layout.hud.w = logicalW;
  layout.hud.h = HUD_H;

  layout.view.x = VIEW_X;
  layout.view.y = VIEW_Y;
  layout.view.w = logicalW - SIDE_W - VIEW_X;
  layout.view.h = VIEW_H;

  PANEL.x = layout.view.x; PANEL.y = layout.view.y;
  PANEL.w = layout.view.w; PANEL.h = layout.view.h;

  layout.screen.w = Math.round(logicalW * scale);
  layout.screen.h = Math.round(logicalH * scale);
  if (portrait) {
    // Park the frame at the top safe-area inset; the leftover band below is
    // the control zone, already included in logicalH.
    layout.screen.x = Math.round((cw - layout.screen.w) / 2);
    layout.screen.y = Math.round(insets.top);
  } else {
    layout.screen.x = Math.round((cw - layout.screen.w) / 2);
    layout.screen.y = Math.round((ch - layout.screen.h) / 2);
  }
  layout.screen.scale = scale;

  // Safe insets in logical units, clipped to what actually overlaps the frame.
  layout.safe.top = insets.top / scale;
  layout.safe.right = Math.max(0, (layout.screen.x + layout.screen.w) - (cw - insets.right)) / scale;
  layout.safe.bottom = Math.max(0, (layout.screen.y + layout.screen.h) - (ch - insets.bottom)) / scale;
  layout.safe.left = Math.max(0, insets.left - layout.screen.x) / scale;

  layout.pxPerMm = cssPxPerMm() / scale;
  layout.dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);

  // The control zone: everything under the 480-row frame, minus the bottom
  // safe inset (home indicator).
  if (portrait && logicalH > BASE_H + 24) {
    layout.controls = {
      x: 0, y: BASE_H, w: logicalW,
      h: Math.max(0, logicalH - BASE_H - layout.safe.bottom),
    };
  } else {
    layout.controls = null;
  }

  return layout;
}

/** A touch target of `mm` millimetres, in logical pixels (never below `min`). */
export function mmToLogical(mm, min = 0) {
  return Math.max(min, Math.ceil(mm * layout.pxPerMm));
}

/** Convert a client-space point to logical frame coordinates. */
export function toLogical(clientX, clientY) {
  const s = layout.screen;
  return {
    x: (clientX - s.x) / s.scale,
    y: (clientY - s.y) / s.scale,
  };
}

/** Is a logical point inside the 3D window? */
export function inView(x, y) {
  const v = layout.view;
  return x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h;
}

/** Is a logical point inside the portrait touch-control zone? */
export function inControls(x, y) {
  const c = layout.controls;
  return !!c && x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
}
