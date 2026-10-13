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
    track: {
        name: string;
        totalCheckpoints: number;
        currentCheckpoint: number;
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