import { RacingView } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { KeyboardControls } from '~/components/controls/KeyboardControls';
import { FormulaiClient } from '~/services/formulaiClient';
import { FrameLoop } from '~/engine/FrameLoop';
import { DrawTrack } from '~/engine/DrawTrack';
import type { DataOf, CarControls } from '~/protocol';
import { config } from '~/config';

// The session single player races (the server owns the sessions).
const SESSION = 'TrainingOne';

type Frame = DataOf<'evt:view', 'frame'>;

// Single player on the server: creates its own lobby (auto-advance: a
// finish moves on to the next stage), joins it as the keyboard player and
// watches its own car. Keys → req:player/controls (sent when they change),
// R / Reset → req:player/restart; the HUD and steering wheel come from the
// frames; evt:player/completed shows the end screen. All the shared racing
// UI lives on `RacingView`.
export class SinglePlayerView extends RacingView {
    private client: FormulaiClient | null = null;
    private keyboard: KeyboardControls | null = null;
    private statsBox: StatsBox | null = null;
    private loop: FrameLoop | null = null;
    // Render tracks by key — this page load only (a reload fetches again).
    private readonly tracks = new Map<string, DrawTrack>();
    private latest: Frame | null = null;
    private drawnTick = -1;
    private sentControls = '';
    private lastPresent = 0;
    private fps = 0;

    protected prepare(): void {
        this.keyboard = new KeyboardControls();
        this.keyboard.start();
        this.client = new FormulaiClient(config.wsUrl);
        this.client.onClose(() => this.showError(`Lost the connection to the game server (${config.wsUrl}).`));
        this.client.on('evt:view', 'track', data => this.tracks.set(data.key, new DrawTrack(data)));
        this.client.on('evt:view', 'frame', data => { this.latest = data; });
        this.client.on('evt:player', 'completed', data => this.showSessionComplete(data.stageTimes, data.totalTime));
        this.client.on('evt:system', 'error', data => console.error('Game server:', data.reason));
    }

    protected wireHud(): void {
        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');
    }

    // Own lobby → join as the player → watch it; then draw every new frame.
    protected start(): void {
        void this.joinRace().catch(err => this.showError(err instanceof Error ? err.message : String(err)));
        this.loop = new FrameLoop(() => this.onFrame());
        this.loop.start();
    }

    protected stop(): void {
        this.loop?.stop();
    }

    protected onReset(): void {
        this.client?.send('req:player', 'restart');
    }

    public override unmount(): void {
        this.keyboard?.stop();
        this.client?.close();
        super.unmount();
        this.client = null;
        this.keyboard = null;
        this.statsBox = null;
    }

    private async joinRace(): Promise<void> {
        const client = this.client!;
        client.send('req:lobby', 'create', { session: SESSION, autoAdvance: true });
        const created = await Promise.race([client.once('res:lobby', 'create'), client.once('res:lobby', 'createError')]);
        if (!('lobbyId' in created)) throw new Error(`The game server can't start "${SESSION}": ${created.reason}`);
        client.send('req:lobby', 'list');
        const lobby = (await client.once('res:lobby', 'list')).lobbies.find(l => l.id === created.lobbyId);
        if (!lobby) throw new Error('The game server lost the new lobby.');
        client.send('req:player', 'join', { lobbyId: lobby.id, name: 'Player', kart: lobby.session.cars[0] });
        const joined = await Promise.race([client.once('res:player', 'join'), client.once('res:player', 'joinError')]);
        if (!('playerId' in joined)) throw new Error(`Can't join the race: ${joined.reason}`);
        client.send('req:view', 'watch', { lobbyId: lobby.id, follow: { client: joined.playerId } });
    }

    // One browser frame: send the keys if they changed (R = restart, once
    // per press), then draw the newest frame the server pushed (if new).
    private onFrame(): void {
        const keys = this.keyboard?.getControls();
        if (keys && this.client) {
            if (keys.restart) {
                this.client.send('req:player', 'restart');
                this.keyboard!.resetRestart();
            }
            const controls: CarControls = { forward: keys.forward, backward: keys.backward, steering: keys.steering, brake: keys.brake };
            const text = JSON.stringify(controls);
            if (text !== this.sentControls) {
                this.sentControls = text;
                this.client.send('req:player', 'controls', controls);
            }
        }
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
            this.setIndicators(keys ?? null, frame.hud.steeringAngle);
        }
    }
}
