# Sessions as JSON — Build Order

Goal: one `Session` class; sessions are JSON files in `app/assets/sessions/`,
discovered like tracks. Removes the `Practise` / `TrainingOne` subclasses
(and the 3 old `Stage.completed` type errors with them).

Decisions (Robin, 2026-10-12):
- A session lists the car classes you choose from.
- Single player uses a default session (no picker for now).
- AI mode chooses the session as today (on the page, default session).
- Sessions are hand-edited JSON for now (no editor tab).
- Single player races with the session's FIRST car.
- No Practise in the multiplayer lobby → Practise is gone entirely; every
  session is a JSON file.

Each step ends with a check Robin verifies before the next one starts.

---

## Today

| Piece | Now |
|---|---|
| `Session` | abstract; `stages`, `cars`, `chooseCar`, completion helpers |
| `Practise` | 1 stage, a given Track, 1 lap |
| `TrainingOne` | 6 fixed track names × 3 laps, missing ones skipped |
| `/racing/player`, `/racing/ai` | hard-code `new TrainingOne(['GokartGokartCentralen'])` |
| Lobby (multiplayer) | host picks "Practise" (+ track) or "Training One", plus a cars multi-select; players pick from those cars |
| `SinglePlayerView` | track picker only if `constructor.name === 'Practise'` (no-op TODO) |
| Type errors | `Practise.ts` / `TrainingOne.ts` / `Session.ts` — stage objects don't match `Stage` |

## Format

```ts
// app/assets/sessions/<stem>.json
type SessionJSON = {
    name: string;          // "TrainingOne" (id; lobby/protocol value)
    displayName: string;   // "Training 1"
    cars: string[];        // car classes you choose from, e.g. ["GokartGokartCentralen"]
    stages: {
        track: string;     // track name, e.g. "GoKartTrackOne"
        layout?: string;   // layout id OR name (id first); omitted → first layout
        laps: number;      // ignored on one-way layouts (always one run)
    }[];
};
```

---

## S1 — Format + registry
- [x] `app/sessions/types.ts`: `SessionJSON`.
- [x] `app/sessions/registry.ts`: Vite glob over `/app/assets/sessions/*.json` →
  `SESSION_REGISTRY` + `SESSION_OPTIONS`; `DEFAULT_SESSION = 'TrainingOne'`.
- [x] Validation with readable errors (unknown car class, empty stages,
  bad laps) — invalid files are skipped with a console error.
- Verified with throwaway files (deleted): valid one listed; broken one
  skipped with `Session file zz_broken.json: Unknown car class "Ferrari"
  (known: GokartTraining, GokartGokartCentralen).`; empty cars / empty
  stages / laps 0 / missing track each rejected with a clear message.

**Check:** registry lists the file; a broken file logs a clear error.

## S2 — One Session class
- [x] `Session` is concrete: built from a `SessionJSON`.
- [x] Stages whose track is missing / not raceable are skipped with a
  console warning (as today). No stages left → the view shows its error
  screen ("Session X has no raceable tracks").
- [x] `Stage` type cleaned up (`{ track, stageLaps }`).
- [x] Delete `Practise.ts`, `TrainingOne.ts`.

**Check:** typecheck → **0 errors** (the 3 old ones gone).

## S3 — TrainingOne as JSON
- [x] `app/assets/sessions/training_one.json`: same 6 track names, 3 laps each,
  cars `["GokartGokartCentralen"]` (what the routes use today).

## S4 — Routes
- [x] `/racing/player` and `/racing/ai` load `DEFAULT_SESSION` from the
  registry instead of `new TrainingOne(...)`.

**Check:** player + AI mode race exactly as before (autopilot lap).

## S5 — Multiplayer lobby
- [x] Session dropdown = every session in the registry (no Practise).
- [x] Track select + cars multi-select removed: the lobby sends the
  session's car list (protocol fields unchanged: `track: null`,
  `cars: session.cars`), players pick from it as today.
- [x] Route's `createSession` uses the registry.

**Check:** lobby create form + a created lobby carry the session's cars
(live if the WS server runs; fake player script if needed).

Verified (S2–S5 done together so the project keeps compiling):
- Typecheck: **0 errors** (the 3 old ones are gone).
- No raceable tracks → "Session "Training One" has no raceable tracks…" +
  one console warning per skipped track.
- With a throwaway GoKartTrackOne: TrainingOne from the file raced exactly
  3 laps (12.53 / 12.18 / 12.16 s).
- Lobby: only a Session dropdown ("Training One"); create sent
  `{session:"TrainingOne", track:null, cars:["GokartGokartCentralen"]}`;
  Start Game → host view, overview camera frames the whole track (R5 now
  verified live).
- `RacingGameProps` in app/types.ts (unused) now types `Session`.

## S6 — Single player view
- [x] Remove the Practise-only track picker (it was a no-op TODO and
  Practise no longer exists).
- [x] Car: the session's first car (as today).

## S7 — Docs
- [x] `.personal/CLAUDE.md` Sessions section, `.personal/vector-tracks.md`
  open question about the session track picker.

---

## Review

Done. One `Session` class built from `app/assets/sessions/*.json`;
`Practise` / `TrainingOne` classes deleted; the lobby offers session files
only (cars from the file); single player + AI race the default session's
first car. Typecheck went from 3 old errors to **0**.

Notes:
- `TRACK_OPTIONS` (tracks/registry) has no users now — kept for a future
  track/session picker.
- To race your own track: add it to a session file (or name it like one of
  TrainingOne's stages).
