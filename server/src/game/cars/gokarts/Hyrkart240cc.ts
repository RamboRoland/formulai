import type { Track } from "../../tracks/Track";
import { Car, type SlipValues } from "../Car";

// Caroli Hammerhead, Honda GX270 (9 hp) — the outdoor rental kart at
// Göteborgs Gokartcenter, Torslanda (gokart.se/utomhus, carolimotor.com).
// Size and weight from Caroli; the rest are estimates (nothing published):
// .claude/tasks/tyre-slip-steering.md.
export class Hyrkart240cc extends Car {
    public name = 'Hyrkart240cc';
    public lengthM = 1.95;
    public widthM = 1.35;
    public acceleration = 8; // km/h
    public deceleration = 6; // km/h
    public brakeDeceleration = 35; // km/h
    public maxSpeed = 80; // km/h
    public gripG = 1.15; // g sideways, hard rental tyres (estimate 1.0–1.3)
    public horsePower = 9;
    public steeringLock = 90; // degrees per side (steering wheel)
    public override steeringRate = 360; // °/s on the wheel: 0 → full lock in 0.25 s
    public wheelLock = 32; // degrees per side, front wheels (estimate: inner 35–40, outer 25–30)
    public wheelbaseMeters = 1.07; // estimate 1.04–1.10
    public weight = 150; // kg, without driver
    public override slip: SlipValues = {
        massKg: 150 + 80,      // + driver
        rearShare: 0.415,      // ~41.5 / 58.5 front / rear
        yawInertia: 55,        // estimate 40–70
        peakSlipDeg: 8,        // estimate 6–10
        slideGrip: 0.75,       // estimate
        rearTrackMeters: 1.175, // estimate 1.15–1.20
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