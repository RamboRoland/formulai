import { G } from "./constants";

// The drivetrain (Car.slide → the rear axle's spin, Car.longitudinal in
// reverse; Gillespie, Fundamentals of Vehicle Dynamics ch. 2–3): the
// engine's torque through the gearing, at most its power; engine braking /
// regen off the gas; the governor. Pedals 0..1. Engine rpm from the speed
// given: the rear wheels' (ω·r) in slide, the kart's in reverse.

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
        const [rpmB, nmB] = curve[i];
        if (rpm <= rpmB) {
            const [rpmA, nmA] = curve[i - 1];
            return nmA + (nmB - nmA) * (rpm - rpmA) / (rpmB - rpmA);
        }
    }
    return curve[curve.length - 1][1];
};

// Full-gas pull at the rear wheels (N) at wheel speed v (m/s): the
// engine's torque through the gearing, at most its power (torque × ratio ×
// η / r, then power × η / v). Engine rpm = v / r × ratio.
export const fullPull = (d: DriveValues, v: number): number => {
    const rpm = v / d.wheelRadiusMeters * d.gearRatio * 60 / (2 * Math.PI);
    const torque = d.torqueCurve ? torqueAt(d.torqueCurve, rpm) : d.torqueNm;
    return Math.min(torque * d.gearRatio * d.efficiency / d.wheelRadiusMeters, d.powerW * d.efficiency / Math.max(v, 0.1));
};

// What the pedals push (N at the tyre, + = forward): gas × fullPull;
// reverse (only without gas) pulls back the same way. The tyres decide
// how much of it reaches the road (slide: tyre.tmeasy via the axle spin).
export const drivePush = (gas: number, backward: number, pull: number): number => {
    if (gas > 0) return gas * pull;
    if (backward > 0) return -backward * pull;
    return 0;
};

// The drive on the rear axle (N at the tyre) at wheel speed wheelV (m/s):
// drivePush, cut by the governor / limiter on WHEEL speed at maxSpeed
// (km/h; the engine sees the wheels, not the ground).
export const axleDrive = (d: DriveValues, gas: number, backward: number, wheelV: number, maxSpeed: number): number => {
    const drive = drivePush(gas, backward, fullPull(d, wheelV));
    return drive > 0 && wheelV >= maxSpeed / 3.6 ? 0 : drive;
};

// Engine braking / regen off the gas (N): liftOffG × m × g with the gas
// up, fading out by LIFT_OFF_FADE gas; only above liftOffFromKmh (clutch
// locked). Brakes through the rear axle (rearAxle.spinStep).
export const liftOffForce = (d: DriveValues, v: number, gas: number, massKg: number): number =>
    v * 3.6 > d.liftOffFromKmh ? Math.max(0, 1 - gas / LIFT_OFF_FADE) * d.liftOffG * massKg * G : 0;

// Reverse (Car.longitudinal): capped at maxSpeed (km/h; governor / speed
// limiter / rev limit), backwards at half of it (the real karts mostly
// have none; it backs out of a crash).
export const governed = (speed: number, maxSpeed: number): number =>
    Math.max(-maxSpeed / 2, Math.min(maxSpeed, speed));
