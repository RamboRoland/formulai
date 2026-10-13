import type { SessionJSON } from './types';
import { Session } from './Session';
import { CAR_CLASSES } from '~/tracks/serialize';

// Auto-discovery of all session JSON files in app/assets/sessions/ at build time
// (same pattern as tracks). Dropping a new .json into the folder → it
// appears on next page load. Invalid files are skipped with a console error.
const files = import.meta.glob<unknown>('/app/assets/sessions/*.json', {
    eager: true,
    import: 'default',
});

export const SESSION_REGISTRY: Record<string, SessionJSON> = {};
for (const [path, raw] of Object.entries(files)) {
    try {
        const json = parseSessionJSON(raw);
        SESSION_REGISTRY[json.name] = json;
    } catch (err) {
        console.error(`Session file ${path.split('/').pop()}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// Used by single player and AI mode (no session picker there yet).
export const DEFAULT_SESSION = 'TrainingOne';

// Dropdown entries: [name, displayName].
export const SESSION_OPTIONS: Array<[string, string]> = Object.values(SESSION_REGISTRY)
    .map((s): [string, string] => [s.name, s.displayName]);

// A raceable Session from a registry name, or null if there's no such file.
export function createSession(name: string): Session | null {
    const json = SESSION_REGISTRY[name];
    if (!json) {
        console.error(`Session "${name}" not found in app/assets/sessions/.`);
        return null;
    }
    return new Session(json);
}

// Parsed JSON → SessionJSON. Throws an Error with a readable message if
// anything is wrong.
export function parseSessionJSON(raw: unknown): SessionJSON {
    const j = raw as Partial<SessionJSON> | null;
    if (!j || typeof j !== 'object') throw new Error('Not a JSON object.');
    if (typeof j.name !== 'string' || !j.name) throw new Error('Missing "name".');
    if (!Array.isArray(j.cars) || j.cars.length === 0) throw new Error('"cars" must list at least one car class.');
    for (const car of j.cars) {
        if (!CAR_CLASSES.includes(car)) {
            throw new Error(`Unknown car class "${car}" (known: ${CAR_CLASSES.join(', ')}).`);
        }
    }
    if (!Array.isArray(j.stages) || j.stages.length === 0) throw new Error('"stages" must list at least one stage.');
    const stages = j.stages.map((st, i) => {
        if (!st || typeof st.track !== 'string' || !st.track) throw new Error(`Stage ${i + 1}: missing "track".`);
        if (st.track.includes('::')) throw new Error(`Stage ${i + 1}: put the layout in a separate "layout" field.`);
        if (st.layout !== undefined && (typeof st.layout !== 'string' || !st.layout)) {
            throw new Error(`Stage ${i + 1}: "layout" must be a layout id or name.`);
        }
        if (!Number.isInteger(st.laps) || st.laps < 1) throw new Error(`Stage ${i + 1}: "laps" must be a whole number ≥ 1.`);
        return st.layout === undefined
            ? { track: st.track, laps: st.laps }
            : { track: st.track, layout: st.layout, laps: st.laps };
    });
    return {
        name: j.name,
        displayName: typeof j.displayName === 'string' && j.displayName ? j.displayName : j.name,
        cars: [...j.cars],
        stages,
    };
}
