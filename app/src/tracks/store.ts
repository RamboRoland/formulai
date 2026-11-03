import type { TrackJSON } from './types';
import { config } from '~/config';
import { EDITOR_PASSWORD_HEADER, type BackgroundList, type TrackEntry, type TrackFolder, type TrackList } from '~/protocol';

// Browser client for the game server's Track API (protocol/http.ts): drafts
// and published tracks live on the server (published = what the game
// races; a publish is raced by new lobbies at once). Every call sends the
// editor password, asked once per tab (sessionStorage); a wrong one (401)
// asks again.

export type StoreFolder = TrackFolder;
export type StoreEntry = TrackEntry;
export type StoreListing = TrackList;

const PASSWORD_KEY = 'formulai.editorPassword';

export async function listTracks(): Promise<StoreListing> {
    return request<StoreListing>('/api/tracks');
}

// Raw parsed JSON — run it through `deserializeTrack` before use.
export async function readTrack(folder: StoreFolder, file: string): Promise<unknown> {
    return request<unknown>(trackUrl(folder, file));
}

export async function saveTrack(folder: StoreFolder, file: string, json: TrackJSON): Promise<void> {
    await request(trackUrl(folder, file), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
    });
}

export async function deleteTrack(folder: StoreFolder, file: string): Promise<void> {
    await request(trackUrl(folder, file), { method: 'DELETE' });
}

// ---- Backgrounds (protocol/http.ts Background API) ----

// The server's trace backgrounds (file names, sorted). Open: no password.
export async function listBackgrounds(): Promise<string[]> {
    let res: Response;
    try {
        res = await fetch(`${config.apiUrl}/api/backgrounds`);
    } catch {
        throw new Error(`Can't reach the game server at ${config.apiUrl}.`);
    }
    if (!res.ok) throw new Error(`Backgrounds: the game server answered ${res.status}.`);
    return ((await res.json()) as BackgroundList).backgrounds.map(b => b.file);
}

// Where the browser loads a background image from (open GET).
export function backgroundUrl(file: string): string {
    return `${config.apiUrl}/api/backgrounds/${encodeURIComponent(file)}`;
}

// Upload (or replace) a background: the image file's bytes as they are.
export async function uploadBackground(file: string, image: Blob): Promise<void> {
    await request(`/api/backgrounds/${encodeURIComponent(file)}`, {
        method: 'PUT',
        headers: { 'Content-Type': image.type || 'application/octet-stream' },
        body: image,
    });
}

// Refused (409) while a track uses it.
export async function deleteBackground(file: string): Promise<void> {
    await request(`/api/backgrounds/${encodeURIComponent(file)}`, { method: 'DELETE' });
}

// Where a track's files exist → its publish status.
//   draft only → 'draft', published only → 'published', both → 'changed'
//   (published, with unpublished changes in the draft).
export type TrackStatus = 'draft' | 'published' | 'changed';

export function trackStatus(listing: StoreListing, file: string): TrackStatus | null {
    const inDrafts = listing.drafts.some(e => e.file === file);
    const inPublished = listing.published.some(e => e.file === file);
    if (inDrafts && inPublished) return 'changed';
    if (inDrafts) return 'draft';
    if (inPublished) return 'published';
    return null;
}

function trackUrl(folder: StoreFolder, file: string): string {
    return `/api/tracks/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
}

// The password for this tab: remembered, or asked (null = cancelled).
// `again`: the remembered one was wrong.
function password(again: boolean): string | null {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(PASSWORD_KEY); } catch { /* storage off */ }
    if (saved && !again) return saved;
    const typed = window.prompt(again ? 'Wrong editor password — try again:' : 'Editor password (the game server\'s EDITOR_PASSWORD):');
    if (!typed) return null;
    try { sessionStorage.setItem(PASSWORD_KEY, typed); } catch { /* storage off */ }
    return typed;
}

// Throws an Error with the server's message (or why it can't be reached).
// A 401 asks for the password again, once per call.
async function request<T>(path: string, init: RequestInit = {}, again = false): Promise<T> {
    const pw = password(again);
    if (pw === null) throw new Error('No editor password — nothing was sent.');
    let res: Response;
    try {
        res = await fetch(config.apiUrl + path, { ...init, headers: { ...init.headers, [EDITOR_PASSWORD_HEADER]: pw } });
    } catch {
        throw new Error(`Can't reach the game server at ${config.apiUrl}.`);
    }
    if (res.status === 401 && !again) return request<T>(path, init, true);
    const text = await res.text();
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`The game server answered ${res.status} without JSON.`);
    }
    if (!res.ok) {
        const msg = (body as { error?: unknown } | null)?.error;
        throw new Error(typeof msg === 'string' ? msg : `Request failed (${res.status}).`);
    }
    return body as T;
}
