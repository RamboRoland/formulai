# `app/wire/` — WebSocket boundary layer

**Server owns the wire types** (`server/src/types/`). This folder is where the
app translates between those wire types and its own internal types.

## When to add a file here

Only when the app actually needs a type that differs from what the server
defines. Right now the app imports wire types directly (e.g. `GameState`,
`Controls`, `LobbyPlayer`) and uses them as-is — no transformers needed.

Add here when:
- An internal engine/view type carries fields the wire doesn't (e.g.
  physics state the host keeps but doesn't send).
- The app wants a different shape (grouped by actor, computed derivatives,
  etc.) and translating per-message keeps call sites clean.

## Shape

Typical file:

```ts
// app/wire/gameState.ts
import type { GameState as WireGameState } from '../../server/src/types';
import type { AppGameState } from '~/engine/types';

export const toWireGameState = (app: AppGameState): WireGameState => ({ ... });
export const fromWireGameState = (wire: WireGameState): AppGameState => ({ ... });
```

Transformers are plain functions. No classes, no state. Each file handles
one shape pair. Views and engine import only app types; they call
`toWire*` just before `ws.send(...)` and `fromWire*` right after receiving.

## Rule of thumb

Keep this folder small. If an app type and a wire type are structurally
identical, don't add a transformer — just reuse the wire type. Add the
transformer when (not if) they diverge.
