# Vector Tracks — Design Spec

Move Formulai tracks from PNG + pixel-sampled collision to a vector data model
built from a centerline. Authoring tool becomes a tabbed editor; the checkpoint
tab is the current `TrackEditorView` logic.

## Goal

Replace raster assets as the source-of-truth for track geometry:

- **Author** tracks by placing a centerline with bezier curves + per-anchor
  track width.
- **Store** the centerline (authoring) plus the track **outline** — bezier
  rings generated from the centerline on demand and fine-tunable by hand.
- **Run** rendering, collision + ray casting against the outline with vector
  math instead of pixel reads. (Stage 1 + Stage 2 are both built.)

## Why

Current runtime does pixel sampling for both collision (per corner, per frame,
per actor) and 8 ray casts (hierarchical coarse→medium→fine pixel walks). Every
one of those is a `getImageData` round-trip into the canvas compositor. For N
actors this is the dominant per-frame cost and the main scaling bottleneck for
multiplayer AI training.

Vector math replaces all pixel reads with closest-point-on-polyline queries
against a few hundred cached segments. Analytically precise, deterministic,
and faster at the N-actor scale we care about.

Side-effect wins:
- Variable track width along the course (narrows, chicanes) are a per-anchor
  value, not a hand-authored collision mask.
- Rebuildable at any resolution — no asset re-exports to swap monitors.
- Deterministic behavior (no floating-point pixel-boundary flakiness).
- Enables driving-line analysis, procedural generation, lap-time prediction.

## Data model

```ts
type Anchor = {
    pos: Vector;
    // Cubic bezier control points. Omit for linear segments.
    // controlIn = incoming tangent (relative to the segment FROM the previous
    // anchor). controlOut = outgoing tangent (relative to the segment TO the
    // next anchor).
    controlIn?: Vector;
    controlOut?: Vector;
    // Track half-width AT THIS ANCHOR, in world pixels. Eased between
    // neighbors (smoothstep in the bezier parameter) so segments taper
    // smoothly and the band edge stays tangent-continuous at anchors.
    halfWidth: number;
    asymmetric?: boolean;   // handles move independently (default mirrored)
};

// One node of the track outline (same handle model as anchors).
type OutlineNode = {
    pos: Vector;
    in?: Vector;            // handle of the curve FROM the previous node
    out?: Vector;           // handle of the curve TO the next node
    asymmetric?: boolean;   // corner: handles independent
};
type OutlineRing = OutlineNode[];   // closed

// One centerline: the main loop (closed) or a connector road (open; its end
// anchors sit on another path so the roads join). See "Track network".
type TrackPath = {
    id: string;                      // stable key, e.g. "path-1"
    anchors: Anchor[];
    closed: boolean;                 // true = last anchor connects back to the first
};

type Checkpoint = {
    // World position. Always re-projected onto ITS path's current
    // centerline when used, so checkpoints follow the track when anchors are
    // edited. The checkpoint LINE runs from that point straight across the
    // track (perpendicular to the direction of travel) out to the OUTLINE —
    // or a tyre wall — on both sides (fallback without an outline: ±halfWidth).
    pos: Vector;
    path: string;                    // id of the path it sits on
    dir: 1 | -1;                     // travel direction: 1 = the path's anchor order
    // Exactly one start and exactly one finish per LAYOUT; may be the same
    // checkpoint (= loop layout).
    isStart?: boolean;
    isFinish?: boolean;
};

// A row of tyres (0.6 m each) along an OPEN chain of bend points (same node
// shape as the outline). Per layout — see "Tyre walls".
type TyreWall = { nodes: OutlineNode[] };   // ≥ 2 nodes

// One checkpoint setup on a track. A track has one or more layouts.
type Layout = {
    id: string;                      // stable key, e.g. "full", "short"
    name: string;                    // shown in dropdowns
    checkpoints: Checkpoint[];       // array order IS the lap order (start first)
    expectedLapTimes: Record<string, number>; // per car class, per layout
    walls?: TyreWall[];              // roads this layout closes off (omitted = none)
    gridSlots?: number;              // start grid boxes, ≥ 2 (omitted = 2)
    gridPole?: 'left' | 'right';     // pole side, seen in the direction of travel (omitted = 'left')
};

// Start grid spacing + box size, shared by every layout (metres; each
// omitted value = GRID_DEFAULTS in vector/grid.ts). See "Start grid".
type GridSettings = {
    gapM?: number;        // start line → front of box 1 (1)
    rowM?: number;        // box to box, alternating sides (3); same column = 2 × rowM
    columnM?: number;     // between the column centres (3)
    boxLengthM?: number;  // outside of the painted box (2)
    boxWidthM?: number;   // (1.2)
    staggered?: boolean;  // false = side by side, rows 2 × rowM apart (true)
};

type VectorTrack = {
    // The geometry is SHARED by every layout; layouts differ in checkpoints
    // (route + direction), lap times and tyre walls.
    paths: TrackPath[];              // ≥ 1; the first loop is the "main" path
    layouts: Layout[];
    // The track edge: an outer ring + infield ring(s). Generated from ALL
    // paths on demand, then hand-tunable; shared by every layout. What the
    // game draws, collides with and casts rays against. Missing = not
    // raceable (Publish requires it).
    outline?: OutlineRing[];
    // Car spawn is derived per layout from its START checkpoint:
    //   startPosition = start checkpoint, projected onto its path
    //   startAngle    = that path's direction there × the checkpoint's `dir`
    // Not stored.
};
```

### Centerline + outline

- **The centerlines (paths) are the authoring source**: anchors, beziers,
  per-anchor width (one slider per anchor). Checkpoints and spawn are
  projected onto them.
- **The outline is the driving surface**: generated from all paths
  with one click, then stored and fine-tunable by hand. Editing anchors
  afterwards does NOT regenerate it (the editor warns it may be out of
  date) — hand tuning is never silently lost.

### Track network (roads)

A track is one or more **paths**: the main loop plus open **connector
roads** (real venues with cut-throughs). Track tab path bar: picker
("1 · Loop", "2 · Road"), **New road**, **Make loop / Make road**, **Delete
path** (also removes the checkpoints on it, after a confirm). Only the
selected path is editable; the others are drawn faded (click one to switch).

- **Junctions**: a road's first/last anchor snaps onto another path's
  centerline when placed or dragged within its half-width (green dashed
  ring; Shift skips) and takes that road's width. There are no junction
  links: moving the loop later means re-dragging the road end.
- **Outline**: every path adds its pieces (open paths: no closing segment,
  round discs at the ends) and one Clipper union merges them, so roads
  join cleanly; junction corners come out sharp (fine-tune by hand).
- **Routes are implicit**: a layout's route is its checkpoints (which path,
  which order, which direction) plus its tyre walls. No junction graph.
- Helpers: `vector/paths.ts` (`flattenPaths`, `projectOntoPath`,
  `projectOntoNearestPath`).

### Checkpoints

Checkpoints are stored independently from anchors and can sit anywhere on
any path. Authoring (Layout tab):

- **Place**: "Add Checkpoint" mode; click the track → the checkpoint snaps to
  the nearest point of the NEAREST path. A ghost preview (number + arrow)
  follows the cursor. It is inserted right after the selected checkpoint
  (none selected: end of the lap — on a one-way layout just before the
  finish) and becomes the selection, so clicks chain in order.
- **Storage**: a world position + path id + `dir`, re-projected onto that
  path on every use. Survives anchor edits, inserts and deletes.
- **Order**: EXPLICIT — the list order is the lap order, #1 = start. ▲▼ in
  the list reorder (the start stays #1). "Set as Start" rotates the list to
  that checkpoint (keeps a loop's order).
- **Direction**: per checkpoint (`dir`), shown as an arrow on every
  checkpoint. A new one takes the previous checkpoint's `dir` on the same
  path; on another path, the way along it that points away from the
  previous checkpoint. **F** (or "Flip direction") flips the selected one.
- **Start / finish**: exactly one of each (flags). First checkpoint placed is
  both. Set via the inspector ("Set as Start" / "Set as Finish").
- **Loop vs one-way** is DERIVED: start === finish → loop; otherwise
  one-way (start → finish, one run). No separate `isLoop` setting. Lap count
  is a session setting (`stageLaps`), not part of the track: a loop layout
  can be raced for one or many laps; a one-way layout is always one run.
- **Unused**: on a one-way layout, checkpoints after the finish in the list
  are kept but shown dimmed and dropped on export (the engine needs index 0
  = start and, one-way, last = finish).
- **Edit**: select by clicking the line, drag along its own path,
  Delete/Backspace removes. Deleting the start promotes the next checkpoint;
  deleting the finish makes the start the finish too (loop).

Checkpoint-pass test: "did the car's front point cross the line segment
spanning the checkpoint's two edge points" — same math as the old pixel
tracks; the edge points are where the checkpoint line meets the outline
(`checkpointEnds`, shared by the editor and the game).

### Layouts

One track (shared geometry) can have many **layouts**. Each layout is one
setup: its own checkpoints (route, order, direction, start/finish), its own
expected lap times and its own tyre walls. Mirrors real karting venues that
run several configurations on the same tarmac.

- **Direction** lives on the checkpoints (`dir`); the geometry is never
  modified. A reversed direction is simply another layout.
- **Layout bar** (Layout tab): picker, **Add**, **Duplicate** (copy as-is —
  checkpoints, lap times, walls), **Reverse** (loop layouts, in place: start
  stays first, the rest in reverse order, every `dir` flipped, lap times
  reset to 0 since they differ per direction), **Rename**, **Delete**.
- **Racing**: a session/race picks a track AND a layout. Dropdowns list one
  entry per (track, layout), e.g. "GoKart Track 6 — Short".
- **Editor**: the Layout tab edits the selected layout. The Track tab edits
  shared geometry.

### Tyre walls

Per-layout rows of tyres that close the roads a layout doesn't use (the
shared outline stays open for the other layouts — one outline per track,
hand-tuned once).

- **Shape**: an open bezier chain of bend points (`OutlineNode`s). Collides
  as a smooth band of one tyre (0.6 m) around the curve with round ends —
  a chain of capsules (`vector/tyreWalls.ts`, `TyreWalls`), exact, no
  polygon. Drawn as touching tyres (`tyreCenters`, `drawTyreWalls`).
- **Runtime**: `TrackGeometry(rings, walls)` folds them in: inside a wall =
  off track, rays and edge crossings stop at them, so car collision, the AI
  rays and checkpoint lines all respect walls. Only the raced layout's
  walls exist in its `Track`.
- **Editor** (Layout tab, `editorTabs/TyreWallEditor.ts`): "Add Tyre Wall" —
  click bend points (grid snap, Shift = free); Enter / double-click / Esc
  finishes (< 2 points = cancelled). Click a wall (or its row in the
  "Tyre walls" list) to select; drag points (handles follow) and handles
  (mirrored, Alt = independent); click its line to insert a point;
  Delete = the selected point (walls keep ≥ 2) or the whole wall;
  inspector: tyres / length, Add/Remove curve handles, Delete point,
  Delete wall. Only the active layout's walls are drawn.

### Start grid

Boxes behind the start line, in two columns, following the road backwards
along the start checkpoint's path (`vector/grid.ts`; may sit in a curve).
Spacing + box size per track (`grid`), number of boxes + pole side per
layout. One road function (`startRoad`) gives the spawn boxes
(`gridSlots`) and the painted lines (`gridLines`: front straight across,
sides along the road, nose-to-tail boxes joined into one line per column),
so a car always lines up with its box. Paint is 10 cm, inside the box.

- **Editor** (Layout tab, bottom-left list, "Start grid"): This layout —
  Positions, Pole Left/Right; All layouts (track) — Staggered On/Off, Gap,
  Row, Columns, Box length, Box width. Boxes drawn live, numbered (pole
  number yellow). Duplicate copies positions + pole.
- **Game**: see `.personal/CLAUDE.md` "Start Grid" (random order per
  stage, spawn, lead-in).

### Outline (track edge)

The outline is the edge of the shape the editor draws for the centerline —
a disc of the local half-width swept along the bezier centerline — stored as
closed rings of bezier nodes.

**Generation** (Outline tab → "Generate outline", editor only,
`app/tracks/vector/outline.ts`):
1. Sample the exact smooth edge along every bezier segment (every ≤ 2 px):
   `edge = center + w·(−w′·T ± √(1 − w′²)·N)` — the swept-disc envelope,
   where `w′` is the width change per px. A full disc at every anchor covers
   width peaks and tapers faster than the track advances; true arcs fill the
   outer side of sharp anchors.
2. Merge one strip per segment and side with **Clipper** (`clipper-lib`,
   Boost license) — it trims the edge where it folds over itself on tight
   inner corners. Zero-area pinholes from seams are dropped.
3. Fit cubic beziers to each ring (Schneider's algorithm,
   `fitCurves.ts`) at **0.25 px** tolerance; sharp corners stay sharp
   (corner nodes have independent handles).

Measured: Robin's 4-anchor track → 44 nodes in ~35 ms; a 40-anchor test
track → ~510 nodes in ~165 ms. Matches the editor's band within the
tolerance. (An earlier union of thousands of discs + quads was exact but
took ~800 ms and produced ~11,600 points; fitting curves to that kinked
polyline gave thousands of curves — fitting the smooth edge fixed both.)

**Editing** (Outline tab):
- Layers: faint band → dashed cyan computed edge (what Generate would give
  now) → stored outline (orange; round dot = smooth node, square = corner) →
  blue centerline points (read-only).
- Click a node to select (its handles appear); drag nodes and handles. On a
  smooth node the opposite handle mirrors the DIRECTION but keeps its own
  length; Alt flips mirrored/independent for the drag and commits on release.
  The closest of node/handles wins a click (generated handles can be tiny).
- **Snap on this tab = the computed edge**, not the grid: a dragged node
  always sits on the nearest point of the cyan edge (glides along it); a
  dragged handle's direction locks to the edge direction at its node. Snap
  toggle / Shift = free placement.
- Click the orange line between nodes to **insert** a node (exact de
  Casteljau split — shape unchanged). Delete/Backspace **removes** the
  selected node (min 3 per ring); the joined side is refitted to follow the
  two old sides (handle directions kept, lengths fitted), so insert → delete
  gives back the original curve.
- Regenerate asks before replacing an existing outline. An "out of date"
  warning shows when anchors changed since the last generate (in-memory
  snapshot; a freshly opened file counts as up to date).

## Derived structures (built at track load)

- **Flattened centerlines** (`flatten.ts`, `paths.ts`): 40 steps per bezier
  segment, each flat point with tangent, eased halfWidth, arc-length (open
  paths: no closing segment, one-sided end tangents). Used for checkpoint
  projection and spawn.
- **Outline geometry** (`outlineShape.ts` → `geometry.ts`): the stored
  outline flattened to polylines within 0.1 px (Wang's formula per curve),
  edges bucketed in a uniform 64 px grid, plus the layout's tyre walls
  (flattened the same way). Answers on-track, ray distance and
  segment-crosses-edge queries looking only at nearby edges.
- **Checkpoint lines**, **bounds**, **spawn** (see `Track.ts`).

Build cost: ~1 ms for Robin's track; nothing is rebuilt per frame.

## Editor layout — tabs outside, overlays on the canvas

Two layers of chrome:

- **Tab bar — outside the viewport, pinned above the canvas.** A normal
  flex-column container: tabs on top (**Track / Outline / Layout**),
  canvas below. The tab bar is page-level navigation, not an editor tool, so it
  sits above the viewport and takes its own height. Switching tabs swaps
  the overlays below.
- **Canvas viewport — fills the remaining height.** All editor controls
  are absolutely-positioned overlays floating ON TOP of the canvas.

Rough overlay regions (all `position: absolute`, non-interfering):

- **Top strip** (top:0, inside the canvas, translucent): track picker +
  back-to-menu. (Tabs live OUTSIDE the viewport, not here.)
- **Left tool column** (top:center, left:0): primary mode buttons for the
  active tab (Add Checkpoint, Seed Anchors, Add Anchor, etc.).
- **Right inspector panel** (top:center, right:0): context-sensitive to
  the current selection (checkpoint number + remove; anchor halfWidth
  slider + remove; etc.). Hidden when nothing selected.
- **Bottom-right controls** (bottom:0, right:0): zoom in/out + percentage,
  bounding-box toggle, grid toggle + grid-size input.
- **Bottom-left list** (bottom:0, left:0): scrollable checkpoint/anchor
  list, collapsible.

All overlays are semi-transparent so the user can still see the track
underneath; buttons have a solid pill background so they stay readable.
No scroll bars on the overlays — they're small groupings of controls, not
long panels.

Benefits:
- Maximizes the useful canvas area. The current sidebar eats 300px that
  could show more track.
- The track IS the main object; everything else is annotation.
- Easier to add tabs/modes later — a new tab just swaps the left tool
  column and the right inspector.

Implementation: the tab shell owns the overlay positions; each tab
component is passed the overlay slots to populate (as `HTMLElement` refs
or by appending to named layer containers). The canvas layer sits at
`z-index: 0`; overlays at `z-index: 1+`.

## Trace background (editor authoring aid)

Load a reference image (satellite shot, hand-drawn track map, photo of a
real track) into the editor as a background layer. Trace anchors on top of
it. Shell-level feature — persists across tab switches so Layout tab
sees the same reference as Track tab.

### Image storage

Background images live in the server's S3 bucket (`backgrounds/<file>`,
seeded from `server/backgrounds/`; `server/src/backgroundStore.ts`). The
panel lists them (`GET /api/backgrounds`, open), loads one as a plain
image (`GET /api/backgrounds/<file>`), uploads (**Upload…**, editor
password, ≤ 20 MB, name made `[A-Za-z0-9_.-]`-safe, replacing asks) and
deletes (**Delete**, refused while a published or draft track uses it). A
track stores the FILE NAME in `editorBackground.src`; older tracks hold a
path (`/app/assets/trace-maps/X.png`) — cut to `X.png` when opened
(`backgroundFile`), no re-save needed. One the server lacks shows as
"(missing on the server)".

### Calibration + positioning

Manual scale + numeric input. The user eyeballs the match or types a known
scale factor.

**Controls (right inspector when background panel is open):**
- Image select (the server's backgrounds) + Upload… / Delete.
- Scale slider + numeric input (world px per image px). Default 1.0.
- Position X / Y numeric inputs (drag-to-position also works directly on
  the canvas when the background is unlocked).
- Rotation input (degrees, 0 default).
- Opacity slider (default 0.5).
- Lock toggle (prevents accidental drag while placing anchors — ON by
  default once calibrated).
- "Remove background" button.

**Z-order:** background renders BELOW the grid so grid lines stay visible
as a scale reference while tracing. Anchors + checkpoints render on top of
both.

### Persistence — embedded in the track JSON

The background reference persists in the saved `TrackJSON`. Runtime
ignores it entirely (editor-only field):

```ts
type TrackJSON = {
    // ... existing fields ...
    editorBackground?: {
        src: string;         // the background's file name (server backgrounds/)
        scale: number;       // world-px per image-px
        offsetX: number;     // world-px offset of image origin
        offsetY: number;
        rotation: number;    // degrees
        opacity: number;     // 0..1
        locked: boolean;
    };
};
```

Re-opening the JSON in the editor restores the background exactly where
you left it. The runtime loader skips `editorBackground` — no asset
loading, no render cost, no mention in `Track`.

## Snap grid

Editor-level feature, works across both tabs.

**State:**
- `gridSize: number` — cell edge, stored in world pixels (default 24 = 1 m).
- `gridUnit: 'px' | 'cm' | 'm'` — display unit for the input. Pure UI; the
  stored value stays in pixels so grid math never has to re-convert.
- `snapEnabled: boolean` — toggles snap behavior.
- `showGrid: boolean` — toggles the visual grid overlay (independent of snap).

**Unit conversion:** change the existing `PIXELS_PER_METER` constant in
`app/helper.ts` from `12` to `24` (see "Scale change" below). Add two
helpers alongside the existing kmh ones:
```ts
export const fromCmToPixels = (cm: number) => (cm / 100) * PIXELS_PER_METER;
export const fromPixelsToCm = (px: number) => (px / PIXELS_PER_METER) * 100;
```

Sensible defaults by unit (all equal when converted):
- `24 px` = `1 m` = `100 cm`
- Common presets to expose: `0.5 m`, `1 m`, `2 m`, `5 m`.

**Behavior:**
- When `snapEnabled`, all placement and drag operations (anchors, bezier
  control points, checkpoints) round the cursor's track-space coordinates
  to the nearest grid intersection: `x = round(x / gridSize) * gridSize`.
- Grid is in **world/track space**, not screen space — it stays aligned
  with the track as the user pans and zooms.
- Hold a modifier key (e.g. Shift) to temporarily bypass snap for a single
  drag, so fine positioning doesn't need a toggle round-trip.

**Visual:**
- Draw thin lines every `gridSize` world pixels across the visible canvas
  area. Line opacity scales with zoom — when zoomed way out, the grid
  fades (otherwise it becomes solid noise).
- Thicker/brighter line every N cells (e.g. every 10th) for easier
  distance estimation.

**UI location:** bottom-right overlay cluster alongside zoom + bbox toggle.
Four controls:
1. Grid toggle button (shows "Grid: 1 m" / "Grid: 100 cm" / "Grid: 12 px"
   depending on `gridUnit`; "Grid: off" when disabled).
2. Unit selector (px / cm / m) — purely formatting, doesn't change the
   stored pixel value.
3. `+ / −` buttons or scroll wheel on the toggle to step the grid size in
   the current unit's natural increments.
4. Separate "Snap" toggle (so the grid can be visible without snapping,
   or snap-on without rendering the grid).

**Outline tab exception:** there, snap means the computed track edge, not
the grid (see "Outline (track edge)").

**Interaction with bezier controls:** control points DO snap by default
when `snapEnabled`. Rationale: easier to get clean tangents on grid-aligned
anchors. If this feels too restrictive in practice, add a per-control-type
override (anchors always snap, controls only when a modifier is held).

## Rendering

**Editor** (`TrackBandRenderer`): union of a disc per flat centerline point
+ a tapered quad per flat segment (all paths, nonzero fill),
semi-transparent fill with an edge ring. When a track has an outline, the
Layout tab draws the surface from the outline instead (so checkpoint lines
end at the drawn edge), plus the active layout's tyre walls.

**Game** (`Track.draw(ctx, zoom, showDebug)`, called by `Renderer` —
isometric; the 3D views build geometry instead, see below):
- Surface: outline rings as one bezier `Path2D`, filled with the even-odd
  rule (outer ring minus infield), `#3c3c3c`, edge line painted 10 cm
  INSIDE the asphalt (stroked 20 cm, clipped to the surface).
- The layout's tyre walls as rows of tyres.
- The start grid boxes, white, 10 cm.
- 3D views (chase / cockpit / orbit / free): no texture — asphalt mesh
  (`engine/trackGround.ts`), paint as strips + quads (`Track.paintStrips` /
  `paintQuads`, `engine/paintStrips.ts`; the edge strip also covers 5 cm of
  grass), tyre walls as stacked 3D tyres (`Track.tyres`). Checkpoint lines
  aren't shown there.
- Every checkpoint as a faint white line.
- Start and finish as two-row checkered strips (0.5 m squares, second row
  staggered by one square; `checkered.ts`, shared with the editor). On a
  loop they're the same line → one strip.
- Debug toggle ("Show Bounding Box"): checkpoint numbers, rays, car corners.
- Other line widths divide by zoom so they stay constant on screen. Default camera
  zoom 0.6 (≈ 70 m across the 1000 px view).

## Collision + rays (as built)

All queries run against the outline geometry (`TrackGeometry`, built at
load from the stored outline). Pure functions over a uniform grid of
outline edges; no pixel sampling anywhere.

- **On track** (`isOnTrack`): inside an odd number of rings (horizontal
  crossing count over the edges in the point's 0.17 m row band, its own
  thin bands next to the grid) and not inside a tyre wall.
- **Rays** (`castRay`): walk the grid cells along the ray (Amanatides &
  Woo), exact ray-vs-edge hits, stop once the best hit lies within the
  cells walked; tyre walls are exact ray-vs-capsule hits (a wall whose
  box the ray can't reach before the best hit is skipped). 0 if the start
  is off track. ~0.3–0.6 µs per ray. The engine casts the same 8 rays as
  before (`RAY_ANGLE_OFFSETS`), same rounding — the AI protocol is unchanged.
- **Car collision** (`GameEngine.checkCarCollision`): any corner of the car
  rectangle off the track, or any side crossing an outline edge or touching
  a tyre wall (`segmentCrossesEdge` — also catches a sharp inner corner
  poking into the side).
  Response unchanged: the car stops while colliding; Reset recovers.
- **Spawn** (`Track.spawn`): centered across the track, front bumper 1 m
  behind the start line, facing the direction of travel.
- **Lap clock**: runs from crossing the start line until the stage is
  complete (not from page load, not after the last lap).

## Staged implementation (two ratchets)

### Stage 1 — Authoring + save/publish (done)

Pre-work deleted the TS track subclasses and migrated `Track` to a
JSON-loading class. The editor is a tabbed, overlay-based UI; it saves
drafts and publishes a single `.json` file straight to disk (the Vite glob
auto-discovers it on next reload). See "Saving and publishing".

### Stage 2 — Vector runtime (done)

Build log and verification: `.claude/tasks/vector-runtime-stage2.md`.
- Outline authoring (O1–O4): data + format, generation, Outline tab, publish
  requires an outline, checkpoint lines reach the outline.
- Runtime (R1–R7): geometry from the stored outline, Track wiring (collision,
  rays, checkpoint lines, bounds, spawn), game render, engine collision +
  rays, bounds-based views, pixel code deleted, end-to-end tests (loop,
  reversed loop, one-way, AI over WebSocket).

## Open questions

1. **Minimum halfWidth**: enforce a lower bound at authoring time to avoid
   impossible-to-drive narrows? Or just a UI warning?
2. **Anchor spacing hints**: suggest adding anchors where consecutive bezier
   segments diverge a lot from their chord.
3. **Adaptive centerline flattening**: 40 fixed steps per segment is more
   than straights need; fine for now (only checkpoints/spawn/editor use it).
4. **Session picker**: sessions are JSON files now (`app/assets/sessions/`), so
   any track can be raced by listing it in a session file. Single player and
   AI mode still use the default session (no picker in the UI yet).

## Non-goals (explicitly deferred)

- Elevation / banking / multi-layer tracks.
- Procedural track generation (though the data model supports it).
- Importing existing PNG tracks into vector form (one-way migration only).
- A dedicated spline type (NURBS, Catmull-Rom). Cubic beziers are enough.

## File layout

```
app/
├── views/
│   ├── TrackEditorView.ts         # Editor shell (tabs, overlays, grid, camera)
│   ├── TrackFileMenu.ts           # New / Open / Save / Publish
│   └── editorTabs/
│       ├── TrackTab.ts            # Paths (loop + roads): anchors, beziers, widths
│       ├── OutlineTab.ts          # Generate + hand-tune the outline
│       ├── CheckpointsTab.ts      # "Layout" tab: layouts + checkpoints
│       ├── TyreWallEditor.ts      # Tyre walls (used by the Layout tab)
│       └── TrackBandRenderer.ts   # Editor band render
├── tracks/
│   ├── Track.ts                   # One layout of a track file (runtime)
│   ├── serialize.ts               # The on-disk format
│   ├── store.ts                   # Track API client (the game server)
│   └── vector/
│       ├── flatten.ts             # Bezier centerline → flat points
│       ├── paths.ts               # Several paths: flatten, project, nearest path
│       ├── project.ts / layout.ts # Projection; start/finish, lap order, unused
│       ├── outline.ts             # Outline GENERATION (editor; Clipper)
│       ├── fitCurves.ts           # Bezier fitting (Schneider)
│       ├── outlineShape.ts        # Stored outline → geometry, path, checkpoint ends (runtime)
│       ├── geometry.ts            # On-track / rays / edge crossings (grid + walls)
│       ├── tyreWalls.ts           # Tyre-wall collision (capsules) + drawing
│       └── checkered.ts           # Two-row checkered strip
server/src/
├── trackStore.ts                  # Drafts + published (S3); publish = live
├── httpApi.ts                     # Track API routes (editor password)
├── loadGameFiles.ts               # Tracks from S3 (tracks/) at start
└── game/tracks/                   # The GAME's copy: Track, registry,
                                   #   serialize, vector/ (runtime parts)
```

Since the public-server split the game runs on the server
(`server/src/game/tracks/`); the App's `app/src/tracks/` is the EDITOR's own
copy of the geometry code (two copies, the JSON format is the contract —
a format change must be made in both).

`offset.ts` / `tessellate.ts` are early Stage 1 leftovers, unused.

## Scale change — `PIXELS_PER_METER: 12 → 24`

Taken alongside the vector-tracks work because the editor is where this
constant becomes user-visible (grid units, halfWidth input in meters).

**Change:** `app/helper.ts:1` → `PIXELS_PER_METER = 24;`

**Direct consequences — things that will visibly change on day one:**

- **Car motion doubles at the same km/h.** `fromKmhToPixels(kmh)` returns
  twice the pixel delta per tick, so a car configured for max 100 km/h will
  travel 2× the pixels per second it does today. If this feels wrong,
  re-tune the per-car speed/accel constants in `app/cars/gokarts/*.ts` to
  halve the max km/h (effectively keeping the same on-screen behavior but
  reporting half the km/h). OR accept the apparent 2× speed as the new
  normal.
- **Existing PNG tracks are reinterpreted at half their current size.** A
  1008×516 px track today = 84 m × 43 m. After the flip, same pixels =
  42 m × 21.5 m. Visually unchanged; the only difference is what
  `expectedLapTime` / "track is 100m long" conversations mean. Nothing
  breaks — just the real-world labels on existing tracks shift.
- **Grid defaults at the new scale**: `24 px = 1 m`, `2.4 px = 10 cm`,
  `12 px = 50 cm`.
- **Default vector halfWidth doubles in pixel terms**: 96 px = 4 m (same
  meters as before, more pixels).
- **Canvas base zoom**: locked at 3000 world-px (= 125 m at 24 px/m) across
  the viewport, keeping roughly today's field of view after the scale flip.

**Not changed:**
- `fromKmhToPixels` + `fromPixelsToKmh` function signatures stay. Behavior
  changes transparently via the constant.
- Collision math, checkpoint pixel positions, ray lengths — all values
  stored as pixels keep their pixel meaning. Only the per-meter
  interpretation shifts.

### Car sizes in meters

Alongside the scale flip, Car size fields move to meters (author-facing)
with pixel getters for engine consumption. Also fixes today's confusing
naming (`width` is actually length-along-motion; `height` is width-across).

```ts
abstract class Car {
    // Author-facing, meters.
    public abstract lengthM: number;  // along direction of travel
    public abstract widthM: number;   // across direction of travel

    // Engine-facing, derived pixels.
    get lengthPx(): number { return fromMetersToPixels(this.lengthM); }
    get widthPx(): number { return fromMetersToPixels(this.widthM); }

    // Default bbox polygon (local space, rotated with car.angle at runtime).
    // Simple rectangle; subclasses override for richer silhouettes.
    get bboxPolygon(): Vector[] {
        const l = this.lengthPx / 2, w = this.widthPx / 2;
        return [new Vector(-l, -w), new Vector(l, -w), new Vector(l, w), new Vector(-l, w)];
    }
}
```

Add `fromMetersToPixels` + `fromPixelsToMeters` to `helper.ts` alongside
the cm helpers.

**Realistic go-kart sizes:**
- HyrkartCentralen: 1.95 m long × 1.38 m wide
- Hyrkart270cc: 2.0 m long × 1.4 m wide
- Racingkart125cc: 1.8 m long × 1.4 m wide

Legacy `Car.width` / `Car.height` are renamed and the few consumers in the
engine (collision, rendering, ray origin) use `lengthPx` / `widthPx`
instead. One-shot rename; happens as part of Phase A.

**Follow-ups to track after the flip:**
- Decide whether to retune car speeds for apparent-same motion.
- Re-benchmark `expectedLapTime` values on existing tracks (they're real
  seconds, so lap times stay accurate — but if cars move 2× pixel-wise,
  pre-flip times are no longer representative of post-flip behavior).

## Track distribution model — JSON files, one Track class

Hand-in-hand with the vector pivot: tracks become **data (JSON)** instead of
**code (TS subclasses)**. One `Track` class in `app/tracks/Track.ts` loads a
JSON config and populates all its fields from it. No per-track subclasses.

### Why

- Publishing is "one JSON object in the server's S3 bucket". The five-file
  update ritual (TrackEditorView, LobbyView, SinglePlayerView, racing-
  multiplayer-ai, TrainingOne) disappears entirely.
- The server discovers every track in the bucket (`tracks/`) at start (and
  registers a published one at once). No manifest to maintain by hand.
- Session composition becomes trivial — list of JSON names instead of class
  imports.
- Enables runtime track hot-swap (eventually).

### JSON schema (`TrackJSON`)

Vectors are the source of truth for both the visual layout and collision.
No PNG assets — the runtime draws and collides against the stored outline.

```ts
type TrackJSON = {
    name: string;                    // class-like identifier, e.g. "GoKartTrackSix"
    displayName: string;             // dropdown label, e.g. "GoKart Track 6"
    vector: {
        paths: TrackPath[];          // shared geometry (authoring), ≥ 1
        outline?: OutlineRing[];     // track edge; required to publish
    };
    layouts: Layout[];               // ≥ 1; see "Layouts" above
    editorBackground?: { ... };      // editor-only, see "Trace background"
};
```

`isLoop` is no longer stored — it's derived per layout (start === finish).
`expectedLapTimes` moved from the track onto each layout. `finishLineDirection`
is dropped — direction of travel comes from the checkpoints (`dir`).

`app/tracks/serialize.ts` is the only code that knows this format:
`serializeTrack` (editor state → JSON: per layout normalizes start/finish,
writes checkpoints in list order with start first, drops unused ones, fills
missing lap times with 0, writes `walls` only when there are any, rounds
coordinates — anchors, outline, walls — to 0.01 px) and `deserializeTrack`
(JSON → real `Vector`s, readable errors on malformed files: paths, unknown
checkpoint path / bad `dir`, outline per ring/node, walls per wall/node).

**Older files load in memory** (never rewritten until Robin re-saves):
`vector.anchors` → one closed path `path-1`; a layout whose checkpoints
have no `path` → all on the main path, file order kept, `dir` = −1 if the
layout was a loop with `reversed: true`, else 1. Proven identical racing on
every existing file (lines, order, spawn, heading).

Everything derived at track load (per selected layout) — see "Derived
structures": outline geometry (with the layout's walls), `bounds`
(`trackWidth` / `trackHeight` = its size; vector tracks can have negative
coordinates), checkpoint lines, `startPosition` / `startAngle` (start
checkpoint's path tangent × its `dir`).

### Discovery

The game server owns the tracks: `loadGameFiles` reads every
`tracks/*.json` in its S3 bucket (`storage.ts`; seeded from
`server/tracks/` by `npm run seed`) into `TRACK_REGISTRY` (`server/src/game/tracks/registry.ts`, by
`name`). Track refs are `"TrackName::layoutId"`; a bare `"TrackName"` means
the file's first layout (sessions name a track + layout by name or id,
`resolveTrackRef`). Drafts (`tracks/drafts/`) are never loaded, so the
game never sees them. A lobby builds its `Track` objects when it's created;
`TRACK_SOURCE` remembers the file each was built from (render-track key).
The App reads no track files: the session editor gets names from `GET
/api/tracks/layouts`, the viewer gets a ready-made render track over WS.

### Saving and publishing (editor ↔ S3)

The editor stores nothing itself: it saves through the game server's Track
API (`server/src/trackStore.ts` + `httpApi.ts`); `app/src/tracks/store.ts` is
its browser client. Every call sends `X-Editor-Password` (the server's
`EDITOR_PASSWORD`; asked once per browser tab, sessionStorage; a 401 asks
again). Wrong / missing → 401; no `EDITOR_PASSWORD` set → 503 (editing
off). The password only keeps editing to one person — no accounts, no
locks, the last save wins.

| Endpoint | Does |
|---|---|
| `GET /api/tracks` | `{ drafts, published }` → `{ file, name, displayName }` each |
| `GET /api/tracks/<folder>/<file>` | raw JSON (Open always fetches fresh) |
| `PUT /api/tracks/<folder>/<file>` | writes the body (JSON with `name`; a published name already used by another file → 409); published → registered at once |
| `DELETE /api/tracks/<folder>/<file>` | removes the file (a missing one is fine); a published track a session uses → 409 |

`folder` is `drafts` or `published`; `file` must match `[a-z0-9_]+.json`.
Nothing can be written outside the two folders. (Replaced the dev-only
Vite store `/__tracks` on 2026-11-02.)

**Editor buttons** (top-right of the viewport, below the tab bar):
- **New** — blank track (asks first if there are unsaved changes).
- **Open** — one row per track with its status; a track with unpublished
  changes opens its draft (the newest version). Fits the camera.
- **Save** — always writes `drafts/<stem>.json` on the server. The first save
  asks for the name (`GoKartTrackSix`: capital first, letters/digits, unique
  across drafts and published) and display name (defaults to a prettified
  name). The name is fixed after that.
- **Publish** — needs a path with ≥ 2 anchors and a checkpoint on every layout. Writes
  the published `<stem>.json` on the server, then deletes the draft (only
  after the write succeeded). Asks before overwriting a published file this
  session didn't open. New lobbies race it at once; running lobbies keep the
  version they started with.

**Status** (derived from which files exist; shown next to the buttons and
in the Open list):

| Files | Status |
|---|---|
| draft only | Draft |
| published only | Published |
| both | Unpublished changes (the game still runs the published version) |

**No reload or restart on save.** Saves go to S3, not to any file Vite,
Tailwind or nodemon watches (`app/src/app.css` keeps `@source not
"./assets";` from when the tracks lived in the App). A publish goes live for NEW lobbies at once (`registerTracks`); running
lobbies keep the Tracks they were built with (`Session` builds every
stage's Track at lobby creation).

### Legacy tracks

**All existing GoKartTrack* subclasses (plus Centralen × 2) are deleted** as
part of the pivot pre-work. Formulai forgets them; focus is on new vector
tracks going forward.

**Known gap**: there's an interregnum between Stage 1 completion (new
tracks can be authored but can't yet render or collide) and Stage 2
completion (vector runtime lands). During this window, nothing is
playable. Explicitly accepted — see the Build Order document for the
sequencing.

## Decisions locked

- **Save / Publish** (replaces Export): the editor saves through the game
  server's Track API (editor password). Drafts in `tracks/drafts/`,
  published tracks in `tracks/` (the server's S3 bucket); publishing removes the draft and is
  live for new lobbies. See "Saving and publishing".
- **PNG import**: not supported. Vector mode is for new tracks and
  re-editing of `.vector.json`-backed tracks only. Existing PNG tracks
  stay pixel-based.
- **Path UX**: Illustrator-style. Click to drop anchor → linear segment
  from previous anchor. Click-and-drag to drop → pulls out a bezier
  `controlOut` handle; next anchor's `controlIn` mirrors it (symmetric
  by default; break-symmetry modifier later).
- **Canvas**: infinite in both directions (no fixed bounds). Default zoom
  level fits **3000 world-pixels (= 125 m at 24 px/m)** of width across the
  viewport, preserving roughly today's field of view after the scale flip.
  Runtime dimensions are the authored content's bounding box + margin.
- **Checkpoints tab in the new layout**: full rebuild in the overlay style
  (not a lift-and-shift of the current sidebar). Logic is preserved; UI
  moves to left-column mode buttons + right inspector + bottom-left list.
- **Default halfWidth**: 96 px = 4 m (at the new 24 px/m scale). Produces
  an 8 m full-width track. Every new anchor (including the first) seeds
  at this value. User can override per-anchor via the right-inspector
  slider.
- **Outline**: stored per track (bezier rings), generated only on a button
  click (Outline tab), hand-tunable, shared by every layout. The game uses
  it (plus the layout's tyre walls) for the surface, collision, rays and
  bounds; the paths only for checkpoint projection and spawn. Fitting tolerance 0.25 px. Publish
  requires an outline; an out-of-date one still publishes.
- **Checkpoint lines** reach the outline (editor and game, same code).
- **Start / finish look**: both drawn as two-row checkered strips (one strip
  when they coincide on a loop); other checkpoints as faint white lines;
  numbers only in debug.
- **Car size**: real-world — e.g. HyrkartCentralen 1.95 × 1.38 m on an
  8 m track. Default racing zoom 0.6.
- **Anchor insertion**: click on the rendered centerline between two
  anchors inserts a new anchor at that point and splits the segment.
  Standard path-editor behavior.
- **Car spawn**: derived per layout from its START checkpoint: centered
  across the track, front bumper 1 m behind the start line, facing the
  direction of travel (the start checkpoint's `dir`). No separate spawn
  marker; move or re-assign the start to move the spawn.
- **Loop vs one-way**: per layout, start === finish → loop, otherwise
  one-way. Derived, never stored; no `isLoop` toggle anywhere.
- **Layouts**: one track = shared geometry + one or more layouts.
  Checkpoints (route, order, direction), expected lap times and tyre walls
  are per layout. Races pick track + layout.
- **Track network** (2026-10-13): several paths (loop + connector roads);
  routes implicit (checkpoints + tyre walls, no junction graph); one shared
  outline per track (walls close roads per layout, so the outline is
  hand-tuned once and closed roads stay visible like at the real venue).
  Tyre 0.6 m, collides as a smooth band.
- **Track naming**: prompted on the first Save (or Publish) of a new track.
  User enters a name (e.g. `GoKartTrackSix`); becomes both the `name` field
  in the JSON and its filename on disk (`go_kart_track_six.json`). Fixed
  after the first save (no rename / save-as yet).
- **Lap times**: not edited in the editor yet — saved as 0 ("not
  configured") for every car class; set them by hand in the JSON.
- **Distribution model**: JSON objects in the server's S3 bucket. ONE
  `Track` class loads them (the game's copy on the server; the editor has
  its own). The server discovers all tracks at start and registers a
  published one at once — no manifest maintenance.
- **Legacy tracks**: deleted during Stage 1 pre-work. No migration, no
  dual-pattern maintenance. New tracks only going forward.
- **Playable-tracks gap**: closed — Stage 2 is built; published tracks with
  an outline are raceable.
