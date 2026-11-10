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
// Every browser frame draws the race as it was `interpDelayMs` ago, the
// cars blended between the two server frames around that moment (frames
// come 60 a second to a driver, 20 to a watcher, not in step with the
// screen; the delay must cover the gap between two plus some jitter). A frame's moment is
// its tick on a smooth clock (tick × TICK_MS + an offset fitted slowly to
// the arrival times, CLOCK_FIT of each new error; off by more than
// CLOCK_RESYNC_MS, e.g. after a pause → set again), so arrival jitter
// doesn't make the motion uneven. Fast training (frames more than
// FAST_TICKS ticks apart; a watcher's normal frames are 3 apart, the
// server's VIEW_FRAME_TICKS): the arrival time. Frames older than
// FRAME_KEEP_MS are dropped.
const TICK_MS = 1000 / 60;
const CLOCK_FIT = 0.05;
const CLOCK_RESYNC_MS = 100;
const FAST_TICKS = 3;
const FRAME_KEEP_MS = 200;
type RenderCar = Frame['cars'][number];

// A racing view whose race runs on the game server: it watches a lobby
// (evt:view/track + evt:view/frame) and draws every browser frame, the cars
// blended between server frames (`interpDelayMs` behind). The camera is on
// the followed car (held at least CAMERA_HOLD_MS,
// gliding over to a new one); the HUD and steering wheel are that car's
// (kept while the camera still holds another); the fastest laps are the
// watched stage's (evt:view/times).
//
// Concrete subclasses fill in:
//   - begin()           — what to do once connected (join, watch …)
//   - pressedControls() — which control-panel buttons to show pressed
//                         (default null: the followed car's, from the HUD)
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
    // The server frames received (oldest first) with when they arrived;
    // the tick clock's offset (ms; null = not set) and whether it's used.
    private frames: { frame: Frame; at: number }[] = [];
    private clockOffset: number | null = null;
    private tickClock = true;
    private drawnTick = -1; // the newest frame the HUD shows
    // How far behind the newest frames it draws (ms): a driver's frames
    // come every step (60/s); LobbyViewerView watches at 20/s → longer.
    protected interpDelayMs = 25;
    private draws: number[] = []; // when the last second's draws happened (fps)
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
        this.client.on('evt:view', 'frame', data => {
            const at = performance.now();
            const previous = this.frames.at(-1)?.frame;
            if (previous) this.tickClock = data.tick - previous.tick <= FAST_TICKS;
            const error = at - data.tick * TICK_MS - (this.clockOffset ?? 0);
            if (this.clockOffset === null || Math.abs(error) > CLOCK_RESYNC_MS) this.clockOffset = at - data.tick * TICK_MS;
            else this.clockOffset += error * CLOCK_FIT;
            this.latest = data;
            this.frames.push({ frame: data, at });
        });
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

    // One browser frame: subclass work, then draw the race interpDelayMs
    // ago (if its render track is here). The HUD, notes and fastest laps
    // follow the newest frame, once per new frame.
    private onFrame(): void {
        this.beforeFrame();
        const now = performance.now();
        const sample = this.sample(now - this.interpDelayMs);
        if (!sample) return;
        const track = this.tracks.get(sample.frame.key);
        if (!track) return; // its render track hasn't arrived yet
        this.draws.push(now);
        while (this.draws[0] <= now - 1000) this.draws.shift();
        this.fps = this.draws.length;
        const camera = this.cameraFor({ ...sample.frame, cars: sample.cars }, now);
        this.present({
            track,
            cars: sample.cars,
            selfId: this.cameraId ?? undefined,
            camera: { zoom: this.zoom, focusX: camera.x, focusY: camera.y, transition: camera.transition },
            fps: this.fps,
        });
        const frame = this.latest!;
        if (frame.tick === this.drawnTick) return;
        this.drawnTick = frame.tick;
        // The camera still holds another car: keep the HUD as it is.
        if (this.cameraId === frame.followed.carId) {
            // No pressedControls() (a watcher): the followed car's controls.
            const pressed = this.pressedControls();
            if (frame.hud) {
                this.statsBox?.update(frame.hud);
                const { forward, backward, brake } = frame.hud;
                this.setIndicators(pressed ?? { forward, backward, brake, restart: false }, frame.hud.steeringAngle, frame.hud.speed);
            } else {
                this.statsBox?.clear();
                this.setIndicators(pressed ?? { forward: 0, backward: 0, brake: 0, restart: false }, 0, null);
            }
            const karts = this.times?.stage === frame.followed.stage ? this.times.karts : {};
            this.fastestLaps?.update(karts, frame.followed.kart, frame.followed.carId);
        }
        this.afterFrame(frame);
    }

    // The race at time `at`: the two frames around it (by their moment:
    // tick clock, or arrival in fast training), cars blended between them
    // (x, y, wheel angle linear; angle the short way round). A car new in
    // the later frame, reset (spawnId) or on another track: as in the later
    // frame. `at` after the newest frame → the newest frame.
    private sample(at: number): { frame: Frame; cars: RenderCar[] } | null {
        const frames = this.frames;
        const moment = (f: { frame: Frame; at: number }) => this.tickClock ? f.frame.tick * TICK_MS + (this.clockOffset ?? 0) : f.at;
        while (frames.length > 2 && moment(frames[1]) <= at - FRAME_KEEP_MS) frames.shift();
        if (frames.length === 0) return null;
        let i = frames.length - 1;
        while (i > 0 && moment(frames[i]) > at) i--;
        const a = frames[i], b = frames[i + 1];
        if (!b) return { frame: a.frame, cars: a.frame.cars };
        if (a.frame.key !== b.frame.key) return { frame: b.frame, cars: b.frame.cars };
        const t = Math.max(0, Math.min(1, (at - moment(a)) / (moment(b) - moment(a))));
        const before = new Map(a.frame.cars.map(c => [c.id, c]));
        const lerp = (from: number, to: number) => from + (to - from) * t;
        const cars = b.frame.cars.map(car => {
            const old = before.get(car.id);
            if (!old || old.spawnId !== car.spawnId) return car;
            const turn = ((car.angle - old.angle + 540) % 360) - 180;
            return { ...car, x: lerp(old.x, car.x), y: lerp(old.y, car.y), angle: old.angle + turn * t, wheelAngle: lerp(old.wheelAngle, car.wheelAngle) };
        });
        return { frame: b.frame, cars };
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
