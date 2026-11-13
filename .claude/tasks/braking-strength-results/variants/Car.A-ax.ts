import { Vector } from "../components/Vector";
import type { Track } from "../tracks/Track"
import type { ControlsState } from "../types";
import { fromMetersToPixels } from "../helper";

// Car.spawnId source, unique across all cars.
let spawnCounter = 0;

const G = 9.81;
// Tyre-slip steering (Car.slide): substeps per tick (the tyre forces are
// stiff — one 1/60 s step can blow up) and the lowest speed the slip
// angles are worked out with (m/s; no ÷ 0 near standstill).
const SLIP_SUBSTEPS = 8;
const SLIP_MIN_SPEED = 1;
// Below these speeds (m/s) the slip model is blended into the kinematic
// one (the rear axle rolls without slipping): slip angles near standstill
// are noise ÷ ~0 and hold a kart rotating that should stand still
// (Kabzan et al. 2019, AMZ Driverless, arxiv.org/abs/1905.05150).
const KINEMATIC_BELOW = 1;
const SLIP_ABOVE = 3;
// Weight transfer (Car.slide): the axle loads follow the acceleration
// along the nose this much later (s) — a kart has no suspension, but its
// frame flexes; an instant shift feeds back on itself and destabilises.
const TRANSFER_SECONDS = 0.08;
// Air density (kg/m³, sea level, 15 °C) for the drag (Car.longitudinal).
const AIR_DENSITY = 1.225;
// Engine braking / regen (Car.longitudinal) is full with the gas up and
// gone at this much gas (like a torque-mode controller: part gas pulls).
const LIFT_OFF_FADE = 0.1;

// ---- Phase 2 (braking-strength.md): rear tyre with a wheel spin state ----
// Which combined-slip model the rear tyres use (one per scratch copy):
// 'A' normalised slip (TORCS), 'B' Pacejka MF combined (fastest-lap
// coefficients), 'C' TMeasy (Rill), parameters read off B's curves.
// MU_X: braking / driving peak ÷ cornering peak ('source' 0.9 / 1.5 =
// fastest-lap's pDx1 / pDy1, 'scaled' 1).
const VARIANT = 'A' as 'A' | 'B' | 'C';
const MU_X = 1;
// Rear axle (both wheels + sprocket + disc), kg·m² — fastest-lap kart.
const AXLE_INERTIA = 0.2;
// κ = (ωr − vx) / max(|vx|, this) (m/s): no ÷ 0 near standstill.
const KAPPA_MIN_SPEED = 1;
// fastest-lap database/vehicles/kart/roberto-lot-kart-2016.xml (commit
// 0660208), rear tyre, MF 5.2 notation; Fz0 = 560 N × lambdaFz0 1.6.
const FL = {
    Fz0: 896,
    pCx1: 2.3, pDx1: 0.9, pEx1: 0.95, pKx1: 20, pKx2: 1, pKx3: -0.5, rBx1: 14, rCx1: 1.0,
    pCy1: 2.3, pDy1: 1.5, pEy1: 0.9, pKy1: 37.6, pKy2: 1.6, pKy4: 2.0, rBy1: 12, rCy1: 0.6,
};
const mf = (B: number, C: number, E: number, x: number) => {
    const bx = B * x;
    return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
};
// Fastest-lap's shape factors at a wheel load (N): B for Fx0 (input κ) and
// Fy0 (input: sin α, see flFy). Peaks normalised to 1.
const flBx = (Fz: number) => {
    const dfz = (Fz - FL.Fz0) / FL.Fz0;
    return (FL.pKx1 + FL.pKx2 * dfz) * Math.exp(FL.pKx3 * dfz) / (FL.pCx1 * FL.pDx1);
};
const flBy = (Fz: number) => {
    const f = Math.max(Fz, 1);
    return FL.pKy1 * FL.Fz0 * Math.sin(FL.pKy4 * Math.atan(f / (FL.pKy2 * FL.Fz0))) / f / (FL.pCy1 * FL.pDy1);
};
const flFx = (Fz: number, k: number) => mf(flBx(Fz), FL.pCx1, FL.pEx1, k);
// Lateral input sin α instead of fastest-lap's tan α: with pCy1 2.3 their
// curve turns negative past ~74° slip (a spinning kart); identical < 10°.
const flFy = (Fz: number, sinA: number) => mf(flBy(Fz), FL.pCy1, FL.pEy1, sinA);
// Load tables (every 20 N to 3000 N): κ at the Fx0 peak, tan α at the Fy0
// peak, Fx0 locked (κ = −1) and Fy0 at 45° (TMeasy's sliding values).
const TABLE_STEP = 20, TABLE_N = 151;
const peakOf = (f: (x: number) => number, hi: number) => {
    let lo = 0;
    for (let i = 0; i < 60; i++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (f(m1) < f(m2)) lo = m1; else hi = m2;
    }
    return (lo + hi) / 2;
};
const T_KPK: number[] = [], T_TANPK: number[] = [], T_FXS: number[] = [], T_FYS: number[] = [];
for (let i = 0; i < TABLE_N; i++) {
    const Fz = Math.max(i * TABLE_STEP, 20);
    T_KPK.push(peakOf(k => flFx(Fz, k), 0.6));
    const s = peakOf(x => flFy(Fz, x), 0.6);
    T_TANPK.push(s / Math.sqrt(1 - s * s));
    T_FXS.push(Math.abs(flFx(Fz, -1)));
    T_FYS.push(flFy(Fz, Math.SQRT1_2));
}
const lookup = (t: number[], Fz: number) => {
    const x = Math.min(Math.max(Fz / TABLE_STEP, 0), TABLE_N - 1.001);
    const i = Math.floor(x), f = x - i;
    return t[i] + (t[i + 1] - t[i]) * f;
};
// One rear wheel: longitudinal slip κ, tan α (α + = the force pushes +),
// load Fz, lateral peak Dy (gripG × load, load sensitivity). Returns
// [Fx, Fy, dFx/dκ at κ = 0 (for the semi-implicit wheel update)].
const out: [number, number, number] = [0, 0, 0];
type ShapeA = { C: number; B: number; tanPk: number };
const wheelForce = (k: number, tanA: number, Fz: number, Dy: number, a: ShapeA): [number, number, number] => {
    if (Fz <= 0 || Dy <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
    const Dx = Dy * MU_X;
    if (VARIANT === 'A') {
        // TORCS simuv2 wheel.cpp: one curve on the combined slip, split by
        // the slip direction; each slip normalised by its peak.
        const kpk = lookup(T_KPK, Fz);
        const kn = k / kpk, an = tanA / a.tanPk;
        const rho = Math.sqrt(kn * kn + an * an);
        const F = rho > 1e-9 ? Dy * Math.sin(a.C * Math.atan(a.B * rho)) / rho : 0;
        out[0] = F * kn * MU_X; out[1] = F * an; out[2] = Dx * a.C * a.B / kpk;
        return out;
    }
    const Bx = flBx(Fz), By = flBy(Fz);
    if (VARIANT === 'B') {
        // Pacejka MF combined (Tyre and Vehicle Dynamics ch. 4): Fx = Gxα·Fx0,
        // Fy = Gyκ·Fy0.
        const gx = Math.cos(FL.rCx1 * Math.atan(FL.rBx1 * tanA));
        const gy = Math.cos(FL.rCy1 * Math.atan(FL.rBy1 * k));
        const sinA = tanA / Math.sqrt(1 + tanA * tanA);
        out[0] = gx * Dx * mf(Bx, FL.pCx1, FL.pEx1, k);
        out[1] = gy * Dy * mf(By, FL.pCy1, FL.pEy1, sinA);
        out[2] = gx * Dx * Bx * FL.pCx1;
        return out;
    }
    // TMeasy (Rill): parameters from B's curves at this load.
    const dFx0 = Dx * Bx * FL.pCx1, FxM = Dx, sxM = lookup(T_KPK, Fz), FxS = Dx * lookup(T_FXS, Fz), sxS = 1;
    const dFy0 = Dy * By * FL.pCy1, FyM = Dy, syM = lookup(T_TANPK, Fz), FyS = Dy * lookup(T_FYS, Fz), syS = 1;
    const rx = FxM / dFx0, ry = FyM / dFy0;
    const shx = sxM / (sxM + syM) + rx / (rx + ry);
    const shy = syM / (sxM + syM) + ry / (rx + ry);
    const sxn = k / shx, syn = tanA / shy;
    const s = Math.sqrt(sxn * sxn + syn * syn);
    out[2] = dFx0;
    if (s < 1e-9) { out[0] = 0; out[1] = 0; return out; }
    const c = sxn / s, sn = syn / s;
    const dF0 = Math.hypot(dFx0 * shx * c, dFy0 * shy * sn);
    const FM = Math.hypot(FxM * c, FyM * sn);
    const sM = Math.hypot(sxM / shx * c, syM / shy * sn);
    const FS = Math.hypot(FxS * c, FyS * sn);
    const sS = Math.hypot(sxS / shx * c, syS / shy * sn);
    let F: number;
    if (s <= sM) {
        const sg = s / sM;
        F = dF0 * s / (1 + sg * (sg + dF0 * sM / FM - 2));
    } else if (s < sS) {
        const sg = (s - sM) / (sS - sM);
        F = sg <= 0.5 ? FM - 2 * (FM - FS) * sg * sg : FS + 2 * (FM - FS) * (1 - sg) * (1 - sg);
    } else {
        F = FS;
    }
    out[0] = F * c; out[1] = F * sn;
    return out;
};

// The hardest rear-only brakes can stop (m/s²): the rear's grip, which the
// braking itself unloads — μ·g·rearLoadShare / (1 + μ·cgHeight / wheelbase).
export const rearBrakeLimit = (gripG: number, rearLoadShare: number, cgHeightPerWheelbase: number): number =>
    gripG * G * rearLoadShare / (1 + gripG * cgHeightPerWheelbase);

// A kart's values for tyre-slip steering (Car.slide). Estimates where
// nothing is published — sources: .claude/tasks/tyre-slip-steering.md.
export type SlipValues = {
    massKg: number;          // kart + driver
    rearShare: number;       // CoG → rear axle, share of the wheelbase (≈ front weight share)
    yawInertia: number;      // kg·m², kart + driver
    peakSlipDeg: number;     // tyre slip angle of the most grip (beyond it: less)
    slideGrip: number;       // grip left when fully sliding, share of the peak
    rearTrackMeters: number; // rear wheel centre to centre
    frontTrackMeters: number; // front wheel centre to centre (Ackermann, roll)
    axleStiffness: number;   // rear wheel grip along the wheel, per unit slip × wheel load
    // Caster / kingpin jacking: the share of the inner rear wheel's static
    // load the steering lifts off it at full lock (∝ sin of the wheel
    // angle). Estimated, tuned against the braking-spin tests
    // (.claude/tasks/braking-spin.md) — no kart data published.
    jacking: number;
    liftSeconds: number;     // how fast the chassis rolls onto / off the inner rear
    cgHeightMeters: number;  // CoG above the ground, kart + driver (weight transfer)
    // Tyre load sensitivity (Pacejka pDy2, ≤ 0): an axle's peak grip is
    // gripG × load × (1 + loadSensitivity × (load − static) / static) — a
    // tyre loaded more grips less per kg. Not set = 0 (grip ∝ load).
    loadSensitivity?: number;
};

// A kart's drivetrain and what slows it (Car.longitudinal). Estimates where
// nothing is published — sources: .claude/tasks/analog-pedals.md.
export type DriveValues = {
    torqueNm: number;          // engine / motor, peak; no curve → flat up to the power limit
    // Engine torque over engine speed [rpm, Nm], rpm rising (the maker's
    // chart): torqueAt. Not set = flat torqueNm (an electric motor).
    torqueCurve?: [number, number][];
    powerW: number;            // engine / motor, peak
    gearRatio: number;         // engine turns per rear axle turn
    efficiency: number;        // share the chain / drive passes on
    wheelRadiusMeters: number; // rear tyre
    dragArea: number;          // CdA, m², kart + driver
    rollingResistance: number; // Crr, tyres on asphalt
    liftOffG: number;          // engine braking / regen off the gas, in g
    liftOffFromKmh: number;    // ... only above this speed (clutch locked); 0 = always
};

// Torque (Nm) at an engine speed (rpm) on a curve: linear between the
// points; below the first → the first (the clutch slips there), above the
// last → the last (Car.longitudinal's power limit takes over).
export const torqueAt = (curve: [number, number][], rpm: number): number => {
    if (rpm <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
        const [rpmB, nmB] = curve[i];
        if (rpm <= rpmB) {
            const [rpmA, nmA] = curve[i - 1];
            return nmA + (nmB - nmA) * (rpm - rpmA) / (rpmB - rpmA);
        }
    }
    return curve[curve.length - 1][1];
};

export abstract class Car {
    // Class name, sent to the AI as GameState car.name.
    public abstract name: string;
    // Author-facing dimensions, in meters.
    // lengthM = along direction of travel (car front-to-back).
    // widthM  = across direction of travel.
    public abstract lengthM: number;
    public abstract widthM: number;
    // Brake fully pressed, km/h per second.
    public abstract brakeDeceleration: number;
    // Top speed (km/h): governor / speed limiter / rev limit.
    public abstract maxSpeed: number;
    // Tyre grip, in g of sideways acceleration: caps the turn rate at
    // gripG × 9.81 / speed, so the faster the car the less it can turn.
    public abstract gripG: number;
    public abstract drive: DriveValues;
    // Steering wheel, degrees per side (steering 1 = this far).
    public abstract steeringLock: number;
    // Front wheels, degrees per side (wheelAngle at steering 1).
    public abstract wheelLock: number;
    // Front to rear axle, metres.
    public abstract wheelbaseMeters: number;
    // Tyre tread width [front, rear], metres (the size code's section width;
    // tyre marks only).
    public abstract tyreWidthMeters: [number, number];
    // Steering wheel, degrees per second it can turn (a driver's hands);
    // not set → it jumps to controls.steering at once.
    public steeringRate?: number;
    // Set → tyre-slip steering (slide; every kart has it); not set → steer
    // (.claude/tasks/tyre-slip-steering.md). steer also does reverse.
    public slip?: SlipValues;

    public x: number;
    public y: number;
    public angle: number;
    public speed: number = 0;
    public hasCollision: boolean = false;
    // Overwritten by GameEngine.tickPlayer each frame — initial length must
    // match RAY_ANGLE_OFFSETS in ~/engine/rays. Kept as a literal to avoid
    // a cars → engine import.
    public rays: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    // Set by GameEngine.updateDirection each frame, against the track's
    // direction at the car (the centreline route). heading: direction of
    // travel — 1 the correct way, -1 the wrong way, 0 standing still or
    // blocked. facing: the nose points the correct way (within ±90°). The
    // spawn faces the direction of travel → 0 / true.
    public heading: -1 | 0 | 1 = 0;
    public facing: boolean = true;
    // Set by applyControls each tick (held when the stage is completed), in
    // degrees, + = right. steeringAngle: the steering wheel (controls.steering
    // -1..1 × steeringLock). wheelAngle: the front wheels, following the
    // steering wheel by the ratio wheelLock / steeringLock.
    public steeringAngle: number = 0;
    public wheelAngle: number = 0;
    // Tyre-slip state (slide; 0 with steer): sideways speed (m/s) and turn
    // rate (rad/s), + = right; the inner rear wheel's share on the ground
    // (1 = down, 0 = lifted).
    public lateralSpeed: number = 0;
    public yawRate: number = 0;
    // Also from slide (0 with steer), for GameState: the tyres' side force
    // in g (+ = right, what an accelerometer reads), the force along the
    // nose in g (+ = speeding up, − = braking; gas / brake / coasting and
    // the front tyres' scrub), the share of each axle's grip in use (0–1)
    // and each axle's slip angle (radians, + = the axle moves to the right
    // of where its tyres point; the front's includes the steering).
    public lateralG: number = 0;
    public longitudinalG: number = 0;
    public gripFront: number = 0;
    public gripRear: number = 0;
    public slipFront: number = 0;
    public slipRear: number = 0;
    // Share of the inner rear wheel's load still on it (1 = down, 0 = lifted;
    // slide). Public for the incident logs.
    public rearLift = 1;
    // Each axle's load ÷ its static load (weight transfer; 1 = standing,
    // < 1 = lighter; slide, last substep): scrub.
    public loadShareFront = 1;
    public loadShareRear = 1;
    // Acceleration along the nose (m/s², + = forward) the axle loads follow,
    // lagged by TRANSFER_SECONDS (slide; 0 with steer).
    private longAccel = 0;
    // The rear wheels are locked this tick: the brake (+ engine braking)
    // asked for more than the rear tyres can give (longitudinal → slide).
    public rearLocked = false; // public for the incident logs
    // What the rear tyres brake this tick (N): the brake + engine braking /
    // regen (longitudinal → slide's friction ellipse). Drag, rolling and the
    // front tyres' scrub slow the car too, but not through the rear tyres.
    private rearBraking = 0;
    // Rear axle spin (rad/s, ≥ 0 while sliding forward; both wheels, a
    // spool) and whether it is live (false → set to rolling at slide start).
    public wheelSpin = 0;
    private spinLive = false;
    // Longitudinal slip of the rear axle, last substep (κ, − = braking).
    public slipRatio = 0;
    public controls: ControlsState = {
        forward: 0,
        backward: 0,
        steering: 0,
        brake: 0,
        restart: false,
    }

    public track: Track;
    // New on every spawn (construction / reset). Rendering only: tells the
    // 3D view a wrecked car is back in one piece.
    public spawnId = ++spawnCounter;
    // Start grid box (0 = pole), set by GameEngine.assignGrid each stage.
    // reset() spawns in it, so a restart keeps it.
    public gridSlot = 0;

    constructor(track: Track) {
        this.track = track;

        this.x = this.track.startPosition.x;
        this.y = this.track.startPosition.y;
        this.angle = this.track.startAngle;
    }

    // Engine-facing dimensions, derived pixels.
    get lengthPx(): number { return fromMetersToPixels(this.lengthM); }
    get widthPx(): number { return fromMetersToPixels(this.widthM); }

    // Local-space bounding polygon (relative to car center, un-rotated).
    // Default = rectangle from length × width. Subclasses can override for
    // richer silhouettes (tapered front, hitbox cutouts).
    get bboxPolygon(): Vector[] {
        const l = this.lengthPx / 2;
        const w = this.widthPx / 2;
        return [
            new Vector(-l, -w),
            new Vector(+l, -w),
            new Vector(+l, +w),
            new Vector(-l, +w),
        ];
    }

    // Where the tyres are, for drawing marks (px): [front track, rear track,
    // wheelbase, front tyre width, rear tyre width] (track = wheel centre to
    // centre; the wheelbase sits centred on the body).
    public wheels(): [number, number, number, number, number] {
        const front = this.slip?.frontTrackMeters ?? this.widthM * 0.8;
        const rear = this.slip?.rearTrackMeters ?? this.widthM * 0.8;
        return [front, rear, this.wheelbaseMeters, ...this.tyreWidthMeters]
            .map(m => Math.round(fromMetersToPixels(m) * 100) / 100) as [number, number, number, number, number];
    }

    // How much rubber each tyre scrubs off now, 0..1: [FL, FR, RR, RL]. Wear
    // ∝ force × distance slid (Archard): the share of the axle's grip in use
    // × its load against standing (weight transfer: braking unloads the
    // rear) × how far its contact patch slides per metre driven — rolling at
    // slip angle α: sin α; locked: all of it, at the sliding grip
    // (slideGrip). The inner rear × its share on the ground (lifted → none).
    // 0 without slide (reverse, blocked: grip and slips are 0).
    public scrub(): [number, number, number, number] {
        if (!this.slip) return [0, 0, 0, 0];
        const scrubbing = (grip: number, load: number, slip: number) => Math.min(1, grip * load * Math.abs(Math.sin(slip)));
        const front = scrubbing(this.gripFront, this.loadShareFront, this.slipFront);
        const rear = this.rearLocked
            ? Math.min(1, this.slip.slideGrip * this.loadShareRear)
            : scrubbing(this.gripRear, this.loadShareRear, this.slipRear);
        // The steering lifts the inner rear (caster jacking; roll alone only
        // past ~2 g, slide): wheels to the right → the right one.
        const right = this.wheelAngle > 0 ? rear * this.rearLift : rear;
        const left = this.wheelAngle < 0 ? rear * this.rearLift : rear;
        return [front, front, right, left].map(v => Math.round(v * 100) / 100) as [number, number, number, number];
    }

    // The hardest the rear tyres can stop the car (m/s²), rearBrakeLimit.
    private rearStop(): number {
        const s = this.slip!;
        return rearBrakeLimit(this.gripG, 1 - s.rearShare, s.cgHeightMeters / this.wheelbaseMeters);
    }

    // The brake (0..1) at which the rear wheels lock with the gas up: brake
    // + engine braking / regen = what the rear tyres can stop (at speed;
    // 1 = they never lock).
    public brakeLock(): number {
        if (!this.slip) return 1;
        const s = this.slip, m = s.massKg, L = this.wheelbaseMeters, r = this.drive.wheelRadiusMeters;
        const staticRear = m * G * (1 - s.rearShare);
        const ls = s.loadSensitivity ?? 0;
        // Straight, gas up, at speed: the rear's peak Fx (two wheels, half
        // the axle load each) under the transfer its own braking makes.
        // Worst case over a stop: at top speed (drag + rolling move load
        // forward too) — below it the rear holds a little more.
        const v = this.maxSpeed / 3.6;
        const other = this.drive.rollingResistance * m * G + 0.5 * AIR_DENSITY * this.drive.dragArea * v * v;
        let a = 0, peak = 0;
        for (let i = 0; i < 40; i++) {
            const Fw = Math.max(0, staticRear - m * a * s.cgHeightMeters / L) / 2;
            peak = 2 * this.gripG * MU_X * Fw * Math.max(0, 1 + ls * (Fw - staticRear / 2) / (staticRear / 2));
            a = (peak + other) / m;
        }
        a = peak / m; // the axle's own slowing (I·ω̇)
        // Brake torque at the lock: the tyre's peak × r + slowing the axle
        // with the kart (I·a / r); engine braking adds its own.
        const torque = peak * r + AXLE_INERTIA * a / r;
        return Math.max(0, Math.min(1, (torque / r / m - this.drive.liftOffG * G) / (this.brakeDeceleration / 3.6)));
    }

    // Gas, reverse, brake and coasting along the nose (speed, km/h), as
    // forces (Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3). The
    // pedals are 0..1. Gas pulls with the engine's torque through the
    // gearing, at most its power (torque × ratio × η / r, then power × η /
    // v), times the rear grip turning leaves (gripRear from the last slide:
    // a sliding rear can't push); reverse (only without gas) pulls back the
    // same way. Against the motion: rolling resistance, air drag, engine
    // braking / regen off the gas and the brake — never past standing
    // still. Gas and brake act together. Capped at maxSpeed, reverse at
    // half of it (the real karts mostly have none; it backs out of a crash).
    // Brake and engine braking act on the rear wheels only: at most what
    // the rear tyres can stop (rearBrakeLimit); asking for more locks them
    // (past a tyre's peak the wheel stops turning at once), and a locked
    // tyre slides: slideGrip of it.
    private longitudinal(deltaTimeSeconds: number): void {
        const d = this.drive, s = this.slip!, m = s.massKg;
        const { forward: gas, backward, brake } = this.controls;
        const v = Math.abs(this.speed) / 3.6;
        const rpm = v / d.wheelRadiusMeters * d.gearRatio * 60 / (2 * Math.PI);
        const torque = d.torqueCurve ? torqueAt(d.torqueCurve, rpm) : d.torqueNm;
        const pull = Math.min(torque * d.gearRatio * d.efficiency / d.wheelRadiusMeters, d.powerW * d.efficiency / Math.max(v, 0.1));
        let push = 0; // N, + = forward
        if (gas > 0) {
            const grip = Math.sqrt(Math.max(0, 1 - Math.min(1, this.gripRear) ** 2));
            push = gas * pull * grip;
        } else if (backward > 0) {
            push = -backward * pull;
        }
        const liftOff = v * 3.6 > d.liftOffFromKmh ? Math.max(0, 1 - gas / LIFT_OFF_FADE) * d.liftOffG * m * G : 0;
        const rearAsked = liftOff + brake * this.brakeDeceleration / 3.6 * m;
        const rearMax = this.rearStop() * m;
        this.rearLocked = v > 0 && rearAsked > rearMax;
        this.rearBraking = v > 0 ? rearAsked : 0;
        const resist = d.rollingResistance * m * G + 0.5 * AIR_DENSITY * d.dragArea * v * v
            + (this.rearLocked ? s.slideGrip * rearMax : rearAsked);
        const pushed = this.speed + push / m * 3.6 * deltaTimeSeconds;
        const slowed = Math.max(0, Math.abs(pushed) - resist / m * 3.6 * deltaTimeSeconds);
        this.speed = Math.max(-this.maxSpeed / 2, Math.min(this.maxSpeed, Math.sign(pushed) * slowed));
    }

    // Kinematic bicycle model: turn rate |v| / wheelbase × tan|wheelAngle|,
    // capped by grip at gripG × 9.81 / |v| (rad/s): the steering geometry
    // decides at low speed, grip above (~16–19 km/h at full lock).
    // Reversing turns the other way (like a real car). No turn at speed 0.
    // Pivots around the rear axle (wheelbase / 2 behind the centre, axles
    // assumed symmetric): x / y shift so that point stays put.
    protected steer(deltaTimeSeconds: number): void {
        if (this.speed === 0 || this.wheelAngle === 0) return;
        const v = Math.abs(this.speed) / 3.6; // km/h → m/s
        const tan = Math.tan(Math.abs(this.wheelAngle) * Math.PI / 180);
        const rate = Math.min(v / this.wheelbaseMeters * tan, this.gripG * 9.81 / v) * 180 / Math.PI;
        const turn = rate * deltaTimeSeconds * Math.sign(this.wheelAngle) * Math.sign(this.speed);
        const before = this.angle * Math.PI / 180;
        this.angle = ((this.angle + turn) % 360 + 360) % 360;
        const after = this.angle * Math.PI / 180;
        const d = fromMetersToPixels(this.wheelbaseMeters) / 2;
        this.x += d * (Math.cos(after) - Math.cos(before));
        this.y += d * (Math.sin(after) - Math.sin(before));
    }

    // Tyre-slip steering (dynamic bicycle model, karts with `slip`): the
    // car has a sideways speed and a turn rate of its own. Each axle's tyres
    // push sideways from their slip angle (the angle between where the
    // wheel points and where it goes) — Pacejka's Magic Formula: most grip
    // (gripG × the axle's load) at peakSlipDeg, less beyond it, slideGrip
    // of it when fully sliding (so full lock at speed ploughs). The rigid rear axle (no
    // differential) adds a moment against the turn — strongest at low speed,
    // fading as the inner rear wheel lifts. `speed` is the speed along the
    // nose (gas / brake act on it first): turning hands it over to
    // lateralSpeed and the steered front tyres pull it back (scrub), never
    // below 0 (a spin doesn't put the kart in reverse). GameEngine moves the
    // car along speed + lateralSpeed. Updates speed, angle, lateralSpeed,
    // yawRate.
    // Gas / brake (`controlAccel`, m/s² along the nose this tick) move load
    // between the axles — m × a × cgHeight / wheelbase (Beckman, The
    // Physics of Racing 1), lagged: braking unloads the rear, so turning
    // hard on the brake brings it round. Braking counts at most as hard as
    // rear-only brakes can (all three karts), and takes its share of the
    // rear grip; turning gets the rest (friction ellipse).
    protected slide(deltaTimeSeconds: number): void {
        const s = this.slip!, d = this.drive, m = s.massKg;
        const L = this.wheelbaseMeters;
        const b = L * s.rearShare, a = L - b; // CoG → rear / front axle
        const staticFront = m * G * b / L, staticRear = m * G * a / L;
        const ls = s.loadSensitivity ?? 0;
        const rw = d.wheelRadiusMeters;
        const { forward: gas, backward, brake } = this.controls;
        let loadFront = staticFront, loadRear = staticRear;
        const delta = this.wheelAngle * Math.PI / 180;
        let vx = this.speed / 3.6;
        const floor = (v: number) => Math.max(Math.abs(v), SLIP_MIN_SPEED);
        const saturate = (x: number, max: number) => max * Math.tanh(x / max);
        // Magic Formula F = max × sin(C × atan(B × α)): C from slideGrip
        // (sin(C × 90°) = slideGrip), B puts the peak at peakSlipDeg.
        const shape = 2 - (2 / Math.PI) * Math.asin(s.slideGrip);
        const stiff = Math.tan(Math.PI / (2 * shape)) / (s.peakSlipDeg * Math.PI / 180);
        const tyre = (alpha: number, max: number) => max * Math.sin(shape * Math.atan(stiff * alpha));
        const shapeA: ShapeA = { C: shape, B: Math.tan(Math.PI / (2 * shape)), tanPk: Math.tan(s.peakSlipDeg * Math.PI / 180) };
        const dt = deltaTimeSeconds / SLIP_SUBSTEPS;
        let vy = this.lateralSpeed, r = this.yawRate, angle = this.angle * Math.PI / 180;
        if (!this.spinLive) { this.wheelSpin = Math.max(0, vx) / rw; this.spinLive = true; }
        let w = this.wheelSpin;
        const brakeForce = brake * this.brakeDeceleration / 3.6 * m; // N at the tyre, today's pedal
        for (let i = 0; i < SLIP_SUBSTEPS; i++) {
            const shift = m * this.longAccel * s.cgHeightMeters / L; // + = onto the rear
            loadFront = Math.max(0, staticFront - shift);
            loadRear = Math.max(0, staticRear + shift);
            this.loadShareFront = loadFront / staticFront;
            this.loadShareRear = loadRear / staticRear;
            const frontPeak = this.gripG * loadFront * Math.max(0, 1 + ls * (loadFront - staticFront) / staticFront);
            // Inner rear wheel lift — as before.
            const inner = loadRear / 2;
            const roll = Math.abs(this.lateralG) * m * G * s.cgHeightMeters / ((s.rearTrackMeters + s.frontTrackMeters) / 2);
            const jack = staticRear / 2 * s.jacking * Math.sin(Math.abs(delta)) / Math.sin(this.wheelLock * Math.PI / 180);
            const lifted = inner > 0 ? Math.max(0, 1 - (roll * staticRear / (staticFront + staticRear) + jack) / inner) : 0;
            this.rearLift += (lifted - this.rearLift) * Math.min(1, dt / s.liftSeconds);
            // Front: unchanged (lateral only, Ackermann).
            const fy = vy + a * r;
            const frontWheel = (dd: number, max: number) => {
                const slip = Math.atan((-vx * Math.sin(dd) + fy * Math.cos(dd)) / floor(vx * Math.cos(dd) + fy * Math.sin(dd)));
                return { side: tyre(-slip, max), slip, d: dd };
            };
            const radius = Math.abs(delta) > 1e-4 ? L / Math.tan(Math.abs(delta)) : 0;
            const wheels = radius > 0
                ? [Math.atan(L / Math.max(radius - s.frontTrackMeters / 2, 1e-3)), Math.atan(L / (radius + s.frontTrackMeters / 2))]
                    .map(dd => frontWheel(Math.sign(delta) * dd, frontPeak / 2))
                : [frontWheel(0, frontPeak)];
            const frontSide = wheels.reduce((sum, wh) => sum + wh.side * Math.cos(wh.d), 0);
            const frontDrag = wheels.reduce((sum, wh) => sum + wh.side * Math.sin(wh.d), 0); // scrub, slows the car
            const front = Math.hypot(frontSide, frontDrag);
            const frontDragNow = frontDrag;
            this.slipFront = wheels.reduce((sum, wh) => sum + wh.slip, 0) / wheels.length;
            // Rear: two wheels on one spinning axle (spool → one ω), each its
            // own load (the inner one × rearLift) with load sensitivity.
            const rearAcross = vy - b * r;
            this.slipRear = Math.atan(rearAcross / floor(vx));
            const tanA = -rearAcross / floor(vx);
            const kappa = (w * rw - vx) / Math.max(Math.abs(vx), KAPPA_MIN_SPEED);
            const Fw0 = staticRear / 2;
            let Fx = 0, Fy = 0, K = 0, Dsum = 0;
            // AXLE copy: both rear wheels at half the axle load (no per-wheel
            // load sensitivity with the lift — rejected in braking-spin.md).
            for (const Fz of [loadRear / 2, loadRear / 2]) {
                const Dy = this.gripG * Fz * Math.max(0, 1 + ls * (Fz - Fw0) / Fw0);
                const f = wheelForce(kappa, tanA, Fz, Dy, shapeA);
                Fx += f[0]; Fy += f[1]; K += f[2]; Dsum += Dy;
            }
            const rear = Fy;
            // Axle spin: I·ω̇ = drive − brake·sgn ω − r·ΣFx, semi-implicit in
            // the tyre's slope (stable at any speed), the brake only stops ω
            // (TORCS wheel.cpp :408–413).
            const wheelV = w * rw;
            const rpm = wheelV / rw * d.gearRatio * 60 / (2 * Math.PI);
            const torque = d.torqueCurve ? torqueAt(d.torqueCurve, rpm) : d.torqueNm;
            const pull = Math.min(torque * d.gearRatio * d.efficiency / rw, d.powerW * d.efficiency / Math.max(wheelV, 0.1));
            let drive = gas > 0 ? gas * pull : -backward * pull; // N at the tyre
            if (drive > 0 && wheelV >= this.maxSpeed / 3.6) drive = 0; // governor / limiter
            const liftOff = wheelV * 3.6 > d.liftOffFromKmh ? Math.max(0, 1 - gas / LIFT_OFF_FADE) * d.liftOffG * m * G : 0;
            // Linearised in κ: Fx(ω⁺, vx⁺) ≈ Fx + K·(r·Δω − Δvx) / v — the
            // kart's own speed change this substep (Δvx, explicit) included,
            // else the stiffness term would drag ω behind a decelerating kart.
            const kv = K / Math.max(Math.abs(vx), KAPPA_MIN_SPEED);
            const resistNow = vx > 0 ? d.rollingResistance * m * G + 0.5 * AIR_DENSITY * d.dragArea * vx * vx : 0;
            const dvxGuess = ((Fx - resistNow - frontDragNow) / m + vy * r) * dt;
            const iEff = AXLE_INERTIA + dt * rw * rw * kv;
            const wFree = w + dt * (drive * rw - rw * Fx + rw * kv * dvxGuess) / iEff;
            const stop = dt * (brakeForce + liftOff) * rw / iEff;
            w = wFree > stop ? wFree - stop : wFree < -stop ? wFree + stop : 0;
            w = Math.max(0, w);
            this.slipRatio = kappa;
            this.rearLocked = vx > 0 && kappa <= -0.5;
            // Rigid rear axle (spool) moment — as before.
            const moved = 1 - this.rearLift;
            const wheel = saturate(s.axleStiffness * inner * r * (s.rearTrackMeters / 2) / floor(vx), this.gripG * inner);
            const spool = Math.sign(wheel) * Math.min(Math.abs(wheel) * (1 - moved * moved), this.gripG * inner * this.rearLift);
            // Braking with the inner rear lifted: the outer tyre carries the
            // axle's (actual) brake force — as before, none while locked.
            const outerBrake = this.rearLocked ? 0 : Math.max(0, -Fx) * moved * s.rearTrackMeters / 2;
            const axleMoment = -spool * s.rearTrackMeters - Math.sign(frontSide + rear) * outerBrake;
            // Along the nose: rear tyres, front scrub, rolling + drag (only
            // while moving forward).
            const resist = vx > 0 ? d.rollingResistance * m * G + 0.5 * AIR_DENSITY * d.dragArea * vx * vx : 0;
            const along = (Fx - resist - frontDrag) / m;
            this.lateralG = (frontSide + rear) / m / G;
            this.longitudinalG = along / G;
            this.gripFront = frontPeak > 0 ? front / frontPeak : 0;
            this.gripRear = Dsum > 0 ? Math.hypot(Fx, Fy) / Dsum : 0;
            // Weight transfer follows the ACTUAL acceleration, lagged.
            this.longAccel += (along - this.longAccel) * Math.min(1, dt / TRANSFER_SECONDS);
            vy += ((frontSide + rear) / m - vx * r) * dt;
            vx = Math.min(this.maxSpeed / 3.6, Math.max(0, vx + (along + vy * r) * dt));
            r += (a * frontSide - b * rear + axleMoment) / s.yawInertia * dt;
            const slipShare = Math.max(0, Math.min(1, (vx - KINEMATIC_BELOW) / (SLIP_ABOVE - KINEMATIC_BELOW)));
            if (slipShare < 1) {
                const rKinematic = vx * Math.tan(delta) / L;
                r = slipShare * r + (1 - slipShare) * rKinematic;
                vy = slipShare * vy + (1 - slipShare) * rKinematic * b;
            }
            angle += r * dt;
        }
        this.wheelSpin = w;
        this.speed = vx * 3.6;
        this.lateralSpeed = vy;
        this.yawRate = r;
        this.angle = ((angle * 180 / Math.PI) % 360 + 360) % 360;
    }

    // No slide: blocked (collides where it stands) or steering kinematically.
    public stopSliding(): void {
        this.lateralSpeed = 0;
        this.yawRate = 0;
        this.rearLift = 1;
        this.loadShareFront = 1;
        this.loadShareRear = 1;
        this.longAccel = 0;
        this.lateralG = 0;
        this.longitudinalG = 0;
        this.gripFront = 0;
        this.gripRear = 0;
        this.slipFront = 0;
        this.slipRear = 0;
        this.slipRatio = 0;
        this.rearLocked = false;
        this.spinLive = false;
    }

    // Back to the start: in its grid box (gridSlot), facing the direction
    // of travel (Track.spawn). `x/y` is not the car's center (center = x +
    // widthPx/2, y + lengthPx/2), so convert.
    public reset(): void {
        const s = this.track.spawn(this.lengthPx, this.gridSlot);
        this.x = s.x - this.widthPx / 2;
        this.y = s.y - this.lengthPx / 2;
        this.speed = 0;
        this.angle = s.angle;
        this.hasCollision = false;
        this.rays = [0, 0, 0, 0, 0, 0, 0, 0];
        this.heading = 0;
        this.facing = true;
        this.steeringAngle = 0;
        this.wheelAngle = 0;
        this.stopSliding();
        this.spawnId = ++spawnCounter;
    }

    public applyControls(deltaTimeSeconds: number): void {
        // Forward (or standing, not backing out): the rear tyres' forces in
        // slide. Otherwise the old force model + steer (reverse).
        const c = this.controls;
        const sliding = !!this.slip && (this.speed > 0 || (this.speed === 0 && !(c.backward > 0 && !(c.forward > 0))));
        if (!sliding) this.longitudinal(deltaTimeSeconds);

        // controls.steering is -1..1 (the AI / keyboard side); the car works
        // in degrees. With a steeringRate the wheel turns towards it at most
        // that fast (no human goes 0 → full lock in one tick).
        const s = this.controls.steering;
        const normalized = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
        const wanted = normalized * this.steeringLock;
        if (this.steeringRate) {
            const step = this.steeringRate * deltaTimeSeconds;
            this.steeringAngle += Math.max(-step, Math.min(step, wanted - this.steeringAngle));
        } else {
            this.steeringAngle = wanted;
        }
        this.wheelAngle = this.steeringAngle * this.wheelLock / this.steeringLock;
        // Reverse stays kinematic (the real karts have no reverse gear; it
        // is there to back out of a crash — no slide, no spin).
        if (sliding) {
            this.slide(deltaTimeSeconds);
        } else {
            this.stopSliding();
            this.steer(deltaTimeSeconds);
        }
    }
}
