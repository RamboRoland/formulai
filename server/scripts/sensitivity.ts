// Kart-value sensitivity (plan .claude/tasks/kart-values.md, step 2): each
// value nudged ±10 %, one at a time, and how much the key results move.
// Headless, read-only (tracks from the local S3, nothing written).
//
//   npm run -s sensitivity -- [--kart <name>] [--no-lap] [--scratch <dir>] > out.txt
//
// Results 2026-11-14: .claude/tasks/kart-values-results/.
//
// Per kart values are changed on the car instance after it's built; the
// shared physics constants on a copy of server/src (scratch dir) with the
// constant rewritten. Results per run:
//   L        brakeLock() (pedal at which the rear locks, straight)
//   brakeL   metres to stop from v0 at pedal L (threshold braking)
//   brake1   metres to stop from v0 at the full pedal (locked)
//   trail    max body slip (°) trail braking at 0.6 L into a steady turn
//   trailV   km/h left 1 s into that trail braking
//   top      top speed (km/h, 40 s full gas)
//   accel    0–58 km/h (s)
//   lap      Torslanda GP lap (s): laptimes.ts's bot, best clean run
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { fastestLap } from './lapBot';

const DT = 1 / 60;
const PX = 24, G = 9.81;
const KARTS = ['HyrkartCentralen', 'Hyrkart270cc', 'Racingkart125cc'];
const SRC = path.join(__dirname, '../src');
const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_KART = argOf('--kart');
const LAP = !argv.includes('--no-lap');
const LAP_TRACK = 'Torslanda', LAP_LAYOUT = 'GP';

// ---------------------------------------------------------------- sources
type Source = { classes: Record<string, any>; LobbyGame: any; registry: any; Session: any };
const sources = new Map<string, Source>();
let trackJsons: any[] = [];
const loadSource = (src: string): Source => {
    if (!sources.has(src)) {
        const classes: Record<string, any> = {};
        for (const k of KARTS) classes[k] = require(path.join(src, 'game/cars/gokarts', k))[k];
        const s = { classes, LobbyGame: require(path.join(src, 'LobbyGame')).LobbyGame, registry: require(path.join(src, 'game/tracks/registry')),
            Session: require(path.join(src, 'game/sessions/Session')).Session };
        if (trackJsons.length) s.registry.registerTracks(trackJsons);
        sources.set(src, s);
    }
    return sources.get(src)!;
};
// A copy of server/src with one shared constant rewritten (`const NAME = x;`).
// (node_modules linked in: the copies' imports resolve as server/src's.)
const SCRATCH = fs.mkdtempSync(path.join(argOf('--scratch') ?? os.tmpdir(), 'kart-sensitivity-'));
fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(SCRATCH, 'node_modules'));
const constantSource = (file: string, name: string, factor: number): string => {
    const dir = path.join(SCRATCH, `${name}-${factor}`);
    if (!fs.existsSync(dir)) {
        execSync(`cp -R ${JSON.stringify(SRC)} ${JSON.stringify(dir)}`);
        const f = path.join(dir, file);
        const text = fs.readFileSync(f, 'utf8');
        const re = new RegExp(`(const ${name} = )([0-9.]+)(;)`);
        if (!re.test(text)) throw new Error(`${name} not found in ${file}`);
        fs.writeFileSync(f, text.replace(re, (_a, open, v, close) => open + String(Number(v) * factor) + close));
    }
    return dir;
};

// ---------------------------------------------------------------- values
// Per kart: [label, get(car) → holder, key]; scaled in place.
type Nudge = { label: string; apply: (car: any, factor: number) => boolean };
const field = (label: string, holder: (car: any) => any, key: string): Nudge => ({
    label,
    apply: (car, f) => {
        const h = holder(car);
        if (!h || typeof h[key] !== 'number' || h[key] === 0) return false;
        h[key] *= f;
        return true;
    },
});
const top = (k: string) => field(k, c => c, k);
const slip = (k: string) => field(`slip.${k}`, c => c.slip, k);
const drive = (k: string) => field(`drive.${k}`, c => c.drive, k);
const NUDGES: Nudge[] = [
    top('lengthM'), top('widthM'), top('brakeDeceleration'), top('maxSpeed'), top('gripG'),
    top('steeringLock'), top('steeringRate'), top('wheelLock'), top('wheelbaseMeters'),
    { label: 'tyreWidthMeters', apply: (c, f) => { c.tyreWidthMeters = c.tyreWidthMeters.map((w: number) => w * f); return true; } },
    top('weight'),
    ...['massKg', 'rearShare', 'yawInertia', 'peakSlipDeg', 'slideGrip', 'rearTrackMeters', 'frontTrackMeters',
        'axleStiffness', 'jacking', 'liftSeconds', 'cgHeightMeters', 'loadSensitivity'].map(slip),
    drive('torqueNm'),
    { label: 'drive.torqueCurve', apply: (c, f) => { if (!c.drive.torqueCurve) return false; c.drive.torqueCurve = c.drive.torqueCurve.map(([r, t]: number[]) => [r, t * f]); return true; } },
    ...['powerW', 'gearRatio', 'efficiency', 'wheelRadiusMeters', 'dragArea', 'rollingResistance', 'liftOffG', 'liftOffFromKmh'].map(drive),
];
const CONSTANTS: { label: string; file: string; name: string }[] = [
    { label: 'TRANSFER_SECONDS', file: 'game/cars/physics/loads.ts', name: 'TRANSFER_SECONDS' },
    { label: 'AXLE_INERTIA', file: 'game/cars/physics/rearAxle.ts', name: 'AXLE_INERTIA' },
    { label: 'LIFT_OFF_FADE', file: 'game/cars/physics/drivetrain.ts', name: 'LIFT_OFF_FADE' },
];

// ---------------------------------------------------------------- scenarios
const FAKE_TRACK = { startPosition: { x: 0, y: 0 }, startAngle: 0 };
type Prepare = (car: any) => void;
// A kart class with the nudge applied as it is built: its own class, so
// physics/kartConstants (once per kart class) works its constants out from
// the nudged values.
const variantOf = (src: Source, kart: string, prepare: Prepare): any => {
    const Base = src.classes[kart];
    return class extends Base { constructor(track: any) { super(track); prepare(this); } };
};
const fresh = (Variant: any) => new Variant(FAKE_TRACK);
const step = (car: any, gas: number, brake: number, steering: number) => {
    car.controls = { forward: gas, backward: 0, steering, brake, restart: false };
    car.applyControls(DT);
};
const v0Of = (car: any) => Math.round(car.maxSpeed * 0.9); // nominal, before the nudge (set below)

// Metres to stop from v0 at a fixed pedal.
const stopDistance = (car: any, v0: number, pedal: number): number => {
    car.speed = v0;
    let dist = 0;
    for (let t = 0; t < 15 && Math.hypot(car.speed / 3.6, car.lateralSpeed) > 0.05; t += DT) {
        step(car, 0, pedal, 0);
        dist += Math.hypot(car.speed / 3.6, car.lateralSpeed) * DT;
    }
    return dist;
};
// Trail braking: 0.8 s rolling into a steady turn (gas up), then
// TRAIL_PEDAL × L for 1 s with the steering held (inside the grip budget:
// at the full L the rear goes, at 0.6 g sideways it has ~0.8 L left). Front wheel angle = TRAIL_SHARE of the
// grip at v (L · a / v² + half the peak slip), from the UNCHANGED kart, so
// every nudge drives the same input.
const TRAIL_SHARE = 0.6, TRAIL_PEDAL = 0.6;
const trailWheelDeg = (car: any, v0: number) =>
    car.wheelbaseMeters * TRAIL_SHARE * car.gripG * G / (v0 / 3.6) ** 2 * 180 / Math.PI + car.slip.peakSlipDeg / 2;
const trail = (car: any, v0: number, pedal: number, wheelDeg: number): [number, number] => {
    car.speed = v0;
    const steering = Math.min(1, wheelDeg / car.wheelLock);
    let maxSlip = 0;
    for (let t = 0; t < 1.8; t += DT) {
        step(car, 0, t < 0.8 ? 0 : pedal, steering);
        if (car.speed > 8 && t >= 0.8) maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(car.lateralSpeed, Math.max(car.speed / 3.6, 1e-9)) * 180 / Math.PI));
    }
    return [maxSlip, Math.hypot(car.speed / 3.6, car.lateralSpeed) * 3.6];
};
const accel = (car: any): [number, number] => {
    let t = 0, to58 = NaN, topSpeed = 0;
    for (; t < 40; t += DT) {
        step(car, 1, 0, 0);
        if (isNaN(to58) && car.speed >= 58) to58 = t + DT;
        topSpeed = Math.max(topSpeed, car.speed);
    }
    return [topSpeed, to58];
};

// The lap bot: laptimes.ts's (same plan, look-ahead, braking rule).
const drivingLine = (track: any) => {
    const points: { x: number; y: number }[] = [];
    for (const leg of track.route?.legs ?? []) for (const p of leg.points) {
        const last = points[points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) points.push({ x: p.x, y: p.y });
    }
    return track.isLoop ? [...points, ...points] : points;
};
const speedPlan = (points: { x: number; y: number }[], car: any, setting: number) => {
    const n = points.length, topV = car.maxSpeed / 3.6, k = 8;
    const v = points.map((_, i) => {
        const a = points[Math.max(0, i - k)], b = points[i], c = points[Math.min(n - 1, i + k)];
        const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        const radius = cross < 1e-6 ? Infinity : (ab * bc * ca) / (2 * cross) / PX;
        return Math.min(topV, setting * Math.sqrt(car.gripG * G * radius));
    });
    const brake = Math.min(car.brakeDeceleration / 3.6, 0.65 * car.brakeLock() * car.brakeDeceleration / 3.6);
    for (let i = n - 2; i >= 0; i--) {
        const ds = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y) / PX;
        v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brake * ds));
    }
    return v;
};
const lapOnce = (src: Source, kart: string, Variant: any, setting: number): number | null => {
    const game = new src.LobbyGame({ name: 'S', displayName: 'S', cars: [kart], stages: [{ track: LAP_TRACK, layout: LAP_LAYOUT, laps: 1 }] }, false, true);
    // The game builds its karts in Session.chooseCar: build the variant
    // there for this one player.
    const chooseCar = src.Session.prototype.chooseCar;
    src.Session.prototype.chooseCar = function (_name: string, track: any) { const variant = new Variant(track); variant.reset(); return variant; };
    let player: any;
    try { player = game.addPlayer('bot', 'bot', kart, '#fff'); } finally { src.Session.prototype.chooseCar = chooseCar; }
    const car = player.car;
    game.start();
    const points = drivingLine(car.track);
    if (points.length < 2) return null;
    const plan = speedPlan(points, car, setting);
    let near = 0;
    for (let tick = 0; tick < 400 / DT; tick++) {
        if (player.stage().lapsCompleted >= 1) return player.stage().lapTimes[0];
        if (car.hasCollision) return null;
        const angle = car.angle * Math.PI / 180;
        const cx = car.x + car.widthPx / 2, cy = car.y + car.lengthPx / 2;
        const half = car.wheelbaseMeters / 2 * PX;
        const rx = cx - Math.cos(angle) * half, ry = cy - Math.sin(angle) * half;
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
        const cornering = Math.abs(car.lateralG) > 0.5 * car.gripG;
        game.setControls('bot', {
            forward: forward ? 1 : 0, backward: 0,
            brake: !forward && !cornering && speed > target + 0.3 ? 0.7 * car.brakeLock() : 0,
            steering: Math.max(-1, Math.min(1, wheel / car.wheelLock)), restart: false,
        });
        game.step();
    }
    return null;
};
const lap = (src: Source, kart: string, Variant: any): number =>
    fastestLap(setting => lapOnce(src, kart, Variant, setting)) ?? NaN;

// ---------------------------------------------------------------- one run
type Result = Record<string, number>;
const measure = (src: Source, kart: string, prepare: Prepare, v0: number, wheelDeg: number): Result => {
    const Variant = variantOf(src, kart, prepare);
    const L = fresh(Variant).brakeLock();
    const [trailSlip, trailV] = trail(fresh(Variant), v0 * 0.7, TRAIL_PEDAL * L, wheelDeg);
    const [topSpeed, to58] = accel(fresh(Variant));
    return {
        L, brakeL: stopDistance(fresh(Variant), v0, L), brake1: stopDistance(fresh(Variant), v0, 1),
        trail: trailSlip, trailV, top: topSpeed, accel: to58,
        lap: LAP ? lap(src, kart, Variant) : NaN,
    };
};
const KEYS = ['L', 'brakeL', 'brake1', 'trail', 'trailV', 'top', 'accel', 'lap'];
const pct = (a: number, b: number) => !isFinite(a) || !isFinite(b) ? '   n/a' : b === 0 ? '     0' : `${((a - b) / b * 100 >= 0 ? '+' : '')}${((a - b) / b * 100).toFixed(1)}`.padStart(6);

async function loadTracks(): Promise<void> {
    if (!LAP) return;
    const { readOnlyBucket } = require(path.join(SRC, 'storage'));
    const { config } = require(path.join(SRC, 'config'));
    const bucket = readOnlyBucket(config.s3);
    for (const { key } of await bucket.listObjects('tracks/')) {
        if (!key.endsWith('.json') || key.startsWith('tracks/drafts/')) continue;
        const object = await bucket.getBytes(key);
        if (object) trackJsons.push(JSON.parse(Buffer.from(object.bytes).toString('utf8')));
    }
}

async function main(): Promise<void> {
    await loadTracks();
    const base = loadSource(SRC);
    for (const kart of KARTS.filter(k => !ONLY_KART || k === ONLY_KART)) {
        const v0 = v0Of(new base.classes[kart](FAKE_TRACK));
        const wheelDeg = trailWheelDeg(new base.classes[kart](FAKE_TRACK), v0 * 0.7);
        const baseline = measure(base, kart, () => {}, v0, wheelDeg);
        console.log(`\n## ${kart} (v0 ${v0} km/h, trail from ${Math.round(v0 * 0.7)} km/h, front wheels ${wheelDeg.toFixed(1)}°)`);
        console.log(`baseline: ${KEYS.map(k => `${k} ${baseline[k].toFixed(k === 'L' ? 3 : 2)}`).join(', ')}`);
        console.log(`\n| value | ±10 % | ${KEYS.join(' | ')} |`);
        console.log(`|---|---|${KEYS.map(() => '---:').join('|')}|`);
        const row = (label: string, factor: number, r: Result | null) =>
            console.log(`| ${label} | ${factor > 1 ? '+' : '−'} | ${r ? KEYS.map(k => pct(r[k], baseline[k])).join(' | ') : KEYS.map(() => '0 (value 0 / not set)').join(' | ')} |`);
        for (const nudge of NUDGES) for (const factor of [1.1, 0.9]) {
            const probe = new base.classes[kart](FAKE_TRACK);
            if (!nudge.apply(probe, factor)) { row(nudge.label, factor, null); continue; }
            row(nudge.label, factor, measure(base, kart, car => { nudge.apply(car, factor); }, v0, wheelDeg));
        }
        for (const c of CONSTANTS) for (const factor of [1.1, 0.9]) {
            row(`${c.label} (shared)`, factor, measure(loadSource(constantSource(c.file, c.name, factor)), kart, () => {}, v0, wheelDeg));
        }
    }
    fs.rmSync(SCRATCH, { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
