import { useEffect, useRef } from 'react';
import { LobbiesView } from '~/views/LobbiesView';

// React shim: mounts the pure-TS LobbiesView (the lobby list).
export default function LobbiesRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new LobbiesView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
