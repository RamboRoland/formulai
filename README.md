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

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

## Websockets communication
### AI
1. Connect to websockets server with protocol control
    - Python code ```websockets.connect("ws://localhost:8080", subprotocols=["control"])```
2. Get GameState
    - First ask for data Python code ```websocket.send(json.dumps({"type": "requestGameState"}))```
    - Second wait for data  Python code
    ```
    while True:
        message = await websocket.recv()
        json_data = json.loads(message)
        if json_data['type'] == "gameState":
            game_state = json_data['data']
            break
    ```
    - GameState type
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
3. Send controls
    - Python code
    ```
    await websocket.send(json.dumps({
        "type": "controls",
        "data": {
            "forward": Boolean,
            "backward": Boolean,
            "steering": Number,  # -1 (full left) .. 1 (full right) of the car's steering lock; replaces left/right
            "brake": Boolean,
            "restart": Boolean
        }
    }))
    ```
4. Change Track (out dated — not implemented, the session decides the tracks)
    - Python code ```await websocket.send(json.dumps({"type": "track", "data": "Torslanda"}))```

5. Start Stage
    - Python code ```await websocket.send(json.dumps({"type": "startStage"}))```

6. Next Stage (the client decides when; `completed`: true = done, false = skipped — required)
    - Python code ```await websocket.send(json.dumps({"ns": "req:control", "action": "nextStage", "data": {"completed": True}}))```
    - Moves EVERY player to the next stage (multiplayer: the whole lobby). Finished cars are removed from the track until then (or a restart).
    - The session is completed when every stage was left with `completed: true`.
    - Skipped stages come round again: after the last stage it goes back to the first skipped stage, and only skipped stages are replayed (completed stages are never redone) until every stage is completed.
    - A repeating session (`"repeat": true`, e.g. Training Endless) is never completed: after the last stage it goes back to the first stage that isn't completed (skipped stages are replayed), and once every stage is completed it starts over at stage 1. Every stage starts fresh.

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
| Jarfalla | Training 8 | one-way | 9 | 21.0 | 24.1 | 16.5 |
| Jarfalla | Training 9 | one-way | 9 | 19.8 | 22.6 | 15.0 |
| Lycksele | GP | loop | 5 | 63.6 | 67.7 | 46.8 |
| Lulea Kallax | GP | loop | 6 | 59.9 | 66.3 | 45.6 |
| Skovde | GP | loop | 8 | 76.1 | 82.8 | 57.7 |

### Start grid
Cars start in painted boxes behind the start line, two columns, following the
road (a box can sit in a curve). Each car's front is at the front of its box.

- Single player / AI mode: always the first box (pole).
- Multiplayer: a new random order every stage, filled from pole; more cars
  than boxes → round again from pole.
- Restart puts every car back in its own box; `completedMeters` is 0 there.

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
| Jarfalla | GP, GP Short, Training 8, 9 | 20 |
| Lycksele | GP | 24 |
| Lulea Kallax | GP | 24 |
| Skovde | GP | 28 |

### Sessions
| Session | Stages |
|---|---|
| Training One (`TrainingOne`) | Torslanda Training 1 → 7, Jarfalla Training 8 → 9 (1 run each, 9 stages) |
| Training Endless (`TrainingEndless`) | 5 laps each of Lycksele GP, Lulea Kallax GP, Skovde GP, Torslanda GP, Jarfalla GP (5 stages), repeating forever (`"repeat": true`). Multiplayer lobby only (single player / AI mode race Training One) |

Both sessions offer all three cars; multiplayer players choose one, single
player / AI mode drive the first (HyrkartCentralen).

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
| HyrkartCentralen | Sodi RSX2 electric rental kart (Gokartcentralen Gothenburg) | 60 | 1.95 × 1.38 | 1.2 | Training One, Training Endless (every mode; single player / AI mode always this one) |
| Hyrkart240cc | Petrol rental kart (Torslanda) | 80 | 2.0 × 1.4 | 1.2 | Training One, Training Endless (multiplayer) |
| Racingkart125cc | 125cc racing kart | 115 | 1.8 × 1.4 | 1.8 | Training One, Training Endless (multiplayer) |
