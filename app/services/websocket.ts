import type { GameState } from '../types';

type MessageHandler = (type: string, data: any) => void;
type MessageType = 'gameState' | 'controls' | 'requestGameState' | 'track';
type ClientType = 'game' | 'control';

export class WebSocketClient {
    private static instance: WebSocketClient | null = null;
    private ws: WebSocket | null = null;
    private messageHandlers: Map<MessageType, MessageHandler[]> = new Map();
    private gameStateCallback: (() => GameState) | null = null;
    private trackCallback: ((track: string) => void) | null = null;
    private readonly url: string;
    private isConnecting = false;

    private constructor(url: string) {
        this.url = url;
    }

    public static getInstance(url: string): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient(url);
        }
        return WebSocketClient.instance;
    }

    public static resetInstance() {
        if (WebSocketClient.instance) {
            WebSocketClient.instance.cleanup();
            WebSocketClient.instance = null;
        }
    }

    public setGameStateCallback(callback: () => GameState) {
        this.gameStateCallback = callback;
    }

    public setTrackCallback(callback: (track: string) => void) {
        this.trackCallback = callback;
    }

    public connect() {
        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;
        this.ws = new WebSocket(this.url, ['game']);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isConnecting = false;
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.isConnecting = false;
            this.ws = null;
            setTimeout(() => this.connect(), 1000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.isConnecting = false;
        };

        this.ws.onmessage = this.handleMessage.bind(this);
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Client disconnecting');
            this.ws = null;
        }
    }

    public subscribe(type: MessageType, handler: MessageHandler) {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type)?.push(handler);
    }

    public unsubscribe(type: MessageType, handler: MessageHandler) {
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }

    public send(type: string, data: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type, data }));
            } catch (error) {
                console.error('Failed to send message:', error);
            }
        }
    }

    private handleMessage(event: MessageEvent) {
        const message = JSON.parse(event.data);
        const { type, data } = message;

        if (type === 'requestGameState' && this.gameStateCallback) {
            const gameState = this.gameStateCallback();
            this.send('gameState', gameState);
            return;
        }

        if (type === 'track' && this.trackCallback) {
            console.log('track', data);
            this.trackCallback(data);
            return;
        }

        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            handlers.forEach(handler => handler(type, data));
        }
    }

    public cleanup() {
        this.disconnect();
        this.messageHandlers.clear();
        this.gameStateCallback = null;
    }
} 