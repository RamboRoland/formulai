import * as ClipperLib from 'clipper-lib';
import { Vector } from '~/components/Vector';
import type { Anchor, OutlineNode, OutlineRing, TrackPath } from '~/tracks/types';
import { fitClosedRing, type Cubic } from './fitCurves';

// Editor-side generation of a track's outline (the Outline tab's
// "Generate" button). The game never runs this — it reads the stored
// outline. Clipper is only needed here.

// Clipper works in integers: world px × SCALE → 0.01 px precision.
const SCALE = 100;
// Max distance (px) between a true disc edge and its polygon approximation.
const ARC_TOLERANCE = 0.1;
// Max distance (px) between the fitted curves and the exact edge.
export const OUTLINE_FIT_TOLERANCE = 0.25;
// Handles within this angle of a straight line count as mirrored (smooth
// node); anything sharper is a corner with independent handles.
const SMOOTH_NODE_DEG = 2;

// Paths → outline rings of bezier nodes, ready to store in the track.
// Ring shapes: see computeSmoothOutline. Each fitted curve's end is the
// next curve's start, so curve k becomes node k with `out` = its first
// control point and `in` = the previous curve's second control point.
export function generateOutline(paths: TrackPath[]): OutlineRing[] {
    return computeSmoothOutline(paths)
        .map(ring => cubicsToRing(fitClosedRing(ring, OUTLINE_FIT_TOLERANCE)))
        .filter(ring => ring.length >= 2);
}

function cubicsToRing(cubics: Cubic[]): OutlineRing {
    const n = cubics.length;
    return cubics.map((c, k) => {
        const prev = cubics[(k - 1 + n) % n];
        const node: OutlineNode = {
            pos: new Vector(c[0].x, c[0].y),
            in: new Vector(prev[2].x, prev[2].y),
            out: new Vector(c[1].x, c[1].y),
        };
        if (!isSmooth(node.in!, node.pos, node.out!)) node.asymmetric = true;
        return node;
    });
}

// True if in → pos → out is (nearly) a straight line through the node.
function isSmooth(inH: Xy, pos: Xy, outH: Xy): boolean {
    const ax = pos.x - inH.x, ay = pos.y - inH.y;
    const bx = outH.x - pos.x, by = outH.y - pos.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return false;
    return (ax * bx + ay * by) / (la * lb) >= Math.cos((SMOOTH_NODE_DEG * Math.PI) / 180);
}

// Max spacing (px) between edge samples along a bezier, and the cap on
// samples per segment. Dense enough that the sampled edge has no visible
// kinks (unlike the 40-step flattened centerline).
const EDGE_SAMPLE_SPACING = 2;
const MAX_SAMPLES_PER_SEGMENT = 600;

// The same track outline, but sampled from the SMOOTH edge instead of the
// disc + quad pieces: for every point on the bezier centerline, the edge is
// where a disc of the local half-width touches the outline of the swept
// band (the "envelope"). Where the width changes, the touch point shifts
// along the direction of travel:
//     edge = center + w · (−w′·T ± √(1 − w′²)·N)
// with T = unit tangent, N = unit normal, w′ = dw/ds (width change per px).
// Sharp anchors (tangent jump) get a true arc on the outer side.
//
// Every path (main loop + connector roads) adds its pieces; ONE union of
// all of them gives the track surface, so where a connector's end sits on
// another road the two surfaces merge into a junction. Strips are cleaned
// on their own first, so folds on tight inner corners are trimmed
// correctly by the union.
export function computeSmoothOutline(trackPaths: TrackPath[]): Vector[][] {
    const paths: ClipperLib.Paths = [];
    for (const p of trackPaths) addPathPieces(p.anchors, p.closed, paths);
    if (paths.length === 0) return [];

    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    const solution: ClipperLib.Paths = [];
    clipper.Execute(
        ClipperLib.ClipType.ctUnion, solution,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero,
    );
    // Strips meet edge-to-edge; integer rounding can leave zero-area
    // pinholes along those seams. Drop anything under MIN_RING_AREA px².
    return solution
        .filter(ring => ring.length >= 3 && Math.abs(ClipperLib.Clipper.Area(ring)) / (SCALE * SCALE) >= MIN_RING_AREA)
        .map(ring => ring.map(q => new Vector(q.X / SCALE, q.Y / SCALE)));
}

// One path's surface pieces (anchor discs, edge strips, corner arcs),
// appended to `paths` for the union. A closed path also gets the segment
// and corner from its last anchor back to the first; an open path ends at
// its end anchors' full discs (round ends).
function addPathPieces(anchors: Anchor[], closed: boolean, paths: ClipperLib.Paths): void {
    const n = anchors.length;
    if (n < 2) return;
    // A strip (centerline forward, edge backward) can fold over itself on
    // tight inner corners. Clean each one on its own first (non-zero), so
    // every piece entering the final union is simple and same-oriented.
    const addStrip = (center: Xy[], edge: Xy[]) => {
        const ring = [...center, ...edge.slice().reverse()].map(p => pt(p.x, p.y));
        for (const piece of ClipperLib.Clipper.SimplifyPolygon(ring, ClipperLib.PolyFillType.pftNonZero)) {
            paths.push(oriented(piece));
        }
    };
    const addPie = (pts: Xy[]) => paths.push(oriented(pts.map(p => pt(p.x, p.y))));

    // Width peaks sit on anchors (the width eases in and out between them),
    // and where it shrinks faster than the track advances the shape is just
    // the anchor's disc — so every anchor gets its full disc.
    for (const a of anchors) paths.push(oriented(discPath(a.pos.x, a.pos.y, a.halfWidth)));

    // Tangent at the end of the previous segment, for the corner arcs.
    let prevEndTangent: Xy | null = null;
    let firstStartTangent: Xy | null = null;

    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
        const a = anchors[i];
        const b = anchors[(i + 1) % n];
        const p0 = a.pos, p3 = b.pos;
        const c1 = a.controlOut ?? a.pos;
        const c2 = b.controlIn ?? b.pos;

        const approxLen = dist(p0, c1) + dist(c1, c2) + dist(c2, p3);
        const steps = Math.min(MAX_SAMPLES_PER_SEGMENT, Math.max(8, Math.ceil(approxLen / EDGE_SAMPLE_SPACING)));

        const centers: Xy[] = [];
        const lefts: Xy[] = [];
        const rights: Xy[] = [];
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const c = cubicAt(p0, c1, c2, p3, t);
            const tan = unitTangent(p0, c1, c2, p3, t);
            const speed = Math.max(1e-9, len(cubicDeriv(p0, c1, c2, p3, t)));
            const w = a.halfWidth + (b.halfWidth - a.halfWidth) * t * t * (3 - 2 * t);
            const dwdt = (b.halfWidth - a.halfWidth) * 6 * t * (1 - t);
            const wp = Math.max(-0.99, Math.min(0.99, dwdt / speed));
            const along = -wp * w;
            const across = Math.sqrt(1 - wp * wp) * w;
            const nx = -tan.y, ny = tan.x;
            const l = { x: c.x + tan.x * along + nx * across, y: c.y + tan.y * along + ny * across };
            const r = { x: c.x + tan.x * along - nx * across, y: c.y + tan.y * along - ny * across };

            if (s === 0) {
                if (prevEndTangent) cornerArcs(p0, a.halfWidth, prevEndTangent, tan, addPie);
                else firstStartTangent = tan;
            }
            centers.push(c);
            lefts.push(l);
            rights.push(r);
            if (s === steps) prevEndTangent = tan;
        }
        addStrip(centers, lefts);
        addStrip(centers, rights);
    }
    // Close the loop: corner at anchors[0] between the last and first segment.
    if (closed && prevEndTangent && firstStartTangent) {
        cornerArcs(anchors[0].pos, anchors[0].halfWidth, prevEndTangent, firstStartTangent, addPie);
    }
}

const MIN_RING_AREA = 1;

type Xy = { x: number; y: number };

// Pie slices filling the arc between the incoming and outgoing edge
// directions at a sharp anchor, on both sides (the inner side's slice lies
// inside the band already and changes nothing).
function cornerArcs(center: Xy, r: number, tIn: Xy, tOut: Xy,
                    addPie: (pts: Xy[]) => void): void {
    const aIn = Math.atan2(tIn.y, tIn.x);
    const aOut = Math.atan2(tOut.y, tOut.x);
    let delta = aOut - aIn;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < 1e-4) return;
    const maxStep = r <= ARC_TOLERANCE ? Math.PI / 4 : 2 * Math.acos(1 - ARC_TOLERANCE / r);
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
    for (const side of [Math.PI / 2, -Math.PI / 2]) {
        const pie: Xy[] = [center];
        for (let k = 0; k <= steps; k++) {
            const ang = aIn + side + (delta * k) / steps;
            pie.push({ x: center.x + Math.cos(ang) * r, y: center.y + Math.sin(ang) * r });
        }
        addPie(pie);
    }
}

function cubicAt(p0: Xy, p1: Xy, p2: Xy, p3: Xy, t: number): Xy {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function cubicDeriv(p0: Xy, p1: Xy, p2: Xy, p3: Xy, t: number): Xy {
    const u = 1 - t;
    return {
        x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
        y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
    };
}

// Unit tangent; falls back to nearby chord directions where the derivative
// vanishes (a handle collapsed onto its anchor, e.g. linear segments).
function unitTangent(p0: Xy, p1: Xy, p2: Xy, p3: Xy, t: number): Xy {
    let d = cubicDeriv(p0, p1, p2, p3, t);
    if (len(d) < 1e-9) {
        const h = t < 0.5 ? 1e-3 : -1e-3;
        const q = cubicAt(p0, p1, p2, p3, t + h);
        const p = cubicAt(p0, p1, p2, p3, t);
        d = h > 0 ? { x: q.x - p.x, y: q.y - p.y } : { x: p.x - q.x, y: p.y - q.y };
    }
    const l = len(d) || 1;
    return { x: d.x / l, y: d.y / l };
}

const len = (v: Xy): number => Math.hypot(v.x, v.y);
const dist = (a: Xy, b: Xy): number => Math.hypot(a.x - b.x, a.y - b.y);

// Regular polygon inscribed in the disc, with enough vertices that the
// gap to the true circle stays under ARC_TOLERANCE.
function discPath(cx: number, cy: number, r: number): ClipperLib.Path {
    const steps = r <= ARC_TOLERANCE
        ? 8
        : Math.max(8, Math.ceil(Math.PI / Math.acos(1 - ARC_TOLERANCE / r)));
    const path: ClipperLib.Path = [];
    for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        path.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return path;
}

function oriented(path: ClipperLib.Path): ClipperLib.Path {
    if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
    return path;
}

function pt(x: number, y: number): ClipperLib.IntPoint {
    return { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) };
}
