import { Vector } from '../../components/Vector';
import type { FlatPoint } from './types';

export type CenterlineProjection = {
    pos: Vector;        // closest point on the centerline
    tangent: Vector;    // unit direction of travel at that point
    halfWidth: number;  // track half-width at that point (lerped between flat points)
    arcLength: number;  // distance along the centerline from flat[0]
    distance: number;   // distance from the query point to `pos`
};

// Total length of the closed centerline loop (includes the closing segment
// from the last flat point back to the first).
export function lapLength(flat: FlatPoint[]): number {
    const n = flat.length;
    if (n < 2) return 0;
    const last = flat[n - 1], first = flat[0];
    return last.arcLength + Math.hypot(first.pos.x - last.pos.x, first.pos.y - last.pos.y);
}

// Closest point on the flattened centerline to (x, y). `closed` (default) =
// a loop, so the closing segment (last → first) counts too; an open path
// stops at its last point. The game calls it every tick for a car behind
// the start line (Track.behindStart), so the segments are grouped in chunks
// with a bounding box: first a real distance from the nearest chunk (an
// upper bound of the best), then the scan in order skips every chunk whose
// box is farther than that — none of its segments could win. Same segment
// (ties: the first) and the same numbers as scanning them all.
export function projectOntoCenterline(flat: FlatPoint[], x: number, y: number, closed: boolean = true): CenterlineProjection | null {
    const n = flat.length;
    if (n < 2) return null;

    const segments = closed ? n : n - 1;
    const boxes = chunkBoxes(flat, closed, segments);
    const chunks = boxes.length / 4;

    // Upper bound: the best distance in the chunk whose box is nearest.
    let nearest = 0, nearestBox = Infinity;
    for (let c = 0; c < chunks; c++) {
        const d = boxDistance(boxes, c, x, y);
        if (d < nearestBox) { nearestBox = d; nearest = c; }
    }
    let bound = Infinity;
    const end = Math.min(segments, (nearest + 1) * CHUNK);
    for (let i = nearest * CHUNK; i < end; i++) {
        const d = segmentDistance(flat, n, i, x, y);
        if (d < bound) bound = d;
    }

    let bestI = -1, bestT = 0, bestD = 0;
    for (let c = 0; c < chunks; c++) {
        if (boxDistance(boxes, c, x, y) > bound + SKIP_MARGIN_PX) continue;
        const last = Math.min(segments, (c + 1) * CHUNK);
        for (let i = c * CHUNK; i < last; i++) {
            const a = flat[i];
            const b = flat[(i + 1) % n];
            const dx = b.pos.x - a.pos.x;
            const dy = b.pos.y - a.pos.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-12) continue;
            const t = Math.max(0, Math.min(1, ((x - a.pos.x) * dx + (y - a.pos.y) * dy) / len2));
            const px = a.pos.x + dx * t;
            const py = a.pos.y + dy * t;
            const d = Math.hypot(x - px, y - py);
            if (bestI >= 0 && d >= bestD) continue;
            bestI = i; bestT = t; bestD = d;
        }
    }
    if (bestI < 0) return null;

    const a = flat[bestI];
    const b = flat[(bestI + 1) % n];
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    // The closing segment (last → first) has no stored arc length beyond
    // flat[n-1]; extend from there.
    return {
        pos: new Vector(a.pos.x + dx * bestT, a.pos.y + dy * bestT),
        tangent: new Vector(dx / len, dy / len),
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * bestT,
        arcLength: a.arcLength + len * bestT,
        distance: bestD,
    };
}

// Segments per chunk, and how much farther than the bound a chunk's box
// must be to be skipped (px; far above any rounding at track coordinates).
const CHUNK = 32;
const SKIP_MARGIN_PX = 1e-3;

// Chunk boxes per flattened centerline (flattened once per Track, never
// changed): minX, minY, maxX, maxY per chunk, open and closed apart.
const BOXES = new WeakMap<FlatPoint[], { open?: Float64Array; closed?: Float64Array }>();

function chunkBoxes(flat: FlatPoint[], closed: boolean, segments: number): Float64Array {
    let entry = BOXES.get(flat);
    if (!entry) BOXES.set(flat, entry = {});
    const cached = closed ? entry.closed : entry.open;
    if (cached) return cached;

    const n = flat.length;
    const boxes = new Float64Array(Math.ceil(segments / CHUNK) * 4);
    for (let c = 0; c * CHUNK < segments; c++) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const last = Math.min(segments, (c + 1) * CHUNK);
        for (let i = c * CHUNK; i <= last; i++) {
            const p = flat[i % n].pos;
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        boxes[c * 4] = minX; boxes[c * 4 + 1] = minY; boxes[c * 4 + 2] = maxX; boxes[c * 4 + 3] = maxY;
    }
    if (closed) entry.closed = boxes; else entry.open = boxes;
    return boxes;
}

// Distance from (x, y) to chunk c's box (0 inside): no segment in the chunk
// is nearer.
function boxDistance(boxes: Float64Array, c: number, x: number, y: number): number {
    const dx = Math.max(boxes[c * 4] - x, 0, x - boxes[c * 4 + 2]);
    const dy = Math.max(boxes[c * 4 + 1] - y, 0, y - boxes[c * 4 + 3]);
    return Math.sqrt(dx * dx + dy * dy);
}

// Distance from (x, y) to segment i, as projectOntoCenterline computes it
// (Infinity for a zero-length segment, which it skips).
function segmentDistance(flat: FlatPoint[], n: number, i: number, x: number, y: number): number {
    const a = flat[i];
    const b = flat[(i + 1) % n];
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Infinity;
    const t = Math.max(0, Math.min(1, ((x - a.pos.x) * dx + (y - a.pos.y) * dy) / len2));
    return Math.hypot(x - (a.pos.x + dx * t), y - (a.pos.y + dy * t));
}
