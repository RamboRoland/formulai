import { config } from '~/config';
import { SUBPROTOCOL, type ApiError, type Message, type SessionDefinition } from '~/protocol';

// Small helpers for the game server's HTTP API (config.apiUrl) and for
// creating a lobby (a one-off WebSocket request), used by the session
// editor and the create-lobby page.

export async function apiGet<T>(path: string): Promise<T> {
    return json<T>(await fetch(`${config.apiUrl}${path}`));
}

export async function apiSend<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return json<T>(await fetch(`${config.apiUrl}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }));
}

async function json<T>(res: Response): Promise<T> {
    const body = await res.json();
    if (!res.ok) throw new Error((body as ApiError).error ?? `HTTP ${res.status}`);
    return body as T;
}

// A new lobby on the server with this session — a session's name, or a
// whole session (saved or not). `fast`: fast training (lockstep, agents
// only). Resolves the lobby id; rejects with the server's reason.
export function createLobby(session: string | SessionDefinition, fast = false): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(config.wsUrl, SUBPROTOCOL);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ ns: 'req:lobby', action: 'create', data: { session, ...(fast ? { fast } : {}) } })));
        ws.addEventListener('message', event => {
            const m = JSON.parse(String(event.data)) as Message;
            if (m.ns !== 'res:lobby') return;
            ws.close();
            if (m.action === 'create') resolve(m.data.lobbyId);
            else if (m.action === 'createError') reject(new Error(m.data.reason));
        });
        ws.addEventListener('error', () => reject(new Error(`can't reach ${config.wsUrl}`)));
    });
}
