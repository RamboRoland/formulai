# KartKraft — what it can teach us (2026-11-10)

KartKraft (Black Delta / Motorsport Games, Unreal) is a karting sim. It has
never published its physics (no tyre or kart values, no write-up) — what
follows is from patch notes, previews and its public telemetry schema.

## Physics, as far as public sources say

- **Tyres:** "an industry standard tire model" (likely Pacejka Magic
  Formula — we use it too) + a 3D thermal model (asphalt, contact patch,
  tread, air, rim; hot spots; overheating from sliding).
- **Chassis flex:** previews mention a real-time FEM model of the frame
  (it lifts the inner rear wheel). The detailed FEM description found was
  about KartSim, a different game — not confirmed for KartKraft. We
  approximate it with `liftG` / `liftSeconds` (`Car.slide`).
- **Tyre damping vs steering rate (build 0.1.0.2929):** damping that
  depended on how fast the driver steered gave wrong loads in corners;
  fixed. Same family as our 1–2 Hz full-lock wiggle (fixed 2026-11-10 by
  "never below 0 while sliding").
- Reception: mixed (a Steam review 3/10 for physics; a KartPulse thread on
  frame oscillations).

## Telemetry (UDP, FlatBuffers, `Schema/Frame.fbs`)

| KartKraft sends | We send (GameState) |
|---|---|
| SI units (m/s, m/s², deg/s) | normalised -1..1 (speed in km/h + maxSpeed) |
| per wheel: slip angle (°) + surface (asphalt, grass, kerb, gravel, …) | one body slipAngle; no surfaces (off track = collision) |
| engine rpm, gear (0 = N, -1 = R), rpmLimit, rpmMax, gearMax (1 = no gears) | no rpm, no gear |
| pitch / roll / heave, angular velocity (3 axes) | yawRate only (flat world) |
| normalisedTrackPos, sector | lapDistance (close) |

## Ideas (one at a time, each its own plan)

1. **Engine rpm in GameState** — decided: wheel-derived (v / r × ratio, as
   `Car.longitudinal` already computes), sent raw + `maxRpm` (like speed +
   maxSpeed). Reads low below the clutch speed (Rotax ~36 km/h) — true to
   our model.
2. **Gear** — later, when a kart with gears exists (e.g. KZ2 shifter).
   Today every kart is single-speed; the App's R / N / D is from speed.
3. **Slip angle per axle** — decided (Robin, 2026-11-10): front / rear,
   what `Car.slide` computes and uses for the tyre forces. Per wheel is
   correct geometry (each wheel's velocity differs by yaw × half track)
   but the forces don't use it, the inner / outer difference is a few
   tenths of a degree, and the front needs a front track width + steering
   geometry (Ackermann) we don't model. Worth it if forces ever go per
   wheel.
4. **Tyre relaxation length** (Pacejka, *Tyre and Vehicle Dynamics*): side
   force builds up over a short rolling distance, not at once. Established,
   cheap; would make steering-rate effects physical instead of instant.
5. **Braking spin — next after slip per axle** (Robin, 2026-11-10: "take a
   good look"). Seen in the slip proof: the Racingkart standing still after
   a hard brake in a corner still shows gripRear 0.70 / rear slip ~1°
   (already before the slip change).
6. Surfaces (grass, kerbs, gravel) and tyre temperature — big changes; not
   now.

## Sources

- https://traxion.gg/physics-overhaul-for-kartkraft/
- https://www.bsimracing.com/kartkraft-build-0-1-0-2929-deployed
- https://onlineracedriver.com/2020/12/23/new-kartkraft-build-0-1-0-2823-released
- https://virtualr.racesimcentral.net/kartkraft-new-dev-blog-previews.html
- https://gaming.hwupgrade.it/articoli/videogames/4012/kartsim-una-simulazione-realistica-anche-per-i-go-kart_3.html (KartSim, not KartKraft)
- https://forums.kartpulse.com/t/oscillations-in-kart-frame-kartkraft/4643
- https://www.github.com/motorsportgames/kartkraft-telemetry (`Schema/Frame.fbs`)
