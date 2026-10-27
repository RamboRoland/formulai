# GameState `track.lapDistance`

How much of the current lap is left. 1 means the whole lap is left, 0 means the lap is completed.

## Decisions (Robin, 2026-10-26)
- The value is 1 until the start line is crossed. After that it only goes down, because it's built on completedMeters, which only goes up.
- Loop with more laps left: on the tick the line is crossed, the value jumps straight back to 1.
- Stage completed: the value is 0 and is held until restart or nextStage, which set it back to 1.
- It's added to both Multiplayer and AiView, which share the same GameState type.

## Formula
- If the stage is completed, return 0.
- If there's no route, return 1.
- Otherwise:
  - lapM = completedMeters − lapsCompleted × routeLength (m)
  - return 1 − clamp(lapM / routeLength, 0, 1)
- The completed case needs its own check. Once completed, completedMeters equals laps × length, which would make the formula give 1 again.

No new state is stored. The value is derived from the stage values, so a completed car keeps it automatically.

## Steps
- [x] 1. `app/Player.ts`: add the method `lapDistance(track)`, using the formula above.
- [x] 2. `server/src/types/game.ts`: add `lapDistance: number` with a comment.
- [x] 3. `MultiplayerHostView` and `AiView`: add `lapDistance` to the GameState, rounded to 4 decimals.
- [x] 4. Test on scratchpad copies (2026-10-26, all OK; finding: ~1.98 m jump at every OTHER checkpoint — old behaviour, fixed in 4b):
  - starts at 1;
  - only goes down;
  - jumps to 1 on a new lap;
  - 0 when completed;
  - 1 after restart.
- [x] 5. Docs: README, websocket-ai-client.md and `.personal/CLAUDE.md`.
- [ ] 6. Robin tests.
