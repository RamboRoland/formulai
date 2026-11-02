import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';

// Rain in the 3D world: streaks falling through a box around the view
// centre. Position, fall and wrap-around all happen in the vertex shader, so
// a frame costs one draw call. Visual only. Intensity sets how many streaks
// are drawn (0 = none, 1 = skyfall). The box grows with the view (zoomed out
// = more ground to cover; streaks grow with it) and the rain fades out
// towards its edges, so the box is never seen.

const MAX_DROPS = 100000;
const MIN_BOX_SIZE_PX = fromMetersToPixels(80);
const MAX_BOX_SIZE_PX = fromMetersToPixels(600);
// The box is this much wider than the view reach it has to cover.
const BOX_PER_REACH = 2.6;
// At the minimum box size.
const BOX_HEIGHT_PX = fromMetersToPixels(40);
const FALL_SPEED_PX = fromMetersToPixels(18);
const STREAK_LENGTH_PX = fromMetersToPixels(1.5);

// Drops are stored as unit-box positions and scaled to the box in the shader.
const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uSize;
    uniform vec2 uCenter;
    attribute float aTail;
    varying float vAlpha;
    void main() {
        float scale = uSize / ${MIN_BOX_SIZE_PX.toFixed(1)};
        float height = ${BOX_HEIGHT_PX.toFixed(1)} * scale;
        vec3 p;
        vec2 offset = (fract(position.xz - uCenter / uSize + 0.5) - 0.5) * uSize;
        float fall = fract(position.y - uTime * ${FALL_SPEED_PX.toFixed(1)} * scale / height);
        p.xz = uCenter + offset;
        p.y = fall * height + aTail * ${STREAK_LENGTH_PX.toFixed(1)} * scale;
        float edge = max(abs(offset.x), abs(offset.y)) / (uSize * 0.5);
        float fade = (1.0 - smoothstep(0.5, 1.0, edge)) * (1.0 - smoothstep(0.85, 1.0, fall));
        vAlpha = 0.6 * (1.0 - aTail) * fade;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    varying float vAlpha;
    void main() {
        gl_FragColor = vec4(0.75, 0.82, 0.95, vAlpha);
    }
`;

export class Rain {
    private readonly material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uSize: { value: MIN_BOX_SIZE_PX }, uCenter: { value: new THREE.Vector2() } },
    });
    private readonly geometry = new THREE.BufferGeometry();
    private readonly lines = new THREE.LineSegments(this.geometry, this.material);

    public constructor(scene: THREE.Scene) {
        // Two vertices per drop: head (aTail 0) and tail (aTail 1) at the same spot.
        const positions = new Float32Array(MAX_DROPS * 6);
        const tails = new Float32Array(MAX_DROPS * 2);
        for (let drop = 0; drop < MAX_DROPS; drop++) {
            const [x, y, z] = [Math.random(), Math.random(), Math.random()];
            positions.set([x, y, z, x, y, z], drop * 6);
            tails[drop * 2 + 1] = 1;
        }
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
        this.lines.frustumCulled = false;
        this.lines.visible = false;
        scene.add(this.lines);
    }

    // 0–1.
    public set intensity(amount: number) {
        const drops = Math.round(amount * MAX_DROPS);
        this.lines.visible = drops > 0;
        this.geometry.setDrawRange(0, drops * 2);
    }

    // `seconds`: clock for the fall. (centerX, centerZ): the box follows this
    // and covers `reachPx` around it.
    public update(seconds: number, centerX: number, centerZ: number, reachPx: number): void {
        this.material.uniforms.uTime.value = seconds % 1000;
        this.material.uniforms.uSize.value = Math.min(Math.max(reachPx * BOX_PER_REACH, MIN_BOX_SIZE_PX), MAX_BOX_SIZE_PX);
        this.material.uniforms.uCenter.value.set(centerX, centerZ);
    }

    public dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}
