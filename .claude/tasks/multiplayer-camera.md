# Multiplayer host camera (zoom out, pan, fit to checkpoints)

Only `MultiplayerHostView` changes behaviour. Single player / AI mode keep
today's camera exactly (follow car, −/+ ±0.1 within 0.5–2).

## Why zoom out is blocked today
`applyOverviewCamera()` sets the engine zoom to a fit value (~0.1–0.2), but
the −/+ buttons in `RacingView` count from their own private `zoom = 0.6`
clamped to [0.5, 2] → first "−" click jumps to 0.5 (zooms IN).

## Decisions (Robin, 2026-10-13)
- Zoom: buttons + scroll wheel (wheel zooms towards the mouse pointer)
- Host only
- Pan: drag with the mouse; a "Fit" button resets the view
- Next stage: re-fit to the new layout's checkpoints

## Plan
- [x] 1. `RacingView`: `makeZoomButton` private → protected (no behaviour change)
- [x] 2. `MultiplayerHostView`: own camera state `{ zoom, x, y }` pushed to the
      engine (`setZoom` / `setCameraFocus`)
- [x] 3. `fitToCheckpoints()` replaces `applyOverviewCamera()`: bounds of the
      current layout's checkpoint lines (`track.checkpoints[].start/end`)
      + margin; falls back to `track.bounds` if there are no checkpoints
- [x] 4. Override `buildZoomButtons()`: same look/position, buttons −, +, Fit;
      −/+ step ×1.25; limits min = (whole-map fit zoom) / 2, max = 2
- [x] 5. Wheel on the main canvas: zoom ×1.1 per notch towards the pointer
      (the world point under the mouse stays put); `preventDefault` so the
      page doesn't scroll
- [x] 6. Drag on the main canvas pans (grab/grabbing cursor); listeners
      removed on unmount via `unsubs`
- [x] 7. `maybeAdvanceAllStages()`: after advancing → `fitToCheckpoints()`
- [x] 8. Verify: tsc; browser test in multiplayer host (no saves, no track
      file writes): fit on start, −/+/wheel/drag/Fit, single player unchanged

## Review
Steps 1–7 done. Verified 2026-10-13: tsc OK; browser (isolated tab, temp WS
server + fakePlayer, Training One session): starts framed on Training 1's
checkpoints; −×12 stops at half the whole-map fit; drag pans; wheel zooms
towards the pointer (page doesn't scroll); Fit restores; no console errors.
Not exercised live: re-fit on stage change (needs a bot to finish a stage).
Single player untouched (only makeZoomButton private → protected).
