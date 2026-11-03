import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    ListObjectsV2Command,
    NoSuchKey,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { config } from './config';

// The server's data in S3 (config.s3) — the only code that talks to it.
// Keys: tracks/<file>.json (published), tracks/drafts/<file>.json,
// sessions/<file>.json (JSON text), backgrounds/<file> (images).
const client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});
const Bucket = config.s3.bucket;

// The keys directly in `prefix` (e.g. "tracks/" — not tracks/drafts/…),
// sorted.
export async function listKeys(prefix: string): Promise<string[]> {
    return (await listObjects(prefix)).map(object => object.key);
}

// As listKeys, with each object's size in bytes.
export async function listObjects(prefix: string): Promise<{ key: string; size: number }[]> {
    const objects: { key: string; size: number }[] = [];
    let ContinuationToken: string | undefined;
    do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, Delimiter: '/', ContinuationToken }));
        for (const object of page.Contents ?? []) if (object.Key) objects.push({ key: object.Key, size: object.Size ?? 0 });
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return objects.sort((a, b) => a.key.localeCompare(b.key));
}

// An object's text; null if there is no such key.
export async function getText(key: string): Promise<string | null> {
    try {
        const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return (await object.Body?.transformToString('utf8')) ?? '';
    } catch (err) {
        if (err instanceof NoSuchKey) return null;
        throw err;
    }
}

// An object's bytes and content type; null if there is no such key.
export async function getBytes(key: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
    try {
        const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return { bytes: (await object.Body?.transformToByteArray()) ?? new Uint8Array(), contentType: object.ContentType };
    } catch (err) {
        if (err instanceof NoSuchKey) return null;
        throw err;
    }
}

// Writes bytes (e.g. an image) with their content type.
export async function putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }));
}

// Writes `value` as pretty-printed JSON (as the files on disk were).
export async function putJson(key: string, value: unknown): Promise<void> {
    await putText(key, JSON.stringify(value, null, 2) + '\n');
}

// Writes JSON text as it is (e.g. a repo file, byte for byte).
export async function putText(key: string, text: string): Promise<void> {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: text, ContentType: 'application/json' }));
}

// A missing key is fine (already gone).
export async function deleteKey(key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

// Waits until the bucket answers (the local S3 needs a few seconds after a
// start), up to `seconds`. A missing bucket: created when `create` (then
// returns true), else fails at once (run the seed).
export async function waitForBucket(seconds: number, create = false): Promise<boolean> {
    const until = Date.now() + seconds * 1000;
    const where = `${config.s3.endpoint ?? 'AWS S3'} bucket "${Bucket}"`;
    for (;;) {
        try {
            await client.send(new HeadBucketCommand({ Bucket }));
            return false;
        } catch (err) {
            const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
            if (status === 404) {
                if (!create) throw new Error(`No ${where} — fill it with \`npm run seed\`.`);
                await client.send(new CreateBucketCommand({ Bucket }));
                return true;
            }
            if (Date.now() >= until) {
                const reason = err instanceof Error ? err.message || (err as { code?: string }).code || err.name : String(err);
                throw new Error(`Can't reach ${where}: ${reason}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
