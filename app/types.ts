import type { GokartSenior } from "./cars/gokarts/GokartSenior";
import type { GoKartTrackOne } from "./tracks/gokarts/125cc/GoKartTrackOne";
import type { GoKartTrackTwo } from "./tracks/gokarts/125cc/GoKartTrackTwo";
import type { TrackOne } from "./tracks/TrackOne";
import type { TrackTwo } from "./tracks/TrackTwo";

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
    brakeDeceleration: number;
    maxSpeed: number;
    rotationSpeed: number;
    hasCollision: boolean;
    rays: number[];
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
        rays: number[];
    };
    lapTime: number;
    lastLapTime: number;
    totalCheckpoints: number;
    completedLaps: number;
    currentCheckpoint: number;
}

export interface RacingGameProps {
    gameMode: GameMode;
    gameTrack: typeof TrackOne | typeof TrackTwo | typeof GoKartTrackOne | typeof GoKartTrackTwo;
    gameCar: typeof GokartSenior;
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