// Braking / steering test suite: drives the real kart classes (Car.
// applyControls, 1/60 s ticks) headless on an open area — no track, no S3 —
// and prints one table, one row per scenario × kart.
//
//   npm run braking-suite                         this checkout's server/src
//   npm run braking-suite -- --src <dir>          another copy of server/src
//   npm run braking-suite -- --compare <dir>      old (--src) vs new (<dir>) side by side
//   npm run braking-suite -- --only <regex>       scenario ids matching
//   npm run braking-suite -- --sweep              + the 270cc braking sweep grids
//
// Plan: .claude/tasks/braking-strength.md. Earlier scenarios rebuilt from
// the results kept in .claude/tasks/braking-spin.md and analog-pedals.md
// (the old scripts are lost): where the notes give no exact inputs they are
// marked "reconstructed" in the legend.
//
// Conventions: speeds km/h; "w°" = steering-wheel degrees on a rental kart
// (lock 90°, wheels 32°), turned into the same FRONT-wheel angle on every
// kart (Racingkart: lock 60°, wheels 35° → w° × 0.61 on its wheel). "L" =
// the kart's brakeLock() (brake at which the rear locks, gas up). Body slip
// = atan(lateralSpeed / speed along the nose), counted while the kart moves
// faster than 8 km/h (as the live incident analysis). Countersteer = front
// wheels along the travel direction (+ slip → + steering; a wrong sign
// steering into the slide happened before, braking-spin.md).
import * as path from 'path';

const DT = 1 / 60;
const G = 9.81;
const KARTS = ['HyrkartCentralen', 'Hyrkart270cc', 'Racingkart125cc'] as const;
type KartName = typeof KARTS[number];
const SHORT: Record<KartName, string> = { HyrkartCentralen: 'Centralen', Hyrkart270cc: '270cc', Racingkart125cc: 'Racing125' };

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const SRC_A = path.resolve(argOf('--src') ?? path.join(__dirname, '../src'));
const SRC_B = argOf('--compare') ? path.resolve(argOf('--compare')!) : undefined;
const ONLY = argOf('--only') ? new RegExp(argOf('--only')!) : undefined;
const SWEEP = argv.includes('--sweep');

// The Car only needs a start position in its constructor (reset() needs a
// real Track — never called here).
const FAKE_TRACK = { startPosition: { x: 0, y: 0 }, startAngle: 0 };

type Maker = (kart: KartName) => any;
const loadSrc = (src: string): Maker => {
    const classes: Record<string, any> = {};
    for (const k of KARTS) classes[k] = require(path.join(src, 'game/cars/gokarts', k))[k];
    return (kart) => new classes[kart](FAKE_TRACK);
};

// ---------------------------------------------------------------- simulation
type Ctl = { gas?: number; brake?: number; steer?: number };
type St = {
    t: number; car: any;
    v: number;        // km/h, total (along + across)
    vx: number;       // km/h along the nose
    slip: number;     // body slip, degrees (+ = moving right of the nose)
    yaw: number;      // deg/s
    dist: number;     // m travelled
    mark: (name: string) => void;
};
type Snap = { t: number; dist: number; v: number; maxSlip: number };
type Out = {
    t: number; dist: number; v: number; v0: number;
    maxSlip: number; maxYaw: number; peakDecelG: number;
    marks: Record<string, Snap>;
    end: St;
};

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
// w° (rental steering-wheel degrees) → this kart's steering -1..1 (same front-wheel angle).
const wheel = (car: any, w: number) => clamp(w * 32 / 90 / car.wheelLock);
const lockOf = (car: any): number => car.brakeLock();

// Gs alarm (braking-strength.md point 7, every scenario): what the kart
// feels (car.longitudinalG / lateralG), sustained ≥ 0.2 s (12 ticks in a
// row, while > 8 km/h), beyond braking / cornering limits or outside the ellipse through
// them + GS_MIX_MARGIN ((brk / brkMax)² + (lat / latMax)² > (1 + margin)²).
// Limits: Racingkart 1.1 / 1.8 g (measured 0.8–1.0 / ~1.5–1.7 + margin);
// rental 0.8 / 1.35 g (estimates; braking 0.8 = rear-only ~0.55–0.6 g + the
// front tyres' cornering drag, up to ~0.2 g with the wheels turned — the
// baseline reaches 0.75 g sustained braking while steering, GS-EDGE).
const GS_LIMITS: Record<KartName, [number, number]> = { HyrkartCentralen: [0.8, 1.35], Hyrkart270cc: [0.8, 1.35], Racingkart125cc: [1.1, 1.8] };
const GS_MIX_MARGIN = 0.1; // baseline KB-bend (full lock + brake, front ploughs): brk 0.78 + lat 0.59 g = ellipse 1.06, total 0.97 g < gripG 1.15
const SUSTAIN = 12;
let alarmCtx: { kart: KartName; id: string; side: 'old' | 'new' } | undefined;
const alarms: Record<'old' | 'new', Map<string, string>> = { old: new Map(), new: new Map() };
// Runs one scenario: the driver returns the controls each tick, null = stop.
const run = (car: any, v0: number, driver: (s: St) => Ctl | null, maxT = 6): Out => {
    car.speed = v0;
    let x = 0, y = 0, dist = 0, t = 0, maxSlip = 0, maxYaw = 0, peakDecel = 0;
    let runBrk = 0, runLat = 0, runMix = 0;
    const alarm = (what: string) => {
        if (!alarmCtx) return;
        const key = `${alarmCtx.id} ${SHORT[alarmCtx.kart]} ${what.split(' ')[0]}`;
        const m = alarms[alarmCtx.side];
        if (!m.has(key)) m.set(key, what);
    };
    const marks: Record<string, Snap> = {};
    const state = (): St => {
        const vx = car.speed / 3.6, vy = car.lateralSpeed;
        const v = Math.hypot(vx, vy) * 3.6;
        return {
            t, car, v, vx: car.speed, dist,
            slip: Math.atan2(vy, Math.max(vx, 1e-9)) * 180 / Math.PI,
            yaw: car.yawRate * 180 / Math.PI,
            mark: (n) => { if (!marks[n]) marks[n] = { t, dist, v, maxSlip }; },
        };
    };
    let s = state();
    while (t < maxT) {
        const c = driver(s);
        if (!c) break;
        car.controls = { forward: c.gas ?? 0, backward: 0, steering: c.steer ?? 0, brake: c.brake ?? 0, restart: false };
        const vBefore = s.v;
        car.applyControls(DT);
        const rad = car.angle * Math.PI / 180, fwd = car.speed / 3.6, side = car.lateralSpeed;
        const dx = (Math.cos(rad) * fwd - Math.sin(rad) * side) * DT, dy = (Math.sin(rad) * fwd + Math.cos(rad) * side) * DT;
        x += dx; y += dy; dist += Math.hypot(dx, dy); t += DT;
        s = state();
        if (s.v > 8) maxSlip = Math.max(maxSlip, Math.abs(s.slip));
        maxYaw = Math.max(maxYaw, Math.abs(s.yaw));
        peakDecel = Math.max(peakDecel, (vBefore - s.v) / 3.6 / DT / G);
        if (alarmCtx && s.v > 8) { // as the slip: the kinematic blend below
            const [bMax, lMax] = GS_LIMITS[alarmCtx.kart];
            const brk = Math.max(0, -car.longitudinalG), lat = Math.abs(car.lateralG);
            runBrk = brk > bMax ? runBrk + 1 : 0;
            runLat = lat > lMax ? runLat + 1 : 0;
            runMix = (brk / bMax) ** 2 + (lat / lMax) ** 2 > (1 + GS_MIX_MARGIN) ** 2 ? runMix + 1 : 0;
            if (runBrk === SUSTAIN) alarm(`braking ${f2(brk)} g > ${bMax} at t ${f2(t)} s`);
            if (runLat === SUSTAIN) alarm(`cornering ${f2(lat)} g > ${lMax} at t ${f2(t)} s`);
            if (runMix === SUSTAIN) alarm(`mix brk ${f2(brk)} + lat ${f2(lat)} g outside the ellipse at t ${f2(t)} s`);
        }
        if (s.v <= 0 && car.speed <= 0) { s.mark('stop'); }
    }
    return { t, dist, v: s.v, v0, maxSlip, maxYaw, peakDecelG: peakDecel, marks, end: s };
};

// The catch (driver's view, braking-spin.md): brake off fully, front wheels
// along the slide (countersteer), a little gas.
const catchCtl = (s: St): Ctl => ({ brake: 0, gas: 0.2, steer: clamp(s.slip / s.car.wheelLock) });

// The App's steering aid: the wheel angle of the tightest grip-limited
// circle + the tyres' peak slip (KeyboardControls.steeringLimit).
const aid = (car: any, kmh: number) => {
    const v = Math.abs(kmh) / 3.6;
    if (v < 1) return 1;
    return Math.min(1, (car.wheelbaseMeters * car.gripG * G / (v * v) * 180 / Math.PI + car.slip.peakSlipDeg) / car.wheelLock);
};

// ---------------------------------------------------------------- results
type Status = 'PASS' | '≈' | 'FAIL' | 'INFO' | 'ALLOWED';
type Res = { result: string; status: Status };
const RANK: Record<Status, number> = { PASS: 3, '≈': 2, INFO: 2, ALLOWED: 2, FAIL: 1 };
// ≤ pass → PASS, ≤ approx → ≈, else FAIL.
const upTo = (v: number, pass: number, approx: number): Status => v <= pass ? 'PASS' : v <= approx ? '≈' : 'FAIL';
// In [lo, hi] → PASS, within tol → ≈.
const within = (v: number, lo: number, hi: number, tol: number): Status =>
    v >= lo && v <= hi ? 'PASS' : v >= lo - tol && v <= hi + tol ? '≈' : 'FAIL';
const f0 = (n: number) => n.toFixed(0), f1 = (n: number) => n.toFixed(1), f2 = (n: number) => n.toFixed(2);
const slipYaw = (o: Out) => `slip ${f0(o.maxSlip)}° yaw ${f0(o.maxYaw)}°/s`;

type Scenario = {
    id: string;
    karts?: KartName[];
    setup: string | ((k: KartName) => string);
    criterion: string | ((k: KartName) => string);
    source: string;   // legend: source + confidence, or "reconstructed"
    run: (make: () => any, kart: KartName) => Res;
};

// ---------------------------------------------------------------- 1. stopping table
const STOP_CASES: { id: string; from: (k: KartName, car: any) => number; to: number; karts?: KartName[] }[] = [
    { id: 'top', from: (_k, car) => car.maxSpeed, to: 0 },
    { id: '50', from: () => 50, to: 0 },
    { id: '100', from: () => 100, to: 0, karts: ['Racingkart125cc'] },
    { id: '106-46', from: () => 106, to: 46, karts: ['Racingkart125cc'] },
];
// Pedal modes: keyboard (Space: ramps 0 → 0.8 L in 0.6 s, KeyboardControls),
// 0.8 L / just below L / full (locked) as steps.
const STOP_MODES: { id: string; pedal: (L: number, t: number) => number }[] = [
    { id: 'kbd', pedal: (L, t) => Math.min(0.8 * L, 0.8 * L * t / 0.6) },
    { id: '0.8L', pedal: (L) => 0.8 * L },
    { id: 'L', pedal: (L) => 0.999 * L },
    { id: 'full', pedal: () => 1 },
];
const stopScenarios: Scenario[] = STOP_CASES.flatMap(c => STOP_MODES.map((m): Scenario => ({
    id: `STOP ${c.id} ${m.id}`,
    karts: c.karts,
    setup: (k) => `${c.id === 'top' ? 'top' : c.id.split('-')[0]}→${c.to} km/h straight, brake ${m.id === 'kbd' ? 'kbd ramp 0.6 s→0.8L' : m.id}`,
    criterion: c.id === '106-46' && m.id === 'L' ? 'Vroomkart 39.1 m (±10 % PASS, ±25 % ≈)'
        : c.id === '100' && m.id === 'L' ? 'peak total ≈0.8 g (±0.1 PASS, ±0.2 ≈)'
        : 'report (no data)',
    source: c.id === '106-46' ? 'Vroomkart test FA/ROK 125, rear brake only, 106→46 km/h 39.1 m, avg 0.92 g, peak 1.0 g; sensor unclear (medium-low, braking-strength.md phase 1)'
        : c.id === '100' ? 'KartPulse forum, Rotax Senior logger GPS_LonAcc ~0.8 g peak (one post, GPS-derived = smoothed peaks; low-medium); vendor "0.8–1.2 g braking" (Harris Race Radios guide, class unstated, low)'
        : 'rental karts: no measured data; 50→0 kbd 2026-11-10 record 23.4 / 24.9 / 22.3 m (analog-pedals.md, older physics)',
    run: (make, kart) => {
        const car = make();
        const L = lockOf(car), v0 = c.from(kart, car);
        let locked = false;
        const o = run(car, v0, (s) => {
            if (s.v <= c.to + 1e-9 || (c.to === 0 && car.speed <= 0)) { s.mark('end'); return null; }
            if (car.rearLocked) locked = true;
            return { brake: m.pedal(L, s.t) };
        }, 20);
        const avg = (v0 - Math.max(o.v, c.to)) / 3.6 / o.t / G;
        const result = `${f1(o.dist)} m ${f2(o.t)} s avg ${f2(avg)} g peak ${f2(o.peakDecelG)} g${locked ? ' LOCK' : ''} slip ${f0(o.maxSlip)}°`;
        let status: Status = 'INFO';
        if (c.id === '106-46' && m.id === 'L') status = within(o.dist, 39.1 * 0.9, 39.1 * 1.1, 39.1 * 0.15);
        if (c.id === '100' && m.id === 'L') status = within(o.peakDecelG, 0.7, 0.9, 0.1);
        if (o.maxSlip > 2) status = 'FAIL'; // braking exactly straight must stay straight (H1)
        return { result, status };
    },
})));

// ---------------------------------------------------------------- 2. trail braking
// Heavy braking straight at 0.9 L down to the turn-in speed, then over T s
// the brake goes linearly 0.9 L → 0 while the steering grows 0 → the App's
// steering aid at the current speed (the tightest grip-limited line); the
// apex = the brake reaching 0; then 1 s holding that line, gas 0.
const TB_SPEEDS: Record<KartName, [number, number]> = {
    HyrkartCentralen: [58, 38], Hyrkart270cc: [78, 45], Racingkart125cc: [105, 65],
};
const tbScenarios: Scenario[] = [0.5, 1.0].map((T): Scenario => ({
    id: `TB ${T}s`,
    setup: (k) => `${TB_SPEEDS[k][0]}→${TB_SPEEDS[k][1]} at 0.9L straight; release 0.9L→0 over ${T} s while steering 0→aid; 1 s hold`,
    criterion: 'UNSOURCED: slip ≤ 12° PASS, ≤ 25° ≈ (catchable), else FAIL; distance/speed report',
    source: 'no measured trail-braking data for karts (purpl.app coach quote: release takes "0.1, 0.2 s", releases end 0–11 m before the slowest point, class unstated; low). Speeds reconstructed: entry ≈ top, turn-in ≈ hairpin + 5–15 km/h (Robin\'s Torslanda table, unsourced)',
    run: (make, kart) => {
        const car = make();
        const L = lockOf(car);
        const [v0, vTurn] = TB_SPEEDS[kart];
        let tTurn = -1;
        const o = run(car, v0, (s) => {
            if (tTurn < 0) {
                if (s.vx > vTurn) return { brake: 0.9 * L };
                tTurn = s.t; s.mark('turn');
            }
            const u = (s.t - tTurn) / T;
            if (u >= 1) s.mark('apex');
            if (u >= 1 + 1 / T) return null;
            return { brake: 0.9 * L * Math.max(0, 1 - u), steer: Math.min(1, u) * aid(car, s.vx) };
        }, 12);
        const turn = o.marks.turn, apex = o.marks.apex ?? o.marks.turn;
        const status = upTo(o.maxSlip, 12, 25);
        return {
            result: `apex at ${f1(apex.dist)} m, ${f0(apex.v)} km/h (−${f0(turn.v - apex.v)} after turn-in), ${slipYaw(o)}, end ${f0(o.v)}`,
            status,
        };
    },
}));

// ---------------------------------------------------------------- 2b. scoreboard 4 + 5 (braking-strength.md, report only)
// LOCK-TIP: full brake (1.0) from the start with a constant FRONT wheel
// angle. Reaction time (Robin): rotation 0.3 s and 0.5 s after the rear
// LOCKS (first tick car.rearLocked, or body slip ≥ 2° if that comes first)
// — the largest body slip so far and the heading change (nose angle since
// the lock; includes the turn the steering asks for). Straight = body slip
// < 5° up to 0.5 s (UNSOURCED proposal: a driver who releases
// within reaction time still has the kart pointing down the road; the
// catch tests show < ~5–8° is caught at once). Per speed: the largest
// straight angle and the first angle that isn't, with slip / heading at
// 0.3 / 0.5 s. Info column (as before): locked until it stops — the largest
// angle with slip < 15° and the first > 45°.
const TIP_ANGLES = [0, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
const TIP_STRAIGHT = 5;
const lockTip: Scenario = {
    id: 'LOCK-TIP',
    setup: (k) => `brake 1.0 + constant front wheel w (0–30°), from ${k === 'Racingkart125cc' ? '30/50/75/100' : k === 'HyrkartCentralen' ? '30/50/60' : '30/50/75'} km/h`,
    criterion: `report: straight = max body slip < ${TIP_STRAIGHT}° within 0.5 s of the lock (UNSOURCED); "≤a° (…) → b° (…)", (…) = slip/heading at 0.3 s, 0.5 s; [until stop: <15° ≤x°, >45° ≥y°]`,
    source: 'braking-strength.md scoreboard 4 (Robin 1b / 2b: tipping point within reaction time, from the physics); no measured kart data',
    run: (make, kart) => {
        const speeds = kart === 'Racingkart125cc' ? [30, 50, 75, 100] : [30, 50, 75];
        const parts: string[] = [];
        for (const v0raw of speeds) {
            let straight = -1, tip = -1, tipTxt = '', strTxt = '', stopStraight = -1, stopSpin = -1;
            for (const w of TIP_ANGLES) {
                const c = make(); const v0 = capV(c, v0raw);
                let tLock = -1, a0 = 0, peak = 0, at3: [number, number] | null = null, at5: [number, number] | null = null;
                const o = run(c, v0, (s) => {
                    if (c.speed <= 0) return null;
                    // The lock, or the rear letting go before the lock flag
                    // (the spinning-wheel model can slide first).
                    if (tLock < 0 && (c.rearLocked || Math.abs(s.slip) >= 2)) { tLock = s.t; a0 = c.angle; }
                    if (tLock >= 0) {
                        const hd = ((c.angle - a0 + 540) % 360) - 180;
                        peak = Math.max(peak, Math.abs(s.slip));
                        if (!at3 && s.t >= tLock + 0.3) at3 = [peak, hd];
                        if (!at5 && s.t >= tLock + 0.5) at5 = [peak, hd];
                    }
                    return { steer: clamp(w / c.wheelLock), brake: 1 };
                }, 6);
                if (o.maxSlip < 15 && stopSpin < 0) stopStraight = w;
                if (stopSpin < 0 && o.maxSlip > 45) stopSpin = w;
                const t3 = at3 as [number, number] | null, t5 = at5 as [number, number] | null;
                const txt = t3 && t5 ? `${f0(Math.abs(t3[0]))}/${f0(Math.abs(t3[1]))}°, ${f0(Math.abs(t5[0]))}/${f0(Math.abs(t5[1]))}°` : 'no lock ≥0.5 s';
                if (tip < 0) {
                    if (!t5 || Math.abs(t5[0]) < TIP_STRAIGHT) { straight = w; strTxt = txt; }
                    else { tip = w; tipTxt = txt; }
                }
            }
            const v0 = capV(make(), v0raw);
            parts.push(`${v0}: ≤${straight}° (${strTxt}) → ${tip < 0 ? 'none' : `${tip}° (${tipTxt})`} [stop ≤${stopStraight}/≥${stopSpin < 0 ? '–' : stopSpin}]`);
        }
        return { result: parts.join('; '), status: 'INFO' };
    },
};

// LOCK-DRIVER: LOCK-TIP with a driver correcting (Robin 2c). Brake 1.0
// from the start and kept on (the lock continues); front wheel held at w°
// until REACTION s after the cue (body slip ≥ CUE_SLIP), then the driver steers the front wheels against the rotation:
// wheel angle = body slip (wheels along the travel direction, + slip → +
// steering, as the catch) − YAW_GAIN × yaw rate, clamped to the lock; the
// kart's steeringRate limits how fast the wheel turns. Straight-ish = body
// slip < 10° (UNSOURCED). Per speed and w: max body slip in the first 1 s
// after the cue, and until the stop (> 8 km/h); no cue = it never rotated.
// The driver's cue = the rotation he feels: body slip ≥ CUE_SLIP (the same
// cue in every model — the lock flag comes at different moments: at once in
// today's model, after the wheel slows in a spinning-wheel model).
const CUE_SLIP = 2;    // ° (UNSOURCED)
const REACTION = 0.2;  // s (UNSOURCED: typical simple reaction time ~0.2 s; a braced driver)
const YAW_GAIN = 0.05; // ° of front wheel per °/s of yaw rate (UNSOURCED: damping term; 100°/s → 5°)
const DRIVER_ANGLES = [0.25, 1, 3];
const lockDriver: Scenario = {
    id: 'LOCK-DRIVER',
    setup: (k) => `brake 1.0 held, wheel w 0.25/1/3° until ${REACTION} s after the cue (slip ≥ ${CUE_SLIP}°), then countersteer (slip − ${YAW_GAIN}·yaw), from ${k === 'HyrkartCentralen' ? '30/50/60' : k === 'Hyrkart270cc' ? '30/50/75' : '30/50/75/100'} km/h`,
    criterion: 'report: "w: max slip 1 s / until stop", ✓ = both < 10° (UNSOURCED straight-ish)',
    source: 'braking-strength.md 2c (Robin): lock tipping point with a correcting driver; reaction 0.2 s + gain unsourced',
    run: (make, kart) => {
        const speeds = kart === 'Racingkart125cc' ? [30, 50, 75, 100] : [30, 50, 75];
        const parts: string[] = [];
        for (const v0raw of speeds) {
            const cells: string[] = [];
            for (const w of DRIVER_ANGLES) {
                const c = make(); const v0 = capV(c, v0raw);
                let tLock = -1, max1 = 0, maxAll = 0;
                run(c, v0, (s) => {
                    if (c.speed <= 0) return null;
                    if (tLock < 0 && Math.abs(s.slip) >= CUE_SLIP) tLock = s.t;
                    if (tLock >= 0 && s.v > 8) {
                        maxAll = Math.max(maxAll, Math.abs(s.slip));
                        if (s.t <= tLock + 1) max1 = Math.max(max1, Math.abs(s.slip));
                    }
                    const react = tLock >= 0 && s.t >= tLock + REACTION;
                    const steerDeg = react ? s.slip - YAW_GAIN * s.yaw : w;
                    return { steer: clamp(steerDeg / c.wheelLock), brake: 1 };
                }, 8);
                cells.push(`${w}°: ${f0(max1)}/${f0(maxAll)}°${max1 < 10 && maxAll < 10 ? ' ✓' : ''}`);
            }
            parts.push(`${capV(make(), v0raw)}: ${cells.join(', ')}`);
        }
        return { result: parts.join('; '), status: 'INFO' };
    },
};

// TB-CATCH: the TB runs plus two overdone versions, catch once |slip| >
// 15°; caught = |slip| < 5° and |yaw| < 30°/s; until 1.5 s after the apex.
// - overdone brake: released from 1.1 L (past the lock), steering to 1.3 ×
//   the aid; the driver's catch (brake off, countersteer, gas 0) → caught?
// - overdone steer: IDENTICAL pedals to the clean run (0.9 L release, gas 0
//   throughout), steering to 1.5 × the aid; the catch only countersteers
//   (pedals stay on the schedule) → km/h lost = clean − overdone at the same
//   distance (≥ 0 = the overdone turn-in / slide cost speed). The clean run
//   gets the same countersteer-only catch if it slides.
const tbCatch = (T: number): Scenario => ({
    id: `TB-CATCH ${T}s`,
    setup: (k) => `${TB_SPEEDS[k][0]}→${TB_SPEEDS[k][1]} as TB ${T}s; over-brake = 1.1L + 1.3 × aid, catch brake off + countersteer, gas 0; over-steer = same pedals, 1.5 × aid, countersteer only`,
    criterion: 'report: caught?, peak slip / rotation °/s, km/h lost vs clean (same pedals); Robin judges (edgy, catchable, costs speed)',
    source: 'braking-strength.md scoreboard 5 (Robin 1b); catch = braking-spin.md driver catch (gas 0 here); unsourced',
    run: (make, kart) => {
        const go = (brakeK: number, steerK: number, release: boolean) => {
            const car = make();
            const L = lockOf(car);
            const [v0, vTurn] = TB_SPEEDS[kart];
            let tTurn = -1, catchFrom = -1, caughtAt = -1;
            const trace: [number, number][] = [];
            const o = run(car, v0, (s) => {
                trace.push([s.dist, s.v]);
                if (tTurn < 0) {
                    if (s.vx > vTurn) return { brake: 0.9 * L };
                    tTurn = s.t;
                }
                const u = (s.t - tTurn) / T;
                if (u >= 1 + 1.5 / T || car.speed <= 0) return null;
                const brake = brakeK * L * Math.max(0, 1 - u);
                if (catchFrom >= 0 || Math.abs(s.slip) > 15) {
                    if (catchFrom < 0) catchFrom = s.t;
                    if (caughtAt < 0 && s.t > catchFrom + 0.05 && Math.abs(s.slip) < 5 && Math.abs(s.yaw) < 30) caughtAt = s.t;
                    return { brake: release ? 0 : brake, gas: 0, steer: clamp(s.slip / s.car.wheelLock) };
                }
                return { brake, steer: clamp(Math.min(1, u) * aid(car, s.vx) * steerK) };
            }, 12);
            return { o, trace, caught: catchFrom < 0 ? 'no catch needed' : caughtAt < 0 ? 'NOT caught' : `caught ${f2(caughtAt - catchFrom)} s` };
        };
        const clean = go(0.9, 1, false), overB = go(1.1, 1.3, true), overS = go(0.9, 1.5, false);
        const at = (tr: [number, number][], d: number) => { for (const [x, v] of tr) if (x >= d) return v; return tr[tr.length - 1][1]; };
        const d = Math.min(clean.o.dist, overS.o.dist);
        const lost = at(clean.trace, d) - at(overS.trace, d);
        return {
            result: `clean: ${clean.caught}, ${slipYaw(clean.o)}; over-brake: ${overB.caught}, ${slipYaw(overB.o)}; over-steer: ${overS.caught}, ${slipYaw(overS.o)}, lost ${f1(lost)} km/h at ${f0(d)} m`,
            status: 'INFO',
        };
    },
});

// GS-EDGE (braking-strength.md point 7): the most Gs the kart feels for
// each mix of braking and cornering. From 60 km/h (Racing125: 70), constant
// front wheel angle × constant brake pedal (0 = gas holds the speed), 1.5 s;
// every 0.2 s window's mean (braking g, |lateral g|) while > 15 km/h. Edge:
// braking-only max (|lat| < 0.1 g), cornering max, and the most braking
// found with lateral ≥ 25 / 50 / 75 % of the cornering max.
const GS_WHEELS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
const GS_BRAKES = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 1.0];
const gsEdge: Scenario = {
    id: 'GS-EDGE',
    setup: (k) => `from ${k === 'Racingkart125cc' ? 70 : 60} km/h: front wheel 0–20° × brake 0–1.0, 1.5 s; 0.2 s windows`,
    criterion: 'report: Racing125 brk ~0.8–1.0 g, lat ~1.5–1.7 g, smooth flattened shape between (rear-only brakes); rental report',
    source: 'braking-strength.md point 7 (coordinator); Racing125 targets: KartPulse logger ~0.8 g, Vroomkart 1.0 g peak; D5 slicks 1.5–1.7 g (tyre-slip-steering.md)',
    run: (make, kart) => {
        const pts: [number, number][] = [];
        for (const w of GS_WHEELS) for (const b of GS_BRAKES) {
            const c = make(); const v0 = capV(c, kart === 'Racingkart125cc' ? 70 : 60);
            const win: [number, number][] = [];
            run(c, v0, (s) => {
                if (s.t > 0) {
                    win.push([Math.max(0, -c.longitudinalG), Math.abs(c.lateralG)]);
                    if (win.length > SUSTAIN) win.shift();
                    if (win.length === SUSTAIN && s.v > 15) pts.push([win.reduce((a, p) => a + p[0], 0) / SUSTAIN, win.reduce((a, p) => a + p[1], 0) / SUSTAIN]);
                }
                return { steer: clamp(w / c.wheelLock), brake: b, gas: b === 0 ? clamp(0.3 + (v0 - s.vx) * 0.2, 0, 1) : 0 };
            }, 1.5);
        }
        const latMax = Math.max(...pts.map(p => p[1]));
        const brkAt = (lo: number, hi = Infinity) => Math.max(0, ...pts.filter(p => p[1] >= lo && p[1] < hi).map(p => p[0]));
        const brk0 = brkAt(0, 0.1);
        return {
            result: `brk ${f2(brk0)} g; lat max ${f2(latMax)} g; brk at lat ≥25/50/75 %: ${f2(brkAt(0.25 * latMax))} / ${f2(brkAt(0.5 * latMax))} / ${f2(brkAt(0.75 * latMax))} g`,
            status: 'INFO',
        };
    },
};

// ---------------------------------------------------------------- 3. earlier scenarios (braking-spin.md)
// Turn-in speed for scenarios given at a rental speed: the Centralen tops at 60.
const capV = (car: any, v: number) => Math.min(v, car.maxSpeed);
// Holds the steering at w° (the server's steeringRate turns the wheel).
const hold = (w: number, brake: (car: any) => number, gas = 0) => (s: St): Ctl => ({ steer: wheel(s.car, w), brake: brake(s.car), gas });

// Catch after a disturbance: from tCatch (or once |slip| > 8° after it), the
// catch controller; caught = |slip| < 5° and |yaw| < 30°/s.
const withCatch = (before: (s: St) => Ctl, tCatch: number) => {
    let caughtAt = -1, catchFrom = -1;
    const driver = (s: St): Ctl => {
        if (s.t < tCatch) return before(s);
        if (catchFrom < 0) catchFrom = s.t;
        if (caughtAt < 0 && s.t > catchFrom + 0.05 && Math.abs(s.slip) < 5 && Math.abs(s.yaw) < 30) caughtAt = s.t;
        return catchCtl(s);
    };
    return { driver, caught: () => (caughtAt < 0 ? Infinity : caughtAt - catchFrom) };
};

const earlier: Scenario[] = [
    {
        id: 'A', setup: '75, 0.9L + w 5°, 2.5 s', criterion: 'spin allowed (Robin 2026-11-11)',
        source: 'braking-spin.md case A; critical speed ~50 km/h at 0.9 L (Gillespie ch. 3)',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, capV(c, 75), hold(5, () => 0.9 * L), 2.5); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    {
        id: 'A1', setup: '75, 0.9L + w 2°, 2.5 s', criterion: 'clean < 15° wanted; spin allowed since A1 failed at every jacking k (Robin 2026-11-11)',
        source: 'braking-spin.md A1 (Robin), then "A and L2 → spin allowed"',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, capV(c, 75), hold(2, () => 0.9 * L), 2.5); return { result: slipYaw(o), status: o.maxSlip < 15 ? 'PASS' : 'ALLOWED' }; },
    },
    {
        id: 'A-limit', setup: '75, 0.9L, w 0–15° step 0.5', criterion: 'report: largest w° with slip < 15°',
        source: 'braking-spin.md A-limit (report only)',
        run: (make) => {
            let best = -1;
            for (let w = 0; w <= 15; w += 0.5) {
                const c = make(); const L = lockOf(c);
                if (run(c, capV(c, 75), hold(w, () => 0.9 * L), 2.5).maxSlip < 15) best = w; else break;
            }
            return { result: best < 0 ? 'none' : `w ${best}°`, status: 'INFO' };
        },
    },
    {
        id: 'B', setup: '75, locked (1.0) + w 10°, 2.5 s', criterion: 'snap spin allowed',
        source: 'braking-spin.md test case 2 (Robin\'s table: over 10° or locked → snap spin)',
        run: (make) => { const c = make(); const o = run(c, capV(c, 75), hold(10, () => 1), 2.5); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    {
        id: 'C', setup: '30, 0.3L + w 40°, 2 s', criterion: 'rotates a little, no spin: slip < 15° (≈ < 25°)',
        source: 'braking-spin.md test case 3 (Robin, unsourced)',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, 30, hold(40, () => 0.3 * L), 2); return { result: slipYaw(o), status: upTo(o.maxSlip, 15, 25) }; },
    },
    {
        id: 'C3/#10', setup: '27, 0.74L + w 73° 0.5 s, then catch', criterion: 'mild + caught: slip < 15° (≈ < 30°); record 270cc 8° / 80°/s',
        source: 'live event #10 (pedals recorded) + driver; inputs after 0.5 s reconstructed',
        run: (make) => {
            const c = make(); const L = lockOf(c);
            const k = withCatch(hold(73, () => 0.74 * L), 0.5);
            const o = run(c, 27, k.driver, 2.5);
            return { result: `${slipYaw(o)} caught ${isFinite(k.caught()) ? f2(k.caught()) + ' s' : 'no'}`, status: isFinite(k.caught()) ? upTo(o.maxSlip, 15, 30) : 'FAIL' };
        },
    },
    {
        id: '#4', setup: '26, w 67°, brake 1.0 0.2 s then 0.74L, 1.5 s', criterion: 'locked → spin allowed; record 29° / 178°/s',
        source: 'live event #4; "short locked stab, then 0.4" — durations reconstructed',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, 26, (s) => ({ steer: wheel(c, 67), brake: s.t < 0.2 ? 1 : 0.74 * L }), 1.5); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    {
        id: '#6', setup: '25, w 50°, brake 1.0 0.2 s, then 0.74L + catch steering', criterion: 'no spin: slip < 15° (≈ < 30°); record 6°',
        source: 'live event #6; speed / wheel reconstructed',
        run: (make) => {
            const c = make(); const L = lockOf(c);
            const o = run(c, 25, (s) => s.t < 0.2 ? { steer: wheel(c, 50), brake: 1 } : { steer: clamp(s.slip / c.wheelLock), brake: 0.74 * L }, 2);
            return { result: slipYaw(o), status: upTo(o.maxSlip, 15, 30) };
        },
    },
    {
        id: 'F', setup: '30, 0.9L + w 40° to a stop, +1 s', criterion: 'standing: gripRear < 0.05, yaw < 1°/s',
        source: 'braking-spin.md test case F',
        run: (make) => {
            const c = make(); const L = lockOf(c); let tStop = -1;
            const o = run(c, 30, (s) => { if (tStop < 0 && c.speed <= 0) tStop = s.t; if (tStop >= 0 && s.t > tStop + 1) return null; return { steer: wheel(c, 40), brake: 0.9 * L }; }, 8);
            const ok = c.gripRear < 0.05 && Math.abs(o.end.yaw) < 1;
            return { result: `gripRear ${f2(c.gripRear)} yaw ${f1(o.end.yaw)}°/s`, status: ok ? 'PASS' : 'FAIL' };
        },
    },
    {
        id: 'S1', setup: 'sweeper 70, w 15°, 0.1L, 2 s', criterion: 'smooth: slip < 10° (≈ < 15°)',
        source: 'driver S1, Robin\'s table (sweeper 0–10 % brake, 10–20° smooth); reconstructed',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, capV(c, 70), hold(15, () => 0.1 * L), 2); return { result: slipYaw(o), status: upTo(o.maxSlip, 10, 15) }; },
    },
    {
        id: 'S2', setup: '65, w 45° no brake, 2 s', criterion: 'pushes, no spin: slip < 15° (≈ < 25°)',
        source: 'driver S2 ("too much lock at 65"); reconstructed',
        run: (make) => { const c = make(); const o = run(c, capV(c, 65), hold(45, () => 0), 2); return { result: `${slipYaw(o)} end ${f0(o.v)}`, status: upTo(o.maxSlip, 15, 25) }; },
    },
    {
        id: 'S3', setup: '60, w 20° gas 1 for 1 s, lift to 0, 1.5 s', criterion: 'lift-off: slip < 15° (≈ < 25°)',
        source: 'driver S3 ("lift"); reconstructed',
        run: (make) => { const c = make(); const o = run(c, capV(c, 60), (s) => ({ steer: wheel(c, 20), gas: s.t < 1 ? 1 : 0 }), 2.5); return { result: slipYaw(o), status: upTo(o.maxSlip, 15, 25) }; },
    },
    {
        id: 'M1', setup: '60, 0.9L + w 10°, 2 s', criterion: 'slow slide allowed; record 270cc 51°',
        source: 'driver M1; reconstructed',
        run: (make) => { const c = make(); const L = lockOf(c); const o = run(c, capV(c, 60), hold(10, () => 0.9 * L), 2); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    {
        id: 'M2', setup: '50, locked + w 20°, 2 s', criterion: 'spin allowed; record yaw 280→~150°/s',
        source: 'driver M2; reconstructed',
        run: (make) => { const c = make(); const o = run(c, 50, hold(20, () => 1), 2); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    {
        id: 'M3', setup: '40, full lock (w 90°) no brake, 2 s', criterion: 'pushes: slip < 15° (≈ < 25°)',
        source: 'driver M3 ("too much lock"); reconstructed',
        run: (make) => { const c = make(); const o = run(c, 40, hold(90, () => 0), 2); return { result: `${slipYaw(o)} end ${f0(o.v)}`, status: upTo(o.maxSlip, 15, 25) }; },
    },
    {
        id: 'M4', setup: '30, locked + w 45°, 2 s', criterion: 'spin allowed',
        source: 'driver M4; reconstructed',
        run: (make) => { const c = make(); const o = run(c, 30, hold(45, () => 1), 2); return { result: slipYaw(o), status: 'ALLOWED' }; },
    },
    ...(['H1', 'H2', 'H3', 'H4'] as const).map((id): Scenario => ({
        id,
        setup: {
            H1: '60→35 at 0.9L exactly straight, brake off, turn-in w 40°, 1.5 s',
            H2: '60→35 at 0.9L straight, turn-in w 40° with 0.3L→0 over 0.5 s, 1.5 s',
            H3: '35, turn-in w 40° with 0.2L held (drag), 1.5 s',
            H4: '35, turn-in w 40° with 0.2L + gas 0.3, 1.5 s',
        }[id] + ' (Racing125: +15 km/h)',
        criterion: id === 'H1' ? 'straight part slip < 1°; all < 15° (≈ < 25°)' : id === 'H2' ? 'no spin: < 15° (≈ < 25°)' : 'push or mild rotation: < 20° (≈ < 30°)',
        source: 'driver H1–H4 (record: pass 2–4°); Robin\'s hairpin row (unsourced); inputs reconstructed',
        run: (make, kart) => {
            const c = make(); const L = lockOf(c);
            const plus = kart === 'Racingkart125cc' ? 15 : 0;
            const vTurn = 35 + plus;
            let tTurn = id === 'H3' || id === 'H4' ? 0 : -1, straightSlip = 0;
            const o = run(c, id === 'H3' || id === 'H4' ? vTurn : capV(c, 60) + plus, (s) => {
                if (tTurn < 0) {
                    straightSlip = Math.max(straightSlip, Math.abs(s.slip));
                    if (s.vx > vTurn) return { brake: 0.9 * L };
                    tTurn = s.t;
                }
                const u = s.t - tTurn;
                if (u > 1.5) return null;
                const brake = id === 'H1' ? 0 : id === 'H2' ? 0.3 * L * Math.max(0, 1 - u / 0.5) : 0.2 * L;
                return { steer: wheel(c, 40), brake, gas: id === 'H4' ? 0.3 : 0 };
            }, 8);
            let status = id === 'H3' || id === 'H4' ? upTo(o.maxSlip, 20, 30) : upTo(o.maxSlip, 15, 25);
            if (id === 'H1' && straightSlip >= 1) status = 'FAIL';
            return { result: `${slipYaw(o)}${id === 'H1' ? ` straight ${f1(straightSlip)}°` : ''} end ${f0(o.v)}`, status };
        },
    })),
    {
        id: 'C1', setup: '35, w 40° 0.3 s, locked stab 0.2 s, then catch, 2.5 s', criterion: 'slip < 30°, caught < 0.5 s (≈ < 40° / < 1 s); record 270cc 26° 0.72 s, Racing125 51°',
        source: 'driver C1 (catch: release + countersteer + gas, driver/forums; slip < ~30° catchable); inputs reconstructed — stab 0.2 s chosen because it reproduces the recorded 35 → 23 km/h (0.1 s → 7°, 0.3 s → 49°: very sensitive)',
        run: (make) => {
            const c = make();
            const k = withCatch((s) => ({ steer: wheel(c, 40), brake: s.t >= 0.3 ? 1 : 0 }), 0.5);
            const o = run(c, 35, k.driver, 2.5);
            const t = k.caught();
            const status: Status = o.maxSlip < 30 && t < 0.5 ? 'PASS' : o.maxSlip < 40 && t < 1 ? '≈' : 'FAIL';
            return { result: `${slipYaw(o)} caught ${isFinite(t) ? f2(t) + ' s' : 'no'}`, status };
        },
    },
    {
        id: 'L2', setup: '75, locked + w 1°, until stop', criterion: 'spin allowed (Robin 2026-11-11); kart-driver.md: < 20° — CONFLICT',
        source: 'braking-spin.md L2 (Gillespie ch. 3: locked rear has no yaw damping)',
        run: (make) => { const c = make(); const o = run(c, capV(c, 75), hold(1, () => 1), 6); return { result: `${slipYaw(o)} ${f1(o.dist)} m`, status: o.maxSlip < 20 ? 'PASS' : 'ALLOWED' }; },
    },
    // Pivot taps: turn-in w 40° at the speed, brake tap 0.35 s at turn-in
    // (testdrive/hairpins.ts used 0.35 s), then 1.5 s coasting.
    ...([
        ['P1', 30, 0], ['P2', 30, 0.3], ['P3', 30, 0.6], ['P4', 40, 0], ['P5', 40, 0.3],
        ['P6', 40, 0.6], ['P7', 40, 0.85], ['P8', 30, 0.85], ['P9', 35, 0.95], ['P10', 25, 0.4],
    ] as [string, number, number][]).map(([id, v, tap]): Scenario => {
        const range: [number, number] = tap === 0 ? [0, 5] : tap <= 0.4 ? [2, 8] : tap <= 0.6 ? [4, 15] : [10, 25];
        const withC = tap >= 0.85;
        return {
            id,
            setup: `${v}, w 40°, tap ${tap}L 0.35 s at turn-in${withC ? ', then catch if slip > 8°' : ''}, 2 s`,
            criterion: id === 'P9' ? 'overdone, caught: < 30°, caught < 0.5 s' : tap === 0 ? 'no-brake reference: slip ≤ 5° (≈ ≤ 7°)' : `extra slip vs no tap ${range[0]}–${range[1]}° (±1° ≈)`,
            source: 'driver pivot judgement (low confidence: 0.2–0.4 L → +2–8°, 0.7–0.9 → 10–25° catchable; no source gives numbers); Robin: open, needs real data. P1–P10 inputs reconstructed (record: rental pass P1/P4/P9 only)',
            run: (make) => {
                const c = make(); const L = lockOf(c);
                let caughtAt = -1, catchFrom = -1;
                const ref = run(make(), v, hold(40, () => 0), 2).maxSlip;
                const o = run(c, v, (s) => {
                    if (s.t < 0.35) return { steer: wheel(c, 40), brake: tap * L };
                    if (withC && (catchFrom >= 0 || Math.abs(s.slip) > 8)) {
                        if (catchFrom < 0) catchFrom = s.t;
                        if (caughtAt < 0 && Math.abs(s.slip) < 5 && Math.abs(s.yaw) < 30) caughtAt = s.t;
                        return catchCtl(s);
                    }
                    return { steer: wheel(c, 40) };
                }, 2);
                const t = catchFrom < 0 ? 0 : caughtAt < 0 ? Infinity : caughtAt - catchFrom;
                const status = id === 'P9'
                    ? (o.maxSlip < 30 && t < 0.5 ? 'PASS' : o.maxSlip < 40 && t < 1 ? '≈' : 'FAIL')
                    : tap === 0 ? upTo(o.maxSlip, 5, 7) : within(o.maxSlip - ref, range[0], range[1], 1);
                return { result: `${slipYaw(o)}${tap > 0 ? ` (+${f1(o.maxSlip - ref)}° vs no tap)` : ''}${catchFrom >= 0 ? ` caught ${isFinite(t) ? f2(t) + ' s' : 'no'}` : ''}`, status };
            },
        };
    }),
    {
        id: 'KB-bend', setup: '50, kbd brake ramp (0.6 s→0.8L) + constant steering s, to a stop', criterion: 'largest s with slip < 20° ≥ record 2 % (Racing125 3 %)',
        source: 'analog-pedals.md 2026-11-10 (before the braking-spin fix: "keyboard cap holds at 2 %, 3 % Racingkart; full brake spins from 2 %"); speed + 20° threshold reconstructed',
        run: (make, kart) => {
            const holds = (pedal: (L: number, t: number) => number) => {
                let best = 0;
                for (let pct = 1; pct <= 100; pct++) {
                    const c = make(); const L = lockOf(c);
                    const o = run(c, 50, (s) => (c.speed <= 0 ? null : { steer: pct / 100, brake: pedal(L, s.t) }), 8);
                    if (o.maxSlip < 20) best = pct; else break;
                }
                return best;
            };
            const kbd = holds((L, t) => Math.min(0.8 * L, 0.8 * L * t / 0.6));
            const full = holds((_L, t) => Math.min(1, t / 0.6));
            const need = kart === 'Racingkart125cc' ? 3 : 2;
            return { result: `kbd holds ≤ ${kbd} %, full-pedal ramp ≤ ${full} %`, status: kbd >= need ? 'PASS' : 'FAIL' };
        },
    },
    {
        id: 'COAST', setup: '30/50/75 × w 5/10/20 × gas 0 or hold speed, 2 s', criterion: 'all < 15° (≈ < 25°); record: clean, Racing125 75 gas 0 + 5–10° → 22–23°',
        source: 'braking-spin.md "spins without braking" + port results',
        run: (make) => {
            let worst = 0, where = '', n = 0;
            for (const v of [30, 50, 75]) for (const w of [5, 10, 20]) for (const g of ['0', 'hold']) {
                const c = make(); const v0 = capV(c, v);
                const o = run(c, v0, (s) => ({ steer: wheel(c, w), gas: g === '0' ? 0 : clamp(0.3 + (v0 - s.vx) * 0.2, 0, 1) }), 2);
                if (o.maxSlip >= 15) n++;
                if (o.maxSlip > worst) { worst = o.maxSlip; where = `${v0}/${w}°/gas ${g}`; }
            }
            return { result: `worst ${f0(worst)}° (${where}), ${n} of 18 ≥ 15°`, status: upTo(worst, 15, 25) };
        },
    },
    {
        id: 'HAIRPIN', setup: '20–40 (step 5) × w 20/30/40/50, no brake, 2 s', criterion: 'rental: all ≤ 7° (270cc record), ≈ ≤ 12°; Racing125 report',
        source: 'braking-spin.md hairpin grid (combined fix: all ≤ 7°)',
        run: (make, kart) => {
            let worst = 0, where = '';
            for (const v of [20, 25, 30, 35, 40]) for (const w of [20, 30, 40, 50]) {
                const c = make(); const o = run(c, v, hold(w, () => 0), 2);
                if (o.maxSlip > worst) { worst = o.maxSlip; where = `${v}/${w}°`; }
            }
            return { result: `worst ${f1(worst)}° (${where})`, status: kart === 'Racingkart125cc' ? 'INFO' : upTo(worst, 7, 12) };
        },
    },
    {
        id: 'ST30', setup: 'from 30, gas tries to hold 30, w 10–90° step 5, 3 s; avg lateral g last 1 s, only runs ending ≥ 27 km/h', criterion: '270cc ≈ 0.86 g record (≥ 0.8 PASS); others report',
        source: 'braking-spin.md st30 (270cc 0.86 g accepted ≈ 0.9)',
        run: (make, kart) => {
            let best = 0, bestW = 0, bestV = 0;
            for (let w = 10; w <= 90; w += 5) {
                const c = make(); let sum = 0, cnt = 0;
                run(c, 30, (s) => {
                    if (s.t > 2) { sum += Math.abs(c.lateralG); cnt++; }
                    return { steer: wheel(c, w), gas: clamp(0.3 + (30 - s.vx) * 0.2, 0, 1) };
                }, 3);
                if (c.speed >= 27 && sum / cnt > best) { best = sum / cnt; bestW = w; bestV = c.speed; }
            }
            return { result: `max ${f2(best)} g at w ${bestW}° (${f0(bestV)} km/h)`, status: kart === 'Hyrkart270cc' ? within(best, 0.8, 2, 0.05) : 'INFO' };
        },
    },
    {
        id: 'BRK-SWEEP', setup: '75 & 30 × brake 0.1–0.9 L × w 0/2/5/10/20/40, 2.5 s', criterion: '270cc record: 30 all ≤ 8°; 75 < 15° up to 0.6 L; others report',
        source: 'braking-spin.md braking sweep after the fix (270cc)',
        run: (make, kart) => {
            const grid = (v: number) => [0, 2, 5, 10, 20, 40].map(w => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(b => {
                const c = make(); const L = lockOf(c); return run(c, capV(c, v), hold(w, () => b * L), 2.5).maxSlip;
            }));
            const g75 = grid(75), g30 = grid(30);
            const worst30 = Math.max(...g30.flat());
            const worst75lo = Math.max(...g75.map(r => r.slice(0, 6)).flat());
            if (SWEEP) {
                const dot = (x: number) => (x < 15 ? '·' : x <= 45 ? 'o' : '●');
                const lines = [`  ${SHORT[kart]} sweep (· < 15°, o 15–45°, ● > 45°), brake 0.1 … 0.9 L`];
                for (const [v, g] of [[75, g75], [30, g30]] as [number, number[][]][]) {
                    [0, 2, 5, 10, 20, 40].forEach((w, i) => lines.push(`    ${v} km/h w ${String(w).padStart(2)}°  ${g[i].map(dot).join(' ')}   max ${f0(Math.max(...g[i]))}°`));
                }
                SWEEP_LINES.push(...lines);
            }
            const status: Status = kart !== 'Hyrkart270cc' ? 'INFO' : worst30 <= 8 && worst75lo < 15 ? 'PASS' : worst30 <= 12 && worst75lo < 25 ? '≈' : 'FAIL';
            return { result: `30: worst ${f0(worst30)}°; 75 ≤ 0.6L: worst ${f0(worst75lo)}°`, status };
        },
    },
];
const SWEEP_LINES: string[] = [];

// ---------------------------------------------------------------- main
const ALL: Scenario[] = [...stopScenarios, ...tbScenarios, lockTip, lockDriver, tbCatch(0.5), tbCatch(1.0), gsEdge, ...earlier].filter(s => !ONLY || ONLY.test(s.id));

type Row = { id: string; kart: string; setup: string; criterion: string; a: Res; b?: Res };
const rows: Row[] = [];
const makeA = loadSrc(SRC_A);
const makeB = SRC_B ? loadSrc(SRC_B) : undefined;
for (const sc of ALL) {
    for (const kart of sc.karts ?? KARTS) {
        const setup = typeof sc.setup === 'string' ? sc.setup : sc.setup(kart);
        const criterion = typeof sc.criterion === 'string' ? sc.criterion : sc.criterion(kart);
        alarmCtx = { kart, id: sc.id, side: 'old' };
        const a = sc.run(() => makeA(kart), kart);
        alarmCtx = { kart, id: sc.id, side: 'new' };
        const b = makeB ? sc.run(() => makeB(kart), kart) : undefined;
        alarmCtx = undefined;
        rows.push({ id: sc.id, kart: SHORT[kart], setup, criterion, a, b });
    }
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log(`Braking suite — ${SRC_B ? `old ${SRC_A}  vs  new ${SRC_B}` : SRC_A}`);
console.log('Legend (source / confidence):');
for (const sc of ALL) if (!sc.id.startsWith('STOP') || sc.id.endsWith(' L')) console.log(`  ${pad(sc.id, 14)} ${sc.source}`);
console.log('');
const header = SRC_B
    ? ['ID', 'Kart', 'Setup', 'Criterion', 'Old result', 'Old', 'New result', 'New', 'Δ']
    : ['ID', 'Kart', 'Setup', 'Criterion', 'Result', 'Status'];
const table = rows.map(r => SRC_B
    ? [r.id, r.kart, r.setup, r.criterion, r.a.result, r.a.status, r.b!.result, r.b!.status,
        RANK[r.b!.status] < RANK[r.a.status] ? 'WORSE' : RANK[r.b!.status] > RANK[r.a.status] ? 'better' : r.a.result === r.b!.result ? '=' : 'changed']
    : [r.id, r.kart, r.setup, r.criterion, r.a.result, r.a.status]);
const widths = header.map((h, i) => Math.max(h.length, ...table.map(t => t[i].length)));
const line = (cells: string[]) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
console.log(line(header));
console.log('|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|');
for (const t of table) console.log(line(t));
if (SWEEP_LINES.length) { console.log(''); for (const l of SWEEP_LINES) console.log(l); }
const count = (k: 'a' | 'b') => {
    const c: Record<string, number> = {};
    for (const r of rows) { const s = (r[k] as Res).status; c[s] = (c[s] ?? 0) + 1; }
    return Object.entries(c).map(([s, n]) => `${s} ${n}`).join(', ');
};
console.log(`\n${SRC_B ? 'Old: ' + count('a') + '\nNew: ' + count('b') : count('a')}`);
for (const side of (SRC_B ? ['old', 'new'] : ['old']) as ('old' | 'new')[]) {
    const kinds = [...alarms[side].values()].map(v => v.split(' ')[0]);
    console.log(`Gs alarms ${SRC_B ? side : ''} (sustained ≥ 0.2 s; first per scenario × kart): ${alarms[side].size} — braking ${kinds.filter(k => k === 'braking').length}, cornering ${kinds.filter(k => k === 'cornering').length}, mix ${kinds.filter(k => k === 'mix').length}`);
    for (const [k, v] of alarms[side]) console.log(`  ${pad(k, 36)} ${v}`);
}
