# Research: rearTrackMeters (+ frontTrackMeters)

2026-11-14, research only (no code changed). Track = wheel centre to
wheel centre (≈ contact patch centres; camber / tyre bulge ignored).

Confidence words: **measured** (a maker's or an organiser's own figure),
**regulation**, **paper/model**, **forum**, **estimate**.

## What was known before (not redone)

- kart-values.md: rear 1.125 / 1.175 / 1.2, front 1.05 all, kind E.
- tyre-slip-steering.md Phase 0: Caroli 1.95 × 1.35 m, tyres 10x4.50-5 /
  11x7.10-5; "rear track 1.15–1.20 m, front 1.00–1.10 m" = estimates, not
  published. Centralen: rear 1.125 chosen. Racingkart: CIK width 1400 mm.
- braking-strength.md: fastest-lap roberto-lot-kart-2016.xml read for
  mass, axle positions, tyre — its track widths were NOT noted.

## NEW sources

| # | Source | Exact numbers | Kind |
|---|---|---|---|
| 1 | CIK-FIA Technical Regulations 2023, Art. 8.1.1 (Group 1), 9 (Group 2), 11 (Group 4) — https://www.fiakarting.com/sites/default/files/2023-01/6.0_RT2023.pdf | "Wheelbase: 101-107 cm. Track: at least 2/3 of the wheelbase used. ... Overall width: 140 cm maximum." Group 3 (Mini): wheelbase 95 cm, overall width 110 cm max. Rear wheel max width (Groups 1–2) 215 mm, front 135 mm. Front fairing "Minimum width: 1,000 mm. Maximum width: overall rear width of the front wheel/front axle unit." Rear protection "Width: minimum 1,340 mm, maximum that of the overall rear width". No definition of how "track" is measured. | regulation |
| 2 | Rotax RMC Asia Festival 2022, Technical Regulations Senior Max — https://www.eikoms.com/Info/2022/RMCAF_2022_TR_Senior3.0.pdf | "Rear width Maximum 140cm / measured to the outside of the rim." Rims dry "Maximum 135/215mm / measured to the outside of the rim". Tyres MOJO D5, "Front: 4.5x10x5 Rear: 7.1x11x5". | regulation (one Rotax event; the 140 cm rule is the standard Rotax one, other events not checked) |
| 3 | fastest-lap, database/vehicles/kart/roberto-lot-kart-2016.xml, commit 0660208 (model of Lot & Dal Bianco 2016, eprints.soton.ac.uk/385883) — https://github.com/juanmanzanero/fastest-lap | front-axle `<track units="m">1.055</track>`, rear-axle `<track units="m">1.2</track>`. Code src/core/chassis/axle_car_6dof.hpp:30 `_y_tire = {-0.5*_track, 0.5*_track}` → it IS centre to centre. rental-kart.xml in the same folder: same 1.055 / 1.2 (only mass, power, pDy1 changed) → not independent. | paper/model (fitted / measured / guessed unknown; the paper itself still 403) |
| 4 | Daytona DMAX rental fleet (chassis custom-built by Birel) — https://daytonamax.co.uk/technical | "Pitch mm. 1060", "Front track mm. 1060", "Rear track mm. 1380", "Total width mm. 1400", "Total length mm. 2000"; wheels "CH120 + DH180AL". Rear "track" 1380 vs total 1400 → clearly OUTSIDE width of the rear wheels, not centre to centre; front 1060 unclear which. | measured (maker's spec, rental) |
| 5 | Tony Kart Viper rental (Honda GX270, same engine as the Caroli) brochure — https://www.tonykart.com/download/brochure/Tony_Kart_VIPER_brochure_ENG_mid.pdf p.16 | "Length 1.985 mm", "Max width (rear) 1.367 mm", "Weight (Honda GX 270 cc) 160 kg". No track, no tyre size. | measured (maker) |
| 6 | Birel ART N35 rental (search-engine extract of Birel's rental brochures; the PDFs returned 404 / empty to me — NOT opened) | wheelbase 1070, "rear width 1410", "front width 1208", length 2036 mm; N32: wheelbase 980, rear width 1300, front width 1040. | measured but unverified (snippet only) |
| 7 | Sodi RSX2 product page — https://www.sodikart.com/en-gb/karts/rental/rsx2-43.html | "Length (L) = 1 865 mm", "Width (l) = 1 350 mm", 186 kg. No wheelbase / track; doesn't say whether width is bumper or wheels. (Already known.) | measured (maker) |
| 8 | Caroli Hammerhead — https://carolimotor.com/gokart/hammerhead | "Bredd: 1350mm", "Längd: 1950mm", 150 kg. No track. (Already known.) | measured (maker) |
| 9 | flowracers.com "How does rear track width affect..." — https://flowracers.com/blog/rear-track-width-affect-go-kart/ | rear track width is "measured from the outer edges of the tires"; "the maximum rear track width as per karting regulations is 1400 mm"; steps "10 mm at a time (5 mm on each wheel)". | forum/blog |
| 10 | KartPulse "Rear Track", TJ Koyen 2020-05-07 — https://forums.kartpulse.com/t/rear-track/5855 | "The baseline rear track width for most karts is around 1390mm - 1395mm." Measured with a straight edge on "the face of the wheel". | forum (experienced coach) |
| 11 | KartPulse "Rear width setup", 2022-11-07 (IPK, Rotax) — https://forums.kartpulse.com/t/rear-width-setup/9855 | "the rear track width maximum of 140cm"; "once by mistake it was 143 and was quicker"; "set it back to 140". | forum |
| 12 | KartPulse "Junior Track Width" 2023 — https://forums.kartpulse.com/t/junior-track-width/10526 | "Everything online says start at 1400mm then work in"; Briggs (Canada) "max rear track width is 1270mm"; "Most say to run at or within 10mm of max." | forum |
| 13 | Mikler et al., ASME IDETC2019-98112 (electric kart, Adams; "dimensions and weights were measured") — https://radar.brookes.ac.uk/radar/file/3d8f925a-d74b-4a82-9d13-645f1710b192/1/IDETC2019-98112.pdf | Table 1: wheelbase 1040, "Front tack [mm] 870", "Rear track [mm] 1000", 160 kg, CoG 150 mm; tyres 10x4.60-5 / 11x7.10-5. Narrow vs everything else; measured how (centre? inner?) not stated. | paper (outlier, low) |
| 14 | Motorsport UK NCR 2026 (search extract, not opened) — https://ebooks.motorsportuk.org/motorsport-uk-ncr-2026-edition-4/0952123001742394230/p672 | "Track – Minimum two-thirds of the wheelbase"; "Overall width – All classes unless specified in Class Regulations Maximum 1400mm". | regulation (unverified extract) |

Not found (searched): Sodi RSX2 or Caroli drawings with track; any OTK /
CRG / Birel / Kosmic official setup sheet with numbers (OTK guide only on
Scribd, Kosmic manual 403, tkart.it 403, Arrow manual bot-blocked); a
"CRG manual says 1400 mm for dry" claim exists only as a search snippet.
No typical FRONT track number for a Senior racing kart found anywhere.

## Conversion: outside width → centre to centre

centre-to-centre = outside width − one tyre (rim) width (half a tyre each
side). Kart tyres sit about flush with the rim, so for Rotax (rule 2:
measured to the outside of the rim) it is exactly outside − rim width.

Tyre / rim widths used:
- Racing rear 7.1x11x5 on dry rims ≤ 215 mm (rule 1, 2); OTK mag rear
  rim "212 mm" (search snippet only) → 0.20–0.215 m.
- Rental rear 11x7.10-5: nominal section 7.10 in = 0.180 m; DMAX rim
  "DH180" (180 mm?) → 0.18–0.21 m (rental rim width: no data).
- Front 10x4.50-5 / 4.5x10x5: 4.5 in = 0.114 m nominal, rim ≤ 135 mm →
  0.115–0.135 m.

### Racingkart125cc (Rotax Max Senior)
- Max: 1.400 − 0.215 = **1.185**; 1.400 − 0.200 = 1.200.
- Baseline 1.390–1.395 (source 10) − 0.212 = **1.178–1.183**.
- Narrowed for grip (typical steps 10 mm, a few steps: 1.36–1.38) − 0.212
  = 1.15–1.17.
- fastest-lap (source 3): 1.20 (centre, unknown origin).
- → **Recommend 1.18 m, range 1.15–1.20.** Today 1.20 = top of the range
  (only reachable with a ≤ 200 mm rim at 1400). Confidence: medium
  (regulation + forum baseline; rim width ±1 cm).

### Hyrkart270cc (Caroli Hammerhead) and HyrkartCentralen (Sodi RSX2)
- Both: overall width 1.350 (sources 7, 8). Whether that is the bumper
  or the rear wheels: NOT published.
- Rental makers that publish both: DMAX rear outside 1380 vs total 1400
  (bumper +10 mm each side, source 4); Viper "max width (rear)" 1367
  (source 5). So rental bumpers stand 0–10 mm per side outside the rear
  tyres (two karts, low).
- Rear outside width therefore 1.33–1.35 m; − 0.18…0.21 tyre/rim:
  - widest: 1.35 − 0.18 = **1.17**
  - narrowest: 1.33 − 0.21 = **1.12**
  - middle: 1.34 − 0.19 = **1.15**
- → **Recommend 1.15 m for both, range 1.12–1.17.** Today: Centralen
  1.125 (inside the range, low end), 270cc 1.175 (just ABOVE the range:
  only possible if the 1350 mm is the rear tyres' outside AND the tyre is
  ≤ 175 mm wide). Confidence: low–medium (maker overall widths are solid;
  bumper overhang and rim width are estimates from other brands).
- Caution: if the RSX2's side pods / rear bumper stand well outside the
  wheels (photos suggest a wraparound bumper; not measured), Centralen
  could be narrower than 1.12. Only a tape measure at Gokartcentralen /
  Torslanda settles it (rear wheel outside to outside + rim width).

### frontTrackMeters (all karts, secondary)
- fastest-lap: 1.055 centre to centre (source 3) — racing kart model.
- Birel N35 rental "front width 1208" (unverified, source 6) − 0.115–0.13
  = 1.08–1.09 (if it is the tyres' outside width).
- CIK: front fairing ≥ 1000 mm and ≤ the front wheel unit's width →
  front outside ≥ 1.00 → centre ≥ ~0.87 (lower bound only).
- IDETC2019 kart 0.870 (method unknown, outlier).
- DMAX "front track 1060" — outside or centre not stated.
- → **Recommend keep 1.05 m on all three, range 1.00–1.10.**
  Confidence: low (one model value, one unverified rental figure; no
  Sodi / Caroli / OTK number). Racing karts adjust it by ±~20–40 mm with
  hub spacers (forums, no exact figure found).

## Summary table

| Kart | rear today | rear recommended (range) | front today | front recommended (range) | Confidence |
|---|---|---|---|---|---|
| HyrkartCentralen | 1.125 | 1.15 (1.12–1.17) | 1.05 | 1.05 (1.00–1.10) | rear low–medium, front low |
| Hyrkart270cc | 1.175 | 1.15 (1.12–1.17) | 1.05 | 1.05 (1.00–1.10) | rear low–medium, front low |
| Racingkart125cc | 1.20 | 1.18 (1.15–1.20) | 1.05 | 1.05 (1.00–1.10) | rear medium, front low |

Remains an estimate: the rental rim width, whether the 1350 mm overall
width is bumper or wheels, every front track, and which point inside the
range a real setup uses (racing: track-dependent by design).

Expected effect (from the measured sensitivity, linear guess only, NOT
run): 270cc 1.175 → 1.15 (−2.1 %) ≈ +6 % trail-braking slip;
Racingkart 1.20 → 1.18 (−1.7 %) ≈ +9 %; Centralen 1.125 → 1.15
(+2.2 %) a little less slip. Needs a suite run before any change.
