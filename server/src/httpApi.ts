import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiError, KartList, SessionList } from './protocol';
import { SESSION_REGISTRY } from './game/sessions/registry';
import { CAR_CLASSES } from './game/tracks/serialize';

// The server's HTTP API (protocol/http.ts), on the same port as the
// WebSocket. Read-only for now: the session list (the App's temporary
// "Create lobby", later the lobby editor) and the kart classes. Saving /
// deleting sessions: phase 5; the Track API: phase 9.
export function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // The App runs on another origin (port) — it may read the API.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
    if (req.method === 'GET' && path === '/api/sessions') {
        return send<SessionList>(res, 200, { sessions: Object.values(SESSION_REGISTRY) });
    }
    if (req.method === 'GET' && path === '/api/karts') {
        return send<KartList>(res, 200, { karts: [...CAR_CLASSES] });
    }
    send<ApiError>(res, 404, { error: `No route ${req.method} ${path}.` });
}

function send<T>(res: ServerResponse, status: number, body: T): void {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
