import { RacingGameServer } from './websocket';
import { config } from './config';
import { loadGameFiles } from './loadGameFiles';
import { waitForBucket } from './storage';

const PORT = config.port;

// How long to wait for S3 at start (the local one needs a few seconds).
const S3_WAIT_SECONDS = 60;

let server: RacingGameServer | null = null;

async function start(): Promise<void> {
    await waitForBucket(S3_WAIT_SECONDS);
    const loaded = await loadGameFiles();
    console.log(`Loaded ${loaded.tracks} tracks from S3 (${config.s3.endpoint ?? 'AWS'} bucket "${config.s3.bucket}"), ${loaded.sessions} sessions from ${config.sessionsDir} (+ saved: ${config.savedSessionsDir})`);
    server = new RacingGameServer(PORT);
    console.log(`Racing game server started on port ${PORT}`);
}

start().catch(err => {
    console.error(`Server not started: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server?.cleanup();
    process.exit(0);
}); 