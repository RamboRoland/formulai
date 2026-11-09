import type { View } from './View';
import { FormulaiClient } from '~/services/formulaiClient';
import type { LobbySummary } from '~/protocol';
import { config } from '~/config';

// How often the lobby list is refreshed (ms).
const REFRESH_MS = 2000;

// The lobbies on the game server: watch one, delete an empty one, or go
// and create a new one (/lobby/create) for agents to join.
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
        this.client.onClose(wasOpen => this.setStatus(wasOpen
            ? `Lost the connection to the game server (${config.wsUrl}). Reload the page to reconnect.`
            : `Can't reach the game server at ${config.wsUrl}.`));
        this.client.on('res:lobby', 'list', ({ lobbies }) => this.renderList(lobbies));
        const refresh = () => this.client?.send('req:lobby', 'list');
        this.client.on('res:lobby', 'delete', () => { this.setStatus(''); refresh(); });
        this.client.on('res:lobby', 'deleteError', ({ reason }) => this.setStatus(reason));
        refresh();
        this.timer = window.setInterval(refresh, REFRESH_MS);
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

        const create = document.createElement('a');
        create.textContent = '+ Create lobby';
        create.href = '/lobby/create';
        Object.assign(create.style, {
            display: 'inline-block', marginBottom: '30px', padding: '8px 16px', backgroundColor: '#9C27B0',
            color: 'white', borderRadius: '5px', textDecoration: 'none',
        });

        this.statusEl = document.createElement('div');
        Object.assign(this.statusEl.style, { color: '#ff7070', minHeight: '20px', marginBottom: '10px' });
        this.listEl = document.createElement('div');
        Object.assign(this.listEl.style, { display: 'flex', flexDirection: 'column', gap: '10px' });
        page.append(back, title, create, this.statusEl, this.listEl);
        return page;
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
            const clients = new Map(lobby.members.map(m => [m.ownerId, m.client]));
            const owners = clients.size;
            info.innerHTML = '';
            const head = document.createElement('div');
            head.textContent = `${lobby.id} · ${lobby.session.displayName}`;
            head.style.fontWeight = 'bold';
            const sub = document.createElement('div');
            sub.textContent = `${lobby.stages} stages${lobby.fast ? ' · fast training' : ''} · ${owners} client${owners === 1 ? '' : 's'}, ${lobby.members.length} car${lobby.members.length === 1 ? '' : 's'}`
                + (owners ? ` (${[...clients.values()].join(', ')})` : '');
            Object.assign(sub.style, { color: '#aaa', fontSize: '14px', marginTop: '4px' });
            info.append(head, sub);
            const watch = document.createElement('a');
            watch.textContent = 'Watch';
            watch.href = `/lobbies/${lobby.id}`;
            Object.assign(watch.style, {
                padding: '8px 16px', backgroundColor: '#2196F3', color: 'white',
                borderRadius: '5px', textDecoration: 'none',
            });
            // Only an empty lobby can be deleted (the server checks it too).
            const remove = document.createElement('button');
            remove.textContent = 'Delete';
            const inUse = owners > 0;
            remove.disabled = inUse;
            remove.title = inUse ? 'Clients are driving in this lobby' : `Delete lobby ${lobby.id}`;
            Object.assign(remove.style, {
                padding: '8px 16px', backgroundColor: inUse ? '#5a5a5a' : '#e53935', color: inUse ? '#999' : 'white',
                border: 'none', borderRadius: '5px', fontSize: '16px', cursor: inUse ? 'not-allowed' : 'pointer',
            });
            remove.addEventListener('click', () => {
                if (confirm(`Delete lobby ${lobby.id} (${lobby.session.displayName})?`)) {
                    this.client?.send('req:lobby', 'delete', { lobbyId: lobby.id });
                }
            });
            row.append(info, watch, remove);
            this.listEl.appendChild(row);
        }
    }

    private setStatus(text: string): void {
        if (this.statusEl) this.statusEl.textContent = text;
    }
}
