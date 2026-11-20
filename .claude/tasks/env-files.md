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

### GitHub (repository level, added by Robin 2026-11-20)

- Secrets: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `EDITOR_PASSWORD`,
  `BASIC_AUTH_HASH` (no quotes), + existing `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`
- Variables: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `BASIC_AUTH_USER`,
  `LOG_INCIDENTS`, + existing `APP_DOMAIN`, `DEPLOY_HOST`, `DEPLOY_USER`

### Steps

- [x] P1. `deploy/docker-compose.yml`: server `env_file: ../server/.env`
      (no `environment:`); images written out
      (`ghcr.io/ramboroland/formulai-server:latest`, `…-app:latest`); Caddy
      without `environment:`
- [x] P2. `deploy/Caddyfile` stays the template (`{$APP_DOMAIN}`,
      `{$BASIC_AUTH_USER}`, `{$BASIC_AUTH_HASH}`); `deploy/settings.py`
      replaces them with plain text (not sed: the hash has `$` and `/`)
- [x] P3. (`deploy/settings.py` writes both files + the check; tested with
      fake values: caddy:2.10 adapt, docker compose config v5.6.1 — Droplet
      has v5.7.0) `.github/workflows/deploy.yml`, deploy job:
      - check: every secret / variable above non-empty, else fail before SSH
      - write `server/.env` (`S3_*`, `S3_FORCE_PATH_STYLE=false`,
        `EDITOR_PASSWORD`, `FAST_LOBBIES=false`, `LOG_INCIDENTS`) + the
        filled Caddyfile on the runner; copy to the Droplet
        (`~/formulai/server/.env`, `~/formulai/deploy/Caddyfile`, chmod 600)
- [x] P4. SKIPPED (Robin 2026-11-20): the App's values aren't secret and the
      images job already bakes them in from `vars.APP_DOMAIN` (build-args) —
      no app/.env in production; app/.env.example gets a note (P5)
- [x] P5. Docs (+ app/.env.example note, server/.env.example bucket name): delete `deploy/.env.example`; README "Hosting" 6 + 8;
      comments in compose / Caddyfile / workflow; `.personal/CLAUDE.md`
- [x] P6. Check before merge: the workflow YAML parses; the Caddyfile fill
      tested locally with a fake hash containing `$` and `/`; `docker
      compose config` on the compose file with a fake server/.env
- [x] P7. Cut-over (Robin pushes): deploy runs → check the site, the basic
      auth login, a lobby, an editor login (EDITOR_PASSWORD) →
      only then remove `~/formulai/deploy/.env` on the Droplet (ask first).
      Rollback: revert + push (the old file is still on the Droplet until P7)
      Done 2026-11-20: deployed 10b33ec, server loaded from the Space, all 9
      server values set, Caddy fine; `~/formulai/deploy/.env` deleted on the
      Droplet (compose config OK without it). Left: Robin deletes his local
      deploy/.env after saving the values in a password manager
