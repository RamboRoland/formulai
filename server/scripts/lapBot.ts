// The lap bot's search (scripts/laptimes.ts, scripts/sensitivity.ts): which
// corner-speed setting (× the grip limit; 100 = flat out) gives the fastest
// clean lap. First a coarse grid from flat out down to careful; then the
// crash edge between the highest clean setting and the crashed one above it
// is narrowed by halving the gap until it is within EDGE_PRECISION of the
// setting. The edge moves a little when the physics changes; with the
// coarse grid alone the result jumped a whole grid step (0.9 → 0.85 = 1.5 %
// of the lap; .claude/tasks/kart-values.md, "Lap-bot noise").

export const SETTINGS = [100, 3, 2, 1.6, 1.4, 1.3, 1.2, 1.15, 1.1, 1.05, 1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
const EDGE_PRECISION = 0.003; // share of the setting (0.9 → ± 0.0027)

// lap(setting): the lap time in seconds, null if it crashed or ran out of
// time. Returns the fastest clean lap found, null if none was clean.
export function fastestLap(lap: (setting: number) => number | null): number | null {
    let best: number | null = null;
    let clean = -1; // index of the highest clean setting
    const times = SETTINGS.map((setting, i) => {
        const time = lap(setting);
        if (time !== null && clean < 0) clean = i;
        if (time !== null && (best === null || time < best)) best = time;
        return time;
    });
    if (clean <= 0 || times[clean - 1] !== null) return best;
    let low = SETTINGS[clean], high = SETTINGS[clean - 1]; // clean, crashed
    while ((high - low) / low > EDGE_PRECISION) {
        const middle = (low + high) / 2;
        const time = lap(middle);
        if (time === null) { high = middle; continue; }
        low = middle;
        if (best === null || time < best) best = time;
    }
    return best;
}
