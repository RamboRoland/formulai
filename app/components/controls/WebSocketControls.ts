import { WebSocketClient } from '../../services/websocket';
import type { Controls } from './types';

const DEFAULT_CONTROLS: Controls = {
    forward: false,
    backward: false,
    steering: 0,
    brake: false,
    restart: false,
};

// AI input → Controls. steering: clamped to -1..1; not a finite number
// (missing, NaN, a string) → 0. Anything else the AI sends (e.g. the old
// left/right) is dropped.
function toControls(c: any): Controls {
    const s = c?.steering;
    return {
        forward: Boolean(c?.forward),
        backward: Boolean(c?.backward),
        steering: typeof s === 'number' && Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0,
        brake: Boolean(c?.brake),
        restart: Boolean(c?.restart),
    };
}

// Receives controls from external control clients (AIs) and buckets them
// by sender clientId. The host can then look up controls per actor:
// `getControlsFor(playerId)`.
//
// For the single-actor case (AiView today), the host's one player has no
// predetermined clientId, so `getControlsFor` falls back to the most recently
// received controls when the exact playerId isn't in the map.
export class WebSocketControls {
    private ws: WebSocketClient;
    private controlsByClient: Map<string, Controls> = new Map();
    private lastReceived: Controls | null = null;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeBatch: (() => void) | null = null;

    constructor(wsClient: WebSocketClient) {
        this.ws = wsClient;
        this.unsubscribe = this.ws.subscribe('evt:control', 'update', ({ clientId, controls }) => {
            const c = toControls(controls);
            this.controlsByClient.set(clientId, c);
            this.lastReceived = c;
        });
        this.unsubscribeBatch = this.ws.subscribe('evt:control', 'updateBatch', ({ items }) => {
            for (const item of items) {
                const c = toControls(item.controls);
                this.controlsByClient.set(item.clientId, c);
                this.lastReceived = c;
            }
        });
    }

    public connect() {
        this.ws.connect();
    }

    public disconnect() {
        this.ws.disconnect();
    }

    public getControlsFor(playerId: string): Controls {
        return this.controlsByClient.get(playerId)
            ?? this.lastReceived
            ?? DEFAULT_CONTROLS;
    }

    public resetRestartFor(playerId: string): void {
        const current = this.controlsByClient.get(playerId);
        if (current) current.restart = false;
        if (this.lastReceived) this.lastReceived.restart = false;
    }

    // Drop a specific actor's controls (e.g., when the AI driving them
    // disconnects). Prevents stale controls from being applied to a ghost actor.
    public clearFor(playerId: string): void {
        this.controlsByClient.delete(playerId);
    }

    public cleanup() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.unsubscribeBatch?.();
        this.unsubscribeBatch = null;
        this.controlsByClient.clear();
        this.lastReceived = null;
    }
}
