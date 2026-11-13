import { G } from "./constants";
import { gripLeft, slidingForce, slipSpeed } from "./tyre";

// The rigid rear axle (spool, no differential): the brake and engine
// braking act on the rear wheels only (all three karts), the two wheels
// turn at one speed.

// The hardest rear-only brakes can stop (m/s²): the rear's grip, which the
// braking itself unloads — μ·g·rearLoadShare / (1 + μ·cgHeight / wheelbase).
export const rearBrakeLimit = (gripG: number, rearLoadShare: number, cgHeightPerWheelbase: number): number =>
    gripG * G * rearLoadShare / (1 + gripG * cgHeightPerWheelbase);

// The hardest the rear tyres can stop the car (m/s²), rearBrakeLimit with
// the kart's static rear share (1 − rearShare).
export const rearStop = (gripG: number, rearShare: number, cgHeightMeters: number, wheelbaseMeters: number): number =>
    rearBrakeLimit(gripG, 1 - rearShare, cgHeightMeters / wheelbaseMeters);

// The brake (0..1) at which the rear wheels lock with the gas up: brake
// + engine braking / regen = what the rear tyres can stop (at speed;
// 1 = they never lock). brakeDeceleration km/h per second.
export const lockingBrake = (stop: number, liftOffG: number, brakeDeceleration: number): number =>
    Math.max(0, Math.min(1, (stop - liftOffG * G) / (brakeDeceleration / 3.6)));

// The brake and engine braking (liftOffN, N) on the rear wheels: at most
// what the rear tyres can stop (rearMax, N); asking for more locks them
// (past a tyre's peak the wheel stops turning at once), and a locked tyre
// slides: slideGrip of it. v m/s (standing: nothing to brake).
// locked / braking (N, what the rear tyres brake: slide's friction
// ellipse) / force (N, slows the car).
export const rearBrake = (liftOffN: number, brake: number, brakeDeceleration: number, massKg: number,
    rearMax: number, slideGrip: number, v: number): { locked: boolean; braking: number; force: number } => {
    const asked = liftOffN + brake * brakeDeceleration / 3.6 * massKg;
    const locked = v > 0 && asked > rearMax;
    return { locked, braking: v > 0 ? asked : 0, force: locked ? slideGrip * rearMax : asked };
};

// The share of the rear grip (N) the braking (N) takes, 0..1.
export const rearBrakeShare = (braking: number, rearGrip: number): number =>
    rearGrip > 0 ? Math.min(1, braking / rearGrip) : 0;

// The rear axle's side force (N): Magic Formula (`tyre`) at its slip angle
// with what the braking leaves (friction ellipse); locked → sliding
// (tyre.slidingForce).
export const rearSideForce = (locked: boolean, tyre: (alpha: number, max: number) => number, slideGrip: number,
    rearGrip: number, across: number, vx: number, slip: number, share: number): number =>
    locked
        ? slidingForce(slideGrip, rearGrip, across, vx)
        : tyre(-slip, rearGrip * gripLeft(share));

const saturate = (x: number, max: number) => max * Math.tanh(x / max);

// Spool: both wheels turn at one speed, the ground under them differs by
// r × track → each slips ∓ r × track / 2 / v. With u (`moved`) of the
// inner wheel's load moved across, the fight between them falls as 1 − u²
// (zero net force on the axle, Milliken, Race Car Vehicle Dynamics ch.
// 20), at most what the inner wheel can still grip (rearLift = 1 − u).
// Force (N) at each wheel; × rearTrack = the moment against the turn.
export const spoolForce = (axleStiffness: number, inner: number, r: number, rearTrackMeters: number, vx: number,
    gripG: number, moved: number, rearLift: number): number => {
    const wheel = saturate(axleStiffness * inner * r * (rearTrackMeters / 2) / slipSpeed(vx), gripG * inner);
    return Math.sign(wheel) * Math.min(Math.abs(wheel) * (1 - moved * moved), gripG * inner * rearLift);
};

// Braking with the inner rear lifted (`moved` of its load across): the
// outer rear tyre carries the axle's brake force, half a track from the
// centre — a moment against the turn (Milliken ch. 20; Lot & Dal Bianco
// 2016). None while locked: a locked kart spins (no yaw damping,
// Gillespie, Fundamentals of Vehicle Dynamics ch. 3).
export const outerBrakeMoment = (locked: boolean, braking: number, rearGrip: number, moved: number, rearTrackMeters: number): number =>
    locked ? 0 : Math.min(braking, rearGrip) * moved * rearTrackMeters / 2;

// The axle's yaw moment (N·m): the spool against the turn, the outer
// brake against the side the tyres push (`sideForce`, N, + = right).
export const rearAxleMoment = (spool: number, rearTrackMeters: number, sideForce: number, outerBrake: number): number =>
    -spool * rearTrackMeters - Math.sign(sideForce) * outerBrake;
