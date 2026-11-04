import type { View } from './View';
import { Renderer } from '~/engine/Renderer';
import type { RenderSnapshot } from '~/engine/RenderSnapshot';
import { CAMERA_MODES, daylight, type CameraMode } from '~/engine/Scene3D';

export type HudSlot =
    | 'topLeft'
    | 'topCenter'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomCenter'
    | 'bottomRight'
    | 'center';

// A HUD widget owns its own DOM inside a slot. Update wiring (where its
// data comes from) is done by the RacingView subclass so each HUD only knows
// how to paint itself.
export interface Hud {
    mount(parent: HTMLElement): void;
    destroy(): void;
}

// What the control panel shows as pressed.
export type PressedControls = { forward: boolean; backward: boolean; brake: boolean; restart: boolean };

// Shared shell for every racing view — knows nothing about where the race
// runs (a local engine: LocalRacingView; the server: SinglePlayerView).
// Owns:
//   - Error screen if the game fails to start
//   - Two canvas layers (main, fps) + the Renderer
//   - HUD slot management + lifecycle bookkeeping
//   - Default UI: control button panel, back-to-menu, bbox toggle,
//     zoom +/-, weather / time of day / camera mode, session-completion overlay
//   - mount/unmount cleanup
//
// Concrete subclasses fill in:
//   - prepare()  — set up where frames come from (before the HUDs)
//   - wireHud()  — which HUDs to mount + how to feed them
//   - start() / stop() — start / stop producing frames (they call present())
//   - onReset(), onZoom() — the Reset button and zoom changes
// and may override any of the build* methods to customize default UI.
export abstract class RacingView implements View {
    protected root: HTMLElement | null = null;
    protected gameEl: HTMLElement | null = null;

    protected mainCanvas: HTMLCanvasElement | null = null;
    // Canvas pixels per CSS px (devicePixelRatio at mount).
    private pixelRatio = 1;
    protected fpsCanvas: HTMLCanvasElement | null = null;

    protected renderer: Renderer | null = null;

    // Viewers can't restart cars that aren't theirs: they hide Reset.
    protected showResetButton = true;

    protected huds: Hud[] = [];
    private slots: Partial<Record<HudSlot, HTMLElement>> = {};
    protected unsubs: Array<() => void> = [];

    // Default-UI state
    private boundingBoxOn = false;
    // Starting camera zoom (screen px per world px). 0.6 ≈ 70 m across the
    // 1000 px view. The −/+ buttons step it within [0.5, 2].
    protected zoom = 0.6;
    // Sun position in hours; survives stage restarts.
    private timeOfDay = 15;
    // Weather sliders, 0–1. Fog 0.4 ≈ the old fixed haze.
    private fog = 0.4;
    private rain = 0;
    private reflections = 0;
    // Cycled with the C key.
    private cameraMode: CameraMode = 'isometric';
    // Toggled with the X key: cars visible through props.
    private seeThrough = false;
    // Toggled with the L key; switches on / off by itself as night falls / ends.
    private headlightsOn = false;
    private isNight = false;
    private pressedBtns: Record<string, HTMLButtonElement> = {};
    // Control panel pedal bars (the fill of each) + gear letter.
    private gasFill: HTMLDivElement | null = null;
    private brakeFill: HTMLDivElement | null = null;
    private gearEl: HTMLDivElement | null = null;
    // Control panel steering wheel (display only) + its angle label.
    private steeringWheel: SVGSVGElement | null = null;
    private steeringLabel: HTMLDivElement | null = null;
    private topRightWrapper: HTMLElement | null = null;
    private bboxButton: HTMLButtonElement | null = null;
    private completionOverlay: HTMLDivElement | null = null;

    // Build the game straight away (errors show the error screen).
    public mount(root: HTMLElement): void {
        this.root = root;
        try {
            this.buildGame();
        } catch (err) {
            console.error('Failed to start the game:', err);
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }

    public unmount(): void {
        this.stop();
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        for (const hud of this.huds) hud.destroy();
        this.huds = [];
        this.slots = {};
        this.completionOverlay?.remove();
        this.completionOverlay = null;
        this.pressedBtns = {};
        this.gasFill = null;
        this.brakeFill = null;
        this.gearEl = null;
        this.steeringWheel = null;
        this.steeringLabel = null;
        this.bboxButton = null;
        this.topRightWrapper = null;
        this.root?.replaceChildren();
        this.root = null;
        this.gameEl = null;
        this.renderer?.dispose();
        this.renderer = null;
    }

    // --- Abstract hooks ---

    protected abstract prepare(): void;
    protected abstract wireHud(): void;
    protected abstract start(): void;
    protected abstract stop(): void;
    protected abstract onReset(): void;
    // The zoom changed (−/+); the frames presented use the new zoom.
    protected onZoom(_zoom: number): void {}

    // Draw one frame (the bounding-box toggle is added here).
    protected present(frame: Omit<RenderSnapshot, 'showBoundingBox'>): void {
        this.renderer?.draw({ ...frame, showBoundingBox: this.boundingBoxOn });
    }

    // Show the controls, the gear and the steering wheel angle of the car the
    // view follows (null = unknown). The pedals show what the car does, as
    // Car.applyControls picks: forward, else backward (gas in R), else brake.
    // Gear from the speed: R below 0, N at 0, D above (null → "–").
    protected setIndicators(pressed: PressedControls | null, steeringAngle: number | null, speed: number | null): void {
        if (pressed) {
            const gas = pressed.forward || pressed.backward;
            const brake = !gas && pressed.brake;
            if (this.gasFill) this.gasFill.style.height = gas ? '100%' : '0%';
            if (this.brakeFill) this.brakeFill.style.height = brake ? '100%' : '0%';
            const reset = this.pressedBtns.reset;
            if (reset) {
                reset.style.backgroundColor = pressed.restart ? '#4a4a4a' : '#5a5a5a';
                reset.style.transform = pressed.restart ? 'scale(0.95)' : 'scale(1)';
            }
        }
        if (this.gearEl) this.gearEl.textContent = speed === null ? '–' : speed < 0 ? 'R' : speed > 0 ? 'D' : 'N';
        // Steering wheel: the car's real steering-wheel angle (+ = right = clockwise).
        if (steeringAngle !== null && this.steeringWheel && this.steeringLabel) {
            this.steeringWheel.style.transform = `rotate(${steeringAngle}deg)`;
            this.steeringLabel.textContent = `${Math.round(steeringAngle)}°`;
        }
    }

    // --- Helpers for subclasses ---

    protected mountHud(hud: Hud, slot: HudSlot): void {
        const slotEl = this.getOrCreateSlot(slot);
        hud.mount(slotEl);
        this.huds.push(hud);
    }

    // Subclasses use this to append view-specific UI alongside HUDs in a slot.
    protected getSlot(slot: HudSlot): HTMLElement {
        return this.getOrCreateSlot(slot);
    }

    // Subclasses call this to add elements to the top-right button row
    // (which by default holds Back-to-Menu + Bounding-Box toggle).
    protected getTopRightWrapper(): HTMLElement {
        if (!this.topRightWrapper) this.buildTopRightWrapper();
        return this.topRightWrapper!;
    }

    // --- Default UI (each is protected so subclasses can override) ---

    // Called by buildGame() after wireHud(). Override to skip / replace entirely.
    protected wireDefaults(): void {
        this.buildTopRightWrapper();
        this.buildBackToMenuButton();
        this.buildBoundingBoxToggle();
        this.buildZoomButtons();
        this.buildWeatherSliders();
        this.buildTimeOfDaySlider();
        this.buildControlPanel();
    }

    // Override to change navigation behavior.
    protected onBackToMenu(): void {
        window.location.href = '/';
    }

    // Override to skip / relocate.
    protected buildBackToMenuButton(): void {
        const back = document.createElement('button');
        back.textContent = 'Back to Menu';
        Object.assign(back.style, {
            padding: '8px 16px', backgroundColor: '#666', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '14px', whiteSpace: 'nowrap',
        });
        back.addEventListener('click', () => this.onBackToMenu());
        this.getTopRightWrapper().appendChild(back);
    }

    protected buildBoundingBoxToggle(): void {
        this.bboxButton = document.createElement('button');
        Object.assign(this.bboxButton.style, {
            padding: '8px 16px', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '14px', whiteSpace: 'nowrap',
        });
        this.updateBboxButton();
        this.bboxButton.addEventListener('click', () => {
            this.boundingBoxOn = !this.boundingBoxOn;
            this.updateBboxButton();
        });
        this.getTopRightWrapper().appendChild(this.bboxButton);
    }

    protected buildZoomButtons(): void {
        // Original code used malformed CSS (`calc(wh - 700px / 2)`) with only
        // the transform actually applying. We match the effective visual
        // position that produced: centered on the viewport, offset by (+444, +320).
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            position: 'absolute',
            top: 'calc(50% + 320px)',
            left: 'calc(50% + 444px)',
            display: 'flex', flexDirection: 'row', gap: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '10px', borderRadius: '5px',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
        });

        const plus = this.makeZoomButton('+');
        plus.addEventListener('click', () => {
            this.zoom = Math.min(this.zoom + 0.1, 2);
            this.onZoom(this.zoom);
        });
        const minus = this.makeZoomButton('-');
        minus.addEventListener('click', () => {
            this.zoom = Math.max(this.zoom - 0.1, 0.5);
            this.onZoom(this.zoom);
        });
        wrapper.appendChild(plus);
        wrapper.appendChild(minus);

        this.gameEl!.appendChild(wrapper);
    }

    // Sun position (time of day) for the 3D lighting and shadows, plus the
    // current camera view (C cycles isometric → chase → cockpit). Sits in the
    // window's bottom-left corner, below the weather sliders.
    private buildTimeOfDaySlider(): void {
        const wrapper = document.createElement('label');
        Object.assign(wrapper.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '10px 14px', borderRadius: '5px',
            color: 'white', fontFamily: 'monospace', fontSize: '14px',
            pointerEvents: 'auto',
        });

        const time = document.createElement('span');
        const slider = document.createElement('input');
        Object.assign(slider, { type: 'range', min: '0', max: '24', step: '0.25', value: String(this.timeOfDay) });
        slider.setAttribute('aria-label', 'Time of day');
        const update = () => {
            this.timeOfDay = Number(slider.value);
            const hours = Math.floor(this.timeOfDay);
            const minutes = Math.round((this.timeOfDay - hours) * 60);
            const night = daylight(this.timeOfDay) < 0.5;
            time.textContent = `${night ? '🌙' : '☀'} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            this.renderer?.setTimeOfDay(this.timeOfDay);
            if (night !== this.isNight) {
                this.isNight = night;
                this.headlightsOn = night;
                showHeadlights();
            }
        };
        const headlights = document.createElement('span');
        const showHeadlights = () => {
            headlights.textContent = `💡 ${this.headlightsOn ? 'on' : 'off'} (L)`;
            this.renderer?.setHeadlights(this.headlightsOn);
        };
        const onHeadlightsKey = (e: KeyboardEvent) => {
            if (e.repeat || e.key.toLowerCase() !== 'l') return;
            this.headlightsOn = !this.headlightsOn;
            showHeadlights();
        };
        window.addEventListener('keydown', onHeadlightsKey);
        this.unsubs.push(() => window.removeEventListener('keydown', onHeadlightsKey));
        showHeadlights();

        slider.addEventListener('input', update);
        update();

        const camera = document.createElement('span');
        const showCamera = () => {
            const hint = { free: ' · drag, right-drag, wheel', orbit: ' · drag, wheel' }[this.cameraMode as string] ?? '';
            camera.textContent = `📷 ${this.cameraMode} (C)${hint}`;
            camera.title = 'Drag: rotate · right-drag: pan (free only) · wheel: zoom';
            this.renderer?.setCameraMode(this.cameraMode);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.repeat || e.key.toLowerCase() !== 'c') return;
            this.cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length];
            showCamera();
        };
        window.addEventListener('keydown', onKeyDown);
        this.unsubs.push(() => window.removeEventListener('keydown', onKeyDown));
        showCamera();

        const seeThrough = document.createElement('span');
        const showSeeThrough = () => {
            seeThrough.textContent = `👁 ${this.seeThrough ? 'on' : 'off'} (X)`;
            seeThrough.title = 'See-through: cars visible through scenery';
            this.renderer?.setSeeThrough(this.seeThrough);
        };
        const onSeeThroughKey = (e: KeyboardEvent) => {
            if (e.repeat || e.key.toLowerCase() !== 'x') return;
            this.seeThrough = !this.seeThrough;
            showSeeThrough();
        };
        window.addEventListener('keydown', onSeeThroughKey);
        this.unsubs.push(() => window.removeEventListener('keydown', onSeeThroughKey));
        showSeeThrough();

        wrapper.append(time, slider, headlights, camera, seeThrough);
        this.getSlot('bottomLeft').appendChild(wrapper);
    }

    // Distance fog (0 = none), rain (0 = dry … 1 = skyfall) and reflections on
    // the track surface (0 = none). Visual only.
    private buildWeatherSliders(): void {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '10px 14px', borderRadius: '5px',
            color: 'white', fontFamily: 'monospace', fontSize: '14px',
            pointerEvents: 'auto',
        });
        const addSlider = (label: string, value: number, onInput: (value: number) => void) => {
            const text = document.createElement('span');
            text.textContent = label;
            const slider = document.createElement('input');
            Object.assign(slider, { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
            slider.setAttribute('aria-label', label);
            slider.addEventListener('input', () => onInput(Number(slider.value)));
            wrapper.append(text, slider);
        };
        addSlider('🌫 fog', this.fog, value => {
            this.fog = value;
            this.renderer?.setFog(value);
        });
        addSlider('🌧 rain', this.rain, value => {
            this.rain = value;
            this.renderer?.setRain(value);
        });
        addSlider('✨ reflections', this.reflections, value => {
            this.reflections = value;
            this.renderer?.setReflections(value);
        });
        this.getSlot('bottomLeft').appendChild(wrapper);
    }

    protected buildControlPanel(): void {
        const topLeftEl = this.getOrCreateSlot('topLeft');

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '10px', backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '15px', borderRadius: '10px', pointerEvents: 'auto',
        });

        // Pedals (brake, gas) beside the steering wheel.
        const topRow = document.createElement('div');
        Object.assign(topRow.style, { display: 'flex', alignItems: 'center', gap: '15px' });
        const pedals = document.createElement('div');
        Object.assign(pedals.style, { display: 'flex', gap: '8px' });
        const brake = this.makePedalBar('BRK', '#e53935');
        const gas = this.makePedalBar('GAS', '#43a047');
        this.brakeFill = brake.fill;
        this.gasFill = gas.fill;
        pedals.append(brake.wrap, gas.wrap);
        topRow.append(pedals, this.makeSteeringWheel());
        panel.appendChild(topRow);

        // Gear letter + Reset.
        const buttonsRow = document.createElement('div');
        Object.assign(buttonsRow.style, { display: 'flex', alignItems: 'center', gap: '10px' });
        this.gearEl = document.createElement('div');
        this.gearEl.textContent = '–';
        Object.assign(this.gearEl.style, {
            width: '40px', height: '40px', lineHeight: '40px', textAlign: 'center',
            border: '2px solid #d8d8d8', borderRadius: '5px',
            color: 'white', fontSize: '24px', fontWeight: 'bold', fontFamily: 'monospace',
        });
        buttonsRow.appendChild(this.gearEl);
        if (this.showResetButton) {
            const resetBtn = this.makeWideButton('reset', 'Reset');
            resetBtn.addEventListener('click', () => this.onReset());
            buttonsRow.appendChild(resetBtn);
        }
        panel.appendChild(buttonsRow);

        topLeftEl.appendChild(panel);
    }

    // Session-completion overlay — shared across racing views. Subclasses can
    // override showSessionComplete() to render something different.
    protected showSessionComplete(
        stageTimes: { stageTime: number; lapTimes: number[] }[],
        totalTime: number,
    ): void {
        if (!this.root) return;
        this.stop();

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0',
            width: '100vw', height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'white', zIndex: '1000', overflowY: 'auto', padding: '40px',
            fontFamily: 'Arial, sans-serif',
        });

        const h1 = document.createElement('h1');
        h1.textContent = 'Session Completed!';
        Object.assign(h1.style, { fontSize: '2.5rem', marginBottom: '2rem' });
        overlay.appendChild(h1);

        const stagesWrap = document.createElement('div');
        Object.assign(stagesWrap.style, {
            display: 'flex', flexDirection: 'column', gap: '1rem',
            marginBottom: '2rem', padding: '10px',
        });
        stageTimes.forEach((stage, i) => stagesWrap.appendChild(this.buildStageBlock(stage, i)));

        const totalWrap = document.createElement('div');
        Object.assign(totalWrap.style, {
            borderTop: '2px solid white', marginTop: '1rem', paddingTop: '1rem',
            fontSize: '2rem', fontWeight: 'bold',
            display: 'flex', justifyContent: 'space-between', gap: '2rem',
        });
        const totalLabel = document.createElement('span'); totalLabel.textContent = 'Total Time:';
        const totalValue = document.createElement('span'); totalValue.textContent = `${totalTime.toFixed(2)}s`;
        totalWrap.appendChild(totalLabel); totalWrap.appendChild(totalValue);
        stagesWrap.appendChild(totalWrap);
        overlay.appendChild(stagesWrap);

        const back = document.createElement('button');
        back.textContent = 'Back to Menu';
        Object.assign(back.style, {
            padding: '1rem 2rem', fontSize: '1.2rem',
            backgroundColor: '#4a4a4a', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer',
            transition: 'background-color 0.2s',
        });
        back.addEventListener('click', () => this.onBackToMenu());
        overlay.appendChild(back);

        this.root.appendChild(overlay);
        this.completionOverlay = overlay;
    }

    // --- Internal build steps ---

    private buildGame(): void {
        if (!this.root) return;

        this.gameEl = this.buildGameContainer();
        this.root.appendChild(this.gameEl);

        const ctx = this.mainCanvas!.getContext('2d');
        const fpsCtx = this.fpsCanvas!.getContext('2d');
        if (!ctx || !fpsCtx) {
            throw new Error('RacingView: failed to acquire 2D contexts');
        }

        this.renderer = new Renderer(ctx, fpsCtx, this.pixelRatio);
        this.renderer.setTimeOfDay(this.timeOfDay);
        this.renderer.setFog(this.fog);
        this.renderer.setRain(this.rain);
        this.renderer.setReflections(this.reflections);
        this.renderer.setCameraMode(this.cameraMode);
        this.renderer.setSeeThrough(this.seeThrough);
        this.renderer.setHeadlights(this.headlightsOn);

        this.prepare();
        this.wireHud();
        this.wireDefaults();
        this.start();
    }

    private buildGameContainer(): HTMLDivElement {
        const container = document.createElement('div');
        Object.assign(container.style, {
            position: 'relative',
            width: '100%',
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#1a1a1a',
        });

        // 1000 × 700 CSS px, drawn at the screen's pixel density (Retina:
        // 2× the pixels) so lines stay sharp. Zoom stays in CSS px; the
        // Renderer scales by pixelRatio.
        this.pixelRatio = window.devicePixelRatio || 1;
        this.mainCanvas = document.createElement('canvas');
        this.mainCanvas.width = Math.round(1000 * this.pixelRatio);
        this.mainCanvas.height = Math.round(700 * this.pixelRatio);
        Object.assign(this.mainCanvas.style, {
            width: '1000px',
            height: '700px',
            border: '2px solid #333',
            borderRadius: '4px',
        });
        container.appendChild(this.mainCanvas);

        this.fpsCanvas = document.createElement('canvas');
        Object.assign(this.fpsCanvas.style, {
            position: 'absolute',
            top: '10px',
            left: '250px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderRadius: '4px',
        });
        container.appendChild(this.fpsCanvas);

        return container;
    }

    private buildTopRightWrapper(): void {
        if (this.topRightWrapper) return;
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            position: 'absolute',
            top: '10px', right: '10px',
            display: 'flex', gap: '10px', alignItems: 'center',
            pointerEvents: 'auto',
        });
        this.gameEl!.appendChild(wrapper);
        this.topRightWrapper = wrapper;
    }

    // A vertical pedal bar (display only): `fill` grows from the bottom
    // (height 0% / 100% — the controls are on / off).
    private makePedalBar(label: string, color: string): { wrap: HTMLDivElement; fill: HTMLDivElement } {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        });
        const bar = document.createElement('div');
        Object.assign(bar.style, {
            position: 'relative', width: '22px', height: '90px',
            backgroundColor: '#3a3a3a', border: '1px solid #5a5a5a', borderRadius: '3px', overflow: 'hidden',
        });
        const fill = document.createElement('div');
        Object.assign(fill.style, {
            position: 'absolute', left: '0', right: '0', bottom: '0', height: '0%',
            backgroundColor: color, transition: 'height 0.08s linear',
        });
        bar.appendChild(fill);
        const text = document.createElement('div');
        text.textContent = label;
        Object.assign(text.style, { color: 'white', fontSize: '12px', fontFamily: 'monospace' });
        wrap.append(bar, text);
        return { wrap, fill };
    }

    // Steering wheel drawn as SVG, turned by the tracked car's steeringAngle
    // (real degrees: a 360° lock is a full turn). The marker on top shows
    // how far it has turned. Display only — steering comes from A/D or the AI.
    private makeSteeringWheel(): HTMLDivElement {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        });

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '-50 -50 100 100');
        svg.setAttribute('width', '90');
        svg.setAttribute('height', '90');
        svg.style.transition = 'transform 0.05s linear';
        const add = (tag: string, attrs: Record<string, string>) => {
            const el = document.createElementNS(ns, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
            svg.appendChild(el);
        };
        add('circle', { cx: '0', cy: '0', r: '42', fill: 'none', stroke: '#d8d8d8', 'stroke-width': '8' });
        // Spokes: left, right and down from the hub.
        add('line', { x1: '-38', y1: '4', x2: '-10', y2: '4', stroke: '#d8d8d8', 'stroke-width': '7', 'stroke-linecap': 'round' });
        add('line', { x1: '10', y1: '4', x2: '38', y2: '4', stroke: '#d8d8d8', 'stroke-width': '7', 'stroke-linecap': 'round' });
        add('line', { x1: '0', y1: '12', x2: '0', y2: '38', stroke: '#d8d8d8', 'stroke-width': '7', 'stroke-linecap': 'round' });
        add('circle', { cx: '0', cy: '4', r: '11', fill: '#5a5a5a', stroke: '#d8d8d8', 'stroke-width': '3' });
        // Top marker (straight ahead).
        add('rect', { x: '-4', y: '-48', width: '8', height: '12', rx: '2', fill: '#ff4444' });
        wrap.appendChild(svg);

        const label = document.createElement('div');
        label.textContent = '0°';
        Object.assign(label.style, {
            color: 'white', fontSize: '14px', fontFamily: 'monospace', minWidth: '50px', textAlign: 'center',
        });
        wrap.appendChild(label);

        this.steeringWheel = svg;
        this.steeringLabel = label;
        return wrap;
    }

    private makeWideButton(key: string, label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            width: '100px', height: '40px',
            backgroundColor: '#5a5a5a', border: 'none', borderRadius: '5px',
            color: 'white', fontSize: '16px', cursor: 'pointer',
            transform: 'scale(1)', transition: 'all 0.1s ease',
        });
        this.pressedBtns[key] = btn;
        return btn;
    }

    protected makeZoomButton(label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            width: '40px', height: '40px',
            backgroundColor: '#5a5a5a', border: 'none', borderRadius: '5px',
            color: 'white', fontSize: '24px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        return btn;
    }

    private updateBboxButton(): void {
        if (!this.bboxButton) return;
        this.bboxButton.textContent = this.boundingBoxOn ? 'Hide Bounding Box' : 'Show Bounding Box';
        this.bboxButton.style.backgroundColor = this.boundingBoxOn ? '#44ff44' : '#ff4444';
    }

    private buildStageBlock(
        stage: { stageTime: number; lapTimes: number[] },
        index: number,
    ): HTMLDivElement {
        const block = document.createElement('div');
        Object.assign(block.style, {
            display: 'flex', flexDirection: 'column', gap: '0.5rem',
            fontSize: '1.5rem', padding: '1rem',
            backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '8px',
        });
        const title = document.createElement('div');
        title.textContent = `Stage ${index + 1}`;
        title.style.fontWeight = 'bold';
        block.appendChild(title);

        const stRow = document.createElement('div');
        Object.assign(stRow.style, { display: 'flex', justifyContent: 'space-between', gap: '2rem' });
        const stL = document.createElement('span'); stL.textContent = 'Stage Time:';
        const stV = document.createElement('span'); stV.textContent = `${stage.stageTime.toFixed(2)}s`;
        stRow.appendChild(stL); stRow.appendChild(stV);
        block.appendChild(stRow);

        const lapsWrap = document.createElement('div');
        Object.assign(lapsWrap.style, {
            display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem',
        });
        const lapsHeading = document.createElement('div');
        Object.assign(lapsHeading.style, { fontSize: '1.2rem', opacity: '0.8' });
        lapsHeading.textContent = 'Lap Times:';
        lapsWrap.appendChild(lapsHeading);

        const bestLapTime = stage.lapTimes.length > 0 ? Math.min(...stage.lapTimes) : 0;
        stage.lapTimes.forEach((lapTime, lapIndex) => {
            const row = document.createElement('div');
            const isBest = lapTime === bestLapTime;
            Object.assign(row.style, {
                display: 'flex', justifyContent: 'space-between', gap: '2rem',
                color: isBest ? '#4CAF50' : 'white',
                fontWeight: isBest ? 'bold' : 'normal',
            });
            const l = document.createElement('span'); l.textContent = `Lap ${lapIndex + 1}:`;
            const v = document.createElement('span'); v.textContent = `${lapTime.toFixed(2)}s`;
            row.appendChild(l); row.appendChild(v);
            lapsWrap.appendChild(row);
        });
        block.appendChild(lapsWrap);
        return block;
    }

    protected showError(message: string): void {
        if (!this.root) return;
        this.root.replaceChildren();
        const el = document.createElement('div');
        Object.assign(el.style, {
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
            height: '100vh', backgroundColor: '#1a1a1a', color: '#ffcdd2',
            fontFamily: 'Arial, sans-serif',
        });
        const h = document.createElement('h2');
        h.textContent = 'Failed to load game';
        el.appendChild(h);
        const p = document.createElement('p');
        p.textContent = message;
        el.appendChild(p);
        this.root.appendChild(el);
    }

    private getOrCreateSlot(slot: HudSlot): HTMLElement {
        const existing = this.slots[slot];
        if (existing) return existing;

        const el = document.createElement('div');
        Object.assign(el.style, this.slotStyleFor(slot));
        this.gameEl?.appendChild(el);
        this.slots[slot] = el;
        return el;
    }

    private slotStyleFor(slot: HudSlot): Partial<CSSStyleDeclaration> {
        const base: Partial<CSSStyleDeclaration> = {
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            pointerEvents: 'none',
        };
        switch (slot) {
            case 'topLeft':      return { ...base, top: '10px', left: '10px' };
            case 'topCenter':    return { ...base, top: '10px', left: '50%', transform: 'translateX(-50%)' };
            case 'topRight':     return { ...base, top: '10px', right: '10px' };
            case 'bottomLeft':   return { ...base, bottom: '10px', left: '10px' };
            case 'bottomCenter': return { ...base, bottom: '10px', left: '50%', transform: 'translateX(-50%)' };
            case 'bottomRight':  return { ...base, bottom: '10px', right: '10px' };
            case 'center':       return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        }
    }
}
