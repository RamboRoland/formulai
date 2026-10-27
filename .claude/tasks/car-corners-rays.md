# Car corners in GameState + rays from the car's body

Robin (2026-10-25): two WS data changes.
1. Car position as x,y for each corner, in an array, clockwise.
2. Every ray starts at a corner or an edge of the car (not the centre).

## Decisions (Robin)
- NEW field `car.corners`; `car.x` / `car.y` (centre) stay.
- Format `[{ x, y }, ...]`, world px, rounded to 2 decimals like x/y.
- Clockwise on screen (y down), front-left first:
  front-left, front-right, rear-right, rear-left.
- Ray origins (directions unchanged, RAY_ANGLE_OFFSETS):
  | idx | ray           | origin             |
  |-----|---------------|--------------------|
  | 0   | forward       | front edge middle  |
  | 1   | forward-right | front-right corner |
  | 2   | right         | right edge middle  |
  | 3   | forward-left  | front-left corner  |
  | 4   | left          | left edge middle   |
  | 5   | back          | rear edge middle   |
  | 6   | back-right    | rear-right corner  |
  | 7   | back-left     | rear-left corner   |

## Today (read)
- Car local frame: +x = heading (length), +y = the car's right (angle +90),
  centre = car.x + widthPx/2, car.y + lengthPx/2 (GameEngine.checkCarCollision).
- Rays cast from the centre: GameEngine.tickPlayer (track.castRay, cap 1000,
  0 if the start point is off track). Drawn from the centre: Renderer.drawRays.
- GameState built in AiView + MultiplayerHostView; type in server/src/types/game.ts.

## Effect (Robin to be aware)
- Every ray value gets shorter (by the distance centre → its origin, ~0.7–1 m
  for the straight front/back rays, less sideways). Models trained on the
  old rays see different inputs.
- 0 now means that point of the car's body is off the track (outside the
  edge / in a wall) — before it meant the centre was off.

## Code
- [x] 1. One helper for car body points (local offset → world), used by
      corners, ray origins and the renderer: RAY_ORIGINS in rays.ts (local
      offsets in half-length / half-width units, same index as the angles),
      carPoint / carCorners helper.
- [x] 2. GameEngine.tickPlayer: cast each ray from its origin.
- [x] 3. Renderer.drawRays: draw each ray from its origin.
- [x] 4. GameState `car.corners` (AiView + MultiplayerHostView) + server type.
- [x] 5. tsc (app + server) + scratchpad check (vite-node, copies only): a
      car at a known pose → corners order/positions; rays from the origins
      vs. the old centre rays.
- [x] 6. Docs: README GameState, .personal/CLAUDE.md (Car physics, Ray
      casting, GameState), websocket-ai-client.md (car fields, rays).
- [x] 8. (Robin) hasCollision on the same tick as a ray at 0: tickPlayer
      checks `blocked` (where it stands → may it move?, unchanged), then
      hasCollision where the car is AFTER the move (same position as x/y,
      corners, rays). Movement unchanged; hasCollision + 'collision' event
      one tick earlier. Verified on copies: 288 drives / 41,694 ticks, ray 0
      without hasCollision 0×, first collision tick == first ray-0 tick 287/287.
- [x] 9. Docs: hasCollision = the car's current position (AI client doc).
- [ ] 7. Test (Robin): debug rays drawn from the body; AI reads corners.

## Not touched
- checkCarCollision keeps its own corner list (no behaviour change).
