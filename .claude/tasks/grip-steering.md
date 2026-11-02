# Grip-limited steering (turn rate depends on speed)

Robin (2026-10-29): "rotate based on speed for each kart". Today the turn
rate is the bicycle model capped by a fixed `rotationSpeed` (°/s) → at
speed every kart turns far harder than tyres allow (HyrkartCentralen at
60 km/h: 240°/s = 7 g sideways).

## Decisions
- Max turn rate = min(steering geometry, grip):
  geometry = |v| / wheelbase × tan|wheelAngle| (as today),
  grip = gripG × 9.81 / |v| (rad/s; v in m/s). Same direction rules as
  today (sign of wheelAngle × sign of speed; speed 0 → no turn; reverse
  uses the same limit).
- `rotationSpeed` REMOVED (Car + every kart), replaced by `gripG` per kart.
- Values (estimates; swap for real ones later): HyrkartCentralen 1.2,
  Hyrkart240cc 1.2, Racingkart125cc 1.8.
- Below ~16–19 km/h nothing changes (geometry decides); above, the
  faster the less it turns (HyrkartCentralen 60 km/h: 40°/s, r 23.6 m).

## Phase 1: code
- [x] 1. `Car.gripG` (abstract) replaces `rotationSpeed`; `Car.steer`
      rate = min(geometry, grip); comments
- [x] 2. The 3 karts: `rotationSpeed` → `gripG`
- [x] 3. Comments in `app/types.ts` + `components/controls/types.ts`
      ("× the car's rotationSpeed" is already outdated: steering × lock)
- [x] 4. tsc clean + scratch test: per kart, full lock at 10/20/30/60/top
      km/h → turn rate + radius = the table (old vs new: same below the
      crossover, grip-limited above); rear-axle pivot unchanged
      → 69 ok / 0 FAIL (both sides, forward + reverse, speed 0 no turn)

## Phase 2: try it
- [x] 1. Claude browser check: single player, real keys (W, then D at
      ~20 km/h): 123°/s measured vs 122°/s expected, no console errors
- [ ] 2. Robin drives it (feel, corner speeds)
- [x] 3. Docs: `.personal/CLAUDE.md` steering section (README has none)
- [ ] Note: expected lap times may need new values (and the old
      `GokartGokartCentralen` keys in the track files are still open)
