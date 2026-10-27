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
            name: string;     // car class, e.g. "GokartGokartCentralen"
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
            completedMeters: number; // metres this stage from the spawn (lead-in to the start line, then the centreline; car centre);
                                     // every tick, only goes up, can't pass the next checkpoint until crossed;
                                     // lead-in + full distance when completed; 0 on restart / new stage
            lapDistance: number;   // 0–1 (4 decimals), share of the current lap left: 1 until past the start line, then only goes down;
                                   // a new lap starts at 1; 0 when completed; 1 on restart / new stage
            lapTime: number;
            lastLapTime: number;
        };
        stage: {
            completed: boolean; // this player's run (completedLaps >= laps); the car is then removed from the track until restart / nextStage
        };
        session: {
            completed: boolean; // every stage left with nextStage { completed: true }
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

---

## Tracks and layouts
`track.name` / `track.layout` in GameState are one of these. Loop layouts count
laps over the start/finish line; one-way layouts end the stage at the finish
(one run, whatever `laps` says).

| Track (`name`) | Layout (`layout`) | Type | Checkpoints |
|---|---|---|---|
| Torslanda | GP Layout | loop | 30 |
| Torslanda | Training 1 | one-way | 3 |
| Torslanda | Training 2 | one-way | 3 |
| Torslanda | Training 3 | one-way | 4 |
| Torslanda | Training 4 | one-way | 4 |
| Torslanda | Training 5 | one-way | 3 |
| Torslanda | Training 6 | one-way | 5 |
| Torslanda | Training 7 | one-way | 7 |
| Jarfalla | GP Layout | loop | 31 |
| Jarfalla | GP Short Layout | loop | 23 |
| Jarfalla | Training 8 | one-way | 9 |
| Jarfalla | Training 9 | one-way | 9 |

### Sessions
| Session | Stages |
|---|---|
| Training One (`TrainingOne`) | Torslanda Training 1 → 7, Jarfalla Training 8 → 9 (1 run each), then 1 lap each of Jarfalla GP Short Layout, Torslanda GP Layout, Jarfalla GP Layout (12 stages) |

## Cars
`car.name` / `car.maxSpeed` in GameState are one of these. `speed` and
`maxSpeed` are km/h; reverse is capped at −`maxSpeed` / 2.

| Car (`name`) | `maxSpeed` (km/h) | Size (m) | Used by |
|---|---|---|---|
| GokartGokartCentralen | 60 | 1.87 × 1.35 | Training One |
| GokartTraining | 100 | 1.8 × 1.2 | — |
| Gokart125cc | 125 | 1.9 × 1.4 | — |
