import type { Track } from '~/tracks/Track';
import { fromMetersToPixels } from '~/helper';

// Decorative 3D props around a track. Purely visual: placed only where the
// track geometry says "off track", never fed back into collision or rays.

export type Prop = {
    model: string;
    x: number;           // ground centre, world px
    y: number;
    rotationY: number;   // IsoModelRenderer rotation (radians, 8 steps)
    diameterPx: number;  // footprint the model is scaled to fit
};

type PropKind = { model: string; diameterM: number };

// Trackside props, facing the track.
const EDGE_PROPS: PropKind[] = [
    { model: 'grandStand', diameterM: 9 },
    { model: 'grandStandCovered', diameterM: 9 },
    { model: 'billboard', diameterM: 5 },
    { model: 'billboardLow', diameterM: 5 },
    { model: 'tent', diameterM: 4 },
    { model: 'tentClosed', diameterM: 4 },
    { model: 'bannerTowerRed', diameterM: 2.5 },
    { model: 'bannerTowerGreen', diameterM: 2.5 },
    { model: 'lightPostLarge', diameterM: 1.5 },
    { model: 'flagRed', diameterM: 1.2 },
    { model: 'flagGreen', diameterM: 1.2 },
    { model: 'flagCheckers', diameterM: 1.2 },
    { model: 'camera_exclusive', diameterM: 1.5 },
    { model: 'radarEquipment', diameterM: 2.5 },
    { model: 'pylon', diameterM: 0.6 },
];
const TREES: PropKind[] = [
    { model: 'treeLarge', diameterM: 3.5 },
    { model: 'treeSmall', diameterM: 2.5 },
];

const EDGE_MARGIN_PX = fromMetersToPixels(1.5); // gap between track edge and a prop
const EDGE_SPACING_PX = fromMetersToPixels(10); // avg distance between trackside props
const TREE_CELL_PX = fromMetersToPixels(8);     // one tree candidate per cell
const TREE_BORDER_PX = fromMetersToPixels(40);  // how far past the track bounds trees go
const CLEAR_RAYS = 12;
const ROTATION_STEPS = 8;

// Deterministic per track name, so the scenery never changes between runs.
const seededRandom = (seedText: string): (() => number) => {
    let seed = 0;
    for (const char of seedText) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
    // mulberry32
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const quantizeRotation = (rad: number): number => {
    const step = (Math.PI * 2) / ROTATION_STEPS;
    return Math.round(rad / step) * step;
};

export const placeTrackProps = (track: Track): Prop[] => {
    const geometry = track.geometry;
    if (!geometry) return [];
    const random = seededRandom(track.name);
    const props: Prop[] = [];

    // A disc is clear if its centre is off track, no track edge (or tyre
    // wall) crosses any spoke, and it doesn't overlap another prop.
    const isClear = (x: number, y: number, radius: number): boolean => {
        if (!track.isPointColliding(x, y)) return false;
        for (let i = 0; i < CLEAR_RAYS; i++) {
            const angle = (i / CLEAR_RAYS) * Math.PI * 2;
            const endX = x + Math.cos(angle) * radius;
            const endY = y + Math.sin(angle) * radius;
            if (track.segmentCrossesEdge(x, y, endX, endY) || !track.isPointColliding(endX, endY)) return false;
        }
        return props.every(p => Math.hypot(p.x - x, p.y - y) >= p.diameterPx / 2 + radius);
    };

    // Trackside: walk every outline ring (outer edge and infield), stepping
    // EDGE_SPACING_PX ± jitter, and stand a prop just outside the edge.
    for (const ring of geometry.rings) {
        let nextAt = random() * EDGE_SPACING_PX;
        let walked = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            const segment = Math.hypot(b.x - a.x, b.y - a.y);
            walked += segment;
            if (walked < nextAt || segment === 0) continue;
            nextAt = walked + EDGE_SPACING_PX * (0.6 + random() * 0.8);

            // Normal pointing away from the track surface.
            let normalX = -(b.y - a.y) / segment;
            let normalY = (b.x - a.x) / segment;
            if (!track.isPointColliding(a.x + normalX, a.y + normalY)) {
                normalX = -normalX;
                normalY = -normalY;
            }
            const kind = EDGE_PROPS[Math.floor(random() * EDGE_PROPS.length)];
            const diameterPx = fromMetersToPixels(kind.diameterM);
            const offset = EDGE_MARGIN_PX + diameterPx / 2;
            const x = a.x + normalX * offset;
            const y = a.y + normalY * offset;
            if (!isClear(x, y, diameterPx / 2 + EDGE_MARGIN_PX / 2)) continue;
            // Model front (+Z) faces back towards the track.
            props.push({ model: kind.model, x, y, rotationY: quantizeRotation(Math.atan2(-normalX, -normalY)), diameterPx });
        }
    }

    // Trees: jittered grid over the track bounds plus a border.
    const { minX, minY, maxX, maxY } = geometry.bounds;
    for (let cellY = minY - TREE_BORDER_PX; cellY < maxY + TREE_BORDER_PX; cellY += TREE_CELL_PX) {
        for (let cellX = minX - TREE_BORDER_PX; cellX < maxX + TREE_BORDER_PX; cellX += TREE_CELL_PX) {
            if (random() < 0.4) continue;
            const kind = TREES[Math.floor(random() * TREES.length)];
            const diameterPx = fromMetersToPixels(kind.diameterM);
            const x = cellX + random() * TREE_CELL_PX;
            const y = cellY + random() * TREE_CELL_PX;
            const rotationY = quantizeRotation(random() * Math.PI * 2);
            if (isClear(x, y, diameterPx / 2 + EDGE_MARGIN_PX)) props.push({ model: kind.model, x, y, rotationY, diameterPx });
        }
    }
    return props;
};
