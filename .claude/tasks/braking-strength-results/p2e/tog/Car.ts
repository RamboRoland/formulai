import { Vector } from "../components/Vector";
import type { Track } from "../tracks/Track"
import type { ControlsState } from "../types";
import { fromMetersToPixels } from "../helper";
import { G } from "./physics/constants";
import { axleDrive, drivePush, fullPull, governed, liftOffForce, type DriveValues } from "./physics/drivetrain";
import { airDrag, rollingForce } from "./physics/resistance";
import { axleSlip, magicFormula, peakGrip, slipSpeed, tmeasy, wheelSlip } from "./physics/tyre";
import { isLocked, lockingBrake, outerBrakeMoment, rearAxleMoment, rearBrakeLimit, reverseBrake, slipRatio, spinStep, spoolForce } from "./physics/rearAxle";
import { axleLoads, innerRearLift, lag, staticLoads, TRANSFER_SECONDS } from "./physics/loads";
import { frontWheels, steeringWheel, wheelAngleFrom } from "./physics/steering";
import { alongNose, frontForces, integrate, kinematicBlend, SLIP_SUBSTEPS, steer, toDegrees, type Body } from "./physics/chassis";

// The physics, one module per part (physics/): tyre (slip + load → force:
// front Magic Formula, rear TMeasy combined slip, load sensitivity), loads
// (weight transfer, inner rear lift), rearAxle (the spool's spin, brake
// clamp, lock, spool and brake moments), drivetrain (engine, gearing,
// governor, lift-off), resistance (rolling, air), steering (wheel,
// Ackermann), chassis (the body, substeps, low-speed blend, steer). The
// Car holds the state and the order each tick. Re-exported for older
// imports:
export { rearBrakeLimit } from "./physics/rearAxle";
export { torqueAt, type DriveValues } from "./physics/drivetrain";

// Car.spawnId source, unique across all cars.
let spawnCounter = 0;

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
    // Acceleration along the nose (m/s², + = forward; the actual one) the
    // axle loads follow, lagged by TRANSFER_SECONDS (slide; 0 with steer).
    private longAccel = 0;
    // The rear axle's spin (rad/s, both wheels: a spool; ≥ 0, slide) and
    // whether it is live (false → set to rolling when the slide starts).
    public wheelSpin = 0;
    private spinLive = false;
    // The rear axle's slip ratio κ, last substep (− = braking, −1 = locked;
    // slide, 0 with steer).
    public slipRatio = 0;
    // The rear wheels are locked (κ ≤ −0.5, rearAxle.isLocked; slide, last
    // substep). Public for the incident logs, tyre marks.
    public rearLocked = false;
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

    // The brake (0..1) at which the rear wheels lock with the gas up
    // (rearAxle.lockingBrake: straight, worst case at top speed; 1 = never).
    public brakeLock(): number {
        if (!this.slip) return 1;
        return lockingBrake(this.slip, this.drive, this.gripG, this.wheelbaseMeters, this.maxSpeed, this.brakeDeceleration);
    }

    // Reverse (and backing off from standstill): gas, reverse, brake and
    // coasting along the nose (speed, km/h) as forces, no tyre model
    // (Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3). Pedals 0..1.
    // Gas and reverse: drivetrain; against the motion: resistance (rolling,
    // air), engine braking / regen and the brake (rearAxle.reverseBrake: at
    // most what the rear tyres can stop, more locks them) — never past
    // standing still (chassis.alongNose). Capped by drivetrain.governed.
    private longitudinal(deltaTimeSeconds: number): void {
        const d = this.drive, s = this.slip!, m = s.massKg;
        const { forward: gas, backward, brake } = this.controls;
        const v = Math.abs(this.speed) / 3.6;
        const push = drivePush(gas, backward, fullPull(d, v)); // N, + = forward
        const rearMax = rearBrakeLimit(this.gripG, 1 - s.rearShare, s.cgHeightMeters / this.wheelbaseMeters) * m;
        const braking = reverseBrake(liftOffForce(d, v, gas, m) + brake * this.brakeDeceleration / 3.6 * m, rearMax, s.slideGrip, v);
        const resist = rollingForce(d.rollingResistance, m) + airDrag(d.dragArea, v) + braking;
        this.speed = governed(alongNose(this.speed, push, resist, m, deltaTimeSeconds), this.maxSpeed);
    }

    // Kinematic steering (chassis.steer): reverse, and karts without slip.
    protected steer(deltaTimeSeconds: number): void {
        steer(this, deltaTimeSeconds);
    }

    // Tyre-slip steering (dynamic bicycle model, karts with `slip`; forward
    // or standing): the car has a speed along the nose, a sideways speed
    // and a turn rate of its own. Per substep: the axle loads (loads, the
    // actual acceleration lagged), the front tyres' side force from their
    // slip angles (tyre.magicFormula, Ackermann), the rear axle's two wheels
    // (TMeasy combined slip, tyre.tmeasy: slip ratio κ from the axle's spin
    // + slip angle → Fx and Fy from ONE grip budget), the axle's spin
    // (rearAxle.spinStep: drive, brake, the tyres' Fx), its yaw moments
    // (spool, outer brake), then the body (chassis). Turning hands speed
    // over to lateralSpeed and the steered front tyres pull it back
    // (scrub), never below 0. GameEngine moves the car along speed +
    // lateralSpeed. Lock tipping point, lock vs turning / load / lift and
    // "a small slide costs speed" come out of the tyre + spin
    // (braking-strength.md 1c).
    protected slide(deltaTimeSeconds: number): void {
        const s = this.slip!, d = this.drive, m = s.massKg;
        const L = this.wheelbaseMeters, rw = d.wheelRadiusMeters;
        const b = L * s.rearShare, a = L - b; // CoG → rear / front axle
        const { front: staticFront, rear: staticRear } = staticLoads(m, a, b, L);
        const ls = s.loadSensitivity ?? 0;
        const { forward: gas, backward, brake } = this.controls;
        const delta = this.wheelAngle * Math.PI / 180;
        const steered = frontWheels(delta, L, s.frontTrackMeters);
        const tyre = magicFormula(s.peakSlipDeg, s.slideGrip);
        const brakeForce = brake * this.brakeDeceleration / 3.6 * m; // N at the tyre
        const dt = deltaTimeSeconds / SLIP_SUBSTEPS;
        const body: Body = { vx: this.speed / 3.6, vy: this.lateralSpeed, r: this.yawRate, angle: this.angle * Math.PI / 180 };
        if (!this.spinLive) { this.wheelSpin = Math.max(0, body.vx) / rw; this.spinLive = true; }
        for (let i = 0; i < SLIP_SUBSTEPS; i++) {
            const { front: loadFront, rear: loadRear } = axleLoads(staticFront, staticRear, m, this.longAccel, s.cgHeightMeters, L);
            this.loadShareFront = loadFront / staticFront;
            this.loadShareRear = loadRear / staticRear;
            const frontPeak = peakGrip(this.gripG, loadFront, staticFront, ls);
            const inner = loadRear / 2; // each rear wheel's load (the inner one lifts: rearLift)
            this.rearLift = lag(this.rearLift, innerRearLift(s, inner, this.lateralG, staticFront, staticRear, delta, this.wheelLock), dt, s.liftSeconds);
            // Front: each wheel's velocity in its own direction → slip angle
            // (Ackermann: each its own angle and its share of the grip).
            const fy = body.vy + a * body.r;
            const wheels = steered.map(d => {
                const slip = wheelSlip(body.vx, fy, d);
                return { side: tyre(-slip, frontPeak / steered.length), slip, d };
            });
            const { side: frontSide, drag: frontDrag } = frontForces(wheels);
            const front = Math.hypot(frontSide, frontDrag);
            this.slipFront = wheels.reduce((sum, w) => sum + w.slip, 0) / wheels.length;
            // Rear: two wheels on one axle spin, each at half the axle load
            // (load sensitivity per wheel; the lift doesn't move load between
            // them — rejected in braking-spin.md).
            const rearAcross = body.vy - b * body.r;
            this.slipRear = axleSlip(rearAcross, body.vx);
            const kappa = slipRatio(this.wheelSpin, rw, body.vx);
            const wheelPeak = peakGrip(this.gripG, inner, staticRear / 2, ls);
            const wheel = tmeasy(kappa, -rearAcross / slipSpeed(body.vx), inner, wheelPeak, s.slideGrip);
            const Fx = 2 * wheel[0], rear = 2 * wheel[1], rearPeak = 2 * wheelPeak;
            let K = 2 * wheel[2];
            if ((process.env.TOG ?? '').includes('slope')) {
                const w2 = tmeasy(kappa + 1e-3, -rearAcross / slipSpeed(body.vx), inner, wheelPeak, s.slideGrip);
                K = Math.max(0, (2 * w2[0] - Fx) / 1e-3);
            }
            // Along the nose: rear tyres, front scrub, rolling + drag (only
            // while moving forward).
            const resist = body.vx > 0 ? rollingForce(d.rollingResistance, m) + airDrag(d.dragArea, body.vx) : 0;
            const along = (Fx - resist - frontDrag) / m;
            // The axle's spin: drive (from ω: the engine sees the wheels),
            // brake + engine braking, the tyres' Fx; the kart's Δvx this
            // substep (explicit).
            const wheelV = this.wheelSpin * rw;
            const drive = axleDrive(d, gas, backward, wheelV, this.maxSpeed);
            const stop = brakeForce + liftOffForce(d, wheelV, gas, m);
            this.wheelSpin = spinStep(this.wheelSpin, dt, drive, stop, Fx, K, body.vx, (along + body.vy * body.r) * dt, rw);
            this.slipRatio = kappa;
            this.rearLocked = isLocked(kappa, body.vx);
            const moved = 1 - this.rearLift;
            const spool = spoolForce(s.axleStiffness, inner, body.r, s.rearTrackMeters, body.vx, this.gripG, moved, this.rearLift);
            const outerBrake = (process.env.TOG ?? '').includes('noouter') ? 0 : outerBrakeMoment(this.rearLocked, Math.max(0, -Fx), moved, s.rearTrackMeters);
            const axleMoment = rearAxleMoment(spool, s.rearTrackMeters, frontSide + rear, outerBrake);
            (this as any).dbg = { frontSide, rear, Fx, spoolM: -spool * s.rearTrackMeters, outerM: -Math.sign(frontSide + rear) * outerBrake, aF: a * frontSide, bR: -b * rear, lift: this.rearLift, w: this.wheelSpin, frontDrag };
            this.lateralG = (frontSide + rear) / m / G;
            this.longitudinalG = along / G;
            this.gripFront = frontPeak > 0 ? front / frontPeak : 0;
            this.gripRear = rearPeak > 0 ? Math.hypot(Fx, rear) / rearPeak : 0;
            this.longAccel = lag(this.longAccel, along, dt, TRANSFER_SECONDS);
            integrate(body, frontSide, rear, along, axleMoment, a, b, m, s.yawInertia, this.maxSpeed / 3.6, dt);
            kinematicBlend(body, delta, L, b, dt);
        }
        this.speed = body.vx * 3.6;
        this.lateralSpeed = body.vy;
        this.yawRate = body.r;
        this.angle = toDegrees(body.angle);
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
        // Forward (or standing, not backing out): slide (the rear tyres'
        // forces). Otherwise reverse: longitudinal + steer.
        const c = this.controls;
        const sliding = !!this.slip && (this.speed > 0 || (this.speed === 0 && !(c.backward > 0 && !(c.forward > 0))));
        if (!sliding) this.longitudinal(deltaTimeSeconds);

        // controls.steering (-1..1) → the steering wheel and front wheels,
        // degrees (steering.steeringWheel: at most steeringRate).
        this.steeringAngle = steeringWheel(this.steeringAngle, this.controls.steering, this.steeringLock, this.steeringRate, deltaTimeSeconds);
        this.wheelAngle = wheelAngleFrom(this.steeringAngle, this.wheelLock, this.steeringLock);
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
