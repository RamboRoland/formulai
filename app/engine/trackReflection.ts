import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Track } from '~/tracks/Track';
import { outlinePath } from '~/tracks/vector/outlineShape';

// Wet-road look: a mirror image of the scene (trees, props, cars, sky),
// laid over the track surface only (not the grass). A transparent plane just
// above the baked track texture shows a planar reflection, masked to the
// asphalt and stronger at grazing angles (like a real wet surface). Visual
// only. The scene is rendered a second time while it is visible, so it costs
// nothing at amount 0 (the plane is hidden).

const LIFT_PX = 2;
const MASK_MAX_SIZE = 2048;
const MAX_ALPHA = 0.85;

const vertexShader = /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vReflectionUv;
    varying vec2 vMaskUv;
    varying vec3 vWorldPosition;
    #include <fog_pars_vertex>
    void main() {
        vReflectionUv = textureMatrix * vec4(position, 1.0);
        vMaskUv = uv;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tMask;
    uniform float amount;
    varying vec4 vReflectionUv;
    varying vec2 vMaskUv;
    varying vec3 vWorldPosition;
    #include <fog_pars_fragment>
    void main() {
        vec3 reflection = texture2DProj(tDiffuse, vReflectionUv).rgb;
        float mask = texture2D(tMask, vMaskUv).a;
        vec3 toCamera = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - clamp(toCamera.y, 0.0, 1.0), 3.0);
        gl_FragColor = vec4(reflection, ${MAX_ALPHA} * amount * mask * (0.2 + 0.8 * fresnel));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef USE_FOG
            #include <fog_fragment>
            gl_FragColor.a *= 1.0 - fogFactor;
        #endif
    }
`;

export class TrackReflection {
    private readonly reflector: Reflector;
    private mask: THREE.CanvasTexture | null = null;

    public constructor(scene: THREE.Scene) {
        this.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
            shader: {
                name: 'TrackReflection',
                uniforms: THREE.UniformsUtils.merge([
                    THREE.UniformsLib.fog,
                    { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, tMask: { value: null }, amount: { value: 0 } },
                ]),
                vertexShader,
                fragmentShader,
            },
            textureWidth: 1024,
            textureHeight: 1024,
        });
        this.reflector.rotation.x = -Math.PI / 2;
        this.reflector.position.y = LIFT_PX;
        this.reflector.renderOrder = 1;
        this.reflector.visible = false;
        const material = this.reflector.material as THREE.ShaderMaterial;
        material.fog = true;
        material.transparent = true;
        material.depthWrite = false;
        // Wins over the coplanar track texture below without z-fighting.
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -4;
        scene.add(this.reflector);
    }

    // Covers the same box as the baked track texture; the mask is the asphalt.
    public bake(track: Track, minX: number, minY: number, widthPx: number, heightPx: number): void {
        const canvas = document.createElement('canvas');
        const texelsPerPx = MASK_MAX_SIZE / Math.max(widthPx, heightPx);
        canvas.width = Math.ceil(widthPx * texelsPerPx);
        canvas.height = Math.ceil(heightPx * texelsPerPx);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(texelsPerPx, texelsPerPx);
        ctx.translate(-minX, -minY);
        if (track.outline) {
            ctx.fillStyle = '#fff';
            ctx.fill(outlinePath(track.outline), 'evenodd');
        }
        // A new texture per track: a texture can't change size once uploaded.
        this.mask?.dispose();
        this.mask = new THREE.CanvasTexture(canvas);
        (this.reflector.material as THREE.ShaderMaterial).uniforms.tMask.value = this.mask;
        this.reflector.position.x = minX + widthPx / 2;
        this.reflector.position.z = minY + heightPx / 2;
        this.reflector.scale.set(widthPx, heightPx, 1);
    }

    // 0 = no reflections (and no extra render). `width`, `height`: the canvas size.
    public update(amount: number, show: boolean, width: number, height: number): void {
        this.reflector.visible = show && amount > 0;
        if (!this.reflector.visible) return;
        (this.reflector.material as THREE.ShaderMaterial).uniforms.amount.value = amount;
        const target = this.reflector.getRenderTarget();
        if (target.width !== width || target.height !== height) target.setSize(width, height);
    }

    public dispose(): void {
        this.reflector.dispose();
        this.mask?.dispose();
    }
}
