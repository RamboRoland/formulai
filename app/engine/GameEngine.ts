import { BaseEngine } from './BaseEngine';
import type { Session } from '~/sessions/Session';
import type { Player } from '~/Player';
import type { Car } from '~/cars/Car';
import type { ControlsState } from '~/types';
import type { CarRenderState, CarStatsSnapshot, RenderSnapshot } from './RenderSnapshot';
import type { Renderer } from './Renderer';
import { fromKmhToPixels, fromMetersToPixels, fromPixelsToMeters } from '~/helper';
import { RAY_ANGLE_OFFSETS, RAY_ORIGINS } from './rays';
import { carPoint } from './carBody';

const RAY_LENGTH = 1000;
// completedMeters: how far ahead of its best point a car is looked for on
// the route leg each tick (far more than a car moves in one frame).
const METERS_WINDOW_PX = fromMetersToPixels(10);
// completedMeters: how much of the previous leg's end is still searched just
// after a checkpoint (its line counts the car's front, with a tolerance, so
// the centre can be ~2 m before it).
const METERS_LOOKBACK_PX = fromMetersToPixels(5);
// car.heading / car.facing: the track's direction at the car is taken from
// the nearest route point to the point this far ahead along the route.
const DIRECTION_SPAN_PX = fromMetersToPixels(1);

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
    // A restart is applied and the next tick has run (start position, 0
    // counters, real rays) — game state is ready to fetch.
    restarted: Record<string, never>;
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
    // Set on the reset tick (physics skipped, rays 0); 'restarted' is emitted
    // at the end of the next tick, once the rays are real.
    private restartPending = false;
    private sessionFinished = false;
    private trackedPlayerId: string | null = null;
    private cameraFocusOverride: { x: number; y: number } | null = null;

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

    // Move one player to the next stage and respawn the car at its start line.
    // Used by nextStage (every player) and by single-player on a finish.
    public advanceStage(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        player.nextStage();
        this.session.currentStage = player.currentStageId;
        player.car.track = this.session.stage().track;
        player.car.reset();
    }

    // WS nextStage (AI mode / multiplayer): the client decides when to move
    // on, and whether the stage was completed or skipped. Moves EVERY player
    // to the next stage (one shared layout). Last stage: only the flag is
    // stored — tick ends the session once every stage is completed.
    public nextStage(completed: boolean): void {
        this.session.stageCompleted[this.session.currentStage] = completed;
        if (this.session.currentStage >= this.session.stages.length - 1) return;
        for (const playerId of this.players.keys()) this.advanceStage(playerId);
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
        this.emit('actorRemoved', { playerId });
    }

    // Multiplayer rejoin: the session starts over with a new set of players
    // (the view resets the Session and builds them on stage 1 first).
    public restartSession(players: Player[]): void {
        this.players.clear();
        for (const p of players) this.players.set(p.id, p);
        this.resetRequested = false;
        this.restartPending = false;
    }

    protected tick(deltaTimeSeconds: number): void {
        if (this.sessionFinished) return;
        if (this.players.size === 0) return;

        // Session completion — every stage completed (Session.stageCompleted).
        if (this.session.isCompleted()) {
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

        // Per-actor physics + checkpoint progression.
        for (const player of this.players.values()) {
            this.tickPlayer(player, deltaTimeSeconds, resetThisTick);
        }

        // Render once after all actors ticked.
        this.renderer.draw(this.buildSnapshot());

        // Stats event per player — HUD subscribers filter by playerId.
        for (const player of this.players.values()) {
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

        // Restart: wait one real tick after the reset tick, then announce it.
        if (resetThisTick) {
            this.restartPending = true;
        } else if (this.restartPending) {
            this.restartPending = false;
            this.emit('restarted', {});
        }
    }

    private tickPlayer(player: Player, deltaTimeSeconds: number, reset: boolean): void {
        if (reset) {
            player.resetLap();
            return; // skip physics for the reset tick
        }

        // Stage completed: the car is off the track (not drawn, see
        // buildSnapshot) and frozen until restart or nextStage respawns it.
        // No controls, physics, rays or checkpoints — every value (speed
        // included) keeps what it was at the finish.
        if (player.isStageCompleted(player.stage())) return;

        // Controls
        const controls = this.getControlsFor(player.id);
        player.car.controls = controls;
        player.car.applyControls(deltaTimeSeconds);

        // Physics: move
        const newX = player.car.x + Math.cos((player.car.angle * Math.PI) / 180)
            * fromKmhToPixels(player.car.speed) * deltaTimeSeconds;
        const newY = player.car.y + Math.sin((player.car.angle * Math.PI) / 180)
            * fromKmhToPixels(player.car.speed) * deltaTimeSeconds;

        // A car that collides where it stands doesn't move (it can still
        // steer free). hasCollision is then checked where the car is after
        // the move — the same position x / y, corners and rays describe.
        const blocked = this.checkCarCollision(player.car, player.car.x, player.car.y);
        if (!blocked) {
            player.car.x = newX;
            player.car.y = newY;
        }
        const wasColliding = player.car.hasCollision;
        player.car.hasCollision = blocked || this.checkCarCollision(player.car, player.car.x, player.car.y);
        if (player.car.hasCollision && !wasColliding) {
            this.emit('collision', { playerId: player.id });
        }

        // Rays: distance from the car's body (a corner or an edge middle,
        // RAY_ORIGINS) to the track edge (outline) or a tyre wall.
        const track = this.session.stage().track;
        player.car.rays = RAY_ANGLE_OFFSETS.map((offset, i) => {
            const [fx, fy] = RAY_ORIGINS[i];
            const origin = carPoint(player.car, fx, fy);
            const d = track.castRay(origin.x, origin.y, player.car.angle + offset, RAY_LENGTH);
            return Math.round(d * 100) / 100;
        });

        // Player lap-time bucket (Player expects ms).
        player.addLapTime(deltaTimeSeconds * 1000);

        // Checkpoint progression (may fire lapCompleted / stageCompleted events).
        this.checkCheckpointPass(player);

        this.updateCompletedMeters(player);

        this.updateDirection(player, blocked);
    }

    // car.heading / car.facing: the car's angle against the track's direction
    // where the car is now, on the centreline route (as completedMeters).
    // Leg = currentCheckpoint - 1; leg 0 before the start line, where the
    // projection clamps to its first point = the start direction. The nearest
    // point is searched 10 m back and ahead of the last one (the car may
    // reverse). Finish tick (one-way: no leg left) → the last values stay.
    private updateDirection(player: Player, blocked: boolean): void {
        const track = this.session.stage().track;
        const route = track.route;
        if (!route) return;
        const stage = player.stage();
        const car = player.car;

        const leg = Math.max(0, stage.currentCheckpoint - 1);
        const points = route.legs[leg]?.points;
        const arcs = track.routeArcs[leg];
        if (!points || !arcs || points.length < 2) return;
        if (stage.nearLeg !== leg) {
            stage.nearLeg = leg;
            stage.nearSample = 0;
        }

        const cx = car.x + car.widthPx / 2;
        const cy = car.y + car.lengthPx / 2;
        const at = stage.nearSample;
        let from = at;
        while (from > 0 && arcs[at] - arcs[from - 1] <= METERS_WINDOW_PX) from--;
        let bestDist = Infinity, bestArc = 0, bestSeg = at;
        for (let i = from; i < points.length - 1 && arcs[i] - arcs[at] <= METERS_WINDOW_PX; i++) {
            const a = points[i], b = points[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-12) continue;
            const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / len2));
            const d = Math.hypot(cx - (a.x + dx * t), cy - (a.y + dy * t));
            if (d < bestDist) {
                bestDist = d;
                bestArc = arcs[i] + Math.sqrt(len2) * t;
                bestSeg = i;
            }
        }
        if (bestDist === Infinity) return;
        stage.nearSample = bestSeg;

        // Track direction: nearest point → 1 m further on (the leg's last 1 m
        // at its end).
        const legEnd = arcs[arcs.length - 1];
        const s0 = Math.max(0, Math.min(bestArc, legEnd - DIRECTION_SPAN_PX));
        const p = pointAtArc(points, arcs, s0, bestSeg);
        const q = pointAtArc(points, arcs, Math.min(legEnd, s0 + DIRECTION_SPAN_PX), bestSeg);
        const trackAngle = Math.atan2(q.y - p.y, q.x - p.x);
        const c = Math.cos((car.angle * Math.PI) / 180 - trackAngle);

        car.facing = c > 0;
        // Direction of travel: 1 = the correct way, -1 = the wrong way, 0 =
        // standing still or blocked. Reversing moves opposite to the nose.
        // `|| 0` turns -0 into 0.
        car.heading = blocked ? 0 : ((Math.sign(c) * Math.sign(car.speed)) || 0) as -1 | 0 | 1;
    }

    // completedMeters: distance this stage from the spawn, from the car's
    // centre: the lead-in to the start line (Track.leadIn, lap 1 only), then
    // along the centreline route. Can't be farmed:
    //  - only the current leg (currentCheckpoint - 1) counts, clamped at its
    //    end until the next checkpoint line is crossed
    //  - only the next METERS_WINDOW_PX of the leg ahead of the best point is
    //    searched (no jump to a parallel bit of track)
    //  - it only goes up (reversing / driving a bit twice adds nothing)
    // Just after a checkpoint the end of the previous leg is searched too, so
    // the value keeps following the centre up to the line (no jump + pause).
    // Stage completed → the full distance; after that tickPlayer stops here.
    private updateCompletedMeters(player: Player): void {
        const track = this.session.stage().track;
        const route = track.route;
        if (!route) return;
        const stage = player.stage();
        const leadIn = track.leadIn(player.car.lengthPx);

        if (player.isStageCompleted(stage)) {
            stage.completedMeters = fromPixelsToMeters(leadIn + (track.isLoop ? stage.laps * route.length : route.length));
            return;
        }

        const cx = player.car.x + player.car.widthPx / 2;
        const cy = player.car.y + player.car.lengthPx / 2;
        // Lead-in (lap 1 only): the centre is still behind the start line.
        // Counts how far it has come from the spawn along the start
        // direction, 0..leadIn. Skipped once past it, so a later bit of track
        // behind the start line's (infinite) line can't hold the value.
        if (stage.lapsCompleted === 0 && stage.currentCheckpoint <= 1
            && stage.completedMeters < fromPixelsToMeters(leadIn)) {
            const rad = (track.startAngle * Math.PI) / 180;
            const s = (cx - track.startPosition.x) * Math.cos(rad) + (cy - track.startPosition.y) * Math.sin(rad);
            if (s < 0) {
                const meters = fromPixelsToMeters(Math.max(0, leadIn + s));
                if (meters > stage.completedMeters) stage.completedMeters = meters;
                return;
            }
        }
        // Not over the start line yet.
        if (stage.currentCheckpoint === 0) return;

        const leg = stage.currentCheckpoint - 1;
        const points = route.legs[leg]?.points;
        const arcs = track.routeArcs[leg];
        if (!points || !arcs) return;
        if (stage.routeLeg !== leg) {
            stage.routeLeg = leg;
            stage.routeSample = 0;
        }

        const from = stage.routeSample;
        const best = nearestOnLeg(points, arcs, cx, cy, from, arcs[from] + METERS_WINDOW_PX);
        if (best.dist === Infinity) return;
        let meters = fromPixelsToMeters(leadIn + stage.lapsCompleted * route.length + track.routeLegStarts[leg] + best.arc);
        let onLeg = true;

        // Not moved on along the new leg yet: the centre may still be before
        // the line just crossed. Then the previous leg's end (a loop's new
        // lap: the last leg of the lap before) is where it really is. Lap 1's
        // leg 0 has the lead-in instead.
        const prevLeg = leg > 0 ? leg - 1 : (track.isLoop && stage.lapsCompleted > 0 ? route.legs.length - 1 : -1);
        if (from === 0 && prevLeg >= 0) {
            const prevPoints = route.legs[prevLeg].points;
            const prevArcs = track.routeArcs[prevLeg];
            const end = prevArcs[prevArcs.length - 1];
            let start = prevArcs.length - 1;
            while (start > 0 && prevArcs[start - 1] >= end - METERS_LOOKBACK_PX) start--;
            const tail = nearestOnLeg(prevPoints, prevArcs, cx, cy, start, end);
            if (tail.dist < best.dist) {
                const laps = leg > 0 ? stage.lapsCompleted : stage.lapsCompleted - 1;
                meters = fromPixelsToMeters(leadIn + laps * route.length + track.routeLegStarts[prevLeg] + tail.arc);
                onLeg = false;
            }
        }

        if (meters > stage.completedMeters) {
            stage.completedMeters = meters;
            if (onLeg) stage.routeSample = best.seg;
        }
    }

    private buildSnapshot(): RenderSnapshot {
        const cars: CarRenderState[] = [];
        for (const p of this.players.values()) {
            // Finished the stage → removed from the track until it respawns.
            if (p.isStageCompleted(p.stage())) continue;
            const c = p.car;
            cars.push({
                id: p.id,
                x: c.x, y: c.y, angle: c.angle,
                lengthPx: c.lengthPx, widthPx: c.widthPx,
                hasCollision: c.hasCollision,
                rays: [...c.rays],
                color: p.color,
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
                        this.session.stageCompleted[this.session.currentStage] = true;
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
            this.session.stageCompleted[this.session.currentStage] = true;
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

// Point `s` px along a polyline (arcs[i] = distance from its start to
// points[i]), searched from segment `hint` (walks back or ahead from there).
function pointAtArc(points: { x: number; y: number }[], arcs: number[], s: number, hint: number): { x: number; y: number } {
    let i = Math.max(0, Math.min(hint, points.length - 2));
    while (i > 0 && arcs[i] > s) i--;
    while (i < points.length - 2 && arcs[i + 1] < s) i++;
    const a = points[i], b = points[i + 1];
    const len = arcs[i + 1] - arcs[i];
    const t = len > 0 ? Math.max(0, Math.min(1, (s - arcs[i]) / len)) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Nearest point to (cx, cy) on a route leg, searching the segments from
// sample `from` while their start is within `maxArc` (px along the leg).
// Returns its distance, arc length along the leg and segment index.
function nearestOnLeg(points: { x: number; y: number }[], arcs: number[], cx: number, cy: number, from: number, maxArc: number): { dist: number; arc: number; seg: number } {
    let dist = Infinity, arc = 0, seg = from;
    for (let i = from; i < points.length - 1 && arcs[i] <= maxArc; i++) {
        const a = points[i], b = points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / len2));
        const d = Math.hypot(cx - (a.x + dx * t), cy - (a.y + dy * t));
        if (d < dist) {
            dist = d;
            arc = arcs[i] + Math.sqrt(len2) * t;
            seg = i;
        }
    }
    return { dist, arc, seg };
}
