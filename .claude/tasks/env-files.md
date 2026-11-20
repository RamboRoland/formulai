# Settings files: only server/.env and app/.env

Robin 2026-11-20: "deploy/.env should not exist". `server/.env` and
`app/.env` are the only settings files, locally AND in production;
production gets them generated from GitHub secrets by the deploy workflow.

## Part 1 — local (Space keys out of deploy/.env)

- [x] 1. `server/scripts/space.ts` reads `SOURCE_S3_*` from `process.env`
      (server/.env, loaded by the npm scripts); fetch.ts comment. One file,
      own names (Robin: no extra .env files; S3_* = the server's bucket)
- [x] 2. `SOURCE_S3_*` into server/.env (values from deploy/.env);
      `npm run fetch` OK 2026-11-20 (13 already the same)
- [x] 3. Docs: server/.env.example (Space block; "npm run seed" → fetch),
      README (fetch section, Settings), .personal/CLAUDE.md
- [ ] 4. Commit on a branch (as Robin)

## Part 2 — production (deploy/.env gone)

Values as GitHub secrets / variables (Robin adds them: gh here is read-only).
Robin keeps them in a password manager too (secrets can't be read back).

- **server/.env**: workflow writes it from secrets (`S3_*` = the Space,
  `EDITOR_PASSWORD`, `FAST_LOBBIES=false`, `LOG_INCIDENTS`), copies it to
  the Droplet `~/formulai/server/.env`; compose `server: env_file:
  ../server/.env` instead of the `${…}` list. server/.dockerignore keeps
  .env out of the image (already).
- **app/.env**: build-time (Vite) → written in the images job before the
  App build (`VITE_WS_URL`, `VITE_API_URL` from `vars.APP_DOMAIN`); remove
  `.env` from app/.dockerignore (public values, in the JS anyway); drop the
  build-args.
- **Caddy**: the workflow fills `APP_DOMAIN`, `BASIC_AUTH_USER`,
  `BASIC_AUTH_HASH` into the Caddyfile it copies (Robin's choice); no env.
- **Images**: names written in the compose file (ghcr.io/ramboroland/…), no setting.
- The workflow fails before deploying if any value is empty (never start
  without basic auth / keys).
- Cut-over: secrets in GitHub → deploy → check site + login + a lobby →
  only then delete `~/formulai/deploy/.env` on the Droplet and the local copy.
- Docs: deploy/.env.example removed; README "Hosting" steps 6 + 8;
  workflow + compose + Caddyfile comments; .personal/CLAUDE.md.

Steps for part 2 planned in detail (and approved) after part 1 is committed.
