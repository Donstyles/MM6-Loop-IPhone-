# Independent visual judgement — Round 4

Judge: independent reviewer. No involvement in the implementation. Verdict based
only on the 28 candidate images in `shots/judge4/` plus
`ref/mm6-visual-spec.md` used for hard numbers.

---

## Recollection

*(Written before opening any candidate image.)*

**Frame.** 640×480, 8-bit indexed VGA, software rasteriser, no filtering. Chunky
nearest-neighbour pixels; when a sprite gets close its texels become big hard
squares. Palette is 256 entries, heavily weighted to warm browns/olives/greys;
gradients show visible banding, not smooth ramps.

**Layout.** The 3D window is inset in a carved surround; the bottom ~120–130 px
is a solid HUD strip running the full width. The surround is a *painted* bevel:
warm grey stone with a gold/brass inner lip, a lit top-left edge and a shadowed
bottom-right edge, plus decorative corner pieces. It reads as material, with
paint texture in it, not as CSS boxes.

**Party bar.** Four portraits side by side. Each is a hand-painted
head-and-shoulders bust, ~60×70, in its own recessed frame. Beside each: a red
HP bar and a blue SP bar, thin, in a dark socket. Portraits change expression. To
the right: a circular brass compass and a cluster of small square buttons (rest,
quick ref, options, spellbook, map). The bottom strip is the busiest painted
region of the screen.

**Outdoor terrain.** Heightmapped tile grid; each tile is a 64×64 hand-painted
texture drawn as two triangles, so terrain is visibly faceted with tile-sized
quads and hard creases at ridges. Grass is a muted olive, low per-pixel contrast,
roughly #3E5A28–#6E8C3C; dirt tan; sand pale; snow near-white with blue shadow.
Textures are painted with legible tufts and speckles and tile obviously at 64 px.
Roads/dirt are painted tiles, not blended splats — the tile boundary shows.

**Sky and horizon.** Sky is a scrolling bitmap that pans with yaw and shifts with
pitch: a blue-to-pale vertical field with soft painted cloud bands. Hard,
dead-straight horizon line where sky meets terrain, plus a pale haze band at the
horizon and visible draw-distance popping. No 3D dome parallax.

**Buildings.** Simple low-poly boxes and prisms — rectangular body, pitched or
hipped roof, a few dozen polys, plaster/timber/stone wall families and red or
grey shingle roofs. Windows and doors mostly painted into the wall texture.
Proportions chunky, slightly oversized relative to the party.

**Lighting.** Flat per-face lighting; each polygon takes one light level so
adjacent faces step in tone (banding at ~16–32 levels). Outdoors essentially
fully lit with a global time-of-day tint: day neutral/warm, dusk warm and darker,
night dark blue-grey with a small lit radius around the party. Sprites are shaded
by the same global light as the geometry, which is what makes them sit in the
world. Dungeons much darker: torch radius plus stationary lights, strong contrast
and obvious banded falloff.

**Sprites.** Monsters, trees, props, NPCs are all billboards. Monsters have 8
facings and a handful of frames — walk, attack, hit, die. Alpha is 1-bit colour
key, so edges are hard and slightly ragged; nothing is soft. Trees are large
single billboards that always face the camera and visibly swivel as you strafe.
Sprites use the same palette and tonal treatment as the world and are planted at
ground level so they don't float.

**Effects.** Spell effects are animated colour-keyed sprite sheets, bright
oranges/cyans, big painted glows made of hard pixels. No bloom, no blur, no alpha
gradients.

**Fonts.** Small bitmap fonts (Lucida/Arial-like, 10–12 px) rendered white, tan
or gold with a hard 1 px black drop shadow bottom-right. Interactive dialogue
keywords in a distinct saturated colour. Stat numbers colour coded: green =
enhanced, red = drained, white = normal. Text left-aligned in generous panels,
never centred-and-letterspaced like a modern UI.

**Full-screen panels.** All are full-screen *painted bitmaps*, not generated
boxes: character sheet (parchment ground, portrait top-left, two stat columns,
Stats/Skills/Awards tabs); inventory (paperdoll wearing the kit plus a ~14×9 grid
of 32 px cells, hand-painted item bitmaps at odd sizes); spellbook (open
two-page book, ornate painted art, school bookmark tabs down the edge,
illustrated spell icons); quest log (parchment); map (parchment ground, painted
top-down region outdoors, white wall lines on black indoors); shops/temples/
taverns/guilds (a *painted interior illustration* fills the left area, shopkeeper
text and option list on the right); NPC dialogue (large painted portrait left,
body text and clickable topics right); rest (painted scene with a clock and day
counter); options (carved stone menu).

**Feel.** Warm, low contrast, slightly muddy, dense with painted detail. Nothing
is pure black or pure white; nothing has a clean geometric gradient; nothing is
anti-aliased.

### Where the spec and my memory disagree

Two places, both minor and both resolved in the spec's favour:

- I remembered the 3D viewport as spanning nearly the full 640 width with only a
  bottom bar. The spec (OE `GameUI_DrawRightPanelFrames`) is right that there is
  also a **172 px right panel** (x 468–639) carrying the automap, compass,
  hirelings, buffs and book tabs. My memory had merged MM6 with the mouse-look
  mode.
- I remembered the compass as a rotating needle in a brass bezel. The spec is
  right that `IB-COMP` is a **~240 px panoramic ribbon** sliding behind a 26 px
  aperture. The candidates use a ribbon, which agrees with the spec, not with me.

I also want to flag one thing the spec understates: it says MM6 shows "no
dithering", which is correct, but it is worth stating positively — **MM6 shades
by swapping to one of 32 pre-darkened palettes, so tonal transitions are hard
bands of solid colour, never stipple.** Several candidates stipple.

---

## Per-image verdicts

### 01-title.png
- **Genuine MM6? NO**
- Tells: The entire image is a single procedural pixel-art routine. The sky is a
  stack of horizontal lozenges rendered with an explicit **ordered checkerboard
  dither** (I measured parity total-variation = 0.274 over the sky region, 66
  colours) — MM6 never dithers, it bands. The logo is a blocky slab-serif
  bitmap font with a flat offset shadow; the real MM6 wordmark is a painted
  metallic 3D logo with bevels, chisel highlights and a red/black outline. The
  menu is a centred five-item list in a letterspaced modern pixel face
  ("N e w   G a m e") with `•` bullets flanking the hover item; MM6's menu items
  are Lucida/Create-family serif on painted plaques. The castle is drawn from one
  brick stamp repeated on a perfect grid with identical yellow window rectangles;
  the trees are flat black silhouettes; the ground is a two-tone noise field.
  Nothing here is a painted asset.

### 02-chargen.png
- **Genuine MM6? NO**
- Tells: Three-column dark-panel layout with hairline gold borders and a 1 px
  stipple fill — a modern dark-mode UI, not MM6's painted stone/parchment
  creation screen. The portrait is the fatal element: a smooth airbrushed helmet
  and face with two dot eyes, sitting on a soft radial vignette; MM6's chargen
  portraits are detailed painted busts. The face-cycling control is a bare
  `< Face >` row. Body text is a mechanical pixel slab face, not Lucida serif.
  Credit: the bottom party bar and status line are geometrically right, and
  "Points: 25" green / gold headers are in the right colour family.

### 03-outdoor-morning.png
- **Genuine MM6? NO**
- Tells: **The sky is a single flat colour.** I sampled row y=30 across the
  viewport: 110 of 160 pixels are exactly #93A0AC, 6 unique colours total. MM6's
  sky is a heavily tiled cloud plane whose streaks converge at the horizon; there
  is no frame of MM6 with an empty sky. No haze band, no horizon fade.
  **Terrain is dead flat** — zero heightmap relief, so the ground reads as a
  plane, not a heightfield; there is no faceting and no per-face N·L variation
  anywhere on it. Grass is a large-blotch checkerboard: median horizontal run
  length 5 px, max 56 px, from a 21-colour set spanning #2B4A1D to #5F8A38
  (lum 60→133, a 2.2× ratio at 16–24 px block scale). That reads as camouflage,
  not ground cover. The tree at right is a smooth cartoon canopy on a straight
  tapering trunk. The stone wall is a perfect grid of identical blocks. Right
  panel: the automap is undifferentiated green mush (the terrain texture
  downsampled), and the 14 buff slots are drawn as filled brown boxes when they
  should be empty.
- Credit: viewport rect measures **exactly x 8…467, y 8…351** with the bottom bar
  starting at 352 and the right panel at 468 — spec-perfect. Status text is
  `#0A0000` (`colorTable.Diesel`) on a cream shadow — the exact engine value.

### 04-outdoor-noon.png
- **Genuine MM6? NO**
- Tells: The trees are the headline failure. They are **untextured low-poly 3D
  models rendered live**, not billboards: hexagonal-prism trunks in a pale sand
  #B5A183 with a few 8×16 dark rectangles for "bark", topped by a *separate*
  canopy mesh that floats detached from the fork. Trunk colour is bone/sand where
  MM6 bark is #3C2818–#5A4028. The canopies carry random near-white #E8F0E0
  specks that read as texture dropout. Trunk widths are wildly inconsistent at
  similar depth (the centre trunk is ~50 px wide at 1× vs ~12 px for its
  neighbour). No taper, no roots, no N·L shading on any trunk. Sky is again a
  flat #CFE2F2 (77 % of the sampled sky region is that one value).

### 05-outdoor-looking-down.png
- **Genuine MM6? NO**
- Tells: Same tree failure, now unmissable — canopy blobs sit with visible air
  gaps above their trunks. Horizon at frame right is a hard green/blue edge with
  **no haze band at all**; spec requires a 39 px fade band in the time-of-day
  grey. The sky's only structure is a smooth vertical gradient, which is the
  wrong kind of structure (MM6 gets its vertical variation from a cloud texture,
  not a ramp).

### 06-outdoor-walk.png
- **Genuine MM6? NO**
- Tells: The near "birch" trunks are near-white #E8E0D0 columns ~45 px wide at
  1× with grey tick marks. They read as marble pillars. They are the brightest
  objects in the frame — brighter than the sky's horizon — which is impossible in
  a forest and impossible under MM6's grey-multiply tint model. Both are
  canopy-less. The flower cluster is a flat vector blade shape. A background
  trunk draws over foreground grass (painter's-algorithm artefact reading as a
  bug rather than as MM6's authentic sprite/wall pop).

### 07-outdoor-dusk.png
- **Genuine MM6? NO**
- Tells: The tint mechanism is right (a neutral multiply, not a colour grade) and
  the value is close — mean viewport luminance 51.0 vs 114.2 at noon = 0.45,
  against the spec's #5F5F5F = 0.37. But the sky does not participate correctly:
  it stays a flat grey-blue with no cloud structure to darken, so there is
  nothing to sell the time change except the ground going dim. All the geometry
  and sprite defects from 04–06 persist.

### 08-outdoor-night.png
- **Genuine MM6? NO**
- Tells: Ratio 17.7/114.2 = 0.155 vs spec #272727 = 0.153 — the night value is
  essentially exact, which is good. But the night sky is a featureless dark slab.
  MM6's night sky is the *day cloud texture* multiplied down, so cloud shapes stay
  faintly legible; here there is nothing to multiply. No party torchlight pool on
  the nearby terrain. The pale birch trunks remain the visual focus at night.

### 09-outdoor-dawn.png
- **Genuine MM6? NO**
- Tells: Pixel-for-pixel the dusk frame at a slightly lower level (0.40 vs 0.45).
  Same defects.

### 10-combat.png
- **Genuine MM6? NO — the single most damning frame in the set**
- Tells: The goblin is an **untextured low-poly 3D model with smooth Gouraud
  shading**. You can see triangular shading gradients across the shoulders. It
  has one pointed ear (asymmetric geometry), one white eye slit, no mouth, no
  hands, no weapon, and no legs. Its palette is a five-step yellow-green ramp
  (#3D6127 → #8FAB4F). MM6 monsters are **pre-rendered, fully textured, 8-octant,
  1-bit-alpha billboards** from SPRITES.LOD with a baked upper-front-left key
  light. Nothing about this object is a 1998 sprite. The impact effect is a
  hard-edged 8-lobed star in a pure yellow-gold ramp (#C09E00, #D6B000, #EFD14D,
  white core) with **zero red** — MM6 fire particles are `#FF3C1E` OrangeyRed and
  the impact is a multi-frame explosion, not a "pow" star. The one cloud in the
  sky is a flat neutral #D9D9D9 blob with a soft feathered edge (alpha gradient —
  MM6 has none).

### 11-combat-attack.png
- **Genuine MM6? NO**
- Tells: The shaman is again an untextured low-poly model — a green head under a
  grey slab helm, khaki tabard, red loincloth rectangle, blocky right-angled
  limbs, wedge hands, a staff with a flat yellow orb. All surfaces are solid
  colours with a slight vertex gradient. Silhouette is illegible as a creature.
  Colours are pastel and washed out (#A8A89A / #9A9A6A / #C03030) where MM6's
  goblin family is saturated green over dark rags.

### 12-combat-turnbased.png
- **Genuine MM6? NO**
- Tells: The turn indicator is at ~(400, 310), against the spec's (394, 288) —
  close. But it is a perfectly circular brass disc with an anti-aliased rim and a
  smooth radial gradient, i.e. a modern vector icon; `turn0`…`turn5` are painted
  hand/clock sprites. Green "ready" gems sit at the apex of the portrait arches
  rather than at (portraitX−4, 384).

### 13-charsheet.png
- **Genuine MM6? NO**
- Tells: **The paperdoll is a wooden artist's lay figure** — turned cylinders for
  limbs, ball shoulders, a featureless slab helm with a horizontal slit, a
  barrel-stave cuirass fusing torso and skirt, an oval shield floating detached
  beside the body and a dagger hanging unheld in mid-air. MM6's paperdoll is a
  painted human body with skin tone, a defined pose, and equipment bitmaps that
  register to it. The doll's background carries a visible **halftone-dithered**
  vignette and an elliptical dithered drop shadow. Stat rows have no dotted
  leaders, so the sheet reads as a modern two-column table with big empty gutters.
  Body text is a mechanical pixel slab face at ~14 px, not Lucida serif at 11–12.
  Tabs are flat rounded buttons rather than painted `ib-cd*` folder tabs.
- Credit: tab x-positions (≈20/110/200/290 with Exit at 379) and y≈327 match the
  spec; HP shown red when below base and Condition green are the right colour
  semantics.

### 14-inventory.png
- **Genuine MM6? NO**
- Tells: 14 × 9 grid — correct count. But it is rendered as a hard 1 px black
  lattice over a flat olive #7D7448 field, with no `fr_inven` painted leather
  ground. It reads as a spreadsheet. Completely empty: no starting equipment, no
  item bitmaps at all, so the whole panel is a wireframe. The doll is in the right
  panel rather than on the sheet.

### 15-spellbook.png
- **Genuine MM6? NO**
- Tells: Nine school tabs — correct count — but they are **flat white vector
  glyphs on coloured rectangles** (a flame, a swirl, a droplet, a triangle, an
  ankh, an eye, a **heart**, a star, a crescent). That icon set belongs to a
  mobile game; MM6's tabs are painted leather bookmarks with school-tinted edges.
  The page carries a large mirrored flame **watermark duplicated identically on
  both leaves**, which instantly reads as a template. Only one spell icon is
  drawn on an 11-slot Fire page. The gutter is a thin strip of uniform brown
  noise. Exit is a rounded modern button.

### 16-questlog.png
- **Genuine MM6? NO — but the closest of the book panels**
- Tells: Body text is near-black and set solid with very tight leading; spec says
  book body is `#4B4B4B` Tundora with normal leading, and the face should be
  Lucida serif. Four sub-page buttons instead of six, each an abstract
  nested-rectangle glyph with a dot — no legible iconography. A plain brown
  scrollbar bar appears where MM6 uses up/down arrow buttons. The prose is
  visibly template-substituted ("Out past the New Sorpigal"; "Nothing has come
  out of Observatory of Forgotten Silence in a month, and things used to come out
  of Observatory of Forgotten Silence regularly") — not a pixel defect, but it is
  read instantly and it marks the screen as generated.

### 17-mapscreen.png
- **Genuine MM6? NO**
- Tells: This is a debug render of the tile grid, not a map. The ground is the
  same green blotch noise as the terrain texture, downsampled; buildings are
  plain brown rectangles; roads are a tan cross; the town wall is a 1 px outline
  rectangle. MM6's map book is a **parchment page** (`sbmap`) carrying a painted
  top-down illustration of the region with coastline, water, relief and labelled
  landmarks. No parchment ground here at all. Zoom controls are two bare `+`/`-`
  squares bottom-left instead of the page-margin buttons.

### 18-quickref.png
- **Genuine MM6? NO**
- Tells: Structurally the closest screen in the set, but: no character portraits
  at the column heads (MM6 puts them there), parchment ground instead of the
  mottled `ibground` tan leather, no dotted leaders on the rows, and the same
  wrong pixel-slab face throughout. Column headers are underlined with a hairline
  rule — a modern table convention.

### 19-rest.png
- **Genuine MM6? NO**
- Tells: Correct furniture (sky window, hourglass, four buttons) at roughly
  correct coordinates, wrong execution at every level. The window shows cartoon
  clouds — rounded white lozenges with dotted undersides — over sine-wave green
  hills on cyan. The campfire is a flat four-band vector flame on a ring of
  identical grey pebbles. The hourglass is two flat triangles. The floor is
  ruler-straight planks in a clean one-point perspective. MM6's `restmain` is a
  painted interior.

### 20-shop.png
- **Genuine MM6? NO**
- Tells: The "painted interior" is procedurally assembled: **five identical bow
  sprites at identical size and spacing on the top shelf**, then an alternating
  sword/bow repeat on the second. The weapons are flat vector shapes (a white
  blade rectangle with a gold crossbar; an arc plus a dotted string) with no
  shading. The smith is the wooden mannequin again. Perspective is inconsistent —
  the floor recedes to a vanishing point while the shelves and back wall are
  axis-aligned and the red carpet is drawn isometric. Dialogue options are
  **centred and roughly 2.5× too large**; spec puts them left-ish in 140 px
  buttons in Lucida with gold `#E1CD23` hover. No Exit button at (471, 445). The
  right panel is a plain brown rectangle with a hairline gold border instead of
  the `ib-mb` carved frame.
- Credit: proprietor portrait lands at ≈(517, 32) 70×80 against the spec's
  (521, 38) 63×73, and the NPC name is in Eastern Blue — both right.

### 21-dialogue.png
- **Genuine MM6? NO**
- Tells: MM6 renders house interiors as a static painting with the NPC present
  only as a portrait. Here a wooden mannequin stands in the room **with a soft
  elliptical drop shadow** — and the spec is explicit that MM6 draws no shadows
  of any kind. Two soft-edged light shafts are painted on the floor as alpha
  gradients. The window is a light-blue rectangle with two diagonal white
  "glint" streaks, a cartoon cliché. Fire in the grate is the same flat vector
  flame reused from rest/temple/tavern. Right panel body text is centred under a
  hairline rule with a diamond ornament — modern-UI signature; MM6 left-aligns.

### 22-temple.png
- **Genuine MM6? NO**
- Tells: The healing table is a **pure #000000 rectangle with a 1 px gold rule**
  floating over the scene. MM6 message boxes are built from a nine-slice carved
  wood frame (`cornr_*`/`edge_*`) over a darkened backing, and nothing in the MM6
  UI is pure black. The rose window is twelve fully-saturated primary segments
  around a yellow disc — the highest-chroma object in the entire set and utterly
  unlike MM6's muted stained glass. Candles are white sticks with teardrop
  flames; the altar is three flat grey slabs; the priest is the mannequin with an
  elliptical shadow.

### 23-tavern.png
- **Genuine MM6? NO — the most obviously synthetic interior**
- Tells: **Seven copies of the same wooden mannequin**, each with a soft
  elliptical shadow, standing at attention around three identical cloned tables
  with identical cloned mugs and plates, under identical cloned lanterns hanging
  on perfectly vertical lines. The ceiling is a repeating diagonal beam pattern.
  Nothing is hand-placed; nothing is painted. MM6 taverns are one illustration
  with characterful, varied patrons.

### 24-options.png
- **Genuine MM6? NO**
- Tells: Two columns of three buttons at approximately the right coordinates, but
  the panel ground is a flat olive-brown field with sparse dark splatter blobs
  that read as camouflage, and the top ~45 % of the panel is empty. Buttons are
  flat plates with a 2 px gold outline and a machine bevel. MM6's `options`
  background is a painted image and the buttons are painted plaques.

### 25-dungeon.png
- **Genuine MM6? NO — but the strongest world frame**
- Tells: FOV visibly narrows indoors (correct). Minimap is navy with blue wall
  lines (correct concept) and measures **exactly 137 px wide starting at x=488** —
  spec-perfect — but the navy is `#000030`, roughly a quarter the brightness of
  the specified `#000078`, and the walkable area is drawn as a filled region
  rather than as wall outlines. The wall torch is a smooth-gradient yellow
  teardrop and, fatally, **casts no light on the masonry behind it** — spec says
  glow-radius sprites add a real mobile light. Falloff into the corridor is a
  smooth continuous ramp with no quantisation; MM6 shades in 32 hard steps of 8.
  Masonry blocks are enormous (~130×60 px on screen one tile away) and the mould
  is applied as large soft-edged stains. The floor plane shows no falloff toward
  the party at all.

### 26-dungeon-walk.png
- **Genuine MM6? NO**
- Tells: A perfectly uniform rectangular tube — no doors, alcoves, side passages,
  chests, rubble or decorations anywhere. MM6 corridors are never empty. Wall
  texture repeats visibly every ~2 blocks. The distant torch has a stray blue
  pixel beside it. **The minimap is identical to 25-dungeon.png despite the party
  having moved** — the party arrow has not tracked.

### 27-dungeon-look.png
- **Genuine MM6? NO**
- Tells: Dead-end corner, entirely empty, no light source anywhere in frame yet
  uniformly dim rather than black. Wall is a running bond of near-identical
  blocks with large soft mould stains — texture-generator output. Floor slab
  scale and style do not match the wall's.

### 28-guild.png
- **Genuine MM6? NO**
- Tells: **Eleven identical orange spellbook icons** in a regular grid on the
  shelves, over rows of book spines that are literally a repeating red/blue/green
  stripe pattern. The magic circle is two concentric orange ellipses with dots
  plus a floating orange diamond, drawn in thin 1 px lines — a modern motif with
  no MM6 antecedent. The floor is a radial sunburst of grey wedges in a different
  projection from everything else in the room. The bottom strip is a black
  checkerboard-dithered band with orange/red text floating over the scene.

---

## Ranked defects

1. **[FATAL] Sprites — monsters and trees are untextured low-poly 3D models
   rendered live, not billboards.** Visible triangular Gouraud gradients on the
   goblin's shoulders (10-combat); hexagonal-prism trunks with detached canopy
   meshes (04/05/06); solid-colour limbs with right-angle joints (11). MM6's
   monsters, trees, NPCs and props are *pre-rendered from 3D into 8 fixed
   azimuths, fully textured, palettised to 256 colours, keyed on index 0 with
   1-bit alpha, and drawn as bottom-anchored screen-space billboards with depth
   test and write off*. The baked key light comes from upper-front-left and does
   **not** rotate with the world sun. Nothing in this build's world sprites obeys
   any of that. This alone identifies every world frame in under a second.

2. **[FATAL] Sky is a flat untextured colour.** Measured: 04-outdoor-noon sky
   region is 77 % a single #CFE2F2; 03-outdoor-morning row y=30 is 110/160 pixels
   of a single #93A0AC, 6 unique colours. MM6 draws the sky as a screen-space
   quad textured through an inverse-perspective *plane* mapping with a
   `plansky*` cloud bitmap, so clouds compress and streak into the horizon and
   drift at 1 texel/ms even when standing still. Add a 256×256 cloud texture, the
   plane mapping, and a 39 px haze fade band above the projected horizon over a
   solid haze fill below it.

3. **[FATAL] Interiors are populated with clone placeholder mannequins.** Seven
   identical wooden lay figures in the tavern, one in the shop, one in the
   dialogue room, one in the temple — each with a soft elliptical drop shadow.
   Two separate violations: MM6 house interiors are *single painted
   illustrations* with no live figures, and MM6 draws **no shadows at all**.
   Either paint the interiors or, at minimum, remove the figures and the shadows.

4. **[FATAL] Paperdoll is an artist's lay figure with floating equipment.**
   Turned-cylinder limbs, ball shoulders, no hands or feet, a shield detached to
   the side and a dagger hanging unheld. Should be a painted human body with skin
   tone in a fixed pose, with equipment bitmaps registered to named attachment
   points.

5. **[MAJOR] Outdoor terrain is dead flat with no relief and no faceting.** Every
   outdoor frame shows a planar ground. MM6 terrain is a 128×128 grid of 512-unit
   cells with per-vertex heights quantised to 32 units, flat-shaded per triangle —
   it visibly stair-steps and creases. Right now there is no geometric read on the
   ground whatsoever.

6. **[MAJOR] Grass texture is large-blotch camouflage, not fine speckle.**
   Measured median horizontal run length 5 px, max 56 px, 21 colours spanning
   #2B4A1D–#5F8A38 (luminance 60→133, 2.2× ratio across adjacent 16–24 px
   blocks). MM6's `grastyl` is a 64×64 tile of dense 3–5 px blade clusters inside
   a deliberately narrow ~25 % value band (#3E5A28–#6E8C3C) with only a slight
   16 px yellow-green mottle. Cut the block scale to 2–4 px and halve the
   luminance spread.

7. **[MAJOR] Character portraits are soft airbrushed mush.** Dot eyes, no hair
   strands, no collar or garment detail, a radial vignette glow behind the head.
   Geometry is right (63 px wide at x = 35/150/265/380, y = 388) — the art is not.
   MM6 ships 56 painted expression frames per face at that size and every one has
   legible features.

8. **[MAJOR] World frames exceed the 8-bit palette.** Measured unique RGB values
   per frame: outdoor 702–798, map screen 813, spellbook 701, options 675. MM6 is
   8-bit indexed *everywhere* — a real frame can never exceed 256. Notably the
   pre-baked UI screens (title 145, chargen 224, shop/dialogue/temple/tavern
   253–257, dungeon 278–286) do stay in budget, so the leak is entirely in the
   3D/procedural path. Quantise the composite to a 256-entry palette.

9. **[MAJOR] Lighting is continuous, not quantised.** The dungeon corridor falls
   off in a smooth ramp; the goblin has a smooth vertical gradient. MM6 shades by
   swapping to one of 32 pre-darkened palette copies: `8 × (31 − dim)` → levels
   0, 8, 16 … 248. Snap all lighting to that ladder and the banding will do a lot
   of era work for free.

10. **[MAJOR] Fonts are wrong across every screen.** A mechanical pixel slab face
    at ~14 px, frequently centred and letterspaced. MM6 uses rasterised real
    serif typefaces — **Lucida** (11–12 px, body: status line, dialogue, books,
    tooltips), **Arrus** (14–16 px serif display: sheet titles, message headers),
    **Create** (buttons, chargen), **Smallnum** (8–9 px, gold/food/damage) — with
    the drop shadow **baked into the glyph as a second colour index**, hence
    recolourable. The result should look bookish, not game-y.

11. **[MAJOR] No distance haze anywhere.** Far walls are as saturated as near
    ground; the horizon in 05 is a hard green/blue edge. Should be a lerp toward
    the time-of-day grey (#FFFFFF noon → #5F5F5F dawn/dusk → #272727 night)
    starting at `fogWeakDistance`, saturating at `fogStrongDistance`, capped at
    84.7 % on geometry and 97.3 % on sky.

12. **[MAJOR] Outdoor automap and the map book are raw terrain noise.** Both show
    the same downsampled green blotch field. Outdoors MM6 samples a **per-map
    pre-rendered top-down colour illustration**; the map book puts it on the
    `sbmap` parchment page. Right now there is no cartography at all.

13. **[MAJOR] Spell/impact effects use a yellow-only ramp with no red.**
    Sampled: #C09E00, #A78A00, #D6B000, #EFB43C, #EFD14D, white core. MM6's fire
    particle tint is `#FF3C1E` (OrangeyRed) and impacts are multi-frame expanding
    explosion sprites plus an `effpar01` burst that casts a real mobile light.
    A single-frame 8-lobed star reads as a comic-book "pow".

14. **[MAJOR] Shop/guild interiors are built from stamped repeats.** Five
    identical bows in a row; eleven identical spellbooks in a grid; identical
    tables, mugs, lanterns. Even if the assets stay procedural, break the
    repetition — vary size, rotation, spacing and per-instance palette.

15. **[MINOR] Message boxes and status bands are pure #000000 with a 1 px gold
    rule.** Should be the nine-slice carved-wood frame set (`cornr_ul/ur/ll/lr` +
    `edge_top/btm/lf/rt` + `endcap`, dark wood #3E2E1E with a #8A6E46 bevel) over
    a darkened backing. Nothing in MM6's UI is pure black.

16. **[MINOR] Dithering appears where MM6 bands.** Title sky measures parity
    total-variation 0.274 (clear ordered checkerboard); the paperdoll vignette and
    its drop shadow are halftone-dithered; the guild status band is a black
    checkerboard. The software renderer never dithers.

17. **[MINOR] Soft alpha edges and gradients throughout.** The 10-combat cloud,
    the 21-dialogue light shafts, the torch teardrop, the 12-combat turn disc's
    anti-aliased rim. MM6 has 1-bit alpha and no anti-aliasing anywhere.

18. **[MINOR] Wall torches cast no light.** In 25 and 26 the masonry immediately
    around a torch is no brighter than elsewhere. Sprites with `glowRadius` add a
    real mobile light in MM6 — a torch should throw a bright banded pool on the
    wall behind it.

19. **[MINOR] Dungeon corridors are completely empty.** No doors, alcoves,
    branches, chests, rubble, decorations or props in any of 25/26/27. MM6
    dungeons are dense.

20. **[MINOR] Dialogue option list is centred and ~2.5× oversized.** Should be
    left-ish in 140 × 30 buttons at x = 480, first at y = 146 (shop) or 160
    (house), stepping +30, white `#FFFFFF` with gold `#E1CD23` on hover, in
    Lucida.

21. **[MINOR] Inventory grid is an empty black lattice on flat olive.** 14 × 9 at
    32 px is correct; the ground should be the painted `fr_inven` bitmap and the
    grid should be subtle. Also: no starting equipment is shown at all.

22. **[MINOR] Spellbook school tabs are modern vector glyph buttons.** A heart for
    Body and an eye for Mind on flat coloured rectangles. Should be painted
    leather bookmark tabs with school-tinted page borders, and all learned spells
    should be drawn at the hand-authored `pIconPos` slots.

23. **[MINOR] Indoor minimap navy is `#000030`, one quarter the specified
    `#000078`;** the explored area is filled rather than outlined; and the party
    arrow does not move between 25 and 26.

24. **[MINOR] Stat rows have no dotted leaders.** MM6 renders `label ……… value`
    across the full column width on the character sheet and quick reference; the
    bare left/right alignment here reads as a modern table.

25. **[MINOR] Right-panel buff strip draws 14 filled boxes when no buffs are
    active.** Buff icons should only be drawn while their effect is up.

### What is genuinely right — measured, and worth protecting

- Viewport rect is **exactly x 8…467, y 8…351**; bottom bar at y 352 (128 tall);
  right panel at x 468 (172 wide). Spec-perfect.
- Automap rect is **exactly 137 px wide starting at x = 488**.
- Portraits are **63 px wide** at x ≈ 35/150/265/380, y ≈ 388; HP/SP tubes are
  ~5 × 53 at x ≈ 23/102 offsets, y ≈ 400 — within a couple of pixels of spec.
- Status line text is `#0A0000` on a cream shadow — the exact `colorTable.Diesel`
  / `StarkWhite` pair.
- All frames are a clean 2× nearest-neighbour blit of a 640 × 480 source: I
  verified **0 non-uniform 2×2 blocks out of 307 200**.
- Time-of-day curve: noon 1.00, dusk 0.45, dawn 0.40, night **0.155** against the
  spec's #272727 = 0.153. Essentially exact, and the tint is a neutral multiply
  rather than a colour grade, which is the right mechanism.
- Indoor FOV visibly narrows; indoor minimap switches to navy-and-blue.
- Character-sheet tab and options-button coordinates land within a few pixels.
- Pre-baked UI screens hold a ≤256-colour budget.

The chrome and the layout engine are in good shape. The world art and the
typography are not.

---

## Score

**Overall indistinguishability: 34/100**

The HUD skeleton is measurably accurate to the engine constants and would survive
a squint test. Everything inside the viewport, and every glyph on screen, would
not. There is no image in this set that I would have to look at twice: monsters
and trees are visibly untextured real-time 3D, the sky is blank, and the
interiors are staffed by cloned mannequins with drop shadows. The score is held
above 30 only by the genuinely correct frame geometry, the correct day/night
curve, and the correct 2× integer presentation.

## Verdict

**NOT YET**
