# CPU: timer aimed at the next step

Started 2026-11-10. Production (1 vCPU Droplet): one client with 40 cars +
one viewer → ~31 % CPU (deploy-server-1 23.75 %, caddy 4.12 %).

## Finding

Local profiles (60 s, `--cpu-prof`): 1 car 8.3 s busy, 40 cars + viewer
10.3 s busy — ~80 % is a fixed cost, not the cars. ~45 % `(program)`
(native, outside JS) + ~8–12 % Node timer internals. `LobbyGame` runs
`setInterval(onTimer, TIMER_MS = 4)` = 250 wakeups/s for 60 steps/s.
Physics (castRay 6.6 %, isOnTrack 3.6 %, updateDirection 3.4 %) is the
smaller part — a later round.

## Plan

- [x] 1. Baseline on main (local, port 8081): 1 car and 40 cars + viewer —
      CPU (process.cpuUsage), wakeups/s, steps/s, step lateness
      (p50 / p99 / max vs the ideal 1/60 s grid) — preload probe, no code
      change. No GameState hash: the engine isn't touched, only when
      step() is called
- [x] 2. Worktree `~/Projects/formulai-timer` (8081 / 5174): `LobbyGame`
      replaces the 4 ms setInterval with a setTimeout aimed at the next
      step's due time. Accumulator, MAX_CATCH_UP_STEPS, steps unchanged
- [x] 3. Proof old vs new (same probe): 60 steps/s, lateness not worse,
      wakeups ~60/s, CPU before / after
- [x] 4. Robin checks the numbers → commit 4e2f617 (as Robin), docs ("Game Loop"
      in `.personal/CLAUDE.md`)
- [ ] 5. After deploy: `docker stats` on the Droplet vs 23.75 %

## Results

Baseline, main (local Mac, `process.cpuUsage`, steady 10 s windows):
1 car + viewer: ~224 wakeups/s, 60.0 steps/s, ~29 ms CPU/s, lateness
spread p50→p99 ~2.3 ms. 40 cars + viewer: ~225 wakeups/s, 60.0 steps/s,
~76 ms CPU/s, p50 1.8 / p99 4.1 / max 8.7 ms. → the fixed part is ~40 %
(not 80 % — the profiler's busy time included ts-node + its own cost).
Probe: re-anchor the ideal grid after dropped catch-up steps.

Old vs new (worktree perf/lobby-timer, same probe, windows 2–6):
40 cars: wakeups 225 → 62, steps 60.0 both, CPU 76.8 → 80.6 ms/s (noise
±10, no measurable gain), spread p99−p50 ~2.3 → ~1.5–2.4 ms.
1 car: wakeups 223 → 66, CPU 30.6 → 23.3 ms/s (−24 %), spread ~2.3 →
~1 ms. No dropped steps. Lobby stops: last window new 31 wakeups / 30
steps (timer stopped with it). → the 40-car cost is per car on the Mac;
the Droplet gain is unknown until deployed.

Practical check, both changes together (combo worktree, server 8081,
App 5175): lobby viewer 40 cars 20.0 frames/s, every frame 3 ticks
apart, no console errors; Player mode gas / coast / R / finish →
auto-advance OK; leave → pause → rejoin ×3: 60.0 steps/s, tick 0, no
states while away. Robin drove Player mode: "it felt good".
