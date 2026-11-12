import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import { carPoint } from './carBody';
import type { DrawTrack } from './DrawTrack';
import type { CarRenderState } from './RenderSnapshot';
import { wheelsOf } from './tireMarks';
import { asphaltGeometry } from './trackGround';

// The racing line: laid rubber darkens the asphalt UNDER the tyres, and
// marbles (loose rubber) darken it beside them (plan
// `.claude/tasks/marbles.md`). Every wheel lays rubber into a texture over
// the track (additive, a tyre-wide ribbon per frame, each piece starting on
// the edge the last one ended: no overlap, no gap), BASE_RUBBER + its
// `scrub` per pass — corners and braking zones build fastest, straights
// slowly; bonded into the asphalt, never picked up. Drawn on the asphalt
// mesh itself (exact outline, every camera mode), two layers:
// RUBBER_DARK × (1 − e^(−on / RUBBER_SATURATE)) (`on` = the rubber, a
// narrow Gaussian blur: smooth edges, a kart's two wheel tracks) and over
// it MAX_DARK × (1 − e^(−dust / SATURATE)). Starts clean on every page view
// and another track. Visual only.
// `dust` (stored): marbles, rubber sheared off the tyres and thrown to the
// OUTSIDE of the turn.
// Every piece lays its scrub (the rubber's amount, without BASE_RUBBER:
// rolling makes none) as a Gaussian ribbon on the OUTSIDE of the turn only,
// starting `start` outside the tyre's edge, further and wider the faster
// and more sideways the corner (a ridge at 40 km/h, a band to ~1.7 m at
// 100 km/h); s = the share of the scrub that is sideways (the wheel path's
// sideways acceleration ÷ SIDE_FULL_G). Below SIDE_FROM (straight braking)
// away from the kart's centre, close by. A locked rear (the frame's
// `locked`) throws none (no rotation): a share of what it scrubs off trails
// inside its own skid (shavings; LOCK_TRAIL_SHORT → LOCK_TRAIL_LONG as the
// skid grows), the rest it carries and drops as one tyre-sized clump
// (Gaussian, CLUMP_ACROSS_PX × CLUMP_ALONG_PX along the skid) where the
// lock ends.
// A tyre driving over dust picks some up: `dust` × (1 − pickup) under a
// soft brush (Gaussian, BRUSH_SIGMA_PX) on its wheel track, pickup =
// PICKUP_BASE + PICKUP_SCRUB × scrub per pass — and carries it (`carry`,
// one texel per wheel, on the GPU like the dust): every piece sheds
// 1 − e^(−metres × (1 / SHED_ROLL_M + scrub / SHED_SCRUB_M)) of it into its
// marble ribbon (straights clean badly, corners scrub it off); a locked
// tyre sheds none. Nothing is lost.

const TEXEL_PX = fromMetersToPixels(0.05); // tyre-wide lines (0.11–0.18 m)
const MAX_TEXTURE = 4096;
const MARGIN_PX = fromMetersToPixels(2);
const BASE_RUBBER = 0.02;  // a rolling tyre, per pass (straights)
const GAIN = 1;            // × (BASE_RUBBER + scrub) per pass
const SATURATE = 7;        // marbles
// Laid rubber: `on` ≈ the amount (the blur only smooths the edges); a
// corner (~0.22 per pass) × ~2 passes a lap (front + rear) → ~95 % after
// 100 laps, a straight (0.02) ~23 %.
const RUBBER_SATURATE = 15;
const RUBBER_DARK = 0.4;
// Share of the dust a tyre picks up per pass, in the middle of its brush:
// rolling 3 %, cornering (scrub ~0.2) ~7 %, locked (~0.75) ~18 %.
const PICKUP_BASE = 0.03;
const PICKUP_SCRUB = 0.2;
const PICKUP_MAX = 0.5;
const BRUSH_SIGMA_PX = fromMetersToPixels(0.15); // 0.25 looked too wide
const BRUSH_HALF_PX = BRUSH_SIGMA_PX * 3;
// Marbles (estimates, Robin's notes): `start` = their near edge (2σ) outside
// the tyre's edge, σ their scatter. Close by (straight braking) and
// the outside of a corner at SLOW_KMH → FAST_KMH (linear, held outside).
const PX_PER_M = fromMetersToPixels(1);
const NEAR_START_PX = fromMetersToPixels(0.15);
const NEAR_SCATTER_PX = fromMetersToPixels(0.08);
const FAST_START_PX = fromMetersToPixels(0.4);
const FAST_SCATTER_PX = fromMetersToPixels(0.3);
const SLOW_KMH = 40;
const FAST_KMH = 100;
const SIDE_FULL_G = 1.2;       // sideways acceleration at which all the scrub is sideways
const SIDE_SMOOTH_SECONDS = 0.15; // the path's turn, smoothed (viewer frames come 20/s)
const SIDE_FROM = 0.1;         // below: no clear outside of a turn
// Lock debris (Robin's notes): ~30 % shavings along the skid, ~70 % a clump
// at the release point; short skids keep almost all in the clump, long ones
// shed ~half along the way.
const LOCK_TRAIL_SHORT = 0.1;  // share laid along the skid, below SKID_SHORT_M
const LOCK_TRAIL_LONG = 0.45;  // above SKID_LONG_M (smoothstep between)
const SKID_SHORT_M = 0.5;
const SKID_LONG_M = 2.5;
const CLUMP_ACROSS_PX = fromMetersToPixels(0.09);
const CLUMP_ALONG_PX = fromMetersToPixels(0.1);
const MAX_CLUMPS = 64;     // per frame
// Shedding what a tyre carries (Robin's notes: 63 % after 100–200 m on
// rental tyres, mostly in corners): ~150 m on a mixed lap. Estimates.
const SHED_ROLL_M = 400;
const SHED_SCRUB_M = 15;
const MAX_SLOTS = 256;     // carry texels: 64 karts × 4 wheels
const M2_PER_PX2 = 1 / (PX_PER_M * PX_PER_M); // the carry is kept in m² (half floats)
// The blur (Gaussian, separable), redone every BLUR_SECONDS while rubber
// is laid: `on`, ON_SIGMA texels of the rubber's own (smooth edges only:
// each wheel's line stays tyre-wide).
const ON_SIGMA = 1;
const ON_TAPS = 3;         // each side: 3σ
const BLUR_SECONDS = 0.25;
const MAX_DARK = 0.5;
const COLOR = new THREE.Color(0x101010);
const MIN_PIECE_PX = fromMetersToPixels(0.05);
const JUMP_PX = fromMetersToPixels(2); // a wheel moving further in one frame starts a new trail
const MAX_PIECES = 512;    // per frame

type Point = { x: number; y: number };
type Edge = [Point, Point];
// `edge`: the tyre ribbon's last edge, `brush`: the pick-up brush's,
// `marbles`: the marble ribbon's and its side (+1 / −1: the path's ±
// normal; + = the car's right going forward; 0 = the skid's shavings),
// `carried`: rubber a locked wheel carries (amount × px², dropped as a
// clump), `skid`: how far it has slid locked (px). `time`
// (s) and `dir` (unit) at `point`, `side`: the smoothed sideways
// acceleration (px/s², + = towards the path's + normal).
type TrailEnd = {
    point: Point; edge: Edge | null; brush: Edge | null; marbles: Edge | null; marbleSide: number; carried: number; skid: number;
    time: number; dir: Point | null; side: number;
};
type TargetPair = [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];

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
// Picking up: `dust` × (1 − pickup × Gaussian across the brush) under the
// brush (multiplying blend); marbles: + amount × the Gaussian (additive).
// aAcross: −1 / +1 on the ribbon's edges (3σ).
const acrossVertex = /* glsl */ `
    attribute float aAmount;
    attribute float aAcross;
    varying float vAmount;
    varying float vAcross;
    void main() {
        vAmount = aAmount;
        vAcross = aAcross;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const pickupFragment = /* glsl */ `
    varying float vAmount;
    varying float vAcross;
    void main() {
        float sigmas = vAcross * 3.0;
        gl_FragColor = vec4(1.0 - vAmount * exp(-0.5 * sigmas * sigmas), 0.0, 0.0, 1.0);
    }
`;
// A clump: amount × a round Gaussian; aCorner ±1 at the quad's corners (3σ).
const clumpVertex = /* glsl */ `
    attribute float aAmount;
    attribute vec2 aCorner;
    varying float vAmount;
    varying vec2 vCorner;
    void main() {
        vAmount = aAmount;
        vCorner = aCorner;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const clumpFragment = /* glsl */ `
    varying float vAmount;
    varying vec2 vCorner;
    void main() {
        vec2 sigmas = vCorner * 3.0;
        gl_FragColor = vec4(vAmount * exp(-0.5 * dot(sigmas, sigmas)), 0.0, 0.0, 1.0);
    }
`;
// Marbles: the scrub's amount + the wheel's carry (`tCarry`, texel aSlot)
// × aShed (the shed share ÷ the ribbon's area, px²).
const marbleVertex = /* glsl */ `
    uniform sampler2D tCarry;
    attribute float aAmount;
    attribute float aAcross;
    attribute float aSlot;
    attribute float aShed;
    varying float vAmount;
    varying float vAcross;
    void main() {
        float carry = aSlot < 0.0 ? 0.0 : texture2D(tCarry, vec2((aSlot + 0.5) / ${MAX_SLOTS.toFixed(1)}, 0.5)).r;
        vAmount = aAmount + carry * aShed;
        vAcross = aAcross;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
// The carry: one point per wheel on its texel (position.x = clip x).
// Taking up: dust at aUv × aValue (additive); shedding: × aValue
// (multiplying).
const carryVertex = /* glsl */ `
    uniform sampler2D tDust;
    uniform float uSample; // 1: × the dust at aUv
    attribute vec2 aUv;
    attribute float aValue;
    varying float vValue;
    void main() {
        vValue = aValue * (uSample > 0.5 ? texture2D(tDust, aUv).r : 1.0);
        gl_PointSize = 1.0;
        gl_Position = vec4(position.x, 0.0, 0.0, 1.0);
    }
`;
const carryFragment = /* glsl */ `
    varying float vValue;
    void main() { gl_FragColor = vec4(vValue, 0.0, 0.0, 1.0); }
`;
const marbleFragment = /* glsl */ `
    varying float vAmount;
    varying float vAcross;
    void main() {
        float sigmas = vAcross * 3.0;
        gl_FragColor = vec4(vAmount * exp(-0.5 * sigmas * sigmas), 0.0, 0.0, 1.0);
    }
`;

// One blur pass over the whole target (a full-screen quad), TAPS each side.
// The first pass reads the rubber, the second the first's result.
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
    varying vec2 vUv;
    void main() {
        float sum = 0.0;
        float weights = 0.0;
        for (int i = -TAPS; i <= TAPS; i++) {
            float d = float(i);
            float w = exp(-0.5 * d * d / (uSigma * uSigma));
            sum += texture2D(tSource, vUv + uStep * d).r * w;
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
    uniforms: { tSource: { value: null }, uStep: { value: new THREE.Vector2() }, uSigma: { value: sigma } },
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
    uniform sampler2D tDust;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
        float on = texture2D(tOn, vUv).r;
        float dust = texture2D(tDust, vUv).r;
        float rubber = ${RUBBER_DARK.toFixed(2)} * (1.0 - exp(-on / ${RUBBER_SATURATE.toFixed(2)}));
        float marbles = ${MAX_DARK.toFixed(2)} * (1.0 - exp(-dust / ${SATURATE.toFixed(1)}));
        // Marbles over the rubber (two layers of the same colour).
        float alpha = 1.0 - (1.0 - rubber) * (1.0 - marbles);
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
    // Picking up: this frame's brush pieces, drawn into `dust`.
    private readonly brushPositions = new Float32Array(MAX_PIECES * 4 * 3);
    private readonly pickups = new Float32Array(MAX_PIECES * 4);
    private readonly brushes = new THREE.BufferGeometry();
    private readonly pickupScene = new THREE.Scene();
    // Marbles: this frame's ribbon per piece, added into `dust`.
    private readonly marblePositions = new Float32Array(MAX_PIECES * 4 * 3);
    private readonly marbleAmounts = new Float32Array(MAX_PIECES * 4);
    private readonly marbleSlots = new Float32Array(MAX_PIECES * 4);
    private readonly marbleSheds = new Float32Array(MAX_PIECES * 4);
    private readonly marbles = new THREE.BufferGeometry();
    private readonly marbleScene = new THREE.Scene();
    // Clumps: this frame's drops (locks that ended), added into `dust`.
    private readonly clumpPositions = new Float32Array(MAX_CLUMPS * 4 * 3);
    private readonly clumpAmounts = new Float32Array(MAX_CLUMPS * 4);
    private readonly clumps = new THREE.BufferGeometry();
    private clumpCount = 0;
    private dust: THREE.WebGLRenderTarget | null = null;
    // Carrying: a texel per wheel (`slots`: car → its first of 4). This
    // frame's take-up points (`takes`) and shed / reset points (`sheds`).
    private readonly carry = new THREE.WebGLRenderTarget(MAX_SLOTS, 1, {
        format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    private readonly slots = new Map<string, number>();
    private readonly freeSlots = Array.from({ length: MAX_SLOTS / 4 }, (_, i) => (MAX_SLOTS / 4 - 1 - i) * 4);
    private readonly takes = carryPoints(MAX_PIECES);
    private readonly sheds = carryPoints(MAX_PIECES + MAX_SLOTS);
    private takeCount = 0;
    private shedCount = 0;
    private readonly takeMaterial = carryMaterial(true);
    private readonly shedMaterial = carryMaterial(false);
    private readonly carryScene = new THREE.Scene();
    private readonly carryPoints = new THREE.Points(undefined, this.takeMaterial);
    private clearCarry = true;
    // Blurring: the rubber → [across (first pass), result (both passes)].
    private readonly onBlur = blurMaterial(ON_TAPS, ON_SIGMA);
    private readonly blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    private readonly blurScene = new THREE.Scene();
    private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private on: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
    private blurDue = false;   // rubber laid since the last blur
    private lastBlur = -Infinity;
    // Showing: the asphalt, darker under (rubber) and beside (marbles) the line.
    private readonly material = new THREE.ShaderMaterial({
        vertexShader: showVertex,
        fragmentShader: showFragment,
        transparent: true,
        depthWrite: false,
        fog: true,
        // Over the asphalt (same height), under the tyre marks.
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            tOn: { value: null }, tDust: { value: null }, uBox: { value: new THREE.Vector4() }, uColor: { value: COLOR },
        }]),
    });
    private readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    private readonly trails = new Map<string, { spawnId: number; wheels: (TrailEnd | null)[] }>();
    private track: DrawTrack | null = null;
    private clear = false;

    public constructor(scene: THREE.Scene) {
        const indices = new Uint32Array(MAX_PIECES * 6);
        for (let s = 0; s < MAX_PIECES; s++) indices.set([0, 1, 2, 0, 2, 3].map(i => s * 4 + i), s * 6);
        // Every brush / marble piece: its left edge −1, its right edge +1 (as positions are set).
        const across = new Float32Array(MAX_PIECES * 4).map((_, i) => [-1, -1, 1, 1][i % 4]);
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
        this.brushes.setIndex(new THREE.BufferAttribute(indices, 1));
        this.brushes.setAttribute('position', new THREE.BufferAttribute(this.brushPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.brushes.setAttribute('aAmount', new THREE.BufferAttribute(this.pickups, 1).setUsage(THREE.DynamicDrawUsage));
        this.brushes.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
        // dust × the fragment's (1 − pickup).
        const pickup = new THREE.Mesh(this.brushes, new THREE.ShaderMaterial({
            vertexShader: acrossVertex,
            fragmentShader: pickupFragment,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
        }));
        pickup.frustumCulled = false;
        this.pickupScene.add(pickup);
        this.marbles.setIndex(new THREE.BufferAttribute(indices, 1));
        this.marbles.setAttribute('position', new THREE.BufferAttribute(this.marblePositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.marbles.setAttribute('aAmount', new THREE.BufferAttribute(this.marbleAmounts, 1).setUsage(THREE.DynamicDrawUsage));
        this.marbles.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
        this.marbles.setAttribute('aSlot', new THREE.BufferAttribute(this.marbleSlots, 1).setUsage(THREE.DynamicDrawUsage));
        this.marbles.setAttribute('aShed', new THREE.BufferAttribute(this.marbleSheds, 1).setUsage(THREE.DynamicDrawUsage));
        const marble = new THREE.Mesh(this.marbles, new THREE.ShaderMaterial({
            vertexShader: marbleVertex,
            fragmentShader: marbleFragment,
            depthTest: false,
            depthWrite: false,
            uniforms: { tCarry: { value: this.carry.texture } },
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        }));
        marble.frustumCulled = false;
        this.marbleScene.add(marble);
        this.clumps.setIndex(new THREE.BufferAttribute(indices.subarray(0, MAX_CLUMPS * 6), 1));
        this.clumps.setAttribute('position', new THREE.BufferAttribute(this.clumpPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.clumps.setAttribute('aAmount', new THREE.BufferAttribute(this.clumpAmounts, 1).setUsage(THREE.DynamicDrawUsage));
        this.clumps.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(MAX_CLUMPS * 4 * 2).map((_, i) => [-1, -1, -1, 1, 1, 1, 1, -1][i % 8]), 2));
        const clump = new THREE.Mesh(this.clumps, new THREE.ShaderMaterial({
            vertexShader: clumpVertex,
            fragmentShader: clumpFragment,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        }));
        clump.frustumCulled = false;
        this.marbleScene.add(clump);
        this.carryPoints.frustumCulled = false;
        this.carryScene.add(this.carryPoints);
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
        const now = performance.now() / 1000;
        let count = 0;
        this.clumpCount = 0;
        this.takeCount = 0;
        this.shedCount = 0;
        const seen = new Set<string>();
        for (const car of cars) {
            seen.add(car.id);
            // A new car gets 4 carry texels, emptied (none free: carries nothing).
            let slot = this.slots.get(car.id);
            if (slot === undefined) {
                slot = this.freeSlots.pop() ?? -1;
                this.slots.set(car.id, slot);
                if (slot >= 0) for (let w = 0; w < 4; w++) this.addShed(slot + w, 0);
            }
            let trail = this.trails.get(car.id);
            if (!trail || trail.spawnId !== car.spawnId) {
                trail?.wheels.forEach(end => this.drop(end));
                trail = { spawnId: car.spawnId, wheels: car.scrub.map(() => null) };
                this.trails.set(car.id, trail);
            }
            wheelsOf(car).forEach(({ fx, fy, width }, w) => {
                const point = carPoint(car, fx, fy);
                const end = trail.wheels[w];
                const distance = end ? Math.hypot(point.x - end.point.x, point.y - end.point.y) : Infinity;
                const locked = car.locked && w >= 2; // the rears: RR, RL
                // The lock ended (or the trail breaks): drop what it carried there.
                if (end && (!locked || distance > JUMP_PX)) this.drop(end);
                if (distance > JUMP_PX) {
                    trail.wheels[w] = { point, edge: null, brush: null, marbles: null, marbleSide: 0, carried: 0, skid: 0, time: now, dir: null, side: 0 };
                } else if (distance >= MIN_PIECE_PX && count < MAX_PIECES) {
                    const pickup = Math.min(PICKUP_MAX, PICKUP_BASE + PICKUP_SCRUB * car.scrub[w]);
                    trail.wheels[w] = this.addPiece(count++, end!, point, now, width, Math.sign(fy), car.scrub[w], pickup, locked, slot < 0 ? -1 : slot + w);
                }
            });
        }
        for (const [id, trail] of this.trails) {
            if (seen.has(id)) continue;
            trail.wheels.forEach(end => this.drop(end));
            this.trails.delete(id);
        }
        for (const [id, slot] of this.slots) {
            if (seen.has(id)) continue;
            if (slot >= 0) this.freeSlots.push(slot);
            this.slots.delete(id);
        }
        if (count > 0 || this.clumpCount > 0 || this.shedCount > 0 || this.clear) this.lay(count, renderer);
        if (this.blurDue && now - this.lastBlur >= BLUR_SECONDS) {
            this.lastBlur = now;
            this.blurDue = false;
            this.blur(renderer);
        }
    }

    // Draw this frame's `count` pieces into the rubber, their brushes and
    // marbles into `dust` (all cleared first on another track): the carry
    // takes up the dust under the brushes first, the marbles shed from it,
    // then it is reduced by what they shed.
    private lay(count: number, renderer: THREE.WebGLRenderer): void {
        this.blurDue = true;
        this.pieces.setDrawRange(0, count * 6);
        this.brushes.setDrawRange(0, count * 6);
        this.marbles.setDrawRange(0, count * 6);
        this.clumps.setDrawRange(0, this.clumpCount * 6);
        (this.pieces.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.pieces.getAttribute('aRubber') as THREE.BufferAttribute).needsUpdate = true;
        (this.brushes.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.brushes.getAttribute('aAmount') as THREE.BufferAttribute).needsUpdate = true;
        (this.marbles.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.marbles.getAttribute('aAmount') as THREE.BufferAttribute).needsUpdate = true;
        (this.clumps.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.clumps.getAttribute('aAmount') as THREE.BufferAttribute).needsUpdate = true;
        (this.marbles.getAttribute('aSlot') as THREE.BufferAttribute).needsUpdate = true;
        (this.marbles.getAttribute('aShed') as THREE.BufferAttribute).needsUpdate = true;
        for (const points of [this.takes, this.sheds]) {
            for (const name of ['position', 'aUv', 'aValue']) (points.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
        }
        this.takes.setDrawRange(0, this.takeCount);
        this.sheds.setDrawRange(0, this.shedCount);
        const before = renderer.getRenderTarget();
        const autoClear = renderer.autoClear;
        if (this.clear) {
            for (const target of [this.target!, this.dust!]) this.clearTarget(renderer, target);
            this.clear = false;
        }
        if (this.clearCarry) {
            this.clearTarget(renderer, this.carry);
            this.clearCarry = false;
        }
        renderer.autoClear = false;
        renderer.setRenderTarget(this.target);
        renderer.render(this.layScene, this.layCamera);
        renderer.setRenderTarget(this.carry);
        this.carryPoints.geometry = this.takes;
        this.carryPoints.material = this.takeMaterial;
        renderer.render(this.carryScene, this.blurCamera);
        renderer.setRenderTarget(this.dust);
        renderer.render(this.pickupScene, this.layCamera);
        renderer.render(this.marbleScene, this.layCamera);
        renderer.setRenderTarget(this.carry);
        this.carryPoints.geometry = this.sheds;
        this.carryPoints.material = this.shedMaterial;
        renderer.render(this.carryScene, this.blurCamera);
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(before);
    }

    private clearTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
        const color = renderer.getClearColor(new THREE.Color());
        const alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.setClearColor(color, alpha);
    }

    // The blur `on` (two Gaussian passes).
    private blur(renderer: THREE.WebGLRenderer): void {
        const before = renderer.getRenderTarget();
        this.blurInto(renderer, this.onBlur, this.target!, this.on!);
        renderer.setRenderTarget(before);
    }

    // One blur: `source` across x into [0], then that along y into [1].
    private blurInto(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, source: THREE.WebGLRenderTarget, [across, result]: TargetPair): void {
        const u = material.uniforms;
        this.blurQuad.material = material;
        u.tSource.value = source.texture;
        (u.uStep.value as THREE.Vector2).set(1 / across.width, 0);
        renderer.setRenderTarget(across);
        renderer.render(this.blurScene, this.blurCamera);
        u.tSource.value = across.texture;
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
            format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        });
        this.clear = true;
        this.layCamera.left = minX;
        this.layCamera.right = minX + width;
        // Looking down with up = −Z: screen top = world minY.
        this.layCamera.top = -minY;
        this.layCamera.bottom = -(minY + height);
        this.layCamera.position.set(0, 5, 0);
        this.layCamera.updateProjectionMatrix();
        const single = (w: number, h: number): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(w, h, {
            format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        });
        const pair = (w: number, h: number): TargetPair => [single(w, h), single(w, h)];
        for (const t of [...this.on ?? [], this.dust]) t?.dispose();
        this.on = pair(this.target.width, this.target.height);
        this.dust = single(this.target.width, this.target.height);
        this.material.uniforms.tOn.value = this.on[1].texture;
        this.material.uniforms.tDust.value = this.dust.texture;
        this.takeMaterial.uniforms.tDust.value = this.dust.texture;
        this.clearCarry = true;
        (this.material.uniforms.uBox.value as THREE.Vector4).set(minX, minY, width, height);
        this.mesh.geometry.dispose();
        this.mesh.geometry = asphaltGeometry(track.rings, 0);
        this.mesh.visible = true;
    }

    // Piece `s`: from the trail end to b (reached at `time`), `width`
    // wide, BASE_RUBBER + `scrub` on all of it, its pick-up brush
    // (BRUSH_HALF_PX each side, `pickup` in the middle) and its marble
    // ribbon (`scrub` × width across; `away`: the wheel's side of the kart,
    // +1 = right; `locked`: none, carried instead) with its share of the
    // wheel's carry (texel `slot`, −1 = none); each starts on the edge its
    // last piece ended. Returns the new end.
    private addPiece(s: number, end: TrailEnd, b: Point, time: number, width: number, away: number, scrub: number, pickup: number, locked: boolean, slot: number): TrailEnd {
        const length = Math.hypot(b.x - end.point.x, b.y - end.point.y);
        const dir = { x: (b.x - end.point.x) / length, y: (b.y - end.point.y) / length };
        const dt = Math.max(time - end.time, 1e-3);
        const speed = length / dt;
        let side = end.side;
        if (end.dir) {
            // The turn since the last piece (+ = towards + normal) × v² / length.
            const turn = Math.asin(Math.max(-1, Math.min(1, end.dir.x * dir.y - end.dir.y * dir.x)));
            side += (speed * speed * turn / length - side) * Math.min(1, dt / SIDE_SMOOTH_SECONDS);
        }
        const edge = ribbon(end.point, b, width / 2, end.edge, this.positions, s * 12);
        const brush = ribbon(end.point, b, BRUSH_HALF_PX, end.brush, this.brushPositions, s * 12);
        this.amounts.fill((BASE_RUBBER + scrub) * GAIN, s * 4, s * 4 + 4);
        this.pickups.fill(pickup, s * 4, s * 4 + 4);
        const sideways = Math.min(1, Math.abs(side) / (SIDE_FULL_G * 9.81 * PX_PER_M));
        const fast = Math.max(0, Math.min(1, (speed / PX_PER_M * 3.6 - SLOW_KMH) / (FAST_KMH - SLOW_KMH)));
        // The outside of the turn is away from it (− normal for side > 0);
        // no clear turn → away from the kart's centre (`away`). Another side
        // starts a new ribbon.
        // Locked: the shavings, inside the skid (side 0, centred, ±2σ = the
        // tyre), the share by the skid's length so far; the rest carried.
        const skid = locked ? end.skid + length : 0;
        const k = Math.max(0, Math.min(1, (skid / PX_PER_M - SKID_SHORT_M) / (SKID_LONG_M - SKID_SHORT_M)));
        const trail = locked ? LOCK_TRAIL_SHORT + (LOCK_TRAIL_LONG - LOCK_TRAIL_SHORT) * k * k * (3 - 2 * k) : 1;
        const marbleSide = locked ? 0 : sideways >= SIDE_FROM ? -Math.sign(side) : away;
        const far = sideways * fast;
        const start = NEAR_START_PX + (FAST_START_PX - NEAR_START_PX) * far;
        const scatter = locked ? width / 4 : NEAR_SCATTER_PX + (FAST_SCATTER_PX - NEAR_SCATTER_PX) * far;
        // Gaussian peak with (its share of) scrub × width under it.
        this.marbleAmounts.fill(trail * scrub * GAIN * width / (scatter * Math.sqrt(2 * Math.PI)), s * 4, s * 4 + 4);
        const centre = locked ? 0 : width / 2 + start + scatter * 2;
        const marbles = ribbon(end.point, b, scatter * 3, marbleSide === end.marbleSide ? end.marbles : null, this.marblePositions, s * 12, marbleSide * centre);
        // Carrying: take up the dust under the brush's middle (× its area),
        // shed a share into the marbles (a locked tyre: none).
        const shed = locked || slot < 0 ? 0 : 1 - Math.exp(-length / PX_PER_M * (1 / SHED_ROLL_M + scrub / SHED_SCRUB_M));
        this.marbleSlots.fill(slot, s * 4, s * 4 + 4);
        this.marbleSheds.fill(shed / M2_PER_PX2 / (length * scatter * Math.sqrt(2 * Math.PI)), s * 4, s * 4 + 4);
        if (slot >= 0 && this.track) {
            const box = this.material.uniforms.uBox.value as THREE.Vector4;
            const u = ((end.point.x + b.x) / 2 - box.x) / box.z;
            const v = 1 - ((end.point.y + b.y) / 2 - box.y) / box.w;
            setPoint(this.takes, this.takeCount++, slot, u, v, pickup * BRUSH_SIGMA_PX * Math.sqrt(2 * Math.PI) * length * M2_PER_PX2);
            if (shed > 0) this.addShed(slot, 1 - shed);
        }
        const carried = end.carried + (1 - trail) * scrub * GAIN * width * length;
        return { point: b, edge, brush, marbles, marbleSide, carried, skid, time, dir, side };
    }

    // The carry texel `slot` × `factor` this frame (0 = emptied).
    private addShed(slot: number, factor: number): void {
        if (this.shedCount < MAX_PIECES + MAX_SLOTS) setPoint(this.sheds, this.shedCount++, slot, 0, 0, factor);
    }

    // Drop what a wheel carried as a clump at its trail end, along its last
    // direction (at most MAX_CLUMPS a frame; more are lost).
    private drop(end: TrailEnd | null): void {
        if (!end || end.carried <= 0 || this.clumpCount >= MAX_CLUMPS) return;
        const c = this.clumpCount++;
        const { x, y } = end.point;
        const d = end.dir ?? { x: 1, y: 0 };
        // aCorner (±along, ±across) → ±3σ along d, ±3σ across it.
        const ax = d.x * CLUMP_ALONG_PX * 3, ay = d.y * CLUMP_ALONG_PX * 3;
        const cx = -d.y * CLUMP_ACROSS_PX * 3, cy = d.x * CLUMP_ACROSS_PX * 3;
        this.clumpPositions.set([
            x - ax - cx, 0, y - ay - cy,
            x - ax + cx, 0, y - ay + cy,
            x + ax + cx, 0, y + ay + cy,
            x + ax - cx, 0, y + ay - cy,
        ], c * 12);
        // Gaussian peak with `carried` under it.
        this.clumpAmounts.fill(end.carried / (2 * Math.PI * CLUMP_ALONG_PX * CLUMP_ACROSS_PX), c * 4, c * 4 + 4);
        end.carried = 0;
    }

    public dispose(): void {
        for (const t of [this.target, this.dust, this.carry, ...this.on ?? []]) t?.dispose();
    }
}

// `count` carry points (position.x = clip x of the texel, aUv, aValue).
function carryPoints(count: number): THREE.BufferGeometry {
    const points = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    points.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage));
    points.setAttribute('aValue', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    return points;
}

function setPoint(points: THREE.BufferGeometry, i: number, slot: number, u: number, v: number, value: number): void {
    (points.getAttribute('position').array as Float32Array)[i * 3] = ((slot + 0.5) / MAX_SLOTS) * 2 - 1;
    (points.getAttribute('aUv').array as Float32Array).set([u, v], i * 2);
    (points.getAttribute('aValue').array as Float32Array)[i] = value;
}

// Taking up (dust × value, added) or shedding (× value, multiplied).
function carryMaterial(take: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: carryVertex,
        fragmentShader: carryFragment,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: take ? THREE.OneFactor : THREE.ZeroFactor,
        blendDst: take ? THREE.OneFactor : THREE.SrcColorFactor,
        uniforms: { tDust: { value: null }, uSample: { value: take ? 1 : 0 } },
    });
}

// A quad from a to b, `half` each side of a line `shift` along the + normal
// (−dy, dx) from a → b, into `positions` at `offset` (left a, left b,
// right b, right a); starts on `start` (the edge the last one ended) if
// any. Returns its end edge.
function ribbon(a: Point, b: Point, half: number, start: Edge | null, positions: Float32Array, offset: number, shift = 0): Edge {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const l = shift + half;
    const r = shift - half;
    const [left, right] = start ?? [{ x: a.x + nx * l, y: a.y + ny * l }, { x: a.x + nx * r, y: a.y + ny * r }];
    const edge: Edge = [{ x: b.x + nx * l, y: b.y + ny * l }, { x: b.x + nx * r, y: b.y + ny * r }];
    positions.set([
        left.x, 0, left.y,
        edge[0].x, 0, edge[0].y,
        edge[1].x, 0, edge[1].y,
        right.x, 0, right.y,
    ], offset);
    return edge;
}
