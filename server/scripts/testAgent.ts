// A test AI agent for the `formulai` protocol — uses ONLY the protocol (no
// game code), like an outside agent would. Joins a lobby with one or more
// cars and drives them on their rays: steer towards the side with more room,
// slow down when the road ahead is short, restart a car that is stuck.
//
//   npm run test-agent -- --create TrainingEndless --cars 2
//   npm run test-agent -- --lobby ABC123 --name Bot --kart HyrkartCentralen
//
// Options: --lobby <id> | --create <session>, --cars <n> (1), --name <name>
// (Bot), --kart <class> (the session's first), --seconds <n> (run forever),
// --state-ms <n> (a state every n ms; the server's default), --client
// <name> (the client's name for viewers; the server's default).
import { WebSocket } from 'ws';
import { config } from '../src/config';
import { SUBPROTOCOL, type CarControls, type GameState, type Message } from '../src/protocol';

type Args = { lobby?: string; create?: string; cars: number; name: string; kart?: string; seconds?: number; stateMs?: number; client?: string };

function parseArgs(): Args {
    const args: Args = { cars: 1, name: 'Bot' };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const next = argv[i + 1];
        switch (argv[i]) {
            case '--lobby': args.lobby = next; i++; break;
            case '--create': args.create = next; i++; break;
            case '--cars': args.cars = Math.max(1, Number(next) || 1); i++; break;
            case '--name': args.name = next ?? args.name; i++; break;
            case '--kart': args.kart = next; i++; break;
            case '--seconds': args.seconds = Number(next); i++; break;
            case '--state-ms': args.stateMs = Number(next); i++; break;
            case '--client': args.client = next; i++; break;
        }
    }
    if (!args.lobby && !args.create) {
        console.error('Give --lobby <id> or --create <session>.');
        process.exit(1);
    }
    return args;
}

// Rays: [forward, forward-right, right, forward-left, left, back, back-right, back-left] (px).
function drive(gs: GameState): CarControls {
    const [forward, forwardRight, right, forwardLeft, left] = gs.car.rays;
    const turn = (forwardRight + right * 0.5) - (forwardLeft + left * 0.5);
    const steering = Math.max(-1, Math.min(1, turn / 150));
    const tooFast = forward < 60 + gs.car.speed * 2.5;
    return { forward: !tooFast, backward: false, steering, brake: tooFast && gs.car.speed > 15 };
}

const args = parseArgs();
const url = `ws://localhost:${config.port}`;
const ws = new WebSocket(url, SUBPROTOCOL);
const send = (message: Message) => ws.send(JSON.stringify(message));
// Stuck = no metres gained for this many ticks → restart that car.
const STUCK_TICKS = 180;
const progress = new Map<string, { meters: number; tick: number }>();
let agentId = '';
// Progress is logged every LOG_TICKS (states don't come every tick).
const LOG_TICKS = 300;
let loggedAt = 0;

ws.on('open', () => {
    console.log(`[test-agent] connected to ${url}`);
    if (args.create) send({ ns: 'req:lobby', action: 'create', data: { session: args.create } });
    else join(args.lobby!);
});

function join(lobbyId: string): void {
    // Kart: --kart, else the session's first (from the lobby list).
    if (args.kart) {
        send({ ns: 'req:agent', action: 'join', data: { lobbyId, name: args.client, cars: carList(args.kart), stateMs: args.stateMs } });
        return;
    }
    pendingJoin = lobbyId;
    send({ ns: 'req:lobby', action: 'list' });
}
let pendingJoin: string | null = null;

const carList = (kart: string) => Array.from({ length: args.cars }, (_, i) => ({
    name: args.cars > 1 ? `${args.name} ${i + 1}` : args.name,
    kart,
}));

ws.on('message', raw => {
    const m = JSON.parse(String(raw)) as Message;
    switch (`${m.ns}/${m.action}`) {
        case 'res:lobby/create': {
            const { lobbyId } = (m as Extract<Message, { ns: 'res:lobby'; action: 'create' }>).data;
            console.log(`[test-agent] created lobby ${lobbyId}`);
            join(lobbyId);
            return;
        }
        case 'res:lobby/list': {
            const lobby = (m as Extract<Message, { ns: 'res:lobby'; action: 'list' }>).data.lobbies.find(l => l.id === pendingJoin);
            if (!lobby) {
                console.error(`[test-agent] no lobby "${pendingJoin}"`);
                process.exit(1);
            }
            send({ ns: 'req:agent', action: 'join', data: { lobbyId: lobby.id, name: args.client, cars: carList(lobby.session.cars[0]), stateMs: args.stateMs } });
            pendingJoin = null;
            return;
        }
        case 'res:lobby/createError':
        case 'res:agent/joinError':
            console.error(`[test-agent] ${m.ns}/${m.action}:`, (m.data as { reason: string }).reason);
            process.exit(1);
            return;
        case 'res:agent/join': {
            const data = (m as Extract<Message, { ns: 'res:agent'; action: 'join' }>).data;
            agentId = data.agentId;
            console.log(`[test-agent] joined as ${agentId} with ${data.cars.map(c => `${c.name} (${c.carId})`).join(', ')}, ${data.stateMs === null ? 'state every tick (fast training)' : `state every ${data.stateMs} ms`}`);
            return;
        }
        case 'evt:agent/start':
        case 'evt:agent/stage': {
            const { stage } = (m as Extract<Message, { ns: 'evt:agent'; action: 'start' }>).data;
            console.log(`[test-agent] stage ${stage.index + 1}: ${stage.track} ${stage.layout} (${stage.loop ? `${stage.laps} laps` : 'one-way'})`);
            return;
        }
        case 'evt:agent/state': {
            const { tick, cars } = (m as Extract<Message, { ns: 'evt:agent'; action: 'state' }>).data;
            const stuck: string[] = [];
            for (const car of cars) {
                const p = progress.get(car.carId);
                if (!p || car.track.completedMeters > p.meters + 0.5) progress.set(car.carId, { meters: car.track.completedMeters, tick });
                else if (tick - p.tick > STUCK_TICKS && !car.stage.completed) stuck.push(car.carId);
            }
            if (stuck.length) {
                send({ ns: 'req:agent', action: 'restart', data: { carIds: stuck } });
                for (const id of stuck) progress.delete(id);
            }
            send({ ns: 'req:agent', action: 'controls', data: { tick, cars: cars.map(car => ({ carId: car.carId, ...drive(car) })) } });
            if (tick - loggedAt >= LOG_TICKS) {
                loggedAt = tick - tick % LOG_TICKS;
                console.log(`[test-agent] tick ${tick}: ${cars.map(c => `${Math.round(c.track.completedMeters)} m${c.stage.completed ? ' ✓' : ''}`).join(', ')}`);
            }
            return;
        }
        case 'evt:agent/restarted':
            console.log(`[test-agent] restarted ${(m.data as { carIds: string[] }).carIds.join(', ')} (stuck)`);
            return;
        case 'evt:agent/completed':
            console.log('[test-agent] session completed');
            return;
        case 'evt:system/error':
            console.error('[test-agent] server error:', (m.data as { reason: string }).reason);
            return;
    }
});

ws.on('close', () => {
    console.log('[test-agent] disconnected');
    process.exit(0);
});
ws.on('error', err => {
    console.error(`[test-agent] can't reach ${url}: ${err.message}`);
    process.exit(1);
});
if (args.seconds) setTimeout(() => ws.close(), args.seconds * 1000);
process.on('SIGINT', () => ws.close());
