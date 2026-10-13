import type { MessageEnvelope } from './index';

// A player entry as stored server-side and shared with clients
export type LobbyPlayer = {
    id: string;
    name: string;
    car: string;
};

// Host creates a lobby
export type ReqLobbyCreate = MessageEnvelope<
    'req:lobby',
    'create',
    {
        session: string;
        track: string | null;
        cars: string[];
    }
>;

// Multiplayer client joins a lobby. `actorId` is optional: when omitted the
// server uses the sender's connection clientId as the player's id in the
// lobby. When present (multi-actor AIs), the given actorId is used instead,
// letting a single connection register multiple distinct actors.
export type ReqLobbyJoin = MessageEnvelope<
    'req:lobby',
    'join',
    {
        lobbyId: string;
        playerName: string;
        playerCar: string;
        actorId?: string;
    }
>;

// Multiplayer client leaves a lobby. `actorId` is optional — when omitted,
// ALL actors belonging to the sender's connection are removed. When provided,
// only that specific actor leaves (useful for multi-actor AIs managing a fleet).
export type ReqLobbyLeave = MessageEnvelope<
    'req:lobby',
    'leave',
    { lobbyId: string; actorId?: string }
>;

// AI client asks for the current list of lobbies.
export type ReqLobbyList = MessageEnvelope<
    'req:lobby',
    'list',
    undefined
>;

// Public projection of a lobby for the discovery response (no internal fields).
export type LobbySummary = {
    lobbyId: string;
    session: string;
    track: string | null;
    cars: string[];
    players: LobbyPlayer[];
    gameStarted: boolean;
};

// Server responds with the list of lobbies to the requester only.
export type ResLobbyList = MessageEnvelope<
    'res:lobby',
    'list',
    { lobbies: LobbySummary[] }
>;

// Server confirms lobby creation to the host
export type ResLobbyCreate = MessageEnvelope<
    'res:lobby',
    'create',
    {
        lobbyId: string;
        players: LobbyPlayer[];
        session: string;
        track: string | null;
        cars: string[];
    }
>;

// Server confirms lobby join to the joining player
export type ResLobbyJoin = MessageEnvelope<
    'res:lobby',
    'join',
    {
        lobbyId: string;
        gameStarted: boolean;
        players: LobbyPlayer[];
        session: string;
        track: string | null;
        cars: string[];
    }
>;

// Server reports lobby-join failure (unknown lobby, game already started, missing client)
export type ResLobbyJoinError = MessageEnvelope<
    'res:lobby',
    'joinError',
    { error: string }
>;

// Server reports lobby error (leaveLobby, startGame guardrails). Shape drifts between
// call sites — some send `{ error }`, some send `{ message }`. Both are accepted here.
export type ResLobbyError = MessageEnvelope<
    'res:lobby',
    'error',
    { error?: string; message?: string }
>;

// Server broadcasts a new player joining the lobby
export type EvtLobbyPlayerJoined = MessageEnvelope<
    'evt:lobby',
    'playerJoined',
    { lobbyId: string; player: LobbyPlayer }
>;

// Server broadcasts a player leaving the lobby
export type EvtLobbyPlayerLeft = MessageEnvelope<
    'evt:lobby',
    'playerLeft',
    { lobbyId: string; player: { id: string } }
>;

export type LobbyMessage =
    | ReqLobbyCreate
    | ReqLobbyJoin
    | ReqLobbyLeave
    | ReqLobbyList
    | ResLobbyCreate
    | ResLobbyJoin
    | ResLobbyJoinError
    | ResLobbyError
    | ResLobbyList
    | EvtLobbyPlayerJoined
    | EvtLobbyPlayerLeft;
