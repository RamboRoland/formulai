// Every setting the server uses. Values can come from `server/.env`
// (gitignored, see `server/.env.example`; loaded by the npm scripts with
// Node's --env-file-if-exists) or the container's environment; the rest
// of the code only reads this.
export const config = {
    // Port the WebSocket server listens on (every network interface).
    port: Number(process.env.PORT || 8080),
};
