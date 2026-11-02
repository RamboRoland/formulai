import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { TrackEntry, TrackFolder, TrackList } from './protocol';
import { registerTracks, TRACK_REGISTRY } from './game/tracks/registry';
import { SESSION_REGISTRY } from './game/sessions/registry';
import type { TrackJSON } from './game/tracks/types';

// The track files on disk for the Track API (the track editor): PUBLISHED
// (config.tracksDir — what the game races) and DRAFTS (its drafts/
// folder). Publishing registers the track at once: new lobbies race it;
// running lobbies keep the Track they started with. Same file rules as the
// old dev-only Vite store.
const FILE_RE = /^[a-z0-9_]+\.json$/;
const dirs: Record<TrackFolder, string> = {
    published: config.tracksDir,
    drafts: path.join(config.tracksDir, 'drafts'),
};
const publishedNames = new Map<string, string>(); // published file → track name

type Failure = { status: number; error: string };

// Called by loadGameFiles with the published files it registered.
export function rememberTrackFiles(files: Record<string, unknown>): void {
    publishedNames.clear();
    for (const [file, raw] of Object.entries(files)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string') publishedNames.set(path.basename(file), name);
    }
}

export function listTracks(): TrackList {
    return { drafts: list(dirs.drafts), published: list(dirs.published) };
}

// The raw JSON text of one file.
export function readTrack(folder: string, file: string): { text: string } | Failure {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    try {
        return { text: fs.readFileSync(target.path, 'utf8') };
    } catch {
        return { status: 404, error: 'File not found.' };
    }
}

export function saveTrack(folder: string, file: string, raw: unknown): Failure | null {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    const name = (raw as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name) return { status: 400, error: 'Track JSON is missing "name".' };
    if (folder === 'published') {
        const other = [...publishedNames].find(([f, n]) => n === name && f !== file);
        if (other) return { status: 409, error: `Another published file (${other[0]}) already has the name "${name}".` };
    }
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, JSON.stringify(raw, null, 2) + '\n');
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
export function deleteTrack(folder: string, file: string): Failure | null {
    const target = resolve(folder, file);
    if ('error' in target) return target;
    if (folder === 'published') {
        const name = publishedNames.get(file);
        if (name) {
            const users = Object.values(SESSION_REGISTRY).filter(s => s.stages.some(st => st.track === name)).map(s => s.name);
            if (users.length > 0) return { status: 409, error: `"${name}" is used by sessions: ${users.join(', ')}.` };
            delete TRACK_REGISTRY[name];
            publishedNames.delete(file);
        }
    }
    fs.rmSync(target.path, { force: true });
    return null;
}

// Validated absolute path, or an error.
function resolve(folder: string, file: string): { path: string } | Failure {
    if (folder !== 'drafts' && folder !== 'published') return { status: 400, error: 'folder must be "drafts" or "published".' };
    if (!FILE_RE.test(file)) return { status: 400, error: 'file must match [a-z0-9_]+.json.' };
    return { path: path.join(dirs[folder], file) };
}

// Track files in a folder (not its subfolders); unreadable ones left out.
function list(dir: string): TrackEntry[] {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    const entries: TrackEntry[] = [];
    for (const file of names.filter(n => FILE_RE.test(n)).sort()) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            if (typeof j?.name !== 'string') continue;
            entries.push({ file, name: j.name, displayName: typeof j.displayName === 'string' ? j.displayName : j.name });
        } catch {
            // malformed file: leave it out of the list
        }
    }
    return entries;
}
