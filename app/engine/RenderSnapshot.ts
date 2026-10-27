import type { Track } from '~/tracks/Track';

// The frame-scoped payload the render layer consumes. Grown as needed by
// each migration phase.

// Discipline: numeric fields must be linearly interpolatable (coordinates,
// angles, scalars) so a future WS-driven Interpolator is a drop-in. Non-numeric
// refs like `Track` are treated as identity (stable within a stage, not
// interpolated between frames).

// Per-HUD stats for one car — consumed by StatsBox and similar widgets.
export type CarStatsSnapshot = {
    speed: number;
    angle: number;
    x: number;
    y: number;
    hasCollision: boolean;
    lapTime: number;    // current lap's running time (sec)
    stageTime: number;  // total time in current stage (sec)
    currentCheckpoint: number;
    totalCheckpoints: number;
    completedLaps: number;
};

// Per-car geometry the Renderer needs to paint one frame.
export type CarRenderState = {
    id: string;
    x: number;
    y: number;
    angle: number;
    lengthPx: number;  // along direction of travel
    widthPx: number;   // across direction of travel
    hasCollision: boolean;
    rays: number[];   // 8 distances measured from car center at engine ray angles
    color: string;    // reserved for multi-actor
};

// Camera state for the frame — where and how far to look.
export type CameraState = {
    zoom: number;
    focusX: number;
    focusY: number;
    // Lead-change glide, eased 0 → 1 (1 = settled on selfId's car).
    transition: number;
};

// Full frame payload the Renderer draws.
export type RenderSnapshot = {
    track: Track;
    cars: CarRenderState[];
    selfId?: string;  // car the camera follows (the leader)
    camera: CameraState;
    showBoundingBox: boolean;
    fps: number;
};
