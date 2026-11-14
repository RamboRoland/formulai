# rearShare: research (2026-11-14)

`rearShare` = distance from the CoG to the rear axle ÷ wheelbase = the FRONT static
weight share (`Car.ts:31`, `rearAxle.ts:74` uses `1 − rearShare` for the rear).
Today: Centralen 0.42, 270cc 0.415, Racingkart 0.43 (all estimates "E" in kart-values.md).
Sensitivity (sensitivity-*.md): ±10 % moves stopping distance 6.5–8 % and the lock
point 7–9 %. Higher rearShare means less rear load, so the rear-only brakes stop less.

Confidence: **measured** = scale reading, **model** = a value in a paper's or code's model,
**target** = setup advice (a goal, not a measurement), **E** = my estimate.

## Recommendation

| Kart | Now | Recommended | Range | Confidence |
|---|---|---|---|---|
| Racingkart125cc (Rotax Senior, 162 kg) | 0.43 | **0.42** | 0.39–0.44 | medium (two measured forum karts, one paper model, many targets) |
| HyrkartCentralen (Sodi RSX2, 186 + 80 kg) | 0.42 | **0.42 (keep)** | 0.40–0.44 | low: no rental data, an estimate between the bounds |
| Hyrkart270cc (Caroli Hammerhead, 150 + 80 kg) | 0.415 | **0.415 (keep)** | 0.39–0.44 | low: no rental data |

At the sensitivity's slope (about 0.75 % stopping distance per 1 % of rearShare), Racingkart
0.43 → 0.42 (−2.3 %) makes the stop about 1.5–2 % shorter and the lock pedal about 2 % higher. This
is a linear guess from the ±10 % runs. It has not been run.

## Sources (NEW = not in the earlier task notes)

### Racing karts: measured on scales
1. **NEW, measured, Rotax Senior.** KartPulse "Weight balance and grip balance", andrew090990,
   9 Jul 2025, "Rotax Senior engine, 365 lbs class weight", 2024 Tony Kart: "I scaled the kart and it
   was at 39:61". With the seat moved: "Scaled at 41:59". In the same thread ApexGRT (Rob Gore):
   "Typically that is going to put you somewhere between 58 and 60% rear weight".
   https://forums.kartpulse.com/t/weight-balance-and-grip-balance/14432. Forum, one kart, medium.
2. **NEW, measured, X30 (not Rotax).** KartPulse "Tony Kart Weight Bias / Understeer", Kenny,
   2017 Tony 401S, driver 5'11": seat 640 mm "Front - 39.6%" / "Rear - 60.4%". Seat 610 mm with the
   battery moved forward: "Front - 41.9%" / "Rear - 58.1%". Final: "I moved my seat forward until
   i had 42/58", and 43/57 made the rear "too loose under brakes". Brake type not stated.
   https://forums.kartpulse.com/t/tony-kart-weight-bias-understeer/869. Forum, medium-low.
3. **NEW, measured, dirt oval (wrong discipline, context only).** 4cycle "first time on the scales": LF 61.5 /
   RF 69.0 / LR 102.0 / RR 63.5 lb, "Front weight 44% (target is 45%)", 4-stroke flathead.
   https://4cycle.com/karting/threads/first-time-on-the-scales.22410/. Low relevance.

### Racing karts: setup targets (goals, not physics values)
4. **NEW.** KartPulse "OTK handling question - front/rear weight" (Dec 2022): "41-43% on the front"
   (the OTK recommendation, from the thread's first post), "Baseline setup for an OTK in a TaG class gives 43% front weight"
   (C. Kaneb), "Start in the 41-43 range" (TJ Koyen), "43 is a great starting point".
   https://forums.kartpulse.com/t/otk-handling-question-front-rear-weight/9957
5. **NEW.** KartPulse "Kart scaling" (May 2024): TJ Koyen "41-44% front weight. 41 if you're taller,
   44 if you're shorter". B. Ingebrigtsen "43/57% ballpark". https://forums.kartpulse.com/t/kart-scaling/12335
6. **NEW.** KartPulse "Distributing weight" (2022): "front wants to be around 43%", "Aim for 41-43%
   front weight". https://forums.kartpulse.com/t/distributing-weight/8964
7. **NEW.** Woodbridge Kart Club: "43% Front Weight", "57% Rear Weight", "just recommended starting
   points". https://www.woodbridgekartclub.com/how-to/kart-scaling-weight-distribution/.
   D. Kalb "Kart Weight Distribution" (2019 PDF): Front 43 %, Rear 57 %, Cross 49.50 %.
   https://img1.wsimg.com/blobby/go/8f2038a1-36e5-48a3-9a1f-897b545a96e2/downloads/Kart%20Weight%20Distribution.pdf
8. **NEW.** kartbalance.com guide: "approximately 43% front and 57% rear" for "most sprint karts with a
   driver seated". No source given. https://kartbalance.com/guide/
9. Already in the notes: tyre-slip-steering.md has "43/57 (forums)", and Rotax "42–44 / 56–58" (medium).

Reading: the targets cluster at 41–44 % front, with 43 % the default. The two karts actually scaled
read 39–42 % before tuning. One driver with 43/57 found the rear "too loose under brakes" and went back to 42/58.

### Papers and models
10. **Already in the notes, now worked out.** fastest-lap `roberto-lot-kart-2016.xml` (commit 0660208), said to come from
    Lot & Dal Bianco 2016: `<com>0.0 0.0 -0.25</com>`, `<front_axle>0.645 0.0 0.111</front_axle>`,
    `<rear_axle>-0.4 0.0 0.111</rear_axle>`, mass 165 kg. Wheelbase 1.045 m, CoG 0.40 m ahead of
    the rear axle, so **rearShare 0.383** (38.3 / 61.7). The paper itself is closed: eprints.soton.ac.uk/385883
    PDFs return 401, and Dal Bianco's PhD thesis (research.unipd.it) returns 403. **Not checked against the paper.**
    **NEW:** the same repo's `rental-kart.xml` uses the SAME geometry (0.645 / −0.4) with mass 300 kg and
    6.6 kW. It is a copy of the racing kart with more mass, not independent rental data.
    https://github.com/juanmanzanero/fastest-lap/tree/0660208/database/vehicles/kart
11. **NEW, the longitudinal position (earlier notes only took hCG).** Mihalić et al. 2023 (preprint
    rs-1852791, read): driver xCG,d = 0.434 m and vehicle xCG,v = 0.56 m, measured from the rear axle.
    Masses 80 + 50 kg. Combined "L = 1,103 m, hCG = 0,32 m, LCG = 0,62 m" (from the front wheels), so CoG → rear
    0.483 m and **rearShare 0.437**. This is computed (body-segment tables + CAD) for a light self-built
    e-kart, not measured. https://www.researchsquare.com/article/rs-1852791/v1.pdf. Model, medium-low.
12. **NEW.** Mikler, Camacho, Bradley, Gonzalez-Mancera, ASME IDETC2019-98112 (multibody e-kart,
    70 kg pilot, wheelbase 1040 mm, "dimensions and weights were measured" as the baseline). Table 5, row
    "Front Axle to CoG [%]": Petrol **46 %**, Electric V1 47 %, V2 **43 %**, V3 49 %, V4 43 %.
    The label reads like a distance, but the row is the FRONT LOAD share. I checked this by hand:
    Ktheory = Wf/Cα1 − Wr/Cα2 = 0.46·1307.8/47.3 − 0.54·1307.8/200 = 9.19 deg/g, which is the
    table's 9.19. V1 and V2 also match (10.17, 8.71). Petrol 1307.8 N = 133 kg total, light.
    https://radar.brookes.ac.uk/radar/file/3d8f925a-d74b-4a82-9d13-645f1710b192/1/IDETC2019-98112.pdf.
    Model, medium-low. A rental-like battery placement moves it by ±3 points.
13. Weak, NOT used: IJESI vol 7 i5 "Design and Analysis of Go Kart Chassis" (child's kart, 125cc
    8.6 bhp) "37:63", seen only in a search snippet (the PDF text did not extract), design stage.
    IJRTI 2025 "about 40% front" (snippet, no derivation).

### Rental karts (Sodi RSX2, Caroli Hammerhead)
**No data.** I searched Sodi, Caroli, Birel ART rental electric and BSR. They publish total weights only
(e.g. Birel rental electric 145 kg incl. 12.5 kg battery), with no axle split. The earlier notes also found none
(tyre-slip-steering.md, braking-strength.md). The only way to get it is a scale at the venue,
or asking Sodi / Caroli Motor.

Bounds for the Centralen (E, my arithmetic, not a source): driver 80 kg at ≈ 0.43 m ahead of the
rear axle (Mihalić's driver xCG; Sodi wheelbase 1.04, so 0.41 L). The kart is 186 kg. If the kart's own
CoG sits at 0.38–0.46 L (motor + axle behind, battery in the floor between the axles), rearShare =
(80·0.41 + 186·x)/266 = **0.39–0.45**. Battery-forward variants in source 12 reached 43 %.
0.42 stays mid-range. The 270cc's engine (GX270 ~25 kg) sits beside the rear axle, which pulls the CoG
rearward. Source 12's petrol model reads 46 %, but that is a light racing chassis. 0.415 is unsupported either way.

## What remains an estimate
- Every value for the two rental karts: no published or measured split exists.
- Racingkart: 0.42 is well bracketed (measured 39–42 %, targets 41–44 %, Lot model 38.3 %), but the
  driver's size changes it ±2 points (TJ Koyen: 41 tall, 44 short).
- Forum scale readings can be off. One poster's two scales differed by "almost 8%" front to rear (search
  snippet, kartpulse "OTK handling question" page 2, not read in full).
