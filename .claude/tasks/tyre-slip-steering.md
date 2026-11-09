# Tyre-slip steering (level 3: dynamic bicycle model)

Robin (2026-11-09): "we might rotate a bit too much on the low end of
speed" → level 3 chosen. Today (`Car.steer`): turn rate = min(geometry
v / L × tan δ, grip gripG × 9.81 / v); the car always moves along its nose.
Measured (full lock): radius 1.5–1.8 m up to 16–20 km/h, then a sharp
turn-rate peak at the switch (HyrkartCentralen 153°/s at 16 km/h,
Racingkart125cc 202°/s at 20 km/h). No slip: the car follows its wheels
perfectly below the limit, then switches abruptly.

## Goal

The car gets a sideways speed and a yaw rate of its own; front and rear
tyres make sideways force from their slip angle, saturating at the grip
limit → gradual understeer, slides, spins, inertia. Server game logic
only: the App, rays, checkpoints, laps, metres and GameState (fields and
format) stay as they are.

## One kart at a time (Robin)

All karts get the model, ONE AT A TIME: Hyrkart240cc first, then
HyrkartCentralen, then Racingkart125cc. A kart without its slip values
keeps today's steering exactly (`Car.steer`), so the karts not yet done —
and agents training on them — are untouched until their turn. Each kart:
phase 1 → 3 below; when the last one is done, the old `steer` goes.

## Model (per tick, in substeps)

- State: `speed` (km/h, along the nose — as today: gas / brake / reverse /
  rolling act on it), NEW `lateralSpeed` (m/s, + = right), NEW `yawRate`
  (rad/s, + = right).
- Axles: CoG `cogToFront` / `cogToRear` (a + b = wheelbase); normal load
  per axle from the weight split.
- Slip angles: front αf = atan((vy + a·r) / |vx|) − δ, rear
  αr = atan((vy − b·r) / |vx|).
- Tyre force per axle: Fy = −μ·Fz·tanh(C·α / (μ·Fz)) — linear (cornering
  stiffness C) for small slip, levels off at the grip limit μ·Fz
  (μ = gripG, as today).
- Rigid rear axle (karts have no differential): the inner and outer rear
  wheel must turn at the same speed → a moment against the rotation that
  is strongest at low speed (slip ratio ∝ yaw rate × track width / speed),
  capped by grip. The real reason a kart doesn't pivot on the spot — and
  the fix for "too much rotation at low speed".
- Equations: vy' = (Fyf·cos δ + Fyr) / m − vx·r;
  r' = (a·Fyf·cos δ − b·Fyr + M_axle) / Iz.
- Move along the VELOCITY (nose + sideways), not the nose:
  x += (vx·cos θ − vy·sin θ)·dt, y += (vx·sin θ + vy·cos θ)·dt; θ += r·dt.
- Low speed (|vx| < ~3 km/h): the slip formulas blow up (÷ vx) → blend to
  the kinematic model (today's geometry) there; speed 0 → no turn (as
  today).
- Reverse: same model with vx < 0 (signs handled), as today turns the
  other way.
- Substeps (e.g. 8 per 1/60 s tick): the tyre forces are stiff, plain
  Euler at 1/60 s can blow up.
- Blocked (collides where it stands): no move (as today); lateralSpeed
  and yawRate → 0; it can still steer free (kinematic, as today).
- Reset: lateralSpeed, yawRate → 0.

## New values per kart (ESTIMATES, tuned in phase 3)

| | HyrkartCentralen | Hyrkart240cc | Racingkart125cc |
|---|---|---|---|
| mass incl. driver (kg) | ~186 + 80? | ~150 + 80? | 75 + 80 |
| CoG to rear axle (share of wheelbase; ~40/60 front/rear weight) | ~0.4 | ~0.4 | ~0.42 |
| yaw inertia Iz (kg·m²) | from mass + size | | |
| cornering stiffness front / rear (per kN of load) | | | |
| rear axle scrub stiffness | | | |

`gripG` stays the grip limit; `wheelLock` stays (the model decides how
much of it turns into rotation).

## Decisions for Robin (before code)

1. `weight` today: with or without driver? (Racingkart 75 kg = without.)
   Plan: mass = weight + 80 kg driver.
2. `speed` (GameState, HUD) = speed along the nose (as today) — not the
   total speed.
3. `heading` follows the NOSE vs the track (as today), not the direction
   of travel during a slide.
4. Phase 1 has NO weight transfer and NO braking/gas effect on grip
   (lift-off oversteer, trail braking) — a later phase if wanted.
5. Steering speed limit (wheel can't go 0 → full lock in one tick)?
   Separate, later.

## Phases

### Phase 0: research the kart's real values (Robin: per kart, first)
- [x] 240cc (2026-11-09). Göteborgs Gokartcenter, Torslanda (gokart.se/utomhus):
      **Caroli Hammerhead, Honda GX270** (270 cc, 9 hp, centrifugal
      clutch), "närmare 80 km/h". Caroli spec (carolimotor.com/gokart/hammerhead):
      **150 kg** (dry, same for every engine → + ~80 kg driver = 230),
      **1.95 × 1.35 m** (code: 2.0 × 1.4), tyres 10x4.50-5 / 11x7.10-5
      (hard rental compound). **No reverse gear** (medium-high).
      NOT published (estimates, low confidence): wheelbase 1.04–1.10 m,
      rear track 1.15–1.20 m, front 1.00–1.10 m, wheel lock inner 35–40° /
      outer 25–30°, turning circle ~4.5–5 m kerb to kerb, peak lateral
      1.0–1.3 g on rental tyres (racing karts 1.5–2.5 g), weight 40/60 –
      43/57 (forums), Iz 40–70 kg·m², cornering stiffness 8–15 / rad × load,
      inner rear lifts ~0.5–1.0 g. Real figures: ask Caroli Motor
      (info@carolimotor.com) or measure at the venue.

Decisions (Robin, 2026-11-09, after the research):
- Size → 1.95 × 1.35 m (with the physics; changes hitbox + rays).
- Name stays `Hyrkart240cc` (a data key: track files' expected lap times,
  sessions, S3 + Space, agents' join); comment = Caroli Hammerhead, GX270.
  Rename = a separate task if ever.
- Reverse stays (agents back out of crashes) but is simple: below a low
  speed / in reverse → kinematic steering, no slip (no spin).
- Unpublished values: midpoints of the estimates, then tuned by
  driving — CLAUDE drives (headless bot + Player mode in Chrome on
  5174 / 8081), Robin checks the result.

### Phase 1: model + numbers, headless (no game change yet) — 240cc
- [x] 1. Scratch harness (first run, ESTIMATED values): low speed radius
      2.4–3.4 m (today 1.8), standstill OK. Problems: reverse spins
      (−492°/s at −20 km/h); step steer at 40 km/h oscillates (inner-rear
      lift switch?). Re-run with the researched values.
- [x] 1a. Researched midpoints (L 1.07, b 0.415 L, μ 1.15, δ 32°, track
      1.175, cf = cr 11.5, liftG 0.75) + fixes: inner-rear lift lags
      (liftTau 0.15 s, no flicker), reverse = kinematic. Result: radius
      2.0–2.8 m below 15 km/h (today 1.8), peak 119°/s at 15 km/h (today
      133), step steer 90 % in 133 ms / 23 % overshoot, 80 km/h flick no
      spin (max slip 11.5°), reverse as today, standstill + weaving clean.
- [ ] 1b. Scratch harness: today's model vs the new one, Hyrkart240cc —
      steady full-lock circle at 5 / 10 / 15 / 20 / 30 / 40 / top km/h
      (radius, turn rate), a step steer at 40 km/h (how fast it settles,
      overshoot), a full-lock flick at top speed (does it spin / slide),
      speed 0 and reverse (no NaN, sensible). Robin reads the table.

### Phase 2: into the game
- [x] 1. `Car`: `SlipValues`, optional `slip`, `lateralSpeed` / `yawRate`
      (+ private rearLift), `slide()` (8 substeps, min 1 m/s in the slip
      angles), `stopSliding()`; applyControls: slip && speed ≥ 0 → slide,
      else stopSliding + steer; reset → stopSliding
- [x] 2. Hyrkart240cc: 1.95 × 1.35 m, gripG 1.15, wheelLock 32, wheelbase
      1.07, slip values (the other two: nothing yet)
- [x] 3. `GameEngine.tickPlayer`: move along speed + lateralSpeed;
      blocked → stopSliding
- [x] 4. tsc ok; the real classes through applyControls (scratch
      slipCheck.ts): 240cc = the harness table (15 km/h 119°/s 2.0 m,
      reverse kinematic, standstill no turn); HyrkartCentralen +
      Racingkart125cc = today's formula to 5e-12 °/s, no lateral state

### Phase 3: drive it
- [x] 1a. Claude drives: ray bot as an agent (scratch `driveBot.js`, fast
      lobby, test server 8081), same bot on new vs old physics (old =
      worktree ~/Projects/formulai-oldsteer at 0d4187b).
      Torslanda GP 3 laps: careful 75.08 → 74.87 s, harder 65.28 → 66.25 s,
      0 crashes both; new slides up to 16° (old's 6° = rear-axle pivot in
      the measurement). Most aggressive: bot crashes in corner 1 (assumes
      1.1 g braking, kart has 0.99 g) — not a spin.
      Low speed (Training 4 / 5 / 6, capped 15 km/h): max rotation old
      134 / 134 / 134°/s → new 37 / 49 / 106°/s, times +0.03…0.25 s, 0
      crashes. Knobs if 15 km/h still too sharp: axleStiffness, wheelLock.
- [x] 1b. Claude watched it in the lobby viewer (5174). Robin: "a little
      bit cartoony in the turning". Trace: the bot sat on full lock (32°)
      through a 40 km/h corner yet turned calmly (tanh tyre never loses
      grip past its peak → full lock free), and the nose swung back at
      −91°/s on exit.
- [x] 1c. Fix A (Robin): Magic Formula tyre (Pacejka, E = 0) —
      `peakSlipDeg` 8, `slideGrip` 0.75 replace front/rearStiffness.
      40 km/h sweep: tightest at 20 % steering (10.9 m, 1.14 g), full lock
      ploughs (14.9 m, 0.85 g); step steer overshoot 23 → 1 %; exit swing
      −91 → −64°/s; corner slide 4–6° → 0–1°. Trade-off: 3–10 km/h radius
      2.0–2.2 m (tanh 2.3–2.8, today 1.8); axleStiffness 10 → 30 changes
      nothing there (wheelLock is the knob if needed).
      Robin: understeer, not oversteer (karts hardly oversteer); a sharper
      snap (lower slideGrip + E) discussed → LEAVE AS IS (hard rental tyres
      are progressive; sharper fits the Racingkart125cc later).
- [ ] B (later, not decided): steering speed limit (wheel 0 → full lock
      ≥ ~0.2 s) — smooths jerky bot / keyboard / agent inputs
- [ ] 2. Expected lap times — Robin: AFTER all three karts are done, one
      round for all (he pastes them into the track files)
- [x] 3. Docs (240cc): `.personal/CLAUDE.md` "Car Physics" (tyre-slip
      section, position along the velocity, gripG values corrected),
      README "Cars" (240cc slides; table: Caroli Hammerhead, 1.95 × 1.35,
      grip 1.15; grips corrected to the code)

Order (Robin, 2026-11-09): 240cc commit → HyrkartCentralen (phase 0–3) →
Racingkart125cc (phase 0–3; a sharper tyre peak may fit) → expected lap
times for all three → clean-up (test server 8081 / App 5174, bucket
formulai-test, worktree ~/Projects/formulai-oldsteer, Chrome tab).

## Later: agent data (Robin likes all of these; not now)

Real-car-like signals so an AI can feel a slide (extra JSON fields —
existing agents ignore them; both protocol copies + gameState.ts + docs):
- `yawRate` (°/s, + = right) — gyro; rotating more than the steering asks
  = oversteer starting, less = understeer
- `slipAngle` (°, + = right) — nose vs direction of travel; 0 = clean
- `lateralG` (g, + = right) — accelerometer; vs gripG = how near the limit
- `lateralSpeed` (km/h) — same information as slipAngle in another form
- grip used front / rear (0–1) — inside information a real car doesn't
  have, but shows under- vs oversteer directly
