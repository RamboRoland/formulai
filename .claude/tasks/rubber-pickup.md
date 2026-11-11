# Rubber pick-up (racing line, graphics)

Goal: a tyre driving over dark asphalt picks up a little of the rubber
dust under it → its path gets lighter at once, however dark it is. Every
spot just gets darker (dust thrown off passes nearby) and lighter (tyres
crossing it) by where the cars drive; no "old" / "new" lines. Visual
only, App only (`app/src/engine/rubberLine.ts`); no server / protocol
change.

Decisions (Robin, 2026-11-11):
- Pick-up per pass scales with `scrub` (b): a sliding / braking tyre
  picks up more, a rolling one less (not none).
- The lines stay EXACTLY as before (`on / near`: two soft lighter wheel
  tracks) — only what happens when a tyre drives over existing rubber
  changes. (First try replaced the line with the pick-up alone → crisp,
  jagged 11 cm strips; Robin: "you should only have changed what happened
  when you drive over existing rubber".)
- Brush σ 0.15 m (0.25 looked too wide).
- Nothing is "abandoned": dust in, dust out, per spot.

Why the code changed: the darkness was not stored — a blur of ALL rubber
ever laid (`near`), recomputed every 0.25 s, only grows. Nothing a tyre
could take away.

## Design (as built)
- Unchanged: the rubber texture, `on` (σ 0.25 m) and `near` (σ 1.2 m)
  blurs, the line factor 1 − LINE_CLEAN × smoothstep(on / near).
- `fresh` (new, like the rubber, mipmaps): the rubber laid since the last
  blur. Every BLUR_SECONDS it is spread exactly as `near` and ADDED into
  `dust` (new, 10 cm texels, R16F, stored), then cleared. Blur is linear
  → without picking up, dust = near.
- Pick-up: every frame each wheel's brush (±3σ, σ 0.15 m) is drawn into
  `dust` with a multiplying blend: dust × (1 − pickup × Gaussian across),
  pickup = min(0.5, 0.03 + 0.2 × scrub) (rolling 3 %, cornering ~7 %,
  locked ~18 % in the middle).
- Shown: MAX_DARK × (1 − e^(−dust / SATURATE)) × the line factor
  (`dust` where it was `near`).

## Phase 1 — stored dust field
- [x] Worktree `~/Projects/formulai-rubber-pickup`, branch
      `feat/rubber-pickup`, ports 5175 / 8081 (5174 = Robin's main App)
- [x] `fresh` + `dust` targets; blur tick: spread `fresh` → add into
      `dust` → clear `fresh`
- [x] Chrome: same spread, smooth, clipped to the asphalt

## Phase 2 — pick-up
- [x] Brush ribbons into `dust`, multiplying blend, per-piece pickup
      from scrub
- [x] Redone on top of the unchanged old line (see Decisions)
- [x] Chrome, Robin: 6 bots (scratch `lineBot.mjs`, protocol only) on two
      lines 1.5 m apart (2 m / 3.5 m from the left edge), test-only ×10
      time-lapse (rubber AND pick-up: 1 − (1 − p)^10): "looks good"
- [x] Test-only values removed (time-lapse, red colour)

## Docs
- [x] Comment at the top of `rubberLine.ts`, `.personal/CLAUDE.md`
      Rendering (worktree copy — copy to main at the merge),
      `tyre-marks-rubber.md` points here

## Review
- Lessons: a test speed-up must scale every rate together (GAIN × 50
  with pick-up × 1 made one dark band); when Robin compares to "before",
  keep the approved look and only add.
- Cost: one more draw of ≤ 512 quads per frame + one more blur (2 passes)
  + one add pass 4×/s; 94–120 FPS in Chrome with 6 bots.
