import { Vector } from "~/components/Vector";
import type { Track } from "~/tracks/Track"
import type { ControlsState } from "~/types";
import { fromMetersToPixels } from "~/helper";

// Car.spawnId source, unique across all cars.
let spawnCounter = 0;

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
    // Max turn rate (°/s): caps the steering below.
    public abstract rotationSpeed: number;
    public abstract horsePower: number;
    // Steering wheel, degrees per side (steering 1 = this far).
    public abstract steeringLock: number;
    // Front wheels, degrees per side (wheelAngle at steering 1).
    public abstract wheelLock: number;
    // Front to rear axle, metres.
    public abstract wheelbaseMeters: number;

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
    // capped at rotationSpeed (°/s). Reversing turns the other way (like a
    // real car). No turn at speed 0.
    // Pivots around the rear axle (wheelbase / 2 behind the centre, axles
    // assumed symmetric): x / y shift so that point stays put.
    protected steer(deltaTimeSeconds: number): void {
        if (this.speed === 0 || this.wheelAngle === 0) return;
        const v = Math.abs(this.speed) / 3.6; // km/h → m/s
        const tan = Math.tan(Math.abs(this.wheelAngle) * Math.PI / 180);
        const rate = Math.min((v / this.wheelbaseMeters) * tan * 180 / Math.PI, this.rotationSpeed);
        const turn = rate * deltaTimeSeconds * Math.sign(this.wheelAngle) * Math.sign(this.speed);
        const before = this.angle * Math.PI / 180;
        this.angle = ((this.angle + turn) % 360 + 360) % 360;
        const after = this.angle * Math.PI / 180;
        const d = fromMetersToPixels(this.wheelbaseMeters) / 2;
        this.x += d * (Math.cos(after) - Math.cos(before));
        this.y += d * (Math.sin(after) - Math.sin(before));
    }

    // Back to the start: centered across the track just behind the start
    // line, facing the direction of travel (Track.spawn). `x/y` is not the
    // car's center (center = x + widthPx/2, y + lengthPx/2), so convert.
    public reset(): void {
        const s = this.track.spawn(this.lengthPx);
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
        // in degrees.
        const s = this.controls.steering;
        const normalized = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
        this.steeringAngle = normalized * this.steeringLock;
        this.wheelAngle = this.steeringAngle * this.wheelLock / this.steeringLock;
        this.steer(deltaTimeSeconds);
    }
}
