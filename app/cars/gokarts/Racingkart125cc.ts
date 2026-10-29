import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class Racingkart125cc extends Car {
    public name = 'Racingkart125cc';
    public lengthM = 1.8;
    public widthM = 1.4;
    public acceleration = 22; // km/h
    public deceleration = 8; // km/h
    public brakeDeceleration = 70; // km/h
    public maxSpeed = 115; // km/h
    public gripG = 2.0; // g sideways (estimate)
    public horsePower = 28;
    public steeringLock = 60; // degrees per side (steering wheel)
    public wheelLock = 35; // degrees per side (front wheels)
    public wheelbaseMeters = 1.05;
    public weight = 75; // kg

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