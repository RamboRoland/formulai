import { useEffect, useRef } from 'react';
import { createSession, DEFAULT_SESSION } from '~/sessions/registry';
import { AiView } from '~/views/AiView';

// React shim: mounts the pure-TS AiView.
export default function RacingAIRoute() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const session = createSession(DEFAULT_SESSION);
        if (!session) {
            mountRef.current.textContent = `Session "${DEFAULT_SESSION}" not found in app/assets/sessions/.`;
            return;
        }
        const view = new AiView(session);
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
}
