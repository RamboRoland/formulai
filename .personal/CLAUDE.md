# Formulai

Go-kart racing simulator designed for AI training. The GAME SERVER owns the
game (physics, tracks, sessions, lobbies) and pushes state; AI agents drive
over WebSocket; the browser App only renders and edits. Agents need no App.

## Tech Stack

**App (`app/`, browser — render + editors, no game logic):**
- React 19 / React Router 7 (routes mount pure-TS views) / TypeScript 5.8
- TailwindCSS 4, Vite 6
- HTML Canvas (2D track) + three.js (3D props, cars, camera modes)
- Own copy of the track geometry code — for the TRACK EDITOR only

**Game server (`server/`, Node):**
- TypeScript 5.3, ts-node / nodemon for dev
- ws (WebSocket, subprotocol `formulai`) + an HTTP API on the same port
- The game engine, cars, tracks, sessions, lobbies

Server and App are totally separate: no shared files. The only contract is
the protocol types, kept as two IDENTICAL copies (`server/src/protocol/`,
`app/src/protocol/`) — change both. Each is its own project folder (own
package.json; run `npm run dev` inside it).

## Pages (App) and roles

| Page | What |
|---|---|
| `/racing/player` | Player mode: own lobby (TrainingOne, auto-advance), keyboard car |
| `/lobbies`, `/lobbies/:id` | Watch a lobby: follow a client (its front car, past crashed ones) or a stage (its leader); fastest laps; delete an empty lobby (list) |
| `/lobby/create` | Create a lobby from a session (optionally fast training) |
| `/session/editor` | Build / save / delete sessions; create a lobby with one |
| `/track/editor` | Track editor; saves through the server (editor password) |

Roles on the server: **agent** (AI, one or more cars), **player** (the App's
keyboard car), **viewer** (the App watching a lobby). Same GameState for
agent and player.

## Folder Structure

```
server/
├── src/
│   ├── index.ts, websocket.ts    # HTTP + WS on PORT; loads game files
│   ├── config.ts                 # every setting (server/.env)
│   ├── loadGameFiles.ts          # tracks + sessions from S3 → registries
│   ├── storage.ts                # the S3 bucket (the only S3 code)
│   ├── httpApi.ts                # Session, Track, Background API; karts, layouts
│   ├── backgroundStore.ts        # trace backgrounds in S3 (upload, delete if unused)
│   ├── sessionStore.ts           # sessions in S3; save / delete (all alike)
│   ├── trackStore.ts             # drafts + published tracks; publish = live
│   ├── LobbyGame.ts              # one lobby's engine + clock (timer / lockstep)
│   ├── formulai/                 # FormulaiServer (messages, tokens, sweep),
│   │                             #   Lobby (owners, viewers, progress, laps),
│   │                             #   gameState, renderTrack, incidentLog
│   ├── protocol/                 # the contract (copy in app/src/protocol/)
│   └── game/                     # the game: engine/ (GameEngine, rays,
│                                 #   carBody, trackProps), cars/ (Car, gokarts/,
│                                 #   physics/: tyre, loads, rearAxle,
│                                 #   drivetrain, resistance, steering,
│                                 #   chassis, kartConstants, constants
│                                 #   + SYMBOLS.md),
│                                 #   sessions/ (Session, SessionProgress,
│                                 #   registry), tracks/ (Track, registry,
│                                 #   serialize, vector/), Player.ts
├── tracks/, sessions/,           # old seed data, git-ignored (local only)
│   backgrounds/
├── scripts/                      # testAgent.ts (protocol only), fetch.ts
│                                 #   (Space → local S3), laptimes.ts
│                                 #   (expectedLapTimes into the Space),
│                                 #   incidents.ts (incident logs, read),
│                                 #   space.ts (SOURCE_S3_* keys), seed.ts,
│                                 #   brakingSuite.ts (npm run braking-suite:
│                                 #   braking / steering scenarios, headless,
│                                 #   --compare old vs new), physicsTrace.ts
│                                 #   (npm run physics-trace: every state field
│                                 #   per tick as exact doubles → cmp),
│                                 #   sensitivity.ts (npm run sensitivity:
│                                 #   each kart value ±10 % → what moves)
└── Dockerfile                    # image, no data (+ app/Dockerfile,
                                  #   docker-compose.yml: s3 = SeaweedFS,
                                  #   server, app; seed service commented out)

app/                              # the App project: package.json, vite /
│                                 #   react-router (appDirectory "src") /
│                                 #   tsconfig, public/, .env
└── src/
    ├── views/                    # HomeView, ServerRacingView (+ SinglePlayer,
    │   │                         #   LobbyViewer), Lobbies, CreateLobby,
    │   │                         #   SessionEditor, TrackEditor + TrackFileMenu
    │   └── editorTabs/           # Track, Outline, Layout (checkpoints, tyre walls)
    ├── engine/                   # Renderer, Scene3D, DrawTrack, FrameLoop,
    │                             #   tireMarks, rubberLine (draw only)
    ├── hud/                      # StatsBox, FastestLaps
    ├── services/                 # formulaiClient (WS), serverApi (HTTP)
    ├── tracks/                   # editor geometry (Track, serialize, vector/),
    │                             #   store.ts = Track API client
    ├── protocol/                 # copy of server/src/protocol
docs/agent-protocol.md            # for agent authors
deploy/                           # production on one Droplet: docker-compose.yml
│                                 #   (Caddy HTTPS + basic auth, one domain:
│                                 #   /api + /ws → server, rest → app; data in
│                                 #   DO Spaces), Caddyfile, .env.example
│                                 #   (README "Hosting")
.github/workflows/deploy.yml      # push to main: type-check → images to ghcr.io
                                  #   → SSH: pull + up (skipped until vars are set)
```

Tracks are vector JSON files (see `.personal/vector-tracks.md`). No PNG
assets or collision masks.

## Settings

- App (`app/.env`, build time): `VITE_WS_URL` (the server's PUBLIC WS address;
  hosted: `wss://<domain>/ws`, behind basic auth — the browser reuses the
  page's login, same domain), `VITE_API_URL` (default: WS URL with ws →
  http; hosted: `https://<domain>`).
- Server (`server/.env`): `PORT` (8080), `EMPTY_LOBBY_SECONDS` (600),
  `EDITOR_PASSWORD` (unset = Track API off), `FAST_LOBBIES` (`false` =
  fast lobbies refused with createError; public server), `LOG_INCIDENTS`
  (`true` = incident logs, off by default), `S3_ENDPOINT` (default the
  local S3 `http://localhost:9100`; set but empty = AWS), `S3_REGION`,
  `S3_BUCKET` (formulai), `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
  (default the local keys, `seaweedfs/s3.json`), `S3_FORCE_PATH_STYLE`.

## Storage (S3)

All server data is in ONE S3 bucket (`storage.ts`): `tracks/<file>.json`
(published), `tracks/drafts/<file>.json`, `sessions/<file>.json`,
`backgrounds/<file>` (editor trace images, png / jpg / webp),
`logs/incidents/<YYYY-MM-DD>/<lobby>-<ms>-<n>.jsonl.gz` (incident logs,
`formulai/incidentLog.ts`: LOG_INCIDENTS=true, not fast lobbies; spin =
> 8 km/h + |body slip| > 20°, or a crash; 3 s before + 2 s after at 20
samples/s; written every minute + on lobby close; the server deletes
days older than 30 at start and every 24 h — the Space key can't set a
lifecycle rule; `npm run incidents` reads them; fetch doesn't copy
logs/; plan `.claude/tasks/incident-logs.md`). Read
into the registries at start (`index.ts` waits up to 60 s for the bucket;
missing → "fill it with npm run fetch"), written through on every save;
one server per bucket. THE SOURCE is the DigitalOcean Space (since
2026-11-10; `.claude/tasks/do-data-sync.md`). Locally: `docker compose up
-d s3` (SeaweedFS 4.09, host port 9100, volume `s3-data`, volumes capped
at 64 MB — uncapped it reserved ~1 GB per volume and filled Docker's
disk), filled by `npm run fetch` = an exact copy of the Space (tracks/,
tracks/drafts/, sessions/, backgrounds/; local extras deleted; the Space
only read via `storage.readOnlyBucket`; keys = `SOURCE_S3_*` in
`server/.env` via `scripts/space.ts` — the server itself only reads
`S3_*`, so it never reaches the Space by mistake). The only scripts that write to the Space
(`storage.writableBucket`): `npm run laptimes [-- --yes]` (only
expectedLapTimes numbers) and `npm run rename-kart -- <old> <new> [--yes]`
(a kart class in sessions' cars + tracks' expectedLapTimes keys; nothing
else, checked; run just BEFORE deploying the code with the new name).
All: restart the server after (registries load at start).
server/tracks, sessions, backgrounds are git-ignored (local only, an old
snapshot; not in the image); `npm run seed` (local folders → empty
bucket) is kept but not the way in any more.

## Game Loop (server)

`LobbyGame` steps the `GameEngine` in fixed `STEP_SECONDS` = 1/60 s steps:
- Real time: a timer that wakes when the next step is due (setTimeout,
  ~60 wakeups/s) + accumulator (at most `MAX_CATCH_UP_STEPS` = 10 in one
  go after a stall). Each agent gets the state every `stateMs` it
  chose in `req:agent/join` (`STATE_MS`: default 150, 16–1000; `Owner.
  stateMs` / `nextState`): checked after each step, a fixed schedule
  (next = previous + stateMs, more than one interval behind → now +
  stateMs), answered or not. The race doesn't wait. Players get every tick.
  A client that reads slower than the server sends (`FormulaiServer.send`,
  `ws.bufferedAmount`): > 1 MB waiting → its states / viewer frames are
  skipped (not in fast training), everything else still goes; > 16 MB →
  closed (its cars leave). Before 2026-11-14 it all piled up in memory
  and the Droplet's kernel killed the server (`.claude/tasks/server-memory.md`)
- Fast training (`fast` lobby): lockstep — `Lobby` steps, pushes state with
  tick N, waits for every agent's `req:agent/controls { tick: N }`, steps at
  once (no cap). An agent silent 5 s is dropped (close 4000). A finished
  session doesn't step → checked again every 100 ms.

One step (`GameEngine.step` → `tickPlayer` per car):
1. Controls → physics (speed, steering, position); a crashed car
   (hasCollision) skips it: frozen until restart
2. Collision against the track outline + tyre walls (no car vs car)
3. The 8 rays
4. Checkpoints / laps, completedMeters, direction
5. `stepped` → Lobby: announce restarts, push agent/player state, push
   viewer frames (20/s: every 3rd step, fast ≤ 20/s of real time; a
   player watching its own lobby: every step), re-send members on a stage change

Controls are whatever each car got last. The race starts at the first join;
the last one out pauses it.

## Car Physics (`server/src/game/cars/Car.ts` + `physics/`)

- Properties: speed, angle, position (x, y — NOT the center:
  center = x + widthPx/2, y + lengthPx/2), collision state, rays
- Body points: `game/engine/carBody.ts` — `carPoint(car, fx, fy)` (fx +1 front,
  fy +1 the car's right, in half-length / half-width units) and
  `carCorners(car)` (FL, FR, RR, RL = clockwise on screen)
- Direction (`car.heading` -1|0|1, `car.facing` boolean):
  `GameEngine.updateDirection`, last in tickPlayer. Nearest route point on
  leg `currentCheckpoint - 1` (leg 0 before the start → start direction),
  searched ±10 m around the last one (`PlayerStage.nearLeg/nearSample`);
  track direction = that point → 1 m further. c = cos(angle − track dir):
  facing = c > 0; heading = sign(c) × sign(speed), 0 if blocked / speed 0.
  Reset → 0 / true; completed cars keep the values
- `name` = class name (sent as GameState `car.name`); `speed` / `maxSpeed` in km/h
- Sizes in meters (e.g. HyrkartCentralen 1.865 × 1.35 m), 24 px/m
- Karts (`game/cars/gokarts/`, `CAR_CLASSES` in `game/tracks/serialize.ts`,
  `Session.chooseCar`): HyrkartCentralen (Sodi RSX2 electric rental kart,
  Gokartcentralen Gothenburg, 60 km/h), Hyrkart270cc (petrol rental kart,
  Torslanda, 80 km/h), Racingkart125cc (125cc racing kart, 115 km/h)
- expectedLapTimes (per layout, per car class, track JSON; GameState
  `track.expectedLapTime`, 0 = not set): fastest clean run of a headless
  bot driving the real GameEngine × 1.3 (corner-speed settings, then the
  crash edge narrowed to 0.3 % — `scripts/lapBot.ts`, shared with
  sensitivity; the coarse grid alone jumped 1.5 %; loops: lap 1 from the grid; it
  brakes at 0.7 × brakeLock, planned at 0.65 × the braking at the lock
  point (brakeLock × brakeDeceleration / 3.6, m/s²); coasts while
  cornering hard; updated for the new tyre model 2026-11-13 — the old
  √(1 − gripRear²) factor held it back now that gripRear includes the
  braking). Dry run 2026-11-13: 42 values change (mostly +0.5–1.5 %),
  not written yet.
  `npm run laptimes` (Space tracks, all karts; `-- --yes` writes them
  into the Space). Method: `.claude/tasks/expected-lap-times.md`; README
  "Tracks and layouts" has the table. Re-run after physics / layout changes
- Physics in modules (2026-11-13, plan `.claude/tasks/braking-strength.md`
  R1 / R2 / 2f / naming pass): `Car.ts` = the state (speed, angle,
  lateralSpeed, yawRate, wheelSpin, slipRatio, rearLift, …), the public
  API (`applyControls`, `brakeLock()`, `scrub()`, `wheels()`,
  `stopSliding()`, `reset()`; `torqueAt`, `DriveValues` re-exported for
  older imports) and the ORDER of the steps each tick;
  the physics itself = pure functions in `game/cars/physics/`, one module
  per part (below; `constants.ts` = G 9.81; `kartConstants.ts` = what a
  kart works out from its own values alone — a / b, static axle loads,
  the front tyre's curve, rolling force, sin wheelLock, mean track,
  brakeLock, the reverse brake cap — ONCE per kart class, the first time
  a kart of it asks, reused for the life of the process (Robin
  2026-11-14: "static values calculated once per build"); a kart's values
  must not change after that — scripts/sensitivity.ts builds a class per
  tried value). `physics/SYMBOLS.md` = the
  symbol chart (every short math name: meaning, unit, sign, files; signs
  + = right / forward / turning right). Names are spelled out; only
  standard math / physics symbols (κ, α, δ, ω, Fx, Fz, μ, dt, v) stay
  short. `npm run -s physics-trace [-- <src dir>] > out.txt` dumps every
  state field each tick as exact doubles → `cmp` old / new = proof a
  restructure changes nothing.
- Order each tick (`Car.applyControls`): forward (speed > 0, or standing
  without S alone) → `slide`; otherwise reverse → `longitudinal`. Then
  the steering wheel → wheel angle (steering), then `slide` or
  `stopSliding()` + `steer`. `slide`, per substep (8): axle loads (loads)
  → inner rear lift → front tyres' slip angles + side forces (tyre,
  Ackermann) → rear: κ from the axle's spin + slip angle → Fx, Fy (tyre)
  + the local dFx/dκ → rolling + drag (resistance) → the axle's spin step
  (rearAxle: drive from drivetrain, brake + lift-off) → lock flag, spool +
  outer-brake moments (rearAxle) → lateralG / longitudinalG / grip shares
  → longAccel lag (loads) → the body (chassis)
- tyre (`physics/tyre.ts`: slip + load → force = the grip budget). Front:
  side force only, Pacejka Magic Formula F = peak × sin(C × atan(B × α)):
  most grip (gripG × axle load) at `peakSlipDeg`, less beyond, `slideGrip`
  of it when fully sliding (C from sin(C × 90°) = slideGrip, B puts the
  peak at peakSlipDeg) → steering too much at speed UNDERSTEERS (40 km/h:
  tightest at ~20 % steering on the rental karts, ~30 % on the Racingkart;
  full lock ploughs). Tyre per kart: rental peak 8° / slide 0.75,
  Racingkart slicks 6° / 0.7 (sharper). Each front wheel its own slip
  angle (`wheelSlip`, Ackermann) and half the axle's grip. Rear: TMeasy
  (Rill) combined slip, per wheel at half the axle load (computed once,
  doubled) — ONE grip budget per tyre: braking, gas and turning each take
  a share, no priority; over it → the tyre slides (lock / wheelspin / past
  the peak). κ and tan α normalised (ŝx, ŝy), one curve on the combined
  slip s (initial slope dF0 → peak FM at sM → two parabolas → sliding FS
  at sS, FS beyond), each value blended by the slip direction φ; Fx = F
  cos φ, Fy = F sin φ. Equations: no primary Rill text readable; two
  agreeing codes, carpy TMEasy.py (4ca50f1) and uwsbel
  low-fidelity-dynamic-models 18dof/dof18.cpp (992faca); Chrono
  ChTMeasyTire. Values: the curve SHAPES (slopes, κ / α of the peaks, the
  locked Fx) from the kart tyre data in the open-source fastest-lap
  project (github.com/juanmanzanero/fastest-lap commit 0660208,
  roberto-lot-kart-2016.xml, rear tyre, MF 5.2, Fz0 896 N; its only
  reference is Lot & Dal Bianco 2016 — fitted / copied / guessed unknown):
  κ at the peak 0.094 / 0.107 / 0.123 at 627 / 896 / 1165 N; tables every
  20 N to 3000 N, built once; side input sin α instead of its tan α
  (identical < 10°). Peaks ours: gripG × load both ways (μx = μy, braking-
  strength.md 1), with load sensitivity (loads). Sliding Fx = the data's
  locked (κ = −1) share of the peak; sliding side grip = `slideGrip`
  (Robin 2c — the data's 0.57 read at 45° is past any fit); sxS = syS = 1
  (estimate: fully sliding at κ = −1 / tan α = 1; the data falls faster
  past the peak — that fit NOT taken, 2e / 2f). Slips use ≥ 1 m/s
  (`slipSpeed`). The front stays lateral-only (no front brakes)
- loads (`physics/loads.ts`: the axle and wheel loads). Static by the
  CoG's place (`rearShare`). Weight transfer m·a·cgHeightMeters/L
  (Beckman, The Physics of Racing 1) from the ACTUAL acceleration along
  the nose (rear tyres' Fx, front scrub, rolling, drag; no cap, braking-
  strength.md 1f), lagged `TRANSFER_SECONDS` 0.08 (`longAccel`; no
  suspension, but the frame flexes — an instant shift feeds back on
  itself) → braking unloads the rear = the braking tyres (rear-only
  brakes), so turning hard on the brake brings it round. `cgHeightMeters`
  0.23 / 0.25 / 0.29 (Centralen / 270cc / Racingkart, estimates from
  Mihalić 2023's 0.32 m for 80 + 50 kg). Inner rear lift (`rearLift`,
  1 = down, 0 = lifted, over `liftSeconds`) = roll (|lateralG| × m·g ×
  cgHeight / mean track, rear static share) + caster jacking
  (`SlipValues.jacking` × inner static load × sin|δ| / sin wheelLock; 0.5
  rental karts, 0 Racingkart — estimated, tuned against the tests, plan
  `.claude/tasks/braking-spin.md` 2026-11-11) ÷ the inner wheel's load
  (roll alone lifts it fully only past ~2 g: in a kart the steering does
  it, in slow corners; braking unloads the rear → it lifts sooner).
  Lift check 2f: moved share 0.21 / 0.42 / 0.56 at 0.4 / 0.8 / ~1 g
  (rental) — no source supports less. Tyre load sensitivity
  (`tyre.peakGrip`, `SlipValues.loadSensitivity`, Pacejka pDy2): peak =
  gripG × load × (1 + pDy2 × (load − static) / static), front per axle,
  rear per wheel at half the axle load (per-wheel loads with the lift
  were rejected, braking-spin.md); rental −0.10, slicks −0.15 (estimates:
  no kart data; Milliken −0.12, FSAE 10" −0.15; plan
  `.claude/tasks/lift-off.md`)
- rearAxle (`physics/rearAxle.ts`: the rigid rear axle — spool, no
  differential; rear-only brakes, all three karts). ONE spin state ω for
  both wheels (`wheelSpin`, rad/s, ≥ 0): one wheel locks = both lock — as
  TORCS simuv2 wheel.cpp (torcs.sourceforge.net/api/wheel_8cpp_source.html).
  Axle inertia 0.2 kg·m² (fastest-lap project's kart, axle_car_6dof.hpp
  :166). Slip ratio κ = (ωr − vx) / max(|vx|, 1 m/s) (`slipRatio`, − =
  braking, −1 = locked). Spin step per substep (`spinStep`): I·ω̇ = drive
  − brake·sgn ω − r·Fx, semi-implicit, linearised with the tyres' LOCAL
  dFx/dκ (finite difference, ≥ 0 = the linearly implicit Euler Jacobian;
  the slope at κ = 0 acted as extra axle inertia past the peak, 2e / 2f)
  and the kart's own Δvx this substep (without it: fake inertia, −0.03 g;
  2a) → stable at any speed. Brake clamp (TORCS wheel.cpp :408–413): the
  brake only stops ω, never reverses it. Brake + lift-off act on the axle;
  the tyres decide what reaches the road. Locked (`rearLocked`, `isLocked`)
  = κ ≤ −0.5 while moving forward (estimate: well past the peak) — tyre
  marks, scrub, incident logs. The lock isn't instant (the axle has to
  stop): full brake ≈ 0.05 / 0.08 / 0.17 s (Centralen / 270cc /
  Racingkart, measured in a corner on the final code, 2026-11-13). `brakeLock()` (`lockingBrake`) =
  the brake at which the rear locks with the gas up, analytic: straight,
  the axle's peak Fx under the transfer its own braking makes, + slowing
  the axle with the kart (I·a / r), − lift-off; worst case at TOP speed
  (drag + rolling move load forward too) → 0.40 / 0.55 / 0.60; at lower
  speed it locks a little later, in a corner the true lock pedal is rental
  1.00–1.04 × it, Racingkart 1.12–1.15 × (2f). Spool moment
  (`spoolForce`): both wheels at one speed, the ground under them differs
  by r × track → a moment against the turn ∝ 1 − u² (u = share of the
  inner load moved across = 1 − rearLift; Milliken, Race Car Vehicle
  Dynamics ch. 20), at most the inner wheel's grip. Outer-rear brake
  moment (`outerBrakeMoment`) = the tyres' braking (max(0, −Fx)) × u ×
  rear track / 2, against the turn, rolling AND locked (each wheel's force
  follows its own load, sliding friction too; Milliken ch. 20, Lot & Dal
  Bianco 2016; 2f — the old "none while locked" made the kart hold, then
  snap). Reverse keeps the old force rule (`reverseBrake`, no spin state):
  brake + lift-off at most `rearBrakeLimit` = μ·g·rear share / (1 + μ·h/L),
  asking more → slideGrip × it (`rearBrakeLimit` also used by
  scripts/laptimes.ts)
- drivetrain (`physics/drivetrain.ts`, every kart has `drive:
  DriveValues`; plan + sources `.claude/tasks/analog-pedals.md`, Gillespie
  ch. 2–3): pedals `forward` / `backward` / `brake` are 0..1
  (`toCarControls`: true / false → 1 / 0). Full-gas pull (`fullPull`, N)
  = min(torque × ratio × η / r, power × η / v) (torque =
  `torqueAt(torqueCurve, rpm)` from engine rpm = v / r × ratio, linear
  between the maker's points, held outside them; no curve → flat
  `torqueNm`; plan `.claude/tasks/torque-curve.md`). Forward (`slide`):
  the drive on the rear axle (`axleDrive`) = gas × fullPull at the WHEEL
  speed (ω·r: the engine sees the wheels), cut by the governor / limiter
  / rev limit on wheel speed at maxSpeed; it spins the axle, the tyres
  decide what reaches the road (past the budget: wheelspin). Gas and brake
  act together. Reverse does nothing while the kart rolls forward (none
  of the karts reverses while rolling: the 270cc has none, the Centralen
  backs up from standstill; Robin 2026-11-13) — S alone coasts; standing
  with S and no gas → reverse (`Car.longitudinal`: the same pull
  backwards, gas wins over reverse, capped at −maxSpeed / 2, `governed`).
  Lift-off braking (`liftOffForce`, `liftOffG`, full with the gas up, gone
  at 10 % gas, `LIFT_OFF_FADE`; Rotax only above 35.6 km/h) brakes through
  the rear axle. Derived values are computed in the kart files from their
  inputs (plan `.claude/tasks/kart-values.md`): mass = `weight` +
  `driverKg`, `gearRatioAt(rpm, km/h, r)` (rental karts: 4000 rpm at 60,
  4500 rpm at 80), `speedAtRpm` (Rotax clutch 4000 rpm → 35.6 km/h); a
  kart has EITHER a flat `torqueNm` OR a `torqueCurve`. Per kart (torque /
  power / ratio / CdA / Crr / lift-off):
  HyrkartCentralen 42 Nm / 10 kW / 3.657 / 0.55 / 0.02 / regen 0.1 g;
  Hyrkart270cc (GX270, Honda's curve 18.6 / 19.1 / 18.5 / 17.2 / 16.8 Nm
  at 2000 / 2500 / 3000 / 3500 / 3600 rpm) curve / 6.3 kW / 3.085 / 0.55
  / 0.02 / 0;
  Racingkart125cc (Rotax, centrifugal clutch ~4000 rpm + chain) 21 Nm /
  22 kW / 77/13 / 0.45 / 0.018 / 0.05 g. Full gas 0–58 km/h: 5.8 /
  13.9 / 3.5 s, top 59.9 / 79.5 / 114.2 km/h (measured 2026-11-13 / -14;
  before the axle spin 5.5 / 13.3 / 3.3 s, 60.0 / 73.3 / 115.0 —
  the axle spins up, the governor reads wheel speed);
  part gas settles (no fixed acceleration)
- resistance (`physics/resistance.ts`): rolling Crr·m·g + air ½ρ·CdA·v²
  (ρ 1.225); in `slide` only while moving forward; also reverse and
  `brakeLock()`
- steering (`physics/steering.ts`, `Car.applyControls`, shared by every
  car): `controls.steering` is -1..1 (keyboard A/D → ± the App's steering
  aid; agents clamped, not a number → 0, in `FormulaiServer.toCarControls`).
  The car works in DEGREES: `steeringAngle` = steering × `steeringLock`
  (steering wheel, per side), `wheelAngle` = steeringAngle × wheelLock /
  steeringLock. Steering speed limit (`steeringRate`, °/s on the wheel,
  per kart; not set → jumps at once): steeringAngle turns towards
  controls.steering × lock at most that fast — every kart 360 (0 → full
  lock 0.25 s rental karts, 0.17 s Racingkart). Ackermann front
  (`frontWheels`, `frontTrackMeters` 1.05, estimate): each front wheel
  its own angle, both aim at one turn centre on the rear axle line.
  GameState sends steering normalised (steeringAngle / steeringLock =
  where the wheel IS) and wheelAngle in degrees. Per car (steeringLock /
  wheelLock / wheelbase / gripG): HyrkartCentralen 90/32/1.04/1.15 (Sodi
  RSX2 electric, Gokartcentralen Gothenburg), Hyrkart270cc
  90/32/1.07/1.15 (Caroli Hammerhead GX270, Göteborgs Gokartcenter
  Torslanda), Racingkart125cc 60/35/1.04/1.6 (Rotax 125 Max Senior, D5
  slicks; brakeDeceleration 35 = rear brake only). Values from the real
  karts where published, the rest estimates (sources in the plan). Reset
  → 0; completed cars keep the values. Self-aligning steering (caster)
  = its own later task (braking-strength.md 2d)
- chassis (`physics/chassis.ts`: the body). `slide` (every kart has
  `slip: SlipValues`; plan + sources `.claude/tasks/tyre-slip-steering.md`):
  dynamic bicycle model. The car has `lateralSpeed` (m/s) and `yawRate`
  (rad/s) of its own (+ = right); `speed` = the speed along the nose:
  turning hands it to lateralSpeed (+ vy·r), the steered front tyres pull
  it back (scrub, − front·sin δ); never below 0 while sliding — without it
  a 1–2 Hz full-lock wiggle reached 400–2300 km/h, fixed 2026-11-10 — and
  at most maxSpeed. 8 substeps per tick (`SLIP_SUBSTEPS`: the tyre forces
  are stiff). Below 3 m/s the slide blends into the kinematic model
  (fully below 1 m/s, Kabzan et al. 2019) → a stopped kart stands still.
  Reverse → `steer`: kinematic, turn rate = min(|v| / wheelbase ×
  tan|wheelAngle|, gripG × 9.81 / |v|), reversing turns the other way,
  pivot on the rear axle (`steer` shifts x / y so that point stays put);
  speed 0 → no turn; no spin (the real karts have no reverse gear).
  Measured before 2026-11-13 (load sensitivity, lift-off.md; not re-run
  since): big weaves scrub speed instead of holding a drift (held 2.7–2.9
  s → 1.0–1.5 s), high speed understeers
- Braking result (2026-11-13, `npm run braking-suite`, plan
  braking-strength.md): 64 PASS / 6 ≈ / 20 FAIL vs 54 / 10 / 23 before.
  A lock with a little steering stays roughly straight below ~30 km/h;
  from ~50 km/h almost any steering brings it round (a self-aligning
  steering is the likely missing stabiliser, 2c / 2d). Trail braking:
  edgy but catchable, a caught slide costs speed (Robin, 270cc: "much
  better")
- Outputs (`slide`, last substep; `stopSliding()` zeroes them):
  `lateralG` (tyre side force ÷ weight, + = right), `longitudinalG` (the
  actual acceleration along the nose in g: rear tyres' Fx − rolling −
  drag − front scrub; the same one weight transfer uses, lagged),
  `gripFront` (|front axle force| ÷ its peak; force, not past-the-peak:
  ploughing at full lock shows ~0.9), `gripRear` (the WHOLE rear grip
  budget in use: hypot(Fx, rear side force) ÷ the rear peak — braking,
  gas and turning together), `slipFront` / `slipRear` (rad, the axle slip
  angles the tyre forces use; + = the axle moves right of its tyres, front
  vs the steered wheels; 2026-11-10, plan `.claude/tasks/slip-per-axle.md`),
  `slipRatio` (κ), `wheelSpin` (ω), `rearLocked`. GameState sends them
  normalised (`formulai/gameState.ts`, 4 decimals, -1..1 or 0–1): yawRate
  ÷ (gripG × 9.81 / max(v, 1 m/s)), slipAngle = atan(lateralSpeed /
  max(v, 1)) ÷ 90°, slipAngleFront / slipAngleRear = slipFront /
  slipRear ÷ 90°, lateralG ÷ gripG, longitudinalG ÷ gripG, lateralSpeed ÷
  maxSpeed, gripFront / gripRear. All 0 in reverse (`steer` untouched)
- Methods: applyControls (the order above), slide (forward), longitudinal
  (reverse only: gas / reverse / brake / coast), steer (reverse),
  stopSliding, brakeLock, scrub, wheels, reset (reset places the car in
  its start grid box, `car.gridSlot`, see "Start Grid"; it is also the
  only way out of a crash)
- Position = current + velocity × deltaTime, not applied while crashed or
  colliding where it stands (see "Collision Detection"): velocity = speed
  along the nose + lateralSpeed to its right (`GameEngine.tickPlayer`;
  lateralSpeed 0 for `steer`)

## Collision Detection

- Against the track's stored outline (bezier rings → polylines + grid) plus
  the raced layout's tyre walls (0.6 m bands that close unused roads),
  `GameEngine.checkCarCollision` (one car against the track — despite the
  name). Cars don't collide with each other: they drive through one
  another
- Colliding = a car corner off the track or inside a wall, or a car side
  crossing the edge / touching a wall
- Response (2026-11-13, Robin: "once collided, collided until next
  restart"): a crashed car (`hasCollision`) is FROZEN — speed 0,
  `stopSliding()`, no physics, no steering, no reversing out — until
  `car.reset()` (restart / next stage) clears it. Agents must send
  `req:agent/restart` after a crash; Player mode: R / Reset. (Before: the
  car still ran its controls while blocked and could steer / pivot free.)
- Each tick (`tickPlayer`): `blocked` = crashed (hasCollision from the
  tick before) or colliding where it stands → no move; then `hasCollision`
  is checked where the car is AFTER the move — the same position as x/y,
  corners and rays, so a ray at 0 ⇒ hasCollision the same tick

## Ray Casting (AI Input)

- 8 rays: forward, forward-right, right, forward-left, left, back,
  back-right, back-left (`game/engine/rays.ts`, index = meaning)
- Each starts on the car's body (`RAY_ORIGINS`): diagonals at a corner,
  straight rays at an edge middle (`carPoint`, `game/engine/carBody.ts`);
  the App draws them from the same points (its own `app/src/engine/rays.ts` +
  `carBody.ts`, render only)
- Exact distance to the outline edge or a tyre wall, capped at 1000 px; 0 if
  the start point is off track
- Sent in GameState `car.rays`

## Checkpoint & Lap System

- Checkpoints per layout; the list order IS the lap order (start first).
  Each sits on a path (main loop or a connector road) with a direction
  (`dir`); its line runs across that road to the outline edges (or a tyre wall)
- Car front point checked against checkpoint lines
- Loop layout: lap = all checkpoints + back over the start line.
  One-way layout: reaching the finish ends the stage
- Lap clock runs from crossing the start line until the stage is complete
- Times tracked per lap and per stage (Player keeps them in SECONDS)
- completedMeters (GameState `track.completedMeters`): Track builds the
  centreline route at load (`buildRoute`, one leg per checkpoint gap).
  Counts from the spawn: first the lead-in (`Track.leadIn(carLength,
  gridSlot)` = the spawn's distance to the start line ALONG THE ROAD,
  `Track.behindStart`, cached; lap 1 only, the centre measured the same way
  while behind the start line), then
  `GameEngine.updateCompletedMeters` projects the car CENTRE onto the current
  leg (`currentCheckpoint - 1`) each tick, searching 10 m ahead of the best
  point; only goes up, clamped at the leg end until the next line is
  crossed. The line counts the car FRONT (isPointBetween tolerance), so the
  centre is ~2 m before it at the switch: until it moves on along the new
  leg (`routeSample === 0`) the previous leg's last 5 m are searched too
  (`nearestOnLeg`; a loop's new lap → last leg of the lap before) → no jump
  or pause. Loop adds laps × route length. Completed → lead-in + full
  distance, then stops. Restart / resetStage → 0 (`Player.resetMeters`)
- lapDistance (GameState `track.lapDistance`, 0–1, 4 decimals):
  `Player.lapDistance(track)`, derived (no state) — 1 − (completedMeters −
  lead-in − lapsCompleted × route length) / route length, clamped. Counts
  from the start line only: 1 until the centre is past it, only goes down,
  a new lap starts at 1; stage completed → 0 (checked first:
  completedMeters = lead-in + laps × length there); no route → 1
- Fastest laps (per lobby, while it runs): `Lobby.recordLap` on the
  engine's `lapCompleted` (one-way: the run) — per stage, a top 10 per kart
  class, each car once (its best). Viewers get `evt:view/times` when the
  watched stage's list changes. Shown in the lobby viewer (the followed
  kart's list); hidden in Player mode

## Sessions

Sessions are JSON objects in the bucket (`sessions/<file>.json`; the
Space is the source); all alike — any can be saved over or deleted in
the session editor (TrainingOne too; Player mode needs it). Loaded at start (`loadGameFiles`) into `SESSION_REGISTRY`;
a lobby builds its own `Session` from one (by name, or a whole session
sent in `req:lobby/create`, validated like a file).

```typescript
// S3 sessions/<stem>.json
{
  name: "TrainingOne",            // id (lobby/protocol value)
  displayName: "Training One",
  cars: ["HyrkartCentralen"],     // kart classes you may join with
  mode: "race",                    // optional: "training" (default) | "race"
  stages: [
    { track: "Torslanda", layout: "Training 1", laps: 1 }, // layout by name (or id)
    { track: "Jarfalla", laps: 3 },                        // no layout → first layout
  ]
}
```

- `track` is the track file's `name` (e.g. "Torslanda", "Jarfalla",
  "Lulea Kallax" — names may contain spaces; file = snake_case stem,
  lulea_kallax.json).
- One-way layouts end the stage at the finish, so `laps` is effectively 1.
- Current layouts (README "Tracks and layouts" has the full table):
  - Torslanda: GP (loop), Training 1–7 (one-way)
  - Jarfalla: GP, GP Short (loops), Training 1–2 (one-way)
  - Lycksele, Lulea Kallax, Skovde: GP (loop)
- TrainingOne (9 stages) = Torslanda Training 1–7, Jarfalla Training 1–2
  (1 run each). Player mode races it.
- TrainingEndless (5 stages) = 5 laps each: Lycksele GP, Lulea Kallax GP,
  Skovde GP, Torslanda GP, Jarfalla GP (endless when an agent joins with
  `repeat: true`).
- Both: training mode, cars HyrkartCentralen, Hyrkart270cc, Racingkart125cc.
- `layout` matches a layout id first, then its name; an ambiguous name
  skips the stage with a warning.
- Invalid files are skipped with a console error (unknown car class, empty
  stages, bad laps, bad mode, old "Name::layoutId" form). Stages whose
  track is missing or has no outline are skipped with a warning.

Progress (`SessionProgress`: current stage, stage flags, announced):
- **training** (default): each CLIENT (agent / player) has its own
  progress (`Lobby.progressFor`, kept after it leaves → a rejoin continues
  there; a new client starts at stage 1). Clients can be on different
  stages at once; a car only meets cars on its own stage.
- **race**: one shared progress (`LobbyGame.progress`) for the lobby.

Stage flow:
- Player mode (`autoAdvance` lobby, engine 'player' mode): a finish flags
  the stage completed and advances.
- Agents: `req:agent/nextStage { completed }` (false = skipped, any time)
  → `Lobby.nextStage` → `GameEngine.nextStage(progress, completed)`:
  training moves ALL of that agent's cars; race moves every car. Only the
  agents on that progress get `evt:agent/stage`. A car that completed the
  stage is removed from the track (not drawn; no physics/controls; values
  kept from the finish tick) until restart or nextStage respawns it.
- Session completed (`isCompleted()`, GameState `session.completed`) = every
  stage flagged `true` → `evt:agent/completed` / `evt:player/completed` to
  the clients on that progress. Completed: `nextStage` only stores the flag.
- `SessionProgress.advance()` picks the next stage: the next after the
  current that isn't completed, wrapping around (skipped stages replayed,
  completed ones never redone; only the last skipped → it again, fresh);
  every player on it `enterStage`s it fresh (resetStage) + new grid.
  Every stage completed: no repeat → the session ends (e.g. TrainingOne,
  skip 3 and 7: 1…9 → 3 → 7 → end). Repeat: never completed; every stage
  completed → flags cleared, stage 1 again. completedMeters stays per stage.
- Repeat is the CLIENT's, not the session's (sessions have no `repeat`; an
  old one in a file is ignored): `SessionProgress.repeat` (default false),
  set by a training client's `req:agent/join { repeat }`
  (`Lobby.progressFor(ownerId, repeat)` when its progress is made; a rejoin
  keeps it; `res:agent/join { repeat }` = the one used). Race lobbies and
  Player mode: always once through.
- Restart: `req:agent/restart { carIds }` (only your own listed cars) /
  `req:player/restart` (R / Reset button) → `LobbyGame.restartCars` →
  `Player.resetLap`: completedLaps, completedMeters, lap times,
  checkpoints → 0 (stage.completed false again), car back to its grid box;
  keeps the stage clock. Nobody else is touched. After the next step the
  agent gets `evt:agent/restarted { carIds }` (state is real then).
- Pause (2026-11-17, `.claude/tasks/pause-cars.md`): `req:agent/pause` /
  `req:agent/resume { carIds }` (own cars only, batch; no answer) →
  `Lobby.setPaused` → `Player.paused` (on the Player: restart / nextStage
  keep it; a rejoin's new Players start unpaused). `tickPlayer` returns
  before `tick++`: no controls, physics, clocks, rays, checkpoints —
  every value kept, resume carries on exactly. Paused cars are left out
  of `evt:agent/state`; a resume sets `Owner.stateNow` → the state after
  the next step, the stateMs schedule from then. Fast lockstep unchanged
  (all paused → `cars: []`, still answered). `RenderCar.paused` → the
  App draws the body grey (`Scene3D`, `PAUSED_CAR_COLOR`); a viewer
  following a client skips paused cars like crashed ones.
- Tick: each client counts its own (`Owner.tickBase` in `Lobby`): the
  state's `tick` is 0 at the first step after its join / rejoin / a restart
  (that step's state is the one `restarted` follows). The lobby's own
  `LobbyGame.tick` stays inside (viewer frames, fast lockstep: `answered`
  adds the base back; the base only changes at a step).
- Joining: the race starts at the first join; a car joining a running race
  starts its progress' stage in the lowest free grid box on that stage. The
  last one out pauses the lobby; the next join: race → stage 1 again;
  training → each client where it was.

Lobbies (server, `FormulaiServer` + `Lobby`):
- Created with `req:lobby/create { session, autoAdvance?, fast? }` (App:
  `/lobby/create`, `/session/editor`, Player mode). Id = 6 hex chars.
- An agent's token (`res:agent/join`) rejoins as the same agent with the
  same carIds (`req:agent/rejoin { token, stateMs? }`, not set → the
  old stateMs); a dropped connection's cars leave at once.
- Deleted when nobody drives or watches for `EMPTY_LOBBY_SECONDS`; a
  single-player lobby as soon as its player is gone. Tokens die with it.
- Or deleted by hand: `req:lobby/delete { lobbyId }` (anyone; App:
  Delete on `/lobbies`, with a confirm) — only when no agent / player is
  in it (`Lobby.isEmpty`; viewers don't count, they stop watching).
  Sweep and request share `FormulaiServer.deleteLobby`.
- Fast training (`fast`): lockstep (see Game Loop); agents only.

Key methods: `progressFor()`, `nextStage()`, `stageInfo()` (Lobby);
`stage()`, `isCompleted()`, `advance()` (SessionProgress);
`chooseCar()` (Session); `addPlayer()`, `restartCars()`, `step()` (LobbyGame)

## Start Grid

Boxes behind the start line (`game/tracks/vector/grid.ts`; the editor has
its own copy in `app/src/tracks/vector/grid.ts`):
- Per track (`TrackJSON.grid`, `GridSettings`, metres; omitted =
  `GRID_DEFAULTS` go-kart): `gapM` start line → front of box 1 (1),
  `rowM` box to box alternating sides (3), `columnM` between the column
  centres (3), `boxLengthM` × `boxWidthM` (2 × 1.2, the OUTSIDE of the
  painted box), `staggered` (true; false = side by side, rows 2 × rowM).
- Per layout: `gridSlots` (≥ 2, default 2), `gridPole` ('left' | 'right'
  seen in the direction of travel, default 'left'). Set in the editor's
  Layout tab ("Start grid" section in the bottom-left list).
- Boxes follow the road BACKWARDS along the start checkpoint's path
  (`startRoad`: a closed path wraps, an open one stops at its entry end) —
  may sit in a curve. `gridSlots()` → box front-middle + angle + `back`;
  `gridLines()` → the painted lines (front straight across, sides along
  the road, nose-to-tail boxes join into one line per column).
- Spawn: `Track.spawn(carLength, slot)` = car front at the box front.
  `GameEngine.assignGrid` (engine start, after nextStage, restartSession;
  per progress): players shuffled, `car.gridSlot = i % boxes` (more cars →
  round again from pole). A mid-race join → the lowest free box on its
  stage. Restart keeps the box.
- Paint: 10 cm (`GRID_PAINT_M`) INSIDE the box and inside the track edge.

## Rendering (App)

- The App draws what the server sends: `evt:view/track` = a `RenderTrack`
  (outline rings, walls, grid lines, checkpoints, paint, tyres, props —
  built once per Track by `server/src/formulai/renderTrack.ts`, `key` =
  track::layoutId::sha1 of the file the Track was built from) and
  `evt:view/frame` (cars on the watched stage, followed car, HUD): 20/s
  to watchers (every 3rd step, `VIEW_FRAME_TICKS`), every step to a player
  watching its own lobby (Player mode). `DrawTrack` wraps a RenderTrack for
  the Renderer; `ServerRacingView` draws every browser frame, the cars
  blended between the two frames around now − `interpDelayMs` (Player mode
  25 ms, `LobbyViewerView` 200 ms — over the internet a frame now and then
  comes ~140 ms after the one before).
- Game canvas 1000 × 700 CSS px at `devicePixelRatio` (Retina 2000 × 1400);
  zoom stays CSS px, `Renderer` scales by its `pixelRatio`.
- Isometric: the track on the 2D canvas every frame (vector, sharp) + the
  3D layer (props, cars) on top.
- Chase / cockpit / orbit / free: no texture — the track is real geometry,
  built once per track (`Scene3D.buildTrack`), sharp at any distance:
  asphalt mesh (`engine/trackGround.ts`, outline rings triangulated,
  even-odd holes), paint mesh with vertex colours (`engine/paintStrips.ts`:
  edge + grid box strips, start / finish squares), tyre walls as instanced
  3D tyres stacked 2 high. Checkpoint lines aren't shown in 3D. The 3D edge
  strip also reaches 5 cm onto the grass.
- Tyre marks + racing line (3D layer, every camera mode, App only, start
  clean per page view / track; plan `.claude/tasks/tyre-marks-rubber.md`).
  The frame's car sends `wheels` (front / rear track, wheelbase, tyre
  widths, px; `Car.wheels()`, `tyreWidthMeters`), `scrub` per wheel (FL,
  FR, RR, RL: grip in use × axle load share × sliding per metre, sin α;
  locked rear = slideGrip × load share; inner rear × rearLift;
  `Car.scrub()`, `loadShareFront / Rear`) and `locked`
  (`rearLocked`). `engine/tireMarks.ts`: only locked rear wheels mark,
  tyre-wide ribbons, scrub × 0.24 × sliding speed (full from 60 km/h)
  opacity, fading out over 3 min.
  `engine/rubberLine.ts` (plan `.claude/tasks/marbles.md`, after
  `rubber-pickup.md`): two layers on the asphalt mesh. Laid rubber — every
  wheel lays 0.02 + scrub into a texture (5 cm texels, ≤ 4096) UNDER its
  tyre: tyre-wide dark lines (1-texel edge blur), never picked up; ~100
  laps of one car to build (corners ~95 %, straights ~23 %). Marbles
  (`dust`, stored) — each wheel's scrub (none rolling) thrown to the
  OUTSIDE of the turn only (wheel path's sideways acceleration, smoothed;
  full at 1.2 g): nothing within 0.15 m of the tyre's edge (clean buffer),
  75 % in a ridge just outside it (σ 0.08 m at 40 km/h → 0.3 m at 100
  km/h), 25 % a sparse tail toward the kerb (0.5 → 1.2 m); marbles landing
  in other karts' grooves are swept out over time (pick-up + shed); drawn
  as granules (3 cellular-noise scales, STYLISED ~3.5 × real size: grit
  ~1.5, pellets ~5, ribbons ~12 cm — real 2–30 mm are only a few px from
  any camera; more cells hold one the more marbles; #111113 flecks with a
  warm grey-brown edge, rubber smooth #1A1A1C; stretched 1.5× along the
  travel direction, a `dir` texture). No pixel noise: specks only from a 7
  px cell (else their average: a darker band from afar), relief from 12
  px: toon-banded domes lit by `Scene3D.sunDirection` (time of day), a
  contact shadow away from the sun, an AO ring, a hard toon glint where
  the sun reflects to the camera (matte elsewhere); the scene's shadow map
  (lights: true) → none in building / tree shadows. No clear turn
  (straight braking) → away from the kart's centre. A locked rear throws
  none: shavings trail inside its skid (0.1 → 0.45 of its scrub as the
  skid grows 0.5 → 2.5 m), the rest it carries and drops as one tyre-sized
  clump (σ 0.09 m across × 0.1 m along the skid) where the lock ends.
  Wheel-track cuts: a tyre takes 90 % of the dust across exactly its width
  (1 cm soft rim) per pass, pushes 12 % of that into thin ridges at its
  edges (σ 2 cm, via a per-wheel `fresh` texture) and CARRIES the rest
  (GPU carry texture, a texel per wheel, 64 karts); every piece sheds 1 −
  e^(−m × (1/400 + scrub/15)) of it into its marble ribbon (~150 m for 63
  % on a mixed lap; straights clean badly; locked: none) → two bands
  beside the clean corridor; nothing lost. Estimates from Robin's notes.
  The 3D kart model is scaled uniformly to the class's WIDTH (`Scene3D`,
  kart + headlight) so its wheels sit on the class's wheel tracks → drawn
  longer than its box (2.5 vs 1.865 m Centralen). Fast lobbies: neither
  (cars jump > 2 m between viewer frames).
- HUD: `StatsBox` (followed car; "–" when none runs), the controls
  panel, `FastestLaps` (lobby viewer only), a note when the followed
  client / stage has no car running.
- Controls panel (`RacingView.buildControlPanel` / `setIndicators`,
  Assetto Corsa style, display only): BRK (red) + GAS (green) bars, the
  steering wheel + °, gear letter, Reset (Player mode only). The bars
  fill by how far each pedal is pressed (0..1), as the physics uses
  them: GAS = forward, else backward (gear R); BRK = brake (both can
  show at once). Gear from the HUD's signed speed: R < 0, N = 0, D > 0,
  "–" when no car runs. Player mode: its own keys; the lobby viewer: the
  followed car's controls from the frame HUD (`HudStats.forward /
  backward / brake` = what it drove with on its last step).
- Keyboard (`KeyboardControls`, Player mode; `.claude/tasks/analog-pedals.md`):
  W / S ramp 0 → 1 in 0.3 s (S only reverses from standstill), Space 0 →
  0.8 × `handling.brakeLock` in 0.6 s (brake aid, `BRAKE_AID`: below where
  the rear locks), Shift + Space 0 → 1 in 0.6 s (the full pedal, no aid:
  the rear can lock; releasing Shift drops back to the aid's cap; Robin
  2026-11-13), released → 0 in 0.1 s.
  A / D: steering aid = ± (wheelbase · gripG · g / v² + peakSlipDeg) /
  wheelLock (≤ 1, the wheel angle of the tightest grip-limited circle;
  Centralen 40 km/h → 0.42). Stability aid (a driver's hands; at the grip
  limit a lift spins the kart, `.claude/tasks/lift-off.md`): × a trim that
  falls 4/s while the state's |lateralG| > 0.85 (min 0.2) and recovers
  1/s, + countersteer 1.5 × (slip − 3°) / wheelLock past 3° of slip.
  Reads `evt:player/state` (speed, lateralG, slipAngle). Handling from
  `res:player/join { handling }`. Sent (2 decimals) while values change.

## WebSocket Protocol

Server on `localhost:8080` (HTTP API on the same port). Hosted:
`wss://<domain>/ws` + `https://<domain>/api/…`, behind basic auth (Caddy);
agents send `Authorization: Basic …`. ONE subprotocol:
`formulai`. Full flow: `.personal/websocket.md`; for agent authors:
`docs/agent-protocol.md`.

**Message format:**
```typescript
{ ns: string, action: string, data?: any, v?: number }
```

- `req:` request, `res:` response, `evt:` event (unsolicited)
- Domains: `lobby` (list, create, delete, members), `agent` (join, rejoin, leave,
  controls, restart, pause, resume, nextStage; state, start, stage,
  restarted, completed), `player` (join, leave, controls, restart; state, completed),
  `view` (watch, stop; track, frame, times), `system` (welcome, error)

**GameState** (`evt:agent/state { tick, cars: [{ carId, ...GameState }] }`,
`evt:player/state { tick, car }`):
```typescript
{
  car: { name /* car class, e.g. "HyrkartCentralen" */, tick /* steps on the current stage, laps too; restart / new stage → 0 (first state 1) */,
         speed, maxSpeed /* km/h, same unit as speed */,
         x, y /* car CENTRE in world px (not Car.x/y) */,
         corners /* [{x, y}] ×4 world px: front-left, front-right, rear-right, rear-left */,
         angle, steering /* -1..1 steering wheel */, wheelAngle /* front wheels, ° */,
         heading /* -1|0|1 travel vs track */, facing /* nose within ±90° */,
         hasCollision /* crashed: frozen until restart */,
         yawRate, slipAngle, slipAngleFront, slipAngleRear /* axles' tyre slip ÷ 90° */,
         lateralG, lateralSpeed /* tyre slip, -1..1, + = right */,
         longitudinalG /* -1..1, + = speeding up, − = braking */,
         gripFront, gripRear /* 0–1 grip in use; rear = the whole budget (brake, gas, turning) */,
         rays: [forward, forward-right, right, forward-left, left, back, back-right, back-left] /* from the body */ },
  track: { name /* track file name, e.g. "Torslanda" */, layout /* layout name, e.g. "Training 1" */, loop /* true = loop, false = one-way */, totalCheckpoints, currentCheckpoint,
           laps /* required this stage */, completedLaps /* done this stage */,
           completedMeters /* metres this stage from the spawn */, lapDistance /* 0–1 of this lap left, 4 decimals */, lapTime, lastLapTime, expectedLapTime },
  stage: { completed },
  session: { completed }
}
```

**HTTP API** (`server/src/httpApi.ts`, types in `protocol/http.ts`):
- Session API (open): `GET /api/sessions`, `GET/PUT/DELETE
  /api/sessions/:name` (any session), `GET /api/karts`
- Ping (open): `GET /api/ping` → `{ ok: true }` at once (latency check;
  reuse the connection, a new one mostly measures the TLS handshake)
- Track API (`X-Editor-Password` = `EDITOR_PASSWORD`; wrong → 401, unset
  → 503): `GET /api/tracks`, `GET/PUT/DELETE
  /api/tracks/<drafts|published>/<file>.json`. Publish = live for new
  lobbies; a published track a session uses can't be deleted (409).
- Open: `GET /api/tracks/layouts` (names, loop, expected lap times)
- Background API: `GET /api/backgrounds` (list: file, size), `GET
  /api/backgrounds/:file` (the image) — open; `PUT` (image bytes ≤ 20 MB,
  must match its extension) / `DELETE` (409 while a published or draft
  track uses it) — editor password. A track's `editorBackground.src` = the
  file name (older paths are cut to their file name).

## Key Design Patterns

- **Server-authoritative:** the server owns the game and pushes state; the
  App renders, agents answer with controls
- **One contract, two copies:** protocol types in server + App
- **Registries:** TRACK_REGISTRY / SESSION_REGISTRY filled from disk;
  stores (`sessionStore`, `trackStore`) write and keep them live
- **Factory:** `Session.chooseCar()` for car instantiation
- **Observer:** GameEngine events (`stepped`, `lapCompleted`,
  `sessionCompleted`, …) → Lobby
- **Service layer (App):** `FormulaiClient` (WS), `serverApi` (HTTP),
  `tracks/store.ts` (Track API), `KeyboardControls`
