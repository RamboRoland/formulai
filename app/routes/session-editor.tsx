import { useEffect, useRef } from 'react';
import { SessionEditorView } from '~/views/SessionEditorView';

// React shim: mounts the pure-TS SessionEditorView (/session/editor).
export default function SessionEditorRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new SessionEditorView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
