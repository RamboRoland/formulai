# Two-wheel rear axle (2026-11-11 — CLOSED after phase 0: no-go)

**Closed (Robin agreed 2026-11-11):** the pivot stays open, "needs data".
The deployed model stays. Next: real data — phone logs at Torslanda
(`.claude/tasks/kart-measurement.md`) and live incident logs
(`.claude/tasks/incident-logs.md`).

Robin 2026-11-11: start phase 0 (mechanic, read-only, scratchpad
`mechanic/v3/`). Not yet pushed on main: README b1d1f34. Robin: README
updates OK, but NO push until this project is done (one push / deploy
at the end).

Why: the braking-spin fix (`.claude/tasks/braking-spin.md`) left one
target open — a light brake tap at LOW speed (25–40 km/h, hairpins)
should rotate the kart a little (Robin's main point), growing with the
tap, catchable. With the rear as ONE tyre plus added moments (spool,
outer-wheel brake), one quantity holds push, C1 catching, event #10 and
75 km/h braking together; every tuned lever that gives the pivot breaks
one of those (mechanic's search: axleStiffness, outer-brake factor,
speed-faded moment, capLat). At 25–30 km/h nothing rotates below 0.95 ×
lock at all. Hypothesis (UNVERIFIED): the pivot comes from the two rear
wheels' interaction on a rigid axle — load, longitudinal slip, braking
and side force per wheel — which today's lumped model can't express.

Robin's rules: physical and sourced first, tuned only with his OK; ALL
earlier tests keep passing (within small margins) — `runall.sh` incl.
the pivot scenarios; phases with proof; no commit until all pass.

## Model (established: Milliken RCVD ch. 20 spool; Pacejka ch. 4
combined slip; Gillespie ch. 3)

- Rear = left + right wheel on one axle turning at ω (one state, or
  quasi-static: the ω where the two longitudinal forces + brake torque
  balance — check which is stable at 60 Hz × 8 substeps).
- Per wheel: load (static share ± lateral transfer from roll + jacking,
  ± longitudinal), longitudinal slip κ = (ω·r − v_wheel) / v_wheel with
  v_wheel = vx ∓ r·track/2, slip angle from its own velocity, combined
  slip (friction ellipse per wheel or Pacejka's G-functions), brake
  torque shared through the axle.
- Lift = a wheel's load reaches 0 (replaces rearLift's lag? keep a frame
  lag) — the spool moment and the outer-wheel brake moment then come
  OUT of the per-wheel forces instead of being added terms.
- Drive torque through the same axle (gas): the "loose on power with the
  inner wheel up" effect comes for free — must not break coasting / gas
  tests.
- Low speed: per-wheel κ needs the kinematic blend (exists) or a
  relaxation length.

## Phases (each: proof on copies, full suite, Robin OK before the next)

0. Read-only prototype in the scratchpad (mechanic): implement on a copy,
   run runall.sh + tapgrid + pivot.ts. Go / no-go: does the pivot appear
   at 25–40 km/h with everything else passing? If no-go: stop, report.
1. Port to `Car.slide` behind no flag (replace spool + outer-brake terms),
   identical proof as the braking-spin fix (driver scenarios, sweeps,
   events, lap-time dry run).
2. Docs (agent-protocol, README, .personal), commit, then merge / lap
   times / deploy — each with Robin.

## Phase 0 result (2026-11-11): NO-GO

Mechanic, scratchpad `mechanic/v3/` (rv3.txt, cpu.ts): left + right rear
wheel on one axle ω (I = 0.1 kg·m², semi-implicit; quasi-static variant
DYN=0), per-wheel load (lagged roll + jacking), contact speed vx ∓ r·T/2,
κ, isotropic combined slip (κpk 0.12 estimate), brake as friction on ω
(lock = ω 0), yaw from −b·ΣFy − T/2·(Fx_R − Fx_L).
- Pivot: 270cc wheel 40°: 0° up to 0.7 × lock at 25–40 km/h, then 10–44°
  at 0.85 (cliff, as today); P1–P10 same as today. κpk 0.06–0.3 / I
  0.05–0.15: no 3–10° at 0.3–0.6 × lock.
- Broke: gas with the inner rear up (all drive through the outer wheel →
  "loose on power" spins: 270cc steady 65 km/h ≥ 15°, Racingkart coast /
  gas), C1 270cc 54°, Racingkart S2 / H1–H3 / C1, 75 km/h braking from
  0.4 × lock, event #6 33°. CPU 1.35 → 3.4 µs (dynamic), 11.7 µs (QS).
- Why: front saturates at hairpin wheel angles, rear has grip spare; a
  light brake on a solid axle yaws against the turn (now from per-wheel
  forces). The lumped model was already a faithful summary → hypothesis
  rejected. Note: today's drive cut √(1 − gripRear²) is NOT physical but
  hides the one-wheel-drive spin.
- Needed for a pivot: the rear (not the front) as the limit at hairpin
  angles — e.g. front saturating later (front peak slip / Ackermann /
  toe) or a weaker axle moment at low speed — both need kart DATA (tyre
  slip stiffness, or a video of a real 270cc brake-tap with its steering
  angle). Lower wheel angles (15–25°) already tested by me: no rotation.

## Test drive on TrainingLong's GP layouts (2026-11-11, current main)

Robin: "test drive it on one of the GP layouts at Training Long". Script
scratchpad `testdrive/hairpins.ts <kart>` (real LobbyGame headless, the
lap-time bot's line + plan, tracks read-only from the Space; hairpins =
plan corner speed < 43 km/h; tap at turn-in 0.35 s × brakeLock). 270cc,
5 layouts, 9–18 hairpins each, 19–46 km/h:
- Rotation ≤ 1.5° at every tap 0–0.85 × lock (one 3.0° — Skövde H1 at
  0.85); yaw/asked rises a little (e.g. 0.73 → 0.84).
- Taps only slow it: Lycksele 69.35 → 74.23 s, Jarfalla 82.85 → 86.18.
- Light taps (0.25 / 0.4) ran wide into the edge twice (Luleå H10,
  Torslanda H7) — not a spin (rot ≤ 0.6°).
→ Confirms the synthetic tests on real hairpins: no brake-tap pivot.

Open: per-wheel values (rear tyre longitudinal stiffness — no kart
data, estimate), axle rotational inertia (ω state), CPU cost (2 wheels ×
8 substeps × 40 cars — measure; CPU round 2 is pending).
