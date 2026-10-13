import { Vector } from '~/components/Vector';
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
// stops at its last point. Linear scan over the flat segments — fine for
// editor use and per-checkpoint setup.
export function projectOntoCenterline(flat: FlatPoint[], x: number, y: number, closed: boolean = true): CenterlineProjection | null {
    const n = flat.length;
    if (n < 2) return null;

    let best: CenterlineProjection | null = null;
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
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
        if (best && d >= best.distance) continue;
        const len = Math.sqrt(len2);
        // The closing segment (last → first) has no stored arc length beyond
        // flat[n-1]; extend from there.
        const startArc = a.arcLength;
        best = {
            pos: new Vector(px, py),
            tangent: new Vector(dx / len, dy / len),
            halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
            arcLength: startArc + len * t,
            distance: d,
        };
    }
    return best;
}
