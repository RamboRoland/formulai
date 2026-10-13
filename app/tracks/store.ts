import type { TrackJSON } from './types';

// Browser client for the dev-only track file store (vite-plugins/trackStore.ts).
// Drafts live in app/assets/tracks/drafts/, published tracks in app/assets/tracks/
// (the latter are what the registry picks up). Only works under `npm run dev`.

export type StoreFolder = 'drafts' | 'published';
export type StoreEntry = { file: string; name: string; displayName: string };
export type StoreListing = Record<StoreFolder, StoreEntry[]>;

const ROUTE = '/__tracks';

export async function listTracks(): Promise<StoreListing> {
    return request<StoreListing>(ROUTE);
}

// Raw parsed JSON — run it through `deserializeTrack` before use.
export async function readTrack(folder: StoreFolder, file: string): Promise<unknown> {
    return request<unknown>(`${ROUTE}/file?${query(folder, file)}`);
}

export async function saveTrack(folder: StoreFolder, file: string, json: TrackJSON): Promise<void> {
    await request(`${ROUTE}/save?${query(folder, file)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
    });
}

export async function deleteTrack(folder: StoreFolder, file: string): Promise<void> {
    await request(`${ROUTE}/delete?${query(folder, file)}`, { method: 'POST' });
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

function query(folder: StoreFolder, file: string): string {
    return new URLSearchParams({ folder, file }).toString();
}

// Throws an Error with the server's message, or a hint if the store isn't
// there (e.g. a production build without the dev server).
async function request<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch {
        throw new Error('Track store unreachable. Is `npm run dev` running?');
    }
    const text = await res.text();
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error('Track store not available (only runs under `npm run dev`).');
    }
    if (!res.ok) {
        const msg = (body as { error?: unknown } | null)?.error;
        throw new Error(typeof msg === 'string' ? msg : `Request failed (${res.status}).`);
    }
    return body as T;
}
