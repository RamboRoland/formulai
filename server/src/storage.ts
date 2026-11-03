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
// sessions/<file>.json. Every object is a JSON text file.
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
    const keys: string[] = [];
    let ContinuationToken: string | undefined;
    do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, Delimiter: '/', ContinuationToken }));
        for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys.sort();
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

// Creates the bucket unless it exists. Returns whether it was created.
export async function ensureBucket(): Promise<boolean> {
    try {
        await client.send(new HeadBucketCommand({ Bucket }));
        return false;
    } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
        return true;
    }
}
