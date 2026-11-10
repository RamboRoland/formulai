// Rename a kart class in the DigitalOcean Space (the data's source):
// sessions' `cars` and tracks' `expectedLapTimes` keys (published + drafts).
//
//   npm run rename-kart -- Hyrkart240cc Hyrkart270cc         what would change, nothing written
//   npm run rename-kart -- Hyrkart240cc Hyrkart270cc --yes   writes it into the Space
//
// Only the "<old>" JSON strings change — everything else stays byte for
// byte (checked: the text with the new name put back is the file read, and
// the parsed file equals the old one with the name mapped). The new name
// must be a kart class of this code (CAR_CLASSES), the old one not; every
// session must load with this code against the renamed tracks. A file saved
// in the Space while this ran is left alone. Write it just BEFORE the code
// with the new name deploys (the running server keeps what it loaded; a
// server with the new code skips sessions that still use the old name), then
// `npm run fetch` for local.
import { isDeepStrictEqual } from 'util';
import { registerTracks } from '../src/game/tracks/registry';
import { CAR_CLASSES } from '../src/game/tracks/serialize';
import type { TrackJSON } from '../src/game/tracks/types';
import { validateSession } from '../src/sessionStore';
import { readOnlyBucket, writableBucket } from '../src/storage';
import { TRACK_PREFIXES } from '../src/trackStore';
import { spaceSettings } from './space';

const SESSION_PREFIX = 'sessions/';

// `value` with every string `from` (as a value or an object key) → `to`.
function renamed(value: unknown, from: string, to: string): unknown {
    if (value === from) return to;
    if (Array.isArray(value)) return value.map(v => renamed(v, from, to));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k === from ? to : k, renamed(v, from, to)]));
    }
    return value;
}

async function main(): Promise<void> {
    const [from, to] = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const write = process.argv.includes('--yes');
    if (!from || !to) throw new Error('usage: npm run rename-kart -- <old name> <new name> [--yes]');
    if (!CAR_CLASSES.includes(to)) throw new Error(`"${to}" isn't a kart class of this code (${CAR_CLASSES.join(', ')})`);
    if (CAR_CLASSES.includes(from)) throw new Error(`"${from}" is still a kart class of this code`);
    const oldToken = JSON.stringify(from), newToken = JSON.stringify(to);

    const space = readOnlyBucket(spaceSettings());
    const files: { key: string; before: string; after: string; count: number }[] = [];
    for (const prefix of [SESSION_PREFIX, TRACK_PREFIXES.published, TRACK_PREFIXES.drafts]) {
        for (const { key } of await space.listObjects(prefix)) {
            if (!key.endsWith('.json')) continue;
            const object = await space.getBytes(key);
            if (!object) continue;
            const before = Buffer.from(object.bytes).toString('utf8');
            const count = before.split(oldToken).length - 1;
            if (before.includes(newToken)) throw new Error(`${key} already has ${newToken} — rename it by hand`);
            const after = before.split(oldToken).join(newToken);
            if (after.split(newToken).join(oldToken) !== before) throw new Error(`${key}: more than ${oldToken} would change`);
            if (!isDeepStrictEqual(JSON.parse(after), renamed(JSON.parse(before), from, to))) throw new Error(`${key}: the parsed file changes beyond the name`);
            files.push({ key, before, after, count });
        }
    }

    // Every session must load with this code, against the renamed tracks.
    registerTracks(files.filter(f => f.key.startsWith(TRACK_PREFIXES.published) && !f.key.startsWith(TRACK_PREFIXES.drafts)).map(f => JSON.parse(f.after) as TrackJSON));
    for (const f of files.filter(f => f.key.startsWith(SESSION_PREFIX))) {
        const valid = validateSession(JSON.parse(f.after));
        if ('error' in valid) throw new Error(`${f.key} wouldn't load after the rename: ${valid.error}`);
    }

    const changed = files.filter(f => f.count > 0);
    for (const f of files) console.log(`${String(f.count).padStart(3)} × ${oldToken}  ${f.key}`);
    console.log(`\n${changed.length} of ${files.length} file(s) change; every session loads with the new name.`);
    if (changed.length === 0) return;
    if (!write) {
        console.log(`Nothing written. Write them into the Space: npm run rename-kart -- ${from} ${to} --yes`);
        return;
    }
    const target = writableBucket(spaceSettings());
    for (const { key, before, after } of changed) {
        if ((await target.getText(key)) !== before) {
            console.error(`[rename-kart] ${key} was saved in the Space while this ran — skipped, run again`);
            continue;
        }
        await target.putText(key, after);
        if ((await target.getText(key)) !== after) throw new Error(`${key}: the Space doesn't hold what was written`);
        console.log(`[rename-kart] written: ${key}`);
    }
    console.log('[rename-kart] deploy the code with the new name now (it reads S3 at start); npm run fetch for local');
}

main().catch(err => {
    console.error(`[rename-kart] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
