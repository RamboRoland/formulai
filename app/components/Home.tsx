import { useEffect, useRef } from 'react';
import { HomeView } from '~/views/HomeView';

// React shim that mounts the pure-TS HomeView. The real view logic lives in
// `~/views/HomeView`. This wrapper exists only while React Router still routes.
const Home = () => {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;
        const view = new HomeView();
        view.mount(mountRef.current);
        return () => view.unmount();
    }, []);

    return <div ref={mountRef} />;
};

export default Home;
