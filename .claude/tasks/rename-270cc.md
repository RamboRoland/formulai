# Rename Hyrkart240cc → Hyrkart270cc

Status: DONE 2026-11-10 — rename-kart written (7 files), pushed 91462a5, deploy run 42838800454 green, hosted server loaded 5 tracks + 2 sessions; laptimes written; local fetched.
Robin (2026-11-10): HARD rename (old name refused, no alias); Space data by a one-off script
with his OK. Reason: the engine is a Honda GX270 (270 cc), research + Robin.

## Done
- Code: class + file Hyrkart270cc, `name`, CAR_CLASSES (server + App copy), Session.chooseCar,
  comments. Docs: README (Cars, lap-time table header), agent-protocol (kart list + "renamed,
  old name refused"), .personal (worktree copy).
- `npm run rename-kart -- <old> <new> [--yes]` (server/scripts/renameKart.ts): sessions/,
  tracks/, tracks/drafts/; only the "<old>" JSON string changes (text round trip + parsed
  deep-equal with the name mapped), new name must be a class of the code, old not; every session
  must load (validateSession) against the renamed tracks; --yes re-reads before writing (skips a
  file saved meanwhile) and verifies after.
- Dry run (Space, read only): 7 of 7 files — sessions training_long (1), training_one (1); tracks
  jarfalla (4), lulea_kallax (1), lycksele (1), skovde (1), torslanda (8); no drafts. All
  sessions load with the new name.
- laptimes dry run: Hyrkart270cc = the old 240cc numbers (Järfälla GP 109.8, GP Short 82.9,
  T1 31.6, T2 31.7), then stops: "GP has no Hyrkart270cc" — laptimes only writes existing keys →
  rename-kart must run first.

## Deploy day (Robin's OK for every write)
1. `cd server && npm run rename-kart -- Hyrkart240cc Hyrkart270cc --yes` (code with the new name)
2. Push main right away (= deploy; the running old server keeps its loaded data until then).
   Before step 2 a restart of the OLD server would skip TrainingOne (unknown kart) — don't.
3. `npm run laptimes -- --yes` (analog-pedals table), restart the hosted server, README table.
4. `npm run fetch` locally, restart local server.
