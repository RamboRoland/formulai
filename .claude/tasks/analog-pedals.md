# Analog gas / brake + smooth keyboard handling

Status: DONE 2026-11-10 — deployed (91462a5), laptimes written to the Space (45 values, 5 tracks), hosted server restarted, README table b4fa256 (local, unpushed).
Worktree: `~/Projects/formulai-analog-pedals` (branch `feat/analog-pedals`),
test servers on 5174 / 8081 only.

## Decisions (Robin, 2026-11-10)

- Gas + brake together: BOTH act (net = gas drive − brake), trail braking possible.
- Keyboard smoothing: App only (keyboard = a slow input device). Server = pure physics.
- Keyboard steering: speed-sensitive assist in the App (target lock shrinks with speed, ramped).
- `BRAKE_GRIP_SHARE` cap (0.5) removed: pure friction ellipse, brake × force takes its real
  share of the rear grip (up to all of it).

- Gas model: FORCE MODEL (Robin chose it over "gas × maxSpeed" speed demand, for realism).
  Pedal = force, as real throttles (EV controllers torque mode; petrol throttle → torque):
  ```
  F_drive  = gas × min(F_max, P_max / v)     torque-limited low, power-limited high
  F_resist = Crr·m·g + ½·ρ·CdA·v²            rolling + air drag (+ engine braking, coast)
  F_brake  = brake × F_brake_max             capped by rearBrakeLimit (exists)
  a        = (F_drive − F_resist − F_brake) / m
  ```
  Part throttle settles by itself; top speed = drive / drag balance; rental karts keep a
  governor at the published maxSpeed. Full-throttle curve + lap times WILL change.
  Source: Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3. Per kart values (power, CdA,
  Crr, F_max, engine braking) researched + cited, estimates marked, before coding phase 2.

## Phase 2 research (2026-11-10; research agent, key sources re-read by me in the PDFs)

Checked (H): Rotax RM MAX evo manual — "Engagement speed approx. 4000 rpm", centrifugal
clutch → roller chain (NOT direct drive; the kart comment / docs are wrong); 13,500 rpm max
under load; 22 kW @ 11,500, 21 Nm @ 9000 (datasheet). BSR R3 rental e-kart sheet: 10 kW /
14 hp nominal, 12 kW boost, 60 Nm motor, 180 Nm axle (3:1), 4000 rpm max, 85 km/h "gear ratio
dependent", 0–60 in ~4–5 s, adjustable regen. Tor Vergata CFD (Fluent, 90 km/h, seated
driver): D 173.35 N, cd 0.794 → CdA 0.45 m² (ρ 1.225 assumed), driver = 33 % of drag.
Honda GX270 brochure: 6.3 kW net @ 3600, 19.1 Nm @ 2500.
Not findable: Sodi RSX2 power / ratio / regen / mode speeds; GX270 rental governor + sprockets;
a measured kart Crr (SAE 2021-01-0936 paywalled); Rotax engine-braking force.
Estimates: Crr 0.02 rental / 0.018 slick; CdA 0.55 rental (bumpers, upright); chain η 0.90–0.95.

Model result (scratchpad/longi.py, full gas, straight line):
| kart | F_max | 0–top today | 0–top new | coast 80 % top → 0, today / rolling+air only |
|---|---|---|---|---|
| Centralen (42 Nm × 3:1 EST) | 0.32 g | 0–60 4.0 s | 6.5 s (ratio 3.66: 5.8 s) | 6.9 s / 50 s |
| 240cc (ratio 2.47 for 80 @ 3600) | 0.13 g | 0–80 10.0 s | 31 s (!) | 10.7 s / 57 s |
| Rotax (13/77) | 0.53 g | 0–100 4.5 s | 6.2 s | 11.5 s / 67 s |
- Part gas settles: 240cc 25 % → 22 km/h, 50 % → 57; Rotax 25 % → 91; Centralen 25 % → 58
  (lots of power headroom under the 60 km/h limit).
- 240cc at "close to 80": 9 hp barely gets there (power/drag top 86 km/h). Geared for 60–65:
  0.16–0.17 g, 0–60 ~13 s.
- Today's coasting (6–8 km/h/s) is 3–5× rolling + air drag → it was hidden engine braking.

Robin (2026-11-10): coasting per drivetrain; Sodi ratio 3.66; 240cc "peaks at 80 at the
venue" (driven it). Torslanda GP check (scratchpad/torslanda.ts, gx2.py): from the slow corner
before the last one (~35 km/h), stock GX270 6.3 kW reaches 67 at the line, 73 turn 1, ~78 turn
2, 80 before the hairpin → sourced engine matches; no tuning.
Side finding — CLOSED 2026-11-10: Torslanda GP turn 1 (88°, 8–9.5 m wide, centreline R ≈ 22 m).
Flying lap (scratchpad/t1fly.ts): 270cc arrives ~71 km/h (not 80); forced full throttle on the
CENTRELINE runs off at the grip limit (latG 1.12 / 1.15). Racing line (outside–apex–outside, ~7 m
usable): R ≈ 18.5 + 7 / (1 − cos 44°) ≈ 43 m → 71 km/h needs ~0.92 g → flat out holds (Robin: "it
should only be able to hold full throttle"). Physics + track fine.
NOTE (idea, later): the lap-time bot drives the centreline → brakes where a driver on a line stays
flat; expected lap times are conservative. A racing-line bot (uses the track width) would give
tighter times and a better agent benchmark — a real task, not a quick fix.

## Phase 2 spec (to approve)

Per kart `drive: DriveValues` (replaces acceleration / deceleration / horsePower and the
per-kart accelerate / reverse / brake / rolling methods; one implementation in Car):
| | Centralen (Sodi RSX2) | 240cc (Caroli, GX270) | Racingkart (Rotax Senior) |
|---|---|---|---|
| torque | 42 Nm (venue, H) | 19.1 Nm (Honda, H) | 21 Nm (Rotax, H) |
| power | 10 kW (EST, BSR R3 analog) | 6.3 kW net (Honda, H) | 22 kW (Rotax, H) |
| ratio | 3.66 (EST: 4000 rpm at 60) | 3.09 (EST: 80 at 4500 rpm) | 77/13 = 5.92 (M) |
| chain / drive η | 0.95 (EST) | 0.90 (EST) | 0.95 (EST) |
| rear wheel radius | 0.1455 m (Sodi, H) | 0.1455 m (same tyres, H) | 0.14 m (D5, M) |
| top speed cap | 60 controller (venue) | 80 governor (venue + Robin) | 115 (today; rev limit 13,500 → ~120) |
| CdA | 0.55 (EST) | 0.55 (EST) | 0.45 (CFD, M) |
| Crr | 0.02 (EST) | 0.02 (EST) | 0.018 (EST) |
| lift-off braking | regen 0.10 g (EST) | 0 (clutch freewheels, EST) | 0.05 g above ~36 km/h (clutch locked, EST) |
Brake force: brake × brakeDeceleration × mass (today's values, unchanged).
```
v = speed (m/s), m = slip.massKg
F_max   = torque × ratio × η / r
drive   = gas × min(F_max, power × η / v) × √(1 − gripRear²)   (grip cap stays)
resist  = Crr·m·g + ½·1.225·CdA·v² + (1 − gas) × liftG·m·g      (lift: Rotax only above clutch speed)
brakeF  = brake × brakeDeceleration/3.6 × m
a = (drive − resist − brakeF) / m; speed ≥ 0 when going forward, ≤ cap
```
- Gas + brake both act; gas wins over reverse; reverse = backward × F_max (kinematic, as now, cap
  maxSpeed / 2).
- `slide`: BRAKE_GRIP_SHARE removed → brakeShare = min(1, braking / rearGrip).
- Simplification: no engine torque curve (flat torque, then power), no clutch slip below
  engagement (Rotax "slow 0–20" not modelled).
- Rotax comment fixed: centrifugal clutch ~4000 rpm + chain, not direct drive.

Proof (scratchpad, then real code): straight-line table per kart (0–30/60/top, part-gas settle
speed, coast times, 60→0 braking distance unchanged); turning circle 15 km/h unchanged; braking
while cornering (spin threshold vs main); step-time bench; `laptimes` dry run (times WILL go up).

## Phases (each: proof on copies, old vs new, Robin verifies before the next)

### 1. Protocol + server input (no behaviour change)
- [x] `protocol/agent.ts` (both copies): `forward`, `backward`, `brake` → `number` 0–1 (doc: `true` = 1).
- [x] `FormulaiServer.toCarControls`: boolean → 1 / 0, number → clamp 0–1, else 0.
- [x] `game/types.ts` `ControlsState`, `LobbyGame.IDLE`: numbers.
- [x] `Car.applyControls`: `> 0` where it reads booleans today → identical behaviour.
- [x] Proof: `laptimes` dry run main vs branch — all 54 times identical (bot sends 1 / 0 now).
      Callers converted `? 1 : 0`: laptimes, testAgent, SinglePlayerView. HudStats stays boolean
      (`> 0`) until phase 4. Not tested over a live socket yet (toPedal: boolean → 1/0).

### 2. Physics (server) — done as the force model ("Phase 2 spec" / "Phase 2 result" below)
- [x] Kart methods take an amount: `accelerate(dt, amount)`, `reverse(dt, amount)`, `brake(dt, amount)`.
- [x] `applyControls`: gas (or reverse, gas wins) AND brake act in the same tick; coast when
      neither (or per the open question).
- [x] The gas grip cap (√(1 − gripRear²)) stays, on the scaled drive.
- [x] `slide`: remove `BRAKE_GRIP_SHARE`; brakeShare = min(1, braking / rearGrip).
- [x] Proof: 1 / 0 inputs vs main — straight-line speed / braking distance / turning circle
      unchanged; braking while cornering changes (expected, measured, shown).
- [x] `npm run laptimes` DRY RUN (no `--yes`) — compare with today's table.

### 3. Keyboard (App, `KeyboardControls`)
- [x] W / S / Space ramp 0 → 1 while held, back to 0 when released (rates to agree, start ~0.3 s
      gas, ~0.5 s brake, release faster).
- [x] A / D: target = ±assist(speed), ramped; assist from the player's own state speed.
- [x] `SinglePlayerView`: send controls every frame while a value is moving (today only on change).
- [x] Self-test in Chrome (crops), then Robin drives.

### 4. HUD
- [x] `HudStats` forward / backward / brake → numbers (both protocol copies), `Lobby` sends them.
- [x] `RacingView` bars fill by the amount; gear logic unchanged.

### 5. Docs
- [x] `.personal/CLAUDE.md` (controls, grip cap text, panel), `.personal/websocket.md`,
      `docs/agent-protocol.md` (analog values; booleans still accepted). + README "Cars".
- [ ] Re-run laptimes with `--yes` ONLY after Robin says so — after merge + deploy (the hosted
      server runs main's physics until then); then the README "Tracks and layouts" table.

## Phase 2 result (2026-11-10, scratchpad/pedals.ts + circle.ts, real Car code, main vs branch)
| | Centralen main → branch | 240cc | Racingkart |
|---|---|---|---|
| 0–60 | 4.0 → 5.8 s | 7.5 → 13.5 s (0–80 10 → 25.4) | 2.7 → 3.4 s (0–115 5.2 → 7.7) |
| gas 0.25 / 0.5 settles | 2.5 / 60 km/h | 32.6 / 64.4 | 74.6 / 112.1 |
| coast 80 % top → 1 km/h | 6.7 → 10.5 s | 10.5 → 57 s | 11.4 → 56 s |
| brake 60 → 0 | 12.4 → 11.0 m | 14.1 → 13.6 m | 14.1 → 13.2 m (drag + lift-off now add) |
| 15 km/h full lock R | 1.75 → 1.74 m | 1.78 → 1.79 | 1.51 → 1.53 (unchanged) |
| full brake at 40 km/h spins from steering | 0.10 → 0.05 | 0.10 → 0.05 | 0.15 → 0.05 |
| applyControls | 0.51 → 0.54 µs | 0.86 → 0.88 | 1.00 → 1.02 |
- Centralen 25 % gas ≈ standstill: regen (1 − gas) × 0.1 g ≈ the pull at 25 % (one-pedal feel).
  → Robin: lift-off only near zero gas. LIFT_OFF_FADE 0.1 (full at 0, gone at 10 % gas): Centralen
    0.1 / 0.25 gas → 31 / 58.7 km/h; 240cc 0.1 gas → 0 (pull 37 N < rolling 45 N); Rotax 0.1 → 46.
- Robin: full brake spinning with locked rear wheels stays (physics); say so in the agent docs.
- Full brake = brakeShare 1 = rear grip all braking (locked rear) → any yaw spins.
- laptimes dry run: rental karts slower (240cc +5…+31 %), Racingkart faster on long GPs
  (Torslanda GP 97.9 → 86.5, Skovde 86.3 → 78.3) — likely: the bot coasts through corners, and
  coasting no longer bleeds 8 km/h/s (not proven).
- Later task: rename Hyrkart240cc → Hyrkart270cc (Robin 2026-11-10; data key: sessions, tracks in
  the Space, karts API, agents).

## Phase 3 result (2026-11-10)
- Robin: kart handling from the server (`res:player/join { handling: KartHandling }`, both
  protocol copies); ramps gas / reverse 0.3 s, brake 0.6 s, release 0.1 s.
- Steering aid (App): limit = (wheelbase · gripG · g / v² [rad → °] + peakSlipDeg) / wheelLock,
  ≤ 1; Centralen 10/20/30/40/50/60 km/h → 1 / 0.93 / 0.55 / 0.42 / 0.36 / 0.33. The server's
  steeringRate still turns the wheel. (A swept "tightest steering" measurement was too noisy:
  slides scrubbing speed.)
- Live check (server 8081 + App 5175; 5174 was main's App, left alone): join gets handling;
  gas 0.5 → 6.1 km/h after 1 s vs gas true 14.4 (old agents still work). Chrome, real key events:
  gas 0.33 / 0.67 / 1.0 at 0.1 / 0.2 / 0.3 s; Space tap 100 ms → brake 0.17; D at ~40 km/h →
  steering 0.40; release → 0; 68 messages in 5.2 s (only while values move).
- Worktree app/ now has its own node_modules (npm ci); Vite refused the symlink into main.

## Brake rework (2026-11-10, after Robin drove: "the second I hold brake I spin"; "karts are very sensitive on the brake")
- Found: the brake took speed off at brake × brakeDeceleration (up to 1.13 g) though the rear
  tyres stop at ~0.53 g (bug carried over from main) → locking stopped twice as hard as allowed.
- Fix (Car.longitudinal + slide): brake + lift-off braking go through the rear tyres, at most
  rearBrakeLimit; asking more = locked → slideGrip × it, and a locked rear's force points against
  its sliding (Coulomb) → sideways only as much as it slides sideways.
- `Car.brakeLock()` (brake at which the rear locks with the gas up, lift-off counted) →
  `handling.brakeLock`; keyboard aid: held Space ramps (0.6 s) to 0.8 × brakeLock.
  brakeLock 0.38 / 0.54 / 0.59 → keyboard 0.30 / 0.43 / 0.47.
- 50 km/h, straight → 0: keyboard cap 23.4 / 24.9 / 22.3 m, full (locked) 23.4 / 23.8 / 21.7
  (same 0.6 s ramp; best threshold 240cc 0.5: 22.0, Racingkart 0.6: 19.8). Bend: keyboard cap holds
  at 2 % steering (all) / 3 % (Racingkart), spins from 3–5 %; full brake spins from 2 %.
- Robin drove it (2026-11-10): "that is fine for keyboard" — accepted.
- Laptimes bot: done, see below.

## Phase 4 result (2026-11-10)
- HudStats / PressedControls pedals are numbers (both protocol copies); Lobby sends the car's
  controls as they are. Bars: GAS = forward, else backward; BRK = brake (both can show at once).
- Chrome: lobby viewer following a test agent (gas 0.5, brake 0.25) → GAS 50 %, BRK 25 % (kart
  holds still: brake 740 N > gas 500 N). Player mode, real keys: W 120 ms → GAS 40 %, 500 ms → 100 %;
  W + Space → BRK 30 % (Centralen cap) + GAS 100 %; released → 0 / 0.

## Laptimes bot (2026-11-10)
- Brake 1 now locks the rear → bot brakes analog. First try (press 0.9 × brakeLock, plan 0.9 /
  0.8 × rearBrakeLimit): Racingkart no clean run on 4 GPs / Järfälla GP 101.5 s (slower than the
  Centralen). Traced (scratchpad/botdebug.ts): (1) braking while still at ~0.67 g sideways — the
  old "brake below 0.5 gripG sideways" gate was tuned for the 0.5 brake-grip cap → brake ×
  √(1 − gripRear²) (as the gas); (2) rear-brake instability: at 0.9 × lock a small yaw grows
  (rear ~44 % sideways grip left), the pure-pursuit bot countersteers too late.
- Final: press 0.7 × brakeLock × √(1 − gripRear²), plan 0.65 × rearBrakeLimit. All clean.
  Racingkart Järfälla GP 77.2 → 79.3, Torslanda GP 97.9 → 83.0; Centralen −2…+12 %;
  240cc +0…+32 % (short one-ways: acceleration from standstill, 0.16 g pull). NOT written.

## Review
(after the work)
