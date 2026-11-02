// Fit cubic bezier curves to a closed polyline (e.g. a track outline ring),
// using Schneider's algorithm ("An Algorithm for Automatically Fitting
// Digitized Curves", Graphics Gems, 1990): least-squares fit per run, split
// at the worst point until every input point is within `tolerance` px.
//
// Sharp corners (turn > CORNER_DEG) are kept sharp: the ring is cut there
// and each run between corners is fitted on its own.

export type Pt = { x: number; y: number };
// [start, control1, control2, end]
export type Cubic = [Pt, Pt, Pt, Pt];

const CORNER_DEG = 30;
// Points closer than this are merged before fitting (removes integer-grid
// noise from the union step, which would make tangents jitter).
const MIN_SPACING = 0.05;
// Measure turn angles over at least this much distance either side, so
// tiny segments don't fake corners.
const CORNER_REACH = 1.5;
const MAX_ITERATIONS = 4;

export function fitClosedRing(ring: Pt[], tolerance: number): Cubic[] {
    const deduped = dedupe(ring);
    if (deduped.length < 3) return [];
    // Corners are found on the original points, then located again in the
    // resampled list (resample keeps the original point objects).
    const cornerPts = findCorners(deduped).map(i => deduped[i]);
    const pts = resample(deduped);
    const n = pts.length;
    const corners = cornerPts.map(p => pts.indexOf(p)).sort((a, b) => a - b);
    const out: Cubic[] = [];

    if (corners.length === 0) {
        // Smooth loop: start anywhere, with the same tangent at both ends.
        const run = [...pts, pts[0]];
        const t = normalize(sub(pts[1], pts[n - 1]));
        fitCubic(run, 0, run.length - 1, t, scale(t, -1), tolerance, out);
        return out;
    }

    for (let c = 0; c < corners.length; c++) {
        const from = corners[c];
        const to = corners[(c + 1) % corners.length];
        const run: Pt[] = [];
        for (let i = from; ; i = (i + 1) % n) {
            run.push(pts[i]);
            if (i === to && run.length > 1) break;
        }
        const last = run.length - 1;
        const t1 = normalize(sub(run[Math.min(1, last)], run[0]));
        const t2 = normalize(sub(run[Math.max(last - 1, 0)], run[last]));
        fitCubic(run, 0, last, t1, t2, tolerance, out);
    }
    return out;
}

// Best single cubic through `points` (first → last) whose handles leave
// the ends along the given directions (tHat1 forward from the start, tHat2
// backward from the end — Schneider's convention); only the handle lengths
// are fitted. Used to merge two curves when an outline node is deleted.
export function fitCubicWithTangents(points: Pt[], tHat1: Pt, tHat2: Pt): Cubic {
    const last = points.length - 1;
    const t1 = normalize(tHat1);
    const t2 = normalize(tHat2);
    let u = chordLengthParameterize(points, 0, last);
    let curve = generateBezier(points, 0, last, u, t1, t2);
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        u = reparameterize(points, 0, last, u, curve);
        curve = generateBezier(points, 0, last, u, t1, t2);
    }
    return curve;
}

// Max distance (px) from points sampled along the curves to the ring
// polyline — an independent check of the fit (the fitter itself only
// measures at the input points).
export function maxDeviation(curves: Cubic[], ring: Pt[], samplesPerCurve = 32): number {
    let worst = 0;
    for (const c of curves) {
        for (let k = 0; k <= samplesPerCurve; k++) {
            const p = bezier(c, k / samplesPerCurve);
            let best = Infinity;
            for (let i = 0; i < ring.length; i++) {
                best = Math.min(best, distToSegment(p, ring[i], ring[(i + 1) % ring.length]));
            }
            worst = Math.max(worst, best);
        }
    }
    return worst;
}

export function bezier(c: Cubic, t: number): Pt {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return {
        x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
        y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
    };
}

// --- Schneider core ---

function fitCubic(d: Pt[], first: number, last: number, tHat1: Pt, tHat2: Pt,
                  tolerance: number, out: Cubic[]): void {
    if (last - first === 1) {
        const dist = len(sub(d[last], d[first])) / 3;
        out.push([d[first], add(d[first], scale(tHat1, dist)), add(d[last], scale(tHat2, dist)), d[last]]);
        return;
    }

    let u = chordLengthParameterize(d, first, last);
    let curve = generateBezier(d, first, last, u, tHat1, tHat2);
    let [maxError, split] = computeMaxError(d, first, last, curve, u);
    if (maxError < tolerance) {
        out.push(curve);
        return;
    }

    // Close enough to try improving the parameterization first.
    if (maxError < tolerance * 4) {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            u = reparameterize(d, first, last, u, curve);
            curve = generateBezier(d, first, last, u, tHat1, tHat2);
            [maxError, split] = computeMaxError(d, first, last, curve, u);
            if (maxError < tolerance) {
                out.push(curve);
                return;
            }
        }
    }

    const tHatCenter = normalize(sub(d[split - 1], d[split + 1]));
    fitCubic(d, first, split, tHat1, tHatCenter, tolerance, out);
    fitCubic(d, split, last, scale(tHatCenter, -1), tHat2, tolerance, out);
}

function generateBezier(d: Pt[], first: number, last: number, u: number[], tHat1: Pt, tHat2: Pt): Cubic {
    const p0 = d[first], p3 = d[last];
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < u.length; i++) {
        const t = u[i], mt = 1 - t;
        const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
        const a1 = scale(tHat1, b1), a2 = scale(tHat2, b2);
        c00 += dot(a1, a1);
        c01 += dot(a1, a2);
        c11 += dot(a2, a2);
        const tmp = sub(d[first + i], add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
        x0 += dot(a1, tmp);
        x1 += dot(a2, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let alpha1 = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
    let alpha2 = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;

    // Degenerate or wild fit → fall back to the "dist / 3" heuristic.
    // Wild = the two handles cross over each other when projected onto the
    // chord (same check as paper.js); few-point runs can otherwise produce
    // loops that pass through every point but swing far away in between.
    const chord = sub(p3, p0);
    const segLen = len(chord);
    const eps = 1e-6 * segLen;
    if (alpha1 < eps || alpha2 < eps) {
        alpha1 = alpha2 = segLen / 3;
    } else if (dot(scale(tHat1, alpha1), chord) - dot(scale(tHat2, alpha2), chord) > segLen * segLen) {
        alpha1 = alpha2 = segLen / 3;
    }
    return [p0, add(p0, scale(tHat1, alpha1)), add(p3, scale(tHat2, alpha2)), p3];
}

function reparameterize(d: Pt[], first: number, last: number, u: number[], c: Cubic): number[] {
    return u.map((t, i) => newtonRoot(c, d[first + i], t));
}

// One Newton step towards the curve parameter closest to `p`.
function newtonRoot(c: Cubic, p: Pt, t: number): number {
    const q = bezier(c, t);
    const q1 = derivative(c, t);
    const q2 = secondDerivative(c, t);
    const diff = sub(q, p);
    const num = dot(diff, q1);
    const den = dot(q1, q1) + dot(diff, q2);
    if (den === 0) return t;
    return Math.min(1, Math.max(0, t - num / den));
}

function computeMaxError(d: Pt[], first: number, last: number, c: Cubic, u: number[]): [number, number] {
    let max = 0;
    let split = Math.floor((last - first + 1) / 2) + first;
    for (let i = first + 1; i < last; i++) {
        const e = len(sub(bezier(c, u[i - first]), d[i]));
        if (e > max) {
            max = e;
            split = i;
        }
    }
    return [max, split];
}

function chordLengthParameterize(d: Pt[], first: number, last: number): number[] {
    const u = [0];
    for (let i = first + 1; i <= last; i++) u.push(u[i - first - 1] + len(sub(d[i], d[i - 1])));
    const total = u[u.length - 1] || 1;
    return u.map(v => v / total);
}

// --- Ring preparation ---

// The fitter measures error only at input points, so a long straight edge
// with points only at its ends would let the curve bulge in between. Insert
// points so no gap is longer than MAX_SPACING. Original point objects are
// kept so corner indices can be found again.
const MAX_SPACING = 2;

function resample(ring: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        out.push(a);
        const steps = Math.ceil(len(sub(b, a)) / MAX_SPACING);
        for (let k = 1; k < steps; k++) {
            const t = k / steps;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out;
}

function dedupe(ring: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const p of ring) {
        const prev = out[out.length - 1];
        if (!prev || len(sub(p, prev)) >= MIN_SPACING) out.push(p);
    }
    while (out.length > 1 && len(sub(out[0], out[out.length - 1])) < MIN_SPACING) out.pop();
    return out;
}

// Indices where the ring turns by more than CORNER_DEG, measured between
// directions taken at least CORNER_REACH px away on each side.
function findCorners(pts: Pt[]): number[] {
    const n = pts.length;
    const limit = Math.cos((CORNER_DEG * Math.PI) / 180);
    const corners: number[] = [];
    for (let i = 0; i < n; i++) {
        const back = reach(pts, i, -1);
        const fwd = reach(pts, i, +1);
        const a = normalize(sub(pts[i], back));
        const b = normalize(sub(fwd, pts[i]));
        if (dot(a, b) < limit) corners.push(i);
    }
    // Several neighbouring points can flag the same corner; keep the
    // sharpest one per cluster.
    return collapseClusters(pts, corners);
}

function reach(pts: Pt[], i: number, dir: 1 | -1): Pt {
    const n = pts.length;
    let j = i;
    for (let k = 0; k < n - 1; k++) {
        j = (j + dir + n) % n;
        if (len(sub(pts[j], pts[i])) >= CORNER_REACH) return pts[j];
    }
    return pts[j];
}

function collapseClusters(pts: Pt[], idx: number[]): number[] {
    if (idx.length === 0) return idx;
    const n = pts.length;
    const turn = (i: number) => {
        const a = normalize(sub(pts[i], pts[(i - 1 + n) % n]));
        const b = normalize(sub(pts[(i + 1) % n], pts[i]));
        return dot(a, b); // lower = sharper
    };
    // Same corner = flagged points within CORNER_REACH of each other.
    const near = (i: number, j: number) => len(sub(pts[i], pts[j])) < CORNER_REACH;
    const out: number[] = [];
    let cluster: number[] = [idx[0]];
    const flush = () => out.push(cluster.reduce((best, i) => (turn(i) < turn(best) ? i : best)));
    for (let k = 1; k < idx.length; k++) {
        if (near(idx[k], idx[k - 1])) cluster.push(idx[k]);
        else { flush(); cluster = [idx[k]]; }
    }
    // Wrap-around cluster (end of ring next to the start).
    if (out.length > 0 && near(idx[0], cluster[cluster.length - 1])) {
        const merged = [...cluster, out[0]];
        out[0] = merged.reduce((best, i) => (turn(i) < turn(best) ? i : best));
    } else {
        flush();
    }
    return out.sort((a, b) => a - b);
}

// --- Vector helpers ---

function derivative(c: Cubic, t: number): Pt {
    const u = 1 - t;
    return {
        x: 3 * (u * u * (c[1].x - c[0].x) + 2 * u * t * (c[2].x - c[1].x) + t * t * (c[3].x - c[2].x)),
        y: 3 * (u * u * (c[1].y - c[0].y) + 2 * u * t * (c[2].y - c[1].y) + t * t * (c[3].y - c[2].y)),
    };
}

function secondDerivative(c: Cubic, t: number): Pt {
    const u = 1 - t;
    return {
        x: 6 * (u * (c[2].x - 2 * c[1].x + c[0].x) + t * (c[3].x - 2 * c[2].x + c[1].x)),
        y: 6 * (u * (c[2].y - 2 * c[1].y + c[0].y) + t * (c[3].y - 2 * c[2].y + c[1].y)),
    };
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    return len(sub(p, add(a, scale(ab, t))));
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const normalize = (a: Pt): Pt => {
    const l = len(a);
    return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};
