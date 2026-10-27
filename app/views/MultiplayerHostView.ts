import { RacingView } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { Player } from '~/Player';
import { createControls, type ControlsInstance } from '~/components/controls/createControls';
import { WebSocketClient } from '~/services/websocket';
import type { Session } from '~/sessions/Session';
import { carCorners } from '~/engine/carBody';
import type { GameState, LobbyPlayer } from '../../server/src/types';

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Host camera. Main canvas is fixed at 1000×700 (RacingView.buildGameContainer).
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 700;
const MAX_ZOOM = 2;
const BUTTON_ZOOM_STEP = 1.25;
const WHEEL_ZOOM_STEP = 1.1;
const FIT_MARGIN = 1.15;        // padding around the checkpoints
const FIT_MIN_SIZE_PX = 480;    // ~20 m: don't zoom in too far on a tiny layout
const REJOIN_COUNTDOWN_MS = 2000; // after the last rejoin, before the session restarts

// Browser hosts a multiplayer race. External AI clients connect, join the
// lobby, and drive one actor each via WS controls. This view doesn't drive
// anything — it runs physics for all AI-controlled actors and renders them.
//
// The default UI (back-to-menu, bbox toggle, zoom, control panel, session-
// completion overlay) is inherited from RacingView. The control panel's
// buttons still show the tracked player's control state via the standard
// stats event wiring.
//
// Stages: a client's WS nextStage moves the whole lobby on; finished cars
// are removed from the track until then (or a restart).
//
// Rejoin: when every player has left a running (not completed) session, a
// waiting overlay shows; the server reopens the lobby. Players who join
// again are listed, and REJOIN_COUNTDOWN_MS after the last join the session
// restarts from stage 1 with them (req:game/start → evt:game/start).
//
// Known gaps (deferred):
//   - Actor-picker dropdown + leaderboard HUDs → Phase 6.6.4
export class MultiplayerHostView extends RacingView {
    private statsBox: StatsBox | null = null;
    private wsClient: WebSocketClient | null = null;
    // Overview camera: world point at the canvas center + zoom.
    private cam = { zoom: 1, x: 0, y: 0 };
    private minZoom = 0.01;
    // Rejoin: players back in the emptied lobby (null = racing, not waiting).
    private waiting: LobbyPlayer[] | null = null;
    private waitingOverlay: HTMLDivElement | null = null;
    private countdownTimer: ReturnType<typeof setInterval> | null = null;
    private sessionDone = false;

    public constructor(
        session: Session,
        private readonly lobbyId: string,
        private readonly lobbyPlayers: LobbyPlayer[],
    ) {
        super(session, 'ai');
    }

    protected createPlayers(): Map<string, Player> {
        return new Map(this.buildPlayers(this.lobbyPlayers).map(p => [p.id, p]));
    }

    // One Player per lobby player, cars on the session's current stage.
    private buildPlayers(lobbyPlayers: LobbyPlayer[]): Player[] {
        return lobbyPlayers.map((lp, index) => {
            const car = this.session.chooseCar(lp.car);
            const color = COLORS[index % COLORS.length];
            return new Player(lp.id, lp.name, car, color, this.session.stages);
        });
    }

    protected createControlsInstance(): ControlsInstance {
        // No onRestart: in multiplayer controls.restart is ignored — a restart
        // is a lobby request (req:control/restart → evt:game/restart).
        return createControls('ai');
    }

    protected wireHud(): void {
        if (!this.engine) return;

        // Overview camera: fits the layout's checkpoints; the host can zoom
        // (buttons / wheel) and drag to pan.
        this.fitToCheckpoints();
        this.wireCameraMouse();

        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');

        // StatsBox follows the tracked player (default = first actor).
        this.unsubs.push(this.engine.on('stats', ({ playerId, stats }) => {
            if (playerId !== this.trackedPlayerId) return;
            this.statsBox?.update(stats);
        }));

        // Clean up actor + its tracked state if the controlling AI drops.
        this.unsubs.push(this.engine.on('actorRemoved', ({ playerId }) => {
            if (this.trackedPlayerId === playerId) {
                const next = [...this.players.keys()][0] ?? '';
                this.trackedPlayerId = next;
                this.engine?.setTrackedPlayerId(next);
            }
        }));

        // When the engine declares the session done, tell the server so it
        // broadcasts evt:game/completed to all AIs in the lobby.
        this.unsubs.push(this.engine.on('sessionCompleted', () => {
            this.sessionDone = true;
            this.wsClient?.send('req:game', 'completed', { lobbyId: this.lobbyId });
        }));

        // A restart is applied (every car reset, the next tick has run) —
        // the server broadcasts evt:game/restarted so AIs can fetch state.
        this.unsubs.push(this.engine.on('restarted', () => {
            this.wsClient?.send('req:game', 'restarted', { lobbyId: this.lobbyId });
        }));

        this.wireWebSocket();
    }

    private wireWebSocket(): void {
        this.wsClient = WebSocketClient.getInstance('ws://localhost:8080');

        // Announce game-start so the server broadcasts evt:game/start to all
        // control clients (AIs). hostId check on the server passes because we
        // reuse the same WS connection that created the lobby (LobbyView's
        // unmount intentionally does NOT disconnect).
        this.wsClient.send('req:game', 'start', { lobbyId: this.lobbyId });

        // Per-requester state RPC. Server forwards req:game/state { clientId }
        // from a control client; we respond with { clientId, gameState } so
        // the server can route the res:game/state back to only that AI.
        this.unsubs.push(this.wsClient.subscribe('req:game', 'state', (data) => {
            if ('gameState' in data) return; // response variant, not request
            const requesterId = data.clientId;
            const gameState = this.buildGameStateFor(requesterId);
            if (!gameState) return;
            this.wsClient?.send('req:game', 'state', {
                clientId: requesterId,
                gameState,
            });
        }));

        // Batch state RPC: AI asks for N actors' states in one message.
        // Server forwards { requesterId, clientIds }; we respond with
        // { requesterId, states } so the server routes back to the requester.
        this.unsubs.push(this.wsClient.subscribe('req:game', 'stateBatch', (data) => {
            // Only the server→host forward reaches us; it carries both
            // requesterId and clientIds. Other variants are routed elsewhere.
            if (!('clientIds' in data) || !('requesterId' in data)) return;
            const states: Record<string, GameState> = {};
            for (const id of data.clientIds) {
                const state = this.buildGameStateFor(id);
                if (state) states[id] = state;
            }
            this.wsClient?.send('req:game', 'stateBatch', {
                requesterId: data.requesterId,
                states,
            });
        }));

        // A lobby client restarts the stage for every car (finished ones too).
        // The engine emits 'restarted' after the next real tick → evt:game/restarted.
        this.unsubs.push(this.wsClient.subscribe('evt:game', 'restart', () => {
            this.engine?.requestReset();
        }));

        // A client decides when the lobby moves on (completed or skipped).
        // Every player goes to the next stage; frame the new layout.
        this.unsubs.push(this.wsClient.subscribe('evt:game', 'nextStage', ({ completed }) => {
            const before = this.session.currentStage;
            this.engine?.nextStage(completed);
            if (this.session.currentStage !== before) this.fitToCheckpoints();
        }));

        // AI dropped → remove its actor + clear its stored controls so the car
        // doesn't keep driving with stale input.
        this.unsubs.push(this.wsClient.subscribe('evt:lobby', 'playerLeft', (data) => {
            this.engine?.removeActor(data.player.id);
            this.controls?.clearControlsFor(data.player.id);

            if (this.waiting) {
                this.waiting = this.waiting.filter(p => p.id !== data.player.id);
                this.restartCountdown();
            } else if (this.players.size === 0 && !this.sessionDone) {
                this.enterWaiting();
            }
        }));

        // Rejoin: the server only accepts joins once the lobby is empty, so a
        // join reaches us while waiting.
        this.unsubs.push(this.wsClient.subscribe('evt:lobby', 'playerJoined', (data) => {
            if (!this.waiting) return;
            this.waiting = [...this.waiting.filter(p => p.id !== data.player.id), data.player];
            this.restartCountdown();
        }));
    }

    // --- Rejoin (every player left a running session) ---

    private enterWaiting(): void {
        this.waiting = [];
        this.renderWaiting(null);
    }

    // (Re)start the countdown after a join/leave; nobody waiting → stop it.
    private restartCountdown(): void {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        if (!this.waiting || this.waiting.length === 0) {
            this.renderWaiting(null);
            return;
        }
        const endsAt = Date.now() + REJOIN_COUNTDOWN_MS;
        this.renderWaiting(REJOIN_COUNTDOWN_MS);
        this.countdownTimer = setInterval(() => {
            const left = endsAt - Date.now();
            if (left > 0) {
                this.renderWaiting(left);
                return;
            }
            this.restartWithRejoined();
        }, 100);
    }

    // Countdown over: the session starts over (stage 1, no stage flags) with
    // the rejoined players, and the AIs get evt:game/start again.
    private restartWithRejoined(): void {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        const rejoined = this.waiting ?? [];
        this.waiting = null;
        this.waitingOverlay?.remove();
        this.waitingOverlay = null;

        this.session.reset();
        this.engine?.restartSession(this.buildPlayers(rejoined));
        this.trackedPlayerId = rejoined[0]?.id ?? '';
        this.engine?.setTrackedPlayerId(this.trackedPlayerId);
        this.fitToCheckpoints();
        this.wsClient?.send('req:game', 'start', { lobbyId: this.lobbyId });
    }

    // Overlay over the race area (track stays visible; clicks pass through
    // to the buttons). `msLeft` null = no countdown running.
    private renderWaiting(msLeft: number | null): void {
        if (!this.gameEl) return;
        if (!this.waitingOverlay) {
            this.waitingOverlay = document.createElement('div');
            Object.assign(this.waitingOverlay.style, {
                position: 'absolute', inset: '0',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                color: 'white', fontFamily: 'Arial, sans-serif',
                pointerEvents: 'none', zIndex: '500',
            });
            this.gameEl.appendChild(this.waitingOverlay);
        }

        const title = document.createElement('h2');
        title.textContent = 'No players connected';
        Object.assign(title.style, { fontSize: '2rem', margin: '0' });

        const sub = document.createElement('div');
        sub.textContent = this.waiting && this.waiting.length > 0
            ? 'Players back:'
            : 'Waiting for players to reconnect…';
        sub.style.fontSize = '1.1rem';

        const list = document.createElement('div');
        list.textContent = (this.waiting ?? []).map(p => p.name).join(', ');
        list.style.fontSize = '1.1rem';

        const countdown = document.createElement('div');
        countdown.textContent = msLeft === null ? '' : `Restarting in ${Math.ceil(msLeft / 1000)}…`;
        Object.assign(countdown.style, { fontSize: '1.5rem', fontWeight: 'bold' });

        this.waitingOverlay.replaceChildren(title, sub, list, countdown);
    }

    // Build a GameState for a specific player (keyed by clientId / playerId).
    // Called in response to the server-forwarded `req:game/state`.
    private buildGameStateFor(playerId: string): GameState | null {
        const player = this.engine?.getPlayer(playerId);
        if (!player) return null;

        const lapTimes = player.stage().lapTimes;
        const currentLapTime = lapTimes.length > 0 ? lapTimes[lapTimes.length - 1] : 0;
        const lastCompletedLapTime = lapTimes.length > 1 ? lapTimes[lapTimes.length - 2] : 0;

        return {
            car: {
                name: player.car.name,
                speed: Math.round(player.car.speed * 100) / 100,
                maxSpeed: player.car.maxSpeed,
                // Centre (car.x / car.y are the corner, see Car.reset).
                x: Math.round((player.car.x + player.car.widthPx / 2) * 100) / 100,
                y: Math.round((player.car.y + player.car.lengthPx / 2) * 100) / 100,
                // Clockwise on screen: front-left, front-right, rear-right, rear-left.
                corners: carCorners(player.car).map(p => ({
                    x: Math.round(p.x * 100) / 100,
                    y: Math.round(p.y * 100) / 100,
                })),
                angle: Math.round(player.car.angle * 100) / 100,
                // -1..1 for the AI; the car works in degrees.
                steering: Math.round(player.car.steeringAngle / player.car.steeringLock * 10000) / 10000,
                wheelAngle: Math.round(player.car.wheelAngle * 100) / 100,
                heading: player.car.heading,
                facing: player.car.facing,
                hasCollision: player.car.hasCollision,
                rays: player.car.rays.map(r => Math.round(r * 100) / 100),
            },
            track: {
                name: this.session.stage().track.name,
                layout: this.session.stage().track.layoutName,
                loop: this.session.stage().track.isLoop,
                lapTime: Math.round(currentLapTime * 100) / 100,
                lastLapTime: Math.round(lastCompletedLapTime * 100) / 100,
                totalCheckpoints: this.session.stage().track.checkpoints.length,
                laps: player.stage().laps,
                completedLaps: player.stage().lapsCompleted,
                completedMeters: Math.round(player.stage().completedMeters * 100) / 100,
                lapDistance: Math.round(player.lapDistance(this.session.stage().track) * 10000) / 10000,
                currentCheckpoint: player.stage().currentCheckpoint,
                expectedLapTime: this.session.stage().track.getExpectedLapTimeFor(player.car.constructor.name),
            },
            stage: { completed: player.isStageCompleted(player.stage()) },
            session: { completed: this.session.isCompleted() },
        };
    }

    // --- Host camera (overview: zoom + pan, never follows a car) ---

    // Zoom that fits a box into the main canvas (letterbox with the smaller axis).
    private zoomToFit(width: number, height: number): number {
        if (width <= 0 || height <= 0) return 1;
        return Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height);
    }

    private applyCamera(): void {
        this.engine?.setZoom(this.cam.zoom);
        this.engine?.setCameraFocus({ x: this.cam.x, y: this.cam.y });
    }

    // Frame the current layout's checkpoint lines (whole map if it has none).
    // Zoom-out limit: half of the whole-map fit, so the full map always fits.
    private fitToCheckpoints(): void {
        const track = this.session.stage().track;
        const b = track.bounds;
        this.minZoom = this.zoomToFit(b.maxX - b.minX, b.maxY - b.minY) / 2;

        const points = track.checkpoints.flatMap(cp => [cp.start, cp.end]);
        let { minX, minY, maxX, maxY } = b;
        if (points.length > 0) {
            minX = Math.min(...points.map(p => p.x));
            maxX = Math.max(...points.map(p => p.x));
            minY = Math.min(...points.map(p => p.y));
            maxY = Math.max(...points.map(p => p.y));
        }
        const width = Math.max(maxX - minX, FIT_MIN_SIZE_PX) * FIT_MARGIN;
        const height = Math.max(maxY - minY, FIT_MIN_SIZE_PX) * FIT_MARGIN;
        this.cam = {
            zoom: this.clampZoom(this.zoomToFit(width, height)),
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
        };
        this.applyCamera();
    }

    private clampZoom(z: number): number {
        return Math.min(MAX_ZOOM, Math.max(this.minZoom, z));
    }

    // Zoom by `factor`, keeping the world point under canvas pixel (sx, sy)
    // in place. Defaults to the canvas center (the −/+ buttons).
    private zoomBy(factor: number, sx = CANVAS_WIDTH / 2, sy = CANVAS_HEIGHT / 2): void {
        const zoom = this.clampZoom(this.cam.zoom * factor);
        const dx = sx - CANVAS_WIDTH / 2;
        const dy = sy - CANVAS_HEIGHT / 2;
        // World point under the pointer: cam + d / zoom — same before and after.
        this.cam = {
            zoom,
            x: this.cam.x + dx / this.cam.zoom - dx / zoom,
            y: this.cam.y + dy / this.cam.zoom - dy / zoom,
        };
        this.applyCamera();
    }

    // Same look/position as RacingView's buttons, but host steps (×1.25) and
    // limits, plus Fit.
    protected override buildZoomButtons(): void {
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
        plus.addEventListener('click', () => this.zoomBy(BUTTON_ZOOM_STEP));
        const minus = this.makeZoomButton('-');
        minus.addEventListener('click', () => this.zoomBy(1 / BUTTON_ZOOM_STEP));
        const fit = this.makeZoomButton('Fit');
        fit.style.width = '48px';
        fit.style.fontSize = '14px';
        fit.addEventListener('click', () => this.fitToCheckpoints());
        wrapper.appendChild(plus);
        wrapper.appendChild(minus);
        wrapper.appendChild(fit);

        this.gameEl!.appendChild(wrapper);
    }

    // Wheel zooms towards the pointer; drag pans.
    private wireCameraMouse(): void {
        const canvas = this.mainCanvas;
        if (!canvas) return;
        // Pointer → canvas pixels (CSS size can differ from the 1000×700 buffer).
        const toCanvas = (e: MouseEvent) => {
            const r = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - r.left - canvas.clientLeft) * (CANVAS_WIDTH / canvas.clientWidth),
                y: (e.clientY - r.top - canvas.clientTop) * (CANVAS_HEIGHT / canvas.clientHeight),
            };
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const p = toCanvas(e);
            this.zoomBy(e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, p.x, p.y);
        };

        let last: { x: number; y: number } | null = null;
        const onDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            last = toCanvas(e);
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
        };
        const onMove = (e: MouseEvent) => {
            if (!last) return;
            const p = toCanvas(e);
            this.cam = {
                ...this.cam,
                x: this.cam.x - (p.x - last.x) / this.cam.zoom,
                y: this.cam.y - (p.y - last.y) / this.cam.zoom,
            };
            last = p;
            this.applyCamera();
        };
        const onUp = () => {
            if (!last) return;
            last = null;
            canvas.style.cursor = 'grab';
        };

        canvas.style.cursor = 'grab';
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        this.unsubs.push(() => {
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        });
    }

    public override unmount(): void {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.waiting = null;
        this.waitingOverlay = null; // removed with the root by super.unmount
        this.statsBox = null;
        // The WS singleton is reset only when leaving the whole multiplayer
        // flow. The route's shim handles that; here we just drop our reference.
        this.wsClient = null;
        super.unmount();
    }
}
