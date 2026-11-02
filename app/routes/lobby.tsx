import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { LobbyViewerView } from '~/views/LobbyViewerView';

// React shim: mounts the pure-TS LobbyViewerView for /lobbies/:lobbyId.
export default function LobbyRoute() {
    const mountRef = useRef<HTMLDivElement>(null);
    const { lobbyId } = useParams();

    useEffect(() => {
        if (!mountRef.current || !lobbyId) return;
        const view = new LobbyViewerView(lobbyId);
        view.mount(mountRef.current);
        return () => view.unmount();
    }, [lobbyId]);

    return <div ref={mountRef} />;
}
