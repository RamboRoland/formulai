// Braking bot (scratchpad, for Robin to watch): the test agent's ray driving
// with one braking style. --port <n> (--create <session> | --lobby <id>)
// --kart <class> --style threshold|trail|lock --lockPedal <brakeLock>
import { WebSocket } from 'ws';
import { SUBPROTOCOL, type CarControls, type GameState, type Message } from '/Users/robinljungstrom/Projects/formulai-braking/server/src/protocol';

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const port = arg('port') ?? '8081', kart = arg('kart') ?? 'HyrkartCentralen';
const style = arg('style') ?? 'threshold', lockPedal = Number(arg('lockPedal') ?? 0.4);
const clientName = `${style[0].toUpperCase()}${style.slice(1)}`;

// Brake when faster than the kart can still slow down to cornerKmh over the
// road it sees ahead (forward ray − marginM), at brakingG: v² = vc² + 2·a·d.
const PX_PER_M = 24, G = 9.81;
let braking = 0, states = 0, maxBrakeFrom = 0, topSpeed = 0;
const cornerKmh = Number(arg('cornerKmh') ?? 25), brakingG = Number(arg('brakingG') ?? 0.35), marginM = Number(arg('marginM') ?? 4);
function drive(gs: GameState): CarControls {
    states++; topSpeed = Math.max(topSpeed, gs.car.speed);
    if (states % 200 === 0) console.log(`${clientName}: braking ${(100 * braking / states).toFixed(0)}% of states, top ${topSpeed.toFixed(0)} km/h, braked from up to ${maxBrakeFrom.toFixed(0)} km/h`);
    const [forward, forwardRight, right, forwardLeft, left] = gs.car.rays;
    const turn = (forwardRight + right * 0.5) - (forwardLeft + left * 0.5);
    const steering = Math.max(-1, Math.min(1, turn / 150));
    const ahead = Math.max(0, forward / PX_PER_M - marginM);
    const allowed = Math.sqrt((cornerKmh / 3.6) ** 2 + 2 * brakingG * G * ahead) * 3.6;
    if (gs.car.speed <= allowed) return { forward: 1, backward: 0, steering, brake: 0 };
    braking++; maxBrakeFrom = Math.max(maxBrakeFrom, gs.car.speed);
    const threshold = 0.9 * lockPedal;
    const brake = style === 'lock' ? 1
        : style === 'trail' ? threshold * Math.max(0, 1 - Math.abs(steering) / 0.5)
        : threshold;
    return { forward: 0, backward: 0, steering, brake };
}

const url = `ws://localhost:${port}`;
const ws = new WebSocket(url, SUBPROTOCOL);
const send = (m: Message) => ws.send(JSON.stringify(m));
const progress = new Map<string, { meters: number; tick: number }>();
const join = (lobbyId: string) => send({ ns: 'req:agent', action: 'join', data: { lobbyId, name: clientName, cars: [{ name: clientName, kart }], stateMs: 50 } });

ws.on('open', () => {
    const create = arg('create');
    if (create) send({ ns: 'req:lobby', action: 'create', data: { session: create } });
    else join(arg('lobby')!);
});
ws.on('message', raw => {
    const m = JSON.parse(String(raw)) as Message;
    switch (`${m.ns}/${m.action}`) {
        case 'res:lobby/create': {
            const { lobbyId } = (m as Extract<Message, { ns: 'res:lobby'; action: 'create' }>).data;
            console.log(`LOBBY ${lobbyId}`);
            join(lobbyId);
            return;
        }
        case 'res:agent/joinError': case 'res:lobby/createError':
            console.error(`${clientName}: ${(m.data as { reason: string }).reason}`); process.exit(1); return;
        case 'res:agent/join': console.log(`${clientName} joined (${kart}, ${style}, lock pedal ${lockPedal})`); return;
        case 'evt:agent/state': {
            const { tick, cars } = (m as Extract<Message, { ns: 'evt:agent'; action: 'state' }>).data;
            const stuck: string[] = [];
            for (const car of cars) {
                const p = progress.get(car.carId);
                if (!p || car.track.completedMeters > p.meters + 0.5) progress.set(car.carId, { meters: car.track.completedMeters, tick });
                else if (tick - p.tick > 180 && !car.stage.completed) stuck.push(car.carId);
            }
            // A finished stage takes the car off the track: restart it on the
            // same layout so it keeps lapping (a like-for-like comparison).
            for (const car of cars) if (car.stage.completed && !stuck.includes(car.carId)) stuck.push(car.carId);
            if (stuck.length) { send({ ns: 'req:agent', action: 'restart', data: { carIds: stuck } }); stuck.forEach(id => progress.delete(id)); }
            send({ ns: 'req:agent', action: 'controls', data: { tick, cars: cars.map(car => ({ carId: car.carId, ...drive(car) })) } });
            return;
        }
    }
});
ws.on('close', () => process.exit(0));
ws.on('error', err => { console.error(`${clientName}: can't reach ${url}: ${err.message}`); process.exit(1); });
process.on('SIGINT', () => ws.close());
