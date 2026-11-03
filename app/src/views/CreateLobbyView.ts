import type { View } from './View';
import { config } from '~/config';
import type { SessionEntry, SessionList, TrackLayouts } from '~/protocol';
import { apiGet, createLobby } from '~/services/serverApi';

// Create a lobby fast (/lobby/create): pick an existing session, create
// the lobby, get its id for agents and a link to watch it.
// Building / editing sessions: /session/editor.

const STYLE = `
.create-lobby { --panel: #242424; --row: #2e2e2e; --line: #3a3a3a; --text: #eee; --muted: #999;
  --accent: #9c27b0; --ok: #4caf50; --error: #ff7070;
  background: #1a1a1a; color: var(--text); font-family: Arial, sans-serif; font-size: 14px; min-height: 100vh;
  padding: 40px; box-sizing: border-box; }
.create-lobby * { box-sizing: border-box; }
.create-lobby a { color: #64b5f6; }
.create-lobby h1 { font-size: 32px; margin: 16px 0 24px; }
.create-lobby .list { display: flex; flex-direction: column; gap: 8px; max-width: 820px; }
.create-lobby .session { display: flex; gap: 16px; align-items: center; padding: 12px 16px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
.create-lobby .session.selected { border-color: var(--accent); }
.create-lobby .session .info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.create-lobby .session .name { font-weight: bold; font-size: 16px; }
.create-lobby .muted { color: var(--muted); }
.create-lobby button { font: inherit; color: var(--text); background: var(--row); border: 1px solid var(--line);
  border-radius: 5px; padding: 8px 16px; cursor: pointer; }
.create-lobby button:disabled { opacity: 0.4; cursor: default; }
.create-lobby button.primary { background: var(--accent); border-color: var(--accent); font-size: 16px; padding: 10px 24px; }
.create-lobby .actions { display: flex; gap: 14px; align-items: center; margin: 20px 0; }
.create-lobby .status.error { color: var(--error); }
.create-lobby .created { max-width: 820px; background: var(--panel); border: 1px solid var(--ok); border-radius: 8px;
  padding: 14px 18px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.create-lobby .created code { font-size: 22px; letter-spacing: 2px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

export class CreateLobbyView implements View {
    private root: HTMLDivElement | null = null;
    private style: HTMLStyleElement | null = null;
    private sessions: SessionEntry[] = [];
    private layoutNames = new Map<string, string>(); // "track::layout" → "Track Layout" (display)
    private selected: string | null = null;
    private fast = false;
    private created: string | null = null;
    private error = '';

    public mount(root: HTMLElement): void {
        this.style = el('style', {}, STYLE);
        document.head.appendChild(this.style);
        this.root = el('div', { className: 'create-lobby' });
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
            const [sessions, layouts] = await Promise.all([
                apiGet<SessionList>('/api/sessions').then(r => r.sessions),
                apiGet<TrackLayouts>('/api/tracks/layouts').then(r => r.tracks),
            ]);
            this.sessions = sessions.sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name));
            for (const t of layouts) for (const l of t.layouts) this.layoutNames.set(`${t.name}::${l.name}`, `${t.displayName} ${l.name}`);
            this.selected = this.sessions[0]?.name ?? null;
        } catch {
            this.error = `Can't reach the game server's API at ${config.apiUrl}.`;
        }
        this.render();
    }

    private render(): void {
        if (!this.root) return;
        const list = el('div', { className: 'list' });
        for (const s of this.sessions) {
            const stages = s.stages.map(st => {
                const name = this.layoutNames.get(`${st.track}::${st.layout}`) ?? `${st.track}${st.layout ? ' ' + st.layout : ''}`;
                return st.laps > 1 ? `${name} ×${st.laps}` : name;
            });
            const radio = el('input', { type: 'radio', name: 'session', checked: s.name === this.selected });
            const row = el('label', { className: `session${s.name === this.selected ? ' selected' : ''}` },
                radio,
                el('span', { className: 'info' },
                    el('span', { className: 'name' }, s.displayName || s.name),
                    el('span', { className: 'muted' }, `${s.stages.length} stage${s.stages.length === 1 ? '' : 's'}, ${s.mode ?? 'training'}${s.repeat ? ', repeating' : ''}: ${stages.join(' → ')}`),
                    el('span', { className: 'muted' }, `Karts: ${s.cars.join(', ')}`)));
            row.addEventListener('click', () => {
                this.selected = s.name;
                this.created = null;
                this.render();
            });
            list.appendChild(row);
        }
        const create = el('button', { className: 'primary', disabled: !this.selected }, 'Create lobby');
        create.addEventListener('click', () => void this.create());
        const fast = el('input', { type: 'checkbox', checked: this.fast });
        fast.addEventListener('change', () => { this.fast = fast.checked; });
        const actions = el('div', { className: 'actions' },
            create,
            el('label', { title: 'Lockstep: each tick waits for every agent\'s controls, then runs at once. Agents only; an agent silent 5 s is dropped.' },
                fast, ' Fast training — as fast as the agents answer'),
            el('a', { href: '/session/editor' }, 'Build or edit a session →'),
            el('span', { className: 'status error' }, this.error));
        this.root.replaceChildren(
            el('a', { href: '/' }, '← Back to Menu'),
            el('h1', {}, 'Create lobby'),
            list,
            actions);
        if (this.created) this.root.appendChild(this.renderCreated(this.created));
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

    private async create(): Promise<void> {
        if (!this.selected) return;
        this.error = '';
        try {
            this.created = await createLobby(this.selected, this.fast);
        } catch (err) {
            this.created = null;
            this.error = `No lobby: ${(err as Error).message}`;
        }
        this.render();
    }
}
