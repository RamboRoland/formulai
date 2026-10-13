import { Vector } from "~/components/Vector";
import type { Track } from "~/tracks/Track"
import type { ControlsState } from "~/types";
import { fromMetersToPixels } from "~/helper";

export abstract class Car {
    // Author-facing dimensions, in meters.
    // lengthM = along direction of travel (car front-to-back).
    // widthM  = across direction of travel.
    public abstract lengthM: number;
    public abstract widthM: number;
    public abstract acceleration: number;
    public abstract deceleration: number;
    public abstract brakeDeceleration: number;
    public abstract maxSpeed: number;
    public abstract rotationSpeed: number;
    public abstract horsePower: number;

    public x: number;
    public y: number;
    public angle: number;
    public speed: number = 0;
    public hasCollision: boolean = false;
    // Overwritten by GameEngine.tickPlayer each frame — initial length must
    // match RAY_ANGLE_OFFSETS in ~/engine/rays. Kept as a literal to avoid
    // a cars → engine import.
    public rays: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    public controls: ControlsState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        brake: false,
        restart: false,
    }

    public track: Track;

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
    protected abstract steer(deltaTimeSeconds: number, direction: number): void;

    public steerLeft(deltaTimeSeconds: number): void {
        this.steer(deltaTimeSeconds, -1);
    }
    public steerRight(deltaTimeSeconds: number): void {
        this.steer(deltaTimeSeconds, 1);
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

        if (this.controls.left) {
            this.steerLeft(deltaTimeSeconds);
        }
        if (this.controls.right) {
            this.steerRight(deltaTimeSeconds);
        }
    }
}
