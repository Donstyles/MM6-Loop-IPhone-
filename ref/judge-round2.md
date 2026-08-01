# Visual judge — Round 2

Images judged: the 28 PNGs in `/home/user/MM6-Loop-IPhone-/shots/judge2/`, each
1280×960 = a 640×480 logical frame at exact 2× nearest-neighbour (verified: 0 of
75 762 sampled 2×2 blocks are non-uniform, so the upscale is clean and every
measurement below is quoted in **logical 640×480 pixels**). All 28 are byte-distinct.

`shots/judge2/errors.txt` contains one line: `Failed to load resource: the server
responded with a status of 404 (Not Found)` — one asset is missing from the build
these frames came from.

Measurements were taken by decoding the PNGs and sampling pixels, not by eye.

---

## Recollection

*(Written before opening any candidate image.)*

**Frame and layout.** 640×480, 8-bit palettised (256 colours), 4:3, no letterbox.
The 3D viewport is *not* full-screen: it is a window inset into carved chrome at
roughly x=8..468, y=8..352, leaving a wide right-hand column and a deep bottom bar.
The bottom band (~128 px tall) holds four party portraits in a row with HP and SP
gauges, and a two-line status/log text at its top. The right column holds the
automap, hireling slots, buff icons, the food/gold readout and the book tabs.

**Chrome material.** Painted, not generated: warm grey-brown carved stone with
sculpted mouldings, rivets, brass fittings and inset wood, with a bevelled inner lip
that casts a 1–2 px dark line into the viewport. Highlights on top/left of raised
mouldings, shadow on bottom/right, but irregular — not a uniform CSS-style 1 px bevel.

**Portraits and gauges.** Four hand-painted head-and-shoulders busts, ~63×73 px each,
low-res and painterly, sitting in recessed arched niches. HP and SP as narrow
vertical tubes flanking each portrait, filling bottom-up. Selected character gets a
highlighted border. Portraits swap art on damage/condition.

**Automap and compass.** A rectangular automap aperture high in the right panel,
plus a compass that is a *ribbon* — a panoramic strip sliding behind a narrow window —
not a rotating needle.

**Outdoor terrain.** A 128×128 heightmapped tile grid, 512-unit cells, one 64×64
hand-painted texture per cell tiling 1:1, so from eye height you *see* the tile grid
as a repeating pattern with a hard period. Height is per-vertex and quantised, so
hillsides visibly stair-step and each triangle takes a distinct flat shade —
faceting, not smooth gradients. Grass is a dull olive/sage, narrow value band, low
per-pixel contrast; roughly #3E5A28–#6E8C3C. Tile-to-tile transitions are hard-edged.

**Sky and horizon.** A tiled cloud bitmap projected through an infinite-plane
mapping, converging to a dead-straight horizon line with a soft haze band on it.
Clouds compress into fine striations near the horizon and stretch overhead. Pale
desaturated blue, low contrast. Night sky is the same cloud texture multiplied down —
still legible, never pure black.

**Sprites.** Camera-facing billboards, pre-rendered from 3D at 8 octants, fully
textured and smooth-shaded, **no outline**, no rim light, baked key light from
upper-front-left that does not follow the in-game sun. Hard 1-bit alpha, jagged
edges, no feathering. Chunky nearest-neighbour magnification at close range. No
shadows — sprites visibly float on uneven terrain. Trees have real branch structure
and internal foliage value variation.

**Lighting.** Everything is a **greyscale multiply** on a shared time-of-day curve —
sky, terrain and sprites all take the same tint, which is why MM6 reads as tonally
unified. White at noon, ~#5F5F5F at dawn/dusk, ~#272727 at night. Indoors it is
per-vertex quantised to 32 grey steps; torches produce a clear radial pool of light on
walls and floor, and unlit sectors are genuinely near-black.

**Post.** No filtering, no dithering, no anti-aliasing anywhere. Gradients band in
discrete steps.

**Fonts.** Bitmap serif faces (Lucida-family), ~11–12 px body, with a **baked** 1 px
drop shadow as a second colour index. Cream/white body, gold #E1CD23 for hoverable
text, green for buffed, red for debuffed.

**Full-screen panels.** All draw at (8,8), exactly replacing the 3D viewport; the
chrome stays live around them. Character sheet on parchment with two label/value
columns and painted graphical tabs; inventory as a 14×9 grid of 32 px cells with a
paperdoll; spellbook as a two-page open book with **9** school bookmark tabs down the
right edge and painted page art; quest/notes/map/calendar all share the book frame;
shops replace the right panel with the dialogue panel, proprietor portrait at (521,38),
white option text with gold hover; rest has an animated sky window and hourglass.

**Framing.** The viewport is 461×345 (1.336:1), horizontal FOV 75° outdoors and 60°
indoors — the change is very noticeable on entering a dungeon.

*(Where I disagreed with the spec: I had remembered HP/SP as horizontal bars beneath
the portraits and the compass as a rotating needle. The spec is right and I was wrong
on both — they are 5×49 vertical tubes flanking each portrait, and the compass is a
~240 px panoramic ribbon behind a 26 px aperture. I judged against the spec on these.)*

---

## Per-image verdicts

### 01-title.png
- **Genuine MM6?** NO
- **Tells:** The whole scene is vector primitives. The sun is a flat orange disc with
  two concentric lighter arcs; the hills are three smooth flat-green blobs; the road
  is a flat tan trapezoid with a hard edge; the rocks are flat grey triangles with one
  lighter facet; the tree at left is five brown lines with no foliage at all. The
  castle is three rectangles with triangular caps and a hand-drawn brick pattern.
  906 unique colours — the highest in the set, and above an 8-bit budget.
  A uniform 50 % checkerboard dither covers every pixel including the title glyph
  edges. The menu is a flat #7A7A7A noise rectangle with a 1 px gold double rule and
  four round gold studs — CSS chrome, not a painted plaque. Menu items are text in a
  ~13 px serif; MM6's title buttons are painted bitmaps.
  **Should be:** a single painted 640×480 illustration with the ornate MM6 logotype
  and painted menu plaques.

### 02-chargen.png
- **Genuine MM6?** NO
- **Tells:** Layout is a modern three-panel dark UI: black translucent boxes with 1 px
  gold rules and a fine dot-matrix fill, floating on a wood plank background. MM6's
  party-creation screen is a painted parchment/wood scene with painted stat arrows.
  The up/down stat arrows are flat tan squares with a chevron. The portrait preview
  is a flat vector helmet-head (three tone bands, two dot eyes) that does not match
  the four painted portraits in the bottom bar 300 px below it — two art styles in one
  frame. "Points: 25" and per-stat "4pt / 1pt" costs are a modern point-buy readout
  MM6 does not display. Bottom bar and portraits are the in-game HUD, correct.

### 03-outdoor-morning.png
- **Genuine MM6?** NO
- **Tells:** Chrome geometry is right (measured: viewport transitions at exactly x=8
  and x=468, chrome resumes at y=353) but the world inside it is not.
  The hillside is one enormous smoothly-shaded slope with long directional smears —
  no visible 512-unit tile grid, no 32-unit stair-stepping, no per-facet flat shading.
  Grass sits at #1E3515–#365A24, i.e. **half the value** of MM6 grass (#3E5A28–#6E8C3C).
  The sky is stamped soft cloud ellipses at constant scale — no convergence toward the
  horizon, no fine striation band, no haze fade.
  Tree canopies are stacked flat green ellipses with a dithered alpha fringe; trunks
  are untapered flat brown rectangles with no bark texture and no branches.
  The distant towers are flat blue-grey silhouettes with the texture entirely gone —
  MM6's distance falloff is a grey *multiply* on still-textured geometry.
  Half-timber house: the beams are modelled geometry rather than painted into the wall
  texture, and the plaster is a flat cream field with sparse random speckles.
  Right panel: the compass aperture is empty, and the entire y≈180–310 band (where the
  14 party buff icons belong, rows at y=247 and y=279) is featureless noise.

### 04-outdoor-noon.png
- **Genuine MM6?** NO
- **Tells:** Labelled noon; measured ground luminance **15.7**, sky **66**. At 13:00
  MM6's tint is #FFFFFF — *nothing* is dimmed; grass should read ~79 and the sky ~150.
  This is ~5× too dark on the ground and inverts the relationship (see Ranked defects #3).
  The right 25 % of the viewport is a single flat brown rectangle spanning floor to
  ceiling with a hard vertical edge — a tree-trunk billboard at melee range, rendered
  with no taper, no texture, no branch junction. It reads as a wall.
  Bottom-left the ground breaks into a visible chess pattern of alternating darker and
  lighter squares ~40 px across.

### 05-outdoor-looking-down.png
- **Genuine MM6?** NO
- **Tells:** As 04. Filename says "looking down"; the camera is pitched up. All four
  visible trunks are flat untextured slabs with a checkerboard alpha edge on their
  silhouette. Viewport unique colours: 61 — a real MM6 forest frame uses most of a
  256-entry palette.

### 06-outdoor-walk.png
- **Genuine MM6?** NO
- **Tells:** The single clearest terrain failure in the set. Sampling y=280 across the
  viewport returns flat runs of 8–26 px cycling between #040E06, #0D180A, #13160A and
  #1E3515 — the ground is a **patchwork of randomly-tinted flat blocks**, like a debug
  visualisation of tile indices, with dithered seams between them. MM6's ground is one
  tiling 64×64 texture whose per-tile variation comes only from lighting.
  27.4 % of ground pixels and 19.2 % of sky pixels sit in a strict 2-px alternating
  pattern — a global ordered dither over the entire frame.
  Sky 130 vs ground 15.5 = an 8:1 ratio; the treeline reads as black silhouette against
  a bright sky. Near canopy luminance 23, far treeline 27 — **no distance haze at all**.
  The pale quadruped at right is a formless blue-white blob, brighter than everything
  around it and not tinted by the world at all.

### 07-outdoor-dusk.png
- **Genuine MM6?** NO
- **Tells:** The sky is a flat dead grey-black (~#2A2A28) with **zero cloud structure**.
  MM6 at dusk multiplies the cloud texture by #5F5F5F — the clouds stay clearly
  legible. Ground crushed to luminance 8.1 with no texture at all, meeting the treeline
  on a hard high-contrast terminator with no haze band. Tree canopies at luminance 23,
  i.e. **3× brighter than the ground they stand on** — sprites and terrain are on
  different tone curves, which is the exact opposite of MM6's defining tonal unity.

### 08-outdoor-night.png
- **Genuine MM6?** NO
- **Tells:** **Fatal.** The viewport contains 8 unique colours and a uniform luminance
  of 8.0 across sky, canopy and ground. It is a black rectangle. MM6 night applies a
  #272727 multiply with an ambient floor of 0.15, so the terrain, buildings, trees and
  cloud texture all remain visible and the game remains navigable. Nothing here is.

### 09-outdoor-dawn.png
- **Genuine MM6?** NO
- **Tells:** The random-tile patchwork is at its most obvious — olive, tan, khaki, black
  and green squares in a chess grid. Ground luminance 19.7 is **brighter than the same
  scene at "noon" (15.7)**; the time-of-day curve is not monotonic. Sky is a flat
  near-black band at luminance 19.8 with no clouds while the ground is lit — sky and
  ground are decoupled where MM6 drives both from one value.

### 10-combat.png
- **Genuine MM6?** NO
- **Tells:** No monster is legible anywhere in the viewport. The minimap shows two red
  hostile dots close to the party arrow; at that range a humanoid (world height ~192 u,
  ~80×128 source pixels) should occupy a large fraction of the 345 px viewport. What is
  present at the treeline is a ~20 px green mass indistinguishable from foliage.
  (Also: without a Cartographer hireling or Wizard Eye, MM6 does not plot monsters on
  the minimap at all.)

### 11-combat-attack.png
- **Genuine MM6?** NO
- **Tells:** Two yellow floating "9"s are drawn over the terrain. MM6's floating damage
  numbers are **off by default**; damage is reported in the status line, and the
  visible feedback is a portrait expression swap to one of the three wince frames.
  The impact effect is a 6 px orange dot — MM6 spell/hit effects are multi-frame
  billboard sprites with a glow radius that lights nearby geometry.
  Status line reads correctly ("Mortimer takes 1 damage.") in #DED2BE with a #080808
  baked shadow — close to StarkWhite #E6D6C1.

### 12-combat-turnbased.png
- **Genuine MM6?** NO
- **Tells:** The turn-based indicator is at logical (395,290), which matches the spec's
  (394,288) — the *position* is right. The *art* is wrong: a flat gold ring with a
  radial tick scale and a single needle, i.e. a speedometer. MM6 draws `turn0`…`turn5`,
  a painted hand-and-dial showing remaining action points, and `turnhour`, an hourglass,
  during the monsters' turn. The green "ready" markers over the portraits are the right
  idea but rendered as a 9 px cartoon glyph rather than the painted `IB-InitG` marker.

### 13-charsheet.png
- **Genuine MM6?** NO
- **Tells:** Closest frame in the set to correct, and still not close.
  Tabs are five flat bevelled rectangles with centred text at y≈325–347; MM6 uses
  painted graphical tabs (`ib-cd1-d`…) at y=316, x=20/110/200/290 with Exit at (379,316).
  Dotted leaders run between every label and value — MM6 right-justifies the value with
  no leader.
  The paperdoll is a **flat vector mannequin**: solid #E8C49A limbs, a grey striped
  torso, brown shorts, two dot eyes, no face, no rendering. MM6's doll is a painted
  body bitmap. Equipment reads as clip-art (a grey shield with a white swirl, a mace as
  a green line with a red ball).
  Panel background is a flat parchment with soft blotches; MM6's has painted rules and
  border ornament.

### 14-inventory.png
- **Genuine MM6?** NO
- **Tells:** Grid measures 14 columns × 9 rows at ~31 px starting near (20,25); spec is
  14×9 at 32 px from (14,17) — off by ~6 px but structurally right. Everything else is
  wrong: the background is a flat dark olive (#4A4436) with sparse yellow specks and
  hard 1 px black cell rules, where MM6 has a painted leather/parchment field. The grid
  is completely empty, so no item icon work is on show at all. Same vector paperdoll.

### 15-spellbook.png
- **Genuine MM6?** NO
- **Tells:** 9 school tabs — the correct MM6 count, correctly down the right edge, at
  roughly the right pitch. But each tab is a flat rounded rectangle of one tinted colour
  with a plain circle stamped in the centre; MM6's are painted bookmarks each carrying a
  distinct hand-drawn school sigil.
  Both pages are blank cream with a single 1 px rectangle rule. MM6's page backgrounds
  (`SBFB00` etc.) are illustrated parchment with decorative borders and margin art even
  when no spells are learned. The spine is a flat brown strip with a dithered edge — no
  gutter shading, no page curvature. "Exit" is a generic bevelled button.

### 16-questlog.png
- **Genuine MM6?** NO
- **Tells:** The best-composed panel in the set. Still: the four sub-page buttons are
  ~60 px wide **text labels** ("Quests / Notes / Awards / History") where MM6 uses
  50×34 picture buttons showing book spines with no words. Scrollbar is a plain brown
  rounded rectangle in a dark trough. Body text is #27180A/#5C4C25 warm brown; MM6's
  book body colour is Tundora #4B4B4B. The dot-leader column running down the gutter is
  an invention.

### 17-mapscreen.png
- **Genuine MM6?** NO
- **Tells:** **Fatal — the map is empty.** A flat #24446E navy rectangle containing
  nothing but a party arrow. MM6's outdoor map book shows a pre-rendered top-down colour
  picture of the map with terrain, roads, towns and dungeon markers, on the `sbmap`
  parchment page. Navy is the *indoor* minimap background (#000078) and has no business
  on an outdoor map. Compounding this, the 137×117 automap in the right panel *does*
  render terrain correctly in every other frame, so the full map screen is simply not
  drawing its content.
  Also invented: a coloured-square legend row (Party/Town/Dungeon/Friend/Treasure/Wall),
  an 8-point vector compass rose, and a numeric "×2.0" zoom readout. MM6 has none of these.

### 18-quickref.png
- **Genuine MM6?** NO
- **Tells:** **Render bug.** Nine of the seventeen rows (Level, Next Level, Spell Points,
  Might, Personality, Accuracy, Luck, Age, and the header rule) are overprinted with a
  dense yellow dot-matrix fill across the full row width, rendering the values nearly
  illegible. The dot-leader fill is being drawn at full opacity over the text.
  Separately: MM6's Quick Reference shows the four party portraits at the head of the
  columns; there are none here.

### 19-rest.png
- **Genuine MM6?** NO
- **Tells:** The `restmain` layout is imitated (sky window top-left, hourglass, button
  stack) and button geometry is within ~8 px of spec. The art is all vector: the sky
  window has three cotton-ball clouds and a flat yellow sun disc (MM6 has no sun disc
  anywhere in the game), two flat green hill blobs, a striped grey wall, a striped brown
  floor, a campfire of four flat triangles on a ring of grey pebble ovals, and a literal
  two-triangle hourglass with blue "sand". The red-and-cream ellipse at bottom-left is
  presumably a bedroll and is unreadable.
  The "Camp / Food / per-character bar" box is invented — MM6's rest screen has no such
  readout. Button label reads "Wait until Dusk"; MM6's is "Wait until Dawn".

### 20-shop.png
- **Genuine MM6?** NO
- **Tells:** Structure is right — painted interior in the 461×345 inset, right panel
  swapped for the dialogue panel, portrait near (515,32) vs spec (521,38), options
  stepping exactly +30 px from y≈159, white text with a gold-on-hover convention.
  The content is not. Every wall-rack weapon is a vector shape with a **hard 2 px dark
  outline**: bows are two tapered arcs plus a straight string, swords are 4 px white
  rectangles with a yellow crossbar, the axe is a grey teardrop with a black keyline.
  MM6 art has **no outlines** — no black key line, no rim light — and shop interiors are
  painted illustrations.
  Shelf and counter edges carry a period-2 black dotted rule that reads as
  `border-style: dotted`. The lamp is a soft radial gradient glow, an idiom absent from
  1998 palettised art.
  The shopkeeper is the same featureless tan mannequin as the paperdoll, standing with
  no shadow and no scale relationship to the room.
  **Layout bug:** the "Gold: 200" line and the line below it are clipped mid-glyph by
  the bottom bar at y=352.

### 21-dialogue.png
- **Genuine MM6?** NO
- **Tells:** No NPC figure in the scene at all. The room is flat tiling brick, a window
  drawn as a white-blue quad with two diagonal streaks, a fireplace as a grey box with
  four orange triangles, an ellipse rug with a dotted ring, and two soft blurred yellow
  light pools on the floor. The NPC portrait is a crude vector face — beige oval, two
  blue almonds, a flat brown hair cap — which sits jarringly against the four
  competently-painted party portraits 250 px below it in the same frame.

### 22-temple.png
- **Genuine MM6?** NO
- **Tells:** **Worst artefact in the set.** A huge triangular "god ray" from the ceiling
  to the floor drawn as a literal 50 % ordered stipple of pure yellow dots, occupying
  roughly a quarter of the viewport. MM6 has no volumetric light, no god rays, and no
  stipple fills. It reads as a debug pattern.
  The healing-cost table is drawn as a black overlay box with the same yellow dot-fill
  bleeding through it (same bug as 18). The stained-glass window is a flat circle of pie
  wedges; the altar is a white box with five white sticks and orange teardrops; the
  priest is the mannequin again.

### 23-tavern.png
- **Genuine MM6?** NO
- **Tells:** Seven identical grey-blue mannequin patrons in identical rigid
  camera-facing poses, differing only in head shade; one stands inside the bar shelving.
  Tables are grey rectangles on a stick topped with three white cubes, and the tables at
  left are drawn at the same size as those further back — perspective is not applied to
  the props. Chandeliers are a 1 px line with a tiny lantern and a large soft radial
  glow. Bottles on the shelf are 3 px coloured triangles.

### 24-options.png
- **Genuine MM6?** NO
- **Tells:** Button grid measures 217×40 at x=25/247, y=162/216/270 against spec
  214×40 at x=19/241, y=155/209/263 — a consistent +6/+7 offset, so close.
  But the panel background is the **same procedural grey noise as the surrounding
  chrome**, so the options panel and the frame are the same material and only a 1 px
  rule separates them; MM6's `options` background is a distinct painted image.
  Buttons are flat olive rectangles with a 1 px bevel, not carved stone plaques. The
  title sits in a mottled brown box flanked by literal "- - - -" dashes.

### 25-dungeon.png
- **Genuine MM6?** NO
- **Tells:** Best 3D frame in the set — plausible masonry and floor slabs. Then:
  **the wall torch casts no light.** The masonry immediately behind the flame is the
  same value as masonry 400 px away. MM6 adds `30·d/r − 30` per light with an 800-unit
  party torch radius, producing an unmistakable pool. Here the torch is a self-lit
  sprite pasted on an unlit wall.
  Whole-viewport unique colours: **36**. Walls sit flat at ~#1A1C16–#2A2C24 with no
  distance falloff and none of the 32-step banding the software renderer produces
  (typical corridors are #383838–#585858).
  Blocks are ~90×40 logical px — far too large for a 128×128 texture on a wall face —
  with per-pixel random speckle instead of per-block value jitter and chiselled bevels.
  There is a hard vertical seam at x≈250 and a floor discontinuity at x≈340.
  The indoor minimap is correct: #000078 field, #0000FF wall lines, white party arrow.
  The compass shows a bare letter "N"; MM6's is a ~240 px panoramic ribbon with tick
  marks sliding behind a 26 px aperture, which is why the compass is blank in every
  outdoor frame here.

### 26-dungeon-walk.png
- **Genuine MM6?** NO
- **Tells:** As 25. The torch flame is hard-clipped flat at the top viewport edge and
  its handle is a brown streak; the flame is three flat tone bands with a checkerboard
  alpha fringe. Still no illumination of the surrounding wall.

### 27-dungeon-look.png
- **Genuine MM6?** NO
- **Tells:** **12 unique colours in the entire viewport.** The room is lit to a uniform
  flat value with no torch present, which is neither MM6's near-black unlit sector nor
  its torch falloff — it is a constant ambient. Ceiling is pure black. A hard black
  wedge cuts the floor right of centre.

### 28-guild.png
- **Genuine MM6?** NO
- **Tells:** Bookshelves of flat coloured rectangles; six identical orange spellbook
  rectangles with 8 px white glyphs; the floor sigil is a flat orange ellipse outline
  with an orange diamond; the guildmaster is the mannequin. The "Guild of Fire / Not a
  member" strip is drawn as a dithered black band across the bottom of the viewport,
  overlapping the world — MM6 puts that information in the status line at (0,352).

---

## Ranked defects

1. **[FATAL] Lighting / time-of-day — the night frame is a black rectangle.**
   `08-outdoor-night` has **8 unique colours** in the viewport and a uniform luminance
   of **8.0** across sky, canopy and ground. MM6 night is a `#272727` grey multiply over
   an ambient floor of 0.15: terrain, trees, buildings and the cloud texture all stay
   clearly legible and the game stays navigable. **Should be:** grass at ~#0C1109–
   #121A0B, sky still showing cloud structure at ~#1A1F26, silhouettes readable.

2. **[FATAL] Terrain — the ground is a patchwork of randomly-tinted flat blocks, not a
   tiled texture.** Sampling y=280 in `06-outdoor-walk` returns flat runs of 8–26 px
   cycling between #040E06, #0D180A, #13160A and #1E3515. Visually this is a chessboard
   of olive/tan/khaki/black squares (worst in 06 and 09). MM6 lays **one** 64×64
   hand-painted grass texture on every cell at 1:1 per 512-unit tile; all per-tile
   variation comes from lighting, never from colour. **Should be:** a visibly repeating
   fine speckle at a 512-unit period, values inside #3E5A28–#6E8C3C, with hard-edged
   transition tiles only where the tileset actually changes.

3. **[FATAL] The time-of-day curve is broken and sky/world are decoupled.**
   Measured mean luminance (sky / canopy / ground):
   noon 66 / 24 / **16**; combat 129 / 33 / 21; dusk 26 / 23 / **8**; dawn 20 / 21 / 20.
   At 13:00 MM6's tint is `#FFFFFF` — nothing is dimmed, and grass should read ~79.
   The ground here is ~5× too dark at noon, *brighter* at dawn (20) than at noon (16),
   and the sky/ground ratio swings from 8:1 to 0.96:1 across the day. In MM6 sky,
   terrain and sprites are all multiplied by the **same** grey, which is the single
   thing that makes MM6 read as tonally unified. **Should be:** one shared tint,
   `#FFFFFF` at 13:00 → `#5F5F5F` at 05:00/21:00 → `#272727` at night, monotonic.

4. **[FATAL] The map screen renders nothing.** `17-mapscreen` is a flat #24446E
   rectangle with a party arrow. **Should be:** the pre-rendered top-down colour map
   image sampled at `65536·imgW/zoom`, on the `sbmap` parchment page, with the party
   arrow and seen-area masking. Navy #000078 belongs to the *indoor* minimap only.
   Extra: delete the legend row, the compass rose and the "×2.0" readout — MM6 has none.

5. **[MAJOR] A global 50 % checkerboard dither is applied to every pixel of every
   frame.** 19.2 % of sky pixels and 27.4 % of ground pixels in `06` sit in a strict
   2-px alternating pattern, and the crops show a screen-door texture over sky, foliage,
   masonry and even the title glyph edges. **The MM6 software renderer does not dither
   at all** — it swaps between 32 pre-darkened palette copies, so gradients *band* in
   discrete steps. **Should be:** remove the dither entirely; quantise lighting to the
   32 levels `8·(31−dim)` and let it band.

6. **[MAJOR] World sprites are flat filled blobs with dithered alpha; MM6 sprites are
   pre-rendered 3D with hard 1-bit alpha and no outline.** Tree canopies are stacked
   two-tone ellipses with no branch structure and no internal value variation; trunks
   are untapered flat rectangles with no bark; the pale quadruped in 06/07/09 is a
   formless blue-white blob. Worse, that creature holds the same brightness at dusk as
   at noon while the ground drops to luminance 8 — sprites are not on the world tint at
   all. **Should be:** textured, smooth-shaded turntable renders, 8 octants, baked key
   light from upper-front-left, 1-bit keyed alpha with jagged edges, tinted by the same
   grey multiply as terrain.

7. **[MAJOR] Every NPC and the paperdoll are featureless mannequins.** The shopkeeper,
   the priest, the guildmaster, the seven tavern patrons and the character-sheet doll are
   all the same flat vector body: solid tan limbs, no face beyond two dots, no shading,
   no shadow, no perspective scaling (the tavern's near and far tables are the same
   size). This is placeholder-grade against MM6's painted paperdoll bitmaps and painted
   NPC portraits — and it sits in the same frame as the party portraits, which are the
   one genuinely good asset in the build.

8. **[MAJOR] Dungeon lights do not light anything.** The wall torch in 25/26 is a
   self-lit billboard on masonry that is exactly as dark next to the flame as 400 px
   away; 27 has no light source yet is uniformly lit. Viewport unique colours: 36, 42,
   **12**. **Should be:** `lightlevel += 30·dist/radius − 30` per light, party torch
   radius 800 units, sector `minAmbientLightLevel` giving #383838–#585858 corridors, all
   quantised to 32 grey steps so the pool bands visibly.

9. **[MAJOR] No distance haze anywhere outdoors.** Near canopy luminance 23 vs far
   treeline 27 in `10-combat` — identical. And where haze *is* applied (03's distant
   towers) it is a blue-grey tint that erases the texture rather than a grey multiply.
   **Should be:** lerp toward the time-of-day grey starting at `fogWeakDistance`,
   saturating at `fogStrongDistance`, capped at 84.7 % on geometry / 97.3 % on the sky,
   plus the 39 px horizon fade band and the solid sub-sky fill below the horizon.

10. **[MAJOR] The sky is screen-space cloud stamps with no horizon convergence, and at
    dusk/dawn it loses its clouds entirely.** In 03/06/10 the cloud blobs are the same
    size at the top of the frame and at the horizon; in 07 and 09 the sky is a flat dead
    grey band with zero structure. **Should be:** one screen quad from the viewport top
    to the projected horizon, textured through the inverse-perspective plane mapping so
    clouds streak from the zenith and compress into a fine striated band at the horizon,
    drifting 1 texel/ms, and multiplied — not replaced — by the time-of-day tint.

11. **[MAJOR] Terrain has no faceting.** Hillsides are smooth continuous gradients. MM6's
    heightfield is per-vertex on a 32-unit quantum with **flat** per-triangle shading, so
    slopes visibly stair-step and adjacent triangles take distinct tonal steps.

12. **[MAJOR] Two literal render bugs.** (a) `18-quickref`: nine of seventeen rows are
    overprinted with a full-width yellow dot-matrix fill that makes the values nearly
    illegible. (b) `22-temple`: a quarter-viewport yellow stipple triangle "god ray" —
    MM6 has no volumetric lighting and no stipple fills. Both look like the same
    dot-leader/fill routine misfiring.

13. **[MAJOR] The right panel is two-thirds empty.** Below the hireling niches, the band
    y≈180–310 is featureless noise. Missing: the **14 party buff icons** in two rows at
    y=247 and y=279 (each a 126-frame animated atlas with per-slot phase offset), and the
    torchlight/wizard-eye indicators at (468,0)/(606,0).

14. **[MAJOR] The compass is a bare letter.** In the dungeon frames it shows a single "N";
    in every outdoor frame the aperture is empty because the yaw falls between cardinals.
    **Should be:** `IB-COMP`, a ~240 px panoramic ribbon with intermediate tick marks,
    scrolled to `round(yaw·0.1171875)+285` and clipped to a 26 px window at x=541, y=136 —
    so it is never blank.

15. **[MAJOR] All interior art is outlined vector clip-art.** Shop weapons, the temple
    altar, the tavern furniture and the guild books all carry a hard 2 px dark keyline;
    shelf and counter edges use a period-2 dotted rule; lamps and fires use soft radial
    gradient glows. MM6 art has **no outlines**, no soft glows, and interiors are painted
    461×345 illustrations.

16. **[MODERATE] The chrome has the right measurements and the wrong material.** Viewport
    edges land at exactly x=8/468 and y=8/353, portrait art at x=34/149/264/379 y≈382
    (spec 35/150/265/380, y=388), HP tubes at x=24/139/254/369 (spec 23/138/253/368), SP
    tubes at 218/333/448 (spec 217/332/447), and the empty SP slot for the Knight is
    correctly blank. But the surface is one uniform blurred grey-brown value-noise field
    with a single 1 px gold pinstripe. **Should be:** carved dark stone with brass/bronze
    fittings and inset wood panels, four *arched relief niches*, real bevelled mouldings,
    at mid-tone #5A5248 (#3A342C→#8A8072). Two specifics: the HP/SP tubes are **3 px wide,
    should be 5**; and the active-character marker is four gold L-brackets with corner
    studs (a modern targeting reticle) where `IB-selec` is a continuous glowing ring.

17. **[MODERATE] Full-screen panels use generic bevelled-rectangle-with-text buttons
    throughout.** Character-sheet tabs, spellbook school tabs, quest sub-pages, rest
    buttons, map zoom, and the options grid are all flat rectangles with a 1 px bevel and
    a centred word. MM6 uses painted bitmap buttons everywhere — `ib-cd*` tabs, book-spine
    picture buttons, painted bookmarks with school sigils, `ib-bcu`. Positions are mostly
    within 5–10 px, so this is purely an art problem.

18. **[MODERATE] Spellbook and inventory have no content.** Both pages of the spellbook
    are blank cream, and the 14×9 inventory grid is entirely empty — so neither spell
    icons nor item icons appear anywhere in the 28 frames. Even with nothing learned, MM6
    draws the illustrated `SBFB00`-family page art.

19. **[MODERATE] Floating damage numbers.** Yellow "9"s over the world in 11/12. MM6's
    `show_damage` is off by default; combat feedback is the status line plus a portrait
    expression swap to `DMGRECVD_MINOR/MODERATE/MAJOR`.

20. **[MINOR] Monsters plotted on the minimap** without a Cartographer hireling or Wizard
    Eye active (red dots in 10/11/12/15/16).

21. **[MINOR] Dot leaders on the character sheet** between every label and value; MM6
    right-justifies the value with no leader.

22. **[MINOR] Invented UI elements:** the map legend row and "×2.0" zoom readout (17), the
    "Camp / Food / per-character bars" box on the rest screen (19), the shop-name gold
    header at the top of the dialogue panel (20/22/23/28), and the "- - - -" dash
    decorations flanking the options title (24).

23. **[MINOR] Text clipping.** "Gold: 200" and the line below it are cut mid-glyph by the
    bottom bar in 20 and 23.

24. **[MINOR] Colour near-misses.** Status text #DED2BE vs StarkWhite #E6D6C1; NPC name
    ~#4FA8D8 vs EasternBlue #1699E9; book body #27180A/#5C4C25 vs Tundora #4B4B4B.
    Correct: the gold hover convention, `#00E100` green conditions, `#FF2300` low HP, and
    the indoor minimap #000078/#0000FF.

**Credit where due, since it constrains the score:** text is genuinely 1-bit with a baked
1-px shadow and zero anti-aliasing (9–11 distinct colours across sampled text blocks); the
2× upscale is exact nearest-neighbour; total palette stays in the 256–473 range on most
frames; the viewport rect, bottom-bar geometry, portrait/tube/turn-icon/options-grid
coordinates are within a few pixels of the engine constants; the spellbook has the correct
**9** MM6 schools rather than MM7's 12; the indoor minimap colours are exactly right; and
the four party portraits are the one asset here that would not immediately give the game
away.

---

## Score

Overall indistinguishability: **43/100**

The chrome skeleton is measurably close to the engine constants and the party portraits
are good, which is why this is not in the twenties. But the world renderer fails on its
three defining characteristics — the shared grey-multiply tone curve, the tiled faceted
terrain, and the undithered banded palette — and every piece of world and interior art is
placeholder vector geometry with outlines. Three frames (08, 17, and effectively 27) show
essentially nothing at all, and two more (18, 22) contain outright render bugs. No frame
in this set would survive five seconds next to a real MM6 screenshot.

## Verdict

**NOT YET**
