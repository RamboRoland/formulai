import { RacingView, type PressedControls } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { FormulaiClient } from '~/services/formulaiClient';
import { FrameLoop } from '~/engine/FrameLoop';
import { DrawTrack } from '~/engine/DrawTrack';
import type { DataOf } from '~/protocol';
import { config } from '~/config';

export type Frame = DataOf<'evt:view', 'frame'>;

// A racing view whose race runs on the game server: it watches a lobby
// (evt:view/track + evt:view/frame) and draws the newest frame each browser
// frame. The camera is on the followed car; the HUD and steering wheel are
// that car's.
//
// Concrete subclasses fill in:
//   - begin()           — what to do once connected (join, watch …)
//   - pressedControls() — which control-panel buttons to show pressed
//   - beforeFrame()     — per browser frame work (e.g. send the keys)
export abstract class ServerRacingView extends RacingView {
    protected client: FormulaiClient | null = null;
    private statsBox: StatsBox | null = null;
    private loop: FrameLoop | null = null;
    // Render tracks by key — this page load only (a reload fetches again).
    private readonly tracks = new Map<string, DrawTrack>();
    protected latest: Frame | null = null;
    private drawnTick = -1;
    private lastPresent = 0;
    private fps = 0;

    protected abstract begin(client: FormulaiClient): Promise<void>;
    protected pressedControls(): PressedControls | null { return null; }
    protected beforeFrame(): void {}
    // A new frame was drawn (e.g. to update a "no car running" note).
    protected afterFrame(_frame: Frame): void {}

    protected prepare(): void {
        this.client = new FormulaiClient(config.wsUrl);
        this.client.onClose(() => this.showError(`Lost the connection to the game server (${config.wsUrl}).`));
        this.client.on('evt:view', 'track', data => this.tracks.set(data.key, new DrawTrack(data)));
        this.client.on('evt:view', 'frame', data => { this.latest = data; });
        this.client.on('evt:system', 'error', data => console.error('Game server:', data.reason));
    }

    protected wireHud(): void {
        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');
    }

    protected start(): void {
        void this.begin(this.client!).catch(err => this.showError(err instanceof Error ? err.message : String(err)));
        this.loop = new FrameLoop(() => this.onFrame());
        this.loop.start();
    }

    protected stop(): void {
        this.loop?.stop();
    }

    public override unmount(): void {
        this.client?.close();
        super.unmount();
        this.client = null;
        this.statsBox = null;
    }

    // One browser frame: subclass work, then draw the newest frame the
    // server pushed (if new and its render track is here).
    private onFrame(): void {
        this.beforeFrame();
        const frame = this.latest;
        if (!frame || frame.tick === this.drawnTick) return;
        const track = this.tracks.get(frame.key);
        if (!track) return; // its render track hasn't arrived yet
        this.drawnTick = frame.tick;
        const car = frame.cars.find(c => c.id === frame.followed.carId);
        const now = performance.now();
        if (this.lastPresent > 0) this.fps = Math.round(1000 / (now - this.lastPresent));
        this.lastPresent = now;
        this.present({
            track,
            cars: frame.cars,
            selfId: frame.followed.carId ?? undefined,
            camera: {
                zoom: this.zoom,
                focusX: car ? car.x + car.widthPx / 2 : 0,
                focusY: car ? car.y + car.lengthPx / 2 : 0,
                transition: 1,
            },
            fps: this.fps,
        });
        if (frame.hud) {
            this.statsBox?.update(frame.hud);
            this.setIndicators(this.pressedControls(), frame.hud.steeringAngle);
        }
        this.afterFrame(frame);
    }
}
