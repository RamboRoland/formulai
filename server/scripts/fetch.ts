// Makes the local S3 (config.s3) an exact copy of the DigitalOcean Space —
// the data's source — to run locally with the real data:
//
//   npm run fetch
//
// tracks/, tracks/drafts/, sessions/ and backgrounds/: every object that is
// new or different is copied byte for byte (with its content type), local
// objects the Space doesn't have are deleted. The Space is only read
// (storage.readOnlyBucket). Its keys come from deploy/.env (scripts/space.ts).
// The local server reads S3 at start → restart it.
import { config } from '../src/config';
import { deleteKey, getBytes, listObjects, putBytes, readOnlyBucket, waitForBucket } from '../src/storage';
import { TRACK_PREFIXES } from '../src/trackStore';
import { SESSION_PREFIX } from '../src/sessionStore';
import { BACKGROUND_PREFIX } from '../src/backgroundStore';
import { spaceSettings } from './space';

const S3_WAIT_SECONDS = 60;
const PREFIXES = [TRACK_PREFIXES.published, TRACK_PREFIXES.drafts, SESSION_PREFIX, BACKGROUND_PREFIX];

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const fallbackType = (key: string): string => key.endsWith('.json') ? 'application/json' : 'application/octet-stream';

async function main(): Promise<void> {
    const space = spaceSettings();
    const source = readOnlyBucket(space);
    const where = `${config.s3.endpoint ?? 'AWS S3'} bucket "${config.s3.bucket}"`;
    if (await waitForBucket(S3_WAIT_SECONDS, true)) console.log(`[fetch] created ${where}`);
    let copied = 0, same = 0, deleted = 0;
    for (const prefix of PREFIXES) {
        const remote = await source.listObjects(prefix);
        const remoteKeys = new Set(remote.map(o => o.key));
        for (const { key } of remote) {
            const object = await source.getBytes(key);
            if (!object) continue; // gone since the listing
            const local = await getBytes(key);
            if (local && sameBytes(local.bytes, object.bytes) && local.contentType === object.contentType) {
                same++;
                continue;
            }
            await putBytes(key, object.bytes, object.contentType ?? fallbackType(key));
            copied++;
            console.log(`[fetch] ${local ? 'updated' : 'new'}: ${key}`);
        }
        for (const { key } of await listObjects(prefix)) {
            if (remoteKeys.has(key)) continue;
            await deleteKey(key);
            deleted++;
            console.log(`[fetch] deleted (not in the Space): ${key}`);
        }
    }
    console.log(`[fetch] ${where} = Space "${space.bucket}": ${copied} copied, ${deleted} deleted, ${same} already the same`);
    console.log('[fetch] restart the local server to load it (it reads S3 at start)');
}

main().catch(err => {
    // A refused connection comes as an AggregateError without a message.
    const reason = err instanceof Error ? err.message || (err as { code?: string }).code || err.name : String(err);
    console.error(`[fetch] failed: ${reason} (local S3: ${config.s3.endpoint ?? 'AWS S3'} — is it running? docker compose up -d s3)`);
    process.exit(1);
});
