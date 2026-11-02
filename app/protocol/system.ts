import type { Envelope } from './envelope';

// Sent once on connect.
export type EvtSystemWelcome = Envelope<'evt:system', 'welcome', { clientId: string }>;
// Any request the server can't handle (unknown message, not allowed …).
export type EvtSystemError = Envelope<'evt:system', 'error', { reason: string; ns?: string; action?: string }>;

export type SystemMessage = EvtSystemWelcome | EvtSystemError;
