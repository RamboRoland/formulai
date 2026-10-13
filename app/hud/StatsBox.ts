import type { CarStatsSnapshot } from '~/engine/RenderSnapshot';

const ON_TRACK_COLOR = '#44ff44';
const OFF_TRACK_COLOR = '#ff4444';

// Dumb HUD widget. Owns its DOM, takes one car's snapshot per frame, writes it.
// Has no concept of actor selection — the caller decides which car to hand it.
export class StatsBox {
    private rootEl: HTMLDivElement;
    private speedEl: HTMLSpanElement;
    private angleEl: HTMLSpanElement;
    private positionEl: HTMLSpanElement;
    private statusRowEl: HTMLDivElement;
    private statusEl: HTMLSpanElement;
    private lapTimeEl: HTMLSpanElement;
    private stageTimeEl: HTMLSpanElement;
    private lapsEl: HTMLSpanElement;
    private checkpointEl: HTMLSpanElement;

    public constructor() {
        this.rootEl = document.createElement('div');
        Object.assign(this.rootEl.style, {
            position: 'relative',
            display: 'inline-block',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            fontFamily: 'monospace',
            fontSize: '14px',
            minWidth: '150px',
        });

        this.speedEl = this.appendRow('Speed: ');
        this.angleEl = this.appendRow('Angle: ');
        this.positionEl = this.appendRow('Position: ');

        this.statusRowEl = document.createElement('div');
        this.statusRowEl.append('Status: ');
        this.statusEl = document.createElement('span');
        this.statusRowEl.appendChild(this.statusEl);
        this.rootEl.appendChild(this.statusRowEl);

        this.lapTimeEl = this.appendRow('Lap: ');
        this.stageTimeEl = this.appendRow('Stage: ');
        this.lapsEl = this.appendRow('Laps Completed: ');
        this.checkpointEl = this.appendRow('Checkpoint: ');
    }

    public mount(parent: HTMLElement): void {
        parent.appendChild(this.rootEl);
    }

    public update(snap: CarStatsSnapshot): void {
        this.speedEl.textContent = snap.speed.toFixed(2);
        this.angleEl.textContent = `${snap.angle.toFixed(1)}°`;
        this.positionEl.textContent = `(${snap.x.toFixed(0)}, ${snap.y.toFixed(0)})`;
        this.statusEl.textContent = snap.hasCollision ? 'Colliding' : 'Clear';
        this.statusRowEl.style.color = snap.hasCollision ? OFF_TRACK_COLOR : ON_TRACK_COLOR;
        this.lapTimeEl.textContent = `${snap.lapTime.toFixed(1)}s`;
        this.stageTimeEl.textContent = `${snap.stageTime.toFixed(1)}s`;
        this.lapsEl.textContent = String(snap.completedLaps);
        this.checkpointEl.textContent = `${snap.currentCheckpoint}/${snap.totalCheckpoints}`;
    }

    public destroy(): void {
        this.rootEl.remove();
    }

    private appendRow(label: string): HTMLSpanElement {
        const row = document.createElement('div');
        row.append(label);
        const value = document.createElement('span');
        row.appendChild(value);
        this.rootEl.appendChild(row);
        return value;
    }
}
