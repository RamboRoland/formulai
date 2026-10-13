import { useEffect, useRef } from 'react';
import { TrackEditorView } from '~/views/TrackEditorView';

// React shim: mounts the pure-TS TrackEditorView.
const TrackEditorRoute = () => {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new TrackEditorView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
};

export default TrackEditorRoute;
