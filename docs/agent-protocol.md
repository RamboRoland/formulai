# Agent protocol (`formulai`)

How an AI agent talks to the Formulai game server over WebSocket: what
changed from the old protocol, every message an agent sends and gets, and
the rules around them. The message types are defined in
`server/src/protocol/` (the App has an identical copy in `app/src/protocol/`);
this file describes the agent's side of them.

---

## 1. What changed (old → new)

The car data (`GameState`) is **exactly the same**, field for field. The
flow around it changed: the game runs on the server, an agent joins a lobby
and the server pushes the state of its cars every `stateMs` (chosen in the
join, default 150 ms).

| | Old | New |
|---|---|---|
| Connect | subprotocol `control` | subprotocol **`formulai`** (anything else is refused) |
| Getting into a race | none — the App hosted the race; the agent sent controls | **join a lobby** with your cars (`req:agent/join`); create one with `req:lobby/create` or join an existing one |
| State | the agent **asked** (`req:game/state` / `req:game/requestPlayerState`) and got one answer | the server **pushes** `evt:agent/state` every `stateMs` you chose in the join (default 150 ms; fast training: every tick) — no request. The race doesn't wait for you (except in fast training) |
| Shape of the state | one `GameState` (multiplayer: wrapped in `{ gameState }`) | `{ tick, cars: [{ carId, …GameState }] }` — a list, also for one car |
| Controls | `req:control/send` `{ forward, backward, steering, brake, restart }` | `req:agent/controls` `{ tick, cars: [{ carId, forward, backward, steering, brake }] }` — per car, **no `restart`** |
| Restart | `restart: true` in the controls (reset every car in the stage) | `req:agent/restart { carIds }` — **only your own listed cars** |
| Next stage | `req:control/nextStage { completed }` | `req:agent/nextStage { completed }` (same data) |
| Start stage | `req:control/startStage` | gone — a stage starts by itself |
| Several cars | one car per connection | one agent can drive **several cars** (each has a `carId`) |
| Session done | `session.completed` in GameState | still there, plus `evt:agent/completed` |

### Update an agent in 4 steps
1. Connect with the subprotocol `formulai`.
2. At start: create or find a lobby and `req:agent/join` it with your car(s)
   (and `stateMs`, how often you want the state); remember each car's
   `carId`.
3. Turn the loop around: instead of requesting state, wait for
   `evt:agent/state` and answer every one with `req:agent/controls` (copy
   its `tick`; one entry per `carId`).
4. Restart = `req:agent/restart { carIds }` (no `restart` flag in the
   controls any more); next stage = `req:agent/nextStage { completed }`.

Reading the car data (rays, speed, checkpoints, metres …) doesn't change.

---

## 2. Connecting

- Address: `ws://<host>:<PORT>` — default `ws://localhost:8080`
  (`server/.env` → `PORT`). The hosted server: `wss://<domain>/ws`, behind
  basic auth — send the login as an `Authorization` header (example below).
- Subprotocol: **`formulai`**.
- Every message is JSON:
  `{ "ns": "<direction>:<domain>", "action": "<name>", "data": { … } }`
  - `req` = a request, `res` = its answer, `evt` = an event (unasked, e.g.
    every tick). An agent uses the domains `lobby`, `agent` and `system`.
  - `data` is left out when a message has no payload.
- On connect the server sends `evt:system/welcome` `{ clientId }`.

```python
ws = await websockets.connect("ws://localhost:8080", subprotocols=["formulai"])
welcome = json.loads(await ws.recv())   # evt:system/welcome {clientId}
```

The hosted server (basic auth):

```python
import base64
auth = base64.b64encode(b"<user>:<password>").decode()
ws = await websockets.connect(
    "wss://<domain>/ws",
    subprotocols=["formulai"],
    additional_headers={"Authorization": f"Basic {auth}"},  # websockets < 14: extra_headers=
)
```

Node (`ws`): `new WebSocket('wss://<domain>/ws', 'formulai', { headers: {
Authorization: 'Basic ' + Buffer.from('<user>:<password>').toString('base64') } })`.
The HTTP API there: `https://<domain>/api/…` with the same header.

Latency: `GET /api/ping` → `{ ok: true }`, answered at once. Reuse the
connection (e.g. `requests.Session`) — a new one mostly measures the TLS
handshake:

```bash
curl -s -u <user>:<password> -o /dev/null -w "%{time_total}\n" \
  https://<domain>/api/ping https://<domain>/api/ping https://<domain>/api/ping
```

---

## 3. Lobbies

| Send | Answer |
|---|---|
| `req:lobby/list` | `res:lobby/list` `{ lobbies: [LobbySummary] }` |
| `req:lobby/create` `{ session: "<name>" }` — or a whole session `{ session: { name, displayName?, cars, mode?, stages: [{ track, layout?, laps }] } }` (`mode`: `"training"` default, or `"race"` — see 7). Add `fast: true` for a fast training lobby (see 5) | `res:lobby/create` `{ lobbyId }` — or `res:lobby/createError` `{ reason }` |
| `req:lobby/delete` `{ lobbyId }` — anyone, only an empty lobby (no agent / player in it; viewers don't count). Its tokens stop working | `res:lobby/delete` `{ lobbyId }` — or `res:lobby/deleteError` `{ reason }` |

`LobbySummary`:
```
{ id, session: { name, displayName, cars /* kart classes you may join with */ },
  mode /* "training" | "race" */, autoAdvance, fast /* fast training */, stages /* count */,
  stageList: [{ index, track, layout, loop, laps }],
  members: [{ carId, name, kart, kind: "agent" | "player", ownerId, client /* the client's name */, stage /* index the car is on now */ }] }
```

- Sessions: `GET http://<host>:<PORT>/api/sessions` → `{ sessions: [{ name,
  displayName, cars, mode?, stages }] }` — every session on the
  server (e.g. TrainingOne, TrainingEndless, and the ones saved in the
  App's session editor). Kart classes: `GET /api/karts`; tracks + layouts (names,
  loop / one-way, expected lap times): `GET /api/tracks/layouts`.
- A whole session in `req:lobby/create` doesn't have to be saved; it's
  checked like a saved one (known karts, at least one stage, laps ≥ 1, every
  track and layout exists).
- Or create the lobby in the App (`/lobby/create`) and give the agent its id.
- Everyone in a lobby gets `evt:lobby/members` `{ lobbyId, members }` when
  someone joins or leaves.

---

## 4. Joining with cars

```json
{ "ns": "req:agent", "action": "join",
  "data": { "lobbyId": "ABC123", "name": "PPO-run-7",
            "cars": [ { "name": "Bot 1", "kart": "HyrkartCentralen" },
                      { "name": "Bot 2", "kart": "HyrkartCentralen" } ],
            "stateMs": 150 } }
```
- `name` (optional): your client's name, shown to viewers (the App's
  "Follow" list) — up to 40 characters; not set or empty → `agent <the
  first 6 characters of your agentId>`. Each car still has its own `name`.
- `stateMs` (optional): get the state every this many ms of real time — a
  whole number 16–1000, default 150 (≈ every 9th tick); 16 ≈ every tick.
  Pick what your agent can keep up with. Ignored in fast training (every
  tick there).
- `repeat` (optional, training lobbies): `true` = endless — once every
  stage is completed you start over at stage 1 and never get
  `evt:agent/completed`; `false` or not set = once through. A race lobby
  is always once through (one shared progress); a rejoin keeps what the
  join chose.
- Answer: `res:agent/join` `{ agentId, token, cars: [{ carId, name, kart }],
  stateMs, repeat }` (`stateMs`: the one you get; `null` in fast training;
  `repeat`: the one used) — or `res:agent/joinError` `{ reason }` (unknown
  lobby, a kart not in the session, no cars, a bad `name`, `stateMs` or
  `repeat`, already joined).
- Then `evt:agent/start` `{ stage: { index, track, layout, loop, laps } }`.
- `token`: keep it — it brings you back as the same agent after a
  disconnect (see "Disconnects and rejoining" below).
- One connection is one agent; leave before joining another lobby.

Rules:
- The race starts when the first driver joins.
- Joining a running race is fine: your cars start the current stage in free
  grid boxes; nobody else is touched.
- When the last driver leaves, the lobby pauses. The next join: in a race
  session the race starts over at stage 1; in a training session each
  client continues at its own stage (a new client starts at stage 1).

---

## 5. Racing: state in, controls out

The race runs at 60 ticks per second (1/60 s of game time each). Every
`stateMs` (your join's) the server sends the state of **your own** cars:
```
evt:agent/state  { tick, cars: [ { carId, ...GameState } ] }
```
Answer with controls for them:
```
req:agent/controls  { tick, cars: [ { carId, forward, backward, steering, brake } ] }
```
- `steering`: -1 (full left) .. 1 (full right) of the car's steering lock
  (anything else → 0); the rest booleans. The wanted position: the wheel
  turns towards it at most 360°/s (0 → full lock in 0.25 s on the rental
  karts, 0.17 s on Racingkart125cc — like a driver's hands); GameState
  `car.steering` is where it is now.
- `forward` / `brake` are on / off (full gas, full brake). They share the
  rear tyres' grip with turning: brake in a straight line — braking while
  cornering near the grip limit brings the rear round; gas while the rear
  slides doesn't push.
- A car keeps your last controls until you send new ones; car ids that
  aren't yours are ignored.
- `tick` is YOUR tick, not the lobby's: 0 at the first tick after your
  join / rejoin and after every `req:agent/restart` (any of your cars —
  the state with tick 0 is the one `evt:agent/restarted` follows), +1 per
  tick. Other agents count their own.
- `tick` in the controls is the tick you answer (copy it from the state).
  Controls apply from the next tick.
- The states come on a fixed schedule, `stateMs` apart on average (the
  server's own work doesn't make it drift): with 150 ms the `tick`s are 8
  or 9 apart. The race doesn't wait for you; `tick` says where it is.
- You get the states whether you answer or not; answer whenever you like
  (normally once per state). A restart (`evt:agent/restarted`) or a new
  stage (`evt:agent/stage`) shows in the next state on the schedule.

```python
while True:
    m = json.loads(await ws.recv())
    if m["ns"] == "evt:agent" and m["action"] == "state":
        tick, cars = m["data"]["tick"], m["data"]["cars"]
        await ws.send(json.dumps({"ns": "req:agent", "action": "controls", "data": {"tick": tick,
            "cars": [{"carId": c["carId"], "forward": True, "backward": False,
                      "steering": 0.0, "brake": False} for c in cars]}}))
```

### Fast training (lockstep)
A lobby created with `fast: true` (or "Fast training" in the App's
`/lobby/create`) doesn't follow the clock: after each tick the server waits
until **every agent** in the lobby has sent `req:agent/controls` with that
`tick`, then runs the next tick at once — as fast as the agents answer (no
cap; one quick agent with a car: ~100× real time). A server can turn fast
lobbies off (`FAST_LOBBIES=false`, e.g. a public one): `fast: true` then
gets `res:lobby/createError` — run fast training against a local server
(each tick waits a network round trip, so it's only fast next to the server).
- Same messages, same GameState, same physics (1/60 s per tick) — only
  faster. Every tick is sent; none is skipped.
- Answer **every** state, with its `tick`. Controls with another tick still
  apply, but don't count as the answer.
- The slowest agent sets the pace.
- No answer for 5 s → you're dropped: `evt:system/error` `{ reason }`, the
  connection is closed (code 4000) and your cars leave. Rejoin with your
  token (see 8).
- Agents only: the App's keyboard player can't join. Viewers (the App's
  `/lobbies`) can watch; they get at most 20 frames per second.

### GameState (per car)
```
{
    car: {
        name: string;     // car class, e.g. "HyrkartCentralen"
        speed: number;
        maxSpeed: number; // km/h, same unit as speed
        x: number;        // car centre, world px (24 px = 1 m)
        y: number;        // car centre, world px
        corners: { x: number; y: number }[]; // 4 corners, world px, clockwise on screen:
                                             // front-left, front-right, rear-right, rear-left
        angle: number;
        steering: number;    // -1..1 (4 decimals): steering wheel now, + = right, relative to the car's steering lock
        wheelAngle: number;  // front wheels now, degrees (2 decimals), + = right
        heading: -1 | 0 | 1; // direction of travel vs the track: 1 correct way, -1 wrong way,
                             // 0 standing still / blocked by a collision
        facing: boolean;     // the nose points the correct way (within ±90° of the track)
        hasCollision: boolean;
        // Tyre slip, normalised (4 decimals): signed ones -1..1, + = right. All 0 while reversing.
        yawRate: number;      // turn rate ÷ the most the grip allows at this speed (gripG × 9.81 / speed):
                              // 1 = rotating as fast as the tyres can carry; less than the steering asks = understeer
        slipAngle: number;    // nose vs direction of travel ÷ 90°: 0 = clean, 1 = fully sideways
        lateralG: number;     // sideways acceleration (accelerometer) ÷ the car's grip: 1 = at the grip limit
        lateralSpeed: number; // sideways speed ÷ maxSpeed
        gripFront: number;    // 0–1, share of the front tyres' grip in use (front high, rear lower = understeer)
        gripRear: number;     // 0–1, share of the rear tyres' grip in use
        rays: number[];   // 8 distances from the car's body (a corner or an edge middle), px
    };
    track: {
        name: string;     // track file, e.g. "Torslanda"
        layout: string;   // layout in that track, e.g. "Training 1"
        loop: boolean;    // true = loop, false = one-way (see "Tracks and layouts")
        totalCheckpoints: number;
        currentCheckpoint: number; // next checkpoint to cross; loop: back to 1 each new lap; stage completed: stays at totalCheckpoints
        laps: number;          // laps the current stage requires (fixed for the stage)
        completedLaps: number; // laps done in the current stage; stage done when >= laps
        completedMeters: number; // metres this stage from the spawn (lead-in from the car's start grid box to the start line
                                 // along the road, then the centreline; car centre);
                                 // every tick, only goes up, can't pass the next checkpoint until crossed;
                                 // lead-in + full distance when completed; 0 on restart / new stage
        lapDistance: number;   // 0–1 (4 decimals), share of the current lap left: 1 until past the start line, then only goes down;
                               // a new lap starts at 1; 0 when completed; 1 on restart / new stage
        lapTime: number;
        lastLapTime: number;
        expectedLapTime: number; // seconds: a good, reachable time for this layout and car class (see "Tracks and layouts"); 0 = not set
    };
    stage: {
        completed: boolean; // this player's run (completedLaps >= laps); the car is then removed from the track until restart / nextStage
    };
    session: {
        completed: boolean; // every stage left with nextStage { completed: true }; always false when you joined with repeat: true
    };
}
```

---

## 6. Restart your cars

```
req:agent/restart  { carIds: ["<carId>", …] }
```
- Restarts **only the listed cars that are yours**: laps, checkpoints, lap
  times, metres → 0, the car back in its grid box. Other ids are ignored;
  nobody else is touched.
- After one tick: `evt:agent/restarted` `{ carIds }` — the cars restarted.

---

## 7. Next stage

```
req:agent/nextStage  { completed: true | false }   // true = done, false = skipped (required)
```
- **Training** session (the default): moves **all your own cars** together
  to your next stage; other clients stay where they are. Only you get
  `evt:agent/stage` `{ stage }`. Each client has its own progress (stage,
  completed / skipped stages, session completed).
- **Race** session: one shared stage — moves EVERY car in the lobby, and
  every agent gets `evt:agent/stage` `{ stage }`.
- A finished car is removed from the track until then (or a restart).
- The session is completed (for you in training, for everyone in a race)
  when every stage was left with `completed: true` → `evt:agent/completed`.
- Skipped stages come round again: after the last stage it goes back to the
  first skipped stage; completed stages are never redone.
- Joined a training lobby with `repeat: true`: the session is never
  completed for you — once every stage is completed you start over at
  stage 1. Every stage starts fresh.

---

## 8. Leaving, disconnects, errors

- `req:agent/leave` — or close the connection; your cars leave the race.
- A request the server can't handle → `evt:system/error`
  `{ reason, ns, action }`.

### Disconnects and rejoining
- When your connection drops, your cars **leave the race at once** (nothing
  is held for you).
- Connect again and send `req:agent/rejoin` `{ token, stateMs? }` (the
  token from your `res:agent/join`; `stateMs` as in the join — not set →
  the one you had): you are back as **the same agent (same client name)
  with the same `carId`s** — the answer is a normal `res:agent/join` + `evt:agent/start`.
  Your cars start the current stage in free grid boxes, like any join;
  nobody else is touched. Training: you continue at your own stage. Race:
  the lobby's stage — if you were the last driver, the lobby paused and
  the rejoin starts the race over at stage 1, as any join would.
- If your old connection is somehow still open, the new one takes the agent
  over; the old one gets nothing more.
- `res:agent/joinError` `{ reason }`: unknown or expired token (the lobby was
  deleted), or this connection already is an agent.

### Lobbies are deleted when nobody uses them
- A lobby with no drivers and no viewers for 10 minutes is deleted (server
  setting `EMPTY_LOBBY_SECONDS`). Its tokens stop working.
- A single-player lobby (`autoAdvance`, the App's own) is deleted as soon
  as its player is gone.

---

## 9. Message list (agent)

| Direction | Message | Data |
|---|---|---|
| ← | `evt:system/welcome` | `{ clientId }` |
| ← | `evt:system/error` | `{ reason, ns?, action? }` |
| → | `req:lobby/list` | — |
| ← | `res:lobby/list` | `{ lobbies }` |
| → | `req:lobby/create` | `{ session, fast? }` |
| ← | `res:lobby/create` / `createError` | `{ lobbyId }` / `{ reason }` |
| → | `req:lobby/delete` | `{ lobbyId }` |
| ← | `res:lobby/delete` / `deleteError` | `{ lobbyId }` / `{ reason }` |
| ← | `evt:lobby/members` | `{ lobbyId, members }` |
| → | `req:agent/join` | `{ lobbyId, name?, cars: [{ name, kart }], stateMs? }` |
| ← | `res:agent/join` / `joinError` | `{ agentId, token, cars, stateMs }` / `{ reason }` |
| ← | `evt:agent/start` | `{ stage }` |
| ← | `evt:agent/state` | `{ tick, cars: [{ carId, …GameState }] }` |
| → | `req:agent/controls` | `{ tick, cars: [{ carId, forward, backward, steering, brake }] }` |
| → | `req:agent/restart` | `{ carIds }` |
| ← | `evt:agent/restarted` | `{ carIds }` |
| → | `req:agent/nextStage` | `{ completed }` |
| ← | `evt:agent/stage` | `{ stage }` |
| ← | `evt:agent/completed` | — |
| → | `req:agent/leave` | — |
| → | `req:agent/rejoin` | `{ token, stateMs? }` → `res:agent/join` + `evt:agent/start` (or `joinError`) |

---

## 10. Test agent

`server/scripts/testAgent.ts` drives on the rays using only this protocol:
```
cd server
npm run test-agent -- --create TrainingEndless --cars 2
npm run test-agent -- --lobby ABC123 --name Bot --kart HyrkartCentralen --seconds 60
npm run test-agent -- --create TrainingEndless --state-ms 50
npm run test-agent -- --create TrainingEndless --cars 3 --client PPO-run-7
```
