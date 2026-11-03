import { fromMetersToPixels } from '~/helper';

type Xy = { x: number; y: number };

// One tyre is 0.6 m across. A wall collides as a smooth band of that width
// around its (flattened) curve: every point within TYRE_RADIUS_PX of the
// curve, with round ends — a chain of capsules, no gaps between tyres.
export const TYRE_RADIUS_PX = fromMetersToPixels(0.3);

// Collision queries against a layout's tyre walls (game + editor). Each wall
// is an open polyline (see flattenWall in ./outlineShape); there are only a
// few short walls per layout, so every query just loops over their segments
// (with a per-wall bounding-box reject).
export class TyreWalls {
    public readonly lines: Xy[][];
    // Segment i runs (ax[i], ay[i]) → (bx[i], by[i]); a 1-point wall is one
    // zero-length segment (a single tyre).
    private ax: number[] = [];
    private ay: number[] = [];
    private bx: number[] = [];
    private by: number[] = [];
    // Per wall: [first segment, end segment) + bounding box grown by the radius.
    private walls: { s0: number; s1: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];

    public constructor(lines: Xy[][], private readonly r: number = TYRE_RADIUS_PX) {
        this.lines = lines.filter(l => l.length > 0);
        for (const line of this.lines) {
            const s0 = this.ax.length;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < Math.max(1, line.length - 1); i++) {
                const a = line[i], b = line[Math.min(i + 1, line.length - 1)];
                this.ax.push(a.x); this.ay.push(a.y); this.bx.push(b.x); this.by.push(b.y);
            }
            for (const p of line) {
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            }
            this.walls.push({ s0, s1: this.ax.length, minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r });
        }
    }

    public get isEmpty(): boolean {
        return this.walls.length === 0;
    }

    // True if (x, y) is inside a wall band.
    public contains(x: number, y: number): boolean {
        for (const w of this.walls) {
            if (x < w.minX || x > w.maxX || y < w.minY || y > w.maxY) continue;
            for (let i = w.s0; i < w.s1; i++) {
                if (pointSegDist(x, y, this.ax[i], this.ay[i], this.bx[i], this.by[i]) <= this.r) return true;
            }
        }
        return false;
    }

    // Distance along the unit ray (x, y) + t·(dx, dy) to the first wall
    // band, or Infinity. The start point must be outside every band.
    public rayHit(x: number, y: number, dx: number, dy: number): number {
        let best = Infinity;
        for (let i = 0; i < this.ax.length; i++) {
            const t = rayCapsule(x, y, dx, dy, this.ax[i], this.ay[i], this.bx[i], this.by[i], this.r);
            if (t < best) best = t;
        }
        return best;
    }

    // True if segment (x1, y1) → (x2, y2) touches a wall band (e.g. a car side).
    public segmentHits(x1: number, y1: number, x2: number, y2: number): boolean {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        for (const w of this.walls) {
            if (maxX < w.minX || minX > w.maxX || maxY < w.minY || minY > w.maxY) continue;
            for (let i = w.s0; i < w.s1; i++) {
                if (segSegDist(x1, y1, x2, y2, this.ax[i], this.ay[i], this.bx[i], this.by[i]) <= this.r) return true;
            }
        }
        return false;
    }
}

// Tyre centers along an open polyline: both ends get a tyre, spacing as
// close to one tyre diameter as the length allows (so they touch).
export function tyreCenters(line: Xy[], r: number = TYRE_RADIUS_PX): Xy[] {
    if (line.length === 0) return [];
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    const total = cum[cum.length - 1];
    const n = Math.max(1, Math.round(total / (2 * r)));
    const out: Xy[] = [];
    let seg = 1;
    for (let k = 0; k <= n; k++) {
        const s = (total * k) / n;
        while (seg < line.length - 1 && cum[seg] < s) seg++;
        if (line.length === 1) { out.push({ ...line[0] }); break; }
        const a = line[seg - 1], b = line[seg];
        const len = cum[seg] - cum[seg - 1];
        const t = len > 0 ? (s - cum[seg - 1]) / len : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
}

// Draw walls as rows of tyres in the ctx's WORLD transform. `zoom` = screen
// px per world px (keeps the rim line a constant width on screen).
export function drawTyreWalls(ctx: CanvasRenderingContext2D, lines: Xy[][], zoom: number, r: number = TYRE_RADIUS_PX): void {
    ctx.save();
    for (const line of lines) {
        for (const c of tyreCenters(line, r)) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#161616';
            ctx.fill();
            ctx.strokeStyle = '#5c5c5c';
            ctx.lineWidth = 1.5 / zoom;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(c.x, c.y, r * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = '#2e2e2e';
            ctx.fill();
        }
    }
    ctx.restore();
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function segSegDist(x1: number, y1: number, x2: number, y2: number,
                    x3: number, y3: number, x4: number, y4: number): number {
    const d1x = x2 - x1, d1y = y2 - y1, d2x = x4 - x3, d2y = y4 - y3;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) > 1e-12) {
        const wx = x3 - x1, wy = y3 - y1;
        const t = (wx * d2y - wy * d2x) / denom;
        const u = (wx * d1y - wy * d1x) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0; // they cross
    }
    return Math.min(
        pointSegDist(x1, y1, x3, y3, x4, y4), pointSegDist(x2, y2, x3, y3, x4, y4),
        pointSegDist(x3, y3, x1, y1, x2, y2), pointSegDist(x4, y4, x1, y1, x2, y2),
    );
}

// First t ≥ 0 where the unit ray o + t·d reaches distance r from segment
// a→b (a capsule), or Infinity. Assumes o starts outside the capsule.
function rayCapsule(ox: number, oy: number, dx: number, dy: number,
                    ax: number, ay: number, bx: number, by: number, r: number): number {
    let best = Infinity;
    // End caps (circles at a and b).
    for (const [cx, cy] of [[ax, ay], [bx, by]]) {
        const px = ox - cx, py = oy - cy;
        const b = dx * px + dy * py;
        const c = px * px + py * py - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t >= 0 && t < best) best = t;
    }
    // Sides (lines offset ±r, between the caps).
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) return best;
    const ux = ex / len, uy = ey / len;
    const nx = -uy, ny = ux;
    const dn = dx * nx + dy * ny;
    if (Math.abs(dn) < 1e-12) return best;
    const on = (ox - ax) * nx + (oy - ay) * ny;
    for (const s of [r, -r]) {
        const t = (s - on) / dn;
        if (t < 0 || t >= best) continue;
        const along = (ox + dx * t - ax) * ux + (oy + dy * t - ay) * uy;
        if (along >= 0 && along <= len) best = t;
    }
    return best;
}
