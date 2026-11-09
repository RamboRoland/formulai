import type { Track } from "../../tracks/Track";
import { Car, type SlipValues } from "../Car";

// Sodi RSX2 electric (IPM motor, 42 Nm, 48 V lithium) — the single-seat
// rental kart at Gokartcentralen, Göteborg (gokartcentralen.se/gokartarna:
// ~60 km/h, can reverse; the model is inferred from identical specs).
// Size and weight from Sodi (sodikart.com, RSX2); the rest are estimates
// (nothing published): .claude/tasks/tyre-slip-steering.md.
export class HyrkartCentralen extends Car {
    public name = 'HyrkartCentralen';
    public lengthM = 1.865;
    public widthM = 1.35;
    public acceleration = 15; // km/h
    public deceleration = 7; // km/h
    public brakeDeceleration = 40; // km/h
    public maxSpeed = 60; // km/h
    public gripG = 1.15; // g sideways, hard rental tyres (estimate 1.0–1.3; same tyres as Hyrkart240cc)
    public horsePower = 14;
    public steeringLock = 90; // degrees per side (steering wheel)
    public override steeringRate = 360; // °/s on the wheel: 0 → full lock in 0.25 s
    public wheelLock = 32; // degrees per side, front wheels (estimate)
    public wheelbaseMeters = 1.04; // from Sodi's drawing
    public weight = 186; // kg, with batteries, without driver
    public override slip: SlipValues = {
        massKg: 186 + 80,      // + driver
        rearShare: 0.42,       // ~42 / 58 front / rear (battery low between the axles)
        yawInertia: 60,        // estimate 55–65
        peakSlipDeg: 8,        // estimate 6–10 (same tyres as Hyrkart240cc)
        slideGrip: 0.75,       // estimate
        rearTrackMeters: 1.125, // estimate 1.10–1.15
        axleStiffness: 10,
        liftG: 0.75,           // estimate 0.5–1.0
        liftSeconds: 0.15,
    };

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