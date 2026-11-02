import { RacingGameServer } from './websocket';
import { config } from './config';

const PORT = config.port;

const server = new RacingGameServer(PORT);
console.log(`Racing game server started on port ${PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.cleanup();
    process.exit(0);
}); 