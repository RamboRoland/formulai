import type { Track } from "../../tracks/Track";
import { Car, type SlipValues } from "../Car";

// Rotax 125 Max EVO Senior (direct drive, 30 hp) on Mojo D5 slicks.
// Rotax datasheet (22 kW, wheelbase 1,040 mm), RMC sporting regulation
// (162 kg with driver), CIK (1820 × 1400 mm max), Rotax: no front brakes.
// The rest are estimates: .claude/tasks/tyre-slip-steering.md.
export class Racingkart125cc extends Car {
    public name = 'Racingkart125cc';
    public lengthM = 1.8;
    public widthM = 1.4;
    public acceleration = 22; // km/h
    public deceleration = 8; // km/h
    public brakeDeceleration = 35; // km/h per s, rear brake only (~0.8–1.1 g)
    public maxSpeed = 115; // km/h
    public gripG = 1.6; // g sideways, D5 slicks (~1.5–1.7 sustained)
    public horsePower = 30;
    public steeringLock = 60; // degrees per side (steering wheel; estimate 90–100)
    public override steeringRate = 360; // °/s on the wheel: 0 → full lock in 0.17 s
    public wheelLock = 35; // degrees per side, front wheels (estimate)
    public wheelbaseMeters = 1.04;
    public weight = 75; // kg, without driver
    public override slip: SlipValues = {
        massKg: 162,           // Rotax Senior minimum, kart + driver
        rearShare: 0.43,       // ~43 / 57 front / rear
        yawInertia: 27,        // estimate 20–33
        peakSlipDeg: 6,        // estimate 5–7 (slicks: sharper than rental)
        slideGrip: 0.7,        // estimate
        rearTrackMeters: 1.2,  // estimate
        axleStiffness: 10,
        liftG: 0.8,            // estimate
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