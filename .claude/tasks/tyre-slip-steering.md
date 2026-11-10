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

- [x] HyrkartCentralen (2026-11-09). Gokartcentralen (gokartcentralen.se/gokartarna,
      checked): "Speedkart", brushless IPM, 42 Nm, 48 V 86 Ah lithium,
      "ca: 60km/h", speed mode +20 %, **"Möjlighet att backa" (reverse)**.
      Model not named by the venue → **Sodi RSX2** (identical specs at
      erkc.se "uses the Sodi RSX2"; venue hosted the Sodi SWS final on
      RSX2s) — medium-high. Sodi (sodikart.com rsx2-43, checked):
      **1.865 × 1.35 m** (code 1.95 × 1.38), **186 kg with batteries**
      (no driver → ~266 kg), height 0.63 m. Drawing: wheelbase ≈ 1.04 m
      (medium), tyres Ø 262 / 291 mm = 10x4.50-5 / 11x7.10-5 (same as the
      240cc), battery low in the floor between the axles. NOT published
      (estimates): track front ~1.00 / rear 1.10–1.15 m, weight ~42/58,
      Iz 55–65 kg·m², steering lock, grip (1.0–1.3 g), rigid rear axle
      (medium), 0–50 km/h ~4–6 s.

- [x] Racingkart125cc (2026-11-09). Robin: "I think it was KZ" → "might
      be Rotax then" → **Rotax 125 Max EVO Senior** (direct drive). Checked
      in the downloaded regs: Rotax datasheet **22 kW / 30 hp**, 21 Nm,
      chassis **wheelbase 1,040 mm**; RMC Global Sporting Regulation 2025
      min weight **162 kg** kart + driver (125 Senior MAX column); CIK RT
      overall length **1820 mm** max without front fairing, width 1400 mm;
      Rotax GF 2025 §2.2.4 **"Front brakes are not allowed"** (Senior).
      Tyres Mojo D5 prime slicks 10x4.50-5 / 11x7.10-5. No reverse, rigid
      axle. Medium: top speed ~115–125 km/h (gearing 13/73–77), weight
      42–44 / 56–58, lateral ~1.5–1.7 g sustained (logger, 100cc
      rear-brake proxy, GPS-smoothed), braking ~0.8–1.1 g, CoG ~0.30 m.
      Estimates: Iz 20–33 kg·m², steering wheel ±90–100°, wheel lock
      inner 35–40 / outer 25–30, slick peak ~5–7° (sharper than rental),
      acceleration ~16–18 km/h per s.
      Code differs: gripG 2.0 (high for D5), brakeDeceleration 70 km/h/s
      ≈ 2 g (high: rear brake only ≈ 28–39), acceleration 22 (est. 16–18),
      steeringLock 60 (est. 90–100), wheelbase 1.05 (1.04), 28 hp (30).

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
- [x] B (Robin, after HyrkartCentralen looked "a bit too snappy"):
      steering speed limit, per kart `Car.steeringRate` (°/s on the
      wheel; not set → instant). 240cc + Centralen 360 (0 → full lock
      0.25 s, full → full 0.5 s); Racingkart125cc none until its turn.
      Checked: 6°/tick, full in 15 ticks; Racingkart instant. Jarfalla GP
      63.35 → 63.25 s, Training 6 22.68 → 22.67 s, 0 crashes; viewer wheel
      ≤ ~18° / 50 ms. GameState car.steering = where the wheel IS.
      Robin: "yes better".
- [ ] 2. Expected lap times — Robin: AFTER all three karts are done, one
      round for all (he pastes them into the track files)
- [x] 3. Docs (240cc): `.personal/CLAUDE.md` "Car Physics" (tyre-slip
      section, position along the velocity, gripG values corrected),
      README "Cars" (240cc slides; table: Caroli Hammerhead, 1.95 × 1.35,
      grip 1.15; grips corrected to the code)

### HyrkartCentralen (phases 1–3, 2026-11-09)
Decisions (Robin): size → 1.865 × 1.35 m; gripG 1.25 → 1.15 (same hard
rental tyres as the 240cc, no source for more); reverse kinematic (the
real kart has reverse — slow, no spin); same tyre (peak 8°, slide 0.75).
Values: mass 186 + 80, rearShare 0.42, Iz 60, rear track 1.125 m,
wheelLock 32, wheelbase 1.04, rest as the 240cc.
- [x] Harness (vs today's 32° / 1.04 / 1.25): 3–15 km/h radius 1.9–2.1 m
      (today 1.7), 15 km/h 128°/s (today 143); 40 km/h full lock 14.9 m
      (today 10.1), tightest at ~20 % steering 10.9 m; step steer 1 %
      overshoot; 80 km/h flick 3° slide; reverse as today.
- [x] Game: real class = harness; 240cc unchanged; Racingkart125cc =
      today's formula (5e-12).
- [x] Bot, new vs old: Jarfalla GP careful 64.02 → 66.05 s, harder
      58.35 → 63.35 s (grip −8 % + full lock ploughs; the bot steers full
      lock), 0 crashes; slide max 14.6°. Training 6 at 15 km/h: max
      rotation 146 → 109°/s, 22.53 → 22.68 s. Real-time lobby for Robin.

### Racingkart125cc = Rotax Max Senior (phases 1–3, 2026-11-09)
Decisions (Robin): gripG 2.0 → 1.6, tyre peak 6° / slide 0.7 (slicks:
sharper), wheelbase 1.04, steeringLock stays 60 (estimate 90–100
unconfirmed), mass 162, horsePower 30, **brakeDeceleration 70 → 35**
(rear brake only), acceleration stays 22, steeringRate 360 (full lock
0.17 s). Iz 27, rearShare 0.43, rear track 1.2, liftG 0.8.
- [x] Harness (vs today 35° / 1.05 / 2.0): 15 km/h 159 → 152°/s (1.5 →
      1.6 m); 20 km/h peak 202 → 119°/s; 40 km/h full lock 6.3 → 11.9 m,
      tightest at 30 % steering 8.1 m / 1.56 g, full lock 1.06 g (−32 %);
      step steer 0 % overshoot; 80 km/h flick 1.4°.
- [x] Game: real class = harness; steering ramp 6°/tick, full in 10 ticks.
- [x] Bot new vs old, Torslanda GP: careful 71.22 → 70.88 s, harder
      57.37 → 59.37 s, 0 crashes; Training 6 at 15 km/h max rotation
      162 → 139°/s, 22.38 → 22.47 s. Real-time lobby for Robin.

- [x] Docs: README "Cars" (all karts slide; Racingkart = Rotax, 1.6 g),
      agent-protocol (steering limit on every kart), `.personal/CLAUDE.md`
      steering section rewritten (slide is the rule, steer = reverse),
      `Car.slip` comment. `steer` stays (reverse).

Order (Robin, 2026-11-09): 240cc commit → HyrkartCentralen (phase 0–3) →
Racingkart125cc (phase 0–3; a sharper tyre peak may fit) → expected lap
times for all three → clean-up (test server 8081 / App 5174, bucket
formulai-test, worktree ~/Projects/formulai-oldsteer, Chrome tab).

## Agent data — done 2026-11-10

All six in GameState `car`, normalised (Robin: everything 0–1; signed ones
-1..1 like steering, + = right; 4 decimals; clamped): `yawRate` ÷ (gripG ×
9.81 / max(v, 1 m/s)), `slipAngle` ÷ 90°, `lateralG` ÷ gripG,
`lateralSpeed` ÷ maxSpeed, `gripFront` / `gripRear` (renamed from "grip
used") 0–1. Raw values stored by `Car.slide`, normalised in
`formulai/gameState.ts`; all 0 in reverse (`steer` untouched). Grip is the
force in use, so past the tyre peak it drops (full lock at 32 km/h: 0.88).
Checked: 240cc, 30 % steering at 32 km/h → yaw 1, latG 0.94, gF 0.96,
gR 0.93; straight → all 0.

The original list:

Real-car-like signals so an AI can feel a slide (extra JSON fields —
existing agents ignore them; both protocol copies + gameState.ts + docs):
- `yawRate` (°/s, + = right) — gyro; rotating more than the steering asks
  = oversteer starting, less = understeer
- `slipAngle` (°, + = right) — nose vs direction of travel; 0 = clean
- `lateralG` (g, + = right) — accelerometer; vs gripG = how near the limit
- `lateralSpeed` (km/h) — same information as slipAngle in another form
- grip used front / rear (0–1) — inside information a real car doesn't
  have, but shows under- vs oversteer directly

## Fix: slide-accelerate exploit — done 2026-11-10

Robin: "it's possible to slide accelerate". Found: gas held + steering
flicked full left / right at 1–2 Hz → the kart spins and its ground speed
keeps growing (open plane, 20 s: HyrkartCentralen max 424 km/h, 240cc
1176, Racingkart 2278). Cause: `Car.slide` had the sideways equation
(vy += (F / m − vx·r)·dt) but `speed` (vx) never changed in it — no
+ vy·r (turning hands forward speed to sideways) and no front tyre pull
back (− front·sin δ / m, scrub). Sideways speed appeared from nothing.
Fix (Robin chose A, the full bicycle model): vx += (− front·sin δ / m +
vy·r)·dt per substep, vx ≥ 0 while sliding (a spin can't put the kart
in reverse, where stopSliding would drop the slide), `speed` written back.
- Exploit test new: every wiggle ≤ maxSpeed + ~1.5 % (gas tops `speed`
  up each tick with a little lateralSpeed; doesn't build up); wiggling
  now loses speed (240cc at 1 Hz: avg 37 km/h).
- Bot old vs new (seed tracks, 3 karts × 15 layouts × 18 settings,
  rebuilt bot `scratchpad/laptimes/drive.ts`): careful (0.8) 0.2–3 %
  slower everywhere (scrub); best clean lap within ±2 % mostly (−2.9 …
  +6.7 %); failed runs 372 → 324. Track files unchanged (md5).
- Expected lap times: this fix moves them < 1 s; they are stale from
  the tyre-slip steering itself (file vs new × 1.3: +5–11 % rental karts,
  +18–23 % Racingkart loops) → step 2 above, on the bucket's tracks.

## Grip cap: gas, brake and turning share the tyres (planned 2026-11-10)

Robin: "a large weave is the trick" — on every kart, weaving with gas held
keeps a 20–80° drift for 2–3 s (measured: open plane, 12 large weave
patterns; not caused by the slide fix — the old physics drifted too).
Real karts can barely drift: too aggressive → spin. Robin's model: each
tyre has ONE grip cap shared by gas, brake and turning; at the cap a kart
oversteers at low speed (the back catches the front) and understeers at
high speed. Realistic, from established algorithms, and cheap.

Tried on scratchpad copies (not kept): E1 gas gets only the rear grip
left (drift gone at 40 km/h, not at 70+); E2 + rigid-axle moment without
lift fade (no drift, but 15 km/h full lock 1.9 → 6 m, laps +7…+23 %);
E3 gas takes its share of rear grip, constant force (spins in EVERY
corner with gas held, all karts). Lesson: the speed dependence must come
from the engine (power ÷ speed) and weight transfer, not from tuning.

### Spec (measured for every variant)
1. Best turning = a small slide (rear slip up to its peak; tightest line
   at ~20–30 % steering stays).
2. Overdoing it = oversteer you can't hold: no held drift > ~0.5 s
   (slip 20–80° above 20 km/h) for any large weave; spinning out is fine.
3. At the cap: low speed + gas → oversteer; high speed → understeer.
   Gas in a corner that still grips → no spin.
4. Normal driving: 15 km/h full lock radius, cornering g, lap times
   (bot) within a few %.
5. Cost: step time per car ≈ today's (bench old vs new).

### Model (established methods)
- **Combined slip, friction ellipse with normalised slip** (Racer
  "Combined slip"; Svendenius, Lund): the rear axle's longitudinal force
  (drive or brake) and lateral force share gripG × rear load; the lateral
  force from the Magic Formula is limited to √((μ·Fz)² − Fx²). Front:
  turning only (no drive; brakes: open question 1).
- **Engine force** = min(today's `acceleration` × mass (low-speed pull),
  horsePower × 745.7 / speed) — the pull falls with speed.
- **Variant B: longitudinal weight transfer** (Beckman, The Physics of
  Racing 1): ΔFz = m · a · h / L to the rear (gas) / front (brake), a =
  the previous step's longitudinal acceleration through a first-order
  lag (no algebraic loop; instant transfer destabilises — gamedev.net
  threads, load-transfer lag in estimator literature).
  Variant A = without it. Both tested, then chosen.

### Values
- CoG height with driver — checked in the sources (Robin asked):
  Mihalić et al., Applied Sciences 2023 (electric go-kart chassis,
  preprint rs-1852791 read in full): hCG ≈ 0.32 m, wheelbase 1.103 m,
  driver 80 kg + a 50 kg kart (driver CoG from body-segment tables). Our
  karts are 3–4× heavier, mass low → lower. Estimate (kart's own CoG
  ~0.15 m, driver ~0.43 m — the pair that gives 0.32 m; assumption):
  Racingkart125cc ~0.29, Hyrkart240cc ~0.25, HyrkartCentralen ~0.23 m.
  Discarded: IJRTI 2025 "0.121 m" (assumed, no derivation); the
  ladder-frame study's 0.30 m only seen in a snippet. Experiments also
  run h ± 0.05 m.
- Lag time constant ~0.05–0.1 s (estimate; no suspension, frame flex).
- Power: Rotax Max Senior 30 hp / 22 kW (sourced); Hyrkart240cc 9 hp
  (Honda GX270 class); HyrkartCentralen 14 hp (unsourced; BSR rental
  e-kart 10 kW / 14 hp for comparison).
- Brakes: all three karts rear only — Racingkart125cc (Rotax Senior:
  front brakes not allowed since the 2013 rules, one organiser); rental
  karts (Robin, 2026-11-10). Braking uses the rear grip budget.

### Open questions (Robin)
- h per kart (estimates above) or one value?

### Steps
- [ ] 1. Scratchpad: A and B on copies; tables per kart vs the spec
      (weave drift, steady corners with gas held, low/high speed at the
      cap, 15 km/h radius, laps, step time). Robin chooses.
- [ ] 2. Robin tries the chosen one in Player mode (test server 8081 /
      App 5174)
- [ ] 3. Real code + docs; `npm run laptimes` → Space (Robin's OK)

### Result (2026-11-10) — variant D + rear-brake limit, in main
Robin drove D in Player mode (worktree ~/Projects/formulai-gripcap, test
server 8081 / App 5175, bucket formulai-test): "good now, hard to test on
a keyboard, but it makes sense". Robin: gas / brake are on / off → their
speed effect stays as today; they only influence turning, scaled.
- Code: `Car.applyControls` gas × √(1 − gripRear²) (E1); `Car.slide(dt,
  controlAccel)`: weight transfer (lag 0.08 s), braking counted at most
  `rearBrakeLimit` = μ·g·(a/L) / (1 + μ·h/L) (first version used μ·g·a/L —
  forgot that braking unloads the rear; Racingkart 0.91 → 0.63 g), brake
  share ≤ 0.5 of the rear grip; `SlipValues.cgHeightMeters`.
- Proof: main = tested D bit for bit before the brake-limit fix; spec
  suite: held drift 2.7–2.9 → 1.0–1.5 s; braking while cornering spins
  from 20 % steering at 40 km/h, 5 % at 60 km/h (≈ 1 g there), high speed
  understeers; speed, 60→0 distance, 15 km/h radius, 45 km/h g unchanged;
  step 0.53–0.94 → 0.57–1.06 µs; speed exploit still fixed.
- Not reached: low-speed power oversteer (sourced engine torque can't beat
  the rear grip on dry tarmac — Rotax 21 Nm, GX270 19.1 Nm); "held drift ≤
  0.5 s" turned out to be a poor metric (it counts slides that are
  scrubbing speed).
- Lap-time bot (`scripts/laptimes.ts`): brakes in a straight line (coasts
  above 0.5 × gripG sideways), braking planned at 0.9 × rearBrakeLimit
  (planning at brakeDeceleration was slower: still braking at turn-in).
  Expected times rise (loops +8–37 %, training mostly < 10 %); Robin OK —
  "this will be handled when we add analog gas and brake".
- Steps: [x] 1 experiments, [x] 2 Robin drove it, [x] 3 real code + docs.
- Next: `longitudinalG` in GameState; later analog gas / brake (trail
  braking) — then revisit BRAKE_GRIP_SHARE and the bot.
