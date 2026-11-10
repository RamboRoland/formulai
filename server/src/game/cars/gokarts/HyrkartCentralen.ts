import type { Track } from "../../tracks/Track";
import { Car, type DriveValues, type SlipValues } from "../Car";

// Sodi RSX2 electric (IPM motor, 42 Nm, 48 V lithium) — the single-seat
// rental kart at Gokartcentralen, Göteborg (gokartcentralen.se/gokartarna:
// ~60 km/h, can reverse; the model is inferred from identical specs).
// Size and weight from Sodi (sodikart.com, RSX2); the rest are estimates
// (nothing published): .claude/tasks/tyre-slip-steering.md.
export class HyrkartCentralen extends Car {
    public name = 'HyrkartCentralen';
    public lengthM = 1.865;
    public widthM = 1.35;
    public brakeDeceleration = 40; // km/h
    public maxSpeed = 60; // km/h
    public gripG = 1.15; // g sideways, hard rental tyres (estimate 1.0–1.3; same tyres as Hyrkart270cc)
    public steeringLock = 90; // degrees per side (steering wheel)
    public override steeringRate = 360; // °/s on the wheel: 0 → full lock in 0.25 s
    public wheelLock = 32; // degrees per side, front wheels (estimate)
    public wheelbaseMeters = 1.04; // from Sodi's drawing
    public weight = 186; // kg, with batteries, without driver
    public override slip: SlipValues = {
        massKg: 186 + 80,      // + driver
        rearShare: 0.42,       // ~42 / 58 front / rear (battery low between the axles)
        yawInertia: 60,        // estimate 55–65
        peakSlipDeg: 8,        // estimate 6–10 (same tyres as Hyrkart270cc)
        slideGrip: 0.75,       // estimate
        rearTrackMeters: 1.125, // estimate 1.10–1.15
        axleStiffness: 10,
        liftG: 0.75,           // estimate 0.5–1.0
        liftSeconds: 0.15,
        cgHeightMeters: 0.23,  // estimate: battery low, heaviest kart (0.32 m for 80 + 50 kg, Mihalić 2023)
    };

    // Drivetrain: .claude/tasks/analog-pedals.md. 42 Nm from the venue;
    // the rest estimates (Sodi publishes none): power as the BSR R3 rental
    // e-kart (10 kW), ratio = 4000 rpm motor at the 60 km/h limit.
    public drive: DriveValues = {
        torqueNm: 42,
        powerW: 10_000,          // estimate (BSR R3: 10 kW nominal)
        gearRatio: 3.66,         // estimate
        efficiency: 0.95,        // estimate
        wheelRadiusMeters: 0.1455, // 11x7.10-5, Ø 291 mm (Sodi)
        dragArea: 0.55,          // estimate: upright driver, bumpers (racing kart 0.45, CFD)
        rollingResistance: 0.02, // estimate, hard rental tyres
        liftOffG: 0.1,           // regen, estimate
        liftOffFromKmh: 0,
    };

    constructor(track: Track) {
        super(track);
    }
}
