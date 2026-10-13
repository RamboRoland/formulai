import { RacingView } from './RacingView';
import { StatsBox } from '~/hud/StatsBox';
import { Player } from '~/Player';
import { createControls, type ControlsInstance } from '~/components/controls/createControls';
import type { Session } from '~/sessions/Session';

// Single-player racing view. One local Player (the session's first car),
// keyboard controls, StatsBox HUD.
// All the shared racing UI (control panel, back-to-menu, bbox toggle, zoom,
// session-completion overlay) lives on `RacingView`.
export class SinglePlayerView extends RacingView {
    private statsBox: StatsBox | null = null;

    public constructor(session: Session) {
        super(session, 'player');
    }

    protected createPlayers(): Map<string, Player> {
        const player = new Player(
            'local',
            'Player',
            this.session.chooseCar(this.session.cars[0]),
            'red',
            this.session.stages,
        );
        return new Map<string, Player>([['local', player]]);
    }

    protected createControlsInstance(): ControlsInstance {
        return createControls('player', () => this.engine?.requestReset());
    }

    protected wireHud(): void {
        if (!this.engine) return;

        this.statsBox = new StatsBox();
        this.mountHud(this.statsBox, 'topLeft');

        this.unsubs.push(this.engine.on('stats', ({ playerId, stats }) => {
            if (playerId !== this.trackedPlayerId) return;
            this.statsBox?.update(stats);
        }));
    }

    public override unmount(): void {
        this.statsBox = null;
        super.unmount();
    }
}
