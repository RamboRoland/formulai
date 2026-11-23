# Body tilt (pitch + roll) — 2026-11-22

The 3D kart body leans with the forces on it: nose up under gas, nose down
under braking, rolls to the outside in a turn. Display only — the physics
(weight transfer, inner rear lift) already exists; this just shows it.

## Idea

The physics already has the two numbers, from the real tyre forces:
- `car.longitudinalG` — actual acceleration along the nose in g (lagged
  0.08 s, the same one weight transfer uses)
- `car.lateralG` — tyre side force ÷ weight, + = right. It IS v² / r at the
  grip the tyres have → speed and turning radius are already in it (faster
  or tighter = more roll; sliding = the tyres' real force, not the ideal)

Tilt = constant × g (a kart frame is stiff: a few degrees at most):
- pitch = `PITCH_DEG_PER_G` (2°) × longitudinalG → braking dives the nose
- roll = `ROLL_DEG_PER_G` (3°) × lateralG → leans to the outside
- each clamped to ±`MAX_TILT_DEG` (5°)

## Steps

- [x] Server: `RenderCar` + server `CarRenderState` get `lateralG`,
      `longitudinalG` (g); `GameEngine.renderCars` fills them (2 decimals)
- [x] App: same fields in `app/src/protocol/view.ts` + `RenderSnapshot.ts`
      (protocol copies identical); `ServerRacingView` blends them like
      wheelAngle
- [x] App `Scene3D`: per car, the model's `body` node moved into a `tilt`
      group whose origin is the body's centre at its underside (the body
      node's own origin is a corner); tilt.rotation.x = pitch,
      rotation.z = roll. Wheels stay on the ground.
- [x] Type-check both, look at it in Player mode (chase camera): brake,
      gas, a corner; check the signs
- [x] CLAUDE.md: a line under Rendering

Not doing: a spring / bounce on the body (the lag in longitudinalG + the
frame blend already smooth it) — add if it looks stiff.

## Review

Done 2026-11-22. Type-check clean (server + app). Checked in Player mode
(chase camera) with the values ×10: a right turn leans the body left (the
outside); the pitch sign is checked on paper (Rx(θ) takes +Z, the nose, down
for θ > 0 → braking dips it). Real values back to 2 / 3 / 5°. Also added a
`server` entry to `.claude/launch.json` (and `dev` now runs in app/).
Not tuned by eye at 1× yet.


2026-11-22, feedback: too much, roll more so than pitch → pitch 1.2°/g (was
2), roll 0.8°/g (was 3), cap 2.5° (was 5).

Then in between the two → pitch 1.6°/g, roll 1.9°/g, cap 3.5°.
Then roll up again → roll 2.5°/g, cap 4° (the Racingkart reaches 1.6 g).
Then roll a bit more → roll 3°/g, cap 5°.
Then pitch doubled → 3.2°/g.
