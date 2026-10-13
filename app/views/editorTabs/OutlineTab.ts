import type { EditorTab, OverlaySlots, EditorContext } from './EditorTab';
import { hasGeometry, pathsKey } from './EditorTab';
import { TrackBandRenderer } from './TrackBandRenderer';
import { flattenPaths } from '~/tracks/vector/paths';
import { computeSmoothOutline, generateOutline } from '~/tracks/vector/outline';
import { ringToCubics } from '~/tracks/vector/outlineShape';
import { Vector } from '~/components/Vector';
import { fitCubicWithTangents } from '~/tracks/vector/fitCurves';
import type { OutlineNode, OutlineRing } from '~/tracks/types';

// Rendered marker radii in CSS pixels.
const NODE_DOT_RADIUS_CSS = 4;
const ANCHOR_DOT_RADIUS_CSS = 5;
const HANDLE_DOT_RADIUS_CSS = 4;
// Hit radii in CSS pixels (converted to world via zoom).
const NODE_HIT_RADIUS_CSS = 9;
const HANDLE_HIT_RADIUS_CSS = 9;
const CURVE_HIT_RADIUS_CSS = 7;
// Click vs drag threshold (CSS px), same as the Track tab.
const DRAG_THRESHOLD_CSS = 4;
// Coarse samples per outline side for the click-on-curve hit test.
const CURVE_SAMPLES = 24;
// Deleting stops at this many nodes per ring.
const MIN_RING_NODES = 3;
// Samples per side when refitting the joined curve after a delete.
const MERGE_SAMPLES = 32;

type Xy = { x: number; y: number };

type NodeRef = { ring: number; index: number };
type DragKind =
    | { type: 'node'; ref: NodeRef }
    | { type: 'in'; ref: NodeRef }
    | { type: 'out'; ref: NodeRef }
    | { type: 'none' };

// Outline tab: the track edge the game draws, collides with and casts rays
// against. Generated from the anchors on demand ("Generate outline"),
// stored per track, then fine-tunable by hand.
//
// Layers: track band (faint reference) → computed edge (thin cyan guide,
// what Generate would produce right now) → stored outline (orange curves +
// node dots).
//
// Editing works like anchors on the Track tab: click a node to select it
// (its handles appear), drag nodes (handles follow) and handles. Snap here
// means the computed edge, not the grid: a dragged node always sits on the
// nearest point of the edge (glides along it), and a dragged handle's
// direction locks to the edge direction at its node. Snap toggle / Shift
// turn it off for free placement. Click the outline between nodes to insert
// one there (exact split, shape unchanged); Delete/Backspace removes the
// selected node (min 3 per ring).
// Smooth nodes keep their handles opposite; Alt during a handle drag flips
// that for the drag and commits the flip on release. Unlike anchors, the
// opposite handle keeps its own length (generated nodes have unequal
// handles; copying the length would bend the neighbouring curve).
export class OutlineTab implements EditorTab {
    private editorCtx: EditorContext | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private band = new TrackBandRenderer();

    private selected: NodeRef | null = null;
    private drag: DragKind = { type: 'none' };
    private mouseDownClient = { x: 0, y: 0 };
    private hasDragged = false;
    private altDuringDrag = false;

    private generateBtn: HTMLButtonElement | null = null;
    private hintEl: HTMLDivElement | null = null;

    // Computed guide edge, cached per anchors snapshot (computing it takes
    // ~10–200 ms, far too slow to redo every frame).
    private guideKey: string | null = null;
    private guideRings: { x: number; y: number }[][] = [];

    public mount(canvas: HTMLCanvasElement, overlays: OverlaySlots, ctx: EditorContext): void {
        this.editorCtx = ctx;
        this.canvas = canvas;

        this.generateBtn = document.createElement('button');
        Object.assign(this.generateBtn.style, {
            padding: '8px 12px',
            backgroundColor: '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'inherit',
            pointerEvents: 'auto',
        });
        this.generateBtn.addEventListener('click', () => this.generate());
        overlays.leftTools.appendChild(this.generateBtn);

        this.hintEl = document.createElement('div');
        Object.assign(this.hintEl.style, {
            padding: '8px 14px',
            backgroundColor: 'rgba(30, 30, 30, 0.85)',
            color: '#fff',
            borderRadius: '6px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
            pointerEvents: 'none',
        });
        overlays.topStrip.appendChild(this.hintEl);

        this.updateControls();
    }

    public unmount(): void {
        this.generateBtn?.remove();
        this.hintEl?.remove();
        this.generateBtn = null;
        this.hintEl = null;
        this.band.dispose();
        this.editorCtx = null;
        this.canvas = null;
        this.guideKey = null;
        this.guideRings = [];
        this.selected = null;
        this.drag = { type: 'none' };
    }

    // --- Render ---

    public render(ctx: CanvasRenderingContext2D, zoom: number): void {
        if (!this.editorCtx) return;
        const state = this.editorCtx.trackState;
        const { outline } = state;
        if (!hasGeometry(state)) return;

        ctx.save();
        ctx.globalAlpha = 0.5;
        this.band.draw(ctx, flattenPaths(state.paths), zoom);
        ctx.restore();

        // Centerline points (anchors) for reference — read-only here; edit
        // them on the Track tab.
        ctx.save();
        ctx.fillStyle = 'rgba(74, 158, 255, 0.85)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 1 / zoom;
        const ar = ANCHOR_DOT_RADIUS_CSS / zoom;
        for (const a of state.paths.flatMap(p => p.anchors)) {
            ctx.beginPath();
            ctx.arc(a.pos.x, a.pos.y, ar, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();

        this.drawGuide(ctx, zoom);
        if (outline) this.drawOutline(ctx, outline, zoom);
    }

    private drawGuide(ctx: CanvasRenderingContext2D, zoom: number): void {
        this.ensureGuide();
        ctx.save();
        ctx.strokeStyle = 'rgba(80, 220, 255, 0.8)';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        for (const ring of this.guideRings) {
            if (ring.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(ring[0].x, ring[0].y);
            for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
            ctx.closePath();
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawOutline(ctx: CanvasRenderingContext2D, outline: OutlineRing[], zoom: number): void {
        ctx.save();
        ctx.strokeStyle = '#ff8a1f';
        ctx.lineWidth = 2 / zoom;
        for (const ring of outline) {
            const cubics = ringToCubics(ring);
            if (cubics.length === 0) continue;
            ctx.beginPath();
            ctx.moveTo(cubics[0][0].x, cubics[0][0].y);
            for (const c of cubics) ctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
            ctx.closePath();
            ctx.stroke();
        }

        // Handles of the selected node (under the node dots).
        const sel = this.selectedNode();
        if (sel) this.drawHandles(ctx, sel, zoom);

        // Node dots: smooth nodes round, corner nodes square; selected = yellow.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 1 / zoom;
        for (const ring of outline) {
            for (const n of ring) {
                const isSel = n === sel;
                const r = (NODE_DOT_RADIUS_CSS / zoom) * (isSel ? 1.4 : 1);
                ctx.fillStyle = isSel ? '#ffcf33' : '#ff8a1f';
                ctx.beginPath();
                if (n.asymmetric) ctx.rect(n.pos.x - r, n.pos.y - r, r * 2, r * 2);
                else ctx.arc(n.pos.x, n.pos.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    private drawHandles(ctx: CanvasRenderingContext2D, n: OutlineNode, zoom: number): void {
        const r = HANDLE_DOT_RADIUS_CSS / zoom;
        for (const h of [n.in, n.out]) {
            if (!h) continue;
            ctx.save();
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
            ctx.restore();
        }
    }

    // --- Mouse / keys ---

    public onMouseDown(e: MouseEvent): boolean {
        if (e.button !== 0 || !this.editorCtx?.trackState.outline) return false;
        this.mouseDownClient = { x: e.clientX, y: e.clientY };
        this.hasDragged = false;
        this.altDuringDrag = false;

        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        const zoom = this.currentZoom();

        // Closest wins among: the selected node's handles and any node.
        // (Generated handles can be very short; a plain "handles first" rule
        // would make the node itself impossible to grab once selected.)
        let best: DragKind = { type: 'none' };
        let bestD = Infinity;
        const sel = this.selectedNode();
        if (sel && this.selected) {
            const r = HANDLE_HIT_RADIUS_CSS / zoom;
            for (const key of ['out', 'in'] as const) {
                const h = sel[key];
                const d = h ? dist(h, world) : Infinity;
                if (d <= r && d < bestD) { bestD = d; best = { type: key, ref: this.selected }; }
            }
        }
        const hit = this.hitTestNode(world, zoom);
        if (hit) {
            const d = dist(this.nodeAt(hit)!.pos, world);
            if (d < bestD) { bestD = d; best = { type: 'node', ref: hit }; }
        }
        if (best.type !== 'none') {
            this.drag = best;
            return true;
        }

        // On the outline curve (away from nodes): insert a node there,
        // selected and ready to drag.
        const onCurve = this.hitTestCurve(world, zoom);
        if (onCurve) {
            const ref = this.insertNode(onCurve.ring, onCurve.side, onCurve.t);
            this.selected = ref;
            this.drag = { type: 'node', ref };
            this.updateControls();
            return true;
        }

        // Empty space: deselect.
        this.selected = null;
        return true;
    }

    // Split side `side` (node side → side+1) of a ring at curve parameter t
    // (de Casteljau), so the shape stays exactly the same. A straight side
    // (no handles) stays straight. Returns the new node's ref.
    private insertNode(ringIndex: number, side: number, t: number): NodeRef {
        const ring = this.editorCtx!.trackState.outline![ringIndex];
        const a = ring[side];
        const b = ring[(side + 1) % ring.length];
        const lerp = (p: Xy, q: Xy, u: number) => new Vector(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u);

        let node: OutlineNode;
        if (!a.out && !b.in) {
            node = { pos: lerp(a.pos, b.pos, t) };
        } else {
            const p1 = a.out ?? a.pos;
            const p2 = b.in ?? b.pos;
            const q0 = lerp(a.pos, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, b.pos, t);
            const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t);
            a.out = q0;
            b.in = q2;
            node = { pos: lerp(r0, r1, t), in: r0, out: r1 };
        }
        ring.splice(side + 1, 0, node);
        return { ring: ringIndex, index: side + 1 };
    }

    // Remove node `index` and replace its two sides with the single curve
    // that follows them most closely: the neighbours' handle DIRECTIONS
    // stay (so the curve still leaves each neighbour the same way), only the
    // handle lengths are refitted. Insert followed by delete gives back the
    // original side. All-straight sides just join straight.
    private deleteNode(ring: OutlineRing, index: number): void {
        const n = ring.length;
        const prev = ring[(index - 1 + n) % n];
        const node = ring[index];
        const next = ring[(index + 1) % n];

        if (!prev.out && !node.in && !node.out && !next.in) {
            ring.splice(index, 1);
            return;
        }

        const [c1, c2] = [
            [prev.pos, prev.out ?? prev.pos, node.in ?? node.pos, node.pos],
            [node.pos, node.out ?? node.pos, next.in ?? next.pos, next.pos],
        ] as [Xy, Xy, Xy, Xy][];
        const pts: Xy[] = [];
        for (let k = 0; k <= MERGE_SAMPLES; k++) pts.push(bezierAt(c1, k / MERGE_SAMPLES));
        for (let k = 1; k <= MERGE_SAMPLES; k++) pts.push(bezierAt(c2, k / MERGE_SAMPLES));

        // Handle directions; a missing handle falls back to the curve's own
        // direction at that end.
        const dir = (from: Xy, to: Xy) => ({ x: to.x - from.x, y: to.y - from.y });
        const tStart = prev.out && dist(prev.out, prev.pos) > 1e-9 ? dir(prev.pos, prev.out) : dir(pts[0], pts[1]);
        const tEnd = next.in && dist(next.in, next.pos) > 1e-9 ? dir(next.pos, next.in) : dir(pts[pts.length - 1], pts[pts.length - 2]);

        const merged = fitCubicWithTangents(pts, tStart, tEnd);
        prev.out = new Vector(merged[1].x, merged[1].y);
        next.in = new Vector(merged[2].x, merged[2].y);
        ring.splice(index, 1);
    }

    // Closest point on the stored outline curves within the hit radius:
    // coarse samples per side, then a local refine of t.
    private hitTestCurve(world: Xy, zoom: number): { ring: number; side: number; t: number } | null {
        const outline = this.editorCtx?.trackState.outline;
        if (!outline) return null;
        const r = CURVE_HIT_RADIUS_CSS / zoom;
        let best: { ring: number; side: number; t: number } | null = null;
        let bestD = r;
        outline.forEach((ring, ri) => ringToCubics(ring).forEach((c, si) => {
            let bt = 0, bd = Infinity;
            for (let k = 0; k <= CURVE_SAMPLES; k++) {
                const d = dist(bezierAt(c, k / CURVE_SAMPLES), world);
                if (d < bd) { bd = d; bt = k / CURVE_SAMPLES; }
            }
            // Refine around the best sample (ternary-style narrowing).
            let lo = Math.max(0, bt - 1 / CURVE_SAMPLES), hi = Math.min(1, bt + 1 / CURVE_SAMPLES);
            for (let k = 0; k < 20; k++) {
                const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
                if (dist(bezierAt(c, m1), world) < dist(bezierAt(c, m2), world)) hi = m2; else lo = m1;
            }
            const t = (lo + hi) / 2;
            const d = dist(bezierAt(c, t), world);
            if (d <= bestD && t > 1e-3 && t < 1 - 1e-3) { bestD = d; best = { ring: ri, side: si, t }; }
        }));
        return best;
    }

    public onMouseMove(e: MouseEvent): boolean {
        if (this.drag.type === 'none' || !this.editorCtx) return false;

        if (!this.hasDragged) {
            const dx = e.clientX - this.mouseDownClient.x;
            const dy = e.clientY - this.mouseDownClient.y;
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_CSS) return true;
            this.hasDragged = true;
            // Dragging a node selects it (so its handles show while moving).
            if (this.drag.type === 'node') this.selected = this.drag.ref;
        }
        if (e.altKey) this.altDuringDrag = true;

        const node = this.nodeAt(this.drag.ref);
        if (!node) return true;
        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        // Snap on this tab = the computed edge (not the grid).
        const snap = this.editorCtx.isSnapActive();

        if (this.drag.type === 'node') {
            // Snap: the node always sits on the nearest point of the
            // computed edge, so it glides along it.
            const s = snap ? (this.nearestOnGuide(world)?.pos ?? world) : world;
            // Handles move rigidly with the node so the curve shape is kept.
            const dx = s.x - node.pos.x;
            const dy = s.y - node.pos.y;
            node.pos = new Vector(s.x, s.y);
            if (node.in) node.in = new Vector(node.in.x + dx, node.in.y + dy);
            if (node.out) node.out = new Vector(node.out.x + dx, node.out.y + dy);
            return true;
        }

        // Handle drag. Snap: direction locks to the computed edge's
        // direction at the node; the mouse still sets length and which way.
        let dragged = new Vector(world.x, world.y);
        const tangent = snap ? this.nearestOnGuide(node.pos)?.tangent : undefined;
        if (tangent) {
            const along = (world.x - node.pos.x) * tangent.x + (world.y - node.pos.y) * tangent.y;
            dragged = new Vector(node.pos.x + tangent.x * along, node.pos.y + tangent.y * along);
        }
        const otherKey = this.drag.type === 'out' ? 'in' : 'out';
        node[this.drag.type] = dragged;
        if (!!node.asymmetric === !!e.altKey) {
            // Mirror: the other handle points the opposite way, keeping its
            // own length (or the dragged length if it doesn't exist yet).
            const dx = dragged.x - node.pos.x;
            const dy = dragged.y - node.pos.y;
            const len = Math.hypot(dx, dy);
            if (len > 1e-9) {
                const other = node[otherKey];
                const otherLen = other ? dist(other, node.pos) : len;
                node[otherKey] = new Vector(node.pos.x - (dx / len) * otherLen, node.pos.y - (dy / len) * otherLen);
            }
        }
        return true;
    }

    public onMouseUp(_e: MouseEvent): boolean {
        if (this.drag.type === 'none') return false;
        if (!this.hasDragged && this.drag.type === 'node') this.selected = this.drag.ref;

        // Alt held during a handle drag → commit the mode flip to the node.
        if (this.hasDragged && this.altDuringDrag && (this.drag.type === 'in' || this.drag.type === 'out')) {
            const node = this.nodeAt(this.drag.ref);
            if (node) node.asymmetric = !node.asymmetric;
        }

        this.drag = { type: 'none' };
        this.hasDragged = false;
        this.altDuringDrag = false;
        return true;
    }

    public onKeyDown(e: KeyboardEvent): boolean {
        if (e.key === 'Escape' && this.selected) {
            this.selected = null;
            return true;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.editorCtx?.trackState.outline) {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
                return false;
            }
            e.preventDefault();
            // A ring needs at least MIN_RING_NODES nodes to stay usable.
            const ring = this.editorCtx.trackState.outline[this.selected.ring];
            if (ring && ring.length > MIN_RING_NODES) {
                this.deleteNode(ring, this.selected.index);
                this.selected = null;
                this.updateControls();
            }
            return true;
        }
        return false;
    }

    // Closest point on the computed edge (all rings) + the edge direction
    // there. Null if there's no computed edge (fewer than 2 anchors).
    private nearestOnGuide(p: { x: number; y: number }): { pos: Vector; tangent: { x: number; y: number } } | null {
        this.ensureGuide();
        let best: { pos: Vector; tangent: { x: number; y: number } } | null = null;
        let bestD = Infinity;
        for (const ring of this.guideRings) {
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i];
                const b = ring[(i + 1) % ring.length];
                const ex = b.x - a.x, ey = b.y - a.y;
                const l2 = ex * ex + ey * ey;
                if (l2 < 1e-12) continue;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
                const qx = a.x + ex * t, qy = a.y + ey * t;
                const d = Math.hypot(p.x - qx, p.y - qy);
                if (d < bestD) {
                    bestD = d;
                    const l = Math.sqrt(l2);
                    best = { pos: new Vector(qx, qy), tangent: { x: ex / l, y: ey / l } };
                }
            }
        }
        return best;
    }

    // (Re)compute the cached guide edge if the paths changed.
    private ensureGuide(): void {
        if (!this.editorCtx) return;
        const paths = this.editorCtx.trackState.paths;
        const key = pathsKey(paths);
        if (key === this.guideKey) return;
        this.guideKey = key;
        this.guideRings = computeSmoothOutline(paths);
    }

    private nodeAt(ref: NodeRef): OutlineNode | null {
        return this.editorCtx?.trackState.outline?.[ref.ring]?.[ref.index] ?? null;
    }

    private selectedNode(): OutlineNode | null {
        return this.selected ? this.nodeAt(this.selected) : null;
    }

    private hitTestNode(world: { x: number; y: number }, zoom: number): NodeRef | null {
        const outline = this.editorCtx?.trackState.outline;
        if (!outline) return null;
        const r = NODE_HIT_RADIUS_CSS / zoom;
        let best: NodeRef | null = null;
        let bestD = r;
        outline.forEach((ring, ri) => ring.forEach((n, ni) => {
            const d = dist(n.pos, world);
            if (d <= bestD) { bestD = d; best = { ring: ri, index: ni }; }
        }));
        return best;
    }

    // Effective CSS-px-per-world-px (same approach as the Track tab).
    private currentZoom(): number {
        if (!this.canvas || !this.editorCtx) return 1;
        const rect = this.canvas.getBoundingClientRect();
        const a = this.editorCtx.worldFromClient(rect.left, rect.top + rect.height / 2);
        const b = this.editorCtx.worldFromClient(rect.left + 100, rect.top + rect.height / 2);
        const d = b.x - a.x;
        return Math.abs(d) < 1e-9 ? 1 : 100 / d;
    }

    // --- Actions ---

    private generate(): void {
        if (!this.editorCtx) return;
        const state = this.editorCtx.trackState;
        if (!hasGeometry(state)) return;
        if (state.outline
            && !window.confirm('Replace the current outline? Any hand edits to it will be lost.')) return;
        state.outline = generateOutline(state.paths);
        state.outlinePathsKey = pathsKey(state.paths);
        this.selected = null;
        this.updateControls();
    }

    // Button label/enabled state + hint text, from the current state.
    private updateControls(): void {
        if (!this.editorCtx || !this.generateBtn || !this.hintEl) return;
        const state = this.editorCtx.trackState;
        const { outline, outlinePathsKey } = state;
        const canGenerate = hasGeometry(state);

        this.generateBtn.textContent = outline ? 'Regenerate outline' : 'Generate outline';
        this.generateBtn.disabled = !canGenerate;
        this.generateBtn.style.opacity = canGenerate ? '1' : '0.5';
        this.generateBtn.style.cursor = canGenerate ? 'pointer' : 'default';

        if (!canGenerate) {
            this.hintEl.textContent = 'Draw the track on the Track tab first.';
        } else if (!outline) {
            this.hintEl.textContent = 'No outline yet. Dashed cyan = what Generate will produce.';
        } else {
            const nodes = outline.reduce((sum, ring) => sum + ring.length, 0);
            const stale = outlinePathsKey !== pathsKey(state.paths);
            this.hintEl.textContent = stale
                ? `⚠ Track changed since the outline was generated. Regenerate to update (drops hand edits). ${nodes} nodes.`
                : `Outline: ${outline.length} ring(s), ${nodes} nodes. Click the orange line to add a node, Delete removes the selected one.`;
        }
    }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
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
