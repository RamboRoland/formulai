import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class HyrkartCentralen extends Car {
    public name = 'HyrkartCentralen';
    public lengthM = 1.95;
    public widthM = 1.38;
    public acceleration = 15; // km/h
    public deceleration = 7; // km/h
    public brakeDeceleration = 40; // km/h
    public maxSpeed = 60; // km/h
    public gripG = 1.25; // g sideways (estimate)
    public horsePower = 14;
    public steeringLock = 90; // degrees per side (steering wheel)
    public wheelLock = 32; // degrees per side (front wheels)
    public wheelbaseMeters = 1.04;
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