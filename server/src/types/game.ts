import type { MessageEnvelope } from './index';
import type { LobbyPlayer } from './lobby';

// Full per-host game state as carried on the wire.
export type GameState = {
    car: {
        // Car class name (e.g. "GokartGokartCentralen").
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

// Host notifies the server that a restart is applied (the tick after the
// reset has run: start position, 0 counters, real rays). Server broadcasts
// evt:game/restarted to the lobby.
export type ReqGameRestarted = MessageEnvelope<
    'req:game',
    'restarted',
    { lobbyId: string }
>;

// Server broadcasts to the lobby that a restart is applied — every car was
// reset; game state is ready to fetch.
export type EvtGameRestarted = MessageEnvelope<
    'evt:game',
    'restarted',
    { lobbyId: string }
>;

// Server tells the host to restart the current stage for every car
// (forwarded req:control/restart from a client in the host's lobby).
export type EvtGameRestart = MessageEnvelope<
    'evt:game',
    'restart',
    undefined
>;

// Server tells the host to start the current stage
export type EvtGameStartStage = MessageEnvelope<
    'evt:game',
    'startStage',
    undefined
>;

// Server tells the host to advance to the next stage (the whole lobby).
// completed: false = the stage was skipped.
export type EvtGameNextStage = MessageEnvelope<
    'evt:game',
    'nextStage',
    { completed: boolean }
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
    | ReqGameRestarted
    | ResGameState
    | ResGameStateBatch
    | ResGamePlayerState
    | EvtGameStart
    | EvtGameStartStage
    | EvtGameNextStage
    | EvtGameCompleted
    | EvtGameRestart
    | EvtGameRestarted;
