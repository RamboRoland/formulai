# Slip angle per axle in GameState (2026-11-10)

From `.claude/tasks/kartkraft-notes.md` idea 3 (KartKraft sends a slip angle
per wheel; we send one per axle — what our physics computes).

## Goal

Agents get the front and rear tyres' own slip angles, the ones `Car.slide`
turns into tyre force — front sliding = understeer, rear sliding =
oversteer. No physics change: same numbers, now kept and sent.

## Now

`Car.slide` computes each substep (Car.ts ~320–328):
- front: `across / along` = the front axle's velocity in the WHEEL's frame
  (steering included) → `-atan(across / floor(along))`
- rear: `rearAcross / vx` = the rear axle's velocity vs the nose →
  `-atan(rearAcross / floor(vx))` (a locked rear slides by the same
  geometry, Coulomb force)

and throws them away. GameState has only `slipAngle` = the body's
(atan(lateralSpeed / v) ÷ 90°).

## Steps

- [x] 1. `Car.ts`: `public slipFront = 0`, `public slipRear = 0` (radians,
      + = the axle moves to the right of where its tyres point — same sign
      as `slipAngle`); set from the LAST substep in `slide` (like
      gripFront / gripRear); `stopSliding()` → 0 (reverse / blocked).
- [x] 2. Both protocol copies (`server/src/protocol/state.ts`,
      `app/src/protocol/state.ts`, identical): `slipAngleFront`,
      `slipAngleRear` after `slipAngle`, with comments.
- [x] 3. `formulai/gameState.ts`: `norm(slip / (π / 2))` — ÷ 90° like
      `slipAngle` (decision below).
- [x] 4. Docs: `docs/agent-protocol.md` (GameState block + the tyre
      section), README (line ~377), `.personal/CLAUDE.md` (GameState).
- [x] 5. Proof: type-check both projects; a headless run (scratchpad
      script, real GameEngine) — straight line → both ~0; steady corner
      → rear ≈ body slip near the CoG, front > rear when understeering;
      full lock at 40 km/h → front large, gripFront ~0.9; reverse → 0.
      Old vs new GameState identical except the two new fields.

## Decided

- Normalisation: ÷ 90° (Robin; same as slipAngle; peak ≈ 0.09 rental,
  0.07 Racingkart). Not ÷ peakSlipDeg (would leave -1..1).

## Review (2026-11-10)

Proof ran on `Car` + `buildGameState` with a stub track / Player (not the
full GameEngine), old code from a detached worktree of HEAD: a 17 s
scripted drive (straight, 30 % corner, full lock, brake in a corner,
weave, stop, reverse) — physics fields identical on all 3060 ticks;
GameState identical apart from the two new fields on all 2160 states,
never outside -1..1 (max front 0.67, rear 0.93 while braking in a
corner). Centralen 30 % corner: front −0.027, rear −0.008, body +0.029
(CoG inside the nose at low speed — documented for agents).
- `slipAngle` (body) stays as is (KeyboardControls uses it).
