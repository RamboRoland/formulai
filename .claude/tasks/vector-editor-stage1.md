# Vector Editor — Stage 1 Build Order

Executes the Stage 1 scope from `.personal/vector-tracks.md`. Three big
threads land together:

1. **Scale flip** — `PIXELS_PER_METER: 12 → 24`.
2. **JSON track pivot** — delete the TS Track subclasses, replace with a
   single JSON-loading `Track` class + Vite-glob discovery.
3. **Tabbed editor** — overlay-based layout with a rebuilt Checkpoints tab
   and a new Track tab that authors + exports JSON.

End of Stage 1: new vector tracks can be authored and exported. They are
NOT yet playable (vector runtime lands in Stage 2). The repository has no
playable tracks during the interregnum — explicitly accepted.

Each phase is independently verifiable. Verify with Robin before moving on.

---

## Phase A — Scale flip + unit rationalization (prerequisite)

Flips the pixel-per-meter constant AND moves authored dimensions (car sizes)
into meters. One pass of unit cleanup.

- [x] A1. Change `PIXELS_PER_METER` from `12` to `24` in `app/helper.ts:1`.
- [x] A2. Add `fromCmToPixels`, `fromPixelsToCm`, `fromMetersToPixels`,
  `fromPixelsToMeters` helpers in the same file.
- [x] A3. Refactor `Car` base class (`app/cars/Car.ts`):
  - Replace abstract `width` + `height` (today's misnamed pixel values)
    with `lengthM` + `widthM` (meters, author-facing).
  - Add `lengthPx` + `widthPx` getters that return `fromMetersToPixels(...)`.
  - Add `bboxPolygon` getter returning a default rotated-rectangle polygon
    (centered on car origin, local space).
  - Update subclasses: `GokartTraining`, `Gokart125cc`,
    `GokartGokartCentralen` — convert current pixel values to meters
    (realistic go-kart ≈ 1.8–1.9 m × 1.2–1.4 m).
- [x] A4. Update engine + renderer consumers to use `lengthPx` / `widthPx`
  instead of `width` / `height`. Call sites: `GameEngine.tickPlayer`
  (physics ray-casting origin), `GameEngine.checkCarCollision`,
  `GameEngine.buildSnapshot`, `Renderer.drawCar`, `Renderer.drawRays`,
  `Renderer.drawCollisionDebug`, `GameEngine.pausePlayer` (parking
  footprint), ray-cast center-point math.
- [x] A5. Verify: race an existing track. Cars appear 2× faster (scale
  flip side-effect); car sizes should look roughly the same visually
  (meters × 24 px/m ≈ old pixel values × 2). Confirm nothing crashes.

**Verification:** old tracks still race; cars look proportional; no runtime
or typecheck errors.

---

## Phase B — JSON track pivot (pre-work for everything downstream)

Rebuilds `Track` into a JSON-loading class. Deletes all existing TS track
subclasses + their PNG assets. Nothing is playable at the end of this
phase. This is the deepest refactor in Stage 1.

- [x] B1. Define `TrackJSON` type in `app/tracks/types.ts`:
  ```ts
  export type TrackJSON = {
      name: string;
      displayName: string;
      finishLineDirection: 'left' | 'right';
      isLoop: boolean;
      expectedLapTimes: Record<string, number>;
      vector: { anchors: Anchor[]; checkpoints: Checkpoint[]; };
  };
  ```
- [x] B2. Rewrite `app/tracks/Track.ts`:
  - Remove `abstract`. Constructor takes `TrackJSON`.
  - Fields populated from JSON (`name`, `isLoop`, `expectedLapTimes`,
    `finishLineDirection`, `checkpoints`, derived `startPosition`
    `startAngle`, derived `trackWidth` / `trackHeight`).
  - Delete `loadMedia`, `collisionMask`, `trackImage`, canvas refs, pixel
    `isPointColliding`, `drawCheckpoints`, `drawFinishLine`, `draw`. These
    all come back in Stage 2.
  - Add stubs for anything the engine currently calls (so the engine
    compiles) that throw `"Not available until Stage 2"` if invoked.
    (Built as harmless no-ops instead — `isPointColliding` → false,
    `draw` → nothing — so an accidental call doesn't crash.)
- [x] B3. Create `app/tracks/registry.ts`:
  ```ts
  const files = import.meta.glob<TrackJSON>('/public/tracks/*.json', { eager: true });
  export const TRACK_REGISTRY: Record<string, TrackJSON> = Object.fromEntries(
      Object.values(files).map(json => [json.name, json])
  );
  ```
- [x] B4. Delete all legacy track files:
  - `app/tracks/gokarts/GoKartTrackOne.ts` … `GoKartTrackFive.ts`
  - `app/tracks/gokarts/GokartTrackGokartCentralen*.ts` (×2)
  - `public/assets/gokart_125cc_track_*.png` and `_bounding_box.png` (all
    seven tracks' assets)
- [x] B5. Update every import site:
  - `app/views/LobbyView.ts` (TRACK_OPTIONS → iterate TRACK_REGISTRY)
  - `app/views/SinglePlayerView.ts` (tracks array → iterate TRACK_REGISTRY)
  - `app/routes/racing-multiplayer-ai.tsx` (createTrack switch →
    `new Track(TRACK_REGISTRY[name])`)
  - `app/sessions/training/TrainingOne.ts` (hard-coded `new GoKartTrack*()`
    constructors → `new Track(TRACK_REGISTRY['GoKartTrack*'])`)
  - `app/sessions/Practise.ts` (same pattern)
- [x] B6. Keep `public/tracks/` folder, add a `.gitkeep` so it exists but
  stays empty. On Vite dev-server start the glob is empty → TRACK_REGISTRY
  is `{}` → dropdowns are empty. That's correct for the interregnum.
- [x] B7. Compile — typecheck must pass. Any UI that reads from
  TRACK_REGISTRY on an empty registry should render gracefully (empty
  dropdown, "No tracks available" message where appropriate).

**Verification:** `npm run typecheck` passes. `npm run dev` starts without
errors. Opening `/racing/player`, `/racing/multiplayer-ai`,
`/track-editor` loads the UI but shows empty track lists. No crashes
anywhere; just "nothing to race" messages.

---

## Phase C — Tab shell + layout refactor

Rebuilds `TrackEditorView` into a shell with tabs + overlays. Checkpoints
tab is a placeholder in this phase (no logic yet — needs a vector track
to work on, which requires Phase F).

- [x] C1. Create `app/views/editorTabs/` folder.
- [x] C2. Define `EditorTab` interface + `OverlaySlots` shape in
  `app/views/editorTabs/EditorTab.ts`.
- [x] C3. Refactor `TrackEditorView.ts`:
  - Remove the 300px sidebar.
  - Tab bar above the canvas: "Vector" (default), "Checkpoints". No track
    picker in the top bar — a vector track is either being authored (in
    memory), opened (from `.vector.json`), or neither.
  - Canvas fills remaining viewport height. Base zoom: 3000 world-px wide
    (= 125 m at 24 px/m).
  - Five absolutely-positioned overlay slot divs on top of the canvas:
    `topStrip`, `leftTools`, `rightInspector`, `bottomRight`, `bottomLeft`.
  - Tab switch unmounts current tab, mounts new with the overlay slots.
- [x] C4. Placeholder CheckpointsTab + TrackTab (both empty, render
  "Not implemented yet" in the main area).

**Verification:** `/track-editor` opens with the new layout, tab bar
switches between the two placeholder tabs, overlays are empty but present.

---

## Phase D — Trace background (editor authoring aid)

Added at the shell level so both tabs see the same reference image.

- [x] D1. Create `public/trace-maps/` folder (with `.gitkeep`).
- [x] D2. Shell state: `background: { src, scale, offsetX, offsetY,
  rotation, opacity, locked } | null`. Vite glob loads available images:
  `import.meta.glob<string>('/public/trace-maps/*', { eager: true, as: 'url' })`.
- [x] D3. Shell render: when `background` is set, draw the image on the
  canvas BELOW the grid (above the clear, below gridlines). Apply
  scale/offset/rotation/opacity via canvas transform + `globalAlpha`.
- [x] D4. Right inspector panel for background authoring (triggered by a
  "Background" button in the top strip):
  - Image dropdown (populated from the Vite glob).
  - Scale slider + numeric input.
  - Offset X / Y numeric inputs.
  - Rotation input (degrees).
  - Opacity slider.
  - Lock toggle.
  - Remove background button.
- [x] D5. When unlocked, dragging on empty canvas space moves the
  background (not pan). When locked, drag pans the canvas as usual.
- [x] D6. Persist background state into exported `TrackJSON` via
  `editorBackground` field (runtime ignores it). Round-trip verified on
  import. (Landed with Phase I: saved with the track, restored on Open.)

**Verification:** drop a trace image into `public/trace-maps/`, pick it in
the editor, scale/position to match the intended track size, lock it,
trace anchors on top. Export → re-import → background restored exactly.

---

## Phase E — Snap grid (editor-wide infrastructure)

Added at the shell level so both tabs consume it from a single source.

- [x] D1. Shell state: `gridSize: number` (default 24 = 1 m),
  `gridUnit: 'px' | 'cm' | 'm'` (default 'm'), `snapEnabled: boolean`,
  `showGrid: boolean`.
- [x] D2. Grid renderer in the shell (so both tabs show the same grid):
  world-space lines every `gridSize` px across the visible rect, opacity
  scales with zoom, every 10th line thicker.
- [x] D3. Bottom-right overlay cluster:
  - Grid toggle button ("Grid: 1 m" / "Grid: off").
  - Unit selector (px / cm / m).
  - `+ / −` grid-size stepper.
  - "Snap" toggle (independent from grid visibility).
- [x] D4. `snapPoint(x, y)`: returns snapped coords when `snapEnabled`,
  passthrough otherwise. Exposed via the OverlaySlots or an EditorContext
  so tabs can call it.
- [x] D5. Shift modifier bypasses snap for the duration of a drag.

**Verification:** grid toggles cleanly in both tabs; grid stays aligned in
world space while panning/zooming; unit selector reformats the label;
Shift bypasses.

---

## Phase F — Track tab: data model + rendering pipeline

Types + pure-function utilities. No authoring yet; just the pipeline from
`VectorTrack` state → tessellated geometry on the canvas.

- [x] E1. Create `app/tracks/vector/` folder.
- [x] E2. Create `app/tracks/vector/types.ts` with `Anchor`, `Checkpoint`,
  `VectorTrack` types (per spec).
- [x] E3. `app/tracks/vector/flatten.ts` — `flattenCenterline(anchors)`:
  subdivide each cubic bezier into ~20 line segments. Returns flat points
  `{ pos, tangent, halfWidth, arcLength }[]` with `halfWidth` interpolated
  by arc-length between anchor neighbors. Loop closure: last anchor
  connects to first.
- [x] E4. `app/tracks/vector/offset.ts` — `computeOffsetPolylines(flat)`:
  project ±halfWidth perpendicular to tangent at each flat point. Returns
  `{ left: Vector[], right: Vector[] }`.
- [x] E5. `app/tracks/vector/tessellate.ts` — `tessellate(flat)`: emit a
  triangle strip (interleaved left/right offset vertices) for a filled
  path render.
- [x] E6. TrackTab mount: renders the empty state (grid only + "Click to
  drop your first anchor" hint centered in the canvas).

**Verification:** switching to Track tab shows the grid + hint; no
errors; nothing to interact with yet.

---

## Phase G — Track tab: authoring

The MVP interaction surface. ~300–500 lines; this is the biggest phase.

- [x] F1. Click to drop anchor at the (world-space, snapped) position.
  Default `halfWidth = 96` (= 4 m). Linear segment to previous anchor.
- [x] F2. Click-and-drag: on mousedown place anchor; on drag stretch out
  the `controlOut` handle; next anchor's `controlIn` mirrors it
  (symmetric).
- [x] F3. Anchor hit-test + selection. Click anchor → select;
  render it highlighted. Click empty space → deselect.
- [x] F4. Drag selected anchor to move `pos` (snap-aware).
- [x] F5. Draw bezier control handles for the selected anchor only. Drag
  handles to adjust `controlIn` / `controlOut`.
- [x] F6. Hit-test the flat centerline (points, not segments — just find
  the nearest flat point within a threshold). Click on centerline not
  near an anchor → insert new anchor at that flat point, splitting the
  segment while preserving shape as much as possible.
- [x] F7. Delete key (or right-inspector "Delete" button) removes selected
  anchor. Segments auto-reconnect. Empty state when the last anchor is
  deleted.
- [x] F8. Right inspector when an anchor is selected: `halfWidth` slider
  (min 24 px = 1 m, max 480 px = 20 m). Live preview — tessellation
  re-runs on change.
- [x] F9. Loop closure visual: the last anchor's segment back to anchor[0]
  is drawn in the same style (not dashed/distinguished).

**Verification:** author a complete loop track end-to-end — drop ~10
anchors (mix of linear + bezier), adjust widths, insert a mid-segment
anchor, delete one, verify the tessellation stays correct.

---

## Phase H — Checkpoints tab: authoring on vector tracks

The Checkpoints tab now operates on the IN-MEMORY vector track from the
Track tab (shared editor state). Rebuilt in overlay style to match.

- [x] H1. Shared track render (`TrackBandRenderer`) used by both tabs.
  Checkpoints tab shows faded, non-editable anchors. Empty state:
  "Author a track in the Track tab first."
- [x] H2. "Add Checkpoint" placing mode (left tools): ghost preview follows
  the cursor; click the track → checkpoint snaps to the nearest centerline
  point (`project.ts`). Stays on for multi-placement; Esc / button exits.
- [x] H3. Render: line across the full track width + number. Start =
  white + direction arrow; finish = checkered; both = checkered + arrow;
  unused = dimmed grey.
- [x] Storage: world position, re-projected onto the centerline on every use.
- [x] Order: auto-sorted by distance along the lap from the start.
- [x] Start / finish flags (exactly one each, may coincide). First placed =
  both. Loop vs one-way derived. Unused (past finish on one-way) dimmed.
- [x] "Reverse Direction" button (currently reverses anchor order + swaps
  handles — to be replaced by the per-layout flag in Phase H2).
- [x] H4. Select (click line), drag along centerline, Delete/Backspace,
  Esc deselects. Selection held by object reference (list re-sorts).
- [x] H5. Inspector: number + role, Set as Start, Set as Finish, Delete.
- [x] H6. Bottom-left collapsible list in lap order with Start / Finish /
  unused tags; click a row to select.

**Verification:** place checkpoints out of order → numbering follows the lap
from the start; set a different finish → "one-way", checkpoints past it dim.

---

## Phase H2 — Layouts (multiple checkpoint setups per track)

One track = shared geometry + one or more layouts. Design in
`.personal/vector-tracks.md` → "Layouts". Lands before Phase I so the JSON
format is right the first time.

- [x] L1. Types: `Layout { id, name, checkpoints, expectedLapTimes,
  reversed? }`. Editor state `{ anchors, layouts, activeLayoutId }`
  replaces `{ anchors, checkpoints }`. A new track starts with one layout.
- [x] L2. Checkpoints tab works on the ACTIVE layout's checkpoints.
- [x] L3. Layout picker (top strip of the Checkpoints tab): dropdown +
  Add / Rename / Delete (can't delete the last layout).
- [x] L4. Direction per layout: replace the anchor-reversing button with a
  `reversed` toggle, shown only on loop layouts. Ordering, unused set, start
  arrow and (later) spawn heading read the flag. Remove `reverse.ts` usage.
- [x] L5. Docs/registry follow-up (for Phase I / Stage 2): dropdowns list
  one entry per (track, layout); `createTrack(name, layoutId)`; sessions
  reference track + layout.
  - Done as refs: `createTrack("TrackName::layoutId")`; a bare
    `"TrackName"` means the first layout, so session name lists keep
    working. `Track` = one layout (`new Track(json, layoutId?)`).

**Verification:** create two layouts on one track with different start /
finish / checkpoints; switching the picker swaps the checkpoint set; reversing
one loop layout doesn't affect the other; Track tab edits affect both.

---

## Phase I — New / Open / Save / Publish

Produces the one JSON file that is the entire track definition. Export
(browser download) was replaced by writing straight to disk. Design in
`.personal/vector-tracks.md` → "Saving and publishing".

- [x] I1. Format + loading: `TrackJSON` = `{ name, displayName,
  vector: { anchors }, layouts, editorBackground? }` (`finishLineDirection`,
  `isLoop`, top-level lap times dropped). `app/tracks/serialize.ts`
  (`serializeTrack` / `deserializeTrack` / `trackFileStem`). Lap helpers
  moved to `app/tracks/vector/layout.ts`.
- [x] I2. Dev-only track store: `vite-plugins/trackStore.ts` (list / read /
  save / delete, whitelisted folders + filenames) + `app/tracks/store.ts`
  client.
- [x] I3. File menu (`app/views/TrackFileMenu.ts`), top-right of the
  viewport, on every tab:
  - New (confirms unsaved changes).
  - Open (one row per track + status; changed tracks open their draft;
    fits the camera; restores the trace background).
  - Save → `public/tracks/drafts/<stem>.json`. First save asks for name
    (unique across drafts + published) and display name.
  - Publish → `public/tracks/<stem>.json`, then deletes the draft. Needs
    ≥ 2 anchors and a checkpoint on every layout.
- [x] I4. Status next to the buttons + in Open: Draft / Published /
  Unpublished changes (derived from which files exist).
- [x] I5. No page reload on save/publish: Tailwind skips `public/tracks`
  (`app/app.css`), plugin `hotUpdate` skips track files.
- Lap times: not edited in the editor; saved as 0 for every car class.

**Verification (done):** author → Save → Publish → track appears in the
game registry after a reload; Open restores the track; open → change →
Save / Publish keeps the editor open; status follows each step.

**Not done (later, if wanted):** rename / save-as, Ctrl/Cmd+S, warning on
closing the browser tab with unsaved changes, Discard draft.

---

## Out of scope for Stage 1 (lands in Stage 2)

- Vector runtime: `Track.draw()` tessellating from JSON vector data.
- Vector collision: `isPointColliding` as quadtree closest-point.
- Vector rays: analytical ray-vs-polyline intersection.
- Deletion of pixel-collision / pixel-ray code paths in `Car` and `Track`.
- Making published tracks actually playable.

## Interregnum caveats

Between Stage 1 ship and Stage 2 ship:
- No playable tracks.
- `/racing/player`, `/racing/ai`, `/racing/multiplayer-ai`, lobby, HUDs
  all load but can't race.
- Manual WS flow testing requires a Stage 2 preview or a stub track.
- Robin accepted this gap explicitly.
