import * as THREE from 'three';
import type { PaintQuad, PaintStrip } from '~/tracks/Track';

// The track's paint for the perspective views: its lines (Track.paintStrips)
// as flat triangle strips in `stripColor`, and coloured quads
// (Track.paintQuads: the start / finish squares). Real geometry, so it stays
// sharp at any distance and angle. Colours per vertex (material
// vertexColors). World (x, y) → three (X, Z), at height `y`.

// A sharp corner's mitre is capped at this many times the strip width.
const MAX_MITRE = 4;

export function paintGeometry(strips: PaintStrip[], quads: PaintQuad[], y: number, stripColor: string): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (const { line, closed, a, b } of strips) {
        const pts = closed && line.length > 2 && same(line[0], line[line.length - 1]) ? line.slice(0, -1) : line;
        const n = pts.length;
        if (n < 2) continue;
        const base = positions.length / 3;
        for (let i = 0; i < n; i++) {
            // Left normals (−dy, dx) of the segments before and after point i.
            const before = i > 0 ? normal(pts[i - 1], pts[i]) : closed ? normal(pts[n - 1], pts[0]) : null;
            const after = i < n - 1 ? normal(pts[i], pts[i + 1]) : closed ? normal(pts[n - 1], pts[0]) : null;
            const n1 = before ?? after!, n2 = after ?? before!;
            // Mitre: the average normal, longer so the strip keeps its width.
            let mx = n1.x + n2.x, my = n1.y + n2.y;
            const ml = Math.hypot(mx, my);
            if (ml < 1e-9) { mx = n1.x; my = n1.y; } else { mx /= ml; my /= ml; }
            const scale = Math.min(MAX_MITRE, 1 / Math.max(1e-3, mx * n1.x + my * n1.y));
            const p = pts[i];
            positions.push(p.x + mx * a * scale, y, p.y + my * a * scale);
            positions.push(p.x + mx * b * scale, y, p.y + my * b * scale);
        }
        color.set(stripColor);
        for (let i = 0; i < 2 * n; i++) colors.push(color.r, color.g, color.b);
        const segments = closed ? n : n - 1;
        for (let i = 0; i < segments; i++) {
            const j = (i + 1) % n;
            const ia = base + 2 * i, ib = ia + 1, ja = base + 2 * j, jb = ja + 1;
            // Faces up (+Y): verified in the browser.
            indices.push(ia, ib, ja, ib, jb, ja);
        }
    }
    for (const { corners: [p, q, r, t], color: c } of quads) {
        const base = positions.length / 3;
        for (const v of [p, q, r, t]) positions.push(v.x, y, v.y);
        color.set(c);
        for (let i = 0; i < 4; i++) colors.push(color.r, color.g, color.b);
        // Facing up (+Y) whichever order the corners come in: negative 2D cross
        // product in world (x, y) (world y → three Z), like the strips.
        const up = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0;
        if (up) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    // Flat on the ground: every normal points up (lit like the asphalt).
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geometry;
}

function normal(p: { x: number; y: number }, q: { x: number; y: number }): { x: number; y: number } {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
}

function same(p: { x: number; y: number }, q: { x: number; y: number }): boolean {
    return Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
}
