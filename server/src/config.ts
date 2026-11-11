// Every setting the server uses. Values can come from `server/.env`
// (gitignored, see `server/.env.example`; loaded by the npm scripts with
// Node's --env-file-if-exists) or the container's environment; the rest
// of the code only reads this.
export const config = {
    // Port the WebSocket server listens on (every network interface).
    port: Number(process.env.PORT || 8080),
    // A lobby with no drivers and no viewers is deleted after this long
    // (single-player lobbies: as soon as their player is gone).
    emptyLobbySeconds: Number(process.env.EMPTY_LOBBY_SECONDS || 600),
    // The track editor's password (header X-Editor-Password on the Track
    // API). Only keeps editing to one person — not real security. Empty =
    // track editing is off (the Track API answers 503).
    editorPassword: process.env.EDITOR_PASSWORD || '',
    // Fast training lobbies (lockstep, as fast as the agents answer — one
    // takes a whole core). FAST_LOBBIES=false turns them off (a public
    // server: run fast training locally); req:lobby/create { fast } → createError.
    fastLobbies: process.env.FAST_LOBBIES !== 'false',
    // Incident logs (formulai/incidentLog.ts): a car's last seconds around a
    // spin or a crash, written to the bucket under logs/ (kept 30 days).
    // LOG_INCIDENTS=true turns them on; off by default.
    logIncidents: process.env.LOG_INCIDENTS === 'true',
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
