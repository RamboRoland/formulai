import type { Vector } from '~/components/Vector';

// Output of `flattenCenterline`. Each flat point carries everything downstream
// consumers (offset, tessellate, collision, ray math) need to compute without
// re-walking the bezier curves.
export type FlatPoint = {
    pos: Vector;         // world-space centerline point
    tangent: Vector;     // UNIT vector along centerline direction of travel
    halfWidth: number;   // interpolated track half-width at this point (world px)
    arcLength: number;   // cumulative distance along centerline from anchors[0]
    isAnchor: boolean;   // true if this flat point sits exactly on an anchor
    segmentIndex: number;// index of the (A→B) segment this point belongs to; anchor points
                        // belong to the OUTGOING segment (except the loop's final flat point
                        // which has no outgoing segment and gets the last-segment index).
};
