# completedMeters (per car, per stage)

Robin (2026-10-20): a new value per car, `completedMeters`, measured along the
centreline, updating as the car moves. Must be unexploitable.

## Decisions (Robin)
- Per stage (a loop counts all laps of the stage).
- Restart → 0 (like the rest of the stage).
- Measured from the CENTRE of the car.
- Only `completedMeters`, no totalMeters.
- GameState: `track.completedMeters`.
- Stops counting once the stage is completed (set to the full distance on
  completion; tickPlayer already returns early for a completed stage).

## How it works
- Track builds the driving line once at load with `buildRoute`
  (`app/tracks/vector/route.ts`, today only used by the editor): one leg per
  checkpoint gap, centreline points every 0.25 m + exact length.
- Leg k = checkpoint k → k+1 (loop: the last leg goes back to the start).
- `currentCheckpoint` = c says which leg the car is on:
  - c = 0 → behind the start line → 0 m
  - c = k ≥ 1 → on leg k-1
- Every tick:
  `meters = lapsCompleted × routeLength + legs before (k-1) + progress on leg k-1`
  progress = the car centre projected onto leg k-1 only, clamped to
  [0, leg length].
- Stage completed → exactly the full distance (one-way: route length; loop:
  laps × route length).

## Anti-exploit rules
1. Checkpoint gate: only the current leg counts, clamped at its end until the
   next checkpoint line is really crossed.
2. High-water mark: the value never goes down (reverse / back and forth adds
   nothing twice).
3. Centreline, not odometer: weaving or a wide line gives no extra metres.
4. Local search: the car is matched only to points a few metres around its
   best point on the leg (no jump to a parallel bit of track at a hairpin);
   ignored if the match is further from the centreline than the track is wide.
5. Computed by the game; the AI only sends controls.

## Code
- [x] 1. Track: build the route at load over the SAME checkpoint list as
      `Track.checkpoints` (so leg i ↔ checkpoint i). Route error → log + no
      metres (0) for that layout. Checked on copies: every layout builds
      (loop: legs = cps, one-way: legs = cps - 1).
- [x] 2. PlayerStage: `completedMeters` (metres) + `routeLeg` / `routeSample`
      (best sample on the leg); `resetMeters()` in `resetLap` and `resetStage`.
      The engine starts the sample over when the leg changes.
- [x] 3. GameEngine.tickPlayer: after checkCheckpointPass, update the value
      (`updateCompletedMeters`, 10 m forward window, segment projection).
      Track got `routeArcs` / `routeLegStarts`. No "too far from the
      centreline" limit (collision keeps cars on track; Robin ok'd).
      Checked on copies: drive = exact route length, gate clamps at the leg
      end, reverse/weave add nothing, teleport limited to 10 m/tick, GP 2 laps
      = 2 × route. Note: ~1 m pause at each line (front crosses, centre counts).
- [x] 4. GameState: add `completedMeters` (metres, 2 decimals) in AiView +
      MultiplayerHostView; type in server/src/types/game.ts (the one the views
      use). app/types.ts GameState is unused and already stale → left alone.
- [x] 5. tsc: app clean; server: no errors in server/src (the known ../app
      alias/JSX errors only).
- [ ] 6. Test (Robin). Me: check numbers on a copy (no writes to assets).
- [x] 7. Docs: README (GameState + checkpoint counts), .personal/CLAUDE.md
      (checkpoint section, restart line, GameState), ../.personal/
      websocket-ai-client.md (restart, GameState, completedMeters section,
      layouts table counts, nextStage step 3).

## Checked
- No layout has checkpoints after a one-way finish (finish = last), so
  Track.checkpoints and the route line up.
- README checkpoint counts are stale (Training 6–9 now 5/7/9/9) → fix in docs.
