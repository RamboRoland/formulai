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
