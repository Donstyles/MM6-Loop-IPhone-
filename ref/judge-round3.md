# Independent visual judgement — MM6 imitation, round 3

Judge: independent reviewer, no stake in this codebase. Verdicts are on the pixels only.

---

## Recollection

*(Written from memory before opening any candidate image.)*

**Frame and layout.** 640×480, 8-bit indexed, DirectDraw. Heavy carved chrome on all four
sides; the 3D window is inset in the **top-left**, roughly 461×345 at (8, 8) — not centred.
A 172-px-wide right panel runs the full height, a 128-px-tall bottom bar runs the full width.
The right panel carries, top to bottom: the automap in a rounded aperture, zoom + / − buttons
with the compass ribbon between them, two hireling portrait slots, two rows of small animated
party-buff icons, the food and gold readouts, and at the very bottom five overlapping book-spine
tabs (Quests / Autonotes / Maps / Calendar / History). The bottom bar carries a status text line
under the viewport, then the four party portraits with a thin vertical HP tube on the left of
each and an SP tube on the right, and a cluster of four square painted buttons at bottom-right
(Cast, Rest, Quick Reference, Options).

**Chrome material.** Hand-painted warm grey-brown carved stone with brass fittings, irregular
blotching, dirt, non-uniform bevel highlights, rivets and ornamental bosses. Nothing about it is
computed — no uniform 1-px light/dark bevels, no CSS-like rounded rectangles.

**Portraits.** Four painted 3/4 faces, ~63×73, strongly distinct from one another, with 56
expression frames. Chunky airbrush shading, saturated skin, real hair and clothing. Selected
character gets a bright frame ring.

**Outdoor terrain.** 128×128 tile heightfield, 512 units per cell, height quantised to 32-unit
steps, **per-vertex, flat-shaded, no smoothing** — MM6 terrain visibly stair-steps and facets.
64×64 hand-painted terrain tiles, low contrast, narrow value band so the 32-step grey multiply
can darken them without crushing. Grass sits in a tight olive band; you cannot pick out
individual patches from eye height. Nearest-neighbour magnification, chunky texels up close.
Transition tiles between tilesets — grass never meets dirt at a hard polygon edge.

**Buildings.** Low-poly boxes, 6–40 faces, pitched roofs. Every wall texture has architectural
structure baked in: brick courses, ashlar joints, plank seams, half-timber crossing beams,
scalloped roof tile rows. Windows and doors are usually painted into the texture.

**Sky and horizon.** Not a dome, not a gradient. A single screen-space quad running from the top
of the viewport to the projected horizon, texture-mapped through an inverse-perspective plane so
the clouds **converge and compress toward the horizon and stretch overhead**. Fully covered with
cloud — the sky is never empty. Drifts on its own. A ~39-px haze fade band sits on the horizon
with a solid haze fill below it. Night is the same cloud texture multiplied down to ≈#272727 —
no stars, no moon, no sun disc anywhere in the game.

**Lighting.** Greyscale multiply only, quantised to 32 steps → visible banding. Distance haze and
time-of-day are the same grey multiply, so objects fade toward **grey/black**, never toward white.
Terrain, buildings and sprites all share one tonal treatment. Dungeons are near-black away from
lights; torches produce a small bright pool with a hard linear falloff on the wall texels.
No coloured lights in MM6 at all.

**Sprites.** Everything organic is a billboard, pre-rendered from a 3D model at 8 fixed azimuths,
palettised to 256 colours, ~8 fps stop-motion. Smooth-shaded, no outline, key light baked in from
the upper-front-left so the sprite lighting does **not** follow the sun. 1-bit alpha, jagged
unfeathered edges. Bottom-anchored, no shadows of any kind. A humanoid is ~192 world units, i.e.
party height; a tree overtops the viewport at close range.

**Fonts.** Bitmap `.fnt` faces, **two indices only — text and a baked 1-px shadow, no
anti-aliasing.** Lucida (proportional serif, ~11–12 px) for body, Arrus (serif display) for
headers, Smallnum for counters. Gold #E1CD23 for the hovered/clickable line, white default,
#00E100 green for buffed, #FF2300 scarlet for debuffed.

**Full-screen panels.** All at (8, 8), 461×345, replacing the viewport while the right panel and
bottom bar stay live. Character sheet on painted parchment, paperdoll on the right **of the
sheet**, four tabs plus Exit at y=316. Inventory is a 14×9 grid of 32×32 cells over painted panel
art with the paperdoll wearing composited equipment sprites. Spellbook is a two-page open book,
9 schools × 11 spells, illustrated spell icons on a hand-authored layout, nine painted bookmark
tabs down the right. Quest log / notes / calendar / map all share the same book frame; the map
book shows a drawn top-down map with roads, water and building footprints. Shops replace the
right panel with the dialogue panel (portrait at (521,38), white option lines going gold on
hover, Exit at (471,445)) and show a **fully painted interior illustration** in the 461×345 area.
Message boxes are a painted 9-slice carved-wood frame — never a flat black box.

**Overall feel.** Painted, warm, slightly muddy, low contrast, limited palette, no anti-aliasing
anywhere, no soft alpha, no radial glows. The 3D is blocky and poor; the 2D art is competent and
tonally unified with it.

**Where I disagree with `mm6-visual-spec.md`:** none materially. I would have said MM6 dithers
more than the spec claims; the spec is right that the software renderer swaps darkened palettes
rather than dithering, and my recollection of "heavy dithering" is mostly the artists' own
hand-dithering inside the painted bitmaps, not a runtime effect. I'll defer to the spec.

---

## Per-image verdicts

### 01-title.png
- **Genuine MM6? NO**
- Tells: The subtitle **"The Mandate of Heaven" is missing entirely** — the real title art is a
  single ornate gold logo lockup that always carries it. The wordmark here is a blocky
  monoweight pixel display face with a flat 3-px offset shadow; MM6's is a beveled calligraphic
  gold logo with a decorative flourish. The whole background is **ordered 50 % checkerboard
  dither** across every gradient (sky bands, hills, castle stone) — MM6's title is an airbrushed
  painting with no regular dither lattice anywhere. The castle is bilaterally symmetric, built
  from axis-aligned rectangles, with three identical towers and identical red pennants. Menu is
  "New Game / Load Game / Options / Credits / Quit"; MM6's is "New Game / Load Game / Credits /
  Exit" in Arrus with ornamental torches. 147 unique colours — plausible for 8-bit, but the
  colour *usage* (flat banded blocks) is a 2010s pixel-art idiom, not 1998 airbrush.

### 02-chargen.png
- **Genuine MM6? NO**
- Tells: Panel backgrounds are **near-black with a fine green dot lattice** and 1-px olive/gold
  hairline borders. MM6's creation screen sits on the mottled tan leather/parchment `ibground`
  (≈#9A8460) with painted inset panels — it is never black, and it never uses hairline strokes.
  The stat rows have flat gold rounded-square ▲/▼ buttons; MM6's are painted arrows. The class
  description text is grey-on-black at maybe 2:1 contrast — unreadable at 640×480. The right
  panel shows five flat gold rectangles at the *top* where the automap belongs. The four faces
  at the bottom are low-detail smudges, two of which are the same face recoloured.

### 03-outdoor-morning.png
- **Genuine MM6? NO**
- Tells: **The sky is empty.** I sampled the sky band: five colours, luminance σ = 5.6 — it is
  effectively two flat fills. MM6's sky is a fully-covered cloud plane whose texels converge to
  the horizon. **Distance haze fades toward near-white**, so the far treeline is brighter than the
  near geometry; MM6 fades toward grey/black by grey multiply, and haze can never raise luminance.
  Tree canopies are bright saturated green blobs speckled with **near-white confetti holes** at
  random — reads as noise, not foliage; MM6 trees are dark, dense, and pre-rendered smooth-shaded.
  Trunks are untapered pale cylinders with no bark. Ground is random axis-aligned rectangles of
  brown and grey at three scales with no repeating motif — procedural, not a 64×64 painted tile.
  Grass meets dirt at a hard triangle edge with no transition tile. The terrain surface is
  **smoothly curved with no facet breaks and no 32-unit stair-stepping**.
  HUD: buff-icon area is a solid brown drawer of 14 embossed plaques instead of 14 animated
  icons; a red gem sits above each portrait (nothing in MM6 does this); the four bottom-right
  button icons are flat-vector stickers.

### 04-outdoor-noon.png
- **Genuine MM6? NO**
- Tells: The building wall is a **structureless off-white with 1–2-px random speckle** — no
  courses, no plaster panels, no half-timber, no plinth, no quoins. MM6 has no such texture;
  every exterior surface carries a painted architectural pattern. The roof is the same grey as
  the wall — MM6 roofs are always distinctly red tile or blue slate. Silhouette is a bare prism:
  no eaves overhang, no ridge, no chimney. Sky still empty. The fogged shapes at far left read as
  white cotton wads.

### 05-outdoor-looking-down.png
- **Genuine MM6? NO**
- Tells: One isolated soft cloud with a **halftone-dot alpha edge** floats on an otherwise empty
  sky, and it shows **zero perspective convergence** — it is a 2D decal, whereas MM6's sky is
  perspective-mapped and everything in it compresses toward the horizon. Wall texture is the same
  structureless speckle, now magnified enough to show it is fractal noise with vertical smears.
  Pitch also appears to be looking *up*, past the ±22.5° clamp region I'd expect.

### 06-outdoor-walk.png
- **Genuine MM6? NO** — but the closest of the outdoor set.
- Tells: Good: castellated ashlar wall with per-block value jitter, a half-timber building with a
  red-tile roof. Bad: **the grass texture is camouflage.** I sampled it — the palette band
  (#2A481C…#668F3B) is actually right, but the *spatial* character is wrong: 8–16-px axis-aligned
  rectangles of four distinct greens plus brown, with only 17 % of adjacent native texels
  differing by more than 10. MM6's grass is a 3–5-px speckle that reads almost flat from eye
  height; this reads as discrete patches you can count from across the room. The hill is a
  **smooth Bezier mound** — no triangle facets, no stair-steps, no shading break at any cell
  boundary. Sky is a thin blue with one wispy streak and **no haze band at the horizon**.

### 07-outdoor-dusk.png
- **Genuine MM6? NO**
- Tells: The grey multiply itself is plausible per the spec. But the red roof at right stays at
  near-noon saturation while everything around it drops two stops — the tint is not applied
  uniformly. The pale objects at bottom-left stay bright. No warm horizon band, no haze fill.

### 08-outdoor-night.png
- **Genuine MM6? NO**
- Tells: **The distance-fogged objects at bottom-left are still light grey at midnight.** This is
  the clearest single proof that the haze is an additive white blend independent of the
  time-of-day curve; in MM6 fog colour at night is #1F1F1F and everything converges to it.
  Everything else crushes to a flat near-black with the 32-step banding gone — MM6 would still
  show discrete brightness plateaus on the wall blocks. No party torchlight radius on the ground.

### 09-outdoor-dawn.png
- **Genuine MM6? NO** — same defects as 07.

### 10-combat.png
- **Genuine MM6? NO**
- Tells: The status line reads "Goblin" and **there is no goblin in the frame.** The camera is
  jammed into a building corner. The two visible faces of the corner are at essentially the same
  luminance — no N·L differentiation on a 90° corner, which is impossible with a directional sun.
  The wall's per-pixel speckle is fully exposed at this magnification and is plainly value noise.

### 11-combat-attack.png
- **Genuine MM6? NO** — identical frame to 10 plus a blue dot on the minimap. No attack visual,
  no projectile, no impact sprite, no monster.

### 12-combat-turnbased.png
- **Genuine MM6? NO**
- Tells: The turn-based overlay is at roughly (400, 292) — close to the vanilla (394, 288) — but
  it is a brass **clock face with a needle**, generic. MM6 draws `turn0`…`turn5`, a hand/clock
  showing remaining action points, and an hourglass on the monsters' turn. Still no monster.
  Across three combat screenshots, **not one billboard sprite is visible** — the single most
  defining visual element of MM6 is entirely unrepresented.

### 13-charsheet.png
- **Genuine MM6? NO**
- Tells: **The paperdoll is drawn in the 172-px right panel, replacing the automap.** In MM6 it
  lives on the right *of the 461×345 sheet*, and the right panel stays live. The paperdoll figure
  is a **flat mannequin built from solid-colour rectangles** — tan arm blocks, an olive torso
  slab, a grey cape trapezoid, a black hair rectangle — with no shading, no anatomy, no painted
  equipment layers. It sits on a visible checkerboard-transparency rectangle. This is the worst
  asset in the set by a wide margin. The five tabs are flat rounded rectangles with 1-px gold
  strokes and a linear gradient — modern UI, not `ib-cd1-d`-style carved tabs.
  Text: the body face is a **monoweight slab with anti-aliased grey edge pixels and no drop
  shadow.** MM6 glyphs are strictly two indices (text + baked 1-px shadow), never anti-aliased,
  and always shadowed. "Good" is #4A9E4A; the engine's positive green is #00E100.
  Content: resistances listed as Fire/Air/Water/Earth/Mind/Body/Magic is an MM7 list; MM6's is
  Fire/Elec/Cold/Poison/Magic. Base values in parentheses "5 (5)" is not the MM6 presentation.

### 14-inventory.png
- **Genuine MM6? NO**
- Tells: Grid geometry is right — 14 × 9 cells at 32 px, top-left ≈(19,17). But the field is a
  **flat #7D7440 olive with 1-px darker rules and no background art at all**; MM6's `fr_inven`
  shows painted panel material through the empty cells. Paperdoll still misplaced and still a
  block mannequin. No items, so item art is untestable.

### 15-spellbook.png
- **Genuine MM6? NO**
- Tells: Nine school tabs — correct count. But they are **flat rounded rectangles carrying modern
  flat-icon glyphs**: three stacked horizontal lines for Air, a chevron wave for Water, a stack
  for Earth, a spiral for Mind, a green plus for Body, an asterisk for Light, a crescent for
  Dark. This is a 2015 icon set. MM6's are painted bookmark tabs with illuminated symbols.
  The pages are blank cream with a thin double-rule and two ghost watermark triangles; MM6 pages
  carry illustrated spell icons on a hand-authored layout and school-tinted decorative borders.
  The two learned spells are unreadable abstract shapes (a dark octagon, a red diamond) with
  orange scratches. The gutter is a flat brown bar with an ordered-dither strip instead of a
  painted leather spine.

### 16-questlog.png
- **Genuine MM6? NO** — structurally the closest panel in the set.
- Tells: Two-page book, gutter, four sub-page tabs, scrollbar, correct New Sorpigal quest content.
  But the sub-page tabs are featureless coloured rectangles with a single dot; the scrollbar is a
  flat brown rounded bar; the gutter is an ordered-dither seam; text is the same anti-aliased,
  unshadowed monoweight slab. No painted page edges, no page curl, no illuminated capitals.

### 17-mapscreen.png
- **Genuine MM6? NO** — the worst panel in the set.
- Tells: The map is **four flat green rectangles of slightly different green**, a yellow arrow and
  a compass rose. No roads, no water, no coastline, no building footprints, no fog-of-war edge,
  no labels. MM6's map book is a drawn top-down map on the `sbmap` page. This reads as a debug
  render. The compass rose is a modern four-point star with a serif "N".

### 18-quickref.png
- **Genuine MM6? NO**
- Tells: Structure and content are right (four columns, correct stat list, damaged HP in red).
  Same font defects. The Exit button carries a **soft blurred drop shadow** — a blur kernel,
  impossible in an 8-bit 1998 UI, which only has hard 1-px bevels. Gold headings carry a soft
  outer glow for the same reason.

### 19-rest.png
- **Genuine MM6? NO**
- Tells: The window shows a **children's-book vector sky**: flat pale blue, three white lozenge
  clouds with soft edges, and a **bright yellow sun disc with a smooth radial glow halo.** MM6
  has no sun disc anywhere in the game, and a smooth radial alpha gradient cannot exist in an
  8-bit indexed frame. The wall is vertical-stripe noise that reads as corduroy or rain, not
  stone. The campfire is a symmetric vector flame with a radial glow; the hourglass is a flat
  trapezoid outline. Buttons are flat grey rounded rectangles with dark-grey labels at roughly
  1.8:1 contrast — "Rest & Heal 8 Hours" is barely legible. Two bedrolls at the bottom corners
  are half-ellipses clipped by the panel edge.

### 20-shop.png
- **Genuine MM6? NO**
- Tells: The right-panel dialogue layout is close to vanilla (portrait ≈(518,32), NPC name in
  #1F8FE9 ≈ EasternBlue, white options stepping 30 px from y≈159). But the vanilla **Exit button
  at (471,445) is absent** — the standard HUD buttons and book tabs are still showing underneath.
  The shop interior is not painted: the floor is a flat brown perspective gradient with radial
  streaks, the rug is a flat red ellipse with a tan inner ellipse, the wall light pools are
  **smooth radial gradients**, and the weapons on the rack are outline icons — a bow is a brown
  arc plus a white line, a sword is a grey rectangle with a yellow crossbar. The armour stand is
  a stick figure of brown rectangles with white blob hands. MM6's shop backgrounds are fully
  painted 461×345 illustrations.

### 21-dialogue.png
- **Genuine MM6? NO**
- Tells: Flat-vector interior. Window is a white/blue pane with two diagonal "shine" streaks — a
  cartoon cliché. Fireplace is a grey trapezoid with a black rectangle and symmetric vector
  flames. Floor is a smooth brown gradient with radial streaks. Wall light pools are smooth
  radial alpha. Crate and barrel are unshaded brown rectangles. Nothing in the frame is painted.

### 22-temple.png
- **Genuine MM6? NO**
- Tells: The priest is the same **flat-rectangle mannequin** — a grey robot with a disc head. The
  light shaft on the floor is a smooth alpha gradient. The rose window is four flat colour
  wedges. And the party-status overlay is a **pure-black rounded-rect panel with a 1-px white
  dotted border** — MM6 message boxes are a painted 9-slice carved-wood frame (#3E2E1E body,
  #8A6E46 bevel); a black box with a dotted stroke is the most overtly modern element in the set.
  Content nit: New Sorpigal's temple is the Temple of the Sun, not "The Sky".

### 23-tavern.png
- **Genuine MM6? NO** — best-composed interior, still fails.
- Tells: Seven identical **rectangle mannequins** stand around the room as patrons. Tables are
  flat brown ellipses. Hanging lanterns emit visible circular alpha-gradient discs. The bottle
  shelf is a row of identical two-tone triangles. Half-timber ceiling and brick back wall are the
  only competently-drawn elements.

### 24-options.png
- **Genuine MM6? NO**
- Tells: Six flat grey-green rectangles with 1-px light strokes and gold labels carrying a **soft
  outer glow.** MM6's menu buttons are painted 214×40 plaques with a carved recess and a hard
  shadow. Background is uniform mottled grey noise instead of the painted `options` art.
  Button set (New/Save/Load, Controls/Quit/Return) is close to vanilla.

### 25-dungeon.png
- **Genuine MM6? NO** — the strongest frame in the set.
- Tells: Minimap is exactly right in kind — navy field with blue wall lines and a white party
  arrow — though the lines are ~4 px thick and the corridor interior is filled, where MM6 draws
  thin unfilled outlines. In the world: **the torch casts no light.** The wall immediately behind
  and beside the flame is at exactly the same value as wall three metres away. MM6's point lights
  use a `30·d/r − 30` linear falloff and would burn an obvious bright pool into the wall texels.
  The whole corridor is at one flat brightness that then cuts abruptly to black at the far door —
  there is no distance ramp and no party torchlight radius. The flame itself is a single flat
  cream teardrop with a hard edge and no orange core. The floor is ≈#9A9A9A against ≈#6A6A6A
  walls, which reads as lit from below. The corridor is a bare rectangular tube — no pilasters,
  arches, alcoves, doors or ceiling-height change. **No sprites at all**: no decorations, no
  items, no monsters.

### 26-dungeon-walk.png
- **Genuine MM6? NO** — same defects. The ceiling reads well. Lighting is still uniform along the
  entire corridor with a hard cut to black.

### 27-dungeon-look.png
- **Genuine MM6? NO**
- Tells: At this magnification the wall texture resolves as **generated noise**: block edges wobble,
  mortar is a brown smear, and dark blotches land at random. Hand-painted MM6 masonry has
  consistent course heights and deliberate chipping. The floor is much brighter than the walls
  again, inverting the expected dungeon tonal relationship.

### 28-guild.png
- **Genuine MM6? NO**
- Tells: The guildmaster is another rectangle mannequin. The magic circle is two flat orange
  ellipses, a diamond and a dotted ring. The eleven spellbook props on the shelves are perfectly
  identical, axis-aligned and evenly spaced — an item grid pasted onto a wall. The status strip
  ("Guild of Fire" / "Not a member") is a **black bar with a checkerboard dither drawn inside the
  3D viewport**; that information belongs in the status line at y=357.

---

## Ranked defects

1. **[FATAL] Sprites — there are none.** No monster billboard appears in any of the 28 frames,
   including three shots explicitly labelled combat. No trees-as-sprites with correct octant
   behaviour, no ground items, no decorations, no spell effects. The one thing that most defines
   an MM6 screenshot is absent. *Should be:* 8-octant pre-rendered billboards, bottom-anchored,
   world height = spriteHeightPx × scale (~192 u for a humanoid), 1-bit alpha with jagged edges,
   8 fps, no shadows, tinted by the same grey multiply as the world.

2. **[FATAL] Every human figure is a flat rectangle mannequin.** The inventory/charsheet
   paperdoll, the shop armour stand, the temple priest, the tavern patrons and the guildmaster
   are all built from solid-colour axis-aligned blocks with no shading or anatomy. *Should be:*
   painted composited paperdoll art on the sheet; painted still-life figures (or no figures at
   all) in shop illustrations.

3. **[FATAL] The sky is empty.** Sampled: five colours across the sky band, luminance σ = 5.6.
   Where a cloud exists it is an isolated 2D decal with no perspective convergence. *Should be:*
   a screen-space quad from the top of the viewport to the projected horizon, texture-mapped
   through an inverse-perspective plane so clouds compress toward the horizon and stretch
   overhead, drifting on its own, plus a 39-px haze fade band and a solid haze fill below.

4. **[FATAL] Distance haze lightens and ignores time of day.** Fogged geometry brightens toward
   white and stays light at midnight (08-outdoor-night, bottom left). *Should be:* haze and
   time-of-day are one grey multiply — #FFFFFF at 13:00, #5F5F5F at dawn/dusk, #272727 at night;
   objects fade toward grey/black and can never gain luminance.

5. **[FATAL] Modern flat-vector icons throughout.** A **gear** for options, a Material-style
   purple sparkle for Cast, a cartoon campfire for Rest, and nine flat pictogram glyphs on the
   spellbook school tabs (three lines = air, chevrons = water, spiral = mind, asterisk = light).
   All drawn with a 1-px black sticker outline. *Should be:* painted brass/bone relief plates
   (`ib-m1d`…`ib-m4d`) and painted illuminated bookmark tabs. A gear icon for settings postdates
   the game by a decade.

6. **[MAJOR] Terrain has no facets.** Outdoor ground is a smooth curved surface with no triangle
   edges, no shading breaks at cell boundaries, and no 32-unit vertical stair-stepping.
   *Should be:* a 128×128 grid of 512-u cells, height = byte × 32, per-vertex, flat-shaded, with
   the faceting plainly visible on any slope.

7. **[MAJOR] Wall and terrain textures are procedural noise, not painted art.** The plaster
   building is structureless off-white with random 1–2-px speckle; the dungeon masonry has
   wobbling block edges and smeared mortar; the road/dirt is random rectangles at three scales.
   Only the ashlar town wall reads as designed. *Should be:* every family carries explicit
   structure — 8-px brick courses at 128 px, 10–14-px plank widths, half-timber beams baked into
   the plaster panel, 6-px roof-tile rows.

8. **[MAJOR] Grass reads as camouflage.** The palette band is correct (#2A481C…#668F3B) but the
   spatial scale is not: 8–16-px axis-aligned patches of four distinct greens plus brown, with
   only 17 % of adjacent native texels differing by more than 10. *Should be:* a 3–5-px blade
   speckle with mottling at ~16 px that reads almost flat from eye height, and a visible 64×64
   tile repeat marching to the horizon.

9. **[MAJOR] Dungeon torches cast no light and the corridor has no brightness ramp.** Wall
   luminance is uniform from the party's feet to the far door, then cuts to black. *Should be:*
   `lightlevel += 30·d/r − 30` per light, clamped to 0…31, quantised to 32 grey steps, with a
   party torchlight radius of 800 u per power level and visible banded pools around each flame.

10. **[MAJOR] Fonts are anti-aliased, monoweight and unshadowed.** Grey intermediate pixels are
    present on glyph edges throughout the panels, and body text on parchment has no drop shadow
    at all. *Should be:* `.fnt` glyphs with exactly two indices — text and a baked 1-px shadow —
    a proportional Lucida-family serif with real stroke contrast for body, Arrus for headers.
    Also: the status line is light-on-dark here; vanilla is dark #0A0000 text with a pale
    #E6D6C1 shadow, which reads engraved into the stone bar.

11. **[MAJOR] Soft alpha gradients and blur everywhere.** Radial glows around lanterns, the shop
    wall light pool, the rest-screen sun halo, the temple light shaft, the blurred drop shadow
    under the Exit button, the soft outer glow on gold headings. *Should be:* nothing softer than
    a hard-edged palette step. None of these can exist in an 8-bit indexed 640×480 frame. Frame
    colour counts (286–343 unique) also exceed a 256-entry palette.

12. **[MAJOR] Map book is four flat green rectangles.** No roads, water, coastline, building
    footprints or labels. *Should be:* a drawn top-down map on the `sbmap` book page at
    zoom ∈ {384, 768, 1536}, panning in 512-u steps.

13. **[MAJOR] Interiors are flat-vector illustrations.** Ellipse rugs, trapezoid fireplaces,
    two-streak window "shine", gradient floors, outline weapons. *Should be:* fully painted
    461×345 shop illustrations in the same tonal family as the rest of the art.

14. **[MAJOR] Black rounded-rect overlay panels with dotted borders** (temple party table, guild
    status strip). *Should be:* the painted 9-slice message frame — `cornr_*` / `edge_*`, carved
    wood #3E2E1E with a #8A6E46 bevel — or the status line at y=357.

15. **[MINOR] Party portraits are procedurally-varied smudges.** Four heads with the same skull
    shape, same shoulder line, same nose and mouth; #1 and #2 are one face recoloured. Also a red
    gem sits above every portrait, which corresponds to nothing in MM6. *Should be:* four
    strongly distinct painted 63×73 faces with 56 expression frames, and the ready markers
    `IB-InitG/Y/R` at (portraitX−4, 384).

16. **[MINOR] Right panel loses the automap when the character sheet opens** because the paperdoll
    is drawn there. *Should be:* the paperdoll on the right side of the 461×345 sheet; the right
    panel stays live behind every full-screen panel.

17. **[MINOR] Empty HP/SP bar slot is #4B443B**, too light to read as a recess. *Should be:*
    ≈#2A2620, near-black warm grey with nothing drawn in it.

18. **[MINOR] Viewport rect is off.** Measured world content spans x ≈ 14…466, y ≈ 10…351 —
    about 454 × 342 with an asymmetric inner rule (1 px of gold on the left, a 7-px gold band on
    the right). *Should be:* exactly x 8…468, y 8…352 → 461 × 345, symmetric.

19. **[MINOR] Buff-icon area is a solid brown drawer of 14 embossed plaques.** *Should be:*
    14 animated 16×8-atlas icons on two rows at y = 247 / 279, phase-offset so they shimmer out
    of sync.

20. **[MINOR] Shop dialogue is missing the Exit button** at (471, 445) 169 × 35; the standard HUD
    buttons remain visible instead.

21. **[MINOR] Content slips.** "The Mandate of Heaven" missing from the title; MM7-style
    resistance list (Fire/Air/Water/Earth/Mind/Body/Magic) on the character sheet; "Temple of The
    Sky" rather than the Sun; turn-based overlay is a clock face rather than the hand/AP display.

---

### What is genuinely right, for the record

The HUD **geometry** is measurably faithful and clearly built from the spec: bottom bar begins at
y = 352, right panel at x = 468, HP bars at x = 23/138/253/368 and SP at 217/332/447, all 5 × 49
at y = 402, with the Knight correctly having no SP bar. Colour constants match the engine table
exactly — HP green #28C828, SP blue #2848D8, HUD midtone #585046, NPC name #1F8FE9. The dungeon
minimap is the correct navy/blue wireframe. Panel structure is right: 9 spellbook schools (not
12), 14 × 9 inventory grid at 32 px, four charsheet tabs plus Exit, two-page quest book. Quest
content is accurate MM6.

The failure is entirely in the **art**, not the layout.

---

## Score

**Overall indistinguishability: 43/100**

The frame skeleton would pass. The contents would not survive a two-second glance from anyone who
has played the game: the sky, the mannequins, the vector icons and the missing sprites are all
visible at thumbnail size. 25-dungeon is the only frame that gets close, and its unlit torch gives
it away on inspection.

## Verdict

**NOT YET**
