# Layout length + "Space" checkpoints (track editor)

Robin (2026-10-16): re-space evenly · editable distance (default 25 m) ·
both in the Layout bar. Plus: show how long a layout is.

## Behaviour
- **Length** (layout bar): along the driving line through the checkpoints
  in lap order — one-way start → finish, loop = one lap (back to start).
  Updates after place / drag / delete / move / flip / start-finish changes.
- **Space [25] m** (layout bar), on the ACTIVE layout:
  - Keeps: start, finish (one-way), and every checkpoint at the edge of a
    road section (prev or next checkpoint on another path) → the route
    over connectors stays exactly the same.
  - Between consecutive kept checkpoints: removes the rest, places new
    ones evenly along the driving line, n = round(length / distance) gaps
    (spacing as close to the distance as possible).
  - New checkpoints sit on the path they land on, `dir` = travel direction.
  - Loop: includes the stretch from the last checkpoint back to start.
    One-way: "unused" checkpoints after the finish are left as they are.
  - Asks first ("Re-space: 5 checkpoints → 9 (≈ 25 m)?"). In memory only
    until Save; no undo → reopen the file without saving to discard.

## Code
- [x] 1. `app/tracks/vector/route.ts` — pure: driving line from flattened
      paths + checkpoints (legs between consecutive checkpoints, path
      switch at connector ends), total length. Same logic as the bot's.
- [x] 2. `CheckpointsTab.ts` layout bar: "Length: … m", number input
      (m, kept across re-renders), "Space" button + confirm; re-render the
      bar after drag end and flip
- [x] 3. tsc
- [x] 4. Browser (Robin tested the button himself; length checked: Torslanda GP 1035.3 m): open a track in the editor, check length (Training 7 =
      133.3 m, Training 9 = 201.2 m), press Space, check spacing + route.
      NEVER press Save. `git status app/assets` + shasum unchanged.
