import type { SlipValues } from "../Car";
import { G } from "./constants";
import type { DriveValues } from "./drivetrain";
import { airDrag, rollingForce } from "./resistance";
import { peakGrip, slipSpeed } from "./tyre";

// The rigid rear axle (spool, no differential): both wheels turn at ONE
// spin ω — one wheel locks = both lock; the brake and engine braking act
// on it only (rear-only brakes, all three karts). As TORCS simuv2 wheel.cpp
// (torcs.sourceforge.net/api/wheel_8cpp_source.html), one spin state for
// the axle (braking-strength.md 1c, 2a).

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
// (asked, N) against what the rear tyres can stop (rearMax, N; v m/s,
// standing: nothing to brake); more locks them → slideGrip of it. N.
export const reverseBrake = (asked: number, rearMax: number, slideGrip: number, v: number): number =>
    v > 0 && asked > rearMax ? slideGrip * rearMax : asked;

// The axle's slip ratio κ = (ωr − vx) / |vx| (− = braking, −1 = locked),
// |vx| at least slipSpeed (no ÷ 0 near standstill). w rad/s, r m, vx m/s.
export const slipRatio = (w: number, r: number, vx: number): number => (w * r - vx) / slipSpeed(vx);

// Locked: κ ≤ LOCKED_SLIP while moving forward (tyre marks, scrub, the
// outer brake moment, incident logs).
export const isLocked = (kappa: number, vx: number): boolean => vx > 0 && kappa <= LOCKED_SLIP;

// One substep of the axle's spin (rad/s): I·ω̇ = drive − brake·sgn ω − r·Fx
// (Fx: the rear tyres along the nose, N; drive / brake: N at the tyre).
// Semi-implicit, linearised in κ: Fx(ω⁺, vx⁺) ≈ Fx + K·(r·Δω − Δvx) / |vx|
// (K = dFx/dκ, tyre.tmeasy) — stable at any speed (explicit Euler is
// unstable at low v: wheel mode ≈ K·r² / (I·v)); the kart's own speed
// change this substep (dvx, explicit) included, else the stiffness term
// drags ω behind a decelerating kart (plain semi-implicit: fake inertia,
// −0.03 g; 2a). The brake only stops ω, never reverses it (TORCS
// wheel.cpp :408–413); never below 0 (the slide is forward only).
export const spinStep = (w: number, dt: number, drive: number, brake: number, Fx: number, K: number,
    vx: number, dvx: number, r: number): number => {
    const kv = K / slipSpeed(vx);
    const iEff = AXLE_INERTIA + dt * r * r * kv;
    const wFree = w + dt * (drive * r - r * Fx + r * kv * dvx) / iEff;
    const stop = dt * brake * r / iEff;
    return Math.max(0, wFree > stop ? wFree - stop : wFree < -stop ? wFree + stop : 0);
};

// The brake (0..1) at which the rear wheels lock with the gas up (1 =
// never): straight, the axle's peak Fx (two wheels at half the axle load,
// tyre.peakGrip) under the transfer its own braking makes. Worst case over
// a stop: at top speed (drag + rolling move load forward too) — below it
// the rear holds a little more. The brake torque at the lock = the tyres'
// peak × r + slowing the axle with the kart (I·a / r); engine braking /
// regen adds its own. brakeDeceleration km/h per second.
export const lockingBrake = (s: SlipValues, d: DriveValues, gripG: number, wheelbaseMeters: number,
    maxSpeedKmh: number, brakeDeceleration: number): number => {
    const m = s.massKg, r = d.wheelRadiusMeters;
    const staticRear = m * G * (1 - s.rearShare);
    const v = maxSpeedKmh / 3.6;
    const other = rollingForce(d.rollingResistance, m) + airDrag(d.dragArea, v);
    let a = 0, peak = 0;
    for (let i = 0; i < 40; i++) {
        const Fw = Math.max(0, staticRear - m * a * s.cgHeightMeters / wheelbaseMeters) / 2;
        peak = 2 * peakGrip(gripG, Fw, staticRear / 2, s.loadSensitivity ?? 0);
        a = (peak + other) / m;
    }
    a = peak / m; // the axle's own slowing (I·ω̇)
    const torque = peak * r + AXLE_INERTIA * a / r;
    return Math.max(0, Math.min(1, (torque / r / m - d.liftOffG * G) / (brakeDeceleration / 3.6)));
};

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
// outer rear tyre carries the axle's brake force (braking, N: the tyres'
// actual −Fx), half a track from the centre — a moment against the turn
// (Milliken ch. 20; Lot & Dal Bianco 2016). None while locked: a locked
// kart spins (no yaw damping, Gillespie, Fundamentals of Vehicle Dynamics
// ch. 3).
export const outerBrakeMoment = (locked: boolean, braking: number, moved: number, rearTrackMeters: number): number =>
    locked ? 0 : braking * moved * rearTrackMeters / 2;

// The axle's yaw moment (N·m): the spool against the turn, the outer
// brake against the side the tyres push (`sideForce`, N, + = right).
export const rearAxleMoment = (spool: number, rearTrackMeters: number, sideForce: number, outerBrake: number): number =>
    -spool * rearTrackMeters - Math.sign(sideForce) * outerBrake;
