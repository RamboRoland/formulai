// Single source of truth for the car's ray-sensor angle layout.
// Index position == meaning; order is historical and only append-only so AI
// clients that read fixed indices from GameState.car.rays keep working.
//
// Angles are offsets (degrees) added to the car's current heading.
// Positive = clockwise on screen = the car's right (steerRight adds angle).
// (Indices 2 and 4 used to be -90 / 90, i.e. swapped vs. their labels.)
export const RAY_ANGLE_OFFSETS = [0, 45, 90, -45, -90, 180, 135, -135] as const;

// Human-readable labels in the same order as RAY_ANGLE_OFFSETS. Useful for
// docs / debug UI; not used by physics or rendering.
export const RAY_DIRECTION_LABELS = [
    'forward',
    'forward-right',
    'right',
    'forward-left',
    'left',
    'back',
    'back-right',
    'back-left',
] as const;

// Where each ray starts on the car's body, same index as RAY_ANGLE_OFFSETS:
// diagonal rays at a corner, straight rays at the middle of an edge.
// [fx, fy] for carPoint (carBody.ts): fx +1 = front, fy +1 = the car's right.
export const RAY_ORIGINS = [
    [1, 0],   // forward       → front edge middle
    [1, 1],   // forward-right → front-right corner
    [0, 1],   // right         → right edge middle
    [1, -1],  // forward-left  → front-left corner
    [0, -1],  // left          → left edge middle
    [-1, 0],  // back          → rear edge middle
    [-1, 1],  // back-right    → rear-right corner
    [-1, -1], // back-left     → rear-left corner
] as const;

export const RAY_COUNT = RAY_ANGLE_OFFSETS.length;
