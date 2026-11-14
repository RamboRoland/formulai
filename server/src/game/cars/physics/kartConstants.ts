import type { Car } from "../Car";
import { staticLoads } from "./loads";
import { lockingBrake, rearBrakeLimit } from "./rearAxle";
import { rollingForce } from "./resistance";
import { magicFormula } from "./tyre";

// Everything a kart's physics works out from its own values alone (no
// state, no controls): computed ONCE per kart class, the first time a kart
// of that class asks, then reused by every kart of the class for the life
// of the process — a deploy starts a new one (Robin 2026-11-14: "static
// values calculated once and then used per build"; plan
// .claude/tasks/kart-values.md). Short math names (a, b, L, m): SYMBOLS.md.
//
// A kart's values must not change after the first kart of its class is
// built — a script that tries values builds its own class for each
// (scripts/sensitivity.ts).
export type KartConstants = {
    a: number;                   // CoG → front axle (m)
    b: number;                   // CoG → rear axle (m)
    staticFront: number;         // front axle load standing (N)
    staticRear: number;          // rear axle load standing (N)
    frontTyreForce: (alpha: number, peakForce: number) => number; // tyre.magicFormula with the kart's shape
    rollingForce: number;        // Crr·m·g (N)
    sinWheelLock: number;        // sin of the full-lock wheel angle (loads.innerRearLift)
    meanTrackMeters: number;     // (rear + front track) / 2 (roll, loads.innerRearLift)
    brakeLock: number;           // rearAxle.lockingBrake (Car.brakeLock)
    reverseBrakeMax: number;     // rearAxle.rearBrakeLimit × m (N, Car.longitudinal)
};

const byClass = new Map<Function, KartConstants>();

export const kartConstants = (car: Car): KartConstants => {
    let constants = byClass.get(car.constructor);
    if (!constants) {
        constants = compute(car);
        byClass.set(car.constructor, constants);
    }
    return constants;
};

const compute = (car: Car): KartConstants => {
    const slip = car.slip!, drive = car.drive, m = slip.massKg, L = car.wheelbaseMeters;
    const b = L * slip.rearShare, a = L - b;
    const { front: staticFront, rear: staticRear } = staticLoads(m, a, b, L);
    return {
        a, b, staticFront, staticRear,
        frontTyreForce: magicFormula(slip.peakSlipDeg, slip.slideGrip),
        rollingForce: rollingForce(drive.rollingResistance, m),
        sinWheelLock: Math.sin(car.wheelLock * Math.PI / 180),
        meanTrackMeters: (slip.rearTrackMeters + slip.frontTrackMeters) / 2,
        brakeLock: lockingBrake(slip, drive, car.gripG, L, car.maxSpeed, car.brakeDeceleration),
        reverseBrakeMax: rearBrakeLimit(car.gripG, 1 - slip.rearShare, slip.cgHeightMeters / L) * m,
    };
};
