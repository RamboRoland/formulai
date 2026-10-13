import { Vector } from '~/components/Vector';
import type { OutlineNode, TyreWall } from '~/tracks/types';
import { flattenWall } from '~/tracks/vector/outlineShape';
import { drawTyreWalls, tyreCenters } from '~/tracks/vector/tyreWalls';
import { fromPixelsToMeters } from '~/helper';
import { activeLayout, type EditorContext } from './EditorTab';

const NODE_DOT_RADIUS_CSS = 4;
const HANDLE_DOT_RADIUS_CSS = 4;
const NODE_HIT_RADIUS_CSS = 9;
const HANDLE_HIT_RADIUS_CSS = 9;
const CURVE_HIT_RADIUS_CSS = 7;
const DRAG_THRESHOLD_CSS = 4;
// Two clicks this close (ms + CSS px) while drawing = double-click → finish.
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_CSS = 6;
const CURVE_SAMPLES = 24;

type Xy = { x: number; y: number };
type Drag =
    | { type: 'node'; index: number }
    | { type: 'in' | 'out'; index: number }
    | { type: 'none' };

// What the editor needs from the Layout tab that hosts this.
export type WallHost = {
    ctx(): EditorContext | null;
    zoom(): number;
    // Something changed that the tab's list / inspector / hint shows.
    changed(): void;
    // A wall got selected → the host drops its checkpoint selection.
    selectedWall(): void;
};

// Tyre walls of the ACTIVE layout, edited on the Layout tab (in its own
// list next to the checkpoints).
//
// - "Add Tyre Wall": click bend points (snapped to the grid like anchors;
//   Shift = free). Enter, double-click, or the button finishes; Esc
//   finishes too (a wall needs ≥ 2 points, fewer = cancelled). Tyres show
//   live while drawing.
// - Select a wall by clicking it (or its row in the list); its line, bend
//   points and the selected point's handles appear. Drag points (handles
//   follow) and handles (mirrored like the outline; Alt = independent,
//   committed on release). Click the selected wall's line between points
//   to insert one (shape unchanged). Delete removes the selected point
//   (walls keep ≥ 2), or the whole wall when no point is selected.
// - Inspector: tyres + length, Add/Remove curve handles on the selected
//   point, Delete point, Delete wall.
export class TyreWallEditor {
    public placing = false;
    public wall: TyreWall | null = null;    // selected wall
    public node: number | null = null;      // selected point on it

    // The wall being drawn (also in the layout's list while drawing).
    private drawing: TyreWall | null = null;
    private hover: Xy | null = null;
    private lastClick = { time: 0, x: 0, y: 0 };

    private drag: Drag = { type: 'none' };
    private mouseDownClient = { x: 0, y: 0 };
    private hasDragged = false;
    private altDuringDrag = false;

    public constructor(private readonly host: WallHost) {}

    // The active layout's walls (the list is created on first use).
    public walls(): TyreWall[] {
        const ctx = this.host.ctx();
        if (!ctx) return [];
        const layout = activeLayout(ctx.trackState);
        return (layout.walls ??= []);
    }

    public setPlacing(on: boolean): void {
        if (!on && this.drawing) this.finishDrawing();
        this.placing = on;
        if (on) this.select(null);
        this.hover = null;
        this.host.changed();
    }

    public select(wall: TyreWall | null, node: number | null = null): void {
        this.wall = wall;
        this.node = wall ? node : null;
        if (wall) this.host.selectedWall();
        this.host.changed();
    }

    // Layout switched / tab unmounted: drop anything in progress.
    public reset(): void {
        if (this.drawing) this.finishDrawing();
        this.placing = false;
        this.wall = null;
        this.node = null;
        this.hover = null;
        this.drag = { type: 'none' };
    }

    // --- Render ---

    public render(ctx: CanvasRenderingContext2D, zoom: number): void {
        const walls = this.walls();
        const lines = walls.map(flattenWall);
        // Live preview: the wall being drawn runs on to the cursor.
        if (this.drawing && this.hover) {
            const i = walls.indexOf(this.drawing);
            if (i >= 0) lines[i] = [...lines[i], this.hover];
            else lines.push([this.hover]);
        } else if (this.placing && this.hover) {
            lines.push([this.hover]);
        }
        drawTyreWalls(ctx, lines, zoom);

        const sel = this.wall;
        if (!sel) return;
        // Selected wall: its line, points, and the selected point's handles.
        ctx.save();
        ctx.strokeStyle = '#ff8a1f';
        ctx.lineWidth = 2 / zoom;
        const line = flattenWall(sel);
        ctx.beginPath();
        line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        const selNode = this.node !== null ? sel.nodes[this.node] : null;
        if (selNode) this.drawHandles(ctx, selNode, zoom);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 1 / zoom;
        for (const n of sel.nodes) {
            const isSel = n === selNode;
            const r = (NODE_DOT_RADIUS_CSS / zoom) * (isSel ? 1.4 : 1);
            ctx.fillStyle = isSel ? '#ffcf33' : '#ff8a1f';
            ctx.beginPath();
            if (n.asymmetric) ctx.rect(n.pos.x - r, n.pos.y - r, r * 2, r * 2);
            else ctx.arc(n.pos.x, n.pos.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawHandles(ctx: CanvasRenderingContext2D, n: OutlineNode, zoom: number): void {
        const r = HANDLE_DOT_RADIUS_CSS / zoom;
        for (const h of [n.in, n.out]) {
            if (!h) continue;
            ctx.strokeStyle = 'rgba(255, 207, 51, 0.7)';
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            ctx.moveTo(n.pos.x, n.pos.y);
            ctx.lineTo(h.x, h.y);
            ctx.stroke();
            ctx.fillStyle = '#ffcf33';
            ctx.strokeStyle = '#000';
            ctx.beginPath();
            ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    // --- Mouse / keys ---

    // While drawing: every click adds a bend point. Otherwise only the
    // SELECTED wall's handles and points are grabbed here (the host checks
    // checkpoints next, then `onMouseDownCurve`).
    public onMouseDown(e: MouseEvent): boolean {
        const ctx = this.host.ctx();
        if (e.button !== 0 || !ctx) return false;
        if (this.placing) {
            this.addPoint(e);
            return true;
        }
        this.mouseDownClient = { x: e.clientX, y: e.clientY };
        this.hasDragged = false;
        this.altDuringDrag = false;
        const sel = this.wall;
        if (!sel) return false;
        const world = ctx.worldFromClient(e.clientX, e.clientY);
        const zoom = this.host.zoom();

        // Closest wins among the selected point's handles and the wall's points.
        let best: Drag = { type: 'none' };
        let bestD = Infinity;
        const selNode = this.node !== null ? sel.nodes[this.node] : null;
        if (selNode && this.node !== null) {
            for (const key of ['out', 'in'] as const) {
                const h = selNode[key];
                const d = h ? dist(h, world) : Infinity;
                if (d <= HANDLE_HIT_RADIUS_CSS / zoom && d < bestD) { bestD = d; best = { type: key, index: this.node }; }
            }
        }
        sel.nodes.forEach((n, i) => {
            const d = dist(n.pos, world);
            if (d <= NODE_HIT_RADIUS_CSS / zoom && d < bestD) { bestD = d; best = { type: 'node', index: i }; }
        });
        if (best.type === 'none') return false;
        this.drag = best;
        return true;
    }

    // After checkpoints missed: a click on a wall's line selects it; on the
    // already-selected wall it inserts a point there (ready to drag).
    public onMouseDownCurve(e: MouseEvent): boolean {
        const ctx = this.host.ctx();
        if (e.button !== 0 || !ctx || this.placing) return false;
        const world = ctx.worldFromClient(e.clientX, e.clientY);
        const zoom = this.host.zoom();
        const hit = this.hitTestCurve(world, zoom);
        if (!hit) return false;
        if (hit.wall !== this.wall) {
            this.select(hit.wall);
            return true;
        }
        const index = this.insertNode(hit.wall, hit.side, hit.t);
        this.select(hit.wall, index);
        this.drag = { type: 'node', index };
        return true;
    }

    public onMouseMove(e: MouseEvent): boolean {
        const ctx = this.host.ctx();
        if (!ctx) return false;
        if (this.placing) {
            this.hover = ctx.snapPoint(...xy(ctx.worldFromClient(e.clientX, e.clientY)));
            return false;
        }
        const sel = this.wall;
        if (this.drag.type === 'none' || !sel) return false;
        if (!this.hasDragged) {
            if (Math.hypot(e.clientX - this.mouseDownClient.x, e.clientY - this.mouseDownClient.y) < DRAG_THRESHOLD_CSS) return true;
            this.hasDragged = true;
            if (this.drag.type === 'node') this.select(sel, this.drag.index);
        }
        if (e.altKey) this.altDuringDrag = true;
        const node = sel.nodes[this.drag.index];
        if (!node) return true;
        const world = ctx.worldFromClient(e.clientX, e.clientY);

        if (this.drag.type === 'node') {
            // Grid snap like anchors; handles move rigidly with the point.
            const s = ctx.snapPoint(world.x, world.y);
            const dx = s.x - node.pos.x, dy = s.y - node.pos.y;
            node.pos = new Vector(s.x, s.y);
            if (node.in) node.in = new Vector(node.in.x + dx, node.in.y + dy);
            if (node.out) node.out = new Vector(node.out.x + dx, node.out.y + dy);
            return true;
        }
        // Handle drag: the other handle mirrors (keeping its own length)
        // unless the point is asymmetric — Alt flips that for this drag.
        const key = this.drag.type;
        const other = key === 'out' ? 'in' : 'out';
        node[key] = new Vector(world.x, world.y);
        if (!!node.asymmetric === !!e.altKey) {
            const dx = world.x - node.pos.x, dy = world.y - node.pos.y;
            const len = Math.hypot(dx, dy);
            const o = node[other];
            if (len > 1e-9 && o) {
                const oLen = dist(o, node.pos);
                node[other] = new Vector(node.pos.x - (dx / len) * oLen, node.pos.y - (dy / len) * oLen);
            }
        }
        return true;
    }

    public onMouseUp(_e: MouseEvent): boolean {
        if (this.placing) return true;
        if (this.drag.type === 'none') return false;
        if (!this.hasDragged && this.drag.type === 'node' && this.wall) this.select(this.wall, this.drag.index);
        if (this.hasDragged && this.altDuringDrag && this.drag.type !== 'node' && this.wall) {
            const node = this.wall.nodes[this.drag.index];
            if (node) node.asymmetric = !node.asymmetric;
        }
        this.drag = { type: 'none' };
        this.hasDragged = false;
        this.altDuringDrag = false;
        this.host.changed();
        return true;
    }

    public onKeyDown(e: KeyboardEvent): boolean {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return false;
        if (this.placing && (e.key === 'Enter' || e.key === 'Escape')) {
            this.setPlacing(false);
            return true;
        }
        if (!this.wall) return false;
        if (e.key === 'Escape') {
            if (this.node !== null) this.select(this.wall);
            else this.select(null);
            return true;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (this.node !== null && this.wall.nodes.length > 2) this.deleteNode();
            else if (this.node === null) this.deleteWall();
            return true;
        }
        return false;
    }

    // --- Edits ---

    private addPoint(e: MouseEvent): void {
        const ctx = this.host.ctx()!;
        const now = performance.now();
        const isDouble = now - this.lastClick.time < DOUBLE_CLICK_MS
            && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < DOUBLE_CLICK_CSS;
        this.lastClick = { time: now, x: e.clientX, y: e.clientY };
        if (isDouble) {
            this.setPlacing(false);   // the first click already added the point
            return;
        }
        const p = ctx.snapPoint(...xy(ctx.worldFromClient(e.clientX, e.clientY)));
        if (!this.drawing) {
            this.drawing = { nodes: [] };
            this.walls().push(this.drawing);
        }
        this.drawing.nodes.push({ pos: new Vector(p.x, p.y) });
        this.host.changed();
    }

    // Keep the wall being drawn if it has ≥ 2 points, else drop it.
    private finishDrawing(): void {
        const w = this.drawing;
        this.drawing = null;
        if (!w) return;
        if (w.nodes.length < 2) {
            const walls = this.walls();
            const i = walls.indexOf(w);
            if (i >= 0) walls.splice(i, 1);
            return;
        }
        this.wall = w;
        this.node = null;
        this.host.selectedWall();
    }

    public deleteWall(wall: TyreWall | null = this.wall): void {
        if (!wall) return;
        const walls = this.walls();
        const i = walls.indexOf(wall);
        if (i >= 0) walls.splice(i, 1);
        if (wall === this.wall) this.select(null);
        else this.host.changed();
    }

    private deleteNode(): void {
        if (!this.wall || this.node === null || this.wall.nodes.length <= 2) return;
        this.wall.nodes.splice(this.node, 1);
        this.select(this.wall);
    }

    // Curve handles on the selected point: along the line from its previous
    // to its next point (an end point uses its one neighbour), each a third
    // of the way to that neighbour.
    private addHandles(): void {
        const w = this.wall;
        if (!w || this.node === null) return;
        const i = this.node, n = w.nodes[i];
        const prev = w.nodes[i - 1], next = w.nodes[i + 1];
        const from = (prev ?? n).pos, to = (next ?? n).pos;
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return;
        const ux = dx / len, uy = dy / len;
        if (prev) { const l = dist(prev.pos, n.pos) / 3; n.in = new Vector(n.pos.x - ux * l, n.pos.y - uy * l); }
        if (next) { const l = dist(next.pos, n.pos) / 3; n.out = new Vector(n.pos.x + ux * l, n.pos.y + uy * l); }
        this.host.changed();
    }

    private removeHandles(): void {
        const n = this.wall && this.node !== null ? this.wall.nodes[this.node] : null;
        if (!n) return;
        n.in = undefined;
        n.out = undefined;
        n.asymmetric = undefined;
        this.host.changed();
    }

    // Split side `side` (point side → side+1) at t (de Casteljau), shape
    // unchanged. Returns the new point's index.
    private insertNode(wall: TyreWall, side: number, t: number): number {
        const a = wall.nodes[side], b = wall.nodes[side + 1];
        const lerp = (p: Xy, q: Xy, u: number) => new Vector(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u);
        let node: OutlineNode;
        if (!a.out && !b.in) {
            node = { pos: lerp(a.pos, b.pos, t) };
        } else {
            const p1 = a.out ?? a.pos, p2 = b.in ?? b.pos;
            const q0 = lerp(a.pos, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, b.pos, t);
            const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t);
            a.out = q0;
            b.in = q2;
            node = { pos: lerp(r0, r1, t), in: r0, out: r1 };
        }
        wall.nodes.splice(side + 1, 0, node);
        return side + 1;
    }

    // Closest point on any wall's curve within the hit radius.
    private hitTestCurve(world: Xy, zoom: number): { wall: TyreWall; side: number; t: number } | null {
        let best: { wall: TyreWall; side: number; t: number } | null = null;
        let bestD = CURVE_HIT_RADIUS_CSS / zoom;
        for (const wall of this.walls()) {
            for (let s = 0; s < wall.nodes.length - 1; s++) {
                const a = wall.nodes[s], b = wall.nodes[s + 1];
                const c: [Xy, Xy, Xy, Xy] = [a.pos, a.out ?? a.pos, b.in ?? b.pos, b.pos];
                let bt = 0, bd = Infinity;
                for (let k = 0; k <= CURVE_SAMPLES; k++) {
                    const d = dist(bezierAt(c, k / CURVE_SAMPLES), world);
                    if (d < bd) { bd = d; bt = k / CURVE_SAMPLES; }
                }
                let lo = Math.max(0, bt - 1 / CURVE_SAMPLES), hi = Math.min(1, bt + 1 / CURVE_SAMPLES);
                for (let k = 0; k < 20; k++) {
                    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
                    if (dist(bezierAt(c, m1), world) < dist(bezierAt(c, m2), world)) hi = m2; else lo = m1;
                }
                const t = (lo + hi) / 2;
                const d = dist(bezierAt(c, t), world);
                if (d <= bestD && t > 1e-3 && t < 1 - 1e-3) { bestD = d; best = { wall, side: s, t }; }
            }
        }
        return best;
    }

    // --- Panels ---

    // "Tyre walls (n)" section for the host's list panel.
    public listSection(): HTMLElement {
        const walls = this.walls().filter(w => w !== this.drawing);
        const section = document.createElement('div');
        const header = document.createElement('div');
        header.textContent = `Tyre walls (${walls.length})`;
        Object.assign(header.style, { padding: '8px 10px', fontWeight: 'bold', borderTop: '1px solid #444' });
        section.appendChild(header);
        walls.forEach((w, i) => {
            const row = document.createElement('div');
            row.textContent = `Wall ${i + 1} · ${tyreCenters(flattenWall(w)).length} tyres`;
            Object.assign(row.style, {
                padding: '6px 10px',
                cursor: 'pointer',
                backgroundColor: w === this.wall ? 'rgba(255, 207, 51, 0.25)' : 'transparent',
            });
            row.addEventListener('click', () => this.select(w));
            section.appendChild(row);
        });
        return section;
    }

    // Inspector content for the selected wall.
    public fillInspector(el: HTMLElement, button: (label: string, disabled: boolean, onClick: () => void) => HTMLButtonElement): void {
        const w = this.wall;
        if (!w) return;
        const i = this.walls().indexOf(w);
        const title = document.createElement('div');
        title.textContent = `Tyre wall ${i + 1}`;
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' });
        el.appendChild(title);

        const line = flattenWall(w);
        let length = 0;
        for (let k = 1; k < line.length; k++) length += dist(line[k - 1], line[k]);
        const info = document.createElement('div');
        info.textContent = `${tyreCenters(line).length} tyres · ${fromPixelsToMeters(length).toFixed(1)} m · ${w.nodes.length} points`;
        info.style.opacity = '0.7';
        el.appendChild(info);

        const n = this.node !== null ? w.nodes[this.node] : null;
        if (n) {
            const curved = !!(n.in || n.out);
            el.appendChild(button(curved ? 'Remove curve handles' : 'Add curve handles', false,
                () => (curved ? this.removeHandles() : this.addHandles())));
            el.appendChild(button('Delete point', w.nodes.length <= 2, () => this.deleteNode()));
        } else {
            const hint = document.createElement('div');
            hint.textContent = 'Click a point to edit it; click the line to add one.';
            hint.style.opacity = '0.7';
            el.appendChild(hint);
        }
        const del = button('Delete wall', false, () => this.deleteWall());
        del.style.backgroundColor = '#8a2a2a';
        el.appendChild(del);
    }
}

function xy(p: Xy): [number, number] {
    return [p.x, p.y];
}

function dist(a: Xy, b: Xy): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function bezierAt(c: [Xy, Xy, Xy, Xy], t: number): Xy {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return {
        x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
        y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
    };
}
