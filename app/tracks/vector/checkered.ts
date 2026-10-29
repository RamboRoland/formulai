type Xy = { x: number; y: number };

// Checkered finish strip across the line a → b: two rows of black/white
// squares, the second row staggered by one square (like a chequered flag).
// `square` is the requested square size in the ctx's units; it's adjusted
// slightly so a whole number of squares spans the line exactly. The strip
// is centered on the line (one row each side). Shared by the game and the
// editor so both draw the same finish.
export function drawCheckeredLine(ctx: CanvasRenderingContext2D, a: Xy, b: Xy, square: number): void {
    const cells = checkeredCells(a, b, square);
    if (cells.length === 0) return;
    ctx.save();
    // White strip underneath, black squares on top (no seams between fills).
    const n = cells.length / 2; // squares per row
    fillPolygon(ctx, [cells[0].corners[0], cells[n - 1].corners[1], cells[2 * n - 1].corners[2], cells[n].corners[3]], '#ffffff');
    for (const cell of cells) if (cell.black) fillPolygon(ctx, cell.corners, '#000000');
    ctx.restore();
}

// The strip's squares (both rows), each as 4 corners and its colour. Row 0
// lies on one side of the line, row 1 on the other. The 3D view builds its
// finish line from these, so it matches the 2D one exactly.
export function checkeredCells(a: Xy, b: Xy, square: number): { corners: Xy[]; black: boolean }[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9 || square <= 0) return [];
    const ux = dx / len, uy = dy / len;
    const count = Math.max(1, Math.round(len / square));
    const s = len / count;
    // Line space → world: origin at a, x along the line, y across it.
    const at = (x: number, y: number): Xy => ({ x: a.x + ux * x - uy * y, y: a.y + uy * x + ux * y });
    const cells: { corners: Xy[]; black: boolean }[] = [];
    for (let row = 0; row < 2; row++) {
        const y0 = row === 0 ? -s : 0;
        for (let i = 0; i < count; i++) {
            cells.push({
                corners: [at(i * s, y0), at((i + 1) * s, y0), at((i + 1) * s, y0 + s), at(i * s, y0 + s)],
                black: (i + row) % 2 === 0,
            });
        }
    }
    return cells;
}

function fillPolygon(ctx: CanvasRenderingContext2D, pts: Xy[], color: string): void {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}
