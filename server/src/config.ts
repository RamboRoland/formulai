// Every setting the server uses. Values can come from `server/.env`
// (gitignored, see `server/.env.example`; loaded by the npm scripts with
// Node's --env-file-if-exists) or the container's environment; the rest
// of the code only reads this.
import path from 'path';

export const config = {
    // Port the WebSocket server listens on (every network interface).
    port: Number(process.env.PORT || 8080),
    // Folder with the track JSON files (read when needed; the server owns
    // the tracks). Default: server/tracks.
    tracksDir: process.env.TRACKS_DIR || path.resolve(__dirname, '../tracks'),
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
    // The S3 bucket the server keeps its data in (src/storage.ts). Defaults:
    // the local S3 of docker-compose.yml (SeaweedFS on :9100, keys from
    // seaweedfs/s3.json). S3_ENDPOINT set but empty = AWS itself (no custom
    // endpoint); S3_FORCE_PATH_STYLE=false for AWS-style bucket host names.
    s3: {
        endpoint: (process.env.S3_ENDPOINT ?? 'http://localhost:9100') || undefined,
        region: process.env.S3_REGION || 'us-east-1',
        bucket: process.env.S3_BUCKET || 'formulai',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'formulai',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'formulai-local',
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    },
};
