import type { GameState } from '../protocol';
import type { Player } from '../game/Player';
import { carCorners } from '../game/engine/carBody';

// One car's GameState, as an agent (evt:agent/state) or the App's keyboard
// car (evt:player/state) gets it every tick. Same values as the old
// protocol (app/views/AiView.ts buildGameState).
export function buildGameState(player: Player): GameState {
    const progress = player.progress;
    const lapTimes = player.stage().lapTimes;
    const currentLapTime = lapTimes.length > 0 ? lapTimes[lapTimes.length - 1] : 0;
    const lastCompletedLapTime = lapTimes.length > 1 ? lapTimes[lapTimes.length - 2] : 0;
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
