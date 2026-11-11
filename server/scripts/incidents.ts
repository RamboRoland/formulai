// Incident logs (.claude/tasks/incident-logs.md): what spins and crashes
// the hosted server logged, summed up. Read only.
//
//   npm run incidents [-- --days 7] [--local] [--track <name>] [--kart <class>]
//                       [--driver agent|player] [--type spin|collision] [--top 5]
//
// --local reads the server's own bucket (server/.env, the local S3) instead
// of the Space. Per layout: where on the lap (share of the lap from the
// start line, 5 % buckets) and what the driver did just before (brake,
// steering, gas over the 0.5 s before the incident); per client; then the
// worst spins as short traces. On a collision a sample's `speed` keeps its
// last value though the car stands (engine behaviour).
import { gunzipSync } from 'zlib';
import { getBytes, listObjects, readOnlyBucket } from '../src/storage';
import { PREFIX } from '../src/formulai/incidentLog';
import { spaceSettings } from './space';

type Sample = Record<string, number | boolean> & { t: number; speed: number; slip: number; yawRate: number; brake: number; forward: number; steering: number; rearLocked: boolean };
type Incident = {
    type: 'spin' | 'collision'; at: string; lobby: string; track: string; layout: string; kart: string;
    client: string; driver: 'agent' | 'player'; lap: number; lapDistance: number; tick: number; samples: Sample[];
};

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const pct = (n: number, of: number) => of ? `${Math.round(n / of * 100)} %` : '–';
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

async function main(): Promise<void> {
    const days = Number(arg('days') ?? 7);
    const bucket = process.argv.includes('--local') ? { listObjects, getBytes } : readOnlyBucket(spaceSettings());
    const all: Incident[] = [];
    for (let d = 0; d < days; d++) {
        const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
        for (const { key } of await bucket.listObjects(`${PREFIX}${day}/`)) {
            const object = await bucket.getBytes(key);
            if (!object) continue;
            for (const line of gunzipSync(Buffer.from(object.bytes)).toString('utf8').split('\n')) if (line.trim()) all.push(JSON.parse(line));
        }
    }
    const want = (i: Incident) => (!arg('track') || i.track === arg('track')) && (!arg('kart') || i.kart === arg('kart'))
        && (!arg('driver') || i.driver === arg('driver')) && (!arg('type') || i.type === arg('type'));
    const list = all.filter(want);
    console.log(`${list.length} incident(s) in the last ${days} day(s)${list.length !== all.length ? ` (of ${all.length}, filtered)` : ''} — ${list.filter(i => i.type === 'spin').length} spins, ${list.filter(i => i.type === 'collision').length} collisions; agents ${list.filter(i => i.driver === 'agent').length}, players ${list.filter(i => i.driver === 'player').length}`);
    if (list.length === 0) return;

    // What the driver did in the 0.5 s (30 ticks) before the incident.
    const before = (i: Incident) => i.samples.filter(s => s.t >= i.tick - 30 && s.t <= i.tick);
    const describe = (group: Incident[]) => {
        const pre = group.flatMap(before);
        return `brake ${mean(pre.map(s => s.brake)).toFixed(2)} (locked ${pct(pre.filter(s => s.rearLocked).length, pre.length)}), gas ${mean(pre.map(s => s.forward)).toFixed(2)}, |steering| ${mean(pre.map(s => Math.abs(s.steering))).toFixed(2)}, speed ${mean(group.map(i => (i.samples.find(s => s.t === i.tick) ?? i.samples[0]).speed)).toFixed(0)} km/h`;
    };

    const byLayout = new Map<string, Incident[]>();
    for (const i of list) byLayout.set(`${i.track} / ${i.layout}`, [...(byLayout.get(`${i.track} / ${i.layout}`) ?? []), i]);
    for (const [layout, group] of [...byLayout].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n== ${layout}: ${group.length} (${group.filter(i => i.type === 'spin').length} spins)`);
        const buckets = new Map<number, Incident[]>();
        for (const i of group) { const b = Math.min(19, Math.floor((1 - i.lapDistance) * 20)); buckets.set(b, [...(buckets.get(b) ?? []), i]); }
        for (const [b, g] of [...buckets].sort((x, y) => y[1].length - x[1].length).slice(0, 5)) {
            console.log(`  lap ${String(b * 5).padStart(2)}–${b * 5 + 5} %: ${String(g.length).padStart(3)} (${g.filter(i => i.type === 'spin').length} spins) — ${describe(g)}`);
        }
    }

    console.log('\n== by client');
    const byClient = new Map<string, Incident[]>();
    for (const i of list) byClient.set(`${i.client} (${i.driver}, ${i.kart})`, [...(byClient.get(`${i.client} (${i.driver}, ${i.kart})`) ?? []), i]);
    for (const [client, g] of [...byClient].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${client}: ${g.length} (${g.filter(i => i.type === 'spin').length} spins) — ${describe(g)}`);

    const top = Number(arg('top') ?? 5);
    const spins = list.filter(i => i.type === 'spin').map(i => ({ i, peak: Math.max(...i.samples.map(s => Math.abs(s.slip))) })).sort((a, b) => b.peak - a.peak).slice(0, top);
    if (spins.length) console.log(`\n== worst ${spins.length} spin(s): every 3rd sample (0.15 s) from 1 s before; > = the incident`);
    for (const { i, peak } of spins) {
        console.log(`  ${i.at} ${i.track} / ${i.layout} lap ${Math.round((1 - i.lapDistance) * 100)} %, ${i.client} (${i.kart}), peak slip ${peak.toFixed(0)}°`);
        for (const s of i.samples.filter(s => s.t >= i.tick - 60 && s.t <= i.tick + 60).filter((s, n) => n % 3 === 0 || s.t === i.tick)) {
            console.log(`   ${s.t === i.tick ? '>' : ' '} ${String(s.speed.toFixed(0)).padStart(3)} km/h slip ${String(s.slip.toFixed(0)).padStart(4)}° yaw ${String(s.yawRate.toFixed(0)).padStart(4)}°/s gas ${s.forward} brake ${s.brake}${s.rearLocked ? ' LOCKED' : ''} steer ${s.steering}`);
        }
    }
}

main().catch(err => {
    console.error(`[incidents] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
