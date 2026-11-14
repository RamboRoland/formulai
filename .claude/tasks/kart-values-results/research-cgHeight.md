# Research: cgHeightMeters (kart + driver CoG height above the ground)

2026-11-14, read-only research. The code isn't changed. Today: Centralen 0.23 /
270cc 0.25 / Racingkart 0.29 m. They were scaled from Mihalić with an ASSUMED
split (kart 0.15 m, driver 0.43 m), tyre-slip-steering.md "Values".
Sensitivity at ±10 %: stop 1.4–3.6 %. Racingkart trail-braking slip
+126 % / −50 %.

## Recommendation (Robin decides)

| Kart | Today | Recommended | Range | Confidence | Basis |
|---|---|---|---|---|---|
| Racingkart125cc (162 kg, L 1.04) | 0.29 | **0.25** | 0.25–0.30 | medium | fastest-lap's port of Lot & Dal Bianco 2016 racing kart: h = 0.25 m at 165 kg, L 1.045 m (an almost identical kart) |
| HyrkartCentralen (266 kg) | 0.23 | 0.23 (keep) **or** 0.21 | 0.20–0.25 | low (estimate) | no data; split scaling (below) |
| Hyrkart270cc (230 kg) | 0.25 | 0.25 (keep) **or** 0.22 | 0.21–0.26 | low (estimate) | no data; split scaling (below) |

- **Racingkart:** 0.29 is ABOVE the only kart value with a traceable model
  behind it. That model is 0.25 m at 165 kg, about the same mass, wheelbase
  and power. It is −14 %, and this kart is the most sensitive one, so the
  braking suite should be re-run before any decision. Direction: rear brake
  limit μ·g·(a/L)/(1 + μ·h/L), μ 1.6 → +4.4 % braking (0.29 → 0.25). That
  fits braking-strength.md, where the model was "between right and ~25 %
  weak" against the Vroomkart test.
- **Rental karts, two consistent options:**
  - A. Keep 0.23 / 0.25. This matches Mihalić's published split (driver
    0.418, kart 0.165 m), which gives 0.241 / 0.253.
  - B. Anchor on Lot's 0.25 like the Racingkart. The driver part becomes
    ~0.33 m (see "Split check"), which gives 0.21 / 0.22.

  The rental karts are not very sensitive (stop ~1.4–2.7 % per 10 %), so
  A vs B matters little.
- **Order Centralen < 270cc < Racingkart: supported.** The heaviest kart
  carries its mass in floor-level battery boxes (Sodi plan, below). The
  light Racingkart is mostly driver.

## Sources (NEW = not in the earlier task files)

1. **fastest-lap, roberto-lot-kart-2016.xml + chassis code**
   (github.com/juanmanzanero/fastest-lap, commit 0660208). **NEW:** h was
   "not readable" in braking-strength.md; it is now confirmed from the code.
   - File: `<com>0.0 0.0 -0.25</com>`, `<front_axle>0.645 0.0 0.111</front_axle>`,
     `<rear_axle>-0.4 0.0 0.111</rear_axle>`, `<mass>165.0</mass>`, tyre
     `<radius>0.139</radius>`, rear max power 20.1 kW, front track 1.055, rear 1.2.
     Header: "Reference: https://eprints.soton.ac.uk/385883/".
   - `src/core/chassis/chassis_car_6dof.hpp:178`: `const scalar h = -_x_com[2];`
     → h = 0.25 m.
   - Frame check: z points down and the chassis frame is at the CoM. The
     axles sit 0.111 m below the CoM, and 0.111 + 0.139 (wheel radius) =
     0.25 → the ground is 0.25 m below the CoM.
     `axle_car_6dof.hpp:124`: tyre deflection = axle z + R0 = 0 at rest.
     Self-consistent.
   - Kart: a 125-class racing kart (20.1 kW). Wheelbase 1.045 m, CoG
     0.40 m ahead of the rear axle → 61.7 % rear. Mass 165 kg is with the
     driver, because the model has no separate driver body.
   - Measured or assumed? Unknown. The paper itself (Lot & Dal Bianco,
     VSD 2016, doi 10.1080/00423114.2015.1125514) is still not readable:
     eprints 401/403, OpenAlex "closed". Semantic Scholar lists a "corrected
     proof" PDF on eprints, which gives 403. Dal Bianco's PhD thesis (Padova
     2017, research.unipd.it, a go-kart model chapter) is behind a
     Cloudflare check. → medium confidence: a value from a peer-reviewed
     lap-time model, copied by a third party.

2. **Mihalić et al. 2023**, Applied Sciences 13(20) 11312
   (doi 10.3390/app132011312). Read: the Research Square preprint
   rs-1852791 v1 (2022-08-25, authors Hoster, Tudić, Kralj). The MDPI
   final version gives 403, so it may differ. **NEW: the exact split.**
   - "The driver is presumed to have a maximal mass of 80 kg, and the
     vehicle maximal is 50 kg."
   - "xCG,d = 0,434 m, yCG,d = 0,418 m, xCG,v = 0,56 m, yCG,v = 0,165 m";
     final "L = 1,103 m, hCG = 0,32 m, LCG = 0,62 m".
   - Check: (0.418·80 + 0.165·50)/130 = 0.321 ✔.
   - The driver's CoG comes from 14 body segments (Hall, Basic
     Biomechanics) drawn in their seat. The vehicle's CoG comes from
     SolidWorks.
   - The kart is a CONCEPT electric kart for education (built later), "for
     children and adults up to an expected 80 kg", batteries on both sides
     of the seat. It is a design calculation: nothing measured.
   - The earlier note's split (0.43 / 0.15) was an assumption. The real one
     is 0.418 / 0.165, which changes the scaled values by only ≤ 0.01 m.
   - Low–medium confidence for OUR karts: seat height unknown, not a racing
     chassis.

3. **Mikler Anaya, Camacho, Bradley, IDETC2019-98112** (ASME 2019,
   "Multibody simulation of an electric go-kart …",
   https://radar.brookes.ac.uk/radar/file/3d8f925a-d74b-4a82-9d13-645f1710b192/1/IDETC2019-98112.pdf).
   **NEW.**
   - Table 1: "Wheelbase [mm] 1040 … Mass [Kg] 160 … CoG Height [mm] 150".
     Text: "kart's dimensions and weights were measured … as well as a
     70 kg pilot".
   - Table 5 weight: petrol 1307.8 N (133 kg), electric 1395 N (142 kg).
     That doesn't match the 160 kg, so it is UNCLEAR whether the 150 mm
     includes the driver.
   - Low confidence. 150 mm with a 70 kg driver on board is physically
     implausible (the axle centre alone is ~0.13–0.14 m), so it is most
     likely the kart without the driver.
4. Earlier, low (braking-strength.md, not searched again): 0.259 m at
   180 kg, L 1.22 (ResearchGate 345650470, unclear if with the driver);
   0.306 m shifter kart, assumed (ResearchGate 322097155; a search snippet
   says 60 kg driver, 155 kg total, NOT verified).
5. Discarded, **NEW**: Naranjo Lourido et al. 2026, Tecnura (e-kart for
   SuperKart), Table 1 "Center of Mass DZcm 0.125 m". That is equal to the
   wheel radius R 0.125 and the aero height: a placeholder.
   (revistas.udistrital.edu.co/index.php/Tecnura/article/download/24068/21604)
6. Seen in a search snippet only, not verified, not used: "Optimization of
   design parameters of go-kart" (ResearchGate 332112230), "C.O.G
   (628.7, 460) from rear axle (with driver)". The axis is unclear.

Mass split / seat height (do they support the scaling?):
- **Sodi RSX2 technical plan** (https://www.sodikart.com/content/images/karts/43/technical-plan-1632491770.jpg,
  from the RSX2 page). **NEW.**
  - Ground clearance 55 mm, under the box-shaped units between the axles
    at floor level (the battery boxes, as I read the drawing). Wheels
    Ø 262 front / Ø 291 mm rear.
  - Sodi: 186 kg "with lithium batteries"; no battery position or CoG
    given.
  - → The rental kart's own mass sits low. That supports "heaviest kart =
    lowest CoG" qualitatively; the numbers are mine.
- **Seat (racing karts):** S. Tillett (kartsportnews.com 2013,
  prod_tillett-seat-selection): "on average about 5 mm protruding below
  the level of the main chassis tubes". 58° seats (KZ, KF, Rotax) "lower
  the centre of gravity" vs 63°. The driver sits as low as the frame
  allows. Forum / maker, medium. Rental karts' seat height: **no data**.
- Seated driver CoG height above the seat: no usable source found (UMTRI
  Reed seated-CoM report and DTIC child data exist; full text not reached).
  **No data.**

## Split check (my arithmetic, estimates)

h = (m_driver·h_driver + m_kart·h_kart) / (m_driver + m_kart):

| Split | Racingkart 87+75 | 270cc 80+150 | Centralen 80+186 |
|---|---|---|---|
| Mihalić 0.418 / 0.165 | 0.301 | 0.253 | 0.241 |
| Lot-anchored: kart 0.16 (assumed) → driver 0.33 | 0.25 | 0.219 | 0.211 |

- Mihalić's driver at 0.418 m does NOT fit Lot's 0.25 m total. With
  87 kg at 0.418, the kart part would have to be 0.055 m, which is
  impossible because the axle alone is at 0.139.
- So the two sources disagree on the driver: Mihalić's seat is likely
  higher (an educational concept kart). Lot's racing kart puts the driver
  part at ~0.32–0.34 m (kart part 0.15–0.17 m assumed).
- Which one applies to rental-kart seats: no data.

## What remains an estimate

- Every value for the two rental karts (no published CoG for the Sodi RSX2
  or the Caroli Hammerhead), and the driver CoG in any kart.
- Whether Lot's 0.25 m was measured or assumed (the paper is unread).
  Robin was getting the PDF; its parameter table settles it.
- How it could be measured cheaply: the tilt method (one axle raised on
  scales, h from the load change). That is the usual way; no kart-specific
  source checked.
