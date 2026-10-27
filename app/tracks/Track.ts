import { Vector } from '~/components/Vector';
import { type TrackJSON, type Anchor, type Checkpoint, type Layout, type OutlineRing } from './types';
import { deserializeTrack } from './serialize';
import { flattenPaths, projectOntoPath } from './vector/paths';
import { isLoopLayout } from './vector/layout';
import { buildRoute, type Route } from './vector/route';
import { buildOutlineGeometry, checkpointEnds, outlinePath } from './vector/outlineShape';
import { drawCheckeredLine } from './vector/checkered';
import { drawTyreWalls } from './vector/tyreWalls';
import type { Bounds, TrackGeometry } from './vector/geometry';
import { fromMetersToPixels } from '~/helper';

// Gap between the start line and the front of a spawning car (1 m).
const SPAWN_GAP_PX = fromMetersToPixels(1);
// Track look in the game.
const TRACK_FILL = '#3c3c3c';
const TRACK_EDGE = '#d8d8d8';
// Finish strip squares: 0.5 m (two rows = a 1 m deep strip).
const FINISH_SQUARE_PX = fromMetersToPixels(0.5);

// Box around the anchors (of all paths) ± their half-widths (fallback without an outline).
function anchorBounds(anchors: Anchor[]): Bounds {
    if (anchors.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
        minX = Math.min(minX, a.pos.x - a.halfWidth);
        minY = Math.min(minY, a.pos.y - a.halfWidth);
        maxX = Math.max(maxX, a.pos.x + a.halfWidth);
        maxY = Math.max(maxY, a.pos.y + a.halfWidth);
    }
    return { minX, minY, maxX, maxY };
}

// ONE Track class. Loads a `TrackJSON` config (vectors are the source of
// truth for both visuals and bounding boxes). No subclasses, no PNG assets.
//
// Rendering, collision, rays, checkpoint lines and bounds all come from
// the stored outline (Stage 2).
//
// A Track instance is ONE layout of a track file: shared geometry + the
// selected layout's checkpoints, lap times and direction.
export class Track {
    // --- Author-authored fields (from JSON) ---
    public readonly name: string;
    public readonly displayName: string;
    public readonly layoutId: string;
    public readonly layoutName: string;
    // "TrackName::layoutId" — the value used in dropdowns and sessions.
    public readonly ref: string;
    // Derived from the layout: start === finish → loop.
    public isLoop: boolean;
    public readonly expectedLapTimes: Record<string, number>;
    // Layout checkpoints in lap order from the start (as exported).
    public readonly centerlineCheckpoints: Checkpoint[];
    // The track edge (bezier rings) — what the game draws, collides with
    // and casts rays against. null = the file has no outline (not raceable).
    public readonly outline: OutlineRing[] | null;
    // Query geometry built from the outline at load (flattened to ≤ 0.1 px
    // lines + a spatial grid). null without an outline.
    public readonly geometry: TrackGeometry | null;

    // --- Derived at construction ---
    // World-space box around the track surface (outline; without one, every
    // path's anchors ± their half-widths). Vector tracks can have negative coords.
    public readonly bounds: Bounds;
    // Size of `bounds` (kept for consumers that only need a size).
    public readonly trackWidth: number;
    public readonly trackHeight: number;
    // Start line center — the layout's START checkpoint, projected onto its
    // path's centerline; angle = direction of travel there (path tangent × its `dir`).
    // Cars spawn behind it: see spawn().
    public readonly startPosition: Vector;
    public readonly startAngle: number;
    // Checkpoint lines in lap order (start first, finish last on one-way):
    // straight across the track at each checkpoint, edge to edge of the
    // outline (same code as the editor's Checkpoints tab).
    public readonly checkpoints: { start: Vector; end: Vector }[];
    // Indices into `checkpoints` (-1 if missing). Same on a loop layout.
    public readonly startIndex: number;
    public readonly finishIndex: number;
    // Centreline driving line through the checkpoints, one leg per checkpoint
    // gap (leg i = checkpoint i → i + 1; a loop's last leg goes back to the
    // start). Used for completedMeters. null if it can't be built.
    public readonly route: Route | null;
    // Per leg: distance (px) along the leg at each of its points, and the
    // distance of the route before the leg starts. Empty without a route.
    public readonly routeArcs: number[][];
    public readonly routeLegStarts: number[];

    // Surface path, built on first draw (Path2D only exists in the browser).
    private surfacePath: Path2D | null = null;

    // `layoutId` omitted or unknown → the file's first layout.
    constructor(json: TrackJSON, layoutId?: string) {
        const data = deserializeTrack(json);
        const layout: Layout = data.layouts.find(l => l.id === layoutId) ?? data.layouts[0];

        this.name = data.name;
        this.displayName = data.displayName;
        this.layoutId = layout.id;
        this.layoutName = layout.name;
        this.ref = `${data.name}::${layout.id}`;
        this.isLoop = isLoopLayout(layout);
        this.expectedLapTimes = layout.expectedLapTimes;
        this.centerlineCheckpoints = layout.checkpoints;

        this.outline = data.outline && data.outline.length > 0 ? data.outline : null;
        // This layout's tyre walls collide, block rays and cut checkpoint lines.
        this.geometry = this.outline ? buildOutlineGeometry(this.outline, layout.walls ?? []) : null;
        if (!this.outline) {
            console.error(`Track "${data.name}" has no outline — generate it in the editor (Outline tab). It can't be raced.`);
        }

        this.bounds = this.geometry ? this.geometry.bounds : anchorBounds(data.paths.flatMap(p => p.anchors));
        this.trackWidth = Math.ceil(this.bounds.maxX - this.bounds.minX);
        this.trackHeight = Math.ceil(this.bounds.maxY - this.bounds.minY);

        // Each checkpoint projects onto ITS path (flattened once).
        const flatPaths = new Map(flattenPaths(data.paths).map(p => [p.id, p]));
        const project = (cp: Checkpoint) => {
            const path = flatPaths.get(cp.path);
            return path ? projectOntoPath(path, cp.pos.x, cp.pos.y) : null;
        };

        // Start line from the start checkpoint + direction of travel there.
        const start = layout.checkpoints.find(c => c.isStart);
        const proj = start ? project(start) : null;
        if (start && proj) {
            const d = start.dir;
            this.startPosition = new Vector(proj.pos.x, proj.pos.y);
            this.startAngle = (Math.atan2(proj.tangent.y * d, proj.tangent.x * d) * 180) / Math.PI;
        } else {
            this.startPosition = new Vector(0, 0);
            this.startAngle = 0;
        }

        const lines = layout.checkpoints.flatMap(cp => {
            const p = project(cp);
            if (!p) return [];
            const { a, b } = checkpointEnds(this.geometry, p);
            return [{ line: { start: new Vector(a.x, a.y), end: new Vector(b.x, b.y) }, cp }];
        });
        this.checkpoints = lines.map(l => l.line);
        this.startIndex = lines.findIndex(l => l.cp.isStart);
        this.finishIndex = lines.findIndex(l => l.cp.isFinish);

        // Same checkpoint list as `checkpoints`, so leg i starts at checkpoint i.
        const route = buildRoute(flatPaths, lines.map(l => l.cp), this.isLoop);
        if ('error' in route) {
            console.error(`Track "${data.name}" / "${layout.name}": no route for completedMeters (${route.error}).`);
            this.route = null;
        } else {
            this.route = route;
        }
        this.routeArcs = (this.route?.legs ?? []).map(leg => {
            const arcs = [0];
            for (let i = 1; i < leg.points.length; i++) {
                const a = leg.points[i - 1], b = leg.points[i];
                arcs.push(arcs[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
            }
            return arcs;
        });
        let before = 0;
        this.routeLegStarts = (this.route?.legs ?? []).map(leg => {
            const s = before;
            before += leg.length;
            return s;
        });
    }

    // Where a car of `carLengthPx` starts: centered across the track, its
    // front SPAWN_GAP_PX behind the start line, facing the direction of
    // travel. Returns the car's CENTER and heading (degrees).
    public spawn(carLengthPx: number): { x: number; y: number; angle: number } {
        const rad = (this.startAngle * Math.PI) / 180;
        const back = this.leadIn(carLengthPx);
        return {
            x: this.startPosition.x - Math.cos(rad) * back,
            y: this.startPosition.y - Math.sin(rad) * back,
            angle: this.startAngle,
        };
    }

    // Distance (px) from a spawned car's CENTER straight forward to the start
    // line. completedMeters counts this stretch first (lap 1 only).
    public leadIn(carLengthPx: number): number {
        return SPAWN_GAP_PX + carLengthPx / 2;
    }

    // Distance (px) from (x, y) along `angleDeg` to the track edge, capped at
    // `maxLength`; 0 if (x, y) is off the track. Without an outline there
    // are no edges, so it returns `maxLength`.
    public castRay(x: number, y: number, angleDeg: number, maxLength: number): number {
        return this.geometry ? this.geometry.castRay(x, y, angleDeg, maxLength) : maxLength;
    }

    // True if the segment (x1, y1) → (x2, y2) crosses the track edge (e.g. a
    // sharp inner corner poking into the side of a car). No outline → false.
    public segmentCrossesEdge(x1: number, y1: number, x2: number, y2: number): boolean {
        return this.geometry ? this.geometry.segmentCrossesEdge(x1, y1, x2, y2) : false;
    }

    public getExpectedLapTimeFor(carName: string): number {
        return this.expectedLapTimes[carName] ?? 0;
    }

    // True if (x, y) is off the track surface (outside the outline). Without
    // an outline nothing collides (the track isn't raceable anyway).
    public isPointColliding(x: number, y: number): boolean {
        return this.geometry ? !this.geometry.isOnTrack(x, y) : false;
    }

    // Draw the track in the ctx's current WORLD transform. `zoom` = screen px
    // per world px (keeps edge/line widths constant on screen).
    //   - surface from the outline (+ edge line)
    //   - this layout's tyre walls as rows of tyres
    //   - every checkpoint as a faint white line
    //   - start and finish both as two-row checkered strips (on a loop they
    //     are the same line → one strip)
    //   - debug: checkpoint numbers
    public draw(ctx: CanvasRenderingContext2D, zoom: number, showDebug: boolean = false): void {
        if (this.outline) {
            this.surfacePath ??= outlinePath(this.outline);
            ctx.save();
            ctx.fillStyle = TRACK_FILL;
            ctx.fill(this.surfacePath, 'evenodd');
            ctx.strokeStyle = TRACK_EDGE;
            ctx.lineWidth = 2 / zoom;
            ctx.stroke(this.surfacePath);
            ctx.restore();
        }
        if (this.geometry) drawTyreWalls(ctx, this.geometry.walls.lines, zoom);

        ctx.save();
        ctx.lineCap = 'butt';
        this.checkpoints.forEach((cp, i) => {
            if (i === this.startIndex || i === this.finishIndex) return;
            strokeLine(ctx, cp, 'rgba(255, 255, 255, 0.3)', 2 / zoom);
        });
        const start = this.checkpoints[this.startIndex];
        if (start && this.startIndex !== this.finishIndex) drawCheckeredLine(ctx, start.start, start.end, FINISH_SQUARE_PX);
        const finish = this.checkpoints[this.finishIndex];
        if (finish) drawCheckeredLine(ctx, finish.start, finish.end, FINISH_SQUARE_PX);

        if (showDebug) {
            this.checkpoints.forEach((cp, i) => {
                // Number just past the `start` end, constant size on screen.
                const dx = cp.start.x - cp.end.x, dy = cp.start.y - cp.end.y;
                const l = Math.hypot(dx, dy) || 1;
                const off = 12 / zoom;
                ctx.save();
                ctx.translate(cp.start.x + (dx / l) * off, cp.start.y + (dy / l) * off);
                ctx.scale(1 / zoom, 1 / zoom);
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3ddc84';
                ctx.fillText(String(i + 1), 0, 0);
                ctx.restore();
            });
        }
        ctx.restore();
    }
}

function strokeLine(ctx: CanvasRenderingContext2D, l: { start: Vector; end: Vector }, color: string, width: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(l.start.x, l.start.y);
    ctx.lineTo(l.end.x, l.end.y);
    ctx.stroke();
}
