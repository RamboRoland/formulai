import { ServerRacingView, type Frame } from './ServerRacingView';
import type { FormulaiClient } from '~/services/formulaiClient';
import type { LobbyMember, StageInfo } from '~/protocol';

// Watching one lobby on the game server: the camera, HUD and steering wheel
// follow a client (default: the first). The "Follow" dropdown lists the
// lobby's clients; a client without a car on the track shows a note
// (where to move the view then: phase 7). Viewers can't restart cars.
export class LobbyViewerView extends ServerRacingView {
    private followSelect: HTMLSelectElement | null = null;
    private noteEl: HTMLDivElement | null = null;
    // What the dropdown asked for: 'client:<ownerId>' / 'stage:<index>' (null = the default: the first client).
    private following: string | null = null;
    // The session's stages (names for the "Follow stage" options).
    private stageList: StageInfo[] = [];
    // No drivers in the lobby (from evt:lobby/members): the race is paused,
    // and a frame that was already on its way doesn't hide the note.
    private noDrivers = true;

    public constructor(private readonly lobbyId: string) {
        super();
        this.showResetButton = false;
    }

    protected onReset(): void {}

    protected connectionLostButton(): string {
        return 'Reconnect';
    }

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
        this.followSelect.addEventListener('change', () => this.follow(this.followSelect!.value || null));
        label.appendChild(this.followSelect);
        this.getTopRightWrapper().prepend(label);

        this.noteEl = document.createElement('div');
        Object.assign(this.noteEl.style, {
            padding: '10px 16px', backgroundColor: 'rgba(0, 0, 0, 0.7)', borderRadius: '5px',
            color: 'white', fontFamily: 'monospace', fontSize: '16px', display: 'none',
            marginTop: '60px', // below the Lobby / Follow bar
        });
        this.getSlot('topCenter').appendChild(this.noteEl);
        this.showNote('Waiting for a driver to join…');
    }

    protected async begin(client: FormulaiClient): Promise<void> {
        client.send('req:lobby', 'list');
        const lobby = (await client.once('res:lobby', 'list')).lobbies.find(l => l.id === this.lobbyId);
        if (!lobby) throw new Error(`No lobby "${this.lobbyId}" on the game server.`);
        this.stageList = lobby.stageList;
        this.renderFollow(lobby.members);
        client.send('req:view', 'watch', { lobbyId: this.lobbyId });
        const error = await Promise.race([client.once('res:view', 'watchError'), client.once('evt:view', 'track').then(() => null)]);
        if (error) throw new Error(error.reason);
    }

    protected override afterFrame(frame: Frame): void {
        const stage = this.stageList[frame.followed.stage];
        const where = stage ? ` (stage ${stage.index + 1}: ${stage.track} ${stage.layout})` : '';
        if (this.noDrivers) this.showNote('Waiting for a driver to join…');
        else if (this.following?.startsWith('stage:') && !frame.hud) this.showNote(`No car running on this stage${where}.`);
        else if (!frame.followed.ownerId) this.showNote('Waiting for a driver to join…');
        else if (!frame.hud) this.showNote(`This client has no car on the track right now${where}.`);
        else this.showNote(null);
        // Keep the dropdown on the client actually followed (e.g. the default).
        const value = `client:${frame.followed.ownerId}`;
        if (this.followSelect && frame.followed.ownerId && !this.following && this.followSelect.value !== value) {
            this.followSelect.value = value;
        }
    }

    // Watch the lobby following `value` ('client:<id>' / 'stage:<n>' / null = default).
    private follow(value: string | null): void {
        this.following = value;
        const [kind, id] = value ? [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)] : ['', ''];
        this.client?.send('req:view', 'watch', {
            lobbyId: this.lobbyId,
            ...(kind === 'client' ? { follow: { client: id } } : kind === 'stage' ? { follow: { stage: Number(id) } } : {}),
        });
    }

    // A note over the race (null = hide it).
    private showNote(text: string | null): void {
        if (!this.noteEl) return;
        this.noteEl.textContent = text ?? '';
        this.noteEl.style.display = text ? 'block' : 'none';
    }

    // One option per client (an agent with several cars is one client),
    // then one per stage that has cars. A followed stage with no cars left
    // → back to the default (the first client).
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
        const clients = document.createElement('optgroup');
        clients.label = 'Clients';
        for (const [ownerId, cars] of owners) {
            const option = document.createElement('option');
            option.value = `client:${ownerId}`;
            const stage = this.stageList[cars[0].stage];
            option.textContent = `${cars[0].client} · ${cars.length} car${cars.length === 1 ? '' : 's'}${stage ? ` · stage ${stage.index + 1}` : ''}`;
            clients.appendChild(option);
        }
        this.followSelect.appendChild(clients);
        const perStage = new Map<number, number>();
        for (const m of members) perStage.set(m.stage, (perStage.get(m.stage) ?? 0) + 1);
        const stages = document.createElement('optgroup');
        stages.label = 'Stages with cars';
        for (const [index, count] of [...perStage].sort((a, b) => a[0] - b[0])) {
            const stage = this.stageList[index];
            const option = document.createElement('option');
            option.value = `stage:${index}`;
            option.textContent = `Stage ${index + 1}${stage ? ` · ${stage.track} ${stage.layout}` : ''} (${count} car${count === 1 ? '' : 's'})`;
            stages.appendChild(option);
        }
        this.followSelect.appendChild(stages);
        const values = [...this.followSelect.querySelectorAll('option')].map(o => o.value);
        if (this.following && !values.includes(this.following)) {
            // The followed client left / the followed stage has no cars → the default.
            this.follow(null);
        }
        if (values.includes(current)) this.followSelect.value = current;
    }
}
