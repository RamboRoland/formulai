import { performance } from 'perf_hooks';
import { LobbyGame } from '../LobbyGame';
import type { SessionJSON } from '../game/sessions/types';
import { SessionProgress } from '../game/sessions/SessionProgress';
import type { Track } from '../game/tracks/Track';
import type { CarControls, Follow, HudStats, LapTimeEntry, LobbyMember, LobbySummary, Message, RenderCar, StageInfo } from '../protocol';
import type { Player } from '../game/Player';
import { buildGameState } from './gameState';
import { renderTrack } from './renderTrack';

// Car colours, in join order (as the old multiplayer host).
const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Entries in a fastest-laps list.
const TOP_LAPS = 10;

// Fast training: an agent without controls for the tick this long is
// dropped (ms); a finished session (no step) is checked again after (ms);
// viewers get at most one frame per (ms) of real time.
const AGENT_TIMEOUT_MS = 5000;
const IDLE_RETRY_MS = 100;
const FRAME_MS = 1000 / 60;

// Normal lobbies: an agent gets the state every `stateMs` of real time
// (chosen in its join; whole ms in this range).
export const STATE_MS = { default: 150, min: 16, max: 1000 };

// Who owns cars in a lobby: an agent (one or more cars) or the App's
// keyboard player (one car). `send` reaches its connection.
type Owner = {
    id: string;          // agentId / playerId
    kind: 'agent' | 'player';
    carIds: string[];
    token?: string;      // agents: rejoin later (phase 4)
    send: (message: Message) => void;
    drop?: (reason: string) => void; // closes its connection (fast training timeout)
    // Agents in a normal lobby: the state every `stateMs`, on a fixed
    // schedule (`nextState`) — the time a step and the sending take doesn't
    // add up.
    stateMs?: number;
    nextState?: number;
};

// Someone watching the lobby (the App): what it follows and the render
// track it has (a new one is sent when the followed layout changes).
type Viewer = {
    follow: Follow | null; // null = the first client
    trackKey: string | null;
    timesSent: string | null; // "stage:version" of the fastest laps it has
    send: (message: Message) => void;
};

// One lobby: its race (LobbyGame) and who drives in it. The race starts
// when the first driver joins; drivers can join a running race; each agent
// gets the state of its own cars every `stateMs` it chose (fast training:
// every tick), each player the state of its car every tick.
export class Lobby {
    public readonly game: LobbyGame;
    private readonly owners = new Map<string, Owner>();
    // Training: each client's own progress, by owner id — kept after it
    // leaves, so a rejoin continues at its stage (until the lobby goes).
    private readonly progresses = new Map<string, SessionProgress>();
    private readonly members = new Map<string, Omit<LobbyMember, 'stage'>>(); // by carId
    // The members' stages last sent (members are re-sent when one changes).
    private memberStages = '';
    private readonly viewers = new Map<string, Viewer>();      // by connection id
    private colorIndex = 0;
    private wired = false;
    // Someone has driven here (a single-player lobby goes when they're gone).
    public hadDriver = false;
    // Since when nobody drives or watches (null = someone does).
    public emptySince: number | null = Date.now();
    // Restarted cars, announced after the next step (state is then real).
    private pendingRestarts: { ownerId: string; carIds: string[] }[] = [];
    // Fastest laps by stage: a top 10 per kart class, each car once (its
    // best lap); `version` goes up when a list changes. Gone with the lobby.
    private readonly fastest = new Map<number, { version: number; karts: Map<string, LapTimeEntry[]> }>();
    // Fast training (lockstep): the agents that still owe controls for this
    // tick, the timeout that drops them, a step already on its way, and when
    // viewers last got a frame.
    private readonly waiting = new Set<string>();
    private waitTimer: NodeJS.Timeout | null = null;
    private stepPending = false;
    private lastFrames = 0;

    public constructor(public readonly id: string, session: string | SessionJSON, public readonly autoAdvance = false, public readonly fast = false) {
        this.game = new LobbyGame(session, autoAdvance, fast);
    }

    public summary(): LobbySummary {
        return {
            id: this.id,
            session: { name: this.game.session.name, displayName: this.game.session.displayName, cars: [...this.game.session.cars] },
            autoAdvance: this.autoAdvance,
            fast: this.fast,
            mode: this.game.session.mode,
            stages: this.game.session.stages.length,
            stageList: this.game.session.stages.map((_, index) => this.stageInfoAt(index)),
            members: this.memberList(),
        };
    }

    // Adds an owner with its cars; checks every kart against the session.
    // Returns the cars, or an error reason (nothing added then).
    public join(owner: Omit<Owner, 'carIds'>, cars: { carId: string; name: string; kart: string }[]): { reason: string } | null {
        if (this.owners.has(owner.id)) return { reason: 'Already in this lobby.' };
        if (this.fast && owner.kind === 'player') return { reason: 'This is a fast training lobby: agents only.' };
        if (cars.length === 0) return { reason: 'Join with at least one car.' };
        for (const car of cars) {
            if (!this.game.session.cars.includes(car.kart)) {
                return { reason: `Kart "${car.kart}" is not in this session (karts: ${this.game.session.cars.join(', ')}).` };
            }
        }
        this.owners.set(owner.id, { ...owner, carIds: cars.map(c => c.carId) });
        for (const car of cars) {
            this.game.addPlayer(car.carId, car.name, car.kart, COLORS[this.colorIndex++ % COLORS.length], this.progressFor(owner.id));
            this.members.set(car.carId, { carId: car.carId, name: car.name, kart: car.kart, kind: owner.kind, ownerId: owner.id });
        }
        this.game.start();
        this.wireEngine();
        // Fast training: the first step (or the first after a pause); a
        // join mid-race just answers from the next tick on.
        if (this.fast && !this.waitTimer && !this.stepPending) this.scheduleStep();
        this.hadDriver = true;
        this.updateEmpty();
        this.broadcastMembers();
        return null;
    }

    // The owner's cars leave the race (connection closed or leave request).
    public leave(ownerId: string): void {
        const owner = this.owners.get(ownerId);
        if (!owner) return;
        this.owners.delete(ownerId);
        for (const carId of owner.carIds) {
            this.members.delete(carId);
            this.game.removePlayer(carId);
        }
        if (this.fast) {
            // Nobody waits for it any more; the last one out paused the race.
            this.waiting.delete(ownerId);
            if (!this.game.isRunning()) this.clearWait();
            else if (this.waitTimer && this.waiting.size === 0) this.scheduleStep();
        }
        this.updateEmpty();
        this.broadcastMembers();
    }

    // Fast training: an agent's controls for `tick` are in. Once every
    // agent has answered the current tick, the next step runs.
    public answered(ownerId: string, tick: number): void {
        if (!this.fast || tick !== this.game.tick || !this.waiting.delete(ownerId)) return;
        if (this.waiting.size === 0) this.scheduleStep();
    }

    // After a step: wait for every agent's controls for it (agents that
    // stay silent AGENT_TIMEOUT_MS are dropped).
    private armWait(): void {
        this.clearWait();
        for (const o of this.owners.values()) if (o.kind === 'agent') this.waiting.add(o.id);
        if (this.waiting.size === 0) {
            this.scheduleStep();
            return;
        }
        const tick = this.game.tick;
        this.waitTimer = setTimeout(() => {
            // Its connection is closed and its cars leave now; the others go on.
            for (const id of [...this.waiting]) {
                console.log(`Lobby ${this.id}: agent ${id} dropped (no controls for tick ${tick} in ${AGENT_TIMEOUT_MS / 1000} s).`);
                this.owners.get(id)?.drop?.(`No controls for tick ${tick} in ${AGENT_TIMEOUT_MS / 1000} s (fast training).`);
                this.leave(id);
            }
        }, AGENT_TIMEOUT_MS);
    }

    private clearWait(): void {
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.waitTimer = null;
        this.waiting.clear();
    }

    // The next step, after the current I/O (never inside a message handler).
    // No step happened (the session is finished) → look again a bit later.
    private scheduleStep(): void {
        this.clearWait();
        if (this.stepPending) return;
        this.stepPending = true;
        setImmediate(() => {
            this.stepPending = false;
            if (!this.game.isRunning()) return;
            const before = this.game.tick;
            this.game.step();
            if (this.game.tick === before) {
                this.stepPending = true;
                setTimeout(() => { this.stepPending = false; if (this.game.isRunning()) this.scheduleStep(); }, IDLE_RETRY_MS);
            }
        });
    }

    public has(ownerId: string): boolean {
        return this.owners.has(ownerId);
    }

    // Controls for some of the owner's cars; other car ids are ignored.
    public setControls(ownerId: string, carId: string, c: CarControls): void {
        const owner = this.owners.get(ownerId);
        if (!owner || !owner.carIds.includes(carId)) return;
        this.game.setControls(carId, { ...c, restart: false });
    }

    public ownCarIds(ownerId: string): string[] {
        return this.owners.get(ownerId)?.carIds ?? [];
    }

    // Restart some of the owner's own cars (other car ids are ignored);
    // nobody else is touched. Returns the cars restarted.
    public restart(ownerId: string, carIds: string[]): string[] {
        const own = this.ownCarIds(ownerId).filter(id => carIds.includes(id));
        if (own.length === 0) return [];
        this.game.restartCars(own);
        this.pendingRestarts.push({ ownerId, carIds: own });
        return own;
    }

    // Where this client is in the session: race → the lobby's one shared
    // progress; training → its own (made on first join, kept for a rejoin).
    public progressFor(ownerId: string): SessionProgress {
        if (this.game.session.mode === 'race') return this.game.progress;
        let progress = this.progresses.get(ownerId);
        if (!progress) {
            progress = new SessionProgress(this.game.session);
            this.progresses.set(ownerId, progress);
        }
        return progress;
    }

    // `ownerId` leaves the stage (completed or skipped). Race: every car in
    // the lobby moves on; training: only this client's cars.
    public nextStage(ownerId: string, completed: boolean): void {
        const engine = this.game.getEngine();
        if (!engine || !this.owners.has(ownerId)) return;
        const progress = this.progressFor(ownerId);
        const before = progress.currentStage;
        engine.nextStage(progress, completed);
        if (progress.currentStage !== before || this.game.session.repeat) {
            for (const o of this.ownersOn(progress)) {
                if (o.kind === 'agent') o.send({ ns: 'evt:agent', action: 'stage', data: { stage: this.stageInfo(o.id) } });
            }
        }
    }

    // The clients on a progress (race: everyone; training: one).
    private ownersOn(progress: SessionProgress): Owner[] {
        return [...this.owners.values()].filter(o => this.progressFor(o.id) === progress);
    }

    // Watch the lobby: the render track now, then a frame every tick.
    public watch(viewerId: string, follow: Follow | null, send: (message: Message) => void): void {
        const viewer: Viewer = { follow, trackKey: null, timesSent: null, send };
        this.viewers.set(viewerId, viewer);
        this.updateEmpty();
        this.sendTrackIfNew(viewer);
    }

    public unwatch(viewerId: string): void {
        this.viewers.delete(viewerId);
        this.updateEmpty();
    }

    // The race stops for good (the lobby is being deleted).
    public close(): void {
        this.game.stop();
        this.clearWait();
    }

    private updateEmpty(): void {
        const empty = this.owners.size === 0 && this.viewers.size === 0;
        if (!empty) this.emptySince = null;
        else this.emptySince ??= Date.now();
    }

    public isEmpty(): boolean {
        return this.owners.size === 0;
    }

    // The stage this client is on now.
    public stageInfo(ownerId: string): StageInfo {
        return this.stageInfoAt(this.progressFor(ownerId).currentStage);
    }

    private stageInfoAt(index: number): StageInfo {
        const stage = this.game.session.stages[index];
        const track: Track = stage.track;
        return { index, track: track.name, layout: track.layoutName, loop: track.isLoop, laps: stage.stageLaps };
    }

    // The members with the stage each car is on now.
    private memberList(): LobbyMember[] {
        return [...this.members.values()].map(m => ({ ...m, stage: this.game.players.get(m.carId)?.currentStageId ?? 0 }));
    }

    // Once: push state after every step, announce restarts and the end.
    private wireEngine(): void {
        const engine = this.game.getEngine();
        if (!engine || this.wired) return;
        this.wired = true;
        engine.on('stepped', () => {
            this.announceRestarts();
            // Fast training: wait for every agent's answer to this state.
            if (this.fast) this.armWait();
            this.pushState();
            this.pushFrames();
            // Someone changed stage (nextStage, auto-advance) → members again.
            const stages = this.memberList().map(m => `${m.carId}:${m.stage}`).join(',');
            if (stages !== this.memberStages) this.broadcastMembers();
        });
        engine.on('lapCompleted', ({ playerId, lapTime }) => this.recordLap(playerId, lapTime));
        engine.on('sessionCompleted', ({ playerId, stageTimes, totalTime }) => {
            // Only the clients on the progress that just completed.
            const progress = this.game.players.get(playerId)?.progress;
            if (!progress) return;
            for (const o of this.ownersOn(progress)) {
                if (o.kind === 'agent') o.send({ ns: 'evt:agent', action: 'completed' });
                else o.send({ ns: 'evt:player', action: 'completed', data: { stageTimes, totalTime } });
            }
        });
    }

    // One step has run since these cars were restarted: tell their agents.
    private announceRestarts(): void {
        for (const { ownerId, carIds } of this.pendingRestarts) {
            const o = this.owners.get(ownerId);
            if (o?.kind === 'agent') o.send({ ns: 'evt:agent', action: 'restarted', data: { carIds } });
        }
        this.pendingRestarts = [];
    }

    // A lap (or a one-way run) is done: into its stage's list for the car's
    // kart, if it's the car's best and in the top 10.
    private recordLap(carId: string, seconds: number): void {
        const player = this.game.players.get(carId);
        const member = this.members.get(carId);
        const lapTime = Math.round(seconds * 1000) / 1000;
        if (!player || !member || !(lapTime > 0)) return;
        let times = this.fastest.get(player.currentStageId);
        if (!times) this.fastest.set(player.currentStageId, times = { version: 0, karts: new Map() });
        const list = times.karts.get(member.kart) ?? [];
        const own = list.find(e => e.carId === carId);
        if (own && own.lapTime <= lapTime) return;
        const next = [...list.filter(e => e.carId !== carId), { carId, name: member.name, ownerId: member.ownerId, lapTime }]
            .sort((a, b) => a.lapTime - b.lapTime)
            .slice(0, TOP_LAPS);
        if (!next.some(e => e.carId === carId)) return;
        times.karts.set(member.kart, next);
        times.version++;
    }

    // Players: every tick. Agents: every tick in fast training, else when
    // their schedule says so (more than one interval behind → again from now).
    private pushState(): void {
        const tick = this.game.tick;
        const now = performance.now();
        for (const o of this.owners.values()) {
            if (o.kind === 'agent' && !this.fast) {
                const stateMs = o.stateMs ?? STATE_MS.default;
                if (now < (o.nextState ?? 0)) continue;
                o.nextState = (o.nextState ?? now) + stateMs;
                if (o.nextState <= now) o.nextState = now + stateMs;
            }
            const states = o.carIds.flatMap(carId => {
                const player = this.game.players.get(carId);
                return player ? [{ carId, ...buildGameState(player) }] : [];
            });
            if (o.kind === 'agent') o.send({ ns: 'evt:agent', action: 'state', data: { tick, cars: states } });
            else if (states[0]) o.send({ ns: 'evt:player', action: 'state', data: { tick, car: states[0] } });
        }
    }

    // The car a viewer follows: its client's first car still in the race
    // (default / gone: the first client's). Stage-following: phase 7 (one
    // shared stage today).
    // What a viewer sees: a stage, and the car it follows on it (null =
    // none on the track → no HUD).
    // - follow a client (default: the first): that client's stage; its car
    //   while it runs. Not running (finished, waiting for nextStage) → stay
    //   on its stage. The client left → the first client.
    // - follow a stage: that stage; the leader on it (furthest along).
    // `kart` (the fastest laps shown): the followed car's — a followed
    // client's first car when none runs.
    private view(viewer: Viewer): { stage: number; player: Player | null; ownerId: string | null; kart: string | null } {
        const kartOf = (carId: string | undefined) => (carId && this.members.get(carId)?.kart) || null;
        const onTrack = (p: Player | undefined): p is Player => !!p && !p.isStageCompleted(p.stage());
        if (viewer.follow && 'stage' in viewer.follow) {
            const stage = Math.max(0, Math.min(this.game.session.stages.length - 1, viewer.follow.stage));
            let leader: Player | null = null;
            for (const p of this.game.players.values()) {
                if (p.currentStageId !== stage || !onTrack(p)) continue;
                if (!leader || p.stage().completedMeters > leader.stage().completedMeters) leader = p;
            }
            return { stage, player: leader, ownerId: leader ? this.members.get(leader.id)?.ownerId ?? null : null, kart: kartOf(leader?.id) };
        }
        const want = viewer.follow && 'client' in viewer.follow ? viewer.follow.client : null;
        const owners = [...this.owners.values()];
        const owner = owners.find(o => o.id === want) ?? owners[0];
        if (!owner) return { stage: this.game.progress.currentStage, player: null, ownerId: null, kart: null };
        const cars = owner.carIds.map(id => this.game.players.get(id)).filter((p): p is Player => !!p);
        const running = cars.find(onTrack) ?? null;
        return { stage: this.progressFor(owner.id).currentStage, player: running, ownerId: owner.id, kart: kartOf(running?.id ?? owner.carIds[0]) };
    }

    // The watched layout changed (or first watch) → send its render track.
    private sendTrackIfNew(viewer: Viewer, stage = this.view(viewer).stage): string {
        const track = renderTrack(this.game.session.stages[stage].track);
        if (viewer.trackKey !== track.key) {
            viewer.trackKey = track.key;
            viewer.send({ ns: 'evt:view', action: 'track', data: track });
        }
        return track.key;
    }

    // The watched stage's fastest laps: when the viewer gets to the stage
    // and when a list on it changes.
    private sendTimesIfNew(viewer: Viewer, stage: number): void {
        const times = this.fastest.get(stage);
        const sent = `${stage}:${times?.version ?? 0}`;
        if (viewer.timesSent === sent) return;
        viewer.timesSent = sent;
        const karts: Record<string, LapTimeEntry[]> = {};
        for (const kart of this.game.session.cars) {
            const list = times?.karts.get(kart);
            if (list) karts[kart] = list;
        }
        viewer.send({ ns: 'evt:view', action: 'times', data: { stage, karts } });
    }

    private pushFrames(): void {
        if (this.viewers.size === 0) return;
        // Fast training: at most ~60 frames per second of real time.
        if (this.fast) {
            const now = performance.now();
            if (now - this.lastFrames < FRAME_MS) return;
            this.lastFrames = now;
        }
        const engine = this.game.getEngine();
        if (!engine) return;
        const cars: RenderCar[] = engine.renderCars();
        for (const viewer of this.viewers.values()) {
            const view = this.view(viewer);
            const key = this.sendTrackIfNew(viewer, view.stage);
            this.sendTimesIfNew(viewer, view.stage);
            viewer.send({
                ns: 'evt:view', action: 'frame', data: {
                    tick: this.game.tick,
                    key,
                    // Only the cars on the watched stage (others are on other tracks).
                    cars: cars.filter(c => this.game.players.get(c.id)?.currentStageId === view.stage),
                    followed: {
                        carId: view.player?.id ?? null,
                        ownerId: view.ownerId,
                        stage: view.stage,
                        kart: view.kart,
                    },
                    hud: view.player ? this.hud(view.player) : null,
                },
            });
        }
    }

    // The followed car's HUD (as the App's StatsBox + steering wheel showed).
    private hud(player: Player): HudStats {
        const stage = player.stage();
        return {
            speed: player.car.speed,
            angle: player.car.angle,
            x: player.car.x,
            y: player.car.y,
            hasCollision: player.car.hasCollision,
            lapTime: player.lapTime(),
            stageTime: stage.stageTime,
            currentCheckpoint: stage.currentCheckpoint,
            totalCheckpoints: player.progress.stage().track.checkpoints.length,
            completedLaps: stage.lapsCompleted,
            steeringAngle: player.car.steeringAngle,
        };
    }

    private broadcastMembers(): void {
        const members = this.memberList();
        this.memberStages = members.map(m => `${m.carId}:${m.stage}`).join(',');
        const message: Message = { ns: 'evt:lobby', action: 'members', data: { lobbyId: this.id, members } };
        for (const o of this.owners.values()) o.send(message);
        for (const v of this.viewers.values()) v.send(message);
    }
}
