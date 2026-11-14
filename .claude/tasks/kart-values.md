# Kart values — which ones matter (NEXT task after braking-strength)

Noted 2026-11-13. Robin: "we have many values that are hardcoded but
calculated from other values … why don't we create a cache system instead
that resets every build?" and "it starts to become hard to know what values
actually matter".

## Problem

~30–40 values per kart in `server/src/game/cars/gokarts/*.ts` (+ the
module constants), side by side: sourced, estimated, tuned and
hand-derived. From the file alone you can't tell which ones decide the
behaviour, and derived values go stale when their inputs change.

## Already derived at runtime (nothing to keep up to date)

- `brakeLock()` (keyboard aid's lock point) — computed from the kart values.
- TMeasy tyre tables (peak slip, locked force per load) — built at server
  start from the kart tyre data (fastest-lap project) = a cache rebuilt
  every start.
- Keyboard aids get their numbers from the server (`res:player/join
  { handling }`).

## Hard-coded but derived (known; a sweep will find all)

- Gear ratios: e.g. Hyrkart270cc 3.09 = "80 km/h at 4500 rpm",
  HyrkartCentralen 3.66 = "4000 rpm at the 60 km/h limit" — by hand.
- Racingkart125cc `liftOffFromKmh: 36` = clutch ~4000 rpm at 13/77.
- `expectedLapTimes` in the track files (S3): minutes of bot driving; already
  stale with the braking-strength physics — the expensive "cache" case.
- Docs (.personal) repeat derived numbers (e.g. brakeLock 0.38 / 0.54 /
  0.59) — not code, but they go stale.

## Plan (ask Robin before each step)

1. Read-only sweep: an inventory table of every input value per kart —
   value, unit, what it does, source, kind (sourced / estimate / tuned /
   derived), and for derived ones: from which inputs.
2. Sensitivity analysis (measured, not guessed): a script nudges each value
   ±10 % and reports how much the key results move — braking distance,
   trail-braking slip, lockup, top speed, acceleration, lap time on a few
   layouts (reuse brakingSuite / physicsTrace tooling). Add the column.
3. Sort: matters a lot + only an estimate → measure / research (cgHeight is
   one already); barely matters → leave it, say so in the table; derived →
   compute from its inputs at load (cheap ones: no cache needed).
4. Expensive derived values (expectedLapTimes): a cache keyed by a
   fingerprint of the physics code + the track file → recomputed when
   either changes (at build / deploy). Needs design: where it runs, how
   long, the S3 write (today `npm run laptimes -- --yes`).

Already known from braking-strength (sensitivity seen there):
- cgHeightMeters + rear weight share decide straight-line braking.
- Axle inertia 0.2 → 0.1 barely matters (0.02–0.07 s on the lock).
- The outer-rear brake moment's size (inner-rear lift) decides how planted
  braking in a corner is.

## Step 1 result — inventory (2026-11-14, read-only)

Values: Centralen / 270cc / Racingkart. Kind: **S** sourced (maker,
regulation, data), **E** estimate, **T** tuned against tests, **D** derived
by hand from other values, **N** numerical (solver, not physics), **X**
unused.

### Per kart, top level (`gokarts/*.ts`)

| Value | C / 270 / R | Unit | Does | Kind |
|---|---|---|---|---|
| lengthM | 1.865 / 1.95 / 1.8 | m | body box: collision, rays, render | S |
| widthM | 1.35 / 1.35 / 1.4 | m | body box; fallback track width | S |
| brakeDeceleration | 40 / 35 / 35 | km/h/s | full-pedal brake torque (= m × it × r); the tyre decides what reaches the road; brakeLock = share of it | E |
| maxSpeed | 60 / 80 / 115 | km/h | governor / limiter on wheel speed | S / S / E |
| gripG | 1.15 / 1.15 / 1.6 | g | peak μ, both ways, front + rear | E |
| steeringLock | 90 / 90 / 60 | ° wheel | only with steeringRate (time to lock) + GameState scale | E |
| steeringRate | 360 all | °/s | hands' speed | E |
| wheelLock | 32 / 32 / 35 | ° | front wheel angle at full lock | E |
| wheelbaseMeters | 1.04 / 1.07 / 1.04 | m | bicycle model, transfer, Ackermann | S / E / S |
| tyreWidthMeters | 0.114, 0.18 all | m | tyre marks only | S |
| weight | 186 / 150 / 75 | kg | **nothing** (massKg repeats it) | X |

### slip (SlipValues)

| Value | C / 270 / R | Unit | Does | Kind |
|---|---|---|---|---|
| massKg | 266 / 230 / 162 | kg | everything | D (weight + 80) / D / S |
| rearShare | 0.42 / 0.415 / 0.43 | – | static axle loads | E |
| yawInertia | 60 / 55 / 27 | kg·m² | how fast it rotates | E |
| peakSlipDeg | 8 / 8 / 6 | ° | FRONT tyre peak (rear shape = data) | E |
| slideGrip | 0.75 / 0.75 / 0.7 | – | grip left sliding, front + rear side | E |
| rearTrackMeters | 1.125 / 1.175 / 1.2 | m | spool + outer-brake moment, roll | E |
| frontTrackMeters | 1.05 all | m | Ackermann, roll | E |
| axleStiffness | 10 all | – | spool moment size | E (no source) |
| jacking | 0.5 / 0.5 / 0 | – | inner rear lift from steering | T |
| liftSeconds | 0.15 all | s | lift lag | E |
| cgHeightMeters | 0.23 / 0.25 / 0.29 | m | weight transfer (braking!), roll | E |
| loadSensitivity | −0.1 / −0.1 / −0.15 | – | grip per kg falls with load | E |

### drive (DriveValues)

| Value | C / 270 / R | Unit | Does | Kind |
|---|---|---|---|---|
| torqueNm | 42 / 19.1 / 21 | Nm | pull (flat) | S; **270cc: X** (its curve wins) |
| torqueCurve | – / Honda 5 pts / – | rpm, Nm | pull over rpm | S |
| powerW | 10k / 6.3k / 22k | W | pull cap at speed | E / S / S |
| gearRatio | 3.66 / 3.09 / 77⁄13 | – | rpm, pull | D (4000 rpm at 60) / D (4500 rpm at 80) / S |
| efficiency | 0.95 / 0.9 / 0.95 | – | pull | E |
| wheelRadiusMeters | 0.1455 / 0.1455 / 0.14 | m | rpm, torque ↔ force | S |
| dragArea | 0.55 / 0.55 / 0.45 | m² | air drag | E / E / S (CFD) |
| rollingResistance | 0.02 / 0.02 / 0.018 | – | rolling drag | E |
| liftOffG | 0.1 / 0 / 0.05 | g | regen / engine braking | E |
| liftOffFromKmh | 0 / 0 / 36 | km/h | clutch engages | D (4000 rpm, 13/77, r) |

### Shared constants (`physics/*.ts`, all karts)

| Value | Value | Does | Kind |
|---|---|---|---|
| G, AIR_DENSITY | 9.81, 1.225 | – | physics constants |
| FASTEST_LAP_REAR (12 MF coefficients) | – | rear tyre curve SHAPE | S (data, origin unknown) |
| AXLE_INERTIA | 0.2 kg·m² | axle spin | S (barely matters, seen) |
| TRANSFER_SECONDS | 0.08 s | weight-transfer lag | E |
| LIFT_OFF_FADE | 0.1 | gas where lift-off is gone | E |
| LOCKED_SLIP | −0.5 | lock FLAG only: marks, scrub, logs — no force | E |
| SLIP_SUBSTEPS 8, SLIP_MIN_SPEED 1, KINEMATIC_BELOW 1 / SLIP_ABOVE 3, tables | – | solver | N (Kabzan 2019 for the blend) |

### What the sweep found

- **Dead:** `weight` (all karts) and the 270cc's `torqueNm`.
- **Derived by hand (go stale):** massKg (rental: weight + 80),
  gearRatio (C, 270), liftOffFromKmh (R). All checked: consistent today
  (59.9 km/h at 4000 rpm; 79.9 km/h at 4500 rpm; 35.6 km/h at 4000 rpm).
- **Physics inputs:** 31 per kart, of which sourced ≈ 8–11, the rest
  estimates / one tuned (jacking).
- **Not kart values but worth knowing:** App keyboard aids (BRAKE_AID 0.8,
  ramp times, stability trim) — Player mode only, outside the physics.

## Step 2 result — sensitivity (2026-11-14)

`server/scripts/sensitivity.ts` (new, not committed): each value ×1.1 and
×0.9, one at a time, on the main code (6eaf6a7). Raw tables:
`kart-values-results/sensitivity-<kart>.md`. Measures: L (brakeLock), stop
distance from 0.9 × maxSpeed at pedal L and at the full pedal, trail braking
(steady turn at 0.6 of the grip, then 0.6 L for 1 s: max body slip, speed
left), top speed, 0–58 km/h, Torslanda GP lap (laptimes.ts's bot).

Baselines (C / 270 / R): L 0.396 / 0.546 / 0.585; stop at L 20.3 / 35.9 /
63.6 m (from 54 / 72 / 104 km/h); locked 30.3 / 52.5 / 85.3 m; trail slip
2.7° / 0.9° / 12.7°; top 59.9 / 79.5 / 114.2; 0–58 5.8 / 13.9 / 3.5 s;
lap 81.1 / 88.7 / 65.5 s.

Noise: the lap column is the bot's best of 18 settings → it jumps. Centralen
± 1.5 % even from values that can't touch it (lengthM, steeringLock both
ways); 270cc / Racingkart ~0.1–0.6 %. Trail slip in % on the rental karts
is % of ~1–3°: small in degrees.

### Matters (> ~2 % on something), most first

| Value | Moves | Kind |
|---|---|---|
| gripG | stop distance 6–9 %, lap 3–5 %, trail (Racingkart +90 / −42 %) | E |
| rearShare | stop distance 7–8 %, L 7–9 %, trail 9–19 % | E |
| cgHeightMeters | stop 1.4–3.6 %, Racingkart trail +126 % / −50 % (on the edge) | E |
| wheelbaseMeters | stop 1–4 %, lap up to 3.6 % (R) | S / E / S |
| rearTrackMeters | trail: 270cc −10 % → +30 %, Racingkart +54 % / −41 % | E |
| massKg | 0–58 ± 10 %, 270cc lap ± 2.4 %, Racingkart trail 7–9 % | D / D / S |
| torque (Nm or curve), gearRatio, efficiency, wheelRadius | 0–58 4–15 %, lap up to 3 % (270cc) — one product: torque × ratio × η / r | S / D / E / S |
| powerW | Centralen only: 0–58 5–7 % (the others: torque-limited) | E (C) |
| maxSpeed | top speed 1 : 1 (every kart ends on the governor) | S / S / E |
| Racingkart only (trail on the edge): frontTrack 16–23 %, peakSlipDeg 9–15 %, axleStiffness 9–10 %, slideGrip 7–9 %, dragArea 8 %, liftSeconds 6 % | | E |
| brakeDeceleration | L ∓ 9–11 % ONLY: stop distance at L unchanged, locked < 1 % → a pedal SCALE (how much of the travel is used before the lock), not braking power | E |

### Barely matters (< 1 % everywhere here)

dragArea + rollingResistance (rental), loadSensitivity (< 0.5 %, R trail
3 %), yawInertia, jacking, liftSeconds (rental), liftOffG (C: L 2 %),
liftOffFromKmh, TRANSFER_SECONDS, AXLE_INERTIA (< 1 %, as seen before).

### Zero

weight, the 270cc's torqueNm (dead, as found in step 1); tyreWidthMeters
(marks only); lengthM / widthM (collision only; lap = noise).

### Not exercised by these tests (don't read "0" as "doesn't matter")

steeringLock, steeringRate, wheelLock: the tests set a front-wheel angle
(and the bot divides by wheelLock) — they decide how an agent's / the
keyboard's steering maps onto the wheels and how fast, not the physics'
outcome. LIFT_OFF_FADE: the tests use pedals 0 / 1 only (it acts at part
gas).

## Step 3A result — derived values computed (2026-11-14, worktree formulai-kart-values, feat/kart-values)

- mass = `weight` + `driverKg` (80 rental; Racingkart 87 = the rest of
  the 162 kg Rotax Senior minimum); `weight` / `driverKg` abstract on Car.
- `drivetrain.gearRatioAt(rpm, km/h, r)` / `speedAtRpm(rpm, ratio, r)`:
  Centralen 3.66 → 3.6568, 270cc 3.09 → 3.0854, Rotax clutch 36 → 35.64 km/h.
- `DriveValues`: either `torqueNm` or `torqueCurve` (type union); the 270cc's
  dead torqueNm 19.1 removed.
- Proof: physics trace with the old rounded numbers put back = identical
  (38,880 number lines; keys differ only by `driverKg`). Exact gearing:
  270cc 0–58 13.867 → 13.883 s, nothing else measurable. Lap dry run: 9 of
  45 change, 7 by 0.1 s, 2 by ~1.5 % = the bot's noise (Robin: A — keep
  exact gearing, lap times NOT rewritten).
- Docs: `.personal/CLAUDE.md` (worktree copy) updated; also fixed the 270cc
  top speed there (71.9 → 79.5, measured).
- Open: the lap bot's noise (±1.5 % Centralen) — own task later.

## Step 3B — research (2026-11-14, four kart-driver agents; nothing run, nothing changed)

Files: `kart-values-results/research-{gripG,rearShare,cgHeight,rearTrack}.md`
(every source, quotes, confidence). Suggestions (now → suggested, confidence):

| Value | Centralen | 270cc | Racingkart |
|---|---|---|---|
| gripG | 1.15 → 1.05–1.10 (or keep if indoor), low–med | 1.15 → ~1.05, low–med | keep 1.6 (1.5–1.8), med–low |
| rearShare | keep 0.42, low | keep 0.415, low | 0.43 → 0.42, med |
| cgHeightMeters | keep 0.23 (or 0.21), none | keep 0.25 (or 0.22), none | 0.29 → 0.25, med |
| rearTrackMeters | 1.125 → 1.15, low–med | 1.175 → 1.15, low–med | 1.20 → 1.18, med |
| frontTrackMeters | keep 1.05 | keep 1.05 | keep 1.05 |

Key new sources: fastest-lap kart model (Lot & Dal Bianco port, commit
0660208) h 0.25 m, tracks 1.055 / 1.2 m, CoG 0.383 front; ETH RiMO SiNUS iON
rental kart (hard Dunlop SL1) tyre fit μ ≈ 0.96–1.06 + IMU ±1 g (Picotti
2023); forum scale readings 39–42 % front (Rotax / X30); CIK RT 2023 + Rotax
TR widths; AiM/TKart 100cc ~1.55 g (GPS). Blocked: Lot & Dal Bianco 2016,
Dal Bianco thesis (could be fetched by hand). Best real data: an
accelerometer (phone / AiM) on the real rental karts.

### 3B test A — Racingkart rearShare 0.42 + cgHeight 0.25 + rearTrack 1.18 (copy, main untouched)

Suite (`kart-values-results/suite-racingkart-set-A.txt`): PASS 64 → 66, ≈ 6
→ 3, FAIL 20 → 21 (rental rows unchanged). Racingkart much calmer:
- braking better: L 0.585 → 0.635; 100→0 at L 59.3 → 55.5 m (peak 0.71 →
  0.76 g); 106→46 at L 52.1 → 48.7 m (Vroomkart 39.1: FAIL → ≈).
- trail braking calmer: TB 0.5 s slip 14 → 4°, TB 1 s 13 → 2° (≈ → PASS);
  TB-CATCH no catch needed anywhere; S1, COAST ≈ → PASS; LOCK-DRIVER
  slightly straighter.
- WORSE: P6 / P7 (a brake tap at turn-in should rotate it 4–15° / 10–25°)
  PASS → FAIL: +10 / +13° → +0.6 / +0.9° — taps no longer rotate it.
- Sensitivity measures: stop at L 63.6 → 59.5 m, trail slip 12.7 → 4.7°,
  Torslanda GP lap 65.55 → 64.97 s.

### Rule (Robin 2026-11-14): "Calculate values that are static should be calculated once and then used per build."

To do after 3B: find what is recomputed per call / per kart although its
inputs are static (e.g. brakeLock() per call, mass / gearing per kart
instance, the front tyre's B / C) → compute once (module level / per kart
class, at load) and reuse. expectedLapTimes = step 4 (fingerprint cache).

### 3B test A, one change at a time (Racingkart; `suite-racingkart-only*.txt`)

| | stop 100 L | 106→46 L | TB 0.5 / 1 s slip | P6 / P7 tap rotation | lap |
|---|---|---|---|---|---|
| today | 59.3 m | 52.1 m FAIL | 14 / 13° | +10 / +13° PASS | 65.55 |
| rearShare 0.42 | 58.3 | 51.1 FAIL | 13 / 12° | +8 / +12° PASS | 65.35 |
| cgHeight 0.25 | 56.4 | 49.7 FAIL | 4 / 2° | +0.6 / +0.8° FAIL | 65.05 |
| rearTrack 1.18 | 59.3 | 52.1 FAIL | 16 / 15° | +12 / +13° PASS | 65.48 |
| all three | 55.5 | 48.7 ≈ | 4 / 2° | +0.6 / +0.9° FAIL | 64.97 |

The CoG height alone takes the edge away (a brake tap no longer rotates the
kart); rearShare brakes a little better and keeps it; rearTrack a little
edgier, as the sensitivity said.

### 3B decision (Robin: A) — Racingkart rearShare 0.42 + rearTrack 1.18; CoG stays 0.29

Branch `feat/racingkart-values` (worktree formulai-kart-values). Suite
(`suite-racingkart-share-track.txt`): no verdict changes (64 / 6 / 20);
100→0 at L 59.3 → 58.3 m, 106→46 52.1 → 51.1 m; TB slip 14–15°; brake
tap still rotates +11–12° (P6 / P7 PASS). Lock point 0.585 → 0.598 (docs
0.59 → 0.60: agent-protocol, README — which still had the old 0.38 / 0.54 —
.personal). Lap dry run: Racingkart −0.1 to −0.2 s on most layouts (one
+0.4 = bot noise); rental changes = the earlier gearing / noise ones.
Open: CoG 0.25 (fastest-lap) vs 0.29 — needs the Lot & Dal Bianco paper;
rental karts — need real data (phone accelerometer at the venues).

## Once-per-build survey (2026-11-14, read-only)

Static inputs (kart values, constants) recomputed again and again:

| What | Where | How often | Cost |
|---|---|---|---|
| front tyre shape B, C (asin, tan) + a new closure | Car.slide → tyre.magicFormula | every tick, per kart | small; the only allocation |
| a, b (CoG → axles), static axle loads | Car.slide → loads.staticLoads | every tick | trivial |
| full-pedal brake force per unit pedal (brakeDeceleration / 3.6 × m) | Car.slide, Car.longitudinal | every tick | trivial |
| rolling force Crr·m·g | Car.slide (per substep), longitudinal | 8× per tick | trivial |
| sin(wheelLock), mean track, static rear share | loads.innerRearLift | 8× per tick | trivial |
| rearBrakeLimit (reverse brake cap) | Car.longitudinal | every reverse tick | trivial |
| brakeLock() (analytic lock point) | FormulaiServer player join (once); scripts/laptimes bot + brakingSuite: every tick | per call | small |
| mass = weight + driver, gear ratio, clutch speed | kart class fields | each kart created | trivial, rare |

Not static (depend on the wheel load, change every substep), but built
from static data: the rear tyre's shape factors fastestLapShapeBx / By
(exp, sin, atan; 2× per substep for dFx/dκ) — a load table like the
other three would cache them, but interpolation changes the numbers
slightly (not byte-identical).

Already once per start (= per build in Node: a deploy starts a new
process): the rear tyre's three load tables (tyre.ts module level).

Docs repeat measured / derived numbers (lock points, top speed, 0–58,
lock times) — can't be computed; they go stale unless re-measured.

Expensive: expectedLapTimes → step 4.

Catch: scripts/sensitivity.ts changes values on a kart INSTANCE after it is
built. A cache per kart CLASS (at load) would miss those changes; a cache
per kart instance, computed when the kart is created, sees them only if
built after the change → the script would need its own variant classes.

### Once-per-build done (Robin: A) — branch feat/kart-constants

`physics/kartConstants.ts`: a / b, static axle loads, the front tyre's curve,
rolling force, sin wheelLock, mean track, brakeLock, the reverse brake cap —
once per kart class (Map by constructor, first kart that asks), reused for
the process. Car.slide / longitudinal / brakeLock and loads.innerRearLift
read it. sensitivity.ts: a class per tried value (variantOf), and the lap
test builds it via Session.chooseCar. Left inline on purpose: the brake
force per pedal (precomputing it reorders the floating point — not
byte-identical) and the rear tyre's load-dependent shape factors.
Proof: physics trace main vs branch byte-identical (38,893 lines, keys
too); sensitivity output identical main vs branch for all three karts
(73 rows each, no laps) and the Racingkart with laps.
