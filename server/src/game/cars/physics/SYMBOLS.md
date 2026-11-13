# Physics symbols

The kart physics (`Car.ts` and `physics/`) spells names out. The only
short names left are standard math / physics symbols. This page says what
each one means.

Conventions:
- Signs: + = right (toward the car's right side), + = forward along the
  nose, + yaw = turning right (clockwise on screen).
- Angles are in radians inside the physics. The Car's fields `angle`,
  `wheelAngle` and `steeringAngle` are in degrees.
- Speeds are in m/s inside the physics. `Car.speed` and `maxSpeed` are in
  km/h (÷ 3.6 → m/s).
- Positions (`x`, `y`) are in pixels: 24 px per metre.
- Forces are in N (newton), loads too (the weight pressing a tyre down).

File keys: Car = `Car.ts`. The others are `physics/<name>.ts`.

## Car body and motion (the bicycle model: one front axle, one rear axle)

| symbol | meaning | unit | sign | files |
|---|---|---|---|---|
| `m`, `massKg` | mass of kart + driver | kg | – | Car, chassis, drivetrain, loads, rearAxle, resistance |
| `G` | gravity, 9.81 | m/s² | – | constants (defined); Car, chassis, drivetrain, loads, rearAxle, resistance |
| `v` | speed, size only | m/s | always ≥ 0 | Car, chassis, drivetrain, rearAxle, resistance |
| `vx` | speed along the nose | m/s | + = forward | Car, chassis, rearAxle, tyre |
| `vy` | sideways speed | m/s | + = right | Car, chassis, tyre |
| `vyFront` | the front axle's sideways speed (vy + a·r) | m/s | + = right | Car |
| `dvx` | change in vx during this substep | m/s | + = speeding up | rearAxle |
| `r` | yaw rate: how fast the kart turns | rad/s | + = turning right | Car, chassis (Body), rearAxle (spoolForce) |
| `angle` (Body) | heading of the kart | rad (`Car.angle`: degrees, 0..360) | clockwise on screen | Car, chassis |
| `a` | distance from the centre of gravity (CoG) to the front axle | m | – | Car, chassis, loads |
| `b` | distance from the CoG to the rear axle | m | – | Car, chassis, loads |
| `L` | wheelbase, front to rear axle (= a + b) | m | – | Car, chassis, loads, steering |
| `delta` (δ) | front wheel steer angle (the mean of the two wheels) | rad | + = steered right | Car, chassis, loads, steering |
| `dt` | time step: one substep (tick ÷ 8) in the slide, otherwise one tick (1/60 s) | s | – | Car, chassis, loads, rearAxle, steering |
| `i` | loop counter | – | – | Car, drivetrain, rearAxle, tyre |
| `x`, `y` | car position on the track: top-left of its box, NOT the centre | px | y + = down the screen | Car, chassis |

## Tyre slip and forces

| symbol | meaning | unit | sign | files |
|---|---|---|---|---|
| `alpha` (α) | slip angle: angle between where a tyre points and where it actually travels | rad | + = the axle moves right of where its tyres point | Car, tyre; Car fields slipFront / slipRear |
| `tanAlpha`, `sinAlpha` | tan α, sin α (the rear tyre models use these instead of α) | – | as α | tyre |
| `kappa` (κ) | slip ratio = (ω·wheelRadius − vx) / \|vx\|: how much faster or slower the wheel turns than the ground passes under it | – | − = braking, −1 = locked (≤ −0.5 counts as locked), + = wheelspin | Car (field slipRatio), rearAxle, tyre |
| `omega` (ω) | the rear axle's spin (both wheels turn together: a spool) | rad/s | ≥ 0 (forward only) | rearAxle; Car field wheelSpin |
| `Fx` | tyre force along the nose (drive or brake) | N | + = pushes forward, − = braking | Car, rearAxle, tyre |
| `Fy` | tyre force sideways | N | + = right | tyre (FyM / FyS); in Car: `frontSide` / `rearSide` |
| `Fz` | vertical load on one wheel (the weight pressing it down) | N | – | tyre, rearAxle (lockingBrake) |
| `Fz0` | the tyre data's reference load, 896 N | N | – | tyre |
| `dfz` | relative load change, (Fz − Fz0) / Fz0 | – | + = more load than the reference | tyre |
| μ (mu) | friction coefficient: grip ÷ load. In the code it is `gripG` (grip in g ≡ μ) | – | – | comments in rearAxle |
| `AXLE_INERTIA` (I in comments) | the rear axle's resistance to spinning up / down, 0.2 | kg·m² | – | rearAxle |
| K (comments) | `longitudinalStiffness`, dFx/dκ: how fast Fx grows with slip | N per unit slip | – | rearAxle comments |

## Pacejka "Magic Formula" (front tyres; also the shape of the rear tyre's curves)

The Magic Formula: force = D × sin(C × atan(B × slip − E × (B × slip − atan(B × slip)))).

| symbol | meaning | unit | sign | files |
|---|---|---|---|---|
| `B` | stiffness factor: how steeply the force rises with slip (sets where the peak sits) | 1 / slip (1/rad for α) | – | tyre |
| `C` | shape factor: how much grip is left past the peak | – | – | tyre |
| `E` | curvature factor: sharpens or rounds the peak | – | – | tyre |
| `bx` | B × x, a helper product | – | – | tyre (pacejkaCurve) |
| `x` | the curve's input (κ or sin α) | – | – | tyre (pacejkaCurve) |
| `Dy` (D) | peak force (gripG × load, with load sensitivity) | N | – | tyre |
| `pCx1`, `pCy1` | shape factor C, along / sideways | – | – | tyre (FASTEST_LAP_REAR) |
| `pDx1`, `pDy1` | peak friction μ, along / sideways (only the curve shape is used) | – | – | tyre |
| `pEx1`, `pEy1` | curvature E, along / sideways | – | – | tyre |
| `pKx1`, `pKx2`, `pKx3` | longitudinal slip stiffness ÷ load, and how it changes with load | – | – | tyre |
| `pKy1`, `pKy2`, `pKy4` | cornering stiffness, and how it changes with load | – | – | tyre |

## TMeasy (the rear tyres: braking, driving and turning share one grip budget)

`x` = along the nose, `y` = sideways. `M` = the peak (maximum), `S` =
sliding.

| symbol | meaning | unit | sign | files |
|---|---|---|---|---|
| `dFx0`, `dFy0` | initial slope: force per unit slip near zero slip | N per unit slip | – | tyre |
| `FxM`, `FyM` | peak force | N | – | tyre |
| `sxM`, `syM` | slip at the peak (κ / tan α) | – | – | tyre |
| `FxS`, `FyS` | force once fully sliding | N | – | tyre |
| `sxS`, `syS` | slip where full sliding starts (set to 1) | – | – | tyre |
| `sxn`, `syn` (ŝx, ŝy) | normalised slips: κ ÷ normaliseX, tan α ÷ normaliseY | – | as κ / α | tyre |
| `s` | combined slip, √(sxn² + syn²) | – | ≥ 0 | tyre |
| φ (`cosPhi`, `sinPhi`) | direction of the combined slip | – | signs of the slips | tyre |
| `dF0` | initial slope in that direction | N per unit slip | – | tyre |
| `FM`, `sM` | peak force and its slip, in that direction | N, – | – | tyre |
| `FS`, `sS` | sliding force, and the slip where sliding starts, in that direction | N, – | – | tyre |
| `F` | the combined tyre force (Fx = F cos φ, Fy = F sin φ) | N | – | tyre |
| `sigma` (σ) | where s sits within the current piece of the curve | 0..1 | – | tyre |

## Spelled out in the code, symbols only in comments

| symbol | meaning | unit | code name / files |
|---|---|---|---|
| ρ (rho) | air density, 1.225 | kg/m³ | `AIR_DENSITY`, resistance |
| CdA | drag area (drag coefficient × frontal area) | m² | `dragArea`, drivetrain, resistance |
| Crr | rolling resistance coefficient | – | `rollingResistance`, drivetrain, resistance |
| η (eta) | drivetrain efficiency: share the chain passes on | – | `efficiency`, drivetrain |
| rpm | engine revolutions per minute | 1/min | drivetrain |
| u | share of the inner rear wheel's load moved across (= 1 − rearLift) | – | `innerLoadMoved`, Car, rearAxle |
