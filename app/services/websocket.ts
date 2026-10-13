import type {
    MessageEnvelope,
    Namespace,
    PayloadOf,
    ActionsOf,
} from '../../server/src/types';

type Handler = (data: unknown) => void;

// Singleton WebSocket client. Fully typed against the server-owned wire
// contract: subscribe<Ns, A> infers payload shapes from the (ns, action) pair.
// Send and receive are strictly typed; there is no stringly-typed message
// list to maintain on the client.
export class WebSocketClient {
    private static instance: WebSocketClient | null = null;
    private ws: WebSocket | null = null;
    private messageHandlers: Map<string, Handler[]> = new Map();
    private readonly url: string;
    private isConnecting = false;
    private pendingMessages: Array<{ ns: Namespace; action: string; data: unknown }> = [];
    private lastProtocol: string = 'game';

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

    public connect(protocol: string = 'game') {
        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;
        this.lastProtocol = protocol;
        this.ws = new WebSocket(this.url, [protocol]);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isConnecting = false;
            // Flush any pending messages
            this.pendingMessages.forEach(msg => {
                try {
                    this.ws?.send(JSON.stringify(msg));
                } catch (error) {
                    console.error('Failed to send pending message:', error);
                }
            });
            this.pendingMessages = [];
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.isConnecting = false;
            this.ws = null;
            setTimeout(() => this.connect(this.lastProtocol), 1000);
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

    // Subscribe to incoming messages of a specific (ns, action). Handler payload
    // is inferred from the server's wire types. Returns an unsubscribe function.
    public subscribe<Ns extends Namespace, A extends ActionsOf<Ns>>(
        ns: Ns,
        action: A,
        handler: (data: PayloadOf<Ns, A>) => void,
    ): () => void {
        const key = `${ns}:${action}`;
        const wrapped = handler as Handler;
        const arr = this.messageHandlers.get(key) ?? [];
        arr.push(wrapped);
        this.messageHandlers.set(key, arr);
        return () => {
            const current = this.messageHandlers.get(key);
            if (!current) return;
            const idx = current.indexOf(wrapped);
            if (idx !== -1) current.splice(idx, 1);
        };
    }

    // Send a message typed against the wire contract.
    public send<Ns extends Namespace, A extends ActionsOf<Ns>>(
        ns: Ns,
        action: A,
        data: PayloadOf<Ns, A>,
    ) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ ns, action, data }));
            } catch (error) {
                console.error('Failed to send message:', error);
            }
        } else {
            this.pendingMessages.push({ ns, action, data });
        }
    }

    private handleMessage(event: MessageEvent) {
        const message = JSON.parse(event.data) as MessageEnvelope;
        const { ns, action, data } = message;
        if (!ns || !action) return;

        const key = `${ns}:${action}`;
        const handlers = this.messageHandlers.get(key);
        if (!handlers) return;
        handlers.forEach(h => h(data));
    }

    public cleanup() {
        this.disconnect();
        this.messageHandlers.clear();
    }
}
