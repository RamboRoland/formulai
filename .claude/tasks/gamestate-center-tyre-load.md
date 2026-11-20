# GameState: centerAngle + tyreLoad

Robin 2026-11-20 (branch feat/gamestate-center-angle-tyre-load). Two new
`car` values for agents, from what the physics already has — output only,
no physics change.

```
centerAngle: number;  // nose vs the centre line's direction at the car's nearest point ÷ 180°
                      // (4 decimals): 0 = parallel, + = nose right of the track, ±1 = backwards
                      // (|centerAngle| < 0.5 ⇔ facing = true)
tyreLoad: number[];   // FL, FR, RR, RL (as corners): vertical load ÷ that tyre's static load
                      // (4 decimals): 1 = static, > 1 loaded, 0 = lifted
```

Decisions (Robin):
- `facing` stays (centerAngle next to it).
- tyreLoad = what the physics uses: front L = R = loadShareFront (the
  physics has no front left/right transfer); rear inner = loadShareRear ×
  rearLift, outer = loadShareRear × (2 − rearLift). The rear split is used
  by the yaw moments (spool, outer brake), NOT by the grip (each rear tyre
  grips at half the axle load) — documented as such ("4 tyres as planned").
- Inner rear = the side the tyres' side force pushes to = sign(lateralG)
  (as rearAxleMoment: −sign(sideForce) × outerBrake); lateralG 0 → both rear
  = the axle share. Reverse / crashed / stopped: stopSliding → all 1.

## Steps

- [x] 1. centerAngle: Car.centerAngle (degrees, -180..180; reset 0),
      set in GameEngine.updateDirection from the same trackAngle as facing;
      gameState ÷ 180 (norm, 4 decimals); protocol both copies. tsc server +
      app OK
- [x] 2. tyreLoad: Car.tyreLoads() [FL, FR, RR, RL]; gameState (4 decimals);
      protocol both copies. tsc server + app OK
- [x] 2b. tyreGrip (Robin, added mid-way) REPLACES gripFront / gripRear in
      GameState (breaking for agents; Car keeps both: scrub, incident logs,
      braking suite, trace). Front per wheel: Car.gripFrontLeft / Right =
      |that wheel's side force| ÷ (frontPeak / wheels), last substep
      (frontWheels → [inner, outer], inner = the steered side); rear RR = RL
      = gripRear (one spool, half the axle load each). Car.tyreGrips()
- [x] 4. Proof (2026-11-20): physics-trace main vs branch identical apart
      from the keys= line (+ centerAngle, gripFrontLeft, gripFrontRight);
      scratchpad checkNewState.ts on Torslanda GP (local S3), Centralen:
      standing all 1 / 0; gas rear 1.13 front 0.82; braking front 1.25 rear
      0.82; right corner RR 0.55 (inner) RL 1.44, left mirrored; FL = FR
      load; centerAngle vs an independent 1 m tangent of the bot's line:
      mean 0.22° (max 13° at single kinks); 180° → −0.995 facing false, +90°
      → +0.505, −30° → −0.161 facing true; tyreGrip 0..1, RR = RL, the
      inner front wheel higher in 1408 / 1484 steered ticks, |FL − FR| up to
      0.75; old gripFront (vector sum of the axle) differs from mean(FL, FR)
      by up to 0.38 (the wheels' forces partly cancel in the sum)
- [x] 3. Docs: docs/agent-protocol.md, .personal/CLAUDE.md GameState block
      (incl. the front L = R limit and what the rear split drives)
      + README, the gripRear tip in agent-protocol §controls
- [ ] 5. Commit (as Robin)
