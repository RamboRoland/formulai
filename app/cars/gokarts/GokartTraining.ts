import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class GokartTraining extends Car {
    public name = 'GokartTraining';
    public lengthM = 1.8;
    public widthM = 1.2;
    public acceleration = 250; // km/h
    public deceleration = 50; // km/h
    public brakeDeceleration = 250; // km/h
    public maxSpeed = 100; // km/h
    public rotationSpeed = 270; // degrees per second
    public horsePower = 28;
    public steeringLock = 360; // degrees per side (steering wheel)
    public wheelLock = 90; // degrees per side (front wheels)
    public wheelbaseMeters = 1.12;

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
}