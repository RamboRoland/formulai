import { LobbyGame } from '../LobbyGame';
import type { SessionJSON } from '../game/sessions/types';
import type { Track } from '../game/tracks/Track';
import type { CarControls, Follow, HudStats, LobbyMember, LobbySummary, Message, RenderCar, StageInfo } from '../protocol';
import type { Player } from '../game/Player';
import { buildGameState } from './gameState';
import { renderTrack } from './renderTrack';

// Car colours, in join order (as the old multiplayer host).
const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Who owns cars in a lobby: an agent (one or more cars) or the App's
// keyboard player (one car). `send` reaches its connection.
type Owner = {
    id: string;          // agentId / playerId
    kind: 'agent' | 'player';
    carIds: string[];
    token?: string;      // agents: rejoin later (phase 4)
    send: (message: Message) => void;
};

// Someone watching the lobby (the App): what it follows and the render
// track it has (a new one is sent when the followed layout changes).
type Viewer = {
    follow: Follow | null; // null = the first client
    trackKey: string | null;
    send: (message: Message) => void;
};

// One lobby: its race (LobbyGame) and who drives in it. The race starts
// when the first driver joins; drivers can join a running race; every tick
// each agent gets the state of its own cars and each player of its car.
export class Lobby {
    public readonly game: LobbyGame;
    private readonly owners = new Map<string, Owner>();
    private readonly members = new Map<string, LobbyMember>(); // by carId
    private readonly viewers = new Map<string, Viewer>();      // by connection id
    private colorIndex = 0;
    private wired = false;
    // Someone has driven here (a single-player lobby goes when they're gone).
    public hadDriver = false;
    // Since when nobody drives or watches (null = someone does).
    public emptySince: number | null = Date.now();
    // Restarted cars, announced after the next step (state is then real).
    private pendingRestarts: { ownerId: string; carIds: string[] }[] = [];

    public constructor(public readonly id: string, session: string | SessionJSON, public readonly autoAdvance = false) {
        this.game = new LobbyGame(session, autoAdvance);
    }

    public summary(): LobbySummary {
        return {
            id: this.id,
            session: { name: this.game.session.name, displayName: this.game.session.displayName, cars: [...this.game.session.cars] },
            autoAdvance: this.autoAdvance,
            stages: this.game.session.stages.length,
            members: [...this.members.values()],
        };
    }

    // Adds an owner with its cars; checks every kart against the session.
    // Returns the cars, or an error reason (nothing added then).
    public join(owner: Omit<Owner, 'carIds'>, cars: { carId: string; name: string; kart: string }[]): { reason: string } | null {
        if (this.owners.has(owner.id)) return { reason: 'Already in this lobby.' };
        if (cars.length === 0) return { reason: 'Join with at least one car.' };
        for (const car of cars) {
            if (!this.game.session.cars.includes(car.kart)) {
                return { reason: `Kart "${car.kart}" is not in this session (karts: ${this.game.session.cars.join(', ')}).` };
            }
        }
        this.owners.set(owner.id, { ...owner, carIds: cars.map(c => c.carId) });
        for (const car of cars) {
            this.game.addPlayer(car.carId, car.name, car.kart, COLORS[this.colorIndex++ % COLORS.length]);
            this.members.set(car.carId, { carId: car.carId, name: car.name, kart: car.kart, kind: owner.kind, ownerId: owner.id });
        }
        this.game.start();
        this.wireEngine();
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
        this.updateEmpty();
        this.broadcastMembers();
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

    // Leave the stage (completed or skipped): every car moves on (as today;
    // per car in phase 7).
    public nextStage(completed: boolean): void {
        const engine = this.game.getEngine();
        if (!engine) return;
        const progress = this.game.progress;
        const before = progress.currentStage;
        engine.nextStage(progress, completed);
        if (progress.currentStage !== before || this.game.session.repeat) {
            for (const o of this.owners.values()) {
                if (o.kind === 'agent') o.send({ ns: 'evt:agent', action: 'stage', data: { stage: this.stageInfo() } });
            }
        }
    }

    // Watch the lobby: the render track now, then a frame every tick.
    public watch(viewerId: string, follow: Follow | null, send: (message: Message) => void): void {
        const viewer: Viewer = { follow, trackKey: null, send };
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
    }

    private updateEmpty(): void {
        const empty = this.owners.size === 0 && this.viewers.size === 0;
        if (!empty) this.emptySince = null;
        else this.emptySince ??= Date.now();
    }

    public isEmpty(): boolean {
        return this.owners.size === 0;
    }

    // The stage the race is on now.
    public stageInfo(): StageInfo {
        const progress = this.game.progress;
        const track: Track = progress.stage().track;
        return { index: progress.currentStage, track: track.name, layout: track.layoutName, loop: track.isLoop, laps: progress.stage().stageLaps };
    }

    // Once: push state after every step, announce restarts and the end.
    private wireEngine(): void {
        const engine = this.game.getEngine();
        if (!engine || this.wired) return;
        this.wired = true;
        engine.on('stepped', () => {
            this.announceRestarts();
            this.pushState();
            this.pushFrames();
        });
        engine.on('sessionCompleted', ({ stageTimes, totalTime }) => {
            for (const o of this.owners.values()) {
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

    private pushState(): void {
        const tick = this.game.tick;
        for (const o of this.owners.values()) {
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
    private followedCar(viewer: Viewer): { player: Player; ownerId: string } | null {
        const want = viewer.follow && 'client' in viewer.follow ? viewer.follow.client : null;
        const owners = [...this.owners.values()];
        const owner = owners.find(o => o.id === want) ?? owners[0];
        if (!owner) return null;
        const player = owner.carIds.map(id => this.game.players.get(id)).find(p => p);
        return player ? { player, ownerId: owner.id } : null;
    }

    // The followed layout changed (or first watch) → send its render track.
    private sendTrackIfNew(viewer: Viewer): string {
        const track = renderTrack(this.game.progress.stage().track);
        if (viewer.trackKey !== track.key) {
            viewer.trackKey = track.key;
            viewer.send({ ns: 'evt:view', action: 'track', data: track });
        }
        return track.key;
    }

    private pushFrames(): void {
        if (this.viewers.size === 0) return;
        const engine = this.game.getEngine();
        if (!engine) return;
        const cars: RenderCar[] = engine.renderCars();
        for (const viewer of this.viewers.values()) {
            const key = this.sendTrackIfNew(viewer);
            const followed = this.followedCar(viewer);
            viewer.send({
                ns: 'evt:view', action: 'frame', data: {
                    tick: this.game.tick,
                    key,
                    cars,
                    followed: { carId: followed?.player.id ?? null, ownerId: followed?.ownerId ?? null, stage: this.game.progress.currentStage },
                    hud: followed ? this.hud(followed.player) : null,
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
        const message: Message = { ns: 'evt:lobby', action: 'members', data: { lobbyId: this.id, members: [...this.members.values()] } };
        for (const o of this.owners.values()) o.send(message);
        for (const v of this.viewers.values()) v.send(message);
    }
}
