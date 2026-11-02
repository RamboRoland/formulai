import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiError, KartList, SessionDeleted, SessionEntry, SessionList, SessionSaved, TrackLayouts } from './protocol';
import { SESSION_REGISTRY } from './game/sessions/registry';
import { TRACK_REGISTRY, createTrack, trackRef } from './game/tracks/registry';
import { CAR_CLASSES } from './game/tracks/serialize';
import { deleteSession, isShipped, saveSession } from './sessionStore';

// Largest request body accepted (a session is a few KB).
const MAX_BODY = 1024 * 1024;

// The server's HTTP API (protocol/http.ts), on the same port as the
// WebSocket: the Session API (the lobby editor) + the track / kart lists.
// The Track API (the track editor): phase 9.
export function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // The App and the tools run on other origins (ports) — they may use the API.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Editor-Password');
    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    route(req, res).catch(err => send<ApiError>(res, 500, { error: err instanceof Error ? err.message : String(err) }));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
    const session = /^\/api\/sessions\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && path === '/api/sessions') {
        return send<SessionList>(res, 200, { sessions: Object.values(SESSION_REGISTRY).map(entry) });
    }
    if (session) {
        const name = decodeURIComponent(session[1]);
        if (req.method === 'GET') {
            const json = SESSION_REGISTRY[name];
            return json ? send<SessionEntry>(res, 200, entry(json)) : send<ApiError>(res, 404, { error: `No session "${name}".` });
        }
        if (req.method === 'PUT') {
            let body: unknown;
            try {
                body = JSON.parse(await readBody(req));
            } catch (err) {
                return send<ApiError>(res, 400, { error: err instanceof Error ? err.message : 'Not JSON.' });
            }
            const error = saveSession(name, body);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<SessionSaved>(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
            const error = deleteSession(name);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<SessionDeleted>(res, 200, { ok: true });
        }
    }
    if (req.method === 'GET' && path === '/api/tracks/layouts') {
        return send<TrackLayouts>(res, 200, { tracks: trackLayouts() });
    }
    if (req.method === 'GET' && path === '/api/karts') {
        return send<KartList>(res, 200, { karts: [...CAR_CLASSES] });
    }
    send<ApiError>(res, 404, { error: `No route ${req.method} ${path}.` });
}

const entry = (json: Omit<SessionEntry, 'shipped'>): SessionEntry => ({ ...json, shipped: isShipped(json.name) });

// Track + layout names for the lobby editor (no geometry): loop or
// one-way, expected lap times.
function trackLayouts(): TrackLayouts['tracks'] {
    return Object.values(TRACK_REGISTRY).map(json => ({
        name: json.name,
        displayName: json.displayName,
        layouts: (Array.isArray(json.layouts) ? json.layouts : []).map(layout => ({
            id: layout.id,
            name: layout.name,
            loop: createTrack(trackRef(json.name, layout.id))?.isLoop ?? false,
            expectedLapTimes: layout.expectedLapTimes ?? {},
        })),
    }));
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('Body too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function send<T>(res: ServerResponse, status: number, body: T): void {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
