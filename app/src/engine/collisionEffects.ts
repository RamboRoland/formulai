import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';

// Explosion + smoke where a car collides (Kenney smoke particles, CC0), and
// the car model breaking into its parts. Visual only: camera-facing sprites
// and part copies in the Scene3D world, sized from the car's length.

const SPRITE_DIR = '/assets/sprites/';
const VARIANTS = 9; // <name>00.png … <name>08.png

type SpriteKind = 'flash' | 'explosion' | 'blackSmoke';

// One burst, sizes × car length, times in seconds.
type ParticleSpec = {
    kind: SpriteKind;
    count: number;
    delay: [number, number];
    life: [number, number];
    startSize: number;
    endSize: number;
    spread: number;   // horizontal offset from the car centre
    height: number;   // start height above the ground
    rise: number;     // per second
    drift: number;    // sideways per second
    opacity: number;
};

const BURST: ParticleSpec[] = [
    { kind: 'flash', count: 1, delay: [0, 0], life: [0.15, 0.15], startSize: 1.5, endSize: 3.5, spread: 0, height: 0.3, rise: 0, drift: 0, opacity: 1 },
    { kind: 'explosion', count: 5, delay: [0, 0.08], life: [0.35, 0.6], startSize: 0.8, endSize: 2.5, spread: 0.3, height: 0.4, rise: 0.5, drift: 0.3, opacity: 1 },
    { kind: 'blackSmoke', count: 8, delay: [0.05, 0.3], life: [1.5, 2.5], startSize: 0.8, endSize: 3, spread: 0.4, height: 0.5, rise: 1.5, drift: 0.4, opacity: 0.8 },
];
// Share of a particle's life spent fading in (the rest fades out).
const FADE_IN = 0.1;

// Car parts flying apart: each a rigid body (its mesh's own vertices touch
// the ground, gravity tips it over, wheels roll), real units. They lie
// there as a wreck until clearDebris (the car respawns). Plan
// `.claude/tasks/crash-debris.md`.
const GRAVITY = fromMetersToPixels(9.81);           // px/s²
// ponytail: carries 40 % of the kart's speed — parts pass through walls and
// each other, so the full speed threw them far past the tyre wall.
const DEBRIS_CARRY = 0.4;
const DEBRIS_UP: [number, number] = [2, 4];          // m/s
const DEBRIS_OUT: [number, number] = [1, 3];         // m/s, away from the car centre
const DEBRIS_SPIN = 8;                               // max rad/s per axis
const RESTITUTION = 0.3;                             // bounce, landing faster than…
const BOUNCE_SPEED = fromMetersToPixels(1);          // …this (slower: no bounce)
const FRICTION = 0.6;                                // ground, Coulomb
// Rolling resistance / scraping while touching the ground: spin falls this
// fast (per second) — a wheel on its tread rolls to a stop instead of
// rolling forever, and contact jitter dies out.
const ROLLING_DRAG = 2;
// Static friction: touching the ground slower than this (and its points too)
// it sticks — its sliding stopped fast (per second) instead of creeping on
// the impulses' jitter. Turning is left alone: it can still tip over.
const STICK_SPEED = fromMetersToPixels(0.2);
const STICK_DRAG = 12;
const SUBSTEP_SECONDS = 1 / 240;
const MAX_CONTACT_POINTS = 128;                      // directions → hull vertices kept per part
// Asleep (frozen) after sticking this long with its points slower than
// SLEEP_SPEED (not mid-tip).
const SLEEP_SECONDS = 0.5;
const SLEEP_SPEED = fromMetersToPixels(0.15);

type Particle = {
    sprite: THREE.Sprite;
    born: number;
    life: number;
    startSize: number;
    endSize: number;
    velocity: THREE.Vector3;
    opacity: number;
};

type Debris = {
    ownerId: string;
    part: THREE.Object3D;
    points: THREE.Vector3[];     // contact points, part space, from the centre of mass (unscaled)
    centre: THREE.Vector3;       // centre of mass, part space (bounding-box centre)
    scale: number;
    position: THREE.Vector3;     // centre of mass, world px
    velocity: THREE.Vector3;     // px/s
    spin: THREE.Vector3;         // world angular velocity, rad/s
    inverseInertia: THREE.Vector3; // part space, diagonal (solid box, mass 1)
    reach: number;               // farthest point from the centre, px
    sticking: boolean;           // on the ground, slower than STICK_SPEED (last substep)
    still: number;               // seconds sticking so far
    asleep: boolean;
};

const between = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

export class CollisionEffects {
    private readonly textures: Record<SpriteKind, THREE.Texture[]>;
    private particles: Particle[] = [];
    private debris: Debris[] = [];
    // Scratch vectors for step().
    private readonly arm = new THREE.Vector3();
    private readonly pointVelocity = new THREE.Vector3();
    private readonly impulse = new THREE.Vector3();
    private readonly torque = new THREE.Vector3();
    private readonly tangent = new THREE.Vector3();
    private readonly turn = new THREE.Quaternion();
    private readonly inverse = new THREE.Quaternion();

    public constructor(private readonly scene: THREE.Scene) {
        const loader = new THREE.TextureLoader();
        const load = (kind: SpriteKind) => Array.from({ length: VARIANTS }, (_, i) => {
            const texture = loader.load(`${SPRITE_DIR}${kind}${String(i).padStart(2, '0')}.png`);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        });
        this.textures = { flash: load('flash'), explosion: load('explosion'), blackSmoke: load('blackSmoke') };
    }

    // Burst at world (x, y) (three X, Z) at time `now` (seconds).
    public spawn(x: number, y: number, carLengthPx: number, now: number): void {
        for (const spec of BURST) {
            for (let i = 0; i < spec.count; i++) {
                const variants = this.textures[spec.kind];
                const material = new THREE.SpriteMaterial({
                    map: variants[Math.floor(Math.random() * variants.length)],
                    rotation: Math.random() * Math.PI * 2,
                    transparent: true,
                    depthWrite: false,
                    opacity: 0,
                });
                const sprite = new THREE.Sprite(material);
                const angle = Math.random() * Math.PI * 2;
                const offset = Math.random() * spec.spread * carLengthPx;
                sprite.position.set(x + Math.cos(angle) * offset, spec.height * carLengthPx, y + Math.sin(angle) * offset);
                sprite.visible = false;
                this.scene.add(sprite);
                const driftAngle = Math.random() * Math.PI * 2;
                this.particles.push({
                    sprite,
                    born: now + between(spec.delay),
                    life: between(spec.life),
                    startSize: spec.startSize * carLengthPx,
                    endSize: spec.endSize * carLengthPx,
                    velocity: new THREE.Vector3(
                        Math.cos(driftAngle) * spec.drift * carLengthPx,
                        spec.rise * carLengthPx,
                        Math.sin(driftAngle) * spec.drift * carLengthPx,
                    ),
                    opacity: spec.opacity,
                });
            }
        }
    }

    // Copies of `parts` (meshes in place on car `ownerId`, world matrices
    // current) fly out from (x, y) with the car's velocity (`carVelocity`,
    // three X / Z px/s), tumble, land and stay as a wreck.
    public breakApart(ownerId: string, parts: THREE.Object3D[], x: number, y: number, carVelocity: THREE.Vector3): void {
        for (const source of parts) {
            const part = source.clone();
            // Its own shape (no transform): vertices, centre, size.
            part.position.set(0, 0, 0);
            part.quaternion.identity();
            part.scale.setScalar(1);
            part.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(part);
            const centre = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const points = contactPoints(part).map(point => point.sub(centre));
            source.matrixWorld.decompose(part.position, part.quaternion, part.scale);
            const scale = part.scale.x;
            this.scene.add(part);

            const position = centre.clone().multiplyScalar(scale).applyQuaternion(part.quaternion).add(part.position);
            const outX = position.x - x;
            const outZ = position.z - y;
            const outLength = Math.hypot(outX, outZ) || 1;
            const out = fromMetersToPixels(between(DEBRIS_OUT));
            const scaled = size.clone().multiplyScalar(scale);
            const inertia = (a: number, b: number) => 12 / (a * a + b * b);
            this.debris.push({
                ownerId,
                part,
                points,
                centre,
                scale,
                position,
                velocity: carVelocity.clone().multiplyScalar(DEBRIS_CARRY)
                    .add(new THREE.Vector3((outX / outLength) * out, fromMetersToPixels(between(DEBRIS_UP)), (outZ / outLength) * out)),
                spin: new THREE.Vector3(between([-1, 1]), between([-1, 1]), between([-1, 1])).multiplyScalar(DEBRIS_SPIN),
                inverseInertia: new THREE.Vector3(inertia(scaled.y, scaled.z), inertia(scaled.x, scaled.z), inertia(scaled.x, scaled.y)),
                reach: Math.max(...points.map(point => point.length())) * scale,
                sticking: false,
                still: 0,
                asleep: false,
            });
        }
    }

    // Removes car `ownerId`'s wreck (every wreck without an id).
    public clearDebris(ownerId?: string): void {
        this.debris = this.debris.filter(d => {
            if (ownerId !== undefined && d.ownerId !== ownerId) return true;
            this.scene.remove(d.part);
            return false;
        });
    }

    // Grow, rise, fade; remove finished particles. Debris: fall and bounce.
    public update(now: number, deltaSeconds: number): void {
        const steps = Math.ceil(deltaSeconds / SUBSTEP_SECONDS);
        for (const d of this.debris) {
            if (d.asleep) continue;
            for (let i = 0; i < steps; i++) this.step(d, deltaSeconds / steps);
            d.still = d.sticking && d.spin.length() * d.reach < SLEEP_SPEED ? d.still + deltaSeconds : 0;
            d.asleep = d.still > SLEEP_SECONDS;
            // Part origin = centre of mass − its offset.
            d.part.position.copy(d.centre).multiplyScalar(-d.scale).applyQuaternion(d.part.quaternion).add(d.position);
        }

        this.particles = this.particles.filter(p => {
            const t = (now - p.born) / p.life;
            if (t >= 1) {
                this.scene.remove(p.sprite);
                p.sprite.material.dispose();
                return false;
            }
            p.sprite.visible = t >= 0;
            if (t < 0) return true;
            const grow = 1 - (1 - t) ** 2; // ease out
            p.sprite.scale.setScalar(p.startSize + (p.endSize - p.startSize) * grow);
            p.sprite.position.addScaledVector(p.velocity, deltaSeconds);
            p.sprite.material.opacity = p.opacity * (t < FADE_IN ? t / FADE_IN : 1 - (t - FADE_IN) / (1 - FADE_IN));
            return true;
        });
    }

    // One substep of a part: gravity, move, then every point below the
    // ground gets a contact impulse (bounce + friction) and the part is
    // pushed back out.
    private step(d: Debris, dt: number): void {
        const q = d.part.quaternion;
        d.velocity.y -= GRAVITY * dt;
        d.position.addScaledVector(d.velocity, dt);
        const angle = d.spin.length() * dt;
        if (angle > 0) q.premultiply(this.turn.setFromAxisAngle(this.tangent.copy(d.spin).normalize(), angle)).normalize();
        this.inverse.copy(q).invert();
        // Angular velocity change from an impulse at arm r: I⁻¹ (r × J), world.
        const spinFrom = (r: THREE.Vector3, j: THREE.Vector3) =>
            this.torque.crossVectors(r, j).applyQuaternion(this.inverse).multiply(d.inverseInertia).applyQuaternion(q);
        // Effective inverse mass along unit direction n at arm r.
        const resistance = (r: THREE.Vector3, n: THREE.Vector3) => 1 + spinFrom(r, n).cross(r).dot(n);
        let depth = 0;
        for (const point of d.points) {
            const r = this.arm.copy(point).multiplyScalar(d.scale).applyQuaternion(q);
            const height = d.position.y + r.y;
            if (height >= 0) continue;
            depth = Math.max(depth, -height);
            const v = this.pointVelocity.crossVectors(d.spin, r).add(d.velocity);
            if (v.y >= 0) continue;
            const normal = this.impulse.set(0, 1, 0);
            const push = (-(1 + (v.y < -BOUNCE_SPEED ? RESTITUTION : 0)) * v.y) / resistance(r, normal);
            this.apply(d, r, normal.multiplyScalar(push));
            // Friction: against the sliding of this point, at most μ × push.
            v.crossVectors(d.spin, r).add(d.velocity).setY(0);
            const slide = v.length();
            if (slide < 1e-6) continue;
            const direction = this.tangent.copy(v).divideScalar(slide);
            const grip = Math.min(slide / resistance(r, direction), FRICTION * push);
            this.apply(d, r, direction.multiplyScalar(-grip));
        }
        d.sticking = false;
        if (depth === 0) return;
        d.position.y += depth;
        const sticking = d.sticking = d.velocity.length() < STICK_SPEED && d.spin.length() * d.reach < STICK_SPEED;
        d.spin.multiplyScalar(Math.exp(-ROLLING_DRAG * dt));
        if (sticking) {
            const drag = Math.exp(-STICK_DRAG * dt);
            d.velocity.x *= drag;
            d.velocity.z *= drag;
        }
    }

    private apply(d: Debris, r: THREE.Vector3, impulse: THREE.Vector3): void {
        d.velocity.add(impulse);
        d.spin.add(this.torque.crossVectors(r, impulse).applyQuaternion(this.inverse).multiply(d.inverseInertia).applyQuaternion(d.part.quaternion));
    }

    public dispose(): void {
        this.update(Infinity, 0);
        this.clearDebris();
        for (const variants of Object.values(this.textures)) variants.forEach(texture => texture.dispose());
    }
}

// A part's outer vertices in its own space (its transform reset, world
// matrices current): the farthest one in each of MAX_CONTACT_POINTS
// directions (spread evenly over a sphere) — only the hull can touch the
// ground; the body's corners and a wheel's rim are kept.
const contactPoints = (part: THREE.Object3D): THREE.Vector3[] => {
    const all: THREE.Vector3[] = [];
    part.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        const positions = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
        if (!positions) return;
        for (let i = 0; i < positions.count; i++) all.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    });
    const centre = new THREE.Box3().setFromPoints(all).getCenter(new THREE.Vector3());
    const kept = new Set<THREE.Vector3>();
    const direction = new THREE.Vector3();
    for (let i = 0; i < MAX_CONTACT_POINTS; i++) {
        // Fibonacci sphere.
        const y = 1 - (2 * (i + 0.5)) / MAX_CONTACT_POINTS;
        const ring = Math.sqrt(1 - y * y);
        const angle = i * Math.PI * (3 - Math.sqrt(5));
        direction.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
        let best = all[0];
        let bestReach = -Infinity;
        for (const point of all) {
            const reach = (point.x - centre.x) * direction.x + (point.y - centre.y) * direction.y + (point.z - centre.z) * direction.z;
            if (reach > bestReach) {
                bestReach = reach;
                best = point;
            }
        }
        kept.add(best);
    }
    return [...kept];
};
