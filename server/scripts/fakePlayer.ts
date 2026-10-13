import { WebSocket } from 'ws';

type Args = {
    lobbyId?: string;
    name: string;
    car: string;
    sendGameState?: boolean;
};

const parseArgs = (): Args => {
    const args = process.argv.slice(2);
    const result: Args = {
        name: 'Bot',
        car: 'GokartTraining',
        sendGameState: true,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        switch (arg) {
            case '--lobby':
            case '--lobbyId':
                result.lobbyId = next;
                i++;
                break;
            case '--name':
                result.name = next ?? result.name;
                i++;
                break;
            case '--car':
                result.car = next ?? result.car;
                i++;
                break;
            case '--no-state':
                result.sendGameState = false;
                break;
            default:
                break;
        }
    }

    return result;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const ws = new WebSocket('ws://localhost:8080', 'multiplayer');

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[fake-player] received ${signal}, closing websocket...`);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client shutdown');
        setTimeout(() => process.exit(0), 1000).unref();
    } else {
        process.exit(0);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const main = async () => {
    const { lobbyId: cliLobbyId, name, car, sendGameState } = parseArgs();

    let clientId: string | null = null;
    let lobbyId = cliLobbyId ?? null;
    let gameStarted = false;

    ws.on('open', () => console.log('[fake-player] connected'));
    ws.on('close', () => {
        console.log('[fake-player] disconnected');
        if (shuttingDown) process.exit(0);
    });
    ws.on('error', (err) => console.error('[fake-player] error', err));

    ws.on('message', async (raw) => {
        const msg = JSON.parse(raw.toString());
        const { ns, action, data } = msg;

        switch (ns) {
            case 'evt:system':
                if (action === 'welcome') {
                    clientId = data.clientId;
                    console.log('[welcome]', data);

                    // If no lobby passed, we rely on server picking an existing one
                    ws.send(JSON.stringify({
                        ns: 'req:lobby',
                        action: 'join',
                        data: { lobbyId, playerName: name, playerCar: car }
                    }));
                }
            break;

            case 'res:lobby':
                if (action === 'join') {
                    console.log('[lobby joined]', data);
                }
                break;

            case 'evt:game':
                if (action === 'start') {
                    gameStarted = true

                    ws.send(JSON.stringify({
                        ns: 'req:game',
                        action: 'requestPlayerState',
                        data: { lobbyId }
                    }));
                }
                break;

            case 'res:game':
                if (action === 'playerState') {
                    console.log('[game state]', data);

                    await sleep(1000);

                    ws.send(JSON.stringify({
                        ns: 'req:game',
                        action: 'requestPlayerState',
                        data: { lobbyId }
                    }));

                    await sleep(200);

                    ws.send(JSON.stringify({
                        ns: 'req:control',
                        action: 'send',
                        data: {

                        }
                    }));
                }
                break;

            case 'lobbyJoined':
                lobbyId = data.lobbyId;
                console.log('[lobby joined]', lobbyId, 'players:', data.players.length);
                break;

            case 'playerJoined':
                console.log('[player joined]', data.players.map((p: any) => p.name).join(', '));
                break;

            case 'gameStarted':
                gameStarted = true;
                console.log('[game started]');
                if (sendGameState) {
                    // small delay to avoid racing with start
                    await sleep(200);
                    const tick = () => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'playerGameState',
                                data: {
                                    gameState: {
                                        players: [
                                            {
                                                id: clientId,
                                                position: { x: Math.random() * 10, y: Math.random() * 10 },
                                                velocity: { x: 0, y: 0 },
                                                angle: 0,
                                                car,
                                                lap: 0,
                                                finished: false,
                                                checkpoints: []
                                            }
                                        ]
                                    }
                                }
                            }));
                            setTimeout(tick, 500);
                        }
                    };
                    tick();
                }
                break;

            case 'playerGameState':
                console.log('[state received]', JSON.stringify(data.gameState));
                break;

            case 'error':
                console.error('[server error]', data);
                break;

            default:
                console.log('[message]', ns, action, data);
        }
    });
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

