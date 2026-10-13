import type { Vector } from '~/components/Vector';
import type { OffsetPolylines } from './offset';

// Build a filled-track path from the computed left/right offset polylines.
// Emits an alternating sequence [L0, R0, L1, R1, ...] suitable for either:
// - A canvas 2D `Path2D` built from `moveTo`+`lineTo`s wrapping back around,
//   then `fill()`.
// - A WebGL TRIANGLE_STRIP primitive.
//
// For canvas 2D we don't actually need triangles — just the perimeter walked
// in order (left polyline forward, right polyline reversed) and filled. This
// helper exposes both representations so the eventual renderer can pick.
export function tessellate(poly: OffsetPolylines): {
    stripVertices: Vector[];                 // interleaved left/right (for triangle strip)
    perimeter: Vector[];                     // closed-loop boundary (for Path2D fill)
} {
    const { left, right } = poly;
    const n = Math.min(left.length, right.length);

    const stripVertices: Vector[] = new Array(n * 2);
    for (let i = 0; i < n; i++) {
        stripVertices[i * 2]     = left[i];
        stripVertices[i * 2 + 1] = right[i];
    }

    // Walk left forward, then right backward — closes a filled quad loop.
    const perimeter: Vector[] = new Array(n * 2);
    for (let i = 0; i < n; i++) perimeter[i] = left[i];
    for (let i = 0; i < n; i++) perimeter[n + i] = right[n - 1 - i];

    return { stripVertices, perimeter };
}
