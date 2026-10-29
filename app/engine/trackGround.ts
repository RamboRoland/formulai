import * as THREE from 'three';

type Xy = { x: number; y: number };

// The track's asphalt as a flat mesh for the perspective views: the
// outline rings (TrackGeometry.rings) triangulated with the even-odd rule
// (a ring inside one other ring is a hole: the infield). Real geometry, so
// its edge is sharp at any distance. World (x, y) → three (X, Z), height `y`.
export function asphaltGeometry(rings: Xy[][], y: number): THREE.BufferGeometry {
    const clean = rings
        .map(r => r.length > 1 && same(r[0], r[r.length - 1]) ? r.slice(0, -1) : r)
        .filter(r => r.length >= 3);
    // Nesting depth: how many other rings contain this one. Even = asphalt
    // outline, odd = a hole in the smallest even ring around it.
    const depth = clean.map((r, i) => clean.filter((o, j) => j !== i && inside(r[0], o)).length);
    const area = clean.map(r => Math.abs(signedArea(r)));
    const holes = new Map<number, Xy[][]>();
    clean.forEach((r, i) => {
        if (depth[i] % 2 === 0) return;
        const parent = clean
            .map((o, j) => j)
            .filter(j => depth[j] === depth[i] - 1 && inside(r[0], clean[j]))
            .sort((p, q) => area[p] - area[q])[0];
        if (parent !== undefined) holes.set(parent, [...(holes.get(parent) ?? []), r]);
    });

    const positions: number[] = [];
    const indices: number[] = [];
    clean.forEach((outer, i) => {
        if (depth[i] % 2 !== 0) return;
        const inner = holes.get(i) ?? [];
        const v2 = (p: Xy) => new THREE.Vector2(p.x, p.y);
        // Indices refer to the outer ring's points, then each hole's.
        const tris = THREE.ShapeUtils.triangulateShape(outer.map(v2), inner.map(h => h.map(v2)));
        const pts = [outer, ...inner].flat();
        const base = positions.length / 3;
        for (const p of pts) positions.push(p.x, y, p.y);
        for (const [a, b, c] of tris) {
            // Facing up (+Y): the 2D cross product of (b − a, c − a) is negative
            // in world (x, y), since world y maps to three Z.
            const up = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x) < 0;
            indices.push(base + a, base + (up ? b : c), base + (up ? c : b));
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geometry;
}

// Shoelace area (sign = winding).
function signedArea(r: Xy[]): number {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
}

// Point in polygon (even-odd ray cast).
function inside(p: Xy, poly: Xy[]): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) c = !c;
    }
    return c;
}

function same(p: Xy, q: Xy): boolean {
    return Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
}
