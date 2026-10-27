import type { GameMode } from '../../types';
import type { Controls } from './types';
import { KeyboardControls } from './KeyboardControls';
import { WebSocketControls } from './WebSocketControls';
import { WebSocketClient } from '../../services/websocket';

// Instance handed back to the caller. `getControlsFor(playerId)` returns the
// current input state for a specific actor. For keyboard mode there's only
// ever one actor, so playerId is ignored. For WS mode, controls are looked
// up by the clientId attached to the incoming message. `clearControlsFor` is
// used when an actor drops out so stale controls don't get applied.
export type ControlsInstance = {
    getControlsFor: (playerId: string) => Controls;
    clearControlsFor: (playerId: string) => void;
    destroy: () => void;
};

const DEFAULT_CONTROLS: Controls = {
    forward: false,
    backward: false,
    steering: 0,
    brake: false,
    restart: false,
};

// Pure-TS replacement for the `useControls` React hook. Owns a KeyboardControls
// or WebSocketControls instance based on `mode`. If `onRestart` is supplied, it
// is invoked when the active controls report restart=true, and the underlying
// controls' restart flag is cleared so the caller only sees the edge.
export function createControls(mode: GameMode, onRestart?: () => void): ControlsInstance {
    let keyboard: KeyboardControls | null = null;
    let ws: WebSocketControls | null = null;

    if (mode === 'player') {
        keyboard = new KeyboardControls();
        keyboard.start();
    } else if (mode === 'ai') {
        const wsClient = WebSocketClient.getInstance('ws://localhost:8080');
        ws = new WebSocketControls(wsClient);
        wsClient.connect();
    }

    return {
        getControlsFor: (playerId: string) => {
            const controls = mode === 'player'
                ? keyboard?.getControls()
                : ws?.getControlsFor(playerId);

            if (controls?.restart && onRestart) {
                onRestart();
                if (mode === 'player') keyboard?.resetRestart();
                else ws?.resetRestartFor(playerId);
            }

            return controls ?? DEFAULT_CONTROLS;
        },
        clearControlsFor: (playerId: string) => {
            // Keyboard mode: no-op (one actor, one input source).
            // WS mode: forget this player's stored controls so a ghost actor
            // can't keep driving with stale input after disconnect.
            ws?.clearFor(playerId);
        },
        destroy: () => {
            keyboard?.cleanup();
            ws?.cleanup();
        },
    };
}
