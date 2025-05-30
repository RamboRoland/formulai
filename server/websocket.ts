import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { GameState } from '../app/types';

type Client = {
    ws: WebSocket;
    gameState?: GameState;
};

export class RacingGameServer {
    private wss: WSServer;
    private clients: Map<string, Client> = new Map();

    constructor(port: number) {
        this.wss = new WSServer({ port });
        this.setupWebSocketServer();
    }

    private setupWebSocketServer() {
        this.wss.on('connection', (ws: WebSocket) => {
            const clientId = this.generateClientId();
            console.log(`Client connected: ${clientId}`);
            
            this.clients.set(clientId, { ws });

            ws.on('message', (message: string) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(clientId, data);
                } catch (error) {
                    console.error('Failed to parse message:', error);
                }
            });

            ws.on('close', () => {
                console.log(`Client disconnected: ${clientId}`);
                this.clients.delete(clientId);
            });

            // Request initial game state
            this.requestGameState(clientId);
        });
    }

    private handleMessage(clientId: string, message: any) {
        const { type, data } = message;
        const client = this.clients.get(clientId);

        if (!client) return;

        switch (type) {
            case 'gameState':
                client.gameState = data;
                // Here you can process the game state, e.g., for AI training
                console.log('Received game state from client:', clientId);
                break;
            default:
                console.log('Unknown message type:', type);
        }
    }

    private requestGameState(clientId: string) {
        const client = this.clients.get(clientId);
        if (client?.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'requestGameState' }));
        }
    }

    private generateClientId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    public startGameStatePolling(interval: number = 100) {
        setInterval(() => {
            this.clients.forEach((client, clientId) => {
                this.requestGameState(clientId);
            });
        }, interval);
    }

    public cleanup() {
        this.wss.close();
        this.clients.clear();
    }
} 