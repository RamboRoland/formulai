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
            speed: number;
            angle: number;
            hasCollision: boolean;
            rays: number[];
        };
        track: {
            name: string;
            totalCheckpoints: number;
            currentCheckpoint: number;
            completedLaps: number;
            lapTime: number;
            lastLapTime: number;
        };
        stage: {
            completed: boolean;
        };
        session: {
            completed: boolean;
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
            "left": Boolean,
            "right": Boolean,
            "brake": Boolean,
            "restart": Boolean
        }
    }))
    ```
4. Change Track (out dated)
    - Python code ```await websocket.send(json.dumps({"type": "track", "data": "GoKartTrackOne"}))```

5. Start Stage
    - Python code ```await websocket.send(json.dumps({"type": "startStage"}))```

6. Next Stage
    - Python code ```await websocket.send(json.dumps({"type": "nextStage"}))```
