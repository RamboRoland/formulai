# Crash debris physics — 2026-11-22 (branch feat/crash-debris)

A crashed kart breaks into its parts (body + 4 wheels, App only,
`app/src/engine/collisionEffects.ts`). Today each part flies off with a
random push and spin, and lands by a trick (it is lifted to the ground
and then rotated until it lies flat). Goal: the parts behave like solid
objects: they tumble, land on an edge or corner, tip over by their own
weight, wheels roll and fall over, then lie still.

## Idea: a small rigid-body sim against the ground (no new dependency)

Per part:
- State: centre of mass (bounding-box centre — the body's own origin is a
  corner), velocity, orientation, angular velocity. Inertia = a solid box
  of the part's size (a wheel: a solid cylinder about its axle).
- Contact points = the mesh's own vertices (thinned to ≤ ~150): the body
  touches with its real shape, a wheel with its rim → it rolls.
- Each frame in substeps (1/240 s): gravity; every point below the ground
  moving down gets an impulse (restitution ~0.3, none when slow) plus
  friction (μ ~0.6, Coulomb-capped); push back out of the ground. Tipping
  over, rolling and settling come from this, not from a rule.
- Asleep when it barely moves for 0.5 s → frozen (no jitter, no cost).

Real units: gravity 9.81 m/s² (today ~37 m/s², parts hang in the air).
Launch: the kart's own velocity just before the crash (Scene3D measures it
from frame to frame) + a smaller random burst up / out (~2–4 m/s) and
spin → parts fly on in the direction of travel.

Not doing: parts hitting each other, tyre walls or props (they pass
through) — add if it looks wrong.

## Steps

- [x] collisionEffects: rigid body per part (state, inertia, contact
      points), substepped ground contact + friction, sleep
- [x] Scene3D: track each car's velocity, pass it to breakApart
- [x] Remove the tip-flat rule (DEBRIS_TIP_RATE / GROUND_DRAG)
- [x] Type-check; crash in Player mode a few times (slow / fast, straight /
      sideways): no nose-standing, no jitter, wheels roll then fall
- [x] CLAUDE.md: a line under Rendering

## Review

Done 2026-11-22. Headless check (the real raceCar.glb broken apart 12×
at 4 / 14 / 25 m/s, 10 s each; script kept out of the repo): every part
asleep within 9.5 s; bodies end on their floor, side or roof (on the roof
at ~19°, held up by the rear wing); wheels flat or standing on the tread.
Added on the way: rolling drag (wheels rolled upright for 30 m+), static
friction on sliding only (the body crept ~5 cm/s on solver jitter;
damping spin too froze wheels mid-tip), sleep needs spin < 0.15 m/s.
Checked once in Player mode (chase camera). Inertia: a solid box for the
wheels too (close enough to a cylinder).
