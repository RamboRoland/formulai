import { createHash } from 'crypto';
import type { RenderTrack } from '../protocol';
import type { Track } from '../game/tracks/Track';
import { TRACK_REGISTRY } from '../game/tracks/registry';
import { placeTrackProps } from '../game/engine/trackProps';

const cache = new WeakMap<Track, RenderTrack>();

// Everything the App needs to draw one layout, computed here once per Track
// (the same data the App's renderer read from Track before): the bezier
// outline for the sharp 2D fill, its flattened rings for the 3D asphalt,
// tyre walls, grid lines, checkpoints, 3D paint, tyres, props, bounds.
// `key` = track + layout + a hash of the track file, so a saved track gets
// a new key.
export function renderTrack(track: Track): RenderTrack {
    const cached = cache.get(track);
    if (cached) return cached;
    const json = TRACK_REGISTRY[track.name];
    const hash = createHash('sha1').update(JSON.stringify(json ?? null)).digest('hex').slice(0, 12);
    const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const result: RenderTrack = plain({
        key: `${track.name}::${track.layoutId}::${hash}`,
        name: track.name,
        layout: track.layoutName,
        bounds: track.bounds,
        outline: track.outline,
        rings: track.geometry?.rings ?? [],
        walls: track.geometry?.walls.lines ?? [],
        gridLines: track.gridLines(),
        checkpoints: track.checkpoints,
        startIndex: track.startIndex,
        finishIndex: track.finishIndex,
        paintStrips: track.paintStrips(),
        paintQuads: track.paintQuads(),
        tyres: track.tyres(),
        props: placeTrackProps(track),
    });
    cache.set(track, result);
    return result;
}
