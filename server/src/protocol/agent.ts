import type { Envelope } from './envelope';
import type { GameState } from './state';


// Where a stage is raced.
export type StageInfo = { index: number; track: string; layout: string; loop: boolean; laps: number };

// One car's controls. steering: -1 (full left) .. 1 (full right) × the
// car's steering lock.
export type CarControls = { forward: boolean; backward: boolean; steering: number; brake: boolean };

// Join a lobby with one or more cars. `token` rejoins later as the same
// agent with the same cars (req:agent/rejoin, phase 4).
export type ReqAgentJoin = Envelope<'req:agent', 'join', { lobbyId: string; cars: { name: string; kart: string }[] }>;
export type ResAgentJoin = Envelope<'res:agent', 'join', {
    agentId: string;
    token: string;
    cars: { carId: string; name: string; kart: string }[];
}>;
export type ResAgentJoinError = Envelope<'res:agent', 'joinError', { reason: string }>;
export type ReqAgentRejoin = Envelope<'req:agent', 'rejoin', { token: string }>;
export type ReqAgentLeave = Envelope<'req:agent', 'leave'>;

// The race: the server pushes the state of the agent's own cars every
// tick; the agent answers with controls (for that tick).
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
