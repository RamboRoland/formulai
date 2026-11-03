// Points on the car's body in world px. Shared by the rays (origins), the
// renderer and GameState `car.corners`.
//
// Car local frame: +x = heading (along the length), +y = the car's right
// (angle +90, clockwise on screen). `x / y` is not the centre:
// centre = x + widthPx/2, y + lengthPx/2 (see Car.reset).

// Car and CarRenderState both fit this.
export type CarPose = { x: number; y: number; widthPx: number; lengthPx: number; angle: number };

// (fx, fy) in half-length / half-width units: (1, 0) = front edge middle,
// (1, 1) = front-right corner, (0, -1) = left edge middle, (0, 0) = centre.
export function carPoint(car: CarPose, fx: number, fy: number): { x: number; y: number } {
    const rad = (car.angle * Math.PI) / 180;
    const lx = fx * car.lengthPx / 2;
    const ly = fy * car.widthPx / 2;
    return {
        x: car.x + car.widthPx / 2 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: car.y + car.lengthPx / 2 + lx * Math.sin(rad) + ly * Math.cos(rad),
    };
}

// Clockwise on screen, front-left first: front-left, front-right,
// rear-right, rear-left.
export function carCorners(car: CarPose): { x: number; y: number }[] {
    return [
        carPoint(car, 1, -1),
        carPoint(car, 1, 1),
        carPoint(car, -1, 1),
        carPoint(car, -1, -1),
    ];
}
