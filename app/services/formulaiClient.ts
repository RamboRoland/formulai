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
    private closing = false;
    private opened = false;
    private readonly onPageHide: () => void;

    public constructor(url: string) {
        this.ws = new WebSocket(url, SUBPROTOCOL);
        // Leaving the page (also into the back/forward cache, where the
        // view's unmount never runs) closes the connection, so the server
        // drops our cars / viewer right away.
        this.onPageHide = () => this.close();
        window.addEventListener('pagehide', this.onPageHide);
        this.ws.addEventListener('open', () => {
            this.opened = true;
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

    // The connection closed — `wasOpen` false = it never opened (server
    // unreachable). Not called after close().
    public onClose(handler: (wasOpen: boolean) => void): void {
        this.ws.addEventListener('close', () => {
            if (!this.closing) handler(this.opened);
        });
    }

    public close(): void {
        window.removeEventListener('pagehide', this.onPageHide);
        this.closing = true;
        this.handlers.clear();
        this.ws.close();
    }
}
