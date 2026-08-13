# Might and Magic VI — a Three.js reimplementation

A first-person party RPG built to look and play like *Might and Magic VI: The
Mandate of Heaven* (New World Computing, 1998), running in a browser and
playable on an iPhone.

**Every asset is generated at runtime from code.** No images, no models, no
fonts, no audio files ship with the game. Terrain and wall textures are painted
pixel by pixel, monsters are low-poly models baked into 8-direction sprite
sheets, portraits are rendered from an implicit height field, the interface
chrome is carved procedurally, the bitmap fonts are hand-authored glyph data,
and the music and sound effects are synthesised with Web Audio.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
```

On a phone, open the dev server's LAN address in Safari and add it to the home
screen. Drag anywhere in the world window to look, use the stick in the lower
left to move, tap to attack or interact, and tap the interface as normal.

Keyboard: `WASD` move (`A`/`D` strafe), arrows turn, mouse-drag looks,
`E`/`Space` interact, `F` or `Ctrl` attack, `C` character sheet,
`I` inventory, `B` spellbook, `Q` quests, `M` map, `Z` quick reference,
`R` rest, `Enter` turn-based mode, `1`–`4` select a character,
`Esc` options.

## How the look is reproduced

MM6 ran at 640×480 in 8-bit colour with the world drawn into a 461×345 window
inset at (8, 8). We keep those exact numbers. The scene renders into an offscreen
buffer at the window's native resolution and is upscaled with nearest filtering,
so the pixels are genuinely chunky rather than a filter applied after the fact.

The palette is 16 hand-tuned ramps of 16 shades. Every generated texture is
quantised to it on the CPU, and the finished frame is quantised again on the GPU
through a lookup cube. MM6's software renderer did **not** dither — it shaded by
swapping between 32 pre-darkened copies of the palette — so gradients band, and
we reproduce that by quantising all lighting to the same 32 steps and keeping
only enough dither to break up the lookup cube's own cells.

Other details that matter more than they sound like they should:

- Horizontal FOV is fixed at 75° outdoors and 60° indoors; the narrowing as you
  enter a dungeon is very noticeable.
- Day and night are a **greyscale** multiply applied identically to sky, terrain
  and sprites — never a blue night wash. Distance haze fades toward the same
  grey, which is what makes the horizon seamless.
- Sprites are Y-locked billboards, bottom-anchored, 8 rotation octants at 8 fps,
  with 1-bit alpha and no shadows.
- Terrain is faceted, not smoothed, on a 128×128 grid of 512-unit tiles with
  height quantised to 32 units.
- The party walks at 384 units/second under 1280 units/second² of gravity with a
  37-unit collision radius and a ±22.5° pitch clamp.

`ref/mm6-visual-spec.md` is the sourced reconstruction of the original engine's
constants that all of this is built from.

## Layout

```
src/core/     palette, seeded noise, renderer + post pass, layout, input, audio
src/art/      texture painting, sprite baking, creature/flora/prop models,
              bitmap fonts, interface chrome, portraits, spell effect sheets
src/world/    terrain, regions, towns, buildings, dungeons, sky
src/game/     stats, skills, spells, items, monsters, combat, party, quests,
              the session runtime and its map adapters
src/ents/     billboard batching, entities, visual effects
src/ui/       the permanent interface and every full-screen panel
tools/        screenshot and frame-sheet capture, the visual judge's brief
```

`ARCHITECTURE.md` describes the module contracts and the world-unit table.

## Tools

```sh
node tools/systems-test.mjs                    # rules and balance harness
node tools/shot.mjs <url> <out.png> [w] [h]    # screenshot any page
node tools/framesheet.mjs tools/scripts/tour.mjs shots/sheets/tour.png
./tools/capserver.sh                           # hot-reload-free capture server
```

The frame-sheet tool drives a scripted play session and tiles every frame into
one contact sheet, which is how the visuals get reviewed.
