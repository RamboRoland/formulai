import type { TrackJSON } from './types';
import { Track } from './Track';

// Auto-discovery of all track JSON files in app/assets/tracks/ at build time.
// Vite's glob import inlines each file's parsed JSON into the bundle.
// Dropping a new .json into the folder → it appears in dropdowns on next
// page load. No manifest to maintain, no import sites to update.
const files = import.meta.glob<TrackJSON>('/app/assets/tracks/*.json', {
    eager: true,
    import: 'default',
});

export const TRACK_REGISTRY: Record<string, TrackJSON> = Object.fromEntries(
    Object.values(files).map(json => [json.name, json])
);

// A track reference is "TrackName::layoutId". A bare "TrackName" means the
// file's first layout (keeps simple name lists, e.g. in sessions, working).
export const trackRef = (name: string, layoutId: string): string => `${name}::${layoutId}`;

export const parseTrackRef = (ref: string): { name: string; layoutId?: string } => {
    const i = ref.indexOf('::');
    return i < 0 ? { name: ref } : { name: ref.slice(0, i), layoutId: ref.slice(i + 2) };
};

// Dropdown entries: one per (track, layout). Single-layout tracks show just
// the track name; multi-layout tracks show "Track — Layout".
export const TRACK_OPTIONS: Array<[string, string]> = Object.values(TRACK_REGISTRY).flatMap(t => {
    const layouts = Array.isArray(t.layouts) ? t.layouts : [];
    return layouts.map((l): [string, string] => [
        trackRef(t.name, l.id),
        layouts.length > 1 ? `${t.displayName} — ${l.name}` : t.displayName,
    ]);
});

// Resolve a layout of a track by id OR name (id tried first, then name) →
// its track ref. No `layout` → the track's first layout. Returns an error
// message instead when the track/layout is unknown or the name is ambiguous.
export const resolveTrackRef = (trackName: string, layout?: string): { ref: string } | { error: string } => {
    const json = TRACK_REGISTRY[trackName];
    if (!json) return { error: `track "${trackName}" not found` };
    if (layout === undefined) return { ref: trackName };
    const layouts = Array.isArray(json.layouts) ? json.layouts : [];
    const byId = layouts.find(l => l.id === layout);
    if (byId) return { ref: trackRef(trackName, byId.id) };
    const byName = layouts.filter(l => l.name === layout);
    if (byName.length === 1) return { ref: trackRef(trackName, byName[0].id) };
    if (byName.length > 1) return { error: `track "${trackName}" has ${byName.length} layouts named "${layout}" — use its id` };
    return { error: `track "${trackName}" has no layout "${layout}" (layouts: ${layouts.map(l => `"${l.name}"`).join(', ')})` };
};

// Instantiate a Track (one layout) from a reference. Null if the track is
// unknown or its file is malformed.
export const createTrack = (ref: string): Track | null => {
    const { name, layoutId } = parseTrackRef(ref);
    const json = TRACK_REGISTRY[name];
    if (!json) return null;
    try {
        return new Track(json, layoutId);
    } catch (err) {
        console.error(`Track "${name}" could not be loaded:`, err);
        return null;
    }
};
