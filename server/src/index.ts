import { RacingGameServer } from './websocket';

const PORT = 8080;

const server = new RacingGameServer(PORT);
console.log(`Racing game server started on port ${PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.cleanup();
    process.exit(0);
}); 