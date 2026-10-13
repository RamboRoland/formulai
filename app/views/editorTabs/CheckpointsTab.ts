import { Vector } from '~/components/Vector';
import { activeLayout, hasGeometry, type EditorTab, type OverlaySlots, type EditorContext } from './EditorTab';
import { createLayout } from '~/tracks/types';
import { TrackBandRenderer } from './TrackBandRenderer';
import { TyreWallEditor } from './TyreWallEditor';
import { flattenPaths, projectOntoNearestPath, projectOntoPath, type FlatPath } from '~/tracks/vector/paths';
import type { CenterlineProjection } from '~/tracks/vector/project';
import type { Checkpoint, OutlineRing } from '~/tracks/types';
import { normalizeStartFinish, unusedSet } from '~/tracks/vector/layout';
import { buildOutlineGeometry, checkpointEnds, outlinePath } from '~/tracks/vector/outlineShape';
import { TRACK_SURFACE_ALPHA } from './TrackBandRenderer';
import { drawCheckeredLine } from '~/tracks/vector/checkered';
import type { TrackGeometry } from '~/tracks/vector/geometry';

// Clicks within this many CSS px outside the band edge still count as "on track".
const ON_TRACK_TOLERANCE_CSS = 6;
// Clicks within this many CSS px of a checkpoint line select it.
const HIT_TOLERANCE_CSS = 8;

// Checkpoint placement + rendering on the shared in-memory track. A
// checkpoint stores a world position, the path it sits on and its direction
// of travel (`dir`); every render re-projects it onto ITS path's centerline,
// so it follows the track when anchors are edited.
//
// - "Add Checkpoint" (left tool column) toggles placing mode. While placing,
//   a ghost checkpoint follows the cursor along the NEAREST path; click on
//   the track to drop one. It is inserted right after the selected
//   checkpoint (none selected: at the end of the lap — on a one-way layout
//   just before the finish) and becomes the selection, so consecutive clicks
//   chain in order. Mode stays on; click the button again or Esc to stop.
// - Direction of a new checkpoint: the previous checkpoint's `dir` on the
//   same path; on another path, whichever way along it points away from the
//   previous checkpoint. Flip any checkpoint with F (or the inspector).
// - Order is EXPLICIT: the list order is the lap order (#1 = start). ▲▼ in
//   the list move a checkpoint; the start always stays first ("Set as
//   Start" rotates the list to it, which keeps a loop's order).
// - Start/finish: exactly one checkpoint is the start and exactly one is the
//   finish (flags on the checkpoint; may be the same one = loop track). The
//   first checkpoint placed becomes both.
// - One-way layout (start ≠ finish): checkpoints after the finish in the
//   list are "unused" — kept, drawn dimmed, dropped on export.
// - Rendering: line across the full track width with its number and a
//   direction arrow. Start/finish = checkered.
// - Layouts: the tab edits the ACTIVE layout (picker in the top strip).
//   The anchors are never modified, so other layouts are unaffected.
//   "Duplicate" copies the active layout (lap times included); "Reverse"
//   drives a loop layout the other way in place (lap times reset to 0).
//
// - Select by clicking a checkpoint line; drag moves it along its own path;
//   Delete/Backspace removes it; Esc deselects. Inspector: Set as Start,
//   Set as Finish, Flip direction, Delete.
//
// - List (bottom-left): numbered in lap order with Start/Finish/unused tags
//   and ▲▼; click a row to select; header collapses it. Below it the
//   layout's tyre walls.
//
// - Tyre walls (shown as the "Layout" tab): "Add Tyre Wall" + editing live
//   in TyreWallEditor. Only the ACTIVE layout's walls are drawn; checkpoint
//   lines stop at them like in the game. A checkpoint and a wall are never
//   selected at the same time.
export class CheckpointsTab implements EditorTab {
    private editorCtx: EditorContext | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private band = new TrackBandRenderer();

    private placing = false;
    // Where a click would place a checkpoint (nearest path), or null.
    private hover: { path: string; proj: CenterlineProjection } | null = null;

    private addBtn: HTMLButtonElement | null = null;
    private wallBtn: HTMLButtonElement | null = null;
    private walls = new TyreWallEditor({
        ctx: () => this.editorCtx,
        zoom: () => this.currentZoom(),
        changed: () => { this.renderInspector(); this.updateHint(); },
        selectedWall: () => { this.selected = null; this.dragging = false; },
    });
    private hintEl: HTMLDivElement | null = null;
    private layoutBarEl: HTMLDivElement | null = null;
    private renaming = false;
    private inspectorEl: HTMLDivElement | null = null;
    private listEl: HTMLDivElement | null = null;
    private listCollapsed = false;

    // Selection is an object reference (not an index): ▲▼, Set as Start and
    // inserts move checkpoints around the list.
    private selected: Checkpoint | null = null;
    private dragging = false;

    // Cached outline geometry (see outlineGeometry()) and surface path,
    // each rebuilt only when the outline object changes.
    private geometry: TrackGeometry | null = null;
    private geometryFor: OutlineRing[] | null = null;
    private geometryWallsKey = '';
    private surfacePath: Path2D | null = null;
    private surfaceFor: OutlineRing[] | null = null;

    public mount(canvas: HTMLCanvasElement, overlays: OverlaySlots, ctx: EditorContext): void {
        this.editorCtx = ctx;
        this.canvas = canvas;

        this.addBtn = document.createElement('button');
        Object.assign(this.addBtn.style, {
            padding: '8px 12px',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'inherit',
            pointerEvents: 'auto',
        });
        this.addBtn.addEventListener('click', () => this.setPlacing(!this.placing));
        overlays.leftTools.appendChild(this.addBtn);

        this.wallBtn = document.createElement('button');
        this.wallBtn.style.cssText = this.addBtn.style.cssText;  // same look
        this.wallBtn.addEventListener('click', () => {
            const on = !this.walls.placing;
            if (on) this.setPlacing(false);
            this.walls.setPlacing(on);
        });
        overlays.leftTools.appendChild(this.wallBtn);

        // Layout picker (dropdown + Add / Rename / Delete), left of the hint.
        this.layoutBarEl = document.createElement('div');
        Object.assign(this.layoutBarEl.style, {
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            padding: '4px',
            backgroundColor: 'rgba(30, 30, 30, 0.85)',
            borderRadius: '6px',
            pointerEvents: 'auto',
        });
        overlays.topStrip.appendChild(this.layoutBarEl);

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

        this.inspectorEl = document.createElement('div');
        Object.assign(this.inspectorEl.style, {
            display: 'none',
            flexDirection: 'column',
            gap: '6px',
            padding: '12px',
            minWidth: '200px',
            backgroundColor: 'rgba(30, 30, 30, 0.92)',
            border: '1px solid #444',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '12px',
            pointerEvents: 'auto',
        });
        overlays.rightInspector.appendChild(this.inspectorEl);

        this.listEl = document.createElement('div');
        Object.assign(this.listEl.style, {
            display: 'flex',
            flexDirection: 'column',
            minWidth: '200px',
            backgroundColor: 'rgba(30, 30, 30, 0.92)',
            border: '1px solid #444',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '12px',
            pointerEvents: 'auto',
            overflow: 'hidden',
        });
        overlays.bottomLeft.appendChild(this.listEl);

        this.setPlacing(false);
    }

    public unmount(): void {
        this.setPlacing(false);
        this.walls.reset();
        this.wallBtn?.remove();
        this.wallBtn = null;
        this.addBtn?.remove();
        this.hintEl?.remove();
        this.layoutBarEl?.remove();
        this.layoutBarEl = null;
        this.renaming = false;
        this.inspectorEl?.remove();
        this.listEl?.remove();
        this.listEl = null;
        this.addBtn = null;
        this.inspectorEl = null;
        this.selected = null;
        this.dragging = false;
        this.hintEl = null;
        this.band.dispose();
        this.editorCtx = null;
        this.canvas = null;
    }

    private setPlacing(on: boolean): void {
        this.placing = on;
        if (!on) this.hover = null;
        if (on && this.walls.placing) this.walls.setPlacing(false);
        // The selection stays: new checkpoints go in right after it.
        this.updateHint();
    }

    // Tool buttons + cursor for the current mode (from updateHint).
    private updateTools(): void {
        if (this.addBtn) {
            this.addBtn.textContent = this.placing ? 'Placing… (Esc)' : 'Add Checkpoint';
            this.addBtn.style.backgroundColor = this.placing ? '#2a5a8a' : '#3a3a3a';
        }
        if (this.wallBtn) {
            this.wallBtn.textContent = this.walls.placing ? 'Drawing wall… (Enter)' : 'Add Tyre Wall';
            this.wallBtn.style.backgroundColor = this.walls.placing ? '#2a5a8a' : '#3a3a3a';
        }
        if (this.canvas) this.canvas.style.cursor = this.placing || this.walls.placing ? 'crosshair' : 'grab';
    }

    // --- Layout picker ---

    private renderLayoutBar(): void {
        const bar = this.layoutBarEl;
        if (!bar || !this.editorCtx) return;
        bar.replaceChildren();
        const state = this.editorCtx.trackState;
        const active = activeLayout(state);

        if (this.renaming) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = active.name;
            Object.assign(input.style, layoutControlStyle(), { width: '140px' });
            // `done` guards against the blur that fires when the input is
            // removed from the DOM — without it, Esc would still save.
            let done = false;
            const finish = (save: boolean) => {
                if (done) return;
                done = true;
                const name = input.value.trim();
                if (save && name) active.name = name;
                this.renaming = false;
                this.renderLayoutBar();
            };
            input.addEventListener('keydown', (e) => {
                // Keep editor shortcuts (Delete, Esc…) from firing while typing.
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
            });
            input.addEventListener('blur', () => finish(true));
            bar.appendChild(input);
            queueMicrotask(() => { input.focus(); input.select(); });
            return;
        }

        const select = document.createElement('select');
        Object.assign(select.style, layoutControlStyle());
        for (const l of state.layouts) {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            select.appendChild(opt);
        }
        select.value = active.id;
        select.addEventListener('change', () => this.switchLayout(select.value));
        bar.appendChild(select);

        bar.appendChild(this.layoutButton('Add', false, () => {
            const layout = createLayout();
            state.layouts.push(layout);
            this.switchLayout(layout.id);
        }));
        // Copy the active layout as-is (same direction, lap times + tyre walls included).
        bar.appendChild(this.layoutButton('Duplicate', false, () => {
            const layout = createLayout(`${active.name} (copy)`);
            layout.checkpoints = active.checkpoints.map(c => ({ ...c, pos: new Vector(c.pos.x, c.pos.y) }));
            layout.expectedLapTimes = { ...active.expectedLapTimes };
            const v = (p: Vector) => new Vector(p.x, p.y);
            if (active.walls) layout.walls = active.walls.map(w => ({
                nodes: w.nodes.map(n => ({ ...n, pos: v(n.pos), in: n.in && v(n.in), out: n.out && v(n.out) })),
            }));
            state.layouts.push(layout);
            this.switchLayout(layout.id);
        }));
        // Loop layouts only: drive the active layout the other way, in place —
        // start stays first, the rest in reverse order, every `dir` flipped.
        // Lap times reset to 0 (they differ per direction).
        const loop = active.checkpoints.some(c => c.isStart && c.isFinish);
        bar.appendChild(this.layoutButton('Reverse', !loop, () => {
            if (!loop) return;
            const cps = active.checkpoints;
            const rest = cps.slice(1).reverse();
            cps.splice(1, rest.length, ...rest);
            for (const c of cps) c.dir = c.dir === 1 ? -1 : 1;
            for (const car of Object.keys(active.expectedLapTimes)) active.expectedLapTimes[car] = 0;
            this.renderInspector(); // numbers changed → refresh inspector + list
            this.updateHint();
        }));
        bar.appendChild(this.layoutButton('Rename', false, () => {
            this.renaming = true;
            this.renderLayoutBar();
        }));
        bar.appendChild(this.layoutButton('Delete', state.layouts.length <= 1, () => {
            if (state.layouts.length <= 1) return;
            if (active.checkpoints.length > 0
                && !window.confirm(`Delete layout "${active.name}" and its ${active.checkpoints.length} checkpoint(s)?`)) {
                return;
            }
            const i = state.layouts.indexOf(active);
            state.layouts.splice(i, 1);
            this.switchLayout(state.layouts[Math.max(0, i - 1)].id);
        }));
    }

    private switchLayout(id: string): void {
        if (!this.editorCtx) return;
        this.walls.reset();  // walls belong to the previous layout
        this.editorCtx.trackState.activeLayoutId = id;
        this.hover = null;
        this.select(null);   // selection belonged to the previous layout
        this.updateHint();   // also re-renders list + layout bar
    }

    private layoutButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = disabled;
        Object.assign(b.style, layoutControlStyle(), {
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? '0.45' : '1',
        });
        b.addEventListener('click', onClick);
        return b;
    }

    // Every path flattened, by id (cheap enough to redo per event/render).
    private flatPaths(): Map<string, FlatPath> {
        const paths = this.editorCtx ? flattenPaths(this.editorCtx.trackState.paths) : [];
        return new Map(paths.map(p => [p.id, p]));
    }

    // A checkpoint projected onto its own path (null if the path is gone or
    // has no geometry).
    private project(cp: Checkpoint, flats: Map<string, FlatPath>): CenterlineProjection | null {
        const path = flats.get(cp.path);
        return path ? projectOntoPath(path, cp.pos.x, cp.pos.y) : null;
    }

    // Where a new checkpoint goes in the list: right after the selected one;
    // none selected → end of the lap (one-way: just before the finish).
    private insertIndex(cps: Checkpoint[]): number {
        const sel = this.selected ? cps.indexOf(this.selected) : -1;
        if (sel >= 0) return sel + 1;
        const fi = cps.findIndex(c => c.isFinish);
        return fi > 0 && !cps[fi].isStart ? fi : cps.length;
    }

    // Direction for a new checkpoint at `at` on `path`, inserted after `prev`:
    // same path → prev's dir; another path → the way along it that points
    // away from prev; first checkpoint → 1.
    private newDir(prev: Checkpoint | undefined, path: string, at: CenterlineProjection): 1 | -1 {
        if (!prev) return 1;
        if (prev.path === path) return prev.dir;
        const dot = at.tangent.x * (at.pos.x - prev.pos.x) + at.tangent.y * (at.pos.y - prev.pos.y);
        return dot < 0 ? -1 : 1;
    }

    private updateHint(): void {
        this.renderList();
        this.renderLayoutBar();
        this.updateTools();
        if (!this.hintEl || !this.editorCtx) return;
        const hasTrack = hasGeometry(this.editorCtx.trackState);
        const cps = activeLayout(this.editorCtx.trackState).checkpoints;
        const count = cps.length;
        const loop = count > 0 && cps.some(c => c.isStart && c.isFinish);
        const base = !hasTrack
            ? 'Author a track in the Track tab first.'
            : this.walls.placing
                ? 'Click to place tyre-wall points · Enter / double-click finishes (Shift = no grid snap).'
            : this.placing
                ? 'Click the track to place a checkpoint.'
                : count === 0
                    ? 'No checkpoints'
                    : `${count} checkpoint${count === 1 ? '' : 's'} · ${loop ? 'loop' : 'one-way'}`;
        const noOutline = hasTrack && !this.editorCtx.trackState.outline;
        this.hintEl.textContent = noOutline
            ? `${base} · Generate the outline (Outline tab) for exact checkpoint lines.`
            : base;
    }

    // --- Render ---

    public render(ctx: CanvasRenderingContext2D, zoom: number): void {
        if (!this.editorCtx || !hasGeometry(this.editorCtx.trackState)) return;

        const outline = this.editorCtx.trackState.outline;
        const flats = this.flatPaths();
        const flatPaths = [...flats.values()];
        if (outline) this.drawOutlineSurface(ctx, outline, flatPaths, zoom);
        else this.band.draw(ctx, flatPaths, zoom);

        // Faded anchors (every path) — reference only, not editable here.
        ctx.save();
        ctx.fillStyle = 'rgba(74, 158, 255, 0.35)';
        const r = 4 / zoom;
        for (const a of this.editorCtx.trackState.paths.flatMap(p => p.anchors)) {
            ctx.beginPath();
            ctx.arc(a.pos.x, a.pos.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // This layout's tyre walls (+ the selected one's points).
        this.walls.render(ctx, zoom);

        // Checkpoints in list (= lap) order, each re-projected onto its path.
        const cps = activeLayout(this.editorCtx.trackState).checkpoints;
        normalizeStartFinish(cps);
        const unused = unusedSet(cps);
        cps.forEach((cp, i) => {
            const proj = this.project(cp, flats);
            if (!proj) return;
            this.drawCheckpoint(ctx, proj, i, cp.dir, zoom, {
                start: !!cp.isStart,
                finish: !!cp.isFinish,
                unused: unused.has(cp),
                ghost: false,
                selected: cp === this.selected,
            });
        });

        // Ghost preview while placing — numbered by where it will be
        // inserted. The very first checkpoint previews as start + finish.
        if (this.placing && this.hover) {
            const first = cps.length === 0;
            const index = this.insertIndex(cps);
            const dir = this.newDir(cps[index - 1], this.hover.path, this.hover.proj);
            this.drawCheckpoint(ctx, this.hover.proj, index, dir, zoom, {
                start: first, finish: first, unused: false, ghost: true, selected: false,
            });
        }
    }

    // Track surface from the outline (what the game draws and what the
    // checkpoint lines reach), styled like the band: semi-transparent fill,
    // light edge, dashed centerlines.
    private drawOutlineSurface(ctx: CanvasRenderingContext2D, outline: OutlineRing[], paths: FlatPath[], zoom: number): void {
        if (outline !== this.surfaceFor) {
            this.surfaceFor = outline;
            this.surfacePath = outlinePath(outline);
        }
        const path = this.surfacePath!;
        ctx.save();
        ctx.fillStyle = `rgba(60, 60, 60, ${TRACK_SURFACE_ALPHA})`;
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = 'rgba(220, 220, 220, 0.9)';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke(path);

        ctx.beginPath();
        for (const { flat, closed } of paths) {
            if (flat.length < 2) continue;
            ctx.moveTo(flat[0].pos.x, flat[0].pos.y);
            for (let i = 1; i < flat.length; i++) ctx.lineTo(flat[i].pos.x, flat[i].pos.y);
            if (closed) ctx.closePath();
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.stroke();
        ctx.restore();
    }

    private drawCheckpoint(
        ctx: CanvasRenderingContext2D,
        p: CenterlineProjection,
        index: number,
        dir: 1 | -1,
        zoom: number,
        style: { start: boolean; finish: boolean; unused: boolean; ghost: boolean; selected: boolean },
    ): void {
        const nx = -p.tangent.y;
        const ny = p.tangent.x;
        const w = p.halfWidth;
        // Line runs edge to edge of the outline (same as the game).
        const ends = checkpointEnds(this.outlineGeometry(), p);
        const ax = ends.a.x, ay = ends.a.y;
        const bx = ends.b.x, by = ends.b.y;
        const color = style.unused ? '#888888'
            : style.start || style.finish ? '#ffffff'
            : '#3ddc84';

        // Selection glow underneath the line.
        if (style.selected) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 207, 51, 0.8)';
            ctx.lineWidth = 10 / zoom;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.globalAlpha = style.ghost ? 0.5 : style.unused ? 0.35 : 1;
        ctx.lineCap = 'butt';

        if ((style.finish || style.start) && !style.unused) {
            // Start and finish: two-row checkered strip, same drawing as the
            // game (squares a constant 6 px on screen here).
            drawCheckeredLine(ctx, { x: ax, y: ay }, { x: bx, y: by }, 6 / zoom);
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = (style.start ? 3 : 2) / zoom;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }

        // Direction-of-travel arrow on every checkpoint (path tangent × dir);
        // the start's is longer.
        {
            ctx.strokeStyle = style.start || style.finish ? '#ffffff' : color;
            ctx.lineWidth = 2 / zoom;
            ctx.lineCap = 'round';
            const tx = p.tangent.x * dir, ty = p.tangent.y * dir;
            const len = Math.min(w, (style.start ? 40 : 24) / zoom);
            const tipX = p.pos.x + tx * len;
            const tipY = p.pos.y + ty * len;
            const head = 8 / zoom;
            ctx.beginPath();
            ctx.moveTo(p.pos.x, p.pos.y);
            ctx.lineTo(tipX, tipY);
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - tx * head + nx * head * 0.6, tipY - ty * head + ny * head * 0.6);
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - tx * head - nx * head * 0.6, tipY - ty * head - ny * head * 0.6);
            ctx.stroke();
        }

        // Number label just past one end of the line (constant screen size).
        const labelOffset = 12 / zoom;
        const lx = ax + nx * labelOffset;
        const ly = ay + ny * labelOffset;
        ctx.setTransform(ctx.getTransform().translate(lx, ly).scale(1 / zoom, 1 / zoom));
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(String(index + 1), 0, 0);
        ctx.restore();
    }

    // --- Mouse / keys ---

    public onMouseMove(e: MouseEvent): boolean {
        if (this.walls.onMouseMove(e)) return true;
        if (this.dragging && this.selected && this.editorCtx) {
            // Drag stays on the checkpoint's own path: project the cursor (no
            // on-track requirement, so the drag doesn't stall when you overshoot).
            const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
            const proj = this.project({ ...this.selected, pos: new Vector(world.x, world.y) }, this.flatPaths());
            if (proj) this.selected.pos = new Vector(proj.pos.x, proj.pos.y);
            return true;
        }
        if (!this.placing) return false;
        this.hover = this.projectIfOnTrack(e);
        return false; // don't block shell behavior (e.g. middle-drag pan)
    }

    public onMouseDown(e: MouseEvent): boolean {
        if (e.button !== 0 || !this.editorCtx) return false;

        if (this.placing) {
            const hit = this.projectIfOnTrack(e);
            if (!hit) return true; // clicked off-track while placing: swallow, do nothing
            const cps = activeLayout(this.editorCtx.trackState).checkpoints;
            const index = this.insertIndex(cps);
            const cp: Checkpoint = {
                pos: new Vector(hit.proj.pos.x, hit.proj.pos.y),
                path: hit.path,
                dir: this.newDir(cps[index - 1], hit.path, hit.proj),
            };
            cps.splice(index, 0, cp);
            normalizeStartFinish(cps); // first checkpoint ever → start + finish
            this.select(cp);           // the next one goes in after this one
            this.updateHint();
            return true;
        }

        // Not placing. Priority: the selected wall's points/handles (or
        // drawing a wall) → a checkpoint (select + drag) → a wall's line
        // (select it / insert a point) → empty space deselects.
        if (this.walls.onMouseDown(e)) return true;
        const hit = this.hitTestCheckpoint(e);
        if (hit) {
            this.select(hit);
            this.dragging = true;
            if (this.canvas) this.canvas.style.cursor = 'grabbing';
            return true;
        }
        if (this.walls.onMouseDownCurve(e)) return true;
        this.select(null);
        return false;
    }

    public onMouseUp(e: MouseEvent): boolean {
        if (this.walls.onMouseUp(e)) return true;
        if (this.dragging) {
            this.dragging = false;
            if (this.canvas) this.canvas.style.cursor = this.placing ? 'crosshair' : 'grab';
            return true;
        }
        return this.placing;
    }

    public onKeyDown(e: KeyboardEvent): boolean {
        if (this.walls.onKeyDown(e)) return true;
        if (e.key === 'Escape') {
            if (this.placing) { this.setPlacing(false); return true; }
            if (this.selected) { this.select(null); return true; }
            return false;
        }
        const target = e.target as HTMLElement | null;
        const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && !typing) {
            e.preventDefault();
            this.deleteSelected();
            return true;
        }
        if ((e.key === 'f' || e.key === 'F') && this.selected && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
            this.flipSelected();
            return true;
        }
        return false;
    }

    // --- Selection + edits ---

    // Selecting a checkpoint (or nothing) also drops the wall selection.
    private select(cp: Checkpoint | null): void {
        this.selected = cp;
        this.walls.wall = null;
        this.walls.node = null;
        this.renderInspector();
    }

    private deleteSelected(): void {
        if (!this.editorCtx || !this.selected) return;
        const cps = activeLayout(this.editorCtx.trackState).checkpoints;
        const i = cps.indexOf(this.selected);
        if (i >= 0) cps.splice(i, 1);
        // Deleting the start → next in list (now first) becomes start.
        // Deleting the finish → the start becomes the finish too (loop).
        normalizeStartFinish(cps);
        this.select(null);
        this.updateHint();
    }

    private setRole(role: 'start' | 'finish'): void {
        if (!this.editorCtx || !this.selected) return;
        const cps = activeLayout(this.editorCtx.trackState).checkpoints;
        for (const c of cps) {
            if (role === 'start') c.isStart = undefined;
            else c.isFinish = undefined;
        }
        if (role === 'start') {
            this.selected.isStart = true;
            // Start is always #1: rotate the list to it (keeps a loop's order).
            const i = cps.indexOf(this.selected);
            if (i > 0) cps.push(...cps.splice(0, i));
        } else {
            this.selected.isFinish = true;
        }
        this.renderInspector();
        this.updateHint();
    }

    private flipSelected(): void {
        if (!this.selected) return;
        this.selected.dir = this.selected.dir === 1 ? -1 : 1;
        this.renderInspector();
    }

    // Move a checkpoint one step up/down the list. The start stays #1, so
    // nothing moves into or out of index 0.
    private move(cp: Checkpoint, delta: -1 | 1): void {
        if (!this.editorCtx) return;
        const cps = activeLayout(this.editorCtx.trackState).checkpoints;
        const i = cps.indexOf(cp), j = i + delta;
        if (i <= 0 || j <= 0 || j >= cps.length) return;
        [cps[i], cps[j]] = [cps[j], cps[i]];
        this.renderInspector();
        this.updateHint();
    }

    // Hit-test the rendered checkpoint lines (within a few CSS px of the line).
    private hitTestCheckpoint(e: MouseEvent): Checkpoint | null {
        if (!this.editorCtx) return null;
        const checkpoints = activeLayout(this.editorCtx.trackState).checkpoints;
        if (checkpoints.length === 0) return null;
        const flats = this.flatPaths();
        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        const tol = HIT_TOLERANCE_CSS / this.currentZoom();
        const geometry = this.outlineGeometry();
        let best: Checkpoint | null = null;
        let bestD = tol;
        for (const cp of checkpoints) {
            const p = this.project(cp, flats);
            if (!p) continue;
            const { a, b } = checkpointEnds(geometry, p);
            const d = distToSegment(world.x, world.y, a.x, a.y, b.x, b.y);
            if (d <= bestD) { bestD = d; best = cp; }
        }
        return best;
    }

    // --- Inspector ---

    // --- List (bottom-left) ---

    // Numbered list in lap order. Click a row to select that checkpoint.
    // Header toggles collapse. Rebuilt from updateHint/renderInspector, which
    // run on every checkpoint change.
    private renderList(): void {
        const el = this.listEl;
        if (!el || !this.editorCtx) return;
        el.replaceChildren();
        const checkpoints = activeLayout(this.editorCtx.trackState).checkpoints;

        const header = document.createElement('div');
        header.textContent = `${this.listCollapsed ? '▸' : '▾'} Checkpoints (${checkpoints.length})`;
        Object.assign(header.style, {
            padding: '8px 10px',
            fontWeight: 'bold',
            cursor: 'pointer',
            userSelect: 'none',
        });
        header.addEventListener('click', () => {
            this.listCollapsed = !this.listCollapsed;
            this.renderList();
        });
        el.appendChild(header);
        if (this.listCollapsed) return;

        const unused = unusedSet(checkpoints);
        const body = document.createElement('div');
        Object.assign(body.style, { maxHeight: '240px', overflowY: 'auto', borderTop: '1px solid #444' });
        checkpoints.forEach((cp, i) => {
            const row = document.createElement('div');
            const tags = [cp.isStart ? 'Start' : '', cp.isFinish ? 'Finish' : '', unused.has(cp) ? 'unused' : '']
                .filter(Boolean).join(' · ');
            const label = document.createElement('span');
            label.textContent = tags ? `#${i + 1}  ${tags}` : `#${i + 1}`;
            label.style.flex = '1';
            row.appendChild(label);
            // ▲▼ reorder; the start (#1) is fixed and nothing moves above it.
            row.appendChild(this.moveButton('▲', i <= 1, () => this.move(cp, -1)));
            row.appendChild(this.moveButton('▼', i === 0 || i === checkpoints.length - 1, () => this.move(cp, 1)));
            const isSel = cp === this.selected;
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 6px 4px 10px',
                cursor: 'pointer',
                backgroundColor: isSel ? 'rgba(255, 207, 51, 0.25)' : 'transparent',
                opacity: unused.has(cp) ? '0.5' : '1',
            });
            row.addEventListener('click', () => this.select(cp));
            body.appendChild(row);
        });
        if (checkpoints.length > 0) el.appendChild(body);
        el.appendChild(this.walls.listSection());
    }

    private renderInspector(): void {
        this.renderList();
        const el = this.inspectorEl;
        if (!el) return;
        el.replaceChildren();
        if (this.walls.wall) {
            el.style.display = 'flex';
            this.walls.fillInspector(el, (label, disabled, onClick) => this.inspectorButton(label, disabled, onClick));
            return;
        }
        if (!this.selected || !this.editorCtx) {
            el.style.display = 'none';
            return;
        }
        el.style.display = 'flex';
        const cp = this.selected;
        const number = activeLayout(this.editorCtx.trackState).checkpoints.indexOf(cp) + 1;

        const title = document.createElement('div');
        title.textContent = `Checkpoint #${number}`;
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' });
        el.appendChild(title);

        const roles = [cp.isStart ? 'Start' : '', cp.isFinish ? 'Finish' : ''].filter(Boolean).join(' + ');
        const roleEl = document.createElement('div');
        roleEl.textContent = roles || 'Regular checkpoint';
        roleEl.style.opacity = '0.7';
        el.appendChild(roleEl);

        el.appendChild(this.inspectorButton('Set as Start', !!cp.isStart, () => this.setRole('start')));
        el.appendChild(this.inspectorButton('Set as Finish', !!cp.isFinish, () => this.setRole('finish')));
        el.appendChild(this.inspectorButton('Flip direction (F)', false, () => this.flipSelected()));
        const del = this.inspectorButton('Delete checkpoint', false, () => this.deleteSelected());
        del.style.backgroundColor = '#8a2a2a';
        el.appendChild(del);
    }

    private inspectorButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = disabled;
        Object.assign(b.style, {
            padding: '6px 10px',
            backgroundColor: '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? '0.45' : '1',
            fontSize: '12px',
            fontFamily: 'inherit',
        });
        b.addEventListener('click', onClick);
        return b;
    }

    // Project the cursor onto the NEAREST path's centerline; null if the
    // cursor isn't on that road's band (plus a small screen-space tolerance).
    private projectIfOnTrack(e: MouseEvent): { path: string; proj: CenterlineProjection } | null {
        if (!this.editorCtx) return null;
        const world = this.editorCtx.worldFromClient(e.clientX, e.clientY);
        const hit = projectOntoNearestPath([...this.flatPaths().values()], world.x, world.y);
        if (!hit) return null;
        const tolWorld = ON_TRACK_TOLERANCE_CSS / this.currentZoom();
        const { projection: proj } = hit;
        return proj.distance <= proj.halfWidth + tolWorld ? { path: hit.pathId, proj } : null;
    }

    private moveButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = disabled;
        Object.assign(b.style, {
            padding: '1px 6px',
            backgroundColor: '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '3px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? '0.3' : '1',
            fontSize: '10px',
            fontFamily: 'inherit',
        });
        b.addEventListener('click', (e) => {
            e.stopPropagation(); // don't also select the row
            onClick();
        });
        return b;
    }

    // Query geometry for the track's outline, built once per outline object
    // (the outline only changes on the Outline tab, and switching tabs or
    // New/Open remounts this tab). null = no outline yet.
    // Rebuilt when the outline object or the active layout's walls change
    // (checkpoint lines stop at walls, as in the game).
    private outlineGeometry(): TrackGeometry | null {
        const outline = this.editorCtx?.trackState.outline ?? null;
        const walls = this.walls.walls();
        const wallsKey = JSON.stringify(walls);
        if (outline !== this.geometryFor || wallsKey !== this.geometryWallsKey) {
            this.geometryFor = outline;
            this.geometryWallsKey = wallsKey;
            this.geometry = outline ? buildOutlineGeometry(outline, walls) : null;
        }
        return this.geometry;
    }

    private currentZoom(): number {
        if (!this.canvas || !this.editorCtx) return 1;
        const rect = this.canvas.getBoundingClientRect();
        const a = this.editorCtx.worldFromClient(rect.left, rect.top + rect.height / 2);
        const b = this.editorCtx.worldFromClient(rect.left + 100, rect.top + rect.height / 2);
        const d = b.x - a.x;
        return Math.abs(d) < 1e-9 ? 1 : 100 / d;
    }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function layoutControlStyle(): Partial<CSSStyleDeclaration> {
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
