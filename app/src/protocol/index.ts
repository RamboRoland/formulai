// The `formulai` WebSocket protocol — the contract between the server, the
// App and agents. The App keeps its own copy of these types (app/src/protocol)
// — the two copies are kept identical.
import type { SystemMessage } from './system';
import type { LobbyMessage } from './lobby';
import type { AgentMessage } from './agent';
import type { PlayerMessage } from './player';
import type { ViewMessage } from './view';
import type { Namespace } from './envelope';

export type Message = SystemMessage | LobbyMessage | AgentMessage | PlayerMessage | ViewMessage;

// The data of one (ns, action), e.g. DataOf<'req:agent', 'join'>.
export type DataOf<Ns extends Namespace, A extends string> = Extract<Message, { ns: Ns; action: A }>['data'];

export * from './envelope';
export type * from './system';
export type * from './state';
export type * from './lobby';
export type * from './agent';
export type * from './player';
export type * from './view';
export * from './http';
