# Visual judge — Round 1

Images judged: the 27 PNGs in `/home/user/MM6-Loop-IPhone-/shots/judge2/`, each a
1280×960 capture of a 640×480 logical frame at 2× nearest-neighbour. All 27 are
present, readable, and byte-distinct (verified by checksum), so this round is judged
on the full set.

Note on the earlier directory: in `shots/judge1/` frames **11 through 27 are one
byte-identical frozen frame** (md5 `a71b9fdb…`), i.e. the freeze began at
`11-combat-attack`, not at 13. That set is discarded; nothing below refers to it.

Measurements quoted below were taken by decoding the PNGs and sampling logical
(640×480) pixels directly, not by eye.

---

## Recollection

*(Written before opening any candidate image. Reproduced verbatim from my working
notes.)*

Frame: 640×480, 4:3, 8-bit 256-colour indexed palette. No letterbox. The 3D view is
NOT full screen: it is a window inset into carved chrome, roughly 468×352 sitting at
about x=8, y=8, i.e. flush-ish to the top-left with a thin bevel, and a wide control
panel occupying the bottom ~120 px of the screen plus a narrow strip on the right.

Chrome: warm grey-brown carved stone/metal with a hard 1–2 px bevel — light on the
top/left edge, dark on the bottom/right — plus painted rivets/knotwork at corners. It
is painted art, not flat rectangles: there is visible surface noise, scratches and a
slight gradient across each moulding. MM6's chrome is browner and more "stone plate"
than MM7's gold.

Bottom control panel: four party portraits in a row (hand-painted faces, ~63×73 each)
each with a thin red HP bar and a thin blue SP bar beneath, and a coloured ring/border
that changes when the character is selected. To the right of the portraits a cluster of
round/square painted buttons: Cast Spell, Rest, Quick Reference, Game Options; also book
icons along the top-right of the bottom bar (spellbook, quest log/notes, auto-map,
calendar). Bottom-left of the panel is a text log line in cream serif text ("You see
nothing here", "+15 gold"). Gold and food counts printed at bottom.

Compass/minimap: a small circular compass with a red/white needle in the top-right of
the 3D window area, drawn over painted chrome, not a rectangular radar box.

Outdoor terrain: heightmapped tile grid, 64×64 hand-painted textures, low polygon
count, big soft hills with obvious per-face flat shading and visible triangle seams
where the height changes. Grass reads olive/khaki, muted, narrow value band — around
#4A5C2C to #7C8B4A, low per-pixel contrast so it reads as ground cover, not noise. Dirt
roads are ochre; sand pale yellow-grey; snow blue-white. Texture UV is stretched over
each tile, so the ground has a visible large-scale grid, not fine noise.

Sky: a scrolling cloud bitmap projected on an infinite plane, converging at a dead flat
horizon line. Pale desaturated blue with soft off-white cloud smears; low contrast; no
sun disc, no gradient banding stripes. Terrain fades toward the sky colour at the draw
distance, and there is a visible hard clip where distant terrain simply ends into sky
(the famous MM6 pop-in), not an infinite receding plain.

Sprites: billboards for trees, monsters, props. Hand-painted, with alpha cut edges (hard
1 px cut, no feather), 8 facing directions for monsters. Trees are chunky painted masses
with a visible trunk, 2–4× party eye height, planted so their base meets the ground
exactly. Sprites take the same global light level as geometry, so at dusk they dim with
the world. No drop shadows.

Buildings: simple boxy polyhedra, gabled shingle roofs (dull red-brown), plaster and
half-timber walls, arched or rectangular door polygons with a distinct door texture.
Proportions are squat and generous — doors are big enough to read at distance.

Lighting: flat per-face, hard banding, no smooth gradients. Day/night is a global
brightness ramp on the palette — night is a dark, desaturated version of the same scene,
slightly blue but mostly just dark; it does not become a saturated blue/purple wash.
Dungeons are near-black beyond a torch radius, with faces closest to the party lit warm
and everything falling off to black within a few tiles.

Post: none. No filtering, no bloom, no AA. Pixels are crunchy 1:1. Palette banding is
everywhere and is part of the look. Spell effects are additive-ish painted sprite
animations.

Fonts: small bitmap fonts, a compact serif ("Times"-like) proportional face about 10–12
px cap height, cream/parchment white (#EEE3C0-ish), with a hard 1 px black shadow offset
(1,1). Interactive/highlight text is goldenrod-yellow. Book pages use dark brown serif
ink on parchment. No anti-aliasing on any glyph.

Full-screen panels — each is a painted full-page illustration, not a UI made of boxes:
character sheet (painted stone/parchment plate, paperdoll, gold stat labels, painted
tabs); inventory (paperdoll with equipment slots plus a 14×9 grid of small cells, item
icons hand-painted at varying sizes occupying multiple cells); spellbook (two-page open
book, nine school tabs down the right edge, painted round spell glyphs); quest log
(parchment, brown ink serif); map (full-page parchment map with a compass rose); shops
(painted interior scene with the shopkeeper visible, item icons on a counter, gold text
options); NPC dialogue (portrait in a frame at left, topics in gold at right); rest
(painted campfire illustration with hourglass); options (painted panel with sliders and
toggles).

Framing: everything is composed for 4:3 and for a viewport that is wider than tall but
NOT cinematic; the HUD is heavy and takes about a quarter of the screen height.

**Where the spec and my memory disagree:** two places. (a) I remembered a *rotating
needle* compass; `ref/mm6-visual-spec.md` §21 is right and I was wrong — `IB-COMP` is a
~240 px panoramic ribbon sliding behind a 26 px aperture at (541,136). (b) I remembered
the paperdoll living on the character-sheet page; the spec (§22) puts it in the right
panel, which is consistent with the inventory grid (14×9×32 px at (14,17)) consuming the
entire 461×345 page. I defer to the spec on both, and have judged accordingly.

---

## Per-image verdicts

### 01-title.png
- **Genuine MM6? NO**
- Tells: the castle is three flat black rectangles with flat maroon triangles for roofs
  and no texture of any kind — MM6's title art is a painted illustration, not filled
  polygons. The sunset behind it is a smooth orange radial glow, which cannot exist in a
  256-colour indexed frame without heavy banding; here it is dithered with a visible
  regular stipple across the whole sky. The menu plate is a flat grey rounded rectangle
  with a 1 px gold rule and four gold dots — MM6's is carved. The logo is a bevelled
  block face with a hard drop shadow, not the drawn MM6 wordmark. The strapline "A
  procedurally generated homage" and the "v1.0" watermark are self-identifying.

### 02-chargen.png
- **Genuine MM6? NO**
- Tells: a three-column dashboard layout with coloured translucent ribbon banners hanging
  behind each column header (red, blue, green, purple) — nothing in MM6 uses translucent
  colour-coded ribbons. Numeric steppers rendered as small grey `–`/`+` chips. The
  portrait is the same generated face used for all four party members, with a smooth
  airbrushed gradient and no palettisation. Body copy is a uniform-stroke pixel face, not
  a rasterised serif. Live-updating "+8 / −3" deltas beside each stat are a modern
  affordance.

### 03-outdoor-morning.png
- **Genuine MM6? NO**
- Tells: the ground is black. Sampled over x 60–400, y 260–340, median luminance is
  **10.1/255**, mean colour **#081209**. MM6 grass at morning should sit at roughly
  #3E5A28–#6E8C3C (luminance ~72–118). The frame is a bright blue sky sitting on a black
  void. Tree canopies are stacked ellipsoids of flat green with no painted structure, and
  the trunks carry a repeating horizontal band pattern that reads as brickwork. The
  status line is printed **twice** — once inside the 3D viewport at bottom-left and again
  in the bottom bar. The minimap is two flat greens split by a hard cross.

### 04-outdoor-noon.png
- **Genuine MM6? NO**
- Tells: same black ground (median luminance 10.1 at *noon*, the brightest moment in the
  game). The hill is a solid black wedge whose silhouette meets the sky on a hard 1 px
  edge with zero haze — MM6 draws a 39 px fade band above the horizon plus a sub-sky fill
  in the haze colour. Sky gets *darker and more saturated* toward the horizon (#83ABCF at
  the top of the viewport, #5C8DB7 just above the terrain), which is inverted. HP and SP
  tubes in the party bar are empty.

### 05-outdoor-looking-down.png
- **Genuine MM6? NO**
- Tells: the tree trunks **lean**, fanning left on the left of frame and right on the
  right, and converge with camera pitch. MM6 tree sprites are billboards and are always
  dead vertical on screen no matter where the camera looks; leaning trunks prove these
  are 3D meshes. A long thin green diagonal line runs from the top edge down to the right
  — a stray geometry sliver. The frame is titled "looking down" but shows mostly sky, and
  the vertical look is well past MM6's ±22.5° pitch clamp.

### 06-outdoor-walk.png
- **Genuine MM6? NO**
- Tells: as 03/04. Ground median luminance 10.1. Roughly 55 % of the viewport is a
  featureless black field with a few faint green blotches. The trees are all the same two
  models repeated at the same scale.

### 07-outdoor-dusk.png
- **Genuine MM6? NO**
- Tells: labelled dusk, but the terrain is at exactly the same luminance as noon (median
  10.1) because it is already floored at black; only the sky moved (median luminance
  131 → 39). Sky and ground are therefore tonally decoupled, which is the precise
  opposite of MM6 where sky, terrain and sprites all receive the same grey multiply
  (#FFFFFF at 13:00, #5F5F5F at 21:00, #272727 at night). Nothing about this frame reads
  as evening.

### 08-outdoor-night.png
- **Genuine MM6? NO**
- Tells: the viewport is functionally empty. Ground samples are a uniform **#080808**;
  the tree silhouettes are barely separable from the background. MM6 night is a dark but
  *legible* version of the same scene at tint #272727 with an ambient floor of 0.15 that
  keeps terrain off black. Here there is no floor at all.

### 09-outdoor-dawn.png
- **Genuine MM6? NO**
- Tells: as 07. Ground unchanged from noon (median 10.1); sky median 32. Dawn and dusk
  are visually indistinguishable from each other and from a night sky over a black field.

### 10-combat.png
- **Genuine MM6? NO**
- Tells: a floating green **health bar** with the label "Goblin" is drawn at the top
  centre of the viewport. MM6 has no monster health bars and no floating nameplates —
  the monster's name appears in the status line on hover, and its health is inferred. The
  Goblin itself is an unreadable dark smudge roughly 20 × 30 px with a single magenta
  pixel; MM6's `GoblinA` is a fully textured, smooth-shaded, 8-octant pre-rendered
  billboard about 80 × 128 source pixels, clearly green-skinned with a club.

### 11-combat-attack.png
- **Genuine MM6? NO**
- Tells: the combat log is drawn *inside* the 3D viewport as a stacked multi-colour list
  — "The party gains **139** experience." in gold with the number in a second gold,
  "Alaric takes **1** damage." in red. MM6's feedback is a single Lucida status line in
  the bottom bar drawn with main colour #0A0000 over shadow #E6D6C1, plus plain cream
  in-view text; it never mixes gold and red per-word like a modern RPG combat log. The
  hit effect is a handful of loose orange and red pixels with no sprite structure.

### 12-combat-turnbased.png
- **Genuine MM6? NO**
- Tells: the turn indicator is a thin-outline vector clock face with a single hand,
  drawn at roughly (435,312). MM6 uses `turn0`…`turn5` — a painted hand/clock sprite at
  (394,288) — and `turnhour`, a painted hourglass. Four log lines now stack up the
  viewport. HP/SP tubes still empty although the party has taken damage.

### 13-charsheet.png
- **Genuine MM6? NO**
- Tells: panel geometry is right (background exactly replaces the 8,8→461×345 viewport)
  but the surface is a smooth vertical olive-brown gradient with a soft vignette, not
  parchment; MM6's sheet is #C8B48C paper with fibre. The five tabs are evenly spaced
  grey rounded rectangles with text labels — MM6's are painted tabs at y=316, x=20/110/
  200/290 with Exit at 379. The paperdoll in the right panel is a flat orange-and-tan
  mannequin with a circular smiley head, and each equipment slot is drawn as a visible
  grey rounded box with a line-art glyph. MM6 draws equipment art directly onto a painted
  body with no slot chrome at all.

### 14-inventory.png
- **Genuine MM6? NO**
- Tells: the 14 × 9 grid of 32 px cells at (14,17) is dimensionally correct (measured
  447 × 288 from x 18), but it is drawn as a bright orange wireframe over a flat brown
  fill. MM6's `fr_inven` is a painted panel with subtly embossed cells. The panel is
  completely empty of items, and carries the tutorial line "Click an item to pick it up.
  Right-click to inspect it." — MM6 never explains its own controls on-screen.

### 15-spellbook.png
- **Genuine MM6? NO**
- Tells: the school tabs are nine flat coloured rounded rectangles with **text labels**
  ("Fire", "Air", "Water"…) and geometric glyphs. MM6's are painted bookmark tabs down
  the right edge at fixed coordinates (399,10 / 399,46 / 399,83 / …) with no lettering.
  The page content is a bulleted text list with a coloured dot and a number, not the
  hand-authored `pIconPos` layout of painted spell icons on both page faces. Another
  tutorial line ("Left-click casts. Right-click sets the quick spell."). The page is a
  clean flat cream with no ink texture.

### 16-questlog.png
- **Genuine MM6? NO**
- Tells: the quest bodies contain the raw internal map id **`new_sorpigal`** printed as
  prose, and "Cull the Large Rats" appears three times with different counts. There is a
  modern scrollbar with a track, thumb and two arrow buttons on the right page. The tabs
  are grey chips reading "Quests 6 / Notes 0 / Awards 0 / History 0" with numeric badges;
  MM6 renders five overlapping book-spine tabs that flash when new. Yet another tutorial
  line ("Use the tabs on the right margin.").

### 17-mapscreen.png
- **Genuine MM6? NO**
- Tells: the map is a single flat green rectangle divided into four quadrants by one
  vertical and one horizontal seam — there is no map. The legend row overflows the panel
  and the last entry is clipped mid-word ("Wall" cut off at the right edge). MM6's map
  book is the painted `sbmap` page with drawn terrain, roads, water and buildings at
  zoom 384/768/1536.

### 18-quickref.png
- **Genuine MM6? NO**
- Tells: closest frame in the set to a real panel — the four-column table, the gold row
  labels, white values, green "Good" and red low-HP readouts are all plausible. Betrayed
  by the flat gradient background instead of the painted plate, the uniform-stroke pixel
  font, the "Click a column to make that character active." hint, and the grey
  rounded-rectangle Exit button.

### 19-rest.png
- **Genuine MM6? NO**
- Tells: the sky window is a children's-book illustration — a flat lemon-yellow sun disc
  with a soft alpha halo, two lobed white clouds, and flat dark-green triangular
  mountains. MM6's rest window is a painted sky frame that advances with the clock. The
  party readout is a black LCD-style box with rounded green and blue capsule bars. The
  campfire is a set of yellow triangles with a large soft radial glow; MM6 renders fire
  as a `EMITS_FIRE` particle sprite tinted #FF3C1E with no soft alpha. The hourglass is
  two outlined triangles.

### 20-shop.png
- **Genuine MM6? NO**
- Tells: the shopkeeper is a **featureless black silhouette** — a cloak trapezoid with a
  round head. Item icons are single-stroke line drawings: every bow is one brown arc,
  every sword one vertical line with a crossbar. Each is boxed in a bordered cell with a
  caption and a price, and names are truncated with ellipses ("Rusty Sho…", "Short Bow…",
  "Quarters…"). MM6 lays painted item bitmaps directly on the counter with no cells, no
  captions and no truncation. The right-hand dialogue text overflows the panel: "Gold:
  200" is followed by a line clipped by the bottom edge. A stray magenta pixel sits above
  the fifth item. The room itself is a bare brown box with one red ellipse for a rug.

### 21-dialogue.png
- **Genuine MM6? NO**
- Tells: a large semi-transparent black slab is drawn over the lower two-thirds of the
  scene to hold the NPC name and one line of body text. MM6 never does this — dialogue
  body text lives in the right panel, and the 3D/interior area stays unobscured. The
  slab's corner ornaments are four tiny orange triangles. The window in the wall is a
  flat white quad with no glazing detail; the fire is concentric brown arcs with a row of
  orange triangles. The NPC name colour is a plausible #1699E9, which is one of the few
  correct notes in the frame.

### 22-temple.png
- **Genuine MM6? NO**
- Tells: the rose window is a pure-hue colour wheel — saturated magenta, cyan, lime,
  orange and violet segments straight off the primaries. MM6's stained glass is
  palettised and muted, and the temple palette runs #D0CCC0–#F0EEE6 marble with #A8A498
  veining. The priest is another black blob. Candles are white sticks with yellow dots;
  the light shaft is a flat translucent yellow triangle with a soft edge. The party
  condition table is a floating dark panel overlaying the altar.

### 23-tavern.png
- **Genuine MM6? NO**
- Tells: **every human in the room is a black silhouette** — seven identical cloak-and-
  circle shapes at four tables. Lamps are a yellow square inside a soft radial glow with
  a smooth alpha falloff, which is impossible in an 8-bit indexed frame. The fire is a
  row of orange triangles. Bottles on the shelf are 3 px vertical bars. The right panel's
  text overflows: "Gold: 200" is followed by a line cut off by the panel edge.

### 24-options.png
- **Genuine MM6? NO**
- Tells: this is a modern settings screen. Slider tracks with square handles, ticked
  checkboxes, percentage readouts, six large grey rounded-rect buttons in a 2 × 3 layout,
  and — decisively — a **"Touch Controls"** toggle. MM6's Esc menu is the painted
  `options` background with six 214 × 40 painted buttons at (19/241, 155/209/263).

### 25-dungeon.png
- **Genuine MM6? NO**
- Tells: the viewport is **100 % pure black**. No walls, no floor, no torchlight, no
  geometry of any kind. The minimap is likewise fully black. MM6 dungeon corridors sit at
  dimming level 20–28 → #383838–#585858, with the party torch adding an 800-unit radius
  of warm light; they are dark, never absent.

### 26-dungeon-walk.png
- **Genuine MM6? NO**
- Tells: identical pure-black viewport. Walking changed nothing on screen.

### 27-dungeon-look.png
- **Genuine MM6? NO**
- Tells: identical pure-black viewport; only the minimap party arrow rotated.

---

## Ranked defects

Ordered strictly by how much of the screen each one ruins, weighted by how many frames
it appears in.

1. **[FATAL] Lighting / terrain — outdoor ground renders at black.** Sampled over
   x 60–400, y 260–340: median luminance **10.1/255** at *noon* (mean #050F07), and
   identical at morning, dusk and dawn (#081209 / #050D06 / #050B06). Around half of
   every outdoor viewport is a featureless black field. It should be lit grass in the
   #3E5A28–#6E8C3C band (luminance ~72–118) at midday, dropping through a *grey multiply*
   to #5F5F5F-tinted at 21:00 and #272727 at night. Per spec §9 outdoors there is an
   ambient floor of 0.15 plus a diffuse term of ambient+0.3 clamped to 0.85; nothing
   outdoors is ever allowed to reach black. Fix this first — every outdoor frame in the
   set is unreadable because of it.

2. **[FATAL] Lighting / dungeon — indoor viewport renders as pure black.** Frames 25, 26
   and 27 contain no geometry whatsoever: every sampled pixel in the 8,8→461×345 rect is
   #000000. MM6 dungeons are dark but always legible: sector ambient puts corridors at
   dimming 20–28 → **#383838–#585858**, quantised to the 32-step ramp `8×(31−dim)`, with
   the party torch adding a mobile white light of radius 800 units per power level and
   the nearest faces reading warmest. Three of 27 frames are currently a black rectangle.

3. **[FATAL] Sprites — every living thing is an untextured black silhouette.** The
   shopkeeper (20), priest (22) and all seven tavern patrons (23) are flat black
   cloak-trapezoid-plus-circle-head shapes; the combat Goblin (10–12) is an unreadable
   dark smudge with one magenta pixel. MM6 sprites are **pre-rendered from 3D models**
   into 8 octants, fully textured and smooth-shaded, lit by a baked key light from the
   camera's upper-front-left, palettised to 256 colours with banded gradients and a
   hard-keyed 1-bit alpha edge. A `GoblinA` is ~80 × 128 source pixels, green-skinned,
   hunched, in rags with a crude club, magnified ~1.5× with nearest-neighbour at melee
   range. Right now the game has no character art in the world at all.

4. **[FATAL] Lighting — the time-of-day curve is applied to the sky only.** Sky median
   luminance moves 131 (noon) → 39 (dusk) → 32 (dawn) while the ground sits at 10.1 in
   all three. Sky and world are tonally decoupled, so dusk reads as "bright blue field
   over black" rather than as evening. In MM6 the *same* grey multiply
   (`tint = grey(255 − dim)`, #FFFFFF at 13:00 → #5F5F5F at 05:00/21:00 → #272727 at
   night) drives the sky, the terrain, the buildings and the billboards simultaneously —
   that shared multiply is why MM6 reads as one coherent image despite mixing polygons
   and sprites. Whatever path lights the sky must also light the ground.

5. **[MAJOR] Meshes / sprites — trees are 3D geometry, not billboards.** In 05, 06, 07,
   09 and 10–12 the trunks lean, fanning outward from frame centre and converging with
   camera pitch; the canopies are stacks of flat-shaded ellipsoids and the trunks carry a
   repeating horizontal band that reads as brickwork. MM6 trees are **flat pre-rendered
   billboards** (`tree01`…`tree66`), always dead vertical on screen regardless of pitch,
   painted with real branch structure and foliage clumps, 128×192–192×256 source pixels
   at world heights of 400–1000 units, with a hard-keyed silhouette and no shading
   response of their own. They should also be varied — there are at least 66 tree groups
   with autumn/winter variants; the set here shows two shapes repeated.

6. **[MAJOR] Sky and horizon — the gradient is inverted and there is no haze band.**
   Measured at x=430 in 04: #83ABCF at the top of the viewport, darkening and saturating
   to #5C8DB7 immediately above the terrain, then a **hard 1 px cut** to #080808. It
   should go the other way: MM6 draws the cloud plane, then a 39 px fade band above the
   projected horizon (alpha 0 at top → 1 at the horizon) plus a solid sub-sky fill below
   it, both in the haze colour, so the horizon is a soft grey band and distant terrain
   dissolves into it. Clouds are also pure neutral grey (#A4A4A4/#B0B0B0/#BABABA/#C4C4C4)
   against a fairly saturated periwinkle — MM6's `planskyN` clouds are warmer and lower
   in contrast against a greyer blue, and they compress toward the horizon and stretch at
   the zenith because the sky is a perspective-projected *plane*, not a dome or a layer.

7. **[MAJOR] Full-screen panels — they are a modern flat UI kit, not painted pages.**
   Twelve of 27 frames (13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24) are built from
   grey rounded-rectangle buttons with centred text labels, checkboxes, slider tracks
   with square handles, numeric badges, a scrollbar with arrow buttons, and smooth
   vertical gradients with soft vignettes. Every MM6 panel is a **painted 461×345
   illustration** dropped at (8,8): parchment with fibre (#C8B48C, range #A89068–#E4D4B0)
   for the character sheet, #D4C29C for spellbook pages, #CFC0A0 for books, painted tabs
   and painted buttons with carved bevels. Nothing in MM6 is a rounded rectangle. Also
   remove the four tutorial hint lines (14, 15, 16, 17, 18) — MM6 never explains its
   controls in-panel.

8. **[MAJOR] UI chrome — the minimap has no content.** The rect is exactly right
   (measured 488,16 → 137 × 117, matching spec), but it contains two flat greens,
   **#779D41 and #88B44A**, split by one hard vertical and one hard horizontal seam
   through the centre: a nearest-neighbour blow-up of a 2 × 2 image. MM6 samples a
   per-map pre-rendered top-down colour picture at `step = 65536 × imgW / zoom` — you can
   read roads, coastline, water and building footprints in it. It is also drawn as a
   plain bevelled rectangle; `ib-autmask` should cut it into a rounded/arched aperture.
   Indoors it should be #000078 navy with #0000FF wall lines, not black.

9. **[MAJOR] Full-screen panels — the map book is empty.** Frame 17 is the same flat
   4-quadrant green blown up to fill the page. Should be the painted `sbmap` page with
   drawn terrain at zoom 384/768/1536, panning 512 units per press. The legend row also
   overflows the panel and clips mid-word.

10. **[MAJOR] Textures / interior art — flat vector illustration.** The temple rose
    window (22) is a pure-hue colour wheel of saturated magenta, cyan, lime, orange and
    violet; the rest window (19) is a lemon sun disc with lobed clouds and flat green
    triangle mountains; fires (19, 21, 22, 23) are rows of orange triangles; lamps and
    candles (22, 23) are bright squares inside **smooth radial alpha glows**, which
    cannot occur in a 256-colour indexed frame at all. Replace with palettised painted
    art in the documented families — marble #D0CCC0–#F0EEE6 with #A8A498 veining, wood
    plank #5A4028–#8C6844 with knots and grain streaks, plaster #C0B49A–#E0D8C0 with
    timbers — and render fire as an `EMITS_FIRE` particle sprite tinted #FF3C1E with
    1-bit alpha and no falloff.

11. **[MAJOR] Full-screen panels — the paperdoll is a mannequin with slot boxes.** In 13
    and 14 the doll is a flat orange-and-tan articulated figure with a circular smiley
    head, surrounded by ten grey rounded slot boxes each holding a line-art glyph. MM6
    draws a painted body and then paints the equipped items straight onto it; there is no
    slot chrome, no outlines, no boxes.

12. **[MAJOR] Full-screen panels — the spellbook is a text list.** Frame 15 shows a
    bulleted list of spell names with a coloured dot and a number, and nine flat coloured
    tabs with the school names spelled out. It should be painted spell glyphs positioned
    by the per-school `pIconPos` table across both page faces, with unlearned slots left
    as blank parchment, and nine wordless painted bookmark tabs at the fixed coordinates
    (399,10 / 399,46 / 399,83 / 399,121 / 399,158 / 400,196 / 400,234 / 400,271 /
    400,307). Eleven spells per school in MM6, not twelve.

13. **[MAJOR] UI chrome — the HP and SP tubes never fill.** In every one of the 27
    frames, both tubes for all four characters render only the empty recess (#14100C
    edge, #2A2620 well) plus the #6F665A bevel — no fill at any point, including frames
    where the party is at full health and frames where they have taken damage. The
    positions are exactly right (measured at x = 23/138/253/368 and 102/217/332/447), so
    this is purely the fill blit. Should be `ib-statG` #28C828 above 50 %, `ib-statY`
    #E0D020 from 25–50 %, `ib-statR` #D02010 below 25 %, and `ib-statB` #2848D8 for SP,
    each clipped to `height = ratio × 49` and anchored at the bottom of the 5 × 49 slot.

14. **[MAJOR] UI — floating monster nameplate and health bar.** Frame 10 draws a green
    health bar with the caption "Goblin" at the top centre of the 3D viewport. MM6 has no
    world-space nameplates and no monster health bars anywhere; the monster's name appears
    in the status line on mouse-over and its health is never numerically exposed. Remove
    it outright.

15. **[MAJOR] UI chrome — all four party portraits are the same face.** Frames 02–27 show
    one generated head repeated four times with a hood recolour (green / grey / green /
    green) and slightly different eye colour. MM6 ships a distinct painted portrait per
    character with **56 expression frames** each; four identical faces in the party bar is
    visible at a glance in every single frame. The portraits are also rendered with smooth
    airbrushed gradients rather than palettised painting.

16. **[MAJOR] Sprites / textures — item icons are line drawings.** In 20 every bow is one
    brown arc, every sword one vertical line with a crossbar, the axe a single white
    curve. MM6 item bitmaps are painted objects of arbitrary size (typically 32–96 px) with
    modelled metal and wood. The shop also boxes each in a bordered cell with a caption and
    price and truncates names with ellipses ("Rusty Sho…"); MM6 lays the bitmaps directly on
    the painted counter with no cells and no captions.

17. **[MAJOR] Fonts and text — the message log is a modern coloured combat log, and the
    status line is drawn twice.** Frames 11, 12, 25 stack up to four lines inside the
    viewport with per-word colour mixing (gold number inside a gold sentence, red number
    inside a red sentence, white sentences). Frames 03–09 print the same string both in the
    viewport at bottom-left *and* in the bottom bar. MM6 has one status line, in Lucida,
    baseline y=357, centred in a 450 px field from x=11, drawn as main #0A0000 over shadow
    #E6D6C1 (the engraved look) — and it says one thing at a time.

18. **[MINOR] Fonts — wrong face.** All text in the set is a uniform-stroke pixel face with
    flat terminals. MM6's fonts are rasterised real serifs: **Lucida** (~11–12 px, moderate
    stroke contrast, proportional) for all body text and **Arrus** (~14–16 px, heavier serif
    display) for headers, with the 1 px drop shadow **baked into the glyph bitmap** as a
    second colour index rather than offset-blitted at runtime. The current face reads as
    "pixel-art game font", which is a 2010s aesthetic, not a 1998 one.

19. **[MINOR] UI chrome — right panel details.** (a) The compass is the letter **"N"** in
    a black slot; it should be `IB-COMP`, a ~240 px panoramic ribbon scrolled to
    `round(yaw × 0.1171875) + 285` behind a 26 px aperture clipped to (541,0,26,480). (b)
    Empty hireling slots render as two large flat brown rectangles at roughly (489,152) and
    (559,152); when no hireling is present MM6 shows the panel art, not filled boxes. (c)
    The book tabs and the four action buttons are flat grey squares with line-art glyphs;
    they should be `ib-td1-A`…`ib-td5-A` overlapping book spines and the carved `ib-m1d`…
    `ib-m4d` buttons at (476/518/560/602, 450), ≈40 × 35 each.

20. **[MINOR] Full-screen panels — text overflows and clipping bugs.** The right dialogue
    panel runs past its own bottom edge in 20 and 23 (a line is cut in half by the panel
    boundary below "Gold: 200"); the map legend in 17 is clipped mid-word.

21. **[MINOR] Text content — engine identifiers leaking into prose.** The quest log (16)
    prints the internal map id `new_sorpigal` as part of every quest body, and lists "Cull
    the Large Rats" three times with different counts. Nothing in MM6 exposes a snake_case
    id to the player.

22. **[MINOR] Title and chargen framing.** 01: the castle is untextured black polygons with
    flat maroon roof triangles over a smooth dithered radial sunset; the menu is a flat grey
    plate. 02: a three-column dashboard with translucent coloured ribbon banners and grey
    `–`/`+` stepper chips. Both need to become painted illustrations with carved chrome.
    Also drop the "A procedurally generated homage" strapline and the "v1.0" watermark —
    they announce the imitation before anything else in the frame does.

23. **[MINOR] Anachronistic option.** The options screen offers **"Touch Controls"**, along
    with checkboxes, percentage readouts and slider handles. Even if the feature must exist,
    it cannot be visible in a frame that is claiming to be from 1998.

24. **[MINOR] Turn-based indicator.** A thin-outline vector clock face at roughly (435,312).
    Should be the painted `turn0`…`turn5` hand/clock sprite at (394,288), plus `turnhour`
    (an hourglass) during the monsters' turn.

---

## What is already right

Listed only so it does not get broken while fixing the above. The 3D viewport measures
exactly x 8–467, y 8–352; the right panel begins at x=468; the bottom bar begins at
y=352. The minimap rect is exactly (488,16,137,117). The HP/SP slot x-coordinates are
exactly 23/138/253/368 and 102/217/332/447. The chrome mid-tone is #585046 against a
target of #5A5248, and the empty-bar recess is #2A2620 on the nose. Full-screen panels
correctly replace only the viewport and leave the right panel and bottom bar live. The
frame holds ~276 distinct colours, which is in the right neighbourhood for an 8-bit look.
The bottom-bar status line uses the correct cream-over-dark engraved treatment. The NPC
name colour in dialogue is a plausible #1699E9. The layout skeleton is genuinely accurate;
it is the *rendering* and the *art* that fail.

---

## Score

Overall indistinguishability: **31/100**

The chrome geometry is measurably correct to the pixel in several places, which is why
this is not lower. But nine of the 27 frames are dominated by a black or flat-green
rectangle where the world should be; every character in the game is a black silhouette;
and twelve frames are a modern flat UI kit that would not have been drawable, let alone
drawn, in 1998. No one familiar with the game would hesitate over any single frame here.

---

## Verdict

**NOT YET**
