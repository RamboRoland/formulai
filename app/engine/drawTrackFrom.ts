import type { Track } from '~/tracks/Track';
import { DrawTrack } from './DrawTrack';
import { placeTrackProps } from './trackProps';

const cache = new WeakMap<Track, DrawTrack>();

// TRANSITION ONLY (removed in phase 3e): the views that still run their own
// engine turn their Track into the same RenderTrack data the server sends,
// so the renderers only ever draw a DrawTrack.
export function drawTrackFrom(track: Track): DrawTrack {
    let drawTrack = cache.get(track);
    if (!drawTrack) {
        drawTrack = new DrawTrack(JSON.parse(JSON.stringify({
            key: `${track.name}::${track.layoutId}::local`,
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
        })));
        cache.set(track, drawTrack);
    }
    return drawTrack;
}
