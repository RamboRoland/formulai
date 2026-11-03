// Fills the server's S3 bucket (config.s3) from the repo's files: waits for
// S3 (up to a minute), creates the bucket if missing, then uploads every JSON file that ISN'T in the
// bucket yet, byte for byte — never overwrites (edits made through the
// editors stay).
//
//   npm run seed
//
// tracks/*.json → tracks/, tracks/drafts/*.json → tracks/drafts/,
// sessions/*.json and sessions/saved/*.json → sessions/. A file that isn't
// valid JSON is skipped with an error.
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { listKeys, putText, waitForBucket } from '../src/storage';

const ROOT = path.resolve(__dirname, '..');
const S3_WAIT_SECONDS = 60;
const SOURCES: { dir: string; prefix: string }[] = [
    { dir: 'tracks', prefix: 'tracks/' },
    { dir: 'tracks/drafts', prefix: 'tracks/drafts/' },
    { dir: 'sessions', prefix: 'sessions/' },
    { dir: 'sessions/saved', prefix: 'sessions/' },
];

async function main(): Promise<void> {
    const where = `${config.s3.endpoint ?? 'AWS S3'} bucket "${config.s3.bucket}"`;
    if (await waitForBucket(S3_WAIT_SECONDS, true)) console.log(`[seed] created ${where}`);
    let uploaded = 0;
    let kept = 0;
    const existing = new Map<string, Set<string>>();
    for (const { dir, prefix } of SOURCES) {
        const folder = path.join(ROOT, dir);
        if (!fs.existsSync(folder)) continue;
        if (!existing.has(prefix)) existing.set(prefix, new Set(await listKeys(prefix)));
        const keys = existing.get(prefix)!;
        for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.json')).sort()) {
            const key = prefix + file;
            if (keys.has(key)) {
                kept++;
                continue;
            }
            const text = fs.readFileSync(path.join(folder, file), 'utf8');
            try {
                JSON.parse(text);
            } catch (err) {
                console.error(`[seed] ${dir}/${file}: ${err instanceof Error ? err.message : String(err)} — skipped`);
                continue;
            }
            await putText(key, text);
            keys.add(key);
            uploaded++;
            console.log(`[seed] ${dir}/${file} → ${key}`);
        }
    }
    console.log(`[seed] ${where}: ${uploaded} uploaded, ${kept} already there (kept)`);
}

main().catch(err => {
    // A refused connection comes as an AggregateError without a message.
    const reason = err instanceof Error ? err.message || (err as { code?: string }).code || err.name : String(err);
    console.error(`[seed] failed: ${reason} (${config.s3.endpoint ?? 'AWS S3'} — is the S3 running? docker compose up -d s3)`);
    process.exit(1);
});
