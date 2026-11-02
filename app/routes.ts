import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("racing/player", "routes/racing-player.tsx"),
  route("lobbies", "routes/lobbies.tsx"),
  route("lobbies/:lobbyId", "routes/lobby.tsx"),
  route("lobby/create", "routes/lobby-create.tsx"),
  route("session/editor", "routes/session-editor.tsx"),
  route("track/editor", "routes/track-editor.tsx")
] satisfies RouteConfig;
