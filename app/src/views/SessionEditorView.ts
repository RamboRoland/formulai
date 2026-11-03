import type { View } from './View';
import { config } from '~/config';
import type { KartList, SessionDefinition, SessionEntry, SessionList, TrackLayouts } from '~/protocol';
import { apiGet, apiSend, createLobby } from '~/services/serverApi';

// The session editor (/session/editor): build a session (name, stages,
// karts, repeat, mode) from the game server's tracks and karts, save it
// (over an existing one or as new), delete one — and, to try one out without saving, create a lobby with it
// right here (picking an existing session fast: /lobby/create).
// Everything goes through the server's API (config.apiUrl).

type Stage = SessionDefinition['stages'][number];

const STYLE = `
.session-editor { --panel: #242424; --row: #2e2e2e; --line: #3a3a3a; --text: #eee; --muted: #999;
  --accent: #9c27b0; --ok: #4caf50; --danger: #d9534f; --error: #ff7070;
  background: #1a1a1a; color: var(--text); font-family: Arial, sans-serif; font-size: 14px; min-height: 100vh;
  display: grid; grid-template-columns: 260px 1fr; }
.session-editor * { box-sizing: border-box; }
.session-editor a { color: #64b5f6; }
.session-editor button, .session-editor select, .session-editor input { font: inherit; color: var(--text);
  background: var(--row); border: 1px solid var(--line); border-radius: 5px; padding: 6px 10px; }
.session-editor button { cursor: pointer; }
.session-editor button:disabled { opacity: 0.4; cursor: default; }
.session-editor button.primary { background: var(--accent); border-color: var(--accent); }
.session-editor button.ok { background: var(--ok); border-color: var(--ok); }
.session-editor button.danger { background: var(--danger); border-color: var(--danger); }
.session-editor .sidebar { background: var(--panel); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.session-editor .sidebar h2 { margin: 0 0 8px; font-size: 16px; }
.session-editor .session-item { text-align: left; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.session-editor .session-item.active { border-color: var(--accent); }
.session-editor .main { padding: 24px 32px; display: flex; flex-direction: column; gap: 18px; max-width: 980px; }
.session-editor h1 { font-size: 28px; margin: 0; }
.session-editor .field { display: flex; flex-direction: column; gap: 6px; }
.session-editor .field > label { color: var(--muted); }
.session-editor .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.session-editor .stages { display: flex; flex-direction: column; gap: 6px; }
.session-editor .stage { display: grid; grid-template-columns: 30px 1.2fr 1.4fr 130px auto; gap: 8px;
  align-items: center; background: var(--row); padding: 8px; border-radius: 6px; }
.session-editor .stage input[type=number] { width: 70px; }
.session-editor .stage label { flex-wrap: nowrap; }
.session-editor .stage .num { color: var(--muted); text-align: right; }
.session-editor .kind { color: var(--muted); font-size: 12px; }
.session-editor .status { min-height: 20px; }
.session-editor .status.error { color: var(--error); }
.session-editor .status.ok { color: var(--ok); }
.session-editor .created { background: var(--panel); border: 1px solid var(--ok); border-radius: 8px; padding: 14px 18px;
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.session-editor .created code { font-size: 20px; letter-spacing: 2px; }
.session-editor .muted { color: var(--muted); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

export class SessionEditorView implements View {
    private root: HTMLDivElement | null = null;
    private style: HTMLStyleElement | null = null;
    private tracks: TrackLayouts['tracks'] = [];
    private karts: string[] = [];
    private sessions: SessionEntry[] = [];
    // The session being edited, and which saved one it came from.
    private draft: SessionDefinition = SessionEditorView.emptySession();
    private source: SessionEntry | null = null;

    private static emptySession(): SessionDefinition {
        return { name: '', displayName: '', cars: [], stages: [] };
    }

    public mount(root: HTMLElement): void {
        this.style = el('style', {}, STYLE);
        document.head.appendChild(this.style);
        this.root = el('div', { className: 'session-editor' });
        root.appendChild(this.root);
        void this.load();
    }

    public unmount(): void {
        this.root?.remove();
        this.style?.remove();
        this.root = null;
        this.style = null;
    }

    private async load(): Promise<void> {
        try {
            [this.tracks, this.karts, this.sessions] = await Promise.all([
                apiGet<TrackLayouts>('/api/tracks/layouts').then(r => r.tracks),
                apiGet<KartList>('/api/karts').then(r => r.karts),
                apiGet<SessionList>('/api/sessions').then(r => r.sessions),
            ]);
        } catch {
            if (!this.root) return;
            this.root.style.display = 'block';
            this.root.replaceChildren(
                el('p', { className: 'status error', style: 'padding: 40px' } as never, `Can't reach the game server's API at ${config.apiUrl}.`),
                el('p', { style: 'padding: 0 40px' } as never, el('a', { href: '/' }, '← Back to Menu')));
            return;
        }
        this.render();
    }

    private async reloadSessions(): Promise<void> {
        this.sessions = (await apiGet<SessionList>('/api/sessions')).sessions;
    }

    // ---- rendering ------------------------------------------------------

    private render(status?: { text: string; kind: 'ok' | 'error' }, created?: string): void {
        this.root?.replaceChildren(this.renderSidebar(), this.renderMain(status, created));
    }

    private renderSidebar(): HTMLElement {
        const side = el('aside', { className: 'sidebar' },
            el('a', { href: '/' }, '← Back to Menu'),
            el('h2', {}, 'Sessions'));
        for (const s of [...this.sessions].sort((a, b) => a.name.localeCompare(b.name))) {
            const item = el('button', { className: `session-item${this.source?.name === s.name ? ' active' : ''}` },
                el('span', {}, s.displayName || s.name));
            item.addEventListener('click', () => {
                this.source = s;
                this.draft = structuredClone({ name: s.name, displayName: s.displayName, cars: s.cars, repeat: s.repeat, mode: s.mode, stages: s.stages });
                this.render();
            });
            side.appendChild(item);
        }
        const fresh = el('button', { className: 'primary' }, '+ New session');
        fresh.addEventListener('click', () => {
            this.source = null;
            this.draft = SessionEditorView.emptySession();
            this.render();
        });
        side.appendChild(fresh);
        return side;
    }

    private renderMain(status?: { text: string; kind: 'ok' | 'error' }, created?: string): HTMLElement {
        const draft = this.draft;
        const main = el('main', { className: 'main' });
        main.appendChild(el('h1', {}, this.source ? this.source.displayName || this.source.name : 'New session'));

        // Name + display name
        const name = el('input', { value: draft.name, placeholder: 'e.g. MyTraining' });
        name.addEventListener('input', () => { draft.name = name.value.trim(); });
        const displayName = el('input', { value: draft.displayName ?? '', placeholder: 'e.g. My Training' });
        displayName.addEventListener('input', () => { draft.displayName = displayName.value; });
        main.append(el('div', { className: 'row' },
            el('div', { className: 'field' }, el('label', {}, 'Name (id: letters and digits)'), name),
            el('div', { className: 'field' }, el('label', {}, 'Display name'), displayName)));

        // Karts
        const kartRow = el('div', { className: 'row' });
        for (const kart of this.karts) {
            const box = el('input', { type: 'checkbox', checked: draft.cars.includes(kart) });
            box.addEventListener('change', () => {
                draft.cars = box.checked ? [...draft.cars, kart] : draft.cars.filter(k => k !== kart);
            });
            kartRow.appendChild(el('label', { className: 'row' }, box, kart));
        }
        main.appendChild(el('div', { className: 'field' }, el('label', {}, 'Karts that may join'), kartRow));

        // Repeat
        const repeat = el('input', { type: 'checkbox', checked: draft.repeat === true });
        repeat.addEventListener('change', () => { draft.repeat = repeat.checked || undefined; });
        main.appendChild(el('label', { className: 'row' }, repeat, 'Repeat — go around forever (never completed)'));

        // Mode (training = the default, left out of the file)
        const mode = el('select', {},
            el('option', { value: 'training', selected: draft.mode !== 'race' }, 'Training — each client goes through the stages on its own'),
            el('option', { value: 'race', selected: draft.mode === 'race' }, 'Race — one shared stage for the whole lobby'));
        mode.addEventListener('change', () => { draft.mode = mode.value === 'race' ? 'race' : undefined; });
        main.appendChild(el('div', { className: 'field' }, el('label', {}, 'Mode'), mode));

        // Stages
        const list = el('div', { className: 'stages' });
        draft.stages.forEach((stage, i) => list.appendChild(this.renderStage(stage, i)));
        const add = el('button', {}, '+ Add stage');
        add.addEventListener('click', () => {
            const t = this.tracks[0];
            draft.stages.push({ track: t?.name ?? '', layout: t?.layouts[0]?.name, laps: 1 });
            this.render();
        });
        main.appendChild(el('div', { className: 'field' }, el('label', {}, `Stages (${draft.stages.length})`), list, el('div', {}, add)));

        // Actions
        const save = el('button', { className: 'ok', disabled: !this.source }, 'Save');
        save.title = !this.source ? 'A new session: use Save as new' : '';
        save.addEventListener('click', () => void this.doSave(draft.name));
        const saveAs = el('button', { className: 'ok' }, 'Save as new');
        saveAs.addEventListener('click', () => {
            const newName = prompt('Name for the new session (letters and digits, e.g. MyTraining):', this.source ? '' : draft.name);
            if (newName) void this.doSave(newName.trim(), true);
        });
        const del = el('button', { className: 'danger', disabled: !this.source }, 'Delete');
        del.addEventListener('click', () => void this.doDelete());
        const create = el('button', { className: 'primary' }, 'Create lobby');
        create.addEventListener('click', () => void this.doCreateLobby());
        main.appendChild(el('div', { className: 'row' }, save, saveAs, del, el('span', { style: 'flex:1' } as never), create));

        main.appendChild(el('div', { className: `status ${status?.kind ?? ''}` }, status?.text ?? ''));
        if (created) main.appendChild(this.renderCreated(created));
        return main;
    }

    private renderStage(stage: Stage, i: number): HTMLElement {
        const draft = this.draft;
        const track = this.tracks.find(t => t.name === stage.track);
        const trackSelect = el('select');
        for (const t of this.tracks) trackSelect.appendChild(el('option', { value: t.name, selected: t.name === stage.track }, t.displayName));
        trackSelect.addEventListener('change', () => {
            stage.track = trackSelect.value;
            stage.layout = this.tracks.find(t => t.name === stage.track)?.layouts[0]?.name;
            this.render();
        });
        const layoutSelect = el('select');
        for (const l of track?.layouts ?? []) {
            layoutSelect.appendChild(el('option', { value: l.name, selected: l.name === stage.layout }, `${l.name}${l.loop ? '' : ' — one-way'}`));
        }
        layoutSelect.addEventListener('change', () => { stage.layout = layoutSelect.value; this.render(); });
        const layout = track?.layouts.find(l => l.name === stage.layout);
        const laps = el('input', { type: 'number', min: '1', value: String(stage.laps), disabled: layout ? !layout.loop : false });
        laps.title = layout && !layout.loop ? 'One-way: always one run' : 'Laps';
        laps.addEventListener('input', () => { stage.laps = Math.max(1, Math.round(Number(laps.value) || 1)); });
        const move = (to: number) => {
            const [s] = draft.stages.splice(i, 1);
            draft.stages.splice(to, 0, s);
            this.render();
        };
        const up = el('button', { disabled: i === 0, title: 'Up' }, '↑');
        up.addEventListener('click', () => move(i - 1));
        const down = el('button', { disabled: i === draft.stages.length - 1, title: 'Down' }, '↓');
        down.addEventListener('click', () => move(i + 1));
        const remove = el('button', { className: 'danger', title: 'Remove' }, '✕');
        remove.addEventListener('click', () => { draft.stages.splice(i, 1); this.render(); });
        return el('div', { className: 'stage' },
            el('span', { className: 'num' }, `${i + 1}`),
            trackSelect,
            layoutSelect,
            el('label', { className: 'row' }, laps, el('span', { className: 'kind' }, 'laps')),
            el('span', { className: 'row' }, up, down, remove));
    }

    private renderCreated(lobbyId: string): HTMLElement {
        const copy = el('button', {}, 'Copy id');
        copy.addEventListener('click', () => void navigator.clipboard?.writeText(lobbyId));
        return el('div', { className: 'created' },
            el('span', {}, 'Lobby created:'),
            el('code', {}, lobbyId),
            copy,
            el('a', { href: `/lobbies/${lobbyId}` }, 'Watch it →'),
            el('span', { className: 'muted' }, 'Agents join it with req:agent/join { lobbyId }.'));
    }

    // ---- actions ---------------------------------------------------------

    private async doSave(name: string, asNew = false): Promise<void> {
        if (asNew && this.sessions.some(s => s.name === name)) {
            this.render({ text: `"${name}" already exists — pick another name.`, kind: 'error' });
            return;
        }
        const body: SessionDefinition = { ...this.draft, name };
        try {
            await apiSend('PUT', `/api/sessions/${encodeURIComponent(name)}`, body);
        } catch (err) {
            this.render({ text: `Not saved: ${(err as Error).message}`, kind: 'error' });
            return;
        }
        await this.reloadSessions();
        this.source = this.sessions.find(s => s.name === name) ?? null;
        this.draft = { ...body };
        this.render({ text: `Saved "${name}".`, kind: 'ok' });
    }

    private async doDelete(): Promise<void> {
        const source = this.source;
        if (!source) return;
        if (!confirm(`Delete the session "${source.name}"?`)) return;
        try {
            await apiSend('DELETE', `/api/sessions/${encodeURIComponent(source.name)}`);
        } catch (err) {
            this.render({ text: `Not deleted: ${(err as Error).message}`, kind: 'error' });
            return;
        }
        await this.reloadSessions();
        this.source = null;
        this.draft = SessionEditorView.emptySession();
        this.render({ text: `Deleted "${source.name}".`, kind: 'ok' });
    }

    // The session as it is in the editor (saved or not) → a new lobby.
    private async doCreateLobby(): Promise<void> {
        let lobbyId: string;
        try {
            lobbyId = await createLobby({ ...this.draft, name: this.draft.name || 'Unsaved' });
        } catch (err) {
            this.render({ text: `No lobby: ${(err as Error).message}`, kind: 'error' });
            return;
        }
        this.render(undefined, lobbyId);
    }
}
