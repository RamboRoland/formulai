// Abstract game engine base: a typed event emitter and one step of game
// time. Knows nothing about physics, cars, drawing or WHO calls step() —
// the loop lives outside (FrameLoop in the app; a timer on the server).
// Subclasses implement step() with domain logic and emit() typed events
// for HUDs / views to subscribe to.

type Listener<T> = (data: T) => void;

export abstract class BaseEngine<Events extends Record<string, unknown>> {
    private listeners: { [K in keyof Events]?: Array<Listener<Events[K]>> } = {};

    public on<K extends keyof Events>(event: K, handler: Listener<Events[K]>): () => void {
        (this.listeners[event] ??= []).push(handler);
        return () => this.off(event, handler);
    }

    public off<K extends keyof Events>(event: K, handler: Listener<Events[K]>): void {
        const arr = this.listeners[event];
        if (!arr) return;
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
    }

    protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
        this.listeners[event]?.forEach(h => h(data));
    }

    // Advance the game by `deltaTimeSeconds`.
    public abstract step(deltaTimeSeconds: number): void;
}
