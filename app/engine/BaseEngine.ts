// Abstract game engine base: owns the requestAnimationFrame loop and a typed
// event emitter. Knows nothing about physics, cars, or drawing — subclasses
// implement tick() with domain logic and emit() typed events for HUDs / views
// to subscribe to.

type Listener<T> = (data: T) => void;

export abstract class BaseEngine<Events extends Record<string, unknown>> {
    private rafId: number | null = null;
    private lastFrameTime = 0;
    private listeners: { [K in keyof Events]?: Array<Listener<Events[K]>> } = {};

    public start(): void {
        if (this.rafId !== null) return;
        this.lastFrameTime = performance.now();
        const loop = (timestamp: number) => {
            const deltaTimeSeconds = (timestamp - this.lastFrameTime) / 1000;
            this.lastFrameTime = timestamp;
            this.tick(deltaTimeSeconds);
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    public stop(): void {
        if (this.rafId === null) return;
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

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

    protected abstract tick(deltaTimeSeconds: number): void;
}
