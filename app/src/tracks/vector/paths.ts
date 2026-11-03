import type { TrackPath } from '~/tracks/types';
import type { FlatPoint } from './types';
import { flattenCenterline } from './flatten';
import { projectOntoCenterline, type CenterlineProjection } from './project';

// Centerline helpers for a track made of several paths (main loop + open
// connector roads). Flatten once with `flattenPaths`, then project.

export type FlatPath = {
    id: string;
    closed: boolean;
    flat: FlatPoint[];   // empty for a path with < 2 anchors
};

export function flattenPath(path: TrackPath): FlatPath {
    return { id: path.id, closed: path.closed, flat: flattenCenterline(path.anchors, path.closed) };
}

export function flattenPaths(paths: TrackPath[]): FlatPath[] {
    return paths.map(flattenPath);
}

// Closest point on one path (respects open/closed).
export function projectOntoPath(path: FlatPath, x: number, y: number): CenterlineProjection | null {
    return projectOntoCenterline(path.flat, x, y, path.closed);
}

// Closest point on ANY path, and which path it is. Where roads overlap (a
// junction) the nearest centerline wins. null if no path has geometry.
export function projectOntoNearestPath(
    paths: FlatPath[], x: number, y: number,
): { pathId: string; projection: CenterlineProjection } | null {
    let best: { pathId: string; projection: CenterlineProjection } | null = null;
    for (const p of paths) {
        const projection = projectOntoPath(p, x, y);
        if (projection && (!best || projection.distance < best.projection.distance)) {
            best = { pathId: p.id, projection };
        }
    }
    return best;
}
