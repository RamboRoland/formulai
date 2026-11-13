import { Vector } from "../components/Vector";
import type { Track } from "../tracks/Track"
import type { ControlsState } from "../types";
import { fromMetersToPixels } from "../helper";
import { G } from "./physics/constants";
import { drivePush, fullPull, governed, liftOffForce, type DriveValues } from "./physics/drivetrain";
import { airDrag, rollingForce } from "./physics/resistance";
import { axleSlip, magicFormula, tractionLeft, wheelSlip } from "./physics/tyre";
import { lockingBrake, outerBrakeMoment, rearAxleMoment, rearBrake, rearBrakeShare, rearSideForce, rearStop, spoolForce } from "./physics/rearAxle";
import { axleLoads, axlePeak, innerRearLift, lag, staticLoads, transferAccel, TRANSFER_SECONDS } from "./physics/loads";
import { frontWheels, steeringWheel, wheelAngleFrom } from "./physics/steering";
import { alongNose, frontForces, integrate, kinematicBlend, SLIP_SUBSTEPS, steer, toDegrees, type Body } from "./physics/chassis";

// The physics, one module per part (physics/): tyre (slip + load → force),
// loads (weight transfer, inner rear lift, load sensitivity), rearAxle
// (rear brakes, lock, spool), drivetrain (engine, gearing, governor,
// lift-off), resistance (rolling, air), steering (wheel, Ackermann),
// chassis (the body, substeps, low-speed blend, steer). The Car holds the
// state and the order each tick. Re-exported for older imports:
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
        return rearStop(this.gripG, s.rearShare, s.cgHeightMeters, this.wheelbaseMeters);
    }

    // The brake (0..1) at which the rear wheels lock with the gas up
    // (rearAxle.lockingBrake; 1 = they never lock).
    public brakeLock(): number {
        if (!this.slip) return 1;
        return lockingBrake(this.rearStop(), this.drive.liftOffG, this.brakeDeceleration);
    }

    // Gas, reverse, brake and coasting along the nose (speed, km/h), as
    // forces (Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3). The
    // pedals are 0..1. Gas and reverse: drivetrain (the rear grip turning
    // leaves: tyre.tractionLeft); against the motion: resistance (rolling,
    // air), engine braking / regen off the gas and the brake, both through
    // the rear tyres (rearAxle.rearBrake: at most what they can stop, more
    // locks them) — never past standing still (chassis.alongNose). Gas and
    // brake act together. Capped by the governor (drivetrain.governed).
    private longitudinal(deltaTimeSeconds: number): void {
        const d = this.drive, s = this.slip!, m = s.massKg;
        const { forward: gas, backward, brake } = this.controls;
        const v = Math.abs(this.speed) / 3.6;
        const push = drivePush(gas, backward, fullPull(d, v), tractionLeft(this.gripRear)); // N, + = forward
        const rear = rearBrake(liftOffForce(d, v, gas, m), brake, this.brakeDeceleration, m, this.rearStop() * m, s.slideGrip, v);
        this.rearLocked = rear.locked;
        this.rearBraking = rear.braking;
        const resist = rollingForce(d.rollingResistance, m) + airDrag(d.dragArea, v) + rear.force;
        this.speed = governed(alongNose(this.speed, push, resist, m, deltaTimeSeconds), this.maxSpeed);
    }

    // Kinematic steering (chassis.steer): reverse, and karts without slip.
    protected steer(deltaTimeSeconds: number): void {
        steer(this, deltaTimeSeconds);
    }

    // Tyre-slip steering (dynamic bicycle model, karts with `slip`): the
    // car has a sideways speed and a turn rate of its own. Each axle's tyres
    // push sideways from their slip angle (the angle between where the
    // wheel points and where it goes; tyre.magicFormula) from the axle's
    // load (loads). The rigid rear axle (no differential) adds a moment
    // against the turn — strongest at low speed, fading as the inner rear
    // wheel lifts (rearAxle). `speed` is the speed along the nose (gas /
    // brake act on it first): turning hands it over to lateralSpeed and the
    // steered front tyres pull it back (scrub), never below 0 (chassis).
    // GameEngine moves the car along speed + lateralSpeed. Updates speed,
    // angle, lateralSpeed, yawRate.
    // Gas / brake (`controlAccel`, m/s² along the nose this tick) move load
    // between the axles (loads.axleLoads, lagged): braking unloads the
    // rear, so turning hard on the brake brings it round. Braking takes its
    // share of the rear grip; turning gets the rest (friction ellipse).
    protected slide(deltaTimeSeconds: number, controlAccel = 0): void {
        const s = this.slip!;
        const L = this.wheelbaseMeters;
        const b = L * s.rearShare, a = L - b; // CoG → rear / front axle
        const { front: staticFront, rear: staticRear } = staticLoads(s.massKg, a, b, L);
        const longitudinal = transferAccel(controlAccel, this.gripG, a / L, s.cgHeightMeters / L);
        const delta = this.wheelAngle * Math.PI / 180;
        const steered = frontWheels(delta, L, s.frontTrackMeters);
        const tyre = magicFormula(s.peakSlipDeg, s.slideGrip);
        const dt = deltaTimeSeconds / SLIP_SUBSTEPS;
        const body: Body = { vx: this.speed / 3.6, vy: this.lateralSpeed, r: this.yawRate, angle: this.angle * Math.PI / 180 };
        for (let i = 0; i < SLIP_SUBSTEPS; i++) {
            const { front: loadFront, rear: loadRear } = axleLoads(staticFront, staticRear, s.massKg, this.longAccel, s.cgHeightMeters, L);
            this.loadShareFront = loadFront / staticFront;
            this.loadShareRear = loadRear / staticRear;
            const frontPeak = axlePeak(this.gripG, loadFront, staticFront, s.loadSensitivity ?? 0);
            const rearGrip = axlePeak(this.gripG, loadRear, staticRear, s.loadSensitivity ?? 0);
            const brakeShare = rearBrakeShare(this.rearBraking, rearGrip);
            const inner = loadRear / 2;
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
            const rearAcross = body.vy - b * body.r;
            this.slipRear = axleSlip(rearAcross, body.vx);
            const rear = rearSideForce(this.rearLocked, tyre, s.slideGrip, rearGrip, rearAcross, body.vx, this.slipRear, brakeShare);
            const moved = 1 - this.rearLift;
            const spool = spoolForce(s.axleStiffness, inner, body.r, s.rearTrackMeters, body.vx, this.gripG, moved, this.rearLift);
            const outerBrake = outerBrakeMoment(this.rearLocked, this.rearBraking, rearGrip, moved, s.rearTrackMeters);
            const axleMoment = rearAxleMoment(spool, s.rearTrackMeters, frontSide + rear, outerBrake);
            this.lateralG = (frontSide + rear) / s.massKg / G;
            this.longitudinalG = (controlAccel - frontDrag / s.massKg) / G;
            this.gripFront = frontPeak > 0 ? front / frontPeak : 0;
            this.gripRear = rearGrip > 0 ? Math.abs(rear) / rearGrip : 0;
            this.longAccel = lag(this.longAccel, longitudinal - frontDrag / s.massKg, dt, TRANSFER_SECONDS);
            integrate(body, frontSide, frontDrag, rear, axleMoment, a, b, s.massKg, s.yawInertia, dt);
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

        // controls.steering (-1..1) → the steering wheel and front wheels,
        // degrees (steering.steeringWheel: at most steeringRate).
        this.steeringAngle = steeringWheel(this.steeringAngle, this.controls.steering, this.steeringLock, this.steeringRate, deltaTimeSeconds);
        this.wheelAngle = wheelAngleFrom(this.steeringAngle, this.wheelLock, this.steeringLock);
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
