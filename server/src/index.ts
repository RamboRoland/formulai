import { RacingGameServer } from './websocket';
import { config } from './config';
import { loadGameFiles } from './loadGameFiles';

const PORT = config.port;

const loaded = loadGameFiles();
console.log(`Loaded ${loaded.tracks} tracks from ${config.tracksDir}, ${loaded.sessions} sessions from ${config.sessionsDir} (+ saved: ${config.savedSessionsDir})`);

const server = new RacingGameServer(PORT);
console.log(`Racing game server started on port ${PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.cleanup();
    process.exit(0);
}); 