import type { SlipValues } from "../Car";
import { G } from "./constants";

// The axle and wheel loads (N) the tyres grip with (Car.slide): weight
// transfer, the inner rear wheel's lift (load sensitivity: tyre.peakGrip).

// Weight transfer: the axle loads follow the acceleration along the nose
// this much later (s) — a kart has no suspension, but its frame flexes;
// an instant shift feeds back on itself and destabilises.
export const TRANSFER_SECONDS = 0.08;

// Standing still: each axle's share of the weight by the CoG's place (a =
// CoG → front axle, b = CoG → rear axle, L = wheelbase, m).
export const staticLoads = (massKg: number, a: number, b: number, L: number): { front: number; rear: number } =>
    ({ front: massKg * G * b / L, rear: massKg * G * a / L });

// The acceleration along the nose moves load between the axles — m × a ×
// cgHeight / wheelbase (Beckman, The Physics of Racing 1). longAccel = the
// ACTUAL acceleration (tyres, drag, rolling, front scrub; no cap, braking-strength.md 1f),
// already lagged (lag, TRANSFER_SECONDS): braking unloads the rear, so
// turning hard on the brake brings it round. Never below 0.
export const axleLoads = (staticFront: number, staticRear: number, massKg: number, longAccel: number,
    cgHeightMeters: number, L: number): { front: number; rear: number } => {
    const shift = massKg * longAccel * cgHeightMeters / L; // + = onto the rear
    return { front: Math.max(0, staticFront - shift), rear: Math.max(0, staticRear + shift) };
};

// Inner rear wheel lift (no suspension: the frame flexes): the share of
// the inner rear wheel's load (`inner`, N) still on it, 1 = down, 0 =
// lifted. Roll moves side force × cgHeight / mean track across the kart,
// the rear its static share; the steering's caster jacking adds `jacking`
// of the wheel's static load at full lock (delta = front wheel angle,
// rad). Lifted when the two take all the inner wheel's load (lateralG of
// the last substep; braking unloads the rear → it lifts sooner). Roll
// alone lifts it only past ~2 g: in a kart the steering does it, in slow
// corners (Lot & Dal Bianco 2016; frame study,
// real.mtak.hu/209612/1/article-p66.pdf). The chassis rolls onto it over
// liftSeconds (lag).
export const innerRearLift = (s: SlipValues, inner: number, lateralG: number, staticFront: number, staticRear: number,
    delta: number, wheelLockDeg: number): number => {
    const roll = Math.abs(lateralG) * s.massKg * G * s.cgHeightMeters / ((s.rearTrackMeters + s.frontTrackMeters) / 2);
    const jack = staticRear / 2 * s.jacking * Math.sin(Math.abs(delta)) / Math.sin(wheelLockDeg * Math.PI / 180);
    return inner > 0 ? Math.max(0, 1 - (roll * staticRear / (staticFront + staticRear) + jack) / inner) : 0;
};

// A value following its target over `seconds` (first-order lag, step dt).
export const lag = (value: number, target: number, dt: number, seconds: number): number =>
    value + (target - value) * Math.min(1, dt / seconds);
