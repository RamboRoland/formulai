import { useEffect, useRef } from 'react';
import { createSession, DEFAULT_SESSION } from '~/sessions/registry';
import { SinglePlayerView } from '~/views/SinglePlayerView';

// React shim: mounts the pure-TS SinglePlayerView. Real logic lives in
// `~/views/SinglePlayerView`. This wrapper exists only while React Router
// still routes; Phase 7 replaces it with a router entry.
export default function RacingPlayerRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const session = createSession(DEFAULT_SESSION);
        if (!session) {
            mountRef.current.textContent = `Session "${DEFAULT_SESSION}" not found in app/assets/sessions/.`;
            return;
        }
        const view = new SinglePlayerView(session);
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
