// Expected lap times for every published track in the DigitalOcean Space
// (the data's source), per layout and kart class:
//
//   npm run laptimes            the table (now → new), nothing written
//   npm run laptimes -- --yes   writes the new values into the Space
//
// A bot drives the real game (LobbyGame, fast: stepped by hand, 1/60 s)
// one lap from pole (a loop's first lap, from the grid): pure pursuit
// along the centreline route from the rear axle (look-ahead max(2.5 m,
// 0.45 s × speed)), corner speed = setting × √(gripG · g · radius) capped
// at maxSpeed, braking planned at what rear-only brakes can do without
// unsettling the kart and done in a straight line (coasting while
// cornering hard — braking there brings the rear round). Settings from flat out down
// to careful; the best run without a collision × 1.3, rounded to 0.1 s
// (method: .claude/tasks/expected-lap-times.md). With --yes only the
// numbers inside each layout's "expectedLapTimes" change — everything
// else stays byte for byte (checked), and a file saved in the Space while
// the bot ran is left alone. The hosted server reads S3 at start →
// restart it to load the new values; `npm run fetch` gets them locally.
import { LobbyGame } from '../src/LobbyGame';
import { registerTracks } from '../src/game/tracks/registry';
import { CAR_CLASSES } from '../src/game/tracks/serialize';
import type { Track } from '../src/game/tracks/Track';
import type { TrackJSON } from '../src/game/tracks/types';
import { rearBrakeLimit, type Car } from '../src/game/cars/Car';
import { readOnlyBucket, writableBucket } from '../src/storage';
import { TRACK_PREFIXES } from '../src/trackStore';
import { spaceSettings } from './space';

const PX = 24; // px per metre
const G = 9.81;
const DT = 1 / 60;
const MAX_SECONDS = 400;
const MARGIN = 1.3;
// Corner speed setting (× the grip limit); 100 = flat out.
const SETTINGS = [100, 3, 2, 1.6, 1.4, 1.3, 1.2, 1.15, 1.1, 1.05, 1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
const BLOCK = /("expectedLapTimes": \{)([^}]*)(\})/g;
// Braking: planned at this share of what rear-only brakes can do while
// staying stable (Car.rearBrakeLimit) — so it's done before the turn-in —
// and pressed harder, at this share of where the rear locks
// (Car.brakeLock): the margin catches the late start; only below this
// share of the kart's grip used sideways.
const BRAKE_PLAN_SHARE = 0.65;
const BRAKE_PRESS_SHARE = 0.7;
const STRAIGHT_LINE_G = 0.5;

function brakeLimit(car: Car): number {
    const slip = car.slip!;
    return rearBrakeLimit(car.gripG, 1 - slip.rearShare, slip.cgHeightMeters / car.wheelbaseMeters);
}

type Point = { x: number; y: number };

// The driving line: the route's legs as one polyline; a loop twice, so the
// look-ahead runs on over the start line.
function drivingLine(track: Track): Point[] {
    const points: Point[] = [];
    for (const leg of track.route?.legs ?? []) for (const p of leg.points) {
        const last = points[points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) points.push({ x: p.x, y: p.y });
    }
    return track.isLoop ? [...points, ...points] : points;
}

// Target speed per point (m/s): corner speed from the radius through the
// points 2 m before and after, then backwards so braking reaches it.
function speedPlan(points: Point[], car: Car, setting: number): number[] {
    const n = points.length, top = car.maxSpeed / 3.6, k = 8; // 8 × 0.25 m
    const v = points.map((_, i) => {
        const a = points[Math.max(0, i - k)], b = points[i], c = points[Math.min(n - 1, i + k)];
        const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        const radius = cross < 1e-6 ? Infinity : (ab * bc * ca) / (2 * cross) / PX;
        return Math.min(top, setting * Math.sqrt(car.gripG * G * radius));
    });
    const brake = Math.min(car.brakeDeceleration / 3.6, BRAKE_PLAN_SHARE * brakeLimit(car));
    for (let i = n - 2; i >= 0; i--) {
        const ds = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y) / PX;
        v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brake * ds));
    }
    return v;
}

// One lap; its time in seconds, null if the car collided or ran out of time.
function drive(trackName: string, layoutId: string, kart: string, setting: number): number | null {
    const game = new LobbyGame({ name: 'Laptimes', displayName: 'Laptimes', cars: [kart], stages: [{ track: trackName, layout: layoutId, laps: 1 }] }, false, true);
    const player = game.addPlayer('bot', 'bot', kart, '#fff');
    game.start();
    const car = player.car;
    const points = drivingLine(car.track);
    if (points.length < 2) return null;
    const plan = speedPlan(points, car, setting);
    let near = 0;
    for (let tick = 0; tick < MAX_SECONDS / DT; tick++) {
        if (player.stage().lapsCompleted >= 1) return player.stage().lapTimes[0];
        if (car.hasCollision) return null;
        const angle = car.angle * Math.PI / 180;
        const cx = car.x + car.widthPx / 2, cy = car.y + car.lengthPx / 2;
        const half = car.wheelbaseMeters / 2 * PX;
        const rx = cx - Math.cos(angle) * half, ry = cy - Math.sin(angle) * half; // rear axle
        let best = Infinity;
        for (let i = near, end = Math.min(points.length, near + 200); i < end; i++) {
            const d = Math.hypot(points[i].x - cx, points[i].y - cy);
            if (d < best) { best = d; near = i; }
        }
        const speed = Math.max(0, car.speed / 3.6);
        const lookAhead = Math.max(2.5, 0.45 * speed) * PX;
        let j = near;
        while (j < points.length - 1 && Math.hypot(points[j].x - rx, points[j].y - ry) < lookAhead) j++;
        const alpha = Math.atan2(points[j].y - ry, points[j].x - rx) - angle;
        const dist = Math.max(Math.hypot(points[j].x - rx, points[j].y - ry), 1);
        const wheel = Math.atan(2 * car.wheelbaseMeters * PX * Math.sin(alpha) / dist) * 180 / Math.PI;
        const target = plan[Math.min(plan.length - 1, near + 4)];
        const forward = speed < target;
        // Brake just below where the rear wheels lock (BRAKE_PRESS_SHARE ×
        // Car.brakeLock), with the rear grip turning leaves (√(1 −
        // gripRear²), as Car.longitudinal does for the gas); only coast while
        // cornering hard (braking there brings the rear round).
        const cornering = Math.abs(car.lateralG) > STRAIGHT_LINE_G * car.gripG;
        game.setControls('bot', {
            forward: forward ? 1 : 0,
            backward: 0,
            brake: !forward && !cornering && speed > target + 0.3 ? BRAKE_PRESS_SHARE * car.brakeLock() * Math.sqrt(Math.max(0, 1 - Math.min(1, car.gripRear) ** 2)) : 0,
            steering: Math.max(-1, Math.min(1, wheel / car.wheelLock)),
            restart: false,
        });
        game.step();
    }
    return null;
}

// The new value for one layout + kart; null if no run was clean.
function expected(trackName: string, layoutId: string, kart: string): number | null {
    let best: number | null = null;
    for (const setting of SETTINGS) {
        const time = drive(trackName, layoutId, kart, setting);
        if (time !== null && (best === null || time < best)) best = time;
    }
    return best === null ? null : Math.round(best * MARGIN * 10) / 10;
}

// `text` with the numbers in each layout's expectedLapTimes block replaced
// (blocks in layout order); throws if anything else would change.
function withTimes(file: string, text: string, json: TrackJSON, times: Record<string, number>[]): string {
    let i = 0;
    const out = text.replace(BLOCK, (_all, open: string, body: string, close: string) => {
        const layout = json.layouts[i];
        const values = times[i++];
        if (!layout || JSON.stringify(JSON.parse(`{${body}}`)) !== JSON.stringify(layout.expectedLapTimes)) throw new Error(`${file}: block ${i} isn't layout ${layout?.name ?? i}`);
        return open + body.replace(/("([A-Za-z0-9]+)": )([0-9.]+)/g, (number: string, key: string, kart: string) => kart in values ? key + JSON.stringify(values[kart]) : number) + close;
    });
    if (i !== json.layouts.length) throw new Error(`${file}: ${i} expectedLapTimes blocks for ${json.layouts.length} layouts`);
    const strip = (t: string) => JSON.stringify({ ...JSON.parse(t), layouts: JSON.parse(t).layouts.map(({ expectedLapTimes, ...rest }: TrackJSON['layouts'][number]) => rest) });
    if (strip(out) !== strip(text)) throw new Error(`${file}: more than expectedLapTimes would change`);
    JSON.parse(out).layouts.forEach((l: TrackJSON['layouts'][number], n: number) => {
        for (const [kart, value] of Object.entries(times[n])) {
            if (l.expectedLapTimes?.[kart] !== value) throw new Error(`${file}: ${l.name} has no "${kart}" in expectedLapTimes (save it in the editor once)`);
        }
    });
    return out;
}

async function main(): Promise<void> {
    const write = process.argv.includes('--yes');
    const space = readOnlyBucket(spaceSettings());
    const files: { key: string; text: string; json: TrackJSON }[] = [];
    for (const { key } of await space.listObjects(TRACK_PREFIXES.published)) {
        if (!key.endsWith('.json')) continue;
        const object = await space.getBytes(key);
        if (!object) continue;
        const text = Buffer.from(object.bytes).toString('utf8');
        files.push({ key, text, json: JSON.parse(text) as TrackJSON });
    }
    registerTracks(files.map(f => f.json));

    const changed: { key: string; before: string; after: string }[] = [];
    let values = 0;
    console.log(`${'track / layout'.padEnd(28)}${CAR_CLASSES.map(k => k.padEnd(22)).join('')}`);
    for (const { key, text, json } of files) {
        const times = json.layouts.map(layout => {
            const row: Record<string, number> = {};
            const cells = CAR_CLASSES.map(kart => {
                const now = layout.expectedLapTimes?.[kart];
                const next = expected(json.name, layout.id, kart);
                if (next === null) return `${now ?? '–'} (no clean run, kept)`.padEnd(22);
                row[kart] = next;
                if (next !== now) values++;
                return `${String(now ?? '–').padStart(5)} → ${String(next).padStart(5)}${next !== now ? ' *' : ''}`.padEnd(22);
            });
            console.log(`${`${json.name} / ${layout.name}`.padEnd(28)}${cells.join('')}`);
            return row;
        });
        const after = withTimes(key, text, json, times);
        if (after !== text) changed.push({ key, before: text, after });
    }
    console.log(`\n${values} value(s) change in ${changed.length} file(s) (* = changed)`);
    if (changed.length === 0) return;
    if (!write) {
        console.log('Nothing written. Write them into the Space: npm run laptimes -- --yes');
        return;
    }
    const target = writableBucket(spaceSettings());
    for (const { key, before, after } of changed) {
        if ((await target.getText(key)) !== before) {
            console.error(`[laptimes] ${key} was saved in the Space while the bot ran — skipped, run again`);
            continue;
        }
        await target.putText(key, after);
        if ((await target.getText(key)) !== after) throw new Error(`${key}: the Space doesn't hold what was written`);
        console.log(`[laptimes] written: ${key}`);
    }
    console.log('[laptimes] restart the hosted server to load them (it reads S3 at start); npm run fetch for local');
}

main().catch(err => {
    console.error(`[laptimes] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
