# Braking strength (2026-11-13)

Robin: "can you look over if the braking is too weak? Note i want to keep
realistic still. But i want new eyes on the braking distance" — and keep a
steering check: every braking change also moves the bend / spin behaviour
(`braking-spin.md`).

## PAUSED 2026-11-13 — where to pick up

Robin: "I'm just asking you to make a better bot, but we will have to pause
for now." Everything I started is stopped (servers 8081 / 8082, Apps 5174 /
5175, bots); Robin's S3 container left running. Nothing committed.

Worktree ~/Projects/formulai-braking (branch feat/braking-suite), uncommitted:
- server/src/game/cars/physics/* + Car.ts: modules (R1) + candidate C
  (TMeasy + rear-axle spin, R2) + 2f (local dFx/dκ; consistent outer-brake
  moment) + S does nothing while rolling (drivetrain.axleDrive).
- server/src/game/engine/GameEngine.ts: crashed = frozen until restart.
- server/scripts/brakingSuite.ts, physicsTrace.ts + package.json scripts.
- app KeyboardControls.ts: Shift + Space = full pedal.
- app SinglePlayerView.ts: TEMPORARY SESSION = 'TrainingLong' — REVERT.
Suite now 64 PASS / 6 ≈ / 20 FAIL vs today 54 / 10 / 23.

Next, in order (ask Robin before each):
1. A better braking bot (in progress): results/bot/brakingBot.ts +
   trial.sh (copies; run from the worktree's server/ with NODE_PATH=
   <worktree>/server/node_modules TS_NODE_TRANSPILE_ONLY=true). Done so
   far: braking point v_allowed = √(v_corner² + 2·a·(ahead − margin)) →
   0 crashes in 40 s, ~40 km/h average, but braking only ~4 % of the time
   (short) → make braking zones longer / harder so Robin can SEE them
   (was trialling cornerKmh 20–22, brakingG 0.45–0.5, margin 3 on both
   models when paused). RESUMED 2026-11-13: the bot coasted (lifted the
   gas within 5 % of the allowed speed) → full gas until the braking
   point: braking 18–31 % of the time from ~57 km/h, 0 crashes in 30 s on
   both models (new 314–323 m, today 334–341 m per 30 s). Settings
   --cornerKmh 22 --brakingG 0.45 --marginM 3. Bots running, Robin
   watching. Robin "saw no cars": the bots finished stage 1 (5 laps) and
   never sent nextStage / restart → off the track; fixed (a completed
   stage → restart on the same layout). Also I had swapped the lobby ids.
   Checked both viewers in Chrome myself (cars driving). Viewer: today lobby = a copy of R1 src + only the
   crash rule (results/today-freeze/GameEngine.ts; R1 src = git HEAD's
   game code split into modules — rebuild by copying the worktree's
   physics from git HEAD + R1, or simply HEAD + this GameEngine change).
2. Robin watches threshold / trail / lock bots side by side.
3. Wrap-up: naming pass (physics-trace identical), revert the temporary
   TrainingLong, docs (.personal Car Physics per module, Keyboard, S /
   crash rule, docs/agent-protocol.md: restart after a crash, backward
   ignored while rolling), laptimes.ts re-check (still assumes
   rearBrakeLimit + √(1 − gripRear²)), then commit with Robin.
NEXT task after this one (Robin, 2026-11-13): `.claude/tasks/kart-values.md`
— inventory + sensitivity of every kart value, derived values computed from
their inputs, a fingerprint cache for expectedLapTimes.
Later tasks: values (Lot & Dal Bianco paper: h, rear share), self-aligning
steering (2d), 270cc acceleration (1g).

## Goal (Robin, 2026-11-13)

Correct braking length in HEAVY braking (straight, hard) and in TRAIL
braking (braking into the turn-in, released towards the apex) — as real
as sources allow, reasonable in the game. Every other scenario no worse.

### Scoreboard (every candidate is scored on this; baseline in brackets)

1. Racingkart 106 → 46 km/h at the lock limit: 39.1 m (Vroomkart,
   rear only, ±10 % PASS, ±25 % ≈) [48.8 m ≈].
2. Racingkart heavy braking peak total ~0.8–1.0 g (forum logger 0.8 GPS-
   smoothed; Vroomkart peak 1.0) [0.78–0.80 g].
3. Rental karts: no measured data — report only; same algorithm, their
   own values.
4. Lockup tipping point COMES OUT of the physics (no threshold): straight
   lock ≈ straight, turning → rotates. Report per speed: wheel angle /
   lateral g where a lock turns into a spin. No data → Robin judges
   [today: spins from ~1° wheel].
5. Trail braking: edgy, catchable, a caught slide costs speed. Report
   catch works, rotation °/s, km/h lost vs a clean trail. Robin judges
   (driving feel) [rental 1–10° slip, Racingkart 18–22°].
6. Information only: suite --compare vs baseline, CPU per kart step.
7. Gs (Robin, 2026-11-13): the most braking Gs and cornering Gs the kart
   can feel, and every mix of both (the edge of a g-g plot). Racingkart:
   braking ~0.8–1.0 g (measured), cornering ~1.5–1.7 g (tyre-slip-
   steering.md), a smooth flattened shape between them (rear-only
   brakes: braking uses only the rear tyres' grip budgets).

   ALARM (Robin: "if these values get too high something is wrong"),
   sustained ≥ 0.2 s, any scenario: Racingkart braking > ~1.1 g (measured
   top 1.0 incl. drag) or cornering > ~1.8 g (measured 1.5–1.7); rental
   braking > ~0.7 g or cornering > ~1.35 g (ESTIMATES: no data, rear-only
   physics ~0.55 + drag, tyre 1.0–1.3); a mix outside the line between
   the braking and cornering maxima. Too high = a bug, not a result.

### Words (Robin, 2026-11-13)

- **Grip budget**: per tyre — grip × the load on it now; braking, gas and
  turning each take a share, no priority; over it → the tyre slides
  (lock / wheelspin / past the peak).
- **Gs**: how many g the kart feels (braking Gs, cornering Gs, both) —
  what a logger measures; comes OUT of the tyres' grip budgets.
- A spin = a REAR tyre's grip budget used up (before the kart's Gs look
  maxed — why a brake stab in a corner spins); understeer = the FRONT's.

## Today (code formulas, straight line, no ramp; scratchpad brake.js)

rearBrakeLimit = μ·g·rearShare / (1 + μ·h/L), rear brakes only.

| Kart | Limit | Top → 0 limit | Keyboard 0.8 × | Locked |
|---|---|---|---|---|
| HyrkartCentralen | 0.53 g | 60 → 0: 24.9 m | 30.6 m | 32.4 m |
| Hyrkart270cc | 0.53 g | 80 → 0: 42.9 m | 52.4 m | 55.5 m |
| Racingkart125cc | 0.63 g | 100 → 0: 55.1 m | 67.0 m | 75.1 m |

Real: Rotax Senior rear-brake logger peak ~0.8 g (KartPulse forum), a
hairpin 0.82 g (purpl.app, chassis unknown); our own note "0.8–1.1 g"
(tyre-slip-steering.md). Rental karts: no measured data found.

## Causes (the model is sound; the ceiling comes from inputs)

1. cgHeightMeters (μ·h/L = 0.45 Racingkart): the biggest lever, an estimate.
2. rearBrakeLimit has no load sensitivity; `slide` (Car.ts:371) has →
   longitudinal says locked while slide still sees grip. Fix = +1.6 /
   +1.7 / +3.3 % (0.540 / 0.539 / 0.651 g). Consistency, not distance.
3. μ braking = μ cornering (one gripG); tyres often have more braking grip.
4. slideGrip 0.70–0.75 when locked (braking-spin.md: drops fast).
5. Keyboard aid 0.8 × limit — feel, not physics.

Robin: B — cause 2 folded into the bigger review (1 + 3), one steering
check over all of it.

## Steering check

The old suite (runall.sh, mechanic compact.ts, driver drive.ts / pivot.ts,
tapgrid.ts) is gone with its session's scratchpad; braking-spin.md keeps
results only. Rebuild in the REPO (Robin): server/scripts/, an npm
script. Check = main vs changed code on the same suite: nothing worse
unless Robin accepts it.

## Sources checked (2026-11-13) — don't search these again

Braking measurements:
- Rotax Senior rear-only, ~0.8 g peak, 1.42 g combined, channel GPS_LonAcc
  (GPS → smoothed), one post: https://forums.kartpulse.com/t/how-to-explain-the-kart-dynamic-on-this-moment/8248
- Hairpin peak 0.82 g → 0.59 → 0.23 g, chassis / engine not stated:
  https://purpl.app/blog/karting-telemetry-guide/
- FA / Vortex DVS (ROK 125), Bridgestone ROK: rear only 1.0 g vs front +
  rear 1.2 g; 106 → 46 km/h zone 39.1 m vs 32.8 m; OiP sensors ("tri-axial
  GPS", unclear if accelerometer): https://www.vroomkart.com/news/26869/hand-brake-yes-or-no
- ~0.6 g rear-only, a forum CALCULATION (μ 1.5), not measured:
  https://forums.kartpulse.com/t/go-kart-deceleration-braking-capability/9680
- Kart braking dynamics (above 0.5 g only brake + drag matter):
  https://tkart.it/en/magazine/tech-talk/the-dynamics-of-kart-braking
- Rental karts: nothing measured found (searched 2026-11-13).

Kart geometry:
- Lot & Dal Bianco 2016, eprints.soton.ac.uk/385883 — 403 (Robin tries
  to get the PDF). Via https://github.com/juanmanzanero/fastest-lap
  database/vehicles/kart/roberto-lot-kart-2016.xml: mass 165, com
  0 0 −0.25, front_axle 0.645 0 0.111, rear_axle −0.4 0 0.111, wheel
  radius 0.139, rear pDx1 0.9 / pDy1 1.5 (front pDx1 0); frame unstated →
  rear 61.7 % clear, h not readable.
- CoG 0.259 m (180 kg, wheelbase 1.22, design value, driver?):
  https://www.researchgate.net/publication/345650470 — low.
- CoG 0.306 m shifter kart, assumed: https://www.researchgate.net/publication/322097155 — low.
- Mihalić 2023 https://doi.org/10.3390/app132011312 — 403 now (its 0.32 m
  for 80 + 50 kg is in tyre-slip-steering.md).

Tyres:
- "Highly elliptic" kart g-g (braking far below cornering), snippet only:
  https://forums.autosport.com/topic/134348-highly-elliptic-g-g-plot-kart/
- Locked vs peak: motorcycle dry peak ~1.2, locked 0.7–0.9
  https://trid.trb.org/view/1820709 (medium); 0.7–0.9 of peak
  https://mechcodex.com/learn/dynamics-vibration/tire-slip-ratio (low);
  dry asphalt peak 0.8–0.9 / slide 0.75 https://hpwizard.com/tire-friction-coefficient.html (low).
- Sodi RSX2 page: no brake layout https://www.sodikart.com/en-gb/karts/rental/rsx2-43.html;
  Caroli Hammerhead: nothing found. FSAE TTC μx/μy: members only.

Lessons:
- Compare TOTAL deceleration (brake + drag + rolling) with logger data,
  never the brake limit alone (I got this wrong first).
- Scratchpad scripts die with their session (braking-spin suite lost) →
  the suite lives in the repo now (server/scripts/brakingSuite.ts).

## Agents (Robin, 2026-11-13)

The braking-spin driver / mechanic ended with their session; recreated
fresh with their old roles (braking-spin.md) + this task:
- Phase 1: one research agent (read-only) — no separate driver.
- Phase 0: a new DRIVER rebuilds the scenarios from braking-spin.md.
- Phase 2: a new MECHANIC, on a copy of the code, candidates vs the suite.

## Phases (Robin: research first; ask before each next phase)

- [x] 1. Research, read-only, sources: cgHeight per kart, braking vs
      cornering grip on kart tyres, real braking g / distances (rental +
      Rotax). Table: sourced range vs today. Robin picks the values.
      Result (2026-11-13):
      - Correction: compare TOTAL deceleration (brake + drag + rolling),
        not the brake limit alone. Racingkart total at 100 km/h 0.78 g
        (drag 0.13 g) vs forum logger ~0.8 g (GPS_LonAcc, one post) ✔.
        Vroomkart test (FA / ROK 125, rear brake only, sensor unclear):
        106 → 46 km/h in 39.1 m (avg 0.92 g, peak 1.0 g) vs model 48.7 m ✘.
        Between right and ~25 % weak; thin evidence.
      - Lot & Dal Bianco 2016 (eprints.soton.ac.uk/385883, 403 for me), via
        fastest-lap roberto-lot-kart-2016.xml: 165 kg, wheelbase 1.045,
        rear 61.7 % (axles +0.645 / −0.400 from CoM — clear); com z −0.25
        vs axle z +0.111, frame unstated → h NOT readable. 62 % disagrees
        with the forums' 56–58 %.
      - μx / μy: one model file pDx1 0.9 / pDy1 1.5 (shaky, points lower) →
        keep equal. slideGrip 0.70–0.75 inside 0.6–0.9 of peak (road /
        motorcycle) → keep.
      - Rental karts: no data; brake layout unpublished. Robin: rear only,
        sure.
      Decision (Robin, A): cause 2 for all three karts. h / rear share open
      until the paper can be read (Robin tries to get the PDF).
- [x] 0. Rebuild the suite in the repo from braking-spin.md (straight
      stops, H1–H4, C1, S1–S3, P1–P10, keyboard-cap bend) + stopping
      table; baseline on main. Robin checks the scenarios.
      Result (2026-11-13, driver; re-run by me = identical, tsc clean):
      worktree formulai-braking, server/scripts/brakingSuite.ts +
      `npm run braking-suite` (`-- --src <dir>`, `--compare <dir>` old vs
      new with Δ, `--only <regex>`, `--sweep`), ~2 s, open area, no S3.
      Full output: `braking-strength-baseline.txt` (next to this file).
      Baseline: PASS 54, ≈ 10, FAIL 23, ALLOWED 24, INFO 38.
      - Stops at L: top → 0 24.7 / 42.8 / 71.3 m (Racingkart from 115);
        Racingkart 100 → 0 55.5 m peak 0.78 g PASS; 106 → 46 48.8 m vs
        Vroomkart 39.1 (+25 %) ≈ at the edge.
      - Trail braking (UNSOURCED criterion slip ≤ 12° / ≤ 25°; no measured
        data, purpl.app coach: release 0.1–0.2 s): rental PASS (1–10°),
        Racingkart ≈ 22° / 18°.
      - FAIL: C1 Racingkart 60°, S1 Racingkart 15°, P4 Racingkart 19°,
        every tap P2/P3/P5–P8/P10 (+0.2–1.7°: the known open pivot).
      - Matches the old records (formulas, 50 → 0 keyboard, #10, M1, C1
        270cc 28° / 0.60 s, pivot picture, COAST, H1–H4). Differences
        from reconstruction: C1 stab length (0.1 / 0.2 / 0.3 s → 7 / 28 /
        49°, 0.2 s chosen), #4, M2 yaw, ST30 0.78 vs 0.86 g (speed not
        held), KB-bend (old 2–3 % predate the fix; now holds to full lock
        rental / 18 % Racingkart), 50 → 0 locked (step vs old ramp).
      - Not rebuildable: original P1–P10 inputs, 3 of the driver's 16,
        exact #4 / #6 / M / S inputs (all "reconstructed" in the legend).
      - Note conflicts for Robin: L2 (kart-driver.md "roughly straight" vs
        braking-spin.md "spin allowed"); A1 record ambiguous.
- [ ] 1b. Robin after the baseline (2026-11-13):
      - Lockups: a TIPPING POINT between straight and spin, depending on
        g / turning — not "always straight" (kart-driver.md) or "always
        spin" (braking-spin.md L2). Today: spins from ~1° wheel.
      - Trail braking: edgy, never "flat" / safe — but CATCHABLE (a slow
        spin at kart speeds) and a small caught slide COSTS SPEED. Suite:
        catch works, rotation speed (°/s), speed lost vs a clean trail;
        thresholds from Robin's driving (unsourced, marked).
      - Root cause found (Car.ts): no one grip budget. Gas yields to
        turning (√(1 − gripRear²), :289), turning yields to braking
        (√(1 − b²), :411), the lock decision ignores turning / current
        load / lift (straight-line limit, :298); locked → Coulomb (:410).
      - Robin: each action (brake, gas, turning) uses its share of ONE
        grip budget, no priority — part of the ALGORITHM (one rear-tyre
        force function replacing the three rules; cause 2 inside it).
      - Robin: research braking algorithms first → research agent
        (combined slip: friction ellipse, Pacejka MF combined, similarity,
        brush, Dugoff, TMeasy; wheel-spin DOF vs force demand; sims;
        kart specifics; recommendation as equations).
- [x] 1c. Algorithm research (2026-11-13, agent; TORCS verified by me):
      - Only "scale the force demand" (today) works without a spinning
        wheel; EVERY established model with progressive lock / wheelspin
        uses a slip ratio κ (wheel spin state): normalised / similarity
        slip (Racer, Svendenius, TORCS, fastest-lap Pacejka_simple), MF
        combined Gxα / Gyκ (VDrift tire1/2; needs fitted coefficients, no
        kart data), brush (VDrift tire3), Dugoff (no fall-off past the
        peak), TMeasy (Rill; normalised + better curves).
      - TORCS simuv2 wheel.cpp (checked by me):
        https://torcs.sourceforge.net/api/wheel_8cpp_source.html —
        sx = (vt − ωr)/|vt| :274, sy = sin(sa) :275, s = √(sx² + sy²)
        :280, F = MF(min(s, 1.5)) × load × μ :301–336, Ft −= F·sx/s,
        Fn −= F·sy/s :344–345 (no priority), spinVel -= dt·spinTq/I
        :405, brake clamp: the wheel stops at 0, never reverses :408–413.
      - VDrift tyres: https://github.com/VDrift/vdrift/tree/master/src/physics
        (cartire1/2/3). fastest-lap kart: lateral-only front, rear axle
        spin state, rear axle inertia 0.2 kg·m², brake max 200 Nm:
        https://github.com/juanmanzanero/fastest-lap
      - KartKraft, Assetto Corsa, BeamNG, Kart Racing Pro: no primary
        source on their tyre / brake algorithm (KartKraft only says
        "industry standard tire model", kartkraft-notes.md) → no claims.
      - Kart: spool → one ω, one wheel locks = both lock; a lifted inner
        rear lowers the axle's Fx capacity → locks sooner (falls out).
      - Stability (agent's arithmetic, to check): wheel mode λ ≈
        Cκ·r²/(I·v); explicit Euler at 1/480 s unstable at low v →
        semi-implicit ω⁺ = ω + dt·T/(I + dt·r²·Cκ/max(|v|, v_min)).
        Low speed: κ over max(|v|, v_min) + the existing kinematic blend;
        Bernard & Clover SAE 950311 relaxation (abstract only).
      - RECOMMENDED: normalised-slip tyre + one rear-axle spin state
        (as TORCS). Per rear wheel, every substep: κ = (ωr − vx)/max(|vx|,
        v_min); κn = κ/κ_pk; αn = tan α/tan α_pk; ρ = √(κn² + αn²); F =
        D·sin(C·atan(B·ρ)) (D = gripG × Fz × load sensitivity, peak at ρ =
        1, C from slideGrip); Fx = F·κn/ρ, Fy = F·αn/ρ. I_r·ω̇ = drive
        torque − brake torque·sgn ω − r·ΣFx; brake clamp at ω = 0. Front:
        lateral only (unchanged). Replaces gas √(1 − gripRear²), lateral
        √(1 − b²) and the rearBrakeLimit lock; the tipping point, lock vs
        lateral g / load / lift and "a small slide costs speed" all COME
        OUT of it (Robin: "should be found within the algorithm").
        Reuses gripG, peakSlipDeg, slideGrip, loadSensitivity, rearLift,
        wheelRadius, brakeDeceleration, drive, liftOffG, SLIP_MIN_SPEED.
        New: I_r 0.1–0.3 kg·m² (fastest-lap 0.2 + estimate), κ_pk
        0.08–0.15 (UNSOURCED, car-tyre typical; fastest-lap's kart MF
        longitudinal coefficients not decoded yet). brakeLock() → analytic
        straight-line value (= today's at α = 0).
      - Not recommended: demand-ratio "lock filter" without a spin state
        (ad hoc).
- [ ] 1d. Robin (2026-11-13): try DIFFERENT algorithms, pick the best
      balance, then optimise that one. Candidates: A normalised slip
      (TORCS), B Pacejka combined Gxα / Gyκ (VDrift), C TMeasy (Rill) —
      not D (no spin state). Judged on REALISM VS SOURCES (stopping
      distances vs measured data, lock tipping point from the physics,
      trail braking edgy but catchable + a caught slide costs speed).
      Suite --compare and CPU per kart still reported, as information.
- [x] 1e. Prep (2026-11-13, agent; coefficients + κ_pk / locked RE-COMPUTED
      and the XML lines checked by me):
      - fastest-lap commit 0660208 (2023-08-16),
        database/vehicles/kart/roberto-lot-kart-2016.xml; code
        src/core/tire/tire_pacejka.hpp :123–179, tire.h :154 / :157 (κ =
        (ωR − vx)/vx, λ = −vy/vx = tan α), axle_car_6dof.hpp :166,
        actuators/brake.h :48. Source of the values: only "Reference:
        eprints.soton.ac.uk/385883" (Lot & Dal Bianco 2016, not readable)
        — fitted / copied / guessed UNKNOWN. rCx1 "not 100 % sure" (:70).
        rental-kart.xml = same tyres, mass 300, 6.62 kW, rear pDy1 1.25,
        front 1.30 (no comment).
      - Rear: Fz0 560 N × lambdaFz0 1.6 = 896 N; pCx1 2.3, pDx1 0.9 (no
        pDx2: μx load-independent), pEx1 0.95, pKx1/2/3 20 / 1 / −0.5 (Bx =
        (pKx1 + pKx2·dfz)·e^(pKx3·dfz)/(pCx1·pDx1)), rBx1 14, rCx1 1.0 (Gx =
        cos(rCx1·atan(rBx1·tan α))); pCy1 2.3, pDy1 1.5, pEy1 0.9, pKy1 37.6,
        pKy2 1.6, pKy4 2.0; rBy1 12, rCy1 0.6 (Gy = cos(rCy1·atan(rBy1·κ))).
        Fx = Gx·Fx0, Fy = Gy·Fy0 (no ellipse cap). Front: lateral only
        (pCy1 2.13, pEy1 0.8, pKy1 34.1). Axle inertia 0.2 kg·m², brake
        200 N·m axle, radius 0.139 m.
      - Computed (rear): κ_pk 0.094 / 0.107 / 0.123 at 627 / 896 / 1165 N;
        peak Fx/Fz 0.90; locked (κ = −1) 0.52 / 0.55 / 0.58 of Fz; Cκ/Fz
        22.9 / 20.0 / 17.5; lateral peak α 5.1 / 5.9 / 7.0°. Gy floor
        cos(0.6·π/2) = 0.59 → a LOCKED rear keeps ~59–63 % side grip (today:
        Coulomb, ~0 at small slip). μx 0.9 vs μy 1.5 → braking grip 0.6 ×
        cornering (we decided 1.0 in 1, the measured 0.8–1.0 g says
        higher).
      - TMeasy: no primary Rill text (403 / bot check / Scribd); equations
        from two agreeing codes: carpy TMEasy.py (4ca50f1, :54–55,
        :72–160, "based on Rill & Castro's Matlab code") and uwsbel
        low-fidelity-dynamic-models 18dof/dof18.cpp (992faca, :247,
        :440–535). Slips sx = −(vx − rΩ)/(r|Ω| + vN), sy = −vy/(r|Ω| + vN),
        vN 0.01; ŝx = sxM/(sxM + syM) + (FxM/dFx0)/(FxM/dFx0 + FyM/dFy0)
        (ŝy swapped); s = √((sx/ŝx)² + (sy/ŝy)²), cos φ / sin φ; dF0, FM,
        FS, sM, sS combined by φ; F(s): dF0·s/(1 + σ(σ + p)) to sM (σ =
        s/sM, p = dF0·sM/FM − 2), two parabolas sM → sS (cubic fallback),
        FS beyond; dF0 ≥ 2FM/sM; Fx = F cos φ, Fy = F sin φ. Load: quadratic
        in q = Fz/FzN from FzN + 2FzN values (Chrono ChTMeasyTire.h
        :256–261). 20 parameters + FzN, none for a kart → derive from B's
        curves. Chrono car example (GuessPassCar70Par): dFx0 18.37, FxM
        1.13, sxM 0.139, FxS 0.80, sxS 0.667; dFy0 15.98, FyM 1.00, syM
        0.149, syS 0.965 (× Fz). Rill first-order dynamics (uwsbel
        :512–535): needs cx, dx, cy, dy.
      - No other kart κ_pk / longitudinal stiffness anywhere (papers,
        theses, tests): fastest-lap is the only kart Fx data.
      - Downloads (lost with the session): scratchpad prep/fl, mf.py.
- [x] 1f. Weight transfer (Robin asked, 2026-11-13): principle stays
      (m·a·h/L, Beckman; rear-only brakes → braking UNLOADS the braking
      tyres; front-brake karts are the exception — Vroomkart 1.0 g rear vs
      1.2 g both). Open: the size (h, rear share → the paper). Fix in all
      variants: the transfer comes from the ACTUAL longitudinal
      acceleration, not capped at rearBrakeLimit (Car.ts:351) — sent to
      the mechanic. Pasted note (Robin, source unknown): "front tyres make
      the braking friction / lock up" = front-brake karts only.
- [x] 2a. Five variants (2026-11-13, mechanic; C-scaled-ax re-run by me =
      identical, tsc clean). Files: `braking-strength-results/` (suite
      outputs per variant, variants/Car.<variant>.ts — VARIANT / MU_X
      constants — and helper scripts). Suite gained LOCK-TIP, TB-CATCH,
      GS-EDGE, Gs alarm (report-only).
      Built (all): one rear-axle spin state ω, I 0.2, semi-implicit
      LINEARISED in κ incl. the substep's Δvx (plain semi-implicit added
      fake inertia, −0.03 g); TORCS brake clamp; κ over max(|vx|, 1 m/s);
      drive torque from ω (governor on wheel speed); transfer = actual
      longitudinal accel, lagged 0.08, no cap (stable); rearLocked = κ ≤
      −0.5; brakeLock() analytic, worst case at top speed (drag moves load
      forward too). Three old rules removed; front + spool unchanged.
      Racingkart, base → A-scl / B-src / B-scl / C-src / C-scl (axle loads):
      - 106 → 46 at L: 48.8 → 52.1 / 71.7 / 52.1 / 71.7 / 52.1 m (target
        39.1). The ALGORITHM DOESN'T MOVE straight braking: μ, h, rear share
        do. Honest transfer (incl. drag) → slightly longer than today.
      - Braking-only Gs: 0.63 → 0.75 / 0.52 / 0.74 / 0.53 / 0.76.
      - TB slip 0.5 / 1 s: 22 / 18 → 23/19, 54/58, 60/50, 11/11, 15/13 (C-scl
        caught in 0.3–0.4 s).
      - LOCK-TIP: no straight range above 30 km/h in any variant except B
        (its locked rear keeps ~60 % side grip — an MF fit used past its
        range; fastest-lap never locks a wheel).
      - Suite PASS/≈/FAIL/WORSE: base 54/10/23; A 58/8/23/3, B-src
        63/2/28/8, B-scl 65/2/26/6, C-src 60/4/26/5, C-scl 61/8/21/2
        (WORSE: 106 → 46, C1 Centralen 44° vs 28°).
      - CPU µs / kart step: base 2.1–2.4, A 2.2–2.8, B 2.7–3.7, C 3.2–3.5.
      - Side effects: launch ~7 % slower (axle inertia spins up), top
        speed −0.5–1.5 km/h (governor reads wheel speed).
      Findings: per-wheel load sensitivity (my brief) = the candidate
      braking-spin.md already rejected → Racingkart TB 35°, COAST 39°,
      HAIRPIN 25° → axle loads (`-ax`) used. Rental braking alarm 0.70–0.75
      g also in the baseline = front-tyre cornering drag (toggle
      base-nofront) — physical; my rental limit too low. My "mix outside
      the line" alarm was wrong (a line lies inside an ellipse; fires
      76–112× in every variant) → needs an ellipse test. TB-CATCH "km/h
      lost" noisy / negative (the catch's 0.2 gas) — not usable yet.
      Mechanic's ranking (realism): 1 C-scaled, 2 A-scaled, out: B (locked
      rear keeps 60 % side grip), all "source" (μx 0.6 → 0.37–0.52 g).
- [ ] 2b. Robin (2026-11-13): take C-SCALED (TMeasy, axle loads) forward.
      Lock tipping point tested WITHIN REACTION TIME (rotation 0.3–0.5 s
      after the lock; a driver locks, notices, releases). Next: fix the
      tests (LOCK-TIP reaction time, Gs alarm as an ellipse, TB-CATCH speed
      lost without the catch's gas), check C1 Centralen (44° vs 28°), then
      the values (h / rear share) when the paper is in.
      Result (2026-11-13, mechanic; re-run by me = identical): suite still
      61 / 8 / 21 / 2 WORSE vs 54 / 10 / 23. Files: results/suite2b-*.txt,
      variants/c1.ts, Car.Cscl-ax-tog.ts (TOG env), brakingSuite.snapshot.ts.
      - LOCK-TIP (brake 1.0, constant wheel, "straight" = slip < 5° to 0.5 s,
        UNSOURCED): 30 km/h stays straight to 2–4° wheel (both models); from
        50 km/h it tips at 0.05–0.25° in BOTH models; Racing 100: slip at
        0.5 s 41° base / 82° C. Reason: locked tyre ≈ no side stiffness
        (Coulomb) → front alone sets yaw → unstable. Probably harsher than
        real; missing stabiliser candidates (unproven): self-aligning front
        wheels under light hands, relaxation length, a driver correcting.
      - Gs alarm: ellipse (brk/brkMax)² + (lat/latMax)² > 1.1²; rental
        braking limit 0.8 g (rear ~0.55–0.6 + front cornering drag ≤ 0.2);
        gate 8 km/h → 0 alarms on base and C.
      - TB-CATCH lost (over-steer 1.5 × aid, same pedals, gas 0), C: Centralen
        4.6 / 2.1, 270cc 5.1 / 6.5, Racing 0.2 / 6.5 km/h (≥ 0 ✔). C Racing
        clean 15° / 13°, over-brake caught 0.38 / 0.32 s (base 0.45 / 0.45).
      - C1 Centralen 44° vs 28°: ~10° = TMeasy's sliding side force FyS 0.57
        of peak (read off fastest-lap's MF at 45°, far past any fit; ours
        slideGrip 0.75) — a VALUE artefact; FyS 0.75 → 34° (270cc 28°);
        ~3–4° = the axle spinning back up after the stab (physical, I 0.2;
        same effect improves Racing C1 33° vs 60°). Catch gas matters now
        (spins the wheel up).
- [x] 2c. Robin (2026-11-13): C's sliding side grip FyS = our slideGrip
      0.75 (not 0.57). LOCK-TIP: add a driver who corrects (countersteers
      like a real one) → can a lock be held straight-ish? Yes → physics
      fine; no → look for the missing stabiliser.
      Result (mechanic; re-run by me = identical; the variant differs by
      ONE line, FyS = sin(C·π/2) = slideGrip): Cscl-ax2 suite 62 / 8 / 20 /
      1 WORSE (STOP 106 → 46 at L, 52.1 vs 48.8 — the values, not FyS);
      0 Gs alarms. C1: Centralen 34° / 0.70 s ≈, 270cc 28° / 0.60 (= today),
      Racing 30° / 0.43 PASS (today 60° FAIL). BRK-SWEEP Racing 18° (today
      42°). TB Racing 14 / 13° (today 22 / 18). Over-steer trail costs 5.0 /
      6.2 km/h. Files: results/suite2c-*.txt, variants/Car.Cscl-ax2.ts, drv.ts.
      LOCK-DRIVER (brake 1.0 held, cue body slip ≥ 2°, reaction 0.2 s,
      wheel = slip − 0.05 × yaw rate, steeringRate-limited; "straight-ish"
      slip < 10°; ALL UNSOURCED; sign checked by hand): 30 km/h held in
      every kart and both models; from 50 km/h NOT held in either model
      (Centralen 50: 15 / 31 / 70° for 0.25 / 1 / 3° wheel; Racing 75–100:
      77–83°). Gain 0.15 / 0.3 = same: slip grows 2 → 15–30° DURING the
      0.2 s reaction. Earlier cue (lock flag) → baseline holds 0.25–1° to
      75 km/h. Conclusion: rotation after a lock outruns a human above
      ~50 km/h in BOTH models → probably a missing stabiliser (candidates:
      self-aligning steering via caster / trail with light hands —
      no reaction delay; relaxation length; locked-tyre side force).
      Not the new algorithm's fault — today's model is the same.
- [ ] 2d. Robin (2026-11-13): research the lockup stabiliser (read-only
      agent): kart self-aligning steering (caster, trail, aligning torque,
      how fast the wheels align with light hands), real kart lockup
      behaviour, a locked tyre's real side force, cheap steering-DOF /
      hands-off models in sims, a recommendation with equations that
      doesn't break agents (steering position) or the keyboard.
      Result (2026-11-13, agent; the stability numbers re-computed by me
      with a linear bicycle model, locked rear = Coulomb damper Cr ≈
      slideGrip·gripG·Fz_r ≈ 1000–1300 N/rad — same picture):
      - Locked rear stable only if a·Cf_eff < b·Cr → Cf_eff < ~2.4–3 % of
        Cf (~31 000 N/rad). e-fold time Centralen 50 / 75 km/h: Cf 100 %
        0.11 / 0.09 s (= LOCK-DRIVER), 10 % 0.28–0.30 / 0.25–0.27 s, ≤ 3 %
        stable. Racing 100 km/h 100 %: 0.05 s.
      - Coulomb locked force is CORRECT (Gäfvert & Svendenius brush model
        p. 13, req. 7: F = −Fz·μ·v_s/|v_s|; https://lup.lub.lu.se/search/files/4729887/8627779.pdf)
        → not the missing piece.
      - Missing piece (reasoning): front wheels held RIGIDLY in our model
        (and TORCS steer.cpp :49–57: command × lock, rate-limited —
        https://raw.githubusercontent.com/fmirus/torcs-1.3.7/master/src/modules/simu/simuv2/steer.cpp).
        Real: caster self-aligns the wheels; with compliant hands they give
        way → front force capped. Steering mode ω ≈ √(Cf·t/I) ≈ 50–65 rad/s
        → aligns in 25–50 ms, far inside a 0.2 s reaction.
      - Real lockups (Formula Fast coaching, https://formulafast.co.uk/?p=9583):
        straight steering → stable, no immediate oversteer; lock + steering
        → tail happy, spins. Matches Robin. No logger / rental data.
      - Kart steering values: caster 14°, kingpin 13° (Mikler et al. IDETC
        2019, p. 3, https://radar.brookes.ac.uk/radar/file/3d8f925a-d74b-4a82-9d13-645f1710b192/1/IDETC2019-98112.pdf);
        OTK ~18°, Kosmic 18.0 / 19.7°, "typical 15–20°" (KartPulse
        https://forums.kartpulse.com/t/comparing-caster-across-kart-brands-standard-caster-angle/6854).
        Trail ≈ R·tan(caster) ≈ 0.03 m (reasoning; spindle offset
        unknown); pneumatic ~0.01 m (unverified). Steering wheel inertia
        0.03 kg·m² (cars, Schenk et al. 2021 Chalmers p. 13,
        https://research.chalmers.se/publication/533566/file/533566_Fulltext.pdf).
        Arm stiffness: Pick & Cole 2007 measured (abstract only; numbers
        paywalled) — https://www.scilit.net/publications/43bdd2070a1e817209f3d35af3c76dcb.
      - Proposal (agent's own, not from a sim): steering degree of freedom
        with hands. M_align = Σ Fy,i·(t_m + t_p); driver's held torque T_ff
        follows M_align low-pass τ 0.2–0.3 s; per substep quasi-static δ ←
        δ + [K_h(δ_cmd − δ) + T_ff − M_align]/(K_h + Cf·t). Steady state:
        δ = δ_cmd (agents' / keyboard steering keeps its meaning); only fast
        aligning-torque changes move the wheels; Cf_eff = Cf/(1 + Cf·t/K_h).
        Predicted tipping point (quasi-static): sin β_r ≈ (a_y/g) / (slideGrip·
        gripG·share): 0.08 g → ~7° (straight-ish), 0.2 g → ~17°, > ~0.68 g
        (Centralen) → spins — Robin's "around a certain g and turning".
      - The KEY unknown: K_h (hand stiffness at the wheels must be ≲ 40–300
        N·m/rad for a big effect) — no number → would be an estimate / tuned.
        Risks: softer turn-in during τ, pneumatic trail collapse past the
        peak (option: mechanical trail only), keyboard aid re-tune.
      - Not found: Lot & Dal Bianco / Biral kart steering, Milliken ch. 19,
        kart pneumatic trail, rental lockup data, AC / rFactor internals.
      Decision (Robin, 2026-11-13): FINISH BRAKING FIRST — C (Cscl-ax2) to
      Phase 3 (Robin drives); lockups behave as today (not worse). The
      self-aligning steering = its OWN next task (plan from this section;
      first find a measured hand stiffness, e.g. Pick & Cole 2007).
- [ ] R. Physics in modules (Robin, 2026-11-13: "we will have many things
      in the long run that handle one part of the physics" — keep the big
      picture). server/src/game/cars/physics/: tyre.ts (grip budget: slip +
      load → force), loads.ts (transfer, lift, load sensitivity), rearAxle.ts
      (spool: spin, brake / drive torque, clamp, axle moment), drivetrain.ts
      (torque curve, gearing, governor, lift-off), resistance.ts (rolling +
      drag), steering.ts (wheel angle, rate, Ackermann; later self-aligning),
      chassis.ts (body: vx, vy, yaw, substeps, low-speed blend). Car.ts =
      state + the order each tick. Kart values per kart grouped by module;
      .personal "Car Physics" one section per module.
      - [x] R1. Today's physics into the modules, NO behaviour change.
            Proof: per-tick state traces bit-identical old vs new + suite
            --compare all "=".
            Done 2026-11-13 (agent; BOTH proofs re-run by me: original copy
            = git HEAD, fresh traces old / new byte-identical — 38 880 ticks
            × 35 values as exact hex doubles, 3 karts × 11 scenarios ± rate
            limit, 3 710 locked ticks, reverse, NaN steering; suite 164 / 164
            "=", counts identical; tsc clean). Car.ts 512 → 367 lines;
            physics/ tyre 42, loads 60, rearAxle 75, drivetrain 70,
            resistance 16, steering 35, chassis 88, constants 2 (G).
            Didn't fit: SlipValues stays in Car.ts (spans modules; loads
            type-imports it); load sensitivity in loads.ts (→ tyre.ts in R2?);
            rearSideForce in rearAxle (depends on the lock); frontForces in
            chassis. Same-number reshapes: Ackermann once per tick, front
            grip / wheel count, longAccel update moved (independent). Public
            API unchanged (rearBrakeLimit, torqueAt, DriveValues re-exported).
            Trace script: results/r1/trace.ts (`node -r ts-node/register
            trace.ts <src dir>`).
      - Trace tool in the repo (Robin): server/scripts/physicsTrace.ts,
        `npm run -s physics-trace [-- <src dir>] > out.txt` (default ./src),
        then `cmp` old / new. Checked: same output as the R1 script.
      - [x] R2. Swap in C (TMeasy tyre + rear-axle spin) — diff only in
            tyre.ts / rearAxle.ts (+ loads); suite = 2c results.
            Done 2026-11-13 (agent; re-checked by me: proto copy = the
            mechanic's Cscl-ax2; tsc clean; suite vs prototype 164 / 164
            "=", 62 / 8 / 20; trace vs prototype: 38 886 lines differ ONLY in
            the removed rearBraking column (index 18) — nothing else).
            Only C (no A / B / VARIANT / MU_X). tyre.ts 42 → 150 (TMeasy
            `tmeasy(κ, tan α, Fz, Dy, sideSlide)` → Fx, Fy, dFx/dκ, reused
            tuple; peakGrip = load sensitivity moved here; fastest-lap shape
            tables; removed slidingForce / gripLeft / tractionLeft).
            rearAxle.ts 75 → 109 (AXLE_INERTIA 0.2, slipRatio, isLocked κ ≤
            −0.5, spinStep semi-implicit + TORCS clamp, analytic
            lockingBrake; old lock path removed; reverseBrake = the old rule,
            reverse only). loads.ts 60 → 48 (no rearBrakeLimit cap).
            drivetrain.ts 70 → 81 (axleDrive: drive from ω, governor on wheel
            speed). chassis.ts 88 → 89. Car.ts 367 → 390: new public
            wheelSpin (rad/s), slipRatio; removed private rearBraking (dead:
            only written in reverse, never read). Rear wheels at half the
            axle load → computed once, doubled (bit-identical).
            Open (Robin): reverse keeps the old lock rule? sliding side grip
            sin(C·90°) vs slideGrip directly (1 ulp at 0.75)? trace tool:
            rearBraking → wheelSpin / slipRatio? laptimes.ts brake plan still
            uses rearBrakeLimit + √(1 − gripRear²) → re-check before laptimes.
            .personal "Car Physics" not updated yet (docs step).
      - R2 decisions (Robin): reverse keeps the old rule; sliding side grip
        = slideGrip directly (slidingShare removed; suite vs prototype still
        164 / 164 "="); trace tool records wheelSpin / slipRatio instead of
        rearBraking.
      - [ ] then Phase 3 (Robin drives). Set up 2026-11-13: Robin's S3 on
        9100; worktree server `PORT=8081 npm start` (no .env → Track API
        off), App `VITE_WS_URL=ws://localhost:8081 npm run dev -- --port
        5174 --strictPort` (own npm ci). Smoke test: test-agent on 8081,
        Centralen + Racingkart drive, no errors.
        Robin drove (keyboard, TrainingLong, Centralen): hard to feel with a
        keyboard; "the tipping point might lag a little too much" = the REAR
        LETS GO LATE (braking into a corner). Measured by me (scratchpad
        lag/lag.ts, one.ts; steady corner then brake; copies: today = R1,
        new I 0.2 / 0.15 / 0.1 kg·m²):
        - Full pedal stab: rotation (body slip +5°) today 0.15–0.25 s →
          new 0.23–0.33 s; lock flag today 0.02 s → new 0.07–0.22 s
          (Racingkart slowest). Axle inertia 0.2 → 0.1 shortens only
          0.02–0.07 s → inertia is NOT the main cause.
        - Pedal at L (the lock point) in a corner: today rotates after
          0.4–0.65 s; NEW NEVER ROTATES (Centralen 45 km/h: rear grip use
          1.00, κ creeps −0.04 → −0.2 over 1 s past κ_pk without running away
          to a lock, rear slip ~1°, body ~0°). Suspects (unverified): the
          TMeasy fall past the peak too flat (sxS = 1 = estimate, fully
          sliding only at κ = −1); L computed worst case at TOP speed → below
          the real lock pedal at lower speed; TMeasy's slip normalisation.
        - Keyboard (ramp to 0.8 L): no rotation in either model here.
        Note: my steady-corner set-up reached only ~0.48 g of the asked 0.7.
        - [ ] 2e (Robin: yes): mechanic finds why the wheel doesn't run away
          past the peak (toggles: TMeasy fall / sxS estimate vs fastest-lap's
          Fx(κ) curve, L at top speed vs corner speed, ŝ normalisation, the
          semi-implicit linearisation) → a SOURCED fix on a copy; lag.ts +
          suite --compare vs the worktree.
          Result (2026-11-13, mechanic; the noouter toggle + fix lag rows
          re-run by me = confirmed). Files: results/p2e/ (fix/, tog/ with
          TOG=fit|chrono|noshat|slope|noouter, scripts, outputs).
          1. MAIN CAUSE = the outer-rear brake moment (braking-spin
             stabiliser: brake force × (1 − rearLift) × rear track / 2, only
             while not locked κ > −0.5). Centralen 45 km/h at L, t 0.4 s
             yaw moments N·m: front +472 vs rear tyres −130, spool −131,
             outer brake −212 → holds. Off → slip −4° at 0.4 s, locked 0.6
             s, −30° at 0.8 s (my run). Physical for a rigid axle with a
             light inner wheel, BUT inconsistent: a locked wheel's force is
             also ∝ its load, so the moment should exist locked too (now:
             holds, then snaps). rearLift 0.72 at 0.43 g (+ braking) —
             mostly roll (check vs ".personal": roll alone only past ~2 g?).
          2. L is below the true lock pedal by design (worst case at top
             speed): in a corner rental 1.00–1.05 × L, Racing 1.12–1.18 × L.
             Past it the new model runs away (1.1 × lock: locks 0.47–0.55 s;
             1.25 ×: 0.27–0.35 s). Today's instant 0.02 s lock isn't physical.
          3. Spin step linearised with the κ = 0 stiffness → fake inertia
             past the peak (0.2 → ~0.32–0.42 kg·m²). Fix: local dFx/dκ
             (finite difference, ≥ 0) = linearly implicit Euler's Jacobian.
          4. TMeasy fall past the peak too flat (sxS = 1): share of peak at κ
             0.2 / 0.3 / 0.5: fastest-lap 0.90 / 0.82 / 0.72, TMeasy 0.99 /
             0.96 / 0.83. Least-squares fit to fastest-lap's Fx0(κ): sxS
             0.58–0.67, FxS 0.63–0.69 (RMS −45 %); smoothstep still flatter
             just past the peak.
          5. ŝ normalisation: no effect.
          6. Racingkart locks slowest: full pedal only ~1.8 × the rear peak
             under transfer; lock ≈ I·ω / excess torque ≈ 0.24 s
             (brakeDeceleration is an estimate).
          Fix copy (3 + 4): lag full pedal −0.02–0.07 s (Centralen .07 →
          .05, 270cc .12 → .08, Racing .22 → .15); at L Centralen locks 0.78
          s / rotates 1.00 s (current never); other L rows still never (cause
          1). Suite vs current: 61 / 8 / 21, 1 WORSE C1 Racing 30° → 49°
          (toward today's 60°; criterion reconstructed); rental C1 better;
          full-lock stops 5–7 % shorter (fit's locked force 0.63–0.69 vs
          0.55–0.64); L stops, TB, LOCK-TIP / DRIVER, GS-EDGE ≈. CPU 3.25 →
          4.05 µs / kart step (+25 %, the finite difference), start-up +0.1 s.
          Open (Robin): the outer-brake moment rule.
          Decisions (Robin, 2026-11-13): outer-brake moment CONSISTENT (follows
          each wheel's load rolling AND locked — removes "holds, then snaps";
          does NOT make the rear let go sooner); the numerical correction
          (local dFx/dκ) YES; the TMeasy fall-off fit NOT now (mixed: locked
          grip above the kart tyre data's own value). Then check the inner-
          rear lift that sizes the moment against the sources (the real lever
          for "lets go late"). Wording: "fastest-lap" = the open-source
          project's kart tyre data, not our lap times — say "the kart tyre
          data (fastest-lap project)".
- [x] 2f. Implement those two on a copy → lag.ts + LOCK-TIP / LOCK-DRIVER +
      suite --compare vs the worktree; then the lift check.
      Result (2026-11-13, mechanic; 1 + 2 suite re-run by me: 64 / 6 / 20,
      0 WORSE, 0 Gs alarms; C1 Centralen 34 → 11°, 270cc 28 → 10° (PASS),
      Racing 30 → 22°). Files: results/p2f/ (fix12/Car.ts + rearAxle.ts,
      lag / truelock / lift / suite outputs).
      - Change 1 (local dFx/dκ, names kappaStep / longitudinalStiffness):
        lock 0.02–0.05 s sooner, rotation 0.01–0.03 s sooner; alone: C1
        Racing 44° (WORSE); CPU ~+25 %.
      - Change 2 (outer-rear brake moment = max(0, −Fx) × (1 − rearLift) ×
        rear track / 2, rolling AND locked; Milliken ch. 20, Lot & Dal
        Bianco): gives back 0–0.04 s of rotation; locked karts calmer —
        LOCK-TIP straight to ≤ 4–5° at 30 km/h, ≤ 0.25° at 50 (rental);
        LOCK-DRIVER max slip in 1 s e.g. Centralen 50: 15 / 30 / 69 → 14 /
        21 / 36°, 270cc 75: 72–78 → 34–59°, Racing 75: ~79 → 57–67° (still
        not < 10° from 50 km/h); rental locked-spin scenarios 13–20° less.
      - True lock pedal in a corner: rental 1.00–1.04 × L, Racing 1.12–1.15
        × L; at 1.1 × it locks 0.37–0.48 s (current 0.47–0.55).
      - Lift check: moved share (1 − rearLift) 0.21 / 0.42 / 0.56 at 0.4 /
        0.8 / ~1 g (rental; roll ≈ 0.42 × g + small jacking), Racing 0.20 /
        0.40 / 0.49. Note (low confidence) says the inner rear lifts at
        0.5–1.0 g → the model lifts LESS, if anything. More lift → a bigger
        moment → steadier, not quicker to let go. No source supports less →
        the lift is NOT a sourced lever for "lets go late".
      - Mechanic's read: the rest of the gap to today's instant lock is
        physical (axle spin-down, L below the true lock); today's 0.02 s
        lock was never physical.
      - Robin: apply 1 + 2 to the worktree (done 2026-11-13).
      - Robin brakes with SPACE only → capped at 0.8 × L (KeyboardControls
        BRAKE_AID) while the true lock in a corner is 1.00–1.15 × L → with
        the keyboard the rear can NEVER lock; it only lets go via steering.
        Options (Player mode only, not physics): raise the cap; a full-brake
        key. Robin to decide.
      - Found (scratchpad lag/sbrake.ts, 45 → 0 straight): TODAY's model
        S (reverse) + Space brakes up to 0.63 / 0.86 / 1.09 g and NEVER locks
        — the reverse pull acts on speed outside the rear grip budget (a
        bug; agents can use it). New model: S goes through the rear tyres →
        S + Space locks (0.13–0.65 s), peak 0.59–0.86 g. Open: S while
        rolling forward isn't real for any of our karts (270cc no reverse,
        Centralen backs up from standstill) → reverse only near standstill?
        (behaviour change, agents too — Robin decides).
      - Robin: "S should not do anything until you stand still" → done in
        the worktree: drivetrain.axleDrive takes the gas only (no reverse);
        Car.applyControls already switches to reverse at standstill. Check:
        S alone 45 → 0 = coasting (0.04–0.14 g), S + Space = Space alone;
        S held from 20 km/h → stops, backs up; suite 0 rows changed.
        DOCS step: docs/agent-protocol.md + .personal (backward ignored while
        rolling forward; reverse from standstill).
      - Robin: wants to BRAKE HARDER with the keyboard (Space only) → Shift +
        Space = full pedal (Space alone stays the 0.8 × L aid). Done in the
        worktree App: KeyboardControls held.fullBrake ('shift'), brake ramps
        (0.6 s) to 1 instead of BRAKE_AID × brakeLock; releasing Shift drops
        back to the aid's cap. App tsc clean; not yet tried in the browser
        by me. DOCS: .personal "Keyboard".
      - Robin drove again: "felt ok, but still hard to feel anything on
        keyboard. I didn't brake much" → watch bots instead. Scratchpad
        bot/brakingBot.ts (test-agent ray driving; styles threshold 0.9 × L,
        trail 0.9 × L × max(0, 1 − |steering| / 0.5), lock = pedal 1; stateMs
        50; run with NODE_PATH=<worktree server>/node_modules
        TS_NODE_TRANSPILE_ONLY=true). New model: worktree server 8081, lobby
        on viewer 5174; today: main checkout server code on 8082 (read only),
        viewer = worktree App on 5175 (VITE_WS_URL 8082). TrainingLong,
        HyrkartCentralen, L 0.396 new / 0.381 today.
      - Robin watched: bots crash, and a collided car moves further out —
        "once collided, then collided until next restart". Cause (old design,
        both models): GameEngine.tickPlayer still ran applyControls while
        blocked ("it can still steer free") → rotation + Car.steer's pivot
        shift x/y; hasCollision re-checked each tick → rotated free → drove
        on. Measured 30 s: 2 of 3 cars moved while colliding in each lobby.
        Robin: FROZEN until restart, incl. no reversing out; do it NOW.
        Done in the worktree GameEngine.tickPlayer: hasCollision → speed 0,
        stopSliding, no applyControls, blocked → no move; only car.reset()
        (restart / next stage) clears it. Verified 30 s both lobbies: 0
        frames moved / rotated while colliding. "Today" lobby now runs a
        copy (scratchpad today-freeze = R1 src + only this GameEngine
        change) on 8082 for a fair comparison.
        DOCS / PROTOCOL: agents must send restart after a crash (no backing
        out); .personal "Collision Detection" ("Response: the car stops while
        colliding; Reset recovers" → frozen until restart), the "Reverse
        stays (agents back out of crashes)" notes, docs/agent-protocol.md.
- [ ] Naming pass (2026-11-13): proposal results/naming-proposal.md (~80
      renames; misleading: inner → rearWheelLoad, fy → vyFront, d in
      steered.map → wheelAngle — checked by me) + a symbol chart
      server/src/game/cars/physics/SYMBOLS.md (Robin: "you might have to
      leave a math symbol chart, I don't know them by heart"; next to the
      code). Robin: APPLY ALL; public names kept. DONE 2026-11-13 (agent;
      proofs re-run by me): tsc clean; trace: all 38 887 number lines
      byte-identical, the key lists identical apart from the private
      spinLive → wheelSpinStarted; suite 164 / 164 "="; no old names left.
      shx / shy → normaliseX / normaliseY (carpy calls them hsxn / hsyn);
      sxn / syn kept (= carpy's Sxn / Syn). Deviations: slide's wheels →
      frontTyres (frontWheels is the steering function), + a few
      consistency renames (wheelSlip's d, reverseBrake's rearMax, etc.),
      torqueAt lower / upper names. physics/SYMBOLS.md (105 lines) + a
      pointer in every module's top comment.
- [x] Revert the temporary Player-mode changes (2026-11-13): git checkout of
      app/src/views/SinglePlayerView.ts (its only changes were the two
      TEMPORARY lines) → TrainingOne + the session's first kart again; no
      TEMPORARY left; App tsc clean.
- [ ] Docs (2026-11-13, Robin: step 3). .personal copied into the worktree
      (git-ignored → branch docs live there; ROBIN COPIES THEM TO MAIN AT THE
      MERGE). Done by me: worktree docs/agent-protocol.md — backward only
      from standstill; braking note rewritten (one grip budget, lock not
      instant ≈ 0.05 / 0.08 / 0.15 s at full brake, lock points 0.40 / 0.55
      / 0.59, lockup by speed, trail braking costs speed; old 0.85 / 0.9 /
      0.6 thresholds removed — unverified for the new model); hasCollision =
      frozen until restart (+ §6); gripRear = whole rear grip budget.
      Agent: worktree .personal/CLAUDE.md (Car Physics per module,
      Collision response, Keyboard Shift + Space, Folder Structure) — DONE
      (678 → 799 lines; old rules removed; websocket.md unchanged; backup of
      the pre-edit file in scratchpad CLAUDE.before.md). My follow-ups,
      measured on the FINAL code: full-brake lock in a corner 0.05 / 0.08 /
      0.17 s (docs had 0.15 for Racing — fixed in both docs); full gas 0 → 58
      km/h 5.78 / 13.87 / 3.53 s vs today 5.50 / 13.28 / 3.30 (+4–7 %), top
      59.9 / 71.9 / 114.2 vs 60.0 / 73.3 / 115.0 km/h (scratchpad
      lag/launch2.ts). Code COMMENTS fixed (no behaviour; trace unchanged,
      tsc clean): Car.ts + drivetrain.ts "back out of a crash" → reverse
      only from standstill; loads.ts "roll alone lifts it FULLY only past ~2
      g (partly before: ~0.42 per g)".
- [x] Step 4: laptimes.ts still plans with rearBrakeLimit + √(1 − gripRear²)
      (the old model) → update before re-running expected lap times.
      Done 2026-11-13 (Robin: yes): plan at 0.65 × lockDeceleration(car) =
      brakeLock() × brakeDeceleration / 3.6 (m/s²); press 0.7 × brakeLock()
      (no √(1 − gripRear²): gripRear is now the whole budget incl. the
      braking → it held itself back); rearBrakeLimit import gone, and
      Car.ts's re-export of it removed (reverse uses it inside rearAxle).
      tsc clean. Worktree deploy/.env = a SYMLINK to main's (git-ignored, keys
      not copied). Dry run (read only, nothing written):
      results/laptimes-dry-run.txt — 42 values change in 5 files; mostly
      +0.5–1.5 % (slower launch / lower top speed), a few faster (Skovde
      270cc −0.4 s, Racing −1.9 s); largest: Skovde Centralen 95.8 → 99.3
      (+3.7 %), Lulea Racing 60.4 → 62.5 (+3.5 %), Torslanda Training 4
      Racing 9.2 → 9.9 (+7.6 %). Writing (--yes) only at the deploy, with
      Robin.
- [x] Step 5: committed 2026-11-13 (Robin: "go") on feat/braking-suite in the
      worktree, 10 commits, author Robin, no Co-Authored-By, each state
      type-checked + suite-run before its commit (counts: 2 = 54 / 10 / 23,
      3 = 62 / 8 / 20, 4–7 = 64 / 6 / 20; 6 → 7 trace numbers identical);
      final tree = the pre-commit backup exactly; working tree clean:
      64c9a24 test suite + trace · f433f8c refactor modules · ae1975c TMeasy
      + axle spin · 8b69805 lock runaway + outer-rear moment · 8a2a0c6 reverse
      only from standstill · b396dd5 crash frozen · de77514 names + SYMBOLS.md
      · a198703 Shift + Space · f951542 lap-time bot · a5e4998 agent protocol.
      NOT done (Robin decides): merge into main, copy the worktree's
      .personal/ to main at the merge, push / deploy, laptimes --yes (+ restart
      the hosted server), npm run fetch locally.
- [ ] Naming pass before any commit (Robin, 2026-11-13: "be careful of
      using shorthands on variables if they not math standards"): spell out
      non-math shorthand in the physics modules and scripts (e.g. iEff, kv,
      flBx / flBy / flFx / flFy, T_TANPK, sxS-style names outside the cited
      TMeasy equations); standard symbols (κ, α, Fx, Fz, μ, dt, v) stay.
      Proof: physics-trace byte-identical before / after the renames.
        TEMPORARY (Robin): worktree app/src/views/SinglePlayerView.ts:8
        SESSION = 'TrainingLong' — REVERT to 'TrainingOne' before any commit.
        TEMPORARY too (Robin: "let me drive 270cc"): SinglePlayerView.ts:59
        kart: 'Hyrkart270cc' — REVERT to lobby.session.cars[0].
        Robin drove the 270cc (Player mode, new 5174 vs today 5175):
        "I think it's much better now" (2026-11-13) — "you can brake a much
        more sensible amount and I like the catch-a-slide feel" — "you can
        catch it if you're quick" (= scoreboard 5: edgy but catchable ✔).
- [ ] 1g. Robin's 270cc table (2026-11-13, source unknown): outdoor dry
      lateral 0.9–1.1 g, heavy braking 0.6–0.8 g, acceleration 0.3–0.4 g
      (indoor 1.1–1.3 / 0.8–1.0 / 0.3–0.4). Model 270cc: lateral max
      1.10 g ✔; braking straight 0.55 base / 0.61 C (+ front drag in turns
      0.72) — low end; acceleration ≤ 0.16 g (19.1 Nm × 3.09 × 0.9 / 0.1455
      m / 230 kg) — far below (gearing estimate? separate task).
      Second paste (same, source unknown): sliding grip 75–85 % of peak
      (outdoor peak 0.9–1.0 → slide 0.65–0.75 g), hard rubber = progressive,
      heavy kart scrubs speed / regains grip slowly → supports slideGrip
      0.75 (2c). Inconsistent: 0.35 g acceleration needs ~790 N = ratio
      ~6.7 with 19 Nm → out of revs at ~29 km/h, not 80 → can't both be
      true. Outdoor peak 0.9–1.0 g vs our gripG 1.15 (model max 1.10 g):
      maybe slightly high — no change without a source.
- [ ] 2. Worktree ~/Projects/formulai-braking: cause 2, then each approved
      value, one at a time, full suite each, old vs new.
- [ ] 3. Robin drives (Player mode, 5174 / 8081).
- [ ] 4. After approval: commit, laptimes, docs.
