import * as THREE from 'three';

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

// Car parts flying apart, × car length per second (²). They land, bounce
// and lie there as a wreck until clearDebris (the car respawns).
const DEBRIS_UP: [number, number] = [5, 8];
const DEBRIS_OUT: [number, number] = [1.5, 3.5];
const DEBRIS_SPIN = 12; // max radians per second per axis
const DEBRIS_GRAVITY = 20;
const DEBRIS_BOUNCE = 0.35;   // vertical speed kept on landing
const DEBRIS_FRICTION = 0.5;  // horizontal speed and spin kept on landing

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
    restY: number; // height it had on the car = resting on the ground
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
    gravity: number;
};

const between = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

export class CollisionEffects {
    private readonly textures: Record<SpriteKind, THREE.Texture[]>;
    private particles: Particle[] = [];
    private debris: Debris[] = [];

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
    // current) fly out from (x, y), tumble, bounce and stay as a wreck.
    public breakApart(ownerId: string, parts: THREE.Object3D[], x: number, y: number, carLengthPx: number): void {
        for (const source of parts) {
            const part = source.clone();
            source.matrixWorld.decompose(part.position, part.quaternion, part.scale);
            this.scene.add(part);
            const outX = part.position.x - x;
            const outZ = part.position.z - y;
            const outLength = Math.hypot(outX, outZ) || 1;
            const out = between(DEBRIS_OUT) * carLengthPx;
            this.debris.push({
                ownerId,
                part,
                restY: part.position.y,
                velocity: new THREE.Vector3((outX / outLength) * out, between(DEBRIS_UP) * carLengthPx, (outZ / outLength) * out),
                spin: new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * DEBRIS_SPIN),
                gravity: DEBRIS_GRAVITY * carLengthPx,
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
        for (const d of this.debris) {
            d.velocity.y -= d.gravity * deltaSeconds;
            d.part.position.addScaledVector(d.velocity, deltaSeconds);
            d.part.rotation.x += d.spin.x * deltaSeconds;
            d.part.rotation.y += d.spin.y * deltaSeconds;
            d.part.rotation.z += d.spin.z * deltaSeconds;
            if (d.part.position.y < d.restY) {
                d.part.position.y = d.restY;
                d.velocity.y = Math.abs(d.velocity.y) * DEBRIS_BOUNCE;
                d.velocity.x *= DEBRIS_FRICTION;
                d.velocity.z *= DEBRIS_FRICTION;
                d.spin.multiplyScalar(DEBRIS_FRICTION);
            }
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

    public dispose(): void {
        this.update(Infinity, 0);
        this.clearDebris();
        for (const variants of Object.values(this.textures)) variants.forEach(texture => texture.dispose());
    }
}
