import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import type { CarControls, Message, SessionDefinition } from '../protocol';
import { Lobby } from './Lobby';

// Max cars one agent may join with.
const MAX_CARS_PER_AGENT = 20;

type Connection = {
    id: string;
    ws: WebSocket;
    agent: { id: string; lobby: Lobby } | null;
    player: { id: string; lobby: Lobby } | null;
    watching: Lobby | null;
};

const newId = (bytes = 5): string => randomBytes(bytes).toString('hex');

// Steering -1..1 (anything else → 0); the rest as booleans.
function toCarControls(c: any): CarControls {
    const s = c?.steering;
    return {
        forward: Boolean(c?.forward),
        backward: Boolean(c?.backward),
        steering: typeof s === 'number' && Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0,
        brake: Boolean(c?.brake),
    };
}

// The `formulai` WebSocket protocol (protocol/): lobbies, agents, players.
// What a connection may do follows from what it joined: an agent drives its
// own cars, a player its one car, a viewer watches a lobby.
export class FormulaiServer {
    private readonly lobbies = new Map<string, Lobby>();
    private readonly connections = new Map<string, Connection>();

    public handleConnection(ws: WebSocket): void {
        const conn: Connection = { id: newId(), ws, agent: null, player: null, watching: null };
        this.connections.set(conn.id, conn);
        ws.on('message', raw => {
            let message: any;
            try {
                message = JSON.parse(String(raw));
            } catch {
                this.send(conn, { ns: 'evt:system', action: 'error', data: { reason: 'Not JSON.' } });
                return;
            }
            try {
                this.handle(conn, message);
            } catch (err) {
                console.error(`[formulai ${conn.id}]`, err);
                this.send(conn, { ns: 'evt:system', action: 'error', data: { reason: err instanceof Error ? err.message : String(err), ns: message?.ns, action: message?.action } });
            }
        });
        ws.on('close', () => {
            this.leaveAll(conn);
            this.connections.delete(conn.id);
        });
        this.send(conn, { ns: 'evt:system', action: 'welcome', data: { clientId: conn.id } });
    }

    private handle(conn: Connection, m: { ns?: string; action?: string; data?: any }): void {
        const d = m.data ?? {};
        switch (`${m.ns}/${m.action}`) {
            // ---- lobby
            case 'req:lobby/list':
                this.send(conn, { ns: 'res:lobby', action: 'list', data: { lobbies: [...this.lobbies.values()].map(l => l.summary()) } });
                return;
            case 'req:lobby/create':
                this.createLobby(conn, d.session);
                return;

            // ---- agent
            case 'req:agent/join':
                this.agentJoin(conn, d);
                return;
            case 'req:agent/leave':
                if (conn.agent) conn.agent.lobby.leave(conn.agent.id);
                conn.agent = null;
                return;
            case 'req:agent/controls':
                if (!conn.agent || !Array.isArray(d.cars)) return;
                for (const car of d.cars) conn.agent.lobby.setControls(conn.agent.id, String(car?.carId), toCarControls(car));
                return;
            case 'req:agent/restart':
                // Only the listed cars that are this agent's own.
                if (conn.agent && Array.isArray(d.carIds)) conn.agent.lobby.restart(conn.agent.id, d.carIds.map(String));
                return;
            case 'req:agent/nextStage':
                if (!conn.agent || typeof d.completed !== 'boolean') {
                    this.error(conn, m, 'nextStage needs { completed: true | false } and a joined lobby.');
                    return;
                }
                conn.agent.lobby.nextStage(d.completed);
                return;
            case 'req:agent/rejoin':
                this.error(conn, m, 'Rejoin comes in phase 4.');
                return;

            // ---- view (the App watching a lobby)
            case 'req:view/watch': {
                const lobby = this.lobbies.get(String(d.lobbyId));
                if (!lobby) {
                    this.send(conn, { ns: 'res:view', action: 'watchError', data: { reason: `No lobby "${d.lobbyId}".` } });
                    return;
                }
                conn.watching?.unwatch(conn.id);
                conn.watching = lobby;
                const follow = d.follow && typeof d.follow.client === 'string' ? { client: d.follow.client }
                    : d.follow && typeof d.follow.stage === 'number' ? { stage: d.follow.stage } : null;
                lobby.watch(conn.id, follow, message => this.send(conn, message));
                return;
            }
            case 'req:view/stop':
                conn.watching?.unwatch(conn.id);
                conn.watching = null;
                return;

            // ---- player (the App's keyboard car)
            case 'req:player/join':
                this.playerJoin(conn, d);
                return;
            case 'req:player/leave':
                if (conn.player) conn.player.lobby.leave(conn.player.id);
                conn.player = null;
                return;
            case 'req:player/controls':
                if (!conn.player) return;
                for (const carId of conn.player.lobby.ownCarIds(conn.player.id)) {
                    conn.player.lobby.setControls(conn.player.id, carId, toCarControls(d));
                }
                return;
            case 'req:player/restart':
                // The player's own car only.
                if (conn.player) conn.player.lobby.restart(conn.player.id, conn.player.lobby.ownCarIds(conn.player.id));
                return;
        }
        this.error(conn, m, `Unknown message ${m.ns}/${m.action}.`);
    }

    private createLobby(conn: Connection, session: string | SessionDefinition): void {
        if (typeof session !== 'string') {
            // A full session definition: the Session API (phase 5).
            this.send(conn, { ns: 'res:lobby', action: 'createError', data: { reason: 'Only session names for now (full sessions: phase 5).' } });
            return;
        }
        let id = newId(3).toUpperCase();
        while (this.lobbies.has(id)) id = newId(3).toUpperCase();
        try {
            this.lobbies.set(id, new Lobby(id, session));
        } catch (err) {
            this.send(conn, { ns: 'res:lobby', action: 'createError', data: { reason: err instanceof Error ? err.message : String(err) } });
            return;
        }
        this.send(conn, { ns: 'res:lobby', action: 'create', data: { lobbyId: id } });
    }

    private agentJoin(conn: Connection, d: any): void {
        const fail = (reason: string) => this.send(conn, { ns: 'res:agent', action: 'joinError', data: { reason } });
        if (conn.agent) return fail('This connection is already an agent in a lobby (leave first).');
        const lobby = this.lobbies.get(String(d.lobbyId));
        if (!lobby) return fail(`No lobby "${d.lobbyId}".`);
        if (!Array.isArray(d.cars) || d.cars.length === 0) return fail('Join with cars: [{ name, kart }].');
        if (d.cars.length > MAX_CARS_PER_AGENT) return fail(`At most ${MAX_CARS_PER_AGENT} cars per agent.`);
        const agentId = newId();
        const token = newId(16);
        const cars = d.cars.map((c: any, i: number) => ({
            carId: `${agentId}-${i + 1}`,
            name: typeof c?.name === 'string' && c.name ? c.name : `Car ${i + 1}`,
            kart: String(c?.kart),
        }));
        // Messages for this agent only while this connection still is it.
        const send = (message: Message) => { if (conn.agent?.id === agentId) this.send(conn, message); };
        conn.agent = { id: agentId, lobby };
        const error = lobby.join({ id: agentId, kind: 'agent', token, send }, cars);
        if (error) {
            conn.agent = null;
            return fail(error.reason);
        }
        this.send(conn, { ns: 'res:agent', action: 'join', data: { agentId, token, cars } });
        this.send(conn, { ns: 'evt:agent', action: 'start', data: { stage: lobby.stageInfo() } });
    }

    private playerJoin(conn: Connection, d: any): void {
        const fail = (reason: string) => this.send(conn, { ns: 'res:player', action: 'joinError', data: { reason } });
        if (conn.player) return fail('This connection already drives a car (leave first).');
        const lobby = this.lobbies.get(String(d.lobbyId));
        if (!lobby) return fail(`No lobby "${d.lobbyId}".`);
        const playerId = newId();
        const carId = `${playerId}-1`;
        const name = typeof d.name === 'string' && d.name ? d.name : 'Player';
        const send = (message: Message) => { if (conn.player?.id === playerId) this.send(conn, message); };
        conn.player = { id: playerId, lobby };
        const error = lobby.join({ id: playerId, kind: 'player', send }, [{ carId, name, kart: String(d.kart) }]);
        if (error) {
            conn.player = null;
            return fail(error.reason);
        }
        this.send(conn, { ns: 'res:player', action: 'join', data: { playerId, carId } });
    }

    private leaveAll(conn: Connection): void {
        if (conn.agent) conn.agent.lobby.leave(conn.agent.id);
        if (conn.player) conn.player.lobby.leave(conn.player.id);
        conn.watching?.unwatch(conn.id);
        conn.agent = null;
        conn.player = null;
        conn.watching = null;
    }

    private error(conn: Connection, m: { ns?: string; action?: string }, reason: string): void {
        this.send(conn, { ns: 'evt:system', action: 'error', data: { reason, ns: m.ns, action: m.action } });
    }

    private send(conn: Connection, message: Message): void {
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(message));
    }
}
