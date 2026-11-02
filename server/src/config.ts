// Every setting the server uses. Values can come from `server/.env`
// (gitignored, see `server/.env.example`; loaded by the npm scripts with
// Node's --env-file-if-exists) or the container's environment; the rest
// of the code only reads this.
import path from 'path';

export const config = {
    // Port the WebSocket server listens on (every network interface).
    port: Number(process.env.PORT || 8080),
    // Folder with the track JSON files (read when needed; the server owns
    // the tracks). Default: the repo's app/assets/tracks.
    tracksDir: process.env.TRACKS_DIR || path.resolve(__dirname, '../../app/assets/tracks'),
    // Folder with the shipped session JSON files (read-only through the API).
    sessionsDir: path.resolve(__dirname, '../sessions'),
    // Folder where sessions saved from the lobby editor go (a volume on a
    // public server). Default: server/sessions/saved.
    savedSessionsDir: process.env.SAVED_SESSIONS_DIR || path.resolve(__dirname, '../sessions/saved'),
    // A lobby with no drivers and no viewers is deleted after this long
    // (single-player lobbies: as soon as their player is gone).
    emptyLobbySeconds: Number(process.env.EMPTY_LOBBY_SECONDS || 600),
    // The track editor's password (header X-Editor-Password on the Track
    // API). Only keeps editing to one person — not real security. Empty =
    // track editing is off (the Track API answers 503).
    editorPassword: process.env.EDITOR_PASSWORD || '',
};
