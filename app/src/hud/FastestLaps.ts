import type { LapTimeEntry } from '~/protocol';

// The fastest laps on the watched stage (evt:view/times): the top 10 of one
// kart class — the followed car's, or the first with laps. Dumb widget like
// StatsBox: the view hands it the lists, the kart and the followed car.
export class FastestLaps {
    private rootEl: HTMLDivElement;
    private shown = '';

    public constructor() {
        this.rootEl = document.createElement('div');
        Object.assign(this.rootEl.style, {
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            fontFamily: 'monospace',
            fontSize: '13px',
            minWidth: '150px',
            marginTop: '50px', // below the top-right buttons
            whiteSpace: 'pre',
        });
    }

    public mount(parent: HTMLElement): void {
        parent.appendChild(this.rootEl);
    }

    public update(karts: Record<string, LapTimeEntry[]>, kart: string | null, carId: string | null): void {
        const shownKart = kart && karts[kart] ? kart : Object.keys(karts)[0] ?? kart;
        const list = shownKart ? karts[shownKart] ?? [] : [];
        const text = JSON.stringify([shownKart, list, carId]);
        if (text === this.shown) return;
        this.shown = text;
        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '4px';
        title.textContent = `Fastest laps${shownKart ? ` · ${shownKart}` : ''}`;
        const rows = list.map((e, i) => {
            const row = document.createElement('div');
            row.textContent = `${String(i + 1).padStart(2)}. ${formatLap(e.lapTime)}  ${e.name}`;
            if (e.carId === carId) row.style.color = '#ffd54f';
            return row;
        });
        if (rows.length === 0) {
            const none = document.createElement('div');
            none.style.color = '#999';
            none.textContent = 'No laps yet';
            rows.push(none);
        }
        this.rootEl.replaceChildren(title, ...rows);
    }

    public destroy(): void {
        this.rootEl.remove();
    }
}

// seconds → m:ss.mmm
function formatLap(time: number): string {
    const minutes = Math.floor(time / 60);
    return `${minutes}:${(time - minutes * 60).toFixed(3).padStart(6, '0')}`;
}
