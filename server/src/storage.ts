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
export type S3Settings = typeof config.s3;

const connect = (s3: S3Settings): S3Client => new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
});
const client = connect(config.s3);
const Bucket = config.s3.bucket;

// Another bucket, read only — nothing here writes (scripts/fetch.ts: the
// DigitalOcean Space, the data's source).
export function readOnlyBucket(s3: S3Settings): {
    listObjects: (prefix: string) => Promise<{ key: string; size: number }[]>;
    getBytes: (key: string) => Promise<{ bytes: Uint8Array; contentType?: string } | null>;
} {
    const other = connect(s3);
    return {
        listObjects: prefix => list(other, s3.bucket, prefix),
        getBytes: key => bytes(other, s3.bucket, key),
    };
}

// Another bucket, JSON text read and written as it is (scripts/laptimes.ts:
// expectedLapTimes into the Space).
export function writableBucket(s3: S3Settings): ReturnType<typeof readOnlyBucket> & {
    getText: (key: string) => Promise<string | null>;
    putText: (key: string, text: string) => Promise<void>;
} {
    const other = connect(s3);
    return {
        ...readOnlyBucket(s3),
        getText: key => text(other, s3.bucket, key),
        putText: (key, value) => put(other, s3.bucket, key, value),
    };
}

// The keys directly in `prefix` (e.g. "tracks/" — not tracks/drafts/…),
// sorted.
export async function listKeys(prefix: string): Promise<string[]> {
    return (await listObjects(prefix)).map(object => object.key);
}

// As listKeys, with each object's size in bytes.
export async function listObjects(prefix: string): Promise<{ key: string; size: number }[]> {
    return list(client, Bucket, prefix);
}

async function list(from: S3Client, bucket: string, prefix: string): Promise<{ key: string; size: number }[]> {
    const objects: { key: string; size: number }[] = [];
    let ContinuationToken: string | undefined;
    do {
        const page = await from.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken }));
        for (const object of page.Contents ?? []) if (object.Key) objects.push({ key: object.Key, size: object.Size ?? 0 });
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return objects.sort((a, b) => a.key.localeCompare(b.key));
}

// An object's text; null if there is no such key.
export async function getText(key: string): Promise<string | null> {
    return text(client, Bucket, key);
}

async function text(from: S3Client, bucket: string, key: string): Promise<string | null> {
    try {
        const object = await from.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await object.Body?.transformToString('utf8')) ?? '';
    } catch (err) {
        if (err instanceof NoSuchKey) return null;
        throw err;
    }
}

// An object's bytes and content type; null if there is no such key.
export async function getBytes(key: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
    return bytes(client, Bucket, key);
}

async function bytes(from: S3Client, bucket: string, key: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
    try {
        const object = await from.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
export async function putText(key: string, value: string): Promise<void> {
    await put(client, Bucket, key, value);
}

async function put(to: S3Client, bucket: string, key: string, value: string): Promise<void> {
    await to.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, ContentType: 'application/json' }));
}

// A missing key is fine (already gone).
export async function deleteKey(key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

// Waits until the bucket answers (the local S3 needs a few seconds after a
// start), up to `seconds`. A missing bucket: created when `create` (then
// returns true), else fails at once (run the fetch).
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
                if (!create) throw new Error(`No ${where} — fill it with \`npm run fetch\`.`);
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
