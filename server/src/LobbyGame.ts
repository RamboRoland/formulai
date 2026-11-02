import { performance } from 'perf_hooks';
import { GameEngine, MAX_CATCH_UP_STEPS, STEP_SECONDS } from './game/engine/GameEngine';
import { Player } from './game/Player';
import type { Session } from './game/sessions/Session';
import { createSession } from './game/sessions/registry';
import type { ControlsState } from './game/types';

// How often the timer checks the clock (ms). Steps are still exactly
// STEP_SECONDS each — this only sets how late a step can run (≤ 1 check).
const TIMER_MS = 4;

const IDLE: ControlsState = { forward: false, backward: false, steering: 0, brake: false, restart: false };

// One lobby's race on the server: its session, its players and one game
// engine, stepped in fixed STEP_SECONDS steps by a real-time timer (the
// same catch-up rule as the app: after a stall at most MAX_CATCH_UP_STEPS
// steps in one go, the rest is dropped). Controls are whatever each player
// sent last. Not on the WebSocket yet.
export class LobbyGame {
    public readonly session: Session;
    public readonly players = new Map<string, Player>();
    private engine: GameEngine | null = null;
    private readonly controls = new Map<string, ControlsState>();
    private timer: NodeJS.Timeout | null = null;
    private lastTime = 0;
    private accumulator = 0;

    public constructor(sessionName: string) {
        const session = createSession(sessionName);
        if (!session) throw new Error(`Session "${sessionName}" not found.`);
        if (session.stages.length === 0) throw new Error(`Session "${sessionName}" has no raceable tracks.`);
        this.session = session;
    }

    // A player with a car of `carClass` (one of the session's cars), before
    // the race starts.
    public addPlayer(id: string, name: string, carClass: string, color: string): Player {
        if (this.engine) throw new Error('Players are added before start().');
        const player = new Player(id, name, this.session.chooseCar(carClass), color, this.session.stages);
        this.players.set(id, player);
        return player;
    }

    public setControls(playerId: string, controls: ControlsState): void {
        this.controls.set(playerId, controls);
    }

    // The engine (events, state) once started; null before.
    public getEngine(): GameEngine | null {
        return this.engine;
    }

    // Builds the engine (players on the grid) and starts the timer.
    public start(): GameEngine {
        if (!this.engine) {
            this.engine = new GameEngine(this.session, this.players, id => this.controls.get(id) ?? IDLE, 'ai');
        }
        if (!this.timer) {
            this.lastTime = performance.now();
            this.accumulator = 0;
            this.timer = setInterval(() => this.onTimer(), TIMER_MS);
        }
        return this.engine;
    }

    public stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private onTimer(): void {
        const now = performance.now();
        this.accumulator = Math.min(this.accumulator + (now - this.lastTime) / 1000, STEP_SECONDS * MAX_CATCH_UP_STEPS);
        this.lastTime = now;
        while (this.accumulator >= STEP_SECONDS) {
            this.accumulator -= STEP_SECONDS;
            this.engine?.step(STEP_SECONDS);
        }
    }
}
