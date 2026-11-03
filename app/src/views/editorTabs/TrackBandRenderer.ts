import type { FlatPoint } from '~/tracks/vector/types';
import type { FlatPath } from '~/tracks/vector/paths';

// Track surface opacity (0..1). Lower = more grid/background visible through it.
export const TRACK_SURFACE_ALPHA = 0.55;

// Shared editor render of the track band, used by every editor tab so they all
// show the same track. Owns a scratch canvas for the edge ring, so each tab
// keeps its own instance (create on mount, drop on unmount).
export class TrackBandRenderer {
    private ringCanvas: HTMLCanvasElement | null = null;

    // Draw band + edge ring + dashed centerlines in the ctx's current world
    // transform. All paths form ONE surface (their bands are unioned), so
    // junctions look merged. Paths with < 2 flat points are skipped.
    public draw(ctx: CanvasRenderingContext2D, paths: FlatPath[], zoom: number): void {
        const drawn = paths.filter(p => p.flat.length >= 2);
        if (drawn.length === 0) return;

        // Band render: union of a tapered quad per flat segment plus a disc
        // at every flat point (a round-joined stroke whose radius varies
        // per point). Overlaps at sharp inner corners just cover the same
        // pixels, so there's no apex overshoot; the discs give round
        // outer corners; per-anchor halfWidth tapers smoothly.
        // Edge line: drawn as a RING only (outer band minus inner band) on
        // an offscreen canvas, so the semi-transparent surface on top lets
        // the grid show through instead of the white edge pass.
        const edge = 2 / zoom;
        const inner = buildBandPath(drawn, 0);
        this.drawEdgeRing(ctx, buildBandPath(drawn, edge), inner);

        ctx.save();
        ctx.fillStyle = `rgba(60, 60, 60, ${TRACK_SURFACE_ALPHA})`;
        ctx.fill(inner);

        // Centerline (thin dashed) for authoring reference.
        const center = new Path2D();
        for (const { flat, closed } of drawn) {
            center.moveTo(flat[0].pos.x, flat[0].pos.y);
            for (let i = 1; i < flat.length; i++) center.lineTo(flat[i].pos.x, flat[i].pos.y);
            if (closed) center.closePath();
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.stroke(center);
        ctx.setLineDash([]);
        ctx.restore();
    }

    public dispose(): void {
        this.ringCanvas = null;
    }

    // Draw `outer` minus `inner` in the edge color onto the main canvas.
    // Done offscreen because erasing on the main canvas would also erase the
    // grid/background already drawn there. Uses the main ctx's current
    // world transform so the shapes line up exactly.
    private drawEdgeRing(ctx: CanvasRenderingContext2D, outer: Path2D, inner: Path2D): void {
        const main = ctx.canvas;
        if (!this.ringCanvas) this.ringCanvas = document.createElement('canvas');
        const rc = this.ringCanvas;
        if (rc.width !== main.width) rc.width = main.width;
        if (rc.height !== main.height) rc.height = main.height;
        const r = rc.getContext('2d');
        if (!r) return;

        r.setTransform(1, 0, 0, 1, 0, 0);
        r.clearRect(0, 0, rc.width, rc.height);
        r.setTransform(ctx.getTransform());
        r.fillStyle = 'rgba(220, 220, 220, 0.9)';
        r.fill(outer);
        r.globalCompositeOperation = 'destination-out';
        r.fillStyle = '#000';
        r.fill(inner);
        r.globalCompositeOperation = 'source-over';

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(rc, 0, 0);
        ctx.restore();
    }
}

// Build the band of every path as one Path2D. `extra` widens every shape
// uniformly (used for the edge-line pass).
//
// All subpaths share the same winding (positive shoelace area — same as
// canvas `arc` with anticlockwise=false) so the nonzero fill rule unions
// overlaps (including other paths at junctions) instead of cancelling them.
function buildBandPath(paths: FlatPath[], extra: number): Path2D {
    const path = new Path2D();
    for (const p of paths) addBand(path, p.flat, p.closed, extra);
    return path;
}

// One path's band: a disc at every flat point plus a tapered quad for every
// flat segment (a loop also gets the closing segment).
function addBand(path: Path2D, flat: FlatPoint[], closed: boolean, extra: number): void {
    const n = flat.length;

    for (let i = 0; i < n; i++) {
        const p = flat[i];
        const r = p.halfWidth + extra;
        path.moveTo(p.pos.x + r, p.pos.y);
        path.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
    }

    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
        const a = flat[i];
        const b = flat[(i + 1) % n];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        // Perpendicular of THIS segment (not the chord tangent at the points)
        // so each quad is a true local slab with no cross-corner reach.
        const nx = -dy / len;
        const ny = dx / len;
        const ra = a.halfWidth + extra;
        const rb = b.halfWidth + extra;
        const q = [
            { x: a.pos.x + nx * ra, y: a.pos.y + ny * ra },
            { x: b.pos.x + nx * rb, y: b.pos.y + ny * rb },
            { x: b.pos.x - nx * rb, y: b.pos.y - ny * rb },
            { x: a.pos.x - nx * ra, y: a.pos.y - ny * ra },
        ];
        // Shoelace sign; reverse to match the discs' winding if needed.
        let area = 0;
        for (let k = 0; k < 4; k++) {
            const u = q[k], v = q[(k + 1) % 4];
            area += u.x * v.y - v.x * u.y;
        }
        if (area < 0) q.reverse();
        path.moveTo(q[0].x, q[0].y);
        for (let k = 1; k < 4; k++) path.lineTo(q[k].x, q[k].y);
        path.closePath();
    }
}
