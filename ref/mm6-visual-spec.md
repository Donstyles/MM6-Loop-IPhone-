# Might and Magic VI: The Mandate of Heaven (1998) — Technical Art Specification

Target: exact visual reproduction in Three.js.

**Provenance of the numbers below.** Almost every hard number is taken from decompiled/reimplemented
engine source rather than from memory:

- **OE** = `github.com/OpenEnroth/OpenEnroth` (open reimplementation of the MM6/7/8 engine, cloned and
  read directly). File paths given inline. Comments in that codebase mark which constants are
  "vanilla".
- **MMExt** = `github.com/GrayFace/MMExtension` — `Scripts/Structs/01 common structs.lua`, which is a
  field-by-field map of the original MM6/MM7/MM8 in-memory structures with per-version offsets
  (`mmv(mm6, mm7, mm8)`), so MM6-specific layout is directly readable.
- **MM6 game data** = the shipped MM6 `MONSTERS.TXT`, `MapStats.txt`, `Spells.txt`, etc. from
  `github.com/might-and-magic/mm678-i18n` (`0_source/en/mm6/data/10LocLANG.icons/`). These are the
  actual retail data tables.
- **GrayFace MM6 Patch readme** (via search snippets; the site itself was unreachable from this
  sandbox) for vanilla D3D view distance.

Anything not directly sourced is marked **(est)**. Where MM6 and MM7 differ I say so; where OE only
verifies MM7 behaviour and I am extrapolating to MM6 I flag it.

---

## A. Display & rendering

### 1. Resolution and 3D viewport rectangle

- Framebuffer: **640 × 480**, fixed. Vanilla MM6 has no other resolution; the "windowed mode" and
  resolution mods stretch a 640×480 backbuffer.
- The 3D viewport is inset into a fixed chrome frame. From OE `src/Engine/Graphics/Renderer/BaseRenderer.cpp`
  (`updateRenderDimensions`), with the comments literally reading `// 8 in vanilla`, `// 468 in vanilla`,
  `// 352 in vanilla`, and defaults in `src/Application/GameConfig.h` (`viewport_x1=8, viewport_y1=8,
  viewport_x2=172, viewport_y2=128`):

```
inclusive pixel bounds:  x = 8 .. 468 ,  y = 8 .. 352
Recti pViewport = (x=8, y=8, w=461, h=345)
```

- **3D viewport = x 8, y 8, w 461, h 345.** Aspect 461/345 = **1.33623**.
- Viewport center used by the projection: `(238, 180)` (integer `x + w/2`, `y + h/2`).
- The chrome around it (OE `GameUI_DrawRightPanelFrames`):

| element | image | draw pos | covers |
|---|---|---|---|
| top frame | `ib-t-*.pcx` | (0, 0) | 640 × 8 |
| left frame | `ib-l-*.pcx` | (0, 8) | 8 × 344 |
| right panel | `ib-r-*.pcx` | (468, 0) | 172 × 480 |
| bottom panel | `ib-b-*.pcx` | (0, 352) | 640 × 128 |

  So: **bottom HUD bar = 128 px tall (y 352…479), right panel = 172 px wide (x 468…639).**
  MM6, MM7 and MM8 share this exact geometry — the same engine constants drive all three, only the
  skin bitmaps differ.

- The clickable 3D-view button is `(7, 8) size (460, 343)` (OE `UI_Create`), i.e. one pixel of slop
  vs. the render rect.

### 2. Colour depth and palettes

- **8-bit indexed everywhere.** Every texture, sprite and icon in `BITMAPS.LOD` / `SPRITES.LOD` /
  `ICONS.LOD` is a 256-colour indexed image.
- **Palettes are per-asset, selected from a global bank of up to 1000 palettes** named `pal000` …
  `pal999` stored inside `BITMAPS.LOD`. OE `PaletteManager::load` reserves exactly 1000 slots; slot 0
  is a pure grayscale ramp `Color(i,i,i)`.
  - A `LodImage` (texture) carries its own 256-entry palette inline.
  - A `LodSprite` carries `paletteId` (index of a `palXXX`), but the *actual* palette used at runtime
    comes from the sprite frame table entry (`SFTItem.PaletteId`), not the sprite. This is how MM6
    recolours monster tiers: **the A/B/C variants of a monster family are frequently the same sprite
    art with a different `palXXX`.** (OE `src/Library/LodFormats/LodSprite.h` comment: the sprite's
    own default palette is usually a cyan/magenta key palette for the recolourable regions.)
  - Practical modding constraint reported by the MM6 community: **a single map may reference at most
    ~50 distinct palettes** across all its terrain, models, sprites and monsters.
- MM6 loads at most **500 bitmaps** resident at once (`BitmapsLod.Bitmaps` array length is
  `mmv(500, 1000, 1000)` in MMExt — MM6 = 500, MM7/8 = 1000).
- Texture dimensions are stored together with `WidthLn2` / `HeightLn2` (log2) and `WidthMinus1` /
  `HeightMinus1` masks → **all bitmaps are power-of-two in both axes**, and the software rasteriser
  wraps with an AND mask.
- Mipmaps: `LodImageHeader_MM6.flags & 0x0002` = has mipmaps; the chain runs down to 16×16.
- **Dithering:** none in the classic sense. The software renderer does *not* dither; shading is done
  by swapping to one of 32 pre-computed darkened copies of the palette. Gradients therefore band
  visibly (32 discrete brightness steps — see §9). The D3D path multiplies vertex colour instead, so
  it is smooth. For a Three.js reproduction of the *software* look, quantise lighting to 32 steps.
- Colour-key transparency: index 0 in sprites, and a magenta/black key for UI ("ColorKey") images.
  OE keys UI art on `Color(0,0,0)` / teal `#00FCF8` depending on asset class.

### 3. Field of view

From OE `src/Engine/Graphics/Camera.h` / `Camera.cpp` (`CreateViewMatrixAndProjectionScale`):

```
odm_fov_deg = 75   // OUTDOOR, horizontal
blv_fov_deg = 60   // INDOOR (dungeon), horizontal
ViewPlaneDistPixels = viewport.w * 0.5 / tan(hFOV/2)
fov_y = 2 * atan( (viewport.h/2) / ViewPlaneDistPixels )
```

With w=461, h=345:

| | horizontal FOV | focal length (px) | vertical FOV |
|---|---|---|---|
| **Outdoor (ODM)** | **75.00°** | **300.39** | **59.73°** |
| **Indoor (BLV)** | **60.00°** | **399.24** | **46.74°** |

In Three.js: `PerspectiveCamera(59.73, 461/345, 32, 8192)` outdoors,
`PerspectiveCamera(46.74, 461/345, 32, 8192)` indoors. The FOV **changes on level type**, which is
very noticeable when entering a dungeon.

Near/far clip (OE `GetNearClip`/`GetFarClip`, `GameConfig.h`):
- near = **32** world units.
- far = OE default 16192; **vanilla MM6 hardware (Direct3D) far clip = 8192** (GrayFace's patch
  documents 8192 as "the game's default" and raises it to 12000). Software mode clipped earlier and
  was extended slightly via the `dist_mist` ini variable.
- Special case: Wromthrax's Cave forces far = 25000 so the back wall is visible.

Vertical look is clamped: `_viewPitch` ∈ [−128, +128] in a 2048-unit turn circle, i.e.
**±22.5°** of pitch. Yaw is a 0…2047 integer (2048 = 360°).

### 4. Fog

Two completely different fog systems run in the outdoor renderer.

**(a) "Weather fog" (foggy day flag).** Per-map probability table (OE `Outdoor.cpp`
`fog_probability_table`, `SetFog`), matching MMExt `RandomFog`:

| fog class | `fogWeakDistance` | `fogStrongDistance` |
|---|---|---|
| light | 4096 | 8192 |
| medium | 0 | 4096 |
| dense | 0 | 2048 |
| underwater | 50 | 2000 |

Fog colour, `GetLevelFogColor()` (OE `Outdoor.cpp`):

- foggy + **night** → `#1F1F1F` (`colorTable.DarkGray`)
- foggy + **day/twilight** → neutral grey `v = (1 − fogDensity)*200 + fogDensity*31`, i.e.
  **`#C8C8C8` at full daylight**, ramping to **`#1F1F1F`** across dusk/dawn.
- **underwater** → `Color(33,142,90)` = **`#218E5A`** (sea green). Underwater everything is also
  multiplied by `Topaz Color(16,194,153)` = **`#10C299`**.
- not foggy → no explicit colour; distance haze uses the sky tint (below).

Fog opacity ramp used by the hardware path (OE `SetFogParametersGL` + `resources/shaders/fog.glsl`):
`weakDensity = 0.25`, `strongDensity = 0.85`, then smoothstep from `strongDistance` to `clipDistance`
up to 1.0, with alpha fading to 0 at the clip plane (so the world dissolves rather than pops).
The legacy per-vertex path (`sub_47C3D7_get_fog_specular`) is a pure **linear** lerp of the
"specular" byte from **0 → 216** between `fogWeakDistance` and `fogStrongDistance`, i.e. fog never
exceeds **216/255 = 84.7 %** opacity on geometry, and is pinned at **248/255 = 97.3 %** on the sky.

**(b) Time-of-day distance darkening (always on outdoors).** This is what actually produces MM6's
"the horizon goes grey" look on a clear day. `GetActorTintColor(31, 0, dist, …)` in
`LightmapBuilder.cpp` combined with `UpdateSunlightVectors`:

```
minutes = 60*(hour-5) + minute        // 0 at 05:00, 960 at 21:00
v = (minutes >= 480) ? 960-minutes : minutes
max_terrain_dimming_level = 20 - v/480*20      // 20 at dawn/dusk, 0 at 13:00
dim = min(216, 8 * max_terrain_dimming_level)
tint = rgb(255-dim, 255-dim, 255-dim)
night: dim = 216  →  tint = #272727
```

| time | horizon / sky tint |
|---|---|
| 13:00 (noon peak) | `#FFFFFF` (no haze) |
| ~09:00 / ~17:00 | ≈ `#9F9F9F` |
| 05:00 / 21:00 | `#5F5F5F` |
| night (21:00–05:00) | `#272727` |

Fog density by hour (`GetFogDensityByTime`): 0.0 for 06:00–19:59; ramps 1→0 over 05:00–06:00; ramps
0→1 over 20:00–21:00; 1.0 at night. `pWeather->bNight` is true for hour < 5 or hour ≥ 21.

**Draw distance:** effectively **8192 world units = 16 map tiles** in vanilla hardware mode.
Outdoor shading distances: `shading_dist_shade = 2048`, `shading_dist_shademist = 4096`
(OE `Engine.cpp`). Mouse-over/right-click identification range outdoors is 12800 (= 25 tiles).

### 5. World unit scale

| quantity | value | source |
|---|---|---|
| **1 outdoor terrain tile** | **512 × 512 units** | `gridToWorld`: `(gx-64) << 9` |
| terrain height quantum | **32 units** (heightmap byte × 32) | `vertexByGridUnsafe`, MMExt `HeightMap` |
| max terrain height | 255 × 32 = 8160 units | party Z is hard-clamped to 8160 |
| outdoor map extent | 128 × 128 tiles = **65536 × 65536 units**, origin at map centre, range −32768…+32768 | `OutdoorLocation::pOMAP[128*128]` |
| playable extent before map transition | ±22528 units (`maxPartyAxisDistance`) = 44 tiles each way | `mm7_data.h` |
| **party collision height** | **192 units** | `gameplay.party_height = 192` |
| **party eye height (camera)** | **160 units** | `gameplay.party_eye_level = 160` |
| **party collision radius** | **37 units** | `Party.cpp` `radius = 37` |
| **walk speed** | **384 units / real second** | `gameplay.party_walk_speed = 384` (comment: "units per real time second") |
| **run speed** | **768 u/s** (2× walk) | `PARTY_RunForward` doubles it |
| strafe speed | 288 u/s (¾ walk) | `3*dx/4` |
| backward speed | 384 u/s | |
| fly speed (run) | 1536 u/s (4× walk) | |
| **jump initial velocity** | **480 u/s** (`jump_strength 5 × 96`) | `PARTY_Jump` |
| **gravity** | **1280 u/s²** (`2 × gravity(5) × 128 ticks/s`) | `partyInputSpeed.z += -2*dt.ticks()*5` |
| ⇒ jump apex | **90 units** (~0.375 s up, 0.75 s airborne) | derived |
| indoor gravity | identical (`-2 × dt × 5`) | `Indoor.cpp:1653` |
| actor (monster) gravity | 8× indoors, 16× on outdoor slopes | `Indoor.cpp:877`, `Outdoor.cpp:1675` |
| flying bob | ±4 units, `4*cos(realtime_ms)` | |
| max fly height | 4000 units | `gameplay.max_flight_height` |
| interaction / pickup range | 512 units | `KeyboardInteractionDepth`, `MouseInteractionDepth` |
| ranged attack range | 5120 units (10 tiles) | `RangedAttackDepth` |
| **engine tick** | **128 ticks = 1 real second**; game time runs **30×** real time | `Duration.h` |

Angles: **2048 units = 360°** (`TrigLUT.uIntegerPi = 1024`). Pitch clamp ±128 (±22.5°).

Coordinate system (OE `Camera3D::CreateViewMatrixAndProjectionScale`): **right-handed, world +X =
east, +Y = north, +Z = up.** Grid coordinates are `gx = (worldX >> 9) + 64`, `gy = 63 - (worldY >> 9)`,
with grid origin at the NW corner.

Monster movement speeds (MM6 `MONSTERS.TXT` column 14 "Spd"): Archer 140, Goblin 100-ish, Devil
Master 300, Blue Dragon 260 — i.e. **most monsters move at 25–75 % of party walk speed**, so you can
always outrun them.

### 6. Outdoor map (ODM) format and terrain

MM6 ODM header (MMExt `structs.OdmHeader`, and the version string is version-checked):

```
char[32]  Name
char[32]  FileName
char[31]  VersionStr   // must be exactly "MM6 Outdoor v1.11" for MM6
char[32]  SkyBitmap
char[32]  GroundBitmap  (unused)
TilesetDef[4] Tilesets  // [0..2] terrain tilesets, [3] = road tileset
```

Body (MMExt `Map`, OE `OutdoorLocation_MM7` — the MM6 body layout is identical apart from the header):

```
uint8   HeightMap[128][128]   // [y][x]; world Z = value * 32
uint8   TileMap  [128][128]   // [y][x]; index into the global tile table
uint8   AttributeMap[128][128]
uint32  normalCount; Vec3f normals[]; uint16 normalMap[128][128][2]   // 2 normals per cell (2 tris)
BSPModelData[]  models        // static "buildings" = real polygon meshes with their own BSP
LevelDecoration[] decorations // billboard props
uint32  decorationMap/OMAP[128][128]  // per-cell offsets into the sprite-id list
SpawnPoint[]  spawnPoints
```

- **Terrain grid: 128 × 128 cells, 127 × 127 quads, 2 triangles per quad.** Each quad has one tile
  texture; UVs are per-tile 0..1 (textures tile 1:1 per cell).
- **Height is per-vertex** (the 128×128 heightmap is sampled at cell corners), so terrain is a
  quantised, faceted heightfield with 32-unit vertical steps. There is no smoothing — MM6 terrain
  visibly stair-steps.
- Slope limit: `isSlopeTooHighByPos` blocks walking / makes you slide.
- Discovered-area (fog of war on the automap) is stored as **88 × 88 bits**, i.e. only the central
  88×88 cells of the 128×128 grid are ever visible/reachable — consistent with the ±22528 limit.
- **Tilesets** (OE `Engine/Data/TileEnums.h`, `Tileset`):
  `GRASS, SNOW, DESERT, DIRT (only 3 tiles), WATER (+ shoreline), BADLANDS, SWAMP, COBBLE_ROAD`.
  A map declares 3 terrain tilesets + 1 road tileset; the tile index resolves through a global table
  that also provides ~46 transition variants (N/S/E/W, corners, combinations) and 24 road variants
  (straight, 90° turns, T, Y, diagonal, dead ends, 4-way).
- **Tile flags** (`TileFlag`): `BURN 0x1, WATER 0x2, BLOCK 0x4, REPULSE 0x8, FLAT 0x10, WAVY 0x20,
  DONT_DRAW 0x40, SHORE 0x100, TRANSITION 0x200, SCROLL_DOWN/UP/LEFT/RIGHT 0x400/0x800/0x1000/0x2000`.
- **Seasons (a MM6-only feature, OE `Seasons.cpp`)** — the terrain tileset is swapped per month:
  - months 11,0,1 (winter): `GRASS → SNOW`
  - months 2,3,4 and 8,9,10 (spring/autumn): `GRASS → DIRT`
  - months 5,6,7 (summer): unchanged
  Tree/flower decoration sprites are swapped in parallel (see §19).
- Buildings are `BSPModel`s: real textured polygon meshes with per-face texture names, their own
  bounding boxes, and up to 64 faces addressable per model (`pid.id() >> 6` / `& 0x3F`).

### 7. Sky

**Not a skybox and not a dome.** MM6 draws the sky as a **single screen-space quad with a
perspective-projected "infinite plane" texture mapping** — a fake ceiling plane at infinite distance,
scrolling with camera yaw/pitch. OE `OpenGLRenderer::DrawOutdoorSky()` reproduces the original math
exactly:

1. Compute the horizon line:
   `bot_y_proj = viewportCenterY − ViewPlaneDistPixels / (cos(pitch)*farClip) * (sin(pitch)*farClip − cameraZ)`
2. Emit a quad covering `x = 8 … 468`, `y = 8 … bot_y_proj+1`. **Sky occupies from the top of the
   viewport down to the projected horizon** and nothing below.
3. Per corner, back-project screen offsets through the (pitch-rotated) sky plane normal
   `v18 = (−sin(−pitch+16°ish), 0, −cos(pitch+16))` in 2048-unit angle space, compute
   `worldviewdepth = −64 / top_y_proj`, and set
   `u = (t_ms + skyLeft*depth) / texWidth`, `v = (t_ms + skyFront*depth) / texHeight`,
   with `_rhw = worldviewdepth` so the rasteriser does perspective-correct interpolation.
   **The `t_ms` term means the cloud texture also scrolls on its own at 1 texel per millisecond**
   (i.e. the sky drifts even when you stand still).
4. Cloud height drops as you climb: `horizon_height_offset = ViewPlaneDist*cameraZ/(ViewPlaneDist+farClip) + centerY`.
5. Below the horizon, when fog is on, two extra screen quads are drawn: a **fade band** of height
   `FogHorizon = 39 px` above the horizon (alpha 0 at top → 1 at the horizon) and a **solid "sub sky"
   fill** from the horizon down to the bottom of the viewport, both in the fog/haze colour. This is
   the grey band you see under the horizon before terrain covers it.

**Visual result:** a flat, low-contrast, heavily-tiled cloud texture receding to a hard, dead-straight
horizon line with a soft grey haze band on it. Because it is a plane and not a dome, the clouds
*converge and compress* toward the horizon and *stretch* overhead — cloud "streaks" radiating from the
zenith. Looking straight up gives huge blurry cloud blobs; looking at the horizon gives a fine
striated band.

- Sky texture is named per map in the ODM header; OE's fallback is **`plansky3`**. Others in the
  series are `plansky1/2/…`. Sky bitmaps are square power-of-two, **256 × 256 (est)**.
- Sky dimming: `dimming_level = 31` outdoors → the sky is tinted by the same time-of-day curve as
  §4b: white at noon, `#5F5F5F` at dawn/dusk, `#272727` at night.
- **There is no sun/moon disc, no stars, no gradient**: the "night sky" is simply the day cloud
  texture multiplied down to `#272727`. Colour comes entirely from the texture + tint.
- Indoor "sky" faces (`FACE_INDOOR_SKY`) use the same projection with a per-face texture — this is how
  outdoor-looking courtyards inside BLV maps are done.

### 8. Water and lava animation

**Water (outdoor terrain + BLV/model faces).** From OE `OpenGLRenderer::waterAnimationFrame()`, which
documents the vanilla frame table:

```
Frame     0      1      2      3      4      5      6      Total
Vanilla  1/12s  1/6s   1/6s   1/6s   1/6s   1/6s   1/12s   1.000 s
```

- **7 frames, 1-second loop.** The frames are true separate 8-bit bitmaps (an animation group in the
  Texture Frame Table, `TFT`). Original tile name: **`wtrtyl`**; OE's HD replacement set is
  `HDWTR000`…`HDWTR006`.
- The TFT stores per-frame `Time` in **1/16-second units** (multiply by 8 to get engine ticks).
- The animation is a slow, rolling ripple; the palette is mostly desaturated blue-green.
- Any tile/face flagged `TILE_WATER` / `FACE_IsFluid` is replaced by the current water frame, so a
  single global animation phase drives *all* water on screen.
- Shore tiles (`TILE_SHORE`) are separate, non-animated tiles drawn over the water edge.

**Lava and flowing surfaces.** Lava faces carry `FACE_IsLava`; they use **UV distortion** rather than
frame swapping. OE's `glbspshader.frag` reproduces the vanilla motion as three superimposed terms
(periods taken from the original):

- in/out "pong": period **8000 ms**, amplitude 1 % of texture size
- swirl: period **5000 ms**, amplitude 1 %
- fine ripple: period **2000 ms**, amplitude 0.5 %, ~24 cycles across the face

**Scrolling faces** (`FACE_FlowUp/Down/Left/Right`, and `TILE_SCROLL_*`) translate UVs linearly at
`flowtimer = ms >> 4` texels, i.e. **62.5 texels per second** — one full 128-px texture loop every
2.05 s. Used for waterfalls, conveyor-like lava rivers, and magic portals.

### 9. Lighting model

**Indoors (BLV):**
- Purely **per-vertex / per-billboard**, quantised to a **0…31 "dimming level"**, converted to a grey
  multiplier as `8 × (31 − dim)` → **32 discrete grey levels: 0, 8, 16, … 248** (i.e. `#000000` …
  `#F8F8F8`). Nothing indoors is ever pure white.
- Each BLV sector has a `minAmbientLightLevel`. Unlit sectors go to dim=31 → **pitch black**; typical
  dungeon corridors sit around dim 20–28 → **`#383838`–`#585858`**. MM6 dungeons are *very* dark
  without a light source, which is why Torch Light is the level-1 Fire spell.
- Light sources add: for each light within radius,
  `lightlevel += 30 * dist / radius − 30` (so −30 at the centre, 0 at the edge, linear), then clamped
  to 0…31. Three light stacks: **sector lights** (`BLVLight`, static, baked into the map),
  **stationary lights** (added at load), **mobile lights** (party torch, glowing sprites, projectiles).
- **Party torchlight**: radius = **800 units per power level** (`graphics.torchlight_distance = 800`).
  Flicker is off by default in OE; vanilla MM6 had a subtle flicker.
- **Colored lights**: MM6 lights are **monochrome**. The RGB fields (`uColoredLightRed/Green/Blue`)
  were only added in MM7 (`DecorationDesc_MM7` = `DecorationDesc_MM6` + 4 bytes RGB). So: **no
  coloured lighting in MM6** — everything is a grey multiply. OE's default fallback light colour is
  `Color(185,185,185)` = `#B9B9B9`.
- Glowing sprites: `SpriteFrame.glowRadius` (`SFTItem.LightRadius`) adds a white mobile light at the
  sprite's position — fireballs, torches, lava decorations light the room as they move.

**Outdoors (ODM):**
- A single directional **"sun"**: `UpdateSunlightVectors()` sweeps it across the sky between 05:00 and
  21:00 only:
  ```
  minutes = 60*(hour-5) + minute          // 0..960
  sun = ( cos(minutes*π/960), 0, sin(minutes*π/960) )
  ```
  i.e. the sun rises due **east (+X)**, passes through the **zenith at 13:00**, sets due **west (−X)**,
  and has **no north/south component at all** (`y = 0`) — the sun is always on the E–W great circle.
  Below/above that window `vSunlight` is simply not updated.
- Terrain and buildings are shaded by N·L against that vector plus the time-of-day ambient. OE's
  reconstruction of the ambient curve (`OpenGLRenderer.cpp:1204`):
  ```
  t = hour*60 + minute                       // 0..1439
  ambient = 0.15 + (sin((t-360)*2π/1440) + 1) * 0.27      // 0.15 .. 0.69
  diffuse = night ? 0 : (ambient + 0.3)
  specular = 0
  sunlight contribution clamped to [0, 0.85]
  ```
  So: ambient floor **0.15** at 06:00, peak **0.69** at 18:00-ish in that formula, diffuse cut to 0 at
  night. Terrain is never fully black outdoors because of the ambient floor.
- Distance darkening (§4b) is folded into the same tint value, so **lighting and distance haze are the
  same grey multiply** in MM6 — objects don't fog toward a fog colour, they fade toward *grey/black*.

**Sprites/billboards:** see §17.

---

## B. Textures

### 10. Texture dimensions in BITMAPS.LOD

Format constraint (MMExt `LodBitmap`: `Width, Height, WidthLn2, HeightLn2, WidthMinus1, HeightMinus1`):
**both dimensions must be exact powers of two.** Mipmaps run down to 16×16.

Sizes actually used (the last two are **est** for exact frequency, but the set is right):

| size | used for |
|---|---|
| **64 × 64** | outdoor terrain tiles (all of them), small trim/detail textures |
| **128 × 128** | the workhorse: most building walls, dungeon walls, floors, ceilings, roofs |
| **64 × 128** / **128 × 64** | door leaves, pillars, banded/striped wall sections, trims |
| **256 × 256** | sky (`planskyN`), a few hero surfaces (castle gates, murals) |
| **32 × 32**, **16 × 16** | tiny detail, small doors, mip tails |
| **256 × 128** / **128 × 256** | rare, large banners / long wall runs |

The engine buckets textures by size when building atlases (OE keeps 8 terrain size-buckets and 16
building size-buckets), which is direct evidence that mixed sizes are the norm outside terrain.
Terrain, however, is uniform: OE assumes all terrain tiles in a map share a width per atlas layer, and
tile 0 is reserved for the 7 water frames.

### 11. Terrain texture character

MM6 terrain art is **low-contrast, high-frequency, hand-painted noise** at 64×64, designed to tile
seamlessly in all four directions with no obvious hero feature (no big rocks or single flowers baked
in — those are separate billboard decorations). Value range is deliberately narrow (roughly 25 % of
the 0–255 range) so the runtime grey-multiply lighting can darken them 32 steps without crushing.
Colour ranges below are **(est)** read off the art; the noise character descriptions are firm.

| tileset | palette range | character |
|---|---|---|
| **Grass** (`grastyl*`) | `#3E5A28` – `#6E8C3C`, occasional `#87A050` highlights | dense fine speckle, ~3–5 px blade clusters, slight yellow-green mottling at ~16 px scale. Reads almost flat from eye height. |
| **Dirt** (spring/autumn grass replacement) | `#5A4A32` – `#8A7050`, flecks to `#9C8460` | coarser than grass, 4–8 px clods, subtle darker patches |
| **Cobble road** | `#6E6A62` – `#A09A8E`, mortar lines `#4A463E` | irregular rounded cobbles ~8–10 px across with dark mortar; drawn as a *transition* tileset laid over dirt, with 24 orientation variants |
| **Sand / Desert** | `#B49A6A` – `#D8C08C` | very low contrast, fine wind-ripple stipple, occasional `#8E7A52` shadow streaks |
| **Snow** | `#C8CEDA` – `#F0F4FA`, shadow `#9AA6BA` | near-white with faint blue-grey drift shading; the highest-value tileset in the game, and the only one that visibly clips at noon |
| **Water** (`wtrtyl`) | `#1E3A50` – `#3C6E8C`, crest `#5A96B4` | 7-frame animation, soft horizontal ripple bands; darker and greener than you remember, not blue |
| **Swamp** | `#3A4428` – `#5C6238`, sickly highlights `#76804A` | murky olive, blotchy 12–20 px patches, scummy; wettest-looking non-water tileset |
| **Badlands** (Deyja/Dragonsand type) | `#6A4A38` – `#9A7A5E`, dark cracks `#3E2A20` | cracked baked earth, visible 10–15 px crack network |

Transition tiles: 46 variants per pair (edges, corners, and 2/3/4-way combinations) plus
auto-generated ones for pairs the artists never drew. Roads are implemented *as* transition tiles,
which is why MM6 roads always look painted onto the terrain rather than sunk into it.

### 12. Building / exterior wall textures

Building exteriors are polygon meshes (`BSPModel`) with per-face textures, mostly 128×128:

| family | palette | character |
|---|---|---|
| **Red brick** | `#6E3A2E` – `#A05A44`, mortar `#B0A896` | regular running bond, ~8 px course height at 128 px, per-brick value jitter of ±15 |
| **Grey stone block** | `#5E5E58` – `#9A9A90`, joints `#3C3C38` | large irregular ashlar, 20–40 px blocks, heavy chiselled bevel shading |
| **Castle stone** | `#6A6A60` – `#A8A89C` | as above but larger blocks, occasional arrow slit / moulding baked in; often 128×256 for tower runs |
| **Wood plank** | `#5A4028` – `#8C6844`, knots `#3C2818` | vertical or horizontal planks 10–14 px wide, dark seams, visible grain streaks |
| **Plaster / stucco (half-timber)** | `#C0B49A` – `#E0D8C0` with timber `#4A3420` | the New Sorpigal / Free Haven town look: cream panel + dark crossed beams baked into one texture |
| **Roof tile** | `#8A3A2A` – `#B05840` (red), or `#4A5A62` – `#76888E` (slate) | overlapping scalloped or rectangular tiles, ~6 px rows, strong per-row shading |
| **Thatch** | `#8A7038` – `#B89A56` | vertical straw streaks, very high-frequency |
| **Marble / temple** | `#D0CCC0` – `#F0EEE6`, veining `#A8A498` | rare, used for Temples of Baa / the Oracle |

Detail level is **low**: no normal detail, no baked AO beyond the artist's own shading, and shapes are
blocky (buildings are typically 6–40 faces). Windows and doors are usually painted into the wall
texture, not modelled.

### 13. Dungeon (BLV) textures

| family | palette | character |
|---|---|---|
| **Cave rock** | `#4A4238` – `#7A6E5E`, deep crevice `#282018` | lumpy organic bulges, big soft value blobs at 30–60 px, no straight lines. Snergle's Caverns, Dragon Riders' caves. |
| **Dungeon brick / masonry** | `#4E4E48` – `#82827A`, joint `#2E2E2A` | regular block courses, mildew streaks, chipped corners; the default for man-made dungeons (Goblinwatch, Silver Helm) |
| **Metal / plate** | `#4A4E54` – `#8A929C`, rivets `#2A2E34` | riveted panels, banded plates, occasional grating; the Control Center / Hive / Sci-Fi maps |
| **Sewer** | `#3A423A` – `#66705E`, slime `#4A5C3A` | wet green-grey brick with running discolouration; often paired with flowing-water faces |
| **Tomb / crypt** | `#585048` – `#908878` | large sandstone slabs, engraved bands, sarcophagus lids |
| **Lava rock** | `#2A1E18` – `#5A3A28` + emissive lava faces `#C83208` – `#FF8C10` | Gharik's Forge / Hall of the Fire Lord; lava faces are UV-distorted, self-lit and drive mobile lights |
| **Ice** | `#8AA8C0` – `#D0E4F0` | translucent-looking (fake) blue-white, used in Icewind Keep |

BLV floors/ceilings use the same texture pool; there is no separate floor set. Faces carry attributes
(`FACE_IsFluid`, `FACE_IsLava`, `FACE_Flow*`, `FACE_INDOOR_SKY`, clickable/event flags) that change
rendering, not the texture.

---

## C. Sprites — the critical part

### 14. Rotations, animations, frame rate

**Rotations: exactly 8 octants** (45° each). `SpriteFrame::sprites[8]` in OE; `SFTItem.SpriteIndex[8]`
in MMExt. Octant selection (OE `Outdoor.cpp::PrepareActorsDrawList`):

```
angleToCam = atan2(actor.x - cam.x, actor.y - cam.y)          // 0..2047
octant = ((1024 + 128 + actor.yawAngle - angleToCam) >> 8) & 7
```

(1024 = 180°, 128 = 22.5° half-octant bias, `>>8` = /45°.)

Mirroring: flags `SPRITE_FRAME_MIRROR_0..7` (`0x100 << n`) mark octants that reuse another octant's
bitmap **horizontally flipped** — so on disk a monster typically ships **5 distinct views (0,1,2,3,4)**
and octants 5,6,7 are mirrors of 3,2,1. Suffix convention: base name + `0`..`7`.
`SPRITE_FRAME_IMAGE1 (0x10)` = one bitmap used for all 8 octants (used for spell effects, most
decorations, items on the ground). `SPRITE_FRAME_IMAGES3 (0x10000)` (views 0/2/4 only) is **MM7+ only** —
MM6 does not have it.

**Animations: exactly 8 groups per monster.** `MonsterDesc_MM6.spriteNames[8][10]` — 8 sprite-group
names of ≤10 chars, indexed by `ActorAnimation`:

| idx | enum | meaning | typical name suffix |
|---|---|---|---|
| 0 | `ANIM_Standing` | idle / stand | `…stA` |
| 1 | `ANIM_Walking` | walk cycle | `…wkA` |
| 2 | `ANIM_AtkMelee` | melee attack | `…atA` |
| 3 | `ANIM_AtkRanged` | ranged / cast | `…shA` |
| 4 | `ANIM_GotHit` | flinch on damage | `…gtA` |
| 5 | `ANIM_Dying` | death animation | `…dnA` |
| 6 | `ANIM_Dead` | corpse (static) | `…ddA` |
| 7 | `ANIM_Bored` | fidget / idle variation | `…fdA` |

(There are 2 further unused name slots, `spriteNamesUnused[2][10]`.)

**Frame counts per group (est, from the group structure):** stand 1–2, walk **4–8**, melee attack
**3–5**, ranged/cast **3–5**, got-hit **1–2**, dying **4–8**, dead **1**, fidget **4–8**. Groups are
variable-length linked runs: `SPRITE_FRAME_FIRST (0x4)` marks the first frame,
`SPRITE_FRAME_HAS_MORE (0x1)` means "another frame follows".

**Frame rate.** `SFTItem.Time` is stored in **1/32 second units** (MMExt comment; OE multiplies by 8 to
convert to 128-tick engine time). So the frame-rate grid is a multiple of **31.25 ms**:

| `Time` | duration | effective fps |
|---|---|---|
| 2 | 62.5 ms | 16 |
| **4** | **125 ms** | **8** |
| 8 | 250 ms | 4 |

**Typical MM6 monster animation is `Time = 4` → 8 fps** (est on the exact value, firm on the units).
This is why MM6 monsters look stop-motion-ish. `TotalTime` (= `animationLength`) is the loop length;
`GetFrame(id, t)` does `t % animationLength` and walks the run.

Extra timing quirks (OE `PrepareActorsDrawList`):
- Walking actors are **phase-offset per actor**: `time = actorIndex*32 ticks + globalTime`, so a pack
  of goblins never marches in lockstep.
- Decorations are phase-offset by position: `time = globalTime + |x + y|` ticks — every tree in a
  forest sways out of phase.
- `ACTOR_BUFF_STONED` / `PARALYZED` freeze `time = 0` (the sprite locks to frame 0).
- `Resurrected` actors play their **death animation in reverse** (`GetFrameReversed`).

**Icon/UI animations** use a different unit: `IFTItem.Time` is in **1/16 second**. Texture animations
(`TFTItem.Time`, e.g. water) are also **1/16 second**.

### 15. Typical sprite pixel dimensions

Sprites are **not** power-of-two — `LodSpriteHeader_MM6` stores raw `uint16 width/height` and the
pixel data is a **per-scanline RLE** (`LodSpriteLine_MM6` per row, with `emptyBottomLines` to skip
blank rows), so each frame is tightly cropped to its own bounding box.

The world-space size of a billboard is (OE `AddBillboardIfVisible`):

```
billScale       = frame.scale * ViewPlaneDistPixels / depth
screenWidth_px  = billScale * sprite.width
screenHeight_px = billScale * sprite.height
anchor: horizontally centred on the object, bottom edge at object Z
        (unless SPRITE_FRAME_CENTER 0x20, then Z-centred)
```

⇒ **world height in units = spriteHeightPixels × frame.scale**, where
`frame.scale = SFTItem.Scale / 65536.0` (16.16 fixed point).

Typical sizes (**est** — these are inferred from the world heights in `dmonlist.bin` /
`ddeclist.bin` and the scale relationship, not read out of the LOD):

| subject | sprite px (W × H) | typical `scale` | world height |
|---|---|---|---|
| small critter (Rat, Bat, Blood Sucker) | 48 × 48 – 64 × 64 | ~1.3 | ~64–96 u |
| **humanoid (Goblin, Peasant, Guard, Thief, Archer)** | **~80 × 128** | **~1.5** | **~192 u** (= party height) |
| large humanoid (Ogre, Minotaur, Titan, Death Knight) | 128 × 160 – 160 × 200 | ~1.6–2.0 | 256–384 u |
| **large monster (Dragon, Hydra, Behemoth-class)** | **~256 × 200** | **~2.5–3.5** | **500–700 u** |
| tree | 128 × 192 – 192 × 256 | 2.0–4.0 | 400–1000 u |
| bush / shrub | 64 × 64 – 96 × 96 | ~1.5 | 96–144 u |
| barrel / crate / chest (as world sprite) | 48 × 48 – 64 × 64 | ~1.0–1.5 | 48–96 u |
| ground item / loot | 32 × 32 | ~1.0 | ~32 u |
| spell effect (fireball, sparks) | 64 × 64 – 128 × 128 | varies, animated | — |

Hard limits: `≤ 500` actors, `≤ 1000` sprite objects, `≤ 3000` map sprites, and **`≤ 500` billboards
drawn per frame** (OE bails with "Billboards Full" at 500).

### 16. Were sprites pre-rendered 3D?

**Yes.** MM6's monsters, NPCs, trees and props are **pre-rendered from 3D models** (New World Computing
used 3D Studio–era pipelines) into 8 fixed camera azimuths at a fixed elevation, then palettised to
256 colours. Evidence internal to the data: exactly 8 evenly-spaced octants with systematic
horizontal mirroring, per-frame group timing, and per-frame `scale` factors — the signature of a
turntable render, not hand-drawn cels.

Rendering style:
- **Fully textured and smooth-shaded** (Gouraud/Phong-era), not flat-shaded, not cel-shaded.
- **No outline.** No black key line, no rim light.
- Lit by a **single key light from roughly the camera's upper-front-left**, baked in. This means the
  baked lighting *does not follow* the in-game sun — a sprite lit from the left will still look lit
  from the left when the sun is in the west. It's one of the strongest "1998 sprite" tells.
- **Aggressive palettisation**: 256 colours with a lot of the ramp spent on the dominant hue, so
  gradients band and specular hits clip to a flat highlight colour.
- Resolution is *low relative to the screen* — at melee range a humanoid sprite fills ~200 px of a
  345 px tall viewport from ~128 source pixels, i.e. it is **magnified ~1.5×** with **nearest-neighbour**
  sampling in software mode (bilinear in D3D mode). Chunky pixels at close range are correct.
- Silhouettes are hard-keyed (index 0 = transparent) — **no alpha feathering, 1-bit alpha only.**
  Edges are jagged, not anti-aliased.

### 17. How sprites are lit / tinted in world

From OE `GetActorTintColor()` + `TransformBillboard()`:

- **Indoors**: `tint = grey(8 * (31 − dimmingLevel))` where the dimming level is the sector's
  `minAmbientLightLevel` modified by all lights in range. So sprites get **exactly the same 32-step
  grey multiply** as the walls. A monster in a dark corridor is genuinely nearly black.
- **Outdoors, day**: `dim = clamp(8*(max_dim − min_dim), 0, 216)` plus fog density, then clamped by
  `8 * max_terrain_dimming_level`, then per-billboard lights are applied
  (`_43F55F_get_billboard_light_level`). Final tint = `grey(255 − dim)`. At noon this is `#FFFFFF`
  (untinted); at dawn/dusk `#5F5F5F`; at night `#272727` — **identical curve to the sky and terrain**,
  which is why MM6's world reads as tonally unified despite the sprite/polygon mix.
- **Underwater**: multiply by `#10C299`.
- **Armageddon**: everything tints pure red `#FF0000`.
- **Fog: yes** — the same distance term feeds the sprite tint, so sprites grey out with distance
  exactly like geometry. In the hardware path they also get the fog blend.
- **Per-monster tint colour: MM6 has none.** `MonsterDesc_MM6` (148 bytes) has no `tintColor` field;
  `MonsterDesc_MM7` (152 bytes) adds `uint32 tintColor`. The MM6 `MONSTERS.TXT` likewise has 33
  columns with no tint. MM6 recolours monster tiers purely by **swapping `palXXX`**.
- **Shadows: none.** MM6 draws no drop shadow, no blob shadow, no contact shadow under sprites. Sprites
  visibly "float" on uneven terrain — this is authentic and you should reproduce it.
  The only ground decal is the **blood splat** left under a corpse
  (`graphics.bloodsplats`, radius multiplier 1.0, fades over time) — this may be a MM7 addition;
  treat blood splats as **(est)** for MM6.
- Special billboard flags: `BILLBOARD_LIT (0x2)` = self-lit, not dimmed and not affected by lights
  (spell effects, fires); `BILLBOARD_MIRRORED (0x4)`; `BILLBOARD_TRANSPARENT (0x40)`;
  `BILLBOARD_GLOWING (0x80)`; `BILLBOARD_STONED (0x100)` = petrified, renders as grey stone.
- Billboards are drawn **after** all geometry, sorted back-to-front, with **depth-write off and
  depth-test off** (`glDepthMask(GL_FALSE)`, `glDisable(GL_CULL_FACE)`) — pure painter's algorithm.
  This is why MM6 sprites sometimes pop in front of walls they should be behind.

### 18. Full MM6 monster roster

Read directly from the shipped MM6 `MONSTERS.TXT`. **173 entries: 57 families × 3 tiers (A/B/C) + 2
uniques.** `internal` is the sprite/art base name (`…A`, `…B`, `…C` share a model, differing by
palette and stats). Levels/HP are from the same file.

| # | internal | name | Lvl | HP | visual |
|---|---|---|---|---|---|
| 1–3 | `ArcherA/B/C` | **Archer / Master Archer / Fire Archer** | 9/19/29 | 35/93/171 | Human bowman, leather jerkin + hood, longbow; B green-cloaked, C red/orange with flaming arrows |
| 4–6 | `BarbarianA/B/C` | **Magyar / Magyar Soldier / Magyar Matron** | 14/25/37 | 61/137/247 | Fur-clad barbarian, bare arms, big axe/club; Matron is the female palette |
| 7–9 | `BatA/B/C` | **Bat / Giant Bat / Vampire Bat** | 3/6/9 | 9/21/35 | Brown flapping bat, wings spread wide; B larger grey, C black-purple with red eyes. Flying. |
| 10–12 | `BeholderA/B/C` | **Flying Eye / Terrible Eye / Maddening Eye** | 30/40/50 | 180/280/400 | Floating sphere with one huge central eye and eyestalks; green→purple→red. Flying, casts. |
| 13–15 | `BloodsuckerA/B/C` | **Blood Sucker / Brain Sucker / Soul Sucker** | 2/4/8 | 6/13/30 | Small pink-grey leech/slug thing, tentacle mouth; the first enemy in New Sorpigal |
| 16–18 | `ClericA/B/C` | **Acolyte of Baa / Cleric of Baa / Priest of Baa** | 8/15/25 | 30/67/137 | Hooded robe cultist, black/red/gold by tier, staff, casting pose |
| 19–21 | `CobraA/B/C` | **Cobra / King Cobra / Queen Cobra** | 5/10/14 | 17/40/61 | Coiled serpent, hood flared, brown→green→gold |
| 22–24 | `CockatriceA/B/C` | **Agar's Pet / Agar's Monster / Agar's Abomination** | 13/15/17 | 55/67/79 | Beaked reptile-bird chimera, feathered neck, clawed feet; petrification gaze |
| 25–27 | `DemonFlyA/B/C` | **Devil Captain / Devil Master / Devil King** | 30/50/70 | 180/400/700 | Winged red demon, horned, bat wings, flaming weapon. Flying. |
| 28–30 | `DemonA/B/C` | **Devil Spawn / Devil Worker / Devil Warrior** | 20/40/60 | 100/280/540 | Ground demon, red/maroon muscled biped with horns and trident |
| 31–33 | `DragonCaveA/B/C` | **Fire Lizard / Lightning Lizard / Thunder Lizard** | 40/50/60 | 280/400/540 | Wingless quadruped dragon, low slung; red→blue→purple |
| 34–36 | `DragonFlyA/B/C` | **Flame Drake / Frost Drake / Energy Drake** | 24/28/32 | 129/162/198 | Small winged drake; orange→pale blue→violet, breath attack |
| 37–39 | `DragonLandA/B/C` | **Wyrm / Giant Wyrm / Great Wyrm** | 50/60/70 | 400/540/700 | Serpentine legless dragon, dull green/bronze |
| 40–42 | `DragonCoverA/B/C` | **Red Dragon / Blue Dragon / Gold Dragon** | 80/90/100 | 880/1080/1300 | The box-art dragon: full winged quadruped, huge; the largest sprite in the game |
| 43–45 | `DruidessA/B/C` | **Druid / Great Druid / Grand Druid** | 10/16/28 | 40/73/162 | Female robed caster, green/brown robes, staff, hood |
| 46–48 | `DwarfA/B/C` | **Dwarf / Dwarf Warrior / Dwarf Lord** | 10/20/30 | 40/100/180 | Stocky bearded dwarf, mail + helm, axe/hammer; Snergle's mines |
| 49–51 | `ElemAirA/B/C` | **Dust Devil / Twister / Air Elemental** | 16/22/33 | 73/114/207 | Translucent whirling vortex column, pale grey-blue, no fixed body. Flying. |
| 52–54 | `ElemEarthA/B/C` | **Rock Beast / Earth Spirit / Earth Elemental** | 25/30/40 | 137/180/280 | Lumbering humanoid made of boulders, brown-grey, no neck |
| 55–57 | `ElemFireA/B/C` | **Fire Beast / Fire Spirit / Fire Elemental** | 13/26/39 | 55/145/269 | Living flame column with arms, orange-yellow, self-lit (glows, casts light) |
| 58–60 | `ElemWaterA/B/C` | **Water Beast / Water Spirit / Water Elemental** | 14/24/36 | 61/129/237 | Translucent blue humanoid wave form |
| 61–63 | `FighterChainA/B/C` | **Fighter / Soldier / Veteran** | 14/24/35 | 61/129/227 | Human in chainmail + conical helm, sword and shield |
| 64–66 | `FighterLeathA/B/C` | **Thug / Ruffian / Brigand** | 8/14/22 | 30/61/114 | Human bandit in leather, no helm, club or short sword |
| 67–69 | `GargoyleA/B/C` | **Stone / Marble / Diamond Gargoyle** | 16/22/33 | 73/114/207 | Squat winged demon statue, folded wings, crouched; grey→white→pale blue |
| 70–72 | `GenieA/B/C` | **Genie / Djinn / Efreet** | 33/44/55 | 207/325/467 | Bare-chested blue/red humanoid with smoke instead of legs, arms folded. Flying. |
| 73–75 | `GhostA/B/C` | **Ghost / Evil Spirit / Specter** | 9/13/19 | 35/55/93 | Semi-transparent hooded wraith, pale blue-white, trailing tatters. Flying, high AC. |
| 76–78 | `GoblinA/B/C` | **Goblin / Goblin Shaman / Goblin King** | 4/6/10 | 13/21/40 | **Green-skinned, hunched, wearing rags and a loincloth, carrying a crude club**; Shaman adds a feathered headdress and staff; King is larger with a crown and better weapon |
| 79–81 | `GuardA/B/C` | **Guard / Lieutenant / Captain** | 11/19/33 | 45/93/207 | Town guardsman: tabard over mail, kite shield, spear/sword, open-face helm |
| 82–84 | `HarpyA/B/C` | **Harpy / Harpy Hag / Harpy Witch** | 14/17/19 | 61/79/93 | Female torso, feathered bird legs and wings, wild hair. Flying. |
| 85–87 | `HydraA/B/C` | **Hydra / Venomous Hydra / Colossal Hydra** | 45/55/65 | 337/467/617 | Multi-headed serpent on a squat body, green/purple |
| 88–90 | `JackalmanA/B/C` | **Defender / Sentinel / Guardian of VARN** | 35/55/65 | 227/467/617 | Jackal-headed humanoid guardian in Egyptian-style armour (Pyramid maps) |
| 91–93 | `KnightPlateA/B/C` | **Death Knight / Doom Knight / Cuisinart** | 40/60/80 | 280/540/880 | Full black plate armour, closed helm, two-handed sword; no visible face |
| 94–96 | `LichA/B/C` | **Lich / Greater Lich / Power Lich** | 20/30/40 | 100/180/280 | Skeletal undead mage in tattered robes, glowing eyes, spellcasting pose |
| 97–99 | `LizardArchA/B/C` | **Lizard Man / Lizard Archer / Lizard Wizard** | 4/7/11 | 13/25/45 | Green scaled reptilian humanoid, tail, loincloth, spear/bow/staff |
| 100–102 | `MedusaA/B/C` | **Medusa / Medusa Enchantress / Gorgon** | 35/40/45 | 227/280/337 | Female torso, snake lower body, snake hair, bow. Petrifies. |
| 103–105 | `MerchantA/B/C` | **Peasant** (merchant variant) | 4/5/6 | 13/21 | Civilian townsfolk sprite, tunic + apron |
| 106–108 | `MinotaurA/B/C` | **Minotaur / Minotaur Mage / Minotaur King** | 39/59/79 | 269/525/861 | Bull-headed muscular biped, huge axe, ring in nose |
| 109–111 | `MonkA/B/C` | **Novice / Initiate / Master Monk** | 8/16/27 | 30/73/153 | Bare-armed robed martial artist, sash, unarmed stance |
| 112–114 | `NoblemanA/B/C` | **Swordsman / Expert / Master Swordsman** | 10/17/24 | 40/79/129 | Silver Helm nobleman: plumed hat / open helm, tabard, rapier-style sword |
| 115–117 | `OozeA/B/C` | **Ooze / Acidic Ooze / Corrosive Ooze** | 12/18/25 | 50/86/137 | Amorphous blob, green→yellow→purple, no limbs, wobbling animation |
| 118–120 | `OgreA/B/C` | **Ogre / Ogre Raider / Ogre Chieftain** | 15/20/28 | 67/100/162 | Huge grey-brown brute, pot belly, tusks, tree-trunk club |
| 121–126 | `PeasantF1/F2 A-C` | **Peasant** (female) | 1–3 | 3/6/9 | Civilian woman, long skirt, shawl; non-hostile filler |
| 127–129 | `PeasantF3A/B/C` | **Cutpurse / Bounty Hunter / Assassin** | 3/5/7 | 9/17/25 | Female in dark hooded cloak with dagger |
| 130–132 | `PeasantF4A/B/C` | **Cannibal / Head Hunter / Witch Doctor** | 6/8/10 | 21/30/40 | Female tribal, bone jewellery, war paint, spear; Bootleg Bay |
| 133–135 | `PeasantM1A/B/C` | **Peasant** (male) | 1–3 | 3/6/9 | Civilian man, tunic and trousers |
| 136–138 | `PeasantM2A/B/C` | **Apprentice / Journeyman Mage / Mage** | 2/6/10 | 6/21/40 | Blue-robed caster with pointed hood, staff |
| 139–141 | `PeasantM3A/B/C` | **Follower / Mystic / Fanatic of Baa** | 3/5/7 | 9/17/25 | Plain-robed cultist, hood up (listed as "Hermit" in some map tables) |
| 142–144 | `PeasantM4A/B/C` | **Cannibal / Head Hunter / Witch Doctor** | 6/8/10 | 21/30/40 | Male tribal, bone mask, spear |
| 145–147 | `RatA/B/C` | **Common Rat / Large Rat / Giant Rat** | 2/4/6 | 6/13/21 | Brown quadruped rat, long tail, low to the ground |
| 148–150 | `RobotA/B/C` | **Patrol / Enforcer / Terminator Unit** | 50/70/90 | 400/700/1080 | Sci-fi metal humanoid robot, glowing optic, blaster arm; Control Center |
| 151–153 | `SeaSerpentA/B/C` | **Sea Serpent / Sea Monster / Sea Terror** | 28/36/48 | 162/237/374 | Long-necked aquatic serpent, finned, blue-green |
| 154–156 | `SkeletonA/B/C` | **Skeleton / Skeleton Knight / Skeleton Lord** | 6/10/14 | 21/40/61 | Animated bone humanoid; Knight adds rusted armour and shield, Lord a crown |
| 157–159 | `SorcererA/B/C` | **Sorcerer / Magician / Warlock** | 25/35/50 | 137/227/400 | Robed human mage, long beard, high collar, purple/black |
| 160–162 | `SpiderA/B/C` | **Spider / Giant Spider / Huge Spider** | 5/8/12 | 17/30/50 | Eight-legged arachnid, brown/black, hairy legs |
| 163–165 | `ThiefA/B/C` | **Thief / Burglar / Rogue** | 8/12/18 | 30/50/86 | Dark leather, hood, twin daggers, crouched stance |
| 166–168 | `TitanA/B/C` | **Titan / Noble Titan / Supreme Titan** | 65/75/95 | 617/787/1187 | Giant golden-skinned humanoid, toga/armour, throws lightning |
| 169–171 | `WerewolfA/B/C` | **Wolfman / Werewolf / Greater Werewolf** | 20/30/40 | 100/180/280 | Bipedal wolf, brown→grey→black, claws |
| 172 | `zDemonqueen` | **Demon Queen** (unique boss) | 100 | 1300 | Xenofex-style female demon, oversized, endgame |
| 173 | `zReactor` | **Reactor** (unique) | 100 | 1300 | Static machine object in the Control Center |

Movement types in the table: `Short` / `Med` / `Long` (hop distance), `Fly Y/N`. AI: `Normal`,
`Aggress`, `Suicide`, `Wary`, etc.

### 19. Outdoor decoration sprites

Decorations are billboards described by `DecorationDesc_MM6` (80 bytes) in `DDECLIST.BIN`:

```
char[32] internalName   // e.g. "dec03"
char[32] hint           // shown on mouse-over
int16 uType
uint16 uDecorationHeight   // world height, used for collision
int16 uRadius              // collision radius
int16 uLightRadius         // >0 = emits light
uint16 uSpriteID           // index into the sprite frame table
uint16 uFlags
int16 uSoundID             // ambient loop (waterfall, fire, etc.)
```

Flags: `NO_BLOCK_MOVEMENT 0x01`, `DONT_DRAW 0x02`, `FLICKER_SLOW 0x04`, `FLICKER_MEDIUM 0x08`,
`FLICKER_FAST 0x10`, `MARKER 0x20` (invisible event trigger), `SLOW_LOOP 0x40`, `EMITS_FIRE 0x80`
(replaced by a particle emitter, not a sprite), `SOUND_ON_DAWN 0x100`, `SOUND_ON_DUSK 0x200`,
`EMITS_SMOKE 0x400`.

Sprite names confirmed from OE `Seasons.cpp` (which hard-codes MM6 sprite-table indices):

- **Trees**: `tree01` (483) … `tree10` (492) … `tree60` (531), `tree65` (536), `tree66` (537).
  So there are **at least 66 tree sprite groups**. `tree01`, `tree04`, `tree10` have explicit
  **autumn (+1)** and **winter (+2)** variants; `tree60`, `tree65`, `tree66` are evergreen (no
  seasonal variant). Deciduous broadleaf (round canopy), conifers (tall triangular), palms
  (Bootleg Bay), dead/bare trunks, and jungle types.
- **Bushes**: `bush01`, `bush02` (468) … — `bush02` is explicitly noted as evergreen (swamp).
- **Flowers**: `flower01` (539), `flower03` (541), `flower09` (547), `flower10` (548) — these are
  **culled entirely in autumn and winter** (`return 0`, the null sprite). At least 10 flower groups.
- Remaining decoration families in MM6 outdoor maps (names **est**, presence firm from the maps):
  rocks/boulders, stalagmites (indoor), mushrooms (swamp/cave), tall grass/reeds, cattails,
  cacti (Dragonsand), **signposts** (town/road markers, mouse-over hint text),
  **wells**, **fountains**, **campfires** (`EMITS_FIRE` → particle emitter + light), **torches** and
  **braziers** (flicker flags + `LightRadius`), **barrels**, **crates**, **sacks**, **chests**
  (obelisk chest flag `LEVEL_DECORATION_OBELISK_CHEST`), **haystacks**, **fences**, **carts/wagons**,
  **gravestones/tombstones**, **statues**, **obelisks** (the 12 quest obelisks), **anvils**,
  **cauldrons/pedestals**, **bones/skulls**, **hanging chains**, **hanging cages**, **stalls/awnings**.
- Particle emitters: `DECORATION_DESC_EMITS_FIRE` decorations spawn `ParticleType_Bitmap |
  Rotating | Ascending` particles tinted `#FF3C1E` (`colorTable.OrangeyRed`) instead of a sprite.
- Decoration culling: a decoration is frustum-culled as a cylinder of **radius 512** regardless of its
  actual size, and its animation phase is offset by `|x| + |y|` ticks (see §14).
- Interactive decorations get a mouse-over hint and can fire events (`uEventID`); the flag
  `LEVEL_DECORATION_VISIBLE_ON_MAP` marks them on the automap once used.

---

## D. UI chrome — exact layout

All coordinates are absolute in the 640 × 480 framebuffer. Sources: OE `src/GUI/GUIWindow.cpp`
(`UI_Create`, `CreateCharacterButtons`), `src/GUI/UI/UIGame.cpp`, `src/Engine/Engine.cpp:202`.

MM6 ships **one** UI skin. (MM7 added three alignment skins — the `-A` / `-B` / `-C` suffixes on
`ib-*.pcx` in OE are the MM7 neutral/good/evil sets; MM6's equivalent images have no suffix, and MM6's
generic panel background is `ibground`.)

### 20. Bottom HUD bar

**Geometry: y = 352 … 479, height 128 px, full 640 px wide.**
Image `ib-b.pcx` drawn at (0, 352); the status-message strip `IB-Foot.pcx` is drawn on top at (0, 352).

**Material:** carved dark stone with brass/bronze fittings and inset wood panels — a "dungeon lintel"
look. Four large arched niches hold the party portraits; between and around them are recessed vertical
slots for the HP/SP tubes, and the whole strip is bordered top and bottom by a bevelled moulding with
a highlight along the top edge. The right end of the bar (x ≥ 468) is continuous with the right panel.

| element | position | size | notes |
|---|---|---|---|
| **status text line** | centred within a 450 px field starting at x = 11, baseline **y = 357** | — | font **Lucida**; main colour + shadow colour (see §25) |
| **portrait art, char 1–4** | x = **35, 150, 265, 380**, **y = 388** | **63 × 73** | 56 expression frames per face (`<face><NN>`, NN = 01…56) |
| portrait click region | ellipse centred (**61, 177, 292, 407**, **424**) radii **31 × 40** | | `BUTTON_TYPE_CHARACTER` |
| **active-character frame** | x = portraitX − 9 → **25, 140, 255, 370**, **y = 380** | | `IB-selec` — a glowing/bright border ring |
| **"ready to act" indicator** | x = portraitX − 4 → **30, 145, 260, 375**, **y = 384** | | `IB-InitG` (green) / `IB-InitY` (yellow, yellow-alert) / `IB-InitR` (red, red-alert) |
| **HP bar (left of portrait)** | x = **23, 138, 253, 368**, **y = 402** | **5 × 49** | vertical tube, fills **bottom-up**; textures `ib-statG` / `ib-statY` / `ib-statR` |
| **SP bar (right of portrait)** | x = **102, 217, 332, 447**, **y = 402** | **5 × 49** | texture `ib-statB`, fills bottom-up |
| HP/SP click regions | same x/y | 5 × 49 | show numeric HP/SP in the status line |
| char buff: **Bless** | x = portraitX + 72 → **106, 221, 336, 451**, **y = 393** | small icon | `isg-01` |
| char buff: **Preservation** | same x, **y = 410** | | `isg-02` |
| char buff: **Hammerhands** | same x, **y = 427** | | `isg-03` |
| char buff: **Pain Reflection** | same x, **y = 444** | | `isg-04` |

**HP bar colour thresholds** (OE `GameUI_DrawLifeManaBars`):
`ratio > 0.50` → **green**; `0.25 < ratio ≤ 0.50` → **yellow**; `0 < ratio ≤ 0.25` → **red**; `≤ 0` →
nothing drawn (bar empty, dark slot visible). The SP bar is always blue. Ratio is clamped to 1.0, and
the bar is drawn by clipping the full texture to `height = ratio * 49` anchored at the bottom.

**Bottom-right button cluster** (these sit inside the bottom bar under the right panel), all at
**y = 450**, each ≈ 40 × 35:

| x | button | image | key |
|---|---|---|---|
| **476** | **Cast Spell** (opens spellbook) | `ib-m1d` | C |
| **518** | **Rest** | `ib-m2d` | R |
| **560** | **Quick Reference** | `ib-m3d` | Q |
| **602** | **Game Options / menu** | `ib-m4d` | Esc |

**Gold and Food readout** (OE `GameUI_DrawFoodAndGold`), drawn in the **right panel's** lower area but
functionally part of the HUD:

- Food: right-justified with tag `\r087`, **y = 322** (or **y = 381** when the right panel is in its
  alternate state, e.g. during dialogue). Click region **(476, 322, 77, 17)**.
- Gold: right-justified with tag `\r028`, same y. Click region **(555, 322, 77, 17)**.
- Font: **smallnum.fnt** (a compact numeric face), colours = `uGameUIFontMain` / `uGameUIFontShadow`.
- Values ≥ 1 000 000 are formatted as `%.4gM`.

**Turn-based mode.** Toggled with Enter. When active, an animated overlay icon is drawn at
**(394, 288)** — bottom-right corner *inside* the 3D viewport:
- `turnstart` — an opening-hand animation on entry (vanilla animation is 320 ticks / 2.5 s but was
  cut off at 64 ticks, so in practice you see only the first fifth of it),
- `turn0`…`turn5` — a **hand/clock showing remaining action points**, selected as
  `turn[5 − actionPoints/26]`,
- `turnstop` — attack phase,
- `turnhour` — an **hourglass** during the monsters' turn.
Additionally, in turn-based mode the green/yellow/red "ready" markers are drawn only over the
characters currently in the turn queue.

**Party buff icons** — 14 slots in the **right panel**, two rows:

```
row 1 (y = 247): x = 477, 497, 522, 542, 564, 581, 614
row 2 (y = 279): x = 477, 497, 522, 542, 564, 589, 612
```

Order: Feather Fall, Resist Fire, Resist Air, Resist Water, Resist Mind, Resist Earth, Resist Body,
Heroism, Haste, Shield, Stone Skin, Protection from Magic, Immolation, Day of the Gods.
Each icon is a **16 × 8 sprite-sheet atlas = 126 usable frames**, advanced at
`(realtime_ms / 20 + 20 * phaseOffset) % 126` → **50 fps, ~2.5 s loop**, with a per-slot phase offset
`{14,1,10,4,7,2,9,3,6,15,8,3,12,0}` so the icons shimmer out of sync.

Two more buff indicators are drawn **inside the 3D viewport**: Fly at **(8, 8)** (top-left) and
Water Walk at **(396, 8)** (top-right), both animated (`spell21`, `spell27`) and only while the effect
is actually engaged.

### 21. Right-hand side panel

**Geometry: x = 468 … 639, y = 0 … 479 — 172 × 480.** Image `ib-r.pcx` at (468, 0); the mid-panel
overlay `ib-mb` at (468, 0); the automap mask `ib-autmask` at (468, 0) last, so it cuts the map into
a rounded/arched aperture.

| element | position | size | notes |
|---|---|---|---|
| **automap / minimap** | **(488, 16)** | **137 × 117** | asserted exactly `rect.w == 137 && rect.h == 117` in OE |
| minimap zoom | outdoor `uMinimapZoom = 512`, indoor `= 1024` | | |
| **zoom-in (+) button** | **(519, 136)** | `ib-autout` | |
| **zoom-out (−) button** | **(574, 136)** | `ib-autin` | |
| **compass** | image scrolled to `x = round(yaw * 0.1171875) + 285`, **y = 136**, clipped to **(541, 0, 26, 480)** | 26 px window | `IB-COMP` is a **~240 px-wide panoramic strip** (0.1171875 = 240/2048) that slides behind a 26-px aperture — it is a *ribbon* compass, not a rotating needle |
| **party arrow on map** | map centre − (3, 3) | 8 dirs | `MAPDIR1`…`MAPDIR8` |
| **date/time click region** | **(484, 15)** | 138 × 116 | overlays the map; click → status line shows date/time |
| **torchlight indicator** | **(468, 0)** | animated `torch` | drawn only while Torch Light is up |
| **wizard-eye indicator** | **(606, 0)** | animated `wizeye` | drawn only while Wizard Eye is up |
| **hireling portrait 1** | **(489, 152)** | 63 × 73 | click region (491, 149, 64, 74) |
| **hireling portrait 2** | **(559, 152)** | 63 × 73 | click region (561, 149, 64, 74) |
| hireling scroll ◀ | **(469, 178)** | | `IB-NPCLD` |
| hireling scroll ▶ | **(626, 178)** | | `IB-NPCRD` |
| party buff icons | rows at y = 247 / 279 | see §20 | |
| food / gold | y = 322 | see §20 | |
| **book tabs (bottom of panel)** | Quests **(491, 353)**, Autonotes **(527, 353)**, Maps **(546, 353)**, Calendar **(570, 353)**, History **(600, 361)** | `ib-td1-A`…`ib-td5-A` | rendered as **five overlapping book spines / tome edges**; a tab **flashes on/off every 128 ticks (1 s)** when there's a new quest/note/history entry |

**Minimap rendering.** Outdoors: a per-map pre-rendered top-down colour image is sampled at
`step = 65536 * imgW / zoom` per pixel and blitted into the 137×117 rect — a straight nearest-neighbour
crop/zoom of a static picture, plus line overlays. Indoors: the rect is filled with
**`#000078` (navy)** and the wall outlines are drawn as **`#0000FF` blue** lines (only for faces the
party has actually seen). Overlaid dots: friendly actor **`#00E100`**, hostile **`#FF0000`**, corpse
**`#FFFF00`**, decoration **`#FFFFFF`**, projectile **`#FF0000`**, treasure **`#0000FF`**.
Without the Cartographer hireling or Wizard Eye, monsters are not shown.

**There is no quick-spell button in the bottom bar** — quick-spell is invoked by clicking in the world
with the cast-on-click toggle, and the assigned spell is set from within the spellbook.

### 22. Full-screen panels

Every full-screen panel draws its background at **(8, 8)** — i.e. it exactly replaces the 3D viewport,
leaving the top/left/right/bottom chrome visible. Panel art is therefore **461 × 345** (a few are 460 ×
344). The right panel and bottom bar stay live behind/around them.

**Character sheet** — background at (8, 8). Four tabs at the bottom of the panel, absolute
**y = 316**, x = **20 (Stats), 110 (Skills), 200 (Inventory), 290 (Awards)**, with **Exit at (379, 316)**.
Tab images `ib-cd1-d`…`ib-cd4-d` (pressed states). The **paperdoll is always drawn on the right side of
the sheet regardless of tab**, and the ring overlay `fr_rings` is drawn at (473, 0) when rings are shown.

- **Stats tab**: parchment-textured background. Title line `Name the Class` at **(26, 18)** in
  **Arrus** font, with `Skill Points: N` right-justified at `\r180`. Two columns of
  `label ....... value` rows: Might/Intellect/Personality/Endurance/Accuracy/Speed/Luck on the left,
  Hit Points/Spell Points/Armour Class/Condition/Quick Spell/Age/Level/Experience on the right, then
  resistances. Values are white when at base, **green `#00E100`** when buffed above base,
  **scarlet `#FF2300`** when below base.
- **Skills tab**: skills grouped by category (Weapons / Armour / Magic / Misc), each showing
  `Skill  Rank (Level)`. Learnable-and-affordable entries render in **`#00AFFF` (bright blue)**,
  everything else in **`#FF0000` red**; the currently highlighted row is also red.
- **Inventory tab**: background `fr_inven`. **Grid is 14 columns × 9 rows of 32 × 32 cells with its
  top-left at (14, 17)** → the grid occupies x 14…461, y 17…304. Items are bitmaps of arbitrary size
  centred in their cell footprint via `itemOffset(dim) = (floor((dim-14)/32)*32 + 32 - dim)/2`,
  clamped to ±9 px. A held item paints a **`rgba(96,96,96,128)` translucent grey footprint** over the
  cells it would occupy. Broken items are drawn tinted **red**, unidentified items tinted **green**,
  enchanted items get an animated overlay (`sptext01` red / `sp28a` blue / `sp30a` green /
  `sp91a` purple) blended over the icon.
- **Awards tab**: a scrollable list with a scrollbar; award text cycles through six pastel colours
  `#F86CA0, #70DCF8, #C0C0F0, #40F460, #E8F460, #F0FCC0`.

**Spellbook** — a two-page open book. **MM6 has 9 schools × 11 spells = 99 spells** (MM7 has 12 per
school; do not draw a 12th icon). Page backgrounds `SBFB00`/`SBAB00`/`SBWB00`/`SBEB00`/`SBSB00`/
`SBMB00`/`SBBB00`/`SBLB00`/`SBDB00` (fire/air/water/earth/spirit/mind/body/light/dark).
Chapter tabs run down the **right** edge as nine bookmark tabs:

```
school   button (x,y)   tab-off (x,y)   tab-on (x,y)
Fire     399, 10        406,  9         415, 10
Air      399, 46        406, 46         415, 46
Water    399, 83        406, 84         415, 83
Earth    399,121        406,121         415,121
Spirit   399,158        407,158         415,158
Mind     400,196        405,196         416,196
Body     400,234        405,234         416,234
Light    400,271        405,272         416,271
Dark     400,307        405,309         416,307
```
(all relative to the panel origin (8, 8); add 8 for absolute). Spell icons are laid out per-school by
a hand-authored `pIconPos` table over the two page faces; **only spells the character has actually
learned are drawn** — unlearned slots are blank parchment. Page turns play `TurnPage1`/`TurnPage2`.

**Quest Log / Autonotes / Journal / Calendar / Maps** — all use the same "open book" frame at (8, 8):
- Quests: `sbquiknot`-family background; Autonotes: **`sbautnot`**; Journal/history: **`sbplayrnot`**;
  Calendar: **`sbdate-time`**; Maps: **`sbmap`**.
- Sub-page buttons run down the right inner margin at x ≈ **398–408** (relative), y = **1, 38, 113,
  150, 188, 226**, size 50 × 34, each with an on/off bitmap.
- Calendar shows animated moon phases (`moon_new`, `moon_4`, `moon_2`, `moon_ful`) and prints time /
  day / month / year / moon / location in **`#4B4B4B`** on the cream page.
- Map book: same `sbmap` page, with the map drawn at zoom `uMapBookMapZoom` ∈ {384, 768, 1536
  (outdoor max), 3072 (indoor max)}; panning moves the centre by **512 units** (one tile) per press,
  clamped to `±(88 >> (zoom/384) − 44) * 512`.

**Rest screen** — `restmain` background at (8, 8), with an **animated sky window at (16, 26)** (the sky
frame advances with time of day) and an **animated hourglass at (267, 159)** while time passes.
Buttons: "Rest & Heal 8 Hours" **(24, 154) 225 × 37**; "Wait until Dawn" **(61, 232) 154 × 33**;
"Wait 1 Hour" **(61, 264) 154 × 33**; "Wait 5 Minutes" **(61, 296) 154 × 33**;
Exit **(280, 297) 154 × 37**.

**Shops / houses (weapon, armour, magic, alchemy, tavern, temple, training hall, guilds, banks)** —
this is the one screen that does **not** live at (8, 8). Instead:
- The **left 3D area shows a static painted interior** of the shop (a full 461 × 345 illustration, or
  a short AVI for some establishments — the "house movie" viewport is the same 8/8/172/128 inset).
- The **right panel is replaced** by the dialogue panel: `game_ui_dialogue_background` at **(477, 0)**
  and `ib-mb` frame at **(468, 0)**.
- The **proprietor's portrait** is drawn at **(521, 38)** (size 63 × 73) with a 4-px border frame
  `evtnpc` at (517, 34).
- **Dialogue option list**: buttons at **x = 480, width 140, height 30**, first at **y = 146** (shop
  proprietor) or **y = 160** (house NPC), stepping **+30 px** per option. Options render in
  **white `#FFFFFF`**, and the one under the cursor in **gold `#E1CD23`**.
- **Exit / Cancel** button **(471, 445) 169 × 35** (`ib-bcu`).
- Yes/No confirmation (e.g. "Enter?"): **Yes (486, 445) 75 × 33** (`BUTTYES2`),
  **No/Cancel (566, 445) 75 × 33** (`BUTTESC2`); alternative ok/x icons at **(476, 451)** and
  **(556, 451)**.
- Shop item grids (buy/sell/identify/repair) are drawn over the shop illustration inside the
  461 × 345 area, laid out as rows of item bitmaps with prices.
- Multiple NPCs in a building are laid out via `pNPCPortraits_x/y`: 1 NPC → (521, 38); 2 → (521, 38),
  (521, 165); 3 → (521, 38), (521, 133), (521, 228); 4 → (521,38), (486,133), (564,133), (521,228);
  6 → (486,38),(564,38),(486,133),(564,133),(486,228),(564,228).

**NPC dialogue window** — identical framing to shops: portrait at (521, 38), topic buttons at
x = 480 / w 140 / h 30 starting y = 160, exit at (471, 445). NPC name is printed in
**`#1699E9` (Eastern Blue)**; body text white on the panel.

**Town Portal / Lloyd's Beacon** — both use the `sbmap` book page. Town Portal shows the five
destination towns as clickable hotspots on a painted map of Enroth with a border overlay
(`lb_bordr` for Lloyd's); the status bar is redrawn at (0, 352) underneath.

**Level-up dialog** — a message box built from the 9-slice frame set
(`cornr_ul/ur/ll/lr` + `edge_top/btm/lf/rt`, plus `endcap`) over a darkened backing; text in
**Arrus** for the header and **Lucida** for the body. Skill-point award text uses
**`#FFFF9B` (pale canary)** for headers.

**Game menu (Esc)** — `options` background at (8, 8). Buttons:
New Game **(19, 155) 214 × 40**, Save **(19, 209)**, Load **(19, 263)**,
Sound/Keyboard/Game Options **(241, 155)**, Quit **(241, 209)**, Return to Game **(241, 263)**,
all 214 × 40.

### 23. Fonts

MM6 fonts live in `ICONS.LOD` as `.fnt` files. Format (`LodFontHeader_MM7` /
`LodFontMetrics_MM7`, which MM6 shares):

```
uint8 firstChar (30 or 31), lastChar (255), fontHeight
per-char: int8 leftSpacing, uint8 width, int8 rightSpacing   // left/right may be NEGATIVE (kerning)
per-char: uint32 offset into the pixel blob
pixels: 1 byte per pixel, value 0 = transparent, 1 = SHADOW, 255 = TEXT
```

**Critically: the drop shadow is baked into the glyph bitmap as a second colour index.** Every glyph
ships with its own 1-px offset shadow mask, and the engine renders it in a separately specifiable
shadow colour. This is *not* a runtime offset blit — reproduce it by keeping a 2-channel glyph atlas
(OE packs text into the R channel and shadow into the G channel of a 16 × 16 grid of 32 × 32 cells =
256 glyphs).

| font | file | look | used for |
|---|---|---|---|
| **Lucida** | `lucida.fnt` | **serif**, Lucida Bright–like, ~**11–12 px** cap-to-descender (**est**), moderate contrast, proportional | body text everywhere: status bar, dialogue, books, tooltips, item descriptions |
| **Arrus** | `arrus.fnt` | heavier **serif display** face, ~**14–16 px** (**est**), used for titles/headers | character sheet titles, message-box headers, house titles |
| **Create** | `create.fnt` | medium serif, ~**12–13 px** (**est**) | button labels, party-creation screen |
| **Smallnum** | `smallnum.fnt` | small condensed numerals, ~**8–9 px** (**est**) | gold/food counters, damage numbers, small stat readouts |
| **Comic** | `comic.fnt` | informal | present in the LODs; MM7-era usage |

Yes — the overall impression is exactly "a Lucida-family serif". Not a pixel/bitmap-design face; these
are rasterised versions of real serif typefaces, which is why MM6 text looks bookish rather than
game-y.

**Inline markup in text strings** (OE `GUIFont.cpp`):
- `\f%05d` — set colour; the 5 digits are a **16-bit RGB565** value (`Color::fromC16`). `\f00000`
  resets to the default colour. This is the mechanism behind gold "clickable" words inline in prose.
- `\r%03d` — right-justify at the given offset from the right border.
- `\t%03d` — tab to a column offset from the left border.
- `\n` — newline.
- `_` — switch to the alternate font (in the buffered path).

**Interactive / highlight colour: `#E1CD23`** (`colorTable.Sunflower`) — this is the gold you remember.
It is used for `ui_game_dialogue_option_highlight_color` (the dialogue option under the cursor) and for
the "moderate condition" colour. Non-highlighted options are plain white.

### 24. Mouse cursor

Three cursor bitmaps in `ICONS.LOD`, loaded at startup (OE `Io::Mouse::Initialize`):

- **`MICON1` — the default arrow.** MM6 uses the **system arrow cursor** for this (OE only draws a
  custom bitmap if `always_custom_cursor` is set), so it looks like the plain Windows/DOS pointer.
- **`MICON2` — the targeting reticle.** A small crosshair/ring. Drawn **centred on the mouse
  position** (`pos -= size/2`). In mouse-look mode it is pinned to the **centre of the 3D viewport**
  at (238, 180). This is the "attack/cast" cursor.
- **`MICON3` — the third cursor** (spell/interaction variant).
- Cursors are drawn with **black (`#000000`) as the colour key**.
- **When carrying an item**, the cursor is replaced by the item's own inventory bitmap, drawn at the
  cursor with a grab offset (`mouse->pickedItemOffset`), and the system cursor is hidden. The
  translucent grey drop-footprint is painted in the inventory grid simultaneously.
- Buying/using an item, targeting a spell, and stealing all swap the cursor bitmap.

### 25. Colour reference

**Verbatim from the engine's colour table** (`src/Library/Color/ColorTable.h`) — these are exact:

| role | constant | RGB | hex |
|---|---|---|---|
| status-bar / HUD main text (neutral skin) | `Diesel` | 10, 0, 0 | **`#0A0000`** |
| status-bar / HUD text shadow (neutral skin) | `StarkWhite` | 230, 214, 193 | **`#E6D6C1`** |
| default UI text | `White` | 255, 255, 255 | **`#FFFFFF`** |
| **highlighted / clickable text (gold)** | `Sunflower` | 225, 205, 35 | **`#E1CD23`** |
| section headers, tooltips | `PaleCanary` | 255, 255, 155 | **`#FFFF9B`** |
| positive / buffed stat | `Green` | 0, 225, 0 | **`#00E100`** |
| negative / debuffed stat | `Scarlet` | 255, 35, 0 | **`#FF2300`** |
| broken item / severe condition | `Red` | 255, 0, 0 | **`#FF0000`** |
| learnable skill | `BoltBlue` | 0, 175, 255 | **`#00AFFF`** |
| NPC name in dialogue | `EasternBlue` | 21, 153, 233 | **`#1699E9`** |
| book / calendar body text | `Tundora` | 75, 75, 75 | **`#4B4B4B`** |
| indoor minimap background | `NavyBlue` | 0, 0, 120 | **`#000078`** |
| indoor minimap wall lines | `Blue` | 0, 0, 255 | **`#0000FF`** |
| held-item footprint | — | 96, 96, 96, α128 | **`#606060` @ 50 %** |
| award text cycle | Magenta / Malibu / MoonRaker / ScreaminGreen / Canary / Mimosa | | **`#F86CA0`, `#70DCF8`, `#C0C0F0`, `#40F460`, `#E8F460`, `#F0FCC0`** |
| fire-particle tint | `OrangeyRed` | 255, 60, 30 | **`#FF3C1E`** |
| underwater fog | — | 33, 142, 90 | **`#218E5A`** |
| underwater tint multiply | `Topaz` | 16, 194, 153 | **`#10C299`** |
| night fog | `DarkGray` | 31, 31, 31 | **`#1F1F1F`** |
| daytime weather fog | — | 200, 200, 200 | **`#C8C8C8`** |
| invisible party portrait tint | `MediumGrey` | 126, 126, 126 | **`#7E7E7E`** |
| default light source colour | — | 185, 185, 185 | **`#B9B9B9`** |

**Bitmap-derived colours (est — read off the art, not from code):**

| element | hex range |
|---|---|
| HUD stone frame, mid-tone | **`#5A5248`** (range `#3A342C` shadow → `#8A8072` highlight) |
| HUD brass / bronze fittings | **`#9A7838`** (`#5E4A20` → `#D8B868`) |
| HUD inset wood panel | **`#4A3624`** (`#2E2014` → `#6E5238`) |
| HP bar green (`ib-statG`) | **`#28C828`** (`#0C7A0C` → `#5CF05C`) |
| HP bar yellow (`ib-statY`) | **`#E0D020`** (`#8A7C0C` → `#F8F060`) |
| HP bar red (`ib-statR`) | **`#D02010`** (`#7A1408` → `#F86048`) |
| SP bar blue (`ib-statB`) | **`#2848D8`** (`#122A7A` → `#6080F8`) |
| **empty bar slot** (the recess behind the tube) | **`#2A2620`** — near-black warm grey, no fill drawn at all |
| character-sheet parchment | **`#C8B48C`** (`#A89068` → `#E4D4B0`) |
| spellbook page | **`#D4C29C`** (`#B0A078` → `#EDE0C4`) with school-tinted borders |
| book (quests/notes/journal) page | **`#CFC0A0`** |
| message-box frame (`cornr_*`/`edge_*`) | dark carved wood `#3E2E1E` with a `#8A6E46` bevel |
| generic MM6 panel background (`ibground`) | mottled tan leather/parchment `#9A8460` |

---

## E. Feel

### 26. Screen transitions

- **Entering a building / house.** The 3D view is replaced by a static painted interior (or, for many
  establishments, a short **full-motion AVI** played into the same 8/8/461/345 inset — the
  `house_movie_*` viewport constants are identical to the game viewport). There is **no fade**: the
  swap is immediate on the next frame. A door/creak sound plays. The right panel simultaneously
  becomes the dialogue panel.
- **Changing maps (outdoor↔outdoor, entering a dungeon, Town Portal, Lloyd's Beacon).** A **loading
  screen** is shown while the map streams in. `UITransition.cpp` handles it. Vanilla MM6 shows the
  destination's name over a loading image; there is **no cross-fade** — hard cut in, hard cut out.
- **Opening a menu / book / character sheet.** Instant. Panels replace the 3D viewport with no
  animation whatsoever; only a page-turn or click sound. The one exception is the **spellbook**, whose
  page changes play `TurnPage1`/`TurnPage2` sounds (still no visual page-turn animation).
- **Screen fades exist only as spell effects.** `Renderer::ScreenFade(color, t)` fills the **3D
  viewport only** (x 8…468, y 8…352 — *not* the HUD) with a coloured quad. The alpha curve is
  `a = 1 − (remaining/total)²`, further shaped so that above 0.9 it snaps back down
  (`a > 0.9 → a = 1 − (a−0.9)*10`), producing a **fast flash-in / slow-out pulse**. Used by
  Turn Undead, Armageddon, Prismatic Light and similar.
- **Armageddon** additionally tints the entire outdoor world **pure red `#FF0000`** for the duration
  (`GetActorTintColor` short-circuits to red while `armageddon_timer` is running) and shakes the view.
- **Death / game over** uses its own full-screen art (`UIGameOver.cpp`).

### 27. Damage, healing and spell feedback

**Portrait reaction system.** Each character face has **56 expression frames**
(`game_ui_player_faces[4][56]`, files `<facename>01`…`<facename>56`). The relevant ones for combat
(`PortraitId` enum):

```
33 AVOID_DAMAGE      37 SMILE            46 SCARED (falling)
34 DMGRECVD_MINOR    38 WIDE_SMILE       40 CAST_SPELL
35 DMGRECVD_MODERATE 39 SAD              58 WAKE_UP
36 DMGRECVD_MAJOR
```

So the **"hit flash" is a portrait expression change, not a colour flash**: on taking damage the
portrait swaps to one of three wince frames scaled by damage severity, holds for the frame-table
duration, then returns to `PORTRAIT_NORMAL`. Casting swaps to `CAST_SPELL`. Condition states
(poisoned, diseased, paralysed, unconscious, petrified, dead, eradicated) replace the portrait
entirely — `DEAD` and `ERADCATE` are dedicated bitmaps. Talking is implemented by randomly
alternating frames 21–24 (mouth open wide / A / O).

**Damage numbers.** Off by default; `settings.show_damage` draws floating numeric damage over the
target in **smallnum** font.

**Party-wide feedback.** `SetPlayerBuffAnim` / `SetPartyBuffAnim` overlay an animated icon
(`ICONS.LOD` animation groups) **directly on top of the portrait at (portraitX, 385)** for the
duration of the icon animation — this is how a heal, a bless, or a disease visibly "lands" on a
specific party member.

**Spell effect rendering** — all spell visuals are **billboard sprites** from `SPRITES.LOD` named
`spellNN` (`spell01`…`spell99`, matching the 99 MM6 spells), drawn through the same billboard path as
monsters but with `BILLBOARD_LIT` (self-lit, immune to world dimming) and usually a `glowRadius` so
they cast a real mobile light on walls as they fly.

| effect | appearance |
|---|---|
| **Fire Bolt / Fireball** | a fast-spinning animated fireball sprite; on impact, an expanding multi-frame explosion sprite plus an `effpar01`-family particle burst; casts an orange mobile light along its path |
| **Flame Arrow / Sparks** | small streaking projectile sprites, several fired in a spread |
| **Lightning Bolt** | an instantaneous jagged white-blue bolt drawn as a chain of billboards along the ray, one frame, plus a bright flash |
| **Ice Bolt / Ice Blast** | pale blue crystalline projectile with a shattering impact animation |
| **Healing Touch / Power Cure** | a rising sparkle animation played **as an icon over the portrait**, not in the world |
| **Meteor Shower** | multiple fireball sprites spawned above and rained down with gravity |
| **Starburst / Implosion** | a large expanding radial sprite centred on the target |
| **Prismatic Light** | full-viewport quad using the `spell84` animation frames drawn via `DrawSpecialEffectsQuad` |
| **Turn Undead / Armageddon** | full-viewport `ScreenFade` pulse (see §26) |
| **Enchantment aura on items** | `sptext01` (red) / `sp28a` (blue) / `sp30a` (green) / `sp91a` (purple) blended over the inventory icon |

**Particles.** `ParticleEngine` supports `ParticleType_Bitmap | Diffuse | Line | Rotating | Ascending`;
particles are 24 × 24 units at unit scale (`±12`), can rotate, and are additively drawn. Used for
campfires (tinted `#FF3C1E`), smoke, spell trails, and the movement trail generator.

**Monster health bar.** Right-clicking / hovering a monster shows a bar above the status area built
from `mhp_bg` (background), `mhp_capl` / `mhp_capr` (end caps) and `mhp_grn` / `mhp_yel` / `mhp_red`
(fill), colour-coded by remaining fraction the same way the party HP bars are.

### 28. Weather

MM6's weather is minimal and almost entirely **fog** (§4).

- **Snow — yes, and it is MM6-exclusive.** OE's config literally reads
  `"Snow effect from MM6 (where it was activated by events)"`. Implementation
  (`src/Engine/Graphics/Weather.cpp`):
  - **1000 particles**, each a solid **white `#FFFFFF` axis-aligned filled rectangle** (not a sprite,
    not a texture) drawn in **2D screen space inside the 3D viewport only** (x 8…468, y 8…352).
  - Three size classes by particle index: indices **0–699 → 1 × 1 px** with horizontal jitter
    ±1 px/frame; **700–949 → 2 × 2 px**, jitter ±2; **950–999 → 4 × 4 px**, jitter ±5.
  - Fall speed per frame: `y += random(size) + size` → 1–2 px for the smallest, 2–4 for medium, 4–8 px
    for the largest. Larger = faster = reads as "closer". A crude but effective parallax.
  - Particles wrap: hitting the bottom respawns at the top at a random x; hitting a side edge is
    reflected inward by a random amount.
  - **Turning the camera scrolls the whole snowfield horizontally** by the yaw delta
    (`Weather::OnPlayerTurn(dangle)`, with wraparound), so the snow feels world-locked when you turn.
  - In vanilla it was triggered by map events; OE's stand-in condition is "every third day of months
    11, 0, 1" (i.e. winter).
- **Rain: none.** There is no rain particle system in the MM6/MM7 engine. (`Raining` / `Snowing` bits
  exist only in the **MM8** map-extra structure per MMExt.)
- **Foggy days** are the main weather variation: per map, a randomised roll each day picks
  none / light / medium / dense fog from the per-map probability table, which sets
  `fogWeakDistance` / `fogStrongDistance` as in §4.
- **Seasons** change terrain tilesets and tree/flower sprites (§6, §19) — the closest thing MM6 has to
  a visible weather cycle.

---

## Quick implementation checklist for Three.js

1. Render the world into a **461 × 345** offscreen target; composite it at (8, 8) under a 640 × 480 HUD
   overlay. Upscale the whole 640 × 480 composite with **nearest-neighbour** integer scaling.
2. Two cameras / two FOVs: **75° horizontal outdoors (59.73° vertical)**, **60° horizontal indoors
   (46.74° vertical)**, near 32, far 8192.
3. Terrain: 128 × 128 grid, 512 u cells, height = byte × 32, per-vertex, **flat/faceted shading, no
   smooth normals**, one 64 × 64 tile texture per cell, nearest filtering, no mipmap blending
   (or clamp to the same mip like the software renderer).
4. Lighting = **greyscale multiply only**. Quantise to 32 levels (`8 × (31 − dim)`) for the software
   look. One directional sun on the E–W great circle, plus point lights with the
   `30·d/r − 30` falloff. No coloured lights.
5. Distance haze = lerp toward the time-of-day grey (`#FFFFFF` noon → `#5F5F5F` dawn/dusk →
   `#272727` night), starting at `fogWeakDistance`, saturating at `fogStrongDistance`, capped at
   84.7 % on geometry and 97.3 % on the sky.
6. Sky = one screen-space quad from the top of the viewport to the projected horizon, textured through
   an inverse-perspective plane mapping, with a time-driven UV drift and a 39-px fade band at the
   horizon over a solid haze fill below it.
7. Sprites: `THREE.Sprite`-style billboards, **bottom-anchored**, world height = `pixels × scale`,
   8-octant frame selection with horizontal mirroring for octants 5–7, **8 fps** animation on a
   31.25 ms grid, **nearest** filtering, **1-bit alpha**, **no shadows**, **depth test and depth write
   off** with strict back-to-front sorting, tinted by the same grey multiply as the world.
8. UI: everything on the 640 × 480 integer grid at the exact coordinates in §20–§22; two-colour glyph
   atlas so the baked text shadow is recolourable; gold `#E1CD23` for hover text.
