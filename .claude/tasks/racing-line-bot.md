# Racing-line lap-time bot (idea)

Status: IDEA, not started (noted 2026-11-10, Robin: "note the bot idea").

## Why
`npm run laptimes` (server/scripts/laptimes.ts) drives the CENTRELINE route (pure pursuit on
`track.route`), with corner speeds from the centreline radius. A driver uses the track's width
(outside → apex → outside), so the bot brakes where a real driver stays flat → expected lap times
are conservative (and × 1.3 on top).

Found on Torslanda GP turn 1 (.claude/tasks/analog-pedals.md, "Side finding — CLOSED"): 88°,
8–9.5 m wide, centreline R ≈ 22 m. Flying lap, Hyrkart270cc arrives ~71 km/h: flat out on the
centreline runs off at the grip limit; on a racing line R ≈ 43 m → needs ~0.92 g of 1.15 → flat
out holds (as in real life).

## What it would take (rough)
- A racing line per layout from the outline (inside / outside edges, tyre walls), e.g. a
  minimum-curvature line within the width minus the kart width and a margin.
- Speed plan from that line's curvature (grip limit), braking as today (below the rear lock,
  friction ellipse), pure pursuit on the line instead of the route.
- Proof: per layout old vs new lap times; every run clean; check against known real laps where we
  have them.
- Then `npm run laptimes -- --yes` (Robin's OK) + README table; maybe lower the 1.3 margin.
