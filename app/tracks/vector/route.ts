import type { Checkpoint } from '~/tracks/types';
import type { FlatPath } from './paths';
import { projectOntoPath } from './paths';
import { lapLength } from './project';

// The driving line of a layout: the path centerlines between consecutive
// checkpoints in lap order, switching path where a connector road's end
// sits on the other path. Pure — used by the editor for the layout length
// and for re-spacing checkpoints.

// One sampled point of the driving line, with the path it lies on and the
// direction of travel along that path.
export type RoutePoint = { x: number; y: number; path: string; dir: 1 | -1 };

// The stretch from one checkpoint to the next (index i → i + 1, a loop's
// last leg goes back to the start).
export type RouteLeg = { points: RoutePoint[]; length: number };

export type Route = { legs: RouteLeg[]; length: number };

const STEP_PX = 6; // sample spacing (0.25 m)

const pathLength = (p: FlatPath): number =>
    p.flat.length < 2 ? 0 : p.closed ? lapLength(p.flat) : p.flat[p.flat.length - 1].arcLength;

// Point at arc length `s` on a flattened path (wraps on closed paths).
function pointAt(p: FlatPath, s: number): { x: number; y: number } {
    const f = p.flat;
    const L = pathLength(p);
    s = p.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (f[mid].arcLength <= s) lo = mid; else hi = mid - 1;
    }
    const a = f[lo];
    const last = lo + 1 >= f.length;
    const b = last ? (p.closed ? f[0] : a) : f[lo + 1];
    const segLen = last ? L - a.arcLength : b.arcLength - a.arcLength;
    const t = segLen > 1e-9 ? (s - a.arcLength) / segLen : 0;
    return { x: a.pos.x + (b.pos.x - a.pos.x) * t, y: a.pos.y + (b.pos.y - a.pos.y) * t };
}

// Sample `p` from sFrom to sTo travelling in `dir` (wraps on closed paths).
// Returns false if an open path would have to be driven backwards.
function walk(p: FlatPath, sFrom: number, sTo: number, dir: 1 | -1, out: RoutePoint[]): boolean {
    const L = pathLength(p);
    let d = dir === 1 ? sTo - sFrom : sFrom - sTo;
    if (p.closed) d = ((d % L) + L) % L;
    if (d < -1e-6) return false;
    const n = Math.max(1, Math.ceil(d / STEP_PX));
    for (let k = 0; k <= n; k++) {
        const q = pointAt(p, sFrom + dir * d * (k / n));
        out.push({ x: q.x, y: q.y, path: p.id, dir });
    }
    return true;
}

// One leg a → b. Same path: along it. Otherwise via the connector end that
// joins them (into an open path at its entry end, or out of one at its exit).
function leg(a: { cp: Checkpoint; p: FlatPath; s: number }, b: { cp: Checkpoint; p: FlatPath; s: number }): RoutePoint[] | null {
    const pts: RoutePoint[] = [];
    if (a.p.id === b.p.id) return walk(a.p, a.s, b.s, a.cp.dir, pts) ? pts : null;

    if (!b.p.closed) {
        const entryS = b.cp.dir === 1 ? 0 : pathLength(b.p);
        const e = pointAt(b.p, entryS);
        const j = projectOntoPath(a.p, e.x, e.y);
        if (j && j.distance < j.halfWidth
            && walk(a.p, a.s, j.arcLength, a.cp.dir, pts)
            && walk(b.p, entryS, b.s, b.cp.dir, pts)) return pts;
        pts.length = 0;
    }
    if (!a.p.closed) {
        const exitS = a.cp.dir === 1 ? pathLength(a.p) : 0;
        const x = pointAt(a.p, exitS);
        const j = projectOntoPath(b.p, x.x, x.y);
        if (j && j.distance < j.halfWidth
            && walk(a.p, a.s, exitS, a.cp.dir, pts)
            && walk(b.p, j.arcLength, b.s, b.cp.dir, pts)) return pts;
    }
    return null;
}

const polylineLength = (pts: RoutePoint[]): number => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
};

// Driving line through `cps` (the raced checkpoints, lap order, start
// first). `loop` adds the leg from the last checkpoint back to the start.
// Error when a checkpoint's path is missing or two consecutive checkpoints
// on different paths aren't joined by a connector end.
export function buildRoute(paths: Map<string, FlatPath>, cps: Checkpoint[], loop: boolean): Route | { error: string } {
    const placed = [];
    for (const [i, cp] of cps.entries()) {
        const p = paths.get(cp.path);
        const proj = p ? projectOntoPath(p, cp.pos.x, cp.pos.y) : null;
        if (!p || !proj) return { error: `checkpoint #${i + 1} is not on a path` };
        placed.push({ cp, p, s: proj.arcLength });
    }
    const legs: RouteLeg[] = [];
    const count = loop ? placed.length : placed.length - 1;
    for (let i = 0; i < count; i++) {
        const points = leg(placed[i], placed[(i + 1) % placed.length]);
        if (!points) return { error: `no road joins checkpoint #${i + 1} and #${((i + 1) % placed.length) + 1}` };
        legs.push({ points, length: polylineLength(points) });
    }
    return { legs, length: legs.reduce((sum, l) => sum + l.length, 0) };
}

// Points at the given distances along a polyline (distances ascending).
export function pointsAlong(pts: RoutePoint[], distances: number[]): RoutePoint[] {
    const out: RoutePoint[] = [];
    let acc = 0, i = 1;
    for (const d of distances) {
        while (i < pts.length) {
            const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            if (acc + seg >= d) {
                const t = seg > 1e-9 ? (d - acc) / seg : 0;
                const a = pts[i - 1], b = pts[i];
                // Take the path/dir of the segment's end point — both ends of a
                // segment lie on the same path except at a junction.
                out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, path: b.path, dir: b.dir });
                break;
            }
            acc += seg;
            i++;
        }
    }
    return out;
}
