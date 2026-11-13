import { fromMetersToPixels } from "../../helper";
import { G } from "./constants";

// The body (Car.slide, Car.longitudinal in reverse, steer): speed along
// the nose, sideways speed, turn rate, heading.

// Tyre-slip steering: substeps per tick (the tyre forces are stiff — one
// 1/60 s step can blow up).
export const SLIP_SUBSTEPS = 8;
// Below these speeds (m/s) the slip model is blended into the kinematic
// one (the rear axle rolls without slipping): slip angles near standstill
// are noise ÷ ~0 and hold a kart rotating that should stand still
// (Kabzan et al. 2019, AMZ Driverless, arxiv.org/abs/1905.05150).
const KINEMATIC_BELOW = 1;
const SLIP_ABOVE = 3;

// The body in Car.slide's substeps: vx along the nose, vy across (m/s, + =
// right), r turn rate (rad/s), angle (rad).
export type Body = { vx: number; vy: number; r: number; angle: number };

// Speed along the nose (km/h) after a tick of push (N, + = forward) and
// resist (N, against the motion): never past standing still.
export const alongNose = (speed: number, push: number, resist: number, massKg: number, dt: number): number => {
    const pushed = speed + push / massKg * 3.6 * dt;
    const slowed = Math.max(0, Math.abs(pushed) - resist / massKg * 3.6 * dt);
    return Math.sign(pushed) * slowed;
};

// The front wheels' forces (each in its own direction d, rad) in the
// body: side (N, + = right) and drag (N, the scrub, slows the car).
export const frontForces = (wheels: { side: number; d: number }[]): { side: number; drag: number } => ({
    side: wheels.reduce((sum, w) => sum + w.side * Math.cos(w.d), 0),
    drag: wheels.reduce((sum, w) => sum + w.side * Math.sin(w.d), 0),
});

// One substep of the dynamic bicycle model: the axles' side forces (N),
// `along` (m/s², the forces along the nose ÷ m: rear tyres, front scrub,
// rolling, drag), the rear axle's own moment (N·m); a / b = CoG → front /
// rear axle. Turning hands speed over to vy (updated first, vx then uses
// the new vy), never below 0 (a spin doesn't put the kart in reverse),
// at most maxVx (m/s).
export const integrate = (body: Body, frontSide: number, rear: number, along: number, axleMoment: number,
    a: number, b: number, massKg: number, yawInertia: number, maxVx: number, dt: number): void => {
    body.vy += ((frontSide + rear) / massKg - body.vx * body.r) * dt;
    body.vx = Math.min(maxVx, Math.max(0, body.vx + (along + body.vy * body.r) * dt));
    body.r += (a * frontSide - b * rear + axleMoment) / yawInertia * dt;
};

// Low speed: blend r and vy into the kinematic model's (rear axle rolls
// without slipping) — fully below KINEMATIC_BELOW, none above SLIP_ABOVE
// (delta = front wheel angle, rad). Then the heading moves on.
export const kinematicBlend = (body: Body, delta: number, L: number, b: number, dt: number): void => {
    const slipShare = Math.max(0, Math.min(1, (body.vx - KINEMATIC_BELOW) / (SLIP_ABOVE - KINEMATIC_BELOW)));
    if (slipShare < 1) {
        const rKinematic = body.vx * Math.tan(delta) / L;
        body.r = slipShare * body.r + (1 - slipShare) * rKinematic;
        body.vy = slipShare * body.vy + (1 - slipShare) * rKinematic * b;
    }
    body.angle += body.r * dt;
};

// Radians → degrees 0..360.
export const toDegrees = (angle: number): number => ((angle * 180 / Math.PI) % 360 + 360) % 360;

// What steer moves (a Car).
type Kinematic = {
    speed: number; wheelAngle: number; angle: number; x: number; y: number;
    wheelbaseMeters: number; gripG: number;
};

// Kinematic bicycle model: turn rate |v| / wheelbase × tan|wheelAngle|,
// capped by grip at gripG × 9.81 / |v| (rad/s): the steering geometry
// decides at low speed, grip above (~16–19 km/h at full lock).
// Reversing turns the other way (like a real car). No turn at speed 0.
// Pivots around the rear axle (wheelbase / 2 behind the centre, axles
// assumed symmetric): x / y shift so that point stays put.
export const steer = (car: Kinematic, deltaTimeSeconds: number): void => {
    if (car.speed === 0 || car.wheelAngle === 0) return;
    const v = Math.abs(car.speed) / 3.6; // km/h → m/s
    const tan = Math.tan(Math.abs(car.wheelAngle) * Math.PI / 180);
    const rate = Math.min(v / car.wheelbaseMeters * tan, car.gripG * G / v) * 180 / Math.PI;
    const turn = rate * deltaTimeSeconds * Math.sign(car.wheelAngle) * Math.sign(car.speed);
    const before = car.angle * Math.PI / 180;
    car.angle = ((car.angle + turn) % 360 + 360) % 360;
    const after = car.angle * Math.PI / 180;
    const d = fromMetersToPixels(car.wheelbaseMeters) / 2;
    car.x += d * (Math.cos(after) - Math.cos(before));
    car.y += d * (Math.sin(after) - Math.sin(before));
};
