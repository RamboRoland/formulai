import type { BackgroundEntry } from './protocol';
import { TRACK_REGISTRY } from './game/tracks/registry';
import { TRACK_PREFIXES } from './trackStore';
import { deleteKey, getBytes, getText, listKeys, listObjects, putBytes } from './storage';

// The track editor's trace backgrounds in S3 (backgrounds/<file>): images
// it lays under a track while drawing it. A track's editorBackground.src
// names one by FILE NAME (older tracks hold a path ending in it).
export const BACKGROUND_PREFIX = 'backgrounds/';
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
const FILE_RE = /^[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/i;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

type Failure = { status: number; error: string };

export async function listBackgrounds(): Promise<BackgroundEntry[]> {
    return (await listObjects(BACKGROUND_PREFIX))
        .map(object => ({ file: object.key.slice(BACKGROUND_PREFIX.length), size: object.size }))
        .filter(entry => FILE_RE.test(entry.file));
}

export async function readBackground(file: string): Promise<{ bytes: Uint8Array; contentType: string } | Failure> {
    const type = contentType(file);
    if ('error' in type) return type;
    const object = await getBytes(BACKGROUND_PREFIX + file);
    if (!object) return { status: 404, error: 'Background not found.' };
    return { bytes: object.bytes, contentType: type.contentType };
}

// A new or replaced background: the bytes must be the image type its
// extension says (it is served to browsers as that type).
export async function saveBackground(file: string, bytes: Uint8Array): Promise<Failure | null> {
    const type = contentType(file);
    if ('error' in type) return type;
    if (bytes.length > MAX_BACKGROUND_BYTES) return { status: 413, error: `Larger than ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB.` };
    if (!isImage(bytes, type.contentType)) return { status: 400, error: `The file isn't a ${type.contentType.split('/')[1].toUpperCase()} image.` };
    await putBytes(BACKGROUND_PREFIX + file, bytes, type.contentType);
    return null;
}

// Not while a track (published or draft) uses it.
export async function deleteBackground(file: string): Promise<Failure | null> {
    const type = contentType(file);
    if ('error' in type) return type;
    const users = await tracksUsing(file);
    if (users.length > 0) return { status: 409, error: `"${file}" is the background of: ${users.join(', ')}.` };
    await deleteKey(BACKGROUND_PREFIX + file);
    return null;
}

// The background file a track's editorBackground.src names (a file name, or
// an older path / URL ending in one).
export const backgroundFile = (src: string): string => src.split('/').pop() ?? src;

// Tracks whose background is `file`: published ones (registry) by name,
// drafts by "<name> (draft)".
async function tracksUsing(file: string): Promise<string[]> {
    const uses = (json: unknown) => {
        const src = (json as { editorBackground?: { src?: unknown } } | null)?.editorBackground?.src;
        return typeof src === 'string' && backgroundFile(src) === file;
    };
    const users = Object.values(TRACK_REGISTRY).filter(uses).map(json => json.name);
    for (const key of await listKeys(TRACK_PREFIXES.drafts)) {
        try {
            const json = JSON.parse((await getText(key)) ?? '');
            if (uses(json)) users.push(`${typeof json?.name === 'string' ? json.name : key} (draft)`);
        } catch {
            // malformed draft: can't use anything
        }
    }
    return users;
}

function contentType(file: string): { contentType: string } | Failure {
    const match = FILE_RE.exec(file);
    if (!match) return { status: 400, error: 'file must match [A-Za-z0-9_.-]+ with .png, .jpg, .jpeg or .webp.' };
    return { contentType: TYPES[match[1].toLowerCase()] };
}

// The file's first bytes match the image type.
function isImage(bytes: Uint8Array, type: string): boolean {
    const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
    if (type === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (type === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
    if (type === 'image/webp') return starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    return false;
}
