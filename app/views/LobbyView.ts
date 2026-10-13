import type { View } from './View';
import type { LobbyPlayer } from '../../server/src/types';
import { WebSocketClient } from '~/services/websocket';
import { SESSION_OPTIONS, SESSION_REGISTRY } from '~/sessions/registry';

// Callbacks the shim/host passes in so the enclosing route can react to lobby
// lifecycle events (lobby id arrives, players change, session chosen, game
// started). All optional.
export interface LobbyViewListener {
    onStartGame?: () => void;
    onUpdateLobbyId?: (lobbyId: string) => void;
    onUpdatePlayers?: (players: LobbyPlayer[]) => void;
    onUpdateSession?: (session: string, track: string | null, cars: string[]) => void;
}

// Multiplayer lobby view. Two screens:
//   1. Create form — session selection + "Create Lobby" button. The session
//      file defines the tracks and the cars players choose from.
//   2. Active lobby — lobby id, players list, Start / Leave buttons.
// Swaps between the two internally. Emits lifecycle events to the host via
// the listener so the route can transition to the game view on start.
export class LobbyView implements View {
    private root: HTMLElement | null = null;
    private wsClient: WebSocketClient | null = null;
    private unsubs: Array<() => void> = [];

    // Form state
    // First session file by default ('' if app/assets/sessions/ is empty).
    private session = SESSION_OPTIONS[0]?.[0] ?? '';

    // Lobby state
    private lobbyId: string | null = null;
    private players: LobbyPlayer[] = [];
    private clientId: string | null = null;

    // DOM refs we update
    private formPanel: HTMLDivElement | null = null;
    private lobbyPanel: HTMLDivElement | null = null;
    private playersList: HTMLDivElement | null = null;
    private playersHeading: HTMLHeadingElement | null = null;
    private lobbyIdHeading: HTMLHeadingElement | null = null;
    private startButton: HTMLButtonElement | null = null;
    private errorBox: HTMLDivElement | null = null;

    public constructor(private readonly listener: LobbyViewListener = {}) {}

    public mount(root: HTMLElement): void {
        this.root = root;
        root.appendChild(this.buildContainer());

        this.wsClient = WebSocketClient.getInstance('ws://localhost:8080');
        this.wireWebSocket();
        this.wsClient.connect('game');
    }

    public unmount(): void {
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        // Do NOT disconnect the WS here — the singleton may be reused by the
        // next view in the same route (e.g. MultiplayerHostView). Disconnecting
        // would reset the clientId and break the server's hostId check for
        // req:game/start. Browser cleans up on page close.
        this.wsClient = null;
        this.root?.replaceChildren();
        this.root = null;
        this.formPanel = null;
        this.lobbyPanel = null;
        this.playersList = null;
        this.playersHeading = null;
        this.lobbyIdHeading = null;
        this.startButton = null;
        this.errorBox = null;
    }

    private wireWebSocket(): void {
        if (!this.wsClient) return;

        this.unsubs.push(this.wsClient.subscribe('evt:system', 'welcome', (data) => {
            this.clientId = data.clientId;
        }));

        this.unsubs.push(this.wsClient.subscribe('res:lobby', 'create', (data) => {
            this.lobbyId = data.lobbyId;
            this.listener.onUpdateLobbyId?.(data.lobbyId);
            this.listener.onUpdateSession?.(data.session, data.track, data.cars);

            // Pre-existing behavior: host auto-joins as "Host" with the first
            // configured car so the player list is non-empty from the start.
            // Flagged for cleanup when the AI-only multiplayer design settles.
            this.wsClient?.send('req:lobby', 'join', {
                lobbyId: data.lobbyId,
                playerName: 'Host',
                playerCar: data.cars[0],
            });

            this.showLobbyPanel();
        }));

        this.unsubs.push(this.wsClient.subscribe('evt:lobby', 'playerJoined', (data) => {
            this.players = [...this.players, data.player];
            this.listener.onUpdatePlayers?.(this.players);
            this.renderPlayers();
        }));

        this.unsubs.push(this.wsClient.subscribe('evt:lobby', 'playerLeft', (data) => {
            this.players = this.players.filter(p => p.id !== data.player.id);
            this.listener.onUpdatePlayers?.(this.players);
            this.renderPlayers();
        }));
    }

    // --- DOM build (initial) ---

    private buildContainer(): HTMLDivElement {
        const container = document.createElement('div');
        Object.assign(container.style, {
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
            height: '100vh',
            backgroundColor: '#1a1a1a', color: 'white',
            fontFamily: 'Arial, sans-serif',
        });
        this.formPanel = this.buildCreateForm();
        container.appendChild(this.formPanel);
        return container;
    }

    private buildCreateForm(): HTMLDivElement {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
        });

        const title = document.createElement('h1');
        title.textContent = 'Multiplayer AI Racing';
        Object.assign(title.style, { fontSize: '48px', marginBottom: '20px' });
        panel.appendChild(title);

        const box = document.createElement('div');
        Object.assign(box.style, {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            padding: '40px', borderRadius: '10px', minWidth: '400px',
        });

        // Session select
        box.appendChild(this.buildLabeledSelect('Session:', SESSION_OPTIONS, this.session, (value) => {
            this.session = value;
        }));

        // Error placeholder
        this.errorBox = document.createElement('div');
        Object.assign(this.errorBox.style, {
            padding: '10px', marginBottom: '20px',
            backgroundColor: 'rgba(244, 67, 54, 0.3)', borderRadius: '5px',
            color: '#ffcdd2', display: 'none',
        });
        box.appendChild(this.errorBox);

        // Create button
        const createRow = document.createElement('div');
        Object.assign(createRow.style, { display: 'flex', gap: '10px', justifyContent: 'center' });
        const createBtn = document.createElement('button');
        createBtn.textContent = 'Create Lobby';
        Object.assign(createBtn.style, {
            padding: '15px 30px', fontSize: '18px',
            backgroundColor: '#2196F3', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
            transition: 'background-color 0.3s',
        });
        createBtn.addEventListener('click', () => this.handleCreate());
        createRow.appendChild(createBtn);
        box.appendChild(createRow);

        // Back-to-menu
        const backRow = document.createElement('div');
        Object.assign(backRow.style, { marginTop: '20px', textAlign: 'center' });
        const backBtn = document.createElement('button');
        backBtn.textContent = 'Back to Menu';
        Object.assign(backBtn.style, {
            padding: '10px 20px', fontSize: '16px',
            backgroundColor: '#666', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
        });
        backBtn.addEventListener('click', () => { window.location.href = '/'; });
        backRow.appendChild(backBtn);
        box.appendChild(backRow);

        panel.appendChild(box);
        return panel;
    }

    private buildLabeledSelect(
        labelText: string,
        options: Array<[string, string]>,
        selectedValue: string,
        onChange: (v: string) => void,
    ): HTMLDivElement {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, { marginBottom: '20px' });

        const label = document.createElement('label');
        label.textContent = labelText;
        Object.assign(label.style, { display: 'block', marginBottom: '10px', fontSize: '18px' });
        wrapper.appendChild(label);

        const select = document.createElement('select');
        Object.assign(select.style, {
            width: '100%', padding: '10px', fontSize: '16px',
            borderRadius: '5px', border: 'none',
            backgroundColor: 'rgba(255, 255, 255, 0.2)', color: 'white',
        });
        for (const [value, text] of options) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            select.appendChild(opt);
        }
        select.value = selectedValue;
        select.addEventListener('change', () => onChange(select.value));
        wrapper.appendChild(select);

        return wrapper;
    }

    // --- DOM swap (lobby → active) ---

    private showLobbyPanel(): void {
        if (!this.root) return;
        this.formPanel?.remove();
        this.formPanel = null;

        this.lobbyPanel = this.buildLobbyPanel();
        this.root.firstElementChild?.appendChild(this.lobbyPanel);
    }

    private buildLobbyPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
        });

        this.lobbyIdHeading = document.createElement('h1');
        this.lobbyIdHeading.textContent = `Lobby: ${this.lobbyId ?? '…'}`;
        Object.assign(this.lobbyIdHeading.style, { fontSize: '36px', marginBottom: '20px' });
        panel.appendChild(this.lobbyIdHeading);

        const box = document.createElement('div');
        Object.assign(box.style, {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            padding: '30px', borderRadius: '10px', minWidth: '400px',
        });

        this.playersHeading = document.createElement('h2');
        this.playersHeading.textContent = `Players (${this.players.length})`;
        Object.assign(this.playersHeading.style, { fontSize: '24px', marginBottom: '20px' });
        box.appendChild(this.playersHeading);

        this.playersList = document.createElement('div');
        Object.assign(this.playersList.style, { marginBottom: '20px' });
        box.appendChild(this.playersList);
        this.renderPlayers();

        const buttonsRow = document.createElement('div');
        Object.assign(buttonsRow.style, { display: 'flex', gap: '10px', justifyContent: 'center' });

        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start Game';
        this.applyStartButtonStyle();
        this.startButton.addEventListener('click', () => this.listener.onStartGame?.());
        buttonsRow.appendChild(this.startButton);

        const leaveBtn = document.createElement('button');
        leaveBtn.textContent = 'Leave Lobby';
        Object.assign(leaveBtn.style, {
            padding: '15px 30px', fontSize: '18px',
            backgroundColor: '#f44336', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
            transition: 'background-color 0.3s',
        });
        leaveBtn.addEventListener('click', () => this.handleLeave());
        buttonsRow.appendChild(leaveBtn);

        box.appendChild(buttonsRow);
        panel.appendChild(box);
        return panel;
    }

    private renderPlayers(): void {
        if (!this.playersList || !this.playersHeading) return;

        this.playersHeading.textContent = `Players (${this.players.length})`;
        this.playersList.replaceChildren();

        for (const player of this.players) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                padding: '10px', marginBottom: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '5px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            });
            const name = document.createElement('span');
            name.textContent = player.name;
            row.appendChild(name);
            if (player.id === this.clientId) {
                const hostTag = document.createElement('span');
                hostTag.textContent = '(Host)';
                Object.assign(hostTag.style, { fontSize: '12px', opacity: '0.7' });
                row.appendChild(hostTag);
            }
            this.playersList.appendChild(row);
        }

        this.applyStartButtonStyle();
    }

    private applyStartButtonStyle(): void {
        if (!this.startButton) return;
        const enabled = this.players.length >= 1;
        this.startButton.disabled = !enabled;
        Object.assign(this.startButton.style, {
            padding: '15px 30px', fontSize: '18px',
            backgroundColor: enabled ? '#4CAF50' : '#666', color: 'white',
            border: 'none', borderRadius: '5px',
            cursor: enabled ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.3s',
        });
    }

    // --- Handlers ---

    private handleCreate(): void {
        if (!this.wsClient) {
            this.showError('Failed to connect to WebSocket Server');
            return;
        }
        const json = SESSION_REGISTRY[this.session];
        if (!json) {
            this.showError('No session selected (add a session file to app/assets/sessions/).');
            return;
        }
        this.clearError();
        // Tracks come from the session file; `track` stays in the protocol
        // for compatibility. Players choose from the session's cars.
        this.wsClient.send('req:lobby', 'create', {
            session: json.name,
            track: null,
            cars: json.cars,
        });
    }

    private handleLeave(): void {
        if (this.wsClient && this.lobbyId) {
            this.wsClient.send('req:lobby', 'leave', { lobbyId: this.lobbyId });
            // Reset the singleton — we're navigating away. Next route builds a fresh WS.
            WebSocketClient.resetInstance();
        }
        window.location.href = '/';
    }

    private showError(message: string): void {
        if (!this.errorBox) return;
        this.errorBox.textContent = message;
        this.errorBox.style.display = 'block';
    }

    private clearError(): void {
        if (!this.errorBox) return;
        this.errorBox.textContent = '';
        this.errorBox.style.display = 'none';
    }
}
