import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import { carPoint } from './carBody';
import type { DrawTrack } from './DrawTrack';
import type { CarRenderState } from './RenderSnapshot';
import { wheelsOf } from './tireMarks';
import { asphaltGeometry } from './trackGround';

// The racing line: the asphalt beside where the tyres run darkens over time
// (rubber dust and marbles thrown off the line), the line itself stays
// clean. Every wheel lays rubber into a texture over the track (additive,
// a tyre-wide ribbon per frame, each piece starting on the edge the last
// one ended: no overlap, no gap), BASE_RUBBER + its `scrub` per pass —
// corners and braking zones build fastest, straights slowly. Drawn on the
// asphalt mesh itself (exact outline, every camera mode): darker with the
// rubber nearby (`near`, a wide Gaussian blur), cleared by the rubber right
// there (`on`, a narrow Gaussian blur: each wheel track its own clean line,
// the strip between a kart's wheels darker):
// MAX_DARK × (1 − e^(−near / SATURATE)) × (1 − LINE_CLEAN × smoothstep(
// CLEAR_FROM, CLEAR_FULL, on / near)) — the ratio, not the amount: the line
// keeps its width (the wheel tracks) however much rubber builds. Starts
// clean on every page view and another track. Visual only.

const TEXEL_PX = fromMetersToPixels(0.1);
const MAX_TEXTURE = 4096;
const MARGIN_PX = fromMetersToPixels(2);
const BASE_RUBBER = 0.02;  // a rolling tyre, per pass (straights)
const GAIN = 1;            // × (BASE_RUBBER + scrub) per pass
const SATURATE = 7;        // corners (~0.22 per pass): ~95 % after 100 laps
// The line itself stays clean where `on` / `near` (the rubber right there
// against around it) is above CLEAR_FROM, fully above CLEAR_FULL.
const CLEAR_FROM = 0.1;
const CLEAR_FULL = 3;
const LINE_CLEAN = 0.4;   // at most this share of the darkness is cleared: a soft line, not a light stripe
// The blurs (Gaussian, separable), redone every BLUR_SECONDS while rubber
// is laid. `on`: narrow, at the rubber's own texels (smooth edges, the two
// wheel tracks ~0.95 m apart stay apart). `near` (the spread): wide, in
// BLUR_TEXEL_PX texels (read from the rubber's mip 1).
const ON_SIGMA_PX = fromMetersToPixels(0.25);
const ON_TAPS = 8;         // each side: 3σ at TEXEL_PX
const BLUR_TEXEL_PX = fromMetersToPixels(0.25);
const NEAR_SIGMA_PX = fromMetersToPixels(1.2);
const NEAR_TAPS = 15;      // each side: 3σ at BLUR_TEXEL_PX
const BLUR_SECONDS = 0.25;
const MAX_DARK = 0.5;
const COLOR = new THREE.Color(0x101010);
const MIN_PIECE_PX = fromMetersToPixels(0.05);
const JUMP_PX = fromMetersToPixels(2); // a wheel moving further in one frame starts a new trail
const MAX_PIECES = 512;    // per frame

type Point = { x: number; y: number };
type TrailEnd = { point: Point; edge: [Point, Point] | null };

const layVertex = /* glsl */ `
    attribute float aRubber;
    varying float vRubber;
    void main() {
        vRubber = aRubber;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const layFragment = /* glsl */ `
    varying float vRubber;
    void main() { gl_FragColor = vec4(vRubber, 0.0, 0.0, 1.0); }
`;

// One blur pass over the whole target (a full-screen quad), TAPS each side.
// The first pass reads the rubber (`on`: mip 0, `near`: mip 1), the second
// the first's result.
const blurVertex = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;
const blurFragment = /* glsl */ `
    uniform sampler2D tSource;
    uniform vec2 uStep;   // one blur texel along the pass, in uv
    uniform float uSigma; // in blur texels
    uniform float uLod;   // the source's mip to read
    varying vec2 vUv;
    void main() {
        float sum = 0.0;
        float weights = 0.0;
        for (int i = -TAPS; i <= TAPS; i++) {
            float d = float(i);
            float w = exp(-0.5 * d * d / (uSigma * uSigma));
            sum += textureLod(tSource, vUv + uStep * d, uLod).r * w;
            weights += w;
        }
        gl_FragColor = vec4(sum / weights, 0.0, 0.0, 1.0);
    }
`;

const blurMaterial = (taps: number, sigma: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
    vertexShader: blurVertex,
    fragmentShader: blurFragment,
    defines: { TAPS: taps },
    depthTest: false,
    depthWrite: false,
    uniforms: { tSource: { value: null }, uStep: { value: new THREE.Vector2() }, uSigma: { value: sigma }, uLod: { value: 0 } },
});

const showVertex = /* glsl */ `
    #include <fog_pars_vertex>
    uniform vec4 uBox; // minX, minY, width, height (world px)
    varying vec2 vUv;
    void main() {
        // The laying camera's bottom row is the box's far edge (maxY): flip v.
        vUv = (position.xz - uBox.xy) / uBox.zw;
        vUv.y = 1.0 - vUv.y;
        vec4 mvPosition = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;
const showFragment = /* glsl */ `
    #include <fog_pars_fragment>
    uniform sampler2D tOn;
    uniform sampler2D tNear;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
        float on = texture2D(tOn, vUv).r;
        float near = texture2D(tNear, vUv).r;
        float alpha = ${MAX_DARK.toFixed(2)} * (1.0 - exp(-near / ${SATURATE.toFixed(1)})) * (1.0 - ${LINE_CLEAN.toFixed(2)} * smoothstep(${CLEAR_FROM.toFixed(2)}, ${CLEAR_FULL.toFixed(2)}, on / max(near, 1e-4)));
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <fog_fragment>
    }
`;

export class RubberLine {
    // Laying: this frame's ribbon pieces, drawn into `target` (rubber in red).
    private readonly positions = new Float32Array(MAX_PIECES * 4 * 3);
    private readonly amounts = new Float32Array(MAX_PIECES * 4);
    private readonly pieces = new THREE.BufferGeometry();
    private readonly layScene = new THREE.Scene();
    private readonly layCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    private target: THREE.WebGLRenderTarget | null = null;
    // Blurring: the rubber → [across (first pass), result (both passes)],
    // for `on` and for `near`.
    private readonly onBlur = blurMaterial(ON_TAPS, ON_SIGMA_PX / TEXEL_PX);
    private readonly nearBlur = blurMaterial(NEAR_TAPS, NEAR_SIGMA_PX / BLUR_TEXEL_PX);
    private readonly blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    private readonly blurScene = new THREE.Scene();
    private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private on: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
    private near: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
    private blurDue = false;   // rubber laid since the last blur
    private lastBlur = -Infinity;
    // Showing: the asphalt, darker beside the line.
    private readonly material = new THREE.ShaderMaterial({
        vertexShader: showVertex,
        fragmentShader: showFragment,
        transparent: true,
        depthWrite: false,
        fog: true,
        // Over the asphalt (same height), under the tyre marks.
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            tOn: { value: null }, tNear: { value: null }, uBox: { value: new THREE.Vector4() }, uColor: { value: COLOR },
        }]),
    });
    private readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    private readonly trails = new Map<string, { spawnId: number; wheels: (TrailEnd | null)[] }>();
    private track: DrawTrack | null = null;
    private clear = false;

    public constructor(scene: THREE.Scene) {
        const indices = new Uint32Array(MAX_PIECES * 6);
        for (let s = 0; s < MAX_PIECES; s++) indices.set([0, 1, 2, 0, 2, 3].map(i => s * 4 + i), s * 6);
        this.pieces.setIndex(new THREE.BufferAttribute(indices, 1));
        this.pieces.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.pieces.setAttribute('aRubber', new THREE.BufferAttribute(this.amounts, 1).setUsage(THREE.DynamicDrawUsage));
        const lay = new THREE.Mesh(this.pieces, new THREE.ShaderMaterial({
            vertexShader: layVertex,
            fragmentShader: layFragment,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        }));
        lay.frustumCulled = false;
        this.layScene.add(lay);
        this.blurQuad.frustumCulled = false;
        this.blurScene.add(this.blurQuad);
        // Looking straight down: world (x, y) → three (X, Z).
        this.layCamera.position.y = 5;
        this.layCamera.up.set(0, 0, -1);
        this.layCamera.lookAt(0, 0, 0);
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 0.5;
        scene.add(this.mesh);
    }

    // One frame: lay every wheel's rubber since the last frame. Another
    // track starts clean.
    public update(cars: CarRenderState[], track: DrawTrack, renderer: THREE.WebGLRenderer): void {
        if (track !== this.track) this.setTrack(track);
        if (!this.target) return;
        let count = 0;
        const seen = new Set<string>();
        for (const car of cars) {
            seen.add(car.id);
            let trail = this.trails.get(car.id);
            if (!trail || trail.spawnId !== car.spawnId) {
                trail = { spawnId: car.spawnId, wheels: car.scrub.map(() => null) };
                this.trails.set(car.id, trail);
            }
            wheelsOf(car).forEach(({ fx, fy, width }, w) => {
                const point = carPoint(car, fx, fy);
                const end = trail.wheels[w];
                const distance = end ? Math.hypot(point.x - end.point.x, point.y - end.point.y) : Infinity;
                if (distance > JUMP_PX) {
                    trail.wheels[w] = { point, edge: null };
                } else if (distance >= MIN_PIECE_PX && count < MAX_PIECES) {
                    trail.wheels[w] = this.addPiece(count++, end!, point, width, (BASE_RUBBER + car.scrub[w]) * GAIN);
                }
            });
        }
        for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
        if (count > 0 || this.clear) this.lay(count, renderer);
        const now = performance.now() / 1000;
        if (this.blurDue && now - this.lastBlur >= BLUR_SECONDS) {
            this.lastBlur = now;
            this.blurDue = false;
            this.blur(renderer);
        }
    }

    // Draw this frame's `count` pieces into the rubber (cleared first on
    // another track).
    private lay(count: number, renderer: THREE.WebGLRenderer): void {
        this.blurDue = true;
        this.pieces.setDrawRange(0, count * 6);
        (this.pieces.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.pieces.getAttribute('aRubber') as THREE.BufferAttribute).needsUpdate = true;
        const before = renderer.getRenderTarget();
        const autoClear = renderer.autoClear;
        renderer.setRenderTarget(this.target);
        if (this.clear) {
            const color = renderer.getClearColor(new THREE.Color());
            const alpha = renderer.getClearAlpha();
            renderer.setClearColor(0x000000, 0);
            renderer.clear();
            renderer.setClearColor(color, alpha);
            this.clear = false;
        }
        renderer.autoClear = false;
        renderer.render(this.layScene, this.layCamera);
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(before);
    }

    // Both blurs, `on` and `near` (each two Gaussian passes).
    private blur(renderer: THREE.WebGLRenderer): void {
        const before = renderer.getRenderTarget();
        this.blurInto(renderer, this.onBlur, this.on!, 0);
        this.blurInto(renderer, this.nearBlur, this.near!, 1);
        renderer.setRenderTarget(before);
    }

    // One blur: the rubber (its mip `lod`) across x into [0], then that
    // along y into [1].
    private blurInto(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, [across, result]: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget], lod: number): void {
        const u = material.uniforms;
        this.blurQuad.material = material;
        u.tSource.value = this.target!.texture;
        u.uLod.value = lod;
        (u.uStep.value as THREE.Vector2).set(1 / across.width, 0);
        renderer.setRenderTarget(across);
        renderer.render(this.blurScene, this.blurCamera);
        u.tSource.value = across.texture;
        u.uLod.value = 0;
        (u.uStep.value as THREE.Vector2).set(0, 1 / result.height);
        renderer.setRenderTarget(result);
        renderer.render(this.blurScene, this.blurCamera);
    }

    // A new texture over the track's bounds (TEXEL_PX per texel, at most
    // MAX_TEXTURE a side) and the asphalt mesh to show it on.
    private setTrack(track: DrawTrack): void {
        this.track = track;
        this.trails.clear();
        const minX = track.bounds.minX - MARGIN_PX;
        const minY = track.bounds.minY - MARGIN_PX;
        const width = track.bounds.maxX - track.bounds.minX + MARGIN_PX * 2;
        const height = track.bounds.maxY - track.bounds.minY + MARGIN_PX * 2;
        const texelsPerPx = Math.min(1 / TEXEL_PX, MAX_TEXTURE / Math.max(width, height));
        this.target?.dispose();
        this.target = new THREE.WebGLRenderTarget(Math.ceil(width * texelsPerPx), Math.ceil(height * texelsPerPx), {
            format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false,
            // Mipmaps (regenerated after each laying render): the first blur
            // pass reads mip 1.
            generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        });
        this.clear = true;
        this.layCamera.left = minX;
        this.layCamera.right = minX + width;
        // Looking down with up = −Z: screen top = world minY.
        this.layCamera.top = -minY;
        this.layCamera.bottom = -(minY + height);
        this.layCamera.position.set(0, 5, 0);
        this.layCamera.updateProjectionMatrix();
        const pair = (w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] => [0, 1].map(() => new THREE.WebGLRenderTarget(w, h, {
            format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        })) as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
        for (const t of [...this.on ?? [], ...this.near ?? []]) t.dispose();
        this.on = pair(this.target.width, this.target.height);
        this.near = pair(Math.ceil(width / BLUR_TEXEL_PX), Math.ceil(height / BLUR_TEXEL_PX));
        this.material.uniforms.tOn.value = this.on[1].texture;
        this.material.uniforms.tNear.value = this.near[1].texture;
        (this.material.uniforms.uBox.value as THREE.Vector4).set(minX, minY, width, height);
        this.mesh.geometry.dispose();
        this.mesh.geometry = asphaltGeometry(track.rings, 0);
        this.mesh.visible = true;
    }

    // Piece `s`: from the trail end to b, `width` wide, `rubber` on all of
    // it; starts on the edge the last piece ended. Returns the new end.
    private addPiece(s: number, end: TrailEnd, b: Point, width: number, rubber: number): TrailEnd {
        const a = end.point;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const half = width / 2;
        const sx = (-(b.y - a.y) / length) * half;
        const sy = ((b.x - a.x) / length) * half;
        const [left, right] = end.edge ?? [{ x: a.x + sx, y: a.y + sy }, { x: a.x - sx, y: a.y - sy }];
        const edge: [Point, Point] = [{ x: b.x + sx, y: b.y + sy }, { x: b.x - sx, y: b.y - sy }];
        this.positions.set([
            left.x, 0, left.y,
            edge[0].x, 0, edge[0].y,
            edge[1].x, 0, edge[1].y,
            right.x, 0, right.y,
        ], s * 12);
        this.amounts.fill(rubber, s * 4, s * 4 + 4);
        return { point: b, edge };
    }

    public dispose(): void {
        this.target?.dispose();
        for (const t of [...this.on ?? [], ...this.near ?? []]) t.dispose();
    }
}
