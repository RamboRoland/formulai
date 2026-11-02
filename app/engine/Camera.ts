import type { Player } from '~/Player';
import type { CameraState } from './RenderSnapshot';

// Camera follows the race leader; a lead change glides over this long, and
// the camera stays on a car at least CAMERA_HOLD_SECONDS before the next.
const CAMERA_SWITCH_SECONDS = 0.5;
const CAMERA_HOLD_SECONDS = 1;

// The view's camera: which car it follows (the race leader), the glide on a
// lead change, the zoom and an optional fixed focus. Drawing only — the game
// engine knows nothing about it.
export class Camera {
    private zoom = 1;
    private trackedPlayerId: string | null = null;
    private focusOverride: { x: number; y: number } | null = null;
    // Leader-follow camera: whose car it's on, last frame's focus, and the
    // focus a lead change glides from (null = settled).
    private targetId: string | null = null;
    private focus = { x: 0, y: 0 };
    private switchFrom: { x: number; y: number } | null = null;
    private switchElapsed = 0;
    private heldSeconds = 0;

    public setZoom(z: number): void { this.zoom = z; }

    // Who the camera falls back to when no car is on the track (default:
    // the first player). Views set it at mount; multi-player views again
    // when that player leaves.
    public setTrackedPlayerId(playerId: string): void { this.trackedPlayerId = playerId; }

    // The player the camera follows now (null before the first frame).
    public getTargetId(): string | null { return this.targetId; }

    // Override the camera focus (e.g. overview mode for multiplayer host).
    // Pass null to go back to following the leader.
    public setFocusOverride(focus: { x: number; y: number } | null): void {
        this.focusOverride = focus;
    }

    // One frame: follow the leader (trackedPlayerId, then the first actor,
    // when no car is on the track), but stay on a car still on the track
    // for CAMERA_HOLD_SECONDS after a switch. A new target → glide from the
    // last focus to it, smoothstep-eased. An explicit override wins.
    public update(players: Map<string, Player>, deltaTimeSeconds: number): CameraState {
        this.heldSeconds += deltaTimeSeconds;
        this.switchElapsed += deltaTimeSeconds;
        const current = this.targetId ? players.get(this.targetId) : undefined;
        const holding = current && !current.isStageCompleted(current.stage()) && this.heldSeconds < CAMERA_HOLD_SECONDS;
        const target = (holding ? current : this.leader(players))
            ?? ((this.trackedPlayerId && players.get(this.trackedPlayerId)) || [...players.values()][0]);
        if ((target?.id ?? null) !== this.targetId) {
            if (this.targetId !== null) {
                this.switchFrom = { ...this.focus };
                this.switchElapsed = 0;
            }
            this.targetId = target?.id ?? null;
            this.heldSeconds = 0;
        }
        let focusX = target ? target.car.x + target.car.widthPx / 2 : 0;
        let focusY = target ? target.car.y + target.car.lengthPx / 2 : 0;
        let transition = 1;
        if (this.switchFrom) {
            const t = Math.min(1, this.switchElapsed / CAMERA_SWITCH_SECONDS);
            transition = t * t * (3 - 2 * t);
            focusX = this.switchFrom.x + (focusX - this.switchFrom.x) * transition;
            focusY = this.switchFrom.y + (focusY - this.switchFrom.y) * transition;
            if (t >= 1) this.switchFrom = null;
        }
        this.focus = { x: focusX, y: focusY };
        if (this.focusOverride) {
            focusX = this.focusOverride.x;
            focusY = this.focusOverride.y;
        }
        return { zoom: this.zoom, focusX, focusY, transition };
    }

    // Furthest along on the track: later stage first, then completedMeters.
    // Ties keep the current camera target so the camera doesn't flicker.
    private leader(players: Map<string, Player>): Player | undefined {
        const onTrack = (p: Player | undefined) => p && !p.isStageCompleted(p.stage()) ? p : undefined;
        let leader = onTrack(this.targetId ? players.get(this.targetId) : undefined);
        for (const p of players.values()) {
            if (!onTrack(p)) continue;
            if (!leader || p.currentStageId > leader.currentStageId
                || (p.currentStageId === leader.currentStageId && p.stage().completedMeters > leader.stage().completedMeters)) {
                leader = p;
            }
        }
        return leader;
    }
}
