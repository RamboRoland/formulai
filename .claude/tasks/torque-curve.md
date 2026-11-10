# Torque curve per kart

Robin (2026-11-10): "do you think the 270cc has correct acceleration" → "look at the torque
curve" → "I want it as accurate as possible" → "make sure each car can have its own curve".
Status: PHASE 1 built 2026-11-10 — waiting for Robin to drive it. Above the chart: option a
(Robin): last value + the power limit = constant power. Worktree `~/Projects/formulai-torque-curve`
(branch `feat/torque-curve`), test servers on 5174 / 8081 only.

## Findings (scratchpad: clutch.js, curve.js, dl/gx270.png)
- Today (`Car.longitudinal`): flat `torqueNm` at every speed, capped by `powerW / v`.
  270cc: 19.1 Nm up to ~56 km/h, then 6.3 kW; 0–20 4.0 s, 0–40 8.4 s, 0–60 13.5 s.
- Honda GX270 net torque, read from Honda's own chart
  (services.powerequipment.honda.com/content/images/ee/models/curves/gx270.gif, linked from
  engines.honda.com/models/model-detail/large-gx): 2000 rpm 18.6 Nm, 2500 19.1, 3000 18.5,
  3500 ~17.2, 3600 ~16.8. Power on the same chart: 3.9 / 5.0 / 5.8 / – / 6.3 kW (matches
  torque × ω). Nothing below 2000 rpm (Honda's operating range 2000–3600).
  Spec sheet (lsengineers.co.uk GX270_T2_UT2_SPEC.pdf): governor 3850 ± 150 rpm, idle 1400.
- The curve is nearly flat (2000 → 2500: +3 %) → it does NOT give "slow start, then ramps up".
  Honda's curve: 0–20 4.2 s, 0–40 8.6 s, 0–60 13.9 s; the pull falls all the way
  (0.136 g at 10 km/h → 0.066 g at 70).
- Centrifugal clutch (shoe clutch, capacity ∝ ω² − ω_engage²) only adds a 0.1–0.35 s pause
  before the kart moves; while it slips the engine settles where clutch = engine torque
  (≈ the same torque). Not in this plan (values would be estimates).

## Design
`DriveValues` (Car.ts) gets an optional curve; the kart files set it:
```ts
torqueNm: number;              // peak; no curve → flat up to the power limit
// Engine torque over engine speed [rpm, Nm], rpm rising (the maker's chart). Linear between
// the points; below the first → the first value (the clutch slips there), above the last →
// the last value, still capped by powerW. Not set = flat torqueNm.
torqueCurve?: [number, number][];
```
- `Car.longitudinal`: engine rpm = v / wheelRadius × gearRatio × 60 / 2π; torque =
  `torqueAt(curve, rpm)` (a small exported pure function) or `torqueNm`; the rest unchanged
  (`pull = min(torque × ratio × η / r, powerW × η / v)`).
- Above the last point: last value capped by powerW → constant power, no invented numbers.
- `torqueNm` stays (peak, documentation, karts without a curve). Kart files only.
- Cheap: one interpolation over ≤ 10 points per tick per car.

Per kart:
| kart | curve | why |
|---|---|---|
| Hyrkart270cc | Honda chart (above) | sourced |
| HyrkartCentralen | none | electric IPM in torque mode: flat torque, then power = today's model |
| Racingkart125cc | none for now | only peaks known (21 Nm @ 9000, 22 kW @ 11,500); a curve when a Rotax chart is found |

## Phases
### Phase 1: curve support + 270cc curve
- [x] Worktree + branch
- [x] `DriveValues.torqueCurve`, `torqueAt`, `Car.longitudinal` uses it
- [x] Hyrkart270cc: Honda's points, source comment
- [x] Proof (scratchpad proof.ts, the real Car classes, 60 Hz, full gas, straight): Centralen +
      Racingkart IDENTICAL; 270cc old → new 0–20 4.05 → 4.17, 0–40 8.37 → 8.63, 0–60 13.48 →
      13.92, 0–80 26.10 → 26.55 s; top 80. torqueAt checked at 0 … 4500 rpm.
- [x] Type-check server (tsc OK); CLAUDE.md "Car Physics" (worktree .personal) + README 0–60 13.9 s
- [ ] Robin drives it in the worktree (5174 / 8081)

### Phase 2: after Robin's OK
- [ ] Merge, `npm run laptimes` (dry run first; `-- --yes` only with Robin's OK), deploy

### Later (separate, Robin decides)
- Gearing: Honda's curve ends at 3600 rpm (governor 3850), the game reaches 80 km/h at
  4500 rpm (ratio 3.09). Real top speed or sprockets needed.
- Racingkart125cc curve (Rotax chart), centrifugal clutch.
