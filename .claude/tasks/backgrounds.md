# Phase 13: track editor backgrounds in S3

Robin (2026-11-03): backgrounds are uploaded from the track editor and
live in the server's S3 bucket. Decisions:
- `GET` of an image is open (plain `<img src>`, browser cache); upload and
  delete need the editor password.
- The 6 bundled images (`app/src/assets/trace-maps`, 16 MB) move to
  `server/backgrounds/` as seed data (`npm run seed`); the App no longer
  bundles any.
- Uploads up to 20 MB (other API calls keep 5 MB).
- Delete: only while no track (published or draft) uses it → 409.

## Format
- S3: `backgrounds/<file>` (png / jpg / jpeg / webp), stored with its
  content type. File names `[A-Za-z0-9_.-]+` + an image extension.
- A track's `editorBackground.src` = the background's FILE NAME. Old
  values (`/app/assets/trace-maps/X.png`, Vite URLs) → by file name, so
  tracks need no re-save.

## API (protocol/http.ts, both copies)
```
GET    /api/backgrounds              → BackgroundList { backgrounds: [{ file, size }] }   open
GET    /api/backgrounds/:file        → the image (Content-Type, cache)                    open
PUT    /api/backgrounds/:file        body: the image bytes (≤ 20 MB) → BackgroundSaved    password
DELETE /api/backgrounds/:file        → BackgroundDeleted; 409 while a track uses it     password
```

## Steps (each: proof, ask before the next)
- [x] 13a. Server: bytes in `storage.ts`, `backgroundStore.ts`, the four
      routes, protocol types; seed uploads `server/backgrounds/`. Proof (curl, test bucket): list, get = the file
      byte for byte, upload / delete, 401 without password, 413 over 20 MB,
      409 for a used one, bad name / type → 400.
- [x] 13b. Editor: picker lists the server's backgrounds, Upload… button,
      Delete button, `src` = file name (old paths by name), images from
      `/api/backgrounds/<file>`; Vite glob removed; the images `git mv`'d
      to `server/backgrounds/` here (not in 13a — the editor needed them
      until it switched). Proof in the browser:
      Torslanda opens with its background, upload + select + save a test
      track, delete refused while used.
- [x] 13c. Docs: README, .personal (CLAUDE.md, websocket.md,
      vector-tracks.md); server image carries backgrounds/ as seed data.
      Proof: compose seed 0 / 13 kept on the real bucket, 13 into an
      empty one; images served on :8090 byte for byte. App build 4.7 MB.
