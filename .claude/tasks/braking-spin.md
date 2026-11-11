# Braking spin (2026-11-11)

Robin: "they barely brake but spin" (live lobby 9E3EB1, 40 × Hyrkart270cc,
stage 8, agents). Investigation only so far — no code changed.

## Recorded on the live server (2026-11-10)

Read-only viewer from the lobby page, 20 frames/s, all cars on the stage
(pedals only for the followed car). Slip = nose vs direction of travel
(from position deltas), yaw from angle deltas.

- 30 s: no spin. Followed kart braking 0.2–0.4 at 15–25 km/h, steering
  15–50°: slip < 5°, clean.
- 3 min: 100 flagged (slip > 20° above 8 km/h), **71 without wall
  contact**, 35 of 40 karts, 10–34 km/h (median 21), most rotate to ~94°.
- With pedals (Hyrkart270cc locks at brake ≈ 0.54):
  - #10: 27 km/h, steering 73 / 90° (wheels 26°), **brake 0.4 (74 % of
    lock, not locked)** → yaw 89 → 305 °/s, slip → 93°.
  - #4: 26 km/h, steering 67°, brake 1.0 (locked) → 90° in ~0.5 s,
    still 200 °/s at 8 km/h.
  - #6: brake 0.8 (locked) 0.2 s, then 0.4 + countersteer → slip held
    ~22° then grows; never released fully.
  - #17: weaving ±40°, alternating full gas / brake 1.0 → slow rotation
    to 29°, stops.
- Earlier (offline): Racingkart125cc standing still after hard braking in
  a corner still shows gripRear 0.70, rear slip ~1°.

## Driver's view (subagent, experience + forums; no measured data)

- Direction right, amount wrong. #10 on a real rental kart: mostly
  ploughs, 20–45° rotation, a full spin < ~30 % (guess). Yaw growing to
  300 °/s with the brake UNLOCKED looks wrong.
- #4 (locked + steering) spinning fast: realistic. Slowing the rotation
  at low speed (305 → 101 °/s in 0.2 s): about right.
- Recovery: release the brake fully + countersteer + a little gas →
  caught in 0.2–0.5 s if slip < ~30°.
- Straight-line lockup: sources disagree whether a rental kart spins
  (Reiza forum thread) — test it.
- For agents: brake in a straight line at 0.7–0.9 of lock, ease off as
  steering grows (zero by mid-corner), ≤ 50–60 % lock at 20–40 km/h
  (full lock ploughs), slip > ~8° → release fully, countersteer, a little
  gas; never brake 1.0 while turning.
- Sources: forum.reizastudios.com/threads/less-braking-stability-and-lateral-grip-needed-for-rental-karts.14201/,
  gtplanet.net/forum/threads/how-to-not-spin-out-during-go-karts.133886,
  forums.kartpulse.com/t/hairpin-turn-in-low-hp-kart/4341?page=2,
  k1speed.ca/blog/essential-braking-tips-to-improve-your-go-kart-skills/,
  kartclass.com/blogs/news/go-kart-braking-techniques,
  redbull.com/int-en/karting-mistakes-novices-make

## Target behaviour — Torslanda 270cc (from Robin, 2026-11-11; UNSOURCED)

**These values are for the Hyrkart270cc (Torslanda) only** — Robin:
HyrkartCentralen (electric, 60 km/h) and Racingkart125cc (slicks, 115
km/h) may differ; test them for "no worse", not against these numbers.

Pasted text (rules of thumb, no sources — a target, not physics values).
"Brake pressure %" read as a share of our lock point (pedal 1.0 always
locks here); "degrees" as steering wheel degrees (lock 90°). One claim
is shaky ("lower momentum reduces lateral G" — at the grip limit G is
the same; what differs is that rotation is easier to stop).

| Phase | Max brake | Max steering | If exceeded |
|---|---|---|---|
| Top speed entry (~70–80 km/h) | 90–100 % (straight only) | < 5–10° | instant rear lockup, snap spin |
| High-speed sweeper | 0–10 % | 10–20° smooth | rear wide or front understeer |
| Low-speed hairpin (~25–40 km/h) | 20–30 % (trail braking) | 30–45° | scrubbing speed or mild oversteer |

- Top speed: brake hard straight, release completely before turn-in;
  steering under 10–15 % brake only.
- Low speed: a light brake tap / drag helps the kart pivot; a slide is
  caught easily with a flick of opposite lock + smooth throttle.

## Test cases (scripted drive, all karts, before / after any fix)

| Test | Expected |
|---|---|
| 75 km/h, brake just below lock, wheel < 10° | brakes straight, no spin |
| 75 km/h, brake + wheel > 10°, or locked | snap spin (allowed) |
| 30 km/h, brake ≤ 0.3 × lock, wheel 30–45° | rotates a little, no spin |
| 30 km/h, brake 0.74 × lock + 73° (event #10) | mild oversteer, CATCHABLE by release + countersteer |
| Straight-line lockup | open (sources disagree) |
| Standstill after braking in a corner | gripRear / slip → 0 |

## Baseline against the test cases (2026-11-11, current main 8d65a4e)

Script: scratchpad `spintest.ts` / `sweep.ts` (Car.applyControls, no
track). All 3 karts: every case spins (max body slip 64–87°), even A
(75 km/h, 0.9 × lock, wheel 5° = front 1.8°: around in ~0.4 s, gripRear
stays ~0.45 while slip grows) and the sweeper (0.1 × lock, 15°). F:
Racingkart standing still keeps gripRear 0.70 / slip 1°.

Sweep Hyrkart270cc, max body slip (● > 45°, · < 15°):

```
75 km/h   brake × lock 0.1 … 0.9      30 km/h   brake × lock 0.1 … 0.9
wheel 0°   · · · · · · · · ·          wheel 0-10°  · · · · · · · · ·
wheel 2°   · · · ● ● ● ● ● ●          wheel 20°    · · · · · · · · ●
wheel 5°+  ● ● ● ● ● ● ● ● ●          wheel 40°    ● ● ● ● ● ● ● ● ●
```

(wheel = steering wheel °, lock 90°.)

## Mechanic's view (subagent, code review + offline replay)

Scratch copy with toggles: scratchpad `mechanic/` (sim.ts, still.ts).
Replay of #10 (baseline 290 °/s, 90°): rearLift held 1 → 83 °/s, 18°;
no weight transfer → 104, 16°; no brakeShare → 198, 45°; slideGrip
0.85, yaw inertia ±, load sensitivity, lift from real side force → no
change; **outer-wheel brake moment → 89 °/s, 19°**. #4 (locked): 277 →
93 °/s, dies out. #6's no-recovery not reproduced (inputs guessed).

Ranked causes:
1. **Rigid-axle yaw damping vanishes when the inner rear lifts**
   (Car.ts:337-339). rearLift → 0 above liftG 0.75 (from |vx·r|/G —
   0.92 g at 25 km/h, 75 °/s). A real lifted kart: the OUTER rear tyre
   carries the whole axle's brake force at track / 2 → stabilising
   moment ≈ F_brake × (1 − rearLift) × track / 2 (~525 N·m); the model
   puts it on the centreline. Under gas the same term turns it in
   (loose on power). Fix: split the rear longitudinal force by
   left / right load, add the moment. Lift input should be the real
   side force (this.lateralG), not vx·r (no effect alone). Sources: Lot
   & Dal Bianco, VSD 2016 (eprints.soton.ac.uk/385883/); Milliken RCVD
   ch. 20 (spool). Uncertain: no kart data on the moment's size —
   first-order estimate.
2. Brake weight transfer (Car.ts:300, 316-318, 346): the trigger, but
   physical — keep.
3. Friction ellipse, braking first (Car.ts:319, 332): consistent with
   combined slip (Pacejka §4.3) — keep.
4. **Low speed** (Car.ts:14, 305, ~348): "never below 0" clamp + 1 m/s
   floor → fake steady state (standstill gripRear 0.70, 1.5 °/s
   forever); slip pinned at 90° in a spin. Fix: relaxation length
   dα/dt = (v_y − |v_x|·α)/σ, σ 0.1–0.3 m, or blend into `steer`
   below ~3 m/s + hold when braked at standstill. Sources: Bernard &
   Clover SAE 950311; Pacejka ch. 7; Kabzan et al. arXiv 1905.05150.
5. Values: yawInertia (k 0.49 / 0.41 m), CoG, weight split plausible;
   slideGrip 0.75 drops faster than typical (C ≈ 1.46 vs ~1.3), low
   priority; brakeDeceleration 35 vs lock 0.53 g → top 46 % of pedal
   only locks — document, or ~25 for more pedal feel.

## It spins without braking too (2026-11-11)

Current code, coasting (gas 0, no brake), steady steering wheel, 2 s:
50 km/h wheel 10° / 20° → Hyrkart270cc 32° / 78°, HyrkartCentralen
80° / 82°, Racingkart125cc 82° / 80° (spins). With gas mostly stable;
30 km/h all clean. Mechanic's toggles at 50 km/h coasting, wheel 10–40°:
noLift → clean, noTransfer → clean, noLS / slideGrip 0.9 → still spins.
Same core as cause 1: inner rear up → axle damping gone; steering scrub
decelerates → weight forward → rear lets go.

Mechanic's brake moment alone (sweep, 270cc): braking mostly fixed
(event #10 situation → 11°), but light brake 0.1 × lock + wheel 10–20°
at 75 km/h still spins, brake 0 spins, and locked + 73° at 30 km/h
only 17° (should spin — it uses the asked force, a locked tyre gives
slideGrip × it).

Hypothesis (UNVERIFIED): front and rear have the same cornering
stiffness per kg (same peakSlipDeg) → about neutral steer; real karts
have much wider rear tyres (rental ~10×4.50 front, 11×7.10 rear) →
understeer → stable with the inner wheel up. Robin: if real karts have
wider rear tyres, we may need that too → mechanic follow-up (phase 0).

## Phase 0 result — mechanic follow-up (2026-11-11)

Toggled Car + suite: scratchpad `mechanic/` (suite.ts, toggles kF / kR
stiffness, muF / muR peak grip, bm2, bmNoLock, bmDrive). Not yet
re-verified by me.

- Coasting spin at 50 km/h, wheel 10–20° (front 3.5–7° = asks 1.1–2.2 g):
  unrealistic — a rental kart pushes wide (also Robin's table).
- Our model: per-axle stiffness and peak grip both ∝ load → understeer
  gradient exactly 0 (all karts) and neutral at the limit too; only the
  rigid axle (gone when the inner rear lifts) and the MF drop past the
  peak give understeer.
- Wider rear tyres: what matters is more rear PEAK grip at the limit
  (or less front), not stiffness. kR 1.3 / 1.6 alone changed no spin.
- No published kart tyre data found (sizes: rental 10×4.50-5 / 11×7.10-5,
  Mojo D5 4.50/10.0-5 / 7.10/11.0-5). Load per mm of tread → ~1 % — no
  justification for 10 %. My check: load sensitivity across the axle
  gives < 1 % at the front, and the lifted rear LOSES grip → muF is a
  CALIBRATION value, not sourced.

| Variant | Coasting | Braking 75 km/h | #10 / #4 °/s | Steady 30 km/h 270cc |
|---|---|---|---|---|
| Baseline | many spins | all spin | 290 / 277 | collapses to 8–12 km/h |
| kR 1.3 / 1.6 | same | same | same | same |
| bm2 | same | ≥ 0.3 × lock clean; 0, 0.1 spin | 89 / 139 | same |
| muF 0.9 | 3 / 18 spin | spins ≥ 0.3 × lock | 258 / 253 | holds 24 / 17 km/h |
| bm2 + muF 0.9 + kR 1.3 | 1 left | ≤ 13° (0.9 × lock + 73°: 29°) | 78 / 98 | no collapse |
| bm2 + muF 0.85 + kR 1.3 | all clean | ≤ 10°; locked 37–48° | 72 / 77 | 0.95 / 0.89 g |

- #10 + release + countersteer recovers in every variant; 0.74 × lock +
  73° at 30 km/h → ~11° (mild, catchable).
- bmNoLock (no outer-wheel moment while locked): locked + 73° at 30 km/h
  → 69° spin, 75 km/h locked → spins, #4 spins again — matches "locked →
  spin". Unsourced but practical (lift model doesn't put the inner rear
  back down under braking).
- Outer side = −sign(lateralG); moment = sign(lateralG) · Fx_rear ·
  (1 − rearLift) · track / 2, Fx_rear < 0 braking. bmDrive (gas on the
  outer wheel) made gas cases spin → leave out.
- Missing stabilisers: front geometry (caster jacking), lift from real
  lateral g, inner rear back down under braking, relaxation length.

## Plan (Robin: go, 2026-11-11; branch fix/braking-spin)

One fix per phase, each proven on the test cases + sweep (before /
after); without brake unchanged unless the phase is about that:
0. Mechanic follow-up (read-only): is the coasting spin unrealistic,
   understeer gradient of our model vs real tyre sizes, a cheap
   established way to model front / rear tyre differences, tested in
   its toggled Car.
1. Outer-rear brake moment: the ACTUAL rear braking force (locked →
   slideGrip × rear grip), outer side from the lateral force's sign.
   Proof: test cases + sweep, events #10 / #4 replay, 270cc without
   brake identical (Centralen / Racingkart have lift-off / regen
   through the rear → show the change), `npm run laptimes` dry run (no
   --yes) for expected lap time shifts.
   **Done (uncommitted, 2026-11-11):** `Car.slide` — `outerBrake =
   rearLocked ? 0 : min(rearBraking, rearGrip) × (1 − rearLift) ×
   track / 2`, moment −sign(frontSide + rear) × it (side force of the
   CURRENT substep, not the previous lateralG). Proof:
   - server tsc OK.
   - Test cases, 270cc: A clean (2°), C clean (4°), D 10° + caught,
     B / B2 / E spin (allowed / locked). Still off: S sweeper (0.1 ×
     lock, 15°) 35° mild; F standstill (phase 3). Centralen: S clean
     too. Racingkart: A, S, C still spin → phase 2.
   - Sweep 270cc 30 km/h: everything clean (≤ 7°); 75 km/h: clean from
     0.2 × lock except 0.1 × lock + 10–20° (51°, 63°) and 0.9 × lock +
     20–40° (73–78°) → phase 2.
   - Replay with the recorded inputs: #10 72° → 9°, 297 → 90 °/s; #4
     (locked) still spins 72°; #6 doesn't spin on either.
   - Without brake: 270cc IDENTICAL (1020 ticks); Centralen (regen) and
     Racingkart (lift-off) differ — calmer (Centralen worst 46° → 9°).
   - `npm run laptimes` dry run: 32 values change (mostly faster,
     Torslanda GP 270cc 124.5 → 118.6; Lycksele 270cc 95.7 → 97); the
     old code gives 0 changes → all from this fix. Nothing written.
   Robin: **no commit until ALL the test cases above pass** (270cc
   against the target table; Centralen / Racingkart no worse).
2. Coasting instability. Robin (2026-11-11): **look for physics first**,
   no calibrated muF unless nothing physical explains it. Mechanic
   (read-only) tests per candidate, physical parameters only: lift from
   the real side force (+ longitudinal transfer), caster jacking / LLTD,
   Ackermann, front camber, tyre width via Fz0 in load sensitivity /
   Pacejka Kya, relaxation length, others. My check: per-wheel load
   sensitivity across the axle → front ~1 %, lifted rear −10 % (wrong
   way; not modelled today).

   **Mechanic's result (2026-11-11, not yet verified by me;** toggles in
   scratchpad `mechanic/Car.ts`, suite `mechanic/compact.ts`, phase 1 as
   its default):
   - Root cause: `liftG` 0.75 lifts the inner rear ~3× too early. Roll
     alone lifts it only at ~2.2 g (660 N inner-rear load × 1.11 m ÷
     (0.585 × 230 kg × 0.25 m × 9.81); own number). Real karts lift it by
     caster / kingpin jacking — steering-angle driven → slow big-lock
     corners, not fast sweepers. Sources: real.mtak.hu/209612/1/article-p66.pdf
     (frame stiffness, FE + ADAMS), copper-pike-6n4z.squarespace.com/chassis-cornering-dynamics,
     SAE 2023-01-5135.
   - Candidates (counts = spins > 45°; coast /10, brk75 /35, brk30 /35):
     phase-1 baseline 270cc coast 6, brk75 14, brk30 5, ev 89 / 277 °/s,
     st30 0.78 g / collapse / 0.49 g; Racingkart coast 7, brk75 22.
     a. lift from real lateralG (+ rear load): no effect alone.
     b1. **physLift** (ΔFz = side force × h / track, rear share static,
         lift = 1 − rear transfer ÷ (rear load / 2); front track 1.05 m
         estimate): coast 0 all karts, brk30 3, #4 175, st30 0.60 /
         0.80 / 0.58 g (pushes in slow corners).
     b2. jacking (diagonal, sin|δ| / sin δ_full, full lift at full lock
         assumed): spins come back (270cc coast 1, Racingkart 6–7) —
         needs caster / kingpin / frame stiffness → unknown.
     b3. per-wheel load sensitivity: wrong way, worse with jacking.
     c. Ackermann 100 %: irrelevant at speed (0.1–0.5°), #10 89 → 79,
        slow corners 270cc st30 73°: 0.49 → 0.81 g.
     d. camber from caster: 0.4–1.7°, negligible. e. tyre width via Fz0
        / Kya: ~1 %, negligible. f. relaxation length: 5–20 ms, only the
        low-speed fault.
     g. **spool**: rigid-axle moment ∝ Fz_in·Fz_out (factor 1 − u²), not
        linear rearLift; alone brk75 11.
   - Best, no fitted values: **physLift + spool** — coast 0, brk75 13
     (all at ≥ 0.74 × lock + wheel ≥ 20° or locked = allowed), brk30 3
     (locked + wheel ≥ 20°, as expected), #10 12° / 84 °/s, st30 0.56 /
     0.71 / 0.51 g.
   - Fails: case A (75 km/h, 0.9 × lock, wheel 5°) → 80° spin — mechanic:
     1.8° front at 75 km/h asks 1.3 g > 1.15 g grip ("row impossible").
     My view: over the grip it should PLOUGH, not spin; phase 1 alone
     passes A (2°) → physLift makes A worse — to investigate. Steady
     30 km/h grip −15–30 % (no jacking → inner rear never lifts in
     hairpins) — Ackermann may give it back.
   - Only unknown: the jacking angle (front wheel angle where the inner
     rear leaves the ground) — Robin could observe it on a real 270cc.

   **Case A traced (mechanic):** at 0.9 × lock the brake takes ~89 % of
   the rear grip → 46 % side grip AND stiffness → K ≈ −0.053 rad/g →
   critical speed ≈ 50 km/h (Gillespie ch. 3, 6; Milliken ch. 5).
   Front saturates first but the rear can't answer (front ~856 N·m vs
   rear ~250). Phase 1 passed A only through the too-early lift. 5° wheel
   at 75 km/h asks 1.3 g. I withdrew "it should plough". Decision for
   Robin: A1 test at wheel 2° + measure the limit angle, or A2 keep 5° and
   find evidence (inner rear unloaded at small steer at speed).

   **Driver's 16 realistic scenarios** (scratchpad `driver/drive.ts`,
   `hairpin-sweep.ts`, `steadyg.ts`; `--mechanic <folder>` for the
   combined copy). Bug found in MY spintest D: countersteer sign was
   wrong (−sign(slip) steers into the slide) — fixed, D still passes.

   | 270cc | phase 1 | combined (physLift + spool + Ackermann) |
   |---|---|---|
   | S1 sweeper / S3 lift / C3 #10 / M3 too much lock | pass | pass |
   | S2 too much lock at 65 | spin 80° | pass, pushes |
   | H1–H4 hairpins (straight brake, trail brake, drag ± gas) | spin 56–64° | pass 2–4° |
   | C1 locked stab + catch | 78°, no recovery | 11°, caught 0.32 s |
   | M1 late 0.9 × lock + 10° at 60 | 3° | 51° slow slide (allowed) |
   | M2 / M4 locked while turning | spin | spin (yaw 280 → ~150 °/s) |
   | L2 straight lockup, wheel 1° off | 85° | 86° (open) |

   Hairpin grid 270cc no brake 20–40 km/h × wheel 20–50°: phase 1 spins
   54–76° at 30–40 km/h ≥ 30°; combined all ≤ 7°. Centralen: all pass.
   Racingkart: hairpins pass, C1 still 51° / 0.75 s.
   **Got worse — too dull:** steady grip 0.71 g at 30 km/h, 0.89 at 45,
   1.00 at 65 (gripG 1.15); no hairpin pivot (H3 / H4 plain push, Robin's
   table wants scrub / mild oversteer); spins rotate ~half as fast. Lever:
   jacking (inner rear lift from steering), not more stability.

   **Robin's decisions (2026-11-11):**
   - Jacking angle: ESTIMATE it and tune against the tests (no
     measurement) — marked "estimated, tuned against the tests" in the
     code; check plausibility against kart geometry. Mechanic sweeps
     δ_lift, all tests per value.
   - Case A → A1: steering wheel 2° at 75 km/h, 0.9 × lock → clean; plus
     "A-limit" (largest wheel angle < 15° at 0.9 × lock, reported only).
   - L2 (straight lockup, wheel 1° off): IS a test — must stay roughly
     straight, max body slip < ~20°.
   - **Targets are approximate** ("roughly at the verifications, not dead
     on"): a result near a target counts as a pass ("≈ pass").

   **Jacking sweep (mechanic):** jacking = inner-rear static load / 2 ×
   k × sin|δ| / sin 32°, diagonal path (outer front + inner rear unload,
   inner front + outer rear load), summed with roll transfer, capped at
   the inner-rear load. 270cc: k 0 / 0.5 / 0.6 / 0.7 / 1.0 → C1 11 / 26
   ≈ / 35 / 39 / 59°; steady 30 km/h 0.71 / 0.86 ≈ / 0.91 / 0.94 /
   0.82 g; H3 / H4 push (3–4°) up to 0.8, then 16–60° (no mild window);
   coasting spins 0 up to 0.9; M2 / M4 151–186 / 143–282 °/s. A (2°)
   and L2 fail at EVERY k: L2 — a locked rear has ~4 % of a rolling
   tyre's side-force slope, no yaw damping (Gillespie ch. 3; ECE R13
   front-first lock); A — 0.9 × lock leaves 46 % rear stiffness →
   critical speed ~50 km/h. Racingkart clean only at k ≤ 0.2 (more roll
   lift with 1.6 g); hairpins spin from 0.3 (phase 1 too).

   **Robin agreed (2026-11-11):** A and L2 → "spin allowed" (physics,
   Gillespie ch. 3; braking EXACTLY straight must stay clean — H1);
   H3 / H4 → "push or mild rotation, no spin"; jacking k = 0.5 rental
   karts, own lower value for the Racingkart, "estimated, tuned against
   the tests". Implement physLift + spool + Ackermann + jacking in the
   repo, run ALL tests myself, commit only when they pass.

   **Ported (uncommitted, 2026-11-11):** Car.slide — lift from roll
   (lateralG × h / mean track, rear static share) + jacking (k × inner
   static load × sin|δ| / sin wheelLock), spool (1 − u²), Ackermann
   (100 %, frontTrackMeters), front scrub = Σ wheels; SlipValues: liftG
   → frontTrackMeters (1.05 estimate) + jacking (270cc / Centralen 0.5,
   Racingkart 0 — swept 0–0.4: 0.1 trail braking 16°, 0.2+ hairpins
   spin). Port = mechanic's copy exactly (driver scenarios, 270cc +
   Centralen, 32 rows identical).

   **All tests on the port:**
   - spintest (A at 2°, A / E spin allowed): all pass except F
     Racingkart standstill (gripRear 0.70 — phase 3). Centralen A clean.
   - driver 16: all pass except C1 (270cc 26°, caught 0.72 s ≈ — target
     < 30°, < 0.5 s; Racingkart 51° FAIL) and L2 (now allowed).
   - coasting / gas, 30–75 km/h, wheel 5–20°: all clean; Racingkart 75
     km/h gas 0 + 5–10° → 22–23° mild (phase 1: spun).
   - braking sweep 270cc: 30 km/h all ≤ 8°; 75 km/h clean to 0.6 × lock,
     0.7–0.9 × lock + steering → mild / spin (allowed: top-speed brake
     only straight).
   - events: #10 8° / 80 °/s; #4 29° / 178 °/s (short locked stab, then
     0.4 — doesn't fully spin any more; M2 / M4 held lock still spin);
     #6 6°.
   - steady 270cc 30 km/h: 0.86 g max (≈ 0.9).
   Still failing: C1 (270cc ≈, Racingkart), F Racingkart → phase 3 (low
   speed) next, then everything again.

3. **Low speed (done, uncommitted, 2026-11-11):** slide blends into the
   kinematic model (rear axle rolls without slip: r = v·tanδ / L, vy =
   r·b) between KINEMATIC_BELOW 1 and SLIP_ABOVE 3 m/s, per substep
   (Kabzan et al. 2019). Runner: scratchpad `runall.sh` (all tests).
   - F: all 3 karts stand still (gripRear 0, yaw 0). Spins now end at
     ~0° as the kart stops (no slip pinned at 90°).
   - Everything else unchanged by it (C1 too — it's at 35 → 23 km/h).
   - vs main (before any fix), driver scenarios failing: 270cc 9 → C1 ≈
     (26°, caught 0.72 s; main 78°, 1.28 s) + L2 (allowed); Centralen 5
     → L2; Racingkart 9 → C1 (51°, main 79° → no worse) + L2.
   - `npm run laptimes` dry run on the real engine: 41 values change
     (270cc faster everywhere, Torslanda GP 124.5 → 115.8; Centralen /
     Racingkart mixed, e.g. Centralen Lulea 73.6 → 77.4). Nothing written.

## Review (2026-11-11)

Robin: C1 (270cc 26°, caught 0.72 s vs < 30° / < 0.5 s) within the
margin → commit. Final run (`runall.sh`, server + app tsc OK): spintest
all as expected (A / E spin allowed, F all karts stand still); driver 16:
only C1 (270cc ≈, Racingkart 51° — main 79°, no worse) and L2 (allowed);
coasting / gas clean (Racingkart 75 km/h gas 0: 22° mild); braking 30
km/h ≤ 8°; events #10 8°, #4 29°, #6 6°. Docs: agent-protocol braking
advice (numbers from the sweeps), README (jacking, no more "20 %
steering" claim — the tightest line moved, ~30 % on Centralen /
Racingkart), .personal physics.

Not done (each asks Robin first): merge to main; `npm run laptimes --
--yes` (41 values); deploy (Docker images); re-check the live lobby.
Open: H3 / H4 "pivot" (no mild window in the model); a measured jacking
angle would replace the tuned `jacking`.
3. Low speed / standstill (cause 4).
4. Pedal feel (brakeDeceleration) only if still needed.
