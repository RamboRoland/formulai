// The DigitalOcean Space (the data's source) for the scripts: its settings
// from deploy/.env (git-ignored, see deploy/.env.example) — as the hosted
// server gets them; Spaces: bucket in the host name. Values never printed.
import fs from 'fs';
import path from 'path';
import { parseEnv } from 'util';
import type { S3Settings } from '../src/storage';

const DEPLOY_ENV = path.resolve(__dirname, '../../deploy/.env');

export function spaceSettings(): S3Settings {
    if (!fs.existsSync(DEPLOY_ENV)) throw new Error(`${DEPLOY_ENV} is missing (the Space's keys, see deploy/.env.example)`);
    const env = parseEnv(fs.readFileSync(DEPLOY_ENV, 'utf8')) as Record<string, string | undefined>;
    const missing = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(k => !env[k]);
    if (missing.length > 0) throw new Error(`deploy/.env has no ${missing.join(', ')}`);
    return {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION!,
        bucket: env.S3_BUCKET!,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: false,
    };
}
