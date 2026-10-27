import * as THREE from 'three';
import type { CarRenderState } from './RenderSnapshot';

// See-through mode: a "virtual hole" around each car on screen. Patched
// materials (the props) discard their pixels inside the hole when they are
// in front of the car, with a dithered soft rim. Main pass only — props
// still cast their shadows.

const MAX_HOLES = 8;
const HOLE_RADIUS = 1.4;     // × car length, in the world around the car
const HOLE_HEIGHT = 0.4;     // × car width: aim point above the ground
const SOFT_EDGE = 0.25;      // outer share of the radius that dithers out
const MIN_RADIUS_PX = 40;    // far-away cars still get a usable hole

const HOLE_SHADER = /* glsl */ `
uniform int holeCount;
uniform vec4 holes[${MAX_HOLES}]; // xy: centre (buffer px), z: car depth (0–1), w: radius (px)
`;
const HOLE_DISCARD = /* glsl */ `
for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (i >= holeCount) break;
    vec4 hole = holes[i];
    float holeDistance = distance(gl_FragCoord.xy, hole.xy);
    if (gl_FragCoord.z < hole.z && holeDistance < hole.w) {
        float rim = smoothstep(hole.w * ${(1 - SOFT_EDGE).toFixed(2)}, hole.w, holeDistance);
        float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        if (noise >= rim) discard;
    }
}
`;

export class SeeThroughHoles {
    public enabled = false;
    private readonly uniforms = {
        holeCount: { value: 0 },
        holes: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) },
    };
    private readonly patched = new WeakSet<THREE.Material>();
    private readonly point = new THREE.Vector3();
    private readonly right = new THREE.Vector3();
    private readonly bufferSize = new THREE.Vector2();

    // Lets every mesh material under `object` be cut by the holes (once each).
    public patch(object: THREE.Object3D): void {
        object.traverse(obj => {
            const material = (obj as THREE.Mesh).material as THREE.Material | undefined;
            if (!material || Array.isArray(material) || this.patched.has(material)) return;
            this.patched.add(material);
            material.onBeforeCompile = shader => {
                Object.assign(shader.uniforms, this.uniforms);
                shader.fragmentShader = HOLE_SHADER + shader.fragmentShader.replace(
                    '#include <clipping_planes_fragment>',
                    `#include <clipping_planes_fragment>\n${HOLE_DISCARD}`,
                );
            };
            material.needsUpdate = true;
        });
    }

    // Hole per car for this frame's camera (call after the camera is placed).
    public update(cars: CarRenderState[], camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
        if (!this.enabled) {
            this.uniforms.holeCount.value = 0;
            return;
        }
        camera.updateMatrixWorld();
        renderer.getDrawingBufferSize(this.bufferSize);
        this.right.setFromMatrixColumn(camera.matrixWorld, 0);
        let count = 0;
        for (const car of cars) {
            if (count === MAX_HOLES) break;
            this.point.set(car.x + car.widthPx / 2, car.widthPx * HOLE_HEIGHT, car.y + car.lengthPx / 2).project(camera);
            if (this.point.z < -1 || this.point.z > 1) continue; // behind the camera / past far
            const x = (this.point.x * 0.5 + 0.5) * this.bufferSize.x;
            const y = (this.point.y * 0.5 + 0.5) * this.bufferSize.y;
            const depth = this.point.z * 0.5 + 0.5;
            // Radius: a world-space distance beside the car, projected.
            this.point.set(car.x + car.widthPx / 2, car.widthPx * HOLE_HEIGHT, car.y + car.lengthPx / 2)
                .addScaledVector(this.right, car.lengthPx * HOLE_RADIUS)
                .project(camera);
            const edgeX = (this.point.x * 0.5 + 0.5) * this.bufferSize.x;
            const edgeY = (this.point.y * 0.5 + 0.5) * this.bufferSize.y;
            this.uniforms.holes.value[count++].set(x, y, depth, Math.max(MIN_RADIUS_PX, Math.hypot(edgeX - x, edgeY - y)));
        }
        this.uniforms.holeCount.value = count;
    }
}
