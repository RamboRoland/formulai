# Rubber + marbles — ideas for later

Noted 2026-11-12, after `.claude/tasks/marbles.md` (all phases merged into
main, b81d7aa). Nothing here is planned or started.

## 1. Rain / weathering removes rubber
From Robin's first notes (rubber removal): rain softens the embedded rubber
and washes it away or lets the next dry session lift it; heat cycles crack
it. Today only tyres move marbles, and laid rubber never goes.
- The App already has a rain slider (`engine/rain.ts`) — hook it in: while
  it rains, laid rubber (`target`) and marbles (`dust`) fade slowly,
  marbles faster; maybe a slow decay of both over time without rain.
- App only, visual. Open: rates (no source yet), whether the rubber line
  should come back faster after rain than on a fresh track.

## 2. Per-kart shedding
Robin's notes: hot, soft slicks hold marbles much longer (300–500 m for
63 %) than rental tyres (100–200 m); softer compounds shed bigger, heavier
chunks that land closer to the line. Today every kart uses the rental
values (SHED_ROLL_M 400 / SHED_SCRUB_M 15; throw distances).
- Needs the kart class (or its tyre values) in the viewer frame's
  `RenderCar` — protocol change in both copies, server sends it.
- Then: shed rate and marble throw distance per class.

## 3. Rubber + marbles affect grip (server physics)
The only one that changes how the agents (and Player mode) drive. Robin's
notes: laid rubber INCREASES grip (tacky rubber-on-rubber); marbles and
lock-up glaze DECREASE it (greasy, rolling pellets). Today everything is
App-only and visual; the server knows nothing about it.
- The server would track rubber + marbles itself (per lobby, per track),
  like the App's textures but on the CPU, at a coarse resolution.
- Each tyre's grip × a factor from the rubber / marbles under it.
- Big step: server CPU cost (see the CPU rounds), state per lobby, the
  AI's lap times change over a session, expectedLapTimes. Needs a sourced
  plan first (real grip numbers for rubbered-in vs green vs marbles) —
  `.claude/tasks/` + Robin's approval before any code.
