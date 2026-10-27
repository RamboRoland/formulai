import { RacingView } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { Player } from '~/Player';
import { createControls, type ControlsInstance } from '~/components/controls/createControls';
import { WebSocketClient } from '~/services/websocket';
import type { Session } from '~/sessions/Session';
import { carCorners } from '~/engine/carBody';
import type { GameState } from '../../server/src/types';

// Test harness for a single external AI client. Browser hosts the engine,
// AI connects over WS and pipes controls in. Host publishes game state back
// on the server's `req:game/state` requests.
//
// All shared racing UI (control panel, back-to-menu, bbox toggle, zoom,
// session-completion overlay) is inherited from RacingView.
export class AiView extends RacingView {
    private statsBox: StatsBox | null = null;
    private wsClient: WebSocketClient | null = null;

    public constructor(session: Session) {
        super(session, 'ai');
    }

    protected createPlayers(): Map<string, Player> {
        const player = new Player(
            'local',
            'AI',
            this.session.chooseCar(this.session.cars[0]),
            'red',
            this.session.stages,
        );
        return new Map<string, Player>([['local', player]]);
    }

    protected createControlsInstance(): ControlsInstance {
        return createControls('ai', () => this.engine?.requestReset());
    }

    protected wireHud(): void {
        if (!this.engine) return;

        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');

        this.unsubs.push(this.engine.on('stats', ({ playerId, stats }) => {
            if (playerId !== this.trackedPlayerId) return;
            this.statsBox?.update(stats);
        }));

        this.wireWebSocket();
    }

    // Register typed subscriptions for the AI-mode protocol:
    // - evt:game/startStage / nextStage → drive engine stage transitions
    //                                    (nextStage { completed }: done or skipped)
    // - evt:control/setTrack           → track hot-swap (deferred)
    // - req:game/state                 → AI asked for state (via server);
    //                                    respond with the host's current snapshot.
    private wireWebSocket(): void {
        const player = this.players.get(this.trackedPlayerId);
        if (!player) return;

        this.wsClient = WebSocketClient.getInstance('ws://localhost:8080');

        this.unsubs.push(this.wsClient.subscribe('evt:game', 'startStage', () => {
            this.engine?.startStage(this.trackedPlayerId);
        }));
        this.unsubs.push(this.wsClient.subscribe('evt:game', 'nextStage', ({ completed }) => {
            this.engine?.nextStage(completed);
        }));
        this.unsubs.push(this.wsClient.subscribe('evt:control', 'setTrack', (track) => {
            console.warn('AiView: track change not implemented:', track);
        }));

        // State-RPC: respond to the server's forwarded state request from the AI.
        // Payload shape going back is `{ clientId, gameState }` — we echo the
        // requester's clientId so the server can route the response back to
        // just that one client (not broadcast).
        this.unsubs.push(this.wsClient.subscribe('req:game', 'state', (data) => {
            if ('gameState' in data) return; // this is the response variant, not the request
            const requesterId = data.clientId;
            this.wsClient?.send('req:game', 'state', {
                clientId: requesterId,
                gameState: this.buildGameState(),
            });
        }));
    }

    private buildGameState(): GameState {
        const player = this.players.get(this.trackedPlayerId)!;
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

    public override unmount(): void {
        this.statsBox = null;
        // Reset the singleton so a fresh instance is created on next mount and
        // callbacks from this instance don't fire against a stale engine.
        WebSocketClient.resetInstance();
        this.wsClient = null;
        super.unmount();
    }
}
