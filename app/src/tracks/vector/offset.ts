import { Vector } from '~/components/Vector';
import type { FlatPoint } from './types';

export type OffsetPolylines = {
    left: Vector[];
    right: Vector[];
};

// Build left/right offset polylines bounding the track band.
//
// Step 1 — raw offset: each flat point projects ±halfWidth along the chord-
// based perpendicular. Smooth bezier curves taper naturally; large widths
// render cleanly.
// Step 2 — apex clipping: for sharp inner corners the raw polyline self-
// intersects into a bowtie. Clipping collapses the loop into the single
// intersection point, leaving a V at the apex. Fine when rendered as fill
// only (the V is invisible — just part of the filled boundary).
export function computeOffsetPolylines(flat: FlatPoint[]): OffsetPolylines {
    const raw = computeRawOffset(flat);
    return {
        left:  clipSelfIntersections(raw.left),
        right: clipSelfIntersections(raw.right),
    };
}

function computeRawOffset(flat: FlatPoint[]): OffsetPolylines {
    const left: Vector[] = new Array(flat.length);
    const right: Vector[] = new Array(flat.length);

    for (let i = 0; i < flat.length; i++) {
        const p = flat[i];
        const nx = -p.tangent.y;
        const ny = +p.tangent.x;
        left[i]  = new Vector(p.pos.x + nx * p.halfWidth, p.pos.y + ny * p.halfWidth);
        right[i] = new Vector(p.pos.x - nx * p.halfWidth, p.pos.y - ny * p.halfWidth);
    }

    return { left, right };
}

// Walk a CLOSED polyline and remove self-intersecting loops. For each pair
// of non-adjacent segments that cross, collapse the points between them to
// the single intersection point. Iterates until no self-intersections remain
// (or a safety cap trips so we never loop forever on pathological inputs).
function clipSelfIntersections(poly: Vector[]): Vector[] {
    if (poly.length < 4) return poly;
    let result = poly.slice();
    const SAFETY = 50;

    for (let pass = 0; pass < SAFETY; pass++) {
        const n = result.length;
        let found = false;

        outer: for (let i = 0; i < n; i++) {
            const a1 = result[i];
            const a2 = result[(i + 1) % n];
            for (let j = i + 2; j < n; j++) {
                // Skip the wrap-around adjacent pair (segment 0's start
                // shares an endpoint with segment n-1's end).
                if (i === 0 && j === n - 1) continue;
                const b1 = result[j];
                const b2 = result[(j + 1) % n];
                const X = segmentIntersection(a1, a2, b1, b2);
                if (!X) continue;
                // Collapse points i+1..j into X.
                result = [...result.slice(0, i + 1), X, ...result.slice(j + 1)];
                found = true;
                break outer;
            }
        }

        if (!found) return result;
    }
    return result;
}

// Strict-interior segment-segment intersection. Returns null if the segments
// share an endpoint, are parallel, or merely touch at an endpoint.
function segmentIntersection(a1: Vector, a2: Vector, b1: Vector, b2: Vector): Vector | null {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return null;
    const dx = b1.x - a1.x, dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / denom;
    const u = (dx * d1y - dy * d1x) / denom;
    const EPS = 1e-6;
    if (t <= EPS || t >= 1 - EPS) return null;
    if (u <= EPS || u >= 1 - EPS) return null;
    return new Vector(a1.x + t * d1x, a1.y + t * d1y);
}
