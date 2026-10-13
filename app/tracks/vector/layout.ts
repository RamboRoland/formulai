import type { Checkpoint, Layout } from '~/tracks/types';

// Shared layout rules (start/finish, lap order, unused checkpoints). Pure
// functions used by the editor (CheckpointsTab), export, and the runtime
// Track so they all agree on what a layout means. The checkpoint list order
// IS the lap order (explicit, never derived from the geometry).

// --- Start / finish ---

// Enforce exactly one start and exactly one finish. Missing start → cps[0].
// Missing finish → the start checkpoint (loop). Duplicates → keep the first.
export function normalizeStartFinish(cps: Checkpoint[]): void {
    if (cps.length === 0) return;
    let start = cps.find(c => c.isStart);
    for (const c of cps) if (c !== start) c.isStart = undefined;
    if (!start) { start = cps[0]; start.isStart = true; }

    const finish = cps.find(c => c.isFinish);
    for (const c of cps) if (c !== finish) c.isFinish = undefined;
    if (!finish) start.isFinish = true;
}

// The list order the engine needs, IN PLACE: start first (rest keeps its
// order), and on a one-way layout nothing after the finish (those
// checkpoints are unused). Call after normalizeStartFinish.
export function normalizeLapOrder(cps: Checkpoint[]): void {
    const si = cps.findIndex(c => c.isStart);
    if (si > 0) { const [s] = cps.splice(si, 1); cps.unshift(s); }
    const fi = cps.findIndex(c => c.isFinish);
    if (fi > 0) cps.length = fi + 1;
}

// One-way layout only: checkpoints after the finish in the list (not raced,
// dropped on export). Empty for loop layouts.
export function unusedSet(cps: Checkpoint[]): Set<Checkpoint> {
    const fi = cps.findIndex(c => c.isFinish);
    if (fi < 0 || cps[fi].isStart) return new Set();
    return new Set(cps.slice(fi + 1));
}

// Loop layout = start and finish are the same checkpoint.
export function isLoopLayout(layout: Layout): boolean {
    return layout.checkpoints.some(c => c.isStart && c.isFinish);
}
