import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { TrackJSON } from './game/tracks/types';
import { registerTracks, TRACK_REGISTRY } from './game/tracks/registry';
import { registerSessions, SESSION_REGISTRY } from './game/sessions/registry';
import { rememberSessionFiles } from './sessionStore';
import { rememberTrackFiles } from './trackStore';

// Fills the game's registries from disk: every *.json in config.tracksDir,
// config.sessionsDir (shipped sessions) and config.savedSessionsDir (saved
// from the lobby editor; a saved one never replaces a shipped one). A file
// that can't be read or parsed is skipped with a console error (sessions:
// also invalid ones, see registerSessions).
export function loadGameFiles(): { tracks: number; sessions: number } {
    const tracks = readJsonFiles(config.tracksDir);
    registerTracks(Object.values(tracks) as TrackJSON[]);
    rememberTrackFiles(tracks);
    const saved = fs.existsSync(config.savedSessionsDir) ? readJsonFiles(config.savedSessionsDir) : {};
    const shipped = readJsonFiles(config.sessionsDir);
    registerSessions(saved);
    registerSessions(shipped);
    rememberSessionFiles(shipped, saved);
    return { tracks: Object.keys(TRACK_REGISTRY).length, sessions: Object.keys(SESSION_REGISTRY).length };
}

// Parsed JSON by file path, in file-name order.
function readJsonFiles(dir: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const filePath = path.join(dir, file);
        try {
            out[filePath] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return out;
}
