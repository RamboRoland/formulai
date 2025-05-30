import { useEffect, useRef } from 'react';
import type { GameMode } from '../../types';
import { KeyboardControls } from '../controls/KeyboardControls';
import { WebSocketControls } from '../controls/WebSocketControls';
import { WebSocketClient } from '../../services/websocket';

export function useControls(gameMode: GameMode, onRestart?: () => void) {
    const keyboardControls = useRef<KeyboardControls | null>(null);
    const wsControls = useRef<WebSocketControls | null>(null);

    useEffect(() => {
        if (gameMode === 'player') {
            keyboardControls.current = new KeyboardControls();
            keyboardControls.current.start();
        } else if (gameMode === 'ai') {
            const wsClient = WebSocketClient.getInstance('ws://localhost:8080');
            wsControls.current = new WebSocketControls(wsClient);
            wsClient.connect();
        }

        return () => {
            keyboardControls.current?.cleanup();
            wsControls.current?.cleanup();
        };
    }, [gameMode]);

    const getControls = () => {
        const controls = gameMode === 'player'
            ? keyboardControls.current?.getControls()
            : wsControls.current?.getControls();

        if (controls?.restart && onRestart) {
            onRestart();
            if (gameMode === 'player') {
                keyboardControls.current?.resetRestart();
            } else {
                wsControls.current?.resetRestart();
            }
        }

        return controls || {
            forward: false,
            backward: false,
            left: false,
            right: false,
            brake: false,
            restart: false,
        };
    };

    return { getControls };
} 