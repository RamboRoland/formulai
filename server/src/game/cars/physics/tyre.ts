// The tyres' grip budget (Car.slide, Car.longitudinal): slip + load →
// force, and what one direction leaves the other. Pure functions.

// The lowest speed the slip angles are worked out with (m/s; no ÷ 0 near
// standstill).
const SLIP_MIN_SPEED = 1;
export const slipSpeed = (v: number): number => Math.max(Math.abs(v), SLIP_MIN_SPEED);

// Side force from the slip angle — Pacejka's Magic Formula F = max ×
// sin(C × atan(B × α)): most grip (max, gripG × the load) at peakSlipDeg,
// less beyond it, slideGrip of it when fully sliding (so full lock at
// speed ploughs). C from slideGrip (sin(C × 90°) = slideGrip), B puts the
// peak at peakSlipDeg. Returns F(α, max).
export const magicFormula = (peakSlipDeg: number, slideGrip: number): (alpha: number, max: number) => number => {
    const shape = 2 - (2 / Math.PI) * Math.asin(slideGrip);
    const stiff = Math.tan(Math.PI / (2 * shape)) / (peakSlipDeg * Math.PI / 180);
    return (alpha, max) => max * Math.sin(shape * Math.atan(stiff * alpha));
};

// A steered wheel's slip angle (rad, + = it moves to the right of where
// it points): its velocity (vx along the nose, vy across, m/s) in its own
// direction d (rad).
export const wheelSlip = (vx: number, vy: number, d: number): number =>
    Math.atan((-vx * Math.sin(d) + vy * Math.cos(d)) / slipSpeed(vx * Math.cos(d) + vy * Math.sin(d)));

// An unsteered axle's slip angle (rad): across / along (m/s).
export const axleSlip = (across: number, along: number): number =>
    Math.atan(across / slipSpeed(along));

// Locked tyre: a sliding tyre pushes against its own sliding, sideways
// only as much as it slides sideways (Coulomb), slideGrip of its grip.
export const slidingForce = (slideGrip: number, max: number, across: number, along: number): number =>
    -slideGrip * max * across / Math.max(Math.hypot(along, across), 1e-6);

// Friction ellipse: the share of a tyre's grip left sideways when `used`
// (0..1) of it brakes.
export const gripLeft = (used: number): number => Math.sqrt(1 - used * used);

// The share of the rear grip left to push with (gas) while turning uses
// gripRear of it (from the last slide: a sliding rear can't push).
export const tractionLeft = (gripRear: number): number =>
    Math.sqrt(Math.max(0, 1 - Math.min(1, gripRear) ** 2));
