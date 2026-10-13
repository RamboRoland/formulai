import type { View } from './View';
import { pathsKey, createTrackState, type EditorTab, type OverlaySlots, type EditorContext, type VectorTrackState } from './editorTabs/EditorTab';
import { TrackTab } from './editorTabs/TrackTab';
import { CheckpointsTab } from './editorTabs/CheckpointsTab';
import { OutlineTab } from './editorTabs/OutlineTab';
import { TrackFileMenu } from './TrackFileMenu';
import type { TrackData } from '~/tracks/serialize';
import { fromPixelsToMeters, fromPixelsToCm } from '~/helper';

// Base zoom: viewport width should show this many world-pixels. At 24 px/m
// that's 125 m across the viewport at default zoom (preserves roughly the
// field of view the old 1500-px zoom gave at 12 px/m).
const BASE_ZOOM_WORLD_WIDTH = 3000;

// Vite glob: all files in app/assets/trace-maps/ become URL imports (any
// image format). Dropping a new file in the folder → appears in the picker
// on next page load. Keys are source paths like
// '/app/assets/trace-maps/foo.png'; values are the asset URLs served by
// Vite/the build. (Not public/: Vite can't import from there.)
const TRACE_MAP_FILES = import.meta.glob<string>(
    '/app/assets/trace-maps/*',
    { eager: true, query: '?url', import: 'default' }
);
const TRACE_MAPS: Array<{ src: string; label: string }> = Object.entries(TRACE_MAP_FILES)
    .filter(([path]) => !path.endsWith('/.gitkeep'))
    .map(([path, url]) => ({
        src: url,
        label: path.split('/').pop() ?? path,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

type BackgroundState = {
    src: string;         // asset URL of an app/assets/trace-maps/ file
    scale: number;       // world-px per image-px
    offsetX: number;     // world-px offset of the image's top-left corner
    offsetY: number;
    rotation: number;    // degrees (clockwise)
    opacity: number;     // 0..1
    locked: boolean;     // true = can't drag; drag pans the canvas instead
};

type TabId = 'track' | 'outline' | 'checkpoints';

type TabRegistration = {
    id: TabId;
    label: string;
    create: () => EditorTab;
};

// Track first — authoring the path is the primary flow. Outline is derived
// from the track; Checkpoints depend on an in-memory track existing.
const TABS: TabRegistration[] = [
    { id: 'track',       label: 'Track',       create: () => new TrackTab() },
    { id: 'outline',     label: 'Outline',     create: () => new OutlineTab() },
    { id: 'checkpoints', label: 'Layout', create: () => new CheckpointsTab() },
];

// Pure-TS editor shell. Owns:
//   - a tab bar pinned above the canvas (page-level navigation).
//   - a full-viewport canvas that fills the remaining height.
//   - five absolutely-positioned overlay slots on top of the canvas.
// Everything editor-specific lives in the mounted tab via the OverlaySlots.
export class TrackEditorView implements View {
    private root: HTMLElement | null = null;
    private canvasEl: HTMLCanvasElement | null = null;
    private canvasHostEl: HTMLDivElement | null = null;
    private overlays: OverlaySlots | null = null;
    private tabBarEl: HTMLDivElement | null = null;
    private tabButtons = new Map<TabId, HTMLButtonElement>();

    private activeTabId: TabId = TABS[0].id;
    private activeTab: EditorTab | null = null;

    private resizeObserver: ResizeObserver | null = null;

    // --- Shell-level render state (shared across tabs) ---
    // Camera. zoom is multiplied on top of the base-zoom-fit-to-viewport.
    // pan is in world pixels — camera focus = (-panX, -panY).
    private cameraZoom = 1;
    private cameraPanX = 0;
    private cameraPanY = 0;

    private background: BackgroundState | null = null;
    private backgroundImageEl: HTMLImageElement | null = null;
    private backgroundImageLoaded = false;

    private rafId: number | null = null;

    // --- Shell-owned overlay elements (survive tab switches) ---
    // Shell appends these to the OverlaySlots after each tab-clear so they
    // stay visible when the user switches tabs. Tab-owned elements are
    // appended on top via `tab.mount()`.
    private shellTopStripEl: HTMLDivElement | null = null;
    private shellRightInspectorEl: HTMLDivElement | null = null;
    private shellBottomRightEl: HTMLDivElement | null = null;
    private backgroundInspectorVisible = false;

    // --- Shared authoring state ---
    // Mutated in place by tabs via the EditorContext handed to them. Starts
    // empty (one blank layout); replaced wholesale by New/Open (file menu).
    private trackState: VectorTrackState = createTrackState();

    // New / Open / Save / Publish, top-right of the viewport. Lives outside
    // the overlay slots so tab switches never clear it.
    private fileMenu = new TrackFileMenu({
        getState: () => ({
            paths: this.trackState.paths,
            layouts: this.trackState.layouts,
            outline: this.trackState.outline ?? undefined,
            editorBackground: this.background ?? undefined,
        }),
        replace: data => this.replaceTrack(data),
    });

    // --- Grid state ---
    // gridSize stored in world pixels (single source of truth); gridUnit is
    // display formatting only. Default: 24 px = 1 m at 24 px/m.
    private gridSize = 24;
    private gridUnit: 'px' | 'cm' | 'm' = 'm';
    private snapEnabled = true;
    private showGrid = true;
    // When true (Shift held), snapPoint behaves as passthrough. Resets on
    // keyup; also cleared on blur so a window-leave while holding Shift
    // doesn't leave snap permanently off.
    private shiftBypassActive = false;
    private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
    private boundOnKeyUp: ((e: KeyboardEvent) => void) | null = null;
    private boundOnBlur: (() => void) | null = null;

    // --- Interaction state ---
    private isDraggingBackground = false;
    private dragStartClient = { x: 0, y: 0 };
    private dragStartBgOffset = { x: 0, y: 0 };

    private isPanning = false;
    private panStartClient = { x: 0, y: 0 };
    private panStartCamera = { x: 0, y: 0 };

    public mount(root: HTMLElement): void {
        this.root = root;
        this.buildDom();
        this.resizeCanvasToHost();
        this.attachCanvasInteractions();
        this.attachKeyListeners();
        this.switchTab(this.activeTabId);
        if (this.canvasHostEl) this.fileMenu.mount(this.canvasHostEl);
        this.startRenderLoop();
    }

    public unmount(): void {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.detachKeyListeners();
        this.fileMenu.unmount();
        this.activeTab?.unmount();
        this.activeTab = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.root?.replaceChildren();
        this.root = null;
        this.canvasEl = null;
        this.canvasHostEl = null;
        this.overlays = null;
        this.tabBarEl = null;
        this.tabButtons.clear();
        this.shellTopStripEl = null;
        this.shellRightInspectorEl = null;
        this.shellBottomRightEl = null;
        this.backgroundImageEl = null;
        this.backgroundImageLoaded = false;
        this.background = null;
    }

    // --- DOM ---

    private buildDom(): void {
        if (!this.root) return;

        const container = document.createElement('div');
        Object.assign(container.style, {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100vh',
            backgroundColor: '#1a1a1a',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            overflow: 'hidden',
        });

        container.appendChild(this.buildTabBar());
        container.appendChild(this.buildCanvasHost());

        this.root.appendChild(container);
    }

    private buildTabBar(): HTMLDivElement {
        const bar = document.createElement('div');
        this.tabBarEl = bar;
        Object.assign(bar.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 12px',
            backgroundColor: '#2a2a2a',
            borderBottom: '1px solid #444',
            flexShrink: '0',
        });

        for (const tab of TABS) {
            const btn = document.createElement('button');
            btn.textContent = tab.label;
            Object.assign(btn.style, {
                padding: '6px 14px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontFamily: 'inherit',
            });
            btn.addEventListener('click', () => this.switchTab(tab.id));
            this.tabButtons.set(tab.id, btn);
            bar.appendChild(btn);
        }

        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        bar.appendChild(spacer);

        const back = document.createElement('button');
        back.textContent = 'Back to Menu';
        Object.assign(back.style, {
            padding: '6px 14px',
            backgroundColor: '#4a4a4a',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: 'inherit',
        });
        back.addEventListener('click', () => { window.location.href = '/'; });
        bar.appendChild(back);

        return bar;
    }

    private buildCanvasHost(): HTMLDivElement {
        const host = document.createElement('div');
        this.canvasHostEl = host;
        Object.assign(host.style, {
            position: 'relative',
            flex: '1',
            overflow: 'hidden',
        });

        const canvas = document.createElement('canvas');
        this.canvasEl = canvas;
        Object.assign(canvas.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            display: 'block',
            backgroundColor: '#0f0f0f',
            cursor: 'grab',
        });
        host.appendChild(canvas);

        this.overlays = this.buildOverlaySlots(host);

        // Keep the canvas's pixel size matched to its CSS size as the host
        // resizes (window resize, DevTools toggle, etc.).
        this.resizeObserver = new ResizeObserver(() => this.resizeCanvasToHost());
        this.resizeObserver.observe(host);

        return host;
    }

    private buildOverlaySlots(host: HTMLElement): OverlaySlots {
        const mk = (styles: Partial<CSSStyleDeclaration>) => {
            const el = document.createElement('div');
            Object.assign(el.style, {
                position: 'absolute',
                display: 'flex',
                gap: '6px',
                padding: '10px',
                pointerEvents: 'none', // children opt in with pointer-events: auto
                boxSizing: 'border-box',
                ...styles,
            });
            host.appendChild(el);
            return el;
        };

        return {
            topStrip:        mk({ top: '0', left: '0', right: '0', justifyContent: 'flex-start', alignItems: 'flex-start' }),
            leftTools:       mk({ left: '0', top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' }),
            rightInspector:  mk({ right: '0', top: '50%', transform: 'translateY(-50%)', flexDirection: 'column', alignItems: 'flex-end' }),
            bottomRight:     mk({ bottom: '0', right: '0', justifyContent: 'flex-end', alignItems: 'flex-end' }),
            bottomLeft:      mk({ bottom: '0', left: '0', justifyContent: 'flex-start', alignItems: 'flex-end' }),
        };
    }

    private resizeCanvasToHost(): void {
        if (!this.canvasEl || !this.canvasHostEl) return;
        const rect = this.canvasHostEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (this.canvasEl.width !== w) this.canvasEl.width = w;
        if (this.canvasEl.height !== h) this.canvasEl.height = h;
    }

    // --- Tab switching ---

    private switchTab(id: TabId): void {
        const registration = TABS.find(t => t.id === id);
        if (!registration || !this.canvasEl || !this.overlays) return;

        this.activeTab?.unmount();

        this.clearOverlays();
        // Set the new tab BEFORE rendering shell overlays: some of them
        // (the Background button/panel) depend on which tab is active.
        this.activeTabId = id;
        // Shell-owned elements get re-appended first so they always sit
        // underneath whatever the active tab adds (per-slot stacking).
        this.renderShellOverlays();

        this.activeTab = registration.create();
        this.activeTab.mount(this.canvasEl, this.overlays, this.buildContext());
        this.updateTabButtonStyles();
    }

    private buildContext(): EditorContext {
        return {
            trackState: this.trackState,
            snapPoint: (x, y) => this.snapPoint(x, y),
            isSnapActive: () => this.snapEnabled && !this.shiftBypassActive,
            worldFromClient: (clientX, clientY) => this.worldFromClient(clientX, clientY),
        };
    }

    public worldFromClient(clientX: number, clientY: number): { x: number; y: number } {
        if (!this.canvasEl) return { x: 0, y: 0 };
        const rect = this.canvasEl.getBoundingClientRect();
        const cssW = rect.width;
        const cssH = rect.height;
        const z = (cssW / BASE_ZOOM_WORLD_WIDTH) * this.cameraZoom;
        const cursorX = clientX - rect.left;
        const cursorY = clientY - rect.top;
        return {
            x: (cursorX - cssW / 2) / z - this.cameraPanX,
            y: (cursorY - cssH / 2) / z - this.cameraPanY,
        };
    }

    private clearOverlays(): void {
        if (!this.overlays) return;
        for (const slot of Object.values(this.overlays)) slot.replaceChildren();
    }

    private updateTabButtonStyles(): void {
        for (const [id, btn] of this.tabButtons) {
            const active = id === this.activeTabId;
            btn.style.backgroundColor = active ? '#4a7aaa' : '#3a3a3a';
            btn.style.color = active ? '#fff' : '#ddd';
            btn.style.fontWeight = active ? 'bold' : 'normal';
        }
    }

    // Public accessor so Phase E (grid) can wire shell-level state later.
    public getBaseZoomWorldWidth(): number {
        return BASE_ZOOM_WORLD_WIDTH;
    }

    // --- Render loop ---

    private startRenderLoop(): void {
        const loop = () => {
            this.renderCanvas();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    private renderCanvas(): void {
        if (!this.canvasEl) return;
        const ctx = this.canvasEl.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const cssW = this.canvasEl.width / dpr;
        const cssH = this.canvasEl.height / dpr;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

        // World → canvas transform. Default fit: BASE_ZOOM_WORLD_WIDTH of
        // world width visible across the viewport. User zoom multiplies.
        // Pan shifts the camera focus. World origin starts at viewport
        // center; pan moves what's visible.
        const baseZoom = cssW / BASE_ZOOM_WORLD_WIDTH;
        const z = baseZoom * this.cameraZoom;
        ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cssW / 2 + this.cameraPanX * z), dpr * (cssH / 2 + this.cameraPanY * z));

        // Z-order: background (lowest) → grid → tab content (on top).
        this.drawBackground(ctx);
        this.drawGrid(ctx, cssW, cssH, z);
        this.activeTab?.render?.(ctx, z);
    }

    private drawGrid(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, z: number): void {
        if (!this.showGrid) return;
        const g = this.gridSize;
        if (g <= 0) return;

        // Fade when grid density becomes visually noisy. screenGridPx is how
        // many CSS px separate adjacent minor lines; below ~2 px it's noise.
        const screenGridPx = g * z;
        if (screenGridPx < 2) return;
        const fadeMul = Math.max(0, Math.min(1, (screenGridPx - 2) / 8));
        const minorAlpha = 0.15 * fadeMul;
        const majorAlpha = 0.35 * fadeMul;

        // Visible world rect (inverse of the current ctx transform).
        const halfVisW = cssW / (2 * z);
        const halfVisH = cssH / (2 * z);
        const minX = -halfVisW - this.cameraPanX;
        const maxX = +halfVisW - this.cameraPanX;
        const minY = -halfVisH - this.cameraPanY;
        const maxY = +halfVisH - this.cameraPanY;

        const iStart = Math.floor(minX / g);
        const iEnd   = Math.ceil(maxX / g);
        const jStart = Math.floor(minY / g);
        const jEnd   = Math.ceil(maxY / g);

        ctx.save();
        ctx.lineWidth = 1 / z;  // keep lines ~1 CSS px thick

        // Two passes — minor then major — so we only set strokeStyle twice.
        for (const pass of ['minor', 'major'] as const) {
            ctx.strokeStyle = pass === 'major'
                ? `rgba(255, 255, 255, ${majorAlpha})`
                : `rgba(255, 255, 255, ${minorAlpha})`;
            ctx.beginPath();
            for (let i = iStart; i <= iEnd; i++) {
                const isMajor = i % 10 === 0;
                if ((pass === 'major') !== isMajor) continue;
                const x = i * g;
                ctx.moveTo(x, minY);
                ctx.lineTo(x, maxY);
            }
            for (let j = jStart; j <= jEnd; j++) {
                const isMajor = j % 10 === 0;
                if ((pass === 'major') !== isMajor) continue;
                const y = j * g;
                ctx.moveTo(minX, y);
                ctx.lineTo(maxX, y);
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    private drawBackground(ctx: CanvasRenderingContext2D): void {
        if (!this.background || !this.backgroundImageEl || !this.backgroundImageLoaded) return;
        // Background is a Track-tab authoring aid; irrelevant on the
        // Checkpoints tab. State is preserved so switching back restores it.
        if (this.activeTabId !== 'track') return;
        const b = this.background;
        ctx.save();
        ctx.globalAlpha = b.opacity;
        ctx.translate(b.offsetX, b.offsetY);
        ctx.rotate((b.rotation * Math.PI) / 180);
        ctx.scale(b.scale, b.scale);
        ctx.drawImage(this.backgroundImageEl, 0, 0);
        ctx.restore();
    }

    // --- Background state management ---

    private loadBackgroundImage(src: string): void {
        this.backgroundImageLoaded = false;
        this.backgroundImageEl = new Image();
        this.backgroundImageEl.onload = () => { this.backgroundImageLoaded = true; };
        this.backgroundImageEl.onerror = () => { this.backgroundImageLoaded = false; };
        this.backgroundImageEl.src = src;
    }

    private setBackgroundFromTraceMap(src: string): void {
        this.background = {
            src,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            opacity: 0.5,
            locked: false,
        };
        this.loadBackgroundImage(src);
        this.renderBackgroundInspector();
    }

    private updateBackground(patch: Partial<BackgroundState>): void {
        if (!this.background) return;
        this.background = { ...this.background, ...patch };
        if (patch.src && patch.src !== this.backgroundImageEl?.src) {
            this.loadBackgroundImage(patch.src);
        }
    }

    private removeBackground(): void {
        this.background = null;
        this.backgroundImageEl = null;
        this.backgroundImageLoaded = false;
        this.renderBackgroundInspector();
    }

    // --- Track replace (file menu New / Open) ---

    // Swap the whole authoring state. null = blank track. The active tab is
    // remounted so it drops selections and picks up the new state object.
    private replaceTrack(data: TrackData | null): void {
        // An opened outline is assumed to match the opened paths.
        this.trackState = data
            ? {
                paths: data.paths,
                activePathId: data.paths[0].id,
                layouts: data.layouts,
                activeLayoutId: data.layouts[0].id,
                outline: data.outline ?? null,
                outlinePathsKey: data.outline ? pathsKey(data.paths) : null,
            }
            : createTrackState();

        if (data?.editorBackground) {
            this.background = { ...data.editorBackground };
            this.loadBackgroundImage(this.background.src);
        } else {
            this.background = null;
            this.backgroundImageEl = null;
            this.backgroundImageLoaded = false;
        }

        this.fitCameraToTrack();
        this.switchTab(this.activeTabId);
    }

    // Fit all paths' anchors (incl. track width) into the viewport with a
    // margin. No anchors → default camera.
    private fitCameraToTrack(): void {
        this.cameraZoom = 1;
        this.cameraPanX = 0;
        this.cameraPanY = 0;
        const anchors = this.trackState.paths.flatMap(p => p.anchors);
        if (anchors.length === 0 || !this.canvasHostEl) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const a of anchors) {
            minX = Math.min(minX, a.pos.x - a.halfWidth);
            minY = Math.min(minY, a.pos.y - a.halfWidth);
            maxX = Math.max(maxX, a.pos.x + a.halfWidth);
            maxY = Math.max(maxY, a.pos.y + a.halfWidth);
        }
        const rect = this.canvasHostEl.getBoundingClientRect();
        const margin = 1.15;
        const baseZoom = rect.width / BASE_ZOOM_WORLD_WIDTH;
        const fit = Math.min(rect.width / ((maxX - minX) * margin), rect.height / ((maxY - minY) * margin));
        this.cameraZoom = Math.max(0.1, Math.min(10, fit / baseZoom));
        this.cameraPanX = -(minX + maxX) / 2;
        this.cameraPanY = -(minY + maxY) / 2;
    }

    // --- Shell-owned overlay elements (survive tab switches) ---

    private renderShellOverlays(): void {
        if (!this.overlays) return;

        // Grid controls appear on BOTH tabs — snapping is useful anywhere
        // you're placing points (anchors or checkpoints).
        this.renderGridControls();

        // Background controls are only shown on the Track tab — the trace
        // image is an authoring aid for laying out the path. Checkpoints
        // tab stays clean.
        if (this.activeTabId !== 'track') return;

        // Top strip: "Background" toggle button.
        if (!this.shellTopStripEl) {
            this.shellTopStripEl = document.createElement('div');
            Object.assign(this.shellTopStripEl.style, {
                display: 'flex',
                gap: '6px',
                pointerEvents: 'auto',
            });
            const bgBtn = this.makeOverlayButton(
                TRACE_MAPS.length === 0 ? 'Background (empty)' : 'Background',
                () => {
                    this.backgroundInspectorVisible = !this.backgroundInspectorVisible;
                    this.renderBackgroundInspector();
                },
            );
            this.shellTopStripEl.appendChild(bgBtn);
        }
        this.overlays.topStrip.appendChild(this.shellTopStripEl);

        // Right inspector: background panel (hidden until toggled on).
        if (!this.shellRightInspectorEl) {
            this.shellRightInspectorEl = document.createElement('div');
            Object.assign(this.shellRightInspectorEl.style, {
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
        }
        this.overlays.rightInspector.appendChild(this.shellRightInspectorEl);
        this.renderBackgroundInspector();
    }

    private renderBackgroundInspector(): void {
        const el = this.shellRightInspectorEl;
        if (!el) return;

        if (!this.backgroundInspectorVisible) {
            el.style.display = 'none';
            el.replaceChildren();
            return;
        }

        el.style.display = 'flex';
        el.replaceChildren();

        const title = document.createElement('div');
        title.textContent = 'Trace background';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' });
        el.appendChild(title);

        if (TRACE_MAPS.length === 0) {
            const hint = document.createElement('div');
            hint.textContent = 'No trace maps found. Drop images into app/assets/trace-maps/ and reload.';
            Object.assign(hint.style, { opacity: '0.7' });
            el.appendChild(hint);
            return;
        }

        // Image picker.
        const pickerLabel = this.makeInspectorLabel('Image');
        el.appendChild(pickerLabel);
        const picker = document.createElement('select');
        Object.assign(picker.style, this.inputStyle());
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '— none —';
        picker.appendChild(noneOpt);
        for (const map of TRACE_MAPS) {
            const opt = document.createElement('option');
            opt.value = map.src;
            opt.textContent = map.label;
            picker.appendChild(opt);
        }
        picker.value = this.background?.src ?? '';
        picker.addEventListener('change', () => {
            if (picker.value === '') this.removeBackground();
            else if (!this.background) this.setBackgroundFromTraceMap(picker.value);
            else this.updateBackground({ src: picker.value });
        });
        el.appendChild(picker);

        if (!this.background) return;

        // Numeric field helper (also handles sliders).
        const b = this.background;
        const addNumber = (label: string, value: number, min: number, max: number, step: number,
                           onChange: (v: number) => void) => {
            el.appendChild(this.makeInspectorLabel(label));
            const wrap = document.createElement('div');
            Object.assign(wrap.style, { display: 'flex', gap: '6px', alignItems: 'center' });
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = String(min);
            slider.max = String(max);
            slider.step = String(step);
            slider.value = String(value);
            slider.style.flex = '1';
            const number = document.createElement('input');
            number.type = 'number';
            number.step = String(step);
            number.value = String(value);
            Object.assign(number.style, this.inputStyle(), { width: '70px' });
            slider.addEventListener('input', () => {
                number.value = slider.value;
                onChange(Number(slider.value));
            });
            number.addEventListener('change', () => {
                slider.value = number.value;
                onChange(Number(number.value));
            });
            wrap.append(slider, number);
            el.appendChild(wrap);
        };

        addNumber('Scale', b.scale, 0.05, 10, 0.01, v => this.updateBackground({ scale: v }));
        addNumber('Offset X', b.offsetX, -5000, 5000, 1, v => this.updateBackground({ offsetX: v }));
        addNumber('Offset Y', b.offsetY, -5000, 5000, 1, v => this.updateBackground({ offsetY: v }));
        addNumber('Rotation (°)', b.rotation, -180, 180, 0.5, v => this.updateBackground({ rotation: v }));
        addNumber('Opacity', b.opacity, 0, 1, 0.01, v => this.updateBackground({ opacity: v }));

        // Lock toggle + remove.
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '6px', marginTop: '6px' });
        const lockBtn = this.makeOverlayButton(b.locked ? 'Unlock' : 'Lock', () => {
            this.updateBackground({ locked: !b.locked });
            this.renderBackgroundInspector();
        });
        lockBtn.style.flex = '1';
        const removeBtn = this.makeOverlayButton('Remove', () => this.removeBackground());
        removeBtn.style.flex = '1';
        removeBtn.style.backgroundColor = '#8a2a2a';
        row.append(lockBtn, removeBtn);
        el.appendChild(row);
    }

    private makeInspectorLabel(text: string): HTMLDivElement {
        const label = document.createElement('div');
        label.textContent = text;
        Object.assign(label.style, { opacity: '0.7', marginTop: '4px' });
        return label;
    }

    private inputStyle(): Partial<CSSStyleDeclaration> {
        return {
            padding: '4px 6px',
            backgroundColor: '#1e1e1e',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '3px',
            fontFamily: 'inherit',
            fontSize: '12px',
        };
    }

    private makeOverlayButton(label: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            padding: '6px 12px',
            backgroundColor: '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'inherit',
            pointerEvents: 'auto',
        });
        btn.addEventListener('click', onClick);
        return btn;
    }

    // --- Canvas drag interactions (background-move when unlocked) ---

    private attachCanvasInteractions(): void {
        if (!this.canvasEl) return;
        this.canvasEl.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.canvasEl.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.canvasEl.addEventListener('mouseup',   (e) => this.onCanvasMouseUp(e));
        this.canvasEl.addEventListener('mouseleave',() => this.onCanvasMouseUp());
        this.canvasEl.addEventListener('wheel',     (e) => this.onCanvasWheel(e), { passive: false });
        // Suppress the browser's middle-click autoscroll affordance.
        this.canvasEl.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    }

    private onCanvasMouseDown(e: MouseEvent): void {
        // Middle-click = pan. Always wins over tab handlers so navigation
        // works even if a tab wants to consume left-clicks.
        if (e.button === 1) {
            e.preventDefault();
            this.isPanning = true;
            this.panStartClient = { x: e.clientX, y: e.clientY };
            this.panStartCamera = { x: this.cameraPanX, y: this.cameraPanY };
            if (this.canvasEl) this.canvasEl.style.cursor = 'grabbing';
            return;
        }

        // Give the active tab first crack at the event.
        if (this.activeTab?.onMouseDown?.(e)) return;

        if (e.button !== 0) return;
        // Background drag only applies on the Track tab (where it's visible).
        if (this.activeTabId !== 'track') return;
        if (this.background && !this.background.locked) {
            this.isDraggingBackground = true;
            this.dragStartClient = { x: e.clientX, y: e.clientY };
            this.dragStartBgOffset = { x: this.background.offsetX, y: this.background.offsetY };
            if (this.canvasEl) this.canvasEl.style.cursor = 'grabbing';
        }
    }

    private onCanvasMouseMove(e: MouseEvent): void {
        if (this.activeTab?.onMouseMove?.(e)) return;

        if (this.isPanning && this.canvasEl) {
            const z = this.effectiveZoom();
            const dx = (e.clientX - this.panStartClient.x) / z;
            const dy = (e.clientY - this.panStartClient.y) / z;
            this.cameraPanX = this.panStartCamera.x + dx;
            this.cameraPanY = this.panStartCamera.y + dy;
            return;
        }

        if (!this.isDraggingBackground || !this.background || !this.canvasEl) return;
        const z = this.effectiveZoom();
        const dx = (e.clientX - this.dragStartClient.x) / z;
        const dy = (e.clientY - this.dragStartClient.y) / z;
        this.background.offsetX = this.dragStartBgOffset.x + dx;
        this.background.offsetY = this.dragStartBgOffset.y + dy;
        // Live-update the inspector's number inputs via a re-render.
        this.renderBackgroundInspector();
    }

    private onCanvasMouseUp(e?: MouseEvent): void {
        if (e && this.activeTab?.onMouseUp?.(e)) {
            // Tab consumed; still make sure any shell-level drag states
            // we started earlier are cleared on mouseup.
        }
        if (this.isPanning) {
            this.isPanning = false;
            if (this.canvasEl) this.canvasEl.style.cursor = 'grab';
        }
        if (this.isDraggingBackground) {
            this.isDraggingBackground = false;
            if (this.canvasEl) this.canvasEl.style.cursor = 'grab';
        }
    }

    // Mouse-wheel zoom with cursor-anchored pivot: the world point under the
    // cursor stays at the same screen position before and after the zoom.
    private onCanvasWheel(e: WheelEvent): void {
        if (!this.canvasEl) return;
        e.preventDefault();

        const rect = this.canvasEl.getBoundingClientRect();
        const cssW = rect.width;
        const cssH = rect.height;
        // Cursor position in CSS space relative to the canvas.
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const baseZoom = cssW / BASE_ZOOM_WORLD_WIDTH;
        const prevEff = baseZoom * this.cameraZoom;

        // Inverse of the current world→screen transform: find the world point
        // under the cursor.
        const worldX = (cursorX - cssW / 2) / prevEff - this.cameraPanX;
        const worldY = (cursorY - cssH / 2) / prevEff - this.cameraPanY;

        // Zoom step: 1.1 per 100 deltaY (ratchet feel). Clamped to [0.1, 10].
        const zoomFactor = Math.pow(1.1, -e.deltaY / 100);
        const nextCameraZoom = Math.max(0.1, Math.min(10, this.cameraZoom * zoomFactor));
        if (nextCameraZoom === this.cameraZoom) return;
        this.cameraZoom = nextCameraZoom;

        // Solve for the new pan so (worldX, worldY) still projects to (cursorX, cursorY).
        const nextEff = baseZoom * this.cameraZoom;
        this.cameraPanX = (cursorX - cssW / 2) / nextEff - worldX;
        this.cameraPanY = (cursorY - cssH / 2) / nextEff - worldY;
    }

    private effectiveZoom(): number {
        if (!this.canvasEl) return 1;
        const dpr = window.devicePixelRatio || 1;
        const cssW = this.canvasEl.width / dpr;
        const baseZoom = cssW / BASE_ZOOM_WORLD_WIDTH;
        return baseZoom * this.cameraZoom;
    }

    // --- Grid controls (bottom-right overlay cluster) ---

    private renderGridControls(): void {
        if (!this.overlays) return;

        if (!this.shellBottomRightEl) {
            this.shellBottomRightEl = document.createElement('div');
            Object.assign(this.shellBottomRightEl.style, {
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                pointerEvents: 'auto',
            });
        }
        this.shellBottomRightEl.replaceChildren();

        const gridLabel = this.showGrid
            ? `Grid: ${this.formatGridSize()}`
            : 'Grid: off';
        const gridBtn = this.makeOverlayButton(gridLabel, () => {
            this.showGrid = !this.showGrid;
            this.renderGridControls();
        });
        this.shellBottomRightEl.appendChild(gridBtn);

        const dec = this.makeOverlayButton('−', () => this.stepGridSize(-1));
        const inc = this.makeOverlayButton('+', () => this.stepGridSize(+1));
        this.shellBottomRightEl.append(dec, inc);

        const unitSelect = document.createElement('select');
        Object.assign(unitSelect.style, this.inputStyle());
        for (const u of ['m', 'cm', 'px'] as const) {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            unitSelect.appendChild(opt);
        }
        unitSelect.value = this.gridUnit;
        unitSelect.addEventListener('change', () => {
            this.gridUnit = unitSelect.value as 'px' | 'cm' | 'm';
            this.renderGridControls();
        });
        this.shellBottomRightEl.appendChild(unitSelect);

        const snapBtn = this.makeOverlayButton(
            this.snapEnabled ? 'Snap: on' : 'Snap: off',
            () => {
                this.snapEnabled = !this.snapEnabled;
                this.renderGridControls();
            },
        );
        if (this.snapEnabled) snapBtn.style.backgroundColor = '#2a5a8a';
        this.shellBottomRightEl.appendChild(snapBtn);

        this.overlays.bottomRight.appendChild(this.shellBottomRightEl);
    }

    private formatGridSize(): string {
        switch (this.gridUnit) {
            case 'm':  return `${this.formatNumber(fromPixelsToMeters(this.gridSize))} m`;
            case 'cm': return `${this.formatNumber(fromPixelsToCm(this.gridSize))} cm`;
            case 'px': return `${this.formatNumber(this.gridSize)} px`;
        }
    }

    private formatNumber(n: number): string {
        if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
        return n.toFixed(2).replace(/\.?0+$/, '');
    }

    private stepGridSize(dir: 1 | -1): void {
        // Natural step per unit. In m-mode step by 1 m; cm-mode by 10 cm;
        // px-mode by 2 px (fine).
        const stepPx = this.gridUnit === 'm' ? 24
                      : this.gridUnit === 'cm' ? 2.4
                      : 2;
        // Snap the current value to the current unit's grid before stepping.
        // Prevents drift when the previous value was clamped or came from a
        // different unit's step (e.g. go below 0 in m-mode → min clamp → +1
        // used to land on 25 px = 1.04 m instead of 24 px = 1 m).
        const snapped = Math.round(this.gridSize / stepPx) * stepPx;
        const next = snapped + dir * stepPx;
        // Floor is one step (= 1 m / 10 cm / 2 px) so values stay on-grid.
        this.gridSize = Math.max(stepPx, Math.min(960, next));
        this.renderGridControls();
    }

    // --- Snap helper (consumed by tabs in later phases) ---

    public snapPoint(x: number, y: number): { x: number; y: number } {
        if (!this.snapEnabled || this.shiftBypassActive || this.gridSize <= 0) {
            return { x, y };
        }
        return {
            x: Math.round(x / this.gridSize) * this.gridSize,
            y: Math.round(y / this.gridSize) * this.gridSize,
        };
    }

    // --- Key listeners (Shift bypass for snap) ---

    private attachKeyListeners(): void {
        this.boundOnKeyDown = (e: KeyboardEvent) => {
            if (this.activeTab?.onKeyDown?.(e)) return;
            if (e.key === 'Shift') this.shiftBypassActive = true;
        };
        this.boundOnKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift') this.shiftBypassActive = false;
        };
        this.boundOnBlur = () => {
            this.shiftBypassActive = false;
        };
        window.addEventListener('keydown', this.boundOnKeyDown);
        window.addEventListener('keyup', this.boundOnKeyUp);
        window.addEventListener('blur', this.boundOnBlur);
    }

    private detachKeyListeners(): void {
        if (this.boundOnKeyDown) window.removeEventListener('keydown', this.boundOnKeyDown);
        if (this.boundOnKeyUp)   window.removeEventListener('keyup', this.boundOnKeyUp);
        if (this.boundOnBlur)    window.removeEventListener('blur', this.boundOnBlur);
        this.boundOnKeyDown = null;
        this.boundOnKeyUp = null;
        this.boundOnBlur = null;
    }
}
