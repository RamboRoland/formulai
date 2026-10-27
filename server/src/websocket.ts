import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type {
    ClientType,
    GameState,
    LobbyPlayer,
    MessageEnvelope,
    Namespace,
    PayloadOf,
} from './types';

type Client = {
    ws: WebSocket;
    gameState?: GameState;
    type: ClientType;
    lobbyId?: string;
};

type Lobby = {
    id: string;
    hostId: string;
    players: LobbyPlayer[];
    // actorId → the WS connection id that owns it. Lets us route broadcasts
    // and clean up on disconnect even when one connection owns N actors
    // (multi-actor AIs).
    actorConnections: Map<string, string>;
    gameStarted: boolean;
    // Host sent game/completed. A completed lobby never reopens for joins.
    gameCompleted: boolean;
    session: string;
    track: string | null;
    cars: string[];
};

export class RacingGameServer {
    private wss: WSServer;
    private clients: Map<string, Client> = new Map();
    private lobbies: Map<string, Lobby> = new Map();
    private gameStatePollingInterval: NodeJS.Timeout | null = null;

    // Command handlers are keyed by domain after the "req:" prefix.
    private commandHandlers: Record<string, Record<string, (clientId: string, data: any) => void>> = {
        game: {
            state: this.handleGameState.bind(this),
            stateBatch: this.handleGameStateBatch.bind(this),
            requestPlayerState: this.handleRequestPlayerGameState.bind(this),
            playerState: this.handlePlayerGameState.bind(this),
            start: this.handleStartGame.bind(this),
            completed: this.handleGameCompleted.bind(this),
            restarted: this.handleGameRestarted.bind(this),
        },
        control: {
            send: this.handleControls.bind(this),
            sendBatch: this.handleControlsBatch.bind(this),
            setTrack: this.handleTrack.bind(this),
            startStage: this.handleStartStage.bind(this),
            nextStage: this.handleNextStage.bind(this),
            restart: this.handleRestart.bind(this),
        },
        lobby: {
            create: this.handleCreateLobby.bind(this),
            join: this.handleJoinLobby.bind(this),
            leave: this.handleLeaveLobby.bind(this),
            list: this.handleListLobbies.bind(this),
        }
    };

    constructor(port: number) {
        this.wss = new WSServer({
            port,
            // Accept game, control, and multiplayer subprotocols
            handleProtocols: (protocols: Set<string>, request: any) => {
                const protocol = Array.from(protocols)[0];
                return protocol === 'game' || protocol === 'control' || protocol === 'multiplayer' ? protocol : 'multiplayer';
            }
        });
        this.setupWebSocketServer();
        console.log(`WebSocket server started on port ${port}`);
    }

    private setupWebSocketServer() {
        this.wss.on('connection', (ws: WebSocket, request) => {
            const clientId = this.generateClientId();
            const protocol = ws.protocol || 'multiplayer';
            const clientType: ClientType = (protocol === 'game' || protocol === 'control') ? protocol : 'multiplayer';

            console.log('New connection:', {
                clientId,
                protocol: ws.protocol,
                readyState: ws.readyState,
                url: request.url
            });

            this.clients.set(clientId, { ws, type: clientType });
            console.log(`Client ${clientId} connected as ${clientType}`);

            ws.on('message', (data: string) => {
                console.log(`[${clientId}] Received message:`, data.toString());
                this.handleMessage(clientId, JSON.parse(data));
            });

            ws.on('close', (code: number, reason: string) => {
                console.log(`Client ${clientId} disconnected:`, {
                    code,
                    reason: reason.toString(),
                    remainingClients: this.clients.size - 1
                });

                // Handle player leaving lobby
                const client = this.clients.get(clientId);
                if (client && client.lobbyId) {
                    this.handleLeaveLobby(clientId, { lobbyId: client.lobbyId });
                }

                this.clients.delete(clientId);
            });

            ws.on('error', (error: Error) => {
                console.error(`Client ${clientId} error:`, error);
            });

            // Send a welcome message
            this.sendEvent(clientId, 'evt:system', 'welcome', { clientId, clientType });
        });

        this.wss.on('error', (error: Error) => {
            console.error('WebSocket server error:', error);
        });

        this.wss.on('listening', () => {
            console.log('WebSocket server is listening');
        });
    }

    private handleMessage(clientId: string, message: MessageEnvelope) {
        const { ns, action, data } = message;
        const client = this.clients.get(clientId);

        if (!client) return;

        if (!ns || !action) {
            console.log(`[${clientId}] Invalid message (missing ns/action):`, message);
            return;
        }

        const [dir, domain] = ns.split(':');
        if (dir !== 'req') {
            console.log(`[${clientId}] Ignoring non-request message ns=${ns}`);
            return;
        }

        const handler = this.commandHandlers[domain]?.[action];
        if (!handler) {
            console.log(`[${clientId}] Unknown command ns=${ns} action=${action}`);
            return;
        }

        handler(clientId, data);
    }

    // --- Command handlers (client -> server) ---

    // Per-requester game-state RPC. Same (ns, action) is used for both
    // directions; sender client type disambiguates:
    //   - from 'control'/'multiplayer': "AI asks for state for clientId"
    //       → forward to host as req:game/state { clientId }
    //   - from 'game': "host publishes state for clientId"
    //       → route res:game/state <gameState> to the specific requester
    //         (the client whose connection id matches the echoed clientId)
    private handleGameState(clientId: string, data: PayloadOf<'req:game', 'state'>) {
        const client = this.clients.get(clientId);
        if (!client || !data) return;

        if (client.type === 'control' || client.type === 'multiplayer') {
            const gameClient = this.getFirstClientByType('game');
            if (!gameClient) {
                console.log(`[${clientId}] req:game/state: no host connected`);
                return;
            }
            this.sendEvent(gameClient, 'req:game', 'state', { clientId: data.clientId });
            return;
        }

        if (client.type === 'game') {
            if (!('gameState' in data)) {
                console.log(`[${clientId}] req:game/state response missing gameState`);
                return;
            }
            const requesterId = data.clientId;
            if (!this.clients.has(requesterId)) {
                console.log(`req:game/state: requester ${requesterId} no longer connected`);
                return;
            }
            this.sendEvent(requesterId, 'res:game', 'state', data.gameState);
        }
    }

    private handleRequestPlayerGameState(clientId: string, data: PayloadOf<'req:game', 'requestPlayerState'>) {
        const lobbyId = data.lobbyId;
        const client = this.clients.get(clientId);
        if (!client || !client.lobbyId) return;

        if (!client || client.type !== 'multiplayer') {
            console.log(`[${clientId}] requestPlayerState ignored (not multiplayer)`);
            return;
        }

        const lobby = this.lobbies.get(client.lobbyId);
        if (!lobby || !lobby.gameStarted) return;

        this.sendEvent(lobby.hostId, 'req:game', 'playerState', { lobbyId, playerId: clientId });
    }

    private handlePlayerGameState(clientId: string, data: PayloadOf<'req:game', 'playerState'>) {
        const client = this.clients.get(clientId);
        if (!client || !client.lobbyId) return;

        if (!client || client.type !== 'game') {
            console.log(`[${clientId}] playerState ignored (not game)`);
            return;
        }

        // Only the host-response variant is expected here; guard the union.
        if (!('gameState' in data)) return;

        const lobby = this.lobbies.get(client.lobbyId);
        if (!lobby || !lobby.gameStarted) return;

        this.sendEvent(data.playerId, 'res:game', 'playerState', { gameState: data.gameState });
    }

    // Batch state RPC for multi-actor AIs. One AI connection, many actors.
    // AI → server: { clientIds }
    // server → host: { requesterId, clientIds }  (echoed back by host)
    // host → server: { requesterId, states }
    // server → AI (requester only): res:game/stateBatch { states }
    private handleGameStateBatch(clientId: string, data: PayloadOf<'req:game', 'stateBatch'>) {
        const client = this.clients.get(clientId);
        if (!client || !data) return;

        if (client.type === 'control' || client.type === 'multiplayer') {
            if (!('clientIds' in data)) return;
            const gameClient = this.getFirstClientByType('game');
            if (!gameClient) {
                console.log(`[${clientId}] req:game/stateBatch: no host connected`);
                return;
            }
            this.sendEvent(gameClient, 'req:game', 'stateBatch', {
                requesterId: clientId,
                clientIds: data.clientIds,
            });
            return;
        }

        if (client.type === 'game') {
            if (!('states' in data)) {
                console.log(`[${clientId}] req:game/stateBatch response missing states`);
                return;
            }
            const requesterId = data.requesterId;
            if (!this.clients.has(requesterId)) {
                console.log(`req:game/stateBatch: requester ${requesterId} no longer connected`);
                return;
            }
            this.sendEvent(requesterId, 'res:game', 'stateBatch', { states: data.states });
        }
    }

    // Batch controls for multi-actor AIs. One message updates N actors.
    private handleControlsBatch(clientId: string, data: PayloadOf<'req:control', 'sendBatch'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] controls batch ignored (not control)`);
            return;
        }
        const gameClient = this.getFirstClientByType('game');
        if (!gameClient) {
            console.log(`[${clientId}] No game client available to receive batch controls`);
            return;
        }
        this.sendEvent(gameClient, 'evt:control', 'updateBatch', { items: data.items });
    }

    private handleControls(clientId: string, data: PayloadOf<'req:control', 'send'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] controls ignored (not control)`);
            return;
        }

        const gameClient = this.getFirstClientByType('game');
        if (gameClient) {
            this.sendEvent(gameClient, 'evt:control', 'update', data);
        } else {
            console.log(`[${clientId}] No game client available to receive controls`);
        }
    }

    private handleTrack(clientId: string, data: PayloadOf<'req:control', 'setTrack'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] track ignored (not control)`);
            return;
        }

        const gameClient = this.getFirstClientByType('game');
        if (gameClient) {
            this.sendEvent(gameClient, 'evt:control', 'setTrack', data);
        } else {
            console.log(`[${clientId}] No game client available to receive controls`);
        }
    }

    private handleStartStage(clientId: string) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] startStage ignored (not control)`);
            return;
        }

        const gameClient = this.getFirstClientByType('game');
        if (gameClient) {
            this.sendEvent(gameClient, 'evt:game', 'startStage');
        } else {
            console.log(`[${clientId}] No game client available to receive startStage`);
        }
    }

    private handleNextStage(clientId: string, data: PayloadOf<'req:control', 'nextStage'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] nextStage ignored (not control)`);
            return;
        }
        if (typeof data?.completed !== 'boolean') {
            console.log(`[${clientId}] nextStage ignored (data.completed must be true or false)`);
            return;
        }

        const gameClient = this.getFirstClientByType('game');
        if (gameClient) {
            this.sendEvent(gameClient, 'evt:game', 'nextStage', { completed: data.completed });
        } else {
            console.log(`[${clientId}] No game client available to receive nextStage`);
        }
    }

    // A lobby client restarts the current stage for every car in its lobby
    // (multiplayer). Sent to that lobby's host only; the host answers with
    // req:game/restarted → evt:game/restarted to the lobby.
    private handleRestart(clientId: string) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'control') {
            console.log(`[${clientId}] restart ignored (not control)`);
            return;
        }
        const lobby = client.lobbyId ? this.lobbies.get(client.lobbyId) : undefined;
        if (!lobby) {
            console.log(`[${clientId}] restart ignored (not in a lobby)`);
            return;
        }
        this.sendEvent(lobby.hostId, 'evt:game', 'restart');
        console.log(`[${clientId}] restart → host of lobby ${lobby.id}`);
    }

    private handleCreateLobby(clientId: string, data: PayloadOf<'req:lobby', 'create'>) {
        const hostId = clientId;
        const session = data.session;
        const track = data.track;
        const cars = data.cars;

        const lobbyId = this.generateLobbyId();
        const lobby: Lobby = {
            id: lobbyId,
            hostId: hostId,
            gameStarted: false,
            gameCompleted: false,
            players: [],
            actorConnections: new Map(),
            session,
            track,
            cars,
        };

        this.lobbies.set(lobbyId, lobby);

        const client = this.clients.get(clientId);
        if (client) {
            client.lobbyId = lobbyId;
        }

        this.sendEvent(clientId, 'res:lobby', 'create', { lobbyId, players: lobby.players, session, track, cars });

        console.log(`Lobby ${lobbyId} created by ${hostId}`);
    }

    private handleJoinLobby(clientId: string, data: PayloadOf<'req:lobby', 'join'>) {
        const lobbyId = data.lobbyId || this.getExistingLobby()?.id;
        const playerName = data.playerName;
        const playerCar = data.playerCar;
        // actorId defaults to sender's connection clientId; multi-actor AIs
        // can override to register several distinct actors from one connection.
        const actorId = data.actorId ?? clientId;
        const lobby = lobbyId ? this.lobbies.get(lobbyId) : undefined;

        if (!lobby || !lobbyId) {
            this.sendEvent(clientId, 'res:lobby', 'joinError', { error: 'Lobby not found' });
            return;
        }

        if (lobby.gameStarted) {
            this.sendEvent(clientId, 'res:lobby', 'joinError', { error: 'Game has already started' });
            return;
        }

        lobby.players.push({ id: actorId, name: playerName, car: playerCar });
        lobby.actorConnections.set(actorId, clientId);

        const client = this.clients.get(clientId);
        if (client) {
            client.lobbyId = lobbyId;
        } else {
            this.sendEvent(clientId, 'res:lobby', 'joinError', { error: 'Client not found' });
            return;
        }

        this.sendEvent(clientId, 'res:lobby', 'join', {
            lobbyId: lobbyId,
            gameStarted: lobby.gameStarted,
            players: lobby.players,
            session: lobby.session,
            track: lobby.track,
            cars: lobby.cars
        });

        this.sendEvent(lobby.hostId, 'evt:lobby', 'playerJoined', { lobbyId, player: { id: actorId, name: playerName, car: playerCar }});

        // Notify all other players in the lobby
        this.broadcastToLobby(lobbyId, [lobby.hostId, clientId], 'evt:lobby', 'playerJoined', { lobbyId, player: { id: actorId, name: playerName, car: playerCar }});

        console.log(`Player ${actorId} (conn ${clientId}) joined lobby ${lobbyId}`);
    }

    private handleLeaveLobby(clientId: string, data: PayloadOf<'req:lobby', 'leave'>) {
        const lobbyId = data.lobbyId;
        const lobby = this.lobbies.get(lobbyId);

        if (!lobby) {
            this.sendEvent(clientId, 'res:lobby', 'error', { error: 'Lobby not found' });
            return;
        }

        // Decide which actors leave:
        //   - with data.actorId: just that one (single-actor leave).
        //   - without:          all actors owned by this connection
        //                       (fleet leave / normal disconnect).
        let actorsToRemove: string[];
        if (data.actorId) {
            // Validate: the specified actor must belong to this connection.
            if (lobby.actorConnections.get(data.actorId) !== clientId) {
                this.sendEvent(clientId, 'res:lobby', 'error', {
                    error: `Actor ${data.actorId} not owned by this connection`,
                });
                return;
            }
            actorsToRemove = [data.actorId];
        } else {
            actorsToRemove = [];
            for (const [actorId, connId] of lobby.actorConnections) {
                if (connId === clientId) actorsToRemove.push(actorId);
            }
        }

        for (const actorId of actorsToRemove) {
            lobby.players = lobby.players.filter(p => p.id !== actorId);
            lobby.actorConnections.delete(actorId);

            // Host + remaining connections learn an actor dropped.
            this.sendEvent(lobby.hostId, 'evt:lobby', 'playerLeft', {
                lobbyId, player: { id: actorId },
            });
            this.broadcastToLobby(lobbyId, [lobby.hostId, clientId], 'evt:lobby', 'playerLeft', {
                lobbyId, player: { id: actorId },
            });
        }

        // Connection fully left → clear its lobbyId.
        if (!data.actorId) {
            const client = this.clients.get(clientId);
            if (client) client.lobbyId = undefined;
        }

        console.log(`Connection ${clientId} removed ${actorsToRemove.length} actor(s) from lobby ${lobbyId}`);

        // Running game, everyone gone → open the lobby for joins again. The
        // host shows a waiting view and restarts the session (req:game/start)
        // once players are back. Not after the session completed.
        if (lobby.gameStarted && !lobby.gameCompleted && lobby.players.length === 0) {
            lobby.gameStarted = false;
            console.log(`Lobby ${lobbyId} is empty — open for rejoining`);
        }
    }

    // Discovery: AI client asks for the list of currently-open lobbies.
    // Response is sent only to the requester with a public-fields projection.
    // Completed lobbies are left out (they never accept joins again).
    private handleListLobbies(clientId: string) {
        const lobbies = Array.from(this.lobbies.values()).filter(l => !l.gameCompleted).map(l => ({
            lobbyId: l.id,
            session: l.session,
            track: l.track,
            cars: l.cars,
            players: l.players,
            gameStarted: l.gameStarted,
        }));
        this.sendEvent(clientId, 'res:lobby', 'list', { lobbies });
    }

    // Host signals the game is done. Server broadcasts evt:game/completed to
    // the whole lobby (including the host) so AIs can stop their loops and
    // clean up accordingly.
    private handleGameCompleted(clientId: string, data: PayloadOf<'req:game', 'completed'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'game') {
            console.log(`[${clientId}] game/completed ignored (not game)`);
            return;
        }
        const lobbyId = data.lobbyId;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;
        if (lobby.hostId !== clientId) {
            this.sendEvent(clientId, 'res:lobby', 'error', {
                message: 'Only the host can mark the game completed',
            });
            return;
        }

        lobby.gameCompleted = true;
        this.sendEvent(lobby.hostId, 'evt:game', 'completed', { lobbyId });
        this.broadcastToLobby(lobbyId, [lobby.hostId], 'evt:game', 'completed', { lobbyId });
        console.log(`Game completed in lobby ${lobbyId}`);
    }

    // Host signals a restart is applied (every car reset, the next tick has
    // run). Server broadcasts evt:game/restarted to each player connection in
    // the lobby (not the host) so AIs know the game state is ready to fetch.
    private handleGameRestarted(clientId: string, data: PayloadOf<'req:game', 'restarted'>) {
        const client = this.clients.get(clientId);
        if (!client || client.type !== 'game') {
            console.log(`[${clientId}] game/restarted ignored (not game)`);
            return;
        }
        const lobbyId = data?.lobbyId;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;
        if (lobby.hostId !== clientId) {
            this.sendEvent(clientId, 'res:lobby', 'error', {
                message: 'Only the host can announce a restart',
            });
            return;
        }

        this.broadcastToLobby(lobbyId, [lobby.hostId], 'evt:game', 'restarted', { lobbyId });
        console.log(`Restart applied in lobby ${lobbyId}`);
    }

    private handleStartGame(clientId: string, data: PayloadOf<'req:game', 'start'>) {
        const client = this.clients.get(clientId);
        if (!client) return;

        if (!client || client.type !== 'game') {
            console.log(`[${clientId}] playerState ignored (not game)`);
            return;
        }

        const lobbyId = data.lobbyId;
        const lobby = this.lobbies.get(lobbyId);

        if (!lobby) {
            return;
        }

        if (lobby.hostId !== clientId) {
            this.sendEvent(clientId, 'res:lobby', 'error', { message: 'Only the host can start the game' });
            return;
        }

        if (lobby.players.length < 1) {
            this.sendEvent(clientId, 'res:lobby', 'error', { message: 'Need at least 1 player to start' });
            return;
        }

        lobby.gameStarted = true;

        // Notify all players in the lobby
        this.broadcastToLobby(lobbyId, [clientId], 'evt:game', 'start', { lobbyId, players: lobby.players, session: lobby.session, track: lobby.track });

        console.log(`Game started in lobby ${lobbyId}`);
    }

    private broadcastToLobby<Ns extends Namespace, A extends string>(
        lobbyId: string,
        excludeConnectionIds: string[],
        ns: Ns,
        action: A,
        data?: PayloadOf<Ns, A>,
    ) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        // Translate actor ids → connection ids (one connection may own
        // multiple actors; it should only receive the broadcast once).
        const sentTo = new Set<string>();
        for (const player of lobby.players) {
            const connectionId = lobby.actorConnections.get(player.id);
            if (!connectionId) continue;
            if (sentTo.has(connectionId)) continue;
            if (excludeConnectionIds.includes(connectionId)) continue;
            sentTo.add(connectionId);
            this.sendEvent(connectionId, ns, action, data);
        }
    }

    private sendEvent<Ns extends Namespace, A extends string>(
        clientId: string,
        ns: Ns,
        action: A,
        data?: PayloadOf<Ns, A>,
    ) {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== WebSocket.OPEN) return;
        const message = { ns, action, data, v: 1 };
        client.ws.send(JSON.stringify(message));
    }

    private getFirstClientByType(type: Client['type']): string | undefined {
        const entry = Array.from(this.clients.entries()).find(([, c]) => c.type === type);
        return entry ? entry[0] : undefined;
    }

    private generateLobbyId(): string {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    private getExistingLobby(): Lobby | undefined {
        const iterator = this.lobbies.values().next();
        return iterator.done ? undefined : iterator.value;
    }

    private generateClientId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    public cleanup() {
        this.wss.close();
        this.clients.clear();
    }
}