# Reconnect to a running lobby

Robin (2026-10-21): players can reconnect to a lobby while it's going. When
no players are connected, show a waiting view; when players connect again,
restart all stages and continue.

## Decisions (Robin)
- Join only when the lobby is EMPTY (while any car races, joins are still
  refused with "Game has already started").
- Resume with a short countdown after the last join (each join restarts it).
- Waiting view = overlay on the race view (same view, no route change).
- Everything fresh: stage 1, all stage flags cleared, all times / meters /
  checkpoints 0, cars at the start, AIs get evt:game/start again.
- Countdown: 2 s.
- Session completed → no waiting view, even with no players left (the
  summary stays). The server keeps such a lobby closed (joins refused).

## Today (read)
- Server `handleJoinLobby`: refuses while `lobby.gameStarted`.
- Disconnect → `handleLeaveLobby` → `evt:lobby/playerLeft` → host
  `engine.removeActor`. Last player gone: lobby stays, gameStarted stays
  true, host shows an empty track.
- Host builds its Players once at mount (`createPlayers` from
  `lobbyPlayers`); the engine can remove actors but not add them.
- `handleStartGame` can be called again: sets gameStarted, broadcasts
  `evt:game/start` to the lobby.

## Flow
1. Last player leaves a started lobby → server sets `gameStarted = false`
   (lobby open again). Host: engine has 0 players → waiting overlay.
2. AI joins as usual (`req:lobby/join`) → `res:lobby/join` (gameStarted
   false) + `evt:lobby/playerJoined` to the host → overlay lists it,
   countdown (re)starts.
3. A player leaves during the countdown → removed from the list; none left
   → countdown stops.
4. Countdown ends → host: Session back to stage 1 + flags cleared, new
   Players for the joined list, engine runs again, camera fits stage 1,
   overlay hidden → `req:game/start` → server: gameStarted = true,
   `evt:game/start` to the lobby → AIs race (same as the first start).

No protocol changes: AIs already do join → wait for evt:game/start.

## Code
- [x] 1. Server: Lobby `gameCompleted` (set in handleGameCompleted);
      `handleLeaveLobby`: started, not completed, no players left →
      `gameStarted = false` (+ log).
- [x] 2. Session `reset()`: currentStage 0, stageCompleted [].
- [x] 3. GameEngine `restartSession(players)`: replace the players, every
      car on stage 1's track at the start, reset flag cleared.
- [ ] 4. (dropped — no waiting view after completion, so the summary
      overlay never needs removing)
- [x] 5. MultiplayerHostView: waiting overlay (no players / joined list /
      2 s countdown), playerJoined + playerLeft while waiting, restart on
      countdown end, send req:game/start. Not after session completed.
- [x] 6. tsc (app + server).
- [ ] 7. Test (Robin, AI client): disconnect all → overlay; reconnect →
      countdown → stage 1, fresh GameState.
- [x] 8. Docs: websocket-ai-client.md (lobby list field, joinError, flow
      step 6, new "Rejoin" section, limitation #4), .personal/websocket.md
      (handler rows + Rejoin), .personal/CLAUDE.md (Sessions). README has no
      lobby docs → unchanged.
- [x] 8b. Server `handleListLobbies`: completed lobbies not listed (Robin).
      Docs: AI client "Rejoin" + lobby list, websocket.md, CLAUDE.md.
- [ ] 9. (asked) GameEngine.tick: draw the track with no players, so the
      canvas doesn't freeze with the last car under the waiting overlay.

