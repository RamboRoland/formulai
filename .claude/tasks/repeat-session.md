# Repeating session (training that goes around forever)

Robin (2026-10-29): a session that never ends: once every stage is
completed it starts over at stage 1.

## Decisions
- **Setup:** session JSON `"repeat": true` (optional, default false).
  No new game mode.
- **Repeat only when every stage is completed** (`stageCompleted` all
  true) → flags cleared, back to stage 1 (instead of "session completed").
- **Skipped stages get replayed:** leaving a stage (completed or skipped)
  → the next stage after it that is NOT completed, searching forward and
  wrapping around. First round = stage by stage as today; after the last
  stage it goes back to the first skipped one; when none is left → new
  round from stage 1. (Only the last stage skipped → it starts over.)
  Single player can't skip, so it simply wraps after the last finish.
- **Fresh stage when entered:** `Player.stages` keeps state per stage
  index, so a stage entered again is `resetStage()`d (laps, lap times,
  checkpoints, stage clock, meters → 0). New grid (`assignGrid`) as at
  every stage.
- **Never completed:** `isCompleted()` false for a repeating session →
  engine never stops, GameState `session.completed` always false,
  multiplayer never sends `req:game/completed` (lobby can always reopen).
  No new GameState field.
- **completedMeters:** per stage, as today (0 at every new stage/restart).
- **Modes:** all (single player, AI mode, multiplayer).
- Sessions without `repeat`: unchanged.

## Phase 1: data
- [x] 1. `SessionJSON.repeat?: boolean` (types), registry validation
      (boolean if present), `Session.repeat`
- [x] 2. `Session.advance()` (moves currentStage, returns it): no repeat →
      current + 1 (last stays put, as today); repeat → next not-completed
      (wrapping), all completed → clear flags, 0
- [x] 3. `Session.isCompleted()` → false when repeat
- [x] 4. tsc clean + scratch test (17 ok): no-repeat order + completion
      unchanged; rounds; Robin's skip-2 table; skip 1+3; skipped twice;
      last skipped; one stage; parse keeps / omits / rejects repeat.
      Not called by the engine yet (Phase 2)

## Phase 2: engine
- [x] 1. `Player.nextStage()` → `Player.enterStage(index)`: currentStageId
      = index + resetStage (a re-entered stage starts fresh)
- [x] 2. `GameEngine`: `advanceStage` → private `enterStage(player)` (no
      repeat + last stage → car.reset only, as before) + `finishStage`
      (single-player finish, both loop + one-way paths); `nextStage` and
      `finishStage` call `Session.advance()` once
- [x] 3. tsc clean + engine test on track copies (shasum = real), real
      checkpoint crossings, seeded Math.random. No repeat: old (HEAD) vs
      new IDENTICAL, 15 states (single player through all stages + session
      finished; AI next true/false, skip → stuck on last as before; 3
      players). Repeat: single player 2 rounds (stage 1 fresh, never
      finished); 3 players skip-2 table (back to 2 fresh, then round); one
      stage skipped → again, completed → again fresh

## Phase 3: try it
- [x] 1. Claude browser test: temp `zz_repeat_test.json` (Torslanda
      Training 1 + 2, repeat) + DEFAULT_SESSION pointed at it. Live engine,
      real crossings: 5 finishes → st 1, 2, 1, 2, 1 (each fresh: laps /
      cp / times / meters / stage clock 0, car in the pole box, HUD reset),
      never completed/finished, no console errors. Temp file + default
      reverted (TrainingOne loads again, no errors); tracks +
      training_one.json shasum unchanged
- [x] 2. `app/assets/sessions/training_endless.json` (`TrainingEndless`,
      TrainingOne's 12 stages + repeat). DEFAULT_SESSION unchanged (open)
- [ ] 3. Robin checks it
- [x] 4. Docs: `.personal/CLAUDE.md` Sessions (example, TrainingEndless,
      advance / repeat), README (session.completed, nextStage, sessions
      table, cars)
