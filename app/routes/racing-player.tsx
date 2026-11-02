import { useEffect, useRef } from 'react';
import { SinglePlayerView } from '~/views/SinglePlayerView';

// React shim: mounts the pure-TS SinglePlayerView (the race runs on the
// game server).
export default function RacingPlayerRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new SinglePlayerView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
