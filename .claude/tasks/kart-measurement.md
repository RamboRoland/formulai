# Measuring a real 270cc at Torslanda (protocol, 2026-11-11)

Why: the brake-tap pivot (`.claude/tasks/braking-spin.md`) can't be
settled without real data — does a real Hyrkart270cc rotate on a light
brake tap at hairpin speed, how much, how fast? The same logs can check
jacking, grip and braking. Robin drives; I write the import + compare.

## Equipment

- Phone 1 = logger, mounted RIGID to the chassis (not on the driver): a
  tight strap / bracket on the seat back or the floor pan, screen facing
  a known way (note it: e.g. "screen up, top towards the front").
  App (pick one, test at home first): Sensor Logger (iOS / Android,
  free, exports CSV: gyroscope, accelerometer, GPS — set ≥ 50 Hz motion,
  1–10 Hz GPS) or RaceChrono (GPS + phone sensors, CSV export).
- Phone 2 / action camera = onboard video of the steering wheel + hands
  + the road ahead (steering angle, brake / gas foot if visible). 30 fps
  is enough; start both recordings, then clap / tap the logger phone
  hard once in front of the camera (sync mark).
- Optional: a friend filming one hairpin from outside, from a high,
  fixed spot (the kart's rotation vs its path).
- Ask the staff first (filming, mounting a phone); within the track's
  rules; no deliberate spins.

## Runs (same 1–2 hairpins every time; 3–4 repetitions each)

Pick a slow hairpin (≈ 25–40 km/h) and, if possible, one medium corner.
For each run, say out loud for the video what you'll do ("run 3, light
tap").
1. Normal: brake straight before the corner, release, turn in, no brake
   in the corner.
2. Light brake tap right at turn-in (a quick touch, as light as you can
   still feel).
3. Firmer tap at turn-in (about half of what you'd brake on a straight).
4. Light drag: keep a little brake on from the turn-in to about the
   apex.
5. (Optional) Too much lock: turn in harder than needed, no brake — does
   it push?
Also: one straight-line hard stop (no steering) from the fastest point
you safely can — the stopping distance and whether it stays straight.

## What I need afterwards

- The logger CSV(s) + the video(s), and a note per run (run number,
  what you did, which corner, anything odd).
- The phone's mounting orientation, the kart number, the weather
  (dry / wet) and roughly the tyre state.

## What I'll do with it

1. An import script (scratchpad first): CSV → time series of yaw rate,
   lateral / longitudinal g, GPS speed; aligned with the video's steering
   angle (read by hand from frames if needed).
2. For each run: yaw rate before vs after the tap, peak, how fast it
   settles; lateral g in the corner (real grip); deceleration in the
   straight stop (real brake / lock point).
3. Replay: drive the same corner in the simulator with the measured
   speed and steering, compare yaw rate and g tick by tick → which model
   value is off (front / rear grip, jacking, brake), with numbers.

Open: which hairpin (Robin knows the track); whether the rental karts
may carry a phone.
