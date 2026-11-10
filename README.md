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

The game server keeps its data (tracks, sessions, backgrounds) in S3. The
source is the DigitalOcean Space (see Hosting); locally the `s3` service
of `docker-compose.yml` (SeaweedFS on `http://localhost:9100`, data in
the `s3-data` Docker volume) holds a copy of it:

```bash
docker compose up -d s3     # the local S3 (keep it running)
cd server && npm run fetch  # local S3 = a copy of the Space
```

Then start both (two terminals):

```bash
cd server && npm run dev   # game server on :8080 (waits up to 60 s for S3)
cd app && npm run dev      # the App on :5173
```

`npm run fetch` makes the local S3 an exact copy of the Space (`tracks/`,
`tracks/drafts/`, `sessions/`, `backgrounds/`; local-only files are
deleted) and only reads the Space. It needs the Space's keys in
`deploy/.env` (git-ignored, as on the server; see `deploy/.env.example`).
Run it again whenever you want the hosted data; restart the game server
after it (it reads S3 at start). Local edits stay local — the next fetch
replaces them.

**Expected lap times** (`expectedLapTimes` per layout and kart):

```bash
cd server && npm run laptimes            # a bot drives every Space track: now → new
cd server && npm run laptimes -- --yes   # writes the new values into the Space
```

Only those numbers change in the track files. The hosted server reads S3
at start: restart it to load them (`docker compose restart server` on the
Droplet; running lobbies are dropped), and `npm run fetch` for local.
Re-run after physics or layout changes.

**Renaming a kart class** (sessions' `cars`, tracks' `expectedLapTimes`
keys in the Space — nothing else changes, checked):

```bash
cd server && npm run rename-kart -- <old> <new>          # what would change
cd server && npm run rename-kart -- <old> <new> --yes    # writes it into the Space
```

Run it with the code that has the new name, just **before** deploying it
(a server with the new code skips sessions that still use the old name).

### Docker

Everything in containers (`server/Dockerfile`, `app/Dockerfile`, each
folder its own build context; `docker-compose.yml` at the root): the local
S3, the game server, the App. Fill the local S3 with `npm run fetch` (see
above) — an empty one stops the server with "fill it with `npm run fetch`".

```bash
docker compose up -d s3 && (cd server && npm run fetch)  # first time / to refresh
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

### Hosting (one server, DigitalOcean)

The containers on one Droplet (`deploy/docker-compose.yml`): Caddy (HTTPS
on 443 for one name, basic auth in front of everything) → the App and the
game server. The data is in
DigitalOcean Spaces (S3) — the Droplet holds none, it can be rebuilt any
time. Only Caddy is reachable from outside. The images are built by GitHub Actions
(`.github/workflows/deploy.yml`): every push to `main` type-checks, builds
both images, pushes them to the GitHub Container Registry (ghcr.io) and
restarts the server's containers. Until the variables below are set, a push
only type-checks.

```
App          https://APP_DOMAIN                  → app:3000
Game server  wss://APP_DOMAIN/ws, https://APP_DOMAIN/api/… → server:8080 → Spaces (S3_BUCKET)
```

Everything asks for the basic auth login (`BASIC_AUTH_USER` /
`BASIC_AUTH_HASH`): the browser once for the page (the App's API and
WebSocket calls reuse it — same domain), agents with an `Authorization`
header (`docs/agent-protocol.md`, "Connecting").

Set up once:

1. **Droplet**: Marketplace image "Docker on Ubuntu" (Docker + Compose
   installed), Amsterdam (AMS3), 1 vCPU / 1 GB (the images are built on
   GitHub, not here). Add your own SSH key. Plain Ubuntu works too: install
   Docker from Docker's apt repository (docs.docker.com → Install Docker
   Engine on Ubuntu; `docker-ce` + `docker-compose-plugin`).
2. **Firewall** (Networking → Firewalls, on the Droplet): inbound TCP 22,
   80, 443 and UDP 443 — nothing else. (Docker opens published ports past
   the server's own firewall; deploy/docker-compose.yml only publishes
   Caddy's.)
3. **Name**: no domain needed to start — sslip.io names contain the IP
   (`164.90.1.2` → `formulai.164-90-1-2.sslip.io`). A real domain later:
   an A record to the IP, change the name in steps 6 and 8 (the App is
   rebuilt with the new name on the next push).
4. **Deploy user** (as root on the Droplet): a user only for the pipeline,
   with a key of its own:
   ```bash
   adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
   mkdir -p /home/deploy/.ssh /home/deploy/formulai/deploy
   ssh-keygen -t ed25519 -N "" -f /root/deploy_key   # the pipeline's key
   cat /root/deploy_key.pub > /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy && chmod 700 /home/deploy/.ssh
   ```
5. **Space** (Spaces Object Storage → Create, Amsterdam AMS3, File
   Listing: Restricted): any free name (names are unique per region) =
   `S3_BUCKET`. Then API → Spaces Keys → a key = `S3_ACCESS_KEY_ID` /
   `S3_SECRET_ACCESS_KEY` (the secret is shown once).
6. **Settings** in `/home/deploy/formulai/deploy/.env` (only on the server,
   never in git), from `deploy/.env.example`: the name, the basic auth
   user + the bcrypt hash of its password (`docker run --rm caddy:2.10
   caddy hash-password --plaintext '<password>'`, in single quotes in the
   file), a long `EDITOR_PASSWORD` (`openssl rand -hex 24`), the Space and
   its key. Then `chown deploy:deploy` it.
7. **Data**: the Space is the source of all tracks, sessions and
   backgrounds (it was filled once with `npm run seed` from local seed
   folders, which aren't in git). A new Space: copy the objects over from
   the old one (e.g. with an S3 client).
8. **GitHub** (repo → Settings → Secrets and variables → Actions):
   - Variables: `DEPLOY_HOST` = the IP, `DEPLOY_USER` = `deploy`,
     `APP_DOMAIN` = the name (e.g. `formulai.164-90-1-2.sslip.io`)
   - Secrets: `DEPLOY_SSH_KEY` = `/root/deploy_key` (the private key; then
     delete it from the server), `DEPLOY_KNOWN_HOSTS` = the output of
     `ssh-keyscan <IP>` (check it against the Droplet's own:
     `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`)
9. **First deploy**: Actions → deploy → Run workflow (or push to `main`).
   Then open `https://APP_DOMAIN`.

After that: push to `main` = deployed (Actions shows each run). Logs on the
server: `docker compose logs -f server` (in `~/formulai/deploy`).

- Fast training is off there (`FAST_LOBBIES=false`): run it locally.
- The data (tracks, sessions, backgrounds) lives in the Space; the
  Droplet needs no backup. One server per Space (it keeps the data in
  memory and writes through).

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
| `/lobbies` | Watch lobbies — follow a client (its front car; a crashed car hands over to the next in line), or a stage (its leader), in a running lobby; shows the stage's 10 fastest laps for the followed kart class (each car once, kept while the lobby runs); delete an empty lobby (nobody driving in it) |
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
in the bucket too (`backgrounds/`).
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
subprotocol **`formulai`** (`ws://localhost:8080` by default; the hosted
server `wss://<domain>/ws` behind basic auth, see `docs/agent-protocol.md`),
join a lobby with their cars, get their cars' `GameState` pushed every
`stateMs` they choose in the join (default 150 ms) and answer with
controls. The App watches the same races.

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
run of a bot driving the real game × 1.3 (loops: lap 1 from the grid;
`npm run laptimes`, see Development; it brakes in a straight line). 0 =
not set yet. Values as of 2026-11-10, grip cap (the Space has the current ones).

| Track (`name`) | Layout (`layout`) | Type | Checkpoints | HyrkartCentralen | Hyrkart270cc | Racingkart125cc |
|---|---|---|---|---|---|---|
| Torslanda | GP | loop | 41 | 105.7 | 124.7 | 83.4 |
| Torslanda | Training 1 | one-way | 3 | 6.4 | 10.4 | 5.2 |
| Torslanda | Training 2 | one-way | 3 | 11.8 | 16.9 | 9.5 |
| Torslanda | Training 3 | one-way | 4 | 8.5 | 13.1 | 6.8 |
| Torslanda | Training 4 | one-way | 3 | 11.4 | 15.6 | 9.6 |
| Torslanda | Training 5 | one-way | 3 | 11.1 | 14.9 | 9.3 |
| Torslanda | Training 6 | one-way | 3 | 13.4 | 18.2 | 11.8 |
| Torslanda | Training 7 | one-way | 7 | 15.2 | 19.5 | 12.1 |
| Jarfalla | GP | loop | 35 | 94.7 | 109.2 | 78.4 |
| Jarfalla | GP Short | loop | 25 | 71.2 | 82.6 | 59.3 |
| Jarfalla | Training 1 | one-way | 9 | 26.5 | 31.6 | 22.2 |
| Jarfalla | Training 2 | one-way | 9 | 25.7 | 31.6 | 21.7 |
| Lycksele | GP | loop | 5 | 81.5 | 95.3 | 66.2 |
| Lulea Kallax | GP | loop | 6 | 73.6 | 85.4 | 61.2 |
| Skovde | GP | loop | 8 | 94.2 | 105.8 | 80.8 |

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
| Training Endless (`TrainingEndless`) | 5 laps each of Lycksele GP, Lulea Kallax GP, Skovde GP, Torslanda GP, Jarfalla GP (5 stages) — an agent that joins with `repeat: true` goes round it forever |

Sessions live in the Space (`sessions/`). Any lobby can race any session: create one at
`/lobby/create` (or `req:lobby/create`). Player mode races Training One.
Both offer all three cars: an agent picks a kart per car when it joins;
Player mode drives the first (HyrkartCentralen).

More sessions: build them in the **session editor** (`/session/editor`) —
they're saved in the server's S3 bucket and listed by `GET /api/sessions`.
Every session (Training One too) can be changed or deleted there; Player
mode needs Training One (a deleted one locally comes back with `npm run
fetch`; on the hosted server, save it again in the session editor).
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

Turning is limited by tyre grip, and the karts slide (tyre-slip
steering): they don't follow their wheels exactly — the tyres grip most at
a small slip angle and less beyond it, so the faster a kart goes the less
it can turn (brake before tight corners), and steering too much at speed
understeers: the kart pushes wide and scrubs speed (at 40 km/h the
tightest line is at about 20 % steering on the rental karts, 30 % on the
Racingkart; full lock turns wider). They turn in with some inertia and
less sharply at walking pace (rigid rear axle).

Gas (`forward`), reverse (`backward`) and `brake` are pedals, 0..1
(`true` / `false` = 1 / 0). The gas pulls with the engine's force —
torque through the gearing, at most its power — against rolling
resistance and air drag, so part gas settles at a lower speed and the
pull fades towards top speed (the governor / limiter); off the gas the
electric kart regenerates, the Rotax engine-brakes, the 270cc
freewheels. Gas and brake share the rear tyres' grip with turning, like
a real kart: the gas only drives with the grip a slide leaves (a sliding
rear can't push, so a big weave doesn't hold a drift), and braking moves
weight onto the front. All three karts brake on the rear axle only, and
**karts are brake-sensitive**: the rear tyres stop only so hard, past
that the rear wheels lock (`brake` ≈ 0.38 / 0.54 / 0.59), a locked kart
stops worse and spins. Brake in a straight line, a little below the
lock. GameState `car` shows
the slide, normalised: `yawRate`, `slipAngle`, `lateralG`,
`lateralSpeed` (-1..1, + = right), `longitudinalG` (-1..1, + = speeding
up, − = braking) and `gripFront` / `gripRear` (0–1,
grip in use; docs/agent-protocol.md). Reverse steers simply (no slide;
those fields 0). The steering wheel turns at most 360°/s (full lock in 0.25 s on
the rental karts, 0.17 s on the Racingkart): `steering` is where you
want it, GameState `car.steering` where it is. Values from the real karts
where published, the rest estimates.

| Car (`name`) | Kart | `maxSpeed` (km/h) | 0–60 km/h | Size (m) | Grip (g) | Used by |
|---|---|---|---|---|---|---|
| HyrkartCentralen | Sodi RSX2 electric rental kart (Gokartcentralen Gothenburg; 42 Nm, regen) | 60 | 5.8 s | 1.865 × 1.35 | 1.15 | Training One, Training Endless (Player mode drives this one) |
| Hyrkart270cc | Caroli Hammerhead, Honda GX270 petrol rental kart (Göteborgs Gokartcenter, Torslanda; 9 hp, centrifugal clutch) | 80 | 13.5 s | 1.95 × 1.35 | 1.15 | Training One, Training Endless (agents) |
| Racingkart125cc | Rotax 125 Max Senior racing kart (30 hp, centrifugal clutch, slicks, rear brake only) | 115 | 3.4 s | 1.8 × 1.4 | 1.6 | Training One, Training Endless (agents) |
