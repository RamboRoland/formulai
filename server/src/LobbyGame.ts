import { performance } from 'perf_hooks';
import { GameEngine, MAX_CATCH_UP_STEPS, STEP_SECONDS } from './game/engine/GameEngine';
import { Player } from './game/Player';
import { Session } from './game/sessions/Session';
import { SessionProgress } from './game/sessions/SessionProgress';
import { createSession } from './game/sessions/registry';
import type { SessionJSON } from './game/sessions/types';
import type { ControlsState } from './game/types';

const IDLE: ControlsState = { forward: 0, backward: 0, steering: 0, brake: 0, restart: false };

// One lobby's race on the server: its session, its players (cars) and one
// game engine, stepped in fixed STEP_SECONDS steps by a real-time timer
// (the same catch-up rule as the app: after a stall at most
// MAX_CATCH_UP_STEPS steps in one go, the rest is dropped) — or, fast
// training, by the lobby (step()). Controls are whatever each player sent
// last.
//
// Players can be added any time: before the first start they're all put on
// the grid together; during a race a new car starts the current stage in
// the lowest free grid box (nobody else is touched). When the last player
// leaves, the race pauses; the next player to join starts the session over
// from stage 1.
export class LobbyGame {
    public readonly session: Session;
    // Race: where the whole lobby is in the session (one shared progress).
    // Training: each client has its own (see progressFor in Lobby) — this
    // one is then unused.
    public readonly progress: SessionProgress;
    public readonly players = new Map<string, Player>();
    private engine: GameEngine | null = null;
    private readonly controls = new Map<string, ControlsState>();
    private timer: NodeJS.Timeout | null = null;
    private lastTime = 0;
    private accumulator = 0;
    private emptied = false;
    // Fast training: started (stepped by the lobby, no timer).
    private running = false;
    // Steps run since the engine was built.
    public tick = 0;

    // autoAdvance: a finish moves the car on to the next stage by itself
    // (single player, the engine's 'player' mode); otherwise a finished car
    // waits for nextStage (agents, 'ai' mode).
    // `session`: a session's name, or a whole (validated) session — e.g. one
    // built in the lobby editor and not saved.
    // fast: fast training — stepped by the lobby (lockstep), not real time.
    public constructor(session: string | SessionJSON, private readonly autoAdvance = false, public readonly fast = false) {
        const built = typeof session === 'string' ? createSession(session) : new Session(session);
        const name = typeof session === 'string' ? session : session.name;
        if (!built) throw new Error(`Session "${name}" not found.`);
        if (built.stages.length === 0) throw new Error(`Session "${name}" has no raceable tracks.`);
        this.session = built;
        this.progress = new SessionProgress(built);
    }

    // A player with a car of `carClass` (one of the session's cars), on
    // `progress` (race: the shared one; training: its client's).
    public addPlayer(id: string, name: string, carClass: string, color: string, progress: SessionProgress = this.progress): Player {
        if (this.emptied) {
            // The lobby emptied: a race starts over from stage 1 (a training
            // client's own progress stays where it was).
            this.emptied = false;
            if (progress === this.progress) progress.reset();
            const player = this.buildPlayer(id, name, carClass, color, progress);
            this.engine!.restartSession([player]);
            return player;
        }
        const player = this.buildPlayer(id, name, carClass, color, progress);
        if (this.engine) {
            // Mid-race: its progress' stage, fresh, in the lowest grid box
            // that no car on that stage uses.
            const stage = progress.currentStage;
            if (stage !== player.currentStageId) player.enterStage(stage);
            const boxes = Math.max(1, progress.stage().track.grid.length);
            const used = new Set([...this.players.values()].filter(p => p.currentStageId === stage).map(p => p.car.gridSlot));
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
    // the timer — fast training (lockstep): no timer, the lobby calls step()
    // once every agent has answered.
    public start(): GameEngine {
        if (!this.engine) {
            this.engine = new GameEngine(this.session, this.players, id => this.controls.get(id) ?? IDLE, this.autoAdvance ? 'player' : 'ai');
            this.engine.on('stepped', () => { this.tick++; });
        }
        if (this.fast) this.running = true;
        else if (!this.timer) {
            this.lastTime = performance.now();
            this.accumulator = 0;
            this.timer = setTimeout(() => this.onTimer(), 0);
        }
        return this.engine;
    }

    // Fast training: one step now.
    public step(): void {
        if (this.running) this.engine?.step(STEP_SECONDS);
    }

    public stop(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.running = false;
    }

    public isRunning(): boolean {
        return this.timer !== null || this.running;
    }

    private buildPlayer(id: string, name: string, carClass: string, color: string, progress: SessionProgress): Player {
        return new Player(id, name, this.session.chooseCar(carClass, progress.stage().track), color, this.session.stages, progress);
    }

    // Steps are exactly STEP_SECONDS each; the timer wakes when the next one
    // is due (not every few ms), so a step runs at most ~1 ms late.
    private onTimer(): void {
        const timer = this.timer;
        const now = performance.now();
        this.accumulator = Math.min(this.accumulator + (now - this.lastTime) / 1000, STEP_SECONDS * MAX_CATCH_UP_STEPS);
        this.lastTime = now;
        while (this.accumulator >= STEP_SECONDS) {
            this.accumulator -= STEP_SECONDS;
            this.engine?.step(STEP_SECONDS);
        }
        // stop() during a step (the last player out) → don't wake again
        // (a start() since then has its own timer).
        if (this.timer !== timer) return;
        const wait = (STEP_SECONDS - this.accumulator) * 1000;
        this.timer = setTimeout(() => this.onTimer(), Math.max(1, Math.floor(wait)));
    }
}
