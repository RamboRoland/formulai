// Physics trace: drives every kart through scripted inputs and dumps every
// state field each tick as the exact double bits — proof that a physics
// restructure changes nothing (.claude/tasks/braking-strength.md, R1).
// Usage (from server/; -s keeps npm's header out of the file):
//   npm run -s physics-trace [-- <src dir>] > out.txt   (default: ./src)
// Run it on the old and the new code; `cmp` the two files — no output = identical.
import * as path from 'path';

const SRC = path.resolve(process.argv[2] ?? 'src');
const KARTS = ['HyrkartCentralen', 'Hyrkart270cc', 'Racingkart125cc'];
const DT = 1 / 60;

const dv = new DataView(new ArrayBuffer(8));
const hex = (x: unknown): string => {
    if (typeof x === 'boolean') return x ? 'T' : 'F';
    if (typeof x !== 'number') return String(x);
    dv.setFloat64(0, x);
    return dv.getBigUint64(0).toString(16);
};

const track = {
    startPosition: { x: 10, y: 20 }, startAngle: 15,
    spawn: (len: number, slot: number) => ({ x: 100 + len + slot, y: 50, angle: 30 + slot }),
};

// seeded LCG
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

type Ctl = { forward?: number; backward?: number; steering?: number; brake?: number };
type Scen = { name: string; seconds: number; v0?: number; ctl: (t: number, car: any, i: number) => Ctl; stopEvery?: number; resetAt?: number };

const scenarios = (car: any): Scen[] => {
    const L = car.brakeLock();
    let held: Ctl = {};
    return [
        { name: 'launch+lock', seconds: 11, ctl: t => t < 8 ? { forward: 1 } : { brake: 1 } },
        { name: 'trail', seconds: 10, ctl: t => t < 5 ? { forward: 0.6 } : { brake: 0.5 * L, steering: Math.min(1, (t - 5) / 2) * 0.5 } },
        { name: 'slalom', seconds: 15, ctl: t => ({ forward: t % 3 < 2 ? 0.7 : 0.2, steering: Math.sin(2 * Math.PI * t), brake: t % 3 > 2.5 ? 0.8 * L : 0 }) },
        { name: 'fullslalom', seconds: 10, v0: 55, ctl: t => ({ forward: 1, steering: Math.sign(Math.sin(2 * Math.PI * 1.5 * t)), brake: t > 7 ? 1 : 0 }) },
        { name: 'random', seconds: 25, stopEvery: 97, resetAt: 900, ctl: (t, c, i) => {
            if (i % 18 === 0) held = { forward: rnd() < 0.6 ? rnd() : 0, backward: rnd() < 0.15 ? rnd() : 0, steering: rnd() * 2 - 1, brake: rnd() < 0.4 ? rnd() * 1.2 * L : 0 };
            return held;
        } },
        { name: 'reverse', seconds: 8, ctl: t => t < 3 ? { backward: 1, steering: 0.8 } : t < 4 ? { brake: 1 } : { forward: 1, steering: -0.6 } },
        { name: 'creep', seconds: 8, ctl: t => t < 6 ? { forward: 0.05, steering: 1 } : { brake: 0.3 } },
        { name: 'spin75', seconds: 6, v0: 75, ctl: t => ({ brake: 0.9 * L, steering: t < 1 ? t * 0.7 : 0.7 }) },
        { name: 'lockturn', seconds: 6, v0: 50, ctl: t => ({ brake: t < 2 ? 1.2 * L : 0, steering: -1, forward: t > 3 ? 0.3 : 0 }) },
        { name: 'nan+wild', seconds: 4, v0: 30, ctl: t => ({ forward: 0.5, steering: t < 1 ? NaN : t < 2 ? 5 : -Infinity }) },
        { name: 'stop', seconds: 5, v0: 20, ctl: t => ({ brake: 0.4, steering: 0.3 }) },
    ];
};

const FIELDS = ['x', 'y', 'angle', 'speed', 'lateralSpeed', 'yawRate', 'steeringAngle', 'wheelAngle', 'lateralG', 'longitudinalG',
    'gripFront', 'gripRear', 'slipFront', 'slipRear', 'rearLift', 'loadShareFront', 'loadShareRear', 'longAccel', 'wheelSpin', 'slipRatio',
    'rearLocked', 'hasCollision', 'heading', 'facing', 'spawnId', 'gridSlot'];

const out: string[] = [];
let ticks = 0;
for (const variant of ['rate', 'norate']) {
    for (const k of KARTS) {
        const Cls = require(path.join(SRC, 'game/cars/gokarts', k))[k];
        const car = new Cls(track);
        if (variant === 'norate') car.steeringRate = undefined;
        out.push(`# ${variant} ${k} keys=${Object.keys(car).sort().join(',')}`);
        out.push(`# brakeLock=${hex(car.brakeLock())} wheels=${car.wheels().map(hex).join(',')} lengthPx=${hex(car.lengthPx)} widthPx=${hex(car.widthPx)}`);
        for (const sc of scenarios(car)) {
            car.gridSlot = (car.gridSlot + 1) % 3;
            car.reset();
            if (sc.v0) car.speed = sc.v0;
            const n = Math.round(sc.seconds / DT);
            for (let i = 0; i < n; i++) {
                const c = sc.ctl(i * DT, car, i);
                car.controls = { forward: c.forward ?? 0, backward: c.backward ?? 0, steering: c.steering ?? 0, brake: c.brake ?? 0, restart: false };
                car.applyControls(DT);
                // as GameEngine.tickPlayer (24 px/m)
                const rad = car.angle * Math.PI / 180;
                const fwd = car.speed / 3.6 * 24, side = car.lateralSpeed * 24;
                if (sc.stopEvery && i % sc.stopEvery === sc.stopEvery - 1) car.stopSliding();
                else { car.x += (Math.cos(rad) * fwd - Math.sin(rad) * side) * DT; car.y += (Math.sin(rad) * fwd + Math.cos(rad) * side) * DT; }
                if (sc.resetAt === i) car.reset();
                const vals = FIELDS.map(f => hex(car[f]));
                out.push(`${variant} ${k} ${sc.name} ${i} ${vals.join(' ')} | ${car.scrub().map(hex).join(' ')} | ${car.wheels().map(hex).join(' ')} | ${hex(car.brakeLock())}`);
                ticks++;
            }
        }
    }
}
out.push(`# ticks=${ticks} fields/tick=${FIELDS.length + 4 + 5 + 1}`);
process.stdout.write(out.join('\n') + '\n');
