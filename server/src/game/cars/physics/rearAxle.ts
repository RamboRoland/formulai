import type { SlipValues } from "../Car";
import { G } from "./constants";
import type { DriveValues } from "./drivetrain";
import { airDrag, rollingForce } from "./resistance";
import { peakGrip, slipSpeed } from "./tyre";

// The rigid rear axle (spool, no differential): both wheels turn at ONE
// spin ω — one wheel locks = both lock; the brake and engine braking act
// on it only (rear-only brakes, all three karts). As TORCS simuv2 wheel.cpp
// (torcs.sourceforge.net/api/wheel_8cpp_source.html), one spin state for
// the axle (braking-strength.md 1c, 2a). Short math names (omega, kappa,
// Fx, vx, …): SYMBOLS.md.

// Rear axle (both wheels + sprocket + disc), kg·m² — fastest-lap kart
// (commit 0660208, roberto-lot-kart-2016.xml; axle_car_6dof.hpp :166).
const AXLE_INERTIA = 0.2;
// κ at or below this = locked (estimate: well past the peak at ~−0.1,
// fastest-lap's curve; braking-strength.md 2a).
const LOCKED_SLIP = -0.5;

// The hardest rear-only brakes can stop (m/s²) in the old force model: the
// rear's grip, which the braking itself unloads — μ·g·rearLoadShare / (1 +
// μ·cgHeight / wheelbase). Kept for reverse (Car.longitudinal) and the
// lap-time bot's braking plan (scripts/laptimes.ts).
export const rearBrakeLimit = (gripG: number, rearLoadShare: number, cgHeightPerWheelbase: number): number =>
    gripG * G * rearLoadShare / (1 + gripG * cgHeightPerWheelbase);

// Reverse (Car.longitudinal, no spin state): the brake + engine braking
// (asked, N) against what the rear tyres can stop (rearBrakeMax, N; v m/s,
// standing: nothing to brake); more locks them → slideGrip of it. N.
export const reverseBrake = (asked: number, rearBrakeMax: number, slideGrip: number, v: number): number =>
    v > 0 && asked > rearBrakeMax ? slideGrip * rearBrakeMax : asked;

// The axle's slip ratio κ = (ωr − vx) / |vx| (− = braking, −1 = locked),
// |vx| at least slipSpeed (no ÷ 0 near standstill). omega rad/s,
// wheelRadius m, vx m/s.
export const slipRatio = (omega: number, wheelRadius: number, vx: number): number => (omega * wheelRadius - vx) / slipSpeed(vx);

// Locked: κ ≤ LOCKED_SLIP while moving forward (tyre marks, scrub, the
// outer brake moment, incident logs).
export const isLocked = (kappa: number, vx: number): boolean => vx > 0 && kappa <= LOCKED_SLIP;

// One substep of the axle's spin (rad/s): I·ω̇ = drive − brake·sgn ω − r·Fx
// (Fx: the rear tyres along the nose, N; drive / brake: N at the tyre).
// Semi-implicit, linearised in κ: Fx(ω⁺, vx⁺) ≈ Fx + K·(r·Δω − Δvx) / |vx|
// (K = longitudinalStiffness = dFx/dκ, tyre.tmeasy; r = wheelRadius) —
// stable at any speed (explicit Euler is unstable at low v: wheel mode ≈
// K·r² / (I·v)); the kart's own speed
// change this substep (dvx, explicit) included, else the stiffness term
// drags ω behind a decelerating kart (plain semi-implicit: fake inertia,
// −0.03 g; 2a). The brake only stops ω, never reverses it (TORCS
// wheel.cpp :408–413); never below 0 (the slide is forward only).
// omega: the axle's spin (rad/s); dvx: the kart's Δvx this substep (m/s).
export const spinStep = (omega: number, dt: number, drive: number, brake: number, Fx: number, longitudinalStiffness: number,
    vx: number, dvx: number, wheelRadius: number): number => {
    const stiffnessPerSpeed = longitudinalStiffness / slipSpeed(vx);
    const effectiveInertia = AXLE_INERTIA + dt * wheelRadius * wheelRadius * stiffnessPerSpeed;
    const omegaUnbraked = omega + dt * (drive * wheelRadius - wheelRadius * Fx + wheelRadius * stiffnessPerSpeed * dvx) / effectiveInertia;
    const brakeOmegaStep = dt * brake * wheelRadius / effectiveInertia;
    return Math.max(0, omegaUnbraked > brakeOmegaStep ? omegaUnbraked - brakeOmegaStep
        : omegaUnbraked < -brakeOmegaStep ? omegaUnbraked + brakeOmegaStep : 0);
};

// The brake (0..1) at which the rear wheels lock with the gas up (1 =
// never): straight, the axle's peak Fx (two wheels at half the axle load,
// tyre.peakGrip) under the transfer its own braking makes. Worst case over
// a stop: at top speed (drag + rolling move load forward too) — below it
// the rear holds a little more. The brake torque at the lock = the tyres'
// peak × wheelRadius + slowing the axle with the kart (I·a / r); engine
// braking / regen adds its own. brakeDeceleration km/h per second.
export const lockingBrake = (slip: SlipValues, drive: DriveValues, gripG: number, wheelbaseMeters: number,
    maxSpeedKmh: number, brakeDeceleration: number): number => {
    const m = slip.massKg, wheelRadius = drive.wheelRadiusMeters;
    const staticRear = m * G * (1 - slip.rearShare);
    const v = maxSpeedKmh / 3.6;
    const resistance = rollingForce(drive.rollingResistance, m) + airDrag(drive.dragArea, v);
    let deceleration = 0, rearPeak = 0;
    for (let i = 0; i < 40; i++) {
        const Fz = Math.max(0, staticRear - m * deceleration * slip.cgHeightMeters / wheelbaseMeters) / 2; // each rear wheel's load, N
        rearPeak = 2 * peakGrip(gripG, Fz, staticRear / 2, slip.loadSensitivity ?? 0);
        deceleration = (rearPeak + resistance) / m;
    }
    deceleration = rearPeak / m; // the axle's own slowing (I·ω̇)
    const brakeTorque = rearPeak * wheelRadius + AXLE_INERTIA * deceleration / wheelRadius;
    return Math.max(0, Math.min(1, (brakeTorque / wheelRadius / m - drive.liftOffG * G) / (brakeDeceleration / 3.6)));
};

const saturate = (x: number, max: number) => max * Math.tanh(x / max);

// Spool: both wheels turn at one speed, the ground under them differs by
// r × track (r = yaw rate) → each slips ∓ r × track / 2 / v. With u
// (`innerLoadMoved`) of the inner wheel's load moved across, the fight
// between them falls as 1 − u² (zero net force on the axle, Milliken, Race
// Car Vehicle Dynamics ch. 20), at most what the inner wheel can still grip (rearLift = 1 − u).
// Force (N) at each wheel; × rearTrack = the moment against the turn.
// rearWheelLoad: each rear wheel's load (N).
export const spoolForce = (axleStiffness: number, rearWheelLoad: number, r: number, rearTrackMeters: number, vx: number,
    gripG: number, innerLoadMoved: number, rearLift: number): number => {
    const wheelForce = saturate(axleStiffness * rearWheelLoad * r * (rearTrackMeters / 2) / slipSpeed(vx), gripG * rearWheelLoad);
    return Math.sign(wheelForce) * Math.min(Math.abs(wheelForce) * (1 - innerLoadMoved * innerLoadMoved), gripG * rearWheelLoad * rearLift);
};

// Braking with the inner rear lifted (`innerLoadMoved` of its load
// across): the outer rear tyre carries more of the axle's brake force (braking, N: the
// tyres' actual −Fx), half a track from the centre — a moment against the
// turn (Milliken, Race Car Vehicle Dynamics ch. 20; Lot & Dal Bianco 2016).
// Each rear wheel's longitudinal force follows its own load, rolling at
// grip or locked and sliding (sliding friction ∝ load too), so the
// difference is braking × innerLoadMoved in BOTH states — no switch-off at the lock
// (2f: the old "none while locked" made the kart hold, then snap).
export const outerBrakeMoment = (braking: number, innerLoadMoved: number, rearTrackMeters: number): number =>
    braking * innerLoadMoved * rearTrackMeters / 2;

// The axle's yaw moment (N·m): the spool against the turn, the outer
// brake against the side the tyres push (`sideForce`, N, + = right).
export const rearAxleMoment = (spoolWheelForce: number, rearTrackMeters: number, sideForce: number, outerBrake: number): number =>
    -spoolWheelForce * rearTrackMeters - Math.sign(sideForce) * outerBrake;
