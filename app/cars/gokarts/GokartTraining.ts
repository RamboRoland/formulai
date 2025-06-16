import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class GokartTraining extends Car {
    public width = 8;
    public height = 13;
    public acceleration = 250; // km/h
    public deceleration = 50; // km/h
    public brakeDeceleration = 250; // km/h
    public maxSpeed = 100; // km/h
    public rotationSpeed = 270; // degrees per second
    public horsePower = 28;

    constructor(track: Track) {
        super(track);
    }

    public accelerate(deltaTimeSeconds: number): void {
        this.speed = Math.min(this.speed + this.acceleration * deltaTimeSeconds, this.maxSpeed);
    }

    public reverse(deltaTimeSeconds: number): void {
        this.speed = Math.max(this.speed - this.acceleration * deltaTimeSeconds, -this.maxSpeed / 2);
    }

    public brake(deltaTimeSeconds: number): void {
        if (this.speed > 0) {
            this.speed = Math.max(0, this.speed - this.brakeDeceleration * deltaTimeSeconds);
        } else if (this.speed < 0) {
            this.speed = Math.min(0, this.speed + this.brakeDeceleration * deltaTimeSeconds);
        }
    }

    public rolling(deltaTimeSeconds: number): void {
        if (this.speed > 0) {
            this.speed = Math.max(0, this.speed - this.deceleration * deltaTimeSeconds);
        } else if (this.speed < 0) {
            this.speed = Math.min(0, this.speed + this.deceleration * deltaTimeSeconds);
        }
    }

    protected steer(deltaTimeSeconds: number, direction: number): void {
        if (this.speed === 0) {
            return;
        }

        // Normalize angle to 0-360
        const newAngle = this.rotationSpeed * deltaTimeSeconds * direction;
        this.angle = ((this.angle + newAngle) % 360 + 360) % 360;
    }
}