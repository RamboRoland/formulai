import { RacingView } from './RacingView';
import type { Session } from '~/sessions/Session';
import type { Player } from '~/Player';
import type { GameMode, ControlsState } from '~/types';
import type { ControlsInstance } from '~/components/controls/createControls';
import { GameEngine, MAX_CATCH_UP_STEPS, STEP_SECONDS } from '~/engine/GameEngine';
import { FrameLoop } from '~/engine/FrameLoop';
import { Camera } from '~/engine/Camera';
import type { RenderSnapshot } from '~/engine/RenderSnapshot';
import { drawTrackFrom } from '~/engine/drawTrackFrom';

const DEFAULT_CONTROLS: ControlsState = {
    forward: false,
    backward: false,
    steering: 0,
    brake: false,
    restart: false,
};

// TRANSITION ONLY (removed in phase 3e): a racing view whose race runs in
// the browser — its own GameEngine, stepped in fixed steps every browser
// frame (AI mode + the multiplayer host, until the server runs those).
//
// Concrete subclasses fill in:
//   - createPlayers()          — who's racing
//   - createControlsInstance() — where input comes from
//   - wireHud()                — which HUDs to mount + how to subscribe them
export abstract class LocalRacingView extends RacingView {
    protected engine: GameEngine | null = null;
    private loop: FrameLoop | null = null;
    protected controls: ControlsInstance | null = null;
    protected players: Map<string, Player> = new Map();
    protected trackedPlayerId = '';
    // Which car is followed (the leader), glide, zoom — drawing only.
    protected camera = new Camera();
    private fps = 0;
    // Fixed step: frame time not yet stepped, time since the last drawn
    // frame (for the FPS counter) and the frame to draw (null = no step ran).
    private stepAccumulator = 0;
    private sinceDraw = 0;
    private pendingFrame: Omit<RenderSnapshot, 'showBoundingBox'> | null = null;

    public constructor(
        protected readonly session: Session,
        protected readonly gameMode: GameMode,
    ) {
        super();
    }

    // The player the HUD shows: the car the camera follows (multiplayer:
    // the leader), else the tracked player.
    protected hudPlayerId(): string {
        return this.camera.getTargetId() ?? this.trackedPlayerId;
    }

    // Tracks are in-memory vector data, so there's nothing to load.
    public override mount(root: HTMLElement): void {
        if (this.session.stages.length === 0) {
            this.root = root;
            this.showError(`Session "${this.session.displayName}" has no raceable tracks. Check the console for which tracks are missing or have no outline.`);
            return;
        }
        super.mount(root);
    }

    public override unmount(): void {
        this.controls?.destroy();
        super.unmount();
        this.engine = null;
        this.controls = null;
        this.players = new Map();
    }

    protected abstract createPlayers(): Map<string, Player>;
    protected abstract createControlsInstance(): ControlsInstance;

    protected prepare(): void {
        this.players = this.createPlayers();
        this.trackedPlayerId = [...this.players.keys()][0] ?? '';
        this.controls = this.createControlsInstance();
        this.engine = new GameEngine(
            this.session,
            this.players,
            (playerId: string) => this.controls?.getControlsFor(playerId) ?? DEFAULT_CONTROLS,
            this.gameMode,
        );
        this.camera = new Camera();
        this.camera.setZoom(this.zoom);
        this.camera.setTrackedPlayerId(this.trackedPlayerId);
        // The camera follows right after each step's physics (before
        // 'stats', so the HUD already sees this step's camera target).
        this.unsubs.push(this.engine.on('stepped', ({ deltaTimeSeconds }) => this.prepareFrame(deltaTimeSeconds)));
    }

    protected override wireDefaults(): void {
        super.wireDefaults();
        if (!this.engine) return;
        // Pressed-button UI + wheel reflect the car the camera follows.
        this.unsubs.push(this.engine.on('stats', () => {
            const playerId = this.hudPlayerId();
            const c = this.controls?.getControlsFor(playerId);
            if (!c) return;
            this.setIndicators(c, this.players.get(playerId)?.car.steeringAngle ?? null);
        }));
        this.unsubs.push(this.engine.on('sessionCompleted', (data) => {
            this.showSessionComplete(data.stageTimes, data.totalTime);
        }));
    }

    protected start(): void {
        this.stepAccumulator = 0;
        this.loop = new FrameLoop(dt => this.onFrame(dt));
        this.loop.start();
    }

    protected stop(): void {
        this.loop?.stop();
    }

    protected onReset(): void {
        this.engine?.requestReset();
    }

    protected override onZoom(zoom: number): void {
        this.camera.setZoom(zoom);
    }

    // One browser frame: run as many fixed steps as the elapsed time holds
    // (the rest waits for the next frame), then draw once if any step ran.
    // A 120 Hz screen draws every other frame (60 Hz motion).
    private onFrame(deltaTimeSeconds: number): void {
        if (!this.engine || !this.renderer) return;
        this.sinceDraw += deltaTimeSeconds;
        this.stepAccumulator = Math.min(this.stepAccumulator + deltaTimeSeconds, STEP_SECONDS * MAX_CATCH_UP_STEPS);
        while (this.stepAccumulator >= STEP_SECONDS) {
            this.stepAccumulator -= STEP_SECONDS;
            this.engine.step(STEP_SECONDS);
        }
        if (!this.pendingFrame) return;
        if (this.sinceDraw > 0) this.fps = Math.round(1 / this.sinceDraw);
        this.sinceDraw = 0;
        this.present({ ...this.pendingFrame, fps: this.fps });
        this.pendingFrame = null;
    }

    // After each step: the camera follows the leader, and the frame to draw
    // (the cars the engine has on the track) is kept for onFrame.
    private prepareFrame(deltaTimeSeconds: number): void {
        if (!this.engine) return;
        const cars = this.engine.renderCars();
        const camera = this.camera.update(this.players, deltaTimeSeconds);
        this.pendingFrame = {
            track: drawTrackFrom(this.session.stage().track),
            cars,
            selfId: this.camera.getTargetId() ?? cars[0]?.id,
            camera,
            fps: this.fps,
        };
    }
}
