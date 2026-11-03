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
- [x] 12b. S3_* settings (config.ts, .env.example; defaults = the local
      S3), `server/src/storage.ts` (the only S3 code), `npm run seed`
      (only missing keys, byte for byte). Proof in a test bucket.
- [x] 12c. Tracks fully on S3 (start-up + Track API; waits up to 60 s
      for the bucket). TRACKS_DIR removed. Proof: API, editor, restart.
- [x] fix: SeaweedFS reserved ~1 GB per volume and filled Docker's disk
      → `-master.volumeSizeLimitMB=64`; bucket backed up, volume
      recreated, restored byte for byte. Test in ONE reused bucket.
- [x] 12d. Sessions fully on S3, "shipped" removed (protocol both copies,
      App badges / read-only). SAVED_SESSIONS_DIR, nodemonConfig removed.
- [x] 12e. Docker: image carries tracks + sessions only as seed data;
      compose `seed` service (waits for S3, fills what's missing) before
      the server. Docs: README, docs/agent-protocol.md, .personal.
      Proof: compose up (seed 0/7 kept), empty bucket seeded (7), draft
      survives a server restart, cold start, test agent races.

## Notes
- `server/node_modules` untracked before the SDK was added (8647757).
