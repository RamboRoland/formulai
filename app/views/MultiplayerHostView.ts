import { RacingView } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { Player } from '~/Player';
import { createControls, type ControlsInstance } from '~/components/controls/createControls';
import { WebSocketClient } from '~/services/websocket';
import type { Session } from '~/sessions/Session';
import type { GameState, LobbyPlayer } from '../../server/src/types';

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Browser hosts a multiplayer race. External AI clients connect, join the
// lobby, and drive one actor each via WS controls. This view doesn't drive
// anything — it runs physics for all AI-controlled actors and renders them.
//
// The default UI (back-to-menu, bbox toggle, zoom, control panel, session-
// completion overlay) is inherited from RacingView. The control panel's
// buttons still show the tracked player's control state via the standard
// stats event wiring.
//
// Known gaps (deferred):
//   - Actor-picker dropdown + leaderboard HUDs → Phase 6.6.4
//   - "Wait for all players to finish stage" coordination → Phase 6.6.3
export class MultiplayerHostView extends RacingView {
    private statsBox: StatsBox | null = null;
    private wsClient: WebSocketClient | null = null;

    public constructor(
        session: Session,
        private readonly lobbyId: string,
        private readonly lobbyPlayers: LobbyPlayer[],
    ) {
        super(session, 'ai');
    }

    protected createPlayers(): Map<string, Player> {
        const map = new Map<string, Player>();
        this.lobbyPlayers.forEach((lp, index) => {
            const car = this.session.chooseCar(lp.car);
            const color = COLORS[index % COLORS.length];
            const player = new Player(lp.id, lp.name, car, color, this.session.stages);
            map.set(lp.id, player);
        });
        return map;
    }

    protected createControlsInstance(): ControlsInstance {
        return createControls('ai', () => this.engine?.requestReset());
    }

    protected wireHud(): void {
        if (!this.engine) return;

        // Overview camera: centered on the track, zoomed out to fit the whole
        // map in the 1000×700 main canvas (letterbox with the smaller axis).
        this.applyOverviewCamera();

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
            // A drop can be the "last straw" that leaves everyone else paused.
            this.maybeAdvanceAllStages();
        }));

        // Stage coordination: finishers are paused (frozen + hidden) until
        // every player is either paused mid-session or has completed the whole
        // session. Then we advance everyone who still has stages left.
        this.unsubs.push(this.engine.on('stageCompleted', ({ playerId }) => {
            this.engine?.pausePlayer(playerId);
            this.maybeAdvanceAllStages();
        }));

        // When the engine declares the session done, tell the server so it
        // broadcasts evt:game/completed to all AIs in the lobby.
        this.unsubs.push(this.engine.on('sessionCompleted', () => {
            this.wsClient?.send('req:game', 'completed', { lobbyId: this.lobbyId });
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

        // AI dropped → remove its actor + clear its stored controls so the car
        // doesn't keep driving with stale input.
        this.unsubs.push(this.wsClient.subscribe('evt:lobby', 'playerLeft', (data) => {
            this.engine?.removeActor(data.player.id);
            this.controls?.clearControlsFor(data.player.id);
        }));
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
                speed: Math.round(player.car.speed * 100) / 100,
                angle: Math.round(player.car.angle * 100) / 100,
                hasCollision: player.car.hasCollision,
                rays: player.car.rays.map(r => Math.round(r * 100) / 100),
            },
            track: {
                name: this.session.stage().track.name,
                lapTime: Math.round(currentLapTime * 100) / 100,
                lastLapTime: Math.round(lastCompletedLapTime * 100) / 100,
                totalCheckpoints: this.session.stage().track.checkpoints.length,
                completedLaps: player.stage().lapsCompleted,
                currentCheckpoint: player.stage().currentCheckpoint,
                expectedLapTime: this.session.stage().track.getExpectedLapTimeFor(player.car.constructor.name),
            },
            stage: { completed: player.isStageCompleted(player.stage()) },
            session: { completed: player.isCompleted() },
        };
    }

    // When every remaining player is paused (waiting for others), advance the
    // ones still mid-session so they all start the next stage together.
    // Session-complete finishers stay paused permanently; the engine's own
    // sessionCompleted event fires naturally once every player is done.
    private maybeAdvanceAllStages(): void {
        if (!this.engine) return;
        const players = [...this.players.values()];
        if (players.length === 0) return;
        const allWaiting = players.every(p => p.isCompleted() || this.engine!.isPlayerPaused(p.id));
        if (!allWaiting) return;
        for (const p of players) {
            if (!p.isCompleted() && this.engine.isPlayerPaused(p.id)) {
                this.engine.advanceStage(p.id);
            }
        }
    }

    private applyOverviewCamera(): void {
        if (!this.engine) return;
        // Fit the whole track (its bounds, which can sit anywhere — vector
        // tracks often have negative coords) into the view, centered.
        const { minX, minY, maxX, maxY } = this.session.stage().track.bounds;
        const trackWidth = maxX - minX;
        const trackHeight = maxY - minY;
        // Main canvas is fixed at 1000×700 (see RacingView.buildGameContainer).
        const canvasWidth = 1000;
        const canvasHeight = 700;
        const margin = 1.05;
        const fitZoom = trackWidth > 0 && trackHeight > 0
            ? Math.min(canvasWidth / (trackWidth * margin), canvasHeight / (trackHeight * margin))
            : 1;
        this.engine.setZoom(fitZoom);
        this.engine.setCameraFocus({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    }

    public override unmount(): void {
        this.statsBox = null;
        // The WS singleton is reset only when leaving the whole multiplayer
        // flow. The route's shim handles that; here we just drop our reference.
        this.wsClient = null;
        super.unmount();
    }
}
