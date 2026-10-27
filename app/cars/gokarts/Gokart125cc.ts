import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class Gokart125cc extends Car {
    public name = 'Gokart125cc';
    public lengthM = 1.9;
    public widthM = 1.4;
    public acceleration = 25; // km/h
    public deceleration = 14; // km/h
    public brakeDeceleration = 50; // km/h
    public maxSpeed = 125; // km/h
    public rotationSpeed = 300; // degrees per second
    public horsePower = 28;
    public steeringLock = 120; // degrees per side (steering wheel)
    public wheelLock = 35; // degrees per side (front wheels)
    public wheelbaseMeters = 1.05;

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