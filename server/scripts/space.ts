// The source S3 (the DigitalOcean Space, the data's source) for the scripts:
// SOURCE_S3_* in server/.env (git-ignored, see server/.env.example; loaded
// by the npm scripts). Not S3_* — those are the server's own bucket, so the
// server never points at the source by mistake. Spaces: bucket in the host
// name. Values never printed.
import type { S3Settings } from '../src/storage';

export function spaceSettings(): S3Settings {
    const env = process.env;
    const missing = ['SOURCE_S3_ENDPOINT', 'SOURCE_S3_REGION', 'SOURCE_S3_BUCKET', 'SOURCE_S3_ACCESS_KEY_ID', 'SOURCE_S3_SECRET_ACCESS_KEY'].filter(k => !env[k]);
    if (missing.length > 0) throw new Error(`server/.env has no ${missing.join(', ')} (the source S3, see server/.env.example)`);
    return {
        endpoint: env.SOURCE_S3_ENDPOINT,
        region: env.SOURCE_S3_REGION!,
        bucket: env.SOURCE_S3_BUCKET!,
        accessKeyId: env.SOURCE_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.SOURCE_S3_SECRET_ACCESS_KEY!,
        forcePathStyle: false,
    };
}
