# Lift-off spin (coasting in a corner)

Robin (2026-11-10): "why does the car slide around when you release the gas and is turning; there
shouldn't be a problem coasting". Branch fix/lift-off-slide (worktree ~/Projects/formulai-lift-off).

## Findings (scratchpad: liftoff*.ts, liftdebug.ts, sensitivity.ts, steadylift*.ts, kbdlift.ts)
- Cause: lifting swings the along-track acceleration (e.g. +0.13 → −0.21 g) → weight transfer
  m·a·h/L moves ~200 N off the rear (−13 %) onto the front (+20 %); at the limit the rear saturates
  → spin (fixed steering). With weight transfer off: 3–5°.
- Not the cause (tested): rear braking share counting drag / scrub (fixed anyway: more correct),
  lift-off braking (regen / engine braking), any estimate within its range (slideGrip, yawInertia,
  cgHeight, liftG, peakSlip), tyre load sensitivity at realistic values.
- From a TRULY steady corner, a lift with fixed steering is fine up to ~75–90 % of the grip for
  every kart (270cc never spins); above that it spins = lift-off oversteer near the limit, which a
  driver catches by hand. Not proven unrealistic → physics kept.
- Keyboard: the steering aid (wheel angle for max grip) keeps the kart at ~95–100 % of grip, and
  steers further in as the speed drops after the lift → nearly every lift spins. Aiming the aid
  at 80–90 % of its angle doesn't help (still ~1.05 g: the angle limit is past grip saturation).

## Decisions (Robin)
- "do what is most realistic and we make the keyboard assists for what I need".
- Physics: load sensitivity (rental −0.10, slicks −0.15, estimates: no kart data found; Milliken
  RCVD example −0.12 checked; FSAE 10" −0.147 snippet) + rear braking share = rear-axle forces only.
  Effect: turning circle / braking distance unchanged; keyboard brake cap holds one step further in
  bends; lift at the limit unchanged.
- Keyboard stability assist (App, next): steering aims at ~85 % of grip using the state's
  gripFront / lateralG; countersteer when the rear steps out (slipAngle / yawRate). Target: keyboard
  lift simulation 0 spins, then Robin drives. Agents keep the pure physics.
- Not done: per-wheel lateral load transfer (kart roll distribution unpublished → guesswork).

## Done (branch fix/lift-off-slide)
- baf4eca fix(physics): rear-axle braking share + load sensitivity (laptimes dry run −5…+1 %).
- Keyboard stability aid (App, uncommitted): steering trimmed while state lateralG > 0.85 (−4/s,
  back +1/s, min 0.2), countersteer 1.5 × (slip − 3°) / wheelLock, fed by evt:player/state.
  Tuned in scratchpad/assist.ts (target 0.8 / 0.85, trim 4 / 6, gain 1 / 1.5 → 0.85 / 4 / 1.5 the
  only one with no spin at all and 81–87 % grip). The App's real class (byte-identical copy,
  kbdreal.ts) vs physics, lift at 20–80 km/h: no spin for any kart (max slip 1–15°), corners at
  81–88 % grip. Chrome: at 36 km/h D sends 0.46 (= the limit) → 0.43 as the trim acts; no errors.
- Robin drove it: "it's good for keyboard". DEPLOYED 2026-11-10 (cbd3967, run 42853496055); laptimes written (27 values); hosted restarted; README eedbf32 (local, unpushed); local fetch + docker compose up --build server app.
