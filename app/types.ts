import type { Session } from "./sessions/Session";

export type GameMode = 'player' | 'ai';

export interface RacingGameState {
    lapTime: number;
    lastLapTime: number;
    //totalCheckpoints: number;
    //completedLaps: number;
    //passedCheckpoints: boolean[];
    //currentCheckpoint: number;
}

export interface ControlsState {
    forward: boolean;
    backward: boolean;
    // -1 (full left) .. 1 (full right) × the car's rotationSpeed.
    steering: number;
    brake: boolean;
    restart: boolean;
}

export interface GameState {
    car: {
        name: string;
        speed: number;
        maxSpeed: number;
        x: number;
        y: number;
        angle: number;
        hasCollision: boolean;
        rays: number[];
    };
    track: {
        name: string;
        layout: string;
        loop: boolean;
        totalCheckpoints: number;
        currentCheckpoint: number;
        laps: number;
        completedLaps: number;
        lapTime: number;
        lastLapTime: number;
    };
    stage: {
        completed: boolean;
    };
    session: {
        completed: boolean;
    };
}

export interface RacingGameProps {
    gameMode: GameMode;
    gameSession: Session;
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