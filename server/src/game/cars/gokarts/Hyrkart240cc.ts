import type { Track } from "../../tracks/Track";
import { Car } from "../Car";

export class Hyrkart240cc extends Car {
    public name = 'Hyrkart240cc';
    public lengthM = 2.0;
    public widthM = 1.4;
    public acceleration = 8; // km/h
    public deceleration = 6; // km/h
    public brakeDeceleration = 35; // km/h
    public maxSpeed = 80; // km/h
    public gripG = 1.1; // g sideways (estimate)
    public horsePower = 9;
    public steeringLock = 90; // degrees per side (steering wheel)
    public wheelLock = 30; // degrees per side (front wheels)
    public wheelbaseMeters = 1.04;
    public weight = 150; // kg

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