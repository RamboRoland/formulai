import { createLayout, type Layout, type OutlineRing, type TrackPath } from '~/tracks/types';

// Five absolutely-positioned overlay regions floating ON TOP of the editor
// canvas. The shell owns the DOM nodes; each tab appends/removes its own
// controls to the slots it needs. Containers have `pointer-events: none`;
// buttons/panels appended by the tabs re-enable `pointer-events: auto` so
// the canvas stays interactive everywhere else.
export type OverlaySlots = {
    topStrip: HTMLElement;       // top edge, horizontal strip
    leftTools: HTMLElement;      // left-middle, vertical stack
    rightInspector: HTMLElement; // right-middle, vertical stack
    bottomRight: HTMLElement;    // bottom-right corner cluster
    bottomLeft: HTMLElement;     // bottom-left corner (e.g. collapsible list)
};

// In-memory authoring state shared across tabs. TrackTab mutates the shared
// geometry (paths; it edits the ACTIVE path); CheckpointsTab mutates the
// ACTIVE layout's checkpoints. Always holds at least one path and one layout.
export type VectorTrackState = {
    paths: TrackPath[];
    activePathId: string;
    layouts: Layout[];
    activeLayoutId: string;
    // Track edge (Outline tab). null = not generated yet.
    outline: OutlineRing[] | null;
    // Snapshot of the paths the outline was generated from (in memory
    // only, never saved). Differs from the current paths → the outline
    // may be out of date. null = unknown (e.g. opened from a file).
    outlinePathsKey: string | null;
};

let pathSeq = 0;
// New empty path with a unique id. A fresh track starts with one loop;
// "New road" adds open ones.
export const createPath = (closed: boolean): TrackPath => {
    pathSeq++;
    return { id: `path-${Date.now().toString(36)}-${pathSeq}`, anchors: [], closed };
};

export const createTrackState = (): VectorTrackState => {
    const first = createLayout();
    const loop = createPath(true);
    return {
        paths: [loop], activePathId: loop.id,
        layouts: [first], activeLayoutId: first.id,
        outline: null, outlinePathsKey: null,
    };
};

// Snapshot key for "was the geometry changed since the outline was made?".
export const pathsKey = (paths: TrackPath[]): string => JSON.stringify(paths);

// The path the Track tab is editing. Falls back to the first path if the
// active id is stale (e.g. after a delete).
export const activePath = (state: VectorTrackState): TrackPath =>
    state.paths.find(p => p.id === state.activePathId) ?? state.paths[0];

// True if any path has enough anchors to have a surface.
export const hasGeometry = (state: VectorTrackState): boolean =>
    state.paths.some(p => p.anchors.length >= 2);

// Automatic path label for pickers: "1 · Loop", "2 · Road".
export const pathLabel = (state: VectorTrackState, path: TrackPath): string =>
    `${state.paths.indexOf(path) + 1} · ${path.closed ? 'Loop' : 'Road'}`;

// The layout currently being edited. Falls back to the first layout if the
// active id is stale (e.g. after a delete).
export const activeLayout = (state: VectorTrackState): Layout =>
    state.layouts.find(l => l.id === state.activeLayoutId) ?? state.layouts[0];

// Shell-level APIs tabs are allowed to call. Everything's a method or a
// stable reference — tabs never reach into the shell directly. Keeps the
// contract explicit and makes tabs testable in isolation.
export type EditorContext = {
    // Shared authoring state (mutable; tabs edit in place and request a
    // redraw by calling `requestRender`).
    trackState: VectorTrackState;

    // Round a world-space point to the grid (passthrough if snap disabled
    // or Shift held). See TrackEditorView.snapPoint.
    snapPoint(x: number, y: number): { x: number; y: number };

    // True when snapping applies right now (Snap toggle on, Shift not
    // held). For tabs that snap to something other than the grid.
    isSnapActive(): boolean;

    // Convert a browser-client coordinate (e.g. e.clientX/Y) into a world-
    // space point under the current camera. Needed by any tab that reacts
    // to mouse events to place/drag things in world space.
    worldFromClient(clientX: number, clientY: number): { x: number; y: number };
};

// Contract each editor tab implements. The shell calls `mount` with the
// shared canvas, the overlay slots, and an EditorContext. `unmount` cleans
// up everything the tab created.
//
// Optional hooks:
// - `render(ctx, zoom)` runs each frame AFTER background + grid, in world-
//   space ctx. `zoom` = effective CSS-px-per-world-px so the tab can
//   reciprocate for 1-CSS-px line widths and screen-sized hit markers.
// - Mouse/keyboard hooks run BEFORE the shell's own handlers. Return
//   `true` to consume the event (shell skips its default — e.g., no
//   background drag, no delete-key side effects). Return `false` to let
//   the shell handle normally.
export interface EditorTab {
    mount(canvas: HTMLCanvasElement, overlays: OverlaySlots, ctx: EditorContext): void;
    unmount(): void;
    render?(canvasCtx: CanvasRenderingContext2D, zoom: number): void;
    onMouseDown?(e: MouseEvent): boolean;
    onMouseMove?(e: MouseEvent): boolean;
    onMouseUp?(e: MouseEvent): boolean;
    onKeyDown?(e: KeyboardEvent): boolean;
}
