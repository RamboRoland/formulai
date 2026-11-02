import fs from 'fs';
import path from 'path';
import { config } from './config';
import { parseSessionJSON, SESSION_REGISTRY } from './game/sessions/registry';
import { resolveTrackRef } from './game/tracks/registry';
import { trackFileStem } from './game/tracks/serialize';
import type { SessionJSON } from './game/sessions/types';

// The sessions on disk: SHIPPED ones (config.sessionsDir — the repo's
// files, read-only) and SAVED ones (config.savedSessionsDir — from the
// lobby editor). Both are in SESSION_REGISTRY; this module remembers which
// is which and writes / deletes the saved ones.
const shipped = new Set<string>();
const savedFiles = new Map<string, string>(); // session name → file path

export function isShipped(name: string): boolean {
    return shipped.has(name);
}

// Called by loadGameFiles after it registered the files of both folders.
export function rememberSessionFiles(shippedFiles: Record<string, unknown>, saved: Record<string, unknown>): void {
    shipped.clear();
    savedFiles.clear();
    for (const raw of Object.values(shippedFiles)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string') shipped.add(name);
    }
    for (const [file, raw] of Object.entries(saved)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string' && !shipped.has(name)) savedFiles.set(name, file);
    }
}

// A session from outside (the lobby editor): the session-file checks
// (known karts, stages, laps) + every stage's track and layout must exist.
export function validateSession(raw: unknown): { json: SessionJSON } | { error: string } {
    let json: SessionJSON;
    try {
        json = parseSessionJSON(raw);
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
    for (const [i, stage] of json.stages.entries()) {
        const resolved = resolveTrackRef(stage.track, stage.layout);
        if ('error' in resolved) return { error: `Stage ${i + 1}: ${resolved.error}.` };
    }
    return { json };
}

// Validate + save one session (new or an earlier saved one). Returns an
// error (with its HTTP status) instead of throwing.
export function saveSession(urlName: string, raw: unknown): { status: number; error: string } | null {
    const valid = validateSession(raw);
    if ('error' in valid) return { status: 400, error: valid.error };
    const json = valid.json;
    if (json.name !== urlName) return { status: 400, error: `The session's "name" (${json.name}) must match the URL (${urlName}).` };
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(json.name)) return { status: 400, error: 'Name: start with a letter, letters and digits only (e.g. MyTraining).' };
    if (shipped.has(json.name)) return { status: 409, error: `"${json.name}" is a shipped session and can't be changed — save it under a new name.` };
    const file = savedFiles.get(json.name) ?? path.join(config.savedSessionsDir, `${trackFileStem(json.name)}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    savedFiles.set(json.name, file);
    SESSION_REGISTRY[json.name] = json;
    return null;
}

export function deleteSession(name: string): { status: number; error: string } | null {
    if (shipped.has(name)) return { status: 409, error: `"${name}" is a shipped session and can't be deleted.` };
    const file = savedFiles.get(name);
    if (!file) return { status: 404, error: `No saved session "${name}".` };
    fs.rmSync(file, { force: true });
    savedFiles.delete(name);
    delete SESSION_REGISTRY[name];
    return null;
}
