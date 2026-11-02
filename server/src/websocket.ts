import { WebSocketServer as WSServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { FormulaiServer } from './formulai/FormulaiServer';
import { handleHttp } from './httpApi';
import { SUBPROTOCOL } from './protocol/envelope';

// The game server on one port: the HTTP API (httpApi.ts) and the
// `formulai` WebSocket protocol (formulai/, protocol/). A connection that
// doesn't ask for the `formulai` subprotocol is refused.
export class RacingGameServer {
    private readonly http: Server;
    private readonly wss: WSServer;
    private readonly formulai = new FormulaiServer();

    public constructor(port: number) {
        this.http = createServer(handleHttp);
        this.wss = new WSServer({
            server: this.http,
            handleProtocols: (protocols: Set<string>) => protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false,
        });
        this.wss.on('connection', (ws: WebSocket) => {
            if (ws.protocol !== SUBPROTOCOL) {
                ws.close(1002, `Use the "${SUBPROTOCOL}" subprotocol.`);
                return;
            }
            this.formulai.handleConnection(ws);
        });
        this.wss.on('error', (error: Error) => console.error('WebSocket server error:', error));
        this.http.listen(port, () => console.log(`WebSocket server is listening on port ${port}`));
    }

    public cleanup(): void {
        for (const ws of this.wss.clients) ws.close();
        this.wss.close();
        this.http.close();
    }
}
