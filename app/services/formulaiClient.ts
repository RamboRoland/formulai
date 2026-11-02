import { SUBPROTOCOL, type DataOf, type Message, type Namespace } from '~/protocol';

type Handler<Ns extends Namespace, A extends string> = (data: DataOf<Ns, A>) => void;

// One connection to the server's `formulai` protocol (app/protocol). Typed
// send / on; one instance per view, closed when the view goes. No
// automatic reconnect (that left ghost connections behind before;
// reconnecting comes with stable ids in phase 4).
export class FormulaiClient {
    private readonly ws: WebSocket;
    private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
    private readonly queue: string[] = [];

    public constructor(url: string) {
        this.ws = new WebSocket(url, SUBPROTOCOL);
        this.ws.addEventListener('open', () => {
            for (const text of this.queue.splice(0)) this.ws.send(text);
        });
        this.ws.addEventListener('message', event => {
            let message: Message;
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            this.handlers.get(`${message.ns}/${message.action}`)?.forEach(h => h(message.data));
        });
    }

    public send<Ns extends Namespace, A extends string>(ns: Ns, action: A, data?: DataOf<Ns, A>): void {
        const text = JSON.stringify({ ns, action, data });
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
        else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(text);
    }

    // Returns an unsubscribe function.
    public on<Ns extends Namespace, A extends string>(ns: Ns, action: A, handler: Handler<Ns, A>): () => void {
        const key = `${ns}/${action}`;
        const set = this.handlers.get(key) ?? new Set();
        set.add(handler as (data: unknown) => void);
        this.handlers.set(key, set);
        return () => set.delete(handler as (data: unknown) => void);
    }

    // The first message of (ns, action) — e.g. the answer to a request.
    public once<Ns extends Namespace, A extends string>(ns: Ns, action: A): Promise<DataOf<Ns, A>> {
        return new Promise(resolve => {
            const off = this.on(ns, action, data => {
                off();
                (resolve as (value: unknown) => void)(data);
            });
        });
    }

    public close(): void {
        this.handlers.clear();
        this.ws.close();
    }
}
