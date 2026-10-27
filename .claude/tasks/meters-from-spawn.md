# completedMeters from the spawn point

## Decisions (Robin, 2026-10-26)
- completedMeters counts from the spawn point, so the stretch from the spawn to the start line counts too.
- lapDistance only counts from the start line, so it stays 1 until the car passes the line.

## Today
- The car's centre spawns `leadIn = SPAWN_GAP_PX (1 m) + lengthPx / 2` behind the start line, straight back along `startAngle` (`Track.spawn`).
- Nothing is counted before `currentCheckpoint` turns 1, and on leg 0 the value stays 0 while the centre is still behind the line. In total about 1.9 m isn't counted.

## Plan
- Add `Track.leadIn(carLengthPx)` = SPAWN_GAP_PX + carLengthPx / 2 (px). It's the same number spawn() uses, so it can't drift from it.
- Lead-in, the stretch behind the start line:
  - `s = (centre − startPosition) · startDir`, where s < 0 means behind the line;
  - lead-in metres = `clamp(leadIn + s, 0, leadIn)`;
  - this is used before the start line is crossed, and just after it while the centre is still behind the line.
- On the route, the value becomes `leadIn + lapsCompleted × lap + legStart + arc`. This is the current formula plus `leadIn`.
- The value still only goes up. The leg search (`routeSample`) is unchanged.
- When the stage is completed, the value is `leadIn + route` (one-way) or `leadIn + laps × lap` (loop).
- `lapDistance`: `done = (completedMeters − leadIn − lapsCompleted × lap) / lap`, clamped as before. Before the start line this is negative, so lapDistance stays 1.
- The lead-in is counted once only, on lap 1 of the stage. Restart and a new stage put it back to 0.

Note: the lead-in depends on the car's length, so cars of different lengths get a slightly different full distance. Today every session uses the same car.

## Steps
- [x] 1. `Track.leadIn()`, used by spawn() too.
- [x] 2. `GameEngine.updateCompletedMeters`: count the lead-in and add it on the route and when completed.
- [x] 3. `Player.lapDistance`: subtract the lead-in.
- [x] 4. Test on scratchpad copies (2026-10-26, all OK; finding: ~1.98 m jump at every OTHER checkpoint — old behaviour, fixed in 4b):
  - the value goes up from 0 at the spawn;
  - it's continuous across the start line, with no step and no dead zone;
  - the full distance is leadIn + route;
  - lapDistance stays 1 until the line is crossed;
  - the earlier lapDistance checks still pass.
- [x] 4b. No jump/pause at the other checkpoints: the line counts the car's FRONT (isPointBetween tolerance 5 px ≈ 0.9 m mid-road), so the centre is ~1.7–1.9 m before it when the leg switches. While `routeSample === 0`, also search the previous leg's last 5 m (`METERS_LOOKBACK_PX`; a loop's lap → last leg, lapsCompleted − 1). Helper `nearestOnLeg`. Re-test: biggest step 0.25 m (= point spacing), meters = distance driven (diff 0.000) on all 6 layouts.
- [x] 5. Docs: types comment, websocket-ai-client.md, README and `.personal/CLAUDE.md`.
- [ ] 6. Robin tests.
