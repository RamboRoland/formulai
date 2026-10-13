import { BaseEngine } from './BaseEngine';
import type { Session } from '~/sessions/Session';
import type { Player } from '~/Player';
import type { Car } from '~/cars/Car';
import type { ControlsState } from '~/types';
import type { CarRenderState, CarStatsSnapshot, RenderSnapshot } from './RenderSnapshot';
import type { Renderer } from './Renderer';
import { fromKmhToPixels } from '~/helper';
import { RAY_ANGLE_OFFSETS } from './rays';

const RAY_LENGTH = 1000;

// Events the engine publishes each frame or on notable moments. Views/HUDs
// subscribe via `engine.on('...', handler)` to receive typed payloads.
export type GameEngineEvents = {
    stats: { playerId: string; stats: CarStatsSnapshot };
    lapCompleted: { playerId: string; lapTime: number };
    stageCompleted: { playerId: string };
    sessionCompleted: {
        playerId: string;
        stageTimes: { stageTime: number; lapTimes: number[] }[];
        totalTime: number;
    };
    collision: { playerId: string };
    actorRemoved: { playerId: string };
};

type GameMode = 'player' | 'ai';

// Runs the physics tick, collision detection, ray casting (physics only),
// and checkpoint tracking for one or more actors (Players) against a Session's
// current stage. Emits typed events for HUDs and views to consume. Delegates
// all painting to the Renderer via a snapshot each frame.
export class GameEngine extends BaseEngine<GameEngineEvents> {
    private zoom = 1;
    private showBoundingBox = false;
    private fps = 0;
    private resetRequested = false;
    private sessionFinished = false;
    private trackedPlayerId: string | null = null;
    private cameraFocusOverride: { x: number; y: number } | null = null;
    // Paused players are skipped by physics and emit no stats. Instead of
    // hiding them, we teleport each one to a numbered parking slot on the
    // right edge of the track at pause time — the Map value is the slot
    // (0-based = finish order). Multiplayer uses this to park finishers in
    // their finish order until all players have cleared the current stage.
    private pausedPlayers = new Map<string, number>();

    public constructor(
        private readonly session: Session,
        private readonly players: Map<string, Player>,
        private readonly renderer: Renderer,
        private readonly getControlsFor: (playerId: string) => ControlsState,
        private readonly gameMode: GameMode,
    ) {
        super();
    }

    public setZoom(z: number): void { this.zoom = z; }
    public setShowBoundingBox(b: boolean): void { this.showBoundingBox = b; }
    public requestReset(): void { this.resetRequested = true; }
    public isSessionFinished(): boolean { return this.sessionFinished; }

    // Which player the camera follows and HUDs scope to. Views (RacingView)
    // call this at mount with their trackedPlayerId; multi-player views can
    // call it again when the operator switches the actor-picker.
    public setTrackedPlayerId(playerId: string): void { this.trackedPlayerId = playerId; }

    // Override the camera focus (e.g. overview mode for multiplayer host).
    // Pass null to go back to "follow trackedPlayerId".
    public setCameraFocus(focus: { x: number; y: number } | null): void {
        this.cameraFocusOverride = focus;
    }

    // Per-player state getters for views/HUDs that need to query the engine
    // outside the frame loop (e.g., AiView.buildGameState).
    public getPlayer(playerId: string): Player | undefined { return this.players.get(playerId); }

    // Pause a player: assign the next free parking slot (= finish order,
    // 0-based), zero speed, and teleport the car into a numbered column on
    // the right edge of the current track. The slot stays stable until the
    // player resumes (via advanceStage) or is removed. `advanceStage` and
    // `removeActor` auto-release the slot.
    public pausePlayer(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        if (this.pausedPlayers.has(playerId)) return;

        const slot = this.pausedPlayers.size;
        this.pausedPlayers.set(playerId, slot);

        // Column in the top-right corner of the track's bounds.
        const { minY, maxX } = this.session.stage().track.bounds;
        const footprint = Math.max(player.car.lengthPx, player.car.widthPx);
        const padding = 6;
        const spacing = 4;
        player.car.speed = 0;
        player.car.hasCollision = false;
        player.car.x = maxX - footprint - padding;
        player.car.y = minY + padding + slot * (footprint + spacing);
        player.car.angle = 0;
    }

    public resumePlayer(playerId: string): void {
        this.pausedPlayers.delete(playerId);
    }

    public isPlayerPaused(playerId: string): boolean {
        return this.pausedPlayers.has(playerId);
    }

    // Called from AI mode's WS `nextStage` event, and internally on lap completion
    // for single-player. Advancing a player auto-resumes them — the pause-until-
    // all-done flow in multiplayer uses this to re-arm every player at once.
    public advanceStage(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        player.nextStage();
        this.session.currentStage = player.currentStageId;
        player.car.track = this.session.stage().track;
        player.car.reset();
        this.pausedPlayers.delete(playerId);
    }

    // Called from AI mode's WS `startStage` event.
    public startStage(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        player.resetStage();
    }

    // Remove an actor from the engine (e.g., when the controlling AI drops).
    // Views listen on 'actorRemoved' to clean up their HUDs / tracked player.
    public removeActor(playerId: string): void {
        if (!this.players.has(playerId)) return;
        this.players.delete(playerId);
        this.pausedPlayers.delete(playerId);
        this.emit('actorRemoved', { playerId });
    }

    protected tick(deltaTimeSeconds: number): void {
        if (this.sessionFinished) return;
        if (this.players.size === 0) return;

        // Session completion — ALL players must have completed all stages.
        if (this.session.isCompleted(this.players)) {
            this.sessionFinished = true;
            // Session-summary payload is scoped to the first player today.
            // Per-player summaries land with the multi-player HUDs.
            const firstPlayer = [...this.players.values()][0];
            const stageTimes = [...firstPlayer.stages.values()].map(s => ({
                stageTime: s.lapTimes.reduce((sum: number, t: number) => sum + t, 0),
                lapTimes: s.lapTimes,
            }));
            const totalTime = stageTimes.reduce((sum: number, s) => sum + s.stageTime, 0);
            this.emit('sessionCompleted', { playerId: firstPlayer.id, stageTimes, totalTime });
            return;
        }

        // FPS (global)
        if (deltaTimeSeconds > 0) {
            this.fps = Math.round(1 / deltaTimeSeconds);
        }

        // Reset request applies to all actors this tick (consume the flag once).
        const resetThisTick = this.resetRequested;
        this.resetRequested = false;

        // Per-actor physics + checkpoint progression. Paused players (e.g.
        // multiplayer finishers waiting for others) are skipped entirely.
        for (const player of this.players.values()) {
            if (this.pausedPlayers.has(player.id)) continue;
            this.tickPlayer(player, deltaTimeSeconds, resetThisTick);
        }

        // Render once after all actors ticked.
        this.renderer.draw(this.buildSnapshot());

        // Stats event per player — HUD subscribers filter by playerId.
        // Skip paused players so their HUDs stop updating while they wait.
        for (const player of this.players.values()) {
            if (this.pausedPlayers.has(player.id)) continue;
            const stageTime = player.stage().stageTime;
            this.emit('stats', {
                playerId: player.id,
                stats: {
                    speed: player.car.speed,
                    angle: player.car.angle,
                    x: player.car.x,
                    y: player.car.y,
                    hasCollision: player.car.hasCollision,
                    lapTime: player.lapTime(),
                    stageTime,
                    currentCheckpoint: player.stage().currentCheckpoint,
                    totalCheckpoints: this.session.stage().track.checkpoints.length,
                    completedLaps: player.stage().lapsCompleted,
                },
            });
        }
    }

    private tickPlayer(player: Player, deltaTimeSeconds: number, reset: boolean): void {
        if (reset) {
            player.resetLap();
            return; // skip physics for the reset tick
        }

        // Controls
        const controls = this.getControlsFor(player.id);
        player.car.controls = controls;
        player.car.applyControls(deltaTimeSeconds);

        // Physics: move
        const newX = player.car.x + Math.cos((player.car.angle * Math.PI) / 180)
            * fromKmhToPixels(player.car.speed) * deltaTimeSeconds;
        const newY = player.car.y + Math.sin((player.car.angle * Math.PI) / 180)
            * fromKmhToPixels(player.car.speed) * deltaTimeSeconds;

        const wasColliding = player.car.hasCollision;
        player.car.hasCollision = this.checkCarCollision(player.car, player.car.x, player.car.y);
        if (!player.car.hasCollision) {
            player.car.x = newX;
            player.car.y = newY;
        }
        if (player.car.hasCollision && !wasColliding) {
            this.emit('collision', { playerId: player.id });
        }

        // Rays: distance from the car's center to the track edge (outline).
        const centerX = player.car.x + player.car.widthPx / 2;
        const centerY = player.car.y + player.car.lengthPx / 2;
        const track = this.session.stage().track;
        player.car.rays = RAY_ANGLE_OFFSETS.map(offset => {
            const d = track.castRay(centerX, centerY, player.car.angle + offset, RAY_LENGTH);
            return Math.round(d * 100) / 100;
        });

        // Player lap-time bucket (Player expects ms).
        player.addLapTime(deltaTimeSeconds * 1000);

        // Checkpoint progression (may fire lapCompleted / stageCompleted events).
        this.checkCheckpointPass(player);
    }

    private buildSnapshot(): RenderSnapshot {
        const cars: CarRenderState[] = [];
        for (const p of this.players.values()) {
            const c = p.car;
            // Paused players are parked on the right edge; their slot (0-based
            // = finish order) travels through so the renderer can label them.
            const parkedSlot = this.pausedPlayers.get(p.id);
            cars.push({
                id: p.id,
                x: c.x, y: c.y, angle: c.angle,
                lengthPx: c.lengthPx, widthPx: c.widthPx,
                hasCollision: c.hasCollision,
                rays: [...c.rays],
                color: p.color,
                parkedSlot,
            });
        }

        // Camera: explicit override (e.g. overview mode) wins; otherwise
        // follow trackedPlayerId; otherwise first actor.
        let focusX: number;
        let focusY: number;
        if (this.cameraFocusOverride) {
            focusX = this.cameraFocusOverride.x;
            focusY = this.cameraFocusOverride.y;
        } else {
            const focusPlayer = (this.trackedPlayerId && this.players.get(this.trackedPlayerId))
                || [...this.players.values()][0];
            focusX = focusPlayer ? focusPlayer.car.x + focusPlayer.car.widthPx / 2 : 0;
            focusY = focusPlayer ? focusPlayer.car.y + focusPlayer.car.lengthPx / 2 : 0;
        }

        return {
            track: this.session.stage().track,
            cars,
            selfId: this.trackedPlayerId || cars[0]?.id,
            camera: { zoom: this.zoom, focusX, focusY },
            showBoundingBox: this.showBoundingBox,
            fps: this.fps,
        };
    }

    // Colliding = any corner of the car's rectangle is off the track, or any
    // of its sides crosses the track edge (catches a sharp inner corner of
    // the outline poking into the side of the car between two corners).
    private checkCarCollision(car: Car, x: number, y: number): boolean {
        const halfWidth = car.widthPx / 2;
        const halfLength = car.lengthPx / 2;
        const rad = (car.angle * Math.PI) / 180;

        const centerX = x + halfWidth;
        const centerY = y + halfLength;

        // In order around the rectangle, so consecutive corners form its sides.
        const corners = [
            { x: -halfLength, y: -halfWidth },
            { x:  halfLength, y: -halfWidth },
            { x:  halfLength, y:  halfWidth },
            { x: -halfLength, y:  halfWidth },
        ].map(corner => ({
            x: centerX + corner.x * Math.cos(rad) - corner.y * Math.sin(rad),
            y: centerY + corner.x * Math.sin(rad) + corner.y * Math.cos(rad),
        }));

        const track = this.session.stage().track;
        if (corners.some(c => track.isPointColliding(c.x, c.y))) return true;
        return corners.some((a, i) => {
            const b = corners[(i + 1) % corners.length];
            return track.segmentCrossesEdge(a.x, a.y, b.x, b.y);
        });
    }

    private checkCheckpointPass(player: Player): void {
        const track = this.session.stage().track;
        let checkpointIndex = player.stage().currentCheckpoint;
        const allCheckpointsPassed = player.stage().passedCheckpoints.every((p: boolean) => p);

        // Loop tracks wrap back to checkpoint[0] after all are passed.
        // One-way tracks: no wrap — once all are passed, there's nothing left
        // to check (stage ended on the last-checkpoint pass).
        if (track.isLoop && allCheckpointsPassed) checkpointIndex = 0;
        if (!track.isLoop && allCheckpointsPassed) return;

        const checkpoint = track.checkpoints[checkpointIndex];
        if (!checkpoint) return;

        const carFrontX = player.car.x + player.car.widthPx / 2
            + Math.cos((player.car.angle * Math.PI) / 180) * (player.car.lengthPx / 2);
        const carFrontY = player.car.y + player.car.lengthPx / 2
            + Math.sin((player.car.angle * Math.PI) / 180) * (player.car.lengthPx / 2);

        if (!this.isPointBetween(carFrontX, carFrontY,
            checkpoint.start.x, checkpoint.start.y,
            checkpoint.end.x, checkpoint.end.y)) return;

        if (track.isLoop) {
            // Loop: all passed + crossed [0] again = lap complete.
            if (allCheckpointsPassed && checkpointIndex === 0) {
                const lapTime = player.lapTime();
                player.completedLap();
                this.emit('lapCompleted', { playerId: player.id, lapTime });

                if (player.isStageCompleted(player.stage())) {
                    this.emit('stageCompleted', { playerId: player.id });
                    if (this.gameMode === 'player') {
                        this.advanceStage(player.id);
                    }
                }
            } else {
                player.passedCheckpoint(checkpointIndex);
            }
            return;
        }

        // One-way: mark the checkpoint passed. If it's the last one, the stage
        // is over (regardless of stageLaps) — force completion.
        player.passedCheckpoint(checkpointIndex);
        const isLastCheckpoint = checkpointIndex === track.checkpoints.length - 1;
        if (!isLastCheckpoint) return;

        // One-way tracks are single-run by design: this run completes the
        // stage regardless of the configured stageLaps.
        const lapTime = player.lapTime();
        player.completedLap(true);
        this.emit('lapCompleted', { playerId: player.id, lapTime });

        this.emit('stageCompleted', { playerId: player.id });
        if (this.gameMode === 'player') {
            this.advanceStage(player.id);
        }
    }

    private isPointBetween(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
        const d1 = Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        const d2 = Math.sqrt((px - x2) ** 2 + (py - y2) ** 2);
        const lineLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const tolerance = 5;
        return Math.abs(d1 + d2 - lineLength) <= tolerance;
    }
}
