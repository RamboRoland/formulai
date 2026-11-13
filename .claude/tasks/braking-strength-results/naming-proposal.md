# Naming pass — proposal (2026-11-13, for Robin to approve)

Rule (Robin): spell out names; only standard math / physics symbols stay
short — those go in a symbol chart, server/src/game/cars/physics/SYMBOLS.md.
Proposal by a read-only agent; the three "misleading" ones checked by me in
the code (Car.ts:279, :283, :284). Proof when applied: physics-trace
byte-identical to the "before" recording.

## Misleading today (fix first)

| Where | Now | Proposed | Why |
|---|---|---|---|
| Car.slide | `inner` (also loads.innerRearLift, rearAxle.spoolForce) | `rearWheelLoad` | holds EACH rear wheel's load (loadRear / 2), not the inner one's |
| Car.slide | `fy` | `vyFront` | the front axle's sideways SPEED (vy + a·r) — Fy means force |
| Car.slide | `d` in `steered.map(d => …)` | `wheelAngle` | reuses `d`, which is the drive values elsewhere |

## Car.ts

| Now | Proposed | Why |
|---|---|---|
| `s` (longitudinal, slide) | `slip` | the SlipValues (slide's inner `slip` → `alpha`) |
| `d` (longitudinal, slide) | `drive` | the DriveValues |
| `push` | `driveForce` | N from the pedals |
| `rearMax` | `rearBrakeMax` | the most the rear tyres can stop |
| `resist` | `resistance` | rolling + air (+ braking) |
| `rw` | `wheelRadius` | |
| `ls` | `loadSensitivity` | |
| `steered` | `frontWheelAngles` | Ackermann angles (rad) |
| `tyre` | `frontTyreForce` | the Magic Formula closure |
| `slip` (in map) | `alpha` | slip angle |
| `wheels` (in slide) | `frontWheels` | front tyre forces + slips |
| `front` (slide) | `frontForce` | magnitude |
| `wheel` | `rearWheelForces` | the TMeasy result |
| `rear` | `rearSide` | rear sideways force; pairs with `frontSide` |
| `along` | `longitudinalAccel` | m/s² |
| `wheelV` | `wheelSpeed` | ω·r, m/s |
| `drive` (in loop) | `driveForce` | clashes with `drive` above |
| `stop` | `brakingForce` | brake + lift-off, N |
| `moved` | `innerLoadMoved` | share of the inner wheel's load moved across |
| `spool` | `spoolWheelForce` | N per wheel, not a moment |
| `c` (applyControls) | `controls` | |
| `l`, `w` (bboxPolygon) | `halfLength`, `halfWidth` | |
| `m` (wheels() map) | `meters` | `m` = mass everywhere else |
| `v` (scrub map) | `value` | `v` = speed |
| `slip` (scrubbing param) | `slipAngle` | |
| `s` (reset) | `spawn` | |
| `spinLive` (private) | `wheelSpinStarted` | true once the spin is set to rolling |

## physics/chassis.ts

| Now | Proposed |
|---|---|
| `push`, `resist` (alongNose) | `driveForce`, `resistance` |
| `w`, `w.d` (frontForces) | `wheel`, `wheel.angle` |
| `rear`, `along` (integrate) | `rearSide`, `longitudinalAccel` |
| type `Kinematic` | `KinematicCar` |
| `tan` (steer) | `tanWheelAngle` |
| `rate`, `turn` | `turnRateDeg`, `turnDeg` |
| `d` (steer) | `halfWheelbasePx` |

## physics/drivetrain.ts

| Now | Proposed |
|---|---|
| `d` (fullPull, axleDrive, liftOffForce) | `drive` |
| `pull` (drivePush) | `fullGasForce` |
| `wheelV` | `wheelSpeed` |
| `drive` (axleDrive local) | `driveForce` |
| `rpmA / nmA / rpmB / nmB` (torqueAt) | `lowerRpm / lowerTorque / upperRpm / upperTorque` (optional) |

## physics/loads.ts

| Now | Proposed |
|---|---|
| `shift` | `loadShift` |
| `s` (innerRearLift) | `slip` |
| `inner` | `rearWheelLoad` |
| `roll`, `jack` | `rollLoadTransfer`, `jackingLoad` (both N) |

## physics/rearAxle.ts

`r` means wheel radius here but yaw rate everywhere else → `wheelRadius`.

| Now | Proposed |
|---|---|
| `w` (slipRatio, spinStep) | `omega` (ω, math standard) |
| `r` (slipRatio, spinStep, lockingBrake) | `wheelRadius` |
| `K` | `longitudinalStiffness` (dFx/dκ) |
| `kv` | `stiffnessPerSpeed` (K / \|vx\|) |
| `iEff` | `effectiveInertia` |
| `wFree` | `omegaUnbraked` |
| `stop` (spinStep) | `brakeOmegaStep` |
| `s`, `d` (lockingBrake) | `slip`, `drive` |
| `other` | `resistance` |
| `a` (lockingBrake) | `deceleration` (`a` is an axle distance elsewhere) |
| `peak` | `rearPeak` |
| `Fw` | `Fz` (wheel load: the standard symbol) |
| `torque` | `brakeTorque` |
| `inner` (spoolForce) | `rearWheelLoad` |
| `wheel` (spoolForce) | `wheelForce` |
| `moved` | `innerLoadMoved` |

## physics/steering.ts

| Now | Proposed |
|---|---|
| `wanted`, `step` | `target`, `maxStep` |
| `d` (frontWheels map) | `wheelAngle` |

## physics/tyre.ts

| Now | Proposed |
|---|---|
| `mfShape` | `magicFormulaShapeC` |
| `shape`, `stiff` (magicFormula) | `C`, `B` (Pacejka's own symbols → chart) |
| `max` (closure) | `peakForce` |
| `FL` | `FASTEST_LAP_REAR` |
| `mfCurve` | `pacejkaCurve` |
| `flBx`, `flBy` | `fastestLapShapeBx`, `fastestLapShapeBy` |
| `flFx`, `flFy` | `fastestLapFx0`, `fastestLapFy0` |
| `f` (flBy) | `clampedFz` |
| `k` (flFx) | `kappa` |
| `sinA` | `sinAlpha` |
| `TABLE_N`, `TABLE_STEP` | `TABLE_SIZE`, `TABLE_STEP_N` |
| `peakOf` | `peakInput` |
| `lo`, `hi`, `m1`, `m2` | `low`, `high`, `lowerThird`, `upperThird` |
| `T_KPK` | `PEAK_KAPPA_BY_LOAD` |
| `T_TANPK` | `PEAK_TAN_ALPHA_BY_LOAD` |
| `T_FXS` | `LOCKED_FX_BY_LOAD` |
| `s` (table loop) | `peakSinAlpha` |
| `lookup(t, …)`, `x`, `f` | `table`, `position`, `fraction` |
| `out` | `forces` |
| `tanA` | `tanAlpha` |
| `sideSlide` | `slideGrip` |
| `rx`, `ry` | `peakSlopeRatioX`, `peakSlopeRatioY` |
| `c`, `sn` | `cosPhi`, `sinPhi` |
| `sg` | `sigma` (+ comment) |
| `shx`, `shy`, `sxn`, `syn` | unsure if TMeasy's own names (check carpy) → keep + comment, or `normaliseX/Y`, `sxNormalised/syNormalised` |

constants.ts, resistance.ts: no changes.

## Public names — proposal: KEEP (renaming touches other files)

lateralG, longitudinalG, gripFront, gripRear, slipFront, slipRear (GameState);
rearLocked, rearLift, loadShareFront / Rear, slipRatio, brakeLock(),
wheels(), scrub(); SlipValues / DriveValues / car.slip / car.drive;
rearBrakeLimit (laptimes.ts). Optional (1 file each, read as strings in
physicsTrace.ts — a rename there breaks silently): wheelSpin →
rearAxleSpin, private longAccel → longitudinalAccel. lengthM / widthM
(engine-wide) left out of this pass.

## Kept (math / physics standard) → the symbol chart

m, G, v, vx, vy, dvx, r (yaw rate), a / b / L, delta (δ), kappa (κ), alpha
(α), omega (ω), Fx, Fy, Fz, dt, i, x / y; Body + fields; MF 5.2's dfz,
pCx1 … pKy4, Fz0, B / C / E, Dy; TMeasy's dFx0, FxM, sxM, FxS, sxS (+ y),
dF0, FM, sM, FS, sS, s, F. Meaning, unit, sign and files for each: the
agent's chart (to be written as SYMBOLS.md).
