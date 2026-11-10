# CPU: route lookups skip far segments

Started 2026-11-10 (round 2, after `cpu-timer.md`). Docker profile (1 CPU,
40 cars + viewer): `updateDirection` 5.4 %, `updateCompletedMeters` 6.2 %
of server busy time.

## Finding (read, nothing changed)

- Route points every 25 cm on every layout.
- `updateDirection` (GameEngine.ts:293): nearest segment within 10 m back
  and ahead of `nearSample` = ~64–72 segments per car per tick, each with
  Math.hypot.
- `updateCompletedMeters` (GameEngine.ts:359) → `nearestOnLeg`: 10 m ahead
  of `routeSample` = ~32 segments (+ ~20 for the previous leg's last 5 m
  right after a checkpoint).
- A car moves ≤ ~0.3 m (60 km/h) / ~0.5 m (115 km/h) per tick.
- Not one shared lookup: different windows and anchors (`nearSample` both
  ways, `routeSample` only up) → the values would change.

## Idea — exactly the same results

Any point P on segment j (j ≥ i) is at most arcs[j+1] − arcs[i] along
the route from point a_i, so |C − P| ≥ |C − a_i| − (arcs[j+1] − arcs[i]).
With `bound` ≥ the final minimum: if that lower bound > bound + EPS,
segment j is strictly farther than the winner → skip it.

- At an evaluated segment i: dA = hypot(C − a_i); r = dA − bound − EPS;
  r > 0 → jump over every j with arcs[j+1] − arcs[i] < r.
- `bound` = min(seed, best so far). Seed = the segment at the anchor
  (updateDirection: `nearSample`; nearestOnLeg: `from` is already first).
  The seed is only a bound — the scan keeps its order and its strict `<`,
  so the winner (ties: the first index), its arc and its distance are the
  same bits: the winner and every tie have lower bound ≤ final min ≤
  bound, never skipped.
- EPS = 1e-6 px (arcs are sums of sqrt lengths; rounding ~1e-9 px).
- Shared helper for both (updateDirection's loop and nearestOnLeg).

## Plan

- [x] 1. Worktree `~/Projects/formulai-route`, branch `perf/route-lookups`
      from main (separate from the timer branch)
- [x] 2. The change in GameEngine.ts (one helper, both callers)
- [x] 3. Proof A (unit): old vs new lookup on every layout, millions of
      centres (on and around the route, random anchors, both functions'
      windows) → bestDist / arc / seg bit-identical; count segments
      evaluated old vs new
- [x] 4. Proof B (end to end): headless lockstep run, same bot controls,
      every GameState of every car hashed, main vs worktree → same hash
- [x] 5. Docker profile (1 CPU, 40 cars + viewer) old vs new
- [x] 6. Robin checks → commit e9ab942 (as Robin)

## Results

- Proof A (real methods of main / worktree / a broken copy with EPS =
  −20 px, seeded cases on all 15 layouts): 1,500,000 cases, worktree 0
  diffs on all 7 fields (Object.is); broken copy 1,207,634 diffs.
- Proof B (headless lockstep, 40 cars, 3 karts, bot, every GameState of
  every car every tick hashed, TrainingLong 3000 ticks): same hash
  8319eb80383dca3fba8e9c52621601a96ad523e9. Route methods 221 → 163 ms.
- Docker (1 CPU, 40 cars + viewer, inclusive share of busy):
  updateDirection + updateCompletedMeters 9.4 / 9.6 % (two main runs) →
  5.2 % (worktree). docker stats too noisy for this size.

Practical check, both changes together (combo worktree, server 8081,
App 5175): lobby viewer 40 cars 20.0 frames/s, every frame 3 ticks
apart, no console errors; Player mode gas / coast / R / finish →
auto-advance OK; leave → pause → rejoin ×3: 60.0 steps/s, tick 0, no
states while away. Robin drove Player mode: "it felt good".
