import { RacingGameServer } from './websocket';

const PORT = 8080;

const server = new RacingGameServer(PORT);
console.log(`Racing game server started on port ${PORT}`);

// Start polling for game state updates every 100ms
server.startGameStatePolling(100);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.cleanup();
    process.exit(0);
}); 