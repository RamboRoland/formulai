import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import { carPoint } from './carBody';
import type { CarRenderState } from './RenderSnapshot';

// Faint tyre marks behind every car: each wheel lays a thin dark ribbon
// (real geometry, sharp at any zoom), one piece every SEGMENT_PX it
// travels, each piece starting on the edge the last one ended (no overlap,
// no gap); it fades out over FADE_SECONDS in the shader. A ring buffer of MAX_SEGMENTS
// strips (full → the oldest are overwritten), one draw call. A trail breaks
// on a reset (spawnId) or a jump; another track clears them all. Visual only.

const MAX_SEGMENTS = 100000;
const SEGMENT_PX = fromMetersToPixels(0.5);
const MARK_WIDTH_PX = fromMetersToPixels(0.15);
const JUMP_PX = fromMetersToPixels(2); // a wheel moving further in one frame starts a new trail
const FADE_SECONDS = 30;
const OPACITY = 0.07;
const COLOR = new THREE.Color(0x1a1a1a);
// The wheels in carPoint units (half-length / half-width): FL, FR, RR, RL.
const WHEELS: [number, number][] = [[0.7, -0.8], [0.7, 0.8], [-0.7, 0.8], [-0.7, -0.8]];

type Point = { x: number; y: number };
// A wheel's trail so far: where it ends and its last piece's end edge
// (left, right; null = no piece yet).
type TrailEnd = { point: Point; edge: [Point, Point] | null };

const vertexShader = /* glsl */ `
    #include <fog_pars_vertex>
    uniform float uTime;
    attribute float aBirth;
    varying float vAlpha;
    void main() {
        vAlpha = ${OPACITY.toFixed(2)} * clamp(1.0 - (uTime - aBirth) / ${FADE_SECONDS.toFixed(1)}, 0.0, 1.0);
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

export class TireMarks {
    private readonly positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
    private readonly births = new Float32Array(MAX_SEGMENTS * 4).fill(-1e6);
    private readonly geometry = new THREE.BufferGeometry();
    private readonly material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
        // Over the asphalt and its paint (same height).
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: COLOR } }]),
    });
    private readonly mesh = new THREE.Mesh(this.geometry, this.material);
    private next = 0; // ring buffer slot the next strip goes in
    // Per car: its spawnId and each wheel's trail end (null = none).
    private readonly trails = new Map<string, { spawnId: number; wheels: (TrailEnd | null)[] }>();
    private track: unknown = null;
    private readonly epoch = performance.now() / 1000; // keeps uTime small (float precision)

    public constructor(scene: THREE.Scene) {
        const indices = new Uint32Array(MAX_SEGMENTS * 6);
        for (let s = 0; s < MAX_SEGMENTS; s++) indices.set([0, 1, 2, 0, 2, 3].map(i => s * 4 + i), s * 6);
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('aBirth', new THREE.BufferAttribute(this.births, 1).setUsage(THREE.DynamicDrawUsage));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        scene.add(this.mesh);
    }

    // One frame: extend every car's trails (`now` in seconds, as
    // performance.now). `track` = the track drawn; another one clears all.
    public update(cars: CarRenderState[], now: number, track: unknown): void {
        const time = now - this.epoch;
        this.material.uniforms.uTime.value = time;
        if (track !== this.track) {
            this.track = track;
            this.trails.clear();
            this.births.fill(-1e6);
            this.markDirty(0, MAX_SEGMENTS);
        }
        const first = this.next;
        let added = 0;
        const seen = new Set<string>();
        for (const car of cars) {
            seen.add(car.id);
            let trail = this.trails.get(car.id);
            if (!trail || trail.spawnId !== car.spawnId) {
                trail = { spawnId: car.spawnId, wheels: WHEELS.map(() => null) };
                this.trails.set(car.id, trail);
            }
            WHEELS.forEach(([fx, fy], w) => {
                const point = carPoint(car, fx, fy);
                const end = trail.wheels[w];
                const distance = end ? Math.hypot(point.x - end.point.x, point.y - end.point.y) : Infinity;
                if (distance > JUMP_PX) {
                    trail.wheels[w] = { point, edge: null };
                } else if (distance >= SEGMENT_PX) {
                    trail.wheels[w] = this.addSegment(end!, point, time);
                    added++;
                }
            });
        }
        for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
        if (added === 0) return;
        if (added >= MAX_SEGMENTS || first + added > MAX_SEGMENTS) this.markDirty(0, MAX_SEGMENTS);
        else this.markDirty(first, added);
    }

    // The ribbon's next piece, from the trail end to b, MARK_WIDTH_PX wide:
    // it starts on the edge the last piece ended (a new trail: straight
    // across at its start) and ends straight across at b. Returns the new end.
    private addSegment(end: TrailEnd, b: Point, time: number): TrailEnd {
        const a = end.point;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const half = MARK_WIDTH_PX / 2;
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
        this.births.fill(time, s * 4, s * 4 + 4);
        this.next = (s + 1) % MAX_SEGMENTS;
        return { point: b, edge };
    }

    // Upload `count` strips from `first` to the GPU this frame.
    private markDirty(first: number, count: number): void {
        const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        const birth = this.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
        position.clearUpdateRanges();
        birth.clearUpdateRanges();
        position.addUpdateRange(first * 12, count * 12);
        birth.addUpdateRange(first * 4, count * 4);
        position.needsUpdate = true;
        birth.needsUpdate = true;
    }
}
