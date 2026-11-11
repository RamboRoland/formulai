# Incident logs in the Space (plan, 2026-11-11 — not started)

Why: real driving data from the live server — where agents / players
spin or crash, with what inputs — instead of recording by hand in the
browser (`.claude/tasks/braking-spin.md`). It shows how OUR model behaves
with real drivers; it can't calibrate the physics (that needs the real
kart: `.claude/tasks/kart-measurement.md`).

Robin (2026-11-11): OK, **30-day retention in S3**.

## What

- Incident = a car on a stage, not in reverse, above 8 km/h:
  - spin: |body slip| > 20° (nose vs direction of travel), or
  - collision: `hasCollision` goes true.
  One per car per 3 s (cool-down).
- Saved per incident: 3 s before + 2 s after, 20 samples/s (every 3rd
  step, like viewer frames): t, speed, angle, x / y, lateralSpeed,
  yawRate, slipAngle(Front / Rear), lateralG, longitudinalG, gripFront /
  gripRear, rearLift, rearLocked, the controls (forward, backward, brake,
  steering) + steeringAngle / wheelAngle, hasCollision; header: lobby,
  session, stage (track / layout), kart, client name + kind (agent /
  player), lap / lapDistance, server version (git sha), kind of incident.
- A ring buffer per car (3 s × 20 = 60 samples, small) in `Lobby`, fed on
  `stepped`; after 2 s more the incident is queued.
- Written in batches (not per step): every 60 s, or when the lobby ends,
  one object per lobby and batch: `logs/incidents/YYYY-MM-DD/<lobby>-
  <batch>.jsonl.gz`. Size ~2–5 KB per incident gzipped.
- Off by default: `LOG_INCIDENTS=true` in `server/.env` (config.ts,
  settings in .personal/CLAUDE.md). Writes never block the game loop
  (async, errors logged, dropped after a cap of queued bytes).
- Fast lobbies: off (or sampled) — training at 20× would flood it;
  decide in phase 1.

## Retention: 30 days

- Preferred: an S3 lifecycle rule on the Space bucket — Expiration 30
  days for prefix `logs/` (DO Spaces supports lifecycle Expiration via
  PutBucketLifecycleConfiguration). Set ONCE by a script
  (`npm run logs-retention`, writes only that rule; shows the current
  rules first, asks for `--yes`) — touches the Space's bucket config →
  Robin approves before it runs.
- Belt and braces: the server, at start, deletes `logs/` objects whose
  date folder is older than 30 days (only under `logs/`; never tracks /
  sessions / backgrounds). Covers local SeaweedFS too.
- `npm run fetch` doesn't touch `logs/` (checked: scripts/fetch.ts
  copies / deletes only tracks/, tracks/drafts/, sessions/, backgrounds/
  — PREFIXES); keep it that way.

## Reading

- `npm run incidents [-- --days 7] [--track …] [--kart …]`: fetches the
  logs read-only, prints a summary: incidents per layout / corner
  (lapDistance bucket), spin vs collision, brake level and steering at
  the start of the slide, agents vs players, and the worst ones with a
  short trace. Raw files can be replayed through Car (like my
  scratchpad replay.ts) to test physics changes against real inputs.

## Phases (each: proof, Robin OK before the next; no commit until the
## agreed tests pass)

1. Server: ring buffer + incident detection + batch writer, behind the
   flag; tests on a local server (8081, my ports) with local S3: a
   scripted agent that spins / crashes → objects appear, sizes, CPU
   (40 cars), nothing written with the flag off; game loop timing
   unchanged.
2. Retention: a sweep at start + every 24 h in the server (the lifecycle
   rule was dropped: no rights on the Space's key; Robin chose a daily
   job).
3. `npm run incidents` reader + docs (.personal, README "Development").
4. Deploy (with the pending README push), set `LOG_INCIDENTS=true` on the
   Droplet's deploy/.env (Robin approves), then the live check from the
   logs.

## Phase 1 result (2026-11-11, branch feat/incident-logs, uncommitted)

Code: `formulai/incidentLog.ts` (IncidentRecorder per lobby: ring of 60
samples / car, spin = speed > 8 km/h + |slip| > 20°, collision = rising
edge with the sample before > 8 km/h (a crash stops the car at once),
cool-down 3 s, 40 samples after; shared queue, flush every 60 s + on
lobby close, gzip JSONL, key `logs/incidents/YYYY-MM-DD/<lobby>-<ms>-
<n>.jsonl.gz`, max 2000 queued); `Lobby` (recorder unless fast; sample
every 3rd step; close() flushes); `config.logIncidents`
(LOG_INCIDENTS=true); `Car.rearLift` / `rearLocked` public (read only by
the log). Incident fields: v, at, type (spin / collision), lobby,
session, stage, track, layout, carId, client, driver (agent / player),
kart, lap, lapDistance, tick, sampleTicks, samples[] (speed, angle, x /
y, slip, slipFront / Rear °, yawRate °/s, lateralG, longitudinalG, grip,
rearLift, rearLocked, pedals, steering, steeringAngle, wheelAngle,
hasCollision).

Proof:
- My server on 8081 (LOG_INCIDENTS=true, EMPTY_LOBBY_SECONDS=5) + a test
  agent (spin: 8 s gas, then brake 1 + full lock; crash: full lock into
  the edge) → objects written on lobby delete, 2–6 KB each, spin trace
  shows locked rear + full lock + slip / yaw build-up. (My first "0
  objects" was my lister: storage.listObjects lists one level only.)
- Switch off (no LOG_INCIDENTS): same agent → no new objects.
- CPU, 40 karts × 3600 steps headless: sampling 2.0–2.6 % of step time.
- Physics suite (runall.sh) identical to the committed fix; tsc OK.
- My test objects deleted from the local S3 (logs/ empty again).
- Note for the reader: on a collision `speed` keeps its last value
  though the car stands (engine behaviour).

## Phase 2 result (2026-11-11, uncommitted)

The S3 lifecycle rule is OUT: `GetBucketLifecycleConfiguration` on the
Space answers "Access Denied" (the server's key is limited to objects —
fine for a server key). Robin: a daily cleanup job instead.
- `incidentLog.startIncidentSweep()` (from index.ts after start): sweeps
  at start and every 24 h (`setInterval`, unref), whether logging is on
  or not. `sweepOldIncidents()`: day folders under logs/incidents/ older
  than KEEP_DAYS 30 → their objects deleted, then the folder key
  (SeaweedFS keeps empty folders; harmless on Spaces). Only under PREFIX.
- `storage.listFolders(prefix)` (CommonPrefixes) — storage.ts stays the
  only S3 code.
- Proof (local S3): planted 2026-10-01 / 2026-10-20 / today → only
  10-01 deleted, tracks / sessions untouched; my server on 8081 with a
  planted 2026-09-30 → "Incident logs: 1 older than 30 days deleted." at
  start, today's kept. Test objects + folders removed (top level:
  backgrounds/ sessions/ tracks/). tsc OK.
- Not tested: the 24 h repeat itself (a plain setInterval).

## Phase 3 result (2026-11-11, uncommitted)

`npm run incidents [-- --days 7] [--local] [--track] [--kart] [--driver]
[--type] [--top 5]` (scripts/incidents.ts): reads the day folders of the
last N days (the Space read-only, or --local = the server's bucket), per
layout the 5 busiest lap buckets (5 %, from the start line) with what
the driver did in the 0.5 s before (brake, locked share, gas,
|steering|, speed), per client, and the worst spins as traces (every
0.15 s, > = the incident). Tested: my 8081 server + 2 test agents → 5
incidents (2 spins, 3 collisions) read with --local; the Space read-only
→ 0 (logging not on there). Test logs removed. Docs: README
("Incident logs"), server/.env.example, .personal (settings, storage,
folders).

Open: client names in the logs (Robin's server, fine?); fast lobbies;
whether players (Robin in Player mode) should be logged too.
