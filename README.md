# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

Formulai is two separate parts, each with its own dependencies, settings
(`.env`) and container:

| Part | Folder | Runs | Default address |
|---|---|---|---|
| **Game server** — the game, lobbies, sessions, tracks; WebSocket (`formulai`) + HTTP API | `server/` | Node | `ws://localhost:8080`, `http://localhost:8080/api/…` |
| **App** — everything in the browser: play, watch, create lobbies, edit sessions and tracks | `app/` | browser (served by Vite / react-router-serve) | `http://localhost:5173` |

### Installation

```bash
cd app && npm install      # the App
cd server && npm install   # the game server
```

### Development

The game server keeps its data (tracks, sessions) in S3 — locally the
`s3` service of `docker-compose.yml` (SeaweedFS on `http://localhost:9100`,
data in the `s3-data` Docker volume). Once:

```bash
docker compose up -d s3    # the local S3 (keep it running)
cd server && npm run seed  # fill it from server/tracks, sessions, backgrounds
```

Then start both (two terminals):

```bash
cd server && npm run dev   # game server on :8080 (waits up to 60 s for S3)
cd app && npm run dev      # the App on :5173
```

`npm run seed` only uploads files that aren't in the bucket yet — it never
overwrites edits. `server/tracks/` and `server/sessions/` are seed data: the
editors save to S3, not to these files.

### Docker

Everything in containers (`server/Dockerfile`, `app/Dockerfile`, each
folder its own build context; `docker-compose.yml` at the root): the local
S3, the game server, the App. Compose doesn't seed: fill an empty bucket
once with `npm run seed` (see above) — without it the server stops with
"run npm run seed".

```bash
docker compose up -d s3 && (cd server && npm run seed)   # first time only
docker compose up --build   # App http://localhost:3010, game server ws://localhost:8090
docker compose down         # keeps the S3 data (down -v deletes it)
```

- Runs next to `npm run dev` (other ports).
- Track editing: the local password is `EDITOR_PASSWORD` in
  `docker-compose.yml` (empty = off). `server/.env` is not used by the
  images.
- The App's `VITE_WS_URL` is baked in at build time (compose: the
  server's port on your machine) — another address needs a rebuild
  (`--build-arg VITE_WS_URL=…`).
- Same S3 data as `npm run dev` (the `s3-data` volume).

### Settings
Copy the example files to `.env` to change anything (no `.env` → the defaults above):
- `app/.env.example` (the App): `VITE_WS_URL` — the game server's **public**
  WebSocket address (the browser connects to it directly); `VITE_API_URL` —
  its HTTP API (default: `VITE_WS_URL` with ws → http).
- `server/.env.example` (the game server): `PORT`, `EMPTY_LOBBY_SECONDS`
  (delete a lobby nobody uses after this long; 600), `EDITOR_PASSWORD` (the
  track editor's password; not set = track editing is off), `FAST_LOBBIES`
  (`false` = no fast training lobbies, e.g. on a public server), and the S3
  bucket: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (defaults: the local S3;
  `S3_ENDPOINT` set but empty = AWS S3 itself).

The bucket holds `tracks/<file>.json` (published), `tracks/drafts/`,
`sessions/<file>.json` and `backgrounds/<file>` (the track editor's trace
images). The server reads it at start and writes through on
every save — run ONE server per bucket.

### Pages (the App)
| Page | What |
|---|---|
| `/racing/player` | Player mode — drive yourself (your own lobby on the server) |
| `/lobbies` | Watch lobbies — follow a client (its front car; a crashed car hands over to the next in line), or a stage (its leader), in a running lobby; shows the stage's 10 fastest laps for the followed kart class (each car once, kept while the lobby runs) |
| `/lobby/create` | Create a lobby fast from an existing session — optionally **fast training** (lockstep: as fast as the agents answer, agents only); gives the lobby id for agents |
| `/session/editor` | Build, edit, save and delete sessions; create a lobby with an unsaved one |
| `/track/editor` | The track editor — opens, saves and publishes tracks on the game server (asks for `EDITOR_PASSWORD`) |

### Track editor and the Track API
The tracks live in the game server's S3 bucket (`tracks/`; drafts in
`tracks/drafts/`). The track editor works on a copy and stores nothing itself:
- **Open** always fetches the track fresh from the server.
- **Save** writes a draft (the game never races drafts).
- **Publish** writes the published file and removes the draft — new
  lobbies race it at once; running lobbies keep the version they started
  with.
- The password is asked once per browser tab; a wrong one asks again. It
  only keeps editing to one person (no accounts, no locks — the last save
  wins).

The editor uses the server's Track API (`X-Editor-Password` header on every
call; wrong or missing → 401, no `EDITOR_PASSWORD` on the server → 503):
`GET /api/tracks` (drafts + published), `GET` / `PUT` / `DELETE
/api/tracks/<drafts|published>/<file>.json` (file names `[a-z0-9_]`). A
published track that a session uses can't be deleted (409). Open, no
password: `GET /api/tracks/layouts` (track and layout names, for the
session editor).

**Backgrounds** (the satellite / plan images the editor traces over) live
in the bucket too (`backgrounds/`, seeded from `server/backgrounds/`).
The editor's Background panel lists them, **Upload…** adds one (png / jpg
/ webp, ≤ 20 MB; the name is made `[A-Za-z0-9_.-]`-safe) and **Delete**
removes one — refused while a published or draft track uses it. A track
stores its background's file name. API: `GET /api/backgrounds` and `GET
/api/backgrounds/<file>` are open (the editor shows them as plain images);
`PUT` (the image bytes) and `DELETE` need the editor password.

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

## Game server (for AI agents)
The game runs on the server; AI agents connect over a WebSocket with the
subprotocol **`formulai`** (`ws://localhost:8080` by default), join a lobby
with their cars, get their cars' `GameState` pushed every `stateMs` they
choose in the join (default 150 ms) and answer with controls. The App
watches the same races.

**Everything an agent needs — what changed from the old protocol, every
message, GameState field by field, the rules — is in
[docs/agent-protocol.md](docs/agent-protocol.md).**

Test agent (uses only the protocol):
```
cd server
npm run test-agent -- --create TrainingEndless --cars 2
```

---

## Tracks and layouts
`track.name` / `track.layout` in GameState are one of these. Loop layouts count
laps over the start/finish line; one-way layouts end the stage at the finish
(one run, whatever `laps` says).

`expectedLapTime` (s) per car: a good, reachable time — the fastest clean
run of a bot driving the real game × 1.3 (loops: lap 1 from the grid).
0 = not set yet.

| Track (`name`) | Layout (`layout`) | Type | Checkpoints | HyrkartCentralen | Hyrkart240cc | Racingkart125cc |
|---|---|---|---|---|---|---|
| Torslanda | GP | loop | 41 | 88.6 | 87.5 | 60.1 |
| Torslanda | Training 1 | one-way | 3 | 5.6 | 7.5 | 4.5 |
| Torslanda | Training 2 | one-way | 3 | 5.7 | 7.5 | 4.5 |
| Torslanda | Training 3 | one-way | 4 | 7.6 | 9.4 | 5.7 |
| Torslanda | Training 4 | one-way | 4 | 8.2 | 9.9 | 6.5 |
| Torslanda | Training 5 | one-way | 3 | 6.8 | 8.2 | 5.5 |
| Torslanda | Training 6 | one-way | 5 | 10.9 | 13.4 | 8.7 |
| Torslanda | Training 7 | one-way | 7 | 13.5 | 14.0 | 8.7 |
| Jarfalla | GP | loop | 35 | 77.7 | 81.4 | 55.4 |
| Jarfalla | GP Short | loop | 25 | 58.3 | 61.2 | 42.2 |
| Jarfalla | Training 1 | one-way | 9 | 21.0 | 24.1 | 16.5 |
| Jarfalla | Training 2 | one-way | 9 | 19.8 | 22.6 | 15.0 |
| Lycksele | GP | loop | 5 | 63.6 | 67.7 | 46.8 |
| Lulea Kallax | GP | loop | 6 | 59.9 | 66.3 | 45.6 |
| Skovde | GP | loop | 8 | 76.1 | 82.8 | 57.7 |

### Start grid
Cars start in painted boxes behind the start line, two columns, following the
road (a box can sit in a curve). Each car's front is at the front of its box.

- A lobby's cars get a new random order every stage, filled from pole (one
  car → pole; more cars than boxes → round again from pole). A car that
  joins a running race takes the lowest free box.
- A restarted car goes back to its own box; `completedMeters` is 0 there.

Every track: boxes side by side, 2 × 1.2 m. Per track (rows: box front to
box front):

| Track | Start line → first box | Rows | Columns |
|---|---|---|---|
| Torslanda, Jarfalla | 2 m | 3 m | 3 m |
| Lycksele | 1.5 m | 3 m | 3.7 m |
| Lulea Kallax | 1.7 m | 3.2 m | 4.3 m |
| Skovde | 1.5 m | 4 m | 4.6 m |

| Track | Layout | Boxes |
|---|---|---|
| Torslanda | GP | 20 |
| Torslanda | Training 1, 2 | 8 |
| Torslanda | Training 3, 4, 5 | 10 |
| Torslanda | Training 6, 7 | 14 |
| Jarfalla | GP, GP Short, Training 1, 2 | 20 |
| Lycksele | GP | 24 |
| Lulea Kallax | GP | 24 |
| Skovde | GP | 28 |

### Sessions
| Session | Stages |
|---|---|
| Training One (`TrainingOne`) | Torslanda Training 1 → 7, Jarfalla Training 1 → 2 (1 run each, 9 stages) |
| Training Endless (`TrainingEndless`) | 5 laps each of Lycksele GP, Lulea Kallax GP, Skovde GP, Torslanda GP, Jarfalla GP (5 stages), repeating forever (`"repeat": true`) |

These two are seeded from `server/sessions/`. Any lobby can race any session: create one at
`/lobby/create` (or `req:lobby/create`). Player mode races Training One.
Both offer all three cars: an agent picks a kart per car when it joins;
Player mode drives the first (HyrkartCentralen).

More sessions: build them in the **session editor** (`/session/editor`) —
they're saved in the server's S3 bucket and listed by `GET /api/sessions`.
Every session (Training One too) can be changed or deleted there; Player
mode needs Training One (a deleted one comes back with `npm run seed`).
A lobby can also race a session that isn't saved at all.

A session is raced in one of two **modes** (`"mode"` in the session; the
session editor's Mode select):
- **training** (the default, both sessions above): each client goes
  through the stages on its own — `nextStage` moves only that client's
  cars, so clients can be on different stages at once.
- **race**: one shared stage for the whole lobby — `nextStage` moves every
  car.

## Cars
`car.name` / `car.maxSpeed` in GameState are one of these. `speed` and
`maxSpeed` are km/h; reverse is capped at −`maxSpeed` / 2.

Turning is limited by tyre grip: the turn rate is the steering geometry
(wheelbase, wheel angle) but at most grip × 9.81 / speed, so the faster a
kart goes the less it can turn — brake before tight corners. At full lock
the geometry decides below ~16–19 km/h, grip above (HyrkartCentralen at
60 km/h: about a 24 m radius). Grip values are estimates.

| Car (`name`) | Kart | `maxSpeed` (km/h) | Size (m) | Grip (g) | Used by |
|---|---|---|---|---|---|
| HyrkartCentralen | Sodi RSX2 electric rental kart (Gokartcentralen Gothenburg) | 60 | 1.95 × 1.38 | 1.2 | Training One, Training Endless (Player mode drives this one) |
| Hyrkart240cc | Petrol rental kart (Torslanda) | 80 | 2.0 × 1.4 | 1.2 | Training One, Training Endless (agents) |
| Racingkart125cc | 125cc racing kart | 115 | 1.8 × 1.4 | 1.8 | Training One, Training Endless (agents) |
