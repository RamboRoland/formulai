import { performance } from 'perf_hooks';
import { GameEngine, MAX_CATCH_UP_STEPS, STEP_SECONDS } from './game/engine/GameEngine';
import { Player } from './game/Player';
import { Session } from './game/sessions/Session';
import { SessionProgress } from './game/sessions/SessionProgress';
import { createSession } from './game/sessions/registry';
import type { SessionJSON } from './game/sessions/types';
import type { ControlsState } from './game/types';

// How often the timer checks the clock (ms). Steps are still exactly
// STEP_SECONDS each — this only sets how late a step can run (≤ 1 check).
const TIMER_MS = 4;

const IDLE: ControlsState = { forward: false, backward: false, steering: 0, brake: false, restart: false };

// One lobby's race on the server: its session, its players (cars) and one
// game engine, stepped in fixed STEP_SECONDS steps by a real-time timer
// (the same catch-up rule as the app: after a stall at most
// MAX_CATCH_UP_STEPS steps in one go, the rest is dropped). Controls are
// whatever each player sent last.
//
// Players can be added any time: before the first start they're all put on
// the grid together; during a race a new car starts the current stage in
// the lowest free grid box (nobody else is touched). When the last player
// leaves, the race pauses; the next player to join starts the session over
// from stage 1.
export class LobbyGame {
    public readonly session: Session;
    // Where the lobby is in the session (one shared progress for now —
    // training gets one per client in 7b).
    public readonly progress: SessionProgress;
    public readonly players = new Map<string, Player>();
    private engine: GameEngine | null = null;
    private readonly controls = new Map<string, ControlsState>();
    private timer: NodeJS.Timeout | null = null;
    private lastTime = 0;
    private accumulator = 0;
    private emptied = false;
    // Steps run since the engine was built.
    public tick = 0;

    // autoAdvance: a finish moves the car on to the next stage by itself
    // (single player, the engine's 'player' mode); otherwise a finished car
    // waits for nextStage (agents, 'ai' mode).
    // `session`: a session's name, or a whole (validated) session — e.g. one
    // built in the lobby editor and not saved.
    public constructor(session: string | SessionJSON, private readonly autoAdvance = false) {
        const built = typeof session === 'string' ? createSession(session) : new Session(session);
        const name = typeof session === 'string' ? session : session.name;
        if (!built) throw new Error(`Session "${name}" not found.`);
        if (built.stages.length === 0) throw new Error(`Session "${name}" has no raceable tracks.`);
        this.session = built;
        this.progress = new SessionProgress(built);
    }

    // A player with a car of `carClass` (one of the session's cars).
    public addPlayer(id: string, name: string, carClass: string, color: string): Player {
        if (this.emptied) {
            // The lobby emptied: the session starts over from stage 1.
            this.emptied = false;
            this.progress.reset();
            const player = this.buildPlayer(id, name, carClass, color);
            this.engine!.restartSession([player]);
            return player;
        }
        const player = this.buildPlayer(id, name, carClass, color);
        if (this.engine) {
            // Mid-race: this stage, fresh, in the lowest free grid box.
            if (this.progress.currentStage !== player.currentStageId) player.enterStage(this.progress.currentStage);
            const boxes = Math.max(1, this.progress.stage().track.grid.length);
            const used = new Set([...this.players.values()].map(p => p.car.gridSlot));
            let slot = 0;
            while (used.has(slot) && slot < boxes) slot++;
            player.car.gridSlot = slot < boxes ? slot : this.players.size % boxes;
            player.car.reset();
        }
        this.players.set(id, player);
        return player;
    }

    // The player's car leaves the race. The last one out pauses the race.
    public removePlayer(id: string): void {
        this.controls.delete(id);
        if (this.engine) this.engine.removeActor(id);
        else this.players.delete(id);
        if (this.players.size === 0 && this.engine) {
            this.emptied = true;
            this.stop();
        }
    }

    // Restart these cars only (between two steps): their stage starts over
    // — laps, checkpoints, lap times, metres → 0, the car back in its grid
    // box (Player.resetLap, as the engine's restart). Other cars race on.
    public restartCars(ids: string[]): void {
        for (const id of ids) this.players.get(id)?.resetLap();
    }

    public setControls(playerId: string, controls: ControlsState): void {
        this.controls.set(playerId, controls);
    }

    // The engine (events, state) once started; null before.
    public getEngine(): GameEngine | null {
        return this.engine;
    }

    // Builds the engine (players on the grid) on the first call and starts
    // the timer.
    public start(): GameEngine {
        if (!this.engine) {
            this.engine = new GameEngine(this.session, this.players, id => this.controls.get(id) ?? IDLE, this.autoAdvance ? 'player' : 'ai');
            this.engine.on('stepped', () => { this.tick++; });
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

    public isRunning(): boolean {
        return this.timer !== null;
    }

    private buildPlayer(id: string, name: string, carClass: string, color: string): Player {
        return new Player(id, name, this.session.chooseCar(carClass, this.progress.stage().track), color, this.session.stages, this.progress);
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
