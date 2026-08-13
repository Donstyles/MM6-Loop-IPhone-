# How to single-prompt a Might & Magic VI–class game

A field manual distilled from building one: three critique cycles, a wow
wave, a fresh-eyes shipping panel, ~20 specialist agents, 4,198 automated
checks, and one real iPhone that disagreed with all of it. Everything below
is a scar with a lesson attached.

## Part 1 — The truth about "single prompt"

One prompt cannot *contain* a perfect game. It can contain the **factory
that converges on one**: an architecture contract, a testing doctrine, and
an adversarial loop that runs until fresh judges say ship. The prompt's job
is to make the agent build the loop first and the game second. Every clause
in Part 3's prompt exists because omitting it cost us a day.

## Part 2 — The doctrine (why each clause exists)

### Architecture
1. **Write the contract before any code** (`ARCHITECTURE.md`): module map
   with one owner per file, world-units table, palette discipline, perf
   budgets (≤400 draw calls, 60fps on phone), "everything seeded, no
   `Math.random`", "no external assets" if procedural. Agents can work in
   parallel only because file ownership is written down.
2. **Rules engine first, pure and tested.** Stats, skills, spells, items,
   combat math as pure modules with a `systems-test` harness (ours grew to
   4,198 checks). *Then* the law: **glue may only call rules, never re-implement
   them.** Our worst cycle-1 criticals (spells costing 2 SP, shops eating
   gold, quests never completing) were all parallel cheap copies in the UI
   layer that shadowed a correct rules engine.
3. **One canonical model per concept.** Inventory shape, quest container,
   clock, save `mapMeta` — each had two writers and one reader at some
   point, and every one produced a CRITICAL (bag-wiping inventory screen,
   dungeon-save corruption, frozen poison timers). Declare the shape in the
   contract; everyone imports the same helpers.
4. **Deterministic world, persistent RNG.** Layout derives from `worldSeed`
   only (our POIs teleported on reload until it did). Screen-scoped RNG must
   be a persistent per-session registry — `new Rand('rest')` on every screen
   open gave players a rest-ambush sequence they could reroll by reopening
   the panel.

### The playtest harness IS the game
5. **Build the state-dump harness on day one**: `window.__game` (drive:
   newGame, teleport, spawn, setTime, walk-for-ms) and `window.__session`
   (read everything). Every agent tests through it; every claim must cite a
   dump. Document the API semantics prominently — we burned a collision
   audit on `walk()` arming input for *real* time while the probe awaited
   nothing, and `teleport(x, y, z)` being silently called as `(x, z)`.
6. **An end-to-end gameplay test that plays, not renders**: assert XP
   earned, gold moved, loot dropped, panels open AND close, save round-trips.
   Ours passed 31/31 while the real game was unplayable — because it used
   debug paths. So also:
7. **Test the human paths, not the debug paths.** The debug `newGame()`
   skipped chargen; the real chargen produced a party that broke HP bars and
   quests for two cycles. Every judge must reach the game through the title
   screen at least once — and build their party the way a *player* would
   (our MM6 veteran built manually and found combat dead; every other judge
   had used the Recommended button).
8. **Every input binding needs a consumer test.** Our bindings table listed
   `attack: ['KeyA']`; nothing ever polled it, and KeyA was strafe anyway.
   Three hours of a veteran's playtest traced to one unwired key. Assert:
   for each action, a synthetic keypress reaches its handler.
9. **Screenshots are evidence only when someone READS them.** Vision-read
   every capture. Our judge set once showed a screen-filling explosion for
   two cycles as "combat"; a judge set that spawns extinct monster IDs
   grades an empty field. Re-generate the judge set every cycle.

### The adversarial loop
10. **Critique cycles with teeth**: 6 specialist critics (world art, UI,
    systems, mobile, audio, full playtest) → findings with file:line and
    severity → fix squads with **disjoint file ownership** and explicit
    cross-agent API contracts → validate → commit per squad → repeat ≥3×.
    Critics must VERIFY previous fixes on screen, never trust reports.
11. **Fresh eyes at the gate.** After the cycles, a zero-context panel that
    may not read prior findings: a genre veteran, a first-impression judge
    on the target device profile, a technical QA lead, an aesthete hunting
    placeholders. Fresh judges found the two worst bugs of the project
    *after* three cycles of specialists (dead attack key; autosave eating
    the manual save) because they had different habits. Iterate until the
    panel is unanimous SHIP.
12. **First-impression design is a feature**: deterministic spawn on the
    signed main street facing a storefront; safe-arrival grace until first
    input; weak melee singles near town, casters far; quest targets a short
    signposted walk; a progression purchase every ~15 minutes; defeat
    respawns IN town, at 1 hp, weak — and never overwrites the manual save.

### The one that bit hardest
13. **Emulated mobile is not the device.** Chromium with an iPhone viewport
    misses: WebKit's shader compiler (a failed compile = invisible
    surfaces), real safe-area insets, the actual screen (14 Pro Max is
    430×932, not 390×844), Apple GPU behavior. Our four-judge panel passed
    builds the real phone tore apart. Countermeasures, all mandatory:
    - Ship an on-device diagnostic from day one: `?debug` overlay showing
      GPU string, WebGL caps, **captured shader compile errors**
      (`renderer.debug.onShaderError`), layout rects, insets — with a COPY
      REPORT button. The player's device is your only true WebKit rig.
    - Write shaders to strict GLSL ES conservatism: no large const arrays
      with dynamic indexing, explicit precision, no clever preprocessor
      reliance.
    - Get a real-device report into the loop before declaring any mobile
      milestone done.
14. **Two more scars**: name→id resolution must be shared between art and
    data ("Goblin Shaman" baked a sprite but resolved no stats — a husk that
    never cast); and if you ship under the real trademark, flag it — call
    the project an homage with its own name before sharing publicly.

## Part 3 — The single prompt

Paste this to a capable orchestrating agent. It front-loads the doctrine so
the factory self-assembles.

---

> Build me a complete, polished first-person party RPG in the exact style of
> Might & Magic VI (1998) — an original homage, not the trademarked name —
> that runs in mobile Safari and desktop browsers from a single static link,
> 60fps on a phone. Party of four, six classes, point-buy creation with a
> Recommended button; real-time + turn-based combat; stats/skills/masteries,
> nine spell schools with real costs and effects; quests with named givers,
> accept/turn-in, a main chain, and a quest log; shops, tavern, temple,
> training, bank, guilds — all functional with honest gold math; day/night
> cycle, roaming monsters, at least one multi-level dungeon with a boss and
> a working exit; save/load with separate manual and autosave slots.
> All art procedural at 1998 fidelity: 640×480 palettised renderer, ordered
> dither, pre-rendered-style creature sprites with corpses, carved-stone UI,
> painterly portraits and paperdolls (no mannequins), synthesized adaptive
> music with a single music director and a master limiter.
>
> Process requirements, non-negotiable:
> 1. First write ARCHITECTURE.md: module map with one owner per file, world
>    units, palette rules, perf budgets, "everything seeded", canonical data
>    shapes for inventory/quests/clock/save. All later agents obey it.
> 2. Build pure rules modules + a systems-test harness before any UI; the
>    glue layer must call the rules, never re-implement them — add tests
>    that fail if UI math diverges from rules math.
> 3. Build a debug/state-dump harness (drive + read the live game) and an
>    end-to-end gameplay test that asserts observable state through HUMAN
>    paths (title → chargen → play), not debug shortcuts. Every input
>    binding gets a fires-its-action test. Add a collision battery
>    (multi-direction rams, monster-block, projectile-wall, map rim).
> 4. Ship an on-device ?debug diagnostic overlay (GPU, captured shader
>    compile errors, layout rects, insets, copyable report) and write all
>    shaders in strict conservative GLSL.
> 5. Run at least three full critique cycles: six fresh specialist critics
>    (world visuals, UI, systems/economy, mobile touch with real mm
>    measurements, audio coverage by instrumented playthrough, end-to-end
>    playtest) file findings with evidence; fix squads with disjoint file
>    ownership and written cross-agent contracts fix them; every fix is
>    verified on screen by the next cycle's critics. Vision-read every
>    screenshot. Regenerate judge screenshot sets each cycle.
> 6. Design the first session explicitly: deterministic spawn on a signed
>    main street, safe-arrival grace, weak melee near town, close signposted
>    quest targets, a purchase-able progression beat in the first 15
>    minutes, defeat that respawns in town without touching the manual save.
> 7. Finish with a zero-context shipping panel — genre veteran (who builds
>    a party manually), first-impression judge on the real target device
>    profile (exact model dimensions and insets), technical QA (memory,
>    saves, corruption, edge cases), and an aesthete hunting placeholders.
>    Iterate fix-and-repanel until unanimous SHIP at 9+/10. Do not stop at
>    "tests green" — stop at "fresh judges say wow".
> 8. Publish every validated slice to the repo as you go, keep a playable
>    single-file build current at a static link, and end each phase with a
>    committed, pushed, verified build.

---

## Part 4 — Budget reality

This project consumed roughly: 1 architecture pass, 3×6 critic runs, 3×3
fix squads, 1 wow wave, 4 panel judges, 3 polish squads, plus ~20 ad-hoc
probes — on the order of 30+ agent-sessions and several million tokens.
The single prompt above doesn't shrink that work; it makes one orchestrator
spend it in the right order without a human steering every turn. Budget for
the loop, not the first draft: the first draft was never the expensive part.
