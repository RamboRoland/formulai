import { Vector } from '~/components/Vector';
import type { Anchor } from '~/tracks/types';
import type { FlatPoint } from './types';

// Subdivisions per segment. Higher = smoother bezier outlines and smaller
// inner-apex overshoot on tight curves (fewer visible flat segments). 40
// gives sub-pixel error on typical track-size curves at default zoom while
// staying cheap (~40 × N anchors flat points, no measurable per-frame cost).
const STEPS_PER_SEGMENT = 40;

// Flatten the ordered anchors into a dense polyline of FlatPoints.
// `closed` (default) = a loop: the last anchor connects back to the first.
// Open = a connector road: n − 1 segments, ends at the last anchor.
// Segment-by-segment: for each adjacent (A→B) pair (wrapping last→first),
// evaluate the cubic bezier at STEPS_PER_SEGMENT parameter values. If an
// anchor has no bezier controls on an outgoing side, the control point
// collapses to the anchor itself — equivalent to a linear segment.
//
// Tangents are computed as a POST-PASS from chord directions (prev → next
// flat point) rather than the analytical bezier derivative. This:
// - Avoids the zero-derivative-at-endpoints problem for linear segments.
// - Produces a bisector tangent at sharp corners, which gives the offset
//   polyline a reasonable (if not fully mitered) corner geometry.
// - Still tracks bezier curves correctly since the chord direction converges
//   to the analytical tangent as subdivision density increases.
//
// `halfWidth` is lerped by parameter `t` across each segment. Interpolating
// by arc-length instead would be more "even" visually on highly non-uniform
// curves but requires a two-pass walk; `t`-interpolation is close enough for
// typical track authoring.
//
// `arcLength` is the cumulative world-pixel distance from flat[0] along the
// polyline, measured chord-by-chord.
export function flattenCenterline(anchors: Anchor[], closed: boolean = true): FlatPoint[] {
    if (anchors.length < 2) return [];

    // Pass 1: emit (position, halfWidth, isAnchor) per step. The LAST step
    // of each segment IS the anchor shared with the next segment; we emit
    // it only once (from the previous segment's step=STEPS_PER_SEGMENT) and
    // skip step=0 on subsequent segments. On a loop the very last segment's
    // final step would duplicate anchors[0], so we skip it too — the loop
    // closes by wrapping modulo in later consumers. An open path keeps it
    // (that's the last anchor).
    const positions: Vector[] = [];
    const halfWidths: number[] = [];
    const isAnchorFlag: boolean[] = [];
    const segmentIndices: number[] = [];

    const n = anchors.length;
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
        const a = anchors[i];
        const b = anchors[(i + 1) % n];
        const c1 = a.controlOut ?? a.pos;
        const c2 = b.controlIn ?? b.pos;

        const tStart = i === 0 ? 0 : 1;
        // Last loop segment: don't emit step=STEPS (would duplicate anchors[0]).
        const tEnd = closed && i === n - 1 ? STEPS_PER_SEGMENT - 1 : STEPS_PER_SEGMENT;
        for (let step = tStart; step <= tEnd; step++) {
            const t = step / STEPS_PER_SEGMENT;
            positions.push(cubicPoint(a.pos, c1, c2, b.pos, t));
            // Smoothstep (3t² − 2t³): width has zero slope at both anchors, so
            // the band edge flows tangent-continuously through every anchor
            // instead of kinking where one segment's taper rate meets the next.
            const s = t * t * (3 - 2 * t);
            halfWidths.push(a.halfWidth + (b.halfWidth - a.halfWidth) * s);
            // Flag anchor positions: step=0 (anchor a) OR step=STEPS (anchor b).
            isAnchorFlag.push(step === 0 || step === STEPS_PER_SEGMENT);
            segmentIndices.push(i);
        }
    }

    // Pass 2: chord-based tangent + cumulative arc-length. A loop wraps so
    // the first/last flat points get a sensible bisector tangent too; an
    // open path's ends use their one neighbour (one-sided chord).
    const out: FlatPoint[] = new Array(positions.length);
    const len = positions.length;
    let arc = 0;
    for (let i = 0; i < len; i++) {
        const prev = closed ? positions[(i - 1 + len) % len] : positions[Math.max(0, i - 1)];
        const next = closed ? positions[(i + 1) % len] : positions[Math.min(len - 1, i + 1)];
        const tangent = normalize(new Vector(next.x - prev.x, next.y - prev.y));

        if (i > 0) {
            const dx = positions[i].x - positions[i - 1].x;
            const dy = positions[i].y - positions[i - 1].y;
            arc += Math.sqrt(dx * dx + dy * dy);
        }

        out[i] = {
            pos: positions[i],
            tangent,
            halfWidth: halfWidths[i],
            arcLength: arc,
            isAnchor: isAnchorFlag[i],
            segmentIndex: segmentIndices[i],
        };
    }

    return out;
}

// Cubic bezier point: B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³ P3.
function cubicPoint(p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: number): Vector {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    return new Vector(x, y);
}

function normalize(v: Vector): Vector {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-9) return new Vector(1, 0); // degenerate; pick +x as a safe default
    return new Vector(v.x / len, v.y / len);
}
