import { RacingView, type PressedControls } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { FastestLaps } from '~/hud/FastestLaps';
import { FormulaiClient } from '~/services/formulaiClient';
import { FrameLoop } from '~/engine/FrameLoop';
import { DrawTrack } from '~/engine/DrawTrack';
import type { DataOf } from '~/protocol';
import { config } from '~/config';

export type Frame = DataOf<'evt:view', 'frame'>;
type Times = DataOf<'evt:view', 'times'>;

// The camera changes car at most once per CAMERA_HOLD_MS (its car gone →
// at once) and glides to the new one over CAMERA_GLIDE_MS (eased).
const CAMERA_HOLD_MS = 1000;
const CAMERA_GLIDE_MS = 1000;

// A racing view whose race runs on the game server: it watches a lobby
// (evt:view/track + evt:view/frame) and draws the newest frame each browser
// frame. The camera is on the followed car (held at least CAMERA_HOLD_MS,
// gliding over to a new one); the HUD and steering wheel are that car's
// (kept while the camera still holds another); the fastest laps are the
// watched stage's (evt:view/times).
//
// Concrete subclasses fill in:
//   - begin()           — what to do once connected (join, watch …)
//   - pressedControls() — which control-panel buttons to show pressed
//   - beforeFrame()     — per browser frame work (e.g. send the keys)
export abstract class ServerRacingView extends RacingView {
    protected client: FormulaiClient | null = null;
    private statsBox: StatsBox | null = null;
    private fastestLaps: FastestLaps | null = null;
    private times: Times | null = null;
    private loop: FrameLoop | null = null;
    // Render tracks by key — this page load only (a reload fetches again).
    private readonly tracks = new Map<string, DrawTrack>();
    protected latest: Frame | null = null;
    private drawnTick = -1;
    private lastPresent = 0;
    private fps = 0;
    // The car the camera is on (may lag the followed car by up to
    // CAMERA_HOLD_MS), when it last changed, and the glide from the focus
    // shown then.
    private cameraId: string | null = null;
    private cameraSince = 0;
    private glideFrom: { x: number; y: number } | null = null;
    private focus = { x: 0, y: 0 };
    private cameraKey: string | null = null; // the render track the focus is on

    protected abstract begin(client: FormulaiClient): Promise<void>;
    // The button on the "Connection lost" box (e.g. "Start again").
    protected abstract connectionLostButton(): string;
    protected pressedControls(): PressedControls | null { return null; }
    protected beforeFrame(): void {}
    // The watched stage's fastest laps box (top right).
    protected showsFastestLaps(): boolean { return true; }
    // A new frame was drawn (e.g. to update a "no car running" note).
    protected afterFrame(_frame: Frame): void {}

    protected prepare(): void {
        this.client = new FormulaiClient(config.wsUrl);
        this.client.onClose(wasOpen => this.showConnectionLost(wasOpen));
        this.client.on('evt:view', 'track', data => this.tracks.set(data.key, new DrawTrack(data)));
        this.client.on('evt:view', 'frame', data => { this.latest = data; });
        this.client.on('evt:view', 'times', data => { this.times = data; });
        this.client.on('evt:system', 'error', data => console.error('Game server:', data.reason));
    }

    protected wireHud(): void {
        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');
        if (this.showsFastestLaps()) {
            this.fastestLaps = new FastestLaps();
            this.mountHud(this.fastestLaps, 'topRight');
        }
    }

    protected start(): void {
        void this.begin(this.client!).catch(err => this.showError(err instanceof Error ? err.message : String(err)));
        this.loop = new FrameLoop(() => this.onFrame());
        this.loop.start();
    }

    protected stop(): void {
        this.loop?.stop();
    }

    // The connection to the server dropped (or never came up): stop drawing,
    // keep the last picture, and offer the button — it reloads the page
    // (single player: a new race; viewer: watch the lobby again).
    private showConnectionLost(wasOpen: boolean): void {
        this.stop();
        const box = document.createElement('div');
        Object.assign(box.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
            padding: '24px 32px', backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '10px',
            color: 'white', fontFamily: 'Arial, sans-serif', pointerEvents: 'auto',
        });
        const title = document.createElement('div');
        title.textContent = wasOpen ? 'Connection lost' : 'Can\'t reach the game server';
        Object.assign(title.style, { fontSize: '24px', fontWeight: 'bold' });
        const text = document.createElement('div');
        text.textContent = wasOpen ? `The connection to the game server (${config.wsUrl}) dropped.` : `No answer from ${config.wsUrl}.`;
        Object.assign(text.style, { fontSize: '14px', color: '#ccc' });
        const button = document.createElement('button');
        button.textContent = this.connectionLostButton();
        Object.assign(button.style, {
            padding: '10px 24px', fontSize: '16px', backgroundColor: '#4CAF50', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
        });
        button.addEventListener('click', () => window.location.reload());
        box.append(title, text, button);
        this.getSlot('center').appendChild(box);
    }

    public override unmount(): void {
        this.client?.close();
        super.unmount();
        this.client = null;
        this.statsBox = null;
        this.fastestLaps = null;
        this.times = null;
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
        const now = performance.now();
        if (this.lastPresent > 0) this.fps = Math.round(1000 / (now - this.lastPresent));
        this.lastPresent = now;
        const camera = this.cameraFor(frame, now);
        this.present({
            track,
            cars: frame.cars,
            selfId: this.cameraId ?? undefined,
            camera: { zoom: this.zoom, focusX: camera.x, focusY: camera.y, transition: camera.transition },
            fps: this.fps,
        });
        // The camera still holds another car: keep the HUD as it is.
        if (this.cameraId === frame.followed.carId) {
            if (frame.hud) {
                this.statsBox?.update(frame.hud);
                this.setIndicators(this.pressedControls(), frame.hud.steeringAngle);
            } else {
                this.statsBox?.clear();
                this.setIndicators(this.pressedControls(), 0);
            }
            const karts = this.times?.stage === frame.followed.stage ? this.times.karts : {};
            this.fastestLaps?.update(karts, frame.followed.kart, frame.followed.carId);
        }
        this.afterFrame(frame);
    }

    // Which car the camera is on and where it looks: the followed car, but
    // a change waits until the camera has held its car CAMERA_HOLD_MS (its
    // car no longer in the frame → at once); then a CAMERA_GLIDE_MS eased
    // glide from the focus shown (transition 0 → 1 for the 3D cameras).
    private cameraFor(frame: Frame, now: number): { x: number; y: number; transition: number } {
        const wanted = frame.followed.carId;
        const held = frame.cars.some(c => c.id === this.cameraId);
        if (wanted !== this.cameraId && (!held || now - this.cameraSince >= CAMERA_HOLD_MS)) {
            // No glide from nothing, to nothing, or across tracks.
            this.glideFrom = this.cameraId !== null && wanted !== null && frame.key === this.cameraKey ? { ...this.focus } : null;
            this.cameraId = wanted;
            this.cameraSince = now;
        }
        this.cameraKey = frame.key;
        const car = frame.cars.find(c => c.id === this.cameraId);
        const target = car ? { x: car.x + car.widthPx / 2, y: car.y + car.lengthPx / 2 } : { x: 0, y: 0 };
        let transition = 1;
        if (this.glideFrom) {
            const t = Math.min(1, (now - this.cameraSince) / CAMERA_GLIDE_MS);
            transition = t * t * (3 - 2 * t);
            if (t >= 1) this.glideFrom = null;
        }
        const from = this.glideFrom ?? target;
        this.focus = { x: from.x + (target.x - from.x) * transition, y: from.y + (target.y - from.y) * transition };
        return { ...this.focus, transition };
    }
}
