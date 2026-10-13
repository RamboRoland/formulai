type Xy = { x: number; y: number };

// Checkered finish strip across the line a → b: two rows of black/white
// squares, the second row staggered by one square (like a chequered flag).
// `square` is the requested square size in the ctx's units; it's adjusted
// slightly so a whole number of squares spans the line exactly. The strip
// is centered on the line (one row each side). Shared by the game and the
// editor so both draw the same finish.
export function drawCheckeredLine(ctx: CanvasRenderingContext2D, a: Xy, b: Xy, square: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9 || square <= 0) return;
    const ux = dx / len, uy = dy / len;
    const count = Math.max(1, Math.round(len / square));
    const s = len / count;

    ctx.save();
    // Line space: origin at a, x along the line, y across it.
    ctx.transform(ux, uy, -uy, ux, a.x, a.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -s, len, 2 * s);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < count; i++) {
            if ((i + row) % 2 === 0) ctx.fillRect(i * s, row === 0 ? -s : 0, s, s);
        }
    }
    ctx.restore();
}
