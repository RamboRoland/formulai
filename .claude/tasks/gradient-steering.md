# Gradient steering for agents (`controls.steering`, −1..1) + wheel-angle physics

## Decisions (Robin, 2026-10-26)
- `steering` −1..1 is the steering wheel, relative to each car: 1 = full lock (right).
- New values per car, per side:

  | car | steeringLock (steering wheel) | wheelLock (front wheels) | wheelbase |
  |---|---|---|---|
  | Gokart125cc | 120° | 35° | 1.05 m |
  | GokartGokartCentralen | 360° | 90° | 1.12 m |
  | GokartTraining | 360° | 90° | 1.12 m (same as Centralen) |

- The front-wheel angle is `δ = steering × wheelLock`.
- Turning is a kinematic bicycle model capped by the existing rotationSpeed:
  `ω = sign(δ) × sign(speed) × min(|v| / wheelbase × tan|δ|, rotationSpeed)`
  - v is in m/s, and ω is in °/s once converted;
  - at speed 0 the car doesn't turn, as today.
- Reversing turns like a real car: the direction flips with the sign of speed.
- `steering` replaces `left`/`right` for the AI. Booleans the AI sends are ignored.
- Steering is applied instantly, on the next tick.
- GameState gets `car.steering` (−1..1, 4 decimals) and `car.wheelAngle` (°, + = right). `maxSteering` is dropped.
- The keyboard stays A/D, which maps to steering −1, 0 or +1.

## What this does to the keyboard
- **Centralen and Training, going forward:** tan(90°) is huge, so ω always hits the cap. The turn is identical to today.
- **125cc:** ω is below the cap when speed < 5.236 × 1.05 / tan35° ≈ 7.85 m/s ≈ 28 km/h. Below that it turns slower than today; above that it turns the same.
- **All cars, reversing:** the turn direction is mirrored compared with today.

## Steps
- [x] 1. Types: `steering` replaces left/right in app Controls, app ControlsState and the wire Controls. GameState: steering and maxSteering, to be fixed in 1b.
- [x] 1b. GameState: change `maxSteering` to `wheelAngle` (°, + = right).
- [x] 2. `KeyboardControls`:
  - keeps its private A/D key flags;
  - `getControls()` returns `steering = (D ? 1 : 0) − (A ? 1 : 0)`.
- [x] 3. `WebSocketControls` and `createControls`:
  - normalise the incoming controls: `steering` is clamped to −1..1, and anything that isn't a finite number becomes 0;
  - `left`/`right` from the AI are dropped;
  - the default controls get `steering: 0`.
- [x] 4. `Car` (changed per Robin: the class works in DEGREES — `steeringAngle` = controls.steering × steeringLock, `wheelAngle` = steeringAngle × wheelLock / steeringLock; −1..1 only at the AI boundary, i.e. controls in and GameState out):
  - add abstract `steeringLock`, `wheelLock` and `wheelbaseMeters`;
  - add public state `steering` (−1..1) and `wheelAngle` (°);
  - make `steer(dt)` concrete in Car using the formula above, and remove the three identical `steer` overrides in the gokarts;
  - `applyControls` sets `steering` and `wheelAngle` every tick, also at speed 0. The wheel can be turned while standing still, but the car doesn't rotate;
  - remove `steerLeft`/`steerRight`;
  - `reset()` sets steering and wheelAngle to 0;
  - completed cars hold their values.
- [x] 4b. The gokarts: add `steeringLock`, `wheelLock` and `wheelbaseMeters` with the values from the table.
- [x] 5. GameState in `MultiplayerHostView` and `AiView`: `steering` (4 decimals) and `wheelAngle` (2 decimals).
- [x] 5b. `RacingView`:
  - DEFAULT_CONTROLS gets `steering: 0`;
  - the A/D indicators light up when `steering < 0` / `> 0`. They're display only.
- [x] 6. Test on scratchpad copies (2026-10-26, all OK; scratchpad steering-check.ts):
  - Centralen keyboard going forward gives the same angle trace as the old code;
  - 125cc follows the formula (slower below ~28 km/h, the same above);
  - reversing is mirrored;
  - 0.5 halves δ;
  - clamping: 2 → 1, −3 → −1, NaN/missing/string → 0;
  - nothing turns at speed 0;
  - `left`/`right` from the AI are ignored;
  - wheelAngle is correct.
- [x] 7. Docs:
  - websocket-ai-client.md: the controls table, the GameState, the steering model with the per-car table, and a breaking-change note;
  - README;
  - `.personal/CLAUDE.md` (Car Physics).
- [ ] 8. Robin tests. His AI client must send `steering` instead of `left`/`right`.
