import type { Track } from "../../tracks/Track";
import { Car, type DriveValues, type SlipValues } from "../Car";

// Caroli Hammerhead, Honda GX270 (9 hp) — the outdoor rental kart at
// Göteborgs Gokartcenter, Torslanda (gokart.se/utomhus, carolimotor.com).
// Size and weight from Caroli; the rest are estimates (nothing published):
// .claude/tasks/tyre-slip-steering.md.
export class Hyrkart240cc extends Car {
    public name = 'Hyrkart240cc';
    public lengthM = 1.95;
    public widthM = 1.35;
    public brakeDeceleration = 35; // km/h
    public maxSpeed = 80; // km/h
    public gripG = 1.15; // g sideways, hard rental tyres (estimate 1.0–1.3)
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
        cgHeightMeters: 0.25,  // estimate: 150 kg kart + driver (0.32 m for 80 + 50 kg, Mihalić 2023)
    };

    // Drivetrain: .claude/tasks/analog-pedals.md. Honda GX270 brochure
    // (6.3 kW net @ 3600, 19.1 Nm @ 2500); ratio = 80 km/h at 4500 rpm
    // (estimate; reaches 80 before Torslanda GP's hairpin — the venue's
    // top speed, Robin has driven it).
    public drive: DriveValues = {
        torqueNm: 19.1,
        powerW: 6_300,
        gearRatio: 3.09,         // estimate
        efficiency: 0.9,         // estimate (chain + centrifugal clutch)
        wheelRadiusMeters: 0.1455, // 11x7.10-5, Ø 291 mm
        dragArea: 0.55,          // estimate: upright driver, bumpers (racing kart 0.45, CFD)
        rollingResistance: 0.02, // estimate, hard rental tyres
        liftOffG: 0,             // centrifugal clutch: freewheels off the gas (estimate)
        liftOffFromKmh: 0,
    };

    constructor(track: Track) {
        super(track);
    }
}
