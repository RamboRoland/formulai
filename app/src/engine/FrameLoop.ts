// The app's game loop: calls `onFrame` once per browser frame
// (requestAnimationFrame) with the seconds since the previous frame.
export class FrameLoop {
    private rafId: number | null = null;
    private lastFrameTime = 0;

    public constructor(private readonly onFrame: (deltaTimeSeconds: number) => void) {}

    public start(): void {
        if (this.rafId !== null) return;
        this.lastFrameTime = performance.now();
        const loop = (timestamp: number) => {
            const deltaTimeSeconds = (timestamp - this.lastFrameTime) / 1000;
            this.lastFrameTime = timestamp;
            this.onFrame(deltaTimeSeconds);
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    public stop(): void {
        if (this.rafId === null) return;
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
}
