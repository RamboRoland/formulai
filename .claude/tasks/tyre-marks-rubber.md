# Tyre marks + rubbered-in racing line (graphics)

Goal: realistic tyre marks (only skidding tyres, real size) and a racing
line that builds up where cars drive. Visual only; no physics change.

Decisions (Robin, 2026-11-11):
- Marks: locked rear tyres (dark) + sliding tyres (fainter, by how much
  they slide). Rolling tyres leave no mark.
- Marks stay until the track changes (ring buffer: oldest overwritten).
- Racing line: LIGHTER than off-line (my note: real rubber makes it
  darker; Robin chose lighter) → refined: the line doesn't lighten, the
  asphalt BESIDE it darkens ("a spread around the racing line, not the
  whole width"; rubber dust / marbles), two soft lines (the wheel tracks).
- Racing line lives per page view (App only, starts clean on reload /
  another track).

## Phase 1 — server sends skid per wheel
- [x] `RenderCar.skid: [FL, FR, RR, RL]` 0..1 (2 decimals), both protocol copies
- [x] Rear locked → 1 per rear wheel; sliding → slip past `peakSlipDeg`
      scaled to a fainter max (front from slipFront, rear from slipRear)
      → changed (Robin): marks from 2 × peak, full (0.5) at 4 × peak — cornering
      just past the peak still grips, no marks (30 % at 60 km/h: 11° → 0)
      → replaced (Robin: "it's scrubbing"): `scrub` per wheel = grip in use ×
      sliding per metre (sin α; locked: slideGrip) — wear ∝ force × distance
      slid (Archard). App marks above MARK_FROM 0.3, opacity (scrub − 0.3) /
      0.7 × 0.25 (Robin: lighter than 0.5, 0.35). Corner 0.19 → none; plough 0.49 → faint; lock 0.75 → dark.
      Phase 3 uses ALL scrub (the racing line = the small scrub)
      → replaced again (Robin: "only on locked"): marks ONLY from locked rears
      (`RenderCar.locked`), opacity scrub × LOCK_OPACITY 0.13 (~0.1, Robin: lighter than 0.2; lifted
      inner less). Spins / ploughs happen in every crash → too many marks.
      scrub stays in the frame for Phase 3
- [x] Inner rear lifted (`rearLift`, side from wheelAngle: the steering lifts it, roll only past ~2 g) → its mark × rearLift
- [x] Wheel geometry in every RenderCar: `wheels` = [front track, rear track,
      wheelbase, front / rear tyre width] px (Robin: in the frame; the frame
      has no kart name). Tyres 10x4.50-5 / 11x7.10-5 → 0.114 / 0.18 m
      (`Car.tyreWidthMeters`); wheelbase centred on the body (estimate)
- [x] Proof: numbers from a scripted brake-lock + spin on a copy

## Phase 2 — App skid marks
- [x] Draw only where skid > 0, opacity from skid, real wheel positions + widths
- [x] No fade (until track change)
- [x] Self-test in Chrome (crops), every camera mode (isometric + chase seen; lock = 2 rear lines, plough / spin curved)

## Phase 3 — App racing line layer (`app/src/engine/rubberLine.ts`)
- [x] Rubber texture over the track bounds (10 cm texels, ≤ 4096, R16F):
      every wheel lays a tyre-wide ribbon (additive) of BASE_RUBBER 0.02 +
      its scrub per pass (Robin: straights too, much slower), GAIN 1,
      SATURATE 7 (~100 laps, Robin: slow)
- [x] Shown on the asphalt mesh itself (exact outline, every camera mode):
      darkness MAX_DARK 0.5 × (1 − e^(−near / 7)) × (1 − 0.4 × smoothstep(
      0.1, 3, on / near)); near = Gaussian σ 1.2 m (0.25 m texels), on =
      Gaussian σ 0.25 m (full res) — the ratio keeps the line width fixed
      as rubber builds; both blurs 4×/s
- [x] Robin's tuning: smooth like the marks (no mip blocks → real Gaussian
      blurs), two lines not one (on narrow), soft lines (clean ≤ 40 %),
      long light → dark fade, darker spread, slow build (no line popping up
      behind the car)
- [x] Cost: a few quads per frame + 4 blur passes 4×/s; 120 FPS in Chrome
- [x] Self-test in Chrome (isometric + chase; debug paint proved mesh,
      orientation, laying)
- Fast lobbies: no marks / rubber (Robin: leave out) — frames ~20 per real
  second, cars jump > 2 m (JUMP_PX) between them, the path is unknown

## Review
- Marks: only locked rears, real wheel positions + tyre widths, ~0.1
  opacity per pass, fading out over 3 min (FADE_SECONDS 180, Robin: a
  limit; 15 s proof: faint at 9 s, gone at 21 s). scrub (force × sliding)
  feeds the racing line.
- Racing line: per page view, builds over ~100 laps of one car (faster with
  more cars); darker spread beside two soft wheel-track lines.
- Found on the way: a Vite page can keep a stale module graph after edits
  → hard reload when testing.
