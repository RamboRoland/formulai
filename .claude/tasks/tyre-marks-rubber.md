# Tyre marks + rubbered-in racing line (graphics)

Goal: realistic tyre marks (only skidding tyres, real size) and a racing
line that builds up where cars drive. Visual only; no physics change.

Decisions (Robin, 2026-11-11):
- Marks: locked rear tyres (dark) + sliding tyres (fainter, by how much
  they slide). Rolling tyres leave no mark.
- Marks stay until the track changes (ring buffer: oldest overwritten).
- Racing line: LIGHTER than off-line (my note: real rubber makes it
  darker; Robin chose lighter).
- Racing line lives per page view (App only, starts clean on reload /
  another track).

## Phase 1 — server sends skid per wheel
- [x] `RenderCar.skid: [FL, FR, RR, RL]` 0..1 (2 decimals), both protocol copies
- [x] Rear locked → 1 per rear wheel; sliding → slip past `peakSlipDeg`
      scaled to a fainter max (front from slipFront, rear from slipRear)
- [x] Inner rear lifted (`rearLift`, side from wheelAngle: the steering lifts it, roll only past ~2 g) → its mark × rearLift
- [x] Wheel geometry in every RenderCar: `wheels` = [front track, rear track,
      wheelbase, front / rear tyre width] px (Robin: in the frame; the frame
      has no kart name). Tyres 10x4.50-5 / 11x7.10-5 → 0.114 / 0.18 m
      (`Car.tyreWidthMeters`); wheelbase centred on the body (estimate)
- [x] Proof: numbers from a scripted brake-lock + spin on a copy

## Phase 2 — App skid marks
- [ ] Draw only where skid > 0, opacity from skid, real wheel positions + widths
- [ ] No fade (until track change)
- [ ] Self-test in Chrome (crops), every camera mode

## Phase 3 — App racing line layer
- [ ] Ground texture over the track bounds; every rolling wheel adds a little
- [ ] Drawn as a 3D layer over the asphalt (all camera modes), lighter tint
- [ ] Resolution / cost check (texture size, per-frame splats)
- [ ] Self-test in Chrome

## Review
