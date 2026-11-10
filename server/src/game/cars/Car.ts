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
// Weight transfer (Car.slide): the axle loads follow the acceleration
// along the nose this much later (s) — a kart has no suspension, but its
// frame flexes; an instant shift feeds back on itself and destabilises.
const TRANSFER_SECONDS = 0.08;
// Air density (kg/m³, sea level, 15 °C) for the drag (Car.longitudinal).
const AIR_DENSITY = 1.225;
// Engine braking / regen (Car.longitudinal) is full with the gas up and
// gone at this much gas (like a torque-mode controller: part gas pulls).
const LIFT_OFF_FADE = 0.1;

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
    axleStiffness: number;   // rear wheel grip along the wheel, per unit slip × wheel load
    liftG: number;           // sideways g at which the inner rear wheel is off the ground
    liftSeconds: number;     // how fast the chassis rolls onto / off it
    cgHeightMeters: number;  // CoG above the ground, kart + driver (weight transfer)
    // Tyre load sensitivity (Pacejka pDy2, ≤ 0): an axle's peak grip is
    // gripG × load × (1 + loadSensitivity × (load − static) / static) — a
    // tyre loaded more grips less per kg. Not set = 0 (grip ∝ load).
    loadSensitivity?: number;
};

// A kart's drivetrain and what slows it (Car.longitudinal). Estimates where
// nothing is published — sources: .claude/tasks/analog-pedals.md.
export type DriveValues = {
    torqueNm: number;          // engine / motor, peak
    powerW: number;            // engine / motor, peak
    gearRatio: number;         // engine turns per rear axle turn
    efficiency: number;        // share the chain / drive passes on
    wheelRadiusMeters: number; // rear tyre
    dragArea: number;          // CdA, m², kart + driver
    rollingResistance: number; // Crr, tyres on asphalt
    liftOffG: number;          // engine braking / regen off the gas, in g
    liftOffFromKmh: number;    // ... only above this speed (clutch locked); 0 = always
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
    // the front tyres' scrub) and the share of each axle's grip in use (0–1).
    public lateralG: number = 0;
    public longitudinalG: number = 0;
    public gripFront: number = 0;
    public gripRear: number = 0;
    private rearLift = 1;
    // Acceleration along the nose (m/s², + = forward) the axle loads follow,
    // lagged by TRANSFER_SECONDS (slide; 0 with steer).
    private longAccel = 0;
    // The rear wheels are locked this tick: the brake (+ engine braking)
    // asked for more than the rear tyres can give (longitudinal → slide).
    private rearLocked = false;
    // What the rear tyres brake this tick (N): the brake + engine braking /
    // regen (longitudinal → slide's friction ellipse). Drag, rolling and the
    // front tyres' scrub slow the car too, but not through the rear tyres.
    private rearBraking = 0;
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
        return Math.max(0, Math.min(1, (this.rearStop() - this.drive.liftOffG * G) / (this.brakeDeceleration / 3.6)));
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
        const pull = Math.min(d.torqueNm * d.gearRatio * d.efficiency / d.wheelRadiusMeters, d.powerW * d.efficiency / Math.max(v, 0.1));
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
    protected slide(deltaTimeSeconds: number, controlAccel = 0): void {
        const s = this.slip!;
        const L = this.wheelbaseMeters;
        const b = L * s.rearShare, a = L - b; // CoG → rear / front axle
        const staticFront = s.massKg * G * b / L, staticRear = s.massKg * G * a / L;
        const longitudinal = Math.max(controlAccel, -rearBrakeLimit(this.gripG, a / L, s.cgHeightMeters / L));
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
        const dt = deltaTimeSeconds / SLIP_SUBSTEPS;
        let vy = this.lateralSpeed, r = this.yawRate, angle = this.angle * Math.PI / 180;
        for (let i = 0; i < SLIP_SUBSTEPS; i++) {
            const shift = s.massKg * this.longAccel * s.cgHeightMeters / L; // + = onto the rear
            loadFront = Math.max(0, staticFront - shift);
            loadRear = Math.max(0, staticRear + shift);
            const frontPeak = this.gripG * loadFront * Math.max(0, 1 + (s.loadSensitivity ?? 0) * (loadFront - staticFront) / staticFront);
            const rearGrip = this.gripG * loadRear * Math.max(0, 1 + (s.loadSensitivity ?? 0) * (loadRear - staticRear) / staticRear);
            const brakeShare = rearGrip > 0 ? Math.min(1, this.rearBraking / rearGrip) : 0;
            // Front: the axle's velocity in the wheel's direction → slip angle.
            const fy = vy + a * r;
            const along = vx * Math.cos(delta) + fy * Math.sin(delta);
            const across = -vx * Math.sin(delta) + fy * Math.cos(delta);
            const front = tyre(-Math.atan(across / floor(along)), frontPeak);
            // Locked rear: a sliding tyre pushes against its own sliding,
            // sideways only as much as it slides sideways (Coulomb).
            const rearAcross = vy - b * r;
            const rear = this.rearLocked
                ? -s.slideGrip * rearGrip * rearAcross / Math.max(Math.hypot(vx, rearAcross), 1e-6)
                : tyre(-Math.atan(rearAcross / floor(vx)), rearGrip * Math.sqrt(1 - brakeShare * brakeShare));
            // Rigid rear axle: both wheels turn at one speed, the ground under
            // them differs by r × track → each slips ∓ r × track / 2 / v.
            // The chassis rolls onto / off the inner wheel over liftSeconds.
            const lateralG = Math.abs(vx * r) / G;
            this.rearLift += (Math.max(0, 1 - lateralG / s.liftG) - this.rearLift) * Math.min(1, dt / s.liftSeconds);
            const wheel = saturate(s.axleStiffness * (loadRear / 2) * r * (s.rearTrackMeters / 2) / floor(vx), this.gripG * loadRear / 2);
            const axleMoment = -wheel * this.rearLift * s.rearTrackMeters;
            const frontSide = front * Math.cos(delta);
            this.lateralG = (frontSide + rear) / s.massKg / G;
            this.longitudinalG = (controlAccel - front * Math.sin(delta) / s.massKg) / G;
            this.gripFront = frontPeak > 0 ? Math.abs(front) / frontPeak : 0;
            this.gripRear = rearGrip > 0 ? Math.abs(rear) / rearGrip : 0;
            const dvx = (-front * Math.sin(delta) / s.massKg + vy * r) * dt;
            this.longAccel += (longitudinal - front * Math.sin(delta) / s.massKg - this.longAccel) * Math.min(1, dt / TRANSFER_SECONDS);
            vy += ((frontSide + rear) / s.massKg - vx * r) * dt;
            vx = Math.max(0, vx + dvx);
            r += (a * frontSide - b * rear + axleMoment) / s.yawInertia * dt;
            angle += r * dt;
        }
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
        this.longAccel = 0;
        this.lateralG = 0;
        this.longitudinalG = 0;
        this.gripFront = 0;
        this.gripRear = 0;
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
        const speedBefore = this.speed;
        this.longitudinal(deltaTimeSeconds);

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
        if (this.slip && this.speed >= 0) {
            this.slide(deltaTimeSeconds, (this.speed - speedBefore) / 3.6 / deltaTimeSeconds);
        } else {
            this.stopSliding();
            this.steer(deltaTimeSeconds);
        }
    }
}
