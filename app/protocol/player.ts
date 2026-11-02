import type { Envelope } from './envelope';
import type { CarControls } from './agent';
import type { GameState } from './state';

// The App's keyboard car — its own flow, separate from agents, with the
// same per-tick car state an agent gets (evt:player/state).
export type ReqPlayerJoin = Envelope<'req:player', 'join', { lobbyId: string; name: string; kart: string }>;
export type ResPlayerJoin = Envelope<'res:player', 'join', { playerId: string; carId: string }>;
export type ResPlayerJoinError = Envelope<'res:player', 'joinError', { reason: string }>;
export type EvtPlayerState = Envelope<'evt:player', 'state', { tick: number; car: GameState & { carId: string } }>;
export type ReqPlayerControls = Envelope<'req:player', 'controls', CarControls>;
// Restarts the player's own car only.
export type ReqPlayerRestart = Envelope<'req:player', 'restart'>;
export type ReqPlayerLeave = Envelope<'req:player', 'leave'>;

export type PlayerMessage =
    | ReqPlayerJoin | ResPlayerJoin | ResPlayerJoinError
    | EvtPlayerState | ReqPlayerControls | ReqPlayerRestart | ReqPlayerLeave;
