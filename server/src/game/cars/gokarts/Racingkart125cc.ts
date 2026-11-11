import type { Track } from "../../tracks/Track";
import { Car, type DriveValues, type SlipValues } from "../Car";

// Rotax 125 Max EVO Senior (30 hp; centrifugal clutch ~4000 rpm + chain,
// RM MAX evo manual) on Mojo D5 slicks.
// Rotax datasheet (22 kW, wheelbase 1,040 mm), RMC sporting regulation
// (162 kg with driver), CIK (1820 × 1400 mm max), Rotax: no front brakes.
// The rest are estimates: .claude/tasks/tyre-slip-steering.md.
export class Racingkart125cc extends Car {
    public name = 'Racingkart125cc';
    public lengthM = 1.8;
    public widthM = 1.4;
    public brakeDeceleration = 35; // km/h per s, rear brake only (~0.8–1.1 g)
    public maxSpeed = 115; // km/h
    public gripG = 1.6; // g sideways, D5 slicks (~1.5–1.7 sustained)
    public steeringLock = 60; // degrees per side (steering wheel; estimate 90–100)
    public override steeringRate = 360; // °/s on the wheel: 0 → full lock in 0.17 s
    public wheelLock = 35; // degrees per side, front wheels (estimate)
    public wheelbaseMeters = 1.04;
    public tyreWidthMeters: [number, number] = [0.114, 0.18]; // 10x4.50-5 / 11x7.10-5: 4.50" / 7.10" section width
    public weight = 75; // kg, without driver
    public override slip: SlipValues = {
        massKg: 162,           // Rotax Senior minimum, kart + driver
        rearShare: 0.43,       // ~43 / 57 front / rear
        yawInertia: 27,        // estimate 20–33
        peakSlipDeg: 6,        // estimate 5–7 (slicks: sharper than rental)
        slideGrip: 0.7,        // estimate
        rearTrackMeters: 1.2,  // estimate
        axleStiffness: 10,
        frontTrackMeters: 1.05, // estimate (Ackermann, roll)
        jacking: 0,            // estimated, tuned against the braking-spin tests (1.6 g slicks: roll alone lifts it)
        liftSeconds: 0.15,
        cgHeightMeters: 0.29,  // estimate: light kart, the driver weighs more (0.32 m for 80 + 50 kg, Mihalić 2023)
        loadSensitivity: -0.15, // estimate (no kart data; Milliken -0.12, FSAE 10" -0.15)
    };

    // Drivetrain: .claude/tasks/analog-pedals.md. Rotax datasheet (22 kW @
    // 11,500, 21 Nm @ 9000), gearing 13/77; drag area from a racing kart
    // CFD study (Tor Vergata: 173 N at 90 km/h, cd 0.794).
    public drive: DriveValues = {
        torqueNm: 21,
        powerW: 22_000,
        gearRatio: 77 / 13,
        efficiency: 0.95,        // estimate
        wheelRadiusMeters: 0.14, // 11x7.10-5 D5
        dragArea: 0.45,
        rollingResistance: 0.018, // estimate, slicks
        liftOffG: 0.05,          // engine braking, estimate (2-stroke: weak)
        liftOffFromKmh: 36,      // clutch engages ~4000 rpm (Rotax manual) = 36 km/h at 13/77
    };

    constructor(track: Track) {
        super(track);
    }
}
