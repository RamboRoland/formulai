# Expected lap times (HyrkartCentralen, all layouts)

Robin's answers (2026-10-16): Claude drives them · target = good, reachable
time · Robin pastes the values himself · only HyrkartCentralen.

## Safety
- Track/session JSON are READ only. No writes to `app/assets/` — the script
  lives in the scratchpad, the session is built in memory.
- `git status app/assets` before and after must be identical.

## How "driving" works
Headless run of the real game code with vite-node (same `~` alias and
`import.meta.glob` as the app):
- `Session` built in memory with one stage per layout, real `Track`,
  real `HyrkartCentralen`, real `GameEngine` (stub renderer) ticked at a
  fixed 1/60 s, gameMode 'ai'. Lap clock accumulates dt → the time is what
  the game would show/send as `lapTime`.
- A bot driver supplies the controls each tick (forward / brake / left /
  right — the same booleans an AI sends):
  - Route = the layout's path centerlines between its checkpoints, in lap
    order (switching path at connector junctions).
  - Steering: pure pursuit to a look-ahead point on the route.
  - Speed: corner limit from the car's turn rate (v ≤ 90°/s × radius),
    braking at 40 km/h/s ahead of corners, else full throttle (max 60).
- A run with a collision or a stuck car counts as failed → tune and rerun.

Scope (Robin, 2026-10-16): only the TrainingOne session — Training 1–9,
all one-way (so the loop lap-1/flying-lap question is moot).

## Plan
- [x] 1. Script skeleton: load TrainingOne, build each layout's route; check
      every route point is on the track with room for the kart
- [x] 2. Driver + engine loop: drive Torslanda Training 1, print the time
      and whether it collided — Robin sanity-checks
- [x] 3. Run all 9 TrainingOne layouts
- [x] 4. Table: driven time + suggested expectedLapTime (driven + margin),
      next to today's values (Jarfalla GP 48, GP Short 35)
- [x] 5. JSON snippets per layout for Robin to paste; `git status app/assets` unchanged

## Open questions
- Margin on top of the bot time (bot follows the centerline, not a racing line)

## Results
Step 1 (scratchpad `laptimes/step1.ts`, own vite config without trackStore):
all 9 routes on track, 0 off-track / 0 too-tight points, no path switches.
Route lengths (m): T1 50.9 · T2 55.3 · T3 67.0 · T4 80.6 · T5 59.9 ·
T6 97.9 · T7 133.3 · T8 181.9 · T9 201.2. Assets unchanged (git status + shasum).

Step 2 (`laptimes/drive.ts`, real GameEngine + stub renderer, dt 1/60):
Training 1 clean at every corner-speed setting; time by setting
(fraction of the turn-rate corner limit): 0.85 → 8.32 s · 1.0 → 7.83 ·
1.5 → 6.95 · 3 → 5.88 · no limit (flat out) → 4.87 s, still no collision.
Flat out matches the acceleration math (0→60 km/h in 4 s / 33 m, then
17.6 m at 60) → Training 1 is acceleration-limited, not corner-limited.
The calculated corner limit is far too conservative (wide track → the
look-ahead cuts corners). Step 3 method: per layout, try the corner
setting from "no limit" downwards and take the fastest CLEAN run.

Step 3 (`laptimes/ladder.txt`, `ladder-fine.txt`; settings 100 → 0.5).
Robin: expectedLapTime must NOT be the best time → best + margin.
Best clean run (setting): T1 4.87 (flat) · T2 5.08 (flat) · T3 5.80 (flat) ·
T4 6.53 (flat) · T5 5.45 (flat) · T6 10.80 (1.5) · T7 9.83 (flat) ·
T8 13.98 (1.6) · T9 16.28 (2.0; 2.25 crashes → borderline).
"Careful" bot (setting 1.0): 7.83 · 8.03 · 9.22 · 11.88 · 12.87 · 12.48 ·
17.33 · 15.93 · 20.08. Assets unchanged.

Step 4–5: Robin chose +30 % (best × 1.3, rounded to 0.1 s):
T1 6.3 · T2 6.6 · T3 7.5 · T4 8.5 · T5 7.1 · T6 14.0 · T7 12.8 · T8 18.2 ·
T9 21.2. Handed over as line edits; Robin pastes them himself. (Training 1
already had 5 — Robin's own edit at 09:54, before the runs.)

## Re-run 2026-10-16 11:38 (Robin updated the layouts; ALL layouts now)
`laptimes/drive2.ts` + `ladder2.txt` (19 corner settings, 100 → 0.5).
Loops drive 2 laps: lap 1 (standing) / flying. Best clean run → ×1.3:
- Torslanda GP 1035.3 m: 68.20 / 64.92 → 88.7 / 84.4
- T1 50.1 m 4.82 → 6.3 · T2 50.4 m 4.78 → 6.2 · T3 75.0 m 6.28 → 8.2 ·
  T4 75.0 m 6.20 → 8.1 · T5 50.1 m 4.77 → 6.2 · T6 100.0 m 10.88 → 14.1 ·
  T7 150.7 m 10.87 → 14.1
- Jarfalla GP 866.4 m: 60.00 / 54.28 → 78.0 / 70.6
- GP Short 636.6 m: 47.13 / 41.40 → 61.3 / 53.8
- T8 200.5 m 15.10 → 19.6 · T9 201.2 m 16.27 → 21.2
Files read only (saved by Robin 11:33/11:35, before the run).

## Re-run 2026-10-29 (grip steering, new karts: ALL 3 karts)
Old scripts gone (temp dir cleared) → rebuilt by the same rules:
`scratchpad/laptimes/drive.ts` (real GameEngine / Track / kart, dt 1/60,
gameMode 'ai', pole box; bot: pure pursuit from the rear axle, look-ahead
max(2.5 m, 0.45 s × v), speed plan = setting × grip corner speed
√(gripG·9.81·R) capped at maxSpeed + braking at brakeDeceleration).
Ladder 18 settings (100 → 0.5) × 12 layouts × 3 karts = 648 runs; best
clean run (lap 1 for loops) × 1.3, rounded to 0.1 s. Above ~1.05–1.2 the
corner-limited layouts crash (grip is physical now). Assets unchanged
(git status + shasum). Snippets: `scratchpad/laptimes/snippets.txt`.
- HyrkartCentralen: Torslanda GP 88.6 (68.18 / flying 66.88) · T1 5.6 ·
  T2 5.7 · T3 7.6 · T4 8.2 · T5 6.8 · T6 10.9 · T7 13.5 · Jarfalla GP
  77.7 · GP Short 58.3 · T8 21.0 · T9 19.8
- Hyrkart240cc: 87.5 · 7.5 · 7.5 · 9.4 · 9.9 · 8.2 · 13.4 · 14.0 · 81.4 ·
  61.2 · 24.1 · 22.6
- Racingkart125cc: 60.1 · 4.5 · 4.5 · 5.7 · 6.5 · 5.5 · 8.7 · 8.7 · 55.4 ·
  42.2 · 16.5 · 15.0

## 2026-11-10: `npm run laptimes` (tyre-slip steering + the slide fix)
The bot is a script now: `server/scripts/laptimes.ts` — the 2026-10-29
rules (pure pursuit from the rear axle, look-ahead max(2.5 m, 0.45 s × v),
setting × √(gripG·g·R), 18 settings 100 → 0.5, best clean × 1.3, 0.1 s),
on the DigitalOcean Space's published tracks, all 3 karts. `--yes`
writes only the expectedLapTimes numbers into the Space (checked; restart
the hosted server). Values of 2026-11-10: README "Tracks and layouts".
Torslanda Training 2 / 4 / 5 are longer in the Space than the old seed
(115.7 / 91.1 / 77.9 m) → their times jumped. Plan: `do-data-sync.md`.
