import type { View } from './View';
import type { Session } from '~/sessions/Session';
import type { Player } from '~/Player';
import type { GameMode, ControlsState } from '~/types';
import type { ControlsInstance } from '~/components/controls/createControls';
import { GameEngine } from '~/engine/GameEngine';
import { Renderer } from '~/engine/Renderer';

export type HudSlot =
    | 'topLeft'
    | 'topCenter'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomCenter'
    | 'bottomRight'
    | 'center';

// A HUD widget owns its own DOM inside a slot. Update wiring (subscribing to
// engine events) is done by the RacingView subclass so each HUD only knows
// how to paint itself, not where its data comes from.
export interface Hud {
    mount(parent: HTMLElement): void;
    destroy(): void;
}

const DEFAULT_CONTROLS: ControlsState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    restart: false,
};

// Shared shell for every racing view. Owns:
//   - Error screen if the game fails to start
//   - Two canvas layers (main, fps)
//   - Renderer + GameEngine wire-up
//   - HUD slot management + lifecycle bookkeeping
//   - Default UI: control button panel, back-to-menu, bbox toggle,
//     zoom +/-, session-completion overlay
//   - mount/unmount cleanup
//
// Concrete subclasses fill in:
//   - createPlayers()          — who's racing
//   - createControlsInstance() — where input comes from
//   - wireHud()                — which HUDs to mount + how to subscribe them
// and may override any of the build* methods to customize default UI.
export abstract class RacingView implements View {
    protected root: HTMLElement | null = null;
    protected gameEl: HTMLElement | null = null;

    protected mainCanvas: HTMLCanvasElement | null = null;
    protected fpsCanvas: HTMLCanvasElement | null = null;

    protected renderer: Renderer | null = null;
    protected engine: GameEngine | null = null;
    protected controls: ControlsInstance | null = null;
    protected players: Map<string, Player> = new Map();
    protected trackedPlayerId = '';

    protected huds: Hud[] = [];
    private slots: Partial<Record<HudSlot, HTMLElement>> = {};
    protected unsubs: Array<() => void> = [];

    // Default-UI state
    private boundingBoxOn = false;
    // Starting camera zoom (screen px per world px). 0.6 ≈ 70 m across the
    // 1000 px view. The −/+ buttons step it within [0.5, 2].
    private zoom = 0.6;
    private pressedBtns: Record<string, HTMLButtonElement> = {};
    private topRightWrapper: HTMLElement | null = null;
    private bboxButton: HTMLButtonElement | null = null;
    private completionOverlay: HTMLDivElement | null = null;

    public constructor(
        protected readonly session: Session,
        protected readonly gameMode: GameMode,
    ) {}

    // Tracks are in-memory vector data, so there's nothing to load: build the
    // game straight away (errors show the error screen).
    public mount(root: HTMLElement): void {
        this.root = root;
        if (this.session.stages.length === 0) {
            this.showError(`Session "${this.session.displayName}" has no raceable tracks. Check the console for which tracks are missing or have no outline.`);
            return;
        }
        try {
            this.buildGame();
        } catch (err) {
            console.error('Failed to start the game:', err);
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }

    public unmount(): void {
        this.engine?.stop();
        this.controls?.destroy();
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        for (const hud of this.huds) hud.destroy();
        this.huds = [];
        this.slots = {};
        this.completionOverlay?.remove();
        this.completionOverlay = null;
        this.pressedBtns = {};
        this.bboxButton = null;
        this.topRightWrapper = null;
        this.root?.replaceChildren();
        this.root = null;
        this.gameEl = null;
        this.engine = null;
        this.renderer = null;
        this.controls = null;
        this.players = new Map();
    }

    // --- Abstract hooks ---

    protected abstract createPlayers(): Map<string, Player>;
    protected abstract createControlsInstance(): ControlsInstance;
    protected abstract wireHud(): void;

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
        this.buildControlPanel();
        this.wireControlIndicatorUpdates();
        this.wireSessionCompletionOverlay();
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
            this.engine?.setShowBoundingBox(this.boundingBoxOn);
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
            this.engine?.setZoom(this.zoom);
        });
        const minus = this.makeZoomButton('-');
        minus.addEventListener('click', () => {
            this.zoom = Math.max(this.zoom - 0.1, 0.5);
            this.engine?.setZoom(this.zoom);
        });
        wrapper.appendChild(plus);
        wrapper.appendChild(minus);

        this.gameEl!.appendChild(wrapper);
    }

    protected buildControlPanel(): void {
        const topLeftEl = this.getOrCreateSlot('topLeft');

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '10px', backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '15px', borderRadius: '10px', pointerEvents: 'auto',
        });

        const arrowsWrap = document.createElement('div');
        Object.assign(arrowsWrap.style, {
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '5px',
        });
        arrowsWrap.appendChild(this.makeArrowButton('forward', '↑'));
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '5px' });
        row.appendChild(this.makeArrowButton('left', '←'));
        row.appendChild(this.makeArrowButton('backward', '↓'));
        row.appendChild(this.makeArrowButton('right', '→'));
        arrowsWrap.appendChild(row);
        panel.appendChild(arrowsWrap);

        const buttonsRow = document.createElement('div');
        Object.assign(buttonsRow.style, { display: 'flex', gap: '10px' });
        buttonsRow.appendChild(this.makeWideButton('brake', 'Brake'));
        const resetBtn = this.makeWideButton('reset', 'Reset');
        resetBtn.addEventListener('click', () => this.engine?.requestReset());
        buttonsRow.appendChild(resetBtn);
        panel.appendChild(buttonsRow);

        topLeftEl.appendChild(panel);
    }

    protected wireControlIndicatorUpdates(): void {
        if (!this.engine) return;
        this.unsubs.push(this.engine.on('stats', () => this.updatePressedIndicators()));
    }

    // Session-completion overlay — shared across racing views. Subclasses can
    // override showSessionComplete() to render something different.
    protected wireSessionCompletionOverlay(): void {
        if (!this.engine) return;
        this.unsubs.push(this.engine.on('sessionCompleted', (data) => {
            this.showSessionComplete(data.stageTimes, data.totalTime);
        }));
    }

    protected showSessionComplete(
        stageTimes: { stageTime: number; lapTimes: number[] }[],
        totalTime: number,
    ): void {
        if (!this.root) return;
        this.engine?.stop();

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

        this.players = this.createPlayers();
        this.trackedPlayerId = [...this.players.keys()][0] ?? '';
        this.controls = this.createControlsInstance();

        this.renderer = new Renderer(ctx, fpsCtx);
        this.engine = new GameEngine(
            this.session,
            this.players,
            this.renderer,
            (playerId: string) => this.controls?.getControlsFor(playerId) ?? DEFAULT_CONTROLS,
            this.gameMode,
        );
        this.engine.setZoom(this.zoom);
        this.engine.setTrackedPlayerId(this.trackedPlayerId);

        this.wireHud();
        this.wireDefaults();
        this.engine.start();
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

        this.mainCanvas = document.createElement('canvas');
        this.mainCanvas.width = 1000;
        this.mainCanvas.height = 700;
        Object.assign(this.mainCanvas.style, {
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

    private makeArrowButton(key: string, label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            width: '60px', height: '60px',
            backgroundColor: '#5a5a5a', border: 'none', borderRadius: '5px',
            color: 'white', fontSize: '24px', cursor: 'pointer',
            transform: 'scale(1)', transition: 'all 0.1s ease',
        });
        this.pressedBtns[key] = btn;
        return btn;
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

    private makeZoomButton(label: string): HTMLButtonElement {
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

    private updatePressedIndicators(): void {
        // Pressed-button UI reflects the currently-tracked actor's controls.
        const c = this.controls?.getControlsFor(this.trackedPlayerId);
        if (!c) return;
        const map: Record<string, boolean> = {
            forward: c.forward, backward: c.backward,
            left: c.left, right: c.right,
            brake: c.brake, reset: c.restart,
        };
        for (const [key, pressed] of Object.entries(map)) {
            const btn = this.pressedBtns[key];
            if (!btn) continue;
            btn.style.backgroundColor = pressed ? '#4a4a4a' : '#5a5a5a';
            btn.style.transform = pressed ? 'scale(0.95)' : 'scale(1)';
        }
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

    private showError(message: string): void {
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
