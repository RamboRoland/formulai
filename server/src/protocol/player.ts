import type { Envelope } from './envelope';
import type { CarControls } from './agent';
import type { GameState } from './state';

// The App's keyboard car — its own flow, separate from agents, with the
// same per-tick car state an agent gets (evt:player/state); `tick` counts
// from its join / last restart, as an agent's.
export type ReqPlayerJoin = Envelope<'req:player', 'join', { lobbyId: string; name: string; kart: string }>;
// The joined kart's handling, for the App's keyboard aids. brakeLock: the
// brake (0..1) at which the rear tyres can't stop any harder (they lock).
export type KartHandling = { wheelbaseMeters: number; gripG: number; wheelLock: number; peakSlipDeg: number; brakeLock: number };
export type ResPlayerJoin = Envelope<'res:player', 'join', { playerId: string; carId: string; handling: KartHandling }>;
export type ResPlayerJoinError = Envelope<'res:player', 'joinError', { reason: string }>;
export type EvtPlayerState = Envelope<'evt:player', 'state', { tick: number; car: GameState & { carId: string } }>;
export type ReqPlayerControls = Envelope<'req:player', 'controls', CarControls>;
// The session is completed (every stage); its times for the end screen.
export type EvtPlayerCompleted = Envelope<'evt:player', 'completed', {
    stageTimes: { stageTime: number; lapTimes: number[] }[];
    totalTime: number;
}>;
// Restarts the player's own car only.
export type ReqPlayerRestart = Envelope<'req:player', 'restart'>;
export type ReqPlayerLeave = Envelope<'req:player', 'leave'>;

export type PlayerMessage =
    | ReqPlayerJoin | ResPlayerJoin | ResPlayerJoinError
    | EvtPlayerState | EvtPlayerCompleted | ReqPlayerControls | ReqPlayerRestart | ReqPlayerLeave;
