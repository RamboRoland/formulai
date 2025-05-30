import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { GameState } from '../../app/types';
import { URL } from 'url';

type Client = {
    ws: WebSocket;
    gameState?: GameState;
    type: 'game' | 'control';
};

export class RacingGameServer {
    private wss: WSServer;
    private clients: Map<string, Client> = new Map();
    private gameStatePollingInterval: NodeJS.Timeout | null = null;

    constructor(port: number) {
        this.wss = new WSServer({ 
            port,
            // Accept both game and control subprotocols
            handleProtocols: (protocols: Set<string>, request: any) => {
                const protocol = Array.from(protocols)[0];
                return protocol === 'game' || protocol === 'control' ? protocol : false;
            }
        });
        this.setupWebSocketServer();
        console.log(`WebSocket server started on port ${port}`);
    }

    private setupWebSocketServer() {
        this.wss.on('connection', (ws: WebSocket, request) => {
            const clientId = this.generateClientId();
            const clientType = ws.protocol as 'game' | 'control';
            
            console.log('New connection:', {
                clientId,
                protocol: ws.protocol,
                readyState: ws.readyState,
                url: request.url
            });

            if (!clientType || (clientType !== 'game' && clientType !== 'control')) {
                console.error('Invalid client type:', clientType);
                ws.close(1008, 'Invalid client type');
                return;
            }

            this.clients.set(clientId, { ws, type: clientType });
            console.log(`Client ${clientId} connected as ${clientType}`);

            ws.on('message', (data: string) => {
                console.log(`[${clientId}] Received message:`, data.toString());
                this.handleMessage(clientId, JSON.parse(data));
            });

            ws.on('close', (code: number, reason: string) => {
                console.log(`Client ${clientId} disconnected:`, {
                    code,
                    reason: reason.toString(),
                    remainingClients: this.clients.size - 1
                });
                this.clients.delete(clientId);
            });

            ws.on('error', (error: Error) => {
                console.error(`Client ${clientId} error:`, error);
            });

            // Send a welcome message
            ws.send(JSON.stringify({
                type: 'welcome',
                data: { clientId, clientType }
            }));
        });

        this.wss.on('error', (error: Error) => {
            console.error('WebSocket server error:', error);
        });

        this.wss.on('listening', () => {
            console.log('WebSocket server is listening');
        });
    }

    private handleMessage(clientId: string, message: any) {
        const { type, data } = message;
        const client = this.clients.get(clientId);

        if (!client) return;
        
        switch (type) {
            case 'gameState':
                if (client.type === 'game') {
                    client.gameState = data;

                    // Forward game state to all control clients
                    this.clients.forEach((controlClient, controlId) => {
                        if (controlClient.type === 'control') {
                            controlClient.ws.send(JSON.stringify({
                                type: 'gameState',
                                data: data
                            }));
                        }
                    });
                }
                break;

            case 'requestGameState':
                if (client.type === 'control') {
                    // Find a game client and request their state
                    const gameClient = Array.from(this.clients.values()).find(c => c.type === 'game');
                    if (gameClient) {
                        gameClient.ws.send(JSON.stringify({ type: 'requestGameState' }));
                    } else {
                        console.log(`[${clientId}] No game client available to request state from`);
                    }
                }
                break;

            case 'controls':
                if (client.type === 'control') {
                    // Find a game client and forward the controls
                    const gameClient = Array.from(this.clients.values()).find(c => c.type === 'game');
                    if (gameClient) {
                        gameClient.ws.send(JSON.stringify({
                            type: 'controls',
                            data: data
                        }));
                    } else {
                        console.log(`[${clientId}] No game client available to receive controls`);
                    }
                }
                break;

            case 'track':
                if (client.type === 'control') {
                    const gameClient = Array.from(this.clients.values()).find(c => c.type === 'game');
                    if (gameClient) {
                        gameClient.ws.send(JSON.stringify({
                            type: 'track',
                            data: data
                        }));
                    } else {
                        console.log(`[${clientId}] No game client available to receive controls`);
                    }
                }
                break;

            default:
                console.log(`[${clientId}] Unknown message type:`, type);
        }
    }

    private generateClientId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    public cleanup() {
        this.wss.close();
        this.clients.clear();
    }
} 