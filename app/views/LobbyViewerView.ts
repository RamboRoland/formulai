import { ServerRacingView, type Frame } from './ServerRacingView';
import type { FormulaiClient } from '~/services/formulaiClient';
import type { LobbyMember } from '~/protocol';

// Watching one lobby on the game server: the camera, HUD and steering wheel
// follow a client (default: the first). The "Follow" dropdown lists the
// lobby's clients; a client without a car on the track shows a note
// (where to move the view then: phase 7). Viewers can't restart cars.
export class LobbyViewerView extends ServerRacingView {
    private followSelect: HTMLSelectElement | null = null;
    private noteEl: HTMLDivElement | null = null;
    private following: string | null = null;
    // No drivers in the lobby (from evt:lobby/members): the race is paused,
    // and a frame that was already on its way doesn't hide the note.
    private noDrivers = true;

    public constructor(private readonly lobbyId: string) {
        super();
        this.showResetButton = false;
    }

    protected onReset(): void {}

    protected override prepare(): void {
        super.prepare();
        this.client!.on('evt:lobby', 'members', ({ members }) => this.renderFollow(members));
    }

    protected override wireDefaults(): void {
        super.wireDefaults();
        const label = document.createElement('label');
        Object.assign(label.style, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)', borderRadius: '5px',
            color: 'white', fontFamily: 'monospace', fontSize: '14px',
        });
        label.append(`Lobby ${this.lobbyId} · Follow`);
        this.followSelect = document.createElement('select');
        this.followSelect.addEventListener('change', () => {
            this.following = this.followSelect!.value || null;
            this.client?.send('req:view', 'watch', {
                lobbyId: this.lobbyId,
                ...(this.following ? { follow: { client: this.following } } : {}),
            });
        });
        label.appendChild(this.followSelect);
        this.getTopRightWrapper().prepend(label);

        this.noteEl = document.createElement('div');
        Object.assign(this.noteEl.style, {
            padding: '10px 16px', backgroundColor: 'rgba(0, 0, 0, 0.7)', borderRadius: '5px',
            color: 'white', fontFamily: 'monospace', fontSize: '16px', display: 'none',
        });
        this.getSlot('topCenter').appendChild(this.noteEl);
        this.showNote('Waiting for a driver to join…');
    }

    protected async begin(client: FormulaiClient): Promise<void> {
        client.send('req:lobby', 'list');
        const lobby = (await client.once('res:lobby', 'list')).lobbies.find(l => l.id === this.lobbyId);
        if (!lobby) throw new Error(`No lobby "${this.lobbyId}" on the game server.`);
        this.renderFollow(lobby.members);
        client.send('req:view', 'watch', { lobbyId: this.lobbyId });
        const error = await Promise.race([client.once('res:view', 'watchError'), client.once('evt:view', 'track').then(() => null)]);
        if (error) throw new Error(error.reason);
    }

    protected override afterFrame(frame: Frame): void {
        if (this.noDrivers || !frame.followed.ownerId) this.showNote('Waiting for a driver to join…');
        else if (!frame.hud) this.showNote('This client has no car on the track right now.');
        else this.showNote(null);
        // Keep the dropdown on the client actually followed (e.g. the default).
        if (this.followSelect && frame.followed.ownerId && this.followSelect.value !== frame.followed.ownerId && !this.following) {
            this.followSelect.value = frame.followed.ownerId;
        }
    }

    // A note over the race (null = hide it).
    private showNote(text: string | null): void {
        if (!this.noteEl) return;
        this.noteEl.textContent = text ?? '';
        this.noteEl.style.display = text ? 'block' : 'none';
    }

    // One option per client (an agent with several cars is one client).
    private renderFollow(members: LobbyMember[]): void {
        if (!this.followSelect) return;
        const owners = new Map<string, LobbyMember[]>();
        for (const m of members) owners.set(m.ownerId, [...(owners.get(m.ownerId) ?? []), m]);
        this.noDrivers = owners.size === 0;
        const current = this.followSelect.value;
        this.followSelect.replaceChildren();
        if (owners.size === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '— nobody yet —';
            this.followSelect.appendChild(option);
            // The race pauses without drivers: no frames come, so say why.
            this.showNote('Waiting for a driver to join…');
            return;
        }
        for (const [ownerId, cars] of owners) {
            const option = document.createElement('option');
            option.value = ownerId;
            option.textContent = `${cars.map(c => c.name).join(' + ')} (${cars[0].kind})`;
            this.followSelect.appendChild(option);
        }
        if (owners.has(current)) this.followSelect.value = current;
    }
}
