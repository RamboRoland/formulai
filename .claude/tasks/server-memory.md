# Hosted server killed for memory (2026-11-14)

## What happened

Robin's train_multi (40 × Hyrkart270cc, Training One, stateMs 93, lobby
8387DA) on the hosted server: at 16:03:32 UTC the Droplet's kernel killed
the Node server (`Out of memory: Killed process … anon-rss:427792kB`);
Docker restarted it 16:03:35 (restarts=1, not a deploy) → every lobby gone
("No lobby 8387DA — lobbies now: []"). Droplet: 961 MB RAM, no swap; Caddy
+ App + server. The server printed nothing before. Robin's control time p90
rose ~125 → ~155 ms in the last ~10 min. (A second removal, 10:55 lobby
8CCD65, was the empty-600 s sweep.)

## Cause (measured locally, hosted commit 6eaf6a7 built, port 8081)

`FormulaiServer.send` (`ws.send` without looking at `bufferedAmount`):
a client that reads slower than the server sends makes the server queue
every message in memory, without limit. Load test (scratch load40.js: 4
connections × 10 cars, stateMs 93, restarts every 15 s, a viewer):
heap flat ~36 MB for 18 min. + one client with 10 cars that stops reading:
RSS 118 → 216 MB, heap 37 → 93 MB in 5 min (~20 MB/min); disconnect it →
heap 35 MB / RSS 107 at once. A busy Python trainer (websockets max_queue 32
→ stops reading the socket) or a background browser tab does exactly this.

## Fix (Robin: A) — branch fix/send-backpressure

`FormulaiServer.send`: `ws.bufferedAmount` > 1 MB → skip evt:agent/state,
evt:player/state, evt:view/frame (each a fresh snapshot; never an agent's
state in a fast lobby — lockstep); everything else always sent; > 16 MB →
`ws.terminate()` + a log line (its cars leave via the close handler; a
token rejoins). Docs: agent-protocol ("Read them as they come"),
.personal/CLAUDE.md (Game Loop).
Proof (same test, fix built): stalled client connected the whole 10 min →
heap 35–42 MB, heapTotal 46–68 MB, flat (old: 37 → 93 / 102 → 185 in 5
min); normal clients' state rate unchanged (2,580 per min).
Later (B, own task): a ping every 30 s to drop dead connections.
