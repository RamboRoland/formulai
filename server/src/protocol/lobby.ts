import type { Envelope } from './envelope';

// A session as the lobby editor builds it (the server validates it like a
// session file: known kart classes, stages, laps, track + layout exist).
export type SessionDefinition = {
    name: string;
    displayName?: string;
    cars: string[];
    repeat?: boolean;
    stages: { track: string; layout?: string; laps: number }[];
};

// Someone in a lobby: an agent's car or the App's keyboard player.
export type LobbyMember = {
    carId: string;
    name: string;
    kart: string;
    kind: 'agent' | 'player';
    ownerId: string; // agentId or playerId
};

export type LobbySummary = {
    id: string;
    session: { name: string; displayName: string };
    stages: number;
    members: LobbyMember[];
};

// List / create lobbies (the lobby editor, the App).
export type ReqLobbyList = Envelope<'req:lobby', 'list'>;
export type ResLobbyList = Envelope<'res:lobby', 'list', { lobbies: LobbySummary[] }>;
export type ReqLobbyCreate = Envelope<'req:lobby', 'create', { session: string | SessionDefinition }>;
export type ResLobbyCreate = Envelope<'res:lobby', 'create', { lobbyId: string }>;
export type ResLobbyCreateError = Envelope<'res:lobby', 'createError', { reason: string }>;
// To everyone in / watching a lobby when someone joins or leaves.
export type EvtLobbyMembers = Envelope<'evt:lobby', 'members', { lobbyId: string; members: LobbyMember[] }>;

export type LobbyMessage =
    | ReqLobbyList | ResLobbyList
    | ReqLobbyCreate | ResLobbyCreate | ResLobbyCreateError
    | EvtLobbyMembers;
