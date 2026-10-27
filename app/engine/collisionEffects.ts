import * as THREE from 'three';

// Explosion + smoke where a car collides (Kenney smoke particles, CC0).
// Visual only: camera-facing sprites in the Scene3D world, sized from the
// car's length.

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

type Particle = {
    sprite: THREE.Sprite;
    born: number;
    life: number;
    startSize: number;
    endSize: number;
    velocity: THREE.Vector3;
    opacity: number;
};

const between = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

export class CollisionEffects {
    private readonly textures: Record<SpriteKind, THREE.Texture[]>;
    private particles: Particle[] = [];

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

    // Grow, rise, fade; remove finished particles.
    public update(now: number, deltaSeconds: number): void {
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
        for (const variants of Object.values(this.textures)) variants.forEach(texture => texture.dispose());
    }
}
