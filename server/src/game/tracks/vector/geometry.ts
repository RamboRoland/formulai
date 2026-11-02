import { TyreWalls } from './tyreWalls';

type Xy = { x: number; y: number };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Grid cell size (world px) for the edge index. ~2.7 m at 24 px/m; a cell
// holds a handful of outline edges on typical tracks.
const CELL = 64;

// Runtime queries against a track's outline (as closed polyline rings, e.g.
// the stored bezier outline flattened at load): on-track test, ray
// distance to the edge, and segment-vs-edge crossing for car collision. All
// edges are bucketed into a uniform grid once, so each query only looks at
// edges near it.
export class TrackGeometry {
    public readonly rings: Xy[][];
    public readonly bounds: Bounds;

    // Edge i runs (ax[i], ay[i]) → (bx[i], by[i]).
    private ax: Float64Array;
    private ay: Float64Array;
    private bx: Float64Array;
    private by: Float64Array;

    private originX = 0;
    private originY = 0;
    private cols = 0;
    private rows = 0;
    // Edge indices per grid cell (row-major), and per grid row (for the
    // horizontal crossing test in isOnTrack).
    private cells: number[][] = [];
    private rowEdges: number[][] = [];
    // Visit stamps so an edge spanning several cells is tested once per query.
    private seen: Uint32Array;
    private stamp = 0;

    // Optional tyre walls (one layout's): off-track like outside the outline,
    // and rays / edge crossings stop at them. Empty = outline only.
    public constructor(rings: Xy[][], public readonly walls: TyreWalls = new TyreWalls([])) {
        this.rings = rings;

        let count = 0;
        for (const r of this.rings) count += r.length;
        this.ax = new Float64Array(count);
        this.ay = new Float64Array(count);
        this.bx = new Float64Array(count);
        this.by = new Float64Array(count);
        this.seen = new Uint32Array(count);

        let k = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of this.rings) {
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i];
                const b = ring[(i + 1) % ring.length];
                this.ax[k] = a.x; this.ay[k] = a.y; this.bx[k] = b.x; this.by[k] = b.y;
                k++;
                minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
                maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
            }
        }
        this.bounds = count > 0 ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        if (count > 0) this.buildGrid();
    }

    // True if (x, y) is on the track surface (inside an odd number of rings)
    // and not inside a tyre wall.
    public isOnTrack(x: number, y: number): boolean {
        const row = Math.floor((y - this.originY) / CELL);
        if (row < 0 || row >= this.rows) return false;
        let inside = false;
        for (const e of this.rowEdges[row]) {
            const ay = this.ay[e], by = this.by[e];
            if ((ay > y) === (by > y)) continue;
            const ix = this.ax[e] + ((y - ay) / (by - ay)) * (this.bx[e] - this.ax[e]);
            if (ix > x) inside = !inside;
        }
        return inside && !this.walls.contains(x, y);
    }

    // Distance from (x, y) along `angleDeg` to the first outline edge or tyre
    // wall, capped at `maxLength`. 0 if the start point is already off the
    // track (same as the old pixel ray starting on a wall).
    public castRay(x: number, y: number, angleDeg: number, maxLength: number): number {
        if (!this.isOnTrack(x, y)) return 0;
        const rad = (angleDeg * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);
        let best = Math.min(maxLength, this.walls.rayHit(x, y, dx, dy));

        // Walk the grid cells the ray passes through (Amanatides & Woo) and
        // stop once the best hit lies within the cells walked so far.
        const stamp = this.nextStamp();
        let cx = Math.floor((x - this.originX) / CELL);
        let cy = Math.floor((y - this.originY) / CELL);
        const stepX = dx > 0 ? 1 : -1;
        const stepY = dy > 0 ? 1 : -1;
        const tDeltaX = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
        const tDeltaY = dy !== 0 ? CELL / Math.abs(dy) : Infinity;
        const nextX = this.originX + (cx + (dx > 0 ? 1 : 0)) * CELL;
        const nextY = this.originY + (cy + (dy > 0 ? 1 : 0)) * CELL;
        let tMaxX = dx !== 0 ? (nextX - x) / dx : Infinity;
        let tMaxY = dy !== 0 ? (nextY - y) / dy : Infinity;

        while (cx >= 0 && cx < this.cols && cy >= 0 && cy < this.rows) {
            for (const e of this.cells[cy * this.cols + cx]) {
                if (this.seen[e] === stamp) continue;
                this.seen[e] = stamp;
                const t = rayHit(x, y, dx, dy, this.ax[e], this.ay[e], this.bx[e], this.by[e]);
                if (t >= 0 && t < best) best = t;
            }
            const tExit = Math.min(tMaxX, tMaxY);
            if (best <= tExit || tExit >= maxLength) break;
            if (tMaxX < tMaxY) { tMaxX += tDeltaX; cx += stepX; }
            else { tMaxY += tDeltaY; cy += stepY; }
        }
        return best;
    }

    // True if segment (x1, y1) → (x2, y2) crosses any outline edge or
    // touches a tyre wall.
    public segmentCrossesEdge(x1: number, y1: number, x2: number, y2: number): boolean {
        if (this.walls.segmentHits(x1, y1, x2, y2)) return true;
        const c0 = Math.max(0, Math.floor((Math.min(x1, x2) - this.originX) / CELL));
        const c1 = Math.min(this.cols - 1, Math.floor((Math.max(x1, x2) - this.originX) / CELL));
        const r0 = Math.max(0, Math.floor((Math.min(y1, y2) - this.originY) / CELL));
        const r1 = Math.min(this.rows - 1, Math.floor((Math.max(y1, y2) - this.originY) / CELL));
        const stamp = this.nextStamp();
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                for (const e of this.cells[r * this.cols + c]) {
                    if (this.seen[e] === stamp) continue;
                    this.seen[e] = stamp;
                    if (segmentsCross(x1, y1, x2, y2, this.ax[e], this.ay[e], this.bx[e], this.by[e])) return true;
                }
            }
        }
        return false;
    }

    private buildGrid(): void {
        const b = this.bounds;
        this.originX = b.minX - CELL;
        this.originY = b.minY - CELL;
        this.cols = Math.ceil((b.maxX - this.originX) / CELL) + 1;
        this.rows = Math.ceil((b.maxY - this.originY) / CELL) + 1;
        this.cells = Array.from({ length: this.cols * this.rows }, () => []);
        this.rowEdges = Array.from({ length: this.rows }, () => []);

        for (let e = 0; e < this.ax.length; e++) {
            const c0 = Math.floor((Math.min(this.ax[e], this.bx[e]) - this.originX) / CELL);
            const c1 = Math.floor((Math.max(this.ax[e], this.bx[e]) - this.originX) / CELL);
            const r0 = Math.floor((Math.min(this.ay[e], this.by[e]) - this.originY) / CELL);
            const r1 = Math.floor((Math.max(this.ay[e], this.by[e]) - this.originY) / CELL);
            for (let r = r0; r <= r1; r++) {
                this.rowEdges[r].push(e);
                for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(e);
            }
        }
    }

    private nextStamp(): number {
        this.stamp++;
        if (this.stamp === 0xffffffff) {
            this.seen.fill(0);
            this.stamp = 1;
        }
        return this.stamp;
    }
}

// Ray (ox, oy) + t·(dx, dy), t ≥ 0, against segment a→b. Returns t, or -1.
function rayHit(ox: number, oy: number, dx: number, dy: number,
                ax: number, ay: number, bx: number, by: number): number {
    const ex = bx - ax, ey = by - ay;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) return -1;
    const wx = ax - ox, wy = ay - oy;
    const t = (wx * ey - wy * ex) / denom;
    const u = (wx * dy - wy * dx) / denom;
    if (t < 0 || u < 0 || u > 1) return -1;
    return t;
}

function segmentsCross(x1: number, y1: number, x2: number, y2: number,
                       x3: number, y3: number, x4: number, y4: number): boolean {
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = x4 - x3, d2y = y4 - y3;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return false;
    const wx = x3 - x1, wy = y3 - y1;
    const t = (wx * d2y - wy * d2x) / denom;
    const u = (wx * d1y - wy * d1x) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
