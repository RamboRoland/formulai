# Restart with a start position and speed (agents)

Robin 2026-11-21: on restart, per car, control the start position and
speed; the position is random when applied. Branch
`feat/restart-position-speed`, worktree `~/Projects/formulai-restart`.

## Decisions (Robin)

- Position (`startPosition`): the SERVER picks a random point
  (`'random'`): anywhere on the road — evenly along the route, evenly
  across the free width — facing the direction of travel; `'grid'` or
  not sent (or anything else) = the grid box, as before.
- Speed (`startSpeed`): 0..1 of maxSpeed (as the rest of GameState), clamped; not a
  number → 0. Works with `'grid'` too. Rolling straight along the nose.
- Laps: nothing counts until the start line — checkpoints, laps, lap
  clock stay at 0 until the car crosses it (then normal).
- One-way layouts: `'random'` → the grid box (the start line is behind
  every point of the track; it could never finish). Speed still applies.
- Direction (heading / facing / centerAngle) before the start line:
  follows the route from the spawn (a leg of its own, for direction only).
- Protocol: REPLACES carIds (breaking, `feat!`):
  `req:agent/restart { cars: [{ carId, startPosition?: 'grid' | 'random', startSpeed? }] }`;
  `evt:agent/restarted { carIds }` unchanged.
- Agents only (Player mode / App unchanged). Not remembered: a later plain
  restart or a new stage → the grid.
- No lead-in after a random start (step 4, `stage.randomStart`,
  `Player.leadIn` → 0): completedMeters 0 until the start line, then from
  0 — no jump by the grid lead-in at the line; lapDistance consistent.

## Steps (one at a time, Robin checks each)

- [x] 1. Protocol (both copies) + plumbing: FormulaiServer parses / clamps,
      Lobby.restart → LobbyGame.restartCars → Player.resetLap(options).
      Nothing moves differently yet. Proof: physics-trace identical to main.
- [x] 2. Speed: car.speed = speed × maxSpeed after car.reset() (axle spin
      follows by itself: stopSliding → wheelSpinStarted false → ω = vx / r).
      Proof: headless restart at 0.5 → speed in the first state, κ ≈ 0, no lock.
- [x] 3. Random position (loops): Track.randomSpawn() — uniform arc on the
      route → leg, point, track direction; then evenly across the road
      (castRay left / right − half the car width); colliding → try again. Proof: 100 spawns per layout, on track, facing.
- [x] 4. Direction before the start line: updateDirection follows a
      direction-only leg from the spawn, moving on leg by leg; at the start
      line back to currentCheckpoint − 1. Check updateCompletedMeters'
      lead-in (behindStart) gives a mid-lap car nothing. Proof: heading /
      facing / centerAngle right from the first state around a lap.
- [x] 5. Callers + docs: scripts/testAgent.ts, docs/agent-protocol.md,
      .personal/websocket.md, .personal/CLAUDE.md.

## Open

- Lobby viewer's "front" car: random-spawned cars all have lapDistance 1
  → it may follow a car that isn't really leading (own task if it matters).

## Results (2026-11-21)

- physics-trace identical to main (every step).
- Grid starts: a headless bot lap (25 km/h pure pursuit) on all 6 loop
  layouts, every GameState field every tick (43 784 ticks) — byte-
  identical main vs branch.
- 1000 random spawns per layout: 0 colliding, 0 wrong way, every leg hit,
  spread across the full width (±3.2–4.0 m); one-way → grid (as agreed).
- 30 random starts (startSpeed 0.3) per loop layout, driven through the
  start line: centerAngle vs a brute-force nearest-point reference before
  the line max error 0.0000; facing / heading always right; completedMeters
  0 before the line, 0.00 just after, no jumps; lapDistance always right.
  The early crashes with a 2.5 m look-ahead were the test driver swinging
  in from a spawn at the edge (6 m look-ahead: none).
