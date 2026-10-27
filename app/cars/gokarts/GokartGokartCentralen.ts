import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class GokartGokartCentralen extends Car {
    public name = 'GokartGokartCentralen';
    public lengthM = 1.87;
    public widthM = 1.35;
    public acceleration = 15; // km/h
    public deceleration = 8; // km/h
    public brakeDeceleration = 40; // km/h
    public maxSpeed = 60; // km/h
    public rotationSpeed = 90; // degrees per second
    public horsePower = 0;
    public steeringLock = 360; // degrees per side (steering wheel)
    public wheelLock = 90; // degrees per side (front wheels)
    public wheelbaseMeters = 1.12;
    public weight = 186; // kg

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