# Pause / resume cars (agents)

Robin 2026-11-17: an agent can pause cars in place (batch), resume them
(batch); paused cars are grey to viewers; after resume the agent gets a
state at once. Branch `feat/pause-cars`, worktree `~/Projects/formulai-pause`.

## Decisions (Robin)

- Freeze = everything: speed, slide, yaw, wheel spin, lap clock, car.tick
  kept; resume continues as if no time passed. Other cars race on.
- While paused the car is LEFT OUT of `evt:agent/state` (all paused →
  `cars: []`, still sent).
- Resume: no event; after the next step an `evt:agent/state` at once, the
  stateMs schedule continues from then.
- Pause: no reply (the car is gone from the state).
- Fast lobby: every agent still answers every tick (lockstep unchanged).
- Restart / nextStage: the car respawns but STAYS paused.
- Viewer following a client: a paused car is skipped like a crashed one.
- Rejoin: new Players → cars come back unpaused (a pause belongs to the
  car, as its position).
- Only your own cars (other ids ignored), as restart.

## Phase 1 — server + protocol (both copies)

- [x] protocol/agent.ts: ReqAgentPause / ReqAgentResume `{ carIds }`
- [x] protocol/view.ts: RenderCar.paused
- [x] Player.paused (on Player: survives car.reset)
- [x] GameEngine.tickPlayer: paused → return before tick++; renderCars: paused
- [x] Lobby.pause / Lobby.resume (own cars); resume → state after next step
- [x] Lobby.pushState: paused cars left out
- [x] Lobby.view: skip paused like crashed
- [x] FormulaiServer.handle: req:agent/pause, req:agent/resume

## Phase 2 — App

- [x] RenderSnapshot + Scene3D: paused body grey, colour back on resume

## Phase 3 — docs

- [x] docs/agent-protocol.md, .personal/CLAUDE.md, .personal/websocket.md

## Proof

- [x] test agent, 3 cars: batch pause 2 → gone from state, positions
      unchanged after N s, the 3rd moves
- [x] batch resume → state right after the next step; speed / slip / lap
      time continue from the frozen values
- [x] restart a paused car → grid box, still paused
- [x] fast lobby, all paused → lockstep still runs
- [x] physics-trace main vs branch → cmp identical
- [x] grey kart in Chrome (port 5174 / 8081)

## Results (2026-11-17)

- Protocol test (scratchpad pauseTest.js, server 8081, TrainingLong — the
  local bucket has no TrainingEndless): 14/14 PASS. Batch pause 2 of 3 →
  state only the 3rd; frame paused flags a/b true, k false; follow → k;
  paused cars 0 px in 2 s with gas held; resume → state 14–17 ms after,
  all 3 cars, car.tick 240 → 241, lapTime 1.57 → 1.58 (over a > 2 s
  pause), speed 17.99 → 18.17 (one step, gas held); restart while paused
  → still left out + grey, resume → tick 1, 0 m, lap 0; fast lobby all
  paused → ~26 000 ticks/s, cars: [] every state.
- physics-trace main vs branch: cmp identical (38 893 lines) — weak
  proof here: the trace drives Car only; the change is in GameEngine /
  Lobby (an unpaused car: a false check + a filter that keeps it).
- Chrome (App 5174 → 8081, isometric): paused kart grey at the start
  line, the running one green; after resume red (its colour) again.
- Type-check: server tsc, App `npm run typecheck`: clean. Protocol copies
  identical.
