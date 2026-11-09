import type { SessionDefinition } from './lobby';

// The server's HTTP API (same port as the WebSocket): load / save / delete
// for the two editor tools. JSON in, JSON out; every error is
// `{ error: string }` with a 4xx / 5xx status. Live game data stays on the
// WebSocket (protocol/index.ts).

// ---- Track API (the track editor) ----------------------------------------
// Behind the editor password: header `X-Editor-Password` on EVERY track
// route below except /api/tracks/layouts (wrong / missing → 401). Its only
// purpose is keeping the editor to one person (no multi-editor handling;
// the last save wins). Mirrors today's dev-only track store.
//
//   GET    /api/tracks                         → TrackList
//   GET    /api/tracks/:folder/:file           → the track JSON (raw)
//   PUT    /api/tracks/:folder/:file           → body: track JSON → TrackSaved
//   DELETE /api/tracks/:folder/:file           → TrackDeleted
//   GET    /api/tracks/layouts                 → TrackLayouts (OPEN: names only,
//                                                for the lobby editor)
//
// `folder` = "drafts" | "published" (publish = PUT to published); `file`
// must match [a-z0-9_]+.json. Opening a track always fetches it fresh.
export const EDITOR_PASSWORD_HEADER = 'X-Editor-Password';
export type TrackFolder = 'drafts' | 'published';
export type TrackEntry = { file: string; name: string; displayName: string };
export type TrackList = { drafts: TrackEntry[]; published: TrackEntry[] };
export type TrackSaved = { ok: true };
export type TrackDeleted = { ok: true };
export type TrackLayouts = {
    tracks: {
        name: string;
        displayName: string;
        layouts: { id: string; name: string; loop: boolean; expectedLapTimes: Record<string, number> }[];
    }[];
};

// ---- Background API (the track editor's trace backgrounds) ----------------
// Images (png / jpg / jpeg / webp) the track editor traces over. Viewing is
// OPEN (a plain <img src>); upload / delete need the editor password.
//
//   GET    /api/backgrounds                    → BackgroundList
//   GET    /api/backgrounds/:file              → the image (its Content-Type)
//   PUT    /api/backgrounds/:file              → body: the image bytes
//                                                (≤ 20 MB) → BackgroundSaved
//   DELETE /api/backgrounds/:file              → BackgroundDeleted (409 while
//                                                a track uses it)
//
// `file` must match [A-Za-z0-9_.-]+ with an image extension; the body must
// really be that kind of image. A track's `editorBackground.src` is the
// background's file name.
export type BackgroundEntry = { file: string; size: number /* bytes */ };
export type BackgroundList = { backgrounds: BackgroundEntry[] };
export type BackgroundSaved = { ok: true };
export type BackgroundDeleted = { ok: true };

// ---- Session API (the lobby editor) --------------------------------------
// Open (no password). A saved session is a new example session on the
// server; it is validated like a session file (known karts, stages, laps)
// and every stage's track + layout must exist. Every session can be saved
// over or deleted (they live in the server's S3 bucket).
//
//   GET    /api/sessions                       → SessionList
//   GET    /api/sessions/:name                 → SessionEntry
//   PUT    /api/sessions/:name                 → body: SessionDefinition (same name) → SessionSaved
//   DELETE /api/sessions/:name                 → SessionDeleted
//   GET    /api/karts                          → KartList
//
// Creating a lobby with a session is on the WebSocket (req:lobby/create).
export type SessionEntry = SessionDefinition;
export type SessionList = { sessions: SessionEntry[] };
export type SessionSaved = { ok: true };
export type SessionDeleted = { ok: true };
export type KartList = { karts: string[] };

// ---- Ping (open) -----------------------------------------------------------
//   GET    /api/ping                           → Pong (answers at once; for
//                                                measuring latency)
export type Pong = { ok: true };

export type ApiError = { error: string };
