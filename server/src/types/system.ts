import type { MessageEnvelope } from './index';

export type ClientType = 'game' | 'control' | 'multiplayer';

// Server greets a newly-connected client with its assigned id and type
export type EvtSystemWelcome = MessageEnvelope<
    'evt:system',
    'welcome',
    { clientId: string; clientType: ClientType }
>;

export type SystemMessage = EvtSystemWelcome;
