# Client-driven nextStage (no more parking)

Robin (2026-10-17): add the nextStage event to WS again, stop parking cars,
the client decides when to go to the next stage.

## Decisions (Robin)
- One nextStage moves the WHOLE lobby (the engine has one shared layout).
- Skip allowed: nextStage works any time, also mid-stage.
- Finished cars keep driving freely until nextStage.
- The client sends the flag: `req:control/nextStage { completed: boolean }`
  (false = skipped). Only the app gets it (no event to the AIs).
- Session ends only if ALL stages were completed. Checked on every nextStage.

## Flow
1. AI → server: `req:control/nextStage { completed }`
2. Server → host: `evt:game/nextStage { clientId, completed }`
3. Host:
   - stores `completed` for the current stage (Session: one flag per stage)
   - all stages flagged completed → session over (engine `sessionCompleted`
     → MP host sends `req:game/completed` → `evt:game/completed`, as today)
   - else, not the last stage → advance every player (AiView: its one
     player), reset cars at the new start line, MP host re-fits the camera
   - else (last stage, something skipped) → nothing changes
4. AIs notice the change in their next GameState (track.name / layout)

## Code
- [x] 1. Types: `ReqControlNextStage` data `{ completed }`, `EvtGameNextStage`
      data `{ completed }` (server/src/types)
- [x] 2. Server `handleNextStage`: pass `completed` to the host (bare
      nextStage without a boolean → ignored + logged)
- [x] 3. Session: per-stage `completed` flags + `isCompleted` = all flagged
- [x] 4. GameEngine: remove parking (`pausedPlayers`, `pausePlayer`,
      `resumePlayer`, `isPlayerPaused`, `parkedSlot`); new
      `nextStage(completed)` for all players; session completion from the
      flags; stop checkpoint checks once a player's stage is completed
      (otherwise a loop car driving on counts completedLaps past laps and
      fires stageCompleted again)
- [x] 5. Renderer + RenderSnapshot: drop `parkedSlot` label/branch
- [x] 6. AiView: `evt:game/nextStage` → `engine.nextStage(completed)`
- [x] 7. MultiplayerHostView: remove stageCompleted→pause and
      `maybeAdvanceAllStages`; subscribe to `evt:game/nextStage`; re-fit camera
- [x] 8. GameState `session.completed` = all stages flagged completed
      (see open question B)
- [x] 9. tsc (app + server)
- [ ] 10. Test: Robin tests with his own AI client.
- [x] 10b. Restart (Player.resetLap) restarts the whole stage: completedLaps,
      lapTimes, checkpoints → 0, so stage.completed resets; stageTime kept
      (Robin). Replaces the short-lived "keep the final lap time" fix.
- [x] 11. Docs: README, .personal/CLAUDE.md, .personal/websocket.md,
      ../.personal/websocket-ai-client.md (remove parking section, new flow)

## Answers (Robin)
- A. No event to the AIs (Robin: "nextStage event to AIs is not needed").
  Only AI → server → app. AIs see the new stage in GameState
  (`track.name` / `track.layout` change).
- B. GameState `session.completed` = the stage flags: a session is completed
  when all stages are.
- C. Single-player keyboard mode keeps auto-advancing on finish (unchanged).
- D. Completed stage → car removed from the track (Robin, replaces "finished
  cars keep driving"): not drawn (buildSnapshot skips it), frozen at speed
  0, no controls/physics/rays/checkpoints (tickPlayer). Restart or nextStage
  respawns it. Same on the final stage. [x] done
