// One car's game state — the SAME data for an agent's cars
// (evt:agent/state) and the App's keyboard car (evt:player/state), every
// tick, in each flow's own message.
// (Unchanged from the old protocol.)
export type GameState = {
    car: {
        // Car class name (e.g. "HyrkartCentralen").
        name: string;
        speed: number;
        // km/h, same unit as speed (reverse is capped at -maxSpeed / 2).
        maxSpeed: number;
        // Car centre in world px (24 px = 1 m), same coordinates as the
        // track and its checkpoints.
        x: number;
        y: number;
        // The car's 4 corners in world px, clockwise on screen (y down):
        // front-left, front-right, rear-right, rear-left.
        corners: { x: number; y: number }[];
        angle: number;
        // Steering wheel applied now, -1..1 (4 decimals): -1 full left, 1 full
        // right, relative to this car's steering lock.
        steering: number;
        // Front-wheel angle now, degrees (2 decimals), + = right:
        // steering × the car's wheel lock.
        wheelAngle: number;
        // Direction of travel vs. the track (centreline at the car):
        // 1 = the correct way, -1 = the wrong way, 0 = standing still or
        // blocked by a collision.
        heading: -1 | 0 | 1;
        // The nose points the correct way (within ±90° of the track direction).
        facing: boolean;
        hasCollision: boolean;
        // Tyre slip, normalised (4 decimals; -1..1 with + = right, or 0–1).
        // All 0 while reversing (no slide there).
        // Turn rate ÷ the most the grip allows at this speed (gripG × 9.81 /
        // speed): 1 = rotating as fast as the tyres can carry. Less than the
        // steering asks = understeer.
        yawRate: number;
        // Angle between the nose and the direction of travel ÷ 90°:
        // 0 = clean, 1 = sliding fully sideways.
        slipAngle: number;
        // Each axle's tyre slip angle ÷ 90°: the axle's direction of travel
        // vs where its tyres point (the front's includes the steering).
        // + = moving to the right of them. Front larger than rear =
        // understeer, rear larger = oversteer. The tyres grip most at a few
        // degrees (~0.07–0.09), past it they slide.
        slipAngleFront: number;
        slipAngleRear: number;
        // Sideways acceleration (accelerometer) ÷ the car's grip:
        // 1 = at the grip limit.
        lateralG: number;
        // Acceleration along the nose (accelerometer) ÷ the car's grip:
        // + = speeding up, − = braking, -1..1.
        longitudinalG: number;
        // Sideways speed ÷ maxSpeed.
        lateralSpeed: number;
        // Share of the front / rear tyres' grip in use, 0–1: 1 = that axle is
        // at its limit (front at 1, rear lower = understeer).
        gripFront: number;
        gripRear: number;
        rays: number[];
    };
    track: {
        name: string;
        // Layout name within the track file (e.g. "Training 1").
        layout: string;
        // true = loop (laps over the start/finish line); false = one-way
        // (reaching the finish ends the stage).
        loop: boolean;
        totalCheckpoints: number;
        currentCheckpoint: number;
        // Laps the current stage requires (session JSON); fixed for the stage.
        laps: number;
        // Laps completed in the current stage. The stage is complete when
        // completedLaps >= laps; a one-way finish sets completedLaps = laps.
        completedLaps: number;
        // Metres driven this stage (all laps) from the spawn, from the car
        // centre: the lead-in to the start line (lap 1 only), then along the
        // centreline. Updates every tick, only goes up, clamped at each next
        // checkpoint until it's crossed. Stops at lead-in + the full distance
        // when the stage is completed; 0 again on restart / a new stage.
        completedMeters: number;
        // Share of the current lap still to drive, 0–1 (4 decimals), built on
        // completedMeters minus the lead-in. 1 until past the start line, then only goes
        // down; a new lap starts at 1 again. 0 when the stage is completed
        // (held); 1 again on restart / a new stage.
        lapDistance: number;
        // Current lap's running time (seconds). Resets to 0 on lap complete
        // AND on restart. Compare against expectedLapTime for per-lap performance.
        lapTime: number;
        // Previous completed lap's time (seconds). 0 if no lap has completed yet.
        lastLapTime: number;
        // Target lap time for this car class on this track (seconds). 0 means
        // "not configured" — the (track, car) pair has no benchmark set.
        expectedLapTime: number;
    };
    stage: {
        completed: boolean;
    };
    session: {
        completed: boolean;
    };
};
