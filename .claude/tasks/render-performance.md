# 3D rendering performance

Goal: steady frame rate in the 3D views (isometric 3D layer, chase / cockpit /
orbit / free), Firefox first.

## Measured (2026-11-23, built-in Chromium pane, DPR 2, Torslanda, Player mode)

WebGL calls counted per frame by patching `WebGL2RenderingContext.prototype`;
"JS" = time inside the rAF callback. The pane was hidden, so fps is throttled and
not quoted; draw counts and JS time are not affected.

| Case | Draw calls | Triangles | Bone texture uploads | JS / frame |
|---|---|---|---|---|
| Isometric, crowd on | 2957 | 918 k | 1881 | 14.4 ms |
| Isometric, crowd off (`SPECTATOR_FILL = 0`) | 1088 | 258 k | 0 | 3.5 ms |
| Chase, driving, crowd on | 3609 | 1160 k | 1904 | 17.7 ms |
| Chase, driving, crowd off | 994 | 257 k | 0 | 2.7 ms |

**The crowd costs about 75 % of the draw calls and 80 % of the main-thread time.**

- There are about 940 spectators. Each one is a `SkeletonUtils.clone`, so it has
  two `SkinnedMesh`es (body and head) with their own skeletons. That means two
  bone-texture uploads, two draw calls, two shadow-pass draw calls and a
  matrix-update walk per spectator, every frame. The cheering arms also run in JS.
- Firefox's WebGL has a higher cost per call than Chromium's, so a scene that is
  bound by call count suffers most there. That fits "mainly Firefox".
- The GLBs use rigid skinning: all 12 characters have one joint per vertex,
  checked from WEIGHTS_0. A spectator is therefore just rigid parts (legs, torso,
  arms, head), so no skinning is needed.
- Still unmeasured: the GPU side (fill rate at 2000 × 1400 with MSAA, the 4096
  PCF shadow map), Firefox itself, and the WebGL → 2D `drawImage` copy every
  frame. The 0.04 ms measured for the copy only times queuing the call.

## Plan

Each step is measured with the same counter snippet before and after. Numbers
go in the Review section.

### 0. Firefox baseline (you run it, about 5 min)
- [ ] In Firefox: open `/racing/player`, open the profiler (Shift+F5 or
      about:profiling), record 5 s in isometric and 5 s in chase. Repeat with
      `SPECTATOR_FILL = 0`. The profiles show whether Firefox spends its time in
      the crowd (JS and WebGL calls) or in `drawImage`, compositing or the GPU.

### 1. Quick win: spectators cast no shadows (1 line)
- [x] `castShadow = false` on spectator meshes. Their shadow falls on the
      stand's own seats, which don't receive shadows anyway. This removes about
      900 shadow-pass draw calls. A stopgap until step 2 lands, and kept after it.

### 2. Crowd as instanced rigid parts (the real fix)
- [x] At template load, split each character into static (unskinned)
      geometry. Bake each vertex into its bone's bind pose and store a per-vertex
      `aPart` value (0 = still, 1 = left arm, 2 = right arm). Head and body are
      merged into one geometry.
- [x] One `InstancedMesh` per character model (10 models, so 10 draw calls plus
      10 for shadows if they keep them). Instance matrices hold the seat
      position, yaw and scale, under the stand's pivot as now.
- [x] Per-instance attributes: `aPhase`, `aArm` (armAngle, waveAngle,
      waveSpeed, burstSpeed), `aArmOffset`, `aJump` (height, speed). In the
      toon material's `onBeforeCompile`, rotate `aPart` vertices around their
      shoulder pivot by the same formula as `render()` (uniform `uTime`), and add
      the hop to y. Non-cheering spectators get fixed idle arms (wave amplitude
      0, arm angle `IDLE_ARM_ANGLE`).
- [x] Clothes: build all 8 variants per model into one atlas, with one band per
      variant. The vertex shader offsets the UV by `aVariant`. Hair is currently
      per geometry (a UV rewrite); fold it into the same atlas as a palette swap
      for the hair cells, so a variant = clothes + hair. Everything stays on the
      shared colormap pipeline, NearestFilter as now.
- [x] See-through (`seeThrough.patch`) must still apply: chain it with the
      crowd's `onBeforeCompile`.
- [x] Delete `cheerers`, the per-frame loop in `render()`, `cloneSkinned`, the
      per-key `clothesMaterials` / `hairGeometries` maps, and whatever the atlas
      replaces.
- Expected: crowd about 20 draw calls instead of about 2600, about 0 ms JS.
  The same look and the same seeded crowd.

### 3. Remaining ~1000 draw calls (props, trees)
- [ ] Count them by model with the snippet. If trees and props dominate,
      instance the same idea per prop model (`setProps` → `InstancedMesh` per
      model × mesh). Only do this if step 0 or a re-measure shows it still
      matters after step 2.

### 4. Stop copying the WebGL canvas into the 2D canvas (if step 0 points there)
- [ ] `Renderer.draw` does `canvasCtx.drawImage(scene.render(...))` every frame
      (2000 × 1400). Instead, put the WebGL canvas in the DOM: stacked over the
      2D canvas in isometric (it is already transparent there), alone in
      perspective modes. The debug rays and collision overlay, now drawn after
      the 3D layer, go on the 2D canvas under it, or on a small overlay canvas.
      Firefox can do a GPU → CPU readback here.

### 5. GPU fill (only if step 0 shows GPU-bound frames)
- [ ] Cap the WebGL drawing buffer at 1.5× DPR, or drop `antialias` when DPR
      ≥ 2 (MSAA at 2000 × 1400 is costly on integrated GPUs).
- [ ] Shadow map 4096 → 2048 in isometric (the area is small there), and see
      whether PCF → Basic looks acceptable with the toon bands.

Not planned: billboards or impostors for the crowd. Instancing keeps the 3D
look at about the same cost, and impostors break in chase and orbit.

## Review

### Steps 1–2 (2026-11-23): `app/src/engine/crowd.ts`
- New `Crowd` class (Scene3D only calls `seat()` and `update()`). It is built
  per stand × model × material: 15 stands on Torslanda × ≤ 10 models ≈ 114
  draw calls. The stand pivot is the parent, so the stand's own frustum culling
  still applies. No shadow pass for the crowd.
- Differences from the plan: the InstancedMesh is per stand rather than global
  (the same async lifecycle as the stand, about 100 calls instead of about 10;
  both are negligible). The clothes atlas is per model, with 9 bands: band 0 is
  the original, which the head and the 'other layout' model male-b use. Hair is
  a per-instance UV shift on `aHair` vertices. Same seeded crowd: every
  `random()` call is made in the same order as before.
- `seeThrough.patch` now chains a material's own `onBeforeCompile`. Crowd
  materials have `customProgramCacheKey = 'crowd'`, so they never share a
  program with plain props.

Measured the same way as above (built-in pane, DPR 2, Torslanda):

| Case | Draw calls before → after | JS / frame before → after |
|---|---|---|
| Isometric | 2957 → 1094 | 14.4 → 4.8 ms |
| Chase, driving | 3609 → 1108 | 17.7 → 2.8 ms |
| Free, close on a stand | – → 476 | – → 1.8 ms |

Bone texture uploads went from about 1900 per frame to 0. In the visible pane,
the free view on a full stand shows 40 fps instead of 12. Visually the stand
matches the old one: same seats, clothes, hair, waving arms and hops.

Next: about 1000 draw calls are left, and they're props (654 on Torslanda,
17 models). That's step 3, after the Firefox profile (step 0).
