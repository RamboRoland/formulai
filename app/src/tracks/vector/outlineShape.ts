import type { OutlineRing, TyreWall } from '~/tracks/types';
import type { Cubic } from './fitCurves';
import type { CenterlineProjection } from './project';
import { TrackGeometry } from './geometry';
import { TyreWalls } from './tyreWalls';

// Working with a STORED outline and tyre walls (editor + game). No Clipper
// here — the game imports this, generation lives in ./outline.

type Xy = { x: number; y: number };

// Max distance (px) between a flattened outline and its true curves.
const FLATTEN_TOLERANCE = 0.1;

// Stored ring → one cubic per side (node k → node k+1, wrapping). A side
// with no handles comes out as a straight cubic (controls on the ends).
export function ringToCubics(ring: OutlineRing): Cubic[] {
    const out: Cubic[] = [];
    for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        out.push([a.pos, a.out ?? a.pos, b.in ?? b.pos, b.pos]);
    }
    return out;
}

// Outline → closed polylines within FLATTEN_TOLERANCE of the curves. Steps
// per side from Wang's formula (enough that every chord stays within the
// tolerance), so straights cost 1 segment and tight curves get more.
export function flattenOutline(outline: OutlineRing[]): Xy[][] {
    // The ring closes back to the first point, so no end point is added.
    return outline.map(ring => flattenCubics(ringToCubics(ring)));
}

// Tyre wall (open chain of nodes, no closing side) → open polyline, same
// tolerance as the outline. A 1-node wall is a single point.
export function flattenWall(wall: TyreWall): Xy[] {
    const nodes = wall.nodes;
    if (nodes.length < 2) return nodes.map(n => ({ x: n.pos.x, y: n.pos.y }));
    const cubics: Cubic[] = [];
    for (let k = 0; k < nodes.length - 1; k++) {
        const a = nodes[k], b = nodes[k + 1];
        cubics.push([a.pos, a.out ?? a.pos, b.in ?? b.pos, b.pos]);
    }
    const last = nodes[nodes.length - 1].pos;
    return [...flattenCubics(cubics), { x: last.x, y: last.y }];
}

// Cubics → each one's start + interior points (its end is the next one's
// start). Steps per cubic from Wang's formula.
function flattenCubics(cubics: Cubic[]): Xy[] {
    const pts: Xy[] = [];
    for (const c of cubics) {
        const ddx = Math.max(Math.abs(c[0].x - 2 * c[1].x + c[2].x), Math.abs(c[1].x - 2 * c[2].x + c[3].x));
        const ddy = Math.max(Math.abs(c[0].y - 2 * c[1].y + c[2].y), Math.abs(c[1].y - 2 * c[2].y + c[3].y));
        const steps = Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / FLATTEN_TOLERANCE)));
        for (let s = 0; s < steps; s++) pts.push(cubicAt(c, s / steps));
    }
    return pts;
}

// All rings as one canvas path of true bezier curves. Fill it with the
// 'evenodd' rule to get the track surface (outer ring minus infield).
export function outlinePath(outline: OutlineRing[]): Path2D {
    const path = new Path2D();
    for (const ring of outline) {
        const cubics = ringToCubics(ring);
        if (cubics.length === 0) continue;
        path.moveTo(cubics[0][0].x, cubics[0][0].y);
        for (const c of cubics) path.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
        path.closePath();
    }
    return path;
}

// Ready-to-query geometry (on-track, rays, edge crossings) for an outline,
// plus one layout's tyre walls (none = outline only).
export function buildOutlineGeometry(outline: OutlineRing[], walls: TyreWall[] = []): TrackGeometry {
    return new TrackGeometry(flattenOutline(outline), new TyreWalls(walls.map(flattenWall)));
}

// A checkpoint's line: from its point on the centerline, straight across
// (perpendicular to the direction of travel) out to the outline on both
// sides. Without an outline — or if a side finds no edge nearby — that side
// falls back to the centerline half-width.
export function checkpointEnds(geometry: TrackGeometry | null, p: CenterlineProjection): { a: Xy; b: Xy } {
    const nx = -p.tangent.y;
    const ny = p.tangent.x;
    const reach = (sx: number, sy: number): number => {
        if (!geometry) return p.halfWidth;
        const maxLen = p.halfWidth * 4 + 100;
        const d = geometry.castRay(p.pos.x, p.pos.y, (Math.atan2(sy, sx) * 180) / Math.PI, maxLen);
        return d > 0 && d < maxLen ? d : p.halfWidth;
    };
    const da = reach(nx, ny);
    const db = reach(-nx, -ny);
    return {
        a: { x: p.pos.x + nx * da, y: p.pos.y + ny * da },
        b: { x: p.pos.x - nx * db, y: p.pos.y - ny * db },
    };
}

function cubicAt(c: Cubic, t: number): Xy {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return {
        x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
        y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
    };
}
