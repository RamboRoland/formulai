import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiError, BackgroundDeleted, BackgroundList, BackgroundSaved, KartList, Pong, SessionDeleted, SessionEntry, SessionList, SessionSaved, TrackDeleted, TrackLayouts, TrackList, TrackSaved } from './protocol';
import { EDITOR_PASSWORD_HEADER } from './protocol';
import { config } from './config';
import { deleteTrack, listTracks, readTrack, saveTrack } from './trackStore';
import { SESSION_REGISTRY } from './game/sessions/registry';
import { TRACK_REGISTRY, createTrack, trackRef } from './game/tracks/registry';
import { CAR_CLASSES } from './game/tracks/serialize';
import { deleteSession, saveSession } from './sessionStore';
import { deleteBackground, listBackgrounds, MAX_BACKGROUND_BYTES, readBackground, saveBackground } from './backgroundStore';

// Largest request body accepted (a track file is a few hundred KB); a
// background upload: MAX_BACKGROUND_BYTES.
const MAX_BODY = 5 * 1024 * 1024;

class BodyTooLarge extends Error {}

// The server's HTTP API (protocol/http.ts), on the same port as the
// WebSocket: the Session API (the lobby editor), the Track API and the
// Background API (the track editor, behind the editor password) + the
// track / kart lists.
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
    // Latency check: answers at once, no work (curl -w "%{time_total}").
    if (req.method === 'GET' && path === '/api/ping') {
        return send<Pong>(res, 200, { ok: true });
    }
    const session = /^\/api\/sessions\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && path === '/api/sessions') {
        return send<SessionList>(res, 200, { sessions: Object.values(SESSION_REGISTRY) });
    }
    if (session) {
        const name = decodeURIComponent(session[1]);
        if (req.method === 'GET') {
            const json = SESSION_REGISTRY[name];
            return json ? send<SessionEntry>(res, 200, json) : send<ApiError>(res, 404, { error: `No session "${name}".` });
        }
        if (req.method === 'PUT') {
            let body: unknown;
            try {
                body = JSON.parse(await readBody(req));
            } catch (err) {
                return send<ApiError>(res, 400, { error: err instanceof Error ? err.message : 'Not JSON.' });
            }
            const error = await saveSession(name, body);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<SessionSaved>(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
            const error = await deleteSession(name);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<SessionDeleted>(res, 200, { ok: true });
        }
    }
    if (req.method === 'GET' && path === '/api/tracks/layouts') {
        return send<TrackLayouts>(res, 200, { tracks: trackLayouts() });
    }
    const track = /^\/api\/tracks\/([^/]+)\/([^/]+)$/.exec(path);
    if (path === '/api/tracks' || track) {
        // The Track API: off without a password; the right one on every call.
        const denied = passwordFailure(req);
        if (denied) return send<ApiError>(res, denied.status, { error: denied.error });
        if (!track) {
            if (req.method === 'GET') return send<TrackList>(res, 200, await listTracks());
        } else {
            const [folder, file] = [decodeURIComponent(track[1]), decodeURIComponent(track[2])];
            if (req.method === 'GET') {
                const read = await readTrack(folder, file);
                if ('error' in read) return send<ApiError>(res, read.status, { error: read.error });
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(read.text);
                return;
            }
            if (req.method === 'PUT') {
                let body: unknown;
                try {
                    body = JSON.parse(await readBody(req));
                } catch (err) {
                    return send<ApiError>(res, 400, { error: err instanceof Error ? err.message : 'Not JSON.' });
                }
                const error = await saveTrack(folder, file, body);
                return error ? send<ApiError>(res, error.status, { error: error.error }) : send<TrackSaved>(res, 200, { ok: true });
            }
            if (req.method === 'DELETE') {
                const error = await deleteTrack(folder, file);
                return error ? send<ApiError>(res, error.status, { error: error.error }) : send<TrackDeleted>(res, 200, { ok: true });
            }
        }
    }
    const background = /^\/api\/backgrounds\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && path === '/api/backgrounds') {
        return send<BackgroundList>(res, 200, { backgrounds: await listBackgrounds() });
    }
    if (background) {
        // Viewing is open (an <img src>); changing needs the password.
        const file = decodeURIComponent(background[1]);
        if (req.method === 'GET') {
            const read = await readBackground(file);
            if ('error' in read) return send<ApiError>(res, read.status, { error: read.error });
            res.writeHead(200, { 'Content-Type': read.contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(read.bytes);
            return;
        }
        if (req.method === 'PUT' || req.method === 'DELETE') {
            const denied = passwordFailure(req);
            if (denied) return send<ApiError>(res, denied.status, { error: denied.error });
        }
        if (req.method === 'PUT') {
            let body: Buffer;
            try {
                body = await readBodyBytes(req, MAX_BACKGROUND_BYTES);
            } catch (err) {
                if (err instanceof BodyTooLarge) return send<ApiError>(res, 413, { error: err.message });
                throw err;
            }
            const error = await saveBackground(file, body);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<BackgroundSaved>(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
            const error = await deleteBackground(file);
            return error ? send<ApiError>(res, error.status, { error: error.error }) : send<BackgroundDeleted>(res, 200, { ok: true });
        }
    }
    if (req.method === 'GET' && path === '/api/karts') {
        return send<KartList>(res, 200, { karts: [...CAR_CLASSES] });
    }
    send<ApiError>(res, 404, { error: `No route ${req.method} ${path}.` });
}

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

// The editor password check (Track API, background changes): off without
// a password on the server (503); wrong / missing → 401.
function passwordFailure(req: IncomingMessage): { status: number; error: string } | null {
    if (!config.editorPassword) return { status: 503, error: 'Track editing is off on this server (no EDITOR_PASSWORD).' };
    if (req.headers[EDITOR_PASSWORD_HEADER.toLowerCase()] !== config.editorPassword) return { status: 401, error: 'Wrong or missing editor password.' };
    return null;
}

async function readBody(req: IncomingMessage): Promise<string> {
    return (await readBodyBytes(req, MAX_BODY)).toString('utf8');
}

// The request body, at most `max` bytes (a larger declared Content-Length
// fails at once; a larger body stops the connection).
function readBodyBytes(req: IncomingMessage, max: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const tooLarge = () => new BodyTooLarge(`Body larger than ${Math.round(max / 1024 / 1024)} MB.`);
        if (Number(req.headers['content-length']) > max) {
            reject(tooLarge());
            return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > max) {
                reject(tooLarge());
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function send<T>(res: ServerResponse, status: number, body: T): void {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
