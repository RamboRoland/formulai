# Marbles (racing line, graphics)

Goal: the darkness beside the racing line is MARBLES — rubber sheared off
loaded tyres and thrown to the OUTSIDE of corners — not an even spread to
both sides. Visual only, App only (`app/src/engine/rubberLine.ts`); no
server / protocol change.

Sources: Robin's notes (2026-11-12, pasted): marbles form under side load
and land outside the line; straights make almost none (no side force);
braking zones make the most on a straight, kicked to both sides of the
corridor; tyres shed picked-up marbles on the next straight; the swept
corridor leaves two bands beside the line. Distances (Robin): marbles
start 15–40 cm outside the outer wheels' path (scrub zone kept clean by
the slip angle + a few cm of line variation), scatter up to 1–1.5 m wide;
slow hairpins (30–50 km/h) a narrow ridge 15–30 cm off the line, fast
sweepers (80–110 km/h) ≥ 1 m. No measured kart data — estimates.

Decisions (Robin, 2026-11-12):
- Outward marbles first; then carry + shed.
- The even spread is REPLACED (not kept weaker): only marbles darken the
  asphalt; straights and the inside of corners stay ~clean.
- Unchanged: the rubber texture, `on` / `near` and the line factor (the
  two soft wheel-track lines), pick-up.
- Left out: slipstream (no source, kart speeds), camber / wind (no data),
  rain / weathering (maybe later), the dark-line question (Robin's
  lighter line stays).

## Design (Phase 1)
- Per wheel trail (App, from the interpolated car): speed v = piece
  length / time, path turn κ = Δdirection / length, sideways acceleration
  a = v²κ, smoothed (0.15 s). s = min(1, |a| / 1.2 g) = how much of the
  scrub is sideways.
- Every piece lays marbles = scrub (no BASE_RUBBER: rolling makes none) ×
  tyre width per length (the same amount the rubber gets), as ONE
  Gaussian ribbon per wheel drawn straight into `dust` (additive), on the
  outside of the turn only (first try had an inner-side ribbon too → the
  dashes, see Phase 1); s < 0.1 → away from the kart's centre. Its near
  edge (2σ) `start` outside the tyre's edge, σ by corner speed: 40 km/h →
  start 0.15 m, σ 0.08 m (a ridge); 100 km/h → start 0.4 m, σ 0.3 m (band
  to ~1.7 m); linear between, held outside; × s towards the near values
  (straight braking: close to the wheel).
- `fresh` + the `near` spread into `dust` go (nothing else adds to dust).
- Tangential ejection (landing further along the corner) left out of
  Phase 1: the ribbon is continuous along the path anyway; revisit if
  corner exits look wrong.

## Phase 1 — outward marbles
- [x] Trail: time, direction, smoothed sideways acceleration per wheel
- [x] Marble ribbons (Gaussian across, additive into `dust`)
- [x] Remove `fresh` / spread → dust
- [x] Chrome: bots (scratch `lineBot.mjs`, protocol only), test-only ×10
      time-lapse scaling every rate together
- [x] Dashes (Robin's screenshot): NOT the turn estimate (logged: raw
      spikes 1.5 g once per viewer frame, smoothed only 0.34–0.43 g) —
      pick-up off → gone. Inner-side ribbons landed where the rear wheels
      run (wider track, slip, weave) and were picked up in patches.
      Fix (Robin): per wheel, OUTSIDE of the turn only, one ribbon;
      below s 0.1 away from the kart's centre; a side change starts a new
      ribbon. Also fixed: GAIN was applied twice (my bug, this branch)
- [ ] Robin checks

## Phase 1b — locked tyres (Robin's notes, 2026-11-12)
Locked: no rotation → no sideways flinging; the sliding tyre rolls up
shreds and dumps them at the END of the skid. The streak itself = the
existing tyre marks. Glaze / less grip: physics, left out.
- [x] Locked rears (frame `locked`) throw no marbles; they carry
      scrub × width × length; dropped as one round Gaussian clump
      (σ 0.25 m, estimate) where the lock ends / the trail breaks / the
      car leaves or respawns (≤ 64 a frame)
- [x] Chrome: bot 1 brakes fully → 14 paired drops in 30 s at lock ends
- [x] Revised (Robin: "these large spots?", his notes 2026-11-12): debris
      = worms / shavings INSIDE the skid + one clump at the release
      point, not a 1–1.5 m stain. Now: shavings along the skid (centred,
      σ tyre width / 4) take 0.1 → 0.45 of the scrub as the skid grows
      0.5 → 2.5 m (Robin's skid-length refinement; ~30 / 70 typical), the
      rest a clump σ 0.09 m across × 0.1 m along the skid. Post-release
      scatter = Phase 2's pick-up + shed. Worms (2–10 cm) too small for
      5 cm texels; glaze / flat spot left out
- [x] Chrome, real rate: small elongated heaps in pairs at lock ends
- [ ] Robin checks

## Phase 1c — laid rubber dark UNDER the tyres (Robin, 2026-11-12)
Robin's notes: the racing line = smooth dark asphalt with embedded
rubber; off-line rough, no rubber. Replaces the lighter line of
2026-11-11; the light look comes from marbles moving (pick-up, Phase 2).
- [x] Shown: RUBBER_DARK 0.4 × (1 − e^(−on / RUBBER_SATURATE)), marbles
      layered over it (1 − (1 − rubber)(1 − marbles)); never picked up
- [x] `near` blur, LINE_CLEAN / CLEAR_*, mipmaps removed
- [x] Too wide (Robin): `on` σ 0.25 m spread each wheel to ~1 m → texels
      0.1 → 0.05 m (4096 cap: tracks ≤ 205 m wide get 5 cm, bigger ones
      coarser), `on` = 1-texel edge blur → tyre-wide lines;
      RUBBER_SATURATE 15 (corner ~95 % / straight ~23 % after 100 laps)
- [x] Chrome: thin wheel-track lines, marble arcs outside, lock clumps
- [x] "Not quite under the tyres": the lines are laid at the CLASS's wheels
      (server `wheels`), the 3D model (`raceCar.glb`) was fitted by its
      length → drawn 1.01 m wide, track 0.79 m vs the class's 1.05 / 1.125.
      Robin: scale the model uniformly to the class width (Scene3D, kart +
      headlight): track 1.06 m; drawn 2.5 m long vs the 1.865 m box
      (accepted). Chase view: lines run under the drawn wheels
- [ ] Robin checks

## Phase 2 — carry + shed
Robin's notes (2026-11-12): 63 % of pick-up shed after 150–400 m (rental
100–200 m, hot slicks 300–500 m); loose chunks first, the rest needs
corner scrubbing — straights clean badly, weaving cleans ~2× faster.
Shed marbles land like fresh ones: corners outside the turn (15 cm –
1.5 m), never inside the apex; straights two bands bordering the clean
corridor; braking both sides of the braking line.
Design:
- Pick-up is on the GPU (dust × (1 − p)) → the carry is too: a carry
  texture, one texel per wheel (64 karts × 4).
- Per frame: (1) carry += dust under the wheel (sampled at the piece's
  middle, before any dust write) × pickup × brush area; (2) pick-up
  multiply (as before); (3) marbles: the marble ribbon's amount = scrub
  part (CPU) + carry × shed share (its vertex shader reads the carry);
  (4) carry × (1 − shed share). Nothing lost.
- Shed share per piece = 1 − e^(−length × (1 / 400 m + scrub / 15 m)):
  straight ~0.25 %/m, corner (0.2) ~1.6 %/m → ~150 m for 63 % on a mixed
  lap (rental; the frame has no kart class → one value for all).
- Locked: picks up, sheds nothing (no rotation); its clump as Phase 1b.
- One pool (no loose / embedded split) — estimate.
- [x] Carry texture + slots per car (freed when a car leaves; cleared on
      another track)
- [x] Passes (1)–(4)
- [x] Chrome: test-only carry readback — every kart's carry rises
      (0.5–1.5 m²·amount) and sheds back towards 0; locking rears pick up
      their own clumps. Kart #1's front texels stayed 0 with identical
      bot lines; with own lines (offset −0.6…+0.6 m + wander) they carry
      0.1–2 → texel 0 works, it was the line
- [x] Own-line bots: rubber = one soft wider line, marbles outside the
      corners (Robin: "they are good")
- [ ] Robin checks

## Docs
- [x] Top comment `rubberLine.ts`, `.personal/CLAUDE.md` Rendering
      (worktree copy — copy to main at the merge), `rubber-pickup.md` +
      `tyre-marks-rubber.md` point here
- [x] Test-only parts removed (×10 time-lapse, carry readback, logs)

# Marble look (Robin, 2026-11-12)
Marbles were invisible at the real rate (94 % of pieces scrub < 0.1;
~150 passes per spot to show) and, built up (8 bots × 10 time-lapse,
orange debug colour), read as thin LINES beside each wheel track — like
more rubber. Robin's notes: marbles need clustering (clean buffer + outer
ridge), granules, relief, gloss, wheel-track cuts — in that order.

## Phase A — clean buffer + outer ridge
- Profile across a wheel's marble band (outside of the turn): nothing
  closer than `start` (0.15 m) to the tyre edge (hard cut; the old
  Gaussian leaked ~13 % inward); 75 % a ridge (Gaussian, centre 2σ out,
  σ 0.08 → 0.3 m by corner speed); 25 % a sparse exponential tail out
  over L 0.5 → 1.2 m (toward the kerb). Shed marbles the same; lock
  shavings stay centred in the skid.
- Maybe next: a shader mask hiding marbles within ~15 cm of ANY laid
  rubber groove (other karts' lines) — only if Chrome shows overlap.
- [x] Profile in the marble shader (A per length from the CPU; aProfile
      = band width, σ, tail, side)
- [x] Chrome (orange debug, 8 bots, × 10, ~5 min): corners now show a
      band outside the line (ridge + soft tail toward the edge), not thin
      lines; some orange still between other karts' grooves
- [x] Robin: placement good; no groove mask — marbles in other karts'
      grooves "will be pushed out over time" (pick-up + shed)
- [x] Docs: `.personal/CLAUDE.md` Rendering (worktree copy)

## Phase B — granules (Robin's notes)
- Shown in the asphalt shader, world-space (metres), only where there are
  marbles: three cellular-noise scales — fine grit (cells ~6 mm), rolled
  pellets (~15 mm), sparse ribbons (~40 mm); the share of cells holding a
  granule grows with the marble amount (fine most, ribbons fewest).
- Stretched 1.5× along the travel direction: a direction texture (RG
  half floats, as dust) written by the marble pass — (cos 2θ, sin 2θ) ×
  amount, so opposite directions add; the shader takes θ = ½ atan.
- Colours (Robin's notes): rubber smooth #1A1A1C; granules #111113 with a
  warm grey-brown dust edge. Lighter overall than the old #101010.
- Distance: a granule smaller than ~2 screen pixels fades into its
  average (no shimmer); from the isometric view a grainy band.
- [x] Direction texture + its pass
- [x] Granule shader + colours + distance fade
- [x] Chrome (× 10 test-only): first try ~invisible from afar (granules
      covered ~25 %, scales took the max) → scales combine (union),
      radius 0.38 cell, shares 1 / 0.6 / 0.2 → a full band ~60 %:
      isometric = a darker band outside the rubber (averaged); chase =
      single dark specks, stretched along the travel
- [x] Robin: "looks good"
- [x] Docs: `.personal/CLAUDE.md` Rendering (worktree copy)

## Phase C — relief (micro-shadows + AO; Robin, 2026-11-12)
- Scene3D passes `sunDirection` (time-of-day slider; the moon at night)
  to RubberLine.update → shader uniform uSun.
- Pellets + ribbons (not the fine grit) = small domes (height 0.6 ×
  radius): the top lit in the scene's 3 toon bands (TOON_BANDS 110 / 190
  / 255), lit colour dark grey; a contact shadow beside each granule away
  from the sun (length = height / tan(elevation), ≤ 2 × radius, alpha
  0.4); a thin AO ring at the base (alpha 0.2). Up close only (averaged
  away with the granules). Estimates, tuned on screen.
- [x] uSun from Scene3D
- [x] Dome shade + contact shadow + AO in the granule shader
- [x] First try barely visible (lit top #2e2e31 darker than the asphalt;
      pellets a few px; the overlay ignored the scene's shadows) →
      stronger (Robin): lit #5a5a5e, shadow 0.6, relief on all scales,
      the scene's shadow map (lights: true, receiveShadow) → no sun tops /
      cast shadows in building / tree / kart shadows
- [x] No pixel noise (Robin): specks only from a 7 px cell, relief from
      12 px; flat specks keep Phase B's colour (middle toon band)
- [x] → at real sizes NOTHING showed in any camera (2–30 mm stay a few
      px) → Robin: stylised ~3.5 × (cells 2 / 6.5 / 16 cm: grit ~1.5,
      pellets ~5, ribbons ~12 cm across). Free / orbit camera: clean
      elongated specks in a band beside the rubber line, dark in shade
- [x] Robin: "looks good"
- [x] Docs: `.personal/CLAUDE.md` Rendering (worktree copy)

## Phase D — gloss (Robin: "both", 2026-11-12)
- Only on granule tops with relief (≥ 12 px, sunlit, not in the scene's
  shadows): a toon glint — Blinn-Phong half vector (sun + view, the
  camera from three's cameraPosition) on the dome normal, cut hard
  (≥ GLINT_FROM), colour #d8d6cc, ≤ 80 %. Asphalt, rubber, dust edges,
  contact shadows stay matte. Estimates.
- [x] Glint in the granule shader (view vector in the granules' space)
- [x] Chrome (× 10, 16:30, Robin's close free camera): small hard
      white glints on lit pellet tops, matte elsewhere; FPS 105 (120
      before) with the whole view full of granules up close
- [x] Robin: commit + merge
- [x] Docs: `.personal/CLAUDE.md` Rendering
