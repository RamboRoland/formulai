import { Vector } from '~/components/Vector';
import { mainPath, type Anchor, type Checkpoint, type Layout, type OutlineNode, type OutlineRing, type TrackJSON, type TrackPath, type TyreWall } from './types';
import { normalizeLapOrder, normalizeStartFinish } from './vector/layout';

// The only place that knows the on-disk track format. Editor export/open and
// the runtime registry all go through here.

export type EditorBackground = NonNullable<TrackJSON['editorBackground']>;

export type TrackData = {
    name: string;
    displayName: string;
    paths: TrackPath[];
    layouts: Layout[];
    outline?: OutlineRing[];
    editorBackground?: EditorBackground;
};

// Car classes selectable in sessions (see Session.chooseCar). Exported layouts
// get a 0 ("not configured") lap time for each one that isn't set yet.
export const CAR_CLASSES = ['GokartTraining', 'GokartGokartCentralen'];

// Editor state → TrackJSON. Never mutates the input. Per layout:
// start/finish normalized, checkpoints written in list order (= lap order,
// start first), unused checkpoints (past the finish on one-way) dropped.
// Coordinates rounded to 0.01 px.
export function serializeTrack(data: TrackData): TrackJSON {
    const paths: TrackPath[] = data.paths.map(p => ({
        id: p.id,
        anchors: p.anchors.map(a => {
            const out: Anchor = { pos: vec(a.pos), halfWidth: round(a.halfWidth) };
            if (a.controlIn) out.controlIn = vec(a.controlIn);
            if (a.controlOut) out.controlOut = vec(a.controlOut);
            if (a.asymmetric) out.asymmetric = true;
            return out;
        }),
        closed: p.closed,
    }));

    const layouts: Layout[] = data.layouts.map(l => {
        const cps: Checkpoint[] = l.checkpoints.map(c => ({ ...c }));
        normalizeStartFinish(cps);
        normalizeLapOrder(cps);

        const expectedLapTimes: Record<string, number> = {};
        for (const car of CAR_CLASSES) expectedLapTimes[car] = l.expectedLapTimes[car] ?? 0;
        for (const [car, t] of Object.entries(l.expectedLapTimes)) expectedLapTimes[car] = t;

        const out: Layout = {
            id: l.id,
            name: l.name,
            checkpoints: cps.map(c => {
                const cp: Checkpoint = { pos: vec(c.pos), path: c.path, dir: c.dir };
                if (c.isStart) cp.isStart = true;
                if (c.isFinish) cp.isFinish = true;
                return cp;
            }),
            expectedLapTimes,
        };
        // A wall still being drawn (< 2 points) isn't a wall yet.
        const walls = (l.walls ?? []).filter(w => w.nodes.length >= 2);
        if (walls.length > 0) out.walls = walls.map(w => ({ nodes: w.nodes.map(writeNode) }));
        return out;
    });

    const json: TrackJSON = {
        name: data.name,
        displayName: data.displayName,
        vector: { paths },
        layouts,
    };
    if (data.outline && data.outline.length > 0) {
        json.vector.outline = data.outline.map(ring => ring.map(writeNode));
    }
    if (data.editorBackground) json.editorBackground = { ...data.editorBackground };
    return json;
}

// Parsed JSON (unknown) → editor/runtime data with real Vector instances.
// Throws an Error with a readable message if the shape is wrong.
export function deserializeTrack(raw: unknown): TrackData {
    const j = raw as Partial<TrackJSON> | null;
    if (!j || typeof j !== 'object') throw new Error('Not a JSON object.');
    if (typeof j.name !== 'string' || !j.name) throw new Error('Missing "name".');
    if (!j.vector || typeof j.vector !== 'object') throw new Error('Missing "vector".');
    if (!Array.isArray(j.layouts) || j.layouts.length === 0) throw new Error('Missing "layouts" (need at least one).');

    // Older files: `vector.anchors` = the one closed loop → one path.
    const legacy = (j.vector as { anchors?: unknown }).anchors;
    const rawPaths: unknown = j.vector.paths
        ?? (Array.isArray(legacy) ? [{ id: 'path-1', anchors: legacy, closed: true }] : undefined);
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) throw new Error('Missing "vector.paths" (need at least one).');

    const ids = new Set<string>();
    const paths: TrackPath[] = rawPaths.map((p: Partial<TrackPath> | null, i) => {
        const label = `Path ${i + 1}`;
        if (!p || typeof p.id !== 'string' || !p.id || !Array.isArray(p.anchors)) throw new Error(`${label} is malformed.`);
        if (ids.has(p.id)) throw new Error(`${label}: duplicate id "${p.id}".`);
        ids.add(p.id);
        const anchors: Anchor[] = p.anchors.map((a, k) => {
            if (!isPoint(a?.pos) || typeof a.halfWidth !== 'number') throw new Error(`${label}: anchor ${k + 1} is malformed.`);
            const out: Anchor = { pos: toVector(a.pos), halfWidth: a.halfWidth };
            if (isPoint(a.controlIn)) out.controlIn = toVector(a.controlIn);
            if (isPoint(a.controlOut)) out.controlOut = toVector(a.controlOut);
            if (a.asymmetric) out.asymmetric = true;
            return out;
        });
        return { id: p.id, anchors, closed: p.closed !== false };
    });

    // Older layouts: checkpoints without `path`/`dir` (all on the main path,
    // stored in lap order) + a layout-level `reversed` that only counted on
    // loop layouts. They load as main-path checkpoints with that direction.
    const main = mainPath(paths);
    const layouts: Layout[] = j.layouts.map((raw, i) => {
        const l = raw as Partial<Layout> & { reversed?: unknown } | null;
        if (!l || typeof l.id !== 'string' || !Array.isArray(l.checkpoints)) throw new Error(`Layout ${i + 1} is malformed.`);
        const label = `Layout "${l.name ?? l.id}"`;
        const rawCps = l.checkpoints as Partial<Checkpoint>[];
        const legacy = rawCps.every(c => c?.path === undefined);
        const loop = rawCps.some(c => c?.isStart && c?.isFinish);
        const legacyDir: 1 | -1 = loop && l.reversed ? -1 : 1;
        if (legacy && rawCps.length > 0 && !main) throw new Error(`${label}: has checkpoints but no path.`);
        const checkpoints: Checkpoint[] = rawCps.map((c, k) => {
            if (!isPoint(c?.pos)) throw new Error(`${label}: checkpoint ${k + 1} is malformed.`);
            let path: string, dir: 1 | -1;
            if (legacy) {
                path = main!.id;
                dir = legacyDir;
            } else {
                if (typeof c.path !== 'string' || !ids.has(c.path)) throw new Error(`${label}: checkpoint ${k + 1} has an unknown path.`);
                if (c.dir !== 1 && c.dir !== -1) throw new Error(`${label}: checkpoint ${k + 1} needs dir 1 or -1.`);
                path = c.path;
                dir = c.dir;
            }
            const cp: Checkpoint = { pos: toVector(c.pos), path, dir };
            if (c.isStart) cp.isStart = true;
            if (c.isFinish) cp.isFinish = true;
            return cp;
        });
        normalizeStartFinish(checkpoints);
        normalizeLapOrder(checkpoints);
        const out: Layout = {
            id: l.id,
            name: typeof l.name === 'string' && l.name ? l.name : `Layout ${i + 1}`,
            checkpoints,
            expectedLapTimes: { ...(l.expectedLapTimes ?? {}) },
        };
        if (l.walls !== undefined) {
            if (!Array.isArray(l.walls)) throw new Error(`${label}: "walls" must be a list.`);
            out.walls = l.walls.map((w: Partial<TyreWall> | null, k) => {
                if (!w || !Array.isArray(w.nodes) || w.nodes.length < 2) throw new Error(`${label}: tyre wall ${k + 1} needs at least 2 nodes.`);
                return { nodes: w.nodes.map((n, m) => readNode(n, `${label}: tyre wall ${k + 1}, node ${m + 1}`)) };
            });
        }
        return out;
    });

    let outline: OutlineRing[] | undefined;
    if (j.vector.outline !== undefined) {
        if (!Array.isArray(j.vector.outline)) throw new Error('"vector.outline" must be a list of rings.');
        outline = j.vector.outline.map((ring, r) => {
            if (!Array.isArray(ring) || ring.length < 2) throw new Error(`Outline ring ${r + 1} is malformed.`);
            return ring.map((n, k) => readNode(n, `Outline ring ${r + 1}: node ${k + 1}`));
        });
    }

    return {
        name: j.name,
        displayName: typeof j.displayName === 'string' && j.displayName ? j.displayName : j.name,
        paths,
        layouts,
        outline,
        editorBackground: j.editorBackground ? { ...j.editorBackground } : undefined,
    };
}

// "GoKartTrackSix" → "gokart_track_six.json"-style file name stem.
export function trackFileStem(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

// Outline / tyre-wall node → JSON (0.01 px, handles only when set).
function writeNode(n: OutlineNode): OutlineNode {
    const out: OutlineNode = { pos: vec(n.pos) };
    if (n.in) out.in = vec(n.in);
    if (n.out) out.out = vec(n.out);
    if (n.asymmetric) out.asymmetric = true;
    return out;
}

// JSON → outline / tyre-wall node. `label` names it in the error.
function readNode(n: Partial<OutlineNode> | null | undefined, label: string): OutlineNode {
    if (!isPoint(n?.pos)) throw new Error(`${label} is malformed.`);
    const node: OutlineNode = { pos: toVector(n.pos) };
    if (isPoint(n.in)) node.in = toVector(n.in);
    if (isPoint(n.out)) node.out = toVector(n.out);
    if (n.asymmetric) node.asymmetric = true;
    return node;
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

function vec(v: { x: number; y: number }): Vector {
    return new Vector(round(v.x), round(v.y));
}

function toVector(v: { x: number; y: number }): Vector {
    return new Vector(v.x, v.y);
}

function isPoint(v: unknown): v is { x: number; y: number } {
    return !!v && typeof (v as { x: unknown }).x === 'number' && typeof (v as { y: unknown }).y === 'number';
}
