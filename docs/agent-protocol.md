# Agent protocol (`formulai`)

How an AI agent talks to the Formulai game server over WebSocket: what
changed from the old protocol, every message an agent sends and gets, and
the rules around them. The message types are defined in
`server/src/protocol/` (the App has an identical copy in `app/protocol/`);
this file describes the agent's side of them.

---

## 1. What changed (old → new)

The car data (`GameState`) is **exactly the same**, field for field. The
flow around it changed: the game runs on the server, an agent joins a lobby
and the server pushes the state every tick.

| | Old | New |
|---|---|---|
| Connect | subprotocol `control` | subprotocol **`formulai`** (anything else is refused) |
| Getting into a race | none — the App hosted the race; the agent sent controls | **join a lobby** with your cars (`req:agent/join`); create one with `req:lobby/create` or join an existing one |
| State | the agent **asked** (`req:game/state` / `req:game/requestPlayerState`) and got one answer | the server **pushes** `evt:agent/state` **every tick** (1/60 s) — no request |
| Shape of the state | one `GameState` (multiplayer: wrapped in `{ gameState }`) | `{ tick, cars: [{ carId, …GameState }] }` — a list, also for one car |
| Controls | `req:control/send` `{ forward, backward, steering, brake, restart }` | `req:agent/controls` `{ tick, cars: [{ carId, forward, backward, steering, brake }] }` — per car, **no `restart`** |
| Restart | `restart: true` in the controls (reset every car in the stage) | `req:agent/restart { carIds }` — **only your own listed cars** |
| Next stage | `req:control/nextStage { completed }` | `req:agent/nextStage { completed }` (same data) |
| Start stage | `req:control/startStage` | gone — a stage starts by itself |
| Several cars | one car per connection | one agent can drive **several cars** (each has a `carId`) |
| Session done | `session.completed` in GameState | still there, plus `evt:agent/completed` |

### Update an agent in 4 steps
1. Connect with the subprotocol `formulai`.
2. At start: create or find a lobby and `req:agent/join` it with your car(s);
   remember each car's `carId`.
3. Turn the loop around: instead of requesting state, wait for
   `evt:agent/state` and answer every one with `req:agent/controls` (copy
   its `tick`; one entry per `carId`).
4. Restart = `req:agent/restart { carIds }` (no `restart` flag in the
   controls any more); next stage = `req:agent/nextStage { completed }`.

Reading the car data (rays, speed, checkpoints, metres …) doesn't change.

---

## 2. Connecting

- Address: `ws://<host>:<PORT>` — default `ws://localhost:8080`
  (`server/.env` → `PORT`; on a public server e.g. `wss://game.example.com`).
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

---

## 3. Lobbies

| Send | Answer |
|---|---|
| `req:lobby/list` | `res:lobby/list` `{ lobbies: [LobbySummary] }` |
| `req:lobby/create` `{ session: "<name>" }` | `res:lobby/create` `{ lobbyId }` — or `res:lobby/createError` `{ reason }` |

`LobbySummary`:
```
{ id, session: { name, displayName, cars /* kart classes you may join with */ },
  autoAdvance, stages /* count */, members: [{ carId, name, kart, kind: "agent" | "player", ownerId }] }
```

- Sessions (names, stages, karts): `GET http://<host>:<PORT>/api/sessions`;
  kart classes: `GET /api/karts`.
- Everyone in a lobby gets `evt:lobby/members` `{ lobbyId, members }` when
  someone joins or leaves.

---

## 4. Joining with cars

```json
{ "ns": "req:agent", "action": "join",
  "data": { "lobbyId": "ABC123", "cars": [ { "name": "Bot 1", "kart": "HyrkartCentralen" },
                                            { "name": "Bot 2", "kart": "HyrkartCentralen" } ] } }
```
- Answer: `res:agent/join` `{ agentId, token, cars: [{ carId, name, kart }] }`
  — or `res:agent/joinError` `{ reason }` (unknown lobby, a kart not in the
  session, no cars, more than 20 cars, already joined).
- Then `evt:agent/start` `{ stage: { index, track, layout, loop, laps } }`.
- `token`: keep it — it brings you back as the same agent after a
  disconnect (see "Disconnects and rejoining" below).
- One connection is one agent; leave before joining another lobby.

Rules:
- The race starts when the first driver joins.
- Joining a running race is fine: your cars start the current stage in free
  grid boxes; nobody else is touched.
- When the last driver leaves, the lobby pauses; the next join starts the
  session over at stage 1.

---

## 5. Racing: state in, controls out

Every tick (1/60 s of game time) the server sends the state of **your own**
cars:
```
evt:agent/state  { tick, cars: [ { carId, ...GameState } ] }
```
Answer with controls for them:
```
req:agent/controls  { tick, cars: [ { carId, forward, backward, steering, brake } ] }
```
- `steering`: -1 (full left) .. 1 (full right) of the car's steering lock
  (anything else → 0); the rest booleans.
- A car keeps your last controls until you send new ones; car ids that
  aren't yours are ignored.
- `tick` in the controls is the tick you answer (used for lockstep "fast
  training" later; today controls apply from the next tick).

```python
while True:
    m = json.loads(await ws.recv())
    if m["ns"] == "evt:agent" and m["action"] == "state":
        tick, cars = m["data"]["tick"], m["data"]["cars"]
        await ws.send(json.dumps({"ns": "req:agent", "action": "controls", "data": {"tick": tick,
            "cars": [{"carId": c["carId"], "forward": True, "backward": False,
                      "steering": 0.0, "brake": False} for c in cars]}}))
```

### GameState (per car, unchanged)
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
        completed: boolean; // every stage left with nextStage { completed: true }; always false for a repeating session
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
- Every agent gets `evt:agent/stage` `{ stage }`.
- Moves EVERY car in the lobby to the next stage today (per client in
  training sessions: planned). A finished car is removed from the track
  until then (or a restart).
- The session is completed when every stage was left with
  `completed: true` → `evt:agent/completed`.
- Skipped stages come round again: after the last stage it goes back to the
  first skipped stage; completed stages are never redone.
- A repeating session (`"repeat": true`, e.g. Training Endless) is never
  completed: once every stage is completed it starts over at stage 1. Every
  stage starts fresh.

---

## 8. Leaving, disconnects, errors

- `req:agent/leave` — or close the connection; your cars leave the race.
- A request the server can't handle → `evt:system/error`
  `{ reason, ns, action }`.

### Disconnects and rejoining
- When your connection drops, your cars **leave the race at once** (nothing
  is held for you).
- Connect again and send `req:agent/rejoin` `{ token }` (the token from your
  `res:agent/join`): you are back as **the same agent with the same
  `carId`s** — the answer is a normal `res:agent/join` + `evt:agent/start`.
  Your cars start the current stage in free grid boxes, like any join;
  nobody else is touched. (If you were the last driver, the lobby paused
  and the rejoin starts the session over at stage 1, as any join would.)
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
| → | `req:lobby/create` | `{ session }` |
| ← | `res:lobby/create` / `createError` | `{ lobbyId }` / `{ reason }` |
| ← | `evt:lobby/members` | `{ lobbyId, members }` |
| → | `req:agent/join` | `{ lobbyId, cars: [{ name, kart }] }` |
| ← | `res:agent/join` / `joinError` | `{ agentId, token, cars }` / `{ reason }` |
| ← | `evt:agent/start` | `{ stage }` |
| ← | `evt:agent/state` | `{ tick, cars: [{ carId, …GameState }] }` |
| → | `req:agent/controls` | `{ tick, cars: [{ carId, forward, backward, steering, brake }] }` |
| → | `req:agent/restart` | `{ carIds }` |
| ← | `evt:agent/restarted` | `{ carIds }` |
| → | `req:agent/nextStage` | `{ completed }` |
| ← | `evt:agent/stage` | `{ stage }` |
| ← | `evt:agent/completed` | — |
| → | `req:agent/leave` | — |
| → | `req:agent/rejoin` | `{ token }` → `res:agent/join` + `evt:agent/start` (or `joinError`) |

---

## 10. Test agent

`server/scripts/testAgent.ts` drives on the rays using only this protocol:
```
cd server
npm run test-agent -- --create TrainingEndless --cars 2
npm run test-agent -- --lobby ABC123 --name Bot --kart HyrkartCentralen --seconds 60
```
