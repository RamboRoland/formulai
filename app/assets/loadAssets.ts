import type { TrackJSON } from '~/tracks/types';
import { registerTracks } from '~/tracks/registry';
import { registerSessions } from '~/sessions/registry';

// The app's track + session files: every JSON in app/assets/tracks/ and
// app/assets/sessions/, inlined into the bundle at build time (Vite's
// glob import). Dropping a new .json into a folder → it appears on the
// next page load. The registries themselves don't know where files come
// from (the server fills them from disk).
registerTracks(Object.values(import.meta.glob<TrackJSON>('/app/assets/tracks/*.json', {
    eager: true,
    import: 'default',
})));
registerSessions(import.meta.glob<unknown>('/app/assets/sessions/*.json', {
    eager: true,
    import: 'default',
}));
