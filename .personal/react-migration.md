# React → Pure TypeScript Migration

Working document. One entry per file that touches React. For each, we agree on
a **Decision** and (optionally) an **Order** before any code is written.

**Goal:** eliminate React entirely. No `useEffect` anywhere.
**Motivator:** better startup/bundle perf; escape React lifecycle.

---

## Legend

- **Uses:** which React features the file depends on.
- **Job:** what the file actually does (independent of React).
- **Decision:** filled in during review. One of:
  - `rewrite-pure-ts` — replace React with plain TS/DOM (or class).
  - `delete` — the file goes away entirely.
  - `keep-for-now` — leave alone until later phase.
  - `already-pure` — no work needed (only a type import to remove).
- **Order:** integer, filled in when we sequence the work.

---

## A. Route entry points (React Router shell)

### `app/root.tsx`  (75 lines)
- **Uses:** React Router (`Meta`, `Links`, `Outlet`, `Scripts`, `ScrollRestoration`), JSX.
- **Job:** HTML document shell + error boundary + route outlet.
- **Replaces with:** a plain `index.html` + a bootstrap TS entry that mounts pages into a root element.
- **Decision:** _tbd_
- **Order:** _tbd_

### `app/routes.ts`  (9 lines)
- **Uses:** `@react-router/dev/routes` config.
- **Job:** URL → route file map.
- **Replaces with:** a tiny router (hash- or history-API-based) in `app/router.ts`, ~50 lines.
- **Decision:** _tbd_
- **Order:** _tbd_

### `app/routes/home.tsx`  (4 lines)
- **Uses:** JSX passthrough to `<Home />`.
- **Job:** route wrapper.
- **Replaces with:** router entry pointing directly at the page module.
- **Decision:** _tbd_

### `app/routes/racing-player.tsx`  (7 lines)
- **Uses:** JSX; instantiates a session and passes to `<RacingGame />`.
- **Job:** route wrapper + session factory.
- **Replaces with:** route handler function that constructs the session and mounts the engine.
- **Decision:** _tbd_

### `app/routes/racing-ai.tsx`  (7 lines)
- **Uses:** JSX; same shape as racing-player.
- **Job:** route wrapper for AI mode.
- **Decision:** _tbd_

### `app/routes/racing-multiplayer-ai.tsx`  (65 lines)
- **Uses:** `useState` × 4 (lobbyId, players, gameStarted, session), JSX conditional (Lobby vs Game).
- **Job:** owns lobby → game transition state; picks which component to render.
- **Notes:** this is state plumbing between Lobby and Game. In pure TS the router just navigates from `/racing/multiplayer-ai/lobby` to `/racing/multiplayer-ai/game`, or the two views swap in the same mount point.
- **Decision:** _tbd_

### `app/routes/track-editor.tsx`  (14 lines)
- **Uses:** `useNavigate` from `react-router`; JSX wrapper.
- **Job:** route wrapper + back-navigation.
- **Decision:** _tbd_

---

## B. Pages / views (React components)

### `app/components/Home.tsx`  (103 lines)
- **Uses:** `<Link>` from `react-router`, JSX.
- **Job:** landing page menu with links to game modes.
- **Replaces with:** static-ish HTML built from a `renderHome(root: HTMLElement)` function; links use `router.navigate()` or plain `href` if we go hash-router.
- **Decision:** _tbd_

### `app/components/MultiplayerLobby.tsx`  (334 lines)
- **Uses:** `useState` × 8, `useEffect` × 3, JSX with forms (session/track/car selects), inline event handlers.
- **Job:** connect WebSocket, drive lobby state (create/join, receive playerJoined/Left), form-bind session/track/cars.
- **Replaces with:** a `MultiplayerLobbyView` class that owns a root element, a WS subscription lifecycle, and re-renders form/player list on state changes. Options for the "reactive" part: (a) subscribe/notify pattern, (b) small template rerender, (c) direct DOM mutation.
- **Notes:** heaviest React lifecycle use in the codebase after RacingGame.
- **Decision:** _tbd_

### `app/components/MultiplayerRacingGame.tsx`  (578 lines)
- **Uses:** `useState` × 4, `useRef` × 8, `useEffect` × 3, JSX.
- **Job:** owns a `Map<string, Player>`, runs multiplayer game loop, subscribes to control/state WS events, renders canvas + HUD.
- **Notes:** parallels RacingGame; migration strategy should mirror it.
- **Decision:** _tbd_

### `app/components/RacingGame.tsx`  (904 lines)
- **Uses:** `useState` × 8, `useRef` × 7, `useEffect`, JSX.
- **Job:** the actual game loop — physics, collision, checkpoints, laps, canvas draw, ray casting, WS wiring for AI mode.
- **Replaces with:** a `GameEngine` class in pure TS. Takes canvas elements + session in constructor. Exposes `start()`, `stop()`, `subscribe(event, handler)` for HUD/StatsBox to consume state without polling.
- **Notes:** the target of "extract engine first." Biggest single job.
- **Decision:** _tbd_

### `app/components/TrackEditor.tsx`  (788 lines)
- **Uses:** `useState` × 16, `useRef` × 2, `useEffect`, JSX with editor UI (buttons, sliders, checkpoint list).
- **Job:** load track, place/drag checkpoints, edit centerline, save.
- **Notes:** most form-heavy component. Highest cost to migrate. Candidate to leave until last, or to keep as a React island if we allow partial React.
- **Decision:** _tbd_

### `app/components/StatsBox.tsx`  (27 lines)
- **Uses:** JSX only. No hooks.
- **Job:** render telemetry (speed, angle, lap time, etc.) from props.
- **Replaces with:** `app/components/StatsBox.ts` class — `mount(root)`, `update(snapshot: CarStatsSnapshot)`, `destroy()`. Direct DOM writes per frame.
- **Contract:** **dumb** — displays whatever car snapshot it's handed. Does not know about actor selection, self-vs-remote, or how many cars exist.
- **Actor selection:** the **View** owns `trackedPlayerId` and hands StatsBox the corresponding car's snapshot each frame. StatsBox is unaware.
- **Notes:** hot path — called every frame. Direct DOM writes = real perf win here.
- **Decision:** `rewrite-pure-ts`

---

## C. React-flavored helpers

### `app/components/hooks/useControls.ts`  (51 lines)
- **Uses:** `useRef` × 2, `useEffect`.
- **Job:** wires KeyboardControls or WebSocketControls to a game mode; returns `getControls()`.
- **Replaces with:** a plain factory function `createControls(mode, onRestart): Controls` that owns the same refs internally and returns an accessor + cleanup.
- **Decision:** _tbd_

### `app/components/RacingGame.styles.ts`  (89 lines)
- **Uses:** none directly — but the object is JSX inline-style shape (`camelCase` keys).
- **Job:** style constants consumed by JSX components.
- **Replaces with:** CSS module, plain stylesheet, or an object still applied via `Object.assign(el.style, styles.container)`. Depends on how we render.
- **Decision:** _tbd_

---

## D. Files that only import `RefObject` (a type)

These aren't really React code — they take a canvas ref as a parameter and only need
`RefObject<HTMLCanvasElement>` as a type. Trivially replaceable with
`{ current: HTMLCanvasElement | null }` or just `HTMLCanvasElement`.

### `app/tracks/Track.ts`  (200 lines)
- **Uses:** `type { RefObject } from 'react'`.
- **Decision (recommended):** `already-pure` — swap `RefObject<T>` for `{ current: T | null }` (or better, pass the raw element) as part of engine extraction.

### `app/tracks/gokarts/GoKartTrackOne.ts`  (34 lines)
- Same as above.
- **Decision (recommended):** `already-pure`.

### `app/sessions/Session.ts`  (104 lines)
- **Uses:** `type { RefObject } from 'react'` — canvas is threaded through session → stage → track.
- **Decision (recommended):** `already-pure` — same swap, ideally the engine passes the canvas element directly, not a ref-like.

---

## E. Fully pure TypeScript (no React at all)

Listed here to confirm they survive the migration untouched:

- `app/cars/**` — Car.ts, gokarts/*
- `app/tracks/gokarts/**` (except the one above via Track.ts)
- `app/services/websocket.ts`
- `app/services/controls.ts`
- `app/components/controls/**` (KeyboardControls, WebSocketControls, types, index)
- `app/components/Vector.ts`
- `app/utils/**` (quadtree, checkpointUtils, trackCenterlineUtils)
- `app/Player.ts`
- `app/types.ts`
- `app/helper.ts`
- `server/**`

**No work needed for anything in this section.**

---

## Proposed migration phases

**Ordered work items live in `.claude/tasks/todo.md`.** This section only
records the phase names for reference; do not track progress here.

1. **`StatsBox`** as class — prove the pattern with the smallest piece.
2. **Extract `GameEngine`** from `RacingGame.tsx` — biggest single job.
3. **Extract `Renderer`** + finalize `RenderSnapshot`.
4. **Replace `useControls`** hook with a factory.
5. **Router + shell** — `index.html`, `main.ts`, `router.ts`, migrate `HomeView` + `SinglePlayerView`.
6. **Migrate remaining views** — Ai, Training, Lobby, MultiplayerHost, TrackEditor.
7. **Remove React** — delete files, drop deps, verify.

---

## View catalogue: what's unique to each

Target hierarchy (agreed):

```
View (interface)
 ├── HomeView                                 # no canvas, no engine, no WS
 ├── LobbyView                                # WS, no canvas, no engine
 ├── TrackEditorView                          # canvas, no engine, no WS
 └── RacingView (abstract)                    # canvas + Renderer + StatsBox + mount/unmount
      ├── SinglePlayerView                    # local engine, 1 car, keyboard
      ├── AiView                              # local engine, 1 car, WS controls, publishes state
      ├── TrainingView                        # local engine, 1 car, TrainingOne session
      └── MultiplayerHostView                 # local engine, N cars, ALL WS-controlled, no selfId
```

**Multiplayer is AI-only.** External AI processes connect via WS to control
individual cars. The browser only ever hosts a multiplayer race — it runs
physics and renders, but does not participate. No browser-side non-host view
exists (no `MultiplayerClientView`).

All racing views extend `RacingView` directly and use the same `Renderer`. Every
racing view feeds its `RenderSnapshot` from a local `GameEngine.snapshot()`.

**Rendering pipeline (see `engine/Renderer.ts` below):**

```
GameEngine.snapshot()  →  RenderSnapshot  →  Renderer  →  canvas
```

`Renderer` sees exactly one input type. Zero knowledge of engines or WS.

**Future extension point — `SpectatorView`:** designed for, not created now.
Would extend `RacingView`, override `wireControls()` and `wireHud()` as no-ops,
build a `RenderSnapshot` with `selfId: undefined`. Renderer already handles
optional `selfId` (no personal StatsBox highlight). State would arrive over WS,
so an `Interpolator` would produce the snapshot at query time.

**App-owned types + transformers (deferred to Phase 6):** the app has its own
internal types (car state, game state, controls) tailored for gameplay. The
wire (server-owned, `server/src/types/`) is a separate, evolvable protocol.
Small pure transformer functions in `app/wire/` bridge the two — the only
places that translate. Views and engine never see wire types. Introduced when
Phase 6 wires the first AI-mode view (`AiView`, `MultiplayerHostView`); until
then, treat wire types and app types as coincidentally identical.

**Discipline for `RenderSnapshot`:** every field must be linearly interpolatable
(numeric coordinates, angles, scalars — not enums, not strings, not opaque
handles). This keeps a future WS-driven Interpolator a drop-in with no changes
to the Renderer or the snapshot type.

### HUD composition

The Renderer paints the canvas. **HUDs are separate** — DOM widgets overlaid
on the canvas (StatsBox, leaderboard, stage indicator, actor picker, etc.).
Each concrete `RacingView` decides which HUDs to mount and where.

**`Hud` interface** (all HUD widgets implement this):

```ts
interface Hud {
    mount(parent: HTMLElement): void;
    update?(snapshot: RenderSnapshot): void;  // optional — static HUDs skip
    destroy(): void;
}
```

**Slots** — predefined positioned regions on the racing view:
`'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'center'`.
Base creates the slot's div lazily on first use.

**`RacingView` provides:**

- `protected mountHud(hud: Hud, slot: HudSlot): void` — attaches, tracks for cleanup.
- `protected abstract wireHud(): void` — each concrete view must implement (may be empty).

**Frame loop (base):** after `renderer.draw(snapshot)`, iterate mounted HUDs and
call `hud.update?.(snapshot)` on each. All HUDs get the same snapshot; each
picks the fields it needs.

**On `unmount()`:** base iterates every mounted HUD and calls `destroy()`.

For every view: the **fields**, **DOM**, **WS traffic**, **params at mount**, and **anything else** that is *not* provided by the base it extends.

---

### `HomeView`

- **DOM:** menu with links to each game mode + track editor.
- **State:** none.
- **WS:** none.
- **Params:** none.
- **Navigation out:** `router.navigate('/racing/player' | '/racing/ai' | '/racing/multiplayer-ai' | '/track-editor' | '/racing/training')`.
- **Notes:** simplest view. Good candidate to migrate first as router proof-of-life.

---

### `LobbyView`

- **DOM:** create-lobby form (session select, track select, cars multi-select) OR active-lobby view (lobby id, players list, start/leave buttons). Two panels, one visible at a time.
- **State:** `createdLobby: boolean`, `session`, `track`, `cars[]`, `players[]`, `clientId`, `error`.
- **WS subprotocol:** `game` (as host) or `multiplayer` (as joiner).
- **WS subscriptions:** `evt:system/welcome` (get clientId), `res:lobby/create`, `res:lobby/join`, `res:lobby/joinError`, `evt:lobby/playerJoined`, `evt:lobby/playerLeft`.
- **WS sends:** `req:lobby/create`, `req:lobby/join`, `req:lobby/leave`, `req:game/start`.
- **Params:** none for host; `?lobbyId=XXXX` for joiners (if we support link-join).
- **Navigation out:** on `evt:game/start`, → `MultiplayerHostView` (host) or `MultiplayerClientView` (joiners) with `{ lobbyId, players, session, track }`.

---

### `TrackEditorView`

- **DOM:** canvas + toolbar (place/drag checkpoint, save, zoom, pan, toggle collision mask, toggle centerline preview, toggle all-checkpoints view, delete-selected, exit).
- **State:** `selectedTrack`, `checkpoints[]`, `isPlacingCheckpoint`, `selectedCheckpoint`, `isDragging`, `dragStart`, `isDraggingCheckpoint`, `draggedCheckpoint`, `hasDragged`, `zoom`, `panOffset`, `precomputedCenterlineData`, `quadtree`, `showAllCheckpoints`, `showBoundingBox`, `isGameInitialized`.
- **WS:** none.
- **Engine:** none — imperative canvas drawing tied to mouse events.
- **Params:** `?track=<name>` (which track to edit); default when omitted.
- **Notes:** heaviest UI in the app; most React state to migrate. Not on the critical path — can be last.

---

### `RacingView` (abstract, base of the racing tree)

- **DOM:** four `<canvas>` layers (main, background, collision, fps) + HUD slot containers (created lazily as `mountHud()` is called).
- **State:** `renderer: Renderer`, `trackedPlayerId: string`, `mountedHuds: Hud[]`, `unsubs: (() => void)[]`, `zoom`, `showBoundingBox` (debug), FPS counter.
- **Actor tracking:** `trackedPlayerId` decides whose telemetry HUDs (like StatsBox) focus on. Concrete views set it at mount; MultiplayerHostView additionally exposes UI to change it.
- **Lifecycle:** on `mount()`: build canvas layers → `wireControls()` → `wireHud()` → start per-frame render loop: `snap = getRenderSnapshot()`, `renderer.draw(snap)`, `mountedHuds.forEach(h => h.update?.(snap))`. On `unmount()`: cancel rAF, `mountedHuds.forEach(h => h.destroy())`, run `unsubs`, remove DOM.
- **Abstract methods:**
  - `getRenderSnapshot(): RenderSnapshot` — how does this view produce the frame's data?
  - `wireControls(): void` — hook up input for this view (keyboard listeners, WS subscriptions, etc.). Default: no-op, for future SpectatorView.
  - `wireHud(): void` — the view's HUD-composition method. Called once by base `mount()`. Inside, the view calls `this.mountHud(new SomeHud(), 'topLeft')` for each widget it wants overlaid on the canvas. May be empty.
- **Helper:** `protected mountHud(hud: Hud, slot: HudSlot): void` — attaches HUD to the slot's container and tracks it for cleanup.
- **Notes:** owns nothing racing-specific beyond the Renderer + HUD wiring. Engine, actors, controllers, WS, HUD composition — all live in concrete views.

---

### `SinglePlayerView` (extends `RacingView`)

- **Actors:** `[{ id: 'local', car: <chosen>, session: Practise }]`.
- **Controllers:** `[KeyboardController]`.
- **WS:** none.
- **HUDs mounted:** `StatsBox` at `topLeft`.
- **Params:** `?track=<name>` (which Practise track to load); default when omitted.
- **Unique wiring:** keyboard 'R' → `engine.restart()` (or engine reads restart via controls).

---

### `AiView` (extends `RacingView`)

- **Actors:** `[{ id: 'local', car: <chosen>, session: Practise }]`.
- **Controllers:** `[WsInputController]`.
- **WS subprotocol:** `game`.
- **WS subscriptions:** `evt:control/update` (controls), `evt:control/setTrack` (change track mid-run), `evt:game/startStage`, `evt:game/nextStage`.
- **WS sends:** `res:game/state` (published every N ms in response to server's `req:game/state`).
- **HUDs mounted:** `StatsBox` at `topLeft`; `AiModeIndicator` at `topRight`.
- **Params:** `?track=<name>` (optional).
- **Unique wiring:** engine subscribes to `stats` event → serializes as `GameState` → `ws.send('res:game', 'state', …)`.

---

### `TrainingView` (extends `RacingView`)

- **Actors:** `[{ id: 'local', car: HyrkartCentralen, session: TrainingOne }]`.
- **Controllers:** `[KeyboardController]`.
- **WS:** none (unless training-via-AI variant exists later).
- **HUDs mounted:** `StatsBox` at `topLeft`; `StageIndicator` at `topCenter` (which of 4 stages, stage-laps completed); `StageCompletionOverlay` at `center` (shown on `stageCompleted` event, hidden otherwise); `SessionCompletionOverlay` at `center` (shown on `sessionCompleted`).
- **Params:** none.
- **Unique wiring:** on `engine.on('stageCompleted')` → show completion overlay with "Next stage" button that calls `session.nextStage() + engine.reset()`; on `engine.on('sessionCompleted')` → show final times summary.
- **Notes:** the only view that runs a multi-stage `Session` today; needs UI for stage transitions.

---

### `MultiplayerHostView` (extends `RacingView`)

- **Role:** browser hosts the race but does **not** drive. All cars are controlled by external AI processes via WS.
- **Actors:** one per player in the lobby: `[{ id: aiPlayerId, car, controller: WsInputController }]` × N.
- **Controllers:** `WsInputController` per actor (fed by `evt:control/update` from that AI's WS connection). No keyboard.
- **`selfId`:** none — host is not a participant. StatsBox for "self" is not shown.
- **WS subprotocol:** `game`.
- **WS subscriptions:** `req:game/playerState` from server ("publish state for player X"), `evt:control/update` per remote AI.
- **WS sends:** `req:game/playerState` (host publishes per-player state to each AI), `req:game/start` (once, if not sent by lobby).
- **HUDs mounted:** `ActorPickerDropdown` at `topLeft` (dropdown + prev/next cycle to change `trackedPlayerId`); `StatsBox` at `topLeft` (below picker, tracks selected actor); `LeaderboardPanel` at `topRight` (per-actor positions, lap times, current stage).
- **Params:** `{ lobbyId, players: LobbyPlayer[], session: 'practise' | 'trainingOne', track: string | null }` from LobbyView.
- **Unique wiring:** on receiving `req:game/playerState { playerId }`, engine reads actor `playerId`'s state and sends `req:game/playerState { playerId, gameState }`.

---

<!-- MultiplayerClientView removed: browser has no non-host multiplayer view.
     External AI processes act as "clients" via WS and don't render in the
     browser at all. Future SpectatorView (documented in the hierarchy intro
     above) is a separate design and covers any human "watch AIs race" case. -->

---

## Review log

_Decisions get logged here as we go through each file._

- (empty)
