import { G } from "./constants";

// The drivetrain (Car.slide → the rear axle's spin, Car.longitudinal in
// reverse; Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3): the
// engine's torque through the gearing, at most its power; engine braking /
// regen off the gas; the governor. Pedals 0..1. Engine rpm from the speed
// given: the rear wheels' (ω·r) in slide, the kart's in reverse. Short
// math names (v, m, …): SYMBOLS.md.

// Engine braking / regen is full with the gas up and gone at this much
// gas (like a torque-mode controller: part gas pulls).
const LIFT_OFF_FADE = 0.1;

// A kart's drivetrain and what slows it (Car.longitudinal). Estimates where
// nothing is published — sources: .claude/tasks/analog-pedals.md.
export type DriveValues = {
    torqueNm: number;          // engine / motor, peak; no curve → flat up to the power limit
    // Engine torque over engine speed [rpm, Nm], rpm rising (the maker's
    // chart): torqueAt. Not set = flat torqueNm (an electric motor).
    torqueCurve?: [number, number][];
    powerW: number;            // engine / motor, peak
    gearRatio: number;         // engine turns per rear axle turn
    efficiency: number;        // share the chain / drive passes on
    wheelRadiusMeters: number; // rear tyre
    dragArea: number;          // CdA, m², kart + driver
    rollingResistance: number; // Crr, tyres on asphalt
    liftOffG: number;          // engine braking / regen off the gas, in g
    liftOffFromKmh: number;    // ... only above this speed (clutch locked); 0 = always
};

// Torque (Nm) at an engine speed (rpm) on a curve: linear between the
// points; below the first → the first (the clutch slips there), above the
// last → the last (fullPull's power limit takes over).
export const torqueAt = (curve: [number, number][], rpm: number): number => {
    if (rpm <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
        const [upperRpm, upperTorque] = curve[i];
        if (rpm <= upperRpm) {
            const [lowerRpm, lowerTorque] = curve[i - 1];
            return lowerTorque + (upperTorque - lowerTorque) * (rpm - lowerRpm) / (upperRpm - lowerRpm);
        }
    }
    return curve[curve.length - 1][1];
};

// Full-gas pull at the rear wheels (N) at wheel speed v (m/s): the
// engine's torque through the gearing, at most its power (torque × ratio ×
// η / r, then power × η / v). Engine rpm = v / r × ratio.
export const fullPull = (drive: DriveValues, v: number): number => {
    const rpm = v / drive.wheelRadiusMeters * drive.gearRatio * 60 / (2 * Math.PI);
    const torque = drive.torqueCurve ? torqueAt(drive.torqueCurve, rpm) : drive.torqueNm;
    return Math.min(torque * drive.gearRatio * drive.efficiency / drive.wheelRadiusMeters, drive.powerW * drive.efficiency / Math.max(v, 0.1));
};

// What the pedals push (N at the tyre, + = forward): gas × fullPull;
// reverse (only without gas) pulls back the same way. The tyres decide
// how much of it reaches the road (slide: tyre.tmeasy via the axle spin).
export const drivePush = (gas: number, backward: number, fullGasForce: number): number => {
    if (gas > 0) return gas * fullGasForce;
    if (backward > 0) return -backward * fullGasForce;
    return 0;
};

// The drive on the rear axle (N at the tyre) at wheelSpeed (m/s):
// the gas only — reverse does nothing until the kart stands still (Robin
// 2026-11-13; none of the karts reverses while rolling: the 270cc has no
// reverse, the Centralen backs up from standstill), then Car.applyControls
// switches to reverse. Cut by the governor / limiter on WHEEL speed at
// maxSpeed (km/h; the engine sees the wheels, not the ground).
export const axleDrive = (drive: DriveValues, gas: number, wheelSpeed: number, maxSpeed: number): number => {
    const driveForce = drivePush(gas, 0, fullPull(drive, wheelSpeed));
    return driveForce > 0 && wheelSpeed >= maxSpeed / 3.6 ? 0 : driveForce;
};

// Engine braking / regen off the gas (N): liftOffG × m × g with the gas
// up, fading out by LIFT_OFF_FADE gas; only above liftOffFromKmh (clutch
// locked). Brakes through the rear axle (rearAxle.spinStep).
export const liftOffForce = (drive: DriveValues, v: number, gas: number, massKg: number): number =>
    v * 3.6 > drive.liftOffFromKmh ? Math.max(0, 1 - gas / LIFT_OFF_FADE) * drive.liftOffG * massKg * G : 0;

// Reverse (Car.longitudinal): capped at maxSpeed (km/h; governor / speed
// limiter / rev limit), backwards at half of it (the real karts mostly
// have none; it backs up from standstill — a crashed kart stays put until
// it restarts, GameEngine.tickPlayer).
export const governed = (speed: number, maxSpeed: number): number =>
    Math.max(-maxSpeed / 2, Math.min(maxSpeed, speed));
