import type { MessageEnvelope } from './index';

// Directional inputs a control client sends over the wire.
export type Controls = {
    forward: boolean;
    backward: boolean;
    // -1 (full left) .. 1 (full right), relative to the car's full lock
    // (GameState car.maxSteering). Clamped by the host; not a number → 0.
    steering: number;
    brake: boolean;
    restart: boolean;
};

// Control client submits controls; server forwards to host.
// Payload carries the sender's clientId so the host can route the controls
// to the correct actor in multi-actor races. Single-actor hosts can ignore
// the id and apply controls to their one actor.
export type ReqControlSend = MessageEnvelope<
    'req:control',
    'send',
    { clientId: string; controls: Controls }
>;

// Control client changes the host's track by name
export type ReqControlSetTrack = MessageEnvelope<
    'req:control',
    'setTrack',
    string
>;

// Control client tells host to start the current stage
export type ReqControlStartStage = MessageEnvelope<
    'req:control',
    'startStage',
    undefined
>;

// Control client tells host to advance to the next stage. The client
// decides: completed = true (stage done) or false (skipped).
export type ReqControlNextStage = MessageEnvelope<
    'req:control',
    'nextStage',
    { completed: boolean }
>;

// Lobby client asks to restart the current stage for EVERY car in its lobby
// (multiplayer; controls.restart is ignored there). Server forwards it to
// that lobby's host as evt:game/restart; evt:game/restarted confirms it.
export type ReqControlRestart = MessageEnvelope<
    'req:control',
    'restart',
    undefined
>;

// Server forwards controls to the host, preserving the sender's clientId.
export type EvtControlUpdate = MessageEnvelope<
    'evt:control',
    'update',
    { clientId: string; controls: Controls }
>;

// Server forwards a track change to the host
export type EvtControlSetTrack = MessageEnvelope<
    'evt:control',
    'setTrack',
    string
>;

// Batch controls for multi-actor AIs. Pack N (clientId, controls) tuples
// into a single message so one AI can drive many actors per frame.
export type ReqControlSendBatch = MessageEnvelope<
    'req:control',
    'sendBatch',
    { items: Array<{ clientId: string; controls: Controls }> }
>;

// Server forwards the batch to the host; host's WsInputController applies
// each item to its stored per-actor controls map.
export type EvtControlUpdateBatch = MessageEnvelope<
    'evt:control',
    'updateBatch',
    { items: Array<{ clientId: string; controls: Controls }> }
>;

export type ControlMessage =
    | ReqControlSend
    | ReqControlSendBatch
    | ReqControlSetTrack
    | ReqControlStartStage
    | ReqControlNextStage
    | ReqControlRestart
    | EvtControlUpdate
    | EvtControlUpdateBatch
    | EvtControlSetTrack;
