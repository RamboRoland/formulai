import { Vector } from '~/components/Vector';

// Single anchor on a track's centerline. The curve segment TO the next anchor
// uses `controlOut`; the curve FROM the previous anchor uses `controlIn`.
// Omit controls for linear segments.
//
// `halfWidth` is the track's half-width at THIS anchor in world pixels.
// Interpolated between neighbors so segments can taper.
export type Anchor = {
    pos: Vector;
    controlIn?: Vector;
    controlOut?: Vector;
    halfWidth: number;
    // If true, dragging one bezier handle does NOT mirror the other (the two
    // move independently). Default is symmetric (undefined / false) so simple
    // smooth curves stay smooth. Users can flip this per-anchor via an
    // inspector toggle; holding Alt during a drag temporarily inverts the
    // current mode (symmetric → asymmetric for that drag, and vice versa).
    asymmetric?: boolean;
};

// A checkpoint sits anywhere along a path's centerline — not necessarily at
// an anchor. Edge points (start/end of the checkpoint line) are DERIVED at
// runtime by projecting ±halfWidth perpendicular to the tangent.
export type Checkpoint = {
    pos: Vector;
    // Id of the path it sits on (no ambiguity at junctions).
    path: string;
    // Direction of travel here: 1 = the path's anchor order, -1 = against it.
    dir: 1 | -1;
    // Exactly one checkpoint per track is the start and exactly one is the
    // finish; the same checkpoint may be both (= loop track). Stored as flags
    // so they stay attached to their checkpoint when the list is re-sorted.
    isStart?: boolean;
    isFinish?: boolean;
};

// One checkpoint setup on a track. A track (shared geometry) has one or more
// layouts. Loop vs one-way is derived per layout (start === finish → loop).
export type Layout = {
    id: string;                                // stable key, e.g. "layout-1"
    name: string;                              // shown in dropdowns
    // Array order IS the lap order: start first; on a one-way layout the
    // finish is last. Direction lives on each checkpoint (`dir`).
    checkpoints: Checkpoint[];
    expectedLapTimes: Record<string, number>;  // per car class, per layout
    // Tyre walls that close the roads this layout doesn't use (shared
    // geometry stays open for the other layouts). Omitted = none.
    walls?: TyreWall[];
};

// One node on the track outline. Same idea as an anchor: the curve TO the
// next node uses `out`, the curve FROM the previous node uses `in`; omit a
// handle for a straight side. `asymmetric` = handles move independently
// (corners); default mirrored, like anchors.
export type OutlineNode = {
    pos: Vector;
    in?: Vector;
    out?: Vector;
    asymmetric?: boolean;
};

// A row of tyres (0.6 m each) along an OPEN bezier chain of bend points —
// same node shape as the outline. Collides as a smooth band; drawn as tyres.
export type TyreWall = {
    nodes: OutlineNode[];   // ≥ 2; first → last, no closing segment
};

// A closed ring of outline nodes (last connects back to first). A loop
// track has an outer ring plus one inner (infield) ring; on-track = inside
// an odd number of rings, so ring direction doesn't matter.
export type OutlineRing = OutlineNode[];

// One centerline of a track: the main loop (closed) or a connector road
// (open; its end anchors sit on another path so the roads join). All paths
// together are the track's shared geometry.
export type TrackPath = {
    id: string;          // stable key, e.g. "path-1"
    anchors: Anchor[];
    closed: boolean;     // true = last anchor connects back to the first
};

// The track's main path: the first closed path, else the first path. Older
// files' checkpoints (no `path`) load onto it.
export const mainPath = (paths: TrackPath[]): TrackPath | undefined =>
    paths.find(p => p.closed) ?? paths[0];

let layoutSeq = 0;
// New empty layout with a unique id. `name` defaults to "Layout N".
export const createLayout = (name?: string): Layout => {
    layoutSeq++;
    return {
        id: `layout-${Date.now().toString(36)}-${layoutSeq}`,
        name: name ?? `Layout ${layoutSeq}`,
        checkpoints: [],
        expectedLapTimes: {},
    };
};

// The one-and-only on-disk track format. Vectors are the source of truth
// for both visuals and bounding boxes. No PNG assets referenced.
//
// Loaded via Vite glob at build time (see `./registry.ts`) and consumed
// by the single `Track` class (`./Track.ts`).
export type TrackJSON = {
    name: string;            // class-like id, e.g. "GoKartTrackSix"
    displayName: string;     // dropdown label, e.g. "GoKart Track 6"
    vector: {
        // Shared geometry for every layout (≥ 1 path). Older files have
        // `anchors` (one closed loop) instead; they load as one path.
        paths: TrackPath[];
        // Track edge as bezier rings — what the game draws, collides with
        // and casts rays against. Generated from the paths on demand in
        // the editor (Outline tab), then fine-tunable by hand. Shared by
        // every layout. Missing = not generated yet (not raceable).
        outline?: OutlineRing[];
    };
    // ≥ 1. Each layout is one checkpoint setup (start/finish, lap times,
    // direction). Loop vs one-way is derived per layout, never stored.
    // Older files have checkpoints without `path`/`dir` and a layout-level
    // `reversed`; they load in memory as main-path checkpoints (serialize.ts).
    layouts: Layout[];
    // Editor-only metadata. Runtime ignores this field entirely.
    editorBackground?: {
        src: string;         // asset URL of an app/assets/trace-maps/ file
        scale: number;       // world-px per image-px
        offsetX: number;
        offsetY: number;
        rotation: number;    // degrees
        opacity: number;     // 0..1
        locked: boolean;
    };
};

// Convenience: a reusable guard for anchor-with-bezier.
export const hasBezier = (a: Anchor): boolean =>
    a.controlIn !== undefined || a.controlOut !== undefined;

// Factory helper for constructing a Vector from a plain [x, y] tuple.
// Useful when parsing JSON that stores points as arrays.
export const vectorFromTuple = (t: [number, number]): Vector => new Vector(t[0], t[1]);
