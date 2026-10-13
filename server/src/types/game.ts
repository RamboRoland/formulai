import type { MessageEnvelope } from './index';
import type { LobbyPlayer } from './lobby';

// Full per-host game state as carried on the wire.
export type GameState = {
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

// Player asks server to fetch their per-player game state from the host
export type ReqGameRequestPlayerState = MessageEnvelope<
    'req:game',
    'requestPlayerState',
    { lobbyId: string }
>;

// Bidirectional use of the same (ns, action) on the wire:
//   Server -> Host: { lobbyId, playerId }              — "publish this player's state"
//   Host -> Server: { playerId, gameState }            — "here is that player's state"
// Handlers must narrow with `'gameState' in data` to distinguish.
export type ReqGamePlayerState = MessageEnvelope<
    'req:game',
    'playerState',
    | { lobbyId: string; playerId: string }
    | { playerId: string; gameState: GameState }
>;

// Host asks server to start the game in its lobby
export type ReqGameStart = MessageEnvelope<
    'req:game',
    'start',
    { lobbyId: string }
>;

// Per-requester state RPC. The payload always carries `clientId` so the server
// can route the response back to the specific requester (not broadcast). The
// host echoes clientId when responding so the server knows who to send to.
//
//   Control -> Server: { clientId }                — "AI asks for state for clientId"
//   Server  -> Host:   { clientId }                — "server forwards the ask"
//   Host    -> Server: { clientId, gameState }     — "host publishes state for clientId"
//   Server  -> Control (specific requester only): res:game/state <gameState>
//
// Handler on the server narrows by sender client type (control/multiplayer vs
// game) and by `'gameState' in data`.
export type ReqGameState = MessageEnvelope<
    'req:game',
    'state',
    | { clientId: string }
    | { clientId: string; gameState: GameState }
>;

// Host publishes its full game state (single-player AI polling)
export type ResGameState = MessageEnvelope<
    'res:game',
    'state',
    GameState
>;

// Server delivers a player's game state to that player (multiplayer)
export type ResGamePlayerState = MessageEnvelope<
    'res:game',
    'playerState',
    { gameState: GameState }
>;

// Server broadcasts to lobby that the game is starting
export type EvtGameStart = MessageEnvelope<
    'evt:game',
    'start',
    {
        lobbyId: string;
        players: LobbyPlayer[];
        session: string;
        track: string | null;
    }
>;

// Host notifies the server that the game is done (e.g. all players finished
// all stages). Server broadcasts evt:game/completed to the lobby so AIs can
// stop their decision loops and clean up.
export type ReqGameCompleted = MessageEnvelope<
    'req:game',
    'completed',
    { lobbyId: string }
>;

// Server broadcasts to the lobby that the game is done.
export type EvtGameCompleted = MessageEnvelope<
    'evt:game',
    'completed',
    { lobbyId: string }
>;

// Server tells the host to start the current stage
export type EvtGameStartStage = MessageEnvelope<
    'evt:game',
    'startStage',
    undefined
>;

// Server tells the host to advance to the next stage
export type EvtGameNextStage = MessageEnvelope<
    'evt:game',
    'nextStage',
    undefined
>;

// Batch state RPC for multi-actor AIs. One AI can request state for N actors
// in a single round-trip. Variants:
//   Control -> Server: { clientIds }
//   Server  -> Host:   { requesterId, clientIds }
//   Host    -> Server: { requesterId, states }
//   Server  -> Control (requester only): res:game/stateBatch { states }
export type ReqGameStateBatch = MessageEnvelope<
    'req:game',
    'stateBatch',
    | { clientIds: string[] }
    | { requesterId: string; clientIds: string[] }
    | { requesterId: string; states: Record<string, GameState> }
>;

export type ResGameStateBatch = MessageEnvelope<
    'res:game',
    'stateBatch',
    { states: Record<string, GameState> }
>;

export type GameMessage =
    | ReqGameRequestPlayerState
    | ReqGamePlayerState
    | ReqGameStart
    | ReqGameState
    | ReqGameStateBatch
    | ReqGameCompleted
    | ResGameState
    | ResGameStateBatch
    | ResGamePlayerState
    | EvtGameStart
    | EvtGameStartStage
    | EvtGameNextStage
    | EvtGameCompleted;
