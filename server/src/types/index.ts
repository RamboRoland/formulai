import type { GameMessage } from './game';
import type { ControlMessage } from './control';
import type { LobbyMessage } from './lobby';
import type { SystemMessage } from './system';

export type Direction = 'req' | 'res' | 'evt';
export type Domain = 'game' | 'control' | 'lobby' | 'system';
export type Namespace = `${Direction}:${Domain}`;

// Data is optional only when the message has no payload (Data = undefined).
// Wrapping in tuples prevents distribution over union types.
export type MessageEnvelope<
    Ns extends Namespace = Namespace,
    Action extends string = string,
    Data = unknown,
> = [Data] extends [undefined]
    ? { ns: Ns; action: Action; data?: undefined; v?: number }
    : { ns: Ns; action: Action; data: Data; v?: number };

export type WsMessage = GameMessage | ControlMessage | LobbyMessage | SystemMessage;

// Extract the data payload type for a given (ns, action) pair.
// e.g. PayloadOf<'req:game', 'start'> => { lobbyId: string }
export type PayloadOf<Ns extends Namespace, A extends string> =
    Extract<WsMessage, { ns: Ns; action: A }>['data'];

// Union of all actions defined for a given namespace.
// e.g. ActionsOf<'req:game'> => 'requestPlayerState' | 'playerState' | 'start'
export type ActionsOf<Ns extends Namespace> =
    Extract<WsMessage, { ns: Ns }>['action'];

export type { GameMessage, GameState } from './game';
export type { ControlMessage, Controls } from './control';
export type { LobbyMessage, LobbyPlayer } from './lobby';
export type { SystemMessage, ClientType } from './system';
