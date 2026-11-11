import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import { carPoint } from './carBody';
import type { CarRenderState } from './RenderSnapshot';

// Tyre marks: only locked rear wheels mark the road (the frame's
// `locked`), as dark as each scrubs (`scrub` × LOCK_OPACITY: a lifted
// inner rear less; sliding without a lock only builds the racing line).
// Each wheel lays a ribbon as wide as its tyre (real geometry, sharp at
// any zoom), at the real wheel positions (the frame's `wheels`), one
// piece every SEGMENT_PX it travels, each piece starting on the edge the
// last one ended (no overlap, no gap) and blending from its darkness to
// the new one. Marks stay until another track; a ring buffer of
// MAX_SEGMENTS strips (full → the oldest are overwritten), one draw call.
// A trail breaks when the wheel stops marking, on a reset (spawnId) or a
// jump. Visual only.

const MAX_SEGMENTS = 100000;
const SEGMENT_PX = fromMetersToPixels(0.25);
const JUMP_PX = fromMetersToPixels(2); // a wheel moving further in one frame starts a new trail
const LOCK_OPACITY = 0.13; // × scrub (locked ~0.75 → ~0.1)
const REAR = [false, false, true, true]; // FL, FR, RR, RL
const COLOR = new THREE.Color(0x1a1a1a);

type Point = { x: number; y: number };
// A wheel's trail so far: where it ends, its last piece's end edge (left,
// right; null = no piece yet) and the darkness there.
type TrailEnd = { point: Point; edge: [Point, Point] | null; alpha: number };

const vertexShader = /* glsl */ `
    #include <fog_pars_vertex>
    attribute float aAlpha;
    varying float vAlpha;
    void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const fragmentShader = /* glsl */ `
    #include <fog_pars_fragment>
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
        if (vAlpha <= 0.0) discard;
        gl_FragColor = vec4(uColor, vAlpha);
        #include <fog_fragment>
    }
`;

// The wheels in carPoint units (half-length / half-width): FL, FR, RR, RL,
// and each one's tyre width (px), from the frame's `wheels`.
function wheelsOf(car: CarRenderState): { fx: number; fy: number; width: number }[] {
    const [frontTrack, rearTrack, wheelbase, frontWidth, rearWidth] = car.wheels;
    const fx = wheelbase / car.lengthPx;
    const front = frontTrack / car.widthPx;
    const rear = rearTrack / car.widthPx;
    return [
        { fx, fy: -front, width: frontWidth },
        { fx, fy: front, width: frontWidth },
        { fx: -fx, fy: rear, width: rearWidth },
        { fx: -fx, fy: -rear, width: rearWidth },
    ];
}

export class TireMarks {
    private readonly positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
    private readonly alphas = new Float32Array(MAX_SEGMENTS * 4);
    private readonly geometry = new THREE.BufferGeometry();
    private readonly material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
        // Over the asphalt and its paint (same height).
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: COLOR } }]),
    });
    private readonly mesh = new THREE.Mesh(this.geometry, this.material);
    private next = 0; // ring buffer slot the next strip goes in
    // Per car: its spawnId and each wheel's trail end (null = none).
    private readonly trails = new Map<string, { spawnId: number; wheels: (TrailEnd | null)[] }>();
    private track: unknown = null;

    public constructor(scene: THREE.Scene) {
        const indices = new Uint32Array(MAX_SEGMENTS * 6);
        for (let s = 0; s < MAX_SEGMENTS; s++) indices.set([0, 1, 2, 0, 2, 3].map(i => s * 4 + i), s * 6);
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        scene.add(this.mesh);
    }

    // One frame: extend every marking wheel's trail. `track` = the track
    // drawn; another one clears all.
    public update(cars: CarRenderState[], track: unknown): void {
        if (track !== this.track) {
            this.track = track;
            this.trails.clear();
            this.alphas.fill(0);
            this.markDirty(0, MAX_SEGMENTS);
        }
        const first = this.next;
        let added = 0;
        const seen = new Set<string>();
        for (const car of cars) {
            seen.add(car.id);
            let trail = this.trails.get(car.id);
            if (!trail || trail.spawnId !== car.spawnId) {
                trail = { spawnId: car.spawnId, wheels: car.scrub.map(() => null) };
                this.trails.set(car.id, trail);
            }
            wheelsOf(car).forEach(({ fx, fy, width }, w) => {
                const alpha = car.locked && REAR[w] ? car.scrub[w] * LOCK_OPACITY : 0;
                const point = carPoint(car, fx, fy);
                const end = trail.wheels[w];
                const distance = end ? Math.hypot(point.x - end.point.x, point.y - end.point.y) : Infinity;
                if (alpha <= 0 || distance > JUMP_PX) {
                    trail.wheels[w] = alpha > 0 ? { point, edge: null, alpha } : null;
                } else if (distance >= SEGMENT_PX) {
                    trail.wheels[w] = this.addSegment(end!, point, width, alpha);
                    added++;
                }
            });
        }
        for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
        if (added === 0) return;
        if (added >= MAX_SEGMENTS || first + added > MAX_SEGMENTS) this.markDirty(0, MAX_SEGMENTS);
        else this.markDirty(first, added);
    }

    // The ribbon's next piece, from the trail end to b, `width` wide and
    // from the end's darkness to `alpha`: it starts on the edge the last
    // piece ended (a new trail: straight across at its start) and ends
    // straight across at b. Returns the new end.
    private addSegment(end: TrailEnd, b: Point, width: number, alpha: number): TrailEnd {
        const a = end.point;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const half = width / 2;
        const sx = (-(b.y - a.y) / length) * half; // sideways
        const sy = ((b.x - a.x) / length) * half;
        const [left, right] = end.edge ?? [{ x: a.x + sx, y: a.y + sy }, { x: a.x - sx, y: a.y - sy }];
        const edge: [Point, Point] = [{ x: b.x + sx, y: b.y + sy }, { x: b.x - sx, y: b.y - sy }];
        const s = this.next;
        this.positions.set([
            left.x, 0, left.y,
            edge[0].x, 0, edge[0].y,
            edge[1].x, 0, edge[1].y,
            right.x, 0, right.y,
        ], s * 12);
        this.alphas.set([end.alpha, alpha, alpha, end.alpha], s * 4);
        this.next = (s + 1) % MAX_SEGMENTS;
        return { point: b, edge, alpha };
    }

    // Upload `count` strips from `first` to the GPU this frame.
    private markDirty(first: number, count: number): void {
        const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        const alpha = this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
        position.clearUpdateRanges();
        alpha.clearUpdateRanges();
        position.addUpdateRange(first * 12, count * 12);
        alpha.addUpdateRange(first * 4, count * 4);
        position.needsUpdate = true;
        alpha.needsUpdate = true;
    }
}
