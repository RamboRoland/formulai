# car.heading + car.facing — direction vs. the track

Robin (2026-10-25): a directional value per car — is it pointing / moving
the correct way?

## Decisions (Robin)
- Two values (c = cos(car.angle − trackAngle)):
  - `car.facing`  = boolean: the nose points the correct way, c > 0 (within
    ±90° of the track direction). Independent of speed.
  - `car.heading` = -1 | 0 | 1 (Robin: never in between), direction of TRAVEL: sign(c) ×
    sign(speed) (reversing moves opposite to the nose). Direction only, not
    scaled by speed. Standing still → 0; blocked by a collision (didn't
    move this tick) → 0.
- Before the start line: measured against the start direction (the car
  stands still at spawn → heading 0, facing ≈ 1).
- Stage completed: both keep their last values.
- Separate change (own task, below): completed cars keep ALL last values —
  today only speed is zeroed (GameEngine.ts:203).

## Track direction at the car
- The route (Track.route, same as completedMeters): leg = currentCheckpoint
  − 1, leg 0 before the start line.
- Nearest point on that leg to the car centre, searched ±10 m around the
  last nearest point (own per-player state, NOT completedMeters' high-water
  mark — the car may reverse); new leg → from the leg start. Before the start
  line the projection clamps to leg 0's first point → start direction.
- trackAngle = direction from that point to the point ~1 m further along the
  leg (smooths the 6 px samples); at the leg end, the last 1 m.
- No route (track without one) → both 0.

## Verified (copies, real engine): after the finish only `speed` changes
(→ 0, GameEngine.ts:203); x/y, corners, angle, hasCollision, rays, lap
times, laps, meters, checkpoint all hold (Training 1, GP Layout, Training 9).

## Code
- [x] 1. PlayerStage: nearLeg / nearSample (reset with resetLap / resetStage).
- [x] 2. Car: heading / facing fields (0 on reset).
- [x] 3. GameEngine.updateDirection(player) in tickPlayer (after rays /
      checkpoints): nearest point, trackAngle, facing, heading.
- [x] 4. GameState car.heading / car.facing (AiView + MultiplayerHostView),
      server type.
- [x] 5. tsc + scratchpad check on copies (drive forward / reverse / turned
      round / still / blocked; hairpin; before start line).
- [x] 6. Docs (README, .personal/CLAUDE.md, websocket-ai-client.md).
- [ ] 7. Test (Robin).

## Separate task: completed cars keep their last values
- [x] A. GameEngine.tickPlayer: drop `player.car.speed = 0` for completed
      cars (physics is skipped anyway; car.reset zeroes speed on respawn).
- [x] B. Docs: "speed = 0" → last value (websocket-ai-client.md "After the
      stage is completed", .personal/CLAUDE.md stage flow).
