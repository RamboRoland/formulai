# Track network + tyre walls — Build Order

Goal: real venues with connector roads (e.g. Robin's aerial photo: one long
loop + cut-throughs, 2 layouts). A track becomes several centerline **paths**; a
layout's route is defined by its **checkpoints** (explicit order + direction)
and its **tyre walls**, which physically close the roads it doesn't use.

Decisions (Robin, 2026-10-13):
- Route = implicit: checkpoints + tyre walls (no junction graph, no route picker).
- Tyre wall = a row of tyres that follows a curve with bend points.
- Order: P1 paths → P2 explicit checkpoint order/direction → P3 tyre walls.
- Lap times differ per direction ("Duplicate reversed" doesn't copy them).
- One shared outline per track (no per-layout outlines): walls close the
  unused roads, so hand fine-tuning happens once and closed roads stay
  visible like at the real venue.

Each step ends with a check Robin verifies before the next one starts.

---

## Today (what assumes ONE closed centerline)

| Piece | Now |
|---|---|
| `TrackJSON.vector.anchors` | one closed anchor chain |
| `flattenCenterline`, `projectOntoCenterline` | one closed polyline, wraps around |
| `computeSmoothOutline` / `generateOutline` | strips for one closed chain → Clipper union |
| Checkpoint order | derived: sorted by arc length along the centerline (`sortAlongLap`) |
| Direction | `layout.reversed` (loop layouts only) |
| Runtime `Track` | projects checkpoints on the one centerline; start angle from its tangent × dir |
| `GameEngine` | only needs ordered checkpoint lines + `isLoop` — no direction test (unchanged) |
| Editor state | `trackState.anchors`, `outlineAnchorsKey` |

---

## Answered questions (Robin, 2026-10-13)

1. **New checkpoint order:** inserted after the selected checkpoint (at the
   end if none selected); ▲▼ buttons in the list to reorder.
2. **Tyre walls are edited in the Checkpoints tab, renamed Layout.** It gets
   a second list (Tyre walls) next to the Checkpoints list; wall bend points
   are placed and dragged on the canvas the same way as checkpoints.
3. **Tyre size:** 0.6 m diameter. Walls collide as a smooth band of that
   width (no gaps between tyres); drawn as individual tyres.

---

## P1 — Multiple paths (shared geometry)

Format:

```ts
type TrackPath = {
    id: string;          // stable, "path-1"
    anchors: Anchor[];   // same Anchor type as today
    closed: boolean;     // main loop = true; connector roads = false
};
// TrackJSON.vector: { paths: TrackPath[]; outline?: OutlineRing[] }
```

- [x] P1.1 Types + serialize: `vector.paths`. Old files with `vector.anchors`
  load as one closed path (`path-1`); saving writes `paths` only. Validation
  messages per path. *Check: Robin's track opens and saves unchanged-looking
  (diff = `anchors` → `paths[0].anchors`).*
  Done: `TrackPath` + `mainPath()` in types; editor state, `Track` and the
  publish check read the main path at the boundary (bridge until P1.4/P1.5;
  the editor would drop extra paths — none exist yet). Verified (vite-node,
  scratchpad): Robin's legacy file → identical except `anchors` →
  `paths[0]` (`path-1`, closed); new format round-trips; missing geometry,
  duplicate path id and bad anchors give readable errors. Typecheck clean.
- [x] P1.2 Geometry helpers take a path: `flattenPath(path)` (open paths don't
  wrap), `projectOntoPath`, and `projectOntoNearestPath(paths, x, y)` →
  `{ pathId, projection }`. Old single-loop callers keep working through
  the main path. *Check: typecheck, game races the migrated track exactly
  as before (autopilot lap time ≈ same).*
  Done: `flattenCenterline(anchors, closed = true)` and
  `projectOntoCenterline(flat, x, y, closed = true)` (open = no closing
  segment, one-sided end tangents); new `vector/paths.ts` (`FlatPath`,
  `flattenPath(s)`, `projectOntoPath`, `projectOntoNearestPath`). No caller
  changed. Verified (vite-node): for all 3 tracks, loop flatten + 2000
  random projections byte-identical to the previous code; open 3-anchor road
  ends at its last anchor (length 200, end tangents along the road);
  projecting past an open end clamps to it; nearest-path picks the right one.
- [x] P1.3 Outline for all paths: `computeSmoothOutline` per path (open path =
  no closing segment; end anchors are full discs as today), one Clipper
  union of everything. Stale key covers all paths. Outline-tab guide + snap
  use the union. *Check: a connector's surface merges cleanly into the loop;
  junction corners are sharp (fine-tune by hand in the Outline tab).*
  Done: `computeSmoothOutline(paths)` / `generateOutline(paths)`; per-path
  pieces in `addPathPieces(anchors, closed, …)`, one union. The Outline tab
  passes its one loop as a single path (`loopPath`) until P1.4 (stale key
  moves to paths there). Verified (vite-node, old code kept in scratchpad):
  edge + fitted outline byte-identical for all 3 tracks; test ellipse loop +
  open cut-through → 3 rings (outer + infield split in two equal holes,
  2 corner nodes each where the roads meet), rendered `junction.png` —
  clean merge, outer edge untouched by the connector's round ends.
- [x] P1.4 Track tab: path list (select / add / delete, closed toggle).
  "New path" places anchors for an open path; the first and last anchor
  **snap onto another path's centerline** (and take its width) so the
  roads join. All paths draw; only the selected one is editable (others
  faded). *Check: Robin builds a connector on a copy of a track.*
  Decisions: no junction links (moving the loop → re-drag the road end);
  automatic labels "1 · Loop" / "2 · Road".
  Done: editor state `paths` + `activePathId` (`createPath`, `activePath`,
  `mainAnchors`, `hasGeometry`, `pathLabel`, `pathsKey` in EditorTab.ts);
  band renderer unions all paths (open = no closing segment); shell
  save/open/camera fit use all paths; Outline tab generates from all paths
  (stale hint "Track changed…"); Checkpoints tab draws all paths, checkpoints
  stay on the main path. Track tab: path bar (picker, New road, Make
  loop/road, Delete path w/ confirm, road hint), other paths faded + click
  to switch, junction snap ring, open-path insert/bezier seeding.
  Verified in a throwaway browser tab (nothing saved): Torslanda opens as
  "1 · Loop", status stays Published; New road + 3 clicks → both ends
  snapped onto loop centerlines with the loop's width (4.14 m); Outline
  regenerate → 5 rings, square corner nodes at the junction; Make
  loop/road toggles; Delete path → back to 1 path, button disabled; no
  console errors.
- [x] P1.5 Everything else that reads `anchors`: editor camera fit,
  `publishProblem` (≥ 1 path with ≥ 2 anchors), runtime bounds fallback,
  CheckpointsTab still uses the main path only (until P2). *Check: full
  editor → publish → race round trip.*
  Camera fit + publish check were already done in P1.4. Tested headless
  (Robin chose option A; vite-node, in memory, app/assets untouched):
  oval loop + open cut-through → generateOutline → serializeTrack → JSON
  → Track. 22/23 pass: cut-through + both junctions on track (incl. near
  its edges), infield off; rays run through the junction to the far edge
  (60 / 510 / 960 as expected); car sides cross no edge loop → road;
  6 checkpoint lines ≈ 120; spawn on track; bounds ±960 × ±510. The one
  "fail" (start heading 91.1° vs 90°) is the test oval's shape — same
  value without the cut-through. A checkpoint placed in a junction still
  got a normal 120 line. Runtime bounds fallback (no outline) now covers
  every path's anchors ± their own half-widths (`Track.ts`); verified with
  a loop + wider road sticking out → −10,−10 .. 325,110. Real tracks have
  outlines, so their bounds don't go through this path. Typecheck clean.

## P2 — Explicit checkpoint order + direction

Format:

```ts
type Checkpoint = {
    pos: Vector;
    path: string;        // id of the path it sits on (no ambiguity at junctions)
    dir: 1 | -1;         // direction of travel vs. the path's anchor order
    isStart?: boolean;
    isFinish?: boolean;
};
// Layout.checkpoints: array order IS the lap order (start first).
// Layout.reversed: removed.
```

- [x] P2.1 Types + serialize + migration: old checkpoints get `path` = main
  path, order = today's `sortAlongLap` result, `dir` = −1 if the layout was
  `reversed` else 1. Checkpoints after a one-way finish stay "unused" (=
  after the finish in the list). *Check: migrated file races identically
  (same lines, same order, same spawn heading).*
  Done (Robin chose B: the editor's Direction button is removed now;
  reversing = "Duplicate reversed" only; `dir` always written). Legacy =
  a layout whose checkpoints have no `path` → main path, FILE order kept
  (= what the game raced), `dir` = −1 only for a reversed loop. New
  `normalizeLapOrder` (start first, nothing after a one-way finish — the
  engine needs index 0 = start, last = finish) on load + save; save no
  longer sorts. `layoutDir` = start checkpoint's `dir` (editor auto-sort
  until P2.3). Track start heading = start `dir`. Duplicate reversed =
  start first, rest reversed, `dir` flipped. Backup of app/assets/tracks +
  sessions in scratchpad/backup-2026-10-13. Verified (vite-node, old code
  copy in scratchpad/oldp2, files read-only, md5 unchanged): all 10
  layouts in 5 files race identically (lines, order, start/finish, spawn,
  heading, bounds); new format saves + loads to the same game; otherwise
  same JSON as the old save; Duplicate reversed = identical race to the old
  `reversed` flag on 4 tracks; unknown path / bad dir / mixed old+new give
  readable errors. Typecheck clean.
  Then (Robin): "Duplicate reversed" split into two buttons — **Duplicate**
  (copy as-is, lap times included) and **Reverse** (loop layouts, in place,
  same transform as above, lap times reset to 0).
- [x] P2.2 Runtime `Track`: each checkpoint projects onto ITS path; start
  angle from the start checkpoint's path tangent × `dir`. Engine unchanged.
  Done: `Track` flattens all paths once (`flattenPaths`) and projects each
  checkpoint with `projectOntoPath` (respects open/closed); the unused
  public `Track.anchors` removed. Verified (vite-node, files read-only, md5
  unchanged): all 11 layout loads identical to the pre-P2 code, both as on
  disk and re-saved in the new format; fake oval + cut-through: checkpoint
  on the cut-through → 120 line straight across it, start (0, −200)
  heading 90° (dir −1 → −90°), spawn on the cut-through; the same point
  tagged `loop` snaps to the loop instead. Typecheck clean.
- [x] P2.3 Checkpoints tab: placing projects onto the nearest path; order per
  Q1 (after selected, ▲▼ in the list); new checkpoint's `dir` = previous checkpoint's if on the same
  path, else 1. Arrow on EVERY checkpoint; **Flip direction** in the
  inspector (key F). Remove auto-sort + Direction toggle. "Duplicate
  reversed" = start stays first, rest reversed, all `dir` flipped, no lap
  times. *Check: Robin sets up both layouts of a two-route track.*
  Done: editor auto-sort gone — list order = lap order. Placing snaps to
  the nearest path; inserted after the selection (none: end of lap, on
  one-way just before the finish) and becomes the selection so clicks
  chain; placing mode keeps the selection. New `dir`: prev's on the same
  path, else the way along the new path pointing away from prev. Arrow on
  every checkpoint; F / "Flip direction (F)" flips; ▲▼ in the list (start
  fixed at #1); "Set as Start" rotates the list to it. Drag stays on the
  checkpoint's own path. Unused = after the finish in the list
  (`unusedSet(cps)`). Delete path (Track tab) also removes checkpoints on
  it (named in the confirm). Removed dead code: `sortAlongLap`,
  `ghostIndex`, `layoutDir`, `lapOffset`, `mainAnchors`. Verified:
  typecheck clean, P2.2 proof still all-pass; browser (isolated tab,
  throwaway loop + road, nothing saved, asset md5s unchanged): placing on
  loop + road with correct auto arrows, F flips, ▲ moves, Set as Start
  rotates, Reverse, insert after selected → #3, Delete path removes its 2
  checkpoints with a clear confirm; no console errors.

## P3 — Tyre walls (per layout)

Format:

```ts
type TyreWall = { nodes: OutlineNode[] };   // open bezier chain (bend points + handles)
// Layout.walls?: TyreWall[]
```

- [x] P3.1 Types + serialize (validation, 0.01 px rounding).
  Done: `TyreWall { nodes: OutlineNode[] }` + optional `Layout.walls`
  (written only when non-empty, so files without walls don't change).
  Node write/read shared with the outline (`writeNode` / `readNode`).
  Editor "Duplicate" copies walls (new Vectors). Verified (vite-node,
  files read-only, md5 unchanged): 5 files save no `walls` key and the same
  outline + paths as before; walls round-trip (0.01 px, handles only when
  set, Vectors on load); bad walls / 1-node wall / missing pos → readable
  errors; outline error text unchanged. Typecheck clean.
- [x] P3.2 Runtime geometry per layout: each wall → flattened curve → band
  polygon (± tyre radius, round ends). On track = inside outline AND not
  inside any wall band. `castRay` = min(outline hit, wall hit);
  `segmentCrossesEdge` checks both. Checkpoint lines stop at walls too
  (they use the same ray cast). Drawn as individual tyres along the curve.
  *Check: car stops at a wall, rays hit it (debug view), AI sees it.*
  Done — no polygon/Clipper: walls are capsule chains (`vector/tyreWalls.ts`:
  `TyreWalls` contains / rayHit / segmentHits, exact smooth band of radius
  0.3 m, `tyreCenters`, `drawTyreWalls`). `TrackGeometry(rings, walls)`
  folds them into isOnTrack / castRay / segmentCrossesEdge, so collision,
  AI rays and checkpoint lines (checkpointEnds) all respect them with no
  other changes. `flattenWall` (open chain) shares `flattenCubics` with the
  outline; `buildOutlineGeometry(outline, walls)`; `Track` passes the
  layout's walls and draws tyres after the surface. Verified (vite-node,
  old geometry rebuilt in scratchpad/oldp3, files read-only): 5 real files
  → outline flatten, 20000 random on-track/ray/edge queries and race setup
  identical; fake oval + cut-through: wall band edge exact (±1 px around
  r = 7.2), per-layout (other layout unaffected), rays stop at walls
  (292.8 / 22.8), car side touching = collision, checkpoint line cut to
  82.8, curved wall follows its bezier, 11 touching tyres on a 140 px
  wall; picture scratchpad/walls.png. Typecheck clean.
- [x] P3.3 Editor (Layout tab, own Tyre walls list): "Add tyre wall" tool — click bend points, Enter /
  double-click finishes; select a wall, drag nodes + handles, add/delete
  nodes, delete the wall. Walls of the active layout drawn as tyres;
  other layouts' walls hidden. *Check: Robin closes the unused road on each
  layout and races both.*
  Done: tab label "Layout" (TabId stays 'checkpoints'). Wall editing in
  `editorTabs/TyreWallEditor.ts` (host callbacks; CheckpointsTab
  delegates): "Add Tyre Wall" (grid-snapped points, live tyres; Enter /
  double-click / button / Esc finish, < 2 points = cancelled), select by
  click on a wall or its list row, drag points (handles follow) + handles
  (mirrored, Alt = independent), click the selected wall's line inserts a
  point, Delete = point (walls keep ≥ 2) or whole wall, inspector (tyres /
  length / points, Add/Remove curve handles, Delete point, Delete wall).
  Checkpoint lines in the editor stop at walls (geometry rebuilt when the
  walls change). Checkpoint and wall selection are exclusive. Save drops a
  wall still being drawn (< 2 points). Verified in an isolated browser tab
  on a throwaway loop + road (nothing saved, asset md5s unchanged): 2-point
  wall + Enter, 3-point wall + double-click, select point → Add curve
  handles → drag (16 → 21 tyres), Delete point, Duplicate copies walls, a
  new layout has none, Delete removes a wall; no console errors. P3.1 and
  P3.2 proofs still all-pass. Typecheck clean.

## Docs
- [x] `.personal/vector-tracks.md`: paths, junctions, explicit order + `dir`,
  tyre walls; remove the "branching is out of scope" limitation.
- [x] `.personal/CLAUDE.md`: checkpoint & collision sections.

## Known risks / uncertainty
- Junction outline: the union gives sharp inner corners where a connector
  meets the loop; the bezier fit may need hand fine-tuning there.
- A checkpoint line placed inside a junction can run into the side road
  (its ray reaches the far edge). Tyre walls stop it in P3; until then:
  don't place checkpoints in junctions.
- Wall-vs-car collision is the same model as the edge (corners + side
  crossings); fine for walls ≥ tyre width, untested at very sharp wall bends.

## Review
All phases done and verified by Robin in the editor + game (2026-10-13):
roads, checkpoints on any road with explicit order/direction, per-layout
tyre walls. Every format change was proven identical on copies of Robin's
real tracks (read-only; md5s checked); old files keep loading and are
converted in memory until Robin re-saves them.
