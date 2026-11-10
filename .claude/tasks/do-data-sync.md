# DigitalOcean = the data source (fetch, lap times, seed data out of git)

Robin (2026-11-10): the DO Space is the source from now on. Only two
things: (1) fetch DO → local S3 to run locally, (2) an easy way to update
expectedLapTimes in the DO S3. Seed folders local only, not in the
(public) repo; old versions stay in git history (no rewrite).

DO keys: `deploy/.env` (S3_ENDPOINT, S3_REGION, S3_BUCKET,
S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY; git-ignored, on the Mac). Values
never printed.

## Commands (server/)
- `npm run fetch` — DO → local S3 (config.s3, :9100): tracks/,
  tracks/drafts/, sessions/, backgrounds/ byte for byte, an exact copy
  (local extras deleted). Nothing is written to DO. Then restart the
  local server (it reads S3 at start).
- `npm run laptimes` — the bot (scratchpad laptimes/drive.ts, cleaned)
  on DO's published tracks × every kart: settings ladder, best clean run
  × 1.3, rounded 0.1 s. Prints the table (now → new). `--yes` writes
  ONLY the expectedLapTimes numbers to DO (text replacement + checks:
  everything else identical, as update.ts). Hosted reload: open question.

## Plan
- [x] 1. .gitignore + `git rm --cached` server/tracks, sessions,
      backgrounds (15 files, still on disk, md5 unchanged)
- [x] 2. Dockerfile: drop COPY sessions / tracks / backgrounds (CI checkout
      has no folders); .dockerignore: the three folders. Proof: image
      builds from the git-tracked files only (as CI), no tracks /
      sessions / backgrounds in /srv; test image removed
- [x] 3. `scripts/fetch.ts` + `storage.readOnlyBucket` (list + get only;
      list / getBytes share the code). Proof: throwaway local bucket
      formulai-fetchtest — run 1 copies all 13, after changing 1 + adding
      1: 1 updated + 1 deleted, run 3: 0 changes; each time = DO byte for
      byte (keys, bytes, content types); bucket deleted. Robin's local
      bucket: 0 changes (already = DO). DO checksums before = after
- [x] 4. `scripts/laptimes.ts` (+ `scripts/space.ts` shared with fetch,
      `storage.writableBucket`: getText / putText; opened only with
      --yes). Proof: dry run on DO = 0 changes (reproduces the values of
      2026-11-10), ~9 s. Write path on a throwaway local bucket (DO's
      tracks, one value set wrong): dry run 1 change, --yes writes 1 file
      → byte for byte = DO, again 0; bucket deleted. DO checksums
      unchanged. Not tested: "saved while the bot ran" skip
- [x] 5. Docs: README (local env = fetch, lap times, Hosting step 7),
      `.personal/CLAUDE.md` (Storage, Settings), s3-storage.md
- [ ] 6. Commit (Robin checks it), push main = deploys the steering fix

## Decided
After `laptimes --yes` the hosted server still has the old values in
memory (it reads S3 at start): the script only reminds; Robin restarts it
himself (b — no lobby is dropped without his say).
