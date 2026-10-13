# Vector Runtime — Stage 2 Build Order

Goal: published vector tracks are drivable. The game draws the track,
detects collisions and casts the AI rays from a per-track **outline**
(bezier curves) that is generated from the centerline and can be
fine-tuned by hand. No pixel sampling anywhere. Design background:
`.personal/vector-tracks.md`.

Each step ends with a check Robin verifies before the next one starts.

---

## Today (what has to change)

| Piece | Now | Problem |
|---|---|---|
| `Track.draw()` | no-op | nothing visible |
| `Track.isPointColliding()` | always `false` | car never collides |
| `Track.checkpoints` | `[]` | no laps, no lap times |
| `Car.findEdgeInDirection()` | pixel walk on a collision canvas | rays read an empty canvas |
| `trackWidth` / `trackHeight` | max anchor x/y + 100 | vector tracks have negative coords (editor origin is centered); overview camera + parking assume origin 0,0 |
| Car spawn | `car.x/y = startPosition` | car `x/y` is NOT the center (`center = x + widthPx/2, y + lengthPx/2`), so the car spawns offset from the start line |

## Decisions (locked 2026-10-12)

- **The outline is track data.** Stored per track in the JSON as closed
  rings of bezier curves (an outer ring + the infield ring(s)). Shared by
  every layout.
- **Generated only on a button click** (editor → Outline tab →
  "Generate"). Editing anchors afterwards does NOT regenerate it; the
  editor flags it as possibly out of date.
- **Fine-tunable by hand**: drag outline nodes and handles, with the
  computed outline drawn underneath as a guide.
- **The game uses the outline for almost everything**: surface render,
  collision, rays, bounds. The centerline is still used for checkpoints
  (projection + line width), spawn position/heading and lap order.
- **Generation** (measured in the experiment):
  `computeSmoothOutline(anchors)` → exact smooth edge of the editor's band
  (swept disc + anchor discs, Clipper only trims fold-overs), then
  `fitClosedRing(ring, 0.25)` → curves. Robin's track: 44 curves, ~40 ms.
  Big synthetic (40 anchors): ~515 curves, ~180 ms.
- **Fitting tolerance**: 0.25 px.
- **Spawn**: car centered across the track, front bumper 1 m behind the
  start line, facing the direction of travel.
- **Finish line**: checkered strip, two rows of squares, second row
  staggered by one square. Same drawing in the editor and the game.
- **Checkpoints drawn in the game**: start + finish only; intermediate ones
  only with the debug toggle.
- **Pixel code**: deleted in this stage, last step.
- **Dependency**: `clipper-lib` (Boost license), editor-side generation
  only — the runtime never needs it once the outline is stored.

---

## O — Outline authoring (editor)

### O1 — Data + format
- [x] Types: `OutlineNode { pos, in?, out?, asymmetric? }` (handles like
  anchors), `OutlineRing = OutlineNode[]` (closed), `TrackJSON.vector.outline?:
  OutlineRing[]`.
- [x] `serializeTrack` / `deserializeTrack` round-trip it (0.01 px
  rounding, Vector re-wrapping, validation).
- [x] Editor state holds `outline` + `outlineAnchorsKey` (anchors snapshot
  at generate time, in memory only; `anchorsKey()` helper).

**Check:** save → open round-trips an outline unchanged.

### O2 — Generation
- [x] `generateOutline(anchors)` = `computeSmoothOutline` + `fitClosedRing`
  (0.25 px) → `OutlineRing[]` (curve ends become shared nodes; sharp
  corners keep independent handles). `ringToCubics(ring)` for consumers.
- [x] Remove the old disc-based `computeTrackOutline`; `TrackGeometry`
  now takes ready-made rings.
- Verified: rectangle 40 nodes, Robin's 44, hairpin 36, big 510; max
  deviation 0.23–0.245 px (0.247 after a save round-trip); smooth nodes
  all have mirrored handles; 2 rings on every track.

**Check:** generate on Robin's track + the test tracks; node counts and
deviation match the experiment.

### O3 — Outline tab
- [x] New editor tab "Outline" (order: Track, Outline, Checkpoints). Shows
  the band (faint) + the computed outline as a dashed cyan guide (cached
  per anchors snapshot) + the stored outline on top (orange; round dots =
  smooth nodes, squares = corners).
- [x] "Generate outline" / "Regenerate outline" button (asks before
  replacing an existing outline).
- [x] "Out of date" hint when anchors changed since the last generate.
- [x] Select a node → drag it (snap-aware, handles follow); drag its
  handles (opposite handle mirrors DIRECTION but keeps its own length on
  smooth nodes; independent on corners; Alt flips for the drag and commits
  on release). Closest of node/handles wins a click (short generated
  handles). Esc deselects.
- [x] Snap on the Outline tab = the computed edge, not the grid: a dragged
  node always sits on the nearest point of the edge (glides along it); a
  dragged handle's direction locks to the edge direction at its node
  (length/side still from the mouse). Snap toggle / Shift = free.
  (`EditorContext.isSnapActive()` added.)
- [x] Fixed (pre-existing): shell's Background button showed on the wrong
  tab (switchTab rendered shell overlays before updating the active tab).
- [x] Insert a node by clicking the outline between nodes (exact de
  Casteljau split, shape unchanged — measured 0.005 px); Delete/Backspace
  removes the selected node (min 3 per ring). Delete refits the joined
  side (`fitCubicWithTangents`: neighbours' handle directions kept, lengths
  fitted) — insert→delete restores the original within 0.003 px; deleting
  an original node on a bend stays within 0.08 px of the old two sides.
- [x] Centerline points (anchors) shown as blue dots, read-only.

**Check:** generate, tweak a corner, save, reopen — tweak kept.

### O4 — Publish rule + checkpoint lines
- [x] Publish requires an outline ("Generate the outline first (Outline
  tab)."). A possibly out-of-date outline still publishes.
- [x] Checkpoint lines run edge to edge of the OUTLINE (rays from the
  centerline point, perpendicular), in the editor and (R2) the game, via
  `app/tracks/vector/outlineShape.ts` (`ringToCubics`, `flattenOutline`,
  `buildOutlineGeometry`, `checkpointEnds`; runtime-safe, no Clipper).
  No outline → ± centerline half-width + hint. Verified: ends 0 px off the
  outline; a node pulled out 40 px lengthened the line 192 → 228 px.
- [x] Checkpoints tab draws the track surface from the outline when one
  exists (`outlinePath`, even-odd fill), so lines end at the drawn edge.

---

## R — Runtime (game)

### R1 — Geometry from the stored outline
- [x] At track load: flatten the outline curves adaptively (≤ 0.1 px) into
  rings → `TrackGeometry` (`Track.outline`, `Track.geometry`).
- [x] No outline in the file → track loads but isn't raceable
  (`geometry = null`); console error names the track.
- Verified: Robin's track loads in 1.1 ms (177 + 95 flattened points);
  start on track; rays from the start 96 px left/right (= half-width),
  266 fwd, 481 back; infield off track. The game page loads
  `outlineShape.ts` + `geometry.ts` only — no Clipper, no generator.

**Check:** browser console: track loads, bounds + sample rays sane.

### R2 — Track wiring
- [x] `isPointColliding(x, y)` → `!geometry.isOnTrack(x, y)` (no outline →
  false).
- [x] `castRay(...)` on `Track` (no outline → maxLength).
- [x] `checkpoints` → `{ start, end }` lines, edge to edge of the outline
  (`checkpointEnds`, same as the editor). Lap order as exported.
- [x] `bounds` (outline; fallback anchors ± half-width); `trackWidth` /
  `trackHeight` = its size.
- [x] Spawn: `Track.spawn(carLengthPx)` → car center + heading; `Car.reset()`
  places from it; `Session.chooseCar` calls `reset()` after construction
  (subclass size fields aren't set inside the base constructor).
- Verified: 5 lines, ends 0 px off the outline, first line = start;
  start not colliding, infield colliding, ray left = 96 px; spawn front
  exactly 24 px (1 m) behind the line, 0 px sideways, all 4 corners on
  track — forward and reversed (heading flips 180°, lap order differs).

**Check:** typecheck + checkpoint lines, bounds, spawn in the console.

### R3 — Render in the game
- [x] `Track.draw(ctx, zoom, showDebug)`: outline rings filled (even-odd,
  `#3c3c3c`) + edge line (`#d8d8d8`), every checkpoint as a faint white
  line, start line solid white, finish = two-row checkered strip (0.5 m
  squares). Debug toggle adds checkpoint numbers.
- [x] Checkered finish drawing shared with the editor
  (`app/tracks/vector/checkered.ts`).
- [x] `Renderer` passes its ctx + camera zoom.
- Verified in `/racing/player` with a throwaway `GoKartTrackOne` (deleted).

**Check:** `/racing/player` shows the published track; car on the grid.

### R4 — Collision + rays in the engine
- [x] Car colliding = any corner off the track OR any car side crosses an
  outline edge (`Track.segmentCrossesEdge`; replaces the 4 × 8 pixel
  samples).
- [x] Rays via `track.castRay` — same 8 angles, same rounding; AI protocol
  unchanged.
- [x] Collision response unchanged (car stops while colliding; reset to
  recover).
- Verified in `/racing/player` (throwaway GoKartTrackOne, deleted): start
  line → checkpoint 1/5; straight into the outer edge → Colliding, car
  stops at the edge; rays end at the edges; Reset → clear, drivable; a
  ray-steering autopilot drove a full lap in 12.7 s (cp 1→5, then Laps
  Completed 1) without colliding.

**Check:** drive into a wall → stops; debug rays end exactly at the drawn
edge; laps and lap times count.

### R5 — Views: bounds instead of origin-0 size
- [x] Multiplayer overview camera fits + centers on `bounds` (5 % margin).
- [x] Parking slots: column in the top-right corner of `bounds` (same
  layout as before, just offset by the bounds).
- [x] Drop collision/background canvas sizing from `RacingView`.
- Verified by calculation only (Robin's track: zoom 0.658, view 1520 × 1064
  around the bounds center). Not run live — needs the WS server + players.

**Check:** multiplayer host overview frames the whole track.

### R6 — Delete pixel paths
- [x] Removed `Car.findEdgeInDirection`, `Car.drawRay`, `Car.draw`,
  collision/background canvases, `GameEngine`'s `collisionCtx` param,
  `Session.setCanvas` / `setCollisionCanvas` / `loadTrackMedia`,
  `Track.setCanvas` / `setCollisionCanvas` / `loadMedia`, and the unused
  `app/utils/` (checkpointUtils, trackCenterlineUtils, quadtree).
  `RacingView` builds the game directly (no loading screen; errors still
  show the error screen).
- Verified: same autopilot lap as R4 (12.7 s, identical checkpoint
  timings), wall collision, 2 canvases, no console errors.
- `d3-quadtree` in package.json is now unused (ask before removing).

**Check:** typecheck; player, AI and multiplayer pages still run.

### R7 — End-to-end verification
- [x] Player mode: full lap on a loop layout (12.7 s) and a one-way layout
  (start cp 1 → finish cp 4; cp 5 dropped as unused; finishing ends the
  stage → "Session Completed!").
- [x] AI mode: a Node `control` client got GameState over WS (rays 96 px
  left/right = half-width, plausible diagonals), drove forward 1 s →
  speed 30.5, checkpoint 1.
- [x] Reversed loop layout drives the other way (heading 136.8° vs
  −43.2°, full lap, no collision).
- Also: default racing zoom 0.6 (was 1.0); `d3-quadtree` removed.
- Fixed (pre-existing bugs found in R7):
  - AI/multiplayer GameState `track.name` was always "Track"
    (`constructor.name`) → now `track.name`.
  - Summary showed an extra empty lap after the last one →
    `Player.completedLap(endsStage?)` only opens a new lap if the stage
    continues; one-way finish passes `endsStage` (no more patching
    `lapsCompleted` in the engine).
  - Lap clock ran from page load → `Player.addLapTime` only counts from
    crossing the start line until the stage is complete. The engine's own
    unused page-load lap clock (`lapTime`, `getLapTime`, …) was removed;
    `lapCompleted` events carry the player's lap time.
  - Verified: idle 2 s → 0.0 s; 3-lap loop summary = exactly 3 laps
    (12.53 / 12.16 / 12.14 s); one-way summary = exactly 1 lap; AI state
    name "GoKartTrackOne", lapTime 0 before driving.

---

## Experiment log (S1, 2026-10-12)

- Disc + quad union with Clipper: exact (0 mismatches vs the editor shape)
  but 800 ms on a 40-anchor track; outline ~11,600 points.
- Wedge shortcut instead of full discs: 6× faster but wrong (2 % of points,
  up to 50 px deep) wherever the width changes → dropped.
- Curves fitted to the union outline: accurate, but the outline's tiny
  kinks force thousands of curves at 0.1 px.
- Curves fitted to the smooth swept-disc edge: Robin's track 274 → 44
  curves (0.25 px), big track 6,889 → 515, build 159 ms. Known gap: up to
  2.5 px on extreme tapers (width changing faster than the track
  advances), and straight→arc junctions cost a few extra curves.

## Review

Stage 2 is built: published tracks with an outline are drivable in player,
AI and (by calculation) multiplayer views; no pixel code remains.

What changed from the original plan:
- The capsule/centerline collision idea was replaced by a stored, editable
  bezier OUTLINE (Robin's call: precompute the edge, then fine-tune it by
  hand). Generation fits curves to the exact swept-disc edge; Clipper only
  in the editor.
- Extra editor work: Outline tab (generate, edit, snap-to-computed-edge,
  insert/delete with refit), checkpoint lines reach the outline, Checkpoints
  tab draws the outline surface, start + finish both checkered.
- Pre-existing bugs fixed along the way: Background button on the wrong
  tab, editor reload on save/publish (Tailwind scan + glob HMR), AI
  `track.name` = "Track", extra empty lap in the summary, lap clock from
  page load.

Still open (not part of this stage):
- README's AI section describes an older WebSocket protocol.
- `TrainingOne` races fixed track names; no session track picker.
- Multiplayer overview/parking not run live (needs WS server + players).
- `offset.ts` / `tessellate.ts` unused leftovers.
- `Practise.ts` / `Session.ts` / `TrainingOne.ts` typecheck errors
  (`Stage.completed`) predate this work.
