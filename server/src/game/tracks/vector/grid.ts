import type { GridSettings, Layout } from '../types';
import { fromMetersToPixels } from '../../helper';
import { projectOntoPath, type FlatPath } from './paths';
import { pathLength, pointAt } from './route';

// Start grid: boxes behind a layout's start line, following the road
// BACKWARDS from it along the start checkpoint's path (a box may sit in a
// curve). Two columns: slot 1 (pole) on the layout's `gridPole` side, then
// alternating sides — staggered (each next slot `rowM` further back) or
// side by side (`staggered: false`, pairs). Spacing, box size and
// formation per track (`GridSettings`), count and pole side per layout.
// Pure — the editor draws the boxes and the game spawns cars in them from
// the same road (`startRoad`).
//
// A closed path wraps. An open path stops at its entry end (boxes past it
// stack there) — no current layout starts on one.

export const GRID_MIN_SLOTS = 2;
// Painted line width (m). Lines sit INSIDE the box: its size is the outside.
export const GRID_PAINT_M = 0.1;
// Go-kart track defaults, metres.
export const GRID_DEFAULTS: Required<GridSettings> = {
    gapM: 1,
    rowM: 3,
    columnM: 3,
    boxLengthM: 2,
    boxWidthM: 1.2,
    staggered: true,
};

// One box. x / y = the middle of its FRONT edge (where a car's front goes),
// angle = direction of travel there (degrees), back = distance along the
// road from the start line to that point (px).
export type GridSlot = { x: number; y: number; angle: number; back: number };

type Xy = { x: number; y: number };
// A point `back` px behind the start line along the road, `side` px to the
// right of the centreline (seen in the direction of travel), and the unit
// direction of travel there.
type Road = (back: number, side: number) => Xy & { tx: number; ty: number };

// Side lines are sampled along the road this often (0.25 m).
const LINE_STEP_PX = 6;

// The layout's boxes, slot 1 (pole) first. Empty without a start checkpoint
// on a path.
export function gridSlots(paths: Map<string, FlatPath>, layout: Layout, grid?: GridSettings): GridSlot[] {
    const road = startRoad(paths, layout);
    if (!road) return [];
    const g = { ...GRID_DEFAULTS, ...grid };
    return boxes(layout, g).map(({ back, side }) => {
        const r = road(back, side);
        return { x: r.x, y: r.y, angle: Math.atan2(r.ty, r.tx) * 180 / Math.PI, back };
    });
}

// The centrelines of the layout's painted box lines (GRID_PAINT_M wide,
// inside the box), as polylines: each box's front line straight across,
// its two sides following the road. A side that starts where the box ahead
// in its column ends (boxes nose to tail) continues that box's line, so a
// column's sides are one unbroken line.
export function gridLines(paths: Map<string, FlatPath>, layout: Layout, grid?: GridSettings): Xy[][] {
    const road = startRoad(paths, layout);
    if (!road) return [];
    const g = { ...GRID_DEFAULTS, ...grid };
    const len = fromMetersToPixels(g.boxLengthM);
    const halfW = fromMetersToPixels(g.boxWidthM) / 2;
    // Half a line in from the box's outside, so the paint ends at its edge.
    const inset = fromMetersToPixels(GRID_PAINT_M) / 2;
    const n = Math.max(1, Math.ceil(len / LINE_STEP_PX));
    const xy = ({ x, y }: Xy): Xy => ({ x, y });
    const lines: Xy[][] = [];
    // Side lines still open for continuing, by lateral position.
    const open = new Map<string, { line: Xy[]; end: number }>();
    for (const { back, side } of boxes(layout, g)) {
        lines.push([xy(road(back + inset, side - halfW)), xy(road(back + inset, side + halfW))]);
        for (const edge of [side - halfW + inset, side + halfW - inset]) {
            const pts = Array.from({ length: n + 1 }, (_, k) => xy(road(back + len * k / n, edge)));
            const key = edge.toFixed(3);
            const prev = open.get(key);
            if (prev && Math.abs(prev.end - back) < 0.01) {
                prev.line.push(...pts.slice(1));
                prev.end = back + len;
            } else {
                lines.push(pts);
                open.set(key, { line: pts, end: back + len });
            }
        }
    }
    return lines;
}

// Each box's distance behind the start line (front) and lateral offset of
// its centre (px, + = right), slot 1 first.
function boxes(layout: Layout, g: Required<GridSettings>): { back: number; side: number }[] {
    const count = Math.max(GRID_MIN_SLOTS, Math.floor(layout.gridSlots ?? GRID_MIN_SLOTS));
    const poleLeft = (layout.gridPole ?? 'left') === 'left';
    const half = fromMetersToPixels(g.columnM) / 2;
    return Array.from({ length: count }, (_, i) => ({
        // Staggered: every box rowM further back. Side by side: pairs, rows 2 × rowM apart.
        back: fromMetersToPixels(g.gapM + (g.staggered ? i : Math.floor(i / 2) * 2) * g.rowM),
        side: ((i % 2 === 0) === poleLeft ? -1 : 1) * half,
    }));
}

// The road behind the layout's start line (the start checkpoint's path,
// against its `dir`). null without a start checkpoint on a path.
function startRoad(paths: Map<string, FlatPath>, layout: Layout): Road | null {
    const start = layout.checkpoints.find(c => c.isStart);
    const p = start ? paths.get(start.path) : undefined;
    const proj = start && p ? projectOntoPath(p, start.pos.x, start.pos.y) : null;
    if (!start || !p || !proj) return null;
    const L = pathLength(p);
    const at = (s: number) => pointAt(p, p.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s)));
    return (back, side) => {
        const s = proj.arcLength - start.dir * back;
        const q = at(s);
        // Direction of travel from the road 1 px either side.
        const a = at(s - start.dir), b = at(s + start.dir);
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / d, ty = (b.y - a.y) / d;
        // The car's right = the direction of travel turned +90° (clockwise on screen).
        return { x: q.x - ty * side, y: q.y + tx * side, tx, ty };
    };
}

// Paint `lines` (gridLines) in the ctx's WORLD transform. `lineWidth` in
// world px.
export function drawGridLines(ctx: CanvasRenderingContext2D, lines: Xy[][], lineWidth: number, color = 'rgba(255, 255, 255, 0.85)'): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const line of lines) {
        ctx.moveTo(line[0].x, line[0].y);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    }
    ctx.stroke();
    ctx.restore();
}

// Editor: the numbers 1–N in the middle of each box, upright and a constant
// size on screen (`zoom` = screen px per world px).
export function drawGridLabels(ctx: CanvasRenderingContext2D, slots: GridSlot[], grid: GridSettings | undefined, zoom: number, color: (i: number) => string): void {
    const len = fromMetersToPixels({ ...GRID_DEFAULTS, ...grid }.boxLengthM);
    ctx.save();
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const base = ctx.getTransform();
    slots.forEach((s, i) => {
        const r = s.angle * Math.PI / 180;
        ctx.setTransform(base.translate(s.x - Math.cos(r) * len / 2, s.y - Math.sin(r) * len / 2).scale(1 / zoom, 1 / zoom));
        ctx.fillStyle = color(i);
        ctx.fillText(String(i + 1), 0, 0);
    });
    ctx.restore();
}
