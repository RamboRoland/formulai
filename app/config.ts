// Every setting the app uses. Values can come from the root `.env`
// (gitignored, see `.env.example`); the rest of the code only reads this.
// Vite reads `.env` in `npm run dev` and bakes it in at `npm run build`.
export const config = {
    // The WebSocket server the app connects to — its PUBLIC address (the
    // app connects to it directly), e.g. wss://game.example.com.
    wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:8080',
    // The same server's HTTP API (sessions, karts …). Default: wsUrl with
    // ws → http (wss → https); set VITE_API_URL if it lives elsewhere.
    apiUrl: import.meta.env.VITE_API_URL || (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http'),
};
