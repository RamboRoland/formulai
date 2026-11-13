// The steering (Car.applyControls, Car.slide): controls.steering → the
// steering wheel → the front wheels. Short math names (delta, L, dt):
// SYMBOLS.md.

// controls.steering is -1..1 (the AI / keyboard side); the car works in
// degrees (+ = right). The steering wheel's new angle: towards steering ×
// steeringLock, with a steeringRate (°/s, a driver's hands) at most that
// fast (no human goes 0 → full lock in one tick); not set → at once. Not
// a number → 0.
export const steeringWheel = (current: number, steering: number, steeringLock: number,
    steeringRate: number | undefined, dt: number): number => {
    const normalized = Number.isFinite(steering) ? Math.max(-1, Math.min(1, steering)) : 0;
    const target = normalized * steeringLock;
    if (steeringRate) {
        const maxStep = steeringRate * dt;
        return current + Math.max(-maxStep, Math.min(maxStep, target - current));
    }
    return target;
};

// The front wheels (degrees) follow the steering wheel by the ratio
// wheelLock / steeringLock.
export const wheelAngleFrom = (steeringAngle: number, wheelLock: number, steeringLock: number): number =>
    steeringAngle * wheelLock / steeringLock;

// Ackermann geometry: each front wheel's angle (rad) for the mean angle
// delta (rad) — the inner wheel steers more, both aim at one turn centre
// on the rear axle line. [inner, outer]; straight → [0] (one wheel = the
// whole axle; each carries 1 / length of the axle's grip).
export const frontWheels = (delta: number, L: number, frontTrackMeters: number): number[] => {
    const radius = Math.abs(delta) > 1e-4 ? L / Math.tan(Math.abs(delta)) : 0;
    return radius > 0
        ? [Math.atan(L / Math.max(radius - frontTrackMeters / 2, 1e-3)), Math.atan(L / (radius + frontTrackMeters / 2))]
            .map(wheelAngle => Math.sign(delta) * wheelAngle)
        : [0];
};
