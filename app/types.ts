import type { TrackOne } from "./Tracks/TrackOne";
import type { TrackTwo } from "./Tracks/TrackTwo";

export type GameMode = 'player' | 'ai';

export interface Car {
    x: number;
    y: number;
    width: number;
    height: number;
    speed: number;
    angle: number;
    acceleration: number;
    deceleration: number;
    maxSpeed: number;
    rotationSpeed: number;
    hasCollision: boolean;
    rays: {
        center: number;
        left: number;
        right: number;
    };
    previousFront?: {
        x: number;
        y: number;
    };
}

export interface RacingGameState {
    lapTime: number;
    lastLapTime: number;
    totalCheckpoints: number;
    completedLaps: number;
    passedCheckpoints: boolean[];
    currentCheckpoint: number;
}

export interface ControlsState {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    brake: boolean;
    restart: boolean;
}

export interface GameState {
    car: {
        speed: number;
        angle: number;
        hasCollision: boolean;
        rays: {
            center: number;
            left: number;
            right: number;
        };
    };
    lapTime: number;
    lastLapTime: number;
    totalCheckpoints: number;
    completedLaps: number;
    currentCheckpoint: number;
}

export interface RacingGameProps {
    gameMode: GameMode;
    gameTrack: typeof TrackOne | typeof TrackTwo;
}

export interface StatsBoxProps {
    speed: number;
    angle: number;
    x: number;
    y: number;
    hasCollision: boolean;
    lapTime: number;
    currentCheckpoint: number;
    totalCheckpoints: number;
    completedLaps: number;
}