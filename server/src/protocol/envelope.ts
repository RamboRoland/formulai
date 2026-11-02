// Every WebSocket message (subprotocol `formulai`): `ns` = direction +
// domain, `action` = what happened / is asked, `data` = its payload.
//   req: a request ("I need something from you")
//   res: the answer to a request
//   evt: an event (unsolicited, e.g. every tick)
// Domains: lobby (lobbies), agent (AI agents), player (the App's keyboard
// car), view (the App watching a lobby), system.
export type Direction = 'req' | 'res' | 'evt';
export type Domain = 'lobby' | 'agent' | 'player' | 'view' | 'system';
export type Namespace = `${Direction}:${Domain}`;

// The WebSocket subprotocol every client connects with.
export const SUBPROTOCOL = 'formulai';

// No Data given = a message without payload (`data` may be left out).
// Wrapping in tuples prevents distribution over union types.
export type Envelope<
    Ns extends Namespace = Namespace,
    Action extends string = string,
    Data = undefined,
> = [Data] extends [undefined]
    ? { ns: Ns; action: Action; data?: undefined; v?: number }
    : { ns: Ns; action: Action; data: Data; v?: number };

export type Point = { x: number; y: number };
