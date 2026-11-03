# Phase 12: S3 storage (tracks + sessions)

Robin (2026-11-03): the server keeps its data in S3 ONLY — locally too
(SeaweedFS — MinIO no longer publishes Docker images, 2026-11-03), one
storage path in the code. Decisions:
- Client: `@aws-sdk/client-s3`.
- `npm run dev` uses the local S3 as well (`docker compose up -d s3`);
  `server/tracks` + `server/sessions` become SEED data only.
- All sessions equal: no "shipped" (read-only) sessions any more — every
  session can be edited or deleted (TrainingOne too).
- Seeding: `npm run seed` uploads repo files that aren't in the bucket yet
  (never overwrites); compose runs it once at start.

## Bucket layout
```
tracks/<file>.json          published (what the game races)
tracks/drafts/<file>.json   track editor drafts
sessions/<file>.json        every session
backgrounds/                phase 13
```
Loaded into memory at start (registries), written through on save; ONE
server instance (no reload from S3 while running).

## Steps (each: proof, ask before the next)
- [x] 12a. Local S3 in docker-compose: service `s3` = SeaweedFS
      (`chrislusf/seaweedfs:4.09`, `weed server -s3`), host port 9100
      (9000 is taken locally), keys in `seaweedfs/s3.json` (formulai /
      formulai-local, local only), data in volume `s3-data`. Proof (AWS
      CLI): bucket + object created; object still there after a restart
      (~8 s until S3 answers again — the server must wait / retry at
      start); a wrong secret → SignatureDoesNotMatch; anonymous → 403.
- [ ] 12b. S3_* settings in config.ts / .env.example (defaults = the
      local S3); `server/src/storage.ts` (list / get / put / delete JSON
      by key, the only S3 code) + `scripts/seed.ts` (`npm run seed`:
      creates the bucket if missing, uploads only missing keys). Proof:
      seed fills the local S3; a second run uploads nothing; an edited
      object is not overwritten.
- [ ] 12c. Start-up from S3: `loadGameFiles` async, `index.ts` awaits it.
      Proof: server loads 5 tracks + 2 sessions from S3; races work.
- [ ] 12d. Track API on S3 (`trackStore` async, `httpApi` awaits). Proof:
      editor lists / opens / saves a draft / publishes / deletes — test
      files only, never Robin's tracks.
- [ ] 12e. Sessions on S3, "shipped" removed: `sessionStore`, protocol
      `SessionEntry.shipped` (both copies), App badges / read-only logic
      (SessionEditorView, CreateLobbyView). Proof: save / delete any
      session; TrainingOne editable.
- [ ] 12f. Docker: server image without tracks/sessions; compose seeds at
      start. Docs: README, .personal (CLAUDE.md, websocket.md,
      vector-tracks.md). Proof: `docker compose up --build` from an empty
      bucket → seeded, races, editor saves survive a server restart.

## Open
- `server/node_modules` is tracked in git: the AWS SDK adds many files.
