# Steering wheel in the control panel (RacingView)

## Decisions (Robin, 2026-10-26)
- The ← → indicator buttons are replaced by a drawn steering wheel that is display only. Keyboard A/D still steer.
- The wheel rotates by the tracked car's `car.steeringAngle`, in real degrees. Full lock is a full turn (360°) on Centralen/Training and 120° on the 125cc.
- One number is shown: the steering-wheel angle in degrees, for example `-180°`.
- Layout: ↑ and ↓ stacked in a column, the wheel under them, then Brake / Reset.
- Applies to every racing view (single player, AiView, multiplayer host), which all show the tracked car.

## Steps
- [x] 1. `buildControlPanel`:
  - ↑ and ↓ in a column, without ← and →;
  - a new `makeSteeringWheel()`: an inline SVG about 90 px wide, made of the rim, 3 spokes, the hub and a marker at the top so a full turn can be seen;
  - a label `0°` under the wheel;
  - Brake and Reset as before.
- [x] 2. `updatePressedIndicators`, which runs on every `stats` event:
  - left/right removed from the pressed map;
  - the wheel is rotated with `transform: rotate(${car.steeringAngle}deg)`, where + is clockwise, the same as right;
  - the label shows `${Math.round(steeringAngle)}°`.
- [ ] 3. Check it type-checks. Robin looks in the browser: single player A/D gives ±360°, and an AI sending 0.5 gives 180°.
