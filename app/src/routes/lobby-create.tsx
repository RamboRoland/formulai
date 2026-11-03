import { useEffect, useRef } from 'react';
import { CreateLobbyView } from '~/views/CreateLobbyView';

// React shim: mounts the pure-TS CreateLobbyView (/lobby/create).
export default function CreateLobbyRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new CreateLobbyView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
