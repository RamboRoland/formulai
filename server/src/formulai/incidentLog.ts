import { gzip } from 'zlib';
import { promisify } from 'util';
import type { Player } from '../game/Player';
import { putBytes } from '../storage';

// Incident logs (config.logIncidents): a car's last seconds around a spin
// or a crash, for looking at how real drivers meet the physics (plan:
// .claude/tasks/incident-logs.md). Each lobby samples its cars 20 times a
// second; an incident keeps BEFORE samples before it and AFTER after it.
// Batches go to the bucket as gzipped JSON lines under logs/incidents/
// (kept 30 days) — written in the background, never in the game loop.

export const SAMPLE_TICKS = 3;          // every 3rd step = 20 / s
const BEFORE = 60;                      // 3 s
const AFTER = 40;                       // 2 s
const COOL_DOWN = 60;                   // samples (3 s) before a car can log again
const MIN_KMH = 8;
const SPIN_DEG = 20;                    // |body slip| over this = a spin
const FLUSH_MS = 60_000;
const MAX_QUEUED = 2000;                // incidents waiting to be written (then dropped)
export const PREFIX = 'logs/incidents/';

const gzipAsync = promisify(gzip);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const DEG = 180 / Math.PI;

type Sample = ReturnType<typeof sampleOf>;
type Who = { client: string; kind: 'agent' | 'player'; kart: string };
type Incident = Record<string, unknown>;

function sampleOf(tick: number, player: Player) {
    const car = player.car;
    const v = car.speed / 3.6;
    return {
        t: tick,
        speed: round(car.speed),
        angle: round(car.angle),
        x: round(car.x + car.widthPx / 2, 1),
        y: round(car.y + car.lengthPx / 2, 1),
        slip: round(v > 0.5 ? Math.atan2(car.lateralSpeed, v) * DEG : 0, 1),
        slipFront: round(car.slipFront * DEG, 1),
        slipRear: round(car.slipRear * DEG, 1),
        yawRate: round(car.yawRate * DEG, 1),
        lateralG: round(car.lateralG),
        longitudinalG: round(car.longitudinalG),
        gripFront: round(car.gripFront),
        gripRear: round(car.gripRear),
        rearLift: round(car.rearLift),
        rearLocked: car.rearLocked,
        forward: car.controls.forward,
        backward: car.controls.backward,
        brake: car.controls.brake,
        steering: car.controls.steering,
        steeringAngle: round(car.steeringAngle, 1),
        wheelAngle: round(car.wheelAngle, 1),
        hasCollision: car.hasCollision,
    };
}

// One lobby's recorder: a ring of recent samples per car, incidents waiting
// for their "after" samples, then into the shared write queue.
export class IncidentRecorder {
    private readonly recent = new Map<string, Sample[]>();
    private readonly open = new Map<string, { incident: Incident; samples: Sample[]; left: number }>();
    private readonly quietUntil = new Map<string, number>(); // sample count
    private readonly collided = new Map<string, boolean>();
    private count = 0;

    public constructor(private readonly lobbyId: string, private readonly session: string) {}

    // Every SAMPLE_TICKS steps: the cars that drive (not finished / removed).
    public sample(tick: number, players: Iterable<Player>, who: (carId: string) => Who | null): void {
        this.count++;
        for (const player of players) {
            if (player.isStageCompleted(player.stage())) continue;
            const id = player.id;
            const s = sampleOf(tick, player);
            const ring = this.recent.get(id) ?? [];
            ring.push(s);
            if (ring.length > BEFORE) ring.shift();
            this.recent.set(id, ring);

            const pending = this.open.get(id);
            if (pending) {
                pending.samples.push(s);
                if (--pending.left <= 0) {
                    queue(this.lobbyId, { ...pending.incident, samples: pending.samples });
                    this.open.delete(id);
                }
                continue;
            }
            // A crash stops the car at once: its speed from the sample before.
            const before = ring.length > 1 ? ring[ring.length - 2].speed : 0;
            const crashed = s.hasCollision && !this.collided.get(id) && before > MIN_KMH;
            this.collided.set(id, s.hasCollision);
            const spun = s.speed > MIN_KMH && Math.abs(s.slip) > SPIN_DEG;
            if (!(crashed || spun) || this.count < (this.quietUntil.get(id) ?? 0)) continue;
            const w = who(id);
            if (!w) continue;
            this.quietUntil.set(id, this.count + COOL_DOWN);
            const track = player.progress.stage().track;
            const stage = player.stage();
            this.open.set(id, {
                incident: {
                    v: 1,
                    at: new Date().toISOString(),
                    type: spun ? 'spin' : 'collision',
                    lobby: this.lobbyId,
                    session: this.session,
                    stage: player.currentStageId,
                    track: track.name,
                    layout: track.layoutName,
                    carId: id,
                    client: w.client,
                    driver: w.kind,
                    kart: w.kart,
                    lap: stage.lapsCompleted,
                    lapDistance: round(player.lapDistance(track), 4),
                    tick,
                    sampleTicks: SAMPLE_TICKS,
                },
                samples: [...ring],
                left: AFTER,
            });
        }
    }

    // The lobby ends: incidents still waiting for samples go as they are.
    public close(): void {
        for (const { incident, samples } of this.open.values()) queue(this.lobbyId, { ...incident, samples, cut: true });
        this.open.clear();
        void flush(this.lobbyId);
    }
}

// The write queue, shared by all lobbies: by lobby, flushed every minute.
const queued = new Map<string, Incident[]>();
let total = 0;
let timer: NodeJS.Timeout | null = null;
let batch = 0;

function queue(lobbyId: string, incident: Incident): void {
    if (total >= MAX_QUEUED) return; // the bucket can't keep up — drop
    const list = queued.get(lobbyId) ?? [];
    list.push(incident);
    queued.set(lobbyId, list);
    total++;
    if (!timer) {
        timer = setInterval(() => { for (const id of [...queued.keys()]) void flush(id); }, FLUSH_MS);
        timer.unref();
    }
}

async function flush(lobbyId: string): Promise<void> {
    const list = queued.get(lobbyId);
    if (!list || list.length === 0) return;
    queued.delete(lobbyId);
    total -= list.length;
    const now = new Date();
    const key = `${PREFIX}${now.toISOString().slice(0, 10)}/${lobbyId}-${now.getTime()}-${++batch}.jsonl.gz`;
    try {
        const body = await gzipAsync(list.map(i => JSON.stringify(i)).join('\n') + '\n');
        await putBytes(key, body, 'application/gzip');
    } catch (err) {
        console.error(`[incidents] ${key}: not written (${list.length} incident(s)):`, err);
    }
}
