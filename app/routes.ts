import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("racing/player", "routes/racing-player.tsx"),
  route("racing/ai", "routes/racing-ai.tsx"),
  route("racing/multiplayer-ai", "routes/racing-multiplayer-ai.tsx"),
  route("track-editor", "routes/track-editor.tsx")
] satisfies RouteConfig;
