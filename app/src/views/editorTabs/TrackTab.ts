import { Vector } from '~/components/Vector';
import type { Anchor, TrackPath } from '~/tracks/types';
import { activePath, createPath, pathLabel, type EditorTab, type OverlaySlots, type EditorContext } from './EditorTab';
import { flattenCenterline } from '~/tracks/vector/flatten';
import { flattenPaths, projectOntoNearestPath } from '~/tracks/vector/paths';
import { TrackBandRenderer } from './TrackBandRenderer';
import { normalizeStartFinish } from '~/tracks/vector/layout';
import { fromMetersToPixels, fromPixelsToMeters } from '~/helper';

// Default halfWidth for new anchors: 4 m (= 96 px at 24 px/m). Full track
// width = 8 m. Realistic for go-kart circuits.
const DEFAULT_HALF_WIDTH = fromMetersToPixels(4);
// Hit radius for clicking anchors, in CSS pixels (converted to world via zoom).
const ANCHOR_HIT_RADIUS_CSS = 12;
const HANDLE_HIT_RADIUS_CSS = 10;
const CENTERLINE_HIT_RADIUS_CSS = 8;
// Rendered marker radii in CSS pixels.
const ANCHOR_DOT_RADIUS_CSS = 6;
const HANDLE_DOT_RADIUS_CSS = 5;
// Anchors of the paths you're NOT editing: smaller, faded.
const INACTIVE_DOT_RADIUS_CSS = 4;

// Click vs drag threshold: how many CSS pixels the pointer must move
// between mousedown and mouseup for it to count as a drag.
const DRAG_THRESHOLD_CSS = 4;

type DragKind =
    | { type: 'anchor', index: number }                            // moving an existing anchor
    | { type: 'controlIn', index: number }                         // dragging bezier handle in
    | { type: 'controlOut', index: number }                        // dragging bezier handle out
    | { type: 'placingWithBezier', index: number }                 // mid-placement: drag stretches handles
    | { type: 'none' };

// Phase G (full): linear + bezier anchor authoring.
// Interaction model:
// - Click empty space → drops a linear anchor at (snapped) point. If you drag
//   before releasing, that drag symmetrically stretches controlIn/controlOut
//   so the curve passes smoothly through the new anchor.
// - Click an anchor → selects it. Dragging moves it (snap-aware).
// - When an anchor is selected, its bezier control handles (if any) render
//   as small dots connected by thin lines; drag them to adjust. Drag mirrors
//   the opposite handle (symmetric bezier) by default.
// - Click a point on the rendered centerline (not near any anchor/handle) →
//   inserts a new linear anchor at that flat point, splitting the segment.
// - Delete / Backspace removes the selected anchor.
// - Right inspector shows halfWidth slider for the selected anchor.
//
// Paths (track-network P1.4): a track is one or more paths — loops and open
// roads. The path bar (top strip) picks the ACTIVE path; everything above
// applies to it. Other paths draw faded; clicking one of their anchors makes
// that path active. "New road" starts an empty open path.
// - Junctions: the FIRST and LAST anchor of a road snap onto another path's
//   centerline (taking its width there) when dropped or dragged onto it, so
//   the roads join. A ring marks the snap; Shift skips it. Nothing links
//   the road to the other path afterwards: move the loop → re-drag the end.
export class TrackTab implements EditorTab {
    private editorCtx: EditorContext | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private overlays: OverlaySlots | null = null;

    private selectedAnchor: number | null = null;
    private drag: DragKind = { type: 'none' };
    private mouseDownClient = { x: 0, y: 0 };
    private hasDragged = false;
    // Set true whenever Alt was down during ANY mousemove in the current drag.
    // On mouseup, a true value toggles the dragged anchor's asymmetric flag
    // (so Alt-drag "commits" the mode change for future drags, not just the
    // current one).
    private altDuringDrag = false;

    private inspectorEl: HTMLDivElement | null = null;
    private pathBarEl: HTMLDivElement | null = null;
    private band = new TrackBandRenderer();
    // Where the dragged/placed road end snapped onto another path (drawn as
    // a ring while the drag lasts). null = not snapped.
    private junctionHint: { x: number; y: number; r: number } | null = null;

    public mount(canvas: HTMLCanvasElement, overlays: OverlaySlots, ctx: EditorContext): void {
        this.editorCtx = ctx;
        this.canvas = canvas;
        this.overlays = overlays;

        this.pathBarEl = document.createElement('div');
        Object.assign(this.pathBarEl.style, {
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            padding: '4px',
            backgroundColor: 'rgba(30, 30, 30, 0.85)',
            borderRadius: '6px',
            pointerEvents: 'auto',
        });
        overlays.topStrip.appendChild(this.pathBarEl);

        this.renderPathBar();
        this.renderInspector();
    }

    public unmount(): void {
        this.inspectorEl?.remove();
        this.inspectorEl = null;
        this.pathBarEl?.remove();
        this.pathBarEl = null;
        this.junctionHint = null;
        this.band.dispose();
        this.editorCtx = null;
        this.canvas = null;
        this.overlays = null;
        this.selectedAnchor = null;
        this.drag = { type: 'none' };
    }

    // --- Render ---

    public render(ctx: CanvasRenderingContext2D, zoom: number): void {
        if (!this.editorCtx) return;
        const state = this.editorCtx.trackState;
        const anchors = this.anchors();

        if (state.paths.every(p => p.anchors.length === 0)) {
            this.drawEmptyHint(ctx);
            return;
        }

        this.band.draw(ctx, flattenPaths(state.paths), zoom);

        // Other paths' anchors: small and faded (click one to edit that path).
        ctx.save();
        ctx.fillStyle = 'rgba(74, 158, 255, 0.4)';
        const fadedR = INACTIVE_DOT_RADIUS_CSS / zoom;
        for (const p of state.paths) {
            if (p === this.path()) continue;
            for (const a of p.anchors) {
                ctx.beginPath();
                ctx.arc(a.pos.x, a.pos.y, fadedR, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();

        if (this.junctionHint) {
            const h = this.junctionHint;
            ctx.save();
            ctx.strokeStyle = '#3ddc84';
            ctx.lineWidth = 2 / zoom;
            ctx.setLineDash([6 / zoom, 4 / zoom]);
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Bezier handles for the SELECTED anchor only (keeps the canvas clean).
        if (this.selectedAnchor !== null) {
            const a = anchors[this.selectedAnchor];
            if (a) this.drawHandles(ctx, a, zoom);
        }

        // Anchor dots on top.
        const dotR = ANCHOR_DOT_RADIUS_CSS / zoom;
        anchors.forEach((a, i) => {
            const isSelected = i === this.selectedAnchor;
            ctx.save();
            ctx.fillStyle = isSelected ? '#ffcf33' : '#4a9eff';
            ctx.strokeStyle = isSelected ? '#000' : 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.arc(a.pos.x, a.pos.y, isSelected ? dotR * 1.3 : dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
    }

    private drawHandles(ctx: CanvasRenderingContext2D, a: Anchor, zoom: number): void {
        const r = HANDLE_DOT_RADIUS_CSS / zoom;
        const line = 1 / zoom;
        const stroke = 'rgba(255, 207, 51, 0.7)';
        const fill = '#ffcf33';

        const drawHandle = (handle: Vector) => {
            ctx.save();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = line;
            // Tether from anchor to handle.
            ctx.beginPath();
            ctx.moveTo(a.pos.x, a.pos.y);
            ctx.lineTo(handle.x, handle.y);
            ctx.stroke();
            // Handle dot (hollow).
            ctx.fillStyle = fill;
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        };

        if (a.controlIn)  drawHandle(a.controlIn);
        if (a.controlOut) drawHandle(a.controlOut);
    }

    private strokeClosedPolyline(ctx: CanvasRenderingContext2D, pts: Vector[]): void {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
    }

    private drawEmptyHint(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText('Click to drop your first anchor. Click-and-drag for a bezier.', 0, 0);
        ctx.restore();
    }

    // --- Mouse interaction ---

    public onMouseDown(e: MouseEvent): boolean {
        if (e.button !== 0 || !this.editorCtx) return false;
        this.mouseDownClient = { x: e.clientX, y: e.clientY };
        this.hasDragged = false;
        this.altDuringDrag = false;

        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        const zoom = this.currentZoom();

        // Priority 1: bezier handle of the selected anchor.
        if (this.selectedAnchor !== null) {
            const anchor = this.anchors()[this.selectedAnchor];
            if (anchor) {
                const r = HANDLE_HIT_RADIUS_CSS / zoom;
                if (anchor.controlOut && dist(anchor.controlOut, world) <= r) {
                    this.drag = { type: 'controlOut', index: this.selectedAnchor };
                    return true;
                }
                if (anchor.controlIn && dist(anchor.controlIn, world) <= r) {
                    this.drag = { type: 'controlIn', index: this.selectedAnchor };
                    return true;
                }
            }
        }

        // Priority 2: an existing anchor of the active path.
        const hitAnchor = this.hitTestAnchor(world, zoom);
        if (hitAnchor !== null) {
            this.drag = { type: 'anchor', index: hitAnchor };
            return true;
        }

        // Priority 2b: an anchor of another path → edit that path instead
        // (select the anchor; dragging moves it right away).
        const other = this.hitTestOtherPathAnchor(world, zoom);
        if (other) {
            this.setActivePath(other.path.id);
            this.selectedAnchor = other.index;
            this.drag = { type: 'anchor', index: other.index };
            this.renderInspector();
            return true;
        }

        // Priority 3: the rendered centerline (not within anchor hit radius).
        const hitCenter = this.hitTestCenterline(world, zoom);
        if (hitCenter !== null) {
            const anchors = this.anchors();
            const halfW = (anchors[hitCenter.segmentIndex]?.halfWidth ?? DEFAULT_HALF_WIDTH);
            const newAnchor: Anchor = {
                pos: new Vector(hitCenter.pos.x, hitCenter.pos.y),
                halfWidth: halfW,
            };
            // Insert between anchors[segmentIndex] and anchors[segmentIndex + 1].
            anchors.splice(hitCenter.segmentIndex + 1, 0, newAnchor);
            this.selectedAnchor = hitCenter.segmentIndex + 1;
            this.drag = { type: 'anchor', index: this.selectedAnchor };
            this.renderInspector();
            return true;
        }

        // Priority 4: empty space → drop a new linear anchor at the snapped
        // point. If the user drags, this upgrades to a bezier placement with
        // symmetric handles (mirror of the drag direction around the anchor).
        //
        // Insertion position: AFTER the currently-selected anchor if any (so
        // the user can "continue" authoring from any point in the loop by
        // selecting an anchor and clicking). With no selection, append to the
        // end (natural flow when building a fresh track).
        const anchors = this.anchors();
        const insertAt = this.selectedAnchor !== null ? this.selectedAnchor + 1 : anchors.length;
        // A road end (first anchor, or appended last) may snap onto a junction.
        const isEnd = !this.path().closed && (insertAt === 0 || insertAt === anchors.length);
        const placed = isEnd ? this.snapRoadEnd(world) : null;
        const snapped = placed ?? { ...this.editorCtx.snapPoint(world.x, world.y), halfWidth: DEFAULT_HALF_WIDTH };
        const newAnchor: Anchor = {
            pos: new Vector(snapped.x, snapped.y),
            halfWidth: snapped.halfWidth,
        };
        anchors.splice(insertAt, 0, newAnchor);
        if (anchors.length <= 2) this.renderPathBar(); // road hint changes
        this.selectedAnchor = insertAt;
        this.drag = { type: 'placingWithBezier', index: this.selectedAnchor };
        this.renderInspector();
        return true;
    }

    public onMouseMove(e: MouseEvent): boolean {
        if (this.drag.type === 'none' || !this.editorCtx) return false;

        if (!this.hasDragged) {
            const dx = e.clientX - this.mouseDownClient.x;
            const dy = e.clientY - this.mouseDownClient.y;
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_CSS) return true;
            this.hasDragged = true;
        }

        if (e.altKey) this.altDuringDrag = true;

        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        const anchors = this.anchors();
        const anchor = anchors[this.drag.index];
        if (!anchor) return true;

        switch (this.drag.type) {
            case 'anchor': {
                // Road ends snap onto other paths (and take their width).
                const junction = this.isRoadEnd(this.drag.index) ? this.snapRoadEnd(world) : null;
                if (junction) anchor.halfWidth = junction.halfWidth;
                const snapped = junction ?? this.editorCtx.snapPoint(world.x, world.y);
                // Translate the bezier handles by the same delta so they stay
                // rigidly attached to the anchor (otherwise moving the anchor
                // leaves its handles orphaned in world space, which breaks
                // the curve's shape).
                const dx = snapped.x - anchor.pos.x;
                const dy = snapped.y - anchor.pos.y;
                anchor.pos = new Vector(snapped.x, snapped.y);
                if (anchor.controlIn)  anchor.controlIn  = new Vector(anchor.controlIn.x + dx,  anchor.controlIn.y + dy);
                if (anchor.controlOut) anchor.controlOut = new Vector(anchor.controlOut.x + dx, anchor.controlOut.y + dy);
                this.renderInspector();
                break;
            }
            case 'placingWithBezier': {
                // Mid-placement drag: the drag endpoint becomes controlOut.
                // Mirror onto controlIn when the anchor is symmetric; break
                // symmetry when it's asymmetric. Alt inverts the current mode
                // (so a symmetric anchor + Alt = asymmetric this drag, and
                // vice versa). Snap always applies to the dragged handle.
                const s = this.editorCtx.snapPoint(world.x, world.y);
                anchor.controlOut = new Vector(s.x, s.y);
                if (shouldMirror(anchor, e.altKey)) {
                    anchor.controlIn = new Vector(
                        2 * anchor.pos.x - s.x,
                        2 * anchor.pos.y - s.y,
                    );
                }
                break;
            }
            case 'controlOut': {
                const s = this.editorCtx.snapPoint(world.x, world.y);
                anchor.controlOut = new Vector(s.x, s.y);
                if (shouldMirror(anchor, e.altKey)) {
                    anchor.controlIn = new Vector(
                        2 * anchor.pos.x - s.x,
                        2 * anchor.pos.y - s.y,
                    );
                }
                break;
            }
            case 'controlIn': {
                const s = this.editorCtx.snapPoint(world.x, world.y);
                anchor.controlIn = new Vector(s.x, s.y);
                if (shouldMirror(anchor, e.altKey)) {
                    anchor.controlOut = new Vector(
                        2 * anchor.pos.x - s.x,
                        2 * anchor.pos.y - s.y,
                    );
                }
                break;
            }
        }
        return true;
    }

    public onMouseUp(_e: MouseEvent): boolean {
        if (this.drag.type === 'none') return false;
        if (!this.hasDragged && (this.drag.type === 'anchor' || this.drag.type === 'placingWithBezier')) {
            this.selectedAnchor = this.drag.index;
            this.renderInspector();
        }

        // If the drag was a bezier handle drag (or a bezier placement) AND
        // Alt was held during it, commit the mode flip to the anchor so
        // subsequent drags behave the same without needing Alt.
        if (
            this.hasDragged &&
            this.altDuringDrag &&
            this.editorCtx &&
            (this.drag.type === 'controlIn'
                || this.drag.type === 'controlOut'
                || this.drag.type === 'placingWithBezier')
        ) {
            const anchor = this.anchors()[this.drag.index];
            if (anchor) {
                anchor.asymmetric = !anchor.asymmetric;
                this.renderInspector();
            }
        }

        this.drag = { type: 'none' };
        this.hasDragged = false;
        this.altDuringDrag = false;
        this.junctionHint = null;
        return true;
    }

    public onKeyDown(e: KeyboardEvent): boolean {
        if (!this.editorCtx) return false;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedAnchor !== null) {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
                return false;
            }
            e.preventDefault();
            this.anchors().splice(this.selectedAnchor, 1);
            this.renderPathBar();
            if (this.anchors().length === 0) this.selectedAnchor = null;
            else this.selectedAnchor = Math.max(0, Math.min(this.selectedAnchor, this.anchors().length - 1));
            this.renderInspector();
            return true;
        }
        return false;
    }

    // Seeds controlIn and controlOut on a linear anchor based on its neighbors.
    // Direction = bisector tangent of (previous → this) and (this → next);
    // distance = 1/3 of the shorter adjacent segment length. For degenerate
    // cases (< 2 anchors, or anchors on top of each other), falls back to a
    // sensible default along +x so the user has visible handles to grab.
    private addBezierHandles(anchor: Anchor): void {
        if (!this.editorCtx) return;
        const anchors = this.anchors();
        const idx = this.selectedAnchor;
        if (idx === null) return;
        const n = anchors.length;

        const fallbackDist = 50;
        if (n < 2) {
            anchor.controlOut = new Vector(anchor.pos.x + fallbackDist, anchor.pos.y);
            anchor.controlIn  = new Vector(anchor.pos.x - fallbackDist, anchor.pos.y);
            return;
        }

        // Open road ends have one neighbour; use it on both sides.
        const closed = this.path().closed;
        const prev = closed || idx > 0 ? anchors[(idx - 1 + n) % n] : anchors[idx + 1];
        const next = closed || idx < n - 1 ? anchors[(idx + 1) % n] : anchors[idx - 1];
        const dxIn  = anchor.pos.x - prev.pos.x;
        const dyIn  = anchor.pos.y - prev.pos.y;
        const dxOut = next.pos.x - anchor.pos.x;
        const dyOut = next.pos.y - anchor.pos.y;
        const lenIn  = Math.hypot(dxIn,  dyIn);
        const lenOut = Math.hypot(dxOut, dyOut);

        if (lenIn < 1e-6 && lenOut < 1e-6) {
            anchor.controlOut = new Vector(anchor.pos.x + fallbackDist, anchor.pos.y);
            anchor.controlIn  = new Vector(anchor.pos.x - fallbackDist, anchor.pos.y);
            return;
        }

        const tInX  = lenIn  > 1e-6 ? dxIn  / lenIn  : dxOut / lenOut;
        const tInY  = lenIn  > 1e-6 ? dyIn  / lenIn  : dyOut / lenOut;
        const tOutX = lenOut > 1e-6 ? dxOut / lenOut : dxIn  / lenIn;
        const tOutY = lenOut > 1e-6 ? dyOut / lenOut : dyIn  / lenIn;

        const bx = tInX + tOutX;
        const by = tInY + tOutY;
        const bLen = Math.hypot(bx, by);
        // Degenerate bisector (incoming + outgoing cancel) → fall back to the
        // outgoing tangent direction.
        const dirX = bLen > 1e-6 ? bx / bLen : tOutX;
        const dirY = bLen > 1e-6 ? by / bLen : tOutY;

        const d = Math.min(lenIn || lenOut, lenOut || lenIn) / 3;
        anchor.controlOut = new Vector(anchor.pos.x + dirX * d, anchor.pos.y + dirY * d);
        anchor.controlIn  = new Vector(anchor.pos.x - dirX * d, anchor.pos.y - dirY * d);
    }

    // --- Hit testing ---

    private hitTestAnchor(world: { x: number; y: number }, zoom: number): number | null {
        if (!this.editorCtx) return null;
        const r = ANCHOR_HIT_RADIUS_CSS / zoom;
        const r2 = r * r;
        const anchors = this.anchors();
        for (let i = anchors.length - 1; i >= 0; i--) {
            const dx = anchors[i].pos.x - world.x;
            const dy = anchors[i].pos.y - world.y;
            if (dx * dx + dy * dy <= r2) return i;
        }
        return null;
    }

    private hitTestCenterline(world: { x: number; y: number }, zoom: number):
        { segmentIndex: number; pos: Vector } | null {
        if (!this.editorCtx) return null;
        const anchors = this.anchors();
        if (anchors.length < 2) return null;

        const closed = this.path().closed;
        const flat = flattenCenterline(anchors, closed);
        if (flat.length < 2) return null;

        const hitRadius = CENTERLINE_HIT_RADIUS_CSS / zoom;
        const anchorHitRadius = ANCHOR_HIT_RADIUS_CSS / zoom;

        let bestDist = hitRadius;
        let bestPos: Vector | null = null;
        let bestSegment = 0;

        // Walk every flat segment and find the closest point on it to `world`.
        // Skip hits that are inside any anchor's hit radius (those should
        // select the anchor instead).
        const n = flat.length;
        const segments = closed ? n : n - 1;
        for (let i = 0; i < segments; i++) {
            const a = flat[i].pos;
            const b = flat[(i + 1) % n].pos;
            const closest = closestPointOnSegment(world, a, b);
            const d = dist(closest, world);
            if (d < bestDist) {
                // Ignore if this closest point is really at an anchor.
                let isNearAnchor = false;
                for (const anc of anchors) {
                    if (dist(closest, anc.pos) <= anchorHitRadius) { isNearAnchor = true; break; }
                }
                if (!isNearAnchor) {
                    bestDist = d;
                    bestPos = closest;
                    // The segment's anchor-segment index is on the START flat point.
                    bestSegment = flat[i].segmentIndex;
                }
            }
        }
        if (bestPos === null) return null;
        return { segmentIndex: bestSegment, pos: bestPos };
    }

    // Anchors of OTHER paths (newest first), for "click to edit that path".
    private hitTestOtherPathAnchor(world: { x: number; y: number }, zoom: number):
        { path: TrackPath; index: number } | null {
        if (!this.editorCtx) return null;
        const r = ANCHOR_HIT_RADIUS_CSS / zoom;
        const active = this.path();
        for (const path of this.editorCtx.trackState.paths) {
            if (path === active) continue;
            for (let i = path.anchors.length - 1; i >= 0; i--) {
                if (dist(path.anchors[i].pos, world) <= r) return { path, index: i };
            }
        }
        return null;
    }

    // --- Paths ---

    private path(): TrackPath {
        return activePath(this.editorCtx!.trackState);
    }

    // Anchors of the active path (what this tab edits).
    private anchors(): Anchor[] {
        return this.editorCtx ? this.path().anchors : [];
    }

    // First or last anchor of an open road.
    private isRoadEnd(index: number): boolean {
        const p = this.path();
        return !p.closed && (index === 0 || index === p.anchors.length - 1);
    }

    // Junction snap for a road end: the closest point on ANOTHER path's
    // centerline, if `world` is on that path's surface, with its half-width
    // there. null = no junction (or snapping off / Shift held).
    private snapRoadEnd(world: { x: number; y: number }): { x: number; y: number; halfWidth: number } | null {
        this.junctionHint = null;
        if (!this.editorCtx || !this.editorCtx.isSnapActive()) return null;
        const active = this.path();
        const others = flattenPaths(this.editorCtx.trackState.paths.filter(p => p !== active));
        const hit = projectOntoNearestPath(others, world.x, world.y);
        if (!hit || hit.projection.distance > hit.projection.halfWidth) return null;
        const { pos, halfWidth } = hit.projection;
        this.junctionHint = { x: pos.x, y: pos.y, r: halfWidth };
        return { x: pos.x, y: pos.y, halfWidth };
    }

    private setActivePath(id: string): void {
        if (!this.editorCtx) return;
        this.editorCtx.trackState.activePathId = id;
        this.selectedAnchor = null;
        this.drag = { type: 'none' };
        this.renderPathBar();
        this.renderInspector();
    }

    // Path picker + New road / Loop-Road toggle / Delete path.
    private renderPathBar(): void {
        const bar = this.pathBarEl;
        if (!bar || !this.editorCtx) return;
        bar.replaceChildren();
        const state = this.editorCtx.trackState;
        const active = this.path();

        const select = document.createElement('select');
        Object.assign(select.style, barControlStyle());
        for (const p of state.paths) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = pathLabel(state, p);
            select.appendChild(opt);
        }
        select.value = active.id;
        select.addEventListener('change', () => this.setActivePath(select.value));
        bar.appendChild(select);

        bar.appendChild(barButton('New road', false, () => {
            const road = createPath(false);
            state.paths.push(road);
            this.setActivePath(road.id);
        }));
        bar.appendChild(barButton(active.closed ? 'Make road' : 'Make loop', false, () => {
            active.closed = !active.closed;
            this.renderPathBar();
        }));
        bar.appendChild(barButton('Delete path', state.paths.length <= 1, () => {
            if (state.paths.length <= 1) return;
            // Checkpoints on this path (any layout) go with it — they'd point
            // at a path that no longer exists.
            const onPath = state.layouts.reduce((n, l) => n + l.checkpoints.filter(c => c.path === active.id).length, 0);
            const cpText = onPath > 0 ? ` and ${onPath} checkpoint(s) on it` : '';
            if ((active.anchors.length > 0 || onPath > 0)
                && !window.confirm(`Delete path ${pathLabel(state, active)} with its ${active.anchors.length} anchor(s)${cpText}?`)) {
                return;
            }
            for (const l of state.layouts) {
                l.checkpoints = l.checkpoints.filter(c => c.path !== active.id);
                normalizeStartFinish(l.checkpoints);
            }
            const i = state.paths.indexOf(active);
            state.paths.splice(i, 1);
            this.setActivePath(state.paths[Math.max(0, i - 1)].id);
        }));

        const hint = document.createElement('span');
        hint.textContent = active.closed
            ? ''
            : active.anchors.length === 0
                ? 'Click on a track to start the road there.'
                : 'Road ends snap onto other paths (Shift skips).';
        Object.assign(hint.style, { color: 'rgba(255,255,255,0.7)', fontSize: '12px', padding: '0 6px' });
        if (hint.textContent) bar.appendChild(hint);
    }

    private currentZoom(): number {
        if (!this.canvas || !this.editorCtx) return 1;
        const rect = this.canvas.getBoundingClientRect();
        const a = this.editorCtx.worldFromClient(rect.left + 0, rect.top + rect.height / 2);
        const b = this.editorCtx.worldFromClient(rect.left + 100, rect.top + rect.height / 2);
        const d = b.x - a.x;
        if (Math.abs(d) < 1e-9) return 1;
        return 100 / d;
    }

    // --- Right-inspector panel for the selected anchor ---

    private renderInspector(): void {
        if (!this.overlays) return;

        if (!this.inspectorEl) {
            this.inspectorEl = document.createElement('div');
            Object.assign(this.inspectorEl.style, {
                display: 'none',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                minWidth: '240px',
                backgroundColor: 'rgba(30, 30, 30, 0.92)',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                pointerEvents: 'auto',
            });
            this.overlays.rightInspector.appendChild(this.inspectorEl);
        }

        if (this.selectedAnchor === null || !this.editorCtx) {
            this.inspectorEl.style.display = 'none';
            this.inspectorEl.replaceChildren();
            return;
        }
        const anchor = this.anchors()[this.selectedAnchor];
        if (!anchor) {
            this.inspectorEl.style.display = 'none';
            this.inspectorEl.replaceChildren();
            return;
        }

        this.inspectorEl.style.display = 'flex';
        this.inspectorEl.replaceChildren();

        const title = document.createElement('div');
        title.textContent = `Anchor #${this.selectedAnchor + 1}`;
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' });
        this.inspectorEl.appendChild(title);

        const pos = document.createElement('div');
        pos.textContent = `pos: (${anchor.pos.x.toFixed(1)}, ${anchor.pos.y.toFixed(1)}) px`;
        Object.assign(pos.style, { opacity: '0.7' });
        this.inspectorEl.appendChild(pos);

        const minPx = fromMetersToPixels(0.5);
        const maxPx = fromMetersToPixels(20);
        const labelEl = document.createElement('div');
        labelEl.textContent = `Half-width: ${fromPixelsToMeters(anchor.halfWidth).toFixed(2)} m`;
        Object.assign(labelEl.style, { marginTop: '4px' });
        this.inspectorEl.appendChild(labelEl);
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'center' });
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(minPx);
        slider.max = String(maxPx);
        slider.step = '0.5';
        slider.value = String(anchor.halfWidth);
        slider.style.flex = '1';
        const num = document.createElement('input');
        num.type = 'number';
        num.step = '0.1';
        num.min = String(fromPixelsToMeters(minPx));
        num.max = String(fromPixelsToMeters(maxPx));
        num.value = fromPixelsToMeters(anchor.halfWidth).toFixed(2);
        Object.assign(num.style, {
            padding: '4px 6px', backgroundColor: '#1e1e1e', color: '#fff',
            border: '1px solid #555', borderRadius: '3px',
            fontFamily: 'inherit', fontSize: '12px', width: '70px',
        });
        slider.addEventListener('input', () => {
            anchor.halfWidth = Number(slider.value);
            num.value = fromPixelsToMeters(anchor.halfWidth).toFixed(2);
            labelEl.textContent = `Half-width: ${fromPixelsToMeters(anchor.halfWidth).toFixed(2)} m`;
        });
        num.addEventListener('change', () => {
            const px = fromMetersToPixels(Number(num.value));
            anchor.halfWidth = Math.max(minPx, Math.min(maxPx, px));
            slider.value = String(anchor.halfWidth);
            labelEl.textContent = `Half-width: ${fromPixelsToMeters(anchor.halfWidth).toFixed(2)} m`;
        });
        row.append(slider, num);
        this.inspectorEl.appendChild(row);

        // Bezier handles toggle: show "Add" when the anchor is linear, "Clear"
        // when it has any handle set. Keeps the inspector compact + consistent
        // with the one-click-to-switch-state pattern.
        const hasHandles = !!(anchor.controlIn || anchor.controlOut);
        const toggle = document.createElement('button');
        toggle.textContent = hasHandles ? 'Clear bezier handles' : 'Add bezier handles';
        Object.assign(toggle.style, {
            marginTop: '6px', padding: '6px 10px',
            backgroundColor: '#3a3a3a', color: '#fff',
            border: '1px solid #555', borderRadius: '4px',
            cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
        });
        toggle.addEventListener('click', () => {
            if (hasHandles) {
                anchor.controlIn = undefined;
                anchor.controlOut = undefined;
                anchor.asymmetric = undefined;
            } else {
                this.addBezierHandles(anchor);
            }
            this.renderInspector();
        });
        this.inspectorEl.appendChild(toggle);

        // Symmetric / Asymmetric toggle — only relevant when handles exist.
        // Default (undefined) = symmetric. Alt during drag always inverts the
        // current mode for that single drag.
        if (hasHandles) {
            const sym = document.createElement('button');
            const isAsym = !!anchor.asymmetric;
            sym.textContent = isAsym ? 'Handles: Asymmetric' : 'Handles: Symmetric';
            Object.assign(sym.style, {
                marginTop: '6px', padding: '6px 10px',
                backgroundColor: isAsym ? '#2a5a8a' : '#3a3a3a',
                color: '#fff',
                border: '1px solid #555', borderRadius: '4px',
                cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
            });
            sym.addEventListener('click', () => {
                anchor.asymmetric = !anchor.asymmetric;
                this.renderInspector();
            });
            this.inspectorEl.appendChild(sym);
        }

        const del = document.createElement('button');
        del.textContent = 'Delete anchor';
        Object.assign(del.style, {
            marginTop: '6px', padding: '6px 10px',
            backgroundColor: '#8a2a2a', color: '#fff',
            border: '1px solid #555', borderRadius: '4px',
            cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
        });
        del.addEventListener('click', () => {
            if (this.selectedAnchor === null || !this.editorCtx) return;
            this.anchors().splice(this.selectedAnchor, 1);
            this.renderPathBar();
            if (this.anchors().length === 0) this.selectedAnchor = null;
            else this.selectedAnchor = Math.max(0, Math.min(this.selectedAnchor, this.anchors().length - 1));
            this.renderInspector();
        });
        this.inspectorEl.appendChild(del);
    }
}

// --- Local helpers ---

// XNOR of (asymmetric flag) and (Alt pressed). Symmetric anchor + no Alt =
// mirror. Symmetric anchor + Alt held = don't mirror (temporary break).
// Asymmetric anchor + no Alt = don't mirror (persistent independence).
// Asymmetric anchor + Alt held = mirror (temporary re-sync).
function shouldMirror(anchor: Anchor, altKey: boolean): boolean {
    return !!anchor.asymmetric === !!altKey;
}

function barControlStyle(): Partial<CSSStyleDeclaration> {
    return {
        padding: '5px 8px',
        backgroundColor: '#3a3a3a',
        color: '#fff',
        border: '1px solid #555',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: 'inherit',
    };
}

function barButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    Object.assign(b.style, barControlStyle(), {
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? '0.45' : '1',
    });
    b.addEventListener('click', onClick);
    return b;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestPointOnSegment(p: { x: number; y: number }, a: Vector, b: Vector): Vector {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-9) return new Vector(a.x, a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    return new Vector(a.x + t * abx, a.y + t * aby);
}
