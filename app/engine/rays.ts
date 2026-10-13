// Single source of truth for the car's ray-sensor angle layout.
// Index position == meaning; order is historical and only append-only so AI
// clients that read fixed indices from GameState.car.rays keep working.
//
// Angles are offsets (degrees) added to the car's current heading.
export const RAY_ANGLE_OFFSETS = [0, 45, -90, -45, 90, 180, 135, -135] as const;

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

export const RAY_COUNT = RAY_ANGLE_OFFSETS.length;
