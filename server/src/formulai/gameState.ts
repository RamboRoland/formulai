import type { GameState } from '../protocol';
import type { Player } from '../game/Player';
import { carCorners } from '../game/engine/carBody';

// Sideways values normalised for the AI (4 decimals; signed ones -1..1,
// + = right). Lowest speed for the yaw rate's limit: as Car.slide (m/s).
const G = 9.81;
const MIN_SPEED = 1;
const norm = (x: number, min = -1) => Math.round(Math.max(min, Math.min(1, x)) * 10000) / 10000;

// One car's GameState, as an agent (evt:agent/state) or the App's keyboard
// car (evt:player/state) gets it every tick. Same values as the old
// protocol (app/views/AiView.ts buildGameState).
export function buildGameState(player: Player): GameState {
    const progress = player.progress;
    const lapTimes = player.stage().lapTimes;
    const currentLapTime = lapTimes.length > 0 ? lapTimes[lapTimes.length - 1] : 0;
    const lastCompletedLapTime = lapTimes.length > 1 ? lapTimes[lapTimes.length - 2] : 0;
    const car = player.car;
    const forward = Math.max(car.speed / 3.6, MIN_SPEED); // m/s
    return {
        car: {
            name: player.car.name,
            speed: Math.round(player.car.speed * 100) / 100,
            maxSpeed: player.car.maxSpeed,
            // Centre (car.x / car.y are the corner, see Car.reset).
            x: Math.round((player.car.x + player.car.widthPx / 2) * 100) / 100,
            y: Math.round((player.car.y + player.car.lengthPx / 2) * 100) / 100,
            // Clockwise on screen: front-left, front-right, rear-right, rear-left.
            corners: carCorners(player.car).map(p => ({
                x: Math.round(p.x * 100) / 100,
                y: Math.round(p.y * 100) / 100,
            })),
            angle: Math.round(player.car.angle * 100) / 100,
            // -1..1 for the AI; the car works in degrees.
            steering: Math.round(player.car.steeringAngle / player.car.steeringLock * 10000) / 10000,
            wheelAngle: Math.round(player.car.wheelAngle * 100) / 100,
            heading: player.car.heading,
            facing: player.car.facing,
            hasCollision: player.car.hasCollision,
            // Tyre slip (0 while reversing — no slide there):
            // turn rate ÷ the most grip allows at this speed (gripG × g / v).
            yawRate: norm(car.yawRate / (car.gripG * G / forward)),
            // Nose vs direction of travel ÷ 90°.
            slipAngle: norm(Math.atan(car.lateralSpeed / forward) / (Math.PI / 2)),
            // Sideways acceleration ÷ gripG (1 = at the grip limit).
            lateralG: norm(car.lateralG / car.gripG),
            // Acceleration along the nose ÷ gripG (+ = speeding up, − = braking).
            longitudinalG: norm(car.longitudinalG / car.gripG),
            // Sideways speed ÷ maxSpeed.
            lateralSpeed: norm(car.lateralSpeed * 3.6 / car.maxSpeed),
            // Share of each axle's grip in use, 0–1.
            gripFront: norm(car.gripFront, 0),
            gripRear: norm(car.gripRear, 0),
            rays: player.car.rays.map(r => Math.round(r * 100) / 100),
        },
        track: {
            name: progress.stage().track.name,
            layout: progress.stage().track.layoutName,
            loop: progress.stage().track.isLoop,
            lapTime: Math.round(currentLapTime * 100) / 100,
            lastLapTime: Math.round(lastCompletedLapTime * 100) / 100,
            totalCheckpoints: progress.stage().track.checkpoints.length,
            laps: player.stage().laps,
            completedLaps: player.stage().lapsCompleted,
            completedMeters: Math.round(player.stage().completedMeters * 100) / 100,
            lapDistance: Math.round(player.lapDistance(progress.stage().track) * 10000) / 10000,
            currentCheckpoint: player.stage().currentCheckpoint,
            expectedLapTime: progress.stage().track.getExpectedLapTimeFor(player.car.constructor.name),
        },
        stage: { completed: player.isStageCompleted(player.stage()) },
        session: { completed: progress.isCompleted() },
    };
}
