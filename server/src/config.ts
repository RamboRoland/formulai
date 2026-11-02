// Every setting the server uses. Values can come from `server/.env`
// (gitignored, see `server/.env.example`; loaded by the npm scripts with
// Node's --env-file-if-exists) or the container's environment; the rest
// of the code only reads this.
import path from 'path';

export const config = {
    // Port the WebSocket server listens on (every network interface).
    port: Number(process.env.PORT || 8080),
    // Folder with the track JSON files (read when needed; the server owns
    // the tracks). Default: the repo's app/assets/tracks.
    tracksDir: process.env.TRACKS_DIR || path.resolve(__dirname, '../../app/assets/tracks'),
    // Folder with the session JSON files (owned by the server).
    sessionsDir: path.resolve(__dirname, '../sessions'),
};
