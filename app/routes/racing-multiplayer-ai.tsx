import { useEffect, useRef, useState } from 'react';
import { LobbyView } from '~/views/LobbyView';
import { MultiplayerHostView } from '~/views/MultiplayerHostView';
import { WebSocketClient } from '~/services/websocket';
import { createSession } from '~/sessions/registry';
import type { Session } from '~/sessions/Session';
import type { LobbyPlayer } from '../../server/src/types';

// React shim for /racing/multiplayer-ai. Mounts LobbyView; on Start Game
// transitions to MultiplayerHostView. Both views share the WebSocket singleton
// so the host's clientId stays stable from lobby creation through game start.
export default function RacingMultiplayerAIRoute() {
    const [lobbyId, setLobbyId] = useState<string | null>(null);
    const [players, setPlayers] = useState<LobbyPlayer[]>([]);
    const [gameStarted, setGameStarted] = useState(false);
    const [session, setSession] = useState<Session | null>(null);
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;

        if (!gameStarted) {
            const view = new LobbyView({
                onStartGame: () => setGameStarted(true),
                onUpdateLobbyId: (id) => setLobbyId(id),
                onUpdatePlayers: (list) => setPlayers(list),
                // The session file defines tracks and cars; track/cars in the
                // lobby message just mirror it.
                onUpdateSession: (name) => setSession(createSession(name)),
            });
            view.mount(mountRef.current);
            return () => view.unmount();
        }

        if (!session || !lobbyId) return;
        const view = new MultiplayerHostView(session, lobbyId, players);
        view.mount(mountRef.current);
        return () => view.unmount();
    }, [gameStarted]);

    // Reset the WS singleton when the user navigates away from this route
    // entirely (shim unmount, not view swap).
    useEffect(() => {
        return () => { WebSocketClient.resetInstance(); };
    }, []);

    return <div ref={mountRef} />;
}
