import path from 'path';
import type { TrackEntry, TrackFolder, TrackList } from './protocol';
import { registerTracks, TRACK_REGISTRY } from './game/tracks/registry';
import { SESSION_REGISTRY } from './game/sessions/registry';
import type { TrackJSON } from './game/tracks/types';
import { deleteKey, getText, listKeys, putJson } from './storage';

// The track files in S3 (storage.ts) for the Track API (the track editor):
// PUBLISHED (tracks/ — what the game races) and DRAFTS (tracks/drafts/).
// Publishing registers the track at once: new lobbies race it; running
// lobbies keep the Track they started with. Same file rules as the old
// dev-only Vite store.
const FILE_RE = /^[a-z0-9_]+\.json$/;
export const TRACK_PREFIXES: Record<TrackFolder, string> = {
    published: 'tracks/',
    drafts: 'tracks/drafts/',
};
const publishedNames = new Map<string, string>(); // published file → track name

type Failure = { status: number; error: string };

// Called by loadGameFiles with the published files (by key) it registered.
export function rememberTrackFiles(files: Record<string, unknown>): void {
    publishedNames.clear();
    for (const [key, raw] of Object.entries(files)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string') publishedNames.set(path.posix.basename(key), name);
    }
}

export async function listTracks(): Promise<TrackList> {
    const [drafts, published] = await Promise.all([list(TRACK_PREFIXES.drafts), list(TRACK_PREFIXES.published)]);
    return { drafts, published };
}

// The raw JSON text of one file.
export async function readTrack(folder: string, file: string): Promise<{ text: string } | Failure> {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    const text = await getText(target.key);
    return text === null ? { status: 404, error: 'File not found.' } : { text };
}

export async function saveTrack(folder: string, file: string, raw: unknown): Promise<Failure | null> {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    const name = (raw as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name) return { status: 400, error: 'Track JSON is missing "name".' };
    if (folder === 'published') {
        const other = [...publishedNames].find(([f, n]) => n === name && f !== file);
        if (other) return { status: 409, error: `Another published file (${other[0]}) already has the name "${name}".` };
    }
    await putJson(target.key, raw);
    if (folder === 'published') {
        const before = publishedNames.get(file);
        if (before && before !== name) delete TRACK_REGISTRY[before];
        registerTracks([raw as TrackJSON]);
        publishedNames.set(file, name);
    }
    return null;
}

// Drafts: always (a missing file is fine — already gone). Published: not
// while a session (shipped or saved) races it.
export async function deleteTrack(folder: string, file: string): Promise<Failure | null> {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    if (folder === 'published') {
        const name = publishedNames.get(file);
        if (name) {
            const users = Object.values(SESSION_REGISTRY).filter(s => s.stages.some(st => st.track === name)).map(s => s.name);
            if (users.length > 0) return { status: 409, error: `"${name}" is used by sessions: ${users.join(', ')}.` };
        }
    }
    await deleteKey(target.key);
    if (folder === 'published') {
        const name = publishedNames.get(file);
        if (name) delete TRACK_REGISTRY[name];
        publishedNames.delete(file);
    }
    return null;
}

// Validated S3 key, or an error.
function resolve(folder: string, file: string): { key: string } | Failure {
    if (folder !== 'drafts' && folder !== 'published') return { status: 400, error: 'folder must be "drafts" or "published".' };
    if (!FILE_RE.test(file)) return { status: 400, error: 'file must match [a-z0-9_]+.json.' };
    return { key: TRACK_PREFIXES[folder] + file };
}

// Track files under a prefix (not its subfolders); unreadable ones left out.
async function list(prefix: string): Promise<TrackEntry[]> {
    const files = (await listKeys(prefix)).map(key => key.slice(prefix.length)).filter(file => FILE_RE.test(file));
    const entries = await Promise.all(files.map(async (file): Promise<TrackEntry | null> => {
        try {
            const j = JSON.parse((await getText(prefix + file)) ?? '');
            if (typeof j?.name !== 'string') return null;
            return { file, name: j.name, displayName: typeof j.displayName === 'string' ? j.displayName : j.name };
        } catch {
            return null; // malformed file: leave it out of the list
        }
    }));
    return entries.filter((e): e is TrackEntry => e !== null);
}
