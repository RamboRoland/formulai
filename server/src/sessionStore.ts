import { parseSessionJSON, SESSION_REGISTRY } from './game/sessions/registry';
import { resolveTrackRef } from './game/tracks/registry';
import { trackFileStem } from './game/tracks/serialize';
import type { SessionJSON } from './game/sessions/types';
import { deleteKey, putJson } from './storage';

// The sessions in S3 (storage.ts, sessions/<file>.json), all alike: any
// can be saved over or deleted from the lobby editor. All are in
// SESSION_REGISTRY; this module remembers each one's key and writes /
// deletes them.
export const SESSION_PREFIX = 'sessions/';
const sessionKeys = new Map<string, string>(); // session name → S3 key

// Called by loadGameFiles with the session files (by key) it read.
export function rememberSessionFiles(files: Record<string, unknown>): void {
    sessionKeys.clear();
    for (const [key, raw] of Object.entries(files)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string' && SESSION_REGISTRY[name]) sessionKeys.set(name, key);
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

// Validate + save one session (new or an existing one). Returns an error
// (with its HTTP status) instead of throwing.
export async function saveSession(urlName: string, raw: unknown): Promise<{ status: number; error: string } | null> {
    const valid = validateSession(raw);
    if ('error' in valid) return { status: 400, error: valid.error };
    const json = valid.json;
    if (json.name !== urlName) return { status: 400, error: `The session's "name" (${json.name}) must match the URL (${urlName}).` };
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(json.name)) return { status: 400, error: 'Name: start with a letter, letters and digits only (e.g. MyTraining).' };
    const key = sessionKeys.get(json.name) ?? `${SESSION_PREFIX}${trackFileStem(json.name)}.json`;
    const other = [...sessionKeys].find(([name, k]) => k === key && name !== json.name);
    if (other) return { status: 409, error: `"${json.name}" would be stored as ${key}, which "${other[0]}" already uses — pick another name.` };
    await putJson(key, json);
    sessionKeys.set(json.name, key);
    SESSION_REGISTRY[json.name] = json;
    return null;
}

export async function deleteSession(name: string): Promise<{ status: number; error: string } | null> {
    const key = sessionKeys.get(name);
    if (!key) return { status: 404, error: `No session "${name}".` };
    await deleteKey(key);
    sessionKeys.delete(name);
    delete SESSION_REGISTRY[name];
    return null;
}
