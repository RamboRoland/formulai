import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizePath, type Plugin } from 'vite';

// Dev-only file store for the track editor. Lets the browser list, read and
// write track JSON files under app/assets/tracks/ (published) and
// app/assets/tracks/drafts/ (drafts). Never part of a build (`apply: 'serve'`).
//
//   GET  /__tracks                                  → { drafts, published }
//   GET  /__tracks/file?folder=<f>&file=<x>.json    → raw JSON
//   POST /__tracks/save?folder=<f>&file=<x>.json    → writes body
//   POST /__tracks/delete?folder=<f>&file=<x>.json  → removes the file
//
// `folder` is whitelisted and `file` must match FILE_RE, so nothing can be
// written outside the two folders.

const ROUTE = '/__tracks';
const FILE_RE = /^[a-z0-9_]+\.json$/;
const MAX_BODY = 5 * 1024 * 1024;

type Folder = 'drafts' | 'published';
type Entry = { file: string; name: string; displayName: string };

export function trackStore(): Plugin {
    let root = '';
    const dirs = (): Record<Folder, string> => ({
        drafts: path.join(root, 'app/assets/tracks/drafts'),
        published: path.join(root, 'app/assets/tracks'),
    });

    const isTrackFile = (file: string): boolean =>
        normalizePath(file).startsWith(normalizePath(dirs().published) + '/');

    return {
        name: 'formulai-track-store',
        apply: 'serve',
        // Run before other plugins so they see no modules for track files.
        enforce: 'pre',
        configResolved(config) {
            root = config.root;
        },
        // Published tracks are glob-imported by the registry, so rewriting
        // one would full-reload every open page (the editor loses the
        // track). Skip the HMR update; Vite still invalidates the module, so
        // the game picks up the change on a manual reload. (Tailwind's
        // scanning of these files is turned off in app.css.)
        hotUpdate({ file }) {
            if (isTrackFile(file)) return [];
        },
        configureServer(server) {
            server.middlewares.use(ROUTE, (req, res) => {
                handle(req, res, dirs()).catch(err => {
                    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
                });
            });
        },
    };
}

async function handle(req: IncomingMessage, res: ServerResponse, dirs: Record<Folder, string>): Promise<void> {
    // Connect strips the mount path, so req.url is e.g. "/file?folder=..."
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && route === '/') {
        send(res, 200, { drafts: await list(dirs.drafts), published: await list(dirs.published) });
        return;
    }

    const resolved = resolveTarget(url, dirs);
    if ('error' in resolved) {
        send(res, 400, { error: resolved.error });
        return;
    }
    const target = resolved.path;

    if (req.method === 'GET' && route === '/file') {
        try {
            const text = await fs.readFile(target, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
        } catch {
            send(res, 404, { error: 'File not found.' });
        }
        return;
    }

    if (req.method === 'POST' && route === '/save') {
        const body = await readBody(req);
        let json: unknown;
        try {
            json = JSON.parse(body);
        } catch {
            send(res, 400, { error: 'Body is not valid JSON.' });
            return;
        }
        const name = (json as { name?: unknown } | null)?.name;
        if (typeof name !== 'string' || !name) {
            send(res, 400, { error: 'Track JSON is missing "name".' });
            return;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, JSON.stringify(json, null, 2) + '\n', 'utf8');
        send(res, 200, { ok: true });
        return;
    }

    // Deleting a file that doesn't exist is fine (already gone).
    if (req.method === 'POST' && route === '/delete') {
        await fs.rm(target, { force: true });
        send(res, 200, { ok: true });
        return;
    }

    send(res, 404, { error: 'Unknown route.' });
}

// Validated absolute path, or an error message.
function resolveTarget(url: URL, dirs: Record<Folder, string>): { path: string } | { error: string } {
    const folder = url.searchParams.get('folder');
    const file = url.searchParams.get('file') ?? '';
    if (folder !== 'drafts' && folder !== 'published') return { error: 'folder must be "drafts" or "published".' };
    if (!FILE_RE.test(file)) return { error: 'file must match [a-z0-9_]+.json.' };
    return { path: path.join(dirs[folder], file) };
}

// Track files in a folder (non-recursive). Unreadable files are skipped.
async function list(dir: string): Promise<Entry[]> {
    let names: string[];
    try {
        names = await fs.readdir(dir);
    } catch {
        return [];
    }
    const entries: Entry[] = [];
    for (const file of names.filter(n => FILE_RE.test(n)).sort()) {
        try {
            const j = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
            if (typeof j?.name !== 'string') continue;
            entries.push({ file, name: j.name, displayName: typeof j.displayName === 'string' ? j.displayName : j.name });
        } catch {
            // malformed file: leave it out of the list
        }
    }
    return entries;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new Error('Body too large.'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function send(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}
