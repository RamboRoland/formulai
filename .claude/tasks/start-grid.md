# Start grid (per layout, editor + game)

Robin (2026-10-29): a real starting grid. Each layout has N start
positions; cars are placed over them, filled from the front.

## Decisions
- **Per layout:** `gridSlots` (number, min 2), set in the editor's layout
  bar. Omitted = 2. `gridPole` ('left' | 'right', seen in the direction of
  travel — depends on the first corner), toggle in the layout bar.
  Note: slot 1 is off the centreline → single player / AI spawn moves
  sideways vs today.
- **Per track** (shared by all its layouts, defaults = go-kart): gap start
  line → front of box 1 (1 m), row = box to box, alternating sides (3 m;
  same column = 2 × row), column spacing between the two columns' centres
  (3 m), box size (2 × 1.2 m — narrower than the karts, painted marking).
- **Boxes:** two columns, staggered (F1 style), following the road
  BACKWARDS from the start line along the centreline (may sit in a curve;
  there is always road behind the start — may continue onto a connected
  path). Car front at the front of its box, facing the track direction.
- **Editor:** every box drawn + numbered, live; same grid function as the
  game (like `checkpointEnds`).
- **Order:** random shuffle at every stage start, filled from the front.
  More cars than slots → wrap: 5 slots, cars 6–10 fill slots 1–5 again.
- **Single player / AI mode:** all slots drawn, the car uses slot 1.
- **Restart:** each car back to its own slot.
- **completedMeters:** `leadIn` per car (distance along the road from the
  car to the start line), so back rows count correctly.
- Never write Robin's track JSON: test on copies, he saves from the editor.

## Phase 1 — grid function + data
- [x] 1. Read paths / route / junction code: how to walk backwards from
      the start, across a path's start onto the connected path
- [x] 2. Present the grid function design to Robin (signature, constants)
      → approved: gap 1 m, row 6 m, box 2.2 × 1.6 m, columns ± halfWidth/2,
      junction = direction that lines up; gridPole default 'left'
- [x] 3. `Layout.gridSlots` / `gridPole` (types) + serialize export/import
      (import rejects gridSlots < 2 / bad pole); route.ts exports
      `pathLength` + `pointAt`
- [x] 4. Grid function (new file, `app/tracks/vector/grid.ts`)
- [x] 5. tsc clean + scratch test on COPIES (real files shasum-unchanged):
      12 layouts × left/right × 10 slots — every box fully on track, pole
      side right, 1/4/7…28 m along the road; round trip keeps the fields
      and leaves unset layouts unset.
- [x] 6. Robin: spacing + box per TRACK (`TrackJSON.grid`, GridSettings:
      gapM 1, rowM 3, columnM 3, box 2 × 1.2 m defaults = GRID_DEFAULTS),
      count + pole per layout. Junction crossing removed ("skip"): open
      start path → boxes stop at its entry end. Re-tested: tsc clean,
      12 layouts × default + custom (col 4 / row 5) × left/right × 10
      slots all on track; straights measure exactly 3 / 6 m (curves
      differ: straight-line measure); grid round trip + rowM 0 rejected.

## Phase 2 — editor
- [x] 1. Editor state `grid` (VectorTrackState, Open → state, state → Save)
- [x] 2. Layout tab list (bottom-left): collapsible "Start grid" section —
      This layout: Positions (≥ 2), Pole Left/Right; All layouts (track):
      Gap, Row, Columns, Box length, Box width (m, > 0). Duplicate copies
      gridSlots / gridPole
- [x] 3. Draw the boxes behind the start line (front line + sides, open at
      the back; pole yellow), numbered from pole, constant-size labels
- [x] 4. tsc clean
- [x] 5. Claude browser test (Chrome, Torslanda, never Saved; shasum
      unchanged, no console errors). Bug found + fixed: DOMMatrix.rotate
      takes DEGREES (boxes were unrotated). Verified: GP 8 boxes behind the
      line, pole left/right, Row 5 m spreads them; Training 7 (start in a
      curve) keeps its own positions/pole, gets the track's Row 5 m, boxes
      follow the curve; Positions 1 / Gap 0 rejected; Duplicate copies
      positions + pole
- [x] 6. Robin: "Staggered" toggle, per track (`grid.staggered`, default
      true). Off = side by side: pairs, rows 2 × rowM apart (1/1/7/7… m).
      Pole + Staggered share `gridChoice` (two-button row). Tested: all
      layouts on track side by side, 3.00 m apart even in a curve; round
      trip + bad value rejected; browser: Torslanda GP pairs 1+2…7+8
- [ ] 7. Robin checks it in the browser

## Phase 3 — game
- [x] 1. `Track.grid` built once from the layout (same gridSlots call)
- [x] 2. `GameEngine.assignGrid`: shuffle, `gridSlot = i % count`, reset —
      constructor, nextStage (after advancing), restartSession. One player
      → pole, no mode checks (multiplayer runs as 'ai')
- [x] 3. `Car.gridSlot`; `reset()` → `Track.spawn(len, slot)` (front at the
      box front); restart keeps it
- [x] 4. Lead-in along the road: `Track.behindStart` (start path, nearer way
      round a loop) replaces the straight start-direction measure;
      `leadIn(len, slot)` = behindStart of the spawn itself (cached) — a
      first version (back + len/2) was off 0.06–0.18 m in curves
- [x] 5. tsc clean. Proof on copies of Robin's updated tracks (gap 2, row 1,
      side by side, 8–20 boxes): 522 spawns (12 layouts × every box × 3
      karts) fully on track, completedMeters 0 at spawn, no row overlap.
      Engine: 10 players unique slots; 0 at spawn; 1 s driving ≈ distance;
      restart keeps slots + boxes; next stage (8 boxes) wraps 10 cars;
      pole spread over 200 grids; one player → pole. Browser single player:
      spawns in pole box, no console errors
- [x] 6. Robin: see the boxes in the game. `drawGridBoxes` (grid.ts) shared
      by editor (numbers, pole yellow) and `Track.draw` (white paint, 0.1 m
      lines, no numbers) → 2D renderer + 3D track texture, every mode.
      Browser: single player 3D shows Training 1's 8 boxes, car in box 1;
      editor unchanged after the refactor; no console errors
- [x] 7. Sharp lines (Robin: "low res / jagged"):
      - Game canvas high-DPI (RacingView backing × devicePixelRatio, CSS
        1000 × 700; Renderer scales by pixelRatio, zoom stays CSS px).
        Cause of the low res in EVERY mode: 1000 × 700 canvas shown at
        2000 × 1400 on Retina
      - 3D texture cap 4096 → 8192 (clamped to GPU max) — only chase /
        cockpit use it; Robin to decide keep or revert
      - Box lines along the road (`gridLines`): sides follow the road,
        nose-to-tail boxes join into one line per column (was: straight
        pieces per box → kinks at joints). Slots + lines share `startRoad`.
        Editor: lines white, pole number yellow. Re-tested: 522 spawns,
        engine checks, 4 continuous side lines per layout; browser crops
- [x] 8. Robin: paint 10 cm INSIDE (not centred): `GRID_PAINT_M` 0.1 —
      box size = outside, lines inset half a line; game track edge
      (`Track.draw`) stroked 2 × 10 cm clipped to the asphalt (was 2 screen
      px, centred). Editor outline unchanged. Browser crop + tests ok
- [x] 9. 3D paint as geometry (chase / cockpit / free): `Track.paintStrips`
      (grid box lines + edge inside every ring, + 5 cm onto the grass to
      hide the texture's soft asphalt edge) → `engine/paintStrips.ts`
      (mitred strips, faces up, normals up) → `Scene3D.trackPaint` mesh
      (polygonOffset over the surface, visible in perspective only);
      texture baked with `Track.draw(..., paint = false)`. Bug found +
      fixed: faces pointed down (grey, lit from below). Browser: chase +
      cockpit sharp, FPS ~108–132, no console errors
- [x] 10. 3D without texture (Robin: "more optimized"): asphalt mesh
      (`engine/trackGround.ts`, outline rings triangulated, even-odd
      holes), start / finish squares as quads (`checkeredCells`, shared
      with the 2D drawing; `Track.paintQuads`), paint with vertex colours,
      tyre walls as stacked 3D tyres (2 high, instanced, `Track.tyres`).
      Texture + bake removed; `Track.draw` paint param removed again.
      Checkpoint lines no longer shown in 3D. Browser: orbit / cockpit,
      tyres visible, FPS ~109–119, no console errors
- [x] 11. Docs: `.personal/CLAUDE.md` (Car reset, completedMeters lead-in,
      restart, new "Start Grid" + "Rendering"), `.personal/vector-tracks.md`
      (Layout + GridSettings types, "Start grid", Game rendering), README
      (completedMeters comment, "Start grid" section + boxes per layout)
