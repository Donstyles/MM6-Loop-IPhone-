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
// ---------------------------------------------------------------------------

export const BASE_W = 640;
export const BASE_H = 480;

// Authentic 4:3 metrics.
export const HUD_H = 128;         // bottom party bar height
export const SIDE_W = 174;        // right panel width (automap + buttons)
export const VIEW_X = 8;
export const VIEW_Y = 8;
export const VIEW_W = 468 - 8;    // 3D window width in 4:3 mode
export const VIEW_H = 352;        // 3D window height

export const layout = {
  /** Logical frame size. Height is always 480; width grows in wide mode. */
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
  dpr: 1,
};

/**
 * Recompute the layout for a container size.
 * @param {number} cw container width in CSS px
 * @param {number} ch container height in CSS px
 * @param {boolean} allowWide widen the 3D window when the display is wider than 4:3
 */
export function computeLayout(cw, ch, allowWide = true) {
  const aspect = cw / ch;
  let logicalW = BASE_W;

  if (allowWide && aspect > BASE_W / BASE_H + 0.02) {
    // Grow the logical width so the frame fills the display, then round to an
    // even number of pixels to keep the tiling frame seams on integer columns.
    logicalW = Math.round((BASE_H * aspect) / 2) * 2;
    logicalW = Math.max(BASE_W, Math.min(1280, logicalW));
  }

  const scale = Math.min(cw / logicalW, ch / BASE_H);

  layout.w = logicalW;
  layout.h = BASE_H;
  layout.wide = logicalW > BASE_W;

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
  layout.view.w = logicalW - SIDE_W - VIEW_X - 4;
  layout.view.h = VIEW_H;

  layout.screen.w = Math.round(logicalW * scale);
  layout.screen.h = Math.round(BASE_H * scale);
  layout.screen.x = Math.round((cw - layout.screen.w) / 2);
  layout.screen.y = Math.round((ch - layout.screen.h) / 2);
  layout.screen.scale = scale;

  return layout;
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
