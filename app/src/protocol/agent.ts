import type { Envelope } from './envelope';
import type { GameState } from './state';


// Where a stage is raced.
export type StageInfo = { index: number; track: string; layout: string; loop: boolean; laps: number };

// One car's controls. forward (gas), backward (reverse), brake: 0 (off) .. 1
// (fully pressed); true / false are taken as 1 / 0. steering: -1 (full
// left) .. 1 (full right) × the car's steering lock.
export type CarControls = { forward: number; backward: number; steering: number; brake: number };

// Join a lobby with one or more cars. `token` rejoins later as the same
// agent with the same cars (req:agent/rejoin, phase 4). name: the client's
// name, shown to viewers (up to 40 characters; not set / empty → "agent
// <first 6 of its id>"). stateMs: get the state every this many ms of real
// time (whole number 16–1000, default 150); ignored in fast training
// (every tick). repeat (training lobbies): true = endless (every stage
// completed → stage 1 again, never completed), false / not set = once
// through. Race lobbies: always once through (one shared progress).
export type ReqAgentJoin = Envelope<'req:agent', 'join', { lobbyId: string; name?: string; cars: { name: string; kart: string }[]; stateMs?: number; repeat?: boolean }>;
export type ResAgentJoin = Envelope<'res:agent', 'join', {
    agentId: string;
    token: string;
    cars: { carId: string; name: string; kart: string }[];
    stateMs: number | null; // null = fast training (every tick)
    repeat: boolean; // the one used (a rejoin keeps the join's)
}>;
export type ResAgentJoinError = Envelope<'res:agent', 'joinError', { reason: string }>;
// stateMs: as in join; not set → the one from the join before.
export type ReqAgentRejoin = Envelope<'req:agent', 'rejoin', { token: string; stateMs?: number }>;
export type ReqAgentLeave = Envelope<'req:agent', 'leave'>;

// The race: the server pushes the state of the agent's own cars every
// stateMs (fast training: every tick, and waits for the answer); the agent
// answers with controls (for that tick). `tick` is the agent's own: 0 at
// the first step after its join / rejoin / a restart (req:agent/restart,
// any of its cars), +1 per step — not the lobby's age.
export type EvtAgentStart = Envelope<'evt:agent', 'start', { stage: StageInfo }>;
export type EvtAgentState = Envelope<'evt:agent', 'state', { tick: number; cars: (GameState & { carId: string })[] }>;
export type ReqAgentControls = Envelope<'req:agent', 'controls', { tick: number; cars: (CarControls & { carId: string })[] }>;

// Decisions: restart some of your OWN cars (other ids are ignored; nobody
// else is touched; `restarted` lists the cars restarted, after one step);
// leave the stage (completed or skipped).
export type ReqAgentRestart = Envelope<'req:agent', 'restart', { carIds: string[] }>;
export type EvtAgentRestarted = Envelope<'evt:agent', 'restarted', { carIds: string[] }>;
export type ReqAgentNextStage = Envelope<'req:agent', 'nextStage', { completed: boolean }>;
export type EvtAgentStage = Envelope<'evt:agent', 'stage', { stage: StageInfo }>;
export type EvtAgentCompleted = Envelope<'evt:agent', 'completed'>;

export type AgentMessage =
    | ReqAgentJoin | ResAgentJoin | ResAgentJoinError | ReqAgentRejoin | ReqAgentLeave
    | EvtAgentStart | EvtAgentState | ReqAgentControls
    | ReqAgentRestart | EvtAgentRestarted | ReqAgentNextStage | EvtAgentStage | EvtAgentCompleted;
