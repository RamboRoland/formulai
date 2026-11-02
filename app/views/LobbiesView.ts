import type { View } from './View';
import { FormulaiClient } from '~/services/formulaiClient';
import type { LobbySummary, SessionList } from '~/protocol';
import { config } from '~/config';

// How often the lobby list is refreshed (ms).
const REFRESH_MS = 2000;

// The lobbies on the game server: watch one, or create a new one for agents
// to join (TEMPORARY: creating moves to the lobby editor in phase 5 — the
// session dropdown reads GET /api/sessions).
export class LobbiesView implements View {
    private rootEl: HTMLDivElement | null = null;
    private client: FormulaiClient | null = null;
    private timer: number | null = null;
    private listEl: HTMLDivElement | null = null;
    private statusEl: HTMLDivElement | null = null;

    public mount(root: HTMLElement): void {
        this.rootEl = this.build();
        root.appendChild(this.rootEl);
        this.client = new FormulaiClient(config.wsUrl);
        this.client.onClose(() => this.setStatus(`Lost the connection to the game server (${config.wsUrl}).`));
        this.client.on('res:lobby', 'list', ({ lobbies }) => this.renderList(lobbies));
        const refresh = () => this.client?.send('req:lobby', 'list');
        refresh();
        this.timer = window.setInterval(refresh, REFRESH_MS);
        void this.loadSessions();
    }

    public unmount(): void {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.client?.close();
        this.rootEl?.remove();
        this.rootEl = null;
        this.client = null;
    }

    private build(): HTMLDivElement {
        const page = document.createElement('div');
        Object.assign(page.style, {
            minHeight: '100vh', padding: '40px', boxSizing: 'border-box',
            backgroundColor: '#1a1a1a', color: 'white', fontFamily: 'Arial, sans-serif',
        });
        const back = document.createElement('a');
        back.textContent = '← Back to Menu';
        back.href = '/';
        Object.assign(back.style, { color: '#aaa', textDecoration: 'none' });
        const title = document.createElement('h1');
        title.textContent = 'Lobbies';
        Object.assign(title.style, { fontSize: '36px', margin: '20px 0' });

        const create = document.createElement('div');
        create.dataset.role = 'create';
        Object.assign(create.style, { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '30px' });

        this.statusEl = document.createElement('div');
        Object.assign(this.statusEl.style, { color: '#ff7070', minHeight: '20px', marginBottom: '10px' });
        this.listEl = document.createElement('div');
        Object.assign(this.listEl.style, { display: 'flex', flexDirection: 'column', gap: '10px' });
        page.append(back, title, create, this.statusEl, this.listEl);
        return page;
    }

    // The temporary "Create lobby": a session from the server + a button.
    private async loadSessions(): Promise<void> {
        const create = this.rootEl?.querySelector<HTMLDivElement>('[data-role="create"]');
        if (!create) return;
        let sessions: SessionList['sessions'];
        try {
            const res = await fetch(`${config.apiUrl}/api/sessions`);
            sessions = ((await res.json()) as SessionList).sessions;
        } catch {
            this.setStatus(`Can't read the sessions from ${config.apiUrl}.`);
            return;
        }
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Session');
        for (const s of sessions) {
            const option = document.createElement('option');
            option.value = s.name;
            option.textContent = s.displayName ?? s.name;
            select.appendChild(option);
        }
        const button = this.button('Create lobby', '#9C27B0');
        button.addEventListener('click', async () => {
            const client = this.client;
            if (!client) return;
            client.send('req:lobby', 'create', { session: select.value });
            const created = await Promise.race([client.once('res:lobby', 'create'), client.once('res:lobby', 'createError')]);
            if ('lobbyId' in created) window.location.href = `/lobbies/${created.lobbyId}`;
            else this.setStatus(created.reason);
        });
        const label = document.createElement('span');
        label.textContent = 'Session:';
        create.append(label, select, button);
    }

    private renderList(lobbies: LobbySummary[]): void {
        if (!this.listEl) return;
        this.listEl.replaceChildren();
        if (lobbies.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No lobbies yet.';
            empty.style.color = '#aaa';
            this.listEl.appendChild(empty);
            return;
        }
        for (const lobby of lobbies) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '20px',
                padding: '12px 16px', backgroundColor: '#2a2a2a', borderRadius: '6px',
            });
            const info = document.createElement('div');
            info.style.flex = '1';
            const owners = new Set(lobby.members.map(m => m.ownerId)).size;
            info.innerHTML = '';
            const head = document.createElement('div');
            head.textContent = `${lobby.id} · ${lobby.session.displayName}`;
            head.style.fontWeight = 'bold';
            const sub = document.createElement('div');
            sub.textContent = `${lobby.stages} stages · ${owners} client${owners === 1 ? '' : 's'}, ${lobby.members.length} car${lobby.members.length === 1 ? '' : 's'}`
                + (lobby.members.length ? ` (${lobby.members.map(m => m.name).join(', ')})` : '');
            Object.assign(sub.style, { color: '#aaa', fontSize: '14px', marginTop: '4px' });
            info.append(head, sub);
            const watch = document.createElement('a');
            watch.textContent = 'Watch';
            watch.href = `/lobbies/${lobby.id}`;
            Object.assign(watch.style, {
                padding: '8px 16px', backgroundColor: '#2196F3', color: 'white',
                borderRadius: '5px', textDecoration: 'none',
            });
            row.append(info, watch);
            this.listEl.appendChild(row);
        }
    }

    private setStatus(text: string): void {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    private button(label: string, bg: string): HTMLButtonElement {
        const b = document.createElement('button');
        b.textContent = label;
        Object.assign(b.style, {
            padding: '8px 16px', backgroundColor: bg, color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '14px',
        });
        return b;
    }
}
