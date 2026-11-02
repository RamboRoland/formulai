import type { Point, RenderTrack } from '~/protocol';
import type { OutlineRing } from '~/tracks/types';
import type { PaintQuad, PaintStrip } from '~/tracks/Track';
import type { Prop } from './trackProps';
import { outlinePath } from '~/tracks/vector/outlineShape';
import { drawTyreWalls } from '~/tracks/vector/tyreWalls';
import { drawGridLines, GRID_PAINT_M } from '~/tracks/vector/grid';
import { drawCheckeredLine } from '~/tracks/vector/checkered';
import { fromMetersToPixels } from '~/helper';

// Painted line width (world px): track edge + grid boxes, both inside.
const PAINT_PX = fromMetersToPixels(GRID_PAINT_M);
// Track look in the game.
export const TRACK_FILL = '#3c3c3c';
const TRACK_EDGE = '#d8d8d8';
// Start / finish line squares.
const FINISH_SQUARE_PX = fromMetersToPixels(0.5);

// One layout as the App draws it: the server's RenderTrack (ready-made
// geometry), no game logic. draw() paints the 2D track exactly as
// Track.draw did; the 3D view reads rings / paint / tyres / props.
export class DrawTrack {
    private surfacePath: Path2D | null = null;

    public constructor(public readonly data: RenderTrack) {}

    public get key(): string { return this.data.key; }
    public get name(): string { return this.data.name; }
    public get bounds(): RenderTrack['bounds'] { return this.data.bounds; }
    public get outline(): OutlineRing[] | null { return this.data.outline as OutlineRing[] | null; }
    public get rings(): Point[][] { return this.data.rings; }
    public get props(): Prop[] { return this.data.props; }
    public paintStrips(): PaintStrip[] { return this.data.paintStrips; }
    public paintQuads(): PaintQuad[] { return this.data.paintQuads; }
    public tyres(): Point[] { return this.data.tyres; }

    public draw(ctx: CanvasRenderingContext2D, zoom: number, showDebug: boolean = false): void {
        const { checkpoints, startIndex, finishIndex } = this.data;
        if (this.outline) {
            this.surfacePath ??= outlinePath(this.outline);
            ctx.save();
            ctx.fillStyle = TRACK_FILL;
            ctx.fill(this.surfacePath, 'evenodd');
            // Twice as wide, clipped to the asphalt → only the inner half shows.
            ctx.clip(this.surfacePath, 'evenodd');
            ctx.strokeStyle = TRACK_EDGE;
            ctx.lineWidth = PAINT_PX * 2;
            ctx.stroke(this.surfacePath);
            ctx.restore();
        }
        if (this.data.walls.length > 0) drawTyreWalls(ctx, this.data.walls, zoom);
        drawGridLines(ctx, this.data.gridLines, PAINT_PX);

        ctx.save();
        ctx.lineCap = 'butt';
        checkpoints.forEach((cp, i) => {
            if (i === startIndex || i === finishIndex) return;
            strokeLine(ctx, cp, 'rgba(255, 255, 255, 0.3)', 2 / zoom);
        });
        const start = checkpoints[startIndex];
        if (start && startIndex !== finishIndex) drawCheckeredLine(ctx, start.start, start.end, FINISH_SQUARE_PX);
        const finish = checkpoints[finishIndex];
        if (finish) drawCheckeredLine(ctx, finish.start, finish.end, FINISH_SQUARE_PX);

        if (showDebug) {
            checkpoints.forEach((cp, i) => {
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

function strokeLine(ctx: CanvasRenderingContext2D, l: { start: Point; end: Point }, color: string, width: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(l.start.x, l.start.y);
    ctx.lineTo(l.end.x, l.end.y);
    ctx.stroke();
}
