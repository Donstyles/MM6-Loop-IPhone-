# MM6 Loop — architecture contract

A Might & Magic VI reimplementation in Three.js. Everything is procedurally
generated at runtime — no binary assets ship with the game. The visual target is
*indistinguishable from MM6 (1998)*: 8-bit palettised output with ordered
dithering, 64×64 nearest-filtered textures, billboard sprites baked from
low-poly 3D models, linear distance fog, and the exact 640×480 carved-stone UI.

## Non-negotiables

1. **No external assets.** No image files, no fonts, no models. Everything is
   drawn from code into canvases or baked from procedural geometry.
2. **Palette discipline.** Every texture, sprite and UI element goes through
   `src/core/palette.js`. The 3D view is palettised again in the post pass.
   Never emit a colour that did not come from `ramp()` / `rampSample()`.
3. **60 fps on an iPhone.** The 3D buffer is ~460×352. Budget: ≤ 400 draw
   calls, ≤ 120k triangles, zero per-frame allocations in the hot loop.
4. **Everything is seeded.** All generation takes an explicit seed so a world
   is reproducible. Use `src/core/rng.js`, never `Math.random()`.

## World units

MM6's unit is roughly 1 unit = 1 inch-ish; a map tile is **512 units**.

| quantity | value |
|---|---|
| outdoor tile size | 512 |
| outdoor map | 128 × 128 tiles (65 536 units square) |
| party eye height | 160 |
| party collision radius | 90 |
| walk speed | 500 units/s |
| run speed | 1000 units/s |
| gravity | 5000 units/s² |
| jump velocity | 1000 |
| step-up height | 120 |
| outdoor far fog | 6000 |
| dungeon far fog | 3000 |
| dungeon wall height | 512 |

Y is up. Headings: yaw 0 = looking down −Z.

## Module map — one owner per file, do not edit outside your set

```
src/core/         rng.js palette.js layout.js engine.js input.js audio.js   [shell]
src/art/          texcanvas.js                                             [shell]
src/art/          textures.js                                              [TEXTURES]
src/art/          spritebake.js  models/creatures.js  models/flora.js       [SPRITES]
src/art/          font.js  uiart.js                                        [UI-ART]
src/world/        terrain.js region.js town.js dungeon.js sky.js           [WORLD]
src/game/         stats.js skills.js spells.js items.js monsters.js
                  combat.js party.js quests.js                             [SYSTEMS]
src/ents/         *                                                        [shell]
src/ui/           *                                                        [shell]
src/main.js                                                                [shell]
```

## Shared APIs you may rely on

### `src/core/rng.js`
`Rand` class (`float int bool pick weighted shuffle dice gauss`), `mulberry32`,
`hashStr`, `hash2`, `valueNoise2`, `gradNoise2`, `fbm2`, `ridged2`,
`tileNoise2`, `tileFbm2`, `tileWorley2`, `clamp`, `smoothstep`, `lerpN`.

### `src/core/palette.js`
`PALETTE` (256 × [r,g,b]), `RAMP_INDEX`, `ramp(name, shade)`,
`rampCss(name, shade, alpha)`, `rampHex(name, shade)`, `nearestIndex`, `snap`,
`ditherImageData`, `quantizeImageData`.

Ramp names (16 shades each unless noted):
`grey stone plaster dirt wood sand grass foliage swamp sky water ice blood fire
gold` plus `flesh` and `arcane` (8 shades each).

### `src/art/texcanvas.js`
`Pix` (per-pixel RGBA buffer: `set setArr get fill shade idx toImageData
toCanvas`), `makeCanvas`, `ctx2d`, `rampSample(name, t01, steps)`, `mixC`,
`scaleC`, `toTexture(pixOrCanvas, opts)`, `grainFill`, `speckle`, `bricks`,
`planks`, `emboss`, `blotch`, `cracks`, `gradientShade`, `packAtlas`.

`toTexture` opts: `{ dither=10, quantise=true, repeat=true, mips=true,
anisotropy=4, magNearest=true }`.

### `src/core/layout.js`
`BASE_W=640 BASE_H=480 HUD_H=128 SIDE_W=174`, `layout` (live object with
`w h view side hud screen wide`), `computeLayout(cw,ch,allowWide)`,
`toLogical(cx,cy)`, `inView(x,y)`.

## Conventions

- ES modules, plain JS (no TypeScript), 2-space indent, single quotes.
- Export named functions; no default exports except where noted.
- Any expensive generation must be callable from a loading-screen generator that
  yields between items: write generators (`function*`) or accept an `onProgress`
  callback so the loading bar can move.
- Cache generated textures/atlases in a module-level `Map` keyed by their args.
- Comment *why*, not *what*. Match the surrounding style.
