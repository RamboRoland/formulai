# evt:game/restarted — "restart applied, state is ready"

Robin (2026-10-23): a WS event when a restart has happened and the AI can
fetch a fresh game state.

## Decisions (Robin)
- Sent after the first REAL tick after the reset (the reset tick skips
  physics → rays are all 0; the next tick fills them). So a state fetched on
  the event has start position, 0 counters AND real rays.
- Sent to each connected client in the lobby (a restart resets every car
  today — unchanged).
- Multiplayer only (AI mode has no lobby; later step if wanted).

## Today (read)
- Restart: controls.restart (per player) → createControls onRestart →
  engine.requestReset() → one global flag → next tick resetLap() for EVERY
  player, physics skipped that tick (GameEngine.ts:145-151, 177-181).
- Pattern to copy: host req:game/completed { lobbyId } → server
  evt:game/completed broadcast (websocket.ts:501).

## Code
- [x] 1. GameEngine: after a reset tick, on the NEXT tick (after physics +
      rays) emit 'restarted'. Typed event payload {}.
- [x] 2. Server types (game.ts): ReqGameRestarted { lobbyId } (host →
      server), EvtGameRestarted { lobbyId } (server → lobby); add to
      GameMessage.
- [x] 3. Server websocket.ts: route req:game/restarted → handleGameRestarted
      (host only, lobby must exist) → broadcastToLobby(all player
      connections, host excluded) evt:game/restarted { lobbyId }.
- [x] 4. MultiplayerHostView: engine.on('restarted') → send
      req:game/restarted { lobbyId }.
- [x] 5. tsc (app + server).
- [x] 6. Docs: websocket-ai-client.md (event + "wait for it, then fetch
      state"), .personal/websocket.md (handler row), .personal/CLAUDE.md
      (restart line + domains).
- [ ] 7. Test (Robin, AI client): send restart → evt:game/restarted arrives
      at every client → state has 0 counters, start pos, non-zero rays.

## Open
- Not sent on nextStage / rejoin restart (those have their own events).
