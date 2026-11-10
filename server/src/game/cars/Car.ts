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
};

export abstract class Car {
    // Class name, sent to the AI as GameState car.name.
    public abstract name: string;
    // Author-facing dimensions, in meters.
    // lengthM = along direction of travel (car front-to-back).
    // widthM  = across direction of travel.
    public abstract lengthM: number;
    public abstract widthM: number;
    public abstract acceleration: number;
    public abstract deceleration: number;
    public abstract brakeDeceleration: number;
    public abstract maxSpeed: number;
    // Tyre grip, in g of sideways acceleration: caps the turn rate at
    // gripG × 9.81 / speed, so the faster the car the less it can turn.
    public abstract gripG: number;
    public abstract horsePower: number;
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
    // in g (+ = right, what an accelerometer reads) and the share of each
    // axle's grip in use (0–1).
    public lateralG: number = 0;
    public gripFront: number = 0;
    public gripRear: number = 0;
    private rearLift = 1;
    public controls: ControlsState = {
        forward: false,
        backward: false,
        steering: 0,
        brake: false,
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

    public abstract accelerate(deltaTimeSeconds: number): void;
    public abstract reverse(deltaTimeSeconds: number): void;
    public abstract brake(deltaTimeSeconds: number): void;
    public abstract rolling(deltaTimeSeconds: number): void;

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
    protected slide(deltaTimeSeconds: number): void {
        const s = this.slip!;
        const L = this.wheelbaseMeters;
        const b = L * s.rearShare, a = L - b; // CoG → rear / front axle
        const loadFront = s.massKg * G * b / L, loadRear = s.massKg * G * a / L;
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
            // Front: the axle's velocity in the wheel's direction → slip angle.
            const fy = vy + a * r;
            const along = vx * Math.cos(delta) + fy * Math.sin(delta);
            const across = -vx * Math.sin(delta) + fy * Math.cos(delta);
            const front = tyre(-Math.atan(across / floor(along)), this.gripG * loadFront);
            const rear = tyre(-Math.atan((vy - b * r) / floor(vx)), this.gripG * loadRear);
            // Rigid rear axle: both wheels turn at one speed, the ground under
            // them differs by r × track → each slips ∓ r × track / 2 / v.
            // The chassis rolls onto / off the inner wheel over liftSeconds.
            const lateralG = Math.abs(vx * r) / G;
            this.rearLift += (Math.max(0, 1 - lateralG / s.liftG) - this.rearLift) * Math.min(1, dt / s.liftSeconds);
            const wheel = saturate(s.axleStiffness * (loadRear / 2) * r * (s.rearTrackMeters / 2) / floor(vx), this.gripG * loadRear / 2);
            const axleMoment = -wheel * this.rearLift * s.rearTrackMeters;
            const frontSide = front * Math.cos(delta);
            this.lateralG = (frontSide + rear) / s.massKg / G;
            this.gripFront = Math.abs(front) / (this.gripG * loadFront);
            this.gripRear = Math.abs(rear) / (this.gripG * loadRear);
            const dvx = (-front * Math.sin(delta) / s.massKg + vy * r) * dt;
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
        this.lateralG = 0;
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
        if (this.controls.forward) {
            this.accelerate(deltaTimeSeconds);
        } else if (this.controls.backward) {
            this.reverse(deltaTimeSeconds);
        } else if (this.controls.brake) {
            this.brake(deltaTimeSeconds);
        } else {
            this.rolling(deltaTimeSeconds);
        }

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
            this.slide(deltaTimeSeconds);
        } else {
            this.stopSliding();
            this.steer(deltaTimeSeconds);
        }
    }
}
