import { ServerRacingView } from './ServerRacingView';
import type { PressedControls } from './RacingView';
import { KeyboardControls } from '~/components/controls/KeyboardControls';
import type { FormulaiClient } from '~/services/formulaiClient';
import type { CarControls } from '~/protocol';

// The session single player races (the server owns the sessions).
const SESSION = 'TrainingOne';

// Single player on the server: creates its own lobby (auto-advance: a
// finish moves on to the next stage), joins it as the keyboard player and
// watches its own car. Keys (KeyboardControls: ramped pedals, steering
// aid) → req:player/controls (sent when they change),
// R / Reset → req:player/restart; evt:player/completed shows the end
// screen. Drawing + HUD: ServerRacingView.
export class SinglePlayerView extends ServerRacingView {
    private keyboard: KeyboardControls | null = null;
    private sentControls = '';
    private lastFrame = 0;

    protected override prepare(): void {
        super.prepare();
        this.keyboard = new KeyboardControls();
        this.keyboard.start();
        this.client!.on('evt:player', 'completed', data => this.showSessionComplete(data.stageTimes, data.totalTime));
    }

    protected connectionLostButton(): string {
        return 'Start again';
    }

    // A finish moves on at once, so the box would only show the new
    // stage's (empty) list.
    protected override showsFastestLaps(): boolean {
        return false;
    }

    protected onReset(): void {
        this.client?.send('req:player', 'restart');
    }

    public override unmount(): void {
        this.keyboard?.stop();
        super.unmount();
        this.keyboard = null;
    }

    // Own lobby → join as the player → watch it.
    protected async begin(client: FormulaiClient): Promise<void> {
        client.send('req:lobby', 'create', { session: SESSION, autoAdvance: true });
        const created = await Promise.race([client.once('res:lobby', 'create'), client.once('res:lobby', 'createError')]);
        if (!('lobbyId' in created)) throw new Error(`The game server can't start "${SESSION}": ${created.reason}`);
        client.send('req:lobby', 'list');
        const lobby = (await client.once('res:lobby', 'list')).lobbies.find(l => l.id === created.lobbyId);
        if (!lobby) throw new Error('The game server lost the new lobby.');
        client.send('req:player', 'join', { lobbyId: lobby.id, name: 'Player', kart: lobby.session.cars[0] });
        const joined = await Promise.race([client.once('res:player', 'join'), client.once('res:player', 'joinError')]);
        if (!('playerId' in joined)) throw new Error(`Can't join the race: ${joined.reason}`);
        this.keyboard?.setHandling(joined.handling);
        client.send('req:view', 'watch', { lobbyId: lobby.id, follow: { client: joined.playerId } });
    }

    protected override pressedControls(): PressedControls | null {
        return this.keyboard?.getControls() ?? null;
    }

    // Move the keys' ramps on (the steering aid from the car's own speed,
    // the newest frame's HUD) and send them if they changed (2 decimals;
    // R = restart, once per press).
    protected override beforeFrame(): void {
        const now = performance.now();
        const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
        this.lastFrame = now;
        this.keyboard?.update(dt, this.latest?.hud?.speed ?? 0);
        const keys = this.keyboard?.getControls();
        if (!keys || !this.client) return;
        if (keys.restart) {
            this.client.send('req:player', 'restart');
            this.keyboard!.resetRestart();
        }
        const round = (x: number) => Math.round(x * 100) / 100;
        const controls: CarControls = { forward: round(keys.forward), backward: round(keys.backward), steering: round(keys.steering), brake: round(keys.brake) };
        const text = JSON.stringify(controls);
        if (text !== this.sentControls) {
            this.sentControls = text;
            this.client.send('req:player', 'controls', controls);
        }
    }
}
