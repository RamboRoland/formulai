# Multiplayer restart = a lobby-level request (not controls.restart)

Robin (2026-10-25): "the restart should only work on lobby client level on
restart and on restart verification event". Scope: multiplayer only
(single player unchanged; AiView not cared about — left as is).

## Why
Today restart is a flag in each AI's controls, read in getControlsFor —
only called for cars still racing. A finished car's AI sending
`restart: true`: nothing happens (no evt:game/restarted); the flag is then
either overwritten by its next controls (lost) or stays stored and fires on
the first tick after nextStage (restarts the NEW stage for everyone).

## Flow
```
AI (lobby client)  req:control/restart → server → host evt:game/restart
host: engine.requestReset() → every car reset → one real tick
host req:game/restarted { lobbyId } → server → lobby evt:game/restarted { lobbyId }
```
- Any lobby client may send it (same rule as nextStage: subprotocol
  `control`); it restarts every car in its lobby, finished or not.
- Routed by the sender's lobby (client.lobbyId → lobby.hostId), not "first
  game client". Not in a lobby → ignored with a log line.
- Multiplayer: `controls.restart` is IGNORED (MultiplayerHostView creates its
  controls without onRestart). The host's reset button stays.
- Session completed → tick stops, so a restart does nothing and no
  evt:game/restarted comes (as today).

## Code
- [x] 1. Server types (control.ts): ReqControlRestart (no payload);
      game.ts: EvtGameRestart (no payload, server → host).
- [x] 2. websocket.ts: control.restart → handleRestart (control client in a
      lobby → evt:game/restart to that lobby's host).
- [x] 3. MultiplayerHostView: createControls('ai') without onRestart;
      subscribe evt:game/restart → engine.requestReset().
- [x] 4. tsc (app + server).
- [x] 5. Docs: websocket-ai-client.md (new req:control/restart, cheat sheet,
      controls.restart = AiView only, evt:game/restarted, sequence diagram,
      limitation #6), .personal/websocket.md (handler row), .personal/CLAUDE.md.
- [ ] 6. Test (Robin): restart from a finished car's AI → every car resets →
      evt:game/restarted; controls.restart does nothing in multiplayer.
