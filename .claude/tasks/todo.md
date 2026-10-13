# React → Pure TypeScript Migration — Todo

Source of truth for ordered work. Design decisions and per-file catalogue live in
`.personal/react-migration.md`. This file only tracks **what to do next**.

**Rule:** don't start a phase until the previous one is verified working. Each
phase must leave the app in a shippable state.

---

## 🏃 Immediate (do these when the current AI training finishes)

### 1. Fix `stageTime` to be truly monotonic (clock since stage started) ✅

- [x] `app/Player.ts` — added `stageTime: number` to `PlayerStage`, initialized `0` per stage.
- [x] `app/Player.ts` — `addLapTime` also increments `stageTime`.
- [x] `app/Player.ts` — `resetLap` leaves `stageTime` alone.
- [x] `app/Player.ts` — `resetStage` zeros `stageTime`.
- [x] `AiView.buildGameState` + `MultiplayerHostView.buildGameStateFor` — read `player.stage().stageTime`.
- [x] `GameEngine` stats emit — reads `player.stage().stageTime`.
- [ ] Verify: at `/racing/player`, `Lap:` resets on R but `Stage:` keeps counting.

### 2. Fill in real `expectedLapTime` benchmarks

Each of the 5 track files has placeholder `0`s. Replace with real seconds
after benchmarking.

- [ ] `app/tracks/gokarts/GoKartTrackOne.ts` — update `GokartTraining` (currently 0; `GokartGokartCentralen` already set to 15).
- [ ] `app/tracks/gokarts/GoKartTrackTwo.ts` — update `GokartTraining` (0; CentralenKart = 12).
- [ ] `app/tracks/gokarts/GoKartTrackThree.ts` — update `GokartTraining` (0; CentralenKart = 20).
- [ ] `app/tracks/gokarts/GokartTrackGokartCentralenGBG.ts` — update both.
- [ ] `app/tracks/gokarts/GokartTrackGokartCentralenKungalv.ts` — update both.

---

## Phase 0 — Prerequisites (done)

- [x] WebSocket wire types moved to `server/src/types/` (server owns the wire)
- [x] `server/src/websocket.ts` typed against new types (0 errors in `server/src/`)
- [x] Migration design captured in `.personal/react-migration.md`
- [x] Target view hierarchy agreed (4 racing views, all extend `RacingView`)
- [x] Rendering pipeline design agreed (`Engine → RenderSnapshot → Renderer`)
- [x] `RenderSnapshot` discipline agreed (linearly interpolatable fields)

---

## Phase 1 — Prove the pattern with `StatsBox` ✅

Smallest possible unit that exercises class-as-view. If we hate the result,
we've lost an afternoon. If we love it, everything else follows.

**Contract:** StatsBox is **dumb** — takes one car's snapshot per frame, has no
concept of actor selection. The caller (View) decides which car's data to pass.
Actor-picker UI is a View-level concern (Phase 6, `MultiplayerHostView`); not
in Phase 1.

- [x] Define `app/engine/RenderSnapshot.ts` — start minimal, exposing just `CarStatsSnapshot` (speed, angle, lapTime, currentCheckpoint, totalCheckpoints, completedLaps). Wider snapshot fields added in Phase 3.
- [x] Create `app/hud/StatsBox.ts` — class with `mount(root)`, `update(snapshot: CarStatsSnapshot)`, `destroy()`. No JSX.
- [x] Wire the new StatsBox into current `RacingGame.tsx` — replace the React `<StatsBox />` with class instance mounted via `useRef` + `useEffect`.
- [x] Verify: HUD updates at 60fps, no visual regression, no memory leaks on route change.
<!-- Old React StatsBox.tsx is still consumed by MultiplayerRacingGame.tsx.
     It will be deleted in Phase 6 when MultiplayerRacingGame.tsx is replaced
     by MultiplayerHostView. Leaving it alone keeps phase boundaries clean. -->

---

## Phase 2 — Extract `GameEngine` from `RacingGame.tsx`

Biggest single job. Do it while React is still around, so we can compare
side-by-side.

Sub-steps executed step-by-step, verified visually between bundles.

- [x] **Step 1** — Introduce `Player` in `RacingGame.tsx`, reconcile Session/Player API usage (`.car`, `.stage()` state, method calls), restore track picker with correct `gameSession.constructor.name === 'Practise'` check.
- [x] **Step 2** — Create `app/engine/BaseEngine.ts` (abstract loop, delta-time, event emitter) and `app/engine/GameEngine.ts` skeleton.
- [x] **Step 3** — Move loop body (physics, collision, ray casting, checkpoints, drawing) from `RacingGame.tsx` INTO `GameEngine.tick(dt)`. Includes helpers `checkCarCollision`, `checkCheckpointPass`, `isPointBetween`, `advanceStage`, `startStage`. RacingGame subscribes to `stats` + `sessionCompleted` events.
- [x] **Step 4** — Folded into Step 3 (drawing was interleaved with physics via ray casting). Phase 3 will properly split rendering out into a `Renderer`.
- [x] **Step 5** — Cleanup pass on `RacingGame.tsx`: removed unused imports (`Car`, `Vector`, `fromKmhToPixels`, `getInitialGameState`, `RAY_LENGTH`/`RAY_ANGLE`, `RacingGameState`). Actual thinning to a "shim" happens when it becomes `SinglePlayerView` in Phase 5+.
- [x] Verify: single-player identical behavior — drive, wall collision, checkpoints, laps, stage 1→2 track/car reset, FPS, on-screen button highlight, clean re-navigation.

---

## Phase 3 — Extract `Renderer` ✅

- [x] Finalize `app/engine/RenderSnapshot.ts` (full shape: track, cars[], selfId?, camera, showBoundingBox, fps).
- [x] Create `app/engine/Renderer.ts` — takes snapshot, paints canvas layers. No math, no engine knowledge.
- [x] `GameEngine` builds a snapshot each tick and calls `renderer.draw(snap)`. Ray casting uses `Car.findEdgeInDirection` (physics only).
- [x] `RacingGame.tsx` uses Renderer for all drawing.
- [x] Verify: single-player renders identically — car (red), track, 5 yellow rays, FPS overlay, bounding-box debug toggle.

---

## Phase 4 — Replace `useControls` with a factory ✅

- [x] Create `app/components/controls/createControls.ts` — factory returning `{ getControls(), destroy() }`
- [x] Replace `useControls` hook call site in `RacingGame.tsx` (MultiplayerRacingGame kept — deleted in Phase 6 alongside the component)
- [ ] Delete `app/components/hooks/useControls.ts` (deferred to Phase 6 when MultiplayerRacingGame goes away)
- [x] Verify: keyboard controls work — WASD, Space (brake), R (restart), on-screen Reset button, button highlights.

---

## Phase 5 — View pattern proof-of-life

Router work (index.html, main.ts, pure-TS router) is deferred to Phase 7 with
React removal. During Phases 5–6, each view exists as a pure-TS class hosted
by a thin React shim (`useEffect` mounts the view into a ref). React Router
still routes between shims.

- [x] **5.1** — `app/views/View.ts` interface + `HomeView` migration. `Home.tsx` becomes an 18-line React shim.
- [x] **5.2** — `app/views/RacingView.ts` abstract base class (canvas layers, Renderer/GameEngine wire-up, HUD mounting via slots, mount/unmount lifecycle, async track-media loading with loading screen).
- [x] **5.3** — `SinglePlayerView extends RacingView`. Player/controls/StatsBox/button-panel/zoom/bbox-toggle/back-to-menu/session-completion overlay/track-picker all in pure TS. `racing-player.tsx` route replaced by an 18-line shim; no longer uses `RacingGame.tsx`.
- [x] Verify: navigating between home and racing works, engine mounts/unmounts cleanly.

---

## Phase 6 — Migrate remaining views

Do these one at a time. After each, delete the corresponding React component.

- [ ] Introduce `app/wire/` — app-owned types (CarState, GameState, Controls, etc.) + transformers to/from wire types. First consumer: `AiView`. Documented in `.personal/react-migration.md`.
- [x] `AiView` (extends `RacingView`) — verified end-to-end with an external AI client. Pull-based `req:game/state` RPC now wired through server → host → server → AI.
- [ ] `TrainingView` (extends `RacingView`)
- [ ] `LobbyView`
- [x] `MultiplayerHostView` (extends `RacingView`) — core: N actors, per-player state RPC, drop handling. Verified end-to-end with multiple AIs driving.
  - [x] N-actor engine tick (iterate all players each frame instead of just the first)
  - [x] Wire `evt:lobby/playerLeft` → `engine.removeActor(playerId)` + `controls.clearControlsFor(playerId)` (primitives already in place)
  - [ ] Actor-picker dropdown + leaderboard HUDs → Phase 6.6.4
  - [ ] "Wait for all players to finish stage" — add `finishedPlayerIds[]` + `handlePlayerFinishedStage()` + `advanceAllStages()` on engine; add `track.finishedPosition(index)` for the move-aside spot; wire into `checkCheckpointPass` (deferred — see docs section 7B "Stage progression (multi-player)")
- [ ] `TrackEditorView` (largest UI job — last)

---

## Phase 7 — Remove React

Only after Phase 6 finishes and every route has a non-React view.

- [ ] Delete `app/root.tsx`
- [ ] Delete `app/routes.ts`
- [ ] Delete `app/routes/*.tsx`
- [ ] Delete `app/welcome/` (unused React scaffolding)
- [ ] Replace `type { RefObject } from 'react'` in `Track.ts`, `GoKartTrackOne.ts`, `Session.ts` with plain `HTMLCanvasElement` or `{ current: T | null }`
- [ ] Remove `react`, `react-dom`, `react-router`, `@react-router/*` from `package.json`
- [ ] Update `vite.config.ts` — drop React plugin, drop react-router dev config
- [ ] Verify: build succeeds, all views work, no `react*` import remains

---

## Review

_High-level summaries logged here after each phase completes._

### Phase 6.3 — clientId-aware controls routing + multiplayer-lobby docs ✅
- Wire types: `ReqControlSend.data` and `EvtControlUpdate.data` now carry `{ clientId, controls }`. Server's `handleControls` unchanged — forwards the payload as-is.
- `WebSocketControls` keys controls by `clientId` (Map) with a lastReceived fallback for single-actor hosts. Exposes `getControlsFor(playerId)` + `resetRestartFor(playerId)`.
- `createControls` factory returns `{ getControlsFor, destroy }` — unified API across keyboard (ignores playerId) and WS (looks up by playerId with fallback).
- `GameEngine` constructor now takes `getControlsFor: (playerId) => Controls`; tick fetches per-actor controls. Ready for MultiplayerHostView without further engine changes.
- `RacingView` passes `getControlsFor` through; `updatePressedIndicators` reads via `trackedActorId`.
- AI client docs significantly expanded in `formula-ai/.personal/websocket-ai-client.md`:
  - Updated cheat sheet, per-message detail, mermaid flow, and TS example to show the new `{ clientId, controls }` payload shape.
  - **New section 7 "Modes"** describes both AiView (single AI, no lobby) and Multiplayer Lobby (join via `multiplayer` subprotocol, `req:lobby/join`, wait for `evt:game/start`, decision loop). Includes a dedicated multiplayer mermaid flow.
  - "Known gaps" subsection flags open protocol questions (clientId↔slot mapping, broadcast state leak).
- Typecheck: 19 (unchanged baseline — all deltas remain in deferred MultiplayerLobby/Game subscribe signatures).
- User confirmed everything still works.

### Phase 6.2 — Typed WS client + AiView closed loop ✅
- Rewrote `app/services/websocket.ts`: deleted the hand-maintained `MessageType` union and the 4 callback setters (`setGameStateCallback`, `setTrackCallback`, `setStartStageCallback`, `setNextStageCallback`). `subscribe<Ns, A>` and `send<Ns, A>` now infer payload types from server-owned `WsMessage` via `PayloadOf` + `ActionsOf` helpers.
- Added `ActionsOf<Ns>` helper to `server/src/types/index.ts` so the client can constrain `A` to only valid actions for a namespace.
- Rewrote `WebSocketControls`: typed `subscribe('evt:control', 'update', ...)`, fixed the 3 pre-existing baseline errors there.
- Rewrote `AiView.wireWebSocket()` as 4 typed subscriptions: `evt:game/startStage`, `evt:game/nextStage`, `evt:control/setTrack`, and `req:game/state` (responds via `req:game/state { gameState }`).
- **Server-side gap closed:** added `req:game/state` handler in `server/src/websocket.ts`. One handler, two behaviors by sender type: `control` clients get the request forwarded to the host; `game` clients' responses get broadcast to all control clients. New wire type `ReqGameState` with union payload (`undefined | { gameState }`) in `server/src/types/game.ts`.
- Scaffold: created `app/wire/` folder with a README documenting when (and when not) to add transformer files between app internal types and wire types.
- Docs: created `formula-ai/.personal/websocket-ai-client.md` — AI-client-facing WS protocol guide. Explicit field breakdown, anti-patterns, cheat sheet, per-message payload shapes, mermaid flow, minimal TS client, known-limitations section.
- Verified: external AI client successfully connects, requests state, receives `res:game/state`, drives the car. **User confirmed AiView works end-to-end.**
- Typecheck: 8 → 19. The 11 new errors are all in `MultiplayerLobby.tsx` + `MultiplayerRacingGame.tsx` subscribe-handler signatures — explicitly deferred per user's "skip MultiplayerLobby/Game updates" choice. These resolve when those components migrate to View classes.

### Phase 6.6.1 + 6.6.2 — N-actor engine + MultiplayerHostView ✅
- Engine refactor: `GameEngine.tick()` iterates all players (was: first only). Session completion uses `Session.isCompleted(players)`. New `tickPlayer(player, dt, reset)` helper. Stats emitted per-player using `player.lapTime()`. Added `trackedPlayerId` + `setTrackedPlayerId` + `getPlayer(playerId)` to expose per-player state outside tick.
- `buildSnapshot()` camera + selfId follow `trackedPlayerId` (fallback: first player). RacingView calls `engine.setTrackedPlayerId` on mount.
- Single-player views (SinglePlayerView, AiView) unaffected (N=1 degenerate case).
- `MultiplayerHostView` (new): extends RacingView, gameMode='ai', pre-populates Players from lobby's player list with per-player colors. `createControls('ai')` wires WsInputController. On mount sends `req:game/start { lobbyId }`. Subscribes to:
  - `req:game/state { clientId }` → responds `req:game/state { clientId, gameState }` via `buildGameStateFor(playerId)` (per-player state, routed back to requester only).
  - `evt:lobby/playerLeft` → `engine.removeActor + controls.clearControlsFor`.
  - `engine.on('actorRemoved')` → switches trackedPlayerId if the dropped player was being tracked.
- `LobbyView.unmount()` no longer disconnects WS — preserves clientId → hostId mapping across view swap. `handleLeave` still disconnects via `WebSocketClient.resetInstance()`.
- Shim `racing-multiplayer-ai.tsx` mounts LobbyView → MultiplayerHostView on game-start. Resets WS singleton on route unmount.
- **Deleted:** `MultiplayerRacingGame.tsx` (578 lines), `StatsBox.tsx` (old React, orphaned after MultiplayerRacingGame removal), `app/services/controls.ts` (orphaned since Phase 4).
- Typecheck: 7 → 3 (only Session/Stage schema drift from Phase 0 remains).
- **Verified end-to-end: external AI clients connect, join lobby, host starts game, multiple cars race, controls routed per clientId, state RPC per-requester, drops handled.** User confirmed "they move!"

### Phase 6.1 — AiView (built, verification deferred)
- Created `app/views/AiView.ts`: extends RacingView, uses `createControls('ai')` for WsInputController, registers WS game-state callbacks (`setGameStateCallback`, `setStartStageCallback`, `setNextStageCallback`, `setTrackCallback`). Track hot-swap deferred with a `console.warn`.
- `app/routes/racing-ai.tsx` shrunk to an 18-line React shim.
- Deleted `app/components/RacingGame.tsx` (~620 lines, orphaned) and `app/components/hooks/useControls.ts` (no consumers), plus the empty `hooks/` folder.
- **Pending:** full AI-mode verification requires an external AI client. User flagged "hard to verify atm; will come back to fix AiView and WS com later." Related known issues from Phase 0: `WebSocketControls.subscribe('controls', ...)` call still uses the old 2-arg form (3 typecheck errors in that file).

### Phase 5.4 — RacingView default-UI refactor ✅
- Moved shared racing UI from SinglePlayerView up to RacingView as overrideable defaults: back-to-menu, bounding-box toggle, zoom +/-, control-button panel, control-indicator update wiring, and the session-completion overlay.
- All defaults live in protected `build*` methods called from `wireDefaults()`. Subclasses override individual methods or the whole `wireDefaults()`. `getTopRightWrapper()` helper lets subclasses append extras (e.g., track picker) to the top-right button row without touching the base.
- SinglePlayerView shrank from ~410 lines to ~85 lines: `createPlayers`, `createControlsInstance`, `wireHud` (StatsBox only), a `wireDefaults` override that adds the Practise track picker, and an `unmount` override.
- Verified: /racing/player still works end-to-end.
- Principle logged: reshuffle between base/subclass as patterns emerge; don't over-design upfront.

### Phase 5.2 + 5.3 — RacingView base + SinglePlayerView ✅
- `app/views/RacingView.ts`: abstract shell. Owns loading screen, 4 canvas layers (main, background, collision, fps), Renderer + GameEngine wire-up, HUD slot management (`topLeft`/`topCenter`/`topRight`/`bottomLeft`/`bottomCenter`/`bottomRight`/`center`), and mount/unmount lifecycle. Async `session.loadTrackMedia()` handled internally with a loading placeholder. Abstract hooks: `createPlayers()`, `createControlsInstance()`, `wireHud()`.
- `app/views/SinglePlayerView.ts`: pure-TS concrete view (~400 lines). Reproduces the entire `RacingGame.tsx` visual UI — StatsBox HUD, on-screen WASD/Space/Reset button indicators, "Back to Menu", "Show Bounding Box" toggle, zoom +/- buttons, session-completion overlay, Practise track picker. Subscribes to `stats` + `sessionCompleted` engine events.
- `app/routes/racing-player.tsx`: shrunk to an 18-line React shim that mounts `SinglePlayerView` in `useEffect`. No longer touches `RacingGame.tsx`.
- **Bug found + fixed:** initially passed `backgroundCanvas` (hidden) to `session.setCanvas()` — should be the visible `mainCanvas`. Original code had it right; I misread the JSX. Track paints onto the visible canvas; Renderer's camera clips.
- **Small polish:** zoom-button position corrected — original CSS used malformed `calc(wh - ...)` values that browsers silently ignored; only the `transform: translate(444px, 320px)` actually applied. Matched that offset explicitly.
- Verified: driving, wall collision, checkpoints, laps, stage advance, zoom, bounding box, back-to-menu, clean re-navigation. `/racing/ai` still functional via old `RacingGame.tsx` (untouched).

### Phase 5.1 — HomeView + View interface ✅
- Created `app/views/View.ts` — the `View` interface: `mount(root)` / `unmount()`. Contract: view owns its DOM, listeners, subscriptions; unmount releases all of them.
- Created `app/views/HomeView.ts` — pure-TS class using `createElement`/`textContent`, plain `<a href>` for cross-view navigation (browser handles it during transition), `addEventListener` for hover effects.
- `app/components/Home.tsx` shrunk from 103 lines of JSX to 18 lines: React shim that mounts `HomeView` in `useEffect`. Same pattern as StatsBox and every subsequent view will use during the transition.
- Verified: landing page renders, all 4 mode buttons work, hover effects, back-navigation clean.

### Phase 4 — createControls factory ✅
- New `app/components/controls/createControls.ts`: `createControls(mode, onRestart)` returns `{ getControls, destroy }`. Same behavior as the hook: instantiates a KeyboardControls (player) or WebSocketControls (ai), owns lifecycle, forwards `restart` edge to `onRestart` and clears it.
- `RacingGame.tsx`: swapped hook usage for a `useRef<ControlsInstance>` + `useEffect` pair. `getControls` is a stable ref-based callable that falls back to zeroed controls when the instance is null. `restartGame` local removed; the factory receives its callback inline, and the on-screen "Reset" button calls `engineRef.current?.requestReset()` directly.
- Small bonus fix: `KeyboardControls.getControls()` was declared as returning `ControlsState` (unimported) — corrected to `Controls`. Baseline errors: 9 → 8.
- Verified: WASD/Space/R, on-screen buttons, button-highlight pulse, clean re-navigation.

### Phase 3 — Extract Renderer ✅
- Added `Renderer` class in `app/engine/Renderer.ts`: constructor takes canvas ctx + fps ctx (owns FPS canvas setup once). `draw(snap)` paints track → cars → rays → collision debug → FPS. Zero physics.
- Expanded `RenderSnapshot.ts`: added `CarRenderState`, `CameraState`, and the full `RenderSnapshot` shape (track ref, cars[], selfId, camera, showBoundingBox, fps).
- Refactored `GameEngine`: constructor swap (canvasCtx+fpsCtx → renderer + collisionCtx). Ray casting now uses `Car.findEdgeInDirection` (physics-only). New private `buildSnapshot()`. End of `tick()` calls `renderer.draw(snap)`. `checkCarCollision` no longer draws debug — Renderer handles it via the snapshot flag.
- **Small color fix:** Player was constructed with `'#ffffff'` — renderer respects that (multi-actor ready) so the car drew white. Set the single-player Player color to `'red'` to preserve prior visual.
- Verified: same red car, track, rays, FPS, bounding-box toggle. Wall collision, laps, stage advance all unaffected.

### Phase 2 Steps 2 + 3 — Extract GameEngine ✅
- Created `app/engine/BaseEngine.ts`: abstract class with rAF loop, delta-time, typed event emitter (`on/off/emit` generic over an `Events extends Record<string, unknown>` map).
- Created `app/engine/GameEngine.ts`: extends `BaseEngine<GameEngineEvents>`. Owns physics, collision, ray casting, checkpoint progression, stage advance, and drawing (temporarily — Phase 3 splits the renderer out). Emits `stats`, `lapCompleted`, `stageCompleted`, `sessionCompleted`, `collision`. Public methods: `setZoom`, `setShowBoundingBox`, `requestReset`, `advanceStage(playerId)`, `startStage(playerId)`, `getLapTime`, `getLastLapTime`.
- `RacingGame.tsx` cut down: removed `gameLoop`, `gameStateRef`, `animationFrameRef`, `fpsRef`, `isResettingRef`, `checkCarCollision`, `checkCheckpointPass`, `isPointBetween`. Now instantiates engine when canvases + track are ready, subscribes to `stats` → StatsBox + pressed-buttons UI, subscribes to `sessionCompleted` → React state, pushes `zoom`/`showBoundingBox` via setters. WS callbacks call engine methods.
- Verified: all 9 checks pass — driving, collision, checkpoints, laps, stage advance with correct start-line reset, FPS, button highlight, clean re-navigation.
- **Note:** stage-currentStage duplication between `Player.currentStageId` and `Session.currentStage` is still there. `GameEngine.advanceStage()` keeps them in sync. Full deduplication is a Session refactor for later.

### Phase 2 Step 1 — Introduce Player in RacingGame.tsx ✅
- Added `nextStage()` to `Player`. Constructed `player` via `useState<Player>` in `RacingGame.tsx`. Replaced every `gameSession.car.*`, `gameSession.stage().<state>`, and lap/checkpoint/stage-progression method call with the `player.*` equivalent. `PlayerStage.lapsCompleted` replaces the old `stageLapsCompleted`.
- Fixed routes `racing-player.tsx` and `racing-ai.tsx` to pass `string[]` (was `string`).
- Restored the track picker with `gameSession.constructor.name === 'Practise'`.
- Inlined `getSessionTimes` from `player.stages`.
- **Bug found and patched:** stage advance updated `player.currentStageId` but not `gameSession.currentStage`, so track/car stayed on stage 1 visually. Now synced. Also swap `player.car.track` and call `car.reset()` on advance so the car appears at the new track's start line with zero speed. Marked as temporary; will centralize in Step 2's `GameEngine`.
- Typecheck: 83 → 9. RacingGame.tsx: 0 errors.
- Verified: drive, wall status, checkpoints, laps, stage 1 → stage 2 with correct start-line reset.

### Phase 1 — StatsBox as class ✅
- New files: `app/engine/RenderSnapshot.ts`, `app/hud/StatsBox.ts`.
- `RacingGame.tsx` swapped from React `<StatsBox {...props} />` to class instance mounted via `useRef` + `useEffect([isGameInitialized])`. `statsBoxState` React state removed.
- **Gotcha found:** effect deps had to be `[isGameInitialized]`, not `[]`. RacingGame early-returns to a loading screen before init, so the mount div only exists after that flag flips true. Empty deps meant the effect fired once against a null ref and never again.
- **Pre-existing bug found:** `RacingGame.tsx:831` — `gameSession.car.constructor.name === 'Practise'` crashes because `Session` has `cars` (plural) and `Practise` is a session class, not a car. Track-picker block commented out with a TEMP note; restoration task added under Phase 2.
- Typecheck: 84 → 83 (one error removed by commenting the crashing block).
- Verified: labels + values render; values update every frame; navigating away and back re-mounts cleanly.
- Old `app/components/StatsBox.tsx` stays for now — still used by `MultiplayerRacingGame.tsx`. Deletion deferred to Phase 6 when that component is replaced by `MultiplayerHostView`.

**Pattern proof:** the class-as-view approach works and does not fight React
during the transition. Cost: one useEffect for lifecycle, one ref for the mount
div, one ref for the instance. That's the same shape every future migrated
widget will use — good to have confirmed early.
