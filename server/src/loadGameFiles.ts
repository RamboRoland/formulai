import type { TrackJSON } from './game/tracks/types';
import { registerTracks, TRACK_REGISTRY } from './game/tracks/registry';
import { registerSessions, SESSION_REGISTRY } from './game/sessions/registry';
import { rememberSessionFiles, SESSION_PREFIX } from './sessionStore';
import { rememberTrackFiles, TRACK_PREFIXES } from './trackStore';
import { getText, listKeys } from './storage';

// Fills the game's registries from S3 (storage.ts): the published tracks
// (tracks/*.json), then the sessions (sessions/*.json — checked against the
// tracks). A file that can't be read or parsed is skipped with a console
// error (sessions: also invalid ones, see registerSessions).
export async function loadGameFiles(): Promise<{ tracks: number; sessions: number }> {
    const tracks = await readJsonObjects(TRACK_PREFIXES.published);
    registerTracks(Object.values(tracks) as TrackJSON[]);
    rememberTrackFiles(tracks);
    const sessions = await readJsonObjects(SESSION_PREFIX);
    registerSessions(sessions);
    rememberSessionFiles(sessions);
    return { tracks: Object.keys(TRACK_REGISTRY).length, sessions: Object.keys(SESSION_REGISTRY).length };
}

// Parsed JSON by S3 key, in key order (directly under `prefix`).
async function readJsonObjects(prefix: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of (await listKeys(prefix)).filter(k => k.endsWith('.json'))) {
        try {
            out[key] = JSON.parse((await getText(key)) ?? '');
        } catch (err) {
            console.error(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return out;
}
