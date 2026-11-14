# gripG research (peak tyre μ, μx = μy, front + rear) — 2026-11-14

Today's values: HyrkartCentralen 1.15, Hyrkart270cc 1.15, Racingkart125cc 1.6.
gripG is the TYRE peak μ. A kart's sustained lateral g is lower: load sensitivity
(outer tyre over-loaded) and the inner rear lifting. In our model, gripG 1.15 gives
1.10 g at most (rental, braking-strength.md 1g). So the ratio is ~0.96 for rental
karts. The Racingkart's ratio was NOT measured (it is probably lower:
loadSensitivity −0.15). Logger lateral g therefore sets a FLOOR on μ, not μ itself.

Confidence labels: **measured** (instrumented test), **identified** (model fitted
to driving data), **paper**, **forum**, **vendor**, **estimate**. GPS-derived
g (AiM "GPS_LatAcc") is smoothed (peaks lower). Accelerometer / IMU g is noisy
and can carry offsets (a steering-wheel logger in particular).

## What is NEW vs kart-values.md / tyre-slip-steering.md / braking-strength.md

Earlier work had: the 1.0–1.3 g rental estimate, "Rotax ~1.5–1.7 g sustained (100cc proxy,
GPS)", fastest-lap pDx1 0.9 / pDy1 1.5 (Lot kart) and rental-kart.xml rear 1.25 /
front 1.30, Robin's 270cc table (0.9–1.1 g outdoor, 1.1–1.3 indoor, source
unknown), braking logs (0.8–1.0 g rear only).
New here:
1. **A rental kart with identified tyre μ**: ETH Zurich IDSC autonomous gokart =
   RiMO SiNUS iON electric rental kart on Dunlop SL1 (hard). Pacejka D (μ) =
   0.96 front / 1.06 rear; later fits 0.96 / 0.97. This is the first real number for a rental kart.
2. **Same kart, IMU-measured**: lateral peaks ±1 g (Picotti et al. 2023).
3. The exact source behind "100cc ~1.55 g" (AiM / TKart 2007 test), with quotes.
4. Forum numbers for racing karts on HARD tyres (Gunderson, "G_sum 1.5
   sustained … near the limit on ultra hard tyres") and on LeCont (1.8–1.98 g
   peaks).
5. A back-calculation from the measured rear-only braking (below). It says the
   Rotax μx is ≥ ~1.6, not the 0.9 in the fastest-lap file.
Still NOT obtained: Lot & Dal Bianco 2016 full text, also the Dal Bianco PhD thesis
(Padova research.unipd.it: Cloudflare / 403; Southampton eprint: bot wall;
OpenAlex says closed access). Mihalić 2023 (mdpi.com 403).

## Sources

### Rental karts (hard tyres)

| # | Source | Says (exact) | Kind | Conf. |
|---|---|---|---|---|
| R1 | ETH IDSC `retina` code, `src/main/java/ch/ethz/idsc/gokart/calib/RimoSinusIonModel.java` (github.com/idsc-frazzoli/retina, master 12f88c8, 2020-03-16) | Kart: "RiMO SiNUS iON", "186 kg", "Tires: DUNLOP SL1" (front 4.5" rim / Ø255 mm, rear 8.0" rim / Ø280 mm). "coefficients for Pacejka's magic formula taken from thesis report by MH, Section 5.1, p. 57": `PACEJKA_FRONT = (B 15.0, C 1.1, D 0.96)`, `PACEJKA__REAR = (B 5.2, C 1.4, D 1.06)`. `PacejkaMagic.java`: F/Fz = D·sin(C·atan(B·slip)), so D = peak μ. MH = Marc Heim (master thesis, README) | identified (thesis not read; method not seen: likely driving data) | medium |
| R2 | same repo, `src_MATLAB/MPCGokart/scripts/initialize_parameters.m` | `params.B1 = 13.8509; params.C1 = 1.367; params.D1 = 0.9622;` `params.B2 = 14.1663; params.C2 = 1.3652; params.D2 = 0.9744;` (front / rear). Elsewhere in the repo: D in m/s², `D1 = 10; % gravity acceleration considered` (≈ 1.02 g), `testSysIDData.m` `D1 = 9.21` (0.94 g); the MPC's tuned limit `pacejkaFD 7.8 / pacejkaRD 7.3` ("controls maximum grip limit", m/s² = 0.80 / 0.74 g, a controller margin, not μ) | identified / tuned | medium |
| R3 | Picotti, Mion, …, Frazzoli, Beghi, Bruschetta 2023, "A Learning-based NMPC for a Real Go-Kart…", arXiv 2305.17949 | "the go-kart is based on a RiMO SiNUS iON electric rear wheel-driven go-kart platform … equipped with … IMU". On track: "peaks of ±1g for lateral and [+0.2, −0.6]g for longitudinal"; sideslip up to 15° (near the limit). Its nominal model has "an identified Pacejka's magic formula" (details in E. Mion PhD, Padova 2021, not read) | measured (IMU, autonomous driving, kart carries computer + sensors) | medium |
| R4 | D&M Motorsport (Dunlop distributor), via search | Dunlop SL1 7.1" rear: "ideal karting tire for leisure or rental. Designed with a hard rubber". Dunlop's 2017 catalogue lists SL1 under "SL type", not the "rental kart" group | vendor | low–medium |
| R5 | fastest-lap `rental-kart.xml` (known, braking-strength.md) | rear pDy1 1.25, front 1.30, no source | unsourced model file | low |
| R6 | Robin's table (braking-strength.md 1g, source unknown) | 270cc outdoor lateral 0.9–1.1 g, indoor 1.1–1.3 | unknown | low |
| R7 | gokart36.com "G Force in Go-Karts" (via search snippet) | rental karts "roughly 0.4–0.8G", arrive-and-drive 4-stroke "1–1.5G"; no method | blog | very low (ignore) |

Caveats on R1–R3. The RiMO is electric and heavy like the Sodi RSX2. It has
brakes front and rear (the code has front and rear brake constants), so the
−0.6 g braking does NOT compare to our rear-only karts. Its tyres are Dunlop SL1,
not the Centralen's / Caroli's own. The test surface is not stated.
Wheelbase 1.19 m (`testSysIDData.m` `l = 1.19`).

### Racing karts

| # | Source | Says (exact) | Kind | Conf. |
|---|---|---|---|---|
| K1 | AiM / TKart, "On-track sessions: a winning tool", 2007-11-08, Cervia; VanSpeed Omega ICA 100, Maxter MX-L 100cc, MyChron4 + GPS (aim-sportline.com/download/doc/eng/on-track_sessions/gps_test_comparativo_morbidovizioso_eng.pdf) | "The measure supplied is calculated using the GPS line … the kart uses maximum lateral grip at each corner, around 1,55 g." Corner labels 1.0–1.55 g; braking "around 0,8 g" (also GPS). Tyres not stated. 100cc ICA = rear brake only (that era) | measured, GPS-smoothed | medium |
| K2 | KartPulse "GPS_LaAcc Profile in Corners", Eric Gunderson, 2017-11-17 (forums.kartpulse.com/t/1341) | "a G_sum of 1.5 through the corners sustained is great and near the limit" on ultra-hard tyres; shifter at Calspeed "pegging near the 3.0 g mark" | forum (experienced data coach) | medium–low |
| K3 | KartPulse "G-sum math channel…", Dom Callan, 2019-05 (forums.kartpulse.com/t/3984) | "my peaks are around 1.8g", "peak overall at 1.98 g's … very fast downhill sweeper"; LeCont Whites / X30; channel not stated | forum | low |
| K4 | KartPulse "Improving grip…", JR_Garcia, 2023-09-07 (forums.kartpulse.com/t/11141) | Senior 4-stroke, 183 kg: "average of GPS_LatAcc in the turns to the right is 2.1g", left 1.8 g (and 2.0 / 1.9 reversed direction) | forum; "average" unclear (of peaks?), high for a 4-stroke | low |
| K5 | f1technical "why do karts pull so many lateral g's?" (viewtopic t=16726, both pages) | Ogami musashi: "spike g's that averaged … 1,6-2g's", "sustained 2g's is rare..but possible (on very soft compounds)", "transient … up to 2,5G's". Tim.Wright: "I don't belive that a sustained 2g is possible"; found a 0.5 g offset in the video's accelerometer trace | forum | low |
| K6 | fastest-lap `roberto-lot-kart-2016.xml` (known) | rear pDy1 1.5 (μy), pDx1 0.9 (μx); only reference Lot & Dal Bianco 2016 (unread) | model file | low–medium |
| K7 | Vroomkart "hand brake yes or no" (known, braking-strength.md) | Vortex DVS rear-only braking 1.0 g, front + rear 1.2 g | measured (sensor unclear) | medium–low |
| K8 | Harris Race Radios "Accelerometer & G-Force Guide" (via search) | karts: cornering 1.5–2.2 G, braking 0.8–1.2 G | vendor | low |

Checked, no μ inside: Horváth & Zelei 2024 (Pollack Periodica, real.mtak.hu
209612, ADAMS PAC89, no values printed); Mikler et al. IDETC2019-98112
(Oxford Brookes, "Go-Kart tires are difficult to come by", Adams default MF
adapted, no values). Mirone 2003 / 2010: paywalled.

### Back-calculation: μx from rear-only braking (mine, Racingkart; estimate)
With rear brakes only, the braking limit is a = μ·g·share / (1 + μ·h/L)
(Beckman; the same formula as `rearBrakeLimit`). Our values: share 0.57, h 0.29,
L 1.04. Air drag at 100 km/h is 0.13 g (CdA 0.45, 162 kg), so the tyres must give the rest.
- Measured total 0.8 g (K1, kartpulse 8248), so the tyres give ~0.67 g. That needs μx ≈ 1.75.
- 1.0 g (K7) gives μx > 2.
- μx 0.9 (K6) would give only 0.40 g + drag. That cannot match any braking measurement.
So the braking data supports μx ≈ μy ≈ 1.6–1.8. This hangs on share and h
(both estimates) and on GPS-smoothed braking. Rental: no rear-only braking data.

## Recommendation

| Kart | Now | Recommended | Range | Confidence |
|---|---|---|---|---|
| HyrkartCentralen | 1.15 | **1.05–1.10** (or keep 1.15, see below) | 0.95–1.25 | low–medium |
| Hyrkart270cc | 1.15 | **1.05** | 0.95–1.20 | low–medium |
| Racingkart125cc | 1.6 | **1.6** (keep; 1.65 also defensible) | 1.5–1.8 | medium–low |

Reasoning:
- Rental: the only identified kart tyre μ (R1/R2: 0.96–1.06) and the only IMU number
  (R3: ±1 g peaks) both point to ~1.0 g on hard tyres. Today's 1.15
  gives 1.10 g sustained, ~10 % above them. With 1.05 the model gives ≈ 1.0 g
  (scaling 1.10 × 1.05/1.15; NOT run). Robin's table (R6, outdoor
  0.9–1.1 g) fits 1.0–1.05 for the outdoor 270cc. If Gokartcentralen is indoor
  and his "indoor 1.1–1.3 g" holds, the Centralen could keep 1.15. I don't know
  whether Gokartcentralen is indoor; Robin knows. The RiMO is not the same kart or tyre, and
  the fastest-lap rental file (1.25 / 1.30) points the other way. So this is
  a "slightly lower" lean, not a firm number.
- Racingkart: sustained GPS lateral 1.5–1.55 g (K1, K2) on hard-ish tyres. With
  the model's ratio < 1, that needs a peak μ ~1.6–1.7. Higher forum peaks (K3–K5,
  1.8–2 g) are spikes, softer compounds or unclear channels. The braking back-calculation
  agrees with ~1.6–1.8 both ways. The D5 is a durable prime, so not the top of
  the range. 1.6 stands. The model's own max lateral g for the Racingkart was not
  measured here. Check it before a change (target ≈ 1.5 g sustained).

## Still estimates / open
- No kart tyre test-rig data (Mojo, Vega, LeCont, Bridgestone, Dunlop) found
  publicly. Tyre makers publish no μ.
- μx = μy: kept. The only split value (pDx1 0.9) disagrees with the braking data.
- No measurement of a Sodi RSX2 or a Caroli Hammerhead. Lot & Dal Bianco 2016,
  the Dal Bianco thesis, the Heim thesis and the Mion thesis would be the next reads. They are blocked
  online, so Robin could fetch the PDFs by hand.
- Better than any paper: a phone / AiM logger (accelerometer) on the actual
  rental karts at Gokartcentralen and Torslanda. Read steady-corner g, then
  μ ≈ g / ~0.96.
